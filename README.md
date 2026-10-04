# Brandon's Health Log

Private progress log for Fitdays+ body-composition trends, lift notes, meals, and Council of Health analyses.

**© 2026 Brandon Carroll. All rights reserved.** See [`LICENSE`](LICENSE). No permission is granted to copy, scrape, republish, or redistribute this work without prior written permission.

**Not a medical record. Not a diagnosis.** Fitdays+ is a consumer BIA trend tool, not DEXA.

## Dashboard

- Scans: https://brandnu76.github.io/health-log/
- Daily workout + plate log: https://brandnu76.github.io/health-log/log.html

Static UI in [`docs/`](docs/). Scans are driven by `docs/data.json`. The phone logger saves locally. Days land in [`logs/daily.json`](logs/daily.json) when pasted here and committed — no token on the phone.

### Local preview

```bash
cd docs && python3 -m http.server 8080
# open http://localhost:8080/
# log page: http://localhost:8080/log.html
```

### GitHub Pages

Settings → Pages → Deploy from a branch → `main` / `/docs`.

## How to read this

- `scans/` — raw metrics, same fields every time
- `council/` — full Council write-ups for a given scan or lab date
- `progress.md` — newest-first changelog of deltas that matter
- `PROFILE.md` — goals, training, nutrition stance
- `PROTOCOL.md` — current 12-week consensus protocol
- `logs/` — daily meal and lift JSON (GitHub copy)
- `lifts/` — optional markdown backups of logged days, plus weekly Hevy strength summaries (optional; see [`lifts/README.md`](lifts/README.md))
- `fuel/` — Cronometer weekly nutrition summaries (optional; see [`fuel/README.md`](fuel/README.md))
- `docs/` — visual dashboard + daily logger
- `LICENSE` — all rights reserved

## Rules

- Track **LBM** and **muscle mass** as separate fields; never mix labels across dates.
- Ignore scale “ideal weight.”
- Prefer waist + visceral + fat mass + lifts over scale theater.
- Same scan conditions when possible: morning, post-bathroom, pre-food/coffee.
- Daily log is for the 12-week A1c block (plate checks, walks, Lift A/B/C). It is not a calorie tracker.
- Do not put personal access tokens in the repo or on the logger page.
