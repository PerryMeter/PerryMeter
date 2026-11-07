# Perrymeter: Project Guide

**Perrymeter** (formerly RadarPing) is a portable, camera-free safety perimeter for temporary work zones. This guide has everything the team needs: the pitch, the "danger triangle" hardware, how detection works, the message format, the dashboard, the business model, and the demo. **Read sections 1 to 5 even if you only work on one part.**

The GitHub repository is still called `RadarPing`; only the repo owner can rename it (GitHub > Settings > rename; old links keep working).

**Status (Saturday, Nov 7):**
- Theme: **Construction & Manufacturing.** Direction: safety perimeter for temporary work zones, built as a **danger triangle** (section 4).
- Hardware: new built-in-antenna ESP32 boards and LD2410C radars ordered; the first Feathers had a missing antenna.
- Team A: recorder, MNR detector and a first processing server (`processing/server.py`, one side) are merged into `main`.
- Team B: dashboard phases 1 to 11 done (rename, per-side data, nodes panel); the triangle map is Phase 12.

### Competition essentials (natHacks 2026 Official Rules)

- **Deadline: Monday, Nov 9, 11:00 AM MT,** via the submission form on Discord. Hardware kits go back by 7:00 PM that day.
- **Theme:** prizes are per theme; we enter **Construction & Manufacturing** ("worker safety", "site monitoring").
- **Submission:** "About the project" (3000 characters), summary (1300 characters), a **public** GitHub repo with a README, and a **15-minute in-person presentation plus 5 minutes of questions**.
- **All code must be written during the event** (from 7:00 PM MT, Nov 6). Credit Espressif's `esp-csi` firmware and confirm with an organizer that using it is fine.
- **The judging rubric is in the Participant Handbook.** Shape the pitch around it.

---

## Contents

1. The pitch
2. What we can and cannot claim
3. How it works, step by step
4. The danger triangle
5. Hardware and firmware
6. Reading the CSI data
7. The message format between Team A and Team B
8. Wi-Fi detection (Team A)
9. The radar (LD2410C)
10. The processing server (Team A)
11. The dashboard (Team B)
12. Business model and pricing
13. Scaling up: expansion kits and worker tags
14. Integration plan
15. Running it on the Raspberry Pi
16. Demo and presentation
17. Judge questions to prepare for
18. Timeline
19. Risks and fallbacks
20. Repo, branches and workflow
21. Glossary

---

## 1. The pitch

**One line:** Perrymeter turns three traffic cones into an invisible, camera-free safety perimeter for temporary work zones, and warns the crew the moment someone walks in, through dust, mud and darkness.

**The story (30 seconds):**

> Every day, crews set up temporary danger zones: around a crane lift, an open excavation, or a machine working in one spot. They mark them with cones and tape, and nothing warns anyone when someone walks in. Being struck by equipment and being caught in or between machinery are two of OSHA's "Focus Four" construction hazards [add a real Alberta or Canadian statistic, with its source].
>
> Cones and tape get ignored. Cameras need a clean lens and someone watching. Optical safety sensors are expensive, fixed in place, and need a clear line of sight. Tags only work if every worker wears one. And nobody installs a permanent system for a zone that moves tomorrow.
>
> Perrymeter is a **danger triangle**: three smart cones. Wi-Fi signals between them form invisible tripwires, and a radar at the top corner watches the inside, even for someone standing still. When a person crosses a side, Perrymeter tells the crew which side, within about a second. It runs on power banks, sets up in minutes, works through dust, mud and darkness, and records no video of anyone. Crews rent it per month, and add expansion kits and wearable tags as sites grow.

**Rules for the story:** never invent a number (every statistic gets a source); never say "first ever"; only claim what the demo shows.

---

## 2. What we can and cannot claim

| We can claim (once tested) | We cannot claim |
|---|---|
| Detects a person crossing a monitored side, and which side | Exactly where along the side, or who it is |
| Radar keeps detecting someone inside the triangle, even standing still, and how far they are from the top corner | Their exact position or direction inside |
| Works through dust, smoke, darkness and a covering cloth (demo it) | Works through concrete, metal or across long distances |
| Detection and false-alarm rates from our own recordings | Accuracy numbers we have not measured |
| No video, no tags required, cheap, quick to set up | That it replaces certified safety equipment |
| Tags, multi-zone sites and pricing as plans | That tags or the business are already proven |

