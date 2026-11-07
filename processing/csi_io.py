"""Parse ESP32 CSI captures and turn them into a motion score.

Line format is Espressif esp-csi `csi_recv`:
    CSI_DATA,seq,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,
    aggregation,stbc,fec_coding,sgi,noise_floor,ampdu_cnt,channel,
    secondary_channel,local_timestamp,ant,sig_len,rx_state,len,first_word,"[i,q,...]"
`seq` is the sender's packet counter, so gaps in it are packets that never
made it to the PC (RF loss or serial overrun on the RX board).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field

import numpy as np

HEADER_FIELDS = [
    "type", "seq", "mac", "rssi", "rate", "sig_mode", "mcs", "bandwidth",
    "smoothing", "not_sounding", "aggregation", "stbc", "fec_coding", "sgi",
    "noise_floor", "ampdu_cnt", "channel", "secondary_channel",
    "local_timestamp", "ant", "sig_len", "rx_state", "len", "first_word",
]
INT_FIELDS = HEADER_FIELDS[3:8] + HEADER_FIELDS[14:23]


def parse_line(line: str) -> dict | None:
    """Parse one CSI_DATA line. Returns None if it is malformed."""
    start = line.find("CSI_DATA,")
    if start < 0:
        return None
    line = line[start:]
    lb, rb = line.find("["), line.rfind("]")
    if lb < 0 or rb < lb:
        return None
    head = line[:lb].rstrip(',"').split(",")
    if len(head) < len(HEADER_FIELDS) - 1:
        return None
    rec = dict(zip(HEADER_FIELDS, head))
    try:
        rec["seq"] = int(rec["seq"])
        for k in INT_FIELDS:
            rec[k] = int(rec[k])
        values = [int(v) for v in line[lb + 1:rb].split(",")]
    except (KeyError, ValueError):
        return None
    if len(values) != rec["len"] or len(values) % 2:
        return None
    rec["csi"] = values
    return rec


@dataclass
class Capture:
    t: np.ndarray                 # host time, seconds
    seq: np.ndarray
    rssi: np.ndarray
    esp_t: np.ndarray             # RX board clock, seconds (unwrapped)
    csi: np.ndarray               # (n_packets, len) raw int8 pairs
    label: str = ""
    n_bad: int = 0
    meta: dict = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.t)


def load_capture(path: str) -> Capture:
    """Load a CSV written by collection/record_csi.py (or the original script)."""
    t, recs, label, bad = [], [], "", 0
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rec = parse_line(row.get("raw_csi", ""))
            if rec is None:
                bad += 1
                continue
            if recs and rec["len"] != recs[0]["len"]:
                bad += 1
                continue
            t.append(float(row["t"]))
            label = label or row.get("label", "")
            recs.append(rec)
    if not recs:
        raise ValueError(f"{path}: no valid CSI_DATA rows")
    esp = np.array([r["local_timestamp"] for r in recs], dtype=np.float64) % 2**32
    esp = np.unwrap(esp, period=2**32) / 1e6
    meta = {k: sorted({r[k] for r in recs}) for k in
            ("mac", "channel", "secondary_channel", "bandwidth", "sig_mode", "len")}
    return Capture(
        t=np.asarray(t), seq=np.array([r["seq"] for r in recs]),
        rssi=np.array([r["rssi"] for r in recs]), esp_t=esp,
        csi=np.array([r["csi"] for r in recs], dtype=np.float32),
        label=label, n_bad=bad, meta=meta,
    )


def link_stats(cap: Capture) -> dict:
    """Packet-rate / loss summary for a capture."""
    dur = cap.t[-1] - cap.t[0] if len(cap) > 1 else 0.0
    sent = int(cap.seq[-1] - cap.seq[0] + 1)
    lag = (cap.t - cap.t[0]) - (cap.esp_t - cap.esp_t[0])
    return {
        "packets": len(cap),
        "duration_s": round(float(dur), 2),
        "rate_hz": round(float(len(cap) / dur), 1) if dur else 0.0,
        "sender_rate_hz": round(float((sent - 1) / (cap.esp_t[-1] - cap.esp_t[0])), 1) if dur else 0.0,
        "delivered_pct": round(100 * len(cap) / sent, 1),
        "max_gap_s": round(float(np.diff(cap.t).max()), 2) if len(cap) > 1 else 0.0,
        "rssi_median": float(np.median(cap.rssi)),
        "serial_backlog_max_s": round(float(lag.max() - lag.min()), 3),
        "malformed_rows": cap.n_bad,
    }


def subcarrier_mask(n_sub: int) -> np.ndarray:
    """Indices of usable subcarriers (drops DC, guards, nulls, slot 0)."""
    if n_sub == 192:   # HT40: 64 LLTF + 128 HT-LTF
        idx = list(range(6, 32)) + list(range(33, 59)) + list(range(66, 123)) + list(range(134, 191))
    elif n_sub == 128:  # HT20: 64 LLTF + 64 HT-LTF
        idx = list(range(6, 32)) + list(range(33, 59)) + list(range(70, 96)) + list(range(97, 123))
    else:               # LLTF only or unknown
        idx = [i for i in range(min(n_sub, 64)) if 6 <= i <= 58 and i != 32]
    return np.array(idx)


def amplitudes(cap: Capture) -> np.ndarray:
    """Per-packet amplitude on usable subcarriers, normalised by the packet mean.

    Normalising each packet removes the receiver's automatic gain changes,
    which otherwise look like 'motion' on every subcarrier at once.
    """
    iq = cap.csi[:, 0::2] + 1j * cap.csi[:, 1::2]
    amp = np.abs(iq)[:, subcarrier_mask(iq.shape[1])]
    return amp / np.maximum(amp.mean(axis=1, keepdims=True), 1e-6)


def hampel(x: np.ndarray, half_window: int = 5, n_sigma: float = 3.0) -> np.ndarray:
    """Replace outliers (per column) with the rolling median."""
    n = x.shape[0]
    if n < 3:
        return x.copy()
    k = min(half_window, (n - 1) // 2)
    pad = np.pad(x, ((k, k), (0, 0)), mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(pad, 2 * k + 1, axis=0)
    med = np.median(win, axis=-1)
    mad = 1.4826 * np.median(np.abs(win - med[..., None]), axis=-1)
    out = x.copy()
    bad = np.abs(x - med) > n_sigma * np.maximum(mad, 1e-6)
    out[bad] = med[bad]
    return out


def window_score(t: np.ndarray, amp: np.ndarray, start: float, window_s: float = 2.0,
                 bin_s: float = 0.2, min_bins: int = 4) -> float:
    """Motion-to-noise ratio (MNR) for packets with start <= t < start + window_s.

    Plain amplitude variance mostly measures noise, so weak links (low RSSI)
    look 'busy' even in an empty room. Instead the window is cut into short
    bins: scatter *inside* a bin is fast noise, drift *between* bins is slow
    change caused by a moving body. Per subcarrier we take
        (between-bin variance - expected noise share) / noise variance
    and return the median over subcarriers. ~0 for an empty room at any
    signal strength; well above 0 when someone moves. NaN if the window
    has fewer than `min_bins` bins holding >= 2 packets.
    """
    sel = (t >= start) & (t < start + window_s)
    tt, aa = t[sel], amp[sel]
    bins = ((tt - start) // bin_s).astype(int)
    means, ss, ns = [], [], []
    for b in np.unique(bins):
        m = aa[bins == b]
        if len(m) >= 2:
            means.append(m.mean(axis=0))
            ss.append(((m - m.mean(axis=0)) ** 2).sum(axis=0))
            ns.append(len(m))
    if len(means) < min_bins:
        return float("nan")
    ns = np.array(ns)
    noise = np.sum(ss, axis=0) / np.sum(ns - 1)
    between = np.var(np.array(means), axis=0, ddof=1)
    signal = between - noise * np.mean(1.0 / ns)
    return float(np.median(signal / np.maximum(noise, 1e-9)))


def motion_scores(t: np.ndarray, amp: np.ndarray, window_s: float = 2.0,
                  step_s: float = 0.25, bin_s: float = 0.2, min_bins: int = 4):
    """Sliding-window MNR. Returns (window_end_times, scores); NaN = too few packets."""
    ends = np.arange(t[0] + window_s, t[-1] + 1e-9, step_s)
    scores = np.array([window_score(t, amp, e - window_s, window_s, bin_s, min_bins)
                       for e in ends])
    return ends, scores
