# frontend/ (Step 4: Frontend & Integration)

Radar-style live UI that shows movement detections in real time (Team B).

- **Inputs:** detection messages over WebSocket (default `ws://localhost:8765`), per [`../docs/detection-contract.md`](../docs/detection-contract.md). Build first against a simulated source emitting messages in that format.
- **Outputs:** a radar sweep with blips for detections, a live motion-score indicator, connection status, and (stretch) alerts and confidence display.

## Suggested tooling

- Vite + React + TypeScript (or plain Vite) with Canvas/SVG for the radar
- A small mock WebSocket server (Node or Python) that emits fake detections for development
