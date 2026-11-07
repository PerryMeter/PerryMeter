# frontend/

- **`web/`**: the Perrymeter dashboard (React, TypeScript, Vite). How to run it, the Demo and Live modes, and the mock server are in `web/README.md`.
- **`pi_display/`**: an earlier PySide6 desktop prototype from the RadarPing days, kept for reference and not used.

The dashboard reads detection messages over WebSocket in the format described in [`../docs/detection-contract.md`](../docs/detection-contract.md).
