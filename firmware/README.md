# firmware/ (Step 1: Hardware Setup)

ESP32 firmware that produces CSI. Typical setup: one board transmits packets at a steady rate, a second board receives them and prints CSI for each packet over USB serial.

- **Inputs:** Wi-Fi packets from the TX board (or a router).
- **Outputs:** one CSI record per line on serial (e.g. `CSI_DATA,<mac>,<rssi>,<rate>,...,<len>,[i0 q0 i1 q1 ...]`). Document the exact line format here once fixed; `collection/` depends on it.

## Suggested tooling

- [ESP-IDF](https://docs.espressif.com/projects/esp-idf/) (v5.x) with `idf.py`
- [espressif/esp-csi](https://github.com/espressif/esp-csi) (`csi_send` / `csi_recv` examples) or [ESP32-CSI-Tool](https://github.com/StevenMHernandez/ESP32-CSI-Tool)

## To record here

- Exact ESP32 model(s) and which board is TX vs RX
- ESP-IDF version, channel, packet rate, baud rate
- Flash/monitor commands and known gotchas
