# Connect the workout tracker to a Google Sheet

The tracker is a page on your phone:

https://brandnu76.github.io/health-log/workouts/

That address works after this change is on the main branch. Until then, the page is only in the pull request.

You do this once. The phone keeps every set even with no signal, and sends it when it can. Sending the same workout twice does not add a second copy.

The web app URL stays on the phone. Do not put it in the repo.

## 1. Make a Google Sheet

1. Open [Google Sheets](https://sheets.google.com) and create a blank spreadsheet.
2. Name it something you will recognize, such as `Brandon workouts`.
3. Leave the first tab as it is. The script adds two tabs, `Sets` and `Sessions`, the first time a workout is sent.

## 2. Paste the script

1. In the spreadsheet, choose **Extensions → Apps Script**.
2. If you see a sample function, select it and delete it.
3. Open `apps-script/Code.gs` in this repo, copy the whole file, and paste it into the script editor.
4. Click the save icon. You can leave the project name as it is.

The script has to be opened from the spreadsheet. A script created on its own, not from the sheet, cannot see the tabs.

## 3. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Next to "Select type", choose the gear and pick **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**.
   "Anyone" means anyone who has the long URL can add a row. It does not mean the sheet shows up in search. Do not post the URL in a public place.
5. Click **Deploy**. Google will ask you to allow the script to edit the spreadsheet. Review the prompt and allow it.
6. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/…/exec`.

If you change `Code.gs` later, choose **Deploy → Manage deployments**, edit the deployment, set **Version** to **New version**, and deploy again. The URL stays the same.

## 4. Paste the URL into the tracker

1. On your phone, open the tracker: https://brandnu76.github.io/health-log/workouts/
2. Tap **Settings**.
3. Paste the web app URL into **Google Sheet web app URL**.
4. Tap **Save**.

That URL is stored only on that phone. Log one easy set, tap **Finish**, then look at the spreadsheet. You should see a `Sets` tab with one row and a `Sessions` tab with one summary row.

Columns on `Sets`: date, workout day, exercise, side, set number, weight lb, reps, seconds, session id, logged at.

Columns on `Sessions`: date, day, total sets, total volume.

Do not rename those header cells. The script matches on them.

## 5. Publish the tabs as CSV

The health-log dashboard reads a public CSV link. It does not read the private spreadsheet.

1. In the spreadsheet, choose **File → Share → Publish to web**.
2. Under **Link**, choose the **Sets** tab, not "Entire document".
3. Change **Web page** to **Comma-separated values (.csv)**.
4. Click **Publish** and confirm. Copy the link. It looks like `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?gid=…&single=true&output=csv`.
5. Repeat for the **Sessions** tab so you have a second link.

Leave "Automatically republish when changes are made" checked, or the dashboard will keep showing old numbers.

## 6. Where to paste the CSV links

**Sets link.** This is the one the dashboard uses. In the repo, open `docs/data.json` and find:

```json
"workoutsCsvUrl": ""
```

Paste the Sets CSV link between the quotes, so it looks like `"workoutsCsvUrl": "https://docs.google.com/…"`. Save that change on `main` (or ask the health-log agent to paste it). Reload the health log. The Lifts / Workouts section then shows sessions per week, the latest weight for each exercise, and a top-weight line.

Until that field has a link, or if the link cannot be read, the page shows **Connect your workout sheet** and the rest of the dashboard stays up.

**Sessions link.** Bookmark it if you want the weekly summary in a browser tab. The dashboard builds its own weekly counts from the Sets sheet, so do not put the Sessions link in `data.json`.

## If a workout does not show up

- On the tracker, Settings → **Send waiting**. The phone retries on its own when it is back online.
- Finish only sends sets you marked done.
- The same session is never added twice. If you already sent it, fix a mistake on the sheet. Deleting it on the phone does not remove the sheet row.
- If the phone says the link needs Anyone access, redeploy the web app with **Who has access: Anyone** and save the new URL only if Google changed it.
