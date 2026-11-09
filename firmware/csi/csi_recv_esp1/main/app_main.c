/*
 * Perrymeter ESP1 hub firmware: Wi-Fi CSI receiver for ESP2 and ESP3, plus the LD2410C radar.
 *
 * Based on Espressif's esp-csi example examples/get-started/csi_recv
 * (SPDX-FileCopyrightText: 2025-2026 Espressif Systems (Shanghai) CO LTD,
 * SPDX-License-Identifier: Apache-2.0; the example is also offered as Public Domain / CC0).
 *
 * Changes from the example:
 *   - Team A's receiver changes: ESP1's own MAC is 1a:00:00:00:00:01, and it accepts CSI from
 *     senders that share the first five bytes and end in 0x02 (ESP2) or 0x03 (ESP3).
 *     0x04 to 0x09 are accepted too, for expansion nodes.
 *   - The LD2410C radar is read on UART2 at 256000 baud. Its RX pin is found automatically:
 *     the firmware listens on each free GPIO until it sees a complete radar frame.
 *   - One print lock, so a radar line is never written into the middle of a CSI line.
 *
 * Output on the USB serial port (UART0, 921600 baud), one line each:
 *   CSI_DATA,...         unchanged esp-csi format, one line per received packet
 *   RADAR_DATA,ms,state,moving_cm,moving_energy,still_cm,still_energy,detect_cm
 *                        ms = milliseconds since boot; state 0 nobody, 1 moving, 2 still, 3 both
 *   RADAR_STATUS,found,rx_gpio=N   |   RADAR_STATUS,lost,rx_gpio=N   |   RADAR_STATUS,not_found
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/uart.h"
#include "esp_timer.h"

#include "nvs_flash.h"

#include "esp_mac.h"
#include "rom/ets_sys.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_csi_gain_ctrl.h"

#define CONFIG_LESS_INTERFERENCE_CHANNEL   11
#if CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C61 || (CONFIG_IDF_TARGET_ESP32C6 && ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 4, 0))
#define CONFIG_WIFI_BAND_MODE               WIFI_BAND_MODE_2G_ONLY
#define CONFIG_WIFI_2G_BANDWIDTHS           WIFI_BW_HT40
#define CONFIG_WIFI_5G_BANDWIDTHS           WIFI_BW_HT40
#define CONFIG_WIFI_2G_PROTOCOL             WIFI_PROTOCOL_11N
#define CONFIG_WIFI_5G_PROTOCOL             WIFI_PROTOCOL_11N
#else
#define CONFIG_WIFI_BANDWIDTH           WIFI_BW_HT40
#endif

#define CONFIG_ESP_NOW_PHYMODE           WIFI_PHY_MODE_HT40
#define CONFIG_ESP_NOW_RATE             WIFI_PHY_RATE_MCS0_LGI
#define CONFIG_FORCE_GAIN                   0

#if CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C61
#define CSI_FORCE_LLTF                      0
#endif

#if CONFIG_IDF_TARGET_ESP32S3 || CONFIG_IDF_TARGET_ESP32C3 || CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C6 || CONFIG_IDF_TARGET_ESP32C61
#define CONFIG_GAIN_CONTROL                 1
#endif

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(6, 0, 0)
#define ESP_IF_WIFI_STA ESP_MAC_WIFI_STA
#endif

/* ESP1's own MAC. Senders share the first five bytes and end in 0x02 (ESP2), 0x03 (ESP3), ... */
static const uint8_t CONFIG_CSI_RECV_MAC[] = {0x1a, 0x00, 0x00, 0x00, 0x00, 0x01};
#define SENDER_LAST_BYTE_MIN  0x02
#define SENDER_LAST_BYTE_MAX  0x09

/* The USB serial link carries about 70 CSI lines a second in total. Each sender sends 100 a second,
 * so without a limit the link stays full and whichever sender's timing lines up best gets most of
 * it (one test gave 17 and 57 a second). Printing at most one packet per sender every 35 ms
 * (every 4th packet at 100 a second, so about 25 a second each) keeps the link at about 70% and
 * the two sides equal. */
