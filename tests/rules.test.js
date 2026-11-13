/* Broward Trading — tests for js/rules.js (BT.rules, the strategy builder engine)
 * Run with:  node tests/rules.test.js
 * Plain node + assert. Loads indicators.js, backtest.js, i18n-free.
 * The look-ahead tests instrument the bar array with a Proxy and record every
 * index a decision reads.
 */
'use strict';
const assert = require('assert');
const path = require('path');

const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
global.window = { localStorage: global.localStorage };
require(path.join(__dirname, '..', 'js', 'indicators.js'));
require(path.join(__dirname, '..', 'js', 'backtest.js'));
require(path.join(__dirname, '..', 'js', 'rules.js'));
const R = window.BT.rules;
const B = window.BT.backtest;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}

/* ---------------- fixtures ---------------- */
function day(i) { return new Date(Date.UTC(2023, 0, 2) + i * 86400000).toISOString().slice(0, 10); }
/** Deterministic wavy series with drift, highs/lows and volume. */
function wavy(n, seed) {
  let x = 100, s = seed || 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = x;
    x = x * (1 + 0.0004 + Math.sin(i / 9) * 0.012 + (rnd() - 0.5) * 0.02);
    const hi = Math.max(o, x) * (1 + rnd() * 0.01), lo = Math.min(o, x) * (1 - rnd() * 0.01);
    out.push({ time: day(i), open: +o.toFixed(4), high: +hi.toFixed(4), low: +lo.toFixed(4), close: +x.toFixed(4), volume: Math.round(1e6 * (0.5 + rnd())) });
  }
  return out;
}
function fromCloses(cs) { return cs.map((c, i) => ({ time: day(i), open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000 + i })); }
const val = v => ({ ind: 'value', params: {}, value: v });
const close = { ind: 'close', params: {} };

/** Proxy over bars that records every integer index read. */
function instrument(bars) {
  const reads = [];
  let armed = true;
  const p = new Proxy(bars, {
    get(t, k, r) {
      if (armed && typeof k === 'string' && /^\d+$/.test(k)) reads.push(+k);
      return Reflect.get(t, k, r);
    }
  });
  return { proxy: p, reads, arm(v) { armed = v; }, clear() { reads.length = 0; } };
}

console.log('BT.rules tests');

test('module exposes the contract surface', () => {
  ['compile', 'describe', 'validate', 'normalize', 'evaluate', 'propose', 'template', 'list', 'save', 'remove', 'exportJSON', 'importJSON', 'warnings'].forEach(f => assert.strictEqual(typeof R[f], 'function', f));
  assert.deepStrictEqual(R.cmps, ['>', '<', 'crossesAbove', 'crossesBelow']);
  ['rsi', 'sma', 'ema', 'close', 'macd', 'macdSignal', 'bbUpper', 'bbLower', 'adx', 'stochK', 'volume', 'value'].forEach(k => assert.ok(R.OPERANDS[k], k));
  assert.strictEqual(R.STORAGE_KEY, 'bt.rules');
});

test('every template validates, compiles and describes itself', () => {
  assert.deepStrictEqual(R.templates.map(t => t.id), ['smaCross', 'rsiReversion', 'macdMomentum', 'bollingerBreakout']);
  R.templates.forEach(t => {
    const r = R.template(t.id);
    assert.deepStrictEqual(R.validate(r), [], t.id);
    const s = R.compile(r);
    assert.strictEqual(typeof s.onBar, 'function');
    assert.ok(R.describe(r, 'en').length > 30);
    assert.ok(t.blurb.length > 40, t.id + ' blurb');
  });
  assert.strictEqual(R.template('nope'), null);
});

