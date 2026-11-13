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
    assert.ok(/1[.,  ]?234[.,]50/.test(m) && /\$|USD/.test(m), 'Spanish money: ' + m);
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
