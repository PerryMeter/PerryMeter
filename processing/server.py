"""RadarPing processing server: CSI in, detection messages out over WebSocket.

Reads CSI from a recording (replayed at its original speed) or a serial port,
runs Team A's MNR detector (csi_io.py, detect_motion.py) on a sliding 2 s
window, and broadcasts the message from docs/detection-contract.md to every
connected dashboard about 10 times a second.

Examples:
    # replay one recording
    python processing/server.py --csi data/walking_between_*.csv

    # empty -> walking -> empty, forever (good for showing the dashboard)
    python processing/server.py --csi data/no_movement_*.csv data/walking_between_*.csv --loop

    # live from the receiver ESP32
    python processing/server.py --csi COM5

Then open the dashboard with ?mode=live (or ?mode=live&ws=ws://<this-pc>:8765).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import glob
import json
import math
import os
import queue
import statistics
import sys
import threading
import time
from collections import deque

import numpy as np
from websockets.asyncio.server import broadcast, serve

from csi_io import hampel, parse_line, subcarrier_mask, window_score
from detect_motion import DEFAULT_THRESHOLD, Hysteresis
from detect_motion import message as legacy_message

STALE_S = 1.0  # stop sending if no packet arrived for this long


# --------------------------------------------------------------------------
# Sources: run in a background thread, push parsed packets onto a queue.
# Items: ("pkt", host_time, amplitudes, rssi) | ("source", name) | ("info", text) | ("end",)
# --------------------------------------------------------------------------

class PacketParser:
    """Turns raw CSI_DATA lines into normalised amplitudes (same steps as csi_io.amplitudes)."""

    def __init__(self) -> None:
        self.expected_len: int | None = None
        self.mask: np.ndarray | None = None
        self.skipped = 0

    def parse(self, line: str):
        rec = parse_line(line)
        if rec is None:
            return None
        if self.expected_len is None:
            self.expected_len = rec["len"]
            self.mask = subcarrier_mask(rec["len"] // 2)
        elif rec["len"] != self.expected_len:
            self.skipped += 1
            return None
        # The first_word garbage (first 4 values) lands on subcarriers 0-1, which the mask drops.
        iq = np.asarray(rec["csi"], dtype=np.float32)
        amp = np.abs(iq[0::2] + 1j * iq[1::2])[self.mask]
        return amp / max(float(amp.mean()), 1e-6), rec["rssi"]


def replay_files(paths: list[str], loop: bool, q: queue.Queue, stop: threading.Event) -> None:
    """Feed recorded rows at their original timing (from the recording's `t` column)."""
    while not stop.is_set():
        for path in paths:
            q.put(("source", os.path.basename(path)))
            parser = PacketParser()  # each file may have its own len
            start_wall = t0 = None
            with open(path, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    try:
                        t = float(row["t"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if start_wall is None:
                        start_wall, t0 = time.time(), t
                    delay = start_wall + (t - t0) - time.time()
                    if delay > 0 and stop.wait(delay):
                        return
                    if stop.is_set():
                        return
                    parsed = parser.parse(row.get("raw_csi", ""))
                    if parsed is not None:
                        q.put(("pkt", time.time(), *parsed))
        if not loop:
            q.put(("end",))
            return


def read_serial(port: str, baud: int, q: queue.Queue, stop: threading.Event) -> None:
    """Read CSI_DATA lines from the receiver; reconnect if the board is unplugged."""
    import serial

    q.put(("source", port))
    while not stop.is_set():
        try:
            with serial.Serial(port, baud, timeout=0.1) as ser:
                q.put(("info", f"opened {port} at {baud} baud"))
                parser = PacketParser()
                pending = b""
                while not stop.is_set():
                    pending += ser.read(max(1, ser.in_waiting))
                    *lines, pending = pending.split(b"\n")
                    now = time.time()
                    for raw in lines:
                        # non-CSI lines (boot messages after the port resets the board) are skipped
                        parsed = parser.parse(raw.decode("ascii", errors="replace"))
                        if parsed is not None:
                            q.put(("pkt", now, *parsed))
        except serial.SerialException as e:
            q.put(("info", f"{port}: {e}; retrying in 2 s"))
            stop.wait(2.0)


# --------------------------------------------------------------------------
# Detector: sliding window of packets -> score -> motion -> alert level
# --------------------------------------------------------------------------

class Detector:
    def __init__(self, threshold: float, window_s: float, hold_ticks: int, clear_after_s: float):
        self.threshold = threshold
        self.window_s = window_s
        self.clear_after_s = clear_after_s
        self.hyst = Hysteresis(threshold, hold=hold_ticks)
        self.t: deque[float] = deque()
        self.amp: deque[np.ndarray] = deque()
        self.rssi: deque[tuple[float, int]] = deque()
        self.last_motion_t = -math.inf
        self.alert = "clear"
        self.score = float("nan")

    def add(self, t: float, amp: np.ndarray, rssi: int) -> None:
        self.t.append(t)
        self.amp.append(amp)
        self.rssi.append((t, rssi))

    def reset(self) -> None:
        self.t.clear()
        self.amp.clear()
        self.rssi.clear()

    def last_packet_t(self) -> float:
        return self.t[-1] if self.t else -math.inf

    def step(self, now: float) -> dict:
        while self.t and self.t[0] < now - self.window_s:
            self.t.popleft()
            self.amp.popleft()
        while self.rssi and self.rssi[0][0] < now - 1.0:
            self.rssi.popleft()

        score = float("nan")
        if len(self.t) >= 8:
            t = np.fromiter(self.t, float)
            a = hampel(np.array(self.amp))
            score = window_score(t, a, now - self.window_s, self.window_s + 1e-3)
        self.score = score
        motion = self.hyst.update(score)

        # Wi-Fi only for now: inside while motion, and for clear_after_s after it stops.
        # Radar ("approach", distance_m) plugs in here later (project.md section 10).
        if motion:
            self.last_motion_t = now
        self.alert = "inside" if now - self.last_motion_t < self.clear_after_s else "clear"

        m = legacy_message(now, score, motion, self.threshold, "rx1")  # Team A's strength/confidence
        return {
            "t": round(now, 3),
            "motion": bool(motion),
            "strength": m["motion_score"],
            "confidence": m["confidence"],
            "alert": self.alert,
            "distance_m": None,
            "mnr": None if math.isnan(score) else round(score, 3),  # debug
        }

    def pkts_last_second(self, now: float) -> int:
        return sum(1 for t, _ in self.rssi if t >= now - 1.0)

    def rssi_median(self) -> float | None:
        return round(statistics.median(r for _, r in self.rssi)) if self.rssi else None


# --------------------------------------------------------------------------
# WebSocket server and 10 Hz loop
# --------------------------------------------------------------------------

def resolve_source(items: list[str]) -> tuple[str, list[str]]:
    """Return ("file", paths) or ("serial", [port]). Expands globs (PowerShell does not)."""
    paths: list[str] = []
    for item in items:
        matches = sorted(glob.glob(item))
        paths.extend(matches if matches else ([item] if os.path.isfile(item) else []))
    if paths:
        return "file", paths
    if len(items) == 1:
        return "serial", items
    sys.exit(f"no recordings found for: {' '.join(items)}")


async def run(args) -> None:
    kind, targets = resolve_source(args.csi)
    q: queue.Queue = queue.Queue()
    stop = threading.Event()
    if kind == "file":
        reader = threading.Thread(target=replay_files, args=(targets, args.loop, q, stop), daemon=True)
    else:
        reader = threading.Thread(target=read_serial, args=(targets[0], args.baud, q, stop), daemon=True)

    step_s = 1.0 / args.rate
    det = Detector(args.threshold, args.window, max(1, round(args.hold / step_s)), args.clear_after)
    clients: set = set()
    source_name = targets[0]
    ended = False

    async def handler(websocket):
        clients.add(websocket)
        print(f"client connected: {websocket.remote_address}", flush=True)
        try:
            await websocket.wait_closed()
        finally:
            clients.discard(websocket)
            print(f"client disconnected: {websocket.remote_address}", flush=True)

    async with serve(handler, args.host, args.port):
        print(f"listening on ws://{args.host}:{args.port}  source: {kind} {' '.join(targets)}  "
              f"threshold {args.threshold}  rate {args.rate} Hz", flush=True)
        reader.start()
        loop = asyncio.get_running_loop()
        next_tick = loop.time()
        next_status = time.time() + 1.0
        last_alert = None
        try:
            while True:
                next_tick += step_s
                delay = next_tick - loop.time()
                if delay > 0:
                    await asyncio.sleep(delay)
                else:
                    next_tick = loop.time()

                while True:
                    try:
                        item = q.get_nowait()
                    except queue.Empty:
                        break
                    if item[0] == "pkt":
                        det.add(item[1], item[2], item[3])
                    elif item[0] == "source":
                        source_name = item[1]
                        det.reset()  # do not mix windows from two recordings
                        print(f"source: {source_name}", flush=True)
                    elif item[0] == "info":
                        print(item[1], flush=True)
                    elif item[0] == "end":
                        ended = True
                        print("replay finished; server stays up (dashboard will show no data). "
                              "Ctrl+C to quit, or use --loop.", flush=True)

                now = time.time()
                if now - det.last_packet_t() > STALE_S:
                    continue  # no data: send nothing so the dashboard says so instead of freezing

                msg = det.step(now)
                if clients:
                    broadcast(clients, json.dumps(msg))
                if msg["alert"] != last_alert:
                    print(f"alert: {msg['alert']}", flush=True)
                    last_alert = msg["alert"]

                if now >= next_status:
                    next_status = now + 1.0
                    rssi = det.rssi_median()
                    score = "  -  " if math.isnan(det.score) else f"{det.score:5.2f}"
                    print(f"{source_name[:36]:36}  {det.pkts_last_second(now):3d} pkt/s  "
                          f"RSSI {rssi if rssi is not None else '-':>5} dBm  score {score}  "
                          f"alert {det.alert:6}  clients {len(clients)}", flush=True)
        finally:
            stop.set()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csi", nargs="+", required=True,
                   help="recording(s) to replay (globs ok), or a serial port such as COM5 or /dev/ttyUSB0")
    p.add_argument("--loop", action="store_true", help="replay the recordings forever")
    p.add_argument("--baud", type=int, default=921600)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--rate", type=float, default=10.0, help="messages per second")
    p.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    p.add_argument("--window", type=float, default=2.0, help="detector window, seconds")
    p.add_argument("--hold", type=float, default=0.5,
                   help="seconds the score must stay past the threshold before motion flips")
    p.add_argument("--clear-after", type=float, default=3.0,
                   help="seconds without motion before the alert returns to clear")
    args = p.parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
