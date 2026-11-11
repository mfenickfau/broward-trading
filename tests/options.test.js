/* Broward Trading — tests for js/options.js (BT.options)
 * Run with:  node tests/options.test.js
 * Plain node + assert, no test framework. The module expects a `window`
 * global, so we shim one (no `document`; the module must not need it).
 */
'use strict';
const assert = require('assert');
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'js', 'options.js'));
const O = window.BT.options;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-9 : tol;
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a + ' (tol ' + tol + ')');
}

console.log('BT.options tests');

/* ------------------------------------------------------------------ *
 * Normal distribution
 * ------------------------------------------------------------------ */
test('normCdf: accurate to better than 1e-7 (actually ~1e-15) against reference values', () => {
  // Reference values (16 significant digits) from standard tables / scipy.
  const ref = [
    [0, 0.5],
    [0.5, 0.6914624612740131],
    [1, 0.8413447460685429],
    [1.96, 0.9750021048517795],
    [2.5758293035489, 0.995],
    [3, 0.9986501019683699],
    [-1, 0.15865525393145707],
    [-3, 0.0013498980316301035],
    [-5, 2.866515718791939e-7],
    [-6, 9.865876450376946e-10],
    [-8, 6.220960574271785e-16],
    [8, 1 - 6.220960574271785e-16]
  ];
  ref.forEach(([x, p]) => near(O.normCdf(x), p, 1e-12, 'N(' + x + ')'));
  // Relative accuracy deep in the tail (matters for cheap options)
  const t = O.normCdf(-10);
  near(t / 7.619853024160527e-24, 1, 1e-8, 'N(-10) relative');
  assert.strictEqual(O.normCdf(Infinity), 1);
  assert.strictEqual(O.normCdf(-Infinity), 0);
  assert.strictEqual(O.normCdf(40), 1);
  assert.strictEqual(O.normCdf(-40), 0);
});

test('normCdf: symmetric and monotone', () => {
  for (let x = -6; x <= 6; x += 0.25) near(O.normCdf(x) + O.normCdf(-x), 1, 1e-14, 'symmetry at ' + x);
  let prev = -1;
  for (let x = -10; x <= 10; x += 0.1) { const v = O.normCdf(x); assert.ok(v >= prev, 'monotone at ' + x); prev = v; }
});

test('normPdf and normInv', () => {
  near(O.normPdf(0), 0.3989422804014327, 1e-15);
  near(O.normInv(0.975), 1.959963984540054, 1e-9);
  near(O.normInv(0.5), 0, 1e-12);
  near(O.normInv(0.001), -3.090232306167813, 1e-9);
  for (let p = 0.0005; p < 1; p += 0.0137) near(O.normCdf(O.normInv(p)), p, 1e-12, 'round-trip ' + p);
  assert.strictEqual(O.normInv(0), -Infinity);
  assert.strictEqual(O.normInv(1), Infinity);
  assert.ok(Number.isNaN(O.normInv(1.5)));
});

/* ------------------------------------------------------------------ *
 * Black-Scholes-Merton
 * ------------------------------------------------------------------ */
const base = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 };

test('bs: textbook call ≈ 10.4506 and put ≈ 5.5735 (S=100, K=100, T=1, r=5%, σ=20%)', () => {
  const c = O.bs(Object.assign({ type: 'call' }, base));
  const p = O.bs(Object.assign({ type: 'put' }, base));
  near(c.price, 10.4506, 5e-5, 'call');
  near(p.price, 5.5735, 5e-5, 'put');
  // high-precision reference values
  near(c.price, 10.450583572185565, 1e-10, 'call hi-res');
  near(p.price, 5.573526022256971, 1e-10, 'put hi-res');
  assert.strictEqual(c.type, 'call');
  assert.strictEqual(p.type, 'put');
});

test('bs: put-call parity C - P = S e^{-qT} - K e^{-rT} holds across strikes, vols, dividends', () => {
  const grid = [
    { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, q: 0 },
    { S: 100, K: 80, T: 0.25, r: 0.03, sigma: 0.35, q: 0 },
    { S: 100, K: 130, T: 2, r: 0.01, sigma: 0.15, q: 0.02 },
    { S: 55.5, K: 60, T: 0.05, r: 0.05, sigma: 0.6, q: 0.01 },
    { S: 3000, K: 2500, T: 0.5, r: 0.045, sigma: 0.22, q: 0.015 }
  ];
  grid.forEach(g => {
    const c = O.bs(Object.assign({ type: 'call' }, g)).price;
    const p = O.bs(Object.assign({ type: 'put' }, g)).price;
    const rhs = g.S * Math.exp(-g.q * g.T) - g.K * Math.exp(-g.r * g.T);
    near(c - p, rhs, 1e-9, 'parity ' + JSON.stringify(g));
  });
});

