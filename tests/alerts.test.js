/* Broward Trading — tests for js/alerts.js (BT.alerts)
 * Run with:  node tests/alerts.test.js
 * Plain node + assert, no framework. The module expects `window` and
 * (optionally) `localStorage` and `Notification`; all three are shimmed here.
 * indicators.js is loaded too so RSI / SMA / signal alerts can compute
 * their own series when the caller passes no `ind`.
 */
'use strict';
const assert = require('assert');
const path = require('path');

// ---- shims -------------------------------------------------------------
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
const sent = [];
function FakeNotification(title, opts) { sent.push({ title, opts }); }
FakeNotification.permission = 'default';
FakeNotification.requestPermission = () => { FakeNotification.permission = 'granted'; return Promise.resolve('granted'); };
global.window = { localStorage: global.localStorage, Notification: FakeNotification };
global.document = { hidden: false };
require(path.join(__dirname, '..', 'js', 'indicators.js'));
require(path.join(__dirname, '..', 'js', 'alerts.js'));
const A = window.BT.alerts;

let passed = 0, failed = 0;
const pending = [];
function report(name, e) {
  if (!e) { passed++; console.log('  ok   ' + name); return; }
  failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
}
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { pending.push(r.then(() => report(name), e => report(name, e))); return; }
    report(name);
  } catch (e) { report(name, e); }
}
let fakeNow = Date.UTC(2024, 2, 1, 15, 0, 0);
A.setClock(() => fakeNow);
function fresh() { localStorage.clear(); A._reset(); sent.length = 0; FakeNotification.permission = 'default'; }

/** Bars with a chosen close path. */
function mk(closes, startDay) {
  startDay = startDay || 1;
  return closes.map((c, i) => {
    const d = new Date(Date.UTC(2024, 0, startDay + i));
    return { time: d.toISOString().slice(0, 10), open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000 };
  });
}
/** Deterministic trending series long enough for SMA 50 and the signal. */
function trend(n, start, slope, wobble) {
  const out = []; let x = start;
  for (let i = 0; i < n; i++) { x += slope + Math.sin(i / 3) * (wobble == null ? 0.4 : wobble); out.push(+x.toFixed(2)); }
  return out;
}

console.log('BT.alerts tests');

/* ------------------------------------------------------------------ */
test('module exposes the contract surface', () => {
  ['add', 'list', 'remove', 'check', 'describe', 'validate', 'rearm', 'clear', 'on', 'off', 'requestPermission', 'notificationState', 'KINDS'].forEach(f => assert.ok(A[f], 'missing ' + f));
  assert.strictEqual(A.STORAGE_KEY, 'bt.alerts');
  assert.deepStrictEqual(A.kinds, ['price_above', 'price_below', 'rsi_above', 'rsi_below', 'sma_cross', 'signal_change']);
  A.kinds.forEach(k => { assert.ok(A.KINDS[k].label && A.KINDS[k].help.length > 40, k + ' needs a label and educational help text'); });
});

test('add() persists to bt.alerts and normalises the symbol and value', () => {
  fresh();
  const a = A.add({ symbol: ' aapl ', kind: 'price_above', value: '$150.50' });
  assert.strictEqual(a.status, 'ok');
  assert.strictEqual(a.symbol, 'AAPL');
  assert.strictEqual(a.value, 150.5);
  assert.strictEqual(a.enabled, true);
  assert.strictEqual(a.firedAt, null);
  assert.strictEqual(a.id, 1);
  const saved = JSON.parse(localStorage.getItem('bt.alerts'));
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].symbol, 'AAPL');
  assert.strictEqual(A.list().length, 1);
  assert.strictEqual(A.list('aapl').length, 1);
  assert.strictEqual(A.list('MSFT').length, 0);
});

test('add() rejects bad input with a readable reason', () => {
  fresh();
  assert.strictEqual(A.add({ symbol: 'AAPL', kind: 'nope', value: 1 }).status, 'rejected');
  assert.match(A.add({ symbol: '', kind: 'price_above', value: 1 }).reason, /symbol/i);
  assert.match(A.add({ symbol: 'AAPL', kind: 'price_above', value: 'abc' }).reason, /number/i);
  assert.match(A.add({ symbol: 'AAPL', kind: 'price_above', value: -3 }).reason, /above zero/i);
  assert.match(A.add({ symbol: 'AAPL', kind: 'rsi_above', value: 140 }).reason, /0 to 100/);
  assert.match(A.add({ symbol: 'AAPL', kind: 'sma_cross', value: '50/20' }).reason, /fast/i);
  assert.match(A.add({ symbol: 'AAPL', kind: 'signal_change', value: 'MAYBE' }).reason, /BUY, SELL or HOLD/);
  assert.strictEqual(A.list().length, 0);
});

