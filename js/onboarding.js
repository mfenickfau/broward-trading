/* Broward Trading — js/onboarding.js → BT.onboarding (v0.4)
 *
 * Engine for start.html, the seven-day "First Week" path for complete beginners.
 * Pure data: it never touches the DOM, so it loads standalone and is unit-tested
 * in Node with a `window` + `localStorage` shim (tests/onboarding.test.js).
 *
 * Plan: course/firstweek.json → { days:[{day, id, title, minutes, intro, tasks:[
 *   {id, title, minutes, why, steps[], link:{href,label}, check:{type, ...}} ]}],
 *   outcomes[], completion:{title, body, next[]} }.
 *
 * Checks read the real localStorage shapes written by the other modules and never
 * throw: a missing, malformed or foreign-shaped key simply counts as "not done".
 *   lesson    {lessonId}                       bt.course.lessonsDone[lessonId]
 *   quiz      {lessonId, minPct=60}            bt.course.quizScores[lessonId] >= minPct
 *   watchlist {min | added}                    bt.watchlist (js/app.js); `added` counts
 *                                              symbols that are not in the default list
 *   trade     {account='main', min=1, side?, kind?, closed?, orderType?}
 *                                              bt.portfolio / bt.portfolio.<id> (js/paper.js):
 *                                              fills in .trades, or orders in .orders when
 *                                              orderType is given
 *   replay    {min=1, completed?, drill?|drillId?}  bt.replay.sessions (js/replay.js)
 *   journal   {min=1, field?, reviewed?, review?, source?}  bt.journal (js/journal.js):
 *                                              entries, or .reviews when review:true
 *   alert     {min=1, kind?, symbol?}          bt.alerts (js/alerts.js)
 *   glossary  {mode:'flashcards'|'daily5', min} bt.flashcards / bt.daily5 (js/glossary.js)
 *   tour      —                                bt.tour.done (js/app.js first-run tour)
 *   manual    —                                ticked by the student on start.html
 * Any auto task can also be overridden by the student ("I did this elsewhere").
 *
 * Progress lives in localStorage 'bt.onboarding':
 *   { version, startedAt, manual:{taskId:true}, overrides:{taskId:true},
 *     unlocked:{dayNumber:true}, dayDone:{dayNumber:iso}, completedAt, lastSeenDay }
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};

  var VERSION = '0.4.0';
  var STORE_KEY = 'bt.onboarding';
  var PLAN_FILE = 'firstweek.json';
  var COURSE_DIR = 'course/';
  var DEFAULT_QUIZ_PCT = 60;
  // Mirrors DEFAULT_WATCHLIST in js/app.js: symbols a brand-new dashboard already shows,
  // so "add three symbols" means three the student chose, not the ones that came free.
  var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN'];

  var KEYS = {
    course: 'bt.course', watchlist: 'bt.watchlist', portfolio: 'bt.portfolio', replay: 'bt.replay.sessions',
    journal: 'bt.journal', alerts: 'bt.alerts', flashcards: 'bt.flashcards', daily5: 'bt.daily5', tour: 'bt.tour.done'
  };

  /* ------------------------------------------------------------------ *
   * Safe storage (private windows throw, Node has none)
   * ------------------------------------------------------------------ */
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function lsGet(k, d) {
    try { var s = ls(); if (!s) return d; var v = s.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSet(k, v) { try { var s = ls(); if (!s) return false; s.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { var s = ls(); if (s) s.removeItem(k); } catch (e) { /* ignore */ } }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return String(v == null ? '' : v); }
  function clock() { return Date.now(); }
  var now = clock;
  function setClock(fn) { now = typeof fn === 'function' ? fn : clock; }
  function iso() { return new Date(now()).toISOString(); }
  function T(s, v) {
    if (BT.t) return BT.t(s, v);
    return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s;
  }

  /* ------------------------------------------------------------------ *
   * Plan loading / normalisation
   * ------------------------------------------------------------------ */
  var _plan = null, _planPromise = null;

  function normaliseCheck(c) {
    if (!isObj(c)) return { type: 'manual' };
    var out = {}; Object.keys(c).forEach(function (k) { out[k] = c[k]; });
    out.type = str(c.type || 'manual').toLowerCase();
    if (!EVALUATORS[out.type]) out.type = 'manual';
    return out;
  }
  function normaliseTask(t, dayId, i) {
    t = isObj(t) ? t : {};
    var link = isObj(t.link) && t.link.href ? { href: str(t.link.href), label: str(t.link.label || 'Open') } : null;
    return {
      id: str(t.id || (dayId + '-t' + (i + 1))),
      title: str(t.title || ('Task ' + (i + 1))),
      minutes: isNum(t.minutes) ? t.minutes : null,
      why: str(t.why || ''),
      steps: arr(t.steps).map(str),
      link: link,
      check: normaliseCheck(t.check)
    };
  }
  function normaliseDay(d, i) {
    d = isObj(d) ? d : {};
    var id = str(d.id || ('d' + (i + 1)));
    return {
      day: isNum(d.day) ? d.day : i + 1,
      id: id,
      title: str(d.title || ('Day ' + (i + 1))),
      minutes: isNum(d.minutes) ? d.minutes : null,
      intro: str(d.intro || ''),
      tasks: arr(d.tasks).map(function (t, j) { return normaliseTask(t, id, j); })
    };
  }
  function normalisePlan(json) {
    json = isObj(json) ? json : {};
    var comp = isObj(json.completion) ? json.completion : {};
    return {
      version: str(json.version || ''),
      id: str(json.id || 'firstweek'),
      title: str(json.title || 'Your First Week'),
      summary: str(json.summary || ''),
      honesty: str(json.honesty || ''),
      minutesPerDay: isNum(json.minutesPerDay) ? json.minutesPerDay : 20,
      outcomes: arr(json.outcomes).map(str),
      days: arr(json.days).map(normaliseDay),
      completion: {
        title: str(comp.title || 'You finished your first week'),
        body: str(comp.body || ''),
        next: arr(comp.next).filter(function (n) { return isObj(n) && n.href; }).map(function (n) { return { href: str(n.href), label: str(n.label || n.href) }; })
      },
      lang: str(json.lang || 'en'),
      englishOnly: !!json.englishOnly
    };
  }
  function setPlan(json) { _plan = normalisePlan(json); _planPromise = Promise.resolve(_plan); return _plan; }
  function plan() { return _plan; }

  async function fetchJSON(file) {
    var res = await fetch(file, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file);
    return res.json();
  }
  /** load() → Promise<plan>. Tries course/<lang>/firstweek.json first (js/i18n.js), then the English file. */
  function load(force) {
    if (_plan && !force) return Promise.resolve(_plan);
    if (_planPromise && !force) return _planPromise;
    var lang = 'en';
    try { lang = (BT.i18n && BT.i18n.lang && BT.i18n.lang()) || 'en'; } catch (e) { lang = 'en'; }
    var p;
    if (lang && lang !== 'en') {
      p = fetchJSON(COURSE_DIR + lang + '/' + PLAN_FILE).then(function (j) { j = isObj(j) ? j : {}; j.lang = lang; return j; })
        .catch(function () { return fetchJSON(COURSE_DIR + PLAN_FILE).then(function (j) { j = isObj(j) ? j : {}; j.lang = 'en'; j.englishOnly = true; return j; }); });
    } else {
      p = fetchJSON(COURSE_DIR + PLAN_FILE);
    }
    _planPromise = p.then(function (json) { _plan = normalisePlan(json); return _plan; })
      .catch(function (e) { _planPromise = null; throw e; });
    return _planPromise;
  }

  /* ------------------------------------------------------------------ *
   * Progress state (bt.onboarding)
   * ------------------------------------------------------------------ */
  function freshState() {
    return { version: 1, startedAt: null, manual: {}, overrides: {}, unlocked: {}, dayDone: {}, completedAt: null, lastSeenDay: 1 };
  }
  function loadState() {
    var s = freshState(), saved = lsGet(STORE_KEY, null);
    if (!isObj(saved)) return s;
    s.startedAt = typeof saved.startedAt === 'string' ? saved.startedAt : null;
    s.completedAt = typeof saved.completedAt === 'string' ? saved.completedAt : null;
    ['manual', 'overrides', 'unlocked', 'dayDone'].forEach(function (k) { if (isObj(saved[k])) s[k] = saved[k]; });
    s.lastSeenDay = isNum(saved.lastSeenDay) && saved.lastSeenDay >= 1 ? Math.floor(saved.lastSeenDay) : 1;
    return s;
  }
  function saveState(s) { return lsSet(STORE_KEY, s); }
  function touch(s) { if (!s.startedAt) s.startedAt = iso(); return s; }

  function progress() { return loadState(); }
  function reset() { lsDel(STORE_KEY); return freshState(); }

  /** Student ticks a manual task (or unticks it). */
  function setManual(taskId, done) {
    var s = touch(loadState());
    if (done === false) delete s.manual[taskId]; else s.manual[taskId] = true;
    saveState(s); return s;
  }
  /** Student says "I did this elsewhere" for an auto-checked task. */
  function setOverride(taskId, done) {
    var s = touch(loadState());
    if (done === false) delete s.overrides[taskId]; else s.overrides[taskId] = true;
    saveState(s); return s;
  }
  /** Skip ahead: unlock a day without finishing the one before it. */
  function unlock(day) {
    var s = touch(loadState());
    day = Math.floor(+day);
    if (isNum(day) && day >= 1) s.unlocked[day] = true;
    saveState(s); return s;
  }
  function setLastSeen(day) {
    var s = loadState(); day = Math.floor(+day);
    if (isNum(day) && day >= 1) { s.lastSeenDay = day; saveState(s); }
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Check evaluators. Each returns {done, n, of, detail}; never throws.
   * ------------------------------------------------------------------ */
  function result(done, n, of, detail) { return { done: !!done, n: isNum(n) ? n : (done ? 1 : 0), of: isNum(of) ? of : 1, detail: str(detail) }; }
  function countOf(c, d) { var m = c && isNum(+c.min) ? Math.max(1, Math.floor(+c.min)) : d; return m; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function evalLesson(c) {
    var p = lsGet(KEYS.course, null);
    var done = !!(isObj(p) && isObj(p.lessonsDone) && p.lessonsDone[str(c.lessonId)] === true);
    return result(done, done ? 1 : 0, 1, done ? T('Lesson marked done') : T('Not marked done yet'));
  }
  function evalQuiz(c) {
    var p = lsGet(KEYS.course, null);
    var min = isNum(+c.minPct) ? +c.minPct : DEFAULT_QUIZ_PCT;
    var score = isObj(p) && isObj(p.quizScores) ? p.quizScores[str(c.lessonId)] : null;
    if (!isNum(score)) return result(false, 0, 1, T('Quiz not taken yet (need {pct}%)', { pct: min }));
    return result(score >= min, score >= min ? 1 : 0, 1, T('Best score {score}% (need {pct}%)', { score: Math.round(score), pct: min }));
  }
  function evalWatchlist(c) {
    var w = lsGet(KEYS.watchlist, null);
    if (!Array.isArray(w)) return result(false, 0, isNum(+c.added) ? +c.added : countOf(c, 1), T('Watchlist not changed yet'));
    var syms = w.filter(function (s) { return typeof s === 'string'; }).map(function (s) { return s.toUpperCase(); });
    if (isNum(+c.added) && +c.added > 0) {
      var own = syms.filter(function (s) { return DEFAULT_WATCHLIST.indexOf(s) === -1; });
      var need = Math.floor(+c.added);
      return result(own.length >= need, Math.min(own.length, need), need, T('{n} of {of} symbols of your own added', { n: own.length, of: need }));
    }
    var min = countOf(c, 1);
    return result(syms.length >= min, Math.min(syms.length, min), min, T('{n} symbols on the watchlist', { n: syms.length }));
  }
  function portfolioKey(account) {
    var id = str(account || 'main').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'main';
    return id === 'main' ? KEYS.portfolio : KEYS.portfolio + '.' + id;
  }
  function evalTrade(c) {
    var p = lsGet(portfolioKey(c.account), null);
    var min = countOf(c, 1);
    if (!isObj(p)) return result(false, 0, min, T('No paper trades yet'));
    var types = c.orderType ? arr(Array.isArray(c.orderType) ? c.orderType : [c.orderType]).map(function (t) { return str(t).toLowerCase(); }) : null;
    var n;
    if (types) {
      n = arr(p.orders).filter(function (o) {
        if (!isObj(o)) return false;
        if (types.indexOf(str(o.type).toLowerCase()) === -1) return false;
        if (c.side && str(o.side).toLowerCase() !== str(c.side).toLowerCase()) return false;
        var st = str(o.status).toLowerCase();
        return st === 'filled' || st === 'open';
      }).length;
      return result(n >= min, Math.min(n, min), min, n ? T('{n} matching orders placed', { n: n }) : T('No {type} order yet', { type: types.join('/') }));
    }
    n = arr(p.trades).filter(function (t) {
      if (!isObj(t)) return false;
      if (c.side && str(t.side).toLowerCase() !== str(c.side).toLowerCase()) return false;
      if (c.kind && str(t.kind || 'stock').toLowerCase() !== str(c.kind).toLowerCase()) return false;
      if (c.closed && !(isNum(t.closedQty) && t.closedQty > 0)) return false;
      return true;
    }).length;
    return result(n >= min, Math.min(n, min), min, n ? plural(n, T('paper fill'), T('paper fills')) : T('No paper trades yet'));
  }
  function evalReplay(c) {
    var list = lsGet(KEYS.replay, null);
    var min = countOf(c, 1);
    if (!Array.isArray(list)) return result(false, 0, min, T('No replay sessions yet'));
    var n = list.filter(function (s) {
      if (!isObj(s)) return false;
      if (c.completed && !s.completed) return false;
      if (c.drillId && !(isObj(s.drill) && s.drill.id === str(c.drillId))) return false;
      if (c.drill && !c.drillId && !(isObj(s.drill) && s.drill.id)) return false;
      if (c.passed && !(isObj(s.drill) && s.drill.passed)) return false;
      return true;
    }).length;
    var what = c.drill || c.drillId ? (c.completed ? T('drill finished') : T('drill session')) : (c.completed ? T('session finished') : T('session'));
    return result(n >= min, Math.min(n, min), min, n ? n + ' ' + what + (n === 1 ? '' : 's') : T('None yet'));
  }
  function evalJournal(c) {
    var j = lsGet(KEYS.journal, null);
    var min = countOf(c, 1);
    if (!isObj(j)) return result(false, 0, min, c.review ? T('No weekly review saved yet') : T('No journal entries yet'));
    var n;
    if (c.review) {
      n = isObj(j.reviews) ? Object.keys(j.reviews).filter(function (k) { return isObj(j.reviews[k]); }).length : 0;
      return result(n >= min, Math.min(n, min), min, n ? plural(n, T('weekly review saved'), T('weekly reviews saved')) : T('No weekly review saved yet'));
    }
    n = arr(j.entries).filter(function (e) {
      if (!isObj(e)) return false;
      if (c.source && str(e.source) !== str(c.source)) return false;
      if (c.reviewed && !(str(e.setup).trim() && str(e.emotion).trim())) return false;
      if (c.field && !str(e[str(c.field)]).trim()) return false;
      return true;
    }).length;
    var label = c.field === 'lessons' ? (n === 1 ? T('entry with a lesson written') : T('entries with a lesson written'))
      : c.reviewed ? (n === 1 ? T('reviewed entry') : T('reviewed entries')) : (n === 1 ? T('journal entry') : T('journal entries'));
    return result(n >= min, Math.min(n, min), min, n ? n + ' ' + label : T('None yet'));
  }
  function evalAlert(c) {
    var list = lsGet(KEYS.alerts, null);
    var min = countOf(c, 1);
    if (!Array.isArray(list)) return result(false, 0, min, T('No alerts yet'));
    var n = list.filter(function (a) {
      if (!isObj(a) || !a.symbol || !a.kind) return false;
      if (c.kind && str(a.kind) !== str(c.kind)) return false;
      if (c.symbol && str(a.symbol).toUpperCase() !== str(c.symbol).toUpperCase()) return false;
      return true;
    }).length;
    return result(n >= min, Math.min(n, min), min, n ? plural(n, T('alert set'), T('alerts set')) : T('No alerts yet'));
  }
  function evalGlossary(c) {
    var mode = str(c.mode || 'flashcards').toLowerCase();
    var min = countOf(c, 1), n = 0;
    if (mode === 'daily5' || mode === 'daily') {
      var d = lsGet(KEYS.daily5, null);
      n = isObj(d) && isObj(d.history) ? Object.keys(d.history).filter(function (k) { return isObj(d.history[k]); }).length : 0;
      return result(n >= min, Math.min(n, min), min, n ? plural(n, T('Daily 5 completed'), T('Daily 5s completed')) : T('No Daily 5 yet'));
    }
    var f = lsGet(KEYS.flashcards, null);
    if (isObj(f)) {
      var cards = isObj(f.cards) ? f.cards : {};
      var rated = Object.keys(cards).filter(function (id) { var cd = cards[id]; return isObj(cd) && isNum(cd.reps) && cd.reps > 0; }).length;
      n = Math.max(rated, isNum(f.reviews) ? f.reviews : 0);
    }
    return result(n >= min, Math.min(n, min), min, n ? T('{n} of {of} cards reviewed', { n: Math.min(n, min), of: min }) : T('No flashcards reviewed yet'));
  }
  function evalTour() {
    var v = lsGet(KEYS.tour, null);
    var done = v === true || v === 'true' || v === 1;
    return result(done, done ? 1 : 0, 1, done ? T('Tour finished') : T('Tour not finished yet'));
  }
  function evalManual(c, task, state) {
    var done = !!(state && isObj(state.manual) && state.manual[task.id] === true);
    return result(done, done ? 1 : 0, 1, done ? T('Ticked by you') : T('Tick the box when you have done it'));
  }

  var EVALUATORS = {
    lesson: evalLesson, quiz: evalQuiz, watchlist: evalWatchlist, trade: evalTrade, replay: evalReplay,
    journal: evalJournal, alert: evalAlert, glossary: evalGlossary, tour: evalTour, manual: evalManual
  };

  /** evaluate(check, task?, state?) → {done, n, of, detail}. Unknown types and thrown errors count as not done. */
  function evaluate(check, task, state) {
    check = normaliseCheck(check);
    task = task || { id: '' };
    state = state || loadState();
    try {
      var fn = EVALUATORS[check.type] || evalManual;
      var r = fn(check, task, state);
      return isObj(r) ? r : result(false);
    } catch (e) { return result(false, 0, 1, ''); }
  }

  /* ------------------------------------------------------------------ *
   * status(): the whole week, evaluated against localStorage right now
   * ------------------------------------------------------------------ */
  function status(p) {
    p = p ? normalisePlan(p) : _plan;
    var s = loadState();
    var out = { plan: p, days: [], done: 0, total: 0, pct: 0, currentDay: 1, complete: false, startedAt: s.startedAt, completedAt: s.completedAt };
    if (!p) return out;
    var prevComplete = true, changed = false, current = null;
    p.days.forEach(function (d, i) {
      var tasks = d.tasks.map(function (t) {
        var auto = t.check.type !== 'manual';
        var r = evaluate(t.check, t, s);
        var overridden = auto && s.overrides[t.id] === true;
        var done = r.done || overridden;
        return {
          id: t.id, title: t.title, minutes: t.minutes, why: t.why, steps: t.steps, link: t.link, check: t.check,
          auto: auto, done: done, overridden: overridden, n: done ? r.of : r.n, of: r.of, detail: r.detail
        };
      });
      var done = tasks.filter(function (t) { return t.done; }).length;
      var total = tasks.length;
      var complete = total > 0 && done === total;
      var unlocked = i === 0 || prevComplete || s.unlocked[d.day] === true;
      if (complete && !s.dayDone[d.day]) { s.dayDone[d.day] = iso(); changed = true; }
      if (!complete && s.dayDone[d.day]) { delete s.dayDone[d.day]; changed = true; }
      var row = {
        day: d.day, id: d.id, title: d.title, minutes: d.minutes, intro: d.intro, tasks: tasks,
        done: done, total: total, pct: total ? Math.round(done / total * 100) : 0,
        complete: complete, unlocked: unlocked, skipped: !complete && unlocked && !prevComplete && i > 0,
        completedAt: s.dayDone[d.day] || null, current: false
      };
      if (!current && unlocked && !complete) current = row;
      out.days.push(row);
      out.done += done; out.total += total;
      prevComplete = complete;
    });
    if (!current && out.days.length) current = out.days[out.days.length - 1];
    if (current) { current.current = true; out.currentDay = current.day; }
    out.pct = out.total ? Math.round(out.done / out.total * 100) : 0;
    out.complete = out.total > 0 && out.done === out.total;
    if (out.complete && !s.completedAt) { s.completedAt = iso(); changed = true; }
    if (!out.complete && s.completedAt) { s.completedAt = null; changed = true; }
    if (changed && (s.startedAt || out.done > 0)) { touch(s); saveState(s); }
    out.startedAt = s.startedAt; out.completedAt = s.completedAt;
    out.minutesLeft = out.days.reduce(function (sum, d) {
      return sum + d.tasks.reduce(function (m, t) { return m + (t.done ? 0 : (isNum(t.minutes) ? t.minutes : 5)); }, 0);
    }, 0);
    return out;
  }

  /** Compact summary for other pages (learn.html's "Your first week" card): {started, done, total, pct, currentDay, complete}. */
  function summary(p) {
    var st = status(p);
    return { started: !!st.startedAt || st.done > 0, done: st.done, total: st.total, pct: st.pct, currentDay: st.currentDay, complete: st.complete, minutesLeft: st.minutesLeft };
  }

  BT.onboarding = {
    version: VERSION, STORE_KEY: STORE_KEY, PLAN_FILE: COURSE_DIR + PLAN_FILE, KEYS: KEYS, DEFAULT_WATCHLIST: DEFAULT_WATCHLIST,
    load: load, setPlan: setPlan, plan: plan, normalisePlan: normalisePlan,
    status: status, summary: summary, evaluate: evaluate, checkTypes: Object.keys(EVALUATORS),
    progress: progress, reset: reset, setManual: setManual, setOverride: setOverride, unlock: unlock, setLastSeen: setLastSeen,
    setClock: setClock
  };
})();
