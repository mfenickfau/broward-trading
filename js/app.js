/* Broward Trading — js/app.js → BT.app (dashboard UI, v0.2)
 *
 * Wires the dashboard page (index.html) onto the shared modules:
 *   BT.ind    indicators, patterns and the composite signal
 *   BT.data   live/demo market data, provider settings, NYSE clock
 *   BT.paper  the paper-trading account (orders, fills, P&L)
 *
 * Everything the student sees on the dashboard lives here: the chart stack and
 * its overlays/panes, the watchlist, symbol search, the signal card, the trade
 * ticket with inline confirmation, open orders, the account summary, the data
 * settings modal, keyboard shortcuts and the first-run tour.
 *
 * v0.5: account switcher (Main / Replay / each joined league, league rules checked with
 * BT.leagues.validateOrder before every order), a "Plan this trade" panel (BT.risk) whose stop and
 * target are saved on the order meta, coach notes after fills (BT.coach), XP (BT.xp) and a
 * semi-auto paper mode that PROPOSES trades from a saved BT.rules rule and never executes on its own.
 * Every optional module is guarded: the dashboard works without any of them.
 *
 * Plain ES2020, no imports, no framework. Load after lightweight-charts and
 * the three modules above. Exposes a small BT.app surface for other pages,
 * tests and course exercises (BT.app.setSymbol, BT.app.load, BT.app.state()).
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (window.BT && window.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }
  /* Active Intl locale ('en-US' / 'es-419') when js/i18n.js is loaded, else the browser default. */
  function loc() { try { return BT.i18n && typeof BT.i18n.locale === 'function' ? BT.i18n.locale() : undefined; } catch (e) { return undefined; } }
  var LW = window.LightweightCharts;
  var ind = BT.ind, data = BT.data, paper = BT.paper;
  var alerts = BT.alerts || null;                       // js/alerts.js (v0.3); the dashboard still works without it

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: ignore */ } }
  };
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v, dp) {
    if (v == null || !isFinite(v)) return '—';
    if (dp == null) dp = Math.abs(v) < 1 ? 4 : 2;
    return v.toLocaleString(loc(), { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };
  var money = function (v) { return (v < 0 ? '−' : '') + '$' + fmt(Math.abs(v), 2); };
  var signed = function (v, suffix) { return (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + fmt(Math.abs(v), 2) + (suffix || ''); };
  var pct = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; };
  var cls = function (v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };
  var isTyping = function (el) { return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };

  if (!LW || !ind || !data || !paper) {
    document.body.insertAdjacentHTML('afterbegin', '<div class="callout danger" style="margin:16px">' + esc(T('The dashboard could not start: a required script (lightweight-charts, indicators.js, data.js or paper.js) did not load. Check your connection and reload.')) + '</div>');
    return;
  }

  /* ------------------------------------------------------------------ *
   * Toasts
   * ------------------------------------------------------------------ */
  function toast(msg, kind, title, ms) {
    var host = $('toasts'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(T(title)) + '</b>' : '') + esc(T(msg)) + '</div><button class="close" aria-label="' + esc(T('Dismiss')) + '">✕</button>';
    var kill = function () { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 220); };
    el.querySelector('.close').onclick = kill;
    host.appendChild(el);
    while (host.children.length > 4) host.firstChild.remove();
    setTimeout(kill, ms || 4500);
  }

  /* ------------------------------------------------------------------ *
   * Persistent UI state
   * ------------------------------------------------------------------ */
  var INTERVALS = ['1day', '1h', '15min', '5min'];
  var LIMIT = { '1day': 400, '1h': 390, '15min': 390, '5min': 390 };
  var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN'];
  var MAX_WATCHLIST = 14;

  var symbol = String(store.get('bt.sym', 'AAPL') || 'AAPL').toUpperCase();
  var tf = store.get('bt.tf', '1day'); if (INTERVALS.indexOf(tf) < 0) tf = '1day';
  var ov = Object.assign({ sma20: true, sma50: true, ema9: false, ema21: false, vwap: false, bb: false, ichi: false, fib: false, sr: true, pat: true, sig: true }, store.get('bt.ov', {}));
  var panes = Object.assign({ rsi: true, macd: true, stoch: false, adx: false, obv: false, atr: false }, store.get('bt.panes', {}));
  var watchlist = store.get('bt.watchlist', null);
  if (!Array.isArray(watchlist)) watchlist = DEFAULT_WATCHLIST.slice();
  var savedLines = store.get('bt.lines', {});          // { 'SYM|interval': [[{time,value},{time,value}], ...] }

  var bars = [], I = null, sig = null, sigSeries = [], live = false, dataInfo = {};
  var loadSeq = 0, tickTimer = null, pollTimer = null, wlTimer = null;
  var wlQuotes = {};                                    // SYM → {price, prevClose, time}
  var wlPrev = {};                                      // SYM → {prevClose, day}

  /* ------------------------------------------------------------------ *
   * Theme
   * ------------------------------------------------------------------ */
  (function initTheme() {
    var saved = store.get('bt.theme', null);
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  })();
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  $('themeToggle').onclick = function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('bt.theme', next);
    applyTheme();
  };
  if (window.matchMedia) {
    try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (!store.get('bt.theme', null)) applyTheme(); }); } catch (e) { /* old Safari */ }
  }

  /* ------------------------------------------------------------------ *
   * Charts
   * ------------------------------------------------------------------ */
  var COLORS = { sma20: '--s1', sma50: '--s2', ema9: '--s3', ema21: '--s4', vwap: '--s5', bb: '--muted', tenkan: '--s5', kijun: '--s2', senkouA: '--up', senkouB: '--down', chikou: '--s6' };

  function chartTheme() {
    return {
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--muted'), fontFamily: css('--mono') },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: tf !== '1day', secondsVisible: false },
      crosshair: { mode: 0 }
    };
  }
  function mkChart(el, extra) { return LW.createChart(el, Object.assign({ autoSize: true, handleScale: { axisPressedMouseMove: true } }, chartTheme(), extra || {})); }
  var lineOpts = function (color, extra) { return Object.assign({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, extra || {}); };

  var chP = mkChart($('price'));
  var candles = chP.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down'), borderVisible: false });
  var vol = chP.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
  chP.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  chP.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });

  var overlay = {};                                      // key → line series (lazy)
  function line(key, colorVar, extra) {
    if (!overlay[key]) overlay[key] = chP.addLineSeries(lineOpts(css(colorVar || COLORS[key] || '--muted'), extra));
    return overlay[key];
  }
  var priceLines = [];                                   // S/R + Fib createPriceLine handles
  var alertLines = [];                                   // price-alert createPriceLine handles (js/alerts.js)
  var trendSeries = [];                                  // drawn trend lines (series)
  var drawing = false, drawPts = [];

  /* ---- sub-panes: created on demand, removed when toggled off ---- */
  var PANE_DEFS = {
    rsi: {
      title: 'RSI (14)', build: function (ch) {
        var s = ch.addLineSeries(lineOpts(css('--purple'), { lastValueVisible: true, priceLineVisible: false }));
        s.createPriceLine({ price: 70, color: css('--down'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: T('overbought') });
        s.createPriceLine({ price: 30, color: css('--up'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: T('oversold') });
        return { update: function () { s.setData(ind.toLineData(bars, I.rsi)); }, value: function (i) { return I.rsi[i] == null ? '—' : I.rsi[i].toFixed(1); } };
      }
    },
    macd: {
      title: 'MACD (12, 26, 9)', build: function (ch) {
        var h = ch.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        var m = ch.addLineSeries(lineOpts(css('--s2'))), sg = ch.addLineSeries(lineOpts(css('--s1')));
        return {
          update: function () {
            var up = css('--up'), dn = css('--down');
            h.setData(bars.map(function (b, i) { var v = I.macd.hist[i]; return v == null ? null : { time: b.time, value: v, color: v >= 0 ? up : dn }; }).filter(Boolean));
            m.setData(ind.toLineData(bars, I.macd.macd)); sg.setData(ind.toLineData(bars, I.macd.signal));
          },
          value: function (i) { return I.macd.macd[i] == null ? '—' : T('{macd} · signal {signal} · hist {hist}', { macd: I.macd.macd[i].toFixed(2), signal: I.macd.signal[i] == null ? '—' : I.macd.signal[i].toFixed(2), hist: I.macd.hist[i] == null ? '—' : I.macd.hist[i].toFixed(2) }); }
        };
      }
    },
    stoch: {
      title: 'Stochastic (14, 3)', build: function (ch) {
        var k = ch.addLineSeries(lineOpts(css('--s2'))), d = ch.addLineSeries(lineOpts(css('--s1')));
        k.createPriceLine({ price: 80, color: css('--down'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        k.createPriceLine({ price: 20, color: css('--up'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        return {
          update: function () { k.setData(ind.toLineData(bars, I.stochastic.k)); d.setData(ind.toLineData(bars, I.stochastic.d)); },
          value: function (i) { return I.stochastic.k[i] == null ? '—' : T('%K {k} · %D {d}', { k: I.stochastic.k[i].toFixed(1), d: I.stochastic.d[i] == null ? '—' : I.stochastic.d[i].toFixed(1) }); }
        };
      }
    },
    adx: {
      title: 'ADX (14)', build: function (ch) {
        var a = ch.addLineSeries(lineOpts(css('--fg'), { lineWidth: 2 })), p = ch.addLineSeries(lineOpts(css('--up'))), m = ch.addLineSeries(lineOpts(css('--down')));
        a.createPriceLine({ price: 25, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: T('trending') });
        return {
          update: function () { a.setData(ind.toLineData(bars, I.adx.adx)); p.setData(ind.toLineData(bars, I.adx.plusDI)); m.setData(ind.toLineData(bars, I.adx.minusDI)); },
          value: function (i) { var v = I.adx.adx[i]; return v == null ? '—' : T(v >= 25 ? '{v} strong trend · +DI {p} · −DI {m}' : v < 20 ? '{v} no trend · +DI {p} · −DI {m}' : '{v} building · +DI {p} · −DI {m}', { v: v.toFixed(1), p: I.adx.plusDI[i] == null ? '—' : I.adx.plusDI[i].toFixed(0), m: I.adx.minusDI[i] == null ? '—' : I.adx.minusDI[i].toFixed(0) }); }
        };
      }
    },
    obv: {
      title: 'On-Balance Volume', build: function (ch) {
        var s = ch.addLineSeries(lineOpts(css('--teal'), { priceFormat: { type: 'volume' } }));
        return { update: function () { s.setData(ind.toLineData(bars, I.obv)); }, value: function (i) { var v = I.obv[i]; return v == null ? '—' : (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v.toFixed(0)); } };
      }
    },
    atr: {
      title: 'ATR (14)', build: function (ch) {
        var s = ch.addLineSeries(lineOpts(css('--warn'), { lastValueVisible: true }));
        return { update: function () { s.setData(ind.toLineData(bars, I.atr)); }, value: function (i) { var v = I.atr[i]; return v == null ? '—' : (bars[i] ? T('{v} ({pct}% of price)', { v: fmt(v), pct: (v / bars[i].close * 100).toFixed(2) }) : fmt(v)); } };
      }
    }
  };
  var activePanes = {};                                  // key → {el, chart, api, tagEl}

  function allCharts() { return [chP].concat(Object.keys(activePanes).map(function (k) { return activePanes[k].chart; })); }
  var syncing = false;
  function syncFrom(src) {
    return function (range) {
      if (syncing || !range) return;
      syncing = true;
      allCharts().forEach(function (c) { if (c !== src) c.timeScale().setVisibleLogicalRange(range); });
      syncing = false;
    };
  }
  chP.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(chP));

  function addPane(key) {
    if (activePanes[key] || !PANE_DEFS[key]) return;
    var def = PANE_DEFS[key];
    var el = document.createElement('div');
    el.className = 'pane sub'; el.id = 'pane-' + key;
    el.innerHTML = '<div class="tag">' + esc(T(def.title)) + ' <b></b></div><button class="pane-close" type="button" title="' + esc(T('Hide this pane')) + '" aria-label="' + esc(T('Hide {title}', { title: T(def.title) })) + '">✕</button>';
    $('subpanes').appendChild(el);
    var chart = mkChart(el, { rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } } });
    var api = def.build(chart);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(chart));
    activePanes[key] = { el: el, chart: chart, api: api, tagEl: el.querySelector('.tag b') };
    el.querySelector('.pane-close').onclick = function () { togglePane(key, false); };
    if (I) { api.update(); updatePaneTags(bars.length - 1); describePriceChart(); }
    var r = chP.timeScale().getVisibleLogicalRange(); if (r) chart.timeScale().setVisibleLogicalRange(r);
  }
  function removePane(key) {
    var p = activePanes[key]; if (!p) return;
    p.chart.remove(); p.el.remove(); delete activePanes[key];
  }
  function togglePane(key, on) {
    panes[key] = on == null ? !panes[key] : !!on;
    store.set('bt.panes', panes);
    $$('.pn').forEach(function (b) { if (b.dataset.pn === key) b.classList.toggle('on', panes[key]); });
    if (panes[key]) addPane(key); else removePane(key);
  }
  function updatePaneTags(i) {
    if (!I || i == null || i < 0 || i >= bars.length) return;
    Object.keys(activePanes).forEach(function (k) { activePanes[k].tagEl.textContent = activePanes[k].api.value(i); });
  }

  function applyTheme() {
    var th = chartTheme();
    allCharts().forEach(function (c) { c.applyOptions(th); });
    candles.applyOptions({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down') });
    Object.keys(overlay).forEach(function (k) { if (COLORS[k]) overlay[k].applyOptions({ color: css(COLORS[k]) }); });
    // sub-pane series colours are baked in at build time: rebuild them
    Object.keys(activePanes).forEach(function (k) { removePane(k); addPane(k); });
    if (bars.length) renderSeries();
  }

  /* ------------------------------------------------------------------ *
   * Indicators & rendering
   * ------------------------------------------------------------------ */
  function compute() {
    I = ind.computeAll(bars);
    sig = ind.signals(bars, I);
    sigSeries = ind.signalSeries(bars, I);
  }

  var timeIndex = {};
  function reindex() { timeIndex = {}; for (var i = 0; i < bars.length; i++) timeIndex[String(bars[i].time)] = i; }
  /** lightweight-charts reports daily times as {year, month, day}; bring them back to our 'YYYY-MM-DD' strings. */
  function normTime(t) {
    if (t && typeof t === 'object' && t.year) return t.year + '-' + (t.month < 10 ? '0' : '') + t.month + '-' + (t.day < 10 ? '0' : '') + t.day;
    return t;
  }
  function indexOfTime(t) { var i = timeIndex[String(normTime(t))]; return i == null ? -1 : i; }

  /** Time stamps for bars that do not exist yet (Ichimoku cloud projection). */
  function futureTime(k) {
    var last = bars[bars.length - 1];
    if (typeof last.time === 'string') { var d = last.time; for (var j = 0; j < k; j++) d = data.calendar.nextTradingDay(d); return d; }
    var step = bars.length > 1 ? Math.max(60, last.time - bars[bars.length - 2].time) : data.INTERVAL_SECONDS[tf] || 300;
    return last.time + step * k;
  }

  var OV_NAMES = { sma20: 'SMA 20', sma50: 'SMA 50', ema9: 'EMA 9', ema21: 'EMA 21', vwap: 'VWAP', bb: 'Bollinger Bands', ichi: 'Ichimoku', fib: 'Fibonacci', sr: 'support and resistance', pat: 'candlestick patterns', sig: 'signal arrows' };
  /** Text alternative for the price chart (role="img" via BT.a11y), refreshed on every render. */
  function describePriceChart() {
    if (!BT.a11y || !bars.length) return;
    var last = bars[bars.length - 1], prev = bars.length > 1 ? bars[bars.length - 2] : null;
    var chg = prev && prev.close ? (last.close - prev.close) / prev.close * 100 : null;
    var ons = Object.keys(ov).filter(function (k) { return ov[k]; });
    var txt = T('{symbol} {tf} candlestick chart, {n} bars, last close {close}', { symbol: symbol, tf: tfLabel(tf), n: bars.length, close: money(last.close) }) +
      (chg == null ? '' : ', ' + (chg >= 0 ? T('up {pct} versus the previous bar', { pct: Math.abs(chg).toFixed(2) + '%' }) : T('down {pct} versus the previous bar', { pct: Math.abs(chg).toFixed(2) + '%' }))) +
      (ons.length ? '. ' + T('Overlays: {list}', { list: ons.map(function (k) { return T(OV_NAMES[k] || k); }).join(', ') }) : '') + '.';
    BT.a11y.describeChart($('price'), txt);
    Object.keys(activePanes).forEach(function (k) {
      var p = activePanes[k];
      BT.a11y.describeChart(p.el, T('{title} pane for {symbol}: {value}', { title: T(PANE_DEFS[k].title), symbol: symbol, value: (p.tagEl.textContent || '').trim() || '—' }));
    });
  }

  function renderSeries() {
    if (!bars.length || !I) return;
    var up = css('--up'), dn = css('--down');
    candles.setData(bars);
    describePriceChart();
    vol.setData(bars.map(function (b) { return { time: b.time, value: b.volume || 0, color: (b.close >= b.open ? up : dn) + '55' }; }));

    var L = function (key, arr, on, colorVar, extra) { var s = line(key, colorVar, extra); s.setData(on ? ind.toLineData(bars, arr) : []); };
    L('sma20', I.sma20, ov.sma20); L('sma50', I.sma50, ov.sma50); L('ema9', I.ema9, ov.ema9); L('ema21', I.ema21, ov.ema21);
    L('vwap', I.vwap, ov.vwap, '--s5', { lineWidth: 2 });
    L('bbU', I.bollinger.upper, ov.bb, '--muted', { lineStyle: 2 }); L('bbM', I.bollinger.middle, ov.bb && !ov.sma20, '--muted', { lineStyle: 1 }); L('bbL', I.bollinger.lower, ov.bb, '--muted', { lineStyle: 2 });

    // Ichimoku: tenkan/kijun on the bar, cloud shifted forward (incl. 26 future bars), chikou shifted back
    var ic = I.ichimoku;
    L('tenkan', ic.tenkan, ov.ichi, '--s5'); L('kijun', ic.kijun, ov.ichi, '--s2', { lineWidth: 2 }); L('chikou', ic.shifted.chikou, ov.ichi, '--s6', { lineStyle: 3 });
    var cloud = function (key, shiftedArr, futureKey, colorVar) {
      var s = line(key, colorVar, { lineStyle: 2 });
      if (!ov.ichi) { s.setData([]); return; }
      var d = ind.toLineData(bars, shiftedArr);
      ic.future.forEach(function (f) { if (f[futureKey] != null && f.offset > 0) d.push({ time: futureTime(f.offset), value: f[futureKey] }); });
      s.setData(d);
    };
    cloud('senkouA', ic.shifted.senkouA, 'senkouA', '--up'); cloud('senkouB', ic.shifted.senkouB, 'senkouB', '--down');

    // Horizontal levels: support / resistance and Fibonacci
    priceLines.forEach(function (pl) { candles.removePriceLine(pl); }); priceLines = [];
    if (ov.sr) {
      I.sr.resistance.forEach(function (p) { priceLines.push(candles.createPriceLine({ price: p, color: dn, lineStyle: 2, lineWidth: 1, title: 'R', axisLabelVisible: true })); });
      I.sr.support.forEach(function (p) { priceLines.push(candles.createPriceLine({ price: p, color: up, lineStyle: 2, lineWidth: 1, title: 'S', axisLabelVisible: true })); });
    }
    if (ov.fib && I.fib) {
      I.fib.forEach(function (f) {
        var edge = f.level === 0 || f.level === 1;
        priceLines.push(candles.createPriceLine({ price: f.price, color: css('--s1'), lineStyle: edge ? 0 : 3, lineWidth: 1, title: 'Fib ' + (f.label || (f.level * 100).toFixed(1).replace(/\.0$/, '') + '%'), axisLabelVisible: false }));
      });
    }

    renderAlertLines();
    renderMarkers();
    Object.keys(activePanes).forEach(function (k) { activePanes[k].api.update(); });
    renderTrendLines();
  }

  /** Dotted horizontal lines for the live price alerts on this symbol (fired ones are drawn faint). */
  function renderAlertLines() {
    alertLines.forEach(function (pl) { candles.removePriceLine(pl); }); alertLines = [];
    if (!alerts || !bars.length) return;
    alerts.list(symbol).forEach(function (a) {
      if (a.kind !== 'price_above' && a.kind !== 'price_below') return;
      var live_ = a.enabled && !a.firedAt;
      alertLines.push(candles.createPriceLine({
        price: a.value, color: live_ ? css('--accent') : css('--faint'), lineStyle: 1, lineWidth: 1,
        title: T(a.kind === 'price_above' ? (live_ ? '▲ alert' : '▲ alert (fired)') : (live_ ? '▼ alert' : '▼ alert (fired)')), axisLabelVisible: live_
      }));
    });
  }

  var PAT_CODE = { 'Doji': 'D', 'Hammer': 'H', 'Shooting star': 'SS', 'Bullish engulfing': 'BE', 'Bearish engulfing': 'BR', 'Morning star': 'MS', 'Evening star': 'ES', 'Three white soldiers': '3S', 'Three black crows': '3C' };
  function patCode(name) { return PAT_CODE[name] || name.split(/\s+/).map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 3); }

  function renderMarkers() {
    var up = css('--up'), dn = css('--down'), mu = css('--muted');
    var marks = [];
    if (ov.sig) {
      var prev = 'HOLD';
      for (var i = 50; i < bars.length; i++) {
        var st = sigSeries[i];
        if (st !== prev && st !== 'HOLD') marks.push({ _i: i, time: bars[i].time, position: st === 'BUY' ? 'belowBar' : 'aboveBar', color: st === 'BUY' ? up : dn, shape: st === 'BUY' ? 'arrowUp' : 'arrowDown', text: st });
        prev = st;
      }
    }
    if (ov.pat) {
      var from = Math.max(0, bars.length - 150);
      I.patterns.forEach(function (p) {
        if (p.index < from) return;
        marks.push({ _i: p.index, time: bars[p.index].time, position: p.bias === 'bull' ? 'belowBar' : 'aboveBar', color: p.bias === 'bull' ? up : p.bias === 'bear' ? dn : mu, shape: 'circle', size: 0.8, text: patCode(p.name) });
      });
    }
    marks.sort(function (a, b) { return a._i - b._i; });
    candles.setMarkers(marks.map(function (m) { delete m._i; return m; }));
    renderPatternLegend();
  }

  function renderPatternLegend() {
    var legend = $('patLegend'), detail = $('patDetail');
    if (!ov.pat || !I) { legend.hidden = true; detail.hidden = true; return; }
    var from = Math.max(0, bars.length - 150), groups = {}, order = [];
    I.patterns.forEach(function (p) {
      if (p.index < from) return;
      if (!groups[p.name]) { groups[p.name] = { name: p.name, label: p.label || T(p.name), bias: p.bias, count: 0, last: p, description: p.description }; order.push(p.name); }
      groups[p.name].count++; groups[p.name].last = p;
    });
    if (!order.length) { legend.hidden = false; legend.innerHTML = '<span>' + esc(T('No candlestick patterns in the last 150 bars. Patterns are rare by design: a hammer needs a decline before it, an engulfing bar must swallow the previous body.')) + '</span>'; detail.hidden = true; return; }
    legend.hidden = false;
    legend.innerHTML = '<span class="muted">' + esc(T('Patterns (last 150 bars):')) + '</span>' + order.map(function (n) {
      var g = groups[n];
      return '<span class="k ' + g.bias + '" data-pat="' + esc(n) + '" role="button" tabindex="0" title="' + esc(g.description) + '"><i></i><b>' + esc(patCode(n)) + '</b> ' + esc(g.label) + ' <span class="n">×' + g.count + '</span></span>';
    }).join('');
    $$('.k', legend).forEach(function (el) {
      var act = function () {
        var g = groups[el.dataset.pat], b = bars[g.last.index];
        detail.hidden = false;
        detail.innerHTML = '<b>' + esc(g.label) + '</b> (' + esc(T(g.bias === 'bull' ? 'bullish, latest {when}' : g.bias === 'bear' ? 'bearish, latest {when}' : 'neutral, latest {when}', { when: barLabel(b) })) + ') — ' + esc(g.description);
        var n = bars.length, idx = g.last.index;
        chP.timeScale().setVisibleLogicalRange({ from: Math.max(0, idx - 60), to: Math.min(n + 5, idx + 30) });
      };
      el.onclick = act; el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
    });
  }
  function barLabel(b) {
    if (!b) return '';
    if (typeof b.time === 'string') return b.time;
    var d = new Date(b.time * 1000);
    return d.toLocaleString(loc() || 'en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  }

  /* ---- trend lines (two clicks, saved per symbol + interval) ---- */
  function lineKey() { return symbol + '|' + tf; }
  function renderTrendLines() {
    trendSeries.forEach(function (s) { chP.removeSeries(s); }); trendSeries = [];
    (savedLines[lineKey()] || []).forEach(function (pts) {
      var s = chP.addLineSeries(lineOpts(css('--warn'), { lineWidth: 2 }));
      try { s.setData(pts); trendSeries.push(s); } catch (e) { chP.removeSeries(s); }
    });
  }
  function setDrawing(on) {
    drawing = !!on; drawPts = [];
    $('draw').classList.toggle('on', drawing);
    $('drawhint').hidden = !drawing;
    $('drawhint').innerHTML = T('Trend line: click {points} on the chart · Esc cancels', { points: '<b>' + esc(T('two points')) + '</b>' });
    $('price').style.cursor = drawing ? 'crosshair' : '';
  }
  function onChartClick(p) {
    if (!drawing || !p || !p.time || !p.point) return;
    var price = candles.coordinateToPrice(p.point.y);
    if (price == null) return;
    var t = normTime(p.time);
    if (indexOfTime(t) < 0) return;                     // clicked in the empty margin right of the last bar
    drawPts.push({ time: t, value: +price });
    if (drawPts.length === 1) { $('drawhint').innerHTML = T('First point set at {price} · click the second point', { price: '<b>' + esc(fmt(price)) + '</b>' }); return; }
    if (String(drawPts[0].time) === String(drawPts[1].time)) { drawPts.pop(); toast('Pick a different bar for the second point.', 'warn'); return; }
    drawPts.sort(function (a, b) { return indexOfTime(a.time) - indexOfTime(b.time); });
    var k = lineKey(); savedLines[k] = (savedLines[k] || []).concat([drawPts.slice()]); store.set('bt.lines', savedLines);
    var a = drawPts[0], b = drawPts[1], slope = b.value - a.value;
    toast(slope > 0 ? 'Rising line: connects higher points, the market is making higher lows/highs along it.' : 'Falling line: connects lower points, a down-sloping resistance or trend.', 'ok', T('Trend line saved for {symbol}', { symbol: symbol }));
    renderTrendLines(); setDrawing(false);
  }
  chP.subscribeClick(onChartClick);
  // A second click within ~500 ms is reported as a double-click instead of a click: treat it as the second point.
  if (typeof chP.subscribeDblClick === 'function') chP.subscribeDblClick(onChartClick);
  $('draw').onclick = function () { setDrawing(!drawing); };
  $('clearlines').onclick = function () {
    var k = lineKey(), n = (savedLines[k] || []).length;
    delete savedLines[k]; store.set('bt.lines', savedLines); renderTrendLines();
    toast(n ? T(n > 1 ? 'Removed {n} lines on {symbol} {tf}.' : 'Removed {n} line on {symbol} {tf}.', { n: n, symbol: symbol, tf: tfLabel(tf) }) : T('No trend lines on this chart yet. Click ✎ Trend line, then two points.'), n ? 'ok' : 'warn');
  };

  /* ---- crosshair: show OHLC + pane values for the hovered bar ---- */
  chP.subscribeCrosshairMove(function (p) {
    var b = p && p.seriesData && p.seriesData.get(candles);
    if (!b) { if (bars.length) { setOhlc(bars[bars.length - 1]); updatePaneTags(bars.length - 1); } return; }
    setOhlc(b);
    var i = indexOfTime(p.time); if (i >= 0) updatePaneTags(i);
  });
  function setOhlc(b) {
    var d = b.close - b.open;
    $('ohlc').innerHTML = esc(symbol) + ' · ' + esc(T('O')) + ' ' + fmt(b.open) + ' ' + esc(T('H')) + ' ' + fmt(b.high) + ' ' + esc(T('L')) + ' ' + fmt(b.low) + ' ' + esc(T('C')) + ' <span class="' + cls(d) + '">' + fmt(b.close) + '</span>' + (b.volume != null ? ' · ' + esc(T('Vol')) + ' ' + volFmt(b.volume) : '');
  }
  function volFmt(v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v); }

  /* ------------------------------------------------------------------ *
   * Header: quote, name, mode pill, overlay tag
   * ------------------------------------------------------------------ */
  function prevClose() {
    var n = bars.length; if (n < 2) return bars[0] ? bars[0].open : null;
    var last = bars[n - 1];
    if (typeof last.time === 'string') return bars[n - 2].close;
    var day = data.time.unixToNyDate(last.time);
    for (var i = n - 2; i >= 0; i--) if (data.time.unixToNyDate(bars[i].time) !== day) return bars[i].close;
    return bars[0].open;
  }
  function renderHeader() {
    if (!bars.length) return;
    var last = bars[bars.length - 1], pc = prevClose() || last.close, d = last.close - pc;
    $('px').textContent = fmt(last.close);
    $('chg').textContent = (d >= 0 ? '+' : '−') + fmt(Math.abs(d)) + ' (' + pct(d / pc * 100) + ')';
    $('chg').className = 'num chg ' + cls(d);
    var u = data.lookup(symbol);
    $('symName').textContent = (u.synthetic ? T('{symbol} — not in the demo universe; prices are simulated', { symbol: symbol }) : [u.name, u.exchange, u.sector ? T(u.sector) : ''].filter(Boolean).join(' · ')) + (typeof last.time === 'string' ? '' : ' · ' + T('vs prior close'));
    document.title = symbol + ' ' + fmt(last.close) + ' · Broward Trading';
    $('ticketSym').textContent = symbol;
    var tags = [];
    if (ov.sma20) tags.push('SMA20'); if (ov.sma50) tags.push('SMA50'); if (ov.ema9) tags.push('EMA9'); if (ov.ema21) tags.push('EMA21'); if (ov.vwap) tags.push('VWAP'); if (ov.bb) tags.push('BB'); if (ov.ichi) tags.push('Ichimoku'); if (ov.fib) tags.push('Fib');
    $('ovTag').textContent = tags.join(' · ');
    setOhlc(last);
  }
  function renderMode() {
    var pill = $('mode'), txt = $('modeText');
    if (live) {
      pill.className = 'pill live';
      var provLabel = data.PROVIDER_LABEL[dataInfo.source] || dataInfo.source || '';
      txt.textContent = T('live · {provider}', { provider: provLabel });
      pill.title = T('Real prices from {provider}.', { provider: data.PROVIDER_LABEL[dataInfo.source] || T('your provider') }) +
        (dataInfo.cached ? ' ' + T('Cached {s}s ago.', { s: Math.round((dataInfo.ageMs || 0) / 1000) }) : '') +
        (dataInfo.stale ? ' ' + T('Stale: the last refresh failed, showing the previous download.') : '');
    } else {
      pill.className = 'pill demo';
      txt.textContent = T('demo');
      pill.title = dataInfo.reason ? T(dataInfo.reason) : T('Simulated prices: deterministic per symbol so every student sees the same chart. Add a free API key under Live data for real prices.');
    }
    var msg = $('msg');
    if (!live && dataInfo.fallback && dataInfo.reason) { msg.className = 'msg'; msg.textContent = T('Showing simulated prices. {reason}', { reason: dataInfo.reason }); }
    else if (live && dataInfo.stale) { msg.className = 'msg'; msg.textContent = T('Live refresh failed, showing the last download. {reason}', { reason: dataInfo.reason || '' }); }
    else { msg.textContent = ''; }
  }

  /* ------------------------------------------------------------------ *
   * Signal card
   * ------------------------------------------------------------------ */
  function renderSignal() {
    if (!sig) return;
    $('badge').textContent = sig.state; $('badge').className = 'badge ' + sig.state.toLowerCase();
    $('score').textContent = (sig.score > 0 ? '+' : '') + sig.score; $('scoreMax').textContent = sig.max;
    $('asof').textContent = live ? T('as of last quote') : T('simulated');
    $('reasons').innerHTML = sig.reasons.map(function (r) {
      return '<li><span class="dot ' + (r.pts > 0 ? 'b' : r.pts < 0 ? 's' : '') + '"></span><span>' + esc(r.text) + '<span class="pts">' + (r.pts > 0 ? '+' : '') + (r.pts || '0') + '</span><small>' + esc(r.why) + '</small></span></li>';
    }).join('');
    var n = bars.length, from = Math.max(0, n - 20), buys = 0, sells = 0;
    for (var i = from; i < n; i++) { if (sigSeries[i] === 'BUY') buys++; else if (sigSeries[i] === 'SELL') sells++; }
    $('sigTrend').textContent = T('Last 20 bars: {buys} BUY · {sells} SELL · {holds} HOLD', { buys: buys, sells: sells, holds: n - from - buys - sells });
  }
  $('whyBtn').onclick = function () {
    var card = $('panel-signal'), on = card.classList.toggle('show-why');
    this.setAttribute('aria-expanded', String(on));
    this.textContent = on ? T('Hide the reasoning') : T('Why? Show the reasoning');
  };

  /* ------------------------------------------------------------------ *
   * Trade ticket
   * ------------------------------------------------------------------ */
  var side = 'buy', qtyMode = 'shares', pendingOrder = null;
  var OTYPE_HELP = {
    market: 'Market: fills right now at the current price. Fastest, but in real markets you pay the spread and may get a worse price in a fast move.',
    limit: 'Limit: fills only at your price or better. A buy limit below the market waits for a dip; a sell limit above waits for a rally. It may never fill.',
    stop: 'Stop: does nothing until price touches your trigger, then becomes a market order. Sell stops below your entry protect a long; buy stops above resistance catch breakouts.',
    stop_limit: 'Stop-limit: triggers like a stop but then rests as a limit order. You control the worst fill price, at the risk of not filling at all if price gaps through.'
  };
  function lastPrice() { return bars.length ? bars[bars.length - 1].close : 0; }
  function position() { return paper.state.positions[symbol] || null; }
  function setSide(s) {
    side = s; $('tmsg').dataset.kind = '';
    $$('.side').forEach(function (b) { b.classList.toggle('on', b.dataset.side === s); b.setAttribute('aria-checked', String(b.dataset.side === s)); });
    var btn = $('review'); btn.className = 'submit ' + (s === 'buy' || s === 'cover' ? 'buy' : 'sell');
    btn.textContent = T({ buy: 'Review buy order', sell: 'Review sell order', short: 'Review short order', cover: 'Review cover order' }[s] || 'Review order');
    hideConfirm(); renderTicket();
  }
  $$('.side').forEach(function (b) { b.onclick = function () { setSide(b.dataset.side); }; });
  // Editing the ticket dismisses a pending confirmation and clears the last order result.
  var ticketEdited = function () { hideConfirm(); $('tmsg').dataset.kind = ''; renderTicket(); };
  $('otype').onchange = ticketEdited;
  $('tif').onchange = ticketEdited;
  $('qty').oninput = ticketEdited;
  $('limitPx').oninput = $('stopPx').oninput = ticketEdited;
  $('qtyMode').onclick = function () {
    qtyMode = qtyMode === 'shares' ? 'dollars' : 'shares';
    var px = lastPrice(), q = +$('qty').value || 0;
    if (qtyMode === 'dollars') { $('qty').value = Math.round(q * px) || 1000; $('qty').step = '100'; $('qty').min = '1'; }
    else { $('qty').value = Math.max(1, Math.floor(q / (px || 1))); $('qty').step = '1'; $('qty').min = '1'; }
    $('qtyLabel').textContent = qtyMode === 'dollars' ? T('Dollar amount') : T('Shares');
    this.textContent = qtyMode === 'dollars' ? '#' : '$';
    this.title = qtyMode === 'dollars' ? T('Switch to entering a number of shares') : T('Switch to entering a dollar amount');
    hideConfirm(); renderTicket();
  };

  /** Build the order from the ticket. Returns {order, shares, refPrice, error}. */
  function ticketOrder() {
    var type = $('otype').value, px = lastPrice();
    var limitPrice = +$('limitPx').value || null, stopPrice = +$('stopPx').value || null;
    var refPrice = type === 'market' ? px : type === 'stop' ? (stopPrice || px) : (limitPrice || px);
    var raw = +$('qty').value || 0;
    var shares = qtyMode === 'dollars' ? Math.floor(raw / (refPrice || 1)) : Math.floor(raw);
    var pos = position(), held = pos ? pos.qty : 0, error = null;
    if (!bars.length) error = T('Load a chart first so the order has a price to work against.');
    else if (!(shares > 0)) error = qtyMode === 'dollars' ? T('That amount buys less than one share at {price}.', { price: money(refPrice) }) : T('Enter a whole number of shares.');
    else if (side === 'sell' && held <= 0) error = T('You do not own any {symbol}. Use Short if you want to bet on a decline.', { symbol: symbol });
    else if (side === 'sell' && shares > held) error = T('You own {held} shares. Selling {qty} would flip you short — use Short deliberately if that is what you mean.', { held: held, qty: shares });
    else if (side === 'cover' && held >= 0) error = T('You are not short {symbol}, so there is nothing to cover.', { symbol: symbol });
    else if (side === 'cover' && shares > -held) error = T('You are short {held} shares; covering more than that would open a long.', { held: -held });
    else if (side === 'short' && held > 0) error = T('You are long {held} shares. Sell those first; shorting while long just closes the position.', { held: held });
    var order = { symbol: symbol, side: (side === 'buy' || side === 'cover') ? 'buy' : 'sell', qty: shares, type: type, limitPrice: limitPrice, stopPrice: stopPrice, tif: $('tif').value };
    return { order: order, shares: shares, refPrice: refPrice, error: error, px: px };
  }
  function renderTicket() {
    var type = $('otype').value;
    $('limitField').hidden = !(type === 'limit' || type === 'stop_limit');
    $('stopField').hidden = !(type === 'stop' || type === 'stop_limit');
    $('otypeHelp').textContent = T(OTYPE_HELP[type]);
    var t = ticketOrder(), st = paper.state, comm = (st.settings && st.settings.commission) || 0;
    var value = t.shares * t.refPrice, isBuy = t.order.side === 'buy';
    var cashAfter = st.cash + (isBuy ? -value : value) - comm;
    var rows = [[T('Shares'), t.shares > 0 ? t.shares.toLocaleString(loc()) : '—'], [type === 'market' ? T('At about') : T('Reference price'), t.refPrice ? money(t.refPrice) : '—'], [T('Order value'), value ? money(value) : '—']];
    if (comm) rows.push([T('Commission'), money(comm)]);
    rows.push([T('Cash after'), isFinite(cashAfter) && value ? money(cashAfter) : '—']);
    if (side === 'short') rows.push([T('Margin needed'), value ? money(value * paper.SHORT_MARGIN) + ' (150%)' : '—']);
    $('est').innerHTML = rows.map(function (r) { return '<span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span>'; }).join('');
    renderPlan(false);
    var tm = $('tmsg');
    if (tm.dataset.kind === 'result') return;          // keep the last fill/reject message until the ticket is edited
    if (t.error && (t.shares > 0 || qtyMode === 'dollars')) { tm.className = 'msg'; tm.textContent = t.error; } else if (!pendingOrder) { tm.textContent = ''; }
  }
  function hideConfirm() { $('confirm').hidden = true; pendingOrder = null; }
  $('review').onclick = function () {
    var t = ticketOrder(); var tm = $('tmsg');
    tm.dataset.kind = '';
    if (t.error) { tm.className = 'msg err'; tm.textContent = t.error; return; }
    // League accounts: the league's rules are checked before the order can even be confirmed.
    var lg = leagueCheck(t.order, t.refPrice);
    if (!lg.ok) { tm.className = 'msg err'; tm.textContent = T('League rule: {reason}', { reason: lg.reason }); return; }
    var p = computePlan();
    var pm = planMeta(t, p);
    pendingOrder = Object.assign({}, t, { planMeta: pm, protect: pm && $('planStopOrder') && $('planStopOrder').checked && opensPosition() ? pm.plan.stop : null });
    var desc = paper.describeOrder(Object.assign({}, t.order));
    var verb = { buy: 'Buy {qty} {symbol}', sell: 'Sell {qty} {symbol}', short: 'Sell short {qty} {symbol}', cover: 'Buy to cover {qty} {symbol}' }[side];
    var html = '<b>' + esc(T(verb, { qty: t.shares, symbol: symbol })) + '</b> · ' + esc(desc) + ' ' + esc(T('Estimated value')) + ' <b class="num">' + esc(money(t.shares * t.refPrice)) + '</b> · ' + esc(T(t.order.tif === 'day' ? 'expires at the end of the session.' : 'good till cancelled.'));
    if (pm) {
      html += '<br><span class="plan-line">' + esc(pm.plan.target
        ? T('Plan: stop {stop}, target {target}, risking {risk} ({pct}% of equity).', { stop: money(pm.plan.stop), target: money(pm.plan.target), risk: money(pm.plan.dollarRisk), pct: fmt(pm.plan.riskPctActual, 2) })
        : T('Plan: stop {stop}, risking {risk} ({pct}% of equity).', { stop: money(pm.plan.stop), risk: money(pm.plan.dollarRisk), pct: fmt(pm.plan.riskPctActual, 2) })) + '</span>';
      if (pendingOrder.protect) html += '<br><span class="plan-line">' + esc(t.order.type === 'market'
        ? T('After the fill, a stop-loss order at {stop} (good till cancelled) is placed for you.', { stop: money(pm.plan.stop) })
        : T('A stop-loss order at {stop} is placed for you once this order fills.', { stop: money(pm.plan.stop) })) + '</span>';
    } else if (opensPosition() && bars.length) {
      html += '<br><span class="plan-line muted">' + esc(T('No stop planned. Open “Plan this trade” to size the position from the amount you are willing to lose.')) + '</span>';
    }
    $('confirmText').innerHTML = html;
    $('confirmYes').className = t.order.side === 'buy' ? 'buy' : 'sell';
    $('confirm').hidden = false; tm.textContent = '';
    $('confirmYes').focus();
  };
  $('confirmNo').onclick = hideConfirm;
  $('confirmYes').onclick = function () {
    if (!pendingOrder) return;
    var t = pendingOrder; hideConfirm();
    executeOrder(t.order, { planMeta: t.planMeta, protect: t.protect, refPrice: t.refPrice });
  };

  /**
   * executeOrder(order, opts) — the single path every dashboard order takes (ticket confirm and
   * semi-auto proposals): league rules → BT.paper.placeOrder → plan meta → messages → coach → XP.
   * opts: {planMeta, protect (stop price for a protective stop after the fill), meta, refPrice, source}
   */
  function executeOrder(order, opts) {
    opts = opts || {};
    var tm = $('tmsg'); tm.dataset.kind = 'result';
    var lg = leagueCheck(order, opts.refPrice || lastPrice());
    if (!lg.ok) {
      tm.className = 'msg err'; tm.textContent = T('League rule: {reason}', { reason: lg.reason });
      toast(lg.reason, 'err', T('League rule'), 7000);
      return { status: 'rejected', reason: lg.reason };
    }
    var tradesBefore = paper.state.trades.length;
    var o = paper.placeOrder(order, lastPrice());
    if (o.status !== 'rejected') {
      var meta = Object.assign({}, opts.planMeta || {}, opts.meta || {});
      if (opts.protect) meta.protectStop = opts.protect;
      if (Object.keys(meta).length) { o.meta = Object.assign({}, o.meta || {}, meta); if (typeof paper.save === 'function') paper.save(); }
    }
    if (o.status === 'filled') {
      tm.className = 'msg ok'; tm.textContent = T(o.side === 'buy' ? 'Filled: bought {qty} {symbol} @ {price}{commission}.' : 'Filled: sold {qty} {symbol} @ {price}{commission}.', { qty: o.qty, symbol: o.symbol, price: money(o.fillPrice), commission: o.commission ? ' (' + T('commission {fee}', { fee: money(o.commission) }) + ')' : '' });
      toast(T(o.side === 'buy' ? 'Bought {qty} {symbol} @ {price}' : 'Sold {qty} {symbol} @ {price}', { qty: o.qty, symbol: o.symbol, price: money(o.fillPrice) }), 'ok', 'Order filled');
      if (opts.protect) { o.meta.protectPlaced = true; placeProtectiveStop(o, opts.protect); }
      afterFill(o, paper.state.trades.slice(tradesBefore));
    } else if (o.status === 'open') {
      tm.className = 'msg ok'; tm.textContent = T('Working order placed. {reason}', { reason: o.reason });
      toast(paper.describeOrder(o), 'ok', 'Order is working');
      if (paper.state.trades.length > tradesBefore) afterFill(o, paper.state.trades.slice(tradesBefore)); // partial fill under the volume model
    } else {
      tm.className = 'msg err'; tm.textContent = T('Rejected: {reason}', { reason: o.reason });
      toast(o.reason, 'err', 'Order rejected', 7000);
    }
    if (o.status !== 'rejected' && opts.planMeta) clearPlanPrices();
    renderAccount(); renderOrders(); checkAuto();
    return o;
  }

  /** After an entry fills, rest a stop-loss order at the planned stop (reduce the risk the plan was sized on). */
  function placeProtectiveStop(entry, stopPx) {
    var qty = entry.filledQty || entry.qty;
    var pos = paper.state.positions[entry.symbol];
    if (!pos || !(qty > 0)) return;
    qty = Math.min(qty, Math.abs(pos.qty));
    var exitSide = pos.qty > 0 ? 'sell' : 'buy';
    var stopOrder = { symbol: entry.symbol, side: exitSide, qty: qty, type: 'stop', stopPrice: stopPx, tif: 'gtc' };
    var lg = leagueCheck(stopOrder, stopPx);
    if (!lg.ok) { toast(T('No stop-loss order was placed: {reason} Watch your planned stop at {stop} yourself.', { reason: lg.reason, stop: money(stopPx) }), 'warn', T('Plan'), 8000); return; }
    var so = paper.placeOrder(stopOrder, lastPrice());
    if (so.status === 'open') {
      so.meta = Object.assign({}, so.meta || {}, { protects: entry.id, plan: entry.meta && entry.meta.plan ? entry.meta.plan : undefined });
      if (typeof paper.save === 'function') paper.save();
      toast(T('Stop-loss order placed at {stop} for {qty} {symbol}. It sits in Open orders until price reaches it or you cancel it.', { stop: money(stopPx), qty: qty, symbol: entry.symbol }), 'ok', T('Protected'));
    } else {
      toast(T('The stop-loss order could not be placed: {reason}', { reason: so.reason }), 'warn', T('Plan'), 8000);
    }
  }

  /* ------------------------------------------------------------------ *
   * Paper accounts: Main / Replay / one per joined league (BT.paper.accounts)
   * ------------------------------------------------------------------ */
  var ACCOUNT_KEY = 'bt.dash.account';
  function leaguesApi() { return BT.leagues && typeof BT.leagues.validateOrder === 'function' ? BT.leagues : null; }
  function activeAccount() { try { return typeof paper.account === 'function' ? paper.account() : 'main'; } catch (e) { return 'main'; } }
  function leagueCode(id) {
    var L = leaguesApi(); if (!L || typeof L.accountCode !== 'function') return null;
    try { return L.accountCode(id); } catch (e) { return null; }
  }
  function leagueOf(id) {
    var L = leaguesApi(), code = leagueCode(id); if (!L || !code) return null;
    try { return (typeof L.get === 'function' ? L.get(code) : null) || (typeof L.leagueForAccount === 'function' ? L.leagueForAccount(id) : null); } catch (e) { return null; }
  }
  function accountName(id) {
    if (id === 'main') return T('Main account');
    if (id === 'replay') return T('Replay account');
    var code = leagueCode(id);
    if (code) { var lg = leagueOf(id); return lg && lg.name ? T('League: {name}', { name: lg.name }) : T('League {code}', { code: code }); }
    return String(id);
  }
  function listAccounts() {
    var ids = [];
    try { (typeof paper.accounts === 'function' ? paper.accounts() : []).forEach(function (a) { if (a && a.id && ids.indexOf(a.id) < 0) ids.push(a.id); }); } catch (e) { /* storage blocked */ }
    // Leagues joined on this device always get a row, even before their account has been opened here.
    var L = leaguesApi();
    if (L && typeof L.joined === 'function' && typeof L.accountId === 'function') {
      try { L.joined().forEach(function (lg) { var id = L.accountId(lg.code); var norm = ids.filter(function (x) { return leagueCode(x) === lg.code; })[0]; if (!norm) ids.push(id); }); } catch (e) { /* ignore */ }
    }
    if (ids.indexOf('main') < 0) ids.unshift('main');
    var cur = activeAccount(); if (ids.indexOf(cur) < 0) ids.push(cur);
    // League rows only when the leagues module can explain their rules; unknown ids are kept (they are real accounts).
    return ids.filter(function (id) { return !leagueCode(id) || leaguesApi(); })
      .sort(function (a, b) { var r = function (x) { return x === 'main' ? 0 : x === 'replay' ? 1 : 2; }; return r(a) - r(b); });
  }
  function leagueRulesText(lg) {
    var r = lg.rules || {}, kinds = { stock: T('stocks'), etf: T('ETFs'), crypto: T('crypto'), option: T('options') };
    var parts = [T('allowed: {list}', { list: (r.assets || ['stock']).map(function (k) { return kinds[k] || k; }).join(', ') })];
    parts.push(T(r.shortSelling ? 'short selling on' : 'short selling off'));
    parts.push(T(r.dayTrading ? 'day trading on' : 'day trading off'));
    if (r.maxPositionPct && r.maxPositionPct < 100) parts.push(T('max {pct}% of equity per position', { pct: r.maxPositionPct }));
    return parts.join(' · ');
  }
  function renderAccountSwitcher() {
    var sel = $('acctSel'); if (!sel) return;
    var ids = listAccounts(), cur = activeAccount();
    sel.innerHTML = ids.map(function (id) { return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' + esc(accountName(id)) + '</option>'; }).join('');
    sel.value = cur;
    $('acctField').hidden = ids.length < 2 && cur === 'main';
    var note = $('acctNote'), lg = leagueOf(cur), txt = '';
    if (lg) {
      var cd = null; try { cd = BT.leagues.countdown ? BT.leagues.countdown(lg) : null; } catch (e) { cd = null; }
      txt = T('{name}: {status}. League rules are checked before every order ({rules}).', { name: lg.name, status: cd && cd.label ? cd.label : T('active'), rules: leagueRulesText(lg) });
    } else if (isLeagueAccount(cur)) txt = T('This league is not saved on this device any more, so its rules cannot be checked. Rejoin it on the Leagues page.');
    else if (cur === 'replay') txt = T('The Replay account is reset each time you start a Market Replay session, so trades placed here do not last. Use Main for practice that sticks.');
    else if (cur === 'main') txt = ids.length > 1 ? T('Your main practice account. League and Replay accounts keep separate cash and positions.') : '';
    note.textContent = txt; note.hidden = !txt;
    $('panel-account').classList.toggle('league-acct', !!lg);
    var head = $('acctHead'); if (head) head.textContent = cur === 'main' ? T('Paper account') : accountName(cur);
  }
  function switchAccount(id) {
    if (!id || id === activeAccount()) return;
    // Re-read the outgoing account from storage first: another tab (portfolio.html) may have traded on it
    // since this page loaded, and BT.paper.use() saves the outgoing state when it has never been stored.
    try { if (typeof paper.load === 'function') paper.load(); paper.use(id); } catch (e) { toast(T('Could not switch accounts: {error}', { error: e && e.message }), 'err'); return; }
    store.set(ACCOUNT_KEY, activeAccount());
    hideConfirm(); $('tmsg').dataset.kind = ''; $('tmsg').textContent = ''; showCoach([]);
    if (auto.proposal) hideProposal();
    renderAccountSwitcher(); renderAccount(); renderOrders(); renderTicket();
    if (bars.length) processFills(symbol, bars[bars.length - 1]);
    toast(T('Orders now go to {account}.', { account: accountName(activeAccount()) }), 'ok', T('Account switched'));
  }
  if ($('acctSel')) $('acctSel').onchange = function () { switchAccount(this.value); };
  (function restoreAccount() {
    var saved = store.get(ACCOUNT_KEY, 'main');
    if (saved && saved !== 'main' && saved !== activeAccount() && listAccounts().indexOf(saved) >= 0) {
      try { if (typeof paper.load === 'function') paper.load(); paper.use(saved); } catch (e) { /* stay on main */ }
    }
  })();
  window.addEventListener('storage', function (e) {
    // A league joined or left in another tab: refresh the switcher (never switch accounts behind the student's back).
    if (e && e.key && (/^bt\.leagues/.test(e.key) || e.key === 'bt.portfolio.accounts')) renderAccountSwitcher();
  });

  /** True for a league account id, even when js/leagues.js is missing ('league:ABC234' / 'league-abc234'). */
  function isLeagueAccount(id) { return !!leagueCode(id) || /^league[:\-][a-z0-9]+$/i.test(String(id || '')); }
  /**
   * League rules for the active account: {ok, reason}. Main / Replay accounts always pass.
   * A league account fails closed: if its league cannot be loaded (cleared storage, missing module)
   * or the check throws, the order is refused rather than placed with no rules.
   */
  function leagueCheck(order, refPrice) {
    var id = activeAccount();
    if (!isLeagueAccount(id)) return { ok: true, reason: '' };
    var blocked = { ok: false, reason: T('This league is not saved on this device any more, so its rules cannot be checked. Rejoin it on the Leagues page.') };
    var lg = leagueOf(id);
    if (!lg || !leaguesApi()) return blocked;
    try {
      var st = paper.state;
      var acct = Object.assign({}, st, { marks: Object.assign({}, st.marks || {}, priceMap()) });
      var res = BT.leagues.validateOrder(Object.assign({}, order, { price: refPrice || lastPrice(), time: Date.now() }), lg, acct);
      return res && res.ok === false ? { ok: false, reason: res.reason || T('This order breaks a league rule.') } : { ok: true, reason: '' };
    } catch (e) { console.warn('League check failed', e); return { ok: false, reason: T('The league rules could not be checked, so this order was not placed. Reload the page and try again.') }; }
  }

  /* ------------------------------------------------------------------ *
   * "Plan this trade" (BT.risk): size from the amount you are willing to lose
   * ------------------------------------------------------------------ */
  function riskApi() { return BT.risk && typeof BT.risk.planTrade === 'function' ? BT.risk : null; }
  function opensPosition() { return side === 'buy' || side === 'short'; }
  function currentEquity() {
    try { if (typeof paper.valuation === 'function') { var v = paper.valuation(priceMap()); return paper.state.cash + v.marketValue; } } catch (e) { /* fall through */ }
    return paper.state.cash;
  }
  function planNum(id) { var el = $(id); if (!el) return null; var v = parseFloat(String(el.value).replace(',', '.')); return isFinite(v) && v > 0 ? v : null; }
  /** null when the panel is unavailable; otherwise {state:'closing'|'empty'|'ready', ...BT.risk.planTrade fields}. */
  function computePlan() {
    var R = riskApi(); if (!R || !$('planBox')) return null;
    if (!opensPosition()) return { state: 'closing' };
    var t = ticketOrder(), entry = t.refPrice;
    var riskPct = planNum('planRisk') || 1, stop = planNum('planStop'), target = planNum('planTarget');
    if (!stop || !(entry > 0)) return { state: 'empty', entry: entry, riskPct: riskPct };
    var lg = leagueOf(activeAccount());
    var equity = currentEquity();
    var p = R.planTrade({ equity: equity, riskPct: riskPct, entry: entry, stop: stop, target: target, maxPositionPct: lg && lg.rules ? lg.rules.maxPositionPct : 100 });
    p.state = 'ready'; p.entry = entry; p.stop = stop; p.target = target; p.riskPct = riskPct; p.equity = equity;
    var want = side === 'short' ? 'short' : 'long';
    if (p.size && p.size.error) p.error = p.size.error;
    else if (p.side && p.side !== want) p.error = T(want === 'long' ? 'For a buy, the stop goes below the entry price ({entry}).' : 'For a short, the stop goes above the entry price ({entry}).', { entry: money(entry) });
    return p;
  }
  /** Order meta for a planned trade, using the quantity actually on the ticket (the student may have changed it). */
  function planMeta(t, p) {
    if (!p || p.state !== 'ready' || p.error || !t || !(t.shares > 0)) return null;
    var dollarRisk = Math.abs(p.entry - p.stop) * t.shares;
    return {
      plan: { stop: p.stop, target: p.target || null, riskPct: p.riskPct, riskPctActual: p.equity > 0 ? dollarRisk / p.equity * 100 : null, dollarRisk: Math.round(dollarRisk * 100) / 100, entry: p.entry, shares: t.shares, plannedShares: p.shares, rewardRisk: p.rewardRisk, source: 'dashboard' },
      plannedStop: p.stop, plannedTarget: p.target || null, plannedRiskPct: p.equity > 0 ? Math.round(dollarRisk / p.equity * 10000) / 100 : null
    };
  }
  function clearPlanPrices() { if ($('planStop')) $('planStop').value = ''; if ($('planTarget')) $('planTarget').value = ''; renderPlan(false); }
  function renderPlan(fromInput) {
    var box = $('planBox'); if (!box) return;
    if (!riskApi()) { box.hidden = true; return; }
    var p = computePlan(), out = $('planOut'), warn = $('planWarn'), sum = $('planSummary');
    var rows = [], warnings = [];
    $('planStopRow').hidden = !(p && p.state === 'ready' && !p.error);
    if (!p || p.state === 'closing') {
      out.innerHTML = ''; sum.textContent = '';
      warn.innerHTML = '<li class="tip">' + esc(T('Planning is for opening a position (Buy or Short). To protect a position you already hold, use a Stop order on the ticket.')) + '</li>';
      return;
    }
    if (p.state === 'empty') {
      out.innerHTML = ''; sum.textContent = '';
      warn.innerHTML = '<li class="tip">' + esc(T(side === 'short' ? 'Enter the price where your short idea is proven wrong (above {entry}). The panel works out how many shares keep the loss at your risk %.' : 'Enter the price where your idea is proven wrong (below {entry}). The panel works out how many shares keep the loss at your risk %.', { entry: bars.length ? money(p.entry) : '—' })) + '</li>';
      return;
    }
    if (p.error) {
      out.innerHTML = ''; sum.textContent = '';
      warn.innerHTML = '<li class="warn">' + esc(p.error) + '</li>';
      return;
    }
    rows.push([T('Entry (about)'), money(p.entry)]);
    rows.push([T('Shares for {pct}% risk', { pct: fmt(p.riskPct, p.riskPct % 1 ? 2 : 0) }), p.shares.toLocaleString(loc())]);
    rows.push([T('Loss if the stop is hit'), money(p.lossAtStop)]);
    rows.push([T('Position size'), money(p.size.positionValue) + ' (' + fmt(p.size.pctOfEquity, 1) + '%)']);
    if (p.rewardRisk != null) {
      rows.push([T('Reward : risk'), fmt(p.rewardRisk, 2) + ' : 1']);
      rows.push([T('Break-even win rate'), fmt(p.breakevenWinRate * 100, 1) + '%']);
      if (p.profitAtTarget != null) rows.push([T('Profit at target'), money(p.profitAtTarget)]);
    }
    out.innerHTML = rows.map(function (r) { return '<span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span>'; }).join('');
    (p.warnings || []).forEach(function (w) { warnings.push('<li class="' + (w.level === 'warn' ? 'warn' : 'tip') + '">' + esc(w.message) + '</li>'); });
    if (!(p.shares > 0)) warnings.push('<li class="warn">' + esc(T('At this stop distance even one share risks more than {pct}% of your equity. Move the stop closer or accept a smaller position elsewhere.', { pct: fmt(p.riskPct, 2) })) + '</li>');
    warn.innerHTML = warnings.join('');
    sum.textContent = p.shares > 0 ? T('{n} shares · {pct}% risk', { n: p.shares.toLocaleString(loc()), pct: fmt(p.riskPct, p.riskPct % 1 ? 2 : 0) }) : '';
    if (fromInput && p.shares > 0) {
      if (qtyMode !== 'shares') $('qtyMode').click();
      $('qty').value = String(p.shares);
      $('planMsg').textContent = T('Quantity set to {n} shares from your plan.', { n: p.shares.toLocaleString(loc()) });
      hideConfirm(); $('tmsg').dataset.kind = '';
      renderTicket();
    }
  }
  if ($('planBox')) {
    ['planRisk', 'planStop', 'planTarget'].forEach(function (id) { $(id).addEventListener('input', debounce(function () { $('planMsg').textContent = ''; renderPlan(true); }, 250)); });
    $('planBox').addEventListener('toggle', function () { if ($('planBox').open) renderPlan(false); });
    $('planUseAtr').onclick = function () {
      // A common starting point: a stop 2 × ATR(14) away from the entry, beyond normal day-to-day noise.
      if (!I || !I.atr || !bars.length) return;
      var atr = I.atr[I.atr.length - 1]; if (!(atr > 0)) return;
      var entry = ticketOrder().refPrice, stop = side === 'short' ? entry + 2 * atr : entry - 2 * atr;
      $('planStop').value = stop.toFixed(2);
      $('planMsg').textContent = T('Stop set 2 × ATR ({atr}) from the entry. ATR is the typical bar range, so the stop sits outside normal noise.', { atr: fmt(atr) });
      renderPlan(true);
    };
  }

  /* ------------------------------------------------------------------ *
   * Coach notes after fills (BT.coach, optional) and XP (BT.xp, optional)
   * ------------------------------------------------------------------ */
  function awardXp(event, key) { try { if (BT.xp && typeof BT.xp.award === 'function') return BT.xp.award(event, key); } catch (e) { /* never break trading */ } return null; }
  function coachContext() {
    return { account: paper.state, accountId: activeAccount(), equity: currentEquity(), symbol: symbol, interval: tf, price: lastPrice(), bars: bars, ind: I, signal: sig, league: leagueOf(activeAccount()) };
  }
  function coachReview(kind, subject) {
    var C = BT.coach; if (!C || !subject) return [];
    var fn = kind === 'trade' ? C.reviewTrade : C.reviewOrder;
    if (typeof fn !== 'function') return [];
    try {
      var out = fn.call(C, subject, coachContext());
      if (out && !Array.isArray(out) && Array.isArray(out.notes)) out = out.notes;
      return Array.isArray(out) ? out.filter(function (n) { return n && (n.title || n.message); }) : [];
    } catch (e) { console.warn('Coach review failed', e); return []; }
  }
  function showCoach(notes) {
    var box = $('coachNotes'); if (!box) return;
    if (!notes || !notes.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="coach-head"><b>' + esc(T('Coach notes')) + '</b><button class="sm ghost" type="button" id="coachClose">' + esc(T('Got it')) + '</button></div><ul>' + notes.slice(0, 5).map(function (n) {
      var lesson = n.lessonId && /^[\w-]+$/.test(String(n.lessonId)) ? ' <a href="learn.html#/lesson/' + esc(n.lessonId) + '">' + esc(T('Related lesson')) + ' ▸</a>' : '';
      return '<li class="' + (n.level === 'warn' ? 'warn' : 'tip') + '"><b>' + esc(n.title || '') + '</b> ' + esc(n.message || '') + lesson + '</li>';
    }).join('') + '</ul><p class="note">' + esc(T('The coach checks habits (risk, stops, trend, overtrading). It never tells you what to buy or sell.')) + '</p>';
    box.hidden = false;
    $('coachClose').onclick = function () { showCoach([]); };
  }
  /** Called after every fill on the dashboard: coach review of the order (and of the closed trade), plus XP. */
  function afterFill(order, newTrades) {
    newTrades = (newTrades || []).filter(Boolean);
    var notes = coachReview('order', order);
    newTrades.forEach(function (tr) { if (tr.closedQty > 0) notes = notes.concat(coachReview('trade', tr)); });
    var seen = {};
    notes = notes.filter(function (n) { var k = (n.title || '') + '|' + (n.message || ''); if (seen[k]) return false; seen[k] = 1; return true; });
    showCoach(notes);
    saveCoachToJournal(notes, newTrades);
    awardXp('firstTrade', 'once');
  }
  /** Copy the coach notes into the journal entry of each new fill (BT.journal, when loaded). Never breaks trading. */
  function saveCoachToJournal(notes, newTrades) {
    var J = BT.journal, C = BT.coach;
    if (!notes || !notes.length || !newTrades.length || !J || typeof J.setCoach !== 'function' || !C || typeof C.toJournal !== 'function') return;
    try {
      if (typeof J.load === 'function') J.load();   // another tab (journal.html) may have edited entries since this page loaded
      var acct = activeAccount(), payload = C.toJournal(notes);
      newTrades.forEach(function (tr) { if (tr && tr.id != null) J.setCoach({ trade: tr, account: acct }, payload); });
    } catch (e) { console.warn('Could not save coach notes to the journal', e); }
  }

  /* ------------------------------------------------------------------ *
   * Semi-auto paper mode (BT.rules): proposes, never executes on its own
   * ------------------------------------------------------------------ */
  var auto = { proposal: null, handled: {}, compiled: null, compiledFor: null };
  function rulesApi() { return BT.rules && typeof BT.rules.list === 'function' && typeof BT.rules.compile === 'function' ? BT.rules : null; }
  function autoCfg() {
    var R = rulesApi(); if (!R) return { enabled: false, ruleId: null };
    try { return R.semiAuto ? R.semiAuto.get() : store.get('bt.dash.auto', { enabled: false, ruleId: null }); } catch (e) { return { enabled: false, ruleId: null }; }
  }
  function setAutoCfg(v) {
    var R = rulesApi(); if (!R) return;
    try { if (R.semiAuto) R.semiAuto.set(v); else store.set('bt.dash.auto', Object.assign(autoCfg(), v)); } catch (e) { /* ignore */ }
  }
  function autoMsg(text, kind) { var m = $('autoMsg'); if (m) { m.textContent = text || ''; m.className = 'msg ' + (kind || ''); } }
  function renderAutoPanel() {
    var card = $('panel-auto'); if (!card) return;
    var R = rulesApi();
    if (!R) { card.hidden = true; return; }
    card.hidden = false;
    var rules = []; try { rules = R.list(); } catch (e) { rules = []; }
    var cfg = autoCfg(), sel = $('autoRule');
    $('autoEmpty').hidden = rules.length > 0;
    $('autoControls').hidden = !rules.length;
    if (!rules.length) { $('autoState').textContent = ''; hideProposal(); return; }
    var ruleId = cfg.ruleId && rules.some(function (r) { return r.id === cfg.ruleId; }) ? cfg.ruleId : rules[0].id;
    sel.innerHTML = rules.map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === ruleId ? ' selected' : '') + '>' + esc(r.name || T('Untitled rule')) + '</option>'; }).join('');
    sel.value = ruleId;
    $('autoOn').checked = !!cfg.enabled && cfg.ruleId === ruleId;
    var rule = rules.filter(function (r) { return r.id === ruleId; })[0];
    var desc = ''; try { desc = R.describe(rule); } catch (e) { desc = ''; }
    $('autoDesc').textContent = desc;
    $('autoState').textContent = $('autoOn').checked ? T('watching {symbol}', { symbol: symbol }) : T('off');
    $('autoState').className = 'score' + ($('autoOn').checked ? ' up' : '');
  }
  function hideProposal() { auto.proposal = null; var p = $('autoProposal'); if (p) { p.hidden = true; p.innerHTML = ''; } }
  function expandCard(card) {
    if (!card || !card.classList.contains('collapsed')) return;
    card.classList.remove('collapsed');
    var b = card.querySelector('.acc-btn'); if (b) b.setAttribute('aria-expanded', 'true');
  }
  function proposalQty(prop) {
    var pos = position();
    if (prop.intent === 'exit') return pos ? Math.abs(pos.qty) : 0;
    var p = computePlanFor(prop);
    if (p && p.shares > 0) return p.shares;
    var t = ticketOrder();
    if (t.shares > 0 && (t.order.side === prop.action)) return t.shares;
    return Math.max(1, Math.floor(currentEquity() * 0.1 / (prop.price || lastPrice() || 1)));
  }
  /** If the rule has a stop %, size the proposal with the risk % from the plan panel (default 1 %). */
  function computePlanFor(prop) {
    var R = riskApi(), rule = auto.rule; if (!R || !rule || !rule.exit || !(rule.exit.stopPct > 0)) return null;
    var entry = prop.price || lastPrice(), long = prop.action === 'buy';
    var stop = long ? entry * (1 - rule.exit.stopPct / 100) : entry * (1 + rule.exit.stopPct / 100);
    try { var s = R.positionSize({ equity: currentEquity(), riskPct: planNum('planRisk') || 1, entry: entry, stop: stop }); s.stop = stop; return s; } catch (e) { return null; }
  }
  /** Bar or trade time → ms (unix seconds, ms, 'YYYY-MM-DD' at 00:00 UTC, or a {year, month, day} business day). Same as coach.barIndexAt. */
  function timeMs(t) {
    if (typeof t === 'number' && isFinite(t)) return t < 1e11 ? t * 1000 : t;
    if (typeof t === 'string' && t) { var p = Date.parse(t.length === 10 ? t + 'T00:00:00Z' : t); return isFinite(p) ? p : null; }
    if (t && typeof t === 'object' && typeof t.year === 'number') return Date.UTC(t.year, (t.month || 1) - 1, t.day || 1);
    return null;
  }
  /** Index of the last bar whose time is at or before t; -1 when t is before the first bar or unknown. */
  function barIndexAt(list, t) {
    var ms = timeMs(t), idx = -1;
    if (ms == null || !list || !list.length) return -1;
    for (var i = 0; i < list.length; i++) {
      var b = timeMs(list[i] && list[i].time);
      if (b == null) continue;
      if (b <= ms) idx = i; else break;
    }
    return idx;
  }
  /**
   * The trade that opened the position currently held in `sym`: walk this symbol's trades backwards,
   * undoing each one, until the quantity before a trade was flat (or on the other side). null if unknown.
   */
  function openingTrade(sym, pos) {
    var trades = (paper.state && paper.state.trades) || [], q = pos ? pos.qty : 0, eps = 1e-9;
    if (!q) return null;
    var dir = q > 0 ? 1 : -1;
    for (var i = trades.length - 1; i >= 0; i--) {
      var tr = trades[i]; if (!tr || tr.symbol !== sym || !(tr.qty > 0)) continue;
      var prev = q - (tr.side === 'buy' ? tr.qty : -tr.qty);
      if (Math.abs(prev) < eps || prev * dir < 0) return tr;
      q = prev;
    }
    return null;
  }
  /**
   * The dashboard position in the shape BT.rules.propose expects. entryIndex / barsHeld let the rule's
   * trailing stop and time exit run; `tracked` is false when the entry bar is not in the loaded bars.
   */
  function heldForRules(pos) {
    if (!pos) return null;
    var held = { side: pos.qty > 0 ? 'long' : 'short', entry: pos.avg, qty: Math.abs(pos.qty), tracked: false };
    var tr = openingTrade(symbol, pos);
    if (tr) {
      var idx = barIndexAt(bars, tr.barTime != null ? tr.barTime : tr.time);
      if (idx >= 0) { held.entryIndex = idx; held.barsHeld = bars.length - 1 - idx; held.tracked = true; }
    }
    return held;
  }
  function needsEntryBar(rule) {
    var ex = rule && rule.exit; return !!ex && (ex.trailingPct != null || ex.maxBars != null);
  }
  function checkAuto() {
    var R = rulesApi(); if (!R || !$('panel-auto') || !bars.length) return;
    var cfg = autoCfg();
    if (!cfg.enabled || !cfg.ruleId) { if (auto.proposal) hideProposal(); return; }
    var rule = null; try { rule = R.get(cfg.ruleId); } catch (e) { rule = null; }
    if (!rule) { hideProposal(); autoMsg(T('The saved rule was not found. Pick another one or build it again in the Strategy Builder.'), 'err'); return; }
    // compile() is the same engine the back-tester runs: no look-ahead, crosses compare the previous bar with this one.
    if (auto.compiledFor !== rule.id + '|' + (rule.updatedAt || '')) {
      try { auto.compiled = R.compile(rule); } catch (e) { auto.compiled = null; }
      auto.compiledFor = rule.id + '|' + (rule.updatedAt || '');
    }
    var strat = auto.compiled;
    if (!strat || (strat.errors && strat.errors.length)) { hideProposal(); autoMsg(T('This rule cannot run yet: {problems}', { problems: strat && strat.errors ? strat.errors.join(' ') : T('it did not compile') }), 'err'); return; }
    auto.rule = strat.rule || rule;
    var pos = position();
    var held = heldForRules(pos);
    // Never fail silently: tell the student when the rule's trailing stop / time exit cannot be followed.
    var untracked = !!held && !held.tracked && needsEntryBar(auto.rule);
    var tn = $('autoTrackNote');
    if (untracked && !tn && $('autoControls')) {
      tn = document.createElement('p'); tn.id = 'autoTrackNote'; tn.className = 'note';
      $('autoControls').appendChild(tn);
    }
    if (tn) {
      tn.hidden = !untracked;
      tn.textContent = untracked ? T('The bar where this {symbol} position was opened is not in the loaded chart, so the rule’s trailing stop and time exit cannot be tracked for it. Any stop-loss, profit target or exit condition in the rule is still checked. Watch the trailing and time exits yourself, or load a longer range.', { symbol: symbol }) : '';
    }
    var prop = null;
    try {
      if (typeof R.propose === 'function') prop = R.propose(rule, bars, held);
      else {
        var act = strat.onBar({ bars: bars, ind: I, position: held }, bars.length - 1);
        var rs = (strat.rule && strat.rule.side) || 'long';
        if (act === 'exit' && held) prop = { action: held.side === 'long' ? 'sell' : 'buy', intent: 'exit', side: held.side, price: lastPrice(), reason: T('exit rule fired') };
        else if ((act === 'buy' || act === 'sell') && !held) prop = { action: act, intent: 'entry', side: rs, price: lastPrice(), reason: strat.description || '' };
      }
    } catch (e) { console.warn('Rule check failed', e); prop = null; }
    var last = bars[bars.length - 1], barKey = String(last.time);
    if (!prop) {
      // The bar is still forming: a proposal from an earlier tick of this bar stays up, marked as no longer true.
      if (auto.proposal && auto.proposal.bar !== barKey) { hideProposal(); autoMsg(T('The last proposal expired when a new bar started.'), ''); }
      else if (auto.proposal) $('autoStale').hidden = false;
      return;
    }
    var key = [rule.id, symbol, tf, barKey, prop.intent, prop.action].join('|');
    if (auto.handled[key]) return;
    if (auto.proposal && auto.proposal.key === key) { $('autoStale').hidden = true; updateProposalPrice(); return; }
    showProposal(Object.assign({}, prop, { key: key, bar: barKey, ruleName: rule.name || T('Untitled rule') }));
  }
  function proposalVerb(prop) {
    if (prop.intent === 'exit') return prop.action === 'sell' ? 'Sell {qty} {symbol} to close your long' : 'Buy {qty} {symbol} to cover your short';
    return prop.action === 'buy' ? 'Buy {qty} {symbol}' : 'Sell short {qty} {symbol}';
  }
  function showProposal(prop) {
    auto.proposal = prop;
    var qty = proposalQty(prop), box = $('autoProposal');
    prop.qty = qty;
    var sized = prop.intent === 'entry' ? computePlanFor(prop) : null;
    box.innerHTML =
      '<p class="prop-title"><b>' + esc(T('Your rule “{name}” fired', { name: prop.ruleName })) + '</b></p>' +
      '<p class="prop-order"><span class="' + (prop.action === 'buy' ? 'up' : 'down') + '">' + esc(T(proposalVerb(prop), { qty: qty, symbol: symbol })) + '</span> ' + esc(T('at about {price} (market order)', { price: money(lastPrice()) })) + '</p>' +
      (prop.reason ? '<p class="note">' + esc(T('Why: {reason}', { reason: prop.reason })) + '</p>' : '') +
      (sized && sized.shares > 0 ? '<p class="note">' + esc(T('Sized so the rule’s {pct}% stop ({stop}) risks about {risk}.', { pct: auto.rule.exit.stopPct, stop: money(sized.stop), risk: money(sized.dollarRisk) })) + '</p>' : '') +
      '<p class="note" id="autoStale" hidden>' + esc(T('On the latest tick the condition is no longer true. The bar has not closed yet, so the signal can still change.')) + '</p>' +
      '<div class="actions"><button type="button" class="' + (prop.action === 'buy' ? 'buy' : 'sell') + '" id="autoConfirm">' + esc(T('Confirm paper order')) + '</button><button type="button" id="autoDismiss">' + esc(T('Dismiss')) + '</button></div>' +
      '<p class="note">' + esc(T('A rule firing is not a prediction. You decide: nothing is placed until you tap Confirm.')) + '</p>';
    box.hidden = false;
    autoMsg('');
    expandCard($('panel-auto'));
    // The phone accordion (js/nav.js) may collapse the card on DOMContentLoaded, after a proposal made during boot.
    setTimeout(function () { if (auto.proposal === prop) expandCard($('panel-auto')); }, 400);
    $('autoConfirm').onclick = confirmProposal;
    $('autoDismiss').onclick = function () { auto.handled[prop.key] = 'dismissed'; hideProposal(); autoMsg(T('Dismissed. The rule will propose again on a later bar if it fires.'), ''); };
    toast(T(proposalVerb(prop), { qty: qty, symbol: symbol }) + ' — ' + T('review it in the Semi-auto card.'), 'ok', T('Rule “{name}” fired', { name: prop.ruleName }), 7000);
  }
  function updateProposalPrice() {
    var p = auto.proposal; if (!p) return;
    var el = $('autoProposal') && $('autoProposal').querySelector('.prop-order');
    if (el) el.innerHTML = '<span class="' + (p.action === 'buy' ? 'up' : 'down') + '">' + esc(T(proposalVerb(p), { qty: p.qty, symbol: symbol })) + '</span> ' + esc(T('at about {price} (market order)', { price: money(lastPrice()) }));
  }
  function confirmProposal() {
    var p = auto.proposal; if (!p) return;
    auto.handled[p.key] = 'confirmed';
    hideProposal();
    if (!(p.qty > 0)) { autoMsg(T('Nothing to trade: the proposed quantity is zero.'), 'err'); return null; }
    var order = { symbol: symbol, side: p.action, qty: p.qty, type: 'market', tif: 'gtc' };
    var sized = p.intent === 'entry' ? computePlanFor(p) : null;
    var meta = { source: 'semi-auto', rule: p.ruleName, intent: p.intent };
    var pm = null;
    if (sized && sized.shares > 0 && sized.stop) {
      var eq = currentEquity(), risk = Math.abs(lastPrice() - sized.stop) * p.qty;
      pm = { plan: { stop: Math.round(sized.stop * 100) / 100, target: null, riskPct: planNum('planRisk') || 1, riskPctActual: eq > 0 ? risk / eq * 100 : null, dollarRisk: Math.round(risk * 100) / 100, entry: lastPrice(), shares: p.qty, source: 'semi-auto' }, plannedStop: Math.round(sized.stop * 100) / 100 };
    }
    var o = executeOrder(order, { meta: meta, planMeta: pm, refPrice: lastPrice() });
    autoMsg(o.status === 'filled' ? T('Confirmed by you and filled. The rule keeps watching.') : o.status === 'open' ? T('Confirmed by you; the order is working.') : T('Not filled: {reason}', { reason: o.reason }), o.status === 'rejected' ? 'err' : 'ok');
    return o;
  }
  if ($('panel-auto')) {
    $('autoRule').onchange = function () { setAutoCfg({ ruleId: this.value, enabled: false }); hideProposal(); autoMsg(''); renderAutoPanel(); };
    $('autoOn').onchange = function () {
      setAutoCfg({ ruleId: $('autoRule').value, enabled: this.checked });
      hideProposal(); auto.handled = {};
      autoMsg(this.checked ? T('Watching {symbol} {tf}. When the rule fires you get a proposal here; nothing is placed without your tap.', { symbol: symbol, tf: tfLabel(tf) }) : T('Semi-auto mode is off.'), 'ok');
      renderAutoPanel(); checkAuto();
    };
    window.addEventListener('storage', function (e) { if (e && e.key === 'bt.rules') { auto.compiledFor = null; renderAutoPanel(); checkAuto(); } });
  }

  /* ------------------------------------------------------------------ *
   * Open orders, account, fills
   * ------------------------------------------------------------------ */
  var TYPE_NAMES = { market: 'Market', limit: 'Limit', stop: 'Stop', stop_limit: 'Stop-limit' };
  function renderOrders() {
    var open = paper.openOrders();
    $('ordersCount').textContent = open.length ? T('{n} working', { n: open.length }) : '';
    $('orders').innerHTML = open.length ? open.slice().reverse().map(function (o) {
      var trig = o.type === 'limit' ? money(o.limitPrice) : o.type === 'stop' ? money(o.stopPrice) : money(o.stopPrice) + ' / ' + money(o.limitPrice);
      return '<tr><td><span class="' + (o.side === 'buy' ? 'up' : 'down') + '">' + esc(T(o.side === 'buy' ? 'BUY' : 'SELL')) + '</span> <b>' + esc(o.symbol) + '</b><span class="type">' + esc(T(TYPE_NAMES[o.type] || o.type)) + ' · ' + esc(T(o.tif === 'day' ? 'Day' : 'GTC')) + (o.triggered ? ' · ' + esc(T('triggered')) : '') + '</span></td><td class="num">' + o.qty + '</td><td class="num">' + esc(trig) + '</td><td><button class="sm ghost" data-cancel="' + o.id + '" title="' + esc(T('Cancel this order')) + '" aria-label="' + esc(T('Cancel this order')) + '">✕</button></td></tr>';
    }).join('') : '<tr><td class="muted">' + esc(T('No working orders. Try a limit order a little below the price and watch it fill when a bar\'s low reaches it.')) + '</td></tr>';
    $$('[data-cancel]', $('orders')).forEach(function (b) {
      b.onclick = function () { var o = paper.cancelOrder(+b.dataset.cancel); if (o) toast(paper.describeOrder(o), 'warn', 'Order cancelled'); renderOrders(); renderAccount(); };
    });
  }
  function priceMap() {
    var m = {}; if (bars.length) m[symbol] = lastPrice();
    Object.keys(wlQuotes).forEach(function (s) { if (!(s in m) && wlQuotes[s].price > 0) m[s] = wlQuotes[s].price; });
    return m;
  }
  function renderAccount() {
    var mtm = paper.markToMarket(priceMap());
    var stat = function (label, value, sub, klass) { return '<div class="stat"><span class="label">' + esc(label) + '</span><span class="value ' + (klass || '') + '">' + esc(value) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</div>'; };
    $('acct').innerHTML =
      stat(T('Equity'), money(mtm.equity), T('cash + positions')) +
      stat(T('Cash'), money(mtm.cash), mtm.marginUsed ? T('margin used {amount}', { amount: money(mtm.marginUsed) }) : T('buying power')) +
      stat(T('Total P&L'), signed(mtm.totalPnL), T('{pct} since start', { pct: pct(mtm.totalPnLPct) }), cls(mtm.totalPnL)) +
      stat(T('Day P&L'), signed(mtm.dayPnL), T('unrealized {amount}', { amount: signed(mtm.unrealized) }), cls(mtm.dayPnL));
    var pos = position(), row = $('posRow');
    if (pos && bars.length) {
      var px = lastPrice(), upl = (px - pos.avg) * pos.qty;
      row.hidden = false;
      row.innerHTML = '<span>' + esc(T(pos.qty > 0 ? 'Long' : 'Short')) + ' <b class="num">' + Math.abs(pos.qty) + '</b> ' + esc(symbol) + ' @ <span class="num">' + money(pos.avg) + '</span></span><span class="num ' + cls(upl) + '">' + signed(upl) + ' (' + pct((px - pos.avg) / pos.avg * 100 * (pos.qty > 0 ? 1 : -1)) + ')</span><button class="sm" id="closePos" type="button">' + esc(T('Close')) + '</button>';
      $('closePos').onclick = function () {
        if (this.dataset.arm) {
          var lg = leagueCheck({ symbol: symbol, side: pos.qty > 0 ? 'sell' : 'buy', qty: Math.abs(pos.qty), type: 'market' }, lastPrice());
          if (!lg.ok) { toast(lg.reason, 'err', T('League rule'), 7000); return; }
          var tradesBefore = paper.state.trades.length;
          var o = paper.closePosition(symbol, lastPrice());
          toast(o.status === 'filled' ? o.reason : T('Could not close: {reason}', { reason: o.reason }), o.status === 'filled' ? 'ok' : 'err');
          if (o.status === 'filled') afterFill(o, paper.state.trades.slice(tradesBefore));
          renderAccount(); renderOrders();
        }
        else { this.dataset.arm = '1'; this.textContent = T('Confirm close'); var self = this; setTimeout(function () { self.textContent = T('Close'); delete self.dataset.arm; }, 4000); }
      };
    } else row.hidden = true;
    var trades = paper.state.trades.slice(-40).reverse();
    $('log').innerHTML = trades.length ? trades.map(function (t) {
      var when = typeof t.time === 'string' ? t.time : new Date((t.time > 1e11 ? t.time : t.time * 1000)).toLocaleString(loc(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return '<tr><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + esc(T(t.side === 'buy' ? 'BUY' : 'SELL')) + '</td><td>' + esc(t.symbol) + '</td><td class="num">' + t.qty + '</td><td class="num">' + money(t.price) + '</td><td class="num ' + cls(t.realized) + '">' + (t.closedQty ? signed(t.realized) : '') + '</td><td class="muted">' + esc(when) + '</td></tr>';
    }).join('') : '<tr><td class="muted">' + esc(T('No trades yet. Try buying when the signal says BUY and watch what happens — it is play money.')) + '</td></tr>';
    renderTicket();
  }
  $('reset').onclick = function () {
    var b = this;
    if (b.dataset.arm) {
      var lgR = isLeagueAccount(activeAccount());
      if (lgR) { delete b.dataset.arm; b.textContent = T('Reset'); toast(T('League accounts cannot be reset: every member starts with the same cash and keeps their own record until the league ends.'), 'warn', T('League rule'), 7000); return; }
      var start = paper.state.startingCash || 100000;
      paper.reset(start); delete b.dataset.arm; b.textContent = T('Reset'); hideConfirm(); renderAccount(); renderOrders(); renderAccountSwitcher();
      toast(T('Fresh {cash} paper account. Your trade history was cleared.', { cash: money(start) }), 'ok', T('Account reset'));
    }
    else { b.dataset.arm = '1'; b.textContent = T('Confirm reset'); setTimeout(function () { b.textContent = T('Reset'); delete b.dataset.arm; }, 4000); }
  };

  /**
   * League accounts freeze at the end date: once BT.leagues.tradingOpen() is false, working orders on the
   * league account are cancelled with finishedReason() instead of filling. An orphaned league account
   * (league no longer saved here) fills nothing, because its rules cannot be checked. → true when frozen.
   */
  function freezeLeagueOrders() {
    var id = activeAccount();
    if (!isLeagueAccount(id)) return false;
    var L = BT.leagues, lg = leagueOf(id);
    if (!lg || !L) return true;
    var open = true;
    try { open = typeof L.tradingOpen === 'function' ? L.tradingOpen(id) : (typeof L.phase === 'function' ? L.phase(lg) === 'active' : true); } catch (e) { open = true; }
    if (open) return false;
    var working = paper.openOrders();
    if (!working.length) return true;
    var reason = typeof L.finishedReason === 'function' ? L.finishedReason(lg) : T('League finished');
    working.forEach(function (o) { var c = paper.cancelOrder(o.id); if (c) c.reason = reason; });
    if (typeof paper.save === 'function') paper.save();
    toast(T(working.length === 1 ? '{reason}: 1 working order on this league account was cancelled instead of filling, so your result stays as it was at the end date.' : '{reason}: {n} working orders on this league account were cancelled instead of filling, so your result stays as it was at the end date.', { reason: reason, n: working.length }), 'warn', T('League rule'), 7000);
    renderOrders(); renderAccount();
    return true;
  }

  /** Fill resting orders against a bar and tell the student. */
  function processFills(sym, bar) {
    if (freezeLeagueOrders()) return [];
    var before = paper.openOrders(sym);
    var fills = paper.processOrders(sym, bar) || [];
    fills.forEach(function (f) {
      var o = f.order, tr = f.trade;
      // Report what traded on THIS bar: with the volume fill model one order can fill in several pieces.
      var fillQty = tr && tr.qty > 0 ? tr.qty : o.qty, fillPx = tr && tr.price > 0 ? tr.price : o.fillPrice;
      var isPartial = o.status === 'open' && !!o.partial;
      var msg = T(o.side === 'buy' ? 'Bought {qty} {symbol} @ {price} — your {type} price was reached.' : 'Sold {qty} {symbol} @ {price} — your {type} price was reached.', { qty: fillQty, symbol: o.symbol, price: money(fillPx), type: T(TYPE_NAMES[o.type] || o.type).toLowerCase() });
      if (isPartial) msg += ' ' + T('Partial fill: {filled} of {qty} done so far; the remaining {left} keep working on later bars.', { filled: o.filledQty, qty: o.qty, left: o.qty - o.filledQty });
      else if (o.filledQty > fillQty) msg += ' ' + T('Order complete: all {qty} filled, average {avg}.', { qty: o.qty, avg: money(o.fillPrice) });
      toast(msg, 'ok', isPartial ? T('Partial fill') : T('Order filled'));
      if (o.meta && o.meta.protectStop && !o.meta.protectPlaced && o.status === 'filled') {
        o.meta.protectPlaced = true;
        placeProtectiveStop(o, o.meta.protectStop);
      }
      afterFill(o, f.trade ? [f.trade] : []);
    });
    // Orders that were rejected at fill time (e.g. cash ran out) or expired (day orders) are not fills, but the student should hear about them.
    var changed = fills.length > 0;
    before.forEach(function (o) {
      if (o.status === 'open' || o.status === 'filled') return;
      changed = true;
      if (o.status === 'rejected') toast(o.reason, 'err', 'Order could not fill', 7000);
      else if (o.status === 'expired') toast(paper.describeOrder(o) + ' ' + T('The day order expired unfilled.'), 'warn', 'Order expired');
    });
    if (changed) { renderOrders(); renderAccount(); }
    return fills;
  }

  /* ------------------------------------------------------------------ *
   * Alerts (js/alerts.js → BT.alerts)
   * ------------------------------------------------------------------ */
  var ALERT_FIELD = {
    price_above: { label: 'Price ($)', placeholder: function () { return bars.length ? fmt(lastPrice()) : '0.00'; }, mode: 'decimal' },
    price_below: { label: 'Price ($)', placeholder: function () { return bars.length ? fmt(lastPrice()) : '0.00'; }, mode: 'decimal' },
    rsi_above: { label: 'RSI level', placeholder: function () { return '70'; }, mode: 'decimal' },
    rsi_below: { label: 'RSI level', placeholder: function () { return '30'; }, mode: 'decimal' },
    sma_cross: { label: 'Pair (fast/slow)', placeholder: function () { return '20/50'; }, mode: 'text' },
    signal_change: { label: 'Only when it turns (optional)', placeholder: function () { return 'BUY, SELL or leave empty'; }, mode: 'text' }
  };
  /** Run BT.alerts.check for a symbol; the module toasts + notifies, the panel and chart lines refresh here. */
  function runAlerts(sym, barsForSym, indForSym) {
    if (!alerts || !barsForSym || !barsForSym.length) return [];
    var fired = [];
    try { fired = alerts.check(sym, barsForSym, indForSym) || []; } catch (e) { console.warn('Alert check failed', e); return []; }
    if (fired.length) { renderAlerts(); if (sym === symbol) renderAlertLines(); }
    return fired;
  }
  function alertMsg(text, kind) { var m = $('alertMsg'); if (!m) return; m.textContent = text || ''; m.className = 'msg ' + (kind || ''); }
  function renderAlertForm() {
    if (!alerts || !$('alertKind')) return;
    var kind = $('alertKind').value, f = ALERT_FIELD[kind], def = alerts.KINDS[kind];
    $('alertSym').textContent = symbol;
    $('alertValueLabel').textContent = T(f.label);
    $('alertValue').placeholder = T(f.placeholder());
    $('alertValue').setAttribute('inputmode', f.mode);
    $('alertHelp').textContent = T(def.help) + (kind === 'price_above' || kind === 'price_below' ? ' ' + T('Current price:') + ' ' + (bars.length ? money(lastPrice()) : '—') + '.' : kind === 'rsi_above' || kind === 'rsi_below' ? ' ' + T('Current RSI:') + ' ' + (I && I.rsi && I.rsi[I.rsi.length - 1] != null ? I.rsi[I.rsi.length - 1].toFixed(1) : '—') + '.' : kind === 'signal_change' && sig ? ' ' + T('Current signal:') + ' ' + sig.state + '.' : '');
  }
  function renderNotifButton() {
    if (!alerts || !$('notifBtn')) return;
    var st = alerts.notificationState(), btn = $('notifBtn'), note = $('notifNote');
    btn.hidden = st !== 'default';
    if (st === 'granted') note.textContent = T('System notifications are on: fired alerts also appear as a notification when this tab is in the background.');
    else if (st === 'denied') note.textContent = T('Notifications are blocked for this site in your browser settings. Alerts still show as toasts while the page is open.');
    else if (st === 'unsupported') note.textContent = T('This browser cannot show system notifications (on iPhone, add the site to your Home Screen first). Alerts still show as toasts while the page is open.');
    else note.textContent = T('Alerts show as toasts while the page is open. Enable notifications to also get one when the tab is in the background.');
  }
  function fmtWhen(t) {
    if (!t) return '';
    var d = new Date(t), today = new Date();
    return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(loc(), { month: 'short', day: 'numeric' });
  }
  function renderAlerts() {
    if (!alerts || !$('alertList')) return;
    var all = alerts.list(), live_ = all.filter(function (a) { return a.enabled && !a.firedAt; });
    $('alertsCount').textContent = all.length ? T('{n} active', { n: live_.length }) + (all.length - live_.length ? ' · ' + T('{n} fired', { n: all.length - live_.length }) : '') : '';
    // Current symbol first, then live before fired, newest first.
    var rows = all.slice().sort(function (a, b) {
      var sa = (a.symbol === symbol ? 0 : 1) - (b.symbol === symbol ? 0 : 1); if (sa) return sa;
      var fa = (a.firedAt ? 1 : 0) - (b.firedAt ? 1 : 0); if (fa) return fa;
      return b.id - a.id;
    });
    $('alertList').innerHTML = rows.length ? rows.map(function (a) {
      var fired = !!a.firedAt, def = alerts.KINDS[a.kind];
      if (!def) def = { label: a.kind, short: a.kind };
      var valTxt = a.kind === 'price_above' || a.kind === 'price_below' ? money(a.value) : a.kind === 'sma_cross' ? 'SMA ' + String(a.value).replace('/', ' / ') : a.kind === 'signal_change' ? (a.value || T('any change')) : a.kind === 'rule' ? (a.rule && a.rule.name ? a.rule.name : T('rule')) : String(a.value);
      var at = a.lastValue == null ? '' : a.kind.indexOf('price') === 0 ? T('at {price}', { price: money(a.lastValue) }) : a.kind.indexOf('rsi') === 0 ? T('at RSI {v}', { v: (+a.lastValue).toFixed(1) }) : a.kind === 'sma_cross' ? '· ' + T(a.lastValue > 0 ? 'golden cross' : 'death cross') : a.kind === 'signal_change' ? '· ' + T('now {state}', { state: String(a.lastValue) }) : '';
      var state = fired ? '<span class="type">' + esc(T('fired {when}', { when: fmtWhen(a.firedAt) }) + (at ? ' ' + at : '')) + '</span>' : (!a.enabled ? '<span class="type">' + esc(T('paused')) + '</span>' : '<span class="type">' + esc(T('watching · {what}', { what: T(def.short) })) + '</span>');
      return '<tr' + (fired ? ' style="opacity:.65"' : '') + '><td><b' + (a.symbol === symbol ? '' : ' class="muted"') + '>' + esc(a.symbol) + '</b> <span class="' + (a.kind === 'price_below' || a.kind === 'rsi_above' ? 'down' : a.kind === 'price_above' || a.kind === 'rsi_below' ? 'up' : '') + '">' + esc(T(String(def.label).replace(' (20/50)', '').replace(' (BUY/SELL/HOLD)', ''))) + '</span>' + state + '</td><td class="num">' + esc(valTxt) + '</td><td style="white-space:nowrap">' + (fired ? '<button class="sm ghost" data-rearm="' + a.id + '" title="' + esc(T('Watch for this again')) + '" aria-label="' + esc(T('Watch for this again')) + '">↻</button>' : '') + '<button class="sm ghost" data-rmalert="' + a.id + '" title="' + esc(T('Remove this alert')) + '" aria-label="' + esc(T('Remove alert')) + '">✕</button></td></tr>';
    }).join('') : '<tr><td class="muted">' + esc(T('No alerts yet. Pick a condition above and tap Add: try “Price falls below” a little under the last price, then watch the dotted line on the chart.')) + '</td></tr>';
    $$('[data-rmalert]', $('alertList')).forEach(function (b) {
      b.onclick = function () { var a = alerts.remove(+b.dataset.rmalert); if (a) alertMsg(T('Removed: {alert}.', { alert: alerts.describe(a) }), ''); renderAlerts(); renderAlertLines(); };
    });
    $$('[data-rearm]', $('alertList')).forEach(function (b) {
      b.onclick = function () {
        var a = alerts.rearm(+b.dataset.rearm);
        if (a) alertMsg(T('Watching again: {alert}. It fires the next time the condition becomes true.', { alert: alerts.describe(a) }), 'ok');
        renderAlerts(); renderAlertLines();
        if (a && a.symbol === symbol) runAlerts(symbol, bars, I);
      };
    });
  }
  function addAlertFromForm() {
    if (!alerts) return;
    var kind = $('alertKind').value, raw = $('alertValue').value.trim();
    var def = alerts.KINDS[kind];
    if (def.needsValue && !raw) {
      alertMsg(def.group === 'price'
        ? T('Type a price first. Current price is {price}.', { price: bars.length ? money(lastPrice()) : '—' })
        : T('Type a level first. Current RSI is {rsi}.', { rsi: I && I.rsi && I.rsi[I.rsi.length - 1] != null ? I.rsi[I.rsi.length - 1].toFixed(1) : '—' }), 'err');
      $('alertValue').focus(); return;
    }
    var a = alerts.add({ symbol: symbol, kind: kind, value: raw });
    if (a.status === 'rejected') { alertMsg(T(a.reason), 'err'); $('alertValue').focus(); return; }
    awardXp('alert', String(a.id));
    var hint = '';
    if (bars.length && (kind === 'price_above' || kind === 'price_below')) {
      var px = lastPrice(), dist = (a.value - px) / px * 100;
      if ((kind === 'price_above' && a.value <= px) || (kind === 'price_below' && a.value >= px)) hint = ' ' + T(kind === 'price_above' ? 'That level is already below the current price, so it will fire on the next tick.' : 'That level is already above the current price, so it will fire on the next tick.');
      else hint = ' ' + T(dist > 0 ? 'That is {pct}% above the last price.' : 'That is {pct}% below the last price.', { pct: Math.abs(dist).toFixed(1) });
    }
    alertMsg(T('Saved: {alert}.', { alert: alerts.describe(a) }) + hint, 'ok');
    $('alertValue').value = '';
    renderAlerts(); renderAlertLines();
    runAlerts(symbol, bars, I);
    if (alerts.notificationState() === 'default' && alerts.list().length === 1) toast('Tip: tap “Enable notifications” in the Alerts card to hear about it even when this tab is in the background.', 'ok', 'First alert saved', 7000);
  }
  if (alerts && $('alertForm')) {
    $('alertForm').addEventListener('submit', function (e) { e.preventDefault(); addAlertFromForm(); });
    $('alertKind').onchange = function () { $('alertValue').value = ''; alertMsg(''); renderAlertForm(); };
    $('alertValue').oninput = function () { alertMsg(''); };
    $('notifBtn').onclick = function () {
      var btn = this; btn.disabled = true;
      alerts.requestPermission().then(function (p) {
        btn.disabled = false; renderNotifButton();
        if (p === 'granted') { toast('You will get a system notification when an alert fires, even with this tab in the background.', 'ok', 'Notifications on'); alerts.testNotification(); }
        else if (p === 'denied') toast('Notifications were blocked. You can allow them later in the browser\'s site settings; toasts keep working meanwhile.', 'warn', 'Notifications off', 7000);
      });
    };
    $('alertsClear').onclick = function () {
      var fired = alerts.list().filter(function (a) { return a.firedAt; });
      if (!fired.length) { alertMsg(T('Nothing to clear: no alert has fired yet.'), ''); return; }
      fired.forEach(function (a) { alerts.remove(a.id); });
      alertMsg(T(fired.length > 1 ? 'Cleared {n} fired alerts.' : 'Cleared {n} fired alert.', { n: fired.length }), 'ok');
      renderAlerts(); renderAlertLines();
    };
    alerts.on(function (fired) {
      // Keep the list in sync when an alert fires from a watchlist quote or another tab's check.
      renderAlerts();
      if (fired.some(function (f) { return f.symbol === symbol; })) renderAlertLines();
    });
    window.addEventListener('storage', function (e) { if (e.key === alerts.STORAGE_KEY) { alerts.load(); renderAlerts(); renderAlertLines(); } });
    renderNotifButton();
  } else if ($('panel-alerts')) {
    $('panel-alerts').hidden = true;
  }
  /** Focus the alert form (keyboard A); picks a sensible default kind. */
  function focusAlert(kind) {
    if (!alerts || !$('alertKind')) return;
    var card = $('panel-alerts'); card.classList.remove('collapsed');
    if (kind) $('alertKind').value = kind;
    renderAlertForm();
    try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    $('alertValue').focus();
  }

  /* ------------------------------------------------------------------ *
   * Watchlist
   * ------------------------------------------------------------------ */
  function saveWatchlist() { store.set('bt.watchlist', watchlist); }
  function renderWatchlist() {
    var ul = $('wlList');
    if (!watchlist.length) { ul.innerHTML = '<li class="empty">' + esc(T('Your watchlist is empty. Search a symbol and press + Add (or W).')) + '</li>'; return; }
    ul.innerHTML = watchlist.map(function (s) {
      var u = data.lookup(s), q = wlQuotes[s], px = q && q.price, chg = q && q.prevClose ? (q.price - q.prevClose) / q.prevClose * 100 : null;
      return '<li data-sym="' + esc(s) + '" class="' + (s === symbol ? 'on' : '') + '">' +
        '<button class="pick" type="button" data-pick="' + esc(s) + '" title="' + esc(u.name) + '"' + (s === symbol ? ' aria-current="true"' : '') + '>' +
        '<span class="sym">' + esc(s) + '</span><span class="px" id="wlpx-' + esc(s) + '">' + (px ? fmt(px) : '…') + '</span>' +
        '<span class="nm">' + esc(u.name) + '</span><span class="ch ' + (chg == null ? 'muted' : cls(chg)) + '">' + (chg == null ? '' : pct(chg)) + '</span></button>' +
        '<button class="rm" type="button" data-rm="' + esc(s) + '" title="' + esc(T('Remove {symbol} from the watchlist', { symbol: s })) + '" aria-label="' + esc(T('Remove {symbol}', { symbol: s })) + '">✕</button></li>';
    }).join('');
    $$('[data-pick]', ul).forEach(function (b) { b.onclick = function () { setSymbol(b.dataset.pick); }; });
    $$('[data-rm]', ul).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); removeFromWatchlist(b.dataset.rm); }; });
  }
  function addToWatchlist(s) {
    s = cleanSym(s); if (!s) return;
    if (watchlist.indexOf(s) >= 0) { toast(T('{symbol} is already on your watchlist.', { symbol: s }), 'warn'); return; }
    if (watchlist.length >= MAX_WATCHLIST) { toast(T('Watchlists are capped at {max} symbols to stay inside free data quotas. Remove one first.', { max: MAX_WATCHLIST }), 'warn'); return; }
    watchlist.push(s); saveWatchlist(); renderWatchlist(); refreshWatchlist(true);
    toast(T('{symbol} added. Its price refreshes with the market.', { symbol: s }), 'ok');
  }
  function removeFromWatchlist(s) {
    watchlist = watchlist.filter(function (x) { return x !== s; }); saveWatchlist(); renderWatchlist();
  }
  $('wlAdd').onclick = function () { addToWatchlist(symbol); };

  var wlBusy = false;
  async function refreshWatchlist(force) {
    if (wlBusy || (document.hidden && !force)) return;
    wlBusy = true;
    try {
      for (var k = 0; k < watchlist.length; k++) {
        var s = watchlist[k];
        if (s === symbol && bars.length) {
          wlQuotes[s] = { price: lastPrice(), prevClose: prevClose(), time: Date.now() / 1000 };
          paintQuote(s); continue;
        }
        try {
          // "Today" is per market: NYSE rows roll on the New York date, crypto rows at 00:00 UTC.
          var ms = data.marketStatus(s), today = ms.always && ms.utcDate ? ms.utcDate : ms.nyDate;
          if (!wlPrev[s] || wlPrev[s].day !== today) {
            var d = await data.candles(s, '1day', 3), n = d.length, pc = null;
            // Prior close = the last completed session. If today's bar is already in the series, step back one more.
            if (n >= 2) pc = d[n - 1].time === today ? d[n - 2].close : d[n - 1].close;
            wlPrev[s] = { prevClose: pc, day: today };
          }
          var q = await data.quote(s);
          wlQuotes[s] = { price: q.price, prevClose: wlPrev[s].prevClose, time: q.time, live: !!q.live && !q.fallback };
          paintQuote(s);
          // Resting orders on other symbols fill against their quote (a one-price bar); price alerts check it too.
          var qBar = { time: q.time, open: q.price, high: q.price, low: q.price, close: q.price, volume: 0 };
          if (paper.openOrders(s).length) processFills(s, qBar);
          if (alerts && alerts.list(s).length) runAlerts(s, [qBar], null);
        } catch (e) { /* keep the previous quote */ }
      }
    } finally { wlBusy = false; }
    renderAccount();
  }
  function paintQuote(s) {
    var li = null, lis = $$('.wl-list li[data-sym]');
    for (var i = 0; i < lis.length; i++) { if (lis[i].dataset.sym === s) { li = lis[i]; break; } }
    if (!li) return;
    var q = wlQuotes[s], pxEl = li.querySelector('.px'), chEl = li.querySelector('.ch');
    var old = parseFloat(pxEl.textContent.replace(/,/g, ''));
    pxEl.textContent = fmt(q.price);
    if (isFinite(old) && old !== q.price) { pxEl.classList.remove('flash-up', 'flash-down'); void pxEl.offsetWidth; pxEl.classList.add(q.price > old ? 'flash-up' : 'flash-down'); }
    if (q.prevClose) { var chg = (q.price - q.prevClose) / q.prevClose * 100; chEl.textContent = pct(chg); chEl.className = 'ch ' + cls(chg); }
  }
  function scheduleWatchlist() {
    clearInterval(wlTimer);
    wlTimer = setInterval(function () { refreshWatchlist(); }, live ? 60000 : 8000);
  }

  /* ------------------------------------------------------------------ *
   * Symbol search with autocomplete
   * ------------------------------------------------------------------ */
  var searchBox = $('searchBox'), symInput = $('sym'), results = $('searchResults'), searchRows = [], activeRow = -1, searchSeq = 0;
  function showResults(rows, note) {
    searchRows = rows; activeRow = rows.length ? 0 : -1;
    results.innerHTML = rows.map(function (r, i) {
      return '<li role="option" data-i="' + i + '" class="' + (i === activeRow ? 'active' : '') + '" aria-selected="' + (i === activeRow) + '"><span class="sym">' + esc(r.symbol) + '</span><span class="nm">' + esc(r.name || '') + '</span><span class="ex">' + esc(r.exchange || '') + '</span></li>';
    }).join('') + (note ? '<li class="hint">' + esc(note) + '</li>' : '') + (!rows.length ? '<li class="hint">' + esc(T(live ? 'No match in the list. Press Enter to chart “{query}” anyway.' : 'No match in the list. Press Enter to chart “{query}” anyway (simulated for unknown tickers).', { query: symInput.value.toUpperCase() })) + '</li>' : '');
    results.hidden = false; searchBox.setAttribute('aria-expanded', 'true');
    $$('li[data-i]', results).forEach(function (li) {
      li.onmousedown = function (e) { e.preventDefault(); pick(+li.dataset.i); };
      li.onmousemove = function () { setActive(+li.dataset.i); };
    });
  }
  function hideResults() { results.hidden = true; searchBox.setAttribute('aria-expanded', 'false'); activeRow = -1; }
  function setActive(i) {
    activeRow = i;
    $$('li[data-i]', results).forEach(function (li) { var on = +li.dataset.i === i; li.classList.toggle('active', on); li.setAttribute('aria-selected', String(on)); if (on) li.scrollIntoView({ block: 'nearest' }); });
  }
  function pick(i) {
    var r = searchRows[i]; if (!r) return;
    symInput.value = ''; hideResults(); setSymbol(r.symbol); symInput.blur();
  }
  var doSearch = debounce(async function () {
    var q = symInput.value.trim(), seq = ++searchSeq;
    if (!q) { showResults((await data.search('')).slice(0, 10), T('Popular symbols — start typing to filter')); return; }
    try {
      var rows = await data.search(q);
      if (seq !== searchSeq) return;
      showResults(rows.slice(0, 10), rows.fallback ? T('Provider search unavailable ({reason}); showing the built-in list.', { reason: rows.reason }) : null);
    } catch (e) { if (seq === searchSeq) showResults([], null); }
  }, 160);
  symInput.addEventListener('input', doSearch);
  symInput.addEventListener('focus', function () { doSearch(); });
  symInput.addEventListener('blur', function () { setTimeout(hideResults, 150); });
  symInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.hidden) doSearch(); else setActive(Math.min(searchRows.length - 1, activeRow + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, activeRow - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!results.hidden && activeRow >= 0 && searchRows[activeRow]) pick(activeRow);
      else { var s = symInput.value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, ''); if (s) { symInput.value = ''; hideResults(); setSymbol(s); symInput.blur(); } }
    }
    else if (e.key === 'Escape') { hideResults(); symInput.blur(); }
  });

  /* ------------------------------------------------------------------ *
   * Loading data & live updates
   * ------------------------------------------------------------------ */
  function tfLabel(t) { return { '1day': '1D', '1h': '1H', '15min': '15m', '5min': '5m' }[t] || t; }
  function stopTimers() { clearInterval(tickTimer); clearInterval(pollTimer); tickTimer = pollTimer = null; }

  async function load() {
    var seq = ++loadSeq;
    stopTimers(); hideConfirm(); setDrawing(false);
    $('loading').hidden = false; $('loading').textContent = T('Loading {symbol} {tf}…', { symbol: symbol, tf: tfLabel(tf) });
    var res;
    try { res = await data.candles(symbol, tf, LIMIT[tf]); }
    catch (e) { res = data.demo(symbol, tf, LIMIT[tf]); res.fallback = true; res.reason = (e && e.message) || 'Data error'; }
    if (seq !== loadSeq) return;                       // a newer load superseded this one
    bars = res; bars.symbol = symbol;
    live = !!res.live && !res.fallback;
    dataInfo = { source: res.source, reason: res.reason, fallback: !!res.fallback, cached: !!res.cached, stale: !!res.stale, ageMs: res.ageMs };
    allCharts().forEach(function (c) { c.applyOptions({ timeScale: { timeVisible: tf !== '1day' } }); });
    reindex(); compute(); renderSeries(); renderHeader(); renderSignal(); renderMode(); renderAccount(); renderOrders(); renderWatchlist();
    renderAlertForm(); renderAlerts(); renderAccountSwitcher(); renderAutoPanel();
    updatePaneTags(bars.length - 1);
    chP.timeScale().fitContent();
    if (tf !== '1day' && bars.length > 160) chP.timeScale().setVisibleLogicalRange({ from: bars.length - 160, to: bars.length + 3 });
    $('loading').hidden = true;
    if (live) pollTimer = setInterval(pollQuote, 60000);
    else tickTimer = setInterval(demoTick, 3000);
    scheduleWatchlist(); refreshWatchlist(true);
    processFills(symbol, bars[bars.length - 1]);
    runAlerts(symbol, bars, alertInd());
    checkAuto();
    updateHash();
  }
  /** Indicators plus the composite signal, in the shape BT.alerts.check expects. */
  function alertInd() { return I ? Object.assign({}, I, { signal: sig }) : null; }

  function afterTick() {
    reindex(); compute(); renderSeries(); renderHeader(); renderSignal();
    updatePaneTags(bars.length - 1);
    processFills(symbol, bars[bars.length - 1]);
    runAlerts(symbol, bars, alertInd());
    wlQuotes[symbol] = { price: lastPrice(), prevClose: prevClose(), time: Date.now() / 1000 };
    paintQuote(symbol);
    renderAccount();
    checkAuto();
  }
  function demoTick() {
    if (document.hidden || !bars.length) return;
    var n = bars.length;
    data.demoTick(bars);
    if (bars.length !== n) { afterTick(); return; }     // a new bar started: full redraw
    afterTick();
  }
  async function pollQuote() {
    if (document.hidden || !bars.length) return;
    try {
      var q = await data.quote(symbol);
      if (!q || !(q.price > 0) || q.fallback) { if (q && q.fallback) { dataInfo.stale = true; dataInfo.reason = q.reason; renderMode(); } return; }
      var last = bars[bars.length - 1];
      last.close = q.price; if (q.price > last.high) last.high = q.price; if (q.price < last.low) last.low = q.price;
      dataInfo.stale = false; renderMode();
      afterTick();
    } catch (e) { $('msg').textContent = T('Quote refresh failed: {error}', { error: e && e.message }); }
  }

  /* Ticker whitelist: uppercase letters, digits, dot and dash (BRK.B, BF-B), 12 chars max.
   * Anything else (quotes, slashes, spaces, __proto__ ...) would reach a CSS selector in paintQuote()
   * and the data provider's URL, so it is stripped at every entry point: hash, search, watchlist. */
  function cleanSym(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12); }
  function setSymbol(s) {
    s = cleanSym(s); if (!s) return;
    symbol = s; store.set('bt.sym', symbol);
    hideProposal();
    $('ticketSym').textContent = symbol; $('symName').textContent = data.lookup(symbol).name;
    renderWatchlist();
    load();
  }
  function setInterval_(t) {
    if (INTERVALS.indexOf(t) < 0) return;
    tf = t; store.set('bt.tf', tf);
    $$('.tf').forEach(function (b) { b.classList.toggle('on', b.dataset.tf === tf); });
    load();
  }

  /* ---- URL hash: #AAPL or #symbol=NVDA&interval=1h&ov=sma20,bb&pane=rsi ---- */
  var applyingHash = false;
  // A stray '%' in a shared link must never throw: decode each piece defensively and fall back to the raw text.
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function readHash() {
    var h = (location.hash || '').replace(/^#/, ''); if (!h) return false;
    var changed = false;
    if (h.indexOf('=') < 0) { var s = cleanSym(safeDecode(h)); if (s && s !== symbol) { symbol = s; store.set('bt.sym', symbol); changed = true; } return changed; }
    h.split('&').forEach(function (kv) {
      var p = kv.split('='), k = safeDecode(p[0]), v = safeDecode(p.slice(1).join('='));
      if (k === 'symbol' && v) { var s2 = cleanSym(v); if (s2 && s2 !== symbol) { symbol = s2; store.set('bt.sym', symbol); changed = true; } }
      else if (k === 'interval' && INTERVALS.indexOf(v) >= 0) { if (v !== tf) { tf = v; store.set('bt.tf', tf); changed = true; } }
      else if (k === 'ov' || k === 'overlays') { Object.keys(ov).forEach(function (o) { ov[o] = false; }); v.split(',').forEach(function (o) { if (o in ov) ov[o] = true; else if (o === 'bollinger') ov.bb = true; else if (o === 'ichimoku') ov.ichi = true; else if (o === 'patterns') ov.pat = true; else if (o === 'signals') ov.sig = true; }); store.set('bt.ov', ov); }
      else if (k === 'pane' || k === 'panes') { Object.keys(panes).forEach(function (o) { panes[o] = false; }); v.split(',').forEach(function (o) { if (o in panes) panes[o] = true; }); store.set('bt.panes', panes); }
    });
    return changed;
  }
  function updateHash() {
    applyingHash = true;
    try { history.replaceState(null, '', '#symbol=' + encodeURIComponent(symbol) + '&interval=' + tf); } catch (e) { /* file:// in some browsers */ }
    setTimeout(function () { applyingHash = false; }, 0);
  }
  window.addEventListener('hashchange', function () {
    if (applyingHash) return;
    try { readHash(); } catch (e) { console.warn('Ignoring unreadable URL hash', e); }
    syncToggles(); load();
  });

  /* ------------------------------------------------------------------ *
   * Toolbar wiring
   * ------------------------------------------------------------------ */
  function syncToggles() {
    $$('.tf').forEach(function (b) { b.classList.toggle('on', b.dataset.tf === tf); });
    $$('.ov').forEach(function (b) { b.classList.toggle('on', !!ov[b.dataset.ov]); b.setAttribute('aria-pressed', String(!!ov[b.dataset.ov])); });
    $$('.pn').forEach(function (b) { b.classList.toggle('on', !!panes[b.dataset.pn]); b.setAttribute('aria-pressed', String(!!panes[b.dataset.pn])); });
    Object.keys(panes).forEach(function (k) { if (panes[k]) addPane(k); else removePane(k); });
  }
  $$('.tf').forEach(function (b) { b.onclick = function () { setInterval_(b.dataset.tf); }; });
  $$('.ov').forEach(function (b) {
    b.onclick = function () {
      var k = b.dataset.ov; ov[k] = !ov[k]; store.set('bt.ov', ov);
      b.classList.toggle('on', ov[k]); b.setAttribute('aria-pressed', String(ov[k]));
      if (bars.length) { renderSeries(); renderHeader(); }
      if (ov[k] && k === 'ichi') toast('Price above the green/red cloud = uptrend, below = downtrend. The cloud is drawn 26 bars ahead, so you can see where support should be next month.', 'ok', 'Ichimoku on', 7000);
      if (ov[k] && k === 'fib') toast('Levels are drawn from the highest high and lowest low of the last 120 bars. Watch the 38.2 %, 50 % and 61.8 % lines for pullbacks to pause.', 'ok', 'Fibonacci on', 7000);
      if (ov[k] && k === 'vwap' && tf === '1day') toast('On daily bars VWAP is cumulative over the whole history. Switch to an intraday interval to see the session VWAP day traders use.', 'warn', 'VWAP note', 7000);
    };
  });
  $$('.pn').forEach(function (b) { b.onclick = function () { togglePane(b.dataset.pn); }; });

  /* ------------------------------------------------------------------ *
   * Market clock (NYSE for stocks and ETFs; crypto never closes)
   * ------------------------------------------------------------------ */
  function tickClock() {
    var st = data.marketStatus(symbol), el = $('clock'), t = $('clockText');
    if (st.always) {
      // Crypto spot markets have no bell: no phase, no next open, daily candles roll at 00:00 UTC.
      t.textContent = T('Crypto {time} · Open 24/7', { time: st.utcTime });
      el.className = 'clock open';
      el.title = st.note || T('Crypto trades 24 hours a day, 7 days a week. Daily candles roll at 00:00 UTC.');
      return;
    }
    // Built through T() with the variable parts interpolated: the pill is rewritten every second, so the
    // DOM translator (exact-string matches) could never keep up with it. English output is unchanged.
    var text;
    if (st.phase === 'open') text = T('NYSE {time} · Open · closes {at}', { time: st.nyTime, at: st.closesAt });
    else if (st.phase === 'pre') text = T('NYSE {time} · Pre-market · opens 09:30', { time: st.nyTime });
    else {
      var secs = st.nextOpen - Math.floor(Date.now() / 1000), hrs = Math.floor(secs / 3600), mins = Math.floor((secs % 3600) / 60);
      var wait = hrs >= 24 ? Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h' : hrs + 'h ' + mins + 'm';
      var label = st.phase === 'after' ? T('After hours') : T('Closed');
      var reason = st.reason ? (/^Holiday: /.test(st.reason) ? T('Holiday: {holiday}', { holiday: st.reason.slice(9) }) : T(st.reason)) : '';
      text = reason
        ? T('NYSE {time} · {label} · {reason} · opens in {wait}', { time: st.nyTime, label: label, reason: reason, wait: wait })
        : T('NYSE {time} · {label} · opens in {wait}', { time: st.nyTime, label: label, wait: wait });
    }
    t.textContent = text;
    el.className = 'clock ' + st.phase;
    el.title = st.holiday ? T('Market holiday: {holiday}', { holiday: st.holiday }) : st.earlyClose ? T('Early close today at {time}', { time: st.closesAt }) : T('New York Stock Exchange regular session is 9:30–16:00 ET, Monday to Friday except holidays.');
  }
  setInterval(tickClock, 1000); tickClock();

  /* ------------------------------------------------------------------ *
   * Settings modal (data provider & API keys)
   * ------------------------------------------------------------------ */
  var PROVIDERS = ['twelvedata', 'finnhub', 'alphavantage'];
  function openSettings() {
    var s = data.getSettings();
    $('provider').value = s.provider;
    PROVIDERS.forEach(function (p) { $('key-' + p).value = s.keys[p] || ''; });
    $('testOut').textContent = '';
    renderQuota();
    $('settingsModal').hidden = false; document.body.classList.add('modal-open');
    $('provider').focus();
  }
  function closeSettings() { $('settingsModal').hidden = true; document.body.classList.remove('modal-open'); }
  function renderQuota() {
    var st = data.status(), q = $('quota');
    if (st.provider === 'demo') { q.textContent = T('Demo mode: no network requests, no quota.'); return; }
    var r = st.rate || {}, lim = st.limits || {};
    var parts = [T(st.hasKey ? 'Provider: {provider} (key saved)' : 'Provider: {provider} (no key yet)', { provider: st.label })];
    if (lim.perMinute && isFinite(lim.perMinute)) parts.push(T('this minute: {used}/{max}', { used: r.minuteUsed != null ? r.minuteUsed : r.usedMinute != null ? r.usedMinute : '?', max: lim.perMinute }));
    if (lim.perDay && isFinite(lim.perDay)) parts.push(T('today: {used}/{max}', { used: r.dayUsed != null ? r.dayUsed : r.usedDay != null ? r.usedDay : '?', max: lim.perDay }));
    parts.push(T('candles cached 60 s intraday / 10 min daily, quotes 15 s'));
    q.textContent = parts.join(' · ');
  }
  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = closeSettings;
  $('settingsModal').addEventListener('click', function (e) { if (e.target === this) closeSettings(); });
  $$('.showkey').forEach(function (b) { b.onclick = function () { var inp = $(b.dataset.for); inp.type = inp.type === 'password' ? 'text' : 'password'; b.textContent = inp.type === 'password' ? T('Show') : T('Hide'); }; });
  $('provider').onchange = function () { $('testOut').textContent = ''; };
  $('testKey').onclick = async function () {
    var p = $('provider').value, out = $('testOut'), btn = this;
    if (p === 'demo') { out.className = 'test-out ok'; out.textContent = T('Demo needs no key: prices are generated locally.'); return; }
    var key = $('key-' + p).value.trim();
    if (!key) { out.className = 'test-out err'; out.textContent = T('Paste your {provider} key first.', { provider: data.PROVIDER_LABEL[p] }); return; }
    btn.disabled = true; out.className = 'test-out muted'; out.textContent = T('Asking {provider} for an AAPL quote…', { provider: data.PROVIDER_LABEL[p] });
    try {
      var q = await data.providers[p].quote('AAPL', key);
      out.className = 'test-out up'; out.textContent = T('Success: AAPL {price} from {provider}. Save to switch the dashboard to live prices.', { price: money(q.price), provider: data.PROVIDER_LABEL[p] });
    } catch (e) {
      out.className = 'test-out down';
      out.textContent = T('Failed: {error}', { error: data.explainError ? data.explainError(e, p) : (e && e.message) }) + (e instanceof TypeError ? ' ' + T('If you are viewing this inside an embedded preview, open the page directly in your browser.') : '');
    } finally { btn.disabled = false; }
  };
  $('clearCache').onclick = function () { data.clearCache(); toast('Cached candles and quotes cleared. The next load fetches fresh data (and counts against your quota).', 'ok'); renderQuota(); };
  $('settingsSave').onclick = function () {
    var keys = {}; PROVIDERS.forEach(function (p) { keys[p] = $('key-' + p).value.trim(); });
    var provider = $('provider').value;
    if (provider !== 'demo' && !keys[provider]) { $('testOut').className = 'test-out down'; $('testOut').textContent = T('That provider needs a key. Paste one or choose Demo.'); return; }
    data.setSettings({ provider: provider, keys: keys });
    closeSettings();
    toast(provider === 'demo' ? T('Running on simulated prices.') : T('Switching to {provider} live data.', { provider: data.PROVIDER_LABEL[provider] }), 'ok', 'Settings saved');
    wlPrev = {}; load();
  };

  /* ------------------------------------------------------------------ *
   * First-run tour
   * ------------------------------------------------------------------ */
  var TOUR = [
    { target: 'panel-search', title: 'Find a symbol', body: 'Type a ticker or company name (try “NVDA” or “Tesla”) and pick from the list — or press / anywhere. The big number is the last price and its change versus the prior close. The pill tells you honestly whether prices are live from a data provider or simulated demo data.' },
    { target: 'panel-chart', title: 'Read the chart', body: 'Candlesticks show open, high, low and close for each bar; the faint bars underneath are volume. Use the Interval buttons for daily or intraday bars, toggle Overlays like moving averages, Bollinger Bands, VWAP, Ichimoku and Fibonacci, and add indicator Panes (RSI, MACD, Stochastic, ADX, OBV, ATR). Hover a bar to read every value. Click ✎ Trend line, then two swing points, to draw your own line: it is saved for this symbol.' },
    { target: 'panel-watchlist', title: 'Keep a watchlist', body: 'Your watchlist shows live last prices and today\'s change for the names you follow. Click one to chart it, press W (or + Add) to add the current symbol, and hover to remove. Limit and stop orders on watchlist symbols fill against these quotes too.' },
    { target: 'panel-signal', title: 'Understand the signal', body: 'Six classic rules each vote −2 to +2: trend (price vs SMA 50, SMA 20 vs 50), momentum (RSI, MACD histogram), stretch (Bollinger position) and crossovers. +3 or more is BUY, −3 or less is SELL. Click “Why?” to read the reasoning behind every vote, and check the ADX line before trusting a crossover. This is a teaching tool, not advice.' },
    { target: 'panel-alerts', title: 'Set an alert', body: 'Ask to be told when price reaches a level, RSI gets stretched, the moving averages cross or the signal flips. Alerts fire as a toast while the page is open and, if you enable notifications, as a system notification when the tab is in the background. Price alerts draw a dotted line on the chart so you can see how far away your level is. Press A for a quick price alert.' },
    { target: 'panel-ticket', title: 'Place a practice trade', body: 'Buy, Sell, Short or Cover with market, limit, stop or stop-limit orders, sized in shares or dollars. Open “Plan this trade” to size the position from your stop and the % of equity you are willing to lose. Review shows exactly what will happen before you confirm. Working orders appear below and fill against each new bar the way a real broker fills them. If you joined a league, the Account menu switches to its separate account. Shortcuts: B for a buy ticket, S for sell.' },
    { target: 'panel-account', title: 'Track your $100,000', body: 'Equity, cash, total and day P&L update with every tick, and each fill lands in the log. The Portfolio page has the full picture, the Backtest page lets you test a rule on history, and the Learn page turns all of this into a course with quizzes and a certificate. Add a free API key under Live data whenever you want real prices.' }
  ];
  var tourStep = -1;
  function tourClear() { $$('.tour-target').forEach(function (el) { el.classList.remove('tour-target'); }); }
  function showTour(i) {
    tourClear();
    if (i < 0 || i >= TOUR.length) { endTour(); return; }
    tourStep = i;
    var step = TOUR[i], el = $(step.target);
    if (el) { el.classList.add('tour-target'); try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } }
    $('tourStep').textContent = T('Step {i} of {n}', { i: i + 1, n: TOUR.length });
    $('tourTitle').textContent = T(step.title); $('tourBody').textContent = T(step.body);
    $('tourDots').innerHTML = TOUR.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('');
    $('tourPrev').disabled = i === 0;
    $('tourNext').textContent = i === TOUR.length - 1 ? T('Start trading') : T('Next');
    $('tour').hidden = false; document.body.classList.add('touring');
  }
  function startTour() { showTour(0); }
  /**
   * endTour(finished?) — closes the tour. bt.tour.done is written on ANY close (Skip, backdrop, Escape, last step)
   * so the first-run auto-start never shows again; bt.tour.finished is written only when the student reached the
   * last step and tapped 'Start trading'. js/onboarding.js ticks the First Week 'Take the tour' task on the latter.
   */
  function endTour(finished) {
    tourClear(); $('tour').hidden = true; document.body.classList.remove('touring'); tourStep = -1;
    store.set('bt.tour.done', true);
    if (finished === true) store.set('bt.tour.finished', true);
  }
  $('tourBtn').onclick = startTour;
  $('tourNext').onclick = function () { if (tourStep >= TOUR.length - 1) endTour(true); else showTour(tourStep + 1); };
  $('tourPrev').onclick = function () { showTour(tourStep - 1); };
  $('tourSkip').onclick = endTour;
  $('tourBackdrop').onclick = endTour;

  /* ------------------------------------------------------------------ *
   * Keyboard shortcuts
   * ------------------------------------------------------------------ */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('settingsModal').hidden) { closeSettings(); return; }
      if (tourStep >= 0) { endTour(); return; }
      if (drawing) { setDrawing(false); return; }
      if (!$('confirm').hidden) { hideConfirm(); return; }
      hideResults(); return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target) || !$('settingsModal').hidden || tourStep >= 0) return;
    var k = e.key;
    if (k === '/') { e.preventDefault(); symInput.focus(); symInput.select(); }
    else if (k === 'b' || k === 'B') { e.preventDefault(); setSide('buy'); focusTicket(); }
    else if (k === 's' || k === 'S') { e.preventDefault(); setSide(position() && position().qty < 0 ? 'cover' : 'sell'); focusTicket(); }
    else if (k === 'l' || k === 'L') { setDrawing(!drawing); }
    else if (k === 'w' || k === 'W') { addToWatchlist(symbol); }
    else if (k === 'a' || k === 'A') { e.preventDefault(); focusAlert(); }
    else if (k === '?') { startTour(); }
    else if (k >= '1' && k <= '4') { setInterval_(INTERVALS[+k - 1]); }
  });
  function focusTicket() {
    var card = $('panel-ticket'); try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    $('qty').focus(); $('qty').select();
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  document.addEventListener('visibilitychange', function () { if (!document.hidden && bars.length) { if (live) pollQuote(); else demoTick(); refreshWatchlist(); } });
  try { readHash(); } catch (e) { console.warn('Ignoring unreadable URL hash', e); }
  syncToggles();
  renderAccountSwitcher();
  setSide('buy');
  renderTicket();
  renderWatchlist();
  renderOrders();
  renderAutoPanel();
  load().then(function () {
    if (!store.get('bt.tour.done', false)) setTimeout(startTour, 900);
  });

  BT.app = {
    version: '0.5.0',
    load: load,
    setSymbol: setSymbol,
    setInterval: setInterval_,
    addToWatchlist: addToWatchlist,
    startTour: startTour,
    toast: toast,
    focusAlert: focusAlert,
    checkAlerts: function () { return runAlerts(symbol, bars, alertInd()); },
    switchAccount: switchAccount,
    account: activeAccount,
    plan: function () { return computePlan(); },
    checkRule: function () { checkAuto(); return auto.proposal ? Object.assign({}, auto.proposal) : null; },
    confirmProposal: function () { return auto.proposal ? confirmProposal() : null; },
    chart: function () { return chP; },
    state: function () { return { symbol: symbol, interval: tf, live: live, bars: bars, ind: I, signal: sig, overlays: Object.assign({}, ov), panes: Object.assign({}, panes), watchlist: watchlist.slice(), dataInfo: dataInfo, alerts: alerts ? alerts.list() : [], account: activeAccount(), proposal: auto.proposal ? Object.assign({}, auto.proposal) : null }; }
  };
})();
