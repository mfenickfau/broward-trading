/* Broward Trading — tests for js/replay.js (BT.replay) and the paper multi-account plumbing it relies on
 * Run with:  node tests/replay.test.js
 * Plain node + assert, no framework. `window`, `localStorage` and timers are shimmed.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// ---- shims -------------------------------------------------------------
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); },
  key(i) { return Object.keys(store)[i] == null ? null : Object.keys(store)[i]; },
  get length() { return Object.keys(store).length; }
};
global.window = { localStorage: global.localStorage };
require(path.join(__dirname, '..', 'js', 'indicators.js'));
require(path.join(__dirname, '..', 'js', 'data.js'));
require(path.join(__dirname, '..', 'js', 'paper.js'));
require(path.join(__dirname, '..', 'js', 'replay.js'));
const BT = window.BT;
const R = BT.replay, P = BT.paper, D = BT.data;

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  pending.push(async () => {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
  });
}
function near(a, b, tol, msg) {
  tol = tol == null ? 1e-6 : tol;
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a + ' (tol ' + tol + ')');
}
/** Synthetic daily bars: a deterministic zig-zag so limit/stop behaviour is predictable. */
function dailyBars(n, start) {
  const bars = [];
  let d = start || '2024-01-02';
  let px = 100;
  for (let i = 0; i < n; i++) {
    const up = i % 3 !== 2;
    const open = px, close = up ? px + 2 : px - 3;
    bars.push({ time: d, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i });
    px = close;
    d = D.calendar.nextTradingDay(d);
  }
  bars.symbol = 'ZIG'; bars.interval = '1day'; bars.source = 'test';
  return bars;
}
// Fake timers so play() can be driven synchronously.
function fakeTimers() {
  const t = { handlers: {}, next: 1, tick() { Object.values(this.handlers).forEach(h => h.fn()); } };
  t.setInterval = (fn, ms) => { const id = t.next++; t.handlers[id] = { fn, ms }; return id; };
  t.clearInterval = id => { delete t.handlers[id]; };
  return t;
}
function fresh() { localStorage.clear(); P.use('main'); P.reset(100000); }

console.log('BT.replay tests');

/* ------------------------------------------------------------------ */
test('module surface and honesty note', () => {
  ['createSession', 'loadBars', 'loadDrills', 'evaluateDrill', 'sessions', 'saveSession', 'saveToJournal', 'toJournalEntry', 'tickPath', 'intrabar', 'partialBar', 'defaultEnd', 'barBudget'].forEach(f => assert.strictEqual(typeof R[f], 'function', f + ' missing'));
  assert.strictEqual(R.ACCOUNT, 'replay');
  assert.strictEqual(R.SESSIONS_KEY, 'bt.replay.sessions');
  assert.strictEqual(R.JOURNAL_KEY, 'bt.journal');
  assert.deepStrictEqual(R.SPEEDS, [1, 2, 5, 10, 20]);
  assert.ok(/hides the future/i.test(R.HONESTY) && /simulated/i.test(R.HONESTY));
});

test('createSession hides the future: visible() is exactly bars.slice(0, cursor) and never leaks later bars', () => {
  fresh();
  const bars = dailyBars(40);
  const s = R.createSession(bars, { symbol: 'ZIG', interval: '1day', startIndex: 10 });
  assert.strictEqual(P.account(), 'replay', 'trades go through the replay account');
  assert.strictEqual(s.cursor, 11);
  let vis = s.visible();
  assert.strictEqual(vis.length, 11);
  assert.deepStrictEqual(vis.map(b => b.time), bars.slice(0, 11).map(b => b.time));
  assert.strictEqual(s.price(), bars[10].close);
  assert.strictEqual(s.currentTime(), bars[10].time);
  for (let i = 0; i < 5; i++) {
    const r = s.step();
    assert.strictEqual(r.bar.time, bars[11 + i].time);
    vis = s.visible();
    assert.strictEqual(vis.length, 12 + i);
    assert.strictEqual(vis[vis.length - 1].close, bars[11 + i].close);
    // nothing after the cursor is ever visible
    assert.ok(vis.every((b, k) => b.time === bars[k].time));
  }
  // visible() hands out copies of the engine's array; mutating it must not change the engine
  vis.push({ time: '2099-01-01', open: 1, high: 1, low: 1, close: 1 });
  assert.strictEqual(s.visible().length, 16);
  const prog = s.progress();
  assert.strictEqual(prog.total, 29);
  assert.strictEqual(prog.revealed, 5);
  s.destroy();
});

test('start by date picks the first bar on/after the date; startIndex is clamped so at least one bar remains hidden', () => {
  fresh();
  const bars = dailyBars(30, '2024-01-02');
  const s = R.createSession(bars, { start: '2024-01-13' }); // a Saturday → first bar is Tue 2024-01-16 (Mon 15th is MLK day)
  assert.strictEqual(bars[s.startIndex].time, '2024-01-16');
  assert.strictEqual(s.currentTime(), '2024-01-16');
  s.destroy();
  const s2 = R.createSession(bars, { startIndex: 999 });
  assert.strictEqual(s2.startIndex, 28);
  assert.strictEqual(s2.length, 30);
  s2.destroy();
  assert.throws(() => R.createSession([{ time: '2024-01-02', open: 1, high: 1, low: 1, close: 1 }]), /two bars/);
});

