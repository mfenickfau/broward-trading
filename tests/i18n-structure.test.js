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
  'hints', 'disclaimer', 'objective'
]);

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

function walk(en, es, where, parentKey, problems) {
  const te = Array.isArray(en) ? 'array' : (en === null ? 'null' : typeof en);
  const ts = Array.isArray(es) ? 'array' : (es === null ? 'null' : typeof es);
  if (te !== ts) { problems.push(where + ': type ' + te + ' vs ' + ts); return; }
  if (te === 'array') {
    if (en.length !== es.length) { problems.push(where + ': length ' + en.length + ' vs ' + es.length); return; }
    for (let i = 0; i < en.length; i++) walk(en[i], es[i], where + '[' + i + ']', parentKey, problems);
    return;
  }
  if (te === 'object') {
    const ke = Object.keys(en).sort(), ks = Object.keys(es).sort();
    if (ke.join('\u0000') !== ks.join('\u0000')) {
      problems.push(where + ': keys [' + ke + '] vs [' + ks + ']');
      return;
    }
    for (const k of ke) walk(en[k], es[k], where + '.' + k, k, problems);
    return;
  }
  if (te === 'number' || te === 'boolean' || te === 'null') {
    if (en !== es) problems.push(where + ': ' + JSON.stringify(en) + ' vs ' + JSON.stringify(es));
    return;
  }
  // strings
  if (IDENTICAL_KEYS.has(parentKey)) {
    if (en !== es) problems.push(where + ': must be identical: ' + JSON.stringify(en) + ' vs ' + JSON.stringify(es));
    return;
  }
  if (!TRANSLATABLE_KEYS.has(parentKey)) {
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
    walk(en, es, f, '', problems);
    assert.strictEqual(problems.length, 0, problems.slice(0, 15).join('\n       '));
  });
  test(f + ': translated prose actually differs from English', () => {
    // Guard against a copy of the English file masquerading as a translation.
    const enText = JSON.stringify(en), esText = JSON.stringify(es);
    assert.notStrictEqual(enText, esText, 'course/es/' + f + ' is byte-identical to the English file');
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
