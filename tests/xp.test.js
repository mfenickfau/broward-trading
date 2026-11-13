/* Broward Trading — tests for js/xp.js (BT.xp) and course/personality.json
 * Run with:  node tests/xp.test.js
 * Plain node + assert. `window` and `localStorage` are shimmed; the stores are written
 * in the real shapes produced by js/course.js, js/paper.js, js/replay.js, js/journal.js,
 * js/alerts.js, js/glossary.js, js/leagues.js and js/screener.js.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); },
  key(i) { return Object.keys(store)[i] == null ? null : Object.keys(store)[i]; },
  get length() { return Object.keys(store).length; }
};
const events = [];
global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent(e) { events.push(e); return true; }, CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; } };
global.fetch = async () => { throw new TypeError('Failed to fetch'); };
require(path.join(ROOT, 'js', 'xp.js'));
const X = window.BT.xp;

const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'index.json'), 'utf8'));
const lessonIds = new Set(); const moduleIds = new Set();
for (const m of INDEX.modules) { moduleIds.add(m.id); for (const l of m.lessons) lessonIds.add(l.id); }
const drillsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'drills.json'), 'utf8'));
const drillIds = new Set((Array.isArray(drillsJson) ? drillsJson : drillsJson.drills).map(d => d.id));
const PERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'personality.json'), 'utf8'));
const PERS_ES = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'es', 'personality.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const NOW = new Date(2026, 10, 13, 15, 0, 0).getTime();   // local 2026-11-13 15:00
function fresh() { localStorage.clear(); events.length = 0; X.setClock(() => NOW); }
function set(k, v) { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
function get(k) { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); }
const day = n => NOW - n * 864e5;

console.log('BT.xp tests (v0.5)');

/* ---------------- catalogues ---------------- */
test('XP event values match the contract', () => {
  const want = { lesson: 20, quiz: 30, quizPerfect: 10, drill: 25, journal: 10, firstTrade: 15, alert: 5, flashcards: 10, streakDay: 5, league: 50 };
  for (const k of Object.keys(want)) assert.strictEqual(X.EVENTS[k].xp, want[k], k);
});
test('level ladder: names and thresholds', () => {
  assert.deepStrictEqual(X.LEVELS.map(l => [l.name, l.min]), [['Freshman', 0], ['Sophomore', 200], ['Junior', 500], ['Senior', 1000], ['Graduate', 1800], ['Analyst', 3000], ['Portfolio Manager', 5000]]);
  assert.strictEqual(X.levelFor(0).name, 'Freshman');
  assert.strictEqual(X.levelFor(199).name, 'Freshman');
  assert.strictEqual(X.levelFor(200).name, 'Sophomore');
  assert.strictEqual(X.levelFor(350).pct, 50);
  assert.strictEqual(X.levelFor(350).toNext, 150);
  const top = X.levelFor(99999);
  assert.strictEqual(top.name, 'Portfolio Manager'); assert.strictEqual(top.next, null); assert.strictEqual(top.pct, 100);
  assert.strictEqual(X.levelFor(-5).xp, 0); assert.strictEqual(X.levelFor(NaN).name, 'Freshman');
});
test('at least 20 badges, unique ids, every contract badge present, criteria written', () => {
  assert.ok(X.BADGES.length >= 20);
  const ids = X.BADGES.map(b => b.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  const names = X.BADGES.map(b => b.name);
  for (const n of ['First Fill', 'Risk Manager', 'Journal Keeper', 'Replay Rookie', 'Replay Pro', 'Bilingual', 'Options Explorer', 'Backtester', 'Screener Scout', 'Rule Maker', 'League Finisher', 'Streak 7', 'Streak 30', 'Certificate']) assert.ok(names.includes(n), n);
  for (const b of X.BADGES) { assert.ok(b.criteria.length > 10 && /\.$/.test(b.criteria), b.id + ' criteria'); assert.ok(X.BADGE_GROUPS[b.group], b.id + ' group'); }
});
test('every badge and level has a Spanish string in the module fallback', () => {
  for (const b of X.BADGES) { assert.ok(X.ES[b.name], 'es name ' + b.name); assert.ok(X.ES[b.criteria], 'es criteria ' + b.id); }
  for (const l of X.LEVELS) assert.ok(X.ES[l.name], 'es level ' + l.name);
  for (const k of Object.keys(X.EVENTS)) assert.ok(X.ES[X.EVENTS[k].label], 'es event ' + k);
});

/* ---------------- empty / corrupt stores ---------------- */
test('empty storage: recompute gives 0 XP, Freshman, no badges', () => {
  fresh();
  const r = X.recompute({ toast: false });
  assert.strictEqual(r.total, 0); assert.strictEqual(r.gained, 0);
  assert.strictEqual(X.summary().level.name, 'Freshman');
  assert.strictEqual(X.badges().filter(b => b.earned).length, 0);
});
test('corrupt and wrong-typed keys never throw', () => {
  fresh();
  set('bt.course', '{not json'); set('bt.portfolio', '"oops"'); set('bt.replay.sessions', { a: 1 });
  set('bt.journal', 42); set('bt.alerts', 'x'); set('bt.flashcards', [1, 2]); set('bt.daily5', null);
  set('bt.leagues', []); set('bt.rules', 'nope'); set('bt.screener.scans', { x: 1 }); set('bt.xp', '{{');
  set('bt.portfolio.league-abc234', { trades: 'no' }); set('bt.profile', 7); set('bt.backtest', []);
  const r = X.recompute({ toast: false });
  assert.strictEqual(r.total, 0);
  assert.doesNotThrow(() => { X.summary(); X.badges(); X.history(); X.dailyXp(30); X.streak(); X.profile.get(); });
});

/* ---------------- recompute from existing stores ---------------- */
function seedVeteran() {
  set('bt.course', { lessonsDone: { 'm1-l1': true, 'm1-l2': true, 'm1-l3': true, 'm1-l4': true, 'm1-l5': true, 'm2-l1': false }, quizScores: { 'm1-l1': 100, 'm1-l2': 80, 'm1-l3': 60 }, startedAt: new Date(day(3)).toISOString(), updatedAt: new Date(day(1)).toISOString() });
  set('bt.portfolio', { cash: 90000, startingCash: 100000, positions: {}, trades: [
    { id: 1, orderId: 1, symbol: 'AAPL', side: 'buy', qty: 10, price: 200, openedQty: 10, closedQty: 0, kind: 'stock', time: day(2) }
  ], orders: [{ id: 1, symbol: 'AAPL', side: 'buy', qty: 10, type: 'market', status: 'filled', placedAt: day(2), meta: {} }], equityHistory: [] });
  set('bt.replay.sessions', [
    { id: 's1', at: day(1), completed: true, returnPct: 5, buyHoldPct: 2, drill: { id: 'sma-cross-msft-2024', passed: true } },
    { id: 's2', at: day(1), completed: true, returnPct: 1, buyHoldPct: 2, drill: { id: 'sma-cross-msft-2024', passed: false } },
    { id: 's3', at: day(1), completed: false, returnPct: 9, buyHoldPct: 2, drill: { id: 'bear-market-survival-2022', passed: false } },
    { id: 's4', at: day(1), completed: true, returnPct: 3, buyHoldPct: 1, drill: null }
  ]);
  set('bt.journal', { entries: [
    { id: 'j1', source: 'paper', setup: 'Breakout', emotion: 'calm', createdAt: day(2) },           // tags only: not a reflection
    { id: 'j4', source: 'paper', setup: 'Pullback', lessons: 'Sized from the stop, not from hope.', createdAt: day(2) },
    { id: 'j2', source: 'paper', setup: '', emotion: '', notes: '', lessons: '', createdAt: day(2) },   // auto-synced, untouched
    { id: 'j3', source: 'manual', notes: 'Waited for the close.', createdAt: day(0) }
  ], reviews: { '2026-W45': { checks: {} } } });
  set('bt.alerts', [{ id: 1, symbol: 'AAPL', kind: 'price_above', value: 210, createdAt: day(2) }, { id: 2, symbol: 'MSFT', kind: 'rsi_below', value: 30, createdAt: day(2) }]);
  const log = []; for (let i = 0; i < 6; i++) log.push({ id: 't' + i, g: 'g', t: day(0) - i * 1000 });
  log.push({ id: 'x', g: 'g', t: day(5) });
  set('bt.flashcards', { version: 1, cards: {}, reviews: 7, log });
}
test('recompute derives XP from course, paper, replay, journal, alerts and flashcards', () => {
  fresh(); seedVeteran();
  const r = X.recompute({ toast: false, index: INDEX });
  const ids = new Set(r.granted.map(g => g.id));
  assert.ok(ids.has('lesson:m1-l1') && ids.has('lesson:m1-l5'));
  assert.ok(!ids.has('lesson:m2-l1'), 'false lessonsDone is not a lesson');
  assert.ok(ids.has('quiz:m1-l1') && ids.has('quiz:m1-l2') && !ids.has('quiz:m1-l3'), '80 % passes, 60 % does not');
  assert.ok(ids.has('quizPerfect:m1-l1') && !ids.has('quizPerfect:m1-l2'));
  assert.ok(ids.has('drill:sma-cross-msft-2024'));
  assert.ok(!ids.has('drill:bear-market-survival-2022'), 'unfinished drill is not completed');
  assert.ok(ids.has('journal:j4') && ids.has('journal:j3') && !ids.has('journal:j2') && !ids.has('journal:j1'), 'only written reflections earn XP');
  assert.ok(ids.has('firstTrade:once'));
  assert.ok(ids.has('alert:1') && !ids.has('alert:2'), 'one alert award per day');
  assert.ok(ids.has('flashcards:' + X.dayKey(day(0))));
  assert.ok(!ids.has('flashcards:' + X.dayKey(day(5))), 'one card is not a session');
  // 5 lessons*20 + 2 quizzes*30 + 10 + drill 25 + 2 journal*10 + 15 + 1 alert*5 (same day) + 10 flash = 245, plus active days
  const streakXp = r.granted.filter(g => g.event === 'streakDay').length * 5;
  assert.strictEqual(r.total, 245 + streakXp);
  assert.ok(streakXp >= 4 * 5, 'days 0..3 active');
  assert.strictEqual(r.level.name, 'Sophomore');
});
test('recompute is idempotent and never takes XP away', () => {
  fresh(); seedVeteran();
  const a = X.recompute({ toast: false, index: INDEX });
  const b = X.recompute({ toast: false, index: INDEX });
  assert.strictEqual(b.gained, 0); assert.strictEqual(b.total, a.total); assert.strictEqual(b.granted.length, 0);
  localStorage.removeItem('bt.portfolio'); localStorage.removeItem('bt.course');
  const c = X.recompute({ toast: false, index: INDEX });
  assert.strictEqual(c.total, a.total, 'resetting the paper account or course keeps earned XP');
});
test('badges from the veteran seed', () => {
  fresh(); seedVeteran();
  const r = X.recompute({ toast: false, index: INDEX });
  const earned = new Set(X.badges({ index: INDEX }).filter(b => b.earned).map(b => b.id));
  for (const id of ['first-lesson', 'module-complete', 'quiz-ace', 'first-fill', 'on-alert', 'replay-rookie', 'drill-passed', 'journal-starter', 'weekly-reviewer']) assert.ok(earned.has(id), id);
  for (const id of ['certificate', 'replay-pro', 'journal-keeper', 'risk-manager', 'options-explorer', 'league-finisher', 'streak-30', 'bilingual']) assert.ok(!earned.has(id), id);
  assert.ok(r.newBadges.length >= 9);
  const keeper = X.badges().find(b => b.id === 'journal-keeper');
  assert.deepStrictEqual(keeper.progress, { n: 2, of: 14 });
});
test('a bare journal array (replay saveToJournal before journal.html) counts too', () => {
  fresh();
  set('bt.journal', [{ id: 'r1', source: 'replay', notes: 'Replay MSFT: followed the rule.', createdAt: day(0) }]);
  const r = X.recompute({ toast: false });
  assert.ok(r.granted.some(g => g.id === 'journal:r1'));
});

/* ---------------- award ---------------- */
test('award is idempotent per key and dispatches bt:xp', () => {
  fresh();
  const a = X.award('lesson', 'm3-l1', { silent: true });
  assert.strictEqual(a.awarded, true);
  assert.strictEqual(a.xp, 25, '20 for the lesson + 5 for the active day');
  const ev = events.filter(e => e.type === 'bt:xp');
  assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].detail.event, 'lesson'); assert.strictEqual(ev[0].detail.summary.total, 25);
  const b = X.award('lesson', 'm3-l1', { silent: true });
  assert.strictEqual(b.awarded, false); assert.strictEqual(b.xp, 0); assert.strictEqual(b.reason, 'already-awarded');
  assert.strictEqual(X.total(), 25);
  assert.strictEqual(events.filter(e => e.type === 'bt:xp').length, 1, 'no event when nothing changed');
});
test('award quiz respects the 80 % pass mark and adds the perfect bonus', () => {
  fresh();
  assert.strictEqual(X.award('quiz', 'm1-l1', { pct: 79, silent: true }).reason, 'below-pass');
  assert.strictEqual(X.total(), 0);
  const r = X.award('quiz', 'm1-l1', { pct: 100, silent: true });
  assert.strictEqual(r.xp, 30 + 10 + 5);
  assert.strictEqual(X.award('quiz', 'm1-l2', { pct: 85, silent: true }).xp, 30);
});
test('award: unknown events are refused; flag events feed badges without XP of their own', () => {
  fresh();
  assert.strictEqual(X.award('bogus', 'x').reason, 'unknown-event');
  const r = X.award('backtest', 'run', { silent: true });
  assert.strictEqual(r.xp, 5, 'only the active-day XP');
  assert.ok(r.badges.some(b => b.id === 'backtester'));
  X.award('screener', 'saved', { silent: true }); X.award('rule', 'saved', { silent: true });
  const earned = new Set(X.badges().filter(b => b.earned).map(b => b.id));
  assert.ok(earned.has('screener-scout') && earned.has('rule-maker'));
});
test('award then recompute does not double count', () => {
  fresh();
  X.award('lesson', 'm1-l1', { silent: true });
  set('bt.course', { lessonsDone: { 'm1-l1': true }, quizScores: {}, updatedAt: new Date(NOW).toISOString() });
  const r = X.recompute({ toast: false });
  assert.ok(!r.granted.some(g => g.id === 'lesson:m1-l1'));
  assert.strictEqual(X.total(), 25);
});
test('onChange notifies subscribers and can unsubscribe', () => {
  fresh();
  const seen = [];
  const off = X.onChange((sum, detail) => seen.push([sum.total, detail.source]), { immediate: true });
  assert.deepStrictEqual(seen[0], [0, 'init']);
  X.award('alert', '9', { silent: true });
  assert.deepStrictEqual(seen[1], [5, 'award'], 'an alert pays 5 XP and is not an activity day');
  off();
  X.award('alert', '10', { silent: true });
  assert.strictEqual(seen.length, 2);
});

