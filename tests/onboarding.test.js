/* Broward Trading — tests for js/onboarding.js (BT.onboarding) and course/firstweek.json
 * Run with:  node tests/onboarding.test.js
 * Plain node + assert, no framework. `window` and `localStorage` are shimmed; the
 * plan is injected with setPlan() so no fetch is needed. The checks are exercised
 * against the real localStorage shapes written by js/course.js, js/paper.js,
 * js/replay.js, js/journal.js, js/alerts.js, js/glossary.js and js/app.js.
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
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent() {} };
global.fetch = async () => { throw new TypeError('Failed to fetch'); };
require(path.join(ROOT, 'js', 'onboarding.js'));
const O = window.BT.onboarding;

const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'firstweek.json'), 'utf8'));
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'index.json'), 'utf8'));
const lessonIds = new Set();
for (const m of INDEX.modules || []) for (const l of m.lessons || []) lessonIds.add(l.id);
// Lesson quiz counts from the module files, so quiz checks point at lessons that have a quiz.
const quizCount = {};
for (const f of fs.readdirSync(path.join(ROOT, 'course')).filter(f => /^m\d+-.*\.json$/.test(f))) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', f), 'utf8'));
  for (const l of m.lessons || []) quizCount[l.id] = (l.blocks || []).filter(b => b.type === 'quiz').reduce((n, b) => n + (b.questions || []).length, 0);
}
const drillsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'drills.json'), 'utf8'));
const drillIds = new Set((Array.isArray(drillsJson) ? drillsJson : drillsJson.drills || []).map(d => d.id));
const pages = new Set(fs.readdirSync(ROOT).filter(f => /\.html$/.test(f)));

let passed = 0, failed = 0;
const pending = [];
function report(name, e) {
  if (!e) { passed++; console.log('  ok   ' + name); return; }
  failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
}
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { pending.push(r.then(() => report(name), e => report(name, e))); return; }
    report(name);
  } catch (e) { report(name, e); }
}
function fresh() { localStorage.clear(); O.setPlan(PLAN); }
function set(k, v) { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
const taskById = (st, id) => { for (const d of st.days) for (const t of d.tasks) if (t.id === id) return t; return null; };

console.log('BT.onboarding tests (v0.4)');

/* ---------------- course/firstweek.json ---------------- */
test('plan has 7 days x 3 tasks, outcomes and a completion card', () => {
  assert.strictEqual(PLAN.days.length, 7);
  PLAN.days.forEach((d, i) => {
    assert.strictEqual(d.day, i + 1, 'day numbering');
    assert.strictEqual(d.tasks.length, 3, 'day ' + d.day + ' has 3 tasks');
    assert.ok(d.title && d.intro, 'day ' + d.day + ' title/intro');
  });
  assert.ok(PLAN.outcomes.length >= 5);
  assert.ok(PLAN.completion && PLAN.completion.title && PLAN.completion.next.length >= 2);
  assert.ok(PLAN.completion.next.some(n => /^learn\.html/.test(n.href)), 'completion links to the full course');
  assert.ok(PLAN.completion.next.some(n => /certificate/.test(n.href)), 'completion links to the certificate');
  assert.ok(PLAN.honesty && /not make you a profitable trader/i.test(PLAN.honesty), 'honest copy about outcomes');
});
test('every task has an id, title, why, steps, a known check type and a link to an existing page', () => {
  const ids = new Set();
  for (const d of PLAN.days) for (const t of d.tasks) {
    assert.ok(t.id && !ids.has(t.id), 'unique id ' + t.id); ids.add(t.id);
    assert.ok(t.title && t.why && Array.isArray(t.steps) && t.steps.length >= 2, t.id + ' copy');
    assert.ok(O.checkTypes.includes(t.check.type), t.id + ' check type ' + t.check.type);
    assert.ok(t.link && /^[a-z]+\.html(#.*)?$/.test(t.link.href), t.id + ' link');
    assert.ok(pages.has(t.link.href.split('#')[0]), t.id + ' links to an existing page ' + t.link.href);
    assert.ok(typeof t.minutes === 'number' && t.minutes > 0, t.id + ' minutes');
  }
});
test('lesson and quiz checks reference real lessons (and quizzes that exist)', () => {
  for (const d of PLAN.days) for (const t of d.tasks) {
    if (t.check.type === 'lesson' || t.check.type === 'quiz') {
      assert.ok(lessonIds.has(t.check.lessonId), t.id + ' lesson ' + t.check.lessonId);
      assert.ok(t.link.href === 'learn.html#/lesson/' + t.check.lessonId, t.id + ' links to its lesson');
    }
    if (t.check.type === 'quiz') assert.ok(quizCount[t.check.lessonId] > 0, t.id + ' lesson has a quiz');
    if (t.check.type === 'replay' && t.check.drillId) assert.ok(drillIds.has(t.check.drillId), t.id + ' drill exists');
    const m = /#drill=([\w-]+)/.exec(t.link.href);
    if (m) assert.ok(drillIds.has(m[1]), t.id + ' linked drill exists');
  }
});
test('day 1 is doable in 20 minutes: tour, lesson m1-l1 and three watchlist symbols', () => {
  const d1 = PLAN.days[0];
  assert.ok(d1.minutes <= 20);
  assert.ok(d1.tasks.reduce((n, t) => n + t.minutes, 0) <= 20, 'task minutes add up to 20 or less');
  assert.deepStrictEqual(d1.tasks.map(t => t.check.type), ['tour', 'lesson', 'watchlist']);
  assert.strictEqual(d1.tasks[1].check.lessonId, 'm1-l1');
  assert.strictEqual(d1.tasks[2].check.added, 3);
});
test('no emojis in UI copy (brand guide)', () => {
  const text = JSON.stringify(PLAN);
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), 'emoji found');
});