test('bs: greeks match finite differences and known values', () => {
  const c = O.bs(Object.assign({ type: 'call' }, base));
  const p = O.bs(Object.assign({ type: 'put' }, base));
  // Known values for the textbook case
  near(c.delta, 0.6368306511756191, 1e-10, 'call delta');
  near(p.delta, c.delta - 1, 1e-12, 'put delta = call delta - 1');
  near(c.gamma, 0.018762017345846895, 1e-10, 'gamma');
  near(c.gamma, p.gamma, 1e-14, 'gamma same for call & put');
  near(c.vega, p.vega, 1e-14, 'vega same for call & put');
  near(c.vega, 0.3752403469169379, 1e-10, 'vega per vol point');
  near(c.theta * 365, -6.414027546472793, 1e-8, 'annual theta');
  near(c.rho, 0.5323248154537634, 1e-10, 'rho per pct point');

  // Finite-difference checks
  const h = 1e-4;
  const fS = s => O.bs(Object.assign({ type: 'call' }, base, { S: s })).price;
  near(c.delta, (fS(100 + h) - fS(100 - h)) / (2 * h), 1e-6, 'delta FD');
  near(c.gamma, (fS(100 + h) - 2 * fS(100) + fS(100 - h)) / (h * h), 1e-4, 'gamma FD');
  const fV = v => O.bs(Object.assign({ type: 'call' }, base, { sigma: v })).price;
  near(c.vega, (fV(0.2 + 0.0001) - fV(0.2 - 0.0001)) / (2 * 0.0001) / 100, 1e-6, 'vega FD');
  const fT = t => O.bs(Object.assign({ type: 'call' }, base, { T: t })).price;
  near(c.theta, -(fT(1 + h) - fT(1 - h)) / (2 * h) / 365, 1e-6, 'theta FD (per day)');
  const fR = r => O.bs(Object.assign({ type: 'call' }, base, { r })).price;
  near(c.rho, (fR(0.05 + h) - fR(0.05 - h)) / (2 * h) / 100, 1e-6, 'rho FD');
  // Signs students learn
  assert.ok(c.theta < 0 && p.theta < 0, 'long options decay');
  assert.ok(c.rho > 0 && p.rho < 0, 'rho signs');
  assert.ok(c.probITM > 0.5 && c.probITM < 0.7);
  near(c.intrinsic, 0, 0); near(c.extrinsic, c.price, 1e-12);
});

test('bs: dividend yield lowers calls and raises puts', () => {
  const c0 = O.bs(Object.assign({ type: 'call' }, base)).price;
  const c1 = O.bs(Object.assign({ type: 'call', q: 0.03 }, base)).price;
  const p0 = O.bs(Object.assign({ type: 'put' }, base)).price;
  const p1 = O.bs(Object.assign({ type: 'put', q: 0.03 }, base)).price;
  assert.ok(c1 < c0 && p1 > p0);
});

