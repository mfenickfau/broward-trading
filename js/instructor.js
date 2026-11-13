/* Broward Trading — js/instructor.js → BT.instructor (instructor side of Classroom, v0.4)
 *
 * Engine + page script for instructor.html. The engine is pure (state in
 * localStorage 'bt.instructor', no DOM) so tests/classroom.test.js can run it in
 * Node; the UI half at the bottom only runs when the page's #instApp mount exists.
 *
 * Works fully offline from pasted share codes (js/classroom.js encodeShare) and
 * syncs with server/worker.js when BT.auth.config.apiBase is set.
 *
 * State ('bt.instructor')
 *   { version:1, active:'K7Q2MX', weights:{…}, requiredCount:6, requiredDrills:[ids], secret:'',
 *     classes: { K7Q2MX: { code, name, section, term, createdAt, remote:boolean, token:null|string,
 *                          students:{ [studentId]: snapshot }, names:{ [studentId]: 'nickname' },
 *                          manual:{ [studentId]: { capstone, forward, journal, participation, note } } } } }
 *
 * Public surface
 *   classes(), getClass(code), active(), setActive(code), createClass({name, section, term, code?, token?, remote?}),
 *   updateClass(code, patch), deleteClass(code)
 *   validId(id), sanitizeSnapshot(obj, source) — every stored snapshot passes the same whitelist the Worker uses
 *   addSnapshot(code, snapshot, {source, allowMismatch, save}) → {status:'added'|'updated'|'older'|'mismatched'|'invalid', studentId}
 *   importShareCodes(code, text, {allowMismatch}) → Promise<{found, added, updated, older, skipped, failed:[{code, error}], mismatched:[ids], saved}>
 *   saveStatus() → {ok, bytes}   false when localStorage refused the last save (quota)
 *   removeStudent(code, id), renameStudent(code, id, name), setManual(code, id, patch)
 *   setCourseIndex(index) / lessonsTotal() / moduleOf(lessonId)
 *   row(snapshot, cls?) → roster row; roster(code, {sort, dir, q}) → rows
 *   moduleBreakdown(snapshot) → [{id, title, done, total, pct, quizAvg}]
 *   DEFAULT_WEIGHTS, weights(), setWeights(w), requiredDrills(), setRequiredDrills(ids, count)
 *   grade(snapshot, cls) → {components:{…}, total, max, pct, letter}
 *   letter(pct), csvRoster(code), csvGradebook(code), exportJson(code), importJson(text)
 *   remote: configured(), createRemote({name, section, term}), refreshRoster(code) (follows the server's cursor pages),
 *           removeRemote(code, id), removeStudents(code, {ids:[…]} | {all:true}) (bulk DELETE, batches of 50)
 *   leagues (v0.5, guarded: every call answers sensibly without js/leagues.js):
 *           available(), list(), add(text) (save 'BTL1.' league codes on this device),
 *           importShares(code, text) → Promise<{found, added, updated, skipped, notInLeague, failed[]}>,
 *           standings(code, serverRows?) → {league, rows, teams, phase, countdown} | null  (BT.leagues.standings),
 *           csv(code) → standings CSV
 *
 * Plain ES2020, no imports.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  var G = typeof globalThis !== 'undefined' ? globalThis : root;
  function glob(name) { return root[name] !== undefined ? root[name] : G[name]; }

  var KEY = 'bt.instructor';
  var STALE_DAYS = 7;
  // docs/TEACHING_GUIDE.md §8 "Grading": suggested weights for a 100-point course.
  var DEFAULT_WEIGHTS = { quizzes: 20, drills: 20, journal: 20, forward: 10, capstone: 25, participation: 5 };
  var COMPONENTS = [
    { id: 'quizzes', label: 'Lesson quizzes', auto: true, help: 'Average over every lesson in the course; a quiz never taken counts as 0. Best attempt is what the app stores.' },
    { id: 'drills', label: 'Replay drills', auto: true, help: 'Per required drill: all criteria passed = full marks, finished with a scorecard but some criteria failed = 60 %, started = 20 %. Never the return.' },
    { id: 'journal', label: 'Journal', auto: true, help: 'Completeness proxy: half from the share of entries with a setup and an emotion, half from weekly reviews saved (4 expected). The reflection half of the rubric needs you: override it.' },
    { id: 'forward', label: 'Forward test', auto: false, help: 'Process grade from the journal export (Weeks 5 to 6): followed-plan share, stops on every trade. Enter it after reading the export.' },
    { id: 'capstone', label: 'Capstone plan', auto: false, help: 'The written trading plan, rubric in the Teaching Guide §8.' },
    { id: 'participation', label: 'Participation', auto: true, help: 'Proxy: Daily 5 days completed, 30 days = full marks. Override with your in-class record.' }
  ];
  // §7 of the Teaching Guide: 6 required drills (Week 3 lets students choose one of two).
  var DEFAULT_REQUIRED = ['ride-the-trend-nvda-2023', 'stop-discipline-tsla-2024', 'bear-market-survival-2022', 'crash-and-recovery-xom-2020', 'range-trading-spy-2018', 'sma-cross-msft-2024', 'breakout-meta-2023'];
  var DEFAULT_REQUIRED_COUNT = 6;
  var MODULE_FALLBACK = [
    { id: 'm1-foundations', title: 'Module 1 · Foundations', prefix: 'm1-', total: 5 }, { id: 'm2-charts', title: 'Module 2 · Charts', prefix: 'm2-', total: 5 },
    { id: 'm3-indicators', title: 'Module 3 · Indicators', prefix: 'm3-', total: 5 }, { id: 'm4-risk', title: 'Module 4 · Risk', prefix: 'm4-', total: 5 },
    { id: 'm5-options', title: 'Module 5 · Options', prefix: 'm5-', total: 5 }, { id: 'm6-strategy', title: 'Module 6 · Strategy', prefix: 'm6-', total: 5 },
    { id: 'm7-replay', title: 'Module 7 · Replay drills', prefix: 'm7-', total: 5 }, { id: 'm8-capstone', title: 'Module 8 · Capstone', prefix: 'm8-', total: 5 }
  ];

  /* ------------------------------------------------------------------ *
   * storage
   * ------------------------------------------------------------------ */
  function lsGet(k, d) { try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  var clock = function () { return Date.now(); };

  function blank() { return { version: 1, active: null, weights: Object.assign({}, DEFAULT_WEIGHTS), requiredDrills: DEFAULT_REQUIRED.slice(), requiredCount: DEFAULT_REQUIRED_COUNT, secret: '', classes: {} }; }
  function sanitizeState(s) {
    var out = blank();
    if (!s || typeof s !== 'object') return out;
    if (s.weights && typeof s.weights === 'object') Object.keys(DEFAULT_WEIGHTS).forEach(function (k) { var v = +s.weights[k]; if (isFinite(v) && v >= 0) out.weights[k] = v; });
    if (Array.isArray(s.requiredDrills)) out.requiredDrills = s.requiredDrills.map(String).slice(0, 40);
    if (isFinite(+s.requiredCount) && +s.requiredCount > 0) out.requiredCount = Math.round(+s.requiredCount);
    if (typeof s.secret === 'string') out.secret = s.secret.slice(0, 200);
    if (s.classes && typeof s.classes === 'object') {
      Object.keys(s.classes).forEach(function (code) {
        var c = s.classes[code];
        if (!c || typeof c !== 'object') return;
        out.classes[code] = {
          code: code, name: String(c.name || ''), section: String(c.section || ''), term: String(c.term || ''), createdAt: c.createdAt || null,
          remote: !!c.remote, token: typeof c.token === 'string' ? c.token : null, syncedAt: c.syncedAt || null,
          students: c.students && typeof c.students === 'object' ? c.students : {},
          names: c.names && typeof c.names === 'object' ? c.names : {},
          manual: c.manual && typeof c.manual === 'object' ? c.manual : {}
        };
      });
    }
    out.active = s.active && out.classes[s.active] ? s.active : (Object.keys(out.classes)[0] || null);
    return out;
  }
  var state = sanitizeState(lsGet(KEY, null));
  // save() is called once per user action (imports and refreshes batch their snapshots), and it REPORTS failure:
  // a full localStorage (quota ~5 MB) used to be swallowed, so a roster could show students that vanished on reload.
  var saveOk = true, saveBytes = 0;
  function save() {
    state.updatedAt = new Date(clock()).toISOString();
    try { saveBytes = JSON.stringify(state).length; } catch (e) { saveBytes = 0; }
    saveOk = lsSet(KEY, state);
    return saveOk;
  }
  /** saveStatus() → {ok, bytes}: false when the last save hit the storage quota (the header shows a warning). */
  function saveStatus() { return { ok: saveOk, bytes: saveBytes }; }
  function load() { state = sanitizeState(lsGet(KEY, null)); return state; }
  function reset() { state = blank(); lsDel(KEY); return state; }
  function getState() { return state; }

  /* ------------------------------------------------------------------ *
   * classes
   * ------------------------------------------------------------------ */
  function cleanText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 80); }
  function normCode(c) { return BT.classroom && BT.classroom.normalizeCode ? BT.classroom.normalizeCode(c) : String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function validCode(c) { return BT.classroom && BT.classroom.isValidCode ? BT.classroom.isValidCode(c) : /^[23456789A-HJ-NP-Z]{6}$/.test(normCode(c)); }
  function classes() {
    return Object.keys(state.classes).map(function (k) { return state.classes[k]; }).sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
  }
  function getClass(code) { return state.classes[normCode(code)] || null; }
  function active() { return state.active ? state.classes[state.active] || null : null; }
  function setActive(code) { var c = normCode(code); if (state.classes[c]) { state.active = c; save(); return state.classes[c]; } return null; }
  function createClass(opts) {
    opts = opts || {};
    var name = cleanText(opts.name, 80);
    if (name.length < 2) return { ok: false, error: 'Give the class a name students will recognise, e.g. "FIN 1100 Markets by Doing".' };
    var code = opts.code ? normCode(opts.code) : null;
    if (code && !validCode(code)) return { ok: false, error: 'That class code is not valid.' };
    if (!code) {
      for (var i = 0; i < 20 && (!code || state.classes[code]); i++) code = BT.classroom && BT.classroom.newCode ? BT.classroom.newCode() : fallbackCode();
    }
    if (state.classes[code]) return { ok: false, error: 'A class with code ' + code + ' already exists on this device.' };
    var cls = { code: code, name: name, section: cleanText(opts.section, 40), term: cleanText(opts.term, 40), createdAt: opts.createdAt || new Date(clock()).toISOString(), remote: !!opts.remote, token: typeof opts.token === 'string' ? opts.token : null, syncedAt: null, students: {}, names: {}, manual: {} };
    state.classes[code] = cls; state.active = code; save();
    return { ok: true, cls: cls, code: code };
  }
  function fallbackCode() { var A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', o = ''; for (var i = 0; i < 6; i++) o += A.charAt(Math.floor(Math.random() * A.length)); return o; }
  function updateClass(code, patch) {
    var cls = getClass(code); if (!cls) return null;
    ['name', 'section', 'term'].forEach(function (k) { if (patch && patch[k] !== undefined) cls[k] = cleanText(patch[k], k === 'name' ? 80 : 40); });
    if (patch && patch.token !== undefined) cls.token = patch.token ? String(patch.token) : null;
    if (patch && patch.remote !== undefined) cls.remote = !!patch.remote;
    if (patch && patch.syncedAt !== undefined) cls.syncedAt = patch.syncedAt;
    save(); return cls;
  }
  function deleteClass(code) {
    var c = normCode(code); if (!state.classes[c]) return false;
    delete state.classes[c];
    if (state.active === c) state.active = Object.keys(state.classes)[0] || null;
    save(); return true;
  }

  /* ------------------------------------------------------------------ *
   * students
   * ------------------------------------------------------------------ */
  var has = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };
  /** Student ids are used as keys of plain objects, so names that live on Object.prototype ('__proto__', 'constructor', …) are refused. */
  function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(id) && !/^(__proto__|constructor|prototype)$/.test(id) && !(id in Object.prototype); }
  function clampNum(v, lo, hi, dp) {
    if (v === null || v === undefined || v === '') return null;
    var n = +v; if (typeof v === 'object' || !isFinite(n)) return null;
    return +Math.max(lo, Math.min(hi, n)).toFixed(dp == null ? 2 : dp);
  }
  function count(v, hi) { return Math.round(clampNum(v, 0, hi == null ? 1e6 : hi, 0) || 0); }
  function isoDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; }
  function isoTime(v) { var s = cleanText(v, 40); return s && isFinite(Date.parse(s)) ? s : null; }
  /**
   * sanitizeSnapshot(obj, source) → whitelisted snapshot (mirror of server/worker.js sanitizeSnapshot).
   * A pasted share code is plain base64url JSON anybody can write, so NOTHING from it is stored raw: ids and titles are
   * cleaned text, every number is clamped, booleans coerced, dates validated, unknown fields dropped.
   * source 'server' (refreshRoster) is the only one allowed to carry `receivedAt`; 'share' and 'backup' imports get
   * `importedAt` instead, so the page never labels student-supplied data as verified by the server.
   */
  function sanitizeSnapshot(obj, source, cls) {
    var b = obj && typeof obj === 'object' ? obj : {};
    source = source === 'server' || source === 'backup' ? source : 'share';
    var seen = {}, lessonsDone = [];
    (Array.isArray(b.lessonsDone) ? b.lessonsDone : []).forEach(function (x) { if (typeof x !== 'string' || lessonsDone.length >= 400) return; var k = cleanText(x, 40); if (k && !seen[k]) { seen[k] = 1; lessonsDone.push(k); } });
    var quizScores = {};
    if (b.quizScores && typeof b.quizScores === 'object') {
      Object.keys(b.quizScores).slice(0, 400).forEach(function (k) { var key = cleanText(k, 40), v = clampNum(b.quizScores[k], 0, 100, 0); if (key && v !== null && !(key in Object.prototype)) quizScores[key] = v; });
    }
    var drills = (Array.isArray(b.drills) ? b.drills : []).slice(0, 40).map(function (d) {
      if (!d || typeof d !== 'object') return null;
      return { id: cleanText(d.id, 60), title: cleanText(d.title, 120), returnPct: clampNum(d.returnPct, -100, 100000), buyHoldPct: clampNum(d.buyHoldPct, -100, 100000), maxDrawdownPct: clampNum(d.maxDrawdownPct, 0, 100), trades: count(d.trades, 100000), passed: !!d.passed, completed: !!d.completed, date: isoDay(d.date) };
    }).filter(function (d) { return d && d.id; });
    var p = b.paper && typeof b.paper === 'object' ? b.paper : {};
    var paper = { equity: clampNum(p.equity, 0, 1e12), startingCash: clampNum(p.startingCash, 0, 1e12), returnPct: clampNum(p.returnPct, -100, 1e6), trades: count(p.trades), winRate: clampNum(p.winRate, 0, 100, 1), fills: count(p.fills), positions: count(p.positions, 1e4) };
    var j = b.journal && typeof b.journal === 'object' ? b.journal : {};
    var journalEntries = count(b.journalEntries != null ? b.journalEntries : j.entries);
    var journal = { entries: journalEntries, reviewed: count(j.reviewed), withLessons: count(j.withLessons), weeklyReviews: count(j.weeklyReviews, 1e4), lastDate: isoDay(j.lastDate) };
    var d5 = b.daily && typeof b.daily === 'object' ? b.daily : {};
    var streak = count(b.streak, 10000);
    var cert = b.certificate && typeof b.certificate === 'object' && b.certificate.id ? { id: cleanText(b.certificate.id, 24), date: cleanText(b.certificate.date, 40) || null } : null;
    var out = {
      v: 1, source: source,
      studentId: validId(b.studentId) ? b.studentId : null,
      displayName: cleanText(b.displayName, 40),
      classCode: source === 'server' && cls ? cls.code : (normCode(b.classCode) || null),
      lessonsDone: lessonsDone, quizScores: quizScores, lessonsTotal: clampNum(b.lessonsTotal, 1, 10000, 0), startedAt: isoTime(b.startedAt), certificate: cert,
      drills: drills, paper: paper, journalEntries: journalEntries, journal: journal, streak: streak,
      daily: { streak: streak, days: count(d5.days, 10000), best: count(d5.best, 10000) },
      lastActive: isoDay(b.lastActive), updatedAt: isoTime(b.updatedAt)
    };
    if (source === 'server') out.receivedAt = isoTime(b.receivedAt);
    else if (source === 'backup') { out.source = b.source === 'server' ? 'server' : 'share'; if (out.source === 'server') out.receivedAt = isoTime(b.receivedAt); out.importedAt = isoTime(b.importedAt); }
    if (out.source !== 'server' && !out.importedAt) out.importedAt = new Date(clock()).toISOString();
    return out;
  }
  /** Comparison stamp (ms) of a stored snapshot: receivedAt when the server supplied it, else updatedAt, never later than now. */
  function snapStamp(s) {
    var t = Date.parse((s && (s.receivedAt || s.updatedAt)) || '');
    if (!isFinite(t)) return 0;
    return Math.min(t, clock());
  }
  /**
   * addSnapshot(code, snapshot, opts?) → {status:'added'|'updated'|'older'|'mismatched'|'invalid'|'no-class', studentId, mismatched}
   * Newer snapshot wins; equal or older is kept out so a stale paste never overwrites a fresh sync.
   * opts.source 'share' (default) | 'server' | 'backup' — see sanitizeSnapshot. opts.allowMismatch: import a snapshot made
   * for a different class code anyway (default false: status 'mismatched', nothing stored). opts.save:false defers save()
   * to the caller, so a 500-student refresh writes localStorage once instead of 500 times.
   */
  function addSnapshot(code, snap, opts) {
    opts = opts || {};
    var cls = getClass(code);
    if (!cls) return { status: 'no-class' };
    if (!snap || typeof snap !== 'object' || !validId(snap.studentId)) return { status: 'invalid' };
    snap = sanitizeSnapshot(snap, opts.source, cls);
    // Clamp forged future stamps ONCE, when the snapshot is stored. (Clamping only at comparison
    // time re-clamps the stored row to the current instant on every later import, so a forged
    // future date would still beat every genuine snapshot made before that moment.)
    var nowMs = clock();
    ['updatedAt', 'receivedAt'].forEach(function (k) {
      var t = Date.parse(snap[k] || '');
      if (isFinite(t) && t > nowMs) snap[k] = new Date(nowMs).toISOString();
    });
    var id = snap.studentId;
    var mismatched = !!(snap.classCode && snap.classCode !== cls.code);
    if (mismatched && !opts.allowMismatch) return { status: 'mismatched', studentId: id, mismatched: true, classCode: snap.classCode };
    var prev = has(cls.students, id) ? cls.students[id] : null;
    // Newer wins. Server records carry receivedAt (server clock; updatedAt === receivedAt since v0.4.1), so that is
    // the trusted stamp; a share code's updatedAt is student-written, so a forged future date is clamped to "now" and
    // cannot lock a row against later genuine snapshots.
    var newT = snapStamp(snap), oldT = prev ? snapStamp(prev) : -1;
    if (prev && newT < oldT) return { status: 'older', studentId: id, mismatched: mismatched };
    cls.students[id] = snap;
    if (!has(cls.names, id) && snap.displayName) cls.names[id] = snap.displayName;
    if (opts.save !== false) save();
    return { status: prev ? 'updated' : 'added', studentId: id, mismatched: mismatched };
  }
  /**
   * importShareCodes(code, text, opts?) → Promise<{found, added, updated, older, failed:[{code, error}], mismatched:[ids], skipped, students:[ids], saved}>
   * opts.allowMismatch (default false): codes made for another class are skipped and listed in `mismatched` unless set.
   */
  function importShareCodes(code, text, opts) {
    opts = opts || {};
    var cls = getClass(code);
    var out = { found: 0, added: 0, updated: 0, older: 0, skipped: 0, failed: [], mismatched: [], students: [], saved: true };
    if (!cls) { out.error = 'Create or select a class first.'; return Promise.resolve(out); }
    if (!BT.classroom || !BT.classroom.parseShareCodes) { out.error = 'js/classroom.js is not loaded.'; return Promise.resolve(out); }
    var codes = BT.classroom.parseShareCodes(text);
    out.found = codes.length;
    if (!codes.length) { out.error = 'No share code found. A share code starts with "BT1." — paste the whole thing.'; return Promise.resolve(out); }
    var chain = Promise.resolve(), touched = false;
    codes.forEach(function (c) {
      chain = chain.then(function () {
        return BT.classroom.decodeShare(c).then(function (r) {
          if (!r.ok) { out.failed.push({ code: c.slice(0, 16) + '…', error: r.error }); return; }
          var res = addSnapshot(cls.code, r.snapshot, { source: 'share', allowMismatch: !!opts.allowMismatch, save: false });
          if (res.status === 'invalid') { out.failed.push({ code: c.slice(0, 16) + '…', error: 'Not a progress snapshot.' }); return; }
          if (res.status === 'mismatched') { out.skipped++; if (out.mismatched.indexOf(res.studentId) < 0) out.mismatched.push(res.studentId); return; }
          out[res.status] = (out[res.status] || 0) + 1;
          out.students.push(res.studentId);
          if (res.status !== 'older') touched = true;
          if (res.mismatched && out.mismatched.indexOf(res.studentId) < 0) out.mismatched.push(res.studentId);
        });
      });
    });
    return chain.then(function () { if (touched) out.saved = save(); return out; });
  }
  function removeStudent(code, id) { var cls = getClass(code); if (!cls || !has(cls.students, id)) return false; delete cls.students[id]; delete cls.names[id]; delete cls.manual[id]; save(); return true; }
  function renameStudent(code, id, name) { var cls = getClass(code); if (!cls || !has(cls.students, id)) return null; var n = cleanText(name, 40); if (n) cls.names[id] = n; else delete cls.names[id]; save(); return n; }
  function setManual(code, id, patch) {
    var cls = getClass(code); if (!cls || !has(cls.students, id)) return null;
    var m = cls.manual[id] = cls.manual[id] || {};
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'note') { m.note = cleanText(patch.note, 500); return; }
      if (!DEFAULT_WEIGHTS.hasOwnProperty(k)) return;
      var v = patch[k];
      if (v === null || v === '' || v === undefined) delete m[k];
      else { v = +v; if (isFinite(v)) m[k] = Math.max(0, Math.min(state.weights[k], v)); }
    });
    save(); return m;
  }
  function nameOf(cls, snap) { return (cls && cls.names[snap.studentId]) || snap.displayName || ('Student ' + String(snap.studentId).replace(/^s-/, '').slice(0, 6)); }

  /* ------------------------------------------------------------------ *
   * course index (for progress % and module breakdowns)
   * ------------------------------------------------------------------ */
  var modules = MODULE_FALLBACK.slice();
  var lessonModule = null;   // lessonId → module id, from the real index
  function setCourseIndex(index) {
    if (!index || !Array.isArray(index.modules) || !index.modules.length) return false;
    modules = index.modules.map(function (m) { return { id: m.id, title: m.title, total: (m.lessons || []).length, lessons: (m.lessons || []).map(function (l) { return l.id; }) }; });
    lessonModule = {};
    modules.forEach(function (m) { m.lessons.forEach(function (id) { lessonModule[id] = m.id; }); });
    return true;
  }
  function lessonsTotal(snap) {
    var t = modules.reduce(function (s, m) { return s + (m.total || 0); }, 0);
    if (snap && isFinite(+snap.lessonsTotal) && +snap.lessonsTotal > t) t = +snap.lessonsTotal;   // a newer course on the student's device
    return t || 40;
  }
  function moduleOf(lessonId) {
    if (lessonModule && lessonModule[lessonId]) return lessonModule[lessonId];
    for (var i = 0; i < MODULE_FALLBACK.length; i++) if (String(lessonId).indexOf(MODULE_FALLBACK[i].prefix) === 0) return MODULE_FALLBACK[i].id;
    var m = /^(m\d+)-/.exec(String(lessonId));
    return m ? m[1] : 'other';
  }
  function moduleBreakdown(snap) {
    var done = {}, scores = {};
    (snap.lessonsDone || []).forEach(function (id) { var m = moduleOf(id); done[m] = (done[m] || 0) + 1; });
    Object.keys(snap.quizScores || {}).forEach(function (id) { var m = moduleOf(id); (scores[m] = scores[m] || []).push(+snap.quizScores[id]); });
    var seen = {};
    var rows = modules.map(function (m) {
      seen[m.id] = 1;
      var d = Math.min(done[m.id] || 0, m.total || Infinity), sc = scores[m.id] || [];
      return { id: m.id, title: m.title, done: d, total: m.total, pct: m.total ? Math.round(d / m.total * 100) : 0, quizAvg: sc.length ? Math.round(sc.reduce(function (a, b) { return a + b; }, 0) / sc.length) : null, quizzes: sc.length };
    });
    Object.keys(done).concat(Object.keys(scores)).forEach(function (id) {
      if (seen[id]) return; seen[id] = 1;
      var sc = scores[id] || [];
      rows.push({ id: id, title: id, done: done[id] || 0, total: null, pct: null, quizAvg: sc.length ? Math.round(sc.reduce(function (a, b) { return a + b; }, 0) / sc.length) : null, quizzes: sc.length });
    });
    return rows;
  }

  /* ------------------------------------------------------------------ *
   * roster rows
   * ------------------------------------------------------------------ */
  function numOrNull(v) { return v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v; }
  function daysSince(dayOrIso) {
    if (!dayOrIso) return null;
    var t = Date.parse(String(dayOrIso).length === 10 ? dayOrIso + 'T12:00:00' : dayOrIso);
    return isFinite(t) ? Math.max(0, Math.floor((clock() - t) / 864e5)) : null;
  }
  function row(snap, cls) {
    var total = lessonsTotal(snap);
    var doneN = Math.min((snap.lessonsDone || []).length, total);
    var qs = Object.keys(snap.quizScores || {}).map(function (k) { return +snap.quizScores[k]; }).filter(isFinite);
    var drills = Array.isArray(snap.drills) ? snap.drills : [];
    var req = requiredSet();
    var paper = snap.paper || {}, journal = snap.journal || {};
    var last = snap.lastActive || (snap.updatedAt ? String(snap.updatedAt).slice(0, 10) : null);
    var age = daysSince(last);
    return {
      id: snap.studentId, name: nameOf(cls, snap), displayName: snap.displayName || '',
      progressPct: Math.round(doneN / total * 100), lessonsDone: doneN, lessonsTotal: total,
      quizAvg: qs.length ? Math.round(qs.reduce(function (a, b) { return a + b; }, 0) / qs.length) : null, quizzes: qs.length,
      drillsDone: drills.filter(function (d) { return d.completed; }).length, drillsPassed: drills.filter(function (d) { return d.passed; }).length,
      drillsRequiredPassed: Math.min(state.requiredCount, drills.filter(function (d) { return d.passed && req[d.id]; }).length),
      drillsAttempted: drills.length,
      paperReturnPct: numOrNull(paper.returnPct), paperTrades: +paper.trades || 0, paperWinRate: numOrNull(paper.winRate), paperEquity: numOrNull(paper.equity),
      journalEntries: +(snap.journalEntries != null ? snap.journalEntries : journal.entries) || 0, journalReviewed: +journal.reviewed || 0, weeklyReviews: +journal.weeklyReviews || 0,
      streak: +snap.streak || 0, dailyDays: snap.daily ? +snap.daily.days || 0 : 0,
      certificate: snap.certificate && snap.certificate.id ? snap.certificate.id : null,
      lastActive: last, daysSinceActive: age, stale: age != null && age > STALE_DAYS, updatedAt: snap.updatedAt || null,
      source: snap.source === 'server' ? 'server' : 'share', receivedAt: snap.source === 'server' && snap.receivedAt ? snap.receivedAt : null, importedAt: snap.source !== 'server' && snap.importedAt ? snap.importedAt : null,
      mismatched: !!(cls && snap.classCode && snap.classCode !== cls.code)
    };
  }
  var SORT_KEYS = { name: 'name', progress: 'progressPct', quiz: 'quizAvg', drills: 'drillsPassed', paper: 'paperReturnPct', journal: 'journalEntries', streak: 'streak', active: 'lastActive' };
  function roster(code, opts) {
    opts = opts || {};
    var cls = getClass(code); if (!cls) return [];
    var rows = Object.keys(cls.students).map(function (id) { return row(cls.students[id], cls); });
    var q = cleanText(opts.q, 60).toLowerCase();
    if (q) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.id.toLowerCase().indexOf(q) >= 0; });
    var key = SORT_KEYS[opts.sort] || SORT_KEYS.name, dir = opts.dir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1; if (y == null) return -1;             // missing values sink regardless of direction
      if (typeof x === 'string') return x.localeCompare(y, undefined, { sensitivity: 'base' }) * dir || a.name.localeCompare(b.name);
      return (x - y) * dir || a.name.localeCompare(b.name);
    });
    return rows;
  }
  /** Class-level summary for the header pills. */
  function summary(code) {
    var rows = roster(code);
    var n = rows.length, avg = function (k) { var v = rows.map(function (r) { return r[k]; }).filter(function (x) { return x != null; }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null; };
    return { students: n, avgProgress: avg('progressPct'), avgQuiz: avg('quizAvg'), activeThisWeek: rows.filter(function (r) { return r.daysSinceActive != null && r.daysSinceActive <= STALE_DAYS; }).length, stale: rows.filter(function (r) { return r.stale; }).length };
  }

  /* ------------------------------------------------------------------ *
   * gradebook
   * ------------------------------------------------------------------ */
  function weights() { return Object.assign({}, state.weights); }
  function setWeights(w) {
    Object.keys(DEFAULT_WEIGHTS).forEach(function (k) { if (w && w[k] !== undefined) { var v = +w[k]; if (isFinite(v) && v >= 0) state.weights[k] = v; } });
    save(); return weights();
  }
  function weightsTotal() { return Object.keys(state.weights).reduce(function (s, k) { return s + state.weights[k]; }, 0); }
  function requiredDrills() { return { ids: state.requiredDrills.slice(), count: state.requiredCount }; }
  function requiredSet() { var s = {}; state.requiredDrills.forEach(function (id) { s[id] = 1; }); return s; }
  function setRequiredDrills(ids, count) {
    if (Array.isArray(ids)) state.requiredDrills = ids.map(function (s) { return cleanText(s, 60); }).filter(Boolean).slice(0, 40);
    if (isFinite(+count) && +count > 0) state.requiredCount = Math.round(+count);
    save(); return requiredDrills();
  }
  /** Auto score 0..1 for each automatic component; null when there is no evidence at all. */
  function autoScores(snap) {
    var total = lessonsTotal(snap);
    var sum = 0; Object.keys(snap.quizScores || {}).forEach(function (k) { sum += Math.max(0, Math.min(100, +snap.quizScores[k] || 0)); });
    var quizzes = Math.min(1, sum / (total * 100));
    var req = requiredSet(), pts = 0;
    (snap.drills || []).forEach(function (d) { if (!req[d.id]) return; pts += d.passed ? 1 : d.completed ? 0.6 : 0.2; });
    var drills = Math.min(1, pts / state.requiredCount);
    var j = snap.journal || {}, entries = +(snap.journalEntries != null ? snap.journalEntries : j.entries) || 0;
    var journal = entries ? Math.min(1, 0.5 * Math.min(1, (+j.reviewed || 0) / entries) + 0.5 * Math.min(1, (+j.weeklyReviews || 0) / 4)) : 0;
    var participation = Math.min(1, ((snap.daily && +snap.daily.days) || 0) / 30);
    return { quizzes: quizzes, drills: drills, journal: journal, participation: participation, forward: null, capstone: null };
  }
  function letter(pct) { return pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F'; }
  /** grade(snapshot, cls) → {components:{id:{points, max, auto, manual, source}}, total, max, pct, letter, complete} */
  function grade(snap, cls) {
    var auto = autoScores(snap), manual = (cls && cls.manual[snap.studentId]) || {};
    var comps = {}, total = 0, max = 0, missing = [];
    COMPONENTS.forEach(function (c) {
      var w = state.weights[c.id] || 0, m = manual[c.id], a = auto[c.id];
      var points = null, source = 'missing';
      if (m !== undefined && m !== null && isFinite(+m)) { points = Math.max(0, Math.min(w, +m)); source = 'manual'; }
      else if (a !== null && a !== undefined) { points = Math.round(a * w * 10) / 10; source = 'auto'; }
      else missing.push(c.id);
      comps[c.id] = { points: points, max: w, auto: a === null || a === undefined ? null : Math.round(a * w * 10) / 10, manual: m === undefined ? null : m, source: source };
      total += points || 0; max += w;
    });
    var pct = max ? Math.round(total / max * 1000) / 10 : 0;
    return { components: comps, total: Math.round(total * 10) / 10, max: max, pct: pct, letter: letter(pct), missing: missing, complete: !missing.length, note: manual.note || '' };
  }

  /* ------------------------------------------------------------------ *
   * export
   * ------------------------------------------------------------------ */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                  // no spreadsheet formula injection from a nickname
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
  function csvRoster(code) {
    var cls = getClass(code); if (!cls) return '';
    var head = ['name', 'student_id', 'progress_pct', 'lessons_done', 'lessons_total', 'quiz_avg_pct', 'quizzes_taken', 'drills_passed', 'drills_required_passed', 'drills_attempted', 'paper_return_pct', 'paper_trades', 'paper_win_rate_pct', 'journal_entries', 'journal_reviewed', 'weekly_reviews', 'daily5_streak', 'daily5_days', 'certificate_id', 'last_active', 'snapshot_at'];
    var rows = roster(code).map(function (r) { return [r.name, r.id, r.progressPct, r.lessonsDone, r.lessonsTotal, r.quizAvg, r.quizzes, r.drillsPassed, r.drillsRequiredPassed, r.drillsAttempted, r.paperReturnPct, r.paperTrades, r.paperWinRate, r.journalEntries, r.journalReviewed, r.weeklyReviews, r.streak, r.dailyDays, r.certificate, r.lastActive, r.updatedAt]; });
    return csv([head].concat(rows));
  }
  function csvGradebook(code) {
    var cls = getClass(code); if (!cls) return '';
    var head = ['name', 'student_id'].concat(COMPONENTS.map(function (c) { return c.id + '_pts (/' + state.weights[c.id] + ')'; })).concat(COMPONENTS.map(function (c) { return c.id + '_source'; })).concat(['total', 'max', 'pct', 'letter', 'note']);
    var rows = roster(code).map(function (r) {
      var g = grade(cls.students[r.id], cls);
      return [r.name, r.id].concat(COMPONENTS.map(function (c) { return g.components[c.id].points; })).concat(COMPONENTS.map(function (c) { return g.components[c.id].source; })).concat([g.total, g.max, g.pct, g.complete ? g.letter : g.letter + ' (incomplete)', g.note]);
    });
    return csv([head].concat(rows));
  }
  /** JSON backup of one class (or all) — restores with importJson. The instructor token is included: keep the file private. */
  function exportJson(code) {
    var obj = { app: 'broward-trading', kind: 'instructor-backup', version: 1, exportedAt: new Date(clock()).toISOString(), weights: weights(), requiredDrills: state.requiredDrills, requiredCount: state.requiredCount };
    obj.classes = code ? [getClass(code)].filter(Boolean) : classes();
    return JSON.stringify(obj, null, 2);
  }
  function importJson(text) {
    var parsed; try { parsed = JSON.parse(String(text)); } catch (e) { return { ok: false, error: 'That is not valid JSON.' }; }
    if (!parsed || parsed.kind !== 'instructor-backup' || !Array.isArray(parsed.classes)) return { ok: false, error: 'That file is not an instructor backup from this page.' };
    var added = 0, merged = 0, students = 0;
    parsed.classes.forEach(function (c) {
      if (!c || !validCode(c.code)) return;
      var code = normCode(c.code), cls = state.classes[code];
      if (!cls) { cls = state.classes[code] = { code: code, name: cleanText(c.name, 80), section: cleanText(c.section, 40), term: cleanText(c.term, 40), createdAt: c.createdAt || new Date(clock()).toISOString(), remote: !!c.remote, token: typeof c.token === 'string' ? c.token : null, syncedAt: null, students: {}, names: {}, manual: {} }; added++; } else merged++;
      Object.keys(c.students || {}).forEach(function (id) { var r = addSnapshot(code, c.students[id], { source: 'backup', allowMismatch: true, save: false }); if (r.status === 'added' || r.status === 'updated') students++; });
      Object.keys(c.names || {}).forEach(function (id) { if (validId(id) && !has(cls.names, id)) cls.names[id] = cleanText(c.names[id], 40); });
      Object.keys(c.manual || {}).forEach(function (id) { if (validId(id) && c.manual[id] && typeof c.manual[id] === 'object') cls.manual[id] = Object.assign({}, cls.manual[id] || {}, c.manual[id]); });
      if (!cls.token && typeof c.token === 'string') cls.token = c.token;
    });
    if (parsed.weights) setWeights(parsed.weights);
    if (!state.active) state.active = Object.keys(state.classes)[0] || null;
    var saved = save();
    return { ok: true, added: added, merged: merged, students: students, saved: saved };
  }

  /* ------------------------------------------------------------------ *
   * backend (server/worker.js /classes routes)
   * ------------------------------------------------------------------ */
  function configured() { try { return !!(BT.auth && BT.auth.configured && BT.auth.configured()); } catch (e) { return false; } }
  function apiUrl(path) { return String((BT.auth && BT.auth.config && BT.auth.config.apiBase) || '').replace(/\/+$/, '') + path; }
  function sessionToken() { var s = lsGet('bt.auth', null); return s && typeof s.token === 'string' ? s.token : null; }
  function api(method, path, body, cls) {
    if (!configured()) return Promise.resolve({ ok: false, notConfigured: true, error: 'No classroom server is configured; this page works from pasted share codes.' });
    if (typeof glob('fetch') !== 'function') return Promise.resolve({ ok: false, error: 'fetch is not available in this browser.' });
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var tok = sessionToken(); if (tok) headers['Authorization'] = 'Bearer ' + tok;
    if (cls && cls.token) headers['X-Class-Token'] = cls.token;
    if (state.secret) headers['X-Instructor-Secret'] = state.secret;
    return glob('fetch')(apiUrl(path), { method: method, mode: 'cors', headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) { return res.text().then(function (t) { var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; } return res.ok ? { ok: true, status: res.status, data: d || {} } : { ok: false, status: res.status, error: (d && d.error) || ('Request failed (' + res.status + ')'), data: d }; }); })
      .catch(function () { return { ok: false, network: true, error: 'Could not reach the classroom server.' }; });
  }
  function setSecret(s) { state.secret = String(s || '').slice(0, 200); save(); }
  function createRemote(opts) {
    opts = opts || {};
    return api('POST', '/classes', { name: opts.name, section: opts.section, term: opts.term }).then(function (r) {
      if (!r.ok) return r;
      var d = r.data;
      var made = createClass({ name: d.name || opts.name, section: d.section || opts.section, term: d.term || opts.term, code: d.code, token: d.instructorToken || null, remote: true, createdAt: d.createdAt });
      return made.ok ? { ok: true, cls: made.cls, code: made.code, via: d.ownerKind } : made;
    });
  }
  var ROSTER_PAGE = 100;      // server/worker.js ROSTER_PAGE_MAX for ?view=full
  var ROSTER_MAX_PAGES = 20;  // 2,000 rows: far above MAX_ROSTER (500), so a misbehaving cursor cannot loop forever
  /**
   * refreshRoster(code) → Promise<{ok, added, updated, count, pages, via, saved}>
   * GET /classes/:code/roster is paginated (server/worker.js v0.4.1: `limit`, `cursor`, `hasMore`); every page is
   * fetched and merged, then localStorage is written once.
   */
  function refreshRoster(code) {
    var cls = getClass(code);
    if (!cls) return Promise.resolve({ ok: false, error: 'No such class.' });
    var added = 0, updated = 0, count = 0, pages = 0, via = null, meta = null;
    var page = function (cursor) {
      var q = '?limit=' + ROSTER_PAGE + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      return api('GET', '/classes/' + encodeURIComponent(cls.code) + '/roster' + q, undefined, cls).then(function (r) {
        if (!r.ok) return r;
        pages++;
        var students = Array.isArray(r.data.students) ? r.data.students : [];
        count += students.length;
        if (r.data.via) via = r.data.via;
        if (r.data['class']) meta = r.data['class'];
        // The server already whitelisted these, but they are sanitised again (defence in depth) and stored in one save().
        students.forEach(function (s) { var x = addSnapshot(cls.code, s, { source: 'server', allowMismatch: true, save: false }); if (x.status === 'added') added++; else if (x.status === 'updated') updated++; });
        var next = r.data.hasMore === true && typeof r.data.cursor === 'string' && r.data.cursor && r.data.cursor !== cursor ? r.data.cursor : null;
        if (next && pages < ROSTER_MAX_PAGES) return page(next);
        return { ok: true };
      });
    };
    return page(null).then(function (r) {
      if (!r.ok) return r;
      if (meta) updateClass(cls.code, { name: meta.name, section: meta.section, term: meta.term, remote: true, syncedAt: new Date(clock()).toISOString() });
      else updateClass(cls.code, { remote: true, syncedAt: new Date(clock()).toISOString() });
      return { ok: true, added: added, updated: updated, count: count, pages: pages, via: via, saved: saveOk };
    });
  }
  function removeRemote(code, id) {
    var cls = getClass(code);
    if (!cls) return Promise.resolve({ ok: false, error: 'No such class.' });
    return api('DELETE', '/classes/' + encodeURIComponent(cls.code) + '/students/' + encodeURIComponent(id), undefined, cls);
  }
  /* ------------------------------------------------------------------ *
   * Leagues (v0.5). Thin, guarded wrappers over BT.leagues (js/leagues.js) so the
   * instructor page can track a class competition from the same share codes the
   * roster uses. League data lives in BT.leagues' own store ('bt.leagues'), never
   * in 'bt.instructor'. Every function degrades to a clear answer without BT.leagues.
   * ------------------------------------------------------------------ */
  function T(s, v) {
    if (BT.t) return BT.t(s, v);
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; });
  }
  function leaguesAvailable() { var L = BT.leagues; return !!(L && typeof L.standings === 'function' && typeof L.importShares === 'function' && typeof L.decodeLeague === 'function'); }
  var NO_LEAGUES = 'League tools did not load on this page. Reload it, or open the Leagues page.';
  function leagueList() { if (!leaguesAvailable()) return []; try { return BT.leagues.list(); } catch (e) { return []; } }
  /**
   * addLeagues(text) → {ok, added:[league], failed:[{code, error}]}: every 'BTL1.' league code in a paste
   * is decoded and saved on this device (the organiser does not join; no paper account is created).
   */
  function addLeagues(text) {
    if (!leaguesAvailable()) return { ok: false, added: [], failed: [], error: T(NO_LEAGUES) };
    var L = BT.leagues, out = { ok: true, added: [], failed: [] };
    var codes = typeof L.parseLeagueCodes === 'function' ? L.parseLeagueCodes(text) : [];
    if (!codes.length) {
      var d0 = L.decodeLeague(String(text == null ? '' : text).trim());
      return { ok: false, added: [], failed: [], error: d0 && d0.error ? d0.error : T('Paste a league code that starts with "BTL1.".') };
    }
    codes.forEach(function (c) {
      var d = L.decodeLeague(c);
      if (!d || !d.ok) { out.failed.push({ code: c.slice(0, 24) + (c.length > 24 ? '…' : ''), error: (d && d.error) || T('That league code could not be read.') }); return; }
      var label = c.slice(0, 24) + (c.length > 24 ? '…' : '');
      if (typeof L.addLeague === 'function') {
        // addLeague keeps members this device already knows and refuses rule changes once a league has started.
        var res = L.addLeague(d.league);
        if (!res || !res.ok || !res.league) out.failed.push({ code: label, error: (res && res.error) || T('That league code could not be read.') });
        else out.added.push(res.league);
        return;
      }
      var known = L.get(d.league.code);
      if (known && known.members && known.members.length) {   // keep members this device already knows
        d.league.members = (d.league.members || []).concat(known.members.filter(function (m) { return !(d.league.members || []).some(function (x) { return x.studentId === m.studentId; }); }));
      }
      var saved = L.save(d.league);
      if (saved) out.added.push(saved);
      else out.failed.push({ code: label, error: T('This league already started; its rules cannot change.') });
    });
    out.ok = out.added.length > 0;
    return out;
  }
  /**
   * importLeagueShares(code, text) → Promise<{found, added, updated, skipped, notInLeague, failed:[{code, error}]}>
   * Decodes every 'BT1.' share code in the paste and keeps the ones that carry a block for this league.
   */
  function importLeagueShares(code, text) {
    var empty = { found: 0, added: 0, updated: 0, skipped: 0, notInLeague: 0, failed: [] };
    if (!leaguesAvailable()) return Promise.resolve(Object.assign(empty, { error: T(NO_LEAGUES) }));
    var L = BT.leagues, c = L.normalizeCode(code);
    if (!L.get(c)) return Promise.resolve(Object.assign(empty, { error: T('Add the league first: paste its league code above.') }));
    var parse = BT.classroom && BT.classroom.parseShareCodes ? BT.classroom.parseShareCodes : L.parseShareCodes;
    var decode = BT.classroom && BT.classroom.decodeShare ? BT.classroom.decodeShare : L.decodeShare;
    var codes = parse(text);
    var out = Object.assign({}, empty, { found: codes.length, failed: [] });
    if (!codes.length) { out.error = T('No share codes found. A share code starts with "BT1.".'); return Promise.resolve(out); }
    var snaps = [], chain = Promise.resolve();
    codes.forEach(function (sc) {
      chain = chain.then(function () {
        return decode(sc).then(function (r) {
          if (!r || !r.ok) { out.failed.push({ code: sc.slice(0, 24) + (sc.length > 24 ? '…' : ''), error: (r && r.error) || T('That share code could not be read.') }); return; }
          if (!r.snapshot.leagues || !r.snapshot.leagues[c]) { out.notInLeague++; return; }
          snaps.push(r.snapshot);
        }, function () { out.failed.push({ code: sc.slice(0, 24), error: T('That share code could not be read.') }); });
      });
    });
    return chain.then(function () {
      if (snaps.length) { var res = L.importShares(c, snaps); out.added = res.added; out.updated = res.updated; out.skipped = res.skipped; }
      return out;
    });
  }
  /** leagueStandings(code, serverRows?) → {league, rows, teams, phase, countdown} | null */
  function leagueStandings(code, serverRows) {
    if (!leaguesAvailable()) return null;
    var L = BT.leagues, lg = L.get(code);
    if (!lg) return null;
    // Server rows (GET /leagues/:code/standings) carry their sparkline as `spark`; BT.leagues reads equityHistory.
    var fromServer = Array.isArray(serverRows) ? serverRows.map(function (r) { return r && typeof r === 'object' && !r.equityHistory && Array.isArray(r.spark) ? Object.assign({}, r, { equityHistory: r.spark }) : r; }) : null;
    var snaps = fromServer || (typeof L.knownSnapshots === 'function' ? L.knownSnapshots(lg.code) : L.imported(lg.code));
    var rows = L.standings(lg, snaps);
    var teams = lg.rules && lg.rules.teams && typeof L.teamStandings === 'function' ? L.teamStandings(rows, lg) : [];
    var phase = null, countdown = null;
    try { phase = L.phase(lg); countdown = L.countdown(lg); } catch (e) { /* optional */ }
    return { league: lg, rows: rows, teams: teams, phase: phase, countdown: countdown };
  }
  /** csvLeague(code) → standings as CSV (formula-safe cells), '' when unknown. */
  function csvLeague(code) {
    var st = leagueStandings(code);
    if (!st) return '';
    var head = ['rank', 'name', 'student_id', 'team', 'return_pct', 'max_drawdown_pct', 'sharpe', 'trades', 'consistency_score', 'equity', 'updated_at', 'rules_mismatch'];
    return csv([head].concat(st.rows.map(function (r) { return [r.rank, r.displayName, r.studentId, r.team || '', r.returnPct, r.maxDrawdownPct, r.sharpe, r.trades, r.consistencyScore, r.equity, r.updatedAt || '', r.rulesMismatch ? 'yes' : '']; })));
  }

  var REMOVE_BATCH = 50;   // server/worker.js caps {ids} at 50 per call and {all:true} at 50 records per call
  /**
   * removeStudents(code, {ids:[…]} | {all:true}) → Promise<{ok, removed, ids:[…], remaining, calls}>
   * Bulk DELETE /classes/:code/students: ids in batches of 50, or every record (looping while the server says hasMore).
   * Removed ids are locked out server-side (their next snapshot gets 410), so the caller confirms first.
   */
  function removeStudents(code, opts) {
    opts = opts || {};
    var cls = getClass(code);
    if (!cls) return Promise.resolve({ ok: false, error: 'No such class.' });
    var path = '/classes/' + encodeURIComponent(cls.code) + '/students';
    var out = { ok: true, removed: 0, ids: [], remaining: null, calls: 0 };
    if (opts.all === true) {
      var sweep = function () {
        return api('DELETE', path, { all: true }, cls).then(function (r) {
          if (!r.ok) return r;
          out.calls++; out.removed += +r.data.removed || 0; out.remaining = r.data.remaining == null ? null : +r.data.remaining;
          (Array.isArray(r.data.ids) ? r.data.ids : []).forEach(function (id) { if (validId(id)) out.ids.push(id); });
          return r.data.hasMore === true && out.calls < ROSTER_MAX_PAGES ? sweep() : out;
        });
      };
      return sweep();
    }
    var ids = (Array.isArray(opts.ids) ? opts.ids : []).filter(validId);
    if (!ids.length) return Promise.resolve({ ok: false, error: 'No student ids to remove.' });
    var batches = [];
    for (var i = 0; i < ids.length; i += REMOVE_BATCH) batches.push(ids.slice(i, i + REMOVE_BATCH));
    var chain = Promise.resolve({ ok: true });
    batches.forEach(function (b) {
      chain = chain.then(function (r) {
        if (!r.ok) return r;
        return api('DELETE', path, { ids: b }, cls).then(function (x) {
          if (!x.ok) return x;
          out.calls++; out.removed += +x.data.removed || 0; out.remaining = x.data.remaining == null ? null : +x.data.remaining;
          (Array.isArray(x.data.ids) ? x.data.ids : b).forEach(function (id) { if (validId(id)) out.ids.push(id); });
          return { ok: true };
        });
      });
    });
    return chain.then(function (r) { return r.ok ? out : r; });
  }

  BT.instructor = {
    KEY: KEY, DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, COMPONENTS: COMPONENTS, DEFAULT_REQUIRED: DEFAULT_REQUIRED, STALE_DAYS: STALE_DAYS,
    load: load, save: save, saveStatus: saveStatus, reset: reset, getState: getState, setClock: function (fn) { clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; },
    classes: classes, getClass: getClass, active: active, setActive: setActive, createClass: createClass, updateClass: updateClass, deleteClass: deleteClass,
    validId: validId, sanitizeSnapshot: sanitizeSnapshot, addSnapshot: addSnapshot, importShareCodes: importShareCodes, removeStudent: removeStudent, renameStudent: renameStudent, setManual: setManual, nameOf: nameOf,
    setCourseIndex: setCourseIndex, lessonsTotal: lessonsTotal, moduleOf: moduleOf, moduleBreakdown: moduleBreakdown,
    row: row, roster: roster, summary: summary, SORT_KEYS: SORT_KEYS,
    weights: weights, setWeights: setWeights, weightsTotal: weightsTotal, requiredDrills: requiredDrills, setRequiredDrills: setRequiredDrills, autoScores: autoScores, grade: grade, letter: letter,
    csvRoster: csvRoster, csvGradebook: csvGradebook, exportJson: exportJson, importJson: importJson, csvCell: csvCell,
    remote: { configured: configured, createRemote: createRemote, refreshRoster: refreshRoster, removeRemote: removeRemote, removeStudents: removeStudents, setSecret: setSecret, api: api },
    leagues: { available: leaguesAvailable, list: leagueList, add: addLeagues, importShares: importLeagueShares, standings: leagueStandings, csv: csvLeague }
  };

  /* ================================================================== *
   * Page script (instructor.html only)
   * ================================================================== */
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('instApp')) return;
  var I = BT.instructor;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmtPct = function (v, dp) { return v == null || !isFinite(+v) ? '—' : (+v).toFixed(dp == null ? 0 : dp) + '%'; };
  var fmtSigned = function (v) { return v == null || !isFinite(+v) ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(1) + '%'; };
  var cls = function (v) { return v > 0 ? 'gain' : v < 0 ? 'loss' : ''; };
  var loc = function () { try { return BT.i18n && typeof BT.i18n.locale === 'function' ? BT.i18n.locale() : undefined; } catch (e) { return undefined; } };
  var niceDay = function (s) { if (!s) return 'never'; var d = new Date(String(s).length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? String(s) : d.toLocaleDateString(loc(), { month: 'short', day: 'numeric' }); };
  /* Student-written text (names, ids) is wrapped so js/i18n.js never machine-translates it (a student called "Dashboard" stays "Dashboard"). */
  var userSpan = function (s, tag) { tag = tag || 'span'; return '<' + tag + ' class="no-i18n" translate="no">' + esc(s) + '</' + tag + '>'; };
  var ui = { sort: 'name', dir: 'asc', q: '', drawer: null };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('bt.instructor.ui') || '{}')); } catch (e) { /* ignore */ }
  ui.drawer = null;
  function saveUi() { try { localStorage.setItem('bt.instructor.ui', JSON.stringify({ sort: ui.sort, dir: ui.dir })); } catch (e) { /* ignore */ } }
  function toast(msg, kind, title) { if (BT.nav && BT.nav.toast) BT.nav.toast(msg, kind, title); }
  function flash(el, msg, ok) { if (!el) return; el.textContent = msg; el.className = 'msg ' + (ok ? 'ok' : 'warn'); clearTimeout(el._t); el._t = setTimeout(function () { el.textContent = ''; }, 6000); }
  function copyText(text, msgEl) {
    var done = function () { flash(msgEl, 'Copied.', true); }, fail = function () { flash(msgEl, 'Copy blocked by the browser: long-press the text and copy it.', false); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail); else fail();
  }

  // Course index (titles, lesson counts) — optional; the fallback table knows the eight v0.3 modules.
  if (typeof fetch === 'function') {
    fetch('course/index.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (idx) { if (idx && I.setCourseIndex(idx)) renderAll(); }).catch(function () { /* offline without cache: fallback */ });
  }

  /* ---- header / class picker ---- */
  function renderHeader() {
    var a = I.active(), s = a ? I.summary(a.code) : null;
    $('pillBackend').textContent = I.remote.configured() ? 'server: connected' : 'offline: share codes';
    $('pillBackend').className = 'pill ' + (I.remote.configured() ? 'live' : 'demo');
    $('pillStudents').textContent = s ? s.students + ' student' + (s.students === 1 ? '' : 's') : 'no class yet';
    $('pillActive').hidden = !s;
    if (s) $('pillActive').textContent = s.activeThisWeek + ' active this week';
    var sel = $('classSelect');
    var list = I.classes();
    sel.innerHTML = list.length ? list.map(function (c) { return '<option value="' + esc(c.code) + '"' + (a && a.code === c.code ? ' selected' : '') + '>' + esc(c.name) + (c.section ? ' · ' + esc(c.section) : '') + ' — ' + esc(c.code) + '</option>'; }).join('') : '<option value="">No classes yet</option>';
    sel.disabled = !list.length;
    $('classDetails').hidden = !a;
    if (a) {
      $('codeBig').textContent = a.code;
      $('classMeta').textContent = [a.name, a.section, a.term].filter(Boolean).join(' · ') + (a.remote ? ' · synced with the server' : ' · offline class') + (a.syncedAt ? ' · last refresh ' + niceDay(a.syncedAt) : '');
      $('refreshBtn').hidden = !(a.remote && I.remote.configured());
      if ($('clearRemote')) $('clearRemote').hidden = !(a.remote && I.remote.configured());
      $('tokenNote').hidden = !a.remote;
      if (a.remote) $('tokenNote').textContent = a.token ? 'This browser holds the instructor key for this class. Export a JSON backup before clearing site data, or you will lose roster access.' : 'No instructor key stored here: roster refresh needs your sign-in session or the school\'s instructor secret.';
    }
    $('createForm').hidden = !!a && !ui.showCreate;
    $('newClassBtn').hidden = !a || ui.showCreate;
    $('secretRow').hidden = !I.remote.configured();
    $('secretDetails').hidden = !I.remote.configured();
    renderSaveWarning();
  }
  // localStorage refused the last save (quota): say so instead of showing students that vanish on reload.
  var saveWarn = null;
  function renderSaveWarning() {
    var st = I.saveStatus();
    if (st.ok) { if (saveWarn) saveWarn.hidden = true; return; }
    if (!saveWarn) {
      saveWarn = document.createElement('p'); saveWarn.id = 'saveWarn'; saveWarn.className = 'note warn-text'; saveWarn.setAttribute('role', 'alert');
      var card = $('classCard'); card.insertBefore(saveWarn, card.firstElementChild ? card.firstElementChild.nextSibling : null);
    }
    saveWarn.hidden = false;
    saveWarn.textContent = 'Could not save to this device: the roster (' + Math.round(st.bytes / 1024) + ' KB) is more than the browser allows this site to store. What you see is not kept after a reload. Export a JSON backup now, then delete old classes or remove students who left.';
  }
  function warnIfUnsaved(saved) { if (saved === false || !I.saveStatus().ok) toast('Roster too large to keep on this device; export a backup or remove old students.', 'err', 'Not saved'); }
  $('classSelect').addEventListener('change', function () { I.setActive(this.value); ui.showCreate = false; renderAll(); });
  $('newClassBtn').addEventListener('click', function () { ui.showCreate = true; renderHeader(); $('cName').focus(); });
  $('cancelCreate').addEventListener('click', function () { ui.showCreate = false; renderHeader(); });
  $('copyCode').addEventListener('click', function () { var a = I.active(); if (a) copyText(a.code, $('codeMsg')); });
  $('copyInvite').addEventListener('click', function () {
    var a = I.active(); if (!a) return;
    var site = location.origin + location.pathname.replace(/[^/]*$/, '');
    copyText('Join our Broward Trading class "' + a.name + '": open ' + site + 'learn.html, scroll to Classroom and enter the code ' + a.code + '. No account or email needed. ' +
      (I.remote.configured() ? 'Your progress syncs automatically.' : 'Each week, tap "Copy share code" there and send me the code.'), $('codeMsg'));
  });
  $('createForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('cName').value, section = $('cSection').value, term = $('cTerm').value;
    var msg = $('createMsg');
    var finish = function (r) {
      if (!r.ok) { flash(msg, r.error || 'Could not create the class.', false); return; }
      ui.showCreate = false; $('cName').value = ''; $('cSection').value = ''; $('cTerm').value = '';
      toast('Class code ' + r.code + '. Students enter it under Learn → Classroom.', 'ok', 'Class created');
      renderAll();
    };
    if (I.remote.configured() && $('cRemote').checked) {
      $('createBtn').disabled = true;
      I.remote.createRemote({ name: name, section: section, term: term }).then(function (r) {
        $('createBtn').disabled = false;
        if (!r.ok && r.status === 401) { flash(msg, r.error + ' Or untick "sync with the server" to run this class from share codes.', false); return; }
        if (!r.ok && !r.notConfigured) { flash(msg, r.error, false); return; }
        if (!r.ok) { finish(I.createClass({ name: name, section: section, term: term })); return; }
        finish(r);
      });
    } else finish(I.createClass({ name: name, section: section, term: term }));
  });
  $('secretSave').addEventListener('click', function () { I.remote.setSecret($('secretIn').value.trim()); $('secretIn').value = ''; flash($('secretMsg'), I.getState().secret ? 'Instructor secret saved in this browser.' : 'Instructor secret cleared.', true); });
  $('refreshBtn').addEventListener('click', function () {
    var a = I.active(); if (!a) return;
    $('refreshBtn').disabled = true;
    I.remote.refreshRoster(a.code).then(function (r) {
      $('refreshBtn').disabled = false;
      if (!r.ok) { toast(r.error || 'Refresh failed.', 'err', 'Roster'); return; }
      toast(r.count + ' snapshot' + (r.count === 1 ? '' : 's') + ' on the server; ' + r.added + ' new, ' + r.updated + ' updated.', 'ok', 'Roster refreshed');
      warnIfUnsaved(r.saved);
      renderAll();
    });
  });
  $('deleteClass').addEventListener('click', function () {
    var a = I.active(); if (!a) return;
    if (!confirm('Delete class ' + a.code + ' (' + a.name + ') from this device? Students and grades stored here are removed. Export a backup first if you need them.')) return;
    I.deleteClass(a.code); renderAll();
  });
  // Bulk server clean-up (flooded codes, end of term). Removed ids are locked out: their next snapshot gets 410.
  var clearRemoteBtn = $('clearRemote');
  if (clearRemoteBtn) clearRemoteBtn.addEventListener('click', function () {
    var a = I.active(); if (!a) return;
    if (!confirm('Remove every student of ' + a.code + ' from the classroom server? Their ids are locked out, so each device must rejoin with a fresh id to appear again. Rows stored on this device are removed too; export a backup first if you need them.')) return;
    clearRemoteBtn.disabled = true;
    I.remote.removeStudents(a.code, { all: true }).then(function (r) {
      clearRemoteBtn.disabled = false;
      if (!r.ok) { toast(r.error || 'Could not remove the students.', 'err', 'Roster'); return; }
      Object.keys(a.students || {}).forEach(function (id) { I.removeStudent(a.code, id); });
      toast(r.removed + ' student' + (r.removed === 1 ? '' : 's') + ' removed from the server' + (r.remaining ? '; ' + r.remaining + ' left, run it again' : '') + '.', 'ok', 'Roster cleared');
      renderAll();
    });
  });

  /* ---- import ---- */
  // Codes made for another class are skipped unless the instructor opts in (a wrong paste must not populate this roster).
  var anyClassBox = document.createElement('label');
  anyClassBox.className = 'inline-check';
  anyClassBox.innerHTML = '<input type="checkbox" id="importAnyClass"> Also import codes made for another class (they are skipped otherwise)';
  $('importIn').closest('.field').insertAdjacentElement('afterend', anyClassBox);
  $('importBtn').addEventListener('click', function () {
    var a = I.active(); var msg = $('importMsg');
    if (!a) { flash(msg, 'Create a class first.', false); return; }
    $('importBtn').disabled = true;
    I.importShareCodes(a.code, $('importIn').value, { allowMismatch: $('importAnyClass').checked }).then(function (r) {
      $('importBtn').disabled = false;
      if (r.error && !r.found) { flash(msg, r.error, false); return; }
      var parts = [];
      if (r.added) parts.push(r.added + ' new'); if (r.updated) parts.push(r.updated + ' updated'); if (r.older) parts.push(r.older + ' older than what you have (kept yours)');
      if (r.skipped) parts.push(r.skipped + ' for another class (skipped)');
      if (r.failed.length) parts.push(r.failed.length + ' unreadable');
      flash(msg, 'Found ' + r.found + ' code' + (r.found === 1 ? '' : 's') + ': ' + (parts.join(', ') || 'nothing to do') + '.', !r.failed.length && !r.skipped);
      var errs = r.failed.map(function (f) { return '<li><code>' + esc(f.code) + '</code> ' + esc(f.error) + '</li>'; });
      if (r.skipped) errs.push('<li>Skipped, made for another class code: ' + r.mismatched.map(function (id) { return '<code>' + esc(id) + '</code>'; }).join(', ') + '. Tick "Also import codes made for another class" if that is what you want.</li>');
      $('importErrors').innerHTML = errs.length ? '<ul>' + errs.join('') + '</ul>' : '';
      if (!r.skipped && r.mismatched.length) toast(r.mismatched.length + ' snapshot' + (r.mismatched.length === 1 ? ' was' : 's were') + ' made for a different class code and imported because you asked. The roster marks them.', 'warn', 'Class code mismatch');
      if (r.added || r.updated) $('importIn').value = '';
      warnIfUnsaved(r.saved);
      renderAll();
    });
  });

  /* ---- roster ---- */
  var COLS = [
    { key: 'name', label: 'Student', cls: '' }, { key: 'progress', label: 'Progress', cls: 'right' }, { key: 'quiz', label: 'Quiz avg', cls: 'right' },
    { key: 'drills', label: 'Drills', cls: 'right' }, { key: 'paper', label: 'Paper return', cls: 'right' }, { key: 'journal', label: 'Journal', cls: 'right' },
    { key: 'streak', label: 'Daily 5', cls: 'right' }, { key: 'active', label: 'Last active', cls: 'right' }
  ];
  function renderRoster() {
    var a = I.active(), host = $('rosterBody'), head = $('rosterHead');
    head.innerHTML = '<tr>' + COLS.map(function (c) {
      var on = ui.sort === c.key;
      return '<th class="' + c.cls + '" aria-sort="' + (on ? (ui.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="th-btn' + (on ? ' on' : '') + '" data-sort="' + c.key + '">' + esc(c.label) + (on ? (ui.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    if (!a) { host.innerHTML = '<tr><td colspan="8"><div class="empty"><b>No class yet</b>Create one above to get a class code.</div></td></tr>'; $('rosterCount').textContent = ''; return; }
    var rows = I.roster(a.code, ui);
    var all = Object.keys(a.students).length;
    $('rosterCount').textContent = rows.length ? '· ' + rows.length + (rows.length !== all ? ' of ' + all : '') : '';
    if (!rows.length) {
      host.innerHTML = '<tr><td colspan="8"><div class="empty">' + (all ? 'No student matches that search.' : '<b>No students yet</b>' + (I.remote.configured() && a.remote ? 'Students appear here after they join with the code and open Learn. Tap "Refresh from server".' : 'Paste the share codes students send you into the box below.')) + '</div></td></tr>';
      return;
    }
    host.innerHTML = rows.map(function (r) {
      return '<tr class="r' + (r.stale ? ' stale' : '') + '" data-id="' + esc(r.id) + '" tabindex="0" role="button" aria-label="Open ' + esc(r.name) + '">' +
        '<td>' + userSpan(r.name, 'b') + '<small class="id">' + userSpan(r.id) + (r.mismatched ? ' · other class code' : '') + (r.certificate ? ' · 🎓' : '') + '</small></td>' +
        '<td class="right num"><span class="mini" aria-hidden="true"><i style="width:' + r.progressPct + '%"></i></span>' + r.progressPct + '%<small>' + r.lessonsDone + '/' + r.lessonsTotal + '</small></td>' +
        '<td class="right num">' + fmtPct(r.quizAvg) + '<small>' + r.quizzes + ' quiz' + (r.quizzes === 1 ? '' : 'zes') + '</small></td>' +
        '<td class="right num">' + r.drillsPassed + '<small>' + r.drillsRequiredPassed + '/' + I.requiredDrills().count + ' required</small></td>' +
        '<td class="right num ' + cls(r.paperReturnPct) + '">' + fmtSigned(r.paperReturnPct) + '<small>' + r.paperTrades + ' trade' + (r.paperTrades === 1 ? '' : 's') + '</small></td>' +
        '<td class="right num">' + r.journalEntries + '<small>' + r.journalReviewed + ' reviewed · ' + r.weeklyReviews + ' wk</small></td>' +
        '<td class="right num">' + r.streak + '<small>' + r.dailyDays + ' day' + (r.dailyDays === 1 ? '' : 's') + '</small></td>' +
        '<td class="right num">' + esc(niceDay(r.lastActive)) + (r.stale ? '<small class="warn-text">' + r.daysSinceActive + ' days ago</small>' : '<small>&nbsp;</small>') + '</td></tr>';
    }).join('');
  }
  $('rosterHead').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sort]'); if (!b) return;
    var k = b.getAttribute('data-sort');
    if (ui.sort === k) ui.dir = ui.dir === 'asc' ? 'desc' : 'asc'; else { ui.sort = k; ui.dir = k === 'name' ? 'asc' : 'desc'; }
    saveUi(); renderRoster();
  });
  $('rosterBody').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) openDrawer(tr.getAttribute('data-id')); });
  $('rosterBody').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-id]')) { e.preventDefault(); openDrawer(e.target.getAttribute('data-id')); } });
  $('rosterSearch').addEventListener('input', function () { ui.q = this.value; renderRoster(); });

  /* ---- gradebook ---- */
  function renderGradebook() {
    var a = I.active(), w = I.weights();
    $('weights').innerHTML = I.COMPONENTS.map(function (c) {
      return '<div class="field"><label for="w_' + c.id + '">' + esc(c.label) + (c.auto ? '' : ' <span class="pill solid">manual</span>') + '</label><input id="w_' + c.id + '" type="number" inputmode="numeric" min="0" max="100" step="1" value="' + esc(w[c.id]) + '" data-w="' + c.id + '" aria-describedby="wh_' + c.id + '"><span class="help" id="wh_' + c.id + '">' + esc(c.help) + '</span></div>';
    }).join('');
    var total = I.weightsTotal();
    $('weightsTotal').textContent = 'Weights add up to ' + total + (total === 100 ? ' ✓' : ' — the Teaching Guide uses 100');
    $('weightsTotal').className = 'msg ' + (total === 100 ? 'ok' : 'warn');
    $('reqCount').value = I.requiredDrills().count;
    $('reqIds').value = I.requiredDrills().ids.join(', ');
    var body = $('gradeBody');
    if (!a || !Object.keys(a.students).length) { body.innerHTML = '<tr><td colspan="' + (I.COMPONENTS.length + 3) + '"><div class="empty">Grades appear once the roster has students.</div></td></tr>'; return; }
    $('gradeHead').innerHTML = '<tr><th>Student</th>' + I.COMPONENTS.map(function (c) { return '<th class="right">' + esc(c.label) + '<small>/' + esc(w[c.id]) + '</small></th>'; }).join('') + '<th class="right">Total</th><th class="right">Letter</th></tr>';
    body.innerHTML = I.roster(a.code, ui).map(function (r) {
      var g = I.grade(a.students[r.id], a);
      return '<tr data-id="' + esc(r.id) + '" tabindex="0" role="button" aria-label="Grade ' + esc(r.name) + '"><td>' + userSpan(r.name, 'b') + '</td>' +
        I.COMPONENTS.map(function (c) { var k = g.components[c.id]; return '<td class="right num ' + (k.source === 'missing' ? 'missing' : k.source === 'manual' ? 'manual' : '') + '" title="' + k.source + '">' + (k.points == null ? '—' : k.points) + '</td>'; }).join('') +
        '<td class="right num"><b>' + g.total + '</b><small>' + g.pct + '%</small></td><td class="right"><span class="pill ' + (g.complete ? 'accent' : 'demo') + '">' + g.letter + (g.complete ? '' : '*') + '</span></td></tr>';
    }).join('');
  }
  $('weights').addEventListener('change', function (e) { var k = e.target.getAttribute('data-w'); if (!k) return; var w = {}; w[k] = e.target.value; I.setWeights(w); renderGradebook(); });
  $('resetWeights').addEventListener('click', function () { I.setWeights(I.DEFAULT_WEIGHTS); I.setRequiredDrills(I.DEFAULT_REQUIRED, 6); renderGradebook(); });
  $('reqSave').addEventListener('click', function () { I.setRequiredDrills($('reqIds').value.split(/[,\s]+/).filter(Boolean), $('reqCount').value); renderAll(); flash($('reqMsg'), 'Saved.', true); });
  $('gradeBody').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) openDrawer(tr.getAttribute('data-id'), true); });
  $('gradeBody').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-id]')) { e.preventDefault(); openDrawer(e.target.getAttribute('data-id'), true); } });

  /* ---- export ---- */
  function showExport(text, msg) { $('expOut').value = text; flash($('expMsg'), msg, true); }
  $('expRoster').addEventListener('click', function () { var a = I.active(); if (!a) return; showExport(I.csvRoster(a.code), 'Roster CSV ready: copy it into a spreadsheet (File → Import, or paste into cell A1).'); });
  $('expGrades').addEventListener('click', function () { var a = I.active(); if (!a) return; showExport(I.csvGradebook(a.code), 'Gradebook CSV ready. Components marked (incomplete) still need a manual entry.'); });
  $('expJson').addEventListener('click', function () { var a = I.active(); if (!a) return; showExport(I.exportJson(a.code), 'Backup JSON ready. It contains the instructor key for a synced class: keep it private.'); });
  $('expCopy').addEventListener('click', function () { if ($('expOut').value) copyText($('expOut').value, $('expMsg')); });
  $('expDownload').addEventListener('click', function () {
    var t = $('expOut').value; if (!t) return;
    var isJson = t.charAt(0) === '{';
    var blob = new Blob([t], { type: isJson ? 'application/json' : 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'broward-trading-' + (I.active() ? I.active().code : 'class') + (isJson ? '.json' : '.csv'); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    flash($('expMsg'), 'Download started. If nothing happened your browser blocks downloads: use Copy instead.', true);
  });
  $('impBackupBtn').addEventListener('click', function () {
    var r = I.importJson($('impBackup').value);
    flash($('impBackupMsg'), r.ok ? 'Restored ' + r.added + ' new class' + (r.added === 1 ? '' : 'es') + ', merged ' + r.merged + ', ' + r.students + ' student snapshot' + (r.students === 1 ? '' : 's') + '.' : r.error, r.ok);
    if (r.ok) { $('impBackup').value = ''; warnIfUnsaved(r.saved); renderAll(); }
  });

  /* ---- student drawer ---- */
  var lastFocus = null;
  function openDrawer(id, gradeTab) {
    var a = I.active(); if (!a || !a.students[id]) return;
    var snap = a.students[id], r = I.row(snap, a), g = I.grade(snap, a), w = I.weights();
    ui.drawer = id; lastFocus = document.activeElement;
    $('dTitle').textContent = r.name; $('dTitle').classList.add('no-i18n'); $('dTitle').setAttribute('translate', 'no');
    $('dName').value = a.names[id] || '';
    $('dNameHelp').innerHTML = snap.displayName ? 'The student typed "' + userSpan(snap.displayName) + '". Your label is only stored on this device.' : 'The student gave no name. Add one here (only stored on this device) so you can tell rows apart.';
    $('dId').textContent = id; $('dId').classList.add('no-i18n'); $('dId').setAttribute('translate', 'no');
    // Only a snapshot that came from refreshRoster() may say "received by server"; a pasted code is student-written text.
    var via = r.receivedAt ? ' · received by server ' + new Date(r.receivedAt).toLocaleString(loc()) : r.importedAt ? ' · pasted here ' + new Date(r.importedAt).toLocaleString(loc()) + ' (share code, not verified)' : '';
    $('dMeta').textContent = 'Snapshot ' + (snap.updatedAt ? new Date(snap.updatedAt).toLocaleString(loc()) : '—') + via + (snap.startedAt ? ' · started course ' + niceDay(snap.startedAt) : '') + (r.certificate ? ' · certificate id ' + r.certificate + (r.source === 'server' ? '' : ' (as reported)') : '');
    $('dTiles').innerHTML = [
      ['Progress', r.progressPct + '%', r.lessonsDone + ' of ' + r.lessonsTotal + ' lessons'],
      ['Quiz average', fmtPct(r.quizAvg), r.quizzes + ' taken'],
      ['Drills passed', String(r.drillsPassed), r.drillsRequiredPassed + ' of ' + I.requiredDrills().count + ' required'],
      ['Paper return', fmtSigned(r.paperReturnPct), r.paperTrades + ' closed trades · win rate ' + fmtPct(r.paperWinRate) + ' (never graded)'],
      ['Journal', String(r.journalEntries), r.journalReviewed + ' reviewed · ' + r.weeklyReviews + ' weekly reviews'],
      ['Daily 5', r.streak + ' day streak', r.dailyDays + ' days total']
    ].map(function (t) { return '<div class="stat"><span class="label">' + esc(t[0]) + '</span><span class="value">' + esc(t[1]) + '</span><span class="sub">' + esc(t[2]) + '</span></div>'; }).join('');
    $('dModules').innerHTML = I.moduleBreakdown(snap).map(function (m) {
      // data-label feeds the stacked phone card (instructor.html, ≤560px); explicit roles keep table semantics there.
      return '<tr role="row"><td role="cell">' + esc(m.title) + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Lessons')) + '">' + (m.total ? m.done + '/' + m.total : m.done) + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Progress')) + '"><span class="mini" aria-hidden="true"><i style="width:' + (m.pct || 0) + '%"></i></span>' + (m.pct == null ? '—' : m.pct + '%') + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Quiz avg')) + '">' + fmtPct(m.quizAvg) + '</td></tr>';
    }).join('');
    var req = {}; I.requiredDrills().ids.forEach(function (x) { req[x] = 1; });
    var drills = (snap.drills || []).slice().sort(function (x, y) { return (req[y.id] ? 1 : 0) - (req[x.id] ? 1 : 0) || String(x.id).localeCompare(String(y.id)); });
    $('dDrills').innerHTML = drills.length ? drills.map(function (d) {
      // Every snapshot field is student-supplied: strings go through esc(), numbers through the formatters (which print '—' for non-numbers).
      return '<li><span class="pill ' + (d.passed ? 'up' : d.completed ? 'demo' : '') + '">' + (d.passed ? 'passed' : d.completed ? 'finished' : 'started') + '</span> <b>' + esc(d.title || d.id) + '</b>' + (req[d.id] ? ' <small class="muted">required</small>' : '') + '<small class="muted"> · return ' + esc(fmtSigned(d.returnPct)) + (d.maxDrawdownPct != null ? ' · max DD ' + esc(fmtPct(d.maxDrawdownPct, 1)) : '') + (d.date ? ' · ' + esc(niceDay(d.date)) : '') + '</small></li>';
    }).join('') : '<li class="muted">No replay drills yet.</li>';
    $('dGrade').innerHTML = I.COMPONENTS.map(function (c) {
      var k = g.components[c.id];
      return '<div class="field"><label for="g_' + c.id + '">' + esc(c.label) + ' <small class="muted">/ ' + w[c.id] + (k.auto != null ? ' · auto ' + k.auto : '') + '</small></label>' +
        '<input id="g_' + c.id + '" type="number" inputmode="decimal" min="0" max="' + w[c.id] + '" step="0.5" data-g="' + c.id + '" value="' + (k.manual == null ? '' : esc(k.manual)) + '" placeholder="' + (k.auto == null ? 'enter points' : 'auto ' + k.auto) + '"></div>';
    }).join('');
    $('dNote').value = g.note || '';
    $('dTotal').textContent = g.total + ' / ' + g.max + ' → ' + g.pct + '% · ' + g.letter + (g.complete ? '' : ' (incomplete: ' + g.missing.join(', ') + ')');
    $('drawer').hidden = false; document.body.classList.add('modal-open');
    setTimeout(function () { (gradeTab ? $('g_capstone') : $('dClose')).focus({ preventScroll: true }); if (gradeTab) $('dGradeCard').scrollIntoView({ block: 'start' }); }, 30);
  }
  function closeDrawer() { $('drawer').hidden = true; document.body.classList.remove('modal-open'); ui.drawer = null; if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  $('dClose').addEventListener('click', closeDrawer);
  $('dDone').addEventListener('click', closeDrawer);
  $('drawer').addEventListener('click', function (e) { if (e.target === $('drawer')) closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });
  $('dName').addEventListener('change', function () { var a = I.active(); if (a && ui.drawer) { I.renameStudent(a.code, ui.drawer, this.value); $('dTitle').textContent = I.nameOf(a, a.students[ui.drawer]); renderAll(); } });
  $('dGrade').addEventListener('change', function (e) {
    var k = e.target.getAttribute('data-g'); var a = I.active(); if (!k || !a || !ui.drawer) return;
    var p = {}; p[k] = e.target.value; I.setManual(a.code, ui.drawer, p);
    var g = I.grade(a.students[ui.drawer], a);
    $('dTotal').textContent = g.total + ' / ' + g.max + ' → ' + g.pct + '% · ' + g.letter + (g.complete ? '' : ' (incomplete: ' + g.missing.join(', ') + ')');
    renderGradebook();
  });
  $('dNote').addEventListener('change', function () { var a = I.active(); if (a && ui.drawer) I.setManual(a.code, ui.drawer, { note: this.value }); });
  $('dRemove').addEventListener('click', function () {
    var a = I.active(); if (!a || !ui.drawer) return;
    var id = ui.drawer;
    if (!confirm('Remove ' + I.nameOf(a, a.students[id]) + ' from this class?' + (a.remote ? ' Their device will stop sending snapshots and the server copy is deleted.' : ''))) return;
    var done = function () { I.removeStudent(a.code, id); closeDrawer(); renderAll(); toast('Student removed.', 'ok'); };
    if (a.remote && I.remote.configured()) I.remote.removeRemote(a.code, id).then(function (r) { if (!r.ok) toast(r.error || 'The server did not confirm the removal; removed locally only.', 'warn'); done(); }); else done();
  });

  /* ---- section tabs: Class | Leagues (v0.5) ---- */
  var TAB_KEY = 'bt.instructor.tab';
  var tabs = [$('tabClass'), $('tabLeagues')].filter(Boolean);
  function showTab(which, focus) {
    if (tabs.length < 2) return;
    tabs.forEach(function (t) {
      var on = t.id === (which === 'leagues' ? 'tabLeagues' : 'tabClass');
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('on', on);
      var panel = $(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
      if (on && focus) t.focus();
    });
    try { localStorage.setItem(TAB_KEY, JSON.stringify(which === 'leagues' ? 'leagues' : 'class')); } catch (e) { /* ignore */ }
    if (which === 'leagues') renderLeagues();
    if (BT.a11y && BT.a11y.markScrollables) { try { BT.a11y.markScrollables(); } catch (e) { /* ignore */ } }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { showTab(t.id === 'tabLeagues' ? 'leagues' : 'class'); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, j = null;
      if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % tabs.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      else if (k === 'Home') j = 0; else if (k === 'End') j = tabs.length - 1;
      if (j == null) return;
      e.preventDefault();
      showTab(tabs[j].id === 'tabLeagues' ? 'leagues' : 'class', true);
    });
  });

  /* ---- leagues ---- */
  var lgUi = { code: null, server: null };
  var fmtMoney = function (v) { return v == null || !isFinite(+v) ? '—' : '$' + (+v).toLocaleString(loc(), { maximumFractionDigits: 0 }); };
  function sparkSvg(values, up) {
    var d = BT.leagues && BT.leagues.sparkPath ? BT.leagues.sparkPath(values, 96, 28, 2) : '';
    if (!d) return '<span class="muted">—</span>';
    var v = values.filter(function (x) { return isFinite(+x); });
    var label = T('Equity curve from {from} to {to}', { from: fmtMoney(v[0]), to: fmtMoney(v[v.length - 1]) });
    return '<svg class="lg-spark' + (up ? '' : ' down') + '" viewBox="0 0 96 28" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '"><path d="' + esc(d) + '"/></svg>';
  }
  function rulesText(lg) {
    var r = lg.rules || {};
    var kinds = (r.assets || []).map(function (k) { return T({ stock: 'stocks', etf: 'ETFs', crypto: 'crypto', option: 'options' }[k] || k); }).join(', ');
    var parts = [T('Starting cash {cash}', { cash: fmtMoney(r.startingCash) }), kinds ? T('Assets: {kinds}', { kinds: kinds }) : ''];
    if (r.commission) parts.push(T('Commission {c} per trade', { c: '$' + r.commission }));
    if (r.maxPositionPct && r.maxPositionPct < 100) parts.push(T('Max position {p}% of the account', { p: r.maxPositionPct }));
    parts.push(r.shortSelling ? T('Short selling allowed') : T('No short selling'));
    parts.push(r.dayTrading ? T('Day trading allowed') : T('No day trading'));
    if (r.teams) parts.push(T('Teams: {teams}', { teams: (r.teamNames || []).join(', ') }));
    return parts.filter(Boolean).join(' · ');
  }
  function renderLeagues() {
    var panel = $('leaguesPanel'); if (!panel) return;
    var avail = I.leagues.available();
    $('lgUnavailable').hidden = avail;
    ['lgAddBtn', 'lgImportBtn', 'lgCsv', 'lgClear'].forEach(function (id) { if ($(id)) $(id).disabled = !avail; });
    var list = I.leagues.list();
    if (!lgUi.code || !list.some(function (l) { return l.code === lgUi.code; })) { lgUi.code = list.length ? list[0].code : null; lgUi.server = null; }
    var sel = $('lgSelect');
    sel.innerHTML = list.length ? list.map(function (l) { return '<option value="' + esc(l.code) + '"' + (l.code === lgUi.code ? ' selected' : '') + '>' + esc(l.name) + ' — ' + esc(l.code) + '</option>'; }).join('') : '<option value="">' + esc(T('No leagues on this device yet')) + '</option>';
    sel.disabled = !list.length;
    var st = lgUi.code ? I.leagues.standings(lgUi.code, lgUi.server) : null;
    var info = $('lgInfo');
    var canRemote = !!(st && st.league.online && BT.leagues.remote && BT.leagues.remote.configured && BT.leagues.remote.configured());
    $('lgRefresh').hidden = !canRemote;
    if (!st) {
      info.hidden = true; $('lgBody').innerHTML = ''; $('lgTeams').innerHTML = ''; $('lgCount').textContent = '';
      $('lgEmpty').hidden = false; $('lgEmpty').textContent = T(avail ? 'No standings yet. Add a league, then import share codes.' : 'League tools did not load on this page. Reload it, or open the Leagues page.');
      return;
    }
    var lg = st.league;
    info.hidden = false;
    info.innerHTML = '<span class="lg-name no-i18n" translate="no">' + esc(lg.name) + '</span>' +
      '<span class="pill accent no-i18n" translate="no">' + esc(lg.code) + '</span>' +
      '<span class="pill' + (st.phase === 'active' ? ' up' : st.phase === 'upcoming' ? ' demo' : '') + '">' + esc(st.countdown && st.countdown.label ? st.countdown.label : T(st.phase || '')) + '</span>' +
      '<span class="muted">' + esc(lg.startDate) + ' → ' + esc(lg.endDate) + '</span>' +
      (lgUi.server ? '<span class="pill live">' + esc(T('from the league server')) + '</span>' : '') +
      '<span class="lg-rules">' + esc(rulesText(lg)) + '</span>';
    var rows = st.rows;
    $('lgCount').textContent = rows.length ? '· ' + T(rows.length === 1 ? '{n} student' : '{n} students', { n: rows.length }) : '';
    $('lgEmpty').hidden = rows.length > 0;
    $('lgEmpty').textContent = T('No standings yet. Paste share codes from students who joined this league.');
    $('lgBody').innerHTML = rows.map(function (r) {
      var name = r.displayName || T('Student {id}', { id: String(r.studentId).replace(/^s-/, '').slice(0, 6) });
      return '<tr role="row" class="' + (r.rank === 1 && rows.length > 1 ? 'lead' : '') + '">' +
        '<td role="cell" class="rank">' + r.rank + '</td>' +
        '<td role="cell" class="who"><b class="no-i18n" translate="no">' + esc(name) + '</b><small class="no-i18n" translate="no">' + esc(r.studentId) + (r.team ? ' · ' + esc(r.team) : '') + (r.me ? ' · ' + esc(T('this device')) : '') + '</small></td>' +
        '<td role="cell" class="right num ' + cls(r.returnPct) + '" data-label="' + esc(T('Return')) + '">' + fmtSigned(r.returnPct) + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Max drawdown')) + '">' + fmtPct(r.maxDrawdownPct, 1) + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Sharpe')) + '">' + (r.sharpe == null || !isFinite(+r.sharpe) ? '—' : (+r.sharpe).toFixed(2)) + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Trades')) + '">' + (+r.trades || 0) + '</td>' +
        '<td role="cell" class="right num" data-label="' + esc(T('Consistency')) + '">' + (r.consistencyScore == null || !isFinite(+r.consistencyScore) ? '—' : Math.round(+r.consistencyScore)) + '</td>' +
        '<td role="cell" class="spark" data-label="' + esc(T('Equity')) + '">' + sparkSvg(r.equityHistory || [], (+r.returnPct || 0) >= 0) + '</td></tr>';
    }).join('');
    $('lgTeams').innerHTML = st.teams && st.teams.length ? '<ul class="lg-teams" aria-label="' + esc(T('Team standings')) + '">' + st.teams.map(function (t) {
      return '<li><b>' + t.rank + '. <span class="no-i18n" translate="no">' + esc(t.team) + '</span></b>' +
        esc(T(t.members === 1 ? '{n} member' : '{n} members', { n: t.members })) + ' · ' + esc(T('avg return')) + ' <span class="' + cls(t.avgReturnPct) + '">' + fmtSigned(t.avgReturnPct) + '</span> · ' + esc(T('avg drawdown')) + ' ' + fmtPct(t.avgDrawdownPct, 1) + '</li>';
    }).join('') + '</ul>' : '';
  }
  if ($('leaguesPanel')) {
    $('lgSelect').addEventListener('change', function () { lgUi.code = this.value || null; lgUi.server = null; $('lgCsvOut').hidden = true; renderLeagues(); });
    $('lgAddBtn').addEventListener('click', function () {
      var r = I.leagues.add($('lgAddIn').value), msg = $('lgAddMsg');
      if (!r.ok) { flash(msg, r.error || (r.failed[0] && r.failed[0].error) || T('That league code could not be read.'), false); return; }
      lgUi.code = r.added[r.added.length - 1].code; lgUi.server = null;
      flash(msg, r.added.length === 1 ? T('Added {name}.', { name: r.added[0].name }) : T('Added {n} leagues.', { n: r.added.length }), !r.failed.length);
      $('lgAddIn').value = '';
      renderLeagues();
    });
    $('lgImportBtn').addEventListener('click', function () {
      var msg = $('lgImportMsg');
      if (!lgUi.code) { flash(msg, T('Add the league first: paste its league code above.'), false); return; }
      $('lgImportBtn').disabled = true;
      I.leagues.importShares(lgUi.code, $('lgImportIn').value).then(function (r) {
        $('lgImportBtn').disabled = false;
        if (r.error && !r.found) { flash(msg, r.error, false); return; }
        var parts = [];
        if (r.added) parts.push(T('{n} new', { n: r.added }));
        if (r.updated) parts.push(T('{n} updated', { n: r.updated }));
        if (r.skipped) parts.push(T('{n} older than what you have (kept yours)', { n: r.skipped }));
        if (r.notInLeague) parts.push(T('{n} not in this league (skipped)', { n: r.notInLeague }));
        if (r.failed.length) parts.push(T('{n} unreadable', { n: r.failed.length }));
        flash(msg, T('Found {n} codes: {parts}.', { n: r.found, parts: parts.join(', ') || T('nothing to do') }), !r.failed.length && !r.notInLeague);
        $('lgImportErrors').innerHTML = r.failed.length ? '<ul>' + r.failed.map(function (f) { return '<li><code>' + esc(f.code) + '</code> ' + esc(f.error) + '</li>'; }).join('') + '</ul>' : '';
        if (r.added || r.updated) { $('lgImportIn').value = ''; lgUi.server = null; }
        renderLeagues();
      });
    });
    $('lgRefresh').addEventListener('click', function () {
      if (!lgUi.code || !BT.leagues || !BT.leagues.remote) return;
      var btn = $('lgRefresh'); btn.disabled = true;
      BT.leagues.remote.standings(lgUi.code).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { flash($('lgMsg'), r.error || T('Could not reach the league server. Showing the codes saved on this device.'), false); return; }
        lgUi.server = Array.isArray(r.standings) ? r.standings : [];
        flash($('lgMsg'), T('Standings updated from the league server.'), true);
        renderLeagues();
      });
    });
    $('lgCsv').addEventListener('click', function () {
      if (!lgUi.code) return;
      var out = $('lgCsvOut'); out.value = I.leagues.csv(lgUi.code); out.hidden = !out.value;
      if (out.value) copyText(out.value, $('lgMsg'));
    });
    $('lgClear').addEventListener('click', function () {
      if (!lgUi.code || !BT.leagues) return;
      if (!confirm(T('Forget every share code imported for this league on this device? Students keep their own data.'))) return;
      BT.leagues.clearImported(lgUi.code); lgUi.server = null; $('lgCsvOut').hidden = true;
      flash($('lgMsg'), T('Imported codes cleared.'), true);
      renderLeagues();
    });
    root.addEventListener('storage', function (e) { if (BT.leagues && e.key === BT.leagues.KEY && !$('leaguesPanel').hidden) renderLeagues(); });
  }
  var startTab = 'class';
  try { startTab = /^#leagues\b/.test(location.hash) ? 'leagues' : (JSON.parse(localStorage.getItem(TAB_KEY) || '"class"') === 'leagues' ? 'leagues' : 'class'); } catch (e) { /* ignore */ }
  if (tabs.length === 2) showTab(startTab);

  function renderAll() { renderHeader(); renderRoster(); renderGradebook(); }
  renderAll();
  // Another tab (or a sync) may change the state.
  root.addEventListener('storage', function (e) { if (e.key === KEY) { I.load(); renderAll(); } });
})();
