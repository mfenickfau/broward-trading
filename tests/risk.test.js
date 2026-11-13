/* Broward Trading — tests for js/risk.js (BT.risk)
 * Run with:  node tests/risk.test.js
 */
'use strict';
const assert = require('assert');
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'js', 'risk.js'));
const R = window.BT.risk;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a);
}

console.log('BT.risk tests');

test('exposes the contract surface', () => {
  ['positionSize', 'rMultiple', 'breakevenWinRate', 'kellyFraction', 'rewardRisk', 'expectancy', 'planTrade']
    .forEach(f => assert.strictEqual(typeof R[f], 'function', f));
});

test('positionSize: 1% of $100k with a $2 stop distance = 500 shares', () => {
  const r = R.positionSize({ equity: 100000, riskPct: 1, entry: 50, stop: 48 });
  assert.strictEqual(r.shares, 500);
  assert.strictEqual(r.dollarRisk, 1000);
  assert.strictEqual(r.positionValue, 25000);
  assert.strictEqual(r.pctOfEquity, 25);
  assert.strictEqual(r.riskPerShare, 2);
  assert.strictEqual(r.side, 'long');
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.cappedBy, null);
});

test('positionSize rounds DOWN, so the dollar risk never exceeds the budget', () => {
  const r = R.positionSize({ equity: 10000, riskPct: 1, entry: 33.33, stop: 30 }); // budget 100 / 3.33 = 30.03
  assert.strictEqual(r.shares, 30);
  assert.ok(r.dollarRisk <= 100);
  const r2 = R.positionSize({ equity: 10000, riskPct: 1.5, entry: 101, stop: 94 });  // 150 / 7 = 21.43
  assert.strictEqual(r2.shares, 21);
  // binary noise does not lose a share: 1000 / 2.5 = 400 exactly
  assert.strictEqual(R.positionSize({ equity: 100000, riskPct: 1, entry: 10, stop: 7.5 }).shares, 400);
  // lots round down to whole lots
  assert.strictEqual(R.positionSize({ equity: 100000, riskPct: 1, entry: 50, stop: 48, lot: 300 }).shares, 300);
});

test('positionSize never costs more than equity (tight stop is capped by account size)', () => {
  const r = R.positionSize({ equity: 10000, riskPct: 2, entry: 100, stop: 99.9 }); // risk says 2000 shares
  assert.strictEqual(r.shares, 100);
  assert.ok(r.positionValue <= 10000);
  assert.strictEqual(r.cappedBy, 'equity');
  for (let i = 0; i < 200; i++) {
    const eq = 1000 + Math.random() * 200000, entry = 1 + Math.random() * 500;
    const stop = entry * (0.9 + Math.random() * 0.0999);
    const s = R.positionSize({ equity: eq, riskPct: 0.5 + Math.random() * 5, entry, stop });
    assert.ok(s.positionValue <= eq + 1e-6, 'value ' + s.positionValue + ' > equity ' + eq);
    assert.ok(Number.isInteger(s.shares) && s.shares >= 0);
  }
  const capped = R.positionSize({ equity: 100000, riskPct: 1, entry: 50, stop: 48, maxPositionPct: 10 });
  assert.strictEqual(capped.shares, 200);
  assert.strictEqual(capped.cappedBy, 'maxPosition');
});

test('positionSize handles shorts (stop above entry) symmetrically', () => {
  const r = R.positionSize({ equity: 50000, riskPct: 1, entry: 40, stop: 42 });
  assert.strictEqual(r.side, 'short');
  assert.strictEqual(r.shares, 250);
  assert.strictEqual(r.dollarRisk, 500);
});

test('positionSize returns zero shares and a readable error for bad input', () => {
  [{}, { equity: 0, riskPct: 1, entry: 10, stop: 9 }, { equity: 1000, riskPct: 0, entry: 10, stop: 9 },
    { equity: 1000, riskPct: 1, entry: 10, stop: 10 }, { equity: 1000, riskPct: 1, entry: -5, stop: 9 },
    { equity: 1000, riskPct: 150, entry: 10, stop: 9 }].forEach(inp => {
    const r = R.positionSize(inp);
    assert.strictEqual(r.shares, 0, JSON.stringify(inp));
    assert.ok(typeof r.error === 'string' && r.error.length > 10, JSON.stringify(inp));
  });
  const tiny = R.positionSize({ equity: 1000, riskPct: 0.5, entry: 500, stop: 480 }); // $5 budget, $20 per share
  assert.strictEqual(tiny.shares, 0);
  assert.ok(/smaller than the risk of one share/.test(tiny.error), tiny.error);
  assert.strictEqual(R.positionSize({ equity: '10000', riskPct: '1', entry: '50', stop: '48' }).shares, 50, 'numeric strings from inputs work');
});

