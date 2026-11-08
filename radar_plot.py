"""Live graph of the HLK-LD2410C radar with a moving / still / nothing prediction.

Usage:
    python radar_plot.py COM10     (use your port)

Needs:  pip install matplotlib     (pyserial is already installed)
        radar_settings.py in the same folder (thresholds live there)
Close the graph window to stop.

Top panel:    distance to the person in inches, coloured by the prediction
              (blue = moving, orange = still, gap = nothing).
Bottom panel: movement and stillness energy, averaged, with the two constant
              thresholds from radar_settings.py as dashed lines.
"""
import collections
import math
import struct
import sys
import threading
import time

import matplotlib.pyplot as plt
import serial
from matplotlib.animation import FuncAnimation

from radar_settings import (MAX_DISTANCE_CM, MIN_DISTANCE_CM, MOVING_THRESHOLD,
                            SMOOTH_S, STILL_THRESHOLD, THRESHOLD_SOURCE, classify)

BAUD = 921600          # must match Serial.begin(...) in the ESP32 sketch
PRINT_EVERY = 0.4      # seconds between printed lines (0.4 = 2.5 lines per second)
WINDOW_S = 30          # seconds of history shown on the graph
MAX_DISTANCE_IN = 240  # top of the distance axis (6 m is about 236 in)

CM_PER_IN = 2.54

# Colours (validated categorical pair, colourblind-safe) and recessive ink
MOVING_C, STILL_C = "#2a78d6", "#eb6834"
INK, QUIET, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"

HEAD = b"\xF4\xF3\xF2\xF1"
TAIL = b"\xF8\xF7\xF6\xF5"
LABELS = {"moving": "MOVING", "still": "STILL", "nothing": "nothing"}


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


def inches(cm):
    return round(cm / CM_PER_IN)


# Each entry: (time, moving_cm, moving_energy, still_cm, still_energy,
#              avg_moving_energy, avg_still_energy, prediction, distance_cm)
history = collections.deque()
lock = threading.Lock()
problems = []


def reader(port):
    """Read frames, average the energies, apply the rule, print a line now and then."""
    recent = collections.deque()  # (time, moving_energy, still_energy) for averaging
    try:
        with open_port(port, BAUD) as ser:
            last_print = 0.0
            for _state, m_cm, m_en, s_cm, s_en, _ in read_frames(ser):
                now = time.time()
                recent.append((now, m_en, s_en))
                while now - recent[0][0] > SMOOTH_S:
                    recent.popleft()
                avg_m = sum(r[1] for r in recent) / len(recent)
                avg_s = sum(r[2] for r in recent) / len(recent)
                pred, dist = classify(avg_m, avg_s, m_cm, s_cm)

                with lock:
                    history.append((now, m_cm, m_en, s_cm, s_en, avg_m, avg_s, pred, dist))
                    while history and now - history[0][0] > WINDOW_S:
                        history.popleft()

                if now - last_print >= PRINT_EVERY:
                    last_print = now
                    where = f"{inches(dist):4} in" if dist is not None else "   --  "
                    print(
                        f"{LABELS[pred]:8} distance {where}   "
                        f"movement {avg_m:5.1f} (>= {MOVING_THRESHOLD})   "
                        f"stillness {avg_s:5.1f} (>= {STILL_THRESHOLD})"
                    )
    except Exception as e:  # shown in the graph title too
        problems.append(e)
        print(f"\nCould not use the port: {e}")
        print("Is the Arduino Serial Monitor or another script using it? Close it and try again.")


def style(ax, ylabel):
    ax.set_facecolor(SURFACE)
    ax.set_ylabel(ylabel, color=QUIET)
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.tick_params(colors=QUIET)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)


def main():
    if len(sys.argv) < 2:
        print("Give the ESP32's port, for example:  python radar_plot.py COM10")
        return
    print(f"Rule: moving if movement >= {MOVING_THRESHOLD}, else still if stillness >= "
          f"{STILL_THRESHOLD}, else nothing. Only {MIN_DISTANCE_CM}-{MAX_DISTANCE_CM} cm "
          f"counts. Energy averaged over {SMOOTH_S:g} s.\nThresholds from: {THRESHOLD_SOURCE}\n")
    threading.Thread(target=reader, args=(sys.argv[1],), daemon=True).start()

    fig, (ax_d, ax_e) = plt.subplots(2, 1, sharex=True, figsize=(9, 6))
    fig.patch.set_facecolor(SURFACE)
    fig.canvas.manager.set_window_title("RadarPing - LD2410C live")

    style(ax_d, "Distance to person (in)")
    ax_d.set_ylim(0, MAX_DISTANCE_IN)
    ax_d.axhline(MAX_DISTANCE_CM / CM_PER_IN, color=QUIET, linewidth=1, linestyle=":")
    ax_d.text(-WINDOW_S + 0.5, MAX_DISTANCE_CM / CM_PER_IN + 5,
              f"counted up to {inches(MAX_DISTANCE_CM)} in", color=QUIET, fontsize=8.5)
    (d_move,) = ax_d.plot([], [], color=MOVING_C, linewidth=2.5, label="Moving")
    (d_still,) = ax_d.plot([], [], color=STILL_C, linewidth=2.5, label="Still")
    ax_d.legend(loc="upper right", frameon=False, labelcolor=INK, ncol=2, fontsize=9)

    style(ax_e, f"Energy, {SMOOTH_S:g} s average")
    ax_e.set_ylim(0, 128)  # headroom above 100 keeps the legend off the lines
    ax_e.set_yticks([0, 20, 40, 60, 80, 100])
    ax_e.set_xlim(-WINDOW_S, 0)
    ax_e.set_xlabel("Seconds ago", color=QUIET)
    (e_move,) = ax_e.plot([], [], color=MOVING_C, linewidth=2, label="Movement energy")
    (e_still,) = ax_e.plot([], [], color=STILL_C, linewidth=2, label="Stillness energy")
    ax_e.axhline(MOVING_THRESHOLD, color=MOVING_C, linewidth=1.25, linestyle="--",
                 label=f"Moving threshold ({MOVING_THRESHOLD})")
    ax_e.axhline(STILL_THRESHOLD, color=STILL_C, linewidth=1.25, linestyle="--",
                 label=f"Still threshold ({STILL_THRESHOLD})")
    ax_e.legend(loc="upper left", frameon=False, labelcolor=INK, ncol=4, fontsize=8.5)

    title = fig.suptitle("Waiting for radar data...", color=INK, fontsize=12)
    lines = (d_move, d_still, e_move, e_still, title)
    nan = math.nan

    def update(_):
        with lock:
            data = list(history)
        if problems:
            title.set_text(f"Port problem: {problems[0]}")
            return lines
        if not data:
            return lines

        now = time.time()
        xs = [r[0] - now for r in data]
        d_move.set_data(xs, [r[8] / CM_PER_IN if r[7] == "moving" else nan for r in data])
        d_still.set_data(xs, [r[8] / CM_PER_IN if r[7] == "still" else nan for r in data])
        e_move.set_data(xs, [r[5] for r in data])
        e_still.set_data(xs, [r[6] for r in data])

        _, _, _, _, _, avg_m, avg_s, pred, dist = data[-1]
        where = f"{inches(dist)} in away" if dist is not None else "no one in range"
        title.set_text(
            f"Prediction: {LABELS[pred]}  |  {where}  |  "
            f"movement {avg_m:.0f} (>= {MOVING_THRESHOLD})  |  stillness {avg_s:.0f} (>= {STILL_THRESHOLD})"
        )
        return lines

    _anim = FuncAnimation(fig, update, interval=200, cache_frame_data=False)
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
