/* Broward Trading — js/auth.js → BT.auth (membership client, v0.3)
 *
 * Talks to the optional Cloudflare Worker in server/worker.js. When
 * BT.auth.config.apiBase is '' (the default in js/config.js) every network
 * function resolves to a friendly "backend not configured" result and the
 * module works purely from localStorage, so the free site never breaks.
 *
 * Public surface (contract, CONTRACTS.md "v0.3 additions")
 *   BT.auth.config                      {apiBase, proGating, ...} from js/config.js
 *   BT.auth.configured()                true when apiBase is set
 *   BT.auth.signIn(email)               → {ok, sent, message}   requests a magic link
 *   BT.auth.handleCallback(opts?)       reads #code=… / #session=… / #checkout=… after a redirect.
 *                                       A sign-in fragment is only accepted when this device
 *                                       requested it (bt.auth.pending email matches /me) or the
 *                                       user explicitly confirms (opts.confirm / config.confirmSignIn /
 *                                       window.confirm). Never trusts the URL alone.
 *   BT.auth.session()                   → {email, pro, expires} | null  (from 'bt.auth')
 *   BT.auth.isPro()                     boolean
 *   BT.auth.refresh()                   re-reads /me and updates the stored session
 *   BT.auth.signOut()
 *   BT.auth.checkout(plan)              → redirects to Stripe Checkout; plan 'monthly'|'annual'
 *   BT.auth.issueCertificate({name})    → {id, url, local:boolean, ...}
 *   BT.auth.verify(id)                  → {found, verified, local, record} | {found:false}
 *   BT.auth.localCertificates()         self-issued certificates stored in this browser
 *   BT.auth.leaderboard(code) / submitScore(entry)
 *     Anonymous submissions receive an `ownerToken` from the server; it is kept in
 *     localStorage `bt.auth.lbToken` and sent back so the same browser can update its row.
 *
 * Pure helpers (testable in Node): isCertId, normalizeCertId, localCertId,
 * isLocalCertId, sessionValid, parseHash, isEmail, apiUrl.
 *
 * Storage keys: 'bt.auth' (session), 'bt.auth.certs' (local certificates),
 * 'bt.auth.pending' (email awaiting a magic link, valid for PENDING_TTL_MS).
 *
 * Security note (login CSRF / session fixation): a URL fragment is attacker
 * controllable — anyone can send a student a link ending in #session=<their id>.
 * So handleCallback() never stores a token straight from the URL. It first asks
 * /me who the token belongs to (without saving it), then requires either a
 * pending sign-in on this device for that exact email, or an explicit yes from
 * the user. Rejected tokens are revoked via POST /auth/signout so a planted
 * session dies instead of lingering.
 *
 * Plain ES2020, no imports; never touches the DOM except location/history when
 * the page itself asks for a redirect or a callback is handled.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  var auth = BT.auth = BT.auth || {};

  var DEFAULT_CONFIG = { apiBase: '', proGating: false, prices: { monthly: 9, annual: 79, currency: 'USD' }, sessionDays: 30, supportEmail: '', siteUrl: '', confirmSignIn: null };
  if (!auth.config || typeof auth.config !== 'object') auth.config = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) { if (!(k in auth.config)) auth.config[k] = DEFAULT_CONFIG[k]; });

  var KEY_SESSION = 'bt.auth';
  var KEY_CERTS = 'bt.auth.certs';
  var KEY_PENDING = 'bt.auth.pending';
  var PENDING_TTL_MS = 60 * 60 * 1000;   // a magic link lives 15 min server-side; allow slow inboxes
  var MSG_WRONG_ACCOUNT = 'This sign-in link was for a different account. Nothing was changed on this device — request a new link with your own email.';
  var MSG_DECLINED = 'Sign-in cancelled. That link was not requested from this device, so it was not used.';
  var MSG_UNCONFIRMED = 'This sign-in link was not requested from this device. Open the link on the device where you asked for it, or request a new one here.';
  var NOT_CONFIGURED = 'The membership backend is not configured yet. Everything on this site stays free to use without an account.';

  /* ------------------------------------------------------------------ *
   * storage (safe in private windows / Node)
   * ------------------------------------------------------------------ */
  var store = {
    get: function (k, d) { try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function emit(name, detail) {
    try {
      if (root.dispatchEvent && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent(name, { detail: detail }));
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * pure helpers
   * ------------------------------------------------------------------ */
  var CERT_RE = /^BT-(\d{4})-([A-Z0-9]{6})$/;          // server-issued, HMAC-derived
  var LEGACY_RE = /^BT-([0-9A-F]{8})$/;                 // v0.2 js/course.js canvas id
  // Local ids never contain 0/1/O/I so they are easy to read aloud; the server
  // uses the same alphabet. A local id is marked by its leading 'L'.
  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  function normalizeCertId(id) {
    var s = String(id || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[–—_]/g, '-');
    var m = /^BT-?(\d{4})-?([A-Z0-9]{6})$/.exec(s);          // BT2026ABC234 / BT-2026ABC234 → BT-2026-ABC234
    if (m) return 'BT-' + m[1] + '-' + m[2];
    return s.replace(/^BT(?=[0-9A-Z])/, 'BT-');
  }
  function isCertId(id) { var s = normalizeCertId(id); return CERT_RE.test(s) || LEGACY_RE.test(s); }
  function isLocalCertId(id) {
    var s = normalizeCertId(id), m = CERT_RE.exec(s);
    return LEGACY_RE.test(s) || !!(m && m[2].charAt(0) === 'L');
  }
  function fnv(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  /** localCertId({name, date}) → 'BT-YYYY-LXXXXX' — deterministic for the same name + day, never secret. */
  function localCertId(opts) {
    opts = opts || {};
    var d = opts.date instanceof Date ? opts.date : (opts.date ? new Date(opts.date) : new Date());
    if (isNaN(d.getTime())) d = new Date();
    var year = d.getUTCFullYear();
    var day = d.toISOString().slice(0, 10);
    var h = fnv(String(opts.name || 'student').trim().toLowerCase() + '|' + day + '|' + (opts.salt || ''));
    var out = 'L';
    for (var i = 0; i < 5; i++) { out += ALPHABET.charAt(h % ALPHABET.length); h = Math.floor(h / ALPHABET.length) ^ fnv(out); h >>>= 0; }
    return 'BT-' + year + '-' + out;
  }
  function isEmail(s) { s = String(s || '').trim(); return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }
  function sessionValid(s, now) {
    if (!s || typeof s !== 'object' || !s.email) return false;
    var exp = typeof s.expires === 'number' ? s.expires : Date.parse(s.expires);
    if (!isFinite(exp)) return false;
    return exp > (now == null ? Date.now() : now);
  }
  /** parseHash('#session=abc&checkout=success') → {session:'abc', checkout:'success'} */
  function parseHash(hash) {
    var out = {}, h = String(hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    return out;
  }
  function apiUrl(path) {
    var base = String(auth.config.apiBase || '').replace(/\/+$/, '');
    return base + (path.charAt(0) === '/' ? path : '/' + path);
  }
  function configured() { return !!String(auth.config.apiBase || '').trim(); }
  function siteUrl() {
    if (auth.config.siteUrl) return String(auth.config.siteUrl).replace(/\/+$/, '');
    if (root.location && root.location.origin) return root.location.origin + String(root.location.pathname || '/').replace(/[^/]*$/, '').replace(/\/$/, '');
    return '';
  }

  /* ------------------------------------------------------------------ *
   * fetch wrapper
   * ------------------------------------------------------------------ */
  function token() { var s = store.get(KEY_SESSION, null); return s && s.token ? s.token : null; }
  /** api(method, path, body?, opts?) — opts.token overrides the stored bearer (used to probe a
   *  candidate token from a sign-in link WITHOUT saving it). */
  function api(method, path, body, opts) {
    opts = opts || {};
    if (!configured()) return Promise.resolve({ ok: false, status: 0, notConfigured: true, error: NOT_CONFIGURED });
    if (typeof root.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, error: 'fetch is not available in this browser.' });
    var headers = { 'Accept': 'application/json' };
    var t = opts.token || token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var ctrl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    return root.fetch(apiUrl(path), { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), mode: 'cors', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
          if (!res.ok) return { ok: false, status: res.status, error: (data && data.error) || ('Request failed (' + res.status + ')'), data: data };
          return { ok: true, status: res.status, data: data || {} };
        });
      })
      .catch(function (e) {
        var aborted = e && e.name === 'AbortError';
        return { ok: false, status: 0, network: true, error: aborted ? 'The server took too long to answer. Try again in a moment.' : 'Could not reach the membership server. Check your connection, or the API may be down.' };
      })
      .then(function (r) { if (timer) clearTimeout(timer); return r; });
  }

  /* ------------------------------------------------------------------ *
   * sessions
   * ------------------------------------------------------------------ */
  function session() {
    var s = store.get(KEY_SESSION, null);
    if (!sessionValid(s)) { if (s) store.del(KEY_SESSION); return null; }
    return { email: s.email, pro: !!s.pro, expires: s.expires, plan: s.plan || null, proUntil: s.proUntil || null };
  }
  function isPro() { var s = session(); return !!(s && s.pro); }
  function saveSession(me, tok) {
    var prev = store.get(KEY_SESSION, null) || {};
    var exp = me.expires || prev.expires || new Date(Date.now() + (auth.config.sessionDays || 30) * 864e5).toISOString();
    var s = { email: me.email, pro: !!me.pro, plan: me.plan || null, proUntil: me.proUntil || null, expires: exp, token: tok || prev.token || null, savedAt: new Date().toISOString() };
    store.set(KEY_SESSION, s);
    emit('bt:auth', session());
    return session();
  }
  function signOut() {
    var t = token();
    store.del(KEY_SESSION);
    emit('bt:auth', null);
    if (t && configured()) api('POST', '/auth/signout').catch(function () { /* ignore */ });
    return Promise.resolve({ ok: true });
  }
  function signIn(email) {
    email = String(email || '').trim().toLowerCase();
    if (!isEmail(email)) return Promise.resolve({ ok: false, sent: false, error: 'Enter a valid email address.' });
    if (!configured()) return Promise.resolve({ ok: false, sent: false, notConfigured: true, message: NOT_CONFIGURED });
    store.set(KEY_PENDING, { email: email, at: new Date().toISOString() });
    return api('POST', '/auth/magic-link', { email: email, redirect: siteUrl() + '/pricing.html' }).then(function (r) {
      if (!r.ok) return { ok: false, sent: false, error: r.error, status: r.status, network: !!r.network };
      return { ok: true, sent: true, message: 'Check your inbox. The link signs you in on this device and expires in 15 minutes.' };
    });
  }
  function refresh() {
    if (!token()) return Promise.resolve(null);
    return api('GET', '/me').then(function (r) {
      if (r.ok && r.data && r.data.email) return saveSession(r.data);
      if (r.status === 401) { store.del(KEY_SESSION); emit('bt:auth', null); }
      return session();
    });
  }
  function normEmail(e) { return String(e || '').trim().toLowerCase(); }
  /** The sign-in this device asked for, or null when none / too old. */
  function freshPending(now) {
    var p = store.get(KEY_PENDING, null);
    if (!p || !p.email) return null;
    var at = Date.parse(p.at);
    if (!isFinite(at) || (now == null ? Date.now() : now) - at > PENDING_TTL_MS) { store.del(KEY_PENDING); return null; }
    return { email: normEmail(p.email), at: p.at };
  }
  /** Ask the user whether a sign-in that this device did not request may be used.
   *  Resolution order: opts.confirm(email) → config.confirmSignIn(email) → window.confirm.
   *  Resolves to true/false; null when no way to ask exists (treated as "no"). */
  function askConfirm(email, opts) {
    var fn = (opts && typeof opts.confirm === 'function') ? opts.confirm
      : (typeof auth.config.confirmSignIn === 'function') ? auth.config.confirmSignIn : null;
    var text = 'Sign in as ' + email + ' on this device?\n\nOnly continue if you requested this link yourself. If someone sent it to you, choose Cancel.';
    if (!fn && typeof root.confirm === 'function') fn = function () { return root.confirm(text); };
    if (!fn) return Promise.resolve(null);
    return new Promise(function (resolve) {
      try { Promise.resolve(fn(email, text)).then(function (v) { resolve(!!v); }, function () { resolve(false); }); }
      catch (e) { resolve(false); }
    });
  }
  /** Best-effort server-side revocation of a token we decided not to use. */
  function revoke(tok) {
    if (!tok || !configured()) return Promise.resolve();
    return api('POST', '/auth/signout', undefined, { token: tok }).then(function () { /* ignore */ }, function () { /* ignore */ });
  }
  /** Turn a one-time #code= into a session id via POST /auth/exchange → {session, email}. */
  function exchangeCode(code) {
    return api('POST', '/auth/exchange', { code: code }).then(function (r) {
      if (r.ok && r.data && r.data.session) return { ok: true, token: String(r.data.session), email: normEmail(r.data.email) };
      return { ok: false, error: r.error || 'That sign-in link is invalid or has expired. Request a new one.', status: r.status, network: !!r.network };
    });
  }
  /**
   * Called on page load. Handles, in this order of priority:
   *   #auth_error=<msg>      → {handled, error}
   *   #code=<one-time code>  → exchanged for a session id (POST /auth/exchange), then as below
   *   #session=<id>          → legacy form of the magic-link redirect
   *   #checkout=success|cancel
   * A sign-in token is accepted only when /me says it belongs to the email this device asked for
   * (bt.auth.pending), or when the user explicitly confirms. opts.confirm(email) may supply a
   * nicer UI than window.confirm; it may return a boolean or a Promise<boolean>.
   * Results: {handled:false} | {handled, signedIn:true, session, checkout} |
   *          {handled, signedIn:false, error, reason:'invalid'|'wrong-account'|'declined'|'unconfirmed'|'network', email?}
   */
  function handleCallback(opts) {
    opts = opts || {};
    if (!root.location) return Promise.resolve({ handled: false });
    var h = parseHash(root.location.hash);
    if (!h.code && !h.session && !h.checkout && !h.auth_error) return Promise.resolve({ handled: false });
    var clean = function () {
      try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) { /* ignore */ }
    };
    if (h.auth_error) { clean(); return Promise.resolve({ handled: true, error: decodeURIComponent(h.auth_error) }); }
    if (h.code || h.session) {
      // Scrub the URL first so a reload / back-navigation cannot replay the fragment.
      clean();
      if (!configured()) return Promise.resolve({ handled: true, signedIn: false, reason: 'not-configured', error: NOT_CONFIGURED });
      var acquire = h.code ? exchangeCode(String(h.code)) : Promise.resolve({ ok: true, token: String(h.session), email: '' });
      return acquire.then(function (got) {
        if (!got.ok) return { handled: true, signedIn: false, reason: got.network ? 'network' : 'invalid', error: got.error };
        var tok = got.token;
        // Who does this token belong to? Ask the server WITHOUT storing the token.
        return api('GET', '/me', undefined, { token: tok }).then(function (r) {
          if (!r.ok || !r.data || !r.data.email) {
            return { handled: true, signedIn: false, reason: r.network ? 'network' : 'invalid', error: r.network ? r.error : 'That sign-in link is invalid or has expired. Request a new one.' };
          }
          var me = r.data, email = normEmail(me.email);
          if (got.email && got.email !== email) { revoke(tok); return { handled: true, signedIn: false, reason: 'invalid', error: 'Sign-in link mismatch. Request a new one.' }; }
          var accept = function () {
            store.del(KEY_PENDING);
            var s = saveSession(me, tok);
            return { handled: true, signedIn: true, session: s, checkout: h.checkout || null };
          };
          var pending = freshPending();
          if (pending) {
            if (pending.email === email) return accept();
            // This device asked for a link for someone else — the URL was planted or mixed up.
            revoke(tok);
            return { handled: true, signedIn: false, reason: 'wrong-account', email: email, expected: pending.email, error: MSG_WRONG_ACCOUNT };
          }
          // No pending sign-in here. If the same person is already signed in on this device this is
          // just a refresh; otherwise (cross-device click, or a planted link) the user must say yes.
          var cur = session();
          if (cur && normEmail(cur.email) === email) return accept();
          return askConfirm(email, opts).then(function (yes) {
            if (yes === true) return accept();
            revoke(tok);
            if (yes === null) return { handled: true, signedIn: false, reason: 'unconfirmed', email: email, error: MSG_UNCONFIRMED };
            return { handled: true, signedIn: false, reason: 'declined', email: email, error: MSG_DECLINED };
          });
        });
      });
    }
    clean();
    if (h.checkout === 'success') return refresh().then(function (s) { return { handled: true, checkout: 'success', session: s }; });
    return Promise.resolve({ handled: true, checkout: h.checkout });
  }

  /* ------------------------------------------------------------------ *
   * billing
   * ------------------------------------------------------------------ */
  function checkout(plan) {
    plan = plan === 'annual' ? 'annual' : 'monthly';
    if (!configured()) return Promise.resolve({ ok: false, notConfigured: true, message: NOT_CONFIGURED });
    if (!session()) return Promise.resolve({ ok: false, error: 'Sign in first so we know which account to upgrade.' });
    var back = siteUrl() + '/pricing.html';
    return api('POST', '/checkout', { plan: plan, successUrl: back + '#checkout=success', cancelUrl: back + '#checkout=cancel' }).then(function (r) {
      if (!r.ok) return { ok: false, error: r.error, status: r.status };
      if (r.data && r.data.url && root.location) { root.location.assign(r.data.url); }
      return { ok: true, url: r.data && r.data.url };
    });
  }

  /* ------------------------------------------------------------------ *
   * certificates
   * ------------------------------------------------------------------ */
  function localCertificates() { var l = store.get(KEY_CERTS, []); return Array.isArray(l) ? l : []; }
  function rememberLocal(rec) {
    var list = localCertificates().filter(function (c) { return c.id !== rec.id; });
    list.unshift(rec);
    store.set(KEY_CERTS, list.slice(0, 20));
  }
  function courseSnapshot() {
    var C = BT.course, modules = [], scorePct = null;
    try {
      if (C && C.getIndex && C.getIndex()) {
        var idx = C.getIndex(), scores = [];
        (idx.modules || []).forEach(function (m) {
          var mp = C.moduleProgress ? C.moduleProgress(m.id) : null;
          modules.push({ id: m.id, title: m.title, done: !!(mp && mp.total && mp.done === mp.total) });
          if (C.certificateStatus) { /* quiz averages are inside certificateStatus */ }
        });
        if (C.certificateStatus) {
          var st = C.certificateStatus();
          (st.modules || []).forEach(function (m) { if (typeof m.quizAvg === 'number') scores.push(m.quizAvg); });
          modules = (st.modules || []).map(function (m) { return { id: m.id, title: m.title, done: !!m.ok, quizAvg: m.quizAvg }; });
        }
        if (scores.length) scorePct = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
      }
    } catch (e) { /* course not loaded on this page */ }
    return { modules: modules, scorePct: scorePct };
  }
  /** issueCertificate({name, modules?, scorePct?}) → {id, url, local, name, issuedAt, verified} */
  function issueCertificate(opts) {
    opts = opts || {};
    var name = String(opts.name || '').trim();
    if (!name) return Promise.resolve({ ok: false, error: 'Enter the name that should appear on the certificate.' });
    var snap = courseSnapshot();
    var modules = opts.modules || snap.modules;
    var scorePct = opts.scorePct != null ? opts.scorePct : snap.scorePct;
    var issuedAt = new Date().toISOString();
    var localRec = function (reason) {
      var id = localCertId({ name: name, date: issuedAt });
      var rec = { id: id, name: name, issuedAt: issuedAt, modules: modules, scorePct: scorePct, local: true, verified: false };
      rememberLocal(rec);
      return Object.assign({ ok: true, url: siteUrl() + '/verify.html?id=' + encodeURIComponent(id), reason: reason || null }, rec);
    };
    if (!configured() || !session()) return Promise.resolve(localRec(configured() ? 'not-signed-in' : 'not-configured'));
    return api('POST', '/certificates', { name: name, modules: modules, scorePct: scorePct }).then(function (r) {
      if (!r.ok || !r.data || !r.data.id) return localRec(r.error || 'server-error');
      var rec = { id: r.data.id, name: r.data.name || name, issuedAt: r.data.issuedAt || issuedAt, modules: r.data.modules || modules, scorePct: r.data.scorePct != null ? r.data.scorePct : scorePct, local: false, verified: true };
      rememberLocal(rec);
      return Object.assign({ ok: true, url: r.data.url || (siteUrl() + '/verify.html?id=' + encodeURIComponent(rec.id)) }, rec);
    });
  }
  /** verify(id) → {found, verified, local, record:{id,name,issuedAt,modules,scorePct}} */
  function verify(id) {
    var norm = normalizeCertId(id);
    if (!isCertId(norm)) return Promise.resolve({ found: false, invalid: true, id: norm, error: 'That does not look like a certificate id. Expected the form BT-2026-ABC234.' });
    var local = localCertificates().filter(function (c) { return c.id === norm; })[0] || null;
    var localResult = function (extra) {
      if (local) return Object.assign({ found: true, verified: false, local: true, id: norm, record: local }, extra || {});
      if (isLocalCertId(norm)) return Object.assign({ found: false, local: true, id: norm, selfIssued: true, error: 'This id was self-issued in a browser and is not stored on a server, so it cannot be verified.' }, extra || {});
      return Object.assign({ found: false, id: norm }, extra || {});
    };
    if (isLocalCertId(norm) || !configured()) return Promise.resolve(localResult(configured() ? {} : { notConfigured: true }));
    return api('GET', '/verify/' + encodeURIComponent(norm)).then(function (r) {
      if (r.ok && r.data && r.data.found) return { found: true, verified: true, local: false, id: norm, record: r.data.record || r.data };
      if (r.ok || r.status === 404) return localResult();
      return localResult({ error: r.error, network: !!r.network });
    });
  }

  /* ------------------------------------------------------------------ *
   * classroom leaderboard (opt-in)
   * ------------------------------------------------------------------ */
  function leaderboard(classCode) {
    classCode = String(classCode || '').trim().toUpperCase();
    if (!classCode) return Promise.resolve({ ok: false, error: 'Enter a class code.' });
    return api('GET', '/leaderboard?code=' + encodeURIComponent(classCode)).then(function (r) {
      return r.ok ? { ok: true, entries: (r.data && r.data.entries) || [] } : { ok: false, error: r.error, notConfigured: !!r.notConfigured };
    });
  }
  var LB_TOKEN_KEY = 'bt.auth.lbToken';
  function lbToken() { var t = store.get(LB_TOKEN_KEY, null); return typeof t === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(t) ? t : null; }
  function submitScore(entry) {
    entry = entry || {};
    var code = String(entry.classCode || '').trim().toUpperCase(), nick = String(entry.nickname || '').trim();
    if (!code || !nick) return Promise.resolve({ ok: false, error: 'A class code and a nickname are required.' });
    var stats = entry.stats || {};
    var body = { classCode: code, nickname: nick.slice(0, 24), stats: { returnPct: +stats.returnPct || 0, trades: +stats.trades || 0, winRate: +stats.winRate || 0, maxDrawdownPct: +stats.maxDrawdownPct || 0 } };
    // The server keys anonymous rows by a random per-browser token (never by IP). Send ours
    // back so re-submitting the same nickname updates our row instead of being refused (409).
    var tok = lbToken();
    if (tok) body.ownerToken = tok;
    return api('POST', '/leaderboard', body)
      .then(function (r) {
        if (!r.ok) return { ok: false, error: r.error, status: r.status, notConfigured: !!r.notConfigured };
        if (r.data && typeof r.data.ownerToken === 'string' && r.data.ownerToken) store.set(LB_TOKEN_KEY, r.data.ownerToken);
        return { ok: true, entries: (r.data && r.data.entries) || [] };
      });
  }

  /* ------------------------------------------------------------------ *
   * lesson gating helper for js/learn.js
   * ------------------------------------------------------------------ */
  function lessonLocked(lesson) { return !!(auth.config.proGating && lesson && lesson.pro && !isPro()); }

  Object.assign(auth, {
    NOT_CONFIGURED: NOT_CONFIGURED,
    configured: configured, apiUrl: apiUrl, siteUrl: siteUrl,
    signIn: signIn, handleCallback: handleCallback, session: session, isPro: isPro, refresh: refresh, signOut: signOut,
    checkout: checkout,
    issueCertificate: issueCertificate, verify: verify, localCertificates: localCertificates,
    leaderboard: leaderboard, submitScore: submitScore, lbToken: lbToken, LB_TOKEN_KEY: LB_TOKEN_KEY,
    lessonLocked: lessonLocked,
    // pure helpers
    isCertId: isCertId, normalizeCertId: normalizeCertId, localCertId: localCertId, isLocalCertId: isLocalCertId,
    sessionValid: sessionValid, parseHash: parseHash, isEmail: isEmail,
    PENDING_TTL_MS: PENDING_TTL_MS,
    _store: store
  });
})();
