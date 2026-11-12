/* Broward Trading — tests for js/course.js (BT.course), v0.3 additions
 * Run with:  node tests/course.test.js
 * Plain node + assert, no framework. course.js only needs a `window` shim with
 * localStorage; the canvas certificate is exercised with a tiny stub context.
 */
'use strict';
const assert = require('assert');
const path = require('path');

const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent() {} };
// fetch stub: the tests inject data with setIndex/setModule/glossary.set, but a
// forced glossary reload must resolve to null (not throw) when the file is missing.
global.fetch = async () => { throw new TypeError('Failed to fetch'); };
require(path.join(__dirname, '..', 'js', 'course.js'));
const C = window.BT.course;

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok   ' + name); },
    e => { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); });
}

const INDEX = {
  version: '0.3.0', title: 'Test Course', summary: 's',
  modules: [
    { id: 'm1', title: 'One', level: 'beginner', minutes: 20, summary: '', lessons: [{ id: 'm1-l1', title: 'A', minutes: 10 }, { id: 'm1-l2', title: 'B', minutes: 10 }] },
    { id: 'm2', title: 'Two', level: 'advanced', minutes: 0, summary: '', pro: true, lessons: [{ id: 'm2-l1', title: 'C' }, { id: 'm2-l2', title: 'D', minutes: 5 }] }
  ]
};
const GLOSSARY = {
  categories: [{ id: 'indicators', label: 'Indicators' }, { id: 'orders', label: 'Orders & execution' }],
  terms: [
    { id: 'rsi', term: 'Relative Strength Index (RSI)', aliases: ['RSI(14)'], category: 'indicators', lesson: 'm1-l2', definition: 'A momentum oscillator.', example: 'RSI below 30 is oversold.', related: ['oversold'] },
    { id: 'oversold', term: 'Oversold', aliases: [], category: 'indicators', lesson: 'm1-l2', definition: 'Fell far, fast.', example: '', related: ['rsi'] },
    { id: 'stop-order', term: 'Stop order (stop-loss)', aliases: ['stop'], category: 'orders', lesson: 'm1-l1', definition: 'Becomes a market order at the stop price.', example: '', related: [] },
    { id: 'higher-high', term: 'Higher high / higher low', aliases: [], category: 'indicators', lesson: '', definition: 'Uptrend structure.', example: '', related: [] },
    { id: 'drawdown', term: 'Drawdown', aliases: [], category: 'indicators', lesson: '', definition: 'Peak-to-trough fall.', example: '', related: [] }
  ]
};

