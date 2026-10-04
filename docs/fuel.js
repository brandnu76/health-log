/* Fuel (Cronometer) section — optional, self-contained.
 * Reads data.fuel from data.json. Empty or missing => friendly empty state.
 * Never invents numbers; every field is guarded. */
(function () {
  "use strict";

  var PROTEIN_MIN = 140;
  var PROTEIN_MAX = 180;
  var LOW_CONF_DAYS = 5;
  var EMPTY_MSG = "No Cronometer data yet \u2014 send a weekly export on Saturday";
  var MICRO_LABELS = {
    iron: ["Iron", "mg"],
    zinc: ["Zinc", "mg"],
    b12: ["B12", "\u00b5g"],
    choline: ["Choline", "mg"],
    omega3: ["Omega-3", "g"],
    vitaminD: ["Vitamin D", "IU"],
    magnesium: ["Magnesium", "mg"]
  };
  var chart = null;
  var fuelRows = [];

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
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

  function normalizeRows(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(function (r) {
        return r && typeof r === "object" && typeof r.weekEnding === "string";
      })
      .sort(function (a, b) {
        return a.weekEnding < b.weekEnding ? -1 : a.weekEnding > b.weekEnding ? 1 : 0;
      });
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

  function proteinStatus(p) {
    if (p === null) return { text: "Target " + PROTEIN_MIN + "\u2013" + PROTEIN_MAX + " g/day", band: null };
    if (p < PROTEIN_MIN) return { text: "Below " + PROTEIN_MIN + "\u2013" + PROTEIN_MAX + " g target band", band: "caution" };
    if (p > PROTEIN_MAX) return { text: "Above " + PROTEIN_MIN + "\u2013" + PROTEIN_MAX + " g target band", band: "caution" };
    return { text: "In " + PROTEIN_MIN + "\u2013" + PROTEIN_MAX + " g target band", band: "good" };
  }

  function buildSection() {
    var section = el("section", "section");
    section.id = "fuelSection";
    section.setAttribute("aria-labelledby", "fuel-heading");
    var head = el("div", "section-head");
    var h2 = el("h2", null, "Fuel");
    h2.id = "fuel-heading";
    head.appendChild(h2);
    head.appendChild(el("span", "meta", "Cronometer weekly averages \u00b7 no invented numbers"));
    section.appendChild(head);
    var body = el("div", null);
    body.id = "fuelBody";
    section.appendChild(body);
    return section;
  }

  function mountSection() {
    var existing = document.getElementById("fuelSection");
    if (existing) return existing;
    var section = buildSection();
    var timelineHead = document.getElementById("timeline-heading");
    var anchor = timelineHead ? timelineHead.closest("section") : null;
    var main = document.getElementById("main");
    if (anchor && anchor.parentNode) {
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
    var tips = el("p", "chart-band-note",
      "Tracked: avg kcal, avg protein (" + PROTEIN_MIN + "\u2013" + PROTEIN_MAX +
      " g/day), days in range, lift vs rest day intake, key micros, days logged. See fuel/README.md in the repo.");
    card.appendChild(tips);
    body.appendChild(card);
  }

  function renderPopulated(body, rows) {
    var latest = rows[rows.length - 1];
    var days = num(latest.daysLogged);
    var kcal = num(latest.kcalAvg);
    var protein = num(latest.proteinAvg);
    var inRange = num(latest.proteinDaysInRange);
    var ps = proteinStatus(protein);

    var grid = el("div", "metric-grid");
    grid.setAttribute("role", "list");
    grid.appendChild(statCard("Avg kcal / day", fmtNum(kcal), "kcal", "Week ending " + fmtDate(latest.weekEnding), null));
    grid.appendChild(statCard("Avg protein / day", fmtNum(protein, 1), "g", ps.text, ps.band));
    grid.appendChild(statCard(
      "Days in protein range",
      inRange === null ? "\u2014" : fmtNum(inRange),
      days === null ? "" : "/ " + fmtNum(days),
      PROTEIN_MIN + "\u2013" + PROTEIN_MAX + " g days",
      null
    ));
    var lowConf = days === null || days < LOW_CONF_DAYS;
    grid.appendChild(statCard(
      "Days logged",
      days === null ? "\u2014" : fmtNum(days),
      "/ 7",
      lowConf ? "Low confidence" : "Good coverage",
      lowConf ? "caution" : "good"
    ));
    var lift = num(latest.liftKcalAvg);
    var rest = num(latest.restKcalAvg);
    if (lift !== null || rest !== null) {
      grid.appendChild(statCard(
        "Lift vs rest kcal",
        fmtNum(lift) + " / " + fmtNum(rest),
        "kcal",
        "Lifting day / rest day avg",
        null
      ));
    }
    body.appendChild(grid);

    if (lowConf) {
      body.appendChild(el("div", "note",
        days === null
          ? "Days logged not recorded for this week \u2014 treat averages as low confidence."
          : "Only " + fmtNum(days) + " day(s) logged \u2014 under " + LOW_CONF_DAYS +
            " days/week, so these averages are low confidence."));
    }

    var micros = latest.micros && typeof latest.micros === "object" ? latest.micros : null;
    if (micros) {
      var keys = Object.keys(micros).filter(function (k) { return num(micros[k]) !== null; });
      if (keys.length) {
        var wrap = el("div", "card card-pad");
        wrap.style.marginTop = "1rem";
        wrap.appendChild(el("h3", null, "Key micronutrients (daily avg)"));
        var list = el("ul", "goal-list");
        keys.forEach(function (k) {
          var meta = MICRO_LABELS[k] || [k, ""];
          list.appendChild(el("li", null, meta[0] + ": " + fmtNum(micros[k], 1) + (meta[1] ? " " + meta[1] : "")));
        });
        wrap.appendChild(list);
        body.appendChild(wrap);
      }
    }

    var chartRows = rows.filter(function (r) { return num(r.kcalAvg) !== null || num(r.proteinAvg) !== null; });
    if (chartRows.length) {
      var card = el("div", "card card-pad chart-card");
      card.style.marginTop = "1rem";
      var h3 = el("h3", null, "Weekly avg protein (g) and kcal");
      h3.id = "chart-fuel-label";
      card.appendChild(h3);
      card.appendChild(el("p", "chart-band-note", "Bars: protein g/day (shaded " + PROTEIN_MIN + "\u2013" + PROTEIN_MAX + " g band) \u00b7 line: kcal/day"));
      var cw = el("div", "chart-wrap");
      var canvas = document.createElement("canvas");
      canvas.id = "chartFuel";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-labelledby", "chart-fuel-label");
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
    var caution = cssVar("--caution") || "#fbbf24";
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var labels = rows.map(function (r) { return r.weekEnding; });

    var bandPlugin = {
      id: "fuelProteinBand",
      beforeDatasetsDraw: function (c) {
        var y = c.scales && c.scales.y;
        if (!y) return;
        var top = y.getPixelForValue(PROTEIN_MAX);
        var bottom = y.getPixelForValue(PROTEIN_MIN);
        var area = c.chartArea;
        var ctx = c.ctx;
        ctx.save();
        ctx.fillStyle = accent + "1f";
        ctx.fillRect(area.left, Math.max(area.top, Math.min(top, bottom)),
          area.right - area.left,
          Math.max(0, Math.min(area.bottom, Math.max(top, bottom)) - Math.max(area.top, Math.min(top, bottom))));
        ctx.restore();
      }
    };

    chart = new Chart(canvas, {
      data: {
        labels: labels,
        datasets: [
          {
            type: "bar",
            label: "Protein (g/day)",
            data: rows.map(function (r) { return num(r.proteinAvg); }),
            backgroundColor: accent + "99",
            borderColor: accent,
            borderWidth: 1,
            yAxisID: "y"
          },
          {
            type: "line",
            label: "Calories (kcal/day)",
            data: rows.map(function (r) { return num(r.kcalAvg); }),
            borderColor: caution,
            backgroundColor: caution,
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 4,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: text } } },
        scales: {
          x: {
            ticks: {
              color: text,
              maxRotation: 0,
              callback: function (val, i) { return fmtDate(labels[i]); }
            },
            grid: { color: grid }
          },
          y: {
            position: "left",
            beginAtZero: true,
            suggestedMax: PROTEIN_MAX + 20,
            ticks: { color: text },
            grid: { color: grid },
            title: { display: true, text: "g protein", color: text }
          },
          y1: {
            position: "right",
            beginAtZero: false,
            ticks: { color: text },
            grid: { drawOnChartArea: false },
            title: { display: true, text: "kcal", color: text }
          }
        }
      },
      plugins: [bandPlugin]
    });
  }

  function render() {
    var section = mountSection();
    if (!section) return;
    var body = document.getElementById("fuelBody");
    if (!body) return;
    if (chart) { chart.destroy(); chart = null; }
    while (body.firstChild) body.removeChild(body.firstChild);
    try {
      if (!fuelRows.length) renderEmpty(body);
      else renderPopulated(body, fuelRows);
    } catch (e) {
      while (body.firstChild) body.removeChild(body.firstChild);
      renderEmpty(body);
    }
  }

  function whenChartReady(cb) {
    if (typeof Chart !== "undefined") return cb();
    var t = setInterval(function () {
      if (typeof Chart !== "undefined") { clearInterval(t); cb(); }
    }, 50);
    setTimeout(function () { clearInterval(t); }, 5000);
  }

  function init() {
    fetch("data.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        fuelRows = normalizeRows(data && data.fuel);
        if (!fuelRows.length) { render(); return; }
        mountSection();
        whenChartReady(render);
        if (window.MutationObserver) {
          new MutationObserver(function () {
            if (fuelRows.length) whenChartReady(render);
          }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        }
      })
      .catch(function () {
        fuelRows = [];
        render();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
