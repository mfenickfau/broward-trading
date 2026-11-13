// End-to-end smoke test for every page (v0.5). Serve the site first:
//   python3 -m http.server 8765
// then: node tests/e2e.playwright.js
// Needs the playwright npm package with Chromium installed. Not run by the unit-test files.
//
// What it checks, for all 19 pages at 1280x900 (desktop) and 390x844 (phone), dark theme:
//   - no console errors, page errors, failed same-origin requests or HTTP >= 400 on localhost
//   - the shared shell is mounted (top nav links, footer disclaimer, manifest link, EN/ES toggle, BT.i18n present)
//   - no horizontal overflow; the bottom tab bar is visible on phone and hidden on desktop
//   - every BT.module.fn( call in the page's scripts resolves to a function at runtime (desktop pass)
//   - screenshots to docs/screenshots/<page>-<desktop|phone>.png (deviceScaleFactor 1)
// then exercises the main flows: language toggle to Spanish and back (>= 90 % of visible text
// nodes change on index/learn/portfolio/pricing, English restored), Spanish lesson m3-l2 with a
// working quiz, m9 in both languages, lesson print button, First Week (7 days, Day 1 auto-ticks after the
// dashboard tour is walked to 'Start trading', lesson m1-l1 and three watchlist symbols),
// instructor class + share-code import, certificate from query params, dashboard buy, alerts,
// replay drill + scorecard, journal, glossary (search, flashcards, Daily 5), compare, pricing,
// verify, learn (m7 drill, m8 exam, quiz), portfolio position and a backtest run.
// v0.5 flows: league from the 'Classroom 4-week' preset, dashboard ticket switched to the league account
// (short rejected with the league reason, buy fills, coach note for the missing stop, 'Plan this trade'
// prefills qty), projector view, screener 'Oversold in an uptrend' + '+ Watchlist', builder SMA crossover →
// Backtest it → stats + rule alert, semi-auto proposal card (forced with an always-true saved rule via
// BT.app.checkRule), profile level/badges/nav chip + personality quiz, options what-if sliders, CSV upload on
// backtest.html, and Spanish on leagues/screener/builder/profile (>= 85 % of visible text changes).
// BT_E2E_V05_ONLY=1 runs only the v0.5 flows.
const { chromium } = require('playwright');
const BASE = process.env.BT_BASE_URL || 'http://localhost:8765/';
const OUT = require('path').join(__dirname, '..', 'docs', 'screenshots') + '/';
const PAGES = ['index.html', 'learn.html', 'start.html', 'replay.html', 'portfolio.html', 'backtest.html', 'journal.html',
  'news.html', 'compare.html', 'glossary.html', 'leagues.html', 'screener.html', 'builder.html', 'profile.html',
  'instructor.html', 'pricing.html', 'verify.html', 'certificate.html', 'about.html'];
