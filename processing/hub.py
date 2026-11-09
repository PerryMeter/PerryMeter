"""Perrymeter hub server: sensors in, one dashboard message out.

Pick one source:
    python processing/hub.py --esp1 COM6     ESP1 hub board: Wi-Fi CSI from ESP2 and ESP3 plus the
                                             radar, all on one USB port (firmware/csi/csi_recv_esp1)
    python processing/hub.py --radar COM5    the radar alone, through the Feather bridge
                                             (firmware/radar_bridge)
    python processing/hub.py --fake-radar    simulated radar, no hardware

Options:
    --record frames.csv      save every radar frame with its time
    --record-csi csi.csv     (with --esp1) save every CSI line as t,label,raw_csi, the same format as
                             collection/record_csi.py, so Team A's tools can read it

Then open the dashboard in Live mode, for example http://localhost:5173/?mode=live
(from another computer: ?mode=live&ws=ws://<this-computer's-IP>:8765). Its Sensors panel shows
the live numbers below and has the Calibrate button.

What the dashboard gets
    alert       "inside"   the radar sees a person in range, moving or still (the rule in
                           radar_settings.py, held for HOLD_S; still readings past the front line
                           and readings the module calls "nobody" are ignored when starting to
                           track someone, but not for someone already tracked, see
                           STILL_MAX_FRACTION and STILL_JUMP_CM). With the experimental
                           --entry-logic they must also have entered (see ZoneGate).
                           With --esp1, once someone has been inside EXIT_MIN_INSIDE_S, a Wi-Fi side
                           crossing (CROSS_EVIDENCE) while the radar sees them moving
                           (EXIT_PENDING_S) means they crossed out: they are no longer tracked (the
                           radar may still see them just outside the line) until a side crosses
                           again after REENTRY_QUIET_S, they come back in through the front
                           (FRONT_OUT_FRACTION), the radar reads them at the hub
                           (CLOSE_REENTRY_CM), or the radar loses them.
                "approach" a Wi-Fi side is active (someone at a side). Nothing past the zone
                           (MAX_DISTANCE_CM) is tracked unless --approach-cm is given.
                "clear"    otherwise
    entry_side  "left", "right" or "base" (the radar's side) while inside, otherwise null
    links       one per Wi-Fi side ("left" = ESP2, "right" = ESP3): motion is "someone is at this
                side", strength is the activity score relative to that side's threshold
    nodes       hub, the Wi-Fi sides and the radar, each online while its data arrives
    motion      something is moving: a side is active or the radar sees a moving person
    strength    the highest of the side strengths and the radar movement energy, 0 to 1
    distance_m  radar distance to the person while one is detected, otherwise null
    debug       the raw numbers for the Sensors panel (the dashboard's main view ignores it)
If no sensor data arrives for STALE_S, the hub sends nothing, so the dashboard shows that the data
stopped instead of a false CLEAR.

Commands the dashboard sends over the WebSocket (one JSON object each):
    {"type": "calibrate"}                               see Calibration below
    {"type": "cancel_calibration"}
    {"type": "swap_sides"}                              rename which board is "left"
    {"type": "adjust_threshold", "side": "left", "factor": 1.25}
    {"type": "set_threshold", "side": "left", "value": 0.12}     a side's threshold, absolute
    {"type": "reset_threshold", "side": "left"}                  back to the calibrated value
    {"type": "set_radar_thresholds", "moving": 20, "still": 20}  either or both, 5 to 100
    {"type": "reset_radar_thresholds"}                           back to the calibrated values
    {"type": "set_range", "max_cm": 220}                         radar cutoff, 100 to 600 cm
The last five only move numbers the existing rules read (see DEFAULT_MAX_DISTANCE_CM); the
decision code is untouched and, untouched, they leave everything as it was.

Calibration ("calibrate" command from the dashboard, or --calibrate-on-start): after a countdown
to leave the area, the hub measures the empty zone and sets
    each Wi-Fi side's baseline    the median of its empty score (strength is 0 there)
    each Wi-Fi side's threshold   CALIBRATION_MARGIN x the 99th percentile of its empty score
                                  (the dashboard's Threshold - / + buttons then fine-tune it)
    the radar thresholds          99th percentile of the empty energy + 10, at least 20, at most
                                  100 (the same method as radar_calibrate.py)
Results are saved to processing/hub_calibration.json and radar_calibration.json (shared with
radar_plot.py and radar_server.py), and loaded again at start. Afterwards each Wi-Fi side keeps
following the room: while the radar sees nobody, its baseline and threshold are rescaled to its
quiet level over the last minute (FOLLOW_ROOM_S), so a nudged ESP or a changed room does not
leave a side too sensitive or deaf. The status line shows that scale as "(x0.51)".

Wi-Fi activity score: for each 0.5 s window, every packet's amplitudes are divided by that
packet's median amplitude (this removes automatic gain changes), and the score is the median,
over the usable subcarriers, of how much each one varies. A quiet link scores low; a person near
the link raises it.

Needs: pip install pyserial websockets numpy
"""
import argparse
import asyncio
import collections
import csv
import datetime
import json
import math
import os
import random
import sys
import threading
import time
import warnings

import numpy as np
from websockets.asyncio.server import broadcast, serve

# Omar's radar settings and frame parser live at the repo root
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)
import radar_settings as rs  # noqa: E402
from radar_server import read_frames  # noqa: E402

