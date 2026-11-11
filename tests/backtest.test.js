/* Broward Trading — tests for js/backtest.js (BT.backtest)
 * Run with:  node tests/backtest.test.js
 * Plain node + assert. The modules expect a `window` global, so we shim one.
 * js/indicators.js is loaded first when present; if BT.ind is missing (or the
 * file is absent) a minimal sma stub is installed so the engine tests still run
 * (backtest.js has its own fallbacks for the rest).
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

global.window = {};
const indPath = path.join(__dirname, '..', 'js', 'indicators.js');
if (fs.existsSync(indPath)) { try { require(indPath); } catch (e) { console.log('  (indicators.js failed to load: ' + e.message + ')'); } }
if (!window.BT || !window.BT.ind) {
  window.BT = window.BT || {};
  window.BT.ind = {
    sma: function (v, n) { return v.map((_, i) => i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n); }
  };
  console.log('  (BT.ind missing — using minimal sma stub)');
}
require(path.join(__dirname, '..', 'js', 'backtest.js'));
const B = window.BT.backtest;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a + ' (tol ' + tol + ')');
}

/* ───────────── fixtures ───────────── */
function dayStr(i, start) { const d = new Date((start || Date.UTC(2022, 0, 3)) + i * 86400000); return d.toISOString().slice(0, 10); }
/** Daily bars with a slow sine-wave trend over a drift, deterministic. Weekdays only. */
function trendBars(n, opts) {
  opts = opts || {};
  const out = []; let d = new Date(Date.UTC(2022, 0, 3)); let i = 0; let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const k = out.length;
      const base = 100 + k * (opts.drift == null ? 0.05 : opts.drift) + 15 * Math.sin(k / 25);
      const noise = (rnd() - 0.5) * 2;
      const open = base + noise, close = base + (rnd() - 0.5) * 2;
      out.push({ time: d.toISOString().slice(0, 10), open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + k });
      i++;
    }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
/** Simple hand-made bars: array of [open, close]; time = day index. */
function bars(oc) {
  return oc.map((p, i) => ({ time: dayStr(i), open: p[0], high: Math.max(p[0], p[1]) + 1, low: Math.min(p[0], p[1]) - 1, close: p[1], volume: 100 }));
}
/** Script strategy: fires the given signal at the given bar indices. */
function script(map) { return { id: 'script', name: 'script', description: '', params: {}, onBar: (ctx, i) => map[i] || null }; }

console.log('BT.backtest tests');

/* ───────────── strategies ───────────── */
test('all built-in strategies exist and have the contract shape', () => {
  ['smaCross', 'rsiReversion', 'macdCross', 'bollingerBounce', 'breakout', 'compositeSignal'].forEach(id => {
    const s = B[id]();
    assert.strictEqual(s.id, id);
    assert.ok(s.name && s.description && s.params && typeof s.onBar === 'function', id);
  });
  assert.strictEqual(B.buyAndHold.id, 'buyAndHold');
  assert.strictEqual(typeof B.buyAndHold.onBar, 'function');
  assert.strictEqual(B.builtins.length, 7);
});

test('factories accept positional args or a params object', () => {
  assert.deepStrictEqual(B.smaCross(10, 100).params, { fast: 10, slow: 100 });
  assert.deepStrictEqual(B.smaCross({ fast: 10, slow: 100 }).params, { fast: 10, slow: 100 });
  assert.deepStrictEqual(B.rsiReversion().params, { low: 30, high: 70, n: 14 });
  assert.deepStrictEqual(B.breakout(55).params, { n: 55 });
  assert.deepStrictEqual(B.smaCross(50, 20).params, { fast: 20, slow: 50 }, 'swaps fast/slow when reversed');
});

test('every built-in runs on 400 bars without throwing and produces equity per bar', () => {
  const bs = trendBars(400);
  B.builtins.forEach(b => {
    const r = B.run(b.factory(b.defaults), bs);
    assert.strictEqual(r.error, null, b.id);
    assert.strictEqual(r.errors, 0, b.id + ' strategy threw');
    assert.strictEqual(r.equity.length, bs.length, b.id);
    assert.ok(r.equity.every(e => typeof e.equity === 'number' && isFinite(e.equity)), b.id);
  });
});

test('smaCross and rsiReversion actually trade on wavy data', () => {
  const bs = trendBars(400);
  assert.ok(B.run(B.smaCross(10, 30), bs).trades.length >= 2);
  assert.ok(B.run(B.rsiReversion(30, 70), bs).trades.length >= 2);
  assert.ok(B.run(B.breakout(20), bs).trades.length >= 2);
});

