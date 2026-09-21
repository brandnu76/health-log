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