---

## 3. How it works, step by step

1. **Set up the triangle.** Three cones around the danger zone, 2 to 3 m apart: the **hub** cone at the top (Raspberry Pi, receiver ESP32, LD2410C radar) and a **node** cone at each bottom corner (one ESP32 each, on a power bank).
2. **The nodes talk to the hub.** Each node sends about 30 small Wi-Fi packets per second to the hub. The signal along each side is a tripwire.
3. **The hub measures each signal in detail.** For every packet the receiver measures the **CSI (Channel State Information)**: how strongly the signal arrived on each of dozens of frequency slices. It knows which node sent it, and passes everything to the Pi over USB.
4. **A person disturbs the signal.** With nobody around, the numbers stay steady. When someone crosses a side, their body changes how that side's signal arrives.
5. **Calibrate on site.** With the zone empty, the software learns how much each side's signal normally flickers.
6. **Detect, per side.** Ten times a second, the software scores each side against its baseline: crossed or not, how strongly, how confidently.
7. **The radar watches the inside.** The LD2410C at the hub faces into the triangle. It reports anyone inside, even standing still, and their distance from the hub.
8. **Alert levels:**
   - **Clear:** nobody near.
   - **Approach (yellow):** a side's signal is rising but nobody has crossed yet.
   - **Alert (red):** someone crossed a side or the radar sees someone inside. It stays red while anyone is inside.
9. **Arm and disarm.** The supervisor arms the triangle while the hazard is active and disarms it when the crew needs to go in. Disarmed entries are logged without an alarm.

---

## 4. The danger triangle

```
                      HUB (top cone)
            Raspberry Pi + receiver ESP32 + LD2410C radar
                         /\
                        /  \      radar faces down
                       / ## \     into the triangle
       left side      / #  # \     right side
   (Wi-Fi tripwire)  /  ####  \  (Wi-Fi tripwire)
                    /   inside \
                   /____________\
           LEFT node            RIGHT node
        ESP32 sender          ESP32 sender
        (power bank)          (power bank)
              bottom side: not monitored in v1
              (expansion kit, section 13)
```

**What each part covers:**
- **Left and right sides:** each is a Wi-Fi tripwire between a node and the hub. Crossing either one triggers an alert that says which side.
- **Inside:** the radar at the hub covers about a 120 degree fan (roughly plus or minus 60 degrees) out to about 6 m. An equilateral triangle's top corner is 60 degrees, so the fan covers the whole inside of a triangle with 2 to 5 m sides.
- **Bottom side:** not a tripwire in version 1, because each tripwire needs one end at the hub, where the receiver plugs into the Pi. Place the bottom side against a wall, a barrier or the machine itself, or monitor it with the expansion kit (section 13).

**Why a triangle:** it is the smallest closed shape; three cones set up in minutes; every corner has power and a job; and the radar's fan matches the top corner's angle.

---

## 5. Hardware and firmware

### Parts

| Item | Where | Use |
|---|---|---|
| Raspberry Pi 4 Model B, 4 GB | Hub | Runs the processing server and serves the dashboard |
| ESP32-WROOM-32 (CP2102, built-in antenna) | Hub | **Receiver**, USB to the Pi |
| LD2410C 24 GHz radar | Hub | Inside presence and distance, facing into the triangle; read through a spare ESP32 or a USB-serial adapter on the Pi |
| ESP32-WROOM-32 x2 | Left and right nodes | **Senders**, on power banks |
| Feather ESP32 V2 (w.FL) with an antenna | Spare | Backup node |
| Feather ESP32 V2 (w.FL) without an antenna | Spare | Radar host (wired, so no antenna needed) |
| Power banks, 3 cones, tape, a sign | All | Demo kit |

### Firmware changes for the triangle (Espressif `esp-csi` examples)

