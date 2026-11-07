# data/

Raw CSI captures. Everything here except this README is gitignored; share large captures out-of-band (shared drive) and note them below.

## Naming

```
YYYYMMDD-HHMM_<scenario>_<location>_<board>.csv
```

- `scenario`: `empty`, `walk`, `still`, `wave`, `throughwall-walk`, ...
- `location`: short room tag, e.g. `hall`, `roomA`
- `board`: RX board id, e.g. `rx1`

Example: `20261107-1430_walk_roomA_rx1.csv`

Keep a one-line note per useful capture (who, distance, wall or not) in a `captures.md` here or in `docs/`.
