/* Broward Trading — tests for the v0.4 additions to js/course.js (BT.course)
 * Run with:  node tests/course-v04.test.js
 * Covers: language-aware loading (course/<lang>/ with English fallback and the
 * englishOnly flag), cache invalidation on the 'bt:lang' / 'bt:langchange' events,
 * the 'Up next' recommendation and the saved certificate record.
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
const listeners = {};
global.window = {
  localStorage: global.localStorage,
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  dispatchEvent(e) { (listeners[e.type] || []).forEach(fn => fn(e)); }
};

// fetch stub: a tiny virtual file system; fetched urls are logged so tests can
// check the fallback order.
const FILES = {};
const fetched = [];
global.fetch = async (url) => {
  fetched.push(url);
  if (!Object.prototype.hasOwnProperty.call(FILES, url)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(FILES[url])) };
};

require(path.join(__dirname, '..', 'js', 'course.js'));
const C = window.BT.course;

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok   ' + name); },
    e => { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); });
}

const EN_INDEX = {
  version: '0.4.0', title: 'Test Course', summary: 'en summary',
  modules: [
    { id: 'm1', title: 'One', level: 'beginner', minutes: 20, summary: '', lessons: [{ id: 'm1-l1', title: 'A', minutes: 10 }, { id: 'm1-l2', title: 'B', minutes: 10 }] },
    { id: 'm2', title: 'Two', level: 'advanced', minutes: 10, summary: '', lessons: [{ id: 'm2-l1', title: 'C', minutes: 5 }, { id: 'm2-l2', title: 'D', minutes: 5 }] }
  ]
};
const ES_INDEX = JSON.parse(JSON.stringify(EN_INDEX));
ES_INDEX.title = 'Curso de prueba'; ES_INDEX.summary = 'resumen'; ES_INDEX.modules[0].title = 'Uno'; ES_INDEX.modules[1].title = 'Dos';
const quiz = (id) => ({ type: 'quiz', questions: [{ q: id + '?', choices: ['a', 'b'], answer: 0, explain: 'x' }] });
FILES['course/index.json'] = EN_INDEX;
FILES['course/es/index.json'] = ES_INDEX;
FILES['course/m1.json'] = { id: 'm1', title: 'One', lessons: [{ id: 'm1-l1', title: 'A', minutes: 10, blocks: [{ type: 'text', md: 'hello' }, quiz('m1-l1')] }, { id: 'm1-l2', title: 'B', minutes: 10, blocks: [quiz('m1-l2')] }] };
FILES['course/es/m1.json'] = { id: 'm1', title: 'Uno', lessons: [{ id: 'm1-l1', title: 'A (es)', minutes: 10, blocks: [{ type: 'text', md: 'hola' }, quiz('m1-l1')] }, { id: 'm1-l2', title: 'B (es)', minutes: 10, blocks: [quiz('m1-l2')] }] };
FILES['course/m2.json'] = { id: 'm2', title: 'Two', lessons: [{ id: 'm2-l1', title: 'C', minutes: 5, blocks: [quiz('m2-l1')] }, { id: 'm2-l2', title: 'D', minutes: 5, blocks: [quiz('m2-l2')] }] };
// NOTE: no course/es/m2.json → must fall back to English with englishOnly:true
FILES['course/glossary.json'] = { terms: [{ id: 'rsi', term: 'RSI', definition: 'en def' }] };
FILES['course/es/glossary.json'] = { terms: [{ id: 'rsi', term: 'RSI', definition: 'def es' }] };

(async () => {
  console.log('BT.course tests (v0.4)');

  await test('public surface includes the v0.4 additions', () => {
    ['lang', 'setLang', 'fileFor', 'invalidate', 'recommend', 'certificateRecord', 'DEFAULT_LANG'].forEach(k => assert.ok(k in C, 'missing ' + k));
    assert.strictEqual(C.version, '0.4.0');
    assert.strictEqual(C.DEFAULT_LANG, 'en');
  });

  await test('lang() defaults to English; bad codes are ignored; fileFor() maps to course/<lang>/', () => {
    assert.strictEqual(C.lang(), 'en');
    assert.strictEqual(C.fileFor('index.json'), 'course/index.json');
    assert.strictEqual(C.fileFor('m1.json', 'es'), 'course/es/m1.json');
    assert.strictEqual(C.fileFor('m1.json', '../../etc'), 'course/m1.json', 'unsafe codes fall back to English');
    assert.strictEqual(C.setLang('EN'), false, 'already English → unchanged');
    assert.strictEqual(C.setLang('zz-weird-code!'), false, 'invalid → stays English');
    assert.strictEqual(C.lang(), 'en');
  });

  await test('English load: index, module and glossary come from course/ with englishOnly:false', async () => {
    fetched.length = 0;
    const idx = await C.loadIndex();
    assert.strictEqual(idx.title, 'Test Course');
    assert.strictEqual(idx.lang, 'en'); assert.strictEqual(idx.englishOnly, false);
    const m1 = await C.loadModule('m1');
    assert.strictEqual(m1.lang, 'en'); assert.strictEqual(m1.englishOnly, false);
    assert.strictEqual(m1.lessons[0].title, 'A');
    const g = await C.glossary.load();
    assert.strictEqual(g.lang, 'en'); assert.strictEqual(C.glossary.lookup('rsi').definition, 'en def');
    assert.deepStrictEqual(fetched, ['course/index.json', 'course/m1.json', 'course/glossary.json']);
  });

  await test('setLang("es") drops the caches; translated files load from course/es/, missing ones fall back with englishOnly:true', async () => {
    assert.strictEqual(C.setLang('es'), true);
    assert.strictEqual(C.lang(), 'es');
    assert.strictEqual(C.getIndex(), null, 'index cache dropped');
    assert.strictEqual(C.getModule('m1'), null, 'module cache dropped');
    assert.strictEqual(C.glossary.loaded, false, 'glossary cache dropped');
    fetched.length = 0;
    const idx = await C.loadIndex();
    assert.strictEqual(idx.title, 'Curso de prueba');
    assert.strictEqual(idx.lang, 'es'); assert.strictEqual(idx.englishOnly, false);
    assert.strictEqual(idx.modules[0].title, 'Uno');
    const m1 = await C.loadModule('m1');
    assert.strictEqual(m1.lang, 'es'); assert.strictEqual(m1.englishOnly, false);
    assert.strictEqual(m1.lessons[0].title, 'A (es)');
    const m2 = await C.loadModule('m2');
    assert.strictEqual(m2.lang, 'en'); assert.strictEqual(m2.englishOnly, true, 'no Spanish file → English fallback flagged');
    assert.strictEqual(m2.lessons[0].title, 'C');
    assert.strictEqual(C.getIndex().modules[1].englishOnly, true, 'index row learns the module is English only');
    assert.strictEqual(C.getIndex().modules[0].englishOnly, false);
    const g = await C.glossary.load();
    assert.strictEqual(g.lang, 'es'); assert.strictEqual(C.glossary.lookup('rsi').definition, 'def es');
    assert.deepStrictEqual(fetched, ['course/es/index.json', 'course/es/m1.json', 'course/es/m2.json', 'course/m2.json', 'course/es/glossary.json']);
  });

  await test('a language with no translated files at all falls back to English and flags the index englishOnly', async () => {
    C.setLang('fr');
    fetched.length = 0;
    const idx = await C.loadIndex();
    assert.strictEqual(idx.title, 'Test Course');
    assert.strictEqual(idx.lang, 'en'); assert.strictEqual(idx.englishOnly, true);
    assert.deepStrictEqual(fetched, ['course/fr/index.json', 'course/index.json']);
    const g = await C.glossary.load();
    assert.strictEqual(g.englishOnly, true); assert.strictEqual(C.glossary.englishOnly, true);
  });

  await test("the 'bt:lang' and 'bt:langchange' window events switch the language and invalidate", async () => {
    window.dispatchEvent({ type: 'bt:lang', detail: { lang: 'es' } });
    assert.strictEqual(C.lang(), 'es');
    assert.strictEqual(C.getIndex(), null);
    await C.loadIndex();
    assert.strictEqual(C.getIndex().title, 'Curso de prueba');
    window.dispatchEvent({ type: 'bt:langchange', detail: { lang: 'en' } });
    assert.strictEqual(C.lang(), 'en');
    assert.strictEqual(C.getIndex(), null);
    await C.loadIndex();
    assert.strictEqual(C.getIndex().title, 'Test Course');
  });

  await test('a language switch while a load is in flight never leaves stale data in the cache', async () => {
    C.setLang('en'); C.invalidate();
    const p = C.loadIndex();              // English fetch starts…
    C.setLang('es');                      // …and the student switches before it resolves
    const idx = await p;
    assert.strictEqual(idx.title, 'Curso de prueba', 'the promise resolves with the new language');
    assert.strictEqual(C.getIndex().lang, 'es');
    C.setLang('en');
  });

  await test('lang() reads BT.i18n.lang() when js/i18n.js is present and nothing was set explicitly', async () => {
    window.BT.i18n = { lang: () => 'es' };
    C.setLang('en'); // explicit choice wins
    assert.strictEqual(C.lang(), 'en');
    // simulate a fresh module: no explicit choice → consult i18n
    window.dispatchEvent({ type: 'bt:lang', detail: {} });   // no detail.lang → falls back to BT.i18n.lang()
    assert.strictEqual(C.lang(), 'es');
    delete window.BT.i18n;
    C.setLang('en');
  });

  /* ---- recommend() ---- */
  await test('recommend(): start → next → resume → quiz → retake → certificate → done', async () => {
    C.setLang('en'); C.invalidate(); C.resetProgress();
    await C.loadIndex();
    let r = C.recommend();
    assert.strictEqual(r.kind, 'start'); assert.strictEqual(r.lessonId, 'm1-l1'); assert.ok(r.reason);

    C.setLastLesson('m1-l1');
    r = C.recommend();
    assert.strictEqual(r.kind, 'resume'); assert.strictEqual(r.lessonId, 'm1-l1');

    C.markDone('m1-l1'); C.recordQuiz('m1-l1', 100);
    r = C.recommend();
    assert.strictEqual(r.kind, 'next'); assert.strictEqual(r.lessonId, 'm1-l2', 'the lesson after the last one opened');

    C.markDone('m1-l2');                                  // module 1 lessons done, m1-l2 quiz never taken, avg 100 from l1 → no nag; move on
    r = C.recommend();
    assert.strictEqual(r.kind, 'next'); assert.strictEqual(r.lessonId, 'm2-l1');

    C.markDone('m2-l1'); C.markDone('m2-l2');             // module 2 done but NO quiz at all → quiz
    r = C.recommend();
    assert.strictEqual(r.kind, 'quiz'); assert.strictEqual(r.moduleId, 'm2'); assert.strictEqual(r.lessonId, 'm2-l1');

    C.recordQuiz('m2-l1', 50); C.recordQuiz('m2-l2', 60);  // average 55 < 80 → retake the lowest
    r = C.recommend();
    assert.strictEqual(r.kind, 'retake'); assert.strictEqual(r.lessonId, 'm2-l1'); assert.strictEqual(r.score, 50);
    assert.ok(/50%/.test(r.reason) && /80%/.test(r.reason), r.reason);

    C.recordQuiz('m2-l1', 100); C.recordQuiz('m2-l2', 100);
    r = C.recommend();
    assert.strictEqual(r.kind, 'certificate');
    assert.strictEqual(C.certificateEligible(), true);

    const ctx = new Proxy({}, { get(_, k) { return k === 'measureText' ? () => ({ width: 10 }) : () => {}; }, set() { return true; } });
    C.certificate({ name: 'Ada', canvas: { getContext: () => ctx, toDataURL: () => 'data:,x' }, id: 'BT-2026-ABC234' });
    r = C.recommend();
    assert.strictEqual(r.kind, 'done');
    assert.deepStrictEqual(Object.keys(C.certificateRecord()).sort(), ['date', 'id', 'name', 'verified', 'verifyUrl']);
    assert.strictEqual(C.certificateRecord().id, 'BT-2026-ABC234');
  });

  await test('recommend() with no index loaded is harmless; certificateRecord() is null without a certificate', () => {
    C.invalidate(); C.resetProgress();
    assert.strictEqual(C.recommend().kind, 'none');
    assert.strictEqual(C.certificateRecord(), null);
  });

  /* ---- the real files ---- */
  await test('course/index.json: m9-crypto-etf sits after m8 with five lessons m9-l1…m9-l5 and sane minutes', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'course', 'index.json'), 'utf8'));
    const m9 = idx.modules[idx.modules.length - 1];
    assert.strictEqual(idx.modules[idx.modules.length - 2].id, 'm8-capstone');
    assert.strictEqual(m9.id, 'm9-crypto-etf');
    assert.deepStrictEqual(m9.lessons.map(l => l.id), ['m9-l1', 'm9-l2', 'm9-l3', 'm9-l4', 'm9-l5']);
    const sum = m9.lessons.reduce((s, l) => s + l.minutes, 0);
    assert.strictEqual(sum, m9.minutes, 'module minutes equal the sum of its lessons');
    assert.ok(/[Cc]rypto/.test(m9.title) && /ETF/.test(m9.title));
  });
  await test('every course/es/*.json that exists mirrors its English file: same ids, lesson order and quiz answer indexes', () => {
    const dir = path.join(__dirname, '..', 'course'), esDir = path.join(dir, 'es');
    if (!fs.existsSync(esDir)) return;                              // translations not written yet
    fs.readdirSync(esDir).filter(f => /^m\d+.*\.json$/.test(f)).forEach(f => {
      const en = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), es = JSON.parse(fs.readFileSync(path.join(esDir, f), 'utf8'));
      assert.strictEqual(es.id, en.id, f + ' id');
      assert.deepStrictEqual(es.lessons.map(l => l.id), en.lessons.map(l => l.id), f + ' lesson ids');
      en.lessons.forEach((l, i) => {
        const a = (l.blocks || []).filter(b => b.type === 'quiz').map(b => b.questions.map(q => q.answer));
        const b = (es.lessons[i].blocks || []).filter(b => b.type === 'quiz').map(b => b.questions.map(q => q.answer));
        assert.deepStrictEqual(b, a, f + ' ' + l.id + ' quiz answers');
      });
    });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
