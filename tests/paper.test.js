/* Broward Trading — tests for js/paper.js (BT.paper)
 * Run with:  node tests/paper.test.js
 * Plain node + assert, no framework. The module expects `window` and (optionally)
 * `localStorage`, so both are shimmed here.
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
global.window = { localStorage: global.localStorage };
require(path.join(__dirname, '..', 'js', 'paper.js'));
const P = window.BT.paper;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-6 : tol;
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a + ' (tol ' + tol + ')');
}
function bar(o, h, l, c, time) { return { time: time || '2024-03-01', open: o, high: h, low: l, close: c, volume: 1000 }; }
let fakeNow = Date.UTC(2024, 2, 1, 15, 0, 0);
P.setClock(() => fakeNow);
function fresh(cash) { localStorage.clear(); P.reset(cash == null ? 100000 : cash); P.setSettings({ commission: 0 }); return P.getState(); }

console.log('BT.paper tests');

/* ------------------------------------------------------------------ */
test('module exposes every contract function and a fresh default state', () => {
  ['load', 'save', 'reset', 'placeOrder', 'processOrders', 'markToMarket', 'closePosition', 'cancelOrder',
    'placeOptionOrder', 'stats'].forEach(f => assert.strictEqual(typeof P[f], 'function', f + ' missing'));
  const s = fresh();
  assert.strictEqual(s.cash, 100000);
  assert.strictEqual(s.startingCash, 100000);
  assert.deepStrictEqual(s.positions, {});
  assert.deepStrictEqual(s.orders, []);
  assert.deepStrictEqual(s.trades, []);
  assert.deepStrictEqual(s.equityHistory, []);
  assert.strictEqual(P.settings.commission, 0);
});

/* ---------------- market orders & average cost ---------------------- */
test('market buy fills immediately at the given price and debits cash', () => {
  const s = fresh();
  const o = P.placeOrder({ symbol: 'aapl', side: 'buy', qty: 10, type: 'market' }, 150);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.symbol, 'AAPL');
  assert.strictEqual(o.fillPrice, 150);
  assert.strictEqual(s.cash, 100000 - 1500);
  assert.deepStrictEqual({ qty: s.positions.AAPL.qty, avg: s.positions.AAPL.avg, kind: s.positions.AAPL.kind }, { qty: 10, avg: 150, kind: 'stock' });
  assert.strictEqual(s.trades.length, 1);
  assert.strictEqual(s.trades[0].openedQty, 10);
  assert.strictEqual(s.trades[0].closedQty, 0);
});

test('market order without a price is rejected with a readable reason', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' });
  assert.strictEqual(o.status, 'rejected');
  assert.ok(/price/i.test(o.reason), o.reason);
});

test('average cost is share-weighted when adding; selling part keeps avg and realizes P&L', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 10, type: 'market' }, 100);
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 30, type: 'market' }, 120);
  near(s.positions.MSFT.avg, 115); // (10*100 + 30*120) / 40
  assert.strictEqual(s.positions.MSFT.qty, 40);
  const sell = P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 15, type: 'market' }, 130);
  assert.strictEqual(sell.status, 'filled');
  assert.strictEqual(s.positions.MSFT.qty, 25);
  near(s.positions.MSFT.avg, 115);
  const t = s.trades[s.trades.length - 1];
  near(t.realized, 15 * (130 - 115)); // 225
  near(s.realized, 225);
  near(s.cash, 100000 - 1000 - 3600 + 1950);
});

test('selling the whole position removes it; a losing close realizes a negative number', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'TSLA', side: 'buy', qty: 5, type: 'market' }, 200);
  P.placeOrder({ symbol: 'TSLA', side: 'sell', qty: 5, type: 'market' }, 180);
  assert.strictEqual(s.positions.TSLA, undefined);
  near(s.realized, -100);
  near(s.cash, 100000 - 100);
});

test('buy that costs more than cash is rejected, cash and positions untouched', () => {
  const s = fresh(1000);
  const o = P.placeOrder({ symbol: 'NVDA', side: 'buy', qty: 10, type: 'market' }, 500);
  assert.strictEqual(o.status, 'rejected');
  assert.ok(/Not enough cash/.test(o.reason), o.reason);
  assert.ok(/up to 2/.test(o.reason), 'should suggest the affordable quantity: ' + o.reason);
  assert.strictEqual(s.cash, 1000);
  assert.deepStrictEqual(s.positions, {});
  assert.strictEqual(s.orders[s.orders.length - 1].status, 'rejected');
});

test('order validation: bad side / qty / type / missing prices produce rejections, not throws', () => {
  fresh();
  assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'hold', qty: 1 }, 10).status, 'rejected');
  assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 0 }, 10).status, 'rejected');
  assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1.5 }, 10).status, 'rejected');
  assert.strictEqual(P.placeOrder({ symbol: '', side: 'buy', qty: 1 }, 10).status, 'rejected');
  assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'oco' }, 10).status, 'rejected');
  const noLimit = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit' }, 10);
  assert.strictEqual(noLimit.status, 'rejected'); assert.ok(/limit price/.test(noLimit.reason));
  const noStop = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'stop' }, 10);
  assert.strictEqual(noStop.status, 'rejected'); assert.ok(/stop price/.test(noStop.reason));
  const badSL = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'stop_limit', stopPrice: 20, limitPrice: 15 }, 10);
  assert.strictEqual(badSL.status, 'rejected'); assert.ok(/never fill/.test(badSL.reason));
  assert.strictEqual(P.placeOrder(null, 10).status, 'rejected');
  assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, tif: 'week' }, 10).status, 'rejected');
});

test('commission is charged per fill and included in realized P&L', () => {
  const s = fresh();
  P.setSettings({ commission: 1 });
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  near(s.cash, 100000 - 1000 - 1);
  P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 101);
  near(s.cash, 100000 - 1000 - 1 + 1010 - 1);
  near(s.realized, 10 - 2);
  assert.strictEqual(P.stats().commissionsPaid, 2);
  P.setSettings({ commission: 0 });
});

/* ---------------- limit orders -------------------------------------- */
test('buy limit below market rests open, fills when a bar low reaches it at the limit price', () => {
  const s = fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'limit', limitPrice: 95 }, 100);
  assert.strictEqual(o.status, 'open');
  assert.strictEqual(s.cash, 100000, 'no cash moves until filled');
  assert.deepStrictEqual(P.processOrders('AAPL', bar(100, 102, 96, 101)), []);
  assert.strictEqual(o.status, 'open');
  const fills = P.processOrders('AAPL', bar(99, 101, 94.5, 97));
  assert.strictEqual(fills.length, 1);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 95);
  assert.strictEqual(s.positions.AAPL.qty, 10);
  near(s.cash, 100000 - 950);
});

test('buy limit that gaps down fills at the better open price', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 95 }, 100);
  P.processOrders('AAPL', bar(90, 93, 89, 92));
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 90);
  assert.ok(/gapped/.test(o.reason));
});

test('sell limit fills when bar high reaches it; untouched bars leave it open', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'limit', limitPrice: 110 }, 100);
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(100, 109.99, 98, 105));
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(106, 110, 104, 108));
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 110);
  assert.strictEqual(s.positions.AAPL, undefined);
  near(s.realized, 100);
});

test('marketable limit fills immediately at the current price when one is supplied', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 105 }, 100);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 100);
});

test('processOrders only touches orders for the given symbol and ignores malformed bars', () => {
  fresh();
  const a = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 95 }, 100);
  const m = P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 1, type: 'limit', limitPrice: 95 }, 100);
  P.processOrders('AAPL', bar(90, 91, 89, 90));
  assert.strictEqual(a.status, 'filled');
  assert.strictEqual(m.status, 'open');
  assert.deepStrictEqual(P.processOrders('MSFT', null), []);
  assert.deepStrictEqual(P.processOrders('MSFT', { time: 'x' }), []);
  assert.strictEqual(m.status, 'open');
});

/* ---------------- stop orders --------------------------------------- */
test('sell stop below a long fills when bar low touches it, at the stop price', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop', stopPrice: 95 }, 100);
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(100, 103, 95.01, 101));
  assert.strictEqual(o.status, 'open', 'low 95.01 does not touch 95');
  P.processOrders('AAPL', bar(99, 100, 95, 96));
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 95);
  near(s.realized, -50);
});

