# Fuel (Cronometer)

Weekly nutrition intake from Cronometer, logged next to the Saturday Fitdays+ scan so each week's fat / lean change can be read against what was eaten.

**Status:** Cronometer account opened 2026-10-04. No data yet. The dashboard "Fuel" card shows an empty state until `fuel` in `docs/data.json` has entries. Never estimate or back-fill numbers.

**Not medical advice.** Cronometer totals are only as good as the food entries behind them.

## Weekly workflow

1. **During the week:** log food in Cronometer the same day. Log supplements separately.
2. **Saturday:** after the Fitdays+ scan, send the Council one of:
   - the Cronometer **daily nutrition CSV** export (Cronometer web app → Account → Export Data → Daily Nutrition), covering Sunday–Saturday; or
   - a **screenshot of the weekly summary** (nutrition report) for the same week.
3. **Council logs it:** adds `fuel/weeks/YYYY-MM-DD.md` from [`weeks/_TEMPLATE.md`](weeks/_TEMPLATE.md) (week-ending Saturday date), appends one object to `fuel` in `docs/data.json`, and links the matching `scans/` entry and `council/` note.
4. Say which days were lifting days (Mon / Wed / Fri per `PROTOCOL.md`) if they differ.

## Tracked metrics

| Metric | Notes |
|---|---|
| Avg daily kcal | Mean over **logged** days only |
| Avg daily protein (g) | Target band **140–180 g/day**. `PROTOCOL.md` aims for the 160–180 end |
| Days in protein range | Count of logged days with protein in 140–180 g |
| Lifting-day vs rest-day kcal and protein | Lift days are Mon / Wed / Fri unless noted |
| Key micros | Iron, zinc, B12, choline, omega-3, vitamin D, magnesium (daily averages) |
| Days logged / 7 | **Under 5 = low confidence.** Treat averages as directional only |

Weekly loss cap is ≤1 lb/week (averaged). If scan fat loss runs faster and lean mass slips, read the Fuel row first: low protein or too-large deficit is the likely lever, not more cardio.

Supplements (creatine, whey, omega-3, vitamin D) are the only ones in use. Keep them in Cronometer's supplement section so they are not mistaken for food, but note that micros totals may or may not include them depending on the export. Say which in the week note.

## Logging tips

- **Weigh food** (grams) instead of using volume measures.
- Prefer **verified** database entries (green check). Many custom or user-added entries are wrong.
- Log **supplements separately** from food.
- Log **the same day**, not from memory later in the week.
- An incomplete day (skipped dinner, etc.) should not be counted as logged. Leave it out.

## Data schema

`docs/data.json` has an optional top-level key `"fuel"`: an array, one object per week. Empty or missing means no data. Do not change `scans`, `meta`, or `goals`.

```json
{
  "fuel": [
    {
      "weekEnding": "YYYY-MM-DD",
      "daysLogged": 0,
      "kcalAvg": 0,
      "proteinAvg": 0,
      "proteinDaysInRange": 0,
      "liftKcalAvg": 0,
      "restKcalAvg": 0,
      "micros": { "iron": 0, "zinc": 0, "b12": 0, "choline": 0, "omega3": 0, "vitaminD": 0, "magnesium": 0 }
    }
  ]
}
```

The zeros above are placeholders for the schema only. Real entries use real values.

| Field | Type | Meaning |
|---|---|---|
| `weekEnding` | string `YYYY-MM-DD` | Saturday that ends the week (scan day). Required |
| `daysLogged` | integer 0–7 | Days with a complete log. `<5` shows a low-confidence note |
| `kcalAvg` | number | Avg kcal/day over logged days |
| `proteinAvg` | number | Avg protein g/day over logged days |
| `proteinDaysInRange` | integer | Logged days with protein 140–180 g |
| `liftKcalAvg` | number | Avg kcal on lifting days. Omit if none logged |
| `restKcalAvg` | number | Avg kcal on rest days. Omit if none logged |
| `micros` | object | Daily avg. Keys: `iron` (mg), `zinc` (mg), `b12` (µg), `choline` (mg), `omega3` (g), `vitaminD` (IU), `magnesium` (mg). Omit unknown keys |

Any field may be omitted or `null`. The dashboard shows "—" for it and never fills a value in. Rows are sorted by `weekEnding`; the latest row drives the cards and all rows feed the chart.

The dashboard code is `docs/fuel.js` (loaded after `app.js`).