test('validate() reports readable errors', () => {
  assert.ok(R.validate(null).length);
  assert.ok(R.validate({ entry: { conditions: [] } }).some(e => /entry condition/i.test(e)));
  const bad = { entry: { op: 'xor', conditions: [{ left: { ind: 'nope' }, cmp: '>=', right: val('abc') }] }, exit: { stopPct: -2, maxBars: 0 } };
  const errs = R.validate(bad);
  assert.ok(errs.some(e => /AND or OR/.test(e)));
  assert.ok(errs.some(e => /left/.test(e)));
  assert.ok(errs.some(e => /crosses above/.test(e)));
  assert.ok(errs.some(e => /type a number/.test(e)));
  assert.ok(errs.some(e => /Stop-loss/.test(e)));
  assert.ok(errs.some(e => /Maximum bars/.test(e)));
  assert.ok(R.validate({ entry: { conditions: [{ left: val(1), cmp: '>', right: val(2) }] } }).some(e => /two plain numbers/.test(e)));
  assert.ok(R.validate({ entry: { conditions: [{ left: { ind: 'macd', params: { fast: 30, slow: 10 } }, cmp: '>', right: val(0) }] } }).some(e => /fast/.test(e)));
  const many = { entry: { conditions: Array.from({ length: 9 }, () => ({ left: close, cmp: '>', right: val(1) })) } };
  assert.ok(R.validate(many).some(e => /8 conditions/.test(e)));
});

test('warnings() flags missing exits, missing stops, mixed scales and impossible levels', () => {
  const w = R.warnings({ entry: { conditions: [{ left: close, cmp: '>', right: { ind: 'rsi', params: { n: 14 } } }, { left: { ind: 'rsi', params: { n: 14 } }, cmp: '>', right: val(120) }] } });
  assert.ok(w.some(x => /no exit/i.test(x)));
  assert.ok(w.some(x => /No stop-loss/.test(x)));
  assert.ok(w.some(x => /different scales/.test(x)));
  assert.ok(w.some(x => /can never be reached/.test(x)));
  assert.deepStrictEqual(R.warnings(R.template('smaCross')), []);
});

test('normalize() fills defaults and clamps', () => {
  const r = R.normalize({ entry: { conditions: [{ left: { ind: 'sma', params: { n: 9999 } }, cmp: 'crossesAbove', right: { ind: 'value', value: '42' } }] }, exit: { stopPct: '5', maxBars: 10.6 } });
  assert.strictEqual(r.side, 'long');
  assert.strictEqual(r.name, 'My rule');
  assert.strictEqual(r.entry.op, 'and');
  assert.strictEqual(r.entry.conditions[0].left.params.n, 500);
  assert.strictEqual(r.entry.conditions[0].right.value, 42);
  assert.strictEqual(r.exit.stopPct, 5);
  assert.strictEqual(r.exit.maxBars, 11);
  assert.strictEqual(R.normalize({ entry: { conditions: [{ left: { ind: 'bbUpper' }, cmp: '>', right: val(1) }] } }).entry.conditions[0].left.params.k, 2);
});

/* ---------------- look-ahead ---------------- */

test('compiled rules never read bar i+1 (instrumented bars, strict mode: nothing exempt)', () => {
  const bars = wavy(160, 3);
  R.templates.forEach(t => {
    const rule = R.template(t.id);
    rule.exit.trailingPct = 4; rule.exit.maxBars = 15;   // exercise every exit path
    const strat = R.compile(rule, { strict: true });
    const ins = instrument(bars);
    let pos = null;
    for (let i = 0; i < bars.length; i++) {
      ins.clear();
      const ctx = { bars: ins.proxy, position: pos };
      const sig = strat.onBar(ctx, i);
      const maxRead = ins.reads.length ? Math.max.apply(null, ins.reads) : -1;
      assert.ok(maxRead <= i, t.id + ': at bar ' + i + ' the rule read bar ' + maxRead);
      // simple position bookkeeping so exit logic runs too
      if (!pos && (sig === 'buy' || sig === 'sell')) pos = { side: sig === 'buy' ? 'long' : 'short', entry: bars[i].close, entryIndex: i, barsHeld: 0 };
      else if (pos && sig === 'exit') pos = null;
      else if (pos) pos.barsHeld = i - pos.entryIndex;
    }
  });
});

