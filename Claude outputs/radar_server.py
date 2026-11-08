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
import json
import math
import random
import struct
import threading
import time

from websockets.asyncio.server import broadcast, serve

# ---- settings -------------------------------------------------------------
BAUD = 921600       # must match Serial.begin(...) in the ESP32 sketch
ON_AFTER = 0.3      # seconds of movement before motion turns on
OFF_AFTER = 0.7     # seconds without movement before motion turns off
STALE_AFTER = 1.0   # no radar frame for this long = send nothing
ENERGY_ON = 30      # moving energy (0-100) we treat as clear movement (confidence only)
SEND_RATE = 10      # messages per second to the dashboard (or use --rate)

# ---- detection filters: change these to tune what counts ------------------
MIN_DISTANCE_CM = 0      # ignore targets closer than this (e.g. 50 ignores things right at the radar)
MAX_DISTANCE_CM = 150    # ignore targets farther than this (e.g. 300 = only within 3 m)
MIN_MOVING_ENERGY = 60    # ignore movement weaker than this (0-100)
MIN_STILL_ENERGY = 90     # ignore still targets weaker than this (0-100)

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
    """The most recent radar frame, shared between the reader thread and the server."""

    def __init__(self):
        self._lock = threading.Lock()
        self.frame, self.time, self.count = None, 0.0, 0

    def put(self, frame):
        with self._lock:
            self.frame, self.time = frame, time.time()
            self.count += 1

    def get(self):
        with self._lock:
            return self.frame, self.time, self.count


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


def build_message(frame, hyst, now):
    state, m_cm, m_en, s_cm, s_en, d_cm = frame

    def in_range(cm):
        return MIN_DISTANCE_CM <= cm <= MAX_DISTANCE_CM

    moving = state in (1, 3) and in_range(m_cm) and m_en >= MIN_MOVING_ENERGY
    still = state in (2, 3) and in_range(s_cm) and s_en >= MIN_STILL_ENERGY
    motion = hyst.update(moving, now)

    energy = m_en if moving else 0  # movement that passed the filters
    strength = min(1.0, energy / 100)

    # Heuristic, not a probability: how clearly the energy agrees with the decision.
    margin = min(1.0, abs(energy - ENERGY_ON) / ENERGY_ON)
    agrees = (energy >= ENERGY_ON) == motion
    confidence = 0.5 + 0.5 * margin if agrees else 0.5

    return {
        "t": round(now, 2),
        "motion": motion,
        "strength": round(strength, 3),
        "confidence": round(confidence, 3),
        # extra fields (the dashboard ignores ones it does not know)
        "present": moving or still,
        "distance_m": round((m_cm if moving else s_cm) / 100, 2) if (moving or still) else None,
        "moving_energy": m_en,
        "still_energy": s_en,
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
        last_status, last_count, msg = time.time(), 0, None
        while True:
            await asyncio.sleep(1.0 / args.rate)
            now = time.time()
            frame, frame_time, count = latest.get()

            if frame is None or now - frame_time > STALE_AFTER:
                msg = None  # send nothing, so the dashboard shows "Waiting for data"
            else:
                msg = build_message(frame, hyst, now)
                broadcast(server.connections, json.dumps(msg))

            if now - last_status >= 1.0:
                fps, last_count, last_status = count - last_count, count, now
                clients = len(server.connections)
                if msg is None:
                    print(f"no radar data      clients={clients}")
                else:
                    print(
                        f"{fps:3d} frames/s  {STATES.get(frame[0], frame[0]):15} "
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
