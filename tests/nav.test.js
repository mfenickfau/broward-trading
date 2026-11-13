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

test('registry lists the eighteen v0.5 pages in nav order with the right files', () => {
  const files = N.pages.map(p => p.file);
  assert.deepStrictEqual(files, ['index.html', 'learn.html', 'start.html', 'replay.html', 'portfolio.html', 'leagues.html', 'backtest.html',
    'builder.html', 'screener.html', 'journal.html', 'news.html', 'compare.html', 'glossary.html', 'profile.html', 'pricing.html',
    'verify.html', 'instructor.html', 'about.html']);
  const labels = Object.fromEntries(N.pages.map(p => [p.file, p.label]));
  assert.strictEqual(labels['pricing.html'], 'Pro');
  assert.strictEqual(labels['verify.html'], 'Verify certificate');
  assert.strictEqual(labels['index.html'], 'Dashboard');
  assert.strictEqual(labels['start.html'], 'First Week');
  assert.strictEqual(labels['instructor.html'], 'Instructor');
  assert.ok(!files.includes('certificate.html'), 'certificate.html stays out of the nav');
  assert.strictEqual(labels['leagues.html'], 'Leagues');
  assert.strictEqual(labels['screener.html'], 'Screener');
  assert.strictEqual(labels['builder.html'], 'Strategy Builder');
  assert.strictEqual(labels['profile.html'], 'Profile');
  assert.strictEqual(N.pages.find(p => p.file === 'builder.html').short, 'Builder', 'desktop nav uses the short label');
});

test('v0.5 pages: in the desktop nav and the More sheet (not tabs), each with its own icon and a description', () => {
  const v05 = ['leagues.html', 'screener.html', 'builder.html', 'profile.html'];
  const top = N.html.topnav(null), sheet = N.html.sheet(null);
  v05.forEach(f => {
    const p = N.pages.find(x => x.file === f);
    assert.ok(p && !p.tab, f + ' is a More page');
    assert.ok(p.desc && p.desc.length > 20, f + ' has a description');
    if (f !== 'profile.html') assert.ok(top.includes('href="' + f + '"'), f + ' in the top nav');
    else assert.ok(!/<a href="profile\.html"/.test(top) && top.includes('href="profile.html"'), 'profile is reached from the level chip and More, not a plain top link');
    assert.ok(sheet.includes('href="' + f + '"'), f + ' in the More sheet');
  });
  const icons = ['trophy', 'filter', 'blocks', 'user'];
  icons.forEach(i => assert.ok(N.pages.some(p => p.icon === i), 'icon ' + i + ' used'));
  // Every icon referenced by the registry renders a real path (no fallback to the info glyph).
  const info = N.html.sheet(N.activePage('/about.html')).match(/href="about\.html"[^>]*><svg[^>]*>([\s\S]*?)<\/svg>/)[1];
  v05.forEach(f => {
    const m = sheet.match(new RegExp('href="' + f.replace('.', '\\.') + '"[^>]*><svg[^>]*>([\\s\\S]*?)<\\/svg>'));
    assert.ok(m && m[1] && m[1] !== info, f + ' has its own icon');
  });
  assert.strictEqual(N.activePage('/broward-trading/leagues').id, 'leagues');
  assert.ok(/class="tab on" id="btMore"/.test(N.html.tabbar(N.activePage('/profile.html'))), 'More lights up on Profile');
});

test('level chip: hidden without BT.xp, filled from a BT.xp summary, sits right before the theme toggle', () => {
  assert.ok(!('xp' in window.BT), 'no BT.xp in this test');
  const top = N.html.topnav(null);
  assert.ok(/<a class="levelchip" id="btLevel" href="profile\.html" hidden/.test(top), 'chip present but hidden until XP loads');
  assert.ok(/id="btLevel"[\s\S]*?<\/a><button id="themeToggle"/.test(top), 'chip is next to the theme toggle');
  assert.strictEqual(N.level.info(null), null);
  const sum = { total: 260, level: { index: 1, number: 2, name: 'Sophomore', xp: 260, pct: 20, toNext: 240, next: { name: 'Junior', min: 500 } } };
  const info = N.level.info(sum);
  assert.strictEqual(info.short, 'Lv 2');
  assert.strictEqual(info.name, 'Sophomore');
  assert.strictEqual(info.pct, 20);
  assert.ok(/Level 2: Sophomore, 260 XP, 240 XP to Junior/.test(info.label));
  const chip = N.html.levelChip(sum);
  assert.ok(!/ hidden/.test(chip) && /--lv-pct:20%/.test(chip) && />Lv 2</.test(chip) && />Sophomore</.test(chip));
  const top2 = N.level.info({ total: 6000, level: { index: 6, number: 7, name: 'Portfolio Manager', xp: 6000, pct: 100, toNext: 0, next: null } });
  assert.ok(/top level/.test(top2.label));
  const evil = N.html.levelChip({ total: 1, level: { number: 1, name: '<img src=x>', pct: 5, next: null } });
  assert.ok(!evil.includes('<img'), 'level names are escaped');
  assert.strictEqual(N.level.src(), 'js/xp.js', 'loads js/xp.js next to nav.js');
  assert.strictEqual(N.level.bind(), false, 'binding without BT.xp is a safe no-op');
});

