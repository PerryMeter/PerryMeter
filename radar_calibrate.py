"""Room calibration for the RadarPing radar, like Bottom Noise Detection in the app.

With nobody in front of the radar, it measures how high the movement and
stillness energy go in the empty room, then sets each threshold a safe margin
above that. The result is saved to radar_calibration.json, which radar_plot.py
and radar_server.py load automatically (through radar_settings.py).

Usage:
    python radar_calibrate.py COM10                 (use your port)
    python radar_calibrate.py COM10 --seconds 30    (measure for longer)

Re-run it whenever the radar is moved or you are in a new room.
"""
import argparse
import collections
import datetime
import json
import struct
import time

import serial

from radar_settings import CALIBRATION_FILE, MAX_DISTANCE_CM, MIN_DISTANCE_CM, SMOOTH_S

BAUD = 921600        # must match Serial.begin(...) in the ESP32 sketch
MARGIN = 10          # threshold = empty-room level (99th percentile) + this many points
FLOOR = 20           # never set a threshold lower than this
HEAD = b"\xF4\xF3\xF2\xF1"
TAIL = b"\xF8\xF7\xF6\xF5"


def open_port(port, baud):
    """Open the port without toggling DTR/RTS, so the ESP32 is not reset or held in reset."""
    ser = serial.Serial()
    ser.port, ser.baudrate, ser.timeout = port, baud, 1
    ser.dtr = False
    ser.rts = False
    ser.open()
    return ser


def read_frames(ser):
    """Yield (state, moving_cm, moving_energy, still_cm, still_energy, detect_cm)."""
    buf = b""
    while True:
        buf += ser.read(ser.in_waiting or 1)
        while True:
            start = buf.find(HEAD)
            if start < 0:
                buf = buf[-3:]
                break
            if len(buf) < start + 6:
                buf = buf[start:]
                break
            n = struct.unpack_from("<H", buf, start + 4)[0]
            if n > 200:
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


def percentile(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


def in_range(cm):
    return MIN_DISTANCE_CM <= cm <= MAX_DISTANCE_CM


def main():
    ap = argparse.ArgumentParser(description="Measure the empty room and set radar thresholds")
    ap.add_argument("port", help="serial port of the ESP32, e.g. COM10")
    ap.add_argument("--seconds", type=float, default=20, help="how long to measure (default 20)")
    ap.add_argument("--delay", type=int, default=10, help="countdown to leave the area (default 10)")
    args = ap.parse_args()

    print("Room calibration: everyone must be out of the radar's view (or out of the room).")
    for left in range(args.delay, 0, -1):
        print(f"  starting in {left} s...", end="\r")
        time.sleep(1)
    print(f"Measuring the empty room for {args.seconds:g} s. Stay out of view.        ")

    recent = collections.deque()      # (time, moving_energy, still_energy) for the average
    avg_moving, avg_still = [], []    # averaged energies, as the live programs see them
    with open_port(args.port, BAUD) as ser:
        ser.reset_input_buffer()
        start = time.time()
        last_print = start
        for _state, m_cm, m_en, s_cm, s_en, _ in read_frames(ser):
            now = time.time()
            if now - start > args.seconds:
                break
            # Energy from a target outside the counted distances can never trigger, so it is 0 here
            recent.append((now, m_en if in_range(m_cm) else 0, s_en if in_range(s_cm) else 0))
            while now - recent[0][0] > SMOOTH_S:
                recent.popleft()
            if now - start >= SMOOTH_S:  # skip the first moment, before the average fills up
                avg_moving.append(sum(r[1] for r in recent) / len(recent))
                avg_still.append(sum(r[2] for r in recent) / len(recent))
            if now - last_print >= 1:
                last_print = now
                print(f"  {now - start:4.0f} s   movement {m_en:3}   stillness {s_en:3}")

    if len(avg_moving) < 20:
        print("\nToo few radar readings. Is the bridge sketch flashed and nothing else using the port?")
        return

    empty_m, empty_s = percentile(avg_moving, 99), percentile(avg_still, 99)
    moving_t = round(min(100, max(FLOOR, empty_m + MARGIN)))
    still_t = round(min(100, max(FLOOR, empty_s + MARGIN)))

    result = {
        "moving_threshold": moving_t,
        "still_threshold": still_t,
        "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "seconds_measured": args.seconds,
        "readings": len(avg_moving),
        "empty_room_movement_p99": round(empty_m, 1),
        "empty_room_movement_max": round(max(avg_moving), 1),
        "empty_room_stillness_p99": round(empty_s, 1),
        "empty_room_stillness_max": round(max(avg_still), 1),
        "margin": MARGIN,
        "floor": FLOOR,
        "distance_range_cm": [MIN_DISTANCE_CM, MAX_DISTANCE_CM],
    }
    with open(CALIBRATION_FILE, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\nEmpty room, highest levels (99th percentile of the {SMOOTH_S:g} s average):")
    print(f"  movement  {empty_m:5.1f}   ->  moving threshold {moving_t}")
    print(f"  stillness {empty_s:5.1f}   ->  still threshold  {still_t}")
    print(f"Saved to {CALIBRATION_FILE}")
    print("radar_plot.py and radar_server.py will use these next time they start.")
    for name, t in (("moving", moving_t), ("still", still_t)):
        if t >= 95:
            print(f"\nWarning: the {name} threshold is {t}, so almost nothing can go above it.")
            print("Something in view was moving or very close to the radar (a fan, a person, the")
            print("laptop, its own wires). Clear the area, or shorten MAX_DISTANCE_CM, and run again.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped. Nothing was saved.")
    except serial.SerialException as e:
        print(f"\nCould not use the port: {e}")
        print("Close the Arduino Serial Monitor and any other radar script, then try again.")