test('bs: degenerate inputs fall back to intrinsic value', () => {
  const exp = O.bs({ S: 110, K: 100, T: 0, r: 0.05, sigma: 0.2, type: 'call' });
  assert.strictEqual(exp.price, 10); assert.strictEqual(exp.delta, 1); assert.strictEqual(exp.gamma, 0); assert.strictEqual(exp.theta, 0);
  const otm = O.bs({ S: 90, K: 100, T: 0, r: 0.05, sigma: 0.2, type: 'call' });
  assert.strictEqual(otm.price, 0); assert.strictEqual(otm.delta, 0);
  const putExp = O.bs({ S: 90, K: 100, T: 0, sigma: 0.2, type: 'put' });
  assert.strictEqual(putExp.price, 10); assert.strictEqual(putExp.delta, -1);
  // zero vol with time left: discounted forward intrinsic
  const zv = O.bs({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0, type: 'call' });
  near(zv.price, 100 - 100 * Math.exp(-0.05), 1e-12);
  // sigma = 0 with time left must be the continuous sigma -> 0 limit of BS:
  // moneyness on the FORWARD, delta = +/-e^{-qT}, theta = -carry, rho = +/-T K e^{-rT}.
  for (const p of [
    { S: 100, K: 100, T: 1, r: 0.05, type: 'call' },         // spot ATM, forward ITM
    { S: 100, K: 104, T: 1, r: 0.05, type: 'call' },         // spot OTM, forward ITM
    { S: 100, K: 110, T: 1, r: 0.05, type: 'put' },
    { S: 100, K: 100, T: 0.5, r: 0.03, q: 0.06, type: 'put' },
    { S: 100, K: 110, T: 1, r: 0.05, type: 'call' }          // forward OTM: all zero
  ]) {
    const a = O.bs(Object.assign({}, p, { sigma: 0 })), b = O.bs(Object.assign({}, p, { sigma: 1e-6 }));
    for (const k of ['price', 'delta', 'gamma', 'theta', 'vega', 'rho']) near(a[k], b[k], 1e-4, 'sigma=0 limit ' + k + ' ' + JSON.stringify(p));
  }
  near(zv.delta, 1, 0); near(zv.theta, -(0.05 * 100 * Math.exp(-0.05)) / 365, 1e-12); near(zv.rho, 100 * Math.exp(-0.05) / 100, 1e-12);
  assert.throws(() => O.bs({ S: 'x', K: 100 }));
  // very short dated & very long dated still finite
  const tiny = O.bs({ S: 100, K: 100, T: 1 / 365 / 24, r: 0.05, sigma: 0.2, type: 'call' });
  assert.ok(isFinite(tiny.price) && tiny.price > 0 && tiny.price < 1);
  const leaps = O.bs({ S: 100, K: 100, T: 3, r: 0.05, sigma: 0.2, type: 'put' });
  assert.ok(isFinite(leaps.price) && leaps.price > 0);
});

/* ------------------------------------------------------------------ *
 * Implied volatility
 * ------------------------------------------------------------------ */
test('impliedVol: round-trips the textbook price to σ = 0.20', () => {
  const c = O.bs(Object.assign({ type: 'call' }, base)).price;
  near(O.impliedVol({ price: c, S: 100, K: 100, T: 1, r: 0.05, type: 'call' }), 0.2, 1e-8);
  const p = O.bs(Object.assign({ type: 'put' }, base)).price;
  near(O.impliedVol({ price: p, S: 100, K: 100, T: 1, r: 0.05, type: 'put' }), 0.2, 1e-8);
});

test('impliedVol: round-trips across moneyness, tenor and vol level', () => {
  const sigmas = [0.05, 0.12, 0.3, 0.8, 1.5];
  const Ks = [60, 85, 100, 115, 160];
  const Ts = [7 / 365, 0.25, 1, 2.5];
  let n = 0;
  sigmas.forEach(sigma => Ks.forEach(K => Ts.forEach(T => ['call', 'put'].forEach(type => {
    const price = O.bs({ S: 100, K, T, r: 0.04, sigma, type }).price;
    if (price < 1e-6) return; // essentially worthless; vega ~0, any vol fits — skip
    const iv = O.impliedVol({ price, S: 100, K, T, r: 0.04, type });
    assert.ok(iv != null, 'solvable ' + JSON.stringify({ sigma, K, T, type }));
    // Where vega is tiny the price has no information; check price error instead.
    const back = O.bs({ S: 100, K, T, r: 0.04, sigma: iv, type }).price;
    near(back, price, 1e-8, 'price round-trip ' + JSON.stringify({ sigma, K, T, type }));
    const g = O.bs({ S: 100, K, T, r: 0.04, sigma, type });
    if (g.vega > 0.01) near(iv, sigma, 1e-6, 'vol round-trip ' + JSON.stringify({ sigma, K, T, type }));
    n++;
  }))));
  assert.ok(n > 100, 'ran ' + n + ' cases');
});

test('impliedVol: returns null when no vol can reproduce the price', () => {
  // below intrinsic (arbitrage) and above the upper bound S
  assert.strictEqual(O.impliedVol({ price: 5, S: 120, K: 100, T: 0.5, r: 0.05, type: 'call' }), null);
  assert.strictEqual(O.impliedVol({ price: 150, S: 100, K: 100, T: 0.5, r: 0.05, type: 'call' }), null);
  assert.strictEqual(O.impliedVol({ price: 5, S: 100, K: 100, T: 0, r: 0.05, type: 'call' }), null);
  assert.strictEqual(O.impliedVol({ price: NaN, S: 100, K: 100, T: 1 }), null);
});

/* ------------------------------------------------------------------ *
 * OCC ids
 * ------------------------------------------------------------------ */