/* ───────────── engine mechanics ───────────── */
test('next-bar-open fills: a signal on bar i fills at open of bar i+1 (no look-ahead)', () => {
  const bs = bars([[10, 11], [12, 13], [14, 15], [16, 17], [18, 19]]);
  const r = B.run(script({ 1: 'buy', 3: 'sell' }), bs, { cash: 1000 });
  assert.strictEqual(r.trades.length, 1);
  const t = r.trades[0];
  assert.strictEqual(t.entryIndex, 2); assert.strictEqual(t.entry, 14);   // bar 2 open, not bar 1 close (13)
  assert.strictEqual(t.exitIndex, 4); assert.strictEqual(t.exit, 18);     // bar 4 open, not bar 3 close (17)
  assert.strictEqual(t.qty, Math.floor(1000 / 14));
  near(t.pnl, (18 - 14) * 71); assert.strictEqual(t.bars, 2);
  assert.strictEqual(t.openAtEnd, false);
});

test('signal on the last bar cannot fill and is reported as pendingSignal', () => {
  const bs = bars([[10, 11], [12, 13], [14, 15]]);
  const r = B.run(script({ 2: 'buy' }), bs);
  assert.strictEqual(r.trades.length, 0);
  assert.strictEqual(r.pendingSignal, 'long');
});

test('slippage worsens both entry and exit; commission charged per fill', () => {
  const bs = bars([[100, 100], [100, 100], [100, 100], [100, 100]]);
  const r = B.run(script({ 0: 'buy', 2: 'sell' }), bs, { cash: 10000, slippageBps: 100, commission: 5 });
  const t = r.trades[0];
  near(t.entry, 101); near(t.exit, 99);
  assert.strictEqual(t.qty, Math.floor((10000 - 5) / 101));   // 98
  near(t.pnl, (99 - 101) * 98 - 10);
  near(t.commission, 10);
  near(r.stats.finalEquity, 10000 + t.pnl, 1e-6);
  near(r.stats.totalCommission, 10);
});

test('position sizing: sizePct controls how much equity goes into each entry', () => {
  const bs = bars([[50, 50], [50, 50], [50, 50]]);
  const r = B.run(script({ 0: 'buy' }), bs, { cash: 10000, sizePct: 25 });
  assert.strictEqual(r.trades[0].qty, 50);                     // 2500 / 50
  const r2 = B.run(script({ 0: 'buy' }), bs, { cash: 30, sizePct: 100 });
  assert.strictEqual(r2.trades.length, 0, 'cannot afford one share → no trade');
  assert.strictEqual(r2.stats.trades, 0);
});

test('redundant signals are ignored (no pyramiding); open position is closed at the end and flagged', () => {
  const bs = bars([[10, 10], [10, 10], [10, 10], [10, 10], [10, 12]]);
  const r = B.run(script({ 0: 'buy', 1: 'buy', 2: 'buy' }), bs, { cash: 1000 });
  assert.strictEqual(r.trades.length, 1);
  assert.strictEqual(r.trades[0].openAtEnd, true);
  assert.strictEqual(r.trades[0].exit, 12);
  near(r.stats.finalEquity, 1000 + 2 * 100);
  assert.strictEqual(r.markers.length, 1, 'no exit marker for the forced end-of-data close');
});

test('sell while flat does nothing unless allowShort; shorting profits from falls', () => {
  const bs = bars([[100, 100], [100, 100], [100, 100], [80, 80], [80, 80]]);
  const noShort = B.run(script({ 0: 'sell', 2: 'buy' }), bs, { cash: 10000 });
  // the 'sell' while flat is ignored; only the later 'buy' trades (a long, closed at the end)
  assert.strictEqual(noShort.trades.length, 1); assert.strictEqual(noShort.trades[0].side, 'long');
  assert.strictEqual(B.run(script({ 0: 'sell' }), bs, { cash: 10000 }).trades.length, 0);
  const shorted = B.run(script({ 0: 'sell', 2: 'buy' }), bs, { cash: 10000, allowShort: true });
  // 'buy' while short covers AND reverses long, so two trades: the short, then a flat long closed at the end
  assert.strictEqual(shorted.trades.length, 2);
  const t = shorted.trades[0];
  assert.strictEqual(t.side, 'short'); assert.strictEqual(t.entry, 100); assert.strictEqual(t.exit, 80);
  near(t.pnl, 20 * 100); near(shorted.stats.finalEquity, 12000);
  assert.strictEqual(shorted.trades[1].side, 'long'); assert.strictEqual(shorted.trades[1].entry, 80); assert.strictEqual(shorted.trades[1].openAtEnd, true);
  // with 'exit' instead of 'buy', only the short is traded
  assert.strictEqual(B.run(script({ 0: 'sell', 2: 'exit' }), bs, { cash: 10000, allowShort: true }).trades.length, 1);
  // equity marked correctly while short (cash + negative qty × close)
  near(shorted.equity[1].equity, 10000); near(shorted.equity[3].equity, 12000);
});

