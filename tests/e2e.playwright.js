// End-to-end smoke test for every page (v0.4). Serve the site first:
//   python3 -m http.server 8765
// then: node tests/e2e.playwright.js
// Needs the playwright npm package with Chromium installed. Not run by the unit-test files.
//
// What it checks, for all 15 pages at 1280x900 (desktop) and 390x844 (phone), dark theme:
//   - no console errors, page errors, failed same-origin requests or HTTP >= 400 on localhost
//   - the shared shell is mounted (top nav links, footer disclaimer, manifest link, EN/ES toggle, BT.i18n present)
//   - no horizontal overflow; the bottom tab bar is visible on phone and hidden on desktop
//   - screenshots to docs/screenshots/<page>-<desktop|phone>.png (deviceScaleFactor 1)
// then exercises the main flows: language toggle to Spanish and back (>= 90 % of visible text
// nodes change on index/learn/portfolio/pricing, English restored), Spanish lesson m3-l2 with a
// working quiz, m9 in both languages, lesson print button, First Week (7 days, Day 1 auto-ticks after the
// dashboard tour is walked to 'Start trading', lesson m1-l1 and three watchlist symbols),
// instructor class + share-code import, certificate from query params, dashboard buy, alerts,
// replay drill + scorecard, journal, glossary (search, flashcards, Daily 5), compare, pricing,
// verify, learn (m7 drill, m8 exam, quiz), portfolio position and a backtest run.
const { chromium } = require('playwright');
const BASE = process.env.BT_BASE_URL || 'http://localhost:8765/';
const OUT = require('path').join(__dirname, '..', 'docs', 'screenshots') + '/';
const PAGES = ['index.html', 'learn.html', 'start.html', 'replay.html', 'portfolio.html', 'backtest.html', 'journal.html',
  'news.html', 'compare.html', 'glossary.html', 'instructor.html', 'pricing.html', 'verify.html', 'certificate.html', 'about.html'];
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

  // ---------------------------------------------------------------- shell audit, both viewports
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
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

  await browser.close();
  console.log('\n(external resource failures ignored: ' + extNoise.length + ')');
  console.log('\n==== ERRORS (' + errs.length + ')'); errs.forEach(e => console.log(' ', e));
  console.log('==== ISSUES (' + issues.length + ')'); issues.forEach(e => console.log(' ', e));
  process.exit(errs.length || issues.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
