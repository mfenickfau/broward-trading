/* Broward Trading — js/learn.js (UI for learn.html, v0.4)
 *
 * Hash-routed single page:
 *   #/                      course home: progress ring, 'Up next' recommendation
 *                           (BT.course.recommend), 'Your first week' card (BT.onboarding),
 *                           'Join a class' card (BT.classroom), module cards,
 *                           certificate checklist, Pro card
 *   #/module/<moduleId>     jumps into the first unfinished lesson of that module
 *   #/lesson/<lessonId>     lesson reader: sidebar (a dropdown on phones), block
 *                           renderers, glossary tooltips, drills, quizzes, Pro lock
 *   #/certificate           eligibility checklist + certificate canvas with a
 *                           verifiable id (BT.auth when present, local otherwise)
 *
 * Depends on: js/course.js (BT.course), js/data.js (BT.data), js/indicators.js (BT.ind)
 * and the lightweight-charts v4 UMD global for the 'chart' block. Optional:
 * js/nav.js (BT.nav: theme event, phone accordions, toasts), js/config.js + js/auth.js
 * (BT.auth: Pro gating, certificate ids), js/replay.js (BT.replay.loadDrills),
 * js/i18n.js (BT.i18n / BT.t: language, re-render on 'bt:lang'), js/onboarding.js
 * (BT.onboarding: first-week progress) and js/classroom.js (BT.classroom: class codes,
 * share codes) — every use of them is guarded, the page works when they are absent.
 * Everything rendered from course JSON goes through BT.course.renderMd / escapeHtml.
 *
 * v0.4: language-aware course files with an 'English only' badge, re-render on language
 * change, 'Your first week' and 'Join a class' cards, 'Up next' recommendation,
 * 'Print / Save as PDF' (this lesson or the whole module) in the lesson reader.
 */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var C = BT.course;
  var app = document.getElementById('app');
  if (!C || !app) return;

  var esc = C.escapeHtml;
  /** BT.t when js/i18n.js is present, plain {var} interpolation otherwise. */
  function T(s, v) {
    if (BT.t) { try { return BT.t(s, v); } catch (e) { /* fall through */ } }
    return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s;
  }
  function curLang() { try { return C.lang ? C.lang() : 'en'; } catch (e) { return 'en'; } }
  function enOnlyPill(title) { return '<span class="pill enonly" title="' + esc(title || T('This content has not been translated yet and is shown in English.')) + '">' + esc(T('English only')) + '</span>'; }
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
    'glossary.html': 'Open the glossary', 'pricing.html': 'See Pro', 'verify.html': 'Verify a certificate', 'about.html': 'Read more', 'learn.html': 'Open',
    'start.html': 'Open your first week', 'instructor.html': 'Open the instructor page', 'certificate.html': 'Open the printable certificate'
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
  /**
   * 'Up next' card, driven by BT.course.recommend(): the one thing most worth doing
   * now (start / resume / next lesson / take a missing quiz / retake a low quiz /
   * issue the certificate), with a one-line reason.
   */
  var REC_TAG = { start: 'Start here', resume: 'Continue where you left off', next: 'Up next', quiz: 'Up next: take the quiz', retake: 'Up next: retake a quiz', certificate: 'Up next', done: 'Course complete', none: 'Up next' };
  var REC_LABEL = { start: 'Start the course', resume: 'Resume', next: 'Continue', quiz: 'Take the quiz', retake: 'Retake the quiz', certificate: 'Go to certificate', done: 'View certificate', none: 'Open' };
  function upNextCard(rec, cp) {
    rec = rec || { kind: 'none' };
    var kind = REC_TAG[rec.kind] ? rec.kind : 'none';
    var left = C.timeRemaining ? C.timeRemaining() : { minutes: cp.minutesLeft || 0, lessons: cp.total - cp.done };
    var leftText = left.lessons ? T('{time} left in the course ({n} lessons)', { time: dur(left.minutes), n: left.lessons }) : T('Every lesson is done');
    if (!rec.lessonId) {
      var done = kind === 'done';
      return '<a class="card continue' + (done ? ' done' : '') + '" href="#/certificate" id="upNextCard">' +
        '<div class="cbody"><div class="ctag">' + esc(T(REC_TAG[kind])) + '</div>' +
        '<h2>' + esc(T(rec.title || 'Certificate')) + '</h2><p>' + esc(T(rec.reason || '')) + '</p>' +
        '<div class="cmeta"><span>' + esc(leftText) + '</span></div>' +
        '<span class="go primary">' + esc(T(REC_LABEL[kind])) + ' →</span></div>' +
        ring(cp.pct, 'big') + '</a>';
    }
    var m = C.moduleOfLesson(rec.lessonId), mp = m ? C.moduleProgress(m.id) : null, n = m ? moduleNumber(m.id) : 0;
    var lm = lessonMeta(rec.lessonId), locked = lessonLocked(lm);
    var lessonNo = 0; if (m) m.lessons.forEach(function (l, i) { if (l.id === rec.lessonId) lessonNo = i + 1; });
    var where = m ? T('Module {n}: {title} · lesson {i} of {total}', { n: n, title: m.title, i: lessonNo, total: m.lessons.length }) + (lm && lm.minutes ? ' · ~' + lm.minutes + ' min' : '') : '';
    var reason = rec.kind === 'retake' && rec.score != null
      ? T('This quiz scored {score}%; the module needs an {pass}% average for the certificate. Your best score counts.', { score: rec.score, pass: C.PASS_PCT })
      : T(rec.reason || '');
    return '<a class="card continue' + (kind === 'retake' ? ' retake' : '') + '" href="#/lesson/' + encodeURIComponent(rec.lessonId) + '" id="upNextCard">' +
      '<div class="cbody"><div class="ctag">' + esc(T(REC_TAG[kind])) + '</div>' +
      '<h2>' + esc(rec.title) + (locked ? ' ' + proPill() : '') + (m && m.englishOnly && curLang() !== 'en' ? ' ' + enOnlyPill() : '') + '</h2>' +
      '<p>' + esc(where) + '</p>' +
      (reason ? '<p class="why">' + esc(reason) + '</p>' : '') +
      '<div class="cmeta"><span>' + (mp ? '<b class="num">' + esc(dur(mp.minutesLeft)) + '</b> ' + esc(T('left in this module')) : '') + '</span>' +
      '<span>' + esc(leftText) + '</span></div>' +
      '<span class="go primary">' + esc(T(REC_LABEL[kind])) + ' →</span></div>' +
      (mp ? ring(mp.pct, 'big', mp.done + '/' + mp.total) : '') + '</a>';
  }

  /* ---- 'Your first week' card (BT.onboarding is optional; the card always links to start.html) ---- */
  function firstWeekCard() {
    var O = BT.onboarding;
    return '<section class="card fw-card" id="firstWeekCard" aria-labelledby="fwTitle">' +
      '<h2 id="fwTitle">' + esc(T('Your first week')) + '</h2>' +
      '<div class="fw-body" data-role="body">' +
      '<p class="lede">' + esc(T('New to all of this? Seven short days, about twenty minutes each: take the tour, read one lesson, build a watchlist, place and protect a paper trade, run a replay drill and write your first review.')) + '</p>' +
      (O ? '<p class="fw-status" data-role="status"><span class="skeleton-line"></span></p>' : '') +
      '</div>' +
      '<a class="go" href="start.html" data-role="go">' + esc(T('Open your first week')) + ' →</a></section>';
  }
  function fillFirstWeek() {
    var O = BT.onboarding, card = document.getElementById('firstWeekCard'); if (!O || !card) return;
    var status = card.querySelector('[data-role=status]'), go = card.querySelector('[data-role=go]'), body = card.querySelector('[data-role=body]');
    var render = function (s) {
      if (!card.isConnected) return;
      if (!s || !s.total) { if (status) status.remove(); return; }
      var pct = Math.max(0, Math.min(100, Math.round(s.pct || 0)));
      card.classList.toggle('started', !!s.started);
      card.classList.toggle('complete', !!s.complete);
      var line = s.complete ? T('Week complete — {done} of {total} tasks done.', { done: s.done, total: s.total })
        : s.started ? T('Day {day} of 7 · {done} of {total} tasks done · about {time} left', { day: s.currentDay, done: s.done, total: s.total, time: dur(s.minutesLeft || 0) })
          : T('Not started yet · {n} tasks · about {time} in all', { n: s.total, time: dur(s.minutesLeft || 0) });
      body.innerHTML = '<div class="fw-live">' + ring(pct, '', s.complete ? '✓' : pct + '%') +
        '<div><p class="fw-status">' + esc(line) + '</p>' +
        '<p class="lede">' + esc(s.complete ? T('Nice work. The full course picks up where the week left off.') : s.started ? T('Tasks tick themselves as you use the site; manual ones have a checkbox.') : T('Seven short days, about twenty minutes each, for complete beginners.')) + '</p></div></div>';
      if (go) go.textContent = (s.complete ? T('Review your first week') : s.started ? T('Continue day {day}', { day: s.currentDay }) : T('Start your first week')) + ' →';
    };
    var plan = typeof O.plan === 'function' ? O.plan() : null;
    if (plan) { try { render(O.summary()); } catch (e) { if (status) status.remove(); } return; }
    if (typeof O.load !== 'function') { if (status) status.remove(); return; }
    O.load().then(function () { render(O.summary()); }, function () { if (status) status.remove(); });
  }

  /* ---- 'Join a class' card (BT.classroom is optional; without it the card explains how classes work) ---- */
  function classCard() {
    var K = BT.classroom;
    var h = '<section class="card class-card" id="classCard" aria-labelledby="classTitle"><h2 id="classTitle">' + esc(T('Join a class')) + '</h2>';
    if (!K) {
      return h + '<p class="lede">' + esc(T('Instructors can hand out a 6-character class code so your progress shows on their roster. The classroom module is not loaded on this page; ask your instructor for the link they use.')) + '</p>' +
        '<a class="go ghost" href="instructor.html">' + esc(T('Are you an instructor?')) + ' →</a></section>';
    }
    var st = K.status();
    if (!st.joined) {
      return h + '<p class="lede">' + esc(T('Have a class code from your instructor? Join and your lesson, quiz, drill and paper-trading progress can be shared with them — no email, no real name unless you type one.')) + '</p>' +
        '<form class="class-join" data-role="join" novalidate>' +
        '<label class="sr-only" for="classCode">' + esc(T('Class code')) + '</label>' +
        '<input id="classCode" class="num" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="K7Q2MX" aria-describedby="classHelp">' +
        '<label class="sr-only" for="className">' + esc(T('Display name (optional)')) + '</label>' +
        '<input id="className" maxlength="40" autocomplete="nickname" placeholder="' + esc(T('Display name (optional)')) + '">' +
        '<button type="submit" class="primary">' + esc(T('Join')) + '</button></form>' +
        '<p class="msg" data-role="msg" role="status"></p>' +
        '<p class="fine" id="classHelp">' + esc(T('Codes never contain 0, O, 1 or I. Your instructor only sees a pseudonymous id and the display name you choose.')) + '</p>' +
        '<a class="go ghost" href="instructor.html">' + esc(T('Are you an instructor?')) + ' →</a></section>';
    }
    var sent = st.lastSentAt ? T('Last shared {when}', { when: fmtDateTime(st.lastSentAt) }) : (st.backend ? T('Not shared yet') : '');
    if (st.backend && st.backoffUntil) sent = T('Not synced yet · retrying after {when}', { when: fmtDateTime(st.backoffUntil) });
    var notice = '';
    if (st.backend && st.ownerMismatch) {
      notice = '<p class="msg err" role="alert">' + esc(T('Your student id is already in use on another device in this class, so nothing is being sent from here. Rejoin to get a fresh id (your progress on this device stays), or keep syncing from the device that joined first.')) + '</p>';
    }
    return h + '<p class="class-status"><span>' + esc(T('Class')) + ' <b class="num">' + esc(st.code) + '</b>' + (st.className ? ' · <span class="no-i18n" translate="no">' + esc(st.className) + '</span>' : '') + '</span>' +
      (st.displayName ? '<span>' + esc(T('as')) + ' <b class="no-i18n" translate="no">' + esc(st.displayName) + '</b></span>' : '<span class="muted">' + esc(T('no display name')) + '</span>') +
      (sent ? '<span class="muted">' + esc(sent) + '</span>' : '') + '</p>' +
      '<p class="lede">' + esc(st.backend
        ? T('Your progress is sent to the classroom server automatically after each finished lesson or quiz (and at most every five minutes otherwise).')
        : T('This site has no classroom server, so you hand your progress to the instructor yourself: copy a share code and paste it to them (chat, email, LMS — anything).')) + '</p>' +
      notice +
      '<div class="cactions">' +
      (st.backend && st.ownerMismatch ? '<button type="button" class="primary" data-role="rejoin">' + esc(T('Rejoin with a fresh id')) + '</button>' : '') +
      (st.backend && !st.ownerMismatch ? '<button type="button" class="primary" data-role="sync">' + esc(T('Send progress now')) + '</button>' : '') +
      '<button type="button" class="' + (st.backend ? '' : 'primary') + '" data-role="share">' + esc(T('Copy share code')) + '</button>' +
      '<button type="button" class="ghost" data-role="rename">' + esc(st.displayName ? T('Change name') : T('Add a display name')) + '</button>' +
      '<button type="button" class="ghost" data-role="leave">' + esc(T('Leave class')) + '</button></div>' +
      '<p class="msg" data-role="msg" role="status"></p>' +
      '<textarea class="share-out num" data-role="shareout" readonly rows="3" hidden aria-label="' + esc(T('Share code')) + '"></textarea>' +
      '</section>';
  }
  function fmtDateTime(iso) { try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function toast(msg, kind) { if (BT.nav && typeof BT.nav.toast === 'function') { try { BT.nav.toast(msg, kind); return; } catch (e) { /* fall through */ } } }
  function copyText(text, out, btn, label) {
    var done = function () { if (btn) { var old = label || btn.textContent; btn.textContent = T('Copied'); setTimeout(function () { btn.textContent = old; }, 1600); } };
    var show = function () { if (out) { out.hidden = false; out.value = text; out.focus(); try { out.select(); } catch (e) { /* ignore */ } } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(); show(); }, show);
    else show();
  }
  function bindClassCard() {
    var K = BT.classroom, card = document.getElementById('classCard'); if (!K || !card) return;
    var msg = card.querySelector('[data-role=msg]');
    var say = function (text, bad) { if (msg) { msg.textContent = text || ''; msg.className = 'msg' + (bad ? ' err' : text ? ' ok' : ''); } };
    var rerender = function () { var fresh = document.createElement('div'); fresh.innerHTML = classCard(); card.replaceWith(fresh.firstElementChild); bindClassCard(); };
    var form = card.querySelector('[data-role=join]');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = form.querySelector('#classCode').value, name = form.querySelector('#className').value;
        var r = K.join(code, name);
        if (!r.ok) { say(T(r.error || 'That code is not valid.'), true); form.querySelector('#classCode').focus(); return; }
        rerender();
        var c2 = document.getElementById('classCard'), m2 = c2 && c2.querySelector('[data-role=msg]');
        if (K.status().backend && typeof K.sync === 'function') {
          K.sync({ reason: 'join' }).then(function (s) {
            if (!m2) return;
            m2.textContent = s && s.sent ? T('Joined class {code}. Your progress was sent.', { code: r.code }) : T('Joined class {code}. {error}', { code: r.code, error: (s && s.error) || T('Progress will be sent when the server is reachable.') });
            m2.className = 'msg ' + (s && s.sent ? 'ok' : 'err');
          });
        } else if (m2) { m2.textContent = T('Joined class {code}. Copy a share code and send it to your instructor.', { code: r.code }); m2.className = 'msg ok'; }
      });
      var codeEl = form.querySelector('#classCode');
      codeEl.addEventListener('input', function () { var v = K.normalizeCode(codeEl.value); if (v !== codeEl.value) codeEl.value = v; });
      return;
    }
    var share = card.querySelector('[data-role=share]'), out = card.querySelector('[data-role=shareout]');
    if (share) share.onclick = function () {
      share.disabled = true;
      K.encodeShare().then(function (code) {
        share.disabled = false;
        copyText(code, out, share, T('Copy share code'));
        say(T('Share code ready ({n} characters). Paste it to your instructor; it holds only your pseudonymous id and progress.', { n: code.length }));
      }, function () { share.disabled = false; say(T('Could not build the share code.'), true); });
    };
    var sync = card.querySelector('[data-role=sync]');
    if (sync) sync.onclick = function () {
      sync.disabled = true; say(T('Sending…'));
      K.sync({ reason: 'manual' }).then(function (s) {
        sync.disabled = false;
        if (s && s.removed) { say(T(s.error || 'You were removed from this class.'), true); setTimeout(rerender, 1200); return; }
        if (s && s.ownerMismatch) { rerender(); return; }   // the card now shows the explanation and a 'Rejoin with a fresh id' button
        if (s && s.rateLimited) { say(T(s.error || 'The classroom server asked this device to wait a moment. Your progress is saved here and will be sent shortly.'), true); setTimeout(rerender, 1200); return; }
        say(s && s.sent ? T('Progress sent.') : T(s && s.error ? s.error : 'Nothing was sent.'), !(s && s.sent));
      });
    };
    var rejoin = card.querySelector('[data-role=rejoin]');
    if (rejoin) rejoin.onclick = function () {
      var st = K.status();
      var r = K.join(st.code, st.displayName, { freshId: true });
      if (!r.ok) { say(T(r.error || 'That code is not valid.'), true); return; }
      rerender();
      var c2 = document.getElementById('classCard'), m2 = c2 && c2.querySelector('[data-role=msg]');
      K.sync({ reason: 'join' }).then(function (s) {
        if (!m2) return;
        m2.textContent = s && s.sent ? T('New id {id} is now on the roster. Tell your instructor which row is yours.', { id: r.studentId }) : T((s && s.error) || 'Progress will be sent when the server is reachable.');
        m2.className = 'msg ' + (s && s.sent ? 'ok' : 'err');
      });
    };
    var rename = card.querySelector('[data-role=rename]');
    if (rename) rename.onclick = function () {
      var cur = K.status().displayName || '';
      var name = window.prompt(T('Display name your instructor will see (leave empty for none):'), cur);
      if (name == null) return;
      K.setDisplayName(name); rerender(); toast(T('Display name saved.'));
    };
    var leave = card.querySelector('[data-role=leave]');
    if (leave) leave.onclick = function () {
      if (leave.dataset.arm) { K.leave(); rerender(); toast(T('You left the class. Your progress stays on this device.')); return; }
      leave.textContent = T('Confirm leave'); leave.dataset.arm = '1';
      setTimeout(function () { if (leave.isConnected) { leave.textContent = T('Leave class'); delete leave.dataset.arm; } }, 4000);
    };
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
    var rec = typeof C.recommend === 'function' ? C.recommend() : null;
    var modCount = idx.modules.length, lessonCount = cp.total;
    var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    var foreign = curLang() !== 'en';
    var html = '<section class="learn-hero">' +
      '<div><h1>' + esc(idx.title) + (foreign && idx.englishOnly ? ' ' + enOnlyPill(T('The course has not been translated into this language yet, so it is shown in English.')) : '') + '</h1><p>' + esc(idx.summary) + '</p>' +
      '<p style="margin-top:8px">' + esc(T('{modules} modules, {lessons} lessons, a quiz in every lesson, about {time} in all. Finish them with an {pass}% quiz average and you can issue your completion certificate.', { modules: WORDS[modCount] ? T(WORDS[modCount].charAt(0).toUpperCase() + WORDS[modCount].slice(1)) : modCount, lessons: lessonCount, time: dur(cp.minutes), pass: C.PASS_PCT })) +
      ' ' + T('Everything you learn can be practised immediately on the <a href="index.html">dashboard</a> and in <a href="replay.html">Market Replay</a> with a paper account.') + '</p>' +
      '<div class="actions">' +
      (ct ? '<a href="#/lesson/' + encodeURIComponent(ct.lessonId) + '"><button class="primary">' + esc(T(ct.label)) + '</button></a>' :
        '<a href="#/certificate"><button class="primary">' + esc(T('All lessons done — get your certificate')) + '</button></a>') +
      '<a href="#/certificate"><button>' + esc(T('Certificate')) + (cert.eligible ? ' ✓' : '') + '</button></a>' +
      '<a href="glossary.html"><button>' + esc(T('Glossary')) + '</button></a>' +
      '</div></div>' +
      '<div class="card herostat">' + ring(cp.pct, 'big') +
      '<div class="stat"><span>' + esc(T('Lessons done')) + '</span><span>' + cp.done + ' / ' + cp.total + '</span>' +
      '<span>' + esc(T('Time left')) + '</span><span>' + (cp.minutesLeft ? '~' + esc(dur(cp.minutesLeft)) : esc(T('none'))) + '</span>' +
      '<span>' + esc(T('Quiz average')) + '</span><span>' + (cp.quizAvg == null ? '—' : cp.quizAvg + '%') + '</span>' +
      '<span>' + esc(T('Quizzes taken')) + '</span><span>' + cp.quizzes + '</span>' +
      '<span>' + esc(T('Started')) + '</span><span>' + (cp.startedAt ? esc(fmtDate(cp.startedAt)) : '—') + '</span></div></div>' +
      '</section>';

    html += upNextCard(rec, cp);

    // beginners' path and classroom, side by side on desktop, stacked on phones
    html += '<div class="homegrid side">' + firstWeekCard() + classCard() + '</div>';

    html += '<h2 class="sr-only">' + esc(T('Modules')) + '</h2><div class="modgrid">' + idx.modules.map(function (m, i) {
      var mp = C.moduleProgress(m.id);
      var lockedCount = gatingOn() && !isPro() ? m.lessons.filter(function (l) { return l.pro; }).length : 0;
      var state = mp.pct >= 100 ? ' · ' + T('complete') : mp.done ? ' · ' + T('in progress') : '';
      return '<a class="card modcard' + (mp.pct >= 100 ? ' complete' : '') + '" href="#/module/' + encodeURIComponent(m.id) + '">' +
        '<div><div class="idx">' + esc(T('Module {n}', { n: i + 1 }) + state) + '</div><h3>' + esc(m.title) + (foreign && m.englishOnly && !idx.englishOnly ? ' ' + enOnlyPill() : '') + '</h3><p>' + esc(m.summary) + '</p>' +
        '<div class="meta">' + levelPill(m.level) + '<span>' + esc(minutes(m.minutes)) + '</span><span>· ' + esc(T('{n} lessons', { n: m.lessons.length })) + '</span>' +
        (mp.done && mp.minutesLeft ? '<span>· <b class="num">' + esc(dur(mp.minutesLeft)) + '</b> ' + esc(T('left')) + '</span>' : '') +
        (mp.quizAvg != null ? '<span>· ' + esc(T('quiz avg')) + ' <b class="num">' + mp.quizAvg + '%</b></span>' : '') +
        (lockedCount ? '<span class="lockmeta">' + LOCK_SVG + ' ' + esc(T(lockedCount === 1 ? '{n} Pro lesson' : '{n} Pro lessons', { n: lockedCount })) + '</span>' : '') + '</div></div>' +
        ring(mp.pct, '', mp.done + '/' + mp.total) + '</a>';
    }).join('') + '</div>';

    html += '<div class="homegrid">' +
      '<div class="card" data-acc><h2>' + esc(T('How the course works')) + '</h2>' +
      '<p style="margin:0 0 8px;color:var(--muted)">' + esc(T('Each lesson mixes short reading, a live chart you can inspect, a hands-on exercise on the dashboard or in Market Replay, and a quiz with instant explanations. Your progress is saved in this browser only — no account needed.')) + '</p>' +
      '<ul style="margin:0;padding-left:18px;color:var(--muted)"><li>' + esc(T('Read in order; later modules assume the earlier ones.')) + '</li><li>' + esc(T('Quizzes can be retaken — your best score counts.')) + '</li><li>' + T('Tap any <span class="gl-term on demo">underlined term</span> for a plain-English definition.') + '</li><li>' + esc(T('Do the exercises on your paper account. Mistakes are free here.')) + '</li><li>' + esc(T('Every lesson has a Print / Save as PDF button for offline reading or a classroom hand-out.')) + '</li></ul></div>' +

      '<div class="card" data-acc><h2>' + esc(T('Certificate of completion')) + '</h2>' +
      '<p style="margin:0 0 8px;color:var(--muted)">' + esc(cert.eligible ? T('You have met every requirement. Add your name and issue your certificate.') :
        T('Complete all {n} lessons and keep each module’s quiz average at {pass}% or better.', { n: cp.total, pass: C.PASS_PCT })) + '</p>' +
      '<ul class="checklist" style="margin-bottom:10px">' + cert.modules.map(function (r) {
        return '<li><span class="' + (r.ok ? 'ok' : 'no') + '">' + (r.ok ? '✓' : '○') + '</span><span>' + esc(r.title) + '</span><span class="num" style="color:var(--muted)">' + (r.ok ? esc(T('passed')) : esc(T(r.reason))) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="srow"><a href="#/certificate"><button class="' + (cert.eligible ? 'primary' : '') + '">' + esc(cert.eligible ? T('Get your certificate') : T('View requirements')) + '</button></a>' +
      (C.certificateRecord && C.certificateRecord() ? '<a href="certificate.html"><button>' + esc(T('Printable certificate')) + '</button></a>' : '') + '</div></div>' +
      proCard() +
      '</div>';

    setApp(html);
    fillFirstWeek();
    bindClassCard();
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
      (curMod ? '<div class="pickmeta"><span>' + esc(T('Module {n} · lesson {i} of {total}', { n: curNo, i: lessonNo, total: curMod.lessons.length })) + '</span><span class="num">' + esc(curMp && curMp.minutesLeft ? '~' + dur(curMp.minutesLeft) + ' ' + T('left in module') : T('module complete')) + '</span></div>' : '') +
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
    var enOnly = mod.englishOnly && curLang() !== 'en';
    return '<div class="crumbs"><a href="#/">' + esc(T('Course')) + '</a><span>›</span><a href="#/module/' + encodeURIComponent(mod.id) + '">' + esc(T('Module {n}', { n: modIndex + 1 })) + ': ' + esc(mod.title) + '</a><span>›</span><span>' + esc(T('Lesson {i} of {total}', { i: lessonIndex + 1, total: mod.lessons.length })) + '</span></div>' +
      '<h1>' + esc(lesson.title) + '</h1>' +
      '<div class="lmeta">' + levelPill(mod.level) + (lesson.pro && gatingOn() ? proPill() : '') + (enOnly ? enOnlyPill() : '') + '<span>' + esc(minutes(lesson.minutes)) + '</span>' +
      (hasQuiz ? '<span>· ' + esc(T('quiz')) + (C.quizScore(lesson.id) != null ? ' ' + esc(T('best {pct}%', { pct: C.quizScore(lesson.id) })) : '') + '</span>' : '') +
      (C.isDone(lesson.id) ? '<span style="color:var(--up)">· ' + esc(T('completed')) + '</span>' : (mp.minutesLeft ? '<span>· ~' + esc(dur(mp.minutesLeft)) + ' ' + esc(T('left in module')) + '</span>' : '')) +
      (extra || '') + '</div>' + printBarHtml();
  }

  /* ------------------------------------------------------------------ */
  /* Print / Save as PDF (hidden when printing is unavailable or framed)   */
  /* ------------------------------------------------------------------ */
  function canPrint() {
    if (typeof window.print !== 'function') return false;
    try { if (window.top !== window.self) return false; } catch (e) { return false; }   // cross-origin frame
    return true;
  }
  function printBarHtml() {
    if (!canPrint()) return '';
    return '<div class="printbar" role="group" aria-label="' + esc(T('Print')) + '">' +
      '<button type="button" class="toolbtn" id="printLesson" title="' + esc(T('Opens your browser’s print dialog; choose “Save as PDF” as the destination to keep a copy.')) + '">' + esc(T('Print / Save as PDF')) + '</button>' +
      '<button type="button" class="toolbtn ghost" id="printModuleBtn" title="' + esc(T('Every lesson of this module, one per page, quizzes as a worksheet.')) + '">' + esc(T('Print whole module')) + '</button></div>';
  }
  function bindPrintBar(mod) {
    var a = document.getElementById('printLesson'), b = document.getElementById('printModuleBtn');
    if (a) a.onclick = function () { try { window.print(); } catch (e) { /* ignore */ } };
    if (b) b.onclick = function () { printModule(mod); };
  }
  /** Static (print-only) markup of one block: no charts, quizzes as a worksheet without answers. */
  function printBlockHtml(b, i) {
    switch (b.type) {
      case 'text': return '<div class="block-text">' + C.renderMd(b.md) + '</div>';
      case 'callout': { var tone = TONE[b.tone] ? b.tone : 'key'; return '<div class="callout ' + tone + '" role="note"><div class="ctitle">' + esc(b.title || T(TONE[tone])) + '</div>' + C.renderMd(b.md) + '</div>'; }
      case 'chart': return '<figure class="chartblock card"><div class="chead"><b>' + esc(String(b.symbol || 'AAPL').toUpperCase()) + '</b><span>' + esc(String(b.interval || '1day')) + '</span>' + (Array.isArray(b.overlays) && b.overlays.length ? '<span>· ' + esc(b.overlays.map(String).join(', ')) + '</span>' : '') + '</div>' + (b.caption ? '<figcaption class="caption">' + C.renderMd(b.caption) + '</figcaption>' : '') + '</figure>';
      case 'exercise': { var href = actionHref(b.action); return '<section class="exercise"' + (href ? ' data-print-href="' + esc(absoluteUrl(href)) + '"' : '') + '><div class="etitle">' + esc(T('Hands-on exercise')) + '</div>' + C.renderMd(b.md) + '</section>'; }
      case 'drill': return '<section class="drill card"><div class="dtitle">' + esc(T('Practice drill')) + '</div>' + (b.md ? C.renderMd(b.md) : '') + '<p class="dnote">' + esc(T('Drill id: {id}. Open Market Replay on the site to run it.', { id: String(b.drillId || b.id || '') })) + '</p></section>';
      case 'image': { var src = String(b.src || ''); return /^(course|img|assets|icons)\/[\w./-]+$/.test(src) ? '<figure class="chartblock card"><img src="' + esc(src) + '" alt="' + esc(b.alt || '') + '" style="display:block;max-width:100%">' + (b.caption ? '<figcaption class="caption">' + C.renderMd(b.caption) + '</figcaption>' : '') + '</figure>' : ''; }
      case 'quiz': {
        var qs = (Array.isArray(b.questions) ? b.questions : []).filter(function (q) { return q && Array.isArray(q.choices) && q.choices.length > 1; });
        if (!qs.length) return '';
        return '<section class="quiz"><div class="qtitle"><span>' + esc(T('Quiz · {n} questions', { n: qs.length })) + '</span></div>' + qs.map(function (q, qi) {
          return '<div class="q"><p class="stem">' + (qi + 1) + '. ' + esc(q.q) + '</p><div class="choices">' + q.choices.map(function (ch, ci) {
            return '<div class="choice"><span class="k">' + String.fromCharCode(65 + ci) + '</span><span>' + esc(ch) + '</span></div>';
          }).join('') + '</div></div>';
        }).join('') + '</section>';
      }
      default: return '';
    }
  }
  function absoluteUrl(rel) { try { return new URL(rel, location.href.split('#')[0]).href; } catch (e) { return rel; } }
  var printCleanupTimer = null;
  function cleanupPrint() {
    var pm = document.getElementById('printModule'); if (pm) pm.remove();
    document.body.classList.remove('printing-module');
    if (printCleanupTimer) { clearTimeout(printCleanupTimer); printCleanupTimer = null; }
  }
  /** Render every lesson of the module into a print-only container (one lesson per page) and print. */
  function printModule(mod) {
    if (!canPrint() || !mod) return;
    cleanupPrint();
    var idx = C.getIndex(), n = moduleNumber(mod.id);
    var html = '<section class="print-cover"><div class="crumbs">' + esc(idx ? idx.title : 'Broward Trading') + '</div><h1>' + esc(T('Module {n}', { n: n })) + ': ' + esc(mod.title) + '</h1>' +
      '<p class="lede">' + esc(mod.summary) + '</p>' +
      '<ol>' + mod.lessons.map(function (l) { return '<li>' + esc(l.title) + (l.minutes ? ' <span class="num">(~' + l.minutes + ' min)</span>' : '') + '</li>'; }).join('') + '</ol>' +
      '<p class="fine">' + esc(T('Printed from Broward Trading, a free educational paper-trading simulator ({url}). Charts are interactive on the site and are replaced here by their captions. Quizzes are printed without answers; take them online to record a score. Nothing here is investment advice.', { url: absoluteUrl('learn.html') })) + '</p></section>';
    mod.lessons.forEach(function (l, i) {
      html += '<article class="print-lesson"><div class="crumbs">' + esc(T('Module {n}', { n: n })) + ': ' + esc(mod.title) + ' · ' + esc(T('Lesson {i} of {total}', { i: i + 1, total: mod.lessons.length })) + '</div>' +
        '<h1>' + esc(l.title) + '</h1><div class="lmeta">' + esc(LEVEL_LABEL[mod.level] || mod.level) + (l.minutes ? ' · ~' + l.minutes + ' min' : '') + '</div>' +
        '<div class="blocks">' + l.blocks.map(printBlockHtml).join('') + '</div>' +
        '<div class="print-foot">' + esc(absoluteUrl('learn.html#/lesson/' + encodeURIComponent(l.id))) + '</div></article>';
    });
    var box = document.createElement('div'); box.id = 'printModule'; box.innerHTML = html; box.hidden = false;
    app.appendChild(box);
    document.body.classList.add('printing-module');
    window.addEventListener('afterprint', cleanupPrint, { once: true });
    // Browsers without a reliable afterprint still get cleaned up once the dialog closes.
    printCleanupTimer = setTimeout(cleanupPrint, 60000);
    try { window.print(); } catch (e) { cleanupPrint(); }
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
    reader.innerHTML = lessonHeader(mod, lesson) + '<h2 class="sr-only">' + esc(T('Lesson content')) + '</h2><div class="blocks" id="blocks"></div>' + lessonNavHtml(nb);

    var blocks = document.getElementById('blocks');
    if (!lesson.blocks.length) blocks.innerHTML = '<div class="empty">This lesson has no content yet.</div>';
    lesson.blocks.forEach(function (b, i) {
      var el = renderBlock(b, lesson, i);
      if (el) blocks.appendChild(el);
    });
    renderDoneArea(lesson, nb, hasQuiz);
    enhanceTerms(blocks, lesson.id);
    bindPrintBar(mod);
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
      '<h2 class="sr-only">' + esc(T('Lesson content')) + '</h2>' +
      (previewMd ? '<div class="block-text locked-preview" aria-label="Lesson preview">' + proseHtml(previewMd) + '</div>' : '') +
      '<section class="card locked" aria-label="Pro lesson">' + LOCK_SVG.replace('width="14" height="14"', 'width="28" height="28"') +
      '<h2>This lesson is part of Pro</h2>' +
      '<p>' + (lesson.summary ? esc(lesson.summary) + ' ' : '') + 'The rest of <b>' + esc(lesson.title) + '</b>' + (inside.length ? ' (' + inside.join(', ') + ')' : '') + ' opens with a Pro membership. The core course stays free, and your progress is kept either way.</p>' +
      '<div class="actions"><a class="btn primary" href="pricing.html">See Pro plans</a>' +
      (authConfigured() && !signedIn ? '<a class="btn" href="pricing.html#signin">Already a member? Sign in</a>' : '') +
      (nb.next ? '<a class="btn ghost" href="#/lesson/' + encodeURIComponent(nb.next.lessonId) + '">Skip to the next lesson →</a>' : '') + '</div>' +
      '</section></div>' + lessonNavHtml(nb);
    var area = document.getElementById('doneArea');
    if (area) area.innerHTML = '<span class="done-note" style="color:var(--muted)">' + esc(T('Pro lesson')) + '</span>';
    enhanceTerms(reader.querySelector('.locked-preview'), lesson.id);
    var pb = reader.querySelector('.printbar'); if (pb) pb.remove();   // nothing printable in a locked preview
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
  /**
   * Lesson prose for the on-screen reader. BT.course.renderMd emits <h3>/<h4> (fine for print
   * and tests); under the lesson's <h1> the outline must not skip a level (WCAG 1.3.1), so
   * headings move up one step: #/## → h2, ### → h3. learn.html styles both sets alike.
   */
  function proseHtml(md) {
    return C.renderMd(md).replace(/<(\/?)h3>/g, '<$1h2>').replace(/<(\/?)h4>/g, '<$1h3>');
  }

  function renderBlock(b, lesson, i) {
    switch (b.type) {
      case 'text': return el('div', 'block-text', proseHtml(b.md));
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
    var note = el('div', 'callout ' + tone, '<div class="ctitle">' + esc(b.title || TONE[tone]) + '</div>' + proseHtml(b.md));
    note.setAttribute('role', 'note');
    return note;
  }

  function actionHref(a) {
    a = a || {};
    var page = ALLOWED_PAGES.indexOf(a.page) >= 0 ? a.page : null;
    if (!page) return null;
    return page + (a.hash ? (String(a.hash)[0] === '#' ? a.hash : '#' + a.hash) : '');
  }
  function renderExercise(b) {
    var a = b.action || {}, href = actionHref(a), page = href ? href.split('#')[0] : null;
    var sec = el('section', 'exercise', '<div class="etitle">' + esc(T('Hands-on exercise')) + '</div>' + C.renderMd(b.md) +
      (href ? '<a class="go" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(a.label || T(PAGE_LABEL[page] || 'Open')) + ' ↗</a>' : ''));
    if (href) sec.setAttribute('data-print-href', absoluteUrl(href));   // css/print.css prints the destination since the button is hidden
    return sec;
  }

  /* --- drill block: {type:'drill', drillId, md?} → details from course/drills.json + 'Practice in Replay' --- */
  var drillsPromise = null, drillsLang = null;
  function fetchDrills(file) {
    return fetch(file, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return Array.isArray(j) ? j : (j && Array.isArray(j.drills) ? j.drills : []); });
  }
  function loadDrills() {
    var lang = curLang();
    if (drillsPromise && drillsLang === lang) return drillsPromise;
    drillsLang = lang;
    var p;
    if (BT.replay && typeof BT.replay.loadDrills === 'function') p = BT.replay.loadDrills();
    else if (lang !== 'en' && C.fileFor) p = fetchDrills(C.fileFor('drills.json', lang)).catch(function () { return fetchDrills('course/drills.json'); });
    else p = fetchDrills('course/drills.json');
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
    wrap.setAttribute('data-symbol', symbol);

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
    if (BT.a11y && bars.length) {
      var lastBar = bars[bars.length - 1], prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
      var chgPct = prevBar && prevBar.close ? (lastBar.close - prevBar.close) / prevBar.close * 100 : null;
      BT.a11y.describeChart(pricePane, T('{symbol} {interval} candlestick chart, {n} bars, last close {close}', { symbol: String(wrap.getAttribute('data-symbol') || '').toUpperCase() || T('Price'), interval: interval, n: bars.length, close: '$' + lastBar.close.toFixed(2) }) +
        (chgPct == null ? '' : ', ' + (chgPct >= 0 ? '+' : '−') + Math.abs(chgPct).toFixed(2) + '%') + (overlays && overlays.length ? '. ' + T('Overlays: {list}', { list: overlays.join(', ') }) : '') + '.');
    }
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
      var quizTitle = questions.length === 1 ? T('Quiz · 1 question') : T('Quiz · {n} questions', { n: questions.length });
      box.innerHTML = '<div class="qtitle"><span>' + esc(quizTitle) + '</span><span class="num" data-role="best">' + best() + '</span></div>' +
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
            ex.innerHTML = '<b>' + esc(ok ? T('Correct.') : T('Not quite — the answer is {letter}.', { letter: String.fromCharCode(65 + (+q.answer)) })) + '</b> ' + C.renderMd(q.explain || '').replace(/^<p>|<\/p>$/g, '');
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
          '<div class="certlinks"><a class="btn" href="' + esc(verifyHref(issued.id)) + '" target="_blank" rel="noopener">Verify this certificate ↗</a><button type="button" id="copyVerify">Copy link</button>' +
          '<a class="btn" href="certificate.html" target="_blank" rel="noopener">' + esc(T('Printable certificate (PDF)')) + ' ↗</a></div></div>') +
        '<div class="srow" style="margin-top:10px"><a href="' + url + '" download="' + file + '"><button class="primary">Download PNG</button></a>' + (canPrint() ? '<button id="certPrint">Print</button>' : '') +
        '<span style="font-size:12px;color:var(--muted)">If the download is blocked in this viewer, right-click / long-press the image and choose “Save image”.</span></div>';
      var cpBtn = document.getElementById('certPrint'); if (cpBtn) cpBtn.onclick = function () { window.print(); };
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
  function rerender() { keepScroll = true; try { route(); } finally { keepScroll = false; } }
  // Pro status, first-week progress and class membership can change in another tab.
  window.addEventListener('storage', function (e) {
    if (!e || !booted) return;
    if (e.key === 'bt.auth') rerender();
    else if ((e.key === 'bt.onboarding' || e.key === 'bt.classroom') && parseHash().view === 'home') rerender();
  });

  /** Background pull of every module: real titles / minutes / language flags for cards and sidebars. */
  function warmModules() {
    return C.loadAll().then(function () {
      var r = parseHash();
      if (r.view === 'lesson' && r.id) refreshSidebar(r.id);
      else if (r.view === 'home') { keepScroll = true; try { showHome(); } finally { keepScroll = false; } }
    }).catch(function () { /* individual module errors surface when opened */ });
  }

  // Language switch (js/i18n.js fires 'bt:lang'; the contract also names 'bt:langchange'):
  // course.js drops its caches, we re-fetch course/<lang>/… and redraw the current view.
  var langToken = 0;
  function onLangChange(e) {
    var code = (e && e.detail && e.detail.lang) || (BT.i18n && BT.i18n.lang ? BT.i18n.lang() : 'en');
    if (C.setLang) C.setLang(code);
    drillsPromise = null;
    if (!booted) return;
    var my = ++langToken;
    C.loadIndex().then(function () {
      if (my !== langToken) return;
      rerender();
      warmModules();
    }, function (err) { if (my === langToken) showError(T('Could not load the course'), err && err.message ? err.message : String(err)); });
  }
  window.addEventListener('bt:lang', onLangChange);
  window.addEventListener('bt:langchange', onLangChange);

  C.loadIndex().then(function () {
    route(); booted = true;
    warmModules();
  }, function (e) {
    showError('Could not load the course', e && e.message ? e.message : String(e));
  });

  BT.learnPage = { route: route, lessonLocked: lessonLocked, issueId: issueId, printModule: printModule, canPrint: canPrint, version: '0.4.0' };
})();
