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

## Suggested tooling

- Python 3.10+, `numpy`, `scipy`, `pandas`, `matplotlib`/Jupyter for exploration
- `scikit-learn` if a simple classifier beats thresholds
- `websockets` (or FastAPI) for the publisher
