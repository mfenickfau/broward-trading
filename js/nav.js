/* Broward Trading — js/nav.js → BT.nav (shared page shell, v0.3; v0.5 adds Leagues, Builder, Screener, Profile and the level chip)
 *
 * The ONLY place the site's navigation and footer markup lives. Every page has
 * `<div id="nav"></div>` right after <body> and `<div id="footer"></div>` at the
 * end, and loads this file right after the #nav mount so the shell is in the DOM
 * before the page's own scripts run (js/app.js and js/learn.js look up the
 * #themeToggle button synchronously).
 *
 * What mount() injects
 *   - <a class="skip-link">     "Skip to content", the first focusable element on every page
 *   - <nav class="topnav">      sticky top bar: brand, one link per page, language toggle,
 *                               level chip (v0.5, links to profile.html), theme toggle
 *   - <nav class="tabbar">      fixed bottom tab bar on phones (≤ 760px): Dashboard,
 *                               Learn, Replay, Portfolio, More
 *   - "More" bottom sheet       every other page, theme switch, install button
 *   - <footer class="footer">   the disclaimer every page must show
 *   - <head> extras             manifest link, apple-touch-icon, theme-color sync
 *   - service worker            registers sw.js over http(s) when supported
 *
 * Theme: persisted in localStorage 'bt.theme' as "dark" | "light" (JSON-quoted,
 * the format js/app.js and js/learn.js read; a bare value written by older pages
 * is read too). Removing the key returns to "follow the OS". Other scripts learn
 * about a change through the 'bt:theme' CustomEvent on window and, for the two
 * pages that predate the event, BT.portfolioPage.onThemeChange /
 * BT.backtestPage.onThemeChange.
 *
 * Lazy scripts: js/i18n.js is queued synchronously when the page lacks it (BT.t must
 * exist before page scripts run); js/xp.js is loaded async after parsing (only the
 * level chip needs it) and the chip subscribes via BT.xp.onChange.
 *
 * Plain ES2020, no imports. Pure helpers (pages, activePage) are usable without
 * a DOM so tests/nav.test.js can load the file in Node.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  var hasDOM = typeof document !== 'undefined' && !!document.createElement;

  /* ------------------------------------------------------------------ *
   * Page registry. `tab` marks the four primary tabs on phones; the rest
   * live behind "More". `top` marks the links shown in the desktop top bar;
   * the others sit behind its "More" button (same sheet as on phones).
   * `short` is the label used where space is tight.
   * ------------------------------------------------------------------ */
  var PAGES = [
    { id: 'index',     file: 'index.html',     label: 'Dashboard', short: 'Dashboard', tab: true, top: true,  icon: 'chart',    desc: 'Charts, indicators and the paper trade ticket' },
    { id: 'learn',     file: 'learn.html',     label: 'Learn',     short: 'Learn',     tab: true, top: true,  icon: 'book',     desc: 'The free course, quizzes and your certificate' },
    { id: 'start',     file: 'start.html',     label: 'First Week', short: 'First Week', tab: false, icon: 'flag',   desc: 'Seven days of guided first steps for complete beginners' },
    { id: 'replay',    file: 'replay.html',    label: 'Replay',    short: 'Replay',    tab: true, top: true,  icon: 'play',     desc: 'Market Replay: trade past data bar by bar' },
    { id: 'portfolio', file: 'portfolio.html', label: 'Portfolio', short: 'Portfolio', tab: true, top: true,  icon: 'wallet',   desc: 'Paper account, positions, orders and options lab' },
    { id: 'leagues',   file: 'leagues.html',   label: 'Leagues',   short: 'Leagues',   tab: false, top: true, icon: 'trophy',   desc: 'Paper-trading competitions with classmates and friends' },
    { id: 'backtest',  file: 'backtest.html',  label: 'Backtest',  short: 'Backtest',  tab: false, top: true, icon: 'flask',    desc: 'Test rule-based strategies on past prices' },
    { id: 'builder',   file: 'builder.html',   label: 'Strategy Builder', short: 'Builder', tab: false, top: true, icon: 'blocks', desc: 'Build trading rules from blocks, then back-test them' },
    { id: 'screener',  file: 'screener.html',  label: 'Screener',  short: 'Screener',  tab: false, top: true, icon: 'filter',   desc: 'Scan the market for setups with technical filters' },
    { id: 'journal',   file: 'journal.html',   label: 'Journal',   short: 'Journal',   tab: false, top: true, icon: 'journal',  desc: 'Review every trade: setup, emotion, lesson' },
    { id: 'news',      file: 'news.html',      label: 'News',      short: 'News',      tab: false, icon: 'news',     desc: 'Company profile, earnings and headlines' },
    { id: 'compare',   file: 'compare.html',   label: 'Compare',   short: 'Compare',   tab: false, icon: 'compare',  desc: 'Relative performance, correlation, heatmap' },
    { id: 'glossary',  file: 'glossary.html',  label: 'Glossary',  short: 'Glossary',  tab: false, icon: 'glossary', desc: 'Every term explained, flashcards, Daily 5' },
    { id: 'profile',   file: 'profile.html',   label: 'Profile',   short: 'Profile',   tab: false, icon: 'user',     desc: 'Your level, XP, badges, streak and trader personality' },
    { id: 'pricing',   file: 'pricing.html',   label: 'Pro',       short: 'Pro',       tab: false, icon: 'star',     desc: 'Everything is free today; see what Pro will add' },
    { id: 'verify',    file: 'verify.html',    label: 'Verify certificate', short: 'Verify', tab: false, icon: 'badge', desc: 'Check that a Broward Trading certificate is genuine' },
    { id: 'instructor', file: 'instructor.html', label: 'Instructor', short: 'Instructor', tab: false, icon: 'people', desc: 'Class codes, roster, gradebook and share-code import' },
    { id: 'about',     file: 'about.html',     label: 'About',     short: 'About',     tab: false, icon: 'info',     desc: 'Mission, data sources, disclaimer, roadmap' }
  ];

  var DISCLAIMER = 'Broward Trading is a free educational simulator. No real orders are placed and no money changes hands. ' +
    'Demo prices are simulated, not real; live prices come from the provider you configure and may be delayed. ' +
    'Past performance, including back-test results, does not predict future results. Nothing here is investment advice.';

  var THEME_COLOR = { dark: '#0f1319', light: '#f3f5f8' };
  var PHONE_QUERY = '(max-width: 760px)';

  /* ------------------------------------------------------------------ *
   * Inline SVG icons (24×24, stroke = currentColor). Kept tiny on purpose.
   * ------------------------------------------------------------------ */
  var ICONS = {
    chart:    '<path d="M4 19h16M7 15l3-4 3 2 4-6"/><path d="M15 7h2v2"/>',
    book:     '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5V5.5M8 7h8M8 11h6"/>',
    play:     '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>',
    wallet:   '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
    more:     '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    flask:    '<path d="M9 3h6M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>',
    journal:  '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/>',
    news:     '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h6M7 13h7M7 16h4"/>',
    compare:  '<path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/>',
    glossary: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    star:     '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9L3.5 9.7l5.9-.8z"/>',
    badge:    '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/>',
    info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon:     '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    close:    '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16"/>',
    flag:     '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
    people:   '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
    trophy:   '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4"/>',
    filter:   '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    blocks:   '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M15 4h5v5M4 15v5h5"/>',
    user:     '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
  };
  function svg(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || ICONS.info) + '</svg>';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** BT.t when js/i18n.js is present (it loads right after this file), plain interpolation otherwise. */
  function T(s, v) {
    if (BT.t) return BT.t(s, v);
    return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s;
  }

  /* ------------------------------------------------------------------ *
   * Pure helpers
   * ------------------------------------------------------------------ */
  /** File name of the current document from a pathname ('' and '/' mean index.html). */
  function fileOf(pathname) {
    var p = String(pathname == null ? '' : pathname).split('?')[0].split('#')[0];
    var last = p.split('/').pop() || '';
    if (!last) return 'index.html';
    if (last.indexOf('.') < 0) last += '.html';          // clean URLs: /learn → learn.html
    return last.toLowerCase();
  }
  /** The registry entry for a pathname, or null when the page is not in the registry. */
  function activePage(pathname) {
    var f = fileOf(pathname);
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].file === f) return PAGES[i];
    return null;
  }
  function tabPages() { return PAGES.filter(function (p) { return p.tab; }); }
  function morePages() { return PAGES.filter(function (p) { return !p.tab; }); }

  /* ------------------------------------------------------------------ *
   * Theme
   * ------------------------------------------------------------------ */
  function readStoredTheme() {
    try {
      var v = localStorage.getItem('bt.theme');
      if (!v) return '';
      try { v = JSON.parse(v); } catch (e) { /* bare value written by an older page */ }
      return v === 'light' || v === 'dark' ? v : '';
    } catch (e) { return ''; }
  }
  function writeStoredTheme(t) {
    try {
      if (t === 'light' || t === 'dark') localStorage.setItem('bt.theme', JSON.stringify(t));
      else localStorage.removeItem('bt.theme');
    } catch (e) { /* storage unavailable: the theme still applies to this view */ }
  }
  function osPrefersLight() {
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches);
  }
  /** 'dark' | 'light': the pinned theme, else what the OS asks for. */
  function effectiveTheme() {
    if (!hasDOM) return readStoredTheme() || 'dark';
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return osPrefersLight() ? 'light' : 'dark';
  }
  function applyThemeAttr(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  /** Reflect the effective theme on the toggle buttons, the theme-color meta, and tell listeners. */
  function syncThemeUi(notify) {
    var t = effectiveTheme();
    var next = t === 'dark' ? 'light' : 'dark';
    Array.prototype.forEach.call(document.querySelectorAll('[data-bt-theme-toggle]'), function (b) {
      b.setAttribute('data-mode', t);
      b.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
      b.setAttribute('aria-label', T('Switch to {next} theme', { next: T(next) }));
      b.title = T('Theme: {theme}. Switch to {next}.', { theme: T(t), next: T(next) });
      var lbl = b.querySelector('.theme-label');
      if (lbl) lbl.textContent = T('Theme: {theme} · switch to {next}', { theme: T(t === 'dark' ? 'Dark' : 'Light'), next: T(next) });
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.setAttribute('content', THEME_COLOR[t]);
    if (notify) {
      try { if (BT.portfolioPage && BT.portfolioPage.onThemeChange) BT.portfolioPage.onThemeChange(); } catch (e) { /* page not ready */ }
      try { if (BT.backtestPage && BT.backtestPage.onThemeChange) BT.backtestPage.onThemeChange(); } catch (e) { /* page not ready */ }
      try { root.dispatchEvent(new CustomEvent('bt:theme', { detail: { theme: t } })); } catch (e) { /* very old browser */ }
    }
  }
  function setTheme(t) {
    applyThemeAttr(t);
    writeStoredTheme(t);
    syncThemeUi(true);
  }
  function toggleTheme() { setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); }

  /* ------------------------------------------------------------------ *
   * Language (js/i18n.js → BT.i18n). nav.js loads i18n.js itself when the
   * page did not, synchronously and before the page's own scripts, so BT.t
   * exists for every UI module. The toggle cycles through BT.i18n.langs.
   * ------------------------------------------------------------------ */
  var LANG_FALLBACK = [{ code: 'en', label: 'English', short: 'EN' }, { code: 'es', label: 'Español', short: 'ES' }];
  function langs() { return (BT.i18n && BT.i18n.langs && BT.i18n.langs.length) ? BT.i18n.langs : LANG_FALLBACK; }
  function readStoredLang() {
    try {
      var v = localStorage.getItem('bt.lang');
      if (!v) return 'en';
      try { v = JSON.parse(v); } catch (e) { /* bare value */ }
      return typeof v === 'string' && v ? v : 'en';
    } catch (e) { return 'en'; }
  }
  function currentLang() { return BT.i18n ? BT.i18n.lang() : readStoredLang(); }
  function langAfter(code) {
    var list = langs(), i = 0;
    for (; i < list.length; i++) if (list[i].code === code) break;
    return list[(i + 1) % list.length];
  }
  function langLabel(code) {
    var list = langs();
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].label;
    return code.toUpperCase();
  }
  /* src of this script, captured while it executes (document.currentScript is null later). */
  var NAV_SRC = (function () {
    try { var cs = hasDOM && document.currentScript; return cs && cs.src ? String(cs.src) : ''; } catch (e) { return ''; }
  })();
  /** Path of a sibling script (js/<name>) next to this one (works on GitHub Pages sub-paths). */
  function siblingSrc(name) {
    var src = NAV_SRC;
    return /nav\.js(\?.*)?$/.test(src) ? src.replace(/nav\.js(\?.*)?$/, name) : 'js/' + name;
  }
  function i18nSrc() { return siblingSrc('i18n.js'); }
  /**
   * Load js/i18n.js if the page did not include it. While the parser is still
   * running, document.write keeps script order (the same trick the pages use for
   * the vendored chart library); afterwards an ordinary script element is used.
   */
  function ensureI18n() {
    if (!hasDOM || BT.i18n) return;
    if (document.querySelector('script[src$="i18n.js"],script[src*="/i18n.js?"]')) return;
    var src = i18nSrc();
    if (document.readyState === 'loading' && document.currentScript && document.currentScript.src === NAV_SRC && typeof document.write === 'function') {
      try { document.write('<script src="' + esc(src) + '"><\/script>'); return; } catch (e) { /* fall through */ }
    }
    var s = document.createElement('script'); s.src = src; s.async = false;
    (document.head || document.documentElement).appendChild(s);
  }
  function syncLangUi() {
    var cur = currentLang(), next = langAfter(cur);
    Array.prototype.forEach.call(document.querySelectorAll('[data-bt-lang-toggle]'), function (b) {
      b.setAttribute('data-lang', cur);
      var aria = T('Language: {current}. Switch to {next}.', { current: langLabel(cur), next: next.label });
      b.setAttribute('aria-label', aria);
      b.title = aria;
      Array.prototype.forEach.call(b.querySelectorAll('.lang-opt'), function (o) {
        var on = o.getAttribute('data-lang') === cur;
        o.classList.toggle('on', on);
        o.setAttribute('aria-current', on ? 'true' : 'false');
      });
      var lbl = b.querySelector('.lang-label');
      if (lbl) lbl.textContent = T('Language: {current} · switch to {next}', { current: langLabel(cur), next: next.label });
    });
  }
  function onLangClick() {
    var next = langAfter(currentLang());
    if (BT.i18n && BT.i18n.setLang) {
      BT.i18n.setLang(next.code).then(function (ok) {
        syncLangUi();
        if (!ok && next.code !== 'en' && BT.nav.toast) BT.nav.toast(T('The {next} translation could not be loaded. Check your connection and try again.', { next: next.label }), 'warn', T('Language'));
      });
    } else {
      // i18n.js did not load (very old browser / blocked): save the choice and reload.
      try { localStorage.setItem('bt.lang', JSON.stringify(next.code)); } catch (e) { /* ignore */ }
      location.reload();
    }
  }
  function langButton(extraClass, withLabel) {
    var cur = currentLang();
    var opts = langs().map(function (l) {
      return '<span class="lang-opt' + (l.code === cur ? ' on' : '') + '" data-lang="' + esc(l.code) + '" aria-current="' + (l.code === cur ? 'true' : 'false') + '">' + esc(l.short || l.code.toUpperCase()) + '</span>';
    }).join('<span class="lang-sep" aria-hidden="true">/</span>');
    return '<button class="ghost langbtn' + (extraClass ? ' ' + extraClass : '') + '" type="button" data-bt-lang-toggle data-lang="' + esc(cur) + '" aria-label="Language">' +
      (withLabel ? svg('globe') : '') + '<span class="lang-opts no-i18n" translate="no">' + opts + '</span>' + (withLabel ? '<span class="lang-label">Language</span>' : '') + '</button>';
  }
  var NAV_CSS = '.langbtn{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 8px;font:inherit;font-size:var(--fs-sm);letter-spacing:.02em}' +
    '.langbtn .lang-opts{display:inline-flex;align-items:center;gap:3px;font-family:var(--mono);font-weight:500}' +
    '.langbtn .lang-opt{color:var(--muted);padding:1px 2px;border-radius:3px}' +
    '.langbtn .lang-opt.on{color:var(--fg);background:var(--panel3)}' +
    '.langbtn .lang-sep{color:var(--faint)}' +
    '.topnav .langbtn{margin-right:2px}' +
    '.sheet-foot .langbtn{color:var(--fg);background:var(--panel2);justify-content:flex-start}' +
    '.sheet-foot .langbtn .ico{width:20px;height:20px;color:var(--teal)}' +
    '.sheet-foot .langbtn .lang-label{font-size:var(--fs-sm)}' +
    '.sheet-foot .langbtn .lang-opts{margin-left:auto}' +
    '.topnav a.levelchip{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);' +
      'background:linear-gradient(90deg,color-mix(in srgb,var(--teal) 22%,transparent) var(--lv-pct,0%),transparent var(--lv-pct,0%));color:var(--fg);font-size:var(--fs-sm);white-space:nowrap;text-decoration:none}' +
    '.topnav a.levelchip[hidden]{display:none}' +
    '.topnav a.levelchip::after{display:none}' +
    '.topnav a.levelchip:hover{border-color:var(--teal);background-color:var(--panel2)}' +
    '.topnav a.levelchip:focus-visible{outline:2px solid var(--teal);outline-offset:2px}' +
    '.levelchip .lv-num{font-family:var(--mono);font-weight:600;color:var(--teal)}' +
    '.levelchip .lv-name{color:var(--muted);max-width:14ch;overflow:hidden;text-overflow:ellipsis}' +
    '@media (max-width:1100px){.levelchip .lv-name{display:none}}' +
    '@media (max-width:760px){.topnav .langbtn{min-height:44px;min-width:44px}.topnav .themebtn{min-height:44px;min-width:44px}.topnav a.levelchip{min-height:44px;min-width:44px;justify-content:center;padding:4px 8px}}';
  /**
   * Click handler for a toggle button. Older page scripts (js/app.js, js/learn.js)
   * also bind #themeToggle and flip the theme themselves; a 0 ms deferral lets them
   * run first, and this only toggles when nobody else did, so the theme never flips twice.
   */
  function onToggleClick() {
    var before = effectiveTheme();
    setTimeout(function () {
      if (effectiveTheme() === before) toggleTheme();
      else { writeStoredTheme(effectiveTheme()); syncThemeUi(true); }
    }, 0);
  }

  /* ------------------------------------------------------------------ *
   * Level chip (v0.5). js/xp.js → BT.xp is loaded lazily (async, after the
   * page has parsed) on every page that does not include it, and the chip next
   * to the theme toggle follows BT.xp.onChange. Without xp.js (blocked, very old
   * browser, Node) the chip simply stays hidden.
   * ------------------------------------------------------------------ */
  /** Pure: the chip's visible text and accessible label for a BT.xp.summary(). */
  function levelChipInfo(sum) {
    if (!sum || !sum.level) return null;
    var L = sum.level;
    var n = L.number || ((L.index || 0) + 1);
    var xp = Math.max(0, Math.round(Number(sum.total != null ? sum.total : L.xp) || 0));
    var label = L.next
      ? T('Level {n}: {name}, {xp} XP, {left} XP to {next}. Open your profile.', { n: n, name: L.name, xp: xp, left: L.toNext, next: L.next.name })
      : T('Level {n}: {name}, {xp} XP, top level. Open your profile.', { n: n, name: L.name, xp: xp });
    return { n: n, short: T('Lv {n}', { n: n }), name: String(L.name || ''), xp: xp, pct: Math.max(0, Math.min(100, Number(L.pct) || 0)), label: label };
  }
  function levelChipHtml(sum) {
    var info = levelChipInfo(sum);
    return '<a class="levelchip" id="btLevel" href="profile.html"' + (info ? '' : ' hidden') +
      ' style="--lv-pct:' + (info ? info.pct : 0) + '%"' +
      ' aria-label="' + esc(info ? info.label : T('Your level. Open your profile.')) + '"' + (info ? ' title="' + esc(info.label) + '"' : '') + '>' +
      '<span class="lv-num">' + esc(info ? info.short : '') + '</span><span class="lv-name">' + esc(info ? info.name : '') + '</span></a>';
  }
  function renderLevelChip(sum) {
    if (!hasDOM) return;
    var el = document.getElementById('btLevel');
    var info = levelChipInfo(sum);
    if (!el || !info) return;
    el.hidden = false;
    el.style.setProperty('--lv-pct', info.pct + '%');
    el.setAttribute('aria-label', info.label);
    el.title = info.label;
    var a = el.querySelector('.lv-num'), b = el.querySelector('.lv-name');
    if (a) a.textContent = info.short;
    if (b) b.textContent = info.name;
  }
  var xpBound = false;
  function bindXp() {
    if (xpBound || !BT.xp || typeof BT.xp.onChange !== 'function') return false;
    xpBound = true;
    try { BT.xp.onChange(function (sum) { renderLevelChip(sum); }, { immediate: true }); } catch (e) { /* chip stays hidden */ }
    root.addEventListener('bt:lang', function () { try { renderLevelChip(BT.xp.summary()); } catch (e) { /* ignore */ } });
    return true;
  }
  /** Load js/xp.js after parsing unless the page already has it, then bind the chip. */
  function ensureXp() {
    if (!hasDOM) return;
    var go = function () {
      if (bindXp()) return;
      var tag = document.querySelector('script[src$="xp.js"],script[src*="/xp.js?"]');
      if (!tag) {
        tag = document.createElement('script');
        tag.src = siblingSrc('xp.js'); tag.async = true;
        (document.head || document.documentElement).appendChild(tag);
      }
      tag.addEventListener('load', bindXp);
      root.addEventListener('load', bindXp);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  /* ------------------------------------------------------------------ *
   * Markup
   * ------------------------------------------------------------------ */
  function themeButton(id, extraClass, withLabel) {
    return '<button ' + (id ? 'id="' + id + '" ' : '') + 'class="ghost themebtn' + (extraClass ? ' ' + extraClass : '') + '" type="button" data-bt-theme-toggle aria-pressed="false" aria-label="Switch theme">' +
      svg('sun', 'sun') + svg('moon', 'moon') + (withLabel ? '<span class="theme-label">Theme</span>' : '') + '</button>';
  }
  function safeSummary() { try { return BT.xp.summary(); } catch (e) { return null; } }
  function topnavHtml(active) {
    var links = PAGES.filter(function (p) { return p.top || (active && active.id === p.id); }).map(function (p) {
      var on = active && active.id === p.id;
      return '<a href="' + p.file + '"' + (on ? ' class="active" aria-current="page"' : '') + (p.label !== p.short ? ' title="' + esc(p.label) + '"' : '') + '>' + esc(p.short) + '</a>';
    }).join('');
    var moreOn = active && !active.top;
    var moreTop = '<button class="navmore' + (moreOn ? ' on' : '') + '" id="btMoreTop" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="btSheet">More<span aria-hidden="true"> \u25BE</span></button>';
    return '<nav class="topnav" aria-label="Main">' +
      '<a class="brand" href="index.html"><span class="no-i18n" translate="no">Broward Trading</span><small>Paper-trading &amp; technical analysis lab</small></a>' +
      '<div class="links">' + links + '</div>' + moreTop +
      '<div class="right">' + langButton('', false) + levelChipHtml(BT.xp && BT.xp.summary ? safeSummary() : null) + themeButton('themeToggle', '', false) + '</div>' +
      '</nav>';
  }
  function tabbarHtml(active) {
    var moreOn = active && !active.tab;
    var tabs = tabPages().map(function (p) {
      var on = active && active.id === p.id;
      return '<a class="tab' + (on ? ' on' : '') + '" href="' + p.file + '"' + (on ? ' aria-current="page"' : '') + '>' + svg(p.icon) + '<span>' + esc(p.short) + '</span></a>';
    }).join('');
    tabs += '<button class="tab' + (moreOn ? ' on' : '') + '" id="btMore" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="btSheet">' + svg('more') + '<span>More</span></button>';
    return '<nav class="tabbar" aria-label="Pages">' + tabs + '</nav>';
  }
  function sheetHtml(active) {
    var items = morePages().map(function (p) {
      var on = active && active.id === p.id;
      return '<li' + (p.top ? ' class="in-top"' : '') + '><a href="' + p.file + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + svg(p.icon) +
        '<span class="txt"><b>' + esc(p.label) + '</b><small>' + esc(p.desc) + '</small></span></a></li>';
    }).join('');
    return '<div class="sheet-backdrop" id="btSheet" hidden>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="btSheetTitle">' +
      '<div class="sheet-handle" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2 id="btSheetTitle">More</h2><button class="ghost close" type="button" id="btSheetClose" aria-label="Close menu">' + svg('close') + '</button></div>' +
      '<ul class="sheet-list">' + items + '</ul>' +
      '<div class="sheet-foot">' +
      themeButton('', 'sheet-theme', true) +
      langButton('sheet-lang', true) +
      '<button class="sheet-install" type="button" id="btInstall" hidden>' + svg('download') + '<span>Install app</span></button>' +
      '</div>' +
      '<p class="sheet-note">Free educational simulator. No real orders, no real money.</p>' +
      '</div></div>';
  }
  function footerHtml() {
    var links = PAGES.map(function (p) {
      var href = p.id === 'about' ? 'about.html#disclaimer' : p.file;
      var label = p.id === 'about' ? 'About &amp; disclaimer' : esc(p.label);
      return '<a href="' + href + '">' + label + '</a>';
    }).join('');
    return '<footer class="footer disclaimer-footer">' +
      '<div class="links">' + links + '</div>' +
      esc(DISCLAIMER) +
      '<div class="footer-meta"><span>Open source · built for students</span><span id="btNetState" hidden>Offline — showing saved pages</span></div>' +
      '</footer>';
  }

  /* ------------------------------------------------------------------ *
   * Head extras: manifest, home-screen icon, iOS web-app meta
   * ------------------------------------------------------------------ */
  function ensureHead() {
    var head = document.head;
    function addOnce(sel, make) { if (!head.querySelector(sel)) head.appendChild(make()); }
    addOnce('link[rel="manifest"]', function () { var l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.json'; return l; });
    addOnce('link[rel="apple-touch-icon"]', function () { var l = document.createElement('link'); l.rel = 'apple-touch-icon'; l.href = 'icons/icon-192.png'; return l; });
    addOnce('link[rel="icon"]', function () { var l = document.createElement('link'); l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = 'icons/icon.svg'; return l; });
    addOnce('meta[name="mobile-web-app-capable"]', function () { var m = document.createElement('meta'); m.name = 'mobile-web-app-capable'; m.content = 'yes'; return m; });
    addOnce('meta[name="apple-mobile-web-app-capable"]', function () { var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-capable'; m.content = 'yes'; return m; });
    addOnce('meta[name="apple-mobile-web-app-status-bar-style"]', function () { var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-status-bar-style'; m.content = 'black-translucent'; return m; });
    addOnce('meta[name="apple-mobile-web-app-title"]', function () { var m = document.createElement('meta'); m.name = 'apple-mobile-web-app-title'; m.content = 'Broward Trading'; return m; });
    addOnce('meta[name="color-scheme"]', function () { var m = document.createElement('meta'); m.name = 'color-scheme'; m.content = 'dark light'; return m; });
    addOnce('style#btNavCss', function () { var s = document.createElement('style'); s.id = 'btNavCss'; s.textContent = NAV_CSS; return s; });
  }

  /* ------------------------------------------------------------------ *
   * Toast (uses the page's #toasts host when present; creates one otherwise)
   * ------------------------------------------------------------------ */
  function toast(msg, kind, title, ms, action) {
    var host = document.getElementById('toasts');
    if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(T(title)) + '</b>' : '') + esc(T(msg)) + '</div>' +
      (action ? '<button class="sm primary t-action" type="button">' + esc(T(action.label)) + '</button>' : '') +
      '<button class="close" type="button" aria-label="' + esc(T('Dismiss')) + '">✕</button>';
    var kill = function () { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 220); };
    el.querySelector('.close').onclick = kill;
    if (action) el.querySelector('.t-action').onclick = function () { kill(); action.run(); };
    host.appendChild(el);
    while (host.children.length > 4) host.firstChild.remove();
    if (ms !== 0) setTimeout(kill, ms || 4500);
    return el;
  }

  /* ------------------------------------------------------------------ *
   * Service worker
   * ------------------------------------------------------------------ */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;        // file:// and others: not allowed by browsers
    var go = function () {
      // Reading navigator.serviceWorker throws a SecurityError in sandboxed / opaque-origin
      // frames (srcdoc, data:, <iframe sandbox> without allow-same-origin); the 'in' check
      // above does not invoke the getter, so guard the read itself.
      var swc;
      try { swc = navigator.serviceWorker; } catch (e) { return; }
      if (!swc || typeof swc.register !== 'function') return;
      swc.register('sw.js').then(function (reg) {
        BT.nav.swRegistration = reg;
        // A new version installed while this page is open: offer a reload once it is ready.
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing; if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && swc.controller) {
              toast('A newer version of Broward Trading is ready.', 'ok', 'Update available', 0, {
                label: 'Reload', run: function () { try { sw.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* ignore */ } setTimeout(function () { location.reload(); }, 150); }
              });
            }
          });
        });
      }).catch(function () { /* registration is best-effort: the site works without it */ });
    };
    if (document.readyState === 'complete') go(); else root.addEventListener('load', go);
  }

  /* ------------------------------------------------------------------ *
   * Collapsible panels on phones. Any element with [data-acc] whose first
   * child is an <h2> becomes an accordion section below 760px: the heading
   * toggles the body. data-acc="open" starts expanded; everything else starts
   * collapsed. State is remembered per page in localStorage 'bt.ui.acc'.
   * CSS (section 16 in css/style.css) only applies .collapsed on phones, so
   * desktop layouts are untouched.
   * ------------------------------------------------------------------ */
  function accordion(scope) {
    var key = 'bt.ui.acc';
    var pageId = (activePage(location.pathname) || { id: fileOf(location.pathname) }).id;
    var state; try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { state = {}; }
    state[pageId] = state[pageId] || {};
    var saved = state[pageId];
    var els = Array.prototype.slice.call((scope || document).querySelectorAll('[data-acc]'));
    els.forEach(function (card, i) {
      if (card.classList.contains('acc')) return;
      var h = card.querySelector(':scope > h2, :scope > .card-title, :scope > h3');
      if (!h) return;
      var id = card.id || ('acc' + i);
      var open = Object.prototype.hasOwnProperty.call(saved, id) ? !!saved[id] : card.getAttribute('data-acc') === 'open';
      card.classList.add('acc');
      card.classList.toggle('collapsed', !open);
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'acc-btn';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + (h.textContent || 'section').trim().split('\n')[0]);
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
      h.appendChild(btn);
      function set(o) {
        card.classList.toggle('collapsed', !o);
        btn.setAttribute('aria-expanded', o ? 'true' : 'false');
        btn.setAttribute('aria-label', (o ? 'Collapse ' : 'Expand ') + (h.textContent || 'section').trim().split('\n')[0]);
        saved[id] = o;
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) { /* ignore */ }
        if (o) { try { root.dispatchEvent(new CustomEvent('bt:accordion', { detail: { id: id, open: true } })); } catch (e) { /* ignore */ } }
      }
      h.addEventListener('click', function (e) {
        if (!root.matchMedia || !root.matchMedia(PHONE_QUERY).matches) return;   // desktop: headings are plain headings
        var t = e.target;
        if (t !== btn && !btn.contains(t) && t.closest && t.closest('a,button,input,select,label,textarea')) return; // let header actions work
        e.preventDefault();
        set(card.classList.contains('collapsed'));
      });
    });
    return els.length;
  }

  /* ------------------------------------------------------------------ *
   * Accessibility helpers → BT.a11y (v0.4)
   *   skip link        "Skip to content" as the first focusable element; it targets
   *                    the page's <main> (or the first .page block) and gives it an id.
   *   describeChart    canvases are opaque to assistive tech, so every chart pane gets a
   *                    hidden role="img" summary node pages refresh on each render, e.g.
   *                    'AAPL daily chart, last close $251.61, up 1.2% today'.
   *   announce         one shared polite live region (#btLive) for JS-built messages.
   *   dialogs          Tab stays inside any visible [role=dialog][aria-modal=true] and
   *                    Escape presses its .close / [data-close] button (the More sheet
   *                    has its own handler and is skipped).
   *   scroll regions   .table-wrap / .log / .heat-wrap that overflow get tabindex="0"
   *                    so keyboard users can scroll them (WCAG 2.1.1).
   * ------------------------------------------------------------------ */
  var SCROLL_SEL = '.table-wrap,.log,.heat-wrap,[data-scroll-region]';
  function mainTarget() {
    var m = document.querySelector('main') || document.querySelector('.page') || null;
    if (m && !m.id) m.id = 'main';
    return m;
  }
  function ensureSkipTarget() {
    var m = mainTarget();
    var link = document.querySelector('.skip-link');
    if (link && m) link.setAttribute('href', '#' + m.id);
    if (m && !m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1');
    return m;
  }
  function skipLinkHtml() { return '<a class="skip-link" href="#main">Skip to content</a>'; }
  function onSkipClick(e) {
    var m = ensureSkipTarget();
    if (!m) return;
    e.preventDefault();
    try { m.focus({ preventScroll: false }); } catch (err) { m.focus(); }
    try { m.scrollIntoView({ block: 'start' }); } catch (err) { /* ignore */ }
    if (history.replaceState) { try { history.replaceState(null, '', '#' + m.id); } catch (err) { /* ignore */ } }
  }
  function describeChart(el, summary) {
    if (!el || !hasDOM) return;
    // The canvases are opaque to assistive tech and the library's own attribution link lives
    // inside them, so the pane itself cannot be role="img" (no focusable descendants allowed).
    // A visually hidden, labelled image node as the pane's first child carries the summary.
    var text = String(summary == null ? '' : summary).replace(/\s+/g, ' ').trim();
    if (el.getAttribute('role') === 'img') { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
    var node = el.querySelector(':scope > .chart-summary');
    if (!text) { if (node) node.remove(); return; }
    if (!node) {
      node = document.createElement('div');
      node.className = 'chart-summary sr-only';
      node.setAttribute('role', 'img');
      el.insertBefore(node, el.firstChild);
    }
    node.setAttribute('aria-label', text);
  }
  var liveTimer = null;
  function liveRegion() {
    var el = document.getElementById('btLive');
    if (!el && document.body) {
      el = document.createElement('div'); el.id = 'btLive'; el.className = 'sr-live';
      el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true');
      document.body.appendChild(el);
    }
    return el;
  }
  function announce(msg, assertive) {
    var el = liveRegion(); if (!el) return;
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    el.textContent = '';
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { el.textContent = String(msg == null ? '' : msg); }, 40);
  }
  function isVisible(el) {
    if (!el || el.hidden) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function activeDialog() {
    var list = document.querySelectorAll('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]');
    for (var i = list.length - 1; i >= 0; i--) {
      var d = list[i];
      if (d.closest('#btSheet')) continue;             // the More sheet traps focus itself
      var wrap = d.closest('.modal-backdrop') || d.parentElement;
      if ((wrap && wrap.hidden) || !isVisible(d)) continue;
      return d;
    }
    return null;
  }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) { return !el.hidden && !el.closest('[hidden]') && isVisible(el); });
  }
  function onDialogKey(e) {
    if (e.key !== 'Tab' && e.key !== 'Escape') return;
    var dlg = activeDialog(); if (!dlg) return;
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      var btn = dlg.querySelector('[data-close],.close');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    var f = focusables(dlg); if (!f.length) return;
    var first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (!dlg.contains(cur)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
  function markScrollables(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll(SCROLL_SEL), function (el) {
      var overflows = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (overflows) {
        if (!el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '0'); el.setAttribute('data-a11y-scroll', '1'); }
      } else if (el.getAttribute('data-a11y-scroll') === '1') {
        el.removeAttribute('tabindex'); el.removeAttribute('data-a11y-scroll');
      }
    });
  }
  var scrollTimer = null;
  function scheduleScrollables() { clearTimeout(scrollTimer); scrollTimer = setTimeout(function () { try { markScrollables(); } catch (e) { /* ignore */ } }, 150); }
  function installA11y() {
    document.addEventListener('keydown', onDialogKey);
    var ready = function () {
      ensureSkipTarget(); liveRegion(); markScrollables();
      try {
        new MutationObserver(scheduleScrollables).observe(document.body, { childList: true, subtree: true });
      } catch (e) { /* no observer: resize + load still cover the static tables */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
    root.addEventListener('load', scheduleScrollables);
    root.addEventListener('resize', scheduleScrollables);
  }

  /* ------------------------------------------------------------------ *
   * Mount
   * ------------------------------------------------------------------ */
  var mounted = false;
  var deferredInstall = null;

  function mount() {
    if (!hasDOM || mounted) return false;
    var navHost = document.getElementById('nav');
    if (!navHost) return false;
    mounted = true;

    var active = activePage(location.pathname);
    document.documentElement.setAttribute('data-page', active ? active.id : fileOf(location.pathname).replace(/\.html$/, ''));

    // 0. Translations: queue js/i18n.js right after this script when the page lacks it.
    ensureI18n();

    // 1. Theme first, so nothing paints in the wrong colours.
    applyThemeAttr(readStoredTheme());
    ensureHead();

    // 2. Top nav + phone tab bar + More sheet.
    navHost.innerHTML = skipLinkHtml() + topnavHtml(active) + tabbarHtml(active) + sheetHtml(active);
    navHost.classList.add('bt-nav');
    var skip = navHost.querySelector('.skip-link');
    if (skip) skip.addEventListener('click', onSkipClick);

    // 3. Footer (its mount may come later in the document; wait for the parser if needed).
    function mountFooter() {
      var f = document.getElementById('footer');
      if (f && !f.classList.contains('bt-footer')) { f.innerHTML = footerHtml(); f.classList.add('bt-footer'); }
      return !!f;
    }
    if (!mountFooter()) document.addEventListener('DOMContentLoaded', mountFooter);

    // 4. Theme toggles (top bar + sheet) and OS changes.
    Array.prototype.forEach.call(navHost.querySelectorAll('[data-bt-theme-toggle]'), function (b) { b.addEventListener('click', onToggleClick); });
    syncThemeUi(false);
    if (root.matchMedia) {
      try {
        var mq = root.matchMedia('(prefers-color-scheme: light)');
        var onOs = function () { if (!readStoredTheme()) syncThemeUi(true); };
        if (mq.addEventListener) mq.addEventListener('change', onOs); else if (mq.addListener) mq.addListener(onOs);
      } catch (e) { /* ignore */ }
    }

    // 4a. Level chip: lazy-load js/xp.js and follow BT.xp.onChange.
    ensureXp();

    // 4b. Language toggles (top bar + sheet). i18n.js translates the shell itself once it
    //     loads (its boot path + MutationObserver); when it is already present, do it now.
    Array.prototype.forEach.call(navHost.querySelectorAll('[data-bt-lang-toggle]'), function (b) { b.addEventListener('click', onLangClick); });
    syncLangUi();
    root.addEventListener('bt:lang', function () { syncLangUi(); syncThemeUi(false); });
    if (BT.i18n && BT.i18n.lang() !== 'en' && BT.i18n.hasDict(BT.i18n.lang())) { try { BT.i18n.translatePage(navHost); } catch (e) { /* ignore */ } }

    // 5. Phone shell: body.has-tabbar adds bottom padding for the fixed tab bar.
    function syncPhone() {
      var phone = !!(root.matchMedia && root.matchMedia(PHONE_QUERY).matches);
      document.body.classList.toggle('has-tabbar', phone);
      if (!phone) closeSheet();
    }
    syncPhone();
    if (root.matchMedia) {
      try {
        var pq = root.matchMedia(PHONE_QUERY);
        if (pq.addEventListener) pq.addEventListener('change', syncPhone); else if (pq.addListener) pq.addListener(syncPhone);
      } catch (e) { /* ignore */ }
    }

    // 6. More sheet.
    var moreBtn = navHost.querySelector('#btMore');
    var moreTop = navHost.querySelector('#btMoreTop');
    var sheet = navHost.querySelector('#btSheet');
    var lastFocus = null;
    function setExpanded(v) {
      [moreBtn, moreTop].forEach(function (b) { if (b) b.setAttribute('aria-expanded', v); });
    }
    function openSheet() {
      if (!sheet || !sheet.hidden) return;
      lastFocus = document.activeElement;
      sheet.hidden = false;
      document.body.classList.add('sheet-open');
      setExpanded('true');
      var first = Array.prototype.filter.call(sheet.querySelectorAll('.sheet-list a'), function (a) { return a.offsetParent !== null; })[0];
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 30);
    }
    function closeSheet() {
      if (!sheet || sheet.hidden) return;
      sheet.hidden = true;
      document.body.classList.remove('sheet-open');
      setExpanded('false');
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    if (moreBtn && sheet) {
      moreBtn.addEventListener('click', function () { if (sheet.hidden) openSheet(); else closeSheet(); });
      if (moreTop) moreTop.addEventListener('click', function () { if (sheet.hidden) openSheet(); else closeSheet(); });
      sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
      sheet.querySelector('#btSheetClose').addEventListener('click', closeSheet);
      document.addEventListener('keydown', function (e) {
        if (sheet.hidden) return;
        if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
        if (e.key === 'Tab') {   // keep focus inside the dialog
          var focusables = Array.prototype.filter.call(sheet.querySelectorAll('a[href],button:not([hidden])'), function (el) { return !el.hidden && el.offsetParent !== null; });
          if (!focusables.length) return;
          var first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      // Swipe down on the sheet to dismiss it.
      var startY = null;
      var panel = sheet.querySelector('.sheet');
      panel.addEventListener('touchstart', function (e) { startY = e.touches[0].clientY; }, { passive: true });
      panel.addEventListener('touchmove', function (e) {
        if (startY == null) return;
        var dy = e.touches[0].clientY - startY;
        if (dy > 70 && panel.scrollTop <= 0) { startY = null; closeSheet(); }
      }, { passive: true });
      panel.addEventListener('touchend', function () { startY = null; }, { passive: true });
    }

    // 7. "Install app" button appears only when the browser offers an install prompt.
    var installBtn = navHost.querySelector('#btInstall');
    root.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      if (installBtn) installBtn.hidden = false;
    });
    if (installBtn) installBtn.addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function () { deferredInstall = null; installBtn.hidden = true; closeSheet(); }).catch(function () { /* dismissed */ });
    });
    root.addEventListener('appinstalled', function () { if (installBtn) installBtn.hidden = true; });

    // 8. Online / offline hint in the footer.
    function syncNet() {
      var el = document.getElementById('btNetState');
      if (el) el.hidden = navigator.onLine !== false;
      document.documentElement.classList.toggle('offline', navigator.onLine === false);
    }
    root.addEventListener('online', syncNet); root.addEventListener('offline', syncNet);
    document.addEventListener('DOMContentLoaded', syncNet);
    syncNet();

    // 9. Accordions for [data-acc] panels (phones only, see accordion()).
    var runAcc = function () { try { accordion(document); } catch (e) { /* page markup without panels */ } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runAcc); else runAcc();

    // 10. Offline cache.
    registerServiceWorker();

    // 11. Accessibility: skip-link target, live region, dialog focus trap, scrollable tables.
    installA11y();
    return true;
  }

  BT.nav = {
    pages: PAGES,
    disclaimer: DISCLAIMER,
    fileOf: fileOf,
    activePage: activePage,
    tabPages: tabPages,
    morePages: morePages,
    mount: mount,
    accordion: accordion,
    theme: { get: effectiveTheme, stored: readStoredTheme, set: setTheme, toggle: toggleTheme },
    lang: { get: currentLang, stored: readStoredLang, next: langAfter, list: langs, button: langButton, sync: hasDOM ? syncLangUi : null },
    toast: hasDOM ? toast : null,
    isPhone: function () { return !!(root.matchMedia && root.matchMedia(PHONE_QUERY).matches); },
    html: { topnav: topnavHtml, tabbar: tabbarHtml, sheet: sheetHtml, footer: footerHtml, skipLink: skipLinkHtml, levelChip: levelChipHtml },
    level: { info: levelChipInfo, render: hasDOM ? renderLevelChip : function () {}, bind: bindXp, src: function () { return siblingSrc('xp.js'); } },
    swRegistration: null
  };
  BT.a11y = {
    describeChart: describeChart,
    announce: hasDOM ? announce : function () {},
    markScrollables: hasDOM ? markScrollables : function () { return 0; },
    activeDialog: hasDOM ? activeDialog : function () { return null; },
    focusables: hasDOM ? focusables : function () { return []; },
    mainTarget: hasDOM ? mainTarget : function () { return null; }
  };

  // Mount as soon as the #nav mount exists (this file is loaded right after it),
  // otherwise on DOMContentLoaded, as the contract says.
  if (hasDOM) {
    if (!mount()) document.addEventListener('DOMContentLoaded', function () { mount(); });
  }
})();
