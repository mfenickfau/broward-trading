/* Broward Trading — tests for js/coach.js (BT.coach)
 * Run with:  node tests/coach.test.js
 * Uses the real BT.paper engine to build account histories, so the coach is
 * tested against the same state shapes the dashboard and Replay produce.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
global.window = { localStorage: global.localStorage };
require(path.join(__dirname, '..', 'js', 'paper.js'));
require(path.join(__dirname, '..', 'js', 'coach.js'));
const P = window.BT.paper;
const C = window.BT.coach;

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
  }
}

const T0 = Date.UTC(2024, 2, 4, 15, 0, 0);   // a Monday, mid-session
let fakeNow = T0;
P.setClock(() => fakeNow);
function fresh() { localStorage.clear(); P.reset(100000); P.setSettings({ commission: 0 }); fakeNow = T0; return P.getState(); }
function ids(list) { return list.map(f => f.id).sort(); }
function find(list, id) { return list.filter(f => f.id === id)[0]; }

// 80 daily bars ending at `last`; trend 'up' rises into it, 'down' falls into it.
function bars(trend, last) {
  last = last || 100;
  const out = [];
  for (let i = 0; i < 80; i++) {
    const k = 79 - i;
    const c = trend === 'up' ? last - k * 0.5 : (trend === 'down' ? last + k * 0.5 : last + Math.sin(i) * 0.2);
    const d = new Date(Date.UTC(2023, 10, 1) + i * 86400000).toISOString().slice(0, 10);
    out.push({ time: d, open: c, high: c + 1, low: c - 1, close: c, volume: 1e6 });
  }
  return out;
}
function plan(order, stop, target) { order.meta = Object.assign({}, order.meta, { plan: { stop: stop, target: target } }); P.save && P.save(); return order; }
function ctx(extra) { return Object.assign({ account: P.getState(), bars: bars('up'), now: fakeNow }, extra || {}); }

console.log('BT.coach tests');

/* ------------------------------------------------------------------ */
test('exposes the contract surface', () => {
  ['reviewOrder', 'reviewTrade', 'ai', 'lessonUrl', 'summary', 'toJournal'].forEach(f => assert.strictEqual(typeof C[f], 'function', f));
});

test('every lessonId used by the coach exists in course/index.json', () => {
  const course = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'course', 'index.json'), 'utf8'));
  const all = {};
  course.modules.forEach(m => m.lessons.forEach(l => { all[l.id] = l.title; }));
  Object.keys(C.LESSONS).forEach(rule => assert.ok(all[C.LESSONS[rule]], rule + ' → ' + C.LESSONS[rule]));
  Object.keys(C.LESSONS).forEach(rule => assert.strictEqual(C.lessonTitle(C.LESSONS[rule]), all[C.LESSONS[rule]]));
  assert.strictEqual(C.lessonUrl('m4-l1'), 'learn.html#/lesson/m4-l1');
});

test('each rule links to a lesson whose text teaches that rule', () => {
  const dir = path.join(__dirname, '..', 'course');
  const text = {};
  fs.readdirSync(dir).filter(f => /^m\d+-.*\.json$/.test(f)).forEach(f => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    (j.lessons || []).forEach(l => { text[l.id] = JSON.stringify(l).toLowerCase(); });
  });
  const keyword = { overtrade: /overtrad/, avgDown: /averaging down/, revenge: /revenge/, noStop: /stop/, stopSlip: /stop/, risk: /1%/, size: /1%/, trend: /moving average/, rr: /reward/ };
  Object.keys(keyword).forEach(rule => {
    const id = C.LESSONS[rule];
    assert.ok(text[id], rule + ' -> ' + id + ' has lesson text');
    assert.ok(keyword[rule].test(text[id]), rule + ' -> ' + id + ' mentions ' + keyword[rule]);
  });
});

/* ---------------------------- no false positives ------------------- */
test('a well-planned order (stop, 0.2% risk, 3:1 target, with the trend) gets no findings', () => {
  fresh();
  const order = { symbol: 'MSFT', side: 'buy', qty: 100, type: 'market', meta: { plan: { stop: 98, target: 106 } } };
  assert.deepStrictEqual(C.reviewOrder(order, ctx({ price: 100 })), []);
});