/* ---------------- streaks ---------------- */
test('streak: current run ends today or yesterday; best run is the longest', () => {
  const k = X.dayKey;
  const days = [k(day(10)), k(day(9)), k(day(8)), k(day(2)), k(day(1))].sort();
  assert.deepStrictEqual(X._streakOf(days, k(NOW)), { current: 2, best: 3 });
  assert.deepStrictEqual(X._streakOf([k(day(3))], k(NOW)), { current: 0, best: 1 });
  assert.deepStrictEqual(X._streakOf([], k(NOW)), { current: 0, best: 0 });
});
test('Streak 7 from seven consecutive Daily 5 days; future days ignored', () => {
  fresh();
  const history = {};
  for (let i = 0; i < 7; i++) history[X.dayKey(day(i))] = { score: 4, total: 5 };
  history['2030-01-01'] = { score: 5, total: 5 };
  set('bt.daily5', { version: 1, history, best: 7 });
  X.recompute({ toast: false });
  const s = X.streak();
  assert.strictEqual(s.current, 7); assert.strictEqual(s.best, 7);
  assert.ok(X.badges().find(b => b.id === 'streak-7').earned);
  assert.ok(!X.badges().find(b => b.id === 'streak-30').earned);
  assert.strictEqual(X.total(), 35, '7 active days x 5');
  assert.strictEqual(X.summary().streak, 7);
});

