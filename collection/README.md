# collection/ (Step 2: Signal Collection)

Laptop-side Python that reads CSI lines from the RX ESP32 over serial, timestamps them, and writes raw captures to `data/` (and optionally streams them to `processing/` live).

- **Inputs:** serial port (e.g. `/dev/ttyUSB0`, `COM3`) and baud rate; CSI line format from `firmware/README.md`.
- **Outputs:** raw capture files in `data/` (see `data/README.md` for naming), plus a quick sanity check: packet rate, dropped/malformed lines, subcarrier count.

## Suggested tooling

- Python 3.10+, `pyserial`
- `numpy` / `pandas` for quick checks, `matplotlib` for amplitude plots to verify the data is usable