BAUD = 921600          # radar bridge and ESP1 both use 921600
SEND_RATE = 10         # messages per second to the dashboard
STALE_S = 1.0          # no data for this long: send nothing
ESP1_SILENT_RESET_S = 5.0   # ESP1 silent this long after opening its port: restart it
HOLD_S = 1.0           # radar presence stays on this long after the radar loses the person
# (No longer hold for still people: the walk test at 22:10 showed the radar reads someone standing
# still at energy 100. The CLEARs while standing were false "crossed out"s from the Wi-Fi.)
# A still reading only counts closer than this share of the radar's range. The zone's front line
# (between the two Wi-Fi ESPs, 2 m from the hub) is 1.73 m away in the middle, so a still target
# past about 1.75 m is someone standing just outside the front (seen live: a still target at
# 188-191 cm gave a 7.7 s ALERT with nobody in the zone). Moving readings still count out to
# MAX_DISTANCE_CM, so someone walking in from the front is caught early.
STILL_MAX_FRACTION = 0.8
# Moving readings count out to this share of the range (about 1.87 m): someone standing 0.3 m past
# the front line read 208-217 cm moving and kept flicking the ALERT on (22:28 walk test). Farther
# moving readings are still used to see someone walk round to the front (FRONT_OUT_FRACTION).
MOVING_MAX_FRACTION = 0.85
# Readings only count while the LD2410C itself sees someone (its state is not "nobody"). Added for
# weak still echoes at 69 cm with the module saying "nobody" (22:23 walk test, about 3 s of ALERT).
# Both that filter and the still-past-the-front one only apply when STARTING to track someone.
# Someone already tracked is kept through them (22:44:30-22:45:00: a person standing still at
# 145 cm read energy 30-47, the module flipped between "still" and "nobody", and its still distance
# jumped to 189-216 cm for up to 8 s while its moving slot stayed at 145; the filters dropped them
# and the ALERT flickered). A far still reading only counts as that jump when it is at least
# STILL_JUMP_CM from the last good distance (a slow walk out through the front moves a few cm per
# reading) and the moving slot still points inside the zone (walking out, the moving slot is at the
# far end), and it is held for at most STILL_JUMP_HOLD_S.
STILL_JUMP_CM = 25
STILL_JUMP_HOLD_S = 10.0
# After crossing out, the radar keeps seeing the person just outside the line, so they are not
# tracked. But the two lines meet at the hub: someone the radar reads within CLOSE_REENTRY_CM of it
# for CLOSE_REENTRY_S is at the hub, inside. Seen live at 22:46:44-52: back in near the hub without
# a clean crossing, standing at 30 cm, shown CLEAR; and the exit crossing at 22:46:52 then counted
# as a re-entry. In all three recordings nobody who had crossed out read this close otherwise.
CLOSE_REENTRY_CM = 60
CLOSE_REENTRY_S = 1.0
# Entry logic (with --esp1): the radar alone cannot tell inside from just outside a side, because
# its view (about 120 degrees) is wider than the triangle's corner (60 degrees). So "inside" needs
# an entry: a Wi-Fi side became active at most ENTRY_WINDOW_S before (or while) the radar sees the
# person, or the radar first saw them at least FAR_ENTRY_FRACTION of its range away (they came in
# through the radar's side). Seen by the radar without an entry: "approach".
ENTRY_WINDOW_S = 3.0
FAR_ENTRY_FRACTION = 0.7
# Side levels are measured from the side's quiet level: 0 there, 1.0 at its threshold. (Not from
# zero: a threshold is often just twice the quiet level, so 60% of the threshold itself sat inside
# the noise; the right side flickered over it 37 times a minute in an empty room.)
# Naming the side someone came in through only needs ENTRY_EVIDENCE: the radar already decided
# they are inside, so a weak side reading is fine for the arrow.
ENTRY_EVIDENCE = 0.6
# Crossing out (and back in after that) needs a side at CROSS_EVIDENCE, its full threshold, and it
# only counts again once the side fell below CROSS_REARM. Every point in the 2 m triangle is within
# 0.58 m of a side, so someone just standing inside lifts the sides: in the 22:10 walk test,
# standing inside reached 0.60-0.66 (each one a false "crossed out" at the old 0.6 level, so CLEAR
# while the radar saw them at energy 100), while real crossings reached 1.4-1.9.
CROSS_EVIDENCE = 1.0
CROSS_REARM = 0.8
# ...for CROSS_REARM_S in a row: one crossing comes in bursts. Seen live at 22:20: in over the left
# (1.6), under 0.8 for 1.4 s, then 1.15 again while they were still by the line inside, which was
# a false "crossed out". Their real exit came after 6 s quiet.
CROSS_REARM_S = 2.0
# Leaving: a side crossing EXIT_MIN_INSIDE_S or more after the crossing they came in by (or after
# the radar first saw them) means they crossed out. Near the hub both sides fire together on the
# way in (0.12 s apart at 22:11:43); walking straight through, in left and out right, took 1.45 s
# (22:26:58). The radar may still see them outside, so they are not tracked until a new entry. The
# side they left through only counts as an entry again after REENTRY_QUIET_S under ENTRY_EVIDENCE.
EXIT_MIN_INSIDE_S = 0.8
REENTRY_QUIET_S = 2.0
# ...and only while the radar sees the person moving: crossing a line means walking. In all three
# recordings every real exit crossing had the radar's 1 s averaged movement at 33-100 (raw energy
# 80-100 in the second before), while a person standing still inside at 145 cm lifted the left to
# 1.16 with movement 0 (22:44:54), which counted as crossing out. A crossing edge without movement
# stays pending for EXIT_PENDING_S: if the radar sees movement while the side is still over
# CROSS_REARM, they stepped out from right by the line and it is an exit after all.
EXIT_PENDING_S = 1.0
# The radar sees past the sides, so it can see someone before they cross in. If no side has crossed
# yet, the first crossing within ENTRY_GRACE_S of the radar seeing them is their way in, not out.
ENTRY_GRACE_S = 5.0
# Coming back in through the radar's side (the front, no Wi-Fi link) after crossing out: a moving
# reading at FRONT_OUT_FRACTION of its range or farther, then within FRONT_WINDOW_S a moving
# reading at FRONT_IN_FRACTION or closer. Moving readings only: the radar's still target can sit
# at the far end while the person is close (seen live), which is not someone walking in.
FRONT_OUT_FRACTION = 0.85
FRONT_IN_FRACTION = 0.7
FRONT_WINDOW_S = 3.0
# ...and they must stay out there this long: the radar's moving target can jump to the far end for
# a single reading (seen live: 104 cm, 208 cm, 104 cm), which faked a front entry
FRONT_OUT_MIN_S = 0.4
# After crossing out, the radar often loses and finds again the person standing just outside the
# line. Up to this long without them still counts as the same person outside (seen live: gaps of
# 1-2 s for about 5 s, each one a fresh "entry" before).
LEFT_ZONE_MEMORY_S = 5.0
MOTION_ON_S = 0.3      # radar: seconds of movement before motion turns on
MOTION_OFF_S = 0.7     # radar: seconds without it before motion turns off
LINK_ON_S = 0.5        # Wi-Fi side: seconds over the threshold before it counts as active
LINK_OFF_S = 0.7       # Wi-Fi side: seconds under it before it stops
# Wi-Fi activity window. 1.0 s instead of 0.5 s so slow crossings build up: on Rayhan's recordings
# 1.0 s caught 7/7 and 12/19 crossings (0.5 s: 7/7 and 11/19) with the same 0-2% false triggers.
LINK_WINDOW_S = 1.0
LINK_MIN_PACKETS = 4   # fewer packets than this in a window: no score (a side can drop to about 14/s)
LINK_OFFLINE_S = 2.0   # no packet from a side for this long: that node is offline
DEFAULT_LINK_THRESHOLD = 0.15   # used until the first calibration
DEFAULT_LINK_BASELINE = 0.03    # typical empty-zone score, used until the first calibration
# Following the room: each side's quiet level is the median of its score over the last
# FOLLOW_ROOM_S while the radar sees nobody and the side is not over its threshold. Its baseline
# and threshold are the calibrated ones scaled by (quiet level / calibrated baseline), within
# FOLLOW_SCALE, once there are FOLLOW_MIN_S of quiet. Seen live: an ESP nudged after calibrating
# went from -75 to -70 dBm and its quiet score halved, which left that side 4x too insensitive.
FOLLOW_ROOM_S = 60
FOLLOW_MIN_S = 15
FOLLOW_SCALE = (0.4, 2.5)
CALIBRATION_MARGIN = 1.5        # side threshold = this x the 99th percentile of its empty-zone score
CALIBRATION_FLOOR = 0.02
# Both Wi-Fi links end at ESP1, so someone at one side also stirs the other link. A side only
# counts as active if it is at least this share as far over its threshold as the most active side.
DOMINANCE = 0.8
# "Line blocked" is off by default (--line-blocked turns it on). Replayed on Rayhan's recording it
# did not separate crossings (AUC 0.35) and kept the side active 46% of the time: it reacts to a
# person anywhere in the room, not just on the line. Calibration still learns it, so it can be tried.
BLOCK_MARGIN = 1.5     # line-blocked threshold = this x the 99th percentile of its empty-zone value
BLOCK_FLOOR = 0.02
RADAR_THRESHOLD_REFUSE = 70   # a calibrated radar threshold this high means someone was in view (a quiet empty room gives about 20-50)
SIDE_BY_MAC = {"1a:00:00:00:00:02": "left", "1a:00:00:00:00:03": "right"}
HUB_CALIBRATION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hub_calibration.json")
# Manual settings from the dashboard's Settings panel (set_threshold, set_radar_thresholds, set_range).
# None of them changes how the hub decides: they only move the numbers the existing rules already
# read, and they are saved like a calibration. Untouched, everything stays exactly as before.
DEFAULT_MAX_DISTANCE_CM = rs.MAX_DISTANCE_CM   # 220 in radar_settings.py
RANGE_CM_LIMITS = (100, 600)                   # the LD2410C sees to about 6 m
LINK_THRESHOLD_LIMITS = (CALIBRATION_FLOOR, 2.0)
RADAR_THRESHOLD_LIMITS = (5, 100)
STATES = {0: "nobody", 1: "moving", 2: "still", 3: "moving+still"}


def now_text():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


# ---- radar input -----------------------------------------------------------
class Radar:
    """Latest radar frame plus energies averaged over rs.SMOOTH_S."""

    def __init__(self, record_path=None):
        self._lock = threading.Lock()
        self._recent = collections.deque()  # (time, moving_energy, still_energy)
        self._times = collections.deque()   # frame times over the last second, for frames/s
        self.frame, self.time = None, 0.0
        self.avg_m = self.avg_s = 0.0
        self.status = None                  # last RADAR_STATUS line from ESP1
        self._writer = self._file = None
        if record_path:
            self._file = open(record_path, "w", newline="")
            self._writer = csv.writer(self._file)
            self._writer.writerow(["t", "state", "moving_cm", "moving_energy",
                                   "still_cm", "still_energy", "detect_cm"])

    def put(self, frame):
        now = time.time()
        with self._lock:
            self.frame, self.time = frame, now
            self._times.append(now)
            while now - self._times[0] > 1.0:
                self._times.popleft()
            self._recent.append((now, frame[2], frame[4]))
            while now - self._recent[0][0] > rs.SMOOTH_S:
                self._recent.popleft()
            n = len(self._recent)
            self.avg_m = sum(r[1] for r in self._recent) / n
            self.avg_s = sum(r[2] for r in self._recent) / n
            if self._writer:
                self._writer.writerow([round(now, 3), *frame])
                if len(self._times) == 1:
                    self._file.flush()

    def get(self):
        with self._lock:
            fps = len(self._times) if self._times and time.time() - self._times[-1] < 1.0 else 0
            return self.frame, self.time, self.avg_m, self.avg_s, fps


