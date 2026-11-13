/* Broward Trading — tests for js/classroom.js (BT.classroom), js/instructor.js
 * (BT.instructor, including the v0.5 Leagues tab helpers) and the /classes routes of server/worker.js.
 * Run with:  node tests/classroom.test.js
 * Plain node + assert, no framework. `window`, `localStorage` and `fetch` are
 * shimmed. Share codes are round-tripped three ways: with Node's native
 * CompressionStream('deflate-raw'), with CompressionStream removed (plain
 * base64url JSON), and with a zlib-based codec injected to stand in for a
 * browser whose deflate output must still be readable by another browser.
 * The Worker is imported as an ES module and exercised through its exported
 * route()/handlers against an in-memory KV; nothing talks to the network.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const zlib = require('zlib');

/* ---- shims ------------------------------------------------------------- */
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
const fetchLog = [];
let fetchImpl = null;
global.window = {
  localStorage: global.localStorage,
  addEventListener() {}, dispatchEvent() {},
  fetch: (url, opts) => { fetchLog.push({ url, opts }); return fetchImpl ? fetchImpl(url, opts) : Promise.reject(new TypeError('Failed to fetch')); },
  location: { origin: 'https://example.github.io', pathname: '/broward-trading/learn.html', hash: '', search: '' }
};
require(path.join(__dirname, '..', 'js', 'config.js'));
require(path.join(__dirname, '..', 'js', 'auth.js'));
require(path.join(__dirname, '..', 'js', 'classroom.js'));
require(path.join(__dirname, '..', 'js', 'instructor.js'));
const C = window.BT.classroom, I = window.BT.instructor, A = window.BT.auth;

let passed = 0, failed = 0;
let chain = Promise.resolve();
function report(name, e) {
  if (!e) { passed++; console.log('  ok   ' + name); return; }
  failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e));
}
function test(name, fn) { chain = chain.then(() => Promise.resolve().then(fn).then(() => report(name), e => report(name, e))); return chain; }
function jsonRes(status, body) { return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) }); }
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

/** Seed localStorage like a student who did real work in the app. */
function seedStudent() {
  localStorage.clear();
  localStorage.setItem('bt.course', JSON.stringify({ lessonsDone: { 'm1-l1': true, 'm1-l2': true, 'm1-l3': true, 'm2-l1': true, 'm3-l1': false }, quizScores: { 'm1-l1': 80, 'm1-l2': 100, 'm2-l1': 60 }, startedAt: '2026-01-10T12:00:00Z', updatedAt: new Date().toISOString() }));
  localStorage.setItem('bt.replay.sessions', JSON.stringify([
    { id: 'r1', at: Date.now() - 3 * DAY, symbol: 'NVDA', returnPct: 12.5, buyHoldPct: 30, maxDrawdownPct: 4.2, trades: 2, completed: true, drill: { id: 'ride-the-trend-nvda-2023', title: 'Ride the trend', passed: false } },
    { id: 'r2', at: Date.now() - 2 * DAY, symbol: 'NVDA', returnPct: 25.1, buyHoldPct: 30, maxDrawdownPct: 6, trades: 3, completed: true, drill: { id: 'ride-the-trend-nvda-2023', title: 'Ride the trend', passed: true } },
    { id: 'r3', at: Date.now() - DAY, symbol: 'TSLA', returnPct: -2, buyHoldPct: 5, maxDrawdownPct: 8, trades: 3, completed: false, drill: { id: 'stop-discipline-tsla-2024', title: 'Stop discipline', passed: false } },
    { id: 'r4', at: Date.now(), symbol: 'SPY', returnPct: 1, buyHoldPct: 0, maxDrawdownPct: 1, trades: 1, completed: true, drill: null }
  ]));
  localStorage.setItem('bt.portfolio', JSON.stringify({ cash: 90000, startingCash: 100000, positions: { AAPL: { qty: 50, avg: 200 } }, orders: [], realized: 500,
    trades: [{ id: 1, closedQty: 0, realized: 0, time: Date.now() - DAY }, { id: 2, closedQty: 10, realized: 300, time: Date.now() - DAY }, { id: 3, closedQty: 10, realized: -100, time: Date.now() }, { id: 4, closedQty: 5, realized: 300, time: Date.now() }],
    equityHistory: [{ t: Date.now() - DAY, equity: 100100 }, { t: Date.now(), equity: 101234.5 }] }));
  localStorage.setItem('bt.journal', JSON.stringify({ version: 1, entries: [
    { id: 'j1', date: dayAgo(1), setup: 'Breakout', emotion: 'calm', lessons: 'Wait for the first pullback after a gap, every time.' },
    { id: 'j2', date: dayAgo(2), setup: '', emotion: '', lessons: '' },
    { id: 'j3', date: dayAgo(3), setup: 'Trend pullback', emotion: 'fomo', lessons: 'short' }
  ], reviews: { '2026-W05': { done: true }, '2026-W06': { done: true } } }));
  const hist = {}; hist[today()] = { score: 4, total: 5 }; hist[dayAgo(1)] = { score: 5, total: 5 }; hist[dayAgo(2)] = { score: 3, total: 5 }; hist[dayAgo(5)] = { score: 5, total: 5 };
  localStorage.setItem('bt.daily5', JSON.stringify({ version: 1, history: hist, best: 3 }));
}

console.log('BT.classroom tests');

/* ---- codes & ids ------------------------------------------------------- */
test('module exposes the contract surface', () => {
  ['studentId', 'join', 'leave', 'status', 'snapshot', 'encodeShare', 'decodeShare', 'parseShareCodes', 'sync', 'normalizeCode', 'isValidCode', 'newCode'].forEach(k => assert.strictEqual(typeof C[k], 'function', 'missing ' + k));
  assert.strictEqual(C.KEY, 'bt.classroom');
  assert.strictEqual(C.PREFIX, 'BT1.');
  assert.strictEqual(C.SYNC_INTERVAL_MS, 5 * 60 * 1000);
});

test('class codes: 6 chars, no 0/1/O/I, normalised from sloppy input', () => {
  for (let i = 0; i < 50; i++) { const c = C.newCode(); assert.match(c, /^[23456789A-HJ-NP-Z]{6}$/, c); assert.ok(C.isValidCode(c)); }
  assert.strictEqual(C.normalizeCode(' k7q-2m x '), 'K7Q2MX');
  assert.ok(C.isValidCode('k7q2mx'));
  assert.ok(!C.isValidCode('K7Q2M'), 'too short');
  assert.ok(!C.isValidCode('K7Q2MXX'), 'too long');
  assert.ok(!C.isValidCode('K7O2MX'), 'letter O is not in the alphabet');
  assert.ok(!C.isValidCode('K7Q2M1'), 'digit 1 is not in the alphabet');
  assert.ok(!C.isValidCode(''));
});

test('studentId is random, persisted, never personal; join/leave/status round-trip', () => {
  localStorage.clear();
  const id = C.studentId();
  assert.match(id, /^s-[a-z2-9]{10}$/, id);
  assert.strictEqual(C.studentId(), id, 'stable across calls');
  assert.notStrictEqual(C.studentId(), (localStorage.clear(), C.studentId()), 'a cleared device gets a new id');
  const r = C.join('k7q 2mx', '  Ada   L. ');
  assert.deepStrictEqual(Object.keys(r).sort(), ['code', 'displayName', 'freshId', 'ok', 'studentId']);
  assert.strictEqual(r.freshId, false, 'the existing id is kept on an ordinary join');
  assert.strictEqual(r.code, 'K7Q2MX');
  assert.strictEqual(r.displayName, 'Ada L.');
  const st = C.status();
  assert.strictEqual(st.joined, true); assert.strictEqual(st.code, 'K7Q2MX'); assert.strictEqual(st.backend, false);
  assert.strictEqual(C.join('bad').ok, false);
  assert.match(C.join('K7O2MX').error, /0, O, 1 or I/);
  C.setDisplayName('<b>x</b>'.repeat(20));
  assert.ok(C.status().displayName.length <= 40);
  C.leave();
  assert.strictEqual(C.status().joined, false);
  assert.strictEqual(C.status().studentId, st.studentId, 'leaving keeps the id');
});

/* ---- snapshot ---------------------------------------------------------- */
test('snapshot() reads every store and has the contract shape', () => {
  seedStudent();
  C.join('K7Q2MX', 'Ada');
  const s = C.snapshot();
  ['studentId', 'displayName', 'lessonsDone', 'quizScores', 'drills', 'paper', 'journalEntries', 'streak', 'updatedAt'].forEach(k => assert.ok(k in s, 'missing ' + k));
  assert.strictEqual(s.classCode, 'K7Q2MX');
  assert.deepStrictEqual(s.lessonsDone, ['m1-l1', 'm1-l2', 'm1-l3', 'm2-l1'], 'false entries dropped, sorted');
  assert.deepStrictEqual(s.quizScores, { 'm1-l1': 80, 'm1-l2': 100, 'm2-l1': 60 });
  assert.strictEqual(s.drills.length, 2, 'best attempt per drill; a session without a drill is not a drill');
  const ride = s.drills.find(d => d.id === 'ride-the-trend-nvda-2023');
  assert.strictEqual(ride.passed, true); assert.strictEqual(ride.returnPct, 25.1, 'the passing attempt wins over the earlier failed one');
  assert.strictEqual(s.drills.find(d => d.id === 'stop-discipline-tsla-2024').completed, false);
  assert.strictEqual(s.paper.equity, 101234.5);
  assert.strictEqual(s.paper.returnPct, 1.23);
  assert.strictEqual(s.paper.trades, 3, 'closing fills only');
  assert.strictEqual(s.paper.winRate, 66.7);
  assert.strictEqual(s.paper.fills, 4);
  assert.strictEqual(s.journalEntries, 3);
  assert.strictEqual(s.journal.reviewed, 2);
  assert.strictEqual(s.journal.withLessons, 1, 'a real lesson sentence, not "short"');
  assert.strictEqual(s.journal.weeklyReviews, 2);
  assert.strictEqual(s.streak, 3, 'today, yesterday, two days ago; the gap ends it');
  assert.strictEqual(s.daily.days, 4);
  assert.strictEqual(s.lastActive, today());
  assert.ok(!JSON.stringify(s).includes('Wait for the first pullback'), 'no journal text leaves the device');
  assert.ok(!/email|@/.test(JSON.stringify(s)));
});

test('snapshot() on an empty device is sane (no throws, zeros and nulls)', () => {
  localStorage.clear();
  const s = C.snapshot();
  assert.deepStrictEqual(s.lessonsDone, []); assert.deepStrictEqual(s.quizScores, {}); assert.deepStrictEqual(s.drills, []);
  assert.strictEqual(s.paper.trades, 0); assert.strictEqual(s.paper.equity, null); assert.strictEqual(s.journalEntries, 0); assert.strictEqual(s.streak, 0); assert.strictEqual(s.lastActive, null);
  // legacy journal shape: a bare array
  localStorage.setItem('bt.journal', JSON.stringify([{ id: 'a', date: '2026-02-01', setup: 'x', emotion: 'calm' }]));
  assert.strictEqual(C.snapshot().journalEntries, 1);
  // portfolio without a mark yet: cash + positions at cost
  localStorage.setItem('bt.portfolio', JSON.stringify({ cash: 50000, startingCash: 100000, positions: { AAPL: { qty: 100, avg: 500 } }, trades: [], equityHistory: [] }));
  assert.strictEqual(C.snapshot().paper.equity, 100000);
});

/* ---- share codes ------------------------------------------------------- */
test('share code round-trips with the native CompressionStream (deflate-raw) and is shorter than plain JSON', () => {
  seedStudent(); C.join('K7Q2MX', 'Ada');
  assert.strictEqual(typeof CompressionStream, 'function', 'Node 22 has CompressionStream');
  C.codec.reset();
  const snap = C.snapshot();
  return C.encodeShare(snap).then(code => {
    assert.ok(code.startsWith('BT1.'));
    assert.match(code, /^BT1\.[A-Za-z0-9_-]+$/, 'base64url only: safe in a text message');
    assert.ok(code.length < ('BT1.' + Buffer.from(JSON.stringify(snap)).toString('base64')).length, 'compressed');
    return C.decodeShare(code).then(r => {
      assert.strictEqual(r.ok, true); assert.strictEqual(r.compressed, true);
      assert.deepStrictEqual(r.snapshot, snap);
    });
  });
});

