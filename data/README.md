# CSI Recordings

This directory is used for Wi-Fi Channel State Information (CSI) recordings collected during PerryMeter development and testing.

Recording files are excluded from Git to avoid committing large datasets.

## Data Format

The CSI recorder saves CSV files containing:

| Column | Description |
|---|---|
| `t` | Recording timestamp |
| `label` | Recording label |
| `raw_csi` | Raw CSI data received from ESP1 |

The receiver identifies the transmitting ESP32 using its MAC address:

- **ESP2:** `1a:00:00:00:00:02`
- **ESP3:** `1a:00:00:00:00:03`

By default, these correspond to the left and right monitored Wi-Fi links, respectively. The dashboard can swap their displayed labels.

## Recording

CSI recordings can be created using `collection/record_csi.py`.

The recorder generates CSV filenames containing the recording label and timestamp.

These recordings are used for signal analysis, testing, and debugging. Detection performance can vary depending on sensor placement and environmental conditions.