| Change | File | Why |
|---|---|---|
| Left node: `CONFIG_CSI_SEND_MAC` ending `0x01`; right node: ending `0x02` (`1a:00:00:00:00:01` and `:02`) | `csi_send/main/app_main.c`, set before flashing each node | So the hub can tell the two sides apart. The sender address is the 3rd column of every `CSI_DATA` line |
| Receiver accepts any sender starting `1a:00:00:00:00`: change the filter's `memcmp(info->mac, CONFIG_CSI_SEND_MAC, 6)` to compare **5** bytes | `csi_recv/main/app_main.c` | Today it only accepts one exact sender |
| Sender rate **30 per second** (`CONFIG_SEND_FREQUENCY`) | `csi_send/main/app_main.c` | Two senders share one serial link, which carries at most about 65 to 70 lines per second at our line length. The CP2102 cannot go above 1 Mbaud, so lowering the rate is the fix |
| Same `CONFIG_LESS_INTERFERENCE_CHANNEL` in all three boards | both | Pick the quietest of 1, 6, 11 at the demo spot |

Toolchain: ESP-IDF v5.5, `idf.py set-target esp32`, `idf.py -p <PORT> flash monitor`.

### Lessons from Nov 6

- **No antenna, no signal.** The Feathers are the w.FL version (Adafruit 5438) with no built-in antenna, and one had none attached. Bench test: **-70 dBm at 10 cm** (should be about -20 to -35) and 30% of packets arriving. MHF3 antennas were not available on Amazon.ca before December, hence the new boards.
- **Check the signal after every setup change:** the 4th value of each `CSI_DATA` line is RSSI. Aim for better than -60 dBm on each side.
- **Only one program can open a serial port;** opening it can reboot the board (skip non-`CSI_DATA` lines).
- **Tape everything down.** Moving a cone changes the baseline; recalibrate after any move.
- **Keep hands, cables, laptops and metal away from the antenna end** of each ESP32 (the zigzag trace at the end of the metal-covered module).
- **Crowds:** anyone moving near a side shows up. Keep sides short (2 to 3 m), demo in the quietest spot, calibrate with the crowd present.
- **If flashing stalls at "Connecting...",** hold BOOT. If no COM port appears, install the Silicon Labs CP210x driver.

---

## 6. Reading the CSI data

The receiver prints one line per packet (example values; `data` shortened):

```
CSI_DATA,402367,1a:00:00:00:00:01,-58,11,1,0,1,1,1,0,0,0,0,-96,0,11,2,501604248,0,47,1,384,1,"[47,-16,2,0,...]"
```

| Index | Column | Meaning |
|---|---|---|
| 1 | `id` | The sender's packet counter. Gaps mean lost packets |
| 2 | `mac` | **Which node sent it**, so which side: `...:01` left, `...:02` right |
| 3 | `rssi` | Signal strength in dBm |
| 14 | `noise_floor` | Background noise in dBm (about -96 at the venue) |
| 22 | `len` | Number of values in `data` (384 on our setup) |
| 23 | `first_word` | 1 means the first 4 values of `data` are garbage (original-ESP32 quirk) |
| 24 | `data` | Pairs of `imaginary, real` integers, one pair per subcarrier |