test('share code round-trips WITHOUT CompressionStream (plain base64url JSON) and the compressed reader still accepts it', () => {
  seedStudent(); C.join('K7Q2MX', 'Ada');
  const snap = C.snapshot();
  const savedC = global.CompressionStream, savedD = global.DecompressionStream;
  global.CompressionStream = undefined; global.DecompressionStream = undefined;
  C.codec.reset();
  assert.strictEqual(C.codec.available(), false);
  return C.encodeShare(snap).then(plain => {
    assert.strictEqual(plain, 'BT1.' + Buffer.from(JSON.stringify(snap)).toString('base64url'), 'exactly base64url of the JSON');
    return C.decodeShare(plain).then(r => {
      assert.strictEqual(r.ok, true); assert.strictEqual(r.compressed, false); assert.deepStrictEqual(r.snapshot, snap);
      global.CompressionStream = savedC; global.DecompressionStream = savedD;
      return C.decodeShare(plain);                    // a modern browser reading an old browser's code
    }).then(r => { assert.strictEqual(r.ok, true); assert.strictEqual(r.compressed, false); assert.deepStrictEqual(r.snapshot, snap); });
  }).finally(() => { global.CompressionStream = savedC; global.DecompressionStream = savedD; });
});

test('a code deflated by an injected zlib codec decodes with the native one and vice versa', () => {
  seedStudent(); C.join('K7Q2MX', 'Grace');
  const snap = C.snapshot();
  const zcodec = { deflate: b => Promise.resolve(new Uint8Array(zlib.deflateRawSync(Buffer.from(b)))), inflate: b => Promise.resolve(new Uint8Array(zlib.inflateRawSync(Buffer.from(b)))) };
  C.codec.use(zcodec);
  return C.encodeShare(snap).then(zcode => {
    C.codec.reset();
    return C.decodeShare(zcode).then(r => { assert.strictEqual(r.ok, true); assert.strictEqual(r.compressed, true); assert.deepStrictEqual(r.snapshot, snap); })
      .then(() => C.encodeShare(snap)).then(native => { C.codec.use(zcodec); return C.decodeShare(native); })
      .then(r => { assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.snapshot, snap); })
      .then(() => {
        // a compressed code on a browser with no codec at all gets a clear message, not a crash
        const savedC = global.CompressionStream, savedD = global.DecompressionStream;
        global.CompressionStream = undefined; global.DecompressionStream = undefined; C.codec.reset();
        return C.decodeShare(zcode).then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'no-codec'); }).finally(() => { global.CompressionStream = savedC; global.DecompressionStream = savedD; });
      });
  }).finally(() => C.codec.reset());
});

test('decodeShare rejects garbage, truncation and non-snapshots with friendly errors', () => {
  seedStudent(); C.join('K7Q2MX');
  return C.encodeShare().then(code => Promise.all([
    C.decodeShare('hello').then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'format'); }),
    C.decodeShare('').then(r => assert.strictEqual(r.ok, false)),
    C.decodeShare(code.slice(0, 40)).then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'corrupt'); assert.match(r.error, /copy it again/i); }),
    C.decodeShare('BT1.' + Buffer.from('{"hello":1}').toString('base64url')).then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'invalid'); }),
    C.decodeShare('BT1.' + Buffer.from('[1,2]').toString('base64url')).then(r => assert.strictEqual(r.ok, false)),
    C.decodeShare('BT1.' + 'A'.repeat(70000)).then(r => assert.strictEqual(r.reason, 'too-long'))
  ]));
});

test('parseShareCodes finds every code in a pasted blob and dedupes', () => {
  const a = 'BT1.' + 'a'.repeat(20), b = 'BT1.' + 'b_-9'.repeat(5);
  const text = 'From: Ada\n' + a + '\n\nOk here is mine: ' + b + ', and again ' + a + ' thanks. BT1.short';
  assert.deepStrictEqual(C.parseShareCodes(text), [a, b]);
  assert.deepStrictEqual(C.parseShareCodes(''), []);
  assert.deepStrictEqual(C.parseShareCodes(null), []);
});

/* ---- sync -------------------------------------------------------------- */
test('sync() posts to /classes/:code/snapshots only when joined and configured; throttled to 5 min except lesson/quiz', () => {
  seedStudent(); C.join('K7Q2MX', 'Ada');
  A.config.apiBase = '';
  return C.sync().then(r => {
    assert.strictEqual(r.sent, false); assert.strictEqual(r.skipped, 'no-backend');
    A.config.apiBase = 'https://api.example.workers.dev/';
    fetchLog.length = 0;
    fetchImpl = (url, opts) => {
      assert.strictEqual(url, 'https://api.example.workers.dev/classes/K7Q2MX/snapshots');
      assert.strictEqual(opts.method, 'POST');
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.studentId, C.studentId());
      assert.strictEqual(opts.headers.Authorization, undefined, 'snapshots carry no bearer token');
      return jsonRes(200, { ok: true, className: 'FIN 1100' });
    };
    return C.sync();
  }).then(r => {
    assert.strictEqual(r.ok, true); assert.strictEqual(r.sent, true); assert.strictEqual(fetchLog.length, 1);
    assert.strictEqual(C.status().className, 'FIN 1100');
    assert.ok(C.status().lastSentAt);
    return C.sync();
  }).then(r => {
    assert.strictEqual(r.sent, false); assert.strictEqual(r.skipped, 'throttled'); assert.strictEqual(fetchLog.length, 1);
    return C.sync({ reason: 'lesson' });
  }).then(r => {
    assert.strictEqual(r.sent, true, 'a finished lesson always sends'); assert.strictEqual(fetchLog.length, 2);
    return C.sync({ reason: 'quiz' });
  }).then(r => {
    assert.strictEqual(r.sent, true); assert.strictEqual(fetchLog.length, 3);
    // the server says the instructor removed this student: the device leaves the class
    fetchImpl = () => jsonRes(410, { error: 'removed', removed: true });
    return C.sync({ reason: 'manual' });
  }).then(r => {
    assert.strictEqual(r.removed, true); assert.strictEqual(C.status().joined, false);
    C.join('K7Q2MX'); fetchImpl = null;              // network failure is reported, never thrown
    return C.sync({ force: true });
  }).then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.network, true); A.config.apiBase = ''; });
});

test('sync() keeps the ownerToken the server mints and sends it with every later snapshot; leaving or changing class drops it', () => {
  seedStudent(); C.join('K7Q2MX', 'Ada');
  A.config.apiBase = 'https://api.example.workers.dev/';
  const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let bodies = [];
  fetchImpl = (url, opts) => { bodies.push(JSON.parse(opts.body)); return jsonRes(200, bodies.length === 1 ? { ok: true, className: 'FIN 1100', ownerToken: TOKEN } : { ok: true, className: 'FIN 1100' }); };
  return C.sync({ reason: 'join' }).then(r => {
    assert.strictEqual(r.sent, true); assert.strictEqual(r.ownerToken, true);
    assert.strictEqual(bodies[0].ownerToken, undefined, 'the first snapshot has no token yet');
    assert.strictEqual(C.status().hasOwnerToken, true);
    assert.strictEqual(JSON.parse(localStorage.getItem('bt.classroom')).ownerToken, TOKEN, 'persisted in bt.classroom');
    return C.sync({ reason: 'lesson' });
  }).then(r => {
    assert.strictEqual(r.sent, true);
    assert.strictEqual(bodies[1].ownerToken, TOKEN, 'later snapshots carry the token');
    // a junk token in the response is ignored
    fetchImpl = (url, opts) => { bodies.push(JSON.parse(opts.body)); return jsonRes(200, { ok: true, ownerToken: '<script>' }); };
    return C.sync({ reason: 'quiz' });
  }).then(() => {
    assert.strictEqual(JSON.parse(localStorage.getItem('bt.classroom')).ownerToken, TOKEN, 'a malformed token never replaces a good one');
    // joining a different class forgets the token (it belongs to one class + id pair)
    C.join('MXK7Q2');
    assert.strictEqual(C.status().hasOwnerToken, false);
    C.join('K7Q2MX');
    assert.strictEqual(C.status().hasOwnerToken, false, 'coming back does not resurrect it; the server will refuse or re-bind');
    C.leave();
    const raw = JSON.parse(localStorage.getItem('bt.classroom'));
    assert.strictEqual(raw.ownerToken, null); assert.strictEqual(raw.ownerTokenCode, null);
    A.config.apiBase = ''; fetchImpl = null;
  });
});

test('sync(): 409 {ownerMismatch} is remembered and a rejoin mints a fresh id; 409 {full} is reported; 429 backs off without clearing lastSentAt', () => {
  seedStudent(); C.join('K7Q2MX', 'Ada');
  A.config.apiBase = 'https://api.example.workers.dev/';
  const oldId = C.studentId();
  fetchImpl = () => jsonRes(200, { ok: true, ownerToken: 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' });
  return C.sync({ reason: 'join' }).then(() => {
    fetchImpl = () => jsonRes(409, { error: 'This student id already belongs to another device in this class.', ownerMismatch: true });
    return C.sync({ reason: 'lesson' });
  }).then(r => {
    assert.strictEqual(r.ok, false); assert.strictEqual(r.ownerMismatch, true); assert.strictEqual(r.status, 409);
    assert.strictEqual(C.status().ownerMismatch, true); assert.strictEqual(C.status().hasOwnerToken, false, 'the refused token is dropped');
    assert.strictEqual(C.status().joined, true, 'the student is not thrown out of the class');
    fetchLog.length = 0;
    return C.sync({ reason: 'quiz' });
  }).then(r => {
    assert.strictEqual(r.skipped, 'owner-mismatch'); assert.strictEqual(fetchLog.length, 0, 'no more requests until the student rejoins');
    const j = C.join('K7Q2MX', 'Ada');
    assert.strictEqual(j.ok, true); assert.strictEqual(j.freshId, true); assert.notStrictEqual(C.studentId(), oldId, 'rejoining after a mismatch mints a new id');
    assert.strictEqual(C.status().ownerMismatch, false);
    assert.strictEqual(C.join('K7Q2MX').freshId, false, 'a plain rejoin keeps the id');
    assert.strictEqual(C.join('K7Q2MX', undefined, { freshId: true }).freshId, true, 'and freshId can be asked for explicitly');
    // class full
    fetchImpl = () => jsonRes(409, { error: 'This class is full (500 students).', full: true });
    return C.sync({ reason: 'join' });
  }).then(r => {
    assert.strictEqual(r.ok, false); assert.strictEqual(r.full, true); assert.match(r.error, /full/);
    assert.strictEqual(C.status().ownerMismatch, false, 'a full class is not an ownership problem');
    // rate limited: back off for retryAfterSec, lastSentAt untouched, then recover
    localStorage.setItem('bt.classroom', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('bt.classroom')), { lastSentAt: '2026-01-01T00:00:00Z', lastSentCode: 'K7Q2MX' })));
    fetchImpl = () => jsonRes(429, { error: 'Snapshots are limited to a few per minute.', retryAfterSec: 90 });
    return C.sync({ reason: 'lesson' });
  }).then(r => {
    assert.strictEqual(r.ok, false); assert.strictEqual(r.rateLimited, true); assert.strictEqual(r.retryAfterSec, 90);
    const st = C.status();
    assert.strictEqual(st.lastSentAt, '2026-01-01T00:00:00Z', '429 is not a successful send');
    const until = Date.parse(st.backoffUntil); assert.ok(until > Date.now() + 80e3 && until <= Date.now() + 91e3, 'backoffUntil ≈ now + 90 s: ' + st.backoffUntil);
    fetchLog.length = 0;
    return C.sync({ reason: 'quiz' });
  }).then(r => {
    assert.strictEqual(r.skipped, 'backoff'); assert.strictEqual(r.rateLimited, true); assert.ok(r.retryAfterSec > 0); assert.strictEqual(fetchLog.length, 0, 'nothing is sent during the back-off');
    fetchImpl = () => jsonRes(200, { ok: true });
    return C.sync({ force: true });
  }).then(r => {
    assert.strictEqual(r.sent, true, 'force overrides the back-off'); assert.strictEqual(C.status().backoffUntil, null, 'a success clears it');
    // an expired back-off is ignored on the next ordinary sync
    localStorage.setItem('bt.classroom', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('bt.classroom')), { backoffUntil: new Date(Date.now() - 1000).toISOString() })));
    return C.sync({ reason: 'lesson' });
  }).then(r => {
    assert.strictEqual(r.sent, true);
    // 429 without a body falls back to 60 s
    fetchImpl = () => Promise.resolve({ ok: false, status: 429, headers: { get: () => null }, text: () => Promise.resolve('') });
    return C.sync({ reason: 'lesson' });
  }).then(r => {
    assert.strictEqual(r.retryAfterSec, 60);
    A.config.apiBase = ''; fetchImpl = null; C.leave();
  });
});

