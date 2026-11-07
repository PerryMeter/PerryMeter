# data/

Raw CSI recordings. Everything here except this README and `captures.md` is gitignored; share large recordings on the team drive.

## Format

CSV with a header `t,label,raw_csi`: host time in seconds, the label, and the hub receiver's raw `CSI_DATA` line unchanged. The line's sender address (third column) says which side it came from: `1a:00:00:00:00:01` left, `:02` right.

## Naming

```
YYYYMMDD-HHMM_<scenario>_<location>_<hub>.csv
```

Example: `20261107-1430_cross-left_hallA_hub1.csv`

| Scenario | What happens |
|---|---|
| `empty` | Nobody within about 4 m of the triangle (a person sitting next to a cone is not empty) |
| `cross-left` | One person walks back and forth across the left side |
| `cross-right` | The same across the right side |
| `inside-still` | One person stands still inside the triangle |
| `near` | Walks along outside a side without crossing it |
| `crowd` | Nobody near the triangle, people moving 3 to 5 m away |
| `covered` | `cross-left` with a towel over the nodes |

`location` is a short tag for the spot (for example `hallA`), and `hub` the hub id (for example `hub1`).

## Notes

Add one line per useful recording to `captures.md`: who, scenario, side lengths, RSSI and packets per second per side, and anything unusual. **Re-record after any cone moves**: calibration from one setup does not carry over to another.