/* ---------------- normalisation ---------------- */
test('normalisePlan tolerates garbage and fills defaults', () => {
  const p = O.normalisePlan(null);
  assert.strictEqual(p.days.length, 0); assert.strictEqual(p.title, 'Your First Week');
  const q = O.normalisePlan({ days: [{ tasks: [{ check: { type: 'nope' } }, 'junk', { title: 'x', check: null }] }] });
  assert.strictEqual(q.days[0].day, 1); assert.strictEqual(q.days[0].id, 'd1');
  assert.strictEqual(q.days[0].tasks.length, 3);
  assert.strictEqual(q.days[0].tasks[0].check.type, 'manual', 'unknown type → manual');
  assert.strictEqual(q.days[0].tasks[1].id, 'd1-t2');
  assert.strictEqual(q.days[0].tasks[2].check.type, 'manual');
});

/* ---------------- status with nothing stored ---------------- */
test('status with an empty localStorage: nothing done, day 1 current and unlocked, the rest locked', () => {
  fresh();
  const st = O.status();
  assert.strictEqual(st.total, 21); assert.strictEqual(st.done, 0); assert.strictEqual(st.pct, 0);
  assert.strictEqual(st.currentDay, 1); assert.strictEqual(st.complete, false);
  assert.ok(st.days[0].unlocked && st.days[0].current);
  for (let i = 1; i < 7; i++) assert.ok(!st.days[i].unlocked, 'day ' + (i + 1) + ' locked');
  assert.ok(st.minutesLeft > 100);
  assert.strictEqual(localStorage.getItem(O.STORE_KEY), null, 'merely looking writes nothing');
});
test('malformed keys count as not done and never throw', () => {
  fresh();
  set('bt.course', 'not json{'); set('bt.watchlist', '{"a":1}'); set('bt.portfolio', '[]'); set('bt.replay.sessions', '{"x":1}');
  set('bt.journal', '"str"'); set('bt.alerts', '{}'); set('bt.flashcards', '[1,2]'); set('bt.daily5', 'null'); set('bt.tour.done', '"yes"');
  set('bt.onboarding', '[]');
  const st = O.status();
  assert.strictEqual(st.done, 0);
  for (const type of O.checkTypes) assert.strictEqual(O.evaluate({ type }, { id: 'x' }).done, false, type);
  assert.strictEqual(O.evaluate(null).done, false);
  assert.strictEqual(O.evaluate({ type: 'lesson' }).done, false);
});

