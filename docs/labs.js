/* Metabolic labs — optional, self-contained.
 * Reads data.labs from data.json. Missing or empty => empty state, never an error.
 * Values are shown as stored. Strings such as NEGATIVE or <0.10 stay strings.
 * In-range status uses only the reference low/high stored with that numeric result.
 * ADA sentences for HbA1c and glucose are labeled general reference, not a diagnosis.
 * Draw dots are painted on the weight chart only inside that chart's date labels.
 * They never add dates to the axis, so older draws do not stretch the chart.
 * Does not edit scans, fuel, lifts, or the scale split. Does not invent values.
 */
(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__labsModel = api;
  if (typeof document === "undefined") return;

  var DATE_RE = api.DATE_RE;
  var draws = [];
  var PLUGIN_ID = "healthLogLabDraws";

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function labelSpan(labels) {
    var minL = null;
    var maxL = null;
    var i;
    if (!labels) return null;
    for (i = 0; i < labels.length; i++) {
      if (!DATE_RE.test(labels[i])) continue;
      if (minL === null || labels[i] < minL) minL = labels[i];
      if (maxL === null || labels[i] > maxL) maxL = labels[i];
    }
    if (minL === null) return null;
    return { min: minL, max: maxL };
  }

  function markerPixel(scale, labels, iso, area) {
    if (!scale || !area || !labels || !labels.length || !iso) return null;
    var span = labelSpan(labels);
    if (!span || iso < span.min || iso > span.max) return null;
    var i;
    for (i = 0; i < labels.length; i++) {
      if (labels[i] === iso) return scale.getPixelForValue(i);
    }
    var prev = -1;
    var next = -1;
    for (i = 0; i < labels.length; i++) {
      if (!DATE_RE.test(labels[i])) continue;
      if (labels[i] < iso) prev = i;
      else if (labels[i] > iso) {
        next = i;
        break;
      }
    }
    if (prev < 0 || next < 0) return null;
    var gap = api.daysBetween(labels[prev], labels[next]);
    var t = gap > 0 ? api.daysBetween(labels[prev], iso) / gap : 0;
    var p0 = scale.getPixelForValue(prev);
    var p1 = scale.getPixelForValue(next);
    return p0 + (p1 - p0) * t;
  }

  var labDrawPlugin = {
    id: PLUGIN_ID,
    afterDraw: function (chart) {
      if (!draws.length) return;
      if (!chart || !chart.canvas || chart.canvas.id !== "chartWeight") return;
      var labels = chart.data && chart.data.labels;
      var xScale = chart.scales && chart.scales.x;
      var area = chart.chartArea;
      var ctx = chart.ctx;
      if (!xScale || !area || !ctx || !labels || !labels.length) return;
      var accent = cssVar("--accent") || "#5eead4";
      var bg = cssVar("--bg") || "#0f1419";
      ctx.save();
      try {
        draws.forEach(function (d) {
          if (!d || !DATE_RE.test(d.date)) return;
          var px = markerPixel(xScale, labels, d.date, area);
          if (px == null || px < area.left || px > area.right) return;
          ctx.beginPath();
          ctx.fillStyle = accent;
          ctx.strokeStyle = bg;
          ctx.lineWidth = 1.5;
          ctx.arc(px, area.bottom - 8, 3.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      } finally {
        ctx.restore();
      }
    }
  };

  function registerPlugin() {
    if (typeof Chart === "undefined" || !Chart.register) return;
    try {
      var existing = Chart.registry && Chart.registry.plugins && Chart.registry.plugins.get(PLUGIN_ID);
      if (existing) return;
    } catch (e) { /* registry lookup is optional */ }
    try { Chart.register(labDrawPlugin); } catch (e) { /* already registered */ }
  }

  function buildSection() {
    var section = el("section", "section");
    section.id = "labsSection";
    section.setAttribute("aria-labelledby", "labs-heading");
    var head = el("div", "section-head");
    var h2 = el("h2", null, "Metabolic labs");
    h2.id = "labs-heading";
    head.appendChild(h2);
    head.appendChild(el("span", "meta", "Latest key markers \u00b7 full history below \u00b7 range as printed"));
    section.appendChild(head);
    section.appendChild(el("p", "lab-provider", "Discuss results with your VA provider."));
    var body = el("div", null);
    body.id = "labsBody";
    section.appendChild(body);
    return section;
  }

  function mountSection() {
    var existing = document.getElementById("labsSection");
    if (existing) return existing;
    var section = buildSection();
    var chartsHead = document.getElementById("charts-heading");
    var anchor = chartsHead ? chartsHead.closest("section") : null;
    var main = document.getElementById("main");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(section, anchor);
    else if (main) main.appendChild(section);
    else return null;
    return section;
  }

  function renderEmpty(body) {
    var card = el("div", "card card-pad lab-empty");
    card.appendChild(el("p", null, "Labs from the Nov 9 draw can be added after results come back."));
    body.appendChild(card);
  }

  function sparkline(marker) {
    var points = [];
    var i;
    for (i = 0; i < marker.points.length; i++) {
      var p = marker.points[i];
      if (p.value !== null && isFinite(p.value)) points.push(p);
    }
    var wrap = el("div", "lab-spark-wrap");
    wrap.appendChild(el("p", "sr-only", api.sparkSummary(marker)));
    if (points.length < 2) return wrap;

    var w = 168;
    var h = 36;
    var pad = 5;
    var vals = points.map(function (p) { return p.value; });
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    var t0 = Date.parse(points[0].date + "T12:00:00");
    var t1 = Date.parse(points[points.length - 1].date + "T12:00:00");
    var coords = points.map(function (p, idx) {
      var x;
      if (!(t1 > t0)) x = pad + (idx / (points.length - 1)) * (w - pad * 2);
      else {
        var t = Date.parse(p.date + "T12:00:00");
        x = pad + ((t - t0) / (t1 - t0)) * (w - pad * 2);
      }
      var y = pad + (1 - (p.value - lo) / (hi - lo)) * (h - pad * 2);
      return [x, y];
    });
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "lab-spark lab-spark-wide");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", coords.map(function (c) {
      return c[0].toFixed(1) + "," + c[1].toFixed(1);
    }).join(" "));
    svg.appendChild(poly);
    var last = coords[coords.length - 1];
    var dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", last[0].toFixed(1));
    dot.setAttribute("cy", last[1].toFixed(1));
    dot.setAttribute("r", "2.6");
    svg.appendChild(dot);
    wrap.appendChild(svg);
    wrap.appendChild(el(
      "p",
      "lab-spark-caption",
      api.fmtDate(points[0].date, true) + " \u2013 " + api.fmtDate(points[points.length - 1].date, true)
    ));
    return wrap;
  }

  function markerCard(marker) {
    var status = marker.status;
    var band = status && status.code === "in" ? "good" : status && (status.code === "above" || status.code === "below") ? "caution" : "";
    var card = el("div", "card card-pad lab-card" + (band ? " band-" + band : ""));
    card.setAttribute("role", "listitem");

    var top = el("div", "lab-card-top");
    var title = el("h3", null, marker.name);
    var slug = marker.key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "marker";
    title.id = "lab-marker-" + slug;
    if (marker.latest.origName && marker.latest.origName !== marker.name) {
      title.title = marker.latest.origName;
    }
    top.appendChild(title);
    if (status && status.label && status.code !== "unusable") {
      var pill = el("p", "lab-status " + (status.code === "in" ? "is-in" : "is-out"));
      pill.appendChild(document.createTextNode(status.label));
      if (status.code === "above") pill.appendChild(el("span", "sr-only", ", above the printed high"));
      if (status.code === "below") pill.appendChild(el("span", "sr-only", ", below the printed low"));
      top.appendChild(pill);
    } else if (marker.flag) {
      var flagged = el("p", "lab-status is-out");
      flagged.appendChild(document.createTextNode(marker.flag));
      flagged.appendChild(el("span", "sr-only", ", flagged on the report"));
      top.appendChild(flagged);
    }
    card.appendChild(top);
    card.setAttribute("aria-labelledby", title.id);

    var value = el("div", "lab-value", api.displayValue(marker.latest));
    if (marker.latest.unit) value.appendChild(el("span", "unit", marker.latest.unit));
    card.appendChild(value);

    var meta = api.fmtDate(marker.latest.date, true);
    if (marker.latest.source) meta += " \u00b7 " + marker.latest.source;
    if (marker.points.length > 1) {
      meta += " \u00b7 " + marker.points.length + " results";
    }
    card.appendChild(el("p", "lab-meta", meta));
    card.appendChild(el("p", "lab-delta", marker.deltaText));
    if (marker.flag && status && status.code !== "unusable") {
      card.appendChild(el("p", "lab-flag", "Report flag: " + marker.flag));
    }
    if (marker.trend) card.appendChild(sparkline(marker));
    if (marker.rangeText) card.appendChild(el("p", "lab-range", marker.rangeText));
    if (marker.general) card.appendChild(el("p", "lab-general", marker.general));
    return card;
  }

  function markerHistory(marker) {
    var details = el("details", "lab-marker-history");
    details.setAttribute("data-name", marker.key);
    details.setAttribute("data-orig", marker.origSearch || "");
    var summary = document.createElement("summary");
    summary.appendChild(el("span", "lab-hist-name", marker.name));
    var latestBits = api.displayValue(marker.latest);
    if (marker.latest.unit) latestBits += " " + marker.latest.unit;
    latestBits += " \u00b7 " + api.fmtDate(marker.latest.date, true);
    if (marker.flag) latestBits += " \u00b7 " + marker.flag;
    summary.appendChild(el("span", "lab-hist-latest", latestBits));
    details.appendChild(summary);

    var wrap = el("div", "table-wrap");
    var table = document.createElement("table");
    table.className = "lab-hist-table";
    var cap = document.createElement("caption");
    cap.className = "sr-only";
    cap.textContent = marker.name + " results, newest first";
    table.appendChild(cap);
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["Date", "Result", "Flag", "Reference"].forEach(function (label) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = document.createElement("tbody");
    var rows = marker.points.slice().reverse();
    rows.forEach(function (p) {
      var tr = document.createElement("tr");
      function td(text) {
        var cell = document.createElement("td");
        cell.textContent = text;
        return cell;
      }
      var result = api.displayValue(p);
      if (p.unit) result += " " + p.unit;
      tr.appendChild(td(api.fmtDate(p.date, true) || p.date));
      tr.appendChild(td(result));
      tr.appendChild(td(p.flag || ""));
      tr.appendChild(td(api.rangeText(p.refLow, p.refHigh, p.unit)));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    details.appendChild(wrap);
    return details;
  }

  function historyBlock(model) {
    var details = el("details", "lab-history");
    var summary = document.createElement("summary");
    var first = model.draws[0];
    var last = model.draws[model.draws.length - 1];
    summary.textContent = "Full history \u00b7 " + model.resultCount + " results \u00b7 " +
      model.draws.length + " draws \u00b7 " +
      api.fmtDate(first.date, true) + " \u2013 " + api.fmtDate(last.date, true);
    details.appendChild(summary);

    var tools = el("div", "lab-history-tools");
    var input = document.createElement("input");
    input.type = "search";
    input.className = "lab-filter";
    input.placeholder = "Filter markers";
    input.setAttribute("aria-label", "Filter lab markers by name");
    tools.appendChild(input);
    details.appendChild(tools);

    var list = el("div", "lab-history-list");
    var rows = [];
    function addHeading(text) {
      list.appendChild(el("p", "lab-history-label", text));
    }
    if (model.keyHistory.length) addHeading("Key markers");
    model.keyHistory.forEach(function (marker) {
      var item = markerHistory(marker);
      rows.push(item);
      list.appendChild(item);
    });
    if (model.otherHistory.length) addHeading("Other results");
    model.otherHistory.forEach(function (marker) {
      var item = markerHistory(marker);
      rows.push(item);
      list.appendChild(item);
    });
    var empty = el("p", "lab-filter-empty", "No markers match that filter.");
    empty.hidden = true;
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (row) {
        var hay = (row.getAttribute("data-name") || "") + " " + (row.getAttribute("data-orig") || "");
        var hide = !!q && hay.indexOf(q) === -1;
        row.hidden = hide;
        if (!hide) shown += 1;
      });
      var labels = list.querySelectorAll(".lab-history-label");
      labels.forEach(function (label) {
        var sib = label.nextElementSibling;
        var any = false;
        while (sib && !sib.classList.contains("lab-history-label")) {
          if (!sib.hidden) any = true;
          sib = sib.nextElementSibling;
        }
        label.hidden = !any;
      });
      empty.hidden = shown !== 0;
    });
    details.appendChild(list);
    details.appendChild(empty);
    return details;
  }

  function renderPopulated(body, model) {
    (model.keyGroups || []).forEach(function (group) {
      if (!group.markers.length) return;
      var block = el("div", "lab-group");
      block.appendChild(el("h3", "lab-group-title", group.label));
      var grid = el("div", "lab-grid");
      grid.setAttribute("role", "list");
      grid.setAttribute("aria-label", group.label);
      group.markers.forEach(function (marker) {
        grid.appendChild(markerCard(marker));
      });
      block.appendChild(grid);
      body.appendChild(block);
    });

    var noted = (model.draws || []).filter(function (d) { return d.note; });
    if (noted.length) {
      var notes = el("div", "lab-notes");
      notes.appendChild(el("h3", "lab-group-title", "Draw notes"));
      var ul = document.createElement("ul");
      noted.forEach(function (d) {
        var li = document.createElement("li");
        li.appendChild(el("span", "lab-note-date", api.fmtDate(d.date, true)));
        li.appendChild(document.createTextNode(" " + d.note));
        ul.appendChild(li);
      });
      notes.appendChild(ul);
      body.appendChild(notes);
    }

    if (model.draws.length && model.markers.length) body.appendChild(historyBlock(model));
  }

  function ensureWeightNote() {
    var canvas = document.getElementById("chartWeight");
    if (!canvas) return;
    var note = document.getElementById("labDrawNote");
    if (!draws.length) {
      if (note && note.parentNode) note.parentNode.removeChild(note);
      return;
    }
    if (!note) {
      note = el("p", "chart-band-note", "Dots on this chart mark a lab draw only when its date is inside the dates plotted here. Older draws stay in Metabolic labs and do not extend this chart.");
      note.id = "labDrawNote";
      var trend = document.getElementById("chartWeightTrend");
      var wrap = canvas.closest(".chart-wrap");
      if (trend && trend.parentNode) trend.parentNode.insertBefore(note, trend.nextSibling);
      else if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(note, wrap);
    }
    linkWeightDescription();
  }

  function linkWeightDescription() {
    var canvas = document.getElementById("chartWeight");
    var note = document.getElementById("labDrawNote");
    if (!canvas || !note) return;
    var ids = (canvas.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if (ids.indexOf("labDrawNote") === -1) {
      ids.push("labDrawNote");
      canvas.setAttribute("aria-describedby", ids.join(" "));
    }
  }

  function watchWeightDescription() {
    var canvas = document.getElementById("chartWeight");
    if (!canvas || canvas.dataset.labDesc === "1" || !window.MutationObserver) return;
    canvas.dataset.labDesc = "1";
    new MutationObserver(function () {
      linkWeightDescription();
    }).observe(canvas, { attributes: true, attributeFilter: ["aria-describedby"] });
  }

  function refreshWeightChartSoon() {
    ensureWeightNote();
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      ensureWeightNote();
      watchWeightDescription();
      var chart = typeof Chart !== "undefined" && Chart.getChart && Chart.getChart("chartWeight");
      if (chart) {
        if (draws.length) chart.update("none");
        clearInterval(timer);
      } else if (tries > 60) {
        clearInterval(timer);
      }
    }, 50);
  }

  function render(model) {
    var section = mountSection();
    if (!section) return;
    var body = document.getElementById("labsBody");
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    draws = (model && model.draws) || [];
    try {
      if (!model || !model.markers.length) renderEmpty(body);
      else renderPopulated(body, model);
    } catch (e) {
      while (body.firstChild) body.removeChild(body.firstChild);
      draws = [];
      renderEmpty(body);
    }
    refreshWeightChartSoon();
  }

  function init() {
    registerPlugin();
    fetch("data.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        render(api.buildModel(data && data.labs));
      })
      .catch(function () {
        render(api.buildModel(undefined));
      });
  }

  registerPlugin();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var EMPTY_DELTA = "No prior draw";
  var KEY_GROUPS = [
    { id: "a1c-glucose", label: "HbA1c and glucose", keys: ["hba1c", "glucose"] },
    { id: "lipids", label: "Lipids", keys: ["total cholesterol", "ldl-c (calc)", "hdl-c", "triglycerides"] },
    { id: "cbc", label: "Blood count", keys: ["hemoglobin", "mcv", "rdw"] },
    { id: "kidney", label: "Kidney", keys: ["creatinine", "egfr"] },
    { id: "liver", label: "Liver", keys: ["alt", "ast"] }
  ];

  function num(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
    return null;
  }

  function bound(v) {
    if (v === null || v === undefined || v === "") return null;
    return num(v);
  }

  function decimalPlaces(n) {
    if (n === null || n === undefined) return 0;
    var s = String(n);
    if (/e/i.test(s)) return 2;
    var i = s.indexOf(".");
    if (i < 0) return 0;
    return Math.min(4, s.length - i - 1);
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return "\u2014";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  function displayValue(point) {
    if (!point) return "\u2014";
    if (point.value !== null && point.value !== undefined && isFinite(point.value)) {
      return fmtNum(point.value, decimalPlaces(point.value));
    }
    if (typeof point.text === "string" && point.text) return point.text;
    return "\u2014";
  }

  function validDate(iso) {
    if (typeof iso !== "string" || !DATE_RE.test(iso)) return false;
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return false;
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = "0" + m;
    if (day.length < 2) day = "0" + day;
    return iso === d.getFullYear() + "-" + m + "-" + day;
  }

  function fmtDate(iso, withYear) {
    if (!validDate(iso)) return "";
    var d = new Date(iso + "T12:00:00");
    var opts = { month: "short", day: "numeric" };
    if (withYear) opts.year = "numeric";
    return d.toLocaleDateString("en-US", opts);
  }

  function daysBetween(isoA, isoB) {
    var a = new Date(isoA + "T12:00:00");
    var b = new Date(isoB + "T12:00:00");
    return Math.round((b - a) / 86400000);
  }

function markerKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

  function normalizeUnit(unit) {
    return String(unit || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function isA1c(key) {
    return key === "a1c" || key === "hba1c" || key === "hgba1c" ||
      key === "hemoglobin a1c" || key === "glycated hemoglobin" ||
      key === "glycohemoglobin" || key === "hba1c hemoglobin a1c";
  }

  function isFastingGlucose(key) {
    if (!key || /non fasting|postprandial|post meal|postmeal|random|\bpp\b|ppg/.test(key)) return false;
    if (key === "fbg" || key === "fpg") return true;
    return key.indexOf("fasting") !== -1 && (key.indexOf("glucose") !== -1 || key.indexOf("blood sugar") !== -1);
  }

  function isSerumGlucose(key) {
    if (!key || key.indexOf("urine") !== -1) return false;
    if (isFastingGlucose(key)) return true;
    return key === "glucose" || key === "serum glucose" || key === "plasma glucose" || key === "blood glucose";
  }

  function generalRef(name, unit) {
    var key = markerKey(name);
    var u = normalizeUnit(unit);
    var printed = typeof unit === "string" ? unit.trim() : "";
    if (isA1c(key)) {
      var a1c = "General reference, not a diagnosis. ADA describes A1c under 5.7% as the normal range and 5.7\u20136.4% as the prediabetes range.";
      if (u && u !== "%" && u !== "percent") {
        a1c += " This result is in " + printed + ", so that percent band is not applied to the number above.";
      }
      return a1c;
    }
    if (isSerumGlucose(key)) {
      var glu = "General reference, not a diagnosis. ADA describes fasting glucose of 100\u2013125 mg/dL as the prediabetes range.";
      if (u && u !== "mg/dl") {
        glu += " This result is in " + printed + ", so that mg/dL band is not applied to the number above.";
      }
      return glu;
    }
    return null;
  }

  function nearlyEqual(a, b) {
    var eps = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= eps;
  }

  function rangeStatus(value, low, high) {
    if (value === null || !isFinite(value)) return null;
    if (low === null && high === null) return null;
    if (low !== null && high !== null && low > high && !nearlyEqual(low, high)) {
      return { code: "unusable", label: "" };
    }
    if (low !== null && value < low && !nearlyEqual(value, low)) return { code: "below", label: "Outside range" };
    if (high !== null && value > high && !nearlyEqual(value, high)) return { code: "above", label: "Outside range" };
    return { code: "in", label: "In range" };
  }

  function rangeText(low, high, unit) {
    var digits = Math.max(decimalPlaces(low), decimalPlaces(high));
    var suffix = unit ? " " + unit : "";
    if (low !== null && high !== null && low > high && !nearlyEqual(low, high)) {
      return "Reference low (" + fmtNum(low, decimalPlaces(low)) + ") is above reference high (" + fmtNum(high, decimalPlaces(high)) + ")" + suffix + " on this result, so in-range is not shown.";
    }
    if (low !== null && high !== null) return "Lab range " + fmtNum(low, digits) + "\u2013" + fmtNum(high, digits) + suffix;
    if (high !== null) return "Lab range \u2264 " + fmtNum(high, decimalPlaces(high)) + suffix;
    if (low !== null) return "Lab range \u2265 " + fmtNum(low, decimalPlaces(low)) + suffix;
    return "No reference range on this result";
  }

  function sameUnit(a, b) {
    return normalizeUnit(a) === normalizeUnit(b);
  }

  function deltaText(latest, prior) {
    if (!prior) return EMPTY_DELTA;
    var latestNum = latest.value !== null && isFinite(latest.value);
    var priorNum = prior.value !== null && isFinite(prior.value);
    if (!latestNum || !priorNum) {
      var priorShown = displayValue(prior) + (prior.unit ? " " + prior.unit : "");
      return "Prior result on " + fmtDate(prior.date, true) + ": " + priorShown;
    }
    if (!sameUnit(latest.unit, prior.unit)) {
      return "Prior result on " + fmtDate(prior.date, true) + " used a different unit";
    }
    var digits = Math.max(decimalPlaces(latest.value), decimalPlaces(prior.value));
    var factor = Math.pow(10, digits);
    var rounded = Math.round((latest.value - prior.value) * factor) / factor;
    var when = fmtDate(prior.date, true);
    if (rounded === 0) return "No change vs " + when;
    var body = fmtNum(Math.abs(rounded), digits);
    var unit = latest.unit ? " " + latest.unit : "";
    return (rounded > 0 ? "+" : "\u2212") + body + unit + " vs " + when;
  }

  function cleanFlag(v) {
    if (typeof v !== "string") return "";
    return v.trim();
  }

  function cleanMarker(raw) {
    if (!raw || typeof raw !== "object") return null;
    var name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return null;
    var value = null;
    var text = null;
    if (typeof raw.value === "number" && isFinite(raw.value)) value = raw.value;
    else if (typeof raw.value === "string" && raw.value.trim()) text = raw.value;
    else return null;
    var unit = typeof raw.unit === "string" ? raw.unit.trim() : "";
    var origName = typeof raw.origName === "string" ? raw.origName.trim() : "";
    return {
      name: name,
      value: value,
      text: text,
      unit: unit,
      refLow: bound(raw.refLow),
      refHigh: bound(raw.refHigh),
      flag: cleanFlag(raw.flag),
      origName: origName
    };
  }

  function cleanEntries(raw) {
    if (!Array.isArray(raw)) return [];
    var entries = [];
    raw.forEach(function (row, index) {
      if (!row || typeof row !== "object" || !validDate(row.date)) return;
      var markers = [];
      if (Array.isArray(row.markers)) {
        row.markers.forEach(function (m) {
          var cleaned = cleanMarker(m);
          if (cleaned) markers.push(cleaned);
        });
      }
      if (!markers.length) return;
      var note = typeof row.note === "string" ? row.note.trim() : "";
      entries.push({
        date: row.date,
        source: typeof row.source === "string" ? row.source.trim() : "",
        note: note,
        markers: markers,
        index: index
      });
    });
    entries.sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return a.index - b.index;
    });
    return entries;
  }

  function seriesMarker(series) {
    var latest = series.points[series.points.length - 1];
    var prior = series.points.length > 1 ? series.points[series.points.length - 2] : null;
    var origSeen = Object.create(null);
    var origs = [];
    series.points.forEach(function (p) {
      if (!p.origName || origSeen[p.origName]) return;
      origSeen[p.origName] = true;
      origs.push(p.origName);
    });
    return {
      key: series.key,
      name: series.name,
      points: series.points,
      latest: latest,
      prior: prior,
      status: rangeStatus(latest.value, latest.refLow, latest.refHigh),
      flag: latest.flag || "",
      rangeText: rangeText(latest.refLow, latest.refHigh, latest.unit),
      deltaText: deltaText(latest, prior),
      general: generalRef(series.name, latest.unit),
      trend: isA1c(series.key) || isSerumGlucose(series.key),
      origSearch: origs.join(" ").toLowerCase()
    };
  }

  function buildModel(raw) {
    var entries = cleanEntries(raw);
    var map = Object.create(null);
    var seenOrder = [];
    entries.forEach(function (entry) {
      entry.markers.forEach(function (m) {
        var key = markerKey(m.name);
        if (!map[key]) {
          map[key] = { key: key, name: m.name, points: [] };
          seenOrder.push(key);
        }
        var pts = map[key].points;
        var last = pts[pts.length - 1];
        if (last && last.date === entry.date) return;
        pts.push({
          date: entry.date,
          source: entry.source,
          note: entry.note,
          value: m.value,
          text: m.text,
          unit: m.unit,
          refLow: m.refLow,
          refHigh: m.refHigh,
          flag: m.flag,
          name: m.name,
          origName: m.origName
        });
        map[key].name = m.name;
      });
    });

    var markers = seenOrder.map(function (key) { return seriesMarker(map[key]); });
    var byKey = Object.create(null);
    markers.forEach(function (marker) { byKey[marker.key] = marker; });

    var keyGroups = KEY_GROUPS.map(function (group) {
      return {
        id: group.id,
        label: group.label,
        markers: group.keys.map(function (key) { return byKey[key]; }).filter(Boolean)
      };
    }).filter(function (group) { return group.markers.length; });

    var keyOrder = [];
    KEY_GROUPS.forEach(function (group) {
      group.keys.forEach(function (key) { keyOrder.push(key); });
    });
    var keySet = Object.create(null);
    keyOrder.forEach(function (key) { keySet[key] = true; });
    var keyHistory = keyOrder.map(function (key) { return byKey[key]; }).filter(Boolean);
    var otherHistory = markers.filter(function (marker) { return !keySet[marker.key]; }).sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    var drawMap = Object.create(null);
    var drawOrder = [];
    entries.forEach(function (entry) {
      if (!drawMap[entry.date]) {
        drawMap[entry.date] = { date: entry.date, source: entry.source, note: entry.note || "" };
        drawOrder.push(entry.date);
      } else {
        if (entry.source && drawMap[entry.date].source.indexOf(entry.source) === -1) {
          drawMap[entry.date].source = drawMap[entry.date].source
            ? drawMap[entry.date].source + ", " + entry.source
            : entry.source;
        }
        if (entry.note && drawMap[entry.date].note.indexOf(entry.note) === -1) {
          drawMap[entry.date].note = drawMap[entry.date].note
            ? drawMap[entry.date].note + " " + entry.note
            : entry.note;
        }
      }
    });

    var resultCount = 0;
    markers.forEach(function (marker) { resultCount += marker.points.length; });

    return {
      draws: drawOrder.map(function (d) { return drawMap[d]; }),
      markers: markers,
      keyGroups: keyGroups,
      keyHistory: keyHistory,
      otherHistory: otherHistory,
      resultCount: resultCount
    };
  }

  function sparkSummary(marker) {
    var bits = marker.points.map(function (p) {
      var bit = displayValue(p) + (p.unit ? " " + p.unit : "") + " on " + fmtDate(p.date, true);
      if (p.flag) bit += ", flag " + p.flag;
      return bit;
    });
    return marker.name + " across " + marker.points.length + " result" + (marker.points.length === 1 ? "" : "s") + ": " + bits.join(", ") + ".";
  }

  function visibleDraws(labels, list) {
    if (!labels || !labels.length || !list || !list.length) return [];
    var minL = null;
    var maxL = null;
    labels.forEach(function (d) {
      if (!DATE_RE.test(d)) return;
      if (minL === null || d < minL) minL = d;
      if (maxL === null || d > maxL) maxL = d;
    });
    if (minL === null) return [];
    return list.filter(function (d) {
      return d && DATE_RE.test(d.date) && d.date >= minL && d.date <= maxL;
    });
  }

  return {
    DATE_RE: DATE_RE,
    buildModel: buildModel,
    rangeStatus: rangeStatus,
    rangeText: rangeText,
    generalRef: generalRef,
    markerKey: markerKey,
    visibleDraws: visibleDraws,
    displayValue: displayValue,
    fmtDate: fmtDate,
    fmtNum: fmtNum,
    decimalPlaces: decimalPlaces,
    daysBetween: daysBetween,
    sparkSummary: sparkSummary
  };
});
