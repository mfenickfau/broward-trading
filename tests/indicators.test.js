/* Broward Trading — tests for js/indicators.js (BT.ind)
 * Run with:  node tests/indicators.test.js
 * Plain node + assert, no test framework. The module expects a `window`
 * global, so we shim one (no `document`; the module must not need it).
 */
'use strict';
const assert = require('assert');
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'js', 'indicators.js'));
const I = window.BT.ind;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a + ' (tol ' + tol + ')');
}
function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
// quick candle builder: bar(o, h, l, c)
function bar(o, h, l, c, v) { return { time: 0, open: o, high: h, low: l, close: c, volume: v == null ? 1000 : v }; }
function withTimes(bars, intraday) {
  return bars.map((b, i) => Object.assign({}, b, { time: intraday ? 1700000000 + i * 300 : new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10) }));
}

console.log('BT.ind tests');

/* ------------------------------------------------------------------ */
test('module loads under a window shim without document and exposes every contract function', () => {
  assert.strictEqual(typeof document, 'undefined');
  ['sma', 'ema', 'wma', 'rsi', 'macd', 'bollinger', 'atr', 'adx', 'stochastic', 'vwap', 'obv', 'ichimoku',
    'pivots', 'supportResistance', 'fibonacci', 'candlePatterns', 'signals', 'signalSeries', 'computeAll']
    .forEach(fn => assert.strictEqual(typeof I[fn], 'function', fn + ' missing'));
});

/* ------------------------------------------------------------------ *
 * SMA / EMA / WMA — hand-computed
 * ------------------------------------------------------------------ */
