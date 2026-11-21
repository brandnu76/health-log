/* Home workout tracker. Program lives in program.json. Logs stay on this phone. */
(function () {
  "use strict";

  var STORE_KEY = "hl-workouts-v1";
  var THEME_KEY = "health-log-theme";
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var RUNG_RANK = { base: 0, deload: 0, hold: 0, reps: 1, pause: 2, lower: 3, set: 4, rest: 5, top: 6 };

  var program = null;
  var state = loadState();
  var uiDate = nyTodayISO();
  var active = null;
  var currentView = "today";
  var finishNote = "";
  var finishNoteFor = "";
  var restTimer = null;
  var restTimerId = null;
  var restFired = false;
  var audioCtx = null;
  var deferredPrompt = null;
  var sending = false;

  function nyTodayISO() {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).formatToParts(new Date());
      var map = {};
      parts.forEach(function (p) { map[p.type] = p.value; });
      return map.year + "-" + map.month + "-" + map.day;
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function weekdayOf(iso) {
    var d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return "";
    return WEEKDAYS[d.getUTCDay()];
  }

  function fmtDate(iso) {
    var d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return iso || "";
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  }

  function fmtDateLong(iso) {
    var d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return iso || "";
    return WEEKDAYS[d.getUTCDay()] + " " + fmtDate(iso);
  }

  function uid() {
    var c = typeof crypto !== "undefined" ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      var v = ch === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function numOrNull(v) {
    if (typeof v === "string") {
      if (v.trim() === "") return null;
    } else if (typeof v !== "number") {
      return null;
    }
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function loadState() {
    var empty = { settings: { scriptUrl: "", sound: true }, overrides: {}, sessions: [] };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return empty;
      if (!parsed.settings || typeof parsed.settings !== "object") parsed.settings = { scriptUrl: "", sound: true };
      if (typeof parsed.settings.scriptUrl !== "string") parsed.settings.scriptUrl = "";
      if (parsed.settings.sound === undefined) parsed.settings.sound = true;
      if (!parsed.overrides || typeof parsed.overrides !== "object") parsed.overrides = {};
      if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
      return parsed;
    } catch (e) {
      return empty;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      var warn = document.getElementById("saveWarn");
      if (warn) warn.hidden = true;
      return true;
    } catch (e) {
      var banner = document.getElementById("saveWarn");
      if (banner) banner.hidden = false;
      return false;
    }
  }

  function progressionOf(raw) {
    var d = {
      stepLb: 5,
      capLb: 40,
      repLadderHigh: 15,
      pauseSec: 2,
      slowLowerSec: 4,
      extraSets: 1,
      shortRestSec: 60
    };
    if (!raw || typeof raw !== "object") return d;
    Object.keys(d).forEach(function (k) {
      if (typeof raw[k] === "number" && isFinite(raw[k])) d[k] = raw[k];
    });
    return d;
  }

  function basePlan(def, prog) {
    return {
      sets: def.sets,
      repLow: def.repLow == null ? null : def.repLow,
      repHigh: def.repHigh == null ? null : def.repHigh,
      pauseSec: 0,
      lowerSec: def.lowerSec || 3,
      restSec: def.restSec || 90,
      seconds: def.seconds == null ? null : def.seconds,
      weightLb: def.startWeightLb == null ? null : def.startWeightLb,
      rung: "base"
    };
  }

  function planOf(def, prog, last) {
    var plan = last && last.plan ? clone(last.plan) : basePlan(def, prog);
    if (plan.sets == null) plan.sets = def.sets;
    if (plan.restSec == null) plan.restSec = def.restSec || 90;
    if (plan.lowerSec == null) plan.lowerSec = def.lowerSec || 3;
    if (plan.pauseSec == null) plan.pauseSec = 0;
    if (!plan.rung) plan.rung = "base";
    if (def.kind === "hold") {
      if (plan.seconds == null) plan.seconds = def.seconds;
    } else {
      if (plan.repLow == null) plan.repLow = def.repLow;
      if (plan.repHigh == null) plan.repHigh = def.repHigh;
      if (plan.weightLb == null && def.startWeightLb != null) plan.weightLb = def.startWeightLb;
    }
    return plan;
  }

  function doneSets(last) {
    if (!last || !Array.isArray(last.sets)) return [];
    return last.sets.filter(function (s) { return s && s.done; });
  }

  function minDoneWeight(sets) {
    var vals = [];
    (sets || []).forEach(function (s) {
      if (!s || !s.done) return;
      var w = numOrNull(s.weightLb);
      if (w !== null) vals.push(w);
    });
    if (!vals.length) return null;
    return Math.min.apply(null, vals);
  }

  function hitTarget(def, plan, sets) {
    var done = (sets || []).filter(function (s) { return s && s.done; });
    if (done.length < (plan.sets || 1)) return false;
    if (def.kind === "hold") {
      return done.every(function (s) {
        var sec = numOrNull(s.seconds);
        return sec !== null && plan.seconds != null && sec >= plan.seconds;
      });
    }
    return done.every(function (s) {
      var reps = numOrNull(s.reps);
      return reps !== null && plan.repHigh != null && reps >= plan.repHigh;
    });
  }

  function describeLast(def, last) {
    var done = doneSets(last);
    if (!done.length) return "";
    if (def.kind === "hold") {
      return done.map(function (s) {
        var n = numOrNull(s.seconds);
        return n === null ? "—" : n + "s";
      }).join(", ");
    }
    var w = minDoneWeight(last.sets);
    var reps = done.map(function (s) {
      var n = numOrNull(s.reps);
      return n === null ? "—" : String(n);
    }).join(", ");
    return (w === null ? "—" : w + " lb") + " × " + reps;
  }

  function suggestNext(def, progression, last, deloadSpec) {
    var rules = progressionOf(progression);
    if (deloadSpec) {
      var prior = planOf(def, rules, last);
      var easy = basePlan(def, rules);
      var capSets = deloadSpec.sets || prior.sets || def.sets;
      easy.sets = Math.max(1, Math.min(def.sets || capSets, capSets));
      easy.rung = "deload";
      if (def.kind === "hold") {
        easy.seconds = prior.seconds == null ? def.seconds : prior.seconds;
        return {
          plan: easy,
          text: "Deload week: " + easy.sets + " × " + easy.seconds + "s. No extra time.",
          lastText: last ? describeLast(def, last) : ""
        };
      }
      var used = last ? minDoneWeight(last.sets) : null;
      easy.weightLb = used !== null ? used : prior.weightLb;
      return {
        plan: easy,
        text: "Deload week: " + easy.weightLb + " lb, " + easy.sets + " sets. No new weight.",
        lastText: last ? describeLast(def, last) : ""
      };
    }

    if (!last || !doneSets(last).length) {
      var start = basePlan(def, rules);
      var startText = def.kind === "hold"
        ? "Start at " + start.seconds + "s × " + start.sets + "."
        : "Start at " + start.weightLb + " lb, " + start.sets + " × " + start.repLow + "–" + start.repHigh + ".";
      return { plan: start, text: startText, lastText: "" };
    }

    var plan = planOf(def, rules, last);
    var described = describeLast(def, last);
    var hit = hitTarget(def, plan, last.sets);

    if (def.kind === "hold") {
      var target = plan.seconds != null ? plan.seconds : def.seconds;
      plan.seconds = target;
      plan.sets = plan.sets || def.sets;
      if (!hit) {
        return {
          plan: plan,
          text: "Stay at " + target + "s until every set hits it.",
          lastText: described
        };
      }
      var stepSec = def.stepSec || 5;
      var capSec = def.capSec == null ? target : def.capSec;
      var nextSec = Math.min(capSec, target + stepSec);
      if (nextSec > target) {
        plan.seconds = nextSec;
        plan.rung = "hold";
        return { plan: plan, text: "Next: " + nextSec + " seconds.", lastText: described };
      }
      plan.rung = "top";
      return { plan: plan, text: target + "s is the top. Repeat it.", lastText: described };
    }

    var w = minDoneWeight(last.sets);
    if (w === null) w = plan.weightLb != null ? plan.weightLb : def.startWeightLb;
    plan.weightLb = w;
    if (!hit) {
      return {
        plan: plan,
        text: "Stay at " + w + " lb until every set hits " + plan.repHigh + ".",
        lastText: described
      };
    }

    var cap = rules.capLb;
    var step = rules.stepLb;
    var nextW = Math.min(cap, w + step);
    if (nextW > w) {
      var bumped = basePlan(def, rules);
      bumped.weightLb = nextW;
      return {
        plan: bumped,
        text: "Next: " + nextW + " lb, start at " + bumped.repLow + ".",
        lastText: described
      };
    }

    var high = rules.repLadderHigh;
    var pause = rules.pauseSec;
    var slow = rules.slowLowerSec;
    var extra = (def.sets || plan.sets) + rules.extraSets;
    var shortRest = rules.shortRestSec;
    var next = clone(plan);
    next.weightLb = w;

    if ((plan.repHigh || 0) < high) {
      next.repHigh = high;
      next.rung = "reps";
      return {
        plan: next,
        text: w + " lb is the top bell. Work up to " + high + " reps.",
        lastText: described
      };
    }
    if ((plan.pauseSec || 0) < pause) {
      next.pauseSec = pause;
      next.rung = "pause";
      return {
        plan: next,
        text: "Add a " + pause + "-second pause at the bottom.",
        lastText: described
      };
    }
    if ((plan.lowerSec || 3) < slow) {
      next.lowerSec = slow;
      next.rung = "lower";
      return {
        plan: next,
        text: "Lower for " + slow + " seconds.",
        lastText: described
      };
    }
    if ((plan.sets || def.sets) < extra) {
      next.sets = extra;
      next.rung = "set";
      return {
        plan: next,
        text: "Add a set (" + extra + " sets).",
        lastText: described
      };
    }
    if ((plan.restSec || 90) > shortRest) {
      next.restSec = shortRest;
      next.rung = "rest";
      return {
        plan: next,
        text: "Shorten rest to " + shortRest + " seconds.",
        lastText: described
      };
    }
    next.rung = "top";
    return { plan: next, text: "Top of the ladder. Repeat this session.", lastText: described };
  }

  function filterSide(sets, side) {
    return (sets || []).filter(function (s) { return s && s.side === side; });
  }

  function sideLast(last, side) {
    if (!last) return null;
    var plan = last.plan ? clone(last.plan) : null;
    if (plan) {
      var key = side === "L" ? "weightLeft" : "weightRight";
      if (plan[key] != null && plan[key] !== "") plan.weightLb = plan[key];
    }
    return { plan: plan, sets: filterSide(last.sets, side) };
  }

  function suggestExercise(def, progression, last, deloadSpec) {
    if (!def.unilateral) return suggestNext(def, progression, last, deloadSpec);
    var left = suggestNext(def, progression, sideLast(last, "L"), deloadSpec);
    var right = suggestNext(def, progression, sideLast(last, "R"), deloadSpec);
    var leftRank = RUNG_RANK[left.plan.rung] || 0;
    var rightRank = RUNG_RANK[right.plan.rung] || 0;
    var shared = leftRank <= rightRank ? clone(left.plan) : clone(right.plan);
    if (left.plan.repHigh != null && right.plan.repHigh != null) {
      shared.repHigh = Math.min(left.plan.repHigh, right.plan.repHigh);
    }
    shared.weightLeft = left.plan.weightLb;
    shared.weightRight = right.plan.weightLb;
    shared.weightLb = null;
    var text = left.text;
    if (left.text !== right.text || left.plan.weightLb !== right.plan.weightLb) {
      text = "Left: " + left.text + "\nRight: " + right.text;
    }
    return { plan: shared, text: text, lastText: "" };
  }

  function isDeload(prog, iso) {
    var d = prog && prog.deload;
    if (!d || typeof d.start !== "string" || typeof d.end !== "string") return false;
    return iso >= d.start && iso <= d.end;
  }

  function autoDay(prog, iso) {
    if (!prog || !prog.schedule) return "";
    return prog.schedule[weekdayOf(iso)] || "";
  }

  function weekFor(prog, iso) {
    var weeks = (prog && prog.weeks) || [];
    for (var i = 0; i < weeks.length; i++) {
      if (iso >= weeks[i].start && iso <= weeks[i].end) return weeks[i];
    }
    return null;
  }

  function dayById(prog, id) {
    var days = (prog && prog.days) || [];
    for (var i = 0; i < days.length; i++) if (days[i].id === id) return days[i];
    return null;
  }

  function defById(prog, id) {
    var list = (prog && prog.exercises) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function latestExerciseLog(exId, beforeDate, skipDeload) {
    var best = null;
    state.sessions.forEach(function (s) {
      if (skipDeload && s.deload) return;
      if (!s.date || s.date >= beforeDate) return;
      var ex = null;
      (s.exercises || []).forEach(function (e) { if (e.id === exId) ex = e; });
      if (!ex) return;
      var any = (ex.sets || []).some(function (set) { return set.done; });
      if (!any) return;
      var key = s.date + "|" + (s.updatedAt || "");
      if (!best || key > best.key) best = { key: key, exercise: ex, deload: !!s.deload };
    });
    return best;
  }

  function describeExercise(def, ex) {
    if (!ex) return "";
    if (def.unilateral || ex.unilateral) {
      var l = describeLast(def, { sets: filterSide(ex.sets, "L") });
      var r = describeLast(def, { sets: filterSide(ex.sets, "R") });
      return "L " + (l || "—") + " · R " + (r || "—");
    }
    return describeLast(def, ex) || "—";
  }

  function makeSets(def, plan) {
    var out = [];
    var n = plan.sets || def.sets || 1;
    function row(i, side, weight) {
      return {
        n: i,
        side: side,
        weightLb: weight == null || weight === "" ? "" : String(weight),
        reps: "",
        seconds: "",
        done: false,
        doneAt: ""
      };
    }
    for (var i = 1; i <= n; i++) {
      if (def.unilateral) {
        var leftW = plan.weightLeft != null ? plan.weightLeft : plan.weightLb;
        var rightW = plan.weightRight != null ? plan.weightRight : plan.weightLb;
        out.push(row(i, "L", def.kind === "hold" ? "" : leftW));
        out.push(row(i, "R", def.kind === "hold" ? "" : rightW));
      } else if (def.kind === "hold") {
        out.push(row(i, "", ""));
      } else {
        out.push(row(i, "", plan.weightLb));
      }
    }
    return out;
  }

  function buildSession(date, dayId) {
    var day = dayById(program, dayId);
    var deloadNow = isDeload(program, date);
    var spec = deloadNow ? program.deload : null;
    var exercises = [];
    ((day && day.exerciseIds) || []).forEach(function (id) {
      var def = defById(program, id);
      if (!def) return;
      var progressLog = latestExerciseLog(id, date, true);
      var shownLog = latestExerciseLog(id, date, false);
      var suggestion = suggestExercise(def, program.progression, progressLog && progressLog.exercise, spec);
      var lastText = "No sessions yet.";
      if (shownLog) {
        lastText = "Last time: " + describeExercise(def, shownLog.exercise);
        if (shownLog.deload) lastText += " (deload)";
      }
      exercises.push({
        id: def.id,
        name: def.name,
        kind: def.kind,
        unilateral: !!def.unilateral,
        note: def.note || "",
        plan: suggestion.plan,
        suggestion: suggestion.text,
        lastText: lastText,
        sets: makeSets(def, suggestion.plan)
      });
    });
    var now = new Date().toISOString();
    return {
      id: uid(),
      date: date,
      dayId: dayId,
      deload: deloadNow,
      createdAt: now,
      updatedAt: now,
      finishedAt: "",
      synced: false,
      syncError: "",
      exercises: exercises
    };
  }

  function sessionFor(date, dayId) {
    var found = null;
    state.sessions.forEach(function (s) {
      if (s.date === date && s.dayId === dayId) found = s;
    });
    return found;
  }

  function sessionById(id) {
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === id) return state.sessions[i];
    }
    return null;
  }

  function persistSession(session) {
    session.updatedAt = new Date().toISOString();
    var found = false;
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === session.id) {
        state.sessions[i] = session;
        found = true;
        break;
      }
    }
    if (!found) state.sessions.push(session);
    saveState();
  }

  function selectedDay(iso) {
    if (state.overrides && state.overrides[iso]) return state.overrides[iso];
    var best = null;
    state.sessions.forEach(function (s) {
      if (s.date !== iso) return;
      if (!best || (s.updatedAt || "") > (best.updatedAt || "")) best = s;
    });
    if (best) return best.dayId;
    return autoDay(program, iso);
  }

  function prescriptionLine(ex) {
    var plan = ex.plan || {};
    if (ex.kind === "hold") {
      return (plan.sets || 1) + " × " + (plan.seconds || "") + "s" + (ex.unilateral ? " per side" : "");
    }
    var bits = [
      (plan.sets || 1) + " × " + plan.repLow + "–" + plan.repHigh + (ex.unilateral ? " per side" : "")
    ];
    if (plan.pauseSec) bits.push(plan.pauseSec + "s pause");
    if (plan.lowerSec) bits.push(plan.lowerSec + "s lower");
    if (plan.restSec) bits.push("rest " + plan.restSec + "s");
    return bits.join(" · ");
  }

  function bells() {
    var list = program && program.equipment && program.equipment.kettlebellsLb;
    return Array.isArray(list) && list.length ? list : [25, 30, 35, 40];
  }

  function weekLine(iso) {
    var w = weekFor(program, iso);
    if (w) {
      var label = "Week " + w.n + " · " + fmtDate(w.start) + " – " + fmtDate(w.end);
      if (w.note) label += ". " + w.note;
      return label;
    }
    if (program.start && iso < program.start) return "Block starts " + fmtDate(program.start) + ".";
    if (program.end && iso > program.end) return "This block ended " + fmtDate(program.end) + ". Logging still works.";
    return program.name || "";
  }

  function renderToday() {
    var root = document.getElementById("viewToday");
    if (!root) return;
    if (!program) {
      root.innerHTML = "";
      active = null;
      return;
    }
    var label = document.getElementById("blockLabel");
    if (label) label.textContent = program.name || "Workouts";
    var dayId = selectedDay(uiDate);
    var day = dayId ? dayById(program, dayId) : null;
    if (!dayId || !day) active = null;
    else active = sessionFor(uiDate, dayId) || buildSession(uiDate, dayId);

    var html = '<section class="card card-pad">';
    html += '<label class="field" for="logDate">Date<input type="date" id="logDate" value="' + esc(uiDate) + '" /></label>';
    html += '<p class="meta-line">' + esc(weekLine(uiDate)) + "</p>";
    if (isDeload(program, uiDate)) {
      html += '<p class="banner">' + esc((program.deload && program.deload.label) || "Deload") + ". " + esc((program.deload && program.deload.note) || "") + "</p>";
    }
    html += '<div class="day-row" role="group" aria-label="Workout">';
    (program.days || []).forEach(function (d) {
      var pressed = d.id === dayId;
      html += '<button type="button" data-action="day" data-day="' + esc(d.id) + '" aria-pressed="' + (pressed ? "true" : "false") + '">' +
        esc(d.id + " " + d.name) + "<small>" + esc(d.weekday || "") + "</small></button>";
    });
    html += "</div>";
    if (!dayId) {
      html += '<p class="hint">Rest day. Pick A, B, or C if you are training today.</p>';
    }
    html += "</section>";

    if (active) {
      var locked = !!active.synced;
      if ((program.cues || []).length) {
        html += '<section class="card card-pad"><p class="hint">' + esc(program.cues.join(" ")) + "</p></section>";
      }
      active.exercises.forEach(function (ex, exIndex) {
        html += '<section class="card card-pad">';
        html += '<div class="ex-head"><h2>' + esc(ex.name) + "</h2></div>";
        html += '<p class="meta-line">' + esc(prescriptionLine(ex)) + "</p>";
        if (ex.note) html += '<p class="ex-note">' + esc(ex.note) + "</p>";
        html += '<p class="last-line">' + esc(ex.lastText || "No sessions yet.") + "</p>";
        html += '<p class="suggest">' + esc(ex.suggestion || "") + "</p>";
        html += renderSets(ex, exIndex, locked);
        html += "</section>";
      });
      var finishLabel = "Finish";
      if (active.synced) finishLabel = "Sent";
      else if (active.finishedAt) finishLabel = "Retry send";
      html += '<section class="card card-pad">';
      html += '<button type="button" class="btn btn-primary" data-action="finish"' + (locked ? " disabled" : "") + ">" + esc(finishLabel) + "</button>";
      if (finishNote && finishNoteFor === active.id) html += '<p class="status" id="finishStatus">' + esc(finishNote) + "</p>";
      else html += '<p class="status" id="finishStatus"></p>';
      if (active.synced) html += '<p class="hint">Sent to the sheet. This copy is locked. Change a mistake on the sheet.</p>';
      else html += '<p class="hint">Saved on this phone as you go. Finish sends the checked sets.</p>';
      html += "</section>";
    }
    root.innerHTML = html;
  }

  function renderSets(ex, exIndex, locked) {
    var html = "";
    var hold = ex.kind === "hold";
    var disabled = locked ? " disabled" : "";
    var seen = {};
    ex.sets.forEach(function (set, setIndex) {
      if (!seen[set.n]) {
        seen[set.n] = true;
        html += '<div class="set-block">';
        if (ex.unilateral) html += '<div class="set-block-label">Set ' + esc(set.n) + "</div>";
      }
      var side = set.side === "L" ? "Left" : set.side === "R" ? "Right" : String(set.n);
      html += '<div class="set-row' + (hold ? " hold" : "") + '">';
      html += '<span class="set-side">' + esc(side) + "</span>";
      if (hold) {
        html += '<input type="number" inputmode="numeric" min="0" max="300" step="1" placeholder="' + esc(ex.plan.seconds || "") + ' sec" aria-label="' + esc(side + " seconds") + '" data-field="seconds" data-ex="' + exIndex + '" data-set="' + setIndex + '" value="' + esc(set.seconds) + '"' + disabled + " />";
      } else {
        html += '<input type="number" inputmode="decimal" min="0" max="200" step="5" placeholder="lb" aria-label="' + esc(side + " weight pounds") + '" data-field="weight" data-ex="' + exIndex + '" data-set="' + setIndex + '" value="' + esc(set.weightLb) + '"' + disabled + " />";
        html += '<input type="number" inputmode="numeric" min="0" max="50" step="1" placeholder="' + esc((ex.plan.repLow || "") + "–" + (ex.plan.repHigh || "")) + '" aria-label="' + esc(side + " reps") + '" data-field="reps" data-ex="' + exIndex + '" data-set="' + setIndex + '" value="' + esc(set.reps) + '"' + disabled + " />";
      }
      html += '<button type="button" class="done-btn" data-action="done" data-ex="' + exIndex + '" data-set="' + setIndex + '" aria-pressed="' + (set.done ? "true" : "false") + '"' + disabled + ">" + (set.done ? "Logged" : "Done") + "</button>";
      if (!hold) {
        html += '<div class="bells">';
        bells().forEach(function (lb) {
          var on = String(set.weightLb) === String(lb);
          html += '<button type="button" data-action="bell" data-ex="' + exIndex + '" data-set="' + setIndex + '" data-weight="' + esc(lb) + '" aria-pressed="' + (on ? "true" : "false") + '"' + disabled + ">" + esc(lb) + "</button>";
        });
        html += "</div>";
      }
      html += "</div>";
      var next = ex.sets[setIndex + 1];
      if (!next || next.n !== set.n) html += "</div>";
    });
    return html;
  }

  function renderHistory() {
    var root = document.getElementById("viewHistory");
    if (!root) return;
    var sessions = state.sessions.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.updatedAt || "") < (b.updatedAt || "") ? 1 : -1;
    });
    var html = '<section class="card card-pad"><h2>History</h2>';
    html += '<div class="actions"><button type="button" class="btn btn-ghost" data-action="export">Export CSV</button></div>';
    if (!sessions.length) {
      html += '<p class="hint">No sessions yet. Log a workout and it will show up here.</p></section>';
      root.innerHTML = html;
      return;
    }
    sessions.forEach(function (s) {
      var day = program ? dayById(program, s.dayId) : null;
      var title = fmtDateLong(s.date) + " · " + s.dayId + (day ? " " + day.name : "");
      html += '<details class="session"><summary>' + esc(title) + " · " + doneCount(s) + " sets · " + syncBadge(s) + "</summary>";
      html += "<ul>";
      var any = false;
      (s.exercises || []).forEach(function (ex) {
        (ex.sets || []).forEach(function (set) {
          if (!set.done) return;
          any = true;
          html += "<li>" + esc(setLine(ex, set)) + "</li>";
        });
      });
      if (!any) html += "<li>Nothing checked off.</li>";
      html += "</ul>";
      html += '<div class="actions">';
      html += '<button type="button" class="btn btn-ghost" data-action="open" data-id="' + esc(s.id) + '">Open</button>';
      html += '<button type="button" class="btn btn-ghost" data-action="delete" data-id="' + esc(s.id) + '">Delete</button>';
      html += "</div></details>";
    });
    html += "</section>";
    root.innerHTML = html;
  }

  function setLine(ex, set) {
    var side = set.side === "L" ? "Left " : set.side === "R" ? "Right " : "";
    if (ex.kind === "hold") return ex.name + " · " + side + "set " + set.n + ": " + (set.seconds === "" || set.seconds == null ? "—" : set.seconds + "s");
    var w = set.weightLb === "" || set.weightLb == null ? "—" : set.weightLb + " lb";
    var r = set.reps === "" || set.reps == null ? "—" : set.reps;
    return ex.name + " · " + side + "set " + set.n + ": " + w + " × " + r;
  }

  function syncBadge(s) {
    if (s.synced) return '<span class="badge">Sent</span>';
    if (s.finishedAt) return '<span class="badge wait">Waiting to send</span>';
    return '<span class="badge wait">In progress</span>';
  }

  function doneCount(session) {
    var n = 0;
    (session.exercises || []).forEach(function (ex) {
      (ex.sets || []).forEach(function (set) { if (set.done) n += 1; });
    });
    return n;
  }

  function renderSettings() {
    var root = document.getElementById("viewSettings");
    if (!root) return;
    var url = state.settings.scriptUrl || "";
    var queued = state.sessions.filter(function (s) { return s.finishedAt && !s.synced; }).length;
    var soundOn = state.settings.sound !== false;
    var html = '<section class="card card-pad stack">';
    html += "<h2>Settings</h2>";
    html += '<label class="field" for="scriptUrl">Google Sheet web app URL<input id="scriptUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(url) + '" /></label>';
    html += '<p class="hint">Paste the Apps Script web app URL. It stays on this phone and is never saved in the repo. Execute as you, access Anyone.</p>';
    html += '<label class="checkline"><input id="soundOn" type="checkbox"' + (soundOn ? " checked" : "") + " /> Beep and vibrate when rest ends</label>";
    html += '<div class="actions">';
    html += '<button type="button" class="btn btn-primary" data-action="save-settings">Save</button>';
    html += '<button type="button" class="btn btn-ghost" data-action="retry">Send waiting (' + queued + ")</button>";
    html += '<button type="button" class="btn btn-ghost" data-action="export">Export CSV</button>';
    html += "</div>";
    html += '<p class="status" id="settingsStatus"></p>';
    html += '<p class="hint">Setup steps are in apps-script/SETUP.md in the repo. Finish a workout here, then publish the Sets tab as CSV and put that link in docs/data.json as program.workoutsCsvUrl.</p>';
    html += "</section>";
    root.innerHTML = html;
  }

  function showView(name) {
    currentView = name;
    var today = document.getElementById("viewToday");
    var history = document.getElementById("viewHistory");
    var settings = document.getElementById("viewSettings");
    if (today) today.hidden = name !== "today";
    if (history) history.hidden = name !== "history";
    if (settings) settings.hidden = name !== "settings";
    setTab("tabToday", name === "today");
    setTab("tabHistory", name === "history");
    setTab("tabSettings", name === "settings");
    if (name === "today") renderToday();
    if (name === "history") renderHistory();
    if (name === "settings") renderSettings();
    var next = name === "today" ? "" : "#" + name;
    if ((location.hash || "") !== next) {
      if (name === "today") historyReplace("");
      else location.hash = next;
    }
  }

  function historyReplace(hash) {
    var path = location.pathname + location.search;
    if (history.replaceState) history.replaceState(null, "", path + (hash || ""));
    else location.hash = hash || "";
  }

  function setTab(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }

  function viewFromHash() {
    var h = (location.hash || "").replace("#", "");
    if (h === "history" || h === "settings") return h;
    return "today";
  }

  function actionEl(node) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute("data-action")) return node;
      node = node.parentNode;
    }
    return null;
  }

  function onTodayClick(e) {
    var el = actionEl(e.target);
    if (!el || !program) return;
    var action = el.getAttribute("data-action");
    if (action === "day") {
      state.overrides[uiDate] = el.getAttribute("data-day");
      saveState();
      finishNote = "";
      renderToday();
      return;
    }
    if (!active || active.synced) return;
    if (action === "bell") {
      var set = setFrom(el);
      if (!set) return;
      set.weightLb = el.getAttribute("data-weight");
      persistSession(active);
      renderToday();
      return;
    }
    if (action === "done") {
      var doneSet = setFrom(el);
      if (!doneSet) return;
      var ex = active.exercises[Number(el.getAttribute("data-ex"))];
      doneSet.done = !doneSet.done;
      doneSet.doneAt = doneSet.done ? new Date().toISOString() : "";
      persistSession(active);
      if (doneSet.done) startRest((ex.plan && ex.plan.restSec) || 90, ex.name);
      renderToday();
      return;
    }
    if (action === "finish") finishActive();
  }

  function setFrom(el) {
    if (!active) return null;
    var ex = active.exercises[Number(el.getAttribute("data-ex"))];
    if (!ex) return null;
    return ex.sets[Number(el.getAttribute("data-set"))] || null;
  }

  function onTodayChange(e) {
    var t = e.target;
    if (!t || t.id !== "logDate") return;
    uiDate = /^\d{4}-\d{2}-\d{2}$/.test(t.value) ? t.value : nyTodayISO();
    finishNote = "";
    renderToday();
  }

  function onTodayInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute("data-field")) return;
    if (!active || active.synced) return;
    var ex = active.exercises[Number(t.getAttribute("data-ex"))];
    var set = ex && ex.sets[Number(t.getAttribute("data-set"))];
    if (!set) return;
    var field = t.getAttribute("data-field");
    if (field === "weight") set.weightLb = t.value;
    else if (field === "reps") set.reps = t.value;
    else if (field === "seconds") set.seconds = t.value;
    persistSession(active);
    if (field === "weight" && t.parentNode) {
      var buttons = t.parentNode.querySelectorAll("[data-action='bell']");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-weight") === String(t.value) ? "true" : "false");
      }
    }
  }

  function onHistoryClick(e) {
    var el = actionEl(e.target);
    if (!el) return;
    var action = el.getAttribute("data-action");
    if (action === "export") { exportCsv(); return; }
    var id = el.getAttribute("data-id");
    var session = sessionById(id);
    if (!session) return;
    if (action === "open") {
      uiDate = session.date;
      state.overrides[session.date] = session.dayId;
      saveState();
      showView("today");
      return;
    }
    if (action === "delete") {
      var extra = session.synced ? " It stays on the sheet." : "";
      if (!window.confirm("Delete this session from the phone?" + extra)) return;
      state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
      saveState();
      renderHistory();
    }
  }

  function onSettingsClick(e) {
    var el = actionEl(e.target);
    if (!el) return;
    var action = el.getAttribute("data-action");
    if (action === "export") { exportCsv(); return; }
    if (action === "save-settings") saveSettings();
    if (action === "retry") {
      flushQueue().then(function () {
        var waiting = state.sessions.filter(function (s) { return s.finishedAt && !s.synced; }).length;
        setSettingsStatus(waiting ? "Still waiting to send " + waiting + "." : "Sent.");
        renderSettings();
        var status = document.getElementById("settingsStatus");
        if (status) status.textContent = waiting ? "Still waiting to send " + waiting + "." : "Sent.";
      });
    }
  }

  function saveSettings() {
    var input = document.getElementById("scriptUrl");
    var sound = document.getElementById("soundOn");
    var url = input ? input.value.trim() : "";
    if (url && url.indexOf("https://") !== 0) {
      setSettingsStatus("The web app URL has to start with https://");
      return;
    }
    state.settings.scriptUrl = url;
    state.settings.sound = !sound || sound.checked;
    saveState();
    var msg = "Saved on this phone.";
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec\/?$/.test(url)) {
      msg = "Saved. That does not look like a web app URL. It should start with https://script.google.com/macros/s/ and end with /exec.";
    }
    flushQueue().then(function () {
      setSettingsStatus(msg);
      if (currentView === "settings") {
        renderSettings();
        var status = document.getElementById("settingsStatus");
        if (status) status.textContent = msg;
      }
    });
  }

  function setSettingsStatus(msg) {
    var status = document.getElementById("settingsStatus");
    if (status) status.textContent = msg;
  }

  function finishActive() {
    if (!active || active.synced || sending) return;
    if (doneCount(active) < 1) {
      finishNote = "Check off at least one set.";
      finishNoteFor = active.id;
      var status = document.getElementById("finishStatus");
      if (status) status.textContent = finishNote;
      return;
    }
    if (!active.finishedAt) active.finishedAt = new Date().toISOString();
    persistSession(active);
    var id = active.id;
    finishNote = "Saving…";
    finishNoteFor = id;
    var live = document.getElementById("finishStatus");
    if (live) live.textContent = finishNote;
    sending = true;
    flushQueue().then(function () {
      sending = false;
      var s = sessionById(id);
      if (!s) return;
      if (s.synced) finishNote = "Sent to the sheet.";
      else if (!(state.settings.scriptUrl || "").trim()) finishNote = "Saved on this phone. Add the sheet URL in Settings to send it.";
      else if (typeof navigator !== "undefined" && navigator.onLine === false) finishNote = "Saved on this phone. Will send when you are back online.";
      else finishNote = "Saved on this phone. " + (s.syncError || "The send did not go through. It will retry.");
      finishNoteFor = id;
      if (currentView === "today") renderToday();
    });
  }

  function buildPayload(session) {
    var sets = [];
    (session.exercises || []).forEach(function (ex) {
      (ex.sets || []).forEach(function (set) {
        if (!set.done) return;
        sets.push({
          exercise: ex.name,
          side: set.side || "",
          setNumber: set.n,
          weightLb: numOrNull(set.weightLb),
          reps: numOrNull(set.reps),
          seconds: numOrNull(set.seconds),
          loggedAt: set.doneAt || session.finishedAt || session.updatedAt || ""
        });
      });
    });
    return {
      sessionId: session.id,
      date: session.date,
      day: session.dayId,
      loggedAt: session.finishedAt || session.updatedAt || "",
      sets: sets
    };
  }

  function csvEscape(v) {
    var s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function sessionsToCsv(sessions) {
    var header = ["date", "workout day", "exercise", "side", "set number", "weight lb", "reps", "seconds", "session id", "logged at"];
    var lines = [header.join(",")];
    (sessions || []).forEach(function (session) {
      var payload = buildPayload(session);
      payload.sets.forEach(function (set) {
        lines.push([
          payload.date,
          payload.day,
          set.exercise,
          set.side,
          set.setNumber,
          set.weightLb == null ? "" : set.weightLb,
          set.reps == null ? "" : set.reps,
          set.seconds == null ? "" : set.seconds,
          payload.sessionId,
          set.loggedAt || payload.loggedAt
        ].map(csvEscape).join(","));
      });
    });
    return lines.join("\n");
  }

  function exportCsv() {
    var csv = sessionsToCsv(state.sessions);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "workouts.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function postSession(url, session) {
    var payload = JSON.stringify(buildPayload(session));
    return fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: payload
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = {};
        try { body = JSON.parse(text); } catch (e) { body = {}; }
        if (body && body.ok === true) return body;
        if (text && (text.indexOf("<html") !== -1 || text.indexOf("<HTML") !== -1)) {
          throw new Error("The sheet link needs Anyone access.");
        }
        throw new Error((body && body.error) || ("Could not confirm the send (" + res.status + ")"));
      });
    });
  }

  var flushPromise = null;
  function flushQueue() {
    if (flushPromise) return flushPromise;
    flushPromise = flushQueueNow().then(function (result) {
      flushPromise = null;
      return result;
    }, function (err) {
      flushPromise = null;
      throw err;
    });
    return flushPromise;
  }

  function flushQueueNow() {
    var url = (state.settings.scriptUrl || "").trim();
    if (!url || (typeof navigator !== "undefined" && navigator.onLine === false)) return Promise.resolve();
    var pending = state.sessions.filter(function (s) { return s.finishedAt && !s.synced; });
    var chain = Promise.resolve();
    pending.forEach(function (session) {
      chain = chain.then(function () {
        if (session.synced) return null;
        return postSession(url, session).then(function () {
          session.synced = true;
          session.syncError = "";
          saveState();
        }).catch(function (err) {
          session.syncError = err && err.message ? err.message : "Send failed";
          saveState();
        });
      });
    });
    return chain;
  }

  function unlockAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep() {
    if (state.settings.sound === false) return;
    try {
      unlockAudio();
      if (audioCtx) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        var now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.42);
      }
      if (navigator.vibrate) navigator.vibrate([200, 80, 200, 80, 280]);
    } catch (e) {}
  }

  function startRest(seconds, label) {
    stopRest(false);
    var total = Math.max(1, Number(seconds) || 90);
    restTimer = { endsAt: Date.now() + total * 1000, label: label || "Rest" };
    restFired = false;
    var bar = document.getElementById("restBar");
    document.body.classList.add("resting");
    if (bar) {
      bar.hidden = false;
      bar.classList.remove("done");
    }
    tickRest();
    restTimerId = setInterval(tickRest, 200);
  }

  function stopRest(hide) {
    if (restTimerId) clearInterval(restTimerId);
    restTimerId = null;
    restTimer = null;
    restFired = false;
    if (hide !== false) {
      document.body.classList.remove("resting");
      var bar = document.getElementById("restBar");
      if (bar) {
        bar.hidden = true;
        bar.classList.remove("done");
      }
    }
  }

  function tickRest() {
    if (!restTimer) return;
    var left = Math.ceil((restTimer.endsAt - Date.now()) / 1000);
    var clock = document.getElementById("restClock");
    var label = document.getElementById("restLabel");
    var bar = document.getElementById("restBar");
    if (label) label.textContent = left <= 0 ? "Rest done" : ("Rest · " + (restTimer.label || ""));
    if (left <= 0) {
      if (clock) clock.textContent = "0:00";
      if (bar) bar.classList.add("done");
      if (!restFired) {
        restFired = true;
        beep();
      }
      if (restTimerId) {
        clearInterval(restTimerId);
        restTimerId = null;
      }
      return;
    }
    if (bar) bar.classList.remove("done");
    var m = Math.floor(left / 60);
    var s = left % 60;
    if (clock) clock.textContent = m + ":" + (s < 10 ? "0" : "") + s;
  }

  function nudgeRest(delta) {
    if (!restTimer) return;
    restTimer.endsAt += delta * 1000;
    if (restTimer.endsAt > Date.now()) {
      restFired = false;
      var bar = document.getElementById("restBar");
      if (bar) bar.classList.remove("done");
      if (!restTimerId) restTimerId = setInterval(tickRest, 200);
    }
    tickRest();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    var btn = document.getElementById("themeToggle");
    if (btn) btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }

  function initialTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (stored === "light" || stored === "dark") return stored;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    return "dark";
  }

  function wire() {
    applyTheme(initialTheme());
    document.getElementById("viewToday").addEventListener("click", onTodayClick);
    document.getElementById("viewToday").addEventListener("change", onTodayChange);
    document.getElementById("viewToday").addEventListener("input", onTodayInput);
    document.getElementById("viewHistory").addEventListener("click", onHistoryClick);
    document.getElementById("viewSettings").addEventListener("click", onSettingsClick);
    document.getElementById("tabToday").addEventListener("click", function () { showView("today"); });
    document.getElementById("tabHistory").addEventListener("click", function () { showView("history"); });
    document.getElementById("tabSettings").addEventListener("click", function () { showView("settings"); });
    document.getElementById("themeToggle").addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
    });
    document.getElementById("restMinus").addEventListener("click", function () { nudgeRest(-15); });
    document.getElementById("restPlus").addEventListener("click", function () { nudgeRest(15); });
    document.getElementById("restSkip").addEventListener("click", function () { stopRest(true); });
    document.getElementById("installBtn").addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        document.getElementById("installBtn").hidden = true;
      });
    });
    document.addEventListener("pointerdown", unlockAudio);
    document.addEventListener("visibilitychange", tickRest);
    window.addEventListener("online", function () {
      flushQueue().then(function () {
        if (active && active.synced && finishNoteFor === active.id) finishNote = "Sent to the sheet.";
        if (currentView === "today") renderToday();
        else if (currentView === "history") renderHistory();
        else if (currentView === "settings") renderSettings();
      });
    });
    window.addEventListener("hashchange", function () {
      var name = viewFromHash();
      if (name !== currentView) showView(name);
    });
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      document.getElementById("installBtn").hidden = false;
    });
  }

  function boot() {
    wire();
    fetch("./program.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        program = data;
        var err = document.getElementById("loadError");
        if (err) err.hidden = true;
      })
      .catch(function () {
        program = null;
        var err = document.getElementById("loadError");
        if (err) err.hidden = false;
      })
      .then(function () {
        showView(viewFromHash());
        flushQueue();
      });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function () {});
    }
  }

  var api = {
    nyTodayISO: nyTodayISO,
    weekdayOf: weekdayOf,
    suggestNext: suggestNext,
    suggestExercise: suggestExercise,
    isDeload: isDeload,
    autoDay: autoDay,
    buildPayload: buildPayload,
    sessionsToCsv: sessionsToCsv,
    weekFor: weekFor
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