test('allowShort: sell while long is a stop-and-reverse (closes long, opens short at same fill)', () => {
  const bs = bars([[10, 10], [10, 10], [12, 12], [12, 12], [9, 9]]);
  const r = B.run(script({ 0: 'buy', 1: 'sell' }), bs, { cash: 1200, allowShort: true });
  assert.strictEqual(r.trades.length, 2);
  assert.strictEqual(r.trades[0].side, 'long'); assert.strictEqual(r.trades[0].exitIndex, 2);
  assert.strictEqual(r.trades[1].side, 'short'); assert.strictEqual(r.trades[1].entryIndex, 2); assert.strictEqual(r.trades[1].entry, 12);
  assert.strictEqual(r.trades[1].openAtEnd, true); assert.strictEqual(r.trades[1].exit, 9);
});

test("'exit' closes any position without opening a new one", () => {
  const bs = bars([[10, 10], [10, 10], [10, 10], [10, 10]]);
  const r = B.run(script({ 0: 'buy', 1: 'exit' }), bs, { cash: 1000, allowShort: true });
  assert.strictEqual(r.trades.length, 1); assert.strictEqual(r.trades[0].exitIndex, 2);
  assert.strictEqual(r.trades[0].openAtEnd, false);
});

test('startIndex warm-up: no trades before it and stats start there', () => {
  const bs = bars([[10, 10], [10, 10], [10, 10], [10, 10], [10, 20], [20, 20]]);
  const r = B.run(script({ 0: 'buy', 3: 'buy' }), bs, { cash: 1000, startIndex: 3 });
  assert.strictEqual(r.trades.length, 1); assert.strictEqual(r.trades[0].entryIndex, 4);
  assert.strictEqual(r.stats.bars, 3);
  near(r.stats.exposurePct, 200 / 3, 1e-9);
});

test('a throwing strategy does not crash the run', () => {
  const r = B.run({ id: 'bad', name: 'bad', params: {}, onBar: () => { throw new Error('boom'); } }, bars([[1, 1], [1, 1], [1, 1]]));
  assert.strictEqual(r.error, null); assert.strictEqual(r.errors, 3); assert.strictEqual(r.trades.length, 0);
});

test('invalid input returns an empty result with an error message', () => {
  assert.ok(B.run(B.smaCross(), []).error);
  assert.ok(B.run(B.smaCross(), [bars([[1, 1]])[0]]).error);
  assert.ok(B.run({}, bars([[1, 1], [1, 1]])).error);
  assert.deepStrictEqual(B.run(B.smaCross(), []).trades, []);
});

