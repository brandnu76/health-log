(function () {
  var localFoods = [];
  var lastOff = [];
  function $(id) { return document.getElementById(id); }
  function loadLocal() {
    return fetch("foods.json", { cache: "no-cache" })
      .then(function (res) { return res.ok ? res.json() : { foods: [] }; })
      .then(function (data) { localFoods = data.foods || []; })
      .catch(function () { localFoods = []; });
  }
  function norm(s) { return String(s || "").toLowerCase().trim(); }
  function searchLocal(q) {
    if (!q) return localFoods.slice(0, 12);
    return localFoods.filter(function (f) {
      return norm(f.name).indexOf(q) !== -1 || norm(f.id).indexOf(q) !== -1;
    }).slice(0, 20);
  }
  function searchOff(q) {
    var url = "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" +
      encodeURIComponent(q) +
      "&search_simple=1&action=process&json=1&page_size=8&fields=product_name,brands,nutriments,serving_size,code";
    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      var products = data.products || [];
      lastOff = products.map(function (p) {
        var n = p.nutriments || {};
        var p100 = n["proteins_100g"] != null ? Number(n["proteins_100g"]) : (n.proteins != null ? Number(n.proteins) : null);
        var pServ = n.proteins_serving != null ? Number(n.proteins_serving) : null;
        var protein = pServ != null && !isNaN(pServ) ? pServ : (p100 != null && !isNaN(p100) ? p100 : null);
        var serving = pServ != null ? (p.serving_size || "1 serving") : "100 g";
        var name = (p.product_name || "Unnamed") + (p.brands ? " · " + p.brands.split(",")[0] : "");
        return {
          id: "off-" + (p.code || name),
          name: name,
          serving: serving,
          protein: protein == null ? null : Math.round(protein * 10) / 10,
          starch: false,
          source: "off"
        };
      }).filter(function (f) { return f.protein != null; });
      return lastOff;
    });
  }
  function renderResults(list, sourceLabel) {
    var box = $("foodResults");
    if (!list.length) {
      box.innerHTML = '<p class="hint" style="margin:0.5rem 0 0">No hits' + (sourceLabel ? " in " + sourceLabel : "") + ".</p>";
      return;
    }
    box.innerHTML = list.map(function (f) {
      var label = f.name + " · " + f.serving + " · " + f.protein + " g protein";
      if (f.source === "off") label += " · packaged";
      return '<button type="button" class="food-hit" data-fid="' + String(f.id).replace(/"/g, "") + '">' + label.replace(/</g, "") + "</button>";
    }).join("");
  }
  function findFood(id) {
    var i;
    for (i = 0; i < localFoods.length; i++) if (localFoods[i].id === id) return localFoods[i];
    for (i = 0; i < lastOff.length; i++) if (lastOff[i].id === id) return lastOff[i];
    return null;
  }
  function addFood(food) {
    var meal = $("foodMeal").value;
    var servings = Number($("foodServings").value) || 1;
    var foodInput = document.querySelector('#mealGrid input[data-meal="' + meal + '"][data-f="food"]');
    var protInput = document.querySelector('#mealGrid input[data-meal="' + meal + '"][data-f="protein"]');
    var starchInput = document.querySelector('#mealGrid input[data-meal="' + meal + '"][data-f="starch"]');
    if (!foodInput || !protInput) return;
    var addName = food.name + " (" + servings + " x " + food.serving + ")";
    foodInput.value = foodInput.value ? foodInput.value + "; " + addName : addName;
    var addP = Math.round((Number(food.protein) || 0) * servings);
    protInput.value = String((Number(protInput.value) || 0) + addP);
    if (food.starch && starchInput) starchInput.checked = true;
    foodInput.dispatchEvent(new Event("input", { bubbles: true }));
    protInput.dispatchEvent(new Event("change", { bubbles: true }));
    if (starchInput && food.starch) starchInput.dispatchEvent(new Event("change", { bubbles: true }));
    $("saveStatus").textContent = "Added " + addP + " g protein to " + meal + ".";
  }
  function wire() {
    var q = $("foodQuery");
    var timer = null;
    function runLocal() { renderResults(searchLocal(norm(q.value)), "staples"); }
    q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(runLocal, 120); });
    q.addEventListener("focus", runLocal);
    $("foodPackagedBtn").addEventListener("click", function () {
      var query = norm(q.value);
      if (query.length < 3) { $("saveStatus").textContent = "Type at least 3 letters, then Packaged."; return; }
      $("foodResults").innerHTML = '<p class="hint" style="margin:0.5rem 0 0">Searching packaged foods…</p>';
      searchOff(query).then(function (list) { renderResults(list, "packaged"); }).catch(function () {
        $("foodResults").innerHTML = '<p class="hint" style="margin:0.5rem 0 0">Packaged search failed. Use staples or type protein by hand.</p>';
      });
    });
    $("foodResults").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-fid]");
      if (!btn) return;
      var food = findFood(btn.getAttribute("data-fid"));
      if (food) addFood(food);
    });
  }
  loadLocal().then(function () { wire(); });
})();
