"""Arming and the physical ringer, used by processing/hub.py.

ArmState
    Whether the zone is armed. The dashboards change it with
    {"type": "set_armed", "armed": false, "pin": "6767"}, and only with the right PIN (ARM_PIN).
    The state is saved in processing/hub_state.json, so a hub restart keeps it. Every wrong PIN
    adds to a counter that the dashboard watches to show "Wrong PIN". After MAX_TRIES wrong PINs
    in a row, the hub ignores set_armed for LOCKOUT_S.

Ringer
    A passive buzzer on a Raspberry Pi GPIO pin: GPIO18, physical pin 12. Holding the pin high
    makes no sound on a passive buzzer, because it needs a tone. So the pin plays a RINGER_HZ
    square wave using lgpio's software PWM.
    It sounds in a pattern while the zone is armed and shows ALERT. It also chirps twice when
    the zone is armed and once when it is disarmed.
    On a computer without lgpio (a laptop), it does nothing.
"""
import atexit
import hmac
import json
import os
import sys
import threading

ARM_PIN = "6767"
MAX_TRIES = 5          # wrong PINs in a row before the lockout
LOCKOUT_S = 30.0
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hub_state.json")

RINGER_PIN = 18        # BCM numbering (physical pin 12); 0 turns the ringer off
RINGER_HZ = 2000       # the tone a passive buzzer needs; 2 kHz was heard in the test on the Pi
ALARM_ON_S, ALARM_OFF_S = 0.4, 0.2
CHIRP_ON_S, CHIRP_OFF_S = 0.08, 0.12
MAX_QUEUED_CHIRPS = 4


class ArmState:
    def __init__(self, path=STATE_FILE):
        self.path = path
        self.armed = True             # armed unless a saved state says otherwise
        self.changed_at = None
        self.rejections = 0           # wrong PINs since the hub started
        self._wrong_in_row = 0
        self._locked_until = 0.0
        self._load()

    def _load(self):
        try:
            with open(self.path) as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("armed"), bool):
                self.armed = data["armed"]
                self.changed_at = data.get("changed_at")
        except (OSError, ValueError):
            pass

    def _save(self):
        try:
            with open(self.path, "w") as f:
                json.dump({"armed": self.armed, "changed_at": self.changed_at}, f)
        except OSError as e:
            print(f"arm: could not save {self.path} ({e})", flush=True)

    def locked_s(self, now):
        return max(0.0, self._locked_until - now)

    def request(self, armed, pin, now, when_text):
        """Arm or disarm. Returns "ok", "wrong_pin", "locked" or "invalid"."""
        if not isinstance(armed, bool):
            return "invalid"
        if self.locked_s(now) > 0:
            return "locked"
        if not isinstance(pin, str) or not hmac.compare_digest(pin.encode(), ARM_PIN.encode()):
            self.rejections += 1
            self._wrong_in_row += 1
            if self._wrong_in_row >= MAX_TRIES:
                self._wrong_in_row = 0
                self._locked_until = now + LOCKOUT_S
            return "wrong_pin"
        self._wrong_in_row = 0
        if armed != self.armed:
            self.armed = armed
            self.changed_at = when_text
            self._save()
        return "ok"

    def status(self, now):
        return {"armed": self.armed, "changed_at": self.changed_at, "rejections": self.rejections,
                "locked_s": round(self.locked_s(now), 1)}


def _load_lgpio():
    try:
        import lgpio
        return lgpio
    except ImportError:
        pass
    # The hub's virtual environment does not see the system packages, where Raspberry Pi OS keeps lgpio
    system = "/usr/lib/python3/dist-packages"
    if not os.path.isdir(system):
        return None
    sys.path.append(system)
    try:
        import lgpio
        return lgpio
    except ImportError:
        return None
    finally:
        sys.path.remove(system)


class Ringer:
    def __init__(self, pin=RINGER_PIN, hz=RINGER_HZ):
        self.pin, self.hz = pin, hz
        self.state = "off"            # off (no pin), unavailable, ready, error
        self.reason = None
        self._lg = self._h = None
        self._alarm = False
        self._chirps = 0
        self._stop = False
        self._closed = False
        self._cv = threading.Condition()
        self._thread = None
        if not pin:
            return
        lg = _load_lgpio()
        if lg is None:
            self.state, self.reason = "unavailable", "lgpio not installed"
            return
        for chip in (0, 4):           # Pi 4 and older: gpiochip0; Pi 5 on older kernels: gpiochip4
            try:
                h = lg.gpiochip_open(chip)
            except Exception:
                continue
            try:
                lg.gpio_claim_output(h, pin, 0)
            except Exception as e:
                self.reason = str(e)
                lg.gpiochip_close(h)
                continue
            self._lg, self._h = lg, h
            break
        if self._h is None:
            self.state = "unavailable"
            self.reason = self.reason or "no GPIO chip"
            return
        self.state = "ready"
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        atexit.register(self.close)

    @property
    def sounding(self):
        return self.state == "ready" and self._alarm

    def describe(self):
        if self.state == "ready":
            return f"GPIO{self.pin}, {self.hz} Hz tone"
        if self.state == "off":
            return "off (--ringer-pin 0)"
        return f"{self.state} ({self.reason})"

    def status(self):
        return {"pin": self.pin or None, "state": self.state, "sounding": self.sounding}

    def set_alarm(self, on):
        on = bool(on)
        with self._cv:
            if on == self._alarm:
                return
            self._alarm = on
            if on:
                self._chirps = 0
            self._cv.notify()

    def chirp(self, n):
        with self._cv:
            if self.state != "ready" or self._alarm:
                return
            self._chirps = min(MAX_QUEUED_CHIRPS, self._chirps + n)
            self._cv.notify()

    def _tone(self, on):
        if on:
            self._lg.tx_pwm(self._h, self.pin, self.hz, 50)
        else:
            self._lg.tx_pwm(self._h, self.pin, 0, 0)
            self._lg.gpio_write(self._h, self.pin, 0)

    def _pause(self, seconds):
        """Wait, but return early when the hub stops. True if it is stopping."""
        with self._cv:
            return self._cv.wait_for(lambda: self._stop, timeout=seconds)

    def _run(self):
        try:
            while True:
                with self._cv:
                    self._cv.wait_for(lambda: self._stop or self._alarm or self._chirps > 0)
                    if self._stop:
                        return
                    if self._alarm:
                        on_s, off_s = ALARM_ON_S, ALARM_OFF_S
                    else:
                        self._chirps -= 1
                        on_s, off_s = CHIRP_ON_S, CHIRP_OFF_S
                self._tone(True)
                stopping = self._pause(on_s)
                self._tone(False)
                if stopping or self._pause(off_s):
                    return
        except Exception as e:      # never take the hub down because of the ringer
            self.state, self.reason = "error", str(e)
            print(f"ringer: stopped ({e})", flush=True)

    def close(self):
        if self._closed or self._h is None:
            return
        self._closed = True
        with self._cv:
            self._stop = True
            self._cv.notify()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        try:
            self._tone(False)
            self._lg.gpio_free(self._h, self.pin)
            self._lg.gpiochip_close(self._h)
        except Exception:
            pass
