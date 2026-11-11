// End-to-end smoke test. Serve the site first (python3 -m http.server 8765) then: node tests/e2e.playwright.js
// Needs the playwright npm package with Chromium installed. Not run by the unit-test files.
const { chromium } = require('playwright');
const BASE = process.env.BT_BASE_URL || 'http://localhost:8765/';
const OUT = require("path").join(__dirname, "..", "docs", "screenshots") + "/";
const PAGES = ['index.html', 'learn.html', 'portfolio.html', 'backtest.html', 'about.html'];
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const issues = [];
function note(s) { issues.push(s); console.log('  ISSUE', s); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1, colorScheme: 'dark' }); // dark: the site's default; screenshots in docs/ are the dark theme
  // Shared storage across pages so the paper trade carries over. Skip the first-run tour so it does not cover the UI.
  await context.addInitScript(() => { try { if (!localStorage.getItem('bt.tour.done')) localStorage.setItem('bt.tour.done', 'true'); } catch (e) {} });
  const page = await context.newPage();
  const errs = [];
  const extNoise = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {}; const u = loc.url || '';
    // The sandbox browser cannot reach unpkg/Google Fonts; those load failures are environment noise, not app errors.
    if (/Failed to load resource/.test(m.text()) && u && !u.startsWith('http://localhost')) { extNoise.push(u); return; }
    errs.push('[console] ' + page.url().split('/').pop() + ' ' + m.text() + ' @ ' + u);
  });
  page.on('pageerror', e => errs.push('[pageerror] ' + page.url().split('/').pop() + ' ' + e.message));
  page.on('requestfailed', r => { const u = r.url(); if (!u.startsWith('http://localhost')) return; errs.push('[requestfailed] ' + u + ' ' + (r.failure() || {}).errorText); });
  page.on('response', r => { const u = r.url(); if (u.startsWith('http://localhost') && r.status() >= 400) errs.push('[http ' + r.status() + '] ' + u); });

  async function expect(sel, label, min = 1) {
    const n = await page.locator(sel).count();
    if (n < min) note(label + ': expected ' + sel + ' (found ' + n + ')'); else console.log('  ok', label, '(' + n + ')');
  }

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(vp);
    for (const p of PAGES) {
      console.log('\n==', p, vpName);
      await page.goto(BASE + p, { waitUntil: 'load' });
      await sleep(3000);
      if (p === 'index.html') { await expect('#panel-chart canvas', 'dashboard chart canvas'); }
      if (p === 'learn.html') { await expect('.modcard', 'learn module cards', 3); }
      if (p === 'portfolio.html') { await expect('.tiles .card', 'portfolio tiles', 3); }
      if (p === 'backtest.html') { await expect('#run', 'backtest run button'); }
      if (p === 'about.html') { await expect('h1', 'about h1'); await expect('h2', 'about h2 headings', 3); }
      await expect('nav.topnav .links a', 'nav links', 5);
      await expect('footer.footer', 'footer disclaimer');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 2) note(p + ' ' + vpName + ': horizontal overflow ' + overflow + 'px');
      await page.screenshot({ path: OUT + p.replace('.html', '') + '-' + vpName + '.png', fullPage: vpName === 'phone' ? false : true });
    }
  }

  await page.setViewportSize(VIEWPORTS.desktop);

  // ---- Learn: open a lesson, answer one quiz question ----
  console.log('\n== learn flow');
  await page.goto(BASE + 'learn.html'); await sleep(1500);
  await page.locator('.modcard').first().click(); await sleep(800);
  await expect('.lessons a', 'lesson links in module view');
  // find a lesson with a quiz: walk lessons until .choice exists
  const lessonHrefs = await page.locator('.lessons a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  let quizDone = false;
  for (const h of lessonHrefs) {
    await page.goto(BASE + 'learn.html' + h); await sleep(900);
    if (await page.locator('.choice').count()) {
      await expect('.lesson-nav', 'lesson nav');
      const first = page.locator('.q').first().locator('.choice').first();
      await first.click(); await sleep(400);
      const cls = await page.locator('.q').first().locator('.choice.correct, .choice.wrong').count();
      if (!cls) note('quiz answer click did not grade'); else console.log('  ok quiz answer graded');
      await page.screenshot({ path: OUT + 'learn-lesson-quiz.png' });
      quizDone = true; break;
    }
  }
  if (!quizDone) note('no lesson with a quiz found in first module');

  // ---- Dashboard: demo market buy ----
  console.log('\n== dashboard buy flow');
  await page.goto(BASE + 'index.html'); await sleep(3000);
  const tourVisible = await page.locator('#tour:not([hidden])').count();
  if (tourVisible) { await page.click('#tourSkip'); await sleep(300); }
  const symbol = await page.evaluate(() => (window.BT && BT.app && BT.app.state && BT.app.state().symbol) || (document.getElementById('sym') || {}).value || '');
  console.log('  symbol on dashboard:', symbol);
  await page.fill('#qty', '10');
  await page.click('#review'); await sleep(400);
  if (await page.locator('#confirm:not([hidden])').count() === 0) note('order review did not open confirm box: ' + await page.locator('#tmsg').textContent());
  else { await page.click('#confirmYes'); await sleep(600); }
  const tmsg = await page.locator('#tmsg').textContent();
  console.log('  ticket message:', tmsg);
  if (!/Filled/i.test(tmsg)) note('market buy was not filled: ' + tmsg);
  const pf = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.portfolio')); } catch (e) { return null; } });
  const posKeys = pf && pf.positions ? Object.keys(pf.positions) : [];
  console.log('  positions in storage:', posKeys);
  await page.screenshot({ path: OUT + 'index-after-buy.png' });

  // ---- Portfolio: confirm position appears ----
  console.log('\n== portfolio check');
  await page.goto(BASE + 'portfolio.html'); await sleep(3000);
  const posRows = await page.locator('#positions tr').count();
  const posText = await page.locator('#positions').textContent();
  if (!posKeys.length || !posKeys.some(k => posText.includes(k))) note('position not shown on portfolio.html (rows=' + posRows + ', text=' + posText.slice(0, 120) + ')'); else console.log('  ok position shown:', posKeys[0]);
  await page.screenshot({ path: OUT + 'portfolio-with-position.png', fullPage: true });

  // ---- Backtest: run one ----
  console.log('\n== backtest run');
  await page.goto(BASE + 'backtest.html'); await sleep(3000);
  await page.click('#run'); await sleep(2500);
  const statsN = await page.locator('#stats *').count();
  const runmsg = await page.locator('#runmsg').textContent();
  console.log('  runmsg:', runmsg, '| stats children:', statsN);
  if (statsN < 4) note('backtest produced no stats: ' + runmsg);
  await expect('#panel-equity canvas, .lab canvas', 'backtest chart canvas');
  await page.screenshot({ path: OUT + 'backtest-result.png', fullPage: true });

  await browser.close();
  console.log('\n(external resource failures ignored: ' + extNoise.length + ')');
  console.log('\n==== ERRORS (' + errs.length + ')'); errs.forEach(e => console.log(' ', e));
  console.log('==== ISSUES (' + issues.length + ')'); issues.forEach(e => console.log(' ', e));
  process.exit(errs.length || issues.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