test('market orders fill at the visible price and are stamped with the bar time, not the wall clock', () => {
  fresh();
  const bars = dailyBars(20);
  const s = R.createSession(bars, { startIndex: 5, cash: 50000 });
  const o = s.buy(10);
  assert.strictEqual(o.status, 'filled');
  assert.strictEqual(o.fillPrice, bars[5].close);
  const st = P.getState();
  assert.strictEqual(st.cash, 50000 - 10 * bars[5].close);
  assert.strictEqual(st.positions.ZIG.qty, 10);
  const tr = st.trades[0];
  assert.strictEqual(tr.time, Date.parse(bars[5].time + 'T21:00:00Z'), 'trade time is the replayed bar\'s close, not now');
  assert.strictEqual(o.placedAt, tr.time);
  const snap = s.snapshot();
  assert.strictEqual(snap.position.qty, 10);
  assert.strictEqual(snap.position.side, 'long');
  near(snap.equity, 50000);
  s.step();
  const snap2 = s.snapshot();
  near(snap2.unrealized, 10 * (bars[6].close - bars[5].close));
  near(snap2.equity, 50000 + 10 * (bars[6].close - bars[5].close));
  assert.ok(s.log.some(e => e.kind === 'fill' && /Buy 10 ZIG/.test(e.text)), 'fill logged');
  s.destroy();
});

test('resting limit and stop orders are processed against each newly revealed bar via BT.paper.processOrders', () => {
  fresh();
  const bars = dailyBars(30);
  const s = R.createSession(bars, { startIndex: 3 });
  const px = s.price();
  // find the next bar whose low dips at least 1 below px: place a buy limit there
  const target = bars.slice(4).find(b => b.low <= px - 1);
  assert.ok(target, 'synthetic series must dip');
  const lim = s.buy(5, { type: 'limit', limitPrice: px - 1 });
  assert.strictEqual(lim.status, 'open', lim.reason);
  assert.strictEqual(s.openOrders().length, 1);
  let fills = [];
  s.on('fill', f => fills.push(f));
  while (!s.done && !fills.length) s.step();
  assert.strictEqual(fills.length, 1);
  assert.strictEqual(fills[0].order.id, lim.id);
  assert.strictEqual(s.currentTime(), target.time, 'filled on the first bar that reached the limit');
  assert.ok(fills[0].trade.price <= px - 1, 'limit buy never pays more than the limit');
  assert.strictEqual(s.openOrders().length, 0);
  // now a protective sell stop below the market
  const stopPx = s.price() - 2.5;
  const stop = s.sell(5, { type: 'stop', stopPrice: stopPx });
  assert.strictEqual(stop.status, 'open', stop.reason);
  fills = [];
  while (!s.done && !fills.length) s.step();
  assert.strictEqual(fills.length, 1);
  assert.strictEqual(fills[0].order.type, 'stop');
  assert.ok(fills[0].trade.price <= stopPx + 1e-9, 'stop fills at the stop or worse');
  assert.strictEqual(s.position(), null);
  const card = s.scorecard();
  assert.strictEqual(card.trades, 1);
  assert.strictEqual(card.limitsUsed, 1);
  assert.strictEqual(card.stopsUsed, 1);
  s.destroy();
});

