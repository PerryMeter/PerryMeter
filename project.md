# RadarPing: Project Guide

Everything the team needs in one place: what we are building, why, how each part works, who does what, and how we demo it. **Read sections 1 to 4 even if you only work on one part.**

This file replaces `docs/plan.md`. Section 7 is the message format between the two teams (also in `docs/detection-contract.md`).

**Status (Friday night, Nov 6):**
- Direction chosen: **Construction & Manufacturing** theme, a safety fence for **temporary work zones** (section 1).
- Hardware: the first Feather boards had a missing antenna; replacement ESP32 boards and two LD2410C radar sensors are ordered (section 5).
- Team A: recorder and first detector built, on branch `cursor/csi-recorder-and-detection-7673` (section 8).
- Team B: dashboard phases 1 to 5 of 10 done, on branch `frontend/web-dashboard` (section 11).

### Competition essentials (natHacks 2026 Official Rules)

- **Deadline: Monday, Nov 9, 11:00 AM MT,** through the submission form posted on Discord. Hardware kits go back by 7:00 PM that day.
- **Theme:** prizes are awarded per theme. We enter **Construction & Manufacturing**, whose description lists "worker safety" and "site monitoring".
- **Submission:** an "About the project" text (3000 characters), a summary (1300 characters), a **public** GitHub repo with a README (concept, how to run it, credits), and a **15-minute in-person presentation plus 5 minutes of questions**.
- **All code must be written during the event** (from 7:00 PM MT, Nov 6). The repo's first commits (READMEs and plans, no code) were made about an hour before the start; mention this to an organizer to be safe. Credit Espressif's `esp-csi` firmware and confirm with an organizer that using it unmodified is fine.
- **The judging rubric is in the Participant Handbook.** Get it and shape the pitch around it.

---

## Contents

1. The pitch
2. What we can and cannot claim
3. How it works, step by step
4. System overview and team
5. Hardware
6. Reading the CSI data
7. The message format between Team A and Team B
8. Wi-Fi detection (Team A)
9. The radar sensor (LD2410C)
10. The processing server (Team A)
11. The dashboard (Team B)
12. Integration plan
13. Running it on the Raspberry Pi
14. Demo and presentation
15. Judge questions to prepare for
16. Timeline
17. Risks and fallbacks
18. Repo, branches and workflow
19. Glossary

---

## 1. The pitch

**One line:** RadarPing turns ordinary traffic cones into an invisible safety fence for temporary work zones. It warns the crew the moment someone walks in, through dust, mud and darkness.

**The story (30 seconds):**

> Every day, crews set up temporary danger zones: around a crane lift, an open excavation, or a machine working in one spot. They mark them with cones and tape, and nothing warns anyone when someone walks in. Being struck by equipment and being caught in or between machinery are two of OSHA's "Focus Four" construction hazards [add a real Alberta or Canadian statistic, with its source].
>
> Today's protections all have gaps. Cones and tape get ignored. Cameras need a clean lens and someone watching. Optical safety sensors are expensive, fixed in place and need a clear line of sight. Tags only work if every worker wears one. Permanent systems aren't worth installing for a zone that moves tomorrow.
>
> RadarPing puts two small Wi-Fi boards on two cones. The signal between them becomes an invisible tripwire. When a person crosses it, their body disturbs the signal and RadarPing alerts the operator and the crew within about a second. A small radar sensor adds an early warning when someone approaches. It runs on power banks, sets up in minutes, works through dust, mud and darkness, and records no video of anyone.

**Example zones for a slide:** crane lift zone, excavator swing area, open trench edge (construction); robot cell, press, conveyor transfer point (manufacturing). Lead with construction; mention the rest as "the same fence works anywhere people must stay out of a zone".

**Rules for the story:**
- Never invent a number. Every statistic on a slide gets a source.
- Never say "first ever" or "nobody has done this" (section 15 lists what exists).
- Only claim what the demo shows. Things we have not demonstrated go under "next steps".

---

## 2. What we can and cannot claim

