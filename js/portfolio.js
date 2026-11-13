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
    var s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v < 0 ? '−$' : '$') + s;
  }
  function signed(v, dp) {
    if (!isNum(v)) return '—';
    if (v === Infinity) return 'Unlimited';
    if (v === -Infinity) return 'Unlimited';
    dp = dp == null ? 2 : dp;
    var s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (v > 0 ? '+$' : v < 0 ? '−$' : '$') + s;
  }
  function pct(v, dp) {
    if (!isNum(v)) return '—';
    dp = dp == null ? 2 : dp;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
  }
  function plain(v, dp) { return isNum(v) ? v.toLocaleString(undefined, { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }) : '—'; }
  function pnlClass(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function fmtTime(t) {
    if (!isNum(t)) return '—';
    var ms = t < 1e11 ? t * 1000 : t; // accept unix seconds or ms
    var d = new Date(ms), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
   * Tabs with hash routing: #positions #history #options #settings
   *   #options/TSLA opens the lab on TSLA.
   * ------------------------------------------------------------------ */
  var TABS = ['positions', 'history', 'options', 'settings'];
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
    if (name === 'options') { ensureLab(); drawPayoff(); }
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
      rp.title = lastMarkAt ? 'Positions last marked at ' + new Date(lastMarkAt).toLocaleTimeString() + '. Auto-refresh every ' + Math.round(refreshIntervalMs() / 1000) + ' s while this tab is visible.' : 'Not yet marked';
    }
  }

  function renderTiles() {
    var st = paper.state;
    var v = mtm || Object.assign({ equity: st.cash + paper.valuation({}).marketValue, cash: st.cash, realized: st.realized, unrealized: paper.valuation({}).unrealized, dayPnL: 0 }, {});
    var equity = v.equity, total = equity - st.startingCash, totalPct = st.startingCash ? total / st.startingCash * 100 : 0;
    $('t-equity').textContent = money(equity);
    $('t-equity-sub').textContent = st.createdAt ? T('Started with {cash} on {date}', { cash: money(st.startingCash, 0), date: new Date(st.createdAt).toLocaleDateString() }) : T('Started with {cash}', { cash: money(st.startingCash, 0) });
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
      priceFormat: { type: 'custom', minMove: 1, formatter: function (p) { return '$' + Math.round(p).toLocaleString(); } }
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
        '<td class="num right">' + Math.abs(r.qty).toLocaleString() + (r.kind === 'option' ? ' ct' : '') + '</td>' +
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
    var T = daysForLegs() / opt.DAYS_PER_YEAR;
    var showT0 = $('show-t0').checked && T > 0;
    var t0 = showT0 ? pts.map(function (p) { return { S: p.S, pnl: t0Value(p.S, legsN, T) }; }) : [];
    var ys = pts.map(function (p) { return p.pnl; }).concat(t0.map(function (p) { return p.pnl; }), [0]);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (ymax - ymin < 1) { ymax += 50; ymin -= 50; }
    var pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
    var L = 62, R = 14, Tp = 16, B = 28, pw = W - L - R, ph = H - Tp - B;
    var X = function (s) { return L + (s - xmin) / (xmax - xmin) * pw; };
    var Y = function (v) { return Tp + (ymax - v) / (ymax - ymin) * ph; };
    var zeroY = Y(0);

    // grid + axes
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ystep = niceStep(ymax - ymin, 5);
    for (var v = Math.ceil(ymin / ystep) * ystep; v <= ymax; v += ystep) {
      var yy = Y(v); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.fillText((v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v)).toLocaleString(), L - 6, yy);
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
      var now = showT0 ? t0Value(S, legsN, T) : null;
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
  $('show-t0').onchange = function () { ui.showT0 = $('show-t0').checked; saveUi(); drawPayoff(); };

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
    onThemeChange: function () { restyleEquityChart(); drawPayoff(); },
    refresh: function () { return refreshMarks(true); },
    switchTab: switchTab,
    get lab() { return lab; },
    get marks() { return marks; }
  };
})();