test('sell stop that gaps down fills at the worse open price', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop', stopPrice: 95 }, 100);
  P.processOrders('AAPL', bar(88, 90, 85, 86));
  assert.strictEqual(o.fillPrice, 88);
  assert.ok(/gapped through/.test(o.reason));
});

test('buy stop above market triggers on bar high (breakout entry); gap up fills at open', () => {
  const s = fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'stop', stopPrice: 105 }, 100);
  P.processOrders('AAPL', bar(100, 104.99, 99, 104));
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(103, 106, 102, 105.5));
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 105);
  assert.strictEqual(s.positions.AAPL.qty, 10);
  const o2 = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'stop', stopPrice: 110 }, 105);
  P.processOrders('AAPL', bar(112, 113, 111, 112));
  assert.strictEqual(o2.fillPrice, 112);
});

test('stop placed on the wrong side of the market is rejected, not filled (like a real broker)', () => {
  const s = fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'stop', stopPrice: 95 }, 100);
  assert.strictEqual(o.status, 'rejected');
  assert.ok(/buy stop above/.test(o.reason), o.reason);
  assert.strictEqual(s.positions.AAPL, undefined);
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const sl = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop', stopPrice: 105 }, 100);
  assert.strictEqual(sl.status, 'rejected');
  assert.strictEqual(s.positions.AAPL.qty, 10, 'position untouched');
  const sl2 = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop_limit', stopPrice: 100, limitPrice: 99 }, 100);
  assert.strictEqual(sl2.status, 'rejected');
});

test('buying stock cannot leave existing shorts under-margined; marginCall flags a breach after prices move', () => {
  const s = fresh(100000);
  assert.strictEqual(P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 100, type: 'market' }, 100).status, 'filled'); // cash 110k, needs 15k
  const o = P.placeOrder({ symbol: 'ABC', side: 'buy', qty: 1090, type: 'market' }, 100);
  assert.strictEqual(o.status, 'rejected'); assert.ok(/under-margined/.test(o.reason), o.reason);
  assert.strictEqual(P.placeOrder({ symbol: 'ABC', side: 'buy', qty: 950, type: 'market' }, 100).status, 'filled');
  assert.strictEqual(s.cash, 15000);
  assert.strictEqual(P.markToMarket({ XYZ: 100, ABC: 100 }).marginCall, false);
  assert.strictEqual(P.markToMarket({ XYZ: 110, ABC: 100 }).marginCall, true);
  assert.strictEqual(P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 100, type: 'market' }, 110).status, 'filled', 'covering is always allowed');
});

test('writing an option with no existing position counts the premium x100 in the margin check', () => {
  fresh(4100);
  const o = P.placeOptionOrder({ contract: 'AAPL260117C00200000', side: 'sell', qty: 1 }, 2.50);
  assert.strictEqual(o.status, 'rejected', o.reason); // needs 1.5*250 + 4000 = 4375 > 4350
  assert.ok(/4,375\.00/.test(o.reason), o.reason);
  fresh(4200);
  assert.strictEqual(P.placeOptionOrder({ contract: 'AAPL260117C00200000', side: 'sell', qty: 1 }, 2.50).status, 'filled');
});

test('marketable buy limit is pre-checked at the price it actually fills at', () => {
  const s = fresh(10000);
  const o = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 100, type: 'limit', limitPrice: 150 }, 90);
  assert.strictEqual(o.status, 'filled'); assert.strictEqual(o.fillPrice, 90); assert.strictEqual(s.cash, 1000);
  const o2 = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 100, type: 'limit', limitPrice: 150 }, 95);
  assert.strictEqual(o2.status, 'rejected'); assert.ok(/Not enough cash/.test(o2.reason));
});

test('fill times are always milliseconds; the raw bar time is kept in barTime', () => {
  fresh(); fakeNow = 1794412779128;
  P.placeOrder({ symbol: 'A', side: 'buy', qty: 1, type: 'market' }, 10);
  P.placeOrder({ symbol: 'A', side: 'buy', qty: 1, type: 'limit', limitPrice: 9 }, 10);
  P.processOrders('A', { time: 1794412779, open: 9, high: 9, low: 8, close: 9 });           // unix seconds
  P.placeOrder({ symbol: 'A', side: 'buy', qty: 1, type: 'limit', limitPrice: 8 }, 10);
  P.processOrders('A', { time: '2026-11-11', open: 8, high: 9, low: 7, close: 8 });          // daily string
  const t = P.getState().trades;
  assert.deepStrictEqual(t.map(x => x.time), [1794412779128, 1794412779000, Date.parse('2026-11-11T21:00:00Z')]);
  assert.strictEqual(t[1].barTime, 1794412779); assert.strictEqual(t[2].barTime, '2026-11-11');
  const o = P.getState().orders; assert.strictEqual(o[1].filledAt, 1794412779000); assert.strictEqual(o[2].filledBarTime, '2026-11-11');
  fakeNow = Date.UTC(2024, 2, 1, 15, 0, 0);
});

test('load() drops corrupted orders / dayStart / marks instead of letting them poison cash', () => {
  localStorage.clear();
  localStorage.setItem('bt.portfolio', JSON.stringify({ cash: 1000, startingCash: 1000, nextId: 100, orders: [
    { id: 99, status: 'open', symbol: 'A', side: 'sell', type: 'limit', limitPrice: 5 },           // no qty
    { id: 98, status: 'open', symbol: 'A', side: 'sell', qty: '5', type: 'limit', limitPrice: 5 },  // string qty
    { id: 97, status: 'open', symbol: 'A', side: 'sell', qty: 5, type: 'limit' },                   // no limit price
    { id: 96, status: 'open', symbol: 'A', side: 'buy', qty: 5, type: 'limit', limitPrice: 5 },     // fine
    { id: 95, status: 'filled', symbol: 'A', side: 'buy', qty: 5, type: 'market' }],
    dayStart: { day: '2024-03-01', equity: 'abc' }, marks: { A: 'x', B: 3 } }));
  const s = P.load();
  assert.deepStrictEqual(s.orders.map(o => o.id + ':' + o.status), ['97:rejected', '96:open', '95:filled']);
  assert.strictEqual(s.dayStart, null); assert.deepStrictEqual(s.marks, { B: 3 });
  const fills = P.processOrders('A', { time: '2024-03-01', open: 5, high: 6, low: 4, close: 5 });
  assert.strictEqual(fills.length, 1); assert.strictEqual(s.cash, 975);
  assert.ok(Number.isFinite(P.markToMarket({ A: 5 }).dayPnL));
});

test('stats: Sharpe is null for a single day of minute-by-minute marks (no per-minute annualising)', () => {
  fresh(); P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 100, type: 'market' }, 100);
  const t0 = fakeNow;
  for (let i = 0; i < 30; i++) { fakeNow += 60000; P.markToMarket({ XYZ: 100 + i * 0.01 }); }
  assert.strictEqual(P.stats().sharpe, null);
  fakeNow = t0;
});

/* ---------------- stop-limit ---------------------------------------- */
test('sell stop-limit: triggers, fills at stop when the limit is still reachable', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop_limit', stopPrice: 95, limitPrice: 94 }, 100);
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(98, 99, 94.5, 95));
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 95);
});

test('sell stop-limit: gap through the limit triggers but does NOT fill; fills later as a limit', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop_limit', stopPrice: 95, limitPrice: 94 }, 100);
  const fills = P.processOrders('AAPL', bar(90, 91, 88, 89)); // gaps below both stop and limit
  assert.deepStrictEqual(fills, []);
  assert.strictEqual(o.status, 'open');
  assert.strictEqual(o.triggered, true);
  assert.ok(/moved past your limit/.test(o.reason), o.reason);
  assert.strictEqual(s.positions.AAPL.qty, 10, 'still holding — the risk of a stop-limit');
  P.processOrders('AAPL', bar(92, 93, 91, 92)); // still below limit
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(93, 94.5, 92.5, 94)); // high reaches limit 94
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 94);
});

test('buy stop-limit fills at the limit when the bar trades through stop then up to the limit', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'stop_limit', stopPrice: 105, limitPrice: 106 }, 100);
  P.processOrders('AAPL', bar(107, 109, 106, 108)); // opens above limit; low reaches limit
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, 106);
});