| We can claim (once tested) | We cannot claim |
|---|---|
| Detects a person entering the zone across the Wi-Fi line | Who the person is, or a person versus a vehicle |
| Works through dust, smoke, darkness and a covering cloth (demo it) | Works through concrete, metal or across long distances |
| Radar warns when someone approaches and reports their distance | Exact position or direction on a map |
| Radar keeps detecting someone standing still (if we demo it) | Counting people |
| Detection and false-alarm rates from our own recordings | Accuracy numbers we have not measured |
| No video, no tags, cheap, quick to set up | That it replaces certified safety equipment |

---

## 3. How it works, step by step

1. **Set up the fence.** Two ESP32 boards on two cones at the edge of the danger zone, facing each other, 1 to 3 m apart.
2. **The boards talk.** The sender fires small Wi-Fi packets (about 50 per second) at the receiver. The signal between them is the tripwire.
3. **The receiver measures the signal in detail.** For every packet it measures the **CSI (Channel State Information)**: how strongly the signal arrived on each of dozens of frequency slices. It sends those numbers over USB to a laptop or Raspberry Pi.
4. **A person disturbs the signal.** With nobody around, the numbers stay steady. When someone walks into the signal path, their body changes how the signal arrives, and the numbers jump around.
5. **Calibrate on site.** With the zone empty, the software learns how much the signal normally flickers in that spot. Every site is different, so this always happens on site.
6. **Detect.** Ten times a second, the software compares the latest signal against that baseline and decides: someone is crossing or moving in the zone, yes or no, plus a strength and confidence.
7. **Radar adds two things.** An LD2410C radar at the fence line, facing outward, reports when someone is approaching and how far away they are. A second one facing into the zone can keep detecting someone who stops and stands still (stretch goal).
8. **Alert.** The result goes live to the web dashboard and can sound an alarm:
   - **Clear:** nobody near.
   - **Approach (yellow):** radar sees someone coming toward the zone.
   - **Alert (red):** someone crossed into the zone. Stays red while anyone is detected inside.
9. **Arm and disarm.** The supervisor arms the fence while the hazard is active and disarms it when the crew needs to go in. Disarmed crossings are logged without an alarm.

---

## 4. System overview and team

```
   [cone]  Sender ESP32  ~~~~ Wi-Fi tripwire (ESP-NOW) ~~~~>  Receiver ESP32  [cone]
                                                                    |
   LD2410C radar --wires--> spare Feather                           | USB serial
          (approach + distance)   | USB serial                      v
                                  +------------------->  processing/ (Python, Team A)
                                                         CSI detector + radar reader
                                                         -> one alert level, 10 times/s
                                                                    |
                                                                    | WebSocket ws://<host>:8765
                                                                    v
                                                         frontend/web/ (dashboard, Team B)
                                                         laptop, phone, projector or Pi screen
```

