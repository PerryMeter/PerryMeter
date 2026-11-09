# Processing & Detection

This directory contains the backend responsible for processing sensor data and sending detection results to the PerryMeter dashboard.

## Overview

PerryMeter combines two sensing technologies:

- **Wi-Fi CSI:** Two ESP32 transmitters (ESP2 and ESP3) send signals to ESP1. Changes in these signals help detect activity near the two monitored boundaries.
- **LD2410C Radar:** Connected to ESP1, the radar detects people within the monitored area, including those standing still.

The Raspberry Pi runs `hub.py`, which processes the sensor readings and sends live updates to the dashboard through WebSocket.

## Running the Backend

The integrated system uses `hub.py`.

Install the required Python dependencies from the repository root:

```bash
python -m pip install pyserial websockets numpy
```

Start the backend with ESP1 connected:

```bash
python processing/hub.py --esp1 <PORT>
```

Replace `<PORT>` with the serial port assigned to ESP1.

The backend uses WebSocket port `8765` by default.

**Note:** The exact port and launch procedure should be confirmed against the final Raspberry Pi setup.

## Detection Logic

The backend combines Wi-Fi activity and radar readings to determine the zone's status.

| Status | Meaning |
|---|---|
| `clear` | No qualifying activity detected |
| `approach` | Activity detected near a monitored boundary |
| `inside` | Presence detected within the monitored zone |

The system also estimates which side a person entered through using the available Wi-Fi and radar information.

Wi-Fi disturbances alone do not guarantee that someone physically crossed a boundary. Detection depends on sensor placement and calibration.

## Calibration

The system supports calibration to adjust detection thresholds for its environment.

Calibration measures the empty zone and establishes baseline readings for the Wi-Fi links and radar.

Configuration is saved in:

- `processing/hub_calibration.json`
- `radar_calibration.json`

These files contain environment-specific settings and should not be deleted from a working demo setup without preparing to recalibrate.

## Other Processing Files

- `detect_motion.py` — CSI motion analysis and testing.
- `server.py` — Earlier CSI-only WebSocket server.
- `csi_io.py` — CSI parsing and signal-processing utilities.

These files support testing and development. The integrated demonstration uses **`hub.py`**.

## Limitations

PerryMeter is a hackathon prototype.

Detection reliability depends on sensor placement, calibration, and environmental conditions. The system is intended as an additional monitoring layer, not a replacement for established workplace safety measures.
