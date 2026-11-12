/* Broward Trading — tests for js/config.js + js/auth.js (BT.auth) and the pure
 * parts of server/worker.js.
 * Run with:  node tests/auth.test.js
 * Plain node + assert, no framework. `window`, `localStorage` and `fetch` are
 * shimmed so the client module runs without a DOM or a network. The Worker is
 * imported as an ES module (Node 22+ detects the syntax) and only its exported
 * `_internal` helpers are exercised: token signing, certificate ids, Stripe
 * signature verification, CORS allow-list. Nothing here talks to the network.
 */
'use strict';
const assert = require('assert');
const path = require('path');

/* ---- shims ------------------------------------------------------------- */
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
const fetchLog = [];
let fetchImpl = null; // set per test
global.window = {
  localStorage: global.localStorage,
  addEventListener() {}, dispatchEvent() {},
  fetch: (url, opts) => { fetchLog.push({ url, opts }); return fetchImpl ? fetchImpl(url, opts) : Promise.reject(new TypeError('Failed to fetch')); },
  location: { origin: 'https://example.github.io', pathname: '/broward-trading/pricing.html', hash: '', search: '' },
  history: { replaceState() {} }
};
require(path.join(__dirname, '..', 'js', 'config.js'));
require(path.join(__dirname, '..', 'js', 'auth.js'));
const A = window.BT.auth;

let passed = 0, failed = 0;
// Tests share localStorage and the fake fetch, so they run strictly one after another.
let chain = Promise.resolve();
function report(name, e) {
  if (!e) { passed++; console.log('  ok   ' + name); return; }
  failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
}
function test(name, fn) {
  chain = chain.then(() => Promise.resolve().then(fn).then(() => report(name), e => report(name, e)));
  return chain;
}
function jsonRes(status, body) { return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) }); }

console.log('BT.auth tests');

/* ---- config ------------------------------------------------------------ */
test('config.js seeds BT.auth.config with the contract defaults and a BT.config alias', () => {
  assert.strictEqual(A.config.apiBase, '');
  assert.strictEqual(A.config.proGating, false);
  assert.strictEqual(window.BT.config, A.config);
  assert.deepStrictEqual(Object.keys(A.config.prices).sort(), ['annual', 'currency', 'monthly']);
  assert.strictEqual(A.configured(), false);
});

test('module exposes the contract surface', () => {
  ['signIn', 'session', 'isPro', 'signOut', 'checkout', 'issueCertificate', 'verify', 'handleCallback', 'refresh',
    'isCertId', 'normalizeCertId', 'localCertId', 'isLocalCertId', 'sessionValid', 'parseHash', 'isEmail', 'lessonLocked']
    .forEach(k => assert.strictEqual(typeof A[k], 'function', 'missing ' + k));
});

/* ---- certificate id format -------------------------------------------- */
test('isCertId accepts BT-YYYY-XXXXXX and the legacy 8-hex id, rejects everything else', () => {
  assert.ok(A.isCertId('BT-2026-ABC234'));
  assert.ok(A.isCertId('BT-2026-LK7Q2M'));
  assert.ok(A.isCertId('BT-1A2B3C4D'), 'legacy course.js id');
  assert.ok(!A.isCertId('BT-2026-ABC23'), 'too short');
  assert.ok(!A.isCertId('BT-2026-ABC2345'), 'too long');
  assert.ok(!A.isCertId('BT-26-ABC234'), 'two-digit year');
  assert.ok(!A.isCertId('XX-2026-ABC234'));
  assert.ok(!A.isCertId(''));
  assert.ok(!A.isCertId(null));
});

test('normalizeCertId uppercases, trims, strips spaces and repairs a missing first dash', () => {
  assert.strictEqual(A.normalizeCertId('  bt-2026-abc234 '), 'BT-2026-ABC234');
  assert.strictEqual(A.normalizeCertId('BT 2026 ABC234'), 'BT-2026-ABC234', 'spaces instead of dashes');
  assert.strictEqual(A.normalizeCertId('bt2026abc234'), 'BT-2026-ABC234', 'compact form');
  assert.strictEqual(A.normalizeCertId('bt2026-abc234'), 'BT-2026-ABC234');
  assert.strictEqual(A.normalizeCertId('BT–2026–ABC234'), 'BT-2026-ABC234', 'en dashes');
  assert.ok(A.isCertId(A.normalizeCertId('bt-2026-abc234')));
});

