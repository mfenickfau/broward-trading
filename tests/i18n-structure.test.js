/* Broward Trading — structural parity tests for translated course content.
 * Run with:  node tests/i18n-structure.test.js
 *
 * CONTRACTS.md (v0.4): Spanish modules live in course/es/<same filename>.json
 * with identical ids, structure, `answer` indexes and chart/drill references.
 * This walks every course/es/*.json that exists next to its English original
 * and asserts the two trees have the same shape: same keys (in any order),
 * same array lengths, same block types, same ids, same quiz answer indexes,
 * same chart/drill/exercise references, same numbers/booleans/nulls, and the
 * same [[term]] glossary markers. Only translatable strings may differ.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EN_DIR = path.join(ROOT, 'course');
const ES_DIR = path.join(ROOT, 'course', 'es');

// Keys whose string values are machine-readable and must be byte-identical.
const IDENTICAL_KEYS = new Set([
  'id', 'type', 'tone', 'level', 'symbol', 'interval', 'page', 'hash',
  'drill', 'drillId', 'chart', 'module', 'lesson', 'href', 'url', 'icon',
  'key', 'term', 'file', 'kind', 'check', 'ref', 'image', 'src'
]);
// Keys whose string values are free text and may be translated.
// Anything not in either set is reported so a new field gets classified deliberately.
const TRANSLATABLE_KEYS = new Set([
  'title', 'summary', 'md', 'caption', 'label', 'q', 'explain', 'choices',
  'definition', 'def', 'description', 'why', 'steps', 'name', 'text', 'hint',
  'subtitle', 'tagline', 'note', 'prompt', 'answerText', 'section', 'short',
  'long', 'example', 'see', 'tip', 'warning', 'goal', 'body', 'intro', 'outro',
  'hints', 'disclaimer', 'objective',
  // course/firstweek.json (onboarding plan)
  'honesty', 'outcomes'
]);
// Per-file exceptions. The glossary's display names ARE the translation (a Spanish
// student browses 'Media móvil (moving average)', not 'Moving average'), and the
// Spanish file may add aliases ('bróker', 'racha'), so for course/es/glossary.json
// `term` is translatable and `aliases` arrays may differ in length. Ids stay identical,
// and a separate test below checks the English headwords survive as aliases so
// [[English term|label]] markers in course/es lessons keep resolving.
const FILE_RULES = {
  'glossary.json': { translatable: ['term', 'aliases'], freeArrays: ['aliases'] }
};
const NO_RULES = { translatable: [], freeArrays: [] };

function glossaryMarkers(s) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}
function markdownShape(s) {
  // Headings, bullets and bold markers should survive translation (count only).
  return {
    headings: (s.match(/^###\s/gm) || []).length,
    bullets: (s.match(/^-\s/gm) || []).length,
    boldBalanced: ((s.match(/\*\*/g) || []).length % 2) === 0
  };
}

function walk(en, es, where, parentKey, problems, rules) {
  rules = rules || NO_RULES;
  const te = Array.isArray(en) ? 'array' : (en === null ? 'null' : typeof en);
  const ts = Array.isArray(es) ? 'array' : (es === null ? 'null' : typeof es);
  if (te !== ts) { problems.push(where + ': type ' + te + ' vs ' + ts); return; }
  if (te === 'array') {
    if (rules.freeArrays.indexOf(parentKey) >= 0) {
      // Translation may add or drop entries (e.g. Spanish aliases); only the item type is checked.
      for (let i = 0; i < es.length; i++) if (typeof es[i] !== 'string' || !es[i].trim()) problems.push(where + '[' + i + ']: expected a non-empty string');
      return;
    }
    if (en.length !== es.length) { problems.push(where + ': length ' + en.length + ' vs ' + es.length); return; }
    for (let i = 0; i < en.length; i++) walk(en[i], es[i], where + '[' + i + ']', parentKey, problems, rules);
    return;
  }
  if (te === 'object') {
    const ke = Object.keys(en).sort(), ks = Object.keys(es).sort();
    if (ke.join('\u0000') !== ks.join('\u0000')) {
      problems.push(where + ': keys [' + ke + '] vs [' + ks + ']');
      return;
    }
    for (const k of ke) walk(en[k], es[k], where + '.' + k, k, problems, rules);
    return;
  }
  if (te === 'number' || te === 'boolean' || te === 'null') {
    if (en !== es) problems.push(where + ': ' + JSON.stringify(en) + ' vs ' + JSON.stringify(es));
    return;
  }
  // strings
  const translatableHere = rules.translatable.indexOf(parentKey) >= 0;
  if (IDENTICAL_KEYS.has(parentKey) && !translatableHere) {
    if (en !== es) problems.push(where + ': must be identical: ' + JSON.stringify(en) + ' vs ' + JSON.stringify(es));
    return;
  }
  if (!TRANSLATABLE_KEYS.has(parentKey) && !translatableHere) {
    // Unknown key: tolerate only if identical (safe default) — otherwise flag so the
    // key is added to one of the two sets above on purpose.
    if (en !== es) problems.push(where + ': unclassified key "' + parentKey + '" differs; add it to IDENTICAL_KEYS or TRANSLATABLE_KEYS');
    return;
  }
  if (!es.trim() && en.trim()) problems.push(where + ': translation is empty');
  const ge = glossaryMarkers(en).sort(), gs = glossaryMarkers(es).sort();
  if (ge.join('|') !== gs.join('|')) problems.push(where + ': [[term]] markers [' + ge + '] vs [' + gs + ']');
  if (parentKey === 'md') {
    const se = markdownShape(en), ss = markdownShape(es);
    if (se.headings !== ss.headings) problems.push(where + ': ### heading count ' + se.headings + ' vs ' + ss.headings);
    if (se.bullets !== ss.bullets) problems.push(where + ': bullet count ' + se.bullets + ' vs ' + ss.bullets);
    if (!ss.boldBalanced) problems.push(where + ': unbalanced ** in translation');
  }
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e)); }
}