#define CSI_MIN_INTERVAL_US   35000

/* Radar: LD2410C on UART2, 256000 baud 8N1. Only its TX wire matters; ESP1 never transmits to it. */
#define RADAR_UART            UART_NUM_2
#define RADAR_BAUD            256000
#define RADAR_RX_BUFFER       2048
#define RADAR_SCAN_MS_PER_PIN 400     /* the radar sends about 10 frames a second */
#define RADAR_LOST_AFTER_MS   3000

/* Free GPIOs on an ESP32-WROOM-32 dev board, most likely first. Not 1/3 (USB console) or 6-11 (flash). */
static const int RADAR_RX_CANDIDATES[] = {16, 17, 4, 5, 13, 14, 18, 19, 21, 22, 23, 25, 26, 27,
                                          32, 33, 34, 35, 36, 39, 2, 15, 0, 12};

static const char *TAG = "csi_recv_esp1";
static SemaphoreHandle_t s_print_lock;

static bool is_sender_mac(const uint8_t *mac)
{
    return memcmp(mac, CONFIG_CSI_RECV_MAC, 5) == 0
           && mac[5] >= SENDER_LAST_BYTE_MIN && mac[5] <= SENDER_LAST_BYTE_MAX;
}

static void print_line(const char *line)
{
    xSemaphoreTake(s_print_lock, portMAX_DELAY);
    ets_printf("%s", line);
    xSemaphoreGive(s_print_lock);
}

/* ---- Wi-Fi and CSI (from the esp-csi example) ------------------------------------------- */

static void wifi_init()
{
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(esp_netif_init());
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));

#if CONFIG_IDF_TARGET_ESP32C5
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_wifi_set_band_mode(CONFIG_WIFI_BAND_MODE);
    wifi_protocols_t protocols = {
        .ghz_2g = CONFIG_WIFI_2G_PROTOCOL,
        .ghz_5g = CONFIG_WIFI_5G_PROTOCOL
    };
    ESP_ERROR_CHECK(esp_wifi_set_protocols(ESP_IF_WIFI_STA, &protocols));
    wifi_bandwidths_t bandwidth = {
        .ghz_2g = CONFIG_WIFI_2G_BANDWIDTHS,
        .ghz_5g = CONFIG_WIFI_5G_BANDWIDTHS
    };
    ESP_ERROR_CHECK(esp_wifi_set_bandwidths(ESP_IF_WIFI_STA, &bandwidth));
#elif (CONFIG_IDF_TARGET_ESP32C6 && ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 4, 0)) || CONFIG_IDF_TARGET_ESP32C61
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_wifi_set_band_mode(CONFIG_WIFI_BAND_MODE);
    wifi_protocols_t protocols = {
        .ghz_2g = CONFIG_WIFI_2G_PROTOCOL,
    };
    ESP_ERROR_CHECK(esp_wifi_set_protocols(ESP_IF_WIFI_STA, &protocols));
    wifi_bandwidths_t bandwidth = {
        .ghz_2g = CONFIG_WIFI_2G_BANDWIDTHS,
    };
    ESP_ERROR_CHECK(esp_wifi_set_bandwidths(ESP_IF_WIFI_STA, &bandwidth));
#else
    ESP_ERROR_CHECK(esp_wifi_set_bandwidth(ESP_IF_WIFI_STA, CONFIG_WIFI_BANDWIDTH));
    ESP_ERROR_CHECK(esp_wifi_start());
#endif

    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
#if CONFIG_IDF_TARGET_ESP32C5
    if ((CONFIG_WIFI_BAND_MODE == WIFI_BAND_MODE_2G_ONLY && CONFIG_WIFI_2G_BANDWIDTHS == WIFI_BW_HT20)
            || (CONFIG_WIFI_BAND_MODE == WIFI_BAND_MODE_5G_ONLY && CONFIG_WIFI_5G_BANDWIDTHS == WIFI_BW_HT20)) {
        ESP_ERROR_CHECK(esp_wifi_set_channel(CONFIG_LESS_INTERFERENCE_CHANNEL, WIFI_SECOND_CHAN_NONE));
    } else {
        ESP_ERROR_CHECK(esp_wifi_set_channel(CONFIG_LESS_INTERFERENCE_CHANNEL, WIFI_SECOND_CHAN_BELOW));
    }
