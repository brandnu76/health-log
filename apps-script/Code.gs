/**
 * Workout logger for the health-log tracker.
 *
 * Bind this file to the Google Sheet: open the sheet, then Extensions → Apps Script,
 * paste this file, and deploy as a web app (Execute as me, Who has access: Anyone).
 *
 * doPost expects a text/plain JSON body:
 *   { sessionId, date, day, loggedAt, sets: [{ exercise, side, setNumber, weightLb, reps, seconds, loggedAt }] }
 * It appends one Sets row per set and one Sessions summary row.
 * If that session id is already on the Sets sheet, the post is ignored.
 */

var SETS_HEADERS = [
  "date",
  "workout day",
  "exercise",
  "side",
  "set number",
  "weight lb",
  "reps",
  "seconds",
  "session id",
  "logged at"
];

var SESSIONS_HEADERS = ["date", "day", "total sets", "total volume"];

function doGet() {
  return ContentService
    .createTextOutput("Workout logger is ready. Finish a session in the tracker to add rows.")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut({ ok: false, error: "busy, try again" });
  }
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : "";
    if (!raw) return jsonOut({ ok: false, error: "empty body" });
    var data = JSON.parse(raw);
    var sessionId = text(data.sessionId);
    if (!sessionId) return jsonOut({ ok: false, error: "missing sessionId" });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var setsSheet = getOrCreate(ss, "Sets", SETS_HEADERS);
    if (!headersMatch(setsSheet, SETS_HEADERS)) {
      return jsonOut({ ok: false, error: "Sets headers were changed. Restore the original header row." });
    }
    if (sessionExists(setsSheet, sessionId)) {
      return jsonOut({ ok: true, duplicate: true });
    }

    var rows = buildSetRows(data, sessionId);
    if (rows.length) appendRows(setsSheet, rows);
    appendSession(ss, data, rows);
    return jsonOut({ ok: true, duplicate: false, sets: rows.length });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function buildSetRows(data, sessionId) {
  var sets = data && Array.isArray(data.sets) ? data.sets : [];
  var date = text(data.date);
  var day = text(data.day);
  var fallbackLogged = text(data.loggedAt);
  var rows = [];
  for (var i = 0; i < sets.length; i++) {
    var set = sets[i] || {};
    rows.push([
      asText(date),
      asText(day),
      asText(set.exercise),
      asText(set.side),
      asNum(set.setNumber),
      asNum(set.weightLb),
      asNum(set.reps),
      asNum(set.seconds),
      asText(sessionId),
      asText(set.loggedAt || fallbackLogged)
    ]);
  }
  return rows;
}

function appendSession(ss, data, rows) {
  var sheet = getOrCreate(ss, "Sessions", SESSIONS_HEADERS);
  if (!headersMatch(sheet, SESSIONS_HEADERS)) {
    throw new Error("Sessions headers were changed. Restore the original header row.");
  }
  var volume = 0;
  for (var i = 0; i < rows.length; i++) {
    var weight = rows[i][5];
    var reps = rows[i][6];
    if (typeof weight === "number" && typeof reps === "number") volume += weight * reps;
  }
  appendRows(sheet, [[
    asText(data.date),
    asText(data.day),
    rows.length,
    volume
  ]]);
}

function getOrCreate(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function headersMatch(sheet, headers) {
  if (sheet.getLastRow() < 1) return false;
  var width = Math.max(sheet.getLastColumn(), headers.length);
  var row = sheet.getRange(1, 1, 1, width).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(row[i] || "").toLowerCase().trim() !== headers[i]) return false;
  }
  return true;
}

function sessionExists(sheet, sessionId) {
  var col = headerIndex(sheet, "session id");
  if (!col) return false;
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var cell = String(values[i][0] == null ? "" : values[i][0]);
    if (cell.charAt(0) === "'") cell = cell.slice(1);
    if (cell === sessionId) return true;
  }
  return false;
}

function headerIndex(sheet, name) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var want = String(name).toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").toLowerCase().trim() === want) return i + 1;
  }
  return 0;
}

function appendRows(sheet, rows) {
  if (!rows.length) return;
  var start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function asText(v) {
  if (v === null || v === undefined || v === "") return "";
  var s = String(v);
  if (s.charAt(0) === "'") s = s.slice(1);
  return "'" + s;
}

function asNum(v) {
  if (v === null || v === undefined || v === "") return "";
  var n = Number(v);
  return isFinite(n) ? n : "";
}

function text(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.TEXT);
}
