/* Broward Trading — js/course.js → BT.course
 *
 * Course engine for learn.html. Pure data + canvas helpers; it never touches the
 * document except through the <canvas> it is handed (or creates) for certificates,
 * so it can be loaded standalone and unit-tested with a `window` shim.
 *
 * Responsibilities (see CONTRACTS.md → js/course.js):
 *   - load course/index.json and course/<module>.json with fetch(), cached in memory
 *   - renderMd(md): the small markdown subset → HTML, escaping FIRST (XSS-safe)
 *   - progress persisted in localStorage 'bt.course'
 *       { lessonsDone:{id:true}, quizScores:{lessonId:pct}, startedAt }
 *   - markDone(id), recordQuiz(id, pct), moduleProgress(moduleId), certificateEligible()
 *   - certificate({name}) → PNG dataURL drawn on a 1600×1130 canvas
 *
 * v0.3 additions
 *   - [[Term]] / [[Term|label]] in md → <span class="gl-term" data-term="Term">label</span>
 *     (plain text until js/learn.js resolves it against course/glossary.json)
 *   - BT.course.glossary: lazy loader + lookup for course/glossary.json
 *   - lessons keep a `pro` flag (Pro gating is decided by js/auth.js, see learn.js)
 *   - timeRemaining(moduleId?) → estimated minutes left; moduleProgress/courseProgress gain minutesLeft
 *   - certificate({name, id, verifyUrl}) prints a supplied id (BT.auth.issueCertificate) or a
 *     local 'BT-LOCAL-XXXXXX' one; localCertId() generates the latter
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;

  var STORE_KEY = 'bt.course';
  var COURSE_DIR = 'course/';
  var PASS_PCT = 80;                 // quiz average needed per module for the certificate
  var DEFAULT_LESSON_MINUTES = 10;   // used for time estimates when a lesson has no minutes
  var CERT_W = 1600, CERT_H = 1130;

  /* ------------------------------------------------------------------ */
  /* Small safe localStorage wrapper (private windows may throw)          */
  /* ------------------------------------------------------------------ */
  var store = {
    get: function (k, d) {
      try { var v = window.localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------------------------------------------ */
  /* Markdown subset → safe HTML                                          */
  /* ------------------------------------------------------------------ */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  /**
   * Inline formatting on an ALREADY-ESCAPED line. Order matters:
   *  1. `code` spans are lifted out first so * and ** inside them stay literal,
   *  2. **bold**, 3. *italic*, then code spans are put back.
   * Only the tags we emit (<code>, <strong>, <em>) can appear in the result, so
   * nothing from the source text can become markup.
   */
  var TERM_RE = /\[\[([^\[\]|\n]{1,80}?)(?:\|([^\[\]\n]{1,80}?))?\]\]/g;
  function inline(escaped) {
    var codes = [];
    var s = escaped.replace(/`([^`\n]+)`/g, function (_, c) {
      codes.push('<code>' + c + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    // [[Term]] or [[Term|shown text]] → glossary term span. The text is already
    // escaped, so both the data attribute and the label are safe. It renders as
    // plain text until learn.js finds the term in course/glossary.json.
    s = s.replace(TERM_RE, function (_, term, label) {
      term = term.trim(); label = (label || term).trim();
      if (!term) return label;
      codes.push('<span class="gl-term" data-term="' + term + '">' + label + '</span>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
    return s;
  }

  /**
   * renderMd(md) → HTML string.
   * Supported: paragraphs (blank-line separated), `#`/`##`/`###` headings
   * (all rendered as <h3>/<h4> so they sit under the lesson title), `- ` or `* `
   * bullet lists, `1. ` numbered lists, `> ` quotes, `---` rules, and the inline
   * forms above (including [[glossary terms]]). Everything is HTML-escaped before
   * any markup is added.
   */
  function renderMd(md) {
    if (md == null) return '';
    var lines = escapeHtml(String(md).replace(/\r\n?/g, '\n')).split('\n');
    var out = [], para = [], list = null, listType = null, quote = [];

    function flushPara() {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function flushList() {
      if (list) { out.push('<' + listType + '>' + list.map(function (li) { return '<li>' + inline(li) + '</li>'; }).join('') + '</' + listType + '>'); list = null; listType = null; }
    }
    function flushQuote() {
      if (quote.length) { out.push('<blockquote><p>' + inline(quote.join(' ')) + '</p></blockquote>'); quote = []; }
    }
    function flushAll() { flushPara(); flushList(); flushQuote(); }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i], line = raw.trim(), m;
      if (!line) { flushAll(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flushAll();
        var level = m[1].length <= 2 ? 'h3' : 'h4';
        out.push('<' + level + '>' + inline(m[2]) + '</' + level + '>');
        continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
      if ((m = /^[-*]\s+(.*)$/.exec(line))) {
        flushPara(); flushQuote();
        if (list && listType !== 'ul') flushList();
        list = list || []; listType = 'ul'; list.push(m[1]); continue;
      }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) {
        flushPara(); flushQuote();
        if (list && listType !== 'ol') flushList();
        list = list || []; listType = 'ol'; list.push(m[1]); continue;
      }
      if ((m = /^&gt;\s?(.*)$/.exec(line))) {        // '>' is already escaped to &gt;
        flushPara(); flushList(); quote.push(m[1]); continue;
      }
      // continuation line of a list item (indented) joins the previous item
      if (list && /^\s{2,}/.test(raw)) { list[list.length - 1] += ' ' + line; continue; }
      flushList(); flushQuote();
      para.push(line);
    }
    flushAll();
    return out.join('\n');
  }

  /** termsIn(md) → unique [[terms]] referenced by a markdown string (in order). */
  function termsIn(md) {
    var seen = {}, out = [], m;
    TERM_RE.lastIndex = 0;
    while ((m = TERM_RE.exec(String(md == null ? '' : md)))) {
      var t = m[1].trim(); if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = true; out.push(t); }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Glossary (course/glossary.json), loaded lazily on first use          */
  /* ------------------------------------------------------------------ */
  var GLOSSARY_FILE = COURSE_DIR + 'glossary.json';
  var _gloss = null;             // {terms:[], byKey:{}} once loaded
  var _glossPromise = null;
  var _glossFailed = false;

  function glossKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/&amp;/g, '&')
      .replace(/[’']/g, '').replace(/[^a-z0-9%+&/-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function indexGlossary(json) {
    var list = Array.isArray(json) ? json : (json && Array.isArray(json.terms) ? json.terms : []);
    var terms = [], byKey = {};
    function add(k, t) { k = glossKey(k); if (k && !byKey[k]) byKey[k] = t; }
    list.forEach(function (raw) {
      if (!raw || typeof raw !== 'object' || !raw.term) return;
      var t = {
        id: String(raw.id || glossKey(raw.term).replace(/\s+/g, '-')),
        term: String(raw.term), aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
        category: String(raw.category || ''), lesson: raw.lesson ? String(raw.lesson) : '',
        definition: String(raw.definition || ''), example: String(raw.example || ''),
        related: Array.isArray(raw.related) ? raw.related.map(String) : []
      };
      terms.push(t);
      add(t.id, t); add(t.term, t);
      t.aliases.forEach(function (a) { add(a, t); });
      // 'Relative Strength Index (RSI)' → also 'relative strength index' and 'rsi'
      var paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(t.term);
      if (paren) { add(paren[1], t); add(paren[2], t); }
      // 'Higher high / higher low' → both halves
      t.term.split(/\s*\/\s*/).forEach(function (part) { if (part !== t.term) add(part, t); });
    });
    return { terms: terms, byKey: byKey, categories: (json && Array.isArray(json.categories)) ? json.categories : [] };
  }
  /** glossary.load() → Promise<{terms, byKey}>; resolves to null (never rejects) when the file is unavailable. */
  function loadGlossary(force) {
    if (_gloss && !force) return Promise.resolve(_gloss);
    if (_glossFailed && !force) return Promise.resolve(null);
    if (_glossPromise && !force) return _glossPromise;
    _glossPromise = fetchJSON(GLOSSARY_FILE).then(function (json) {
      _gloss = indexGlossary(json); _glossFailed = false; return _gloss;
    }).catch(function () { _glossFailed = true; _glossPromise = null; return null; });
    return _glossPromise;
  }
  function setGlossary(json) { _gloss = indexGlossary(json); _glossFailed = false; _glossPromise = Promise.resolve(_gloss); return _gloss; }
  function resetGlossary() { _gloss = null; _glossFailed = false; _glossPromise = null; }
  /** glossary.lookup('RSI') → term object or null (sync; null until load() has resolved). */
  function lookupTerm(term) {
    if (!_gloss) return null;
    var k = glossKey(term); if (!k) return null;
    var t = _gloss.byKey[k];
    if (!t && /s$/.test(k)) t = _gloss.byKey[k.replace(/(ie)?s$/, function (m) { return m === 'ies' ? 'y' : ''; })];
    if (!t && /s$/.test(k)) t = _gloss.byKey[k.slice(0, -1)];
    if (!t) { var alt = k.replace(/-/g, ' '); if (alt !== k) t = _gloss.byKey[alt]; }
    return t || null;
  }
  function glossaryUrl(t) { var id = typeof t === 'string' ? t : (t && t.id); return id ? 'glossary.html#term/' + encodeURIComponent(id) : 'glossary.html'; }
  var glossary = {
    load: loadGlossary, set: setGlossary, reset: resetGlossary, lookup: lookupTerm, url: glossaryUrl, key: glossKey,
    get loaded() { return !!_gloss; }, get failed() { return _glossFailed; },
    get terms() { return _gloss ? _gloss.terms : []; },
    get categories() { return _gloss ? _gloss.categories : []; },
    categoryLabel: function (id) {
      var c = (_gloss ? _gloss.categories : []).filter(function (x) { return x && x.id === id; })[0];
      return c ? String(c.label) : String(id || '');
    }
  };

  /* ------------------------------------------------------------------ */
  /* Course data loading                                                  */
  /* ------------------------------------------------------------------ */
  var _index = null;             // parsed course/index.json
  var _indexPromise = null;
  var _modules = {};             // id → parsed module json
  var _modulePromises = {};

  function CourseError(message, code) {
    var e = new Error(message); e.name = 'CourseError'; e.code = code || 'course'; return e;
  }

  function explainFetchError(e, file) {
    if (e instanceof TypeError || (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message || ''))) {
      return 'Could not load ' + file + '. If you opened this page as a local file, browsers block fetch() — serve the folder with a tiny web server (e.g. `python3 -m http.server`) or use the hosted version.';
    }
    return 'Could not load ' + file + ': ' + (e && e.message ? e.message : String(e));
  }

  async function fetchJSON(file) {
    var res;
    try { res = await fetch(file, { cache: 'no-cache' }); }
    catch (e) { throw CourseError(explainFetchError(e, file), 'network'); }
    if (!res.ok) throw CourseError('Could not load ' + file + ' (HTTP ' + res.status + ').', 'http');
    try { return await res.json(); }
    catch (e) { throw CourseError(file + ' is not valid JSON: ' + e.message, 'parse'); }
  }

  /** Normalise an index so the rest of the app can rely on its shape. */
  function normaliseIndex(json) {
    var modules = (json && Array.isArray(json.modules)) ? json.modules : [];
    return {
      version: json && json.version || '',
      title: json && json.title || 'Course',
      summary: json && json.summary || '',
      modules: modules.map(function (m, i) {
        return {
          id: String(m.id || ('m' + (i + 1))),
          title: String(m.title || ('Module ' + (i + 1))),
          level: /^(beginner|intermediate|advanced)$/.test(m.level) ? m.level : 'beginner',
          minutes: +m.minutes || 0,
          summary: String(m.summary || ''),
          pro: !!m.pro,
          lessons: (Array.isArray(m.lessons) ? m.lessons : []).map(function (l, j) {
            return { id: String(l.id || (m.id + '-l' + (j + 1))), title: String(l.title || ('Lesson ' + (j + 1))), minutes: +l.minutes || 0, pro: !!(l.pro || m.pro) };
          })
        };
      })
    };
  }

  /**
   * Normalise a module file. Accepts either the full shape
   * {id, title, level, minutes, summary, lessons:[{id,title,minutes,blocks}]}
   * or a bare {lessons:[...]} and fills the gaps from the index when known.
   */
  function normaliseModule(json, id) {
    var meta = (_index && _index.modules.filter(function (m) { return m.id === id; })[0]) || {};
    var lessons = (json && Array.isArray(json.lessons)) ? json.lessons : [];
    var mod = {
      id: String((json && json.id) || id),
      title: String((json && json.title) || meta.title || id),
      level: (json && json.level) || meta.level || 'beginner',
      minutes: +((json && json.minutes) || meta.minutes) || 0,
      summary: String((json && json.summary) || meta.summary || ''),
      objectives: (json && Array.isArray(json.objectives)) ? json.objectives.map(String) : [],
      pro: !!((json && json.pro) || meta.pro),
      lessons: lessons.map(function (l, j) {
        var fallbackId = (meta.lessons && meta.lessons[j] && meta.lessons[j].id) || (id + '-l' + (j + 1));
        var indexed = (meta.lessons || []).filter(function (x) { return x.id === String(l.id || fallbackId); })[0] || {};
        return {
          id: String(l.id || fallbackId),
          title: String(l.title || ('Lesson ' + (j + 1))),
          minutes: +l.minutes || 0,
          pro: !!(l.pro || (json && json.pro) || indexed.pro || meta.pro),
          summary: String(l.summary || ''),
          blocks: Array.isArray(l.blocks) ? l.blocks.filter(function (b) { return b && typeof b.type === 'string'; }) : []
        };
      })
    };
    // minutes: sum lessons if the module did not say
    if (!mod.minutes) mod.minutes = mod.lessons.reduce(function (s, l) { return s + (l.minutes || 0); }, 0);
    return mod;
  }

  /** Load (once) and return the normalised course index. */
  function loadIndex(force) {
    if (_index && !force) return Promise.resolve(_index);
    if (_indexPromise && !force) return _indexPromise;
    _indexPromise = fetchJSON(COURSE_DIR + 'index.json').then(function (json) {
      _index = normaliseIndex(json);
      return _index;
    }).catch(function (e) { _indexPromise = null; throw e; });
    return _indexPromise;
  }

  /** Inject an index without fetching (tests, embedded builds). */
  function setIndex(json) { _index = normaliseIndex(json); _indexPromise = Promise.resolve(_index); return _index; }

  /** Load (once) a module file by id, e.g. 'm1-foundations'. */
  function loadModule(id, force) {
    id = String(id || '');
    if (!/^[a-z0-9-]+$/i.test(id)) return Promise.reject(CourseError('Bad module id "' + id + '"', 'input'));
    if (_modules[id] && !force) return Promise.resolve(_modules[id]);
    if (_modulePromises[id] && !force) return _modulePromises[id];
    _modulePromises[id] = loadIndex().catch(function () { return null; }).then(function () {
      return fetchJSON(COURSE_DIR + id + '.json');
    }).then(function (json) {
      var mod = normaliseModule(json, id);
      _modules[id] = mod;
      // refresh the index with the real lesson titles / minutes
      if (_index) {
        var im = _index.modules.filter(function (m) { return m.id === id; })[0];
        if (im) {
          im.lessons = mod.lessons.map(function (l) { return { id: l.id, title: l.title, minutes: l.minutes, pro: !!l.pro }; });
          if (mod.pro) im.pro = true;
          if (mod.minutes) im.minutes = mod.minutes;
          if (mod.summary) im.summary = mod.summary;
        }
      }
      return mod;
    }).catch(function (e) { delete _modulePromises[id]; throw e; });
    return _modulePromises[id];
  }

  function setModule(json, id) { var mod = normaliseModule(json, id || (json && json.id)); _modules[mod.id] = mod; return mod; }

  /** Load every module listed in the index (parallel). Resolves with {id: module|Error}. */
  function loadAll() {
    return loadIndex().then(function (idx) {
      return Promise.all(idx.modules.map(function (m) {
        return loadModule(m.id).then(function (mod) { return [m.id, mod]; }, function (e) { return [m.id, e]; });
      }));
    }).then(function (pairs) {
      var out = {}; pairs.forEach(function (p) { out[p[0]] = p[1]; }); return out;
    });
  }

  /* --- lookups on loaded data (sync) --- */
  function getIndex() { return _index; }
  function getModule(id) { return _modules[id] || null; }

  /** Find which module a lesson belongs to (from the index). */
  function moduleOfLesson(lessonId) {
    if (!_index) return null;
    for (var i = 0; i < _index.modules.length; i++) {
      var m = _index.modules[i];
      for (var j = 0; j < m.lessons.length; j++) if (m.lessons[j].id === lessonId) return m;
    }
    return null;
  }

  /** Flat ordered list of {moduleId, lessonId, title} across the whole course. */
  function lessonSequence() {
    if (!_index) return [];
    var seq = [];
    _index.modules.forEach(function (m) {
      m.lessons.forEach(function (l) { seq.push({ moduleId: m.id, lessonId: l.id, title: l.title }); });
    });
    return seq;
  }

  /** The lesson after / before `lessonId` in course order (or null). */
  function neighbours(lessonId) {
    var seq = lessonSequence(), idx = -1;
    for (var i = 0; i < seq.length; i++) if (seq[i].lessonId === lessonId) { idx = i; break; }
    return { prev: idx > 0 ? seq[idx - 1] : null, next: idx >= 0 && idx < seq.length - 1 ? seq[idx + 1] : null, index: idx, total: seq.length };
  }

  /** Does a lesson (loaded) contain a quiz block? */
  function lessonHasQuiz(lesson) {
    return !!(lesson && lesson.blocks && lesson.blocks.some(function (b) { return b.type === 'quiz' && Array.isArray(b.questions) && b.questions.length; }));
  }

  /* ------------------------------------------------------------------ */
  /* Progress                                                             */
  /* ------------------------------------------------------------------ */
  function blankProgress() {
    return { lessonsDone: {}, quizScores: {}, startedAt: null, lastLessonId: null, updatedAt: null, certificate: null };
  }
  function loadProgress() {
    var p = store.get(STORE_KEY, null);
    var out = blankProgress();
    if (p && typeof p === 'object') {
      if (p.lessonsDone && typeof p.lessonsDone === 'object') out.lessonsDone = p.lessonsDone;
      if (p.quizScores && typeof p.quizScores === 'object') out.quizScores = p.quizScores;
      out.startedAt = p.startedAt || null;
      out.lastLessonId = p.lastLessonId || null;
      out.updatedAt = p.updatedAt || null;
      out.certificate = p.certificate || null;
    }
    return out;
  }

  var progress = loadProgress();

  function touch() {
    if (!progress.startedAt) progress.startedAt = new Date().toISOString();
    progress.updatedAt = new Date().toISOString();
  }
  function saveProgress() { return store.set(STORE_KEY, progress); }

  function markDone(lessonId) {
    if (!lessonId) return progress;
    touch();
    progress.lessonsDone[lessonId] = true;
    progress.lastLessonId = lessonId;
    saveProgress();
    return progress;
  }
  function unmarkDone(lessonId) {
    delete progress.lessonsDone[lessonId]; touch(); saveProgress(); return progress;
  }
  function isDone(lessonId) { return !!progress.lessonsDone[lessonId]; }

  /** Record a quiz result (0–100). Keeps the BEST score so retakes never hurt. */
  function recordQuiz(lessonId, pct) {
    if (!lessonId) return progress;
    pct = Math.max(0, Math.min(100, Math.round(+pct || 0)));
    touch();
    var prev = progress.quizScores[lessonId];
    progress.quizScores[lessonId] = (prev == null) ? pct : Math.max(prev, pct);
    progress.lastLessonId = lessonId;
    saveProgress();
    return progress;
  }
  function quizScore(lessonId) { var v = progress.quizScores[lessonId]; return v == null ? null : v; }

  function setLastLesson(lessonId) { progress.lastLessonId = lessonId || null; touch(); saveProgress(); }

  function resetProgress() {
    progress = blankProgress();
    store.del(STORE_KEY);
    return progress;
  }

  /** {done, total, pct, quizAvg, quizzes} for one module (needs the index). */
  function moduleProgress(moduleId) {
    var m = _index && _index.modules.filter(function (x) { return x.id === moduleId; })[0];
    if (!m) return { done: 0, total: 0, pct: 0, quizAvg: null, quizzes: 0, minutes: 0, minutesLeft: 0 };
    var done = 0, scores = [], minutes = 0, minutesLeft = 0;
    m.lessons.forEach(function (l) {
      var mins = l.minutes || DEFAULT_LESSON_MINUTES;
      minutes += mins;
      if (progress.lessonsDone[l.id]) done++; else minutesLeft += mins;
      if (progress.quizScores[l.id] != null) scores.push(progress.quizScores[l.id]);
    });
    var total = m.lessons.length;
    var quizAvg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
    return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0, quizAvg: quizAvg, quizzes: scores.length, minutes: minutes, minutesLeft: minutesLeft };
  }

  /**
   * timeRemaining(moduleId?) → {minutes, lessons, label} for the lessons not yet
   * marked done (whole course when no module is given). Lessons without a
   * minutes value count as DEFAULT_LESSON_MINUTES.
   */
  function timeRemaining(moduleId) {
    var modules = _index ? _index.modules : [];
    if (moduleId) modules = modules.filter(function (m) { return m.id === moduleId; });
    var minutes = 0, lessons = 0;
    modules.forEach(function (m) {
      m.lessons.forEach(function (l) { if (!progress.lessonsDone[l.id]) { lessons++; minutes += l.minutes || DEFAULT_LESSON_MINUTES; } });
    });
    return { minutes: minutes, lessons: lessons, label: formatDuration(minutes) };
  }
  /** formatDuration(135) → '2 h 15 min'; (45) → '45 min'; (0) → '0 min'. */
  function formatDuration(mins) {
    mins = Math.max(0, Math.round(+mins || 0));
    if (mins < 60) return mins + ' min';
    var h = Math.floor(mins / 60), r = mins % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }

  /** Whole-course summary. */
  function courseProgress() {
    var modules = _index ? _index.modules : [];
    var done = 0, total = 0, scores = [], minutes = 0, minutesLeft = 0;
    modules.forEach(function (m) {
      var mp = moduleProgress(m.id); done += mp.done; total += mp.total; minutes += mp.minutes; minutesLeft += mp.minutesLeft;
      m.lessons.forEach(function (l) { if (progress.quizScores[l.id] != null) scores.push(progress.quizScores[l.id]); });
    });
    return {
      done: done, total: total, pct: total ? Math.round(done / total * 100) : 0,
      quizAvg: scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null,
      quizzes: scores.length, startedAt: progress.startedAt, lastLessonId: progress.lastLessonId,
      minutes: minutes, minutesLeft: minutesLeft, modules: modules.length
    };
  }

  /**
   * certificateStatus() → {eligible, modules:[{id,title,done,total,quizAvg,quizzes,ok,reason}], passPct}
   * A module is OK when every lesson is done AND it has at least one recorded
   * quiz AND the quiz average is ≥ PASS_PCT. The certificate needs every module OK.
   */
  function certificateStatus() {
    var modules = _index ? _index.modules : [];
    var rows = modules.map(function (m) {
      var mp = moduleProgress(m.id), reason = '';
      var allDone = mp.total > 0 && mp.done === mp.total;
      var quizOk = mp.quizzes > 0 && mp.quizAvg >= PASS_PCT;
      if (!allDone) reason = (mp.total - mp.done) + ' lesson' + (mp.total - mp.done === 1 ? '' : 's') + ' left';
      else if (mp.quizzes === 0) reason = 'No quiz taken yet';
      else if (!quizOk) reason = 'Quiz average ' + mp.quizAvg + '% — need ' + PASS_PCT + '%';
      return { id: m.id, title: m.title, done: mp.done, total: mp.total, pct: mp.pct, quizAvg: mp.quizAvg, quizzes: mp.quizzes, ok: allDone && quizOk, reason: reason };
    });
    return { eligible: rows.length > 0 && rows.every(function (r) { return r.ok; }), modules: rows, passPct: PASS_PCT };
  }
  function certificateEligible() { return certificateStatus().eligible; }

  /* ------------------------------------------------------------------ */
  /* Certificate drawing                                                  */
  /* ------------------------------------------------------------------ */
  function fmtDate(d) {
    try { return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  // Local certificate ids: 'BT-LOCAL-XXXXXX', six characters from an alphabet
  // without 0/1/O/I so they are easy to read aloud. Random (crypto when available)
  // so two students with the same name on the same day never collide. Used only
  // when js/auth.js is absent; with it, BT.auth.issueCertificate supplies the id.
  var ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function localCertId() {
    var out = 'BT-LOCAL-', bytes = null;
    try { if (window.crypto && window.crypto.getRandomValues) { bytes = new Uint8Array(6); window.crypto.getRandomValues(bytes); } } catch (e) { bytes = null; }
    for (var i = 0; i < 6; i++) {
      var r = bytes ? bytes[i] : Math.floor(Math.random() * 256);
      out += ID_ALPHABET.charAt(r % ID_ALPHABET.length);
    }
    return out;
  }
  function isLocalCertId(id) { return /^BT-LOCAL-[A-Z0-9]{6}$/.test(String(id || '').toUpperCase()); }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fitText(ctx, text, maxWidth, startPx, family, weight) {
    var px = startPx;
    do { ctx.font = (weight || '600') + ' ' + px + 'px ' + family; px -= 4; }
    while (ctx.measureText(text).width > maxWidth && px > 24);
  }

  /**
   * certificate({name, date, course, canvas, theme, id, verified, verifyUrl, record}) → dataURL (PNG).
   * Draws a 1600×1130 landscape certificate. `canvas` is optional (one is
   * created if omitted); `theme` may be 'dark' | 'light' (default 'light' — it prints well).
   * `id` is the certificate id to print (from BT.auth.issueCertificate); when
   * omitted a local 'BT-LOCAL-XXXXXX' id is generated. `verified` labels the id
   * as server-issued; `verifyUrl` is printed under it. `record:false` skips
   * writing progress.certificate (used for previews).
   */
  function certificate(opts) {
    opts = opts || {};
    var name = String(opts.name || '').trim() || 'Student';
    var date = opts.date instanceof Date ? opts.date : (opts.date ? new Date(opts.date) : new Date());
    if (isNaN(date.getTime())) date = new Date();
    var courseTitle = String(opts.course || (_index && _index.title) || 'Broward Trading Course');
    var id = String(opts.id || '').trim().toUpperCase() || localCertId();
    var verified = !!opts.verified;
    var verifyUrl = opts.verifyUrl ? String(opts.verifyUrl) : '';
    var modList = (_index && _index.modules.length) ? _index.modules.map(function (m) { return m.title; }) : null;
    var modCount = modList ? modList.length : 0;
    var COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    var canvas = opts.canvas || document.createElement('canvas');
    canvas.width = CERT_W; canvas.height = CERT_H;
    var ctx = canvas.getContext('2d');
    var dark = opts.theme === 'dark';
    var C = dark
      ? { bg: '#0f1319', panel: '#161c25', line: '#263040', fg: '#e6ebf2', muted: '#8a97a8', accent: '#4f8cff', up: '#22c55e', warn: '#f5b84d' }
      : { bg: '#f3f5f8', panel: '#ffffff', line: '#d6dce5', fg: '#141a22', muted: '#5f6b7a', accent: '#2563eb', up: '#16a34a', warn: '#b7791f' };
    var SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
    var MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
    var W = CERT_W, H = CERT_H, cx = W / 2;

    // background + card
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.panel; roundRect(ctx, 50, 50, W - 100, H - 100, 22); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; roundRect(ctx, 50, 50, W - 100, H - 100, 22); ctx.stroke();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 3; roundRect(ctx, 76, 76, W - 152, H - 152, 14); ctx.stroke();

    // decorative candlestick strip (deterministic from the name) along the bottom
    var seed = 0; for (var i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;
    var rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    var px0 = 120, baseY = H - 190, p = 0, count = 46, gap = (W - 240) / count;
    ctx.save(); ctx.globalAlpha = dark ? 0.5 : 0.35;
    for (i = 0; i < count; i++) {
      var o = p, c = o + (rnd() - 0.47) * 26; var hi = Math.max(o, c) + rnd() * 10, lo = Math.min(o, c) - rnd() * 10; p = c;
      var x = px0 + i * gap + gap / 2, up = c >= o;
      ctx.strokeStyle = ctx.fillStyle = up ? C.up : '#ef4444';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, baseY - hi); ctx.lineTo(x, baseY - lo); ctx.stroke();
      ctx.fillRect(x - gap * 0.3, baseY - Math.max(o, c), gap * 0.6, Math.max(2, Math.abs(c - o)));
    }
    ctx.restore();

    // brand
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.fg; ctx.font = '600 44px ' + SANS; ctx.fillText('Broward Trading', cx, 190);
    ctx.fillStyle = C.muted; ctx.font = '400 20px ' + SANS; ctx.fillText('Paper-trading & technical-analysis lab', cx, 224);

    // title
    ctx.fillStyle = C.accent; ctx.font = '500 24px ' + SANS;
    ctx.fillText('C E R T I F I C A T E   O F   C O M P L E T I O N', cx, 318);

    ctx.fillStyle = C.muted; ctx.font = '400 26px ' + SANS; ctx.fillText('This certifies that', cx, 400);

    // name (auto-fit)
    ctx.fillStyle = C.fg; fitText(ctx, name, W - 360, 96, SANS, '600'); ctx.fillText(name, cx, 505);
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 420, 535); ctx.lineTo(cx + 420, 535); ctx.stroke();

    ctx.fillStyle = C.muted; ctx.font = '400 26px ' + SANS;
    var countText = modCount ? ('all ' + (COUNT_WORDS[modCount] || modCount) + ' modules') : 'every module';
    ctx.fillText('has completed ' + countText + ' and passed every quiz of', cx, 600);
    ctx.fillStyle = C.fg; fitText(ctx, courseTitle, W - 300, 44, SANS, '600'); ctx.fillText(courseTitle, cx, 660);

    // module list, wrapped onto up to three lines
    ctx.fillStyle = C.muted; ctx.font = '400 20px ' + SANS;
    var modLines = [];
    if (modList) {
      var cur = '';
      modList.forEach(function (t) {
        var next = cur ? cur + ' · ' + t : t;
        if (cur && ctx.measureText(next).width > W - 320) { modLines.push(cur); cur = t; } else cur = next;
      });
      if (cur) modLines.push(cur);
    } else {
      modLines = ['Market Foundations · Reading Charts & Candlesticks · Technical Indicators', 'Risk Management & Paper Trading · Options Basics · Strategy & Backtesting'];
    }
    modLines = modLines.slice(0, 3);
    var listY = modLines.length === 3 ? 700 : 712;
    modLines.forEach(function (ln, li) { fitText(ctx, ln, W - 300, 20, SANS, '400'); ctx.fillText(ln, cx, listY + li * 28); });

    // footer row: date | seal | id
    ctx.textAlign = 'left'; ctx.fillStyle = C.fg; ctx.font = '500 24px ' + SANS; ctx.fillText(fmtDate(date), 170, 870);
    ctx.fillStyle = C.muted; ctx.font = '400 17px ' + SANS; ctx.fillText('Date of completion', 170, 898);

    ctx.textAlign = 'right'; ctx.fillStyle = C.fg; fitText(ctx, id, 420, 24, MONO, '500'); ctx.fillText(id, W - 170, 870);
    ctx.fillStyle = C.muted; ctx.font = '400 17px ' + SANS;
    ctx.fillText(verified ? 'Certificate id (verified)' : 'Certificate id (self-issued)', W - 170, 898);
    if (verifyUrl) {
      // the decorative candle strip runs behind this line; mask it so the link stays legible
      fitText(ctx, verifyUrl, 560, 15, MONO, '400');
      var uw = ctx.measureText(verifyUrl).width;
      ctx.save(); ctx.globalAlpha = 0.92; ctx.fillStyle = C.panel; roundRect(ctx, W - 170 - uw - 10, 908, uw + 20, 22, 6); ctx.fill(); ctx.restore();
      ctx.fillStyle = C.muted; ctx.fillText(verifyUrl, W - 170, 924);
    }

    // seal
    ctx.save(); ctx.translate(cx, 860);
    ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '600 22px ' + SANS; ctx.fillText('BT', 0, -4);
    ctx.font = '500 12px ' + SANS; ctx.fillText('LEARN · TRADE', 0, 16);
    ctx.restore();

    // disclaimer
    ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.font = '400 15px ' + SANS;
    ctx.fillText('Free educational simulator. This ' + (verified ? 'certificate' : 'self-issued certificate') + ' recognises course completion; it is not a professional licence or financial advice.', cx, H - 105);

    var url;
    try { url = canvas.toDataURL('image/png'); } catch (e) { url = ''; }
    if (opts.record !== false) {
      progress.certificate = { name: name, date: date.toISOString(), id: id, verified: verified, verifyUrl: verifyUrl || null };
      touch(); saveProgress();
    }
    return url;
  }

  /* ------------------------------------------------------------------ */
  /* Quiz helpers (pure)                                                  */
  /* ------------------------------------------------------------------ */
  /** gradeQuiz(questions, answers[]) → {correct, total, pct, results:[{ok, chosen, answer}]} */
  function gradeQuiz(questions, answers) {
    questions = Array.isArray(questions) ? questions : []; answers = answers || [];
    var correct = 0, results = questions.map(function (q, i) {
      var ok = answers[i] != null && +answers[i] === +q.answer; if (ok) correct++;
      return { ok: ok, chosen: answers[i] == null ? null : +answers[i], answer: +q.answer };
    });
    return { correct: correct, total: questions.length, pct: questions.length ? Math.round(correct / questions.length * 100) : 0, results: results };
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */
  BT.course = {
    // markdown
    renderMd: renderMd, escapeHtml: escapeHtml, termsIn: termsIn,
    // glossary
    glossary: glossary,
    // data
    loadIndex: loadIndex, loadModule: loadModule, loadAll: loadAll, setIndex: setIndex, setModule: setModule,
    getIndex: getIndex, getModule: getModule, moduleOfLesson: moduleOfLesson, lessonSequence: lessonSequence,
    neighbours: neighbours, lessonHasQuiz: lessonHasQuiz,
    // progress
    get progress() { return progress; },
    save: saveProgress, markDone: markDone, unmarkDone: unmarkDone, isDone: isDone,
    recordQuiz: recordQuiz, quizScore: quizScore, setLastLesson: setLastLesson, resetProgress: resetProgress,
    moduleProgress: moduleProgress, courseProgress: courseProgress, timeRemaining: timeRemaining, formatDuration: formatDuration,
    certificateEligible: certificateEligible, certificateStatus: certificateStatus,
    // certificate & quiz
    certificate: certificate, localCertId: localCertId, isLocalCertId: isLocalCertId, gradeQuiz: gradeQuiz,
    PASS_PCT: PASS_PCT, DEFAULT_LESSON_MINUTES: DEFAULT_LESSON_MINUTES, STORE_KEY: STORE_KEY, CourseError: CourseError,
    version: '0.3.0'
  };
})();
