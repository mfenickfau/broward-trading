/* Broward Trading — tests for js/nav.js (BT.nav)
 * Run with:  node tests/nav.test.js
 * Plain node + assert. nav.js is a UI module, but its page registry, active-page
 * detection, theme storage and markup builders are pure, so they are tested here
 * with a `window` shim and no DOM (mount() must be a safe no-op without one).
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
require(path.join(__dirname, '..', 'js', 'nav.js'));
const N = window.BT.nav;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

console.log('BT.nav tests');

test('module exposes the contract surface and mount() is a no-op without a DOM', () => {
  ['pages', 'activePage', 'fileOf', 'tabPages', 'morePages', 'mount', 'accordion', 'theme', 'html'].forEach(k => assert.ok(k in N, 'missing ' + k));
  assert.strictEqual(N.mount(), false);
});

test('registry lists the twelve v0.3 pages in nav order with the right files', () => {
  const files = N.pages.map(p => p.file);
  assert.deepStrictEqual(files, ['index.html', 'learn.html', 'replay.html', 'portfolio.html', 'backtest.html', 'journal.html',
    'news.html', 'compare.html', 'glossary.html', 'pricing.html', 'verify.html', 'about.html']);
  const labels = Object.fromEntries(N.pages.map(p => [p.file, p.label]));
  assert.strictEqual(labels['pricing.html'], 'Pro');
  assert.strictEqual(labels['verify.html'], 'Verify certificate');
  assert.strictEqual(labels['index.html'], 'Dashboard');
});

test('phone tab bar holds exactly Dashboard, Learn, Replay, Portfolio; the rest live behind More', () => {
  assert.deepStrictEqual(N.tabPages().map(p => p.label), ['Dashboard', 'Learn', 'Replay', 'Portfolio']);
  assert.strictEqual(N.morePages().length, N.pages.length - 4);
  assert.ok(N.morePages().some(p => p.file === 'about.html'));
});

test('fileOf() normalises pathnames', () => {
  assert.strictEqual(N.fileOf('/'), 'index.html');
  assert.strictEqual(N.fileOf(''), 'index.html');
  assert.strictEqual(N.fileOf('/broward-trading/'), 'index.html');
  assert.strictEqual(N.fileOf('/broward-trading/learn.html'), 'learn.html');
  assert.strictEqual(N.fileOf('/Learn.HTML'), 'learn.html');
  assert.strictEqual(N.fileOf('/site/replay'), 'replay.html');
  assert.strictEqual(N.fileOf('/portfolio.html?x=1#/tab'), 'portfolio.html');
});

test('activePage() finds the page from location.pathname, including GitHub Pages sub-paths', () => {
  assert.strictEqual(N.activePage('/').id, 'index');
  assert.strictEqual(N.activePage('/user/broward-trading/backtest.html').id, 'backtest');
  assert.strictEqual(N.activePage('/glossary.html').id, 'glossary');
  assert.strictEqual(N.activePage('/not-a-page.html'), null);
});

test('theme storage reads JSON-quoted and bare values, writes the JSON form app.js expects', () => {
  localStorage.clear();
  assert.strictEqual(N.theme.stored(), '');
  localStorage.setItem('bt.theme', '"light"');           // written by js/app.js / js/learn.js
  assert.strictEqual(N.theme.stored(), 'light');
  localStorage.setItem('bt.theme', 'dark');              // written by the v0.2 inline page scripts
  assert.strictEqual(N.theme.stored(), 'dark');
  localStorage.setItem('bt.theme', 'purple');
  assert.strictEqual(N.theme.stored(), '');
  localStorage.clear();
});

test('top nav markup: one link per page, active page marked with aria-current', () => {
  const html = N.html.topnav(N.activePage('/learn.html'));
  assert.ok(/<nav class="topnav" aria-label="Main">/.test(html));
  assert.strictEqual((html.match(/<a href="[a-z]+\.html"/g) || []).length, N.pages.length);
  assert.ok(/<a href="learn\.html" class="active" aria-current="page"/.test(html));
  assert.ok(!/<a href="index\.html" class="active"/.test(html));
  assert.ok(/id="themeToggle"/.test(html), 'keeps the #themeToggle id the v0.2 page scripts look up');
});

test('tab bar markup: four links + More button; More is highlighted on a secondary page', () => {
  const a = N.html.tabbar(N.activePage('/portfolio.html'));
  assert.strictEqual((a.match(/class="tab[^"]*" href=/g) || []).length, 4);
  assert.ok(/href="portfolio\.html" aria-current="page"/.test(a));
  assert.ok(/id="btMore"[^>]*aria-haspopup="dialog"/.test(a));
  assert.ok(!/class="tab on" id="btMore"/.test(a));
  const b = N.html.tabbar(N.activePage('/about.html'));
  assert.ok(/class="tab on" id="btMore"/.test(b), 'More lights up when the current page is inside it');
});

test('More sheet lists every non-tab page with a description, and a theme switch', () => {
  const html = N.html.sheet(N.activePage('/about.html'));
  N.morePages().forEach(p => assert.ok(html.includes('href="' + p.file + '"'), 'sheet lacks ' + p.file));
  N.tabPages().forEach(p => assert.ok(!html.includes('href="' + p.file + '"'), 'sheet should not repeat ' + p.file));
  assert.ok(/role="dialog" aria-modal="true"/.test(html));
  assert.ok(/data-bt-theme-toggle/.test(html));
  assert.ok(/href="about\.html" class="on" aria-current="page"/.test(html));
});

test('footer carries the disclaimer and links every page', () => {
  const html = N.html.footer();
  assert.ok(/<footer class="footer disclaimer-footer">/.test(html));
  assert.ok(html.includes('free educational simulator'));
  assert.ok(html.includes('No real orders are placed'));
  assert.ok(html.includes('href="about.html#disclaimer"'));
  assert.strictEqual((html.match(/<a href=/g) || []).length, N.pages.length);
});

test('markup escapes labels (no raw < from data)', () => {
  const bad = { id: 'x', file: 'x.html', label: '<b>x</b>', short: '<b>x</b>', tab: true, icon: 'info', desc: '"q"' };
  const saved = N.pages.slice();
  N.pages.push(bad);
  try {
    assert.ok(!N.html.topnav(null).includes('<b>x</b>'));
    assert.ok(N.html.topnav(null).includes('&lt;b&gt;x&lt;/b&gt;'));
  } finally { N.pages.length = 0; saved.forEach(p => N.pages.push(p)); }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