// BT_E2E_V05_ONLY=1 skips the shell audit and the v0.4 flows and runs only the v0.5 flows (quicker while iterating).
const V05_ONLY = process.env.BT_E2E_V05_ONLY === '1';
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const issues = [];
function note(s) { issues.push(s); console.log('  ISSUE', s); }
function ok(s) { console.log('  ok', s); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  // dark: the site's default; screenshots in docs/ are the dark theme
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1, colorScheme: 'dark' });
  // Shared storage across pages so the paper trade carries over. Skip the first-run tour so it does not cover the UI.
  await context.addInitScript(() => { try { if (!localStorage.getItem('bt.tour.done')) localStorage.setItem('bt.tour.done', 'true'); } catch (e) {} });
  const page = await context.newPage();
  // Replay asks for confirmation before ending a drill early (and before Jump to end); accept so the flow continues.
  page.on('dialog', d => d.accept());
  const errs = [];
  const extNoise = [];
  const isLocal = u => u.startsWith(BASE) || u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1');
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {}; const u = loc.url || '';
    // The sandbox browser cannot reach unpkg/Google Fonts/APIs; those load failures are environment noise, not app errors.
    if (/Failed to load resource|net::ERR|ERR_FAILED|ERR_NAME_NOT_RESOLVED/.test(m.text()) && (!u || !isLocal(u))) { extNoise.push(u || m.text()); return; }
    errs.push('[console] ' + page.url().split('/').pop() + ' ' + m.text() + ' @ ' + u);
  });
  page.on('pageerror', e => errs.push('[pageerror] ' + page.url().split('/').pop() + ' ' + e.message));
  page.on('requestfailed', r => { const u = r.url(); if (!isLocal(u)) { extNoise.push(u); return; } errs.push('[requestfailed] ' + u + ' ' + (r.failure() || {}).errorText); });
  page.on('response', r => { const u = r.url(); if (isLocal(u) && r.status() >= 400) errs.push('[http ' + r.status() + '] ' + u + ' (from ' + page.url().split('/').pop() + ')'); });

  async function expect(sel, label, min = 1) {
    const n = await page.locator(sel).count();
    if (n < min) note(label + ': expected ' + sel + ' (found ' + n + ')'); else ok(label + ' (' + n + ')');
    return n;
  }
  async function visible(sel) {
    return page.evaluate(s => {
      const el = document.querySelector(s); if (!el) return false;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
    }, sel);
  }
  async function goto(p, wait = 2500) { await page.goto(BASE + p, { waitUntil: 'load' }); await sleep(wait); }
  async function shot(name, fullPage = false) { await page.screenshot({ path: OUT + name + '.png', fullPage }); }


  // BT.* cross-check: every `BT.module.fn(` call written in this page's scripts (inline and local files) must
  // resolve to a function at runtime when that module is loaded. Modules that are absent on a page are listed
  // only (callers guard optional modules), never counted as failures.
  async function btCallAudit(p) {
    const res = await page.evaluate(async () => {
      const texts = [];
      for (const sc of Array.from(document.scripts)) {
        if (!sc.src) { texts.push(sc.textContent); continue; }
        if (!sc.src.startsWith(location.origin)) continue;
        try { texts.push(await (await fetch(sc.src)).text()); } catch (e) { /* ignore */ }
      }
      const seen = {}, bad = [], absent = {};
      const re = /\bBT\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\(/g;
      // drop comments first: file headers say things like "js/nav.js → BT.nav (shared page shell)"
      const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
      texts.forEach(t => { t = strip(t); let m; while ((m = re.exec(t))) seen[m[1] + (m[2] ? '.' + m[2] : '')] = 1; });
      Object.keys(seen).forEach(k => {
        const [a, b] = k.split('.');
        const mod = window.BT && window.BT[a];
        if (mod === undefined) { absent[a] = 1; return; }
        if (!b) { if (typeof mod !== 'function') bad.push(k); return; }
        if (typeof mod[b] !== 'function') bad.push(k);
      });
      return { n: Object.keys(seen).length, bad, absent: Object.keys(absent) };
    });
    if (res.bad.length) note(p + ': BT calls that do not resolve to functions at runtime: ' + res.bad.join(', '));
    else ok('BT.* calls resolve (' + res.n + ' distinct' + (res.absent.length ? '; modules not loaded here: ' + res.absent.join(', ') : '') + ')');
  }

  // ---------------------------------------------------------------- shell audit, both viewports
  if (!V05_ONLY) for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(vp);
    for (const p of PAGES) {
      console.log('\n==', p, vpName);
      await goto(p, 3000);
      const name = p.replace('.html', '');
      if (p === 'index.html') { await expect('#panel-chart canvas', 'dashboard chart canvas'); await expect('#panel-alerts', 'alerts panel'); }
      if (p === 'learn.html') { await expect('.modcard', 'learn module cards', 8); }
      if (p === 'replay.html') { await expect('#startBtn', 'replay start button'); await expect('#drill option', 'drill presets', 5); }
      if (p === 'portfolio.html') { await expect('.tiles .card', 'portfolio tiles', 3); }
      if (p === 'backtest.html') { await expect('#run', 'backtest run button'); }
      if (p === 'journal.html') { await expect('#entries', 'journal entries host'); await expect('#newEntry', 'journal new entry button'); }
      if (p === 'news.html') { await expect('h1', 'news h1'); }
      if (p === 'compare.html') { await expect('#chips .chip', 'compare symbol chips', 3); }
      if (p === 'glossary.html') {
        await expect('#q', 'glossary search box');
        // Phones browse one letter section at a time (letterMode) with previous/next letter buttons; desktop lists every term.
        if (vpName === 'phone') { await expect('#results .term', 'glossary terms (one letter section)', 1); await expect('#results .letter-nav', 'glossary letter navigation'); }
        else await expect('#results .term', 'glossary terms', 100);
      }
      if (p === 'pricing.html') { await expect('#planFree', 'free plan card'); await expect('#planPro', 'pro plan card'); }
      if (p === 'verify.html') { await expect('#certId', 'verify input'); }
      if (p === 'about.html') { await expect('h1', 'about h1'); await expect('h2', 'about h2 headings', 3); }
      if (p === 'start.html') { await expect('#days .day-head', 'first-week day headers', 7); await expect('#days .task', 'first-week tasks (only the open day lists its tasks)', 3); }
      if (p === 'instructor.html') { await expect('#createForm, #newClassBtn', 'instructor create class'); await expect('#importIn', 'share-code import box'); await expect('#privacyCard', 'privacy notice'); }
      if (p === 'certificate.html') { await expect('#sheet', 'certificate sheet'); await expect('#printBtn', 'certificate print button'); }
      if (p === 'leagues.html') { await expect('#presetRow button[data-id]', 'league presets', 4); await expect('#joinCode', 'league join box'); await expect('#stProjector', 'projector button'); }
      if (p === 'screener.html') { await expect('#scanList [data-scan]', 'built-in scans', 6); await expect('#runBtn', 'run scan button'); }
      if (p === 'builder.html') { await expect('#tplList [data-tpl]', 'rule templates', 4); await expect('#btRun', 'Backtest it button'); await expect('#entryList select', 'entry condition selects', 2); }
      if (p === 'profile.html') { await expect('#app h1, #app h2', 'profile headings', 2); }
      if (vpName === 'desktop') await btCallAudit(p);
      // shared shell
      await expect('#nav [data-bt-lang-toggle]', 'language toggle in the shell');
      const i18nUp = await page.evaluate(() => !!(window.BT && BT.i18n && typeof BT.i18n.setLang === 'function') && document.documentElement.lang === 'en');
      if (!i18nUp) note(p + ': BT.i18n missing or <html lang> is not en'); else ok('BT.i18n loaded, lang=en');
      await expect('#nav nav.topnav .links a', 'nav links', 10);
      // certificate.html is deliberately hidden from the nav (linked from Learn), so it has no active link.
      if (p !== 'certificate.html') await expect('#nav nav.topnav a.active, #nav nav.topnav a[aria-current="page"]', 'active nav link');
      await expect('#footer footer.footer', 'footer disclaimer');
      await expect('link[rel="manifest"]', 'manifest link');
      await expect('meta[name="viewport"][content="width=device-width,initial-scale=1,viewport-fit=cover"]', 'viewport meta');
      const navCount = await page.locator('#nav').count(), footCount = await page.locator('#footer').count();
      if (navCount !== 1 || footCount !== 1) note(p + ': expected exactly one #nav and #footer (' + navCount + '/' + footCount + ')');
      const tabbar = await visible('#nav nav.tabbar');
      const hasTabbarClass = await page.evaluate(() => document.body.classList.contains('has-tabbar'));
      if (vpName === 'phone') {
        if (!tabbar) note(p + ' phone: bottom tab bar not visible'); else ok('tab bar visible on phone');
        if (!hasTabbarClass) note(p + ' phone: body lacks has-tabbar');
        await expect('#nav nav.tabbar .tab', 'tab bar tabs', 5);
        const small = await page.evaluate(() => Array.from(document.querySelectorAll('nav.tabbar .tab')).filter(a => a.getBoundingClientRect().height < 44).length);
        if (small) note(p + ' phone: ' + small + ' tab(s) shorter than 44px');
      } else {
        if (tabbar) note(p + ' desktop: bottom tab bar should be hidden'); else ok('tab bar hidden on desktop');
        if (hasTabbarClass) note(p + ' desktop: body should not have has-tabbar');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 2) note(p + ' ' + vpName + ': horizontal overflow ' + overflow + 'px');
      else ok('no horizontal overflow');
      await shot(name + '-' + vpName, vpName === 'desktop');
    }
  }

  // Visible text nodes that carry translatable prose: at least one run of three lowercase letters
  // (so tickers, prices, "RSI" and percentages are not counted), outside <script>/<style>/<code>/.no-i18n.
  const textSnapshot = () => page.evaluate(() => {
    const out = [];
    const skip = el => !el || el.closest('script,style,code,pre,.no-i18n,[translate="no"],noscript,template');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!/[a-záéíóúñ]{3}/i.test(t) || !/[a-z]{3}/.test(t)) continue;
      const el = n.parentElement; if (skip(el)) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      out.push(t);
    }
    return out;
  });
  const changedShare = (a, b) => { const n = Math.min(a.length, b.length); let c = 0; for (let i = 0; i < n; i++) if (a[i] !== b[i]) c++; return n ? c / n : 0; };
  async function clickLangToggle() {
    const btn = page.locator('#nav nav.topnav [data-bt-lang-toggle]').first();
    if (!await btn.count()) { note('language toggle missing in top nav'); return; }
    await btn.click();
    await page.waitForFunction(() => window.BT && BT.i18n && BT.i18n.ready, null, { timeout: 5000 }).catch(() => null);
    await page.evaluate(() => BT.i18n.ready).catch(() => null);
    await sleep(1200);
  }
  if (!V05_ONLY) {
  // ---------------------------------------------------------------- phone: More sheet
  console.log('\n== phone More sheet');
  await page.setViewportSize(VIEWPORTS.phone);
  await goto('about.html', 1500);
  if (await page.locator('#btMore').count()) {
    await page.click('#btMore'); await sleep(400);
    await expect('#btSheet .sheet-list a', 'More sheet page links', 5);
    await shot('about-phone-more');
    if (await page.locator('#btSheetClose').count()) { await page.click('#btSheetClose'); await sleep(300); }
  } else note('phone: #btMore tab missing');

  await page.setViewportSize(VIEWPORTS.desktop);

  // ---------------------------------------------------------------- i18n: nav toggle → Spanish → back to English
  console.log('\n== language toggle flow');
  for (const p of ['index.html', 'learn.html', 'portfolio.html', 'pricing.html']) {
    await goto(p, p === 'index.html' ? 3000 : 1800);
    if (await page.locator('#tour:not([hidden])').count()) { await page.click('#tourSkip'); await sleep(300); }
    const en = await textSnapshot();
    await clickLangToggle();
    const lang = await page.evaluate(() => [BT.i18n.lang(), document.documentElement.lang, localStorage.getItem('bt.lang')]);
    if (lang[0] !== 'es' || lang[1] !== 'es') note(p + ': toggle did not switch to Spanish ' + JSON.stringify(lang));
    const es = await textSnapshot();
    const share = changedShare(en, es);
    console.log('  ' + p + ': ' + en.length + ' text nodes, ' + Math.round(share * 100) + '% changed');
    if (share < 0.9) {
      const same = en.filter((t, i) => es[i] === t).slice(0, 25);
      note(p + ': only ' + Math.round(share * 100) + '% of visible text nodes changed to Spanish; untranslated e.g. ' + JSON.stringify(same));
    } else ok(p + ' translated to Spanish (' + Math.round(share * 100) + '%)');
    if (p === 'index.html' || p === 'learn.html') {
      await shot('es-' + p.replace('.html', '') + '-desktop');
      await page.setViewportSize(VIEWPORTS.phone); await sleep(600);
      await shot('es-' + p.replace('.html', '') + '-phone');
      await page.setViewportSize(VIEWPORTS.desktop); await sleep(400);
    }
    await clickLangToggle();
    const back = await textSnapshot();
    const langBack = await page.evaluate(() => [BT.i18n.lang(), document.documentElement.lang]);
    if (langBack[0] !== 'en' || langBack[1] !== 'en') note(p + ': toggle back did not restore English ' + JSON.stringify(langBack));
    // A node is "stuck in Spanish" when it still reads exactly as it did in Spanish although that text differed
    // from the English original. Clock pills and mark counters legitimately change between the two snapshots.
    const stuck = en.map((t, i) => (back[i] !== t && back[i] === es[i] && es[i] !== t) ? back[i] : null).filter(Boolean);
    const restored = en.filter((t, i) => back[i] === t).length / (en.length || 1);
    if (stuck.length || back.length !== en.length) {
      note(p + ': switching back left ' + stuck.length + ' node(s) in Spanish (' + en.length + ' vs ' + back.length + ' nodes) e.g. ' + JSON.stringify(stuck.slice(0, 10)));
    } else ok(p + ' English restored (' + Math.round(restored * 100) + '% identical, rest are live clocks/counters)');
  }

  // ---------------------------------------------------------------- Spanish course content: m3-l2 title + quiz, m9 both languages, print button
  console.log('\n== Spanish lesson flow');
  const enTitles = { 'm3-l2': 'Momentum oscillators: RSI and stochastic', 'm9-l1': 'What an ETF is and what the expense ratio costs you' };
  const esTitles = { 'm3-l2': 'Osciladores de momentum: RSI y estocástico', 'm9-l1': 'Qué es un ETF y cuánto te cuesta el ratio de gastos' };
  await goto('learn.html#/lesson/m3-l2', 1500);
  await expect('#printLesson', 'Print / Save as PDF button in the lesson reader');
  await expect('.printbar', 'print bar in the lesson reader');
  const enH1 = (await page.locator('h1').first().textContent()).trim();
  if (enH1 !== enTitles['m3-l2']) note('m3-l2 English title: ' + enH1);
  await clickLangToggle();
  await sleep(800);
  const esH1 = (await page.locator('h1').first().textContent()).trim();
  if (esH1 !== esTitles['m3-l2']) note('m3-l2 Spanish title expected "' + esTitles['m3-l2'] + '", got "' + esH1 + '"'); else ok('m3-l2 shows the Spanish title');
  if (await page.locator('.pill.enonly').count()) note('m3-l2 shows an "English only" badge although course/es/m3-indicators.json exists');
  const esChoices = await page.locator('.q .choice').count();
  if (esChoices < 2) note('m3-l2 Spanish quiz has no choices');
  else {
    const q1 = page.locator('.q').first();
    const firstChoice = (await q1.locator('.choice').first().textContent()).trim();
    await q1.locator('.choice').first().click(); await sleep(400);
    const graded = await q1.locator('.choice.correct, .choice.wrong').count();
    if (!graded) note('Spanish quiz answer did not grade'); else ok('Spanish quiz graded (choice "' + firstChoice.slice(0, 40) + '")');
    const explain = (await q1.textContent()).trim();
    if (!/[áéíóúñ¿¡]/.test(explain)) note('Spanish quiz text shows no Spanish characters: ' + explain.slice(0, 80));
  }
  await shot('es-learn-lesson-quiz');
  await goto('learn.html#/lesson/m9-l1', 1500);
  const m9es = (await page.locator('h1').first().textContent()).trim();
  if (m9es !== esTitles['m9-l1']) note('m9-l1 Spanish title: "' + m9es + '"'); else ok('m9-l1 opens in Spanish');
  await expect('.q .choice', 'm9-l1 Spanish quiz choices', 2);
  await clickLangToggle();
  await sleep(800);
  const m9en = (await page.locator('h1').first().textContent()).trim();
  if (m9en !== enTitles['m9-l1']) note('m9-l1 English title: "' + m9en + '"'); else ok('m9-l1 opens in English');
  await expect('.q .choice', 'm9-l1 English quiz choices', 2);
  await expect('#printLesson', 'print button on m9-l1');
  await shot('learn-m9-lesson');
  const langNow = await page.evaluate(() => BT.i18n.lang());
  if (langNow !== 'en') { note('language left as ' + langNow + ' after the Spanish flow'); await page.evaluate(() => BT.i18n.setLang('en')); }

  // ---------------------------------------------------------------- First Week: 7 days; Day 1 auto-ticks after the dashboard + lesson
  console.log('\n== first week flow');
  await goto('start.html', 1500);
  const dayN = await page.locator('#days .day-head').count();
  if (dayN !== 7) note('start.html shows ' + dayN + ' days, expected 7'); else ok('start.html shows 7 days');
  const doneBefore = await page.locator('#days .task.done').count();
  console.log('  tasks done before:', doneBefore);
  // Day 1: finish the tour, read lesson m1-l1, add 3 symbols of your own to the watchlist.
  // Skipping the tour only writes bt.tour.done; the First Week task needs bt.tour.finished, which js/app.js
  // writes when the student reaches the last step and taps 'Start trading' (CONTRACTS.md, Onboarding).
  await goto('index.html', 3000);
  if (await page.locator('#tour:not([hidden])').count()) { await page.click('#tourSkip'); await sleep(300); }
  if (await page.locator('#tourBtn').count()) {
    await page.click('#tourBtn'); await sleep(400);
    for (let i = 0; i < 12 && await page.locator('#tour:not([hidden])').count(); i++) { await page.click('#tourNext'); await sleep(250); }
    const tourFinished = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.tour.finished')); } catch (e) { return localStorage.getItem('bt.tour.finished'); } });
    if (await page.locator('#tour:not([hidden])').count()) note('tour did not close after walking through every step');
    else if (tourFinished !== true && tourFinished !== 'true') note('bt.tour.finished not written after "Start trading" (' + JSON.stringify(tourFinished) + ')');
    else ok('tour walked to "Start trading", bt.tour.finished set');
  } else note('dashboard: #tourBtn missing');
  const wlBefore = await page.locator('#wlList li').count();
  await page.evaluate(() => { ['GOOGL', 'META', 'JPM'].forEach(s => BT.app.addToWatchlist(s)); });
  await sleep(600);
  const wlAfter = await page.locator('#wlList li').count();
  const wlStored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.watchlist')); } catch (e) { return null; } });
  if (!Array.isArray(wlStored) || !['GOOGL', 'META', 'JPM'].every(s => wlStored.includes(s))) note('watchlist symbols were not persisted: ' + JSON.stringify(wlStored));
  else ok('watchlist: ' + wlBefore + ' -> ' + wlAfter + ' rows, stored ' + wlStored.length);
  await goto('learn.html#/lesson/m1-l1', 1500);
  if (await page.locator('#markDone').count()) { await page.click('#markDone'); await sleep(500); ok('m1-l1 marked complete'); }
  else {
    const done = await page.evaluate(() => { try { return !!JSON.parse(localStorage.getItem('bt.course')).lessonsDone['m1-l1']; } catch (e) { return false; } });
    if (!done) note('m1-l1 has no Mark complete button and is not done');
  }
  await goto('start.html', 1500);
  const d1 = await page.evaluate(() => Array.from(document.querySelectorAll('#days .task[id^="task-d1-"]')).map(li => ({ id: li.id, done: li.classList.contains('done'), state: (li.querySelector('.state') || {}).textContent })));
  console.log('  day 1 tasks:', JSON.stringify(d1));
  if (d1.length !== 3) note('Day 1 should list 3 tasks, found ' + d1.length);
  d1.forEach(t => { if (!t.done) note('Day 1 task did not auto-tick: ' + t.id + ' (' + (t.state || '').trim() + ')'); });
  if (d1.length === 3 && d1.every(t => t.done)) ok('Day 1 tasks auto-ticked');
  const d2open = await page.evaluate(() => { const b = document.querySelector('#days .day-head[data-toggle="2"]'); return b ? b.getAttribute('aria-expanded') : null; });
  console.log('  day 2 expanded:', d2open);
  await shot('start-day1-done', true);

  // ---------------------------------------------------------------- Instructor: create a class, student share code, import → roster row
  console.log('\n== instructor flow');
  await goto('instructor.html', 1500);
  if (await page.locator('#createForm:not([hidden])').count() === 0 && await page.locator('#newClassBtn').count()) { await page.click('#newClassBtn'); await sleep(300); }
  await page.fill('#cName', 'FIN 1100 Markets by Doing');
  await page.fill('#cSection', 'Tue 6pm');
  await page.fill('#cTerm', 'Spring 2027');
  await page.click('#createBtn'); await sleep(800);
  const classCode = (await page.locator('#codeBig').textContent().catch(() => '')).replace(/\s+/g, '').trim();
  console.log('  class code:', classCode);
  if (!/^[A-Z0-9]{6}$/.test(classCode)) note('instructor: class code not shown after create: "' + classCode + '" ' + (await page.locator('#createMsg').textContent().catch(() => '')));
  else ok('class created with code ' + classCode);
  const rosterEmpty = await page.locator('#rosterBody tr[data-id]').count();
  if (rosterEmpty) note('instructor: roster should be empty right after creating a class (' + rosterEmpty + ' rows)');
  // student context: join the class on learn.html and produce a share code (offline path, no backend)
  await goto('learn.html', 1500);
  const shareCode = await page.evaluate(async (code) => {
    const r = BT.classroom.join(code, 'Ada');
    if (!r || r.ok === false) return 'JOIN-FAILED ' + JSON.stringify(r);
    const snap = BT.classroom.snapshot();
    return BT.classroom.encodeShare(snap);
  }, classCode);
  console.log('  share code:', String(shareCode).slice(0, 40) + '…');
  if (!/^BT1\./.test(shareCode)) note('student share code not generated: ' + shareCode); else ok('student share code generated');
  await expect('#classCard', 'classroom card on learn.html');
  await goto('instructor.html', 1500);
  await page.fill('#importIn', 'Ada sent ' + shareCode + '\n');
  await page.click('#importBtn'); await sleep(1200);
  const importMsg = (await page.locator('#importMsg').textContent().catch(() => '')).trim();
  console.log('  import message:', importMsg);
  const rosterRows = await page.locator('#rosterBody tr[data-id]').count();
  if (rosterRows !== 1) note('instructor roster should show exactly one student after import, found ' + rosterRows + ' (' + importMsg + ')');
  else ok('roster shows one student row');
  const rosterName = (await page.locator('#rosterBody tr[data-id]').first().textContent()).trim();
  if (!/Ada/.test(rosterName)) note('roster row does not carry the display name Ada: ' + rosterName.slice(0, 80));
  await shot('instructor-roster', true);
  await page.locator('#rosterBody tr[data-id]').first().click(); await sleep(500);
  if (!await page.locator('#drawer:not([hidden])').count()) note('instructor: student drawer did not open from the roster row'); else { ok('student drawer opens'); await expect('#dModules *', 'module breakdown in drawer', 3); }
  await page.setViewportSize(VIEWPORTS.phone); await sleep(500);
  await shot('instructor-roster-phone');
  await page.setViewportSize(VIEWPORTS.desktop);

  // ---------------------------------------------------------------- Certificate from query params
  console.log('\n== certificate flow');
  await goto('certificate.html?name=Ada%20Lovelace&id=BT-2026-ABC123&date=2026-11-12&course=Technical%20Analysis%20%26%20Paper%20Trading', 1500);
  const sheet = (await page.locator('#sheet').textContent()).replace(/\s+/g, ' ');
  if (!/Ada Lovelace/.test(sheet)) note('certificate: name from params missing');
  if (!/BT-2026-ABC123/.test(sheet)) note('certificate: id from params missing');
  if (!/2026|November|noviembre/.test(sheet)) note('certificate: date from params missing');
  if (!/Broward Trading/.test(sheet)) note('certificate: Broward Trading mark missing');
  if (/Ada Lovelace/.test(sheet) && /BT-2026-ABC123/.test(sheet)) ok('certificate renders name, id and date from params');
  const verifyHref = await page.locator('#verifyLink').getAttribute('href').catch(() => null);
  if (!verifyHref || !/verify\.html/.test(verifyHref)) note('certificate: verify link missing (' + verifyHref + ')');
  await expect('#printBtn', 'certificate print button');
  await shot('certificate-params');

  // ---------------------------------------------------------------- Learn: m7 lesson with drill, m8 exam, quiz grading
  console.log('\n== learn flow');
  await goto('learn.html#/module/m7-replay', 1500);
  await expect('.lessons a', 'm7 lesson links', 5);
  await goto('learn.html#/lesson/m7-l1', 1500);
  await expect('section.drill', 'm7 drill block');
  await expect('section.drill a.go[href^="replay.html#drill="]', 'Practice in Replay button');
  const drillPill = await page.locator('section.drill [data-role=meta]').first().textContent();
  if (/not in course\/drills|No drill id/.test(drillPill || '')) note('m7 drill details did not resolve: ' + drillPill);
  await shot('learn-m7-drill');
  await goto('learn.html#/lesson/m8-l5', 1500);
  const examQ = await expect('.q .choice', 'm8 final exam choices', 10);
  if (examQ) {
    const first = page.locator('.q').first().locator('.choice').first();
    await first.click(); await sleep(400);
    const graded = await page.locator('.q').first().locator('.choice.correct, .choice.wrong').count();
    if (!graded) note('exam answer click did not grade'); else ok('exam answer graded');
    await shot('learn-m8-exam');
  }
  // original quiz check: first module
  await goto('learn.html#/lesson/m1-l1', 1200);
  if (await page.locator('.choice').count()) {
    await page.locator('.q').first().locator('.choice').first().click(); await sleep(300);
    if (!await page.locator('.q').first().locator('.choice.correct, .choice.wrong').count()) note('m1 quiz answer did not grade'); else ok('m1 quiz graded');
    await shot('learn-lesson-quiz');
  }

  // ---------------------------------------------------------------- Dashboard: demo market buy + price alert
  console.log('\n== dashboard buy + alert flow');
  await goto('index.html', 3000);
  if (await page.locator('#tour:not([hidden])').count()) { await page.click('#tourSkip'); await sleep(300); }
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
  await shot('index-after-buy');
  // alerts
  const alertsBefore = await page.locator('#alertList tr').count();
  await page.selectOption('#alertKind', 'price_above');
  await page.fill('#alertValue', '1');
  await page.click('#alertAdd'); await sleep(500);
  const alertsAfter = await page.locator('#alertList tr').count();
  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.alerts')); } catch (e) { return null; } });
  const storedN = Array.isArray(stored) ? stored.length : (stored && Array.isArray(stored.alerts) ? stored.alerts.length : 0);
  if (alertsAfter <= alertsBefore && !storedN) note('price alert did not render/persist: ' + await page.locator('#alertMsg').textContent());
  else ok('price alert added (rows ' + alertsBefore + ' -> ' + alertsAfter + ', stored ' + storedN + ')');
  await shot('index-alerts');

  // ---------------------------------------------------------------- Portfolio: confirm position appears
  console.log('\n== portfolio check');
  await goto('portfolio.html', 3000);
  const posText = await page.locator('#positions').textContent();
  if (!posKeys.length || !posKeys.some(k => posText.includes(k))) note('position not shown on portfolio.html (text=' + posText.slice(0, 120) + ')'); else ok('position shown: ' + posKeys[0]);
  await shot('portfolio-with-position', true);

  // ---------------------------------------------------------------- Replay: drill, step 5, buy, step, end -> scorecard
  console.log('\n== replay flow');
  await goto('replay.html', 2000);
  const drillVals = await page.locator('#drill option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
  if (!drillVals.length) note('no drills loaded in #drill'); else {
    await page.selectOption('#drill', drillVals[0]); await sleep(400);
    if (!await page.locator('#drillbox:not([hidden])').count()) note('drill box did not show after choosing a drill');
    await page.click('#startBtn'); await sleep(2500);
    if (!await page.locator('#session:not([hidden])').count()) note('replay session did not start: ' + await page.locator('#setupMsg').textContent());
    else {
      await expect('#chart canvas', 'replay chart canvas');
      for (let i = 0; i < 5; i++) { await page.click('#stepBtn'); await sleep(150); }
      const barBefore = await page.locator('#sBar').textContent();
      await page.fill('#qty', '5');
      await page.click('#buyBtn'); await sleep(600);
      const rmsg = await page.locator('#tmsg').textContent();
      console.log('  replay ticket:', rmsg, '| progress:', barBefore);
      await page.click('#stepBtn'); await sleep(400);
      const rpf = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.portfolio.replay')); } catch (e) { return null; } });
      const rpos = rpf && rpf.positions ? Object.keys(rpf.positions) : [];
      const rtrades = rpf && Array.isArray(rpf.trades) ? rpf.trades.length : 0;
      if (!rpos.length && !rtrades) note('replay buy produced no position/trade in bt.portfolio.replay: ' + rmsg); else ok('replay position/trade recorded: ' + (rpos[0] || rtrades + ' trades'));
      await shot('replay-session');
      await page.click('#endBtn'); await sleep(800);
      if (!await page.locator('#scorecard:not([hidden])').count()) note('scorecard not visible after End session');
      else { ok('scorecard visible'); await expect('#scoreTiles *', 'scorecard tiles', 3); }
      const sessions = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.replay.sessions')); } catch (e) { return null; } });
      if (!Array.isArray(sessions) || !sessions.length) note('bt.replay.sessions not saved'); else ok('replay session saved (' + sessions.length + ')');
      await shot('replay-scorecard', true);
    }
  }

  // ---------------------------------------------------------------- Journal: entries render (auto from trades) + manual entry
  console.log('\n== journal flow');
  await goto('journal.html', 2000);
  let entryN = await page.locator('#entries .entry').count();
  console.log('  auto entries from trades:', entryN);
  if (!entryN) {
    await page.click('#newEntry'); await sleep(400);
    if (!await page.locator('#editor:not([hidden])').count()) note('journal editor did not open');
    else {
      await page.fill('#edSymbol', 'AAPL');
      await page.fill('#edNotes', 'e2e test entry');
      await page.click('#edSave'); await sleep(500);
      entryN = await page.locator('#entries .entry').count();
    }
  }
  if (!entryN) note('no journal entry rendered: ' + (await page.locator('#edMsg').textContent().catch(() => '')));
  else ok('journal entries rendered (' + entryN + ')');
  await shot('journal-entries', true);

  // ---------------------------------------------------------------- Glossary: search, flashcard flip, Daily 5 answer
  console.log('\n== glossary flow');
  await goto('glossary.html', 2000);
  await page.fill('#q', 'moving average'); await sleep(500);
  const found = await page.locator('#results .term').count();
  const total = await page.locator('#termCount, #count').first().textContent().catch(() => '');
  if (!found) note('glossary search for "moving average" found nothing'); else ok('glossary search results: ' + found + ' (' + (total || '').trim() + ')');
  await shot('glossary-search');
  await page.click('#tab-flash'); await sleep(600);
  if (await page.locator('#fcStart:not([disabled])').count()) {
    await page.click('#fcStart'); await sleep(500);
    if (!await page.locator('#fcFlip').count()) note('flashcard flip button missing after start');
    else {
      await page.click('#fcFlip'); await sleep(400);
      if (!await page.locator('#fcAgain, .fc .back, .flashcard .back, [data-grade]').count() && !await page.locator('#fcSession button').count()) note('flashcard did not flip to answer side');
      else ok('flashcard flipped');
      await shot('glossary-flashcard');
      const good = page.locator('#fcSession button').filter({ hasText: /good/i }).first();
      if (await good.count()) { await good.click(); await sleep(300); ok('flashcard graded good'); }
    }
  } else note('flashcard Start session disabled/missing');
  await page.click('#tab-daily'); await sleep(600);
  if (await page.locator('#dStart').count()) { await page.click('#dStart'); await sleep(500); }
  const optN = await page.locator('#dailyBody .option').count();
  if (!optN) note('Daily 5: no question options rendered');
  else {
    await page.locator('#dailyBody .option').first().click(); await sleep(400);
    if (!await page.locator('#dailyBody .option.correct, #dailyBody .option.wrong').count()) note('Daily 5 answer did not grade');
    else ok('Daily 5 answer graded');
    await expect('#dNext', 'Daily 5 next button');
    await shot('glossary-daily5');
  }

  // ---------------------------------------------------------------- Compare: 3 symbols
  console.log('\n== compare flow');
  await goto('compare.html#AAPL,MSFT,SPY', 3500);
  const chips = await page.locator('#chips .chip').count();
  if (chips !== 3) note('compare: expected 3 chips for #AAPL,MSFT,SPY, got ' + chips); else ok('compare renders 3 symbols');
  await expect('#perfPane canvas', 'compare performance chart canvas');
  await expect('#corrCanvas', 'correlation matrix canvas');
  await expect('#tiles > *', 'heatmap tiles', 3);
  const rows = await page.locator('#statsTable tr').count();
  if (rows < 3) note('compare stats table has ' + rows + ' rows'); else ok('compare stats table rows: ' + rows);
  await shot('compare-3symbols', true);

  // ---------------------------------------------------------------- Pricing: not-configured state
  console.log('\n== pricing flow');
  await goto('pricing.html', 1500);
  const pill = (await page.locator('#acctPill').textContent().catch(() => '')).trim();
  if (!/not configured/i.test(pill)) note('pricing: account pill should read "not configured", got "' + pill + '"'); else ok('pricing pill: ' + pill);
  await expect('#signinForm', 'sign-in form');
  await expect('#acctBody .callout.warn', 'not-configured callout');
  // In the not-configured state the form is a disabled preview: nothing to sign in to yet.
  const disabled = await page.locator('#signinForm #email[disabled], #signinForm button[disabled]').count();
  const upgrade = (await page.locator('#btnUpgrade').textContent()).trim();
  const upgradeDisabled = await page.locator('#btnUpgrade[disabled]').count();
  if (disabled < 2) note('pricing: sign-in form should be disabled when the backend is not configured (' + disabled + ' disabled controls)');
  else ok('pricing sign-in form shows disabled not-configured preview');
  if (!upgradeDisabled || !/not available/i.test(upgrade)) note('pricing: upgrade button should be disabled with "not available yet", got "' + upgrade + '"');
  else ok('pricing upgrade button disabled: ' + upgrade);
  await shot('pricing-not-configured');

  // ---------------------------------------------------------------- Verify: unknown id
  console.log('\n== verify flow');
  await goto('verify.html', 1200);
  await page.fill('#certId', 'BT-2026-ZZZ999');
  await page.click('#btnVerify'); await sleep(800);
  const vres = (await page.locator('#result').textContent()).trim();
  console.log('  verify result:', vres.slice(0, 100).replace(/\s+/g, ' '));
  if (!/not found|not a valid|unknown|no record/i.test(vres)) note('verify: unknown id did not show a not-found state'); else ok('verify shows unknown-id state');
  await shot('verify-unknown');

  // ---------------------------------------------------------------- Backtest: run one
  console.log('\n== backtest run');
  await goto('backtest.html', 3000);
  await page.click('#run'); await sleep(2500);
  const statsN = await page.locator('#stats *').count();
  const runmsg = await page.locator('#runmsg').textContent();
  console.log('  runmsg:', runmsg, '| stats children:', statsN);
  if (statsN < 4) note('backtest produced no stats: ' + runmsg);
  await expect('#panel-equity canvas, .lab canvas', 'backtest chart canvas');
  await shot('backtest-result', true);
  } // end v0.4 flows

  // ================================================================ v0.5 flows
  async function skipTour() { if (await page.locator('#tour:not([hidden])').count()) { await page.click('#tourSkip'); await sleep(300); } }
  async function ticketSubmit() {
    await page.click('#review'); await sleep(500);
    if (await page.locator('#confirm:not([hidden])').count()) { await page.click('#confirmYes'); await sleep(800); }
    return ((await page.locator('#tmsg').textContent()) || '').trim();
  }
  async function v05Flows() {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.evaluate(() => { try { BT.i18n && BT.i18n.setLang && BT.i18n.setLang('en'); } catch (e) {} }).catch(() => null);

    // ------------------------------------------------------------ Leagues: Classroom 4-week preset → league account
    console.log('\n== v0.5 leagues flow');
    await goto('leagues.html', 1500);
    await page.click('#presetRow button[data-id="classroom"]'); await sleep(300);
    const presetOn = await page.getAttribute('#presetRow button[data-id="classroom"]', 'aria-pressed');
    if (presetOn !== 'true') note('leagues: Classroom 4-week preset not marked pressed');
    const shortChecked = await page.isChecked('#cShort');
    if (shortChecked) note('leagues: Classroom 4-week preset should turn short selling off');
    await page.fill('#cName', 'E2E Classroom Cup');
    await page.fill('#joinName', 'Ada').catch(() => null);
    await page.click('#createBtn'); await sleep(1000);
    const leagueCode = ((await page.locator('#codeShort').textContent().catch(() => '')) || '').trim();
    const longCode = await page.inputValue('#codeLong').catch(() => '');
    if (!/^[A-Z0-9]{6}$/.test(leagueCode) || !/^BTL1\./.test(longCode)) note('leagues: league code not shown after create ("' + leagueCode + '") ' + (await page.locator('#createMsg').textContent().catch(() => '')));
    else ok('league created: ' + leagueCode);
    const joined = await page.evaluate(code => { const lg = BT.leagues.get && BT.leagues.get(code); return { joined: (BT.leagues.joined ? BT.leagues.joined() : []).map(l => l.code), short: lg && lg.rules.shortSelling, cash: lg && lg.rules.startingCash }; }, leagueCode);
    if (!joined.joined.includes(leagueCode)) note('leagues: creator did not join the new league ' + JSON.stringify(joined)); else ok('creator joined the league (cash ' + joined.cash + ', shortSelling ' + joined.short + ')');
    await expect('#myList li', 'my leagues list', 1);
    await expect('#stBody tr, #stBody li, #stBody .row', 'standings rows', 1);
    await shot('leagues-created', true);
    // projector view
    await page.click('#stProjector'); await sleep(1200);
    if (!await page.locator('#proj:not([hidden])').count()) note('leagues: projector view did not open');
    else {
      const projText = ((await page.locator('#projBody').textContent()) || '').trim();
      if (!projText) note('leagues: projector body is empty'); else ok('projector view renders (' + projText.slice(0, 50).replace(/\s+/g, ' ') + '…)');
      if (!/projector=1/.test(page.url())) note('leagues: projector should set ?projector=1 in the URL');
      await shot('leagues-projector');
      await page.click('#projExit'); await sleep(400);
      if (await page.locator('#proj:not([hidden])').count()) note('leagues: projector Exit did not close it');
    }
    await page.setViewportSize(VIEWPORTS.phone); await sleep(500);
    await shot('leagues-phone-standings');
    await page.setViewportSize(VIEWPORTS.desktop);

    // dashboard: switch the ticket to the league account, rejected short, allowed buy, coach note
    console.log('\n== v0.5 league ticket flow');
    await goto('index.html', 3000);
    await skipTour();
    if (!await visible('#acctField')) note('dashboard: account switcher hidden although a league was joined');
    const acctOpts = await page.locator('#acctSel option').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent })));
    // BT.paper normalises 'league:CODE' to 'league-code'; BT.leagues.accountCode reads either form.
    const lgCodes = await page.evaluate(vals => vals.map(v => BT.leagues.accountCode(v)), acctOpts.map(o => o.v));
    const lgOpt = acctOpts.find((o, i) => lgCodes[i] === leagueCode);
    if (!lgOpt) note('dashboard: league account missing from the switcher ' + JSON.stringify(acctOpts));
    else {
      await page.selectOption('#acctSel', lgOpt.v); await sleep(800);
      const acct = await page.evaluate(() => BT.app.account());
      if (await page.evaluate(a => BT.leagues.accountCode(a), acct) !== leagueCode) note('dashboard: switching account did not take (' + acct + ')'); else ok('ticket switched to ' + lgOpt.t.trim());
      await page.click('.sides [data-side="short"]'); await sleep(200);
      await page.fill('#qty', '5');
      const shortMsg = await ticketSubmit();
      const lgPf = await page.evaluate(code => { const st = BT.paper.state; return { pos: Object.keys(st.positions || {}), trades: (st.trades || []).length }; }, leagueCode);
      if (!/short/i.test(shortMsg) || lgPf.pos.length) note('dashboard: short in a no-shorting league should be rejected with the reason, got "' + shortMsg + '" ' + JSON.stringify(lgPf));
      else ok('short rejected: ' + shortMsg.slice(0, 90));
      await shot('index-league-rejected');
      await page.click('.sides [data-side="buy"]'); await sleep(200);
      await page.fill('#qty', '10');
      const buyMsg = await ticketSubmit();
      const after = await page.evaluate(() => Object.keys(BT.paper.state.positions || {}));
      if (!/Filled/i.test(buyMsg) || !after.length) note('dashboard: allowed league buy did not fill: ' + buyMsg);
      else ok('league buy filled: ' + buyMsg.slice(0, 80));
      // coach: this buy had no stop, so the coach should say so
      await sleep(400);
      const coach = await page.evaluate(() => { const b = document.getElementById('coachNotes'); return b && !b.hidden ? b.textContent.replace(/\s+/g, ' ') : ''; });
      if (!coach) note('dashboard: no coach note after a trade without a stop');
      else if (!/stop/i.test(coach)) note('dashboard: coach note does not mention the missing stop: ' + coach.slice(0, 120));
      else ok('coach note after a no-stop trade: ' + coach.slice(0, 80));
      await shot('index-coach');
      // risk panel: entering a stop prefills the quantity
      await page.evaluate(() => { const b = document.getElementById('planBox'); if (b) b.open = true; });
      await sleep(300);
      const price = await page.evaluate(() => BT.app.state().bars.slice(-1)[0].close);
      const qtyBefore = await page.inputValue('#qty');
      await page.fill('#planRisk', '0.5');
      await page.fill('#planStop', (price * 0.97).toFixed(2)); await sleep(900);
      const qtyAfter = await page.inputValue('#qty');
      const planSum = ((await page.locator('#planSummary').textContent()) || '').trim();
      const planShares = await page.evaluate(() => { const p = BT.app.plan(); return p && p.shares; });
      if (!(planShares > 0) || String(planShares) !== qtyAfter) note('risk panel did not prefill qty (plan ' + planShares + ', qty ' + qtyBefore + ' -> ' + qtyAfter + ', "' + planSum + '")');
      else ok('risk panel prefilled qty ' + qtyBefore + ' -> ' + qtyAfter + ' (' + planSum + ')');
      await shot('index-plan');
      await page.evaluate(() => { const b = document.getElementById('planBox'); if (b) b.open = false; });
      // back to Main for the rest of the run
      await page.selectOption('#acctSel', 'main'); await sleep(500);
    }

    // ------------------------------------------------------------ Screener: built-in scan on demo data, + Watchlist
    console.log('\n== v0.5 screener flow');
    await page.evaluate(() => localStorage.setItem('bt.watchlist', JSON.stringify(['SPY'])));
    await goto('screener.html', 2000);
    const scanBtn = page.locator('#scanList [data-scan]').filter({ hasText: 'Oversold in an uptrend' }).first();
    if (!await scanBtn.count()) note('screener: built-in "Oversold in an uptrend" scan missing');
    else {
      await scanBtn.click(); await sleep(400);
      await page.click('#runBtn');
      await page.waitForFunction(() => !/scanning|Scanning/.test((document.getElementById('status') || {}).textContent || '') && (document.getElementById('runBtn') || {}).disabled !== true, null, { timeout: 15000 }).catch(() => null);
      await sleep(800);
      const status = ((await page.locator('#status').textContent()) || '').trim();
      const resCount = ((await page.locator('#resCount').textContent()) || '').trim();
      const rowsN = await page.locator('#resTable tbody tr, #resCards > *').count();
      const emptyShown = await visible('#empty');
      if (!rowsN && !emptyShown) note('screener: scan finished with neither rows nor an empty state (' + status + ')');
      else ok('screener ran "Oversold in an uptrend": ' + (resCount || rowsN + ' rows') + ' | ' + status.slice(0, 80));
      await shot('screener-oversold', true);
    }
    // run the default scan list until one has a result we can add (the demo data decides which)
    let watchBtn = page.locator('[data-watch]:visible').first();
    if (!await watchBtn.count()) {
      const ids = await page.locator('#scanList [data-scan]').evaluateAll(bs => bs.map(b => b.getAttribute('data-scan')));
      for (const id of ids) {
        await page.click('#scanList [data-scan="' + id + '"]'); await sleep(300);
        await page.click('#runBtn'); await sleep(2500);
        watchBtn = page.locator('[data-watch]:visible').first();
        if (await watchBtn.count()) break;
      }
    }
    if (!await watchBtn.count()) note('screener: no scan returned a row with "+ Watchlist" on demo data');
    else {
      const sym = await watchBtn.getAttribute('data-watch');
      await watchBtn.click(); await sleep(500);
      const wl = await page.evaluate(() => JSON.parse(localStorage.getItem('bt.watchlist') || '[]'));
      if (!wl.includes(sym)) note('screener: + Watchlist did not add ' + sym + ' (' + JSON.stringify(wl) + ')'); else ok('screener added ' + sym + ' to the watchlist');
      const toastTxt = ((await page.locator('#toasts').textContent()) || '').trim();
      if (!/watchlist/i.test(toastTxt)) note('screener: no toast after + Watchlist');
    }
    await page.setViewportSize(VIEWPORTS.phone); await sleep(500);
    await shot('screener-phone-results', true);
    const scrOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (scrOverflow > 2) note('screener phone results: horizontal overflow ' + scrOverflow + 'px');
    await page.setViewportSize(VIEWPORTS.desktop);

    // ------------------------------------------------------------ Builder: SMA crossover → Backtest it → stats; alert
    console.log('\n== v0.5 builder flow');
    await goto('builder.html', 2000);
    await page.click('#tplList [data-tpl="smaCross"]'); await sleep(400);
    const summary = ((await page.locator('#summary').textContent()) || '').trim();
    if (!/SMA/i.test(summary)) note('builder: SMA crossover template summary missing: ' + summary.slice(0, 100)); else ok('builder summary: ' + summary.slice(0, 90));
    await page.click('#btRun');
    await page.waitForFunction(() => document.querySelectorAll('#btTiles > *').length >= 3, null, { timeout: 20000 }).catch(() => null);
    const tiles = await page.locator('#btTiles > *').count();
    const btStatus = ((await page.locator('#btStatus').textContent()) || '').trim();
    if (tiles < 3) note('builder: Backtest it rendered no stats (' + btStatus + ')'); else ok('builder backtest stats tiles: ' + tiles);
    await expect('#btChart canvas, #btChart svg, #btEquity canvas, #btEquity svg', 'builder backtest chart');
    await shot('builder-backtest', true);
    const alertsBeforeN = await page.evaluate(() => (BT.alerts && BT.alerts.list ? BT.alerts.list() : []).length);
    await page.click('#alertBtn'); await sleep(600);
    const ruleAlerts = await page.evaluate(() => (BT.alerts && BT.alerts.list ? BT.alerts.list() : []).filter(a => a.kind === 'rule'));
    const useMsg = ((await page.locator('#useMsg').textContent()) || '').trim();
    if (!ruleAlerts.length) note('builder: "Create alert from entry rule" stored no rule alert (' + useMsg + ', before ' + alertsBeforeN + ')');
    else ok('rule alert created (' + ruleAlerts.length + '): ' + useMsg.slice(0, 70));

    // ------------------------------------------------------------ Semi-auto: force a proposal with an always-true rule
    console.log('\n== v0.5 semi-auto flow');
    await goto('index.html', 3000);
    await skipTour();
    const forced = await page.evaluate(() => {
      const held = Object.keys(BT.paper.state.positions || {});
      const sym = ['XOM', 'KO', 'JPM', 'AMZN', 'TSLA', 'NVDA', 'META', 'GOOGL', 'MSFT', 'AAPL'].find(s => held.indexOf(s) < 0);
      const r = BT.rules.save({ name: 'E2E always on', side: 'long',
        entry: { op: 'and', conditions: [{ left: { ind: 'close' }, cmp: '>', right: { ind: 'value', value: 0.01 } }] },
        exit: { op: 'and', conditions: [{ left: { ind: 'close' }, cmp: '<', right: { ind: 'value', value: 0.01 } }], stopPct: 5 } });
      if (!r.ok) return { err: (r.errors || []).join(' ') };
      BT.rules.semiAuto.set({ enabled: true, ruleId: r.rule ? r.rule.id : r.id });
      return { sym, id: r.rule ? r.rule.id : r.id };
    });
    if (forced.err) note('semi-auto: could not save the test rule: ' + forced.err);
    else {
      await page.evaluate(s => BT.app.setSymbol(s), forced.sym); await sleep(2500);
      // reload so the panel picks up the saved rule from storage, then ask the dashboard to check it now
      await goto('index.html#' + forced.sym, 3000); await skipTour();
      const prop = await page.evaluate(() => BT.app.checkRule());
      await sleep(600);
      const card = await page.evaluate(() => { const c = document.getElementById('autoProposal'); return !!(c && !c.hidden && c.textContent.trim()); });
      if (!prop || !card) note('semi-auto: no proposal card for an always-true rule (' + JSON.stringify(prop) + ', symbol ' + forced.sym + ')');
      else {
        const cardTxt = ((await page.locator('#autoProposal').textContent()) || '').replace(/\s+/g, ' ');
        ok('semi-auto proposal card: ' + cardTxt.slice(0, 80));
        const posBefore = await page.evaluate(() => Object.keys(BT.paper.state.positions || {}).length);
        if (posBefore !== (await page.evaluate(() => Object.keys(BT.paper.state.positions || {}).length))) note('semi-auto executed without confirmation');
        await page.locator('#panel-auto').scrollIntoViewIfNeeded().catch(() => null);
        await shot('index-semi-auto');
        const dismiss = page.locator('#autoDismiss');
        if (await dismiss.count()) { await dismiss.click(); await sleep(300); }
      }
      await page.evaluate(() => { BT.rules.semiAuto.set({ enabled: false }); });
    }

    // ------------------------------------------------------------ Profile: level, badges, personality quiz
    console.log('\n== v0.5 profile flow');
    await goto('profile.html', 2000);
    const profTxt = ((await page.locator('#app').textContent()) || '').replace(/\s+/g, ' ');
    if (!/Level\s*\d/.test(profTxt) || !/(Freshman|Sophomore|Junior|Senior|Graduate|Analyst|Portfolio Manager)/.test(profTxt)) note('profile: level not shown: ' + profTxt.slice(0, 120)); else ok('profile shows a level');
    const badgeN = await page.locator('.badges li').count();
    if (badgeN < 20) note('profile: expected >= 20 badges, found ' + badgeN); else ok('profile badges: ' + badgeN);
    const chip = await page.evaluate(() => { const a = document.querySelector('#nav a.levelchip'); return a && !a.hidden ? a.textContent.replace(/\s+/g, ' ').trim() : ''; });
    if (!chip) note('nav: level chip (a.levelchip) not shown'); else ok('nav level chip: ' + chip);
    if (await page.locator('#pStart').count()) {
      await page.locator('#pStart').first().click(); await sleep(400);
      for (let i = 0; i < 15 && await page.locator('#pForm').count(); i++) {
        await page.locator('#pForm input[type=radio]').nth(i % 2).check();
        await page.locator('#pForm button[type=submit]').click(); await sleep(250);
      }
      const prof = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bt.profile')); } catch (e) { return null; } });
      const persTxt = ((await page.locator('#persWrap, #app').first().textContent()) || '').replace(/\s+/g, ' ');
      if (await page.locator('#pForm').count()) note('profile: personality quiz did not finish after 15 answers');
      else if (!prof || !JSON.stringify(prof).match(/trend|swing|value|options/i)) note('profile: personality result not stored in bt.profile: ' + JSON.stringify(prof));
      else ok('personality quiz completed (' + (persTxt.match(/Trend Follower|Swing Trader|Value-minded Investor|Options Strategist/) || ['?'])[0] + ')');
      await shot('profile-personality', true);
    } else note('profile: Take the quiz button (#pStart) missing');
    await page.setViewportSize(VIEWPORTS.phone); await sleep(500);
    await shot('profile-phone-result');
    await page.setViewportSize(VIEWPORTS.desktop);

    // ------------------------------------------------------------ Options analyzer: sliders change the P&L chart
    console.log('\n== v0.5 options analyzer flow');
    await goto('portfolio.html', 2500);
    await page.click('#tab-options'); await sleep(1200);
    // the analyzer needs a position: load the first preset strategy (e.g. a long call)
    const presetVals = await page.locator('#preset option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
    if (!presetVals.length) note('options lab: no preset strategies');
    else { await page.selectOption('#preset', presetVals[0]); await sleep(1000); }
    await expect('#legs tr', 'options legs after loading a preset', 1);
    const canvasSig = () => page.evaluate(() => { const c = document.getElementById('wi-curves'); try { return c && c.width ? c.toDataURL().length + ':' + c.toDataURL().slice(-200) : ''; } catch (e) { return 'err'; } });
    const resTxt = () => page.evaluate(() => (document.getElementById('wi-result') || {}).textContent || '');
    const sig0 = await canvasSig(), res0 = await resTxt();
    if (!sig0) note('options analyzer: P&L curves canvas missing or empty');
    const setRange = (id, frac) => page.evaluate(([id, frac]) => { const el = document.getElementById(id); const min = +el.min, max = +el.max; el.value = String(min + (max - min) * frac); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, frac]);
    await setRange('wi-price', 0.85); await sleep(500);
    const sig1 = await canvasSig(), res1 = await resTxt();
    await setRange('wi-days', 0.8); await sleep(500);
    const sig2 = await canvasSig(), res2 = await resTxt();
    await setRange('wi-iv', 0.9); await sleep(500);
    const res3 = await resTxt();
    if (sig1 === sig0 && res1 === res0) note('options analyzer: price slider changed neither the P&L chart nor the result');
    else ok('price slider updates the analyzer');
    if (sig2 === sig1 && res2 === res1) note('options analyzer: days slider changed neither the P&L chart nor the result'); else ok('days slider updates the analyzer');
    if (res3 === res2) note('options analyzer: IV slider did not change the result'); else ok('IV slider updates the result');
    await shot('portfolio-options-whatif', true);

    // ------------------------------------------------------------ Backtest: CSV upload
    console.log('\n== v0.5 CSV upload flow');
    await goto('backtest.html', 2500);
    const csvRows = ['Date,Open,High,Low,Close,Adj Close,Volume'];
    let px = 100;
    for (let i = 0; i < 260; i++) {
      const d = new Date(Date.UTC(2024, 0, 2) + i * 86400000); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      const o = px; px = Math.max(5, px * (1 + Math.sin(i / 9) * 0.012 + 0.0008)); const h = Math.max(o, px) * 1.006, l = Math.min(o, px) * 0.994;
      csvRows.push([d.toISOString().slice(0, 10), o.toFixed(2), h.toFixed(2), l.toFixed(2), px.toFixed(2), px.toFixed(2), 1000000 + i * 1000].join(','));
    }
    if (await page.locator('#srccsv').count()) { await page.click('#srccsv').catch(() => null); await sleep(300); }
    await page.setInputFiles('#csvfile', { name: 'TEST_daily.csv', mimeType: 'text/csv', buffer: Buffer.from(csvRows.join('\n')) });
    await sleep(2500);
    const csvState = await page.evaluate(() => ({ list: BT.csv && BT.csv.list ? BT.csv.list().length : -1, stats: document.querySelectorAll('#stats *').length, msg: (document.getElementById('runmsg') || {}).textContent || '' }));
    if (csvState.list < 1) note('backtest: CSV upload did not save a dataset ' + JSON.stringify(csvState)); else ok('CSV dataset saved (' + csvState.list + ')');
    await page.click('#run'); await sleep(2500);
    const csvStats = await page.locator('#stats *').count();
    if (csvStats < 4) note('backtest on uploaded CSV produced no stats: ' + await page.locator('#runmsg').textContent()); else ok('backtest ran on the uploaded CSV');
    await shot('backtest-csv', true);
    await page.evaluate(() => { try { BT.backtestPage && BT.backtestPage.setSource && BT.backtestPage.setSource('market'); } catch (e) {} });

    // ------------------------------------------------------------ Spanish on the new pages (>= 85 % of visible text)
    console.log('\n== v0.5 Spanish toggle');
    for (const p of ['leagues.html', 'screener.html', 'builder.html', 'profile.html']) {
      await goto(p, 2200);
      const en = await textSnapshot();
      await clickLangToggle();
      const es = await textSnapshot();
      const share = changedShare(en, es);
      console.log('  ' + p + ': ' + en.length + ' text nodes, ' + Math.round(share * 100) + '% changed');
      if (share < 0.85) note(p + ': only ' + Math.round(share * 100) + '% of visible text changed to Spanish; untranslated e.g. ' + JSON.stringify(en.filter((t, i) => es[i] === t).slice(0, 25)));
      else ok(p + ' translated (' + Math.round(share * 100) + '%)');
      await shot('es-' + p.replace('.html', '') + '-desktop');
      await clickLangToggle();
      const langBack = await page.evaluate(() => BT.i18n.lang());
      if (langBack !== 'en') note(p + ': toggle back left lang=' + langBack);
    }
  }

  await v05Flows();

  await browser.close();
  console.log('\n(external resource failures ignored: ' + extNoise.length + ')');
  console.log('\n==== ERRORS (' + errs.length + ')'); errs.forEach(e => console.log(' ', e));
  console.log('==== ISSUES (' + issues.length + ')'); issues.forEach(e => console.log(' ', e));
  process.exit(errs.length || issues.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