/* ---------------- time in force & cancel ---------------------------- */
test('day orders expire when a later day arrives unfilled; GTC orders keep working', () => {
  fresh();
  const day = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 90, tif: 'day' }, 100);
  const gtc = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 90, tif: 'gtc' }, 100);
  P.processOrders('AAPL', bar(100, 101, 99, 100, '2024-03-01'));
  P.processOrders('AAPL', bar(100, 101, 99, 100, '2024-03-01'));
  assert.strictEqual(day.status, 'open');
  P.processOrders('AAPL', bar(100, 101, 99, 100, '2024-03-04'));
  assert.strictEqual(day.status, 'expired');
  assert.ok(/expired/.test(day.reason));
  assert.strictEqual(gtc.status, 'open');
  const fills = P.processOrders('AAPL', bar(91, 92, 89, 90, '2024-03-05'));
  assert.strictEqual(fills.length, 1);
  assert.strictEqual(gtc.status, 'filled');
});

test('day orders with intraday unix times use the UTC date', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 90, tif: 'day' }, 100);
  const t0 = Date.UTC(2024, 2, 1, 14, 30) / 1000;
  P.processOrders('AAPL', bar(100, 101, 99, 100, t0));
  P.processOrders('AAPL', bar(100, 101, 99, 100, t0 + 3600));
  assert.strictEqual(o.status, 'open');
  P.processOrders('AAPL', bar(100, 101, 99, 100, t0 + 86400));
  assert.strictEqual(o.status, 'expired');
});

test('cancelOrder cancels an open order and refuses filled/unknown ones', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'limit', limitPrice: 90 }, 100);
  const c = P.cancelOrder(o.id);
  assert.strictEqual(c.status, 'cancelled');
  assert.strictEqual(P.openOrders('AAPL').length, 0);
  assert.strictEqual(P.cancelOrder(o.id), null);
  assert.strictEqual(P.cancelOrder(99999), null);
  const f = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 100);
  assert.strictEqual(P.cancelOrder(f.id), null);
});

test('working orders that could never be afforded are rejected up front', () => {
  fresh(1000);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 100, type: 'limit', limitPrice: 90 }, 100);
  assert.strictEqual(o.status, 'rejected');
  assert.ok(/Not enough cash/.test(o.reason));
});

/* ---------------- shorts & margin ----------------------------------- */
test('selling more than held opens a short (negative qty); cash increases by proceeds', () => {
  const s = fresh();
  const o = P.placeOrder({ symbol: 'GME', side: 'sell', qty: 100, type: 'market' }, 50);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(s.positions.GME.qty, -100);
  assert.strictEqual(s.positions.GME.avg, 50);
  near(s.cash, 105000);
});

test('short margin: cash after the sale must cover 150% of total short value', () => {
  const s = fresh(10000);
  // 400 × $50 = $20,000 short → cash 30,000 vs required 30,000: allowed (exactly at the limit)
  const ok = P.placeOrder({ symbol: 'GME', side: 'sell', qty: 400, type: 'market' }, 50);
  assert.strictEqual(ok.status, 'filled', ok.reason);
  near(s.cash, 30000);
  // one more share: cash 30,050 vs required 1.5 × 20,050 = 30,075 → rejected
  const bad = P.placeOrder({ symbol: 'GME', side: 'sell', qty: 1, type: 'market' }, 50);
  assert.strictEqual(bad.status, 'rejected');
  assert.ok(/150 %/.test(bad.reason) && /margin/.test(bad.reason), bad.reason);
  assert.strictEqual(s.positions.GME.qty, -400);
  near(s.cash, 30000);
});

test('short margin considers shorts in other symbols too', () => {
  fresh(10000);
  assert.strictEqual(P.placeOrder({ symbol: 'A', side: 'sell', qty: 200, type: 'market' }, 50).status, 'filled'); // 10k short, cash 20k
  // another 10k short: cash 30k vs 1.5×20k = 30k ok
  assert.strictEqual(P.placeOrder({ symbol: 'B', side: 'sell', qty: 100, type: 'market' }, 100).status, 'filled');
  // any more is over the line
  assert.strictEqual(P.placeOrder({ symbol: 'C', side: 'sell', qty: 1, type: 'market' }, 100).status, 'rejected');
});

test('covering a short realizes (avg − price) × qty and averages correctly when adding to a short', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'GME', side: 'sell', qty: 100, type: 'market' }, 50);
  P.placeOrder({ symbol: 'GME', side: 'sell', qty: 100, type: 'market' }, 40);
  near(s.positions.GME.avg, 45);
  assert.strictEqual(s.positions.GME.qty, -200);
  const cover = P.placeOrder({ symbol: 'GME', side: 'buy', qty: 150, type: 'market' }, 30);
  assert.strictEqual(cover.status, 'filled');
  near(s.trades[s.trades.length - 1].realized, (45 - 30) * 150);
  assert.strictEqual(s.positions.GME.qty, -50);
  near(s.positions.GME.avg, 45);
  const loser = P.placeOrder({ symbol: 'GME', side: 'buy', qty: 50, type: 'market' }, 60);
  near(s.trades[s.trades.length - 1].realized, (45 - 60) * 50);
  assert.strictEqual(s.positions.GME, undefined);
  near(s.realized, 2250 - 750);
  near(s.cash, 100000 + 2250 - 750);
});

test('reversal: selling more than a long flips to short at the fill price', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 25, type: 'market' }, 110);
  assert.strictEqual(s.positions.AAPL.qty, -15);
  assert.strictEqual(s.positions.AAPL.avg, 110);
  const t = s.trades[s.trades.length - 1];
  assert.strictEqual(t.closedQty, 10);
  assert.strictEqual(t.openedQty, 15);
  near(t.realized, 100);
});

test('closePosition covers a short / sells a long with a market order; nothing to close is rejected', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'GME', side: 'sell', qty: 100, type: 'market' }, 50);
  const o = P.closePosition('GME', 45);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.side, 'buy');
  assert.strictEqual(s.positions.GME, undefined);
  near(s.realized, 500);
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 3, type: 'market' }, 10);
  assert.strictEqual(P.closePosition('AAPL', 12).side, 'sell');
  near(s.realized, 506);
  const none = P.closePosition('AAPL', 12);
  assert.strictEqual(none.status, 'rejected');
  assert.ok(/no open position/.test(none.reason));
  assert.strictEqual(P.closePosition('GME').status, 'rejected');
});

/* ---------------- options ------------------------------------------- */
test('parseContract decodes OCC ids', () => {
  assert.deepStrictEqual(P.parseContract('AAPL260117C00200000'), {
    contract: 'AAPL260117C00200000', underlying: 'AAPL', expiry: '2026-01-17', right: 'C', strike: 200, multiplier: 100
  });
  assert.strictEqual(P.parseContract('SPY261218P00450500').strike, 450.5);
  assert.strictEqual(P.parseContract('nope'), null);
  assert.strictEqual(P.parseContract('AAPL261345C00200000'), null);
});

test('buying a call costs premium × 100 × qty and stores option meta', () => {
  const s = fresh();
  const o = P.placeOptionOrder({ contract: 'AAPL260117C00200000', side: 'buy', qty: 2 }, 5.25);
  assert.strictEqual(o.status, 'filled', o.reason);
  near(s.cash, 100000 - 5.25 * 100 * 2);
  const p = s.positions.AAPL260117C00200000;
  assert.strictEqual(p.qty, 2);
  assert.strictEqual(p.kind, 'option');
  assert.deepStrictEqual(p.meta, { underlying: 'AAPL', strike: 200, expiry: '2026-01-17', right: 'C', multiplier: 100 });
  assert.ok(/Bought to open/.test(o.reason));
});

test('option P&L uses the multiplier: sell 2 calls bought at 5.25 for 7.00 → +350', () => {
  const s = fresh();
  P.placeOptionOrder({ contract: 'AAPL260117C00200000', side: 'buy', qty: 2 }, 5.25);
  const o = P.placeOptionOrder({ contract: 'AAPL260117C00200000', side: 'sell', qty: 2 }, 7);
  assert.ok(/Sold to close/.test(o.reason));
  near(s.realized, 350);
  assert.strictEqual(s.positions.AAPL260117C00200000, undefined);
  near(s.cash, 100350);
});