test('occ / parseOcc: encode and decode round-trip, including fractional strikes and dotted roots', () => {
  assert.strictEqual(O.occ('AAPL', '2026-01-17', 'C', 200), 'AAPL260117C00200000');
  assert.strictEqual(O.occ('aapl', '2026-01-17', 'put', 200), 'AAPL260117P00200000');
  assert.strictEqual(O.occ('SPY', '2025-12-19', 'P', 452.5), 'SPY251219P00452500');
  assert.strictEqual(O.occ('BRK.B', '2026-06-18', 'C', 1000), 'BRK.B260618C01000000');
  assert.deepStrictEqual(O.parseOcc('AAPL260117C00200000'), { underlying: 'AAPL', expiry: '2026-01-17', right: 'C', strike: 200, multiplier: 100 });
  assert.deepStrictEqual(O.parseOcc('SPY251219P00452500'), { underlying: 'SPY', expiry: '2025-12-19', right: 'P', strike: 452.5, multiplier: 100 });
  assert.deepStrictEqual(O.parseOcc('BRK.B260618C01000000').underlying, 'BRK.B');
  // round trip on a grid
  ['TSLA', 'F', 'GOOGL', 'BRK.B'].forEach(u => ['2025-01-03', '2027-12-31'].forEach(e => ['C', 'P'].forEach(r => [0.5, 12.5, 199.99, 3000].forEach(k => {
    const id = O.occ(u, e, r, k);
    const p = O.parseOcc(id);
    assert.strictEqual(p.underlying, u); assert.strictEqual(p.expiry, e); assert.strictEqual(p.right, r); near(p.strike, Math.round(k * 1000) / 1000, 1e-9);
  }))));
  // invalid
  assert.strictEqual(O.parseOcc('nonsense'), null);
  assert.strictEqual(O.parseOcc('AAPL261317C00200000'), null); // month 13
  assert.strictEqual(O.parseOcc('AAPL260117X00200000'), null);
  assert.strictEqual(O.parseOcc(''), null);
  assert.throws(() => O.occ('AAPL', '01/17/2026', 'C', 200));
  assert.throws(() => O.occ('AAPL', '2026-01-17', 'S', 200));
  assert.strictEqual(O.describeContract('AAPL260117C00200000'), 'AAPL 17 Jan 2026 $200 Call');
});

test('dates: expiryFromDays, monthlyExpiries (third Fridays), yearsToExpiry', () => {
  const now = new Date('2026-01-05T15:00:00Z');
  assert.strictEqual(O.expiryFromDays(30, now), '2026-02-04');
  const m = O.monthlyExpiries(3, now);
  assert.deepStrictEqual(m, ['2026-01-16', '2026-02-20', '2026-03-20']);
  m.forEach(iso => assert.strictEqual(new Date(iso + 'T12:00:00Z').getUTCDay(), 5, iso + ' is a Friday'));
  near(O.yearsToExpiry('2027-01-05', now), 1, 2 / 365);
  assert.strictEqual(O.yearsToExpiry('2020-01-01', now), 0);
  assert.ok(Number.isNaN(O.yearsToExpiry('bad', now)));
});

/* ------------------------------------------------------------------ *
 * Synthetic chain
 * ------------------------------------------------------------------ */