console.log('course/es structural parity tests');

const esFiles = fs.existsSync(ES_DIR) ? fs.readdirSync(ES_DIR).filter(f => /\.json$/.test(f)).sort() : [];

test('course/es contains only files that exist in course/ (same filenames)', () => {
  for (const f of esFiles) assert.ok(fs.existsSync(path.join(EN_DIR, f)), 'no English original for course/es/' + f);
});

if (!esFiles.length) console.log('  (no course/es/*.json files yet; nothing to compare)');

for (const f of esFiles) {
  const enPath = path.join(EN_DIR, f), esPath = path.join(ES_DIR, f);
  let en, es;
  test(f + ': both files parse as JSON', () => {
    en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    es = JSON.parse(fs.readFileSync(esPath, 'utf8'));
  });
  if (!en || !es) continue;
  test(f + ': identical structure, ids, types, answers and references', () => {
    const problems = [];
    walk(en, es, f, '', problems, FILE_RULES[f]);
    assert.strictEqual(problems.length, 0, problems.slice(0, 15).join('\n       '));
  });
  test(f + ': translated prose actually differs from English', () => {
    // Guard against a copy of the English file masquerading as a translation.
    const enText = JSON.stringify(en), esText = JSON.stringify(es);
    assert.notStrictEqual(enText, esText, 'course/es/' + f + ' is byte-identical to the English file');
  });
}

/* ------------------------------------------------------------------ *
 * Glossary headwords: translated, and still reachable by their English name
 * ------------------------------------------------------------------ */