test('writing options needs margin; rejected when cash is too thin, and bad contract ids are rejected', () => {
  const s = fresh(1000);
  const bad = P.placeOptionOrder({ contract: 'SPY261218P00450000', side: 'sell', qty: 10 }, 3);
  assert.strictEqual(bad.status, 'rejected');
  assert.ok(/writing/.test(bad.reason), bad.reason);
  assert.strictEqual(s.cash, 1000);
  const junk = P.placeOptionOrder({ contract: 'HELLO', side: 'buy', qty: 1 }, 1);
  assert.strictEqual(junk.status, 'rejected');
  assert.ok(/OCC format/.test(junk.reason));
  const noPrem = P.placeOptionOrder({ contract: 'SPY261218P00450000', side: 'buy', qty: 1 });
  assert.strictEqual(noPrem.status, 'rejected');
  assert.ok(/premium/.test(noPrem.reason));
  const expired = P.placeOptionOrder({ contract: 'SPY200117P00300000', side: 'buy', qty: 1 }, 1);
  assert.strictEqual(expired.status, 'rejected');
  assert.ok(/expired/.test(expired.reason));
});

test('writing a put with enough cash credits the premium and creates a short option position', () => {
  const s = fresh();
  const o = P.placeOptionOrder({ contract: 'SPY261218P00450000', side: 'sell', qty: 1 }, 3);
  assert.strictEqual(o.status, 'filled', o.reason);
  assert.ok(/wrote/.test(o.reason));
  assert.strictEqual(s.positions.SPY261218P00450000.qty, -1);
  near(s.cash, 100300);
  const mtm = P.markToMarket({ SPY261218P00450000: 2 });
  near(mtm.marketValue, -200);
  near(mtm.unrealized, 100);
  near(mtm.equity, 100100);
  P.placeOptionOrder({ contract: 'SPY261218P00450000', side: 'buy', qty: 1 }, 2);
  near(s.realized, 100);
});

test('closePosition works for an option contract', () => {
  const s = fresh();
  P.placeOptionOrder({ contract: 'AAPL260117C00200000', side: 'buy', qty: 1 }, 4);
  P.closePosition('AAPL260117C00200000', 4.5);
  near(s.realized, 50);
  near(s.cash, 100050);
});

/* ---------------- mark to market & equity history ------------------- */
test('markToMarket computes equity, market value, unrealized/realized and appends equity history', () => {
  const s = fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  P.placeOrder({ symbol: 'GME', side: 'sell', qty: 20, type: 'market' }, 50);
  const m = P.markToMarket({ AAPL: 110, GME: 45 });
  near(m.cash, 100000 - 1000 + 1000);
  near(m.marketValue, 1100 - 900);
  near(m.unrealized, 100 + 100);
  near(m.realized, 0);
  near(m.equity, 100200);
  near(m.totalPnL, 200);
  near(m.totalPnLPct, 0.2);
  near(m.longValue, 1100); near(m.shortValue, 900);
  assert.strictEqual(s.equityHistory.length, 1);
  assert.strictEqual(s.equityHistory[0].equity, 100200);
  assert.strictEqual(s.equityHistory[0].t, fakeNow);
  assert.strictEqual(m.positions.length, 2);
});

test('missing prices fall back to the last known mark, then to average cost', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  P.processOrders('AAPL', bar(100, 105, 99, 104)); // sets mark to close 104
  near(P.markToMarket({}).marketValue, 1040);
  P.placeOrder({ symbol: 'ZZZ', side: 'buy', qty: 1, type: 'market' }, 10);
  near(P.markToMarket({}).marketValue, 1050);
});

test('equity history dedupes per minute and day P&L measures from the start of the day', () => {
  const s = fresh();
  const base = Date.UTC(2024, 2, 1, 15, 0, 0);
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  P.markToMarket({ AAPL: 100 }, base);
  P.markToMarket({ AAPL: 101 }, base + 20000);           // same minute → replaces
  assert.strictEqual(s.equityHistory.length, 1);
  near(s.equityHistory[0].equity, 100010);
  P.markToMarket({ AAPL: 102 }, base + 61000);           // next minute → appends
  assert.strictEqual(s.equityHistory.length, 2);
  const nextDay = P.markToMarket({ AAPL: 105 }, base + 86400000);
  assert.strictEqual(s.equityHistory.length, 3);
  near(nextDay.dayPnL, 100050 - 100020, 1e-6, 'day P&L vs yesterday\'s last equity');
  const later = P.markToMarket({ AAPL: 103 }, base + 86400000 + 120000);
  near(later.dayPnL, 100030 - 100020);
});

/* ---------------- stats ---------------------------------------------- */
test('stats: win rate, avg win/loss, profit factor and expectancy from closing trades only', () => {
  fresh();
  P.placeOrder({ symbol: 'A', side: 'buy', qty: 10, type: 'market' }, 100);
  P.placeOrder({ symbol: 'A', side: 'sell', qty: 10, type: 'market' }, 110); // +100
  P.placeOrder({ symbol: 'B', side: 'buy', qty: 10, type: 'market' }, 100);
  P.placeOrder({ symbol: 'B', side: 'sell', qty: 10, type: 'market' }, 95);  // -50
  P.placeOrder({ symbol: 'C', side: 'buy', qty: 10, type: 'market' }, 100);
  P.placeOrder({ symbol: 'C', side: 'sell', qty: 10, type: 'market' }, 130); // +300
  P.placeOrder({ symbol: 'D', side: 'buy', qty: 1, type: 'market' }, 100);   // still open, not counted
  const st = P.stats();
  assert.strictEqual(st.trades, 3);
  assert.strictEqual(st.fills, 7);
  near(st.winRate, 200 / 3);
  near(st.avgWin, 200);
  near(st.avgLoss, -50);
  near(st.profitFactor, 400 / 50);
  near(st.expectancy, 116.67, 0.005);
  near(st.realized, 350);
  near(st.bestTrade, 300); near(st.worstTrade, -50);
  // no equity history yet → total return from live valuation (D marked at avg)
  near(st.totalReturnPct, 0.35);
});

test('stats on an empty account are nulls/zeros, not NaN', () => {
  fresh();
  const st = P.stats();
  assert.strictEqual(st.trades, 0);
  assert.strictEqual(st.winRate, null);
  assert.strictEqual(st.avgWin, null);
  assert.strictEqual(st.avgLoss, null);
  assert.strictEqual(st.profitFactor, null);
  assert.strictEqual(st.sharpe, null);
  assert.strictEqual(st.maxDrawdownPct, 0);
  assert.strictEqual(st.totalReturnPct, 0);
});

test('stats: max drawdown is the largest peak-to-trough fall of equity (starting cash counts as the first point)', () => {
  const s = fresh();
  const day = 86400000, base = Date.UTC(2024, 0, 1);
  [100000, 120000, 90000, 110000, 99000].forEach((eq, i) => s.equityHistory.push({ t: base + i * day, equity: eq }));
  const st = P.stats();
  near(st.maxDrawdownPct, 25); // 120k → 90k
  near(st.maxDrawdown, 30000);
  near(st.totalReturnPct, -1);
});

test('stats: Sharpe is mean/stdev of equity returns × sqrt(252)', () => {
  const s = fresh();
  const day = 86400000, base = Date.UTC(2024, 0, 1);
  const eq = [100000, 101000, 100500, 102000, 103000];
  eq.forEach((e, i) => s.equityHistory.push({ t: base + i * day, equity: e }));
  const rets = [];
  for (let i = 1; i < eq.length; i++) rets.push(eq[i] / eq[i - 1] - 1);
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - m) * (r - m), 0) / (rets.length - 1));
  near(P.stats().sharpe, m / sd * Math.sqrt(252), 1e-5);
  // flat equity → no volatility → null, not Infinity
  s.equityHistory.length = 0;
  [1, 2, 3].forEach(i => s.equityHistory.push({ t: base + i * day, equity: 100000 }));
  assert.strictEqual(P.stats().sharpe, null);
});

/* ---------------- reset & persistence ------------------------------- */
test('reset restores a clean account with the requested cash and keeps the commission setting', () => {
  const s0 = fresh();
  P.setSettings({ commission: 2 });
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 100);
  P.markToMarket({ AAPL: 100 });
  const s = P.reset(25000);
  assert.strictEqual(s.cash, 25000);
  assert.strictEqual(s.startingCash, 25000);
  assert.deepStrictEqual(s.positions, {});
  assert.strictEqual(s.orders.length, 0);
  assert.strictEqual(s.trades.length, 0);
  assert.strictEqual(s.equityHistory.length, 0);
  assert.strictEqual(s.realized, 0);
  assert.strictEqual(s.settings.commission, 2);
  assert.notStrictEqual(s, s0);
  assert.strictEqual(P.reset().cash, 100000);
  assert.strictEqual(P.reset(-5).cash, 100000, 'invalid starting cash falls back to default');
  P.setSettings({ commission: 0 });
});

