/* Broward Trading — tests for course/glossary.json, course/questionbank.json and js/glossary.js (BT.glossary)
 * Run with:  node tests/glossary.test.js
 * Plain node + assert, no framework. `window` and `localStorage` are shimmed; the JSON
 * is injected with setData()/setBank() so no fetch is needed.
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
global.window = { localStorage: global.localStorage };
require(path.join(ROOT, 'js', 'glossary.js'));
const G = window.BT.glossary;

const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'glossary.json'), 'utf8'));
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'questionbank.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'index.json'), 'utf8'));

// Every lesson id that exists anywhere in the course: index.json plus any module file on disk.
const lessonIds = new Set();
const moduleIds = new Set();
for (const m of index.modules || []) { moduleIds.add(m.id); for (const l of m.lessons || []) lessonIds.add(l.id); }
const moduleFiles = fs.readdirSync(path.join(ROOT, 'course')).filter(f => /^m\d+-.*\.json$/.test(f));
const lessonQuizCount = {};
for (const f of moduleFiles) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', f), 'utf8'));
  moduleIds.add(m.id);
  for (const l of m.lessons || []) {
    lessonIds.add(l.id);
    let n = 0;
    for (const b of l.blocks || []) if (b.type === 'quiz') n += (b.questions || []).length;
    lessonQuizCount[l.id] = n;
  }
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const isStr = (s, min) => typeof s === 'string' && s.trim().length >= (min || 1);

console.log('course/glossary.json');

test('top-level shape: version, categories[], terms[] with at least 120 entries', () => {
  assert.ok(isStr(glossary.version));
  assert.ok(Array.isArray(glossary.categories) && glossary.categories.length >= 5);
  for (const c of glossary.categories) { assert.ok(isStr(c.id)); assert.ok(isStr(c.label)); }
  assert.ok(Array.isArray(glossary.terms));
  assert.ok(glossary.terms.length >= 120, 'only ' + glossary.terms.length + ' terms');
});

test('every term has id, term, category, lesson, definition, example, related[]', () => {
  const catIds = new Set(glossary.categories.map(c => c.id));
  for (const t of glossary.terms) {
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id), 'bad id ' + JSON.stringify(t.id));
    assert.ok(isStr(t.term, 2), t.id + ' term');
    assert.ok(catIds.has(t.category), t.id + ' unknown category ' + t.category);
    assert.ok(isStr(t.definition, 60), t.id + ' definition too short');
    assert.ok(isStr(t.example, 20), t.id + ' example too short');
    assert.ok(Array.isArray(t.related), t.id + ' related');
    assert.ok(Array.isArray(t.aliases), t.id + ' aliases');
    assert.ok(isStr(t.lesson), t.id + ' lesson');
  }
});

test('ids and display names are unique (case-insensitive)', () => {
  const ids = new Set(), names = new Set();
  for (const t of glossary.terms) {
    assert.ok(!ids.has(t.id), 'duplicate id ' + t.id); ids.add(t.id);
    const n = t.term.toLowerCase();
    assert.ok(!names.has(n), 'duplicate name ' + t.term); names.add(n);
  }
});

test('related ids all resolve to real terms, never to the term itself', () => {
  const ids = new Set(glossary.terms.map(t => t.id));
  for (const t of glossary.terms) {
    for (const r of t.related) {
      assert.ok(ids.has(r), t.id + ' → missing related ' + r);
      assert.notStrictEqual(r, t.id, t.id + ' relates to itself');
    }
    assert.ok(t.related.length >= 1, t.id + ' has no related terms');
  }
});

test('every lesson link points at a lesson that exists in the course', () => {
  for (const t of glossary.terms) assert.ok(lessonIds.has(t.lesson), t.id + ' → unknown lesson ' + t.lesson);
});

test('terms cover every module and are sorted alphabetically', () => {
  const mods = new Set(glossary.terms.map(t => t.lesson.split('-')[0]));
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) assert.ok(mods.has(id), 'no terms for module ' + id);
  const names = glossary.terms.map(t => t.term);
  const sorted = names.slice().sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  assert.deepStrictEqual(names, sorted);
});

test('definitions do not contain raw markup', () => {
  for (const t of glossary.terms) {
    assert.ok(!/<[a-z/]/.test(t.definition + t.example), t.id + ' contains HTML');
    assert.ok(!/\[\[/.test(t.definition + t.example), t.id + ' contains [[ ]] markers');
  }
});

console.log('course/questionbank.json');

test('top-level shape: {questions:[...]} with every lesson question plus at least 60 new ones', () => {
  assert.ok(Array.isArray(bank.questions));
  const fromLessons = bank.questions.filter(q => q.source === 'lesson');
  const fromBank = bank.questions.filter(q => q.source === 'bank');
  const totalLessonQs = Object.values(lessonQuizCount).reduce((a, b) => a + b, 0);
  // Modules that existed when the bank was generated must be fully harvested.
  const generated = new Set(bank.generatedFrom || []);
  let expected = 0;
  for (const f of moduleFiles) if (generated.has(f)) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', f), 'utf8'));
    for (const l of m.lessons || []) expected += lessonQuizCount[l.id] || 0;
  }
  assert.ok(expected >= 205, 'expected all eight modules (205 questions), got ' + expected);
  for (const f of ['m7-replay.json', 'm8-capstone.json']) assert.ok(generated.has(f), f + ' not in generatedFrom');
  assert.strictEqual(fromLessons.length, expected, 'harvested ' + fromLessons.length + ' of ' + expected + ' lesson questions');
  assert.ok(fromBank.length >= 60, 'only ' + fromBank.length + ' new questions');
  assert.ok(totalLessonQs >= expected);
});

test('every question carries a lessonId so Daily 5 can link back to a lesson', () => {
  for (const q of bank.questions) assert.ok(lessonIds.has(q.lessonId), q.id + ' has no lessonId');
});

test('every question matches the schema {id, moduleId, lessonId?, q, choices, answer, explain, difficulty}', () => {
  const ids = new Set();
  for (const q of bank.questions) {
    assert.ok(isStr(q.id), 'id'); assert.ok(!ids.has(q.id), 'duplicate id ' + q.id); ids.add(q.id);
    assert.ok(moduleIds.has(q.moduleId), q.id + ' unknown module ' + q.moduleId);
    if (q.lessonId != null) assert.ok(lessonIds.has(q.lessonId), q.id + ' unknown lesson ' + q.lessonId);
    assert.ok(isStr(q.q, 10), q.id + ' stem');
    assert.ok(Array.isArray(q.choices) && q.choices.length >= 3 && q.choices.length <= 6, q.id + ' choices');
    for (const c of q.choices) assert.ok(isStr(c), q.id + ' empty choice');
    assert.strictEqual(new Set(q.choices.map(c => c.trim().toLowerCase())).size, q.choices.length, q.id + ' duplicate choices');
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length, q.id + ' answer index');
    assert.ok(isStr(q.explain, 20), q.id + ' explain');
    assert.ok(['easy', 'medium', 'hard'].includes(q.difficulty), q.id + ' difficulty');
  }
});

test('harvested questions are verbatim copies of the lesson quizzes', () => {
  for (const f of moduleFiles) {
    if (!(bank.generatedFrom || []).includes(f)) continue;
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', f), 'utf8'));
    for (const l of m.lessons) {
      let n = 0;
      for (const b of l.blocks) if (b.type === 'quiz') for (const src of b.questions) {
        n++;
        const q = bank.questions.find(x => x.id === l.id + '-q' + n);
        assert.ok(q, 'missing ' + l.id + '-q' + n);
        assert.strictEqual(q.q, src.q); assert.deepStrictEqual(q.choices, src.choices);
        assert.strictEqual(q.answer, src.answer); assert.strictEqual(q.explain, src.explain);
        assert.strictEqual(q.lessonId, l.id); assert.strictEqual(q.moduleId, m.id);
      }
    }
  }
});

test('new questions cover every module and all three difficulties', () => {
  const fromBank = bank.questions.filter(q => q.source === 'bank');
  for (const id of ['m1-foundations', 'm2-charts', 'm3-indicators', 'm4-risk', 'm5-options', 'm6-strategy', 'm7-replay', 'm8-capstone']) {
    assert.ok(fromBank.filter(q => q.moduleId === id).length >= 8, 'fewer than 8 new questions for ' + id);
  }
  for (const d of ['easy', 'medium', 'hard']) assert.ok(fromBank.some(q => q.difficulty === d), 'no ' + d + ' questions');
});

console.log('BT.glossary — terms');

G.setData(glossary);
G.daily.setBank(bank);

test('setData indexes terms; get() resolves id, name, base name, alias, parenthetical and plural', () => {
  assert.strictEqual(G.terms().length, glossary.terms.length);
  assert.strictEqual(G.get('rsi').id, 'rsi');
  assert.strictEqual(G.get('Relative Strength Index (RSI)').id, 'rsi');
  assert.strictEqual(G.get('RSI').id, 'rsi');                 // parenthetical
  assert.strictEqual(G.get('relative strength index').id, 'rsi'); // base name
  assert.strictEqual(G.get('share').id, 'stock');             // parenthetical alias
  assert.strictEqual(G.get('IV').id, 'implied-volatility');   // alias
  assert.strictEqual(G.get('candlesticks').id, 'candlestick'); // plural
  assert.strictEqual(G.get('Bid-Ask Spread').id, 'spread');
  assert.strictEqual(G.get('not-a-term'), null);
  assert.strictEqual(G.get(null), null);
});

test('search() ranks exact and prefix name matches first, falls back to definition words, filters by category', () => {
  assert.strictEqual(G.search('rsi')[0].id, 'rsi');
  assert.strictEqual(G.search('macd')[0].id, 'macd');
  assert.strictEqual(G.search('stop')[0].term.toLowerCase().indexOf('stop'), 0);
  const ex = G.search('expectancy'); assert.strictEqual(ex[0].id, 'expectancy');
  assert.ok(G.search('shares outstanding market').some(t => t.id === 'market-cap'), 'definition-word fallback');
  assert.deepStrictEqual(G.search(''), G.terms());
  assert.ok(G.search('', { category: 'options' }).every(t => t.category === 'options'));
  assert.ok(G.search('', { category: 'options' }).length >= 20);
  assert.strictEqual(G.search('zzqx').length, 0);
  assert.strictEqual(G.search('a', { limit: 3 }).length, 3);
});

test('letters()/byLetter() group the alphabet; related()/backlinks() resolve', () => {
  const L = G.letters();
  assert.ok(L.includes('A') && L.includes('S'));
  const groups = G.byLetter();
  let n = 0; for (const k of Object.keys(groups)) n += groups[k].length;
  assert.strictEqual(n, G.terms().length);
  assert.ok(G.related('rsi').some(t => t.id === 'overbought'));
  assert.ok(G.backlinks('rsi').every(t => t.related.includes('rsi')));
});

test('lessonUrl(), termUrl(), summary() and linkify() build safe strings', () => {
  const t = G.get('rsi');
  assert.strictEqual(G.lessonUrl(t), 'learn.html#/lesson/m3-l2');
  assert.strictEqual(G.termUrl(t), 'glossary.html#term/rsi');
  assert.ok(G.summary(t).endsWith('.') && G.summary(t).length < t.definition.length);
  const html = G.linkify('see [[RSI]] and [[bid-ask spread|the spread]] and [[unknown thing]] <b>x</b>');
  assert.ok(html.includes('<a class="gl-term" data-term="rsi" href="glossary.html#term/rsi"'));
  assert.ok(html.includes('>the spread</a>'));
  assert.ok(html.includes('<span class="gl-term unknown">unknown thing</span>'));
  assert.ok(html.includes('<b>x</b>'), 'already-safe html is left alone');
  const evil = G.linkify('[[<img onerror=1>]]');
  assert.ok(!evil.includes('<img'), 'labels are escaped');
});

console.log('BT.glossary — flashcards');

test('fresh state: nothing seen, nothing due, queue is unseen cards capped by newLimit', () => {
  localStorage.clear(); G.flashcards.reset();
  const now = Date.UTC(2026, 0, 5, 15);
  const st = G.flashcards.stats(now);
  assert.strictEqual(st.seen, 0); assert.strictEqual(st.due, 0); assert.strictEqual(st.unseen, G.terms().length);
  assert.strictEqual(G.flashcards.queue({ now, limit: 20, newLimit: 7 }).length, 7);
  assert.strictEqual(G.flashcards.queue({ now, newLimit: 0 }).length, 0);
  assert.ok(G.flashcards.queue({ now, category: 'options', newLimit: 5 }).every(t => t.category === 'options'));
});

test('good: 1 day → 3 days → interval × ease; hard grows slowly; again resets and comes back in 10 minutes', () => {
  G.flashcards.reset();
  const t0 = Date.UTC(2026, 0, 5, 15);
  let c = G.flashcards.rate('rsi', 'good', t0);
  assert.strictEqual(c.interval, 1); assert.strictEqual(c.due, t0 + 86400000); assert.strictEqual(c.reps, 1);
  c = G.flashcards.rate('rsi', 'good', c.due);
  assert.strictEqual(c.interval, 3); assert.strictEqual(c.reps, 2);
  const t2 = c.due;
  c = G.flashcards.rate('rsi', 'good', t2);
  assert.strictEqual(c.interval, Math.round(3 * 2.5)); assert.strictEqual(c.due, t2 + 8 * 86400000);
  c = G.flashcards.rate('rsi', 'hard', c.due);
  assert.ok(c.ease < 2.5 && c.ease >= 1.3); assert.strictEqual(c.interval, Math.round(8 * 1.2 * 10) / 10);
  const t4 = c.due;
  c = G.flashcards.rate('rsi', 'again', t4);
  assert.strictEqual(c.interval, 0); assert.strictEqual(c.reps, 0); assert.strictEqual(c.lapses, 1);
  assert.strictEqual(c.due, t4 + 10 * 60000);
  assert.ok(G.flashcards.due(t4 + 11 * 60000).some(x => x.id === 'rsi'));
  assert.ok(!G.flashcards.due(t4 + 5 * 60000).some(x => x.id === 'rsi'));
  // ease never drops below the floor
  for (let i = 0; i < 20; i++) c = G.flashcards.rate('rsi', 'again', t4 + i);
  assert.strictEqual(c.ease, 1.3);
  assert.throws(() => G.flashcards.rate('rsi', 'meh', t4));
  assert.throws(() => G.flashcards.rate('no-such-term', 'good', t4));
});

test('preview()/delayLabel() describe the next interval without saving; add() makes a term due now', () => {
  G.flashcards.reset();
  const now = Date.UTC(2026, 0, 5, 15);
  const pv = G.flashcards.preview('macd', now);
  assert.deepStrictEqual(pv, { again: '10 min', hard: '1 day', good: '1 day' });
  assert.strictEqual(G.flashcards.card('macd'), null, 'preview must not create a card');
  G.flashcards.add('macd', now);
  assert.ok(G.flashcards.due(now).some(t => t.id === 'macd'));
  assert.strictEqual(G.flashcards.queue({ now, newLimit: 0 })[0].id, 'macd');
  assert.strictEqual(G.flashcards.delayLabel({ interval: 24, ease: 2.5, reps: 5, due: 0, lapses: 0 }, 'good', now), '2 mo');
});

test('state persists in localStorage key bt.flashcards and reloads', () => {
  G.flashcards.reset();
  const now = Date.UTC(2026, 0, 5, 15);
  G.flashcards.rate('theta', 'good', now);
  const raw = JSON.parse(localStorage.getItem('bt.flashcards'));
  assert.ok(raw.cards.theta && raw.cards.theta.interval === 1);
  assert.strictEqual(raw.reviews, 1);
  // simulate a reload: forget the in-memory copy by re-requiring the module into a fresh window
  const fresh = { localStorage: global.localStorage };
  const saved = global.window; global.window = fresh;
  delete require.cache[require.resolve(path.join(ROOT, 'js', 'glossary.js'))];
  require(path.join(ROOT, 'js', 'glossary.js'));
  fresh.BT.glossary.setData(glossary);
  assert.strictEqual(fresh.BT.glossary.flashcards.card('theta').interval, 1);
  assert.strictEqual(fresh.BT.glossary.flashcards.stats(now + 2 * 86400000).due, 1);
  global.window = saved;
});

test('stats() counts learned (≥3 d), mature (≥21 d), reviewedToday and daysActive', () => {
  G.flashcards.reset();
  const d1 = new Date(2026, 0, 5, 15).getTime();
  G.flashcards.rate('delta', 'good', d1);                 // 1 day
  G.flashcards.rate('gamma', 'good', d1); G.flashcards.rate('gamma', 'good', d1 + 1); // 3 days
  const st = G.flashcards.stats(d1 + 2);
  assert.strictEqual(st.seen, 2); assert.strictEqual(st.learned, 1); assert.strictEqual(st.mature, 0);
  assert.strictEqual(st.reviewedToday, 3); assert.strictEqual(st.daysActive, 1); assert.strictEqual(st.reviews, 3);
});

console.log('BT.glossary — Daily 5');

test('pick() is deterministic per day, returns 5 distinct questions from distinct lessons, differs across days', () => {
  const a = G.daily.pick('2026-03-01'), b = G.daily.pick('2026-03-01'), c = G.daily.pick('2026-03-02');
  assert.strictEqual(a.length, 5);
  assert.deepStrictEqual(a.map(q => q.id), b.map(q => q.id));
  assert.notDeepStrictEqual(a.map(q => q.id), c.map(q => q.id));
  assert.strictEqual(new Set(a.map(q => q.id)).size, 5);
  assert.strictEqual(new Set(a.map(q => q.lessonId || q.id)).size, 5, 'no two from the same lesson');
  assert.ok(a.some(q => q.difficulty === 'hard') && a.some(q => q.difficulty === 'easy'), 'mixes difficulties');
  // many days: never a duplicate inside a day, every question reachable in principle
  const seen = new Set();
  for (let d = 1; d <= 28; d++) { const p = G.daily.pick('2026-02-' + String(d).padStart(2, '0')); assert.strictEqual(new Set(p.map(q => q.id)).size, 5); p.forEach(q => seen.add(q.id)); }
  assert.ok(seen.size > 60, 'picks spread across the bank: ' + seen.size);
  assert.deepStrictEqual(G.daily.pick('2026-03-01', 3, []), []);
});

test('record()/status()/streak(): consecutive days count, a gap resets, yesterday keeps today alive', () => {
  localStorage.clear(); G.daily.reset();
  assert.strictEqual(G.daily.streak('2026-03-10'), 0);
  assert.strictEqual(G.daily.status('2026-03-10').done, false);
  G.daily.record('2026-03-08', { score: 3, total: 5 });
  G.daily.record('2026-03-09', { score: 5, total: 5 });
  assert.strictEqual(G.daily.streak('2026-03-10'), 2, 'today not done yet: streak counts back from yesterday');
  const r = G.daily.record('2026-03-10', { score: 4, total: 5, answers: [{ id: 'x', picked: 0, correct: true }] });
  assert.strictEqual(r.streak, 3); assert.strictEqual(r.best, 3);
  assert.strictEqual(G.daily.status('2026-03-10').score, 4);
  assert.strictEqual(G.daily.streak('2026-03-11'), 3);
  assert.strictEqual(G.daily.streak('2026-03-12'), 0, 'missed a day: streak gone');
  G.daily.record('2026-03-12', { score: 2, total: 5 });
  assert.strictEqual(G.daily.streak('2026-03-12'), 1);
  const st = G.daily.stats('2026-03-12');
  assert.strictEqual(st.days, 4); assert.strictEqual(st.answered, 20); assert.strictEqual(st.correct, 14); assert.strictEqual(st.pct, 70);
  assert.strictEqual(st.best, 3); assert.strictEqual(st.doneToday, true);
  assert.deepStrictEqual(G.daily.history(2).map(h => h.date), ['2026-03-12', '2026-03-10']);
  const raw = JSON.parse(localStorage.getItem('bt.daily5'));
  assert.strictEqual(raw.history['2026-03-10'].pct, 80);
});

test('date helpers: dateKey is local, shiftKey crosses month ends, dayDiff counts days', () => {
  assert.strictEqual(G.util.dateKey(new Date(2026, 0, 31, 23, 59)), '2026-01-31');
  assert.strictEqual(G.util.shiftKey('2026-01-31', 1), '2026-02-01');
  assert.strictEqual(G.util.shiftKey('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(G.util.dayDiff('2026-02-27', '2026-03-02'), 3);
  const r = G.util.rng(G.util.seedFrom('abc'));
  const x = r(); assert.ok(x >= 0 && x < 1); assert.notStrictEqual(x, r());
});

console.log('glossary.html (phone Browse layout)');

const html = fs.readFileSync(path.join(ROOT, 'glossary.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const phoneCss = (html.match(/@media \(max-width:760px\)\{([\s\S]*?)\n  \}\n<\/style>/) || [])[1] || '';

test('inline page script parses and exposes BT.glossaryPage', () => {
  assert.doesNotThrow(() => new Function(inline));
  assert.ok(inline.includes('window.BT.glossaryPage = {'));
});

test('phone (≤760px) block: sticky search bar at the top and a sticky, horizontally scrolling A–Z strip', () => {
  assert.ok(phoneCss.length > 0, 'no @media (max-width:760px) block before </style>');
  assert.ok(/\.searchbar\{top:0;/.test(phoneCss), 'search bar must stick to the top (the top bar scrolls away on phones)');
  assert.ok(/\.gl \.az\{[^}]*position:sticky/.test(phoneCss), 'A–Z strip is sticky');
  assert.ok(/\.gl \.az\{[^}]*display:flex/.test(phoneCss) && /\.gl \.az\{[^}]*overflow-x:auto/.test(phoneCss), 'A–Z strip scrolls horizontally');
  assert.ok(/\.gl \.az button\{[^}]*min-height:44px/.test(phoneCss) && /\.gl \.az button\{[^}]*min-width:44px/.test(phoneCss), 'letter buttons are 44px tap targets');
});

test('phone (≤760px) block: related-term chips are at least 44px tall', () => {
  assert.ok(/details\.term \.rel button\{[^}]*min-height:44px/.test(phoneCss));
});

test('Browse renders one letter section at a time on phones (letterMode) with previous/next letter navigation', () => {
  assert.ok(/function letterMode\(\)\s*\{\s*return isPhone\(\) && !state\.q;/.test(inline));
  assert.ok(inline.includes("matchMedia('(max-width: 760px)')"), 'uses the same phone breakpoint as js/nav.js');
  assert.ok(inline.includes('else if (letterMode()) {'), 'renderBrowse has a letter-mode branch');
  assert.ok(inline.includes('class="letter-nav"'), 'previous/next letter buttons');
  // opening a term that lives under another letter must switch sections first
  assert.ok(/if \(letterMode\(\) && state\.letter !== L\) rerender = true;/.test(inline));
  // orientation / split-view changes re-render in the right mode
  assert.ok(/phoneMQ\.addEventListener\('change', onMQ\)/.test(inline));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