test('hookCourse wraps BT.course.markDone / recordQuiz so completions trigger a sync', () => {
  let calls = 0;
  window.BT.course = { markDone(id) { calls++; return { lessonsDone: { [id]: true } }; }, recordQuiz() { calls++; return {}; } };
  assert.strictEqual(C.hookCourse(), true);
  assert.strictEqual(C.hookCourse(), false, 'only once');
  const r = window.BT.course.markDone('m1-l1');
  assert.deepStrictEqual(r.lessonsDone, { 'm1-l1': true }, 'original return value preserved');
  window.BT.course.recordQuiz('m1-l1', 90);
  assert.strictEqual(calls, 2);
  delete window.BT.course;
});

/* ---- instructor engine ------------------------------------------------- */
console.log('BT.instructor tests');
let snapAda, snapGrace, snapEmpty;
test('createClass / setActive / deleteClass; codes are valid and unique on the device', () => {
  localStorage.clear(); I.reset();
  assert.strictEqual(I.createClass({ name: 'x' }).ok, false, 'name too short');
  const a = I.createClass({ name: 'FIN 1100 Markets by Doing', section: 'Tue 6pm', term: 'Spring 2027' });
  assert.strictEqual(a.ok, true); assert.ok(C.isValidCode(a.code));
  const b = I.createClass({ name: 'Second', code: 'k7q2mx' });
  assert.strictEqual(b.code, 'K7Q2MX');
  assert.strictEqual(I.createClass({ name: 'Dup', code: 'K7Q2MX' }).ok, false);
  assert.strictEqual(I.classes().length, 2);
  assert.strictEqual(I.active().code, 'K7Q2MX', 'newest is active');
  I.setActive(a.code); assert.strictEqual(I.active().name, 'FIN 1100 Markets by Doing');
  I.load(); assert.strictEqual(I.active().code, a.code, 'persisted');
  assert.strictEqual(I.deleteClass('K7Q2MX'), true); assert.strictEqual(I.classes().length, 1);
});

test('addSnapshot keeps the newer snapshot and never lets an older paste overwrite it', () => {
  seedStudent(); C.join('K7Q2MX', 'Ada');
  snapAda = C.snapshot();
  localStorage.clear(); C.join('K7Q2MX', 'Grace');
  // Every lesson in the live course index (m1…m9) done with 90 % — so the fixture keeps up when modules are added.
  const ALL_LESSONS = require(path.join(__dirname, '..', 'course', 'index.json')).modules.flatMap(m => m.lessons.map(l => l.id));
  localStorage.setItem('bt.course', JSON.stringify({ lessonsDone: Object.fromEntries(ALL_LESSONS.map(id => [id, true])), quizScores: Object.fromEntries(ALL_LESSONS.map(id => [id, 90])), updatedAt: new Date(Date.now() - 10 * DAY).toISOString() }));
  localStorage.setItem('bt.replay.sessions', JSON.stringify(I.DEFAULT_REQUIRED.map((id, i) => ({ id: 'g' + i, at: Date.now() - 10 * DAY, returnPct: 5, completed: true, drill: { id, title: id, passed: true } }))));
  localStorage.setItem('bt.journal', JSON.stringify({ entries: Array.from({ length: 12 }, (_, i) => ({ id: 'e' + i, date: dayAgo(12), setup: 'Breakout', emotion: 'calm' })), reviews: { a: 1, b: 1, c: 1, d: 1 } }));
  const hist = {}; for (let i = 10; i < 45; i++) hist[dayAgo(i)] = { score: 5, total: 5 };
  localStorage.setItem('bt.daily5', JSON.stringify({ history: hist }));
  snapGrace = C.snapshot();
  localStorage.clear(); C.join('K7Q2MX'); snapEmpty = C.snapshot();

  localStorage.clear(); I.reset();
  const cls = I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' }).cls;
  assert.strictEqual(I.addSnapshot('K7Q2MX', snapAda).status, 'added');
  assert.strictEqual(I.addSnapshot('K7Q2MX', snapGrace).status, 'added');
  assert.strictEqual(I.addSnapshot('K7Q2MX', snapEmpty).status, 'added');
  const older = Object.assign({}, snapAda, { updatedAt: new Date(Date.now() - DAY).toISOString(), lessonsDone: [] });
  assert.strictEqual(I.addSnapshot('K7Q2MX', older).status, 'older');
  assert.strictEqual(cls.students[snapAda.studentId].lessonsDone.length, 4, 'kept the newer one');
  const newer = Object.assign({}, snapAda, { updatedAt: new Date(Date.now() + 1000).toISOString(), lessonsDone: snapAda.lessonsDone.concat(['m2-l2']) });
  assert.strictEqual(I.addSnapshot('K7Q2MX', newer).status, 'updated');
  assert.strictEqual(I.addSnapshot('K7Q2MX', { studentId: 'no spaces allowed' }).status, 'invalid');
  assert.strictEqual(I.addSnapshot('NOPE22', snapAda).status, 'no-class');
  assert.strictEqual(cls.names[snapAda.studentId], 'Ada', 'display name becomes the default label');
  snapAda = newer;
});

test('importShareCodes decodes many codes from one paste and reports per-code failures', () => {
  return Promise.all([C.encodeShare(snapAda), C.encodeShare(snapGrace)]).then(([a, g]) => {
    localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
    return I.importShareCodes('K7Q2MX', 'Ada: ' + a + '\nGrace sent ' + g + '\nbroken: ' + a.slice(0, 30) + '\n');
  }).then(r => {
    assert.strictEqual(r.found, 3); assert.strictEqual(r.added, 2); assert.strictEqual(r.failed.length, 1);
    assert.deepStrictEqual(r.mismatched, []);
    return I.importShareCodes('K7Q2MX', 'nothing here');
  }).then(r => { assert.strictEqual(r.found, 0); assert.match(r.error, /BT1\./); return I.importShareCodes('ZZZZZZ', 'x'); })
    .then(r => assert.match(r.error, /select a class/i));
});

test('roster rows: progress %, quiz avg, drills, paper, journal, staleness; sorting with nulls last', () => {
  localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
  I.setCourseIndex(require(path.join(__dirname, '..', 'course', 'index.json')));
  [snapAda, snapGrace, snapEmpty].forEach(s => I.addSnapshot('K7Q2MX', s));
  const rows = I.roster('K7Q2MX');
  assert.strictEqual(rows.length, 3);
  const ada = rows.find(r => r.id === snapAda.studentId), grace = rows.find(r => r.id === snapGrace.studentId), empty = rows.find(r => r.id === snapEmpty.studentId);
  assert.strictEqual(ada.name, 'Ada');
  assert.ok(ada.lessonsTotal >= 40, 'index gives the lesson total');
  assert.strictEqual(ada.lessonsDone, 5);
  assert.strictEqual(ada.progressPct, Math.round(5 / ada.lessonsTotal * 100));
  assert.strictEqual(ada.quizAvg, 80); assert.strictEqual(ada.quizzes, 3);
  assert.strictEqual(ada.drillsPassed, 1); assert.strictEqual(ada.drillsAttempted, 2); assert.strictEqual(ada.drillsRequiredPassed, 1);
  assert.strictEqual(ada.paperReturnPct, 1.23); assert.strictEqual(ada.paperTrades, 3);
  assert.strictEqual(ada.journalEntries, 3); assert.strictEqual(ada.journalReviewed, 2); assert.strictEqual(ada.weeklyReviews, 2);
  assert.strictEqual(ada.streak, 3); assert.strictEqual(ada.stale, false);
  assert.strictEqual(grace.progressPct, 100, 'every lesson in the index is done');
  assert.strictEqual(grace.drillsRequiredPassed, 6, 'capped at the required count even with 7 passed');
  assert.strictEqual(grace.stale, true, 'ten days without activity');
  assert.match(empty.name, /^Student /);
  assert.strictEqual(empty.quizAvg, null); assert.strictEqual(empty.paperReturnPct, null);
  // sorting
  const byQuizDesc = I.roster('K7Q2MX', { sort: 'quiz', dir: 'desc' }).map(r => r.id);
  assert.deepStrictEqual(byQuizDesc, [snapGrace.studentId, snapAda.studentId, snapEmpty.studentId]);
  const byQuizAsc = I.roster('K7Q2MX', { sort: 'quiz', dir: 'asc' }).map(r => r.id);
  assert.deepStrictEqual(byQuizAsc, [snapAda.studentId, snapGrace.studentId, snapEmpty.studentId], 'nulls sink in both directions');
  assert.deepStrictEqual(I.roster('K7Q2MX', { q: 'gra' }).map(r => r.name), ['Grace']);
  const sum = I.summary('K7Q2MX');
  assert.strictEqual(sum.students, 3); assert.strictEqual(sum.stale, 1);
  assert.strictEqual(sum.activeThisWeek, 2, 'Ada worked today; the empty student still synced today (opened the app); Grace is stale');
  // module breakdown
  const mods = I.moduleBreakdown(snapAda);
  assert.strictEqual(mods[0].id, 'm1-foundations'); assert.strictEqual(mods[0].done, 3); assert.strictEqual(mods[0].total, 5); assert.strictEqual(mods[0].pct, 60); assert.strictEqual(mods[0].quizAvg, 90);
  assert.strictEqual(mods[1].done, 2); assert.strictEqual(mods[1].quizAvg, 60);
  assert.strictEqual(I.moduleOf('m9-l3'), 'm9-crypto-etf', 'm9 is in the index');
  assert.strictEqual(I.moduleOf('m12-l3'), 'm12', 'unknown module ids still group');
});

test('gradebook: Teaching Guide weights, automatic components, manual overrides, letters, incompleteness', () => {
  assert.deepStrictEqual(I.weights(), { quizzes: 20, drills: 20, journal: 20, forward: 10, capstone: 25, participation: 5 });
  assert.strictEqual(I.weightsTotal(), 100);
  const cls = I.getClass('K7Q2MX');
  const g = I.grade(snapGrace, cls);
  assert.strictEqual(g.components.quizzes.points, 18, '90% on every quiz → 18/20');
  assert.strictEqual(g.components.drills.points, 20, 'six required drills passed');
  assert.strictEqual(g.components.journal.points, 20, 'all reviewed + 4 weekly reviews');
  assert.strictEqual(g.components.participation.points, 5, '35 Daily 5 days ≥ 30');
  assert.strictEqual(g.components.forward.points, null); assert.strictEqual(g.components.capstone.points, null);
  assert.strictEqual(g.complete, false); assert.deepStrictEqual(g.missing, ['forward', 'capstone']);
  assert.strictEqual(g.total, 63); assert.strictEqual(g.pct, 63); assert.strictEqual(g.letter, 'D');
  I.setManual('K7Q2MX', snapGrace.studentId, { forward: 9, capstone: 99, note: 'Excellent plan' });
  const g2 = I.grade(snapGrace, cls);
  assert.strictEqual(g2.components.capstone.points, 25, 'clamped to the weight');
  assert.strictEqual(g2.components.capstone.source, 'manual');
  assert.strictEqual(g2.complete, true); assert.strictEqual(g2.total, 97); assert.strictEqual(g2.letter, 'A'); assert.strictEqual(g2.note, 'Excellent plan');
  I.setManual('K7Q2MX', snapGrace.studentId, { quizzes: 10 });
  assert.strictEqual(I.grade(snapGrace, cls).components.quizzes.points, 10, 'auto can be overridden');
  I.setManual('K7Q2MX', snapGrace.studentId, { quizzes: '' });
  assert.strictEqual(I.grade(snapGrace, cls).components.quizzes.points, 18, 'clearing restores auto');
  const ga = I.grade(snapAda, cls);
  assert.strictEqual(ga.components.quizzes.points, Math.round(240 / (I.lessonsTotal(snapAda) * 100) * 20 * 10) / 10, 'untaken quizzes count as zero');
  assert.strictEqual(ga.components.drills.points, Math.round((1 + 0.2) / 6 * 20 * 10) / 10, 'pass = 1, started = 0.2');
  assert.strictEqual(ga.components.journal.points, Math.round((0.5 * 2 / 3 + 0.5 * 0.5) * 20 * 10) / 10);
  assert.strictEqual(I.grade(snapEmpty, cls).total, 0);
  // weights are editable
  I.setWeights({ capstone: 30, participation: 0 });
  assert.strictEqual(I.weightsTotal(), 100);
  assert.strictEqual(I.grade(snapGrace, cls).components.capstone.points, 25, 'manual points survive a weight change while within the new max');
  I.setWeights(I.DEFAULT_WEIGHTS);
  ['A', 'B', 'C', 'D', 'F'].forEach((l, i) => assert.strictEqual(I.letter(95 - i * 10), l));
  // required drill rules
  I.setRequiredDrills(['ride-the-trend-nvda-2023', 'stop-discipline-tsla-2024'], 2);
  assert.strictEqual(I.grade(snapAda, cls).components.drills.points, 12, '(1 + 0.2)/2 × 20');
  I.setRequiredDrills(I.DEFAULT_REQUIRED, 6);
});

