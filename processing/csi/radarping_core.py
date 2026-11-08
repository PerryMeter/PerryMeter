"""Experimental ESP32 CSI preprocessing for RadarPing. NOT safety-certified."""
import csv
import io
import json
from pathlib import Path
import warnings
import zipfile

import numpy as np
import pandas as pd


def read_csi_csv(path=None, zip_path=None, member=None):
    """Read RadarPing recorder CSV; returns (epoch_s, magnitude[N,192], RSSI, packet IDs).

    Supply either path=... or zip_path=... and member=....
    """
    t, mag, rssi, ids = [], [], [], []
    if zip_path is not None:
        zf = zipfile.ZipFile(zip_path)
        f = io.TextIOWrapper(zf.open(member), encoding='utf-8-sig', newline='')
    else:
        zf = None
        f = open(path, encoding='utf-8-sig', newline='')
    try:
        with f:
            for record in csv.DictReader(f):
                try:
                    row = next(csv.reader([record['raw_csi']]))
                    nums = np.asarray(json.loads(row[-1]), dtype=np.float32)
                    if len(nums) != 384 or int(row[-3]) != 384:
                        continue
                    amp = np.hypot(nums[0::2], nums[1::2])
                    # first_word_invalid means the first 4 CSI bytes are invalid:
                    # two complex I/Q pairs. Do not use them for calibration/features.
                    if row[-2] == '1':
                        amp[:2] = np.nan
                    t.append(float(record['t']))
                    mag.append(amp)
                    rssi.append(float(row[3]))
                    ids.append(int(row[1]))
                except (ValueError, KeyError, IndexError, StopIteration, json.JSONDecodeError):
                    continue
    finally:
        if zf is not None:
            zf.close()
    if not t:
        raise ValueError('No valid 384-value CSI packets in ' + str(path or member))
    return (np.asarray(t, dtype=np.float64), np.asarray(mag, dtype=np.float32),
            np.asarray(rssi, dtype=np.float32), np.asarray(ids))


def read_events(zip_path, member):
    with zipfile.ZipFile(zip_path) as z, io.TextIOWrapper(z.open(member), encoding='utf-8-sig') as f:
        return np.array([float(r['seconds_from_start']) for r in csv.DictReader(f)
                         if r.get('event') == 'crossing'], dtype=float)


def calibrate(first_quiet, number=24):
    """Rank stable high-SNR CSI indices using only known no-crossing frames."""
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        med = np.nanmedian(first_quiet, axis=0)
        std = np.nanstd(first_quiet, axis=0)
    ratio = np.divide(std, med, out=np.full_like(std, np.inf), where=med > 0)
    useful = np.where((med > 6) & (std > 0.4) & np.isfinite(med) & (ratio < 0.9))[0]
    score = med[useful] / (std[useful] + 1)
    chosen = []
    for i in useful[np.argsort(-score)]:
        if all(abs(int(i) - j) >= 3 for j in chosen):
            chosen.append(int(i))
        if len(chosen) == number:
            break
    if len(chosen) < 8:
        raise ValueError('Could not find 8 usable subcarriers; check antenna/signal and a quiet calibration period.')
    chosen = np.array(sorted(chosen), dtype=int)
    initial = first_quiet[:, chosen]
    shape = initial / np.maximum(np.nanmedian(initial, axis=1, keepdims=True), 2.0)
    return chosen, np.nanmedian(shape, axis=0)


