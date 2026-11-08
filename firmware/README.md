# firmware/ (Step 1: Hardware Setup)

ESP32 firmware that produces CSI. Typical setup: one board transmits packets at a steady rate, a second board receives them and prints CSI for each packet over USB serial.

- **Inputs:** Wi-Fi packets from the TX board (or a router).
- **Outputs:** one CSI record per line on serial (e.g. `CSI_DATA,<mac>,<rssi>,<rate>,...,<len>,[i0 q0 i1 q1 ...]`). Document the exact line format here once fixed; `collection/` depends on it.

## Current line format (esp-csi `csi_recv`)

```
CSI_DATA,seq,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,aggregation,stbc,
fec_coding,sgi,noise_floor,ampdu_cnt,channel,secondary_channel,local_timestamp,ant,sig_len,
rx_state,len,first_word,"[i,q,...]"
```

As of 2026-11-06: the sender (MAC `1a:00:00:00:00:00`) sends about 91 pkt/s on channel 11 with HT40 and the secondary channel below. `len` = 384 (192 subcarriers), and each line is about 1.25 kB.

Known limits:

- At 921600 baud, the serial link carries about 70 lines/s at most, below the 91 pkt/s sender rate. Even with a perfect radio link, up to about 40% of packets get dropped on the RX board.
- To fix that, raise the console baud (e.g. 2000000; then pass `--baud 2000000` to the recorder) or lower the sender rate to about 50 Hz.
- Switching to HT20 shortens each line (`len` 256) and avoids the crowded 40 MHz channel.

## Suggested tooling

- [ESP-IDF](https://docs.espressif.com/projects/esp-idf/) (v5.x) with `idf.py`
- [espressif/esp-csi](https://github.com/espressif/esp-csi) (`csi_send` / `csi_recv` examples) or [ESP32-CSI-Tool](https://github.com/StevenMHernandez/ESP32-CSI-Tool)

## To record here

- Exact ESP32 model(s) and which board is TX vs RX
- ESP-IDF version, channel, packet rate, baud rate
- Flash/monitor commands and known gotchas

## Radar (HLK-LD2410C) sketches

The radar connects through its own Feather ESP32 V2 (not the CSI boards). Flash with the Arduino IDE: board **Adafruit Feather ESP32 V2**, core **esp32 by Espressif Systems** (3.3.12 used).

| Sketch | Flash it when | What reaches the laptop |
|---|---|---|
| `radar_bridge/radar_bridge.ino` | **Normal use.** Needed by `radar_test.py`, `radar_plot.py`, `radar_server.py` | The radar's raw binary frames (start `F4 F3 F2 F1`), 921600 baud |
| `radar_check/radar_check.ino` | Wiring check only | One text line per second: `alive - bytes from radar in last second: N` (about 230 when working). No radar frames, so the Python scripts show nothing |

Wiring: radar VCC to Feather USB (5 V), GND to GND, radar TX to Feather RX (GPIO 7), radar RX to Feather TX (GPIO 8), OUT unused. Radar UART: 256000 baud, 8N1.

Gotchas:

- Only one program can open the port. Close the Arduino Serial Monitor before running the Python scripts.
- With the bridge flashed, the Serial Monitor shows gibberish. That is normal (binary data).
- Keep the HLKRadarTool phone app closed while reading over USB; its settings mode can pause the radar's output.
