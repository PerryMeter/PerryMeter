"""Record CSI lines from the RX ESP32 to a CSV, with live link-health stats.

    python collection/record_csi.py walk_roomA 30 --port COM6
    python collection/record_csi.py empty 60 --port /dev/ttyUSB0 --baud 2000000 --out data/

Output CSV columns (same as the original script, so old files still load):
    t (host unix time), label, raw_csi (the full CSI_DATA line)

Fixes vs. the first version:
  * port/baud are arguments (baud must match the firmware console setting);
  * reads serial in chunks instead of pyserial's byte-at-a-time readline;
  * finds CSI_DATA anywhere in a line (boot logs / partial lines no longer
    hide a packet) and counts every line it discards;
  * tracks the sender sequence number, so lost packets are visible while
    recording, and prints rate + RSSI every few seconds;
  * flushes the file periodically so a crash keeps the data.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from datetime import datetime

import serial


def parse_header(line: str):
    """Return (seq, rssi, n_values) for a CSI_DATA line, or None if malformed."""
    lb, rb = line.find("["), line.rfind("]")
    if lb < 0 or rb < lb:
        return None
    head = line[:lb].rstrip(',"').split(",")
    try:
        seq, rssi, length = int(head[1]), int(head[3]), int(head[22])
    except (IndexError, ValueError):
        return None
    n_values = line.count(",", lb, rb) + 1
    if n_values != length:
        return None
    return seq, rssi, n_values


def main() -> None:
    p = argparse.ArgumentParser(description="Record ESP32 CSI to CSV")
    p.add_argument("label", help="scenario label, e.g. empty, walk, still")
    p.add_argument("duration", type=float, help="seconds to record")
    p.add_argument("--port", default="COM6")
    p.add_argument("--baud", type=int, default=921600)
    p.add_argument("--out", default=".", help="output directory")
    p.add_argument("--report-every", type=float, default=5.0, help="seconds between status lines")
    args = p.parse_args()

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{args.label}_{datetime.now():%Y%m%d_%H%M%S}.csv")

    try:
        port = serial.Serial(args.port, args.baud, timeout=0.1)
    except serial.SerialException as e:
        sys.exit(f"cannot open {args.port}: {e}")
    if hasattr(port, "set_buffer_size"):          # Windows: default driver buffer is small
        port.set_buffer_size(rx_size=1 << 20)
    port.reset_input_buffer()                     # drop stale bytes from before we started

    saved = malformed = other = 0
    first_seq = last_seq = None
    win_n, win_rssi = 0, []
    pending = b""
    start = last_report = time.monotonic()

    with port, open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["t", "label", "raw_csi"])
        while time.monotonic() - start < args.duration:
            chunk = port.read(max(1, port.in_waiting))
            if not chunk:
                continue
            now = time.time()
            pending += chunk
            *lines, pending = pending.split(b"\n")
            for raw in lines:
                line = raw.decode("ascii", errors="replace").strip()
                i = line.find("CSI_DATA,")
                if i < 0:
                    other += bool(line)
                    continue
                line = line[i:]
                info = parse_header(line)
                if info is None:
                    malformed += 1
                    continue
                seq, rssi, _ = info
                first_seq = seq if first_seq is None else first_seq
                last_seq = seq
                writer.writerow([now, args.label, line])
                saved += 1
                win_n += 1
                win_rssi.append(rssi)

            mono = time.monotonic()
            if mono - last_report >= args.report_every:
                rate = win_n / (mono - last_report)
                rssi = sorted(win_rssi)[len(win_rssi) // 2] if win_rssi else float("nan")
                sent = (last_seq - first_seq + 1) if first_seq is not None else 0
                lost = 100 * (1 - saved / sent) if sent else 0.0
                print(f"[{mono - start:5.1f}s] {rate:5.1f} pkt/s  RSSI {rssi} dBm  "
                      f"lost {lost:4.1f}%  malformed {malformed}", flush=True)
                f.flush()
                win_n, win_rssi, last_report = 0, [], mono

    sent = (last_seq - first_seq + 1) if first_seq is not None else 0
    elapsed = time.monotonic() - start
    print(f"\nPackets saved: {saved} ({saved / elapsed:.1f} pkt/s)")
    if sent:
        print(f"Sender sent ~{sent}; delivered {100 * saved / sent:.1f}% "
              f"(missing ones were lost over the air or on the RX board, not by this script)")
    print(f"Malformed CSI lines dropped: {malformed}; other (log) lines ignored: {other}")
    if saved / max(elapsed, 1e-9) < 15:
        print("WARNING: under 15 pkt/s - movement detection will be unreliable. "
              "Check RSSI (aim for better than -80 dBm), antenna orientation and placement.")
    print("File:", path)


if __name__ == "__main__":
    main()