test('chain: shape, ordering, strike increments, ids, spreads', () => {
  const now = new Date('2026-01-05T15:00:00Z');
  const rows = O.chain(100, { symbol: 'TEST', expiries: [30, 60], ivBase: 0.25, now });
  assert.ok(rows.length > 20);
  assert.deepStrictEqual(rows.expiries, ['2026-02-04', '2026-03-06']);
  assert.strictEqual(rows.spot, 100);
  const keys = ['contract', 'strike', 'expiry', 'right', 'bid', 'ask', 'mid', 'iv', 'delta', 'gamma', 'theta', 'vega', 'oi', 'volume'];
  rows.forEach(r => {
    keys.forEach(k => assert.ok(k in r, 'row has ' + k));
    assert.ok(r.bid >= 0 && r.ask > r.bid, 'bid<ask ' + r.contract);
    near(r.mid, (r.bid + r.ask) / 2, 1e-9, 'mid');
    assert.ok(r.iv > 0.05 && r.iv < 3);
    assert.ok(r.oi > 0 && r.volume >= 0);
    assert.ok(Number.isInteger(r.oi) && Number.isInteger(r.volume));
    const p = O.parseOcc(r.contract);
    assert.strictEqual(p.underlying, 'TEST'); assert.strictEqual(p.expiry, r.expiry); assert.strictEqual(p.right, r.right); near(p.strike, r.strike, 1e-9);
    if (r.right === 'C') assert.ok(r.delta >= 0 && r.delta <= 1); else assert.ok(r.delta <= 0 && r.delta >= -1);
    // strikes on the $2.5 grid for a $100 stock
    near((r.strike / 2.5) % 1, 0, 1e-9, 'strike grid');
  });
  // sorted by expiry, strike, right (C before P)
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    assert.ok(a.expiry < b.expiry || (a.expiry === b.expiry && (a.strike < b.strike || (a.strike === b.strike && a.right === 'C' && b.right === 'P'))), 'ordering at ' + i);
  }
  // Each strike has both a call and a put
  const slice = O.chainSlice(rows, '2026-02-04');
  assert.strictEqual(slice.filter(r => r.right === 'C').length, slice.filter(r => r.right === 'P').length);
  // increments by price level
  assert.strictEqual(O.strikeIncrement(10), 1);
  assert.strictEqual(O.strikeIncrement(60), 2.5);
  assert.strictEqual(O.strikeIncrement(150), 5);
  assert.strictEqual(O.strikeIncrement(500), 10);
  const big = O.chain(480, { expiries: [30], now });
  big.forEach(r => near(r.strike % 10, 0, 1e-9, 'big strikes on $10 grid'));
  // deterministic
  const again = O.chain(100, { symbol: 'TEST', expiries: [30, 60], ivBase: 0.25, now });
  assert.deepStrictEqual(again.map(r => [r.contract, r.bid, r.ask, r.oi, r.volume]), rows.map(r => [r.contract, r.bid, r.ask, r.oi, r.volume]));
  assert.throws(() => O.chain(0));
});

test('chain: volatility smile with downside skew (puts richer than calls)', () => {
  const now = new Date('2026-01-05T15:00:00Z');
  const rows = O.chain(100, { symbol: 'TEST', expiries: [30], ivBase: 0.25, now });
  const puts = O.chainSlice(rows, rows.expiries[0], 'P');
  const atm = O.atmRow(rows, rows.expiries[0], 'P');
  assert.strictEqual(atm.strike, 100);
  near(atm.iv, 0.25, 0.03, 'ATM iv close to ivBase');
  const byStrike = k => puts.find(r => r.strike === k);
  // OTM put (lower strike) carries more IV than the equally-OTM call strike
  assert.ok(byStrike(90).iv > byStrike(110).iv, 'skew: 90 put IV > 110 strike IV');
  assert.ok(byStrike(80).iv > byStrike(90).iv, 'IV rises as strikes fall');
  // Symmetric OTM put is pricier than OTM call in extrinsic terms (relative to forward)
  const put90 = byStrike(90), call110 = rows.find(r => r.strike === 110 && r.right === 'C');
  assert.ok(put90.mid > call110.mid, 'puts richer: 90P mid > 110C mid');
  // Same IV for the call and put at a strike (parity-consistent)
  rows.forEach(r => { if (r.right === 'C') { const p = rows.find(x => x.strike === r.strike && x.expiry === r.expiry && x.right === 'P'); assert.strictEqual(p.iv, r.iv); } });
  // Spreads widen away from the money
  const atmC = O.atmRow(rows, rows.expiries[0], 'C');
  const farC = rows.find(r => r.right === 'C' && r.strike === 120);
  assert.ok((atmC.ask - atmC.bid) / atmC.mid < (farC.ask - farC.bid) / farC.mid, 'relative spread wider OTM');
  // Open interest concentrates near the money
  assert.ok(atmC.oi > farC.oi, 'ATM OI > far OTM OI');
  // Term structure: 7-day smile is sharper than 180-day
  const multi = O.chain(100, { expiries: [7, 180], ivBase: 0.25, now });
  const iv7 = multi.find(r => r.expiry === multi.expiries[0] && r.strike === 90 && r.right === 'P').iv;
  const iv180 = multi.find(r => r.expiry === multi.expiries[1] && r.strike === 90 && r.right === 'P').iv;
  assert.ok(iv7 > iv180, 'short-dated skew steeper');
});

/* ------------------------------------------------------------------ *
 * Payoff
 * ------------------------------------------------------------------ */
