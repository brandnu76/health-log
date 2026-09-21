
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
