"""Print the raw readings of a walk recording in a time window, every Nth message (10 messages = 1 s).

Usage: python processing/replay/raw.py <file> 22:46:50 22:47:05 [every=3]
Columns: wall time, left/right side level (0 quiet, 1.0 = threshold), the alert shown live, zone
state live, LD2410C state, hub prediction, moving cm/energy, still cm/energy, 1 s averaged
moving/still energy, NB = module said nobody (ignored by the 22:37 hub), BEY = reading past the
front line (ignored).
"""
import json
import sys

path, lo, hi = sys.argv[1], sys.argv[2], sys.argv[3]
every = int(sys.argv[4].split("=")[-1]) if len(sys.argv) > 4 else 1
n = 0
for line in open(path):
    m = json.loads(line)
    if "debug" not in m or not (lo <= m["wall"] <= hi):
        continue
    n += 1
    if (n - 1) % every:
        continue
    L = {l["id"]: (l.get("evidence") or 0.0) for l in m["debug"]["links"]}
    r = m["debug"].get("radar") or {}
    print(m["wall"], f"L {L.get('left', 0):.2f} R {L.get('right', 0):.2f}",
          f"{m['alert']:8} {m['debug']['zone']['state']:10}", f"{str(r.get('state_name')):12}",
          f"{str(r.get('prediction')):7}", "mv", r.get("moving_cm"), r.get("moving_energy"),
          "st", r.get("still_cm"), r.get("still_energy"), "avg", r.get("avg_moving"), r.get("avg_still"),
          "NB" if r.get("module_nobody") else "", "BEY" if r.get("still_beyond_front") else "")
