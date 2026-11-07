# RadarPing 

natHacks 2026 project (5 people, 64 hours). ESP32 boards capture Wi-Fi **Channel State Information (CSI)**, a laptop detects human movement from changes in that signal, and a radar-style UI shows detections live, ideally through walls.

> This repo is intentionally a skeleton. Per competition rules, all project code is written by the team during the official event window. See [`docs/plan.md`](docs/plan.md) for the full plan.

## Getting the code

```bash
git clone https://github.com/isr808/RadarPing.git
cd RadarPing
```

## Architecture / data flow

```
 ┌──────────────┐  Wi-Fi   ┌──────────────┐  USB serial  ┌──────────────┐  CSI files /  ┌──────────────┐  WebSocket JSON  ┌──────────────┐
 │ ESP32 (TX)   │ ───────▶ │ ESP32 (RX)   │ ───────────▶ │ collection/  │ ────────────▶ │ processing/  │ ───────────────▶ │ frontend/    │
 │ sends pings  │  packets │ extracts CSI │  CSI lines   │ capture to   │  live stream  │ motion       │  detection msgs  │ radar UI     │
 └──────────────┘          └──────────────┘              │ data/        │               │ detection    │                  └──────────────┘
      firmware/                firmware/                 └──────────────┘               └──────────────┘
```

1. **firmware/**: one ESP32 transmits packets, another receives them and prints per-packet CSI over serial.
2. **collection/**: laptop reads serial, timestamps lines, saves raw captures to `data/` and/or forwards them live.
3. **processing/**: parses CSI, filters noise, computes a motion score, decides `detected`, publishes detection messages.
4. **frontend/**: radar UI subscribes to detection messages and renders them in real time.

The processing → frontend interface is defined in [`docs/detection-contract.md`](docs/detection-contract.md), so the frontend can be built against simulated data before detection works.

## Repo layout

| Path | Purpose |
|---|---|
| `firmware/` | ESP32 firmware (ESP-IDF, CSI TX/RX) |
| `collection/` | Serial CSI capture on the laptop (Python) |
| `processing/` | Movement detection and the WebSocket publisher (Python) |
| `frontend/` | Radar-style live UI |
| `data/` | Raw captures (gitignored except its README) |
| `docs/` | Plan, interface contract, notes |

## How each part will run (planned)

| Part | Expected command (to be confirmed once written) |
|---|---|
| Firmware | `idf.py set-target esp32 && idf.py build flash monitor -p <PORT>` |
| Collection | `python -m collection --port <PORT> --out data/<capture>.csv` |
| Processing | `python -m processing --source <PORT or file> --ws-port 8765` |
| Frontend | `npm install && npm run dev`, connects to `ws://localhost:8765` |

Update this table as the real entry points land.

## Team phases

- **Phase 1 (all 5):** hardware setup and firmware (Step 1), collect and verify real CSI (Step 2).
- **Phase 2:** Team A (3) builds signal processing and detection (Step 3). Team B (2) builds the radar UI against simulated detection messages (Step 4).
- **Phase 3 (all 5):** integrate, test (including through-wall), tune accuracy, prepare the demo.

| Hours | Goal |
|---|---|
| 0–6 | Hardware setup and configuration |
| 6–14 | Collect signals, basic movement detection |
| 14–26 | Detection algorithm and frontend |
| 26–40 | Integrate the complete system |
| 40–52 | Improve accuracy, test through-wall |
| 52–64 | Debug, polish, demo, submit |

## Priorities

**Must have**
- ESP32 boards communicating
- Real Wi-Fi CSI data collected
- Working movement detection algorithm
- Live interface showing detections

**Stretch**
- Through-wall detection
- Approximate direction or position
- Confidence levels
- Alerts and improved physical design

Reliable movement detection comes first. Accurate through-wall localization is a stretch.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
