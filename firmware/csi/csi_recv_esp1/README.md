# ESP1: CSI receiver + LD2410C radar

ESP1 sits at the hub corner. It receives Wi-Fi CSI from ESP2 (`1a:00:00:00:00:02`) and ESP3 (`1a:00:00:00:00:03`), reads the LD2410C radar wired to it, and sends both to the laptop or Pi over one USB cable.

Based on Espressif's `esp-csi` example `examples/get-started/csi_recv` (Apache-2.0), with Team A's receiver changes (own MAC `1a:00:00:00:00:01`, accept the senders) and a radar reader added.

## Wiring (radar to ESP1)

| LD2410C | ESP1 (ESP32-WROOM-32 dev board) |
|---|---|
| VCC | 5V / VIN |
| GND | GND |
| TX | GPIO16 (RX2) |
| RX | not needed, ESP1 never sends to the radar |
| OUT | not used |

The firmware finds the radar's pin by itself: at startup it listens on each free GPIO until it sees a complete radar frame, then prints which one (`rx_gpio=16` on our board). If the radar goes quiet for 3 s it searches again.

## Output (USB serial, 921600 baud, one line each)

```
CSI_DATA,<id>,1a:00:00:00:00:02,-66,...,384,0,"[...]"     unchanged esp-csi format, one line per packet
RADAR_DATA,<ms>,<state>,<moving_cm>,<moving_energy>,<still_cm>,<still_energy>,<detect_cm>
RADAR_STATUS,found,rx_gpio=16  |  RADAR_STATUS,lost,rx_gpio=16  |  RADAR_STATUS,not_found
```

- `ms`: milliseconds since ESP1 started. `state`: 0 nobody, 1 moving, 2 still, 3 moving and still. Energies are 0 to 100.
- Example: `RADAR_DATA,51234,2,86,0,86,100,85` is someone standing still about 86 cm away.
- Both writers share one print lock, so a radar line never lands inside a CSI line.

## Limits

- **CSI is limited to one packet per sender every 35 ms** (about 22 to 25 a second each; `CSI_MIN_INTERVAL_US` in `main/app_main.c`). The USB link carries only about 70 CSI lines a second. Without the limit it stayed full and the senders got unequal shares (one test: 17 and 57 a second).
- The radar's range is whatever is set in the HLK app; it reported at most 150 cm in our test.
- `radar_plot.py`, `radar_calibrate.py` and `radar_server.py` read the Feather bridge's binary stream, not these `RADAR_DATA` lines.

## Build and flash (ESP-IDF v5.5.6)

From an ESP-IDF PowerShell, in this folder:

```
idf.py build
idf.py -p COM6 flash      (use ESP1's port)
```

On Windows, keep the build folder out of OneDrive, for example `idf.py -B C:\nathacks\build\esp1 build`.

## Tested (2026-11-08)

Flashed on ESP1 (ESP32-D0WD-V3). For 20 s with ESP2 and ESP3 on power banks: ESP2 21.9 lines/s, ESP3 22.3 lines/s, longest gap 0.07 s, RADAR_DATA 9.7/s, 0 garbled lines; radar found on GPIO16. In a 30 s walk test the radar followed a person from about 87 cm to 150 cm and back.
