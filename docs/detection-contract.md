# Detection Message Format

This document describes the data sent from PerryMeter's backend (`processing/hub.py`) to the web dashboard.

The Raspberry Pi processes Wi-Fi CSI and LD2410C radar readings and sends detection updates through WebSocket.

## Connection

- **Protocol:** WebSocket
- **Default port:** `8765`
- **Default update rate:** 10 messages per second
- **Format:** JSON

The backend supports multiple connected dashboard clients.

## Example Message

```json
{
  "t": 1762450000.12,
  "motion": true,
  "strength": 0.81,
  "confidence": 0.88,
  "alert": "inside",
  "distance_m": 1.2,
  "entry_side": "left",
  "links": [
    {
      "id": "left",
      "motion": true,
      "strength": 0.81,
      "rssi": -58,
      "pps": 27
    },
    {
      "id": "right",
      "motion": false,
      "strength": 0.05,
      "rssi": -61,
      "pps": 28
    }
  ],
  "nodes": [
    {"id": "hub", "online": true},
    {"id": "left", "online": true},
    {"id": "right", "online": true},
    {"id": "radar", "online": true}
  ]
}
```

*This is an illustrative message, not a recorded detection result.*

## Message Fields

| Field | Description |
|---|---|
| `t` | Unix timestamp in seconds |
| `motion` | Whether a Wi-Fi side is active or the radar detects movement |
| `strength` | Combined activity indicator from Wi-Fi and radar, between 0 and 1 |
| `confidence` | Backend-generated heuristic indicator, not a validated accuracy percentage |
| `alert` | Current detection status: `clear`, `approach`, or `inside` |
| `distance_m` | Radar-estimated target distance in metres, or `null` |
| `entry_side` | Inferred entry side: `left`, `right`, `base`, or `null` |
| `links` | Activity measurements from the monitored Wi-Fi connections |
| `nodes` | Online status of the hub and sensors |
| `debug` | Additional diagnostic and calibration information |

The integrated backend includes the main detection fields in its messages. The `links` field is included when running with the ESP1 source.

## Detection States

| Status | Meaning |
|---|---|
| `clear` | No detection meeting the configured alert conditions |
| `approach` | Activity detected near a monitored Wi-Fi boundary, or in the optional extended radar approach range |
| `inside` | Presence detected within the configured monitored area, subject to the backend's tracking rules |

A person standing still can produce an `inside` alert even when `motion` is `false`.

## Wi-Fi Link Data

Each active Wi-Fi link can report:

- `id`: `left` or `right`
- `motion`: whether the link's activity threshold has been triggered
- `strength`: normalized link activity indicator
- `rssi`: received signal strength in dBm, when available
- `pps`: packets received per second

The left and right connections correspond to ESP1–ESP2 and ESP1–ESP3.

Wi-Fi activity indicates signal disturbance near a monitored connection. It does not independently prove that someone physically crossed that boundary.

## Sensor Status

The `nodes` field reports the availability of the hub, Wi-Fi links, and radar.

The backend also provides diagnostic information through `debug`, including signal measurements and calibration information.

## Notes

- The default WebSocket update rate is configurable.
- `confidence` and `strength` are indicators calculated by the backend, not measured detection-accuracy percentages.
- Entry-side detection is inferred from the available sensor information and may be unavailable.
- When sensor data becomes unavailable, the backend may stop publishing updates rather than report a false `clear` status.
- The message format is based on the current implementation in `processing/hub.py`.
