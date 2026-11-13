/* Broward Trading — js/screener-ui.js (screener.html)
 *
 * UI for BT.screener: built-in and saved scans, a phone-friendly filter builder, a progress
 * bar that also reports rate-limit waits on live providers, and results as a sortable table
 * (desktop) or a card list (phones), each with "Open chart" and "+ Watchlist" actions.
 * Strings in the static HTML are translated by js/i18n.js; strings built here go through BT.t.
 */
(function () {
  'use strict';
  var BT = window.BT || (window.BT = {});
  var S = BT.screener, D = BT.data;
  function T(s, v) { return (BT && BT.t) ? BT.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  if (!S || !D || !BT.ind) {
    var st = $('status'); if (st) st.textContent = T('The screener could not start because a script failed to load. Reload the page.');
    return;
  }

  try { S.prestart(); } catch (e) { /* workers are an optimisation only */ }
  var LAST_KEY = 'bt.screener.last';
  var SORT_KEY = 'bt.screener.sort';
  var MAX_WATCHLIST = 14;                                  // same cap as the dashboard
  var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN'];
  var fmt = S.format;

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var dataStatus = D.status ? D.status() : { provider: 'demo', live: false };
  var isDemo = dataStatus.provider === 'demo';
  var last = store.get(LAST_KEY, null);
  var state = {
    filters: [], universe: isDemo ? 'all' : 'watchlist', match: 'all', scanId: null,
    rows: [], sort: store.get(SORT_KEY, { key: 'symbol', dir: 'asc' }) || { key: 'symbol', dir: 'asc' },
    running: false, controller: null, stale: false, lastRun: null
  };
  function setFilters(list) { try { state.filters = S.normFilters(list); } catch (e) { state.filters = []; } }
  if (last && Array.isArray(last.filters)) {
    setFilters(last.filters);
    if (typeof last.universe === 'string') state.universe = last.universe;
    state.match = last.match === 'any' ? 'any' : 'all';
    state.scanId = last.scanId || null;
  } else {
    setFilters(S.builtins[0].filters); state.scanId = S.builtins[0].id;
  }
  // ?scan=<id> deep link (e.g. from a lesson): load that scan.
  try {
    var qp = new URLSearchParams(location.search).get('scan');
    var qs = qp && S.getScan(qp);
    if (qs) { setFilters(qs.filters); state.scanId = qs.id; if (qs.universe) state.universe = qs.universe; state.match = qs.match === 'any' ? 'any' : 'all'; }
  } catch (e) { /* old browser */ }
  if (!S.universes.some(function (u) { return u.id === state.universe; })) state.universe = 'all';
  function persist() { store.set(LAST_KEY, { filters: state.filters, universe: state.universe, match: state.match, scanId: state.scanId }); }

  /* ------------------------------------------------------------------ *
   * Toasts & announcements
   * ------------------------------------------------------------------ */
  function toast(msg, kind, title) {
    if (BT.nav && BT.nav.toast) return BT.nav.toast(msg, kind, title);
    var host = $('toasts'), el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<div class="t-body">' + (title ? '<b>' + esc(title) + '</b> ' : '') + esc(msg) + '</div><button class="close" type="button" aria-label="Dismiss">✕</button>';
    el.querySelector('.close').onclick = function () { el.remove(); };
    host.appendChild(el); setTimeout(function () { el.remove(); }, 4500);
  }

  /* ------------------------------------------------------------------ *
   * Data source pill + live-data notice
   * ------------------------------------------------------------------ */
  function renderSource() {
    var pill = $('pillSource'), note = $('liveNote');
    if (isDemo) {
      pill.className = 'pill demo'; pill.textContent = T('demo data');
      note.hidden = true;
      return;
    }
    var label = (D.PROVIDER_LABEL && D.PROVIDER_LABEL[dataStatus.provider]) || dataStatus.provider;
    pill.className = dataStatus.live ? 'pill live' : 'pill demo';
    pill.textContent = dataStatus.live ? label : T('{provider}: no key', { provider: label });
    var lim = dataStatus.limits || (D.RATE_LIMITS && D.RATE_LIMITS[dataStatus.provider]) || {};
    var n = S.resolveUniverse(state.universe).length;
    var parts = [];
    if (!dataStatus.live) parts.push(T('No {provider} key is saved, so every symbol falls back to simulated bars. Add a key in the Dashboard\'s Live data settings.', { provider: label }));
    else {
      parts.push(T('Live data: every symbol not already cached costs one {provider} request.', { provider: label }));
      if (isFinite(lim.perMinute)) parts.push(T('The free plan allows {n} a minute, so {count} symbols take about {min} min. The screener waits between batches instead of using up your quota.', { n: lim.perMinute, count: n, min: Math.max(1, Math.ceil(n / lim.perMinute)) }));
      if (isFinite(lim.perDay)) parts.push(T('Daily cap: {n} requests. Start with your watchlist.', { n: lim.perDay }));
    }
    note.querySelector('.txt').textContent = parts.join(' ');
    note.hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * Scans (built-in + saved)
   * ------------------------------------------------------------------ */
  function renderScans() {
    var host = $('scanList');
    host.innerHTML = S.builtins.map(function (s) {
      return '<button type="button" class="scan' + (state.scanId === s.id ? ' on' : '') + '" data-scan="' + esc(s.id) + '" aria-pressed="' + (state.scanId === s.id) + '">' +
        '<span class="nm">' + esc(T(s.name)) + '</span><span class="ds">' + esc(T(s.description)) + '</span></button>';
    }).join('');
    var saved = S.savedScans(), sh = $('savedList');
    $('savedEmpty').hidden = saved.length > 0;
    sh.innerHTML = saved.map(function (s) {
      return '<li><button type="button" class="pick' + (state.scanId === s.id ? ' on' : '') + '" data-scan="' + esc(s.id) + '" aria-pressed="' + (state.scanId === s.id) + '">' +
        '<span class="nm">' + esc(s.name) + '</span><span class="ds">' + esc(S.describe(s.filters, s.match)) + '</span></button>' +
        '<button type="button" class="rm" data-del="' + esc(s.id) + '" aria-label="' + esc(T('Delete scan {name}', { name: s.name })) + '" title="' + esc(T('Delete scan {name}', { name: s.name })) + '">✕</button></li>';
    }).join('');
  }
  function loadScan(id) {
    var s = S.getScan(id); if (!s) return;
    setFilters(s.filters); state.scanId = s.id;
    if (s.universe && !s.builtin) state.universe = s.universe;
    state.match = s.match === 'any' ? 'any' : 'all';
    if (!s.builtin) $('scanName').value = s.name;
    persist(); renderAll();
    runScan();
  }
  $('scanList').addEventListener('click', function (e) { var b = e.target.closest('[data-scan]'); if (b) loadScan(b.getAttribute('data-scan')); });
  $('savedList').addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) {
      var id = d.getAttribute('data-del'), sc = S.getScan(id);
      if (sc && window.confirm(T('Delete the saved scan "{name}"?', { name: sc.name }))) {
        S.deleteScan(id);
        if (state.scanId === id) state.scanId = null;
        renderScans(); toast(T('Deleted "{name}".', { name: sc.name }), 'ok');
      }
      return;
    }
    var b = e.target.closest('[data-scan]'); if (b) loadScan(b.getAttribute('data-scan'));
  });

  /* ------------------------------------------------------------------ *
   * Filter builder
   * ------------------------------------------------------------------ */
  function optionsOf(pd) { return typeof pd.options === 'function' ? pd.options() : (pd.options || []); }
  function paramControl(pd, value, rowIdx) {
    var id = 'f' + rowIdx + '_' + pd.key;
    if (pd.type === 'select') {
      return '<div class="field"><label for="' + id + '">' + esc(T(pd.label)) + '</label><select id="' + id + '" data-row="' + rowIdx + '" data-key="' + pd.key + '">' +
        optionsOf(pd).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(T(o[1])) + '</option>'; }).join('') +
        '</select></div>';
    }
    if (pd.type === 'multi') {
      var vals = Array.isArray(value) ? value : [];
      return '<fieldset class="field multi"><legend>' + esc(T(pd.label)) + '</legend><div class="checks">' +
        optionsOf(pd).map(function (o, k) {
          var cid = id + '_' + k;
          return '<label class="check" for="' + cid + '"><input type="checkbox" id="' + cid + '" data-row="' + rowIdx + '" data-key="' + pd.key + '" value="' + esc(o[0]) + '"' + (vals.indexOf(o[0]) >= 0 ? ' checked' : '') + '><span>' + esc(T(o[1])) + '</span></label>';
        }).join('') + '</div></fieldset>';
    }
    var attrs = ' step="' + esc(pd.step == null ? 'any' : pd.step) + '"' + (pd.min != null ? ' min="' + pd.min + '"' : '') + (pd.max != null ? ' max="' + pd.max + '"' : '');
    return '<div class="field"><label for="' + id + '">' + esc(T(pd.label)) + '</label><input type="number" inputmode="decimal" id="' + id + '" data-row="' + rowIdx + '" data-key="' + pd.key + '"' + attrs +
      ' value="' + (value == null ? '' : esc(value)) + '" placeholder="' + esc(T('any')) + '"></div>';
  }
  function renderFilters() {
    var host = $('filterRows');
    $('noFilters').hidden = state.filters.length > 0;
    host.innerHTML = state.filters.map(function (f, i) {
      var def = S.filters[f.id];
      return '<li class="frow" data-idx="' + i + '">' +
        '<div class="fhead"><span class="fname">' + esc(T(def.label)) + '</span><span class="fgroup">' + esc(T(def.group)) + '</span>' +
        '<button type="button" class="rm" data-remove="' + i + '" aria-label="' + esc(T('Remove filter {name}', { name: T(def.label) })) + '" title="' + esc(T('Remove filter {name}', { name: T(def.label) })) + '">✕</button></div>' +
        (def.params.length ? '<div class="fparams">' + def.params.map(function (pd) { return paramControl(pd, f.params[pd.key], i); }).join('') + '</div>' : '') +
        '<details class="fhelp"><summary>' + esc(T('What does this measure?')) + '</summary><p>' + esc(T(def.help)) + '</p></details>' +
        '</li>';
    }).join('');
    renderSummary();
  }
  function renderAddSelect() {
    var groups = {}, order = [];
    S.filterList.forEach(function (f) { if (!groups[f.group]) { groups[f.group] = []; order.push(f.group); } groups[f.group].push(f); });
    $('addFilter').innerHTML = order.map(function (g) {
      return '<optgroup label="' + esc(T(g)) + '">' + groups[g].map(function (f) { return '<option value="' + f.id + '">' + esc(T(f.label)) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }
  function renderSummary() {
    $('scanSummary').textContent = S.describe(state.filters, state.match);
  }
  function renderControls() {
    var u = $('universe');
    u.innerHTML = S.universes.map(function (x) {
      var n = S.resolveUniverse(x.id).length;
      return '<option value="' + x.id + '"' + (x.id === state.universe ? ' selected' : '') + '>' + esc(T(x.label)) + ' (' + n + ')</option>';
    }).join('');
    $('match').value = state.match;
  }
  function filtersChanged() {
    state.scanId = null; persist(); renderSummary(); renderScans();
    markStale();
  }
  $('filterRows').addEventListener('input', onParamEdit);
  $('filterRows').addEventListener('change', onParamEdit);
  function onParamEdit(e) {
    var el = e.target, row = el.getAttribute && el.getAttribute('data-row');
    if (row == null) return;
    var f = state.filters[+row]; if (!f) return;
    var key = el.getAttribute('data-key');
    if (el.type === 'checkbox') {
      var boxes = document.querySelectorAll('input[type=checkbox][data-row="' + row + '"][data-key="' + key + '"]');
      f.params[key] = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).map(function (b) { return b.value; });
    } else if (el.type === 'number') {
      if (e.type === 'input' && el.value !== '' && !isFinite(Number(el.value))) return;
      f.params[key] = el.value === '' ? null : Number(el.value);
    } else f.params[key] = el.value;
    filtersChanged();
  }
  $('filterRows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-remove]'); if (!b) return;
    var idx = +b.getAttribute('data-remove');
    var name = T(S.filters[state.filters[idx].id].label);
    state.filters.splice(idx, 1);
    renderFilters(); filtersChanged();
    if (BT.a11y && BT.a11y.announce) BT.a11y.announce(T('Removed filter {name}', { name: name }));
    var focusTo = $('filterRows').querySelectorAll('[data-remove]')[Math.min(idx, state.filters.length - 1)];
    (focusTo || $('addFilter')).focus();
  });
  $('addBtn').addEventListener('click', function () {
    var id = $('addFilter').value; if (!S.filters[id]) return;
    if (state.filters.length >= 8) { toast(T('Eight filters is plenty: more filters usually means no results. Remove one first.'), 'warn'); return; }
    state.filters.push(S.normFilters([{ id: id }])[0]);
    renderFilters(); filtersChanged();
    var rows = $('filterRows').querySelectorAll('.frow');
    var lastRow = rows[rows.length - 1];
    if (lastRow) { var first = lastRow.querySelector('input,select'); (first || lastRow.querySelector('.rm')).focus(); }
  });
  $('universe').addEventListener('change', function () { state.universe = this.value; persist(); renderSource(); markStale(); });
  $('match').addEventListener('change', function () { state.match = this.value === 'any' ? 'any' : 'all'; filtersChanged(); });
  $('clearBtn').addEventListener('click', function () {
    state.filters = []; state.scanId = null; $('scanName').value = '';
    renderFilters(); filtersChanged();
  });
  $('saveForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('scanName').value.trim();
    var msg = $('saveMsg');
    try {
      var rec = S.saveScan({ name: name, filters: state.filters, universe: state.universe, match: state.match });
      state.scanId = rec.id; persist(); renderScans();
      msg.className = 'msg ok'; msg.textContent = T('Saved "{name}". Find it under Your saved scans.', { name: rec.name });
    } catch (err) {
      msg.className = 'msg err'; msg.textContent = err.message;
      $('scanName').focus();
    }
    clearTimeout(msg._t); msg._t = setTimeout(function () { msg.textContent = ''; }, 5000);
  });

  /* ------------------------------------------------------------------ *
   * Running
   * ------------------------------------------------------------------ */
  var autoTimer = null;
  function markStale() {
    state.stale = true;
    if (isDemo) { clearTimeout(autoTimer); autoTimer = setTimeout(runScan, 350); }   // demo rescans are instant (memoised)
    else if (state.lastRun) setStatus(T('Filters changed. Press Run scan to update the results.'));
  }
  function setStatus(text, cls) { var el = $('status'); el.textContent = text; el.className = 'msg' + (cls ? ' ' + cls : ''); }
  var progRaf = 0, progLatest = null;
  function showProgress(p) {
    progLatest = p;
    if (progRaf) return;
    progRaf = requestAnimationFrame(function () {
      progRaf = 0;
      var q = progLatest, bar = $('progress');
      if (!q) return;
      var pct = q.total ? Math.round(q.done / q.total * 100) : 0;
      bar.hidden = false;
      bar.setAttribute('aria-valuenow', String(pct));
      bar.querySelector('.fill').style.width = pct + '%';
      if (q.phase === 'wait') {
        setStatus(T('Waiting {s} s for the free-tier rate limit before {symbol}… ({done} of {total} scanned)', { s: Math.ceil((q.waitMs || 0) / 1000), symbol: q.symbol || '', done: q.done, total: q.total }), '');
      } else if (q.phase !== 'done') {
        setStatus(T('Scanning {done} of {total}… {matches} match so far', { done: q.done, total: q.total, matches: q.matches }), 'ok');
      }
    });
  }
  async function runScan() {
    clearTimeout(autoTimer);
    if (state.running) {
      if (isDemo) { state.pendingRerun = true; return; }
      return;
    }
    state.running = true; state.stale = false;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = ctl;
    $('runBtn').disabled = true; $('runBtn').setAttribute('aria-busy', 'true');
    $('cancelBtn').hidden = isDemo;
    $('results').setAttribute('aria-busy', 'true');
    var t0 = Date.now();
    var rows = null, err = null;
    try {
      rows = await S.run(state.universe, state.filters, { match: state.match, signal: ctl ? ctl.signal : null, onProgress: showProgress });
    } catch (e) { err = e; }
    state.running = false; state.controller = null;
    $('runBtn').disabled = false; $('runBtn').removeAttribute('aria-busy');
    $('cancelBtn').hidden = true;
    $('results').removeAttribute('aria-busy');
    $('progress').hidden = true;
    if (err) { setStatus(T('The scan failed: {error}', { error: err.message || String(err) }), 'err'); return; }
    state.rows = rows; state.lastRun = Date.now();
    renderResults();
    var secs = ((rows.elapsedMs != null ? rows.elapsedMs : Date.now() - t0) / 1000).toFixed(1);
    var line = T('{n} of {scanned} symbols match · scanned in {s} s', { n: rows.length, scanned: rows.scanned, s: secs });
    if (rows.cancelled) line = T('Scan cancelled. {n} matches among the {scanned} symbols scanned so far.', { n: rows.length, scanned: rows.scanned });
    setStatus(line, 'ok');
    if (BT.a11y && BT.a11y.announce) BT.a11y.announce(line);
    if (state.pendingRerun) { state.pendingRerun = false; runScan(); }
  }
  $('runBtn').addEventListener('click', runScan);
  $('cancelBtn').addEventListener('click', function () { if (state.controller) state.controller.abort(); });

  /* ------------------------------------------------------------------ *
   * Results
   * ------------------------------------------------------------------ */
  var COLS = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'price', label: 'Price', num: true },
    { key: 'chg1d', label: '1D %', num: true },
    { key: 'chg5d', label: '5D %', num: true },
    { key: 'rsi', label: 'RSI', num: true },
    { key: 'sma50Pct', label: 'vs SMA 50', num: true },
    { key: 'sma200Pct', label: 'vs SMA 200', num: true },
    { key: 'adx', label: 'ADX', num: true },
    { key: 'signal', label: 'Signal' }
  ];
  function chgClass(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
  function signalPill(row) {
    var s = row.signal || 'HOLD';
    var cls = s === 'BUY' ? 'up' : s === 'SELL' ? 'down' : 'solid';
    var score = row.score == null ? '' : ' ' + (row.score > 0 ? '+' : '') + row.score;
    return '<span class="pill ' + cls + '">' + esc(T(s)) + '<span class="num">' + esc(score) + '</span></span>';
  }
  function chartHref(sym) { return 'index.html#symbol=' + encodeURIComponent(sym) + '&interval=1day'; }
  function whyChips(row) {
    if (!row.why || !row.why.length) return '';
    return '<ul class="why" aria-label="' + esc(T('Why it matched')) + '">' + row.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
  }
  function actions(row) {
    return '<a class="btn sm" href="' + chartHref(row.symbol) + '" aria-label="' + esc(T('Open {symbol} chart on the dashboard', { symbol: row.symbol })) + '">' + esc(T('Chart')) + '</a>' +
      '<button type="button" class="sm" data-watch="' + esc(row.symbol) + '" aria-label="' + esc(T('Add {symbol} to watchlist', { symbol: row.symbol })) + '">' + esc(T('+ Watchlist')) + '</button>';
  }
  function renderResults() {
    var rows = state.rows || [];
    S.sortRows(rows, state.sort.key, state.sort.dir);
    $('resCount').textContent = rows.length ? T('{n} matches', { n: rows.length }) : '';
    var empty = $('empty');
    empty.hidden = rows.length > 0 || !state.lastRun;
    if (!rows.length && state.lastRun) {
      empty.querySelector('.txt').textContent = state.filters.length
        ? T('Nothing in this universe passes every filter today. That is normal for strict scans: loosen one threshold, switch "Match" to Any, or try a bigger universe.')
        : T('The universe is empty. Add symbols to your watchlist on the Dashboard or pick another universe.');
    }
    // warnings: simulated rows, skipped symbols, errors
    var warn = [], w = $('resWarn');
    if (rows.simulated) warn.push(T('{n} symbols used simulated bars because live data was unavailable ({reason}).', { n: rows.simulated, reason: (rows.filter(function (r) { return r.simulated; })[0] || {}).reason || T('fallback') }));
    if (rows.skipped && rows.skipped.length) warn.push(T('{n} symbols were not scanned: {reason}', { n: rows.skipped.length, reason: rows.skipped[0].reason }) + ' (' + rows.skipped.slice(0, 12).map(function (s) { return s.symbol; }).join(', ') + (rows.skipped.length > 12 ? '…' : '') + ')');
    if (rows.errors && rows.errors.length) warn.push(T('{n} symbols failed to load: {list}', { n: rows.errors.length, list: rows.errors.slice(0, 8).map(function (e) { return e.symbol; }).join(', ') }));
    w.hidden = !warn.length;
    w.querySelector('.txt').textContent = warn.join(' ');

    // table
    var thead = $('resTable').querySelector('thead tr');
    thead.innerHTML = COLS.map(function (c) {
      var on = state.sort.key === c.key;
      var aria = on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" class="' + (c.num ? 'right' : '') + '" aria-sort="' + aria + '"><button type="button" class="sortbtn" data-sort="' + c.key + '">' + esc(T(c.label)) +
        '<span class="arrow" aria-hidden="true">' + (on ? (state.sort.dir === 'asc' ? '▲' : '▼') : '') + '</span></button></th>';
    }).join('') + '<th scope="col"><span class="sr-only">' + esc(T('Actions')) + '</span></th>';
    $('resTable').querySelector('tbody').innerHTML = rows.map(function (r) {
      return '<tr>' +
        '<th scope="row" class="sym"><span class="tk">' + esc(r.symbol) + (r.simulated ? ' <span class="sim" title="' + esc(T('Simulated bars')) + '">' + esc(T('sim')) + '</span>' : '') + '</span><span class="nm">' + esc(r.name) + '</span>' + whyChips(r) + '</th>' +
        '<td class="right num">' + fmt.price(r.price) + '</td>' +
        '<td class="right num ' + chgClass(r.chg1d) + '">' + fmt.pct(r.chg1d) + '</td>' +
        '<td class="right num ' + chgClass(r.chg5d) + '">' + fmt.pct(r.chg5d) + '</td>' +
        '<td class="right num">' + fmt.num(r.rsi) + '</td>' +
        '<td class="right num ' + chgClass(r.sma50Pct) + '">' + fmt.pct(r.sma50Pct) + '</td>' +
        '<td class="right num ' + chgClass(r.sma200Pct) + '">' + fmt.pct(r.sma200Pct) + '</td>' +
        '<td class="right num">' + fmt.num(r.adx) + '</td>' +
        '<td>' + signalPill(r) + '</td>' +
        '<td class="acts">' + actions(r) + '</td></tr>';
    }).join('');
    $('tableWrap').hidden = !rows.length;

    // phone cards
    $('resCards').innerHTML = rows.map(function (r) {
      return '<li class="rcard"><div class="top"><a class="tk" href="' + chartHref(r.symbol) + '">' + esc(r.symbol) + '</a>' +
        '<span class="nm">' + esc(r.name) + '</span>' +
        '<span class="px num">' + fmt.price(r.price) + ' <span class="' + chgClass(r.chg1d) + '">' + fmt.pct(r.chg1d) + '</span></span></div>' +
        '<dl class="kv3">' +
        '<div><dt>' + esc(T('RSI')) + '</dt><dd class="num">' + fmt.num(r.rsi) + '</dd></div>' +
        '<div><dt>' + esc(T('vs SMA 200')) + '</dt><dd class="num ' + chgClass(r.sma200Pct) + '">' + fmt.pct(r.sma200Pct) + '</dd></div>' +
        '<div><dt>' + esc(T('Signal')) + '</dt><dd>' + signalPill(r) + '</dd></div>' +
        '</dl>' + whyChips(r) +
        (r.simulated ? '<p class="simnote">' + esc(T('Simulated bars: live data was unavailable for this symbol.')) + '</p>' : '') +
        '<div class="acts">' + actions(r) + '</div></li>';
    }).join('');
    $('resCards').hidden = !rows.length;
    $('sortKey').value = state.sort.key;
    $('sortDir').textContent = state.sort.dir === 'asc' ? T('Ascending') : T('Descending');
    $('sortDir').setAttribute('aria-label', state.sort.dir === 'asc' ? T('Sort ascending, tap for descending') : T('Sort descending, tap for ascending'));
  }
  function setSort(key, dir) {
    if (!dir) dir = state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : (key === 'symbol' || key === 'signal' ? 'asc' : 'desc');
    state.sort = { key: key, dir: dir }; store.set(SORT_KEY, state.sort);
    renderResults();
  }
  $('resTable').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sort]'); if (!b) return;
    var key = b.getAttribute('data-sort');
    setSort(key);
    var again = $('resTable').querySelector('[data-sort="' + key + '"]'); if (again) again.focus();
  });
  $('sortKey').innerHTML = COLS.map(function (c) { return '<option value="' + c.key + '">' + esc(T(c.label)) + '</option>'; }).join('');
  $('sortKey').addEventListener('change', function () { setSort(this.value, state.sort.dir); });
  $('sortDir').addEventListener('click', function () { setSort(state.sort.key, state.sort.dir === 'asc' ? 'desc' : 'asc'); });

  // + Watchlist (shared with the dashboard through localStorage 'bt.watchlist')
  function addToWatchlist(sym) {
    var wl = store.get('bt.watchlist', null);
    if (!Array.isArray(wl)) wl = DEFAULT_WATCHLIST.slice();
    if (wl.indexOf(sym) >= 0) { toast(T('{symbol} is already on your watchlist.', { symbol: sym }), 'warn'); return; }
    if (wl.length >= MAX_WATCHLIST) { toast(T('Watchlists are capped at {max} symbols to stay inside free data quotas. Remove one first.', { max: MAX_WATCHLIST }), 'warn'); return; }
    wl.push(sym); store.set('bt.watchlist', wl);
    toast(T('{symbol} added to your watchlist.', { symbol: sym }), 'ok');
    renderControls();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-watch]');
    if (b) addToWatchlist(b.getAttribute('data-watch'));
  });
  window.addEventListener('storage', function (e) { if (e.key === 'bt.watchlist') renderControls(); });

  /* ------------------------------------------------------------------ *
   * Go
   * ------------------------------------------------------------------ */
  function renderAll() { renderControls(); renderScans(); renderFilters(); renderSource(); }
  renderAddSelect();
  renderAll();
  if (isDemo) runScan();
  else setStatus(T('Live data is on. Choose a universe and press Run scan; requests are paced to your plan\'s limits.'));
})();
