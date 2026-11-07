# Perrymeter: Plan

The full, current plan is in [`../project.md`](../project.md). This page is the short version.

## Goal

A portable, camera-free safety perimeter for temporary work zones (natHacks 2026, Construction & Manufacturing theme): a **danger triangle** of three cones. Two Wi-Fi sides detect people crossing, an LD2410C radar at the top corner watches the inside, and a live dashboard alerts the crew and shows which side was crossed.

## Steps

1. **Hardware:** hub (Pi, receiver ESP32, radar) and two node ESP32s with their own sender addresses, 30 packets per second each, on the quietest channel.
2. **Data:** labelled recordings per side at the venue (`empty`, `cross-left`, `cross-right`, `inside-still`, `near`, `crowd`, `covered`).
3. **Detection:** one motion-to-noise ratio detector per side, calibrated on site, scored on held-out recordings.
4. **Radar:** inside presence and distance from the hub.
5. **Server:** fuses the sides and the radar into an alert level and per-side detail, served over WebSocket.
6. **Dashboard:** triangle map, zone status, node health, arm/disarm, sound, activity graph, event log.
7. **Business:** monthly kit rental, expansion kits, worker tags (plans).
8. **Demo:** three cones, a taped zone, live crossings per side, standing still inside, the towel test, measured results.

## Must have

- At least one Wi-Fi side detecting a person crossing, live on the dashboard.
- Measured detection and false-alarm rates.
- A clear 15-minute presentation including the business model, and a public repo with a README.

## Stretch

- Second side and per-side alerts.
- Radar inside presence and distance.
- Running on the Raspberry Pi with a kiosk screen.
- Worker tag prototype.

## Deadline

Monday, Nov 9, 11:00 AM MT (submission form on Discord).
