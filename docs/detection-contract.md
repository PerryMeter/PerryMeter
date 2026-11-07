# Detection message format (processing to frontend)

`processing/` runs a WebSocket server and the dashboard in `frontend/web/` connects as a client.

- **Address:** `ws://<host>:8765`, listening on `0.0.0.0` so other devices can connect.
- **Rate:** about 10 messages per second. Do not send one per CSI packet.
- **Clients:** several at once (laptop, phone, Pi screen).
- **Each message:** one JSON object (an array of objects is also accepted).

## Message

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
| `t` | number | yes | Unix time in seconds (float), from the Python machine |
| `motion` | boolean | yes | Wi-Fi detector's decision: someone is crossing or moving in the zone |
| `strength` | number, 0 to 1 | yes | How strong the movement is |
| `confidence` | number, 0 to 1 | yes | Detector's own confidence in `motion`; a heuristic, not a validated probability |
| `alert` | `"clear"`, `"approach"` or `"inside"` | no | Fused alert level from the Wi-Fi detector and the radar. If missing, the dashboard uses `motion` (`true` means `"inside"`, `false` means `"clear"`) |
| `distance_m` | number or null | no | Radar distance to the nearest moving person, in metres. Missing or null when there is no radar or nobody is seen |

## Rules

- The dashboard ignores unknown fields, so debug fields are fine.
- The older names `timestamp` (for `t`), `detected` (for `motion`) and `motion_score` (for `strength`) are still accepted. New code should use the names above.
- Values outside 0 to 1 are clamped. A message without a boolean `motion` and a numeric `strength` is counted as invalid and skipped.
- Arming and disarming the fence is a dashboard setting and is not part of this message.
- Additive changes are fine. Renaming or removing fields needs agreement from both teams and an update to this file and `project.md` section 7 in the same pull request.
- For testing without hardware, `frontend/web/mock/mock_server.py` sends messages in this format.
