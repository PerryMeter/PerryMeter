# data/

Raw CSI recordings. Everything here except this README and `captures.md` is gitignored; share large recordings on the team drive.

## Format

CSV with a header `t,label,raw_csi`: host time in seconds, the label, and the receiver's raw `CSI_DATA` line unchanged.

## Naming

```
YYYYMMDD-HHMM_<scenario>_<location>_<board>.csv
```

Example: `20261107-1430_cross_hallA_rx1.csv`

| Scenario | What happens |
|---|---|
| `empty` | Nobody within about 4 m of the line (a person sitting next to the boards is not empty) |
| `cross` | One person walks across the line between the boards, back and forth |
| `approach` | Walks toward the line and stops just before it |
| `still` | Stands still right on the line |
| `crowd` | Nobody at the line, people moving 3 to 5 m away |
| `covered` | `cross` with a towel over both boards |

`location` is a short tag for the spot (for example `hallA`), and `board` the receiver id (for example `rx1`).

## Notes

Add one line per useful recording to `captures.md`: who, scenario, distance between the boards, RSSI, packets per second, and anything unusual. **Re-record after the boards move**: calibration from one setup does not carry over to another.
