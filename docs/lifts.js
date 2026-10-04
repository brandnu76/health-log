/* Lifts (Hevy) section — optional, self-contained.
 * Reads data.lifts from data.json. Empty or missing => friendly empty state.
 * Never invents numbers; every field is guarded. Does not touch app.js or fuel.js. */
(function () {
  "use strict";

  var TARGET_SESSIONS = 3;
  var STALL_WEEKS = 3;
  var EMPTY_MSG = "No Hevy data yet \u2014 send a weekly export on Saturday";
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var chart = null;
  var liftRows = [];

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
    var h2 = el("h2", null, "Lifts");
    h2.id = "lifts-heading";
    head.appendChild(h2);
    head.appendChild(el("span", "meta", "Hevy weekly summary \u00b7 no invented numbers"));
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

  function render() {
    var section = mountSection();
    if (!section) return;
    var body = document.getElementById("liftsBody");
    if (!body) return;
    if (chart) { chart.destroy(); chart = null; }
    while (body.firstChild) body.removeChild(body.firstChild);
    try {
      if (!liftRows.length) renderEmpty(body);
      else renderPopulated(body, liftRows);
    } catch (e) {
      if (chart) { chart.destroy(); chart = null; }
      while (body.firstChild) body.removeChild(body.firstChild);
      renderEmpty(body);
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
      })
      .catch(function () {
        liftRows = [];
      })
      .then(function () {
        whenFuelMounted(function () {
          if (!liftRows.length) { render(); return; }
          mountSection();
          whenChartReady(render);
          if (window.MutationObserver) {
            new MutationObserver(function () {
              if (liftRows.length) whenChartReady(render);
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
