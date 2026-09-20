# Health log

Private progress log for Fitdays+ body-composition trends, lift notes, and Council of Health analyses.

**Not a medical record. Not a diagnosis.** Fitdays+ is a consumer BIA trend tool, not DEXA.

## Dashboard

A static dashboard lives in [`docs/`](docs/). Open it locally or enable GitHub Pages (Settings → Pages → Deploy from a branch → folder `/docs`).

# Health Log — GitHub Pages / local preview

Static dashboard for the `brandnu76/health-log` repo. UI reads **`docs/data.json`** so new scans are add-only.

## GitHub Pages

1. Repo **Settings → Pages**.
2. Source: **Deploy from a branch**.
3. Branch: `main` (or default), folder: **`/docs`**.
4. Save. Site URL will be like `https://brandnu76.github.io/health-log/`.

Ensure these files stay under `docs/`:

- `index.html`, `styles.css`, `app.js`, `data.json`

Optional: set Pages custom domain later; paths are relative so the site works at a repo root or `/docs` publish root.

## Local preview

Browsers block `fetch("data.json")` on `file://`. Serve the folder over HTTP:

```bash
# from repo root
cd docs && python3 -m http.server 8080
# open http://localhost:8080/
```

Or:

```bash
npx --yes serve docs
```

## Adding a scan

Append an object to `scans` in `data.json` (same field names as Sep 19). Charts skip `null`s; metric cards use the latest non-partial scan with weight. Keep February baseline for deltas.

## Merge note

Fold this section into the main repo README when ready. Do not commit secrets; this site is public if Pages is enabled on a private repo only for entitled viewers (org/plan dependent)—confirm visibility before enabling Pages.


## How to read this

- `scans/` — raw metrics, same fields every time
- `council/` — full Council write-ups for a given scan date
- `progress.md` — newest-first changelog of deltas that matter
- `PROFILE.md` — goals, training, nutrition stance
- `PROTOCOL.md` — current 8–12 week consensus protocol
- `lifts/` — optional load × reps × tempo logs
- `docs/` — visual dashboard (`data.json` drives the UI)

## Rules

- Track **LBM** and **muscle mass** as separate fields; never mix labels across dates.
- Ignore scale “ideal weight.”
- Prefer waist + visceral + fat mass + lifts over scale theater.
- Same scan conditions when possible: morning, post-bathroom, pre-food/coffee.
