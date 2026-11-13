/* =====================================================================
 * Broward Trading — js/portfolio.js  (UI module for portfolio.html)
 *
 * Wires the paper account page onto the shared modules:
 *   BT.paper    account engine (positions, orders, equity history, stats)
 *   BT.data     quotes (live provider or demo), rate limits, market status
 *   BT.options  Black-Scholes pricing, synthetic chains, payoff analysis
 *
 * Responsibilities
 *   - Account tiles, equity curve (lightweight-charts area series)
 *   - Positions with live marks (quotes batched + paced to free-tier limits),
 *     working orders checked against each new quote, close / cancel buttons
 *   - Trade history with filters and CSV text export (copy, not download)
 *   - Performance statistics with plain-English tooltips
 *   - Options Lab: synthetic chain, leg builder, presets, payoff canvas,
 *     analysis + greeks, "paper trade this strategy"
 *   - Account settings and a two-step inline reset
 *   - v0.5: what-if analyzer (price / days / IV sliders, multi-date P&L,
 *     probability range, greeks over price, assignment warnings), position
 *     size calculator (BT.risk), simulation settings (BT.paper realism) and
 *     an account switcher (Main / Replay / leagues via BT.paper.accounts())
 *
 * Plain ES2020, no imports. Exposes a tiny BT.portfolioPage for the theme
 * toggle (re-skins the chart and canvas) and for tests / other pages.
 * ===================================================================== */