test('duplicate live alerts are rejected; the cap is enforced', () => {
  fresh();
  assert.strictEqual(A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 }).status, 'ok');
  const dup = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  assert.strictEqual(dup.status, 'rejected');
  assert.match(dup.reason, /already exists/);
  for (let i = 0; i < A.MAX_ALERTS + 5; i++) A.add({ symbol: 'MSFT', kind: 'price_above', value: 100 + i });
  assert.strictEqual(A.list().length, A.MAX_ALERTS);
  assert.match(A.add({ symbol: 'NVDA', kind: 'price_below', value: 1 }).reason, /up to 50/);
});

test('remove() and clear() delete alerts and persist', () => {
  fresh();
  const a = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  A.add({ symbol: 'MSFT', kind: 'price_below', value: 300 });
  A.add({ symbol: 'MSFT', kind: 'rsi_below', value: 30 });
  assert.strictEqual(A.remove(a.id).id, a.id);
  assert.strictEqual(A.remove(999), null);
  assert.strictEqual(A.list().length, 2);
  assert.strictEqual(A.clear('msft'), 2);
  assert.strictEqual(A.list().length, 0);
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.alerts')).length, 0);
});

test('state survives a reload from localStorage (and ignores junk)', () => {
  fresh();
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  const raw = JSON.parse(localStorage.getItem('bt.alerts'));
  raw.push({ garbage: true }, { symbol: 'X', kind: 'unknown' }, { id: 7, symbol: 'TSLA', kind: 'rsi_below', value: 25 }); // legacy row missing new fields
  localStorage.setItem('bt.alerts', JSON.stringify(raw));
  const l = A.load();
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[1].enabled, true, 'missing fields are backfilled');
  assert.strictEqual(A.add({ symbol: 'NVDA', kind: 'price_above', value: 1 }).id, 8, 'ids continue after the highest saved id');
});

test('describe() reads like a sentence for every kind', () => {
  fresh();
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'price_above', value: 150 }), 'AAPL price rises above $150.00');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'price_below', value: 0.5 }), 'AAPL price falls below $0.5000');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'rsi_above', value: 70 }), 'AAPL RSI(14) rises above 70');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'rsi_below', value: 30 }), 'AAPL RSI(14) falls below 30');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'sma_cross', value: '9/21' }), 'AAPL SMA 9 crosses SMA 21');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'sma_cross', value: '' }), 'AAPL SMA 20 crosses SMA 50');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'signal_change', value: '' }), 'AAPL signal changes state');
  assert.strictEqual(A.describe({ symbol: 'AAPL', kind: 'signal_change', value: 'BUY' }), 'AAPL signal turns BUY');
});

/* ---------------- price alerts ---------------- */
test('price_above fires on the transition, once, and is then marked fired', () => {
  fresh();
  const a = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  assert.deepStrictEqual(A.check('AAPL', mk([140, 145, 148])), [], 'below the level: nothing');
  fakeNow += 60000;
  const fired = A.check('AAPL', mk([140, 145, 148, 151]));
  assert.strictEqual(fired.length, 1);
  assert.strictEqual(fired[0].id, a.id);
  assert.match(fired[0].message, /AAPL price rises above \$150\.00/);
  assert.match(fired[0].message, /last \$151\.00/);
  assert.strictEqual(fired[0].title, 'Price ≥ · AAPL');
  const after = A.list()[0];
  assert.strictEqual(after.firedAt, fakeNow);
  assert.strictEqual(after.enabled, false);
  assert.strictEqual(after.fired, 1);
  assert.deepStrictEqual(A.check('AAPL', mk([140, 145, 148, 151, 160])), [], 'fired alerts stay quiet');
});