test('localCertId produces BT-YYYY-LXXXXX, deterministic per name+day, unique per name', () => {
  const d = new Date('2026-03-15T14:00:00Z');
  const a = A.localCertId({ name: 'Ada Lovelace', date: d });
  assert.match(a, /^BT-2026-L[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/, a);
  assert.strictEqual(A.localCertId({ name: ' ada lovelace ', date: new Date('2026-03-15T23:59:00Z') }), a, 'case/space/time insensitive within a day');
  assert.notStrictEqual(A.localCertId({ name: 'Grace Hopper', date: d }), a);
  assert.notStrictEqual(A.localCertId({ name: 'Ada Lovelace', date: new Date('2026-03-16T00:00:00Z') }), a, 'different day');
  assert.ok(A.isCertId(a));
  assert.ok(A.isLocalCertId(a));
  assert.ok(!A.isLocalCertId('BT-2026-ABC234'));
  assert.ok(A.isLocalCertId('BT-1A2B3C4D'), 'legacy ids count as self-issued');
  assert.ok(!/[01OI]/.test(a.slice(8)), 'no ambiguous characters in the code part');
});

test('localCertId tolerates bad dates and a missing name', () => {
  const id = A.localCertId({ date: 'not a date' });
  assert.match(id, /^BT-\d{4}-L[A-Z2-9]{5}$/);
  assert.strictEqual(A.localCertId({}).slice(0, 3), 'BT-');
});

/* ---- session expiry ---------------------------------------------------- */
test('sessionValid checks presence, email and expiry (ISO string or epoch ms)', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.strictEqual(A.sessionValid(null, now), false);
  assert.strictEqual(A.sessionValid({}, now), false);
  assert.strictEqual(A.sessionValid({ email: 'a@b.co' }, now), false, 'no expiry');
  assert.strictEqual(A.sessionValid({ email: 'a@b.co', expires: '2026-01-02T00:00:00Z' }, now), true);
  assert.strictEqual(A.sessionValid({ email: 'a@b.co', expires: '2025-12-31T23:59:59Z' }, now), false);
  assert.strictEqual(A.sessionValid({ email: 'a@b.co', expires: now + 1000 }, now), true);
  assert.strictEqual(A.sessionValid({ email: 'a@b.co', expires: now }, now), false, 'expiry equal to now is expired');
  assert.strictEqual(A.sessionValid({ email: 'a@b.co', expires: 'garbage' }, now), false);
});

test('session() returns the public shape for a live session and null + cleanup for an expired one', () => {
  localStorage.clear();
  assert.strictEqual(A.session(), null);
  assert.strictEqual(A.isPro(), false);
  const future = new Date(Date.now() + 86400000).toISOString();
  localStorage.setItem('bt.auth', JSON.stringify({ email: 'student@example.edu', pro: true, expires: future, token: 'secret-token' }));
  const s = A.session();
  assert.deepStrictEqual(Object.keys(s).sort(), ['email', 'expires', 'plan', 'pro', 'proUntil']);
  assert.strictEqual(s.email, 'student@example.edu');
  assert.strictEqual(s.pro, true);
  assert.ok(!('token' in s), 'token is never exposed');
  assert.strictEqual(A.isPro(), true);
  localStorage.setItem('bt.auth', JSON.stringify({ email: 'student@example.edu', pro: true, expires: new Date(Date.now() - 1000).toISOString() }));
  assert.strictEqual(A.session(), null);
  assert.strictEqual(localStorage.getItem('bt.auth'), null, 'expired session removed');
  assert.strictEqual(A.isPro(), false);
});

test('signOut clears the session without a network call when not configured', () => {
  localStorage.setItem('bt.auth', JSON.stringify({ email: 'x@y.co', pro: false, expires: new Date(Date.now() + 1e6).toISOString(), token: 't' }));
  const before = fetchLog.length;
  return A.signOut().then(() => {
    assert.strictEqual(A.session(), null);
    assert.strictEqual(fetchLog.length, before);
  });
});

/* ---- parseHash / isEmail ----------------------------------------------- */
test('parseHash decodes session and checkout fragments', () => {
  assert.deepStrictEqual(A.parseHash('#session=abc%2Fdef&checkout=success'), { session: 'abc/def', checkout: 'success' });
  assert.deepStrictEqual(A.parseHash(''), {});
  assert.deepStrictEqual(A.parseHash('#/lesson/m1-l1'), { '/lesson/m1-l1': '' }, 'learn.html style hashes do not throw');
});

test('isEmail is strict enough for a sign-in form', () => {
  assert.ok(A.isEmail('student@broward.edu'));
  assert.ok(A.isEmail('first.last+tag@sub.example.co'));
  assert.ok(!A.isEmail('nope'));
  assert.ok(!A.isEmail('a@b'));
  assert.ok(!A.isEmail('a b@c.com'));
  assert.ok(!A.isEmail(''));
});

/* ---- not-configured behaviour ----------------------------------------- */
test('signIn / checkout / verify behave gracefully with no apiBase (no fetch)', () => {
  localStorage.clear();
  const before = fetchLog.length;
  return A.signIn('student@example.edu').then(r => {
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.notConfigured, true);
    assert.ok(/not configured/i.test(r.message));
    return A.signIn('bad');
  }).then(r => {
    assert.strictEqual(r.ok, false);
    assert.ok(/valid email/i.test(r.error));
    return A.checkout('annual');
  }).then(r => {
    assert.strictEqual(r.notConfigured, true);
    return A.verify('BT-2026-ABC234');
  }).then(r => {
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.notConfigured, true);
    assert.strictEqual(fetchLog.length, before, 'no network traffic');
  });
});