test('the same well-planned order reviewed after its fill still gets no findings', () => {
  fresh();
  const o = plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100), 98, 106);
  assert.strictEqual(o.status, 'filled');
  assert.deepStrictEqual(C.reviewOrder(o, ctx()), []);
});

test('a well-planned closed trade gets no findings, whether it won or lost', () => {
  fresh();
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100), 98, 106);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 106);
  const st = P.getState();
  const win = st.trades[st.trades.length - 1];
  assert.ok(win.closedQty === 100 && win.realized > 0);
  assert.deepStrictEqual(C.reviewTrade(win, ctx()), []);

  fakeNow += 86400e3;
  plan(P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 100, type: 'market' }, 100), 98, 106);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 100, type: 'market' }, 98);   // stopped out as planned
  const loss = P.getState().trades.slice(-1)[0];
  assert.ok(loss.realized < 0);
  assert.deepStrictEqual(C.reviewTrade(loss, ctx()), []);
  assert.ok(/no issues/i.test(C.summary([])));
});

test('a well-planned short in a downtrend gets no findings', () => {
  fresh();
  const order = { symbol: 'XYZ', side: 'sell', qty: 100, type: 'market', meta: { plan: { stop: 102, target: 94 } } };
  assert.deepStrictEqual(C.reviewOrder(order, ctx({ price: 100, bars: bars('down') })), []);
});

test('closing or reducing a position is not reviewed as a new trade', () => {
  fresh();
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 400, type: 'market' }, 100);
  assert.deepStrictEqual(C.reviewOrder({ symbol: 'MSFT', side: 'sell', qty: 400, type: 'market' }, ctx({ price: 90 })), []);
  const o = P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 90);
  assert.deepStrictEqual(C.reviewOrder(o, ctx()), []);
});

test('bad input never throws', () => {
  assert.deepStrictEqual(C.reviewOrder(null), []);
  assert.deepStrictEqual(C.reviewOrder({ side: 'hold' }), []);
  assert.deepStrictEqual(C.reviewTrade(null), []);
  assert.deepStrictEqual(C.reviewTrade({ symbol: 'X' }, { account: {} }), []);
  assert.ok(Array.isArray(C.reviewOrder({ symbol: 'X', side: 'buy', qty: 1 }, { account: {} })));
});

/* ---------------------------- stop & risk -------------------------- */
test('no stop → warn, linked to the stop-loss lesson', () => {
  fresh();
  const f = C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, ctx({ price: 100 }));
  assert.deepStrictEqual(ids(f), ['noStop']);
  assert.strictEqual(f[0].level, 'warn');
  assert.strictEqual(f[0].lessonId, 'm4-l2');
  assert.ok(f[0].title && f[0].message);
});

test('a working protective stop order counts as a stop', () => {
  fresh();
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100);
  const stop = P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'stop', stopPrice: 98 }, 100);
  assert.strictEqual(stop.status, 'open');
  const add = { symbol: 'MSFT', side: 'buy', qty: 50, type: 'market' };
  assert.ok(!find(C.reviewOrder(add, ctx({ price: 100 })), 'noStop'));
});

test('closed trade with no stop → warn; exiting through a stop order counts as a stop', () => {
  fresh();
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 101);
  assert.deepStrictEqual(ids(C.reviewTrade(P.getState().trades.slice(-1)[0], ctx())), ['noStop']);

  fresh();
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100);
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'stop', stopPrice: 98 }, 100);
  fakeNow += 3600e3;
  P.processOrders('MSFT', { time: '2024-03-04', open: 99, high: 99.5, low: 97, close: 97.5, volume: 1e6 });
  const exit = P.getState().trades.slice(-1)[0];
  assert.ok(exit.closedQty === 100, 'stop filled');
  assert.deepStrictEqual(C.reviewTrade(exit, ctx()), []);
});