(function () {
  'use strict';
  window.BT = window.BT || {};
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (window.BT && window.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }
  if (typeof document === 'undefined') return;

  var paper = BT.paper, data = BT.data, opt = BT.options;
  var LW = window.LightweightCharts;

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  /* Active site locale (en-US / es-419) when js/i18n.js is loaded; undefined = browser default. Keeps dates and
   * clocks inside translated sentences consistent with the chosen language rather than the browser's region. */
  function loc() { var i = window.BT && window.BT.i18n; return (i && typeof i.locale === 'function') ? i.locale() : undefined; }
  function fmtDate(t, opts) {
    var i = window.BT && window.BT.i18n;
    if (i && typeof i.fmtDate === 'function') return i.fmtDate(t, opts);
    var d = t instanceof Date ? t : new Date(t);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, opts);
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v, dp) {
    if (!isNum(v)) return '—';
    if (v === Infinity) return 'Unlimited';
    if (v === -Infinity) return 'Unlimited';
    dp = dp == null ? 2 : dp;
    var s = Math.abs(v).toLocaleString(loc(), { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v < 0 ? '−$' : '$') + s;
  }
  function signed(v, dp) {
    if (!isNum(v)) return '—';
    if (v === Infinity) return 'Unlimited';
    if (v === -Infinity) return 'Unlimited';
    dp = dp == null ? 2 : dp;
    var s = Math.abs(v).toLocaleString(loc(), { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v > 0 ? '+$' : v < 0 ? '−$' : '$') + s;
  }
  function pct(v, dp) {
    if (!isNum(v)) return '—';
    dp = dp == null ? 2 : dp;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
  }
  function plain(v, dp) { return isNum(v) ? v.toLocaleString(loc(), { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }) : '—'; }
  function pnlClass(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function fmtTime(t) {
    if (!isNum(t)) return '—';
    var ms = t < 1e11 ? t * 1000 : t; // accept unix seconds or ms
    var d = new Date(ms), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(loc(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function isoDate(t) {
    var ms = t < 1e11 ? t * 1000 : t;
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  function toast(text, tone, title) {
    var host = $('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (tone || '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(title) + '</b>' : '') + esc(text) + '</div><button class="close" type="button" aria-label="Dismiss">✕</button>';
    el.querySelector('.close').onclick = function () { el.remove(); };
    host.appendChild(el);
    setTimeout(function () { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 220); }, 5200);
  }
  function setMsg(id, text, tone) {
    var el = $(id); if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (tone ? ' ' + tone : '');
  }

  /* ------------------------------------------------------------------ *
   * Persisted UI state (per browser)
   * ------------------------------------------------------------------ */
  var UI_KEY = 'bt.portfolio.ui';
  var ui = Object.assign({ tab: 'positions', labSymbol: 'AAPL', ivBase: 0.25, legs: [], expiry: null, showT0: true }, store.get(UI_KEY, {}));
  function saveUi() { store.set(UI_KEY, ui); }

  /* ------------------------------------------------------------------ *
   * Tooltips: tap toggles on touch devices (hover/focus handled in CSS)
   * ------------------------------------------------------------------ */
  function placeTip(el) {
    // Flip the bubble when it would run off either edge of the viewport.
    var r = el.getBoundingClientRect(), half = Math.min(150, window.innerWidth * 0.4);
    var cx = r.left + r.width / 2;
    el.classList.toggle('edge-r', cx + half > window.innerWidth - 8);
    el.classList.toggle('edge-l', cx - half < 8);
    if (!el.title) el.title = el.dataset.tip || ''; // native fallback inside scrolling tables
  }
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('.tip'); if (t) placeTip(t); });
  document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('.tip'); if (t) placeTip(t); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tip');
    document.querySelectorAll('.tip.open').forEach(function (el) { if (el !== t) el.classList.remove('open'); });
    if (t) { placeTip(t); t.classList.toggle('open'); e.preventDefault(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.querySelectorAll('.tip.open').forEach(function (el) { el.classList.remove('open'); }); });

  /* ------------------------------------------------------------------ *
   * Tabs with hash routing: #positions #history #options #sizing #settings
   *   #options/TSLA opens the lab on TSLA.
   * ------------------------------------------------------------------ */
  var TABS = ['positions', 'history', 'options', 'sizing', 'settings'];
  function switchTab(name, fromHash) {
    if (TABS.indexOf(name) === -1) name = 'positions';
    TABS.forEach(function (t) {
      var btn = $('tab-' + t), panel = $('panel-' + t);
      var on = t === name;
      if (btn) btn.setAttribute('aria-selected', on ? 'true' : 'false');
      if (btn) btn.classList.toggle('on', on);
      if (panel) panel.hidden = !on;
    });
    ui.tab = name; saveUi();
    if (!fromHash && location.hash.replace('#', '').split('/')[0] !== name) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
    }
    if (name === 'options') { ensureLab(); drawPayoff(); renderWhatIf(); }
    if (name === 'sizing') renderSizing(false);
  }
  document.querySelectorAll('.tabs [role="tab"]').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });
  function applyHash() {
    var h = location.hash.replace('#', '');
    if (!h) return false;
    var parts = h.split('/');
    if (TABS.indexOf(parts[0]) === -1) return false;
    if (parts[0] === 'options' && parts[1]) { ui.labSymbol = parts[1].toUpperCase(); if ($('opt-sym')) $('opt-sym').value = ui.labSymbol; labLoaded = false; }
    switchTab(parts[0], true);
    return true;
  }
  window.addEventListener('hashchange', applyHash);

  /* ------------------------------------------------------------------ *
   * Marks: batched, rate-limit aware quotes
   * ------------------------------------------------------------------ */
  var marks = {};          // SYMBOL → last price (stocks / underlyings)
  var markMeta = {};       // SYMBOL → {live, fallback, reason, cached, at}
  var lastMarkAt = 0, refreshTimer = null, cursor = 0, refreshing = false;
  var anyFallback = false;

  function underlyingOf(symbol, pos) {
    if (pos && pos.kind === 'option') {
      if (pos.meta && pos.meta.underlying) return String(pos.meta.underlying).toUpperCase();
      var p = paper.parseContract(symbol);
      if (p) return p.underlying;
    }
    return symbol;
  }
  function symbolsNeeded() {
    var set = {};
    var st = paper.state;
    Object.keys(st.positions).forEach(function (s) { set[underlyingOf(s, st.positions[s])] = true; });
    paper.openOrders().forEach(function (o) { set[o.kind === 'option' ? underlyingOf(o.symbol, o) : o.symbol] = true; });
    if (ui.tab === 'options' && ui.labSymbol) set[ui.labSymbol] = true;
    return Object.keys(set).filter(Boolean);
  }
  function budgetFor(n) {
    // How many fresh quotes we may request this cycle without tripping the free tier.
    var s;
    try { s = data.status(); } catch (e) { return n; }
    if (!s.live) return n;
    var r = s.rate || {};
    var leftMin = isFinite(r.minuteLimit) ? r.minuteLimit - r.minuteUsed - 1 : n;  // keep one call spare for the dashboard
    var leftDay = isFinite(r.dayLimit) ? r.dayLimit - r.dayUsed : n;
    return Math.max(0, Math.min(n, leftMin, leftDay));
  }
  function refreshIntervalMs() {
    var live = false, perMin = Infinity;
    try { var s = data.status(); live = s.live; perMin = s.rate && s.rate.minuteLimit; } catch (e) { /* demo */ }
    if (!live) return 4000;                       // demo ticks are free
    return perMin && perMin >= 30 ? 30000 : 60000; // Finnhub 60/min → 30 s, Twelve Data 8/min → 60 s
  }

  async function fetchQuotes(symbols) {
    var budget = budgetFor(symbols.length);
    var picked = [];
    if (budget >= symbols.length) picked = symbols.slice();
    else {
      // Round-robin so every position gets a fresh mark eventually.
      for (var i = 0; i < budget; i++) picked.push(symbols[(cursor + i) % symbols.length]);
      cursor = (cursor + budget) % symbols.length;
    }
    anyFallback = false;
    var results = await Promise.all(picked.map(function (sym) {
      return data.quote(sym).then(function (q) { return { sym: sym, q: q }; }, function (e) { return { sym: sym, err: e }; });
    }));
    results.forEach(function (r) {
      if (r.q && isNum(r.q.price) && r.q.price > 0) {
        marks[r.sym] = r.q.price;
        markMeta[r.sym] = { live: !!r.q.live && !r.q.fallback, fallback: !!r.q.fallback, reason: r.q.reason || '', cached: !!r.q.cached, stale: !!r.q.stale, at: Date.now(), time: r.q.time };
        if (r.q.fallback) anyFallback = true;
      } else if (r.err) {
        markMeta[r.sym] = Object.assign({}, markMeta[r.sym] || {}, { error: (r.err && r.err.message) || String(r.err), at: Date.now() });
      }
    });
    return { requested: picked.length, total: symbols.length, skipped: symbols.length - picked.length };
  }

  /** Model price for one option position from the underlying's mark. */
  function optionMark(symbol, pos, spot) {
    var meta = pos.meta || paper.parseContract(symbol) || {};
    if (!isNum(spot) || !isNum(meta.strike)) return isNum(paper.state.marks[symbol]) ? paper.state.marks[symbol] : pos.avg;
    var days = meta.expiry ? opt.daysToExpiry(meta.expiry) : 30;
    var T = Math.max(0, days) / opt.DAYS_PER_YEAR;
    var type = meta.right === 'P' ? 'put' : 'call';
    if (T <= 0) return type === 'call' ? Math.max(0, spot - meta.strike) : Math.max(0, meta.strike - spot);
    var iv = opt.smileIV(spot, meta.strike, T, ui.ivBase);
    return Math.round(opt.bs({ S: spot, K: meta.strike, T: T, r: 0.05, sigma: iv, type: type }).price * 100) / 100;
  }

  function pricesFromMarks() {
    var prices = {};
    var st = paper.state;
    Object.keys(st.positions).forEach(function (sym) {
      var pos = st.positions[sym];
      if (pos.kind === 'option') {
        var u = underlyingOf(sym, pos);
        prices[sym] = optionMark(sym, pos, marks[u]);
      } else if (isNum(marks[sym])) prices[sym] = marks[sym];
    });
    return prices;
  }

  /** Check working orders against the latest quotes (a quote is a one-price bar). */
  function workOrders() {
    var fills = [];
    var seen = {};
    paper.openOrders().forEach(function (o) {
      if (o.kind === 'option' || seen[o.symbol]) return;
      seen[o.symbol] = true;
      var px = marks[o.symbol], m = markMeta[o.symbol];
      if (!isNum(px) || !m || m.at < lastMarkAt) return; // only fresh marks move orders
      var bar = { time: Math.floor(m.at / 1000), open: px, high: px, low: px, close: px, volume: 0 };
      paper.processOrders(o.symbol, bar).forEach(function (f) { fills.push(f); });
    });
    fills.forEach(function (f) {
      toast(paper.describeOrder(f.order) + ' ' + T('Filled at {price}.', { price: money(f.trade.price) }), 'ok', 'Order filled');
    });
    return fills;
  }

  var mtm = null;   // last markToMarket() result
  async function refreshMarks(manual) {
    if (refreshing) return;
    refreshing = true;
    var btn = $('refresh'); if (btn) btn.disabled = true;
    try {
      var syms = symbolsNeeded();
      var info = { requested: 0, total: 0, skipped: 0 };
      if (syms.length) info = await fetchQuotes(syms);
      workOrders();
      lastMarkAt = Date.now();
      mtm = paper.markToMarket(pricesFromMarks(), lastMarkAt);
      renderAll();
      if (ui.tab === 'options' && ui.labSymbol && isNum(marks[ui.labSymbol]) && labLoaded) updateLabSpot(marks[ui.labSymbol]);
      if (info.skipped > 0) setMsg('msg', T('Quote budget: refreshed {n} of {total} symbols this cycle to stay inside the free-tier limit; the rest rotate in next cycle.', { n: info.requested, total: info.total }), '');
      else if (manual) setMsg('msg', '');
    } catch (e) {
      setMsg('msg', T('Could not refresh marks: {error}', { error: e && e.message ? e.message : e }), 'err');
    } finally {
      refreshing = false;
      if (btn) btn.disabled = false;
      scheduleRefresh();
    }
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { if (!document.hidden) refreshMarks(false); else scheduleRefresh(); }, refreshIntervalMs());
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshMarks(false); });

  /* ------------------------------------------------------------------ *
   * Rendering: header pills, tiles
   * ------------------------------------------------------------------ */
  function renderHeader() {
    var live = false, label = 'demo', mk = null;
    try { var s = data.status(); live = s.live; label = s.label; mk = s.market; } catch (e) { /* demo */ }
    var pill = $('srcpill');
    if (pill) {
      var txt = live ? (anyFallback ? 'live · partial' : 'live') : 'demo';
      pill.textContent = txt;
      pill.className = 'pill hide-sm ' + (live && !anyFallback ? 'live' : 'demo');
      pill.title = live ? 'Quotes from ' + label + (anyFallback ? '. Some symbols fell back to simulated prices (quota or error); hover a mark for details.' : '.') : 'Prices are simulated unless you add a free API key on the dashboard';
    }
    var mp = $('marketpill');
    if (mp && mk) {
      var phase = { pre: T('pre-market'), open: T('market open'), after: T('after hours'), closed: T('market closed') }[mk.phase] || mk.phase;
      mp.textContent = phase + ' · ' + mk.nyTime;   // nyTime already carries the ' ET' suffix
      mp.className = 'pill ' + (mk.open ? 'live' : '');
      mp.title = mk.isTradingDay ? (mk.earlyClose ? 'Early close today at ' + mk.closesAt : 'NYSE regular session 9:30–16:00 ET') : (mk.holiday ? 'Holiday: ' + mk.holiday : 'Weekend. Next open ' + (mk.nextOpenDate || ''));
    }
    var rp = $('refreshpill');
    if (rp) {
      rp.textContent = lastMarkAt ? T('marks {t}', { t: fmtTime(lastMarkAt) }) : T('marks —');
      rp.title = lastMarkAt
        ? T('Positions last marked at {time}. Auto-refresh every {s} s while this tab is visible.', { time: new Date(lastMarkAt).toLocaleTimeString(loc()), s: Math.round(refreshIntervalMs() / 1000) })
        : T('Not yet marked');
    }
  }

  function renderTiles() {
    var st = paper.state;
    var v = mtm || Object.assign({ equity: st.cash + paper.valuation({}).marketValue, cash: st.cash, realized: st.realized, unrealized: paper.valuation({}).unrealized, dayPnL: 0 }, {});
    var equity = v.equity, total = equity - st.startingCash, totalPct = st.startingCash ? total / st.startingCash * 100 : 0;
    $('t-equity').textContent = money(equity);
    $('t-equity-sub').textContent = st.createdAt ? T('Started with {cash} on {date}', { cash: money(st.startingCash, 0), date: fmtDate(st.createdAt) }) : T('Started with {cash}', { cash: money(st.startingCash, 0) });
    $('t-cash').textContent = money(v.cash);
    $('t-cash-sub').textContent = T('Buying power {bp}', { bp: money(isNum(v.buyingPower) ? v.buyingPower : Math.max(0, v.cash)) }) + (v.marginUsed ? ' · ' + T('margin held {amount}', { amount: money(v.marginUsed) }) : '');
    var day = $('t-day'); day.textContent = signed(v.dayPnL); day.className = 'value num ' + pnlClass(v.dayPnL);
    var dayPct = st.dayStart && st.dayStart.equity ? v.dayPnL / st.dayStart.equity * 100 : 0;
    $('t-day-sub').textContent = T('{pct} since the start of today', { pct: isNum(dayPct) ? pct(dayPct) : '—' });
    var tot = $('t-total'); tot.textContent = signed(total); tot.className = 'value num ' + pnlClass(total);
    $('t-total-sub').textContent = T('{pct} · realized {realized} · unrealized {unrealized}', { pct: pct(totalPct), realized: signed(v.realized), unrealized: signed(v.unrealized) });
  }

  /* ------------------------------------------------------------------ *
   * Equity curve (lightweight-charts area series)
   * ------------------------------------------------------------------ */
  var eqChart = null, eqSeries = null, eqBaseLine = null;
  function chartTheme() {
    return {
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--muted'), fontFamily: css('--mono') },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line'), scaleMargins: { top: 0.18, bottom: 0.1 } },
      timeScale: { borderColor: css('--line'), timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScroll: true, handleScale: true
    };
  }
  function hexAlpha(hex, a) {
    // '#rrggbb' → 'rgba(r,g,b,a)'; passes through anything else untouched
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function initEquityChart() {
    var el = $('equity');
    if (!el || !LW) { if (el && !LW) { var ov = $('eq-overlay'); if (ov) ov.textContent = 'Chart library could not load (offline?). Your account data is still intact below.'; } return; }
    eqChart = LW.createChart(el, Object.assign({ autoSize: true }, chartTheme()));
    eqSeries = eqChart.addAreaSeries({
      lineColor: css('--accent'), topColor: hexAlpha(css('--accent'), 0.35), bottomColor: hexAlpha(css('--accent'), 0.02),
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: 'custom', minMove: 1, formatter: function (p) { return '$' + Math.round(p).toLocaleString(loc()); } }
    });
    eqChart.subscribeCrosshairMove(function (p) {
      var d = p.seriesData && p.seriesData.get(eqSeries);
      if (d && isNum(d.value)) {
        $('eq-tag').textContent = money(d.value, 0);
        var diff = d.value - paper.state.startingCash;
        $('eq-tag2').textContent = signed(diff, 0) + ' (' + pct(paper.state.startingCash ? diff / paper.state.startingCash * 100 : 0) + ') at ' + fmtTime(typeof p.time === 'number' ? p.time * 1000 : Date.now());
      } else renderEquityTag();
    });
  }
  function restyleEquityChart() {
    if (!eqChart) return;
    eqChart.applyOptions(chartTheme());
    eqSeries.applyOptions({ lineColor: css('--accent'), topColor: hexAlpha(css('--accent'), 0.35), bottomColor: hexAlpha(css('--accent'), 0.02) });
    renderEquity();
  }
  function renderEquityTag() {
    var st = paper.state;
    var eq = mtm ? mtm.equity : (st.equityHistory.length ? st.equityHistory[st.equityHistory.length - 1].equity : st.cash);
    $('eq-tag').textContent = money(eq, 0);
    var diff = eq - st.startingCash;
    $('eq-tag2').textContent = T('{diff} ({pct}) since start', { diff: signed(diff, 0), pct: pct(st.startingCash ? diff / st.startingCash * 100 : 0) });
  }
  function renderEquity() {
    var st = paper.state;
    var pts = [], lastT = -Infinity;
    // The chart needs strictly ascending times; sort defensively (clock changes, imported history).
    st.equityHistory.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (h) {
      var t = Math.floor(h.t / 1000);
      if (t <= lastT) { if (pts.length) pts[pts.length - 1].value = h.equity; return; } // same second → keep latest
      pts.push({ time: t, value: h.equity }); lastT = t;
    });
    var ov = $('eq-overlay');
    if (ov) ov.hidden = pts.length >= 2;
    $('eq-points').textContent = pts.length ? T(pts.length === 1 ? '{n} point' : '{n} points', { n: pts.length }) : '';
    renderEquityTag();
    if (!eqSeries) return;
    eqSeries.setData(pts);
    if (BT.a11y) {
      var eqEl = $('equity');
      var lastEq = pts.length ? pts[pts.length - 1].value : st.cash;
      var ret = st.startingCash ? (lastEq - st.startingCash) / st.startingCash * 100 : 0;
      BT.a11y.describeChart(eqEl, T('Equity curve: {n} points, started at {start}, now {now} ({ret})', { n: pts.length, start: money(st.startingCash), now: money(lastEq), ret: pct(ret) }));
    }
    if (eqBaseLine) { try { eqSeries.removePriceLine(eqBaseLine); } catch (e) { /* ignore */ } eqBaseLine = null; }
    if (pts.length) {
      eqBaseLine = eqSeries.createPriceLine({ price: st.startingCash, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'start' });
      eqChart.timeScale().fitContent();
    }
  }

  /* ------------------------------------------------------------------ *
   * Positions and working orders
   * ------------------------------------------------------------------ */
  function describePosition(sym, row) {
    if (row.kind !== 'option') {
      var u = data && data.lookup ? data.lookup(sym) : null;
      return u && u.name ? u.name : '';
    }
    var meta = row.meta || paper.parseContract(sym) || {};
    var dte = meta.expiry ? Math.ceil(opt.daysToExpiry(meta.expiry)) : null;
    return (meta.underlying || '') + ' ' + (isNum(meta.strike) ? '$' + meta.strike : '') + ' ' + (meta.right === 'P' ? 'put' : 'call') + (meta.expiry ? ' · exp ' + meta.expiry + (dte != null ? ' (' + (dte <= 0 ? 'expired' : dte + 'd') + ')' : '') : '') + ' · ×100';
  }
  function markTitle(sym, row) {
    var u = underlyingOf(sym, row), m = markMeta[u];
    if (row.kind === 'option') return 'Black-Scholes value from ' + u + ' at ' + money(marks[u]) + ' with ' + Math.round(ui.ivBase * 100) + '% base IV (set in the Options Lab).' + (m && m.fallback ? ' Underlying quote is simulated: ' + m.reason : '');
    if (!m) return 'Last known price (not refreshed yet this session).';
    if (m.fallback) return 'Simulated price. ' + (m.reason || '');
    return (m.live ? 'Live quote' : 'Quote') + (m.cached ? ' (cached ' + Math.round((Date.now() - m.at + (m.stale ? 0 : 0)) / 1000) + ' s ago)' : '') + ' at ' + fmtTime(m.at) + '.';
  }
  function renderPositions() {
    var rows = (mtm && mtm.positions) || paper.valuation({}).rows;
    rows = rows.slice().sort(function (a, b) { return Math.abs(b.marketValue) - Math.abs(a.marketValue); });
    var tb = $('positions'); tb.innerHTML = '';
    $('pos-empty').hidden = rows.length > 0;
    $('pos-count').textContent = rows.length ? T(rows.length === 1 ? '{n} position · market value {mv}' : '{n} positions · market value {mv}', { n: rows.length, mv: money(rows.reduce(function (s, r) { return s + r.marketValue; }, 0)) }) : '';
    rows.forEach(function (r) {
      var u = underlyingOf(r.symbol, r), m = markMeta[u];
      var srcPill = m && m.fallback ? ' <span class="pill demo" style="font-size:9px;padding:0 5px">demo</span>' : (r.kind === 'option' ? ' <span class="pill" style="font-size:9px;padding:0 5px" title="Model price">model</span>' : '');
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="sym">' + esc(r.symbol) + '<span class="desc">' + esc(describePosition(r.symbol, r)) + '</span></td>' +
        '<td class="side-' + r.side + '">' + (r.side === 'long' ? 'Long' : 'Short') + (r.kind === 'option' ? (r.side === 'long' ? ' (bought)' : ' (written)') : '') + '</td>' +
        '<td class="num right">' + Math.abs(r.qty).toLocaleString(loc()) + (r.kind === 'option' ? ' ct' : '') + '</td>' +
        '<td class="num right">' + money(r.avg) + '</td>' +
        '<td class="num right" title="' + esc(markTitle(r.symbol, r)) + '">' + money(r.price) + srcPill + '</td>' +
        '<td class="num right">' + money(r.marketValue) + '</td>' +
        '<td class="num right pnl ' + pnlClass(r.unrealized) + '">' + signed(r.unrealized) + '<span class="desc">' + pct(r.unrealizedPct) + '</span></td>' +
        '<td class="right"><button class="sm" type="button" data-close="' + esc(r.symbol) + '" title="' + (r.side === 'long' ? 'Sell' : 'Buy back') + ' the whole position at the current mark">Close</button></td>';
      tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-close]').forEach(function (b) {
      b.onclick = function () {
        var sym = b.dataset.close;
        if (b.dataset.arm) {
          var row = rows.filter(function (r) { return r.symbol === sym; })[0];
          var o = paper.closePosition(sym, row ? row.price : undefined);
          if (o.status === 'filled') { toast(o.reason || T('Closed {symbol} at {price}.', { symbol: sym, price: money(o.fillPrice) }), 'ok', 'Position closed'); }
          else toast(o.reason || 'Could not close.', 'err', 'Not closed');
          mtm = paper.markToMarket(pricesFromMarks()); renderAll();
        } else {
          b.dataset.arm = '1'; b.textContent = 'Confirm'; b.classList.add('sell');
          setTimeout(function () { if (b.isConnected) { delete b.dataset.arm; b.textContent = 'Close'; b.classList.remove('sell'); } }, 4000);
        }
      };
    });
  }

  function renderOrders() {
    var orders = paper.openOrders().slice().sort(function (a, b) { return b.placedAt - a.placedAt; });
    var tb = $('orders'); tb.innerHTML = '';
    $('ord-empty').hidden = orders.length > 0;
    $('ord-count').textContent = orders.length ? T('{n} working', { n: orders.length }) : '';
    orders.forEach(function (o) {
      var tr = document.createElement('tr');
      var typeLabel = o.type.replace('_', '-');
      var trig = o.type === 'stop_limit' && o.triggered ? ' <span class="pill accent" style="font-size:9px;padding:0 5px" title="The stop has triggered; this now works as a limit order">triggered</span>' : '';
      var mark = marks[o.symbol];
      var dist = '';
      if (isNum(mark)) {
        var ref = o.type === 'limit' ? o.limitPrice : o.stopPrice;
        if (isNum(ref)) dist = '<span class="desc">' + pct((ref - mark) / mark * 100) + ' from mark ' + money(mark) + '</span>';
      }
      tr.innerHTML =
        '<td class="num">' + o.id + '</td>' +
        '<td class="sym num" style="font-weight:500">' + esc(o.symbol) + dist + '</td>' +
        '<td class="' + (o.side === 'buy' ? 'up' : 'down') + '">' + (o.side === 'buy' ? 'Buy' : 'Sell') + '</td>' +
        '<td class="num right">' + o.qty + '</td>' +
        '<td title="' + esc(paper.glossary[o.type] || '') + '">' + typeLabel + trig + '</td>' +
        '<td class="num right">' + (isNum(o.limitPrice) ? money(o.limitPrice) : '—') + '</td>' +
        '<td class="num right">' + (isNum(o.stopPrice) ? money(o.stopPrice) : '—') + '</td>' +
        '<td class="upper xs">' + esc(o.tif) + '</td>' +
        '<td class="muted xs">' + fmtTime(o.placedAt) + '</td>' +
        '<td class="right"><button class="sm" type="button" data-cancel="' + o.id + '">Cancel</button></td>';
      tr.title = paper.describeOrder(o) + (o.reason ? ' ' + o.reason : '');
      tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-cancel]').forEach(function (b) {
      b.onclick = function () {
        var o = paper.cancelOrder(Number(b.dataset.cancel));
        if (o) toast(paper.describeOrder(o) + ' ' + T('Cancelled.'), '', 'Order cancelled');
        renderOrders();
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Trade history, filters, CSV
   * ------------------------------------------------------------------ */
  function filteredTrades() {
    var sym = ($('f-sym').value || '').trim().toUpperCase();
    var side = $('f-side').value, kind = $('f-kind').value, res = $('f-result').value, range = $('f-range').value;
    var since = 0;
    if (range === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); since = d.getTime(); }
    else if (range) since = Date.now() - Number(range) * 86400000;
    return paper.state.trades.filter(function (t) {
      if (sym && String(t.symbol).indexOf(sym) === -1) return false;
      if (side && t.side !== side) return false;
      if (kind && (t.kind || 'stock') !== kind) return false;
      if (res === 'closing' && !(t.closedQty > 0)) return false;
      if (res === 'win' && !(t.closedQty > 0 && t.realized > 0)) return false;
      if (res === 'loss' && !(t.closedQty > 0 && t.realized < 0)) return false;
      if (since && t.time < since) return false;
      return true;
    }).sort(function (a, b) { return b.time - a.time; });
  }
  function renderHistory() {
    var trades = filteredTrades();
    var tb = $('history'); tb.innerHTML = '';
    $('hist-empty').hidden = trades.length > 0;
    var realized = trades.reduce(function (s, t) { return s + (t.realized || 0); }, 0);
    $('hist-count').textContent = trades.length ? T(trades.length === 1 ? '{n} fill · realized {realized}' : '{n} fills · realized {realized}', { n: trades.length, realized: signed(realized) }) : '';
    trades.slice(0, 500).forEach(function (t) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="muted xs nowrap">' + fmtTime(t.time) + '</td>' +
        '<td class="num" style="font-weight:500">' + esc(t.symbol) + (t.kind === 'option' ? '<span class="desc">' + esc(opt.describeContract ? opt.describeContract(t.symbol) : '') + '</span>' : '') + '</td>' +
        '<td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? 'Buy' : 'Sell') + '</td>' +
        '<td class="num right">' + t.qty + '</td>' +
        '<td class="num right">' + money(t.price) + '</td>' +
        '<td class="num right">' + money(t.value) + '</td>' +
        '<td class="num right muted">' + (t.commission ? money(t.commission) : '—') + '</td>' +
        '<td class="num right pnl ' + (t.closedQty > 0 ? pnlClass(t.realized) : '') + '">' + (t.closedQty > 0 ? signed(t.realized) : '—') + '</td>' +
        '<td class="muted xs" style="text-align:left;white-space:normal;max-width:320px">' + esc(t.note || '') + '</td>';
      tb.appendChild(tr);
    });
    if ($('csvwrap') && !$('csvwrap').hidden) buildCsv();
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv() {
    var trades = filteredTrades().slice().reverse(); // oldest first for spreadsheets
    var head = ['time', 'symbol', 'kind', 'side', 'qty', 'price', 'multiplier', 'value', 'commission', 'closed_qty', 'opened_qty', 'realized_pnl', 'order_id', 'note'];
    var lines = [head.join(',')];
    trades.forEach(function (t) {
      lines.push([isoDate(t.time), t.symbol, t.kind || 'stock', t.side, t.qty, t.price, t.multiplier || 1, t.value, t.commission || 0, t.closedQty || 0, t.openedQty || 0, t.closedQty > 0 ? t.realized : '', t.orderId == null ? '' : t.orderId, t.note || ''].map(csvCell).join(','));
    });
    $('csvbox').value = lines.join('\n');
    $('csvnote').textContent = T(trades.length === 1 ? '{n} row of the filtered fills as CSV. Downloads are blocked in some viewers, so copy the text and paste it into a spreadsheet.' : '{n} rows of the filtered fills as CSV. Downloads are blocked in some viewers, so copy the text and paste it into a spreadsheet.', { n: trades.length });
  }
  ['f-sym', 'f-side', 'f-kind', 'f-result', 'f-range'].forEach(function (id) { $(id).addEventListener('input', renderHistory); });
  $('csv').onclick = function () {
    var w = $('csvwrap');
    w.hidden = !w.hidden;
    $('csv').textContent = w.hidden ? 'Export CSV' : 'Hide CSV';
    if (!w.hidden) { buildCsv(); $('csvbox').focus(); $('csvbox').select(); }
  };
  $('csvbox').addEventListener('focus', function () { this.select(); });
  $('csvcopy').onclick = function () {
    var box = $('csvbox'), txt = box.value;
    var done = function () { toast('CSV copied. Paste it into Excel, Google Sheets or Numbers.', 'ok'); };
    var fail = function () { box.focus(); box.select(); toast('Clipboard blocked here: the text is selected, press Ctrl/Cmd+C to copy.', 'warn'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fail);
    else { try { box.focus(); box.select(); document.execCommand('copy') ? done() : fail(); } catch (e) { fail(); } }
  };

  /* ------------------------------------------------------------------ *
   * Performance statistics
   * ------------------------------------------------------------------ */
  var STAT_TIPS = {
    totalReturnPct: 'Total return = (equity − starting cash) ÷ starting cash. The headline number, but it says nothing about how bumpy the ride was.',
    trades: 'Closing fills: trades that locked in a profit or loss. Opening a position is not a trade result yet.',
    winRate: 'Share of closing fills that made money. A high win rate is not enough on its own; many traders win 70 % of the time and still lose because the losers are bigger.',
    avgWin: 'Average profit on winning closes, net of commissions.',
    avgLoss: 'Average loss on losing closes. Compare it with the average win: you want winners larger than losers, or a very high win rate.',
    profitFactor: 'Profit factor = gross profits ÷ gross losses. Above 1 means you made money overall; a 40 % win rate can still have a profit factor of 2 if winners are much bigger than losers.',
    expectancy: 'Expectancy = average P&L per closing fill. The amount you can expect to make (or lose) on a typical trade if your results continue.',
    maxDrawdownPct: 'Max drawdown is the largest peak-to-trough fall of your equity. Two accounts can end at the same value; the one with the smaller drawdown took far less pain (and risk of ruin) getting there.',
    sharpe: 'Sharpe ratio = average return ÷ volatility of returns, annualised assuming each equity point is one trading day. Above 1 is good, above 2 excellent. It rewards steady gains over wild swings. Needs several equity points before it means anything.',
    bestTrade: 'Largest single realized gain.',
    worstTrade: 'Largest single realized loss. If this is many times your average win, one bad habit is doing the damage.',
    commissionsPaid: 'Total fees deducted. Set a commission under Settings to see how costs compound with frequent trading.'
  };
  function statRow(label, key, value, cls) {
    var tip = STAT_TIPS[key] || (paper.glossary && paper.glossary[key]) || '';
    return '<span class="k">' + esc(label) + (tip ? '<button class="tip" type="button" aria-label="Explain ' + esc(label) + '" data-tip="' + esc(tip) + '"></button>' : '') + '</span><span class="v ' + (cls || '') + '">' + value + '</span>';
  }
  function renderStats() {
    var s = paper.stats();
    var html = '';
    html += statRow('Total return', 'totalReturnPct', pct(s.totalReturnPct), pnlClass(s.totalReturnPct));
    html += statRow('Closing trades', 'trades', String(s.trades) + (s.fills ? ' <span class="muted">/ ' + s.fills + ' fills</span>' : ''));
    html += statRow('Win rate', 'winRate', s.winRate == null ? '—' : s.winRate.toFixed(0) + '% <span class="muted">(' + s.wins + 'W ' + s.losses + 'L)</span>');
    html += statRow('Average win', 'avgWin', s.avgWin == null ? '—' : signed(s.avgWin), 'up');
    html += statRow('Average loss', 'avgLoss', s.avgLoss == null ? '—' : signed(s.avgLoss), 'down');
    html += statRow('Profit factor', 'profitFactor', s.profitFactor == null ? (s.wins > 0 && s.losses === 0 ? '∞ <span class="muted">(no losers yet)</span>' : '—') : s.profitFactor.toFixed(2), s.profitFactor == null ? '' : (s.profitFactor >= 1 ? 'up' : 'down'));
    html += statRow('Expectancy / trade', 'expectancy', s.expectancy == null ? '—' : signed(s.expectancy), pnlClass(s.expectancy));
    html += statRow('Max drawdown', 'maxDrawdownPct', (s.maxDrawdownPct ? '−' : '') + s.maxDrawdownPct.toFixed(2) + '%' + (s.maxDrawdown ? ' <span class="muted">(' + money(s.maxDrawdown, 0) + ')</span>' : ''), s.maxDrawdownPct > 0 ? 'down' : '');
    html += statRow('Sharpe ratio', 'sharpe', s.sharpe == null ? '— <span class="muted">(needs more points)</span>' : s.sharpe.toFixed(2), s.sharpe == null ? '' : (s.sharpe >= 1 ? 'up' : s.sharpe < 0 ? 'down' : ''));
    html += statRow('Best trade', 'bestTrade', s.bestTrade == null ? '—' : signed(s.bestTrade), pnlClass(s.bestTrade));
    html += statRow('Worst trade', 'worstTrade', s.worstTrade == null ? '—' : signed(s.worstTrade), pnlClass(s.worstTrade));
    html += statRow('Commissions paid', 'commissionsPaid', money(s.commissionsPaid));
    $('stats').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Settings, data source, reset
   * ------------------------------------------------------------------ */
  function renderSettings() {
    var c = $('commission');
    if (c && document.activeElement !== c) c.value = paper.settings.commission;
    var html = '';
    try {
      var s = data.status(), r = s.rate || {};
      html += '<span class="k">Provider</span><span class="v">' + esc(s.label) + (s.live ? ' <span class="pill live" style="font-size:9px;padding:0 5px">live</span>' : ' <span class="pill demo" style="font-size:9px;padding:0 5px">demo</span>') + '</span>';
      if (s.provider !== 'demo') {
        html += '<span class="k">API key</span><span class="v">' + (s.hasKey ? 'saved' : 'missing') + '</span>';
        html += '<span class="k">This minute</span><span class="v">' + r.minuteUsed + ' / ' + (isFinite(r.minuteLimit) ? r.minuteLimit : '∞') + '</span>';
        html += '<span class="k">Today</span><span class="v">' + r.dayUsed + ' / ' + (isFinite(r.dayLimit) ? r.dayLimit : '∞') + '</span>';
      }
      html += '<span class="k">Mark refresh</span><span class="v">every ' + Math.round(refreshIntervalMs() / 1000) + ' s</span>';
      html += '<span class="k">Symbols marked</span><span class="v">' + symbolsNeeded().length + '</span>';
    } catch (e) { html = '<span class="k">Provider</span><span class="v">demo</span>'; }
    $('datasrc').innerHTML = html;
  }
  $('save-settings').onclick = function () {
    var v = Number($('commission').value);
    if (!isNum(v) || v < 0) { setMsg('settings-msg', 'Commission must be zero or a positive number.', 'err'); return; }
    paper.setSettings({ commission: v });
    setMsg('settings-msg', T('Saved. New fills will be charged {fee} each.', { fee: money(v) }), 'ok');
  };
  var resetTimer = null;
  function hideReset() { $('reset-confirm').hidden = true; $('reset').textContent = 'Reset paper account…'; clearTimeout(resetTimer); }
  $('reset').onclick = function () {
    var box = $('reset-confirm');
    if (box.hidden) {
      box.hidden = false; $('reset').textContent = 'Cancel';
      $('reset-cash').value = paper.state.startingCash || paper.DEFAULT_CASH;
      $('reset-yes').focus();
      clearTimeout(resetTimer); resetTimer = setTimeout(hideReset, 15000); // arm for 15 s
    } else hideReset();
  };
  $('reset-no').onclick = hideReset;
  $('reset-yes').onclick = function () {
    var cash = Number($('reset-cash').value);
    if (!isNum(cash) || cash < 1000) { setMsg('reset-msg', 'Starting cash must be at least $1,000.', 'err'); return; }
    paper.reset(cash);
    marks = {}; markMeta = {}; mtm = null; lastMarkAt = 0;
    hideReset();
    setMsg('reset-msg', T('Account reset. You are starting over with {cash}.', { cash: money(cash, 0) }), 'ok');
    toast(T('Fresh start with {cash}. Your course progress and API keys were kept.', { cash: money(cash, 0) }), 'ok', 'Account reset');
    renderAll();
    refreshMarks(true);
  };

  /* ------------------------------------------------------------------ *
   * Account switcher: Main / Replay / one account per joined league
   * ------------------------------------------------------------------ */
  function activeAccount() { try { return paper.account ? paper.account() : 'main'; } catch (e) { return 'main'; } }
  function leagueOf(id) {
    var L = BT.leagues;
    try { return L && typeof L.leagueForAccount === 'function' ? L.leagueForAccount(id) : null; } catch (e) { return null; }
  }
  function accountLabel(id) {
    if (id === 'main') return T('Main');
    if (id === 'replay') return T('Replay');
    var lg = leagueOf(id);
    if (lg && lg.name) return T('League: {name}', { name: lg.name });
    var m = /^league[-:]([a-z0-9]+)$/i.exec(id);
    if (m) return T('League {code}', { code: m[1].toUpperCase() });
    return id;
  }
  function accountList() {
    var list = [];
    try { list = typeof paper.accounts === 'function' ? paper.accounts() : []; } catch (e) { list = []; }
    var ids = list.map(function (a) { return a.id; });
    var add = function (id) { if (ids.indexOf(id) === -1) { ids.push(id); list.push({ id: id, equity: null, active: id === activeAccount() }); } };
    add('main'); add('replay');
    try {
      if (BT.leagues && typeof BT.leagues.joined === 'function') {
        BT.leagues.joined().forEach(function (lg) {
          var id = paper.storageKeyFor ? String(paper.storageKeyFor(BT.leagues.accountId(lg.code))).replace(/^bt\.portfolio\.?/, '') : 'league-' + String(lg.code).toLowerCase();
          add(id || 'main');
        });
      }
    } catch (e) { /* leagues optional */ }
    var order = function (id) { return id === 'main' ? 0 : id === 'replay' ? 1 : 2; };
    return list.sort(function (a, b) { return order(a.id) - order(b.id) || String(a.id).localeCompare(String(b.id)); });
  }
  function renderAccounts() {
    var sel = $('acct'); if (!sel) return;
    var cur = activeAccount();
    sel.innerHTML = accountList().map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (a.id === cur ? ' selected' : '') + '>' + esc(accountLabel(a.id)) + (isNum(a.equity) ? ' · ' + esc(money(a.equity, 0)) : '') + '</option>';
    }).join('');
    sel.value = cur;
    var sa = $('sim-acct'); if (sa) sa.textContent = accountLabel(cur);
  }
  function switchAccount(id) {
    if (!id || typeof paper.use !== 'function' || id === activeAccount()) return;
    paper.use(id);
    ui.account = activeAccount(); saveUi();
    mtm = null; lastMarkAt = 0;
    renderAccounts();
    renderAll();
    renderSizing(true);
    var lg = leagueOf(id);
    toast(lg ? T('League rules apply to orders placed from this page.') : T('Positions, orders and history below now show this account.'), 'ok', T('Switched to {name}', { name: accountLabel(activeAccount()) }));
    refreshMarks(false);
  }
  if ($('acct')) $('acct').addEventListener('change', function () { switchAccount($('acct').value); });
  // Restore the account last viewed on this page, but never create one that does not exist.
  (function restoreAccount() {
    if (!ui.account || ui.account === activeAccount() || typeof paper.use !== 'function') return;
    var exists = accountList().some(function (a) { return a.id === ui.account && (a.id === 'main' || isNum(a.equity)); });
    if (exists) paper.use(ui.account); else { ui.account = activeAccount(); saveUi(); }
  })();
  // Another tab traded on the active account: repaint from the reloaded state.
  window.addEventListener('bt:paper-sync', function () { mtm = null; renderAll(); });

  /** League check for orders placed from this page (Options Lab), as the dashboard ticket does. */
  function leagueCheck(order) {
    var lg = leagueOf(activeAccount());
    if (!lg || !BT.leagues || typeof BT.leagues.validateOrder !== 'function') return { ok: true, reason: '' };
    try { return BT.leagues.validateOrder(order, lg, paper.getState()); } catch (e) { return { ok: true, reason: '' }; }
  }

  /* ------------------------------------------------------------------ *
   * Simulation settings (BT.paper realism, v0.5)
   *   Field names follow CONTRACTS.md v0.5; cash interest and borrow fee
   *   are annual percentages. Older engines that ignore a field are
   *   detected on save and the user is told plainly.
   * ------------------------------------------------------------------ */
  var SIM_DEFAULTS = (function () {
    var d = { fillModel: 'instant', slippageBps: 0, commissionPreset: 'per-trade', dividends: false, cashInterestPct: 0, pdtRule: false, borrowFeePct: 0 };
    try { if (typeof paper.defaultSettings === 'function') { var e = paper.defaultSettings(); Object.keys(d).forEach(function (k) { if (e[k] !== undefined) d[k] = e[k]; }); } } catch (err) { /* older engine */ }
    return d;
  })();
  var SIM_ALIASES = { cashInterestPct: ['cashInterestPct', 'cashInterest', 'interestPct'], borrowFeePct: ['borrowFeePct', 'borrowFee', 'shortBorrowFeePct'], dividends: ['dividends', 'payDividends'] };
  var SIM_FIELDS = {
    fillModel: { id: 'sim-fill', kind: 'select', label: 'Fill model' },
    slippageBps: { id: 'sim-slip', kind: 'number', min: 0, max: 500, label: 'Slippage' },
    commissionPreset: { id: 'sim-comm', kind: 'select', label: 'Commission preset' },
    dividends: { id: 'sim-div', kind: 'check', label: 'Dividends' },
    cashInterestPct: { id: 'sim-int', kind: 'number', min: 0, max: 25, label: 'Interest on cash' },
    pdtRule: { id: 'sim-pdt', kind: 'check', label: 'Pattern day trader rule' },
    borrowFeePct: { id: 'sim-borrow', kind: 'number', min: 0, max: 200, label: 'Short borrow fee' }
  };
  function simRead() {
    var s = paper.settings || {}, out = {};
    Object.keys(SIM_DEFAULTS).forEach(function (k) {
      var v;
      (SIM_ALIASES[k] || [k]).some(function (n) { if (s[n] !== undefined) { v = s[n]; return true; } return false; });
      out[k] = v === undefined ? SIM_DEFAULTS[k] : v;
    });
    return out;
  }
  function renderSim() {
    if (!$('sim')) return;
    var v = simRead();
    Object.keys(SIM_FIELDS).forEach(function (k) {
      var f = SIM_FIELDS[k], el = $(f.id); if (!el || document.activeElement === el) return;
      if (f.kind === 'check') el.checked = !!v[k];
      else el.value = String(v[k]);
    });
    renderSimInfo();
  }
  /** Live notes under the settings: the chosen commission preset, the day-trade count and income so far. */
  function renderSimInfo() {
    var presets = paper.commissionPresets || {}, sel = $('sim-comm'), ci = $('sim-comm-info');
    if (ci && sel) {
      var p = presets[sel.value];
      var fee = Number((paper.settings || {}).commission) || 0;
      ci.textContent = sel.value === 'per-trade'
        ? T('Currently {fee} per order (change it under Account settings). Choosing this preset again loads a typical $4.95.', { fee: money(fee) })
        : (p && p.description ? T(p.description) : '');
    }
    var pi = $('sim-pdt-info');
    if (pi) {
      var st = null; try { st = typeof paper.pdtStatus === 'function' ? paper.pdtStatus() : null; } catch (e) { st = null; }
      pi.textContent = st ? T('Day trades in the last {d} business days: {n}. Equity {eq} ({status}).', {
        d: st.windowDays || 5, n: st.dayTrades,
        eq: money(st.equity, 0),
        status: st.equity >= st.minEquity ? T('above $25,000, so the rule would not limit you') : (st.enabled ? T('{r} day trade(s) left this window', { r: st.remaining }) : T('under $25,000; the limit applies only when enforced'))
      }) : '';
    }
    var ii = $('sim-income');
    if (ii) {
      var inc = paper.state && paper.state.income;
      ii.textContent = inc ? T('So far in this account: dividends {d}, cash interest {i}, borrow fees {b}.', { d: signed(inc.dividends || 0), i: signed(inc.interest || 0), b: signed(-(inc.borrowFees || 0)) }) : '';
    }
  }
  function simCollect() {
    var patch = {}, errors = [];
    Object.keys(SIM_FIELDS).forEach(function (k) {
      var f = SIM_FIELDS[k], el = $(f.id); if (!el) return;
      if (f.kind === 'check') patch[k] = !!el.checked;
      else if (f.kind === 'select') patch[k] = el.value;
      else {
        var n = Number(el.value);
        if (el.value === '' || !isNum(n) || n < f.min || n > f.max) errors.push(T('{label} must be between {min} and {max}.', { label: T(f.label), min: f.min, max: f.max }));
        else patch[k] = n;
      }
    });
    return { patch: patch, errors: errors };
  }
  function simSave(patch, doneMsg) {
    if (typeof paper.setSettings !== 'function') { setMsg('sim-msg', T('This version of the paper engine cannot change settings.'), 'err'); return; }
    var prevPreset = (paper.settings || {}).commissionPreset;
    if (patch.commissionPreset && patch.commissionPreset !== prevPreset && typeof paper.applyCommissionPreset === 'function' && !patch._keepFee) {
      // A newly chosen preset loads its typical numbers (e.g. $4.95 per trade), as a broker's price list would.
      paper.applyCommissionPreset(patch.commissionPreset);
    }
    delete patch._keepFee;
    paper.setSettings(patch);
    renderSettings();
    var after = simRead(), ignored = [];
    // A field the engine does not know (or clamps) reads back differently from what we asked for.
    Object.keys(patch).forEach(function (k) { if (SIM_FIELDS[k] && after[k] !== patch[k]) ignored.push(T(SIM_FIELDS[k].label)); });
    renderSim();
    if (ignored.length) setMsg('sim-msg', T('Saved what this version supports. Not active yet: {list}. They will take effect once the paper engine is updated.', { list: ignored.join(', ') }), 'warn');
    else setMsg('sim-msg', doneMsg, 'ok');
  }
  if ($('sim-save')) $('sim-save').onclick = function () {
    var c = simCollect();
    if (c.errors.length) { setMsg('sim-msg', c.errors.join(' '), 'err'); return; }
    simSave(c.patch, T('Saved for {name}. New fills use these settings.', { name: accountLabel(activeAccount()) }));
  };
  if ($('sim-comm')) $('sim-comm').addEventListener('change', renderSimInfo);
  if ($('sim-defaults')) $('sim-defaults').onclick = function () {
    simSave(Object.assign({ commission: 0, _keepFee: true }, SIM_DEFAULTS), T('Defaults restored: instant fills, no slippage, $0 commission, and no dividends, interest, day-trade limit or borrow fee.'));
  };

  /* ------------------------------------------------------------------ *
   * Position size calculator (BT.risk, js/risk.js)
   * ------------------------------------------------------------------ */
  var SIZING_IDS = ['ps-equity', 'ps-risk', 'ps-side', 'ps-entry', 'ps-stop', 'ps-target', 'ps-win'];
  function currentEquity() {
    var st = paper.state;
    if (mtm && isNum(mtm.equity)) return mtm.equity;
    try { return st.cash + paper.valuation({}).marketValue; } catch (e) { return st.cash; }
  }
  function asFraction(v) { return isNum(v) ? (v > 1 ? v / 100 : v) : null; }
  function riskSize(args) {
    var R = BT.risk;
    var res = R.positionSize(args);
    // Accept either riskPct convention (1 = 1 %, or 0.01): a result risking far more than planned means the
    // module read our percent as a fraction, so ask again in its units.
    if (res && isNum(res.dollarRisk) && res.dollarRisk > args.equity * args.riskPct / 100 * 1.5 + 0.01) {
      res = R.positionSize(Object.assign({}, args, { riskPct: args.riskPct / 100 }));
    }
    return res;
  }
  function renderSizing(prefill) {
    var out = $('ps-out'); if (!out) return;
    var eqEl = $('ps-equity');
    if (prefill || eqEl.value === '') eqEl.value = Math.round(currentEquity());
    var num = function (id) { var el = $(id); return el && el.value !== '' ? Number(el.value) : NaN; };
    var equity = num('ps-equity'), riskPct = num('ps-risk'), entry = num('ps-entry'), stop = num('ps-stop'), target = num('ps-target'), win = num('ps-win');
    var side = $('ps-side').value === 'short' ? 'short' : 'long';
    ui.sizing = { risk: $('ps-risk').value, side: side, entry: $('ps-entry').value, stop: $('ps-stop').value, target: $('ps-target').value, win: $('ps-win').value };
    saveUi();
    setMsg('ps-msg', '');
    if (!BT.risk || typeof BT.risk.positionSize !== 'function') {
      out.innerHTML = '<div class="callout warn compact"><div>' + esc(T('The risk calculator did not load (offline or blocked script). Reload the page to try again.')) + '</div></div>';
      return;
    }
    if (!isNum(entry) || !isNum(stop)) { out.innerHTML = '<p class="emptyline">' + esc(T('Enter an entry and a stop to size the position.')) + '</p>'; return; }
    var problem = '';
    if (!(equity > 0)) problem = T('Account equity must be above zero.');
    else if (!(riskPct > 0) || riskPct > 100) problem = T('Risk per trade must be between 0.1% and 100%.');
    else if (!(entry > 0) || !(stop > 0)) problem = T('Prices must be above zero.');
    else if (entry === stop) problem = T('The stop must be different from the entry, or there is no risk to size.');
    else if (side === 'long' && stop > entry) problem = T('For a long trade the stop goes below the entry.');
    else if (side === 'short' && stop < entry) problem = T('For a short trade the stop goes above the entry.');
    if (problem) { setMsg('ps-msg', problem, 'err'); out.innerHTML = '<p class="emptyline">' + esc(T('Fix the highlighted input to see the size.')) + '</p>'; return; }
    var res;
    try { res = riskSize({ equity: equity, riskPct: riskPct, entry: entry, stop: stop, side: side }); } catch (e) { res = null; }
    if (!res || !isNum(res.shares)) { out.innerHTML = '<p class="emptyline">' + esc(T('Could not size this trade. Check the inputs.')) + '</p>'; return; }
    var perShare = Math.abs(entry - stop);
    var pctEq = isNum(res.pctOfEquity) ? res.pctOfEquity : (equity ? res.positionValue / equity * 100 : 0);
    if (pctEq > 0 && pctEq <= 1 && res.positionValue / equity > 0.01 + 1e-9) pctEq *= 100; // fraction → percent
    var html = '<div class="srcnote">' + esc(side === 'long' ? T('Buy') : T('Sell short')) + '</div>' +
      '<div class="hero">' + esc(T(res.shares === 1 ? '{n} share' : '{n} shares', { n: Math.floor(res.shares).toLocaleString(loc()) })) + '</div>' +
      '<div class="statgrid">';
    var row = function (k, v, cls) { html += '<span class="k">' + esc(k) + '</span><span class="v ' + (cls || '') + '">' + v + '</span>'; };
    row(T('Risk per share'), money(perShare) + ' <span class="muted">(' + (perShare / entry * 100).toFixed(2) + '%)</span>');
    row(T('Dollar risk if stopped'), money(res.dollarRisk), 'down');
    row(T('Position value'), money(res.positionValue));
    row(T('Share of equity'), (isNum(pctEq) ? pctEq.toFixed(1) : '—') + '%');
    var notes = [];
    if (res.shares < 1) notes.push(T('The stop is too far away for this risk budget: even one share would risk more than you planned. Use a closer stop, a larger risk %, or skip the trade.'));
    if (res.positionValue > equity) notes.push(T('This size is worth more than your whole account, which needs margin (borrowed money). Many traders cap any one position at 20–25% of equity instead.'));
    else if (pctEq > 25) notes.push(T('More than a quarter of your account in one position: a gap through the stop would hurt far more than planned.'));
    if (isNum(target)) {
      var okSide = side === 'long' ? target > entry : target < entry;
      if (!okSide) notes.push(T('The target is on the wrong side of the entry for this direction.'));
      else {
        var rr = Math.abs(target - entry) / perShare;
        row(T('Reward : risk'), rr.toFixed(2) + ' : 1 <span class="muted">(' + esc(T('{r}R target', { r: rr.toFixed(1) })) + ')</span>', rr >= 1.5 ? 'up' : '');
        row(T('Profit at target'), signed(Math.floor(res.shares) * Math.abs(target - entry)), 'up');
        var be = null;
        try { be = asFraction(typeof BT.risk.breakevenWinRate === 'function' ? BT.risk.breakevenWinRate(rr) : 1 / (1 + rr)); } catch (e) { be = 1 / (1 + rr); }
        if (isNum(be)) row(T('Breakeven win rate'), (be * 100).toFixed(0) + '%');
        if (isNum(win) && win > 0 && win < 100 && typeof BT.risk.kellyFraction === 'function') {
          var kf = null;
          try { kf = BT.risk.kellyFraction(win / 100, rr); } catch (e) { kf = null; }
          if (isNum(kf) && Math.abs(kf) > 1.5) kf = kf / 100;
          if (isNum(kf)) row(T('Kelly fraction (educational)'), kf <= 0 ? T('0% (no edge)') : (kf * 100).toFixed(1) + '%', kf <= 0 ? 'down' : '');
          if (isNum(kf)) notes.push(kf <= 0
            ? T('With this win rate and reward-to-risk the math says there is no edge: you would lose money over many trades.')
            : T('Kelly is a theoretical maximum that assumes your win rate is exact. Traders who use it at all bet a small fraction of it (a quarter or less), because real results vary.'));
        }
        if (isNum(be) && isNum(win)) notes.push(win / 100 > be ? T('Your win rate is above the breakeven rate for this reward-to-risk.') : T('Your win rate is below the breakeven rate for this reward-to-risk, so these trades would lose money on average.'));
      }
    }
    html += '</div>';
    if (notes.length) html += '<ul class="srcnote mt-2" style="padding-left:18px;line-height:1.6">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    out.innerHTML = html;
  }
  (function initSizing() {
    if (!$('ps-out')) return;
    var s = ui.sizing || {};
    if (s.risk) $('ps-risk').value = s.risk;
    if (s.side) $('ps-side').value = s.side;
    ['entry', 'stop', 'target', 'win'].forEach(function (k) { if (s[k] != null && s[k] !== '') $('ps-' + k).value = s[k]; });
    SIZING_IDS.forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', function () { renderSizing(false); }); });
  })();

  /* ------------------------------------------------------------------ *
   * Render everything that depends on account state
   * ------------------------------------------------------------------ */
  function renderAll() {
    renderHeader();
    renderTiles();
    renderEquity();
    renderStats();
    renderPositions();
    renderOrders();
    renderHistory();
    renderSettings();
    renderSim();
    renderAccounts();
    if (ui.tab === 'sizing') renderSizing(false);
  }

  /* ================================================================== *
   * Options Lab
   * ================================================================== */
  // Legs come back from localStorage, so never trust their shape: keep only
  // well-formed numeric legs and coerce every field before it reaches the DOM
  // or the P&L arithmetic (a stray string would otherwise break out of an input
  // value attribute or turn the net cost into NaN).
  function sanitizeLegs(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (l) {
      return l && typeof l === 'object' && /^[CPS]$/.test(String(l.right)) &&
        isNum(+l.strike) && isNum(+l.qty) && Math.round(+l.qty) !== 0 &&
        (l.right === 'S' || isNum(+l.premium)) &&
        l.strike !== null && l.strike !== '' && l.qty !== null && l.qty !== '';
    }).map(function (l) {
      return {
        right: l.right,
        strike: +l.strike,
        qty: Math.round(+l.qty),
        premium: l.right === 'S' ? 0 : +l.premium,
        contract: typeof l.contract === 'string' ? l.contract : null,
        expiry: typeof l.expiry === 'string' ? l.expiry : null
      };
    });
  }
  var lab = { symbol: ui.labSymbol, spot: null, rows: null, expiry: ui.expiry, legs: sanitizeLegs(ui.legs), preset: null, src: null };
  var labLoaded = false, labLoading = false;
  var EXPIRY_DAYS = [7, 14, 30, 45, 60, 90, 180];
  var RATE = 0.05;
  var GREEK_TIPS = opt.glossary || {};
  var COLS = [
    { k: 'delta', h: 'Δ', dp: 2, tip: GREEK_TIPS.delta },
    { k: 'gamma', h: 'Γ', dp: 3, tip: GREEK_TIPS.gamma },
    { k: 'theta', h: 'Θ', dp: 3, tip: GREEK_TIPS.theta },
    { k: 'vega', h: 'V', dp: 3, tip: GREEK_TIPS.vega },
    { k: 'iv', h: 'IV', pct: true, tip: GREEK_TIPS.iv },
    { k: 'bid', h: 'Bid', dp: 2, tip: 'Bid: what buyers will pay right now. You receive the bid when you sell (write) an option.' },
    { k: 'ask', h: 'Ask', dp: 2, tip: 'Ask: what sellers want right now. You pay the ask when you buy an option. Ask minus bid is the spread, your first cost.' }
  ];

  function ensureLab() {
    if (!labLoaded && !labLoading) loadLab(ui.labSymbol || 'AAPL');
  }
  function updateLabSpot(spot) {
    if (!isNum(spot) || spot <= 0) return;
    if (lab.spot && Math.abs(spot / lab.spot - 1) < 0.0005) return; // unchanged, skip the rebuild
    lab.spot = spot;
    buildChain();
    renderChain();
    renderLegs();
  }
  async function loadLab(symbol) {
    symbol = String(symbol || '').trim().toUpperCase();
    if (!symbol) return;
    labLoading = true;
    $('opt-src').textContent = T('Loading {symbol}…', { symbol: symbol });
    try {
      var q = await data.quote(symbol);
      if (!q || !isNum(q.price) || q.price <= 0) throw new Error('No price for ' + symbol);
      marks[symbol] = q.price;
      markMeta[symbol] = { live: !!q.live && !q.fallback, fallback: !!q.fallback, reason: q.reason || '', cached: !!q.cached, at: Date.now() };
      if (lab.symbol !== symbol) { lab.legs = []; lab.preset = null; lab.expiry = null; }
      lab.symbol = symbol; ui.labSymbol = symbol; lab.spot = q.price; lab.src = q;
      var u = data.lookup ? data.lookup(symbol) : null;
      $('opt-src').innerHTML = (u && u.name ? esc(u.name) + ' · ' : '') + (q.fallback ? '<span class="pill demo" style="font-size:9px;padding:0 5px">demo</span> ' + esc(q.reason || 'simulated price') : '<span class="pill live" style="font-size:9px;padding:0 5px">live</span> quote');
      labLoaded = true;
      buildChain();
      autoDividend();
      renderExpiries();
      renderChain();
      renderLegs();
      saveUi();
    } catch (e) {
      $('opt-src').textContent = T('Could not load {symbol}: {error}', { symbol: symbol, error: e && e.message ? e.message : e });
    } finally { labLoading = false; }
  }
  function buildChain() {
    if (!isNum(lab.spot)) return;
    lab.rows = opt.chain(lab.spot, { symbol: lab.symbol, expiries: EXPIRY_DAYS, ivBase: ui.ivBase, r: RATE });
    if (!lab.expiry || lab.rows.expiries.indexOf(lab.expiry) === -1) lab.expiry = lab.rows.expiries[2] || lab.rows.expiries[0];
    ui.expiry = lab.expiry;
    $('opt-spot').textContent = money(lab.spot);
  }
  function renderExpiries() {
    var host = $('expiries'); host.innerHTML = '';
    if (!lab.rows) return;
    lab.rows.expiries.forEach(function (exp, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab');
      b.className = exp === lab.expiry ? 'on' : '';
      b.setAttribute('aria-selected', exp === lab.expiry ? 'true' : 'false');
      b.innerHTML = esc(exp) + '<small>' + EXPIRY_DAYS[i] + 'd</small>';
      b.title = EXPIRY_DAYS[i] + ' days to expiration. Shorter expiries are cheaper but decay faster.';
      b.onclick = function () { lab.expiry = exp; ui.expiry = exp; saveUi(); renderExpiries(); renderChain(); };
      host.appendChild(b);
    });
  }
  function fmtGreek(row, c) {
    var v = row[c.k];
    if (c.pct) return (v * 100).toFixed(1) + '%';
    return isNum(v) ? v.toFixed(c.dp) : '—';
  }
  function renderChain() {
    var head = $('chain-head'), tb = $('chain');
    if (!lab.rows) { head.innerHTML = ''; tb.innerHTML = '<tr><td colspan="17" class="emptyline" style="text-align:center">Load an underlying to see its chain.</td></tr>'; return; }
    var th = function (c) { return '<th title="' + esc(c.tip || '') + '">' + c.h + (c.tip ? '<button class="tip" type="button" aria-label="Explain ' + esc(c.h) + '" data-tip="' + esc(c.tip) + '"></button>' : '') + '</th>'; };
    head.innerHTML = COLS.map(th).join('') + '<th></th><th class="strike">Strike</th><th></th>' + COLS.slice().reverse().map(th).join('');
    var calls = opt.chainSlice(lab.rows, lab.expiry, 'C'), puts = opt.chainSlice(lab.rows, lab.expiry, 'P');
    var putBy = {}; puts.forEach(function (p) { putBy[p.strike] = p; });
    var atm = opt.atmRow(lab.rows, lab.expiry, 'C');
    var html = '';
    calls.forEach(function (c) {
      var p = putBy[c.strike];
      var cells = function (row, cls) { return COLS.map(function (col) { return '<td class="' + cls + '">' + fmtGreek(row, col) + '</td>'; }).join(''); };
      var act = function (row) {
        return '<td class="act"><button class="b" type="button" data-buy="' + esc(row.contract) + '" title="Buy to open at the ask ' + money(row.ask) + ' (' + money(row.ask * 100) + ' per contract)">+</button> ' +
          '<button class="s" type="button" data-sell="' + esc(row.contract) + '" title="Sell to open (write) at the bid ' + money(row.bid) + '. Collects ' + money(row.bid * 100) + ' per contract but takes on the obligation">−</button></td>';
      };
      html += '<tr class="' + (atm && atm.strike === c.strike ? 'atm' : '') + '" data-strike="' + c.strike + '">' +
        cells(c, c.itm ? 'itm' : '') + act(c) +
        '<td class="strike">' + plain(c.strike, c.strike % 1 ? 2 : 0) + '</td>' +
        (p ? act(p) + COLS.slice().reverse().map(function (col) { return '<td class="' + (p.itm ? 'itm' : '') + '">' + fmtGreek(p, col) + '</td>'; }).join('') : '<td colspan="8"></td>') +
        '</tr>';
    });
    tb.innerHTML = html;
    tb.querySelectorAll('[data-buy]').forEach(function (b) { b.onclick = function () { addLegFromContract(b.dataset.buy, 1); }; });
    tb.querySelectorAll('[data-sell]').forEach(function (b) { b.onclick = function () { addLegFromContract(b.dataset.sell, -1); }; });
    // scroll the ATM row into view the first time
    var atmRow = tb.querySelector('tr.atm');
    if (atmRow && !tb.dataset.scrolled) { tb.dataset.scrolled = '1'; var wrap = tb.closest('.chain-wrap'); if (wrap) wrap.scrollTop = Math.max(0, atmRow.offsetTop - wrap.clientHeight / 2); }
  }
  function rowFor(contract) {
    if (!lab.rows) return null;
    for (var i = 0; i < lab.rows.length; i++) if (lab.rows[i].contract === contract) return lab.rows[i];
    return null;
  }
  function legLabel(l) {
    if (l.right === 'S') return (l.qty > 0 ? 'Buy ' : 'Sell short ') + Math.abs(l.qty) + ' sh ' + esc(lab.symbol);
    return (l.qty > 0 ? 'Buy ' : 'Write ') + Math.abs(l.qty) + ' ' + plain(l.strike, l.strike % 1 ? 2 : 0) + (l.right === 'C' ? ' call' : ' put');
  }
  function addLegFromContract(contract, dir) {
    var row = rowFor(contract); if (!row) return;
    var premium = dir > 0 ? row.ask : row.bid;
    var existing = lab.legs.filter(function (l) { return l.contract === contract; })[0];
    if (existing) { existing.qty += dir; existing.premium = existing.qty > 0 ? row.ask : row.bid; if (existing.qty === 0) lab.legs.splice(lab.legs.indexOf(existing), 1); }
    else lab.legs.push({ right: row.right, strike: row.strike, qty: dir, premium: premium, contract: contract, expiry: row.expiry });
    lab.preset = null; $('preset').value = ''; $('preset-desc').hidden = true;
    renderLegs();
  }
  function daysForLegs() {
    var exp = (lab.legs.filter(function (l) { return l.expiry; })[0] || {}).expiry || lab.expiry;
    var d = exp ? opt.daysToExpiry(exp) : 45;
    return Math.max(1, isNum(d) ? d : 45);
  }
  function loadPreset(id) {
    if (!id || !lab.rows) return;
    var exp = lab.expiry, days = Math.max(1, opt.daysToExpiry(exp));
    var built = opt.buildStrategy(id, lab.spot, { iv: ui.ivBase, T: days / opt.DAYS_PER_YEAR, r: RATE });
    lab.legs = built.legs.map(function (l) {
      if (l.right === 'S') return { right: 'S', strike: lab.spot, qty: l.qty, premium: 0, contract: null, expiry: null };
      var row = null;
      for (var i = 0; i < lab.rows.length; i++) { var r = lab.rows[i]; if (r.expiry === exp && r.right === l.right && Math.abs(r.strike - l.strike) < 1e-6) { row = r; break; } }
      var contract = row ? row.contract : opt.occ(lab.symbol, exp, l.right, l.strike);
      var premium = row ? (l.qty > 0 ? row.ask : row.bid) : l.premium;
      return { right: l.right, strike: l.strike, qty: l.qty, premium: premium, contract: contract, expiry: exp };
    });
    lab.preset = id;
    var s = built.strategy;
    $('preset-desc').hidden = false;
    $('preset-desc').innerHTML = '<b>' + esc(s.name) + '</b> — ' + esc(s.description) +
      '<div class="meta"><span class="pill accent">outlook: ' + esc(s.outlook) + '</span><span class="pill">complexity ' + s.complexity + '/4</span></div>' +
      '<p class="mt-2"><b>When:</b> ' + esc(s.when) + '<br><b>Risk:</b> ' + esc(s.risk) + '</p>';
    renderLegs();
  }
  function renderLegs() {
    var tb = $('legs'); tb.innerHTML = '';
    $('legs-empty').hidden = lab.legs.length > 0;
    var net = 0;
    lab.legs.forEach(function (l, i) {
      var mult = l.right === 'S' ? 1 : 100;
      var cost = l.right === 'S' ? l.qty * l.strike : l.qty * l.premium * mult;
      net += cost;
      var row = l.contract ? rowFor(l.contract) : null;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="lbl"><span class="' + (l.qty > 0 ? 'up' : 'down') + '">' + legLabel(l) + '</span><small>' + esc(l.contract || (lab.symbol + ' shares')) + (row ? ' · Δ ' + row.delta.toFixed(2) + ' · IV ' + (row.iv * 100).toFixed(0) + '%' : '') + '</small></td>' +
        '<td class="right"><input type="number" step="1" value="' + esc(String(l.qty)) + '" data-qty="' + i + '" aria-label="Quantity"></td>' +
        '<td class="right"><input type="number" step="0.01" min="0" value="' + esc(String(l.right === 'S' ? l.strike : l.premium)) + '" data-prem="' + i + '" aria-label="' + (l.right === 'S' ? 'Entry price' : 'Premium') + '"></td>' +
        '<td class="num right ' + (cost > 0 ? 'down' : 'up') + '" title="' + (cost > 0 ? 'Debit: cash you pay' : 'Credit: cash you receive') + '">' + (cost > 0 ? '−' : '+') + money(Math.abs(cost)) + '</td>' +
        '<td class="right"><button class="sm ghost" type="button" data-rm="' + i + '" aria-label="Remove leg">✕</button></td>';
      tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-qty]').forEach(function (inp) {
      inp.onchange = function () { var v = Math.round(Number(inp.value)); var l = lab.legs[Number(inp.dataset.qty)]; if (!l) return; if (!v) { lab.legs.splice(lab.legs.indexOf(l), 1); } else { var flipped = (v > 0) !== (l.qty > 0); l.qty = v; var row = l.contract ? rowFor(l.contract) : null; if (flipped && row) l.premium = v > 0 ? row.ask : row.bid; } renderLegs(); };
    });
    tb.querySelectorAll('[data-prem]').forEach(function (inp) {
      inp.onchange = function () { var v = Number(inp.value); var l = lab.legs[Number(inp.dataset.prem)]; if (!l || !isNum(v) || v < 0) return; if (l.right === 'S') l.strike = v; else l.premium = v; renderLegs(); };
    });
    tb.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { lab.legs.splice(Number(b.dataset.rm), 1); lab.preset = null; $('preset').value = ''; $('preset-desc').hidden = true; renderLegs(); }; });
    ui.legs = lab.legs; saveUi();
    renderAnalysis(net);
    drawPayoff();
    renderWhatIf();
  }

  function apiLegs() {
    return lab.legs.map(function (l) { return { right: l.right, strike: l.strike, qty: l.qty, premium: l.right === 'S' ? 0 : l.premium }; });
  }
  function renderAnalysis(net) {
    var host = $('analysis'), gh = $('greeks'), sum = $('analysis-summary');
    if (!lab.legs.length || !isNum(lab.spot)) { host.innerHTML = '<span class="k">Max profit</span><span class="v">—</span><span class="k">Max loss</span><span class="v">—</span><span class="k">Breakevens</span><span class="v">—</span><span class="k">Net</span><span class="v">—</span>'; gh.innerHTML = ''; sum.textContent = 'Add legs to analyze the position.'; return; }
    var days = daysForLegs(), T = days / opt.DAYS_PER_YEAR;
    var a = opt.analyze(apiLegs(), { spot: lab.spot, iv: ui.ivBase, T: T, r: RATE });
    var row = function (label, key, val, cls) {
      var tip = {
        maxProfit: 'The most this position can make if held to expiration. "Unlimited" means the payoff keeps rising (or falling, for shorts) with the stock.',
        maxLoss: 'The most you can lose at expiration. For long options this is the premium paid. "Unlimited" is a warning: naked short calls (or short stock) have no floor.',
        breakeven: GREEK_TIPS.breakeven || 'Stock price at expiration where the position neither makes nor loses money.',
        net: 'Net debit (you pay) or credit (you receive) to open, before commissions. Shares count at their full price.',
        rr: 'Max profit ÷ max loss. A 1:1 trade needs to win more than half the time to pay; a 3:1 trade can be right only a third of the time.',
        pop: 'Model estimate of the chance the position is profitable at expiration, assuming the stock follows a lognormal walk at the chosen implied volatility. High-probability trades usually pay little; that is the trade-off.',
        move: 'One-standard-deviation expected move to expiration: spot × IV × √(days ÷ 365). Roughly two thirds of the time the stock finishes inside this range (under the model).'
      }[key] || '';
      return '<span class="k">' + label + (tip ? '<button class="tip" type="button" aria-label="Explain ' + esc(label) + '" data-tip="' + esc(tip) + '"></button>' : '') + '</span><span class="v ' + (cls || '') + '">' + val + '</span>';
    };
    var move = lab.spot * ui.ivBase * Math.sqrt(T);
    var html = '';
    html += row('Max profit', 'maxProfit', a.maxProfit === Infinity ? 'Unlimited' : signed(a.maxProfit), a.maxProfit === Infinity || a.maxProfit > 0 ? 'up big' : 'big');
    html += row('Max loss', 'maxLoss', a.maxLoss === -Infinity ? 'Unlimited' : signed(a.maxLoss), a.maxLoss === -Infinity || a.maxLoss < 0 ? 'down big' : 'big');
    html += row('Breakeven' + (a.breakevens.length === 1 ? '' : 's'), 'breakeven', a.breakevens.length ? a.breakevens.map(function (b) { return money(b); }).join(' · ') : '—');
    html += row(a.isCredit ? 'Net credit' : 'Net debit', 'net', money(Math.abs(a.netCost)), a.isCredit ? 'up' : 'down');
    html += row('Reward : risk', 'rr', a.riskReward == null ? '—' : a.riskReward.toFixed(2) + ' : 1');
    if (isNum(a.probProfit)) html += row('Prob. of profit', 'pop', (a.probProfit * 100).toFixed(0) + '%');
    html += row('Expected move', 'move', '± ' + money(move) + ' <span class="muted">(' + days.toFixed(0) + 'd)</span>');
    host.innerHTML = html;

    var g = opt.positionGreeks(apiLegs(), lab.spot, { T: T, iv: ui.ivBase, r: RATE });
    var gTip = {
      delta: (GREEK_TIPS.delta || '') + ' For the whole position: how many dollars you make per $1 rise in the stock.',
      gamma: (GREEK_TIPS.gamma || '') + ' Position gamma: how much your delta changes per $1 move.',
      theta: (GREEK_TIPS.theta || '') + ' Position theta: dollars gained or lost per day from time passing alone.',
      vega: (GREEK_TIPS.vega || '') + ' Position vega: dollars gained or lost if implied volatility rises one point.',
      rho: GREEK_TIPS.rho || ''
    };
    gh.innerHTML = ['delta', 'gamma', 'theta', 'vega', 'rho'].map(function (k) {
      var v = g[k], shown = k === 'gamma' ? v.toFixed(3) : (k === 'delta' ? v.toFixed(1) : signed(v));
      return '<div class="g"><div class="label">' + k + '<button class="tip" type="button" aria-label="Explain ' + k + '" data-tip="' + esc(gTip[k]) + '"></button></div><div class="value ' + (k === 'gamma' ? '' : pnlClass(v)) + '">' + shown + '</div></div>';
    }).join('');
    sum.textContent = (a.summary || '') + (lab.preset && opt.strategies[lab.preset] ? '' : '');
  }

  /* ---------------- payoff canvas ---------------- */
  var canvas = $('payoff'), hoverX = null;
  function niceStep(range, target) {
    var raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
  }
  function t0Value(S, legsN, T) {
    var tot = 0;
    legsN.forEach(function (l) {
      if (l.right === 'S') { tot += l.qty * (S - l.strike); return; }
      var iv = opt.smileIV(lab.spot, l.strike, T, ui.ivBase);
      var px = T > 0 ? opt.bs({ S: S, K: l.strike, T: T, r: RATE, sigma: iv, type: l.right === 'P' ? 'put' : 'call' }).price : (l.right === 'C' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S));
      tot += l.qty * 100 * (px - l.premium);
    });
    return tot;
  }
  // Split text into lines that each fit within maxWidth. Lines are balanced
  // (roughly equal length) rather than greedily filled, so a two-line hint reads
  // 'Add legs or load a preset' / 'to draw the payoff diagram' instead of a long
  // first line with one orphaned word.
  function wrapText(ctx, text, maxWidth) {
    var str = String(text).trim(), total = ctx.measureText(str).width;
    if (total <= maxWidth) return [str];
    var n = Math.ceil(total / maxWidth), target = Math.min(maxWidth, total / n * 1.08);
    var words = str.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(test).width > target) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function drawPayoff() {
    if (!canvas || $('panel-options').hidden) return;
    var wrap = canvas.parentElement, dpr = window.devicePixelRatio || 1;
    var W = wrap.clientWidth, H = wrap.clientHeight;
    if (W < 10 || H < 10) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var C = { panel: css('--panel'), line: css('--line'), fg: css('--fg'), muted: css('--muted'), up: css('--up'), down: css('--down'), accent: css('--accent'), warn: css('--warn'), mono: css('--mono') || 'monospace' };
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);
    ctx.font = '11px ' + C.mono;
    var readout = $('payoff-readout');
    if (!lab.legs.length || !isNum(lab.spot)) {
      ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Word-wrap the hint so it never clips at phone widths (~332 CSS px canvas).
      var lines = wrapText(ctx, 'Add legs or load a preset to draw the payoff diagram', W - 24), lh = 15;
      lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh); });
      readout.textContent = ''; return;
    }
    var legsN = apiLegs();
    var ks = legsN.map(function (l) { return l.strike; });
    var lo = Math.min.apply(null, ks.concat([lab.spot])), hi = Math.max.apply(null, ks.concat([lab.spot]));
    var span = Math.max(hi - lo, lab.spot * 0.25);
    var xmin = Math.max(0, lo - span * 0.6), xmax = hi + span * 0.6;
    var pts = opt.payoff(legsN, { min: xmin, max: xmax, steps: 160 });
    var a = opt.analyze(legsN, { spot: lab.spot });
    var Tyr = daysForLegs() / opt.DAYS_PER_YEAR;
    var showT0 = $('show-t0').checked && Tyr > 0;
    var t0 = showT0 ? pts.map(function (p) { return { S: p.S, pnl: t0Value(p.S, legsN, Tyr) }; }) : [];
    var ys = pts.map(function (p) { return p.pnl; }).concat(t0.map(function (p) { return p.pnl; }), [0]);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (ymax - ymin < 1) { ymax += 50; ymin -= 50; }
    var pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
    var L = 62, R = 14, Tp = 16, B = 28, pw = W - L - R, ph = H - Tp - B;
    var X = function (s) { return L + (s - xmin) / (xmax - xmin) * pw; };
    var Y = function (v) { return Tp + (ymax - v) / (ymax - ymin) * ph; };
    var zeroY = Y(0);

    // probability range bands (1σ darker, 2σ lighter) behind everything else
    var cone = null;
    if ($('show-cone') && $('show-cone').checked) {
      try { cone = opt.probRange(lab.spot, ui.ivBase, Math.max(1, lastLegDays())); } catch (e) { cone = null; }
      if (cone) {
        ctx.save(); ctx.beginPath(); ctx.rect(L, Tp, pw, ph); ctx.clip();
        ctx.fillStyle = C.accent;
        ctx.globalAlpha = 0.07; ctx.fillRect(X(cone.low2), Tp, X(cone.high2) - X(cone.low2), ph);
        ctx.globalAlpha = 0.09; ctx.fillRect(X(cone.low1), Tp, X(cone.high1) - X(cone.low1), ph);
        ctx.globalAlpha = 0.8; ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        var c1 = (X(cone.low1) + X(cone.high1)) / 2;
        if (X(cone.high1) - X(cone.low1) > 40) ctx.fillText('68%', c1, Tp + 16);
        ctx.restore();
      }
    }
    canvas.setAttribute('aria-label', T('Payoff at expiration for {n} legs. Max profit {max}, max loss {loss}. {be}', {
      n: legsN.length,
      max: a.maxProfit === Infinity ? T('unlimited') : signed(a.maxProfit),
      loss: a.maxLoss === -Infinity ? T('unlimited') : signed(a.maxLoss),
      be: a.breakevens.length ? T('Breakevens: {list}.', { list: a.breakevens.map(function (b) { return money(b); }).join(', ') }) : T('No breakeven.')
    }) + (cone ? ' ' + T('About 68% of the time the stock finishes between {lo} and {hi} under the model.', { lo: money(cone.low1), hi: money(cone.high1) }) : ''));

    // grid + axes
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ystep = niceStep(ymax - ymin, 5);
    for (var v = Math.ceil(ymin / ystep) * ystep; v <= ymax; v += ystep) {
      var yy = Y(v); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.fillText((v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v)).toLocaleString(loc()), L - 6, yy);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xstep = niceStep(xmax - xmin, Math.max(3, Math.floor(pw / 80)));
    for (var s = Math.ceil(xmin / xstep) * xstep; s <= xmax; s += xstep) {
      var xx = X(s); ctx.beginPath(); ctx.moveTo(xx, Tp); ctx.lineTo(xx, Tp + ph); ctx.stroke();
      ctx.fillText('$' + (xstep < 1 ? s.toFixed(2) : Math.round(s)), xx, Tp + ph + 6);
    }
    // profit / loss fills, clipped above and below zero
    var fillPoly = function (color, top, bottom) {
      ctx.save(); ctx.beginPath(); ctx.rect(L, top, pw, bottom - top); ctx.clip();
      ctx.beginPath(); ctx.moveTo(X(pts[0].S), zeroY);
      pts.forEach(function (p) { ctx.lineTo(X(p.S), Y(p.pnl)); });
      ctx.lineTo(X(pts[pts.length - 1].S), zeroY); ctx.closePath();
      ctx.globalAlpha = 0.22; ctx.fillStyle = color; ctx.fill(); ctx.restore();
    };
    fillPoly(C.up, Tp, zeroY); fillPoly(C.down, zeroY, Tp + ph);
    // zero line
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, zeroY); ctx.lineTo(W - R, zeroY); ctx.stroke();
    // T+0 curve
    if (t0.length) {
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.beginPath();
      t0.forEach(function (p, i) { var x = X(p.S), y = Y(p.pnl); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.restore();
    }
    // expiration payoff line, coloured by sign
    ctx.lineWidth = 2;
    for (var i = 1; i < pts.length; i++) {
      var p0 = pts[i - 1], p1 = pts[i];
      if ((p0.pnl >= 0) !== (p1.pnl >= 0) && p1.pnl !== p0.pnl) {
        var sz = p0.S + (0 - p0.pnl) * (p1.S - p0.S) / (p1.pnl - p0.pnl);
        ctx.strokeStyle = p0.pnl >= 0 ? C.up : C.down; ctx.beginPath(); ctx.moveTo(X(p0.S), Y(p0.pnl)); ctx.lineTo(X(sz), zeroY); ctx.stroke();
        ctx.strokeStyle = p1.pnl >= 0 ? C.up : C.down; ctx.beginPath(); ctx.moveTo(X(sz), zeroY); ctx.lineTo(X(p1.S), Y(p1.pnl)); ctx.stroke();
      } else {
        ctx.strokeStyle = (p0.pnl + p1.pnl) / 2 >= 0 ? C.up : C.down; ctx.beginPath(); ctx.moveTo(X(p0.S), Y(p0.pnl)); ctx.lineTo(X(p1.S), Y(p1.pnl)); ctx.stroke();
      }
    }
    // breakevens
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = C.warn; ctx.fillStyle = C.warn; ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    a.breakevens.forEach(function (b) { if (b < xmin || b > xmax) return; var x = X(b); ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke(); ctx.fillText('BE ' + (b < 10 ? b.toFixed(2) : b.toFixed(b % 1 ? 2 : 0)), x, Tp + ph - 2); });
    ctx.restore();
    // spot
    var sx = X(lab.spot);
    ctx.save(); ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, Tp); ctx.lineTo(sx, Tp + ph); ctx.stroke();
    ctx.textAlign = sx > W - 90 ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillText('spot ' + money(lab.spot), sx + (sx > W - 90 ? -4 : 4), Tp + 2); ctx.restore();
    // hover crosshair
    if (hoverX != null && hoverX >= L && hoverX <= L + pw) {
      var S = xmin + (hoverX - L) / pw * (xmax - xmin);
      var pnl = opt.pnlAt(legsN, S);
      var now = showT0 ? t0Value(S, legsN, Tyr) : null;
      ctx.save(); ctx.strokeStyle = C.fg; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hoverX, Tp); ctx.lineTo(hoverX, Tp + ph); ctx.stroke(); ctx.restore();
      ctx.fillStyle = pnl >= 0 ? C.up : C.down; ctx.beginPath(); ctx.arc(hoverX, Y(pnl), 4, 0, Math.PI * 2); ctx.fill();
      readout.textContent = 'at ' + money(S) + ': ' + signed(pnl) + ' at expiry' + (now != null ? ' · ' + signed(now) + ' today' : '');
    } else {
      readout.textContent = a.breakevens.length ? 'breakeven' + (a.breakevens.length > 1 ? 's' : '') + ' ' + a.breakevens.map(function (b) { return money(b); }).join(', ') : 'hover for values';
    }
  }
  if (canvas) {
    canvas.addEventListener('mousemove', function (e) { var r = canvas.getBoundingClientRect(); hoverX = e.clientX - r.left; drawPayoff(); });
    canvas.addEventListener('mouseleave', function () { hoverX = null; drawPayoff(); });
    canvas.addEventListener('touchmove', function (e) { if (!e.touches.length) return; var r = canvas.getBoundingClientRect(); hoverX = e.touches[0].clientX - r.left; drawPayoff(); }, { passive: true });
    canvas.addEventListener('touchend', function () { hoverX = null; drawPayoff(); });
    if (window.ResizeObserver) new ResizeObserver(function () { drawPayoff(); }).observe(canvas.parentElement);
    else window.addEventListener('resize', drawPayoff);
  }
  $('show-t0').checked = ui.showT0 !== false;
  if ($('show-cone')) {
    $('show-cone').checked = ui.showCone !== false;
    $('show-cone').onchange = function () { ui.showCone = $('show-cone').checked; saveUi(); drawPayoff(); };
  }
  $('show-t0').onchange = function () { ui.showT0 = $('show-t0').checked; saveUi(); drawPayoff(); };

  /* ---------------- what-if analyzer (v0.5) ---------------- */
  // Scenario: price null = follow the live spot; days forward and IV shift (vol points).
  var wi = { price: null, days: 0, ivShift: 0, greek: ui.wiGreek || 'delta' };
  var GREEK_NOTES = {
    delta: 'Delta: dollars gained or lost per $1 move in the stock. Watch how it changes as the price moves; that change is gamma.',
    gamma: 'Gamma: how fast delta changes. It peaks near the strikes and grows as expiry approaches, which is why short options get jumpy in the last days.',
    theta: 'Theta: dollars gained or lost per day from time passing alone. Short options collect it; long options pay it.',
    vega: 'Vega: dollars gained or lost when implied volatility rises one point. Long options want IV up; short options want it down.'
  };
  /** Lab legs in BT.options what-if shape: option legs carry their own days to expiry. */
  function wiLegs() {
    var fallback = daysForLegs();
    return lab.legs.map(function (l) {
      var o = { right: l.right, strike: l.strike, qty: l.qty, premium: l.right === 'S' ? 0 : l.premium };
      if (l.right !== 'S') {
        var d = l.expiry ? opt.daysToExpiry(l.expiry) : NaN;
        o.days = Math.max(0, isNum(d) ? d : fallback);
      }
      return o;
    });
  }
  function wiOpts(extra) {
    return Object.assign({
      r: RATE, iv: ui.ivBase,
      // Sticky-strike smile: each strike keeps the vol the chain shows for it today.
      ivFor: function (leg, T) { return opt.smileIV(lab.spot, leg.strike, Math.max(T, 1 / opt.DAYS_PER_YEAR), ui.ivBase); }
    }, extra || {});
  }
  function lastLegDays() {
    var L = wiLegs(), m = 0;
    L.forEach(function (l) { if (l.right !== 'S') m = Math.max(m, l.days); });
    return m || daysForLegs();
  }
  /** Shared x-range for the payoff and what-if charts: strikes and spot with room either side. */
  function priceRange() {
    var ks = lab.legs.map(function (l) { return l.strike; });
    var lo = Math.min.apply(null, ks.concat([lab.spot])), hi = Math.max.apply(null, ks.concat([lab.spot]));
    var span = Math.max(hi - lo, lab.spot * 0.25);
    return { min: Math.max(0, lo - span * 0.6), max: hi + span * 0.6 };
  }
  function chartColors() {
    return { panel: css('--panel'), line: css('--line'), fg: css('--fg'), muted: css('--muted'), up: css('--up'), down: css('--down'), accent: css('--accent'), warn: css('--warn'), purple: css('--purple') || css('--s3'), s1: css('--s1'), mono: css('--mono') || 'monospace' };
  }
  /**
   * Small line chart on a canvas. cfg = {xmin, xmax, series:[{pts:[{x,y}], color, width, dash}],
   * yFmt(v), vline:{x, color, label}, dot:{x, y, color}, empty:'text'}. Returns false when not drawn.
   */
  function plotLines(cv, cfg) {
    if (!cv) return false;
    var wrap = cv.parentElement, dpr = window.devicePixelRatio || 1;
    var W = wrap.clientWidth, H = wrap.clientHeight;
    if (W < 10 || H < 10) return false;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var C = chartColors();
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);
    ctx.font = '11px ' + C.mono;
    if (cfg.empty) {
      ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      wrapText(ctx, cfg.empty, W - 24).forEach(function (ln, i, arr) { ctx.fillText(ln, W / 2, H / 2 + (i - (arr.length - 1) / 2) * 15); });
      return true;
    }
    var ys = [0];
    cfg.series.forEach(function (s) { s.pts.forEach(function (p) { if (isNum(p.y)) ys.push(p.y); }); });
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (ymax - ymin < 1e-6) { var b = Math.max(1, Math.abs(ymax) * 0.5); ymax += b; ymin -= b; }
    var padY = (ymax - ymin) * 0.1; ymin -= padY; ymax += padY;
    var L = 58, R = 10, Tp = 10, B = 24, pw = W - L - R, ph = H - Tp - B;
    var X = function (x) { return L + (x - cfg.xmin) / (cfg.xmax - cfg.xmin) * pw; };
    var Y = function (v) { return Tp + (ymax - v) / (ymax - ymin) * ph; };
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ystep = niceStep(ymax - ymin, 4);
    for (var v = Math.ceil(ymin / ystep) * ystep; v <= ymax; v += ystep) {
      var yy = Y(v); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.fillText(cfg.yFmt(Math.abs(v) < ystep / 1e6 ? 0 : v, ystep), L - 6, yy);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xstep = niceStep(cfg.xmax - cfg.xmin, Math.max(3, Math.floor(pw / 80)));
    for (var s = Math.ceil(cfg.xmin / xstep) * xstep; s <= cfg.xmax; s += xstep) ctx.fillText('$' + (xstep < 1 ? s.toFixed(2) : Math.round(s)), X(s), Tp + ph + 6);
    ctx.strokeStyle = C.muted; ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(L, Tp, pw, ph); ctx.clip();
    cfg.series.forEach(function (sr) {
      ctx.save(); ctx.strokeStyle = sr.color; ctx.lineWidth = sr.width || 1.5; if (sr.dash) ctx.setLineDash(sr.dash);
      ctx.beginPath();
      sr.pts.forEach(function (p, i) { var x = X(p.x), y = Y(p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.restore();
    });
    if (cfg.vline && isNum(cfg.vline.x)) {
      var vx = X(cfg.vline.x);
      ctx.save(); ctx.strokeStyle = cfg.vline.color; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(vx, Tp); ctx.lineTo(vx, Tp + ph); ctx.stroke(); ctx.restore();
    }
    if (cfg.dot && isNum(cfg.dot.y)) { ctx.fillStyle = cfg.dot.color; ctx.beginPath(); ctx.arc(X(cfg.dot.x), Y(cfg.dot.y), 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    return true;
  }
  function wiDaysLabel(d) { return d === 0 ? T('today') : T(Math.round(d) === 1 ? 'in {n} day' : 'in {n} days', { n: Math.round(d) }); }
  function syncWhatIfControls(last) {
    var pEl = $('wi-price'), dEl = $('wi-days'), iEl = $('wi-iv');
    if (!pEl || !isNum(lab.spot)) return;
    var step = lab.spot < 20 ? 0.01 : lab.spot < 200 ? 0.05 : 0.25;
    pEl.min = String(Math.max(0.01, Math.round(lab.spot * 0.7 / step) * step).toFixed(2));
    pEl.max = String((Math.round(lab.spot * 1.3 / step) * step).toFixed(2));
    pEl.step = String(step);
    var price = wi.price == null ? lab.spot : Math.min(Number(pEl.max), Math.max(Number(pEl.min), wi.price));
    if (document.activeElement !== pEl) pEl.value = String(price);
    var maxD = Math.max(1, Math.ceil(last));
    dEl.max = String(maxD);
    if (wi.days > maxD) wi.days = maxD;
    if (document.activeElement !== dEl) dEl.value = String(wi.days);
    if (document.activeElement !== iEl) iEl.value = String(wi.ivShift);
    var chg = (price / lab.spot - 1) * 100;
    $('wi-price-v').textContent = money(price) + (Math.abs(chg) >= 0.05 ? ' (' + pct(chg, 1) + ')' : '');
    $('wi-days-v').textContent = wi.days >= last ? T('{n} · expiry', { n: wi.days }) : String(wi.days);
    $('wi-iv-v').textContent = (wi.ivShift > 0 ? '+' : wi.ivShift < 0 ? '−' : '+') + Math.abs(wi.ivShift) + ' ' + T('pts') + ' (' + Math.round(Math.max(1, ui.ivBase * 100 + wi.ivShift)) + '%)';
    return price;
  }
  function renderWhatIf() {
    var card = $('whatif'); if (!card) return;
    var res = $('wi-result'), warn = $('wi-warn'), legend = $('wi-legend');
    if (!lab.legs.length || !isNum(lab.spot)) {
      res.innerHTML = '<span class="k">' + esc(T('Scenario')) + '</span><span class="v">—</span>';
      warn.innerHTML = ''; legend.innerHTML = '';
      $('wi-greeks-note').textContent = '';
      if (!$('panel-options').hidden) {
        plotLines($('wi-curves'), { empty: T('Add legs to compare the position at different dates') });
        plotLines($('wi-greeks'), { empty: T('Greeks appear here once you add legs') });
      }
      return;
    }
    var legs = wiLegs(), last = lastLegDays();
    var price = syncWhatIfControls(last);
    var ivShift = wi.ivShift / 100;
    var o = wiOpts({ ivShift: ivShift });
    var now = opt.whatIf(legs, wiOpts({ S: lab.spot, daysForward: 0 }));
    var sc = opt.whatIf(legs, Object.assign({ S: price, daysForward: wi.days }, o));
    var atmIv = Math.max(0.01, ui.ivBase + ivShift);
    var range = opt.probRange(lab.spot, atmIv, Math.max(0, last));
    var pop = opt.probProfit(legs, lab.spot, atmIv, last, o);
    var popScen = wi.days > 0 && wi.days < last ? opt.probProfit(legs, lab.spot, atmIv, wi.days, o) : null;

    var html = '';
    var row = function (k, v, cls, tip) {
      html += '<span class="k">' + esc(k) + (tip ? '<button class="tip" type="button" aria-label="' + esc(T('Explain {label}', { label: k })) + '" data-tip="' + esc(tip) + '"></button>' : '') + '</span><span class="v ' + (cls || '') + '">' + v + '</span>';
    };
    row(T('Scenario'), esc(money(price) + ' · ' + wiDaysLabel(wi.days)) + (wi.ivShift ? ' · ' + esc(T('IV {s} pts', { s: (wi.ivShift > 0 ? '+' : '−') + Math.abs(wi.ivShift) })) : ''));
    row(T('Position value'), money(sc.value), '', T('What you could sell the whole position for in this scenario under the model (negative = what it would cost to buy back the short side).'));
    row(T('P&L'), signed(sc.pnl), pnlClass(sc.pnl) + ' big', T('Scenario value minus what the position cost to open (premiums paid or received).'));
    row(T('Change from now'), signed(sc.pnl - now.pnl), pnlClass(sc.pnl - now.pnl));
    row(T('Delta / gamma'), signed(sc.delta, 1).replace('$', '') + ' / ' + (sc.gamma < -5e-3 ? '−' : '') + Math.abs(sc.gamma).toFixed(2), '', T('Position delta in shares-equivalent and gamma per $1 move, in this scenario.'));
    row(T('Theta / day'), signed(sc.theta), pnlClass(sc.theta));
    row(T('Vega / IV pt'), signed(sc.vega), pnlClass(sc.vega));
    row(T('Chance of profit at expiry'), (pop * 100).toFixed(0) + '%', '', T('Model estimate: the stock follows a lognormal walk with no drift at the chosen implied volatility. Real markets have fatter tails, so treat it as a rough guide.'));
    if (popScen != null) row(T('Chance of profit {when}', { when: wiDaysLabel(wi.days) }), (popScen * 100).toFixed(0) + '%');
    row(T('68% range by expiry'), money(range.low1) + ' – ' + money(range.high1), '', T('About two times in three the stock finishes inside this range under the model (one standard deviation). It is symmetric in percentage terms, so the dollar move up is a little bigger than the move down.'));
    row(T('95% range by expiry'), money(range.low2) + ' – ' + money(range.high2));
    res.innerHTML = html;

    // warnings
    var exd = $('wi-exdiv').value === '' ? NaN : Number($('wi-exdiv').value);
    var dv = $('wi-div').value === '' ? NaN : Number($('wi-div').value);
    var ws = opt.warnings(legs, Object.assign({ S: price, daysForward: wi.days, exDividendDays: exd, dividend: dv }, o));
    warn.innerHTML = ws.map(function (w) {
      return '<div class="callout ' + (w.level === 'warn' ? 'warn' : 'tip') + ' compact"><div><span class="title">' + esc(w.title) + '</span>' + esc(w.message) + '</div></div>';
    }).join('');

    if ($('panel-options').hidden) return;
    var C = chartColors(), xr = priceRange();
    // keep the whole price-slider range (±30 %) on screen so the scenario marker never falls off the chart
    xr = { min: Math.max(0, Math.min(xr.min, lab.spot * 0.68)), max: Math.max(xr.max, lab.spot * 1.32) };
    var steps = 120;
    var dates = [0], mid = Math.round(last / 2);
    if (mid > 0 && mid < last) dates.push(mid);
    if (last > 0) dates.push(last);
    var scenarioOnLine = dates.some(function (d) { return Math.abs(d - wi.days) < 0.5 || (wi.days >= last && d === last); });
    if (!scenarioOnLine) dates.push(wi.days);
    var cs = opt.curves(legs, { min: xr.min, max: xr.max, steps: steps }, dates, o);
    var styleFor = function (c) {
      if (c.daysForward === 0) return { color: C.accent, dash: [5, 4], width: 1.6, cls: 'dash' };
      if (c.daysForward >= last) return { color: C.fg, dash: null, width: 2, cls: '' };
      if (!scenarioOnLine && c.daysForward === wi.days) return { color: C.s1, dash: null, width: 2, cls: '' };
      return { color: C.purple, dash: [1, 3], width: 1.8, cls: 'dot' };
    };
    var series = cs.map(function (c) { var st = styleFor(c); return { pts: c.points.map(function (p) { return { x: p.S, y: p.pnl }; }), color: st.color, dash: st.dash, width: st.width }; });
    plotLines($('wi-curves'), {
      xmin: xr.min, xmax: xr.max, series: series,
      yFmt: function (v) { return (v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v)).toLocaleString(loc()); },
      vline: { x: price, color: C.fg }, dot: { x: price, y: sc.pnl, color: sc.pnl >= 0 ? C.up : C.down }
    });
    legend.innerHTML = cs.map(function (c) {
      var st = styleFor(c);
      var name = c.daysForward === 0 ? T('Today') : c.daysForward >= last ? T('At expiration') : (!scenarioOnLine && c.daysForward === wi.days ? T('Scenario ({when})', { when: wiDaysLabel(wi.days) }) : T('In {n} days', { n: Math.round(c.daysForward) }));
      return '<span><i class="' + st.cls + '" style="color:' + esc(st.color) + '"></i>' + esc(name) + '</span>';
    }).join('');
    var atSpot = function (c) { var best = c.points[0]; c.points.forEach(function (p) { if (Math.abs(p.S - lab.spot) < Math.abs(best.S - lab.spot)) best = p; }); return best.pnl; };
    $('wi-curves').setAttribute('aria-label', T('Profit and loss by stock price at several dates.') + ' ' + cs.map(function (c) {
      return T('{when}: {pnl} if the stock stays at {spot}', { when: c.daysForward === 0 ? T('Today') : c.daysForward >= last ? T('At expiration') : T('In {n} days', { n: Math.round(c.daysForward) }), pnl: signed(atSpot(c)), spot: money(lab.spot) });
    }).join('; ') + '. ' + T('Scenario: {pnl} at {price} {when}.', { pnl: signed(sc.pnl), price: money(price), when: wiDaysLabel(wi.days) }));

    // greeks over price
    var gk = GREEK_NOTES[wi.greek] ? wi.greek : 'delta';
    var gc = opt.greeksCurve(legs, { min: xr.min, max: xr.max, steps: steps }, Object.assign({ daysForward: wi.days }, o));
    var gColor = { delta: C.accent, gamma: C.purple, theta: C.s1, vega: css('--teal') || C.accent }[gk];
    plotLines($('wi-greeks'), {
      xmin: xr.min, xmax: xr.max,
      series: [{ pts: gc.map(function (p) { return { x: p.S, y: p[gk] }; }), color: gColor, width: 2 }],
      yFmt: function (v, step) { return gk === 'gamma' ? v.toFixed(step < 0.1 ? 2 : 1) : (gk === 'delta' ? Math.round(v).toString() : (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(Math.abs(step) < 1 ? 1 : 0)); },
      vline: { x: price, color: C.fg }, dot: { x: price, y: sc[gk], color: gColor }
    });
    var gName = { delta: T('Delta'), gamma: T('Gamma'), theta: T('Theta'), vega: T('Vega') }[gk];
    var gVal = gk === 'gamma' ? sc.gamma.toFixed(3) : gk === 'delta' ? sc.delta.toFixed(1) : signed(sc[gk]);
    $('wi-greeks').setAttribute('aria-label', T('{greek} of the position across stock prices {when}; {value} at {price}.', { greek: gName, when: wiDaysLabel(wi.days), value: gVal, price: money(price) }));
    $('wi-greeks-note').textContent = T(GREEK_NOTES[gk]);
  }
  /** Prefill the ex-dividend inputs from the paper engine's (approximate) dividend schedule, unless the user typed. */
  function autoDividend() {
    var ex = $('wi-exdiv'), dv = $('wi-div'), note = $('wi-div-h');
    if (!ex || !dv) return;
    var userTyped = (ex.value !== '' && ex.dataset.auto !== '1') || (dv.value !== '' && dv.dataset.auto !== '1');
    if (userTyped) return;
    ex.value = ''; dv.value = ''; ex.dataset.auto = ''; dv.dataset.auto = '';
    if (note) note.textContent = T('Optional. Enter the next ex-dividend date to check whether a short call might be exercised early to collect the dividend.');
    var info = null;
    try { info = typeof paper.dividendInfo === 'function' ? paper.dividendInfo(lab.symbol) : null; } catch (e) { info = null; }
    if (!info || typeof paper.exDates !== 'function' || !isNum(lab.spot)) return;
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var today = new Date(), until = new Date(today.getTime() + 366 * 86400000);
    var next = (paper.exDates(info, iso(today), iso(until)) || [])[0];
    if (!next) return;
    var days = Math.max(0, Math.round((Date.parse(next + 'T12:00:00Z') - Date.now()) / 86400000));
    var per = lab.spot * info.yield / Math.max(1, info.months.length);
    ex.value = String(days); dv.value = per.toFixed(2); ex.dataset.auto = '1'; dv.dataset.auto = '1';
    if (note) note.textContent = T('Prefilled from the simulator\'s approximate dividend schedule for {sym} (next ex-date {date}, about {yield}% a year). Edit or clear them to test other dates.', { sym: lab.symbol, date: next, yield: (info.yield * 100).toFixed(2) });
  }
  (function initWhatIf() {
    if (!$('whatif')) return;
    var raf = null;
    var redraw = function () { if (raf) return; raf = (window.requestAnimationFrame || setTimeout)(function () { raf = null; renderWhatIf(); }); };
    $('wi-price').addEventListener('input', function () { var v = Number($('wi-price').value); wi.price = isNum(v) && isNum(lab.spot) && Math.abs(v - lab.spot) > 1e-9 ? v : null; redraw(); });
    $('wi-days').addEventListener('input', function () { wi.days = Math.max(0, Math.round(Number($('wi-days').value) || 0)); redraw(); });
    $('wi-iv').addEventListener('input', function () { wi.ivShift = Math.round(Number($('wi-iv').value) || 0); redraw(); });
    ['wi-exdiv', 'wi-div'].forEach(function (id) { $(id).addEventListener('input', function () { $(id).dataset.auto = ''; redraw(); }); });
    $('wi-reset').onclick = function () { wi.price = null; wi.days = 0; wi.ivShift = 0; renderWhatIf(); };
    document.querySelectorAll('[data-greek]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.greek === wi.greek ? 'true' : 'false');
      b.onclick = function () {
        wi.greek = b.dataset.greek; ui.wiGreek = wi.greek; saveUi();
        document.querySelectorAll('[data-greek]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        renderWhatIf();
      };
    });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(redraw);
      ['wi-curves', 'wi-greeks'].forEach(function (id) { ro.observe($(id).parentElement); });
    } else window.addEventListener('resize', redraw);
  })();

  /* ---------------- lab controls ---------------- */
  (function fillPresets() {
    var sel = $('preset');
    opt.strategyList().forEach(function (s) {
      var o = document.createElement('option'); o.value = s.id; o.textContent = s.name + ' · ' + s.outlook; sel.appendChild(o);
    });
    sel.onchange = function () { if (sel.value) loadPreset(sel.value); };
  })();
  $('opt-sym').value = ui.labSymbol || 'AAPL';
  $('opt-load').onclick = function () { var s = $('opt-sym').value.trim().toUpperCase(); if (!s) return; $('opt-sym').value = s; $('chain').dataset.scrolled = ''; loadLab(s); };
  $('opt-sym').onkeydown = function (e) { if (e.key === 'Enter') $('opt-load').click(); };
  $('opt-iv').value = Math.round((ui.ivBase || 0.25) * 100);
  $('opt-ivv').textContent = $('opt-iv').value + '%';
  var ivTimer = null;
  $('opt-iv').oninput = function () {
    ui.ivBase = Number($('opt-iv').value) / 100; $('opt-ivv').textContent = $('opt-iv').value + '%'; saveUi();
    clearTimeout(ivTimer); ivTimer = setTimeout(function () { if (lab.rows) { buildChain(); renderChain(); renderLegs(); } mtm = paper.markToMarket(pricesFromMarks()); renderTiles(); renderPositions(); }, 120);
  };
  $('legs-clear').onclick = function () { lab.legs = []; lab.preset = null; $('preset').value = ''; $('preset-desc').hidden = true; renderLegs(); };

  $('trade').onclick = function () {
    if (!lab.legs.length) { setMsg('trade-msg', 'Add at least one leg first.', 'err'); return; }
    var lots = Math.max(1, Math.min(50, Math.round(Number($('lots').value) || 1)));
    var ok = [], bad = [];
    // League accounts: check every leg against the league's rules before anything fills.
    var refused = null;
    lab.legs.some(function (l) {
      var chk = leagueCheck({ symbol: l.right === 'S' ? lab.symbol : l.contract, contract: l.right === 'S' ? undefined : l.contract, kind: l.right === 'S' ? undefined : 'option', side: l.qty > 0 ? 'buy' : 'sell', qty: Math.abs(l.qty) * lots, price: l.right === 'S' ? lab.spot : l.premium });
      if (!chk.ok) { refused = legLabel(l).replace(/<[^>]+>/g, '') + ': ' + chk.reason; return true; }
      return false;
    });
    if (refused) { setMsg('trade-msg', refused, 'err'); return; }
    // Buys first so that cash and margin checks see the long legs that cover the shorts (e.g. covered call).
    var ordered = lab.legs.slice().sort(function (a, b) { return (b.qty > 0) - (a.qty > 0); });
    ordered.forEach(function (l) {
      var qty = Math.abs(l.qty) * lots, side = l.qty > 0 ? 'buy' : 'sell';
      var o;
      if (l.right === 'S') o = paper.placeOrder({ symbol: lab.symbol, side: side, qty: qty, type: 'market' }, lab.spot);
      else o = paper.placeOptionOrder({ contract: l.contract, side: side, qty: qty }, l.premium);
      (o.status === 'filled' ? ok : bad).push({ leg: l, order: o });
    });
    if (ok.length) { toast(T(ok.length === 1 ? '{n} leg filled' : '{n} legs filled', { n: ok.length }) + (bad.length ? ', ' + T('{n} rejected', { n: bad.length }) : '') + '. ' + T('Track it under Positions; the marks update with the model each refresh.'), bad.length ? 'warn' : 'ok', 'Strategy placed'); }
    if (bad.length) setMsg('trade-msg', bad.map(function (b) { return legLabel(b.leg).replace(/<[^>]+>/g, '') + ': ' + b.order.reason; }).join(' '), 'err');
    else setMsg('trade-msg', 'Filled ' + ok.length + ' leg' + (ok.length === 1 ? '' : 's') + ' × ' + lots + ' lot' + (lots === 1 ? '' : 's') + '. Net ' + (function () { var n = ok.reduce(function (s, b) { return s + (b.order.side === 'buy' ? -1 : 1) * b.order.fillPrice * b.order.qty * (b.order.kind === 'option' ? 100 : 1); }, 0); return (n < 0 ? 'debit ' : 'credit ') + money(Math.abs(n)); })() + '.', 'ok');
    mtm = paper.markToMarket(pricesFromMarks()); renderAll();
  };

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  $('refresh').onclick = function () { refreshMarks(true); };
  initEquityChart();
  if (!applyHash()) switchTab(ui.tab || 'positions', true);
  // Paint immediately from saved marks, then fetch fresh quotes.
  mtm = null;
  renderAll();
  refreshMarks(false);
  setInterval(renderHeader, 30000); // keep the market clock pill current

  BT.portfolioPage = {
    onThemeChange: function () { restyleEquityChart(); drawPayoff(); renderWhatIf(); },
    switchAccount: switchAccount,
    get whatIf() { return wi; },
    refresh: function () { return refreshMarks(true); },
    switchTab: switchTab,
    get lab() { return lab; },
    get marks() { return marks; }
  };
})();