/* ---------------- individual checks against real shapes ---------------- */
test('lesson: bt.course.lessonsDone[id] === true', () => {
  fresh();
  assert.strictEqual(O.evaluate({ type: 'lesson', lessonId: 'm1-l1' }).done, false);
  set('bt.course', { lessonsDone: { 'm1-l1': true }, quizScores: {}, startedAt: 'x' });
  assert.strictEqual(O.evaluate({ type: 'lesson', lessonId: 'm1-l1' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'lesson', lessonId: 'm1-l2' }).done, false);
  set('bt.course', { lessonsDone: { 'm1-l1': 'yes' } });
  assert.strictEqual(O.evaluate({ type: 'lesson', lessonId: 'm1-l1' }).done, false, 'only a real true counts');
});
test('quiz: bt.course.quizScores[id] >= minPct (default 60)', () => {
  fresh();
  set('bt.course', { lessonsDone: {}, quizScores: { 'm1-l4': 40 } });
  let r = O.evaluate({ type: 'quiz', lessonId: 'm1-l4' });
  assert.strictEqual(r.done, false); assert.ok(/40%/.test(r.detail));
  set('bt.course', { quizScores: { 'm1-l4': 60 } });
  assert.strictEqual(O.evaluate({ type: 'quiz', lessonId: 'm1-l4' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'quiz', lessonId: 'm1-l4', minPct: 80 }).done, false);
  set('bt.course', { quizScores: { 'm1-l4': '100' } });
  assert.strictEqual(O.evaluate({ type: 'quiz', lessonId: 'm1-l4' }).done, false, 'string scores are malformed');
});
test('watchlist: added counts symbols outside the dashboard defaults; min counts everything', () => {
  fresh();
  assert.strictEqual(O.evaluate({ type: 'watchlist', added: 3 }).done, false, 'no key = defaults = nothing added');
  set('bt.watchlist', ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN', 'DIS', 'NKE']);
  let r = O.evaluate({ type: 'watchlist', added: 3 });
  assert.strictEqual(r.done, false); assert.strictEqual(r.n, 2); assert.strictEqual(r.of, 3);
  set('bt.watchlist', ['dis', 'NKE', 'KO']);
  r = O.evaluate({ type: 'watchlist', added: 3 });
  assert.strictEqual(r.done, true, 'replacing the defaults with three of your own counts');
  assert.strictEqual(O.evaluate({ type: 'watchlist', min: 3 }).done, true);
  assert.strictEqual(O.evaluate({ type: 'watchlist', min: 4 }).done, false);
  set('bt.watchlist', ['AAPL', 7, null, 'DIS']);
  assert.strictEqual(O.evaluate({ type: 'watchlist', min: 2 }).done, true, 'non-strings are ignored');
});
test('trade: fills in bt.portfolio.trades filtered by side/kind/closed; orders by orderType', () => {
  fresh();
  const portfolio = {
    version: 2, cash: 98000, startingCash: 100000, positions: { AAPL: { qty: 10, avg: 200, kind: 'stock' } },
    orders: [
      { id: 1, symbol: 'AAPL', side: 'buy', qty: 10, type: 'market', status: 'filled' },
      { id: 2, symbol: 'AAPL', side: 'sell', qty: 10, type: 'stop', stopPrice: 190, status: 'open' },
      { id: 3, symbol: 'MSFT', side: 'sell', qty: 5, type: 'stop_limit', status: 'rejected', reason: 'no position' }
    ],
    trades: [
      { id: 4, orderId: 1, symbol: 'AAPL', side: 'buy', qty: 10, price: 200, closedQty: 0, openedQty: 10, realized: 0, kind: 'stock', time: 1 }
    ]
  };
  set('bt.portfolio', portfolio);
  assert.strictEqual(O.evaluate({ type: 'trade' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'trade', side: 'buy' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'trade', side: 'sell' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'trade', closed: true }).done, false, 'nothing closed yet');
  assert.strictEqual(O.evaluate({ type: 'trade', kind: 'option' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'trade', min: 2 }).done, false);
  assert.strictEqual(O.evaluate({ type: 'trade', orderType: ['stop', 'stop_limit'] }).done, true, 'open stop order counts');
  assert.strictEqual(O.evaluate({ type: 'trade', orderType: 'stop_limit' }).done, false, 'rejected orders do not count');
  assert.strictEqual(O.evaluate({ type: 'trade', orderType: 'limit' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'trade', account: 'replay' }).done, false, 'other account key is separate');
  set('bt.portfolio.replay', { trades: [{ side: 'buy', qty: 1 }] });
  assert.strictEqual(O.evaluate({ type: 'trade', account: 'replay' }).done, true);
  set('bt.portfolio', { trades: 'nope', orders: 5 });
  assert.strictEqual(O.evaluate({ type: 'trade' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'trade', orderType: 'stop' }).done, false);
});
test('replay: bt.replay.sessions with completed / drill / drillId / passed filters', () => {
  fresh();
  set('bt.replay.sessions', [
    { id: 'a', symbol: 'MSFT', completed: false, returnPct: 1, drill: null },
    { id: 'b', symbol: 'NVDA', completed: true, returnPct: 12.5, drill: { id: 'ride-the-trend-nvda-2023', title: 'Ride', passed: false } },
    'junk', null
  ]);
  assert.strictEqual(O.evaluate({ type: 'replay' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'replay', min: 3 }).done, false, 'junk rows ignored');
  assert.strictEqual(O.evaluate({ type: 'replay', completed: true, drill: true }).done, true);
  assert.strictEqual(O.evaluate({ type: 'replay', drillId: 'ride-the-trend-nvda-2023', completed: true }).done, true);
  assert.strictEqual(O.evaluate({ type: 'replay', drillId: 'other' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'replay', drill: true, passed: true }).done, false);
  set('bt.replay.sessions', [{ id: 'a', completed: false }]);
  assert.strictEqual(O.evaluate({ type: 'replay', completed: true }).done, false);
});
test('journal: entries by field / reviewed / source, and weekly reviews', () => {
  fresh();
  set('bt.journal', { version: 1, entries: [
    { id: 'j1', symbol: 'AAPL', setup: 'Breakout', emotion: '', notes: 'x', lessons: '', source: 'paper', tags: [] },
    { id: 'j2', symbol: 'NVDA', setup: 'Replay drill', emotion: 'calm', notes: 'y', lessons: '  ', source: 'replay', tags: [] }
  ], reviews: {}, hidden: [] });
  assert.strictEqual(O.evaluate({ type: 'journal' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'journal', field: 'lessons' }).done, false, 'whitespace-only lesson does not count');
  assert.strictEqual(O.evaluate({ type: 'journal', reviewed: true }).done, true);
  assert.strictEqual(O.evaluate({ type: 'journal', reviewed: true, min: 2 }).done, false);
  assert.strictEqual(O.evaluate({ type: 'journal', source: 'manual' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'journal', review: true }).done, false);
  set('bt.journal', { entries: [{ id: 'j3', lessons: 'Do not move the stop.' }], reviews: { '2026-W10': { checks: { plan: true }, answers: {}, savedAt: 1 } } });
  assert.strictEqual(O.evaluate({ type: 'journal', field: 'lessons' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'journal', review: true }).done, true);
  set('bt.journal', { entries: {}, reviews: [] });
  assert.strictEqual(O.evaluate({ type: 'journal' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'journal', review: true }).done, false);
});
test('alert: bt.alerts array of {symbol, kind, value}', () => {
  fresh();
  set('bt.alerts', [{ id: 1, symbol: 'AAPL', kind: 'price_above', value: 210, enabled: true }, { id: 2 }]);
  assert.strictEqual(O.evaluate({ type: 'alert' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'alert', min: 2 }).done, false, 'an alert without symbol/kind is ignored');
  assert.strictEqual(O.evaluate({ type: 'alert', kind: 'rsi_below' }).done, false);
  assert.strictEqual(O.evaluate({ type: 'alert', symbol: 'aapl' }).done, true);
});
test('glossary: flashcards (cards with reps or the reviews counter) and daily5 history', () => {
  fresh();
  set('bt.flashcards', { version: 1, cards: { rsi: { interval: 1, ease: 2.5, due: 1, reps: 1, lapses: 0, last: 1 }, sma: { reps: 0 }, bad: 'x' }, reviews: 0, log: [] });
  let r = O.evaluate({ type: 'glossary', mode: 'flashcards', min: 5 });
  assert.strictEqual(r.done, false); assert.strictEqual(r.n, 1);
  set('bt.flashcards', { cards: {}, reviews: 7 });
  assert.strictEqual(O.evaluate({ type: 'glossary', mode: 'flashcards', min: 5 }).done, true, 'the reviews counter also counts');
  assert.strictEqual(O.evaluate({ type: 'glossary', mode: 'daily5' }).done, false);
  set('bt.daily5', { version: 1, history: { '2026-11-12': { score: 4, total: 5, pct: 80, answers: [], at: 1 } }, best: 1 });
  assert.strictEqual(O.evaluate({ type: 'glossary', mode: 'daily5' }).done, true);
  assert.strictEqual(O.evaluate({ type: 'glossary', mode: 'daily5', min: 2 }).done, false);
});
test('tour: bt.tour.done written by the dashboard', () => {
  fresh();
  assert.strictEqual(O.evaluate({ type: 'tour' }).done, false);
  set('bt.tour.done', true);
  assert.strictEqual(O.evaluate({ type: 'tour' }).done, true);
});
test('manual: ticked via setManual, stored in bt.onboarding.manual', () => {
  fresh();
  O.setManual('d2-timeframes', true);
  const st = O.status();
  const t = taskById(st, 'd2-timeframes');
  assert.ok(t && t.done && !t.auto);
  assert.strictEqual(JSON.parse(localStorage.getItem('bt.onboarding')).manual['d2-timeframes'], true);
  assert.ok(JSON.parse(localStorage.getItem('bt.onboarding')).startedAt, 'first interaction stamps startedAt');
  O.setManual('d2-timeframes', false);
  assert.strictEqual(taskById(O.status(), 'd2-timeframes').done, false);
});

/* ---------------- whole-week flow ---------------- */
function doDay1() {
  set('bt.tour.done', true);
  set('bt.course', { lessonsDone: { 'm1-l1': true }, quizScores: {} });
  set('bt.watchlist', ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN', 'DIS', 'NKE', 'KO']);
}
test('day 1 auto-completes from real data and unlocks day 2', () => {
  fresh(); doDay1();
  const st = O.status();
  assert.strictEqual(st.days[0].done, 3); assert.ok(st.days[0].complete); assert.strictEqual(st.days[0].pct, 100);
  assert.ok(st.days[0].completedAt, 'completion time recorded');
  assert.ok(st.days[1].unlocked && st.days[1].current, 'day 2 is now current');
  assert.ok(!st.days[2].unlocked);
  assert.strictEqual(st.currentDay, 2); assert.strictEqual(st.pct, 14);
});
test('un-doing a task (e.g. clearing the watchlist) re-locks day progress honestly', () => {
  fresh(); doDay1();
  O.status();
  set('bt.watchlist', ['AAPL']);
  const st = O.status();
  assert.ok(!st.days[0].complete); assert.strictEqual(st.days[0].completedAt, null);
  assert.strictEqual(st.currentDay, 1);
});
test('unlock(day) skips ahead; the skipped day is flagged', () => {
  fresh();
  O.unlock(3);
  const st = O.status();
  assert.ok(st.days[2].unlocked && st.days[2].skipped);
  assert.ok(!st.days[1].unlocked);
  assert.strictEqual(st.currentDay, 1, 'the first unfinished unlocked day is current');
});
test('setOverride marks an auto task done and can be undone', () => {
  fresh();
  O.setOverride('d1-tour', true);
  let t = taskById(O.status(), 'd1-tour');
  assert.ok(t.done && t.overridden && t.auto);
  O.setOverride('d1-tour', false);
  t = taskById(O.status(), 'd1-tour');
  assert.ok(!t.done && !t.overridden);
  O.setOverride('d2-timeframes', true);
  assert.strictEqual(taskById(O.status(), 'd2-timeframes').done, false, 'overrides do not apply to manual tasks');
});
test('a complete week: 21/21, complete flag, completedAt; reset clears only bt.onboarding', () => {
  fresh();
  doDay1();
  set('bt.course', { lessonsDone: { 'm1-l1': true, 'm1-l3': true, 'm2-l1': true, 'm1-l4': true, 'm4-l1': true, 'm3-l1': true, 'm7-l1': true, 'm4-l5': true }, quizScores: { 'm1-l4': 80 } });
  set('bt.portfolio', { orders: [{ type: 'stop', side: 'sell', status: 'open' }], trades: [{ side: 'buy', qty: 10 }] });
  set('bt.alerts', [{ symbol: 'DIS', kind: 'price_below', value: 90 }]);
  set('bt.flashcards', { cards: {}, reviews: 5 });
  set('bt.replay.sessions', [{ id: 'r1', completed: true, drill: { id: 'ride-the-trend-nvda-2023', passed: true } }]);
  set('bt.journal', { entries: [{ id: 'j', lessons: 'Trends last longer than I expect.' }], reviews: { '2026-W46': { checks: {}, answers: { went_well: 'x' } } } });
  set('bt.daily5', { history: { '2026-11-12': { score: 5, total: 5 } } });
  O.setManual('d2-timeframes', true); O.setManual('d5-signal', true);
  const st = O.status();
  const notDone = st.days.flatMap(d => d.tasks).filter(t => !t.done).map(t => t.id);
  assert.deepStrictEqual(notDone, [], 'still open: ' + notDone.join(', '));
  assert.strictEqual(st.done, 21); assert.ok(st.complete); assert.ok(st.completedAt);
  assert.strictEqual(st.minutesLeft, 0);
  const sum = O.summary();
  assert.deepStrictEqual({ started: sum.started, done: sum.done, complete: sum.complete }, { started: true, done: 21, complete: true });
  O.reset();
  assert.strictEqual(localStorage.getItem('bt.onboarding'), null);
  assert.ok(localStorage.getItem('bt.course') && localStorage.getItem('bt.journal'), 'other modules untouched');
  const after = O.status();
  assert.strictEqual(after.done, 19, 'auto checks still hold; only the two manual ticks are gone');
});
test('status() with no plan loaded returns an empty, non-throwing shape', () => {
  localStorage.clear();
  const saved = O.plan();
  // emulate "not loaded yet" by passing a plan with no days
  const st = O.status({ days: [] });
  assert.strictEqual(st.total, 0); assert.strictEqual(st.complete, false); assert.strictEqual(st.currentDay, 1);
  O.setPlan(saved);
});
test('load() falls back to the English plan and rejects cleanly when nothing is reachable', async () => {
  const calls = [];
  global.fetch = async (url) => { calls.push(url); if (/\/es\//.test(url)) return { ok: false, status: 404 }; return { ok: true, json: async () => PLAN }; };
  window.BT.i18n = { lang: () => 'es' };
  const p = await O.load(true);
  assert.deepStrictEqual(calls, ['course/es/firstweek.json', 'course/firstweek.json']);
  assert.strictEqual(p.englishOnly, true); assert.strictEqual(p.lang, 'en'); assert.strictEqual(p.days.length, 7);
  delete window.BT.i18n;
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let threw = false;
  try { await O.load(true); } catch (e) { threw = true; }
  assert.ok(threw, 'load rejects so the page can show an error');
});

/* ---------------- start.html wiring ---------------- */
test('start.html loads js/nav.js, js/onboarding.js and uses the shared shell mounts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
  assert.ok(/<div id="nav"><\/div>\s*<script src="js\/nav\.js"><\/script>/.test(html));
  assert.ok(html.includes('<div id="footer"></div>'));
  assert.ok(html.includes('<script src="js/onboarding.js"></script>'));
  assert.ok(html.includes('css/style.css') && html.includes('viewport-fit=cover'));
  assert.ok(/What you'll be able to do after this week/.test(html));
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(html), 'no emoji in the page');
});

Promise.all(pending).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