test('state is persisted to localStorage key bt.portfolio and restored by load()', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 7, type: 'market' }, 100);
  const open = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 7, type: 'limit', limitPrice: 120 }, 100);
  P.markToMarket({ AAPL: 101 });
  const raw = localStorage.getItem('bt.portfolio');
  assert.ok(raw, 'saved');
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.positions.AAPL.qty, 7);
  assert.strictEqual(parsed.cash, 99300);
  // wipe the in-memory state, then load from storage
  P.reset(1);
  localStorage.setItem('bt.portfolio', raw);
  const s = P.load();
  assert.strictEqual(s.cash, 99300);
  assert.strictEqual(s.positions.AAPL.qty, 7);
  assert.strictEqual(s.equityHistory.length, 1);
  assert.strictEqual(P.openOrders('AAPL').length, 1);
  assert.strictEqual(P.openOrders('AAPL')[0].id, open.id);
  // ids keep incrementing after a reload (no collisions)
  const next = P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 1, type: 'market' }, 10);
  assert.ok(next.id > open.id);
  // and the reloaded open order still fills
  P.processOrders('AAPL', bar(119, 121, 118, 120));
  assert.strictEqual(P.getState().positions.AAPL, undefined);
});

test('load() tolerates corrupt or partial storage', () => {
  localStorage.setItem('bt.portfolio', '{not json');
  let s = P.load();
  assert.strictEqual(s.cash, 100000);
  localStorage.setItem('bt.portfolio', JSON.stringify({ cash: 500, startingCash: 1000, positions: { X: { qty: 0, avg: 1 }, Y: { qty: 2, avg: 3 } }, orders: 'nope' }));
  s = P.load();
  assert.strictEqual(s.cash, 500);
  assert.strictEqual(s.startingCash, 1000);
  assert.strictEqual(s.positions.X, undefined, 'zero-qty positions are dropped');
  assert.deepStrictEqual(s.positions.Y, { qty: 2, avg: 3, kind: 'stock', meta: {} });
  assert.deepStrictEqual(s.orders, []);
  assert.strictEqual(s.settings.commission, 0);
  fresh();
});

test('describeOrder and glossary give human-readable copy', () => {
  fresh();
  const o = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 5, type: 'stop', stopPrice: 95 }, 100);
  assert.strictEqual(P.describeOrder(o), 'Sell 5 AAPL if price falls to $95.00 (becomes a market order).');
  assert.strictEqual(o.reason, P.describeOrder(o));
  ['market', 'limit', 'stop', 'stop_limit', 'short', 'options', 'sharpe', 'drawdown'].forEach(k => assert.ok(P.glossary[k].length > 40, k));
  assert.strictEqual(P.money(-1234.5), '-$1,234.50');
});

/* ---------------- multiple accounts (v0.3) -------------------------- */
test('use() switches accounts: main keeps bt.portfolio, others use bt.portfolio.<id>', () => {
  fresh();
  assert.strictEqual(typeof P.use, 'function');
  assert.strictEqual(typeof P.accounts, 'function');
  assert.strictEqual(P.account(), 'main');
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  const replay = P.use('replay');
  assert.strictEqual(P.account(), 'replay');
  assert.strictEqual(replay.cash, 100000, 'a never-used account starts fresh');
  assert.deepStrictEqual(replay.positions, {});
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 5, type: 'market' }, 200);
  assert.ok(localStorage.getItem('bt.portfolio.replay'), 'replay account persisted under its own key');
  const mainSaved = JSON.parse(localStorage.getItem('bt.portfolio'));
  assert.strictEqual(mainSaved.positions.AAPL.qty, 10, 'main account untouched on disk');
  assert.strictEqual(mainSaved.positions.MSFT, undefined);
  const back = P.use('main');
  assert.strictEqual(back.positions.AAPL.qty, 10);
  assert.strictEqual(back.positions.MSFT, undefined);
  assert.strictEqual(back.cash, 100000 - 1000);
  P.use('replay');
  assert.strictEqual(P.getState().positions.MSFT.qty, 5, 'switching back restores the replay state');
  P.use('main');
});

test('use() does not clobber fills another tab persisted on the outgoing account', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  assert.strictEqual(P.getState().cash, 99000);
  // "Another tab" trades on main: storage moves on while this page's memory is stale.
  const other = JSON.parse(localStorage.getItem('bt.portfolio'));
  other.cash = 1; other.positions.TSLA = { qty: 3, avg: 200, last: 200 };
  localStorage.setItem('bt.portfolio', JSON.stringify(other));
  P.use('replay');
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.portfolio')).cash, 1, 'switching away must not write the stale snapshot');
  const back = P.use('main');
  assert.strictEqual(back.cash, 1, 'switching back reads what the other tab stored');
  assert.strictEqual(back.positions.TSLA.qty, 3);
});

test('use() still persists a never-stored outgoing account so other tabs can list it', () => {
  fresh();
  localStorage.removeItem('bt.portfolio');
  P.load();                                   // fresh in-memory main, nothing on disk
  assert.strictEqual(localStorage.getItem('bt.portfolio'), null);
  P.use('scratch');
  assert.ok(localStorage.getItem('bt.portfolio'), 'empty key gets the fresh state written once');
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.portfolio')).cash, 100000);
  P.use('main');
});

test('use() with the active id is a no-op; ids are normalised; reset() only resets the active account', () => {
  fresh();
  const s1 = P.use('main');
  assert.strictEqual(s1, P.getState());
  P.use(' Replay ');
  assert.strictEqual(P.account(), 'replay');
  P.placeOrder({ symbol: 'TSLA', side: 'buy', qty: 1, type: 'market' }, 50);
  P.reset(5000);
  assert.strictEqual(P.getState().cash, 5000);
  assert.strictEqual(P.getState().startingCash, 5000);
  P.use('main');
  assert.strictEqual(P.getState().cash, 100000, 'main was not reset');
  assert.strictEqual(P.storageKeyFor('main'), 'bt.portfolio');
  assert.strictEqual(P.storageKeyFor('replay'), 'bt.portfolio.replay');
});

test('accounts() lists every account with equity at last marks, main first, active flagged', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  P.markToMarket({ AAPL: 120 });
  P.use('replay');
  P.reset(50000);
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 10, type: 'market' }, 100);
  P.processOrders('MSFT', bar(100, 110, 95, 90));      // marks MSFT at the close
  const list = P.accounts();
  assert.strictEqual(list[0].id, 'main');
  const main = list.find(a => a.id === 'main'), rep = list.find(a => a.id === 'replay');
  assert.ok(main && rep, 'both accounts listed: ' + JSON.stringify(list.map(a => a.id)));
  near(main.equity, 100000 - 1000 + 10 * 120);           // 100,200 valued at the $120 mark
  assert.strictEqual(main.active, false);
  near(rep.equity, 50000 - 1000 + 10 * 90);               // 49,900
  assert.strictEqual(rep.active, true);
  assert.strictEqual(rep.startingCash, 50000);
  assert.strictEqual(rep.positions, 1);
  assert.strictEqual(rep.storageKey, 'bt.portfolio.replay');
  // the listing never changes the active account or its state
  assert.strictEqual(P.account(), 'replay');
  assert.strictEqual(P.getState().positions.MSFT.qty, 10);
  P.use('main');
  assert.strictEqual(P.getState().positions.AAPL.qty, 10);
});

test('deleteAccount() removes a non-main account and refuses to delete main', () => {
  fresh();
  P.use('scratch');
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 10);
  assert.ok(localStorage.getItem('bt.portfolio.scratch'));
  assert.strictEqual(P.deleteAccount('main'), false);
  assert.strictEqual(P.deleteAccount('scratch'), true);
  assert.strictEqual(P.account(), 'main', 'deleting the active account falls back to main');
  assert.strictEqual(localStorage.getItem('bt.portfolio.scratch'), null);
  assert.ok(!P.accounts().some(a => a.id === 'scratch'));
});

/* ================================================================== *
 * v0.5 realism — every switch off by default
 * ================================================================== */
