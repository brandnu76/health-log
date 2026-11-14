/**
 * Brandon's Health Log dashboard
 * Powered by data.json; Chart.js for trends.
 */
(function () {
  "use strict";

  const THEME_KEY = "health-log-theme";
  const RANGE_KEY = "health-log-range";
  const DEVICE_KEY = "health-log-device";
  const BASELINE_ID = "2026-02-01";
  // Avoirdupois pound and international inch. FFMI/FMI are BIA trends, not DEXA.
  const LB_TO_KG = 0.45359237;
  const IN_TO_M = 0.0254;
  // Time-aware EWMA. A reading's influence halves every 21 days.
  // For a gap of Δt days, α = 1 − exp(−Δt / τ) with τ = 21 / ln(2) ≈ 30.3 days.
  // A 7-day gap is about α = 0.21. Partial scans are excluded by the caller.
  const EWMA_HALF_LIFE_DAYS = 21;
  const TREND_WINDOW_DAYS = 28;
  // Longer pace window. When cutStart falls inside it, the window starts there.
  const LONG_TREND_WINDOW_DAYS = 84;
  // Stall when recent smoothed weight and fat mass are both inside this band.
  const STALL_LB_PER_WEEK = 0.25;
  const STALL_MIN_DAYS = 28;
  const STALL_MIN_SCANS = 3;
  // Slower than this is treated as flat so the ETA is not an enormous date.
  const PACE_FLAT_LB_PER_WEEK = 0.05;
  // Flag the ~4-week window when lean mass is more than 25% of a weight loss
  // (the review band was about 25–30%). The peak window is shown, not flagged.
  const LEAN_LOSS_SHARE_FLAG = 0.25;
  const WEIGHT_FLAT_LB = 0.05;
  const charts = [];
  let compositionChart = null;
  let appData = null;
  let chartRange = "all";
  let deviceViewId = null;

  function deviceCatalog(data) {
    const raw =
      data && data.meta && Array.isArray(data.meta.devices) ? data.meta.devices : [];
    return raw.filter((d) => d && d.id);
  }

  function currentDevice(data) {
    const list = deviceCatalog(data);
    const marked = list.find((d) => d.current);
    if (marked) return marked;
    const scans = (data && data.scans) || [];
    for (let i = scans.length - 1; i >= 0; i--) {
      const id = scans[i] && scans[i].device;
      if (id) return list.find((d) => d.id === id) || { id: id, label: id };
    }
    return list[0] || { id: "fitdays", label: "Fitdays+" };
  }

  function deviceById(data, id) {
    const found = deviceCatalog(data).find((d) => d.id === id);
    if (found) return found;
    if (id === "fitdays") return { id: "fitdays", label: "Fitdays+" };
    return { id: id || "fitdays", label: id || "Fitdays+" };
  }

  function viewDevice(data) {
    if (deviceViewId) {
      const found = deviceCatalog(data).find((d) => d.id === deviceViewId);
      if (found) return found;
    }
    return currentDevice(data);
  }

  function orderedDevices(data) {
    const cur = currentDevice(data);
    return deviceCatalog(data)
      .slice()
      .sort((a, b) => {
        if (a.id === cur.id) return -1;
        if (b.id === cur.id) return 1;
        const af = a.from || a.through || "";
        const bf = b.from || b.through || "";
        return af < bf ? -1 : af > bf ? 1 : 0;
      });
  }

  function deviceButtonLabel(data, device) {
    const name = device.label || device.id;
    if (device.id === currentDevice(data).id) return name;
    return name + " (earlier)";
  }

  function scanDeviceId(scan) {
    return (scan && scan.device) || "fitdays";
  }

  function scansOnDevice(scans, deviceId) {
    return (scans || []).filter((s) => scanDeviceId(s) === deviceId);
  }

  function switchDate(data) {
    const cur = currentDevice(data);
    if (cur && cur.from) return cur.from;
    const dated = deviceCatalog(data)
      .map((d) => d.from)
      .filter(Boolean)
      .sort();
    return dated.length ? dated[dated.length - 1] : null;
  }

  function deviceBaseline(scans, device) {
    const list = scans || [];
    if (!list.length) return null;
    if (device && device.id === "fitdays") {
      const feb = findScan(list, BASELINE_ID);
      if (feb) return feb;
    }
    const full = fullScans(list);
    return full.length ? full[0] : list[0];
  }

  function deviceGapMessage(device, count, minimum, subject) {
    const label = (device && device.label) || "This scale";
    const n = count == null ? 0 : count;
    let lead;
    if (n <= 0) {
      lead = label + " has no official scan yet";
      if (device && device.firstOfficial) {
        lead += ". The first morning reading is " + fmt.date(device.firstOfficial);
      }
      lead += ".";
    } else {
      lead =
        label + " has " + n + " full scan" + (n === 1 ? "" : "s") + ".";
    }
    const scansWord = minimum === 1 ? "full scan" : "full scans";
    return (
      lead +
      " " +
      subject +
      " is not computed until this scale has at least " +
      minimum +
      " " +
      scansWord +
      ". Fitdays+ stays a separate earlier series and is not mixed in."
    );
  }

  function deviceBanner(data) {
    const device = viewDevice(data);
    const cur = currentDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const full = fullScans(scans).length;
    if (device.id === cur.id && full === 0) {
      const when = device.firstOfficial
        ? fmt.date(device.firstOfficial)
        : "the next morning scan";
      const switched = cur.from ? fmt.date(cur.from) : "the switch date";
      return (
        "Showing " +
        device.label +
        ". It has no official scan yet (first morning reading " +
        when +
        "). Composition charts, what moved, loss quality, the lean floor, smoothed trends, the stall check, and goal pace are not computed. Weight and waist still include the earlier scale, with a marker on " +
        switched +
        ". The Nov 5, 2026 22:33 reading was an evening test and is not logged."
      );
    }
    if (device.id !== cur.id) {
      const through = device.through ? " through " + fmt.date(device.through) : "";
      return (
        "Showing " +
        device.label +
        " only (" +
        scans.length +
        " scan" +
        (scans.length === 1 ? "" : "s") +
        through +
        "). These figures stay on this scale. They are not continued onto " +
        (cur.label || "the current scale") +
        "."
      );
    }
    return (
      "Showing " +
      device.label +
      " · " +
      full +
      " full scan" +
      (full === 1 ? "" : "s") +
      ". Composition figures use this scale only."
    );
  }

  const fmt = {
    num(n, digits = 1) {
      if (n == null || Number.isNaN(n)) return "—";
      return Number(n).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    },
    int(n) {
      if (n == null || Number.isNaN(n)) return "—";
      return Math.round(n).toLocaleString("en-US");
    },
    date(iso) {
      const d = new Date(iso + "T12:00:00");
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
    signed(n, digits = 1) {
      if (n == null || Number.isNaN(n)) return null;
      const v = Number(n);
      const s = v > 0 ? "+" : "";
      return s + v.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    },
    flex(n, digits = 3) {
      if (n == null || Number.isNaN(Number(n))) return "—";
      return Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
      });
    },
  };

  function preferReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function getTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.setAttribute(
        "aria-label",
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      );
    }
    refreshChartColors();
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function chartColors() {
    return {
      accent: cssVar("--accent-muted") || "#2dd4bf",
      text: cssVar("--chart-text") || "#94a3b8",
      grid: cssVar("--chart-grid") || "rgba(148,163,184,0.12)",
      caution: cssVar("--caution") || "#fbbf24",
      risk: cssVar("--risk") || "#f87171",
    };
  }

  function findScan(scans, id) {
    return scans.find((s) => s.id === id || s.date === id);
  }

  function latestFullScan(scans) {
    const list = scans || [];
    const full = list.filter((s) => !s.partial && s.weight != null);
    return full.length ? full[full.length - 1] : list[list.length - 1] || null;
  }

  /** Delta vs Feb baseline; lower is better for weight/bf/fat/visceral/bodyAge */
  function deltaVsBaseline(latest, baseline, key, { lowerBetter = true } = {}) {
    if (
      latest[key] == null ||
      baseline == null ||
      baseline[key] == null
    ) {
      return null;
    }
    const d = latest[key] - baseline[key];
    const improved = lowerBetter ? d < 0 : d > 0;
    const worsened = lowerBetter ? d > 0 : d < 0;
    let tone = "neutral";
    if (Math.abs(d) < 0.05) tone = "neutral";
    else if (improved) tone = "good";
    else if (worsened) tone = "caution";
    return { value: d, tone, text: fmt.signed(d) };
  }

  function visceralBand(v) {
    if (v == null) return null;
    if (v <= 12) return "good";
    if (v < 15) return "caution";
    return "risk";
  }

  function bfBand(bf) {
    if (bf == null) return null;
    if (bf >= 15 && bf <= 20) return "good";
    if (bf <= 25) return "caution";
    return "risk";
  }

  function fullScans(scans) {
    return scans.filter((s) => !s.partial && s.weight != null);
  }

  function previousFullScan(scans, latest) {
    if (!latest) return null;
    const full = fullScans(scans);
    const idx = full.findIndex((s) => s.id === latest.id);
    if (idx > 0) return full[idx - 1];
    return null;
  }

  function daysBetween(isoA, isoB) {
    const a = new Date(isoA + "T12:00:00");
    const b = new Date(isoB + "T12:00:00");
    return Math.round((b - a) / 86400000);
  }

  /** "HH:MM" 24-hour local time, or null when absent or not that shape. */
  function parseClock(value) {
    if (value == null || value === "") return null;
    const m = String(value).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    return {
      text: m[1] + ":" + m[2],
      minutes: Number(m[1]) * 60 + Number(m[2]),
    };
  }

  function shiftIso(iso, days) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function ewmaSeries(points) {
    const tau = EWMA_HALF_LIFE_DAYS / Math.LN2;
    const sorted = (points || [])
      .filter((p) => p && p.x && p.y != null && Number.isFinite(Number(p.y)))
      .map((p) => ({ x: p.x, y: Number(p.y) }))
      .sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
    if (!sorted.length) return [];
    const out = [{ x: sorted[0].x, y: sorted[0].y }];
    let level = sorted[0].y;
    for (let i = 1; i < sorted.length; i++) {
      const dt = daysBetween(sorted[i - 1].x, sorted[i].x);
      const alpha = dt <= 0 ? 1 : 1 - Math.exp(-dt / tau);
      level = alpha * sorted[i].y + (1 - alpha) * level;
      out.push({ x: sorted[i].x, y: level });
    }
    return out;
  }

  function smoothedWindowRate(smooth, windowDays, floorIso) {
    if (!smooth || smooth.length < 2) return null;
    const latest = smooth[smooth.length - 1];
    let target = shiftIso(latest.x, -windowDays);
    if (floorIso && floorIso > target && floorIso < latest.x) target = floorIso;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < smooth.length - 1; i++) {
      const dist = Math.abs(daysBetween(target, smooth[i].x));
      if (
        dist < bestDist ||
        (dist === bestDist && best && smooth[i].x < best.x)
      ) {
        bestDist = dist;
        best = smooth[i];
      }
    }
    if (!best) return null;
    const days = daysBetween(best.x, latest.x);
    if (!(days > 0)) return null;
    return {
      from: best,
      to: latest,
      days: days,
      perWeek: ((latest.y - best.y) / days) * 7,
    };
  }

  function smoothPointsFor(scans, key) {
    return ewmaSeries(
      (scans || [])
        .filter((s) => !s.partial && metricValue(s, key) != null)
        .map((s) => ({ x: s.date, y: metricValue(s, key) }))
    );
  }

  function trendRateNoteFrom(smooth) {
    if (!smooth || smooth.length < 2) {
      return "Not enough full scans for a smoothed trend. Partial scans are skipped.";
    }
    const rate = smoothedWindowRate(smooth, TREND_WINDOW_DAYS);
    if (!rate) {
      return "Dashed line: time-aware EWMA, 21-day half-life. Not enough span for a trend rate.";
    }
    return (
      "Trend rate " +
      fmt.signed(rate.perWeek, 2) +
      " lb/week from the smoothed series (" +
      fmt.date(rate.from.x) +
      " → " +
      fmt.date(rate.to.x) +
      ", " +
      rate.days +
      " days). Dashed line: time-aware EWMA, 21-day half-life."
    );
  }

  function setTrendNote(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
  }

  /** Earliest full scan that holds the highest logged weight. */
  function peakWeightScan(scans) {
    const full = fullScans(scans).filter(
      (s) => numericField(s, "weight") != null
    );
    if (!full.length) return null;
    let best = full[0];
    let bestW = numericField(best, "weight");
    for (let i = 1; i < full.length; i++) {
      const w = numericField(full[i], "weight");
      if (w > bestW || (w === bestW && full[i].date < best.date)) {
        best = full[i];
        bestW = w;
      }
    }
    return best;
  }

  /** Full scan nearest to `days` before latest, preferring the earlier date on a tie. */
  function nearestFullBefore(scans, latest, days) {
    if (!latest || !latest.date) return null;
    const target = shiftIso(latest.date, -days);
    let best = null;
    let bestDist = Infinity;
    fullScans(scans).forEach((s) => {
      if (!s || s.id === latest.id || !(s.date < latest.date)) return;
      if (numericField(s, "weight") == null) return;
      const dist = Math.abs(daysBetween(target, s.date));
      if (
        dist < bestDist ||
        (dist === bestDist && best && s.date < best.date)
      ) {
        bestDist = dist;
        best = s;
      }
    });
    return best;
  }

  function daysSince(iso) {
    const then = new Date(iso + "T12:00:00");
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    return Math.round((today - day) / 86400000);
  }

  function getTargets(data) {
    const t = (data.goals && data.goals.targets) || {};
    return {
      bfBandMin: t.bfBandMin != null ? t.bfBandMin : 15,
      bfBandMax: t.bfBandMax != null ? t.bfBandMax : 20,
      bfUpperTarget: t.bfUpperTarget != null ? t.bfUpperTarget : 20,
      bfStretch: t.bfStretch != null ? t.bfStretch : 15,
      visceralHealthyMax:
        t.visceralHealthyMax != null ? t.visceralHealthyMax : 12,
      visceralExcess: t.visceralExcess != null ? t.visceralExcess : 13,
      visceralHigherRisk:
        t.visceralHigherRisk != null ? t.visceralHigherRisk : 15,
      leanGainLb: t.leanGainLb != null ? t.leanGainLb : 20,
      leanMetric: t.leanMetric || "lbm",
      cutStart: t.cutStart || null,
      goalWeightLb:
        t.goalWeightLb != null && Number.isFinite(Number(t.goalWeightLb))
          ? Number(t.goalWeightLb)
          : null,
      checkpointWeightLb:
        t.checkpointWeightLb != null &&
        Number.isFinite(Number(t.checkpointWeightLb))
          ? Number(t.checkpointWeightLb)
          : null,
      whtrTarget:
        t.whtrTarget != null && Number.isFinite(Number(t.whtrTarget))
          ? Number(t.whtrTarget)
          : null,
    };
  }

  function subjectHeightIn(data) {
    const subject = data && data.meta && data.meta.subject;
    const h = subject && subject.heightIn;
    if (h == null || !Number.isFinite(Number(h)) || Number(h) <= 0) return null;
    return Number(h);
  }

  /** kg/m² from a pound mass and a height in inches. Null when either input is missing. */
  function kgPerM2(lb, heightIn) {
    if (lb == null || heightIn == null) return null;
    const pounds = Number(lb);
    const inches = Number(heightIn);
    if (!Number.isFinite(pounds) || !Number.isFinite(inches) || inches <= 0) return null;
    const meters = inches * IN_TO_M;
    return (pounds * LB_TO_KG) / (meters * meters);
  }

  function ffmiOf(scan, heightIn) {
    const lean = leanLb(scan);
    if (lean == null) return null;
    return kgPerM2(lean, heightIn);
  }

  function fmiOf(scan, heightIn) {
    if (!scan || scan.fatMass == null) return null;
    return kgPerM2(scan.fatMass, heightIn);
  }

  function whtrOf(scan, heightIn) {
    if (!scan || scan.waistIn == null || heightIn == null) return null;
    const waist = Number(scan.waistIn);
    const inches = Number(heightIn);
    if (!Number.isFinite(waist) || !Number.isFinite(inches) || inches <= 0) return null;
    return waist / inches;
  }

  function subjectSex(data) {
    const subject = data && data.meta && data.meta.subject;
    if (!subject || subject.sex == null) return null;
    return String(subject.sex);
  }

  /** Woolcott & Bergman 2018. Men use 64, women 76. Ratio is unitless. */
  function rfmConstant(sex) {
    const s = String(sex == null ? "" : sex).trim().toLowerCase();
    if (s === "male") return 64;
    if (s === "female") return 76;
    return null;
  }

  function rfmOf(scan, heightIn, sex) {
    const constant = rfmConstant(sex);
    if (constant == null || !scan || scan.waistIn == null || heightIn == null) {
      return null;
    }
    const waist = Number(scan.waistIn);
    const inches = Number(heightIn);
    if (
      !Number.isFinite(waist) ||
      waist <= 0 ||
      !Number.isFinite(inches) ||
      inches <= 0
    ) {
      return null;
    }
    return constant - 20 * (inches / waist);
  }

  function numericField(scan, key) {
    if (!scan || scan[key] == null || !Number.isFinite(Number(scan[key]))) {
      return null;
    }
    return Number(scan[key]);
  }

  /** Lean body mass. Fitdays stores it as lbm. The segmental scale's fat-free mass counts when lbm is absent. */
  function leanLb(scan) {
    const lbm = numericField(scan, "lbm");
    if (lbm != null) return lbm;
    return numericField(scan, "fatFreeMass");
  }

  function metricValue(scan, metric) {
    if (metric === "lbm") return leanLb(scan);
    return numericField(scan, metric);
  }

  function waistScans(scans) {
    return (scans || []).filter(
      (s) => s && s.waistIn != null && Number.isFinite(Number(s.waistIn))
    );
  }

  function earliestScan(list) {
    let best = null;
    (list || []).forEach((s) => {
      if (!best || String(s.date) < String(best.date)) best = s;
    });
    return best;
  }

  function latestScan(list) {
    let best = null;
    (list || []).forEach((s) => {
      if (!best || String(s.date) >= String(best.date)) best = s;
    });
    return best;
  }

  function priorScan(list, current) {
    if (!current) return null;
    let best = null;
    (list || []).forEach((s) => {
      if (!s || s.id === current.id) return;
      if (String(s.date) >= String(current.date)) return;
      if (!best || String(s.date) > String(best.date)) best = s;
    });
    return best;
  }

  function deltaInfo(current, prior, { lowerBetter = true, digits = 1, eps = 0.05 } = {}) {
    if (current == null || prior == null) return null;
    const c = Number(current);
    const p = Number(prior);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
    const d = c - p;
    let tone = "neutral";
    if (Math.abs(d) >= eps) {
      const improved = lowerBetter ? d < 0 : d > 0;
      tone = improved ? "good" : "caution";
    }
    return { value: d, tone, text: fmt.signed(d, digits) };
  }

  function appendMetricCard(root, spec) {
    const el = document.createElement("article");
    el.className = "card card-pad metric-card";
    if (spec.band) el.classList.add("band-" + spec.band);
    el.setAttribute("role", "listitem");
    if (spec.title) el.title = spec.title;
    const valueClass = spec.empty ? "value is-empty" : "value";
    el.innerHTML =
      '<span class="label">' +
      spec.label +
      "</span>" +
      '<div class="' +
      valueClass +
      '">' +
      spec.valueHtml +
      "</div>" +
      '<div class="delta-stack">' +
      (spec.deltaHtml || "") +
      "</div>";
    root.appendChild(el);
  }

  function appendIndexCard(root, spec) {
    if (spec.value == null) {
      appendMetricCard(root, {
        label: spec.label,
        empty: true,
        title: spec.title,
        valueHtml: "Not measured",
        deltaHtml:
          '<span class="delta neutral">' + escapeHtml(spec.missing) + "</span>",
      });
      return;
    }
    const dFeb = deltaInfo(spec.value, spec.feb, {
      lowerBetter: spec.lowerBetter,
      digits: 1,
      eps: 0.05,
    });
    const dPrev = deltaInfo(spec.value, spec.prev, {
      lowerBetter: spec.lowerBetter,
      digits: 1,
      eps: 0.05,
    });
    const baseWord = spec.baselineLabel || "vs Feb";
    const febLine = dFeb
      ? '<span class="delta ' + dFeb.tone + '">' + dFeb.text + " " + baseWord + "</span>"
      : '<span class="delta neutral" title="' +
        escapeHtml(spec.febTitle || "") +
        '">Δ ' +
        baseWord +
        " n/a</span>";
    let prevLine = "";
    if (spec.hasPrev) {
      prevLine = dPrev
        ? '<span class="delta secondary ' +
          dPrev.tone +
          '">' +
          dPrev.text +
          " vs prior full</span>"
        : '<span class="delta secondary neutral">— vs prior full</span>';
    }
    const bia =
      '<span class="delta secondary neutral" title="' +
      escapeHtml(spec.title || "") +
      '">BIA trend · not DEXA</span>';
    appendMetricCard(root, {
      label: spec.label,
      title: spec.title,
      valueHtml: fmt.num(spec.value, 1) + '<span class="unit">kg/m²</span>',
      deltaHtml: bia + febLine + prevLine,
    });
  }

  function renderBodyCompCards(data, root) {
    const all = data.scans || [];
    const device = viewDevice(data);
    const scans = scansOnDevice(all, device.id);
    const height = subjectHeightIn(data);
    const t = getTargets(data);
    const baseline = deviceBaseline(scans, device);
    const latestFull = latestFullScan(scans);
    const prevFull = latestFull ? previousFullScan(scans, latestFull) : null;
    const baselineLabel =
      baseline && baseline.id === BASELINE_ID ? "vs Feb" : "vs first on this scale";
    const waists = waistScans(all);
    const latestWaist = latestScan(waists);
    const priorWaist = priorScan(waists, latestWaist);
    const targetWaist =
      height != null && t.whtrTarget != null ? height * t.whtrTarget : null;

    if (!latestWaist) {
      appendMetricCard(root, {
        label: "Waist",
        empty: true,
        title: "Saturday morning at the navel, after a relaxed exhale.",
        valueHtml: "Not measured",
        deltaHtml: '<span class="delta neutral">No waist reading yet</span>',
      });
      appendMetricCard(root, {
        label: "WHtR",
        empty: true,
        title: "Waist inches divided by height inches.",
        valueHtml: "Not measured",
        deltaHtml: '<span class="delta neutral">Needs a waist reading</span>',
      });
    } else {
      const waist = Number(latestWaist.waistIn);
      let waistBand = null;
      if (targetWaist != null) {
        waistBand = waist <= targetWaist + 1e-9 ? "good" : "caution";
      }
      const dWaist = priorWaist
        ? deltaInfo(waist, Number(priorWaist.waistIn), {
            lowerBetter: true,
            digits: 3,
            eps: 0.05,
          })
        : null;
      const waistDelta = dWaist
        ? '<span class="delta ' +
          dWaist.tone +
          '">' +
          dWaist.text +
          " in vs prior waist</span>"
        : '<span class="delta neutral">First reading · no prior waist</span>';
      appendMetricCard(root, {
        label: "Waist",
        band: waistBand,
        title: "Saturday morning at the navel, after a relaxed exhale.",
        valueHtml: fmt.flex(waist, 3) + '<span class="unit">in</span>',
        deltaHtml: waistDelta,
      });

      const ratio = whtrOf(latestWaist, height);
      if (ratio == null) {
        appendMetricCard(root, {
          label: "WHtR",
          empty: true,
          title: "Waist inches divided by height inches.",
          valueHtml: "Not measured",
          deltaHtml: '<span class="delta neutral">Height not logged</span>',
        });
      } else {
        const whtrBand =
          t.whtrTarget == null
            ? null
            : ratio <= t.whtrTarget + 1e-9
              ? "good"
              : "caution";
        const priorRatio = priorWaist ? whtrOf(priorWaist, height) : null;
        const dRatio =
          priorRatio != null
            ? deltaInfo(ratio, priorRatio, {
                lowerBetter: true,
                digits: 3,
                eps: 0.0005,
              })
            : null;
        const ratioDelta = dRatio
          ? '<span class="delta ' +
            dRatio.tone +
            '">' +
            dRatio.text +
            " vs prior waist</span>"
          : '<span class="delta neutral">Waist ÷ height' +
            (t.whtrTarget != null
              ? " · goal under " + fmt.flex(t.whtrTarget, 3)
              : "") +
            "</span>";
        appendMetricCard(root, {
          label: "WHtR",
          band: whtrBand,
          title: "Waist inches divided by height inches.",
          valueHtml: fmt.num(ratio, 3),
          deltaHtml: ratioDelta,
        });
      }
    }

    appendRfmCard(root, data, latestWaist);

    const indexMissing = (kind, absent) => {
      if (height == null) return "Height not logged";
      if (!latestFull) return "No official scan on this scale yet";
      if (absent) return "No " + kind + " on the latest full scan";
      return "Not measured";
    };
    appendIndexCard(root, {
      label: "FFMI",
      title:
        "Scan LBM in kg divided by height in m². " +
        (device.label || "Scale") +
        " BIA trend, not a DEXA result.",
      value: ffmiOf(latestFull, height),
      feb: ffmiOf(baseline, height),
      prev: ffmiOf(prevFull, height),
      hasPrev: !!prevFull,
      lowerBetter: false,
      baselineLabel: baselineLabel,
      missing: indexMissing("LBM", !latestFull || leanLb(latestFull) == null),
      febTitle:
        baseline && baseline.id === BASELINE_ID
          ? "Feb baseline has no LBM, so FFMI is not compared to it."
          : "No earlier LBM on this scale, so FFMI is not compared.",
    });
    appendIndexCard(root, {
      label: "FMI",
      title:
        "Scan fat mass in kg divided by height in m². " +
        (device.label || "Scale") +
        " BIA trend, not a DEXA result.",
      value: fmiOf(latestFull, height),
      feb: fmiOf(baseline, height),
      prev: fmiOf(prevFull, height),
      hasPrev: !!prevFull,
      lowerBetter: true,
      baselineLabel: baselineLabel,
      missing: indexMissing(
        "fat mass",
        !latestFull || latestFull.fatMass == null
      ),
      febTitle:
        baseline && baseline.id === BASELINE_ID
          ? "Feb baseline has no fat mass, so FMI is not compared to it."
          : "No earlier fat mass on this scale, so FMI is not compared.",
    });
  }

  function appendRfmCard(root, data, latestWaist) {
    const title =
      "Relative fat mass from height and waist (Woolcott & Bergman 2018). Tape estimate, not DEXA and not BIA.";
    if (!latestWaist) {
      appendMetricCard(root, {
        label: "RFM",
        empty: true,
        title: title,
        valueHtml: "Not measured",
        deltaHtml: '<span class="delta neutral">Needs a waist reading</span>',
      });
      return;
    }
    const height = subjectHeightIn(data);
    const sex = subjectSex(data);
    const rfm = rfmOf(latestWaist, height, sex);
    if (rfm == null) {
      let why = "Needs a waist reading";
      if (rfmConstant(sex) == null) why = "Sex not logged";
      else if (height == null) why = "Height not logged";
      appendMetricCard(root, {
        label: "RFM",
        empty: true,
        title: title,
        valueHtml: "Not measured",
        deltaHtml:
          '<span class="delta neutral">' + escapeHtml(why) + "</span>",
      });
      return;
    }
    let deltaHtml =
      '<span class="delta neutral">Tape estimate · not DEXA · not BIA</span>';
    const bia = numericField(latestWaist, "bf");
    const sameScale = scanDeviceId(latestWaist) === viewDevice(data).id;
    if (bia != null && sameScale) {
      deltaHtml =
        '<span class="delta neutral">' +
        fmt.signed(rfm - bia, 1) +
        " vs BIA BF%</span>" +
        '<span class="delta secondary neutral">Tape estimate · not DEXA · not BIA</span>';
    } else if (bia != null) {
      const src = deviceById(data, scanDeviceId(latestWaist));
      deltaHtml =
        '<span class="delta neutral">Tape estimate · not DEXA · not BIA</span>' +
        '<span class="delta secondary neutral">BIA on this waist date is ' +
        escapeHtml(src.label || "another scale") +
        " and is not compared</span>";
    }
    appendMetricCard(root, {
      label: "RFM",
      title: title,
      valueHtml: fmt.num(rfm, 1) + '<span class="unit">%</span>',
      deltaHtml: deltaHtml,
    });
  }

  function whtrSeries(scans, heightIn) {
    if (heightIn == null) return [];
    return (scans || [])
      .filter((s) => whtrOf(s, heightIn) != null)
      .map((s) => ({ x: s.date, y: whtrOf(s, heightIn), label: s.label }));
  }

  function rfmSeries(scans, heightIn, sex) {
    if (heightIn == null || rfmConstant(sex) == null) return [];
    return (scans || [])
      .filter((s) => rfmOf(s, heightIn, sex) != null)
      .map((s) => ({ x: s.date, y: rfmOf(s, heightIn, sex), label: s.label }));
  }

  function setChartNote(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function seriesSummary(points, label, digits) {
    if (!points || !points.length) return label + ": no data in this range.";
    const vals = points.map((p) => Number(p.y)).filter((v) => Number.isFinite(v));
    if (!vals.length) return label + ": no numeric values in this range.";
    const first = points[0];
    const last = points[points.length - 1];
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const d = digits != null ? digits : 1;
    const change = Number(last.y) - Number(first.y);
    const sign = change > 0 ? "+" : "";
    return (
      label +
      ": " +
      points.length +
      " points. From " +
      fmt.date(first.x) +
      " (" +
      fmt.num(first.y, d) +
      ") to " +
      fmt.date(last.x) +
      " (" +
      fmt.num(last.y, d) +
      "), change " +
      sign +
      fmt.num(change, d) +
      ". Range " +
      fmt.num(min, d) +
      " to " +
      fmt.num(max, d) +
      "."
    );
  }

  function attachChartSummary(canvasId, text) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const sid = canvasId + "-summary";
    let el = document.getElementById(sid);
    if (!el) {
      el = document.createElement("p");
      el.id = sid;
      el.className = "sr-only";
      // Place after the canvas wrap so it stays in document order
      const wrap = canvas.closest(".chart-wrap") || canvas.parentElement;
      if (wrap && wrap.parentElement) {
        wrap.parentElement.insertBefore(el, wrap.nextSibling);
      } else {
        canvas.insertAdjacentElement("afterend", el);
      }
    }
    el.textContent = text;
    canvas.setAttribute("aria-describedby", sid);
  }

  function renderWhtrProgress(data, root, t) {
    const height = subjectHeightIn(data);
    if (!root || height == null || t.whtrTarget == null) return;
    const waists = waistScans(data.scans || []);
    const first = earliestScan(waists);
    const latest = latestScan(waists);
    if (!first || !latest) return;
    const base = whtrOf(first, height);
    const now = whtrOf(latest, height);
    if (base == null || now == null) return;
    const target = t.whtrTarget;
    const targetWaist = height * target;
    const inchesLeft = Number(latest.waistIn) - targetWaist;
    let progressed;
    if (base <= target) {
      progressed = now <= target ? 1 : 0;
    } else {
      progressed = (base - now) / (base - target);
      if (progressed < 0) progressed = 0;
      if (progressed > 1) progressed = 1;
    }
    const atGoal = now <= target + 1e-9;
    const fillClass = atGoal ? "good" : "caution";
    const inchesTxt =
      inchesLeft > 0.0005
        ? fmt.flex(inchesLeft, 3) + " in still to go"
        : inchesLeft < -0.0005
          ? fmt.flex(-inchesLeft, 3) + " in under target waist"
          : "At target waist";
    const detail =
      inchesLeft > 0.0005
        ? fmt.flex(inchesLeft, 3) +
          " in still to go from " +
          fmt.flex(Number(latest.waistIn), 3) +
          " in."
        : "At or under the target waist.";
    const firstNote =
      first.id === latest.id
        ? " First waist reading — no change since baseline."
        : "";
    const item = document.createElement("div");
    item.className = "progress-item";
    item.innerHTML = `
        <h4>Waist-to-height → under ${fmt.flex(target, 3)}</h4>
        <div class="progress-meta">
          <span>Now ${fmt.num(now, 3)} · baseline ${fmt.num(base, 3)} on ${fmt.date(
            first.date
          )}</span>
          <span>${inchesTxt}</span>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(
          progressed * 100
        )}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress from baseline waist-to-height ${fmt.num(
          base,
          3
        )} toward under ${fmt.flex(target, 3)}">
          <div class="progress-fill ${fillClass}" style="width:${(
            progressed * 100
          ).toFixed(1)}%"></div>
        </div>
        <p class="progress-sub">Target waist ${fmt.flex(
          targetWaist,
          3
        )} in (${fmt.flex(height, 3)} in × ${fmt.flex(
          target,
          3
        )}). ${detail}${firstNote}</p>
      `;
    root.appendChild(item);
  }

  function getChartRange() {
    const stored = localStorage.getItem(RANGE_KEY);
    if (stored === "90" || stored === "180" || stored === "all") return stored;
    return "all";
  }

  function scansInRange(scans, range) {
    if (!range || range === "all") return scans;
    const days = Number(range);
    if (!days) return scans;
    const latest = latestFullScan(scans);
    if (!latest) return scans;
    const end = new Date(latest.date + "T12:00:00");
    const start = new Date(end.getTime() - days * 86400000);
    return scans.filter((s) => {
      const d = new Date(s.date + "T12:00:00");
      return d >= start && d <= end;
    });
  }

  function leanFloorScan(scans, t) {
    const metric = t.leanMetric || "lbm";
    let pool = fullScans(scans).filter((s) => metricValue(s, metric) != null);
    if (t.cutStart) {
      const cutPool = pool.filter((s) => s.date >= t.cutStart);
      if (cutPool.length) pool = cutPool;
    }
    if (pool.length < 2) return null;
    return pool.reduce((best, s) =>
      best == null || metricValue(s, metric) < metricValue(best, metric) ? s : best
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const refBandPlugin = {
    id: "refBands",
    beforeDraw(chart) {
      const cfg = chart.options.plugins && chart.options.plugins.refBands;
      if (!cfg || !cfg.bands) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const y = scales.y;
      ctx.save();
      cfg.bands.forEach((b) => {
        const y1 = y.getPixelForValue(b.max);
        const y2 = y.getPixelForValue(b.min);
        const top = Math.min(y1, y2);
        const h = Math.abs(y2 - y1);
        ctx.fillStyle = b.color;
        ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, h);
      });
      ctx.restore();
    },
    afterDraw(chart) {
      const cfg = chart.options.plugins && chart.options.plugins.refBands;
      if (!cfg || !cfg.lines) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const y = scales.y;
      ctx.save();
      cfg.lines.forEach((ln) => {
        const py = y.getPixelForValue(ln.value);
        if (py < chartArea.top || py > chartArea.bottom) return;
        ctx.beginPath();
        ctx.setLineDash(ln.dash || [4, 4]);
        ctx.strokeStyle = ln.color;
        ctx.lineWidth = 1.25;
        ctx.moveTo(chartArea.left, py);
        ctx.lineTo(chartArea.right, py);
        ctx.stroke();
        if (ln.label) {
          ctx.setLineDash([]);
          ctx.font = "600 10px Inter, system-ui, sans-serif";
          ctx.fillStyle = ln.color;
          ctx.textAlign = "right";
          ctx.fillText(ln.label, chartArea.right - 4, py - 4);
        }
      });
      ctx.restore();
    },
  };

  const SEGMENT_ROWS = [
    ["Left arm", "leftArmMuscle", "leftArmFat", "leftArmMusclePct", "leftArmFatPct"],
    ["Right arm", "rightArmMuscle", "rightArmFat", "rightArmMusclePct", "rightArmFatPct"],
    ["Left leg", "leftLegMuscle", "leftLegFat", "leftLegMusclePct", "leftLegFatPct"],
    ["Right leg", "rightLegMuscle", "rightLegFat", "rightLegMusclePct", "rightLegFatPct"],
    ["Trunk", "trunkMuscle", "trunkFat", "trunkMusclePct", "trunkFatPct"],
  ];

  function appendEmptyMetric(root, label, reason) {
    appendMetricCard(root, {
      label: label,
      empty: true,
      valueHtml: "No scan yet",
      deltaHtml:
        '<span class="delta neutral">' + escapeHtml(reason) + "</span>",
    });
  }

  function renderSegmental(scan) {
    const root = document.getElementById("segmentalMetrics");
    if (!root) return;
    const parts = [];
    SEGMENT_ROWS.forEach((row) => {
      const muscle = numericField(scan, row[1]);
      const fat = numericField(scan, row[2]);
      const musclePct = numericField(scan, row[3]);
      const fatPct = numericField(scan, row[4]);
      if (muscle == null && fat == null && musclePct == null && fatPct == null) {
        return;
      }
      const bits = [];
      if (muscle != null) bits.push("Muscle " + fmt.num(muscle, 1) + " lb");
      if (fat != null) bits.push("Fat " + fmt.num(fat, 1) + " lb");
      if (musclePct != null) bits.push("Muscle " + fmt.num(musclePct, 1) + "%");
      if (fatPct != null) bits.push("Fat " + fmt.num(fatPct, 1) + "%");
      parts.push(
        '<div class="extra-item"><span class="elabel">' +
          escapeHtml(row[0]) +
          '</span><span class="eval">' +
          escapeHtml(bits.join(" · ")) +
          "</span></div>"
      );
    });
    if (!scan || !parts.length) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    root.hidden = false;
    root.innerHTML =
      "<h3>Segmental muscle and fat</h3>" +
      '<p class="chart-band-note">This scale only. Logged pounds and percents. Not compared with Fitdays+.</p>' +
      '<div class="segmental-grid">' +
      parts.join("") +
      "</div>";
  }

  function renderFallbackWeight(root, data, device) {
    const fallback = latestFullScan(data.scans || []);
    if (!fallback || numericField(fallback, "weight") == null) {
      appendEmptyMetric(root, "Weight", "No weight logged.");
      return;
    }
    const src = deviceById(data, scanDeviceId(fallback));
    appendMetricCard(root, {
      label: "Weight",
      title:
        "Last logged weight. It is not a reading from " +
        (device.label || "this scale") +
        ".",
      valueHtml: fmt.num(fallback.weight, 1) + '<span class="unit">lb</span>',
      deltaHtml:
        '<span class="delta neutral">' +
        escapeHtml(src.label || "Earlier scale") +
        " · " +
        fmt.date(fallback.date) +
        "</span>" +
        '<span class="delta secondary neutral">No delta across scales</span>',
    });
  }

  function renderMetrics(data) {
    const device = viewDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const baseline = deviceBaseline(scans, device);
    const latest = latestFullScan(scans);
    const metaEl = document.getElementById("latestMeta");
    const prev = previousFullScan(scans, latest);
    const latestClock = parseClock(latest && latest.scanTime);
    const baseWord =
      baseline && baseline.id === BASELINE_ID ? "vs Feb" : "vs first on this scale";
    if (!latest) {
      metaEl.textContent = (device.label || "Current scale") + " · no official scan yet";
    } else {
      metaEl.textContent =
        fmt.date(latest.date) +
        (latestClock ? " · " + latestClock.text : "") +
        " · " +
        (latest.label || "Scan") +
        " · " +
        (device.label || "") +
        " · " +
        baseWord +
        " & prior full";
    }
    renderScanTimeNote(data, latest);

    const composition = [
      {
        key: "bf",
        label: "Body fat",
        unit: "%",
        digits: 1,
        lowerBetter: true,
        band: latest ? bfBand(latest.bf) : null,
      },
      {
        key: "fatMass",
        label: "Fat mass",
        unit: "lb",
        digits: 1,
        lowerBetter: true,
        band: null,
      },
      {
        key: "visceral",
        label: "Visceral",
        unit: "",
        digits: 1,
        lowerBetter: true,
        band: latest ? visceralBand(latest.visceral) : null,
      },
      {
        key: "bodyAge",
        label: "Body age",
        unit: "yr",
        digits: 0,
        lowerBetter: true,
        band: null,
      },
      {
        key: "lbm",
        label: "LBM",
        unit: "lb",
        digits: 1,
        lowerBetter: false,
        band: null,
      },
      {
        key: "muscleMass",
        label: "Muscle mass",
        unit: "lb",
        digits: 1,
        lowerBetter: false,
        band: null,
      },
    ];

    const root = document.getElementById("metricCards");
    root.innerHTML = "";

    const cards = [];
    if (latest && numericField(latest, "weight") != null) {
      cards.push({
        key: "weight",
        label: "Weight",
        unit: "lb",
        digits: 1,
        lowerBetter: true,
        band: null,
      });
    } else {
      renderFallbackWeight(root, data, device);
    }
    if (!latest) {
      composition.forEach((c) => {
        appendEmptyMetric(root, c.label, "No official scan on this scale yet.");
      });
    } else {
      composition.forEach((c) => cards.push(c));
    }

    cards.forEach((c) => {
      const el = document.createElement("article");
      el.className = "card card-pad metric-card";
      el.setAttribute("role", "listitem");
      if (c.band) el.classList.add("band-" + c.band);

      const raw = c.key === "lbm" ? leanLb(latest) : numericField(latest, c.key);
      const val =
        raw == null ? "—" : c.digits === 0 ? fmt.int(raw) : fmt.num(raw, c.digits);
      const uncertainBaseline =
        c.key === "muscleMass" &&
        baseline &&
        (baseline.labelUncertain || baseline.muscleMassApprox);

      let deltaHtml = "";
      if (uncertainBaseline) {
        deltaHtml = `<div class="delta-stack"><span class="delta neutral" title="${escapeHtml(
          "No delta vs Feb — baseline muscle label uncertain"
        )}">Δ vs Feb n/a</span></div>`;
      } else {
        const dFeb =
          c.key === "lbm"
            ? deltaInfo(leanLb(latest), baseline ? leanLb(baseline) : null, {
                lowerBetter: c.lowerBetter,
              })
            : deltaVsBaseline(latest, baseline, c.key, {
                lowerBetter: c.lowerBetter,
              });
        const dPrev = prev
          ? c.key === "lbm"
            ? deltaInfo(leanLb(latest), leanLb(prev), { lowerBetter: c.lowerBetter })
            : deltaVsBaseline(latest, prev, c.key, {
                lowerBetter: c.lowerBetter,
              })
          : null;
        const baseMissing =
          baseline == null ||
          (c.key === "lbm" ? leanLb(baseline) == null : baseline[c.key] == null);
        const febLine = dFeb
          ? `<span class="delta ${dFeb.tone}">${dFeb.text} ${baseWord}</span>`
          : `<span class="delta neutral">${
              baseMissing ? "Δ " + baseWord + " n/a" : "— " + baseWord
            }</span>`;
        let prevLine = "";
        if (prev && prev.id !== latest.id) {
          if (baseline && prev.id === baseline.id) {
            prevLine = `<span class="delta secondary neutral">${
              baseline.id === BASELINE_ID
                ? "prior full = Feb"
                : "prior full = first on this scale"
            }</span>`;
          } else if (dPrev) {
            prevLine = `<span class="delta secondary ${dPrev.tone}">${dPrev.text} vs prior full</span>`;
          } else {
            prevLine = `<span class="delta secondary neutral">— vs prior full</span>`;
          }
        }
        deltaHtml = `<div class="delta-stack">${febLine}${prevLine}</div>`;
      }

      el.innerHTML = `
        <span class="label">${c.label}</span>
        <div class="value">${val}${
        c.unit ? `<span class="unit">${c.unit}</span>` : ""
      }</div>
        ${deltaHtml}
      `;
      root.appendChild(el);
    });

    renderBodyCompCards(data, root);

    // Extra Sep 19 metrics
    const extras = [
      { key: "muscleRate", label: "Muscle rate", unit: "%" },
      { key: "skeletalMusclePct", label: "Skeletal muscle", unit: "%" },
      { key: "subqFat", label: "Subq fat", unit: "%" },
      { key: "bodyWater", label: "Body water", unit: "%" },
      { key: "waterWeight", label: "Water wt", unit: "lb" },
      { key: "proteinPct", label: "Protein", unit: "%" },
      { key: "proteinMass", label: "Protein mass", unit: "lb" },
      { key: "bone", label: "Bone", unit: "lb" },
      { key: "bmr", label: "BMR", unit: "kcal", digits: 0 },
      { key: "bmi", label: "BMI", unit: "" },
      { key: "fatFreeMass", label: "Fat-free mass", unit: "lb" },
      { key: "skeletalMuscleMass", label: "Skeletal muscle mass", unit: "lb" },
      { key: "bodyCellMass", label: "Body cell mass", unit: "lb" },
      { key: "minerals", label: "Minerals", unit: "lb" },
      { key: "intracellularWater", label: "Intracellular water", unit: "lb" },
      { key: "extracellularWater", label: "Extracellular water", unit: "lb" },
      { key: "intracellularWaterPct", label: "Intracellular water", unit: "%" },
      { key: "extracellularWaterPct", label: "Extracellular water", unit: "%" },
      { key: "heartRate", label: "Scale heart rate", unit: "bpm", digits: 0 },
      { key: "subqFatMass", label: "Subq fat mass", unit: "lb" },
      { key: "waistHipRatio", label: "Waist-hip ratio", unit: "" },
      { key: "smqi", label: "SMQI", unit: "" },
      { key: "healthScore", label: "Health score", unit: "", digits: 0 },
    ];

    const extraRoot = document.getElementById("extraMetrics");
    extraRoot.innerHTML = "";
    extras.forEach((e) => {
      if (!latest || latest[e.key] == null) return;
      const dig = e.digits != null ? e.digits : 1;
      const v =
        dig === 0 ? fmt.int(latest[e.key]) : fmt.num(latest[e.key], dig);
      const item = document.createElement("div");
      item.className = "extra-item";
      item.innerHTML = `
        <span class="elabel">${e.label}</span>
        <span class="eval">${v}${e.unit ? " " + e.unit : ""}</span>
      `;
      extraRoot.appendChild(item);
    });

    renderSegmental(latest);
    renderWhatMoved(data);
    renderLossQuality(data);
  }

  function seriesFor(scans, key) {
    return (scans || [])
      .filter((s) => metricValue(s, key) != null)
      .map((s) => ({
        x: s.date,
        y: metricValue(s, key),
        label: s.label,
        device: scanDeviceId(s),
      }));
  }

  function markerPixel(scale, labels, iso, area) {
    if (!scale || !area || !labels || !labels.length || !iso) return null;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === iso) return scale.getPixelForValue(i);
    }
    let prev = -1;
    let next = -1;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] < iso) prev = i;
      else {
        next = i;
        break;
      }
    }
    if (prev < 0 && next >= 0) {
      if (daysBetween(iso, labels[next]) > 21) return null;
      return scale.getPixelForValue(next);
    }
    if (prev >= 0 && next < 0) {
      const last = scale.getPixelForValue(prev);
      const prevPx = prev > 0 ? scale.getPixelForValue(prev - 1) : last - 28;
      const step = Math.max(16, last - prevPx);
      return Math.min(area.right - 8, last + step * 0.45);
    }
    if (prev < 0 || next < 0) return null;
    const span = daysBetween(labels[prev], labels[next]);
    const t = span > 0 ? daysBetween(labels[prev], iso) / span : 0;
    const p0 = scale.getPixelForValue(prev);
    const p1 = scale.getPixelForValue(next);
    return p0 + (p1 - p0) * t;
  }

  const deviceSwitchPlugin = {
    id: "deviceSwitch",
    afterDraw(chart) {
      const cfg = chart.options.plugins && chart.options.plugins.deviceSwitch;
      if (!cfg || !cfg.date) return;
      const labels = chart.data.labels || [];
      const xScale = chart.scales.x;
      const area = chart.chartArea;
      if (!xScale || !area || !labels.length) return;
      const px = markerPixel(xScale, labels, cfg.date, area);
      if (px == null || px < area.left || px > area.right) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = cfg.color || "#fbbf24";
      ctx.lineWidth = 1.25;
      ctx.moveTo(px, area.top);
      ctx.lineTo(px, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.fillStyle = cfg.color || "#fbbf24";
      const text = cfg.label || "Scale switch";
      const nearRight = area.right - px < 72;
      ctx.textAlign = nearRight ? "right" : "left";
      ctx.fillText(text, nearRight ? px - 4 : px + 4, area.top + 11);
      ctx.restore();
    },
  };

  function setChartEmpty(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.closest(".chart-wrap") || canvas.parentElement;
    let note = document.getElementById(canvasId + "-empty");
    if (!message) {
      canvas.hidden = false;
      if (wrap) wrap.classList.remove("is-empty");
      if (note) note.remove();
      return;
    }
    canvas.hidden = true;
    if (wrap) wrap.classList.add("is-empty");
    if (!note && wrap) {
      note = document.createElement("p");
      note.id = canvasId + "-empty";
      note.className = "chart-empty";
      wrap.appendChild(note);
    }
    if (note) note.textContent = message;
  }

  function makeLineChart(canvasId, points, yLabel, refCfg, extra) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    const digits = extra && extra.digits != null ? extra.digits : null;
    const colors = chartColors();
    const labels = points.map((p) => p.x);
    const values = points.map((p) => p.y);
    const smoothRaw = extra && extra.smooth;
    let smoothValues = null;
    if (smoothRaw && smoothRaw.length && labels.length) {
      const byDate = Object.create(null);
      smoothRaw.forEach((p) => {
        if (!p || p.y == null || !Number.isFinite(Number(p.y))) return;
        byDate[p.x] = Number(p.y);
      });
      const aligned = labels.map((d) => (byDate[d] == null ? null : byDate[d]));
      if (aligned.some((v) => v != null)) smoothValues = aligned;
    }
    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    const bandColor = isLight
      ? "rgba(13, 148, 136, 0.14)"
      : "rgba(94, 234, 212, 0.16)";

    let suggestedMin;
    let suggestedMax;
    const extentValues = values
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number);
    if (smoothValues) {
      smoothValues.forEach((v) => {
        if (v != null && Number.isFinite(v)) extentValues.push(v);
      });
    }
    if (extentValues.length) {
      let lo = Math.min.apply(null, extentValues);
      let hi = Math.max.apply(null, extentValues);
      if (refCfg && refCfg.bands) {
        refCfg.bands.forEach((b) => {
          lo = Math.min(lo, b.min);
          hi = Math.max(hi, b.max);
        });
      }
      if (refCfg && refCfg.lines) {
        refCfg.lines.forEach((ln) => {
          lo = Math.min(lo, ln.value);
          hi = Math.max(hi, ln.value);
        });
      }
      const pad = (hi - lo) * 0.12 || 1;
      suggestedMin = lo - pad;
      suggestedMax = hi + pad;
    }

    const pluginsOpt = {
      legend: { display: false },
      tooltip: {
        filter(item) {
          return item.parsed && item.parsed.y != null && !Number.isNaN(item.parsed.y);
        },
        callbacks: {
          title(items) {
            const i = items[0].dataIndex;
            return fmt.date(labels[i]);
          },
        },
      },
    };
    if (digits != null) {
      pluginsOpt.tooltip.callbacks.label = function (ctx) {
        return ctx.dataset.label + ": " + fmt.num(ctx.parsed.y, digits);
      };
    }
    if (refCfg) {
      pluginsOpt.refBands = {
        bands: (refCfg.bands || []).map((b) => ({
          min: b.min,
          max: b.max,
          color: b.color || bandColor,
        })),
        lines: (refCfg.lines || []).map((ln) => ({
          value: ln.value,
          label: ln.label,
          color: ln.color || colors.caution,
          dash: ln.dash,
        })),
      };
    }
    const marker = extra && extra.marker;
    if (marker && marker.date) {
      pluginsOpt.deviceSwitch = {
        date: marker.date,
        label: marker.label || "Scale switch",
        color: colors.caution,
      };
    }

    const pointBorder = cssVar("--bg") || "#0f1419";
    const colorByDevice = extra && extra.colorByDevice;
    const pointRoles = colorByDevice
      ? points.map((p) => (p.device && p.device !== "fitdays" ? "caution" : "accent"))
      : null;
    const pointColors = pointRoles
      ? pointRoles.map((role) => seriesColor(role, colors))
      : colors.accent;
    const datasets = [
      {
        label: yLabel,
        data: values,
        borderColor: colors.accent,
        backgroundColor: colors.accent + "22",
        borderWidth: 2,
        tension: 0.25,
        fill: true,
        pointRadius: values.length === 1 ? 6 : 5,
        pointHoverRadius: 7,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointBorder,
        pointBorderWidth: 2,
      },
    ];
    if (pointRoles) datasets[0].$pointRoles = pointRoles;
    if (smoothValues) {
      const smoothColor = seriesColor("smooth", colors);
      datasets.push({
        label: "Smoothed",
        data: smoothValues,
        borderColor: smoothColor,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.25,
        fill: false,
        spanGaps: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        pointBackgroundColor: smoothColor,
        pointBorderColor: pointBorder,
        pointBorderWidth: 2,
      });
    }

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: preferReducedMotion() ? false : { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: pluginsOpt,
        scales: {
          x: {
            ticks: {
              color: colors.text,
              maxRotation: 0,
              autoSkip: true,
              callback(val, i) {
                const iso = labels[i];
                if (!iso) return "";
                const d = new Date(iso + "T12:00:00");
                return d.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              },
            },
            grid: { color: colors.grid, drawBorder: false },
          },
          y: {
            ticks: { color: colors.text },
            grid: { color: colors.grid, drawBorder: false },
            suggestedMin,
            suggestedMax,
          },
        },
      },
      plugins: [refBandPlugin, deviceSwitchPlugin].filter((plugin) => {
        if (plugin === refBandPlugin) return !!refCfg;
        return !!(marker && marker.date);
      }),
    });
    chart.$colorRoles = smoothValues ? ["accent", "smooth"] : ["accent"];
    charts.push(chart);
    return chart;
  }

  function seriesColor(role, colors) {
    if (role === "fat") return "#f472b6";
    if (role === "risk") return colors.risk;
    if (role === "caution") return colors.caution;
    if (role === "smooth") {
      const light =
        document.documentElement.getAttribute("data-theme") === "light";
      return light ? "#0f766e" : "#e2e8f0";
    }
    return colors.accent;
  }

  function extentPad(values) {
    const nums = values.filter((v) => v != null && !Number.isNaN(Number(v)));
    if (!nums.length) return {};
    const lo = Math.min.apply(null, nums);
    const hi = Math.max.apply(null, nums);
    const pad = (hi - lo) * 0.12 || 1;
    return { suggestedMin: lo - pad, suggestedMax: hi + pad };
  }

  function makeFatLbmChart(scans) {
    const canvas = document.getElementById("chartFatLbm");
    if (!canvas || typeof Chart === "undefined") return null;
    const rows = (scans || []).filter((s) => s.fatMass != null || leanLb(s) != null);
    const labels = rows.map((s) => s.date);
    const fat = rows.map((s) => (s.fatMass == null ? null : s.fatMass));
    const lbm = rows.map((s) => leanLb(s));
    const colors = chartColors();
    const fatColor = seriesColor("fat", colors);
    const leanColor = seriesColor("lean", colors);
    const fatExtent = extentPad(fat);
    const lbmExtent = extentPad(lbm);
    const pointBorder = cssVar("--bg") || "#0f1419";
    const axisTitleFont = {
      family: "Inter, system-ui, sans-serif",
      size: 11,
      weight: "600",
    };

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Fat mass (lb)",
            data: fat,
            yAxisID: "y",
            borderColor: fatColor,
            backgroundColor: fatColor + "22",
            borderWidth: 2,
            tension: 0.25,
            fill: false,
            spanGaps: false,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: fatColor,
            pointBorderColor: pointBorder,
            pointBorderWidth: 2,
          },
          {
            label: "LBM (lb)",
            data: lbm,
            yAxisID: "y1",
            borderColor: leanColor,
            backgroundColor: leanColor + "22",
            borderWidth: 2,
            tension: 0.25,
            fill: false,
            spanGaps: false,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: leanColor,
            pointBorderColor: pointBorder,
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: preferReducedMotion() ? false : { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: colors.text,
              usePointStyle: true,
              boxWidth: 8,
              font: { family: "Inter, system-ui, sans-serif", size: 11 },
            },
          },
          tooltip: {
            filter(item) {
              return item.raw != null;
            },
            callbacks: {
              title(items) {
                const i = items[0].dataIndex;
                return fmt.date(labels[i]);
              },
              label(ctx) {
                if (ctx.raw == null) return null;
                return ctx.dataset.label + ": " + fmt.num(ctx.raw);
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: colors.text,
              maxRotation: 0,
              autoSkip: true,
              callback(val, i) {
                const iso = labels[i];
                if (!iso) return "";
                const d = new Date(iso + "T12:00:00");
                return d.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              },
            },
            grid: { color: colors.grid, drawBorder: false },
          },
          y: {
            type: "linear",
            position: "left",
            title: {
              display: true,
              text: "Fat mass (lb)",
              color: fatColor,
              font: axisTitleFont,
            },
            ticks: { color: colors.text },
            grid: { color: colors.grid, drawBorder: false },
            suggestedMin: fatExtent.suggestedMin,
            suggestedMax: fatExtent.suggestedMax,
          },
          y1: {
            type: "linear",
            position: "right",
            title: {
              display: true,
              text: "LBM (lb)",
              color: leanColor,
              font: axisTitleFont,
            },
            ticks: { color: colors.text },
            grid: { drawOnChartArea: false, drawBorder: false },
            suggestedMin: lbmExtent.suggestedMin,
            suggestedMax: lbmExtent.suggestedMax,
          },
        },
      },
    });
    chart.$colorRoles = ["fat", "lean"];
    chart.$axisRoles = { y: "fat", y1: "lean" };
    charts.push(chart);
    return chart;
  }

  function makeMultiLineChart(canvasId, series, extra) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    const digits = extra && extra.digits != null ? extra.digits : 1;
    const colors = chartColors();
    const pointBorder = cssVar("--bg") || "#0f1419";
    const dateSeen = Object.create(null);
    const labels = [];
    (series || []).forEach((s) => {
      (s.points || []).forEach((p) => {
        if (!dateSeen[p.x]) {
          dateSeen[p.x] = true;
          labels.push(p.x);
        }
      });
    });
    labels.sort();
    const roles = [];
    const datasets = (series || []).map((s) => {
      const byDate = Object.create(null);
      (s.points || []).forEach((p) => {
        byDate[p.x] = p.y;
      });
      const role = s.role || "accent";
      roles.push(role);
      const color = seriesColor(role, colors);
      const realCount = (s.points || []).length;
      return {
        label: s.label,
        data: labels.map((d) => (byDate[d] == null ? null : byDate[d])),
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 2,
        tension: 0.25,
        fill: false,
        spanGaps: false,
        pointRadius: realCount === 1 ? 6 : 4,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        pointBorderColor: pointBorder,
        pointBorderWidth: 2,
      };
    });
    const allVals = [];
    datasets.forEach((ds) => {
      ds.data.forEach((v) => {
        if (v != null && !Number.isNaN(Number(v))) allVals.push(Number(v));
      });
    });
    const ext = extentPad(allVals);

    const chart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: preferReducedMotion() ? false : { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: colors.text,
              usePointStyle: true,
              boxWidth: 8,
              font: { family: "Inter, system-ui, sans-serif", size: 11 },
            },
          },
          tooltip: {
            filter(item) {
              return item.raw != null;
            },
            callbacks: {
              title(items) {
                if (!items.length) return "";
                return fmt.date(labels[items[0].dataIndex]);
              },
              label(ctx) {
                if (ctx.raw == null) return null;
                return ctx.dataset.label + ": " + fmt.num(ctx.raw, digits);
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: colors.text,
              maxRotation: 0,
              autoSkip: true,
              callback(val, i) {
                const iso = labels[i];
                if (!iso) return "";
                const d = new Date(iso + "T12:00:00");
                return d.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              },
            },
            grid: { color: colors.grid, drawBorder: false },
          },
          y: {
            ticks: { color: colors.text },
            grid: { color: colors.grid, drawBorder: false },
            suggestedMin: ext.suggestedMin,
            suggestedMax: ext.suggestedMax,
          },
        },
      },
    });
    chart.$colorRoles = roles;
    charts.push(chart);
    return chart;
  }

  function refreshChartColors() {
    const colors = chartColors();
    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    const bandColor = isLight
      ? "rgba(13, 148, 136, 0.14)"
      : "rgba(94, 234, 212, 0.16)";
    const pointBorder = cssVar("--bg") || "#0f1419";
    charts.forEach((chart) => {
      if (!chart) return;
      if (chart.config.type === "doughnut") {
        const ds = chart.data.datasets[0];
        if (ds) ds.borderColor = pointBorder;
        chart.update(preferReducedMotion() ? "none" : undefined);
        return;
      }
      if (!chart.data.datasets.length || !chart.options.scales) return;
      const roles = chart.$colorRoles || [];
      chart.data.datasets.forEach((ds, i) => {
        const role = roles[i] || "accent";
        const color = seriesColor(role, colors);
        ds.borderColor = color;
        ds.pointBorderColor = pointBorder;
        if (ds.$pointRoles) {
          ds.pointBackgroundColor = ds.$pointRoles.map((pointRole) =>
            seriesColor(pointRole, colors)
          );
        } else {
          ds.pointBackgroundColor = color;
        }
        if (role === "smooth") {
          ds.backgroundColor = "transparent";
          ds.borderDash = [5, 4];
          ds.pointRadius = 0;
          ds.fill = false;
        } else {
          ds.backgroundColor = color + "22";
        }
      });
      const axisRoles = chart.$axisRoles || { y: roles[0] || "accent" };
      Object.keys(chart.options.scales).forEach((axisId) => {
        const scale = chart.options.scales[axisId];
        if (!scale) return;
        if (scale.ticks) scale.ticks.color = colors.text;
        if (scale.grid && axisId !== "y1") scale.grid.color = colors.grid;
        if (scale.title && scale.title.display) {
          scale.title.color = seriesColor(
            axisRoles[axisId] || "accent",
            colors
          );
        }
      });
      const legend = chart.options.plugins && chart.options.plugins.legend;
      if (legend && legend.labels) legend.labels.color = colors.text;
      if (chart.options.plugins && chart.options.plugins.refBands) {
        (chart.options.plugins.refBands.bands || []).forEach((b) => {
          b.color = bandColor;
        });
      }
      chart.update(preferReducedMotion() ? "none" : undefined);
    });
  }

  function renderCharts(data) {
    charts.length = 0;
    [
      "chartWeight",
      "chartBf",
      "chartFat",
      "chartVisceral",
      "chartLbm",
      "chartMuscle",
      "chartFatLbm",
      "chartWaist",
      "chartWhtr",
      "chartRfm",
      "chartFfmiFmi",
    ].forEach((id) => {
      const c = typeof Chart !== "undefined" ? Chart.getChart(id) : null;
      if (c) c.destroy();
    });

    const t = getTargets(data);
    const colors = chartColors();
    const device = viewDevice(data);
    const scopedAll = scansOnDevice(data.scans || [], device.id);
    const ranged = scansInRange(data.scans || [], chartRange);
    const scoped = scansInRange(scopedAll, chartRange);
    const fullN = fullScans(scopedAll).length;
    const switchOn = switchDate(data);
    const marker = switchOn ? { date: switchOn, label: "New scale" } : null;
    const gap = (subject) => deviceGapMessage(device, fullN, 2, subject);
    const smoothTrend = (key) => {
      if (fullN < 2) return gap("A smoothed trend");
      return trendRateNoteFrom(smoothPointsFor(scopedAll, key));
    };

    const weightPoints = seriesFor(ranged, "weight");
    const weightTrend =
      fullN < 2
        ? gap("A smoothed weight trend") +
          " The line is every logged weight. The marker is the scale switch, not a measurement."
        : trendRateNoteFrom(smoothPointsFor(scopedAll, "weight")) +
          " Smoothed on " +
          (device.label || "this scale") +
          " only. The marker is the scale switch.";
    setChartEmpty("chartWeight", null);
    makeLineChart("chartWeight", weightPoints, "Weight (lb)", null, {
      smooth: fullN < 2 ? null : smoothPointsFor(scopedAll, "weight"),
      colorByDevice: true,
      marker: marker,
    });
    setTrendNote("chartWeightTrend", weightTrend);

    const drawScoped = (canvasId, key, yLabel, refCfg, withSmooth) => {
      const points = seriesFor(scoped, key);
      if (!points.length) {
        setChartEmpty(canvasId, gap(yLabel));
        return gap(yLabel);
      }
      setChartEmpty(canvasId, null);
      const trend = withSmooth ? smoothTrend(key) : null;
      makeLineChart(canvasId, points, yLabel, refCfg, {
        smooth: withSmooth && fullN >= 2 ? smoothPointsFor(scopedAll, key) : null,
      });
      return trend;
    };

    drawScoped("chartBf", "bf", "Body fat %", {
      bands: [{ min: t.bfBandMin, max: t.bfBandMax }],
    });
    const fatTrend = drawScoped("chartFat", "fatMass", "Fat mass (lb)", null, true);
    setTrendNote("chartFatTrend", fatTrend);
    drawScoped("chartVisceral", "visceral", "Visceral", {
      bands: [{ min: 1, max: t.visceralHealthyMax }],
      lines: [
        {
          value: t.visceralExcess,
          label: "13",
          color: colors.caution,
        },
        {
          value: t.visceralHigherRisk,
          label: "15",
          color: colors.risk || "#f87171",
        },
      ],
    });
    const lbmTrend = drawScoped("chartLbm", "lbm", "Lean body mass (lb)", null, true);
    setTrendNote("chartLbmTrend", lbmTrend);
    drawScoped("chartMuscle", "muscleMass", "Muscle mass (lb)");
    setChartNote(
      "chartMuscleNote",
      device.id === "fitdays"
        ? "Fitdays+ only. Feb baseline muscle label is uncertain."
        : (device.label || "This scale") +
            " only. Not mixed with Fitdays+ muscle mass."
    );
    const fatLeanRows = scoped.filter(
      (s) => s.fatMass != null || leanLb(s) != null
    );
    if (!fatLeanRows.length) {
      setChartEmpty("chartFatLbm", gap("Fat mass vs LBM"));
    } else {
      setChartEmpty("chartFatLbm", null);
      makeFatLbmChart(scoped);
    }

    const height = subjectHeightIn(data);
    const sex = subjectSex(data);
    const targetWaist =
      height != null && t.whtrTarget != null ? height * t.whtrTarget : null;
    const waistPts = seriesFor(ranged, "waistIn").filter((p) =>
      Number.isFinite(Number(p.y))
    );
    const whtrPts = whtrSeries(ranged, height);
    setChartNote(
      "chartWaistNote",
      (waistPts.length
        ? "Saturday morning at the navel, relaxed exhale."
        : "No waist readings in this range.") +
        (targetWaist != null
          ? " Dashed line is the target waist (" +
            fmt.flex(targetWaist, 3) +
            " in)."
          : "") +
        " Only logged waist readings are plotted." +
        (switchOn
          ? " Vertical line marks the scale switch on " + fmt.date(switchOn) + "."
          : "")
    );
    setChartEmpty("chartWaist", null);
    makeLineChart(
      "chartWaist",
      waistPts,
      "Waist (in)",
      targetWaist != null
        ? {
            lines: [
              {
                value: targetWaist,
                label: fmt.flex(targetWaist, 3),
                color: colors.caution,
              },
            ],
          }
        : null,
      { digits: 3, marker: marker }
    );
    setChartNote(
      "chartWhtrNote",
      (whtrPts.length
        ? "Waist divided by height."
        : "No waist readings in this range.") +
        (t.whtrTarget != null
          ? " Dashed line is the goal (" + fmt.flex(t.whtrTarget, 3) + ")."
          : "") +
        " Only logged waist readings are plotted." +
        (switchOn
          ? " Vertical line marks the scale switch on " + fmt.date(switchOn) + "."
          : "")
    );
    setChartEmpty("chartWhtr", null);
    makeLineChart(
      "chartWhtr",
      whtrPts,
      "WHtR",
      t.whtrTarget != null
        ? {
            lines: [
              {
                value: t.whtrTarget,
                label: fmt.flex(t.whtrTarget, 3),
                color: colors.caution,
              },
            ],
          }
        : null,
      { digits: 3, marker: marker }
    );

    const rfmPts = rfmSeries(ranged, height, sex);
    const rfmBase = "Tape estimate · not DEXA · not BIA.";
    let rfmLead = "Only logged waist readings are plotted. ";
    if (rfmConstant(sex) == null) {
      rfmLead = "Needs sex logged as male or female. ";
    } else if (height == null) {
      rfmLead = "Needs a logged height. ";
    } else if (!rfmPts.length) {
      rfmLead = "No waist readings in this range. ";
    }
    setChartNote(
      "chartRfmNote",
      rfmLead +
        rfmBase +
        (switchOn ? " Vertical line marks the scale switch on " + fmt.date(switchOn) + "." : "")
    );
    setChartEmpty("chartRfm", null);
    makeLineChart("chartRfm", rfmPts, "RFM %", null, { digits: 1, marker: marker });

    const ffmiPts = [];
    const fmiPts = [];
    if (height != null) {
      scoped.forEach((s) => {
        const ff = ffmiOf(s, height);
        const fm = fmiOf(s, height);
        if (ff != null) ffmiPts.push({ x: s.date, y: ff });
        if (fm != null) fmiPts.push({ x: s.date, y: fm });
      });
    }
    const ffmiEmpty = height != null && !ffmiPts.length && !fmiPts.length;
    setChartNote(
      "chartFfmiNote",
      height == null
        ? "FFMI and FMI need a logged height. Nothing is estimated without it."
        : ffmiEmpty
          ? gap("FFMI and FMI")
          : "BIA-estimated trend from " +
            (device.label || "this scale") +
            " LBM and fat mass divided by height squared (" +
            fmt.flex(height, 3) +
            " in). Not DEXA. Other scales are not included. Scans missing LBM or fat mass are left blank."
    );
    if (ffmiEmpty) {
      setChartEmpty("chartFfmiFmi", gap("FFMI and FMI"));
    } else {
      setChartEmpty("chartFfmiFmi", null);
      makeMultiLineChart(
        "chartFfmiFmi",
        [
          { label: "FFMI (kg/m²)", role: "accent", points: ffmiPts },
          { label: "FMI (kg/m²)", role: "fat", points: fmiPts },
        ],
        { digits: 2 }
      );
    }


    // Accessible data summaries (screen-reader text derived from plotted points only)
    attachChartSummary(
      "chartWeight",
      seriesSummary(seriesFor(ranged, "weight"), "Weight in pounds", 1) +
        " " +
        weightTrend
    );
    const scopedOrGap = (key, label, digits) => {
      const points = seriesFor(scoped, key);
      if (!points.length) return gap(label);
      return seriesSummary(points, label, digits);
    };
    attachChartSummary("chartBf", scopedOrGap("bf", "Body fat percent", 1));
    attachChartSummary(
      "chartFat",
      scopedOrGap("fatMass", "Fat mass in pounds", 1) + " " + (fatTrend || "")
    );
    attachChartSummary("chartVisceral", scopedOrGap("visceral", "Visceral fat rating", 1));
    attachChartSummary(
      "chartLbm",
      scopedOrGap("lbm", "Lean body mass in pounds", 1) + " " + (lbmTrend || "")
    );
    attachChartSummary("chartMuscle", scopedOrGap("muscleMass", "Muscle mass in pounds", 1));
    attachChartSummary("chartWaist", seriesSummary(waistPts, "Waist in inches", 2));
    attachChartSummary("chartWhtr", seriesSummary(whtrPts, "Waist-to-height ratio", 3));
    attachChartSummary("chartRfm", seriesSummary(rfmPts, "Relative fat mass percent", 1));
    attachChartSummary(
      "chartFfmiFmi",
      seriesSummary(ffmiPts, "FFMI", 2) + " " + seriesSummary(fmiPts, "FMI", 2)
    );
    // Fat vs LBM dual chart
    const fatPts = seriesFor(scoped, "fatMass");
    const lbmPts = seriesFor(scoped, "lbm");
    attachChartSummary(
      "chartFatLbm",
      seriesSummary(fatPts, "Fat mass in pounds", 1) + " " + seriesSummary(lbmPts, "Lean body mass in pounds", 1)
    );

    renderComposition(data);
  }

  function renderTimeline(data) {
    const ol = document.getElementById("timeline");
    ol.innerHTML = "";
    const baseline = findScan(data.scans, BASELINE_ID);
    const ordered = (data.scans || [])
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const when = switchDate(data);
    let switchPlaced = false;
    const placeSwitch = () => {
      if (switchPlaced || !when) return;
      switchPlaced = true;
      const cur = currentDevice(data);
      const first = cur.firstOfficial ? fmt.date(cur.firstOfficial) : "the next morning";
      const li = document.createElement("li");
      li.className = "timeline-item device-switch";
      li.innerHTML =
        '<span class="timeline-dot" aria-hidden="true"></span>' +
        '<div class="timeline-date">' +
        fmt.date(when) +
        "</div>" +
        '<div class="timeline-label">Scale switch</div>' +
        '<div class="timeline-body"><p>Fitdays+ series closed. ' +
        escapeHtml(cur.label || "The new scale") +
        " starts with the " +
        escapeHtml(first) +
        " morning scan. The Nov 5, 2026 22:33 reading was an evening test and is not logged. Composition is not compared across this date.</p></div>";
      ol.appendChild(li);
    };

    ordered.forEach((s) => {
      if (when && s.date >= when) placeSwitch();
      const li = document.createElement("li");
      li.className = "timeline-item" + (s.partial ? " partial" : "");

      let body = "";
      if (s.partial && s.fatLossNote != null) {
        body = `<p class="timeline-body">Fat loss note: <strong>${fmt.num(
          s.fatLossNote
        )} lb</strong> vs February baseline only. Other fields not recorded.</p>`;
      } else {
        const bits = [];
        if (s.weight != null) bits.push(`Weight ${fmt.num(s.weight)} lb`);
        if (s.bf != null) bits.push(`BF ${fmt.num(s.bf)}%`);
        if (s.fatMass != null) {
          bits.push(
            `Fat mass ${fmt.num(s.fatMass)} lb${
              s.fatMassCalc ? " (calc)" : ""
            }`
          );
        }
        if (s.visceral != null) bits.push(`Visceral ${fmt.num(s.visceral)}`);
        if (s.bodyAge != null) bits.push(`Body age ${fmt.int(s.bodyAge)}`);
        if (s.lbm != null) bits.push(`LBM ${fmt.num(s.lbm)} lb`);
        else if (leanLb(s) != null) bits.push(`Fat-free ${fmt.num(leanLb(s))} lb`);
        if (s.heartRate != null) bits.push(`Scale heart rate ${fmt.int(s.heartRate)} bpm`);
        if (s.trunkMuscle != null || s.leftArmMuscle != null || s.leftLegMuscle != null) {
          bits.push("Segmental muscle and fat logged");
        }
        if (s.muscleMass != null) {
          bits.push(
            `Muscle ${fmt.num(s.muscleMass)} lb${
              s.labelUncertain || s.muscleMassApprox ? " (label uncertain)" : ""
            }`
          );
        }
        if (s.waistIn != null && Number.isFinite(Number(s.waistIn))) {
          const height = subjectHeightIn(data);
          const ratio = whtrOf(s, height);
          const rfm = rfmOf(s, height, subjectSex(data));
          bits.push(
            "Waist " +
              fmt.flex(Number(s.waistIn), 3) +
              " in" +
              (ratio != null ? " · WHtR " + fmt.num(ratio, 3) : "") +
              (rfm != null ? " · RFM " + fmt.num(rfm, 1) + "%" : "")
          );
        }
        if (
          baseline &&
          s.id !== baseline.id &&
          scanDeviceId(s) === scanDeviceId(baseline) &&
          s.weight != null &&
          baseline.weight != null
        ) {
          const dw = s.weight - baseline.weight;
          const df = s.fatMass != null && baseline.fatMass != null
            ? s.fatMass - baseline.fatMass
            : null;
          bits.push(
            `Δ weight ${fmt.signed(dw)} lb` +
              (df != null ? `, Δ fat ${fmt.signed(df)} lb` : "")
          );
        }
        body = `<ul>${bits.map((b) => `<li>${b}</li>`).join("")}</ul>`;
      }

      li.innerHTML = `
        <span class="timeline-dot" aria-hidden="true"></span>
        <div class="timeline-date">${fmt.date(s.date)}${
          parseClock(s.scanTime) ? " · " + escapeHtml(parseClock(s.scanTime).text) : ""
        }</div>
        <div class="timeline-label">${escapeHtml(s.label || "Scan")}${
        s.partial ? '<span class="badge">Partial</span>' : ""
      }<span class="timeline-device">${escapeHtml(
        deviceById(data, scanDeviceId(s)).label || scanDeviceId(s)
      )}</span></div>
        <div class="timeline-body">${body}</div>
      `;
      ol.appendChild(li);
    });
    placeSwitch();
  }

  function renderGoals(data) {
    const list = document.getElementById("goalList");
    list.innerHTML = "";
    (data.goals.items || []).forEach((g) => {
      const li = document.createElement("li");
      li.textContent = g;
      list.appendChild(li);
    });
    const note = document.getElementById("goalsNote");
    note.textContent = (data.goals.notes || []).join(" ");

    const ref = document.getElementById("visceralRef");
    const vr = data.meta.visceralReference;
    ref.innerHTML = `
      <li><span class="ref-swatch good" aria-hidden="true"></span><span><strong>${vr.healthy}</strong> — healthy range</span></li>
      <li><span class="ref-swatch caution" aria-hidden="true"></span><span><strong>${vr.excess}</strong> — excess</span></li>
      <li><span class="ref-swatch risk" aria-hidden="true"></span><span><strong>${vr.higherRisk}</strong> — higher-risk</span></li>
    `;
    document.getElementById("visceralNote").textContent = vr.note || "";

    if (data.meta.disclaimer) {
      document.getElementById("footerDisclaimer").textContent =
        data.meta.disclaimer;
    }

    const titleEl = document.getElementById("siteTitle");
    const subEl = document.getElementById("siteSubtitle");
    if (titleEl && data.meta.title) titleEl.textContent = data.meta.title;
    if (subEl && data.meta.subtitle) subEl.textContent = data.meta.subtitle;
    if (data.meta.title) document.title = data.meta.title;

    const copy = data.meta.copyright || "© 2026 Brandon Carroll. All rights reserved.";
    const rights = data.meta.rights || "";
    const footerCopy = document.getElementById("footerCopyright");
    if (footerCopy) footerCopy.textContent = copy;
    const footerDevice = document.getElementById("footerDevice");
    if (footerDevice) {
      const subject = data.meta.subject || {};
      const cur = currentDevice(data);
      const bits = [];
      if (subject.sex) {
        bits.push(subject.sex.charAt(0).toUpperCase() + subject.sex.slice(1));
      }
      if (subject.age != null) bits.push(String(subject.age));
      bits.push(
        (cur.label || cur.id) + (cur.from ? " from " + fmt.date(cur.from) : "")
      );
      deviceCatalog(data).forEach((d) => {
        if (d.id === cur.id) return;
        bits.push((d.label || d.id) + (d.through ? " through " + fmt.date(d.through) : ""));
      });
      bits.push("Data from data.json");
      footerDevice.textContent = bits.join(" · ");
    }

    const copyLine = document.getElementById("copyrightLine");
    if (copyLine) copyLine.innerHTML = "<strong>" + copy + "</strong>";
    const rightsLine = document.getElementById("rightsLine");
    if (rightsLine && rights) {
      rightsLine.textContent =
        (data.meta.title || "This site") +
        " — including design, text, charts, metrics, and underlying data — is proprietary personal property. " +
        rights;
    }
  }


  function renderConsistency(data) {
    const chip = document.getElementById("consistencyChip");
    if (!chip) return;
    const device = viewDevice(data);
    const scoped = scansOnDevice(data.scans || [], device.id);
    const full = fullScans(scoped);
    const latest = latestFullScan(scoped);
    const n = full.length;
    const days = latest ? daysSince(latest.date) : null;
    let daysTxt = "no scan yet";
    if (days != null) {
      if (days === 0) daysTxt = "today";
      else if (days === 1) daysTxt = "1 day ago";
      else daysTxt = days + " days ago";
    }
    chip.textContent =
      (device.label || "Scale") +
      " · " +
      n +
      " full scan" +
      (n === 1 ? "" : "s") +
      " · " +
      daysTxt;
    chip.title =
      (device.label || "This scale") +
      " full scans (non-partial with weight): " +
      n +
      ". Last full scan on this scale: " +
      (latest ? fmt.date(latest.date) : "none yet") +
      ". Other scales are not included.";
  }

  function lbmFullScans(scans) {
    return fullScans(scans)
      .map((s, i) => ({ s: s, i: i }))
      .filter(({ s }) => leanLb(s) != null)
      .sort((a, b) => {
        if (String(a.s.date) < String(b.s.date)) return -1;
        if (String(a.s.date) > String(b.s.date)) return 1;
        return a.i - b.i;
      })
      .map(({ s }) => s);
  }

  function fatStillDropping(older, mid, latest) {
    const keys = ["fatMass", "bf"];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const a = numericField(older, key);
      const b = numericField(mid, key);
      const c = numericField(latest, key);
      if (a == null || b == null || c == null) continue;
      return c < b && c < a;
    }
    return false;
  }

  function renderLeanDecline(data) {
    const root = document.getElementById("leanDecline");
    if (!root) return;
    root.hidden = true;
    root.innerHTML = "";
    const device = viewDevice(data);
    const pool = lbmFullScans(scansOnDevice(data.scans || [], device.id));
    if (pool.length < 3) return;
    const older = pool[pool.length - 3];
    const mid = pool[pool.length - 2];
    const latest = pool[pool.length - 1];
    const a = leanLb(older);
    const b = leanLb(mid);
    const c = leanLb(latest);
    if (a == null || b == null || c == null || !(b < a && c < b)) return;
    const priority = fatStillDropping(older, mid, latest)
      ? "Preserving lean is the priority while fat is still dropping."
      : "Preserving lean is the priority.";
    const line =
      fmt.date(older.date) +
      " LBM " +
      fmt.num(a, 1) +
      " lb → " +
      fmt.date(mid.date) +
      " " +
      fmt.num(b, 1) +
      " lb → " +
      fmt.date(latest.date) +
      " " +
      fmt.num(c, 1) +
      " lb.";
    root.hidden = false;
    root.innerHTML =
      "<h3>Lean mass is down two full scans in a row</h3>" +
      '<p class="lean-values">' +
      line +
      "</p>" +
      "<p>" +
      priority +
      "</p>" +
      '<p class="lean-note">Not medical advice.</p>';
  }

  function renderWhatMoved(data) {
    const root = document.getElementById("whatMoved");
    if (!root) return;
    root.hidden = true;
    root.innerHTML = "";
    const device = viewDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const latest = latestFullScan(scans);
    const prev = latest ? previousFullScan(scans, latest) : null;
    const fullN = fullScans(scans).length;
    if (!latest || !prev || prev.id === latest.id) {
      root.hidden = false;
      root.innerHTML =
        "<h3>What moved since the prior full scan</h3>" +
        '<p class="moved-caveat">' +
        escapeHtml(deviceGapMessage(device, fullN, 2, "What moved")) +
        "</p>";
      return;
    }
    const specs = [
      {
        key: "weight",
        label: "Weight",
        unit: "lb",
        digits: 1,
        lowerBetter: true,
      },
      {
        key: "fatMass",
        label: "Fat mass",
        unit: "lb",
        digits: 1,
        lowerBetter: true,
      },
      {
        key: "lbm",
        label: "LBM",
        unit: "lb",
        digits: 1,
        lowerBetter: false,
      },
      {
        key: "visceral",
        label: "Visceral",
        unit: "",
        digits: 1,
        lowerBetter: true,
      },
    ];
    const rows = [];
    specs.forEach((spec) => {
      const cur = metricValue(latest, spec.key);
      const prior = metricValue(prev, spec.key);
      if (cur == null || prior == null) return;
      const info = deltaInfo(cur, prior, {
        lowerBetter: spec.lowerBetter,
        digits: spec.digits,
        eps: 0.05,
      });
      if (!info) return;
      const unit = spec.unit ? " " + spec.unit : "";
      const from = fmt.num(prior, spec.digits);
      const to = fmt.num(cur, spec.digits);
      rows.push(
        '<div class="moved-item">' +
          '<span class="mlabel">' +
          escapeHtml(spec.label) +
          "</span>" +
          '<span class="mvalue delta ' +
          info.tone +
          '">' +
          info.text +
          unit +
          "</span>" +
          '<span class="mdetail">' +
          from +
          " → " +
          to +
          "</span>" +
          "</div>"
      );
    });
    if (!rows.length) return;
    root.hidden = false;
    root.innerHTML =
      "<h3>What moved since the prior full scan</h3>" +
      '<p class="moved-dates">' +
      fmt.date(prev.date) +
      " → " +
      fmt.date(latest.date) +
      " · " +
      escapeHtml(device.label || "") +
      "</p>" +
      '<div class="moved-grid">' +
      rows.join("") +
      "</div>" +
      '<p class="moved-caveat">BIA moves with hydration/timing — illustrative only.</p>';
  }

  function renderScanTimeNote(data, latest) {
    const el = document.getElementById("scanTimeNote");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    const clock = parseClock(latest && latest.scanTime);
    const targets = (data && data.goals && data.goals.targets) || {};
    const target = parseClock(targets.scanTimeTarget);
    if (!clock || !target || clock.minutes <= target.minutes) return;
    el.hidden = false;
    el.textContent =
      "Latest scan was at " +
      clock.text +
      ", after the " +
      target.text +
      " target. BIA readings vary with time of day and hydration, so compare like-for-like.";
  }

  function lossDeltaItem(label, delta, start, end, unit, caution) {
    const missing = delta == null;
    const unitTxt = unit ? " " + unit : "";
    const value = missing ? "—" : fmt.signed(delta, 1) + unitTxt;
    const detail = missing
      ? "Not on both scans"
      : fmt.num(start, 1) + " → " + fmt.num(end, 1);
    return (
      '<div class="moved-item">' +
      '<span class="mlabel">' +
      escapeHtml(label) +
      "</span>" +
      '<span class="mvalue' +
      (caution ? " delta caution" : "") +
      '">' +
      value +
      "</span>" +
      '<span class="mdetail">' +
      escapeHtml(detail) +
      "</span>" +
      "</div>"
    );
  }

  function lossWindowCard(spec) {
    if (spec.empty) {
      return (
        '<article class="card card-pad loss-window">' +
        "<h3>" +
        escapeHtml(spec.title) +
        "</h3>" +
        '<p class="loss-note">' +
        escapeHtml(spec.empty) +
        "</p>" +
        "</article>"
      );
    }
    const start = spec.start;
    const end = spec.end;
    const w0 = numericField(start, "weight");
    const w1 = numericField(end, "weight");
    const f0 = numericField(start, "fatMass");
    const f1 = numericField(end, "fatMass");
    const l0 = leanLb(start);
    const l1 = leanLb(end);
    const weightDelta = w0 != null && w1 != null ? w1 - w0 : null;
    const fatDelta = f0 != null && f1 != null ? f1 - f0 : null;
    const lbmDelta = l0 != null && l1 != null ? l1 - l0 : null;
    const days = daysBetween(start.date, end.date);
    let mode = "missing-weight";
    if (weightDelta == null) mode = "missing-weight";
    else if (Math.abs(weightDelta) < WEIGHT_FLAT_LB) mode = "flat";
    else if (weightDelta < 0) mode = "loss";
    else mode = "gain";
    const canSplit = mode === "loss" || mode === "gain";
    const fatShare =
      canSplit && fatDelta != null ? fatDelta / weightDelta : null;
    const leanShare =
      canSplit && lbmDelta != null ? lbmDelta / weightDelta : null;
    const bothShares =
      fatShare != null &&
      fatShare >= 0 &&
      leanShare != null &&
      leanShare >= 0;
    const flag =
      !!spec.flag &&
      mode === "loss" &&
      leanShare != null &&
      leanShare > LEAN_LOSS_SHARE_FLAG;

    let split;
    if (mode === "flat") {
      split =
        "Weight was flat, so there is no loss to split into fat and lean.";
    } else if (mode === "missing-weight") {
      split =
        "Weight isn't on both scans, so this window isn't split into fat and lean.";
    } else if (mode === "gain") {
      split = "Weight went up, so this window is a gain rather than a loss.";
      if (bothShares) {
        split +=
          " Of the gain, " +
          fmt.num(fatShare * 100, 1) +
          "% was fat mass and " +
          fmt.num(leanShare * 100, 1) +
          "% was lean mass.";
      } else if (fatDelta == null || lbmDelta == null) {
        split +=
          " A field is missing on one of the scans, so the gain isn't split further.";
      } else {
        split +=
          " Fat and lean didn't both rise with the scale, so the gain isn't split into shares.";
      }
    } else if (bothShares) {
      split =
        "Of the loss, " +
        fmt.num(fatShare * 100, 1) +
        "% was fat mass and " +
        fmt.num(leanShare * 100, 1) +
        "% was lean mass.";
    } else if (fatDelta == null || lbmDelta == null) {
      split =
        "A fat or lean field is missing on one of the scans, so the loss isn't split into shares.";
    } else if (lbmDelta > 0 && fatDelta < 0) {
      split =
        "Fat mass fell and lean mass rose, so the scale loss wasn't a split of both going down.";
    } else if (fatDelta > 0 && lbmDelta < 0) {
      split =
        "Lean mass fell and fat mass rose, so this wasn't a fat-led loss.";
    } else {
      split =
        "Fat and lean didn't both fall with the scale, so the loss isn't split into shares.";
    }

    let flagText = "";
    if (flag) {
      flagText = bothShares
        ? "Lean mass was " +
          fmt.num(leanShare * 100, 1) +
          "% of the weight lost in this window, above 25%. A larger lean share on a short window can come from a fast drop, hydration, or the time of day. Not a diagnosis."
        : "Lean mass made up more of this weight loss than the 25% line for a 4-week window. A larger lean share can come from a fast drop, hydration, or the time of day. Not a diagnosis.";
    }
    const dayLabel = days === 1 ? "1 day" : days + " days";
    const dates =
      fmt.date(start.date) +
      " → " +
      fmt.date(end.date) +
      " · " +
      dayLabel +
      (spec.hint ? " · " + spec.hint : "");
    const note = bothShares
      ? "Shares are each change divided by the weight change. They are not adjusted to total 100%. Logged fields only."
      : "Logged weight, fat mass, and lean body mass only. Nothing here is estimated.";

    return (
      '<article class="card card-pad loss-window' +
      (flag ? " is-caution" : "") +
      '">' +
      "<h3>" +
      escapeHtml(spec.title) +
      "</h3>" +
      '<p class="loss-dates">' +
      escapeHtml(dates) +
      "</p>" +
      '<div class="moved-grid">' +
      lossDeltaItem("Weight", weightDelta, w0, w1, "lb", false) +
      lossDeltaItem("Fat mass", fatDelta, f0, f1, "lb", false) +
      lossDeltaItem("Lean mass", lbmDelta, l0, l1, "lb", flag) +
      "</div>" +
      '<p class="loss-split">' +
      escapeHtml(split) +
      "</p>" +
      (flagText
        ? '<p class="loss-flag">' + escapeHtml(flagText) + "</p>"
        : "") +
      '<p class="loss-note">' +
      escapeHtml(note) +
      "</p>" +
      "</article>"
    );
  }

  function renderLossQuality(data) {
    const root = document.getElementById("lossQuality");
    const section = document.getElementById("lossQualitySection");
    if (!root) return;
    const device = viewDevice(data);
    const scans = scansOnDevice((data && data.scans) || [], device.id);
    const latest = latestFullScan(scans);
    const fullN = fullScans(scans).length;
    if (!latest || numericField(latest, "weight") == null || latest.partial || fullN < 2) {
      root.innerHTML = lossWindowCard({
        title: "Loss quality",
        empty: deviceGapMessage(device, fullN, 2, "Loss quality"),
      });
      if (section) section.hidden = false;
      return;
    }
    const peak = peakWeightScan(scans);
    const prior = nearestFullBefore(scans, latest, TREND_WINDOW_DAYS);
    const cards = [];
    if (!peak || peak.id === latest.id) {
      cards.push(
        lossWindowCard({
          title: "From the peak full scan",
          empty:
            "The latest full scan is the heaviest, so there is no drop from an earlier peak.",
        })
      );
    } else {
      cards.push(
        lossWindowCard({
          title: "From the peak full scan",
          start: peak,
          end: latest,
          hint: "highest weight among full scans",
          flag: false,
        })
      );
    }
    if (!prior) {
      cards.push(
        lossWindowCard({
          title: "Last ~4 weeks",
          empty: "No earlier full scan to compare with the latest one.",
        })
      );
    } else {
      cards.push(
        lossWindowCard({
          title: "Last ~4 weeks",
          start: prior,
          end: latest,
          hint: "nearest full scan to 28 days earlier",
          flag: true,
        })
      );
    }
    root.innerHTML = cards.join("");
    if (section) section.hidden = false;
  }

  function renderGoalProgress(data) {
    renderLeanDecline(data);
    const root = document.getElementById("goalProgressBars");
    if (!root) return;
    const t = getTargets(data);
    const device = viewDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const baseline = deviceBaseline(scans, device);
    const latest = latestFullScan(scans);
    const fullN = fullScans(scans).length;
    root.innerHTML = "";

    if (!latest || fullN < 2) {
      const note = document.createElement("p");
      note.className = "device-gap";
      note.textContent = deviceGapMessage(
        device,
        fullN,
        2,
        "Body-fat, visceral, fat-mass, and lean-floor progress"
      );
      root.appendChild(note);
    } else if (latest.bf != null) {
      const bf = latest.bf;
      const upper = t.bfUpperTarget;
      const stretch = t.bfStretch;
      const start = baseline && baseline.bf != null ? baseline.bf : bf;
      const span = Math.max(start - upper, 0.001);
      const progressed = Math.max(0, Math.min(1, (start - bf) / span));
      const distUpper = bf - upper;
      const distStretch = bf - stretch;
      const inBand = bf >= t.bfBandMin && bf <= t.bfBandMax;
      const fillClass = inBand ? "good" : bf <= 25 ? "caution" : "risk";
      const item = document.createElement("div");
      item.className = "progress-item";
      item.innerHTML = `
        <h4>Body fat % → ${t.bfBandMin}–${t.bfBandMax}% band</h4>
        <div class="progress-meta">
          <span>Now ${fmt.num(bf)}%</span>
          <span>${
            inBand
              ? "In goal band"
              : fmt.num(Math.max(distUpper, 0)) + " pp to " + upper + "% upper"
          }</span>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(
          progressed * 100
        )}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward ${upper}% BF">
          <div class="progress-fill ${fillClass}" style="width:${(
            progressed * 100
          ).toFixed(1)}%"></div>
        </div>
        <p class="progress-sub">${
          inBand
            ? "Within 15–20% goal band."
            : distUpper > 0
              ? fmt.num(distUpper) +
                " percentage points above " +
                upper +
                "% upper target · " +
                fmt.num(distStretch) +
                " pp above " +
                stretch +
                "% stretch"
              : "At or below upper target; stretch is " + stretch + "%."
        }</p>
      `;
      root.appendChild(item);
    }

    if (latest && fullN >= 2 && latest.visceral != null) {
      const v = latest.visceral;
      const maxH = t.visceralHealthyMax;
      const start =
        baseline && baseline.visceral != null ? baseline.visceral : v;
      const span = Math.max(start - maxH, 0.001);
      const progressed = Math.max(0, Math.min(1, (start - v) / span));
      const dist = v - maxH;
      const ok = v <= maxH;
      const fillClass = ok ? "good" : v < 15 ? "caution" : "risk";
      const item = document.createElement("div");
      item.className = "progress-item";
      item.innerHTML = `
        <h4>Visceral → ≤${maxH} healthy</h4>
        <div class="progress-meta">
          <span>Now ${fmt.num(v)}</span>
          <span>${
            ok ? "In healthy range" : fmt.num(dist) + " above ≤" + maxH
          }</span>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(
          progressed * 100
        )}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward visceral ≤${maxH}">
          <div class="progress-fill ${fillClass}" style="width:${(
            progressed * 100
          ).toFixed(1)}%"></div>
        </div>
        <p class="progress-sub">${
          ok
            ? "At or below healthy threshold."
            : "Need " +
              fmt.num(dist) +
              " rating points to reach ≤" +
              maxH +
              "."
        }</p>
      `;
      root.appendChild(item);
    }

    if (latest && fullN >= 2 && latest.fatMass != null && baseline && baseline.fatMass != null) {
      const lost = baseline.fatMass - latest.fatMass;
      const barPct =
        lost > 0
          ? Math.min(
              100,
              (lost / Math.max(baseline.fatMass * 0.35, 1)) * 100
            ).toFixed(1)
          : 0;
      const item = document.createElement("div");
      item.className = "progress-item";
      item.innerHTML = `
        <h4>Fat mass vs ${
          baseline.id === BASELINE_ID ? "Feb baseline" : "first scan on this scale"
        }</h4>
        <div class="progress-meta">
          <span>${
            baseline.id === BASELINE_ID ? "Feb" : fmt.date(baseline.date)
          } ${fmt.num(baseline.fatMass)} lb → now ${fmt.num(
            latest.fatMass
          )} lb</span>
          <span>${
            lost > 0
              ? fmt.num(lost) + " lb lost"
              : lost < 0
                ? fmt.num(-lost) + " lb gained"
                : "No change"
          }</span>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${
          lost > 0
            ? Math.min(
                100,
                Math.round((lost / Math.max(baseline.fatMass, 1)) * 100)
              )
            : 0
        }" aria-valuemin="0" aria-valuemax="100" aria-label="Fat mass lost vs February">
          <div class="progress-fill ${
            lost > 0 ? "good" : "caution"
          }" style="width:${barPct}%"></div>
        </div>
        <p class="progress-sub">Δ fat mass ${fmt.signed(
          latest.fatMass - baseline.fatMass
        )} lb since ${fmt.date(baseline.date)}.</p>
      `;
      root.appendChild(item);
    }

    const leanMetric = t.leanMetric || "lbm";
    const leanGain = t.leanGainLb != null ? t.leanGainLb : 20;
    const floorScan = latest && fullN >= 2 ? leanFloorScan(scans, t) : null;
    const leanNow = !latest
      ? null
      : metricValue(latest, leanMetric) != null
        ? metricValue(latest, leanMetric)
        : numericField(latest, "muscleMass");
    const floorValue = floorScan ? metricValue(floorScan, leanMetric) : null;
    if (leanNow != null && floorValue != null) {
      const floor = floorValue;
      const target = floor + leanGain;
      const gained = leanNow - floor;
      const progressed = Math.max(0, Math.min(1, gained / leanGain));
      const remaining = Math.max(0, target - leanNow);
      const fillClass =
        gained >= leanGain ? "good" : gained > 0 ? "caution" : "risk";
      const metricLabel = leanMetric === "lbm" ? "LBM" : "Muscle mass";
      const item = document.createElement("div");
      item.className = "progress-item";
      item.innerHTML = `
        <h4>Lean mass → +${leanGain} lb from cut floor</h4>
        <div class="progress-meta">
          <span>Floor ${fmt.num(floor)} → target ${fmt.num(
            target
          )} · now ${fmt.num(leanNow)} ${metricLabel}</span>
          <span>${
            gained >= 0
              ? fmt.num(gained) + " / " + leanGain + " lb gained"
              : fmt.num(-gained) + " lb below floor"
          }</span>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(
          progressed * 100
        )}" aria-valuemin="0" aria-valuemax="100" aria-label="Lean mass gain toward +${leanGain} lb">
          <div class="progress-fill ${fillClass}" style="width:${(
            progressed * 100
          ).toFixed(1)}%"></div>
        </div>
        <p class="progress-sub">Floor is the lowest ${metricLabel} since ${
          t.cutStart ? fmt.date(t.cutStart) : "baseline"
        } (${fmt.date(floorScan.date)}). ${
          remaining > 0
            ? fmt.num(remaining) + " lb still needed to hit +" + leanGain + "."
            : "At or above +" + leanGain + " from floor."
        } Cut-phase losses sit below the gain goal until rebuild starts.</p>
      `;
      root.appendChild(item);
    }

    renderWhtrProgress(data, root, t);
  }

  function datedFullScans(scans) {
    return fullScans(scans)
      .filter((s) => s && s.date && numericField(s, "weight") != null)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** Full scans from the same anchor smoothedWindowRate would pick. */
  function recentScanWindow(scans, windowDays) {
    const full = datedFullScans(scans);
    if (full.length < 2) return [];
    const latest = full[full.length - 1];
    const target = shiftIso(latest.date, -windowDays);
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < full.length - 1; i++) {
      const dist = Math.abs(daysBetween(target, full[i].date));
      if (
        dist < bestDist ||
        (dist === bestDist && best && full[i].date < best.date)
      ) {
        bestDist = dist;
        best = full[i];
      }
    }
    if (!best) return [];
    return full.filter((s) => s.date >= best.date);
  }

  /**
   * EWMA fit only on this window, so a plateau is not hidden by earlier loss
   * still inside the 21-day half-life. Same smoother as the chart trend.
   */
  function localSmoothedRate(scansInWindow, key) {
    const pts = (scansInWindow || [])
      .filter((s) => metricValue(s, key) != null)
      .map((s) => ({ x: s.date, y: metricValue(s, key) }));
    const smooth = ewmaSeries(pts);
    if (smooth.length < 2) return null;
    const from = smooth[0];
    const to = smooth[smooth.length - 1];
    const days = daysBetween(from.x, to.x);
    if (!(days > 0)) return null;
    return {
      from: from,
      to: to,
      days: days,
      perWeek: ((to.y - from.y) / days) * 7,
      count: pts.length,
    };
  }

  function weightGoals(t) {
    const out = [];
    if (t.checkpointWeightLb != null) {
      out.push({
        lb: t.checkpointWeightLb,
        name: fmt.num(t.checkpointWeightLb, 0) + " lb checkpoint",
      });
    }
    if (t.goalWeightLb != null) {
      out.push({
        lb: t.goalWeightLb,
        name: fmt.num(t.goalWeightLb, 0) + " lb goal",
      });
    }
    return out;
  }

  function projectionClause(rate, goals) {
    const current = rate.to.y;
    const losing = rate.perWeek < -PACE_FLAT_LB_PER_WEEK;
    const rising = rate.perWeek > PACE_FLAT_LB_PER_WEEK;
    const head =
      fmt.signed(rate.perWeek, 2) +
      " lb/week (" +
      fmt.date(rate.from.x) +
      " → " +
      fmt.date(rate.to.x) +
      ", " +
      rate.days +
      " days)";
    if (!losing) {
      const open = goals.filter((g) => current - g.lb > 0.05);
      const reached = goals.filter((g) => current - g.lb <= 0.05);
      const bits = [];
      if (open.length) {
        bits.push(
          (rising ? "Rising" : "Flat") +
            " — not closing on " +
            open.map((g) => g.name).join(" or ") +
            " at this rate."
        );
      }
      reached.forEach((g) => {
        bits.push("Already at or under " + g.name + ".");
      });
      return head + ". " + bits.join(" ");
    }
    const bits = goals.map((g) => {
      if (current - g.lb <= 0.05) {
        return "Already at or under " + g.name + ".";
      }
      const weeks = Math.max(
        1,
        Math.round((current - g.lb) / -rate.perWeek)
      );
      const eta = shiftIso(rate.to.x, weeks * 7);
      return (
        g.name +
        " in ~" +
        weeks +
        " " +
        (weeks === 1 ? "week" : "weeks") +
        " (around " +
        fmt.date(eta) +
        ")"
      );
    });
    return head + ": " + bits.join("; ") + ".";
  }

  function longerPaceLabel(rate, cutStart) {
    if (cutStart && Math.abs(daysBetween(cutStart, rate.from.x)) <= 14) {
      if (rate.days >= 70 && rate.days <= 105) return "Since cut (~12 weeks)";
      return "Since cut";
    }
    return "~12 weeks";
  }

  function stallNote(scans, longerRate) {
    const windowScans = recentScanWindow(scans, TREND_WINDOW_DAYS);
    if (windowScans.length < STALL_MIN_SCANS) return null;
    const weight = localSmoothedRate(windowScans, "weight");
    const fat = localSmoothedRate(windowScans, "fatMass");
    if (!weight || !fat) return null;
    if (weight.count < STALL_MIN_SCANS || fat.count < STALL_MIN_SCANS) return null;
    if (weight.days < STALL_MIN_DAYS || fat.days < STALL_MIN_DAYS) return null;
    if (Math.abs(weight.perWeek) >= STALL_LB_PER_WEEK) return null;
    if (Math.abs(fat.perWeek) >= STALL_LB_PER_WEEK) return null;
    const lean = localSmoothedRate(windowScans, "lbm");
    const weeks = Math.max(1, Math.round(weight.days / 7));
      let text =
      "Trend flat for " +
      weeks +
      " " +
      (weeks === 1 ? "week" : "weeks") +
      ". On these scans, smoothed weight is " +
      fmt.signed(weight.perWeek, 2) +
      " lb/week and fat mass is " +
      fmt.signed(fat.perWeek, 2) +
      " lb/week (" +
      fmt.date(weight.from.x) +
      " → " +
      fmt.date(weight.to.x) +
      ", " +
      weight.count +
      " full scans).";
    if (longerRate) {
      text +=
        " Longer-run smoothed weight is " +
        fmt.signed(longerRate.perWeek, 2) +
        " lb/week (" +
        fmt.date(longerRate.from.x) +
        " → " +
        fmt.date(longerRate.to.x) +
        ").";
    }
    if (lean && lean.count >= 2 && lean.perWeek > -STALL_LB_PER_WEEK) {
      text +=
        " Lean mass is holding (" +
        fmt.signed(lean.perWeek, 2) +
        " lb/week).";
    } else if (lean && lean.count >= 2) {
      text +=
        " Lean mass smoothed rate is " +
        fmt.signed(lean.perWeek, 2) +
        " lb/week over the same span.";
    }
    return text;
  }

  function renderGoalPace(data, t, root) {
    const device = viewDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const goals = weightGoals(t);
    const fullN = datedFullScans(scans).length;
    const weightSmooth = smoothPointsFor(scans, "weight");
    const recent = fullN >= 2 ? smoothedWindowRate(weightSmooth, TREND_WINDOW_DAYS) : null;
    const longer =
      fullN >= 2
        ? smoothedWindowRate(weightSmooth, LONG_TREND_WINDOW_DAYS, t.cutStart)
        : null;
    const windowScans = recentScanWindow(scans, TREND_WINDOW_DAYS);
    const stallWeight = localSmoothedRate(windowScans, "weight");
    const stallFat = localSmoothedRate(windowScans, "fatMass");
    const stallReady =
      fullN >= STALL_MIN_SCANS &&
      stallWeight &&
      stallFat &&
      stallWeight.count >= STALL_MIN_SCANS &&
      stallFat.count >= STALL_MIN_SCANS &&
      stallWeight.days >= STALL_MIN_DAYS &&
      stallFat.days >= STALL_MIN_DAYS;
    const stall = stallReady ? stallNote(scans, longer) : null;
    if (!stall && !stallReady && !(goals.length && (recent || longer)) && !goals.length) {
      return null;
    }

    const block = document.createElement("div");
    block.className = "pace-goal";
    const summary = [];

    if (stall) {
      const note = document.createElement("p");
      note.className = "pace-stall";
      note.textContent = stall;
      block.appendChild(note);
      summary.push(stall);
    } else if (!stallReady) {
      const note = document.createElement("p");
      note.className = "pace-stall";
      note.textContent =
        deviceGapMessage(device, fullN, STALL_MIN_SCANS, "The stall check") +
        " It also needs a 28-day span on this scale.";
      block.appendChild(note);
      summary.push(note.textContent);
    }

    if (goals.length && (recent || longer)) {
      const heading = document.createElement("h4");
      heading.textContent = "Goal weight from the smoothed trend";
      block.appendChild(heading);
      const levelRate = recent || longer;
      const kicker = document.createElement("p");
      kicker.className = "pace-kicker";
      kicker.textContent =
        "Estimate from home BIA scans. Smoothed weight " +
        fmt.num(levelRate.to.y, 1) +
        " lb on " +
        fmt.date(levelRate.to.x) +
        " (dashed line on the weight chart). Dates assume that rate continues, including when recent scans are flat.";
      block.appendChild(kicker);
      summary.push(kicker.textContent);

      [
        { label: "Smoothed series, ~4 weeks", rate: recent },
        {
          label: longer ? longerPaceLabel(longer, t.cutStart) : "",
          rate: longer,
        },
      ].forEach((row) => {
        if (!row.rate) return;
        const p = document.createElement("p");
        p.className = "pace-row";
        const label = document.createElement("strong");
        label.textContent = row.label;
        const detail = document.createElement("span");
        detail.className = "pace-detail";
        detail.textContent = projectionClause(row.rate, goals);
        p.appendChild(label);
        p.appendChild(detail);
        block.appendChild(p);
        summary.push(row.label + ": " + detail.textContent);
      });
    } else if (goals.length) {
      const p = document.createElement("p");
      p.textContent = deviceGapMessage(device, fullN, 2, "Goal pace");
      block.appendChild(p);
      summary.push(p.textContent);
    }

    root.appendChild(block);
    return summary.join(" ");
  }

  function setPaceSummary(text) {
    let el = document.getElementById("paceSummary");
    const panel = document.getElementById("pacePanel");
    const content = document.getElementById("paceContent");
    if (!el && panel && content) {
      el = document.createElement("p");
      el.id = "paceSummary";
      el.className = "sr-only";
      panel.insertBefore(el, content);
    }
    if (!el) return;
    el.textContent = text || "";
  }

  function renderPace(data) {
    const root = document.getElementById("paceContent");
    if (!root) return;
    const t = getTargets(data);
    const device = viewDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const baseline = deviceBaseline(scans, device);
    const latest = latestFullScan(scans);
    root.innerHTML = "";
    const summaryBits = [];

    const goalSummary = renderGoalPace(data, t, root);
    if (goalSummary) summaryBits.push(goalSummary);

    if (!baseline || !latest || baseline.id === latest.id) {
      if (!root.childElementCount) {
        const p = document.createElement("p");
        p.textContent = deviceGapMessage(device, fullScans(scans).length, 2, "Goal pace");
        root.appendChild(p);
      }
      setPaceSummary(summaryBits.join(" "));
      return;
    }
    const baseName = baseline.id === BASELINE_ID ? "Feb" : fmt.date(baseline.date);

    const days = daysBetween(baseline.date, latest.date);
    const weeks = days / 7;

    if (baseline.bf != null && latest.bf != null && days > 0) {
      const dBf = latest.bf - baseline.bf;
      const ratePerWeek = dBf / weeks;
      const row = document.createElement("div");
      row.className = "pace-row";
      let etaHtml = "";
      if (ratePerWeek >= -0.001) {
        if (Math.abs(ratePerWeek) < 0.001) {
          etaHtml =
            "<strong>BF% pace:</strong> flat since " +
            baseName +
            " — not closing on 20% at current rate.";
        } else {
          etaHtml =
            "<strong>BF% pace:</strong> rising (" +
            fmt.signed(ratePerWeek) +
            " pp/week) — not heading toward 20%.";
        }
      } else {
        const remaining = latest.bf - t.bfUpperTarget;
        if (remaining <= 0) {
          etaHtml =
            "<strong>BF% pace:</strong> at or below " +
            t.bfUpperTarget +
            "% upper target.";
        } else {
          const weeksEta = remaining / -ratePerWeek;
          etaHtml =
            "<strong>ETA to BF " +
            t.bfUpperTarget +
            "%:</strong> ~" +
            fmt.num(weeksEta, 0) +
            " weeks if " +
            baseName +
            "→latest rate continues.";
        }
      }
      row.innerHTML =
        etaHtml +
        `<span class="pace-detail">${baseName} ${fmt.num(baseline.bf)}% → ${fmt.date(
          latest.date
        )} ${fmt.num(latest.bf)}% (${fmt.signed(dBf)} pp over ${fmt.int(
          days
        )} days · ${fmt.signed(ratePerWeek)} pp/week)</span>`;
      root.appendChild(row);
    }

    if (baseline.fatMass != null && latest.fatMass != null && days > 0) {
      const dFat = latest.fatMass - baseline.fatMass;
      const ratePerWeek = dFat / weeks;
      const row = document.createElement("div");
      row.className = "pace-row";
      const lost = -dFat;
      row.innerHTML =
        `<strong>Fat mass pace:</strong> ${
          lost > 0.05
            ? fmt.num(lost) + " lb lost"
            : lost < -0.05
              ? fmt.num(-lost) + " lb gained"
              : "flat"
        } since ${baseName}` +
        `<span class="pace-detail">${fmt.signed(
          ratePerWeek
        )} lb/week over ${fmt.int(days)} days (${fmt.date(
          baseline.date
        )} → ${fmt.date(latest.date)})</span>`;
      root.appendChild(row);
    }
    setPaceSummary(summaryBits.join(" "));
  }

  function renderComposition(data) {
    const device = viewDevice(data);
    const scans = scansOnDevice(data.scans || [], device.id);
    const latest = latestFullScan(scans);
    const meta = document.getElementById("compositionMeta");
    const legend = document.getElementById("compLegend");
    const canvas = document.getElementById("chartComposition");
    if (compositionChart) {
      compositionChart.destroy();
      const idx = charts.indexOf(compositionChart);
      if (idx >= 0) charts.splice(idx, 1);
      compositionChart = null;
    }
    if (!latest) {
      if (meta) {
        meta.textContent = (device.label || "Current scale") + " · no official scan yet";
      }
      if (legend) {
        legend.innerHTML =
          "<li>" +
          escapeHtml(deviceGapMessage(device, fullScans(scans).length, 1, "This snapshot")) +
          "</li>";
      }
      if (canvas) {
        canvas.hidden = true;
        attachChartSummary(
          "chartComposition",
          deviceGapMessage(device, fullScans(scans).length, 1, "This snapshot")
        );
      }
      return;
    }
    if (canvas) canvas.hidden = false;
    if (meta) {
      meta.textContent =
        fmt.date(latest.date) +
        " · " +
        (latest.label || "Scan") +
        " · " +
        (device.label || "");
    }
    if (!canvas || typeof Chart === "undefined") return;

    const colors = chartColors();
    const slices = [];
    const labels = [];
    const bg = [];
    const fatColor = "#f472b6";
    const leanColor = colors.accent;
    const boneColor = "#94a3b8";

    if (latest.fatMass != null) {
      labels.push("Fat mass");
      slices.push(latest.fatMass);
      bg.push(fatColor);
    }
    const lean = leanLb(latest);
    if (lean != null && latest.bone != null && lean > latest.bone) {
      labels.push("Soft lean (LBM − bone)");
      slices.push(lean - latest.bone);
      bg.push(leanColor);
      labels.push("Bone");
      slices.push(latest.bone);
      bg.push(boneColor);
    } else if (lean != null) {
      labels.push(latest.lbm != null ? "LBM (lean body mass)" : "Fat-free mass");
      slices.push(lean);
      bg.push(leanColor);
    }

    if (legend) {
      legend.innerHTML = "";
      labels.forEach((lab, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="left"><span class="swatch" style="background:${
          bg[i]
        }"></span>${escapeHtml(lab)}</span><span class="right">${fmt.num(
          slices[i]
        )} lb</span>`;
        legend.appendChild(li);
      });
      if (lean != null && latest.fatMass != null) {
        const note = document.createElement("li");
        note.style.fontSize = "0.75rem";
        note.style.color = "var(--text-subtle)";
        note.textContent =
          "Fat " +
          fmt.num(latest.fatMass) +
          " + " +
          (latest.lbm != null ? "LBM " : "fat-free ") +
          fmt.num(lean) +
          " = " +
          fmt.num(latest.fatMass + lean) +
          " lb. " +
          (device.label || "");
        legend.appendChild(note);
      }
    }

    if (!slices.length) return;

    compositionChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: slices,
            backgroundColor: bg,
            borderColor: cssVar("--bg") || "#0f1419",
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: preferReducedMotion() ? false : { duration: 450 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                const sum = slices.reduce((a, b) => a + b, 0);
                const pct = sum ? ((v / sum) * 100).toFixed(1) : "0";
                return ctx.label + ": " + fmt.num(v) + " lb (" + pct + "%)";
              },
            },
          },
        },
      },
    });
    charts.push(compositionChart);

    if (compositionChart && labels.length) {
      const sum = slices.reduce((a, b) => a + b, 0);
      const parts = labels.map((lab, i) => lab + " " + fmt.num(slices[i]) + " lb");
      const text = "Composition of latest full scan: " + parts.join(", ") + ". Total " + fmt.num(sum) + " lb.";
      attachChartSummary("chartComposition", text);
    }
  }

  function scanOptionLabel(s, data) {
    const device = data ? deviceById(data, scanDeviceId(s)) : null;
    return (
      fmt.date(s.date) +
      " · " +
      (s.label || "Scan") +
      (s.partial ? " (partial)" : "") +
      (device && device.label ? " · " + device.label : "")
    );
  }

  function renderCompare(data) {
    const selA = document.getElementById("compareA");
    const selB = document.getElementById("compareB");
    const body = document.getElementById("compareBody");
    if (!selA || !selB || !body) return;

    const scans = data.scans;
    const baseline = findScan(scans, BASELINE_ID);
    const latest = latestFullScan(scans);

    const fillSelect = (sel, preferredId) => {
      sel.innerHTML = "";
      scans.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = scanOptionLabel(s, data);
        sel.appendChild(opt);
      });
      if (preferredId && findScan(scans, preferredId)) {
        sel.value = preferredId;
      }
    };

    if (selA.dataset.ready !== "1") {
      fillSelect(selA, baseline ? baseline.id : scans[0].id);
      fillSelect(selB, latest ? latest.id : scans[scans.length - 1].id);
      selA.dataset.ready = "1";
      selB.dataset.ready = "1";
      const onChange = () => updateCompareTable(data);
      selA.addEventListener("change", onChange);
      selB.addEventListener("change", onChange);
    }

    updateCompareTable(data);
  }

  function updateCompareTable(data) {
    const selA = document.getElementById("compareA");
    const selB = document.getElementById("compareB");
    const body = document.getElementById("compareBody");
    const a = findScan(data.scans, selA.value);
    const b = findScan(data.scans, selB.value);
    body.innerHTML = "";
    const cross = a && b && scanDeviceId(a) !== scanDeviceId(b);
    const compareNote = document.getElementById("compareDeviceNote");
    if (compareNote) {
      compareNote.hidden = !cross;
      compareNote.textContent = cross
        ? "These scans are different scales. Weight and body-composition deltas are left blank so the switch is not read as a body change. Waist, WHtR, and RFM still compare because they come from the tape."
        : "";
    }
    const tapeLabels = { "Waist (in)": true, "WHtR": true, "RFM %": true };

    const metrics = [
      { key: "weight", label: "Weight (lb)", digits: 1, lowerBetter: true },
      { key: "bf", label: "Body fat %", digits: 1, lowerBetter: true },
      { key: "fatMass", label: "Fat mass (lb)", digits: 1, lowerBetter: true },
      { key: "visceral", label: "Visceral", digits: 1, lowerBetter: true },
      { key: "bodyAge", label: "Body age", digits: 0, lowerBetter: true },
      {
        key: "lbm",
        label: "LBM (lb)",
        digits: 1,
        lowerBetter: false,
        noTone: true,
      },
      {
        key: "muscleMass",
        label: "Muscle mass (lb)",
        digits: 1,
        lowerBetter: false,
        noTone: true,
        uncertainNote: true,
      },
      {
        label: "Waist (in)",
        digits: 3,
        lowerBetter: true,
        eps: 0.05,
        value(s) {
          if (!s || s.waistIn == null || !Number.isFinite(Number(s.waistIn))) {
            return null;
          }
          return Number(s.waistIn);
        },
      },
      {
        label: "WHtR",
        digits: 3,
        lowerBetter: true,
        eps: 0.0005,
        value(s) {
          return whtrOf(s, subjectHeightIn(data));
        },
      },
      {
        label: "RFM %",
        digits: 1,
        lowerBetter: true,
        value(s) {
          return rfmOf(s, subjectHeightIn(data), subjectSex(data));
        },
      },
      { key: "fatFreeMass", label: "Fat-free mass (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "skeletalMuscleMass", label: "Skeletal muscle mass (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "bodyCellMass", label: "Body cell mass (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "minerals", label: "Minerals (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "intracellularWater", label: "Intracellular water (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "extracellularWater", label: "Extracellular water (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "heartRate", label: "Scale heart rate (bpm)", digits: 0, lowerBetter: false, noTone: true, optional: true },
      { key: "subqFatMass", label: "Subq fat mass (lb)", digits: 1, lowerBetter: true, optional: true },
      { key: "waistHipRatio", label: "Waist-hip ratio", digits: 2, lowerBetter: true, optional: true },
      { key: "smqi", label: "SMQI", digits: 1, lowerBetter: false, optional: true },
      { key: "healthScore", label: "Health score", digits: 0, lowerBetter: false, optional: true },
      { key: "leftArmMuscle", label: "Left arm muscle (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "leftArmFat", label: "Left arm fat (lb)", digits: 1, lowerBetter: true, optional: true },
      { key: "rightArmMuscle", label: "Right arm muscle (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "rightArmFat", label: "Right arm fat (lb)", digits: 1, lowerBetter: true, optional: true },
      { key: "leftLegMuscle", label: "Left leg muscle (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "leftLegFat", label: "Left leg fat (lb)", digits: 1, lowerBetter: true, optional: true },
      { key: "rightLegMuscle", label: "Right leg muscle (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "rightLegFat", label: "Right leg fat (lb)", digits: 1, lowerBetter: true, optional: true },
      { key: "trunkMuscle", label: "Trunk muscle (lb)", digits: 1, lowerBetter: false, optional: true },
      { key: "trunkFat", label: "Trunk fat (lb)", digits: 1, lowerBetter: true, optional: true },
    ];

    metrics.forEach((m) => {
      const tr = document.createElement("tr");
      const av = m.value ? m.value(a) : a ? a[m.key] : null;
      const bv = m.value ? m.value(b) : b ? b[m.key] : null;
      const dig = m.digits;
      const aTxt =
        av == null ? "—" : dig === 0 ? fmt.int(av) : fmt.num(av, dig);
      const bTxt =
        bv == null ? "—" : dig === 0 ? fmt.int(bv) : fmt.num(bv, dig);

      if (m.optional && av == null && bv == null) return;
      let deltaCell;
      if (av == null || bv == null) {
        deltaCell = `<td class="na">n/a</td>`;
      } else if (cross && !tapeLabels[m.label]) {
        deltaCell = `<td class="na">Different scales</td>`;
      } else {
        const d = bv - av;
        let tone = "neutral";
        if (!m.noTone) {
          const info = deltaInfo(bv, av, {
            lowerBetter: m.lowerBetter,
            digits: dig,
            eps: m.eps != null ? m.eps : 0.05,
          });
          tone = info ? info.tone : "neutral";
        }
        if (
          m.uncertainNote &&
          ((a && (a.labelUncertain || a.muscleMassApprox)) ||
            (b && (b.labelUncertain || b.muscleMassApprox)))
        ) {
          deltaCell = `<td class="na" title="Baseline muscle label uncertain — delta shown raw, not interpreted as gain/loss">${fmt.signed(
            d,
            dig
          )} (uninterpreted)</td>`;
        } else {
          deltaCell = `<td class="delta-cell ${tone}">${fmt.signed(
            d,
            dig
          )}</td>`;
        }
      }

      tr.innerHTML = `
        <td>${escapeHtml(m.label)}</td>
        <td>${aTxt}</td>
        <td>${bTxt}</td>
        ${deltaCell}
      `;
      body.appendChild(tr);
    });
  }

  function csvEscape(val) {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv(data) {
    const keys = [
      "id",
      "date",
      "device",
      "label",
      "partial",
      "weight",
      "bf",
      "fatMass",
      "visceral",
      "bodyAge",
      "lbm",
      "muscleMass",
      "muscleMassApprox",
      "labelUncertain",
      "muscleRate",
      "skeletalMusclePct",
      "subqFat",
      "bodyWater",
      "waterWeight",
      "proteinPct",
      "proteinMass",
      "bone",
      "bmr",
      "bmi",
      "fatLossNote",
      "waistIn",
      "whtr",
      "rfm",
      "scanTime",
      "fatFreeMass",
      "skeletalMuscleMass",
      "bodyCellMass",
      "minerals",
      "intracellularWater",
      "extracellularWater",
      "intracellularWaterPct",
      "extracellularWaterPct",
      "heartRate",
      "subqFatMass",
      "waistHipRatio",
      "smqi",
      "healthScore",
      "leftArmMuscle",
      "leftArmFat",
      "leftArmMusclePct",
      "leftArmFatPct",
      "rightArmMuscle",
      "rightArmFat",
      "rightArmMusclePct",
      "rightArmFatPct",
      "leftLegMuscle",
      "leftLegFat",
      "leftLegMusclePct",
      "leftLegFatPct",
      "rightLegMuscle",
      "rightLegFat",
      "rightLegMusclePct",
      "rightLegFatPct",
      "trunkMuscle",
      "trunkFat",
      "trunkMusclePct",
      "trunkFatPct",
    ];
    const height = subjectHeightIn(data);
    const sex = subjectSex(data);
    const lines = [keys.join(",")];
    data.scans.forEach((s) => {
      lines.push(
        keys
          .map((k) => {
            if (k === "whtr") {
              const w = whtrOf(s, height);
              return csvEscape(w == null ? null : Number(w).toFixed(3));
            }
            if (k === "rfm") {
              const r = rfmOf(s, height, sex);
              return csvEscape(r == null ? null : Number(r).toFixed(1));
            }
            return csvEscape(s[k]);
          })
          .join(",")
      );
    });
    const blob = new Blob([lines.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "brandons-health-log-scans.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wireExport() {
    const btn = document.getElementById("exportCsv");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (appData) exportCsv(appData);
    });
  }

  function syncRangeButtons() {
    document.querySelectorAll(".range-btn").forEach((btn) => {
      const on = btn.getAttribute("data-range") === chartRange;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncDeviceButtons(data) {
    const root = document.getElementById("deviceToggle");
    if (!root || !data) return;
    const active = viewDevice(data).id;
    root.innerHTML = "";
    orderedDevices(data).forEach((device) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "device-btn";
      btn.setAttribute("data-device", device.id);
      btn.setAttribute("aria-pressed", device.id === active ? "true" : "false");
      btn.textContent = deviceButtonLabel(data, device);
      root.appendChild(btn);
    });
    const note = document.getElementById("deviceNote");
    if (note) note.textContent = deviceBanner(data);
  }

  function rerender() {
    if (!appData) return;
    syncDeviceButtons(appData);
    renderConsistency(appData);
    renderMetrics(appData);
    renderGoalProgress(appData);
    renderPace(appData);
    renderCompare(appData);
    renderTimeline(appData);
    renderGoals(appData);
    if (typeof Chart !== "undefined") renderCharts(appData);
  }

  function wireDevice(data) {
    const stored = localStorage.getItem(DEVICE_KEY);
    const ids = deviceCatalog(data).map((d) => d.id);
    deviceViewId = stored && ids.indexOf(stored) !== -1 ? stored : null;
    const root = document.getElementById("deviceToggle");
    if (root && root.dataset.ready !== "1") {
      root.dataset.ready = "1";
      root.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-device]");
        if (!btn || !appData) return;
        const id = btn.getAttribute("data-device");
        if (!id || id === viewDevice(appData).id) return;
        deviceViewId = id;
        localStorage.setItem(DEVICE_KEY, id);
        rerender();
      });
    }
    syncDeviceButtons(data);
  }

  function wireRange() {
    chartRange = getChartRange();
    syncRangeButtons();
    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-range");
        if (!next || next === chartRange) return;
        chartRange = next;
        localStorage.setItem(RANGE_KEY, chartRange);
        syncRangeButtons();
        if (appData) renderCharts(appData);
      });
    });
  }

  function wireTheme() {
    applyTheme(getTheme());
    document.getElementById("themeToggle").addEventListener("click", () => {
      const next =
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
      applyTheme(next);
    });
  }

  function showError(msg) {
    const el = document.getElementById("errorRoot");
    el.hidden = false;
    el.textContent = msg;
  }

  async function init() {
    wireTheme();
    wireExport();
    wireRange();
    let data;
    try {
      const res = await fetch("data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
    } catch (err) {
      showError(
        "Could not load data.json. If opening as a file:// URL, serve the docs folder over HTTP (see README-PAGES.md)."
      );
      console.error(err);
      return;
    }

    appData = data;
    wireDevice(data);
    renderConsistency(data);
    renderMetrics(data);
    renderGoalProgress(data);
    renderPace(data);
    renderCompare(data);
    renderTimeline(data);
    renderGoals(data);

    if (typeof Chart !== "undefined") {
      renderCharts(data);
    } else {
      const wait = setInterval(() => {
        if (typeof Chart !== "undefined") {
          clearInterval(wait);
          renderCharts(data);
        }
      }, 50);
      setTimeout(() => clearInterval(wait), 5000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