test('stop on the wrong side of the entry → warn', () => {
  fresh();
  const f = C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market', meta: { plan: { stop: 101, target: 110 } } }, ctx({ price: 100 }));
  assert.deepStrictEqual(ids(f), ['noStop']);
  assert.ok(/wrong side/i.test(f[0].title));
});

test('risk: 1.5% of equity → tip, 3% → warn, exactly 1% → nothing', () => {
  fresh();
  const r = (qty, stop) => C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: qty, type: 'market', meta: { plan: { stop: stop, target: 100 + (100 - stop) * 3 } } }, ctx({ price: 100 }));
  assert.deepStrictEqual(ids(r(100, 90)), []);                  // $1,000 = 1.0 %
  const tip = r(150, 90);                                        // $1,500 = 1.5 %
  assert.deepStrictEqual(ids(tip), ['risk']);
  assert.strictEqual(tip[0].level, 'tip');
  assert.ok(/1\.5%/.test(tip[0].message), tip[0].message);
  const warn = r(200, 85);                                       // $3,000 = 3 %
  assert.deepStrictEqual(ids(warn), ['risk']);
  assert.strictEqual(warn[0].level, 'warn');
  assert.strictEqual(warn[0].lessonId, 'm4-l1');
});

test('reward-to-risk: 1.2:1 → tip, 0.8:1 → warn, wrong-side target → warn, 1.5:1 → nothing', () => {
  fresh();
  const r = target => C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market', meta: { plan: { stop: 98, target: target } } }, ctx({ price: 100 }));
  assert.deepStrictEqual(ids(r(103)), []);
  const tip = r(102.4);
  assert.deepStrictEqual(ids(tip), ['rr']);
  assert.strictEqual(tip[0].level, 'tip');
  assert.ok(/1\.2:1/.test(tip[0].message) && /45%/.test(tip[0].message), tip[0].message);
  assert.strictEqual(r(101.6)[0].level, 'warn');
  const wrong = r(97);
  assert.strictEqual(wrong[0].id, 'rr');
  assert.ok(/wrong side/i.test(wrong[0].title));
  // no target recorded → no R:R finding
  assert.deepStrictEqual(ids(C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 100, meta: { plan: { stop: 98 } } }, ctx({ price: 100 }))), []);
});

test('closed trade that lost far more than 1R → stop-slip warn', () => {
  fresh();
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100), 98, 106);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 95);   // -2.5R
  const f = C.reviewTrade(P.getState().trades.slice(-1)[0], ctx());
  assert.deepStrictEqual(ids(f), ['stopSlip']);
  assert.ok(/2\.5R/.test(f[0].message));
});

/* ---------------------------- size & averaging down ---------------- */
test('position above 25% of equity → warn', () => {
  fresh();
  const f = C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 300, type: 'market', meta: { plan: { stop: 99.5, target: 102 } } }, ctx({ price: 100 }));
  assert.deepStrictEqual(ids(f), ['size']);
  assert.ok(/30%/.test(f[0].message), f[0].message);
  assert.deepStrictEqual(ids(C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 250, type: 'market', meta: { plan: { stop: 99.5, target: 102 } } }, ctx({ price: 100 }))), []);
});

test('averaging down a loser → warn; adding to a winner → no warning', () => {
  fresh();
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 50, type: 'market' }, 100), 95, 115);
  fakeNow += 2 * 86400e3;
  const down = C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 50, type: 'market', meta: { plan: { stop: 90, target: 120 } } }, ctx({ price: 96, bars: bars('up', 96) }));
  assert.deepStrictEqual(ids(down), ['avgDown']);
  assert.strictEqual(down[0].lessonId, 'm7-l4');
  const up = C.reviewOrder({ symbol: 'MSFT', side: 'buy', qty: 50, type: 'market', meta: { plan: { stop: 100, target: 120 } } }, ctx({ price: 104, bars: bars('up', 104) }));
  assert.deepStrictEqual(ids(up), []);
});