test('compiled rules never read bar i+1 (instrumented bars, fast mode after prepare)', () => {
  const bars = wavy(450, 11);
  let totalSignals = 0;
  R.templates.forEach(t => {
    const rule = R.template(t.id); rule.exit.trailingPct = 5;
    const strat = R.compile(rule);
    const ins = instrument(bars);
    ins.arm(false); strat.prepare(ins.proxy); ins.arm(true);   // indicator precompute (causal, proven by the prefix test below)
    let pos = null, signals = 0;
    for (let i = 0; i < bars.length; i++) {
      ins.clear();
      const sig = strat.onBar({ bars: ins.proxy, position: pos }, i);
      if (sig) signals++;
      ins.reads.forEach(j => assert.ok(j <= i, t.id + ': bar ' + i + ' read ' + j));
      if (!pos && sig === 'buy') pos = { side: 'long', entry: bars[i].close, entryIndex: i, barsHeld: 0 };
      else if (pos && sig === 'exit') pos = null;
      else if (pos) pos.barsHeld = i - pos.entryIndex;
    }
    totalSignals += signals;
  });
  assert.ok(totalSignals >= 4, 'the templates should produce some signals on 450 wavy bars, got ' + totalSignals);
});

test('every decision equals the one made on bars.slice(0, i+1) (indicators are causal)', () => {
  const bars = wavy(180, 5);
  const rule = { name: 'mix', side: 'long', entry: { op: 'or', conditions: [
    { left: { ind: 'rsi', params: { n: 14 } }, cmp: 'crossesAbove', right: val(40) },
    { left: { ind: 'ema', params: { n: 10 } }, cmp: 'crossesAbove', right: { ind: 'bbLower', params: { n: 20, k: 2 } } },
    { left: { ind: 'stochK', params: { n: 14 } }, cmp: '<', right: val(15) },
    { left: { ind: 'adx', params: { n: 14 } }, cmp: '>', right: val(35) },
    { left: { ind: 'macd' }, cmp: 'crossesAbove', right: { ind: 'macdSignal' } }] },
    exit: { op: 'or', conditions: [{ left: close, cmp: 'crossesBelow', right: { ind: 'sma', params: { n: 20 } } }, { left: { ind: 'volume' }, cmp: '>', right: val(1.45e6) }] } };
  assert.deepStrictEqual(R.validate(rule), []);
  const full = R.compile(rule);
  for (let i = 0; i < bars.length; i++) {
    const a = full.onBar({ bars, position: null }, i);
    const b = R.compile(rule).onBar({ bars: bars.slice(0, i + 1), position: null }, i);
    assert.strictEqual(a, b, 'entry decision differs at bar ' + i);
    const pos = { side: 'long', entry: bars[Math.max(0, i - 3)].close, entryIndex: Math.max(0, i - 3), barsHeld: Math.min(i, 3) };
    assert.strictEqual(full.onBar({ bars, position: pos }, i), R.compile(rule).onBar({ bars: bars.slice(0, i + 1), position: pos }, i), 'exit decision differs at bar ' + i);
  }
});

test('poisoning every future bar does not change today\'s decision', () => {
  const bars = wavy(150, 9), rule = R.template('rsiReversion');
  const base = R.compile(rule), sigs = bars.map((_, i) => base.onBar({ bars, position: null }, i));
  [60, 100, 140].forEach(cut => {
    const poisoned = bars.map((b, j) => j <= cut ? b : { time: b.time, open: 1e9, high: 1e9, low: 1e-9, close: j % 2 ? 1e9 : 1e-9, volume: 0 });
    const s = R.compile(rule);
    for (let i = 0; i <= cut; i++) assert.strictEqual(s.onBar({ bars: poisoned, position: null }, i), sigs[i], 'bar ' + i + ' (cut ' + cut + ')');
  });
});

test('crossesAbove compares bar i-1 with bar i, and reads exactly those two bars', () => {
  const bars = fromCloses([10, 10, 9, 11, 12, 9, 10, 10.5]);
  const rule = { side: 'long', entry: { conditions: [{ left: close, cmp: 'crossesAbove', right: val(10) }] }, exit: { conditions: [{ left: close, cmp: 'crossesBelow', right: val(10) }] } };
  const s = R.compile(rule);
  const got = bars.map((_, i) => s.onBar({ bars, position: null }, i));
  // i=1: 10→10 not above; i=3: 9→11 crosses; i=4: 11→12 already above; i=6: 9→10 equal, not above; i=7: 10→10.5 crosses (prev at level counts as "at or below")
  assert.deepStrictEqual(got, [null, null, null, 'buy', null, null, null, 'buy']);
  const ins = instrument(bars);
  s.onBar({ bars: ins.proxy, position: null }, 3);
  assert.deepStrictEqual(Array.from(new Set(ins.reads)).sort(), [2, 3], 'close crossesAbove 10 at bar 3 must read bars 2 and 3 only');
  // crossesBelow for exits
  const pos = { side: 'long', entry: 11, entryIndex: 3, barsHeld: 1 };
  assert.strictEqual(s.onBar({ bars, position: pos }, 5), 'exit');   // 12 → 9
  assert.strictEqual(s.onBar({ bars, position: pos }, 4), null);
  // bar 0 has no previous bar, so no cross is possible
  assert.strictEqual(R._evalCond(rule.entry.conditions[0], bars, {}, 0).pass, null);
});

