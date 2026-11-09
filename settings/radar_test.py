"""Read an HLK-LD2410C radar through the ESP32 bridge and print what it sees.

Usage:
    python radar_test.py          lists the serial ports on this computer
    python radar_test.py COM5     reads the radar on COM5 (use your port)

Press Ctrl+C to stop.
"""
import struct
import sys
import time

import serial
from serial.tools import list_ports

BAUD = 921600       # must match Serial.begin(...) in the ESP32 sketch
PRINT_EVERY = 0.4   # seconds between printed lines (0.4 = 2.5 lines per second)
HEAD = b"\xF4\xF3\xF2\xF1"
TAIL = b"\xF8\xF7\xF6\xF5"
STATES = {0: "nobody", 1: "MOVING", 2: "still", 3: "MOVING + still"}


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


def open_port(port, baud):
    """Open the port without toggling DTR/RTS, so the ESP32 is not reset or held in reset."""
    ser = serial.Serial()
    ser.port, ser.baudrate, ser.timeout = port, baud, 1
    ser.dtr = False
    ser.rts = False
    ser.open()
    return ser


def main():
    if len(sys.argv) < 2:
        print("Serial ports on this computer:")
        for p in list_ports.comports():
            print(f"  {p.device:8} {p.description}")
        print("\nRun again with the ESP32's port, for example:  python radar_test.py COM5")
        return

    port = sys.argv[1]
    with open_port(port, BAUD) as ser:
        print(f"Listening on {port}. Walk around in front of the radar. Ctrl+C to stop.\n")
        last_print = 0.0
        for state, m_cm, m_en, s_cm, s_en, _ in read_frames(ser):
            now = time.time()
            if now - last_print < PRINT_EVERY:
                continue  # the radar sends ~10 frames/s; only print some of them
            last_print = now
            print(
                f"{STATES.get(state, state):15} "
                f"moving: {m_cm:4} cm, energy {m_en:3}   "
                f"still: {s_cm:4} cm, energy {s_en:3}"
            )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except serial.SerialException as e:
        print(f"\nCould not use the port: {e}")
        print("Is the Arduino Serial Monitor still open? Close it and try again.")
