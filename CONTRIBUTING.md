# Contributing

Simple workflow for a 5-person, 64-hour hackathon. Speed matters, but `main` should always run. Read [`project.md`](project.md) first.

## Setup

The repo lives on GitHub at [isr808/RadarPing](https://github.com/isr808/RadarPing):

```bash
git clone https://github.com/isr808/RadarPing.git
```

## Branches

- `main` is the demo-ready branch. Don't push to it directly.
- Branch per task: `<area>/<short-desc>`, e.g. `processing/radar-reader`, `processing/ws-server`, `frontend/web-dashboard`, `docs/zone-safety`.
- Keep branches short-lived; pull `main` often (`git pull --rebase origin main`).

## Pull requests

1. Push your branch and open a PR to `main`.
2. One sentence on what changed and how you tested it (a screenshot for UI).
3. One teammate reviews, preferably from the other team at integration points. Approve fast; fix forward.
4. Squash-merge, then delete the branch.

Changes to [`docs/detection-contract.md`](docs/detection-contract.md) need a reviewer from both Team A and Team B.

## Other rules

- Never commit captures, secrets, or build output (see `.gitignore`).
- Update the relevant folder README when you add a run command or format.
- Stuck more than 30 minutes? Say so in the team chat.