test('payoff: long call / long put / stock legs', () => {
  const lc = O.payoff([{ right: 'C', strike: 100, qty: 1, premium: 5 }], [80, 100, 105, 120]);
  assert.deepStrictEqual(lc.map(p => [p.S, p.pnl]), [[80, -500], [100, -500], [105, 0], [120, 1500]]);
  const sp = O.payoff([{ right: 'P', strike: 100, qty: -1, premium: 4 }], [80, 96, 100, 120]);
  assert.deepStrictEqual(sp.map(p => [p.S, p.pnl]), [[80, -1600], [96, 0], [100, 400], [120, 400]]);
  const st = O.payoff([{ right: 'S', strike: 50, qty: 100 }], [40, 50, 60]);
  assert.deepStrictEqual(st.map(p => p.pnl), [-1000, 0, 1000]);
  // stock leg accepts entry price as premium too
  // (the entry price is injected into the range as a kink, like strikes are)
  const st2 = O.payoff([{ right: 'S', premium: 50, qty: -100 }], [40, 60]);
  assert.deepStrictEqual(st2.map(p => [p.S, p.pnl]), [[40, 1000], [50, 0], [60, -1000]]);
});

test('payoff: strikes are injected into the range, range object and auto range work', () => {
  const r = O.payoff([{ right: 'C', strike: 101.3, qty: 1, premium: 1 }], { min: 90, max: 110, steps: 5 });
  assert.ok(r.some(p => p.S === 101.3), 'strike present');
  assert.strictEqual(r[0].S, 90); assert.strictEqual(r[r.length - 1].S, 110);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].S > r[i - 1].S, 'ascending unique');
  const auto = O.payoff([{ right: 'C', strike: 100, qty: 1, premium: 3 }, { right: 'C', strike: 110, qty: -1, premium: 1 }]);
  assert.ok(auto.length > 50 && auto[0].S < 100 && auto[auto.length - 1].S > 110);
  assert.deepStrictEqual(O.payoff([], [1, 2]).map(p => p.pnl), [0, 0]);
});

/* ------------------------------------------------------------------ *
 * analyze()
 * ------------------------------------------------------------------ */
test('analyze: long call → unlimited profit, loss = premium, breakeven = K + premium', () => {
  const a = O.analyze([{ right: 'C', strike: 100, qty: 1, premium: 4.5 }]);
  assert.strictEqual(a.maxProfit, Infinity);
  assert.strictEqual(a.maxLoss, -450);
  assert.deepStrictEqual(a.breakevens, [104.5]);
  assert.strictEqual(a.netCost, 450);
  assert.strictEqual(a.isCredit, false);
  assert.strictEqual(a.profitAbove, 104.5);
  assert.ok(/unlimited/.test(a.summary));
});

test('analyze: long put → max profit (K - prem) x 100, breakeven K - premium', () => {
  const a = O.analyze([{ right: 'P', strike: 100, qty: 1, premium: 3 }]);
  assert.strictEqual(a.maxProfit, 9700);
  assert.strictEqual(a.maxLoss, -300);
  assert.deepStrictEqual(a.breakevens, [97]);
  assert.strictEqual(a.profitBelow, 97);
});

test('analyze: short call → unlimited loss; short put → loss bounded by strike', () => {
  const sc = O.analyze([{ right: 'C', strike: 100, qty: -1, premium: 2 }]);
  assert.strictEqual(sc.maxProfit, 200); assert.strictEqual(sc.maxLoss, -Infinity); assert.deepStrictEqual(sc.breakevens, [102]);
  assert.strictEqual(sc.isCredit, true); assert.strictEqual(sc.netCost, -200);
  const sp = O.analyze([{ right: 'P', strike: 100, qty: -1, premium: 2 }]);
  assert.strictEqual(sp.maxProfit, 200); assert.strictEqual(sp.maxLoss, -9800); assert.deepStrictEqual(sp.breakevens, [98]);
});

test('analyze: bull call spread → profit = width - debit, loss = debit, breakeven = lower + debit', () => {
  const a = O.analyze([{ right: 'C', strike: 100, qty: 1, premium: 5 }, { right: 'C', strike: 110, qty: -1, premium: 2 }]);
  assert.strictEqual(a.maxProfit, 700); assert.strictEqual(a.maxLoss, -300); assert.deepStrictEqual(a.breakevens, [103]);
  assert.strictEqual(a.netCost, 300); assert.strictEqual(a.riskReward, 2.33);
});

test('analyze: bear put spread', () => {
  const a = O.analyze([{ right: 'P', strike: 100, qty: 1, premium: 4 }, { right: 'P', strike: 90, qty: -1, premium: 1.5 }]);
  assert.strictEqual(a.maxProfit, 750); assert.strictEqual(a.maxLoss, -250); assert.deepStrictEqual(a.breakevens, [97.5]);
});