test('sma: hand-computed on 1..10 with n=3', () => {
  const out = I.sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.strictEqual(out.length, 10);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  // (1+2+3)/3 = 2, (2+3+4)/3 = 3, ... (8+9+10)/3 = 9
  assert.deepStrictEqual(out.slice(2), [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('sma: hand-computed on a non-linear series', () => {
  // closes 10, 11, 13, 12, 14 ; n=3 → (10+11+13)/3=11.333.., (11+13+12)/3=12, (13+12+14)/3=13
  const out = I.sma([10, 11, 13, 12, 14], 3);
  near(out[2], 34 / 3); near(out[3], 12); near(out[4], 13);
});

test('sma: nulls inside the window propagate, window after it recovers', () => {
  const out = I.sma([1, 2, null, 4, 5, 6], 2);
  assert.deepStrictEqual(out, [null, 1.5, null, null, 4.5, 5.5]);
});

test('ema: hand-computed, seeded with SMA then k = 2/(n+1)', () => {
  // n=3 → k=0.5. Seed = sma(1,2,3)=2 at index 2.
  // idx3: 10*0.5 + 2*0.5 = 6 ; idx4: 4*0.5 + 6*0.5 = 5 ; idx5: 7*0.5 + 5*0.5 = 6
  const out = I.ema([1, 2, 3, 10, 4, 7], 3);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  near(out[2], 2); near(out[3], 6); near(out[4], 5); near(out[5], 6);
});

test('ema: matches the StockCharts EMA(10) worked example', () => {
  const closes = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39, 22.38, 22.61, 23.36,
    24.05, 23.75, 23.83, 23.95, 23.63, 23.82, 23.87, 23.65, 23.19, 23.10, 23.33, 22.68, 23.10, 22.40, 22.17];
  const expected = [22.22, 22.21, 22.24, 22.27, 22.33, 22.52, 22.80, 22.97, 23.13, 23.28, 23.34, 23.43, 23.51, 23.54, 23.47, 23.40, 23.39, 23.26, 23.23, 23.08, 22.92];
  const out = I.ema(closes, 10);
  for (let i = 0; i < 9; i++) assert.strictEqual(out[i], null);
  expected.forEach((v, j) => near(out[9 + j], v, 0.011, 'EMA idx ' + (9 + j)));
});

test('wma: hand-computed linear weights', () => {
  // n=3 weights 1,2,3 (sum 6): (1*1+2*2+3*3)/6 = 14/6 ; (2*1+3*2+4*3)/6 = 20/6
  const out = I.wma([1, 2, 3, 4], 3);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  near(out[2], 14 / 6); near(out[3], 20 / 6);
});

/* ------------------------------------------------------------------ *
 * RSI — Wilder smoothing
 * ------------------------------------------------------------------ */
test('rsi: hand-computed first value and Wilder step on a tiny series (n=3)', () => {
  // closes: 10, 11, 10.5, 12, 11
  // changes: +1, -0.5, +1.5, -1
  // first 3 changes → avgGain = (1+1.5)/3 = 0.8333, avgLoss = 0.5/3 = 0.1667 → RS = 5 → RSI = 100 - 100/6 = 83.333
  // next (change -1): avgGain = (0.8333*2 + 0)/3 = 0.5556, avgLoss = (0.1667*2 + 1)/3 = 0.4444 → RS = 1.25 → RSI = 55.556
  const out = I.rsi([10, 11, 10.5, 12, 11], 3);
  assert.deepStrictEqual(out.slice(0, 3), [null, null, null]);
  near(out[3], 100 - 100 / 6, 1e-9);
  near(out[4], 100 - 100 / (1 + 1.25), 1e-9);
});

test('rsi: matches the StockCharts RSI(14) worked example (70.53 … 37.77)', () => {
  const closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328,
    45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548,
    44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314];
  const expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77];
  const out = I.rsi(closes, 14);
  for (let i = 0; i < 14; i++) assert.strictEqual(out[i], null, 'warm-up idx ' + i);
  expected.forEach((v, j) => near(out[14 + j], v, 0.006, 'RSI idx ' + (14 + j)));
});

test('rsi: a null close is a gap (null output), never priced as $0', () => {
  const closes = [];
  for (let i = 0; i < 40; i++) closes.push(100 + 10 * Math.sin(i / 3));
  const clean = I.rsi(closes, 14);
  const gapped = closes.slice(); gapped[25] = null;
  const out = I.rsi(gapped, 14);
  assert.strictEqual(out[25], null, 'bar with the null close');
  assert.strictEqual(out[26], null, 'bar whose previous close is null');
  for (let i = 14; i < 25; i++) near(out[i], clean[i], 1e-9, 'before gap idx ' + i);
  // After the gap the Wilder state is frozen, not poisoned by a fake 100% drop.
  for (let i = 27; i < 40; i++) assert.ok(Math.abs(out[i] - clean[i]) < 15, 'post-gap idx ' + i + ' drifted: ' + out[i] + ' vs ' + clean[i]);
  // Null inside the warm-up window: nothing can be computed.
  const warm = closes.slice(); warm[5] = null;
  assert.ok(I.rsi(warm, 14).every(v => v === null));
});

test('trueRange / atr / obv: null bar fields yield null, not a coerced 0', () => {
  const bars = [];
  for (let i = 0; i < 30; i++) bars.push(bar(100, 102 + (i % 3), 98 - (i % 2), 100 + Math.sin(i), 1000));
  bars[10] = Object.assign({}, bars[10], { high: null, low: null, close: null });
  const tr = I.trueRange(bars);
  assert.strictEqual(tr[10], null); assert.strictEqual(tr[11], null); assert.notStrictEqual(tr[12], null);
  const a = I.atr(bars, 5);
  assert.strictEqual(a[10], null); assert.strictEqual(a[11], null);
  assert.ok(isFinite(a[12]) && a[12] > 0 && a[12] < 20, 'atr continues sanely after the gap: ' + a[12]);
  const o = I.obv(bars);
  assert.strictEqual(o[10], null); assert.strictEqual(o[11], null); assert.ok(isFinite(o[12]));
  const d = I.adx(bars, 5);
  assert.strictEqual(d.plusDI[10], null); assert.ok(d.adx.every(v => v === null || isFinite(v)));
});

test('rsi: all-up series is 100, flat series is 50, bounded 0..100', () => {
  const up = I.rsi([1, 2, 3, 4, 5, 6], 3);
  assert.strictEqual(up[5], 100);
  const flat = I.rsi([5, 5, 5, 5, 5], 3);
  assert.strictEqual(flat[4], 50);
  const down = I.rsi([6, 5, 4, 3, 2, 1], 3);
  assert.strictEqual(down[5], 0);
});

/* ------------------------------------------------------------------ *
 * MACD
 * ------------------------------------------------------------------ */
test('macd: hand-computed with tiny periods (fast=2, slow=3, signal=2)', () => {
  const c = [1, 2, 3, 4, 10];
  // ema2 (k=2/3): seed (1+2)/2 = 1.5 @1; @2: 3*2/3+1.5/3 = 2.5; @3: 4*2/3+2.5/3 = 3.5; @4: 10*2/3+3.5/3 = 7.8333
  // ema3 (k=0.5): seed (1+2+3)/3 = 2 @2; @3: 4*.5+2*.5 = 3; @4: 10*.5+3*.5 = 6.5
  // macd: @2: 2.5-2 = 0.5 ; @3: 3.5-3 = 0.5 ; @4: 7.8333-6.5 = 1.3333
  // signal ema2 of macd starting @2: seed (0.5+0.5)/2 = 0.5 @3 ; @4: 1.3333*2/3 + 0.5/3 = 1.05556
  // hist: @3: 0 ; @4: 1.3333-1.05556 = 0.27778
  const m = I.macd(c, 2, 3, 2);
  assert.deepStrictEqual(m.macd.slice(0, 2), [null, null]);
  near(m.macd[2], 0.5); near(m.macd[3], 0.5); near(m.macd[4], 4 / 3);
  assert.deepStrictEqual(m.signal.slice(0, 3), [null, null, null]);
  near(m.signal[3], 0.5); near(m.signal[4], (4 / 3) * (2 / 3) + 0.5 / 3);
  assert.strictEqual(m.hist[2], null);
  near(m.hist[3], 0); near(m.hist[4], 4 / 3 - ((4 / 3) * (2 / 3) + 0.5 / 3));
  assert.strictEqual(m.macd.length, 5); assert.strictEqual(m.signal.length, 5); assert.strictEqual(m.hist.length, 5);
});

test('macd: default 12/26/9 warm-up — line starts at index 25, signal/hist at 33', () => {
  const c = []; for (let i = 0; i < 60; i++) c.push(100 + Math.sin(i / 3) * 5 + i * 0.1);
  const m = I.macd(c);
  assert.strictEqual(m.macd[24], null); assert.notStrictEqual(m.macd[25], null);
  assert.strictEqual(m.signal[32], null); assert.notStrictEqual(m.signal[33], null);
  assert.strictEqual(m.hist[32], null); near(m.hist[40], m.macd[40] - m.signal[40]);
  // cross-check against independently computed EMAs
  const e12 = I.ema(c, 12), e26 = I.ema(c, 26);
  near(m.macd[50], e12[50] - e26[50]);
});

/* ------------------------------------------------------------------ *
 * Bollinger
 * ------------------------------------------------------------------ */
test('bollinger: classic population-stdev example [2,4,4,4,5,5,7,9] → mean 5, σ 2', () => {
  const b = I.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  for (let i = 0; i < 7; i++) assert.strictEqual(b.upper[i], null);
  near(b.middle[7], 5); near(b.upper[7], 9); near(b.lower[7], 1);
  near(b.bandwidth[7], (9 - 1) / 5);
});

test('bollinger: rolling window n=3 hand-computed', () => {
  // closes 1, 2, 3, 6 ; window @3 = [2,3,6] mean 11/3 ; var = ((2-11/3)^2+(3-11/3)^2+(6-11/3)^2)/3 = (25/9+4/9+49/9)/3 = 78/27
  const b = I.bollinger([1, 2, 3, 6], 3, 2);
  const mean = 11 / 3, sd = Math.sqrt(78 / 27);
  near(b.middle[3], mean); near(b.upper[3], mean + 2 * sd); near(b.lower[3], mean - 2 * sd);
  near(b.middle[2], 2); near(b.upper[2], 2 + 2 * Math.sqrt(2 / 3));
});

/* ------------------------------------------------------------------ *
 * ATR / ADX / Stochastic
 * ------------------------------------------------------------------ */
test('atr: constant true range → constant ATR; Wilder step hand-checked', () => {
  // each bar range 2, no gaps → TR=2 everywhere
  const bars = []; for (let i = 0; i < 10; i++) bars.push(bar(10, 11, 9, 10));
  const a = I.atr(bars, 3);
  assert.deepStrictEqual(a.slice(0, 3), [null, null, null]);
  for (let i = 3; i < 10; i++) near(a[i], 2);
  // now a hand-computed Wilder step, n=2: TRs (from bar 1): 2, 4, 1
  const b2 = [bar(10, 11, 9, 10), bar(10, 11, 9, 10), bar(10, 13, 9, 12), bar(12, 12.5, 11.5, 12)];
  // TR1 = max(2, |11-10|, |9-10|) = 2 ; TR2 = max(4, |13-10|, |9-10|) = 4 ; TR3 = max(1, |12.5-12|, |11.5-12|) = 1
  // ATR@2 = (2+4)/2 = 3 ; ATR@3 = (3*1 + 1)/2 = 2
  const a2 = I.atr(b2, 2);
  near(a2[2], 3); near(a2[3], 2);
});

test('adx: steady uptrend gives +DI > -DI and high ADX; shape is right', () => {
  const bars = []; for (let i = 0; i < 60; i++) bars.push(bar(100 + i, 101 + i, 99.5 + i, 100.8 + i));
  const d = I.adx(bars, 14);
  assert.strictEqual(d.adx.length, 60); assert.strictEqual(d.plusDI.length, 60);
  assert.strictEqual(d.plusDI[13], null); assert.notStrictEqual(d.plusDI[14], null);
  assert.strictEqual(d.adx[26], null); assert.notStrictEqual(d.adx[27], null, 'first ADX at 2n-1');
  assert.ok(d.plusDI[59] > d.minusDI[59]);
  assert.strictEqual(d.minusDI[59], 0);
  assert.ok(d.adx[59] > 50, 'strong trend ADX ' + d.adx[59]);
  for (let i = 27; i < 60; i++) assert.ok(d.adx[i] >= 0 && d.adx[i] <= 100);
});

test('adx: hand-computed Wilder sums with n=2', () => {
  // bars: H/L pairs chosen so DM is easy
  const bars = [bar(10, 10, 9, 9.5), bar(10, 11, 9.5, 10.5), bar(10, 12, 10, 11.5), bar(10, 11, 9, 10)];
  // i=1: up=1, dn=-0.5 → +DM=1, -DM=0 ; TR=max(1.5, |11-9.5|, |9.5-9.5|)=1.5
  // i=2: up=1, dn=-0.5 → +DM=1, -DM=0 ; TR=max(2, |12-10.5|, |10-10.5|)=2
  // i=3: up=-1, dn=1   → +DM=0, -DM=1 ; TR=max(2, |11-11.5|, |9-11.5|)=2.5
  // seed @2: sTR=3.5, sP=2, sM=0 → +DI=57.142.., -DI=0
  // @3: sTR=3.5-1.75+2.5=4.25 ; sP=2-1+0=1 ; sM=0-0+1=1 → +DI=23.529.., -DI=23.529..
  const d = I.adx(bars, 2);
  near(d.plusDI[2], 200 / 3.5); near(d.minusDI[2], 0);
  near(d.plusDI[3], 100 / 4.25); near(d.minusDI[3], 100 / 4.25);
  // DX@2 = 100, DX@3 = 0 → ADX @3 (=2n-1) = mean = 50
  near(d.adx[3], 50);
});

test('stochastic: hand-computed %K and %D', () => {
  const bars = [bar(10, 12, 8, 9), bar(9, 11, 7, 10), bar(10, 13, 9, 12), bar(12, 13, 10, 11)];
  // k=2: @1 HH=12 LL=7 → (10-7)/5=60 ; @2 HH=13 LL=7 → (12-7)/6=83.33 ; @3 HH=13 LL=9 → (11-9)/4=50
  const s = I.stochastic(bars, 2, 2);
  assert.strictEqual(s.k[0], null);
  near(s.k[1], 60); near(s.k[2], 500 / 6); near(s.k[3], 50);
  assert.strictEqual(s.d[1], null); near(s.d[2], (60 + 500 / 6) / 2); near(s.d[3], (500 / 6 + 50) / 2);
});

/* ------------------------------------------------------------------ *
 * VWAP / OBV
 * ------------------------------------------------------------------ */
test('vwap: cumulative for daily bars, hand-computed', () => {
  const bars = withTimes([bar(10, 12, 8, 10, 100), bar(10, 14, 10, 12, 300)], false);
  // tp1 = 10, tp2 = 12 → (10*100 + 12*300)/400 = 11.5
  const v = I.vwap(bars);
  near(v[0], 10); near(v[1], 11.5);
});

test('vwap: resets at a new session for intraday bars', () => {
  const day1 = 1700000000; // 2023-11-14 17:33 ET
  const bars = [
    Object.assign(bar(10, 12, 8, 10, 100), { time: day1 }),
    Object.assign(bar(10, 14, 10, 12, 300), { time: day1 + 300 }),
    Object.assign(bar(20, 22, 18, 20, 50), { time: day1 + 86400 }) // next day
  ];
  const v = I.vwap(bars);
  near(v[1], 11.5); near(v[2], 20, 1e-9, 'reset on new day');
});

test('obv: signed cumulative volume', () => {
  const bars = [bar(1, 1, 1, 10, 100), bar(1, 1, 1, 11, 200), bar(1, 1, 1, 11, 300), bar(1, 1, 1, 9, 400)];
  assert.deepStrictEqual(I.obv(bars), [0, 200, 200, -200]);
});

/* ------------------------------------------------------------------ *
 * Ichimoku
 * ------------------------------------------------------------------ */
test('ichimoku: 9/26/52 midpoints, displacement 26, shifted alignment', () => {
  const bars = []; for (let i = 0; i < 80; i++) bars.push(bar(100 + i, 102 + i, 98 + i, 101 + i));
  const ic = I.ichimoku(bars);
  assert.strictEqual(ic.displacement, 26);
  ['tenkan', 'kijun', 'senkouA', 'senkouB', 'chikou'].forEach(k => assert.strictEqual(ic[k].length, 80, k));
  assert.strictEqual(ic.tenkan[7], null); near(ic.tenkan[8], (102 + 8 + 98) / 2); // HH over 0..8 = 110, LL = 98 → 104
  assert.strictEqual(ic.kijun[24], null); near(ic.kijun[25], (102 + 25 + 98) / 2);
  assert.strictEqual(ic.senkouB[50], null); near(ic.senkouB[51], (102 + 51 + 98) / 2);
  near(ic.senkouA[25], (ic.tenkan[25] + ic.kijun[25]) / 2);
  assert.strictEqual(ic.chikou[10], 111);
  // shifted: cloud above bar i comes from bar i-26; chikou at bar i is close of bar i+26
  near(ic.shifted.senkouA[60], ic.senkouA[34]);
  assert.strictEqual(ic.shifted.senkouA[25], null);
  assert.strictEqual(ic.shifted.chikou[10], bars[36].close);
  assert.strictEqual(ic.shifted.chikou[79], null);
  assert.strictEqual(ic.future.length, 26);
  assert.strictEqual(ic.future[25].offset, 26);
});

/* ------------------------------------------------------------------ *
 * Pivots / S&R / Fibonacci
 * ------------------------------------------------------------------ */
test('pivots: finds the constructed swing high and swing low only', () => {
  const closesArr = [10, 11, 12, 15, 12, 11, 10, 8, 10, 11, 12];
  const bars = closesArr.map(c => bar(c, c + 0.5, c - 0.5, c));
  const p = I.pivots(bars, 2, 2);
  assert.deepStrictEqual(p.highs, [{ index: 3, price: 15.5 }]);
  assert.deepStrictEqual(p.lows, [{ index: 7, price: 7.5 }]);
});

test('supportResistance: splits levels around the last close, nearest first, at most max', () => {
  // 5 flat bars so the first swing has a full left window; swings ≥ 6 bars apart for 5/5 pivots.
  // Pivot highs: 110 @8, 120 @18. Pivot lows: 100 @5 (flat shelf), 90 @13, 93 @23. Last close 103.
  const path = [100, 100, 100, 100, 100, 100, 102, 105, 110, 105, 102, 100, 95, 90, 95, 100, 103, 108, 120, 108, 103, 100, 97, 93, 97, 100, 101, 102, 103];
  const bars = path.map(c => bar(c, c, c, c));
  const sr = I.supportResistance(bars, 120, 3);
  assert.ok(sr.support.length <= 3 && sr.resistance.length <= 3);
  sr.support.forEach(s => assert.ok(s <= 103, 'support below price ' + s));
  sr.resistance.forEach(r => assert.ok(r > 103, 'resistance above price ' + r));
  assert.deepStrictEqual(sr.resistance, [110, 120], 'nearest resistance first');
  assert.deepStrictEqual(sr.support, [100, 93, 90], 'nearest support first');
  // max caps the count
  assert.strictEqual(I.supportResistance(bars, 120, 1).support.length, 1);
});

test('fibonacci: seven levels from high to low', () => {
  const f = I.fibonacci(200, 100);
  assert.deepStrictEqual(f.map(x => x.level), [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
  near(f[0].price, 200); near(f[3].price, 150); near(f[4].price, 200 - 61.8); near(f[6].price, 100);
  // argument order doesn't matter
  assert.deepStrictEqual(I.fibonacci(100, 200).map(x => x.price), f.map(x => x.price));
});

/* ------------------------------------------------------------------ *
 * Candlestick patterns on constructed candles
 * ------------------------------------------------------------------ */
function names(bars) { return I.candlePatterns(bars).map(p => p.index + ':' + p.name); }
function has(list, s) { assert.ok(list.includes(s), 'expected ' + s + ' in ' + JSON.stringify(list)); }

test('candlePatterns: doji', () => {
  const list = names([bar(10, 11, 9, 10.05)]);
  has(list, '0:Doji');
});

test('candlePatterns: hammer after a decline (and not when not declining)', () => {
  // body 0.5, range 3.1: lower wick 2.5 ≥ 2×body, upper wick 0.1 ≤ half the body
  const down = [bar(20, 20.5, 19, 19), bar(19, 19.5, 18, 18), bar(18, 18.5, 17, 17), bar(17, 17.1, 14, 16.5)];
  const list = names(down);
  has(list, '3:Hammer');
  assert.strictEqual(I.candlePatterns(down).find(p => p.name === 'Hammer').bias, 'bull');
  const up = [bar(14, 15, 14, 15), bar(15, 16, 15, 16), bar(16, 17, 16, 17), bar(17, 17.1, 14, 16.5)];
  assert.ok(!names(up).includes('3:Hammer'));
});

test('candlePatterns: shooting star after a rally', () => {
  const bars = [bar(10, 11, 10, 11), bar(11, 12, 11, 12), bar(12, 13, 12, 13), bar(13, 16, 12.9, 13.5)];
  const list = names(bars);
  has(list, '3:Shooting star');
  assert.strictEqual(I.candlePatterns(bars).find(p => p.name === 'Shooting star').bias, 'bear');
});

test('candlePatterns: bullish and bearish engulfing', () => {
  const bull = [bar(10, 10.2, 9.3, 9.5), bar(9.4, 11, 9.2, 10.5)];
  has(names(bull), '1:Bullish engulfing');
  const bear = [bar(10, 10.7, 9.9, 10.5), bar(10.6, 10.8, 9.2, 9.5)];
  has(names(bear), '1:Bearish engulfing');
  // not engulfing: second body smaller
  const no = [bar(10, 11, 9, 9), bar(9.5, 10, 9, 9.8)];
  assert.ok(!names(no).some(s => s.includes('engulfing')));
});

test('candlePatterns: morning star and evening star', () => {
  const morning = [bar(20, 20.2, 15.8, 16), bar(15.5, 15.9, 15.2, 15.6), bar(15.8, 19.5, 15.7, 19)];
  has(names(morning), '2:Morning star');
  const evening = [bar(16, 20.2, 15.8, 20), bar(20.5, 20.8, 20.1, 20.4), bar(20.2, 20.3, 16.5, 17)];
  has(names(evening), '2:Evening star');
});

test('candlePatterns: three white soldiers and three black crows', () => {
  const soldiers = [bar(10, 11.1, 9.9, 11), bar(10.5, 12.1, 10.4, 12), bar(11.5, 13.1, 11.4, 13)];
  has(names(soldiers), '2:Three white soldiers');
  const crows = [bar(13, 13.1, 11.9, 12), bar(12.5, 12.6, 10.9, 11), bar(11.5, 11.6, 9.9, 10)];
  has(names(crows), '2:Three black crows');
  const found = I.candlePatterns(crows).find(p => p.name === 'Three black crows');
  assert.strictEqual(found.bias, 'bear');
  assert.ok(found.description.length > 40);
});

test('candlePatterns: every result has index, name, bias and description', () => {
  const bars = []; let p = 100;
  for (let i = 0; i < 200; i++) { const o = p, c = o * (1 + Math.sin(i * 1.7) * 0.02); p = c; bars.push(bar(o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c)); }
  I.candlePatterns(bars).forEach(x => {
    assert.ok(Number.isInteger(x.index) && x.index >= 0 && x.index < 200);
    assert.ok(typeof x.name === 'string' && x.name);
    assert.ok(['bull', 'bear', 'neutral'].includes(x.bias));
    assert.ok(typeof x.description === 'string' && x.description.length > 20);
  });
});

/* ------------------------------------------------------------------ *
 * Signals / computeAll
 * ------------------------------------------------------------------ */
function synthBars(n, seed) {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = o * (1 + (rnd() - 0.48) * 0.03); p = c;
    out.push({ time: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10), open: o, high: Math.max(o, c) * (1 + rnd() * 0.01), low: Math.min(o, c) * (1 - rnd() * 0.01), close: c, volume: 1e6 + Math.round(rnd() * 1e6) });
  }
  return out;
}

test('computeAll: returns every indicator, all series bar-aligned', () => {
  const bars = synthBars(300, 7);
  const all = I.computeAll(bars);
  ['sma20', 'sma50', 'sma200', 'ema9', 'rsi', 'atr', 'vwap', 'obv'].forEach(k => assert.strictEqual(all[k].length, 300, k));
  ['macd', 'signal', 'hist'].forEach(k => assert.strictEqual(all.macd[k].length, 300));
  ['upper', 'middle', 'lower', 'bandwidth'].forEach(k => assert.strictEqual(all.bollinger[k].length, 300));
  ['adx', 'plusDI', 'minusDI'].forEach(k => assert.strictEqual(all.adx[k].length, 300));
  assert.strictEqual(all.stochastic.k.length, 300);
  assert.strictEqual(all.ichimoku.displacement, 26);
  assert.ok(Array.isArray(all.pivots.highs) && Array.isArray(all.sr.support) && Array.isArray(all.patterns));
  assert.strictEqual(all.fib.length, 7);
  assert.strictEqual(all.sma200[198], null); assert.notStrictEqual(all.sma200[199], null);
});

test('signals: forced bullish setup scores BUY, forced bearish scores SELL, max is 8', () => {
  // 60 bars flat at 100, then a crash so RSI is oversold, price below SMA50 but far under lower band → check pieces
  const bars = synthBars(120, 3);
  const ind = I.computeAll(bars);
  const i = bars.length - 1;
  const sig = I.signals(bars, ind);
  assert.strictEqual(sig.max, 8);
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(sig.state));
  assert.strictEqual(sig.index, i);
  assert.ok(Array.isArray(sig.reasons) && sig.reasons.length >= 5);
  sig.reasons.forEach(r => { assert.ok(typeof r.pts === 'number'); assert.ok(r.text && r.why); });
  // score equals the sum of the reason points and state follows the thresholds
  const sum = sig.reasons.reduce((a, r) => a + r.pts, 0);
  assert.strictEqual(sig.score, sum);
  assert.strictEqual(sig.state, sum >= 3 ? 'BUY' : sum <= -3 ? 'SELL' : 'HOLD');

  // Hand-build an oversold, below-band, death-cross situation → strongly negative-then-positive pieces:
  // We craft ind arrays directly for the last bar to assert the rule weights.
  const fake = {
    sma20: [null, 90, 95], sma50: [null, 92, 94], rsi: [null, 50, 20],
    macd: { macd: [], signal: [], hist: [null, -1, -0.5] },
    bollinger: { upper: [null, 110, 110], lower: [null, 95, 96], middle: [], bandwidth: [] }
  };
  const fb = [bar(90, 91, 89, 90), bar(90, 91, 89, 90), bar(95, 96, 94, 95)];
  const s2 = I.signals(fb, fake, 2);
  // price 95 > sma50 94 (+1), sma20 95 > sma50 94 (+1), RSI 20 (+2), hist -0.5 > -1 recovering (0), close 95 < lower 96 (+1), golden cross (prev 90<92, now 95>94) (+2) = +7
  assert.strictEqual(s2.score, 7);
  assert.strictEqual(s2.state, 'BUY');
  const fakeBear = {
    sma20: [null, 100, 90], sma50: [null, 95, 95], rsi: [null, 50, 80],
    macd: { macd: [], signal: [], hist: [null, -0.5, -1] },
    bollinger: { upper: [null, 80, 85], lower: [null, 70, 70], middle: [], bandwidth: [] }
  };
  const fb2 = [bar(90, 91, 89, 90), bar(90, 91, 89, 90), bar(89, 90, 88, 89)];
  const s3 = I.signals(fb2, fakeBear, 2);
  // 89 < 95 (-1), 90 < 95 (-1), RSI 80 (-2), hist -1 <= -0.5 falling (-1), close 89 > upper 85 (-1), death cross (-2) = -8
  assert.strictEqual(s3.score, -8);
  assert.strictEqual(s3.state, 'SELL');
});