test('averaging down is detected after the fill too, and in the closed trade', () => {
  fresh();
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 50, type: 'market' }, 100), 90, 130);
  fakeNow += 2 * 86400e3;
  const add = plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 50, type: 'market' }, 95), 90, 130);
  assert.ok(ids(C.reviewOrder(add, ctx({ bars: bars('up', 95) }))).includes('avgDown'));
  fakeNow += 86400e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 99);
  const f = C.reviewTrade(P.getState().trades.slice(-1)[0], ctx({ bars: bars('up', 99) }));
  assert.ok(ids(f).includes('avgDown'), JSON.stringify(ids(f)));
});

/* ---------------------------- trend -------------------------------- */
test('buying below a falling SMA50 → trend tip; shorting above a rising SMA50 → trend tip', () => {
  fresh();
  const long = C.reviewOrder({ symbol: 'X', side: 'buy', qty: 100, meta: { plan: { stop: 98, target: 106 } } }, ctx({ price: 100, bars: bars('down') }));
  assert.deepStrictEqual(ids(long), ['trend']);
  assert.strictEqual(long[0].level, 'tip');
  assert.strictEqual(long[0].lessonId, 'm3-l1');
  const short = C.reviewOrder({ symbol: 'X', side: 'sell', qty: 100, meta: { plan: { stop: 102, target: 94 } } }, ctx({ price: 100, bars: bars('up') }));
  assert.deepStrictEqual(ids(short), ['trend']);
  // too few bars for an SMA50 → no trend opinion
  assert.deepStrictEqual(ids(C.reviewOrder({ symbol: 'X', side: 'buy', qty: 100, meta: { plan: { stop: 98, target: 106 } } }, ctx({ price: 100, bars: bars('down').slice(-30) }))), []);
});

test('uses ctx.ind.sma50 when provided', () => {
  fresh();
  const b = bars('flat');
  const sma50 = b.map((x, i) => i < 49 ? null : 120 - i * 0.1);   // falling and above price
  const f = C.reviewOrder({ symbol: 'X', side: 'buy', qty: 100, meta: { plan: { stop: 98, target: 106 } } }, ctx({ price: 100, bars: b, ind: { sma50: sma50 } }));
  assert.deepStrictEqual(ids(f), ['trend']);
});

test('closed trade is judged against the trend at its entry bar', () => {
  fresh();
  const b = bars('down');
  plan(P.placeOrder({ symbol: 'X', side: 'buy', qty: 100, type: 'market' }, 100), 98, 106);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'X', side: 'sell', qty: 100, type: 'market' }, 101);
  assert.deepStrictEqual(ids(C.reviewTrade(P.getState().trades.slice(-1)[0], ctx({ bars: b }))), ['trend']);
});

test('closed trade: the entry is judged on what was visible at entry, not the entry bar\'s later close', () => {
  fresh();
  // 70 daily bars, SMA50 rising; the student buys at 125 mid-day on the last day, which then closes at 95.
  const b = [];
  for (let i = 0; i < 70; i++) {
    const c = i < 69 ? 100 + i * 0.5 : 95;
    b.push({ time: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume: 1e6 });
  }
  const day = b[69].time;
  const summary = { symbol: 'X', side: 'long', qty: 10, entry: 125, exit: 120, stop: 121, target: 140,
    entryTime: Date.parse(day + 'T15:00:00Z'), exitTime: Date.parse(day + 'T19:00:00Z') };
  // At entry only bars through D-1 plus the forming bar at 125 were visible: no trend finding.
  const forming = b.slice(0, 69).concat([{ time: day, open: 125, high: 125, low: 125, close: 125, volume: 1 }]);
  assert.ok(!ids(C.reviewOrder({ symbol: 'X', side: 'buy', qty: 10, meta: { plan: { stop: 121, target: 140 } } }, ctx({ price: 125, bars: forming }))).includes('trend'));
  // Reviewed after exit on the finished bars: still no trend finding.
  const after = ids(C.reviewTrade(summary, ctx({ bars: b })));
  assert.ok(!after.includes('trend'), JSON.stringify(after));
  // Unknown entry time: no trend opinion (it used to be judged on the exit-day bar).
  const noTime = Object.assign({}, summary); delete noTime.entryTime;
  assert.ok(!ids(C.reviewTrade(noTime, ctx({ bars: bars('down') }))).includes('trend'));
  // A Replay fill exactly at the bar's close (ticks off) is judged on that bar.
  const down = bars('down');
  const atClose = { symbol: 'X', side: 'long', qty: 10, entry: down[79].close, exit: 101, stop: 98, target: 106, entryBarTime: down[79].time };
  assert.deepStrictEqual(ids(C.reviewTrade(atClose, ctx({ bars: down }))), ['trend']);
});

