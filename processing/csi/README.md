# Experimental Wi-Fi CSI Detection

This directory contains earlier Wi-Fi CSI detection experiments developed during PerryMeter's development.

These scripts use recorded or live CSI measurements to explore motion detection and machine-learning approaches.

## Files

| File | Purpose |
|---|---|
| `radarping_core.py` | CSI preprocessing and feature extraction |
| `radarping_live.py` | Experimental live detection and WebSocket output |
| `radarping_record_events.py` | Recording and labelling detection events |
| `train_radarping.py` | Experimental model training |
| `radarping_results/` | Saved experimental model |

## Current Project

The final integrated PerryMeter backend uses **`processing/hub.py`**, which combines Wi-Fi CSI from ESP2 and ESP3 with LD2410C radar measurements.

The scripts in this directory are retained as development and experimental work. They are not required to launch the integrated backend.

See [`../README.md`](../README.md) for the main processing documentation.
