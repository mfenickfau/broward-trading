/* Broward Trading — js/i18n.js → BT.i18n + BT.t (v0.4)
 *
 * Site-wide translation without rewriting any page. Pages stay authored in
 * English; a dictionary per language (i18n/<code>.json) maps exact English
 * strings to translations and translatePage() swaps them in the live DOM.
 *
 *   i18n/es.json = { "ui":    { "<exact English>": "<Spanish>" },
 *                    "attrs": { "<exact English>": "<Spanish>" } }   (attrs is optional,
 *                    consulted first for placeholder/title/aria-label/alt, then ui)
 *
 * Public surface (see CONTRACTS.md → v0.4 → js/i18n.js)
 *   BT.i18n.lang()                 'en' | 'es' | …  (persisted in localStorage 'bt.lang')
 *   BT.i18n.setLang(code)          persists, sets <html lang>, loads the dictionary if needed,
 *                                  re-translates the page, fires 'bt:lang' on window → Promise
 *   BT.i18n.langs                  [{code, label, short, locale}] — extensible (addLang)
 *   BT.i18n.translatePage(root?)   walk text nodes + placeholder/title/aria-label/alt; exact
 *                                  (trimmed, whitespace-collapsed) matches are replaced and the
 *                                  original is remembered on the node so English can be restored
 *   BT.t(str, vars)                programmatic helper for JS-built strings, {name} interpolation
 *   BT.i18n.fmtNumber/fmtMoney/fmtPercent/fmtDate   Intl formatters for the active locale
 *   pure helpers (testable without a DOM): norm, interpolate, lookup, register, hasDict
 *
 * Mechanics
 *   - A MutationObserver (debounced ~40 ms) translates content inserted later (toasts,
 *     rendered tables, lesson blocks). Our own writes are discarded with takeRecords().
 *   - Skipped: <script> <style> <code> <pre> <kbd> <textarea> <svg>, anything inside
 *     .no-i18n or [translate="no"], and input *values* (never touched).
 *   - Performance: one Map lookup per text node; nodes already translated for the current
 *     language are skipped in O(1), so a 2,000-node page re-translates in a few ms.
 *   - js/nav.js injects this file before the page's own scripts when a page does not
 *     include it itself, so BT.t exists for every UI module. The fetched dictionary is
 *     cached in localStorage ('bt.i18n.<code>') and registered synchronously on the next
 *     load, so BT.t() translates JS-built strings from the first render.
 *
 * Plain ES2020, no imports; loadable in Node for tests (no DOM needed for the pure parts).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  var hasDOM = typeof document !== 'undefined' && !!document.createElement;

  var STORE_KEY = 'bt.lang';
  var DEFAULT = 'en';
  var LANGS = [
    { code: 'en', label: 'English', short: 'EN', locale: 'en-US' },
    { code: 'es', label: 'Español', short: 'ES', locale: 'es-419' }
  ];
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SKIP_TAG = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, KBD: 1, TEXTAREA: 1, NOSCRIPT: 1, SVG: 1, svg: 1, TEMPLATE: 1 };
  var LETTER = /[A-Za-zÀ-ɏ]/;

  /* ------------------------------------------------------------------ *
   * Pure helpers
   * ------------------------------------------------------------------ */
  /** Exact-match key: trimmed, inner whitespace (incl. nbsp) collapsed to one space. */
  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  /** Replace {name} placeholders from vars; unknown placeholders are left as they are. */
  function interpolate(tpl, vars) {
    tpl = String(tpl == null ? '' : tpl);
    if (!vars || typeof vars !== 'object') return tpl;
    return tpl.replace(/\{([A-Za-z_][\w]*)\}/g, function (m, k) {
      var v = vars[k];
      return v === undefined || v === null ? m : String(v);
    });
  }

  // code -> { ui: Map, attrs: Map }
  var dicts = {};
  var current = DEFAULT;
  var gen = 0;   // bumped when a dictionary is replaced, so already-translated nodes are revisited
  var loading = {};
  var baseUrl = 'i18n/';

  if (hasDOM && document.currentScript && document.currentScript.src) {
    try { baseUrl = document.currentScript.src.replace(/[^/]*$/, '') + '../i18n/'; } catch (e) { /* keep default */ }
  }

  function langInfo(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return null;
  }
  function addLang(info) {
    if (!info || !info.code) return false;
    if (langInfo(info.code)) return false;
    LANGS.push({ code: info.code, label: info.label || info.code, short: info.short || info.code.toUpperCase(), locale: info.locale || info.code });
    return true;
  }
  function toMap(obj) {
    var m = new Map();
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (typeof v !== 'string') return;
        var nk = norm(k);
        if (nk) m.set(nk, v);
      });
    }
    return m;
  }
  /** Register a dictionary object for a language (merges into an existing one). */
  function register(code, dict) {
    if (!code || !dict || typeof dict !== 'object') return false;
    var d = dicts[code] || (dicts[code] = { ui: new Map(), attrs: new Map() });
    gen++;
    toMap(dict.ui).forEach(function (v, k) { d.ui.set(k, v); });
    toMap(dict.attrs).forEach(function (v, k) { d.attrs.set(k, v); });
    if (!langInfo(code)) addLang({ code: code });
    return true;
  }
  function hasDict(code) { return !!dicts[code] && dicts[code].ui.size > 0; }
  /**
   * Translation for an exact English string in `lang` (default: active language),
   * or null when there is none. kind 'attr' consults the attrs table first.
   */
  function lookup(str, lang, kind) {
    lang = lang || current;
    if (lang === DEFAULT) return null;
    var d = dicts[lang];
    if (!d) return null;
    var key = norm(str);
    if (!key) return null;
    var v;
    if (kind === 'attr') { v = d.attrs.get(key); if (v != null) return v; }
    v = d.ui.get(key);
    return v == null ? null : v;
  }
  /** Programmatic helper: BT.t('Bought {qty} {symbol}', {qty: 10, symbol: 'AAPL'}). */
  function t(str, vars) {
    var tr = lookup(str);
    return interpolate(tr == null ? str : tr, vars);
  }

  /* ------------------------------------------------------------------ *
   * Intl formatting for the active locale
   * ------------------------------------------------------------------ */
  var fmtCache = {};
  function locale() { var li = langInfo(current); return li ? li.locale : 'en-US'; }
  function numberFormat(opts) {
    var key = locale() + '|' + JSON.stringify(opts || {});
    if (!fmtCache[key]) {
      try { fmtCache[key] = new Intl.NumberFormat(locale(), opts); }
      catch (e) { fmtCache[key] = { format: function (n) { return String(n); } }; }
    }
    return fmtCache[key];
  }
  function fmtNumber(n, opts) {
    if (n == null || isNaN(n)) return '—';
    return numberFormat(opts || { maximumFractionDigits: 2 }).format(+n);
  }
  function fmtMoney(n, opts) {
    if (n == null || isNaN(n)) return '—';
    var o = Object.assign({ style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }, opts || {});
    return numberFormat(o).format(+n);
  }
  function fmtPercent(n, opts) {
    if (n == null || isNaN(n)) return '—';
    var o = Object.assign({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }, opts || {});
    return numberFormat(o).format(+n / 100);
  }
  function fmtDate(d, opts) {
    if (d == null) return '—';
    var date = d instanceof Date ? d : (typeof d === 'number' ? new Date(d < 1e12 ? d * 1000 : d) : new Date(String(d).length === 10 ? d + 'T00:00:00' : d));
    if (isNaN(date.getTime())) return String(d);
    var key = 'd|' + locale() + '|' + JSON.stringify(opts || {});
    if (!fmtCache[key]) {
      try { fmtCache[key] = new Intl.DateTimeFormat(locale(), opts || { year: 'numeric', month: 'short', day: 'numeric' }); }
      catch (e) { fmtCache[key] = { format: function (x) { return x.toDateString(); } }; }
    }
    return fmtCache[key].format(date);
  }

  /* ------------------------------------------------------------------ *
   * Storage
   * ------------------------------------------------------------------ */
  function readStored() {
    try {
      var v = root.localStorage && root.localStorage.getItem(STORE_KEY);
      if (!v) return '';
      try { v = JSON.parse(v); } catch (e) { /* bare */ }
      return typeof v === 'string' && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(v) ? v : '';
    } catch (e) { return ''; }
  }
  function writeStored(code) {
    try {
      if (code && code !== DEFAULT) root.localStorage.setItem(STORE_KEY, JSON.stringify(code));
      else root.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* storage unavailable: applies to this view only */ }
  }

  /* ------------------------------------------------------------------ *
   * Dictionary loading (fetch i18n/<code>.json; window.BT_I18N[code] wins)
   * ------------------------------------------------------------------ */
  /* A copy of the last fetched dictionary is kept in localStorage ('bt.i18n.<code>') so
   * that on the next page load it is registered synchronously, before the page's own
   * scripts run: BT.t() then translates JS-built strings from the very first render
   * instead of only after the fetch. The file is still re-fetched in the background
   * (HTTP cache / service worker make that cheap) and the copy refreshed when it changed. */
  var CACHE_KEY = 'bt.i18n.';
  function readCache(code) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(CACHE_KEY + code);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && obj.dict && obj.dict.ui ? obj : null;
    } catch (e) { return null; }
  }
  function writeCache(code, json) {
    try { root.localStorage.setItem(CACHE_KEY + code, JSON.stringify({ at: Date.now(), dict: { ui: json.ui || {}, attrs: json.attrs || {}, _meta: json._meta || null } })); }
    catch (e) { /* quota or private mode: translations still work for this view */ }
  }
  function sameMeta(a, b) {
    try { return JSON.stringify(a && a._meta) === JSON.stringify(b && b._meta) && Object.keys(a.ui || {}).length === Object.keys(b.ui || {}).length; } catch (e) { return false; }
  }
  function fetchDict(code) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(baseUrl + code + '.json', { cache: 'default' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) { return json && json.ui ? json : null; })
      .catch(function () { return null; });
  }
  function load(code) {
    if (code === DEFAULT) return Promise.resolve(true);
    if (hasDict(code)) return Promise.resolve(true);
    if (loading[code]) return loading[code];
    var inline = root.BT_I18N && root.BT_I18N[code];
    if (inline) { register(code, inline); return Promise.resolve(true); }
    var cached = readCache(code);
    if (cached) {
      register(code, cached.dict);
      // Stale-while-revalidate: refresh the copy when the published file changed.
      fetchDict(code).then(function (json) {
        if (!json || sameMeta(json, cached.dict)) return;
        dicts[code] = null; register(code, json); writeCache(code, json);
        if (current === code && hasDOM) { try { translatePage(); } catch (e) { /* ignore */ } }
      });
      return Promise.resolve(true);
    }
    var p = fetchDict(code)
      .then(function (json) { if (!json) return false; register(code, json); writeCache(code, json); return true; })
      .then(function (ok) { delete loading[code]; return ok; });
    loading[code] = p;
    return p;
  }

  /* ------------------------------------------------------------------ *
   * DOM translation
   * ------------------------------------------------------------------ */
  var applying = false;
  var observer = null;
  var pending = [];
  var flushTimer = null;
  var titleState = null;   // {orig, out, lang} for document.title

  function skipEl(el) {
    if (SKIP_TAG[el.nodeName]) return true;
    var cl = el.classList;
    if (cl && cl.contains('no-i18n')) return true;
    if (el.getAttribute && el.getAttribute('translate') === 'no') return true;
    return false;
  }
  function insideSkipped(node) {
    var el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el.nodeType === 1) { if (skipEl(el)) return true; el = el.parentNode; }
    return false;
  }
  /** Translate one text node (or restore it when lang is English / no translation). */
  function translateText(node, lang, dict) {
    var cur = node.nodeValue;
    var st = node.__bt;
    if (st) {
      if (st.out !== cur) st = null;                 // someone rewrote it: treat as fresh English
      else if (st.lang === lang && st.gen === gen) return;   // already translated with this dictionary
    }
    var src = st ? st.orig : cur;
    if (!dict) { if (st) { node.nodeValue = src; node.__bt = null; } return; }
    if (!LETTER.test(src)) return;
    var key = norm(src);
    var tr = key ? dict.ui.get(key) : undefined;
    if (tr == null) { if (st) { node.nodeValue = src; node.__bt = null; } return; }
    var lead = /^\s*/.exec(src)[0], trail = /\s*$/.exec(src)[0];
    var out = lead + tr + trail;
    node.nodeValue = out;
    node.__bt = { orig: src, out: out, lang: lang, gen: gen };
  }
  function translateAttrs(el, lang, dict) {
    var st = el.__btA;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var rec = st && st[a];
      var cur = el.getAttribute(a);
      if (cur == null) { if (rec) delete st[a]; continue; }
      if (rec) {
        if (rec.out !== cur) rec = null;
        else if (rec.lang === lang && rec.gen === gen) continue;
      }
      var src = rec ? rec.orig : cur;
      if (!dict) { if (rec) { el.setAttribute(a, src); delete st[a]; } continue; }
      if (!LETTER.test(src)) continue;
      var key = norm(src), tr;
      if (key) { tr = dict.attrs.get(key); if (tr == null) tr = dict.ui.get(key); }
      if (tr == null) { if (rec) { el.setAttribute(a, src); delete st[a]; } continue; }
      el.setAttribute(a, tr);
      if (!st) st = el.__btA = {};
      st[a] = { orig: src, out: tr, lang: lang, gen: gen };
    }
    // Visible button labels held in value= (never other inputs' values).
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) {
      var vrec = st && st.value, vcur = el.getAttribute('value');
      if (vcur != null) {
        if (vrec && vrec.out === vcur && vrec.lang === lang && vrec.gen === gen) return;
        var vsrc = vrec && vrec.out === vcur ? vrec.orig : vcur;
        var vtr = dict && LETTER.test(vsrc) ? dict.ui.get(norm(vsrc)) : null;
        if (vtr == null) { if (vrec && vrec.out === vcur) { el.setAttribute('value', vsrc); delete st.value; } return; }
        el.setAttribute('value', vtr);
        if (!st) st = el.__btA = {};
        st.value = { orig: vsrc, out: vtr, lang: lang, gen: gen };
      }
    }
  }
  /** Translate (or restore) a node and everything below it. */
  function translateTree(node, lang) {
    if (!node) return 0;
    lang = lang || current;
    var dict = lang === DEFAULT ? null : (dicts[lang] || null);
    var count = 0;
    if (node.nodeType === 3) {
      if (!insideSkipped(node)) { translateText(node, lang, dict); count++; }
      return count;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return 0;
    if (node.nodeType === 1) {
      if (insideSkipped(node)) return 0;
      translateAttrs(node, lang, dict);
    }
    var doc = node.ownerDocument || node;
    var NF = root.NodeFilter;
    if (!doc.createTreeWalker || !NF) return 0;
    var walker = doc.createTreeWalker(node, NF.SHOW_ELEMENT | NF.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return skipEl(n) ? NF.FILTER_REJECT : NF.FILTER_ACCEPT;
        return NF.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) { translateText(n, lang, dict); count++; }
      else translateAttrs(n, lang, dict);
    }
    return count;
  }
  function translateTitle(lang) {
    if (!hasDOM) return;
    var dict = lang === DEFAULT ? null : dicts[lang];
    var cur = document.title;
    if (titleState && titleState.out !== cur) titleState = null;
    var src = titleState ? titleState.orig : cur;
    var tr = dict ? dict.ui.get(norm(src)) : null;
    if (tr == null) { if (titleState) { document.title = src; titleState = null; } return; }
    if (titleState && titleState.lang === lang && titleState.out === cur && titleState.gen === gen) return;
    document.title = tr;
    titleState = { orig: src, out: tr, lang: lang, gen: gen };
  }
  /** Translate the whole page (or a subtree) for the active language. Returns text nodes visited. */
  function translatePage(rootNode) {
    if (!hasDOM) return 0;
    var target = rootNode || document.body;
    if (!target) return 0;
    applying = true;
    var n = 0;
    try {
      n = translateTree(target, current);
      if (!rootNode || rootNode === document.body || rootNode === document) translateTitle(current);
    } finally {
      if (observer) observer.takeRecords();
      applying = false;
    }
    return n;
  }

  /* MutationObserver: translate what pages render later (debounced, batched). */
  function flush() {
    flushTimer = null;
    var nodes = pending; pending = [];
    if (current === DEFAULT) return;
    applying = true;
    try {
      var seen = new Set();
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || seen.has(n) || !n.isConnected) continue;
        seen.add(n);
        translateTree(n, current);
      }
    } finally {
      if (observer) observer.takeRecords();
      applying = false;
    }
  }
  function onMutations(records) {
    if (applying || current === DEFAULT) return;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) pending.push(r.addedNodes[j]);
      } else pending.push(r.target);
    }
    if (pending.length && !flushTimer) flushTimer = setTimeout(flush, 40);
  }
  function startObserver() {
    if (!hasDOM || observer || typeof root.MutationObserver !== 'function' || !document.documentElement) return;
    observer = new root.MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
  }
  function stopObserver() {
    if (!observer) return;
    observer.disconnect(); observer = null; pending = [];
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  /* ------------------------------------------------------------------ *
   * Language switching
   * ------------------------------------------------------------------ */
  function applyHtmlLang(code) {
    if (!hasDOM || !document.documentElement) return;
    document.documentElement.setAttribute('lang', code);
    document.documentElement.setAttribute('data-lang', code);
  }
  function notify() {
    try { root.dispatchEvent(new CustomEvent('bt:lang', { detail: { lang: current, info: langInfo(current) } })); } catch (e) { /* old browser */ }
  }
  function apply() {
    applyHtmlLang(current);
    if (current === DEFAULT) { translatePage(); stopObserver(); }
    else { startObserver(); translatePage(); }
    notify();
  }
  /**
   * Switch language. Returns a Promise resolving to true when the page is translated,
   * false when the dictionary could not be loaded (English stays, choice still saved).
   */
  function setLang(code) {
    code = String(code || DEFAULT).toLowerCase();
    if (!langInfo(code)) return Promise.resolve(false);
    var changed = code !== current;
    current = code;
    writeStored(code);
    if (!hasDOM) { notify(); return Promise.resolve(true); }
    applyHtmlLang(code);
    if (code === DEFAULT) { apply(); return Promise.resolve(true); }
    return load(code).then(function (ok) {
      if (current !== code) return false;         // superseded by a later call
      if (!ok) { if (changed) notify(); return false; }
      if (document.readyState === 'loading') {
        return new Promise(function (res) { document.addEventListener('DOMContentLoaded', function () { apply(); res(true); }, { once: true }); });
      }
      apply();
      return true;
    });
  }
  function lang() { return current; }
  /** The next language in the list after the active one (for a cycling toggle). */
  function nextLang() {
    var i = 0;
    for (; i < LANGS.length; i++) if (LANGS[i].code === current) break;
    return LANGS[(i + 1) % LANGS.length];
  }

  BT.i18n = {
    DEFAULT: DEFAULT,
    langs: LANGS,
    addLang: addLang,
    info: langInfo,
    lang: lang,
    setLang: setLang,
    next: nextLang,
    load: load,
    register: register,
    hasDict: hasDict,
    norm: norm,
    interpolate: interpolate,
    lookup: lookup,
    t: t,
    translatePage: translatePage,
    translate: function (node) { return translateTree(node, current); },
    fmtNumber: fmtNumber,
    fmtMoney: fmtMoney,
    fmtPercent: fmtPercent,
    fmtDate: fmtDate,
    locale: locale,
    stored: readStored,
    ready: Promise.resolve(true)
  };
  BT.t = t;

  /* ------------------------------------------------------------------ *
   * Boot: honour the saved language as early as possible
   * ------------------------------------------------------------------ */
  var stored = readStored();
  if (stored && langInfo(stored) && stored !== DEFAULT) {
    current = stored;
    if (hasDOM) {
      applyHtmlLang(stored);
      BT.i18n.ready = load(stored).then(function (ok) {
        if (!ok || current !== stored) return false;
        if (document.readyState === 'loading') {
          return new Promise(function (res) { document.addEventListener('DOMContentLoaded', function () { apply(); res(true); }, { once: true }); });
        }
        apply();
        return true;
      });
    }
  }
})();
