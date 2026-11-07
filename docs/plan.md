# RadarPing: Plan

The full, current plan is in [`../project.md`](../project.md). This page is the short version.

## Goal

A portable, camera-free safety fence for temporary work zones (natHacks 2026, Construction & Manufacturing theme): two ESP32 boards on cones form a Wi-Fi tripwire that detects a person entering the zone, an LD2410C radar warns when someone approaches, and a live dashboard alerts the crew.

## Steps

1. **Hardware:** new built-in-antenna ESP32 boards running Espressif's `esp-csi` sender and receiver; sender rate 50 packets/s; quietest channel at the demo spot.
2. **Data:** labelled recordings at the venue (`empty`, `cross`, `approach`, `still`, `crowd`, `covered`).
3. **Detection:** motion-to-noise ratio detector, calibrated on site, scored on held-out recordings.
4. **Radar:** LD2410C read through a spare ESP32, giving approach warnings and distance.
5. **Server:** one Python process fuses both into an alert level (clear, approach, inside) and serves it over WebSocket.
6. **Dashboard:** zone status, arm/disarm, sound, radar animation, activity graph, event log.
7. **Demo:** cones, a taped zone, live walk-in, the towel test, measured results.

## Must have

- Wi-Fi tripwire detecting a person entering, live on the dashboard.
- Measured detection and false-alarm rates.
- A clear 15-minute presentation and a public repo with a README.

## Stretch

- Radar approach warning with distance.
- Second radar facing into the zone for people standing still.
- Second tripwire for entering versus leaving.
- Running on the Raspberry Pi with a kiosk screen.

## Deadline

Monday, Nov 9, 11:00 AM MT (submission form on Discord).
