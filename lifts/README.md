# Lifts and daily logs

Session files are optional backups. The live logger is **[Daily log](https://brandnu76.github.io/health-log/log.html)** (`docs/log.html`). That page stores days in the phone browser and can copy markdown for this folder.

Name files `YYYY-MM-DD.md`.

# Lifts (Hevy)

Weekly strength data from the Hevy app, logged next to the Saturday Fitdays+ scan so each week's lean-mass change can be read against what was lifted. Lean mass dipped recently; progress on the main lifts is the signal that the body is being told to keep muscle during the cut.

**Status:** Hevy account opened 2026-10-04. No data yet. The dashboard "Lifts" card shows an empty state until `lifts` in `docs/data.json` has entries. Never estimate or back-fill numbers.

**Not medical advice.** Hevy totals are only as good as what was logged.

## Weekly workflow

1. **During the week:** log every session in Hevy as it happens (Mon Lift A / Wed Lift B / Fri Lift C per `PROTOCOL.md`). Mark warm-up sets as warm-up so they are not counted.
2. **Per exercise, in Hevy's exercise notes:** record the implement weight (adjustable kettlebell setting), tempo (e.g. `3-1-1`), and reps in reserve. Hevy has no tempo field, so this is the only place tempo lives.
3. **Saturday:** after the Fitdays+ scan, send the Council one of:
   - the Hevy **CSV export** (Hevy app → Profile → Settings → Export & Import Data → Export). Availability by plan is **unverified**. Confirm in the app; or
   - a **screenshot of the week** (workout list or per-exercise history) covering Sunday–Saturday.
4. **Council logs it:** adds `lifts/weeks/YYYY-MM-DD.md` from [`weeks/_TEMPLATE.md`](weeks/_TEMPLATE.md) (week-ending Saturday date), appends one object to `lifts` in `docs/data.json`, and links the matching `scans/` entry, `fuel/weeks/` file, and `council/` note.

A typical Hevy CSV has one row per set (columns such as `title`, `start_time`, `exercise_title`, `exercise_notes`, `set_index`, `set_type`, `weight_lbs` (or `weight_kg`), `reps`, `rpe`). Confirm the real columns and the weight unit on the first export before computing anything.

## Main lifts

Pick **5–6 main lifts once** and keep the exact Hevy exercise names unchanged, so weeks line up. Cover push, pull, squat, hinge, and a carry or core movement (kettlebells + bench). Accessories are not tracked here.

Main lifts chosen: _not yet set. Fill in after the first real week._

## Tracked metrics

| Metric | Notes |
|---|---|
| Sessions / week | Plan is 3 (Mon / Wed / Fri). Count Hevy workouts with at least one working set |
| Weekly volume per main lift | Working sets × reps × weight (lb). Exclude warm-up sets |
| Total weekly volume | Sum over **all** logged exercises, not only the main lifts. Use Hevy's total if the CSV is incomplete and say so in the note |
| Top set per lift | Heaviest working set that week as weight × reps. Estimated 1RM (Epley: `weight × (1 + reps/30)`) is optional in the week file only. The dashboard does not compute it |
| Stalled-lift flag | **No progress for 3 weeks.** See below |
| Tempo notes | From Hevy exercise notes. Flag any week the tempo or rep-in-reserve rule was not kept, because that changes how to read the volume |

**Progress** means a heavier top set, or the same weight with more reps (double progression). **Stalled** means that for a lift with at least 4 logged weeks, none of its latest 3 logged weeks beat the best top set before them. Stalled is a prompt to check food, sleep, and recovery first, then change reps, tempo, or load. Per `PROTOCOL.md`: a mild cut continues only while lifts hold or improve. Lifts stalled **and** muscle/LBM drifting down for 2+ weeks means pause the cut for 2–3 weeks.

Kettlebell note: adjustable kettlebells jump in steps, so a stall can be a step too big. Reps at the same weight count as progress. For one-hand lifts, say in the note whether the volume counts one implement or both, and keep that convention the same every week.

## Data schema

`docs/data.json` has an optional top-level key `"lifts"`: an array, one object per week. Empty or missing means no data. Do not change `scans`, `fuel`, `meta`, or `goals`.

```json
{
  "lifts": [
    {
      "weekEnding": "YYYY-MM-DD",
      "sessions": 0,
      "totalVolumeLb": 0,
      "lifts": [
        { "name": "Exercise name", "sets": 0, "volumeLb": 0, "topSetLb": 0, "topSetReps": 0 }
      ],
      "notes": "tempo / weight notes"
    }
  ]
}
```

The zeros above are placeholders for the schema only. Real entries use real values.

| Field | Type | Meaning |
|---|---|---|
| `weekEnding` | string `YYYY-MM-DD` | Saturday that ends the week (scan day). Required. A repeated date keeps the later row |
| `sessions` | integer | Hevy workouts that week |
| `totalVolumeLb` | number | Total volume, all exercises, working sets only |
| `lifts` | array | One object per main lift trained that week |
| `lifts[].name` | string | Hevy exercise name, identical every week. Required. Rows without a name are ignored |
| `lifts[].sets` | integer | Working sets |
| `lifts[].volumeLb` | number | Working sets × reps × weight for this lift |
| `lifts[].topSetLb` | number | Weight of the top working set |
| `lifts[].topSetReps` | integer | Reps of that top set |
| `notes` | string (or array of strings) | Tempo, implement weight, and anything that changes how to read the week |

Any field may be omitted or `null`. The dashboard shows "—" for it and never fills a value in. Rows are sorted by `weekEnding`; the latest row drives the cards and table, and all rows feed the volume chart and stalled-lift check.

The dashboard code is `docs/lifts.js` (loaded after `fuel.js`).
