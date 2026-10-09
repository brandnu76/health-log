/* Program (VA MOVE!) card — optional, self-contained.
 * Reads data.program and data.goals.targets from data.json; latest Fitdays weight from data.scans.
 * Never invents numbers; every field is guarded. Does not touch app.js, fuel.js, or lifts.js.
 * Clinic weigh-ins are NOT scans and are never mixed into the scans series. */
(function () {
  "use strict";

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function num(v) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    return v;
  }

  function fmt(v, digits) {
    var n = num(v);
    if (n === null) return "\u2014";
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits === undefined ? 1 : digits });
  }

  function fmtDate(iso, withYear) {
    if (typeof iso !== "string" || !DATE_RE.test(iso)) return "";
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return iso;
    var opts = { month: "short", day: "numeric" };
    if (withYear !== false) opts.year = "numeric";
    return d.toLocaleDateString("en-US", opts);
  }

  function signed(d) {
    var r = Math.round(d * 10) / 10;
    return (r > 0 ? "+" : r < 0 ? "\u2212" : "") + fmt(Math.abs(r)) + " lb";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function cleanWeighIns(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (w) {
      return w && typeof w === "object" && typeof w.date === "string" && DATE_RE.test(w.date) && num(w.weightLb) !== null;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function latestScanWeight(scans) {
    if (!Array.isArray(scans)) return null;
    var best = null;
    scans.forEach(function (s) {
      if (!s || typeof s !== "object" || typeof s.date !== "string" || !DATE_RE.test(s.date)) return;
      if (num(s.weight) === null) return;
      if (!best || s.date > best.date) best = { date: s.date, weightLb: s.weight };
    });
    return best;
  }

  /* Pure model so it can be tested without a DOM. */
  function buildModel(data) {
    if (!data || typeof data !== "object") return null;
    var p = data.program;
    if (!p || typeof p !== "object") return null;
    var targets = (data.goals && data.goals.targets) || {};
    var weighIns = cleanWeighIns(p.clinicWeighIns);
    var start = num(p.startWeightLb);
    var startDate = typeof p.startDate === "string" && DATE_RE.test(p.startDate) ? p.startDate : null;
    if (start === null && weighIns.length) { start = weighIns[0].weightLb; startDate = startDate || weighIns[0].date; }
    var latestClinic = weighIns.length ? weighIns[weighIns.length - 1] : null;
    if (latestClinic && startDate && latestClinic.date <= startDate && weighIns.length < 2) latestClinic = null;
    var scan = latestScanWeight(data.scans);
    var current = null;
    if (latestClinic && (!scan || latestClinic.date >= scan.date)) {
      current = { date: latestClinic.date, weightLb: latestClinic.weightLb, source: "VA clinic" };
    } else if (scan) {
      current = { date: scan.date, weightLb: scan.weightLb, source: "Fitdays (home)" };
    }
    return {
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Program",
      startDate: startDate,
      start: start,
      medication: typeof p.medication === "string" && p.medication.trim() ? p.medication.trim() : null,
      medicationStartDate: typeof p.medicationStartDate === "string" && DATE_RE.test(p.medicationStartDate) ? p.medicationStartDate : null,
      latestClinic: latestClinic,
      current: current,
      goal: num(targets.goalWeightLb),
      checkpoint: num(targets.checkpointWeightLb)
    };
  }

  function clampPct(v) { return Math.max(0, Math.min(100, v)); }

  function statCard(label, value, unit, sub) {
    var card = el("div", "metric-card card card-pad");
    card.setAttribute("role", "listitem");
    card.appendChild(el("div", "label", label));
    var v = el("div", "value", value);
    if (unit) v.appendChild(el("span", "unit", unit));
    card.appendChild(v);
    if (sub) card.appendChild(el("div", "delta", sub));
    return card;
  }

  function progressBar(m) {
    var span = m.start - m.goal;
    if (!(span > 0) || !m.current) return null;
    var pct = clampPct((m.start - m.current.weightLb) / span * 100);
    var wrap = el("div", "program-progress");
    wrap.style.marginTop = "0.75rem";
    var head = el("div", "chart-band-note",
      fmt(m.start) + " lb start \u2192 " + fmt(m.goal) + " lb goal \u00b7 " + Math.round(pct) + "% of the way");
    wrap.appendChild(head);
    var track = el("div", "program-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.round(pct)));
    track.setAttribute("aria-label", "Progress from " + fmt(m.start) + " lb toward " + fmt(m.goal) + " lb goal");
    track.style.cssText = "position:relative;height:12px;border-radius:999px;margin:0.5rem 0 1.4rem;" +
      "background:var(--chart-grid, rgba(148,163,184,0.18));overflow:visible";
    var fill = el("div", "program-fill");
    fill.style.cssText = "height:100%;border-radius:999px;width:" + pct.toFixed(1) + "%;" +
      "background:var(--accent-muted, #2dd4bf)";
    track.appendChild(fill);
    if (m.checkpoint !== null && m.checkpoint < m.start && m.checkpoint > m.goal) {
      var cp = clampPct((m.start - m.checkpoint) / span * 100);
      var mark = el("div", "program-checkpoint");
      mark.title = "Checkpoint " + fmt(m.checkpoint) + " lb";
      mark.style.cssText = "position:absolute;top:-4px;bottom:-4px;width:2px;left:" + cp.toFixed(1) + "%;" +
        "background:var(--chart-text, #94a3b8)";
      var lab = el("span", null, fmt(m.checkpoint) + " checkpoint");
      lab.style.cssText = "position:absolute;top:18px;left:50%;transform:translateX(-50%);white-space:nowrap;" +
        "font-size:0.75rem;color:var(--chart-text, #94a3b8)";
      mark.appendChild(lab);
      track.appendChild(mark);
    }
    wrap.appendChild(track);
    var parts = [];
    if (m.checkpoint !== null) {
      var toCp = m.current.weightLb - m.checkpoint;
      parts.push(toCp > 0 ? fmt(toCp) + " lb to " + fmt(m.checkpoint) + " checkpoint" : fmt(m.checkpoint) + " checkpoint reached");
    }
    var toGoal = m.current.weightLb - m.goal;
    parts.push(toGoal > 0 ? fmt(toGoal) + " lb to " + fmt(m.goal) + " goal" : fmt(m.goal) + " goal reached");
    wrap.appendChild(el("div", "delta", "Current " + fmt(m.current.weightLb) + " lb (" + m.current.source + ", " +
      fmtDate(m.current.date) + ") \u00b7 " + parts.join(" \u00b7 ")));
    return wrap;
  }

  function buildSection(m) {
    var section = el("section", "section");
    section.id = "programSection";
    section.setAttribute("aria-labelledby", "program-heading");
    var head = el("div", "section-head");
    var h2 = el("h2", null, "Program");
    h2.id = "program-heading";
    head.appendChild(h2);
    head.appendChild(el("span", "meta", "VA clinic weigh-ins \u00b7 no invented numbers"));
    section.appendChild(head);

    var card = el("div", "card card-pad");
    card.id = "programCard";
    card.appendChild(el("h3", null, m.name + (m.startDate ? " since " + fmtDate(m.startDate) : "")));
    if (m.medication) {
      var medName = m.medication.split(" (")[0];
      card.appendChild(el("p", "chart-band-note",
        medName + (m.medicationStartDate ? " since " + fmtDate(m.medicationStartDate) : "") +
        " \u00b7 dose managed by VA clinician (not advised here)"));
    }

    var grid = el("div", "metric-grid");
    grid.setAttribute("role", "list");
    if (m.start !== null) {
      grid.appendChild(statCard("Program start", fmt(m.start), "lb", "VA clinic" + (m.startDate ? " \u00b7 " + fmtDate(m.startDate) : "")));
    }
    if (m.latestClinic) {
      var sub = "VA clinic \u00b7 " + fmtDate(m.latestClinic.date);
      if (m.start !== null) sub += " \u00b7 " + signed(m.latestClinic.weightLb - m.start) + " since start";
      grid.appendChild(statCard("Latest clinic", fmt(m.latestClinic.weightLb), "lb", sub));
    }
    if (m.goal !== null) {
      grid.appendChild(statCard("Goal weight", fmt(m.goal), "lb",
        (m.checkpoint !== null ? "Checkpoint " + fmt(m.checkpoint) + " lb \u00b7 " : "") + "keep lean, waist < 33.5 in"));
    }
    card.appendChild(grid);

    if (m.goal !== null && m.start !== null) {
      var bar = progressBar(m);
      if (bar) card.appendChild(bar);
    }
    card.appendChild(el("p", "chart-band-note",
      "Clinic and home scales differ \u2014 compare each to itself. Clinic weigh-ins are not added to the Fitdays scan series."));
    section.appendChild(card);
    return section;
  }

  function mount(section) {
    var old = document.getElementById("programSection");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var progHead = document.getElementById("progress-heading");
    var anchor = progHead ? progHead.closest("section") : null;
    var main = document.getElementById("main");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling);
    else if (main) main.appendChild(section);
  }

  function init() {
    fetch("data.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var m = buildModel(data);
        if (!m) return; // no program data => render nothing
        mount(buildSection(m));
      })
      .catch(function () { /* fail silently; core dashboard is unaffected */ });
  }

  if (typeof window !== "undefined") window.__programModel = buildModel;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
