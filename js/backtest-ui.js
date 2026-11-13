/* Broward Trading — js/backtest-ui.js → BT.backtestPage (v0.2)
 *
 * UI for backtest.html, the Strategy Lab. Wires the pure engine in js/backtest.js
 * (BT.backtest) to the page: data selection, strategy and auto-generated parameter
 * sliders, account/cost settings, charts (price + trade markers + strategy
 * indicators, equity vs buy-and-hold, drawdown), stats tiles with plain-English
 * notes, coaching sentences, trade list, the grid optimiser with an overfitting
 * check, and a compare-all-strategies mode.
 *
 * Depends on: LightweightCharts (global, v4), BT.ind, BT.data, BT.backtest.
 * Plain ES2020, no imports. This is a UI module, so it touches the DOM.
 *
 * Deep links: backtest.html#sym=AAPL&tf=1day&bars=500&strategy=smaCross&fast=10&slow=50&run=1
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (window.BT && window.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }
  var LW = window.LightweightCharts;
  var engine = BT.backtest, data = BT.data, I = BT.ind;

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function round(x, d) { if (!isNum(x)) return null; var p = Math.pow(10, d == null ? 2 : d); return Math.round(x * p) / p; }
  function money(x, d) { if (!isNum(x)) return '—'; return (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function pct(x, d, signed) { if (!isNum(x)) return '—'; var s = round(x, d == null ? 1 : d); return (signed !== false && s > 0 ? '+' : '') + s.toLocaleString('en-US', { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }) + ' %'; }
  function num(x, d) { if (x === Infinity) return '∞'; if (!isNum(x)) return '—'; return round(x, d == null ? 2 : d).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function fmtTime(t) {
    if (typeof t === 'string') return t;
    if (!isNum(t)) return '—';
    var d = new Date(t * 1000);
    try { return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function toast(text, tone, title) {
    var host = $('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (tone || '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(title) + '</b>' : '') + esc(text) + '</div><button class="close" type="button" aria-label="Dismiss">✕</button>';
    el.querySelector('.close').onclick = function () { el.remove(); };
    host.appendChild(el);
    setTimeout(function () { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 220); }, 6000);
  }
  function setMsg(id, text, tone) { var el = $(id); if (!el) return; el.textContent = text || ''; el.className = 'msg' + (tone ? ' ' + tone : ''); }
  function announce(text) { var el = $('srlive'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = text; }, 30); } }

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: ignore */ } }
  };
  var SETTINGS_KEY = 'bt.backtest';

  if (!engine || !LW) {
    document.addEventListener('DOMContentLoaded', function () {
      var el = $('empty');
      if (el) el.innerHTML = '<b>The Strategy Lab could not start</b>' + (!engine ? 'js/backtest.js did not load. ' : '') + (!LW ? 'The chart library (lightweight-charts) did not load; check your connection.' : '');
    });
    return;
  }

  /* ------------------------------------------------------------------ *
   * Static configuration
   * ------------------------------------------------------------------ */
  var LOOKBACKS = {
    '1day': [[250, '1 year (250 bars)'], [500, '2 years (500 bars)'], [750, '3 years (750 bars)'], [1250, '5 years (1,250 bars)'], [2500, '10 years (2,500 bars)']],
    '1h': [[70, '2 weeks (70 bars)'], [140, '1 month (140 bars)'], [420, '3 months (420 bars)'], [840, '6 months (840 bars)']],
    '15min': [[130, '1 week (130 bars)'], [260, '2 weeks (260 bars)'], [560, '1 month (560 bars)'], [1690, '3 months (1,690 bars)']],
    '5min': [[390, '1 week (390 bars)'], [780, '2 weeks (780 bars)'], [1680, '1 month (1,680 bars)'], [3900, '2½ months (3,900 bars)']],
    '1min': [[390, '1 day (390 bars)'], [1170, '3 days (1,170 bars)'], [1950, '1 week (1,950 bars)'], [3900, '2 weeks (3,900 bars)']]
  };
  var DATANOTE = {
    '1day': 'Daily bars give the most history and the most trustworthy tests. Intraday bars give more trades, but a 5-minute strategy must beat much larger relative costs.',
    '1h': 'Hourly bars: a few months of history and roughly seven bars per session. Good for seeing how a daily rule behaves at a faster pace.',
    '15min': '15-minute bars: 26 per session. Signals arrive often, so costs per trade start to matter a lot.',
    '5min': '5-minute bars: 78 per session. Most moving-average rules trade so often here that slippage alone can erase the edge.',
    '1min': '1-minute bars: 390 per session. Mostly noise. Useful mainly to watch a rule drown in transaction costs.'
  };

  /** Slider metadata by parameter name, with per-strategy overrides. */
  var PARAM_META = {
    fast: { label: 'Fast length', min: 2, max: 100, step: 1, help: 'Bars in the faster average. Shorter reacts sooner but produces more false signals.' },
    slow: { label: 'Slow length', min: 5, max: 300, step: 1, help: 'Bars in the slower average. 200 on daily bars is the classic long-term trend line.' },
    signal: { label: 'Signal length', min: 2, max: 50, step: 1, help: 'EMA of the MACD line. Crossing it is the trade trigger.' },
    n: { label: 'Length', min: 2, max: 200, step: 1, help: 'Number of bars the indicator looks back over.' },
    low: { label: 'Oversold level', min: 5, max: 50, step: 1, help: 'RSI below this is "oversold"; the buy fires when RSI climbs back above it.' },
    high: { label: 'Overbought level', min: 50, max: 95, step: 1, help: 'RSI above this is "overbought"; the sell fires when RSI drops back below it.' },
    k: { label: 'Band width (σ)', min: 0.5, max: 4, step: 0.1, help: 'Standard deviations from the middle band. 2σ contains roughly 95 % of closes.' },
    buyAt: { label: 'Buy when score ≥', min: 1, max: 8, step: 1, help: 'Composite score (−8 … +8) needed to buy. Higher = fewer, more agreed-upon signals.' },
    sellAt: { label: 'Sell when score ≤', min: -8, max: -1, step: 1, help: 'Composite score at or below which the position is sold.' }
  };
  var PARAM_META_BY_STRATEGY = {
    rsiReversion: { n: { label: 'RSI length', min: 2, max: 50, step: 1, help: 'Bars in the RSI calculation. 14 is Wilder\'s original; shorter is twitchier.' } },
    bollingerBounce: { n: { label: 'Band length', min: 5, max: 100, step: 1, help: 'Bars in the middle SMA and the standard deviation.' } },
    breakout: { n: { label: 'Channel length', min: 5, max: 200, step: 1, help: 'Buy above the highest high of this many previous bars; sell below the lowest low. 20 and 55 are the "Turtle" settings.' } }
  };
  function metaFor(stratId, key, value) {
    var m = (PARAM_META_BY_STRATEGY[stratId] && PARAM_META_BY_STRATEGY[stratId][key]) || PARAM_META[key];
    if (m) return m;
    var isInt = Number.isInteger(value);
    return { label: key, min: isInt ? 1 : 0, max: Math.max(10, Math.abs(value) * 4), step: isInt ? 1 : Math.max(0.01, Math.abs(value) / 20), help: 'Strategy parameter.' };
  }

  /** Stat tiles: key → label, formatter, tooltip, and a one-line "sub" writer. */
  var STAT_DEFS = [
    { key: 'totalReturnPct', label: 'Total return', fmt: function (s) { return pct(s.totalReturnPct); }, tone: function (s) { return s.totalReturnPct; },
      sub: function (s) { var d = s.excessVsBuyHoldPct; return isNum(d) ? (d >= 0 ? 'beat' : 'trailed') + ' buy & hold by ' + pct(Math.abs(d), 1, false) : ''; },
      why: 'Change in account value from first bar to last, after commissions and slippage. Compare it with buy-and-hold, never on its own.' },
    { key: 'buyHoldReturnPct', label: 'Buy & hold', fmt: function (s) { return pct(s.buyHoldReturnPct); }, tone: function (s) { return s.buyHoldReturnPct; },
      sub: function () { return 'buy at the first open, never sell, no costs'; },
      why: 'The benchmark. Any active rule costs time, attention and commissions, so it must earn more than doing nothing.' },
    { key: 'cagr', label: 'CAGR', fmt: function (s) { return isNum(s.cagr) ? pct(s.cagr) : '—'; }, tone: function (s) { return s.cagr; },
      sub: function (s) { return isNum(s.years) && s.years > 0 ? 'per year over ' + num(s.years, 1) + ' years' : 'needs more history'; },
      why: 'Compound annual growth rate: the steady yearly return that would produce the same final equity. Lets you compare a 2-year test with a 10-year one.' },
    { key: 'maxDrawdownPct', label: 'Max drawdown', fmt: function (s) { return isNum(s.maxDrawdownPct) ? '−' + pct(s.maxDrawdownPct, 1, false) : '—'; }, tone: function (s) { return -1; },
      sub: function (s) { return isNum(s.longestDrawdownBars) ? 'longest slump ' + s.longestDrawdownBars + ' bars' : ''; },
      why: 'Largest fall from an equity peak to the following trough. This is the pain you would have had to sit through. Most people abandon a rule long before −30 %.' },
    { key: 'sharpe', label: 'Sharpe ratio', fmt: function (s) { return num(s.sharpe, 2); }, tone: function (s) { return isNum(s.sharpe) ? s.sharpe - 0.5 : null; },
      sub: function (s) { return !isNum(s.sharpe) ? '' : s.sharpe < 0.5 ? 'weak: lots of volatility per unit of return' : s.sharpe < 1 ? 'ordinary' : s.sharpe < 2 ? 'good; be suspicious if it took a long search' : 'suspiciously high: check for look-ahead or overfitting'; },
      why: 'Average return divided by the volatility of returns, annualised. Rewards smooth equity curves. Above 1 is good; above 2 on a short test is a warning, not a trophy.' },
    { key: 'winRate', label: 'Win rate', fmt: function (s) { return isNum(s.winRate) ? pct(s.winRate, 0, false) : '—'; }, tone: function () { return null; },
      sub: function (s) { return isNum(s.wins) ? s.wins + ' winners, ' + s.losses + ' losers' : ''; },
      why: 'Share of closed trades that made money. Trend followers often win under 45 % of the time and still profit, because winners are much bigger than losers. A high win rate with a low profit factor means the losers are too big.' },
    { key: 'profitFactor', label: 'Profit factor', fmt: function (s) { return num(s.profitFactor, 2); }, tone: function (s) { return isNum(s.profitFactor) ? s.profitFactor - 1 : (s.profitFactor === Infinity ? 1 : null); },
      sub: function (s) { return isNum(s.avgWin) && isNum(s.avgLoss) ? 'avg win ' + money(s.avgWin, 0) + ' · avg loss ' + money(s.avgLoss, 0) : ''; },
      why: 'Gross profit divided by gross loss. Below 1.0 the rule loses money; 1.5 is respectable; above 3 on a small sample usually means too few trades.' },
    { key: 'trades', label: 'Trades', fmt: function (s) { return String(s.trades || 0); }, tone: function () { return null; },
      sub: function (s) { return s.trades ? 'held ' + num(s.avgBarsHeld, 0) + ' bars on average' : 'the rules never triggered'; },
      why: 'Closed round trips. Fewer than 30 and every other statistic here is mostly luck; the Learn course calls this "an anecdote, not a sample".' },
    { key: 'exposurePct', label: 'Exposure', fmt: function (s) { return pct(s.exposurePct, 0, false); }, tone: function () { return null; },
      sub: function () { return 'share of bars spent in a position'; },
      why: 'Time in the market. Earning the same return while invested only half the time means half the risk was taken (and cash could earn interest the rest of the time).' },
    { key: 'totalCommission', label: 'Costs', fmt: function (s) { return money(s.totalCommission || 0, 0); }, tone: function (s) { return s.totalCommission > 0 ? -1 : null; },
      sub: function (s, o) { return 'commissions' + (o && o.slippageBps ? ' + ' + o.slippageBps + ' bps slippage in prices' : ''); },
      why: 'Total commissions paid. Slippage is not listed separately: it is already inside every fill price, which is exactly how it hides in real life.' },
    { key: 'finalEquity', label: 'Final equity', fmt: function (s) { return money(s.finalEquity, 0); }, tone: function (s) { return s.netProfit; },
      sub: function (s) { return isNum(s.netProfit) ? (s.netProfit >= 0 ? 'profit ' : 'loss ') + money(Math.abs(s.netProfit), 0) : ''; },
      why: 'Cash at the end, with any open position closed at the last price.' }
  ];

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var state = Object.assign({
    symbol: 'AAPL', interval: '1day', lookback: 750, strategy: 'smaCross', params: {},
    cash: 100000, sizePct: 100, commission: 0, slippageBps: 5, allowShort: false
  }, store.get(SETTINGS_KEY, {}));
  if (!LOOKBACKS[state.interval]) state.interval = '1day';

  var bars = null, barsInfo = null;    // bars of the last data load, and {source, fallback, reason, live}
  var result = null;                  // last BT.backtest.run result
  var lastOpt = null, lastCmp = null;

  function saveSettings() { store.set(SETTINGS_KEY, state); }

  function registryEntry(id) {
    var list = engine.builtins || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }
  function currentStrategy(params) {
    var reg = registryEntry(state.strategy);
    if (!reg) return null;
    return reg.factory(Object.assign({}, reg.defaults, params || state.params));
  }
  function runOptions() {
    return { cash: state.cash, sizePct: state.sizePct, commission: state.commission, slippageBps: state.slippageBps, allowShort: state.allowShort };
  }

  /* ------------------------------------------------------------------ *
   * Controls
   * ------------------------------------------------------------------ */
  function fillSymbolList() {
    var dl = $('symlist');
    if (!dl || !data || !data.universe) return;
    dl.innerHTML = data.universe.map(function (u) { return '<option value="' + esc(u.symbol) + '">' + esc(u.name) + '</option>'; }).join('');
  }
  function showSymbolName() {
    var el = $('symname');
    if (!el) return;
    var sym = state.symbol;
    var u = data && data.lookup ? data.lookup(sym) : null;
    el.textContent = u ? (u.synthetic ? 'Not in the demo universe: simulated at random, or real if a live key is set' : u.name + (u.sector ? ' · ' + u.sector : '')) : '';
  }
  function fillLookbacks() {
    var sel = $('lookback'), list = LOOKBACKS[state.interval] || LOOKBACKS['1day'];
    var ok = list.some(function (l) { return l[0] === state.lookback; });
    if (!ok) state.lookback = list[Math.min(2, list.length - 1)][0];
    sel.innerHTML = list.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === state.lookback ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('');
    $('datanote').textContent = DATANOTE[state.interval] || DATANOTE['1day'];
  }
  function fillStrategies() {
    var sel = $('strategy');
    sel.innerHTML = (engine.builtins || []).map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === state.strategy ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('');
    if (!registryEntry(state.strategy)) state.strategy = engine.builtins[0].id;
  }

  /** Build one slider + number input per numeric parameter of the chosen strategy. */
  function renderParams() {
    var reg = registryEntry(state.strategy), host = $('params');
    if (!reg) { host.innerHTML = ''; return; }
    // only keep stored params that exist for this strategy
    var defaults = reg.defaults || {}, kept = {};
    Object.keys(defaults).forEach(function (k) { kept[k] = isNum(state.params[k]) ? state.params[k] : defaults[k]; });
    state.params = kept;
    var strat = currentStrategy();
    var params = strat && strat.params ? strat.params : defaults;
    $('stratdesc').textContent = strat ? strat.description : '';
    var keys = Object.keys(params).filter(function (k) { return isNum(params[k]); });
    if (!keys.length) { host.innerHTML = '<p class="muted" style="font-size:var(--fs-sm);margin:0">This strategy has no parameters to tune, which is one reason it is so hard to beat.</p>'; return; }
    host.innerHTML = keys.map(function (k) {
      var m = metaFor(reg.id, k, params[k]), v = params[k];
      var min = Math.min(m.min, v), max = Math.max(m.max, v);
      return '<div class="param" data-key="' + esc(k) + '">' +
        '<label for="p-' + esc(k) + '">' + esc(m.label) + '</label>' +
        '<input id="p-' + esc(k) + '" type="number" class="num" min="' + min + '" max="' + max + '" step="' + m.step + '" value="' + v + '">' +
        '<input type="range" aria-label="' + esc(m.label) + ' slider" min="' + min + '" max="' + max + '" step="' + m.step + '" value="' + v + '">' +
        '<span class="help">' + esc(m.help) + '</span></div>';
    }).join('');
    host.querySelectorAll('.param').forEach(function (row) {
      var key = row.dataset.key, numEl = row.querySelector('input[type=number]'), rng = row.querySelector('input[type=range]');
      function set(v, from) {
        if (!isNum(v)) return;
        var step = +numEl.step || 1, dec = (String(step).split('.')[1] || '').length;
        v = +clamp(v, +numEl.min, +numEl.max).toFixed(dec);
        state.params[key] = v;
        if (from !== numEl) numEl.value = v;
        if (from !== rng) rng.value = v;
        var strat2 = currentStrategy();
        if (strat2) $('stratdesc').textContent = strat2.description;
        saveSettings();
      }
      rng.addEventListener('input', function () { set(+rng.value, rng); });
      numEl.addEventListener('change', function () { set(+numEl.value, numEl); });
    });
  }

  function readAccountInputs() {
    state.cash = clamp(+$('cash').value || 100000, 1000, 1e9);
    state.sizePct = clamp(+$('sizepct').value || 100, 1, 100);
    state.commission = Math.max(0, +$('commission').value || 0);
    state.slippageBps = clamp(+$('slippage').value || 0, 0, 500);
    state.allowShort = !!$('allowshort').checked;
    $('cash').value = state.cash; $('sizepct').value = state.sizePct; $('commission').value = state.commission; $('slippage').value = state.slippageBps;
    saveSettings();
  }
  function writeControls() {
    $('symbol').value = state.symbol;
    $('interval').value = state.interval;
    $('cash').value = state.cash; $('sizepct').value = state.sizePct; $('commission').value = state.commission; $('slippage').value = state.slippageBps;
    $('allowshort').checked = !!state.allowShort;
    fillLookbacks(); fillStrategies(); renderParams(); showSymbolName();
  }

  /* ------------------------------------------------------------------ *
   * Charts
   * ------------------------------------------------------------------ */
  var charts = {};   // name → {chart, series:{}, el}
  var syncing = false;

  function chartTheme(intraday) {
    return {
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--muted'), fontFamily: css('--mono') },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: !!intraday, secondsVisible: false },
      crosshair: { mode: 0 }
    };
  }
  function mkChart(name, el, extra) {
    if (charts[name]) { charts[name].chart.applyOptions(chartTheme(state.interval !== '1day')); return charts[name]; }   // bar size may have changed
    var chart = LW.createChart(el, Object.assign({ autoSize: true, handleScale: { axisPressedMouseMove: true } }, chartTheme(state.interval !== '1day'), extra || {}));
    charts[name] = { chart: chart, series: {}, el: el, group: (extra && extra._group) || 'main' };
    return charts[name];
  }
  function lineOpts(color, extra) { return Object.assign({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, extra || {}); }
  function clearSeries(c) {
    Object.keys(c.series).forEach(function (k) { try { c.chart.removeSeries(c.series[k]); } catch (e) { /* already gone */ } });
    c.series = {};
  }
  /** Keep the time scales of the charts in a group moving together. */
  function syncGroup(group) {
    var members = Object.keys(charts).filter(function (k) { return charts[k].group === group && !charts[k].synced; });
    members.forEach(function (k) {
      var me = charts[k];
      me.synced = true;
      me.chart.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
        if (syncing || !range) return;
        syncing = true;
        Object.keys(charts).forEach(function (o) { if (o !== k && charts[o].group === group) { try { charts[o].chart.timeScale().setVisibleLogicalRange(range); } catch (e) { /* no data yet */ } } });
        syncing = false;
      });
    });
  }
  function fitAll(group) {
    Object.keys(charts).forEach(function (k) { if (charts[k].group === group) charts[k].chart.timeScale().fitContent(); });
  }
  function applyThemeToCharts() {
    var intraday = state.interval !== '1day';
    Object.keys(charts).forEach(function (k) {
      var c = charts[k];
      c.chart.applyOptions(chartTheme(intraday));
      Object.keys(c.series).forEach(function (sk) {
        var s = c.series[sk], v = s._colorVar;
        if (!v) return;
        if (sk === 'candles') s.applyOptions({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down') });
        else if (s._kind === 'hist') { /* per-bar colours are data-driven; re-render handles them */ }
        else s.applyOptions({ color: css(v) });
      });
    });
    if (result) { renderPriceChart(); renderEquityChart(); }
    if (lastCmp) renderCompareChart(lastCmp);
  }

  /** Which indicator overlays / sub-pane a strategy wants drawn. */
  function overlaysFor(strat, ind) {
    var p = strat.params || {}, id = strat.id, lines = [], sub = null;
    var c = ind.closes;
    if (id === 'smaCross') {
      lines.push({ key: 'SMA ' + p.fast, color: '--s1', values: ind.smaN(p.fast) });
      lines.push({ key: 'SMA ' + p.slow, color: '--s2', values: ind.smaN(p.slow) });
    } else if (id === 'rsiReversion') {
      sub = { title: 'RSI ' + p.n, lines: [{ key: 'RSI', color: '--s3', values: ind.rsiN(p.n) }], levels: [{ price: p.low, color: '--up', title: 'oversold ' + p.low }, { price: p.high, color: '--down', title: 'overbought ' + p.high }], range: { min: 0, max: 100 } };
    } else if (id === 'macdCross') {
      var m = (I && I.macd) ? I.macd(c, p.fast, p.slow, p.signal) : ind.macd;
      sub = { title: 'MACD ' + p.fast + ',' + p.slow + ',' + p.signal, lines: [{ key: 'MACD', color: '--s2', values: m.macd }, { key: 'Signal', color: '--s1', values: m.signal }], hist: m.hist };
    } else if (id === 'bollingerBounce') {
      var bb = (I && I.bollinger) ? I.bollinger(c, p.n, p.k) : ind.bollinger;
      lines.push({ key: 'Upper ' + p.k + 'σ', color: '--muted', values: bb.upper, style: 2 });
      lines.push({ key: 'SMA ' + p.n, color: '--s1', values: bb.middle });
      lines.push({ key: 'Lower ' + p.k + 'σ', color: '--muted', values: bb.lower, style: 2 });
    } else if (id === 'breakout') {
      lines.push({ key: p.n + '-bar high', color: '--up', values: ind.priorHigh(p.n), style: 2 });
      lines.push({ key: p.n + '-bar low', color: '--down', values: ind.priorLow(p.n), style: 2 });
    } else if (id === 'compositeSignal') {
      lines.push({ key: 'SMA 20', color: '--s1', values: ind.sma20 });
      lines.push({ key: 'SMA 50', color: '--s2', values: ind.sma50 });
      var scores = (I && I.scoreSeries) ? I.scoreSeries(ind.bars, ind) : null;
      if (scores) sub = { title: 'Composite score', hist: scores, levels: [{ price: p.buyAt, color: '--up', title: 'buy ≥ ' + p.buyAt }, { price: p.sellAt, color: '--down', title: 'sell ≤ ' + p.sellAt }], range: { min: -8, max: 8 }, lines: [] };
    } else if (id === 'buyAndHold') {
      lines.push({ key: 'SMA 200', color: '--s2', values: ind.sma200 });
    }
    return { lines: lines, sub: sub };
  }
  function toLine(barsArr, values) {
    var out = [];
    for (var i = 0; i < barsArr.length; i++) if (isNum(values[i])) out.push({ time: barsArr[i].time, value: values[i] });
    return out;
  }

  function renderPriceChart() {
    if (!result || !bars) return;
    var P = mkChart('price', $('pricepane'));
    clearSeries(P);
    var candles = P.chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down'), borderVisible: false });
    candles._colorVar = '--up';
    candles.setData(bars.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
    var vol = P.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
    vol._kind = 'hist';
    var upC = css('--up-soft') || css('--up'), dnC = css('--down-soft') || css('--down');
    vol.setData(bars.map(function (b) { return { time: b.time, value: b.volume || 0, color: b.close >= b.open ? upC : dnC }; }));
    P.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    P.chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
    P.series.candles = candles; P.series.vol = vol;
    if (BT.a11y) {
      var lastB = bars[bars.length - 1], st0 = result.stats || {};
      BT.a11y.describeChart(P.el, T('{symbol} {interval} candlestick chart with {strategy} trade markers: {n} bars, last close {close}, strategy return {ret}, {trades} trades', {
        symbol: state.symbol, interval: state.interval, strategy: result.strategy.name, n: bars.length, close: money(lastB.close), ret: pct(st0.totalReturnPct), trades: st0.trades == null ? '—' : st0.trades
      }));
    }

    var ind = engine.buildInd(bars);
    var strat = currentStrategy(result.strategy.params);
    var ov = overlaysFor(strat || result.strategy, ind);
    var tag = ['<b>' + esc(state.symbol) + '</b> ' + esc(state.interval) + ' · ' + esc(result.strategy.name)];
    ov.lines.forEach(function (l, i) {
      var s = P.chart.addLineSeries(lineOpts(css(l.color), { lineStyle: l.style || 0, lineWidth: l.style ? 1 : 1.5 }));
      s._colorVar = l.color;
      s.setData(toLine(bars, l.values));
      P.series['ov' + i] = s;
      tag.push('<span><span class="sw' + (l.style ? ' dash' : '') + '" style="background:' + css(l.color) + '"></span>' + esc(l.key) + '</span>');
    });
    tag.push('<span><span class="sw" style="background:' + css('--up') + '"></span>▲ entry</span><span><span class="sw" style="background:' + css('--down') + '"></span>▼ exit (colour = P&amp;L)</span>');
    $('pricetag').innerHTML = tag.join('');
    candles.setMarkers(result.markers || []);

    // sub-pane (RSI / MACD / composite score)
    var subEl = $('subpane');
    if (ov.sub) {
      subEl.hidden = false;
      var S = mkChart('sub', subEl, { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } } });
      clearSeries(S);
      var subTag = ['<b>' + esc(ov.sub.title) + '</b>'];
      if (ov.sub.hist) {
        var h = S.chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, base: 0 });
        h._kind = 'hist';
        var hu = css('--up'), hd = css('--down');
        h.setData(bars.map(function (b, i) { return isNum(ov.sub.hist[i]) ? { time: b.time, value: ov.sub.hist[i], color: ov.sub.hist[i] >= 0 ? hu : hd } : null; }).filter(Boolean));
        S.series.hist = h;
        subTag.push('<span>histogram</span>');
      }
      (ov.sub.lines || []).forEach(function (l, i) {
        var s = S.chart.addLineSeries(lineOpts(css(l.color), { lineWidth: 1.5 }));
        s._colorVar = l.color;
        s.setData(toLine(bars, l.values));
        S.series['l' + i] = s;
        subTag.push('<span><span class="sw" style="background:' + css(l.color) + '"></span>' + esc(l.key) + '</span>');
      });
      var anchor = S.series.l0 || S.series.hist;
      if (anchor && ov.sub.levels) {
        ov.sub.levels.forEach(function (lv) { anchor.createPriceLine({ price: lv.price, color: css(lv.color), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: lv.title }); });
      }
      if (anchor && ov.sub.range) {
        anchor.applyOptions({ autoscaleInfoProvider: function () { return { priceRange: { minValue: ov.sub.range.min, maxValue: ov.sub.range.max } }; } });
      }
      $('subtag').innerHTML = subTag.join('');
    } else {
      subEl.hidden = true;
    }
    syncGroup('main');
    fitAll('main');
  }

  function renderEquityChart() {
    if (!result || !bars) return;
    var E = mkChart('equity', $('equitypane'), { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.05 } } });
    clearSeries(E);
    var eq = E.chart.addLineSeries(lineOpts(css('--accent'), { lineWidth: 2, lastValueVisible: true, priceLineVisible: true }));
    eq._colorVar = '--accent';
    eq.setData(result.equity.map(function (e) { return { time: e.time, value: round(e.equity, 2) }; }));
    var bh = E.chart.addLineSeries(lineOpts(css('--muted'), { lineWidth: 1, lineStyle: 2, lastValueVisible: true }));
    bh._colorVar = '--muted';
    bh.setData(engine.buyHoldEquity(bars, state.cash).map(function (e) { return { time: e.time, value: round(e.equity, 2) }; }));
    E.series.eq = eq; E.series.bh = bh;
    $('equitytag').innerHTML = '<b>Equity</b> <span>start ' + esc(money(result.stats.startCash, 0)) + ' → ' + esc(money(result.stats.finalEquity, 0)) + '</span>';

    var D = mkChart('dd', $('ddpane'), { rightPriceScale: { scaleMargins: { top: 0.05, bottom: 0.05 } } });
    clearSeries(D);
    var dd = D.chart.addAreaSeries({ lineColor: css('--down'), topColor: 'rgba(0,0,0,0)', bottomColor: css('--down-soft') || css('--down'), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, invertFilledArea: false });
    dd._colorVar = '--down';
    dd.setData(engine.drawdownSeries(result.equity).map(function (d) { return { time: d.time, value: round(d.value, 2) }; }));
    D.series.dd = dd;
    syncGroup('main');
    fitAll('main');
  }

  /* ------------------------------------------------------------------ *
   * Stats, coaching and trades
   * ------------------------------------------------------------------ */
  function renderStats() {
    var s = result.stats, o = result.options || {};
    $('statstitle').textContent = result.strategy.name;
    $('stats').innerHTML = STAT_DEFS.map(function (d) {
      var tone = d.tone(s), cls = isNum(tone) ? (tone > 0 ? ' up' : tone < 0 ? ' down' : '') : '';
      return '<div class="stat"><span class="label">' + esc(d.label) + '<span class="q" title="' + esc(d.why) + '" aria-label="' + esc(d.why) + '" tabindex="0">?</span></span>' +
        '<span class="value' + cls + '">' + esc(d.fmt(s)) + '</span><span class="sub">' + esc(d.sub(s, o)) + '</span></div>';
    }).join('');
  }
  function renderCoach() {
    var lines = engine.explain(result) || [];
    if (result.errors) lines.push('The strategy threw an error on ' + result.errors + ' bar' + (result.errors === 1 ? '' : 's') + '; those bars produced no signal.');
    $('coach').innerHTML = lines.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
  }
  function renderTrades() {
    var tb = $('tradetable').querySelector('tbody'), tr = result.trades || [];
    var wins = tr.filter(function (t) { return t.pnl > 0; }).length;
    $('tradesum').textContent = tr.length ? T('{n} round trips · {wins} profitable · net {net}', { n: tr.length, wins: wins, net: money(tr.reduce(function (a, t) { return a + t.pnl; }, 0), 0) }) : T('none');
    if (!tr.length) { tb.innerHTML = '<tr><td colspan="10" class="muted">No trades. The rules never fired on these bars, or the position size could not buy a single share.</td></tr>'; return; }
    tb.innerHTML = tr.map(function (t, i) {
      var cls = t.pnl >= 0 ? 'up' : 'down';
      return '<tr data-i="' + i + '" tabindex="0"><td class="num">' + (i + 1) + '</td><td><span class="side ' + t.side + '">' + t.side + '</span></td>' +
        '<td>' + esc(fmtTime(t.entryTime)) + '</td><td class="num">' + esc(money(t.entry)) + '</td>' +
        '<td>' + esc(fmtTime(t.exitTime)) + (t.openAtEnd ? ' <span class="muted" title="Still open on the last bar; closed at the last price for the statistics">(open)</span>' : '') + '</td><td class="num">' + esc(money(t.exit)) + '</td>' +
        '<td class="num">' + t.qty + '</td><td class="num">' + t.bars + '</td>' +
        '<td class="num ' + cls + '">' + esc(money(t.pnl, 0)) + '</td><td class="num ' + cls + '">' + esc(pct(t.pnlPct, 2)) + '</td></tr>';
    }).join('');
    tb.querySelectorAll('tr').forEach(function (row) {
      function go() {
        var t = tr[+row.dataset.i]; if (!t || !charts.price) return;
        tb.querySelectorAll('tr.on').forEach(function (r) { r.classList.remove('on'); });
        row.classList.add('on');
        var from = Math.max(0, t.entryIndex - 15), to = Math.min(bars.length - 1, t.exitIndex + 15);
        try { charts.price.chart.timeScale().setVisibleLogicalRange({ from: from, to: to }); } catch (e) { /* ignore */ }
        $('pricepane').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      row.addEventListener('click', go);
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
  function tradesCsv() {
    var head = 'n,side,entry_time,entry_price,exit_time,exit_price,qty,bars,pnl,pnl_pct,commission,open_at_end';
    var rows = (result.trades || []).map(function (t, i) {
      return [i + 1, t.side, '"' + fmtTime(t.entryTime) + '"', round(t.entry, 4), '"' + fmtTime(t.exitTime) + '"', round(t.exit, 4), t.qty, t.bars, round(t.pnl, 2), round(t.pnlPct, 3), round(t.commission, 2), t.openAtEnd ? 1 : 0].join(',');
    });
    return [head].concat(rows).join('\n');
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); res(); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }

  /* ------------------------------------------------------------------ *
   * Data loading & running
   * ------------------------------------------------------------------ */
  function setDataPill(info) {
    var pill = $('datapill'), src = $('srcpill');
    if (!info) return;
    var live = !!info.live && !info.fallback;
    pill.className = 'pill ' + (live ? 'live' : 'demo');
    pill.textContent = live ? 'live · ' + (data && data.PROVIDER_LABEL && data.PROVIDER_LABEL[info.source] || info.source) + (info.cached ? ' (cached)' : '') : 'demo prices';
    pill.title = live ? 'Real historical bars from ' + (info.source || 'your provider') : (info.reason || 'Simulated prices: deterministic per symbol so every student sees the same chart. Add a free API key on the dashboard for real prices.');
    if (src) { src.className = 'pill hide-sm ' + (live ? 'live' : 'demo'); src.textContent = live ? 'live' : 'demo'; }
  }

  async function loadBars() {
    var sym = state.symbol, tf = state.interval, n = state.lookback;
    var res, info;
    try {
      res = await data.candles(sym, tf, n);
    } catch (e) {
      res = data.demo(sym, tf, n);
      res.fallback = true; res.reason = (e && e.message) || 'Data error';
    }
    info = { source: res.source || 'demo', live: !!res.live, fallback: !!res.fallback, reason: res.reason, cached: !!res.cached, stale: !!res.stale };
    var arr = Array.prototype.slice.call(res);
    // drop any malformed bar so the engine and charts never see NaN
    arr = arr.filter(function (b) { return b && isNum(b.open) && isNum(b.high) && isNum(b.low) && isNum(b.close); });
    return { bars: arr, info: info };
  }

  var running = false;
  async function run(opts) {
    opts = opts || {};
    if (running) return;
    running = true;
    readAccountInputs();
    state.symbol = ($('symbol').value || '').trim().toUpperCase() || 'AAPL';
    $('symbol').value = state.symbol;
    showSymbolName();
    saveSettings();
    var btn = $('run');
    btn.disabled = true; btn.textContent = 'Loading…';
    setMsg('runmsg', '');
    $('priceoverlay').hidden = false;
    try {
      if (!bars || opts.reload || barsInfo.key !== state.symbol + '|' + state.interval + '|' + state.lookback) {
        var got = await loadBars();
        bars = got.bars; barsInfo = got.info; barsInfo.key = state.symbol + '|' + state.interval + '|' + state.lookback;
        lastOpt = null; lastCmp = null;
        $('optout').hidden = true; $('cmpout').hidden = true;
      }
      if (!bars || bars.length < 30) throw new Error('Only ' + (bars ? bars.length : 0) + ' bars came back for ' + state.symbol + '. Try another symbol or a daily bar size.');
      var strat = currentStrategy();
      if (!strat) throw new Error('Unknown strategy');
      btn.textContent = 'Running…';
      result = engine.run(strat, bars, runOptions());
      if (result.error) throw new Error(result.error);
      $('empty').hidden = true; $('resultwrap').hidden = false;
      setDataPill(barsInfo);
      $('barspill').textContent = T('{n} bars · {from} → {to}', { n: bars.length, from: fmtTime(bars[0].time), to: fmtTime(bars[bars.length - 1].time) });
      var fb = $('fallbacknote');
      if (barsInfo.fallback || !barsInfo.live) { fb.hidden = false; fb.innerHTML = '<span><b>Simulated prices.</b> ' + esc(barsInfo.reason || 'These bars are a deterministic random walk per symbol, so the same test gives the same answer for every student.') + ' The mechanics and statistics are exactly what they would be on real data; only the price path is invented. Add a free API key on the <a href="index.html">dashboard</a> for real history.</span>'; }
      else if (barsInfo.stale) { fb.hidden = false; fb.textContent = T('Live refresh failed; showing the last downloaded bars. {reason}', { reason: barsInfo.reason || '' }); }
      else fb.hidden = true;
      var pn = $('pendingnote');
      if (result.pendingSignal) { pn.hidden = false; pn.innerHTML = '<span><b>A signal fired on the last bar</b> (' + esc(result.pendingSignal === 'long' ? 'go long' : result.pendingSignal === 'short' ? 'go short' : 'exit') + ') and could not fill, because the engine fills at the <em>next</em> open and there is no next bar yet. On the dashboard this is what a live BUY/SELL badge looks like the evening before.</span>'; }
      else pn.hidden = true;
      renderPriceChart(); renderEquityChart(); renderStats(); renderCoach(); renderTrades();
      var s = result.stats;
      announce(result.strategy.name + ' on ' + state.symbol + ': ' + pct(s.totalReturnPct) + ' versus buy and hold ' + pct(s.buyHoldReturnPct) + ', ' + s.trades + ' trades.');
      setMsg('runmsg', result.strategy.name + ': ' + pct(s.totalReturnPct) + ' vs buy & hold ' + pct(s.buyHoldReturnPct) + ' · ' + s.trades + ' trades', s.excessVsBuyHoldPct >= 0 ? 'ok' : '');
      if (opts.scroll) $('pricepane').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      setMsg('runmsg', (e && e.message) || 'Something went wrong', 'err');
      toast((e && e.message) || 'Something went wrong', 'err', 'Back-test failed');
    } finally {
      $('priceoverlay').hidden = true;
      btn.disabled = false; btn.textContent = 'Run back-test';
      running = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Optimiser
   * ------------------------------------------------------------------ */
  function renderGridEditor() {
    var reg = registryEntry(state.strategy), host = $('gridrows');
    if (!reg || !Object.keys(reg.grid || {}).length) {
      host.innerHTML = '<span class="muted" style="grid-column:1/-1;font-size:var(--fs-sm)">' + esc(reg ? reg.name : 'This strategy') + ' has no parameters to search. Pick another strategy to use the optimiser.</span>';
      $('optrun').disabled = true;
      return;
    }
    $('optrun').disabled = false;
    host.innerHTML = Object.keys(reg.grid).map(function (k) {
      var m = metaFor(reg.id, k, reg.defaults[k]);
      return '<label for="g-' + esc(k) + '" title="' + esc(m.help) + '">' + esc(m.label) + '</label><input id="g-' + esc(k) + '" type="text" data-key="' + esc(k) + '" value="' + esc(reg.grid[k].join(', ')) + '" inputmode="decimal" aria-label="' + esc(m.label) + ' values, comma separated">';
    }).join('');
  }
  function readGrid() {
    var grid = {}, bad = [];
    $('gridrows').querySelectorAll('input[data-key]').forEach(function (inp) {
      var vals = inp.value.split(/[,\s;]+/).map(function (v) { return parseFloat(v); }).filter(isNum);
      var uniq = []; vals.forEach(function (v) { if (uniq.indexOf(v) < 0) uniq.push(v); });
      if (!uniq.length) bad.push(inp.dataset.key); else grid[inp.dataset.key] = uniq;
    });
    return { grid: grid, bad: bad };
  }
  function paramsLabel(p) { return Object.keys(p).map(function (k) { return k + '=' + p[k]; }).join(' · '); }
  function metricLabel(m) { return { sharpe: 'Sharpe', totalReturnPct: 'Return', cagr: 'CAGR', profitFactor: 'Profit factor', calmar: 'Calmar', maxDrawdownPct: 'Max DD' }[m] || m; }
  function metricFmt(m, v) {
    if (m === 'totalReturnPct' || m === 'cagr' || m === 'maxDrawdownPct') return pct(v);
    return num(v, 2);
  }
  function statMetric(st, m) {
    if (!st) return null;
    if (m === 'calmar') return st.maxDrawdownPct > 0 && isNum(st.cagr) ? st.cagr / st.maxDrawdownPct : (st.cagr || 0);
    return st[m];
  }

  async function runOptimize() {
    if (!bars) { await run(); if (!bars) return; }
    var reg = registryEntry(state.strategy);
    var g = readGrid();
    if (g.bad.length) { setMsg('optmsg', 'Enter at least one number for ' + g.bad.join(', ') + '.', 'err'); return; }
    var metric = $('optmetric').value, oos = +$('optoos').value, minTrades = Math.max(0, +$('optmin').value || 0);
    var combos = engine.expandGrid(g.grid).length;
    setMsg('optmsg', 'Testing ' + Math.min(combos, engine.OPTIMIZE_CAP) + ' of ' + combos + ' combinations on ' + bars.length + ' bars…');
    $('optcard').classList.add('busy');
    readAccountInputs();
    // let the browser paint the message before the (synchronous) search
    await new Promise(function (r) { setTimeout(r, 40); });
    var t0 = performance.now();
    var filter = reg.id === 'smaCross' ? function (p) { return p.fast < p.slow; } : reg.id === 'macdCross' ? function (p) { return p.fast < p.slow; } : reg.id === 'rsiReversion' ? function (p) { return p.low < p.high; } : reg.id === 'compositeSignal' ? function (p) { return p.sellAt < p.buyAt; } : null;
    var res;
    try {
      res = engine.optimize(reg.factory, bars, g.grid, Object.assign(runOptions(), { metric: metric, minTrades: minTrades, oosPct: oos, filter: filter }));
    } catch (e) {
      $('optcard').classList.remove('busy');
      setMsg('optmsg', 'Optimisation failed: ' + (e && e.message), 'err');
      return;
    }
    $('optcard').classList.remove('busy');
    lastOpt = { results: res, metric: metric, oos: oos, reg: reg, grid: g.grid, ms: performance.now() - t0 };
    renderOptimize();
  }

  function renderOptimize() {
    var o = lastOpt, res = o.results, metric = o.metric;
    $('optout').hidden = false;
    setMsg('optmsg', res.tested + ' combinations tested in ' + num(o.ms / 1000, 1) + ' s.', 'ok');
    $('optsummary').textContent = T('In-sample {n} bars', { n: res.inSampleBars }) + ' · ' + (res.oosBars ? T('out-of-sample {n} bars', { n: res.oosBars }) : T('no out-of-sample hold-out')) + ' · ' + T('ranked by {metric}', { metric: metricLabel(metric) }) + (res.truncated ? ' · ' + T('grid thinned to {n}', { n: engine.OPTIMIZE_CAP }) : '');

    // Overfitting check on the winner
    var top = res[0], warn = [res.warning];
    if (top) {
      if (top.oosStats) {
        var isV = statMetric(top.stats, metric), oosV = statMetric(top.oosStats, metric);
        var isR = top.stats.totalReturnPct, oosR = top.oosStats.totalReturnPct;
        if (isNum(isV) && isNum(oosV) && isV > 0 && oosV < isV * 0.5) warn.push('Overfitting alert: the best in-sample ' + metricLabel(metric) + ' (' + metricFmt(metric, isV) + ') fell to ' + metricFmt(metric, oosV) + ' on bars the parameters never saw. The optimiser found parameters that fit the past, not a rule that generalises.');
        else if (isNum(isR) && isNum(oosR) && oosR < 0 && isR > 0) warn.push('The winner made ' + pct(isR) + ' in-sample and lost ' + pct(oosR) + ' out-of-sample. That is the signature of curve fitting.');
        else if (isNum(isV) && isNum(oosV)) warn.push('Encouraging: the winner held up out-of-sample (' + metricLabel(metric) + ' ' + metricFmt(metric, isV) + ' in-sample vs ' + metricFmt(metric, oosV) + ' out-of-sample). Still, one hold-out period is one data point; test other symbols too.');
      } else {
        warn.push('No hold-out: every number here was tuned on the same bars it is judged on, so the top rows are flattered by luck. Choose a hold-out above and re-run before believing any of them.');
      }
      if (!top.enoughTrades) warn.push('Even the best combination has fewer trades than your minimum, so the ranking is mostly noise.');
      var scoresOk = res.filter(function (r) { return isNum(r.score) && r.score > -Infinity; }).map(function (r) { return r.score; });
      if (scoresOk.length > 4) {
        var sorted = scoresOk.slice().sort(function (a, b) { return b - a; });
        var median = sorted[Math.floor(sorted.length / 2)], best = sorted[0], second = sorted[1];
        if (best > 0 && second > 0 && best > second * 1.6 && best > median * 3) warn.push('The top score is a lone spike: the next-best combination scores ' + num(second, 2) + ' and the median ' + num(median, 2) + '. Trust plateaus, not spikes.');
      }
    }
    $('optwarn').innerHTML = warn.map(function (w, i) { return '<p>' + (i === 0 ? '<span class="title">Read before you believe the table</span>' : '') + esc(w) + '</p>'; }).join('');

    // Plateau chart: scores in grid order
    var order = engine.expandGrid(o.grid);
    var byKey = {}; res.forEach(function (r) { byKey[JSON.stringify(r.params)] = r; });
    var items = order.map(function (p) { return byKey[JSON.stringify(p)]; }).filter(Boolean);
    var vals = items.map(function (r) { return isNum(r.score) && r.score > -Infinity ? r.score : 0; });
    var mx = Math.max.apply(null, vals.map(Math.abs).concat([1e-9]));
    $('plateau').innerHTML = items.map(function (r, i) {
      var v = vals[i], h = Math.max(2, Math.round(Math.abs(v) / mx * 44));
      return '<span class="' + (v < 0 ? 'neg' : '') + (r.enoughTrades ? '' : ' few') + '" style="height:' + h + 'px" title="' + esc(paramsLabel(r.params) + ' → ' + metricLabel(o.metric) + ' ' + metricFmt(o.metric, v) + (r.enoughTrades ? '' : ' (too few trades)')) + '"></span>';
    }).join('');

    // Table
    var hasOos = !!(top && top.oosStats);
    var head = '<tr><th>#</th><th>Parameters</th><th class="num">Trades</th><th class="num">Return</th><th class="num">Max DD</th><th class="num">Sharpe</th><th class="num">PF</th><th class="num">' + esc(metricLabel(metric)) + '</th>' + (hasOos ? '<th class="num">OOS return</th><th class="num">OOS ' + esc(metricLabel(metric)) + '</th><th class="num">Gap</th>' : '') + '</tr>';
    $('opttable').querySelector('thead').innerHTML = head;
    $('opttable').querySelector('tbody').innerHTML = res.slice(0, 60).map(function (r) {
      var s = r.stats, oo = r.oosStats, gap = oo && isNum(r.score) && isNum(r.oosScore) ? r.oosScore - r.score : null;
      return '<tr data-rank="' + r.rank + '" class="' + (r.rank === 1 ? 'top' : '') + (r.enoughTrades ? '' : ' few') + '" title="Load these parameters">' +
        '<td class="num">' + r.rank + '</td><td>' + esc(paramsLabel(r.params)) + (r.enoughTrades ? '' : ' <span class="muted">(few trades)</span>') + '</td>' +
        '<td class="num">' + s.trades + '</td><td class="num ' + (s.totalReturnPct >= 0 ? 'up' : 'down') + '">' + esc(pct(s.totalReturnPct)) + '</td>' +
        '<td class="num">−' + esc(pct(s.maxDrawdownPct, 1, false)) + '</td><td class="num">' + esc(num(s.sharpe, 2)) + '</td><td class="num">' + esc(num(s.profitFactor, 2)) + '</td>' +
        '<td class="num">' + esc(metricFmt(metric, r.score)) + '</td>' +
        (hasOos ? '<td class="num ' + (oo && oo.totalReturnPct >= 0 ? 'up' : 'down') + '">' + esc(oo ? pct(oo.totalReturnPct) : '—') + '</td><td class="num">' + esc(oo ? metricFmt(metric, r.oosScore) : '—') + '</td><td class="num gap ' + (gap != null ? (gap >= 0 ? 'up' : 'down') : '') + '">' + esc(gap != null ? (gap >= 0 ? '+' : '') + num(gap, 2) : '—') + '</td>' : '') + '</tr>';
    }).join('');
    $('opttable').querySelectorAll('tbody tr').forEach(function (row) {
      row.addEventListener('click', function () {
        var r = res[+row.dataset.rank - 1]; if (!r) return;
        state.params = Object.assign({}, r.params);
        renderParams();
        saveSettings();
        run({ fromOpt: true, scroll: true });
        toast(T('Loaded {params} into the sliders and re-ran on all bars.', { params: paramsLabel(r.params) }), '', 'Parameters applied');
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Compare strategies
   * ------------------------------------------------------------------ */
  var CMP_COLORS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--accent'];

  async function runCompare() {
    if (!bars) { await run(); if (!bars) return; }
    readAccountInputs();
    var metric = $('cmpmetric').value;
    setMsg('cmpmsg', 'Running ' + engine.builtins.length + ' strategies…');
    $('cmpcard').classList.add('busy');
    await new Promise(function (r) { setTimeout(r, 40); });
    var rows = [];
    try {
      engine.builtins.forEach(function (b, i) {
        var params = b.id === state.strategy ? Object.assign({}, b.defaults, state.params) : b.defaults;
        var strat = b.factory(params);
        var r = engine.run(strat, bars, runOptions());
        rows.push({ id: b.id, name: strat.name, params: params, result: r, stats: r.stats, color: CMP_COLORS[i % CMP_COLORS.length], current: b.id === state.strategy });
      });
    } catch (e) {
      $('cmpcard').classList.remove('busy');
      setMsg('cmpmsg', 'Comparison failed: ' + (e && e.message), 'err');
      return;
    }
    $('cmpcard').classList.remove('busy');
    rows.sort(function (a, b) {
      var va = statMetric(a.stats, metric), vb = statMetric(b.stats, metric);
      if (va === Infinity) va = 1e9; if (vb === Infinity) vb = 1e9;
      if (!isNum(va)) va = -Infinity; if (!isNum(vb)) vb = -Infinity;
      return metric === 'maxDrawdownPct' ? va - vb : vb - va;
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    lastCmp = { rows: rows, metric: metric };
    renderCompare();
  }

  function renderCompareChart(cmp) {
    var C = mkChart('cmp', $('cmppane'), { rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.05 } }, _group: 'cmp' });
    clearSeries(C);
    var tag = ['<b>Equity, all strategies</b>'];
    cmp.rows.forEach(function (r, i) {
      if (r.id === 'buyAndHold') return;
      var s = C.chart.addLineSeries(lineOpts(css(r.color), { lineWidth: r.current ? 2 : 1.25 }));
      s._colorVar = r.color;
      s.setData(r.result.equity.map(function (e) { return { time: e.time, value: round(e.equity, 2) }; }));
      C.series['s' + i] = s;
      tag.push('<span><span class="sw" style="background:' + css(r.color) + '"></span>' + esc(r.name) + '</span>');
    });
    var bh = C.chart.addLineSeries(lineOpts(css('--muted'), { lineWidth: 1, lineStyle: 2 }));
    bh._colorVar = '--muted';
    bh.setData(engine.buyHoldEquity(bars, state.cash).map(function (e) { return { time: e.time, value: round(e.equity, 2) }; }));
    C.series.bh = bh;
    tag.push('<span><span class="sw dash" style="color:' + css('--muted') + '"></span>buy &amp; hold</span>');
    $('cmptag').innerHTML = tag.join('');
    C.chart.timeScale().fitContent();
  }

  function renderCompare() {
    var cmp = lastCmp, rows = cmp.rows, metric = cmp.metric;
    $('cmpout').hidden = false;
    setMsg('cmpmsg', rows.length + ' strategies ranked by ' + metricLabel(metric) + ' on ' + bars.length + ' bars of ' + state.symbol + '.', 'ok');
    renderCompareChart(cmp);

    // return bars relative to buy & hold
    var bhRet = rows[0].stats.buyHoldReturnPct;
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.stats.totalReturnPct); }).concat([Math.abs(bhRet), 1]));
    $('cmpbars').innerHTML = rows.map(function (r) {
      var v = r.stats.totalReturnPct, w = Math.abs(v) / maxAbs * 50, left = v >= 0 ? 50 : 50 - w;
      var bhPos = 50 + (bhRet / maxAbs) * 50;
      return '<div class="cmp-bar"><span class="nm" title="' + esc(r.name) + '"><i style="background:' + css(r.color) + '"></i>' + esc(r.name) + '</span>' +
        '<span class="track"><b class="' + (v < 0 ? 'neg' : '') + '" style="left:' + left + '%;width:' + w + '%"></b><i style="left:' + bhPos + '%" title="buy &amp; hold ' + esc(pct(bhRet)) + '"></i></span>' +
        '<span class="v ' + (v >= 0 ? 'up' : 'down') + '">' + esc(pct(v)) + '</span></div>';
    }).join('');

    var head = '<tr><th>#</th><th>Strategy</th><th class="num">Trades</th><th class="num">Return</th><th class="num">vs B&amp;H</th><th class="num">CAGR</th><th class="num">Max DD</th><th class="num">Sharpe</th><th class="num">Win %</th><th class="num">PF</th><th class="num">Exposure</th></tr>';
    $('cmptable').querySelector('thead').innerHTML = head;
    $('cmptable').querySelector('tbody').innerHTML = rows.map(function (r) {
      var s = r.stats;
      return '<tr data-id="' + esc(r.id) + '" class="' + (r.rank === 1 ? 'top' : '') + '" title="Select this strategy and show its back-test">' +
        '<td class="num">' + r.rank + '</td><td><i style="display:inline-block;width:10px;height:3px;border-radius:1px;margin-right:6px;vertical-align:middle;background:' + css(r.color) + '"></i>' + esc(r.name) + (r.current ? ' <span class="pill accent" style="font-size:9px">current</span>' : '') + '</td>' +
        '<td class="num">' + s.trades + '</td><td class="num ' + (s.totalReturnPct >= 0 ? 'up' : 'down') + '">' + esc(pct(s.totalReturnPct)) + '</td>' +
        '<td class="num ' + (s.excessVsBuyHoldPct >= 0 ? 'up' : 'down') + '">' + esc(pct(s.excessVsBuyHoldPct)) + '</td>' +
        '<td class="num">' + esc(isNum(s.cagr) ? pct(s.cagr) : '—') + '</td><td class="num">−' + esc(pct(s.maxDrawdownPct, 1, false)) + '</td>' +
        '<td class="num">' + esc(num(s.sharpe, 2)) + '</td><td class="num">' + esc(isNum(s.winRate) ? pct(s.winRate, 0, false) : '—') + '</td><td class="num">' + esc(num(s.profitFactor, 2)) + '</td><td class="num">' + esc(pct(s.exposurePct, 0, false)) + '</td></tr>';
    }).join('');
    $('cmptable').querySelectorAll('tbody tr').forEach(function (row) {
      row.addEventListener('click', function () {
        var r = rows.find(function (x) { return x.id === row.dataset.id; }); if (!r) return;
        state.strategy = r.id; state.params = Object.assign({}, r.params);
        fillStrategies(); renderParams(); renderGridEditor(); saveSettings();
        run({ scroll: true });
      });
    });

    // teaching note
    var beat = rows.filter(function (r) { return r.id !== 'buyAndHold' && r.stats.excessVsBuyHoldPct > 0; }).length;
    var active = rows.filter(function (r) { return r.id !== 'buyAndHold'; }).length;
    var best = rows[0], mostTrades = rows.slice().sort(function (a, b) { return b.stats.trades - a.stats.trades; })[0];
    var note = '<span class="title">What to take from this</span>' +
      '<p>' + beat + ' of ' + active + ' active strategies beat buy-and-hold after costs on this symbol and period. ' +
      (beat === 0 ? 'That is normal: on a stock that trended up, doing nothing is very hard to beat, and every active rule paid commissions and slippage to try.' : beat <= active / 2 ? 'Fewer than half: a reminder that trading more is not the same as earning more.' : 'An unusually good period for active rules; check whether they also win on a different symbol and in a different decade before drawing conclusions.') + '</p>' +
      '<p>Best by ' + metricLabel(metric) + ': <b>' + esc(best.name) + '</b>. The most active was ' + esc(mostTrades.name) + ' with ' + mostTrades.stats.trades + ' trades and ' + money(mostTrades.stats.totalCommission || 0, 0) + ' in commissions. Change the ranking metric: the winner by return is rarely the winner by drawdown.</p>' +
      '<p>Every row used default parameters except the strategy currently selected in the rail, which used your sliders. Equal footing matters: an optimised rule against untuned ones is not a fair race.</p>';
    $('cmpnote').innerHTML = note;
  }

  /* ------------------------------------------------------------------ *
   * Deep links (#sym=…&strategy=…&fast=…)
   * ------------------------------------------------------------------ */
  function safeDecode(s) {
    // A malformed escape such as "#sym=%" must never throw and take the whole page down with it.
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }
  function applyHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return false;
    var q = {};
    h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[safeDecode(p[0])] = safeDecode(p[1] || ''); });
    var changed = false;
    if (q.sym || q.symbol) { state.symbol = String(q.sym || q.symbol).toUpperCase().slice(0, 12); changed = true; }
    if (q.tf && LOOKBACKS[q.tf]) { state.interval = q.tf; changed = true; }
    if (q.bars && isNum(+q.bars)) { state.lookback = +q.bars; changed = true; }
    if (q.strategy && registryEntry(q.strategy) && registryEntry(q.strategy).id === q.strategy) { state.strategy = q.strategy; state.params = {}; changed = true; }
    var reg = registryEntry(state.strategy);
    if (reg) Object.keys(reg.defaults || {}).forEach(function (k) { if (q[k] != null && isNum(+q[k])) { state.params[k] = +q[k]; changed = true; } });
    ['cash', 'sizePct', 'commission', 'slippageBps'].forEach(function (k) { if (q[k] != null && isNum(+q[k])) { state[k] = +q[k]; changed = true; } });
    if (q.allowShort != null) { state.allowShort = q.allowShort === '1' || q.allowShort === 'true'; changed = true; }
    if (changed) { if (!LOOKBACKS[state.interval]) state.interval = '1day'; writeControls(); saveSettings(); }
    return q.run === '1' || q.run === 'true';
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  function bind() {
    $('symbol').addEventListener('change', function () { state.symbol = ($('symbol').value || '').trim().toUpperCase(); $('symbol').value = state.symbol; showSymbolName(); saveSettings(); });
    $('symbol').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run({ scroll: true }); } });
    $('randsym').addEventListener('click', function () {
      var u = data && data.universe && data.universe.length ? data.universe[Math.floor(Math.random() * data.universe.length)] : null;
      if (!u) return;
      state.symbol = u.symbol; $('symbol').value = u.symbol; showSymbolName(); saveSettings();
      run({ scroll: true });
    });
    $('interval').addEventListener('change', function () { state.interval = $('interval').value; fillLookbacks(); saveSettings(); });
    $('lookback').addEventListener('change', function () { state.lookback = +$('lookback').value; saveSettings(); });
    $('strategy').addEventListener('change', function () { state.strategy = $('strategy').value; state.params = {}; renderParams(); renderGridEditor(); saveSettings(); });
    $('resetparams').addEventListener('click', function () { state.params = {}; renderParams(); saveSettings(); toast('Parameters reset to the textbook defaults.', ''); });
    ['cash', 'sizepct', 'commission', 'slippage', 'allowshort'].forEach(function (id) { $(id).addEventListener('change', readAccountInputs); });
    $('run').addEventListener('click', function () { run({ scroll: window.innerWidth < 980 }); });
    $('optbtn').addEventListener('click', function () { $('optcard').hidden = false; renderGridEditor(); $('optcard').scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!lastOpt) runOptimize(); });
    $('optrun').addEventListener('click', runOptimize);
    $('optclose').addEventListener('click', function () { $('optcard').hidden = true; });
    $('cmpbtn').addEventListener('click', function () { $('cmpcard').hidden = false; $('cmpcard').scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!lastCmp) runCompare(); });
    $('cmprun').addEventListener('click', runCompare);
    $('cmpmetric').addEventListener('change', function () { if (lastCmp) runCompare(); });
    $('cmpclose').addEventListener('click', function () { $('cmpcard').hidden = true; });
    $('csvbtn').addEventListener('click', function () {
      if (!result) return;
      copyText(tradesCsv()).then(function () { toast('Trade list copied as CSV. Paste it into Excel, Google Sheets or Numbers.', 'ok'); }, function () { toast('Clipboard blocked here. Allow clipboard access or take a screenshot of the table.', 'warn'); });
    });
    $('trycosts').addEventListener('click', function () {
      $('commission').value = 1; $('slippage').value = 10; readAccountInputs();
      toast('Commission $1 per fill and 10 bps slippage applied. Running…', '', 'Realistic costs');
      run({ scroll: true });
    });
    $('tryopt').addEventListener('click', function () { $('optoos').value = '30'; $('optbtn').click(); });
    window.addEventListener('hashchange', function () {
      var changed = false;
      try { changed = applyHash(); } catch (e) { toast('That link could not be read. Showing the current setup instead.', 'warn'); }
      if (changed) run({ reload: true, scroll: true });
    });
  }

  function init() {
    fillSymbolList();
    writeControls();
    bind();
    renderGridEditor();
    try { applyHash(); } catch (e) { /* a bad deep link must not block the first run */ }
    run({ reload: true });   // always show a result on first visit: an empty lab teaches nothing
  }

  BT.backtestPage = {
    onThemeChange: function () { try { applyThemeToCharts(); } catch (e) { /* charts not built yet */ } },
    run: run,
    optimize: runOptimize,
    compare: runCompare,
    getState: function () { return Object.assign({}, state); },
    getResult: function () { return result; },
    version: '0.2.0'
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