test('issueCertificate falls back to a local id and verify() reports it as self-issued', () => {
  localStorage.clear();
  return A.issueCertificate({ name: 'Ada Lovelace', modules: [{ id: 'm1', title: 'Markets', done: true, quizAvg: 90 }], scorePct: 90 }).then(r => {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.local, true);
    assert.strictEqual(r.verified, false);
    assert.strictEqual(r.reason, 'not-configured');
    assert.ok(A.isLocalCertId(r.id), r.id);
    assert.ok(r.url.endsWith('/verify.html?id=' + encodeURIComponent(r.id)), r.url);
    assert.strictEqual(A.localCertificates().length, 1);
    return A.verify(r.id.toLowerCase()).then(v => {
      assert.strictEqual(v.found, true);
      assert.strictEqual(v.local, true);
      assert.strictEqual(v.verified, false);
      assert.strictEqual(v.record.name, 'Ada Lovelace');
      assert.strictEqual(v.record.modules.length, 1);
    });
  }).then(() => A.verify('BT-2026-LZZZZZ')).then(v => {
    assert.strictEqual(v.found, false);
    assert.strictEqual(v.selfIssued, true);
  }).then(() => A.verify('garbage')).then(v => {
    assert.strictEqual(v.found, false);
    assert.strictEqual(v.invalid, true);
  }).then(() => A.issueCertificate({ name: '' })).then(r => {
    assert.strictEqual(r.ok, false);
  });
});

/* ---- configured behaviour (fake fetch) --------------------------------- */
test('with apiBase set: signIn posts to /auth/magic-link and verify() GETs /verify/:id', () => {
  localStorage.clear();
  A.config.apiBase = 'https://api.example.workers.dev/';
  assert.strictEqual(A.apiUrl('/me'), 'https://api.example.workers.dev/me', 'trailing slash trimmed');
  fetchImpl = (url, opts) => {
    if (url.endsWith('/auth/magic-link')) {
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.email, 'student@example.edu');
      assert.strictEqual(body.redirect, 'https://example.github.io/broward-trading/pricing.html');
      return jsonRes(200, { ok: true, sent: true });
    }
    if (url.endsWith('/verify/BT-2026-ABC234')) return jsonRes(200, { found: true, record: { id: 'BT-2026-ABC234', name: 'Grace Hopper', issuedAt: '2026-02-01T00:00:00Z', modules: [], scorePct: 95 } });
    if (url.endsWith('/verify/BT-2026-ZZZZZZ')) return jsonRes(404, { found: false });
    return jsonRes(500, { error: 'boom' });
  };
  return A.signIn('Student@Example.edu').then(r => {
    assert.strictEqual(r.sent, true);
    assert.deepStrictEqual(JSON.parse(localStorage.getItem('bt.auth.pending')).email, 'student@example.edu');
    return A.verify('bt-2026-abc234');
  }).then(v => {
    assert.strictEqual(v.found, true);
    assert.strictEqual(v.verified, true);
    assert.strictEqual(v.local, false);
    assert.strictEqual(v.record.name, 'Grace Hopper');
    return A.verify('BT-2026-ZZZZZZ');
  }).then(v => {
    assert.strictEqual(v.found, false);
    assert.strictEqual(v.selfIssued, undefined);
    return A.verify('BT-2026-LABCDE');
  }).then(v => {
    assert.strictEqual(v.local, true, 'local ids never hit the network');
  });
});

function meFor(email, extra) {
  // /me answers for whichever bearer token is presented: tokens map to emails.
  return (tokens) => (url, opts) => {
    const auth = (opts.headers && opts.headers.Authorization) || '';
    const tok = auth.replace(/^Bearer /, '');
    if (url.endsWith('/me')) {
      if (tokens[tok]) return jsonRes(200, Object.assign({ email: tokens[tok], pro: true, plan: 'annual', expires: new Date(Date.now() + 30 * 864e5).toISOString() }, extra || {}));
      return jsonRes(401, { error: 'Not signed in.' });
    }
    if (url.endsWith('/auth/signout')) { fetchLog.revoked = (fetchLog.revoked || []).concat(tok); return jsonRes(200, { ok: true }); }
    return jsonRes(404, {});
  };
}
function setPending(email, ageMs) { localStorage.setItem('bt.auth.pending', JSON.stringify({ email, at: new Date(Date.now() - (ageMs || 0)).toISOString() })); }

test('handleCallback accepts #session when this device requested a link for the same email, calls /me and cleans the hash', () => {
  localStorage.clear();
  let replaced = 0;
  window.history.replaceState = () => { replaced++; };
  window.confirm = () => { throw new Error('confirm must not be asked when pending matches'); };
  setPending('student@example.edu');
  window.location.hash = '#session=tok123';
  fetchImpl = meFor()({ tok123: 'student@example.edu' });
  return A.handleCallback().then(r => {
    assert.strictEqual(r.handled, true);
    assert.strictEqual(r.signedIn, true);
    assert.strictEqual(r.session.email, 'student@example.edu');
    assert.strictEqual(A.isPro(), true);
    assert.strictEqual(JSON.parse(localStorage.getItem('bt.auth')).token, 'tok123');
    assert.strictEqual(localStorage.getItem('bt.auth.pending'), null, 'pending consumed');
    assert.ok(replaced >= 1, 'hash cleaned');
    window.location.hash = '';
    return A.handleCallback();
  }).then(r => {
    assert.strictEqual(r.handled, false);
  });
});

