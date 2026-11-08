# RadarPing - Wi-Fi CSI

Experimental Wi-Fi CSI motion detection using two ESP32s and Python.

## Hardware
- NESP: Wi-Fi sender (USB power)
- OESP: CSI receiver (USB serial, previously COM6)
- Wi-Fi channel 11

## Setup
Run from this folder:

python -m pip install -r requirements.txt
python radarping_live.py --port COM6

## Files
- radarping_core.py: CSI preprocessing and features
- radarping_live.py: Live ML detection and WebSocket server (port 8765)
- radarping_record_events.py: Labelled data recording
- train_radarping.py: Experimental model training
- radarping_results/: Saved experimental ML model

## Limitations
The live detector uses an older experimental model.
The newer controlled-test model is not integrated yet.
Crossing detection remains unreliable across environments.
Not a safety-certified system.