Parsing rules (Team A's `processing/csi_io.py` follows them): use Python's `csv` module (never `split(",")`); amplitude is `sqrt(real^2 + imag^2)`; if `first_word` is 1 set the first 4 values to 0; fix the expected `len` and kept subcarriers once at calibration, **per side**; normalise each packet before comparing packets. Recordings are `t,label,raw_csi` CSV.

---

## 7. The message format between Team A and Team B

`processing/` runs a WebSocket server at `ws://<host>:8765` (listening on `0.0.0.0`), about **10 messages per second**, several clients at once, one JSON object per message.

```json
{
  "t": 1762450000.12,
  "motion": true,
  "strength": 0.81,
  "confidence": 0.88,
  "alert": "inside",
  "distance_m": 2.3,
  "links": [
    {"id": "left", "motion": true, "strength": 0.81, "rssi": -58, "pps": 27},
    {"id": "right", "motion": false, "strength": 0.05, "rssi": -61, "pps": 28}
  ],
  "nodes": [
    {"id": "hub", "online": true},
    {"id": "left", "online": true},
    {"id": "right", "online": true},
    {"id": "radar", "online": true}
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `t` | yes | Unix time in seconds, from the Pi |
| `motion` | yes | Any side currently crossed or moving |
| `strength` | yes | 0 to 1, the strongest side |
| `confidence` | yes | 0 to 1, detector's own confidence; a heuristic, not a validated probability |
| `alert` | no | `"clear"`, `"approach"` or `"inside"`. If missing, the dashboard uses `motion` |
| `distance_m` | no | Radar distance from the hub to the nearest person inside, in metres; null when nobody is seen |
| `links` | no | One entry per monitored side: `id` (`"left"`, `"right"`, later `"base"`), its own `motion` and `strength`, and optional `rssi` (dBm) and `pps` (packets per second) |
| `nodes` | no | Health of each device: `id` (`"hub"`, `"left"`, `"right"`, `"radar"`, later more) and `online` (heard from in the last 2 s) |

- Extra fields are ignored; older names `timestamp`, `detected`, `motion_score` are still accepted. Team A's first detector sends those, and the dashboard reads them.
- Without `links`, the dashboard shows the triangle without per-side detail. Without `nodes`, it shows "node status not reported".
- Change this format only with someone from each team agreeing.

---

## 8. Wi-Fi detection (Team A)

### Current detector (Team A branch, `processing/csi_io.py` and `detect_motion.py`)

- **Motion-to-noise ratio (MNR):** each 2 s window is split into 0.2 s bins; fast scatter inside a bin counts as noise, slow drift between bins as movement; the score is the drift beyond what noise explains, divided by the noise, median over subcarriers.
- **Hysteresis:** on above the threshold, off below 70% of it, with a short hold.
- **First result:** threshold 0.33 separated empty from walking on the Nov 6 recordings (weak-signal data: **re-record and recalibrate on the new boards**). Needs at least 15 to 20 packets per second per side.

### For the triangle

1. **Split lines by sender address** (column 2) and run **one detector per side**, each with its own calibration.
2. **Record labelled data at the venue,** per side:

   | Label | What happens | Length | Repeats |
   |---|---|---|---|
   | `empty` | Nobody within about 4 m of the triangle | 60 s | 3 |
   | `cross-left` | One person walks back and forth across the left side | 60 s | 3 |
   | `cross-right` | The same across the right side | 60 s | 3 |
   | `inside-still` | One person stands still inside | 60 s | 2 |
   | `near` | Walks along outside a side without crossing | 60 s | 2 |
   | `crowd` | People moving 3 to 5 m away, nobody near | 60 s | 2 |
   | `covered` | `cross-left` with a towel over the nodes | 60 s | 2 |

3. **Calibrate from one `empty` recording and test on the others.** Report per-side detection rate and false alarms per minute in `docs/results.md`. These numbers go in the pitch.
4. **Timing target:** ALERT within about 1 s of someone crossing; CLEAR within about 3 s after the last person leaves.

---

## 9. The radar (LD2410C)

A 24 GHz radar module that detects people, moving or still, up to about 6 m, and reports their distance. It does its own detection; we read its results.

- **Placement:** at the hub, facing **into** the triangle, about 1 m high.
- **Wiring** (to a spare ESP32 or Feather): VCC to 5 V (`USB` pin), GND to GND, radar TX to board RX, radar RX to board TX; optional OUT pin (high when someone is present) to a free GPIO. Serial speed **256000 baud**, 3.3 V signals.
- **Reading:** start with the OUT pin; then forward the radar's bytes to USB and parse frames in Python (header `F4 F3 F2 F1`, footer `F8 F7 F6 F5`; basic report: target state, moving distance cm, moving energy, still distance cm, still energy, detection distance cm; little-endian). Full layout in Hi-Link's "LD2410C Serial communication protocol" PDF.
- **Range:** limit the distance gates (0.75 m each) to roughly the triangle's size so it ignores people beyond it.
- **Use:** keeps the alert on while someone is inside, even standing still; gives `distance_m` for the dashboard; serves as a reference to score the Wi-Fi detector ("the Wi-Fi sides agreed with the radar X% of the time").

---

## 10. The processing server (Team A)

One Python program on the Pi reads the hub receiver and the radar, decides the alert level, and serves the dashboard.

### What exists now (`processing/server.py`, merged in PR #6)

```
python processing/server.py --csi data/no_movement_*.csv data/walking_between_*.csv --loop
python processing/server.py --csi COM5
```

- Replays recordings at their original speed or reads a serial port (reopened if unplugged); runs Team A's detector unchanged (threshold 0.33); sends `t`, `motion`, `strength`, `confidence`, `alert`, `distance_m` (always null for now) and a debug `mnr` 10 times a second; sends nothing when data stops, so the dashboard shows the gap. Details in `docs/processing-server.md`.
- **Still needed for the triangle:**
  1. **Split lines by sender address and run one detector per side.** Today every packet goes into one detector. **Until this exists, power only one node:** with two nodes sending, both sides' signals get mixed into one score.
  2. Send `links` (per side, with `rssi` and `pps`) and `nodes` (online if heard from in the last 2 s).
  3. Read the radar: `distance_m` and the inside hold.
  4. Replace the fixed `--threshold` with a calibration per side from an `empty` recording of the same session.

### The full design

- **Sources:** serial ports or recordings. Replay feeds recorded lines at their original timing and **requires a calibration file** from an `empty` recording of the same session.
- **Live calibration:** without `--calibration`, prompt "keep the zone empty for 20 s", calibrate every side, save to `calibration/<site>-<time>.json`.
- **Serial reading in background threads,** results passed to asyncio through queues.
- **WebSocket:** `websockets` 13 or newer (`from websockets.asyncio.server import serve`, one-argument handler), `0.0.0.0:8765`, `broadcast(clients, message)`, sending loop awaited inside `async with serve(...)`. `frontend/web/mock/mock_server.py` is a working example.
- **Alert logic, 10 times a second:**
  1. `inside` if any side's detector says crossed, or the radar sees someone; stay `inside` until all sides and the radar have been quiet for 3 s;
  2. otherwise `approach` if any side's score is above a lower "near" threshold (for example half the crossing threshold);
  3. otherwise `clear`.
- **Message:** section 7, with `links` per side, `nodes` health (a node is online if its packets arrived in the last 2 s; the radar if its frames did), and `distance_m` from the radar.
- `processing/requirements.txt`: `pyserial`, `numpy`, `websockets>=13`.

---

## 11. The dashboard (Team B)

A web page (React, TypeScript, Vite, Tailwind, Recharts) in `frontend/web/`, built by Antigravity from `guide.md` in reviewed phases. Phases 1 to 10 are done; 11 and 12 add the rename and the triangle.

**Shows:**
- **Zone map (Phase 12):** the triangle with the hub and node cones at the corners; each monitored side lights up when crossed; the radar's fan sweeps inside from the hub, with a distance arc when the radar sees someone; the bottom side dashed until the expansion kit monitors it. Nothing is ever drawn at a guessed position of a person.
- **Zone status:** CLEAR, APPROACH or ALERT, very large, with which side and for how long.
- **Strength and confidence** bars; **nodes** panel with each device's status, signal and packet rate (Phase 11).
- **Activity graph** of the last 60 s with approach and alert periods shaded.
- **Event log:** each entry with time, side, duration and whether the triangle was armed.
- **Controls:** Demo/Live, Arm/Disarm, Sound on/off.

| Address option | Effect |
|---|---|
| `?mode=live` | Start in Live mode |
| `?ws=ws://192.168.1.50:8765` | Connect to a server on another machine |
| `?kiosk=1` | Compact full-screen layout for a small Pi screen |

---

## 12. Business model and pricing

**Advice from our advisor:** avoid a one-time sale; build recurring revenue that lasts.

### Model: rented kits plus a monthly subscription

Construction crews already rent equipment per job, and our zones are temporary by nature. So Perrymeter is **rented per kit per month**, not sold:

- **Included:** the hardware (hub, nodes, radar, cones, power banks, cases), the dashboard and alerts, replacements for damaged parts, firmware and software updates, and an **incident log** (every entry, with time and side) that sites can use for their safety records.
- **Why recurring works:** kits move from site to site for years (longevity), the customer has no upfront cost, we keep improving the software, and revenue is predictable.
- **Short jobs:** a per-zone-day option for one-off lifts or inspections.

### Products and example prices

Example prices are placeholders to sanity-check with the advisor, not market research.

| Product | What it is | Example price |
|---|---|---|
| **Starter Triangle** | Hub (Pi, receiver, radar) + 2 nodes + cones | $149 per month per kit |
| **Expansion node** | One more ESP32 node; adds a monitored side | $29 per month |
| **Radar add-on** | Extra LD2410C for more inside coverage or an outward approach warning | $19 per month |
| **Worker tag** | Vibrating wearable (section 13) | $5 per worker per month |
| **Site plan** | Many zones on one dashboard, reports, SMS alerts | Custom |
| **Zone-day** | One triangle for a single day | $25 per day |

### Rough parts cost (from our own orders plus typical prices)

| Part | Cost (CAD) |
|---|---|
| ESP32-WROOM-32 board | $13.99 each (our Amazon.ca order) |
| LD2410C radar | about $11.50 each (2-pack $22.99) |
| Raspberry Pi 4, 4 GB | about $80 (estimate) |
| Power banks, cases, cones | about $60 per kit (estimate) |
| **Starter Triangle total** | **about $200 to $250** |

At the example $149 per month, a Starter Triangle pays back its parts in under two months, and every month after that is margin for support, replacements and software. These are estimates to refine.

---

## 13. Scaling up: expansion kits and worker tags

### Expansion kits

- **More nodes:** each extra node adds a side connected to the hub (a star around the hub), so a triangle grows into a larger fence. One hub receiver handles two to three nodes before its serial link fills up; beyond that, switch to 20 MHz Wi-Fi (shorter lines) or add a second receiver ESP32 at the hub (the Pi has four USB ports).
- **Monitoring the bottom side:** a node that can also receive and forward its data to the hub over Wi-Fi (firmware work after the hackathon).
- **More radars:** at the hub or on nodes, for bigger insides or an outward-facing approach warning.
- **Many zones:** several hubs on one site, all on one dashboard.

### Worker tags (future work, say it in the pitch)

A small wearable with Bluetooth and a vibration motor:

- **Everyday:** the tag vibrates when its wearer walks into an armed danger zone, so the warning reaches the person, not only the operator.
- **Emergencies:** if part of a site becomes unsafe (a collapse, a gas leak, a fire), the supervisor marks those zones as unsafe on the dashboard. Tags in or near them vibrate with an "evacuate" pattern, and go quiet once the wearer reaches a zone marked safe, such as a muster point.
- **Authorized workers:** a crossing with a known tag nearby can be logged instead of alarmed.
- **Honest limits:** Bluetooth signal strength says "near this hub or node", not an exact position, so tags give "leave this area" and "you are safe now", not turn-by-turn directions. The fence itself still detects people **without** tags, which tag-only systems cannot.
- **Prototype if time allows:** an ESP32 plus a vibration motor (the hardware booth has vibrating disk motors and driver boards).

---

## 14. Integration plan

1. **Dashboard with the mock server** (done; the `triangle` scenario comes in dashboard Phase 11).
2. **Team A's detector output into the dashboard** through the processing server, replaying a recording. Real data, no hardware.
3. **One live side:** one node plus the hub, walk across, watch the dashboard.
4. **Both sides:** second node with its own sender address; per-side alerts.
5. **Add the radar** at the hub: inside presence and distance.
6. **Move to the Pi** (section 15); dashboard on a laptop or projector.
7. **Full rehearsal at the demo spot,** recalibrated there.

Done when: crossing either side shows ALERT with the right side within about 1 s; standing still inside keeps ALERT (radar); CLEAR returns within about 3 s after leaving; it recovers on its own if the server restarts; and it runs 30 minutes untouched without false alarms in an empty triangle.

---

## 15. Running it on the Raspberry Pi

Pi 4 Model B, 4 GB is plenty.

1. 64-bit Raspberry Pi OS; Lite if the dashboard is viewed on another device.
2. Official 5.1 V / 3 A USB-C supply; `vcgencmd get_throttled` must print `throttled=0x0`.
3. Heatsink or fan for long runs in a case.
4. 5 GHz Wi-Fi or Ethernet, to keep 2.4 GHz quiet near the triangle.
5. `sudo usermod -aG dialout $USER`, log out and in. Boards appear as `/dev/ttyUSB0` (CP2102) or `/dev/ttyACM0`; check `ls /dev/tty*` before and after plugging in.
6. `python3 -m venv ~/perrymeter-venv`, `source ~/perrymeter-venv/bin/activate`, `pip install -r processing/requirements.txt`.
7. Serve the built dashboard: `npm run build` on a laptop, copy `dist` to the Pi, `python3 -m http.server 8080 --directory dist`.
8. Pi screen: `chromium --kiosk "http://localhost:8080/?kiosk=1&mode=live"` (`chromium-browser` on older versions).

---

## 16. Demo and presentation

### Setup

Three cones in a triangle, 2 to 3 m sides, with tape on the floor marking the inside and a sign "DANGER ZONE: CRANE LIFT IN PROGRESS". The hub cone at the top with the Pi, receiver and radar; the dashboard on a laptop or projector. Put the bottom side against a wall or table, or say "the expansion kit closes this side".

**Before judges arrive:** recalibrate at the demo spot with the crowd present; charge power banks; tape everything down; run 30 minutes untouched; have a replay recording and a screen recording of a good run ready.

### The 15-minute presentation

| Time | Section | Content |
|---|---|---|
| 1 min | Hook | "Every site has zones people shouldn't walk into while work is happening. How do you know when someone does?" |
| 2 min | Problem | Sourced statistic. Gaps: cones and tape, cameras, optical sensors, tags, cost of permanent systems |
| 1 min | Idea | Wi-Fi already bounces off people; three smart cones make a danger triangle |
| 3 min | How it works | The triangle diagram: two tripwire sides, radar inside, alert levels, arming |
| 4 min | Live demo | Cross the left side: left side lights up, ALERT. Stand still inside: radar keeps ALERT. Step out: CLEAR. Disarm and walk in: logged, no alarm. **Cover the nodes with a towel and repeat:** "a camera would be blind now" |
| 2 min | Business | Rented per month, expansion kits, worker tags, parts cost and payback (section 12) |
| 1 min | Results and limits | Measured per-side detection and false alarms; what it cannot do |
| 1 min | Next steps and close | Tags for evacuation guidance, bottom-side monitoring, multi-zone sites. "A safety perimeter that rents for less than a day of a spotter's time" (only if you check that comparison) |

**Fallbacks:** replay a real recording (say so); Demo mode (labelled simulated) plus the screen recording; run on a laptop if the Pi fails.

---

## 17. Judge questions to prepare for

- **"Doesn't this exist?"** Road work-zone alarms fire when a vehicle hits a cone or drives over a hose; tag systems only see tagged workers; researchers have shown Wi-Fi sensing near restricted areas in fixed indoor setups. Ours: contactless, tag-free, three-cone, portable, rented per month.
- **"Workers vs other people?"** An armed exclusion zone allows nobody in; disarm for crew access. Tags (section 13) will mark authorized workers.
- **"Which way did they go?"** We know which side was crossed; the radar shows how far from the hub someone is inside.
- **"Why not cameras or LiDAR?"** Both need a clean line of sight; mud, dust, smoke and darkness blind them; no video of workers with ours.
- **"Why not radar alone?"** Radar sees a fan from one point, not a fence line; Wi-Fi sides handle mud better; together they cover crossings and people standing still.
- **"Why rent instead of sell?"** Zones are temporary, crews already rent equipment, no upfront cost, and we keep the kits working and updated.
- **"How accurate?"** Only our measured numbers, with how they were measured.

---

## 18. Timeline

| When | Goal |
|---|---|
| **Sat, boards arrive** | Flash the hub receiver (5-byte filter) and two nodes (`:01`, `:02`, 30 per second). Link test each side: better than -60 dBm |
| **Sat afternoon** | Record the labelled set per side. Recalibrate and score the detector per side. Wire the radar at the hub |
| **Sat evening** | Processing server with per-side links, nodes and alert logic. First live end-to-end run. Dashboard phases 11 and 12 |
| **Sun** | Pi setup. Measure results. Slides including the business model, README, About text and summary. Full rehearsal, twice. Tag prototype only if everything else works |
| **Mon 8 to 11 AM** | Final fixes only. Make the repo public. **Submit before 11:00 AM MT** |
| **Mon afternoon** | Judging; return hardware by 7 PM |

If anything is more than 4 hours behind, cut a stretch goal (tag prototype first, then the second side, then sound).

---

## 19. Risks and fallbacks

| Risk | Sign | What to do |
|---|---|---|
| Boards late or faulty | Not arrived by Saturday afternoon | Hardware booth; Feather with antenna as one node |
| Hub cannot tell sides apart | Every line shows the same sender address | Check each node was flashed with its own `CONFIG_CSI_SEND_MAC` |
| Second side missing | Only one sender address appears | Receiver still compares 6 bytes; change the filter to 5 |
| Serial link full | About 60 to 70 lines per second at the Pi, many id gaps | Sender rate 30 or lower |
| Weak signal | RSSI below about -70 dBm on a side | Antenna ends clear; shorter side; quieter channel |
| Crowd triggers it | ALERT with nobody at the triangle | Shorter sides, quieter spot, calibrate with the crowd present |
| Radar trouble | No frames | Use its OUT pin; or demo without the inside hold |
| Running out of time | No end-to-end run by Saturday night | Freeze features: one side plus the dashboard is still a complete demo |

---

## 20. Repo, branches and workflow

| Branch | What | Status |
|---|---|---|
| `main` | Demo-ready code | Dashboard (phases 1 to 10), Team A recorder and detector, processing server |
| `frontend/web-dashboard` | Dashboard and docs | Phase 11 and the Perrymeter docs on top of `main`; Phase 12 next |
| `processing/server` | Processing server | Merged into `main` (PR #6) |

| Path | What |
|---|---|
| `project.md` | This guide |
| `firmware/` | ESP32 notes (Espressif's examples with the settings in section 5) |
| `collection/` | Serial recorder |
| `processing/` | Per-side detectors, radar reader, WebSocket server |
| `frontend/web/` | Dashboard |
| `frontend/pi_display/` | Earlier PySide6 prototype, not used |
| `data/` | Recordings (not committed; only `README.md` and `captures.md`) |
| `calibration/` | Calibration files per site |
| `docs/` | Plan, message format, results |

Workflow (details in `CONTRIBUTING.md`): never push straight to `main`; one branch per task; small pull requests; message-format changes need someone from each team; never commit recordings or build output. **Make the repo public before submitting.**

---

## 21. Glossary

| Term | Meaning |
|---|---|
| Danger triangle | Three cones: a hub at the top and two nodes, with two Wi-Fi sides and a radar inside |
| Hub | The top cone: Pi, receiver ESP32, radar |
| Node | A bottom-corner cone with a sender ESP32 |
| Side / link | The Wi-Fi tripwire between a node and the hub |
| CSI | Channel State Information: per-subcarrier measurement of how the signal arrived |
| RSSI | Received signal strength in dBm; closer to 0 is stronger |
| ESP-NOW | Espressif's way for ESP32 boards to send packets to each other without a router |
| MNR | Motion-to-noise ratio, Team A's movement score |
| Calibration | Learning what the empty zone looks like, per side |
| LD2410C | Small 24 GHz radar module that detects people and their distance |
| Arm / disarm | Alarm on while the hazard is active; logging only while the crew works inside |
| Expansion kit | Extra nodes or radars that grow a triangle into a bigger perimeter |
| Worker tag | Planned vibrating wearable that warns its wearer and guides them out in an emergency |
