# ESP32 Firmware

This directory contains the ESP32 firmware used by PerryMeter for Wi-Fi CSI collection and radar communication.

## Hardware Architecture

PerryMeter uses three ESP32 boards and an LD2410C radar sensor.

| Device | Role | Firmware |
|---|---|---|
| ESP1 | Wi-Fi CSI receiver and radar interface | `csi/csi_recv_esp1/` |
| ESP2 | Wi-Fi CSI transmitter | `csi/csi_send_esp2/` |
| ESP3 | Wi-Fi CSI transmitter | `csi/csi_send_esp3/` |

ESP2 and ESP3 transmit Wi-Fi packets to ESP1. The receiver collects CSI measurements from both connections.

The LD2410C radar is connected directly to ESP1, allowing Wi-Fi and radar data to be transmitted to the Raspberry Pi through a single USB serial connection.

## Data Output

ESP1 outputs three types of serial messages:

- `CSI_DATA` — Wi-Fi CSI measurements
- `RADAR_DATA` — Radar detection measurements
- `RADAR_STATUS` — Radar connection status

The receiver's USB serial connection uses a baud rate of **921600**.

## ESP32 Identification

The firmware assigns the following sender addresses:

- **ESP2:** `1a:00:00:00:00:02`
- **ESP3:** `1a:00:00:00:00:03`

These addresses allow the backend to distinguish between the two monitored Wi-Fi connections.

## Additional Firmware

The `radar_bridge/` and `radar_check/` directories contain separate radar communication and diagnostic sketches.

These are not required for the integrated ESP1-based setup.

## Development

The Wi-Fi CSI firmware is based on [Espressif's ESP-CSI project](https://github.com/espressif/esp-csi).

See `csi/csi_recv_esp1/README.md` for receiver wiring, firmware output, and build instructions.