#elif (CONFIG_IDF_TARGET_ESP32C6 && ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 4, 0)) || CONFIG_IDF_TARGET_ESP32C61
    if (CONFIG_WIFI_BAND_MODE == WIFI_BAND_MODE_2G_ONLY && CONFIG_WIFI_2G_BANDWIDTHS == WIFI_BW_HT20) {
        ESP_ERROR_CHECK(esp_wifi_set_channel(CONFIG_LESS_INTERFERENCE_CHANNEL, WIFI_SECOND_CHAN_NONE));
    } else {
        ESP_ERROR_CHECK(esp_wifi_set_channel(CONFIG_LESS_INTERFERENCE_CHANNEL, WIFI_SECOND_CHAN_BELOW));
    }
#else
    if (CONFIG_WIFI_BANDWIDTH == WIFI_BW_HT20) {
        ESP_ERROR_CHECK(esp_wifi_set_channel(CONFIG_LESS_INTERFERENCE_CHANNEL, WIFI_SECOND_CHAN_NONE));
    } else {
        ESP_ERROR_CHECK(esp_wifi_set_channel(CONFIG_LESS_INTERFERENCE_CHANNEL, WIFI_SECOND_CHAN_BELOW));
    }
#endif

    ESP_ERROR_CHECK(esp_wifi_set_mac(WIFI_IF_STA, CONFIG_CSI_RECV_MAC));
}

static void wifi_esp_now_init(esp_now_peer_info_t peer)
{
    ESP_ERROR_CHECK(esp_now_init());
    ESP_ERROR_CHECK(esp_now_set_pmk((uint8_t *)"pmk1234567890123"));
    esp_now_rate_config_t rate_config = {
        .phymode = CONFIG_ESP_NOW_PHYMODE,
        .rate = CONFIG_ESP_NOW_RATE,//  WIFI_PHY_RATE_MCS0_LGI,
        .ersu = false,
        .dcm = false
    };
    ESP_ERROR_CHECK(esp_now_add_peer(&peer));
    ESP_ERROR_CHECK(esp_now_set_peer_rate_config(peer.peer_addr, &rate_config));

}

