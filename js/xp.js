/* Broward Trading — js/xp.js → BT.xp (v0.5)
 *
 * Gamification layer: XP, levels, badges, activity streaks, the trader-personality
 * quiz and an opt-in display name. Pure logic plus a tiny optional toast; it never
 * renders a page (profile.html does that) and it never touches another module's data.
 *
 * Everything is DERIVED from the stores the other modules already write, so a student
 * who used the site before v0.5 gets full credit the first time recompute() runs:
 *   bt.course              {lessonsDone, quizScores, startedAt, updatedAt, certificate}  (js/course.js)
 *   bt.portfolio[.<id>]    paper accounts: {trades[], orders[], positions, startingCash}  (js/paper.js)
 *                          league accounts are 'bt.portfolio.league-<code>' (paper normalises
 *                          'league:CODE'); 'bt.portfolio.league:<code>' is accepted as well
 *   bt.replay.sessions     [{id, at, completed, returnPct, buyHoldPct, drill:{id, passed}}] (js/replay.js)
 *   bt.journal             {entries[], reviews{}} or a bare entries array                (js/journal.js)
 *   bt.alerts              [{id, symbol, kind, createdAt}]                                (js/alerts.js)
 *   bt.flashcards          {cards{}, reviews, log:[{id, g, t}]}; bt.daily5 {history{}}    (js/glossary.js)
 *   bt.onboarding          {completedAt}                                                  (js/onboarding.js)
 *   bt.watchlist, bt.backtest, bt.rules, bt.screener.scans, bt.leagues, bt.lang
 * Missing or corrupt keys are treated as empty; nothing here throws on bad data.
 *
 * XP events (CONTRACTS.md v0.5): lesson 20, quiz ≥ 80 % 30 (+10 at 100 %), drill 25,
 * journal entry 10, first trade 15, alert 5, flashcard session 10, active (streak) day 5,
 * league finished 50. Every award is keyed ('lesson:m1-l1') so it is granted at most once;
 * XP once earned is never taken away (resetting the paper account does not erase learning).
 *
 * Anti-farming rules (XP rewards learning and reflection, never trading volume):
 *   - a journal entry pays only when it holds a written reflection (notes or a lesson of at
 *     least JOURNAL_MIN_CHARS characters; picking a setup, emotion or tag alone does not), and
 *     at most JOURNAL_PER_DAY journal awards are paid per local day;
 *   - alerts pay at most ALERT_PER_DAY award per local day (creating and deleting alerts is not practice);
 *   - activity (streak) days come from lessons, quizzes, finished replays, written journal entries,
 *     flashcards, Daily 5, the strategy tools and the personality quiz, never from paper orders or fills;
 *   - Replay Pro judges the FIRST finished attempt of each drill (remembered in bt.xp, so clearing
 *     the replay history does not reset it) and needs every drill check passed as well;
 *   - Risk Manager counts each order once and measures the risk of the whole position after it.
 *
 * Public surface
 *   BT.xp.EVENTS / LEVELS / BADGES / KEY / PROFILE_KEY
 *   award(event, key?, opts?)  → {awarded, xp, total, level, leveledUp, badges[]}   fires window 'bt:xp'
 *                                opts: {pct} for 'quiz' (below 80 is not awarded), {silent:true} no toast
 *   recompute(opts?)           → {total, gained, granted[], newBadges[], level, leveledUp}
 *                                opts: {toast:false}, {index: course/index.json}, {now: ms}
 *   summary() / total() / levelFor(xp) / badges() / history(limit) / dailyXp(days)
 *   activityDays() / streak() / facts()
 *   onChange(fn, {immediate}) → unsubscribe     (the nav level chip subscribes here)
 *   profile.get() / profile.set({displayName}) / profile.clearPersonality()     (bt.profile)
 *   personality.load(lang?) / normalize(json) / score(data, answers) / save(result, data?) / result()
 *   pathHref(item) / T(str, vars) / setClock(fn) / reset()
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  var hasDOM = typeof document !== 'undefined' && !!document.createElement;

  var VERSION = '0.5.0';
  var KEY = 'bt.xp';
  var PROFILE_KEY = 'bt.profile';
  var PASS_PCT = 80;
  var DAY_MS = 864e5;
  var MAX_HISTORY_DAYS = 3650;
  var DEFAULT_LESSON_TOTAL = 45;
  var DEFAULT_MODULE_SIZE = 5;
  var FLASH_SESSION_MIN = 5;          // grades in one day that make a "session"
  var JOURNAL_MIN_CHARS = 20;         // written notes or lesson that make an entry a reflection
  var JOURNAL_PER_DAY = 3;            // journal awards paid per local day
  var ALERT_PER_DAY = 1;              // alert awards paid per local day
  var RISK_MAX_PCT = 1;               // Risk Manager: whole-position risk to the stop, % of equity
  var SIZE_MAX_PCT = 25;              // mirrors BT.coach.THRESHOLDS.maxPositionPct
  /* Events that never mark an activity day: they are trading or setup actions, not practice. */
  var NO_DAY_EVENTS = { firstTrade: true, alert: true, options: true };
  var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN'];   // mirrors js/app.js

  /* ------------------------------------------------------------------ *
   * i18n: BT.t (i18n/es.json) first, then this module's own Spanish strings,
   * so XP copy is translated even before the shared dictionary has them.
   * ------------------------------------------------------------------ */
  function interp(s, v) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v && v[k] != null ? String(v[k]) : m; });
  }
  function curLang() {
    try { if (BT.i18n && BT.i18n.lang) return BT.i18n.lang() || 'en'; } catch (e) { /* ignore */ }
    var s = lsGet('bt.lang', null);
    return typeof s === 'string' && s ? s : 'en';
  }
  function T(s, v) {
    var plain = interp(s, v);
    var out = plain;
    try { if (BT.t) out = BT.t(s, v); } catch (e) { out = plain; }
    if (out === plain && curLang() === 'es' && Object.prototype.hasOwnProperty.call(ES, s)) return interp(ES[s], v);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Storage + clock
   * ------------------------------------------------------------------ */
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function lsGet(k, d) {
    try { var s = ls(); if (!s) return d; var v = s.getItem(k); if (v == null) return d; return JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSet(k, v) { try { var s = ls(); if (!s) return false; s.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { var s = ls(); if (s) s.removeItem(k); } catch (e) { /* ignore */ } }
  function lsKeys() {
    var out = [];
    try {
      var s = ls(); if (!s) return out;
      if (typeof s.length === 'number' && typeof s.key === 'function') {
        for (var i = 0; i < s.length; i++) { var k = s.key(i); if (typeof k === 'string') out.push(k); }
      } else {
        Object.keys(s).forEach(function (k) { if (/^bt\./.test(k)) out.push(k); });
      }
    } catch (e) { /* ignore */ }
    return out;
  }
  var clock = function () { return Date.now(); };
  var now = clock;
  function setClock(fn) { now = typeof fn === 'function' ? fn : clock; }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? '' : String(v); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(t) {
    var d = t instanceof Date ? t : new Date(t);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseDay(k) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(k)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function shiftDay(k, n) { var d = parseDay(k); if (!d) return null; d.setDate(d.getDate() + n); return dayKey(d); }
  /** Any timestamp-ish value (ms, seconds, ISO string, 'YYYY-MM-DD') → ms, or null. */
  function toMs(v) {
    if (isNum(v)) return v < 1e11 ? v * 1000 : v;
    if (typeof v === 'string' && v) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { var d = parseDay(v); return d ? d.getTime() + 12 * 3600e3 : null; }
      var p = Date.parse(v); return isFinite(p) ? p : null;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Catalogues
   * ------------------------------------------------------------------ */
  var EVENTS = {
    lesson:      { xp: 20, label: 'Lesson completed' },
    quiz:        { xp: 30, label: 'Quiz passed' },
    quizPerfect: { xp: 10, label: 'Perfect quiz score' },
    drill:       { xp: 25, label: 'Replay drill completed' },
    journal:     { xp: 10, label: 'Journal entry written' },
    firstTrade:  { xp: 15, label: 'First paper trade' },
    alert:       { xp: 5,  label: 'Alert created' },
    flashcards:  { xp: 10, label: 'Flashcard session' },
    streakDay:   { xp: 5,  label: 'Active day' },
    league:      { xp: 50, label: 'League finished' }
  };
  /* Zero-XP events that only record that something happened (they feed badges). */
  var FLAG_EVENTS = { backtest: true, screener: true, rule: true, options: true };

  var LEVELS = [
    { id: 'freshman',  name: 'Freshman',          min: 0 },
    { id: 'sophomore', name: 'Sophomore',         min: 200 },
    { id: 'junior',    name: 'Junior',            min: 500 },
    { id: 'senior',    name: 'Senior',            min: 1000 },
    { id: 'graduate',  name: 'Graduate',          min: 1800 },
    { id: 'analyst',   name: 'Analyst',           min: 3000 },
    { id: 'pm',        name: 'Portfolio Manager', min: 5000 }
  ];

  function count(n, of) { n = isNum(n) ? n : 0; return { n: Math.max(0, Math.min(n, of)), of: of, raw: n }; }
  /* Each badge: honest criteria, and a progress function over facts() → {n, of}. */
  var BADGES = [
    { id: 'first-lesson',     name: 'First Lesson',        icon: '▸', group: 'learn',    criteria: 'Complete any lesson.', progress: function (f) { return count(f.lessons.length, 1); } },
    { id: 'module-complete',  name: 'Module Complete',     icon: '▣', group: 'learn',    criteria: 'Complete every lesson in one module.', progress: function (f) { return count(f.bestModulePct >= 100 ? 1 : 0, 1); } },
    { id: 'halfway',          name: 'Halfway There',       icon: '◐', group: 'learn',    criteria: 'Complete half of all the lessons in the course.', progress: function (f) { var half = Math.ceil(f.lessonTotal / 2); return count(f.lessons.length, half); } },
    { id: 'quiz-ace',         name: 'Quiz Ace',            icon: '★', group: 'learn',    criteria: 'Score 100 % on any lesson quiz.', progress: function (f) { return count(f.quizPerfect.length, 1); } },
    { id: 'honor-roll',       name: 'Honor Roll',          icon: '✦', group: 'learn',    criteria: 'Pass 10 lesson quizzes with 80 % or more.', progress: function (f) { return count(f.quizPassed.length, 10); } },
    { id: 'certificate',      name: 'Certificate',         icon: '✓', group: 'learn',    criteria: 'Earn the course certificate (every lesson done, quizzes averaging 80 % or more).', progress: function (f) { return count(f.certificate ? 1 : 0, 1); } },
    { id: 'bilingual',        name: 'Bilingual',           icon: '⇄', group: 'learn',    criteria: 'Complete at least one lesson while the site is in English and one while it is in Spanish.', progress: function (f) { return count(f.lessonLangs.length, 2); } },
    { id: 'first-week',       name: 'First Week Done',     icon: '7', group: 'learn',    criteria: 'Finish all seven days of the First Week path.', progress: function (f) { return count(f.firstWeekDone ? 1 : 0, 1); } },
    { id: 'flashcard-regular',name: 'Flashcard Regular',   icon: '❏', group: 'learn',    criteria: 'Review at least 5 flashcards on 5 different days.', progress: function (f) { return count(f.flashDays.length, 5); } },
    { id: 'first-fill',       name: 'First Fill',          icon: '◆', group: 'practice', criteria: 'Get your first paper order filled (any account).', progress: function (f) { return count(f.fills > 0 ? 1 : 0, 1); } },
    { id: 'risk-manager',     name: 'Risk Manager',        icon: '⛨', group: 'practice', criteria: '10 paper orders where the whole position after the order had a stop-loss and no more than 1 % of the account at risk, was worth no more than 25 % of the account, and did not add to a losing position.', progress: function (f) { return count(f.riskManaged, 10); } },
    { id: 'options-explorer', name: 'Options Explorer',    icon: 'Ω', group: 'practice', criteria: 'Place a paper options trade.', progress: function (f) { return count(f.optionTrades > 0 ? 1 : 0, 1); } },
    { id: 'on-alert',         name: 'On Alert',            icon: '◉', group: 'practice', criteria: 'Create a price or indicator alert.', progress: function (f) { return count(f.alerts.length, 1); } },
    { id: 'watchlist-builder',name: 'Watchlist Builder',   icon: '☰', group: 'practice', criteria: 'Add 3 symbols of your own to the dashboard watchlist.', progress: function (f) { return count(f.watchlistOwn, 3); } },
    { id: 'replay-rookie',    name: 'Replay Rookie',       icon: '▶', group: 'replay',   criteria: 'Finish a Market Replay drill to the last bar.', progress: function (f) { return count(f.drillsCompleted.length, 1); } },
    { id: 'drill-passed',     name: 'Drill Passed',        icon: '✔', group: 'replay',   criteria: 'Pass every check of a Market Replay drill.', progress: function (f) { return count(f.drillsPassed.length, 1); } },
    { id: 'replay-pro',       name: 'Replay Pro',          icon: '⏩', group: 'replay',   criteria: 'On your first finished attempt, pass every check and beat buy-and-hold in 5 different drills (retries do not count).', progress: function (f) { return count(f.drillsBeatBH.length, 5); } },
    { id: 'journal-starter',  name: 'Journal Starter',     icon: '✎', group: 'reflect',  criteria: 'Write your first journal reflection (notes or a lesson of at least 20 characters).', progress: function (f) { return count(f.journal.length, 1); } },
    { id: 'journal-keeper',   name: 'Journal Keeper',      icon: '✐', group: 'reflect',  criteria: 'Write 14 journal reflections (notes or a lesson of at least 20 characters).', progress: function (f) { return count(f.journal.length, 14); } },
    { id: 'weekly-reviewer',  name: 'Weekly Reviewer',     icon: '☑', group: 'reflect',  criteria: 'Save a weekly review in the journal.', progress: function (f) { return count(f.weeklyReviews, 1); } },
    { id: 'know-yourself',    name: 'Know Yourself',       icon: '?', group: 'reflect',  criteria: 'Take the trader personality quiz.', progress: function (f) { return count(f.personality ? 1 : 0, 1); } },
    { id: 'backtester',       name: 'Backtester',          icon: '⟲', group: 'build',    criteria: 'Run a backtest of your own in the Strategy Lab: change the strategy, symbol or a setting from the default.', progress: function (f) { return count(f.backtested ? 1 : 0, 1); } },
    { id: 'screener-scout',   name: 'Screener Scout',      icon: '⌕', group: 'build',    criteria: 'Save a scan of your own in the Screener.', progress: function (f) { return count(f.scans, 1); } },
    { id: 'rule-maker',       name: 'Rule Maker',          icon: '⚙', group: 'build',    criteria: 'Save a strategy of your own in the Strategy Builder.', progress: function (f) { return count(f.rules, 1); } },
    { id: 'league-joined',    name: 'Contender',           icon: '⚑', group: 'compete',  criteria: 'Join a paper-trading league.', progress: function (f) { return count(f.leaguesJoined.length, 1); } },
    { id: 'league-finisher',  name: 'League Finisher',     icon: '⚐', group: 'compete',  criteria: 'Trade in a league until its end date.', progress: function (f) { return count(f.leaguesFinished.length, 1); } },
    { id: 'streak-7',         name: 'Streak 7',            icon: '7', group: 'habit',    criteria: 'Practise on 7 days in a row (lessons, quizzes, replay drills, journal notes, flashcards, Daily 5 or the strategy tools; placing orders does not count).', progress: function (f) { return count(f.bestStreak, 7); } },
    { id: 'streak-30',        name: 'Streak 30',           icon: '30', group: 'habit',   criteria: 'Practise on 30 days in a row.', progress: function (f) { return count(f.bestStreak, 30); } }
  ];
  var BADGE_GROUPS = { learn: 'Learning', practice: 'Paper trading', replay: 'Market Replay', reflect: 'Reflection', build: 'Tools', compete: 'Leagues', habit: 'Habits' };

  /* ------------------------------------------------------------------ *
   * XP state (bt.xp)
   * ------------------------------------------------------------------ */
  function freshState() {
    return { v: 1, awarded: {}, badges: {}, flags: {}, days: {}, lessonLangs: {}, drillFirst: {}, knownLessons: null, updatedAt: null };
  }
  function loadState() {
    var s = freshState(), saved = lsGet(KEY, null);
    if (!isObj(saved)) return s;
    if (isObj(saved.awarded)) {
      Object.keys(saved.awarded).forEach(function (id) {
        var a = saved.awarded[id];
        if (isObj(a) && isNum(a.xp) && a.xp >= 0 && a.xp <= 1000) s.awarded[id] = { xp: a.xp, at: isNum(a.at) ? a.at : 0, e: str(a.e || id.split(':')[0]) };
      });
    }
    ['badges', 'flags', 'days', 'lessonLangs', 'drillFirst'].forEach(function (k) { if (isObj(saved[k])) s[k] = saved[k]; });
    if (Array.isArray(saved.knownLessons)) s.knownLessons = saved.knownLessons.filter(function (x) { return typeof x === 'string'; });
    s.updatedAt = isNum(saved.updatedAt) ? saved.updatedAt : null;
    return s;
  }
  function saveState(s) { s.updatedAt = now(); return lsSet(KEY, s); }
  function totalOf(s) { var t = 0; Object.keys(s.awarded).forEach(function (id) { t += s.awarded[id].xp; }); return t; }
  function awardAt(at) { return isNum(at) && at > 0 && at <= now() + DAY_MS ? at : now(); }
  function grant(s, event, key, at, xp) {
    var id = event + ':' + key;
    if (s.awarded[id]) return null;
    var amount = isNum(xp) ? xp : (EVENTS[event] ? EVENTS[event].xp : 0);
    s.awarded[id] = { xp: amount, at: awardAt(at), e: event };
    return { id: id, event: event, key: key, xp: amount };
  }
  /** grant(), but at most `cap` paid awards of this event on the award's local day. */
  function grantCapped(s, event, key, at, cap) {
    var id = event + ':' + key;
    if (s.awarded[id]) return null;
    var day = dayKey(awardAt(at)), n = 0;
    Object.keys(s.awarded).forEach(function (k) { var a = s.awarded[k]; if (a.e === event && a.xp > 0 && dayKey(a.at) === day) n++; });
    if (n >= cap) return null;
    return grant(s, event, key, at);
  }

  /* ------------------------------------------------------------------ *
   * Levels
   * ------------------------------------------------------------------ */
  function levelFor(xp) {
    xp = isNum(xp) && xp > 0 ? xp : 0;
    var i = 0;
    for (var j = 0; j < LEVELS.length; j++) if (xp >= LEVELS[j].min) i = j;
    var L = LEVELS[i], N = LEVELS[i + 1] || null;
    var pct = N ? Math.round((xp - L.min) / (N.min - L.min) * 100) : 100;
    return {
      index: i, number: i + 1, id: L.id, name: T(L.name), min: L.min, xp: xp,
      next: N ? { id: N.id, name: T(N.name), min: N.min } : null,
      toNext: N ? N.min - xp : 0, pct: Math.max(0, Math.min(100, pct))
    };
  }

  /* ------------------------------------------------------------------ *
   * facts(): everything the XP rules and badges need, read from localStorage.
   * ------------------------------------------------------------------ */
  function courseIndex(opts) {
    var idx = opts && isObj(opts.index) ? opts.index : null;
    if (!idx) { try { if (BT.course && BT.course.getIndex) idx = BT.course.getIndex(); } catch (e) { idx = null; } }
    return isObj(idx) && Array.isArray(idx.modules) ? idx : null;
  }
  var lastIndex = null;

  function readAccounts() {
    var keys = lsKeys().filter(function (k) { return k === 'bt.portfolio' || (k.indexOf('bt.portfolio.') === 0 && k !== 'bt.portfolio.accounts' && k !== 'bt.portfolio.ui'); });
    if (!keys.length) {
      // No key enumeration (some shims): fall back to the paper account registry.
      keys = ['bt.portfolio'];
      arr(lsGet('bt.portfolio.accounts', [])).forEach(function (id) { if (typeof id === 'string' && id !== 'main') keys.push('bt.portfolio.' + id); });
    }
    var out = [];
    keys.forEach(function (k) {
      var st = lsGet(k, null);
      if (!isObj(st) || !(Array.isArray(st.trades) || Array.isArray(st.orders))) return;
      var id = k === 'bt.portfolio' ? 'main' : k.slice('bt.portfolio.'.length);
      out.push({ id: id, key: k, state: st });
    });
    return out;
  }
  function leagueCodeOf(accountId) {
    var m = /^league[-:_]?([a-z0-9]{6})$/i.exec(str(accountId));
    return m ? m[1].toUpperCase() : null;
  }

  /* A protective stop: planned on the entry order's meta, or a stop order placed after it. */
  function plannedStop(order) {
    var m = isObj(order && order.meta) ? order.meta : {};
    var p = isObj(m.plan) ? m.plan : (isObj(m.risk) ? m.risk : {});
    var stop = [p.stop, p.stopPrice, m.stop, m.stopPrice, m.plannedStop, m.stopLoss].filter(isNum)[0];
    var risk = [p.riskPct, m.riskPct, m.plannedRiskPct].filter(isNum)[0];
    return { stop: isNum(stop) ? stop : null, riskPct: isNum(risk) ? risk : null };
  }
  function equityAt(st, t) {
    var hist = arr(st.equityHistory).filter(function (e) { return isObj(e) && isNum(e.t) && isNum(e.equity) && e.equity > 0; });
    var pick = null;
    hist.forEach(function (e) { if (!isNum(t) || e.t <= t) { if (!pick || e.t >= pick.t) pick = e; } });
    if (pick) return pick.equity;
    return isNum(st.startingCash) && st.startingCash > 0 ? st.startingCash : 100000;
  }
  /**
   * Risk Manager: count ORDERS (not fills) that opened or added to a stock position where the
   * WHOLE position after the order had a stop, at most RISK_MAX_PCT of equity at risk to that stop,
   * a value of at most SIZE_MAX_PCT of equity, and the order did not add to a losing position.
   * Several partial fills of one order count once; a protective stop placed later is measured
   * against the position held when it was placed (scaling in before protecting does not count).
   */
  function riskManagedCount(acct) {
    var st = acct.state, orders = arr(st.orders);
    var trades = arr(st.trades).map(function (t, i) { return { t: t, i: i }; }).filter(function (x) {
      return isObj(x.t) && isNum(x.t.price) && isNum(x.t.qty) && x.t.qty > 0 && (x.t.side === 'buy' || x.t.side === 'sell') && (!x.t.kind || x.t.kind === 'stock');
    }).sort(function (a, b) { return ((toMs(a.t.time) || 0) - (toMs(b.t.time) || 0)) || (a.i - b.i); });
    var byId = {};
    orders.forEach(function (o) { if (isObj(o) && o.id != null) byId[o.id] = o; });

    // Replay the fills per symbol: signed quantity and average cost before/after each fill.
    var pos = {}, groups = {}, order = [];
    function posAt(sym, ms) {
      // signed quantity of `sym` after every fill at or before ms
      var q = 0;
      trades.forEach(function (x) { if (x.t.symbol === sym && (toMs(x.t.time) || 0) <= ms) q += x.t.side === 'buy' ? x.t.qty : -x.t.qty; });
      return q;
    }
    trades.forEach(function (x) {
      var t = x.t, sym = str(t.symbol), dir = t.side === 'buy' ? 1 : -1;
      var p = pos[sym] || (pos[sym] = { q: 0, avg: 0 });
      var before = { q: p.q, avg: p.avg };
      // update the running position
      var q2 = p.q + dir * t.qty;
      if (p.q === 0 || (p.q > 0) === (dir > 0)) p.avg = (Math.abs(p.q) * p.avg + t.qty * t.price) / (Math.abs(p.q) + t.qty);
      else if (q2 !== 0 && (q2 > 0) !== (p.q > 0)) p.avg = t.price;       // flipped through zero
      p.q = q2;
      if (!(isNum(t.openedQty) && t.openedQty > 0)) return;
      var gk = t.orderId != null ? 'o:' + t.orderId : 't:' + x.i;
      var g = groups[gk];
      if (!g) {
        g = groups[gk] = { key: gk, sym: sym, dir: dir, entry: t.orderId != null ? byId[t.orderId] || null : null,
          first: t, firstMs: toMs(t.time) || 0, pre: before, opened: 0, cost: 0, lastMs: 0, after: 0,
          mult: isNum(t.multiplier) && t.multiplier > 0 ? t.multiplier : 1 };
        order.push(g);
      }
      if (g.dir !== dir) return;
      g.opened += t.openedQty; g.cost += t.openedQty * t.price;
      g.lastMs = toMs(t.time) || g.lastMs; g.after = p.q;
    });

    var n = 0;
    order.forEach(function (g) {
      if (!(g.opened > 0)) return;
      var long = g.dir > 0, entryPx = g.cost / g.opened;
      // Same-direction shares already held before the order; skip adds to a losing position (coach avgDown).
      var preSame = (g.pre.q > 0) === long && g.pre.q !== 0 ? Math.abs(g.pre.q) : 0;
      if (preSame > 0 && (long ? entryPx < g.pre.avg * 0.999 : entryPx > g.pre.avg * 1.001)) return;
      var qty = preSame + g.opened;
      var plan = plannedStop(g.entry);
      var stop = plan.stop;
      if (stop == null) {
        var after = g.entry && isNum(g.entry.placedAt) ? g.entry.placedAt : g.firstMs;
        var prot = orders.filter(function (o) {
          if (!isObj(o) || o === g.entry) return false;
          if (o.type !== 'stop' && o.type !== 'stop_limit') return false;
          if (o.symbol !== g.sym || str(o.status) === 'rejected' || !isNum(o.stopPrice)) return false;
          if (o.side !== (long ? 'sell' : 'buy')) return false;
          if (isNum(o.placedAt) && o.placedAt + 1000 < after) return false;
          return long ? o.stopPrice < entryPx : o.stopPrice > entryPx;
        })[0];
        if (prot) {
          stop = prot.stopPrice;
          // The stop protects the position held when it was placed: if it grew first, that size counts.
          if (isNum(prot.placedAt)) {
            var held = posAt(g.sym, prot.placedAt);
            if ((held > 0) === long && held !== 0) qty = Math.max(qty, Math.abs(held));
          }
        }
      }
      if (stop == null) return;
      if (long ? stop >= entryPx : stop <= entryPx) return;
      var equity = equityAt(st, g.firstMs);
      var riskPct = qty * Math.abs(entryPx - stop) * g.mult / equity * 100;
      if (isNum(plan.riskPct) && plan.riskPct > riskPct) riskPct = plan.riskPct;
      var sizePct = qty * entryPx * g.mult / equity * 100;
      if (riskPct > 0 && riskPct <= RISK_MAX_PCT + 1e-4 && sizePct <= SIZE_MAX_PCT + 1e-4) n++;
    });
    return n;
  }

  function facts(opts) {
    opts = opts || {};
    var today = dayKey(now());
    var days = {};
    function addDay(t) { var ms = toMs(t); if (ms == null) return; var k = dayKey(ms); if (k && k <= today) days[k] = true; }

    /* course */
    var c = lsGet('bt.course', null); c = isObj(c) ? c : {};
    var done = isObj(c.lessonsDone) ? c.lessonsDone : {};
    var lessons = Object.keys(done).filter(function (k) { return done[k] === true || done[k] === 1; }).sort();
    var qs = isObj(c.quizScores) ? c.quizScores : {};
    var quizPassed = [], quizPerfect = [];
    Object.keys(qs).sort().forEach(function (k) { var v = +qs[k]; if (!isFinite(v)) return; if (v >= PASS_PCT) quizPassed.push(k); if (v >= 100) quizPerfect.push(k); });
    addDay(c.startedAt); addDay(c.updatedAt);
    var idx = courseIndex(opts); if (idx) lastIndex = idx;
    idx = idx || lastIndex;
    var lessonTotal = DEFAULT_LESSON_TOTAL, bestModulePct = 0;
    var doneSet = {}; lessons.forEach(function (l) { doneSet[l] = true; });
    if (idx) {
      lessonTotal = 0;
      idx.modules.forEach(function (m) {
        var ls_ = arr(m && m.lessons); lessonTotal += ls_.length;
        if (!ls_.length) return;
        var d = ls_.filter(function (l) { return l && doneSet[l.id]; }).length;
        bestModulePct = Math.max(bestModulePct, d / ls_.length * 100);
      });
      lessonTotal = lessonTotal || DEFAULT_LESSON_TOTAL;
    } else {
      var per = {};
      lessons.forEach(function (l) { var m = /^(m\d+)-l\d+$/.exec(l); if (m) per[m[1]] = (per[m[1]] || 0) + 1; });
      Object.keys(per).forEach(function (m) { bestModulePct = Math.max(bestModulePct, per[m] / DEFAULT_MODULE_SIZE * 100); });
    }
    var certificate = isObj(c.certificate) && !!(c.certificate.id || c.certificate.date || c.certificate.name);

    /* replay */
    var sessions = arr(lsGet('bt.replay.sessions', [])).map(function (s, i) { return { s: s, i: i }; })
      .filter(function (x) { return isObj(x.s); })
      .sort(function (a, b) { return ((toMs(a.s.at) || 0) - (toMs(b.s.at) || 0)) || (a.i - b.i); })
      .map(function (x) { return x.s; });
    var drillsCompleted = {}, drillsPassed = {}, drillFirst = {};
    sessions.forEach(function (s) {
      if (s.completed) addDay(s.at);
      if (!isObj(s.drill) || !s.drill.id || !s.completed) return;
      var id = str(s.drill.id).slice(0, 80), at = toMs(s.at) || 0;
      if (!drillsCompleted[id] || at < drillsCompleted[id]) drillsCompleted[id] = at;
      if (s.drill.passed === true && (!drillsPassed[id] || at < drillsPassed[id])) drillsPassed[id] = at;
      // Replay Pro judges only the first finished attempt (sessions are sorted oldest first).
      if (!drillFirst[id]) drillFirst[id] = { at: at, pro: s.drill.passed === true && isNum(s.returnPct) && isNum(s.buyHoldPct) && s.returnPct > s.buyHoldPct };
    });

    /* journal: only real reflections count: written notes or a lesson, not a picked setup, emotion or tag
       (every paper fill auto-creates an entry, so anything less would pay XP per trade) */
    var j = lsGet('bt.journal', null);
    var entries = Array.isArray(j) ? j : (isObj(j) ? arr(j.entries) : []);
    var journal = [];
    entries.forEach(function (e, i) {
      if (!isObj(e)) return;
      var wrote = str(e.notes).trim().length >= JOURNAL_MIN_CHARS || str(e.lessons).trim().length >= JOURNAL_MIN_CHARS;
      if (!wrote) return;
      var at = toMs(e.createdAt) || toMs(e.date) || toMs(e.updatedAt);
      journal.push({ key: str(e.id || e.tradeId || ('i' + i)).slice(0, 80), at: at, i: i });
      addDay(at);
    });
    journal.sort(function (a, b) { return ((a.at || 0) - (b.at || 0)) || (a.i - b.i); });
    var weeklyReviews = isObj(j) && isObj(j.reviews) ? Object.keys(j.reviews).filter(function (k) { return isObj(j.reviews[k]); }).length : 0;

    /* paper accounts (main, replay, leagues) */
    var accounts = readAccounts();
    var fills = 0, firstFillAt = null, optionTrades = 0, riskManaged = 0;
    accounts.forEach(function (a) {
      var trades = arr(a.state.trades).filter(isObj);
      fills += trades.length;
      trades.forEach(function (t) {
        var ms = toMs(t.time);
        // Fills are not activity days (a streak must not reward trading every day).
        if (a.id !== 'replay' && ms != null && (firstFillAt == null || ms < firstFillAt)) firstFillAt = ms;
        if (t.kind === 'option') optionTrades++;
      });
      arr(a.state.orders).forEach(function (o) {
        if (!isObj(o)) return;
        if (o.kind === 'option' && str(o.status) !== 'rejected') optionTrades++;
      });
      if (trades.length && firstFillAt == null) firstFillAt = now();
      riskManaged += riskManagedCount(a);
    });

    /* alerts */
    var alerts = arr(lsGet('bt.alerts', [])).filter(function (a) { return isObj(a) && a.id != null; }).map(function (a) {
      return { key: str(a.id).slice(0, 60), at: toMs(a.createdAt) };
    });

    /* flashcards + Daily 5 */
    var fc = lsGet('bt.flashcards', null);
    var perDay = {};
    if (isObj(fc)) {
      var log = arr(fc.log);
      if (log.length) log.forEach(function (l) { if (isObj(l) && isNum(l.t)) { var k = dayKey(l.t); if (k && k <= today) perDay[k] = (perDay[k] || 0) + 1; } });
      else if (isObj(fc.cards)) Object.keys(fc.cards).forEach(function (id) { var cd = fc.cards[id]; if (isObj(cd) && isNum(cd.last) && cd.last > 0) { var k = dayKey(cd.last); if (k && k <= today) perDay[k] = (perDay[k] || 0) + 1; } });
    }
    var flashDays = Object.keys(perDay).filter(function (k) { return perDay[k] >= FLASH_SESSION_MIN; }).sort();
    Object.keys(perDay).forEach(function (k) { days[k] = true; });
    var d5 = lsGet('bt.daily5', null);
    if (isObj(d5) && isObj(d5.history)) Object.keys(d5.history).forEach(function (k) { if (parseDay(k) && k <= today && isObj(d5.history[k])) days[k] = true; });

    /* leagues */
    var lg = lsGet('bt.leagues', null); lg = isObj(lg) ? lg : {};
    var defs = isObj(lg.leagues) ? lg.leagues : {};
    var joinedMap = isObj(lg.joined) ? lg.joined : {};
    var leaguesJoined = Object.keys(joinedMap).filter(function (k) { return /^[A-Z0-9]{6}$/.test(k); });
    var leagueTrades = {};
    accounts.forEach(function (a) { var code = leagueCodeOf(a.id); if (code) leagueTrades[code] = (leagueTrades[code] || 0) + arr(a.state.trades).length; });
    var leaguesFinished = [];
    leaguesJoined.forEach(function (code) {
      var def = defs[code];
      var end = isObj(def) ? str(def.endDate) : '';
      if (!parseDay(end) || !(today > end) || !(leagueTrades[code] > 0)) return;
      leaguesFinished.push({ code: code, at: parseDay(end).getTime() + DAY_MS - 1 });
    });

    /* tools */
    var rulesRaw = lsGet('bt.rules', null);
    var rules = Array.isArray(rulesRaw) ? rulesRaw.filter(isObj).length
      : isObj(rulesRaw) ? (Array.isArray(rulesRaw.rules) ? rulesRaw.rules.filter(isObj).length : (isObj(rulesRaw.saved) ? Object.keys(rulesRaw.saved).length : Object.keys(rulesRaw).filter(function (k) { return isObj(rulesRaw[k]) && (rulesRaw[k].entry || rulesRaw[k].name); }).length)) : 0;
    var scansRaw = lsGet('bt.screener.scans', null);
    var scans = Array.isArray(scansRaw) ? scansRaw.filter(function (x) { return isObj(x) && !x.builtin; }).length : 0;
    var bt = lsGet('bt.backtest', null);
    var backtested = false;
    if (isObj(bt)) {
      var defaults = { symbol: 'AAPL', interval: '1day', lookback: 750, strategy: 'smaCross', cash: 100000, sizePct: 100, commission: 0, slippageBps: 5, allowShort: false, source: 'market' };
      backtested = Object.keys(defaults).some(function (k) { return k in bt && bt[k] !== defaults[k]; }) || (isObj(bt.params) && Object.keys(bt.params).length > 0);
    }
    var wl = lsGet('bt.watchlist', null);
    var watchlistOwn = Array.isArray(wl) ? wl.filter(function (s) { return typeof s === 'string' && DEFAULT_WATCHLIST.indexOf(s.toUpperCase()) === -1; }).length : 0;
    var ob = lsGet('bt.onboarding', null);
    var firstWeekDone = isObj(ob) && typeof ob.completedAt === 'string' && !!ob.completedAt;
    var prof = lsGet(PROFILE_KEY, null);
    var personality = isObj(prof) && isObj(prof.personality) && typeof prof.personality.primary === 'string';

    /* XP's own record: flags, live-award days and lesson languages */
    var s = opts.state || loadState();
    Object.keys(s.days).forEach(function (k) { if (parseDay(k) && k <= today) days[k] = true; });
    if (s.flags.backtest) backtested = true;
    if (s.flags.screener) scans = Math.max(scans, 1);
    if (s.flags.rule) rules = Math.max(rules, 1);
    if (s.flags.options) optionTrades = Math.max(optionTrades, 1);
    // First attempts already remembered in bt.xp win over the (trimmable, clearable) session list.
    var firsts = {};
    Object.keys(drillFirst).forEach(function (id) { firsts[id] = drillFirst[id]; });
    if (isObj(s.drillFirst)) Object.keys(s.drillFirst).forEach(function (id) { var r = s.drillFirst[id]; if (isObj(r)) firsts[id] = { at: isNum(r.at) ? r.at : 0, pro: r.pro === true }; });
    var drillsBeatBH = Object.keys(firsts).filter(function (id) { return firsts[id].pro; }).sort();

    var dayList = Object.keys(days).sort().slice(-MAX_HISTORY_DAYS);
    var st = streakOf(dayList, today);

    return {
      today: today, lessons: lessons, lessonTotal: lessonTotal, bestModulePct: bestModulePct,
      quizPassed: quizPassed, quizPerfect: quizPerfect, certificate: certificate,
      lessonLangs: Object.keys(s.lessonLangs).filter(function (k) { return s.lessonLangs[k]; }),
      drillsCompleted: Object.keys(drillsCompleted).sort().map(function (id) { return { id: id, at: drillsCompleted[id] }; }),
      drillsPassed: Object.keys(drillsPassed).sort(), drillsBeatBH: drillsBeatBH, drillFirst: firsts,
      journal: journal, weeklyReviews: weeklyReviews,
      fills: fills, firstFillAt: firstFillAt, optionTrades: optionTrades, riskManaged: riskManaged,
      alerts: alerts, flashDays: flashDays, activityDays: dayList, streak: st.current, bestStreak: st.best,
      leaguesJoined: leaguesJoined, leaguesFinished: leaguesFinished,
      rules: rules, scans: scans, backtested: backtested, watchlistOwn: watchlistOwn,
      firstWeekDone: firstWeekDone, personality: personality
    };
  }

  function streakOf(sortedDays, today) {
    var set = {}; sortedDays.forEach(function (d) { set[d] = true; });
    var best = 0, run = 0, prev = null;
    sortedDays.forEach(function (d) {
      run = prev && shiftDay(prev, 1) === d ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    var cur = 0, k = set[today] ? today : shiftDay(today, -1);
    while (k && set[k] && cur < MAX_HISTORY_DAYS) { cur++; k = shiftDay(k, -1); }
    return { current: cur, best: best };
  }

  /* ------------------------------------------------------------------ *
   * Badges
   * ------------------------------------------------------------------ */
  function evalBadges(f, s) {
    return BADGES.map(function (b) {
      var p;
      try { p = b.progress(f); } catch (e) { p = { n: 0, of: 1 }; }
      var earnedAt = s && s.badges[b.id] ? s.badges[b.id] : null;
      var earnedNow = p.n >= p.of;
      return {
        id: b.id, name: T(b.name), icon: b.icon, group: b.group, groupName: T(BADGE_GROUPS[b.group] || b.group),
        criteria: T(b.criteria), earned: !!earnedAt || earnedNow, earnedAt: earnedAt, progress: { n: p.n, of: p.of }
      };
    });
  }
  function updateBadges(s, f) {
    var fresh = [];
    if (!isObj(s.drillFirst)) s.drillFirst = {};
    if (isObj(f.drillFirst)) Object.keys(f.drillFirst).slice(0, 500).forEach(function (id) { if (!isObj(s.drillFirst[id])) s.drillFirst[id] = { at: f.drillFirst[id].at, pro: !!f.drillFirst[id].pro }; });
    evalBadges(f, s).forEach(function (b) {
      if (b.progress.n >= b.progress.of && !s.badges[b.id]) { s.badges[b.id] = now(); fresh.push(b); }
    });
    return fresh;
  }

  /* ------------------------------------------------------------------ *
   * Change notification + toasts
   * ------------------------------------------------------------------ */
  var listeners = [];
  function onChange(fn, opts) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    if (opts && opts.immediate) { try { fn(summary(), { source: 'init' }); } catch (e) { /* listener errors never break XP */ } }
    return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
  }
  function emit(detail) {
    var sum = summary();
    listeners.slice().forEach(function (fn) { try { fn(sum, detail); } catch (e) { /* ignore */ } });
    try {
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('bt:xp', { detail: Object.assign({ summary: sum }, detail) }));
      } else if (typeof root.dispatchEvent === 'function') {
        root.dispatchEvent({ type: 'bt:xp', detail: Object.assign({ summary: sum }, detail) });
      }
    } catch (e) { /* ignore */ }
  }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, title, kind) {
    if (!hasDOM || !document.body) return null;
    try {
      if (BT.nav && typeof BT.nav.toast === 'function') return BT.nav.toast(msg, kind || 'ok', title, 3500);
      var host = document.getElementById('toasts');
      if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
      var el = document.createElement('div');
      el.className = 'toast ' + (kind || 'ok');
      el.setAttribute('role', 'status');
      el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(title) + '</b>' : '') + esc(msg) + '</div>';
      host.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
      return el;
    } catch (e) { return null; }
  }
  function announce(granted, newBadges, before, after) {
    var gained = granted.reduce(function (n, g) { return n + g.xp; }, 0);
    if (gained > 0) {
      var real = granted.filter(function (g) { return g.xp > 0; });
      var body = real.length === 1 ? T(EVENTS[real[0].event] ? EVENTS[real[0].event].label : 'XP earned')
        : T('From {n} activities', { n: real.length });
      toast(body, T('+{n} XP', { n: gained }), 'ok');
    }
    var lb = levelFor(before), la = levelFor(after);
    if (la.index > lb.index) toast(T('You reached {level}. XP measures practice, not trading skill.', { level: la.name }), T('Level up'), 'ok');
    if (newBadges.length === 1) toast(newBadges[0].name, T('Badge earned'), 'ok');
    else if (newBadges.length > 1) toast(newBadges.slice(0, 3).map(function (b) { return b.name; }).join(', ') + (newBadges.length > 3 ? ' ' + T('and {n} more', { n: newBadges.length - 3 }) : ''), T('{n} badges earned', { n: newBadges.length }), 'ok');
  }

  /* ------------------------------------------------------------------ *
   * award(): called by other modules the moment something happens.
   * ------------------------------------------------------------------ */
  function award(event, key, opts) {
    opts = opts || {};
    event = str(event);
    var s = loadState(), before = totalOf(s);
    var today = dayKey(now());
    var res = { awarded: false, xp: 0, total: before, level: levelFor(before), leveledUp: false, badges: [], reason: '' };
    if (FLAG_EVENTS[event]) {
      var had = !!s.flags[event];
      s.flags[event] = true;
      var g0 = null;
      if (!NO_DAY_EVENTS[event]) { s.days[today] = true; g0 = grant(s, 'streakDay', today); }
      var nb0 = updateBadges(s, facts({ state: s }));
      saveState(s);
      var t0 = totalOf(s);
      res.awarded = !had; res.xp = t0 - before; res.total = t0; res.level = levelFor(t0); res.leveledUp = res.level.index > levelFor(before).index; res.badges = nb0;
      if (!had || g0 || nb0.length) {
        emit({ source: 'award', event: event, key: str(key || 'once'), xp: res.xp, granted: g0 ? [g0] : [], newBadges: nb0 });
        if (!opts.silent) announce(g0 ? [g0] : [], nb0, before, t0);
      }
      return res;
    }
    if (!EVENTS[event]) { res.reason = 'unknown-event'; return res; }
    key = str(key == null || key === '' ? (event === 'streakDay' ? today : 'once') : key).slice(0, 120);
    if (event === 'quiz' && opts.pct != null && !(+opts.pct >= PASS_PCT)) { res.reason = 'below-pass'; return res; }
    var granted = [];
    var g = event === 'journal' ? grantCapped(s, event, key, now(), JOURNAL_PER_DAY)
      : event === 'alert' ? grantCapped(s, event, key, now(), ALERT_PER_DAY)
      : grant(s, event, key);
    if (g) granted.push(g);
    if (event === 'quiz' && +opts.pct >= 100) { var gp = grant(s, 'quizPerfect', key); if (gp) granted.push(gp); }
    if (event === 'lesson') {
      s.lessonLangs[curLang()] = true;
      if (Array.isArray(s.knownLessons) && s.knownLessons.indexOf(key) === -1) s.knownLessons.push(key);
    }
    // Trading/setup events never mark an activity day; a capped journal award marks one only when paid.
    if (!NO_DAY_EVENTS[event] && (event !== 'journal' || g)) {
      s.days[today] = true;
      if (event !== 'streakDay') { var gd = grant(s, 'streakDay', today); if (gd) granted.push(gd); }
    }
    var nb = updateBadges(s, facts({ state: s }));
    saveState(s);
    var after = totalOf(s);
    res.awarded = !!g; res.xp = after - before; res.total = after; res.level = levelFor(after);
    res.leveledUp = res.level.index > levelFor(before).index; res.badges = nb;
    if (!g) res.reason = s.awarded[event + ':' + key] ? 'already-awarded' : 'daily-cap';
    if (granted.length || nb.length) {
      emit({ source: 'award', event: event, key: key, xp: res.xp, granted: granted, newBadges: nb });
      if (!opts.silent) announce(granted, nb, before, after);
    }
    return res;
  }

  /* ------------------------------------------------------------------ *
   * recompute(): derive every award from the stores (idempotent).
   * ------------------------------------------------------------------ */
  function recompute(opts) {
    opts = opts || {};
    var s = loadState(), before = totalOf(s);
    var lang = curLang();

    // Bilingual: lessons that appeared since the last run were done in the current language.
    var c = lsGet('bt.course', null);
    var doneNow = isObj(c) && isObj(c.lessonsDone) ? Object.keys(c.lessonsDone).filter(function (k) { return c.lessonsDone[k] === true || c.lessonsDone[k] === 1; }) : [];
    if (Array.isArray(s.knownLessons)) {
      var known = {}; s.knownLessons.forEach(function (k) { known[k] = true; });
      if (doneNow.some(function (k) { return !known[k]; })) s.lessonLangs[lang] = true;
    }
    s.knownLessons = doneNow.slice(0, 500);

    var f = facts({ state: s, index: opts.index });
    var granted = [];
    function add(g) { if (g) granted.push(g); }
    var courseAt = isObj(c) ? (toMs(c.updatedAt) || toMs(c.startedAt)) : null;
    f.lessons.forEach(function (id) { add(grant(s, 'lesson', id, courseAt)); });
    f.quizPassed.forEach(function (id) { add(grant(s, 'quiz', id, courseAt)); });
    f.quizPerfect.forEach(function (id) { add(grant(s, 'quizPerfect', id, courseAt)); });
    f.drillsCompleted.forEach(function (d) { add(grant(s, 'drill', d.id, d.at)); });
    f.journal.forEach(function (e) { add(grantCapped(s, 'journal', e.key, e.at, JOURNAL_PER_DAY)); });
    if (f.fills > 0) add(grant(s, 'firstTrade', 'once', f.firstFillAt));
    f.alerts.forEach(function (a) { add(grantCapped(s, 'alert', a.key, a.at, ALERT_PER_DAY)); });
    f.flashDays.forEach(function (d) { add(grant(s, 'flashcards', d, toMs(d))); });
    f.activityDays.forEach(function (d) { add(grant(s, 'streakDay', d, toMs(d))); });
    f.leaguesFinished.forEach(function (l) { add(grant(s, 'league', l.code, l.at)); });

    var nb = updateBadges(s, f);
    var changed = granted.length > 0 || nb.length > 0;
    saveState(s);
    var after = totalOf(s);
    var out = { total: after, gained: after - before, granted: granted, newBadges: nb, level: levelFor(after), leveledUp: levelFor(after).index > levelFor(before).index };
    if (changed) {
      emit({ source: 'recompute', xp: out.gained, granted: granted, newBadges: nb });
      if (opts.toast !== false) announce(granted, nb, before, after);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Read-side helpers for profile.html and the nav chip
   * ------------------------------------------------------------------ */
  function total() { return totalOf(loadState()); }
  function summary() {
    var s = loadState(), t = totalOf(s);
    var earned = Object.keys(s.badges).filter(function (id) { return BADGES.some(function (b) { return b.id === id; }); }).length;
    var days = Object.keys(s.days);
    Object.keys(s.awarded).forEach(function (id) { if (id.indexOf('streakDay:') === 0) days.push(id.slice(10)); });
    days = Array.from(new Set(days)).filter(function (d) { return parseDay(d); }).sort();
    var st = streakOf(days, dayKey(now()));
    return { total: t, level: levelFor(t), badgesEarned: earned, badgesTotal: BADGES.length, streak: st.current, bestStreak: st.best };
  }
  function badges(opts) { var s = loadState(); return evalBadges(facts({ state: s, index: opts && opts.index }), s); }
  function labelFor(event) { return T(EVENTS[event] ? EVENTS[event].label : (FLAG_EVENTS[event] ? 'Milestone' : 'XP earned')); }
  function history(limit) {
    var s = loadState();
    var list = Object.keys(s.awarded).map(function (id) {
      var a = s.awarded[id], i = id.indexOf(':');
      return { id: id, event: a.e, key: i >= 0 ? id.slice(i + 1) : '', xp: a.xp, at: a.at, label: labelFor(a.e) };
    }).sort(function (a, b) { return b.at - a.at || (a.id < b.id ? -1 : 1); });
    return isNum(limit) && limit > 0 ? list.slice(0, limit) : list;
  }
  /** dailyXp(days) → [{date, xp, cumulative}] for the last `days` days, oldest first. */
  function dailyXp(days) {
    days = isNum(days) && days > 0 ? Math.min(Math.floor(days), 366) : 30;
    var s = loadState(), today = dayKey(now());
    var start = shiftDay(today, -(days - 1));
    var per = {}, base = 0;
    Object.keys(s.awarded).forEach(function (id) {
      var a = s.awarded[id], k = dayKey(a.at) || today;
      if (k < start) base += a.xp; else per[k] = (per[k] || 0) + a.xp;
    });
    var out = [], cum = base, k = start;
    for (var i = 0; i < days; i++) { var v = per[k] || 0; cum += v; out.push({ date: k, xp: v, cumulative: cum }); k = shiftDay(k, 1); }
    return out;
  }
  function activityDays() { return facts().activityDays; }
  function streak() { var f = facts(); return { current: f.streak, best: f.bestStreak, days: f.activityDays.length }; }
  function reset() { lsDel(KEY); emit({ source: 'reset' }); }

  /* ------------------------------------------------------------------ *
   * Profile (bt.profile): opt-in display name + personality result
   * ------------------------------------------------------------------ */
  function cleanName(v) { return str(v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); }
  var profile = {
    get: function () {
      var p = lsGet(PROFILE_KEY, null); p = isObj(p) ? p : {};
      return { displayName: cleanName(p.displayName), personality: isObj(p.personality) && typeof p.personality.primary === 'string' ? p.personality : null };
    },
    set: function (patch) {
      var p = lsGet(PROFILE_KEY, null); p = isObj(p) ? p : {};
      if (patch && 'displayName' in patch) { var n = cleanName(patch.displayName); if (n) p.displayName = n; else delete p.displayName; }
      lsSet(PROFILE_KEY, p);
      emit({ source: 'profile' });
      return profile.get();
    },
    clearPersonality: function () {
      var p = lsGet(PROFILE_KEY, null); p = isObj(p) ? p : {};
      delete p.personality; lsSet(PROFILE_KEY, p); emit({ source: 'profile' }); return profile.get();
    }
  };

  /* ------------------------------------------------------------------ *
   * Personality quiz (course/personality.json, course/<lang>/personality.json)
   * ------------------------------------------------------------------ */
  var PATH_TYPES = { lesson: true, module: true, drill: true, page: true };
  function normalizePersonality(json) {
    json = isObj(json) ? json : {};
    var profiles = arr(json.profiles).filter(function (p) { return isObj(p) && p.id; }).map(function (p) {
      return {
        id: str(p.id), name: str(p.name || p.id), tagline: str(p.tagline), summary: str(p.summary), body: str(p.body), tip: str(p.tip),
        steps: arr(p.steps).map(str),
        path: arr(p.path).filter(function (x) { return isObj(x) && PATH_TYPES[x.type] && (x.id || x.href); })
          .map(function (x) { return { type: str(x.type), id: str(x.id), href: x.href ? str(x.href) : '', why: str(x.why) }; })
      };
    });
    var ids = profiles.map(function (p) { return p.id; });
    var questions = arr(json.questions).filter(isObj).map(function (q, i) {
      return {
        id: str(q.id || ('q' + (i + 1))), q: str(q.q),
        choices: arr(q.choices).filter(isObj).map(function (c) {
          var pts = {};
          if (isObj(c.points)) Object.keys(c.points).forEach(function (k) { if (ids.indexOf(k) >= 0 && isNum(c.points[k])) pts[k] = c.points[k]; });
          return { text: str(c.text), points: pts };
        })
      };
    }).filter(function (q) { return q.choices.length >= 2; });
    return { id: str(json.id || 'personality'), title: str(json.title), intro: str(json.intro), disclaimer: str(json.disclaimer), profiles: profiles, questions: questions, lang: str(json.lang || 'en'), englishOnly: !!json.englishOnly };
  }
  var _pers = {};
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.json(); });
  }
  function loadPersonality(lang) {
    lang = lang || curLang();
    if (_pers[lang]) return _pers[lang];
    var p;
    if (lang !== 'en') {
      p = fetchJSON('course/' + lang + '/personality.json').then(function (j) { j = isObj(j) ? j : {}; j.lang = lang; return j; })
        .catch(function () { return fetchJSON('course/personality.json').then(function (j) { j = isObj(j) ? j : {}; j.lang = 'en'; j.englishOnly = true; return j; }); });
    } else p = fetchJSON('course/personality.json');
    _pers[lang] = p.then(normalizePersonality).catch(function (e) { delete _pers[lang]; throw e; });
    return _pers[lang];
  }
  /**
   * score(data, answers) → {scores, max, pcts, ranking, primary, secondary, answered, complete}
   * answers: array of choice indexes (by question order) or {questionId: index}.
   * Ties keep the profile order of the file; a second profile within 2 points is reported as a blend.
   */
  function scorePersonality(data, answers) {
    data = data && Array.isArray(data.questions) && Array.isArray(data.profiles) ? data : normalizePersonality(data);
    var scores = {}, max = {};
    data.profiles.forEach(function (p) { scores[p.id] = 0; max[p.id] = 0; });
    var answered = 0, picks = [];
    data.questions.forEach(function (q, i) {
      Object.keys(max).forEach(function (k) { max[k] += Math.max.apply(null, q.choices.map(function (c) { return c.points[k] || 0; }).concat([0])); });
      var a = Array.isArray(answers) ? answers[i] : (isObj(answers) ? answers[q.id] : null);
      a = a == null ? null : +a;
      if (!isNum(a) || a < 0 || a >= q.choices.length || Math.floor(a) !== a) { picks.push(null); return; }
      answered++; picks.push(a);
      var pts = q.choices[a].points;
      Object.keys(pts).forEach(function (k) { if (k in scores) scores[k] += pts[k]; });
    });
    var order = data.profiles.map(function (p) { return p.id; });
    var ranking = order.slice().sort(function (x, y) { return (scores[y] - scores[x]) || (order.indexOf(x) - order.indexOf(y)); });
    var sum = order.reduce(function (n, k) { return n + scores[k]; }, 0);
    var pcts = {}; order.forEach(function (k) { pcts[k] = sum ? Math.round(scores[k] / sum * 100) : 0; });
    var primary = answered ? ranking[0] : null;
    var second = ranking[1];
    var secondary = answered && second != null && scores[second] > 0 && scores[primary] - scores[second] <= 2 ? second : null;
    return { scores: scores, max: max, pcts: pcts, ranking: ranking, primary: primary, secondary: secondary, answers: picks, answered: answered, complete: answered === data.questions.length && answered > 0 };
  }
  function savePersonality(result, data) {
    if (!isObj(result) || typeof result.primary !== 'string' || !result.primary) return null;
    var rec = {
      primary: result.primary, secondary: typeof result.secondary === 'string' ? result.secondary : null,
      scores: isObj(result.scores) ? result.scores : {}, answers: arr(result.answers).slice(0, 40),
      at: now(), lang: data && data.lang ? data.lang : curLang()
    };
    var p = lsGet(PROFILE_KEY, null); p = isObj(p) ? p : {};
    p.personality = rec;
    lsSet(PROFILE_KEY, p);
    var s = loadState(), before = totalOf(s);
    var today = dayKey(now()); s.days[today] = true;
    var g = grant(s, 'streakDay', today);
    var nb = updateBadges(s, facts({ state: s }));
    saveState(s);
    emit({ source: 'personality', granted: g ? [g] : [], newBadges: nb });
    announce(g ? [g] : [], nb, before, totalOf(s));
    return rec;
  }
  function pathHref(item) {
    if (!isObj(item)) return '#';
    var id = encodeURIComponent(str(item.id));
    if (item.type === 'lesson') return 'learn.html#/lesson/' + id;
    if (item.type === 'module') return 'learn.html#/module/' + id;
    if (item.type === 'drill') return 'replay.html#drill=' + id;
    return /^[a-z0-9_-]+\.html(#[\w\-\/=&.]*)?$/i.test(str(item.href)) ? str(item.href) : '#';
  }

  /* ------------------------------------------------------------------ *
   * Auto-run in the browser: derive on load, when the tab comes back, when
   * another tab changes a store, and every 30 s while visible, so XP shows up
   * even for pages that never call award().
   * ------------------------------------------------------------------ */
  var WATCHED = /^bt\.(course|portfolio|replay\.sessions|journal|alerts|flashcards|daily5|leagues|rules|screener\.scans|backtest|watchlist|onboarding|profile)/;
  var timer = null;
  function schedule(delay, opts) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; try { recompute(opts); } catch (e) { /* never break a page */ } }, delay);
  }
  if (hasDOM && typeof root.addEventListener === 'function' && !root.__btXpBooted) {
    root.__btXpBooted = true;
    var boot = function () { schedule(700); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    root.addEventListener('storage', function (e) {
      if (!e || !e.key) return;
      if (e.key === KEY) { emit({ source: 'storage' }); return; }
      if (WATCHED.test(e.key)) schedule(400, { toast: false });
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') schedule(300); });
    setInterval(function () { if (document.visibilityState !== 'hidden') { try { recompute(); } catch (e) { /* ignore */ } } }, 30000);
  }

  /* ------------------------------------------------------------------ *
   * Spanish strings for this module (used when i18n/es.json lacks them)
   * ------------------------------------------------------------------ */
  var ES = {
    'Lesson completed': 'Lección completada', 'Quiz passed': 'Cuestionario aprobado', 'Perfect quiz score': 'Cuestionario perfecto',
    'Replay drill completed': 'Ejercicio de Replay completado', 'Journal entry written': 'Entrada de diario escrita',
    'First paper trade': 'Primera operación simulada', 'Alert created': 'Alerta creada', 'Flashcard session': 'Sesión de tarjetas',
    'Active day': 'Día activo', 'League finished': 'Liga terminada', 'Milestone': 'Hito', 'XP earned': 'XP ganados',
    'Freshman': 'Novato', 'Sophomore': 'Aprendiz', 'Junior': 'Junior', 'Senior': 'Sénior', 'Graduate': 'Graduado',
    'Analyst': 'Analista', 'Portfolio Manager': 'Gestor de carteras',
    'Learning': 'Aprendizaje', 'Paper trading': 'Trading simulado', 'Market Replay': 'Market Replay', 'Reflection': 'Reflexión',
    'Tools': 'Herramientas', 'Leagues': 'Ligas', 'Habits': 'Hábitos',
    'First Lesson': 'Primera lección', 'Complete any lesson.': 'Completa cualquier lección.',
    'Module Complete': 'Módulo completo', 'Complete every lesson in one module.': 'Completa todas las lecciones de un módulo.',
    'Halfway There': 'A mitad de camino', 'Complete half of all the lessons in the course.': 'Completa la mitad de todas las lecciones del curso.',
    'Quiz Ace': 'As de los cuestionarios', 'Score 100 % on any lesson quiz.': 'Saca un 100 % en el cuestionario de cualquier lección.',
    'Honor Roll': 'Cuadro de honor', 'Pass 10 lesson quizzes with 80 % or more.': 'Aprueba 10 cuestionarios de lección con un 80 % o más.',
    'Certificate': 'Certificado', 'Earn the course certificate (every lesson done, quizzes averaging 80 % or more).': 'Consigue el certificado del curso (todas las lecciones hechas y cuestionarios con una media del 80 % o más).',
    'Bilingual': 'Bilingüe', 'Complete at least one lesson while the site is in English and one while it is in Spanish.': 'Completa al menos una lección con el sitio en inglés y otra con el sitio en español.',
    'First Week Done': 'Primera semana completada', 'Finish all seven days of the First Week path.': 'Termina los siete días del recorrido Primera semana.',
    'Flashcard Regular': 'Constancia con tarjetas', 'Review at least 5 flashcards on 5 different days.': 'Repasa al menos 5 tarjetas en 5 días distintos.',
    'First Fill': 'Primera ejecución', 'Get your first paper order filled (any account).': 'Consigue que se ejecute tu primera orden simulada (en cualquier cuenta).',
    'Risk Manager': 'Gestor de riesgo', '10 paper orders where the whole position after the order had a stop-loss and no more than 1 % of the account at risk, was worth no more than 25 % of the account, and did not add to a losing position.': '10 órdenes simuladas en las que la posición completa tras la orden tenía stop-loss y no arriesgaba más del 1 % de la cuenta, no valía más del 25 % de la cuenta y no ampliaba una posición en pérdidas.',
    'Options Explorer': 'Explorador de opciones', 'Place a paper options trade.': 'Haz una operación simulada con opciones.',
    'On Alert': 'Alerta activada', 'Create a price or indicator alert.': 'Crea una alerta de precio o de indicador.',
    'Watchlist Builder': 'Lista de seguimiento propia', 'Add 3 symbols of your own to the dashboard watchlist.': 'Añade 3 símbolos elegidos por ti a la lista de seguimiento del panel.',
    'Replay Rookie': 'Novato de Replay', 'Finish a Market Replay drill to the last bar.': 'Termina un ejercicio de Market Replay hasta la última vela.',
    'Drill Passed': 'Ejercicio superado', 'Pass every check of a Market Replay drill.': 'Supera todas las comprobaciones de un ejercicio de Market Replay.',
    'Replay Pro': 'Experto en Replay', 'On your first finished attempt, pass every check and beat buy-and-hold in 5 different drills (retries do not count).': 'En tu primer intento terminado, supera todas las comprobaciones y a comprar y mantener en 5 ejercicios distintos (los reintentos no cuentan).',
    'Journal Starter': 'Primer diario', 'Write your first journal reflection (notes or a lesson of at least 20 characters).': 'Escribe tu primera reflexión en el diario (notas o una lección de al menos 20 caracteres).',
    'Journal Keeper': 'Diario constante', 'Write 14 journal reflections (notes or a lesson of at least 20 characters).': 'Escribe 14 reflexiones en el diario (notas o una lección de al menos 20 caracteres).',
    'Weekly Reviewer': 'Revisión semanal', 'Save a weekly review in the journal.': 'Guarda una revisión semanal en el diario.',
    'Know Yourself': 'Conócete', 'Take the trader personality quiz.': 'Haz el cuestionario de personalidad de trader.',
    'Backtester': 'Backtester', 'Run a backtest of your own in the Strategy Lab: change the strategy, symbol or a setting from the default.': 'Haz un backtest propio en el Laboratorio de estrategias: cambia la estrategia, el símbolo o algún ajuste predeterminado.',
    'Screener Scout': 'Explorador del screener', 'Save a scan of your own in the Screener.': 'Guarda un filtro propio en el Screener.',
    'Rule Maker': 'Creador de reglas', 'Save a strategy of your own in the Strategy Builder.': 'Guarda una estrategia propia en el Constructor de estrategias.',
    'Contender': 'Competidor', 'Join a paper-trading league.': 'Únete a una liga de trading simulado.',
    'League Finisher': 'Liga completada', 'Trade in a league until its end date.': 'Opera en una liga hasta su fecha de fin.',
    'Streak 7': 'Racha de 7', 'Practise on 7 days in a row (lessons, quizzes, replay drills, journal notes, flashcards, Daily 5 or the strategy tools; placing orders does not count).': 'Practica 7 días seguidos (lecciones, cuestionarios, ejercicios de Replay, notas del diario, tarjetas, Daily 5 o las herramientas de estrategia; colocar órdenes no cuenta).',
    'Streak 30': 'Racha de 30', 'Practise on 30 days in a row.': 'Practica 30 días seguidos.',
    'From {n} activities': 'De {n} actividades', '+{n} XP': '+{n} XP', 'Level up': 'Subes de nivel',
    'You reached {level}. XP measures practice, not trading skill.': 'Has llegado a {level}. Los XP miden la práctica, no la habilidad para operar.',
    'Badge earned': 'Insignia conseguida', '{n} badges earned': '{n} insignias conseguidas', 'and {n} more': 'y {n} más'
  };

  BT.xp = {
    VERSION: VERSION, KEY: KEY, PROFILE_KEY: PROFILE_KEY, PASS_PCT: PASS_PCT,
    EVENTS: EVENTS, FLAG_EVENTS: FLAG_EVENTS, LEVELS: LEVELS, BADGES: BADGES, BADGE_GROUPS: BADGE_GROUPS,
    award: award, recompute: recompute,
    total: total, summary: summary, levelFor: levelFor, badges: badges, history: history, dailyXp: dailyXp,
    activityDays: activityDays, streak: streak, facts: facts,
    onChange: onChange, profile: profile,
    personality: { load: loadPersonality, normalize: normalizePersonality, score: scorePersonality, save: savePersonality, result: function () { return profile.get().personality; } },
    pathHref: pathHref, T: T, ES: ES, setClock: setClock, reset: reset, dayKey: dayKey, _streakOf: streakOf
  };
})();
