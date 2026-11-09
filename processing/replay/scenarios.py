"""Scripted walk scenarios against processing/hub.py (ZoneGate, RadarLogic, Link). Expected result is in each note.
Usage: python processing/replay/scenarios.py"""
import random
import sys

import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import hub  # noqa: E402

rs = hub.rs
rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD = 20, 20


def run(title, script):
    """Rows: t, present, cm, left evidence, note[, kind]; kind "moving" (default) or "still", or a
    callable step -> (cm, kind) for readings that alternate."""
    print(f"== {title} ==")
    gate = hub.ZoneGate(enabled=False, exit_on_crossing=True)
    for i, row in enumerate(script):
        t, present, cm, ev, note = row[:5]
        kind = row[5] if len(row) > 5 else "moving"
        end = script[i + 1][0] if i + 1 < len(script) else t + 0.1
        step = t
        while step < end - 1e-9:
            c, k = kind(step) if callable(kind) else (cm, kind)
            # ev: True = a crossing (level 1.5), "stand" = someone just standing inside lifting it (0.65)
            level = 1.5 if ev is True else (0.65 if ev == "stand" else 0.0)
            # +1000: the hub's clock is wall time, and it only counts crossings after t=0
            gate.update(step + 1000, present, c if present else None, {"left": level, "right": 0.0},
                        moving_cm=c if present and k == "moving" else None)
            step = round(step + 0.1, 3)
        tracked = "ALERT" if gate.inside else ("not tracked" if gate.state == "left_zone" and present else "-")
        print(f"{t:5.1f}-{end:4.1f}s  {gate.state:10} {tracked:12} entry={gate.entry_side!s:5}  <- {note}")
    print()


# t, radar present (incl. hold), distance cm, left evidence, note
run("left in, out, round to the front, in through the front", [
    (0.0, False, None, False, "clear"),
    (0.5, False, None, True, "left stirs, radar not yet"),
    (1.0, True, 120, True, "radar sees them: ALERT from left"),
    (2.0, True, 110, False, "inside"),
    (5.0, True, 130, True, "crosses out over the left line"),
    (5.5, True, 140, False, "just outside the left line, radar still sees them: not tracked"),
    (7.0, True, 170, False, "walking round the outside towards the front"),
    (8.0, True, 200, False, "round the corner, out past the front line"),
    (9.0, True, 190, False, "stepping in through the front"),
    (9.5, True, 150, False, "inside, past 70% of the range: ALERT from base"),
    (11.0, True, 100, False, "inside"),
    (12.0, False, None, False, "gone"),
])
run("left out, stays just outside, shuffles about", [
    (0.0, False, None, True, "left stirs"),
    (0.5, True, 120, True, "in from the left: ALERT"),
    (1.0, True, 110, False, "inside"),
    (5.0, True, 120, True, "out over the left line"),
    (5.5, True, 130, False, "standing just outside"),
    (6.0, True, 115, False, "shuffles closer to the hub, still outside: not tracked"),
    (8.0, True, 160, False, "drifts farther, still under 85% of the range: not tracked"),
    (10.0, False, None, False, "walks away out of range: clear"),
])
run("seen live 22:10: standing inside lifts a side to 0.6-0.66 now and then", [
    (0.0, False, None, True, "left stirs"),
    (0.5, True, 120, True, "in from the left: ALERT"),
    (1.0, True, 110, False, "inside"),
    (4.0, True, 100, "stand", "standing still: the left reads 0.65: still ALERT"),
    (5.0, True, 100, False, "standing"),
    (7.0, True, 100, "stand", "0.65 again: still ALERT"),
    (8.0, True, 100, False, "standing"),
    (12.0, True, 100, True, "crosses out over the left (1.5): not tracked"),
    (12.5, True, 100, False, "just outside; the radar drops them now and then...", "moving"),
    (13.0, False, None, False, "...radar loses them for 1.5 s"),
    (14.5, True, 108, False, "...and finds them again just outside: still not tracked", "still"),
    (16.0, False, None, False, "gone"),
    (22.0, False, None, False, "6 s later: clear"),
])
run("seen live 22:11:20: one far moving reading right after crossing out", [
    (0.0, False, None, True, "left stirs"),
    (0.5, True, 120, True, "in from the left"),
    (1.0, True, 110, False, "inside"),
    (4.0, True, 100, True, "out over the left"),
    (4.5, True, 208, False, "one reading at 208 cm..."),
    (4.6, True, 104, False, "...then 104 cm: not a front entry, still not tracked"),
    (7.0, False, None, False, "gone"),
])
run("seen live: left out, then the still target at 190 cm and the person at 100 cm take turns", [
    (0.0, False, None, True, "left stirs"),
    (0.5, True, 120, True, "in from the left: ALERT"),
    (1.0, True, 110, False, "inside"),
    (5.0, True, 110, True, "out over the left line"),
    (5.5, True, 100, False, "outside the left line; readings alternate still 190 / moving 100: not tracked",
     lambda s: (190, "still") if int(s * 10) % 4 == 0 else (100, "moving")),
    (9.0, False, None, False, "gone: clear"),
])
run("front in and out (radar only)", [
    (0.0, True, 205, False, "appears at the front edge: ALERT from base"),
    (2.0, True, 120, False, "inside"),
    (4.0, True, 210, False, "back out through the front"),
    (5.0, False, None, False, "out of range: clear"),
])