/* ---------------- paper-based badges ---------------- */
test('Risk Manager counts trades with a planned stop or a protective stop order at ≤ 1 % risk', () => {
  fresh();
  const trades = [], orders = [];
  for (let i = 1; i <= 6; i++) {          // planned stop on the order meta: 10 sh x $5 = $50 = 0.05 %
    orders.push({ id: i, symbol: 'AAPL', side: 'buy', qty: 10, type: 'market', status: 'filled', placedAt: day(1) + i, meta: { plan: { stop: 195 } } });
    trades.push({ id: i, orderId: i, symbol: 'AAPL', side: 'buy', qty: 10, price: 200, openedQty: 10, closedQty: 0, kind: 'stock', time: day(1) + i });
  }
  ['MSFT', 'AMZN', 'GOOG', 'META'].forEach((sym, k) => {   // protective stop order placed afterwards: 20 sh x $20 = 0.4 %
    const i = 7 + k;
    orders.push({ id: i, symbol: sym, side: 'buy', qty: 20, type: 'market', status: 'filled', placedAt: day(1) + i, meta: {} });
    trades.push({ id: i, orderId: i, symbol: sym, side: 'buy', qty: 20, price: 400, openedQty: 20, closedQty: 0, kind: 'stock', time: day(1) + i });
    orders.push({ id: 100 + i, symbol: sym, side: 'sell', qty: 20, type: 'stop', stopPrice: 380, status: 'open', placedAt: day(1) + i + 5, meta: {} });
  });
  // too much risk: 100 sh x $50 = $5,000 = 5 %
  orders.push({ id: 50, symbol: 'TSLA', side: 'buy', qty: 100, type: 'market', status: 'filled', placedAt: day(1), meta: { stop: 150 } });
  trades.push({ id: 50, orderId: 50, symbol: 'TSLA', side: 'buy', qty: 100, price: 200, openedQty: 100, closedQty: 0, kind: 'stock', time: day(1) });
  // no stop at all
  orders.push({ id: 60, symbol: 'NVDA', side: 'buy', qty: 1, type: 'market', status: 'filled', placedAt: day(1), meta: {} });
  trades.push({ id: 60, orderId: 60, symbol: 'NVDA', side: 'buy', qty: 1, price: 100, openedQty: 1, closedQty: 0, kind: 'stock', time: day(1) });
  set('bt.portfolio', { startingCash: 100000, cash: 0, positions: {}, trades, orders });
  assert.strictEqual(X.facts().riskManaged, 10);
  X.recompute({ toast: false });
  assert.ok(X.badges().find(b => b.id === 'risk-manager').earned);
});
test('Options Explorer from an option fill in any account; league accounts are found by key', () => {
  fresh();
  set('bt.portfolio.league-abc234', { startingCash: 50000, trades: [{ id: 1, symbol: 'AAPL260117C00200000', side: 'buy', qty: 1, price: 3, openedQty: 1, kind: 'option', time: day(0) }], orders: [] });
  const f = X.facts();
  assert.strictEqual(f.optionTrades, 1); assert.strictEqual(f.fills, 1);
  X.recompute({ toast: false });
  assert.ok(X.badges().find(b => b.id === 'options-explorer').earned);
  assert.ok(X.badges().find(b => b.id === 'first-fill').earned);
});
test('replay account fills do not create activity days from historical bar times', () => {
  fresh();
  set('bt.portfolio.replay', { startingCash: 100000, trades: [{ id: 1, symbol: 'MSFT', side: 'buy', qty: 1, price: 300, openedQty: 1, kind: 'stock', time: Date.parse('2024-03-01T21:00:00Z') }], orders: [] });
  assert.deepStrictEqual(X.facts().activityDays, []);
  assert.strictEqual(X.facts().fills, 1);
});
test('Replay Pro: beat buy-and-hold in 5 different finished drills', () => {
  fresh();
  const ids = ['sma-cross-msft-2024', 'bear-market-survival-2022', 'ride-the-trend-nvda-2023', 'range-trading-spy-2018', 'breakout-meta-2023'];
  set('bt.replay.sessions', ids.map((id, i) => ({ id: 's' + i, at: day(1), completed: true, returnPct: 4, buyHoldPct: 1, drill: { id, passed: true } })));
  X.recompute({ toast: false });
  assert.ok(X.badges().find(b => b.id === 'replay-pro').earned);
  assert.strictEqual(X.history().filter(h => h.event === 'drill').length, 5);
});