test('intrabar ticks follow a seeded synthetic path: open → (high and low at unknown sub-steps) → close, deterministic per symbol+bar', () => {
  fresh();
  const up = { time: '2024-02-01', open: 100, high: 106, low: 97, close: 104, volume: 1000 };
  const dn = { time: '2024-02-02', open: 104, high: 107, low: 95, close: 96, volume: 1000 };
  for (const b of [up, dn]) {
    const ib = R.intrabar(b, 'ZIG');
    const p = ib.path;
    assert.strictEqual(p.length, ib.steps);
    assert.ok(p.length >= R.MIN_TICKS + 2 && p.length <= R.MAX_TICKS + 2, 'between 7 and 10 sub-steps, got ' + p.length);
    assert.strictEqual(p[0], b.open); assert.strictEqual(p[p.length - 1], b.close);
    assert.strictEqual(Math.max(...p), b.high); assert.strictEqual(Math.min(...p), b.low);
    assert.ok(p.every(x => x >= b.low && x <= b.high), 'every point inside the bar');
    assert.ok(p.indexOf(b.high) < p.length - 2 && p.indexOf(b.low) < p.length - 2, 'extremes sit at interior points, never the last one');
    assert.deepStrictEqual(R.tickPath(b, 'ZIG'), p, 'tickPath is the path');
    assert.deepStrictEqual(R.intrabar(b, 'ZIG'), ib, 'same bar + seed → same path');
    assert.strictEqual(ib.volume.length, ib.steps);
    assert.strictEqual(ib.volume[ib.steps - 1], 1);
    for (let i = 1; i < ib.volume.length; i++) assert.ok(ib.volume[i] > ib.volume[i - 1], 'volume share strictly increasing');
  }
  // different seeds (symbols) give different paths for the same bar
  const seeds = ['AAPL', 'MSFT', 'SPY', 'ZIG', 'TSLA'];
  const paths = seeds.map(sd => JSON.stringify(R.tickPath(up, sd)));
  assert.ok(new Set(paths).size >= 4, 'paths differ across seeds');
  // the old fixed convention (up bar visits its low first) must NOT hold systematically
  const bars = dailyBars(120);
  let lowFirst = 0, upBars = 0;
  for (const b of bars) { if (b.close < b.open) continue; upBars++; const p = R.tickPath(b, 'ZIG'); if (p.indexOf(b.low) < p.indexOf(b.high)) lowFirst++; }
  assert.ok(lowFirst > upBars * 0.2 && lowFirst < upBars * 0.8, 'low-first on ' + lowFirst + ' of ' + upBars + ' up bars: not a fixed order');

  // partial bars: open only, then a running range that never leaves the real bar, then the full bar
  const ib = R.intrabar(up, 'ZIG');
  const p1 = R.partialBar(up, 1, 'ZIG');
  assert.deepStrictEqual([p1.open, p1.high, p1.low, p1.close], [100, 100, 100, 100]);
  assert.strictEqual(p1.phases, ib.steps);
  for (let ph = 2; ph < ib.steps; ph++) {
    const pb = R.partialBar(up, ph, 'ZIG');
    assert.ok(pb.partial && pb.phase === ph);
    assert.strictEqual(pb.close, ib.path[ph - 1]);
    assert.ok(pb.high <= up.high && pb.low >= up.low && pb.high >= pb.close && pb.low <= pb.close);
    assert.ok(pb.volume <= up.volume && pb.volume >= 0);
  }
  const full = R.partialBar(up, ib.steps, 'ZIG');
  assert.strictEqual(full.partial, undefined);
  assert.deepStrictEqual(full, Object.assign({}, up));

  // in a session: step() walks the path, every partial bar stays inside the real bar, the segment fills a stop at the stop price
  const sess = [{ time: '2024-01-31', open: 99, high: 101, low: 98, close: 100, volume: 500 }, up, dn];
  const s = R.createSession(sess, { startIndex: 0, ticks: true, symbol: 'ZIG' });
  assert.strictEqual(s.ticks, true);
  s.buy(10);                                  // long 10 @ 100
  const stop = s.sell(10, { type: 'stop', stopPrice: 98 });
  assert.strictEqual(stop.status, 'open', stop.reason);
  let r = s.step();                           // phase 1: the open
  assert.strictEqual(r.partial, true); assert.strictEqual(r.phase, 1); assert.strictEqual(r.phases, ib.steps);
  assert.strictEqual(s.price(), 100); assert.strictEqual(s.visible().length, 2); assert.strictEqual(s.visible()[1].high, 100);
  assert.strictEqual(s.phaseLabel(), 'bar forming');
  let filled = null, lastPx = 100, phases = 1;
  while (s.phase !== 0) {
    r = s.step(); phases++;
    const vis = s.visible();
    if (s.phase !== 0) {
      const pb = vis[1];
      assert.ok(pb.partial && pb.high <= up.high && pb.low >= up.low, 'partial inside the bar');
      assert.strictEqual(pb.close, s.price());
    }
    if (r.fills.length) { filled = r.fills[0]; assert.ok(lastPx > 98 && s.price() <= 98, 'filled on the segment that crossed the stop'); }
    lastPx = s.price();
  }
  assert.strictEqual(phases, ib.steps, 'one step per sub-step, the last completes the bar');
  assert.ok(filled, 'the stop at 98 fills somewhere inside a 97..106 bar');
  assert.strictEqual(filled.trade.price, 98, 'inside the bar, price moves through the stop: filled at the stop');
  assert.strictEqual(s.position(), null);
  assert.strictEqual(s.cursor, 2); assert.strictEqual(s.phaseLabel(), '');
  assert.deepStrictEqual(s.visible()[1], Object.assign({}, up));
  const prog = s.progress(); assert.strictEqual(prog.revealed, 1);
  s.stepBar();
  assert.strictEqual(s.done, true, 'session ends after the last bar completes');
  s.destroy();
});

test('[tick leak] a forming bar reveals neither its close direction nor whether the price is a final extreme (no 100 %-win strategy)', () => {
  fresh();
  // The old fixed path (open → low → high → close for an up bar) let this strategy win every bar:
  // after the 2nd sub-step buy when price < open, short when price > open, flatten at the close.
  const bars = D.demo('AAPL', '1day', 400, Date.UTC(2024, 5, 28, 21));
  const s = R.createSession(bars, { symbol: 'AAPL', interval: '1day', startIndex: 60, cash: 100000, ticks: true });
  const all = s._all();
  let wins = 0, losses = 0, traded = 0, atExtreme = 0, phase2Loss = false;
  while (!s.done) {
    s.step(); if (s.done) break;
    s.step(); if (s.done) break;                       // phase 2: first interior point
    const bar = all[s.cursor], p2 = s.price(), open = s.currentBar().open;
    let side = null;
    if (p2 < open) { s.buy(100); side = 1; if (p2 === bar.low) atExtreme++; }
    else if (p2 > open) { s.short(100); side = -1; if (p2 === bar.high) atExtreme++; }
    s.stepBar();                                       // complete the bar
    if (side) {
      traded++;
      const pnl = side * (s.price() - p2);
      s.closePosition();
      if (pnl > 0) wins++; else if (pnl < 0) { losses++; if (side === 1) phase2Loss = true; }
    }
  }
  const c = s.scorecard();
  assert.ok(traded > 250, 'traded ' + traded + ' bars');
  assert.ok(losses >= traded * 0.15, 'losses ' + losses + ' of ' + traded + ' — a forming bar must be able to go against you');
  assert.ok(c.winRate < 85, 'win rate ' + c.winRate + ' % is far below 100 %');
  assert.ok(phase2Loss, 'a buy at phase 2 can lose by the close');
  assert.ok(atExtreme < traded * 0.5, 'the price after the 2nd sub-step is usually NOT a final extreme (' + atExtreme + ' of ' + traded + ')');
  assert.ok(/synthetic/i.test(R.HONESTY) && /seeded/i.test(R.HONESTY), 'HONESTY says the intrabar path is synthetic');
  s.destroy();
});

