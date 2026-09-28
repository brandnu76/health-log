/**
 * Brandon's Health Log dashboard
 * Powered by data.json; Chart.js for trends.
 */
(function () {
  "use strict";

  const THEME_KEY = "health-log-theme";
  const RANGE_KEY = "health-log-range";
  const BASELINE_ID = "2026-02-01";
  const charts = [];
  let compositionChart = null;
  let appData = null;
  let chartRange = "all";

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
    const full = scans.filter((s) => !s.partial && s.weight != null);
    return full[full.length - 1] || scans[scans.length - 1];
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
    };
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
    let pool = fullScans(scans).filter((s) => s[metric] != null);
    if (t.cutStart) {
      const cutPool = pool.filter((s) => s.date >= t.cutStart);
      if (cutPool.length) pool = cutPool;
    }
    if (!pool.length) return null;
    return pool.reduce((best, s) =>
      best == null || s[metric] < best[metric] ? s : best
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

  function renderMetrics(data) {
    const scans = data.scans;
    const baseline = findScan(scans, BASELINE_ID);
    const latest = latestFullScan(scans);
    const metaEl = document.getElementById("latestMeta");
    const prev = previousFullScan(scans, latest);
    metaEl.textContent = `${fmt.date(latest.date)} · ${latest.label || "Scan"} · vs Feb & prior full`;

    const cards = [
      {
        key: "weight",
        label: "Weight",
        unit: "lb",
        digits: 1,
        lowerBetter: true,
        band: null,
      },
      {
        key: "bf",
        label: "Body fat",
        unit: "%",
        digits: 1,
        lowerBetter: true,
        band: bfBand(latest.bf),
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
        band: visceralBand(latest.visceral),
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
        skipDelta: true,
        reason:
          "No delta vs Feb — baseline muscle label uncertain",
        band: null,
      },
    ];

    const root = document.getElementById("metricCards");
    root.innerHTML = "";

    cards.forEach((c) => {
      const el = document.createElement("article");
      el.className = "card card-pad metric-card";
      el.setAttribute("role", "listitem");
      if (c.band) el.classList.add("band-" + c.band);

      const val =
        c.digits === 0 ? fmt.int(latest[c.key]) : fmt.num(latest[c.key], c.digits);

      let deltaHtml = "";
      if (c.skipDelta) {
        deltaHtml = `<div class="delta-stack"><span class="delta neutral" title="${escapeHtml(
          c.reason || ""
        )}">${c.reason ? "Δ vs Feb n/a" : "—"}</span></div>`;
      } else {
        const dFeb = deltaVsBaseline(latest, baseline, c.key, {
          lowerBetter: c.lowerBetter,
        });
        const dPrev = prev
          ? deltaVsBaseline(latest, prev, c.key, {
              lowerBetter: c.lowerBetter,
            })
          : null;
        const febMissing = baseline == null || baseline[c.key] == null;
        const febLine = dFeb
          ? `<span class="delta ${dFeb.tone}">${dFeb.text} vs Feb</span>`
          : `<span class="delta neutral">${
              febMissing ? "Δ vs Feb n/a" : "— vs Feb"
            }</span>`;
        let prevLine = "";
        if (prev && prev.id !== latest.id) {
          if (baseline && prev.id === baseline.id) {
            prevLine = `<span class="delta secondary neutral">prior full = Feb</span>`;
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
    ];

    const extraRoot = document.getElementById("extraMetrics");
    extraRoot.innerHTML = "";
    extras.forEach((e) => {
      if (latest[e.key] == null) return;
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
  }

  function seriesFor(scans, key) {
    return scans
      .filter((s) => s[key] != null)
      .map((s) => ({ x: s.date, y: s[key], label: s.label }));
  }

  function makeLineChart(canvasId, points, yLabel, refCfg) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    const colors = chartColors();
    const labels = points.map((p) => p.x);
    const values = points.map((p) => p.y);
    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    const bandColor = isLight
      ? "rgba(13, 148, 136, 0.14)"
      : "rgba(94, 234, 212, 0.16)";

    let suggestedMin;
    let suggestedMax;
    if (values.length) {
      let lo = Math.min.apply(null, values);
      let hi = Math.max.apply(null, values);
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
        callbacks: {
          title(items) {
            const i = items[0].dataIndex;
            return fmt.date(labels[i]);
          },
        },
      },
    };
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

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: yLabel,
            data: values,
            borderColor: colors.accent,
            backgroundColor: colors.accent + "22",
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: colors.accent,
            pointBorderColor: cssVar("--bg") || "#0f1419",
            pointBorderWidth: 2,
          },
        ],
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
      plugins: refCfg ? [refBandPlugin] : [],
    });
    chart.$colorRoles = ["accent"];
    charts.push(chart);
    return chart;
  }

  function seriesColor(role, colors) {
    if (role === "fat") return "#f472b6";
    if (role === "risk") return colors.risk;
    if (role === "caution") return colors.caution;
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
    const rows = scans.filter((s) => s.fatMass != null || s.lbm != null);
    const labels = rows.map((s) => s.date);
    const fat = rows.map((s) => (s.fatMass == null ? null : s.fatMass));
    const lbm = rows.map((s) => (s.lbm == null ? null : s.lbm));
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
        const color = seriesColor(roles[i] || "accent", colors);
        ds.borderColor = color;
        ds.backgroundColor = color + "22";
        ds.pointBackgroundColor = color;
        ds.pointBorderColor = pointBorder;
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
    ].forEach((id) => {
      const c = typeof Chart !== "undefined" ? Chart.getChart(id) : null;
      if (c) c.destroy();
    });

    const t = getTargets(data);
    const colors = chartColors();
    const ranged = scansInRange(data.scans, chartRange);

    makeLineChart(
      "chartWeight",
      seriesFor(ranged, "weight"),
      "Weight (lb)"
    );
    makeLineChart("chartBf", seriesFor(ranged, "bf"), "Body fat %", {
      bands: [{ min: t.bfBandMin, max: t.bfBandMax }],
    });
    makeLineChart(
      "chartFat",
      seriesFor(ranged, "fatMass"),
      "Fat mass (lb)"
    );
    makeLineChart(
      "chartVisceral",
      seriesFor(ranged, "visceral"),
      "Visceral",
      {
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
      }
    );
    makeLineChart(
      "chartLbm",
      seriesFor(ranged, "lbm"),
      "Lean body mass (lb)"
    );
    makeLineChart(
      "chartMuscle",
      seriesFor(ranged, "muscleMass"),
      "Muscle mass (lb)"
    );
    makeFatLbmChart(ranged);

    renderComposition(data);
  }

  function renderTimeline(data) {
    const ol = document.getElementById("timeline");
    ol.innerHTML = "";
    const baseline = findScan(data.scans, BASELINE_ID);

    data.scans.forEach((s) => {
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
        if (s.muscleMass != null) {
          bits.push(
            `Muscle ${fmt.num(s.muscleMass)} lb${
              s.labelUncertain || s.muscleMassApprox ? " (label uncertain)" : ""
            }`
          );
        }
        if (baseline && s.id !== baseline.id && s.weight != null && baseline.weight != null) {
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
        <div class="timeline-date">${fmt.date(s.date)}</div>
        <div class="timeline-label">${s.label || "Scan"}${
        s.partial ? '<span class="badge">Partial</span>' : ""
      }</div>
        <div class="timeline-body">${body}</div>
      `;
      ol.appendChild(li);
    });
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
    const full = fullScans(data.scans);
    const latest = latestFullScan(data.scans);
    const n = full.length;
    const days = latest ? daysSince(latest.date) : null;
    let daysTxt = "—";
    if (days != null) {
      if (days === 0) daysTxt = "today";
      else if (days === 1) daysTxt = "1 day ago";
      else daysTxt = days + " days ago";
    }
    chip.textContent =
      n + " full scan" + (n === 1 ? "" : "s") + " · last " + daysTxt;
    chip.title =
      "Full scans (non-partial with weight): " +
      n +
      ". Last full scan: " +
      (latest ? fmt.date(latest.date) : "—");
  }

  function renderGoalProgress(data) {
    const root = document.getElementById("goalProgressBars");
    if (!root) return;
    const t = getTargets(data);
    const baseline = findScan(data.scans, BASELINE_ID);
    const latest = latestFullScan(data.scans);
    root.innerHTML = "";

    if (latest.bf != null) {
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

    if (latest.visceral != null) {
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

    if (latest.fatMass != null && baseline && baseline.fatMass != null) {
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
        <h4>Fat mass vs Feb baseline</h4>
        <div class="progress-meta">
          <span>Feb ${fmt.num(baseline.fatMass)} lb → now ${fmt.num(
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
    const floorScan = leanFloorScan(data.scans, t);
    const leanNow =
      latest[leanMetric] != null
        ? latest[leanMetric]
        : latest.muscleMass != null
          ? latest.muscleMass
          : null;
    if (leanNow != null && floorScan && floorScan[leanMetric] != null) {
      const floor = floorScan[leanMetric];
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
  }

  function renderPace(data) {
    const root = document.getElementById("paceContent");
    if (!root) return;
    const t = getTargets(data);
    const baseline = findScan(data.scans, BASELINE_ID);
    const latest = latestFullScan(data.scans);
    root.innerHTML = "";

    if (!baseline || !latest || baseline.id === latest.id) {
      root.innerHTML =
        "<p>Need Feb baseline and a later comparable full scan to estimate pace.</p>";
      return;
    }

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
            "<strong>BF% pace:</strong> flat since Feb — not closing on 20% at current rate.";
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
            " weeks if Feb→latest rate continues.";
        }
      }
      row.innerHTML =
        etaHtml +
        `<span class="pace-detail">Feb ${fmt.num(baseline.bf)}% → ${fmt.date(
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
        } since Feb` +
        `<span class="pace-detail">${fmt.signed(
          ratePerWeek
        )} lb/week over ${fmt.int(days)} days (${fmt.date(
          baseline.date
        )} → ${fmt.date(latest.date)})</span>`;
      root.appendChild(row);
    }
  }

  function renderComposition(data) {
    const latest = latestFullScan(data.scans);
    const meta = document.getElementById("compositionMeta");
    if (meta) {
      meta.textContent =
        fmt.date(latest.date) + " · " + (latest.label || "Scan");
    }
    const legend = document.getElementById("compLegend");
    const canvas = document.getElementById("chartComposition");
    if (!canvas || typeof Chart === "undefined") return;

    if (compositionChart) {
      compositionChart.destroy();
      const idx = charts.indexOf(compositionChart);
      if (idx >= 0) charts.splice(idx, 1);
      compositionChart = null;
    }

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
    if (latest.lbm != null && latest.bone != null && latest.lbm > latest.bone) {
      labels.push("Soft lean (LBM − bone)");
      slices.push(latest.lbm - latest.bone);
      bg.push(leanColor);
      labels.push("Bone");
      slices.push(latest.bone);
      bg.push(boneColor);
    } else if (latest.lbm != null) {
      labels.push("LBM (lean body mass)");
      slices.push(latest.lbm);
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
      if (latest.lbm != null && latest.fatMass != null) {
        const note = document.createElement("li");
        note.style.fontSize = "0.75rem";
        note.style.color = "var(--text-subtle)";
        note.textContent =
          "Fat " +
          fmt.num(latest.fatMass) +
          " + LBM " +
          fmt.num(latest.lbm) +
          " = " +
          fmt.num(latest.fatMass + latest.lbm) +
          " lb.";
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
  }

  function scanOptionLabel(s) {
    return (
      fmt.date(s.date) +
      " · " +
      (s.label || "Scan") +
      (s.partial ? " (partial)" : "")
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
        opt.textContent = scanOptionLabel(s);
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
    ];

    metrics.forEach((m) => {
      const tr = document.createElement("tr");
      const av = a ? a[m.key] : null;
      const bv = b ? b[m.key] : null;
      const dig = m.digits;
      const aTxt =
        av == null ? "—" : dig === 0 ? fmt.int(av) : fmt.num(av, dig);
      const bTxt =
        bv == null ? "—" : dig === 0 ? fmt.int(bv) : fmt.num(bv, dig);

      let deltaCell;
      if (av == null || bv == null) {
        deltaCell = `<td class="na">n/a</td>`;
      } else {
        const d = bv - av;
        let tone = "neutral";
        if (!m.noTone) {
          const info = deltaVsBaseline(
            { [m.key]: bv },
            { [m.key]: av },
            m.key,
            { lowerBetter: m.lowerBetter }
          );
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
    ];
    const lines = [keys.join(",")];
    data.scans.forEach((s) => {
      lines.push(keys.map((k) => csvEscape(s[k])).join(","));
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