test('price alerts count an intrabar touch (high/low), like a broker stop', () => {
  fresh();
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 150.3 });
  A.add({ symbol: 'AAPL', kind: 'price_below', value: 139.7 });
  const bars = mk([145, 150]);           // high = 150.5 touches 150.3, close 150 does not
  const f = A.check('AAPL', bars);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'price_above');
  assert.match(f[0].detail, /high \$150\.50 touched the level/);
  const g = A.check('AAPL', mk([145, 140]));   // low = 139.5
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].kind, 'price_below');
});

test('a level that is already true when the alert is set fires on the first check', () => {
  fresh();
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 100 });
  const f = A.check('AAPL', mk([150, 151]));
  assert.strictEqual(f.length, 1);
});

test('check() only looks at the alerts for that symbol and ignores empty data', () => {
  fresh();
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 100 });
  A.add({ symbol: 'MSFT', kind: 'price_above', value: 100 });
  assert.deepStrictEqual(A.check('MSFT', []), []);
  assert.deepStrictEqual(A.check('', mk([200])), []);
  const f = A.check('msft', mk([200]));
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].symbol, 'MSFT');
  assert.strictEqual(A.list('AAPL')[0].firedAt, null, 'AAPL untouched');
});

test('rearm() puts a fired alert back on watch and it fires again on a fresh transition', () => {
  fresh();
  const a = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  assert.strictEqual(A.check('AAPL', mk([149, 151])).length, 1);
  const r = A.rearm(a.id);
  assert.strictEqual(r.enabled, true);
  assert.strictEqual(r.firedAt, null);
  assert.strictEqual(r.state, null, 'baseline unknown until the next check');
  assert.strictEqual(A.check('AAPL', mk([149, 151])).length, 0, 'same bars, condition still true → quiet (edge-triggered)');
  assert.strictEqual(A.list()[0].state, true, 'baseline learned');
  assert.strictEqual(A.check('AAPL', mk([149, 151])).length, 0, 'still quiet on repeated ticks');
  assert.strictEqual(A.check('AAPL', mk([151, 140])).length, 0, 'falls below: armed, quiet');
  assert.strictEqual(A.list()[0].state, false);
  assert.strictEqual(A.check('AAPL', mk([140, 155])).length, 1, 'crosses back up: fires');
  assert.strictEqual(A.list()[0].fired, 2);
  // Re-arm while the level is NOT breached: fires on the first breach after that.
  A.rearm(a.id);
  assert.strictEqual(A.check('AAPL', mk([151, 140])).length, 0, 'learns "below" baseline');
  assert.strictEqual(A.check('AAPL', mk([140, 152])).length, 1, 'rises through the level: fires');
  assert.strictEqual(A.list()[0].fired, 3);
});

test('rearm() on sma_cross does not re-fire on the same crossing bars', () => {
  fresh();
  const a = A.add({ symbol: 'AAPL', kind: 'sma_cross', value: '20/50' });
  const bars = mk(trend(60, 100, -1, 0).concat(trend(80, 40, 2, 0)));
  let at = -1;
  for (let i = 50; i < bars.length && at < 0; i++) if (A.check('AAPL', bars.slice(0, i + 1)).length) at = i;
  assert.ok(at > 0, 'golden cross fired');
  A.rearm(a.id);
  assert.strictEqual(A.check('AAPL', bars.slice(0, at + 1)).length, 0, 'identical bars after rearm → quiet');
  assert.strictEqual(A.check('AAPL', bars.slice(0, at + 1)).length, 0, 'still quiet');
  assert.strictEqual(A.list()[0].fired, 1);
});

test('setEnabled(true) on a previously fired alert is edge-triggered like rearm()', () => {
  fresh();
  const a = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  assert.strictEqual(A.check('AAPL', mk([149, 160])).length, 1);
  A.rearm(a.id);
  A.setEnabled(a.id, false);
  assert.strictEqual(A.check('AAPL', mk([149, 160])).length, 0, 'paused');
  const r = A.setEnabled(a.id, true);
  assert.strictEqual(r.state, null, 'resumed after a fire → baseline unknown');
  assert.strictEqual(A.check('AAPL', mk([149, 160])).length, 0, 'still breached → quiet');
  assert.strictEqual(A.check('AAPL', mk([160, 140])).length, 0);
  assert.strictEqual(A.check('AAPL', mk([140, 160])).length, 1, 'fresh transition → fires');
  assert.strictEqual(A.list()[0].fired, 2);
});