print("== radar: a still target past the front line (seen live at 188-191 cm, nobody in the zone) ==")
for label, frame in (("still at 190 cm", (2, 0, 0, 190, 40, 190)),
                     ("still at 160 cm (inside)", (2, 0, 0, 160, 40, 160)),
                     ("moving at 205 cm (walking in)", (1, 205, 60, 205, 0, 205))):
    logic = hub.RadarLogic(approach_cm=None)
    r = logic.update(frame, frame[2], frame[4], 0.0)
    print(f"{label:30} -> {'counts (ALERT)' if r['inside'] else 'ignored'}")
print()
print("== radar hold after it stops seeing them ==")
for label, frame in (("still reading at 150 cm", (2, 0, 0, 150, 40, 150)),
                     ("moving reading at 200 cm", (1, 200, 60, 200, 0, 200))):
    logic = hub.RadarLogic(approach_cm=None)
    logic.update(frame, frame[2], frame[4], 0.0)
    out = [f"{t}s:{'in' if logic.update((0, 83, 0, 83, 3, 83), 0.0, 3.0, t)['inside'] else '-'}"
           for t in (0.5, 0.9, 1.5, 2.5, 2.9, 3.1)]
    print(f"{label:26} -> " + "  ".join(out))

print("\n== a side following the room ==")
random.seed(1)
for label, cal_base, cal_thr, live_med, live_sd in (("left (nudged: quiet 0.085)", 0.1674, 0.3348, 0.083, 0.008),
                                                    ("right (quiet 0.069)", 0.0574, 0.1148, 0.069, 0.008)):
    link = hub.Link(label, "x")
    link.threshold, link.baseline = cal_thr, cal_base
    edges_before = edges_after = 0
    prev_b = prev_a = False
    for k in range(60 * hub.SEND_RATE):
        now = k / hub.SEND_RATE
        link.score = max(0.0, random.gauss(live_med, live_sd))
        old = link.score >= hub.ENTRY_EVIDENCE * cal_thr          # the first version's level
        new = link.evidence() >= hub.ENTRY_EVIDENCE
        edges_before += old and not prev_b
        edges_after += new and not prev_a
        prev_b, prev_a = old, new
        link.follow_level(now)
    print(f"{label:28} scale x{link.scale}: threshold {link.thr():.3f}, evidence level "
          f"{link.base() + hub.ENTRY_EVIDENCE * (link.thr() - link.base()):.3f} | false edges per minute: "
          f"first version {edges_before}, now {edges_after}")
