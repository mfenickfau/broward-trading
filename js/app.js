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
 * Plain ES2020, no imports, no framework. Load after lightweight-charts and
 * the three modules above. Exposes a small BT.app surface for other pages,
 * tests and course exercises (BT.app.setSymbol, BT.app.load, BT.app.state()).
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;
  var LW = window.LightweightCharts;
  var ind = BT.ind, data = BT.data, paper = BT.paper;

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
    return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };
  var money = function (v) { return (v < 0 ? '−' : '') + '$' + fmt(Math.abs(v), 2); };
  var signed = function (v, suffix) { return (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + fmt(Math.abs(v), 2) + (suffix || ''); };
  var pct = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; };
  var cls = function (v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; };
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };
  var isTyping = function (el) { return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };

  if (!LW || !ind || !data || !paper) {
    document.body.insertAdjacentHTML('afterbegin', '<div class="callout danger" style="margin:16px">The dashboard could not start: a required script (lightweight-charts, indicators.js, data.js or paper.js) did not load. Check your connection and reload.</div>');
    return;
  }

  /* ------------------------------------------------------------------ *
   * Toasts
   * ------------------------------------------------------------------ */
  function toast(msg, kind, title, ms) {
    var host = $('toasts'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(title) + '</b>' : '') + esc(msg) + '</div><button class="close" aria-label="Dismiss">✕</button>';
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
  var trendSeries = [];                                  // drawn trend lines (series)
  var drawing = false, drawPts = [];

  /* ---- sub-panes: created on demand, removed when toggled off ---- */
  var PANE_DEFS = {
    rsi: {
      title: 'RSI (14)', build: function (ch) {
        var s = ch.addLineSeries(lineOpts(css('--purple'), { lastValueVisible: true, priceLineVisible: false }));
        s.createPriceLine({ price: 70, color: css('--down'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: 'overbought' });
        s.createPriceLine({ price: 30, color: css('--up'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: 'oversold' });
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
          value: function (i) { return I.macd.macd[i] == null ? '—' : I.macd.macd[i].toFixed(2) + ' · signal ' + (I.macd.signal[i] == null ? '—' : I.macd.signal[i].toFixed(2)) + ' · hist ' + (I.macd.hist[i] == null ? '—' : I.macd.hist[i].toFixed(2)); }
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
          value: function (i) { return I.stochastic.k[i] == null ? '—' : '%K ' + I.stochastic.k[i].toFixed(1) + ' · %D ' + (I.stochastic.d[i] == null ? '—' : I.stochastic.d[i].toFixed(1)); }
        };
      }
    },
    adx: {
      title: 'ADX (14)', build: function (ch) {
        var a = ch.addLineSeries(lineOpts(css('--fg'), { lineWidth: 2 })), p = ch.addLineSeries(lineOpts(css('--up'))), m = ch.addLineSeries(lineOpts(css('--down')));
        a.createPriceLine({ price: 25, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false, title: 'trending' });
        return {
          update: function () { a.setData(ind.toLineData(bars, I.adx.adx)); p.setData(ind.toLineData(bars, I.adx.plusDI)); m.setData(ind.toLineData(bars, I.adx.minusDI)); },
          value: function (i) { var v = I.adx.adx[i]; return v == null ? '—' : v.toFixed(1) + (v >= 25 ? ' strong trend' : v < 20 ? ' no trend' : ' building') + ' · +DI ' + (I.adx.plusDI[i] == null ? '—' : I.adx.plusDI[i].toFixed(0)) + ' · −DI ' + (I.adx.minusDI[i] == null ? '—' : I.adx.minusDI[i].toFixed(0)); }
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
        return { update: function () { s.setData(ind.toLineData(bars, I.atr)); }, value: function (i) { var v = I.atr[i]; return v == null ? '—' : fmt(v) + (bars[i] ? ' (' + (v / bars[i].close * 100).toFixed(2) + '% of price)' : ''); } };
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
    el.innerHTML = '<div class="tag">' + esc(def.title) + ' <b></b></div><button class="pane-close" type="button" title="Hide this pane" aria-label="Hide ' + esc(def.title) + '">✕</button>';
    $('subpanes').appendChild(el);
    var chart = mkChart(el, { rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } } });
    var api = def.build(chart);
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncFrom(chart));
    activePanes[key] = { el: el, chart: chart, api: api, tagEl: el.querySelector('.tag b') };
    el.querySelector('.pane-close').onclick = function () { togglePane(key, false); };
    if (I) { api.update(); updatePaneTags(bars.length - 1); }
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

  function renderSeries() {
    if (!bars.length || !I) return;
    var up = css('--up'), dn = css('--down');
    candles.setData(bars);
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

    renderMarkers();
    Object.keys(activePanes).forEach(function (k) { activePanes[k].api.update(); });
    renderTrendLines();
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
      if (!groups[p.name]) { groups[p.name] = { name: p.name, bias: p.bias, count: 0, last: p, description: p.description }; order.push(p.name); }
      groups[p.name].count++; groups[p.name].last = p;
    });
    if (!order.length) { legend.hidden = false; legend.innerHTML = '<span>No candlestick patterns in the last 150 bars. Patterns are rare by design: a hammer needs a decline before it, an engulfing bar must swallow the previous body.</span>'; detail.hidden = true; return; }
    legend.hidden = false;
    legend.innerHTML = '<span class="muted">Patterns (last 150 bars):</span>' + order.map(function (n) {
      var g = groups[n];
      return '<span class="k ' + g.bias + '" data-pat="' + esc(n) + '" role="button" tabindex="0" title="' + esc(g.description) + '"><i></i><b>' + esc(patCode(n)) + '</b> ' + esc(n) + ' <span class="n">×' + g.count + '</span></span>';
    }).join('');
    $$('.k', legend).forEach(function (el) {
      var act = function () {
        var g = groups[el.dataset.pat], b = bars[g.last.index];
        detail.hidden = false;
        detail.innerHTML = '<b>' + esc(g.name) + '</b> (' + (g.bias === 'bull' ? 'bullish' : g.bias === 'bear' ? 'bearish' : 'neutral') + ', latest ' + esc(barLabel(b)) + ') — ' + esc(g.description);
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
    return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
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
    $('drawhint').innerHTML = 'Trend line: click <b>two points</b> on the chart · Esc cancels';
    $('price').style.cursor = drawing ? 'crosshair' : '';
  }
  function onChartClick(p) {
    if (!drawing || !p || !p.time || !p.point) return;
    var price = candles.coordinateToPrice(p.point.y);
    if (price == null) return;
    var t = normTime(p.time);
    if (indexOfTime(t) < 0) return;                     // clicked in the empty margin right of the last bar
    drawPts.push({ time: t, value: +price });
    if (drawPts.length === 1) { $('drawhint').innerHTML = 'First point set at <b>' + fmt(price) + '</b> · click the second point'; return; }
    if (String(drawPts[0].time) === String(drawPts[1].time)) { drawPts.pop(); toast('Pick a different bar for the second point.', 'warn'); return; }
    drawPts.sort(function (a, b) { return indexOfTime(a.time) - indexOfTime(b.time); });
    var k = lineKey(); savedLines[k] = (savedLines[k] || []).concat([drawPts.slice()]); store.set('bt.lines', savedLines);
    var a = drawPts[0], b = drawPts[1], slope = b.value - a.value;
    toast(slope > 0 ? 'Rising line: connects higher points, the market is making higher lows/highs along it.' : 'Falling line: connects lower points, a down-sloping resistance or trend.', 'ok', 'Trend line saved for ' + symbol);
    renderTrendLines(); setDrawing(false);
  }
  chP.subscribeClick(onChartClick);
  // A second click within ~500 ms is reported as a double-click instead of a click: treat it as the second point.
  if (typeof chP.subscribeDblClick === 'function') chP.subscribeDblClick(onChartClick);
  $('draw').onclick = function () { setDrawing(!drawing); };
  $('clearlines').onclick = function () {
    var k = lineKey(), n = (savedLines[k] || []).length;
    delete savedLines[k]; store.set('bt.lines', savedLines); renderTrendLines();
    toast(n ? 'Removed ' + n + ' line' + (n > 1 ? 's' : '') + ' on ' + symbol + ' ' + tfLabel(tf) + '.' : 'No trend lines on this chart yet. Click ✎ Trend line, then two points.', n ? 'ok' : 'warn');
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
    $('ohlc').innerHTML = esc(symbol) + ' · O ' + fmt(b.open) + ' H ' + fmt(b.high) + ' L ' + fmt(b.low) + ' C <span class="' + cls(d) + '">' + fmt(b.close) + '</span>' + (b.volume != null ? ' · Vol ' + volFmt(b.volume) : '');
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
    $('symName').textContent = (u.synthetic ? symbol + ' — not in the demo universe; prices are simulated' : u.name + ' · ' + u.exchange + ' · ' + u.sector) + (typeof last.time === 'string' ? '' : ' · vs prior close');
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
      txt.textContent = 'live · ' + (data.PROVIDER_LABEL[dataInfo.source] || dataInfo.source || '');
      pill.title = 'Real prices from ' + (data.PROVIDER_LABEL[dataInfo.source] || 'your provider') + (dataInfo.cached ? ' (cached ' + Math.round((dataInfo.ageMs || 0) / 1000) + 's ago)' : '') + (dataInfo.stale ? '. Stale: the last refresh failed, showing the previous download.' : '');
    } else {
      pill.className = 'pill demo';
      txt.textContent = 'demo';
      pill.title = dataInfo.reason || 'Simulated prices: deterministic per symbol so every student sees the same chart. Add a free API key under Live data for real prices.';
    }
    var msg = $('msg');
    if (!live && dataInfo.fallback && dataInfo.reason) { msg.className = 'msg'; msg.textContent = 'Showing simulated prices. ' + dataInfo.reason; }
    else if (live && dataInfo.stale) { msg.className = 'msg'; msg.textContent = 'Live refresh failed, showing the last download. ' + (dataInfo.reason || ''); }
    else { msg.textContent = ''; }
  }

  /* ------------------------------------------------------------------ *
   * Signal card
   * ------------------------------------------------------------------ */
  function renderSignal() {
    if (!sig) return;
    $('badge').textContent = sig.state; $('badge').className = 'badge ' + sig.state.toLowerCase();
    $('score').textContent = (sig.score > 0 ? '+' : '') + sig.score; $('scoreMax').textContent = sig.max;
    $('asof').textContent = live ? 'as of last quote' : 'simulated';
    $('reasons').innerHTML = sig.reasons.map(function (r) {
      return '<li><span class="dot ' + (r.pts > 0 ? 'b' : r.pts < 0 ? 's' : '') + '"></span><span>' + esc(r.text) + '<span class="pts">' + (r.pts > 0 ? '+' : '') + (r.pts || '0') + '</span><small>' + esc(r.why) + '</small></span></li>';
    }).join('');
    var n = bars.length, from = Math.max(0, n - 20), buys = 0, sells = 0;
    for (var i = from; i < n; i++) { if (sigSeries[i] === 'BUY') buys++; else if (sigSeries[i] === 'SELL') sells++; }
    $('sigTrend').textContent = 'Last 20 bars: ' + buys + ' BUY · ' + sells + ' SELL · ' + (n - from - buys - sells) + ' HOLD';
  }
  $('whyBtn').onclick = function () {
    var card = $('panel-signal'), on = card.classList.toggle('show-why');
    this.setAttribute('aria-expanded', String(on));
    this.textContent = on ? 'Hide the reasoning' : 'Why? Show the reasoning';
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
    btn.textContent = 'Review ' + s + ' order';
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
    $('qtyLabel').textContent = qtyMode === 'dollars' ? 'Dollar amount' : 'Shares';
    this.textContent = qtyMode === 'dollars' ? '#' : '$';
    this.title = qtyMode === 'dollars' ? 'Switch to entering a number of shares' : 'Switch to entering a dollar amount';
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
    if (!bars.length) error = 'Load a chart first so the order has a price to work against.';
    else if (!(shares > 0)) error = qtyMode === 'dollars' ? 'That amount buys less than one share at ' + money(refPrice) + '.' : 'Enter a whole number of shares.';
    else if (side === 'sell' && held <= 0) error = 'You do not own any ' + symbol + '. Use Short if you want to bet on a decline.';
    else if (side === 'sell' && shares > held) error = 'You own ' + held + ' shares. Selling ' + shares + ' would flip you short — use Short deliberately if that is what you mean.';
    else if (side === 'cover' && held >= 0) error = 'You are not short ' + symbol + ', so there is nothing to cover.';
    else if (side === 'cover' && shares > -held) error = 'You are short ' + (-held) + ' shares; covering more than that would open a long.';
    else if (side === 'short' && held > 0) error = 'You are long ' + held + ' shares. Sell those first; shorting while long just closes the position.';
    var order = { symbol: symbol, side: (side === 'buy' || side === 'cover') ? 'buy' : 'sell', qty: shares, type: type, limitPrice: limitPrice, stopPrice: stopPrice, tif: $('tif').value };
    return { order: order, shares: shares, refPrice: refPrice, error: error, px: px };
  }
  function renderTicket() {
    var type = $('otype').value;
    $('limitField').hidden = !(type === 'limit' || type === 'stop_limit');
    $('stopField').hidden = !(type === 'stop' || type === 'stop_limit');
    $('otypeHelp').textContent = OTYPE_HELP[type];
    var t = ticketOrder(), st = paper.state, comm = (st.settings && st.settings.commission) || 0;
    var value = t.shares * t.refPrice, isBuy = t.order.side === 'buy';
    var cashAfter = st.cash + (isBuy ? -value : value) - comm;
    var rows = [['Shares', t.shares > 0 ? t.shares.toLocaleString() : '—'], [type === 'market' ? 'At about' : 'Reference price', t.refPrice ? money(t.refPrice) : '—'], ['Order value', value ? money(value) : '—']];
    if (comm) rows.push(['Commission', money(comm)]);
    rows.push(['Cash after', isFinite(cashAfter) && value ? money(cashAfter) : '—']);
    if (side === 'short') rows.push(['Margin needed', value ? money(value * paper.SHORT_MARGIN) + ' (150%)' : '—']);
    $('est').innerHTML = rows.map(function (r) { return '<span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span>'; }).join('');
    var tm = $('tmsg');
    if (tm.dataset.kind === 'result') return;          // keep the last fill/reject message until the ticket is edited
    if (t.error && (t.shares > 0 || qtyMode === 'dollars')) { tm.className = 'msg'; tm.textContent = t.error; } else if (!pendingOrder) { tm.textContent = ''; }
  }
  function hideConfirm() { $('confirm').hidden = true; pendingOrder = null; }
  $('review').onclick = function () {
    var t = ticketOrder(); var tm = $('tmsg');
    if (t.error) { tm.className = 'msg err'; tm.textContent = t.error; return; }
    pendingOrder = t;
    var desc = paper.describeOrder(Object.assign({}, t.order));
    var verb = { buy: 'Buy', sell: 'Sell', short: 'Sell short', cover: 'Buy to cover' }[side];
    $('confirmText').innerHTML = '<b>' + esc(verb) + ' ' + t.shares + ' ' + esc(symbol) + '</b> · ' + esc(desc) + ' Estimated value <b class="num">' + esc(money(t.shares * t.refPrice)) + '</b>' + (t.order.tif === 'day' ? ' · expires at the end of the session.' : ' · good till cancelled.');
    $('confirmYes').className = t.order.side === 'buy' ? 'buy' : 'sell';
    $('confirm').hidden = false; tm.textContent = '';
    $('confirmYes').focus();
  };
  $('confirmNo').onclick = hideConfirm;
  $('confirmYes').onclick = function () {
    if (!pendingOrder) return;
    var t = pendingOrder; hideConfirm();
    var o = paper.placeOrder(t.order, lastPrice());
    var tm = $('tmsg'); tm.dataset.kind = 'result';
    if (o.status === 'filled') {
      tm.className = 'msg ok'; tm.textContent = 'Filled: ' + (o.side === 'buy' ? 'bought ' : 'sold ') + o.qty + ' ' + o.symbol + ' @ ' + money(o.fillPrice) + (o.commission ? ' (commission ' + money(o.commission) + ')' : '') + '.';
      toast((o.side === 'buy' ? 'Bought ' : 'Sold ') + o.qty + ' ' + o.symbol + ' @ ' + money(o.fillPrice), 'ok', 'Order filled');
    } else if (o.status === 'open') {
      tm.className = 'msg ok'; tm.textContent = 'Working order placed. ' + o.reason;
      toast(paper.describeOrder(o), 'ok', 'Order is working');
    } else {
      tm.className = 'msg err'; tm.textContent = 'Rejected: ' + o.reason;
      toast(o.reason, 'err', 'Order rejected', 7000);
    }
    renderAccount(); renderOrders();
  };

  /* ------------------------------------------------------------------ *
   * Open orders, account, fills
   * ------------------------------------------------------------------ */
  function renderOrders() {
    var open = paper.openOrders();
    $('ordersCount').textContent = open.length ? open.length + ' working' : '';
    $('orders').innerHTML = open.length ? open.slice().reverse().map(function (o) {
      var trig = o.type === 'limit' ? money(o.limitPrice) : o.type === 'stop' ? money(o.stopPrice) : money(o.stopPrice) + ' / ' + money(o.limitPrice);
      return '<tr><td><span class="' + (o.side === 'buy' ? 'up' : 'down') + '">' + (o.side === 'buy' ? 'BUY' : 'SELL') + '</span> <b>' + esc(o.symbol) + '</b><span class="type">' + esc(o.type.replace('_', '-')) + ' · ' + esc(o.tif.toUpperCase()) + (o.triggered ? ' · triggered' : '') + '</span></td><td class="num">' + o.qty + '</td><td class="num">' + esc(trig) + '</td><td><button class="sm ghost" data-cancel="' + o.id + '" title="Cancel this order">✕</button></td></tr>';
    }).join('') : '<tr><td class="muted">No working orders. Try a limit order a little below the price and watch it fill when a bar\'s low reaches it.</td></tr>';
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
    var stat = function (label, value, sub, klass) { return '<div class="stat"><span class="label">' + label + '</span><span class="value ' + (klass || '') + '">' + value + '</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>'; };
    $('acct').innerHTML =
      stat('Equity', money(mtm.equity), 'cash + positions') +
      stat('Cash', money(mtm.cash), mtm.marginUsed ? 'margin used ' + money(mtm.marginUsed) : 'buying power') +
      stat('Total P&amp;L', signed(mtm.totalPnL), pct(mtm.totalPnLPct) + ' since start', cls(mtm.totalPnL)) +
      stat('Day P&amp;L', signed(mtm.dayPnL), 'unrealized ' + signed(mtm.unrealized), cls(mtm.dayPnL));
    var pos = position(), row = $('posRow');
    if (pos && bars.length) {
      var px = lastPrice(), upl = (px - pos.avg) * pos.qty;
      row.hidden = false;
      row.innerHTML = '<span>' + (pos.qty > 0 ? 'Long' : 'Short') + ' <b class="num">' + Math.abs(pos.qty) + '</b> ' + esc(symbol) + ' @ <span class="num">' + money(pos.avg) + '</span></span><span class="num ' + cls(upl) + '">' + signed(upl) + ' (' + pct((px - pos.avg) / pos.avg * 100 * (pos.qty > 0 ? 1 : -1)) + ')</span><button class="sm" id="closePos" type="button">Close</button>';
      $('closePos').onclick = function () {
        if (this.dataset.arm) { var o = paper.closePosition(symbol, lastPrice()); toast(o.status === 'filled' ? o.reason : 'Could not close: ' + o.reason, o.status === 'filled' ? 'ok' : 'err'); renderAccount(); renderOrders(); }
        else { this.dataset.arm = '1'; this.textContent = 'Confirm close'; var self = this; setTimeout(function () { self.textContent = 'Close'; delete self.dataset.arm; }, 4000); }
      };
    } else row.hidden = true;
    var trades = paper.state.trades.slice(-40).reverse();
    $('log').innerHTML = trades.length ? trades.map(function (t) {
      var when = typeof t.time === 'string' ? t.time : new Date((t.time > 1e11 ? t.time : t.time * 1000)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return '<tr><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? 'BUY' : 'SELL') + '</td><td>' + esc(t.symbol) + '</td><td class="num">' + t.qty + '</td><td class="num">' + money(t.price) + '</td><td class="num ' + cls(t.realized) + '">' + (t.closedQty ? signed(t.realized) : '') + '</td><td class="muted">' + esc(when) + '</td></tr>';
    }).join('') : '<tr><td class="muted">No trades yet. Try buying when the signal says BUY and watch what happens — it is play money.</td></tr>';
    renderTicket();
  }
  $('reset').onclick = function () {
    var b = this;
    if (b.dataset.arm) { paper.reset(); delete b.dataset.arm; b.textContent = 'Reset'; hideConfirm(); renderAccount(); renderOrders(); toast('Fresh $100,000 paper account. Your trade history was cleared.', 'ok', 'Account reset'); }
    else { b.dataset.arm = '1'; b.textContent = 'Confirm reset'; setTimeout(function () { b.textContent = 'Reset'; delete b.dataset.arm; }, 4000); }
  };

  /** Fill resting orders against a bar and tell the student. */
  function processFills(sym, bar) {
    var before = paper.openOrders(sym);
    var fills = paper.processOrders(sym, bar) || [];
    fills.forEach(function (f) {
      var o = f.order;
      toast((o.side === 'buy' ? 'Bought ' : 'Sold ') + o.qty + ' ' + o.symbol + ' @ ' + money(o.fillPrice) + ' — your ' + o.type.replace('_', '-') + ' price was reached.', 'ok', 'Order filled');
    });
    // Orders that were rejected at fill time (e.g. cash ran out) or expired (day orders) are not fills, but the student should hear about them.
    var changed = fills.length > 0;
    before.forEach(function (o) {
      if (o.status === 'open' || o.status === 'filled') return;
      changed = true;
      if (o.status === 'rejected') toast(o.reason, 'err', 'Order could not fill', 7000);
      else if (o.status === 'expired') toast(paper.describeOrder(o) + ' The day order expired unfilled.', 'warn', 'Order expired');
    });
    if (changed) { renderOrders(); renderAccount(); }
    return fills;
  }

  /* ------------------------------------------------------------------ *
   * Watchlist
   * ------------------------------------------------------------------ */
  function saveWatchlist() { store.set('bt.watchlist', watchlist); }
  function renderWatchlist() {
    var ul = $('wlList');
    if (!watchlist.length) { ul.innerHTML = '<li class="empty">Your watchlist is empty. Search a symbol and press + Add (or W).</li>'; return; }
    ul.innerHTML = watchlist.map(function (s) {
      var u = data.lookup(s), q = wlQuotes[s], px = q && q.price, chg = q && q.prevClose ? (q.price - q.prevClose) / q.prevClose * 100 : null;
      return '<li data-sym="' + esc(s) + '" class="' + (s === symbol ? 'on' : '') + '" role="button" tabindex="0" title="' + esc(u.name) + '">' +
        '<span class="sym">' + esc(s) + '</span><span class="px" id="wlpx-' + esc(s) + '">' + (px ? fmt(px) : '…') + '</span>' +
        '<span class="nm">' + esc(u.name) + '</span><span class="ch ' + (chg == null ? 'muted' : cls(chg)) + '">' + (chg == null ? '' : pct(chg)) + '</span>' +
        '<button class="rm" data-rm="' + esc(s) + '" title="Remove ' + esc(s) + ' from the watchlist" aria-label="Remove ' + esc(s) + '">✕</button></li>';
    }).join('');
    $$('li[data-sym]', ul).forEach(function (li) {
      var go = function () { setSymbol(li.dataset.sym); };
      li.onclick = function (e) { if (e.target.closest('.rm')) return; go(); };
      li.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    $$('[data-rm]', ul).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); removeFromWatchlist(b.dataset.rm); }; });
  }
  function addToWatchlist(s) {
    s = cleanSym(s); if (!s) return;
    if (watchlist.indexOf(s) >= 0) { toast(s + ' is already on your watchlist.', 'warn'); return; }
    if (watchlist.length >= MAX_WATCHLIST) { toast('Watchlists are capped at ' + MAX_WATCHLIST + ' symbols to stay inside free data quotas. Remove one first.', 'warn'); return; }
    watchlist.push(s); saveWatchlist(); renderWatchlist(); refreshWatchlist(true);
    toast(s + ' added. Its price refreshes with the market.', 'ok');
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
      var today = data.marketStatus().nyDate;
      for (var k = 0; k < watchlist.length; k++) {
        var s = watchlist[k];
        if (s === symbol && bars.length) {
          wlQuotes[s] = { price: lastPrice(), prevClose: prevClose(), time: Date.now() / 1000 };
          paintQuote(s); continue;
        }
        try {
          if (!wlPrev[s] || wlPrev[s].day !== today) {
            var d = await data.candles(s, '1day', 3), n = d.length, pc = null;
            // Prior close = the last completed session. If today's bar is already in the series, step back one more.
            if (n >= 2) pc = d[n - 1].time === today ? d[n - 2].close : d[n - 1].close;
            wlPrev[s] = { prevClose: pc, day: today };
          }
          var q = await data.quote(s);
          wlQuotes[s] = { price: q.price, prevClose: wlPrev[s].prevClose, time: q.time, live: !!q.live && !q.fallback };
          paintQuote(s);
          // Resting orders on other symbols fill against their quote (a one-price bar).
          if (paper.openOrders(s).length) processFills(s, { time: q.time, open: q.price, high: q.price, low: q.price, close: q.price, volume: 0 });
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
    }).join('') + (note ? '<li class="hint">' + esc(note) + '</li>' : '') + (!rows.length ? '<li class="hint">No match in the list. Press Enter to chart “' + esc(symInput.value.toUpperCase()) + '” anyway' + (live ? '.' : ' (simulated for unknown tickers).') + '</li>' : '');
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
    if (!q) { showResults((await data.search('')).slice(0, 10), 'Popular symbols — start typing to filter'); return; }
    try {
      var rows = await data.search(q);
      if (seq !== searchSeq) return;
      showResults(rows.slice(0, 10), rows.fallback ? 'Provider search unavailable (' + rows.reason + '); showing the built-in list.' : null);
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
    $('loading').hidden = false; $('loading').textContent = 'Loading ' + symbol + ' ' + tfLabel(tf) + '…';
    var res;
    try { res = await data.candles(symbol, tf, LIMIT[tf]); }
    catch (e) { res = data.demo(symbol, tf, LIMIT[tf]); res.fallback = true; res.reason = (e && e.message) || 'Data error'; }
    if (seq !== loadSeq) return;                       // a newer load superseded this one
    bars = res; bars.symbol = symbol;
    live = !!res.live && !res.fallback;
    dataInfo = { source: res.source, reason: res.reason, fallback: !!res.fallback, cached: !!res.cached, stale: !!res.stale, ageMs: res.ageMs };
    allCharts().forEach(function (c) { c.applyOptions({ timeScale: { timeVisible: tf !== '1day' } }); });
    reindex(); compute(); renderSeries(); renderHeader(); renderSignal(); renderMode(); renderAccount(); renderOrders(); renderWatchlist();
    updatePaneTags(bars.length - 1);
    chP.timeScale().fitContent();
    if (tf !== '1day' && bars.length > 160) chP.timeScale().setVisibleLogicalRange({ from: bars.length - 160, to: bars.length + 3 });
    $('loading').hidden = true;
    if (live) pollTimer = setInterval(pollQuote, 60000);
    else tickTimer = setInterval(demoTick, 3000);
    scheduleWatchlist(); refreshWatchlist(true);
    processFills(symbol, bars[bars.length - 1]);
    updateHash();
  }

  function afterTick() {
    reindex(); compute(); renderSeries(); renderHeader(); renderSignal();
    updatePaneTags(bars.length - 1);
    processFills(symbol, bars[bars.length - 1]);
    wlQuotes[symbol] = { price: lastPrice(), prevClose: prevClose(), time: Date.now() / 1000 };
    paintQuote(symbol);
    renderAccount();
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
    } catch (e) { $('msg').textContent = 'Quote refresh failed: ' + (e && e.message); }
  }

  /* Ticker whitelist: uppercase letters, digits, dot and dash (BRK.B, BF-B), 12 chars max.
   * Anything else (quotes, slashes, spaces, __proto__ ...) would reach a CSS selector in paintQuote()
   * and the data provider's URL, so it is stripped at every entry point: hash, search, watchlist. */
  function cleanSym(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12); }
  function setSymbol(s) {
    s = cleanSym(s); if (!s) return;
    symbol = s; store.set('bt.sym', symbol);
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
   * NYSE clock
   * ------------------------------------------------------------------ */
  function tickClock() {
    var st = data.marketStatus(), el = $('clock'), t = $('clockText');
    var label = { open: 'Open', pre: 'Pre-market', after: 'After hours', closed: 'Closed' }[st.phase];
    var extra = '';
    if (st.phase === 'open') extra = ' · closes ' + st.closesAt;
    else if (st.phase === 'pre') extra = ' · opens 09:30';
    else {
      var secs = st.nextOpen - Math.floor(Date.now() / 1000), hrs = Math.floor(secs / 3600), mins = Math.floor((secs % 3600) / 60);
      extra = ' · ' + (st.reason ? st.reason + ' · ' : '') + 'opens in ' + (hrs >= 24 ? Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h' : hrs + 'h ' + mins + 'm');
    }
    t.textContent = 'NYSE ' + st.nyTime + ' · ' + label + extra;
    el.className = 'clock ' + st.phase;
    el.title = st.holiday ? 'Market holiday: ' + st.holiday : st.earlyClose ? 'Early close today at ' + st.closesAt : 'New York Stock Exchange regular session is 9:30–16:00 ET, Monday to Friday except holidays.';
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
    if (st.provider === 'demo') { q.textContent = 'Demo mode: no network requests, no quota.'; return; }
    var r = st.rate || {}, lim = st.limits || {};
    var parts = ['Provider: ' + st.label + (st.hasKey ? ' (key saved)' : ' (no key yet)')];
    if (lim.perMinute && isFinite(lim.perMinute)) parts.push('this minute: ' + (r.minuteUsed != null ? r.minuteUsed : r.usedMinute != null ? r.usedMinute : '?') + '/' + lim.perMinute);
    if (lim.perDay && isFinite(lim.perDay)) parts.push('today: ' + (r.dayUsed != null ? r.dayUsed : r.usedDay != null ? r.usedDay : '?') + '/' + lim.perDay);
    parts.push('candles cached 60 s intraday / 10 min daily, quotes 15 s');
    q.textContent = parts.join(' · ');
  }
  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = closeSettings;
  $('settingsModal').addEventListener('click', function (e) { if (e.target === this) closeSettings(); });
  $$('.showkey').forEach(function (b) { b.onclick = function () { var inp = $(b.dataset.for); inp.type = inp.type === 'password' ? 'text' : 'password'; b.textContent = inp.type === 'password' ? 'Show' : 'Hide'; }; });
  $('provider').onchange = function () { $('testOut').textContent = ''; };
  $('testKey').onclick = async function () {
    var p = $('provider').value, out = $('testOut'), btn = this;
    if (p === 'demo') { out.className = 'test-out ok'; out.textContent = 'Demo needs no key: prices are generated locally.'; return; }
    var key = $('key-' + p).value.trim();
    if (!key) { out.className = 'test-out err'; out.textContent = 'Paste your ' + data.PROVIDER_LABEL[p] + ' key first.'; return; }
    btn.disabled = true; out.className = 'test-out muted'; out.textContent = 'Asking ' + data.PROVIDER_LABEL[p] + ' for an AAPL quote…';
    try {
      var q = await data.providers[p].quote('AAPL', key);
      out.className = 'test-out up'; out.textContent = 'Success: AAPL ' + money(q.price) + ' from ' + data.PROVIDER_LABEL[p] + '. Save to switch the dashboard to live prices.';
    } catch (e) {
      out.className = 'test-out down';
      out.textContent = 'Failed: ' + (data.explainError ? data.explainError(e, p) : (e && e.message)) + (e instanceof TypeError ? ' If you are viewing this inside an embedded preview, open the page directly in your browser.' : '');
    } finally { btn.disabled = false; }
  };
  $('clearCache').onclick = function () { data.clearCache(); toast('Cached candles and quotes cleared. The next load fetches fresh data (and counts against your quota).', 'ok'); renderQuota(); };
  $('settingsSave').onclick = function () {
    var keys = {}; PROVIDERS.forEach(function (p) { keys[p] = $('key-' + p).value.trim(); });
    var provider = $('provider').value;
    if (provider !== 'demo' && !keys[provider]) { $('testOut').className = 'test-out down'; $('testOut').textContent = 'That provider needs a key. Paste one or choose Demo.'; return; }
    data.setSettings({ provider: provider, keys: keys });
    closeSettings();
    toast(provider === 'demo' ? 'Running on simulated prices.' : 'Switching to ' + data.PROVIDER_LABEL[provider] + ' live data.', 'ok', 'Settings saved');
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
    { target: 'panel-ticket', title: 'Place a practice trade', body: 'Buy, Sell, Short or Cover with market, limit, stop or stop-limit orders, sized in shares or dollars. Review shows exactly what will happen before you confirm. Working orders appear below and fill against each new bar the way a real broker fills them. Shortcuts: B for a buy ticket, S for sell.' },
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
    $('tourStep').textContent = 'Step ' + (i + 1) + ' of ' + TOUR.length;
    $('tourTitle').textContent = step.title; $('tourBody').textContent = step.body;
    $('tourDots').innerHTML = TOUR.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('');
    $('tourPrev').disabled = i === 0;
    $('tourNext').textContent = i === TOUR.length - 1 ? 'Start trading' : 'Next';
    $('tour').hidden = false; document.body.classList.add('touring');
  }
  function startTour() { showTour(0); }
  function endTour() { tourClear(); $('tour').hidden = true; document.body.classList.remove('touring'); tourStep = -1; store.set('bt.tour.done', true); }
  $('tourBtn').onclick = startTour;
  $('tourNext').onclick = function () { showTour(tourStep + 1); };
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
  setSide('buy');
  renderTicket();
  renderWatchlist();
  renderOrders();
  load().then(function () {
    if (!store.get('bt.tour.done', false)) setTimeout(startTour, 900);
  });

  BT.app = {
    version: '0.2.0',
    load: load,
    setSymbol: setSymbol,
    setInterval: setInterval_,
    addToWatchlist: addToWatchlist,
    startTour: startTour,
    toast: toast,
    chart: function () { return chP; },
    state: function () { return { symbol: symbol, interval: tf, live: live, bars: bars, ind: I, signal: sig, overlays: Object.assign({}, ov), panes: Object.assign({}, panes), watchlist: watchlist.slice(), dataInfo: dataInfo }; }
  };
})();