test('[volume leak] a forming bar\'s volume is not a fixed fraction of the final volume', () => {
  const bars = D.demo('MSFT', '1day', 100, Date.UTC(2024, 5, 28, 21));
  let recoverable = 0; const fractions = new Set();
  for (const b of bars) {
    const p1 = R.partialBar(b, 1, 'MSFT');
    fractions.add((p1.volume / b.volume).toFixed(3));
    if (Math.abs(p1.volume / 0.15 - b.volume) <= 4) recoverable++;
    for (let ph = 1; ph < R.intrabar(b, 'MSFT').steps; ph++) { const pb = R.partialBar(b, ph, 'MSFT'); assert.ok(pb.volume > 0 && pb.volume < b.volume); }
  }
  assert.ok(recoverable < 3, 'final volume recoverable from phase-1 volume on ' + recoverable + ' bars');
  assert.ok(fractions.size > 40, 'phase-1 volume share varies across bars (' + fractions.size + ' distinct)');
});

test('a gap below a stop fills at the open when ticking (stops do not guarantee a price)', () => {
  fresh();
  const bars = [
    { time: '2024-03-01', open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { time: '2024-03-04', open: 90, high: 92, low: 88, close: 91, volume: 1 },
    { time: '2024-03-05', open: 91, high: 93, low: 90, close: 92, volume: 1 }
  ];
  const s = R.createSession(bars, { startIndex: 0, ticks: true });
  s.buy(10);
  s.sell(10, { type: 'stop', stopPrice: 95 });
  const r = s.step();
  assert.strictEqual(r.fills.length, 1);
  assert.strictEqual(r.fills[0].trade.price, 90, 'gapped through the stop: filled at the open');
  assert.ok(/gapped/i.test(r.fills[0].order.reason), r.fills[0].order.reason);
  s.destroy();
});

test('play() steps on a timer at BASE/speed, pause() stops it, setSpeed() snaps to the allowed speeds', () => {
  fresh();
  const bars = dailyBars(30);
  const timers = fakeTimers();
  const s = R.createSession(bars, { startIndex: 2, timers });
  const events = [];
  s.on('play', () => events.push('play')); s.on('pause', () => events.push('pause')); s.on('step', () => events.push('step'));
  assert.strictEqual(s.play(5), true);
  assert.strictEqual(s.playing, true);
  const h = Object.values(timers.handlers)[0];
  assert.strictEqual(h.ms, 200);
  timers.tick(); timers.tick(); timers.tick();
  assert.strictEqual(s.cursor, 6);
  assert.strictEqual(s.setSpeed(7), 5, 'snaps to the nearest allowed speed');
  assert.strictEqual(s.setSpeed(20), 20);
  assert.strictEqual(Object.values(timers.handlers)[0].ms, 50);
  s.pause();
  assert.strictEqual(s.playing, false);
  assert.deepStrictEqual(Object.keys(timers.handlers), []);
  timers.tick();
  assert.strictEqual(s.cursor, 6, 'no steps after pause');
  assert.deepStrictEqual(events.filter(e => e !== 'step'), ['play', 'pause']);
  // playing to the end pauses itself and fires 'end'
  let ended = null; s.on('end', c => ended = c);
  s.play(20);
  for (let i = 0; i < 100 && !s.done; i++) timers.tick();
  assert.strictEqual(s.done, true);
  assert.ok(ended && ended.symbol === 'ZIG');
  assert.strictEqual(s.playing, false);
  assert.strictEqual(s.step(), ended, 'stepping after the end just returns the scorecard');
  s.destroy();
});

test('jumpTo(date) fast-forwards bar by bar (orders still fill on the way) and jumpToEnd() finishes the session', () => {
  fresh();
  const bars = dailyBars(60);
  const s = R.createSession(bars, { startIndex: 5 });
  const px = s.price();
  const lim = s.buy(3, { type: 'limit', limitPrice: px - 1 });
  assert.strictEqual(lim.status, 'open');
  const target = bars[20].time;
  const cur = s.jumpTo(target);
  assert.strictEqual(cur.time, target);
  assert.strictEqual(s.cursor, 21);
  assert.strictEqual(P.getState().positions.ZIG.qty, 3, 'the resting limit filled during the jump');
  assert.strictEqual(s.visible().length, 21);
  // jumping to a date before the cursor does nothing
  s.jumpTo(bars[2].time);
  assert.strictEqual(s.cursor, 21);
  // index form
  s.jumpTo(30);
  assert.strictEqual(s.cursor, 31);
  const card = s.jumpToEnd();
  assert.strictEqual(s.done, true);
  assert.strictEqual(card.completed, true);
  assert.strictEqual(card.barsRevealed, card.bars);
  assert.ok(card.openPosition && card.openPosition.qty === 3);
  s.destroy();
});

test('scorecard: return vs buy-and-hold, trade stats, drawdown, counters; orders after the end are refused', () => {
  fresh();
  const bars = dailyBars(40);
  const s = R.createSession(bars, { startIndex: 5, cash: 10000 });
  const first = bars[5].close, last = bars[39].close;
  s.buy(20);                     // hold through most of the session
  s.jumpTo(bars[30].time);
  s.closePosition();
  s.short(10);
  s.jumpToEnd();
  const c = s.scorecard();
  near(c.buyHoldPct, Math.round((last / first - 1) * 100 * 100) / 100, 1e-9);
  near(c.alphaPct, c.returnPct - c.buyHoldPct, 1e-6);
  assert.strictEqual(c.symbol, 'ZIG');
  assert.strictEqual(c.start, bars[5].time);
  assert.strictEqual(c.end, bars[39].time);
  assert.strictEqual(c.trades, 1, 'one closed round trip');
  assert.strictEqual(c.fills, 3);
  assert.strictEqual(c.shortsOpened, 1);
  assert.ok(c.openPosition && c.openPosition.qty === -10);
  assert.ok(isFinite(c.maxDrawdownPct) && c.maxDrawdownPct >= 0);
  near(c.equity, c.startingCash + c.pnl, 1e-6);
  const st = P.stats();
  near(c.returnPct, Math.round(st.totalReturnPct * 100) / 100, 1e-9);
  const dead = s.buy(1);
  assert.strictEqual(dead.status, 'rejected');
  assert.ok(/finished/.test(dead.reason));
  assert.strictEqual(s.closePosition(), null);
  s.destroy();
});

test('evaluateDrill grades every criterion type with readable text', () => {
  const card = { trades: 3, returnPct: 4.5, buyHoldPct: 2, alphaPct: 2.5, maxDrawdownPct: 8, winRate: 66.67, profitFactor: 2.1, wins: 2, losses: 1, openPosition: null, stopsUsed: 2, limitsUsed: 0, shortsOpened: 0 };
  const drill = { criteria: [
    { type: 'min_trades', value: 2 }, { type: 'max_trades', value: 3 }, { type: 'min_return_pct', value: 5 }, { type: 'positive_return' },
    { type: 'beat_buy_hold' }, { type: 'max_drawdown_pct', value: 10 }, { type: 'min_win_rate_pct', value: 60 }, { type: 'min_profit_factor', value: 1.5 },
    { type: 'flat_at_end' }, { type: 'used_stop', value: 2 }, { type: 'used_limit' }, { type: 'used_short' }, { type: 'no_short', text: 'Long only please' }, { type: 'made_up' }
  ] };
  const res = R.evaluateDrill(drill, card);
  assert.strictEqual(res.length, 13, 'unknown criteria are ignored');
  const byType = Object.fromEntries(res.map(r => [r.type, r]));
  assert.strictEqual(byType.min_trades.pass, true);
  assert.strictEqual(byType.max_trades.pass, true);
  assert.strictEqual(byType.min_return_pct.pass, false);
  assert.strictEqual(byType.positive_return.pass, true);
  assert.strictEqual(byType.beat_buy_hold.pass, true);
  assert.strictEqual(byType.max_drawdown_pct.pass, true);
  assert.strictEqual(byType.min_win_rate_pct.pass, true);
  assert.strictEqual(byType.min_profit_factor.pass, true);
  assert.strictEqual(byType.flat_at_end.pass, true);
  assert.strictEqual(byType.used_stop.pass, true);
  assert.strictEqual(byType.used_limit.pass, false);
  assert.strictEqual(byType.used_short.pass, false);
  assert.strictEqual(byType.no_short.pass, true);
  assert.strictEqual(byType.no_short.text, 'Long only please');
  res.forEach(r => { assert.ok(r.text.length > 10, r.type + ' text'); assert.ok(typeof r.actualText === 'string', r.type + ' actualText'); });
  // no losing trades → profit factor undefined but passes when there are wins
  const r2 = R.evaluateDrill({ criteria: [{ type: 'min_profit_factor', value: 2 }] }, Object.assign({}, card, { profitFactor: null, wins: 1, losses: 0 }));
  assert.strictEqual(r2[0].pass, true);
});

test('a session with a drill grades it in the scorecard; passed only when every criterion passes', () => {
  fresh();
  const bars = dailyBars(30);
  const drill = { id: 'd1', title: 'Test drill', criteria: [{ type: 'min_trades', value: 1 }, { type: 'flat_at_end' }, { type: 'no_short' }] };
  const s = R.createSession(bars, { startIndex: 3, drill });
  s.buy(5); s.step(); s.step(); s.closePosition();
  const c = s.jumpToEnd();
  assert.strictEqual(c.drill.id, 'd1');
  assert.strictEqual(c.drill.results.length, 4, 'criteria plus the "reveal the whole session" requirement');
  assert.strictEqual(c.drill.results[0].type, 'completed');
  assert.strictEqual(c.drill.results[0].pass, true);
  assert.strictEqual(c.drill.passed, true);
  s.destroy();
  const s2 = R.createSession(bars, { startIndex: 3, drill });
  s2.buy(5);
  const c2 = s2.jumpToEnd();
  assert.strictEqual(c2.drill.passed, false);
  assert.deepStrictEqual(c2.drill.results.map(r => r.pass), [true, false, false, true]);
  s2.destroy();
});

test('[early end] pressing End before the last bar can never pass a drill, and the saved history row says so', () => {
  fresh();
  const drill = R.setDrills([{ id: 'bear', title: 'Bear market survival', symbol: 'META', interval: '1day', start: '2022-01-03', end: '2022-12-30',
    criteria: [{ type: 'max_drawdown_pct', value: 10 }, { type: 'beat_buy_hold' }, { type: 'used_stop' }] }])[0];
  const bars = D.demo('META', '1day', 400, Date.UTC(2022, 11, 30, 21));
  const s = R.createSession(bars, { symbol: 'META', interval: '1day', startIndex: 60, drill });
  s.buy(100); s.sell(100, { type: 'stop', stopPrice: Math.round(s.price() * 0.9 * 100) / 100 });
  // cherry-pick: go flat the moment we are ahead, wait until buy-and-hold is behind us, then End
  let i = 0;
  while (!s.done && i++ < 200) { s.step(); const sn = s.snapshot(); const bh = (s.price() / bars[s.startIndex].close - 1) * 100; if (sn.pnlPct > bh + 0.01 && sn.pnlPct > 0) break; }
  s.closePosition();
  while (!s.done) { const bh = (s.price() / bars[s.startIndex].close - 1) * 100; if (s.snapshot().pnlPct > bh) break; s.step(); }
  const card = s.finish();
  assert.strictEqual(card.completed, false);
  assert.ok(card.barsRevealed < card.bars);
  const crit = card.drill.results.slice(1);
  assert.ok(crit.every(r => r.pass), 'every ordinary criterion passes: ' + crit.map(r => r.type + ':' + r.pass).join(','));
  assert.strictEqual(card.drill.results[0].type, 'completed');
  assert.strictEqual(card.drill.results[0].pass, false);
  assert.ok(/ended early/.test(card.drill.results[0].actualText));
  assert.strictEqual(card.drill.passed, false, 'ended early → not passed');
  assert.strictEqual(card.drill.completed, false);
  const saved = R.saveSession(card);
  assert.strictEqual(saved.drill.passed, false); assert.strictEqual(saved.completed, false);
  assert.ok(/not passed/.test(R.summaryText(card)));
  s.destroy();
  R.setDrills([]);
});

test('[stale main] starting a replay never writes this tab\'s stale copy of the main portfolio back to storage', () => {
  fresh();
  // this tab (replay.html) loaded 'main' as a fresh account; "another tab" then trades on main in shared storage
  P.use('main');
  const otherTab = JSON.parse(JSON.stringify(P.getState()));
  otherTab.cash = 85000; otherTab.positions = { AAPL: { qty: 100, avg: 150, kind: 'stock', meta: {} } }; otherTab.marks = { AAPL: 150 };
  localStorage.setItem(P.STORAGE_KEY, JSON.stringify(otherTab));
  assert.deepStrictEqual(P.getState().positions, {}, 'in-memory main is stale');
  const s = R.createSession(dailyBars(20), { startIndex: 5 });
  let stored = JSON.parse(localStorage.getItem(P.STORAGE_KEY));
  assert.strictEqual(stored.positions.AAPL.qty, 100, 'the other tab\'s position survives createSession()');
  assert.strictEqual(stored.cash, 85000);
  s.buy(5); s.step(); s.destroy();
  stored = JSON.parse(localStorage.getItem(P.STORAGE_KEY));
  assert.strictEqual(stored.positions.AAPL.qty, 100, 'and survives destroy()');
  assert.strictEqual(P.account(), 'main');
  assert.strictEqual(P.getState().positions.AAPL.qty, 100, 'this tab now sees the fresh main state');
  assert.strictEqual(P.getState().positions.ZIG, undefined, 'replay trades stayed in the replay account');
});

test('[bracket / OCO] a protective stop and a take-profit on the same position never both fill', () => {
  fresh();
  function wideBars() {
    const bars = []; let d = 1;
    const mk = (o, h, l, c) => ({ time: '2024-01-' + String(d++).padStart(2, '0'), open: o, high: h, low: l, close: c, volume: 1000 });
    for (let i = 0; i < 5; i++) bars.push(mk(100, 101, 99, 100));
    bars.push(mk(100, 112, 88, 100));        // reaches both the stop (95) and the target (105)
    bars.push(mk(100, 101, 99, 100));
    return bars;
  }
  for (const ticks of [false, true]) {
    const s = R.createSession(wideBars(), { symbol: 'T', interval: '1day', startIndex: 4, ticks });
    s.buy(100);
    const stop = s.sell(100, { type: 'stop', stopPrice: 95 });
    const target = s.sell(100, { type: 'limit', limitPrice: 105 });
    assert.strictEqual(stop.reduceOnly, true, 'an exit order is flagged reduce-only');
    assert.strictEqual(target.reduceOnly, true);
    s.stepBar();
    assert.strictEqual(s.position(), null, 'ticks=' + ticks + ': flat, not short');
    const exits = s.trades().slice(1);
    assert.strictEqual(exits.length, 1, 'ticks=' + ticks + ': exactly one exit fill');
    assert.strictEqual(exits[0].qty, 100);
    assert.ok(exits[0].price === 95 || exits[0].price === 105);
    assert.strictEqual(s.openOrders().length, 0, 'the sibling was cancelled');
    const cancelled = P.getState().orders.find(o => o.status === 'cancelled');
    assert.ok(cancelled && /OCO/.test(cancelled.reason), 'cancel reason explains OCO: ' + (cancelled && cancelled.reason));
    assert.ok(s.log.some(e => e.oco), 'logged');
    const c = s.scorecard();
    assert.strictEqual(c.trades, 1); assert.strictEqual(c.fills, 2); assert.strictEqual(c.ocoCancels, 1);
    s.destroy();
  }
  // a bracket placed while flat (entry + stop + target all reached in one bar) ends flat too
  const s2 = R.createSession(wideBars(), { symbol: 'T', interval: '1day', startIndex: 4 });
  s2.buy(100, { type: 'limit', limitPrice: 98 }); s2.sell(100, { type: 'stop', stopPrice: 95 }); s2.sell(100, { type: 'limit', limitPrice: 105 });
  s2.stepBar();
  assert.strictEqual(s2.position(), null);
  assert.deepStrictEqual(s2.trades().map(t => t.side + t.qty), ['buy100', 'sell100']);
  assert.strictEqual(s2.openOrders().length, 0);
  s2.destroy();
  // partial exits are clamped to what is left (60 + 60 on a long of 100 → 60 + 40)
  const s3 = R.createSession(wideBars(), { symbol: 'T', interval: '1day', startIndex: 4 });
  s3.buy(100); s3.sell(60, { type: 'stop', stopPrice: 95 }); s3.sell(60, { type: 'limit', limitPrice: 105 });
  s3.stepBar();
  assert.strictEqual(s3.position(), null);
  assert.deepStrictEqual(s3.trades().slice(1).map(t => t.qty).sort(), [40, 60]);
  s3.destroy();
  // a deliberate stop-and-reverse (bigger than the position) is still allowed
  const s4 = R.createSession(wideBars(), { symbol: 'T', interval: '1day', startIndex: 4 });
  s4.buy(100); const rev = s4.sell(200, { type: 'stop', stopPrice: 95 });
  assert.ok(!rev.reduceOnly);
  s4.stepBar();
  assert.strictEqual(s4.position().qty, -100);
  s4.destroy();
  // closing by hand cancels the protective orders instead of leaving them to open a short later
  const s5 = R.createSession(wideBars(), { symbol: 'T', interval: '1day', startIndex: 4 });
  s5.buy(100); s5.sell(100, { type: 'stop', stopPrice: 95 }); s5.closePosition();
  assert.strictEqual(s5.openOrders().length, 0);
  s5.stepBar();
  assert.strictEqual(s5.position(), null);
  s5.destroy();
});

test('saveSession appends a summary to bt.replay.sessions (deduped by id, capped at 100)', () => {
  fresh();
  const bars = dailyBars(12);
  const s = R.createSession(bars, { startIndex: 2 });
  const c = s.jumpToEnd();
  assert.deepStrictEqual(R.sessions(), []);
  const sum = R.saveSession(c);
  R.saveSession(c);
  const list = JSON.parse(localStorage.getItem('bt.replay.sessions'));
  assert.strictEqual(list.length, 1, 'same card saved twice is one entry');
  assert.strictEqual(list[0].id, c.id);
  assert.strictEqual(list[0].symbol, 'ZIG');
  assert.strictEqual(list[0].returnPct, c.returnPct);
  assert.strictEqual(list[0].buyHoldPct, c.buyHoldPct);
  assert.strictEqual(sum.trades, 0);
  for (let i = 0; i < 120; i++) R.saveSession(Object.assign({}, c, { id: 'x' + i }));
  assert.strictEqual(R.sessions().length, 100);
  R.clearSessions();
  assert.deepStrictEqual(R.sessions(), []);
  s.destroy();
});

test('saveToJournal writes a journal-shaped entry to bt.journal and respects an existing array or {entries} shape', () => {
  fresh();
  const bars = dailyBars(15);
  const s = R.createSession(bars, { startIndex: 2, drill: { id: 'd9', title: 'Journal drill', criteria: [{ type: 'min_trades', value: 1 }] } });
  s.buy(4); s.step(); s.closePosition();
  const c = s.jumpToEnd();
  const e = R.saveToJournal(c, { rating: 4, confidence: 2, emotion: 'calm', lessons: 'Waited for the close.', tags: ['practice'] });
  const j = JSON.parse(localStorage.getItem('bt.journal'));
  assert.ok(Array.isArray(j) && j.length === 1, 'fresh journal is an array of entries');
  ['id', 'symbol', 'date', 'setup', 'tags', 'emotion', 'confidence', 'notes', 'lessons', 'rating'].forEach(k => assert.ok(k in j[0], 'entry has ' + k));
  assert.strictEqual(j[0].tradeId, null);
  assert.strictEqual(j[0].symbol, 'ZIG');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(j[0].date));
  assert.strictEqual(j[0].setup, 'Replay drill: Journal drill');
  assert.ok(j[0].tags.includes('replay') && j[0].tags.includes('drill:d9') && j[0].tags.includes('practice'));
  assert.strictEqual(j[0].rating, 4); assert.strictEqual(j[0].confidence, 2); assert.strictEqual(j[0].emotion, 'calm');
  assert.ok(/buy-and-hold/.test(j[0].notes) && /Drill "Journal drill": passed/.test(j[0].notes));
  assert.strictEqual(j[0].lessons, 'Waited for the close.');
  assert.strictEqual(j[0].source, 'replay');
  assert.strictEqual(j[0].replay.trades, 1);
  // saving the same session twice replaces the entry
  R.saveToJournal(c, { rating: 5 });
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.journal')).length, 1);
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.journal'))[0].rating, 5);
  // an object-shaped journal is preserved
  localStorage.setItem('bt.journal', JSON.stringify({ version: 1, entries: [{ id: 'm1', symbol: 'AAPL' }] }));
  R.saveToJournal(Object.assign({}, c, { id: 'other' }), {});
  const j2 = JSON.parse(localStorage.getItem('bt.journal'));
  assert.strictEqual(j2.version, 1);
  assert.strictEqual(j2.entries.length, 2);
  assert.strictEqual(j2.entries[1].id, 'jr-other');
  // ratings outside 1-5 fall back to a default
  assert.strictEqual(R.toJournalEntry(c, { rating: 9 }).rating, c.returnPct > 0 ? 4 : 2);
  s.destroy();
});

