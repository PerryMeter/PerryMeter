# Detection message format (processing to frontend)

`processing/` runs a WebSocket server and the Perrymeter dashboard in `frontend/web/` connects as a client.

- **Address:** `ws://<host>:8765`, listening on `0.0.0.0` so other devices can connect.
- **Rate:** about 10 messages per second. Do not send one per CSI packet.
- **Clients:** several at once (laptop, phone, Pi screen).
- **Each message:** one JSON object (an array of objects is also accepted).

## Message

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

| Field | Type | Required | Meaning |
|---|---|---|---|
| `t` | number | yes | Unix time in seconds (float), from the Python machine |
| `motion` | boolean | yes | Any side currently crossed or moving |
| `strength` | number, 0 to 1 | yes | The strongest side's movement level |
| `confidence` | number, 0 to 1 | yes | Detector's own confidence; a heuristic, not a validated probability |
| `alert` | `"clear"`, `"approach"` or `"inside"` | no | Fused alert level. If missing, the dashboard uses `motion` (`true` means `"inside"`) |
| `distance_m` | number or null | no | Radar distance from the hub to the nearest person inside, in metres |
| `links` | array | no | One object per monitored side: `id` (`"left"`, `"right"`, later `"base"`), `motion` (boolean), `strength` (0 to 1), optional `rssi` (dBm) and `pps` (packets per second) |
| `nodes` | array | no | One object per device: `id` (`"hub"`, `"left"`, `"right"`, `"radar"`, more with expansion kits) and `online` (boolean: heard from in the last 2 s) |

## Rules

- The dashboard ignores unknown fields, so debug fields are fine.
- The older names `timestamp` (for `t`), `detected` (for `motion`) and `motion_score` (for `strength`) are still accepted. New code should use the names above.
- Values outside 0 to 1 are clamped. A message without a boolean `motion` and a numeric `strength` is counted as invalid and skipped. Invalid entries inside `links` or `nodes` are skipped without invalidating the message.
- Arming and disarming is a dashboard setting and is not part of this message.
- Additive changes are fine. Renaming or removing fields needs agreement from both teams and an update to this file and `project.md` section 7 in the same pull request.
- For testing without hardware, `frontend/web/mock/mock_server.py` sends messages in this format.
