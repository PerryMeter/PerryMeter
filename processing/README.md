
# Processing and Detection

This folder contains PerryMeter's signal-processing tools and the backend that sends live sensor updates to the web dashboard.

**For the integrated demonstration, use `hub.py`.** It combines data from the two ESP32 Wi-Fi CSI links and the LD2410C radar. The older `detect_motion.py` and `server.py` scripts are retained as CSI-only analysis and testing tools.

## System overview

```text
ESP2 (Wi-Fi sender) ----\
                         >---- ESP1 (CSI receiver + LD2410C radar)
ESP3 (Wi-Fi sender) ----/                    |
                                             | USB serial
                                             v
                                    Raspberry Pi / computer
                                      processing/hub.py
                                             |
                                             | WebSocket (port 8765)
                                             v
                                       Web dashboard
```

- **Wi-Fi CSI:** ESP1 receives measurements from ESP2 and ESP3 and evaluates activity near each of the two monitored wireless links.
- **Radar:** The LD2410C provides detection in the monitored area, including stationary presence.
- **Sensor fusion:** `hub.py` combines these readings to report the zone state and an inferred entry side where the available evidence permits.

Wi-Fi link activity is **not by itself proof that someone crossed a boundary**: movement close to a link can also disturb its signal. The hub includes logic to interpret entry and exit events using both Wi-Fi activity and radar readings.

## Requirements

Run these commands from the **repository root**. Install the Python dependencies required by `hub.py`:

```bash
python -m pip install pyserial websockets numpy
```

The hub also imports `radar_settings.py` and `radar_server.py` from the repository root. Keep those files in place.

For a hardware run, connect ESP1 to the machine running the backend. ESP1 must be running the combined receiver firmware (`firmware/csi/csi_recv_esp1`) so that its serial output includes both CSI and radar data.

## Run the integrated demo

### Option 1: ESP1 with Wi-Fi CSI and radar (full hardware setup)

```bash
python processing/hub.py --esp1 COM6
```

Replace `COM6` with ESP1's actual serial port. On Raspberry Pi/Linux this will typically be a `/dev/tty...` device; the exact name depends on the connected hardware.

This mode reads CSI from both Wi-Fi links and radar frames through **one ESP1 USB serial connection**.

### Option 2: Radar only (Feather bridge)

```bash
python processing/hub.py --radar COM5
```

This uses a separate radar bridge and does not provide Wi-Fi side monitoring. Replace `COM5` with the appropriate serial port.

### Option 3: Simulated radar (no sensor hardware)

```bash
python processing/hub.py --fake-radar
```

This generates a repeating sequence of simulated radar states for dashboard testing. It is **not** a substitute for demonstrating the full two-link system.

The hub listens for WebSocket connections on port **8765** by default and publishes updates at a configured rate of **10 messages per second**.

## Connect the dashboard

Start the web frontend from the repository root:

```bash
cd frontend/web
npm install
npm run dev
```

Open the URL shown by Vite and add `?mode=live&sensors=1` to enable the live dashboard and Sensors panel.

If the frontend is on a different device from the backend, set its WebSocket address using the `ws` query parameter, for example:

```text
?mode=live&ws=ws://<BACKEND_IP>:8765&sensors=1
```

Use the backend machine's real IP address in place of `<BACKEND_IP>`. Keep the backend and dashboard on a network that permits the connection. The WebSocket service is intended for the demo's trusted local network, not direct public exposure.

## Detection states

The hub publishes three alert states:

| State | Meaning |
| --- | --- |
| `clear` | No current detection meeting the configured rules. |
| `approach` | Activity at a monitored Wi-Fi side, or radar activity beyond the configured zone **if** the optional extended approach range is enabled. |
| `inside` | The radar detects someone within the configured area, subject to the hub's tracking and exit logic. This can include someone standing still. |

With the standard settings, the radar can initiate an `inside` alert without requiring a prior Wi-Fi crossing. **`--entry-logic` is experimental and disabled by default**; when enabled with ESP1, it requires additional evidence of entry.

The hub can report `entry_side` as `left`, `right`, or `base` (the radar/front side). This is an inference from available sensor readings, not a guaranteed physical location measurement.

### Other dashboard data

The WebSocket messages include fields such as:

- `motion`: whether Wi-Fi side activity or radar movement is detected; a stationary person can still produce `inside` with `motion: false`.
- `strength` and `confidence`: normalized indicators calculated by the backend, **not validated accuracy percentages**.
- `distance_m`: radar-estimated target distance, when available.
- `links` and `nodes`: per-side activity and sensor availability.
- `debug`: detailed sensor measurements, thresholds, and calibration state for the Sensors panel.

The message format is also described in [`../docs/detection-contract.md`](../docs/detection-contract.md). Check that contract against the current backend when changing message fields.

## Calibration and settings

Use the dashboard's **Sensors** panel to calibrate after positioning the hardware:

1. Make sure the monitored area is empty.
2. Select **Calibrate empty zone**.
3. The default countdown provides **5 seconds** to leave the area.
4. The hub then measures the empty area for **15 seconds** and computes Wi-Fi baselines/thresholds and radar energy thresholds.

Calibration results are saved locally to:

- `processing/hub_calibration.json` — Wi-Fi side thresholds, baselines, and saved configuration.
- `radar_calibration.json` — radar thresholds shared with the other radar tools.

These are **environment-specific generated settings**. Do not remove them from a working demo machine without planning to recalibrate. They generally should not be committed as universal defaults.

The dashboard can also send commands to swap the left/right side labels, adjust or reset Wi-Fi thresholds, change radar thresholds, and adjust the radar's monitored range. `hub.py` supports these commands; they change configuration values used by the detection rules.

The Wi-Fi detector also adapts its baseline to recent quiet readings while the radar detects no one. Recalibration is still advisable if the setup or environment changes substantially.

## Useful options

```bash
# Calibrate automatically after starting the hardware hub
python processing/hub.py --esp1 COM6 --calibrate-on-start

# Save radar frames and raw CSI samples
python processing/hub.py --esp1 COM6 --record radar.csv --record-csi csi.csv

# Enable experimental entry gating (not on by default)
python processing/hub.py --esp1 COM6 --entry-logic

# Prevent crossing evidence from clearing an existing radar alert
python processing/hub.py --esp1 COM6 --no-exit-on-crossing
```

`--approach-cm` can optionally extend radar-based `approach` detection beyond the normal zone. `--line-blocked` enables a separate experimental Wi-Fi feature and is **off by default**. Run `python processing/hub.py --help` for the complete list of arguments.

## Earlier CSI-only tools

These scripts remain available for development and debugging, but they are **not the integrated demo server**:

| File | Purpose |
| --- | --- |
| `csi_io.py` | Parse and process captured CSI data. |
| `detect_motion.py` | Offline or live CSI-only motion analysis and threshold experiments. |
| `server.py` | Earlier CSI-only WebSocket server, including replay of recorded captures. |

For the full ESP32 + radar demonstration, run **`hub.py`**, not `server.py`.

## Limitations

- Wi-Fi side activity can occur when someone moves **near** a monitored link, not only when someone physically crosses it.
- Radar coverage and the inferred zone boundary depend on sensor orientation, placement, range, and calibration.
- Entry-side labels and exit decisions are inferences; this is not precise localization or a certified safety system.
- Detection performance and false-alert rates may change in a different environment.

PerryMeter is a **hackathon prototype** intended as an additional safety-monitoring layer, not a replacement for workplace barriers, procedures, or certified safety equipment.