test('handleCallback with an invalid token signs nobody in and never stores the token', () => {
  localStorage.clear();
  setPending('student@example.edu');
  window.location.hash = '#session=bad';
  fetchImpl = () => jsonRes(401, { error: 'Not signed in.' });
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(r.reason, 'invalid');
    assert.ok(/invalid|expired|signed/i.test(r.error));
    assert.strictEqual(A.session(), null);
    assert.strictEqual(localStorage.getItem('bt.auth'), null, 'nothing persisted');
    window.location.hash = '';
  });
});

test('SECURITY: a planted #session for another account is rejected when this device asked for a different email', () => {
  localStorage.clear(); fetchLog.revoked = [];
  setPending('victim@example.edu');
  window.confirm = () => true; // even a careless "yes" must not be consulted here
  window.location.hash = '#session=attacker-sess';
  fetchImpl = meFor()({ 'attacker-sess': 'attacker@evil.example' });
  return A.handleCallback().then(r => {
    assert.strictEqual(r.handled, true);
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(r.reason, 'wrong-account');
    assert.match(r.error, /different account/i);
    assert.strictEqual(A.session(), null);
    assert.strictEqual(localStorage.getItem('bt.auth'), null, 'attacker token never written');
    assert.deepStrictEqual(fetchLog.revoked, ['attacker-sess'], 'planted session revoked server-side');
    window.location.hash = '';
  });
});

test('SECURITY: a #session with no pending sign-in requires explicit confirmation; declining stores nothing and revokes', () => {
  localStorage.clear(); fetchLog.revoked = [];
  let asked = null;
  window.confirm = (text) => { asked = text; return false; };
  window.location.hash = '#session=attacker-sess';
  fetchImpl = meFor()({ 'attacker-sess': 'attacker@evil.example' });
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(r.reason, 'declined');
    assert.strictEqual(r.email, 'attacker@evil.example');
    assert.match(asked, /Sign in as attacker@evil\.example on this device\?/);
    assert.strictEqual(A.session(), null);
    assert.strictEqual(localStorage.getItem('bt.auth'), null);
    assert.deepStrictEqual(fetchLog.revoked, ['attacker-sess']);
    window.location.hash = '';
  });
});

test('cross-device sign-in: confirming via opts.confirm (async) signs in; config.confirmSignIn is used when opts absent', () => {
  localStorage.clear();
  window.confirm = () => { throw new Error('window.confirm must not be used when a custom confirm exists'); };
  window.location.hash = '#session=phone-sess';
  fetchImpl = meFor()({ 'phone-sess': 'student@example.edu' });
  return A.handleCallback({ confirm: (email) => Promise.resolve(email === 'student@example.edu') }).then(r => {
    assert.strictEqual(r.signedIn, true);
    assert.strictEqual(A.session().email, 'student@example.edu');
    // now with config.confirmSignIn declining for a different account
    localStorage.clear();
    A.config.confirmSignIn = () => false;
    window.location.hash = '#session=other-sess';
    fetchImpl = meFor()({ 'other-sess': 'other@example.edu' });
    return A.handleCallback();
  }).then(r => {
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(r.reason, 'declined');
    assert.strictEqual(A.session(), null);
    A.config.confirmSignIn = null;
    window.location.hash = '';
  });
});

test('no way to confirm (no window.confirm, no hooks) → the link is refused, not silently accepted', () => {
  localStorage.clear();
  const saved = window.confirm; delete window.confirm;
  window.location.hash = '#session=x-sess';
  fetchImpl = meFor()({ 'x-sess': 'someone@example.edu' });
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(r.reason, 'unconfirmed');
    assert.strictEqual(A.session(), null);
    window.confirm = saved; window.location.hash = '';
  });
});

test('a stale pending sign-in (older than PENDING_TTL_MS) counts as absent and so needs confirmation', () => {
  localStorage.clear();
  setPending('student@example.edu', A.PENDING_TTL_MS + 1000);
  let asked = 0; window.confirm = () => { asked++; return true; };
  window.location.hash = '#session=tok9';
  fetchImpl = meFor()({ tok9: 'student@example.edu' });
  return A.handleCallback().then(r => {
    assert.strictEqual(asked, 1);
    assert.strictEqual(r.signedIn, true);
    window.location.hash = '';
  });
});

test('refresh case: the same email already signed in on this device needs no confirmation', () => {
  localStorage.clear();
  localStorage.setItem('bt.auth', JSON.stringify({ email: 'student@example.edu', pro: false, token: 'old', expires: new Date(Date.now() + 864e5).toISOString() }));
  window.confirm = () => { throw new Error('no prompt expected'); };
  window.location.hash = '#session=new-tok';
  fetchImpl = meFor()({ 'new-tok': 'student@example.edu' });
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, true);
    assert.strictEqual(JSON.parse(localStorage.getItem('bt.auth')).token, 'new-tok');
    window.location.hash = '';
  });
});

