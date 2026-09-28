(function () {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function () {});
  }
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    var btn = document.getElementById("installBtn");
    if (btn) btn.hidden = false;
  });
  var btn = document.getElementById("installBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () {
        deferred = null;
        btn.hidden = true;
      });
    });
  }
  window.addEventListener("appinstalled", function () {
    if (btn) btn.hidden = true;
  });
})();