const ES_GLOSSARY = path.join(ES_DIR, 'glossary.json');
if (fs.existsSync(ES_GLOSSARY)) {
  const enG = JSON.parse(fs.readFileSync(path.join(EN_DIR, 'glossary.json'), 'utf8'));
  const esG = JSON.parse(fs.readFileSync(ES_GLOSSARY, 'utf8'));
  const esById = {}; esG.terms.forEach(t => { esById[t.id] = t; });

  // Headwords that stay in English on purpose: established trader English per docs/I18N.md §9
  // (RSI, MACD, ETF, spread, backtest, bid/ask, trailing stop, iron condor, covered call…),
  // Greek letters and single words that are spelled the same in Spanish.
  const ENGLISH_HEADWORD_OK = new Set([
    'backtest', 'beta', 'covered-call', 'delta', 'doji', 'gamma', 'iron-condor', 'macd', 'momentum',
    'rho', 'sector', 'stop-loss', 'straddle', 'strangle', 'theta', 'trailing-stop', 'vega'
  ]);

  test('glossary.json: every translatable English headword is translated (term differs from English)', () => {
    const same = enG.terms.filter(t => !ENGLISH_HEADWORD_OK.has(t.id) && esById[t.id] && esById[t.id].term === t.term).map(t => t.id + ' "' + t.term + '"');
    assert.deepStrictEqual(same, [], 'still English: ' + same.slice(0, 12).join(', '));
    // and the allow-list is not hiding translatable phrases: a multi-word English headword with
    // a lowercase second word ('Moving average', 'Trend line') is a phrase, never trader shorthand.
    const phrases = enG.terms.filter(t => ENGLISH_HEADWORD_OK.has(t.id) && /^[A-Z][a-z]+ [a-z]+$/.test(t.term) && !/^(Covered call|Iron condor|Trailing stop)$/.test(t.term)).map(t => t.term);
    assert.deepStrictEqual(phrases, [], 'translatable phrases on the allow-list: ' + phrases.join(', '));
    // at least some of the reviewer's examples, spelled the Spanish way
    assert.match(esById['moving-average'].term, /^Media móvil/);
    assert.match(esById['stop-order'].term, /^Orden stop/);
    assert.match(esById['head-and-shoulders'].term, /^Hombro-cabeza-hombro/);
    assert.match(esById['leverage'].term, /^Apalancamiento/);
    assert.match(esById['win-rate'].term, /^Tasa de acierto/);
    assert.match(esById['trend-line'].term, /^Línea de tendencia/);
  });

  test('glossary.json: Spanish headwords are unique and start with a capital or symbol like the English ones', () => {
    const seen = new Set();
    for (const t of esG.terms) {
      const n = t.term.toLowerCase();
      assert.ok(!seen.has(n), 'duplicate Spanish headword ' + t.term); seen.add(n);
      assert.match(t.term, /^[^a-z\s]/, t.id + ': headword should not start lowercase: ' + t.term);
    }
  });

  // Load the real course engine so the lookup used by lesson tooltips (js/learn.js →
  // BT.course.glossary.lookup) is what we test, not a copy of its key logic.
  const store = {};
  global.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k of Object.keys(store)) delete store[k]; }
  };
  global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent() {} };
  global.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new Error('404'); } });
  require(path.join(ROOT, 'js', 'course.js'));
  const C = window.BT.course;

  test('glossary.json: English headwords and aliases still resolve in the Spanish glossary (tooltips use English [[markers]])', () => {
    C.glossary.set(esG, 'es');
    const lost = [];
    for (const t of enG.terms) {
      const hit = C.glossary.lookup(t.term);
      if (!hit || hit.id !== t.id) {
        // an English collision that also happens in the English file is not a regression
        C.glossary.set(enG, 'en'); const enHit = C.glossary.lookup(t.term); C.glossary.set(esG, 'es');
        if (!enHit || enHit.id !== (hit && hit.id)) lost.push(t.term + ' → ' + (hit ? hit.id : 'null'));
      }
      for (const a of t.aliases || []) {
        const ah = C.glossary.lookup(a);
        if (!ah || ah.id !== t.id) lost.push('alias ' + a + ' → ' + (ah ? ah.id : 'null'));
      }
    }
    assert.deepStrictEqual(lost, [], 'English names no longer reach their term: ' + lost.slice(0, 10).join('; '));
  });

  test('glossary.json: every [[term]] marker in course/es/*.json resolves to the same id in both glossaries', () => {
    const bad = [];
    for (const f of esFiles) {
      const src = fs.readFileSync(path.join(ES_DIR, f), 'utf8');
      const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
      let m;
      while ((m = re.exec(src))) {
        C.glossary.set(enG, 'en'); const a = C.glossary.lookup(m[1]);
        C.glossary.set(esG, 'es'); const b = C.glossary.lookup(m[1]);
        if (!a || !b || a.id !== b.id) bad.push(f + ': [[' + m[1] + ']] → ' + (a && a.id) + ' / ' + (b && b.id));
      }
    }
    assert.deepStrictEqual(bad, [], bad.slice(0, 10).join('; '));
  });

  test('glossary.json: Spanish search terms reach the right entry (bróker, racha, caída máxima, media móvil, stop)', () => {
    C.glossary.set(esG, 'es');
    const expect = { 'bróker': 'broker', 'corredor de bolsa': 'broker', 'racha': 'losing-streak', 'caída máxima': 'drawdown', 'media móvil': 'moving-average', 'stop': 'stop-order', 'apalancamiento': 'leverage', 'dentro del dinero': 'in-the-money' };
    for (const k of Object.keys(expect)) {
      const hit = C.glossary.lookup(k);
      assert.ok(hit && hit.id === expect[k], k + ' → ' + (hit ? hit.id : 'null') + ', expected ' + expect[k]);
    }
  });

  test('glossary.json: options vocabulary matches the m5 module (masculine Greeks, dentro/fuera del dinero)', () => {
    const text = esG.terms.map(t => t.definition + ' ' + t.example).join('\n');
    assert.ok(!/\b(la|una) (delta|gamma|theta|vega|rho)\b/i.test(text), 'glossary uses feminine for a Greek; m5 uses "el delta"');
    assert.ok(/dentro del dinero/.test(text) && /fuera del dinero/.test(text), 'ITM/OTM should be taught in Spanish first');
    assert.ok(!/ratio de pago|El pago de un call/.test(text), 'payoff is not "pago" (payment)');
  });
}

// Self-test of the walker so a silent no-op cannot pass.
test('walker detects a changed answer index, block type and array length', () => {
  const a = { lessons: [{ id: 'x', blocks: [{ type: 'quiz', questions: [{ q: 'A', choices: ['1', '2'], answer: 0 }] }] }] };
  const b = JSON.parse(JSON.stringify(a)); b.lessons[0].blocks[0].questions[0].answer = 1;
  const c = JSON.parse(JSON.stringify(a)); c.lessons[0].blocks[0].type = 'text';
  const d = JSON.parse(JSON.stringify(a)); d.lessons[0].blocks[0].questions[0].choices.push('3');
  const e = JSON.parse(JSON.stringify(a)); e.lessons[0].blocks[0].questions[0].q = 'Hola [[spread]]';
  for (const bad of [b, c, d, e]) {
    const problems = [];
    walk(a, bad, 't', '', problems);
    assert.ok(problems.length > 0);
  }
  const ok = JSON.parse(JSON.stringify(a)); ok.lessons[0].blocks[0].questions[0].q = 'Hola';
  const none = []; walk(a, ok, 't', '', none);
  assert.deepStrictEqual(none, []);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