test('CSV export: one row per student, formula-safe cells, quotes escaped; JSON backup restores', () => {
  const cls = I.getClass('K7Q2MX');
  I.renameStudent('K7Q2MX', snapEmpty.studentId, '=HYPERLINK("x"), "Bob"');
  const csv = I.csvRoster('K7Q2MX');
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 4);
  assert.ok(lines[0].startsWith('name,student_id,progress_pct,lessons_done,lessons_total,quiz_avg_pct'));
  assert.ok(lines.some(l => l.startsWith('"\'=HYPERLINK(""x""), ""Bob"""')), 'formula neutralised and quoted: ' + lines[1]);
  assert.ok(lines.some(l => l.startsWith('Ada,' + snapAda.studentId + ',')));
  const gb = I.csvGradebook('K7Q2MX');
  assert.ok(gb.split('\r\n')[0].includes('capstone_pts (/25)'));
  assert.ok(gb.includes('A') && gb.includes('(incomplete)'));
  assert.strictEqual(I.csvCell(null), ''); assert.strictEqual(I.csvCell('a,b'), '"a,b"'); assert.strictEqual(I.csvCell('-5'), "'-5"); assert.strictEqual(I.csvCell(-5), "'-5", 'negative numbers are text-prefixed too (spreadsheets still parse them)');
  // backup → wipe → restore
  const backup = I.exportJson('K7Q2MX');
  const parsed = JSON.parse(backup);
  assert.strictEqual(parsed.kind, 'instructor-backup'); assert.strictEqual(parsed.classes.length, 1);
  localStorage.clear(); I.reset();
  assert.strictEqual(I.classes().length, 0);
  assert.strictEqual(I.importJson('not json').ok, false);
  assert.strictEqual(I.importJson('{"kind":"other"}').ok, false);
  const r = I.importJson(backup);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.added, 1); assert.strictEqual(r.students, 3);
  const back = I.getClass('K7Q2MX');
  assert.strictEqual(back.name, 'FIN 1100');
  assert.strictEqual(I.grade(snapGrace, back).components.forward.manual, 9, 'manual grades survive');
  assert.strictEqual(back.names[snapEmpty.studentId], '=HYPERLINK("x"), "Bob"');
  assert.strictEqual(I.importJson(backup).merged, 1, 'restoring twice merges');
  void cls;
});

test('remote: createRemote stores the instructor token; refreshRoster sends X-Class-Token and merges; removeRemote DELETEs', () => {
  localStorage.clear(); I.reset();
  A.config.apiBase = 'https://api.example.workers.dev';
  fetchLog.length = 0;
  fetchImpl = (url, opts) => {
    if (url.endsWith('/classes') && opts.method === 'POST') { assert.deepStrictEqual(JSON.parse(opts.body), { name: 'Remote class', section: 'A', term: 'T' }); return jsonRes(201, { code: 'MXK7Q2', name: 'Remote class', section: 'A', term: 'T', createdAt: '2026-02-01T00:00:00Z', instructorToken: 'tok_abcdefghijklmnopqrstuvwxyz', ownerKind: 'secret' }); }
    if (url.includes('/classes/MXK7Q2/roster?limit=100')) { assert.strictEqual(opts.headers['X-Class-Token'], 'tok_abcdefghijklmnopqrstuvwxyz'); return jsonRes(200, { ok: true, class: { code: 'MXK7Q2', name: 'Remote class (renamed)' }, students: [snapAda, snapGrace], via: 'token', cursor: null, hasMore: false }); }
    if (url.includes('/students/') && opts.method === 'DELETE') return jsonRes(200, { ok: true, removed: true });
    return jsonRes(404, { error: 'nope' });
  };
  return I.remote.createRemote({ name: 'Remote class', section: 'A', term: 'T' }).then(r => {
    assert.strictEqual(r.ok, true); assert.strictEqual(r.code, 'MXK7Q2'); assert.strictEqual(r.cls.remote, true); assert.strictEqual(r.cls.token, 'tok_abcdefghijklmnopqrstuvwxyz');
    return I.remote.refreshRoster('MXK7Q2');
  }).then(r => {
    assert.strictEqual(r.ok, true); assert.strictEqual(r.added, 2); assert.strictEqual(r.count, 2);
    assert.strictEqual(I.getClass('MXK7Q2').name, 'Remote class (renamed)');
    assert.ok(I.getClass('MXK7Q2').syncedAt);
    return I.remote.removeRemote('MXK7Q2', snapAda.studentId);
  }).then(r => {
    assert.strictEqual(r.ok, true);
    assert.ok(fetchLog[fetchLog.length - 1].url.endsWith('/classes/MXK7Q2/students/' + snapAda.studentId));
    A.config.apiBase = '';
    return I.remote.refreshRoster('MXK7Q2');
  }).then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.notConfigured, true); });
});

test('remote: refreshRoster follows the server cursor until hasMore is false and saves once; removeStudents batches ids by 50 and sweeps {all:true}', () => {
  localStorage.clear(); I.reset(); I.createClass({ name: 'Big class', code: 'MXK7Q2', token: 'tok_abcdefghijklmnopqrstuvwxyz', remote: true });
  A.config.apiBase = 'https://api.example.workers.dev';
  const many = Array.from({ length: 230 }, (_, i) => Object.assign({}, snapAda, { studentId: 's-page' + String(i).padStart(6, '0'), receivedAt: '2026-02-03T10:00:00Z' }));
  const pages = { '': many.slice(0, 100), c1: many.slice(100, 200), c2: many.slice(200) };
  const seen = [];
  fetchLog.length = 0;
  fetchImpl = (url, opts) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/roster') && opts.method === 'GET') {
      assert.strictEqual(u.searchParams.get('limit'), '100');
      const cur = u.searchParams.get('cursor') || ''; seen.push(cur);
      const next = cur === '' ? 'c1' : cur === 'c1' ? 'c2' : null;
      return jsonRes(200, { ok: true, class: { code: 'MXK7Q2', name: 'Big class' }, students: pages[cur], via: 'token', cursor: next, hasMore: !!next });
    }
    if (u.pathname.endsWith('/students') && opts.method === 'DELETE') {
      const body = JSON.parse(opts.body);
      assert.strictEqual(opts.headers['X-Class-Token'], 'tok_abcdefghijklmnopqrstuvwxyz');
      if (body.all === true) { const n = seen.push('all'); return jsonRes(200, { ok: true, removed: 50, ids: many.slice(0, 50).map(s => s.studentId), remaining: n < 5 ? 100 : 0, hasMore: n < 5 }); }
      assert.ok(Array.isArray(body.ids) && body.ids.length <= 50, 'at most 50 ids per call');
      return jsonRes(200, { ok: true, removed: body.ids.length, ids: body.ids, remaining: 0, hasMore: false });
    }
    return jsonRes(404, { error: 'nope' });
  };
  let writes = 0; const realSet = localStorage.setItem;
  localStorage.setItem = function (k, v) { if (k === I.KEY) writes++; return realSet.call(this, k, v); };
  return I.remote.refreshRoster('MXK7Q2').then(r => {
    localStorage.setItem = realSet;
    assert.strictEqual(r.ok, true); assert.strictEqual(r.count, 230); assert.strictEqual(r.added, 230); assert.strictEqual(r.pages, 3);
    assert.deepStrictEqual(seen, ['', 'c1', 'c2'], 'each cursor passed back exactly once');
    assert.strictEqual(Object.keys(I.getClass('MXK7Q2').students).length, 230);
    assert.ok(writes <= 3, 'one save for all pages: ' + writes);
    // a server cursor that never advances cannot loop forever
    fetchImpl = () => jsonRes(200, { ok: true, students: [], cursor: 'same', hasMore: true });
    return I.remote.refreshRoster('MXK7Q2');
  }).then(r => {
    assert.strictEqual(r.ok, true); assert.ok(r.pages <= 20, 'bounded: ' + r.pages);
    fetchImpl = (url, opts) => {
      const u = new URL(url); const body = JSON.parse(opts.body);
      assert.ok(u.pathname.endsWith('/students') && opts.method === 'DELETE');
      assert.ok(Array.isArray(body.ids) && body.ids.length <= 50, 'at most 50 ids per call');
      return jsonRes(200, { ok: true, removed: body.ids.length, ids: body.ids, remaining: 0, hasMore: false });
    };
    return I.remote.removeStudents('MXK7Q2', { ids: many.slice(0, 120).map(s => s.studentId).concat(['__proto__', 'bad id!']) });
  }).then(r => {
    assert.strictEqual(r.ok, true); assert.strictEqual(r.removed, 120); assert.strictEqual(r.calls, 3); assert.strictEqual(r.ids.length, 120);
    seen.length = 0;
    fetchImpl = (url, opts) => { const body = JSON.parse(opts.body); assert.strictEqual(body.all, true); const n = seen.push('all'); return jsonRes(200, { ok: true, removed: 50, ids: [], remaining: n < 5 ? 100 : 0, hasMore: n < 5 }); };
    return I.remote.removeStudents('MXK7Q2', { all: true });
  }).then(r => {
    assert.strictEqual(r.ok, true); assert.strictEqual(r.calls, 5); assert.strictEqual(r.removed, 250); assert.strictEqual(r.remaining, 0);
    return I.remote.removeStudents('MXK7Q2', { ids: [] });
  }).then(r => {
    assert.strictEqual(r.ok, false);
    A.config.apiBase = ''; fetchImpl = null;
  });
});

test('addSnapshot: newer-wins trusts receivedAt over a student-written updatedAt and clamps forged future dates to now', () => {
  localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
  const future = new Date(Date.now() + 365 * DAY).toISOString();
  // a share code claiming to be from next year
  assert.strictEqual(I.addSnapshot('K7Q2MX', Object.assign({}, snapAda, { updatedAt: future, displayName: 'Forged' }), { source: 'share' }).status, 'added');
  // a genuine server record received just now still replaces it
  const now = new Date().toISOString();
  const r = I.addSnapshot('K7Q2MX', Object.assign({}, snapAda, { updatedAt: now, receivedAt: now, displayName: 'Real' }), { source: 'server', allowMismatch: true });
  assert.strictEqual(r.status, 'updated', 'a forged future updatedAt cannot lock the row');
  assert.strictEqual(I.getClass('K7Q2MX').students[snapAda.studentId].displayName, 'Real');
  // an older server record does not overwrite a newer one
  const old = new Date(Date.now() - DAY).toISOString();
  assert.strictEqual(I.addSnapshot('K7Q2MX', Object.assign({}, snapAda, { updatedAt: old, receivedAt: old }), { source: 'server', allowMismatch: true }).status, 'older');
});