test('setEnabled(false) pauses an alert without deleting it', () => {
  fresh();
  const a = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  A.setEnabled(a.id, false);
  assert.strictEqual(A.check('AAPL', mk([149, 160])).length, 0);
  A.setEnabled(a.id, true);
  assert.strictEqual(A.check('AAPL', mk([149, 160])).length, 1);
});

/* ---------------- RSI alerts ---------------- */
test('rsi_above / rsi_below fire from the caller\'s ind.rsi or compute RSI themselves', () => {
  fresh();
  const up = mk(trend(40, 100, 1.5, 0));          // straight up → RSI 100
  const ind = window.BT.ind.computeAll(up);
  assert.ok(ind.rsi[ind.rsi.length - 1] > 70);
  A.add({ symbol: 'AAPL', kind: 'rsi_above', value: 70 });
  A.add({ symbol: 'AAPL', kind: 'rsi_below', value: 30 });
  let f = A.check('AAPL', up, ind);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'rsi_above');
  assert.match(f[0].detail, /^RSI \d+\.\d/);
  assert.match(f[0].detail, /stretched/);
  // Without ind, the module computes RSI from closes on its own.
  const down = mk(trend(40, 200, -1.5, 0));
  f = A.check('AAPL', down);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'rsi_below');
});

test('RSI alerts stay silent when there is not enough history', () => {
  fresh();
  A.add({ symbol: 'AAPL', kind: 'rsi_above', value: 70 });
  assert.deepStrictEqual(A.check('AAPL', mk([1, 2, 3, 4, 5])), []);
});

/* ---------------- SMA crossover ---------------- */
test('sma_cross fires on a golden cross and on a death cross, naming them', () => {
  fresh();
  // 60 bars down then 60 bars up: SMA 20 crosses above SMA 50 on the way up.
  const closes = trend(60, 200, -1, 0).concat(trend(60, 140, 1.5, 0));
  const bars = mk(closes);
  const a = A.add({ symbol: 'AAPL', kind: 'sma_cross', value: '' });
  assert.strictEqual(a.value, '20/50', 'default pair');
  let firedAt = -1, msg = null;
  for (let i = 55; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const f = A.check('AAPL', slice, window.BT.ind.computeAll(slice));
    if (f.length) { firedAt = i; msg = f[0]; break; }
  }
  assert.ok(firedAt > 60 && firedAt < 120, 'fired somewhere on the way up, got ' + firedAt);
  assert.strictEqual(msg.direction, 'up');
  assert.match(msg.detail, /Golden cross/);
  const ind = window.BT.ind.computeAll(bars.slice(0, firedAt + 1));
  assert.ok(ind.sma20[firedAt] > ind.sma50[firedAt] && ind.sma20[firedAt - 1] <= ind.sma50[firedAt - 1], 'fired exactly on the crossing bar');

  // Death cross with a custom 9/21 pair, computing SMAs itself (no ind passed).
  A.rearm(a.id);
  A.remove(a.id);
  A.add({ symbol: 'TSLA', kind: 'sma_cross', value: '9/21' });
  const dn = mk(trend(40, 100, 1, 0).concat(trend(40, 140, -1.5, 0)));
  let got = null;
  for (let i = 25; i < dn.length && !got; i++) { const f = A.check('TSLA', dn.slice(0, i + 1)); if (f.length) got = f[0]; }
  assert.ok(got, 'death cross fired');
  assert.strictEqual(got.direction, 'down');
  assert.match(got.detail, /Death cross: SMA 9 moved below SMA 21/);
});

/* ---------------- Signal change ---------------- */
test('signal_change learns the current state first, then fires when it flips', () => {
  fresh();
  const bars = mk(trend(120, 100, 0, 3));
  const a = A.add({ symbol: 'AAPL', kind: 'signal_change', value: '' });
  const ind = window.BT.ind.computeAll(bars);
  const sig = window.BT.ind.signals(bars, ind);
  assert.deepStrictEqual(A.check('AAPL', bars, Object.assign({}, ind, { signal: sig })), [], 'first check only records the state');
  assert.strictEqual(A.list()[0].lastSignal, sig.state);
  // same state again → nothing
  assert.deepStrictEqual(A.check('AAPL', bars, Object.assign({}, ind, { signal: { state: sig.state } })), []);
  const next = sig.state === 'BUY' ? 'SELL' : 'BUY';
  const f = A.check('AAPL', bars, Object.assign({}, ind, { signal: { state: next } }));
  assert.strictEqual(f.length, 1);
  assert.match(f[0].detail, new RegExp('Signal is now ' + next + ' \\(was ' + sig.state + '\\)'));
  assert.strictEqual(f[0].id, a.id);
});

