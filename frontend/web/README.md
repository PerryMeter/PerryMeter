# PerryMeter Web Dashboard

The PerryMeter dashboard provides live monitoring of the system's Wi-Fi CSI and LD2410C radar detections.

Built with React, TypeScript, and Vite.

## Getting Started

From the repository root:

```bash
cd frontend/web
npm install
npm run dev
```

Open the local URL displayed in the terminal.

## Dashboard Features

The dashboard includes:

- Live zone status: **Clear, Approach, Inside**
- Visual monitoring of the triangular detection area
- Left and right Wi-Fi boundary activity
- Radar presence and distance information
- Sensor status and diagnostic information
- Activity history and event logging
- Arm/disarm and alarm sound controls
- Calibration and sensor settings

## Demo and Live Modes

**Demo Mode**

Displays simulated sensor activity without requiring connected hardware. Simulated data is identified in the interface.

**Live Mode**

Receives sensor data from the PerryMeter processing backend through WebSocket.

The integrated backend is implemented in `processing/hub.py`.

## Connecting to the Backend

The default WebSocket address is:

```text
ws://localhost:8765
```

To connect to a backend on another device, open Live mode and change the connection address in the dashboard's settings.

Alternatively, use a URL such as:

```text
http://localhost:5173/?mode=live&ws=ws://192.168.1.50:8765
```

Replace the IP address with the address of the computer running the backend.

The dashboard also supports a simplified view and a more detailed monitoring interface.

## Detection Data

The dashboard receives detection updates containing information such as:

- Current alert status
- Movement activity
- Signal strength and confidence indicators
- Radar-estimated distance
- Wi-Fi link status
- Sensor availability

The data format is documented in [`../../docs/detection-contract.md`](../../docs/detection-contract.md).

## Development Checks

The following commands are available:

```bash
npm run build
npm test
npm run lint
```

These build, test, and lint commands are defined in the frontend's `package.json`.

## Project

PerryMeter was developed for natHacks 2026 under the Construction & Manufacturing theme.

The dashboard is part of a camera-free safety-monitoring prototype and is not intended to replace certified workplace safety equipment.