/* ───────────── markers ───────────── */
test('markers are lightweight-charts shaped and placed on fill bars', () => {
  const bs = bars([[10, 11], [12, 13], [14, 15], [16, 17], [18, 19]]);
  const r = B.run(script({ 1: 'buy', 3: 'sell' }), bs, { cash: 1000 });
  assert.strictEqual(r.markers.length, 2);
  const [m1, m2] = r.markers;
  assert.strictEqual(m1.time, bs[2].time); assert.strictEqual(m1.position, 'belowBar'); assert.strictEqual(m1.shape, 'arrowUp');
  assert.strictEqual(m2.time, bs[4].time); assert.strictEqual(m2.position, 'aboveBar'); assert.strictEqual(m2.shape, 'arrowDown');
  assert.ok(/^#[0-9a-f]{6}$/i.test(m1.color) && typeof m1.text === 'string');
  // markers must be in time order for setMarkers()
  for (let i = 1; i < r.markers.length; i++) assert.ok(r.markers[i].time >= r.markers[i - 1].time);
});

/* ───────────── reviewer regressions ───────────── */
test('buyAndHold enters on the first consulted bar even with startIndex > 0', () => {
  const oc = []; for (let i = 0; i < 60; i++) oc.push([100 + i, 100.5 + i]);
  const bs = bars(oc);
  const r = B.run(B.buyAndHold, bs, { startIndex: 20, cash: 1e6 });
  assert.strictEqual(r.trades.length, 1);
  assert.strictEqual(r.trades[0].entryIndex, 21, 'fills at the open of the bar after the first consulted one');
  assert.ok(r.stats.totalReturnPct > 0 && Math.abs(r.stats.totalReturnPct - r.stats.buyHoldReturnPct) < 1);
  const r0 = B.run(B.buyAndHold, bs, { cash: 1e6 });
  assert.strictEqual(r0.trades[0].entryIndex, 1, 'behaviour with startIndex 0 unchanged');
});

test('sortino uses textbook downside deviation over ALL returns and is defined with one losing bar', () => {
  const oc = []; for (let i = 0; i < 30; i++) oc.push([100, 100]);
  oc[10] = [100, 101]; oc[11] = [101, 101]; oc[12] = [101, 100.5]; for (let i = 13; i < 30; i++) oc[i] = [100.5, 100.5];
  const bs = bars(oc);
  const r = B.run(B.buyAndHold, bs, { cash: 1e9 });
  const eq = r.equity, rets = []; for (let i = 1; i < eq.length; i++) rets.push(eq[i].equity / eq[i - 1].equity - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const dsd = Math.sqrt(rets.reduce((a, x) => a + (x < 0 ? x * x : 0), 0) / rets.length);
  const negs = rets.filter(x => x < 0).length;
  assert.strictEqual(negs, 1, 'test setup: exactly one losing bar');
  assert.strictEqual(typeof r.stats.sortino, 'number');
  // annualisation factor is whatever the engine infers; compare the ratio shape instead
  const expectedUnannualised = mean / dsd;
  assert.ok(Math.abs(r.stats.sortino / expectedUnannualised - Math.sqrt(252)) < 1 || Math.abs(r.stats.sortino / expectedUnannualised - Math.sqrt(365)) < 1,
    'sortino = mean/dsd * sqrt(bars per year), got ' + r.stats.sortino);
});

test('markers carry a short price label (or none when crowded) plus a full detail string', () => {
  const oc = []; for (let i = 0; i < 100; i++) oc.push([100 + (i % 7), 100 + (i % 7)]);
  const bs = bars(oc);
  const few = B.run(script({ 1: 'buy', 3: 'sell' }), bs, { cash: 1000 });
  assert.strictEqual(few.markers[0].text, String(few.trades[0].entry.toFixed ? +few.trades[0].entry.toFixed(2) : few.trades[0].entry));
  assert.ok(/^Buy \d+ @ /.test(few.markers[0].detail));
  assert.ok(/^Sell \d+ @ .* \([+-]?\d+\)$/.test(few.markers[1].detail));
  const map = {}; for (let i = 0; i < 90; i += 4) { map[i] = 'buy'; map[i + 2] = 'sell'; }
  const many = B.run(script(map), bs, { cash: 1e6 });
  assert.ok(many.trades.length > 12);
  assert.ok(many.markers.length > 0 && many.markers.every(m => m.text === '' && typeof m.detail === 'string'));
});

/* ───────────── stats ───────────── */
test('buy & hold: strategy return matches buyHoldReturnPct (apart from the cash remainder)', () => {
  const bs = trendBars(300);
  const r = B.run(B.buyAndHold, bs, { cash: 1e9 });  // huge cash → remainder negligible
  near(r.stats.totalReturnPct, r.stats.buyHoldReturnPct, 0.01);
  near(r.stats.buyHoldReturnPct, (bs[bs.length - 1].close / bs[1].open - 1) * 100, 1e-9);
  near(r.stats.exposurePct, (bs.length - 1) / bs.length * 100, 1e-9);
  assert.strictEqual(r.stats.trades, 1);
  const eq = B.buyHoldEquity(bs, 1e9);
  assert.strictEqual(eq.length, bs.length); near(eq[eq.length - 1].equity, r.stats.finalEquity, 1e-3);
});

test('CAGR comes from bar timestamps: doubling over exactly two years → ~41.42 %', () => {
  const bs = [];
  const start = Date.UTC(2020, 0, 1), end = Date.UTC(2022, 0, 1);   // 2 years incl. a leap day: 731 days
  const n = 732;                                                      // bars 0..731 → last bar lands on `end`
  for (let i = 0; i < n; i++) {
    const p = 100 * Math.pow(2, i / (n - 1));
    bs.push({ time: new Date(start + i * 86400000).toISOString().slice(0, 10), open: p, high: p, low: p, close: p, volume: 1 });
  }
  assert.strictEqual(bs[n - 1].time, new Date(end).toISOString().slice(0, 10));
  const r = B.run(B.buyAndHold, bs, { cash: 1e9 });
  const years = B.spanYears(bs); near(years, 731 / 365.25, 1e-9);
  // open of bar 1 → close of last ≈ ×2 (less one step), so CAGR ≈ 41.4 %
  const expected = (Math.pow(r.stats.finalEquity / 1e9, 1 / years) - 1) * 100;
  near(r.stats.cagr, expected, 1e-9);
  near(r.stats.cagr, 41.4, 0.3);
});

test('CAGR is null for a span under a week; barsPerYear detects daily vs intraday', () => {
  const r = B.run(B.buyAndHold, bars([[1, 1], [1, 1], [1, 1]]));
  assert.strictEqual(r.stats.cagr, null);
  assert.strictEqual(B.barsPerYear(trendBars(50)), 252);
  const intra = []; for (let i = 0; i < 50; i++) intra.push({ time: 1700000000 + i * 300, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  assert.strictEqual(B.barsPerYear(intra), 252 * 78);   // 5-minute bars, 78 per session
  assert.strictEqual(B.timeToSeconds('2024-01-01'), Date.UTC(2024, 0, 1) / 1000);
  assert.strictEqual(B.timeToSeconds(1700000000), 1700000000);
  assert.strictEqual(B.timeToSeconds({ year: 2024, month: 1, day: 1 }), Date.UTC(2024, 0, 1) / 1000);
});

test('winRate, profitFactor, avgWin/avgLoss, expectancy and maxDrawdown', () => {
  // trade 1: +10/share on 100 shares (+1000); trade 2: −5/share on 100 (−500)
  const bs = bars([[100, 100], [100, 100], [110, 110], [110, 110], [110, 110], [105, 105], [105, 105]]);
  const r = B.run(script({ 0: 'buy', 1: 'sell', 3: 'buy', 4: 'sell' }), bs, { cash: 10000 });
  assert.strictEqual(r.trades.length, 2);
  assert.strictEqual(r.trades[1].qty, 100);   // 11000 equity / 110
  near(r.trades[0].pnl, 1000); near(r.trades[1].pnl, -500);
  near(r.stats.winRate, 50); near(r.stats.profitFactor, 2); near(r.stats.avgWin, 1000); near(r.stats.avgLoss, -500);
  near(r.stats.expectancy, 250); near(r.stats.totalReturnPct, 5);
  near(r.stats.maxDrawdownPct, 500 / 11000 * 100, 1e-9);
  assert.strictEqual(r.stats.wins, 1); assert.strictEqual(r.stats.losses, 1);
  assert.ok(r.stats.excessVsBuyHoldPct === r.stats.totalReturnPct - r.stats.buyHoldReturnPct);
});

test('no trades → winRate/profitFactor/sharpe null, drawdown 0, equity flat', () => {
  const r = B.run(script({}), trendBars(50), { cash: 5000 });
  assert.strictEqual(r.stats.trades, 0); assert.strictEqual(r.stats.winRate, null); assert.strictEqual(r.stats.profitFactor, null);
  assert.strictEqual(r.stats.sharpe, null); assert.strictEqual(r.stats.maxDrawdownPct, 0);
  assert.ok(r.equity.every(e => e.equity === 5000)); near(r.stats.exposurePct, 0);
});

test('Sharpe is finite and annualised; drawdownSeries is ≤ 0', () => {
  const r = B.run(B.smaCross(10, 30), trendBars(400));
  assert.ok(typeof r.stats.sharpe === 'number' && isFinite(r.stats.sharpe));
  assert.ok(r.stats.maxDrawdownPct >= 0 && r.stats.maxDrawdownPct <= 100);
  const dd = B.drawdownSeries(r.equity);
  assert.strictEqual(dd.length, r.equity.length);
  assert.ok(dd.every(d => d.value <= 1e-12));
  near(Math.min.apply(null, dd.map(d => d.value)), -r.stats.maxDrawdownPct, 1e-9);
});

test('explain() returns readable sentences', () => {
  const lines = B.explain(B.run(B.smaCross(10, 30), trendBars(400)));
  assert.ok(Array.isArray(lines) && lines.length >= 4);
  assert.ok(lines.every(l => typeof l === 'string' && l.length > 10));
  assert.ok(/buy-and-hold/i.test(lines.join(' ')));
  assert.deepStrictEqual(B.explain(null), ['Run a backtest first.']);
});

/* ───────────── optimize ───────────── */
test('expandGrid is a cartesian product in stable order', () => {
  const g = B.expandGrid({ a: [1, 2], b: ['x', 'y', 'z'] });
  assert.strictEqual(g.length, 6);
  assert.deepStrictEqual(g[0], { a: 1, b: 'x' }); assert.deepStrictEqual(g[5], { a: 2, b: 'z' });
  assert.deepStrictEqual(B.expandGrid({}), [{}]);
});

test('optimize ranks param sets, applies filter and minTrades, and returns stats per row', () => {
  const bs = trendBars(400);
  const res = B.optimize(B.smaCross, bs, { fast: [5, 10, 20], slow: [30, 50, 100] }, { metric: 'totalReturnPct', filter: p => p.fast < p.slow, minTrades: 1 });
  assert.ok(Array.isArray(res));
  assert.strictEqual(res.total, 9); assert.strictEqual(res.tested, 9); assert.strictEqual(res.truncated, false);
  assert.strictEqual(res.metric, 'totalReturnPct');
  res.forEach((r, i) => { assert.strictEqual(r.rank, i + 1); assert.ok(r.stats && typeof r.stats.totalReturnPct === 'number'); assert.ok(r.params.fast < r.params.slow); });
  for (let i = 1; i < res.length; i++) if (res[i].enoughTrades === res[i - 1].enoughTrades) assert.ok(res[i - 1].score >= res[i].score);
  assert.ok(typeof res.warning === 'string' && res.warning.length);
});

test('optimize caps the grid at 200 combos with an evenly spaced subset and a warning', () => {
  const bs = trendBars(120);
  const big = { fast: Array.from({ length: 20 }, (_, i) => i + 2), slow: Array.from({ length: 15 }, (_, i) => 30 + i * 5) }; // 300 combos
  const res = B.optimize(B.smaCross, bs, big, { minTrades: 0 });
  assert.strictEqual(res.total, 300); assert.strictEqual(res.tested, 200); assert.strictEqual(res.truncated, true);
  assert.strictEqual(res.length, 200); assert.strictEqual(B.OPTIMIZE_CAP, 200);
  assert.ok(/200/.test(res.warning));
  const seen = new Set(res.map(r => r.params.fast + '/' + r.params.slow)); assert.strictEqual(seen.size, 200, 'no duplicate combos');
});

test('optimize with oosPct holds out the most recent bars and reports oosStats separately', () => {
  const bs = trendBars(500);
  const res = B.optimize(B.smaCross, bs, { fast: [10, 20], slow: [50] }, { oosPct: 30, minTrades: 0 });
  assert.strictEqual(res.inSampleBars, 350); assert.strictEqual(res.oosBars, 150);
  res.forEach(r => {
    assert.ok(r.oosStats && typeof r.oosStats.totalReturnPct === 'number');
    assert.strictEqual(r.oosStats.bars, 150, 'OOS stats cover only the held-out window');
    assert.strictEqual(r.stats.bars, 350);
    assert.strictEqual(r.oosStartIndex, 250);
  });
  // the in-sample result must equal a plain run on the first 350 bars
  const direct = B.run(B.smaCross(10, 50), bs.slice(0, 350));
  const row = res.find(r => r.params.fast === 10);
  near(row.stats.totalReturnPct, direct.stats.totalReturnPct, 1e-9);
});

test('optimize works with the registry defaults (builtins[].grid) for every strategy', () => {
  const bs = trendBars(300);
  B.builtins.forEach(b => {
    const res = B.optimize(b.factory, bs, b.grid, { minTrades: 0 });
    assert.ok(res.length >= 1, b.id);
    assert.ok(res.every(r => r.stats), b.id);
  });
});

test('get(id, params) builds a strategy from the registry', () => {
  assert.strictEqual(B.get('breakout', { n: 10 }).params.n, 10);
  assert.strictEqual(B.get('smaCross').params.fast, 20);
  assert.strictEqual(B.get('nope'), null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