test('large-position copy fits the asset: single stock, index ETF, crypto', () => {
  fresh();
  window.BT.data = { kindOf: s => (s === 'SPY' ? 'etf' : (/-USD$/.test(s) ? 'crypto' : 'stock')), universe: [{ symbol: 'SPY', kind: 'etf', etfType: 'index' }] };
  try {
    const big = (sym, px) => C.reviewOrder({ symbol: sym, side: 'buy', qty: 300, type: 'market', meta: { plan: { stop: px * 0.99, target: px * 1.05 } } }, ctx({ price: px, bars: bars('up', px) }));
    const stock = find(big('MSFT', 100), 'size'), etf = find(big('SPY', 100), 'size'), coin = find(big('BTC-USD', 100), 'size');
    assert.ok(/overnight gap/.test(stock.message), stock.message);
    assert.ok(/diversified fund/.test(etf.message) && !/one name|overnight/.test(etf.message), etf.message);
    assert.ok(/around the clock/.test(coin.message) && !/overnight/.test(coin.message), coin.message);
    const t = C.reviewTrade({ symbol: 'BTC-USD', side: 'long', qty: 300, entry: 100, exit: 101, stop: 99.5, target: 102, entryTime: T0 }, ctx({ bars: bars('up', 100) }));
    assert.ok(/around the clock/.test(find(t, 'size').message));
  } finally { delete window.BT.data; }
});

/* ---------------------------- revenge ------------------------------ */
test('revenge trade: a new position 5 minutes after a loss → warn; 30 minutes → nothing', () => {
  fresh();
  plan(P.placeOrder({ symbol: 'TSLA', side: 'buy', qty: 10, type: 'market' }, 200), 190, 230);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'TSLA', side: 'sell', qty: 10, type: 'market' }, 190);
  const good = { symbol: 'MSFT', side: 'buy', qty: 100, type: 'market', meta: { plan: { stop: 98, target: 106 } } };
  fakeNow += 5 * 60e3;
  const f = C.reviewOrder(good, ctx({ price: 100 }));
  assert.deepStrictEqual(ids(f), ['revenge']);
  assert.strictEqual(f[0].level, 'warn');
  assert.ok(/5 minutes/.test(f[0].message), f[0].message);
  fakeNow += 25 * 60e3;
  assert.deepStrictEqual(C.reviewOrder(good, ctx({ price: 100 })), []);
});

test('revenge trade in Replay uses bars: within 2 bars → warn, 5 bars later → nothing', () => {
  fresh();
  P.use('replay'); P.reset(100000); P.setSettings({ commission: 0 });
  const b = bars('up');
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 10, type: 'market' }, 95), 90, 110);
  const st = P.getState();
  // book the losing close on bar 70
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 10, type: 'market' }, 90);
  st.trades[st.trades.length - 1].barTime = b[70].time;
  const good = { symbol: 'AAPL', side: 'buy', qty: 100, type: 'market', meta: { plan: { stop: 98, target: 106 } } };
  // visible bars up to 71 (one bar later), hours of wall-clock time later
  fakeNow += 5 * 3600e3;
  const vis = b.slice(0, 72);
  assert.deepStrictEqual(ids(C.reviewOrder(good, { account: P.getState(), bars: vis, now: fakeNow, price: 100, time: vis[71].time })), ['revenge']);
  const vis2 = b.slice(0, 76);
  assert.deepStrictEqual(ids(C.reviewOrder(good, { account: P.getState(), bars: vis2, now: fakeNow, price: 100, time: vis2[75].time })), []);
  P.use('main');
});