test('offline imports are sanitised: HTML/strings in every numeric field become numbers or null (no stored XSS)', () => {
  const XSS = '<img src=x onerror=alert(document.cookie)>';
  const evil = {
    v: '<b>', studentId: 's-evil000001', displayName: '  <b>Eve</b>\u0000 ', classCode: 'K7Q2MX', lessonsDone: ['m1-l1', 'm1-l1', 42, XSS, { a: 1 }],
    quizScores: { 'm1-l1': XSS, 'm1-l2': '95', '__proto__': 100, bad: {} }, lessonsTotal: XSS, startedAt: XSS,
    certificate: { id: XSS + 'x'.repeat(40), date: 'yesterday' },
    drills: [{ id: 'ride-the-trend-nvda-2023', title: XSS, returnPct: XSS, buyHoldPct: [1], maxDrawdownPct: XSS, trades: 'many', passed: 'yes', completed: 0, date: XSS }, { id: '' }, 'junk', null],
    paper: { equity: XSS, startingCash: '1e3', returnPct: XSS, trades: XSS, winRate: 'half', fills: -3, positions: XSS },
    journalEntries: XSS, journal: { reviewed: XSS, weeklyReviews: XSS, lastDate: XSS }, streak: XSS, daily: { days: XSS, best: XSS },
    lastActive: XSS, updatedAt: new Date().toISOString(), receivedAt: '2030-01-01T00:00:00Z', email: 'eve@example.com', extra: XSS
  };
  return C.encodeShare(evil).then(code => {
    localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
    return I.importShareCodes('K7Q2MX', code);
  }).then(r => {
    assert.strictEqual(r.added, 1);
    const s = I.getClass('K7Q2MX').students['s-evil000001'];
    const numOrNull = v => assert.ok(v === null || typeof v === 'number', 'expected number|null, got ' + JSON.stringify(v));
    const d = s.drills[0];
    [d.returnPct, d.buyHoldPct, d.maxDrawdownPct, d.trades, s.lessonsTotal, s.paper.equity, s.paper.startingCash, s.paper.returnPct, s.paper.trades, s.paper.winRate, s.paper.fills, s.paper.positions,
      s.journalEntries, s.journal.reviewed, s.journal.weeklyReviews, s.streak, s.daily.days, s.daily.best].forEach(numOrNull);
    Object.values(s.quizScores).forEach(numOrNull);
    assert.deepStrictEqual(s.quizScores, { 'm1-l2': 95 }, 'non-numeric scores and prototype keys dropped');
    assert.strictEqual(s.drills.length, 1); assert.strictEqual(d.passed, true); assert.strictEqual(d.completed, false); assert.strictEqual(d.date, null);
    assert.strictEqual(s.lessonsDone.length, 2, 'deduped, non-strings dropped'); assert.ok(s.lessonsDone.every(x => typeof x === 'string' && x.length <= 40));
    assert.strictEqual(s.displayName, '<b>Eve</b>', 'names are text (escaped at render time), control chars stripped');
    assert.strictEqual(s.v, 1); assert.strictEqual(s.startedAt, null); assert.strictEqual(s.lastActive, null);
    assert.strictEqual(s.certificate.id.length, 24);
    assert.ok(!('email' in s) && !('extra' in s), 'unknown fields dropped');
    assert.strictEqual(s.receivedAt, undefined, 'a share code cannot forge a server timestamp');
    assert.strictEqual(s.source, 'share'); assert.ok(s.importedAt);
    const row = I.row(s, I.getClass('K7Q2MX'));
    assert.strictEqual(row.receivedAt, null); assert.ok(row.importedAt); assert.strictEqual(row.source, 'share');
    assert.strictEqual(row.paperReturnPct, null); assert.strictEqual(row.journalEntries, 0);
    // the drawer's number formatter never echoes a string back
    const fmtPct = (v, dp) => v == null || !isFinite(+v) ? '—' : (+v).toFixed(dp == null ? 0 : dp) + '%';
    assert.strictEqual(fmtPct(d.maxDrawdownPct, 1), '—');
    // server-sourced snapshots keep receivedAt and take the class's code
    localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
    const srv = I.addSnapshot('K7Q2MX', Object.assign({}, snapAda, { classCode: 'OTHER9', receivedAt: '2026-02-03T10:00:00Z' }), { source: 'server', allowMismatch: true });
    assert.strictEqual(srv.status, 'added');
    const stored = I.getClass('K7Q2MX').students[snapAda.studentId];
    assert.strictEqual(stored.receivedAt, '2026-02-03T10:00:00Z'); assert.strictEqual(stored.source, 'server'); assert.strictEqual(stored.classCode, 'K7Q2MX');
    assert.strictEqual(I.row(stored).receivedAt, '2026-02-03T10:00:00Z');
    // direct sanitizer: a non-object and junk numbers
    assert.strictEqual(I.sanitizeSnapshot(null).studentId, null);
    assert.strictEqual(I.sanitizeSnapshot({ studentId: 's-ok000001', paper: { returnPct: '1e99' } }).paper.returnPct, 1e6, 'clamped');
  });
});

test('reserved ids (__proto__, constructor…) are invalid, so a student cannot hide a record by prototype assignment', () => {
  localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
  ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'].forEach(id => {
    assert.strictEqual(I.validId(id), false, id);
    assert.strictEqual(I.addSnapshot('K7Q2MX', Object.assign({}, snapAda, { studentId: id })).status, 'invalid', id);
  });
  assert.strictEqual(I.validId('s-abc123xyz0'), true);
  const cls = I.getClass('K7Q2MX');
  assert.deepStrictEqual(Object.keys(cls.students), []);
  assert.strictEqual(Object.getPrototypeOf(cls.students), Object.prototype, 'prototype untouched');
  assert.strictEqual(I.removeStudent('K7Q2MX', 'constructor'), false);
  assert.strictEqual(I.renameStudent('K7Q2MX', 'toString', 'x'), null);
  assert.strictEqual(I.setManual('K7Q2MX', 'valueOf', { capstone: 1 }), null);
  // a backup with such ids in names/manual is ignored too
  const r = I.importJson(JSON.stringify({ kind: 'instructor-backup', classes: [{ code: 'K7Q2MX', name: 'FIN 1100', students: { __proto__: snapAda }, names: { __proto__: 'x' }, manual: { constructor: { capstone: 5 } } }] }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.students, 0);
  assert.deepStrictEqual(Object.keys(cls.names), []); assert.deepStrictEqual(Object.keys(cls.manual), []);
});

test('codes made for another class are skipped unless allowMismatch; counted and listed, never merged silently', () => {
  const other = Object.assign({}, snapGrace, { classCode: 'ZZZ999' });
  return Promise.all([C.encodeShare(snapAda), C.encodeShare(other)]).then(([a, g]) => {
    localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
    return I.importShareCodes('K7Q2MX', a + '\n' + g).then(r => {
      assert.strictEqual(r.found, 2); assert.strictEqual(r.added, 1); assert.strictEqual(r.skipped, 1);
      assert.deepStrictEqual(r.mismatched, [snapGrace.studentId]);
      assert.deepStrictEqual(Object.keys(I.getClass('K7Q2MX').students), [snapAda.studentId]);
      assert.strictEqual(r.saved, true);
      return I.importShareCodes('K7Q2MX', g, { allowMismatch: true });
    }).then(r => {
      assert.strictEqual(r.added, 1); assert.strictEqual(r.skipped, 0); assert.deepStrictEqual(r.mismatched, [snapGrace.studentId]);
      assert.strictEqual(I.roster('K7Q2MX').find(x => x.id === snapGrace.studentId).mismatched, true, 'the roster still flags it');
      assert.strictEqual(I.addSnapshot('K7Q2MX', other).status, 'mismatched', 'default addSnapshot refuses too');
    });
  });
});

test('bulk imports persist once and report a failed save instead of swallowing the quota error', () => {
  localStorage.clear(); I.reset(); I.createClass({ name: 'FIN 1100', code: 'K7Q2MX' });
  const realSet = localStorage.setItem; let writes = 0;
  localStorage.setItem = function (k, v) { if (k === I.KEY) writes++; return realSet.call(this, k, v); };
  const many = Array.from({ length: 200 }, (_, i) => Object.assign({}, snapAda, { studentId: 's-bulk' + String(i).padStart(6, '0') }));
  // server refresh path
  A.config.apiBase = 'https://api.example.workers.dev';
  fetchImpl = () => jsonRes(200, { ok: true, students: many, via: 'token' });
  return I.remote.refreshRoster('K7Q2MX').then(r => {
    assert.strictEqual(r.added, 200); assert.strictEqual(r.saved, true);
    assert.ok(writes <= 3, 'one save for the snapshots (+ class meta), not one per student: ' + writes);
    assert.strictEqual(I.saveStatus().ok, true);
    // backup restore path
    writes = 0;
    const backup = I.exportJson('K7Q2MX');
    localStorage.clear(); I.reset();
    const b = I.importJson(backup);
    assert.strictEqual(b.students, 200); assert.strictEqual(b.saved, true);
    assert.ok(writes <= 3, 'backup restore saves once: ' + writes);
    // quota exceeded: save() reports it and saveStatus() flips
    localStorage.setItem = function () { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
    return I.importShareCodes('K7Q2MX', 'x').then(() => C.encodeShare(snapGrace));
  }).then(code => I.importShareCodes('K7Q2MX', code)).then(r => {
    assert.strictEqual(r.added, 1); assert.strictEqual(r.saved, false);
    assert.strictEqual(I.saveStatus().ok, false); assert.ok(I.saveStatus().bytes > 1000);
    localStorage.setItem = realSet;
    assert.strictEqual(I.save(), true); assert.strictEqual(I.saveStatus().ok, true);
    A.config.apiBase = ''; fetchImpl = null;
  });
});

/* ---- v0.5: shareCode alias, league blocks in the snapshot, instructor Leagues tab ---- */
test('shareCode() is the contract alias for encodeShare(snapshot()) and round-trips', async () => {
  seedStudent();
  assert.strictEqual(typeof C.shareCode, 'function');
  const code = await C.shareCode();
  assert.ok(C.looksLikeShare(code));
  const d = await C.decodeShare(code);
  assert.ok(d.ok, d.error);
  assert.strictEqual(d.snapshot.studentId, C.studentId());
  assert.deepStrictEqual(d.snapshot.lessonsDone, C.snapshot().lessonsDone);
  const given = Object.assign(C.snapshot(), { displayName: 'Given' });
  assert.strictEqual((await C.decodeShare(await C.shareCode(given))).snapshot.displayName, 'Given', 'accepts an explicit snapshot too');
});

test('snapshot() has no leagues block without js/leagues.js, or when no league is joined', () => {
  seedStudent();
  assert.ok(!window.BT.leagues, 'leagues.js not loaded yet');
  assert.ok(!('leagues' in C.snapshot()));
  assert.strictEqual(C._internal.leagueState(), null);
});

let LG = null, leagueDef = null;
test('with BT.leagues loaded, snapshot() carries a block per joined league; BT.leagues.snapshot() does not recurse', async () => {
  seedStudent();
  require(path.join(__dirname, '..', 'js', 'leagues.js'));
  LG = window.BT.leagues;
  assert.ok(!('leagues' in C.snapshot()), 'nothing joined yet');
  const start = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10), end = new Date(Date.now() + 21 * DAY).toISOString().slice(0, 10);
  const made = LG.create({ name: 'Period 3 Cup', createdBy: 'Ms. R', startDate: start, endDate: end, preset: 'classroom' });
  assert.ok(made.ok, JSON.stringify(made.errors));
  leagueDef = made.league;
  const j = LG.join(leagueDef, { displayName: 'Ava' });
  assert.ok(j.ok, j.error);
  // trade in the league's own paper account (stored directly: no BT.paper on this page)
  const key = LG._internal.paperKey(leagueDef.code);
  const acct = JSON.parse(localStorage.getItem(key));
  acct.cash = acct.startingCash + 1500;
  acct.trades = [{ id: 1, closedQty: 5, realized: 1500, time: Date.now() }];
  acct.equityHistory = [{ t: Date.now() - 2 * DAY, equity: acct.startingCash }, { t: Date.now() - DAY, equity: acct.startingCash + 600 }];
  localStorage.setItem(key, JSON.stringify(acct));
  const snap = C.snapshot();
  assert.ok(snap.leagues && snap.leagues[leagueDef.code], 'league block present');
  const b = snap.leagues[leagueDef.code];
  assert.strictEqual(b.equity, acct.startingCash + 1500);
  assert.strictEqual(b.trades, 1);
  assert.strictEqual(b.displayName, 'Ava');
  assert.ok(b.returnPct > 0 && Array.isArray(b.equityHistory) && b.equityHistory.length <= LG.MAX_HISTORY);
  const viaLeagues = LG.snapshot();
  assert.deepStrictEqual(Object.keys(viaLeagues.leagues), [leagueDef.code]);
  assert.strictEqual(viaLeagues.leagues[leagueDef.code].equity, b.equity, 'both paths agree');
  // the share code carries it to the organiser
  const d = await C.decodeShare(await C.shareCode());
  assert.strictEqual(d.snapshot.leagues[leagueDef.code].equity, b.equity);
  // a broken BT.leagues never breaks the classroom snapshot
  const savedJoined = LG.joined; LG.joined = () => { throw new Error('boom'); };
  try { assert.ok(!('leagues' in C.snapshot())); } finally { LG.joined = savedJoined; }
});

