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
                           radar_settings.py, held for HOLD_S). With the experimental
                           --entry-logic they must also have entered (see ZoneGate).
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

Calibration ("calibrate" command from the dashboard, or --calibrate-on-start): after a countdown
to leave the area, the hub measures the empty zone and sets
    each Wi-Fi side's baseline    the median of its empty score (strength is 0 there)
    each Wi-Fi side's threshold   CALIBRATION_MARGIN x the 99th percentile of its empty score
                                  (the dashboard's Threshold - / + buttons then fine-tune it)
    the radar thresholds          99th percentile of the empty energy + 10, at least 20, at most
                                  100 (the same method as radar_calibrate.py)
Results are saved to processing/hub_calibration.json and radar_calibration.json (shared with
radar_plot.py and radar_server.py), and loaded again at start.

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
# Entry logic (with --esp1): the radar alone cannot tell inside from just outside a side, because
# its view (about 120 degrees) is wider than the triangle's corner (60 degrees). So "inside" needs
# an entry: a Wi-Fi side became active at most ENTRY_WINDOW_S before (or while) the radar sees the
# person, or the radar first saw them at least FAR_ENTRY_FRACTION of its range away (they came in
# through the radar's side). Seen by the radar without an entry: "approach".
ENTRY_WINDOW_S = 3.0
FAR_ENTRY_FRACTION = 0.7
# While the radar sees someone, a side only needs to reach this share of its threshold to count as
# the entry (the Wi-Fi alone caught only 11-12 of 19 crossings in Rayhan's recording). APPROACH and
# crossing back out still need the full threshold.
ENTRY_EVIDENCE = 0.6
# Leaving: once inside for EXIT_MIN_INSIDE_S, a Wi-Fi side rising to ENTRY_EVIDENCE again means
# they crossed out. The radar may still see them outside, so the zone drops to "approach" until a
# new entry. The side they left through only counts as an entry again after REENTRY_QUIET_S quiet.
EXIT_MIN_INSIDE_S = 2.0
REENTRY_QUIET_S = 2.0
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
            0.8 * self.threshold if self.motion else self.threshold)
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
        rel = 0.0 if self.score is None or self.threshold <= 0 else self.score / self.threshold
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
            span = max(1e-6, self.threshold - self.baseline)
            best = 0.5 * (self.score - self.baseline) / span
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
                while True:
                    # Opening the port can leave ESP1 stuck in reset or its bootloader (seen on the
                    # Pi). If it sends nothing for ESP1_SILENT_RESET_S, pulse EN through RTS (DTR
                    # stays off, so it boots normally) to restart it.
                    if time.time() - max(stats.last_line, quiet_since) > ESP1_SILENT_RESET_S:
                        print("ESP1: no data, restarting it", flush=True)
                        ser.rts = True
                        time.sleep(0.2)
                        ser.rts = False
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
        self.last_inside_at = None
        self.last_inside_cm = None

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
        if prediction != "nothing":
            self.last_inside_at, self.last_inside_cm = now, dist_cm
        holding = self.last_inside_at is not None and now - self.last_inside_at < HOLD_S
        far_cm = None if holding else self.far_target_cm(frame, avg_m, avg_s)
        moving = self.motion.update(prediction == "moving", now)
        return {"prediction": prediction, "inside": holding,
                "inside_cm": self.last_inside_cm if holding else None,
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
        self.prev_evidence = {}
        self.quiet_since = {}        # side -> since when its evidence has been low
        self.blocked = set()         # sides someone just left through (see REENTRY_QUIET_S)
        self.state = "clear"         # clear | inside | seen_no_entry | left_zone

    def reset_sides(self):
        """Forget per-side history (after the sides were renamed)."""
        self.last_rise, self.prev_evidence, self.quiet_since = {}, {}, {}
        self.blocked = set()

    def update(self, now, present, dist_cm, side_active, side_evidence):
        """side_evidence: a side at ENTRY_EVIDENCE of its threshold or more. Its rising edges are
        entries (and, once inside, exits). side_active (fully over) is kept for callers' symmetry."""
        rose = []   # sides whose evidence just started
        for side, ev in side_evidence.items():
            if ev:
                self.quiet_since.pop(side, None)
                if not self.prev_evidence.get(side):
                    rose.append(side)
                    if side not in self.blocked:
                        self.last_rise[side] = now
            else:
                since = self.quiet_since.setdefault(side, now)
                if side in self.blocked and now - since >= REENTRY_QUIET_S:
                    self.blocked.discard(side)
            self.prev_evidence[side] = ev

        if not present:
            self.inside, self.entry_side, self.inside_since = False, None, None
            self.first_seen_cm, self.present_before, self.state = None, False, "clear"
            return
        if not self.present_before:
            self.first_seen_cm, self.present_before = dist_cm, True

        if not self.enabled:
            # Radar decides: anyone in range is inside. The Wi-Fi sides only name the entry side
            # (for the arrow), they never hold back an ALERT.
            if not self.inside:
                self.inside, self.inside_since, self.state = True, now, "inside"
                recent = [(t, s) for s, t in self.last_rise.items() if now - t <= ENTRY_WINDOW_S]
                if recent:
                    self.entry_side = max(recent)[1]
                elif self.first_seen_cm is not None and self.first_seen_cm >= FAR_ENTRY_FRACTION * rs.MAX_DISTANCE_CM:
                    self.entry_side = "base"
                else:
                    self.entry_side = None
            return

        if self.inside:
            if self.exit_on_crossing and rose and now - self.inside_since >= EXIT_MIN_INSIDE_S:
                self.inside, self.entry_side, self.inside_since = False, None, None
                self.exit_at, self.first_seen_cm, self.state = now, None, "left_zone"
                # Standing just outside keeps stirring that side: it must go quiet before it can
                # count as a new entry, or they would be counted back in again and again
                self.blocked.update(rose)
                for side in rose:
                    self.last_rise.pop(side, None)
            return

        recent = [(t, s) for s, t in self.last_rise.items() if now - t <= ENTRY_WINDOW_S and t > self.exit_at]
        if recent:
            self.inside, self.entry_side = True, max(recent)[1]
        elif self.first_seen_cm is not None and self.first_seen_cm >= FAR_ENTRY_FRACTION * rs.MAX_DISTANCE_CM:
            self.inside, self.entry_side = True, "base"
        if self.inside:
            self.inside_since, self.state = now, "inside"
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
    entry = {"side": l.side, "calibrated": l.calibrated, "threshold": l.threshold, "baseline": l.baseline}
    if l.base_shape is not None:
        entry.update({
            "block_threshold": l.block_threshold, "block_baseline": l.block_baseline,
            "base_mask": [int(i) for i in np.flatnonzero(l.base_mask)],
            "base_shape": [None if not np.isfinite(v) else round(float(v), 5) for v in l.base_shape],
        })
    return entry


def save_hub_calibration(links):
    data = {"created": now_text(), "margin": CALIBRATION_MARGIN,
            "links": {l.mac: link_calibration(l) for l in links.values() if l.calibrated}}
    with open(HUB_CALIBRATION_FILE, "w") as f:
        json.dump(data, f)


def save_hub_calibration_all(links):
    """Save every side's current thresholds (after a manual change), calibrated or not."""
    data = {"created": now_text(), "margin": CALIBRATION_MARGIN,
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
        for link in links.values():
            entry = data.get("links", {}).get(link.mac)
            if entry:
                link.threshold = float(entry["threshold"])
                link.calibrated = bool(entry.get("calibrated", True))
                link.baseline = float(entry.get("baseline", DEFAULT_LINK_BASELINE))
                link.calibrated_at = data.get("created")
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


def save_radar_calibration(mt, st, pm, ps, n):
    data = {"moving_threshold": mt, "still_threshold": st, "created": now_text(),
            "readings": n, "empty_room_movement_p99": round(pm, 1), "empty_room_stillness_p99": round(ps, 1),
            "margin": 10, "floor": 20, "distance_range_cm": [rs.MIN_DISTANCE_CM, rs.MAX_DISTANCE_CM],
            "source": "processing/hub.py"}
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
                link_info = {s: (l.stats(now), l.score, l.threshold, l.calibrated, l.motion, l.strength(),
                                 l.baseline, l.block, l.block_threshold, l.relative())
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
                        {s: bool(info[0][0] and info[4]) for s, info in link_info.items()},
                        {s: bool(info[0][0] and info[9] >= ENTRY_EVIDENCE) for s, info in link_info.items()})

            any_link_fresh = any(info[0][0] for info in link_info.values())
            if not radar_fresh and not any_link_fresh:
                msg = None
            else:
                if gate.inside:
                    alert, distance_cm = "inside", r["inside_cm"] if r else None
                elif radar_present:
                    # The radar sees someone, but there was no entry (or they crossed back out)
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
                                   "calibrated": info[3], "motion": info[4]}
                                  for s, info in link_info.items()],
                        "radar": None if not radar_fresh else {
                            "fps": radar_fps, "state": frame[0], "state_name": STATES.get(frame[0], str(frame[0])),
                            "moving_cm": frame[1], "moving_energy": frame[2], "still_cm": frame[3],
                            "still_energy": frame[4], "detect_cm": frame[5],
                            "avg_moving": round(avg_m, 1), "avg_still": round(avg_s, 1),
                            "moving_threshold": rs.MOVING_THRESHOLD, "still_threshold": rs.STILL_THRESHOLD,
                            "zone_cm": [rs.MIN_DISTANCE_CM, rs.MAX_DISTANCE_CM],
                            "prediction": r["prediction"], "status": radar.status},
                        "esp1": {"lines_per_s": esp1.rate(now), "garbled": esp1.garbled} if args.esp1 else None,
                        "calibration": calibrator.status(now),
                        "zone": {"state": gate.state, "entry_side": gate.entry_side,
                                 "entry_logic": gate.enabled, "exit_on_crossing": gate.exit_on_crossing,
                                 "blocked_sides": sorted(gate.blocked)},
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
                    parts.append(f"{s} {pps}/s {rssi}dBm {sc}/{thr:g}{bl}{' ACTIVE' if info[4] else ''}"
                                 if online else f"{s} offline")
                if radar_fresh:
                    parts.append(f"radar {radar_fps}/s {r['prediction']} {frame[1]}/{frame[3]}cm")
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
                   help="with --entry-logic: stay ALERT until the radar loses the person")
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