# ---- Wi-Fi links -----------------------------------------------------------
class Link:
    """One Wi-Fi side: recent packets, two scores with their thresholds, and motion.

    score  ("activity")      how fast the signal is changing over the last 0.5 s. Good for walking,
                             weak for someone moving slowly.
    block  ("line blocked")  how different the last second's signal pattern is from the empty-zone
                             pattern saved at calibration. A person on or near the line changes the
                             pattern even when moving slowly or standing still. Needs a calibration.
    The side is over its threshold when either score is.
    """

    def __init__(self, side, mac):
        self.side, self.mac = side, mac
        self.packets = collections.deque()   # (t, rssi, amplitudes)
        self.threshold = DEFAULT_LINK_THRESHOLD
        self.baseline = DEFAULT_LINK_BASELINE
        self.calibrated = False
        self.calibrated_at = None
        self.calibrated_threshold = None   # what the last calibration set, for "reset to calibrated"
        self.score = None
        # "line blocked": empty-zone pattern (per subcarrier) and which subcarriers it uses
        self.base_shape = None
        self.base_mask = None
        self.block = None
        self.block_threshold = None
        self.block_baseline = None
        self.cur_shape = None    # last second's pattern (all subcarriers, NaN where unusable)
        self.ref_amp = None      # median amplitude per subcarrier over the last 2 s
        self.use_block = False   # --line-blocked
        self.over = False        # past a threshold (with hysteresis), before the side-vs-side check
        self.motion = False
        self._delay = Delay(LINK_ON_S, LINK_OFF_S)
        # Following the room (see FOLLOW_ROOM_S): threshold and baseline above are the calibrated
        # ones; thr() and base() are what is used now
        self.quiet_scores = collections.deque(maxlen=FOLLOW_ROOM_S * SEND_RATE)
        self.scale = 1.0
        self._scale_at = 0.0

    def thr(self):
        return self.threshold * self.scale

    def base(self):
        return self.baseline * self.scale

    def reset_follow(self):
        """Start following the room afresh (after a calibration)."""
        self.quiet_scores.clear()
        self.scale = 1.0

    def follow_level(self, now):
        """While the radar sees nobody: record the quiet score and rescale every 2 s."""
        if self.score is not None and not self.over and not self.motion:
            self.quiet_scores.append(self.score)
        if now - self._scale_at >= 2.0 and len(self.quiet_scores) >= FOLLOW_MIN_S * SEND_RATE \
                and self.baseline > 0:
            self._scale_at = now
            lo, hi = FOLLOW_SCALE
            self.scale = round(min(hi, max(lo, float(np.median(self.quiet_scores)) / self.baseline)), 3)

    def evidence(self):
        """Share of the way from the quiet level up to the threshold (1.0 = at the threshold)."""
        return 2.0 * self.strength()

    def add(self, t, rssi, amp):
        self.packets.append((t, rssi, amp))
        while self.packets and t - self.packets[0][0] > 2.0:
            self.packets.popleft()

    def update(self, now):
        """Recompute both scores and whether the side is over a threshold.
        motion itself is decided in update_links, which compares the sides."""
        recent = [p for p in self.packets if now - p[0] <= 2.0]
        window = [p for p in recent if now - p[0] <= LINK_WINDOW_S]
        last_s = [p for p in recent if now - p[0] <= 1.0]
        self.score = self.block = self.cur_shape = None
        if len(window) >= LINK_MIN_PACKETS and len(recent) >= LINK_MIN_PACKETS:
            # Subcarriers that are always NaN (first_word_invalid) are expected: no warnings for them
            with np.errstate(all="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                self.ref_amp = np.nanmedian(np.stack([p[2] for p in recent]), axis=0)
                good = np.isfinite(self.ref_amp) & (self.ref_amp > 6)
                if good.sum() >= 8:
                    a = np.stack([p[2] for p in window])[:, good]
                    shape = a / np.maximum(np.nanmedian(a, axis=1, keepdims=True), 2.0)
                    self.score = float(np.nanmedian(np.nanstd(shape, axis=0)))
                    norm_mask = self.base_mask if self.base_mask is not None else good
                    b = np.stack([p[2] for p in last_s])
                    b = b / np.maximum(np.nanmedian(b[:, norm_mask], axis=1, keepdims=True), 2.0)
                    self.cur_shape = np.nanmedian(b, axis=0)
                    if self.use_block and self.base_shape is not None:
                        m = self.base_mask
                        self.block = float(np.nanmedian(np.abs(self.cur_shape[m] - self.base_shape[m])))
        over_motion = self.score is not None and self.score >= (
            0.8 * self.thr() if self.motion else self.thr())
        over_block = (self.block is not None and self.block_threshold is not None and self.block >= (
            0.8 * self.block_threshold if self.motion else self.block_threshold))
        self.over = over_motion or over_block
        return self.score

    def follow_room(self):
        """While the zone is quiet, let the empty-zone pattern slowly follow the room (about 20 s),
        so slow changes (people moving furniture, temperature) do not turn into false alarms."""
        if (self.base_shape is None or self.cur_shape is None or self.block is None
                or self.motion or self.block >= 0.5 * self.block_threshold):
            return
        m = self.base_mask & np.isfinite(self.cur_shape)
        self.base_shape[m] = 0.995 * self.base_shape[m] + 0.005 * self.cur_shape[m]

    def relative(self):
        """How far over its thresholds the side is (1.0 = exactly at one of them)."""
        rel = 0.0 if self.score is None or self.thr() <= 0 else self.score / self.thr()
        if self.block is not None and self.block_threshold:
            rel = max(rel, self.block / self.block_threshold)
        return rel

    def stats(self, now):
        last_s = [p for p in self.packets if now - p[0] <= 1.0]
        online = bool(self.packets) and now - self.packets[-1][0] <= LINK_OFFLINE_S
        rssi = int(np.median([p[1] for p in last_s])) if last_s else None
        return online, len(last_s), rssi

    def strength(self):
        """0 at the empty-zone baseline, 0.5 at the threshold, 1 at twice that distance above it
        (the larger of the activity and line-blocked versions)."""
        best = 0.0
        if self.score is not None:
            span = max(1e-6, self.thr() - self.base())
            best = 0.5 * (self.score - self.base()) / span
        if self.block is not None and self.block_threshold and self.block_baseline is not None:
            span = max(1e-6, self.block_threshold - self.block_baseline)
            best = max(best, 0.5 * (self.block - self.block_baseline) / span)
        return max(0.0, min(1.0, best))


def update_links(links, now, quiet):
    """Score every side, then decide which sides are active. A side over its threshold only counts
    if it is at least DOMINANCE as far over as the most active side (see DOMINANCE).
    quiet: the radar sees nobody, so the empty-zone patterns may follow the room."""
    for link in links.values():
        link.update(now)
    top = max((l.relative() for l in links.values() if l.over), default=0.0)
    for link in links.values():
        want = link.over and link.relative() >= DOMINANCE * top
        link.motion = link._delay.update(want, now)
        if quiet:
            link.follow_room()
            link.follow_level(now)


class Esp1Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.line_times = collections.deque()
        self.last_line = 0.0
        self.garbled = 0

    def mark(self, now):
        with self.lock:
            self.last_line = now
            self.line_times.append(now)
            while now - self.line_times[0] > 1.0:
                self.line_times.popleft()

    def rate(self, now):
        with self.lock:
            return len(self.line_times) if now - self.last_line < 1.0 else 0


def parse_csi(line):
    """Return (mac, rssi, amplitudes) from a CSI_DATA line, or None."""
    parts = line.split(",", 24)
    if len(parts) != 25 or parts[22] != "384":
        return None
    data = parts[24].strip()
    if not (data.startswith('"[') and data.endswith(']"')):
        return None
    try:
        nums = np.array(data[2:-2].split(","), dtype=np.float32)
        rssi = int(parts[3])
    except ValueError:
        return None
    if nums.size != 384:
        return None
    amp = np.hypot(nums[0::2], nums[1::2])
    if parts[23] == "1":     # first_word_invalid: the first two I/Q pairs are not real
        amp[:2] = np.nan
    return parts[2], rssi, amp


def esp1_reader(port, baud, radar, links, links_lock, stats, csi_path):
    """Read ESP1's combined stream forever: CSI_DATA, RADAR_DATA and RADAR_STATUS lines."""
    import serial

    csi_file = open(csi_path, "a", newline="") if csi_path else None
    csi_writer = csv.writer(csi_file) if csi_file else None
    if csi_file and csi_file.tell() == 0:
        csi_writer.writerow(["t", "label", "raw_csi"])
    while True:
        try:
            ser = serial.Serial()
            ser.port, ser.baudrate, ser.timeout = port, baud, 1
            ser.dtr = False   # toggling DTR/RTS resets the ESP32
            ser.rts = False
            ser.open()
            with ser:
                print(f"ESP1: opened {port}", flush=True)
                buf = b""
                quiet_since = time.time()
                silent_resets = 0
                while True:
                    # Opening the port can leave ESP1 stuck in reset or its bootloader (seen on the
                    # Pi right after it boots). If it sends nothing for ESP1_SILENT_RESET_S, pulse EN
                    # through RTS with DTR off (a normal boot). If that does not bring it back, close
                    # and reopen the port: a fresh open is what fixed it by hand on the Pi.
                    if time.time() - max(stats.last_line, quiet_since) > ESP1_SILENT_RESET_S:
                        if silent_resets >= 1:
                            print("ESP1: still no data, reopening the port", flush=True)
                            break
                        print("ESP1: no data, restarting it", flush=True)
                        ser.dtr = False
                        ser.rts = True
                        time.sleep(0.2)
                        ser.rts = False
                        silent_resets += 1
                        quiet_since = time.time()
                    buf += ser.read(ser.in_waiting or 1)
                    *lines, buf = buf.split(b"\n")
                    for raw in lines:
                        line = raw.decode("ascii", "replace").strip()
                        now = time.time()
                        if line.startswith("CSI_DATA"):
                            parsed = parse_csi(line)
                            if parsed is None:
                                stats.garbled += 1
                                continue
                            stats.mark(now)
                            mac, rssi, amp = parsed
                            # Route by board (MAC), so swapping which side is "left" only renames
                            with links_lock:
                                link = next((l for l in links.values() if l.mac == mac), None)
                                if link is not None:
                                    link.add(now, rssi, amp)
                            if csi_writer:
                                csi_writer.writerow([round(now, 4), "hub", line])
                        elif line.startswith("RADAR_DATA"):
                            p = line.split(",")
                            if len(p) == 8 and all(x.isdigit() for x in p[1:]):
                                stats.mark(now)
                                radar.put(tuple(int(x) for x in p[2:]))
                            else:
                                stats.garbled += 1
                        elif line.startswith("RADAR_STATUS"):
                            radar.status = line
                            print(f"ESP1: {line}", flush=True)
            # Only reached after "reopening the port": give the USB chip a moment, then open again
            time.sleep(1)
        except serial.SerialException as e:
            print(f"ESP1: problem on {port}: {e} (retrying in 2 s)", flush=True)
            time.sleep(2)


def serial_reader(port, baud, radar):
    """Radar alone through the Feather bridge; reopen the port if the cable is pulled."""
    import serial

    while True:
        try:
            ser = serial.Serial()
            ser.port, ser.baudrate, ser.timeout = port, baud, 1
            ser.dtr = False
            ser.rts = False
            ser.open()
            with ser:
                print(f"Radar: opened {port}", flush=True)
                for frame in read_frames(ser):
                    radar.put(frame)
        except serial.SerialException as e:
            print(f"Radar: problem on {port}: {e} (retrying in 2 s)", flush=True)
            time.sleep(2)


def fake_reader(radar, approach_cm):
    """Simulated radar, 20 s cycle: nobody, walking in the zone, standing still, someone beyond it."""
    move_e = 100
    still_e = min(100, rs.STILL_THRESHOLD + 25)
    far_cm = rs.MAX_DISTANCE_CM + 150 if approach_cm is None else min(approach_cm, rs.MAX_DISTANCE_CM + 150)
    t0 = time.time()
    while True:
        t = (time.time() - t0) % 20
        if t < 6:
            frame = (0, 0, random.randint(0, 15), 0, random.randint(5, 20), 0)
        elif t < 11:
            d = int(rs.MAX_DISTANCE_CM * (0.45 + 0.3 * abs(((t - 6) % 2) - 1)))
            frame = (1, d, move_e, d, random.randint(20, 40), d)
        elif t < 17:
            d = int(rs.MAX_DISTANCE_CM * 0.7)
            frame = (2, d, 0, d, still_e, d)
        else:
            frame = (1, far_cm, move_e, far_cm, 0, far_cm)
        radar.put(frame)
        time.sleep(0.1)


# ---- decisions ---------------------------------------------------------------
class Delay:
    """A boolean that turns on after on_s seconds of True and off after off_s seconds of False."""

    def __init__(self, on_s, off_s):
        self.on_s, self.off_s = on_s, off_s
        self.state, self._since = False, None

    def update(self, want, now):
        if want == self.state:
            self._since = None
        else:
            if self._since is None:
                self._since = now
            if now - self._since >= (self.on_s if want else self.off_s):
                self.state, self._since = want, None
        return self.state


class RadarLogic:
    """Omar's rule (radar_settings.classify) plus the inside hold and the beyond-the-zone check."""

    def __init__(self, approach_cm):
        self.approach_cm = approach_cm
        self.motion = Delay(MOTION_ON_S, MOTION_OFF_S)
        self.last_inside_at = None   # last reading that counted or was held (HOLD_S runs from it)
        self.last_inside_cm = None
        self.last_good_at = None     # last reading that counted on its own (not held)
        self.prev_still_cm = None    # the previous frame's still distance (to see a jump)
        self.jump_since = None       # since when the still slot has sat past the front after a jump

    def far_target_cm(self, frame, avg_m, avg_s):
        """Someone beyond the zone, only when --approach-cm reaches past it (off by default:
        the radar does not track anyone past MAX_DISTANCE_CM)."""
        if self.approach_cm is None or self.approach_cm <= rs.MAX_DISTANCE_CM:
            return None
        state, m_cm, _, s_cm, _, _ = frame
        lo, hi = rs.MAX_DISTANCE_CM, self.approach_cm
        if state in (1, 3) and avg_m >= rs.MOVING_THRESHOLD and lo < m_cm <= hi:
            return m_cm
        if state in (2, 3) and avg_s >= rs.STILL_THRESHOLD and lo < s_cm <= hi:
            return s_cm
        return None

    def update(self, frame, avg_m, avg_s, now):
        _state, m_cm, _m_en, s_cm, _s_en, _d_cm = frame
        prediction, dist_cm = rs.classify(avg_m, avg_s, m_cm, s_cm)
        beyond_front = ((prediction == "still" and dist_cm > STILL_MAX_FRACTION * rs.MAX_DISTANCE_CM)
                        or (prediction == "moving" and dist_cm > MOVING_MAX_FRACTION * rs.MAX_DISTANCE_CM))
        module_sees = _state != 0
        tracking = self.last_inside_at is not None and now - self.last_inside_at < HOLD_S
        held = False   # kept through a module dropout or a still-distance jump (see STILL_JUMP_CM)
        # A jump: the still slot moved STILL_JUMP_CM or more between two frames (a walk moves it a
        # few cm per frame). It stays "jumped" while it sits past the front line.
        jumped = self.prev_still_cm is not None and abs(s_cm - self.prev_still_cm) >= STILL_JUMP_CM
        if prediction != "nothing" and not beyond_front and module_sees:
            self.last_inside_at, self.last_inside_cm, self.last_good_at = now, dist_cm, now
            self.jump_since = None
        elif prediction != "nothing" and tracking:
            if not beyond_front:
                # Module says "nobody" but the energy is still over the threshold: same person
                held, self.last_inside_cm, self.jump_since = True, dist_cm, None
            elif (prediction == "still" and m_cm <= STILL_MAX_FRACTION * rs.MAX_DISTANCE_CM
                  and (jumped or self.jump_since is not None)
                  and now - self.last_good_at < STILL_JUMP_HOLD_S):
                # The still slot jumped to the far end while the moving slot still points inside:
                # the same person at their last good distance
                held = True
                if self.jump_since is None:
                    self.jump_since = now
            else:
                self.jump_since = None
            if held:
                self.last_inside_at = now
        else:
            self.jump_since = None
        self.prev_still_cm = s_cm
        holding = self.last_inside_at is not None and now - self.last_inside_at < HOLD_S
        far_cm = None if holding else self.far_target_cm(frame, avg_m, avg_s)
        moving = self.motion.update(prediction == "moving", now)
        return {"prediction": prediction, "inside": holding,
                "inside_cm": self.last_inside_cm if holding else None,
                "moving_cm": dist_cm if prediction == "moving" and module_sees else None,
                "still_beyond_front": beyond_front,
                "module_nobody": prediction != "nothing" and not module_sees,
                "held": held,
                "far_cm": far_cm, "moving": moving}


class ZoneGate:
    """Decides whether the person the radar sees is inside the zone (see ENTRY_WINDOW_S)."""

    def __init__(self, enabled, exit_on_crossing):
        self.enabled = enabled
        self.exit_on_crossing = exit_on_crossing
        self.inside = False
        self.entry_side = None
        self.inside_since = None
        self.first_seen_cm = None
        self.present_before = False
        self.exit_at = 0.0
        self.last_rise = {}          # side -> last time its entry evidence started (ENTRY_EVIDENCE)
        self.last_cross = {}         # side -> last time it crossed (CROSS_EVIDENCE)
        self.prev_evidence = {}
        self.cross_armed = {}        # side -> quiet (CROSS_REARM_S) since its last crossing
        self.cross_quiet_since = {}  # side -> since when it has been under CROSS_REARM
        self.quiet_since = {}        # side -> since when its evidence has been low
        self.blocked = set()         # sides someone just left through (see REENTRY_QUIET_S)
        self.out_front_at = None     # after crossing out: when the radar last saw them out past the front
        self.far_since = None        # since when the moving readings have been out past the front
        self.lost_at = None          # after crossing out: when the radar lost them (LEFT_ZONE_MEMORY_S)
        self.close_since = None      # after crossing out: since when the radar reads them at the hub (CLOSE_REENTRY_CM)
        self.entry_cross_at = None   # while inside: when the crossing they came in by happened
        self.pending_exit = None     # while inside: (side, time) of a crossing edge the radar saw no movement for
        self.state = "clear"         # clear | inside | seen_no_entry | left_zone

    def reset_sides(self):
        """Forget per-side history (after the sides were renamed)."""
        self.last_rise, self.last_cross, self.prev_evidence, self.quiet_since = {}, {}, {}, {}
        self.cross_armed, self.cross_quiet_since, self.blocked = {}, {}, set()

    def update(self, now, present, dist_cm, side_level, moving_cm=None):
        """side_level: each side's level (0 at its quiet level, 1.0 at its threshold; 0 when
        offline). ENTRY_EVIDENCE edges name the entry side; CROSS_EVIDENCE edges are crossings out
        and back in. moving_cm: the radar's distance when this reading is a moving one."""
        crossed = []   # sides that just crossed (see CROSS_EVIDENCE)
        for side, level in side_level.items():
            if level >= CROSS_EVIDENCE and self.cross_armed.get(side, True):
                crossed.append(side)
                self.cross_armed[side] = False
                if side not in self.blocked:
                    self.last_cross[side] = now
            if level < CROSS_REARM:
                since = self.cross_quiet_since.setdefault(side, now)
                if now - since >= CROSS_REARM_S:
                    self.cross_armed[side] = True
            else:
                self.cross_quiet_since.pop(side, None)
            ev = level >= ENTRY_EVIDENCE
            if ev:
                self.quiet_since.pop(side, None)
                if not self.prev_evidence.get(side) and side not in self.blocked:
                    self.last_rise[side] = now
            else:
                since = self.quiet_since.setdefault(side, now)
                if side in self.blocked and now - since >= REENTRY_QUIET_S:
                    self.blocked.discard(side)
            self.prev_evidence[side] = ev

        # After crossing out: is the radar seeing them walk round to the front (no Wi-Fi link
        # there)? Out past the front line for FRONT_OUT_MIN_S, then in again soon after. Tracked
        # even while they do not count as present (moving readings that far out do not).
        front_entry = False
        if self.state == "left_zone":
            if moving_cm is not None and moving_cm >= FRONT_OUT_FRACTION * rs.MAX_DISTANCE_CM:
                if self.far_since is None:
                    self.far_since = now
                if now - self.far_since >= FRONT_OUT_MIN_S:
                    self.out_front_at = now
            else:
                self.far_since = None
                if (present and moving_cm is not None and self.out_front_at is not None
                        and now - self.out_front_at <= FRONT_WINDOW_S
                        and moving_cm <= FRONT_IN_FRACTION * rs.MAX_DISTANCE_CM):
                    front_entry = True
        # ...or standing at the hub, where the two lines meet (CLOSE_REENTRY_CM)? Then they are back
        # inside even without a clean crossing (near the hub the sides fire together or not at all).
        close_entry = False
        if self.state == "left_zone" and present and dist_cm is not None and dist_cm <= CLOSE_REENTRY_CM:
            if self.close_since is None:
                self.close_since = now
            close_entry = now - self.close_since >= CLOSE_REENTRY_S
        else:
            self.close_since = None

        if not present:
            if self.state == "left_zone":
                # Someone who crossed out and is standing just outside: the radar drops them now
                # and then. Only forget them after LEFT_ZONE_MEMORY_S.
                if self.lost_at is None:
                    self.lost_at = now
                if now - self.lost_at < LEFT_ZONE_MEMORY_S:
                    return
            self.inside, self.entry_side, self.inside_since = False, None, None
            self.first_seen_cm, self.present_before, self.state = None, False, "clear"
            self.out_front_at = self.far_since = self.lost_at = self.entry_cross_at = None
            self.close_since = self.pending_exit = None
            return
        self.lost_at = None
        if not self.present_before:
            self.first_seen_cm, self.present_before = dist_cm, True

        if self.inside:
            # A crossing only counts while the radar sees them moving (see EXIT_PENDING_S). Without
            # movement it waits a moment in case the step out is just starting; a pending crossing
            # is dropped once the side has fallen back under CROSS_REARM or the wait is over.
            radar_moving = moving_cm is not None
            if self.pending_exit is not None:
                side, since = self.pending_exit
                if now - since > EXIT_PENDING_S or side_level.get(side, 0.0) < CROSS_REARM:
                    self.pending_exit = None
                elif radar_moving and side not in crossed:
                    crossed.append(side)
            if crossed and not radar_moving:
                if self.pending_exit is None:
                    self.pending_exit = (crossed[0], now)
                crossed = []
            if self.exit_on_crossing and crossed:
                self.pending_exit = None
                if self.entry_cross_at is None and now - self.inside_since < ENTRY_GRACE_S:
                    # The radar saw them before any side crossed: this crossing is their way in
                    self.entry_side, self.entry_cross_at = crossed[0], now
                elif now - (self.entry_cross_at or self.inside_since) >= EXIT_MIN_INSIDE_S:
                    # Crossing back out. The radar may still see them outside (it has no
                    # direction), so stop tracking them.
                    self.inside, self.entry_side, self.inside_since = False, None, None
                    self.exit_at, self.first_seen_cm, self.state = now, None, "left_zone"
                    self.out_front_at = self.far_since = self.entry_cross_at = None
                    # Standing just outside keeps stirring that side: it must go quiet before it
                    # can count as a new entry, or they would be counted back in again and again
                    self.blocked.update(crossed)
                    for side in crossed:
                        self.last_rise.pop(side, None)
                        self.last_cross.pop(side, None)
            return

        recent = [(t, s) for s, t in self.last_rise.items() if now - t <= ENTRY_WINDOW_S and t > self.exit_at]
        recent_cross = [(t, s) for s, t in self.last_cross.items()
                        if now - t <= ENTRY_WINDOW_S and t > self.exit_at]
        far = self.first_seen_cm is not None and self.first_seen_cm >= FAR_ENTRY_FRACTION * rs.MAX_DISTANCE_CM
        if front_entry:
            self.inside, self.entry_side = True, "base"
        elif close_entry:
            # Back in at the hub: the arrow gets the last side that stirred, if any
            self.inside, self.entry_side = True, (max(recent)[1] if recent else None)
        elif not self.enabled and self.state != "left_zone":
            # Radar decides: anyone in range is inside. The Wi-Fi sides only name the entry side
            # (for the arrow); they never hold back an ALERT. A side that crossed names it, else
            # the front when first seen far out, else the last side that stirred.
            self.inside = True
            if recent_cross:
                self.entry_side = max(recent_cross)[1]
            else:
                self.entry_side = "base" if far else (max(recent)[1] if recent else None)
        elif self.state == "left_zone":
            # Coming back in after crossing out: a side must cross again (full threshold)
            if recent_cross:
                self.inside, self.entry_side = True, max(recent_cross)[1]
        elif recent:
            # Entry logic (--entry-logic): a side fired before or while the radar sees them
            self.inside, self.entry_side = True, max(recent)[1]
        elif far:
            self.inside, self.entry_side = True, "base"
        if self.inside:
            self.inside_since, self.state = now, "inside"
            self.close_since = self.pending_exit = None
            # The crossing they came in by (EXIT_MIN_INSIDE_S counts from it). A front or close
            # entry is the entry itself, so the next crossing is their way out
            self.entry_cross_at = (max(recent_cross)[0] if recent_cross
                                   else (now if front_entry or close_entry else None))
        elif self.state != "left_zone":
            self.state = "seen_no_entry"


# ---- calibration -------------------------------------------------------------
class Calibrator:
    """countdown -> measuring the empty zone -> done (thresholds applied and saved) or failed."""

    def __init__(self):
        self.state = "idle"
        self.until = 0.0
        self.measure_s = 15.0
        self.scores = collections.defaultdict(list)
        self.shapes = collections.defaultdict(list)
        self.radar_m, self.radar_s = [], []
        self.message = "Not calibrated in this session"
        self.results = None
        self.at = None
        # The radar thresholds the last calibration set (loaded from radar_calibration.json at start),
        # for "reset to calibrated" after a manual change
        self.radar_calibrated = (rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD)

    def start(self, now, countdown_s, measure_s):
        self.state, self.until, self.measure_s = "countdown", now + countdown_s, measure_s
        self.scores = collections.defaultdict(list)
        self.shapes = collections.defaultdict(list)
        self.radar_m, self.radar_s = [], []
        self.message = f"Leave the zone. Measuring starts in {countdown_s:g} s"
        print(f"calibration: countdown {countdown_s:g} s, then {measure_s:g} s", flush=True)

    def cancel(self):
        if self.state in ("countdown", "measuring"):
            self.state, self.message = "idle", "Calibration cancelled"
            print("calibration: cancelled", flush=True)

    def collect(self, links, radar_sample):
        for side, link in links.items():
            if link.score is not None:
                self.scores[side].append(link.score)
            if link.cur_shape is not None:
                self.shapes[side].append(link.cur_shape.copy())
        if radar_sample is not None:
            m, s = radar_sample
            self.radar_m.append(m)
            self.radar_s.append(s)

    def tick(self, now, links, radar_sample):
        if self.state == "countdown":
            if now >= self.until:
                self.state, self.until = "measuring", now + self.measure_s
                self.message = f"Measuring the empty zone for {self.measure_s:g} s. Stay out of it"
                print("calibration: measuring", flush=True)
        elif self.state == "measuring":
            self.collect(links, radar_sample)
            if now >= self.until:
                self.finish(links)

    def finish(self, links):
        results, problems = {"links": {}, "radar": None}, []
        for side, link in links.items():
            vals = self.scores.get(side, [])
            if len(vals) < 20:
                problems.append(f"{side} side: too little Wi-Fi data ({len(vals)} windows)")
                continue
            p99 = float(np.percentile(vals, 99))
            link.baseline = round(float(np.median(vals)), 4)
            link.threshold = round(max(CALIBRATION_FLOOR, CALIBRATION_MARGIN * p99, 2 * link.baseline), 4)
            link.calibrated, link.calibrated_at = True, now_text()
            link.calibrated_threshold = link.threshold
            link.reset_follow()
            results["links"][side] = {"mac": link.mac, "threshold": link.threshold,
                                      "empty_median": link.baseline,
                                      "empty_p99": round(p99, 4), "windows": len(vals)}
            # Line blocked: the empty-zone pattern, and how much it normally wanders
            shapes = self.shapes.get(side, [])
            if len(shapes) >= 20 and link.ref_amp is not None:
                with np.errstate(all="ignore"), warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    stack = np.stack(shapes)
                    base = np.nanmedian(stack, axis=0)
                    mask = np.isfinite(base) & np.isfinite(link.ref_amp) & (link.ref_amp > 6)
                    if mask.sum() >= 8:
                        blocks = np.nanmedian(np.abs(stack[:, mask] - base[mask]), axis=1)
                        link.base_shape, link.base_mask = base, mask
                        link.block_baseline = round(float(np.median(blocks)), 4)
                        bp99 = float(np.percentile(blocks, 99))
                        link.block_threshold = round(max(BLOCK_FLOOR, BLOCK_MARGIN * bp99,
                                                         2 * link.block_baseline), 4)
                        results["links"][side].update({"block_threshold": link.block_threshold,
                                                       "block_empty_median": link.block_baseline,
                                                       "block_empty_p99": round(bp99, 4)})
            if link.block_threshold is None:
                problems.append(f"{side} side: could not learn the empty-zone pattern")
        if len(self.radar_m) >= 20:
            pm = float(np.percentile(self.radar_m, 99))
            ps = float(np.percentile(self.radar_s, 99))
            mt = round(min(100, max(20, pm + 10)))
            st = round(min(100, max(20, ps + 10)))
            results["radar"] = {"moving_threshold": mt, "still_threshold": st,
                                "empty_movement_p99": round(pm, 1), "empty_stillness_p99": round(ps, 1)}
            if mt >= RADAR_THRESHOLD_REFUSE or st >= RADAR_THRESHOLD_REFUSE:
                # Someone was moving or standing in the radar's range: these thresholds would blind it
                results["radar"]["applied"] = False
                problems.append(f"radar NOT changed: someone was in its range during calibration "
                                f"(movement {pm:.0f}, stillness {ps:.0f} in an 'empty' zone). Keep everyone "
                                f"at least 3 m away and calibrate again. Still using {rs.MOVING_THRESHOLD}/"
                                f"{rs.STILL_THRESHOLD}")
            else:
                rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD = mt, st
                rs.THRESHOLD_SOURCE = f"hub calibration at {now_text()}"
                self.radar_calibrated = (mt, st)
                results["radar"]["applied"] = True
                save_radar_calibration(mt, st, pm, ps, len(self.radar_m))
        else:
            problems.append("radar: too few readings")
        save_hub_calibration(links)
        self.results, self.at = results, now_text()
        if problems and not results["links"] and results["radar"] is None:
            self.state, self.message = "failed", "; ".join(problems)
        else:
            self.state = "done"
            self.message = "Calibrated" + (". " + "; ".join(problems) if problems else "")
        print(f"calibration: {self.state}: {json.dumps(results)} {self.message}", flush=True)

    def status(self, now):
        remaining = max(0.0, self.until - now) if self.state in ("countdown", "measuring") else None
        return {"state": self.state, "remaining_s": None if remaining is None else round(remaining, 1),
                "message": self.message, "at": self.at, "results": self.results}


def apply_sides(links, side_by_mac):
    """Rename sides from a saved {mac: side} map (after "Swap left/right"). links is changed in place."""
    objs = list(links.values())
    wanted = {l.mac: side_by_mac.get(l.mac) for l in objs}
    if sorted(s for s in wanted.values() if s) != sorted(l.side for l in objs):
        return False   # incomplete or inconsistent map: keep the current names
    for l in objs:
        l.side = wanted[l.mac]
    links.clear()
    links.update({l.side: l for l in objs})
    return True


def link_calibration(l):
    entry = {"side": l.side, "calibrated": l.calibrated, "threshold": l.threshold, "baseline": l.baseline,
             "calibrated_threshold": l.calibrated_threshold}
    if l.base_shape is not None:
        entry.update({
            "block_threshold": l.block_threshold, "block_baseline": l.block_baseline,
            "base_mask": [int(i) for i in np.flatnonzero(l.base_mask)],
            "base_shape": [None if not np.isfinite(v) else round(float(v), 5) for v in l.base_shape],
        })
    return entry


def save_hub_calibration(links):
    data = {"created": now_text(), "margin": CALIBRATION_MARGIN, "max_distance_cm": rs.MAX_DISTANCE_CM,
            "links": {l.mac: link_calibration(l) for l in links.values() if l.calibrated}}
    with open(HUB_CALIBRATION_FILE, "w") as f:
        json.dump(data, f)


def save_hub_calibration_all(links):
    """Save every side's current thresholds (after a manual change), calibrated or not."""
    data = {"created": now_text(), "margin": CALIBRATION_MARGIN, "max_distance_cm": rs.MAX_DISTANCE_CM,
            "links": {l.mac: link_calibration(l) for l in links.values()}}
    with open(HUB_CALIBRATION_FILE, "w") as f:
        json.dump(data, f)


def load_hub_calibration(links):
    if not os.path.exists(HUB_CALIBRATION_FILE):
        return None
    try:
        with open(HUB_CALIBRATION_FILE) as f:
            data = json.load(f)
        apply_sides(links, {mac: e.get("side") for mac, e in data.get("links", {}).items()})
        # A radar range set from the dashboard (set_range); absent or default: nothing changes
        saved_range = data.get("max_distance_cm")
        if isinstance(saved_range, (int, float)) and RANGE_CM_LIMITS[0] <= saved_range <= RANGE_CM_LIMITS[1]:
            rs.MAX_DISTANCE_CM = int(round(saved_range))
        for link in links.values():
            entry = data.get("links", {}).get(link.mac)
            if entry:
                link.threshold = float(entry["threshold"])
                link.calibrated = bool(entry.get("calibrated", True))
                link.baseline = float(entry.get("baseline", DEFAULT_LINK_BASELINE))
                link.calibrated_at = data.get("created")
                saved_cal = entry.get("calibrated_threshold")
                if isinstance(saved_cal, (int, float)):
                    link.calibrated_threshold = float(saved_cal)
                elif link.calibrated:
                    link.calibrated_threshold = link.threshold   # older file: the best we have
                if entry.get("base_shape") and entry.get("block_threshold"):
                    shape = np.array([np.nan if v is None else v for v in entry["base_shape"]], dtype=float)
                    mask = np.zeros(shape.size, dtype=bool)
                    mask[[i for i in entry.get("base_mask", []) if 0 <= i < shape.size]] = True
                    if mask.sum() >= 8:
                        link.base_shape, link.base_mask = shape, mask
                        link.block_threshold = float(entry["block_threshold"])
                        link.block_baseline = float(entry.get("block_baseline", 0.0))
        return data.get("created")
    except (OSError, ValueError, KeyError) as e:
        print(f"Could not read {HUB_CALIBRATION_FILE} ({e}); using the default thresholds.", flush=True)
        return None


def save_radar_calibration(mt, st, pm, ps, n, manual=False):
    """Write radar_calibration.json. pm/ps are None for a manual setting (no empty-room measurement)."""
    data = {"moving_threshold": mt, "still_threshold": st, "created": now_text(),
            "readings": n, "empty_room_movement_p99": None if pm is None else round(pm, 1),
            "empty_room_stillness_p99": None if ps is None else round(ps, 1),
            "margin": 10, "floor": 20, "distance_range_cm": [rs.MIN_DISTANCE_CM, rs.MAX_DISTANCE_CM],
            "source": "processing/hub.py (manual setting)" if manual else "processing/hub.py"}
    with open(rs.CALIBRATION_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ---- the WebSocket server ------------------------------------------------------
async def run(args):
    radar = Radar(args.record)
    links = {side: Link(side, mac) for mac, side in SIDE_BY_MAC.items()} if args.esp1 else {}
    for link in links.values():
        link.use_block = args.line_blocked
    links_lock = threading.Lock()
    esp1 = Esp1Stats()
    calibrator = Calibrator()
    if args.esp1:
        when = load_hub_calibration(links)
        if when:
            calibrator.message, calibrator.at = f"Using the calibration from {when}", when
        target, targs = esp1_reader, (args.esp1, args.baud, radar, links, links_lock, esp1, args.record_csi)
    elif args.fake_radar:
        target, targs = fake_reader, (radar, args.approach_cm)
        print("Radar: SIMULATED data", flush=True)
    else:
        target, targs = serial_reader, (args.radar, args.baud, radar)
    threading.Thread(target=target, args=targs, daemon=True).start()
    logic = RadarLogic(args.approach_cm)
    # Entry logic needs the Wi-Fi sides, so it only applies with --esp1
    # Off by default: in the second live test it dropped people who were inside to APPROACH
    gate = ZoneGate(enabled=bool(args.esp1) and args.entry_logic,
                    exit_on_crossing=not args.no_exit_on_crossing)
    loop_start = time.time()
    if args.calibrate_on_start:
        calibrator.start(time.time(), args.countdown, args.calibration_seconds)

    async def handler(websocket):
        async for raw in websocket:
            try:
                cmd = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if not isinstance(cmd, dict):
                continue
            if cmd.get("type") == "calibrate":
                countdown = float(cmd.get("countdown_s", args.countdown))
                seconds = float(cmd.get("seconds", args.calibration_seconds))
                calibrator.start(time.time(), min(max(countdown, 0), 30), min(max(seconds, 5), 60))
            elif cmd.get("type") == "cancel_calibration":
                calibrator.cancel()
            elif cmd.get("type") == "swap_sides":
                # The boards stay the same; only which one is called "left" changes (saved)
                with links_lock:
                    if "left" in links and "right" in links:
                        a, b = links["left"], links["right"]
                        a.side, b.side = "right", "left"
                        links["left"], links["right"] = b, a
                        gate.reset_sides()
                        save_hub_calibration_all(links)
                        print(f"sides swapped: left = {links['left'].mac}, right = {links['right'].mac}",
                              flush=True)
            elif cmd.get("type") == "adjust_threshold":
                # {"type": "adjust_threshold", "side": "left", "factor": 1.25}: raise or lower one side
                side, factor = cmd.get("side"), cmd.get("factor")
                if side in links and isinstance(factor, (int, float)) and 0.5 <= factor <= 2.0:
                    with links_lock:
                        link = links[side]
                        link.threshold = round(max(CALIBRATION_FLOOR, link.threshold * factor,
                                                   link.baseline * 1.2), 4)
                        if link.block_threshold is not None:
                            link.block_threshold = round(max(BLOCK_FLOOR, link.block_threshold * factor,
                                                             (link.block_baseline or 0) * 1.2), 4)
                        save_hub_calibration_all(links)
                    print(f"threshold: {side} set to {link.threshold} (line blocked {link.block_threshold})",
                          flush=True)
            elif cmd.get("type") == "set_threshold":
                # {"type": "set_threshold", "side": "left", "value": 0.12}: one side's threshold, as a
                # number (the Settings panel's slider). Same floor as adjust_threshold.
                side, value = cmd.get("side"), cmd.get("value")
                if side in links and isinstance(value, (int, float)) and math.isfinite(value):
                    lo, hi = LINK_THRESHOLD_LIMITS
                    with links_lock:
                        link = links[side]
                        link.threshold = round(min(hi, max(lo, link.baseline * 1.2, float(value))), 4)
                        save_hub_calibration_all(links)
                    print(f"threshold: {side} set to {link.threshold}", flush=True)
            elif cmd.get("type") == "reset_threshold":
                # {"type": "reset_threshold", "side": "left"}: back to what the last calibration set
                side = cmd.get("side")
                if side in links and links[side].calibrated_threshold is not None:
                    with links_lock:
                        links[side].threshold = links[side].calibrated_threshold
                        save_hub_calibration_all(links)
                    print(f"threshold: {side} reset to {links[side].threshold}", flush=True)
            elif cmd.get("type") == "set_radar_thresholds":
                # {"type": "set_radar_thresholds", "moving": 20, "still": 20}: either or both, 5 to 100
                lo, hi = RADAR_THRESHOLD_LIMITS
                changed = False
                for key, attr in (("moving", "MOVING_THRESHOLD"), ("still", "STILL_THRESHOLD")):
                    v = cmd.get(key)
                    if isinstance(v, (int, float)) and math.isfinite(v):
                        setattr(rs, attr, int(round(min(hi, max(lo, v)))))
                        changed = True
                if changed:
                    rs.THRESHOLD_SOURCE = f"manual setting at {now_text()}"
                    save_radar_calibration(rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD, None, None, 0, manual=True)
                    print(f"radar thresholds set to {rs.MOVING_THRESHOLD}/{rs.STILL_THRESHOLD}", flush=True)
            elif cmd.get("type") == "reset_radar_thresholds":
                rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD = calibrator.radar_calibrated
                rs.THRESHOLD_SOURCE = f"calibrated values, restored at {now_text()}"
                save_radar_calibration(rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD, None, None, 0)
                print(f"radar thresholds reset to {rs.MOVING_THRESHOLD}/{rs.STILL_THRESHOLD}", flush=True)
            elif cmd.get("type") == "set_range":
                # {"type": "set_range", "max_cm": 220}: the radar cutoff (MAX_DISTANCE_CM). The front-line
                # limits are fractions of it, so they follow. Missing max_cm: back to the default.
                v = cmd.get("max_cm", DEFAULT_MAX_DISTANCE_CM)
                if isinstance(v, (int, float)) and math.isfinite(v):
                    lo, hi = RANGE_CM_LIMITS
                    rs.MAX_DISTANCE_CM = int(round(min(hi, max(lo, v))))
                    with links_lock:
                        save_hub_calibration_all(links)
                    print(f"range: radar counts targets up to {rs.MAX_DISTANCE_CM} cm", flush=True)

    async with serve(handler, args.host, args.port) as server:
        print(f"Perrymeter hub on ws://{args.host}:{args.port} (Ctrl+C to stop)", flush=True)
        print(f"Radar rule: moving if movement >= {rs.MOVING_THRESHOLD}, else still if stillness >= "
              f"{rs.STILL_THRESHOLD}; zone {rs.MIN_DISTANCE_CM}-{rs.MAX_DISTANCE_CM} cm; thresholds from "
              f"{rs.THRESHOLD_SOURCE}.", flush=True)
        for link in links.values():
            print(f"Wi-Fi {link.side} = {link.mac}, threshold {link.threshold}"
                  f"{'' if link.calibrated else ' (default, not calibrated)'}", flush=True)
        last_status, last_alert = time.time(), None
        while True:
            await asyncio.sleep(1.0 / args.rate)
            now = time.time()
            frame, frame_time, avg_m, avg_s, radar_fps = radar.get()
            radar_fresh = frame is not None and now - frame_time <= STALE_S

            r = logic.update(frame, avg_m, avg_s, now) if radar_fresh else None

            with links_lock:
                # The empty-zone patterns only follow the room while the radar sees nobody
                # and no calibration is running
                quiet = radar_fresh and not r["inside"] and calibrator.state not in ("countdown", "measuring")
                update_links(links, now, quiet)
                link_info = {s: (l.stats(now), l.score, round(l.thr(), 4), l.calibrated, l.motion, l.strength(),
                                 round(l.base(), 4), l.block, l.block_threshold, l.relative(), l.evidence(),
                                 l.scale)
                             for s, l in links.items()}
            radar_sample = None
            if radar_fresh:
                m_in = avg_m if rs.MIN_DISTANCE_CM <= frame[1] <= rs.MAX_DISTANCE_CM else 0.0
                s_in = avg_s if rs.MIN_DISTANCE_CM <= frame[3] <= rs.MAX_DISTANCE_CM else 0.0
                radar_sample = (m_in, s_in)
            calibrator.tick(now, links, radar_sample)

            side_active = [s for s, info in link_info.items() if info[0][0] and info[4]]
            radar_present = bool(r and r["inside"])
            gate.update(now, radar_present, r["inside_cm"] if r else None,
                        {s: (info[10] if info[0][0] else 0.0) for s, info in link_info.items()},
                        moving_cm=r["moving_cm"] if r else None)

            any_link_fresh = any(info[0][0] for info in link_info.values())
            if not radar_fresh and not any_link_fresh:
                msg = None
            else:
                if gate.inside:
                    alert, distance_cm = "inside", r["inside_cm"] if r else None
                elif radar_present and gate.state == "left_zone":
                    # They crossed out through a side: the radar still sees them outside the line,
                    # so stop tracking them (no ALERT, no distance) until they come back in
                    alert, distance_cm = ("approach" if side_active else "clear"), None
                elif radar_present:
                    # --entry-logic only: the radar sees someone who has not entered
                    alert, distance_cm = "approach", r["inside_cm"]
                elif side_active or (r and r["far_cm"] is not None):
                    alert, distance_cm = "approach", (r["far_cm"] if r else None)
                else:
                    alert, distance_cm = "clear", None
                # 0.5 at the radar's movement threshold, like the Wi-Fi sides
                radar_strength = min(1.0, avg_m / (2 * rs.MOVING_THRESHOLD)) if radar_fresh else 0.0
                strengths = [info[5] for info in link_info.values() if info[0][0]] + [radar_strength]
                strength = max(strengths)
                motion = bool(side_active) or bool(r and r["moving"])
                margin = min(1.0, abs(avg_m - rs.MOVING_THRESHOLD) / rs.MOVING_THRESHOLD) if radar_fresh else 0.0
                agrees = (avg_m >= rs.MOVING_THRESHOLD) == bool(r and r["moving"])
                confidence = 0.5 + 0.5 * margin if radar_fresh and agrees else 0.5

                msg = {
                    "t": round(now, 3),
                    "motion": motion,
                    "strength": round(strength, 3),
                    "confidence": round(confidence, 3),
                    "alert": alert,
                    "distance_m": round(distance_cm / 100, 2) if distance_cm is not None else None,
                    "entry_side": gate.entry_side if gate.inside else None,
                    "nodes": [{"id": "hub", "online": True}]
                             + [{"id": s, "online": info[0][0]} for s, info in link_info.items()]
                             + [{"id": "radar", "online": radar_fresh}],
                    "debug": {
                        "source": "esp1" if args.esp1 else ("fake-radar" if args.fake_radar else "radar-bridge"),
                        "uptime_s": round(now - loop_start),
                        "links": [{"id": s, "mac": links[s].mac, "online": info[0][0], "pps": info[0][1],
                                   "rssi": info[0][2],
                                   "score": None if info[1] is None else round(info[1], 4),
                                   "threshold": info[2], "baseline": info[6],
                                   "block": None if info[7] is None else round(info[7], 4),
                                   "block_threshold": info[8],
                                   "calibrated": info[3], "motion": info[4],
                                   "evidence": round(info[10], 3), "follow_scale": info[11],
                                   "calibrated_threshold": links[s].calibrated_threshold}
                                  for s, info in link_info.items()],
                        "radar": None if not radar_fresh else {
                            "fps": radar_fps, "state": frame[0], "state_name": STATES.get(frame[0], str(frame[0])),
                            "moving_cm": frame[1], "moving_energy": frame[2], "still_cm": frame[3],
                            "still_energy": frame[4], "detect_cm": frame[5],
                            "avg_moving": round(avg_m, 1), "avg_still": round(avg_s, 1),
                            "moving_threshold": rs.MOVING_THRESHOLD, "still_threshold": rs.STILL_THRESHOLD,
                            "zone_cm": [rs.MIN_DISTANCE_CM, rs.MAX_DISTANCE_CM],
                            "prediction": r["prediction"], "still_beyond_front": r["still_beyond_front"],
                            "module_nobody": r["module_nobody"], "held": r["held"],
                            "status": radar.status},
                        "esp1": {"lines_per_s": esp1.rate(now), "garbled": esp1.garbled} if args.esp1 else None,
                        "calibration": calibrator.status(now),
                        "zone": {"state": gate.state, "entry_side": gate.entry_side,
                                 "entry_logic": gate.enabled, "exit_on_crossing": gate.exit_on_crossing,
                                 "blocked_sides": sorted(gate.blocked)},
                        # The numbers the Settings panel shows and adjusts (see set_range and friends)
                        "settings": {
                            "baud": args.baud, "baud_fixed": True,
                            "max_distance_cm": rs.MAX_DISTANCE_CM,
                            "default_max_distance_cm": DEFAULT_MAX_DISTANCE_CM,
                            "range_limits_cm": list(RANGE_CM_LIMITS),
                            "still_max_cm": round(STILL_MAX_FRACTION * rs.MAX_DISTANCE_CM),
                            "moving_max_cm": round(MOVING_MAX_FRACTION * rs.MAX_DISTANCE_CM),
                            "far_entry_cm": round(FAR_ENTRY_FRACTION * rs.MAX_DISTANCE_CM),
                            "moving_threshold": rs.MOVING_THRESHOLD, "still_threshold": rs.STILL_THRESHOLD,
                            "calibrated_moving_threshold": calibrator.radar_calibrated[0],
                            "calibrated_still_threshold": calibrator.radar_calibrated[1],
                            "threshold_source": rs.THRESHOLD_SOURCE,
                            "radar_threshold_limits": list(RADAR_THRESHOLD_LIMITS),
                            "link_threshold_limits": list(LINK_THRESHOLD_LIMITS),
                        },
                    },
                }
                if links:
                    msg["links"] = [{"id": s, "motion": info[4], "strength": round(info[5], 3),
                                     **({"rssi": info[0][2]} if info[0][2] is not None else {}),
                                     "pps": info[0][1]}
                                    for s, info in link_info.items() if info[0][0]]
                broadcast(server.connections, json.dumps(msg))
                if alert != last_alert:
                    print(f"alert: {alert}", flush=True)
                    last_alert = alert

            if now - last_status >= 1.0:
                last_status = now
                parts = []
                if args.esp1:
                    parts.append(f"esp1 {esp1.rate(now)} lines/s")
                for s, info in link_info.items():
                    (online, pps, rssi), score, thr = info[0], info[1], info[2]
                    sc = "--" if score is None else f"{score:.3f}"
                    bl = "" if info[7] is None or info[8] is None else f" blk {info[7]:.3f}/{info[8]:g}"
                    parts.append(f"{s} {pps}/s {rssi}dBm {sc}/{thr:g} (x{info[11]:g}){bl}"
                                 f"{' ACTIVE' if info[4] else ''}"
                                 if online else f"{s} offline")
                if radar_fresh:
                    ignored = "held" if r["held"] else "ignored"
                    parts.append(f"radar {radar_fps}/s {r['prediction']} {frame[1]}/{frame[3]}cm"
                                 f"{f' (past the front, {ignored})' if r['still_beyond_front'] else ''}"
                                 f"{f' (module: nobody, {ignored})' if r['module_nobody'] else ''}")
                else:
                    parts.append("radar no data")
                parts.append(f"alert {msg['alert'] if msg else '-'} ({gate.state}"
                             f"{', from ' + gate.entry_side if gate.inside and gate.entry_side else ''})")
                if calibrator.state in ("countdown", "measuring"):
                    parts.append(f"calibration {calibrator.state} {calibrator.until - now:.0f}s")
                print(" | ".join(parts) + f" | clients {len(server.connections)}", flush=True)


def main():
    p = argparse.ArgumentParser(description="Perrymeter hub: sensors in, dashboard messages out")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--esp1", help="ESP1 hub board's serial port (Wi-Fi CSI and radar), e.g. COM6")
    src.add_argument("--radar", help="radar Feather bridge's serial port, e.g. COM5")
    src.add_argument("--fake-radar", action="store_true", help="simulated radar data")
    p.add_argument("--baud", type=int, default=BAUD)
    p.add_argument("--approach-cm", type=int, default=None,
                   help="also show APPROACH for someone the radar sees beyond the zone, up to this distance "
                        "(off by default: nothing past the zone is tracked)")
    p.add_argument("--record", help="save every radar frame to this CSV file")
    p.add_argument("--record-csi", help="(with --esp1) append every CSI line to this CSV file")
    p.add_argument("--entry-logic", action="store_true",
                   help="experimental: ALERT only after an entry (a Wi-Fi side fired, or the radar first saw "
                        "them far away); otherwise anyone the radar sees in range is ALERT")
    p.add_argument("--no-exit-on-crossing", action="store_true",
                   help="stay ALERT until the radar loses the person, even after they cross out through a side")
    p.add_argument("--line-blocked", action="store_true",
                   help="experimental: also trigger a side when its signal pattern differs from the "
                        "empty zone (off by default, see BLOCK_MARGIN)")
    p.add_argument("--calibrate-on-start", action="store_true", help="calibrate as soon as the hub starts")
    p.add_argument("--countdown", type=float, default=5, help="seconds to leave the zone before calibrating")
    p.add_argument("--calibration-seconds", type=float, default=15, help="how long to measure the empty zone")
    p.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets other computers connect")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--rate", type=float, default=SEND_RATE, help="messages per second")
    args = p.parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
