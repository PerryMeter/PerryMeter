"""Train + honestly evaluate RadarPing experimental Wi-Fi CSI tripwire classifiers.

    python train_radarping.py --zip RadarPing_ML_Data.zip

Uses the first 3 seconds before the first crossing as quiet CSI calibration.
Train: first 109 seconds of crossings + first 30 seconds of nearby.
Test: final 69 seconds of crossings + last 30 seconds of nearby.
These are temporal holdouts, NOT independent placement/site tests.
"""
import argparse
import json
from pathlib import Path
import zipfile

import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

from radarping_core import (read_csi_csv, read_events, calibrate, extract_features,
    FEATURE_COLS, DYNAMIC_COLS, mark_sustained, alert_episodes)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', default='RadarPing_ML_Data.zip', help='ZIP produced by the recorder')
    parser.add_argument('--out', default='radarping_results', help='Output folder')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.zip) as z:
        files = z.namelist()
    crossing_member = next((f for f in files if f.startswith('crossings_') and f.endswith('.csv') and '_events' not in f), None)
    nearby_member = next((f for f in files if f.startswith('nearby_') and f.endswith('.csv') and '_events' not in f), None)
    if not crossing_member or not nearby_member:
        parser.error('ZIP must contain one crossings_*.csv and one nearby_*.csv')
    event_member = crossing_member.replace('.csv', '_events.csv')
    if event_member not in files:
        parser.error('Missing crossing event CSV: ' + event_member)
    events = read_events(args.zip, event_member)
    if len(events) < 2:
        parser.error('Need at least two correctly timestamped crossings')
    cr_data = read_csi_csv(zip_path=args.zip, member=crossing_member)
    nb_data = read_csi_csv(zip_path=args.zip, member=nearby_member)
    quiet_mask = (cr_data[0] - cr_data[0][0]) < 3.0
    if events.min() < 4.0:
        parser.error('Calibration is not quiet: a crossing is marked within the first 4 seconds.')
    chosen, base = calibrate(cr_data[1][quiet_mask])
    cr = extract_features(cr_data[0], cr_data[1], cr_data[2], chosen, base, 'crossings')
    nb = extract_features(nb_data[0], nb_data[1], nb_data[2], chosen, base, 'nearby')
    dist = np.min(np.abs(cr.sec.to_numpy()[:, None] - events[None, :]), axis=1)
    cr['label'] = np.where(dist <= 1.25, 1, np.where(dist >= 3.0, 0, -1))
    nb['label'] = 0
    # Leave a gap between training and testing. The 1.5-second feature history
    # must not pull from the training boundary into the test partition.
    first_test_marker = events[events >= 111]
    if len(first_test_marker) == 0:
        parser.error('This starter split expects crossing events after 111 seconds')
    tr = pd.concat([cr[(cr.sec < 109) & (cr.label != -1)], nb[nb.sec < 30]], ignore_index=True)
    te = pd.concat([cr[(cr.sec >= 111) & (cr.label != -1)], nb[nb.sec >= 30]], ignore_index=True)
    results = {}
    for variant, features in [('calibrated', FEATURE_COLS), ('dynamic_only', DYNAMIC_COLS)]:
        rf = RandomForestClassifier(n_estimators=250, max_depth=4, min_samples_leaf=5,
                                    class_weight='balanced', random_state=13)
        rf.fit(tr[features], tr.label)
        # Threshold is chosen ONLY using training negatives, never on held-out data.
        p_tr = rf.predict_proba(tr[features])[:, 1]
        threshold = float(np.quantile(p_tr[tr.label.to_numpy() == 0], 0.95))
        p_te = rf.predict_proba(te[features])[:, 1]
        test_auc = float(roc_auc_score(te.label, p_te))
        ap = float(average_precision_score(te.label, p_te))
        across, anear = cr.copy(), nb.copy()
        across['score'] = rf.predict_proba(across[features])[:, 1]
        anear['score'] = rf.predict_proba(anear[features])[:, 1]
        across['motion'] = mark_sustained(across, threshold)
        anear['motion'] = mark_sustained(anear, threshold)
        # Event hit means a sustained alert occurs within +-2s of marker;
        # nearby alarm episode counts are measured on held-out LAST 30s.
        cr_test = across[across.sec >= 111].copy()
        nb_test = anear[anear.sec >= 30].copy()
        hit = []
        for ev in first_test_marker:
            seen = bool(cr_test.loc[(cr_test.sec >= ev - 2) & (cr_test.sec <= ev + 2), 'motion'].any())
            hit.append(seen)
        false_alarms = alert_episodes(nb_test.motion.to_numpy())
        record = dict(variant=variant, crossing_events_tested=int(len(hit)),
                      crossing_events_detected=int(sum(hit)),
                      nearby_test_seconds=30, nearby_false_alarm_episodes=int(false_alarms),
                      nearby_flagged_seconds=float(nb_test.motion.sum() * 0.5),
                      test_auc=test_auc, test_average_precision=ap,
                      threshold=threshold,
                      selected_subcarriers=chosen.tolist(),
                      event_times_test=[float(x) for x in first_test_marker])
        results[variant] = record
        artifact = dict(model=rf, threshold=threshold, features=features,
                        chosen=chosen, baseline_shape=base, window=0.5, variant=variant,
                        strength_reference=float(max(0.01, np.quantile(tr.shape_std, .95))))
        joblib.dump(artifact, out / f'radarping_{variant}.joblib')
        across.to_csv(out / f'crossings_{variant}_scores.csv', index=False)
        anear.to_csv(out / f'nearby_{variant}_scores.csv', index=False)
        print(variant.upper(), '| Held-out crossings', sum(hit), '/', len(hit),
              '| nearby false alerts:', false_alarms, '/ 30s | AUC:', round(test_auc, 3))
        if variant == 'calibrated':
            fig, axes = plt.subplots(2, 1, figsize=(13, 7), sharex=False)
            axes[0].plot(across.sec, across.score, lw=1.2, label='ML crossing score')
            for ev in events: axes[0].axvline(ev, c='orange', lw=0.7, alpha=0.7)
            axes[0].axvspan(0, 109, color='gray', alpha=0.08, label='Training interval')
            axes[0].axvline(111, linestyle=':', c='gray')
            axes[0].axhline(threshold, ls='--', c='red', lw=1, label='Threshold')
            axes[0].set_title('Crossings: orange lines = 19 manually marked events')
            axes[0].legend(loc='upper right')
            axes[1].plot(anear.sec, anear.score, lw=1.2, label='Nearby-only ML score')
            axes[1].axvspan(0, 30, color='gray', alpha=0.08, label='Training interval')
            axes[1].axhline(threshold, ls='--', c='red', lw=1)
            axes[1].set_title('Nearby movement (no crossings)')
            for ax in axes:
                ax.set_ylim(-0.03, 1.03)
                ax.set_ylabel('RF score (not calibrated probability)')
                ax.set_xlabel('Elapsed seconds')
                ax.grid(alpha=0.2)
            fig.suptitle('RadarPing | exploratory model, SAME setup only')
            fig.tight_layout()
            fig.savefig(out / 'radarping_crossings_vs_nearby.png', dpi=150)
            plt.close(fig)
    (out / 'report.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    summary = (
        'RadarPing preliminary CSI/ML evaluation\n'
        f'Packets: {len(cr_data[0])} crossings + {len(nb_data[0])} nearby\n'
        f'Crossing markers: {len(events)}\n'
        f'Subcarriers selected on first 3 QUIET seconds of crossings recording: {chosen.tolist()}\n'
        'Train: first 109 sec of crossings + first 30 sec nearby. Test: later crossings + last 30 sec nearby.\n'
        'Window labels: positive within 1.25 sec of marker; negative >=3 sec away; ambiguous excluded.\n'
        'Event match +/- 2 sec. Two consecutive 0.5 sec windows needed to flag motion.\n\n'
    )
    for variant, r in results.items():
        summary += (f'{variant}: {r["crossing_events_detected"]}/{r["crossing_events_tested"]} '
                    f'crossings detected, {r["nearby_false_alarm_episodes"]} nearby false alerts '
                    f'in {r["nearby_test_seconds"]} sec; AUC {r["test_auc"]:.3f}; '
                    f'avg precision {r["test_average_precision"]:.3f}.\n')
    summary += ('\nCAUTIONS: Only one physical location/placement and one person/session. The positive\n'
                'event windows overlap for events 143.98s and 145.70s; 8 event hits are not 8\n'
                'independent trials. The classifier can exploit site-specific static CSI features,\n'
                'so the calibrated variant can fail after moving ESP32s. No new-layout validation.\n'
                'Scores are NOT calibrated probabilities. Do not deploy for real safety protection.\n')
    (out / 'report.txt').write_text(summary, encoding='utf-8')
    print('\n' + summary)
    print('Saved models, scores, evaluation and graph to:', out.resolve())

if __name__ == '__main__':
    main()
