"""List what happened in a walk recording, as recorded (independent of the current hub code):
side crossings (level >= 1.0 after 2 s under 0.8) and every change of the alert the hub showed live.

Usage: python processing/replay/events.py processing/replay/recordings/walk_2223.jsonl [more files]
"""
import json
import sys

for path in sys.argv[1:]:
    print("==", path)
    armed, quiet_since, prev_alert = {}, {}, None
    for line in open(path):
        m = json.loads(line)
        if "debug" not in m:
            continue
        t = m["t"]
        r = m["debug"].get("radar") or {}
        for l in m["debug"]["links"]:
            s, lv = l["id"], ((l.get("evidence") or 0.0) if l["online"] else 0.0)
            if lv >= 1.0 and armed.get(s, True):
                armed[s] = False
                print(f"  {m['wall']}  CROSS {s:5} level {lv:.2f}   radar {r.get('state_name')} "
                      f"moving {r.get('moving_cm')}cm still {r.get('still_cm')}cm/e{r.get('still_energy')}")
            if lv < 0.8:
                q = quiet_since.setdefault(s, t)
                if t - q >= 2.0:
                    armed[s] = True
            else:
                quiet_since.pop(s, None)
        if m["alert"] != prev_alert:
            print(f"  {m['wall']}  alert -> {m['alert']:8} (zone state {m['debug']['zone']['state']})")
            prev_alert = m["alert"]
