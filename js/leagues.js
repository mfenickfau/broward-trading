/* Broward Trading — js/leagues.js → BT.leagues (v0.5)
 *
 * Paper-trading competitions for a class, a club or a group of friends.
 * Pure logic: no DOM. The page (leagues.html + js/leagues-ui.js), the
 * dashboard ticket and the replay ticket all share it.
 *
 * League shape (CONTRACTS.md "v0.5 additions"):
 *   {id, code (6 chars), name, createdBy, startDate, endDate,
 *    rules:{startingCash, commission, slippageBps, assets:['stock','etf','crypto','option'],
 *           dayTrading, maxPositionPct, shortSelling, teams, teamNames?, rankBy:'riskAdjusted'|'return'|'consistency'},
 *    members:[{studentId, displayName, team?}]}
 *
 * Two ways to run a league, chosen automatically:
 *   - Offline: the creator shares a LEAGUE CODE STRING, 'BTL1.' + base64url(UTF-8 JSON of the
 *     league definition). Members paste it to join. Each member later sends the organiser a
 *     share code (the classroom 'BT1.' format, with a `leagues` block added) and the organiser
 *     imports them here or on the instructor page.
 *   - Online (BT.auth.config.apiBase set): server/worker.js routes POST /leagues,
 *     GET /leagues/:code, POST /leagues/:code/join, POST /leagues/:code/snapshots,
 *     GET /leagues/:code/standings.
 *
 * Each joined league trades in its own paper account: BT.paper.use('league:' + code).
 * (BT.paper normalises that id to 'league-<code in lower case>'; accountCode() understands both.)
 *
 * Public surface
 *   BT.leagues.KEY / PREFIX / PRESETS / DEFAULT_RULES / ASSETS
 *   create(opts) → {ok, league} | {ok:false, errors[]}
 *   validateLeague(league) → [error strings]
 *   normalizeRules(rules) / normalizeLeague(obj)
 *   encodeLeague(league) → 'BTL1.…'     decodeLeague(str) → {ok, league} | {ok:false, error}
 *   parseLeagueCodes(text) → ['BTL1.…', …]
 *   list() / get(code) / save(league, {force}) / addLeague(leagueOrString) / remove(code)
 *   lockedConflict(league) / rulesHash(league)   (a started league's name, dates and rules never change)
 *   join(leagueOrString, {displayName, team}) / leave(code) / joined() / membership(code)
 *   accountId(code) / accountCode(accountId) / leagueForAccount(accountId)
 *   validateOrder(order, league, account) → {ok, reason}
 *   phase(league, now) / countdown(league, now) / tradingOpen(codeOrAccountId, now) / finishedReason(league)
 *   leagueSnapshot(code) / snapshot() / encodeShare(snap?) / decodeShare(str)
 *   importShares(code, snapshots) / imported(code) / clearImported(code, studentId?)
 *   standings(league, snapshots) / teamStandings(rows, league) / movers(rows, opts)
 *   metrics(equityHistory, startingCash)  rankScore(ret, dd)  rankNote(league)  sparkPath(values, w, h)
 *   remote.{create, fetch, join, sync, standings}   (online mode; all return Promises)
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  var G = typeof globalThis !== 'undefined' ? globalThis : root;
  function glob(name) { return root[name] !== undefined ? root[name] : G[name]; }

  var KEY = 'bt.leagues';
  var PREFIX = 'BTL1.';
  var SHARE_PREFIX = 'BT1.';
  var CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // no 0/1/O/I, same as class codes
  var CODE_RE = /^[23456789A-HJ-NP-Z]{6}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ASSETS = ['stock', 'etf', 'crypto', 'option'];
  var MAX_NAME = 60;
  var MAX_MEMBERS = 500;
  var MAX_TEAMS = 12;
  var MAX_HISTORY = 60;
  var MAX_LEAGUE_CHARS = 20000;
  var MAX_DAYS = 366;
  var DAY_MS = 864e5;

  /* i18n helper: BT.t when js/i18n.js is on the page, plain interpolation otherwise. */
  function T(s, v) {
    if (BT.t) return BT.t(s, v);
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; });
  }

  /* Custom leagues cap a single position at 25 % so the leaderboard never rewards one all-in bet. */
  var RANK_BY = ['riskAdjusted', 'return', 'consistency'];
  var DEFAULT_RULES = {
    startingCash: 100000, commission: 0, slippageBps: 0,
    assets: ['stock', 'etf'], dayTrading: true, maxPositionPct: 25,
    shortSelling: false, teams: false, teamNames: [], rankBy: 'riskAdjusted'
  };

  /* Presets shown as chips on leagues.html. `days` sets the default length. */
  var PRESETS = [
    { id: 'classroom', name: 'Classroom 4-week', days: 28,
      description: 'A month-long class contest: stocks and ETFs, a $1 commission so overtrading costs something, and no single position above 25 % of the account.',
      rules: { startingCash: 100000, commission: 1, slippageBps: 5, assets: ['stock', 'etf'], dayTrading: true, maxPositionPct: 25, shortSelling: false, teams: false } },
    { id: 'sprint', name: 'Day-trading sprint', days: 5,
      description: 'One week, day trading allowed, shorts allowed, a smaller $25,000 account and realistic slippage. Shows how fast costs add up.',
      rules: { startingCash: 25000, commission: 0, slippageBps: 10, assets: ['stock', 'etf', 'crypto'], dayTrading: true, maxPositionPct: 50, shortSelling: true, teams: false } },
    { id: 'investor', name: 'Long-only investor', days: 56,
      description: 'Eight weeks, no shorting and no day trading: buy, diversify and hold. Positions are capped at 20 % so nobody bets it all on one ticker.',
      rules: { startingCash: 100000, commission: 0, slippageBps: 2, assets: ['stock', 'etf'], dayTrading: false, maxPositionPct: 20, shortSelling: false, teams: false } },
    { id: 'options', name: 'Options challenge', days: 21,
      description: 'Three weeks with options and stock. Positions are capped at 15 % of equity because options can lose 100 % of their premium quickly.',
      rules: { startingCash: 50000, commission: 0.65, slippageBps: 10, assets: ['stock', 'etf', 'option'], dayTrading: true, maxPositionPct: 15, shortSelling: false, teams: false } }
  ];

  /* ------------------------------------------------------------------ *
   * storage
   * ------------------------------------------------------------------ */
  function lsGet(k, d) { try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function load() {
    var s = lsGet(KEY, null);
    if (!s || typeof s !== 'object') s = {};
    return {
      leagues: s.leagues && typeof s.leagues === 'object' ? s.leagues : {},
      joined: s.joined && typeof s.joined === 'object' && !Array.isArray(s.joined) ? s.joined : {},
      imported: s.imported && typeof s.imported === 'object' ? s.imported : {},
      studentId: typeof s.studentId === 'string' ? s.studentId : null,
      lastSync: s.lastSync && typeof s.lastSync === 'object' ? s.lastSync : {}
    };
  }
  function store(s) { return lsSet(KEY, s); }

  /* ------------------------------------------------------------------ *
   * small helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round(v, dp) { var f = Math.pow(10, dp == null ? 2 : dp); return Math.round(v * f) / f; }
  function cleanText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
  function normalizeCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function isValidCode(s) { return CODE_RE.test(normalizeCode(s)); }
  function randomChars(alphabet, n) {
    var out = '', c = glob('crypto');
    if (c && typeof c.getRandomValues === 'function') {
      var a = new Uint8Array(n); c.getRandomValues(a);
      for (var i = 0; i < n; i++) out += alphabet.charAt(a[i] % alphabet.length);
    } else {
      for (var j = 0; j < n; j++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return out;
  }
  function newCode() { return randomChars(CODE_ALPHABET, 6); }
  function dayKey(ms) {
    var d = new Date(ms), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function addDays(key, n) {
    var m = DATE_RE.exec(key) ? key.split('-') : null;
    if (!m) return null;
    var d = new Date(+m[0], +m[1] - 1, +m[2]); d.setDate(d.getDate() + n);
    return dayKey(d.getTime());
  }
  /* Local midnight at the start of 'YYYY-MM-DD' (ms). */
  function startOf(key) { var p = String(key).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); }
  function validDate(key) {
    if (!DATE_RE.test(String(key || ''))) return false;
    var p = key.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getFullYear() === +p[0] && d.getMonth() === +p[1] - 1 && d.getDate() === +p[2];
  }
  function studentId() {
    if (BT.classroom && typeof BT.classroom.studentId === 'function') return BT.classroom.studentId();
    var s = load();
    if (!s.studentId) { s.studentId = 's-' + randomChars('abcdefghijkmnpqrstuvwxyz23456789', 10); store(s); }
    return s.studentId;
  }

  /* ------------------------------------------------------------------ *
   * rules and league definitions
   * ------------------------------------------------------------------ */
  function normalizeRules(r) {
    r = r && typeof r === 'object' ? r : {};
    var d = DEFAULT_RULES;
    var num = function (v, lo, hi, def, dp) { v = typeof v === 'string' && v.trim() !== '' ? +v : v; return isNum(v) ? round(clamp(v, lo, hi), dp == null ? 2 : dp) : def; };
    var assets = Array.isArray(r.assets) ? ASSETS.filter(function (a) { return r.assets.indexOf(a) >= 0; }) : d.assets.slice();
    if (!assets.length) assets = ['stock'];
    var teamNames = Array.isArray(r.teamNames) ? r.teamNames : (typeof r.teamNames === 'string' ? r.teamNames.split(',') : []);
    var seen = {};
    teamNames = teamNames.map(function (t) { return cleanText(t, 24); }).filter(function (t) { var k = t.toLowerCase(); if (!t || seen[k]) return false; seen[k] = 1; return true; }).slice(0, MAX_TEAMS);
    return {
      startingCash: num(r.startingCash, 1000, 10000000, d.startingCash, 0),
      commission: num(r.commission, 0, 100, d.commission, 2),
      slippageBps: num(r.slippageBps, 0, 500, d.slippageBps, 0),
      assets: assets,
      dayTrading: typeof r.dayTrading === 'boolean' ? r.dayTrading : d.dayTrading,
      maxPositionPct: num(r.maxPositionPct, 1, 100, d.maxPositionPct, 0),
      shortSelling: typeof r.shortSelling === 'boolean' ? r.shortSelling : d.shortSelling,
      teams: typeof r.teams === 'boolean' ? r.teams : d.teams,
      teamNames: teamNames,
      rankBy: RANK_BY.indexOf(r.rankBy) >= 0 ? r.rankBy : d.rankBy
    };
  }
  function normalizeMember(m) {
    if (!m || typeof m !== 'object' || !/^[A-Za-z0-9_-]{4,40}$/.test(String(m.studentId || ''))) return null;
    var out = { studentId: String(m.studentId), displayName: cleanText(m.displayName, 40) };
    var team = cleanText(m.team, 24);
    if (team) out.team = team;
    return out;
  }
  /* Coerce anything league-shaped into the contract shape (unknown fields dropped). */
  function normalizeLeague(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var code = normalizeCode(obj.code);
    var members = [], seen = {};
    (Array.isArray(obj.members) ? obj.members : []).forEach(function (m) {
      var n = normalizeMember(m);
      if (n && !seen[n.studentId] && members.length < MAX_MEMBERS) { seen[n.studentId] = 1; members.push(n); }
    });
    return {
      v: 1,
      id: cleanText(obj.id, 40) || (code ? 'lg-' + code : ''),
      code: code,
      name: cleanText(obj.name, MAX_NAME),
      createdBy: cleanText(obj.createdBy, 40),
      createdAt: cleanText(obj.createdAt, 40) || null,
      startDate: String(obj.startDate || ''),
      endDate: String(obj.endDate || ''),
      rules: normalizeRules(obj.rules),
      members: members,
      online: obj.online === true
    };
  }
  function validateLeague(lg) {
    var errs = [];
    if (!lg || typeof lg !== 'object') return [T('That is not a league definition.')];
    if (!CODE_RE.test(String(lg.code || ''))) errs.push(T('A league code is 6 letters or digits (never 0, O, 1 or I).'));
    if (cleanText(lg.name, MAX_NAME).length < 2) errs.push(T('Give the league a name of at least 2 characters.'));
    if (!validDate(lg.startDate)) errs.push(T('Pick a valid start date.'));
    if (!validDate(lg.endDate)) errs.push(T('Pick a valid end date.'));
    if (validDate(lg.startDate) && validDate(lg.endDate)) {
      var span = Math.round((startOf(lg.endDate) - startOf(lg.startDate)) / DAY_MS);
      if (span < 0) errs.push(T('The end date must be on or after the start date.'));
      else if (span > MAX_DAYS) errs.push(T('A league can run for at most one year.'));
    }
    var r = lg.rules || {};
    if (r.teams && (!Array.isArray(r.teamNames) || r.teamNames.length < 2)) errs.push(T('Team leagues need at least two team names.'));
    return errs;
  }
  /* The parts of a league that must never change once it has started. */
  function definitionJson(lg, withName) {
    var n = normalizeLeague(lg);
    var d = { startDate: n.startDate, endDate: n.endDate, rules: n.rules };
    if (withName) d.name = n.name;
    return JSON.stringify(d);
  }
  /* rulesHash(league) → 8 hex chars (FNV-1a of {startDate, endDate, rules}); share codes carry it so the
   * organiser can spot a member whose copy of the rules was edited. */
  function rulesHash(lg) {
    var str = definitionJson(lg, false), h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  /**
   * create({name, startDate?, endDate?, preset?, rules?, createdBy?, code?, now?}) → {ok, league} | {ok:false, errors}
   * A preset fills the rules and the length; explicit rules override it. Dates default to today → today + preset days.
   */
  function create(opts) {
    opts = opts || {};
    var preset = PRESETS.filter(function (p) { return p.id === opts.preset; })[0] || null;
    var nowMs = isNum(opts.now) ? opts.now : Date.now();
    var start = opts.startDate || dayKey(nowMs);
    var end = opts.endDate || addDays(start, (preset ? preset.days : 28) - 1) || start;
    var rules = {};
    var base = preset ? preset.rules : DEFAULT_RULES;
    Object.keys(base).forEach(function (k) { rules[k] = base[k]; });
    if (opts.rules && typeof opts.rules === 'object') Object.keys(opts.rules).forEach(function (k) { if (opts.rules[k] !== undefined) rules[k] = opts.rules[k]; });
    var lg = normalizeLeague({
      code: opts.code && isValidCode(opts.code) ? normalizeCode(opts.code) : newCode(),
      name: opts.name, createdBy: opts.createdBy || '', createdAt: new Date(nowMs).toISOString(),
      startDate: start, endDate: end, rules: rules, members: []
    });
    var errs = validateLeague(lg);
    return errs.length ? { ok: false, errors: errs } : { ok: true, league: lg };
  }

  /* ------------------------------------------------------------------ *
   * league code strings: 'BTL1.' + base64url(UTF-8 JSON)
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
  /* The code string carries the definition, not the member list (members join on their own devices). */
  function encodeLeague(lg) {
    var n = normalizeLeague(lg);
    var def = { v: 1, code: n.code, name: n.name, createdBy: n.createdBy, startDate: n.startDate, endDate: n.endDate, rules: n.rules };
    if (n.online) def.online = true;
    return PREFIX + b64url(utf8Encode(JSON.stringify(def)));
  }
  function decodeLeague(str) {
    var s = String(str == null ? '' : str).trim();
    var bare = normalizeCode(s);
    if (s.indexOf(PREFIX) !== 0) {
      if (CODE_RE.test(bare) && s.length <= 8) return { ok: false, reason: 'short-code', code: bare, error: T('That is a 6-character league code. It works when the league runs on the classroom server; otherwise ask the organiser for the full league code that starts with "BTL1.".') };
      return { ok: false, reason: 'format', error: T('A league code string starts with "BTL1.". Copy the whole code from the organiser.') };
    }
    if (s.length > MAX_LEAGUE_CHARS || !/^[A-Za-z0-9_-]+$/.test(s.slice(PREFIX.length))) return { ok: false, reason: 'format', error: T('That league code is damaged. Copy it again, all of it.') };
    var obj;
    try { obj = JSON.parse(utf8Decode(b64urlDecode(s.slice(PREFIX.length)))); } catch (e) { return { ok: false, reason: 'corrupt', error: T('That league code is incomplete or damaged. Copy it again, all of it.') }; }
    var lg = normalizeLeague(obj);
    var errs = validateLeague(lg);
    if (errs.length) return { ok: false, reason: 'invalid', error: errs[0], errors: errs };
    return { ok: true, league: lg };
  }
  function parseLeagueCodes(text) {
    var out = [], seen = {}, re = /BTL1\.[A-Za-z0-9_-]{8,}/g, m, s = String(text == null ? '' : text);
    while ((m = re.exec(s))) { if (!seen[m[0]]) { seen[m[0]] = 1; out.push(m[0]); } }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * local league registry
   * ------------------------------------------------------------------ */
  function list() {
    var s = load();
    return Object.keys(s.leagues).map(function (c) { return normalizeLeague(s.leagues[c]); }).filter(Boolean)
      .sort(function (a, b) { return String(b.startDate).localeCompare(String(a.startDate)) || a.name.localeCompare(b.name); });
  }
  function get(code) { var s = load(); var c = normalizeCode(code); return s.leagues[c] ? normalizeLeague(s.leagues[c]) : null; }
  /* lockedConflict(league) → the stored league when it has already started and `league` would change its
   * name, dates or rules; null when the change is allowed (new league, still upcoming, or same definition). */
  function lockedConflict(lg) {
    var n = normalizeLeague(lg);
    if (!n || !CODE_RE.test(n.code)) return null;
    var ex = get(n.code);
    if (!ex || phase(ex) === 'upcoming') return null;
    return definitionJson(ex, true) === definitionJson(n, true) ? null : ex;
  }
  /**
   * save(league, {force}) → stored league | null
   * Refuses (null) to change the name, dates or rules of a league that has already started, so a re-pasted,
   * edited code cannot relax the rules mid-contest. `force` is for the league server's own copy.
   */
  function save(lg, opts) {
    var n = normalizeLeague(lg);
    if (!n || !CODE_RE.test(n.code)) return null;
    if (!(opts && opts.force) && lockedConflict(n)) return null;
    var s = load(); s.leagues[n.code] = n; store(s);
    return n;
  }
  /**
   * addLeague(leagueOrString) → {ok, league} | {ok:false, reason, error}
   * Saves a league definition without joining (the organiser's or instructor's copy), keeping the members
   * this device already knows and refusing rule changes once the league has started.
   */
  function addLeague(input) {
    var lg;
    if (typeof input === 'string') { var d = decodeLeague(input); if (!d.ok) return d; lg = d.league; }
    else { lg = normalizeLeague(input); var errs = validateLeague(lg); if (errs.length) return { ok: false, reason: 'invalid', error: errs[0] }; }
    if (lockedConflict(lg)) return { ok: false, reason: 'locked', error: T('This league already started; its rules cannot change.') };
    var known = get(lg.code);
    if (known) {
      known.members.forEach(function (m) { if (!lg.members.some(function (x) { return x.studentId === m.studentId; })) lg.members.push(m); });
      if (known.online) lg.online = true;
    }
    return { ok: true, league: save(lg) };
  }
  function remove(code) {
    var c = normalizeCode(code), s = load();
    delete s.leagues[c]; delete s.joined[c]; delete s.imported[c]; delete s.lastSync[c];
    store(s);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * accounts
   * ------------------------------------------------------------------ */
  function accountId(code) { return 'league:' + normalizeCode(code); }
  /* 'league:ABC234' or BT.paper's normalised 'league-abc234' → 'ABC234'; anything else → null. */
  function accountCode(id) {
    var m = /^league[:\-]([a-z0-9]{6})$/i.exec(String(id || '').trim());
    return m && CODE_RE.test(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
  }
  function leagueForAccount(id) { var c = accountCode(id); return c ? get(c) : null; }
  function paperKey(code) {
    var P = BT.paper;
    return P && typeof P.storageKeyFor === 'function' ? P.storageKeyFor(accountId(code)) : 'bt.portfolio.league-' + normalizeCode(code).toLowerCase();
  }
  /* Fresh paper account for a league with its starting cash and commission, without leaving the
   * caller on that account (the dashboard keeps whatever account it had active). */
  function setupAccount(lg) {
    var P = BT.paper;
    if (!P || typeof P.use !== 'function') {
      lsSet(paperKey(lg.code), { cash: lg.rules.startingCash, startingCash: lg.rules.startingCash, positions: {}, orders: [], trades: [], equityHistory: [], settings: { commission: lg.rules.commission } });
      return true;
    }
    if (lsGet(paperKey(lg.code), null)) return false;            // already set up on this device: never wipe trades
    var prev = typeof P.account === 'function' ? P.account() : 'main';
    try {
      P.use(accountId(lg.code));
      P.reset(lg.rules.startingCash);
      if (typeof P.setSettings === 'function') P.setSettings({ commission: lg.rules.commission, slippageBps: lg.rules.slippageBps });
    } finally { P.use(prev); }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * join / leave
   * ------------------------------------------------------------------ */
  /**
   * join(leagueOrString, {displayName, team}) → {ok, league, code, studentId, fresh} | {ok:false, error}
   * Accepts a league object or a 'BTL1.' string. Creates the league's paper account on first join.
   */
  function join(input, opts) {
    opts = opts || {};
    var lg;
    if (typeof input === 'string') { var d = decodeLeague(input); if (!d.ok) return d; lg = d.league; }
    else { lg = normalizeLeague(input); var errs = validateLeague(lg); if (errs.length) return { ok: false, error: errs[0] }; }
    if (lockedConflict(lg)) return { ok: false, reason: 'locked', error: T('This league already started; its rules cannot change.') };
    var existing = get(lg.code);
    var locked = !!existing && phase(existing) !== 'upcoming';
    var prevJoin = load().joined[lg.code] || null;
    var name = cleanText(opts.displayName, 40);
    var team = cleanText(opts.team, 24);
    if (locked && prevJoin && prevJoin.team) team = prevJoin.team;   // teams are fixed once the league is running
    if (lg.rules.teams) {
      var match = lg.rules.teamNames.filter(function (t) { return t.toLowerCase() === team.toLowerCase(); })[0];
      if (!match) return { ok: false, error: T('Pick one of the league teams: {teams}.', { teams: lg.rules.teamNames.join(', ') }) };
      team = match;
    } else team = '';
    if (existing) { existing.members.forEach(function (m) { if (!lg.members.some(function (x) { return x.studentId === m.studentId; })) lg.members.push(m); }); if (existing.online) lg.online = true; }
    var id = studentId();
    lg.members = lg.members.filter(function (m) { return m.studentId !== id; });
    var me = { studentId: id, displayName: name };
    if (team) me.team = team;
    lg.members.push(me);
    save(lg);
    var s = load();
    var prev = s.joined[lg.code] || {};
    s.joined[lg.code] = { displayName: name, team: team || null, joinedAt: prev.joinedAt || new Date().toISOString(), ownerToken: prev.ownerToken || null };
    store(s);
    var fresh = setupAccount(lg);
    return { ok: true, league: lg, code: lg.code, studentId: id, fresh: fresh };
  }
  /* leave(code, {deleteAccount}) — forget membership; the paper account is kept unless asked. */
  function leave(code, opts) {
    var c = normalizeCode(code), s = load();
    delete s.joined[c]; store(s);
    var lg = get(c);
    if (lg) { var id = studentId(); lg.members = lg.members.filter(function (m) { return m.studentId !== id; }); save(lg); }
    if (opts && opts.deleteAccount && BT.paper && typeof BT.paper.deleteAccount === 'function') BT.paper.deleteAccount(accountId(c));
    return { ok: true };
  }
  function joined() { var s = load(); return Object.keys(s.joined).map(function (c) { return get(c); }).filter(Boolean); }
  function membership(code) { var s = load(); return s.joined[normalizeCode(code)] || null; }
  function setOwnerToken(code, token) {
    var c = normalizeCode(code), s = load();
    if (!s.joined[c]) return false;
    s.joined[c].ownerToken = typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
    store(s); return true;
  }

  /* ------------------------------------------------------------------ *
   * league status
   * ------------------------------------------------------------------ */
  function phase(lg, nowMs) {
    nowMs = isNum(nowMs) ? nowMs : Date.now();
    if (!lg || !validDate(lg.startDate) || !validDate(lg.endDate)) return 'unknown';
    if (nowMs < startOf(lg.startDate)) return 'upcoming';
    if (nowMs >= startOf(lg.endDate) + DAY_MS) return 'ended';
    return 'active';
  }
  /* countdown(league, now) → {phase, msLeft, days, hours, minutes, label} (msLeft to start when upcoming, to the end when active). */
  function countdown(lg, nowMs) {
    nowMs = isNum(nowMs) ? nowMs : Date.now();
    var ph = phase(lg, nowMs);
    var target = ph === 'upcoming' ? startOf(lg.startDate) : (ph === 'active' ? startOf(lg.endDate) + DAY_MS : nowMs);
    var ms = Math.max(0, target - nowMs);
    var days = Math.floor(ms / DAY_MS), hours = Math.floor(ms % DAY_MS / 36e5), minutes = Math.floor(ms % 36e5 / 6e4);
    var span = days > 0 ? T('{d}d {h}h', { d: days, h: hours }) : T('{h}h {m}m', { h: hours, m: minutes });
    var label = ph === 'upcoming' ? T('Starts in {span}', { span: span }) : ph === 'active' ? T('Ends in {span}', { span: span }) : ph === 'ended' ? T('Finished') : '';
    return { phase: ph, msLeft: ms, days: days, hours: hours, minutes: minutes, label: label };
  }

  /**
   * tradingOpen(codeOrAccountId, now?) → true when that league is active (or the id is not a league account).
   * The dashboard and replay call it before filling working orders: when false, cancel the league account's
   * open orders with finishedReason(league) instead of filling them, so results freeze at the end date.
   */
  function tradingOpen(id, nowMs) {
    var c = accountCode(id) || (isValidCode(id) ? normalizeCode(id) : null);
    var lg = c ? get(c) : null;
    return !lg || phase(lg, nowMs) === 'active';
  }
  function finishedReason(lg) {
    if (lg && phase(lg) === 'upcoming') return T('League not started');
    return T('League finished');
  }

  /* ------------------------------------------------------------------ *
   * order validation (called by the dashboard and replay tickets)
   * ------------------------------------------------------------------ */
  var OCC_RE = /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/;
  function assetKind(order) {
    var sym = String(order.symbol || order.contract || '').toUpperCase();
    if (order.kind === 'option' || order.contract || OCC_RE.test(sym)) return 'option';
    if (order.kind === 'crypto' || order.kind === 'etf') return order.kind;
    if (BT.data && typeof BT.data.kindOf === 'function') { var k = BT.data.kindOf(sym); if (k === 'crypto' || k === 'etf') return k; }
    if (/^[A-Z0-9]{2,10}-USD$/.test(sym)) return 'crypto';
    return 'stock';
  }
  function kindLabel(k) { return { stock: T('stocks'), etf: T('ETFs'), crypto: T('crypto'), option: T('options') }[k] || k; }
  function multOf(pos) { return pos && pos.meta && isNum(pos.meta.multiplier) && pos.meta.multiplier > 0 ? pos.meta.multiplier : (pos && pos.kind === 'option' ? 100 : 1); }
  function equityOf(acct) {
    if (!acct) return null;
    if (isNum(acct.equity)) return acct.equity;
    if (!isNum(acct.cash)) return null;
    var mv = 0, marks = acct.marks || {};
    Object.keys(acct.positions || {}).forEach(function (sym) {
      var p = acct.positions[sym]; if (!p || !isNum(p.qty)) return;
      var px = isNum(marks[sym]) ? marks[sym] : (isNum(p.avg) ? p.avg : 0);
      mv += p.qty * px * multOf(p);
    });
    return acct.cash + mv;
  }
  /**
   * validateOrder(order, league, account) → {ok, reason}
   *   order   {symbol | contract, side:'buy'|'sell', qty, price?, limitPrice?, stopPrice?, kind?, time?}
   *   league  league object (or code)
   *   account the league's paper state (BT.paper.getState()) or {cash, positions, trades, marks, equity}
   * Rules enforced: league dates, allowed asset classes, short selling, day trading (no closing a
   * position opened the same day) and max position % of equity. Cash and margin stay BT.paper's job.
   */
  function validateOrder(order, league, account) {
    var lg = typeof league === 'string' ? get(league) : normalizeLeague(league);
    if (!lg) return { ok: true, reason: '' };
    if (!order || typeof order !== 'object') return { ok: false, reason: T('No order to check.') };
    var r = lg.rules;
    var nowMs = isNum(order.time) ? order.time : Date.now();
    var ph = phase(lg, nowMs);
    if (ph === 'upcoming') return { ok: false, reason: T('{name} starts on {date}. Orders in this league open then.', { name: lg.name, date: lg.startDate }) };
    if (ph === 'ended') return { ok: false, reason: T('{name} finished on {date}. The account is frozen so the final standings stay fair.', { name: lg.name, date: lg.endDate }) };
    var kind = assetKind(order);
    if (r.assets.indexOf(kind) < 0) return { ok: false, reason: T('This league allows {list} only, so {kind} orders are off. The organiser chose that rule.', { list: r.assets.map(kindLabel).join(', '), kind: kindLabel(kind) }) };
    var side = order.side === 'sell' ? 'sell' : 'buy';
    var qty = +order.qty;
    if (!(qty > 0)) return { ok: false, reason: T('Enter a quantity above zero.') };
    var sym = String(order.symbol || order.contract || '').toUpperCase();
    var acct = account || {};
    var pos = acct.positions && acct.positions[sym];
    var held = pos && isNum(pos.qty) ? pos.qty : 0;
    // Working orders count too: several resting limits must not add up past the rules once they fill.
    var pendBuy = 0, pendSell = 0;
    (Array.isArray(acct.orders) ? acct.orders : []).forEach(function (o) {
      if (!o || o.status !== 'open' || String(o.symbol || o.contract || '').toUpperCase() !== sym) return;
      var left = (+o.qty || 0) - (isNum(o.filledQty) ? o.filledQty : 0);
      if (!(left > 0)) return;
      if (o.side === 'sell') pendSell += left; else pendBuy += left;
    });
    var after = side === 'buy' ? held + pendBuy + qty : held - pendSell - qty;
    if (!r.shortSelling && after < -1e-9) {
      var canSell = Math.max(0, held - pendSell);
      if (pendSell > 0 && held > 0) return { ok: false, reason: T('Short selling is off in this league: you own {n} and {p} are already in open sell orders, so you can sell up to {left} more.', { n: held, p: pendSell, left: canSell }) };
      return { ok: false, reason: held > 0 ? T('Short selling is off in this league: you can sell up to the {n} you own, not more.', { n: held }) : T('Short selling is off in this league: you can only sell what you own.') };
    }
    var closing = (held > 0 && side === 'sell') || (held < 0 && side === 'buy');
    if (!r.dayTrading && closing) {
      var today = dayKey(nowMs);
      var openSide = held > 0 ? 'buy' : 'sell';
      var openedToday = (acct.trades || []).some(function (t) {
        return t && String(t.symbol || '').toUpperCase() === sym && t.side === openSide && (t.openedQty == null || t.openedQty > 0) && isNum(t.time) && dayKey(t.time) === today;
      });
      if (openedToday) return { ok: false, reason: T('Day trading is off in this league: a position opened today can be closed from tomorrow. Holding overnight is the point of this league.') };
    }
    var px = [order.price, order.limitPrice, order.stopPrice, acct.marks && acct.marks[sym], pos && pos.avg].filter(function (v) { return isNum(v) && v > 0; })[0];
    var eq = equityOf(acct);
    if (r.maxPositionPct < 100 && isNum(px) && isNum(eq) && eq > 0 && Math.abs(after) > Math.abs(held)) {
      var mult = kind === 'option' ? (pos ? multOf(pos) : 100) : 1;
      var value = Math.abs(after) * px * mult;
      var pct = value / eq * 100;
      if (pct > r.maxPositionPct + 1e-9) {
        var pend = side === 'buy' ? pendBuy : pendSell;
        var maxQty = Math.floor(r.maxPositionPct / 100 * eq / (px * mult) + 1e-9) - Math.abs(held) - pend;
        var vars = { sym: sym, pct: round(pct, 1), max: r.maxPositionPct, q: Math.max(0, maxQty), p: pend };
        return { ok: false, reason: pend > 0
          ? T('This order plus your {p} in open orders would make {sym} {pct}% of your league equity; the limit is {max}%. The most you can add is {q}.', vars)
          : T('This order would make {sym} {pct}% of your league equity; the limit is {max}%. The most you can add is {q}.', vars) };
      }
    }
    return { ok: true, reason: '' };
  }

  /* ------------------------------------------------------------------ *
   * metrics, standings, movers
   * ------------------------------------------------------------------ */
  function downsample(arr, n) {
    if (arr.length <= n) return arr.slice();
    var out = [];
    for (var i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
    return out;
  }
  /* dailyCloses([{t, equity}]) → [{t, day, equity}]: the last point of each local calendar day, oldest first
   * (the same resampling BT.paper.stats() uses). */
  function dailyCloses(hist) {
    var pts = (hist || []).filter(function (h) { return h && isNum(h.t) && isNum(h.equity); })
      .slice().sort(function (a, b) { return a.t - b.t; });
    var out = [];
    pts.forEach(function (h) {
      var key = dayKey(h.t), last = out[out.length - 1];
      if (last && last.day === key) { last.t = h.t; last.equity = h.equity; }
      else out.push({ t: h.t, day: key, equity: h.equity });
    });
    return out;
  }
  /**
   * metrics(equityHistory, startingCash) → {returnPct, maxDrawdownPct, sharpe, consistencyScore}
   *   equityHistory: numbers or {t, equity}, oldest first. Return and drawdown use every point (plus the
   *   starting cash in front).
   *   With timestamps ({t} on at least two points): Sharpe and consistency use one close per calendar day,
   *   never the synthetic starting-cash step, and Sharpe is annualised with √(periods per year), where
   *   periods per year = min(252, 365.25 / average calendar days between closes). So opening the app often
   *   (many intraday points) or rarely does not change the score; only day-to-day results do.
   *   Without timestamps (bare numbers, e.g. a server sparkline): each step is taken as one trading day, ×√252,
   *   starting-cash step included (the formula server/worker.js leagueMetrics() uses).
   *   sharpe: null under 3 returns. consistencyScore 0–100: 60 % share of rising steps + 40 % drawdown score
   *   (0 % dd → 1, ≥ 20 % → 0); null under 2 non-flat steps.
   */
  function metrics(hist, startingCash) {
    var pts = (Array.isArray(hist) ? hist : []).map(function (h) {
      if (isNum(h)) return { t: null, equity: h };
      return h && isNum(h.equity) ? { t: isNum(h.t) ? h.t : null, equity: h.equity } : null;
    }).filter(Boolean);
    var vals = pts.map(function (p) { return p.equity; });
    var start = isNum(startingCash) && startingCash > 0 ? startingCash : (vals[0] || null);
    var curve = start != null ? [start].concat(vals) : vals;
    var last = curve.length ? curve[curve.length - 1] : null;
    var peak = -Infinity, dd = 0;
    curve.forEach(function (v) { if (v > peak) peak = v; if (peak > 0) dd = Math.max(dd, (peak - v) / peak * 100); });
    var rets = [], annual = Math.sqrt(252), i;
    var timed = pts.filter(function (p) { return p.t != null; });
    if (timed.length >= 2) {
      var daily = dailyCloses(timed);
      for (i = 1; i < daily.length; i++) if (daily[i - 1].equity > 0) rets.push(daily[i].equity / daily[i - 1].equity - 1);
      if (daily.length > 1) {
        var gapDays = Math.max(1, (startOf(daily[daily.length - 1].day) - startOf(daily[0].day)) / DAY_MS / (daily.length - 1));
        annual = Math.sqrt(Math.min(252, 365.25 / gapDays));
      }
    } else {
      for (i = 1; i < curve.length; i++) if (curve[i - 1] > 0) rets.push(curve[i] / curve[i - 1] - 1);
    }
    var sharpe = null;
    if (rets.length >= 3) {
      var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
      var sd = Math.sqrt(rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rets.length - 1));
      sharpe = sd > 0 ? round(mean / sd * annual, 2) : null;
    }
    var moves = rets.filter(function (x) { return Math.abs(x) > 1e-9; });
    var consistency = null;
    if (moves.length >= 2) {
      var up = moves.filter(function (x) { return x > 0; }).length / moves.length;
      consistency = Math.round(100 * (0.6 * up + 0.4 * Math.max(0, 1 - dd / 20)));
    }
    return {
      returnPct: start && last != null ? round((last - start) / start * 100, 2) : 0,
      maxDrawdownPct: round(dd, 2),
      sharpe: sharpe,
      consistencyScore: consistency
    };
  }
  /* End of the league in ms (local midnight after the end date); Infinity when unknown. */
  function endCutoff(lg) { return lg && validDate(lg.endDate) ? startOf(lg.endDate) + DAY_MS : Infinity; }
  /**
   * leagueSnapshot(code) → the league block of a snapshot for this device's own league account
   * (reads storage; never switches accounts).
   *   {equity, startingCash, returnPct, trades, fills, maxDrawdownPct, sharpe, consistencyScore,
   *    equityHistory:[{t, equity}] (≤ MAX_HISTORY daily closes, for the sparkline), rulesHash, asOf, final}
   * Drawdown is measured over the full, minute-level history so a deep intraday dip is never thinned away.
   * Once the league has ended the result is frozen: only history before the end counts and the equity is
   * the last value recorded before the end, never today's marks.
   */
  function leagueSnapshot(code) {
    var c = normalizeCode(code), lg = get(c);
    var st = lsGet(paperKey(c), null);
    var startCash = lg ? lg.rules.startingCash : (st && isNum(st.startingCash) && st.startingCash > 0 ? st.startingCash : 100000);
    var hash = lg ? rulesHash(lg) : null;
    if (!st || typeof st !== 'object') return { equity: startCash, startingCash: startCash, returnPct: 0, trades: 0, fills: 0, maxDrawdownPct: 0, sharpe: null, consistencyScore: null, equityHistory: [], rulesHash: hash, asOf: null, final: false };
    var ended = !!lg && phase(lg) === 'ended';
    var cutoff = ended ? endCutoff(lg) : Infinity;
    var hist = (Array.isArray(st.equityHistory) ? st.equityHistory : [])
      .filter(function (h) { return h && isNum(h.equity) && isNum(h.t) && h.t < cutoff; })
      .slice().sort(function (a, b) { return a.t - b.t; });
    var eq, asOf;
    if (ended) {
      eq = hist.length ? hist[hist.length - 1].equity : startCash;
      asOf = hist.length ? hist[hist.length - 1].t : cutoff - 1;
    } else {
      eq = equityOf({ cash: isNum(st.cash) ? st.cash : startCash, positions: st.positions || {}, marks: st.marks || {} });
      asOf = Date.now();
    }
    var full = hist.concat([{ t: asOf, equity: eq }]);
    var dd = metrics(full.map(function (h) { return h.equity; }), startCash).maxDrawdownPct;
    var daily = dailyCloses(full);
    var m = metrics(daily, startCash);
    var pts = downsample(daily, MAX_HISTORY).map(function (h) { return { t: h.t, equity: round(h.equity, 2) }; });
    var tradesArr = Array.isArray(st.trades) ? st.trades.filter(function (t) { return t && (!ended || !isNum(t.time) || t.time < cutoff); }) : [];
    var trades = tradesArr.filter(function (t) { return t.closedQty > 0; }).length;
    return {
      equity: round(eq, 2), startingCash: startCash, returnPct: round((eq - startCash) / startCash * 100, 2),
      trades: trades, fills: tradesArr.length, maxDrawdownPct: dd, sharpe: m.sharpe, consistencyScore: m.consistencyScore,
      equityHistory: pts, rulesHash: hash, asOf: asOf, final: ended
    };
  }
  /* snapshot() → BT.classroom.snapshot() (when loaded) + {leagues:{CODE: leagueSnapshot}} for every joined league. */
  function snapshot() {
    var base = BT.classroom && typeof BT.classroom.snapshot === 'function' ? BT.classroom.snapshot() : { v: 1, studentId: studentId(), displayName: '', updatedAt: new Date().toISOString() };
    var s = load();
    base.leagues = {};
    Object.keys(s.joined).forEach(function (c) {
      var snap = leagueSnapshot(c);
      snap.displayName = s.joined[c].displayName || '';
      if (s.joined[c].team) snap.team = s.joined[c].team;
      base.leagues[c] = snap;
    });
    if (!base.displayName) { var first = Object.keys(s.joined)[0]; if (first) base.displayName = s.joined[first].displayName || ''; }
    return base;
  }
  /* Share codes reuse the classroom format so the instructor page reads them too. */
  function encodeShare(snap) {
    snap = snap || snapshot();
    if (BT.classroom && typeof BT.classroom.encodeShare === 'function') return BT.classroom.encodeShare(snap);
    return Promise.resolve(SHARE_PREFIX + b64url(utf8Encode(JSON.stringify(snap))));
  }
  function decodeShare(str) {
    if (BT.classroom && typeof BT.classroom.decodeShare === 'function') return BT.classroom.decodeShare(str);
    var c = String(str == null ? '' : str).trim();
    if (c.indexOf(SHARE_PREFIX) !== 0) return Promise.resolve({ ok: false, error: T('A share code starts with "BT1.". Copy the whole code.') });
    try {
      var obj = JSON.parse(utf8Decode(b64urlDecode(c.slice(SHARE_PREFIX.length))));
      if (!obj || !/^[A-Za-z0-9_-]{4,40}$/.test(String(obj.studentId || ''))) throw new Error('id');
      return Promise.resolve({ ok: true, snapshot: obj });
    } catch (e) {
      return Promise.resolve({ ok: false, error: T('That share code is damaged or compressed. Open this page in a current browser, or ask the student to copy it again.') });
    }
  }
  function parseShareCodes(text) {
    if (BT.classroom && typeof BT.classroom.parseShareCodes === 'function') return BT.classroom.parseShareCodes(text);
    var out = [], seen = {}, re = /BT1\.[A-Za-z0-9_-]{8,}/g, m, s = String(text == null ? '' : text);
    while ((m = re.exec(s))) { if (!seen[m[0]]) { seen[m[0]] = 1; out.push(m[0]); } }
    return out;
  }
  /* Self-reported fields are kept only for display; standings() recomputes everything that ranks. */
  function cleanLeagueBlock(b) {
    if (!b || typeof b !== 'object') return null;
    var n = function (v, lo, hi) { v = +v; return isFinite(v) ? clamp(v, lo, hi) : null; };
    var hist = (Array.isArray(b.equityHistory) ? b.equityHistory : []).slice(-MAX_HISTORY).map(function (h) {
      var e = isNum(h) ? h : (h && n(h.equity, 0, 1e12)); var t = h && isNum(h.t) ? h.t : null;
      return isNum(e) ? { t: t, equity: e } : null;
    }).filter(Boolean);
    return {
      equity: n(b.equity, 0, 1e12), startingCash: n(b.startingCash, 0, 1e12), returnPct: n(b.returnPct, -100, 1e6),
      trades: Math.round(n(b.trades, 0, 1e6) || 0), maxDrawdownPct: n(b.maxDrawdownPct, 0, 100), equityHistory: hist,
      displayName: cleanText(b.displayName, 40), team: cleanText(b.team, 24) || null,
      rulesHash: /^[0-9a-f]{8}$/.test(String(b.rulesHash || '')) ? String(b.rulesHash) : null,
      final: b.final === true
    };
  }
  /* updatedAt → ms, or null unless it is an ISO date-time no more than a day in the future. */
  function stampOf(v) {
    var str = String(v == null ? '' : v);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) return null;
    var ms = Date.parse(str);
    return isFinite(ms) && ms <= Date.now() + DAY_MS ? ms : null;
  }
  /**
   * importShares(code, snapshots) → {added, updated, skipped}
   * Keeps the newest snapshot per student (by updatedAt, an ISO time no more than a day ahead) that carries a
   * block for this league. Snapshots with a missing, malformed or far-future updatedAt are skipped, so a forged
   * '9999' can never lock a real member's later imports out.
   */
  function importShares(code, snaps) {
    var c = normalizeCode(code), s = load();
    var bucket = s.imported[c] || {};
    var res = { added: 0, updated: 0, skipped: 0 };
    (Array.isArray(snaps) ? snaps : [snaps]).forEach(function (snap) {
      if (!snap || typeof snap !== 'object' || !/^[A-Za-z0-9_-]{4,40}$/.test(String(snap.studentId || ''))) { res.skipped++; return; }
      var block = cleanLeagueBlock(snap.leagues && snap.leagues[c]);
      var at = stampOf(snap.updatedAt);
      if (!block || at == null) { res.skipped++; return; }
      var prev = bucket[snap.studentId];
      if (prev && (stampOf(prev.updatedAt) || 0) > at) { res.skipped++; return; }
      bucket[snap.studentId] = { studentId: snap.studentId, displayName: block.displayName || cleanText(snap.displayName, 40), updatedAt: new Date(at).toISOString(), leagues: {} };
      bucket[snap.studentId].leagues[c] = block;
      if (prev) res.updated++; else res.added++;
    });
    s.imported[c] = bucket; store(s);
    return res;
  }
  function imported(code) { var s = load(); var b = s.imported[normalizeCode(code)] || {}; return Object.keys(b).map(function (k) { return b[k]; }); }
  function clearImported(code, id) {
    var c = normalizeCode(code), s = load();
    if (id) { if (s.imported[c]) delete s.imported[c][id]; } else delete s.imported[c];
    store(s); return true;
  }
  /* Every snapshot this device knows for a league: the imported ones plus its own (when joined). */
  function knownSnapshots(code) {
    var c = normalizeCode(code);
    var out = imported(c);
    var mem = membership(c);
    if (mem) {
      var mine = { studentId: studentId(), displayName: mem.displayName || '', updatedAt: new Date().toISOString(), leagues: {} };
      var b = leagueSnapshot(c); b.displayName = mem.displayName || ''; if (mem.team) b.team = mem.team;
      mine.leagues[c] = b;
      out = out.filter(function (x) { return x.studentId !== mine.studentId; }).concat([mine]);
    }
    return out;
  }
  /**
   * rankScore(returnPct, maxDrawdownPct) → risk-adjusted score: return ÷ max(drawdown, 1) for gains,
   * return × max(drawdown, 1) for losses (a deeper drawdown always scores lower; 0 stays 0).
   */
  function rankScore(ret, dd) {
    var d = Math.max(isNum(dd) ? dd : 0, 1);
    ret = isNum(ret) ? ret : 0;
    return round(ret >= 0 ? ret / d : ret * d, 4);
  }
  /* rankNote(league) → the one-line explanation shown above a standings table. */
  function rankNote(league) {
    var by = league && league.rules && RANK_BY.indexOf(league.rules.rankBy) >= 0 ? league.rules.rankBy : DEFAULT_RULES.rankBy;
    if (by === 'return') return T('Ranks follow raw return only. Remember: a big return from one all-in bet is luck, not skill (see m10-l5).');
    if (by === 'consistency') return T('Ranks reward consistency: steady gains with small drawdowns. A big return from one all-in bet is luck, not skill (see m10-l5).');
    return T('Ranks reward risk-adjusted results; a big return from one all-in bet is luck, not skill (see m10-l5).');
  }
  /**
   * standings(league, snapshots) → rows sorted by the league's rankBy rule
   *   'riskAdjusted' (default): rankScore(return, drawdown); 'return': raw return; 'consistency': consistencyScore.
   *   Ties: higher return, then smaller drawdown, then anyone who traded, then name.
   *   row {rank, studentId, displayName, team, equity, returnPct, sharpe, maxDrawdownPct, trades, consistencyScore,
   *        rankScore, equityHistory, updatedAt, rulesMismatch, final, me}
   *   snapshots: classroom-shaped snapshots with leagues[code], or server rows that already carry the fields.
   * Nothing self-reported decides a rank: return, Sharpe and consistency are recomputed from the equity and
   * history against the league's own starting cash; drawdown is the larger of the claimed and recomputed
   * values; a team counts only when it is one of the league's teams (the stored member record wins).
   * rulesMismatch is true when a share code was made under different dates or rules than this device's copy.
   */
  function standings(league, snaps) {
    var lg = typeof league === 'string' ? (get(league) || { code: normalizeCode(league), rules: normalizeRules({}), members: [] }) : normalizeLeague(league);
    var c = lg.code;
    var start = lg.rules.startingCash;
    var hash = validDate(lg.startDate) && validDate(lg.endDate) ? rulesHash(lg) : null;
    var names = lg.rules.teams ? lg.rules.teamNames : [];
    var canonTeam = function (t) { var k = cleanText(t, 24).toLowerCase(); return k ? names.filter(function (n) { return n.toLowerCase() === k; })[0] || null : null; };
    var me = null; try { me = studentId(); } catch (e) { me = null; }
    var byId = {};
    (Array.isArray(snaps) ? snaps : []).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var id = String(s.studentId || '');
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return;
      var b = s.leagues && s.leagues[c] ? cleanLeagueBlock(s.leagues[c]) : cleanLeagueBlock(s);
      if (!b) return;
      var prev = byId[id];
      if (prev && (stampOf(prev.updatedAt) || 0) > (stampOf(s.updatedAt) || 0)) return;
      byId[id] = { s: s, b: b, updatedAt: s.updatedAt };
    });
    var members = {};
    (lg.members || []).forEach(function (m) { members[m.studentId] = m; });
    var rows = Object.keys(byId).map(function (id) {
      var b = byId[id].b, s = byId[id].s;
      var m = metrics(b.equityHistory.concat(isNum(b.equity) ? [{ equity: b.equity }] : []), start);
      var mem = members[id] || {};
      var dd = isNum(b.maxDrawdownPct) ? round(Math.max(b.maxDrawdownPct, m.maxDrawdownPct), 2) : m.maxDrawdownPct;
      return {
        studentId: id,
        displayName: b.displayName || cleanText(s.displayName, 40) || mem.displayName || '',
        team: canonTeam(mem.team) || canonTeam(b.team),
        equity: isNum(b.equity) ? round(b.equity, 2) : null,
        returnPct: m.returnPct,
        sharpe: m.sharpe,
        maxDrawdownPct: dd,
        trades: b.trades || 0,
        consistencyScore: m.consistencyScore,
        rankScore: rankScore(m.returnPct, dd),
        equityHistory: b.equityHistory.map(function (h) { return h.equity; }),
        updatedAt: byId[id].updatedAt || null,
        rulesMismatch: !!(hash && b.rulesHash && b.rulesHash !== hash),
        final: b.final,
        me: id === me
      };
    });
    var by = lg.rules.rankBy;
    rows.sort(function (a, b) {
      var primary = by === 'return' ? 0
        : by === 'consistency' ? ((isNum(b.consistencyScore) ? b.consistencyScore : -1) - (isNum(a.consistencyScore) ? a.consistencyScore : -1)) || (b.rankScore - a.rankScore)
        : (b.rankScore - a.rankScore);
      return primary || (b.returnPct - a.returnPct) || (a.maxDrawdownPct - b.maxDrawdownPct) || (b.trades > 0) - (a.trades > 0) || String(a.displayName).localeCompare(String(b.displayName)) || (a.studentId < b.studentId ? -1 : 1);
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }
  /* teamStandings(rows, league?) → [{rank, team, members, avgReturnPct, avgDrawdownPct, best}] sorted by average return.
   * When the league lists team names, only those teams count (a forged team name never appears). */
  function teamStandings(rows, league) {
    var teams = {};
    var listed = league && league.rules && Array.isArray(league.rules.teamNames) ? league.rules.teamNames : [];
    listed.forEach(function (t) { teams[t] = []; });
    (rows || []).forEach(function (r) {
      if (!r.team) return;
      if (listed.length && !Object.prototype.hasOwnProperty.call(teams, r.team)) return;
      (teams[r.team] = teams[r.team] || []).push(r);
    });
    var out = Object.keys(teams).map(function (t) {
      var rs = teams[t];
      var avg = function (k) { return rs.length ? round(rs.reduce(function (a, r) { return a + (+r[k] || 0); }, 0) / rs.length, 2) : null; };
      return { team: t, members: rs.length, avgReturnPct: avg('returnPct'), avgDrawdownPct: avg('maxDrawdownPct'), best: rs.length ? rs[0].displayName : null };
    });
    out.sort(function (a, b) { return (b.members > 0) - (a.members > 0) || (b.avgReturnPct - a.avgReturnPct) || (a.avgDrawdownPct - b.avgDrawdownPct) || a.team.localeCompare(b.team); });
    out.forEach(function (t, i) { t.rank = i + 1; });
    return out;
  }
  /* movers(rows, {lookback=5, count=3}) → {up:[{row, changePct}], down:[…]} over the last `lookback` history points. */
  function movers(rows, opts) {
    opts = opts || {};
    var k = Math.max(1, opts.lookback || 5), n = Math.max(1, opts.count || 3);
    var ch = (rows || []).map(function (r) {
      var h = (r.equityHistory || []).filter(isNum);
      if (isNum(r.equity) && h[h.length - 1] !== r.equity) h.push(r.equity);
      if (h.length < 2) return null;
      var from = h[Math.max(0, h.length - 1 - k)], to = h[h.length - 1];
      return from > 0 ? { row: r, changePct: round((to - from) / from * 100, 2) } : null;
    }).filter(Boolean);
    var up = ch.filter(function (x) { return x.changePct > 0; }).sort(function (a, b) { return b.changePct - a.changePct; }).slice(0, n);
    var down = ch.filter(function (x) { return x.changePct < 0; }).sort(function (a, b) { return a.changePct - b.changePct; }).slice(0, n);
    return { up: up, down: down };
  }
  /* sparkPath(values, w, h, pad=1) → SVG path 'M…L…' ('' with fewer than 2 points). */
  function sparkPath(values, w, h, pad) {
    var v = (values || []).filter(isNum);
    if (v.length < 2) return '';
    pad = pad == null ? 1 : pad;
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), span = hi - lo || 1;
    return v.map(function (y, i) {
      var x = pad + i * (w - 2 * pad) / (v.length - 1);
      var yy = h - pad - (y - lo) / span * (h - 2 * pad);
      return (i ? 'L' : 'M') + round(x, 1) + ' ' + round(yy, 1);
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * online mode (server/worker.js)
   * ------------------------------------------------------------------ */
  function apiBase() { return String((BT.auth && BT.auth.config && BT.auth.config.apiBase) || '').replace(/\/+$/, ''); }
  function backendConfigured() { return !!apiBase() && typeof glob('fetch') === 'function'; }
  function call(method, path, body) {
    if (!backendConfigured()) return Promise.resolve({ ok: false, skipped: 'no-backend' });
    var opts = { method: method, mode: 'cors', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return glob('fetch')(apiBase() + path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        var out = data && typeof data === 'object' ? data : {};
        out.ok = res.ok && out.ok !== false; out.status = res.status;
        if (!res.ok && !out.error) out.error = T('Request failed ({status}).', { status: res.status });
        return out;
      });
    }).catch(function () { return { ok: false, network: true, error: T('Could not reach the league server. Everything is saved on this device.') }; });
  }
  var remote = {
    configured: backendConfigured,
    /* create(league) → server mints the code; the local league is re-keyed to it. */
    create: function (lg) {
      var n = normalizeLeague(lg);
      return call('POST', '/leagues', { name: n.name, createdBy: n.createdBy, startDate: n.startDate, endDate: n.endDate, rules: n.rules }).then(function (r) {
        if (r.ok && r.league && isValidCode(r.league.code)) { r.league.online = true; r.league = save(r.league, { force: true }); }
        return r;
      });
    },
    fetch: function (code) {
      return call('GET', '/leagues/' + encodeURIComponent(normalizeCode(code))).then(function (r) {
        if (r.ok && r.league) { r.league.online = true; var known = get(r.league.code); if (known) r.league.members = known.members; r.league = save(r.league, { force: true }); }
        return r;
      });
    },
    join: function (code, opts) {
      opts = opts || {};
      var c = normalizeCode(code), mem = membership(c) || {};
      return call('POST', '/leagues/' + encodeURIComponent(c) + '/join', { studentId: studentId(), displayName: opts.displayName || mem.displayName || '', team: opts.team || mem.team || '', ownerToken: mem.ownerToken || undefined }).then(function (r) {
        if (r.ok && r.ownerToken) setOwnerToken(c, r.ownerToken);
        return r;
      });
    },
    /* sync(code): posts this device's league block. After the league ends it sends the frozen final result
     * once, then stops (later calls resolve {ok:false, skipped:'ended'}). */
    sync: function (code) {
      var c = normalizeCode(code), mem = membership(c);
      if (!mem) return Promise.resolve({ ok: false, skipped: 'not-joined' });
      var lg = get(c);
      if (lg && phase(lg) === 'ended') {
        var lastSent = Date.parse(load().lastSync[c] || '');
        if (isFinite(lastSent) && lastSent >= endCutoff(lg)) return Promise.resolve({ ok: false, skipped: 'ended', error: T('This league has finished and your final result was already sent.') });
      }
      var b = leagueSnapshot(c);
      return call('POST', '/leagues/' + encodeURIComponent(c) + '/snapshots', { studentId: studentId(), ownerToken: mem.ownerToken || undefined, league: b }).then(function (r) {
        if (r.ok) { var s = load(); s.lastSync[c] = new Date().toISOString(); store(s); if (r.ownerToken) setOwnerToken(c, r.ownerToken); }
        return r;
      });
    },
    standings: function (code) { return call('GET', '/leagues/' + encodeURIComponent(normalizeCode(code)) + '/standings'); }
  };

  BT.leagues = {
    KEY: KEY, PREFIX: PREFIX, SHARE_PREFIX: SHARE_PREFIX, PRESETS: PRESETS, DEFAULT_RULES: DEFAULT_RULES, ASSETS: ASSETS,
    CODE_ALPHABET: CODE_ALPHABET, MAX_HISTORY: MAX_HISTORY,
    normalizeCode: normalizeCode, isValidCode: isValidCode, newCode: newCode,
    normalizeRules: normalizeRules, normalizeLeague: normalizeLeague, validateLeague: validateLeague, create: create,
    encodeLeague: encodeLeague, decodeLeague: decodeLeague, parseLeagueCodes: parseLeagueCodes,
    RANK_BY: RANK_BY,
    list: list, get: get, save: save, addLeague: addLeague, lockedConflict: lockedConflict, rulesHash: rulesHash, remove: remove,
    join: join, leave: leave, joined: joined, membership: membership, setOwnerToken: setOwnerToken, studentId: studentId,
    accountId: accountId, accountCode: accountCode, leagueForAccount: leagueForAccount,
    validateOrder: validateOrder, assetKind: assetKind, phase: phase, countdown: countdown, tradingOpen: tradingOpen, finishedReason: finishedReason,
    leagueSnapshot: leagueSnapshot, snapshot: snapshot, encodeShare: encodeShare, decodeShare: decodeShare, parseShareCodes: parseShareCodes,
    importShares: importShares, imported: imported, clearImported: clearImported, knownSnapshots: knownSnapshots,
    standings: standings, teamStandings: teamStandings, movers: movers, metrics: metrics, sparkPath: sparkPath, rankScore: rankScore, rankNote: rankNote,
    remote: remote,
    _internal: { load: load, dayKey: dayKey, addDays: addDays, startOf: startOf, validDate: validDate, b64url: b64url, b64urlDecode: b64urlDecode, paperKey: paperKey, equityOf: equityOf, downsample: downsample, dailyCloses: dailyCloses, stampOf: stampOf }
  };
})();