(async () => {
  console.log('BT.course tests (v0.3)');

  await test('public surface includes the v0.3 additions', () => {
    ['renderMd', 'termsIn', 'glossary', 'timeRemaining', 'formatDuration', 'localCertId', 'isLocalCertId', 'certificate', 'moduleProgress', 'courseProgress'].forEach(k => assert.ok(k in C, 'missing ' + k));
    assert.strictEqual(C.version, '0.3.0');
  });

  /* ---- renderMd + [[terms]] ---- */
  await test('[[Term]] renders a gl-term span with the term in data-term and as the label', () => {
    const html = C.renderMd('Watch the [[RSI]] here.');
    assert.strictEqual(html, '<p>Watch the <span class="gl-term" data-term="RSI">RSI</span> here.</p>');
  });
  await test('[[Term|label]] shows the label and keeps the term', () => {
    const html = C.renderMd('an [[Oversold|oversold]] reading');
    assert.ok(html.includes('<span class="gl-term" data-term="Oversold">oversold</span>'), html);
  });
  await test('terms are escaped first, so markup inside [[ ]] cannot become HTML', () => {
    const html = C.renderMd('x [[<img src=x onerror=alert(1)>|<b>bad</b>]] y');
    assert.ok(!html.includes('<img'), html);
    assert.ok(!html.includes('<b>'), html);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), html);
  });
  await test('terms inside code spans stay literal; bold/italic around terms still work', () => {
    assert.ok(C.renderMd('use `[[RSI]]` literally').includes('<code>[[RSI]]</code>'));
    const html = C.renderMd('**strong [[RSI]]** and *em [[Drawdown|drawdowns]]*');
    assert.ok(/<strong>strong <span class="gl-term" data-term="RSI">RSI<\/span><\/strong>/.test(html), html);
    assert.ok(/<em>em <span class="gl-term" data-term="Drawdown">drawdowns<\/span><\/em>/.test(html), html);
  });
  await test('terms work in list items and headings; unmatched brackets are left alone', () => {
    const html = C.renderMd('### The [[Stop order (stop-loss)|stop]]\n\n- first [[RSI]]\n- second');
    assert.ok(html.includes('<h4>The <span class="gl-term" data-term="Stop order (stop-loss)">stop</span></h4>'), html);
    assert.ok(html.includes('<li>first <span class="gl-term" data-term="RSI">RSI</span></li>'), html);
    assert.strictEqual(C.renderMd('a [[ b ] c'), '<p>a [[ b ] c</p>');
    assert.strictEqual(C.renderMd('[[]] and [[|x]]'), '<p>[[]] and [[|x]]</p>');
  });
  await test('termsIn() lists unique terms in order', () => {
    assert.deepStrictEqual(C.termsIn('[[RSI]] then [[Oversold|oversold]] then [[rsi]] and [[Drawdown]]'), ['RSI', 'Oversold', 'Drawdown']);
    assert.deepStrictEqual(C.termsIn(''), []);
    assert.deepStrictEqual(C.termsIn(null), []);
  });

  /* ---- glossary ---- */
  await test('glossary.lookup is null before loading; set() indexes terms, aliases, ids and parentheticals', () => {
    assert.strictEqual(C.glossary.loaded, false);
    assert.strictEqual(C.glossary.lookup('RSI'), null);
    C.glossary.set(GLOSSARY);
    assert.strictEqual(C.glossary.loaded, true);
    assert.strictEqual(C.glossary.terms.length, 5);
    assert.strictEqual(C.glossary.lookup('RSI').id, 'rsi');
    assert.strictEqual(C.glossary.lookup('rsi(14)').id, 'rsi');
    assert.strictEqual(C.glossary.lookup('Relative Strength Index').id, 'rsi');
    assert.strictEqual(C.glossary.lookup('Relative Strength Index (RSI)').id, 'rsi');
    assert.strictEqual(C.glossary.lookup('stop').id, 'stop-order');
    assert.strictEqual(C.glossary.lookup('Stop order').id, 'stop-order');
    assert.strictEqual(C.glossary.lookup('stop-order').id, 'stop-order');
    assert.strictEqual(C.glossary.lookup('higher low').id, 'higher-high');
    assert.strictEqual(C.glossary.lookup('nonexistent term'), null);
  });
  await test('lookup tolerates case, plurals and hyphen/space differences', () => {
    assert.strictEqual(C.glossary.lookup('Drawdowns').id, 'drawdown');
    assert.strictEqual(C.glossary.lookup('OVERSOLD').id, 'oversold');
    assert.strictEqual(C.glossary.lookup('stop orders').id, 'stop-order');
    assert.strictEqual(C.glossary.lookup('relative-strength-index').id, 'rsi');
  });
  await test('glossary.url and categoryLabel', () => {
    assert.strictEqual(C.glossary.url(C.glossary.lookup('RSI')), 'glossary.html#term/rsi');
    assert.strictEqual(C.glossary.url('stop-order'), 'glossary.html#term/stop-order');
    assert.strictEqual(C.glossary.categoryLabel('orders'), 'Orders & execution');
    assert.strictEqual(C.glossary.categoryLabel('unknown'), 'unknown');
  });
  await test('glossary.load resolves (never rejects) when the file is unavailable, and lookup falls back to null', async () => {
    C.glossary.reset();
    assert.strictEqual(C.glossary.loaded, false);
    const r = await C.glossary.load();
    assert.strictEqual(r, null);
    assert.strictEqual(C.glossary.failed, true);
    assert.strictEqual(C.glossary.lookup('RSI'), null);
    const again = await C.glossary.load();          // remembered failure: no second fetch, still null
    assert.strictEqual(again, null);
    C.glossary.set(GLOSSARY);                        // data injected later wins
    assert.strictEqual(C.glossary.failed, false);
    const stale = await C.glossary.load(true);       // a forced reload that fails keeps the data already held
    assert.strictEqual(stale, null);
    assert.strictEqual(C.glossary.lookup('RSI').id, 'rsi');
    assert.strictEqual((await C.glossary.load()).terms.length, 5);
  });

  /* ---- index / module normalisation: pro flags ---- */
  await test('normalised index carries lesson/module pro flags (module-level pro cascades)', () => {
    const idx = C.setIndex(INDEX);
    assert.strictEqual(idx.modules[0].pro, false);
    assert.strictEqual(idx.modules[0].lessons[0].pro, false);
    assert.strictEqual(idx.modules[1].pro, true);
    assert.strictEqual(idx.modules[1].lessons[0].pro, true);
  });
  await test('normalised module keeps pro and summary per lesson and passes drill blocks through', () => {
    const mod = C.setModule({ id: 'm1', lessons: [
      { id: 'm1-l1', title: 'A', minutes: 10, pro: true, summary: 'Short.', blocks: [{ type: 'drill', drillId: 'sma-cross-msft-2024', md: 'x' }, { type: 'text', md: 'y' }, null, { nope: 1 }] },
      { id: 'm1-l2', title: 'B', minutes: 10, blocks: [] }
    ] }, 'm1');
    assert.strictEqual(mod.lessons[0].pro, true);
    assert.strictEqual(mod.lessons[0].summary, 'Short.');
    assert.strictEqual(mod.lessons[1].pro, false);
    assert.deepStrictEqual(mod.lessons[0].blocks.map(b => b.type), ['drill', 'text']);
    assert.strictEqual(mod.lessons[0].blocks[0].drillId, 'sma-cross-msft-2024');
  });

  /* ---- time remaining ---- */
  await test('timeRemaining counts undone lessons, using DEFAULT_LESSON_MINUTES when a lesson has none', () => {
    C.resetProgress();
    C.setIndex(INDEX);
    let t = C.timeRemaining();
    assert.strictEqual(t.lessons, 4);
    assert.strictEqual(t.minutes, 10 + 10 + C.DEFAULT_LESSON_MINUTES + 5);
    C.markDone('m1-l1');
    t = C.timeRemaining();
    assert.strictEqual(t.lessons, 3);
    assert.strictEqual(t.minutes, 10 + C.DEFAULT_LESSON_MINUTES + 5);
    assert.strictEqual(C.timeRemaining('m1').minutes, 10);
    assert.strictEqual(C.timeRemaining('m1').label, '10 min');
    assert.strictEqual(C.timeRemaining('nope').minutes, 0);
  });
  await test('moduleProgress / courseProgress expose minutes and minutesLeft', () => {
    const mp = C.moduleProgress('m1');
    assert.strictEqual(mp.minutes, 20); assert.strictEqual(mp.minutesLeft, 10); assert.strictEqual(mp.done, 1);
    const cp = C.courseProgress();
    assert.strictEqual(cp.minutes, 35); assert.strictEqual(cp.minutesLeft, 25); assert.strictEqual(cp.modules, 2);
    assert.deepStrictEqual(C.moduleProgress('missing'), { done: 0, total: 0, pct: 0, quizAvg: null, quizzes: 0, minutes: 0, minutesLeft: 0 });
  });
  await test('formatDuration', () => {
    assert.strictEqual(C.formatDuration(0), '0 min');
    assert.strictEqual(C.formatDuration(45), '45 min');
    assert.strictEqual(C.formatDuration(60), '1 h');
    assert.strictEqual(C.formatDuration(135), '2 h 15 min');
    assert.strictEqual(C.formatDuration(-5), '0 min');
    assert.strictEqual(C.formatDuration('x'), '0 min');
  });

  /* ---- certificate ids ---- */
  await test('localCertId() → BT-LOCAL-XXXXXX from the unambiguous alphabet, and ids are unique', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const id = C.localCertId();
      assert.ok(/^BT-LOCAL-[23456789A-HJ-NP-Z]{6}$/.test(id), id);
      assert.ok(C.isLocalCertId(id));
      seen.add(id);
    }
    assert.ok(seen.size > 190, 'ids should be random: ' + seen.size);
    assert.strictEqual(C.isLocalCertId('BT-2026-ABC234'), false);
    assert.strictEqual(C.isLocalCertId('bt-local-abc234'), true);
  });

  await test('certificate() prints a supplied id, records it with verified/verifyUrl, and record:false skips the write', () => {
    // minimal canvas stub: enough of the 2D API for the drawing code
    const calls = { texts: [] };
    const ctx = new Proxy({}, {
      get(_, k) {
        if (k === 'measureText') return (t) => ({ width: String(t).length * 10 });
        if (k === 'fillText') return (t) => { calls.texts.push(String(t)); };
        return () => {};
      },
      set() { return true; }
    });
    const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,AAAA' };
    C.resetProgress(); C.setIndex(INDEX);
    const url = C.certificate({ name: 'Ada Lovelace', canvas, id: 'bt-2026-abc234', verified: true, verifyUrl: 'https://example.test/verify.html?id=BT-2026-ABC234' });
    assert.strictEqual(url, 'data:image/png;base64,AAAA');
    assert.strictEqual(canvas.width, 1600); assert.strictEqual(canvas.height, 1130);
    assert.ok(calls.texts.includes('BT-2026-ABC234'), 'id printed');
    assert.ok(calls.texts.includes('Certificate id (verified)'));
    assert.ok(calls.texts.includes('https://example.test/verify.html?id=BT-2026-ABC234'));
    assert.ok(calls.texts.some(t => /has completed all two modules/.test(t)), 'module count from the index');
    assert.ok(calls.texts.some(t => /One · Two/.test(t)), 'module titles from the index');
    assert.deepStrictEqual(C.progress.certificate, { name: 'Ada Lovelace', date: C.progress.certificate.date, id: 'BT-2026-ABC234', verified: true, verifyUrl: 'https://example.test/verify.html?id=BT-2026-ABC234' });

    calls.texts.length = 0;
    const before = JSON.stringify(C.progress.certificate);
    C.certificate({ name: 'Preview Person', canvas, id: 'BT-PREVIEW-000000', record: false });
    assert.strictEqual(JSON.stringify(C.progress.certificate), before, 'preview must not overwrite the issued record');
    assert.ok(calls.texts.includes('Certificate id (self-issued)'));

    calls.texts.length = 0;
    C.certificate({ name: 'No Id Given', canvas });
    assert.ok(/^BT-LOCAL-[A-Z0-9]{6}$/.test(C.progress.certificate.id), 'a local id is generated when none is supplied: ' + C.progress.certificate.id);
    assert.ok(calls.texts.includes(C.progress.certificate.id));
    assert.strictEqual(C.progress.certificate.verified, false);
  });

  /* ---- the real course files ---- */
  await test('course/index.json lists eight modules with five lessons each, including m7-replay and m8-capstone', () => {
    const idx = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'course', 'index.json'), 'utf8'));
    const ids = idx.modules.map(m => m.id);
    assert.deepStrictEqual(ids, ['m1-foundations', 'm2-charts', 'm3-indicators', 'm4-risk', 'm5-options', 'm6-strategy', 'm7-replay', 'm8-capstone']);
    idx.modules.forEach(m => {
      assert.strictEqual(m.lessons.length, 5, m.id + ' lessons');
      assert.ok(/^(beginner|intermediate|advanced)$/.test(m.level), m.id + ' level');
      assert.ok(m.minutes > 0 && m.summary && m.title, m.id + ' meta');
      m.lessons.forEach(l => assert.ok(l.id && l.title && l.minutes > 0, m.id + ' lesson shape'));
    });
    const m7 = idx.modules[6], m8 = idx.modules[7];
    assert.strictEqual(m7.title, 'Practice Drills: Market Replay'); assert.strictEqual(m7.level, 'intermediate');
    assert.strictEqual(m8.title, 'Capstone: Your Trading Plan'); assert.strictEqual(m8.level, 'advanced');
    const allIds = idx.modules.flatMap(m => m.lessons.map(l => l.id));
    assert.strictEqual(new Set(allIds).size, allIds.length, 'lesson ids unique');
  });
  await test('every [[term]] used in the course modules resolves in course/glossary.json', () => {
    const fs = require('fs'), dir = path.join(__dirname, '..', 'course');
    C.glossary.set(JSON.parse(fs.readFileSync(path.join(dir, 'glossary.json'), 'utf8')));
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const missing = [];
    idx.modules.forEach(m => {
      const file = path.join(dir, m.id + '.json');
      if (!fs.existsSync(file)) return;               // a module another agent has not written yet
      const mod = JSON.parse(fs.readFileSync(file, 'utf8'));
      (mod.lessons || []).forEach(l => (l.blocks || []).forEach(b => {
        const texts = [b.md, b.caption].concat((b.questions || []).map(q => q.explain));
        texts.forEach(md => C.termsIn(md || '').forEach(t => { if (!C.glossary.lookup(t)) missing.push(m.id + ': ' + t); }));
      }));
    });
    assert.deepStrictEqual(missing, [], 'unresolved terms');
  });
  await test('every drill block in the course points at a drill in course/drills.json', () => {
    const fs = require('fs'), dir = path.join(__dirname, '..', 'course');
    const drills = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'drills.json'), 'utf8')).drills.map(d => d.id));
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const bad = [];
    idx.modules.forEach(m => {
      const file = path.join(dir, m.id + '.json');
      if (!fs.existsSync(file)) return;
      JSON.parse(fs.readFileSync(file, 'utf8')).lessons.forEach(l => (l.blocks || []).forEach(b => { if (b.type === 'drill' && !drills.has(b.drillId)) bad.push(l.id + ': ' + b.drillId); }));
    });
    assert.deepStrictEqual(bad, []);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
