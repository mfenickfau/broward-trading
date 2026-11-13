/* Broward Trading — js/builder-ui.js → BT.builderPage
 *
 * UI for builder.html, the no-code Strategy Builder. The engine lives in
 * js/rules.js (BT.rules); this file only renders the block editor, the live
 * plain-English summary, an inline backtest (BT.backtest + a compact
 * lightweight-charts chart, since js/backtest-ui.js exposes no reusable chart
 * function), "Create alert from entry rule" (BT.alerts kind 'rule'), saved
 * rules (bt.rules) and JSON export / import.
 *
 * Deep link: builder.html#template=rsiReversion
 * Depends on: BT.rules (required); BT.backtest, BT.data, BT.ind, BT.alerts,
 * LightweightCharts (each optional: the page degrades with a message).
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;
  function T(s, v) { var tf = (window.BT && window.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }
  var R = BT.rules;

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function round(x, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(x * p) / p; }
  function money(x, d) {
    if (!isNum(x)) return '—';
    if (BT.i18n && BT.i18n.fmtMoney) return BT.i18n.fmtMoney(x, { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
    return (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function pct(x, d) { if (!isNum(x)) return '—'; var s = round(x, d == null ? 1 : d); return (s > 0 ? '+' : '') + s.toFixed(d == null ? 1 : d) + '%'; }
  function fmtTime(t) {
    if (typeof t === 'string') return t;
    if (!isNum(t)) return '—';
    try { return new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return String(t); }
  }
  function lang() { try { return BT.i18n && BT.i18n.lang ? BT.i18n.lang() : 'en'; } catch (e) { return 'en'; } }
  function announce(text) { try { if (BT.a11y && BT.a11y.announce) BT.a11y.announce(text); } catch (e) { /* optional */ } }
  function toast(msg, kind, title) {
    if (BT.nav && BT.nav.toast) return BT.nav.toast(msg, kind, title);
    var host = $('toasts'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = (title ? title + ' — ' : '') + msg;
    host.appendChild(el); setTimeout(function () { el.remove(); }, 4500);
  }
  function setMsg(id, text, kind) { var m = $(id); if (!m) return; m.textContent = text || ''; m.className = 'msg ' + (kind || ''); }
  var store = {
    get: function (k) { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } },
    set: function (k, v) { try { if (window.localStorage) localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  if (!R) {
    var m = document.querySelector('main');
    if (m) m.insertAdjacentHTML('afterbegin', '<div class="callout danger"><span class="txt">' + esc(T('The strategy builder engine (js/rules.js) did not load. Reload the page.')) + '</span></div>');
    return;
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var rule = null;          // the rule being edited (normalised shape, may have id)
  var templateId = null;    // template it came from, for the highlighted button
  var lastBars = null, lastResult = null, lastInfo = null, lastSymbol = null;
  var charts = { price: null, equity: null };

  var PARAM_LABEL = { n: 'Length', k: 'Std devs', fast: 'Fast', slow: 'Slow', signal: 'Signal' };

  function defaultValueFor(other) {
    var def = R.OPERANDS[other.ind] || {};
    if (def.scale === 'osc') return 50;
    if (def.scale === 'macd') return 0;
    if (def.scale === 'volume') return 1000000;
    if (lastBars && lastBars.length) return round(lastBars[lastBars.length - 1].close, 2);
    return 100;
  }
  function freshOperand(ind, other) {
    var def = R.OPERANDS[ind], o = { ind: ind, params: JSON.parse(JSON.stringify(def.params || {})) };
    if (ind === 'value') o.value = defaultValueFor(other || { ind: 'close' });
    return o;
  }

  /* ------------------------------------------------------------------ *
   * Rendering: templates
   * ------------------------------------------------------------------ */
  function renderTemplates() {
    $('tplList').innerHTML = R.templates.map(function (t) {
      return '<button type="button" class="tpl' + (templateId === t.id ? ' on' : '') + '" data-tpl="' + esc(t.id) + '" aria-pressed="' + (templateId === t.id) + '"><span class="nm">' + esc(T(t.name)) + '</span><span class="ds">' + esc(T(t.blurb)) + '</span></button>';
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * Rendering: condition blocks
   * ------------------------------------------------------------------ */
  function operandOptions(sel) {
    return R.operands.map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(T(R.OPERANDS[k].label)) + '</option>'; }).join('');
  }
  function cmpOptions(sel) {
    return R.cmps.map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(T(R.CMPS[k].label)) + '</option>'; }).join('');
  }
  function operandHTML(block, i, side, o) {
    var base = block + '-' + i + '-' + side;
    var label = side === 'left' ? T('Measure') : T('Compared with');
    var h = '<div class="opnd"><div class="field"><label for="' + base + '-ind">' + esc(label) + '</label><select id="' + base + '-ind" data-role="ind" data-side="' + side + '">' + operandOptions(o.ind) + '</select></div>';
    var params = [];
    if (o.ind === 'value') {
      params.push('<div class="field"><label for="' + base + '-value">' + esc(T('Number')) + '</label><input type="text" inputmode="decimal" id="' + base + '-value" data-role="value" data-side="' + side + '" value="' + esc(o.value) + '" autocomplete="off"></div>');
    } else {
      Object.keys(o.params || {}).forEach(function (k) {
        params.push('<div class="field"><label for="' + base + '-' + k + '">' + esc(T(PARAM_LABEL[k] || k)) + '</label><input type="number" inputmode="' + (k === 'k' ? 'decimal' : 'numeric') + '" step="' + (k === 'k' ? '0.5' : '1') + '" min="' + (k === 'k' ? '0.5' : '1') + '" id="' + base + '-' + k + '" data-role="param" data-param="' + k + '" data-side="' + side + '" value="' + esc(o.params[k]) + '"></div>');
      });
    }
    if (params.length) h += '<div class="params">' + params.join('') + '</div>';
    return h + '</div>';
  }
  function condHTML(block, c, i, n) {
    var blockName = block === 'entry' ? T('Entry') : T('Exit');
    return '<li class="cond" data-block="' + block + '" data-idx="' + i + '">' +
      '<div class="cond-head"><span class="cond-n">' + esc(T('Condition {n}', { n: i + 1 })) + '</span>' +
      (n > 1 || block === 'exit' ? '<button type="button" class="ghost sm" data-role="remove" aria-label="' + esc(T('Remove {block} condition {n}', { block: blockName.toLowerCase(), n: i + 1 })) + '">' + esc(T('Remove')) + '</button>' : '') + '</div>' +
      '<div class="cond-grid">' + operandHTML(block, i, 'left', c.left) +
      '<div class="field"><label for="' + block + '-' + i + '-cmp">' + esc(T('Comparison')) + '</label><select id="' + block + '-' + i + '-cmp" data-role="cmp">' + cmpOptions(c.cmp) + '</select></div>' +
      operandHTML(block, i, 'right', c.right) + '</div>' +
      '<p class="cond-say" id="' + block + '-' + i + '-say">' + esc(R.describeCondition(c, lang())) + '</p></li>';
  }
  function renderBlock(block) {
    var b = rule[block], list = $(block + 'List'), joinWord = b.op === 'or' ? T('OR') : T('AND');
    var parts = [];
    b.conditions.forEach(function (c, i) {
      if (i) parts.push('<li class="joiner" aria-hidden="true">' + esc(joinWord) + '</li>');
      parts.push(condHTML(block, c, i, b.conditions.length));
    });
    if (!b.conditions.length) parts.push('<li class="muted">' + esc(block === 'exit' ? T('No exit conditions: the risk exits below decide when to get out.') : T('No entry conditions yet. Add one to start.')) + '</li>');
    list.innerHTML = parts.join('');
    $(block + 'Op').value = b.op;
    $(block + 'Add').disabled = b.conditions.length >= R.MAX_CONDITIONS;
  }
  function renderForm() {
    $('ruleName').value = rule.name;
    $('ruleSide').value = rule.side;
    ['stopPct', 'targetPct', 'trailingPct', 'maxBars'].forEach(function (k) { $(k).value = rule.exit[k] == null ? '' : rule.exit[k]; });
    renderBlock('entry'); renderBlock('exit');
    renderTemplates();
    refresh();
  }

  /* ------------------------------------------------------------------ *
   * Summary, validation, draft
   * ------------------------------------------------------------------ */
  function currentRule() { return JSON.parse(JSON.stringify(rule)); }
  function refresh() {
    var errs = R.validate(rule), warns = errs.length ? [] : R.warnings(rule);
    $('summary').textContent = R.describe(rule, lang());
    $('problems').innerHTML = errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
    $('advice').innerHTML = warns.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
    ['entry', 'exit'].forEach(function (block) {
      rule[block].conditions.forEach(function (c, i) { var p = $(block + '-' + i + '-say'); if (p) p.textContent = R.describeCondition(c, lang()); });
    });
    $('btRun').disabled = !!errs.length;
    $('alertBtn').disabled = !!errs.length;
    $('saveBtn').disabled = !!errs.length;
    R.setDraft(rule);
  }
  function setRule(r, tplId) {
    rule = R.normalize(r);
    if (r && r.id) rule.id = r.id;
    templateId = tplId || null;
    renderForm();
  }

  /* ------------------------------------------------------------------ *
   * Editing (event delegation)
   * ------------------------------------------------------------------ */
  function condFrom(el) {
    var li = el.closest('.cond'); if (!li) return null;
    var block = li.getAttribute('data-block'), i = +li.getAttribute('data-idx');
    return { block: block, i: i, c: rule[block].conditions[i] };
  }
  function focusId(id) { var el = $(id); if (el) el.focus(); }
  function onListChange(e) {
    var t = e.target, ref = condFrom(t); if (!ref || !ref.c) return;
    var role = t.getAttribute('data-role'), side = t.getAttribute('data-side');
    templateId = null;
    if (role === 'ind') {
      var other = side === 'left' ? ref.c.right : ref.c.left;
      var oldScale = R.OPERANDS[ref.c[side].ind].scale;
      ref.c[side] = freshOperand(t.value, other);
      // the number on the other side belonged to the old scale (e.g. RSI 30): pick a sensible one for the new scale
      if (other.ind === 'value' && t.value !== 'value' && R.OPERANDS[t.value].scale !== oldScale) other.value = defaultValueFor(ref.c[side]);
      // a number compared with a number never changes: switch the other side to the close
      if (t.value === 'value' && other.ind === 'value') ref.c[side === 'left' ? 'right' : 'left'] = freshOperand('close');
      renderBlock(ref.block); renderTemplates(); focusId(t.id); refresh();
    } else if (role === 'cmp') {
      ref.c.cmp = t.value; refresh();
    } else if (role === 'param' || role === 'value') {
      readNumberInput(t, ref, role, side);
      if (e.type === 'change') { var o = ref.c[side]; if (role === 'param') t.value = o.params[t.getAttribute('data-param')]; }
      refresh();
    }
  }
  function readNumberInput(t, ref, role, side) {
    var o = ref.c[side], raw = String(t.value).replace(',', '.').trim(), n = parseFloat(raw);
    if (role === 'value') { o.value = isNum(n) ? n : raw; return; }   // a non-number shows up as a validation error
    var key = t.getAttribute('data-param');
    if (isNum(n)) {
      var norm = R.normalize({ entry: { conditions: [{ left: Object.assign({}, o, { params: Object.assign({}, o.params, (function () { var x = {}; x[key] = n; return x; })()) }), cmp: '>', right: { ind: 'value', value: 0 } }] } });
      o.params = norm.entry.conditions[0].left.params;
    }
  }
  function onListClick(e) {
    var btn = e.target.closest('button[data-role="remove"]'); if (!btn) return;
    var ref = condFrom(btn); if (!ref) return;
    rule[ref.block].conditions.splice(ref.i, 1);
    templateId = null;
    renderBlock(ref.block); renderTemplates(); refresh();
    var next = $(ref.block + '-' + Math.max(0, ref.i - 1) + '-left-ind') || $(ref.block + 'Add');
    if (next) next.focus();
    announce(T('Condition removed.'));
  }
  function addCondition(block) {
    var b = rule[block]; if (b.conditions.length >= R.MAX_CONDITIONS) return;
    var c = block === 'entry'
      ? { left: freshOperand('close'), cmp: '>', right: freshOperand('sma') }
      : { left: freshOperand('close'), cmp: 'crossesBelow', right: freshOperand('sma') };
    b.conditions.push(R.normalize({ entry: { conditions: [c] } }).entry.conditions[0]);
    templateId = null;
    renderBlock(block); renderTemplates(); refresh();
    focusId(block + '-' + (b.conditions.length - 1) + '-left-ind');
    announce(T('Condition {n} added.', { n: b.conditions.length }));
  }

  /* ------------------------------------------------------------------ *
   * Backtest
   * ------------------------------------------------------------------ */
  function renderSource(info) {
    var pill = $('pillSource'); if (!pill) return;
    var live = info && info.live && !info.fallback;
    pill.className = 'pill ' + (live ? 'live' : 'demo');
    var label = info && BT.data && BT.data.PROVIDER_LABEL && BT.data.PROVIDER_LABEL[info.source] || (info && info.source) || '';
    pill.textContent = live ? T('live · {provider}', { provider: label }) : T('demo data');
  }
  async function loadBars(sym, tf, n) {
    var D = BT.data, res;
    if (!D) throw new Error(T('Price data (js/data.js) did not load.'));
    try { res = await D.candles(sym, tf, n); }
    catch (e) { res = D.demo(sym, tf, n); res.fallback = true; res.reason = (e && e.message) || T('Data error'); }
    var info = { source: res.source || 'demo', live: !!res.live, fallback: !!res.fallback, reason: res.reason };
    var arr = Array.prototype.slice.call(res).filter(function (b) { return b && isNum(b.open) && isNum(b.high) && isNum(b.low) && isNum(b.close); });
    return { bars: arr, info: info };
  }
  function costs() {
    var cash = parseFloat($('btCash').value), comm = parseFloat($('btComm').value), slip = parseFloat($('btSlip').value);
    return { cash: isNum(cash) && cash >= 100 ? cash : 100000, commission: isNum(comm) && comm >= 0 ? comm : 0, slippageBps: isNum(slip) && slip >= 0 ? Math.min(slip, 500) : 0 };
  }
  async function runBacktest() {
    if (!BT.backtest) { setMsg('btStatus', T('The backtest engine (js/backtest.js) did not load.'), 'err'); return; }
    var errs = R.validate(rule);
    if (errs.length) { setMsg('btStatus', errs[0], 'err'); return; }
    var sym = (BT.data && BT.data.normSymbol ? BT.data.normSymbol($('btSymbol').value) : String($('btSymbol').value).trim().toUpperCase()) || 'AAPL';
    $('btSymbol').value = sym;
    var tf = $('btInterval').value, n = +$('btBars').value || 500;
    $('btRun').disabled = true;
    setMsg('btStatus', T('Loading {n} bars of {symbol}…', { n: n, symbol: sym }), '');
    try {
      var loaded = await loadBars(sym, tf, n);
      if (loaded.bars.length < 30) throw new Error(T('Only {n} bars came back for {symbol}; a backtest needs more history.', { n: loaded.bars.length, symbol: sym }));
      var c = costs();
      var res = R.backtest(rule, loaded.bars, c);
      if (res.error) throw new Error(res.error);
      lastBars = loaded.bars; lastResult = res; lastInfo = loaded.info; lastSymbol = sym;
      store.set('bt.builder.last', JSON.stringify({ symbol: sym, interval: tf, bars: n }));
      renderSource(loaded.info);
      renderResults(c);
      var s = res.stats;
      setMsg('btStatus', T('Done: {trades} trades, strategy {ret} vs buy-and-hold {bh}.', { trades: s.trades, ret: pct(s.totalReturnPct), bh: pct(s.buyHoldReturnPct) }), 'ok');
    } catch (e) {
      setMsg('btStatus', (e && e.message) || T('The backtest failed.'), 'err');
    } finally {
      $('btRun').disabled = !!R.validate(rule).length;
    }
  }

  function tile(label, value, cls, sub) {
    return '<div class="stat"><span class="label">' + esc(label) + '</span><span class="value ' + (cls || '') + '">' + esc(value) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</div>';
  }
  function tone(x) { return !isNum(x) ? '' : x > 0 ? 'up' : x < 0 ? 'down' : ''; }
  function renderResults(c) {
    var res = lastResult, s = res.stats, bars = lastBars;
    $('btResults').hidden = false;
    var warn = [];
    if (lastInfo && lastInfo.fallback) warn.push(T('Live data was unavailable ({reason}), so these are simulated demo prices.', { reason: lastInfo.reason || T('no key') }));
    else if (!lastInfo || !lastInfo.live) warn.push(T('Demo prices: a simulated random walk, the same for every student. Good for practice, not evidence about the real stock.'));
    if (res.pendingSignal) warn.push(T('The rule fired on the very last bar; that order would fill at the next open, which has not happened yet.'));
    $('btWarn').hidden = !warn.length;
    $('btWarn').querySelector('.txt').textContent = warn.join(' ');
    $('btTiles').innerHTML = [
      tile(T('Strategy return'), pct(s.totalReturnPct), tone(s.totalReturnPct), money(s.finalEquity, 0)),
      tile(T('Buy and hold'), pct(s.buyHoldReturnPct), tone(s.buyHoldReturnPct), T('same period, no costs')),
      tile(T('Trades'), String(s.trades), '', s.exposurePct != null ? T('{pct}% of bars in a trade', { pct: round(s.exposurePct, 0) }) : ''),
      tile(T('Win rate'), s.winRate == null ? '—' : round(s.winRate, 0) + '%', '', ''),
      tile(T('Max drawdown'), s.maxDrawdownPct == null ? '—' : '−' + round(Math.abs(s.maxDrawdownPct), 1) + '%', 'down', T('worst peak-to-trough fall')),
      tile(T('Profit factor'), s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : round(s.profitFactor, 2).toFixed(2), '', T('gross wins ÷ gross losses'))
    ].join('');
    var coach = BT.backtest.explain ? BT.backtest.explain(res) : [];
    $('btCoach').innerHTML = coach.map(function (t) { return '<li>' + esc(T(t)) + '</li>'; }).join('');
    renderTrades(res.trades);
    $('btFoot').textContent = T('{n} bars from {from} to {to}. Fills at the next bar\'s open; {comm} commission per fill and {slip} bps slippage. Past results do not predict future results.', {
      n: bars.length, from: fmtTime(bars[0].time), to: fmtTime(bars[bars.length - 1].time), comm: money(c.commission), slip: c.slippageBps
    });
    drawCharts();
  }
  function renderTrades(trades) {
    var tb = $('btTrades').querySelector('tbody');
    if (!trades.length) { tb.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:left">' + esc(T('No trades: the entry conditions never all lined up on this data. Try a longer history, another symbol or looser numbers.')) + '</td></tr>'; return; }
    var shown = trades.slice(-50);
    var offset = trades.length - shown.length;
    var L = { n: T('#'), side: T('Side'), entry: T('Entry'), entryPx: T('Entry price'), exit: T('Exit'), exitPx: T('Exit price'), pnl: T('P&L'), bars: T('Bars') };
    tb.innerHTML = shown.map(function (t, k) {
      return '<tr><td data-label="' + esc(L.n) + '">' + (offset + k + 1) + '</td><td data-label="' + esc(L.side) + '">' + esc(t.side === 'short' ? T('Short') : T('Long')) + '</td>' +
        '<td data-label="' + esc(L.entry) + '">' + esc(fmtTime(t.entryTime)) + '</td><td data-label="' + esc(L.entryPx) + '">' + esc(money(t.entry)) + '</td>' +
        '<td data-label="' + esc(L.exit) + '">' + esc(fmtTime(t.exitTime)) + (t.openAtEnd ? ' *' : '') + '</td><td data-label="' + esc(L.exitPx) + '">' + esc(money(t.exit)) + '</td>' +
        '<td data-label="' + esc(L.pnl) + '" class="' + tone(t.pnl) + '">' + esc(pct(t.pnlPct)) + '</td><td data-label="' + esc(L.bars) + '">' + t.bars + '</td></tr>';
    }).join('') + (trades.some(function (t) { return t.openAtEnd; }) ? '<tr><td colspan="8" class="muted" style="text-align:left;font-family:var(--font)">' + esc(T('* still open on the last bar; valued at the last close.')) + '</td></tr>' : '') +
      (offset ? '<tr><td colspan="8" class="muted" style="text-align:left;font-family:var(--font)">' + esc(T('Showing the last {n} of {total} trades.', { n: shown.length, total: trades.length })) + '</td></tr>' : '');
  }

  /* ------------------------------------------------------------------ *
   * Compact chart (price + markers + rule overlays, and an equity pane)
   * ------------------------------------------------------------------ */
  var OVERLAY_COLORS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'];
  function chartTheme(intraday) {
    return {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--muted'), fontFamily: css('--mono') },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: !!intraday, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScale: { axisPressedMouseMove: true }
    };
  }
  function destroyCharts() {
    ['price', 'equity'].forEach(function (k) { if (charts[k]) { try { charts[k].remove(); } catch (e) { /* gone */ } charts[k] = null; } });
  }
  function toLine(bars, values) {
    var out = [];
    for (var i = 0; i < bars.length; i++) if (isNum(values[i])) out.push({ time: bars[i].time, value: values[i] });
    return out;
  }
  function drawCharts() {
    var LW = window.LightweightCharts, bars = lastBars, res = lastResult;
    var priceEl = $('btChart'), eqEl = $('btEquity');
    destroyCharts();
    priceEl.innerHTML = ''; eqEl.innerHTML = '';
    if (!LW || !bars) {
      priceEl.innerHTML = '<p class="muted" style="padding:12px">' + esc(T('The chart library did not load, so only the numbers are shown.')) + '</p>';
      eqEl.hidden = true; $('btLegend').innerHTML = ''; $('btEqLegend').innerHTML = '';
      return;
    }
    eqEl.hidden = false;
    var intraday = typeof bars[0].time === 'number';
    var pc = LW.createChart(priceEl, chartTheme(intraday));
    charts.price = pc;
    var candles = pc.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down'), borderVisible: false });
    candles.setData(bars.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
    var legend = [];
    R.overlays(rule).forEach(function (ov, k) {
      var color = css(OVERLAY_COLORS[k % OVERLAY_COLORS.length]);
      var s = pc.addLineSeries({ color: color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(toLine(bars, R.series(bars, ov.operand)));
      legend.push('<span><span class="sw" style="background:' + color + '"></span>' + esc(R.operandText(ov.operand, lang())) + '</span>');
    });
    candles.setMarkers(res.markers || []);
    legend.push('<span>▲ ' + esc(rule.side === 'short' ? T('short entry') : T('entry')) + '</span><span>▼ ' + esc(T('exit (colour = profit or loss)')) + '</span>');
    $('btLegend').innerHTML = legend.join('');
    pc.timeScale().fitContent();

    var ec = LW.createChart(eqEl, chartTheme(intraday));
    charts.equity = ec;
    var eq = ec.addLineSeries({ color: css('--accent'), lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    eq.setData(res.equity.filter(Boolean).map(function (e) { return { time: e.time, value: round(e.equity, 2) }; }));
    if (BT.backtest.buyHoldEquity) {
      var bh = ec.addLineSeries({ color: css('--muted'), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      bh.setData(BT.backtest.buyHoldEquity(bars, res.stats.startCash || costs().cash).map(function (e) { return { time: e.time, value: round(e.equity, 2) }; }));
    }
    ec.timeScale().fitContent();
    $('btEqLegend').innerHTML = '<span><span class="sw" style="background:' + css('--accent') + '"></span>' + esc(T('Rule equity')) + '</span><span><span class="sw dash"></span>' + esc(T('Buy and hold')) + '</span>';
    // keep the two time scales together
    var syncing = false;
    function link(a, b) { a.timeScale().subscribeVisibleLogicalRangeChange(function (r) { if (syncing || !r) return; syncing = true; try { b.timeScale().setVisibleLogicalRange(r); } catch (e) { /* no data */ } syncing = false; }); }
    link(pc, ec); link(ec, pc);

    if (BT.a11y && BT.a11y.describeChart) {
      var s = res.stats, last = bars[bars.length - 1];
      BT.a11y.describeChart(priceEl, T('{symbol} candlestick chart with the rule\'s trades: {n} bars, last close {close}, {trades} trades, rule return {ret} versus buy-and-hold {bh}.', { symbol: lastSymbol, n: bars.length, close: money(last.close), trades: s.trades, ret: pct(s.totalReturnPct), bh: pct(s.buyHoldReturnPct) }));
      var eqVars = { start: money(s.startCash, 0), end: money(s.finalEquity, 0), dd: s.maxDrawdownPct == null ? '—' : round(Math.abs(s.maxDrawdownPct), 1) + '%' };
      BT.a11y.describeChart(eqEl, s.finalEquity < s.startCash ? T('Equity curve: {start} fell to {end}; maximum drawdown {dd}.', eqVars) : T('Equity curve: {start} grew to {end}; maximum drawdown {dd}.', eqVars));
    } else {
      priceEl.setAttribute('role', 'img');
      priceEl.setAttribute('aria-label', T('{symbol} price chart with the rule\'s trades', { symbol: lastSymbol }));
    }
  }

  /* ------------------------------------------------------------------ *
   * Save, alert, saved list
   * ------------------------------------------------------------------ */
  function renderSaved() {
    var list = R.list();
    $('savedEmpty').hidden = !!list.length;
    $('savedList').innerHTML = list.slice().reverse().map(function (r) {
      return '<li><button type="button" class="pick" data-load="' + esc(r.id) + '"><span class="nm">' + esc(r.name) + '</span><span class="ds">' + esc(R.describe(r, lang())) + '</span></button>' +
        '<button type="button" class="rm" data-del="' + esc(r.id) + '" aria-label="' + esc(T('Delete saved rule {name}', { name: r.name })) + '" title="' + esc(T('Delete')) + '">✕</button></li>';
    }).join('');
  }
  function saveRule() {
    var res = R.save(rule);
    if (!res.ok) { setMsg('useMsg', res.errors[0], 'err'); return; }
    rule.id = res.rule.id;
    setMsg('useMsg', T('Saved "{name}". Load it any time from Saved rules.', { name: res.rule.name }), 'ok');
    renderSaved(); refresh();
  }
  function createAlert() {
    if (!BT.alerts) { setMsg('useMsg', T('Alerts (js/alerts.js) did not load.'), 'err'); return; }
    var sym = (BT.data && BT.data.normSymbol ? BT.data.normSymbol($('btSymbol').value) : String($('btSymbol').value).trim().toUpperCase());
    if (!sym) { setMsg('useMsg', T('Type a symbol in the Backtest box first.'), 'err'); $('btSymbol').focus(); return; }
    var a = BT.alerts.add({ symbol: sym, kind: 'rule', rule: currentRule() });
    if (a.status === 'rejected') { setMsg('useMsg', a.reason, 'err'); return; }
    setMsg('useMsg', T('Alert saved: {desc}. It is checked while {symbol} is open on the Dashboard, and it fires once when every entry condition lines up.', { desc: BT.alerts.describe(a), symbol: sym }), 'ok');
    toast(T('You will hear about {symbol} when the entry conditions line up. An alert is not a recommendation.', { symbol: sym }), 'ok', T('Rule alert created'));
  }

  /* ------------------------------------------------------------------ *
   * JSON
   * ------------------------------------------------------------------ */
  function exportJson() {
    $('jsonBox').value = R.exportJSON(rule);
    setMsg('jsonMsg', T('Exported. Copy the text and share it.'), 'ok');
  }
  function importJson() {
    var res = R.importJSON($('jsonBox').value);
    if (!res.ok) { setMsg('jsonMsg', res.errors.slice(0, 3).join(' '), 'err'); return; }
    setRule(res.rule, null);
    setMsg('jsonMsg', T('Imported "{name}".', { name: res.rule.name }), 'ok');
    announce(R.describe(rule, lang()));
  }
  function copyJson() {
    var box = $('jsonBox');
    if (!box.value.trim()) exportJson();
    var done = function () { setMsg('jsonMsg', T('Copied to the clipboard.'), 'ok'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(box.value).then(done, function () { box.select(); setMsg('jsonMsg', T('Select the text and copy it manually.'), ''); }); return; }
    } catch (e) { /* fall through */ }
    box.select();
    try { document.execCommand('copy'); done(); } catch (e) { setMsg('jsonMsg', T('Select the text and copy it manually.'), ''); }
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  function bind() {
    $('tplList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tpl]'); if (!b) return;
      var id = b.getAttribute('data-tpl');
      setRule(R.template(id), id);
      var again = document.querySelector('[data-tpl="' + id + '"]'); if (again) again.focus();
      announce(T('Loaded template. {desc}', { desc: R.describe(rule, lang()) }));
    });
    $('ruleName').addEventListener('input', function () { rule.name = this.value.slice(0, 60) || ''; templateId = null; renderTemplates(); refresh(); });
    $('ruleName').addEventListener('change', function () { rule.name = R.normalize({ name: this.value }).name; this.value = rule.name; refresh(); });
    $('ruleSide').addEventListener('change', function () { rule.side = this.value === 'short' ? 'short' : 'long'; refresh(); });
    ['entry', 'exit'].forEach(function (block) {
      $(block + 'Op').addEventListener('change', function () { rule[block].op = this.value === 'or' ? 'or' : 'and'; renderBlock(block); refresh(); });
      $(block + 'List').addEventListener('change', onListChange);
      $(block + 'List').addEventListener('input', function (e) { var r = e.target.getAttribute('data-role'); if (r === 'param' || r === 'value') onListChange(e); });
      $(block + 'List').addEventListener('click', onListClick);
      $(block + 'Add').addEventListener('click', function () { addCondition(block); });
    });
    ['stopPct', 'targetPct', 'trailingPct', 'maxBars'].forEach(function (k) {
      $(k).addEventListener('input', function () {
        var v = parseFloat(String(this.value).replace(',', '.'));
        if (this.value === '' || !isNum(v) || v <= 0) delete rule.exit[k];
        else rule.exit[k] = k === 'maxBars' ? Math.max(1, Math.round(v)) : Math.min(v, 100);
        templateId = null; renderTemplates(); refresh();
      });
    });
    $('btRun').addEventListener('click', runBacktest);
    $('btSymbol').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runBacktest(); } });
    $('saveBtn').addEventListener('click', saveRule);
    $('alertBtn').addEventListener('click', createAlert);
    $('newBtn').addEventListener('click', function () { setRule(R.blank(), null); setMsg('useMsg', T('Started a blank rule.'), ''); focusId('ruleName'); });
    $('savedList').addEventListener('click', function (e) {
      var ld = e.target.closest('[data-load]'), del = e.target.closest('[data-del]');
      if (ld) { var r = R.get(ld.getAttribute('data-load')); if (r) { setRule(r, null); setMsg('useMsg', T('Loaded "{name}".', { name: r.name }), 'ok'); } }
      else if (del) {
        var id = del.getAttribute('data-del'), x = R.get(id);
        if (x && window.confirm && !window.confirm(T('Delete the saved rule "{name}"?', { name: x.name }))) return;
        R.remove(id);
        if (rule.id === id) delete rule.id;
        renderSaved(); setMsg('useMsg', T('Deleted.'), '');
        focusId('saveBtn');
      }
    });
    $('exportBtn').addEventListener('click', exportJson);
    $('importBtn').addEventListener('click', importJson);
    $('copyBtn').addEventListener('click', copyJson);
    window.addEventListener('bt:theme', function () { if (lastResult) { try { drawCharts(); } catch (e) { /* not ready */ } } });
    // re-describe in the new language when the student flips EN/ES
    var htmlEl = document.documentElement;
    if (window.MutationObserver) new MutationObserver(function () { renderForm(); renderSaved(); }).observe(htmlEl, { attributes: true, attributeFilter: ['lang'] });
  }

  function fillSymbols() {
    var u = BT.data && BT.data.universe || [];
    $('symList').innerHTML = u.map(function (x) { return '<option value="' + esc(x.symbol) + '">' + esc(x.name || '') + '</option>'; }).join('');
    try {
      var last = JSON.parse(store.get('bt.builder.last') || 'null');
      if (last && last.symbol) $('btSymbol').value = last.symbol;
      if (last && last.interval && $('btInterval').querySelector('option[value="' + last.interval + '"]')) $('btInterval').value = last.interval;
      if (last && last.bars && $('btBars').querySelector('option[value="' + last.bars + '"]')) $('btBars').value = String(last.bars);
    } catch (e) { /* ignore */ }
  }

  function init() {
    fillSymbols();
    var hash = String(location.hash || '').replace(/^#/, ''), m = hash.match(/(?:^|&)template=([A-Za-z]+)/);
    var tpl = m && R.template(m[1]);
    if (tpl) setRule(tpl, m[1]);
    else { var d = R.getDraft(); if (d) setRule(d, null); else setRule(R.template('smaCross'), 'smaCross'); }
    renderSaved();
    renderSource(null);
    bind();
  }

  BT.builderPage = {
    getRule: currentRule,
    setRule: function (r) { setRule(r, null); },
    run: runBacktest,
    getResult: function () { return lastResult; },
    version: '0.5.0'
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
