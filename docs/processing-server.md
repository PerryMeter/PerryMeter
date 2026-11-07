# Processing server: what this commit adds

Branch `processing/server`, Saturday Nov 7, 2026. This is the "Option 1" step: the piece between Team A's detector and Team B's dashboard. The dashboard now shows **real recorded Wi-Fi data** instead of simulated data, with no hardware needed.

```
recording (data/*.csv)  ─┐
                         ├─> processing/server.py ──ws://0.0.0.0:8765──> dashboard (?mode=live)
receiver ESP32 (COM5)  ──┘   Team A detector, 10 msg/s
```

## What changed

| File | Change |
|---|---|
| `processing/server.py` | **New.** The processing server (details below) |
| `processing/requirements.txt` | Added `websockets>=13` |
| `processing/README.md` | New section on running the server and the test results |
| `docs/processing-server.md` | This file |

Before this commit, the branch also merged Team A's `cursor/csi-recorder-and-detection-7673` (recorder, `csi_io.py`, `detect_motion.py`) into a branch made from `main`, unchanged. The merge was clean.

## What the server does

1. **Reads CSI lines** from one or more recordings, replayed at their original speed using each row's `t` column (`--loop` repeats them), or from a serial port such as `COM5`, which it reopens if the board is unplugged.
2. **Runs Team A's detector** unchanged: the score (`window_score`) on a sliding 2 s window, then the on/off smoothing (`Hysteresis`), with threshold 0.33.
3. **Decides the alert:** `inside` while there is movement, and for 3 s after it stops; otherwise `clear`. Radar (`approach`, `distance_m`) comes later.
4. **Broadcasts** the message from `docs/detection-contract.md` 10 times a second to every connected dashboard, using the new field names (`t`, `motion`, `strength`, `confidence`, `alert`, `distance_m`) plus a debug field `mnr`.
5. **Sends nothing when no data arrives** for 1 s, so the dashboard says the data stopped instead of freezing.
6. **Prints a status line** once per second: source, packets/s, RSSI, score, alert and number of clients.

## How to run it

```bash
pip install -r processing/requirements.txt
python processing/server.py --csi data/no_movement_*.csv data/walking_between_*.csv --loop
python processing/server.py --csi COM5        # when the boards arrive
```

Open the dashboard with `?mode=live`. Recordings are not committed: unzip `RadarPing_Readings.zip` into `data/`.

## How it was tested

- **Recordings checked first** with Team A's summary. The floor recordings are usable: 40 to 52 packets/s, −72 to −80 dBm. The four desk and Wi-Fi-off recordings are not: 1 to 5 packets/s, too few to score.
- **WebSocket test client,** replaying `no_movement` → `walking_between` → `no_movement`: 10.0 messages/s, 0 invalid, longest gap between messages 0.11 s. ALERT about 2 s into the walking recording, back to clear about 4 s after it ended.
- **Dashboard in Live mode:** Connected, 10.2 msg/s, 0 invalid, ALERT with "Person in zone", events and graph updating, no console errors.

## Known limits

- The first ~5 s of `no_movement` cause a short false alarm. It's in the recording: Team A's summary flags 8% of that file as movement.
- The time back to clear is about 4 s against the 3 s target. Use `--clear-after` to tune it on the new boards.
- These recordings came from the board with no antenna. Re-record and recalibrate on the new boards before quoting any accuracy numbers.