test('crossesAbove between two series reads index i-1 and i of each series', () => {
  const seen = { a: [], b: [] };
  const spy = (arr, tag) => new Proxy(arr, { get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) seen[tag].push(+k); return Reflect.get(t, k, r); } });
  const cond = { left: { ind: 'sma', params: { n: 2 } }, cmp: 'crossesAbove', right: { ind: 'sma', params: { n: 3 } } };
  const series = {}; series[R._operandKey(cond.left)] = spy([null, 1, 2, 3, 6, 7], 'a'); series[R._operandKey(cond.right)] = spy([null, null, 4, 4, 5, 5], 'b');
  const r = R._evalCond(cond, [], series, 4);
  assert.strictEqual(r.pass, true);   // 3 ≤ 4 then 6 > 5
  assert.deepStrictEqual(seen.a.sort(), [3, 4]);
  assert.deepStrictEqual(seen.b.sort(), [3, 4]);
  assert.strictEqual(R._evalCond(cond, [], series, 5).pass, false);   // already above: no new cross
  const below = Object.assign({}, cond, { cmp: 'crossesBelow' });
  assert.strictEqual(R._evalCond(below, [], { [R._operandKey(cond.left)]: [5, 3], [R._operandKey(cond.right)]: [4, 4] }, 1).pass, true);
});

/* ---------------- behaviour with the engine ---------------- */

test('compiled SMA crossover trades like the built-in smaCross strategy', () => {
  const bars = wavy(300, 21);
  const rule = { name: 'x', side: 'long', entry: { conditions: [{ left: { ind: 'sma', params: { n: 10 } }, cmp: 'crossesAbove', right: { ind: 'sma', params: { n: 30 } } }] }, exit: { conditions: [{ left: { ind: 'sma', params: { n: 10 } }, cmp: 'crossesBelow', right: { ind: 'sma', params: { n: 30 } } }] } };
  const a = B.run(R.compile(rule), bars), b = B.run(B.smaCross(10, 30), bars);
  assert.ok(a.trades.length > 0);
  assert.deepStrictEqual(a.trades.map(t => [t.entryIndex, t.exitIndex]), b.trades.map(t => [t.entryIndex, t.exitIndex]));
  assert.strictEqual(a.stats.totalReturnPct, b.stats.totalReturnPct);
  // fills happen on the bar after the signal
  a.trades.forEach(t => assert.strictEqual(t.entry, bars[t.entryIndex].open));
});

test('stop-loss, profit target, trailing stop and max bars close trades on the next open', () => {
  // price rises from 100 then falls hard
  const cs = [100, 100, 101, 103, 106, 110, 108, 104, 99, 95, 94, 96];
  const bars = fromCloses(cs);
  const entryAt2 = { side: 'long', entry: { conditions: [{ left: close, cmp: 'crossesAbove', right: val(100.5) }] } };
  const run = exit => B.run(R.compile(Object.assign({}, entryAt2, { exit })), bars);
  const stop = run({ stopPct: 5 });           // entry fill at open of bar 3 = 103; close 97.85 or lower → bar 8 (99)? 99/103-1 = -3.9 %, bar 9 95 → -7.8 %
  assert.strictEqual(stop.trades[0].entryIndex, 3);
  assert.strictEqual(stop.trades[0].exitIndex, 10);   // signal on bar 9's close, fill at bar 10's open
  const target = run({ targetPct: 6 });       // 110/103 = +6.8 % at bar 5
  assert.strictEqual(target.trades[0].exitIndex, 6);
  const trail = run({ trailingPct: 4 });      // peak close 110 (bar 5); 104 at bar 7 is -5.5 % from peak
  assert.strictEqual(trail.trades[0].exitIndex, 8);
  const timed = run({ maxBars: 2 });          // entered bar 3, held 2 bars at bar 5
  assert.strictEqual(timed.trades[0].exitIndex, 6);
  const s = R.compile(Object.assign({}, entryAt2, { exit: { trailingPct: 4 } }));
  B.run(s, bars);
  assert.ok(s.lastReason() && s.lastReason().kind);
});

