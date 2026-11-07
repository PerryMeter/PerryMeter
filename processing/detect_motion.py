"""Offline (and simple live) movement detection from ESP32 CSI.

Examples:
    # score recordings and print a summary per file
    python processing/detect_motion.py data/*.csv

    # pick a threshold from an empty-room and a walking recording
    python processing/detect_motion.py --calibrate data/empty.csv data/walk.csv

    # emit detection messages (docs/detection-contract.md) as JSON lines
    python processing/detect_motion.py data/walk.csv --json

    # live from the RX board, JSON lines on stdout
    python processing/detect_motion.py --live COM6 --baud 921600
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import deque

import numpy as np

from csi_io import (amplitudes, hampel, link_stats, load_capture, motion_scores,
                    parse_line, subcarrier_mask, window_score)

DEFAULT_THRESHOLD = 0.33   # from no_movement vs walking_between, 2026-11-06
MIN_RATE_HZ = 15.0         # below this the score gets unreliable


class Hysteresis:
    """Turn on above `threshold`, off only after falling below `off_ratio * threshold`."""

    def __init__(self, threshold: float, off_ratio: float = 0.7, hold: int = 2):
        self.on, self.off, self.hold = threshold, threshold * off_ratio, hold
        self.state, self._count = False, 0

    def update(self, score: float) -> bool:
        if np.isnan(score):
            return self.state
        want = score >= self.on if not self.state else score >= self.off
        self._count = self._count + 1 if want != self.state else 0
        if self._count >= self.hold:
            self.state, self._count = want, 0
        return self.state


def message(ts: float, score: float, detected: bool, threshold: float, source: str) -> dict:
    s = 0.0 if np.isnan(score) else float(np.clip(score / (2 * threshold), 0, 1))
    conf = 0.0 if np.isnan(score) else float(np.clip(abs(score - threshold) / threshold, 0, 1))
    return {"type": "detection", "timestamp": round(ts, 3), "motion_score": round(s, 3),
            "detected": bool(detected), "confidence": round(conf, 3), "source": source}


def score_file(path: str, args):
    cap = load_capture(path)
    amp = hampel(amplitudes(cap))
    ends, scores = motion_scores(cap.t, amp, args.window, args.step)
    return cap, ends, scores


def summarize(path: str, args) -> None:
    cap, ends, scores = score_file(path, args)
    st = link_stats(cap)
    valid = scores[~np.isnan(scores)]
    print(f"\n{path}  label={cap.label!r}")
    print(f"  link: {st['packets']} packets in {st['duration_s']} s = {st['rate_hz']} pkt/s "
          f"(sender {st['sender_rate_hz']} pkt/s, delivered {st['delivered_pct']}%), "
          f"RSSI {st['rssi_median']:.0f} dBm, longest gap {st['max_gap_s']} s, "
          f"malformed {st['malformed_rows']}")
    if st["rate_hz"] < MIN_RATE_HZ:
        print(f"  WARNING: below {MIN_RATE_HZ:.0f} pkt/s - fix placement/link before trusting results")
    if not len(valid):
        print("  motion: no usable windows (too few packets)")
        return
    hyst = Hysteresis(args.threshold)
    states = [hyst.update(s) for s in scores]
    print(f"  motion score (MNR): median {np.median(valid):.2f}, p90 {np.percentile(valid, 90):.2f}; "
          f"usable windows {len(valid)}/{len(scores)}")
    print(f"  windows above threshold {args.threshold}: {np.mean(valid >= args.threshold):.0%}; "
          f"time flagged as movement: {np.mean(states):.0%}")
    if args.json:
        for e, s, d in zip(ends, scores, states):
            print(json.dumps(message(e, s, d, args.threshold, args.source)))


def calibrate(empty_path: str, moving_path: str, args) -> None:
    _, _, s0 = score_file(empty_path, args)
    _, _, s1 = score_file(moving_path, args)
    s0, s1 = s0[~np.isnan(s0)], s1[~np.isnan(s1)]
    if not len(s0) or not len(s1):
        sys.exit("calibration needs usable windows in both files (packet rate too low?)")
    grid = np.linspace(min(s0.min(), s1.min()), max(s0.max(), s1.max()), 500)
    bal = [(np.mean(s0 < g) + np.mean(s1 >= g)) / 2 for g in grid]
    best = int(np.argmax(bal))
    print(f"empty  median {np.median(s0):.2f}  p95 {np.percentile(s0, 95):.2f}")
    print(f"moving median {np.median(s1):.2f}  p5  {np.percentile(s1, 5):.2f}")
    print(f"suggested --threshold {grid[best]:.2f} (balanced accuracy {bal[best]:.1%})")


def live(args) -> None:
    import serial

    buf_t: deque = deque()
    buf_a: deque = deque()
    mask = None
    hyst = Hysteresis(args.threshold)
    next_emit = time.time() + args.window
    pending = b""
    with serial.Serial(args.live, args.baud, timeout=0.1) as port:
        while True:
            pending += port.read(max(1, port.in_waiting))
            *lines, pending = pending.split(b"\n")
            now = time.time()
            for raw in lines:
                rec = parse_line(raw.decode("ascii", errors="replace"))
                if rec is None:
                    continue
                iq = np.asarray(rec["csi"], dtype=np.float32)
                amp = np.abs(iq[0::2] + 1j * iq[1::2])
                mask = subcarrier_mask(len(amp)) if mask is None else mask
                amp = amp[mask]
                buf_t.append(now)
                buf_a.append(amp / max(amp.mean(), 1e-6))
            while buf_t and buf_t[0] < now - args.window:
                buf_t.popleft()
                buf_a.popleft()
            if now >= next_emit:
                next_emit = now + args.step
                score = float("nan")
                if len(buf_t) >= 8:
                    t = np.fromiter(buf_t, float)
                    score = window_score(t, hampel(np.array(buf_a)), now - args.window, args.window)
                print(json.dumps(message(now, score, hyst.update(score), args.threshold, args.source)),
                      flush=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("files", nargs="*", help="CSV captures from collection/record_csi.py")
    p.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    p.add_argument("--window", type=float, default=2.0, help="window length, seconds")
    p.add_argument("--step", type=float, default=0.25, help="window step, seconds")
    p.add_argument("--json", action="store_true", help="print detection messages per window")
    p.add_argument("--calibrate", nargs=2, metavar=("EMPTY", "MOVING"))
    p.add_argument("--live", metavar="PORT", help="read CSI live from a serial port")
    p.add_argument("--baud", type=int, default=921600)
    p.add_argument("--source", default="rx1")
    args = p.parse_args()
    if args.calibrate:
        calibrate(*args.calibrate, args)
    elif args.live:
        live(args)
    elif args.files:
        for f in args.files:
            summarize(f, args)
    else:
        p.print_help()


if __name__ == "__main__":
    main()
