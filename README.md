# PerryMeter

**A camera-free safety monitoring system for temporary hazardous work zones.**

PerryMeter is a portable, multi-sensor prototype developed for **natHacks 2026** under the Construction & Manufacturing theme.

It combines ESP32 Wi-Fi Channel State Information (CSI) with an LD2410C 24 GHz radar sensor to monitor a triangular hazardous area.

The ESP32 devices establish two wireless detection boundaries, while the radar monitors the space between them, including people who remain stationary. These sensing methods complement each other: Wi-Fi CSI helps identify boundary crossings, while radar provides additional presence detection within the monitored area.

A Raspberry Pi processes the sensor data and sends live updates to a browser-based dashboard, allowing operators to monitor activity without using cameras.

## Pitch Deck

Our natHacks 2026 pitch deck is in this repository: [`docs/PerryMeter_PitchDeck.pptx`](docs/PerryMeter_PitchDeck.pptx) (12 slides, about 40 MB). It covers the problem, the three-cone solution, how it works, impact, the tech stack, next steps, scalability, the demo and our sources.

GitHub cannot preview PowerPoint files in the browser, so download the deck first:

- **Direct download:** [PerryMeter_PitchDeck.pptx](https://github.com/PerryMeter/PerryMeter/raw/main/docs/PerryMeter_PitchDeck.pptx)
- **From GitHub:** open [`docs/PerryMeter_PitchDeck.pptx`](docs/PerryMeter_PitchDeck.pptx), then click **View raw** or the download button.
- **From a clone:** after `git clone`, it is at `docs/PerryMeter_PitchDeck.pptx`.

Open it with Microsoft PowerPoint, Keynote or LibreOffice Impress. For Google Slides, upload it to Google Drive, then choose **Open with > Google Slides**.

## How It Works

PerryMeter uses three ESP32 devices, one LD2410C radar sensor, and a Raspberry Pi.

**1. Wi-Fi boundary detection**

- ESP2 and ESP3 transmit Wi-Fi signals to ESP1.
- ESP1 collects CSI measurements from both connections.
- Changes in the wireless signals are analyzed to detect movement across the two monitored sides.
- The system can distinguish which monitored boundary has been crossed.

**2. Radar-based presence detection**

- The LD2410C radar is connected to ESP1.
- The radar monitors the interior of the triangular area.
- It provides additional presence detection, including for stationary people.

**3. Data processing**

- The Raspberry Pi processes the incoming sensor information.
- Wi-Fi CSI and radar measurements are used together to determine the monitored zone's status.
- The processing system sends updates to the dashboard.

**4. Live monitoring dashboard**

The browser-based dashboard provides:

- Live detection status: Clear, Approach, or Inside
- Side-specific boundary detection
- Signal strength and confidence information
- Arm/disarm controls

The two Wi-Fi connections monitor two sides of the triangular arrangement. The radar complements them by monitoring the interior; there is no separate Wi-Fi detection link between ESP2 and ESP3.

## System Architecture

```text
       ESP2                  ESP3
    (Transmitter)         (Transmitter)
          \                  /
           \  Wi-Fi CSI     /
            \              /
             \            /
              ESP1
       (Receiver + LD2410C)
                 |
                 v
           Raspberry Pi
        (Signal Processing)
                 |
                 v
           WebSocket Server
                 |
                 v
          Web Dashboard
      (Live Safety Monitoring)
```

## Repository Structure

| Path | Purpose |
|---|---|
| `firmware/` | ESP32 sender and receiver firmware |
| `collection/` | CSI data collection and recording |
| `processing/` | Sensor processing, detection logic, and backend server |
| `frontend/web/` | Web dashboard built with React, TypeScript, and Vite |
| `data/` | Recorded CSI datasets and related documentation |
| `docs/` | Technical documentation and the pitch deck |
| `project.md` | Additional project design and development notes |
| `frontend/pi_display/` | Earlier PySide6 dashboard prototype |

## Getting the Code

```bash
git clone https://github.com/PerryMeter/PerryMeter.git
cd PerryMeter
```

## Running the Prototype

The system consists of three main components:

1. **ESP32 firmware:** Configure and flash the sender and receiver firmware in `firmware/`.
2. **Raspberry Pi backend:** Connect the receiving ESP32 and launch the processing service using the instructions in `processing/README.md`.
3. **Web dashboard:** Start the frontend development server.

The dashboard's documented local development commands are:

```bash
cd frontend/web
npm install
npm run dev
```

The firmware configuration and Raspberry Pi startup commands must be checked against the final hardware setup before deployment.

## Intended Application

PerryMeter is designed as an additional monitoring layer for temporary hazardous work zones, particularly in construction and manufacturing environments.

Its purpose is to help workers and supervisors become aware of movement near monitored boundaries and presence within designated areas without requiring cameras or wearable tags.

Potential applications include temporary maintenance zones, restricted equipment areas, and other locations where an extra layer of activity monitoring could be useful.

## Prototype Scope and Limitations

PerryMeter is a hackathon prototype, not a certified industrial safety system.

- Wi-Fi CSI provides monitoring along two configured wireless links, not unrestricted detection throughout the surrounding environment.
- Interior detection depends on the radar's sensing coverage and placement.
- Detection performance can vary with the environment, sensor positioning, and calibration.
- Response time, detection accuracy, and reliability under industrial conditions require further validation.

The system is intended to supplement, not replace, established workplace safety procedures and physical barriers.

## Development

Built by a team of six during **natHacks 2026**, November 6–9, 2026.


## Acknowledgements

- [Espressif ESP-CSI](https://github.com/espressif/esp-csi) — Wi-Fi CSI reference project.
- Hi-Link LD2410C — 24 GHz radar sensor.
