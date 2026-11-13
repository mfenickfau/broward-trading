/* Broward Trading — tests for js/i18n.js (BT.i18n, BT.t) and i18n/es.json
 * Run with:  node tests/i18n.test.js
 * Plain node + assert, no DOM (jsdom is not available). The DOM walker is a thin
 * layer over the pure parts tested here: normalisation, interpolation, dictionary
 * lookup with fallback, language switching/persistence, Intl formatters, and the
 * shape of the Spanish dictionary (placeholders must survive translation).
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
const events = [];
global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent(e) { events.push(e); } };
global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
require(path.join(ROOT, 'js', 'i18n.js'));
const I = window.BT.i18n;
const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'es.json'), 'utf8'));

let passed = 0, failed = 0;
// Tests share the module's language state, so async tests run strictly one after another.
let chain = Promise.resolve();
function report(name, e) {
  if (!e) { passed++; console.log('  ok   ' + name); return; }
  failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
}
function test(name, fn) {
  chain = chain.then(() => Promise.resolve().then(fn)).then(() => report(name), e => report(name, e));
}

console.log('BT.i18n tests');

test('module exposes the contract surface; BT.t is the programmatic helper', () => {
  ['lang', 'setLang', 'langs', 'translatePage', 'fmtNumber', 'fmtMoney', 'fmtDate', 'norm', 'interpolate', 'lookup', 'register', 't'].forEach(k => assert.ok(k in I, 'missing ' + k));
  assert.strictEqual(window.BT.t, I.t);
  assert.deepStrictEqual(I.langs.map(l => l.code), ['en', 'es']);
  assert.strictEqual(I.lang(), 'en', 'default language is English');
  assert.strictEqual(I.translatePage(), 0, 'translatePage is a no-op without a DOM');
});

test('norm(): trims, collapses whitespace including nbsp and newlines', () => {
  assert.strictEqual(I.norm('  Buy   shares\n (go long) '), 'Buy shares (go long)');
  assert.strictEqual(I.norm('Price ($)'), 'Price ($)');
  assert.strictEqual(I.norm(null), '');
  assert.strictEqual(I.norm(42), '42');
});

test('interpolate(): fills {name} placeholders, leaves unknown ones, tolerates missing vars', () => {
  assert.strictEqual(I.interpolate('Bought {qty} {symbol} @ {price}', { qty: 10, symbol: 'AAPL', price: '$190.00' }), 'Bought 10 AAPL @ $190.00');
  assert.strictEqual(I.interpolate('Step {i} of {n}', { i: 1 }), 'Step 1 of {n}');
  assert.strictEqual(I.interpolate('{n} working', { n: 0 }), '0 working', 'zero is a value, not "missing"');
  assert.strictEqual(I.interpolate('no vars here', null), 'no vars here');
  assert.strictEqual(I.interpolate('{a}{a}', { a: 'x' }), 'xx');
  assert.strictEqual(I.interpolate('{bad key} stays', { 'bad key': 1 }), '{bad key} stays');
});

test('lookup()/t(): English returns null / passthrough; unknown language is safe', () => {
  assert.strictEqual(I.lookup('Buy'), null);
  assert.strictEqual(I.t('Buy'), 'Buy');
  assert.strictEqual(I.t('Hello {name}', { name: 'Ana' }), 'Hello Ana');
  assert.strictEqual(I.lookup('Buy', 'xx'), null);
  assert.strictEqual(I.hasDict('es'), false, 'nothing fetched in Node');
});

test('register(): normalises keys, ignores non-strings, merges, attrs table consulted first for attributes', () => {
  assert.ok(I.register('es', { ui: { '  Buy  ': 'Comprar', 'Sell': 'Vender', 'Bad': 7 }, attrs: { 'Dismiss': 'Cerrar aviso' } }));
  assert.ok(I.register('es', { ui: { 'Dismiss': 'Cerrar' } }));
  assert.ok(I.hasDict('es'));
  assert.strictEqual(I.lookup('Buy', 'es'), 'Comprar');
  assert.strictEqual(I.lookup(' Buy\n', 'es'), 'Comprar', 'lookup normalises the query too');
  assert.strictEqual(I.lookup('Bad', 'es'), null);
  assert.strictEqual(I.lookup('Dismiss', 'es'), 'Cerrar', 'text nodes use the ui table');
  assert.strictEqual(I.lookup('Dismiss', 'es', 'attr'), 'Cerrar aviso', 'attributes prefer the attrs table');
  assert.strictEqual(I.lookup('Sell', 'es', 'attr'), 'Vender', '…and fall back to ui');
  assert.strictEqual(I.register('es', null), false);
  assert.strictEqual(I.register('', { ui: {} }), false);
});

test('setLang(): persists to bt.lang, switches t() and lookup(), fires bt:lang, restores English', () => {
  return I.setLang('es').then(ok => {
    assert.strictEqual(ok, true);
    assert.strictEqual(I.lang(), 'es');
    assert.strictEqual(localStorage.getItem('bt.lang'), '"es"');
    assert.strictEqual(I.t('Buy'), 'Comprar');
    assert.strictEqual(I.lookup('Buy'), 'Comprar');
    assert.strictEqual(I.t('Not in dictionary'), 'Not in dictionary', 'missing entries fall back to English');
    assert.ok(events.some(e => e.type === 'bt:lang' && e.detail.lang === 'es'));
    return I.setLang('en');
  }).then(ok => {
    assert.strictEqual(ok, true);
    assert.strictEqual(I.lang(), 'en');
    assert.strictEqual(localStorage.getItem('bt.lang'), null, 'English removes the key');
    assert.strictEqual(I.t('Buy'), 'Buy');
    return I.setLang('klingon');
  }).then(ok => {
    assert.strictEqual(ok, false, 'unknown language is refused');
    assert.strictEqual(I.lang(), 'en');
  });
});

test('t() interpolates after translating, so {vars} in the Spanish template are filled', () => {
  I.register('es', { ui: { 'Bought {qty} {symbol} @ {price}': 'Compraste {qty} {symbol} @ {price}' } });
  return I.setLang('es').then(() => {
    assert.strictEqual(I.t('Bought {qty} {symbol} @ {price}', { qty: 5, symbol: 'MSFT', price: '$400.00' }), 'Compraste 5 MSFT @ $400.00');
    assert.strictEqual(I.next().code, 'en', 'next() cycles through the language list');
    return I.setLang('en');
  });
});

test('addLang(): the language list is extensible and next() cycles through it', () => {
  assert.ok(I.addLang({ code: 'ht', label: 'Kreyòl', short: 'HT', locale: 'ht' }));
  assert.strictEqual(I.addLang({ code: 'ht' }), false, 'no duplicates');
  assert.deepStrictEqual(I.langs.map(l => l.code), ['en', 'es', 'ht']);
  assert.strictEqual(I.info('ht').label, 'Kreyòl');
  I.langs.pop(); // keep later tests on the shipped list
});

test('stored(): accepts JSON-quoted and bare values, rejects junk', () => {
  localStorage.setItem('bt.lang', '"es"'); assert.strictEqual(I.stored(), 'es');
  localStorage.setItem('bt.lang', 'es'); assert.strictEqual(I.stored(), 'es');
  localStorage.setItem('bt.lang', '"<script>"'); assert.strictEqual(I.stored(), '');
  localStorage.removeItem('bt.lang'); assert.strictEqual(I.stored(), '');
});

test('Intl formatters follow the active locale and never throw on bad input', () => {
  assert.strictEqual(I.locale(), 'en-US');
  assert.strictEqual(I.fmtMoney(1234.5), '$1,234.50');
  assert.strictEqual(I.fmtNumber(1234567.891), '1,234,567.89');
  assert.strictEqual(I.fmtPercent(12.345), '12.35%');
  assert.strictEqual(I.fmtMoney(null), '—');
  assert.strictEqual(I.fmtNumber('abc'), '—');
  assert.strictEqual(I.fmtDate('not a date'), 'not a date');
  const d = I.fmtDate('2026-01-17');
  assert.ok(/2026/.test(d) && /17/.test(d), 'daily bar time string formats as a date: ' + d);
  return I.setLang('es').then(() => {
    assert.strictEqual(I.locale(), 'es-419');
    const m = I.fmtMoney(1234.5);
    assert.ok(/1[.,  ]?234[.,]50/.test(m) && /\$/.test(m) && !/USD/.test(m), 'Spanish money uses the narrow $ symbol like the pages\' own money() helpers, never "USD": ' + m);
    const dt = I.fmtDate(new Date(2026, 0, 17));
    assert.ok(/ene/i.test(dt), 'Spanish month name: ' + dt);
    return I.setLang('en');
  });
});

test('i18n/es.json: well-formed, ≥ 900 entries, keys normalised, no empty translations', () => {
  assert.ok(es.ui && typeof es.ui === 'object');
  assert.ok(es.attrs && typeof es.attrs === 'object');
  const keys = Object.keys(es.ui);
  assert.ok(keys.length >= 900, 'only ' + keys.length + ' ui entries');
  keys.concat(Object.keys(es.attrs)).forEach(k => {
    assert.strictEqual(k, I.norm(k), 'key not normalised: ' + JSON.stringify(k));
    const v = es.ui[k] !== undefined ? es.ui[k] : es.attrs[k];
    assert.strictEqual(typeof v, 'string', 'value for ' + k);
    assert.ok(v.trim().length > 0, 'empty translation for ' + k);
  });
});

test('i18n/es.json: every {placeholder} in a key appears in its translation (BT.t templates stay fillable)', () => {
  const bad = [];
  Object.entries(es.ui).forEach(([k, v]) => {
    const want = (k.match(/\{\w+\}/g) || []).sort();
    const have = (v.match(/\{\w+\}/g) || []).sort();
    if (want.join() !== have.join()) bad.push(k + ' → ' + v);
  });
  assert.deepStrictEqual(bad, []);
  assert.ok(Object.keys(es.ui).filter(k => /\{\w+\}/.test(k)).length >= 100, 'dynamic templates present');
});

test('i18n/es.json covers the shell, order ticket, signal reasons and toasts', () => {
  ['Dashboard', 'Learn', 'Portfolio', 'More', 'Install app', 'Buy', 'Sell', 'Review order', 'Order filled', 'Order rejected',
    'Price above SMA 50', 'Price below SMA 50', 'Golden cross on this bar', 'Bought {qty} {symbol} @ {price}', 'Step {i} of {n}',
    'Why? Show the reasoning', 'Hide the reasoning', 'No trades yet. Try buying when the signal says BUY and watch what happens — it is play money.',
    'Free educational simulator. No real orders, no real money.'].forEach(k => assert.ok(es.ui[k], 'missing: ' + k));
  assert.ok(es.ui['Broward Trading'] === undefined, 'the brand name is never translated');
});

test('i18n/es.json covers the v0.4 surfaces: course home, First Week, classroom, instructor page, certificate', () => {
  const must = {
    // learn.js (course home, badge, lesson reader)
    'English only': 'Solo en inglés',
    'This content has not been translated yet and is shown in English.': null,
    '{time} left in the course ({n} lessons)': null,
    'Module {n}: {title} · lesson {i} of {total}': null,
    '{n} lessons': null,
    'Everything you learn can be practised immediately on the <a href="index.html">dashboard</a> and in <a href="replay.html">Market Replay</a> with a paper account.': null,
    'Print / Save as PDF': 'Imprimir / Guardar como PDF',
    'Mark lesson done': 'Marcar lección como hecha',
    'Not quite — the answer is {letter}.': null,
    // First Week card + start.html
    'Your first week': null, 'Your First Week': null, 'Start your first week': null, 'Continue day {day}': null,
    'Day {day} of 7 · {done} of {total} tasks done · about {time} left': null,
    'Tasks tick themselves as you use the site; manual ones have a checkbox.': null,
    'How to do it': null, 'I did this already': null, 'Locked': null, 'In progress': null, 'Honest expectations': null,
    // classroom card
    'Join a class': null, 'Class code': null, 'Display name (optional)': null, 'Join': null, 'Are you an instructor?': null,
    'Codes never contain 0, O, 1 or I. Your instructor only sees a pseudonymous id and the display name you choose.': null,
    'Copy share code': null, 'Leave class': null,
    // instructor.html
    'Your class': null, 'Create class and get a code': null, 'Copy invitation text': null, 'Roster': null,
    'Paper return': 'Rendimiento en papel', 'Last active': 'Última actividad', 'Roster CSV': 'CSV de la lista',
    'Gradebook CSV': 'CSV de calificaciones', 'Import share codes': null, 'Privacy notice': null,
    // certificate.html
    '← Back to the course': '← Volver al curso', 'Certificate of Completion': null, 'Verify this id ↗': null
  };
  Object.keys(must).forEach(k => {
    assert.ok(es.ui[k], 'missing: ' + k);
    if (must[k]) assert.strictEqual(es.ui[k], must[k]);
  });
  // onboarding.js check descriptions
  ['Lesson marked done', 'No paper trades yet', 'No journal entries yet', 'Tour finished', 'Tick the box when you have done it', '{n} of {of} cards reviewed',
    'Tour closed early. Tap the Tour button on the dashboard and go through to the last step']
    .forEach(k => assert.ok(es.ui[k], 'missing: ' + k));
  // strings the fix-up pass routed through T(): singular quiz header, crypto clock, classroom ownership / back-off states,
  // instructor secret hygiene, journal expectancy templates
  const fixups = {
    'Quiz · 1 question': 'Cuestionario · 1 pregunta',
    'Quiz · {n} questions': 'Cuestionario · {n} preguntas',
    'Crypto {time} · Open 24/7': null,
    'Rejoin with a fresh id': null,
    'Not synced yet · retrying after {when}': null,
    'This class is full (500 students). Ask your instructor to remove unused ids.': null,
    'Snapshots are limited to a few per minute. Your progress is saved on this device and will sync shortly.': null,
    'Forget secret on this device': null, 'A secret is stored on this device.': null, 'No secret stored on this device.': null, 'It is school-wide:': null,
    'Remove all students from the server': null,
    'Positive expectancy over {n} closed trades. The breakdown below shows which setups and emotions are carrying it; protect those and cut the rest.': null,
    'Positions last marked at {time}. Auto-refresh every {s} s while this tab is visible.': null,
    'Not quite — the answer is {letter}.': null, 'Module {n} · lesson {i} of {total}': null,
    'RSI {v} is oversold': null, 'ADX {v}: strong trend': null,
    'synced · {n} accounts': null, 'synced · 1 account': null, '{n} terms in {cat}. Tap a letter above, or a term to expand it.': null, 'Start session ({n} cards)': null, '{revealed} / {total} bars': null
  };
  Object.keys(fixups).forEach(k => {
    assert.ok(es.ui[k], 'missing: ' + k);
    if (fixups[k]) assert.strictEqual(es.ui[k], fixups[k]);
    assert.deepStrictEqual((es.ui[k].match(/\{\w+\}/g) || []).sort(), (k.match(/\{\w+\}/g) || []).sort(), 'placeholders preserved: ' + k);
  });
  assert.strictEqual(es._meta.entries, Object.keys(es.ui).length + Object.keys(es.attrs).length, '_meta.entries is the ui + attrs count');
});

test('i18n/es.json follows the course vocabulary: P&L stays P&L, equity is "capital", the signal badge uses verbs', () => {
  const all = Object.values(es.ui).concat(Object.values(es.attrs));
  const pg = all.filter(v => /P&G/.test(v));
  assert.deepStrictEqual(pg, [], 'use P&L (the lessons do), not P&G');
  const patrimonio = all.filter(v => /patrimonio/i.test(v));
  assert.deepStrictEqual(patrimonio, [], 'equity is "capital" in the course; never "patrimonio"');
  assert.strictEqual(es.ui['Equity curve'], 'Curva de capital');
  assert.strictEqual(es.ui['Final equity'], 'Capital final');
  assert.strictEqual(es.ui['Position size (% of equity)'], 'Tamaño de posición (% del capital)');
  assert.strictEqual(es.ui['What is equity?'], '¿Qué es el capital de la cuenta?');
  assert.strictEqual(es.ui['Total P&L'], 'P&L total');
  // BUY / SELL / HOLD are three verbs, like the Comprar / Vender ticket buttons beside the badge.
  assert.strictEqual(es.ui['BUY'], 'COMPRAR');
  assert.strictEqual(es.ui['SELL'], 'VENDER');
  assert.strictEqual(es.ui['HOLD'], 'MANTENER');
  const nouns = all.filter(v => /\b(COMPRA|VENTA)\b/.test(v));
  assert.deepStrictEqual(nouns, [], 'signal words are COMPRAR / VENDER everywhere');
});

test('loading the real dictionary: register + lookup is a Map lookup (2,000 lookups well under 50 ms)', () => {
  I.register('es', es);
  return I.setLang('es').then(() => {
    const keys = Object.keys(es.ui);
    const t0 = process.hrtime.bigint();
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (I.lookup('  ' + keys[i % keys.length] + ' ') != null) hits++;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.strictEqual(hits, 2000);
    assert.ok(ms < 50, 'took ' + ms.toFixed(1) + ' ms');
    assert.strictEqual(I.t('Dashboard'), 'Panel');
    assert.strictEqual(I.t('Step {i} of {n}', { i: 2, n: 6 }), 'Paso 2 de 6');
    return I.setLang('en');
  });
});

test('hashDict(): fingerprints content, not metadata; key order does not matter', () => {
  const a = { _meta: { version: '1' }, ui: { Buy: 'Comprar', Sell: 'Vender' }, attrs: { Search: 'Buscar' } };
  const b = { _meta: { version: '9', entries: 2 }, ui: { Sell: 'Vender', Buy: 'Comprar' }, attrs: { Search: 'Buscar' } };
  const c = { _meta: { version: '1' }, ui: { Buy: 'Comprar!', Sell: 'Vender' }, attrs: { Search: 'Buscar' } };
  const d = { _meta: { version: '1' }, ui: { Buy: 'Comprar', Sell: 'Vender' }, attrs: { Search: 'Buscar…' } };
  assert.match(I.hashDict(a), /^[0-9a-f]{8}$/);
  assert.strictEqual(I.hashDict(a), I.hashDict(b), 'same translations → same hash, whatever _meta / key order says');
  assert.notStrictEqual(I.hashDict(a), I.hashDict(c), 'a changed ui value changes the hash');
  assert.notStrictEqual(I.hashDict(a), I.hashDict(d), 'a changed attrs value changes the hash');
  assert.notStrictEqual(I.hashDict({ ui: { Buy: 'x' } }), I.hashDict({ attrs: { Buy: 'x' } }), 'tables are not interchangeable');
  const t0 = process.hrtime.bigint();
  I.hashDict(es);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 25, 'hashing the real dictionary is cheap');
});

test('load(): stale-while-revalidate refreshes a cached dictionary whose values changed without a _meta bump', () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const meta = { lang: 'xx', version: '0.4.0', entries: 2 };
  const stale = { ui: { Buy: 'Comprar-wrong', Sell: 'Vender' }, attrs: {}, _meta: meta };
  const fixed = { ui: { Buy: 'Comprar', Sell: 'Vender' }, attrs: {}, _meta: meta };   // same version, same key count
  // A returning user: the cache holds the old copy, written with the old (hash-less) record shape.
  localStorage.setItem('bt.i18n.xx', JSON.stringify({ at: 1, dict: stale }));
  const savedFetch = global.fetch;
  let fetched = 0;
  global.fetch = () => { fetched++; return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(fixed))) }); };
  return I.load('xx').then(ok => {
    assert.strictEqual(ok, true);
    assert.strictEqual(I.lookup('Buy', 'xx'), 'Comprar-wrong', 'cached copy is registered synchronously for the first render');
    return tick().then(tick);
  }).then(() => {
    assert.strictEqual(fetched, 1, 'the file was re-fetched in the background');
    assert.strictEqual(I.lookup('Buy', 'xx'), 'Comprar', 'the corrected value replaced the stale one');
    const rec = JSON.parse(localStorage.getItem('bt.i18n.xx'));
    assert.strictEqual(rec.dict.ui.Buy, 'Comprar', 'cache rewritten');
    assert.strictEqual(rec.hash, I.hashDict(fixed), 'cache record now carries the content hash');
    // A visit with identical content: the record is not rewritten (load() short-circuits on
    // an already-registered code, so the same record is replayed under a fresh code).
    rec.at = 12345;
    localStorage.setItem('bt.i18n.yy', JSON.stringify(rec));
    return I.load('yy').then(() => tick().then(tick));
  }).then(() => {
    assert.strictEqual(fetched, 2, 'yy was fetched once');
    assert.strictEqual(JSON.parse(localStorage.getItem('bt.i18n.yy')).at, 12345, 'identical content: cache record left untouched');
    global.fetch = savedFetch;
    localStorage.removeItem('bt.i18n.xx'); localStorage.removeItem('bt.i18n.yy');
    while (I.langs.length > 2) I.langs.pop(); // load() auto-added xx/yy; keep later tests on the shipped list
  }, e => { global.fetch = savedFetch; while (I.langs.length > 2) I.langs.pop(); throw e; });
});

test('nav.js integrates: its language helpers read BT.i18n.langs and the toggle markup is no-i18n', () => {
  require(path.join(ROOT, 'js', 'nav.js'));
  const N = window.BT.nav;
  assert.deepStrictEqual(N.lang.list(), I.langs);
  assert.strictEqual(N.lang.get(), 'en');
  assert.strictEqual(N.lang.next('en').code, 'es');
  assert.ok(/data-bt-lang-toggle/.test(N.html.topnav(null)));
  assert.ok(/class="lang-opts no-i18n" translate="no"/.test(N.html.sheet(null)));
});

chain.then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
