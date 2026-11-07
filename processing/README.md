# processing/ (Step 3: Signal Processing & Detection)

Turns raw CSI into movement detections. This is the hardest and most important step (Team A).

- **Inputs:** CSI from a capture file in `data/` (offline) or a live stream from `collection/`.
- **Outputs:** detection messages published over WebSocket, as defined in [`../docs/detection-contract.md`](../docs/detection-contract.md).

## Likely pipeline

1. Parse I/Q into per-subcarrier amplitude (and phase if useful).
2. Clean: drop bad subcarriers, smooth/filter (moving average, Hampel, low-pass).
3. Feature: variance or change over a sliding window against an empty-room baseline.
4. Decide: threshold with hysteresis into `detected` + `confidence`.
5. Stretch: direction/position from multiple RX boards.

Label captures (empty room, person walking, through wall) so thresholds can be tuned offline and replayed.

## Current detector

- `csi_io.py`: parses `CSI_DATA` lines, link stats (rate, loss from sequence numbers, RSSI), subcarrier amplitudes, Hampel filter, and the motion score.
- `detect_motion.py`: command-line tool for offline scoring, threshold calibration, and live JSON output.

The motion score is a **motion-to-noise ratio (MNR)**. Each 2 s window is split into 0.2 s bins. Fast scatter inside a bin is treated as noise, and slow drift between bins as movement. The score is the drift beyond what noise explains, divided by the noise, with the median taken over subcarriers. An empty room scores about 0 whatever the signal strength. Plain variance does not have that property: weak links look "busy" even when nothing moves.

```bash
pip install -r processing/requirements.txt
python processing/detect_motion.py data/*.csv                              # summary per file
python processing/detect_motion.py --calibrate data/empty.csv data/walk.csv # suggest a threshold
python processing/detect_motion.py data/walk.csv --json                     # contract messages
python processing/detect_motion.py --live COM6                              # live JSON lines
```

On the 2026-11-06 floor recordings, a threshold of 0.33 classified held-out windows as 100% empty / 98% walking. A person standing still in the link also scores above the threshold, so for now this detects "a person is there and moving at least a little". It needs about **15–20 pkt/s**; below about 10 pkt/s most windows can't be scored. Recalibrate whenever the boards move.

## Processing server (`server.py`)

Feeds the dashboard. It reads CSI from a recording or the receiver's serial port, runs the detector above on a sliding 2 s window, and broadcasts the message from [`../docs/detection-contract.md`](../docs/detection-contract.md) on `ws://0.0.0.0:8765` 10 times a second, to any number of dashboards.

```bash
pip install -r processing/requirements.txt

# replay a recording at its original speed (globs work, also in PowerShell)
python processing/server.py --csi data/walking_between_*.csv

# empty, then walking, forever: clear -> ALERT -> clear on the dashboard
python processing/server.py --csi data/no_movement_*.csv data/walking_between_*.csv --loop

# live from the receiver ESP32 (close idf.py monitor first)
python processing/server.py --csi COM5
```

Then open the dashboard with `?mode=live` (from another device: `?mode=live&ws=ws://<this-pc-ip>:8765`).

- **Source:** if `--csi` matches files they are replayed in order, paced by each row's `t` column; otherwise it is opened as a serial port at `--baud` (921600), and reopened every 2 s if the board is unplugged. Lines that are not `CSI_DATA` (boot messages) are skipped.
- **Detector:** Team A's `window_score` and `Hysteresis`, unchanged. `--threshold` (0.33) is the only calibration. `--hold` (0.5 s) is how long the score must stay past the threshold before `motion` flips.
- **Alert:** `inside` while `motion`, and for `--clear-after` (3 s) after it stops; otherwise `clear`. `distance_m` is `null` until the radar is added (project.md section 10).
- **Extra field:** `mnr`, the raw score, for debugging. The dashboard ignores it.
- **No data:** if no packet arrives for 1 s (replay finished, board unplugged), the server sends nothing, so the dashboard shows that data stopped instead of freezing.
- **Status line** once per second: source, packets/s, RSSI, score, alert, connected clients.

Test on 2026-11-07, replaying `no_movement` → `walking_between` → `no_movement`: 10.0 messages/s, 0 invalid, ALERT about 2 s into `walking_between`, back to clear about 4 s after it ended. The first 5 s of `no_movement` also raise a short false alarm. That comes from the recording, not the server: the summary above flags 8% of that file as movement.

## Suggested tooling

- Python 3.10+, `numpy`, `scipy`, `pandas`, `matplotlib`/Jupyter for exploration
- `scikit-learn` if a simple classifier beats thresholds
- `websockets` (or FastAPI) for the publisher
