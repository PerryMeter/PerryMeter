# collection/ (Step 2: Signal Collection)

Laptop-side Python that reads CSI lines from the RX ESP32 over serial, timestamps them, and writes raw captures to `data/` (and optionally streams them to `processing/` live).

- **Inputs:** serial port (e.g. `/dev/ttyUSB0`, `COM3`) and baud rate; CSI line format from `firmware/README.md`.
- **Outputs:** raw capture files in `data/` (see `data/README.md` for naming), plus a quick sanity check: packet rate, dropped/malformed lines, subcarrier count.

## Recording

```bash
pip install -r collection/requirements.txt
python collection/record_csi.py walk_roomA 30 --port COM6 --out data/          # Windows
python collection/record_csi.py empty_roomA 60 --port /dev/ttyUSB0 --out data/  # Linux/macOS
```

`--baud` must match the RX firmware console baud (default 921600). The recorder prints packets/s, median RSSI and % lost every 5 s. Loss is measured from the sender's sequence number, so it counts packets lost over the air or on the RX board, which the script can't recover. Aim for **≥ 20 pkt/s and RSSI better than −80 dBm** before recording labelled data. Output is the same `t,label,raw_csi` CSV the first script wrote, so old captures still load.

## Suggested tooling

- Python 3.10+, `pyserial`
- `numpy` / `pandas` for quick checks, `matplotlib` for amplitude plots to verify the data is usable
