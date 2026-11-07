# RadarPing Web Dashboard

## 1. What this is

RadarPing is a live safety fence dashboard for temporary work zones on construction sites. It visualizes fused Wi-Fi channel state information (CSI) disturbance detection and LD2410C radar proximity measurements streamed in real time over a WebSocket connection.

## 2. Run it

To install dependencies and start the development server:

```bash
cd frontend/web
npm install
npm run dev
```

Open the printed URL in your browser (typically `http://localhost:5173`).

To open the dashboard from a phone, tablet, or another computer on the same local network, pass the `--host` flag:

```bash
npm run dev -- --host
```

## 3. Demo and Live mode

The dashboard supports two operating modes:

- **Demo mode:** Produces synthetic detection streams in the browser without requiring external hardware or Python servers. It simulates periodic worker visits cycling through clear, approach countdown, inside intrusion, and departure phases. All synthetic data is clearly labelled with a `SIMULATED DATA` badge in the header and a `SIMULATED` label on the radar scope. Controls are provided in the source bar to simulate entries and pause/resume the feed.
- **Live mode:** Connects to an external WebSocket server (either Team A's CSI detector daemon or the included mock server) to display real-time sensor measurements.

The active mode can be toggled via the mode switch in the top bar, or preset via the URL query parameter `?mode=live` or `?mode=demo`.

## 4. Connecting to the detector

By default, Live mode connects to:

```
ws://localhost:8765
```

You can change the target WebSocket endpoint in three ways:

1. In the dashboard UI: type the new address into the Endpoint field in the source bar and click **Apply**.
2. In the URL: add the `?ws=` query parameter, for example `?ws=ws://192.168.1.50:8765`.
3. In local environment configuration: create `.env.local` inside `frontend/web/` and define `VITE_WS_URL=ws://192.168.1.50:8765`.

Note: Browsers enforce mixed-content security restrictions. A dashboard served over HTTPS (`https://`) cannot connect to an insecure WebSocket (`ws://`). To connect to a local `ws://` endpoint, serve the dashboard over HTTP (`http://`).

## 5. Message format

The detector server sends one JSON object per message ten times per second (10 Hz):

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

### Fields

| Field | Type | Meaning |
|---|---|---|
| `t` | number | Unix timestamp in seconds (float) from detector clock |
| `motion` | boolean | Detector decision indicating active movement |
| `strength` | number | Movement intensity between 0.0 and 1.0 (rendered as 0-100%) |
| `confidence` | number or null | Detector confidence score between 0.0 and 1.0 (not a validated probability) |
| `alert` | string | Optional alert level: `"clear"`, `"approach"`, or `"inside"` |
| `distance_m` | number or null | Optional distance in metres (0.0 to 20.0) from radar to nearest person |

### Backwards compatibility

To maintain compatibility with earlier detector implementations, the parser accepts legacy field aliases:

- `timestamp` as an alias for `t`
- `detected` as an alias for `motion`
- `motion_score` as an alias for `strength`

If both standard and legacy field names are present, standard names take precedence. If optional fields `alert` or `distance_m` are missing or invalid, `alert` is automatically derived from `motion` (`"inside"` if motion is true, `"clear"` otherwise), and `distance_m` defaults to `null`.

## 6. Test Live mode without hardware

A Python mock server is included in `frontend/web/mock/` to simulate sensor hardware streams:

```bash
cd frontend/web
pip install -r mock/requirements.txt
python mock/mock_server.py
```

### Mock server options

- `python mock/mock_server.py`: Standard baseline stream with intermittent motion visits.
- `python mock/mock_server.py --scenario zone`: Simulates perimeter work-zone visits cycling through CLEAR, APPROACH with descending radar distance (5.5 m down to 1.0 m), and inside ALERT.
- `python mock/mock_server.py --scenario chaos`: Stress-tests dashboard resilience with malformed JSON, out-of-range values, missing fields, an array of two messages in one frame, and a 5-second silence.
- `python mock/mock_server.py --legacy`: Emits legacy field names (`timestamp`, `detected`, `motion_score`) without `alert` or `distance_m`.
- `python mock/mock_server.py --port 9000`: Runs the mock server on an alternate port.

## 7. Zone mode

RadarPing operates as a perimeter safety fence:

- **CLEAR:** Zone is secure. No motion detected near the perimeter.
- **APPROACH:** A person has entered the outer radar detection field and is approaching the fence line. The radar scope displays a shrinking dashed distance ring and real-time distance countdown.
- **ALERT:** An active intrusion has crossed into the protected work zone. The radar scope sweeps in alert color with expanding activity ripples.

### Arming and alarm audio

- **Armed / Disarmed:** When armed, an entry makes the zone card glow orange and, with sound on, plays an alarm. When disarmed, entries are logged in the event table as `Entry (disarmed)` with muted styling and no audio.
- **Sound control:** Web browsers block audio synthesis until an explicit user gesture has occurred. Click **Sound on** in the top bar to enable the Web Audio synthesizer. Audio automatically silences on CLEAR, on disarm, on muting sound, or when sensor data goes stale.

## 8. Raspberry Pi kiosk

The dashboard includes a dedicated kiosk mode tailored for small touch displays such as the official Raspberry Pi 800x480 screen:

```bash
cd frontend/web
npm run build
npm run preview -- --host
```

Then on the Raspberry Pi:

```bash
chromium --kiosk "http://localhost:4173/?kiosk=1&mode=live"
```

(Note: on older Raspberry Pi OS versions, the command is `chromium-browser`.)

In kiosk mode (`?kiosk=1`):
- Controls and configuration panels (SourceBar, ModeSwitch, armed toggles, EventList, and StatusFooter) are hidden to maximize screen real estate.
- Layout displays the radar scope on the left, zone card and strength/confidence metrics stacked on the right, and an activity graph across the bottom.
- Zero horizontal or vertical scrollbars.
- Mouse cursor automatically hides after 3 seconds of inactivity and restores on movement.

## 9. Checks

All automated verification checks can be run via:

```bash
cd frontend/web
npm run build
npm test
npm run lint
```