test('rMultiple: +2R, -1R, shorts, object form, null when risk is zero', () => {
  assert.strictEqual(R.rMultiple(100, 95, 110), 2);
  assert.strictEqual(R.rMultiple(100, 95, 95), -1);
  assert.strictEqual(R.rMultiple(100, 105, 90), 2, 'short: price fell 10 with 5 risk');
  assert.strictEqual(R.rMultiple(100, 105, 105), -1);
  assert.strictEqual(R.rMultiple({ entry: 50, stop: 48, exit: 51 }), 0.5);
  assert.strictEqual(R.rMultiple(100, 100, 110), null);
  assert.strictEqual(R.rMultiple(100, 'x', 110), null);
});

test('breakevenWinRate = 1 / (1 + rr)', () => {
  near(R.breakevenWinRate(1), 0.5);
  near(R.breakevenWinRate(2), 1 / 3);
  near(R.breakevenWinRate(3), 0.25);
  [0.5, 1.5, 4.2, 10].forEach(rr => near(R.breakevenWinRate(rr), 1 / (1 + rr)));
  assert.strictEqual(R.breakevenWinRate(0), null);
  assert.strictEqual(R.breakevenWinRate(-1), null);
  // at the break-even win rate, expectancy is zero
  [0.5, 1, 2, 3].forEach(rr => near(R.expectancy(R.breakevenWinRate(rr), rr), 0, 1e-6));
});

test('kellyFraction = W - (1-W)/rr, accepts percent, negative when there is no edge', () => {
  near(R.kellyFraction(0.5, 2), 0.25);
  near(R.kellyFraction(50, 2), 0.25, 1e-9, 'percent input');
  near(R.kellyFraction(0.6, 1), 0.2);
  assert.ok(R.kellyFraction(0.3, 1) < 0);
  assert.strictEqual(R.kellyFraction(0.5, 0), null);
  assert.strictEqual(R.kellyFraction(-0.1, 2), null);
  assert.strictEqual(R.kellyFraction(150, 2), null);
});

test('rewardRisk and planTrade combine size, R:R, break-even and warnings', () => {
  assert.strictEqual(R.rewardRisk({ entry: 100, stop: 95, target: 115 }), 3);
  assert.strictEqual(R.rewardRisk({ entry: 100, stop: 95, target: 90 }), null, 'target on the wrong side');
  const p = R.planTrade({ equity: 20000, riskPct: 1, entry: 100, stop: 95, target: 115 });
  assert.strictEqual(p.shares, 40);
  assert.strictEqual(p.rewardRisk, 3);
  near(p.breakevenWinRate, 0.25);
  assert.strictEqual(p.profitAtTarget, 600);
  assert.strictEqual(p.lossAtStop, 200);
  assert.strictEqual(p.warnings.length, 0);
  const risky = R.planTrade({ equity: 20000, riskPct: 5, entry: 100, stop: 95, target: 103 });
  const codes = risky.warnings.map(w => w.code);
  assert.ok(codes.includes('risk') && codes.includes('rr'), codes.join());
  const wrong = R.planTrade({ equity: 20000, riskPct: 1, entry: 100, stop: 95, target: 90 });
  assert.ok(wrong.warnings.some(w => w.code === 'target'));
});

test('dynamic strings go through BT.t when it exists', () => {
  window.BT.t = (s, v) => 'ES:' + s.replace(/\{(\w+)\}/g, (m, k) => v && k in v ? v[k] : m);
  const r = R.positionSize({ equity: 0, riskPct: 1, entry: 10, stop: 9 });
  assert.ok(r.error.startsWith('ES:'), r.error);
  delete window.BT.t;
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
