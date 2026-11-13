/* Broward Trading — tests for js/classroom.js (BT.classroom), js/instructor.js
 * (BT.instructor) and the /classes routes of server/worker.js.
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
  assert.deepStrictEqual(Object.keys(r).sort(), ['code', 'displayName', 'ok', 'studentId']);
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
    if (url.endsWith('/classes/MXK7Q2/roster')) { assert.strictEqual(opts.headers['X-Class-Token'], 'tok_abcdefghijklmnopqrstuvwxyz'); return jsonRes(200, { ok: true, class: { code: 'MXK7Q2', name: 'Remote class (renamed)' }, students: [snapAda, snapGrace], via: 'token' }); }
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

/* ---- server/worker.js /classes routes ---------------------------------- */
const workerTests = (async () => {
  let W;
  try { W = (await import(path.join(__dirname, '..', 'server', 'worker.js')))._internal; }
  catch (e) { console.log('  (skipping worker tests: ' + e.message.split('\n')[0] + ')'); return; }
  chain = chain.then(() => console.log('server/worker.js /classes tests'));

  function fakeKv() {
    const m = new Map();
    return {
      m,
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async put(k, v) { m.set(k, v); },
      async delete(k) { m.delete(k); },
      async list({ prefix, limit }) { const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).slice(0, limit || 1000).map(name => ({ name })); return { keys, list_complete: true }; }
    };
  }
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

  test('worker: CORS now allows DELETE and the classroom headers; snapshot route is rate limited per IP', async () => {
    const h = W.corsHeaders({ headers: { get: k => (k === 'Origin' ? 'https://me.github.io' : null) } }, { ALLOWED_ORIGINS: 'https://me.github.io' });
    assert.ok(h['access-control-allow-methods'].includes('DELETE'));
    assert.ok(/X-Class-Token/.test(h['access-control-allow-headers']) && /X-Instructor-Secret/.test(h['access-control-allow-headers']));
    const env = { CLASSES: fakeKv(), TOKENS: fakeKv(), INSTRUCTOR_SECRET: 's' };
    const made = await (await W.route(req('POST', '/classes', { name: 'Rate class' }, { 'X-Instructor-Secret': 's' }), env)).json();
    let ok = 0, limited = 0;
    for (let i = 0; i < 40; i++) { const r = await W.route(req('POST', '/classes/' + made.code + '/snapshots', Object.assign({}, snapAda, { studentId: 's-' + String(i).padStart(10, 'x') })), env); if (r.status === 200) ok++; else if (r.status === 429) limited++; }
    assert.strictEqual(ok, 30); assert.strictEqual(limited, 10);
  });
})();

/* ---- done ---------------------------------------------------------------- */
(async function finish() {
  await workerTests;
  await chain;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
