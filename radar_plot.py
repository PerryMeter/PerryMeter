"""Live graph of the HLK-LD2410C radar, plus a text line in the terminal.

Usage:
    python radar_plot.py COM10     (use your port)

Needs:  pip install matplotlib     (pyserial is already installed)
Close the graph window to stop.

Top panel:    distance to the person, in inches.
Bottom panel: movement energy and stillness energy (smoothed), each with a
              dashed line for the radar's threshold at that distance.
              Solid line above its dashed line = the radar counts it as a detection.
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

# ---- settings you can change ------------------------------------------------
BAUD = 921600        # must match Serial.begin(...) in the ESP32 sketch
PRINT_EVERY = 0.4    # seconds between printed lines (0.4 = 2.5 lines per second)
WINDOW_S = 30        # seconds of history shown on the graph
SMOOTH_S = 1.0       # energy is averaged over this many seconds (bigger = smoother, slower)
MAX_DISTANCE_IN = 240  # top of the distance axis (6 m is about 236 in)

# The radar's thresholds per distance gate (gate 0 = 0-0.75 m, gate 1 = 0.75-1.5 m, ...).
# Copied from the HLKRadarTool app's threshold charts (approximate).
# If you change them in the app or run Bottom Noise Detection, update these to match.
MOVING_THRESHOLDS = [50, 50, 40, 30, 20, 15, 15, 15, 15]
STILL_THRESHOLDS = [0, 0, 40, 40, 30, 30, 20, 20, 20]
GATE_CM = 75
# -----------------------------------------------------------------------------

CM_PER_IN = 2.54

# Colours (validated categorical pair, colourblind-safe) and recessive ink
MOVING_C, STILL_C = "#2a78d6", "#eb6834"
INK, QUIET, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"

HEAD = b"\xF4\xF3\xF2\xF1"
TAIL = b"\xF8\xF7\xF6\xF5"
STATES = {0: "nobody", 1: "MOVING", 2: "still", 3: "MOVING + still"}


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


def target_cm(state, m_cm, s_cm):
    """One distance for the person: the moving target if there is one, else the still one."""
    if state in (1, 3):
        return m_cm
    if state == 2:
        return s_cm
    return None


def gate_of(cm):
    return min(len(MOVING_THRESHOLDS) - 1, int(cm // GATE_CM))


def inches(cm):
    return round(cm / CM_PER_IN)


history = collections.deque()  # (time, state, moving_cm, moving_energy, still_cm, still_energy)
lock = threading.Lock()
problems = []


def reader(port):
    """Read frames forever, keep the last WINDOW_S seconds, print a line now and then."""
    try:
        with open_port(port, BAUD) as ser:
            last_print = 0.0
            for state, m_cm, m_en, s_cm, s_en, _ in read_frames(ser):
                now = time.time()
                with lock:
                    history.append((now, state, m_cm, m_en, s_cm, s_en))
                    while history and now - history[0][0] > WINDOW_S + SMOOTH_S:
                        history.popleft()
                if now - last_print >= PRINT_EVERY:
                    last_print = now
                    cm = target_cm(state, m_cm, s_cm)
                    where = f"{inches(cm):4} in" if cm is not None else "   --  "
                    print(
                        f"{STATES.get(state, state):15} distance {where}   "
                        f"moving energy {m_en:3}   still energy {s_en:3}"
                    )
    except Exception as e:  # shown in the graph title too
        problems.append(e)
        print(f"\nCould not use the port: {e}")
        print("Is the Arduino Serial Monitor or another script using it? Close it and try again.")


def smooth(times, values, span):
    """Average of each value with the ones from the previous `span` seconds."""
    out, total, lo = [], 0.0, 0
    for i, (t, v) in enumerate(zip(times, values)):
        total += v
        while times[lo] < t - span:
            total -= values[lo]
            lo += 1
        out.append(total / (i - lo + 1))
    return out


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
    threading.Thread(target=reader, args=(sys.argv[1],), daemon=True).start()

    fig, (ax_d, ax_e) = plt.subplots(2, 1, sharex=True, figsize=(9, 6))
    fig.patch.set_facecolor(SURFACE)
    fig.canvas.manager.set_window_title("RadarPing - LD2410C live")

    style(ax_d, "Distance to person (in)")
    ax_d.set_ylim(0, MAX_DISTANCE_IN)
    (d_line,) = ax_d.plot([], [], color=INK, linewidth=2)

    style(ax_e, f"Energy, {SMOOTH_S:g} s average")
    ax_e.set_ylim(0, 128)  # headroom above 100 keeps the legend off the lines
    ax_e.set_yticks([0, 20, 40, 60, 80, 100])
    ax_e.set_xlim(-WINDOW_S, 0)
    ax_e.set_xlabel("Seconds ago", color=QUIET)
    (e_move,) = ax_e.plot([], [], color=MOVING_C, linewidth=2, label="Movement energy")
    (e_still,) = ax_e.plot([], [], color=STILL_C, linewidth=2, label="Stillness energy")
    (t_move,) = ax_e.plot([], [], color=MOVING_C, linewidth=1.25, linestyle="--",
                          label="Movement threshold")
    (t_still,) = ax_e.plot([], [], color=STILL_C, linewidth=1.25, linestyle="--",
                           label="Stillness threshold")
    ax_e.legend(loc="upper left", frameon=False, labelcolor=INK, ncol=4, fontsize=8.5)

    title = fig.suptitle("Waiting for radar data...", color=INK, fontsize=12)
    lines = (d_line, e_move, e_still, t_move, t_still, title)
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
        times = [r[0] for r in data]
        xs = [t - now for t in times]
        dist = [target_cm(r[1], r[2], r[4]) for r in data]

        d_line.set_data(xs, [c / CM_PER_IN if c is not None else nan for c in dist])

        m_raw = [r[3] if r[1] in (1, 3) else 0 for r in data]
        s_raw = [r[5] if r[1] in (2, 3) else 0 for r in data]
        e_move.set_data(xs, smooth(times, m_raw, SMOOTH_S))
        e_still.set_data(xs, smooth(times, s_raw, SMOOTH_S))

        # Threshold that applies at the person's current distance (gate)
        t_move.set_data(xs, [MOVING_THRESHOLDS[gate_of(c)] if c is not None else nan for c in dist])
        t_still.set_data(xs, [STILL_THRESHOLDS[gate_of(c)] if c is not None else nan for c in dist])

        _, st, m_cm, m_en, s_cm, s_en = data[-1]
        cm = target_cm(st, m_cm, s_cm)
        if cm is None:
            title.set_text("Now: nobody detected")
        else:
            g = gate_of(cm)
            title.set_text(
                f"Now: {STATES.get(st, st)}  |  {inches(cm)} in away  |  "
                f"movement {m_en} (threshold {MOVING_THRESHOLDS[g]})  |  "
                f"stillness {s_en} (threshold {STILL_THRESHOLDS[g]})"
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
