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
                           radar_settings.py, held for HOLD_S), and with --esp1 they entered:
                           a Wi-Fi side fired just before, or the radar first saw them far away
                           (they came in through its side). See ZoneGate and ENTRY_WINDOW_S.
                "approach" a Wi-Fi side is active, the radar sees someone beyond the zone, or
                           it sees someone in range who has not entered (or crossed back out)
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
HOLD_S = 1.0           # radar presence stays on this long after the radar loses the person
# Entry logic (with --esp1): the radar alone cannot tell inside from just outside a side, because
# its view (about 120 degrees) is wider than the triangle's corner (60 degrees). So "inside" needs
# an entry: a Wi-Fi side became active at most ENTRY_WINDOW_S before (or while) the radar sees the
# person, or the radar first saw them at least FAR_ENTRY_FRACTION of its range away (they came in
# through the radar's side). Seen by the radar without an entry: "approach".
ENTRY_WINDOW_S = 3.0
FAR_ENTRY_FRACTION = 0.7
# Leaving: once inside for EXIT_MIN_INSIDE_S, a Wi-Fi side becoming active again means they crossed
# out. The radar may still see them outside, so the zone drops to "approach" until a new entry.
EXIT_MIN_INSIDE_S = 2.0
MOTION_ON_S = 0.3      # radar: seconds of movement before motion turns on
MOTION_OFF_S = 0.7     # radar: seconds without it before motion turns off
LINK_ON_S = 0.5        # Wi-Fi side: seconds over the threshold before it counts as active
LINK_OFF_S = 0.7       # Wi-Fi side: seconds under it before it stops
LINK_WINDOW_S = 0.5    # Wi-Fi activity window
LINK_MIN_PACKETS = 4   # fewer packets than this in a window: no score (a side can drop to about 14/s)
LINK_OFFLINE_S = 2.0   # no packet from a side for this long: that node is offline
DEFAULT_LINK_THRESHOLD = 0.15   # used until the first calibration
DEFAULT_LINK_BASELINE = 0.03    # typical empty-zone score, used until the first calibration
CALIBRATION_MARGIN = 1.5        # side threshold = this x the 99th percentile of its empty-zone score
CALIBRATION_FLOOR = 0.02
# Both Wi-Fi links end at ESP1, so someone at one side also stirs the other link a little. A side
# only counts as active if its score/threshold is at least this share of the most active side's.
DOMINANCE = 0.6
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
    """One Wi-Fi side: recent packets, activity score, threshold and motion."""

    def __init__(self, side, mac):
        self.side, self.mac = side, mac
        self.packets = collections.deque()   # (t, rssi, amplitudes)
        self.threshold = DEFAULT_LINK_THRESHOLD
        self.baseline = DEFAULT_LINK_BASELINE
        self.calibrated = False
        self.calibrated_at = None
        self.score = None
        self.over = False      # score past the threshold (with hysteresis), before the side-vs-side check
        self.motion = False
        self._delay = Delay(LINK_ON_S, LINK_OFF_S)

    def add(self, t, rssi, amp):
        self.packets.append((t, rssi, amp))
        while self.packets and t - self.packets[0][0] > 2.0:
            self.packets.popleft()

    def update(self, now):
        """Recompute the score from the last LINK_WINDOW_S and whether it is over the threshold.
        motion itself is decided in update_links, which compares the sides."""
        recent = [p for p in self.packets if now - p[0] <= 2.0]
        window = [p for p in recent if now - p[0] <= LINK_WINDOW_S]
        self.score = None
        if len(window) >= LINK_MIN_PACKETS and len(recent) >= LINK_MIN_PACKETS:
            # Subcarriers that are always NaN (first_word_invalid) are expected: no warnings for them
            with np.errstate(all="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                ref = np.nanmedian(np.stack([p[2] for p in recent]), axis=0)
                good = np.isfinite(ref) & (ref > 6)
                if good.sum() >= 8:
                    a = np.stack([p[2] for p in window])[:, good]
                    shape = a / np.maximum(np.nanmedian(a, axis=1, keepdims=True), 2.0)
                    self.score = float(np.nanmedian(np.nanstd(shape, axis=0)))
        if self.score is None:
            self.over = False
        else:
            self.over = self.score >= (0.8 * self.threshold if self.motion else self.threshold)
        return self.score

    def relative(self):
        """Score as a multiple of the threshold (1.0 = at the threshold)."""
        return 0.0 if self.score is None or self.threshold <= 0 else self.score / self.threshold

    def stats(self, now):
        last_s = [p for p in self.packets if now - p[0] <= 1.0]
        online = bool(self.packets) and now - self.packets[-1][0] <= LINK_OFFLINE_S
        rssi = int(np.median([p[1] for p in last_s])) if last_s else None
        return online, len(last_s), rssi

    def strength(self):
        """0 at the empty-zone baseline, 0.5 at the threshold, 1 at twice that distance above it."""
        if self.score is None:
            return 0.0
        span = max(1e-6, self.threshold - self.baseline)
        return max(0.0, min(1.0, 0.5 * (self.score - self.baseline) / span))


def update_links(links, now):
    """Score every side, then decide which sides are active. A side over its threshold only counts
    if it is at least DOMINANCE as far over as the most active side (see DOMINANCE)."""
    for link in links.values():
        link.update(now)
    top = max((l.relative() for l in links.values() if l.over), default=0.0)
    for link in links.values():
        want = link.over and link.relative() >= DOMINANCE * top
        link.motion = link._delay.update(want, now)


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
                while True:
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
                            side = SIDE_BY_MAC.get(mac)
                            if side:
                                with links_lock:
                                    links[side].add(now, rssi, amp)
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
    far_cm = min(approach_cm, rs.MAX_DISTANCE_CM + 150)
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
        self.last_rise = {}          # side -> time it last became active
        self.prev_active = {}
        self.state = "clear"         # clear | inside | seen_no_entry | left_zone

    def update(self, now, present, dist_cm, side_active):
        rose = []
        for side, active in side_active.items():
            if active and not self.prev_active.get(side):
                self.last_rise[side] = now
                rose.append(side)
            self.prev_active[side] = active

        if not present:
            self.inside, self.entry_side, self.inside_since = False, None, None
            self.first_seen_cm, self.present_before, self.state = None, False, "clear"
            return
        if not self.present_before:
            self.first_seen_cm, self.present_before = dist_cm, True

        if not self.enabled:
            if not self.inside:
                self.inside, self.inside_since, self.state = True, now, "inside"
            return

        if self.inside:
            if self.exit_on_crossing and rose and now - self.inside_since >= EXIT_MIN_INSIDE_S:
                self.inside, self.entry_side, self.inside_since = False, None, None
                self.exit_at, self.first_seen_cm, self.state = now, None, "left_zone"
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
        self.radar_m, self.radar_s = [], []
        self.message = "Not calibrated in this session"
        self.results = None
        self.at = None

    def start(self, now, countdown_s, measure_s):
        self.state, self.until, self.measure_s = "countdown", now + countdown_s, measure_s
        self.scores = collections.defaultdict(list)
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
        results, problems, warnings = {"links": {}, "radar": None}, [], []
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
        if len(self.radar_m) >= 20:
            pm = float(np.percentile(self.radar_m, 99))
            ps = float(np.percentile(self.radar_s, 99))
            mt = round(min(100, max(20, pm + 10)))
            st = round(min(100, max(20, ps + 10)))
            rs.MOVING_THRESHOLD, rs.STILL_THRESHOLD = mt, st
            rs.THRESHOLD_SOURCE = f"hub calibration at {now_text()}"
            results["radar"] = {"moving_threshold": mt, "still_threshold": st,
                                "empty_movement_p99": round(pm, 1), "empty_stillness_p99": round(ps, 1)}
            for name, t in (("movement", mt), ("stillness", st)):
                if t >= 95:
                    warnings.append(f"radar {name} threshold is {t}: something in view was moving or "
                                    "very close during calibration")
            save_radar_calibration(mt, st, pm, ps, len(self.radar_m))
        else:
            problems.append("radar: too few readings")
        save_hub_calibration(links)
        self.results, self.at = results, now_text()
        if problems and not results["links"] and results["radar"] is None:
            self.state, self.message = "failed", "; ".join(problems)
        else:
            self.state = "done"
            self.message = "Calibrated" + (". " + "; ".join(problems + warnings) if problems or warnings else "")
        print(f"calibration: {self.state}: {json.dumps(results)} {self.message}", flush=True)

    def status(self, now):
        remaining = max(0.0, self.until - now) if self.state in ("countdown", "measuring") else None
        return {"state": self.state, "remaining_s": None if remaining is None else round(remaining, 1),
                "message": self.message, "at": self.at, "results": self.results}


def save_hub_calibration(links):
    data = {"created": now_text(), "margin": CALIBRATION_MARGIN,
            "links": {l.mac: {"side": l.side, "threshold": l.threshold, "baseline": l.baseline}
                      for l in links.values() if l.calibrated}}
    with open(HUB_CALIBRATION_FILE, "w") as f:
        json.dump(data, f, indent=2)


def save_hub_calibration_all(links):
    """Save every side's current threshold (after a manual change), calibrated or not."""
    data = {"created": now_text(), "margin": CALIBRATION_MARGIN,
            "links": {l.mac: {"side": l.side, "threshold": l.threshold, "baseline": l.baseline}
                      for l in links.values()}}
    with open(HUB_CALIBRATION_FILE, "w") as f:
        json.dump(data, f, indent=2)


def load_hub_calibration(links):
    if not os.path.exists(HUB_CALIBRATION_FILE):
        return None
    try:
        with open(HUB_CALIBRATION_FILE) as f:
            data = json.load(f)
        for link in links.values():
            entry = data.get("links", {}).get(link.mac)
            if entry:
                link.threshold, link.calibrated = float(entry["threshold"]), True
                link.baseline = float(entry.get("baseline", DEFAULT_LINK_BASELINE))
                link.calibrated_at = data.get("created")
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
    gate = ZoneGate(enabled=bool(args.esp1) and not args.no_entry_logic,
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
            elif cmd.get("type") == "adjust_threshold":
                # {"type": "adjust_threshold", "side": "left", "factor": 1.25}: raise or lower one side
                side, factor = cmd.get("side"), cmd.get("factor")
                if side in links and isinstance(factor, (int, float)) and 0.5 <= factor <= 2.0:
                    with links_lock:
                        link = links[side]
                        link.threshold = round(max(CALIBRATION_FLOOR, link.threshold * factor,
                                                   link.baseline * 1.2), 4)
                        save_hub_calibration_all(links)
                    print(f"threshold: {side} set to {link.threshold}", flush=True)

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

            with links_lock:
                update_links(links, now)
                link_info = {s: (l.stats(now), l.score, l.threshold, l.calibrated, l.motion, l.strength(),
                                 l.baseline)
                             for s, l in links.items()}

            r = logic.update(frame, avg_m, avg_s, now) if radar_fresh else None
            radar_sample = None
            if radar_fresh:
                m_in = avg_m if rs.MIN_DISTANCE_CM <= frame[1] <= rs.MAX_DISTANCE_CM else 0.0
                s_in = avg_s if rs.MIN_DISTANCE_CM <= frame[3] <= rs.MAX_DISTANCE_CM else 0.0
                radar_sample = (m_in, s_in)
            calibrator.tick(now, links, radar_sample)

            side_active = [s for s, info in link_info.items() if info[0][0] and info[4]]
            radar_present = bool(r and r["inside"])
            gate.update(now, radar_present, r["inside_cm"] if r else None,
                        {s: bool(info[0][0] and info[4]) for s, info in link_info.items()})

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
                                 "entry_logic": gate.enabled, "exit_on_crossing": gate.exit_on_crossing},
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
                    parts.append(f"{s} {pps}/s {rssi}dBm {sc}/{thr:g}{' ACTIVE' if info[4] else ''}"
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
    p.add_argument("--approach-cm", type=int, default=600,
                   help="someone the radar sees beyond the zone but within this distance counts as approach")
    p.add_argument("--record", help="save every radar frame to this CSV file")
    p.add_argument("--record-csi", help="(with --esp1) append every CSI line to this CSV file")
    p.add_argument("--no-entry-logic", action="store_true",
                   help="ALERT whenever the radar sees someone in range, without needing an entry")
    p.add_argument("--no-exit-on-crossing", action="store_true",
                   help="stay ALERT until the radar loses the person, even after a side fires again")
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