test('#code= is exchanged via POST /auth/exchange for the session id; the code itself is never used as a bearer', () => {
  localStorage.clear();
  setPending('student@example.edu');
  window.location.hash = '#code=onetime42';
  const inner = meFor()({ 'sess-from-code': 'student@example.edu' });
  fetchImpl = (url, opts) => {
    if (url.endsWith('/auth/exchange')) {
      assert.strictEqual(opts.method, 'POST');
      assert.deepStrictEqual(JSON.parse(opts.body), { code: 'onetime42' });
      assert.strictEqual(opts.headers.Authorization, undefined);
      return jsonRes(200, { session: 'sess-from-code', email: 'student@example.edu' });
    }
    return inner(url, opts);
  };
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, true);
    assert.strictEqual(JSON.parse(localStorage.getItem('bt.auth')).token, 'sess-from-code');
    assert.ok(fetchLog.every(l => !(l.opts.headers.Authorization || '').includes('onetime42')));
    window.location.hash = '';
  });
});

test('#code= exchange failure (expired/replayed) reports an error and stores nothing', () => {
  localStorage.clear();
  setPending('student@example.edu');
  window.location.hash = '#code=used';
  fetchImpl = (url) => url.endsWith('/auth/exchange') ? jsonRes(400, { error: 'Code expired.' }) : jsonRes(404, {});
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(r.reason, 'invalid');
    assert.strictEqual(r.error, 'Code expired.');
    assert.strictEqual(localStorage.getItem('bt.auth'), null);
    window.location.hash = '';
  });
});

test('#code= exchange whose email disagrees with /me is rejected', () => {
  localStorage.clear();
  setPending('student@example.edu');
  window.location.hash = '#code=c1';
  const inner = meFor()({ s1: 'other@example.edu' });
  fetchImpl = (url, opts) => url.endsWith('/auth/exchange') ? jsonRes(200, { session: 's1', email: 'student@example.edu' }) : inner(url, opts);
  return A.handleCallback().then(r => {
    assert.strictEqual(r.signedIn, false);
    assert.strictEqual(A.session(), null);
    window.location.hash = '';
  });
});

test('network failure is reported, never thrown', () => {
  fetchImpl = null; // rejects with TypeError
  return A.signIn('student@example.edu').then(r => {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.network, true);
    assert.ok(/reach|connection/i.test(r.error));
  });
});

test('checkout requires a session, then redirects to the returned URL', () => {
  localStorage.clear();
  let assigned = null;
  window.location.assign = u => { assigned = u; };
  return A.checkout('monthly').then(r => {
    assert.strictEqual(r.ok, false);
    assert.ok(/sign in/i.test(r.error));
    localStorage.setItem('bt.auth', JSON.stringify({ email: 'x@y.co', pro: false, expires: new Date(Date.now() + 1e6).toISOString(), token: 't' }));
    fetchImpl = (url, opts) => {
      assert.ok(url.endsWith('/checkout'));
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.plan, 'annual');
      assert.ok(body.successUrl.endsWith('#checkout=success'));
      return jsonRes(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
    };
    return A.checkout('annual');
  }).then(r => {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(assigned, 'https://checkout.stripe.com/c/pay/cs_test_123');
  });
});

test('lessonLocked respects proGating and Pro status', () => {
  localStorage.clear();
  A.config.proGating = false;
  assert.strictEqual(A.lessonLocked({ pro: true }), false);
  A.config.proGating = true;
  assert.strictEqual(A.lessonLocked({ pro: true }), true);
  assert.strictEqual(A.lessonLocked({ pro: false }), false);
  localStorage.setItem('bt.auth', JSON.stringify({ email: 'x@y.co', pro: true, expires: new Date(Date.now() + 1e6).toISOString() }));
  assert.strictEqual(A.lessonLocked({ pro: true }), false);
  A.config.proGating = false;
});

/* ---- leaderboard ownerToken ------------------------------------------- */
test('submitScore keeps the anonymous ownerToken and sends it back on later submits', () => {
  localStorage.clear();
  A.config.apiBase = 'https://api.example.workers.dev';
  const bodies = [];
  fetchImpl = (url, opts) => {
    assert.ok(url.endsWith('/leaderboard'));
    const b = JSON.parse(opts.body); bodies.push(b);
    if (b.ownerToken && b.ownerToken !== 'tok_abcdefghijklmnopqrstuvwx') return jsonRes(409, { error: 'That nickname is taken in this class.' });
    return jsonRes(200, { ok: true, code: b.classCode, entries: [{ rank: 1, nickname: b.nickname, stats: b.stats }], ownerToken: 'tok_abcdefghijklmnopqrstuvwx' });
  };
  const entry = { classCode: 'abc-1', nickname: 'Sam', stats: { returnPct: 3.2, trades: 4, winRate: 50, maxDrawdownPct: 2 } };
  return A.submitScore(entry).then(r => {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(bodies[0].ownerToken, undefined, 'first submit has no token yet');
    assert.strictEqual(bodies[0].classCode, 'ABC-1');
    assert.strictEqual(localStorage.getItem('bt.auth.lbToken'), JSON.stringify('tok_abcdefghijklmnopqrstuvwx'), 'token stored');
    assert.strictEqual(A.lbToken(), 'tok_abcdefghijklmnopqrstuvwx');
    return A.submitScore(entry);
  }).then(r => {
    assert.strictEqual(r.ok, true, 'same browser may update its row');
    assert.strictEqual(bodies[1].ownerToken, 'tok_abcdefghijklmnopqrstuvwx', 'token sent back');
    // a signed-in response carries no ownerToken: the stored one must survive untouched
    fetchImpl = () => jsonRes(200, { ok: true, entries: [] });
    return A.submitScore(entry);
  }).then(r => {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(A.lbToken(), 'tok_abcdefghijklmnopqrstuvwx');
    // garbage in storage is ignored, not sent
    localStorage.setItem('bt.auth.lbToken', JSON.stringify('bad token!'));
    assert.strictEqual(A.lbToken(), null);
    fetchImpl = (url, opts) => { assert.strictEqual(JSON.parse(opts.body).ownerToken, undefined); return jsonRes(200, { ok: true, entries: [] }); };
    return A.submitScore(entry);
  }).then(r => { assert.strictEqual(r.ok, true); A.config.apiBase = ''; localStorage.clear(); });
});

