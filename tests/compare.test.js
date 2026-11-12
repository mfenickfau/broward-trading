/* Broward Trading — tests for js/compare.js (BT.compare)
 * Run with:  node tests/compare.test.js
 * Plain node + assert, no framework. `window` is shimmed; js/data.js is loaded so
 * the alignment path is exercised against real demo bars. No network, no DOM.
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
require(path.join(__dirname, '..', 'js', 'compare.js'));
const C = window.BT.compare;
const D = window.BT.data;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n       ') : e)); }
}
function near(a, b, tol, msg) { tol = tol == null ? 1e-9 : tol; assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a); }
function bars(times, closes) { return times.map((t, i) => ({ time: t, open: closes[i], high: closes[i], low: closes[i], close: closes[i], volume: 1 })); }
const days = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08', '2024-01-09', '2024-01-10', '2024-01-11'];

console.log('compare.js');

// ---- pearson ------------------------------------------------------------
test('pearson: perfectly correlated series → 1', () => {
  near(C.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
});
test('pearson: perfectly inverse series → −1', () => {
  near(C.pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
});
test('pearson: hand-computed value', () => {
  // x = [1,2,3,4,5], y = [2,1,4,3,5]: Σdxdy = 8, sxx = 10, syy = 10 → 0.8
  near(C.pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
});
test('pearson: symmetric and scale/shift invariant', () => {
  const a = [0.01, -0.02, 0.005, 0.03, -0.01, 0.0], b = [0.02, -0.01, 0.0, 0.01, -0.03, 0.004];
  near(C.pearson(a, b), C.pearson(b, a));
  near(C.pearson(a.map(v => v * 7 + 3), b), C.pearson(a, b));
});
test('pearson: nulls skipped, too few pairs → null, zero variance → null', () => {
  near(C.pearson([1, null, 3, 4, 5], [2, 99, 6, 8, 10]), 1);
  assert.strictEqual(C.pearson([1, 2], [1, 2]), null);
  assert.strictEqual(C.pearson([1, 1, 1, 1], [1, 2, 3, 4]), null);
  assert.strictEqual(C.pearson([], []), null);
  assert.strictEqual(C.pearson(null, undefined), null);
});
test('pearson: result is clamped to [−1, 1] despite float noise', () => {
  const a = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 1e-8);
  const r = C.pearson(a, a);
  assert.ok(r <= 1 && r >= -1 && Math.abs(r - 1) < 1e-9);
});

// ---- returns / rebase -----------------------------------------------------
test('returns: simple daily returns, length n−1, nulls propagate', () => {
  const r = C.returns([100, 110, 99, null, 120]);
  assert.strictEqual(r.length, 4);
  near(r[0], 0.1); near(r[1], -0.1); assert.strictEqual(r[2], null); assert.strictEqual(r[3], null);
});
test('logReturns: ln ratio and sum equals ln(last/first)', () => {
  const closes = [100, 105, 103, 110, 108];
  const lr = C.logReturns(closes);
  near(lr[0], Math.log(1.05));
  near(lr.reduce((s, v) => s + v, 0), Math.log(108 / 100));
});
test('rebase: first finite value → 100, leading nulls preserved', () => {
  const r = C.rebase([null, 50, 55, 45]);
  assert.strictEqual(r[0], null); near(r[1], 100); near(r[2], 110); near(r[3], 90);
  assert.deepStrictEqual(C.rebase([]), []);
  near(C.rebase([4, 8], 1)[1], 2);
});

// ---- correlation matrix ---------------------------------------------------
test('correlationMatrix: symmetric, unit diagonal, averages off-diagonal', () => {
  const A = [100, 101, 103, 102, 105, 107, 106, 110];
  const B = A.map(v => v * 2);                               // identical returns → r = 1
  const Cc = [100, 99, 97, 98, 95, 93, 94, 90];              // inverse-ish
  const m = C.correlationMatrix({ A, B, C: Cc });
  assert.deepStrictEqual(m.symbols, ['A', 'B', 'C']);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(m.matrix[i][i], 1);
    for (let j = 0; j < 3; j++) near(m.matrix[i][j], m.matrix[j][i]);
  }
  near(m.matrix[0][1], 1);
  assert.ok(m.matrix[0][2] < -0.9, 'A vs C strongly negative, got ' + m.matrix[0][2]);
  near(m.avg, (m.matrix[0][1] + m.matrix[0][2] + m.matrix[1][2]) / 3);
  assert.strictEqual(m.n, 7);
});
test('correlationMatrix: honours explicit symbol order and handles a single symbol', () => {
  const m = C.correlationMatrix({ X: [1, 2, 3, 4], Y: [4, 3, 2, 1] }, ['Y', 'X']);
  assert.deepStrictEqual(m.symbols, ['Y', 'X']);
  const one = C.correlationMatrix({ X: [1, 2, 3, 4] });
  assert.deepStrictEqual(one.matrix, [[1]]);
  assert.strictEqual(one.avg, null);
});
test('correlationMatrix: too-short series gives null cells, not NaN', () => {
  const m = C.correlationMatrix({ X: [1, 2], Y: [2, 3] });
  assert.strictEqual(m.matrix[0][1], null);
  assert.strictEqual(m.avg, null);
});

test('correlationMatrix: n counts overlapping return pairs, not the longest series', () => {
  // A has 9 finite log returns; B has nulls so only 4 return days overlap A.
  const A = [100, 101, 103, 102, 105, 107, 106, 110, 111, 113];
  const B = [100, null, null, null, null, 95, 93, 94, 90, 92];
  const m = C.correlationMatrix({ A, B });
  assert.strictEqual(m.n, 4, 'n should be the shared sample size, got ' + m.n);
  // Three symbols: n is the smallest overlap any pair shares.
  const Cc = [100, 99, 97, 98, 95, 93, 94, 90, 91, 89];
  const m3 = C.correlationMatrix({ A, B, C: Cc });
  assert.strictEqual(m3.n, 4);
  // Single symbol: falls back to its own finite return count.
  assert.strictEqual(C.correlationMatrix({ A }).n, 9);
  assert.strictEqual(C.correlationMatrix({}).n, 0);
});

// ---- beta / relative strength ---------------------------------------------
test('beta: asset with 2× the benchmark returns has beta 2; benchmark vs itself 1', () => {
  const bench = [100, 102, 101, 104, 103, 106, 105, 108];
  const rb = C.returns(bench);
  const asset = [100]; rb.forEach(r => asset.push(asset[asset.length - 1] * (1 + 2 * r)));
  near(C.beta(asset, bench), 2, 1e-9);
  near(C.beta(bench, bench), 1, 1e-12);
});
test('beta: variance is computed on the same paired sample as covariance', () => {
  const bench = [100, 102, 101, 104, 103, 106, 105, 108, 110, 109];
  const rb = C.returns(bench);
  const asset = [100]; rb.forEach(r => asset.push(asset[asset.length - 1] * (1 + 2 * r)));
  asset[4] = null;                                    // a gap in the asset series
  const ra = C.returns(asset);
  const xs = [], ys = [];
  for (let i = 0; i < ra.length; i++) if (ra[i] != null && rb[i] != null) { xs.push(ra[i]); ys.push(rb[i]); }
  const expected = C.covariance(xs, ys) / C.variance(ys);
  near(C.beta(asset, bench), expected, 1e-12);
  near(C.beta(asset, bench), 2, 1e-9);                // still 2× the benchmark on the common days
});
test('beta: flat benchmark (zero variance) → null', () => {
  assert.strictEqual(C.beta([1, 2, 3, 4], [5, 5, 5, 5]), null);
});
test('relativeStrength: ratio rebased to 100; flat vs itself', () => {
  const rs = C.relativeStrength([10, 11, 12], [100, 100, 120]);
  near(rs[0], 100); near(rs[1], 110); near(rs[2], 100);
  C.relativeStrength([3, 4, 5], [3, 4, 5]).forEach(v => near(v, 100));
  assert.strictEqual(C.relativeStrength([1, 2], [0, 1])[0], null);
});

// ---- stats ------------------------------------------------------------------
test('stats: total return, max drawdown and volatility', () => {
  const s = C.stats([100, 120, 90, 110]);
  near(s.totalReturnPct, 10);
  near(s.maxDrawdownPct, -25);              // 120 → 90
  assert.ok(s.annVolPct > 0);
  assert.strictEqual(s.bars, 4);
  assert.strictEqual(C.maxDrawdownPct([1, 2, 3]), 0);
});
test('stats: empty series is all null, not NaN', () => {
  const s = C.stats([]);
  assert.strictEqual(s.totalReturnPct, null); assert.strictEqual(s.annVolPct, null); assert.strictEqual(s.sharpe, null);
});

// ---- align / periods ---------------------------------------------------------
test('align: keeps only dates every symbol has; reports dropped and missing', () => {
  const a = bars(days, [1, 2, 3, 4, 5, 6, 7, 8]);
  const b = bars(days.slice(2), [10, 20, 30, 40, 50, 60]);        // starts two days later
  const c = bars(days.filter((_, i) => i !== 4), [1, 1, 1, 1, 1, 1, 1]);   // missing Jan 8
  const al = C.align({ A: a, B: b, C: c, NONE: [] });
  assert.deepStrictEqual(al.times, ['2024-01-04', '2024-01-05', '2024-01-09', '2024-01-10', '2024-01-11']);
  assert.deepStrictEqual(al.closes.A, [3, 4, 6, 7, 8]);
  assert.deepStrictEqual(al.closes.B, [10, 20, 40, 50, 60]);
  assert.deepStrictEqual(al.missing, ['NONE']);
  assert.strictEqual(al.dropped.A, 3);
  assert.deepStrictEqual(al.symbols, ['A', 'B', 'C']);
});
test('align: works with unix-second intraday times too', () => {
  const al = C.align({ A: bars([1, 2, 3], [1, 2, 3]), B: bars([2, 3, 4], [5, 6, 7]) });
  assert.deepStrictEqual(al.times, [2, 3]);
  assert.deepStrictEqual(al.closes.B, [5, 6]);
});
test('periodStart: fixed windows, max, and ytd anchored to prior year close', () => {
  const times = [];
  for (let y = 2023; y <= 2024; y++) for (let m = 1; m <= 12; m++) times.push(y + '-' + String(m).padStart(2, '0') + '-15');
  assert.strictEqual(C.periodStart(times, 'max'), 0);
  assert.strictEqual(C.periodStart(times, '1m'), times.length - 1 - 21 < 0 ? 0 : times.length - 22);
  const ytd = C.periodStart(times, 'ytd');
  assert.strictEqual(times[ytd], '2023-12-15');                  // last bar of the previous year
  assert.strictEqual(times[ytd + 1], '2024-01-15');
  assert.strictEqual(C.periodStart(['2024-01-02', '2024-01-03'], '2y'), 0);
  assert.strictEqual(C.periodStart([], '1y'), 0);
});
test('slice: cuts every aligned series and remembers the start index', () => {
  const al = C.align({ A: bars(days, [1, 2, 3, 4, 5, 6, 7, 8]), B: bars(days, [8, 7, 6, 5, 4, 3, 2, 1]) });
  const s = C.slice(al, '1m');                                     // 21 bars > 8 → everything
  assert.strictEqual(s.start, 0);
  assert.strictEqual(s.closes.A.length, 8);
});
test('align + correlationMatrix on real demo bars for six symbols', () => {
  const syms = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN'];
  const by = {}; syms.forEach(s => { by[s] = D.demo(s, '1day', 300); });
  const al = C.align(by);
  assert.strictEqual(al.times.length, 300);
  const sl = C.slice(al, '6m');
  assert.strictEqual(sl.closes.SPY.length, 127);
  const m = C.correlationMatrix(sl.closes, syms);
  m.matrix.forEach((row, i) => row.forEach((r, j) => {
    assert.ok(typeof r === 'number' && r >= -1 && r <= 1, syms[i] + '/' + syms[j] + ' = ' + r);
  }));
  const b = C.beta(sl.closes.AAPL, sl.closes.SPY);
  assert.ok(typeof b === 'number' && isFinite(b));
});

// ---- heatmap helpers --------------------------------------------------------
test('pctChange: last close vs N bars earlier; clamps lookback; needs 2 bars', () => {
  const b = bars(days, [100, 101, 102, 103, 104, 105, 106, 110]);
  near(C.pctChange(b, 1), 110 / 106 * 100 - 100);
  near(C.pctChange(b, 5), (110 / 102 - 1) * 100);        // bars[n-1-5] = 102
  near(C.pctChange(b, 99), 10);                                    // clamped to first bar
  assert.strictEqual(C.pctChange([b[0]], 1), null);
  assert.strictEqual(C.pctChange(null, 1), null);
});
test('heat: sign and monotone intensity, capped at scale', () => {
  assert.strictEqual(C.heat(null).sign, 'flat');
  assert.strictEqual(C.heat(0).sign, 'flat');
  assert.strictEqual(C.heat(2).sign, 'up');
  assert.strictEqual(C.heat(-2).sign, 'down');
  const i1 = C.heat(1, 5).intensity, i3 = C.heat(3, 5).intensity, i9 = C.heat(9, 5).intensity;
  assert.ok(i1 < i3 && i3 < i9 && i9 === 100, [i1, i3, i9].join(','));
  assert.strictEqual(C.heat(-9, 5).intensity, 100);
});
test('tileWeight: 1 for flat/null, grows with |pct|, capped at 4', () => {
  assert.strictEqual(C.tileWeight(null), 1);
  assert.strictEqual(C.tileWeight(0), 1);
  assert.ok(C.tileWeight(2.5, 5) > 1 && C.tileWeight(2.5, 5) < 4);
  assert.strictEqual(C.tileWeight(50, 5), 4);
  assert.strictEqual(C.tileWeight(-50, 5), 4);
});

// ---- copy ---------------------------------------------------------------
test('describeCorrelation: bands and tones', () => {
  assert.strictEqual(C.describeCorrelation(0.9).label, 'very strong positive');
  assert.strictEqual(C.describeCorrelation(0.9).tone, 'up');
  assert.strictEqual(C.describeCorrelation(-0.65).label, 'strong negative');
  assert.strictEqual(C.describeCorrelation(-0.65).tone, 'down');
  assert.strictEqual(C.describeCorrelation(0.05).label, 'near zero');
  assert.strictEqual(C.describeCorrelation(null).label, 'n/a');
  assert.ok(C.describeCorrelation(0.5).text.length > 20);
});
test('diversification: label by average correlation', () => {
  assert.strictEqual(C.diversification({ avg: 0.85 }).label, 'low');
  assert.strictEqual(C.diversification({ avg: 0.5 }).label, 'moderate');
  assert.strictEqual(C.diversification({ avg: 0.3 }).label, 'good');
  assert.strictEqual(C.diversification({ avg: 0.05 }).label, 'high');
  assert.strictEqual(C.diversification({ avg: null }).label, 'n/a');
  assert.strictEqual(C.diversification(null).avg, null);
});
test('describeBeta and NOTES/PERIODS shape', () => {
  assert.ok(/High beta/.test(C.describeBeta(1.8)));
  assert.ok(/near 1/.test(C.describeBeta(1.0)));
  assert.ok(/Negative/.test(C.describeBeta(-0.5)));
  assert.ok(C.NOTES.length >= 5);
  C.NOTES.forEach(n => { assert.ok(n.id && n.title && n.text.length > 80); });
  assert.ok(C.NOTES.some(n => /causation/i.test(n.title)));
  assert.ok(C.NOTES.some(n => /beta/i.test(n.title)));
  assert.ok(C.NOTES.some(n => /diversification/i.test(n.title)));
  assert.strictEqual(C.PERIODS.filter(p => p.id === 'ytd').length, 1);
  assert.strictEqual(C.periodById('nope').id, '6m');
});

// ---- symbols / canvas helpers --------------------------------------------
test('normalizeSymbols: uppercases, dedupes, strips junk, caps at MAX_SYMBOLS', () => {
  assert.deepStrictEqual(C.normalizeSymbols([' aapl', 'AAPL', 'brk.b', 'x y', '', null, 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL']),
    ['AAPL', 'BRK.B', 'XY', 'MSFT', 'NVDA', 'TSLA']);
  assert.strictEqual(C.MAX_SYMBOLS, 6);
  assert.strictEqual(C.BENCHMARK, 'SPY');
});
test('cellColor: positive → greener, negative → redder, null → panel', () => {
  const colors = { panel: '#000000', up: '#00ff00', down: '#ff0000' };
  assert.strictEqual(C.cellColor(null, colors), 'rgb(0,0,0)');
  const g = C.cellColor(0.9, colors).match(/\d+/g).map(Number);
  const r = C.cellColor(-0.9, colors).match(/\d+/g).map(Number);
  assert.ok(g[1] > 150 && g[0] === 0, 'green ' + g);
  assert.ok(r[0] > 150 && r[1] === 0, 'red ' + r);
  const weak = C.cellColor(0.1, colors).match(/\d+/g).map(Number);
  assert.ok(weak[1] < g[1]);
});
test('drawMatrix: no-op without a canvas; draws on a stub 2d context; cellAt maps taps', () => {
  assert.strictEqual(C.drawMatrix(null, { symbols: [] }), null);
  const ops = [];
  const ctx = new Proxy({}, { get: (_, k) => (k in {}) ? undefined : (...a) => { ops.push(k); } , set: () => true });
  const canvas = { width: 320, height: 0, style: {}, getContext: () => ctx };
  const m = C.correlationMatrix({ A: [1, 2, 3, 5, 4], B: [2, 2, 3, 4, 6], C: [5, 4, 3, 2, 1] });
  const geom = C.drawMatrix(canvas, m, { width: 320, dpr: 2 });
  assert.strictEqual(canvas.width, 640);
  assert.strictEqual(geom.n, 3);
  assert.ok(geom.size > 60 && geom.size < 100, 'cell ' + geom.size);
  assert.ok(ops.filter(o => o === 'fillRect').length >= 9);
  assert.ok(ops.filter(o => o === 'fillText').length >= 9 + 6);
  assert.deepStrictEqual(C.cellAt(geom, geom.left + 1, geom.top + 1), { row: 0, col: 0 });
  assert.deepStrictEqual(C.cellAt(geom, geom.left + geom.size * 2 + 1, geom.top + geom.size + 1), { row: 1, col: 2 });
  assert.strictEqual(C.cellAt(geom, 0, 0), null);
  assert.strictEqual(C.cellAt(geom, geom.left + geom.size * 3 + 1, geom.top), null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
