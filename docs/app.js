/**
 * Council of Health — Health Log dashboard
 * Powered by data.json; Chart.js for trends.
 */
(function () {
  "use strict";

  const THEME_KEY = "health-log-theme";
  const BASELINE_ID = "2026-02-01";
  const charts = [];

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

  function prefersReducedMotion() {
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

  function renderMetrics(data) {
    const scans = data.scans;
    const baseline = findScan(scans, BASELINE_ID);
    const latest = latestFullScan(scans);
    const metaEl = document.getElementById("latestMeta");
    metaEl.textContent = `${fmt.date(latest.date)} · ${latest.label || "Scan"} · vs Feb baseline`;

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
        skipDelta: true,
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
        deltaHtml = `<span class="delta neutral" title="${c.reason || ""}">${
          c.reason ? "Δ vs Feb n/a" : "—"
        }</span>`;
      } else {
        const d = deltaVsBaseline(latest, baseline, c.key, {
          lowerBetter: c.lowerBetter,
        });
        if (d) {
          deltaHtml = `<span class="delta ${d.tone}">${d.text} vs Feb</span>`;
        } else {
          deltaHtml = `<span class="delta neutral">—</span>`;
        }
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

  function makeLineChart(canvasId, points, yLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    const colors = chartColors();
    const labels = points.map((p) => p.x);
    const values = points.map((p) => p.y);

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
        animation: prefersReducedMotion() ? false : { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title(items) {
                const i = items[0].dataIndex;
                return fmt.date(labels[i]);
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
            title: {
              display: false,
            },
          },
        },
      },
    });
    charts.push(chart);
    return chart;
  }

  function refreshChartColors() {
    const colors = chartColors();
    charts.forEach((chart) => {
      const ds = chart.data.datasets[0];
      ds.borderColor = colors.accent;
      ds.backgroundColor = colors.accent + "22";
      ds.pointBackgroundColor = colors.accent;
      ds.pointBorderColor = cssVar("--bg") || "#0f1419";
      chart.options.scales.x.ticks.color = colors.text;
      chart.options.scales.y.ticks.color = colors.text;
      chart.options.scales.x.grid.color = colors.grid;
      chart.options.scales.y.grid.color = colors.grid;
      chart.update(prefersReducedMotion() ? "none" : undefined);
    });
  }

  function renderCharts(data) {
    charts.length = 0;
    ["chartWeight", "chartBf", "chartFat", "chartVisceral"].forEach((id) => {
      const c = Chart.getChart(id);
      if (c) c.destroy();
    });

    makeLineChart(
      "chartWeight",
      seriesFor(data.scans, "weight"),
      "Weight (lb)"
    );
    makeLineChart("chartBf", seriesFor(data.scans, "bf"), "Body fat %");
    makeLineChart(
      "chartFat",
      seriesFor(data.scans, "fatMass"),
      "Fat mass (lb)"
    );
    makeLineChart(
      "chartVisceral",
      seriesFor(data.scans, "visceral"),
      "Visceral"
    );
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

    renderMetrics(data);
    renderTimeline(data);
    renderGoals(data);

    if (typeof Chart !== "undefined") {
      renderCharts(data);
    } else {
      // Chart.js still loading (defer) — wait briefly
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