# Features are calculated from this bin + up to 1.5 seconds of earlier packets.
# No future packets are used (so this code can later be adapted to real-time streaming).
def extract_features(t, a, rssi, chosen, baseline_shape, scenario, window=0.5):
    seconds = t - t[0]
    amp = a[:, chosen]
    shape = amp / np.maximum(np.nanmedian(amp, axis=1)[:, None], 2.0)
    rows = []
    for k in range(int(np.floor(seconds[-1] / window)) + 1):
        start = k * window
        end = start + window
        curr = np.flatnonzero((seconds >= start) & (seconds < end))
        if len(curr) < 8:
            continue
        prior = np.flatnonzero((seconds >= start - 1.5) & (seconds < start))
        xx = shape[curr]
        aa = amp[curr]
        rr = rssi[curr]
        mcurrent = np.nanmedian(xx, axis=0)
        dist = np.nanmedian(np.abs(xx - baseline_shape), axis=1)
        if len(prior) > 10:
            shape_prev = np.nanmedian(shape[prior], axis=0)
            cross_shift = np.nanmedian(np.abs(mcurrent - shape_prev))
            old_amp = np.nanmedian(amp[prior], axis=0)
            amp_shift = np.nanmedian(np.abs(np.nanmedian(aa, axis=0) - old_amp) / np.maximum(old_amp, 2))
            rssi_shift = abs(np.median(rr) - np.median(rssi[prior]))
        else:
            cross_shift = amp_shift = rssi_shift = 0.0
        lag = min(9, max(1, len(xx) // 4))
        lag2 = min(22, max(1, len(xx) // 2))
        cv = np.nanstd(aa, axis=0) / (np.nanmean(aa, axis=0) + 2)
        row = dict(
            scenario=scenario, sec=(start + end) / 2, count=len(curr),
            shape_std=np.nanmedian(np.nanstd(xx, axis=0)),
            shape_std90=np.nanpercentile(np.nanstd(xx, axis=0), 90),
            amp_cv=np.nanmedian(cv), amp_cv90=np.nanpercentile(cv, 90),
            shape_step=np.nanmedian(np.abs(np.diff(xx, axis=0))),
            shape_step90=np.nanpercentile(np.abs(np.diff(xx, axis=0)), 90),
            shape_lag=np.nanmedian(np.abs(xx[lag:] - xx[:-lag])),
            shape_lag90=np.nanpercentile(np.abs(xx[lag:] - xx[:-lag]), 90),
            shape_lag2=np.nanmedian(np.abs(xx[lag2:] - xx[:-lag2])),
            base_dist=np.nanmedian(dist), base_dist90=np.nanpercentile(dist, 90),
            shape_shift=cross_shift, amp_shift=amp_shift,
            rssi_median=np.median(rr), rssi_std=np.std(rr), rssi_shift=rssi_shift,
            amp_mean=np.nanmedian(aa), amp_spread=np.nanstd(np.nanmedian(aa, axis=1)),
        )
        rows.append(row)
    return pd.DataFrame(rows)


FEATURE_COLS = [
    'shape_std', 'shape_std90', 'amp_cv', 'amp_cv90', 'shape_step', 'shape_step90',
    'shape_lag', 'shape_lag90', 'shape_lag2', 'base_dist', 'base_dist90',
    'shape_shift', 'amp_shift', 'rssi_median', 'rssi_std', 'rssi_shift',
    'amp_mean', 'amp_spread',
]
# Ablation: remove absolute baseline/RSSI/amplitude measurements that may
# accidentally fingerprint a single recording instead of a crossing pattern.
DYNAMIC_COLS = [c for c in FEATURE_COLS if c not in
                ('base_dist', 'base_dist90', 'rssi_median', 'amp_mean', 'rssi_shift', 'amp_spread')]


def mark_sustained(df, threshold, minimum_bins=2):
    """Consecutive 0.5-second bins needed before an alert, not independent spikes."""
    flags = df['score'].to_numpy() >= threshold
    secs = df['sec'].to_numpy()
    motion = np.zeros(len(flags), dtype=bool)
    for i in range(minimum_bins - 1, len(flags)):
        if flags[i-minimum_bins+1:i+1].all() and np.diff(secs[i-minimum_bins+1:i+1]).max(initial=0) <= 0.501:
            motion[i] = True
    return motion


def alert_episodes(motion):
    motion = np.asarray(motion, dtype=bool)
    return int(np.sum(motion & ~np.r_[False, motion[:-1]]))