test('destroy() restores the paper clock and the previous account; the main account was never touched', () => {
  fresh();
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 100);
  const bars = dailyBars(10);
  const s = R.createSession(bars, { startIndex: 1 });
  s.buy(2); s.step();
  assert.strictEqual(P.account(), 'replay');
  s.destroy();
  assert.strictEqual(s.destroyed, true);
  assert.strictEqual(P.account(), 'main');
  assert.strictEqual(P.getState().positions.AAPL.qty, 1);
  assert.strictEqual(P.getState().positions.ZIG, undefined);
  const main = JSON.parse(localStorage.getItem('bt.portfolio'));
  assert.strictEqual(main.positions.ZIG, undefined);
  const rep = JSON.parse(localStorage.getItem('bt.portfolio.replay'));
  assert.strictEqual(rep.positions.ZIG.qty, 2);
  const accts = P.accounts().map(a => a.id);
  assert.ok(accts.includes('main') && accts.includes('replay'));
  // paper clock is back on the wall clock
  const before = Date.now();
  P.use('main');
  const o = P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 1, type: 'market' }, 10);
  assert.ok(o.placedAt >= before - 5, 'placedAt uses the real clock after destroy');
  assert.strictEqual(s.step(), null);
});

test('barBudget / defaultEnd size a session for each interval', () => {
  const b = R.barBudget('1day', '2024-01-02', '2024-12-31');
  assert.strictEqual(b.days, 252);
  assert.strictEqual(b.limit, 252 + R.WARMUP);
  assert.strictEqual(b.truncated, false);
  const i5 = R.barBudget('5min', '2024-01-02', '2024-12-31');
  assert.strictEqual(i5.per, 78);
  assert.strictEqual(i5.truncated, true);
  assert.strictEqual(i5.limit, R.MAX_LIMIT);
  assert.strictEqual(R.defaultEnd('2024-03-15', '5min'), '2024-03-18');
  assert.strictEqual(R.defaultEnd('2024-03-15', '1min'), '2024-03-15');
  assert.strictEqual(R.defaultEnd('2024-03-16', '1day') > '2024-09-01', true);
});