test('signal_change with a target state only fires for that state', () => {
  fresh();
  const bars = mk(trend(120, 100, 0, 3));
  const ind = window.BT.ind.computeAll(bars);
  A.add({ symbol: 'AAPL', kind: 'signal_change', value: 'sell' });
  assert.strictEqual(A.list()[0].value, 'SELL');
  A.check('AAPL', bars, Object.assign({}, ind, { signal: { state: 'HOLD' } }));
  assert.deepStrictEqual(A.check('AAPL', bars, Object.assign({}, ind, { signal: { state: 'BUY' } })), []);
  assert.strictEqual(A.check('AAPL', bars, Object.assign({}, ind, { signal: { state: 'SELL' } })).length, 1);
});

/* ---------------- Delivery ---------------- */
test('listeners hear about fired alerts; a throwing listener does not break check()', () => {
  fresh();
  const heard = [];
  const off = A.on((fired, meta) => heard.push([fired.map(f => f.id), meta.symbol]));
  A.on(() => { throw new Error('boom'); });
  const a = A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  const f = A.check('AAPL', mk([149, 151]));
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual(heard, [[[a.id], 'AAPL']]);
  off();
  A.rearm(a.id); A.check('AAPL', mk([149, 151]));
  assert.strictEqual(heard.length, 1, 'unsubscribed');
});

test('Notification is sent only when permission is granted; toast goes through BT.app.toast', () => {
  fresh();
  const toasts = [];
  window.BT.app = { toast: (msg, kind, title) => toasts.push({ msg, kind, title }) };
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  A.add({ symbol: 'AAPL', kind: 'price_below', value: 100 });
  assert.strictEqual(A.notificationState(), 'default');
  assert.strictEqual(A.notificationsEnabled(), false);
  A.check('AAPL', mk([149, 151]));
  assert.strictEqual(sent.length, 0, 'no permission → no Notification');
  assert.strictEqual(toasts.length, 1);
  assert.strictEqual(toasts[0].kind, 'ok');
  assert.strictEqual(toasts[0].title, 'Alert: Price ≥ · AAPL');
  FakeNotification.permission = 'granted';           // what requestPermission() would set
  assert.strictEqual(A.notificationsEnabled(), true);
  A.check('AAPL', mk([120, 99]));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].title, 'Price ≤ · AAPL');
  assert.match(sent[0].opts.body, /AAPL price falls below \$100\.00/);
  assert.strictEqual(sent[0].opts.tag, 'bt-alert-2');
  assert.strictEqual(toasts[1].kind, 'warn', 'bearish alerts use the warn tone');
  delete window.BT.app;
});

test('setMuted(true) suppresses toasts and notifications but not listeners', () => {
  fresh();
  FakeNotification.permission = 'granted';
  const heard = [];
  A.on(f => heard.push(f.length));
  A.setMuted(true);
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  A.check('AAPL', mk([149, 151]));
  assert.strictEqual(sent.length, 0);
  assert.deepStrictEqual(heard, [1]);
  A.setMuted(false);
});

test('unsupported browsers report "unsupported" and never throw', () => {
  fresh();
  const N = window.Notification; delete window.Notification;
  assert.strictEqual(A.notificationState(), 'unsupported');
  assert.strictEqual(A.notificationsEnabled(), false);
  A.add({ symbol: 'AAPL', kind: 'price_above', value: 150 });
  assert.strictEqual(A.check('AAPL', mk([149, 151])).length, 1);
  window.Notification = N;
});

test('requestPermission() resolves with the browser\'s answer (and "unsupported" without Notification)', () => {
  const N = window.Notification; delete window.Notification;
  const p1 = A.requestPermission();
  window.Notification = N; N.permission = 'default';
  const p2 = A.requestPermission();
  return Promise.all([p1, p2]).then(([u, g]) => { assert.strictEqual(u, 'unsupported'); assert.strictEqual(g, 'granted'); });
});

/* ---------------- wrap-up (async-aware) ---------------- */
// A couple of tests return promises; wait for them before printing the summary.
Promise.all(pending).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
