# Detection interface contract (processing → frontend)

`processing/` runs a WebSocket server; `frontend/` connects as a client. Default URL: `ws://localhost:8765`. Each message is one JSON object, sent at roughly 5–20 Hz.

## Message

```json
{
  "type": "detection",
  "timestamp": 1762473600.125,
  "motion_score": 0.72,
  "detected": true,
  "confidence": 0.85,
  "angle_deg": 40.0,
  "distance_m": 2.5,
  "source": "rx1"
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | string | yes | Always `"detection"` for now |
| `timestamp` | number | yes | Unix time in seconds (float) |
| `motion_score` | number | yes | Normalized movement level, 0.0–1.0 |
| `detected` | boolean | yes | Processing's decision that a person is moving |
| `confidence` | number | yes | 0.0–1.0 confidence in `detected` |
| `angle_deg` | number \| null | no | Stretch: bearing, 0 = straight ahead, clockwise positive |
| `distance_m` | number \| null | no | Stretch: approximate distance in meters |
| `source` | string | no | RX board id |

## Rules

- Frontend must ignore unknown fields and handle missing optional fields (show detection without a position).
- Additive changes are fine; renaming or removing fields needs agreement from both teams and an update to this doc in the same PR.
- Until processing works, Team B uses a mock server that emits messages in exactly this shape.