test('analyze: covered call and protective put', () => {
  const cc = O.analyze([{ right: 'S', strike: 100, qty: 100 }, { right: 'C', strike: 105, qty: -1, premium: 2 }]);
  assert.strictEqual(cc.maxProfit, 700);      // (105-100 + 2) x 100
  assert.strictEqual(cc.maxLoss, -9800);      // stock to zero, cushioned by premium
  assert.deepStrictEqual(cc.breakevens, [98]);
  const pp = O.analyze([{ right: 'S', strike: 100, qty: 100 }, { right: 'P', strike: 95, qty: 1, premium: 2 }]);
  assert.strictEqual(pp.maxProfit, Infinity);
  assert.strictEqual(pp.maxLoss, -700);       // (100-95 + 2) x 100
  assert.deepStrictEqual(pp.breakevens, [102]);
});

test('analyze: straddle and strangle have two breakevens', () => {
  const st = O.analyze([{ right: 'C', strike: 100, qty: 1, premium: 4 }, { right: 'P', strike: 100, qty: 1, premium: 3.5 }]);
  assert.strictEqual(st.maxProfit, Infinity); assert.strictEqual(st.maxLoss, -750);
  assert.deepStrictEqual(st.breakevens, [92.5, 107.5]);
  assert.deepStrictEqual(st.profitOutside, [92.5, 107.5]);
  const sg = O.analyze([{ right: 'C', strike: 105, qty: 1, premium: 2 }, { right: 'P', strike: 95, qty: 1, premium: 1.5 }]);
  assert.strictEqual(sg.maxLoss, -350); assert.deepStrictEqual(sg.breakevens, [91.5, 108.5]);
});

test('analyze: iron condor → profit = credit, loss = (width - credit) x 100, two breakevens', () => {
  const legs = [
    { right: 'P', strike: 85, qty: 1, premium: 0.5 }, { right: 'P', strike: 90, qty: -1, premium: 1.5 },
    { right: 'C', strike: 110, qty: -1, premium: 1.2 }, { right: 'C', strike: 115, qty: 1, premium: 0.4 }
  ];
  const a = O.analyze(legs);
  near(a.maxProfit, 180, 1e-9); near(a.maxLoss, -320, 1e-9);
  assert.deepStrictEqual(a.breakevens, [88.2, 111.8]);
  assert.deepStrictEqual(a.profitBetween, [88.2, 111.8]);
  assert.strictEqual(a.isCredit, true);
  near(a.netCost, -180, 1e-9);
});

test('analyze: butterfly, breakeven exactly at a kink, probability of profit', () => {
  const bf = O.analyze([{ right: 'C', strike: 95, qty: 1, premium: 7 }, { right: 'C', strike: 100, qty: -2, premium: 4 }, { right: 'C', strike: 105, qty: 1, premium: 2 }]);
  assert.strictEqual(bf.maxProfit, 400); assert.strictEqual(bf.maxLoss, -100); assert.deepStrictEqual(bf.breakevens, [96, 104]);
  // zero-premium call: breakeven sits exactly on the strike
  const z = O.analyze([{ right: 'C', strike: 100, qty: 1, premium: 0 }]);
  assert.deepStrictEqual(z.breakevens, [100]);
  // probability of profit under lognormal
  const a = O.analyze([{ right: 'C', strike: 100, qty: 1, premium: 4 }], { spot: 100, iv: 0.25, T: 30 / 365, r: 0.05 });
  assert.ok(a.probProfit > 0.2 && a.probProfit < 0.5, 'pop ' + a.probProfit);
  const credit = O.analyze([{ right: 'P', strike: 90, qty: -1, premium: 1 }], { spot: 100, iv: 0.25, T: 30 / 365, r: 0.05 });
  assert.ok(credit.probProfit > 0.8, 'OTM short put high pop ' + credit.probProfit);
  assert.deepStrictEqual(O.analyze([]).breakevens, []);
});

/* ------------------------------------------------------------------ *
 * Strategy presets
 * ------------------------------------------------------------------ */
test('strategies: all nine contract presets exist with descriptions and build consistent legs', () => {
  const required = ['longCall', 'longPut', 'coveredCall', 'protectivePut', 'bullCallSpread', 'bearPutSpread', 'straddle', 'strangle', 'ironCondor'];
  required.forEach(id => {
    const s = O.strategies[id];
    assert.ok(s, id + ' exists');
    assert.strictEqual(s.id, id);
    assert.ok(typeof s.name === 'string' && s.name.length > 3);
    assert.ok(typeof s.description === 'string' && s.description.length > 200, id + ' has a paragraph description');
    assert.ok(typeof s.when === 'string' && typeof s.risk === 'string');
    const legs = s.build(100, { iv: 0.25, T: 45 / 365, r: 0.05 });
    assert.ok(Array.isArray(legs) && legs.length >= 1);
    legs.forEach(l => { assert.ok(['C', 'P', 'S'].includes(l.right)); assert.ok(isFinite(l.strike)); assert.ok(isFinite(l.premium) && l.premium >= 0); assert.ok(l.qty !== 0); });
    const a = O.analyze(legs);
    assert.ok(a.breakevens.length >= 1, id + ' has a breakeven');
  });
  assert.strictEqual(O.strategyList().slice(0, 9).map(s => s.id).join(','), required.join(','));
});