test('closed trade opened right after a loss is flagged as revenge', () => {
  fresh();
  plan(P.placeOrder({ symbol: 'TSLA', side: 'buy', qty: 10, type: 'market' }, 200), 190, 230);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'TSLA', side: 'sell', qty: 10, type: 'market' }, 190);
  fakeNow += 2 * 60e3;
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100), 98, 106);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 103);
  assert.deepStrictEqual(ids(C.reviewTrade(P.getState().trades.slice(-1)[0], ctx())), ['revenge']);
});

/* ---------------------------- overtrading -------------------------- */
test('overtrading: the 6th new position in a day → warn; the 5th → nothing', () => {
  fresh();
  const syms = ['A', 'B', 'C', 'D', 'E'];
  syms.slice(0, 4).forEach(s => { plan(P.placeOrder({ symbol: s, side: 'buy', qty: 10, type: 'market' }, 100), 98, 106); fakeNow += 30 * 60e3; });
  const next = s => ({ symbol: s, side: 'buy', qty: 10, type: 'market', meta: { plan: { stop: 98, target: 106 } } });
  assert.deepStrictEqual(C.reviewOrder(next('E'), ctx({ price: 100 })), []);
  plan(P.placeOrder(next('E'), 100), 98, 106);
  fakeNow += 30 * 60e3;
  const f = C.reviewOrder(next('F'), ctx({ price: 100 }));
  assert.deepStrictEqual(ids(f), ['overtrade']);
  assert.ok(/6/.test(f[0].message));
  assert.strictEqual(f[0].lessonId, 'm10-l4');
  // reviewed after its own fill it is counted once, not twice
  const filled = plan(P.placeOrder(next('F'), 100), 98, 106);
  const g = C.reviewOrder(filled, ctx());
  assert.ok(/\b6\b/.test(find(g, 'overtrade').message), find(g, 'overtrade').message);
  // the next day starts fresh
  fakeNow += 86400e3;
  assert.deepStrictEqual(C.reviewOrder(next('G'), ctx({ price: 100 })), []);
});

/* ---------------------------- summaries & copy --------------------- */
test('summary trade objects (round trips) are accepted', () => {
  fresh();
  const clean = { symbol: 'SPY', side: 'long', qty: 100, entry: 100, exit: 104, stop: 98, target: 106, pnl: 400, equity: 100000 };
  assert.deepStrictEqual(C.reviewTrade(clean, { account: {} }), []);
  const messy = { symbol: 'SPY', side: 'long', qty: 400, entry: 100, exit: 90, pnl: -4000, equity: 100000, adds: [{ price: 95, qty: 100 }] };
  assert.deepStrictEqual(ids(C.reviewTrade(messy, { account: {} })), ['avgDown', 'noStop', 'size']);
});

test('warnings sort before tips; every finding has the contract shape', () => {
  fresh();
  const f = C.reviewOrder({ symbol: 'X', side: 'buy', qty: 300, meta: { plan: { stop: 99, target: 100.5 } } }, ctx({ price: 100, bars: bars('down') }));
  assert.ok(f.length >= 3);
  let seenTip = false;
  f.forEach(x => {
    assert.ok(x.level === 'tip' || x.level === 'warn');
    assert.ok(typeof x.title === 'string' && x.title && typeof x.message === 'string' && x.message);
    assert.ok(/^m\d-l\d$/.test(x.lessonId));
    if (x.level === 'tip') seenTip = true; else assert.ok(!seenTip, 'warn after tip');
  });
  const s = C.summary(f);
  assert.ok(/thing|things/.test(s), s);
  const j = C.toJournal(f, { ai: 'Nice plan.' });
  assert.strictEqual(j.findings.length, f.length);
  assert.strictEqual(j.ai, 'Nice plan.');
  assert.ok(typeof j.at === 'number');
});

test('all copy goes through BT.t', () => {
  fresh();
  const seen = [];
  window.BT.t = (s, v) => { seen.push(s); return '«' + String(s).replace(/\{(\w+)\}/g, (m, k) => v && k in v ? v[k] : m) + '»'; };
  try {
    const f = C.reviewOrder({ symbol: 'X', side: 'buy', qty: 100 }, ctx({ price: 100 }));
    assert.ok(/^«.*»$/.test(f[0].title) && /^«.*»$/.test(f[0].message));
    assert.ok(seen.includes('No stop-loss'));
    assert.ok(/^«/.test(C.summary([])));
  } finally { delete window.BT.t; }
});