static void wifi_csi_rx_cb(void *ctx, wifi_csi_info_t *info)
{
    if (!info || !info->buf) {
        ESP_LOGW(TAG, "<%s> wifi_csi_cb", esp_err_to_name(ESP_ERR_INVALID_ARG));
        return;
    }

    if (!is_sender_mac(info->mac)) {
        return;
    }

    /* Per-sender rate limit, before any printing (see CSI_MIN_INTERVAL_US) */
    static int64_t s_last_printed_us[SENDER_LAST_BYTE_MAX + 1];
    int64_t now_us = esp_timer_get_time();
    if (now_us - s_last_printed_us[info->mac[5]] < CSI_MIN_INTERVAL_US) {
        return;
    }
    s_last_printed_us[info->mac[5]] = now_us;

    const wifi_pkt_rx_ctrl_t *rx_ctrl = &info->rx_ctrl;
    static int s_count = 0;
    float compensate_gain = 1.0f;
    static uint8_t agc_gain = 0;
    static int8_t fft_gain = 0;
#if CONFIG_GAIN_CONTROL
    static uint8_t agc_gain_baseline = 0;
    static int8_t fft_gain_baseline = 0;
    esp_csi_gain_ctrl_get_rx_gain(rx_ctrl, &agc_gain, &fft_gain);
    if (s_count < 100) {
        esp_csi_gain_ctrl_record_rx_gain(agc_gain, fft_gain);
    } else if (s_count == 100) {
        esp_csi_gain_ctrl_get_rx_gain_baseline(&agc_gain_baseline, &fft_gain_baseline);
#if CONFIG_FORCE_GAIN
        esp_csi_gain_ctrl_set_rx_force_gain(agc_gain_baseline, fft_gain_baseline);
        ESP_LOGD(TAG, "fft_force %d, agc_force %d", fft_gain_baseline, agc_gain_baseline);
#endif
    }
    esp_csi_gain_ctrl_get_gain_compensation(&compensate_gain, agc_gain, fft_gain);
    ESP_LOGI(TAG, "compensate_gain %f, agc_gain %d, fft_gain %d", compensate_gain, agc_gain, fft_gain);
#endif

    uint32_t rx_id = *(uint32_t *)(info->payload + 15);

    /* The line is written in many pieces; hold the lock so radar lines cannot land inside it. */
    xSemaphoreTake(s_print_lock, portMAX_DELAY);
#if CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C6 || CONFIG_IDF_TARGET_ESP32C61
    if (!s_count) {
        ets_printf("type,seq,mac,rssi,rate,noise_floor,fft_gain,agc_gain,channel,local_timestamp,sig_len,rx_format,len,first_word,data\n");
    }

    ets_printf("CSI_DATA,%d," MACSTR ",%d,%d,%d,%d,%d,%d,%d,%d,%d",
               rx_id, MAC2STR(info->mac), rx_ctrl->rssi, rx_ctrl->rate,
               rx_ctrl->noise_floor, fft_gain, agc_gain,  rx_ctrl->channel,
               rx_ctrl->timestamp, rx_ctrl->sig_len, rx_ctrl->cur_bb_format);
#else
    if (!s_count) {
        ets_printf("type,id,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,aggregation,stbc,fec_coding,sgi,noise_floor,ampdu_cnt,channel,secondary_channel,local_timestamp,ant,sig_len,rx_format,len,first_word,data\n");
    }

    ets_printf("CSI_DATA,%d," MACSTR ",%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d",
               rx_id, MAC2STR(info->mac), rx_ctrl->rssi, rx_ctrl->rate, rx_ctrl->sig_mode,
               rx_ctrl->mcs, rx_ctrl->cwb, rx_ctrl->smoothing, rx_ctrl->not_sounding,
               rx_ctrl->aggregation, rx_ctrl->stbc, rx_ctrl->fec_coding, rx_ctrl->sgi,
               rx_ctrl->noise_floor, rx_ctrl->ampdu_cnt, rx_ctrl->channel, rx_ctrl->secondary_channel,
               rx_ctrl->timestamp, rx_ctrl->ant, rx_ctrl->sig_len, rx_ctrl->sig_mode);

#endif
#if (CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C61) && CSI_FORCE_LLTF
    int16_t csi = ((int16_t)(((((uint16_t)info->buf[1]) << 8) | info->buf[0]) << 4) >> 4);
    ets_printf(",%d,%d,\"[%d", (info->len - 2) / 2, info->first_word_invalid, (int16_t)(compensate_gain * csi));
    for (int i = 2; i < (info->len - 2); i += 2) {
        csi = ((int16_t)(((((uint16_t)info->buf[i + 1]) << 8) | info->buf[i]) << 4) >> 4);
        ets_printf(",%d", (int16_t)(compensate_gain * csi));
    }
#else
    ets_printf(",%d,%d,\"[%d", info->len, info->first_word_invalid, (int16_t)(compensate_gain * info->buf[0]));
    for (int i = 1; i < info->len; i++) {
        ets_printf(",%d", (int16_t)(compensate_gain * info->buf[i]));
    }
#endif
    ets_printf("]\"\n");
    xSemaphoreGive(s_print_lock);
    s_count++;
}