| Part | Folder | Owner | Status |
|---|---|---|---|
| ESP32 firmware (sender, receiver) | `firmware/` (Espressif's examples) | All | Works; moving to new boards |
| CSI recorder | `collection/` | Team A | Built (Team A branch) |
| Wi-Fi detector | `processing/` | Team A | First version built (Team A branch) |
| Radar reader (LD2410C) | `processing/` + spare Feather | Team A | Not started; sensors ordered |
| WebSocket server and alert logic | `processing/` | Team A | Not started |
| Dashboard | `frontend/web/` | Team B | Phases 1 to 5 of 10 done |
| Old desktop prototype (PySide6) | `frontend/pi_display/` | Team B | Kept for reference, not used |

| Role | People |
|---|---|
| Team lead | _fill in_ |
| Team A: recording, detection, radar, server (3) | _fill in_ |
| Team B: dashboard and integration (2) | _fill in_ |

---

## 5. Hardware

### What we have and what each part is for

| Item | Use |
|---|---|
| **3 x ESP32-WROOM-32 dev boards (CP2102 USB chip, built-in antenna)**, ordered from Amazon.ca | Wi-Fi tripwire: one sender, one receiver, one spare (or a second receiver for a second tripwire) |
| Feather ESP32 V2 (w.FL) **with** an antenna attached | Spare tripwire board; can pair with a new ESP32 |
| Feather ESP32 V2 (w.FL) **without** an antenna | **Radar host:** reads the LD2410C over wires, where the missing antenna does not matter |
| **2 x LD2410C** 24 GHz radar, ordered | Radar A: approach warning (facing out). Radar B: still person inside (facing in, stretch goal) |
| Raspberry Pi 4 Model B, 4 GB | Portable host for processing and the dashboard |
| USB power banks | Power the sender and the radar host on the cones |
| Cones (borrowed or paper), tape, a sign | Demo zone |

### Lessons from Nov 6 (do not repeat them)

- **No antenna, no signal.** The Feathers are the w.FL version (Adafruit 5438): no built-in antenna, only a tiny MHF3 socket, and one of ours had nothing attached. Bench test: only **-70 dBm at 10 cm apart** (should be about -20 to -35) and 30% of packets arriving. Amazon.ca had no MHF3 antennas before December, hence the new boards.
- **Check the signal after every setup change:** the 4th value of each `CSI_DATA` line is RSSI. Aim for better than -60 dBm.

### Firmware facts (Espressif `esp-csi`, `examples/get-started/csi_send` and `csi_recv`)

| Item | Value |
|---|---|
| Toolchain | ESP-IDF v5.5, `idf.py set-target esp32` (same for the new boards) |
| Radio | ESP-NOW broadcast, channel 11, 40 MHz wide (about channels 7 to 11) |
| Sender rate | `CONFIG_SEND_FREQUENCY` 100 gives about 91 packets/s in practice |
| Sender address | `1a:00:00:00:00:00`; the receiver ignores every other sender |
| Serial | 921600 baud. Each line is about 1.3 KB, so the link carries at most about 65 to 70 lines/s |

### Settings to change on the new boards

1. **Lower the sender rate to 50** (`CONFIG_SEND_FREQUENCY` in `csi_send/main/app_main.c`). At 100 the serial link cannot keep up, and raising the baud rate is not an option: the CP2102 chip on the new boards tops out at 1 Mbaud.
2. **Pick the quietest channel.** Check channels 1, 6 and 11 near the demo spot with a phone Wi-Fi analyzer app. If 11 is not the quietest, change `CONFIG_LESS_INTERFERENCE_CHANNEL` in **both** `csi_send` and `csi_recv` to the same value and reflash both.
3. **Optional: 20 MHz instead of 40.** Uses half the airwaves (less overlap with venue Wi-Fi) and shortens each line. Only after the basic link works; it changes `len`, so record a fresh calibration afterwards.

### Things that bite

- **Only one program can open a serial port.** Close `idf.py monitor` before any Python reader.
- **Opening the port can reboot the board.** Readers must skip lines that do not start with `CSI_DATA`.
- **The sender only needs power.** Run it from a power bank so it can sit on a cone.
- **Tape the boards down.** Moving a board changes the baseline; recalibrate after any move.
- **Keep hands, cables, laptops and metal away from the antenna end** (the zigzag trace at the end of the metal-covered module).
- **Crowds:** anyone moving near the line shows up. Keep the line short (1 to 3 m), record and demo in the quietest spot, calibrate with the crowd present.
- **If flashing stalls at "Connecting...",** hold the BOOT button until it starts. If no COM port appears, install the Silicon Labs CP210x driver.

---

## 6. Reading the CSI data

The receiver prints one header line once, then one line per packet (example values; `data` shortened):

```
type,id,mac,rssi,rate,sig_mode,mcs,bandwidth,smoothing,not_sounding,aggregation,stbc,fec_coding,sgi,noise_floor,ampdu_cnt,channel,secondary_channel,local_timestamp,ant,sig_len,rx_format,len,first_word,data
CSI_DATA,402367,1a:00:00:00:00:00,-88,11,1,0,1,1,1,0,0,0,0,-96,0,11,2,501604248,0,47,1,384,1,"[47,-16,2,0,...]"
```

| Index | Column | Meaning |
|---|---|---|
| 1 | `id` | The sender's packet counter. Gaps mean lost packets |
| 3 | `rssi` | Signal strength in dBm |
| 14 | `noise_floor` | Background noise in dBm (about -96 at the venue) |
| 22 | `len` | Number of values in `data` (384 on our current setup) |
| 23 | `first_word` | 1 means the first 4 values of `data` are garbage (original-ESP32 quirk) |
| 24 | `data` | The CSI: pairs of `imaginary, real` integers, one pair per subcarrier |

Parsing rules (Team A's `processing/csi_io.py` follows these):
- Use Python's `csv` module, never `line.split(",")`: `data` has commas inside quotes.
- Amplitude per subcarrier is `sqrt(real^2 + imag^2)`. Phase is too noisy on these boards.
- If `first_word` is 1, set the first 4 values to 0 (do not delete them, or subcarriers shift).
- Decide the expected `len` and which subcarriers to keep **once, at calibration**, and save them.
- This firmware does not correct for automatic gain on the original ESP32: normalise each packet before comparing packets.

Recorded files are `t,label,raw_csi` CSV (host time, label, the raw line), so old and new captures load the same way.

---

## 7. The message format between Team A and Team B

`processing/` runs a WebSocket server; the dashboard connects to it. Address `ws://<host>:8765`, listening on `0.0.0.0`; about **10 messages per second**; several clients at once; each message one JSON object.

```json
{
  "t": 1762450000.12,
  "motion": true,
  "strength": 0.74,
  "confidence": 0.88,
  "alert": "inside",
  "distance_m": 2.3
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `t` | number | yes | Unix time in seconds, from the Python machine |
| `motion` | boolean | yes | Wi-Fi detector's decision: someone is crossing or moving in the zone |
| `strength` | number, 0 to 1 | yes | How strong the movement is |
| `confidence` | number, 0 to 1 | yes | Detector's own confidence in `motion`. A heuristic, not a validated probability |
| `alert` | `"clear"`, `"approach"` or `"inside"` | no | Fused alert level (section 10). If missing, the dashboard uses `motion` (true means `"inside"`) |
| `distance_m` | number or null | no | Radar distance to the nearest moving person, in metres. Missing or null when no radar or nobody seen |

- Extra fields are ignored, so debug fields (for example `"mnr": 0.41`) are fine.
- **Older names are also accepted:** `timestamp` for `t`, `detected` for `motion`, `motion_score` for `strength`. Team A's first detector sends these today, and the dashboard reads them. New code should use the names above.
- Arming and disarming is done in the dashboard, not in this message.
- Change this format only with someone from each team agreeing.

---

## 8. Wi-Fi detection (Team A)

### Current detector (Team A branch, `processing/csi_io.py` and `detect_motion.py`)

- **Motion-to-noise ratio (MNR):** each 2 s window is split into 0.2 s bins. Fast scatter inside a bin counts as noise; slow drift between bins counts as movement. The score is the drift beyond what noise explains, divided by the noise, median over subcarriers. An empty zone scores near 0 whatever the signal strength.
- **Hysteresis:** on above the threshold, off below 70% of it, with a short hold, so it does not flicker.
- **First result:** on the Nov 6 floor recordings, threshold 0.33 classified held-out windows as 100% empty and 98% walking. Those were weak-signal recordings: **re-record and recalibrate on the new boards.** It needs at least 15 to 20 packets/s.
- **Commands:** see `processing/README.md` on the Team A branch (`--calibrate`, `--json`, `--live COMx`).

### What to do next, in order

1. **On the new boards, record labelled data at the venue** with the recorder (`collection/record_csi.py`):

   | Label | What happens | Length | Repeats |
   |---|---|---|---|
   | `empty` | Nobody within about 4 m of the line | 60 s | 3 |
   | `cross` | One person walks across the line, back and forth | 60 s | 3 |
   | `approach` | Walks toward the line and stops just before it | 60 s | 2 |
   | `still` | Stands still right on the line | 60 s | 2 |
   | `crowd` | Nobody at the line, but people moving 3 to 5 m away | 60 s | 2 |
   | `covered` | `cross` again with a towel over both boards | 60 s | 2 |

   Name files as in `data/README.md` and note each one in `data/captures.md`. A person sitting next to the boards is not `empty`.
2. **Calibrate from one `empty` recording, test on the others,** so the detector is never scored on its own calibration data. Report detection rate on `cross` and false alarms per minute on `empty` and `crowd` in `docs/results.md`. These real numbers go in the pitch.
3. **Keep the time window by time, not packet count,** and keep calibration choices (expected `len`, kept subcarriers, threshold) in a saved calibration file per site.
4. **Timing target:** YES within about 1 s of someone stepping in; back to clear within about 3 s of them leaving.

---

## 9. The radar sensor (LD2410C)

A 24 GHz radar module that detects people, moving or still, up to about 6 m away, and reports their distance. It does its own detection; we read its results.

### Wiring (to the spare Feather without an antenna)

| LD2410C pin | Feather pin |
|---|---|
| VCC | `USB` pin (5 V from the USB cable) |
| GND | `GND` |
| TX | `RX` |
| RX | `TX` |
| OUT | optional: any free GPIO (goes high when someone is present) |

The radar needs 5 V power but uses 3.3 V signals, which matches the Feather. Its serial speed is **256000 baud**.

### Reading it

- **Simplest start:** read the `OUT` pin: high means someone is there. Good for a first test.
- **Full data:** a small Feather program forwards the radar's bytes from its serial pins to USB unchanged, and Python parses the frames. Each report frame starts with `F4 F3 F2 F1` and ends with `F8 F7 F6 F5`. The basic report contains: target state (0 none, 1 moving, 2 still, 3 both), moving target distance (cm), moving energy (0 to 100), still target distance (cm), still energy (0 to 100), detection distance (cm). Distances are little-endian 16-bit numbers. The full layout is in Hi-Link's "LD2410C Serial communication protocol" PDF.
- **Configure the range:** limit the maximum distance gates (0.75 m each) so it ignores people beyond the zone of interest. The Hi-Link app or the protocol's configuration commands do this.

### Placement and use

- **Radar A, approach warning:** at the fence line, facing outward. "Approach" means a moving target closer than a warning distance (start with 3 m) and getting closer.
- **Radar B, still person inside (stretch):** facing into the zone. Keeps the alert on while someone stands still inside. It will also see anything moving inside, such as a machine, so it is for zones where nothing else moves at ground level.
- Two radars pointed at each other may interfere; point them in different directions and test.
- **Bonus:** run the radar next to the Wi-Fi line during recordings and use it as a reference to score the Wi-Fi detector ("agreed with the radar X% of the time").

---

## 10. The processing server (Team A)

One Python program reads the Wi-Fi receiver and the radar, decides the alert level, and serves the dashboard.

```
python -m processing --csi COM5 --radar COM7 --port 8765
python -m processing --csi data/<recording>.csv --calibration calibration/<site>.json
```

- **Sources:** each a serial port or a recording. Replay feeds recorded lines at their original timing and **requires a calibration file** from an `empty` recording of the same session (calibrating on a walking recording would treat walking as empty).
- **Live calibration:** without `--calibration`, prompt "keep the zone empty for 20 s", calibrate, save to `calibration/<site>-<time>.json`.
- **Serial reading in background threads,** results passed to the asyncio WebSocket side through queues.
- **WebSocket:** `websockets` 13 or newer, `from websockets.asyncio.server import serve`, one-argument handler, listen on `0.0.0.0:8765`, send with `broadcast(clients, message)`, run the sending loop inside `async with serve(...)` and await it directly. The dashboard's `frontend/web/mock/mock_server.py` is a working example.
- **Alert logic, 10 times a second:**
  1. `inside` if the Wi-Fi detector says `motion`, or radar B sees someone inside; once `inside`, stay there until both have been quiet for 3 s.
  2. otherwise `approach` if radar A sees a moving target within the warning distance and getting closer;
  3. otherwise `clear`.
- **Message:** section 7, with `alert` and `distance_m` filled in when the radar is connected. Without a radar, `alert` is just `inside` or `clear`.
- **Status line once per second:** packets/s, RSSI, score, alert, number of clients.
- `processing/requirements.txt`: `pyserial`, `numpy`, `websockets>=13`.

---

## 11. The dashboard (Team B)

A web page (React, TypeScript, Vite, Tailwind, Recharts) in `frontend/web/`, built in 10 small phases by Antigravity from `guide.md`, each reviewed before the next.

**Shows:**
- **Zone status:** CLEAR, APPROACH or ALERT, very large, with how long and how far.
- **Strength and confidence** bars.
- **Radar-style animation** that reacts to activity; when the radar reports a distance, a ring at that distance (a ring, never a dot, because we do not know the direction).
- **Activity graph** of the last 60 s with approach and alert periods shaded.
- **Event log:** each entry with time, duration and whether the fence was armed.
- **Connection status:** Connected, Waiting for data, Disconnected (retrying).

**Controls:** Demo/Live mode, Arm/Disarm, Sound on/off (an alarm tone on ALERT while armed).

**Modes:**
- **Demo:** simulated data, clearly labelled `SIMULATED DATA`. For building and as a backup.
- **Live:** connects to Team A's server. When data stops, the screen says so instead of freezing.

| Address option | Effect |
|---|---|
| `?mode=live` | Start in Live mode |
| `?ws=ws://192.168.1.50:8765` | Connect to a server on another machine |
| `?kiosk=1` | Compact full-screen layout for a small Pi screen |

How to run it: `frontend/web/README.md` (written in the last phase).

---

## 12. Integration plan

Connect the parts in this order; each step removes one unknown.

1. **Dashboard with the mock server** (Team B alone). Done for the basic fields; zone fields come in dashboard Phase 6.
2. **Team A's detector output into the dashboard:** pipe `detect_motion.py --json` on a recording through a tiny WebSocket wrapper, or the real server once it exists. Real data, no hardware.
3. **Live Wi-Fi line on a laptop:** new boards, walk across the line, watch the dashboard.
4. **Add radar A:** approach warnings and distance ring.
5. **Move to the Pi** (section 13), dashboard viewed on a laptop or projector.
6. **Full rehearsal at the demo spot,** recalibrated there.

Integration is done when: ALERT appears within about 1 s of someone stepping across the line, returns to CLEAR within about 3 s of them leaving, it recovers on its own if the server restarts, and it runs 30 minutes untouched without false alarms in an empty zone.

---

## 13. Running it on the Raspberry Pi

Pi 4 Model B, 4 GB is plenty (a few hundred MB used).

1. 64-bit Raspberry Pi OS; Lite if the dashboard is viewed on another device.
2. Official 5.1 V / 3 A USB-C supply. `vcgencmd get_throttled` must print `throttled=0x0`.
3. Heatsink or fan if it runs for hours in a case.
4. 5 GHz Wi-Fi or Ethernet, to keep 2.4 GHz quiet near the boards.
5. `sudo usermod -aG dialout $USER`, log out and in. Boards appear as `/dev/ttyUSB0` (CP2102) or `/dev/ttyACM0`; check `ls /dev/tty*` before and after plugging in.
6. `python3 -m venv ~/radarping-venv`, `source ~/radarping-venv/bin/activate`, `pip install -r processing/requirements.txt`.
7. Serve the built dashboard without Node: `npm run build` on a laptop, copy `dist` to the Pi, `python3 -m http.server 8080 --directory dist`.
8. Pi screen: `chromium --kiosk "http://localhost:8080/?kiosk=1&mode=live"` (`chromium-browser` on older versions).

---

## 14. Demo and presentation

### The demo setup

```
              cone + sender ESP32 (power bank)
                     |
   ~~~~~~~~~~~~ Wi-Fi tripwire ~~~~~~~~~~~~        radar A on the cone, facing out
                     |
              cone + receiver ESP32 --USB--> laptop or Pi --> dashboard on a screen

        [taped zone on the floor]   sign: "DANGER ZONE: CRANE LIFT IN PROGRESS"
```

**Before judges arrive:** recalibrate at the demo spot with the crowd present; charge power banks; tape everything down; run 30 minutes untouched; have a replay recording and a screen recording of a good run ready.

### The 15-minute presentation

| Time | Section | Content |
|---|---|---|
| 1 min | Hook | "Every site has zones people shouldn't walk into while work is happening. How do you know when someone does?" |
| 2 min | Problem | Sourced statistic. Gaps: cones and tape, cameras, optical sensors, tags, cost of permanent systems |
| 1 min | Idea | Wi-Fi already bounces off people; use it as a sensor |
| 3 min | How it works | Section 3 as a diagram: tripwire, radar, detector, alert levels, arming |
| 4 min | Live demo | Approach (yellow), step in (red), step out (clear). Disarm, walk in, show it logged without alarm. **Then cover the boards with a towel and repeat:** "a camera would be blind now" |
| 2 min | Results | Measured detection and false-alarm rates; the antenna lesson (our first boards had none, and our test proved it) |
| 1 min | Limits, next steps | Not person vs vehicle; one line per pair; next: more cones for full perimeters, stopping the machine automatically, badges for authorized workers |
| 30 s | Close | "A safety fence that costs tens of dollars, sets up in minutes, and doesn't care about mud." |

**Fallbacks:** live detection unreliable, so replay a real recording (say so); hardware dead, so Demo mode (labelled simulated) plus the screen recording; Pi trouble, so run on a laptop.

---

## 15. Judge questions to prepare for

**"Doesn't this already exist?"** Related things do:
- Road work-zone intrusion alarms (for example impact-triggered cone alarms and trip hoses) fire when a **vehicle hits a cone or drives over a hose**, so it is already in the zone, and they are built for traffic, not workers on foot.
- Tag-based proximity systems only see workers wearing a tag.
- Researchers have shown Wi-Fi sensing can warn about workers near restricted areas on construction sites, in fixed indoor setups with deep learning.
- Our angle: a contactless, tag-free, portable tripwire on two cones for zones that move every day.

**"How do you tell workers from other people?"** We don't need to: an active exclusion zone allows nobody in. The supervisor disarms it when the crew needs access. Next step: authorized workers carry a Bluetooth tag the ESP32 can recognize, while untagged people still trigger the alarm.

**"Can it tell direction?"** The radar's distance shows whether someone is approaching. A second Wi-Fi line 1 m inside the first would show in versus out by which line triggers first (next step).

**"What about vehicles or a moving machine?"** Anything crossing triggers it, which is fine for an exclusion zone. Place the line outside the machine's reach.

**"Why not cameras or LiDAR?"** Both need a clean line of sight; mud, dust, smoke and darkness blind them. Radio does not care, and records no video of workers.

**"How accurate is it?"** Only our measured numbers from section 8, with how they were measured.

---

## 16. Timeline

| When | Goal |
|---|---|
| **Sat morning** | Ask the hardware booth for MHF3 antennas or built-in-antenna ESP32s. Find the quietest channel at the demo spot |
| **Sat, boards arrive** | Flash new boards (sender at 50/s), link test (better than -60 dBm), record the labelled set (section 8) |
| **Sat afternoon** | Recalibrate and score the detector on new data. Wire radar A, read its distance. Dashboard Phase 6 (zone mode) |
| **Sat evening** | Processing server: WebSocket, alert logic. First live end-to-end run. Dashboard radar and graph phases |
| **Sun** | Radar B if time allows. Pi setup. Measure results. Slides, README, About text and summary. Full rehearsal, twice |
| **Mon 8 to 11 AM** | Final fixes only. Make the repo public. **Submit before 11:00 AM MT** |
| **Mon afternoon** | Judging presentations; return hardware by 7 PM |

If anything is more than 4 hours behind, tell the team lead and cut a stretch goal (radar B first, then the second tripwire, then sound).

---

## 17. Risks and fallbacks

| Risk | Sign | What to do |
|---|---|---|
| New boards late or faulty | Not arrived by Saturday afternoon, or a board will not flash | Hardware booth (ESP32 V2 with antenna, ESP32-CAM); Feather with antenna plus one new board |
| Weak signal | RSSI below about -70 dBm, few packets/s | Antenna end clear of hands and metal; boards closer; quieter channel |
| Serial link full | About 60 to 70 packets/s at the laptop, many id gaps | Sender rate 50 (CP2102 cannot go above 1 Mbaud) |
| Crowd triggers it | ALERT with nobody at the line | Shorter line, quieter spot, calibrate with the crowd present, raise the threshold |
| Detection flickers | ALERT and CLEAR alternate | Longer hold, wider hysteresis, recalibrate |
| Baseline drifts | False alarms grow over 10 to 20 minutes | Recalibrate before the demo; slowly update the baseline while clear |
| Radar trouble | No frames, wrong baud | Fall back to its OUT pin; or drop the approach level |
| Replay never alerts | Strength near 0 on `cross` recordings | Replay with a calibration from an `empty` recording |
| Pi trouble | Undervoltage, port permissions | Section 13, or run on a laptop |
| Running out of time | No end-to-end run by Saturday night | Freeze features; Wi-Fi line plus dashboard is a complete project |

---

## 18. Repo, branches and workflow

| Branch | What | Status |
|---|---|---|
| `main` | Demo-ready code | Skeleton plus the old prototype |
| `frontend/web-dashboard` | Team B dashboard, one commit per phase | Local, not pushed yet |
| `cursor/csi-recorder-and-detection-7673` | Team A recorder and MNR detector | On GitHub, not merged |
| (to create) `docs/zone-safety` | This file and the updated READMEs and docs | Not committed yet |

| Path | What |
|---|---|
| `project.md` | This guide |
| `firmware/` | ESP32 notes (we use Espressif's examples, unmodified apart from settings) |
| `collection/` | Serial recorder |
| `processing/` | Detector, radar reader, WebSocket server |
| `frontend/web/` | Dashboard |
| `frontend/pi_display/` | Earlier PySide6 prototype, not used |
| `data/` | Recordings (not committed; only `README.md` and `captures.md`) |
| `calibration/` | Calibration files per site |
| `docs/` | Plan, message format, results |

Workflow (details in `CONTRIBUTING.md`): never push straight to `main`; one branch per task; small pull requests reviewed by one teammate; message-format changes need someone from each team; never commit recordings or build output; stuck more than 30 minutes, say so in the team chat. **Make the repo public before submitting.**

---

## 19. Glossary

| Term | Meaning |
|---|---|
| CSI | Channel State Information: per-subcarrier measurement of how the signal arrived |
| Subcarrier | One of the many narrow frequency slices inside a Wi-Fi channel |
| RSSI | Received signal strength, in dBm. Closer to 0 is stronger |
| ESP-NOW | Espressif's way for ESP32 boards to send packets to each other without a router |
| MNR | Motion-to-noise ratio, Team A's movement score |
| Calibration | Learning what the empty zone looks like; movement is measured against it |
| Hysteresis | A higher threshold to switch on than to switch off, so the result does not flicker |
| LD2410C | Small 24 GHz radar module that detects people and their distance |
| Arm / disarm | Alarm on while the hazard is active; off (logging only) while the crew works inside |
| WebSocket | A connection that lets the server push messages to the browser continuously |
| Replay mode | Feeding a saved recording through the detector as if it were live |
| Kiosk mode | Full-screen browser with no controls, for the Pi's screen |
