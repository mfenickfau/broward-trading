/* Broward Trading — tests for instructor.html (page-local markup, phone layout CSS and the inline secret script).
 * Run with:  node tests/instructor-page.test.js
 * Plain node + assert, no framework, no DOM: the HTML is read as text and the inline script is parsed and
 * executed against a tiny document shim, so the engine (js/instructor.js) is exercised through BT.instructor.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'instructor.html'), 'utf8');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
console.log('instructor.html');

/* ---- roster / gradebook on phones ---- */
test('roster and gradebook pin the student column (sticky first cell) so swiped numbers stay attributable', () => {
  const m = css.match(/\.roster th:first-child,\.roster td:first-child,\.grades th:first-child,\.grades td:first-child\{([^}]*)\}/);
  assert.ok(m, 'sticky rule missing');
  assert.ok(/position:sticky/.test(m[1]) && /left:0/.test(m[1]) && /background:var\(--panel\)/.test(m[1]) && /z-index:1/.test(m[1]), m[1]);
  assert.ok(/\.roster tr\.r:hover td:first-child[^{]*\{background:var\(--panel2\)\}/.test(css), 'hover keeps the pinned cell consistent');
});

test('both wide tables sit in a .table-wrap.scroll-x with edge shadows and a phone-only swipe hint', () => {
  assert.ok(/<p class="swipe-hint">Swipe the table sideways for paper return, journal, Daily 5 and last active\./.test(html));
  assert.ok(/<p class="swipe-hint">Swipe the table sideways for every component, the total and the letter\./.test(html));
  assert.strictEqual((html.match(/class="table-wrap scroll-x/g) || []).length, 2, 'roster and gradebook wraps carry scroll-x');
  assert.ok(/\.in \.table-wrap\.scroll-x\{[\s\S]*?background-attachment:local,local,scroll,scroll\}/.test(css), 'scroll-shadow gradients');
  assert.ok(/\.swipe-hint\{display:none/.test(css), 'hint hidden on wide screens');
  assert.ok(/@media \(max-width:760px\)\{\s*\.swipe-hint\{display:block\}/.test(css), 'hint shown at ≤760px');
});

test('≤760px: sub-labels stay on one line and the pinned column has a fixed width with an ellipsis', () => {
  const phone = css.slice(css.indexOf('@media (max-width:760px){\n    .swipe-hint'));
  assert.ok(/\.roster td small,\.roster td\.num\{white-space:nowrap\}/.test(phone));
  assert.ok(/\.roster td:first-child,\.roster th:first-child\{width:132px;min-width:132px;max-width:132px\}/.test(phone));
  assert.ok(/\.roster td:first-child b,\.roster td:first-child small\{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/.test(phone));
  assert.ok(/\.grades td:first-child,\.grades th:first-child\{width:120px/.test(phone));
  assert.ok(/\.roster\{min-width:640px\}/.test(css), 'roster no longer forces 720px');
});

/* ---- student drawer ---- */
test('drawer module table has no fixed min-width, short phone headers and drops the bar below 420px', () => {
  assert.ok(!/aria-label="Module breakdown" style=/.test(html), 'inline min-width removed');
  assert.ok(/\.d-sec \.table-wrap table\.dense\{min-width:0;width:100%\}/.test(css), 'overrides .table-wrap table{min-width:480px}');
  assert.ok(/@media \(max-width:420px\)\{#drawer \.mini\{display:none\} \.d-sec th \.full\{display:none\} \.d-sec th \.short\{display:inline\}\}/.test(css));
  for (const [full, short] of [['Lessons', 'Done'], ['Progress', 'Prog.'], ['Quiz avg', 'Quiz']]) {
    assert.ok(html.includes('<span class="full">' + full + '</span><span class="short" aria-hidden="true">' + short + '</span>'), full + ' / ' + short);
  }
});

/* ---- create form + export ---- */
test('create form note spans the whole grid and export placeholders wrap', () => {
  assert.ok(/\.create \.help\{grid-column:1\/-1;display:block\}/.test(css));
  assert.ok(/\.io-grid textarea::placeholder\{white-space:pre-wrap/.test(css));
});

/* ---- instructor secret ---- */
test('secret box warns that the secret is school-wide and offers to forget it', () => {
  assert.ok(/It is school-wide:<\/b> this one secret unlocks the roster and student removal for every class on your server/.test(html));
  assert.ok(/<button type="button" class="ghost sm" id="secretForget">Forget secret on this device<\/button>/.test(html));
  assert.ok(/id="secretStatus" role="status"/.test(html));
});

test('inline script parses, and forgetting clears bt.instructor.secret through BT.instructor', () => {
  assert.doesNotThrow(() => new Function(inline));
  const store = {};
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }
  };
  const handlers = {};
  const els = {};
  const el = id => (els[id] = els[id] || { id, textContent: '', className: '', hidden: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const win = {
    localStorage: ls, addEventListener(t, f) { handlers[t] = f; },
    // no #instApp → js/instructor.js installs the engine only, not its page script
    document: { getElementById: id => (id === 'instApp' ? null : el(id)), addEventListener() {}, createElement() { return el('x' + Math.random()); }, body: { classList: { add() {}, remove() {} } }, activeElement: null },
    location: { origin: 'https://example.test', pathname: '/instructor.html' },
    matchMedia() { return { matches: false, addEventListener() {} }; }
  };
  // Load the engine only (the DOM half of js/instructor.js bails out without document.getElementById('instApp')).
  global.window = win; global.localStorage = ls; global.document = win.document;
  const src = fs.readFileSync(path.join(ROOT, 'js', 'instructor.js'), 'utf8');
  new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', src)(win, win.document, ls, setTimeout, clearTimeout);
  const I = win.BT.instructor;
  assert.ok(I && I.remote && typeof I.remote.setSecret === 'function', 'engine loaded');
  I.remote.setSecret('teacher-secret');
  assert.strictEqual(JSON.parse(store['bt.instructor']).secret, 'teacher-secret');
  new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', inline)(win, win.document, ls, setTimeout, clearTimeout);
  assert.strictEqual(el('secretStatus').textContent, 'A secret is stored on this device.');
  assert.strictEqual(el('secretForget').hidden, false);
  el('secretForget').listeners.click();
  assert.strictEqual(JSON.parse(store['bt.instructor']).secret, '', 'secret cleared from localStorage');
  assert.strictEqual(el('secretStatus').textContent, 'No secret stored on this device.');
  assert.strictEqual(el('secretForget').hidden, true);
  assert.match(el('secretMsg').textContent, /Secret forgotten on this device/);
});

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
