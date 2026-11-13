/* Broward Trading — js/glossary.js → BT.glossary (v0.3)
 *
 * Data + scheduling engine for glossary.html (and for the [[term]] tooltips in
 * learn.js). Pure: never touches the DOM, so it can be loaded in Node with a
 * `window` shim and tested (tests/glossary.test.js).
 *
 *   Terms (course/glossary.json → {version, categories:[{id,label}], terms:[...]})
 *     term: {id, term, aliases[], category, lesson, definition, example, related[]}
 *     load(force)            → Promise<data>   fetch + in-memory cache
 *     setData(data)          → data            inject data (tests, inline fallback)
 *     terms() / categories() / get(idOrName) / search(q, {category, limit})
 *     letters() / byLetter() / related(id) / lessonUrl(term) / linkify(text) helpers
 *
 *   Flashcards (localStorage 'bt.flashcards')
 *     Spaced-repetition light: three grades (again / hard / good). Each card keeps
 *     {interval (days), ease, due (ms), reps, lapses, last}. 'again' sends the card
 *     back to the front of today's queue; 'hard' grows the interval slowly; 'good'
 *     follows 1 → 3 → interval×ease days.
 *     flashcards.rate(id, grade, now) / queue(opts) / due(now) / stats(now) / preview(id, now) / reset()
 *
 *   Daily 5 (localStorage 'bt.daily5', questions from course/questionbank.json)
 *     daily.loadBank() / setBank(bank) / pick(dateKey, n) deterministic per calendar day
 *     daily.status(dateKey) / record(dateKey, {score,total,answers}) / streak(dateKey) / history()
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (root.BT && root.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }

  var TERMS_URL = 'course/glossary.json';
  var BANK_URL = 'course/questionbank.json';
  var FC_KEY = 'bt.flashcards';
  var DAILY_KEY = 'bt.daily5';
  var DAY_MS = 86400000;
  var DAILY_N = 5;

  /* ------------------------------------------------------------------ *
   * Safe localStorage
   * ------------------------------------------------------------------ */
  function lsGet(k, d) {
    try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { root.localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function lsDel(k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[‘’“”]/g, "'")
      .replace(/[^a-z0-9+&/%.\-' ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Local calendar date 'YYYY-MM-DD' for a Date / ms timestamp (default now). */
  function dateKey(now) {
    var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  /** Days between two 'YYYY-MM-DD' keys (b - a), ignoring DST. */
  function dayDiff(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    var ta = Date.UTC(pa[0], pa[1] - 1, pa[2]), tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
    return Math.round((tb - ta) / DAY_MS);
  }
  function shiftKey(key, days) {
    var p = key.split('-').map(Number);
    return dateKey(new Date(p[0], p[1] - 1, p[2] + days));
  }
  /** Deterministic PRNG (mulberry32) seeded from a string. */
  function seedFrom(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * Terms
   * ------------------------------------------------------------------ */
  var data = null;          // {version, categories, terms}
  var byId = {};            // id → term
  var byName = {};          // normalised term / alias → term
  var loading = null;

  function index(d) {
    byId = {}; byName = {};
    var terms = (d && d.terms) || [];
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      t.aliases = Array.isArray(t.aliases) ? t.aliases : [];
      t.related = Array.isArray(t.related) ? t.related : [];
      // '(RSI)', '(share)', '(stop-loss)' inside a display name act as aliases too
      t._alts = t.aliases.slice();
      String(t.term).replace(/\(([^)]+)\)/g, function (_, inner) {
        inner.split('/').forEach(function (part) { part = part.trim(); if (part) t._alts.push(part); });
        return '';
      });
      byId[t.id] = t;
      byName[norm(t.term)] = t;
      byName[norm(baseName(t.term))] = byName[norm(baseName(t.term))] || t;
      for (var j = 0; j < t._alts.length; j++) byName[norm(t._alts[j])] = byName[norm(t._alts[j])] || t;
    }
    return d;
  }
  /** 'Bid-ask spread' stays; 'Stock (share)' → 'Stock'; 'RSI (Relative…)' → 'RSI'. */
  function baseName(name) { return String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim(); }

  function setData(d) {
    if (!d || !Array.isArray(d.terms)) throw new Error('glossary: setData needs {terms:[]}');
    data = { version: d.version || '', categories: Array.isArray(d.categories) ? d.categories : [], terms: d.terms.slice() };
    data.terms.sort(function (a, b) { return String(a.term).localeCompare(String(b.term), 'en', { sensitivity: 'base' }); });
    index(data);
    return data;
  }
  function load(force) {
    if (data && !force) return Promise.resolve(data);
    if (loading && !force) return loading;
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    loading = root.fetch(TERMS_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('glossary: HTTP ' + r.status);
      return r.json();
    }).then(function (d) { loading = null; return setData(d); }, function (e) { loading = null; throw e; });
    return loading;
  }
  function terms() { return data ? data.terms : []; }
  function categories() { return data ? data.categories : []; }
  function categoryLabel(id) {
    var cs = categories();
    for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i].label;
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
  }
  /** Look a term up by id, display name, base name or alias (case-insensitive). */
  function get(key) {
    if (key == null) return null;
    var k = String(key);
    if (byId[k]) return byId[k];
    var n = norm(k);
    if (byName[n]) return byName[n];
    if (byId[slug(k)]) return byId[slug(k)];
    // singular / plural tolerance: 'candlesticks' → 'candlestick'
    if (n.length > 3 && n.slice(-1) === 's' && byName[n.slice(0, -1)]) return byName[n.slice(0, -1)];
    return null;
  }
  /**
   * search(q, {category, limit}) → ranked terms.
   * Score: exact name 100 · name prefix 80 · alias prefix 70 · word-start inside
   * name 60 · substring of name 50 · word in definition/example 20 (+5 per extra hit).
   * Empty query → every term (optionally filtered by category), alphabetical.
   */
  function search(q, opts) {
    opts = opts || {};
    var all = terms();
    if (opts.category) all = all.filter(function (t) { return t.category === opts.category; });
    var n = norm(q);
    if (!n) return opts.limit ? all.slice(0, opts.limit) : all.slice();
    var words = n.split(' ').filter(Boolean);
    var scored = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i], name = norm(t.term), base = norm(baseName(t.term));
      var s = 0;
      if (name === n || base === n) s = 100;
      else if (name.indexOf(n) === 0 || base.indexOf(n) === 0) s = 80;
      else {
        var alts = t._alts || t.aliases;
        for (var a = 0; a < alts.length && s < 90; a++) {
          var al = norm(alts[a]);
          if (al === n) s = 90; else if (al.indexOf(n) === 0 && s < 70) s = 70;
        }
        if (s < 60 && (' ' + name).indexOf(' ' + n) >= 0) s = 60;
        else if (s < 50 && name.indexOf(n) >= 0) s = 50;
      }
      if (s === 0 && words.length) {
        var hay = norm(t.definition + ' ' + t.example + ' ' + (t._alts || t.aliases).join(' '));
        var hits = 0;
        for (var w = 0; w < words.length; w++) if (hay.indexOf(words[w]) >= 0) hits++;
        if (hits === words.length) s = 20 + Math.min(15, (hay.split(words[0]).length - 2) * 5);
      }
      if (s > 0) scored.push({ t: t, s: s });
    }
    scored.sort(function (a, b) { return b.s - a.s || a.t.term.localeCompare(b.t.term, 'en', { sensitivity: 'base' }); });
    var out = scored.map(function (x) { return x.t; });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }
  function letterOf(t) {
    var c = String(t.term).charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }
  /** Letters that have at least one term, '#' first then A–Z. */
  function letters(list) {
    var seen = {}; (list || terms()).forEach(function (t) { seen[letterOf(t)] = true; });
    var out = Object.keys(seen).sort(function (a, b) { return a === '#' ? -1 : b === '#' ? 1 : a < b ? -1 : 1; });
    return out;
  }
  function byLetter(list) {
    var groups = {};
    (list || terms()).forEach(function (t) { var L = letterOf(t); (groups[L] = groups[L] || []).push(t); });
    return groups;
  }
  function related(id) {
    var t = typeof id === 'string' ? get(id) : id;
    if (!t) return [];
    return t.related.map(function (r) { return byId[r]; }).filter(Boolean);
  }
  /** Terms that list `id` as related but are not in its own list (reverse links). */
  function backlinks(id) {
    var t = typeof id === 'string' ? get(id) : id;
    if (!t) return [];
    return terms().filter(function (o) { return o.id !== t.id && o.related.indexOf(t.id) >= 0 && t.related.indexOf(o.id) < 0; });
  }
  function lessonUrl(t) {
    var lesson = t && (t.lesson || t);
    return lesson ? 'learn.html#/lesson/' + encodeURIComponent(lesson) : 'learn.html';
  }
  function termUrl(t) { return 'glossary.html#term/' + encodeURIComponent(typeof t === 'string' ? t : t.id); }
  /** First sentence of a definition, for compact cards and tooltips. */
  var ABBR = /(?:\b(?:a\.m|p\.m|e\.g|i\.e|vs|etc|approx|no|U\.S|incl|min|max|avg)|\b[A-Z])\.$/i;
  function summary(t, max) {
    var s = String(t && t.definition || '');
    // first sentence: a . ! or ? followed by whitespace + capital/digit/quote (or end), not after an abbreviation
    var re = /[.!?](?=\s+[A-Z0-9+\-"'(\u201c]|\s*$)/g, m, cut = -1;
    while ((m = re.exec(s))) {
      if (m[0] === '.' && ABBR.test(s.slice(0, m.index + 1))) continue;
      cut = m.index + 1; break;
    }
    if (cut > 0) s = s.slice(0, cut).trim();
    max = max || 160;
    return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
  }
  /**
   * linkify(html) replaces [[term]] or [[term|label]] markers in ALREADY-SAFE html
   * with <a class="gl-term" data-term="id" href="glossary.html#term/id">label</a>.
   * Unknown terms keep their label with a plain <span>. learn.js can call this on
   * renderMd() output to get tooltips.
   */
  function linkify(html) {
    return String(html == null ? '' : html).replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, function (_, key, label) {
      var t = get(key.trim());
      var text = esc((label || key).trim());
      if (!t) return '<span class="gl-term unknown">' + text + '</span>';
      return '<a class="gl-term" data-term="' + esc(t.id) + '" href="' + termUrl(t) + '" title="' + esc(summary(t, 140)) + '">' + text + '</a>';
    });
  }

  /* ------------------------------------------------------------------ *
   * Flashcards
   * ------------------------------------------------------------------ */
  var MIN_EASE = 1.3, DEFAULT_EASE = 2.5, AGAIN_MINUTES = 10, MAX_INTERVAL = 365;
  var fc = null;

  function fcLoad() {
    if (fc) return fc;
    var s = lsGet(FC_KEY, null);
    if (!s || typeof s !== 'object' || !s.cards) s = { version: 1, cards: {}, reviews: 0, log: [] };
    if (!Array.isArray(s.log)) s.log = [];
    fc = s;
    return fc;
  }
  function fcSave() { return lsSet(FC_KEY, fcLoad()); }
  function fcReset() { fc = { version: 1, cards: {}, reviews: 0, log: [] }; lsDel(FC_KEY); return fc; }
  function card(id) { return fcLoad().cards[id] || null; }
  function newCard() { return { interval: 0, ease: DEFAULT_EASE, due: 0, reps: 0, lapses: 0, last: 0 }; }

  /** The schedule a grade would produce for a card, without saving. */
  function nextState(c, grade, now) {
    c = c || newCard();
    now = now == null ? Date.now() : +now;
    var n = { interval: c.interval, ease: c.ease, due: c.due, reps: c.reps, lapses: c.lapses, last: now };
    if (grade === 'again') {
      n.interval = 0; n.reps = 0; n.lapses = c.lapses + 1;
      n.ease = Math.max(MIN_EASE, c.ease - 0.2);
      n.due = now + AGAIN_MINUTES * 60000;
    } else if (grade === 'hard') {
      n.ease = Math.max(MIN_EASE, c.ease - 0.15);
      n.interval = c.reps === 0 ? 1 : Math.min(MAX_INTERVAL, Math.max(1, Math.round(c.interval * 1.2 * 10) / 10));
      n.reps = c.reps + 1;
      n.due = now + n.interval * DAY_MS;
    } else if (grade === 'good') {
      if (c.reps === 0) n.interval = 1;
      else if (c.reps === 1) n.interval = 3;
      else n.interval = Math.min(MAX_INTERVAL, Math.round(c.interval * c.ease));
      n.reps = c.reps + 1;
      n.due = now + n.interval * DAY_MS;
    } else {
      throw new Error('flashcards: grade must be again | hard | good');
    }
    return n;
  }
  /** Human label for the delay a grade would give ('10 min', '1 day', '3 days', '2 wk'). */
  function delayLabel(c, grade, now) {
    var n = nextState(c, grade, now);
    now = now == null ? Date.now() : +now;
    var ms = n.due - now;
    if (ms < DAY_MS) return T('{n} min', { n: Math.round(ms / 60000) });
    var d = Math.round(ms / DAY_MS);
    if (d < 14) return T(d === 1 ? '{n} day' : '{n} days', { n: d });
    if (d < 60) return T('{n} wk', { n: Math.round(d / 7) });
    return T('{n} mo', { n: Math.round(d / 30) });
  }
  function preview(id, now) {
    var c = card(id);
    return { again: delayLabel(c, 'again', now), hard: delayLabel(c, 'hard', now), good: delayLabel(c, 'good', now) };
  }
  function rate(id, grade, now) {
    if (!byId[id]) throw new Error('flashcards: unknown term ' + id);
    now = now == null ? Date.now() : +now;
    var s = fcLoad();
    var n = nextState(s.cards[id], grade, now);
    s.cards[id] = n;
    s.reviews = (s.reviews || 0) + 1;
    s.log.push({ id: id, g: grade.charAt(0), t: now });
    if (s.log.length > 2000) s.log.splice(0, s.log.length - 2000);
    fcSave();
    return n;
  }
  /** Put a term into today's queue without grading it (a "study now" action). */
  function add(id, now) {
    if (!byId[id]) throw new Error('flashcards: unknown term ' + id);
    now = now == null ? Date.now() : +now;
    var s = fcLoad();
    if (!s.cards[id]) s.cards[id] = newCard();
    s.cards[id].due = Math.min(s.cards[id].due || now, now);
    fcSave();
    return s.cards[id];
  }
  function isDue(c, now) { return !!c && c.due <= now; }
  /** Cards whose due time has passed, soonest first. */
  function due(now, opts) {
    now = now == null ? Date.now() : +now;
    opts = opts || {};
    var s = fcLoad();
    return terms().filter(function (t) {
      return (!opts.category || t.category === opts.category) && isDue(s.cards[t.id], now);
    }).sort(function (a, b) { return s.cards[a.id].due - s.cards[b.id].due; });
  }
  /** Terms never rated, alphabetical (or shuffled with opts.shuffle). */
  function unseen(opts) {
    opts = opts || {};
    var s = fcLoad();
    var list = terms().filter(function (t) { return (!opts.category || t.category === opts.category) && !s.cards[t.id]; });
    if (opts.shuffle) {
      var r = rng(typeof opts.shuffle === 'number' ? opts.shuffle : seedFrom(dateKey()));
      for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var tmp = list[i]; list[i] = list[j]; list[j] = tmp; }
    }
    return list;
  }
  /**
   * queue({now, limit=20, newLimit=10, category, shuffle}) → terms for a session:
   * every due card first, then up to newLimit unseen cards, capped at limit.
   */
  function queue(opts) {
    opts = opts || {};
    var now = opts.now == null ? Date.now() : +opts.now;
    var limit = opts.limit == null ? 20 : opts.limit;
    var newLimit = opts.newLimit == null ? 10 : opts.newLimit;
    var out = due(now, opts).slice(0, limit);
    if (out.length < limit) out = out.concat(unseen({ category: opts.category, shuffle: opts.shuffle }).slice(0, Math.min(newLimit, limit - out.length)));
    return out;
  }
  function fcStats(now, opts) {
    now = now == null ? Date.now() : +now;
    opts = opts || {};
    var s = fcLoad();
    var all = terms().filter(function (t) { return !opts.category || t.category === opts.category; });
    var seen = 0, dueN = 0, learned = 0, mature = 0, lapses = 0;
    all.forEach(function (t) {
      var c = s.cards[t.id];
      if (!c) return;
      seen++;
      if (isDue(c, now)) dueN++;
      if (c.interval >= 3) learned++;
      if (c.interval >= 21) mature++;
      lapses += c.lapses || 0;
    });
    var today = dateKey(now), reviewedToday = 0, daysActive = {};
    s.log.forEach(function (e) { var k = dateKey(e.t); daysActive[k] = true; if (k === today) reviewedToday++; });
    return { total: all.length, seen: seen, unseen: all.length - seen, due: dueN, learned: learned, mature: mature, lapses: lapses,
      reviews: s.reviews || 0, reviewedToday: reviewedToday, daysActive: Object.keys(daysActive).length };
  }

  /* ------------------------------------------------------------------ *
   * Daily 5
   * ------------------------------------------------------------------ */
  var bank = null, bankLoading = null, daily = null;

  function setBank(b) {
    if (!b || !Array.isArray(b.questions)) throw new Error('glossary: setBank needs {questions:[]}');
    bank = b;
    return bank;
  }
  function loadBank(force) {
    if (bank && !force) return Promise.resolve(bank);
    if (bankLoading && !force) return bankLoading;
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    bankLoading = root.fetch(BANK_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('questionbank: HTTP ' + r.status);
      return r.json();
    }).then(function (b) { bankLoading = null; return setBank(b); }, function (e) { bankLoading = null; throw e; });
    return bankLoading;
  }
  function questions() { return bank ? bank.questions : []; }
  /**
   * pick(dateKey, n=5, list) → the same n questions for everyone on that calendar
   * day: one easy, three medium-ish, one hard when the bank allows, no two from the
   * same lesson when avoidable.
   */
  function pick(key, n, list) {
    key = key || dateKey();
    n = n || DAILY_N;
    list = list || questions();
    if (!list.length) return [];
    var r = rng(seedFrom('daily5:' + key));
    var pools = { easy: [], medium: [], hard: [] };
    list.forEach(function (q) { (pools[q.difficulty] || pools.medium).push(q); });
    var plan = ['easy', 'medium', 'medium', 'hard', 'medium'];
    while (plan.length < n) plan.push('medium');
    plan = plan.slice(0, n);
    var out = [], usedId = {}, usedLesson = {};
    function take(pool) {
      var cands = pool.filter(function (q) { return !usedId[q.id] && !usedLesson[q.lessonId || q.id]; });
      if (!cands.length) cands = pool.filter(function (q) { return !usedId[q.id]; });
      if (!cands.length) return null;
      var q = cands[Math.floor(r() * cands.length)];
      usedId[q.id] = true; usedLesson[q.lessonId || q.id] = true;
      return q;
    }
    for (var i = 0; i < plan.length; i++) {
      var q = take(pools[plan[i]]) || take(list);
      if (q) out.push(q);
    }
    // shuffle the order so the hard one is not always fourth
    for (var k = out.length - 1; k > 0; k--) { var j = Math.floor(r() * (k + 1)); var tmp = out[k]; out[k] = out[j]; out[j] = tmp; }
    return out;
  }
  function dailyLoad() {
    if (daily) return daily;
    var s = lsGet(DAILY_KEY, null);
    if (!s || typeof s !== 'object' || !s.history) s = { version: 1, history: {}, best: 0 };
    daily = s;
    return daily;
  }
  function dailySave() { return lsSet(DAILY_KEY, dailyLoad()); }
  function dailyReset() { daily = { version: 1, history: {}, best: 0 }; lsDel(DAILY_KEY); return daily; }
  function status(key) {
    key = key || dateKey();
    var h = dailyLoad().history[key];
    return { date: key, done: !!h, score: h ? h.score : null, total: h ? h.total : null, answers: h ? h.answers : null };
  }
  /** Consecutive days (ending today, or yesterday if today is not done yet) with a completed Daily 5. */
  function streak(key) {
    key = key || dateKey();
    var h = dailyLoad().history;
    var cur = h[key] ? key : shiftKey(key, -1);
    var n = 0;
    while (h[cur]) { n++; cur = shiftKey(cur, -1); }
    return n;
  }
  function record(key, result) {
    key = key || dateKey();
    var s = dailyLoad();
    var score = Math.max(0, result.score | 0), total = Math.max(1, result.total | 0);
    s.history[key] = { score: score, total: total, pct: Math.round(score / total * 100), answers: Array.isArray(result.answers) ? result.answers : [], at: Date.now() };
    var st = streak(key);
    if (st > (s.best || 0)) s.best = st;
    dailySave();
    return { date: key, score: score, total: total, streak: st, best: s.best };
  }
  function history(limit) {
    var h = dailyLoad().history;
    var keys = Object.keys(h).sort().reverse();
    if (limit) keys = keys.slice(0, limit);
    return keys.map(function (k) { return { date: k, score: h[k].score, total: h[k].total, pct: h[k].pct }; });
  }
  function dailyStats(key) {
    key = key || dateKey();
    var hs = history();
    var answered = 0, correct = 0;
    hs.forEach(function (x) { answered += x.total; correct += x.score; });
    return { days: hs.length, answered: answered, correct: correct, pct: answered ? Math.round(correct / answered * 100) : 0,
      streak: streak(key), best: dailyLoad().best || 0, doneToday: status(key).done };
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */
  BT.glossary = {
    TERMS_URL: TERMS_URL, BANK_URL: BANK_URL,
    load: load, setData: setData, terms: terms, categories: categories, categoryLabel: categoryLabel,
    get: get, search: search, letters: letters, byLetter: byLetter, letterOf: letterOf,
    related: related, backlinks: backlinks, lessonUrl: lessonUrl, termUrl: termUrl, summary: summary, linkify: linkify,
    util: { norm: norm, slug: slug, esc: esc, dateKey: dateKey, dayDiff: dayDiff, shiftKey: shiftKey, rng: rng, seedFrom: seedFrom },
    flashcards: {
      KEY: FC_KEY,
      load: fcLoad, save: fcSave, reset: fcReset, card: card,
      nextState: nextState, delayLabel: delayLabel, preview: preview,
      rate: rate, add: add, due: due, unseen: unseen, queue: queue, stats: fcStats
    },
    daily: {
      KEY: DAILY_KEY, N: DAILY_N,
      loadBank: loadBank, setBank: setBank, questions: questions, pick: pick,
      load: dailyLoad, save: dailySave, reset: dailyReset,
      status: status, record: record, streak: streak, history: history, stats: dailyStats
    }
  };
})();
