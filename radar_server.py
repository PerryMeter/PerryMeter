"""RadarPing radar server.

Reads the HLK-LD2410C radar (through the ESP32 bridge) and sends the dashboard
message from project.md section 6 about 10 times per second over a WebSocket.

    python radar_server.py COM5        real radar on COM5 (use your port)
    python radar_server.py --fake      simulated radar, no hardware needed

Then open the dashboard in Live mode. From another computer, point it at
ws://<this-computer's-IP>:8765 with the ?ws= address option.

Needs:  pip install pyserial websockets
"""
import argparse
import asyncio
import collections
import json
import math
import random
import struct
import threading
import time

from websockets.asyncio.server import broadcast, serve

# Thresholds, distance limits and averaging live in radar_settings.py (shared with radar_plot.py)
from radar_settings import (MAX_DISTANCE_CM, MIN_DISTANCE_CM, MOVING_THRESHOLD,
                            SMOOTH_S, STILL_THRESHOLD, THRESHOLD_SOURCE, classify)

# ---- settings -------------------------------------------------------------
BAUD = 921600       # must match Serial.begin(...) in the ESP32 sketch
ON_AFTER = 0.3      # seconds of movement before motion turns on
OFF_AFTER = 0.7     # seconds without movement before motion turns off
STALE_AFTER = 1.0   # no radar frame for this long = send nothing
SEND_RATE = 10      # messages per second to the dashboard (or use --rate)

HEAD = b"\xF4\xF3\xF2\xF1"
TAIL = b"\xF8\xF7\xF6\xF5"
STATES = {0: "nobody", 1: "MOVING", 2: "still", 3: "MOVING + still"}


# ---- reading the radar ----------------------------------------------------
def read_frames(ser):
    """Yield (state, moving_cm, moving_energy, still_cm, still_energy, detect_cm)."""
    buf = b""
    while True:
        buf += ser.read(ser.in_waiting or 1)
        while True:
            start = buf.find(HEAD)
            if start < 0:
                buf = buf[-3:]  # keep a possible partial header
                break
            if len(buf) < start + 6:
                buf = buf[start:]
                break
            n = struct.unpack_from("<H", buf, start + 4)[0]
            if n > 200:  # impossible length: this was not a real header
                buf = buf[start + 4:]
                continue
            end = start + 6 + n + 4
            if len(buf) < end:
                buf = buf[start:]
                break
            payload = buf[start + 6:start + 6 + n]
            ok = buf[end - 4:end] == TAIL
            buf = buf[end:]
            if ok and len(payload) >= 11 and payload[1] == 0xAA:
                yield struct.unpack_from("<BHBHBH", payload, 2)


class Latest:
    """The most recent radar frame plus energies averaged over SMOOTH_S seconds,
    shared between the reader thread and the server."""

    def __init__(self):
        self._lock = threading.Lock()
        self.frame, self.time, self.count = None, 0.0, 0
        self._recent = collections.deque()  # (time, moving_energy, still_energy)
        self.avg_m = self.avg_s = 0.0

    def put(self, frame):
        now = time.time()
        with self._lock:
            self.frame, self.time = frame, now
            self.count += 1
            self._recent.append((now, frame[2], frame[4]))
            while now - self._recent[0][0] > SMOOTH_S:
                self._recent.popleft()
            n = len(self._recent)
            self.avg_m = sum(r[1] for r in self._recent) / n
            self.avg_s = sum(r[2] for r in self._recent) / n

    def get(self):
        with self._lock:
            return self.frame, self.time, self.count, self.avg_m, self.avg_s


def serial_reader(port, baud, latest):
    """Read the real radar forever; reconnect if the cable is pulled."""
    import serial

    while True:
        try:
            ser = serial.Serial()
            ser.port, ser.baudrate, ser.timeout = port, baud, 1
            ser.dtr = False  # don't toggle DTR/RTS: that can reset the ESP32
            ser.rts = False
            ser.open()
            with ser:
                print(f"Opened {port}")
                for frame in read_frames(ser):
                    latest.put(frame)
        except serial.SerialException as e:
            print(f"Serial problem on {port}: {e}  (retrying in 2 s)")
            time.sleep(2)


def fake_reader(latest):
    """Simulated radar: 6 s nobody, 6 s someone walking, 6 s someone sitting still."""
    t0 = time.time()
    while True:
        t = (time.time() - t0) % 18
        if t < 6:
            frame = (0, 0, 0, 0, 0, 0)
        elif t < 12:
            d = int(200 + 120 * math.sin(t))
            frame = (1, d, random.randint(45, 85), 0, 0, d)
        else:
            frame = (2, 0, random.randint(0, 8), 180, random.randint(25, 45), 180)
        latest.put(frame)
        time.sleep(0.1)


