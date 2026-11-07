# Perrymeter

**A portable, camera-free safety perimeter for temporary work zones.** Three traffic cones form a **danger triangle**: Wi-Fi signals between the cones act as invisible tripwires, and a 24 GHz radar at the top corner watches the inside, even for someone standing still. When a person crosses a side, Perrymeter tells the crew which side within about a second. It works through dust, mud and darkness, needs no tags, and records no video.

natHacks 2026, Construction & Manufacturing theme. Team of 5, built during the 64-hour event (Nov 6 to 9, 2026). Formerly called RadarPing (the repository name).

**Start with [`project.md`](project.md)**: the full guide to the idea, the triangle, detection, message format, dashboard, business model, demo and timeline.

## Getting the code

```bash
git clone https://github.com/isr808/RadarPing.git
cd RadarPing
```

## How it works

```
                    HUB cone: Raspberry Pi + receiver ESP32 + LD2410C radar
                       /\
       Wi-Fi tripwire /  \ Wi-Fi tripwire        radar watches the inside
                     /    \
       LEFT node cone /______\ RIGHT node cone   (ESP32 senders on power banks)

  receiver ESP32 --USB--> processing/ (Python on the Pi)
  radar ----------USB-->  per-side detection + radar -> alert: clear / approach / inside
                                   | WebSocket, 10 messages/s
                                   v
                          frontend/web/ (dashboard in any browser)
```

1. **firmware/**: Espressif's `esp-csi` examples. Each node broadcasts small packets with its own sender address; the hub's receiver measures the Channel State Information (CSI) of each and prints it over USB.
2. **collection/**: records CSI lines with timestamps and labels for tuning.
3. **processing/**: scores how much each side's signal is disturbed compared with an empty-zone calibration, reads the radar, decides the alert level, and serves it over WebSocket.
4. **frontend/web/**: live dashboard with a map of the triangle, zone status, strength and confidence, node health, a 60-second activity graph, an event log, and arm/disarm.

The message format between `processing/` and the dashboard is in [`docs/detection-contract.md`](docs/detection-contract.md).

## Repo layout

| Path | Purpose |
|---|---|
| `project.md` | Full project guide |
| `firmware/` | ESP32 setup notes (Espressif `esp-csi` examples) |
| `collection/` | CSI recorder |
| `processing/` | Per-side detection, radar reader, WebSocket server |
| `frontend/web/` | Dashboard (React, TypeScript, Vite) |
| `frontend/pi_display/` | Earlier PySide6 prototype, not used |
| `data/` | Recordings (gitignored except its README and captures list) |
| `docs/` | Plan, message format, results |

## Running it

| Part | Command |
|---|---|
| Firmware | `idf.py set-target esp32`, then `idf.py -p <PORT> flash monitor` in `csi_send` (each node with its own sender address) and `csi_recv` (see `project.md` section 5) |
| Recorder | `python collection/record_csi.py <label> <seconds> --port <PORT> --out data/` |
| Server | `python processing/server.py --csi <PORT>`, or replay recordings with `--csi data/<file>.csv --loop` (see `processing/README.md`) |
| Dashboard | `cd frontend/web && npm install && npm run dev`, then open it with `?mode=live` to connect to `ws://localhost:8765` |

The server currently handles one side; per-side detection for the triangle is next (see `project.md` section 10).

## Credits

- [Espressif `esp-csi`](https://github.com/espressif/esp-csi): the ESP32 sender and receiver firmware, used with the settings described in `project.md`.
- Hi-Link LD2410C radar module and its published serial protocol.
- Open-source libraries listed in each part's requirements and `package.json`.

All other code was written by the team during the competition window.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
