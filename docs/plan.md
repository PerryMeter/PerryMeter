# RadarPing / RescuePing AI — Hackathon Plan

## Project Overview
Build a portable system that uses Wi-Fi signals from ESP32 boards to detect human movement, potentially through walls, and display detections on a radar-style interface.

**Team:** 5 members
**Hackathon:** natHacks 2026 (November 6–9)
**Duration:** 64 hours
**Main goal:** Build a working prototype that detects human movement using Wi-Fi signals.

## 1. The 4 Main Development Steps

### Step 1 — Hardware Setup
- Connect and configure the ESP32 boards.
- Set up communication between the boards.
- Ensure the required hardware is functioning.

### Step 2 — Signal Collection
- Connect the hardware to a laptop.
- Verify that we're receiving Wi-Fi CSI (Channel State Information) data.
- Confirm that the readings are usable and can be collected consistently.

### Step 3 — Signal Processing & Detection
- Analyze the collected Wi-Fi signals.
- Identify changes in the signals caused by human movement.
- Develop an algorithm to distinguish movement from background noise.
- Attempt to estimate a person's approximate position if the hardware allows it.

This is expected to be the hardest and most important step.

### Step 4 — Frontend & Integration
- Build a radar-style interface.
- Connect the detection algorithm to the interface.
- Display movement detections in real time.
- Add visual indicators, alerts and other improvements if time permits.

## 2. Team Delegation Strategy

Phase 1 — All 5 members: hardware setup (Step 1), collect and verify real CSI data (Step 2), troubleshoot together. Subtasks: hardware connections, firmware setup, debugging, documentation.

Phase 2 — Two teams, once Steps 1 and 2 work:
- Team A (3 members): signal processing and movement detection (Step 3).
- Team B (2 members): frontend and integration prep (Step 4), initially using simulated detection results.

Phase 3 — All 5 members: integrate, test detection, fix bugs and improve accuracy, prepare demo and presentation.

## 3. Proposed Timeline

| Time | Goal |
|---|---|
| Hours 0–6 | Hardware setup and configuration |
| Hours 6–14 | Collect signals and establish basic movement detection |
| Hours 14–26 | Develop detection algorithm and frontend |
| Hours 26–40 | Integrate the complete system |
| Hours 40–52 | Improve accuracy and test through-wall detection |
| Hours 52–64 | Debug, polish, prepare demo and submit |

## 4. Priorities

Must have: ESP32 boards communicating; real Wi-Fi CSI data collected; working movement detection algorithm; live interface showing detections.

Stretch: through-wall detection; approximate direction or position; confidence levels; alerts and improved physical design.

Limitation: movement detection is more realistic than accurate through-wall localization. Prioritize reliable detection first.

## 5. Preparation Before Coding

- Confirm hardware inventory and exact ESP32 model.
- Research ESP32 CSI documentation and examples.
- Decide software and programming tools.
- Make sure everyone has dev tools installed.
- Agree on responsibilities and communication.
- Confirm official coding start time with organizers.

Competition rule: all submitted project code must be developed during the official competition window.

## 6. Workflow

Hardware Setup → Signal Collection → Signal Processing & Detection → Frontend & Integration → Testing & Final Demo
