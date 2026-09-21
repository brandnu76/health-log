(async function () {
  const script = document.currentScript;
  const base = (script && script.src ? script.src : new URL("app.js", window.location.href).href).replace(/[^/]+$/, "");
  const parts = ["app-a.js","app-b.js","app-c.js","app-d.js","app-e.js","app-f.js","app-g.js","app-h.js"];
  let code = "";
  for (const p of parts) {
    const res = await fetch(base + p, { cache: "no-cache" });
    if (!res.ok) throw new Error("Failed to load " + p + " (" + res.status + ")");
    code += await res.text() + "\n";
  }
  (0, eval)(code);
})();