static void wifi_csi_init()
{
    ESP_ERROR_CHECK(esp_wifi_set_promiscuous(true));

    /**< default config */
#if CONFIG_IDF_TARGET_ESP32C5 || CONFIG_IDF_TARGET_ESP32C61
    wifi_csi_config_t csi_config = {
        .enable                   = true,
        .acquire_csi_legacy       = false,
        .acquire_csi_force_lltf   = CSI_FORCE_LLTF,
        .acquire_csi_ht20         = true,
        .acquire_csi_ht40         = true,
        .acquire_csi_vht          = false,
        .acquire_csi_su           = false,
        .acquire_csi_mu           = false,
        .acquire_csi_dcm          = false,
        .acquire_csi_beamformed   = false,
        .acquire_csi_he_stbc_mode = 2,
        .val_scale_cfg            = 0,
        .dump_ack_en              = false,
        .reserved                 = false
    };
#elif CONFIG_IDF_TARGET_ESP32C6
    wifi_csi_config_t csi_config = {
        .enable                 = true,
        .acquire_csi_legacy     = false,
        .acquire_csi_ht20       = true,
        .acquire_csi_ht40       = true,
        .acquire_csi_su         = true,
        .acquire_csi_mu         = true,
        .acquire_csi_dcm        = true,
        .acquire_csi_beamformed = true,
        .acquire_csi_he_stbc    = 2,
        .val_scale_cfg          = false,
        .dump_ack_en            = false,
        .reserved               = false
    };
#else
    wifi_csi_config_t csi_config = {
        .lltf_en           = true,
        .htltf_en          = true,
        .stbc_htltf2_en    = true,
        .ltf_merge_en      = true,
        .channel_filter_en = true,
        .manu_scale        = false,
        .shift             = false,
    };
#endif
    ESP_ERROR_CHECK(esp_wifi_set_csi_config(&csi_config));
    ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(wifi_csi_rx_cb, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_csi(true));
}

/* ---- LD2410C radar ---------------------------------------------------------------------- */

typedef struct {
    uint8_t state;        /* 0 header, 1 length, 2 payload, 3 tail */
    uint8_t idx;
    uint16_t length;
    uint8_t payload[64];
} radar_parser_t;

typedef struct {
    uint8_t target;       /* 0 nobody, 1 moving, 2 still, 3 moving and still */
    uint16_t moving_cm;
    uint8_t moving_energy;
    uint16_t still_cm;
    uint8_t still_energy;
    uint16_t detect_cm;
} radar_frame_t;

static const uint8_t RADAR_HEAD[4] = {0xF4, 0xF3, 0xF2, 0xF1};
static const uint8_t RADAR_TAIL[4] = {0xF8, 0xF7, 0xF6, 0xF5};

/* Feed one byte. Returns true when a complete, valid target report has been decoded into *f. */
static bool radar_parse_byte(radar_parser_t *p, uint8_t b, radar_frame_t *f)
{
    switch (p->state) {
    case 0:  /* header F4 F3 F2 F1 */
        if (b == RADAR_HEAD[p->idx]) {
            if (++p->idx == 4) {
                p->state = 1;
                p->idx = 0;
                p->length = 0;
            }
        } else {
            p->idx = (b == RADAR_HEAD[0]) ? 1 : 0;
        }
        return false;
    case 1:  /* payload length, 2 bytes little-endian */
        p->length |= (uint16_t)b << (8 * p->idx);
        if (++p->idx == 2) {
            p->idx = 0;
            p->state = (p->length >= 11 && p->length <= sizeof(p->payload)) ? 2 : 0;
        }
        return false;
    case 2:  /* payload */
        p->payload[p->idx++] = b;
        if (p->idx == p->length) {
            p->state = 3;
            p->idx = 0;
        }
        return false;
    case 3:  /* tail F8 F7 F6 F5 */
        if (b != RADAR_TAIL[p->idx]) {
            p->state = 0;
            p->idx = (b == RADAR_HEAD[0]) ? 1 : 0;
            return false;
        }
        if (++p->idx < 4) {
            return false;
        }
        p->state = 0;
        p->idx = 0;
        if (p->payload[1] != 0xAA) {   /* not a target report (for example a command reply) */
            return false;
        }
        const uint8_t *q = p->payload + 2;
        f->target = q[0];
        f->moving_cm = (uint16_t)(q[1] | (q[2] << 8));
        f->moving_energy = q[3];
        f->still_cm = (uint16_t)(q[4] | (q[5] << 8));
        f->still_energy = q[6];
        f->detect_cm = (uint16_t)(q[7] | (q[8] << 8));
        return true;
    default:
        p->state = 0;
        p->idx = 0;
        return false;
    }
}