/* ---------------- anti-farming (reviewer findings) ---------------- */
test('journal: 40 auto trade entries with only an emotion tap earn 0 XP and no journal badge', () => {
  fresh();
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push({ id: 'a' + i, tradeId: 'main:' + i, source: 'paper', symbol: 'AAPL', setup: i % 2 ? 'Breakout' : '', tags: ['long'], emotion: 'calm', notes: i % 3 ? 'ok' : '', lessons: '', createdAt: day(0) });
  set('bt.journal', { entries, reviews: {} });
  const r = X.recompute({ toast: false });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(X.facts().journal.length, 0);
  assert.ok(!X.badges().find(b => b.id === 'journal-starter').earned);
});
test('journal: 5 real reflections in one day earn 30 XP (3 per day cap); the next day pays again', () => {
  fresh();
  const note = 'I entered before the close confirmed the breakout.';
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push({ id: 'm' + i, source: 'manual', notes: note, createdAt: day(1) + i });
  set('bt.journal', { entries, reviews: {} });
  let r = X.recompute({ toast: false });
  assert.strictEqual(r.granted.filter(g => g.event === 'journal').length, 3);
  assert.strictEqual(r.granted.filter(g => g.event === 'journal').reduce((n, g) => n + g.xp, 0), 30);
  assert.ok(X.badges().find(b => b.id === 'journal-starter').earned);
  assert.deepStrictEqual(X.badges().find(b => b.id === 'journal-keeper').progress, { n: 5, of: 14 }, 'badges count every reflection');
  r = X.recompute({ toast: false });
  assert.strictEqual(r.gained, 0, 'recompute stays capped');
  entries.push({ id: 'n1', source: 'manual', lessons: 'Waiting for my level paid off today.', createdAt: day(0) });
  set('bt.journal', { entries, reviews: {} });
  r = X.recompute({ toast: false });
  assert.ok(r.granted.some(g => g.id === 'journal:n1'));
  // live awards share the same daily cap
  for (let i = 0; i < 5; i++) X.award('journal', 'live' + i, { silent: true });
  assert.strictEqual(X.history().filter(h => h.event === 'journal' && X.dayKey(h.at) === X.dayKey(NOW)).length, 3);
});
test('alerts: 50 create/delete cycles earn at most 5 XP per day and no activity day', () => {
  fresh();
  for (let i = 0; i < 50; i++) {
    set('bt.alerts', [{ id: 'a' + i, symbol: 'AAPL', kind: 'price_above', value: 210, createdAt: NOW }]);
    X.recompute({ toast: false });
    X.award('alert', 'a' + i, { silent: true });
  }
  set('bt.alerts', []); X.recompute({ toast: false });
  assert.strictEqual(X.total(), 5);
  assert.strictEqual(X.award('alert', 'zzz', { silent: true }).reason, 'daily-cap');
  assert.strictEqual(X.streak().days, 0);
});
test('streak: cancelled, rejected and filled orders never make activity days', () => {
  fresh();
  const orders = [], trades = [];
  for (let d = 0; d < 7; d++) {
    orders.push({ id: d, symbol: 'AAPL', side: 'buy', type: 'limit', limitPrice: 1, qty: 1, status: d % 2 ? 'cancelled' : 'rejected', placedAt: day(d) });
    orders.push({ id: 100 + d, symbol: 'AAPL', side: 'buy', type: 'market', qty: 1, status: 'filled', placedAt: day(d) });
    trades.push({ id: 100 + d, orderId: 100 + d, symbol: 'AAPL', side: 'buy', qty: 1, price: 200, openedQty: 1, closedQty: 0, kind: 'stock', time: day(d) });
  }
  set('bt.portfolio', { cash: 1e5, startingCash: 1e5, trades, orders, positions: {} });
  const r = X.recompute({ toast: false });
  assert.strictEqual(r.total, 15, 'only the one-time First trade XP');
  assert.deepStrictEqual(X.facts().activityDays, []);
  assert.ok(!X.badges().find(b => b.id === 'streak-7').earned);
  X.award('firstTrade', 'once', { silent: true });
  assert.strictEqual(X.streak().days, 0, 'a live first-trade award is not an activity day');
  assert.ok(!/trades/.test(X.BADGES.find(b => b.id === 'streak-7').criteria));
});
test('Risk Manager: 10 scaled-in buys under one later stop (9 % at risk) earn 0', () => {
  fresh();
  const trades = [], orders = [];
  for (let i = 0; i < 10; i++) {
    orders.push({ id: i, symbol: 'XYZ', side: 'buy', type: 'market', qty: 90, status: 'filled', placedAt: day(1) + i });
    trades.push({ id: 't' + i, orderId: i, symbol: 'XYZ', side: 'buy', qty: 90, openedQty: 90, closedQty: 0, price: 100, time: day(1) + i, kind: 'stock' });
  }
  orders.push({ id: 100, symbol: 'XYZ', side: 'sell', type: 'stop', stopPrice: 90, status: 'open', placedAt: day(1) + 100, qty: 900 });
  set('bt.portfolio', { cash: 10000, startingCash: 100000, trades, orders, positions: { XYZ: { qty: 900, avg: 100 } } });
  assert.strictEqual(X.facts().riskManaged, 0);
});
test('Risk Manager: one 5 % risk order filled in 10 partial fills earns 0; one 0.5 % order in 10 fills counts once', () => {
  fresh();
  const mk = (qty, stop) => {
    const orders = [{ id: 1, symbol: 'XYZ', side: 'buy', type: 'market', qty, status: 'filled', placedAt: day(1), meta: { plan: { stop } } }];
    const trades = [];
    for (let i = 0; i < 10; i++) trades.push({ id: 't' + i, orderId: 1, symbol: 'XYZ', side: 'buy', qty: qty / 10, openedQty: qty / 10, closedQty: 0, price: 100, time: day(1) + i * 60000, kind: 'stock' });
    set('bt.portfolio', { cash: 0, startingCash: 100000, trades, orders, positions: {} });
  };
  mk(5000, 99);
  assert.strictEqual(X.facts().riskManaged, 0);
  mk(100, 95);                                   // 100 sh x $5 = 0.5 %, $10k = 10 % of equity
  assert.strictEqual(X.facts().riskManaged, 1);
});
test('Risk Manager: uses equity at the time, skips oversized and averaging-down orders', () => {
  fresh();
  // 40 sh x $5 = $200: 0.2 % of $100k but 4 % of $5k equity after losses
  set('bt.portfolio', { startingCash: 100000, cash: 0, positions: {}, equityHistory: [{ t: day(3), equity: 100000 }, { t: day(2), equity: 5000 }],
    orders: [{ id: 1, symbol: 'AAPL', side: 'buy', qty: 40, type: 'market', status: 'filled', placedAt: day(1), meta: { plan: { stop: 195 } } }],
    trades: [{ id: 1, orderId: 1, symbol: 'AAPL', side: 'buy', qty: 40, price: 200, openedQty: 40, closedQty: 0, kind: 'stock', time: day(1) }] });
  assert.strictEqual(X.facts().riskManaged, 0, 'risk measured against current equity');
  // 300 sh x $100 = 30 % of equity, tight stop (0.3 % risk) still too big a position
  set('bt.portfolio', { startingCash: 100000, cash: 0, positions: {},
    orders: [{ id: 1, symbol: 'KO', side: 'buy', qty: 300, type: 'market', status: 'filled', placedAt: day(1), meta: { plan: { stop: 99 } } }],
    trades: [{ id: 1, orderId: 1, symbol: 'KO', side: 'buy', qty: 300, price: 100, openedQty: 300, closedQty: 0, kind: 'stock', time: day(1) }] });
  assert.strictEqual(X.facts().riskManaged, 0, 'more than 25 % of equity');
  // first buy fine, second buy adds below the average cost
  set('bt.portfolio', { startingCash: 100000, cash: 0, positions: {},
    orders: [{ id: 1, symbol: 'PEP', side: 'buy', qty: 20, type: 'market', status: 'filled', placedAt: day(2), meta: { plan: { stop: 95 } } },
             { id: 2, symbol: 'PEP', side: 'buy', qty: 20, type: 'market', status: 'filled', placedAt: day(1), meta: { plan: { stop: 85 } } }],
    trades: [{ id: 1, orderId: 1, symbol: 'PEP', side: 'buy', qty: 20, price: 100, openedQty: 20, closedQty: 0, kind: 'stock', time: day(2) },
             { id: 2, orderId: 2, symbol: 'PEP', side: 'buy', qty: 20, price: 90, openedQty: 20, closedQty: 0, kind: 'stock', time: day(1) }] });
  assert.strictEqual(X.facts().riskManaged, 1, 'the add to a losing position does not count');
});
test('Replay Pro: only the first finished attempt counts and it must pass every check', () => {
  fresh();
  const ids = ['sma-cross-msft-2024', 'ride-the-trend-nvda-2023', 'breakout-meta-2023', 'hourly-swing-msft-2024', 'range-trading-spy-2018'];
  const sess = [];
  ids.forEach((id, k) => {
    for (let i = 0; i < 9; i++) sess.push({ id: id + i, at: day(5) + i, completed: true, returnPct: -30, buyHoldPct: 10, drill: { id, passed: false } });
    sess.push({ id: id + 'x', at: day(4), completed: true, returnPct: 60, buyHoldPct: 10, drill: { id, passed: true } });
  });
  set('bt.replay.sessions', sess);
  X.recompute({ toast: false });
  assert.strictEqual(X.facts().drillsBeatBH.length, 0, 'retries after a failed first attempt do not count');
  assert.ok(!X.badges().find(b => b.id === 'replay-pro').earned);
  // clearing the history and retrying does not reset the first attempt (remembered in bt.xp)
  set('bt.replay.sessions', ids.map((id, i) => ({ id: 'r' + i, at: day(0), completed: true, returnPct: 50, buyHoldPct: 1, drill: { id, passed: true } })));
  X.recompute({ toast: false });
  assert.strictEqual(X.facts().drillsBeatBH.length, 0);
  // beat buy-and-hold but failed a check on the first attempt: not counted either
  fresh();
  set('bt.replay.sessions', ids.map((id, i) => ({ id: 'q' + i, at: day(1), completed: true, returnPct: 50, buyHoldPct: 1, drill: { id, passed: false } })));
  X.recompute({ toast: false });
  assert.ok(!X.badges().find(b => b.id === 'replay-pro').earned);
});

