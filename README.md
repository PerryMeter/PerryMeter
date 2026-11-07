# RadarPing

**A portable, camera-free safety fence for temporary work zones.** Two small Wi-Fi boards on two traffic cones form an invisible tripwire: when a person walks into the zone, their body disturbs the Wi-Fi signal between the boards and RadarPing alerts the crew within about a second. A small 24 GHz radar adds an early warning when someone approaches. It works through dust, mud and darkness, needs no tags, and records no video.

natHacks 2026, Construction & Manufacturing theme. Team of 5, built during the 64-hour event (Nov 6 to 9, 2026).

**Start with [`project.md`](project.md)**: the full guide to the idea, hardware, detection, message format, dashboard, demo and timeline.

## Getting the code

```bash
git clone https://github.com/isr808/RadarPing.git
cd RadarPing
```

## How it works

```
 [cone] Sender ESP32  ~~~ Wi-Fi tripwire ~~~>  Receiver ESP32 [cone]
                                                     | USB serial (CSI)
 LD2410C radar --> spare ESP32 --USB serial-------+  |
                                                  v  v
                                      processing/  (Python)
                                      Wi-Fi detector + radar reader
                                      -> alert: clear / approach / inside
                                                     | WebSocket, 10 messages/s
                                                     v
                                      frontend/web/  (dashboard in a browser)
```

1. **firmware/**: Espressif's `esp-csi` examples. The sender broadcasts small packets; the receiver measures the Channel State Information (CSI) of each and prints it over USB.
2. **collection/**: records CSI lines with timestamps and labels for tuning.
3. **processing/**: scores how much the signal is disturbed compared with an empty-zone calibration, reads the radar, decides the alert level, and serves it over WebSocket.
4. **frontend/web/**: live dashboard with the zone status, strength and confidence, a radar-style animation, a 60-second activity graph, an event log, and arm/disarm.

The message format between `processing/` and the dashboard is in [`docs/detection-contract.md`](docs/detection-contract.md).

## Repo layout

| Path | Purpose |
|---|---|
| `project.md` | Full project guide |
| `firmware/` | ESP32 setup notes (Espressif `esp-csi` examples) |
| `collection/` | CSI recorder |
| `processing/` | Detection, radar reader, WebSocket server |
| `frontend/web/` | Dashboard (React, TypeScript, Vite) |
| `frontend/pi_display/` | Earlier PySide6 prototype, not used |
| `data/` | Recordings (gitignored except its README) |
| `docs/` | Plan, message format, results |

## Running it

| Part | Command |
|---|---|
| Firmware | `idf.py set-target esp32`, then `idf.py -p <PORT> flash monitor` in `csi_send` and `csi_recv` (see `firmware/README.md`) |
| Recorder | `python collection/record_csi.py <label> <seconds> --port <PORT> --out data/` |
| Detector | `python processing/detect_motion.py --live <PORT>` (see `processing/README.md`) |
| Dashboard | `cd frontend/web && npm install && npm run dev`, connects to `ws://localhost:8765` |

The recorder and detector are on branch `cursor/csi-recorder-and-detection-7673` and the dashboard on `frontend/web-dashboard` until they are merged.

## Credits

- [Espressif `esp-csi`](https://github.com/espressif/esp-csi): the ESP32 sender and receiver firmware, used unmodified apart from settings.
- Hi-Link LD2410C radar module and its published serial protocol.
- Open-source libraries listed in each part's requirements and `package.json`.

All other code was written by the team during the competition window.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