test('signalSeries: one state per bar, HOLD during warm-up, and computes ind when omitted', () => {
  const bars = synthBars(150, 11);
  const states = I.signalSeries(bars);
  assert.strictEqual(states.length, 150);
  states.forEach(s => assert.ok(['BUY', 'SELL', 'HOLD'].includes(s)));
  assert.strictEqual(states[0], 'HOLD');
  const ind = I.computeAll(bars);
  assert.deepStrictEqual(I.signalSeries(bars, ind), states);
  // the last entry agrees with signals()
  assert.strictEqual(states[149], I.signals(bars, ind).state);
});

test('signals: works with a v0.1-style flat indicator object (bbU/bbL/hist)', () => {
  const bars = synthBars(100, 5);
  const c = bars.map(b => b.close);
  const m = I.macd(c), bb = I.bollinger(c);
  const flat = { sma20: I.sma(c, 20), sma50: I.sma(c, 50), rsi: I.rsi(c), hist: m.hist, sig: m.signal, bbU: bb.upper, bbL: bb.lower };
  const a = I.signals(bars, flat), b = I.signals(bars, I.computeAll(bars));
  assert.strictEqual(a.score, b.score);
});

test('edge cases: empty and short inputs never throw', () => {
  assert.deepStrictEqual(I.sma([], 5), []);
  assert.deepStrictEqual(I.rsi([1, 2], 14), [null, null]);
  assert.deepStrictEqual(I.atr([], 14), []);
  assert.deepStrictEqual(I.adx([bar(1, 2, 0, 1)], 14).adx, [null]);
  assert.deepStrictEqual(I.vwap([]), []);
  assert.deepStrictEqual(I.obv([]), []);
  assert.deepStrictEqual(I.candlePatterns([]), []);
  assert.deepStrictEqual(I.pivots([], 5, 5), { highs: [], lows: [] });
  assert.deepStrictEqual(I.supportResistance([]).support, []);
  assert.strictEqual(I.signals([]).state, 'HOLD');
  assert.deepStrictEqual(I.signalSeries([]), []);
  const all = I.computeAll([]);
  assert.strictEqual(all.rsi.length, 0);
  assert.strictEqual(all.fib, null);
  const ic = I.ichimoku([bar(1, 2, 0, 1)]);
  assert.deepStrictEqual(ic.tenkan, [null]);
});

test('toLineData: drops nulls and applies a shift within the bar range', () => {
  const bars = withTimes([bar(1, 1, 1, 1), bar(1, 1, 1, 1), bar(1, 1, 1, 1)], false);
  assert.deepStrictEqual(I.toLineData(bars, [null, 5, 6]), [{ time: bars[1].time, value: 5 }, { time: bars[2].time, value: 6 }]);
  assert.deepStrictEqual(I.toLineData(bars, [7, 8, 9], 1), [{ time: bars[1].time, value: 7 }, { time: bars[2].time, value: 8 }]);
  assert.deepStrictEqual(I.toLineData(bars, [7, 8, 9], -1), [{ time: bars[0].time, value: 8 }, { time: bars[1].time, value: 9 }]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