/* ---------------- leagues, tools, misc ---------------- */
test('League Finisher: joined, ended and traded in; active leagues do not count', () => {
  fresh();
  set('bt.leagues', { leagues: { ABC234: { code: 'ABC234', name: 'Fall', startDate: '2026-10-01', endDate: '2026-11-01' }, XYZ789: { code: 'XYZ789', name: 'Now', startDate: '2026-11-01', endDate: '2026-12-01' } }, joined: { ABC234: { displayName: 'A' }, XYZ789: { displayName: 'A' } } });
  set('bt.portfolio.league-abc234', { startingCash: 100000, trades: [{ id: 1, symbol: 'SPY', side: 'buy', qty: 1, price: 500, openedQty: 1, kind: 'stock', time: day(20) }], orders: [] });
  set('bt.portfolio.league-xyz789', { startingCash: 100000, trades: [{ id: 1, symbol: 'SPY', side: 'buy', qty: 1, price: 500, openedQty: 1, kind: 'stock', time: day(2) }], orders: [] });
  const r = X.recompute({ toast: false });
  assert.ok(r.granted.some(g => g.id === 'league:ABC234'));
  assert.ok(!r.granted.some(g => g.id === 'league:XYZ789'));
  const b = X.badges();
  assert.ok(b.find(x => x.id === 'league-finisher').earned && b.find(x => x.id === 'league-joined').earned);
});
test('tools: saved rules, saved scans (not built-ins), customised backtest, own watchlist symbols', () => {
  fresh();
  set('bt.rules', [{ name: 'My RSI', entry: { op: 'and', conditions: [] } }]);
  set('bt.screener.scans', [{ id: 'builtin:x', builtin: true, filters: [] }]);
  set('bt.backtest', { symbol: 'AAPL', strategy: 'smaCross', params: {} });
  set('bt.watchlist', ['AAPL', 'MSFT', 'KO', 'PEP']);
  let f = X.facts();
  assert.strictEqual(f.rules, 1); assert.strictEqual(f.scans, 0); assert.strictEqual(f.backtested, false); assert.strictEqual(f.watchlistOwn, 2);
  set('bt.screener.scans', [{ id: 'scan-1', name: 'Mine', filters: [] }]);
  set('bt.backtest', { symbol: 'MSFT', strategy: 'smaCross', params: {} });
  set('bt.watchlist', ['AAPL', 'KO', 'PEP', 'XOM']);
  f = X.facts();
  assert.strictEqual(f.scans, 1); assert.strictEqual(f.backtested, true); assert.strictEqual(f.watchlistOwn, 3);
});
test('certificate and first-week badges', () => {
  fresh();
  set('bt.course', { lessonsDone: {}, quizScores: {}, certificate: { name: 'Ana', id: 'BT-2026-ABCDEF', date: new Date(NOW).toISOString() } });
  set('bt.onboarding', { completedAt: new Date(NOW).toISOString() });
  X.recompute({ toast: false });
  const b = X.badges();
  assert.ok(b.find(x => x.id === 'certificate').earned && b.find(x => x.id === 'first-week').earned);
});
test('Bilingual: lessons done in English then in Spanish', () => {
  fresh();
  set('bt.lang', '"en"');
  X.award('lesson', 'm1-l1', { silent: true });
  assert.ok(!X.badges().find(b => b.id === 'bilingual').earned);
  set('bt.lang', '"es"');
  set('bt.course', { lessonsDone: { 'm1-l1': true }, quizScores: {} });
  X.recompute({ toast: false });                           // establishes the known set
  set('bt.course', { lessonsDone: { 'm1-l1': true, 'm1-l2': true }, quizScores: {} });
  X.recompute({ toast: false });                           // m1-l2 appeared while in Spanish
  assert.ok(X.badges().find(b => b.id === 'bilingual').earned);
  localStorage.removeItem('bt.lang');
});
test('first recompute does not guess the language of old lessons', () => {
  fresh();
  set('bt.course', { lessonsDone: { 'm1-l1': true }, quizScores: {} });
  X.recompute({ toast: false });
  assert.deepStrictEqual(X.facts().lessonLangs, []);
});
test('history and dailyXp: newest first, cumulative series ends at the total', () => {
  fresh(); seedVeteran();
  const r = X.recompute({ toast: false, index: INDEX });
  const h = X.history();
  assert.strictEqual(h.length, r.granted.length);
  for (let i = 1; i < h.length; i++) assert.ok(h[i - 1].at >= h[i].at);
  assert.ok(h.every(x => typeof x.label === 'string' && x.label));
  const d = X.dailyXp(30);
  assert.strictEqual(d.length, 30);
  assert.strictEqual(d[29].date, X.dayKey(NOW));
  assert.strictEqual(d[29].cumulative, r.total);
  assert.strictEqual(X.history(3).length, 3);
});
test('T() uses the module Spanish fallback when the language is es', () => {
  fresh();
  set('bt.lang', '"es"');
  assert.strictEqual(X.T('Risk Manager'), 'Gestor de riesgo');
  assert.strictEqual(X.T('+{n} XP', { n: 20 }), '+20 XP');
  assert.strictEqual(X.levelFor(250).name, 'Aprendiz');
  assert.strictEqual(X.T('Not in the table {x}', { x: 1 }), 'Not in the table 1');
  localStorage.removeItem('bt.lang');
  assert.strictEqual(X.T('Risk Manager'), 'Risk Manager');
});