const T0 = Date.UTC(2024, 2, 1, 15, 0, 0);   // Friday 1 March 2024, 10 am New York
const DAY = 86400000;
function real(settings, cash) {
  fakeNow = T0;
  fresh(cash);
  P.setSettings(Object.assign(P.defaultSettings(), settings || {}));
  return P.getState();
}
function vbar(o, h, l, c, volume, time) { const b = { time: time || '2024-03-01', open: o, high: h, low: l, close: c }; if (volume !== undefined) b.volume = volume; return b; }

test('realism defaults are all off and reproduce the v0.4 engine', () => {
  const s = real();
  const d = P.defaultSettings();
  assert.strictEqual(d.fillModel, 'instant');
  assert.strictEqual(d.slippageBps, 0);
  assert.strictEqual(d.commissionPreset, 'per-trade');
  assert.strictEqual(d.commission, 0);
  assert.strictEqual(d.dividends, false);
  assert.strictEqual(d.cashInterestPct, 0);
  assert.strictEqual(d.borrowFeePct, 0);
  assert.strictEqual(d.pdtRule, false);
  assert.strictEqual(d.maxVolumePct, 10);
  const o = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 5000, type: 'market' }, 10, { volume: 100 });
  assert.strictEqual(o.status, 'filled', 'instant model ignores volume');
  assert.strictEqual(o.fillPrice, 10);
  assert.strictEqual(s.cash, 50000);
  assert.strictEqual(s.trades[0].slippage, 0);
  assert.strictEqual(s.trades[0].commission, 0);
  P.markToMarket({ AAPL: 10 }, T0 + 30 * DAY);
  assert.strictEqual(s.cash, 50000, 'no interest or fees when off');
  assert.deepStrictEqual(P.cashflows(), []);
});

test('volume fill model: at most 10% of bar volume per bar, remainder stays open and fills across bars', () => {
  const s = real({ fillModel: 'volume' });
  const o = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 250, type: 'market' }, 100, { volume: 1000 });
  assert.strictEqual(o.status, 'open');
  assert.strictEqual(o.partial, true);
  assert.strictEqual(o.filledQty, 100);
  assert.ok(/Partially filled 100 of 250/.test(o.reason), o.reason);
  assert.strictEqual(s.positions.XYZ.qty, 100);
  assert.strictEqual(P.openOrders('XYZ').length, 1);
  let f = P.processOrders('XYZ', vbar(101, 102, 100, 101, 1000, '2024-03-04'));
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].trade.qty, 100);
  assert.strictEqual(f[0].trade.price, 101, 'remainder of a market order fills at the next open');
  assert.strictEqual(o.filledQty, 200);
  assert.strictEqual(o.status, 'open');
  f = P.processOrders('XYZ', vbar(102, 103, 101, 102, 1000, '2024-03-05'));
  assert.strictEqual(f[0].trade.qty, 50);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.partial, false);
  assert.strictEqual(o.filledQty, 250);
  assert.strictEqual(o.fills.length, 3);
  near(o.fillPrice, (100 * 100 + 100 * 101 + 50 * 102) / 250);
  assert.strictEqual(s.positions.XYZ.qty, 250);
  near(s.positions.XYZ.avg, o.fillPrice);
  near(s.cash, 100000 - (10000 + 10100 + 5100), 0.001);
  assert.strictEqual(P.openOrders('XYZ').length, 0);
});

test('volume fill model: orders on one symbol share the bar; unknown volume fills in full', () => {
  real({ fillModel: 'volume' });
  const a = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 80, type: 'limit', limitPrice: 99 }, 100);
  const b = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 80, type: 'limit', limitPrice: 99 }, 100);
  P.processOrders('XYZ', vbar(99.5, 100, 98, 99, 1000, '2024-03-04'));     // cap 100 shares this bar
  assert.strictEqual(a.filledQty, 80);
  assert.strictEqual(a.status, 'filled');
  assert.strictEqual(b.filledQty, 20);
  assert.strictEqual(b.status, 'open');
  assert.strictEqual(b.limitPrice, 99, 'the remainder is still a limit order');
  P.processOrders('XYZ', vbar(100, 101, 99.5, 100.5, 1000, '2024-03-05'));  // never reaches 99
  assert.strictEqual(b.filledQty, 20);
  P.processOrders('XYZ', vbar(99, 99.5, 98, 99, undefined, '2024-03-06'));   // no volume on the bar → no cap
  assert.strictEqual(b.status, 'filled');
  assert.strictEqual(b.filledQty, 80);
  const c = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 5, type: 'market' }, 100, { volume: 5 }); // 10% of 5 = 0
  assert.strictEqual(c.status, 'open');
  assert.strictEqual(c.filledQty, 0);
  assert.ok(/Waiting for volume/.test(c.reason), c.reason);
});

test('volume fill model: a triggered stop keeps filling at market; day orders expire with a partial note; cancel keeps the fills', () => {
  const s = real({ fillModel: 'volume' });
  P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 300, type: 'market' }, 50);          // instant: no volume given
  const stop = P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 300, type: 'stop', stopPrice: 45 }, 50);
  P.processOrders('XYZ', vbar(46, 46, 44, 45, 1000, '2024-03-04'));                    // triggers, 100 shares
  assert.strictEqual(stop.filledQty, 100);
  assert.strictEqual(stop.triggered, true);
  P.processOrders('XYZ', vbar(47, 48, 46.5, 47.5, 1000, '2024-03-05'));                // above the stop again
  assert.strictEqual(stop.filledQty, 200, 'triggered stop is a market order now');
  assert.strictEqual(s.trades[s.trades.length - 1].price, 47);
  P.cancelOrder(stop.id);
  assert.strictEqual(stop.status, 'cancelled');
  assert.ok(/200 of 300 filled/.test(stop.reason), stop.reason);
  assert.strictEqual(s.positions.XYZ.qty, 100);
  const day = P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 100, type: 'limit', limitPrice: 48, tif: 'day' }, 47.5);
  P.processOrders('XYZ', vbar(48, 49, 47.8, 48.5, 300, '2024-03-06'));                 // 30 shares
  assert.strictEqual(day.filledQty, 30);
  P.processOrders('XYZ', vbar(48, 49, 47.8, 48.5, 300, '2024-03-07'));
  assert.strictEqual(day.status, 'expired');
  assert.ok(/partially filled \(30 of 100\)/.test(day.reason), day.reason);
});

test('slippage: buys fill worse UP, sells worse DOWN; limits never slip past the limit', () => {
  const s = real({ slippageBps: 10 });
  const buy = P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 100, type: 'market' }, 100);
  assert.strictEqual(buy.fillPrice, 100.1);
  assert.strictEqual(s.trades[0].basePrice, 100);
  assert.strictEqual(s.trades[0].slippage, 10);
  assert.ok(/Slippage of 10 bps/.test(buy.reason), buy.reason);
  near(s.cash, 100000 - 10010, 0.001);
  const sell = P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 50, type: 'market' }, 100);
  assert.strictEqual(sell.fillPrice, 99.9);
  assert.ok(sell.fillPrice < 100 && buy.fillPrice > 100);
  // sell stop: fills below the stop price
  P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 50, type: 'stop', stopPrice: 95 }, 100);
  const f = P.processOrders('XYZ', vbar(98, 98, 94, 95, 1000, '2024-03-04'));
  assert.strictEqual(f[0].trade.price, 94.905);
  // limit order: no slippage
  P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 10, type: 'limit', limitPrice: 90 }, 95);
  const f2 = P.processOrders('XYZ', vbar(92, 93, 89, 90, 1000, '2024-03-05'));
  assert.strictEqual(f2[0].trade.price, 90);
  assert.strictEqual(f2[0].trade.slippage, 0);
  // stop-limit: slippage capped at the limit
  P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 10, type: 'stop_limit', stopPrice: 100, limitPrice: 100.05 }, 95);
  const f3 = P.processOrders('XYZ', vbar(99, 101, 98, 100, 1000, '2024-03-06'));
  assert.strictEqual(f3[0].trade.price, 100.05);
  assert.strictEqual(P.slipPrice('buy', 200, 'market'), 200.2);
  assert.strictEqual(P.slipPrice('sell', 200, 'stop'), 199.8);
  assert.strictEqual(P.slipPrice('sell', 200, 'limit'), 200);
  assert.ok(P.stats().slippagePaid > 0);
});