# ---- turning frames into the dashboard message ----------------------------
class Hysteresis:
    """motion turns on after ON_AFTER s of movement, off after OFF_AFTER s without."""

    def __init__(self):
        self.motion = False
        self._since = None

    def update(self, moving, now):
        if moving == self.motion:
            self._since = None
        else:
            if self._since is None:
                self._since = now
            if now - self._since >= (ON_AFTER if moving else OFF_AFTER):
                self.motion, self._since = moving, None
        return self.motion


def build_message(frame, avg_m, avg_s, hyst, now):
    """Apply the rule from radar_settings.py and build the dashboard message."""
    _state, m_cm, m_en, s_cm, s_en, _d_cm = frame
    prediction, dist_cm = classify(avg_m, avg_s, m_cm, s_cm)
    motion = hyst.update(prediction == "moving", now)

    strength = min(1.0, avg_m / 100)

    # Heuristic, not a probability: how far the averaged movement energy is
    # from the moving threshold, on the side that agrees with the decision.
    margin = min(1.0, abs(avg_m - MOVING_THRESHOLD) / MOVING_THRESHOLD)
    agrees = (avg_m >= MOVING_THRESHOLD) == motion
    confidence = 0.5 + 0.5 * margin if agrees else 0.5

    return {
        "t": round(now, 2),
        "motion": motion,
        "strength": round(strength, 3),
        "confidence": round(confidence, 3),
        # extra fields (the dashboard ignores ones it does not know)
        "prediction": prediction,              # "moving" | "still" | "nothing"
        "present": prediction != "nothing",
        "distance_m": round(dist_cm / 100, 2) if dist_cm is not None else None,
        "moving_energy": round(avg_m, 1),      # averaged over SMOOTH_S
        "still_energy": round(avg_s, 1),
        "source": "ld2410c",
    }


# ---- the WebSocket server -------------------------------------------------
async def run(args):
    latest = Latest()
    if args.fake:
        target, targs = fake_reader, (latest,)
        print("Using SIMULATED radar data")
    else:
        target, targs = serial_reader, (args.source, args.baud, latest)
    threading.Thread(target=target, args=targs, daemon=True).start()

    hyst = Hysteresis()

    async def handler(websocket):
        await websocket.wait_closed()

    async with serve(handler, "0.0.0.0", args.port) as server:
        print(f"WebSocket server on ws://0.0.0.0:{args.port}  (Ctrl+C to stop)")
        print(f"Rule: moving if movement >= {MOVING_THRESHOLD}, else still if stillness >= "
              f"{STILL_THRESHOLD}, else nothing; {MIN_DISTANCE_CM}-{MAX_DISTANCE_CM} cm; "
              f"{SMOOTH_S:g} s average. Thresholds from: {THRESHOLD_SOURCE}")
        last_status, last_count, msg = time.time(), 0, None
        while True:
            await asyncio.sleep(1.0 / args.rate)
            now = time.time()
            frame, frame_time, count, avg_m, avg_s = latest.get()

            if frame is None or now - frame_time > STALE_AFTER:
                msg = None  # send nothing, so the dashboard shows "Waiting for data"
            else:
                msg = build_message(frame, avg_m, avg_s, hyst, now)
                broadcast(server.connections, json.dumps(msg))

            if now - last_status >= 1.0:
                fps, last_count, last_status = count - last_count, count, now
                clients = len(server.connections)
                if msg is None:
                    print(f"no radar data      clients={clients}")
                else:
                    print(
                        f"{fps:3d} frames/s  {msg['prediction']:8} "
                        f"motion={'YES' if msg['motion'] else 'no ':3}  "
                        f"strength={msg['strength']:.2f}  distance={msg['distance_m']}  "
                        f"clients={clients}"
                    )


def main():
    p = argparse.ArgumentParser(description="RadarPing LD2410C WebSocket server")
    p.add_argument("source", nargs="?", help="serial port of the ESP32, e.g. COM5")
    p.add_argument("--fake", action="store_true", help="use simulated radar data")
    p.add_argument("--baud", type=int, default=BAUD)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--rate", type=float, default=SEND_RATE, help="messages per second")
    args = p.parse_args()
    if not args.fake and not args.source:
        p.error("give a serial port (e.g. COM5) or --fake")
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