test('short rules sell to open and exit with a buy-to-cover (allowShort via runOptions)', () => {
  const bars = fromCloses([100, 100, 99, 97, 95, 92, 90, 93, 96]);
  const rule = { side: 'short', entry: { conditions: [{ left: close, cmp: 'crossesBelow', right: val(99.5) }] }, exit: { conditions: [{ left: close, cmp: 'crossesAbove', right: val(92.5) }] } };
  const s = R.compile(rule);
  assert.strictEqual(s.runOptions.allowShort, true);
  const res = R.backtest(rule, bars);
  assert.strictEqual(res.trades.length, 1);
  assert.strictEqual(res.trades[0].side, 'short');
  assert.strictEqual(res.trades[0].entryIndex, 3);
  assert.strictEqual(res.trades[0].exitIndex, 8);
  assert.ok(res.trades[0].pnl > 0);
});

test('an invalid rule compiles to a strategy that never trades', () => {
  const s = R.compile({ entry: { conditions: [] } });
  assert.ok(s.errors.length);
  assert.strictEqual(B.run(s, wavy(80)).trades.length, 0);
});

test('AND needs every condition, OR needs any', () => {
  const bars = fromCloses([1, 2, 3, 4, 5]);
  const c1 = { left: close, cmp: '>', right: val(2) }, c2 = { left: close, cmp: '>', right: val(4) };
  const at = (op, i) => R.compile({ entry: { op, conditions: [c1, c2] }, exit: { stopPct: 5 } }).onBar({ bars, position: null }, i);
  assert.strictEqual(at('and', 3), null);
  assert.strictEqual(at('and', 4), 'buy');
  assert.strictEqual(at('or', 3), 'buy');
  assert.strictEqual(at('or', 1), null);
});

test('evaluate() and propose() look at the last bar only and never place orders', () => {
  const bars = fromCloses([10, 10, 9, 11]);
  const rule = { name: 'Reclaim 10', side: 'long', entry: { conditions: [{ left: close, cmp: 'crossesAbove', right: val(10) }] }, exit: { stopPct: 5 } };
  const ev = R.evaluate(rule, bars);
  assert.strictEqual(ev.entry, true); assert.strictEqual(ev.index, 3); assert.strictEqual(ev.ready, true);
  assert.strictEqual(R.evaluate(rule, bars, { index: 2 }).entry, false);
  const p = R.propose(rule, bars, null, 'en');
  assert.strictEqual(p.action, 'buy'); assert.strictEqual(p.intent, 'entry'); assert.strictEqual(p.price, 11);
  assert.ok(/Go long/.test(p.reason));
  const stopped = R.propose(rule, fromCloses([10, 10, 9, 9]), { side: 'long', entry: 10, entryIndex: 1 }, 'en');
  assert.strictEqual(stopped.action, 'sell'); assert.strictEqual(stopped.intent, 'exit');
  assert.strictEqual(R.propose(rule, fromCloses([10, 10, 10, 10]), null), null);
  assert.strictEqual(R.evaluate(rule, [bars[0]]), null);
  assert.strictEqual(R.evaluate({ entry: {} }, bars), null);
  const warm = R.evaluate({ entry: { conditions: [{ left: { ind: 'sma', params: { n: 50 } }, cmp: '>', right: val(1) }] } }, bars);
  assert.strictEqual(warm.ready, false);
});

