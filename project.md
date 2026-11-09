# PerryMeter — Project Guide

**PerryMeter** is a camera-free safety monitoring prototype developed for **natHacks 2026**, under the Construction & Manufacturing theme.

Originally called RadarPing, the project explores how Wi-Fi sensing and radar can work together to monitor temporary hazardous work zones.

## 1. The Problem

Construction and manufacturing environments often contain temporary hazardous areas where workers should avoid entering while certain activities are taking place.

Physical barriers, cones, and warning signs help define these areas but do not automatically detect movement or notify supervisors when someone approaches or enters.

PerryMeter explores an additional monitoring layer that does not require cameras or wearable devices.

## 2. Our Solution

PerryMeter combines two complementary sensing technologies:

- **Wi-Fi Channel State Information (CSI):** Detects disturbances along two monitored wireless boundaries.
- **LD2410C Radar:** Provides additional presence detection within the monitored area, including for people standing still.

Together, these sensors form a triangular monitoring arrangement that we call the **Danger Triangle**.

The system processes incoming sensor data and displays detection results through a live dashboard.

## 3. System Architecture

PerryMeter uses three ESP32 devices, one LD2410C radar sensor, and a Raspberry Pi.

```text
       ESP2             ESP3
    (Wi-Fi TX)        (Wi-Fi TX)
          \             /
           \           /
            \         /
               ESP1
       (Wi-Fi RX + Radar)
                 |
                 | USB
                 v
           Raspberry Pi
          (Processing)
                 |
                 | WebSocket
                 v
           Web Dashboard
```

### ESP32 Boundary Monitoring

- ESP2 and ESP3 transmit Wi-Fi signals to ESP1.
- ESP1 collects CSI measurements from both connections.
- The backend analyzes signal disturbances near each monitored boundary.
- The software uses these measurements to help infer entry and exit events.

### Radar Presence Detection

- The LD2410C is connected to ESP1.
- It detects moving and stationary presence within its configured sensing range.
- Radar readings complement the Wi-Fi boundary measurements.

### Raspberry Pi Processing

The Raspberry Pi runs the processing backend, which combines sensor readings and sends updates to the dashboard.

The integrated backend is implemented in `processing/hub.py`.

## 4. Danger Triangle

The two Wi-Fi links form the left and right monitored boundaries.

The radar, positioned at the hub, faces toward the interior of the triangular arrangement.

There is no separate Wi-Fi connection monitoring the third side. Interior monitoring relies on the radar's configured coverage and the backend's detection logic.

**Sensor placement and calibration affect detection performance.**

## 5. Detection and Alerts

PerryMeter reports three detection states:

| State | Meaning |
|---|---|
| `clear` | No activity meeting the configured alert conditions |
| `approach` | Activity near a monitored Wi-Fi boundary |
| `inside` | Presence detected within the monitored area, subject to the backend's tracking rules |

The backend can also infer an entry side from the available sensor information.

A Wi-Fi signal disturbance does not always mean someone physically crossed a boundary. The system uses radar and Wi-Fi measurements together to interpret activity.

## 6. Live Dashboard

The dashboard provides an interface for monitoring the system.

Its confirmed core features include:

- Live detection status
- Wi-Fi boundary activity information
- Sensor strength and confidence indicators
- Arm/disarm controls

The backend communicates with the dashboard through WebSocket.

## 7. Calibration

The processing backend supports calibration using readings collected while the monitored area is empty.

Calibration establishes reference measurements and detection thresholds for the Wi-Fi connections and radar.

The system's performance may change when sensors are repositioned or surrounding conditions change.

Additional implementation details are available in [`processing/README.md`](processing/README.md).

## 8. Project Structure

| Directory | Purpose |
|---|---|
| `firmware/` | ESP32 firmware |
| `collection/` | CSI data recording tools |
| `processing/` | Detection logic and backend |
| `frontend/web/` | Web-based monitoring dashboard |
| `data/` | CSI recordings and related documentation |
| `docs/` | Supporting technical documentation |

The main backend is `processing/hub.py`.

The WebSocket detection message format is documented in [`docs/detection-contract.md`](docs/detection-contract.md).

## 9. Intended Use and Limitations

PerryMeter is intended as a prototype for monitoring temporary hazardous areas in construction and manufacturing settings.

It demonstrates how two sensing methods can complement one another without relying on video recording.

However:

- Detection performance depends on sensor placement and environmental conditions.
- The system does not provide precise human localization.
- Boundary activity and inferred entry events are not guaranteed to represent actual physical crossings.
- Industrial reliability and performance have not been fully validated.

**PerryMeter is a hackathon prototype, not a certified safety system.** It is intended to supplement, not replace, existing workplace safety measures.

## 10. Development

Developed by a team of six during **natHacks 2026**, November 6–9, 2026.

Originally named RadarPing.
