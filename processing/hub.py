"""Perrymeter hub server: sensors in, one dashboard message out.

Reads the HLK-LD2410C radar through the Feather bridge (firmware/radar_bridge) and
sends the dashboard message from docs/detection-contract.md about 10 times a second
over a WebSocket. The radar is the only sensor for now; the Wi-Fi sides plug in here
later.

    python processing/hub.py --radar COM5                    real radar (use your port)
    python processing/hub.py --fake-radar                    simulated radar, no hardware
    python processing/hub.py --radar COM5 --record log.csv   also save every radar frame

Then open the dashboard in Live mode, for example http://localhost:5173/?mode=live
(from another computer: ?mode=live&ws=ws://<this-computer's-IP>:8765).

What the dashboard gets
    alert       "inside"   the radar sees a person in the zone, moving or still (the rule
                           in radar_settings.py). It stays on for HOLD_S after the radar
                           loses them, so the radar's flicker does not flash the screen.
                "approach" the radar sees someone beyond the zone, up to --approach-cm
                "clear"    otherwise
    motion      the person is moving, with a short on/off delay
    strength    radar movement energy averaged over SMOOTH_S, 0 to 1
    confidence  how clearly that energy sits on one side of the threshold (a heuristic,
                not a probability)
    distance_m  radar distance to the person while one is detected, otherwise null
    nodes       hub and radar; the Wi-Fi sides are not installed yet
If the radar sends nothing for STALE_S, the hub sends nothing either, so the dashboard
shows that the data stopped instead of a false CLEAR.

Thresholds, distance limits and averaging come from radar_settings.py at the repo root
(and radar_calibration.json when it exists), so this hub, radar_plot.py and
radar_server.py always apply the same rule. Run radar_calibrate.py after moving the radar.

Needs: pip install pyserial websockets
"""
import argparse
import asyncio
import collections
import csv
import json
import os
import random
import sys
import threading
import time

from websockets.asyncio.server import broadcast, serve

# Omar's radar settings and frame parser live at the repo root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import radar_settings as rs  # noqa: E402
from radar_server import read_frames  # noqa: E402

BAUD = 921600        # must match Serial.begin(...) in firmware/radar_bridge
SEND_RATE = 10       # messages per second to the dashboard
STALE_S = 1.0        # no radar frame for this long: send nothing
HOLD_S = 1.5         # "inside" stays on this long after the radar loses the person
MOTION_ON_S = 0.3    # seconds of movement before motion turns on
MOTION_OFF_S = 0.7   # seconds without movement before motion turns off
STATES = {0: "nobody", 1: "moving", 2: "still", 3: "moving+still"}


# ---- radar input -----------------------------------------------------------
class Radar:
    """Latest radar frame plus energies averaged over rs.SMOOTH_S, shared with the server loop."""

    def __init__(self, record_path=None):
        self._lock = threading.Lock()
        self._recent = collections.deque()  # (time, moving_energy, still_energy)
        self.frame, self.time, self.count = None, 0.0, 0
        self.avg_m = self.avg_s = 0.0
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
            self.count += 1
            self._recent.append((now, frame[2], frame[4]))
            while now - self._recent[0][0] > rs.SMOOTH_S:
                self._recent.popleft()
            n = len(self._recent)
            self.avg_m = sum(r[1] for r in self._recent) / n
            self.avg_s = sum(r[2] for r in self._recent) / n
            if self._writer:
                self._writer.writerow([round(now, 3), *frame])
                if self.count % 50 == 0:
                    self._file.flush()

    def get(self):
        with self._lock:
            return self.frame, self.time, self.count, self.avg_m, self.avg_s


def serial_reader(port, baud, radar):
    """Read the real radar forever; reopen the port if the cable is pulled."""
    import serial

    while True:
        try:
            ser = serial.Serial()
            ser.port, ser.baudrate, ser.timeout = port, baud, 1
            ser.dtr = False  # toggling DTR/RTS can reset the ESP32
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
    """Simulated radar, 20 s cycle: nobody, someone walking in the zone, the same person
    standing still, then someone walking past beyond the zone."""
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


# ---- turning radar frames into the dashboard message -----------------------
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