/* ---------------------------- AI hook ------------------------------ */
test('ai(): without an API base it resolves to the rule-based review', async () => {
  fresh();
  delete window.BT.auth;
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100);
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 99);
  const t = P.getState().trades.slice(-1)[0];
  const r = await C.ai(t, { ctx: ctx() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.source, 'rules');
  assert.strictEqual(r.fallback, true);
  assert.strictEqual(r.reason, 'not-configured');
  assert.deepStrictEqual(ids(r.findings), ['noStop']);
});

function fakeAuth(pro) {
  window.BT.auth = {
    config: { apiBase: 'https://api.example.test' },
    configured: () => true, isPro: () => pro,
    apiUrl: p => 'https://api.example.test' + p,
    _store: { get: (k) => k === 'bt.auth' ? { token: 'tok123' } : null }
  };
}

test('ai(): free members get the rules without a network call', async () => {
  fresh(); fakeAuth(false);
  let called = false;
  const r = await C.ai({ symbol: 'SPY', side: 'long', qty: 10, entry: 100, exit: 101, stop: 99, target: 103 }, { fetch: () => { called = true; } });
  assert.strictEqual(r.reason, 'not-pro');
  assert.strictEqual(called, false);
  delete window.BT.auth;
});

test('ai(): Pro members get the worker text; the request carries facts, findings and the note', async () => {
  fresh(); fakeAuth(true);
  plan(P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 100, type: 'market' }, 100), 98, 101);
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 100, type: 'market' }, 101);
  const t = P.getState().trades.slice(-1)[0];
  let req = null;
  const fetch = (url, init) => { req = { url, init }; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, text: ' Good stop placement. ', remaining: 19 }) }); };
  const r = await C.ai(t, { ctx: ctx(), note: 'Followed my plan.', fetch });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'ai');
  assert.strictEqual(r.text, 'Good stop placement.');
  assert.strictEqual(r.remaining, 19);
  assert.strictEqual(req.url, 'https://api.example.test/coach');
  assert.strictEqual(req.init.method, 'POST');
  assert.strictEqual(req.init.headers.Authorization, 'Bearer tok123');
  const body = JSON.parse(req.init.body);
  assert.strictEqual(body.trade.symbol, 'MSFT');
  assert.strictEqual(body.trade.side, 'long');
  assert.strictEqual(body.trade.entry, 100);
  assert.strictEqual(body.trade.exit, 101);
  assert.strictEqual(body.trade.stop, 98);
  assert.strictEqual(body.trade.rMultiple, 0.5);
  assert.strictEqual(body.trade.riskPct, 0.2);
  assert.strictEqual(body.note, 'Followed my plan.');
  assert.strictEqual(body.lang, 'en');
  assert.deepStrictEqual(body.rules.map(x => x.title), ['Low reward-to-risk']);
  delete window.BT.auth;
});

test('ai(): network errors, rate limits and empty answers fall back to the rules', async () => {
  fresh(); fakeAuth(true);
  const trade = { symbol: 'SPY', side: 'long', qty: 10, entry: 100, exit: 101, stop: 99, target: 103 };
  let r = await C.ai(trade, { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  assert.strictEqual(r.fallback, true); assert.strictEqual(r.reason, 'network');
  r = await C.ai(trade, { fetch: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'cap', fallback: true }) }) });
  assert.strictEqual(r.reason, 'limit'); assert.strictEqual(r.error, 'cap');
  r = await C.ai(trade, { fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, text: '  ' }) }) });
  assert.strictEqual(r.reason, 'unavailable');
  r = await C.ai(trade, { fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad')) }) });
  assert.strictEqual(r.source, 'rules');
  r = await C.ai(trade, { fetch: () => { throw new Error('sync'); } });
  assert.strictEqual(r.reason, 'network');
  delete window.BT.auth;
});

runAll().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
