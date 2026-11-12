/* Broward Trading — js/learn.js (UI for learn.html, v0.3)
 *
 * Hash-routed single page:
 *   #/                      course home: progress ring, "continue where you left off",
 *                           module cards, certificate checklist, Pro card
 *   #/module/<moduleId>     jumps into the first unfinished lesson of that module
 *   #/lesson/<lessonId>     lesson reader: sidebar (a dropdown on phones), block
 *                           renderers, glossary tooltips, drills, quizzes, Pro lock
 *   #/certificate           eligibility checklist + certificate canvas with a
 *                           verifiable id (BT.auth when present, local otherwise)
 *
 * Depends on: js/course.js (BT.course), js/data.js (BT.data), js/indicators.js (BT.ind)
 * and the lightweight-charts v4 UMD global for the 'chart' block. Optional:
 * js/nav.js (BT.nav: theme event, phone accordions), js/config.js + js/auth.js
 * (BT.auth: Pro gating, certificate ids) and js/replay.js (BT.replay.loadDrills) —
 * every use of them is guarded, the page works when they are absent.
 * Everything rendered from course JSON goes through BT.course.renderMd / escapeHtml.
 */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.course;
  var app = document.getElementById('app');
  if (!C || !app) return;

  var esc = C.escapeHtml;
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  var PHONE = '(max-width: 760px)';
  function isPhone() { return !!(window.matchMedia && window.matchMedia(PHONE).matches); }

  /* ------------------------------------------------------------------ */
  /* Theme: js/nav.js owns the toggle and fires 'bt:theme'. Charts read    */
  /* CSS tokens when created, so re-render the current view on a change.   */
  /* ------------------------------------------------------------------ */
  (function theme() {
    var saved = store.get('bt.theme', null);
    if ((saved === 'light' || saved === 'dark') && !document.documentElement.getAttribute('data-theme')) document.documentElement.setAttribute('data-theme', saved);
    window.addEventListener('bt:theme', function () {
      if (!liveCharts.length) return;                   // nothing on screen depends on the palette
      keepScroll = true; try { route(); } finally { keepScroll = false; }
    });
    // Fallback for a page without nav.js: a #themeToggle button someone placed in the markup.
    var btn = document.getElementById('themeToggle');
    if (btn && !(BT.nav && BT.nav.theme)) {
      btn.addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme');
        var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
        var next = (cur || (prefersLight ? 'light' : 'dark')) === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next); store.set('bt.theme', next);
        keepScroll = true; try { route(); } finally { keepScroll = false; }
      });
    }
  })();

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                        */
  /* ------------------------------------------------------------------ */
  var LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  var PAGE_LABEL = {
    'index.html': 'Open the dashboard', 'portfolio.html': 'Open your paper portfolio', 'backtest.html': 'Open the strategy lab',
    'replay.html': 'Open Market Replay', 'journal.html': 'Open your journal', 'news.html': 'Open company news', 'compare.html': 'Open Compare',
    'glossary.html': 'Open the glossary', 'pricing.html': 'See Pro', 'verify.html': 'Verify a certificate', 'about.html': 'Read more', 'learn.html': 'Open'
  };
  var ALLOWED_PAGES = Object.keys(PAGE_LABEL);

  function ring(pct, cls, label) {
    pct = Math.max(0, Math.min(100, Math.round(+pct || 0)));
    var r = 40, circ = 2 * Math.PI * r, off = circ * (1 - pct / 100);
    return '<div class="ring ' + (cls || '') + (pct >= 100 ? ' done' : '') + '" role="img" aria-label="' + pct + '% complete">' +
      '<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="' + r + '"></circle>' +
      '<circle class="bar" cx="50" cy="50" r="' + r + '" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"></circle></svg>' +
      '<div class="lbl">' + (label != null ? label : pct + '%') + '</div></div>';
  }
  function levelPill(level) { return '<span class="lvl ' + esc(level) + '">' + esc(LEVEL_LABEL[level] || level) + '</span>'; }
  function proPill(title) { return '<span class="lvl pro" title="' + esc(title || 'Part of Pro membership') + '">Pro</span>'; }
  function minutes(n) { return n ? '~' + n + ' min' : ''; }
  function dur(mins) { return C.formatDuration ? C.formatDuration(mins) : (Math.round(mins) + ' min'); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return ''; } }
  var LOCK_SVG = '<svg class="lock" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  function nextUnfinishedLesson(moduleId) {
    var idx = C.getIndex(); if (!idx) return null;
    var mods = moduleId ? idx.modules.filter(function (m) { return m.id === moduleId; }) : idx.modules;
    for (var i = 0; i < mods.length; i++) for (var j = 0; j < mods[i].lessons.length; j++) {
      if (!C.isDone(mods[i].lessons[j].id)) return { moduleId: mods[i].id, lessonId: mods[i].lessons[j].id, title: mods[i].lessons[j].title };
    }
    return null;
  }
  /** Where "Continue" should go: the unfinished last-opened lesson, the one after it, or the first unfinished lesson. */
  function continueTarget() {
    var idx = C.getIndex(); if (!idx) return null;
    var last = C.progress.lastLessonId;
    if (last) {
      var nb = C.neighbours(last);
      if (nb.index >= 0 && !C.isDone(last)) return { lessonId: last, title: lessonTitle(last), label: 'Resume', resumed: true };
      if (nb.next) return { lessonId: nb.next.lessonId, title: nb.next.title, label: 'Continue' };
    }
    var nu = nextUnfinishedLesson();
    if (nu) return { lessonId: nu.lessonId, title: nu.title, label: C.progress.startedAt ? 'Continue' : 'Start the course' };
    return null;
  }
  function lessonTitle(id) {
    var m = C.moduleOfLesson(id); if (!m) return id;
    for (var i = 0; i < m.lessons.length; i++) if (m.lessons[i].id === id) return m.lessons[i].title;
    return id;
  }
  function lessonMeta(id) {
    var m = C.moduleOfLesson(id); if (!m) return null;
    for (var i = 0; i < m.lessons.length; i++) if (m.lessons[i].id === id) return m.lessons[i];
    return null;
  }
  function moduleNumber(moduleId) {
    var idx = C.getIndex(); if (!idx) return 0;
    for (var i = 0; i < idx.modules.length; i++) if (idx.modules[i].id === moduleId) return i + 1;
    return 0;
  }

  /* ------------------------------------------------------------------ */
  /* Pro gating (BT.auth is optional; everything is free without it)      */
  /* ------------------------------------------------------------------ */
  function authOn() { return !!(BT.auth && BT.auth.config && typeof BT.auth.config === 'object'); }
  function gatingOn() { return authOn() && !!BT.auth.config.proGating; }
  function isPro() { try { return !!(authOn() && typeof BT.auth.isPro === 'function' && BT.auth.isPro()); } catch (e) { return false; } }
  function authConfigured() { try { return !!(authOn() && typeof BT.auth.configured === 'function' && BT.auth.configured()); } catch (e) { return false; } }
  function authSession() { try { return authOn() && typeof BT.auth.session === 'function' ? BT.auth.session() : null; } catch (e) { return null; } }
  /** lessonLocked(lesson | indexLesson) → true when Pro gating is on, the lesson is flagged pro and the visitor is not Pro. */
  function lessonLocked(lesson) {
    if (!lesson || !lesson.pro || !gatingOn()) return false;
    return !isPro();
  }

  /* ------------------------------------------------------------------ */
  /* Chart lifecycle                                                      */
  /* ------------------------------------------------------------------ */
  var liveCharts = [];
  function destroyCharts() {
    liveCharts.forEach(function (ch) { try { ch.remove(); } catch (e) { /* ignore */ } });
    liveCharts = [];
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                               */
  /* ------------------------------------------------------------------ */
  var booted = false;
  // decodeURIComponent throws URIError on malformed escapes (e.g. "#/lesson/%").
  // A mistyped or truncated link must fall through to "Lesson not found",
  // never kill the router, so fall back to the raw segment.
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function parseHash() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    return { view: parts[0] || 'home', id: parts[1] ? safeDecode(parts[1]) : null };
  }
  function go(hash) { location.hash = hash; }

  function route() {
    try {
      destroyCharts(); closeTermPop();
      var r = parseHash();
      if (r.view === 'lesson' && r.id) return showLesson(r.id);
      if (r.view === 'module' && r.id) return showModule(r.id);
      if (r.view === 'certificate') return showCertificate();
      return showHome();
    } catch (e) {
      // Any router exception degrades to a readable page instead of leaving
      // the loading state on screen with a rejected boot promise.
      try { showError('Bad link', 'That address could not be read. Pick a lesson from the course home.'); } catch (e2) { /* ignore */ }
      return undefined;
    }
  }

  var keepScroll = false;
  function setApp(html) {
    app.innerHTML = html;
    if (booted && !keepScroll) window.scrollTo(0, 0);
    // phone accordions for cards marked data-acc (nav.js; no-op on desktop)
    if (BT.nav && typeof BT.nav.accordion === 'function') { try { BT.nav.accordion(app); } catch (e) { /* ignore */ } }
  }

  function showError(title, message) {
    setApp('<div class="learn-hero"><div><h1>' + esc(title) + '</h1><p>' + esc(message) + '</p>' +
      '<div class="actions"><button class="primary" id="retry">Try again</button><a href="index.html"><button>Back to the dashboard</button></a></div></div></div>');
    var b = document.getElementById('retry'); if (b) b.onclick = function () { C.loadIndex(true).then(route, function (e) { showError('Could not load the course', e.message); }); };
  }

  /* ------------------------------------------------------------------ */
  /* Home                                                                 */
  /* ------------------------------------------------------------------ */
  function continueCard(ct, cp) {
    if (!ct) {
      return '<a class="card continue done" href="#/certificate"><div class="ctag">All lessons complete</div>' +
        '<h3>You have finished every lesson</h3><p>Check the quiz requirements and render your certificate.</p>' +
        '<span class="go">Go to certificate →</span></a>';
    }
    var m = C.moduleOfLesson(ct.lessonId), mp = m ? C.moduleProgress(m.id) : null, n = m ? moduleNumber(m.id) : 0;
    var lm = lessonMeta(ct.lessonId), locked = lessonLocked(lm);
    var lessonNo = 0; if (m) m.lessons.forEach(function (l, i) { if (l.id === ct.lessonId) lessonNo = i + 1; });
    var left = C.timeRemaining ? C.timeRemaining() : { minutes: cp.minutesLeft || 0, lessons: cp.total - cp.done };
    return '<a class="card continue" href="#/lesson/' + encodeURIComponent(ct.lessonId) + '" id="continueCard">' +
      '<div class="cbody"><div class="ctag">' + (cp.startedAt ? (ct.resumed ? 'Continue where you left off' : 'Up next') : 'Start here') + '</div>' +
      '<h3>' + esc(ct.title) + (locked ? ' ' + proPill() : '') + '</h3>' +
      '<p>' + (m ? 'Module ' + n + ': ' + esc(m.title) + ' · lesson ' + lessonNo + ' of ' + m.lessons.length + (lm && lm.minutes ? ' · ~' + lm.minutes + ' min' : '') : '') + '</p>' +
      '<div class="cmeta"><span>' + (mp ? '<b class="num">' + dur(mp.minutesLeft) + '</b> left in this module' : '') + '</span>' +
      '<span><b class="num">' + dur(left.minutes) + '</b> left in the course (' + left.lessons + ' lesson' + (left.lessons === 1 ? '' : 's') + ')</span></div>' +
      '<span class="go primary">' + esc(ct.label) + ' →</span></div>' +
      (mp ? ring(mp.pct, 'big', mp.done + '/' + mp.total) : '') + '</a>';
  }

  function proCard() {
    var pro = isPro(), configured = authConfigured();
    var head = pro ? '<span class="pill live">member</span>' : (configured ? '<span class="pill">optional</span>' : '<span class="pill soon">coming soon</span>');
    var body = pro
      ? '<p style="margin:0 0 8px;color:var(--muted)">Thank you for supporting the project. Your certificate is issued as verified and every lesson is open to you.</p>'
      : '<p style="margin:0 0 8px;color:var(--muted)">Broward Trading is free and the whole course stays free. Pro is an optional membership for people who want more:</p>' +
        '<ul><li>Verified certificates with a shareable link</li><li>Graded assignments and feedback on your trading journal</li><li>Live-data credits so you don’t need your own API key</li><li>Cohort sessions and office hours</li></ul>';
    return '<div class="card procard" data-acc>' + head + '<h2>Pro membership</h2>' + body +
      '<a href="pricing.html" class="btn' + (pro ? '' : ' primary') + '" style="display:inline-block;width:100%;text-align:center">' + (pro ? 'Manage membership' : (configured ? 'See what Pro adds' : 'See the Pro roadmap')) + '</a>' +
      (pro ? '' : '<p style="margin:8px 0 0;font-size:12px;color:var(--muted)">' + (configured ? 'Prices are shown before anything is charged.' : 'No payment is taken anywhere on this site today.') + '</p>') + '</div>';
  }

  function showHome() {
    var idx = C.getIndex(), cp = C.courseProgress(), ct = continueTarget(), cert = C.certificateStatus();
    var modCount = idx.modules.length, lessonCount = cp.total;
    var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    var html = '<section class="learn-hero">' +
      '<div><h1>' + esc(idx.title) + '</h1><p>' + esc(idx.summary) + '</p>' +
      '<p style="margin-top:8px">' + (WORDS[modCount] ? WORDS[modCount].charAt(0).toUpperCase() + WORDS[modCount].slice(1) : modCount) + ' modules, ' + lessonCount + ' lessons, a quiz in every lesson, about ' + dur(cp.minutes) + ' in all. Finish them with an ' + C.PASS_PCT + '% quiz average and you can issue your completion certificate. Everything you learn can be practised immediately on the <a href="index.html">dashboard</a> and in <a href="replay.html">Market Replay</a> with a paper account.</p>' +
      '<div class="actions">' +
      (ct ? '<a href="#/lesson/' + encodeURIComponent(ct.lessonId) + '"><button class="primary">' + esc(ct.label) + '</button></a>' :
        '<a href="#/certificate"><button class="primary">All lessons done — get your certificate</button></a>') +
      '<a href="#/certificate"><button>Certificate' + (cert.eligible ? ' ✓' : '') + '</button></a>' +
      '<a href="glossary.html"><button>Glossary</button></a>' +
      '</div></div>' +
      '<div class="card herostat">' + ring(cp.pct, 'big') +
      '<div class="stat"><span>Lessons done</span><span>' + cp.done + ' / ' + cp.total + '</span>' +
      '<span>Time left</span><span>' + (cp.minutesLeft ? '~' + dur(cp.minutesLeft) : 'none') + '</span>' +
      '<span>Quiz average</span><span>' + (cp.quizAvg == null ? '—' : cp.quizAvg + '%') + '</span>' +
      '<span>Quizzes taken</span><span>' + cp.quizzes + '</span>' +
      '<span>Started</span><span>' + (cp.startedAt ? esc(fmtDate(cp.startedAt)) : '—') + '</span></div></div>' +
      '</section>';

    html += continueCard(ct, cp);

    html += '<h2 class="sr-only">Modules</h2><div class="modgrid">' + idx.modules.map(function (m, i) {
      var mp = C.moduleProgress(m.id);
      var lockedCount = gatingOn() && !isPro() ? m.lessons.filter(function (l) { return l.pro; }).length : 0;
      return '<a class="card modcard' + (mp.pct >= 100 ? ' complete' : '') + '" href="#/module/' + encodeURIComponent(m.id) + '">' +
        '<div><div class="idx">Module ' + (i + 1) + (mp.pct >= 100 ? ' · complete' : mp.done ? ' · in progress' : '') + '</div><h3>' + esc(m.title) + '</h3><p>' + esc(m.summary) + '</p>' +
        '<div class="meta">' + levelPill(m.level) + '<span>' + esc(minutes(m.minutes)) + '</span><span>· ' + m.lessons.length + ' lessons</span>' +
        (mp.done && mp.minutesLeft ? '<span>· <b class="num">' + dur(mp.minutesLeft) + '</b> left</span>' : '') +
        (mp.quizAvg != null ? '<span>· quiz avg <b class="num">' + mp.quizAvg + '%</b></span>' : '') +
        (lockedCount ? '<span class="lockmeta">' + LOCK_SVG + ' ' + lockedCount + ' Pro lesson' + (lockedCount === 1 ? '' : 's') + '</span>' : '') + '</div></div>' +
        ring(mp.pct, '', mp.done + '/' + mp.total) + '</a>';
    }).join('') + '</div>';

    html += '<div class="homegrid">' +
      '<div class="card" data-acc><h2>How the course works</h2>' +
      '<p style="margin:0 0 8px;color:var(--muted)">Each lesson mixes short reading, a live chart you can inspect, a hands-on exercise on the dashboard or in Market Replay, and a quiz with instant explanations. Your progress is saved in this browser only — no account needed.</p>' +
      '<ul style="margin:0;padding-left:18px;color:var(--muted)"><li>Read in order; later modules assume the earlier ones.</li><li>Quizzes can be retaken — your best score counts.</li><li>Tap any <span class="gl-term on demo">underlined term</span> for a plain-English definition.</li><li>Do the exercises on your paper account. Mistakes are free here.</li></ul></div>' +

      '<div class="card" data-acc><h2>Certificate of completion</h2>' +
      '<p style="margin:0 0 8px;color:var(--muted)">' + (cert.eligible ? 'You have met every requirement. Add your name and issue your certificate.' :
        'Complete all ' + cp.total + ' lessons and keep each module’s quiz average at ' + C.PASS_PCT + '% or better.') + '</p>' +
      '<ul class="checklist" style="margin-bottom:10px">' + cert.modules.map(function (r) {
        return '<li><span class="' + (r.ok ? 'ok' : 'no') + '">' + (r.ok ? '✓' : '○') + '</span><span>' + esc(r.title) + '</span><span class="num" style="color:var(--muted)">' + (r.ok ? 'passed' : esc(r.reason)) + '</span></li>';
      }).join('') + '</ul>' +
      '<a href="#/certificate"><button class="' + (cert.eligible ? 'primary' : '') + '">' + (cert.eligible ? 'Get your certificate' : 'View requirements') + '</button></a></div>' +
      proCard() +
      '</div>';

    setApp(html);
  }

  /* ------------------------------------------------------------------ */
  /* Module → first unfinished lesson                                      */
  /* ------------------------------------------------------------------ */
  function showModule(moduleId) {
    var idx = C.getIndex();
    var m = idx.modules.filter(function (x) { return x.id === moduleId; })[0];
    if (!m) return showError('Module not found', 'There is no module called "' + moduleId + '".');
    var target = nextUnfinishedLesson(moduleId) || (m.lessons[0] ? { lessonId: m.lessons[0].id } : null);
    if (!target) return showError('Empty module', 'This module has no lessons yet.');
    location.replace('#/lesson/' + encodeURIComponent(target.lessonId));
  }

  /* ------------------------------------------------------------------ */
  /* Sidebar (desktop list; a native dropdown on phones)                  */
  /* ------------------------------------------------------------------ */
  var openModules = {};
  function sidebarHtml(currentLessonId) {
    var idx = C.getIndex(), curMod = C.moduleOfLesson(currentLessonId);
    var curNo = curMod ? moduleNumber(curMod.id) : 0, lessonNo = 0, curMp = curMod ? C.moduleProgress(curMod.id) : null;
    if (curMod) curMod.lessons.forEach(function (l, i) { if (l.id === currentLessonId) lessonNo = i + 1; });

    // phone: one <select> with an optgroup per module (the OS shows its own picker)
    var pick = '<div class="lesson-pick"><label class="sr-only" for="lessonPick">Jump to a lesson</label><select id="lessonPick" aria-label="Jump to a lesson">' +
      '<option value="#/">← Course home</option>' + idx.modules.map(function (m, i) {
        var mp = C.moduleProgress(m.id);
        return '<optgroup label="Module ' + (i + 1) + ': ' + esc(m.title) + ' (' + mp.done + '/' + mp.total + ')">' + m.lessons.map(function (l, j) {
          return '<option value="#/lesson/' + encodeURIComponent(l.id) + '"' + (l.id === currentLessonId ? ' selected' : '') + '>' +
            (C.isDone(l.id) ? '✓ ' : '') + (j + 1) + '. ' + esc(l.title) + (lessonLocked(l) ? ' (Pro)' : '') + '</option>';
        }).join('') + '</optgroup>';
      }).join('') + '</select>' +
      (curMod ? '<div class="pickmeta"><span>Module ' + curNo + ' · lesson ' + lessonNo + ' of ' + curMod.lessons.length + '</span><span class="num">' + (curMp && curMp.minutesLeft ? '~' + dur(curMp.minutesLeft) + ' left in module' : 'module complete') + '</span></div>' : '') +
      '</div>';

    var list = '<div class="sblist"><a class="back" href="#/">← Course home</a>' + idx.modules.map(function (m, i) {
      var mp = C.moduleProgress(m.id), isCur = curMod && curMod.id === m.id;
      var open = isCur || openModules[m.id];
      return '<details data-mod="' + esc(m.id) + '"' + (open ? ' open' : '') + '><summary><span>Module ' + (i + 1) + ': ' + esc(m.title) +
        '<small>' + mp.done + '/' + mp.total + ' lessons' + (mp.minutesLeft ? ' · ~' + dur(mp.minutesLeft) + ' left' : '') + (mp.quizAvg != null ? ' · quiz ' + mp.quizAvg + '%' : '') + '</small></span>' + ring(mp.pct, 'sm', mp.done + '/' + mp.total) + '</summary>' +
        '<ul class="lessons">' + m.lessons.map(function (l) {
          var sc = C.quizScore(l.id), locked = lessonLocked(l);
          return '<li><a href="#/lesson/' + encodeURIComponent(l.id) + '"' + (l.id === currentLessonId ? ' class="current" aria-current="page"' : '') + '>' +
            '<span class="tick' + (C.isDone(l.id) ? ' done' : '') + '" aria-hidden="true"></span><span>' + esc(l.title) + (l.minutes ? ' <small class="num">' + l.minutes + 'm</small>' : '') + '</span>' +
            (locked ? '<span class="score lockicon" title="Pro lesson">' + LOCK_SVG + '</span>' :
              '<span class="score ' + (sc == null ? '' : sc >= C.PASS_PCT ? 'pass' : 'fail') + '">' + (sc == null ? '' : sc + '%') + '</span>') + '</a></li>';
        }).join('') + '</ul></details>';
    }).join('') + '</div>';
    return pick + list;
  }
  function refreshSidebar(currentLessonId) {
    var sb = document.getElementById('sidebar'); if (!sb) return;
    sb.querySelectorAll('details').forEach(function (d) { openModules[d.dataset.mod] = d.open; });
    sb.innerHTML = sidebarHtml(currentLessonId);
    bindSidebar(sb);
  }
  function bindSidebar(sb) {
    sb.querySelectorAll('details').forEach(function (d) { d.addEventListener('toggle', function () { openModules[d.dataset.mod] = d.open; }); });
    var pick = sb.querySelector('#lessonPick');
    if (pick) pick.addEventListener('change', function () { if (pick.value) go(pick.value); });
  }

  /* ------------------------------------------------------------------ */
  /* Lesson reader                                                        */
  /* ------------------------------------------------------------------ */
  function showLesson(lessonId) {
    var meta = C.moduleOfLesson(lessonId);
    if (!meta) return showError('Lesson not found', 'There is no lesson called "' + lessonId + '". Pick one from the course home.');
    setApp('<div class="learn-layout"><aside class="card sidebar" id="sidebar">' + sidebarHtml(lessonId) + '</aside><section class="reader"><div class="empty">Loading lesson…</div></section></div>');
    bindSidebar(document.getElementById('sidebar'));
    var token = lessonId;
    C.loadModule(meta.id).then(function (mod) {
      if (parseHash().id !== token) return;        // navigated away meanwhile
      var lesson = mod.lessons.filter(function (l) { return l.id === lessonId; })[0];
      if (!lesson) {
        var reader = app.querySelector('.reader');
        reader.innerHTML = '<div class="empty">This lesson is listed in the index but missing from <code>course/' + esc(mod.id) + '.json</code>.</div>';
        return;
      }
      refreshSidebar(lessonId);                    // real titles now known
      if (lessonLocked(lesson)) renderLockedLesson(mod, lesson); else renderLesson(mod, lesson);
      C.setLastLesson(lessonId);
    }, function (e) {
      var reader = app.querySelector('.reader');
      if (reader) reader.innerHTML = '<div class="card"><h2>Could not load this module</h2><p class="msg">' + esc(e.message) + '</p></div>';
    });
  }

  function lessonHeader(mod, lesson, extra) {
    var idx = C.getIndex(), modIndex = idx.modules.findIndex(function (m) { return m.id === mod.id; });
    var lessonIndex = mod.lessons.findIndex(function (l) { return l.id === lesson.id; });
    var hasQuiz = C.lessonHasQuiz(lesson), mp = C.moduleProgress(mod.id);
    return '<div class="crumbs"><a href="#/">Course</a><span>›</span><a href="#/module/' + encodeURIComponent(mod.id) + '">Module ' + (modIndex + 1) + ': ' + esc(mod.title) + '</a><span>›</span><span>Lesson ' + (lessonIndex + 1) + ' of ' + mod.lessons.length + '</span></div>' +
      '<h1>' + esc(lesson.title) + '</h1>' +
      '<div class="lmeta">' + levelPill(mod.level) + (lesson.pro && gatingOn() ? proPill() : '') + '<span>' + esc(minutes(lesson.minutes)) + '</span>' +
      (hasQuiz ? '<span>· quiz' + (C.quizScore(lesson.id) != null ? ' best ' + C.quizScore(lesson.id) + '%' : '') + '</span>' : '') +
      (C.isDone(lesson.id) ? '<span style="color:var(--up)">· completed</span>' : (mp.minutesLeft ? '<span>· ~' + dur(mp.minutesLeft) + ' left in module</span>' : '')) +
      (extra || '') + '</div>';
  }

  function lessonNavHtml(nb) {
    return '<nav class="lesson-nav" aria-label="Lesson">' +
      '<span>' + (nb.prev ? '<a href="#/lesson/' + encodeURIComponent(nb.prev.lessonId) + '"><button>← <span class="navt">' + esc(nb.prev.title) + '</span></button></a>' : '') + '</span>' +
      '<span id="doneArea"></span>' +
      '<span>' + (nb.next ? '<a href="#/lesson/' + encodeURIComponent(nb.next.lessonId) + '"><button><span class="navt">' + esc(nb.next.title) + '</span> →</button></a>' : '<a href="#/certificate"><button>Finish → certificate</button></a>') + '</span>' +
      '</nav>';
  }

  function renderLesson(mod, lesson) {
    var nb = C.neighbours(lesson.id), hasQuiz = C.lessonHasQuiz(lesson);
    var reader = app.querySelector('.reader');
    reader.innerHTML = lessonHeader(mod, lesson) + '<div class="blocks" id="blocks"></div>' + lessonNavHtml(nb);

    var blocks = document.getElementById('blocks');
    if (!lesson.blocks.length) blocks.innerHTML = '<div class="empty">This lesson has no content yet.</div>';
    lesson.blocks.forEach(function (b, i) {
      var el = renderBlock(b, lesson, i);
      if (el) blocks.appendChild(el);
    });
    renderDoneArea(lesson, nb, hasQuiz);
    enhanceTerms(blocks, lesson.id);
  }

  /** Locked preview: title, the first paragraphs of the first text block, then the Pro card. */
  function renderLockedLesson(mod, lesson) {
    var nb = C.neighbours(lesson.id);
    var reader = app.querySelector('.reader');
    var first = lesson.blocks.filter(function (b) { return b.type === 'text' && b.md; })[0];
    var previewMd = first ? String(first.md).split(/\n\s*\n/).slice(0, 2).join('\n\n') : '';
    var counts = { chart: 0, quiz: 0, drill: 0, exercise: 0 };
    lesson.blocks.forEach(function (b) { if (counts[b.type] != null) counts[b.type]++; });
    var inside = [];
    if (counts.chart) inside.push(counts.chart + ' live chart' + (counts.chart === 1 ? '' : 's'));
    if (counts.exercise) inside.push(counts.exercise + ' hands-on exercise' + (counts.exercise === 1 ? '' : 's'));
    if (counts.drill) inside.push(counts.drill + ' replay drill' + (counts.drill === 1 ? '' : 's'));
    if (counts.quiz) inside.push('a graded quiz');
    var signedIn = !!authSession();
    reader.innerHTML = lessonHeader(mod, lesson) +
      '<div class="blocks">' +
      (previewMd ? '<div class="block-text locked-preview" aria-label="Lesson preview">' + C.renderMd(previewMd) + '</div>' : '') +
      '<section class="card locked" aria-label="Pro lesson">' + LOCK_SVG.replace('width="14" height="14"', 'width="28" height="28"') +
      '<h2>This lesson is part of Pro</h2>' +
      '<p>' + (lesson.summary ? esc(lesson.summary) + ' ' : '') + 'The rest of <b>' + esc(lesson.title) + '</b>' + (inside.length ? ' (' + inside.join(', ') + ')' : '') + ' opens with a Pro membership. The core course stays free, and your progress is kept either way.</p>' +
      '<div class="actions"><a class="btn primary" href="pricing.html">See Pro plans</a>' +
      (authConfigured() && !signedIn ? '<a class="btn" href="pricing.html#signin">Already a member? Sign in</a>' : '') +
      (nb.next ? '<a class="btn ghost" href="#/lesson/' + encodeURIComponent(nb.next.lessonId) + '">Skip to the next lesson →</a>' : '') + '</div>' +
      '</section></div>' + lessonNavHtml(nb);
    var area = document.getElementById('doneArea');
    if (area) area.innerHTML = '<span class="done-note" style="color:var(--muted)">Pro lesson</span>';
    enhanceTerms(reader.querySelector('.locked-preview'), lesson.id);
  }

  function renderDoneArea(lesson, nb, hasQuiz) {
    var area = document.getElementById('doneArea'); if (!area) return;
    if (C.isDone(lesson.id)) {
      area.innerHTML = '<span class="done-note">✓ Lesson complete</span> <button class="toolbtn" id="undo">Undo</button>';
      document.getElementById('undo').onclick = function () { C.unmarkDone(lesson.id); refreshSidebar(lesson.id); renderDoneArea(lesson, nb, hasQuiz); };
      return;
    }
    var hint = hasQuiz && C.quizScore(lesson.id) == null ? '<small style="display:block;color:var(--muted);font-size:11px">Tip: take the quiz first — it counts toward your certificate.</small>' : '';
    area.innerHTML = '<button class="primary" id="markDone">Mark complete' + (nb.next ? ' &amp; continue' : '') + '</button>' + hint;
    document.getElementById('markDone').onclick = function () {
      C.markDone(lesson.id); refreshSidebar(lesson.id);
      if (nb.next) go('#/lesson/' + encodeURIComponent(nb.next.lessonId)); else renderDoneArea(lesson, nb, hasQuiz);
    };
  }

  /* ------------------------------------------------------------------ */
  /* Glossary tooltips for [[terms]] (course/glossary.json, loaded lazily)*/
  /* ------------------------------------------------------------------ */
  var pop = null, popAnchor = null;
  function enhanceTerms(container, lessonId) {
    if (!container || !C.glossary) return;
    var spans = container.querySelectorAll('.gl-term');
    if (!spans.length) return;
    C.glossary.load().then(function (g) {
      if (!g || !container.isConnected) return;      // glossary unavailable → the spans stay plain text
      spans.forEach(function (sp) {
        var t = C.glossary.lookup(sp.getAttribute('data-term'));
        if (!t) { sp.classList.add('unknown'); return; }
        sp.classList.add('on');
        sp.setAttribute('role', 'button'); sp.setAttribute('tabindex', '0'); sp.setAttribute('aria-haspopup', 'dialog');
        sp.setAttribute('data-id', t.id);
        sp.title = t.term + ': ' + t.definition;
        sp.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleTermPop(sp, t, lessonId); });
        sp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTermPop(sp, t, lessonId); } });
      });
    });
  }
  function toggleTermPop(anchor, t, lessonId) {
    if (pop && popAnchor === anchor) { closeTermPop(); return; }
    openTermPop(anchor, t, lessonId);
  }
  function openTermPop(anchor, t, lessonId) {
    closeTermPop();
    var catLabel = t.category ? C.glossary.categoryLabel(t.category) : '';
    var related = (t.related || []).map(function (id) { return C.glossary.lookup(id); }).filter(Boolean).slice(0, 4);
    pop = document.createElement('div');
    pop.className = 'gl-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t.term + ' — definition');
    pop.innerHTML = '<div class="gl-head"><b>' + esc(t.term) + '</b>' + (catLabel ? '<span class="pill">' + esc(catLabel) + '</span>' : '') +
      '<button type="button" class="gl-close" aria-label="Close">✕</button></div>' +
      '<p class="gl-def">' + esc(t.definition) + '</p>' +
      (t.example ? '<p class="gl-ex"><b>Example.</b> ' + esc(t.example) + '</p>' : '') +
      (related.length ? '<p class="gl-rel">Related: ' + related.map(function (r) { return '<a href="' + esc(C.glossary.url(r)) + '">' + esc(r.term) + '</a>'; }).join(' · ') + '</p>' : '') +
      '<div class="gl-links"><a href="' + esc(C.glossary.url(t)) + '">Open in glossary →</a>' +
      (t.lesson && t.lesson !== lessonId && C.moduleOfLesson(t.lesson) ? '<a href="#/lesson/' + encodeURIComponent(t.lesson) + '">Taught in: ' + esc(lessonTitle(t.lesson)) + '</a>' : '') + '</div>';
    document.body.appendChild(pop);
    popAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    pop.querySelector('.gl-close').onclick = closeTermPop;
    if (!isPhone()) {
      var r = anchor.getBoundingClientRect(), w = Math.min(360, window.innerWidth - 24);
      pop.style.width = w + 'px';
      var left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + window.scrollX)), top = r.bottom + window.scrollY + 8;
      if (r.bottom + 260 > window.innerHeight && r.top > 280) { pop.classList.add('above'); top = r.top + window.scrollY - 8; pop.style.transform = 'translateY(-100%)'; }
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    } else pop.classList.add('gl-sheet');
    if (document.body.classList.contains('has-tabbar')) pop.classList.add('above-tabbar');
    setTimeout(function () { document.addEventListener('click', onDocClick, true); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', closeTermPop); }, 0);
    var closeBtn = pop.querySelector('.gl-close'); if (isPhone() && closeBtn) closeBtn.focus();
  }
  function onDocClick(e) { if (pop && !pop.contains(e.target) && e.target !== popAnchor) closeTermPop(); }
  function onKey(e) { if (e.key === 'Escape') { closeTermPop(); if (popAnchor) popAnchor.focus(); } }
  function closeTermPop() {
    if (!pop) return;
    try { pop.remove(); } catch (e) { /* ignore */ }
    if (popAnchor) popAnchor.setAttribute('aria-expanded', 'false');
    pop = null; popAnchor = null;
    document.removeEventListener('click', onDocClick, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', closeTermPop);
  }

  /* ------------------------------------------------------------------ */
  /* Block renderers                                                      */
  /* ------------------------------------------------------------------ */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function renderBlock(b, lesson, i) {
    switch (b.type) {
      case 'text': return el('div', 'block-text', C.renderMd(b.md));
      case 'callout': return renderCallout(b);
      case 'chart': return renderChartBlock(b);
      case 'exercise': return renderExercise(b);
      case 'drill': return renderDrill(b, lesson);
      case 'quiz': return renderQuiz(b, lesson, i);
      case 'image': return renderImage(b);
      default: return el('div', 'block-text', '<p style="color:var(--muted)">[Unsupported block type: ' + esc(b.type) + ']</p>');
    }
  }

  var TONE = { tip: 'Tip', warn: 'Watch out', key: 'Key idea' };
  function renderCallout(b) {
    var tone = TONE[b.tone] ? b.tone : 'key';
    return el('aside', 'callout ' + tone, '<div class="ctitle">' + esc(b.title || TONE[tone]) + '</div>' + C.renderMd(b.md));
  }

  function actionHref(a) {
    a = a || {};
    var page = ALLOWED_PAGES.indexOf(a.page) >= 0 ? a.page : null;
    if (!page) return null;
    return page + (a.hash ? (String(a.hash)[0] === '#' ? a.hash : '#' + a.hash) : '');
  }
  function renderExercise(b) {
    var a = b.action || {}, href = actionHref(a), page = href ? href.split('#')[0] : null;
    return el('section', 'exercise', '<div class="etitle">Hands-on exercise</div>' + C.renderMd(b.md) +
      (href ? '<a class="go" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(a.label || PAGE_LABEL[page] || 'Open') + ' ↗</a>' : ''));
  }

  /* --- drill block: {type:'drill', drillId, md?} → details from course/drills.json + 'Practice in Replay' --- */
  var drillsPromise = null;
  function loadDrills() {
    if (drillsPromise) return drillsPromise;
    var p;
    if (BT.replay && typeof BT.replay.loadDrills === 'function') p = BT.replay.loadDrills();
    else p = fetch('course/drills.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return Array.isArray(j) ? j : (j && Array.isArray(j.drills) ? j.drills : []); });
    drillsPromise = p.then(function (list) { return Array.isArray(list) ? list : []; }).catch(function () { drillsPromise = null; return []; });
    return drillsPromise;
  }
  var CRIT_TEXT = {
    min_trades: function (v) { return 'Complete at least ' + (v == null ? 1 : v) + ' round trip' + ((v == null ? 1 : v) === 1 ? '' : 's'); },
    max_trades: function (v) { return 'No more than ' + v + ' round trips'; },
    min_return_pct: function (v) { return 'Return of at least ' + v + '%'; },
    positive_return: function () { return 'Finish with a positive return'; },
    beat_buy_hold: function () { return 'Beat buy-and-hold over the same bars'; },
    max_drawdown_pct: function (v) { return 'Keep the maximum drawdown under ' + v + '%'; },
    min_win_rate_pct: function (v) { return 'Win rate of ' + v + '% or better'; },
    min_profit_factor: function (v) { return 'Profit factor of at least ' + v; },
    flat_at_end: function () { return 'Be flat (no open position) when the session ends'; },
    used_stop: function (v) { return 'Use at least ' + (v == null ? 1 : v) + ' stop order' + ((v == null ? 1 : v) === 1 ? '' : 's'); },
    used_limit: function (v) { return 'Use at least ' + (v == null ? 1 : v) + ' limit order' + ((v == null ? 1 : v) === 1 ? '' : 's'); },
    used_short: function () { return 'Open at least one short position'; },
    no_short: function () { return 'No short selling'; }
  };
  function critText(c) {
    if (!c || typeof c !== 'object') return '';
    if (c.text) return String(c.text);
    var f = CRIT_TEXT[c.type]; return f ? f(c.value) : String(c.type || '');
  }
  function drillAttempts(drillId) {
    var list = store.get('bt.replay.sessions', []);
    if (!Array.isArray(list)) return { count: 0, passed: 0, best: null };
    var mine = list.filter(function (s) { return s && s.drill && s.drill.id === drillId; });
    var passed = mine.filter(function (s) { return s.drill.passed; }).length, best = null;
    mine.forEach(function (s) { if (typeof s.returnPct === 'number' && (best == null || s.returnPct > best)) best = s.returnPct; });
    return { count: mine.length, passed: passed, best: best };
  }
  function renderDrill(b, lesson) {
    var id = String(b.drillId || b.id || '').replace(/[^\w-]/g, '').slice(0, 60);
    var href = id ? 'replay.html#drill=' + encodeURIComponent(id) : 'replay.html';
    var box = el('section', 'drill card', '<div class="dtitle">Practice drill</div>' +
      (b.md ? C.renderMd(b.md) : '') +
      '<div class="dmeta" data-role="meta">' + (id ? '<span class="pill">loading drill details…</span>' : '') + '</div>' +
      '<div class="dcrit" data-role="crit"></div>' +
      '<div class="dactions"><a class="go" href="' + esc(href) + '" target="_blank" rel="noopener">Practice in Replay ↗</a><span class="dattempts" data-role="attempts"></span></div>');
    box.setAttribute('aria-label', 'Practice drill');
    if (!id) { box.querySelector('[data-role=meta]').innerHTML = '<span class="pill demo">No drill id given</span>'; return box; }
    var meta = box.querySelector('[data-role=meta]'), crit = box.querySelector('[data-role=crit]'), att = box.querySelector('[data-role=attempts]');
    var a = drillAttempts(id);
    if (a.count) att.textContent = a.count + ' attempt' + (a.count === 1 ? '' : 's') + ' · ' + a.passed + ' passed' + (a.best != null ? ' · best ' + (a.best >= 0 ? '+' : '') + a.best.toFixed(1) + '%' : '');
    loadDrills().then(function (list) {
      if (!box.isConnected) return;
      var d = list.filter(function (x) { return x && x.id === id; })[0];
      if (!d) { meta.innerHTML = '<span class="pill demo">Drill "' + esc(id) + '" is not in course/drills.json yet</span>'; return; }
      var when = d.start ? (d.start + (d.end ? ' → ' + d.end : '')) : '';
      meta.innerHTML = '<b>' + esc(d.title || id) + '</b>' +
        '<span class="num">' + esc(String(d.symbol || '')) + ' · ' + esc(String(d.interval || '1day')) + (when ? ' · ' + esc(when) : '') + '</span>' +
        (d.minutes ? '<span>~' + (+d.minutes) + ' min</span>' : '') +
        (d.ticks ? '<span class="pill">intrabar ticks</span>' : '') +
        (d.cash ? '<span class="num">$' + Number(d.cash).toLocaleString() + ' replay account</span>' : '');
      var crits = Array.isArray(d.criteria) ? d.criteria.map(critText).filter(Boolean) : [];
      var hints = Array.isArray(d.hints) ? d.hints.map(String) : [];
      crit.innerHTML = (d.objective ? '<p class="dobj">' + esc(d.objective) + '</p>' : '') +
        (crits.length ? '<details class="dmore"><summary>Pass criteria (' + crits.length + ')</summary><ul>' + crits.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></details>' : '') +
        (hints.length ? '<details class="dmore"><summary>Hints (' + hints.length + ')</summary><ul>' + hints.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></details>' : '') +
        '<p class="dnote">Replay hides the future: you decide on the bars revealed so far, then step forward. Trades go to a separate <em>replay</em> paper account, so your main portfolio is untouched.</p>';
    });
    return box;
  }

  function renderImage(b) {
    // only relative course assets are allowed, so a module file cannot hot-link anything
    var src = String(b.src || ''); if (!/^(course|img|assets|icons)\/[\w./-]+$/.test(src)) return null;
    return el('figure', 'chartblock card', '<img src="' + esc(src) + '" alt="' + esc(b.alt || '') + '" style="display:block;max-width:100%">' + (b.caption ? '<figcaption class="caption">' + C.renderMd(b.caption) + '</figcaption>' : ''));
  }

  /* --- chart block --- */
  var OVERLAY_COLORS = { sma20: '#f5b84d', sma50: '#4f8cff', sma200: '#c084fc', ema9: '#c084fc', ema21: '#22d3ee', ema50: '#38bdf8', wma20: '#fb923c', vwap: '#f472b6', bb: '#8a97a8' };
  var OVERLAY_LABELS = { bb: 'Bollinger (20, 2)', bollinger: 'Bollinger (20, 2)', sr: 'Support / resistance', vwap: 'VWAP', volume: 'Volume', rsi: 'RSI (14)', macd: 'MACD (12, 26, 9)', fib: 'Fibonacci', patterns: 'Candle patterns', signals: 'Composite signals' };

  function renderChartBlock(b) {
    var symbol = String(b.symbol || 'AAPL').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10) || 'AAPL';
    var interval = ['1day', '1h', '15min', '5min', '1min'].indexOf(b.interval) >= 0 ? b.interval : '1day';
    var overlays = Array.isArray(b.overlays) ? b.overlays.map(String) : [];
    var limit = Math.max(40, Math.min(400, +b.bars || +b.limit || (interval === '1day' ? 160 : 200)));
    var wantRsi = overlays.indexOf('rsi') >= 0, wantMacd = overlays.indexOf('macd') >= 0;

    var wrap = el('figure', 'chartblock card',
      '<div class="chead"><b>' + esc(symbol) + '</b><span>' + esc(interval) + '</span><span class="pill" data-role="src">loading</span>' +
      '<span class="legend" data-role="legend"></span></div>' +
      '<div class="cpane" data-role="price"><div class="cstatus">Loading chart…</div></div>' +
      (wantRsi ? '<div class="cpane sub" data-role="rsi"></div>' : '') +
      (wantMacd ? '<div class="cpane sub" data-role="macd"></div>' : '') +
      (b.caption ? '<figcaption class="caption">' + C.renderMd(b.caption) + '</figcaption>' : ''));
    wrap.style.margin = '0';

    var pricePane = wrap.querySelector('[data-role=price]'), status = pricePane.querySelector('.cstatus');
    var srcPill = wrap.querySelector('[data-role=src]'), legend = wrap.querySelector('[data-role=legend]');

    if (!window.LightweightCharts) {
      status.textContent = 'The chart library did not load (offline?). The lesson text still applies — open the dashboard to see this chart live.';
      srcPill.textContent = 'offline'; return wrap;
    }
    if (!BT.data) { status.textContent = 'Data module missing.'; srcPill.textContent = 'error'; return wrap; }

    BT.data.candles(symbol, interval, limit).catch(function (e) {
      var bars = BT.data.demo(symbol, interval, limit); bars.fallback = true; bars.reason = e && e.message; return bars;
    }).then(function (bars) {
      if (!wrap.isConnected) return;
      if (!bars || !bars.length) { status.textContent = 'No data for ' + symbol + '.'; srcPill.textContent = 'error'; return; }
      var live = bars.live && !bars.fallback;
      srcPill.textContent = live ? (bars.cached ? 'live · cached' : 'live') : 'demo';
      srcPill.className = 'pill ' + (live ? 'live' : 'demo');
      srcPill.title = live ? 'Real market data from ' + (bars.source || 'your provider') : 'Simulated prices (deterministic demo walk). ' + (bars.reason || 'Add an API key on the dashboard for real data.');
      status.remove();
      drawChart(wrap, bars, overlays, interval, legend);
    }).catch(function (e) {
      status.textContent = 'Chart error: ' + (e && e.message ? e.message : e); srcPill.textContent = 'error';
    });
    return wrap;
  }

  function chartTheme(interval) {
    return {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--muted'), fontFamily: css('--mono') || 'monospace', fontSize: 11 },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: interval !== '1day', secondsVisible: false },
      crosshair: { mode: 0 },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true }
    };
  }

  function drawChart(wrap, bars, overlays, interval, legend) {
    var LW = window.LightweightCharts, I = BT.ind;
    var up = css('--up'), down = css('--down');
    var pricePane = wrap.querySelector('[data-role=price]');
    var chart = LW.createChart(pricePane, chartTheme(interval));
    liveCharts.push(chart);
    var charts = [chart];
    var candles = chart.addCandlestickSeries({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    candles.setData(bars);
    var legendItems = [];
    var closes = bars.map(function (b) { return b.close; });
    var line = function (color, style) { return chart.addLineSeries({ color: color, lineWidth: 1, lineStyle: style || 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); };
    var toLine = function (series) { return I && I.toLineData ? I.toLineData(bars, series) : bars.map(function (b, i) { return series[i] == null ? null : { time: b.time, value: series[i] }; }).filter(Boolean); };
    var markers = [];

    overlays.forEach(function (ov) {
      var m, name = ov.toLowerCase();
      if (!I) return;
      if ((m = /^(sma|ema|wma)(\d{1,3})$/.exec(name))) {
        var n = +m[2]; if (n < 2 || n >= bars.length) return;
        var fn = I[m[1]]; if (!fn) return;
        var color = OVERLAY_COLORS[name] || ['#f5b84d', '#4f8cff', '#c084fc', '#22d3ee'][legendItems.length % 4];
        line(color).setData(toLine(fn(closes, n)));
        legendItems.push({ label: m[1].toUpperCase() + ' ' + n, color: color });
      } else if (name === 'bb' || name === 'bollinger') {
        var bb = I.bollinger(closes, 20, 2);
        line(OVERLAY_COLORS.bb, 2).setData(toLine(bb.upper)); line(OVERLAY_COLORS.bb, 2).setData(toLine(bb.lower)); line(OVERLAY_COLORS.bb, 0).setData(toLine(bb.middle));
        legendItems.push({ label: OVERLAY_LABELS.bb, color: OVERLAY_COLORS.bb });
      } else if (name === 'vwap') {
        line(OVERLAY_COLORS.vwap).setData(toLine(I.vwap(bars))); legendItems.push({ label: 'VWAP', color: OVERLAY_COLORS.vwap });
      } else if (name === 'sr' || name === 'support' || name === 'levels') {
        var sr = I.supportResistance(bars, 120, 3);
        sr.resistance.forEach(function (p) { candles.createPriceLine({ price: p, color: down, lineStyle: 2, lineWidth: 1, title: 'R', axisLabelVisible: true }); });
        sr.support.forEach(function (p) { candles.createPriceLine({ price: p, color: up, lineStyle: 2, lineWidth: 1, title: 'S', axisLabelVisible: true }); });
        legendItems.push({ label: 'S / R levels', color: css('--muted') });
      } else if (name === 'fib') {
        var rec = bars.slice(-120), hi = -Infinity, lo = Infinity;
        rec.forEach(function (b) { if (b.high > hi) hi = b.high; if (b.low < lo) lo = b.low; });
        I.fibonacci(hi, lo).forEach(function (f) { candles.createPriceLine({ price: f.price, color: '#c084fc', lineStyle: 3, lineWidth: 1, title: (f.level * 100).toFixed(1) + '%', axisLabelVisible: false }); });
        legendItems.push({ label: 'Fibonacci', color: '#c084fc' });
      } else if (name === 'volume' || name === 'vol') {
        var vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        vol.setData(bars.map(function (b) { return { time: b.time, value: b.volume || 0, color: (b.close >= b.open ? up : down) + '55' }; }));
        legendItems.push({ label: 'Volume', color: css('--muted') });
      } else if (name === 'patterns') {
        var pats = I.candlePatterns(bars).slice(-14);
        pats.forEach(function (p) {
          var b = bars[p.index]; if (!b) return;
          markers.push({ time: b.time, position: p.bias === 'bull' ? 'belowBar' : 'aboveBar', color: p.bias === 'bull' ? up : p.bias === 'bear' ? down : css('--warn'), shape: p.bias === 'bull' ? 'arrowUp' : p.bias === 'bear' ? 'arrowDown' : 'circle', text: p.name });
        });
        legendItems.push({ label: 'Candle patterns', color: css('--warn') });
      } else if (name === 'signals') {
        var states = I.signalSeries(bars), prev = 'HOLD';
        for (var i = 0; i < bars.length; i++) {
          var st = states[i] || 'HOLD';
          if (st !== prev && st !== 'HOLD') markers.push({ time: bars[i].time, position: st === 'BUY' ? 'belowBar' : 'aboveBar', color: st === 'BUY' ? up : down, shape: st === 'BUY' ? 'arrowUp' : 'arrowDown', text: st });
          prev = st;
        }
        legendItems.push({ label: 'BUY / SELL signals', color: css('--accent') });
      } else if (name === 'rsi') {
        var rsiPane = wrap.querySelector('[data-role=rsi]'); if (!rsiPane) return;
        var chR = LW.createChart(rsiPane, Object.assign(chartTheme(interval), { rightPriceScale: { borderColor: css('--line'), scaleMargins: { top: 0.1, bottom: 0.1 } } }));
        liveCharts.push(chR); charts.push(chR);
        var rs = chR.addLineSeries({ color: '#c084fc', lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
        rs.setData(toLine(I.rsi(closes, 14)));
        rs.createPriceLine({ price: 70, color: down, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: '70' });
        rs.createPriceLine({ price: 30, color: up, lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: '30' });
        legendItems.push({ label: 'RSI (14) below', color: '#c084fc' });
      } else if (name === 'macd') {
        var macdPane = wrap.querySelector('[data-role=macd]'); if (!macdPane) return;
        var chM = LW.createChart(macdPane, chartTheme(interval));
        liveCharts.push(chM); charts.push(chM);
        var md = I.macd(closes, 12, 26, 9);
        var hist = chM.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        hist.setData(bars.map(function (b, i) { return md.hist[i] == null ? null : { time: b.time, value: md.hist[i], color: md.hist[i] >= 0 ? up : down }; }).filter(Boolean));
        chM.addLineSeries({ color: '#4f8cff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(toLine(md.macd));
        chM.addLineSeries({ color: '#f5b84d', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(toLine(md.signal));
        legendItems.push({ label: 'MACD (12, 26, 9) below', color: '#4f8cff' });
      }
    });

    if (markers.length) { markers.sort(function (a, b) { return a.time > b.time ? 1 : a.time < b.time ? -1 : 0; }); candles.setMarkers(markers); }
    if (legend) legend.innerHTML = legendItems.map(function (it) { return '<span style="color:' + esc(it.color) + '">' + esc(it.label) + '</span>'; }).join('');

    // keep sub-panes in step with the price pane
    var syncing = false;
    charts.forEach(function (c) {
      c.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
        if (syncing || !r) return; syncing = true;
        charts.forEach(function (o) { if (o !== c) o.timeScale().setVisibleLogicalRange(r); });
        syncing = false;
      });
    });
    chart.timeScale().fitContent();
  }

  /* --- quiz block --- */
  function renderQuiz(b, lesson, blockIndex) {
    var questions = (Array.isArray(b.questions) ? b.questions : []).filter(function (q) { return q && Array.isArray(q.choices) && q.choices.length > 1; });
    var box = el('section', 'quiz');
    box.setAttribute('aria-label', 'Quiz');
    if (!questions.length) { box.innerHTML = '<div class="qtitle">Quiz</div><p style="color:var(--muted)">No questions yet.</p>'; return box; }

    var answers = [];
    function best() { var s = C.quizScore(lesson.id); return s == null ? '' : 'best ' + s + '%'; }

    function build() {
      answers = new Array(questions.length).fill(null);
      box.innerHTML = '<div class="qtitle"><span>Quiz · ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + '</span><span class="num" data-role="best">' + best() + '</span></div>' +
        '<p style="margin:0 0 4px;color:var(--muted);font-size:13px">Pick an answer to see immediately whether it is right, and why. Your best score is saved; retakes never lower it.</p>' +
        questions.map(function (q, qi) {
          return '<div class="q" data-q="' + qi + '"><p class="stem">' + (qi + 1) + '. ' + esc(q.q) + '</p><div class="choices" role="group" aria-label="Question ' + (qi + 1) + '">' +
            q.choices.map(function (ch, ci) {
              return '<button type="button" class="choice" data-c="' + ci + '"><span class="k">' + String.fromCharCode(65 + ci) + '</span><span>' + esc(ch) + '</span></button>';
            }).join('') + '</div><div class="explain" hidden></div></div>';
        }).join('') + '<div class="result" data-role="result" hidden></div>';

      box.querySelectorAll('.q').forEach(function (qEl) {
        var qi = +qEl.dataset.q, q = questions[qi];
        qEl.querySelectorAll('.choice').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (answers[qi] != null) return;
            var ci = +btn.dataset.c, ok = ci === +q.answer;
            answers[qi] = ci;
            qEl.querySelectorAll('.choice').forEach(function (x) {
              var xi = +x.dataset.c; x.disabled = true;
              if (xi === +q.answer) x.classList.add('correct');
              else if (xi === ci) x.classList.add('wrong');
              else x.classList.add('dim');
            });
            var ex = qEl.querySelector('.explain'); ex.hidden = false;
            ex.className = 'explain ' + (ok ? 'ok' : 'bad');
            ex.innerHTML = '<b>' + (ok ? 'Correct.' : 'Not quite — the answer is ' + String.fromCharCode(65 + (+q.answer)) + '.') + '</b> ' + C.renderMd(q.explain || '').replace(/^<p>|<\/p>$/g, '');
            enhanceTerms(ex, lesson.id);
            if (answers.every(function (a) { return a != null; })) finish();
          });
        });
      });
    }

    function finish() {
      var g = C.gradeQuiz(questions, answers);
      C.recordQuiz(lesson.id, g.pct);
      var pass = g.pct >= C.PASS_PCT;
      var res = box.querySelector('[data-role=result]'); res.hidden = false;
      res.innerHTML = '<span class="big ' + (pass ? 'pass' : 'fail') + '">' + g.pct + '%</span><span>' + g.correct + ' of ' + g.total + ' correct. ' +
        (pass ? 'That clears the ' + C.PASS_PCT + '% bar for this module’s certificate requirement.' : 'You need a ' + C.PASS_PCT + '% module average for the certificate — reread the lesson and try again whenever you like.') +
        '</span><span class="grow"></span><button type="button" data-role="retake">Retake quiz</button>' +
        (!C.isDone(lesson.id) ? '<button type="button" class="primary" data-role="finishLesson">Mark lesson complete</button>' : '');
      res.querySelector('[data-role=retake]').onclick = build;
      var fl = res.querySelector('[data-role=finishLesson]');
      if (fl) fl.onclick = function () { C.markDone(lesson.id); refreshSidebar(lesson.id); var nb = C.neighbours(lesson.id); renderDoneArea(lesson, nb, true); fl.remove(); };
      var bestEl = box.querySelector('[data-role=best]'); if (bestEl) bestEl.textContent = best();
      refreshSidebar(lesson.id);
      res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    build();
    return box;
  }

  /* ------------------------------------------------------------------ */
  /* Certificate page                                                     */
  /* ------------------------------------------------------------------ */
  function verifyHref(id) { return 'verify.html?id=' + encodeURIComponent(id); }
  function absoluteVerifyUrl(id) {
    try {
      var base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
      return base + verifyHref(id);
    } catch (e) { return verifyHref(id); }
  }
  /**
   * issueId(name) → Promise<{id, url, local, verified, reason}>.
   * Uses BT.auth.issueCertificate when js/auth.js is loaded (server id when the
   * backend is configured and the student is signed in, else its local id);
   * otherwise a local 'BT-LOCAL-XXXXXX' id from BT.course.localCertId().
   * The id already recorded for the same name is reused so re-rendering never
   * changes the number printed on a certificate.
   */
  function issueId(name) {
    var prev = C.progress.certificate;
    if (prev && prev.id && prev.name === name && !(prev.verified === false && authSession() && authConfigured())) {
      return Promise.resolve({ id: prev.id, url: prev.verifyUrl || absoluteVerifyUrl(prev.id), local: !prev.verified, verified: !!prev.verified, reused: true });
    }
    if (authOn() && typeof BT.auth.issueCertificate === 'function') {
      return Promise.resolve().then(function () { return BT.auth.issueCertificate({ name: name }); }).then(function (r) {
        if (r && r.ok && r.id) return { id: String(r.id), url: r.url || absoluteVerifyUrl(r.id), local: !!r.local, verified: !!r.verified, reason: r.reason || null };
        var id = C.localCertId(); return { id: id, url: absoluteVerifyUrl(id), local: true, verified: false, reason: (r && r.error) || 'auth-unavailable' };
      }).catch(function (e) {
        var id = C.localCertId(); return { id: id, url: absoluteVerifyUrl(id), local: true, verified: false, reason: e && e.message ? e.message : 'auth-error' };
      });
    }
    var id = C.localCertId();
    return Promise.resolve({ id: id, url: absoluteVerifyUrl(id), local: true, verified: false, reason: 'no-auth-module' });
  }

  function verifiedCard() {
    var s = authSession(), pro = isPro(), configured = authConfigured();
    var h = '<div class="card" style="margin-top:12px" data-acc><h2>Verified certificate</h2>';
    if (!authOn()) {
      h += '<p style="margin:0;color:var(--muted)">This certificate is self-issued and its id is stored only in this browser. The <a href="verify.html">Verify page</a> recognises it on this device; a server-verified version arrives with the membership backend.</p>';
    } else if (!configured) {
      h += '<p style="margin:0;color:var(--muted)">This copy of the site has no verification server configured, so certificates are self-issued (id starting <code>BT-YYYY-L…</code>) and stored in this browser. The <a href="verify.html">Verify page</a> recognises them on this device. See the <a href="pricing.html">Pro page</a> for what a verified certificate adds.</p>';
    } else if (!s) {
      h += '<p style="margin:0 0 10px;color:var(--muted)">Sign in (free) and your certificate is stored on the server with a shareable link anyone can check on the <a href="verify.html">Verify page</a>.</p><a class="btn" href="pricing.html#signin">Sign in on the Pro page</a>';
    } else {
      h += '<p style="margin:0;color:var(--muted)">Signed in as <b>' + esc(s.email || '') + '</b>' + (pro ? ' (Pro)' : '') + '. Certificates you issue are stored on the server and can be checked by anyone with the id or link.</p>';
    }
    return h + '</div>';
  }

  function showCertificate() {
    var st = C.certificateStatus(), cp = C.courseProgress();
    var savedName = (C.progress.certificate && C.progress.certificate.name) || store.get('bt.cert.name', '') || '';
    var left = C.timeRemaining ? C.timeRemaining() : { minutes: cp.minutesLeft, lessons: cp.total - cp.done };
    var html = '<div class="crumbs"><a href="#/">Course</a><span>›</span><span>Certificate</span></div>' +
      '<div class="learn-hero" style="padding-top:8px"><div><h1>Certificate of completion</h1>' +
      '<p>' + (st.eligible ? 'Congratulations — you have finished every lesson and passed every module quiz. Enter the name you want on the certificate and issue it.' :
        'Finish all ' + cp.total + ' lessons and keep each module’s quiz average at ' + st.passPct + '% or higher. The checklist shows what is left' + (left.minutes ? ' (about ' + dur(left.minutes) + ' of reading)' : '') + '. You can preview the design any time.') + '</p></div>' +
      ring(cp.pct, 'big') + '</div>' +
      '<div class="cert-layout"><section>' +
      '<div class="card"><h2>Your certificate</h2>' +
      '<div class="cert-form"><label class="sr-only" for="certName">Name on certificate</label><input id="certName" maxlength="60" placeholder="Full name as it should appear" value="' + esc(savedName) + '" autocomplete="name">' +
      '<button class="primary" id="certRender"' + (st.eligible ? '' : ' disabled title="Complete the course to unlock"') + '>Issue certificate</button>' +
      '<button id="certPreview" title="See the design with your name and a PREVIEW watermark">Preview</button></div>' +
      '<p class="msg" id="certMsg"></p>' +
      '<div id="certOut"></div></div></section>' +
      '<aside><div class="card" data-acc="open"><h2>Requirements</h2><ul class="checklist">' + st.modules.map(function (r) {
        return '<li><span class="' + (r.ok ? 'ok' : 'no') + '">' + (r.ok ? '✓' : '○') + '</span><span>' + esc(r.title) + '<small>' + r.done + '/' + r.total + ' lessons · ' + (r.quizAvg == null ? 'no quiz yet' : 'quiz avg ' + r.quizAvg + '%') + '</small></span>' +
          '<span class="num" style="color:' + (r.ok ? 'var(--up)' : 'var(--muted)') + '">' + (r.ok ? 'passed' : esc(r.reason)) + '</span></li>';
      }).join('') + '</ul>' +
      (st.eligible ? '' : '<p style="margin:10px 0 0;font-size:12px;color:var(--muted)">Pass mark is ' + st.passPct + '% per module. Retake any quiz from its lesson page — best score counts.</p>') + '</div>' +
      verifiedCard() +
      '<div class="card" style="margin-top:12px" data-acc><h2>Progress data</h2><p style="margin:0 0 8px;font-size:12px;color:var(--muted)">Saved in this browser under <code>bt.course</code>. Export a backup before clearing site data or switching devices.</p>' +
      '<div class="srow"><button class="toolbtn" id="exportProgress">Export JSON</button><label class="toolbtn filebtn">Import <input type="file" id="importProgress" accept="application/json" style="display:none"></label><span class="grow"></span><button class="toolbtn" id="resetProgress">Reset</button></div></div>' +
      '</aside></div>';
    setApp(html);

    var nameEl = document.getElementById('certName'), out = document.getElementById('certOut'), msg = document.getElementById('certMsg');
    var renderBtn = document.getElementById('certRender'), previewBtn = document.getElementById('certPreview');
    var busy = false;

    function draw(name, issued, preview) {
      var canvas = document.createElement('canvas');
      var url = C.certificate({ name: name, canvas: canvas, theme: 'light', id: issued.id, verified: !!issued.verified, verifyUrl: preview ? '' : issued.url, record: !preview });
      if (preview) {
        var ctx = canvas.getContext('2d'); ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(-Math.PI / 8);
        ctx.globalAlpha = 0.18; ctx.fillStyle = '#dc2626'; ctx.font = '600 220px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PREVIEW', 0, 70); ctx.restore();
        try { url = canvas.toDataURL('image/png'); } catch (e) { /* keep */ }
      } else if (C.progress.certificate) {
        C.progress.certificate.verifyUrl = issued.url; C.progress.certificate.verified = !!issued.verified; C.save();
      }
      if (!url) { msg.textContent = 'Your browser blocked canvas export. Try another browser.'; return; }
      var file = 'broward-trading-certificate' + (preview ? '-preview' : '') + '.png';
      out.innerHTML = '<img class="cert-img" id="certImg" alt="Certificate of completion for ' + esc(name) + (preview ? ' (preview)' : '') + '" src="' + url + '">' +
        (preview ? '' :
          '<div class="certid"><div><div class="k">Certificate id</div><div class="v num">' + esc(issued.id) + '</div></div>' +
          '<div><div class="k">Status</div><div class="v">' + (issued.verified ? '<span style="color:var(--up)">Verified · stored on the server</span>' : 'Self-issued · stored in this browser') + '</div></div>' +
          '<div class="certlinks"><a class="btn" href="' + esc(verifyHref(issued.id)) + '" target="_blank" rel="noopener">Verify this certificate ↗</a><button type="button" id="copyVerify">Copy link</button></div></div>') +
        '<div class="srow" style="margin-top:10px"><a href="' + url + '" download="' + file + '"><button class="primary">Download PNG</button></a><button id="certPrint">Print</button>' +
        '<span style="font-size:12px;color:var(--muted)">If the download is blocked in this viewer, right-click / long-press the image and choose “Save image”.</span></div>';
      document.getElementById('certPrint').onclick = function () { window.print(); };
      var cp = document.getElementById('copyVerify');
      if (cp) cp.onclick = function () {
        var link = issued.url || absoluteVerifyUrl(issued.id);
        var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy link'; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link', link); });
        else window.prompt('Copy this link', link);
      };
    }

    function render(preview) {
      if (busy) return;
      var name = nameEl.value.trim();
      if (!name) { msg.textContent = 'Please enter the name that should appear on the certificate.'; nameEl.focus(); return; }
      if (!preview && !C.certificateEligible()) { msg.textContent = 'The course is not complete yet.'; return; }
      store.set('bt.cert.name', name); msg.textContent = '';
      if (preview) { draw(name, { id: 'BT-PREVIEW-000000', verified: false, url: '' }, true); return; }
      busy = true; renderBtn.disabled = true; renderBtn.textContent = 'Issuing…';
      issueId(name).then(function (issued) {
        busy = false; renderBtn.disabled = false; renderBtn.textContent = 'Issue certificate';
        draw(name, issued, false);
        if (issued.reason === 'not-signed-in') msg.textContent = 'Issued locally. Sign in on the Pro page and issue again for a server-verified id.';
        else if (issued.reason && issued.reason !== 'not-configured' && issued.reason !== 'no-auth-module' && !issued.reused) msg.textContent = 'The server could not be reached, so the certificate was issued locally (' + issued.reason + ').';
      });
    }
    renderBtn.onclick = function () { render(false); };
    previewBtn.onclick = function () { render(true); };
    nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') render(!C.certificateEligible()); });
    if (st.eligible && C.progress.certificate && savedName) render(false);

    document.getElementById('exportProgress').onclick = function () {
      var blob = new Blob([JSON.stringify(C.progress, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'broward-trading-progress.json'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    document.getElementById('importProgress').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(rd.result);
          if (!j || typeof j !== 'object' || !j.lessonsDone) throw new Error('not a progress file');
          Object.keys(j.lessonsDone).forEach(function (id) { if (j.lessonsDone[id]) C.markDone(id); });
          Object.keys(j.quizScores || {}).forEach(function (id) { C.recordQuiz(id, j.quizScores[id]); });
          showCertificate(); document.getElementById('certMsg').textContent = 'Progress imported (merged with what was already here).';
        } catch (err) { msg.textContent = 'Could not import: ' + err.message; }
      };
      rd.readAsText(f);
    };
    var resetBtn = document.getElementById('resetProgress');
    resetBtn.onclick = function () {
      if (resetBtn.dataset.arm) { C.resetProgress(); delete resetBtn.dataset.arm; showCertificate(); }
      else { resetBtn.textContent = 'Confirm reset'; resetBtn.dataset.arm = '1'; setTimeout(function () { resetBtn.textContent = 'Reset'; delete resetBtn.dataset.arm; }, 4000); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                 */
  /* ------------------------------------------------------------------ */
  window.addEventListener('hashchange', route);
  // Pro status can change while the page is open (sign-in in another tab).
  window.addEventListener('storage', function (e) { if (e && e.key === 'bt.auth' && booted) { keepScroll = true; try { route(); } finally { keepScroll = false; } } });
  C.loadIndex().then(function () {
    route(); booted = true;
    // Pull every module in the background so sidebars and cards show the real
    // lesson titles / minutes instead of the index placeholders.
    C.loadAll().then(function () {
      var r = parseHash();
      if (r.view === 'lesson' && r.id) refreshSidebar(r.id);
      else if (r.view === 'home') { keepScroll = true; try { showHome(); } finally { keepScroll = false; } }
    }).catch(function () { /* individual module errors surface when opened */ });
  }, function (e) {
    showError('Could not load the course', e && e.message ? e.message : String(e));
  });

  BT.learnPage = { route: route, lessonLocked: lessonLocked, issueId: issueId, version: '0.3.0' };
})();
