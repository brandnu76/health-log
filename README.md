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

### Saturday scan fields in `data.json`

Log the Fitdays+ scan in `scans/` and on that day's object in `docs/data.json`. Leave unknown values out. Do not estimate them.

- `scans[].waistIn` — waist circumference in inches. Saturday morning, at the navel, after a relaxed exhale. Omit or `null` when not measured. First reading: 36.625 on 2026-10-03.
- `meta.subject.heightIn` — standing height in inches (`67`). One fact for the subject, not copied onto each scan. Waist-to-height ratio, FFMI, and FMI all use it.
- `goals.targets.whtrTarget` — waist-to-height goal (`0.5`). Target waist inches = height × this value.
- `scans[].scanTime` — optional local time of the scan, 24-hour `HH:MM`. Leave it out when the time was not recorded. Logged times: 2026-10-17 `09:12`, 2026-10-24 `09:47`.
- `goals.targets.scanTimeTarget` — target scan time (`06:30`). The dashboard notes when the latest scan is later than this, because BIA readings vary with time of day and hydration.

FFMI is the scan's `lbm` in kilograms divided by height in meters squared. FMI is `fatMass` in kilograms divided by height in meters squared. Both are BIA trends, not DEXA. Scans missing `lbm` (or `fatFreeMass` when `lbm` is absent) or `fatMass` are skipped and left blank.

### Scale switch (2026-11-06)

Fitdays+ (foot-only BIA, `device: "fitdays"`) ends with the 2026-11-01 scan. A segmental scale, brand not recorded (`device: "segmental"`), is the current scale from 2026-11-06. The 2026-11-05 22:33 reading was an evening test and is not a scan. The first official reading is the Saturday 2026-11-07 morning scan.

Every scan has a `device` field. Composition charts, what moved, loss quality, the lean floor, smoothed trends, the stall check, and goal pace use one device at a time. They open on the current scale. Fitdays+ is the earlier series, on the scale toggle. Weight and waist stay continuous, with a marker on 2026-11-06. A scale with too few scans says so instead of computing.

Optional segmental-scale fields. Leave unknown values out. Do not estimate them. Do not copy Fitdays+ numbers into these fields.

- `fatFreeMass` — fat-free mass in lb. The dashboard reads this as lean body mass when `lbm` is absent.
- `skeletalMuscleMass` — skeletal muscle mass in lb (not `skeletalMusclePct`, and not `muscleMass`).
- `bodyCellMass` — body cell mass in lb.
- `minerals` — mineral mass in lb (not `bone`).
- `intracellularWater`, `extracellularWater` — water mass in lb. Optional `intracellularWaterPct` and `extracellularWaterPct`.
- `heartRate` — the scale's heart-rate reading in bpm.
- Segmental muscle and fat, in lb, plus optional percent: `leftArmMuscle`, `leftArmFat`, `rightArmMuscle`, `rightArmFat`, `leftLegMuscle`, `leftLegFat`, `rightLegMuscle`, `rightLegFat`, `trunkMuscle`, `trunkFat`, and the same names with a `Pct` suffix.
- `subqFatMass` — subcutaneous fat mass in lb. `subqFat` stays the percent.
- `waistHipRatio` — the scale's waist-hip ratio. Not a tape waist. Do not copy it into `waistIn`.

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
