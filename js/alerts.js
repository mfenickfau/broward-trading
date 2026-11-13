/* Broward Trading — js/alerts.js → BT.alerts
 *
 * Price and indicator alerts for the dashboard. The module itself never
 * touches the DOM: it stores alert definitions in localStorage (`bt.alerts`),
 * evaluates them against the latest bars/indicators and reports which ones
 * fired. Delivery is split in two:
 *   - a browser `Notification` when the student granted permission (works in
 *     the background tab, and on the home-screen PWA on Android);
 *   - an in-page toast through `BT.app.toast` when the dashboard is loaded,
 *     plus `BT.alerts.on(fn)` listeners so any page can react.
 *
 * Alert kinds (contract v0.3):
 *   price_above   last price rises to or above `value`
 *   price_below   last price falls to or below `value`
 *   rsi_above     RSI(14) closes at or above `value` (classic 70 = overbought)
 *   rsi_below     RSI(14) closes at or below `value` (classic 30 = oversold)
 *   sma_cross     the fast SMA crosses the slow SMA either way; `value` may be
 *                 "20/50" (default) or "fast/slow" to choose the pair
 *   signal_change the composite BUY/SELL/HOLD signal changes state; `value`
 *                 may be 'BUY' or 'SELL' to fire only when it becomes that
 *   rule          (v0.5) the ENTRY block of a strategy-builder rule becomes true
 *                 on the latest bar. Payload `{rule}` (BT.rules JSON); `value`
 *                 holds the rule's name for lists. Evaluated with BT.rules on
 *                 every check; silent when js/rules.js is not loaded or there
 *                 is not enough history for the rule's indicators yet.
 *
 * Semantics students should learn: an alert fires when its condition becomes
 * true, i.e. on the transition. A "price above 150" alert set while the stock
 * already trades at 160 fires once on the first check (and the UI says so);
 * after that it is "fired" and stays in the list until removed or re-armed.
 * Re-arming is strictly edge-triggered: the first check after rearm() only
 * learns whether the condition currently holds, so the alert fires again only
 * once the condition has gone false and come back true.
 * Price alerts also look at the bar's high/low, so a spike that touched your
 * level inside the bar counts, exactly like a broker's stop would trigger.
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (window.BT && window.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }

  var STORAGE_KEY = 'bt.alerts';
  var MAX_ALERTS = 50;
  var RSI_N = 14;

  var KINDS = {
    price_above: { label: 'Price rises above', short: 'Price ≥', needsValue: true, unit: '$', group: 'price',
      help: 'Fires when the last price (or a bar\'s high) reaches your level from below. Traders use it to catch breakouts above resistance without staring at the screen.' },
    price_below: { label: 'Price falls below', short: 'Price ≤', needsValue: true, unit: '$', group: 'price',
      help: 'Fires when the last price (or a bar\'s low) reaches your level from above. Set one a little under support, or at the level where your thesis would be wrong.' },
    rsi_above: { label: 'RSI rises above', short: 'RSI ≥', needsValue: true, unit: '', group: 'rsi', defaultValue: 70,
      help: 'RSI(14) at or above your level. 70 is the classic "overbought" zone: momentum is stretched, so look for a pullback or a divergence rather than chasing.' },
    rsi_below: { label: 'RSI falls below', short: 'RSI ≤', needsValue: true, unit: '', group: 'rsi', defaultValue: 30,
      help: 'RSI(14) at or below your level. 30 is the classic "oversold" zone: sellers may be exhausted, a place where mean-reversion traders start looking for entries.' },
    sma_cross: { label: 'SMA crossover (20/50)', short: 'SMA cross', needsValue: false, unit: '', group: 'trend', defaultValue: '20/50',
      help: 'Fires when the fast SMA crosses the slow one in either direction: up is a "golden cross" (bullish), down a "death cross" (bearish). Type fast/slow such as 9/21 to change the pair.' },
    signal_change: { label: 'Signal changes (BUY/SELL/HOLD)', short: 'Signal', needsValue: false, unit: '', group: 'signal',
      help: 'Fires when the composite signal on the dashboard flips state. Leave the value empty for any change, or type BUY or SELL to hear only about that one.' },
    rule: { label: 'Strategy rule entry', short: 'Rule', needsValue: false, needsRule: true, unit: '', group: 'rule',
      help: 'Fires when the entry conditions of a rule you built in the Strategy Builder all line up on the latest bar. It tells you a setup appeared; it is not a prediction, and nothing is ever bought for you.' }
  };
  var KIND_ORDER = ['price_above', 'price_below', 'rsi_above', 'rsi_below', 'sma_cross', 'signal_change', 'rule'];

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function normSymbol(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12); }
  function fmtPrice(v) {
    if (!isNum(v)) return '—';
    var dp = Math.abs(v) < 1 ? 4 : 2;
    return '$' + v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtNum(v, dp) { return isNum(v) ? v.toFixed(dp == null ? 1 : dp) : '—'; }
  function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function prev(arr) { return arr && arr.length > 1 ? arr[arr.length - 2] : null; }

  // Injectable clock (tests).
  var clock = function () { return Date.now(); };

  var storage = {
    get: function () {
      try { var raw = window.localStorage && localStorage.getItem(STORAGE_KEY); if (!raw) return null; var v = JSON.parse(raw); return Array.isArray(v) ? v : null; }
      catch (e) { return null; }
    },
    set: function (v) { try { if (window.localStorage) localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { /* private mode: ignore */ } }
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var alerts = null;      // array of alert objects, lazily loaded
  var listeners = [];     // on(fn) callbacks: fn(firedArray, {symbol})

  function load() {
    var saved = storage.get();
    alerts = (saved || []).filter(function (a) { return a && KINDS[a.kind] && a.symbol; }).map(function (a) {
      // Backfill fields added in later versions so old saved alerts keep working.
      return Object.assign({ enabled: true, firedAt: null, fired: 0, state: false, lastSignal: null, createdAt: a.createdAt || clock(), note: '' }, a);
    });
    return alerts;
  }
  function all() { if (!alerts) load(); return alerts; }
  function save() { storage.set(all()); }
  function nextId() {
    var max = 0; all().forEach(function (a) { if (a.id > max) max = a.id; });
    return max + 1;
  }

  /* ------------------------------------------------------------------ *
   * Validation & description
   * ------------------------------------------------------------------ */
  /** Parse "20/50" style SMA pairs. Returns {fast, slow} or null. */
  function parsePair(v) {
    if (v == null || v === '') return { fast: 20, slow: 50 };
    var m = String(v).trim().match(/^(\d{1,3})\s*[\/,x\- ]\s*(\d{1,3})$/);
    if (!m) return null;
    var fast = +m[1], slow = +m[2];
    if (fast < 2 || slow < 2 || fast >= slow) return null;
    return { fast: fast, slow: slow };
  }

  /** Normalise a user-supplied alert spec. Returns {ok:true, alert} or {ok:false, reason}. */
  function validate(spec) {
    spec = spec || {};
    var kind = String(spec.kind || '');
    if (!KINDS[kind]) return { ok: false, reason: 'Unknown alert kind "' + kind + '". Use one of: ' + KIND_ORDER.join(', ') + '.' };
    var symbol = normSymbol(spec.symbol);
    if (!symbol) return { ok: false, reason: 'An alert needs a symbol.' };
    var def = KINDS[kind], value = spec.value;
    if (def.needsValue) {
      var n = typeof value === 'string' ? parseFloat(value.replace(/[$,%\s]/g, '')) : value;
      if (!isNum(n)) return { ok: false, reason: T('Enter a number for "{label}".', { label: def.label }) };
      if (def.group === 'price' && n <= 0) return { ok: false, reason: 'A price level must be above zero.' };
      if (def.group === 'rsi' && (n < 0 || n > 100)) return { ok: false, reason: 'RSI runs from 0 to 100. Classic levels: 30 oversold, 70 overbought.' };
      value = def.group === 'price' ? Math.round(n * 10000) / 10000 : Math.round(n * 100) / 100;
    } else if (kind === 'sma_cross') {
      var pair = parsePair(value);
      if (!pair) return { ok: false, reason: 'Type the SMA pair as fast/slow, for example 20/50 or 9/21 (fast must be shorter).' };
      value = pair.fast + '/' + pair.slow;
    } else if (kind === 'signal_change') {
      var want = String(value == null ? '' : value).trim().toUpperCase();
      if (want && want !== 'BUY' && want !== 'SELL' && want !== 'HOLD') return { ok: false, reason: 'Leave the value empty for any change, or type BUY, SELL or HOLD.' };
      value = want || '';
    } else if (kind === 'rule') {
      var R = BT.rules;
      if (!R) return { ok: false, reason: T('Rule alerts need the strategy builder (js/rules.js) on this page.') };
      if (!spec.rule || typeof spec.rule !== 'object') return { ok: false, reason: T('Build a rule in the Strategy Builder first, then create the alert from it.') };
      var errs = R.validate(spec.rule);
      if (errs.length) return { ok: false, reason: errs[0] };
      var rule = R.normalize(spec.rule); delete rule.id;
      return { ok: true, alert: { symbol: symbol, kind: kind, value: rule.name, rule: rule, note: String(spec.note || '').slice(0, 120) } };
    }
    return { ok: true, alert: { symbol: symbol, kind: kind, value: value, note: String(spec.note || '').slice(0, 120) } };
  }

  /** One-line description of an alert, used by the list and the toast. */
  function describe(a) {
    var pair;
    switch (a.kind) {
      case 'price_above': return T('{symbol} price rises above {price}', { symbol: a.symbol, price: fmtPrice(a.value) });
      case 'price_below': return T('{symbol} price falls below {price}', { symbol: a.symbol, price: fmtPrice(a.value) });
      case 'rsi_above': return T('{symbol} RSI(14) rises above {value}', { symbol: a.symbol, value: fmtNum(a.value, 0) });
      case 'rsi_below': return T('{symbol} RSI(14) falls below {value}', { symbol: a.symbol, value: fmtNum(a.value, 0) });
      case 'sma_cross': pair = parsePair(a.value) || { fast: 20, slow: 50 }; return T('{symbol} SMA {fast} crosses SMA {slow}', { symbol: a.symbol, fast: pair.fast, slow: pair.slow });
      case 'signal_change': return a.value ? T('{symbol} signal turns {state}', { symbol: a.symbol, state: a.value }) : T('{symbol} signal changes state', { symbol: a.symbol });
      case 'rule': return T('{symbol} entry rule "{name}" lines up', { symbol: a.symbol, name: a.value || (a.rule && a.rule.name) || T('rule') });
    }
    return a.symbol + ' ' + a.kind;
  }

  /* ------------------------------------------------------------------ *
   * CRUD
   * ------------------------------------------------------------------ */
  function add(spec) {
    var v = validate(spec);
    if (!v.ok) return { status: 'rejected', reason: v.reason };
    var list = all();
    if (list.length >= MAX_ALERTS) return { status: 'rejected', reason: T('You can keep up to {max} alerts. Remove a fired one first.', { max: MAX_ALERTS }) };
    var dup = list.filter(function (a) { return a.symbol === v.alert.symbol && a.kind === v.alert.kind && String(a.value) === String(v.alert.value) && !a.firedAt && (a.kind !== 'rule' || JSON.stringify(a.rule) === JSON.stringify(v.alert.rule)); })[0];
    if (dup) return { status: 'rejected', reason: T('That alert already exists (#{id}).', { id: dup.id }), alert: dup };
    var a = Object.assign({ id: nextId(), createdAt: clock(), enabled: true, firedAt: null, fired: 0, state: false, lastSignal: null, lastValue: null }, v.alert);
    a.status = 'ok';
    list.push(a); save();
    return a;
  }

  function list(symbol) {
    var s = symbol ? normSymbol(symbol) : null;
    return all().filter(function (a) { return !s || a.symbol === s; }).map(function (a) { return Object.assign({}, a); });
  }
  function get(id) { return all().filter(function (a) { return a.id === +id; })[0] || null; }

  function remove(id) {
    var l = all(), i = -1;
    for (var k = 0; k < l.length; k++) if (l[k].id === +id) { i = k; break; }
    if (i < 0) return null;
    var removed = l.splice(i, 1)[0]; save();
    return removed;
  }
  function clear(symbol) {
    var s = symbol ? normSymbol(symbol) : null, l = all();
    var keep = l.filter(function (a) { return s && a.symbol !== s; });
    var n = l.length - keep.length;
    alerts = keep; save();
    return n;
  }
  /**
   * Put a fired alert back on watch. It fires again only on the next false→true
   * transition: `state` is set to null ("baseline unknown") so the first check
   * after re-arming just records whether the condition currently holds, without
   * firing. A price alert whose level is still breached therefore stays quiet
   * until price leaves the level and comes back, which is what "Watch again"
   * promises the student.
   */
  function rearm(id) {
    var a = get(id); if (!a) return null;
    a.enabled = true; a.firedAt = null; a.state = null; a.lastSignal = null; save();
    return Object.assign({}, a);
  }
  /**
   * Pause / resume an alert without deleting it. Resuming an alert that never
   * fired behaves like a freshly added one (fires once if already breached);
   * resuming one that has fired before behaves like rearm() (edge-triggered).
   */
  function setEnabled(id, on) {
    var a = get(id); if (!a) return null;
    a.enabled = !!on;
    if (on) { a.state = a.fired ? null : false; a.lastSignal = null; }
    save();
    return Object.assign({}, a);
  }

  /* ------------------------------------------------------------------ *
   * Evaluation
   * ------------------------------------------------------------------ */
  function rsiSeries(bars, ind) {
    if (ind && Array.isArray(ind.rsi) && ind.rsi.length === bars.length) return ind.rsi;
    if (BT.ind && BT.ind.rsi && bars.length > RSI_N) return BT.ind.rsi(bars.map(function (b) { return b.close; }), RSI_N);
    return null;
  }
  function smaSeries(bars, ind, n) {
    if (ind && Array.isArray(ind['sma' + n]) && ind['sma' + n].length === bars.length) return ind['sma' + n];
    if (BT.ind && BT.ind.sma && bars.length >= n) return BT.ind.sma(bars.map(function (b) { return b.close; }), n);
    return null;
  }
  function signalState(bars, ind) {
    if (ind && ind.signal && ind.signal.state) return ind.signal.state;         // precomputed by the caller
    if (ind && ind.sig && ind.sig.state) return ind.sig.state;
    if (BT.ind && BT.ind.signals && bars.length >= 50) { try { var s = BT.ind.signals(bars, ind || undefined); return s && s.state; } catch (e) { return null; } }
    return null;
  }

  /**
   * Evaluate one alert against the data. Returns {cond, now, detail} or null
   * when there is not enough data to say anything.
   */
  function evaluate(a, bars, ind) {
    var b = last(bars), pb = prev(bars);
    if (!b) return null;
    switch (a.kind) {
      case 'price_above': {
        var hi = isNum(b.high) ? Math.max(b.high, b.close) : b.close;
        return { cond: hi >= a.value, now: b.close, detail: T('last {price}', { price: fmtPrice(b.close) }) + (hi !== b.close && hi >= a.value ? ' ' + T('(high {price} touched the level)', { price: fmtPrice(hi) }) : '') };
      }
      case 'price_below': {
        var lo = isNum(b.low) ? Math.min(b.low, b.close) : b.close;
        return { cond: lo <= a.value, now: b.close, detail: T('last {price}', { price: fmtPrice(b.close) }) + (lo !== b.close && lo <= a.value ? ' ' + T('(low {price} touched the level)', { price: fmtPrice(lo) }) : '') };
      }
      case 'rsi_above':
      case 'rsi_below': {
        var r = rsiSeries(bars, ind), rv = r ? last(r) : null;
        if (!isNum(rv)) return null;
        var c = a.kind === 'rsi_above' ? rv >= a.value : rv <= a.value;
        return { cond: c, now: rv, detail: T('RSI {value}', { value: fmtNum(rv, 1) }) + ' — ' + (a.kind === 'rsi_above' ? T('momentum is stretched; watch for a pullback or a bearish divergence.') : T('sellers may be exhausted; mean-reversion traders look for entries here.')) };
      }
      case 'sma_cross': {
        var pair = parsePair(a.value) || { fast: 20, slow: 50 };
        var f = smaSeries(bars, ind, pair.fast), s = smaSeries(bars, ind, pair.slow);
        if (!f || !s || !pb) return null;
        var fn = last(f), sn = last(s), fp = prev(f), sp = prev(s);
        if (!isNum(fn) || !isNum(sn) || !isNum(fp) || !isNum(sp)) return null;
        var dNow = sign(fn - sn), dPrev = sign(fp - sp);
        var crossed = dNow !== 0 && dPrev !== 0 && dNow !== dPrev;
        var dir = dNow > 0 ? 'up' : 'down';
        return { cond: crossed, now: dNow, direction: dir,
          detail: crossed ? T(dir === 'up' ? 'Golden cross: SMA {fast} moved above SMA {slow} — the short-term trend turned stronger than the long-term one.' : 'Death cross: SMA {fast} moved below SMA {slow} — short-term weakness is now dragging on the longer trend.', { fast: pair.fast, slow: pair.slow }) : T(dNow > 0 ? 'SMA {fast} is above SMA {slow}' : 'SMA {fast} is below SMA {slow}', { fast: pair.fast, slow: pair.slow }) };
      }
      case 'rule': {
        var R = BT.rules;
        if (!R || !a.rule) return null;
        var ev;
        try { ev = R.evaluate(a.rule, bars); } catch (e) { return null; }
        if (!ev || !ev.ready) return null;   // indicators still warming up: say nothing yet
        var side = a.rule.side === 'short' ? 'short' : 'long';
        var sentence = '';
        try { sentence = R.describe(a.rule); } catch (e) { sentence = ''; }
        return { cond: !!ev.entry, now: ev.close, direction: side === 'short' ? 'down' : 'up',
          detail: (ev.entry ? T('The entry conditions are all true on the latest bar (close {price}).', { price: fmtPrice(ev.close) }) : T('The entry conditions are not all true yet.')) + (sentence ? ' ' + sentence : '') + ' ' + T('Practise the decision on paper; an alert is not a recommendation.') };
      }
      case 'signal_change': {
        var st = signalState(bars, ind);
        if (!st) return null;
        var changed = a.lastSignal != null && st !== a.lastSignal && (!a.value || st === a.value);
        return { cond: changed, now: st, detail: T('Signal is now {state}', { state: st }) + (a.lastSignal ? ' ' + T('(was {state})', { state: a.lastSignal }) : '') + '. ' + T('Open "Why?" on the Signal card to read which rules changed their vote.') };
      }
    }
    return null;
  }

  /**
   * check(symbol, bars, ind) → array of fired alerts (copies, with `message`).
   * Evaluates every enabled, unfired alert for `symbol`; records transitions;
   * fires toasts / Notifications for the ones that just became true.
   */
  function check(symbol, bars, ind) {
    var s = normSymbol(symbol);
    if (!s || !Array.isArray(bars) || !bars.length) return [];
    var fired = [], dirty = false;
    all().forEach(function (a) {
      if (a.symbol !== s || !a.enabled || a.firedAt) return;
      var ev = evaluate(a, bars, ind);
      if (!ev) return;
      if (a.kind === 'signal_change') {
        var first = a.lastSignal == null;
        if (a.lastSignal !== ev.now) { a.lastSignal = ev.now; dirty = true; }
        if (first) return;                                    // learn the current state first, fire on the next change
      }
      if (a.state === null) {                                 // re-armed: learn the baseline first, fire on the next transition
        a.state = !!ev.cond; dirty = true; return;
      }
      if (ev.cond && !a.state) {
        var t = clock();
        a.firedAt = t; a.fired = (a.fired || 0) + 1; a.enabled = false; a.lastValue = ev.now; a.state = true; dirty = true;
        var f = Object.assign({}, a, { title: KINDS[a.kind].short + ' · ' + a.symbol, message: describe(a) + ' — ' + ev.detail, detail: ev.detail, direction: ev.direction || null, at: t, time: last(bars).time });
        fired.push(f);
      } else if (a.state !== !!ev.cond) { a.state = !!ev.cond; dirty = true; }   // condition went false again: armed for the next transition
    });
    if (dirty) save();
    if (fired.length) notify(fired, { symbol: s });
    return fired;
  }

  /* ------------------------------------------------------------------ *
   * Delivery: toast (via BT.app when present), Notification, listeners
   * ------------------------------------------------------------------ */
  function notificationsSupported() { return typeof window.Notification === 'function' || (typeof window.Notification === 'object' && window.Notification !== null); }
  function notificationState() {
    if (!notificationsSupported()) return 'unsupported';
    try { return window.Notification.permission || 'default'; } catch (e) { return 'unsupported'; }
  }
  function notificationsEnabled() { return notificationState() === 'granted'; }

  /** Ask the browser for permission. Resolves to 'granted' | 'denied' | 'default' | 'unsupported'. */
  function requestPermission() {
    if (!notificationsSupported()) return Promise.resolve('unsupported');
    try {
      var r = window.Notification.requestPermission();
      if (r && typeof r.then === 'function') return r.then(function (p) { return p || notificationState(); }, function () { return notificationState(); });
      // Old Safari: callback style
      return new Promise(function (res) { try { window.Notification.requestPermission(function (p) { res(p || notificationState()); }); } catch (e) { res(notificationState()); } });
    } catch (e) { return Promise.resolve(notificationState()); }
  }

  function sendNotification(f) {
    if (!notificationsEnabled()) return false;
    var opts = { body: f.message, tag: 'bt-alert-' + f.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', renotify: false };
    try {
      // Inside an installed PWA with an active service worker, showNotification survives the page being backgrounded.
      var nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && nav.serviceWorker && nav.serviceWorker.ready && typeof nav.serviceWorker.ready.then === 'function') {
        nav.serviceWorker.ready.then(function (reg) {
          if (reg && reg.showNotification) reg.showNotification(f.title, opts).catch(function () { new window.Notification(f.title, opts); });
          else new window.Notification(f.title, opts);
        }, function () { new window.Notification(f.title, opts); });
      } else {
        new window.Notification(f.title, opts);
      }
      return true;
    } catch (e) { return false; }
  }

  var muted = false;
  /** Tone for the toast: bearish events are amber so they stand out from bullish ones. */
  function tone(f) { return (f.kind === 'price_below' || f.kind === 'rsi_above' || f.direction === 'down' || f.now === 'SELL') ? 'warn' : 'ok'; }
  function notify(fired, meta) {
    fired.forEach(function (f) {
      if (muted) return;
      if (BT.app && typeof BT.app.toast === 'function') {
        try { BT.app.toast(f.message, tone(f), T('Alert: {title}', { title: f.title }), 9000); } catch (e) { /* ignore */ }
      }
      sendNotification(f);   // no-op unless the student granted permission
    });
    listeners.slice().forEach(function (fn) { try { fn(fired, meta || {}); } catch (e) { /* listener error must not break the tick */ } });
  }
  function on(fn) { if (typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn); return function () { off(fn); }; }
  function off(fn) { listeners = listeners.filter(function (f) { return f !== fn; }); }

  /** Send a sample notification so the student can see what one looks like. */
  function testNotification() {
    return sendNotification({ id: 'test', title: 'Price ≥ · DEMO', message: 'This is what a Broward Trading alert looks like. Alerts are educational: no real orders are ever placed.' });
  }

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */
  BT.alerts = {
    version: '0.3.0',
    STORAGE_KEY: STORAGE_KEY,
    MAX_ALERTS: MAX_ALERTS,
    KINDS: KINDS,
    kinds: KIND_ORDER.slice(),
    add: add,
    list: list,
    get: get,
    remove: remove,
    clear: clear,
    rearm: rearm,
    setEnabled: setEnabled,
    check: check,
    evaluate: function (idOrAlert, bars, ind) { var a = typeof idOrAlert === 'object' ? idOrAlert : get(idOrAlert); return a ? evaluate(a, bars, ind) : null; },
    validate: validate,
    describe: describe,
    parsePair: parsePair,
    on: on,
    off: off,
    notify: notify,
    setMuted: function (m) { muted = !!m; },
    notificationState: notificationState,
    notificationsEnabled: notificationsEnabled,
    notificationsSupported: notificationsSupported,
    requestPermission: requestPermission,
    testNotification: testNotification,
    load: load,
    save: save,
    setClock: function (fn) { clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; },
    _reset: function () { alerts = []; save(); listeners = []; muted = false; }
  };
})();