test('nav.js lazily loads js/xp.js (async) and still queues js/i18n.js synchronously', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'nav.js'), 'utf8');
  assert.ok(/siblingSrc\('xp\.js'\)/.test(src) && /tag\.async = true/.test(src), 'xp.js injected async');
  assert.ok(/onChange\(function \(sum\)/.test(src) && /immediate: true/.test(src), 'chip subscribes to BT.xp.onChange');
  assert.ok(/ensureXp\(\);/.test(src) && /ensureI18n\(\);/.test(src));
});

test('language toggle: EN/ES in the top bar and the More sheet, codes marked no-i18n, cycles through BT.i18n.langs', () => {
  assert.deepStrictEqual(N.lang.list().map(l => l.code), ['en', 'es']);
  assert.strictEqual(N.lang.get(), 'en');
  assert.strictEqual(N.lang.next('en').code, 'es');
  assert.strictEqual(N.lang.next('es').code, 'en');
  const top = N.html.topnav(null);
  assert.ok(/data-bt-lang-toggle/.test(top), 'top nav has the toggle');
  assert.ok(/class="lang-opts no-i18n" translate="no"/.test(top), 'language codes are never translated');
  assert.ok(/data-lang="en" aria-current="true">EN</.test(top));
  assert.ok(/data-lang="es" aria-current="false">ES</.test(top));
  assert.ok(/<span class="no-i18n" translate="no">Broward Trading<\/span>/.test(top), 'brand name is not translated');
  const sheet = N.html.sheet(null);
  assert.ok(/langbtn sheet-lang/.test(sheet) && /lang-label/.test(sheet), 'sheet has a labelled language button');
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

test('top nav markup: primary links plus a More button, active page marked with aria-current', () => {
  const html = N.html.topnav(N.activePage('/learn.html'));
  assert.ok(/<nav class="topnav" aria-label="Main">/.test(html));
  const primary = N.pages.filter(p => p.top);
  assert.ok(primary.length >= 6 && primary.length <= 10, 'a short list of primary links fits at desktop width');
  assert.strictEqual((html.match(/<a href="[a-z]+\.html"/g) || []).length, primary.length);
  assert.ok(/id="btMoreTop"[^>]*aria-haspopup="dialog"[^>]*aria-controls="btSheet"/.test(html), 'More button opens the page sheet');
  assert.ok(!/class="navmore on"/.test(html), 'More is not lit on a primary page');
  // A secondary page shows its own link (marked current) and lights up More.
  const g = N.html.topnav(N.activePage('/glossary.html'));
  assert.ok(/<a href="glossary\.html" class="active" aria-current="page"/.test(g));
  assert.ok(/class="navmore on"/.test(g));
  // Every page is still reachable: primary links + the sheet.
  const sheet = N.html.sheet(null);
  N.pages.forEach(p => assert.ok(p.top || p.tab || sheet.includes('href="' + p.file + '"'), p.file + ' reachable'));
  assert.ok(/<li class="in-top"><a href="leagues\.html"/.test(sheet), 'sheet items already in the top bar are tagged for desktop hiding');
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
  const bad = { id: 'x', file: 'x.html', label: '<b>x</b>', short: '<b>x</b>', tab: true, top: true, icon: 'info', desc: '"q"' };
  const saved = N.pages.slice();
  N.pages.push(bad);
  try {
    assert.ok(!N.html.topnav(null).includes('<b>x</b>'));
    assert.ok(N.html.topnav(null).includes('&lt;b&gt;x&lt;/b&gt;'));
  } finally { N.pages.length = 0; saved.forEach(p => N.pages.push(p)); }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