test('commission presets: zero, per-share (min and cap, options per contract), per-trade once per order', () => {
  const s = real();
  P.applyCommissionPreset('per-trade');
  assert.strictEqual(P.settings.commission, 4.95);
  let o = P.placeOrder({ symbol: 'AAA', side: 'buy', qty: 10, type: 'market' }, 10);
  assert.strictEqual(o.commission, 4.95);
  near(s.cash, 100000 - 100 - 4.95, 0.001);

  P.applyCommissionPreset('zero');
  assert.strictEqual(P.settings.commissionPreset, 'zero');
  o = P.placeOrder({ symbol: 'AAA', side: 'buy', qty: 10, type: 'market' }, 10);
  assert.strictEqual(o.commission, 0);

  P.applyCommissionPreset('per-share');
  assert.strictEqual(P.commissionFor(100, 50), 1, '100 × $0.005 = $0.50 → $1 minimum');
  assert.strictEqual(P.commissionFor(1000, 50), 5);
  assert.strictEqual(P.commissionFor(10, 1), 0.1, 'capped at 1% of a $10 trade');
  assert.strictEqual(P.commissionFor(2, 3, 100, 'option'), 1.3, '$0.65 per contract');
  o = P.placeOrder({ symbol: 'BBB', side: 'buy', qty: 1000, type: 'market' }, 50);
  assert.strictEqual(o.commission, 5);
  const opt = P.placeOptionOrder({ contract: 'AAPL291221C00200000', side: 'buy', qty: 2 }, 3);
  assert.strictEqual(opt.status, 'filled', opt.reason);
  assert.strictEqual(opt.commission, 1.3);

  // per-trade with the volume model: charged on the first fill only
  P.setSettings({ commissionPreset: 'per-trade', commission: 2, fillModel: 'volume' });
  const big = P.placeOrder({ symbol: 'CCC', side: 'buy', qty: 150, type: 'market' }, 10, { volume: 1000 });
  P.processOrders('CCC', vbar(10, 10, 10, 10, 1000, '2024-03-04'));
  assert.strictEqual(big.status, 'filled');
  assert.strictEqual(big.commission, 2);
  assert.deepStrictEqual(s.trades.filter(t => t.symbol === 'CCC').map(t => t.commission), [2, 0]);

  // v0.2 meaning kept: a flat commission while on 'zero' switches back to per-trade
  P.setSettings({ commissionPreset: 'zero', fillModel: 'instant' });
  P.setSettings({ commission: 1 });
  assert.strictEqual(P.settings.commissionPreset, 'per-trade');
  assert.strictEqual(P.placeOrder({ symbol: 'AAA', side: 'sell', qty: 5, type: 'market' }, 10).commission, 1);
  assert.ok(P.commissionPresets['per-share'].description.length > 20);
  assert.strictEqual(P.applyCommissionPreset('nope'), null);
});

test('dividends: credited to longs and debited from shorts on the ex-date, never on the first bar', () => {
  assert.deepStrictEqual(P.exDates('KO', '2024-01-01', '2024-12-31'), ['2024-03-14', '2024-06-14', '2024-09-14', '2024-12-14']);
  assert.strictEqual(P.dividendInfo('TSLA'), null, 'non-payers pay nothing');
  const s = real({ dividends: true });
  P.placeOrder({ symbol: 'KO', side: 'buy', qty: 100, type: 'market' }, 60);
  P.processOrders('KO', vbar(60, 61, 59, 60, 1e6, '2024-03-13'));      // first bar: just remembered
  assert.strictEqual(s.cash, 94000);
  P.processOrders('KO', vbar(59.6, 60, 59, 59.5, 1e6, '2024-03-14'));  // ex-date
  const perShare = Math.round(0.029 * 60 / 4 * 1e4) / 1e4;             // 0.435, from the previous close
  near(s.cash, 94000 + 100 * perShare, 0.001);
  const cf = P.cashflows();
  assert.strictEqual(cf.length, 1);
  assert.strictEqual(cf[0].type, 'dividend');
  assert.strictEqual(cf[0].symbol, 'KO');
  assert.strictEqual(cf[0].day, '2024-03-14');
  near(cf[0].amount, 43.5, 0.001);
  assert.ok(/credited/.test(cf[0].note), cf[0].note);
  P.processOrders('KO', vbar(59.6, 60, 59, 59.5, 1e6, '2024-03-15'));  // no double payment
  assert.strictEqual(P.cashflows().length, 1);
  near(P.stats().dividends, 43.5, 0.001);

  // short: the dividend is owed to the lender
  const s2 = real({ dividends: true });
  P.placeOrder({ symbol: 'KO', side: 'sell', qty: 100, type: 'market' }, 60);
  const cashAfterShort = s2.cash;
  P.processOrders('KO', vbar(60, 61, 59, 60, 1e6, '2024-06-13'));
  P.processOrders('KO', vbar(60, 61, 59, 60, 1e6, '2024-06-17'));      // ex-date 14 June fell between bars
  near(s2.cash, cashAfterShort - 43.5, 0.001);
  assert.ok(P.cashflows()[0].amount < 0);
  assert.ok(/short/i.test(P.cashflows()[0].note));

  // off by default; buying ON the ex-date bar does not earn that dividend
  const s3 = real();
  P.placeOrder({ symbol: 'KO', side: 'buy', qty: 100, type: 'market' }, 60);
  P.processOrders('KO', vbar(60, 61, 59, 60, 1e6, '2024-03-13'));
  P.processOrders('KO', vbar(60, 61, 59, 60, 1e6, '2024-03-14'));
  assert.strictEqual(s3.cash, 94000);
  real({ dividends: true });
  P.processOrders('KO', vbar(60, 61, 59, 60, 1e6, '2024-03-13'));
  P.placeOrder({ symbol: 'KO', side: 'buy', qty: 100, type: 'limit', limitPrice: 59.5 }, 60);
  P.processOrders('KO', vbar(59.6, 60, 59, 59.5, 1e6, '2024-03-14'));
  assert.strictEqual(P.getState().positions.KO.qty, 100);
  assert.strictEqual(P.cashflows().length, 0, 'the position was opened on the ex-date');
  // explicit dividends (e.g. from live data)
  assert.strictEqual(P.applyDividend('KO', 0.5).amount, 50);
  assert.strictEqual(P.applyDividend('NONE', 0.5), null);
});

test('cash interest accrues daily on free cash, carries fractions of a cent, and never applies retroactively', () => {
  const s = real({ cashInterestPct: 4 });
  P.markToMarket({}, T0 + DAY);
  assert.strictEqual(s.cash, 100010.95, '100,000 × 4% / 365 = 10.958… → 10.95 posted, the rest carried');
  const cf = P.cashflows();
  assert.strictEqual(cf.length, 1);
  assert.strictEqual(cf[0].type, 'interest');
  P.markToMarket({}, T0 + DAY + 3600000);                             // same day: nothing more
  assert.strictEqual(P.cashflows().length, 1);
  P.markToMarket({}, T0 + 10 * DAY);
  near(P.stats().interest, 100000 * 0.04 * 10 / 365, 0.02);
  // short-sale proceeds earn nothing
  const s2 = real({ cashInterestPct: 5 });
  P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 100, type: 'market' }, 100);  // cash 110,000, 10,000 backs the short
  P.markToMarket({ XYZ: 100 }, T0 + 365 * DAY);
  near(s2.income.interest, 100000 * 0.05, 0.05);
  // switching it on later does not pay for the past
  const s3 = real();
  fakeNow = T0 + 100 * DAY;
  P.setSettings({ cashInterestPct: 4 });
  P.markToMarket({}, T0 + 101 * DAY);
  near(s3.income.interest, 10.95, 0.001);
  fakeNow = T0;
});

