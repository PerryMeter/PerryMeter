# CSI Data Collection

This directory contains the Python tool used to record Wi-Fi Channel State Information (CSI) from ESP1.

The recordings can be used for signal analysis, testing, and debugging.

## Recording CSI Data

Install the required dependency from the repository root:

```bash
pip install -r collection/requirements.txt
```

Run the recorder:

```bash
python collection/record_csi.py walk 30 --port COM6 --out data/
```

This records CSI data for 30 seconds with the label `walk`.

Replace `COM6` with ESP1's actual serial port.

## Output

Recordings are saved as CSV files using the format:

`<label>_YYYYMMDD_HHMMSS.csv`

Each recording contains three columns:

| Column | Description |
|---|---|
| `t` | Recording timestamp |
| `label` | Recording scenario |
| `raw_csi` | Raw CSI measurement received from ESP1 |

## Monitoring

During recording, the script displays:

- Packet reception rate
- Received signal strength (RSSI)
- Estimated packet loss
- Malformed CSI lines

**Note:** The current packet-loss calculation does not distinguish between the two ESP32 senders, so its combined loss estimate should not be treated as a reliable per-link measurement.

For recording storage and formatting details, see [`../data/README.md`](../data/README.md).