test('loadBars (demo) returns bars ending on the end date with warm-up history before startIndex', async () => {
  fresh();
  const r = await R.loadBars({ symbol: 'msft', interval: '1day', start: '2024-01-02', end: '2024-12-31' });
  assert.strictEqual(r.symbol, 'MSFT');
  assert.strictEqual(r.source, 'demo');
  assert.strictEqual(r.bars[r.bars.length - 1].time, '2024-12-31');
  assert.strictEqual(r.bars[r.startIndex].time, '2024-01-02');
  assert.strictEqual(r.startIndex, R.WARMUP, 'exactly WARMUP bars of history are revealed before the start');
  assert.strictEqual(r.bars.length - r.startIndex, 252);
  assert.strictEqual(r.note, null);
  // deterministic: the same request yields the same bars
  const r2 = await R.loadBars({ symbol: 'MSFT', interval: '1day', start: '2024-01-02', end: '2024-12-31' });
  assert.deepStrictEqual(r2.bars[r2.startIndex + 10], r.bars[r.startIndex + 10]);
  // intraday single session
  const i = await R.loadBars({ symbol: 'AAPL', interval: '5min', start: '2024-03-15', end: '2024-03-15' });
  assert.strictEqual(i.bars.length - i.startIndex, 78, 'one full session of 5-minute bars after the start');
  assert.ok(typeof i.bars[i.startIndex].time === 'number');
  assert.strictEqual(R.barDay(i.bars[i.startIndex].time), '2024-03-15');
  assert.strictEqual(R.barDay(i.bars[i.startIndex - 1].time), '2024-03-14', 'warm-up comes from the previous session');
  // a session whose end precedes its start is repaired; a weekend start moves to the next trading day
  const w = await R.loadBars({ symbol: 'SPY', interval: '1day', start: '2024-06-01', end: '2024-05-01' });
  assert.strictEqual(w.bars[w.startIndex].time, '2024-06-03');
  assert.ok(w.bars.length - w.startIndex >= 2);
  // the end date never passes today
  const t = await R.loadBars({ symbol: 'SPY', interval: '1day', start: '2024-11-01', end: '2999-01-01' });
  assert.ok(t.end <= new Date().toISOString().slice(0, 10));
});

