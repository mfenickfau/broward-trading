/* Broward Trading — tests for js/screener.js (BT.screener)
 * Run with:  node tests/screener.test.js
 * Plain node + assert, no framework. `window`/localStorage are shimmed; js/data.js and
 * js/indicators.js are loaded for real. Synthetic bar fixtures are built so that each one
 * triggers exactly one condition at a known bar (golden cross, RSI < 30, Bollinger squeeze,
 * new 52-week high) and run() must return exactly those symbols. No network, no DOM.
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
global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent() {} };
require(path.join(__dirname, '..', 'js', 'data.js'));
require(path.join(__dirname, '..', 'js', 'indicators.js'));
require(path.join(__dirname, '..', 'js', 'screener.js'));
const S = window.BT.screener;
const D = window.BT.data;
const I = window.BT.ind;

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

// ---- fixtures ----------------------------------------------------------
const N = 300, L = N - 1;
function dateAt(i) { return new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10); }
function toBars(closes) {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: dateAt(i), open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 2e6 };
  });
}
function series(fn) { const out = []; for (let i = 0; i < N; i++) out.push(fn(i)); return out; }
const alt = i => (i % 2 ? 1 : -1);                       // +1 on odd bars, −1 on even bars

const GOLD_AT = 295;                                     // SMA 50 crosses above SMA 200 exactly on this bar
const FIX = {
  // Flat at 100, then 101 from GOLD_AT on: SMA50 = 100 + k/50 > SMA200 = 100 + k/200 for k ≥ 1, equal before.
  GOLD: toBars(series(i => (i < GOLD_AT ? 100 : 101))),
  // Mild uptrend with ±1 noise, then 20 straight down days: RSI collapses far below 30.
  DUMP: toBars(series(i => (i < 280 ? 100 + 0.01 * i + alt(i) : 100 + 0.01 * 279 - 1.5 * (i - 279)))),
  // Wild ±3 alternation, then the last 20 bars nearly still (±0.05): band width is the lowest of 120 bars.
  SQZ: toBars(series(i => 100 + 0.01 * i + (i < 280 ? 3 : 0.05) * alt(i))),
  // Steady climb with growing noise, latest bar is an up bar: a fresh 52-week high (and no squeeze).
  HIGH: toBars(series(i => 100 + 0.3 * i + (0.5 + 0.01 * i) * alt(i))),
  // Control: gentle drift down with constant noise. Nothing should match.
  FLAT: toBars(series(i => 100 - 0.01 * i + alt(i)))
};
const META = {
  GOLD: { symbol: 'GOLD', name: 'Golden Cross Co.', sector: 'Industrials', kind: 'stock' },
  DUMP: { symbol: 'DUMP', name: 'Oversold Inc.', sector: 'Technology', kind: 'stock' },
  SQZ: { symbol: 'SQZ', name: 'Squeeze Corp.', sector: 'Technology', kind: 'stock' },
  HIGH: { symbol: 'HIGH', name: 'High Flyer', sector: 'Health Care', kind: 'stock' },
  FLAT: { symbol: 'FLAT', name: 'Flatline ETF', sector: 'ETF — test', kind: 'etf' }
};
const UNIVERSE = Object.keys(META).map(k => META[k]);
function makeFetch(calls) {
  return async (sym, interval, limit) => {
    if (calls) calls.push({ sym, interval, limit });
    const b = FIX[sym];
    if (!b) throw new Error('unknown ' + sym);
    return b.map(x => Object.assign({}, x));
  };
}
async function syms(filters, opts) {
  const rows = await S.run(UNIVERSE, filters, Object.assign({ fetch: makeFetch() }, opts || {}));
  return rows.map(r => r.symbol).sort();
}

console.log('screener.js');

// ---- sanity on the fixtures themselves (so a failing run() test points at the screener) ----
test('fixtures: golden cross really happens on bar ' + GOLD_AT, () => {
  const c = FIX.GOLD.map(b => b.close), f = I.sma(c, 50), s = I.sma(c, 200);
  assert.ok(f[GOLD_AT] > s[GOLD_AT] && f[GOLD_AT - 1] <= s[GOLD_AT - 1]);
  assert.deepStrictEqual(S._internal.crossInfo(f, s, L), { golden: L - GOLD_AT, death: null });
});
test('fixtures: DUMP RSI < 30, SQZ band width rank ≤ 10 %, HIGH makes a 52-week high', () => {
  assert.ok(I.rsi(FIX.DUMP.map(b => b.close), 14)[L] < 30);
  const snap = S.snapshot(FIX.SQZ, META.SQZ);
  assert.ok(snap.bwRank <= 10 && snap.squeeze === true, 'rank ' + snap.bwRank);
  const h = FIX.HIGH;
  assert.ok(h[L].high > Math.max.apply(null, h.slice(L - 251, L).map(b => b.high)));
});

// ---- snapshot -----------------------------------------------------------
test('snapshot: core fields', () => {
  const s = S.snapshot(FIX.HIGH, META.HIGH);
  assert.strictEqual(s.symbol, 'HIGH'); assert.strictEqual(s.kind, 'stock'); assert.strictEqual(s.bars, N);
  assert.strictEqual(s.price, FIX.HIGH[L].close);
  const c = FIX.HIGH.map(b => b.close);
  assert.ok(Math.abs(s.chg1d - (c[L] / c[L - 1] - 1) * 100) < 1e-3);
  assert.ok(Math.abs(s.chg5d - (c[L] / c[L - 5] - 1) * 100) < 1e-3);
  assert.ok(Math.abs(s.chg1m - (c[L] / c[L - 21] - 1) * 100) < 1e-3);
  assert.strictEqual(s.avgVol, 2e6);
  assert.ok(Math.abs(s.sma200 - I.sma(c, 200)[L]) < 1e-9);
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(s.signal));
  assert.strictEqual(s.newHigh52, true); assert.strictEqual(s.newLow52, false);
  assert.ok(s.squeeze === false, 'growing noise means no squeeze');
});
test('snapshot: too little history → nulls, never a crash', () => {
  const s = S.snapshot(FIX.HIGH.slice(0, 30), META.HIGH);
  assert.strictEqual(s.sma200, null); assert.strictEqual(s.newHigh52, null); assert.strictEqual(s.squeeze, null);
  assert.strictEqual(s.cross['50/200'].golden, null);
  const e = S.snapshot([], META.HIGH);
  assert.strictEqual(e.price, null); assert.strictEqual(e.bars, 0);
});
test('snapshot: crypto needs 365 days for a 52-week high', () => {
  const s = S.snapshot(FIX.HIGH, { symbol: 'X-USD', kind: 'crypto' });
  assert.strictEqual(s.newHigh52, null);
});
test('snapshot: is structured-clone safe (plain JSON round trip)', () => {
  const s = S.snapshot(FIX.GOLD, META.GOLD);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), s);
});

// ---- run() matches exactly the designed symbols -----------------------
test('run: golden cross within 5 bars → exactly GOLD (cross 4 bars ago)', async () => {
  assert.deepStrictEqual(await syms([{ id: 'goldenCross', params: { pair: '50/200', within: 5 } }]), ['GOLD']);
});
test('run: golden cross within 4 bars → nothing (the cross is 4 bars old)', async () => {
  assert.deepStrictEqual(await syms([{ id: 'goldenCross', params: { pair: '50/200', within: 4 } }]), []);
});
test('run: RSI(14) below 30 → exactly DUMP', async () => {
  assert.deepStrictEqual(await syms([{ id: 'rsi', params: { max: 30 } }]), ['DUMP']);
});
test('run: Bollinger squeeze → exactly SQZ', async () => {
  assert.deepStrictEqual(await syms([{ id: 'squeeze' }]), ['SQZ']);
});
test('run: new 52-week high → exactly HIGH', async () => {
  assert.deepStrictEqual(await syms([{ id: 'high52' }]), ['HIGH']);
});
test('run: no filters → whole universe, in universe order, with row shape', async () => {
  const rows = await S.run(UNIVERSE, [], { fetch: makeFetch() });
  assert.deepStrictEqual(rows.map(r => r.symbol), ['GOLD', 'DUMP', 'SQZ', 'HIGH', 'FLAT']);
  const r = rows[0];
  ['symbol', 'name', 'price', 'chg1d', 'rsi', 'signal', 'matched'].forEach(k => assert.ok(k in r, 'row missing ' + k));
  assert.strictEqual(r.name, 'Golden Cross Co.');
  assert.deepStrictEqual(r.matched, []);
  assert.strictEqual(rows.total, 5); assert.strictEqual(rows.scanned, 5); assert.strictEqual(rows.mode, 'custom');
});
test('run: AND of filters, matched lists every filter id, why explains', async () => {
  const rows = await S.run(UNIVERSE, [{ id: 'high52' }, { id: 'sma', params: { n: '200', side: 'above' } }], { fetch: makeFetch() });
  assert.deepStrictEqual(rows.map(r => r.symbol), ['HIGH']);
  assert.deepStrictEqual(rows[0].matched, ['high52', 'sma']);
  assert.strictEqual(rows[0].why.length, 2);
  assert.ok(/New high/.test(rows[0].why[0]));
});
test('run: match "any" → union, matched shows which filter hit', async () => {
  const rows = await S.run(UNIVERSE, [{ id: 'rsi', params: { max: 30 } }, { id: 'squeeze' }], { fetch: makeFetch(), match: 'any' });
  assert.deepStrictEqual(rows.map(r => r.symbol), ['DUMP', 'SQZ']);
  assert.deepStrictEqual(rows[0].matched, ['rsi']);
  assert.deepStrictEqual(rows[1].matched, ['squeeze']);
});
test('run: price below SMA filters', async () => {
  assert.deepStrictEqual(await syms([{ id: 'sma', params: { n: '50', side: 'below' } }]), ['DUMP']);
  assert.deepStrictEqual(await syms([{ id: 'sma', params: { n: '50', side: 'above', maxPct: 2 } }]), ['FLAT', 'GOLD', 'SQZ']);
  assert.deepStrictEqual(await syms([{ id: 'sma', params: { n: '50', side: 'below', minPct: 10 } }]), ['DUMP']);
});
test('run: % change and price filters', async () => {
  assert.deepStrictEqual(await syms([{ id: 'change', params: { period: '5d', max: -5 } }]), ['DUMP']);
  assert.deepStrictEqual(await syms([{ id: 'price', params: { min: 150 } }]), ['HIGH']);
  assert.deepStrictEqual(await syms([{ id: 'volume', params: { min: 3 } }]), []);
  assert.deepStrictEqual((await syms([{ id: 'volume', params: { min: 1 } }])).length, 5);
});
test('run: static filters (sector/kind) skip requests for non-matching symbols', async () => {
  const calls = [];
  const rows = await S.run(UNIVERSE, [{ id: 'sector', params: { values: ['Technology'] } }, { id: 'rsi', params: { max: 30 } }], { fetch: makeFetch(calls) });
  assert.deepStrictEqual(rows.map(r => r.symbol), ['DUMP']);
  assert.deepStrictEqual(calls.map(c => c.sym).sort(), ['DUMP', 'SQZ']);
  assert.strictEqual(calls[0].interval, '1day'); assert.strictEqual(calls[0].limit, 400);
  const etf = await syms([{ id: 'kind', params: { values: ['etf'] } }]);
  assert.deepStrictEqual(etf, ['FLAT']);
});
test('run: a failing symbol lands in rows.errors, the rest still scan', async () => {
  const rows = await S.run(UNIVERSE.concat([{ symbol: 'NOPE', name: 'Missing' }]), [{ id: 'squeeze' }], { fetch: makeFetch() });
  assert.deepStrictEqual(rows.map(r => r.symbol), ['SQZ']);
  assert.strictEqual(rows.errors.length, 1); assert.strictEqual(rows.errors[0].symbol, 'NOPE');
});
test('run: unknown filter id throws', async () => {
  await assert.rejects(() => S.run(UNIVERSE, [{ id: 'astrology' }], { fetch: makeFetch() }), /Unknown screener filter/);
});
test('run: progress callback reaches done', async () => {
  const seen = [];
  await S.run(UNIVERSE, [{ id: 'squeeze' }], { fetch: makeFetch(), onProgress: p => seen.push(p) });
  const last = seen[seen.length - 1];
  assert.strictEqual(last.phase, 'done'); assert.strictEqual(last.total, 5); assert.strictEqual(last.done, 5);
  assert.ok(seen.some(p => p.phase === 'fetch' && p.symbol === 'HIGH'));
});
test('run: abort signal stops the scan and lists skipped symbols', async () => {
  const ac = { aborted: false, addEventListener() {}, removeEventListener() {} };
  let n = 0;
  const fetch = async sym => { if (++n === 2) ac.aborted = true; return FIX[sym]; };
  const rows = await S.run(UNIVERSE, [], { fetch, signal: ac });
  assert.strictEqual(rows.cancelled, true);
  assert.strictEqual(rows.scanned, 2);
  assert.strictEqual(rows.skipped.length, 3);
});

// ---- rate limiter --------------------------------------------------------
test('limiter: per-minute refusal waits retryInMs, then fetches (one at a time)', async () => {
  let checks = 0, inflight = 0, maxInflight = 0;
  const waits = [], phases = [];
  const limiter = { check() { checks++; return checks === 2 ? { ok: false, retryInMs: 1234, reason: 'per-minute' } : { ok: true }; } };
  const fetch = async sym => { inflight++; maxInflight = Math.max(maxInflight, inflight); await new Promise(r => setTimeout(r, 1)); inflight--; return FIX[sym]; };
  const rows = await S.run(UNIVERSE, [], { fetch, limiter, sleep: async ms => { waits.push(ms); }, onProgress: p => phases.push(p.phase) });
  assert.deepStrictEqual(waits, [1234]);
  assert.ok(phases.includes('wait'));
  assert.strictEqual(rows.length, 5);
  assert.strictEqual(maxInflight, 1);
});
test('limiter: daily limit stops the scan without spending more requests', async () => {
  const calls = [];
  let n = 0;
  const limiter = { check() { return ++n > 2 ? { ok: false, retryInMs: 3600000, reason: 'daily limit' } : { ok: true }; } };
  const rows = await S.run(UNIVERSE, [], { fetch: makeFetch(calls), limiter, sleep: async () => { throw new Error('must not wait'); } });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(rows.scanned, 2);
  assert.deepStrictEqual(rows.skipped.map(s => s.symbol), ['SQZ', 'HIGH', 'FLAT']);
  assert.strictEqual(rows.stopReason, 'daily limit');
});
test('limiter: cached symbols skip the quota check', async () => {
  let checks = 0;
  const limiter = { isCached: s => s !== 'GOLD', check() { checks++; return { ok: true }; } };
  await S.run(UNIVERSE, [], { fetch: makeFetch(), limiter });
  assert.strictEqual(checks, 1);
});
test('limiter: a last-moment rate_limit fallback is retried once, simulated bars are flagged', async () => {
  const waits = [];
  const seen = {};
  const fetch = async sym => {
    seen[sym] = (seen[sym] || 0) + 1;
    const b = FIX[sym].map(x => Object.assign({}, x));
    if (sym === 'GOLD' && seen[sym] === 1) return Object.assign(b, { fallback: true, code: 'rate_limit', retryInMs: 500, reason: 'busy' });
    if (sym === 'FLAT') return Object.assign(b, { fallback: true, code: 'nokey', reason: 'No key saved' });
    return b;
  };
  const rows = await S.run(UNIVERSE, [], { fetch, limiter: { check: () => ({ ok: true }) }, sleep: async ms => { waits.push(ms); } });
  assert.strictEqual(seen.GOLD, 2); assert.deepStrictEqual(waits, [500]);
  const flat = rows.find(r => r.symbol === 'FLAT');
  assert.strictEqual(flat.simulated, true); assert.strictEqual(flat.reason, 'No key saved');
  assert.strictEqual(rows.find(r => r.symbol === 'GOLD').simulated, false);
  assert.strictEqual(rows.simulated, 1);
});

// ---- demo provider path (default fetch) -----------------------------------
test('demo: default fetch scans BT.data demo bars, memoised within the minute', async () => {
  S._internal.clearMemo();
  const list = ['AAPL', 'MSFT', 'BTC-USD'];
  const r1 = await S.run(list, [], {});
  assert.strictEqual(r1.mode, 'demo'); assert.strictEqual(r1.length, 3);
  const direct = S.snapshot(D.demo('MSFT', '1day', 400), { symbol: 'MSFT', kind: 'stock' });
  const msft = r1.find(r => r.symbol === 'MSFT');
  assert.strictEqual(msft.price, direct.price); assert.strictEqual(msft.signal, direct.signal);
  assert.strictEqual(msft.name, 'Microsoft Corp.');
  assert.strictEqual(r1.find(r => r.symbol === 'BTC-USD').kind, 'crypto');
  const t = Date.now();
  const r2 = await S.run(list, [{ id: 'price', params: { min: 0 } }], {});
  assert.ok(Date.now() - t < 100, 'second scan should come from the memo');
  assert.deepStrictEqual(r2.map(r => r.price), r1.map(r => r.price));
});
test('demo: snapshots persist in bt.screener.cache and expire after 10 minutes', async () => {
  S._internal.clearMemo();
  await S.run(['KO'], [], {});
  const saved = JSON.parse(store['bt.screener.cache']);
  assert.strictEqual(saved.v, 1);
  assert.ok(saved.entries['KO|1day|400'].snap.price > 0);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + S._internal.DEMO_TTL_MS + 1000;
    let calls = 0; const realDemo = D.demo;
    D.demo = function () { calls++; return realDemo.apply(this, arguments); };
    try { await S.run(['KO'], [], {}); } finally { D.demo = realDemo; }
    assert.strictEqual(calls, 1, 'stale snapshot must be recomputed');
  } finally { Date.now = realNow; }
});
test('demo: universe specs resolve against BT.data.universe and the watchlist', () => {
  assert.strictEqual(S.resolveUniverse('all').length, D.universe.length);
  assert.ok(S.resolveUniverse('etf').every(m => m.kind === 'etf'));
  assert.deepStrictEqual(S.resolveUniverse('crypto').map(m => m.symbol), ['BTC-USD', 'ETH-USD', 'SOL-USD']);
  delete store['bt.watchlist'];
  assert.deepStrictEqual(S.resolveUniverse('watchlist').map(m => m.symbol), ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN']);
  store['bt.watchlist'] = JSON.stringify(['nvda', 'KO', 'NVDA', '<x>']);
  assert.deepStrictEqual(S.resolveUniverse('watchlist').map(m => m.symbol), ['NVDA', 'KO', 'X']);
  assert.deepStrictEqual(S.resolveUniverse(['aapl', { symbol: 'ZZZ', name: 'Custom' }]).map(m => m.name), ['Apple Inc.', 'Custom']);
});

// ---- catalogue, describe, scans -----------------------------------------------
test('catalogue: every contract filter exists with test/describe and defaults', () => {
  ['price', 'change', 'volume', 'rsi', 'sma', 'goldenCross', 'deathCross', 'squeeze', 'high52', 'low52', 'pattern', 'signal', 'sector', 'kind', 'adx']
    .forEach(id => {
      const f = S.filters[id];
      assert.ok(f, 'missing filter ' + id);
      assert.strictEqual(typeof f.test, 'function'); assert.strictEqual(typeof f.describe, 'function');
      assert.ok(f.label && f.group && f.help);
      assert.strictEqual(typeof f.describe(f.defaults), 'string');
    });
  assert.strictEqual(S.filterList.length, Object.keys(S.filters).length);
});
test('describe: plain-English sentence', () => {
  assert.strictEqual(S.describe([{ id: 'rsi', params: { max: 30 } }, { id: 'sma', params: { n: '200', side: 'above' } }]),
    'Symbols with RSI(14) at most 30 and price above its SMA 200.');
  assert.strictEqual(S.describe([{ id: 'squeeze' }, { id: 'high52' }], 'any'),
    'Symbols with any of: Bollinger Band width in the lowest 10 % of the last 120 bars or a new 52-week high today.');
  assert.ok(/every symbol/.test(S.describe([])));
});
test('pattern filter: specific name and bias', () => {
  const snap = { patterns: [{ name: 'Bullish engulfing', bias: 'bull' }] };
  assert.strictEqual(S.evaluate(snap, [{ id: 'pattern', params: { name: 'Bullish engulfing' } }]).pass, true);
  assert.strictEqual(S.evaluate(snap, [{ id: 'pattern', params: { name: 'bull' } }]).pass, true);
  assert.strictEqual(S.evaluate(snap, [{ id: 'pattern', params: { name: 'bear' } }]).pass, false);
  assert.strictEqual(S.evaluate(snap, [{ id: 'pattern', params: { name: 'Hammer' } }]).pass, false);
});
test('normFilters: no params → defaults; partial params → choices keep defaults, bounds become null', () => {
  assert.deepStrictEqual(S.normFilters([{ id: 'change' }])[0].params, { period: '1d', min: 2, max: null });
  assert.deepStrictEqual(S.normFilters([{ id: 'change', params: { max: -5 } }])[0].params, { period: '1d', min: null, max: -5 });
  assert.deepStrictEqual(S.normFilters(['goldenCross'])[0].params, { pair: '50/200', within: 5 });
  assert.deepStrictEqual(S.normFilters([{ id: 'goldenCross', params: { pair: '20/50' } }])[0].params, { pair: '20/50', within: 5 });
});
test('evaluate: null (not enough data) never passes', () => {
  assert.strictEqual(S.evaluate({ rsi: null }, [{ id: 'rsi', params: { max: 30 } }]).pass, false);
  assert.strictEqual(S.evaluate({ squeeze: null }, [{ id: 'squeeze' }]).results[0].ok, null);
});
test('scans: six built-ins with the contract names', () => {
  assert.deepStrictEqual(S.builtins.map(s => s.name), ['Oversold in an uptrend', 'Golden cross this week', 'Squeeze setups', '52-week highs', 'Bullish engulfing today', 'Strong trend (ADX>25)']);
  S.builtins.forEach(s => { assert.ok(s.builtin && s.description); S.normFilters(s.filters); });
});
test('scans: save, overwrite by name, list, delete (bt.screener.scans)', () => {
  delete store['bt.screener.scans'];
  const a = S.saveScan({ name: 'My dip buys', filters: [{ id: 'rsi', params: { max: 25 } }], universe: 'stock' });
  assert.ok(a.id && a.savedAt);
  assert.strictEqual(JSON.parse(store['bt.screener.scans']).length, 1);
  const b = S.saveScan({ name: 'my dip buys', filters: [{ id: 'rsi', params: { max: 20 } }], match: 'any' });
  assert.strictEqual(b.id, a.id);
  assert.strictEqual(S.savedScans().length, 1);
  assert.strictEqual(S.getScan(a.id).filters[0].params.max, 20);
  assert.strictEqual(S.getScan(a.id).match, 'any');
  assert.strictEqual(S.scans().length, 7);
  assert.throws(() => S.saveScan({ name: '  ', filters: [] }), /name/);
  assert.throws(() => S.saveScan({ name: 'bad', filters: [{ id: 'nope' }] }), /Unknown/);
  assert.strictEqual(S.deleteScan(a.id), true);
  assert.strictEqual(S.savedScans().length, 0);
  store['bt.screener.scans'] = '{broken';
  assert.deepStrictEqual(S.savedScans(), []);
});
test('sortRows: numeric, string, nulls last', () => {
  const rows = [{ symbol: 'B', rsi: 50 }, { symbol: 'A', rsi: null }, { symbol: 'C', rsi: 20 }];
  assert.deepStrictEqual(S.sortRows(rows.slice(), 'rsi', 'asc').map(r => r.symbol), ['C', 'B', 'A']);
  assert.deepStrictEqual(S.sortRows(rows.slice(), 'rsi', 'desc').map(r => r.symbol), ['B', 'C', 'A']);
  assert.deepStrictEqual(S.sortRows(rows.slice(), 'symbol', 'desc').map(r => r.symbol), ['C', 'B', 'A']);
});
test('format helpers', () => {
  assert.strictEqual(S.format.pct(1.234), '+1.2 %');
  assert.strictEqual(S.format.pct(null), '—');
  assert.strictEqual(S.format.vol(2.5e6), '2.5M');
  assert.strictEqual(S.format.price(0.12345), '$0.1235');
});

// ---- runner ----------------------------------------------------------------
(async () => {
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n       ') : e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
