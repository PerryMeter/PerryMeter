"""Replay a walk recording through the CURRENT processing/hub.py decision code (RadarLogic + ZoneGate).

A recording is one JSON hub message per line (10 per second), as sent to the dashboard, with the
hub's `debug` block and a "wall" clock time added by the recorder. It holds the raw radar frame and
the 1 s averaged energies, and each Wi-Fi side's level ("evidence", 0 at its quiet level, 1.0 at its
threshold) as the hub computed it at the time. So radar and zone-gate logic can be changed and
replayed; the Wi-Fi side math (Link, scores, thresholds) cannot (there is no raw CSI in these files).

Usage (from the repo root):
    python processing/replay/replay.py processing/replay/recordings/walk_2223.jsonl
    python processing/replay/replay.py <file> 22:26:30 22:27:10      # only print that time window
    python processing/replay/replay.py <file> --all                  # one line per second, not just changes

Output: one line per change of (alert then, alert now): "then" is what the hub showed live, "now"
is what the current code decides. Last line: tick counts per (then -> now) pair.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # processing/
import hub  # noqa: E402

rs = hub.rs


def alert_for(gate, present, r, links):
    """Same decision as hub.run() (keep in sync if run() changes)."""
    side_active = any(l["online"] and l["motion"] for l in links.values())
    if gate.inside:
        return "inside"
    if present and gate.state == "left_zone":
        return "approach" if side_active else "clear"
    if present:
        return "approach"          # --entry-logic only
    if side_active or (r and r["far_cm"] is not None):
        return "approach"
    return "clear"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    every_second = "--all" in sys.argv
    path = args[0]
    lo = args[1] if len(args) > 1 else "00:00:00"
    hi = args[2] if len(args) > 2 else "99:99:99"

    rows = [json.loads(line) for line in open(path)]
    rows = [m for m in rows if "debug" in m]
    first_radar = next((m["debug"]["radar"] for m in rows if m["debug"].get("radar")), None)
    if first_radar:
        # The radar thresholds the hub used then (from radar_calibration.json on the Pi)
        rs.MOVING_THRESHOLD = first_radar["moving_threshold"]
        rs.STILL_THRESHOLD = first_radar["still_threshold"]

    logic = hub.RadarLogic(approach_cm=None)
    gate = hub.ZoneGate(enabled=False, exit_on_crossing=True)
    prev, last_print, counts = None, None, {}
    for m in rows:
        d = m["debug"]
        rd = d.get("radar")
        links = {l["id"]: l for l in d["links"]}
        r = None
        if rd:
            frame = (rd["state"], rd["moving_cm"], rd["moving_energy"], rd["still_cm"], rd["still_energy"],
                     rd["detect_cm"])
            r = logic.update(frame, rd["avg_moving"], rd["avg_still"], m["t"])
        present = bool(r and r["inside"])
        levels = {s: ((l.get("evidence") or 0.0) if l["online"] else 0.0) for s, l in links.items()}
        gate.update(m["t"], present, r["inside_cm"] if r else None, levels,
                    moving_cm=r["moving_cm"] if r else None)
        alert = alert_for(gate, present, r, links)
        if not (lo <= m["wall"] <= hi):
            continue
        key = (m["alert"], alert)
        counts[key] = counts.get(key, 0) + 1
        changed = key != prev
        if changed or (every_second and m["wall"] != last_print):
            lv = " ".join(f"{s}={v:.2f}" for s, v in levels.items())
            radar = (f"{rd['state_name']:12} {r['prediction']:7} mv {rd['moving_cm']}cm/e{rd['moving_energy']} "
                     f"st {rd['still_cm']}cm/e{rd['still_energy']}") if rd else "radar: no data"
            print(f"{'>' if changed else ' '} {m['wall']}  then {m['alert']:8} now {alert:8} {gate.state:10} "
                  f"entry {str(gate.entry_side):5} | {radar} | {lv}")
            last_print = m["wall"]
        prev = key
    print("\nticks (then -> now):", {f"{a}->{b}": n for (a, b), n in sorted(counts.items())})


if __name__ == "__main__":
    main()
