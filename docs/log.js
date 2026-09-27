(function () {
  const STORE = "healthLogDailyV1";
  const TOKEN_KEY = "healthLogGhToken";
  const BLOCK_START = "2026-09-28";
  const BLOCK_WEEKS = 12;
  const GH = { owner: "brandnu76", repo: "health-log", path: "logs/daily.json", branch: "main" };
  const CHECKS = [["cpap", "CPAP last night"],["proteinHit", "Protein 160 g+"],["noStarch", "No rice / bread / pasta / dessert"],["veg", "Veg at 2+ meals"],["water", "Water through the day"],["creatine", "Creatine 5 g"]];
  const MEALS = [["breakfast", "Breakfast"],["lunch", "Lunch"],["dinner", "Dinner"],["snack", "Anchor snack"]];
  const WORK = [["off", "Off"],["walk", "Walk"],["A", "Lift A"],["B", "Lift B"],["C", "Lift C"]];
  const LIFTS = {
    A: ["Goblet squat", "KB floor / bench press", "1-arm KB row", "Suitcase carry", "Optional swings"],
    B: ["KB deadlift / RDL", "Push-up / incline", "Chest-supported row", "Half-kneeling press", "Farmer carry"],
    C: ["Goblet or clean-to-squat", "Standing 1-arm press", "Single-leg RDL", "Halo / arm bar", "Easy swings or walk"]
  };
  const PLAN = { 1: "A", 2: "walk", 3: "B", 4: "walk", 5: "C", 6: "walk", 0: "off" };
  function todayISO() { const d = new Date(); const z = d.getTimezoneOffset() * 60000; return new Date(d - z).toISOString().slice(0, 10); }
  function parseISO(iso) { const [y, m, day] = iso.split("-").map(Number); return new Date(y, m - 1, day); }
  function weekday(iso) { return parseISO(iso).getDay(); }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function weekIndex(iso) { const diff = Math.floor((parseISO(iso) - parseISO(BLOCK_START)) / 86400000); if (diff < 0) return 0; return Math.floor(diff / 7) + 1; }
  function planned(iso) { return PLAN[weekday(iso)] || "off"; }
  function loadAll() { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } }
  function saveAll(obj) { localStorage.setItem(STORE, JSON.stringify(obj)); }
  function emptyDay(iso) {
    const lifts = {}; ["A", "B", "C"].forEach((k) => { lifts[k] = LIFTS[k].map((name) => ({ name, load: "", sets: "", reps: "" })); });
    const meals = {}; MEALS.forEach(([id]) => { meals[id] = { food: "", protein: "", starch: false }; });
    const checks = {}; CHECKS.forEach(([id]) => { checks[id] = false; });
    return { date: iso, work: planned(iso), walkMin: planned(iso) === "walk" ? 30 : "", checks, lifts, meals, glucose: "", notes: "" };
  }
  const $ = (id) => document.getElementById(id);
  let current = todayISO();
  let days = loadAll();
  let remoteSha = null;
  let pushing = false;
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setStatus(msg) { $("saveStatus").textContent = msg; }
  function setChip(on, label) { const el = $("ghChip"); el.textContent = label; el.classList.toggle("gh-on", on); }
  function b64utf8(str) { const bytes = new TextEncoder().encode(str); let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); }
  function utf8b64(b64) { const clean = String(b64 || "").replace(/\n/g, ""); const bin = atob(clean); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  function ghHeaders() { return { Accept: "application/vnd.github+json", Authorization: "Bearer " + getToken(), "X-GitHub-Api-Version": "2022-11-28" }; }
  async function pullGitHub() {
    if (!getToken()) { setChip(false, "GitHub off"); setStatus("No token. Store one below, then Pull."); return false; }
    setStatus("Pulling from GitHub…");
    const url = "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + GH.path + "?ref=" + GH.branch;
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 401 || res.status === 403) { setChip(false, "GitHub auth"); setStatus("Token rejected. Create a new fine-grained token with Contents read/write."); return false; }
    if (res.status === 404) { remoteSha = null; setChip(true, "GitHub ready"); setStatus("No logs/daily.json yet. First Save to GitHub will create it."); return true; }
    if (!res.ok) { setChip(false, "GitHub error"); setStatus("GitHub GET failed (" + res.status + ")."); return false; }
    const data = await res.json();
    remoteSha = data.sha;
    const parsed = JSON.parse(utf8b64(data.content));
    const incoming = parsed.days || parsed;
    days = Object.assign({}, days, incoming);
    saveAll(days);
    setChip(true, "GitHub on");
    setStatus("Loaded " + Object.keys(incoming).length + " day(s) from logs/daily.json.");
    return true;
  }
  async function pushGitHub(message) {
    if (!getToken()) { setStatus("Saved on this phone only. Store a token to write GitHub."); return false; }
    if (pushing) return false;
    pushing = true;
    setStatus("Writing logs/daily.json…");
    try {
      const payload = { blockStart: BLOCK_START, updated: new Date().toISOString(), days };
      const body = { message: message || "Update daily log", content: b64utf8(JSON.stringify(payload, null, 2)), branch: GH.branch };
      if (remoteSha) body.sha = remoteSha;
      const url = "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + GH.path;
      let res = await fetch(url, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()), body: JSON.stringify(body) });
      if (res.status === 409 || res.status === 422) {
        await pullGitHub();
        body.sha = remoteSha;
        body.content = b64utf8(JSON.stringify({ blockStart: BLOCK_START, updated: new Date().toISOString(), days }, null, 2));
        res = await fetch(url, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()), body: JSON.stringify(body) });
      }
      if (!res.ok) { const err = await res.text(); setChip(false, "GitHub error"); setStatus("GitHub save failed (" + res.status + "). " + err.slice(0, 120)); return false; }
      const data = await res.json();
      remoteSha = data.content && data.content.sha;
      setChip(true, "GitHub on");
      setStatus("Saved " + current + " to GitHub.");
      return true;
    } finally { pushing = false; }
  }
  function getDay() { if (!days[current]) days[current] = emptyDay(current); return days[current]; }
  function renderChecks(day) {
    $("checkGrid").innerHTML = CHECKS.map(([id, label]) => `<label class="check-item"><input type="checkbox" data-check="${id}" ${day.checks[id] ? "checked" : ""} /><span>${label}</span></label>`).join("");
  }
  function renderWork(day) {
    $("workType").innerHTML = WORK.map(([id, label]) => `<button type="button" data-work="${id}" aria-pressed="${day.work === id}">${label}</button>`).join("");
  }
  function renderLifts(day) {
    const show = day.work === "A" || day.work === "B" || day.work === "C";
    $("liftBlock").hidden = !show;
    if (!show) return;
    $("liftTitle").textContent = "Lift " + day.work;
    $("liftBody").innerHTML = (day.lifts[day.work] || []).map((r, i) => `<tr><td>${r.name}</td><td><input data-lift="${day.work}" data-i="${i}" data-f="load" value="${r.load || ""}" placeholder="lb" inputmode="decimal" /></td><td><input data-lift="${day.work}" data-i="${i}" data-f="sets" value="${r.sets || ""}" placeholder="sets" inputmode="numeric" /></td><td><input data-lift="${day.work}" data-i="${i}" data-f="reps" value="${r.reps || ""}" placeholder="reps" /></td></tr>`).join("");
  }
  function escapeAttr(s) { return String(s || "").replace(/&/g, "&").replace(/"/g, """).replace(/</g, "<"); }
  function updateProtein(day) {
    const total = MEALS.reduce((sum, [id]) => sum + (Number(day.meals[id].protein) || 0), 0);
    const el = $("proteinTotal");
    el.textContent = "Protein logged: " + total + " g";
    el.className = "protein-total " + (total >= 160 ? "hit" : "short");
  }
  function renderMeals(day) {
    $("mealGrid").innerHTML = MEALS.map(([id, label]) => {
      const m = day.meals[id];
      return `<div class="meal-card"><h3>${label}</h3><div class="meal-row"><label class="field" style="margin:0"><span>What you ate</span><input data-meal="${id}" data-f="food" value="${escapeAttr(m.food)}" placeholder="protein + veg" /></label><label class="field" style="margin:0"><span>Protein g</span><input data-meal="${id}" data-f="protein" type="number" min="0" inputmode="numeric" value="${m.protein || ""}" /></label></div><label class="check-item" style="margin-top:.5rem"><input type="checkbox" data-meal="${id}" data-f="starch" ${m.starch ? "checked" : ""} /><span>Starch in this meal</span></label></div>`;
    }).join("");
    updateProtein(day);
  }
  function renderWeek(iso) {
    const dow = weekday(iso);
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = addDays(iso, mondayOffset);
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    $("weekStrip").innerHTML = names.map((n, i) => {
      const d = addDays(monday, i);
      const cls = ["week-cell", d === iso ? "active" : "", d === todayISO() ? "today" : "", days[d] ? "logged" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-jump="${d}"><span>${n}</span><strong>${d.slice(8)}</strong></button>`;
    }).join("");
    const w = weekIndex(iso);
    $("weekChip").textContent = w < 1 ? "Before block" : w > BLOCK_WEEKS ? "Block done" : "Week " + w + " / 12";
    const labels = { A: "Planned: Lift A", B: "Planned: Lift B", C: "Planned: Lift C", walk: "Planned: walk", off: "Planned: off / food prep" };
    $("plannedLabel").textContent = labels[planned(iso)];
  }
  function render() {
    const day = getDay();
    $("logDate").value = current;
    $("walkMin").value = day.walkMin;
    $("sessionNotes").value = day.notes || "";
    $("glucose").value = day.glucose || "";
    renderChecks(day); renderWork(day); renderLifts(day); renderMeals(day); renderWeek(current);
  }
  function persistLocal() { days[current] = getDay(); saveAll(days); renderWeek(current); }
  function readFormIntoDay() { const day = getDay(); day.walkMin = $("walkMin").value; day.notes = $("sessionNotes").value; day.glucose = $("glucose").value; return day; }
  function applyTheme(next) { document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("health-log-theme", next); } catch {} }
  function toMarkdown(day) {
    const checks = CHECKS.map(([id, label]) => `- [${day.checks[id] ? "x" : " "}] ${label}`).join("\n");
    let lifts = "";
    if (day.work === "A" || day.work === "B" || day.work === "C") {
      lifts = "\n## Lift " + day.work + "\n" + day.lifts[day.work].map((r) => `- ${r.name}: ${r.load || "—"} × ${r.sets || "—"} × ${r.reps || "—"}`).join("\n");
    }
    const meals = MEALS.map(([id, label]) => { const m = day.meals[id]; return `- ${label}: ${m.food || "—"} (${m.protein || "?"} g)${m.starch ? " · starch" : ""}`; }).join("\n");
    const prot = MEALS.reduce((s, [id]) => s + (Number(day.meals[id].protein) || 0), 0);
    return `# Log ${day.date}\n\nWork: ${day.work} · walk ${day.walkMin || 0} min\nGlucose: ${day.glucose || "—"}\n\n## Checks\n${checks}\n${lifts}\n\n## Plate (${prot} g protein)\n${meals}\n\n## Notes\n${day.notes || "—"}\n`;
  }
  function wire() {
    const savedTheme = localStorage.getItem("health-log-theme");
    if (savedTheme) applyTheme(savedTheme);
    $("themeToggle").addEventListener("click", () => { applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"); });
    $("logDate").addEventListener("change", () => { readFormIntoDay(); persistLocal(); current = $("logDate").value || todayISO(); render(); });
    $("weekStrip").addEventListener("click", (e) => { const btn = e.target.closest("[data-jump]"); if (!btn) return; readFormIntoDay(); persistLocal(); current = btn.getAttribute("data-jump"); render(); });
    $("checkGrid").addEventListener("change", (e) => { const id = e.target.getAttribute("data-check"); if (!id) return; getDay().checks[id] = e.target.checked; persistLocal(); });
    $("workType").addEventListener("click", (e) => { const btn = e.target.closest("[data-work]"); if (!btn) return; getDay().work = btn.getAttribute("data-work"); persistLocal(); render(); });
    $("walkMin").addEventListener("change", () => { readFormIntoDay(); persistLocal(); });
    $("sessionNotes").addEventListener("change", () => { readFormIntoDay(); persistLocal(); });
    $("glucose").addEventListener("change", () => { readFormIntoDay(); persistLocal(); });
    $("liftBlock").addEventListener("input", (e) => { const t = e.target; const k = t.getAttribute("data-lift"); const i = Number(t.getAttribute("data-i")); const f = t.getAttribute("data-f"); if (!k) return; getDay().lifts[k][i][f] = t.value; });
    $("liftBlock").addEventListener("change", persistLocal);
    $("mealGrid").addEventListener("input", (e) => { const t = e.target; const id = t.getAttribute("data-meal"); const f = t.getAttribute("data-f"); if (!id) return; if (f === "starch") getDay().meals[id].starch = t.checked; else getDay().meals[id][f] = t.value; updateProtein(getDay()); });
    $("mealGrid").addEventListener("change", persistLocal);
    $("saveBtn").addEventListener("click", async () => { readFormIntoDay(); persistLocal(); await pushGitHub("Log " + current); });
    $("pullBtn").addEventListener("click", async () => { await pullGitHub(); render(); });
    $("storeTokenBtn").addEventListener("click", async () => { const t = $("ghToken").value.trim(); if (!t) { setStatus("Paste a token first."); return; } localStorage.setItem(TOKEN_KEY, t); $("ghToken").value = ""; setChip(true, "GitHub ready"); await pullGitHub(); render(); });
    $("clearTokenBtn").addEventListener("click", () => { localStorage.removeItem(TOKEN_KEY); remoteSha = null; setChip(false, "GitHub off"); setStatus("Token cleared from this phone."); });
    $("exportBtn").addEventListener("click", () => { readFormIntoDay(); persistLocal(); const blob = new Blob([JSON.stringify({ blockStart: BLOCK_START, days }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "health-log-daily.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
    $("mdBtn").addEventListener("click", async () => { readFormIntoDay(); persistLocal(); try { await navigator.clipboard.writeText(toMarkdown(getDay())); setStatus("Markdown copied."); } catch { setStatus("Copy failed."); } });
  }
  wire();
  render();
  if (getToken()) { setChip(true, "GitHub ready"); pullGitHub().then(() => render()); } else { setChip(false, "GitHub off"); }
})();
