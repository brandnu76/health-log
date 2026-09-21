(async function () {
  const script = document.currentScript;
  const base = (script && script.src ? script.src : new URL("app.js", location.href).href).replace(/[^/]+$/, "");
  const partFiles = ["appz0.b64", "appz1.b64", "appz2.b64", "appz3.b64"];
  let b64 = "";
  for (const f of partFiles) {
    const res = await fetch(base + f, { cache: "no-cache" });
    if (!res.ok) throw new Error("Failed " + f);
    b64 += await res.text();
  }
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  const text = await new Response(stream).text();
  (0, eval)(text);
})();