/* ---------------- profile ---------------- */
test('profile: display name is opt-in, trimmed and sanitised', () => {
  fresh();
  assert.strictEqual(X.profile.get().displayName, '');
  assert.strictEqual(X.profile.set({ displayName: '  Ana <b>  Pérez ' }).displayName, 'Ana b Pérez');
  assert.strictEqual(X.profile.set({ displayName: 'x'.repeat(80) }).displayName.length, 40);
  assert.strictEqual(X.profile.set({ displayName: '' }).displayName, '');
  assert.ok(!('displayName' in get('bt.profile')));
});

/* ---------------- personality quiz ---------------- */
const data = X.personality.normalize(PERS);
test('personality.json: 10 questions, 4 profiles with the contract names', () => {
  assert.strictEqual(data.questions.length, 10);
  assert.deepStrictEqual(data.profiles.map(p => p.name), ['Trend Follower', 'Swing Trader', 'Value-minded Investor', 'Options Strategist']);
  assert.ok(PERS.disclaimer && /not financial advice/i.test(PERS.disclaimer));
});
test('personality.json: balanced — every question offers each profile exactly once with equal points', () => {
  const ids = data.profiles.map(p => p.id);
  for (const q of data.questions) {
    assert.strictEqual(q.choices.length, ids.length, q.id);
    const hit = {};
    for (const c of q.choices) { const ks = Object.keys(c.points); assert.strictEqual(ks.length, 1, q.id); hit[ks[0]] = c.points[ks[0]]; }
    assert.deepStrictEqual(Object.keys(hit).sort(), ids.slice().sort(), q.id + ' covers every profile');
    assert.ok(Object.values(hit).every(v => v === 2), q.id + ' equal points');
  }
  const max = X.personality.score(data, []).max;
  assert.ok(Object.values(max).every(v => v === 20));
  // the choice for a profile is not always in the same position (no "always pick A" pattern)
  for (const id of ids) {
    const positions = new Set(data.questions.map(q => q.choices.findIndex(c => c.points[id])));
    assert.ok(positions.size >= 3, id + ' answer position varies');
  }
});
test('personality.json: non-judgmental copy and honest risk notes for every profile', () => {
  const text = JSON.stringify(PERS).toLowerCase();
  for (const w of ['best trader', 'guaranteed', 'easy money', 'you will profit', 'risk-free', 'always win']) assert.ok(!text.includes(w), 'avoid "' + w + '"');
  for (const p of data.profiles) {
    assert.ok(p.tip && /watch/i.test(p.tip), p.id + ' has a watch-out');
    assert.ok(p.body.length > 150 && p.summary && p.tagline, p.id + ' copy');
    assert.ok(p.steps.length >= 3, p.id + ' steps');
  }
  assert.ok(/no profile is better/i.test(PERS.intro));
});
test('personality.json: learning paths link real lesson, module and drill ids', () => {
  for (const p of data.profiles) {
    assert.ok(p.path.length >= 5, p.id + ' path length');
    assert.ok(p.path.some(x => x.type === 'drill'), p.id + ' includes a drill');
    assert.ok(p.path.some(x => x.type === 'lesson' && /^m4-l[12]$/.test(x.id)), p.id + ' includes a risk lesson (sizing or stops)');
    for (const x of p.path) {
      if (x.type === 'lesson') assert.ok(lessonIds.has(x.id), p.id + ' lesson ' + x.id);
      else if (x.type === 'module') assert.ok(moduleIds.has(x.id), p.id + ' module ' + x.id);
      else if (x.type === 'drill') assert.ok(drillIds.has(x.id), p.id + ' drill ' + x.id);
      assert.ok(x.why.length > 10, p.id + ' why for ' + x.id);
    }
  }
});
test('course/es/personality.json mirrors ids, points and paths', () => {
  const es = X.personality.normalize(PERS_ES);
  assert.deepStrictEqual(es.profiles.map(p => p.id), data.profiles.map(p => p.id));
  assert.deepStrictEqual(es.profiles.map(p => p.path.map(x => x.type + ':' + x.id)), data.profiles.map(p => p.path.map(x => x.type + ':' + x.id)));
  assert.deepStrictEqual(es.questions.map(q => q.choices.map(c => c.points)), data.questions.map(q => q.choices.map(c => c.points)));
  assert.notStrictEqual(es.title, data.title);
});
test('score: all trend answers → Trend Follower; blends and partial answers', () => {
  const trendIdx = data.questions.map(q => q.choices.findIndex(c => c.points.trend));
  const r = X.personality.score(data, trendIdx);
  assert.strictEqual(r.primary, 'trend'); assert.strictEqual(r.secondary, null); assert.strictEqual(r.complete, true);
  assert.strictEqual(r.scores.trend, 20); assert.strictEqual(r.pcts.trend, 100);
  const mix = data.questions.map((q, i) => q.choices.findIndex(c => c.points[i < 5 ? 'swing' : (i < 9 ? 'options' : 'value')]));
  const m = X.personality.score(data, mix);
  assert.strictEqual(m.primary, 'swing'); assert.strictEqual(m.secondary, 'options');
  const part = X.personality.score(data, [trendIdx[0], null, 9, -1]);
  assert.strictEqual(part.answered, 1); assert.strictEqual(part.complete, false); assert.strictEqual(part.primary, 'trend');
  assert.strictEqual(X.personality.score(data, []).primary, null);
  const byId = {}; data.questions.forEach((q, i) => { byId[q.id] = trendIdx[i]; });
  assert.strictEqual(X.personality.score(data, byId).primary, 'trend');
});
test('save personality → bt.profile and the Know Yourself badge', () => {
  fresh();
  const r = X.personality.score(data, data.questions.map(q => q.choices.findIndex(c => c.points.value)));
  const rec = X.personality.save(r, data);
  assert.strictEqual(rec.primary, 'value');
  assert.strictEqual(get('bt.profile').personality.primary, 'value');
  assert.strictEqual(X.personality.result().primary, 'value');
  assert.ok(X.badges().find(b => b.id === 'know-yourself').earned);
  assert.strictEqual(X.personality.save({ primary: null }), null);
  X.profile.clearPersonality();
  assert.strictEqual(X.personality.result(), null);
});
test('pathHref builds safe links', () => {
  assert.strictEqual(X.pathHref({ type: 'lesson', id: 'm3-l1' }), 'learn.html#/lesson/m3-l1');
  assert.strictEqual(X.pathHref({ type: 'module', id: 'm6-strategy' }), 'learn.html#/module/m6-strategy');
  assert.strictEqual(X.pathHref({ type: 'drill', id: 'sma-cross-msft-2024' }), 'replay.html#drill=sma-cross-msft-2024');
  assert.strictEqual(X.pathHref({ type: 'page', href: 'portfolio.html' }), 'portfolio.html');
  assert.strictEqual(X.pathHref({ type: 'page', href: 'javascript:alert(1)' }), '#');
  assert.strictEqual(X.pathHref(null), '#');
});
const asyncTests = [];
asyncTests.push(X.personality.load('es').then(
  () => { failed++; console.log('  FAIL personality.load rejects when both files are unreachable'); },
  () => { passed++; console.log('  ok   personality.load rejects when both files are unreachable (es → en fallback tried)'); }
));

/* ---------------- profile.html ---------------- */
test('profile.html: shell, viewport, scripts and accessibility hooks', () => {
  const html = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
  assert.ok(html.includes('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'));
  assert.ok(/<body[^>]*>\s*<div id="nav"><\/div>/.test(html), 'nav right after body');
  assert.ok(html.includes('<div id="footer"></div>'));
  assert.ok(html.includes('css/style.css') && html.includes('js/nav.js') && html.includes('js/xp.js'));
  assert.ok(html.includes('aria-live'), 'aria-live region');
  assert.ok(/role="img"/.test(html) || /role=\\?"img\\?"/.test(html) || html.includes("role=\"img\""), 'charts have role=img');
});

Promise.all(asyncTests).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