/* Listen on each candidate pin until a complete radar frame arrives. Returns the pin or -1. */
static int radar_find_rx_pin(void)
{
    uint8_t data[128];
    radar_parser_t parser;
    radar_frame_t frame;
    for (size_t i = 0; i < sizeof(RADAR_RX_CANDIDATES) / sizeof(RADAR_RX_CANDIDATES[0]); i++) {
        int pin = RADAR_RX_CANDIDATES[i];
        if (uart_set_pin(RADAR_UART, UART_PIN_NO_CHANGE, pin, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE) != ESP_OK) {
            continue;
        }
        uart_flush_input(RADAR_UART);
        memset(&parser, 0, sizeof(parser));
        int64_t until = esp_timer_get_time() + (int64_t)RADAR_SCAN_MS_PER_PIN * 1000;
        while (esp_timer_get_time() < until) {
            int n = uart_read_bytes(RADAR_UART, data, sizeof(data), pdMS_TO_TICKS(20));
            for (int k = 0; k < n; k++) {
                if (radar_parse_byte(&parser, data[k], &frame)) {
                    return pin;
                }
            }
        }
    }
    return -1;
}

static void radar_task(void *arg)
{
    const uart_config_t cfg = {
        .baud_rate = RADAR_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_ERROR_CHECK(uart_driver_install(RADAR_UART, RADAR_RX_BUFFER, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(RADAR_UART, &cfg));

    uint8_t data[128];
    char line[112];
    radar_parser_t parser;
    radar_frame_t frame;
    int rx_pin = -1;
    int64_t last_frame_us = 0;

    while (true) {
        if (rx_pin < 0) {
            rx_pin = radar_find_rx_pin();
            if (rx_pin < 0) {
                print_line("RADAR_STATUS,not_found\n");
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }
            snprintf(line, sizeof(line), "RADAR_STATUS,found,rx_gpio=%d\n", rx_pin);
            print_line(line);
            memset(&parser, 0, sizeof(parser));
            last_frame_us = esp_timer_get_time();
        }

        int n = uart_read_bytes(RADAR_UART, data, sizeof(data), pdMS_TO_TICKS(100));
        for (int k = 0; k < n; k++) {
            if (radar_parse_byte(&parser, data[k], &frame)) {
                last_frame_us = esp_timer_get_time();
                snprintf(line, sizeof(line), "RADAR_DATA,%lld,%u,%u,%u,%u,%u,%u\n",
                         (long long)(last_frame_us / 1000), frame.target, frame.moving_cm,
                         frame.moving_energy, frame.still_cm, frame.still_energy, frame.detect_cm);
                print_line(line);
            }
        }

        if (esp_timer_get_time() - last_frame_us > (int64_t)RADAR_LOST_AFTER_MS * 1000) {
            snprintf(line, sizeof(line), "RADAR_STATUS,lost,rx_gpio=%d\n", rx_pin);
            print_line(line);
            rx_pin = -1;   /* search again, in case it was rewired */
        }
    }
}

void app_main()
{
    s_print_lock = xSemaphoreCreateMutex();

    /**
     * @brief Initialize NVS
     */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    /**
     * @brief Initialize Wi-Fi
     */
    wifi_init();

    /**
     * @brief Initialize ESP-NOW
     *        ESP-NOW protocol see: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/network/esp_now.html
     */

    esp_now_peer_info_t peer = {
        .channel   = CONFIG_LESS_INTERFERENCE_CHANNEL,
        .ifidx     = WIFI_IF_STA,
        .encrypt   = false,
        .peer_addr = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff},
    };

    wifi_esp_now_init(peer);

    wifi_csi_init();

    ESP_LOGI(TAG, "ESP1 " MACSTR " ready: CSI from senders ending %02x to %02x, radar on UART2 at %d baud",
             MAC2STR(CONFIG_CSI_RECV_MAC), SENDER_LAST_BYTE_MIN, SENDER_LAST_BYTE_MAX, RADAR_BAUD);
    xTaskCreate(radar_task, "radar", 4096, NULL, 5, NULL);
}
