# Brandon's Health Log

Private progress log for Fitdays+ body-composition trends, lift notes, and Council of Health analyses.

**© 2026 Brandon Carroll. All rights reserved.** See [`LICENSE`](LICENSE). No permission is granted to copy, scrape, republish, or redistribute this work without prior written permission.

**Not a medical record. Not a diagnosis.** Fitdays+ is a consumer BIA trend tool, not DEXA.

## Dashboard

Live site (GitHub Pages): https://brandnu76.github.io/health-log/

Static UI in [`docs/`](docs/), driven by `docs/data.json`.

### Local preview

```bash
cd docs && python3 -m http.server 8080
# open http://localhost:8080/
```

### GitHub Pages

Settings → Pages → Deploy from a branch → `main` / `/docs`.

## How to read this

- `scans/` — raw metrics, same fields every time
- `council/` — full Council write-ups for a given scan date
- `progress.md` — newest-first changelog of deltas that matter
- `PROFILE.md` — goals, training, nutrition stance
- `PROTOCOL.md` — current 8–12 week consensus protocol
- `lifts/` — optional load × reps × tempo logs
- `docs/` — visual dashboard (`data.json` drives the UI)
- `LICENSE` — all rights reserved

## Rules

- Track **LBM** and **muscle mass** as separate fields; never mix labels across dates.
- Ignore scale “ideal weight.”
- Prefer waist + visceral + fat mass + lifts over scale theater.
- Same scan conditions when possible: morning, post-bathroom, pre-food/coffee.
