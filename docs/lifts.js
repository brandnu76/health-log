/* Lifts / Workouts section — optional, self-contained.
 * Reads data.lifts from data.json. Empty or missing => friendly empty state.
 * Also reads program.workoutsCsvUrl (published Sets CSV). Empty URL or a failed
 * fetch shows a short connect note and never throws into the rest of the page.
 * Never invents numbers; every field is guarded. Does not touch app.js or fuel.js. */
(function () {
  "use strict";

  var TARGET_SESSIONS = 3;
  var STALL_WEEKS = 3;
  var EMPTY_MSG = "No Hevy data yet \u2014 send a weekly export on Saturday";
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var chart = null;
  var workoutChart = null;
  var liftRows = [];
  var workoutState = { status: "empty", rows: [] };

  function num(v) {
    if (typeof v === "string") {
      if (v.trim() === "") return null;
    } else if (typeof v !== "number") {
      return null;
    }
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }

  function fmtNum(v, digits) {
    var n = num(v);
    if (n === null) return "\u2014";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits || 0
    });
  }

  function fmtDate(iso) {
    if (typeof iso !== "string") return "";
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function cleanLifts(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (l) {
      return l && typeof l === "object" && typeof l.name === "string" && l.name.trim() !== "";
    });
  }

  function normalizeRows(raw) {
    if (!Array.isArray(raw)) return [];
    var byWeek = {};
    raw.forEach(function (r) {
      if (r && typeof r === "object" && typeof r.weekEnding === "string" && DATE_RE.test(r.weekEnding)) {
        byWeek[r.weekEnding] = r; // later duplicate wins
      }
    });
    return Object.keys(byWeek).sort().map(function (k) {
      var r = byWeek[k];
      return {
        weekEnding: k,
        sessions: num(r.sessions),
        totalVolumeLb: num(r.totalVolumeLb),
        lifts: cleanLifts(r.lifts),
        notes: noteText(r.notes)
      };
    });
  }

  function noteText(n) {
    if (typeof n === "string") return n.trim();
    if (Array.isArray(n)) {
      return n.filter(function (x) { return typeof x === "string" && x.trim() !== ""; }).join(" \u00b7 ");
    }
    return "";
  }

  function liftKey(name) {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  /* Double progression: heavier top set wins; same weight => more reps wins. */
  function better(a, b) {
    if (a.w !== b.w) return a.w > b.w;
    return a.r > b.r;
  }

  /* Per-lift history of top sets across weeks (only weeks with a numeric top-set weight). */
  function history(rows, key) {
    var out = [];
    rows.forEach(function (row) {
      row.lifts.forEach(function (l) {
        if (liftKey(l.name) !== key) return;
        var w = num(l.topSetLb);
        if (w === null) return;
        var r = num(l.topSetReps);
        out.push({ week: row.weekEnding, w: w, r: r === null ? 0 : r });
      });
    });
    return out;
  }

  /* Returns {code, text}. Stalled = latest STALL_WEEKS entries all fail to beat the best earlier top set. */
  function liftStatus(hist) {
    var n = hist.length;
    if (n < 2) return { code: "baseline", text: "Baseline" };
    var last = hist[n - 1];
    var prior = hist.slice(0, n - 1);
    var best = prior.reduce(function (b, h) { return better(h, b) ? h : b; }, prior[0]);
    if (better(last, best)) return { code: "best", text: "New best" };
    if (n < STALL_WEEKS + 1) return { code: "hold", text: "Holding" };
    var recent = hist.slice(n - STALL_WEEKS);
    var earlier = hist.slice(0, n - STALL_WEEKS);
    var ebest = earlier.reduce(function (b, h) { return better(h, b) ? h : b; }, earlier[0]);
    var anyBetter = recent.some(function (h) { return better(h, ebest); });
    if (!anyBetter) return { code: "stalled", text: "Stalled " + STALL_WEEKS + "+ wks" };
    return { code: "hold", text: "Holding" };
  }

  function statCard(label, value, unit, sub, band) {
    var card = el("div", "metric-card card card-pad" + (band ? " band-" + band : ""));
    card.setAttribute("role", "listitem");
    card.appendChild(el("div", "label", label));
    var v = el("div", "value", value);
    if (unit) v.appendChild(el("span", "unit", unit));
    card.appendChild(v);
    if (sub) card.appendChild(el("div", "delta", sub));
    return card;
  }

  function buildSection() {
    var section = el("section", "section");
    section.id = "liftsSection";
    section.setAttribute("aria-labelledby", "lifts-heading");
    var head = el("div", "section-head");
    var h2 = el("h2", null, "Lifts / Workouts");
    h2.id = "lifts-heading";
    head.appendChild(h2);
    head.appendChild(el("span", "meta", "Hevy weekly summary \u00b7 workout sheet"));
    section.appendChild(head);
    var body = el("div", null);
    body.id = "liftsBody";
    section.appendChild(body);
    return section;
  }

  function mountSection() {
    var existing = document.getElementById("liftsSection");
    if (existing) return existing;
    var section = buildSection();
    var fuel = document.getElementById("fuelSection");
    var timelineHead = document.getElementById("timeline-heading");
    var anchor = timelineHead ? timelineHead.closest("section") : null;
    var main = document.getElementById("main");
    if (fuel && fuel.parentNode) {
      fuel.parentNode.insertBefore(section, fuel.nextSibling);
    } else if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(section, anchor);
    } else if (main) {
      main.appendChild(section);
    } else {
      return null;
    }
    return section;
  }

  function renderEmpty(body) {
    var card = el("div", "card card-pad");
    card.appendChild(el("p", null, EMPTY_MSG));
    card.appendChild(el("p", "chart-band-note",
      "Tracked: sessions per week, weekly volume (sets \u00d7 reps \u00d7 weight) for 5\u20136 main lifts, " +
      "top set per lift, stalled-lift flag (no progress in " + STALL_WEEKS + " weeks), tempo notes. " +
      "See lifts/README.md in the repo."));
    body.appendChild(card);
  }

  function fmtTopSet(w, r) {
    if (w === null) return "\u2014";
    return fmtNum(w, 1) + " lb \u00d7 " + (r === null ? "\u2014" : fmtNum(r));
  }

  function renderPopulated(body, rows) {
    var latest = rows[rows.length - 1];
    var prev = rows.length > 1 ? rows[rows.length - 2] : null;

    // Compute statuses first (needed for the summary card).
    var table = latest.lifts.map(function (l) {
      var hist = history(rows, liftKey(l.name));
      return { lift: l, status: liftStatus(hist) };
    });
    var stalled = table.filter(function (t) { return t.status.code === "stalled"; });

    var grid = el("div", "metric-grid");
    grid.setAttribute("role", "list");
    var sessBand = latest.sessions === null ? null : (latest.sessions >= TARGET_SESSIONS ? "good" : "caution");
    grid.appendChild(statCard("Sessions", fmtNum(latest.sessions), "/ wk",
      "Week ending " + fmtDate(latest.weekEnding) + " \u00b7 plan " + TARGET_SESSIONS + "/wk", sessBand));

    var volSub = "Sets \u00d7 reps \u00d7 weight";
    if (latest.totalVolumeLb !== null && prev && prev.totalVolumeLb !== null) {
      var d = latest.totalVolumeLb - prev.totalVolumeLb;
      volSub = (d > 0 ? "+" : d < 0 ? "\u2212" : "") + fmtNum(Math.abs(d)) + " lb vs prior week";
    }
    grid.appendChild(statCard("Total volume", fmtNum(latest.totalVolumeLb), "lb", volSub, null));

    var tracked = table.filter(function (t) { return t.status.code !== "baseline"; }).length;
    grid.appendChild(statCard("Stalled lifts", String(stalled.length), "",
      stalled.length ? stalled.map(function (t) { return t.lift.name; }).join(", ")
        : (tracked ? "None flagged" : "Needs " + (STALL_WEEKS + 1) + " weeks of data"),
      stalled.length ? "caution" : null));
    body.appendChild(grid);

    if (table.length) {
      var wrapCard = el("div", "card card-pad");
      wrapCard.style.marginTop = "1rem";
      wrapCard.appendChild(el("h3", null, "Top set per lift \u00b7 week ending " + fmtDate(latest.weekEnding)));
      var tw = el("div", "table-wrap");
      var t = el("table", "compare-table");
      var thead = el("thead");
      var hr = el("tr");
      ["Lift", "Sets", "Volume (lb)", "Top set", "Status"].forEach(function (h) {
        var th = el("th", null, h);
        th.setAttribute("scope", "col");
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      t.appendChild(thead);
      var tb = el("tbody");
      table.forEach(function (entry) {
        var l = entry.lift;
        var tr = el("tr");
        var nameCell = el("th", null, l.name.trim());
        nameCell.setAttribute("scope", "row");
        tr.appendChild(nameCell);
        tr.appendChild(el("td", null, fmtNum(l.sets)));
        tr.appendChild(el("td", null, fmtNum(l.volumeLb)));
        tr.appendChild(el("td", null, fmtTopSet(num(l.topSetLb), num(l.topSetReps))));
        var st = el("td", null, entry.status.text);
        if (entry.status.code === "stalled") st.className = "delta-cell caution";
        else if (entry.status.code === "best") st.className = "delta-cell good";
        tr.appendChild(st);
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      tw.appendChild(t);
      wrapCard.appendChild(tw);
      wrapCard.appendChild(el("p", "chart-band-note",
        "Progress = heavier top set, or same weight with more reps. Stalled = no new best in " + STALL_WEEKS +
        " weeks (needs " + (STALL_WEEKS + 1) + "+ logged weeks for that lift)."));
      body.appendChild(wrapCard);
    } else {
      var none = el("div", "note", "No per-lift rows for this week \u2014 totals only.");
      none.style.marginTop = "1rem";
      body.appendChild(none);
    }

    if (latest.notes) {
      var note = el("div", "note", "Notes: " + latest.notes);
      note.style.marginTop = "1rem";
      body.appendChild(note);
    }

    var chartRows = rows.filter(function (r) { return r.totalVolumeLb !== null; });
    if (chartRows.length) {
      var card = el("div", "card card-pad chart-card");
      card.style.marginTop = "1rem";
      var h3 = el("h3", null, "Weekly total volume (lb)");
      h3.id = "chart-lifts-label";
      card.appendChild(h3);
      card.appendChild(el("p", "chart-band-note", "Sets \u00d7 reps \u00d7 weight across all logged exercises."));
      var cw = el("div", "chart-wrap");
      var canvas = document.createElement("canvas");
      canvas.id = "chartLifts";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-labelledby", "chart-lifts-label");
      cw.appendChild(canvas);
      card.appendChild(cw);
      body.appendChild(card);
      drawChart(canvas, chartRows);
    }
  }

  function drawChart(canvas, rows) {
    if (typeof Chart === "undefined") return;
    if (chart) { chart.destroy(); chart = null; }
    var accent = cssVar("--accent-muted") || "#2dd4bf";
    var text = cssVar("--chart-text") || "#94a3b8";
    var grid = cssVar("--chart-grid") || "rgba(148,163,184,0.12)";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var labels = rows.map(function (r) { return r.weekEnding; });
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Total volume (lb)",
          data: rows.map(function (r) { return r.totalVolumeLb; }),
          backgroundColor: accent + "99",
          borderColor: accent,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 450 },
        plugins: { legend: { labels: { color: text } } },
        scales: {
          x: {
            ticks: { color: text, maxRotation: 0, callback: function (val, i) { return fmtDate(labels[i]); } },
            grid: { color: grid }
          },
          y: {
            beginAtZero: true,
            ticks: { color: text },
            grid: { color: grid },
            title: { display: true, text: "lb", color: text }
          }
        }
      }
    });
  }

  function cleanCell(v) {
    var s = v == null ? "" : String(v).trim();
    if (s.charAt(0) === "'") s = s.slice(1);
    return s.trim();
  }

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? "0" + n : n;
  }

  function normalizeDate(v) {
    var s = cleanCell(v);
    if (!s) return "";
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (us) return us[3] + "-" + pad2(us[1]) + "-" + pad2(us[2]);
    var named = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (named) {
      var months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      var key = named[1].slice(0, 3).toLowerCase();
      if (months[key]) return named[3] + "-" + pad2(months[key]) + "-" + pad2(named[2]);
    }
    return "";
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQ = false;
    var src = String(text || "").replace(/^\uFEFF/, "");
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function mapHeaders(headers) {
    var map = {};
    (headers || []).forEach(function (h, i) {
      var key = String(h || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (key === "date") map.date = i;
      else if (key === "workout day" || key === "day") map.day = i;
      else if (key === "exercise") map.exercise = i;
      else if (key === "side") map.side = i;
      else if (key === "set number" || key === "set") map.set = i;
      else if (key === "weight lb" || key === "weight") map.weight = i;
      else if (key === "reps") map.reps = i;
      else if (key === "seconds") map.seconds = i;
      else if (key === "session id" || key === "sessionid") map.session = i;
      else if (key === "logged at" || key === "loggedat") map.logged = i;
    });
    return map;
  }

  function cellAt(line, idx) {
    if (idx === undefined || idx === null || !line || idx < 0 || idx >= line.length) return "";
    return cleanCell(line[idx]);
  }

  function parseWorkoutCsv(text) {
    if (typeof text !== "string" || !text.trim()) return { ok: false, rows: [] };
    if (text.indexOf("<html") !== -1 || text.indexOf("<HTML") !== -1) return { ok: false, rows: [] };
    var table = parseCsv(text);
    var headerIndex = -1;
    var col = null;
    for (var i = 0; i < table.length; i++) {
      var mapped = mapHeaders(table[i]);
      if (mapped.date !== undefined && mapped.exercise !== undefined) {
        headerIndex = i;
        col = mapped;
        break;
      }
    }
    if (headerIndex < 0) return { ok: false, rows: [] };
    var rows = [];
    for (var r = headerIndex + 1; r < table.length; r++) {
      var line = table[r];
      if (!line || !line.some(function (c) { return String(c || "").trim() !== ""; })) continue;
      var date = normalizeDate(cellAt(line, col.date));
      var exercise = cellAt(line, col.exercise);
      if (!date || !exercise) continue;
      rows.push({
        date: date,
        day: cellAt(line, col.day),
        exercise: exercise,
        side: cellAt(line, col.side),
        setNumber: cellAt(line, col.set),
        weightLb: num(cellAt(line, col.weight)),
        reps: num(cellAt(line, col.reps)),
        seconds: num(cellAt(line, col.seconds)),
        sessionId: cellAt(line, col.session),
        loggedAt: cellAt(line, col.logged)
      });
    }
    return { ok: true, rows: rows };
  }

  function weekStartISO(iso) {
    var d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return "";
    var day = d.getUTCDay();
    var delta = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - delta);
    return d.toISOString().slice(0, 10);
  }

  function summarizeWorkouts(rows) {
    var weeks = {};
    var byEx = {};
    rows.forEach(function (row) {
      var wk = weekStartISO(row.date);
      if (!wk) return;
      if (!weeks[wk]) weeks[wk] = { week: wk, sessions: {}, sets: 0, volume: 0 };
      var sid = row.sessionId || (row.date + "|" + row.day);
      weeks[wk].sessions[sid] = true;
      weeks[wk].sets += 1;
      if (row.weightLb !== null && row.reps !== null) weeks[wk].volume += row.weightLb * row.reps;
      if (!byEx[row.exercise]) byEx[row.exercise] = [];
      byEx[row.exercise].push(row);
    });
    var weekList = Object.keys(weeks).sort().map(function (k) {
      var w = weeks[k];
      return { week: w.week, sessions: Object.keys(w.sessions).length, sets: w.sets, volume: w.volume };
    });
    var latest = Object.keys(byEx).sort().map(function (name) {
      var list = byEx[name].slice().sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return String(a.loggedAt).localeCompare(String(b.loggedAt));
      });
      var withW = list.filter(function (r) { return r.weightLb !== null; });
      var last = withW.length ? withW[withW.length - 1] : null;
      var top = null;
      withW.forEach(function (r) { if (top === null || r.weightLb > top) top = r.weightLb; });
      return { name: name, last: last, top: top };
    });
    var trend = {};
    rows.forEach(function (row) {
      if (row.weightLb === null) return;
      var wk = weekStartISO(row.date);
      if (!trend[row.exercise]) trend[row.exercise] = {};
      var cur = trend[row.exercise][wk];
      if (cur === undefined || row.weightLb > cur) trend[row.exercise][wk] = row.weightLb;
    });
    return { weeks: weekList, latest: latest, trend: trend };
  }

  function csvUrlFrom(data) {
    var p = data && data.program;
    if (!p || typeof p.workoutsCsvUrl !== "string") return "";
    return p.workoutsCsvUrl.trim();
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) {
        clearTimeout(timer);
        resolve(v);
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function loadWorkouts(data) {
    var url = csvUrlFrom(data);
    if (!url) {
      workoutState = { status: "empty", rows: [] };
      return Promise.resolve();
    }
    var bust = url + (url.indexOf("?") === -1 ? "?" : "&") + "hlts=" + Date.now();
    return withTimeout(fetch(bust, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    }), 8000).then(function (text) {
      var parsed = parseWorkoutCsv(text);
      workoutState = parsed.ok ? { status: "ok", rows: parsed.rows } : { status: "error", rows: [] };
    }).catch(function () {
      workoutState = { status: "error", rows: [] };
    });
  }

  function connectCard() {
    var card = el("div", "card card-pad");
    card.id = "workoutsPanel";
    card.style.marginTop = "1rem";
    card.appendChild(el("h3", null, "Workouts"));
    card.appendChild(el("p", null, "Connect your workout sheet"));
    var note = el("p", "chart-band-note");
    note.appendChild(document.createTextNode("Log sets in the "));
    var link = document.createElement("a");
    link.href = "workouts/";
    link.textContent = "workout tracker";
    note.appendChild(link);
    note.appendChild(document.createTextNode(". Publish the Sets tab as CSV and paste that link into program.workoutsCsvUrl in docs/data.json."));
    card.appendChild(note);
    return card;
  }

  function renderWorkouts(body) {
    if (workoutState.status !== "ok") {
      body.appendChild(connectCard());
      return;
    }
    var rows = workoutState.rows || [];
    var card = el("div", "card card-pad");
    card.id = "workoutsPanel";
    card.style.marginTop = "1rem";
    card.appendChild(el("h3", null, "Workouts"));
    if (!rows.length) {
      card.appendChild(el("p", null, "Sheet connected. No sets logged yet."));
      var emptyNote = el("p", "chart-band-note");
      emptyNote.appendChild(document.createTextNode("Log a session in the "));
      var emptyLink = document.createElement("a");
      emptyLink.href = "workouts/";
      emptyLink.textContent = "workout tracker";
      emptyNote.appendChild(emptyLink);
      emptyNote.appendChild(document.createTextNode("."));
      card.appendChild(emptyNote);
      body.appendChild(card);
      return;
    }
    var summary = summarizeWorkouts(rows);
    var latestWeek = summary.weeks.length ? summary.weeks[summary.weeks.length - 1] : null;
    if (latestWeek) {
      var grid = el("div", "metric-grid");
      grid.setAttribute("role", "list");
      grid.appendChild(statCard("Sessions", String(latestWeek.sessions), "/ wk",
        "Week of " + fmtDate(latestWeek.week), null));
      grid.appendChild(statCard("Volume", fmtNum(latestWeek.volume), "lb",
        latestWeek.sets + (latestWeek.sets === 1 ? " set that week" : " sets that week"), null));
      card.appendChild(grid);
    }

    var recent = summary.weeks.slice(-8);
    if (recent.length) {
      var weekTitle = el("h3", null, "Sessions per week");
      weekTitle.style.marginTop = "1rem";
      card.appendChild(weekTitle);
      var weekWrap = el("div", "table-wrap");
      var weekTable = el("table", "compare-table");
      var weekHead = el("thead");
      var weekHr = el("tr");
      ["Week of", "Sessions", "Sets", "Volume (lb)"].forEach(function (h) {
        var th = el("th", null, h);
        th.setAttribute("scope", "col");
        weekHr.appendChild(th);
      });
      weekHead.appendChild(weekHr);
      weekTable.appendChild(weekHead);
      var weekBody = el("tbody");
      recent.forEach(function (w) {
        var tr = el("tr");
        var th = el("th", null, fmtDate(w.week));
        th.setAttribute("scope", "row");
        tr.appendChild(th);
        tr.appendChild(el("td", null, String(w.sessions)));
        tr.appendChild(el("td", null, String(w.sets)));
        tr.appendChild(el("td", null, fmtNum(w.volume)));
        weekBody.appendChild(tr);
      });
      weekTable.appendChild(weekBody);
      weekWrap.appendChild(weekTable);
      card.appendChild(weekWrap);
    }

    if (summary.latest.length) {
      var latestTitle = el("h3", null, "Latest weight");
      latestTitle.style.marginTop = "1rem";
      card.appendChild(latestTitle);
      var liftWrap = el("div", "table-wrap");
      var liftTable = el("table", "compare-table");
      var liftHead = el("thead");
      var liftHr = el("tr");
      ["Exercise", "Latest", "When", "Top"].forEach(function (h) {
        var th = el("th", null, h);
        th.setAttribute("scope", "col");
        liftHr.appendChild(th);
      });
      liftHead.appendChild(liftHr);
      liftTable.appendChild(liftHead);
      var liftBody = el("tbody");
      summary.latest.forEach(function (item) {
        var tr = el("tr");
        var th = el("th", null, item.name);
        th.setAttribute("scope", "row");
        tr.appendChild(th);
        tr.appendChild(el("td", null, item.last ? fmtNum(item.last.weightLb, 1) + " lb" : "\u2014"));
        tr.appendChild(el("td", null, item.last ? fmtDate(item.last.date) : "\u2014"));
        tr.appendChild(el("td", null, item.top === null ? "\u2014" : fmtNum(item.top, 1) + " lb"));
        liftBody.appendChild(tr);
      });
      liftTable.appendChild(liftBody);
      liftWrap.appendChild(liftTable);
      card.appendChild(liftWrap);
    }

    var names = Object.keys(summary.trend);
    if (names.length && summary.weeks.length) {
      var h3 = el("h3", null, "Top weight by week");
      h3.id = "chart-workouts-label";
      h3.style.marginTop = "1rem";
      card.appendChild(h3);
      card.appendChild(el("p", "chart-band-note", "Heaviest logged weight each week. Holds without a weight are not on this line."));
      var cw = el("div", "chart-wrap chart-wrap-tall");
      var canvas = document.createElement("canvas");
      canvas.id = "chartWorkoutWeights";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-labelledby", "chart-workouts-label");
      cw.appendChild(canvas);
      card.appendChild(cw);
      body.appendChild(card);
      try { drawWorkoutChart(canvas, summary); }
      catch (err) {
        if (workoutChart) { workoutChart.destroy(); workoutChart = null; }
      }
      return;
    }
    body.appendChild(card);
  }

  function drawWorkoutChart(canvas, summary) {
    if (typeof Chart === "undefined") return;
    if (workoutChart) { workoutChart.destroy(); workoutChart = null; }
    var labels = summary.weeks.map(function (w) { return w.week; });
    var palette = ["#2dd4bf", "#fbbf24", "#38bdf8", "#fb7185", "#a78bfa", "#4ade80", "#fb923c", "#e879f9"];
    var text = cssVar("--chart-text") || "#94a3b8";
    var grid = cssVar("--chart-grid") || "rgba(148,163,184,0.12)";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var names = Object.keys(summary.trend);
    var datasets = names.map(function (name, i) {
      var color = palette[i % palette.length];
      return {
        label: name,
        data: labels.map(function (wk) {
          var v = summary.trend[name][wk];
          return v === undefined ? null : v;
        }),
        borderColor: color,
        backgroundColor: color,
        spanGaps: true,
        tension: 0.25,
        pointRadius: 3,
        borderWidth: 2
      };
    });
    workoutChart = new Chart(canvas, {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 450 },
        plugins: { legend: { labels: { color: text, boxWidth: 12 } } },
        scales: {
          x: {
            ticks: { color: text, maxRotation: 0, callback: function (val, i) { return fmtDate(labels[i]); } },
            grid: { color: grid }
          },
          y: {
            ticks: { color: text },
            grid: { color: grid },
            title: { display: true, text: "lb", color: text }
          }
        }
      }
    });
  }

  function workoutNeedsChart() {
    return workoutState.status === "ok" && (workoutState.rows || []).some(function (r) { return r.weightLb !== null; });
  }

  function render() {
    var section = mountSection();
    if (!section) return;
    var body = document.getElementById("liftsBody");
    if (!body) return;
    if (chart) { chart.destroy(); chart = null; }
    if (workoutChart) { workoutChart.destroy(); workoutChart = null; }
    while (body.firstChild) body.removeChild(body.firstChild);
    try {
      if (!liftRows.length) renderEmpty(body);
      else renderPopulated(body, liftRows);
    } catch (e) {
      if (chart) { chart.destroy(); chart = null; }
      while (body.firstChild) body.removeChild(body.firstChild);
      renderEmpty(body);
    }
    try {
      renderWorkouts(body);
    } catch (e2) {
      body.appendChild(connectCard());
    }
  }

  function whenChartReady(cb) {
    if (typeof Chart !== "undefined") return cb();
    var done = false;
    var t = setInterval(function () {
      if (typeof Chart !== "undefined" && !done) { done = true; clearInterval(t); cb(); }
    }, 50);
    setTimeout(function () {
      clearInterval(t);
      if (!done) { done = true; cb(); } // render without a chart rather than leave the body blank
    }, 5000);
  }

  /* Wait briefly for the Fuel section so Lifts lands right after it; fall back to the timeline anchor. */
  function whenFuelMounted(cb) {
    if (document.getElementById("fuelSection")) return cb();
    var waited = 0;
    var t = setInterval(function () {
      waited += 50;
      if (document.getElementById("fuelSection") || waited >= 3000) {
        clearInterval(t);
        cb();
      }
    }, 50);
  }

  function init() {
    fetch("data.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        liftRows = normalizeRows(data && data.lifts);
        return loadWorkouts(data);
      })
      .catch(function () {
        liftRows = [];
        workoutState = { status: "error", rows: [] };
      })
      .then(function () {
        whenFuelMounted(function () {
          var needsChart = liftRows.length || workoutNeedsChart();
          if (!needsChart) { render(); return; }
          mountSection();
          whenChartReady(render);
          if (window.MutationObserver) {
            new MutationObserver(function () {
              if (liftRows.length || workoutNeedsChart()) whenChartReady(render);
              else render();
            }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
          }
        });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
