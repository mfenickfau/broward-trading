/* Broward Trading — js/classroom.js → BT.classroom (student side of Classroom, v0.4)
 *
 * Lets a student join an instructor's class with a 6-character class code and
 * hand the instructor a pseudonymous progress snapshot: lessons done, quiz
 * scores, replay drills, paper-account stats, journal activity and the Daily 5
 * streak. No email, no name unless the student types one. From v0.5, when
 * js/leagues.js is loaded, the snapshot also carries a `leagues` block per joined
 * league so one share code serves both the class and its leagues.
 *
 * Two delivery paths, chosen automatically:
 *   - Backend (BT.auth.config.apiBase set): POST /classes/:code/snapshots,
 *     throttled to once per 5 minutes except right after a lesson or quiz is
 *     completed (those always send).
 *   - No backend: a SHARE CODE the student copies to the instructor:
 *     'BT1.' + base64url( deflate-raw(JSON) ) when CompressionStream exists,
 *     else 'BT1.' + base64url( UTF-8 JSON ). decodeShare() tries JSON first and
 *     inflates otherwise, so both forms round-trip through the same reader.
 *
 * Public surface
 *   BT.classroom.KEY                      'bt.classroom'
 *   BT.classroom.studentId()              random, persisted id (never derived from anything personal)
 *   BT.classroom.normalizeCode(s) / isValidCode(s)
 *   BT.classroom.join(code, displayName?, {freshId?}) → {ok, code, displayName, studentId, freshId} | {ok:false, error}
 *   BT.classroom.leave()                  forgets the class and its ownerToken (keeps the studentId)
 *   BT.classroom.setDisplayName(name)
 *   BT.classroom.status()                 → {joined, code, displayName, studentId, lastSentAt, backend,
 *                                             ownerMismatch, backoffUntil, hasOwnerToken}
 *   BT.classroom.snapshot()               → the contract snapshot object (reads localStorage only)
 *   BT.classroom.encodeShare(snapshot?)   → Promise<string>   'BT1.…'
 *   BT.classroom.shareCode(snapshot?)     → Promise<string>   alias: encodeShare(snapshot()) (v0.5)
 *   BT.classroom.decodeShare(code)        → Promise<{ok, snapshot} | {ok:false, error, reason}>
 *   BT.classroom.parseShareCodes(text)    → ['BT1.…', …] found anywhere in pasted text
 *   BT.classroom.sync(opts?)              → Promise<{ok, sent, skipped?, error?, ownerMismatch?, full?, rateLimited?}>
 *                                         opts.reason 'lesson'|'quiz'|'join'|'manual'; opts.force also overrides a 429 back-off
 *   Stored in bt.classroom: studentId, displayName, classCode, className, joinedAt, lastSentAt, lastSentCode,
 *   ownerToken + ownerTokenCode (from the server's first 200), ownerMismatch, backoffUntil.
 *   BT.classroom.codec                    {deflate, inflate, available(), use({deflate, inflate}), reset()}
 *                                         (tests inject zlib here; the browser uses CompressionStream)
 *   BT.classroom.SYNC_INTERVAL_MS         5 minutes
 *
 * Integration: when js/course.js is on the page, markDone() and recordQuiz()
 * are wrapped so a completed lesson or quiz triggers sync({reason}). Nothing
 * else in the app needs to know this module exists.
 *
 * Plain ES2020, no imports, no DOM. Loadable in Node with a `window` +
 * `localStorage` shim (tests/classroom.test.js).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  // Platform globals: a test's `window` shim may not carry them, so fall back to globalThis
  // (in a browser window === globalThis and the shim lookup is all that runs).
  var G = typeof globalThis !== 'undefined' ? globalThis : root;
  function glob(name) { return root[name] !== undefined ? root[name] : G[name]; }

  var KEY = 'bt.classroom';
  var PREFIX = 'BT1.';
  var SYNC_INTERVAL_MS = 5 * 60 * 1000;
  var CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // same as certificate ids: no 0/1/O/I
  var CODE_RE = /^[A-Z2-9]{6}$/;
  var ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
  var MAX_NAME = 40;
  var MAX_DRILLS = 40;
  var MAX_LESSONS = 400;
  var MAX_SHARE_CHARS = 60000;
  var MAX_LEAGUES = 10;
  var OWNER_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;   // mirrors server/worker.js OWNER_TOKEN_RE (24 random bytes, base64url)
  var DEFAULT_BACKOFF_SEC = 60;

  /* ------------------------------------------------------------------ *
   * storage (safe in private windows / Node)
   * ------------------------------------------------------------------ */
  function lsGet(k, d) { try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function load() {
    var s = lsGet(KEY, null);
    if (!s || typeof s !== 'object') s = {};
    return {
      studentId: typeof s.studentId === 'string' ? s.studentId : null,
      displayName: typeof s.displayName === 'string' ? s.displayName : '',
      classCode: typeof s.classCode === 'string' ? s.classCode : null,
      className: typeof s.className === 'string' ? s.className : '',
      joinedAt: s.joinedAt || null,
      lastSentAt: s.lastSentAt || null,
      lastSentCode: s.lastSentCode || null,
      // Snapshot ownership (server/worker.js v0.4.1): the first POST for (class, studentId) hands back a
      // random ownerToken exactly once; every later POST must carry it or the server answers 409 {ownerMismatch}.
      ownerToken: typeof s.ownerToken === 'string' && OWNER_TOKEN_RE.test(s.ownerToken) ? s.ownerToken : null,
      ownerTokenCode: typeof s.ownerTokenCode === 'string' ? s.ownerTokenCode : null,
      ownerMismatch: s.ownerMismatch === true,
      backoffUntil: typeof s.backoffUntil === 'string' && isFinite(Date.parse(s.backoffUntil)) ? s.backoffUntil : null
    };
  }
  function save(s) { return lsSet(KEY, s); }

  /* ------------------------------------------------------------------ *
   * ids and codes
   * ------------------------------------------------------------------ */
  function randomChars(alphabet, n) {
    var out = '';
    var c = glob('crypto') && typeof glob('crypto').getRandomValues === 'function' ? glob('crypto') : null;
    if (c) {
      var a = new Uint8Array(n); c.getRandomValues(a);
      for (var i = 0; i < n; i++) out += alphabet.charAt(a[i] % alphabet.length);
    } else {
      for (var j = 0; j < n; j++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return out;
  }
  /** The student's pseudonymous id ('s-' + 10 chars). Created on first use, kept across classes. */
  function studentId() {
    var s = load();
    if (!s.studentId) { s.studentId = 's-' + randomChars(ID_ALPHABET, 10); save(s); }
    return s.studentId;
  }
  /** ' k7q-2m x ' → 'K7Q2MX': uppercase, spaces and dashes dropped. */
  function normalizeCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  /** Six characters from CODE_ALPHABET (never 0, 1, O or I, so a code read aloud is unambiguous). */
  function isValidCode(s) { var t = normalizeCode(s); return CODE_RE.test(t) && /^[23456789A-HJ-NP-Z]{6}$/.test(t); }
  /** A fresh 6-character class code (instructor side uses it offline; the server mints its own). */
  function newCode() { return randomChars(CODE_ALPHABET, 6); }
  function cleanName(name) { return String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME); }

  /* ------------------------------------------------------------------ *
   * join / leave / status
   * ------------------------------------------------------------------ */
  /**
   * join(code, displayName?, opts?) → {ok, code, displayName, studentId, freshId}
   * opts.freshId: mint a new studentId (used after the server reported 409 {ownerMismatch}: this id is bound to
   * another device, so rejoining with the same id would keep failing). A mismatch recorded by sync() also forces it.
   */
  function join(code, displayName, opts) {
    opts = opts || {};
    var c = normalizeCode(code);
    if (!isValidCode(c)) return { ok: false, error: 'A class code is 6 letters or digits, like K7Q2MX, and never contains 0, O, 1 or I. Ask your instructor for it.' };
    var s = load();
    var fresh = false;
    if (!s.studentId || opts.freshId === true || s.ownerMismatch) { s.studentId = 's-' + randomChars(ID_ALPHABET, 10); fresh = true; }
    if (s.classCode !== c || fresh) { s.ownerToken = null; s.ownerTokenCode = null; }   // the token belongs to one (class, id) pair
    s.ownerMismatch = false; s.backoffUntil = null;
    s.classCode = c;
    s.joinedAt = new Date().toISOString();
    if (displayName !== undefined) s.displayName = cleanName(displayName);
    if (s.lastSentCode !== c || fresh) s.lastSentAt = null;   // a new class (or a new id) gets a snapshot right away
    save(s);
    return { ok: true, code: c, displayName: s.displayName, studentId: s.studentId, freshId: fresh };
  }
  function leave() {
    var s = load();
    s.classCode = null; s.className = ''; s.joinedAt = null; s.lastSentAt = null; s.lastSentCode = null;
    s.ownerToken = null; s.ownerTokenCode = null; s.ownerMismatch = false; s.backoffUntil = null;
    save(s);
    return { ok: true };
  }
  function setDisplayName(name) { var s = load(); s.displayName = cleanName(name); save(s); return s.displayName; }
  function setClassName(name) { var s = load(); s.className = cleanName(name); save(s); return s.className; }
  function backendConfigured() {
    try { return !!(BT.auth && typeof BT.auth.configured === 'function' && BT.auth.configured()); } catch (e) { return false; }
  }
  /** backoffUntil as a future timestamp (ms) or null when no 429 back-off is in force. */
  function backoffActive(s) {
    var t = s.backoffUntil ? Date.parse(s.backoffUntil) : NaN;
    return isFinite(t) && t > Date.now() ? t : null;
  }
  /**
   * status() → {joined, code, className, displayName, studentId, joinedAt, lastSentAt, backend,
   *             ownerMismatch, backoffUntil (ISO|null), hasOwnerToken}
   * ownerMismatch: the server said this id belongs to another device; join(code, name, {freshId:true}) fixes it.
   * backoffUntil: a 429 asked us to wait; sync() skips with 'backoff' until then (except opts.force).
   */
  function status() {
    var s = load();
    var until = backoffActive(s);
    return {
      joined: !!s.classCode, code: s.classCode, className: s.className, displayName: s.displayName, studentId: s.studentId, joinedAt: s.joinedAt,
      lastSentAt: s.lastSentAt, backend: backendConfigured(),
      ownerMismatch: s.ownerMismatch, backoffUntil: until ? new Date(until).toISOString() : null,
      hasOwnerToken: !!(s.ownerToken && s.ownerTokenCode === s.classCode)
    };
  }

  /* ------------------------------------------------------------------ *
   * snapshot: everything is read from localStorage so this works on any page
   * ------------------------------------------------------------------ */
  function num(v, dp) { v = +v; if (!isFinite(v)) return null; var f = Math.pow(10, dp == null ? 2 : dp); return Math.round(v * f) / f; }
  function dayKey(ts) {
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return null;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function shiftDay(key, n) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key); var d = new Date(+m[1], +m[2] - 1, +m[3]); d.setDate(d.getDate() + n); return dayKey(d); }

  function courseState() {
    var p = lsGet('bt.course', null) || {};
    var done = p.lessonsDone && typeof p.lessonsDone === 'object' ? Object.keys(p.lessonsDone).filter(function (k) { return p.lessonsDone[k]; }).sort().slice(0, MAX_LESSONS) : [];
    var scores = {};
    if (p.quizScores && typeof p.quizScores === 'object') {
      Object.keys(p.quizScores).sort().slice(0, MAX_LESSONS).forEach(function (k) { var v = +p.quizScores[k]; if (isFinite(v)) scores[k] = Math.max(0, Math.min(100, Math.round(v))); });
    }
    var total = null;
    try { if (BT.course && BT.course.getIndex && BT.course.getIndex()) total = BT.course.getIndex().modules.reduce(function (s, m) { return s + m.lessons.length; }, 0); } catch (e) { total = null; }
    return { lessonsDone: done, quizScores: scores, lessonsTotal: total, startedAt: p.startedAt || null, lastLessonId: p.lastLessonId || null, certificate: p.certificate ? { id: p.certificate.id || null, date: p.certificate.date || null } : null };
  }
  /** Best attempt per drill: a pass beats a fail, then the higher return. */
  function drillState() {
    var sessions = lsGet('bt.replay.sessions', []);
    if (!Array.isArray(sessions)) sessions = [];
    var best = {};
    sessions.forEach(function (s) {
      if (!s || !s.drill || !s.drill.id) return;
      var row = { id: String(s.drill.id).slice(0, 60), title: String(s.drill.title || '').slice(0, 120), returnPct: num(s.returnPct), buyHoldPct: num(s.buyHoldPct), maxDrawdownPct: num(s.maxDrawdownPct), trades: Math.round(+s.trades || 0), passed: !!s.drill.passed, completed: !!s.completed, date: dayKey(s.at || Date.now()) };
      var cur = best[row.id];
      if (!cur || (row.passed && !cur.passed) || (row.passed === cur.passed && (row.returnPct || 0) > (cur.returnPct || 0))) best[row.id] = row;
    });
    return Object.keys(best).sort().slice(0, MAX_DRILLS).map(function (k) { return best[k]; });
  }
  function paperState() {
    var st = lsGet('bt.portfolio', null);
    if (!st || typeof st !== 'object') return { equity: null, startingCash: null, returnPct: null, trades: 0, winRate: null, fills: 0, positions: 0 };
    var trades = Array.isArray(st.trades) ? st.trades : [];
    var closing = trades.filter(function (t) { return t && t.closedQty > 0; });
    var wins = closing.filter(function (t) { return t.realized > 0; }).length;
    var hist = Array.isArray(st.equityHistory) ? st.equityHistory : [];
    var starting = +st.startingCash || 100000;
    var equity = hist.length && isFinite(+hist[hist.length - 1].equity) ? +hist[hist.length - 1].equity : null;
    if (equity == null) {
      // No mark yet: cash plus positions at their average cost (an approximation, labelled by the instructor page).
      var mv = 0;
      Object.keys(st.positions || {}).forEach(function (k) { var p = st.positions[k]; if (p) mv += (+p.qty || 0) * (+p.avg || 0) * (p.kind === 'option' ? ((p.meta && p.meta.multiplier) || 100) : 1); });
      equity = (+st.cash || 0) + mv;
    }
    return {
      equity: num(equity), startingCash: num(starting), returnPct: starting ? num((equity - starting) / starting * 100) : null,
      trades: closing.length, winRate: closing.length ? num(wins / closing.length * 100, 1) : null, fills: trades.length,
      positions: Object.keys(st.positions || {}).length
    };
  }
  function journalState() {
    var j = lsGet('bt.journal', null);
    var entries = Array.isArray(j) ? j : (j && Array.isArray(j.entries) ? j.entries : []);
    var reviewed = 0, lessons = 0, last = null;
    entries.forEach(function (e) {
      if (!e) return;
      if (e.setup && e.emotion) reviewed++;
      if (e.lessons && String(e.lessons).trim().length > 10) lessons++;
      var d = e.date || (e.updatedAt ? dayKey(e.updatedAt) : null);
      if (d && (!last || d > last)) last = d;
    });
    var reviews = j && j.reviews && typeof j.reviews === 'object' ? Object.keys(j.reviews).length : 0;
    return { entries: entries.length, reviewed: reviewed, withLessons: lessons, weeklyReviews: reviews, lastDate: last };
  }
  function streakState() {
    var d = lsGet('bt.daily5', null);
    var h = d && d.history && typeof d.history === 'object' ? d.history : {};
    var today = dayKey(new Date());
    var cur = h[today] ? today : shiftDay(today, -1);
    var n = 0;
    while (h[cur] && n < 3650) { n++; cur = shiftDay(cur, -1); }
    return { streak: n, days: Object.keys(h).length, best: Math.max(n, +(d && d.best) || 0) };
  }
  /** The newest activity date across everything, as an ISO day. */
  function lastActive(parts) {
    var c = [];
    var p = lsGet('bt.course', null); if (p && p.updatedAt) c.push(dayKey(p.updatedAt));
    parts.drills.forEach(function (d) { if (d.date) c.push(d.date); });
    if (parts.journal.lastDate) c.push(parts.journal.lastDate);
    var pf = lsGet('bt.portfolio', null); if (pf && Array.isArray(pf.trades) && pf.trades.length) { var t = pf.trades[pf.trades.length - 1]; if (t && t.time) c.push(dayKey(t.time)); }
    var d5 = lsGet('bt.daily5', null); if (d5 && d5.history) Object.keys(d5.history).forEach(function (k) { c.push(k); });
    c = c.filter(Boolean).sort();
    return c.length ? c[c.length - 1] : null;
  }

  /**
   * League blocks for every league this device has joined (v0.5), read through
   * BT.leagues.leagueSnapshot (storage only, never switches the active paper account).
   * Uses leagueSnapshot rather than BT.leagues.snapshot(), which itself calls snapshot() here.
   * → {CODE: {equity, startingCash, returnPct, trades, maxDrawdownPct, equityHistory, displayName, team?}} or null
   */
  function leagueState() {
    var L = BT.leagues;
    if (!L || typeof L.joined !== 'function' || typeof L.leagueSnapshot !== 'function') return null;
    var out = {}, n = 0;
    try {
      (L.joined() || []).slice(0, MAX_LEAGUES).forEach(function (lg) {
        if (!lg || !lg.code) return;
        var block = L.leagueSnapshot(lg.code);
        if (!block || typeof block !== 'object') return;
        var mem = typeof L.membership === 'function' ? L.membership(lg.code) : null;
        if (mem) {
          block.displayName = cleanName(mem.displayName || '');
          if (mem.team) block.team = String(mem.team).slice(0, 24);
        }
        out[lg.code] = block; n++;
      });
    } catch (e) { return null; }
    return n ? out : null;
  }

  /**
   * snapshot() → {v, studentId, displayName, classCode, lessonsDone[], quizScores{}, lessonsTotal,
   *               drills[], paper{}, journalEntries, journal{}, streak, daily{}, lastActive, updatedAt,
   *               leagues? {CODE: block}  (v0.5, only when js/leagues.js is loaded and a league is joined)}
   */
  function snapshot() {
    var s = load();
    var course = courseState(), drills = drillState(), paper = paperState(), journal = journalState(), daily = streakState();
    var snap = {
      v: 1,
      studentId: studentId(),
      displayName: s.displayName || '',
      classCode: s.classCode || null,
      lessonsDone: course.lessonsDone,
      quizScores: course.quizScores,
      lessonsTotal: course.lessonsTotal,
      startedAt: course.startedAt,
      certificate: course.certificate,
      drills: drills,
      paper: paper,
      journalEntries: journal.entries,
      journal: journal,
      streak: daily.streak,
      daily: daily,
      lastActive: lastActive({ drills: drills, journal: journal }),
      updatedAt: new Date().toISOString()
    };
    var leagues = leagueState();
    if (leagues) snap.leagues = leagues;
    return snap;
  }

  /* ------------------------------------------------------------------ *
   * share codes
   * ------------------------------------------------------------------ */
  function utf8Encode(str) {
    if (typeof glob('TextEncoder') === 'function') return new (glob('TextEncoder'))().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function utf8Decode(bytes) {
    if (typeof glob('TextDecoder') === 'function') return new (glob('TextDecoder'))('utf-8', { fatal: true }).decode(bytes);
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }
  function b64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    var b = typeof glob('btoa') === 'function' ? glob('btoa')(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = typeof glob('atob') === 'function' ? glob('atob')(s) : Buffer.from(s, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat(chunks) {
    var n = 0; chunks.forEach(function (c) { n += c.length; });
    var out = new Uint8Array(n), o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }
  /** Run bytes through a web stream transformer (CompressionStream / DecompressionStream). */
  function pipeThrough(bytes, stream) {
    // Both ends reject on a corrupt input; funnel them into one promise so no rejection goes unhandled.
    return new Promise(function (resolve, reject) {
      var writer = stream.writable.getWriter();
      var reader = stream.readable.getReader();
      var chunks = [];
      var pump = function () {
        reader.read().then(function (r) { if (r.done) { resolve(concat(chunks)); return; } chunks.push(r.value); pump(); }, reject);
      };
      pump();
      writer.write(bytes).then(function () { return writer.close(); }).catch(reject);
    });
  }
  var nativeCodec = {
    available: function () { return typeof glob('CompressionStream') === 'function' && typeof glob('DecompressionStream') === 'function'; },
    deflate: function (bytes) { return pipeThrough(bytes, new (glob('CompressionStream'))('deflate-raw')); },
    inflate: function (bytes) { return pipeThrough(bytes, new (glob('DecompressionStream'))('deflate-raw')); }
  };
  var custom = null;
  var codec = {
    /** Tests inject zlib here: use({deflate(bytes)→Promise<bytes>, inflate(bytes)→Promise<bytes>}). */
    use: function (impl) { custom = impl && typeof impl.deflate === 'function' && typeof impl.inflate === 'function' ? impl : null; },
    reset: function () { custom = null; },
    available: function () { return !!custom || nativeCodec.available(); },
    canDeflate: function () { return !!custom || nativeCodec.available(); },
    deflate: function (bytes) { return Promise.resolve().then(function () { return custom ? custom.deflate(bytes) : nativeCodec.deflate(bytes); }).then(function (b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }); },
    inflate: function (bytes) { return Promise.resolve().then(function () { return custom ? custom.inflate(bytes) : nativeCodec.inflate(bytes); }).then(function (b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }); }
  };

  /** encodeShare(snapshot?) → Promise<'BT1.…'>. Deflated when a codec exists, plain otherwise. */
  function encodeShare(snap) {
    snap = snap || snapshot();
    var jsonBytes = utf8Encode(JSON.stringify(snap));
    var plain = function () { return PREFIX + b64url(jsonBytes); };
    if (!codec.canDeflate()) return Promise.resolve(plain());
    return codec.deflate(jsonBytes).then(function (z) { return z.length < jsonBytes.length ? PREFIX + b64url(z) : plain(); }, plain);
  }
  /** shareCode(snapshot?) → Promise<'BT1.…'>: the contract alias for encodeShare(snapshot()). */
  function shareCode(snap) { return encodeShare(snap || snapshot()); }
  function looksLikeShare(s) { return typeof s === 'string' && s.indexOf(PREFIX) === 0 && /^[A-Za-z0-9_-]+$/.test(s.slice(PREFIX.length)); }
  function validateSnapshot(obj) {
    if (!obj || typeof obj !== 'object') return 'That share code does not hold a progress snapshot.';
    if (typeof obj.studentId !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(obj.studentId)) return 'That share code has no valid student id.';
    return null;
  }
  /** decodeShare(code) → Promise<{ok:true, snapshot, compressed} | {ok:false, error, reason}> */
  function decodeShare(code) {
    var c = String(code == null ? '' : code).trim();
    if (!looksLikeShare(c)) return Promise.resolve({ ok: false, reason: 'format', error: 'A share code starts with "BT1." followed by letters, digits, "-" and "_". Copy the whole code.' });
    if (c.length > MAX_SHARE_CHARS) return Promise.resolve({ ok: false, reason: 'too-long', error: 'That share code is too long to be genuine.' });
    var bytes;
    try { bytes = b64urlDecode(c.slice(PREFIX.length)); } catch (e) { return Promise.resolve({ ok: false, reason: 'format', error: 'That share code is damaged: it is not valid base64url text.' }); }
    var finish = function (jsonBytes, compressed) {
      var obj;
      try { obj = JSON.parse(utf8Decode(jsonBytes)); } catch (e) { return { ok: false, reason: 'corrupt', error: 'That share code is damaged or incomplete. Ask the student to copy it again.' }; }
      var bad = validateSnapshot(obj);
      if (bad) return { ok: false, reason: 'invalid', error: bad };
      return { ok: true, snapshot: obj, compressed: compressed };
    };
    // Plain JSON begins with '{'. Deflate-raw output beginning with 0x7B is possible but then JSON.parse fails and we inflate.
    if (bytes.length && bytes[0] === 0x7B) {
      var direct = finish(bytes, false);
      if (direct.ok || direct.reason === 'invalid') return Promise.resolve(direct);   // parsed as JSON: that is the answer
    }
    if (!codec.available()) return Promise.resolve({ ok: false, reason: 'no-codec', error: 'This share code is compressed and this browser cannot decompress it. Open the instructor page in a current Chrome, Edge, Safari or Firefox.' });
    return codec.inflate(bytes).then(function (out) { return finish(out, true); }, function () {
      return { ok: false, reason: 'corrupt', error: 'That share code could not be decompressed. It may be incomplete; ask the student to copy it again.' };
    });
  }
  /** Every share code found in a pasted blob (one per line, comma separated, inside a sentence…). */
  function parseShareCodes(text) {
    var out = [], seen = {};
    var re = /BT1\.[A-Za-z0-9_-]{8,}/g, m;
    var s = String(text == null ? '' : text);
    while ((m = re.exec(s))) { if (!seen[m[0]]) { seen[m[0]] = 1; out.push(m[0]); } }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * backend sync
   * ------------------------------------------------------------------ */
  function apiUrl(path) {
    var base = String((BT.auth && BT.auth.config && BT.auth.config.apiBase) || '').replace(/\/+$/, '');
    return base + path;
  }
  var inflight = null;
  /**
   * sync({reason, force}) → Promise<{ok, sent, skipped?, error?, status?, ownerMismatch?, full?, rateLimited?, retryAfterSec?, removed?}>
   * reason 'lesson' | 'quiz' | 'join' | 'manual' bypasses the 5-minute throttle (opts.force:true also bypasses a 429 back-off).
   * Server answers handled here (server/worker.js):
   *   200 {ownerToken?}        first snapshot for this (class, id): the token is persisted and sent with every later one
   *   409 {ownerMismatch:true} this id is bound to another device → recorded; join(code, name, {freshId:true}) mints a new id
   *   409 {full:true}          class at its student cap → reported, nothing stored
   *   410 {removed:true}       the instructor removed this student → leave()
   *   429 {retryAfterSec}      per-student / per-class limit → back-off (default 60 s); lastSentAt stays as it was so the
   *                            next lesson, quiz or page load after the back-off retries instead of giving up for 5 minutes
   */
  function sync(opts) {
    opts = opts || {};
    var s = load();
    if (!s.classCode) return Promise.resolve({ ok: false, sent: false, skipped: 'not-joined' });
    if (!backendConfigured()) return Promise.resolve({ ok: false, sent: false, skipped: 'no-backend' });
    if (typeof glob('fetch') !== 'function') return Promise.resolve({ ok: false, sent: false, skipped: 'no-fetch' });
    var forced = opts.force === true || ['lesson', 'quiz', 'join', 'manual'].indexOf(opts.reason) >= 0;
    var waitUntil = backoffActive(s);
    if (waitUntil && opts.force !== true) return Promise.resolve({ ok: false, sent: false, skipped: 'backoff', rateLimited: true, retryAt: new Date(waitUntil).toISOString(), retryAfterSec: Math.ceil((waitUntil - Date.now()) / 1000), error: 'The classroom server asked this device to wait a moment before sending again. Your progress is saved here and will be sent shortly.' });
    if (s.ownerMismatch && opts.force !== true) return Promise.resolve({ ok: false, sent: false, skipped: 'owner-mismatch', ownerMismatch: true, error: 'This student id is in use on another device. Rejoin the class to get a fresh id.' });
    var last = s.lastSentAt ? Date.parse(s.lastSentAt) : NaN;
    if (!forced && isFinite(last) && s.lastSentCode === s.classCode && Date.now() - last < SYNC_INTERVAL_MS) return Promise.resolve({ ok: true, sent: false, skipped: 'throttled' });
    if (inflight) return inflight;
    var snap = snapshot();
    if (s.ownerToken && s.ownerTokenCode === s.classCode) snap.ownerToken = s.ownerToken;
    var ctrl = typeof glob('AbortController') === 'function' ? new (glob('AbortController'))() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    inflight = glob('fetch')(apiUrl('/classes/' + encodeURIComponent(s.classCode) + '/snapshots'), {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(snap), signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        var cur;
        if (res.status === 410 && data && data.removed) {
          // The instructor removed this student: stop sending and forget the class, as asked.
          leave();
          return { ok: false, sent: false, removed: true, status: 410, error: (data && data.error) || 'You were removed from this class.' };
        }
        if (res.status === 409 && data && data.ownerMismatch) {
          cur = load(); cur.ownerMismatch = true; cur.ownerToken = null; cur.ownerTokenCode = null; save(cur);
          return { ok: false, sent: false, status: 409, ownerMismatch: true, error: (data && data.error) || 'This student id already belongs to another device in this class. Rejoin to get a fresh id.' };
        }
        if (res.status === 409 && data && data.full) {
          return { ok: false, sent: false, status: 409, full: true, error: (data && data.error) || 'This class is full. Ask your instructor to remove unused ids.' };
        }
        if (res.status === 429) {
          var hdr = res.headers && typeof res.headers.get === 'function' ? +res.headers.get('Retry-After') : NaN;
          var secs = data && isFinite(+data.retryAfterSec) && +data.retryAfterSec > 0 ? +data.retryAfterSec : (isFinite(hdr) && hdr > 0 ? hdr : DEFAULT_BACKOFF_SEC);
          secs = Math.min(3600, Math.max(5, Math.round(secs)));
          cur = load(); cur.backoffUntil = new Date(Date.now() + secs * 1000).toISOString(); save(cur);
          return { ok: false, sent: false, status: 429, rateLimited: true, retryAfterSec: secs, retryAt: cur.backoffUntil, error: (data && data.error) || 'The classroom server is busy. Your progress is saved on this device and will be sent in about a minute.' };
        }
        if (!res.ok) return { ok: false, sent: false, status: res.status, error: (data && data.error) || ('Request failed (' + res.status + ')') };
        cur = load(); cur.lastSentAt = new Date().toISOString(); cur.lastSentCode = cur.classCode; cur.backoffUntil = null; cur.ownerMismatch = false;
        if (data && typeof data.className === 'string') cur.className = cleanName(data.className);
        if (data && typeof data.ownerToken === 'string' && OWNER_TOKEN_RE.test(data.ownerToken)) { cur.ownerToken = data.ownerToken; cur.ownerTokenCode = cur.classCode; }
        save(cur);
        return { ok: true, sent: true, status: res.status, className: cur.className, ownerToken: !!cur.ownerToken };
      });
    }).catch(function (e) {
      return { ok: false, sent: false, network: true, error: e && e.name === 'AbortError' ? 'The classroom server took too long to answer.' : 'Could not reach the classroom server.' };
    }).then(function (r) { if (timer) clearTimeout(timer); inflight = null; return r; });
    return inflight;
  }
  /** fetchClass(code) → Promise<{ok, name, section, term}|{ok:false}>: lets a student confirm the code before joining. */
  function fetchClass(code) {
    var c = normalizeCode(code);
    if (!isValidCode(c) || !backendConfigured() || typeof glob('fetch') !== 'function') return Promise.resolve({ ok: false, skipped: true });
    return glob('fetch')(apiUrl('/classes/' + encodeURIComponent(c)), { mode: 'cors', headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json().then(function (d) { return res.ok ? { ok: true, code: c, name: d.name || '', section: d.section || '', term: d.term || '' } : { ok: false, status: res.status, error: d && d.error }; }); })
      .catch(function () { return { ok: false, network: true }; });
  }

  /* ------------------------------------------------------------------ *
   * course hooks: a finished lesson or quiz sends a snapshot straight away
   * ------------------------------------------------------------------ */
  var patched = false;
  function hookCourse() {
    var C = BT.course;
    if (patched || !C || typeof C.markDone !== 'function' || typeof C.recordQuiz !== 'function') return false;
    patched = true;
    var md = C.markDone, rq = C.recordQuiz;
    C.markDone = function () { var r = md.apply(this, arguments); setTimeout(function () { sync({ reason: 'lesson' }).catch(function () { /* ignore */ }); }, 0); return r; };
    C.recordQuiz = function () { var r = rq.apply(this, arguments); setTimeout(function () { sync({ reason: 'quiz' }).catch(function () { /* ignore */ }); }, 0); return r; };
    return true;
  }
  if (!hookCourse() && typeof root.addEventListener === 'function' && typeof document !== 'undefined') {
    root.addEventListener('DOMContentLoaded', function () { hookCourse(); if (load().classCode) sync({}).catch(function () { /* ignore */ }); });
  } else if (typeof document !== 'undefined' && load().classCode) {
    setTimeout(function () { sync({}).catch(function () { /* ignore */ }); }, 0);
  }

  BT.classroom = {
    KEY: KEY, PREFIX: PREFIX, SYNC_INTERVAL_MS: SYNC_INTERVAL_MS, CODE_ALPHABET: CODE_ALPHABET,
    studentId: studentId, normalizeCode: normalizeCode, isValidCode: isValidCode, newCode: newCode, cleanName: cleanName,
    join: join, leave: leave, setDisplayName: setDisplayName, setClassName: setClassName, status: status,
    snapshot: snapshot, encodeShare: encodeShare, shareCode: shareCode, decodeShare: decodeShare, parseShareCodes: parseShareCodes, looksLikeShare: looksLikeShare,
    sync: sync, fetchClass: fetchClass, hookCourse: hookCourse, codec: codec,
    _internal: { b64url: b64url, b64urlDecode: b64urlDecode, utf8Encode: utf8Encode, utf8Decode: utf8Decode, courseState: courseState, drillState: drillState, paperState: paperState, journalState: journalState, streakState: streakState, leagueState: leagueState, load: load }
  };
})();