class ZoneLogic:
    """Applies Omar's rule (radar_settings.classify) and adds the alert level."""

    def __init__(self, approach_cm):
        self.approach_cm = approach_cm
        self.motion = Delay(MOTION_ON_S, MOTION_OFF_S)
        self.last_inside_at = None
        self.last_inside_cm = None

    def far_target_cm(self, frame, avg_m, avg_s):
        """Distance of a person the radar sees beyond the zone, or None."""
        state, m_cm, _, s_cm, _, _ = frame
        lo, hi = rs.MAX_DISTANCE_CM, self.approach_cm
        if state in (1, 3) and avg_m >= rs.MOVING_THRESHOLD and lo < m_cm <= hi:
            return m_cm
        if state in (2, 3) and avg_s >= rs.STILL_THRESHOLD and lo < s_cm <= hi:
            return s_cm
        return None

    def message(self, frame, avg_m, avg_s, now):
        _state, m_cm, _m_en, s_cm, _s_en, _d_cm = frame
        prediction, dist_cm = rs.classify(avg_m, avg_s, m_cm, s_cm)

        if prediction != "nothing":
            self.last_inside_at, self.last_inside_cm = now, dist_cm
        holding = self.last_inside_at is not None and now - self.last_inside_at < HOLD_S
        far_cm = None if holding else self.far_target_cm(frame, avg_m, avg_s)

        if holding:
            alert, distance_cm = "inside", self.last_inside_cm
        elif far_cm is not None:
            alert, distance_cm = "approach", far_cm
        else:
            alert, distance_cm = "clear", None

        motion = self.motion.update(prediction == "moving", now)
        strength = min(1.0, avg_m / 100)
        margin = min(1.0, abs(avg_m - rs.MOVING_THRESHOLD) / rs.MOVING_THRESHOLD)
        agrees = (avg_m >= rs.MOVING_THRESHOLD) == motion
        confidence = 0.5 + 0.5 * margin if agrees else 0.5

        return {
            "t": round(now, 3),
            "motion": motion,
            "strength": round(strength, 3),
            "confidence": round(confidence, 3),
            "alert": alert,
            "distance_m": round(distance_cm / 100, 2) if distance_cm is not None else None,
            "nodes": [{"id": "hub", "online": True}, {"id": "radar", "online": True}],
            # Extra detail for debugging; the dashboard ignores fields it does not know
            "radar": {
                "prediction": prediction,
                "moving_energy": round(avg_m, 1),
                "still_energy": round(avg_s, 1),
                "moving_threshold": rs.MOVING_THRESHOLD,
                "still_threshold": rs.STILL_THRESHOLD,
            },
        }


# ---- the WebSocket server --------------------------------------------------
async def run(args):
    radar = Radar(args.record)
    if args.fake_radar:
        target, targs = fake_reader, (radar, args.approach_cm)
        print("Radar: SIMULATED data", flush=True)
    else:
        target, targs = serial_reader, (args.radar, args.baud, radar)
    threading.Thread(target=target, args=targs, daemon=True).start()
    logic = ZoneLogic(args.approach_cm)

    async def handler(websocket):
        await websocket.wait_closed()

    async with serve(handler, args.host, args.port) as server:
        print(f"Perrymeter hub on ws://{args.host}:{args.port} (Ctrl+C to stop)", flush=True)
        print(f"Radar rule: moving if movement >= {rs.MOVING_THRESHOLD}, else still if stillness >= "
              f"{rs.STILL_THRESHOLD}; zone {rs.MIN_DISTANCE_CM}-{rs.MAX_DISTANCE_CM} cm, approach up to "
              f"{args.approach_cm} cm; {rs.SMOOTH_S:g} s average. Thresholds from {rs.THRESHOLD_SOURCE}.",
              flush=True)
        if args.record:
            print(f"Recording every radar frame to {args.record}", flush=True)
        last_status, last_count, last_alert = time.time(), 0, None
        while True:
            await asyncio.sleep(1.0 / args.rate)
            now = time.time()
            frame, frame_time, count, avg_m, avg_s = radar.get()
            msg = None
            if frame is not None and now - frame_time <= STALE_S:
                msg = logic.message(frame, avg_m, avg_s, now)
                broadcast(server.connections, json.dumps(msg))
                if msg["alert"] != last_alert:
                    print(f"alert: {msg['alert']}", flush=True)
                    last_alert = msg["alert"]

            if now - last_status >= 1.0:
                fps, last_count, last_status = count - last_count, count, now
                clients = len(server.connections)
                if msg is None:
                    print(f"no radar data  clients={clients}", flush=True)
                else:
                    r = msg["radar"]
                    print(f"{fps:3d} frames/s  {STATES.get(frame[0], frame[0]):12} -> {r['prediction']:8} "
                          f"alert={msg['alert']:8} motion={'yes' if msg['motion'] else 'no ':3} "
                          f"distance={msg['distance_m']}  energy move {r['moving_energy']:5.1f} "
                          f"still {r['still_energy']:5.1f}  clients={clients}", flush=True)


def main():
    p = argparse.ArgumentParser(description="Perrymeter hub: radar in, dashboard messages out")
    p.add_argument("--radar", help="serial port of the radar bridge, e.g. COM5 or /dev/ttyACM0")
    p.add_argument("--fake-radar", action="store_true", help="use simulated radar data")
    p.add_argument("--baud", type=int, default=BAUD)
    p.add_argument("--approach-cm", type=int, default=600,
                   help="someone seen beyond the zone but within this distance counts as approach")
    p.add_argument("--record", help="also save every radar frame to this CSV file")
    p.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets other computers connect")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--rate", type=float, default=SEND_RATE, help="messages per second")
    args = p.parse_args()
    if not args.fake_radar and not args.radar:
        p.error("give the radar's serial port (--radar COM5) or --fake-radar")
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