test('instructor leagues: add a BTL1 code, import share codes, standings via BT.leagues.standings, CSV', async () => {
  assert.ok(I.leagues.available());
  const studentShare = await C.shareCode();
  const leagueCode = LG.encodeLeague(leagueDef);
  // the instructor works on a different device: forget the student's side
  const savedStore = Object.assign({}, store);
  localStorage.clear();
  try {
    assert.deepStrictEqual(I.leagues.list(), []);
    assert.strictEqual(I.leagues.add('hello').ok, false);
    const none = await I.leagues.importShares(leagueDef.code, studentShare);
    assert.ok(none.error && /Add the league first/.test(none.error));
    const added = I.leagues.add('Join our league! ' + leagueCode + ' thanks');
    assert.ok(added.ok && added.added.length === 1 && added.added[0].code === leagueDef.code);
    assert.strictEqual(I.leagues.list().length, 1);
    assert.ok(!LG.membership(leagueDef.code), 'adding a league does not join it');
    // a second student's code with no league block, plus garbage
    const other = await C.encodeShare({ v: 1, studentId: 's-otherkid01', displayName: 'Ben', updatedAt: new Date().toISOString() });
    const r = await I.leagues.importShares(leagueDef.code, studentShare + '\n' + other + '\nBT1.notarealcode!!');
    assert.ok(r.found >= 2, 'both real codes found');
    assert.ok(r.failed.length <= 1);
    assert.strictEqual(r.added, 1);
    assert.strictEqual(r.notInLeague, 1);
    const st = I.leagues.standings(leagueDef.code);
    assert.strictEqual(st.league.code, leagueDef.code);
    assert.strictEqual(st.rows.length, 1);
    assert.strictEqual(st.rows[0].displayName, 'Ava');
    assert.strictEqual(st.rows[0].rank, 1);
    assert.ok(st.rows[0].returnPct > 0);
    assert.ok(['active', 'upcoming', 'ended'].includes(st.phase));
    // re-import is an update, never a duplicate
    const again = await I.leagues.importShares(leagueDef.code, studentShare);
    assert.strictEqual(again.updated + again.skipped, 1);
    assert.strictEqual(I.leagues.standings(leagueDef.code).rows.length, 1);
    // server rows (spark instead of equityHistory) are accepted
    const srv = I.leagues.standings(leagueDef.code, [{ studentId: 's-server001', displayName: 'Cy', returnPct: 9, maxDrawdownPct: 2, trades: 4, equity: 109000, spark: [100000, 104000, 109000], updatedAt: new Date().toISOString() }]);
    assert.strictEqual(srv.rows[0].displayName, 'Cy');
    assert.deepStrictEqual(srv.rows[0].equityHistory.slice(0, 3), [100000, 104000, 109000]);
    const csv = I.leagues.csv(leagueDef.code);
    assert.ok(csv.split('\r\n')[0].startsWith('rank,name,student_id,team,return_pct'));
    assert.ok(/\r\n1,Ava,/.test(csv));
    assert.strictEqual(I.leagues.csv('ZZZZZZ'), '');
    assert.strictEqual(I.leagues.standings('ZZZZZZ'), null);
  } finally {
    localStorage.clear(); Object.assign(store, savedStore);
  }
});

test('instructor leagues are guarded: without BT.leagues every call answers without throwing', async () => {
  const saved = window.BT.leagues; delete window.BT.leagues;
  try {
    assert.strictEqual(I.leagues.available(), false);
    assert.deepStrictEqual(I.leagues.list(), []);
    assert.strictEqual(I.leagues.add('BTL1.xyz').ok, false);
    const r = await I.leagues.importShares('ABCDEF', 'BT1.abcdefghij');
    assert.ok(r.error && r.found === 0);
    assert.strictEqual(I.leagues.standings('ABCDEF'), null);
    assert.strictEqual(I.leagues.csv('ABCDEF'), '');
  } finally { window.BT.leagues = saved; }
});