test('every drill in course/drills.json is well-formed and its bars load from demo data', async () => {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'course', 'drills.json'), 'utf8'));
  assert.ok(Array.isArray(json.drills) && json.drills.length >= 8, 'at least 8 drills');
  const ids = new Set();
  const list = R.setDrills(json.drills);
  assert.strictEqual(list.length, json.drills.length);
  for (const d of json.drills) {
    assert.ok(d.id && !ids.has(d.id), 'unique id ' + d.id); ids.add(d.id);
    assert.ok(d.title && d.symbol && d.interval && d.start && d.end, d.id + ' has symbol/interval/dates');
    assert.ok(D.INTERVALS.includes(d.interval), d.id + ' interval');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d.start) && /^\d{4}-\d{2}-\d{2}$/.test(d.end) && d.start <= d.end, d.id + ' dates');
    assert.ok(d.start >= '2000-01-03' && d.end <= '2026-11-12', d.id + ' within the demo range');
    assert.ok(D.lookup(d.symbol), d.id + ' symbol is in the demo universe');
    assert.ok(typeof d.objective === 'string' && d.objective.length > 80, d.id + ' objective');
    assert.ok(Array.isArray(d.hints) && d.hints.length >= 3, d.id + ' hints');
    assert.ok(Array.isArray(d.criteria) && d.criteria.length >= 2, d.id + ' criteria');
    const r = await R.loadBars({ symbol: d.symbol, interval: d.interval, start: d.start, end: d.end });
    assert.ok(r.bars.length - r.startIndex >= 20, d.id + ' has enough bars: ' + (r.bars.length - r.startIndex));
    assert.ok(!r.truncated, d.id + ' is not truncated');
    // grading works on a real session for this drill
    const s = R.createSession(r.bars, { symbol: d.symbol, interval: d.interval, startIndex: r.startIndex, drill: R.getDrill(d.id), ticks: !!d.ticks });
    s.buy(1); s.stepBar(); s.closePosition();
    const c = s.jumpToEnd();
    assert.strictEqual(c.drill.results.length, d.criteria.length + 1, d.id + ' grades every criterion plus completion');
    assert.strictEqual(c.drill.results[0].type, 'completed');
    assert.ok(typeof c.drill.passed === 'boolean');
    s.destroy();
  }
  assert.strictEqual(R.getDrill('sma-cross-msft-2024').symbol, 'MSFT');
  assert.strictEqual(R.getDrill('nope'), null);
});

(async () => {
  for (const run of pending) await run();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