/* ---- server/worker.js pure helpers ------------------------------------- */
const workerTests = (async () => {
  let W;
  try { W = (await import(path.join(__dirname, '..', 'server', 'worker.js')))._internal; }
  catch (e) { console.log('  (skipping worker tests: ' + e.message.split('\n')[0] + ')'); return; }
  chain = chain.then(() => console.log('server/worker.js helper tests'));

  test('worker: HS256 token round-trips, rejects tampering and expiry', async () => {
    const tok = await W.signToken({ sub: 'a@b.co', jti: 'x1', exp: Math.floor(Date.now() / 1000) + 60, typ: 'magic' }, 'secret');
    assert.strictEqual(tok.split('.').length, 3);
    const p = await W.verifyToken(tok, 'secret');
    assert.strictEqual(p.sub, 'a@b.co');
    assert.strictEqual(await W.verifyToken(tok, 'other'), null, 'wrong secret');
    assert.strictEqual(await W.verifyToken(tok.slice(0, -2) + 'AA', 'secret'), null, 'tampered signature');
    const expired = await W.signToken({ sub: 'a@b.co', exp: Math.floor(Date.now() / 1000) - 1 }, 'secret');
    assert.strictEqual(await W.verifyToken(expired, 'secret'), null);
    assert.strictEqual(await W.verifyToken('garbage', 'secret'), null);
  });

  test('worker: certificate ids are BT-YYYY-XXXXXX, HMAC-derived, never start with L', async () => {
    const id = await W.certificateId('secret', { email: 'a@b.co', name: 'Ada', issuedAt: '2026-05-01T00:00:00Z' });
    assert.match(id, W.CERT_RE, id);
    assert.ok(id.startsWith('BT-2026-'));
    assert.notStrictEqual(id.slice(8, 9), 'L');
    assert.strictEqual(await W.certificateId('secret', { email: 'a@b.co', name: 'Ada', issuedAt: '2026-05-01T00:00:00Z' }), id, 'deterministic');
    assert.notStrictEqual(await W.certificateId('secret2', { email: 'a@b.co', name: 'Ada', issuedAt: '2026-05-01T00:00:00Z' }), id, 'depends on secret');
    assert.notStrictEqual(await W.certificateId('secret', { email: 'a@b.co', name: 'Ada', issuedAt: '2026-05-01T00:00:00Z', nonce: 'n' }), id, 'nonce changes it');
    // the L-avoidance path
    const forced = W.idFromBytes(new Uint8Array([W.CERT_ALPHABET.indexOf('L'), 0, 0, 0, 0, 0]), 2026);
    assert.notStrictEqual(forced.slice(8, 9), 'L');
    assert.ok(A.isCertId(id) && !A.isLocalCertId(id), 'client recognises a server id as verified-style');
  });

  test('worker: Stripe signature verification (valid, wrong secret, stale timestamp, bad header)', async () => {
    const body = '{"id":"evt_1","type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = W.hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
    assert.strictEqual(await W.verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test'), true);
    assert.strictEqual(await W.verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${sig}`, 'whsec_test'), true, 'any v1 may match');
    assert.strictEqual(await W.verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_other'), false);
    assert.strictEqual(await W.verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_test'), false, 'body changed');
    assert.strictEqual(await W.verifyStripeSignature(body, `t=${t - 1000},v1=${sig}`, 'whsec_test'), false, 'stale');
    assert.strictEqual(await W.verifyStripeSignature(body, '', 'whsec_test'), false);
    assert.strictEqual(await W.verifyStripeSignature(body, `v1=${sig}`, 'whsec_test'), false, 'no timestamp');
  });

  test('worker: CORS allow-list only answers listed origins', () => {
    const env = { ALLOWED_ORIGINS: 'https://me.github.io, http://localhost:8080/' };
    const req = o => ({ headers: { get: k => (k === 'Origin' ? o : null) } });
    assert.strictEqual(W.corsHeaders(req('https://me.github.io'), env)['access-control-allow-origin'], 'https://me.github.io');
    assert.strictEqual(W.corsHeaders(req('http://localhost:8080'), env)['access-control-allow-origin'], 'http://localhost:8080');
    assert.deepStrictEqual(W.corsHeaders(req('https://evil.example'), env), {});
    assert.deepStrictEqual(W.corsHeaders(req(null), env), {}, 'no Origin → no CORS headers (webhooks, link clicks)');
  });

  test('worker: timingSafeEqual, b64url round trip, isProNow grace, leaderboard ranking', () => {
    assert.ok(W.timingSafeEqual('abc', 'abc'));
    assert.ok(!W.timingSafeEqual('abc', 'abd'));
    assert.ok(!W.timingSafeEqual('abc', 'ab'));
    const bytes = new Uint8Array([0, 255, 1, 2, 250]);
    assert.deepStrictEqual([...W.b64urlDecode(W.b64url(bytes))], [...bytes]);
    assert.ok(!/[+/=]/.test(W.b64url(bytes)));
    assert.strictEqual(W.isProNow({ pro: true }), true);
    assert.strictEqual(W.isProNow({ pro: false }), false);
    assert.strictEqual(W.isProNow({ pro: true, proUntil: new Date(Date.now() - 864e5).toISOString() }), true, 'inside 3-day grace');
    assert.strictEqual(W.isProNow({ pro: true, proUntil: new Date(Date.now() - 5 * 864e5).toISOString() }), false, 'past grace');
    const ranked = W.rankEntries([
      { nickname: 'a', stats: { returnPct: 5, maxDrawdownPct: 10 } },
      { nickname: 'b', stats: { returnPct: 12, maxDrawdownPct: 20 } },
      { nickname: 'c', stats: { returnPct: 5, maxDrawdownPct: 4 } }
    ]);
    assert.deepStrictEqual(ranked.map(e => e.nickname), ['b', 'c', 'a']);
    assert.deepStrictEqual(ranked.map(e => e.rank), [1, 2, 3]);
    assert.strictEqual(W.MAGIC_TTL_SEC, 900);
    assert.strictEqual(W.SESSION_TTL_SEC, 30 * 86400);
  });

  /* ---- v0.3 security review fixes ---- */
  function fakeKv(opts = {}) {
    const m = new Map(); let rlPuts = 0; const last = new Map();
    return {
      m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) {
        if (k.startsWith('rl:') && opts.failRlAfter != null && ++rlPuts > opts.failRlAfter) throw new Error('KV PUT failed: 429');
        if (opts.oneWritePerSec) { const t = Date.now(); if (last.has(k) && t - last.get(k) < 1000) throw new Error('KV PUT failed: 429'); last.set(k, t); }
        await new Promise(r => setTimeout(r, 1));
        m.set(k, v);
      },
      async delete(k) { m.delete(k); }
    };
  }
  const req = (ip, extra = {}) => new Request('https://api.example/x', { headers: { 'CF-Connecting-IP': ip, ...extra } });

  test('worker: rate limiter fails CLOSED on KV errors, counts across shards, honours a Rate Limiting binding', async () => {
    // KV refuses the 2nd write → every later call must be rejected, not let through
    const envFail = { TOKENS: fakeKv({ failRlAfter: 1 }) };
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (await W.rateLimit(envFail, req('203.0.113.9'), 'magic', 5)) allowed++;
    assert.strictEqual(allowed, 1, 'only the request before the KV error passes');
    // healthy KV: exactly max pass, shards summed
    const env = { TOKENS: fakeKv() };
    allowed = 0;
    for (let i = 0; i < 20; i++) if (await W.rateLimit(env, req('203.0.113.9'), 'magic', 5)) allowed++;
    assert.strictEqual(allowed, 5);
    assert.ok([...env.TOKENS.m.keys()].every(k => /^rl:magic:[0-9a-f]{64}:\d+:[0-3]$/.test(k)), 'sharded keys');
    assert.ok(await W.rateLimit(env, req('198.51.100.1'), 'magic', 5), 'other IP unaffected');
    // explicit key (per-recipient) and window
    assert.ok(await W.rateLimit(env, req('1.1.1.1'), 'magic-email', 1, { key: 'abc', windowSec: 600 }));
    assert.ok(!(await W.rateLimit(env, req('2.2.2.2'), 'magic-email', 1, { key: 'abc', windowSec: 600 })), 'same recipient from another IP is limited');
    // read-only routes may fail open; write routes never
    const down = { TOKENS: { async get() { throw new Error('down'); }, async put() { throw new Error('down'); }, async delete() {} } };
    assert.strictEqual(await W.rateLimit(down, req('1.1.1.1'), 'verify', 60, { failOpen: true }), true);
    assert.strictEqual(await W.rateLimit(down, req('1.1.1.1'), 'magic', 5), false);
    // binding path
    let calls = 0;
    const envRl = { TOKENS: fakeKv(), RL_MAGIC: { async limit() { calls++; return { success: calls <= 2 }; } } };
    allowed = 0;
    for (let i = 0; i < 5; i++) if (await W.rateLimit(envRl, req('1.1.1.1'), 'magic', 5)) allowed++;
    assert.strictEqual(allowed, 2); assert.strictEqual(calls, 5);
    assert.strictEqual(envRl.TOKENS.m.size, 0, 'binding path writes nothing to KV');
    assert.strictEqual(W.rlBindingName('magic-email'), 'RL_MAGIC_EMAIL');
  });

  test('worker: login code is one-time, 60 s, browser-only, never a bearer', async () => {
    const env = { TOKENS: fakeKv() };
    const code = await W.mintLoginCode(env, 'sess-id-123', 'a@b.co');
    assert.ok(W.LOGIN_CODE_RE.test(code), 'code shape');
    assert.strictEqual(W.LOGIN_CODE_TTL_SEC, 60);
    assert.ok(env.TOKENS.m.has('code:' + code));
    assert.strictEqual(await env.TOKENS.get('session:' + code), null, 'the code is not a session id');
    const post = (body, headers = { Origin: 'https://site.example', 'CF-Connecting-IP': '9.9.9.9' }) =>
      W.postExchange(new Request('https://api.example/auth/exchange', { method: 'POST', headers, body: JSON.stringify(body) }), env);
    let r = await post({ code }, { 'CF-Connecting-IP': '9.9.9.9' });
    assert.strictEqual(r.status, 403, 'missing Origin refused');
    assert.ok(env.TOKENS.m.has('code:' + code), 'refused call does not burn the code');
    r = await post({ code: 'nope' }); assert.strictEqual(r.status, 400);
    r = await post({ code });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), { session: 'sess-id-123', email: 'a@b.co' });
    r = await post({ code }); assert.strictEqual(r.status, 410, 'second use refused');
    assert.ok(!env.TOKENS.m.has('code:' + code));
    // stale record (KV TTL not yet swept) is refused by the timestamp check
    env.TOKENS.m.set('code:' + 'A'.repeat(32), JSON.stringify({ sessionId: 's', email: 'e@f.co', at: Math.floor(Date.now() / 1000) - 120 }));
    r = await post({ code: 'A'.repeat(32) }); assert.strictEqual(r.status, 410);
  });

  test('worker: leaderboard owner is an HMAC and never exposed', async () => {
    const env = { HMAC_SECRET: 'secret' };
    const o = await W.ownerFor(env, 'email', 'a@b.co');
    assert.notStrictEqual(o, await W.sha256('a@b.co'), 'not a reversible plain hash');
    assert.notStrictEqual(o, await W.ownerFor({ HMAC_SECRET: 'other' }, 'email', 'a@b.co'));
    assert.notStrictEqual(o, await W.ownerFor(env, 'token', 'a@b.co'), 'kind is part of the message');
    const pub = W.publicEntries([{ nickname: 'a', stats: { returnPct: 1, maxDrawdownPct: 1 }, owner: 'x', updatedAt: 't' }]);
    assert.deepStrictEqual(Object.keys(pub[0]).sort(), ['nickname', 'rank', 'stats', 'updatedAt']);
    assert.ok(W.OWNER_TOKEN_RE.test('AbC123_-xyzAbC123_-xyz') && !W.OWNER_TOKEN_RE.test('short') && !W.OWNER_TOKEN_RE.test('has space 1234567890123'));
  });

  test('worker: magic link can be claimed exactly once under concurrent callbacks (KV fallback and Durable Object)', async () => {
    // KV fallback: Cloudflare's one-write-per-second-per-key rule is modelled by fakeKv
    const env = { TOKENS: fakeKv({ oneWritePerSec: true }) };
    env.TOKENS.m.set('magic:j1', JSON.stringify({ email: 'a@b.co', redirect: 'https://s/x' }));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => W.claimMagicToken(env, req('10.0.0.' + i), 'j1')));
    assert.strictEqual(results.filter(Boolean).length, 1, 'exactly one winner');
    assert.deepStrictEqual(results.find(Boolean), { email: 'a@b.co', redirect: 'https://s/x' });
    assert.strictEqual(await W.claimMagicToken(env, req('10.0.0.1'), 'j1'), null, 'later callback refused');
    assert.ok(!env.TOKENS.m.has('magic:j1') && env.TOKENS.m.has('magic-used:j1'));
    assert.strictEqual(await W.claimMagicToken(env, req('10.0.0.1'), 'nope'), null, 'unknown jti');
    // Durable Object lock: requests to one object are serialized by the runtime
    const store = new Map(); let alarmAt = null;
    const lock = new W.MagicLock({ storage: { async get(k) { await new Promise(r => setTimeout(r, 1)); return store.get(k); }, async put(k, v) { store.set(k, v); }, async setAlarm(t) { alarmAt = t; }, async deleteAll() { store.clear(); } } });
    let q = Promise.resolve();
    const ns = { idFromName: n => n, get: () => ({ fetch(url, init) { const p = q.then(() => lock.fetch(new Request(url, init))); q = p.catch(() => {}); return p; } }) };
    const env2 = { TOKENS: fakeKv(), MAGIC_LOCK: ns };
    env2.TOKENS.m.set('magic:j2', JSON.stringify({ email: 'c@d.co', redirect: null }));
    const r2 = await Promise.all(Array.from({ length: 12 }, (_, i) => W.claimMagicToken(env2, req('10.0.1.' + i), 'j2')));
    assert.strictEqual(r2.filter(Boolean).length, 1, 'DO: exactly one winner');
    assert.ok(store.get('claim') && alarmAt > Date.now(), 'DO remembers the claim and schedules cleanup');
    await lock.alarm(); assert.strictEqual(store.size, 0);
  });
})();

/* ---- done ---------------------------------------------------------------- */
(async function finish() {
  await workerTests;   // registers its tests on the chain once the module has loaded
  await chain;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