test('propose() tracks trailing-stop and max-bars exits only when the entry bar is known (dashboard semi-auto)', () => {
  const path = [100]; for (let p = 101; p <= 139; p++) path.push(p); for (let p = 138; p >= 102; p -= 4) path.push(p);
  const bars = fromCloses(path);
  const trail = { name: 'Trail', side: 'long', entry: { conditions: [{ left: close, cmp: '>', right: val(1e9) }] }, exit: { trailingPct: 5 } };
  const withEntry = R.propose(trail, bars, { side: 'long', entry: 100, entryIndex: 0, barsHeld: bars.length - 1 }, 'en');
  assert.ok(withEntry && withEntry.intent === 'exit' && /trailing/.test(withEntry.reason), 'trailing stop fires from the entry bar');
  assert.strictEqual(R.propose(trail, bars, { side: 'long', entry: 100 }, 'en'), null, 'without an entry bar the trailing exit cannot be tracked');
  const timed = { name: 'Time', side: 'long', entry: { conditions: [{ left: close, cmp: '>', right: val(1e9) }] }, exit: { maxBars: 5 } };
  const flat = fromCloses([10, 10, 10, 10, 10, 10, 10, 10]);
  const t = R.propose(timed, flat, { side: 'long', entry: 10, entryIndex: 1, barsHeld: 6 }, 'en');
  assert.ok(t && t.intent === 'exit' && /time/.test(t.reason), 'max-bars exit fires once held long enough');
  assert.strictEqual(R.propose(timed, flat, { side: 'long', entry: 10, entryIndex: 5, barsHeld: 2 }, 'en'), null);
});

/* ---------------- describe ---------------- */

test('describe() writes natural English', () => {
  assert.strictEqual(R.describe(R.template('rsiReversion'), 'en'),
    'Go long when RSI(14) crosses above 30 and the close is above SMA(200). Exit when RSI(14) crosses above 70, with a 6% stop-loss or after 30 bars.');
  assert.strictEqual(R.describe(R.template('smaCross'), 'en'),
    'Go long when SMA(20) crosses above SMA(50). Exit when SMA(20) crosses below SMA(50) or with a 8% stop-loss.');
  assert.strictEqual(R.describe(R.template('macdMomentum'), 'en'),
    'Go long when the MACD line crosses above the MACD signal line and the MACD line is above 0. Exit when the MACD line crosses below the MACD signal line or with a 7% trailing stop.');
  const s = R.describe({ side: 'short', entry: { op: 'or', conditions: [{ left: { ind: 'stochK', params: { n: 14 } }, cmp: '>', right: val(80) }, { left: close, cmp: '<', right: { ind: 'bbLower', params: { n: 20, k: 2 } } }, { left: { ind: 'volume' }, cmp: '>', right: val(2500000) }] }, exit: { targetPct: 10, maxBars: 1 } }, 'en');
  assert.strictEqual(s, 'Go short when Stochastic %K(14) is above 80, the close is below the lower Bollinger Band(20, 2) or volume is above 2500000. Exit at a 10% profit target or after 1 bar.');
  assert.ok(/Never exits on its own/.test(R.describe({ entry: { conditions: [{ left: close, cmp: '>', right: val(1) }] } }, 'en')));
  assert.strictEqual(R.describeCondition({ left: { ind: 'ema', params: { n: 9 } }, cmp: 'crossesBelow', right: { ind: 'ema', params: { n: 21 } } }, 'en'), 'EMA(9) crosses below EMA(21)');
});

test('describe(rule, "es") writes natural Spanish through BT.t-style templates', () => {
  assert.strictEqual(R.describe(R.template('rsiReversion'), 'es'),
    'Compra (posición larga) cuando el RSI(14) cruza por encima de 30 y el cierre está por encima de la SMA(200). Sal cuando el RSI(14) cruza por encima de 70, con un stop-loss del 6% o después de 30 barras.');
  assert.strictEqual(R.describe({ side: 'short', entry: { conditions: [{ left: close, cmp: 'crossesBelow', right: { ind: 'bbLower', params: { n: 20, k: 2 } } }] }, exit: { targetPct: 4, trailingPct: 2 } }, 'es'),
    'Vende en corto cuando el cierre cruza por debajo de la banda de Bollinger inferior(20, 2). Sal con un objetivo de ganancia del 4% o con un stop dinámico del 2%.');
  // "de el" contracts to "del"
  assert.strictEqual(R.describeCondition({ left: { ind: 'sma', params: { n: 5 } }, cmp: '>', right: { ind: 'rsi', params: { n: 14 } } }, 'es'), 'La SMA(5) está por encima del RSI(14)');
  // every Spanish template key is a template describe() actually uses, with the same placeholders
  Object.keys(R.ES).forEach(k => {
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.strictEqual(ph(R.ES[k]), ph(k), 'placeholders differ for ' + k);
  });
});