test('strategies: payoff shapes match the textbook', () => {
  const S = 100, o = { iv: 0.25, T: 45 / 365, r: 0.05 };
  const b = id => O.buildStrategy(id, S, o);
  const lc = b('longCall'); assert.strictEqual(lc.analysis.maxProfit, Infinity); assert.ok(lc.analysis.maxLoss < 0 && lc.analysis.maxLoss > -2000);
  const lp = b('longPut'); assert.ok(isFinite(lp.analysis.maxProfit) && lp.analysis.maxProfit > 0);
  const cc = b('coveredCall'); assert.ok(cc.analysis.isCredit && isFinite(cc.analysis.maxProfit) && cc.analysis.maxLoss < -5000);
  const pp = b('protectivePut'); assert.strictEqual(pp.analysis.maxProfit, Infinity); assert.ok(pp.analysis.maxLoss > -2000, 'put floors the loss');
  const bcs = b('bullCallSpread'); assert.ok(isFinite(bcs.analysis.maxProfit) && isFinite(bcs.analysis.maxLoss)); near(bcs.analysis.maxProfit - bcs.analysis.maxLoss, 1000, 1e-6, 'width 10 x 100');
  const bps = b('bearPutSpread'); near(bps.analysis.maxProfit - bps.analysis.maxLoss, 1000, 1e-6);
  const sd = b('straddle'); assert.strictEqual(sd.analysis.breakevens.length, 2); assert.strictEqual(sd.legs[0].strike, sd.legs[1].strike);
  const sg = b('strangle'); assert.strictEqual(sg.analysis.breakevens.length, 2); assert.ok(sg.analysis.maxLoss > sd.analysis.maxLoss, 'strangle cheaper than straddle');
  const ic = b('ironCondor'); assert.strictEqual(ic.legs.length, 4); assert.ok(ic.analysis.isCredit); assert.strictEqual(ic.analysis.breakevens.length, 2); near(ic.analysis.maxProfit - ic.analysis.maxLoss, 500, 1e-6, 'wing width 5 x 100');
  assert.ok(ic.analysis.probProfit > 0.6, 'condor high probability');
  // puts richer: the preset put costs more than the equally-OTM call
  assert.ok(sg.legs.find(l => l.right === 'P').premium > sg.legs.find(l => l.right === 'C').premium * 0.9);
  assert.ok(Array.isArray(lc.payoff) && lc.payoff.length > 10);
  assert.throws(() => O.buildStrategy('nope', 100));
  // works at other price levels / increments
  const small = O.buildStrategy('ironCondor', 18.4, o); small.legs.forEach(l => near(l.strike % 1, 0, 1e-9, '$1 grid'));
  const large = O.buildStrategy('bullCallSpread', 912, o); large.legs.forEach(l => near(l.strike % 10, 0, 1e-9, '$10 grid'));
});

test('positionGreeks: stock is pure delta, straddle is near delta-neutral with positive gamma/vega', () => {
  const g = O.positionGreeks([{ right: 'S', strike: 100, qty: 100 }], 100);
  assert.deepStrictEqual(g, { delta: 100, gamma: 0, theta: 0, vega: 0, rho: 0 });
  const sd = O.positionGreeks([{ right: 'C', strike: 100, qty: 1, premium: 0 }, { right: 'P', strike: 100, qty: 1, premium: 0 }], 100, { T: 30 / 365, iv: 0.25 });
  assert.ok(Math.abs(sd.delta) < 15 && sd.gamma > 0 && sd.vega > 0 && sd.theta < 0);
});

test('glossary and exports', () => {
  ['delta', 'gamma', 'theta', 'vega', 'iv', 'breakeven'].forEach(k => assert.ok(O.glossary[k].length > 20));
  assert.strictEqual(O.MULTIPLIER, 100);
  ['bs', 'impliedVol', 'chain', 'payoff', 'analyze', 'occ', 'parseOcc', 'strategies'].forEach(k => assert.ok(O[k], 'export ' + k));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