test('instructor.html: Class | Leagues tabs, leagues.js loaded before instructor.js, drawer modules stack on phones', () => {
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'instructor.html'), 'utf8');
  assert.ok(/role="tablist" aria-label="Instructor sections"/.test(html));
  assert.ok(/id="tabLeagues" aria-controls="leaguesPanel" aria-selected="false"/.test(html));
  assert.ok(/id="leaguesPanel" role="tabpanel" aria-labelledby="tabLeagues" hidden/.test(html));
  assert.ok(/id="classPanel" role="tabpanel"/.test(html));
  assert.ok(html.indexOf('js/leagues.js') > 0 && html.indexOf('js/leagues.js') < html.indexOf('js/instructor.js'));
  ['lgAddIn', 'lgSelect', 'lgImportIn', 'lgImportBtn', 'lgBody', 'lgCsv', 'lgClear'].forEach(id => assert.ok(html.includes('id="' + id + '"'), id));
  assert.ok(/<label for="lgAddIn">/.test(html) && /<label for="lgImportIn">/.test(html) && /<label for="lgSelect">/.test(html), 'labelled inputs');
  assert.ok(/@media \(max-width:560px\)\{[\s\S]*?#drawer \.d-sec table\.dense tr\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(html), 'stacked module cards');
  assert.ok(/td\[data-label\]:not\(:first-child\)::before\{content:attr\(data-label\)/.test(html));
  assert.ok(/table class="dense" role="table"/.test(html), 'explicit table roles survive display:block');
  assert.ok(/\.table-wrap table\.lg-standings\{width:100%;min-width:0\}/.test(html), 'standings override the 480px table minimum');
  const js = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'instructor.js'), 'utf8');
  assert.ok(/data-label="' \+ esc\(T\('Lessons'\)\)/.test(js) && /data-label="' \+ esc\(T\('Quiz avg'\)\)/.test(js), 'module cells carry labels');
  assert.ok(/I\.leagues\.standings\(lgUi\.code/.test(js));
});

/* ---- server/worker.js /classes routes ---------------------------------- */
const workerTests = (async () => {
  let W;
  try { W = (await import(path.join(__dirname, '..', 'server', 'worker.js')))._internal; }
  catch (e) { console.log('  (skipping worker tests: ' + e.message.split('\n')[0] + ')'); return; }
  chain = chain.then(() => console.log('server/worker.js /classes tests'));

  /* In-memory KV with the parts of the real API the worker relies on: per-key
   * metadata, lexicographic key order and cursor pagination (the cursor is the
   * number of keys already returned, opaque to the caller). */
  function fakeKv() {
    const m = new Map(), meta = new Map();
    return {
      m, meta,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v, opts) { m.set(k, v); if (opts && opts.metadata !== undefined) meta.set(k, opts.metadata); else meta.delete(k); },
      async delete(k) { m.delete(k); meta.delete(k); },
      async list({ prefix, limit, cursor }) {
        const all = [...m.keys()].filter(k => k.startsWith(prefix || '')).sort();
        const start = cursor ? parseInt(cursor, 10) || 0 : 0, n = Math.min(limit || 1000, 1000);
        const keys = all.slice(start, start + n).map(name => ({ name, metadata: meta.has(name) ? meta.get(name) : undefined }));
        const done = start + n >= all.length;
        return done ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(start + n) };
      }
    };
  }
  const withToken = (snap, token) => Object.assign({}, snap, { ownerToken: token });
  const req = (method, pathname, body, headers = {}) => new Request('https://api.example' + pathname, { method, headers: { 'CF-Connecting-IP': '203.0.113.5', 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });

  test('worker: sanitizeSnapshot whitelists fields, clamps numbers and drops junk', () => {
    const s = W.sanitizeSnapshot({ studentId: 's-abc123xyz0', displayName: '  Ada <b>  L ', lessonsDone: ['m1-l1', 'm1-l1', 'x'.repeat(80), 7], quizScores: { 'm1-l1': 150, 'm1-l2': -3, bad: 'nope' }, drills: [{ id: 'd1', returnPct: 1e9, passed: 'yes', date: '2026-01-02' }, { id: '' }, 'junk'], paper: { equity: -5, returnPct: 3.14159, trades: 2.7 }, journalEntries: '12', journal: { reviewed: 5, weeklyReviews: 2, lastDate: 'garbage' }, streak: 4, daily: { days: 9 }, lastActive: '2026-02-03', updatedAt: '2026-02-03T10:00:00Z', email: 'x@y.co', ip: '1.2.3.4', notes: 'secret' });
    assert.strictEqual(s.studentId, 's-abc123xyz0');
    assert.strictEqual(s.displayName, 'Ada <b> L');
    assert.deepStrictEqual(s.lessonsDone, ['m1-l1', 'x'.repeat(40)]);
    assert.deepStrictEqual(s.quizScores, { 'm1-l1': 100, 'm1-l2': 0 }, 'clamped to 0..100; a non-numeric score is dropped');
    assert.strictEqual(s.drills.length, 1); assert.strictEqual(s.drills[0].returnPct, 100000); assert.strictEqual(s.drills[0].passed, true);
    assert.strictEqual(s.paper.equity, 0); assert.strictEqual(s.paper.returnPct, 3.14); assert.strictEqual(s.paper.trades, 3);
    assert.strictEqual(s.journalEntries, 12); assert.strictEqual(s.journal.lastDate, null);
    assert.strictEqual(s.streak, 4); assert.strictEqual(s.daily.days, 9);
    assert.ok(!('email' in s) && !('ip' in s) && !('notes' in s), 'unknown fields never stored');
    assert.strictEqual(W.sanitizeSnapshot({ studentId: 'bad id!' }).studentId, null);
    assert.strictEqual(W.sanitizeSnapshot(null).studentId, null);
    for (let i = 0; i < 20; i++) assert.match(W.newClassCode(), W.CLASS_CODE_RE);
    assert.strictEqual(W.normClassCode(' k7q-2mx '), 'K7Q2MX');
  });

  test('worker: full classroom flow with INSTRUCTOR_SECRET (create → student snapshot → roster → delete → 410)', async () => {
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 'teacher-secret' };
    // nobody signed in and no secret → 401 with a hint
    let r = await W.route(req('POST', '/classes', { name: 'FIN 1100' }), env);
    assert.strictEqual(r.status, 401); assert.strictEqual((await r.json()).requiresInstructor, true);
    r = await W.route(req('POST', '/classes', { name: 'FIN 1100' }, { 'X-Instructor-Secret': 'wrong' }), env);
    assert.strictEqual(r.status, 401);
    r = await W.route(req('POST', '/classes', { name: 'x' }, { 'X-Instructor-Secret': 'teacher-secret' }), env);
    assert.strictEqual(r.status, 400, 'name too short');
    r = await W.route(req('POST', '/classes', { name: 'FIN 1100 Markets by Doing', section: 'Tue', term: 'Spring 2027', instructorSecret: 'teacher-secret' }), env);
    assert.strictEqual(r.status, 201);
    const made = await r.json();
    assert.match(made.code, W.CLASS_CODE_RE); assert.match(made.instructorToken, /^[A-Za-z0-9_-]{32}$/); assert.strictEqual(made.ownerKind, 'secret');
    const stored = JSON.parse(env.CLASSES.m.get('class:' + made.code));
    assert.ok(!('instructorToken' in stored) && stored.tokenHash && stored.tokenHash !== made.instructorToken, 'only a hash of the token is stored');
    // public lookup
    r = await W.route(req('GET', '/classes/' + made.code.toLowerCase()), env);
    assert.strictEqual(r.status, 200); const pub = await r.json();
    assert.strictEqual(pub.name, 'FIN 1100 Markets by Doing'); assert.ok(!('tokenHash' in pub) && !('owner' in pub));
    assert.strictEqual((await W.route(req('GET', '/classes/ZZZZZZ'), env)).status, 404);
    assert.strictEqual((await W.route(req('GET', '/classes/bad'), env)).status, 400);
    // student snapshots
    r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', snapAda), env);
    assert.strictEqual(r.status, 200); const ack = await r.json();
    assert.strictEqual(ack.className, 'FIN 1100 Markets by Doing'); assert.ok(ack.receivedAt);
    r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', snapGrace), env); assert.strictEqual(r.status, 200);
    assert.strictEqual((await W.route(req('POST', '/classes/' + made.code + '/snapshots', { nope: 1 }), env)).status, 400, 'no studentId');
    assert.strictEqual((await W.route(req('POST', '/classes/' + made.code + '/snapshots', '{bad json'), env)).status, 400);
    assert.strictEqual((await W.route(req('POST', '/classes/ZZZZZZ/snapshots', snapAda), env)).status, 404);
    assert.strictEqual((await W.route(req('POST', '/classes/' + made.code + '/snapshots', { studentId: 's-big', lessonsDone: Array(5000).fill('m1-l1xxxxxxxxxxxxxxxxxxxxxx') }), env)).status, 413);
    const savedAda = JSON.parse(env.CLASSES.m.get(`student:${made.code}:${snapAda.studentId}`));
    assert.strictEqual(savedAda.displayName, 'Ada'); assert.ok(savedAda.receivedAt); assert.ok(!('ip' in savedAda));
    // roster: refused without credentials, allowed with token or secret
    r = await W.route(req('GET', '/classes/' + made.code + '/roster'), env); assert.strictEqual(r.status, 403);
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { 'X-Class-Token': 'wrong-token-wrong-token-wrong-' }), env); assert.strictEqual(r.status, 403);
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { 'X-Class-Token': made.instructorToken }), env);
    assert.strictEqual(r.status, 200); let roster = await r.json();
    assert.strictEqual(roster.count, 2); assert.strictEqual(roster.via, 'token'); assert.strictEqual(roster.class.code, made.code);
    assert.deepStrictEqual(roster.students.map(s => s.studentId).sort(), [snapAda.studentId, snapGrace.studentId].sort());
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { 'X-Instructor-Secret': 'teacher-secret' }), env);
    assert.strictEqual((await r.json()).via, 'secret');
    // delete a student: gone from the roster, and the device is told to stop
    r = await W.route(req('DELETE', '/classes/' + made.code + '/students/' + snapAda.studentId), env); assert.strictEqual(r.status, 403);
    r = await W.route(req('DELETE', '/classes/' + made.code + '/students/' + snapAda.studentId, undefined, { 'X-Class-Token': made.instructorToken }), env);
    assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).removed, true);
    roster = await (await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { 'X-Class-Token': made.instructorToken }), env)).json();
    assert.strictEqual(roster.count, 1);
    r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', snapAda), env);
    assert.strictEqual(r.status, 410); assert.strictEqual((await r.json()).removed, true);
    assert.strictEqual((await W.route(req('DELETE', '/classes/' + made.code + '/students/bad%20id', undefined, { 'X-Class-Token': made.instructorToken }), env)).status, 400);
    // health reports the feature; a server without the KV binding says so
    assert.strictEqual((await (await W.route(req('GET', '/health'), env)).json()).classroom, true);
    const bare = await W.route(req('POST', '/classes', { name: 'FIN 1100' }), { TOKENS: fakeKv() });
    assert.strictEqual(bare.status, 503); assert.strictEqual((await bare.json()).notConfigured, true);
  });

  test('worker: a signed-in member owns the classes they create; another member cannot read them', async () => {
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), MEMBERS: fakeKv(), HMAC_SECRET: 'hs', RESEND_API_KEY: 're' };
    // two sessions, stored the way createSession does (sha256 of the id)
    const mk = async (id, email) => { env.TOKENS.m.set('session:' + await W.sha256(id), JSON.stringify({ email, expires: new Date(Date.now() + 864e5).toISOString() })); return id; };
    const t1 = await mk('teacher-session-1', 'prof@broward.edu'), t2 = await mk('other-session-2', 'student@example.edu');
    let r = await W.route(req('POST', '/classes', { name: 'FIN 1100' }), env);
    assert.strictEqual(r.status, 401); assert.strictEqual((await r.json()).canSignIn, true);
    r = await W.route(req('POST', '/classes', { name: 'FIN 1100' }, { Authorization: 'Bearer ' + t1 }), env);
    assert.strictEqual(r.status, 201); const made = await r.json(); assert.strictEqual(made.ownerKind, 'email');
    const stored = JSON.parse(env.CLASSES.m.get('class:' + made.code));
    assert.ok(!stored.owner.includes('@') && stored.owner !== await W.sha256('prof@broward.edu'), 'owner is an HMAC, not the email or a plain hash');
    await W.route(req('POST', '/classes/' + made.code + '/snapshots', snapGrace), env);
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { Authorization: 'Bearer ' + t1 }), env);
    assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).via, 'session');
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { Authorization: 'Bearer ' + t2 }), env);
    assert.strictEqual(r.status, 403, 'another signed-in member is not the instructor');
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, { Authorization: 'Bearer ' + t2, 'X-Class-Token': made.instructorToken }), env);
    assert.strictEqual(r.status, 200, 'the per-class token works from any browser the instructor pastes it into');
    assert.strictEqual((await W.route(req('DELETE', '/classes/' + made.code + '/students/' + snapGrace.studentId, undefined, { Authorization: 'Bearer ' + t2 }), env)).status, 403);
  });

  test('worker: CORS allows DELETE and the classroom headers; snapshot limits are per student and per class, not per IP', async () => {
    const h = W.corsHeaders({ headers: { get: k => (k === 'Origin' ? 'https://me.github.io' : null) } }, { ALLOWED_ORIGINS: 'https://me.github.io' });
    assert.ok(h['access-control-allow-methods'].includes('DELETE'));
    assert.ok(/X-Class-Token/.test(h['access-control-allow-headers']) && /X-Instructor-Secret/.test(h['access-control-allow-headers']));
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's' };
    const made = await (await W.route(req('POST', '/classes', { name: 'Rate class' }, { 'X-Instructor-Secret': 's' }), env)).json();
    // 60 different students behind one school NAT in one minute: every one of them gets through
    let ok = 0, limited = 0;
    for (let i = 0; i < 60; i++) { const r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', Object.assign({}, snapAda, { studentId: 's-' + String(i).padStart(10, 'x') })), env); if (r.status === 200) ok++; else if (r.status === 429) limited++; }
    assert.strictEqual(ok, 60); assert.strictEqual(limited, 0, 'a shared campus IP is not a reason to drop snapshots');
    // one device hammering: per-(class, student) limit, answered with a retry hint and no 500
    const first = await (await W.route(req('POST', '/classes/' + made.code + '/snapshots', Object.assign({}, snapAda, { studentId: 's-hammer0001' })), env)).json();
    ok = 1; limited = 0;
    for (let i = 0; i < 12; i++) { const r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', withToken(Object.assign({}, snapAda, { studentId: 's-hammer0001' }), first.ownerToken)), env); if (r.status === 200) ok++; else if (r.status === 429) { limited++; assert.strictEqual((await r.json()).retryAfterSec, 60); } }
    assert.strictEqual(ok, W.SNAP_PER_STUDENT_PER_MIN); assert.strictEqual(limited, 13 - W.SNAP_PER_STUDENT_PER_MIN);
    assert.strictEqual((await W.route(req('POST', '/classes/' + made.code + '/snapshots', Object.assign({}, snapAda, { studentId: 's-other00001' })), env)).status, 200, 'another student from the same IP is unaffected');
    // the per-IP bucket still exists as a flood ceiling
    const envIp = { CLASSES: fakeKv(), TOKENS: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's', RL_SNAP_IP: { async limit() { return { success: false }; } } };
    const made2 = await (await W.route(req('POST', '/classes', { name: 'Flood class' }, { 'X-Instructor-Secret': 's' }), envIp)).json();
    assert.strictEqual((await W.route(req('POST', '/classes/' + made2.code + '/snapshots', snapAda), envIp)).status, 429);
    assert.ok(W.SNAP_PER_IP_PER_MIN >= 500 && W.SNAP_PER_STUDENT_PER_MIN <= 10);
  });

  test('worker: a student record belongs to the device that created it (ownerToken), and the server clock wins', async () => {
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's' };
    const made = await (await W.route(req('POST', '/classes', { name: 'Owner class' }, { 'X-Instructor-Secret': 's' }), env)).json();
    const path = '/classes/' + made.code + '/snapshots';
    const auth = { 'X-Instructor-Secret': 's' };
    // first post mints a token and returns it exactly once
    let r = await W.route(req('POST', path, snapAda), env);
    assert.strictEqual(r.status, 200); const first = await r.json();
    assert.match(first.ownerToken, W.OWNER_TOKEN_RE);
    const stored = JSON.parse(env.CLASSES.m.get(`student:${made.code}:${snapAda.studentId}`));
    assert.ok(stored.owner && stored.owner !== first.ownerToken && !stored.owner.includes(first.ownerToken), 'only an HMAC of the token is stored');
    assert.strictEqual(stored.owner, await W.snapshotOwner(env, made.code, snapAda.studentId, first.ownerToken));
    // the attacker from the finding: knows the code and the id, forges a far-future updatedAt
    const forged = { studentId: snapAda.studentId, lessonsDone: [], displayName: 'Alice is a cheater', updatedAt: '2999-01-01T00:00:00Z' };
    r = await W.route(req('POST', path, forged), env);
    assert.strictEqual(r.status, 409); assert.strictEqual((await r.json()).ownerMismatch, true);
    r = await W.route(req('POST', path, withToken(forged, 'wrong-token-wrong-token-wrong-1')), env);
    assert.strictEqual(r.status, 409, 'a wrong token is refused too');
    let roster = await (await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, auth), env)).json();
    assert.strictEqual(roster.students.length, 1);
    assert.strictEqual(roster.students[0].displayName, 'Ada', 'the victim record is untouched');
    assert.strictEqual(roster.students[0].lessonsDone.length, snapAda.lessonsDone.length);
    assert.ok(!('owner' in roster.students[0]), 'the owner value never leaves the server');
    // the real device updates with its token; no new token is handed out
    r = await W.route(req('POST', path, withToken(Object.assign({}, snapAda, { displayName: 'Ada L.', updatedAt: '2999-01-01T00:00:00Z' }), first.ownerToken)), env);
    assert.strictEqual(r.status, 200); const second = await r.json();
    assert.ok(!('ownerToken' in second), 'token returned only on the first snapshot');
    const saved = JSON.parse(env.CLASSES.m.get(`student:${made.code}:${snapAda.studentId}`));
    assert.strictEqual(saved.displayName, 'Ada L.');
    assert.strictEqual(saved.updatedAt, saved.receivedAt, 'updatedAt is the server clock');
    assert.ok(Date.parse(saved.updatedAt) < Date.now() + 5000 && Date.parse(saved.updatedAt) > Date.now() - 60000);
    assert.strictEqual(saved.clientUpdatedAt, null, 'a future client timestamp is dropped, not stored');
    assert.strictEqual(saved.firstSeenAt, stored.receivedAt, 'firstSeenAt survives updates');
    const ts = new Date(Date.now() - 60000).toISOString();
    r = await W.route(req('POST', path, withToken(Object.assign({}, snapAda, { updatedAt: ts }), first.ownerToken)), env);
    assert.strictEqual(JSON.parse(env.CLASSES.m.get(`student:${made.code}:${snapAda.studentId}`)).clientUpdatedAt, ts, 'a sane client timestamp is kept for information');
    assert.strictEqual(W.clampClientTime('garbage', Date.now()), null);
    assert.strictEqual(W.clampClientTime(new Date(Date.now() + 4 * 60000).toISOString(), Date.now()) !== null, true, 'a few minutes of clock skew are fine');
    // a record written before ownership existed (no owner) is claimed by the next snapshot and bound from then on
    env.CLASSES.m.set(`student:${made.code}:s-legacy0001`, JSON.stringify({ v: 1, studentId: 's-legacy0001', displayName: 'Old', lessonsDone: [], quizScores: {}, drills: [], paper: {}, receivedAt: '2026-01-01T00:00:00Z' }));
    r = await W.route(req('POST', path, Object.assign({}, snapAda, { studentId: 's-legacy0001' })), env);
    assert.strictEqual(r.status, 200); const legacy = await r.json(); assert.match(legacy.ownerToken, W.OWNER_TOKEN_RE);
    assert.strictEqual((await W.route(req('POST', path, Object.assign({}, snapAda, { studentId: 's-legacy0001' })), env)).status, 409);
    assert.strictEqual((await W.route(req('POST', path, withToken(Object.assign({}, snapAda, { studentId: 's-legacy0001' }), legacy.ownerToken)), env)).status, 200);
    // without HMAC_SECRET ownership still works (sha256 of a 24-byte random token)
    const envNoHmac = { CLASSES: fakeKv(), TOKENS: fakeKv(), INSTRUCTOR_SECRET: 's' };
    const made2 = await (await W.route(req('POST', '/classes', { name: 'No hmac' }, { 'X-Instructor-Secret': 's' }), envNoHmac)).json();
    const t = (await (await W.route(req('POST', '/classes/' + made2.code + '/snapshots', snapAda), envNoHmac)).json()).ownerToken;
    assert.strictEqual((await W.route(req('POST', '/classes/' + made2.code + '/snapshots', snapAda), envNoHmac)).status, 409);
    assert.strictEqual((await W.route(req('POST', '/classes/' + made2.code + '/snapshots', withToken(snapAda, t)), envNoHmac)).status, 200);
  });

  test('worker: roster is capped per class, paginated, served from KV metadata in summary view; bulk delete clears a flood', async () => {
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's' };
    const auth = { 'X-Instructor-Secret': 's' };
    const made = await (await W.route(req('POST', '/classes', { name: 'Big class' }, { 'X-Instructor-Secret': 's' }), env)).json();
    const path = '/classes/' + made.code + '/snapshots';
    // the per-class "new ids per minute" limit exists; lift it for the flood by honouring a permissive binding
    env.RL_SNAP_NEW = { async limit() { return { success: true }; } };
    // a prankster posts MAX_ROSTER ids that sort before every real id
    for (let i = 0; i < W.MAX_ROSTER; i++) {
      const r = await W.route(req('POST', path, { studentId: 's-0flood' + String(i).padStart(4, '0'), lessonsDone: [] }), env);
      assert.strictEqual(r.status, 200, 'flood id ' + i);
    }
    // the class is now full: a genuine new student is told so (409 {full}), not silently shadowed
    let r = await W.route(req('POST', path, snapGrace), env);
    assert.strictEqual(r.status, 409); assert.strictEqual((await r.json()).full, true);
    assert.strictEqual([...env.CLASSES.m.keys()].filter(k => k.startsWith('student:')).length, W.MAX_ROSTER);
    // existing students keep syncing even when the class is full
    const flood0 = env.CLASSES.m.get(`student:${made.code}:s-0flood0000`);
    assert.ok(flood0);
    // full roster view is paginated: 40 per page by default, max 100, cursor passed through
    r = await W.route(req('GET', '/classes/' + made.code + '/roster', undefined, auth), env);
    assert.strictEqual(r.status, 200); let page = await r.json();
    assert.strictEqual(page.view, 'full'); assert.strictEqual(page.students.length, W.ROSTER_PAGE_DEFAULT); assert.strictEqual(page.hasMore, true); assert.ok(page.cursor);
    assert.ok(Array.isArray(page.students[0].lessonsDone), 'full snapshots');
    let seen = page.students.length, pages = 1, cursor = page.cursor;
    while (cursor) {
      page = await (await W.route(req('GET', '/classes/' + made.code + '/roster?limit=100&cursor=' + encodeURIComponent(cursor), undefined, auth), env)).json();
      seen += page.students.length; pages++; cursor = page.cursor;
      assert.ok(page.students.length <= W.ROSTER_PAGE_MAX);
    }
    assert.strictEqual(seen, W.MAX_ROSTER); assert.strictEqual(pages, 1 + Math.ceil((W.MAX_ROSTER - W.ROSTER_PAGE_DEFAULT) / W.ROSTER_PAGE_MAX));
    assert.strictEqual((await W.route(req('GET', '/classes/' + made.code + '/roster?limit=1000', undefined, auth), env).then(x => x.json())).students.length, W.ROSTER_PAGE_MAX, 'limit is clamped');
    assert.strictEqual((await W.route(req('GET', '/classes/' + made.code + '/roster?cursor=' + encodeURIComponent('<script>'), undefined, auth), env)).status, 400);
    // summary view: the whole class in one list() call, zero gets, rows ≤ 1 KB each, no owner value
    const gets = []; const realGet = env.CLASSES.get.bind(env.CLASSES); env.CLASSES.get = async k => { gets.push(k); return realGet(k); };
    r = await W.route(req('GET', '/classes/' + made.code + '/roster?view=summary', undefined, auth), env);
    page = await r.json(); env.CLASSES.get = realGet;
    assert.strictEqual(page.view, 'summary'); assert.strictEqual(page.students.length, W.MAX_ROSTER); assert.strictEqual(page.hasMore, false);
    assert.deepStrictEqual(gets.filter(k => k.startsWith('student:')), [], 'summary rows come from metadata, not per-student gets');
    const row = page.students[0];
    assert.strictEqual(row.v, 2); assert.strictEqual(row.studentId, 's-0flood0000'); assert.ok('lessonsCount' in row && 'quizAvg' in row && 'updatedAt' in row && !('owner' in row) && !('lessonsDone' in row));
    // a summary row never exceeds KV's 1 KB metadata limit, even for a maxed-out snapshot
    const fat = W.sanitizeSnapshot(Object.assign({}, snapGrace, { displayName: 'N'.repeat(40), lessonsDone: Array.from({ length: 400 }, (_, i) => 'lesson-' + i), certificate: { id: 'BT-2026-ABCDEF', date: '2026-01-01' } }));
    fat.receivedAt = fat.updatedAt = new Date().toISOString();
    assert.ok(JSON.stringify(W.rosterRow(fat)).length <= W.ROSTER_META_MAX_BYTES);
    assert.strictEqual(W.rosterRow(fat).lessonsCount, 400); assert.strictEqual(W.rosterRow(fat).quizAvg, 90);
    // one student's full record on demand
    r = await W.route(req('GET', '/classes/' + made.code + '/students/s-0flood0007', undefined, auth), env);
    assert.strictEqual(r.status, 200); const one = await r.json(); assert.strictEqual(one.student.studentId, 's-0flood0007'); assert.ok(!('owner' in one.student));
    assert.strictEqual((await W.route(req('GET', '/classes/' + made.code + '/students/s-nobody001', undefined, auth), env)).status, 404);
    assert.strictEqual((await W.route(req('GET', '/classes/' + made.code + '/students/s-0flood0007'), env)).status, 403, 'instructor only');
    // bulk delete by ids, then {all:true} in pages until the class is empty
    r = await W.route(req('DELETE', '/classes/' + made.code + '/students', { ids: ['s-0flood0000', 's-0flood0001', 'bad id!', 's-0flood0000'] }, auth), env);
    assert.strictEqual(r.status, 200); let d = await r.json();
    assert.strictEqual(d.removed, 2); assert.strictEqual(d.remaining, W.MAX_ROSTER - 2);
    assert.ok(env.CLASSES.m.has(`removed:${made.code}:s-0flood0000`) && !env.CLASSES.m.has(`student:${made.code}:s-0flood0000`));
    assert.strictEqual((await W.route(req('DELETE', '/classes/' + made.code + '/students', { ids: Array.from({ length: W.BULK_DELETE_MAX + 1 }, (_, i) => 's-x' + String(i).padStart(8, '0')) }, auth), env)).status, 400);
    assert.strictEqual((await W.route(req('DELETE', '/classes/' + made.code + '/students', { nope: 1 }, auth), env)).status, 400);
    assert.strictEqual((await W.route(req('DELETE', '/classes/' + made.code + '/students', { all: true }), env)).status, 403, 'instructor only');
    let calls = 0;
    do { d = await (await W.route(req('DELETE', '/classes/' + made.code + '/students', { all: true }, auth), env)).json(); calls++; assert.ok(d.removed <= W.BULK_DELETE_MAX); } while (d.hasMore && calls < 100);
    assert.strictEqual(d.remaining, 0); assert.strictEqual(calls, Math.ceil((W.MAX_ROSTER - 2) / W.BULK_DELETE_MAX), 'the last page reports hasMore:false, no empty extra call');
    assert.strictEqual([...env.CLASSES.m.keys()].filter(k => k.startsWith('student:')).length, 0);
    // now Grace can join, and the flood ids are locked out (410) rather than re-filling the class
    assert.strictEqual((await W.route(req('POST', path, snapGrace), env)).status, 200);
    assert.strictEqual((await W.route(req('POST', path, { studentId: 's-0flood0003', lessonsDone: [] }), env)).status, 410);
    // a legacy record without metadata still appears in the summary view (fetched once)
    env.CLASSES.m.set(`student:${made.code}:s-legacy0002`, JSON.stringify({ v: 1, studentId: 's-legacy0002', displayName: 'Old', lessonsDone: ['m1-l1'], quizScores: { 'm1-l1': 80 }, drills: [], paper: {}, receivedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }));
    page = await (await W.route(req('GET', '/classes/' + made.code + '/roster?view=summary', undefined, auth), env)).json();
    assert.deepStrictEqual(page.students.map(s => s.studentId).sort(), ['s-legacy0002', snapGrace.studentId].sort());
    assert.strictEqual(page.students.find(s => s.studentId === 's-legacy0002').quizAvg, 80);
  });

  test('worker: malformed percent-encoding in a student id is a 400, never a thrown URIError', async () => {
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's' };
    const auth = { 'X-Instructor-Secret': 's' };
    const made = await (await W.route(req('POST', '/classes', { name: 'Decode class' }, { 'X-Instructor-Secret': 's' }), env)).json();
    for (const bad of ['%E0%A4%A', '%', '%ZZ', 'a%2Fb', 'bad%20id']) {
      const r = await W.route(req('DELETE', '/classes/' + made.code + '/students/' + bad, undefined, auth), env);
      assert.strictEqual(r.status, 400, bad); assert.strictEqual((await r.json()).error, 'Invalid student id.');
      assert.strictEqual((await W.route(req('GET', '/classes/' + made.code + '/students/' + bad, undefined, auth), env)).status, 400, 'GET ' + bad);
    }
    assert.strictEqual(W.studentIdFromPath('%E0%A4%A'), null); assert.strictEqual(W.studentIdFromPath('s-abc123xyz0'), 's-abc123xyz0');
    assert.strictEqual(W.studentIdFromPath('s%2Dabc123xyz0'), 's-abc123xyz0', 'a harmlessly encoded valid id still works');
    // the fetch handler path: no 500 either, with DEBUG on
    const mod = await import(path.join(__dirname, '..', 'server', 'worker.js'));
    const res = await mod.default.fetch(req('DELETE', '/classes/' + made.code + '/students/%E0%A4%A', undefined, auth), Object.assign({ DEBUG: 'true' }, env));
    assert.strictEqual(res.status, 400);
  });

  test('worker: a classroom-only deployment (CLASSES, no TOKENS) works, and no counter store at all is a clear 503', async () => {
    // CLASSES alone: counters live in CLASSES under rl:, every classroom route works
    const env = { CLASSES: fakeKv(), HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's' };
    assert.strictEqual(W.rateLimitStore(env).name, 'CLASSES');
    let r = await W.route(req('POST', '/classes', { name: 'School class' }, { 'X-Instructor-Secret': 's' }), env);
    assert.strictEqual(r.status, 201, 'class creation is not a bogus 429'); const made = await r.json();
    r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', snapAda), env);
    assert.strictEqual(r.status, 200);
    assert.ok([...env.CLASSES.m.keys()].some(k => k.startsWith('rl:snap')), 'counters in CLASSES');
    assert.ok(![...env.CLASSES.m.keys()].some(k => k.startsWith('rl:') && /:(class|student|removed):/.test(k)));
    r = await W.route(req('GET', '/classes/' + made.code + '/roster?view=summary', undefined, { 'X-Instructor-Secret': 's' }), env);
    assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).count, 1);
    const health = await (await W.route(req('GET', '/health'), env)).json();
    assert.strictEqual(health.classroom, true); assert.strictEqual(health.rateLimitStore, 'CLASSES');
    // neither TOKENS nor CLASSES: write routes say what is missing instead of 429
    const bare = { HMAC_SECRET: 'hs', INSTRUCTOR_SECRET: 's', MEMBERS: fakeKv(), LEADERBOARD: fakeKv() };
    assert.strictEqual(W.rateLimitStore(bare), null);
    r = await W.route(req('POST', '/leaderboard', { classCode: 'ABC', nickname: 'Ada', stats: {} }), bare);
    assert.strictEqual(r.status, 503); const body = await r.json();
    assert.strictEqual(body.notConfigured, true); assert.match(body.error, /TOKENS/);
    assert.strictEqual((await (await W.route(req('GET', '/health'), bare)).json()).rateLimitStore, null);
    assert.strictEqual((await W.route(req('GET', '/leaderboard?code=ABC'), bare)).status, 200, 'read routes still fail open');
    // a CLASSES namespace that cannot list is not "ready" either
    assert.strictEqual(W.classesReady({ CLASSES: { async get() { return null; } } }), false);
    assert.strictEqual(W.classesReady({ CLASSES: fakeKv() }), true);
    // rateLimit itself throws a tagged error (route() converts it); failOpen buckets still pass
    await assert.rejects(() => W.rateLimit(bare, req('GET', '/x'), 'snap', 5), e => e.notConfigured === true && e instanceof W.NotConfiguredError);
    assert.strictEqual(await W.rateLimit(bare, req('GET', '/x'), 'verify', 5, { failOpen: true }), true);
  });
})();

/* ---- done ---------------------------------------------------------------- */
(async function finish() {
  await workerTests;
  await chain;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