test('describe() prefers the BT.t dictionary when the page language is Spanish', () => {
  const saveT = window.BT.t, saveI = window.BT.i18n;
  try {
    window.BT.i18n = { lang: () => 'es' };
    window.BT.t = (s, v) => { const tr = s === 'Go long when {cond}.' ? 'Entra en largo cuando {cond}.' : s; return v ? tr.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m) : tr; };
    const d = R.describe(R.template('smaCross'));   // no lang → page language
    assert.ok(d.startsWith('Entra en largo cuando la SMA(20) cruza por encima de la SMA(50).'), d);
    assert.ok(/stop-loss del 8%/.test(d), 'falls back to built-in Spanish for keys missing from the dictionary');
    assert.ok(R.describe(R.template('smaCross'), 'en').startsWith('Go long'), 'explicit English stays English');
  } finally { window.BT.t = saveT; window.BT.i18n = saveI; }
});

/* ---------------- persistence & JSON ---------------- */

test('save(), list(), get(), remove() persist to bt.rules', () => {
  localStorage.clear();
  let t = 1700000000000; R.setClock(() => t);
  const a = R.save(R.template('smaCross'));
  assert.ok(a.ok && a.rule.id);
  assert.strictEqual(R.list().length, 1);
  t += 1000;
  const b = R.save(Object.assign(R.template('smaCross'), { side: 'short' }));   // same name → update
  assert.strictEqual(b.rule.id, a.rule.id);
  assert.strictEqual(R.list().length, 1);
  assert.strictEqual(R.get(a.rule.id).side, 'short');
  assert.ok(JSON.parse(localStorage.getItem('bt.rules')).rules.length === 1);
  assert.strictEqual(R.save({ entry: { conditions: [] } }).ok, false);
  R.semiAuto.set({ enabled: true, ruleId: a.rule.id, symbol: 'aapl' });
  assert.deepStrictEqual(R.semiAuto.get(), { enabled: true, ruleId: a.rule.id, symbol: 'AAPL' });
  assert.strictEqual(R.semiAuto.rule().name, 'SMA crossover 20/50');
  assert.strictEqual(R.remove(a.rule.id), true);
  assert.strictEqual(R.list().length, 0);
  assert.strictEqual(R.semiAuto.get().enabled, false, 'deleting the semi-auto rule turns semi-auto off');
  R.setDraft(R.template('rsiReversion'));
  assert.strictEqual(R.getDraft().name, 'RSI reversion');
  localStorage.setItem('bt.rules', '{nope');
  assert.deepStrictEqual(R.list(), []);
  R.setClock(null);
});

test('exportJSON() / importJSON() round-trip and reject junk', () => {
  const r = R.template('bollingerBreakout');
  const text = R.exportJSON(r);
  assert.ok(/"format": "broward-rule"/.test(text));
  const back = R.importJSON(text);
  assert.ok(back.ok);
  assert.deepStrictEqual(back.rule, R.normalize(r));
  assert.strictEqual(R.importJSON('{oops').ok, false);
  assert.ok(/valid JSON/.test(R.importJSON('{oops').errors[0]));
  assert.strictEqual(R.importJSON('[1,2]').ok, false);
  assert.strictEqual(R.importJSON('{"entry":{"conditions":[]}}').ok, false);
});

test('overlays() lists the price-scale indicators to draw', () => {
  const o = R.overlays(R.template('bollingerBreakout'));
  assert.deepStrictEqual(o.map(x => x.key), ['bbUpper:20:2', 'sma:20']);
  assert.deepStrictEqual(R.overlays(R.template('rsiReversion')).map(x => x.key), ['sma:200']);
  const s = R.series(wavy(60), { ind: 'sma', params: { n: 20 } });
  assert.strictEqual(s.length, 60); assert.strictEqual(s[18], null); assert.ok(s[19] > 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