test('short borrow fee accrues daily on short stock value only', () => {
  const s = real({ borrowFeePct: 10 });
  P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 100, type: 'market' }, 50);
  P.placeOrder({ symbol: 'LONG', side: 'buy', qty: 100, type: 'market' }, 50);
  const cash0 = s.cash;
  P.markToMarket({ XYZ: 50, LONG: 50 }, T0 + DAY);
  near(s.cash, cash0 - 1.36, 0.001);                                  // 5,000 × 10% / 365 = 1.369…
  const cf = P.cashflows();
  assert.strictEqual(cf[0].type, 'borrow');
  assert.ok(cf[0].amount < 0);
  assert.ok(/borrow fee/i.test(cf[0].note));
  P.markToMarket({ XYZ: 50, LONG: 50 }, T0 + 365 * DAY);
  near(s.income.borrowFees, 500, 0.02);
  near(P.stats().borrowFees, 500, 0.02);
  // no shorts → no fee
  const s2 = real({ borrowFeePct: 10 });
  P.placeOrder({ symbol: 'LONG', side: 'buy', qty: 100, type: 'market' }, 50);
  P.markToMarket({ LONG: 50 }, T0 + 30 * DAY);
  assert.strictEqual(s2.income.borrowFees, 0);
});

test('PDT rule blocks the 4th day trade in 5 business days under $25k with a clear reason', () => {
  const s = real({ pdtRule: true }, 20000);
  for (let i = 0; i < 3; i++) {
    P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
    const out = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 101);
    assert.strictEqual(out.status, 'filled', out.reason);
  }
  assert.strictEqual(P.dayTradeCount(), 3);
  const st = P.pdtStatus();
  assert.strictEqual(st.restricted, true);
  assert.strictEqual(st.remaining, 0);
  const open = P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
  assert.strictEqual(open.status, 'filled', 'opening a position is not a day trade');
  const blocked = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 101);
  assert.strictEqual(blocked.status, 'rejected');
  assert.ok(/pattern day trader/i.test(blocked.reason), blocked.reason);
  assert.ok(/\$25,000/.test(blocked.reason), blocked.reason);
  assert.ok(/next trading day/.test(blocked.reason), blocked.reason);
  assert.strictEqual(s.positions.AAPL.qty, 10, 'nothing filled');
  // closePosition is blocked the same way
  assert.strictEqual(P.closePosition('AAPL', 101).status, 'rejected');
  // Monday: closing Friday's position is not a day trade
  fakeNow = T0 + 3 * DAY;
  const monday = P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 102);
  assert.strictEqual(monday.status, 'filled', monday.reason);
  assert.strictEqual(s.trades[s.trades.length - 1].dayTrade, false);
  fakeNow = T0;
  // at or above $25,000 the rule does not restrict
  real({ pdtRule: true }, 30000);
  for (let i = 0; i < 5; i++) {
    P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
    assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 100).status, 'filled');
  }
  assert.strictEqual(P.dayTradeCount(), 5);
  // rule off: never blocks
  real({}, 20000);
  for (let i = 0; i < 5; i++) {
    P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 100);
    assert.strictEqual(P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 100).status, 'filled');
  }
});

test('PDT counts day trades on daily bars by bar date (resting stop on a same-day position)', () => {
  real({ pdtRule: true }, 20000);
  const days = ['2024-03-04', '2024-03-05', '2024-03-06'];
  days.forEach(d => {
    P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 10, type: 'limit', limitPrice: 100 }, 101);
    P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 10, type: 'limit', limitPrice: 102 }, 101);
    P.processOrders('XYZ', vbar(101, 103, 99, 101, 1e6, d));
  });
  assert.strictEqual(P.dayTradeCount('2024-03-06'), 3);
  P.placeOrder({ symbol: 'XYZ', side: 'buy', qty: 10, type: 'limit', limitPrice: 100 }, 101);
  const stop = P.placeOrder({ symbol: 'XYZ', side: 'sell', qty: 10, type: 'stop', stopPrice: 98 }, 101);
  P.processOrders('XYZ', vbar(101, 101, 97, 98, 1e6, '2024-03-07'));
  assert.strictEqual(stop.status, 'rejected');
  assert.ok(/PDT/.test(stop.reason), stop.reason);
  assert.strictEqual(P.dayTradeCount('2024-03-11'), 2, 'the window rolls forward over 5 business days');
});

test('league:* accounts are isolated from main and from each other, settings included', () => {
  real();
  P.placeOrder({ symbol: 'MAIN', side: 'buy', qty: 1, type: 'market' }, 10);
  P.use('league:ABC234');
  assert.strictEqual(P.account(), 'league-abc234');
  assert.strictEqual(P.storageKeyFor('league:ABC234'), 'bt.portfolio.league-abc234');
  assert.strictEqual(P.getState().trades.length, 0, 'fresh league account');
  P.reset(50000);
  P.setSettings({ commission: 1, slippageBps: 5 });
  P.placeOrder({ symbol: 'LG', side: 'buy', qty: 10, type: 'market' }, 100);
  assert.strictEqual(P.getState().positions.LG.qty, 10);
  near(P.getState().cash, 50000 - 1000.5 - 1, 0.001);
  P.use('league:XYZ789');
  assert.strictEqual(P.getState().cash, 100000);
  assert.strictEqual(P.settings.slippageBps, 0, 'settings do not leak between leagues');
  assert.strictEqual(P.getState().positions.LG, undefined);
  P.use('main');
  assert.strictEqual(P.settings.slippageBps, 0);
  assert.strictEqual(P.settings.commission, 0);
  assert.strictEqual(P.getState().positions.LG, undefined);
  assert.strictEqual(P.getState().positions.MAIN.qty, 1);
  P.use('league:abc234');                                            // same account, any case
  assert.strictEqual(P.getState().positions.LG.qty, 10);
  assert.strictEqual(P.settings.slippageBps, 5);
  assert.strictEqual(P.settings.commission, 1);
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.portfolio.league-abc234')).positions.LG.qty, 10);
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.portfolio')).positions.LG, undefined);
  // accounts() lists each league once and never treats the portfolio UI key as an account
  localStorage.setItem('bt.portfolio.ui', JSON.stringify({ tab: 'positions' }));
  const keys = () => Object.keys(store);
  localStorage.key = i => keys()[i];
  Object.defineProperty(localStorage, 'length', { configurable: true, get: () => keys().length });
  try {
    const ids = P.accounts().map(a => a.id);
    assert.ok(ids.includes('league-abc234') && ids.includes('league-xyz789'), ids.join());
    assert.ok(!ids.includes('ui'), ids.join());
    assert.strictEqual(ids.filter(i => i === 'league-abc234').length, 1);
  } finally {
    delete localStorage.key;
    delete localStorage.length;
    localStorage.removeItem('bt.portfolio.ui');
  }
  P.deleteAccount('league:ABC234');
  P.deleteAccount('league:XYZ789');
  assert.strictEqual(P.account(), 'main');
});

test('realism settings and cash flows persist across reload, survive reset, and ignore bad values', () => {
  const s = real({ dividends: true, cashInterestPct: 3, fillModel: 'volume', slippageBps: 7, pdtRule: true, borrowFeePct: 2 });
  P.markToMarket({}, T0 + 2 * DAY);
  const raw = localStorage.getItem('bt.portfolio');
  P.reset(1);
  localStorage.setItem('bt.portfolio', raw);
  const re = P.load();
  assert.strictEqual(re.settings.fillModel, 'volume');
  assert.strictEqual(re.settings.slippageBps, 7);
  assert.strictEqual(re.settings.dividends, true);
  assert.strictEqual(re.settings.pdtRule, true);
  assert.strictEqual(re.settings.cashInterestPct, 3);
  assert.strictEqual(re.cashflows.length, 1);
  assert.ok(re.income.interest > 0);
  const kept = P.reset(5000);
  assert.strictEqual(kept.settings.slippageBps, 7, 'reset keeps preferences');
  assert.deepStrictEqual(kept.cashflows, []);
  P.setSettings({ fillModel: 'teleport', slippageBps: -3, cashInterestPct: 'lots', commissionPreset: 'free-lunch', pdtRule: 'yes' });
  assert.strictEqual(P.settings.fillModel, 'volume');
  assert.strictEqual(P.settings.slippageBps, 7);
  assert.strictEqual(P.settings.cashInterestPct, 3);
  assert.strictEqual(P.settings.commissionPreset, 'per-trade');
  assert.strictEqual(P.settings.pdtRule, true);
  localStorage.setItem('bt.portfolio', JSON.stringify({ cash: 10, settings: { fillModel: 7, slippageBps: 'x' }, cashflows: [null, { type: 'interest', amount: 'x' }] }));
  const bad = P.load();
  assert.strictEqual(bad.settings.fillModel, 'instant');
  assert.strictEqual(bad.settings.slippageBps, 0);
  assert.deepStrictEqual(bad.cashflows, []);
  real();
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
