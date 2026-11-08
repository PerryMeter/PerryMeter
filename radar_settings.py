"""Shared radar settings for radar_plot.py and radar_server.py.

Change the numbers here only: both programs read them, so the graph and the
dashboard always use the same rules.

The rule (checked on energy averaged over SMOOTH_S seconds):
    movement energy >= MOVING_THRESHOLD      -> "moving"
    else stillness energy >= STILL_THRESHOLD -> "still"
    else                                     -> "nothing"
A target outside MIN_DISTANCE_CM..MAX_DISTANCE_CM counts as "nothing".

Room calibration: run  python radar_calibrate.py COM10  with nobody in front of
the radar. It saves radar_calibration.json, and the thresholds below are then
replaced by the calibrated ones automatically. Delete that file (or set
USE_CALIBRATION = False) to go back to the fixed numbers.
"""
import json
import os

# Fixed thresholds, used when there is no calibration file
MOVING_THRESHOLD = 60    # movement energy (0-100) at or above this = someone moving
STILL_THRESHOLD = 90     # stillness energy (0-100) at or above this = someone still

USE_CALIBRATION = True   # use radar_calibration.json when it exists
SMOOTH_S = 1.0           # energy is averaged over this many seconds (bigger = steadier, slower)

MIN_DISTANCE_CM = 0      # ignore targets closer than this (e.g. 50 ignores things right at the radar)
MAX_DISTANCE_CM = 150    # ignore targets farther than this (150 cm is about 59 in)

CALIBRATION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "radar_calibration.json")
THRESHOLD_SOURCE = "fixed numbers in radar_settings.py"

if USE_CALIBRATION and os.path.exists(CALIBRATION_FILE):
    try:
        with open(CALIBRATION_FILE) as f:
            _cal = json.load(f)
        MOVING_THRESHOLD = _cal["moving_threshold"]
        STILL_THRESHOLD = _cal["still_threshold"]
        THRESHOLD_SOURCE = f"room calibration from {_cal.get('created', 'unknown time')}"
    except (OSError, ValueError, KeyError) as e:
        print(f"Could not read {CALIBRATION_FILE} ({e}); using the fixed thresholds.")


def classify(moving_energy, still_energy, moving_cm, still_cm):
    """Return (prediction, distance_cm). Energies should already be averaged."""
    if moving_energy >= MOVING_THRESHOLD and MIN_DISTANCE_CM <= moving_cm <= MAX_DISTANCE_CM:
        return "moving", moving_cm
    if still_energy >= STILL_THRESHOLD and MIN_DISTANCE_CM <= still_cm <= MAX_DISTANCE_CM:
        return "still", still_cm
    return "nothing", None
