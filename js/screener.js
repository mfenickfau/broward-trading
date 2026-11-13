/* Broward Trading — js/screener.js → BT.screener
 *
 * A technical stock screener for the paper-trading course. It answers questions like
 * "which names in my universe closed above their 200-day average with RSI under 35?"
 * by computing a small per-symbol snapshot of indicators (via BT.ind) and testing a
 * list of filters against it.
 *
 *   BT.screener.filters                     catalogue keyed by id (see FILTERS below)
 *   BT.screener.filterList                  same, in display order
 *   BT.screener.run(universe, filters, opts) → Promise<rows>
 *       universe: 'all' | 'stock' | 'etf' | 'crypto' | 'watchlist' | [symbol | {symbol, name, sector, kind}]
 *       filters:  [{id, params}]  (AND by default; opts.match = 'any' for OR)
 *       opts:     {interval:'1day', limit, fetch: BT.data.candles, onProgress, signal, match,
 *                  workers:true, concurrency, limiter, sleep}
 *       rows:     [{symbol, name, price, chg1d, rsi, signal, matched:[filterIds], ...more}]
 *                 plus array props: total, scanned, skipped:[{symbol, reason}], errors, simulated,
 *                 elapsedMs, mode ('demo-workers' | 'demo' | 'live' | 'custom'), cancelled
 *   BT.screener.snapshot(bars, meta)       → plain object of the values the filters read
 *   BT.screener.evaluate(snap, filters)    → {pass, matched, results}
 *   BT.screener.builtins / scans() / saveScan() / deleteScan() / getScan()   (bt.screener.scans)
 *   BT.screener.describe(filters, match)   → plain-English sentence for the scan
 *
 * Speed: on the demo provider every symbol is generated locally. Generating ~70 years of
 * simulated daily history is the slow part (~25 ms a symbol), so the scan is split across a
 * small pool of Web Workers — this very file, re-loaded as a worker, which imports data.js and
 * indicators.js next to it — with the main thread pulling from the same queue between frames.
 * Snapshots are cached for 10 minutes (memory + localStorage 'bt.screener.cache'), the same
 * freshness BT.data gives cached live daily candles. Without workers (file://, old browsers,
 * Node) it runs on the main thread in short slices that yield to the UI. Live providers go one request at a time through BT.data.candles, which caches
 * responses; before every uncached request the screener asks BT.data.rateCheck() and waits
 * out per-minute limits (reporting the wait through onProgress) instead of burning the quota
 * or silently falling back to simulated bars. A daily limit stops the scan and lists the
 * symbols it could not reach.
 *
 * Plain ES2020, no DOM access. Educational: a screen finds candidates to study, never trades.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Worker mode: this file doubles as the worker script.
   * ------------------------------------------------------------------ */
  var IS_WORKER = typeof window === 'undefined' && typeof self !== 'undefined' && typeof importScripts === 'function';
  if (IS_WORKER) {
    self.window = self;                         // data.js / indicators.js attach to window.BT
    try { importScripts('data.js', 'indicators.js'); }
    catch (e) { self.postMessage({ type: 'fatal', error: String(e && e.message || e) }); return; }
  }

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.BT = root.BT || {};
  var BT = root.BT;

  function T(s, v) {
    var tf = BT && BT.t;
    if (tf) { try { return tf(s, v); } catch (e) { /* fall through */ } }
    return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s;
  }

  // Remember where this script lives so the main thread can start workers from it.
  var SCRIPT_URL = null;
  try {
    if (!IS_WORKER && typeof document !== 'undefined' && document.currentScript && document.currentScript.src) SCRIPT_URL = document.currentScript.src;
  } catch (e) { /* ignore */ }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }
  function round(v, dp) { if (!isNum(v)) return null; var m = Math.pow(10, dp); return Math.round(v * m) / m; }
  function pct(a, b) { return isNum(a) && isNum(b) && b !== 0 ? (a / b - 1) * 100 : null; }
  function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function cleanSym(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12); }
  function fmtPct(v, dp) { return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(dp == null ? 1 : dp) + ' %' : '—'; }
  function fmtNum(v, dp) { return isNum(v) ? v.toFixed(dp == null ? 1 : dp) : '—'; }
  function fmtPrice(v) { return isNum(v) ? '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2)) : '—'; }
  function fmtVol(v) {
    if (!isNum(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v));
  }
  var store = {
    get: function (k, d) { try { var v = root.localStorage && root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  var LIMIT = { '1day': 400, '1h': 390, '15min': 390, '5min': 390, '1min': 390 };   // same as the dashboard → shared cache entries
  var CROSS_LOOKBACK = 60;                      // bars searched back for golden/death crosses
  var SQUEEZE_WINDOW = 120;                     // Bollinger bandwidth history for the squeeze rank
  var PATTERN_NAMES = ['Doji', 'Hammer', 'Shooting star', 'Bullish engulfing', 'Bearish engulfing', 'Morning star', 'Evening star', 'Three white soldiers', 'Three black crows'];

  /* ------------------------------------------------------------------ *
   * Snapshot: every value the filters need, computed once per symbol.
   * ------------------------------------------------------------------ */
  function crossInfo(fast, slow, L) {
    var out = { golden: null, death: null };
    for (var k = 0; k <= CROSS_LOOKBACK && L - k >= 1; k++) {
      var i = L - k, f = fast[i], s = slow[i], pf = fast[i - 1], ps = slow[i - 1];
      if (f == null || s == null || pf == null || ps == null) break;
      if (out.golden == null && f > s && pf <= ps) out.golden = k;
      if (out.death == null && f < s && pf >= ps) out.death = k;
      if (out.golden != null && out.death != null) break;
    }
    return out;
  }

  /**
   * snapshot(bars, meta) → plain, structured-clone-safe object. `meta` = {symbol, name, sector, kind}.
   * Fields are null when there is not enough history (a filter that reads a null never matches).
   */
  function snapshot(bars, meta) {
    meta = meta || {};
    var I = BT.ind;
    if (!I) throw new Error('BT.ind (js/indicators.js) must be loaded before the screener');
    bars = Array.isArray(bars) ? bars : [];
    var n = bars.length, L = n - 1;
    var kind = meta.kind || 'stock';
    var snap = {
      symbol: meta.symbol || bars.symbol || '', name: meta.name || '', sector: meta.sector || '', kind: kind,
      bars: n, time: n ? bars[L].time : null,
      price: null, chg1d: null, chg5d: null, chg1m: null, avgVol: null,
      rsi: null, sma20: null, sma50: null, sma200: null, sma50Pct: null, sma200Pct: null,
      cross: { '50/200': { golden: null, death: null }, '20/50': { golden: null, death: null } },
      bandwidth: null, bwRank: null, squeeze: null,
      high52: null, low52: null, newHigh52: null, newLow52: null, fromHigh52Pct: null,
      patterns: [], adx: null, signal: null, score: null
    };
    if (!n) return snap;
    var c = new Array(n), v = new Array(n);
    for (var i = 0; i < n; i++) { c[i] = bars[i].close; v[i] = bars[i].volume; }
    snap.price = c[L];
    snap.chg1d = n > 1 ? round(pct(c[L], c[L - 1]), 4) : null;
    snap.chg5d = n > 5 ? round(pct(c[L], c[L - 5]), 4) : null;
    var month = kind === 'crypto' ? 30 : 21;     // ≈ one calendar month of sessions
    snap.chg1m = n > month ? round(pct(c[L], c[L - month]), 4) : null;
    if (n >= 20) { var vs = 0, vn = 0; for (var j = n - 20; j < n; j++) if (isNum(v[j])) { vs += v[j]; vn++; } snap.avgVol = vn ? vs / vn : null; }

    var sma20 = I.sma(c, 20), sma50 = I.sma(c, 50), sma200 = I.sma(c, 200), rsi = I.rsi(c, 14);
    var bb = I.bollinger(c, 20, 2), macd = I.macd(c, 12, 26, 9), adx = I.adx(bars, 14);
    snap.rsi = rsi[L]; snap.sma20 = sma20[L]; snap.sma50 = sma50[L]; snap.sma200 = sma200[L];
    snap.sma50Pct = round(pct(c[L], sma50[L]), 4);
    snap.sma200Pct = round(pct(c[L], sma200[L]), 4);
    snap.cross['50/200'] = crossInfo(sma50, sma200, L);
    snap.cross['20/50'] = crossInfo(sma20, sma50, L);
    snap.adx = adx.adx[L];

    // Bollinger squeeze: today's bandwidth ranks in the lowest 10 % of the last 120 bars.
    var bw = bb.bandwidth;
    snap.bandwidth = bw[L];
    if (n >= SQUEEZE_WINDOW && bw[L] != null) {
      var below = 0, ok = true;
      for (var q = n - SQUEEZE_WINDOW; q < n; q++) { if (bw[q] == null) { ok = false; break; } if (bw[q] <= bw[L]) below++; }
      if (ok) { snap.bwRank = round(below / SQUEEZE_WINDOW * 100, 2); snap.squeeze = below / SQUEEZE_WINDOW <= 0.10; }
    }

    // 52-week high/low: 252 sessions for exchange-traded assets, 365 days for 24/7 crypto.
    var W = kind === 'crypto' ? 365 : 252;
    if (n >= W) {
      var hi = -Infinity, lo = Infinity;
      for (var h = n - W; h < L; h++) { if (bars[h].high > hi) hi = bars[h].high; if (bars[h].low < lo) lo = bars[h].low; }
      snap.newHigh52 = bars[L].high > hi;
      snap.newLow52 = bars[L].low < lo;
      snap.high52 = Math.max(hi, bars[L].high);
      snap.low52 = Math.min(lo, bars[L].low);
      snap.fromHigh52Pct = round(pct(c[L], snap.high52), 4);
    }

    // Candles: patterns that END on the latest bar (scan only the recent tail, indices re-based).
    var off = Math.max(0, n - 30), tail = bars.slice(off);
    var pats = I.candlePatterns(tail).map(function (p) { return { index: p.index + off, name: p.name, bias: p.bias, description: p.description }; });
    snap.patterns = pats.filter(function (p) { return p.index === L; }).map(function (p) { return { name: p.name, bias: p.bias }; });

    // Composite signal (the dashboard's BUY / SELL / HOLD score) on the latest bar.
    try {
      var sig = I.signals(bars, { sma20: sma20, sma50: sma50, sma200: sma200, rsi: rsi, macd: macd, bollinger: bb, adx: adx, patterns: pats }, L);
      snap.signal = sig.state; snap.score = sig.score;
    } catch (e) { /* leave null */ }
    return snap;
  }

  /* ------------------------------------------------------------------ *
   * Filter catalogue
   * ------------------------------------------------------------------ *
   * Each filter: {id, label, group, help, params:[{key, label, type, options?, step?, min?, max?}],
   *   defaults, static?:true (decidable from universe metadata alone, applied before fetching),
   *   test(snap, p) → true | false | null (null = not enough data),
   *   describe(p) → plain-English clause, explain(snap, p) → short "why it matched" text}.
   */
  function between(v, min, max) {
    if (!isNum(v)) return null;
    min = num(min); max = num(max);
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
    return true;
  }
  function rangeText(subject, p, unit) {
    var min = num(p.min), max = num(p.max), u = unit || '';
    if (min != null && max != null) return T('{subject} between {min}{u} and {max}{u}', { subject: subject, min: min, max: max, u: u });
    if (min != null) return T('{subject} at least {min}{u}', { subject: subject, min: min, u: u });
    if (max != null) return T('{subject} at most {max}{u}', { subject: subject, max: max, u: u });
    return T('{subject} (any value)', { subject: subject });
  }
  var PERIOD_FIELD = { '1d': 'chg1d', '5d': 'chg5d', '1m': 'chg1m' };
  var PERIOD_LABEL = { '1d': '1 day', '5d': '5 days', '1m': '1 month' };
  var SECTORS_FALLBACK = [];
  function sectorOptions() {
    var u = (BT.data && BT.data.universe) || [], seen = {}, out = [];
    u.forEach(function (r) { if (r.kind === 'stock' && r.sector && !seen[r.sector]) { seen[r.sector] = 1; out.push(r.sector); } });
    out.sort();
    return out.length ? out : SECTORS_FALLBACK;
  }
  function asList(v) {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (v == null || v === '') return [];
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  var FILTERS = [
    {
      id: 'price', group: 'Price & volume', label: 'Price',
      help: 'Last price in dollars. Very cheap shares tend to be more volatile and thinly traded.',
      params: [{ key: 'min', label: 'Min $', type: 'number', step: 'any', min: 0 }, { key: 'max', label: 'Max $', type: 'number', step: 'any', min: 0 }],
      defaults: { min: 10, max: null },
      test: function (s, p) { return between(s.price, p.min, p.max); },
      describe: function (p) { return rangeText(T('price'), p, ' $'); },
      explain: function (s) { return T('Price {v}', { v: fmtPrice(s.price) }); }
    },
    {
      id: 'change', group: 'Price & volume', label: '% change',
      help: 'Percent change over the last day, 5 days (a week) or about a month of sessions.',
      params: [{ key: 'period', label: 'Over', type: 'select', options: [['1d', '1 day'], ['5d', '5 days'], ['1m', '1 month']] },
        { key: 'min', label: 'Min %', type: 'number', step: 'any' }, { key: 'max', label: 'Max %', type: 'number', step: 'any' }],
      defaults: { period: '1d', min: 2, max: null },
      test: function (s, p) { return between(s[PERIOD_FIELD[p.period] || 'chg1d'], p.min, p.max); },
      describe: function (p) { return rangeText(T('change over {period}', { period: T(PERIOD_LABEL[p.period] || '1 day') }), p, ' %'); },
      explain: function (s, p) { var f = PERIOD_FIELD[p.period] || 'chg1d'; return T('{period}: {v}', { period: T(PERIOD_LABEL[p.period] || '1 day'), v: fmtPct(s[f]) }); }
    },
    {
      id: 'volume', group: 'Price & volume', label: 'Average volume',
      help: '20-day average daily volume (shares; coins for crypto). Higher volume usually means tighter spreads and easier fills.',
      params: [{ key: 'min', label: 'Min (millions)', type: 'number', step: 'any', min: 0 }],
      defaults: { min: 1 },
      test: function (s, p) { var m = num(p.min); return between(s.avgVol, m == null ? null : m * 1e6, null); },
      describe: function (p) { return T('average volume at least {v} million', { v: num(p.min) == null ? 0 : num(p.min) }); },
      explain: function (s) { return T('Avg vol {v}', { v: fmtVol(s.avgVol) }); }
    },
    {
      id: 'rsi', group: 'Momentum', label: 'RSI (14)',
      help: 'Relative Strength Index, 0–100. Below 30 is called oversold, above 70 overbought. In strong trends RSI can stay extreme for a long time.',
      params: [{ key: 'min', label: 'Min', type: 'number', step: 'any', min: 0, max: 100 }, { key: 'max', label: 'Max', type: 'number', step: 'any', min: 0, max: 100 }],
      defaults: { min: null, max: 30 },
      test: function (s, p) { return between(s.rsi, p.min, p.max); },
      describe: function (p) { return rangeText(T('RSI(14)'), p); },
      explain: function (s) { return T('RSI {v}', { v: fmtNum(s.rsi) }); }
    },
    {
      id: 'sma', group: 'Trend', label: 'Price vs moving average',
      help: 'Where the close sits relative to its 50- or 200-day simple moving average. Above the 200-day is the classic long-term uptrend filter.',
      params: [{ key: 'n', label: 'Average', type: 'select', options: [['50', 'SMA 50'], ['200', 'SMA 200']] },
        { key: 'side', label: 'Price is', type: 'select', options: [['above', 'Above'], ['below', 'Below']] },
        { key: 'minPct', label: 'Min distance %', type: 'number', step: 'any', min: 0 }, { key: 'maxPct', label: 'Max distance %', type: 'number', step: 'any', min: 0 }],
      defaults: { n: '200', side: 'above', minPct: null, maxPct: null },
      test: function (s, p) {
        var d = String(p.n) === '50' ? s.sma50Pct : s.sma200Pct;
        if (!isNum(d)) return null;
        var signed = p.side === 'below' ? -d : d;
        if (!(signed > 0)) return false;
        return between(signed, p.minPct, p.maxPct);
      },
      describe: function (p) {
        var base = T(p.side === 'below' ? 'price below its SMA {n}' : 'price above its SMA {n}', { n: String(p.n) === '50' ? 50 : 200 });
        var min = num(p.minPct), max = num(p.maxPct);
        if (min != null && max != null) return T('{base} by {min}–{max} %', { base: base, min: min, max: max });
        if (min != null) return T('{base} by at least {min} %', { base: base, min: min });
        if (max != null) return T('{base} by at most {max} %', { base: base, max: max });
        return base;
      },
      explain: function (s, p) { var fifty = String(p.n) === '50'; return T('{v} vs SMA {n}', { v: fmtPct(fifty ? s.sma50Pct : s.sma200Pct), n: fifty ? 50 : 200 }); }
    },
    {
      id: 'goldenCross', group: 'Trend', label: 'Golden cross',
      help: 'The faster average crossed ABOVE the slower one recently. 50/200 is the famous long-term version; 20/50 reacts sooner but whipsaws more.',
      params: [{ key: 'pair', label: 'Averages', type: 'select', options: [['50/200', 'SMA 50 / 200'], ['20/50', 'SMA 20 / 50']] },
        { key: 'within', label: 'Within last N bars', type: 'number', step: 1, min: 1, max: CROSS_LOOKBACK }],
      defaults: { pair: '50/200', within: 5 },
      test: function (s, p) { return crossTest(s, p, 'golden'); },
      describe: function (p) { return T('golden cross (SMA {pair}) in the last {n} bars', { pair: p.pair === '20/50' ? '20/50' : '50/200', n: crossWithin(p) }); },
      explain: function (s, p) { return crossExplain(s, p, 'golden'); }
    },
    {
      id: 'deathCross', group: 'Trend', label: 'Death cross',
      help: 'The faster average crossed BELOW the slower one recently: the bearish mirror of the golden cross.',
      params: [{ key: 'pair', label: 'Averages', type: 'select', options: [['50/200', 'SMA 50 / 200'], ['20/50', 'SMA 20 / 50']] },
        { key: 'within', label: 'Within last N bars', type: 'number', step: 1, min: 1, max: CROSS_LOOKBACK }],
      defaults: { pair: '50/200', within: 5 },
      test: function (s, p) { return crossTest(s, p, 'death'); },
      describe: function (p) { return T('death cross (SMA {pair}) in the last {n} bars', { pair: p.pair === '20/50' ? '20/50' : '50/200', n: crossWithin(p) }); },
      explain: function (s, p) { return crossExplain(s, p, 'death'); }
    },
    {
      id: 'adx', group: 'Trend', label: 'ADX trend strength',
      help: 'Average Directional Index measures how strong a trend is, not its direction. Above 25 is usually called trending, below 20 ranging.',
      params: [{ key: 'min', label: 'Min', type: 'number', step: 'any', min: 0, max: 100 }, { key: 'max', label: 'Max', type: 'number', step: 'any', min: 0, max: 100 }],
      defaults: { min: 25, max: null },
      test: function (s, p) { return between(s.adx, p.min, p.max); },
      describe: function (p) { return rangeText(T('ADX(14)'), p); },
      explain: function (s) { return T('ADX {v}', { v: fmtNum(s.adx) }); }
    },
    {
      id: 'squeeze', group: 'Volatility', label: 'Bollinger squeeze',
      help: 'Bollinger Band width is in the lowest 10 % of the last 120 bars: volatility is unusually quiet. Quiet periods often end with a bigger move, but the squeeze does not tell you which direction.',
      params: [],
      defaults: {},
      test: function (s) { return s.squeeze == null ? null : !!s.squeeze; },
      describe: function () { return T('Bollinger Band width in the lowest 10 % of the last 120 bars'); },
      explain: function (s) { return T('Band width rank {v} %', { v: fmtNum(s.bwRank, 0) }); }
    },
    {
      id: 'high52', group: 'Volatility', label: 'New 52-week high',
      help: 'Today traded above every high of the past year (252 sessions; 365 days for crypto). Breakouts to new highs are a momentum idea; they also attract late buyers.',
      params: [],
      defaults: {},
      test: function (s) { return s.newHigh52 == null ? null : !!s.newHigh52; },
      describe: function () { return T('a new 52-week high today'); },
      explain: function (s) { return T('New high {v}', { v: fmtPrice(s.high52) }); }
    },
    {
      id: 'low52', group: 'Volatility', label: 'New 52-week low',
      help: 'Today traded below every low of the past year. Cheap is not the same as good value: new lows often keep going.',
      params: [],
      defaults: {},
      test: function (s) { return s.newLow52 == null ? null : !!s.newLow52; },
      describe: function () { return T('a new 52-week low today'); },
      explain: function (s) { return T('New low {v}', { v: fmtPrice(s.low52) }); }
    },
    {
      id: 'pattern', group: 'Signals', label: 'Candlestick pattern today',
      help: 'A candlestick pattern that completed on the latest bar (from the same detector the dashboard uses). Patterns are hints, best confirmed by the next candle.',
      params: [{ key: 'name', label: 'Pattern', type: 'select', options: [['bull', 'Any bullish'], ['bear', 'Any bearish']].concat(PATTERN_NAMES.map(function (n) { return [n, n]; })) }],
      defaults: { name: 'bull' },
      test: function (s, p) {
        if (!Array.isArray(s.patterns)) return null;
        var want = p.name || 'bull';
        return s.patterns.some(function (x) { return want === 'bull' || want === 'bear' ? x.bias === want : x.name === want; });
      },
      describe: function (p) {
        var want = p.name || 'bull';
        if (want === 'bull') return T('a bullish candlestick pattern today');
        if (want === 'bear') return T('a bearish candlestick pattern today');
        return T('a {name} candle today', { name: T(want) });
      },
      explain: function (s) { return s.patterns && s.patterns.length ? s.patterns.map(function (x) { return T(x.name); }).join(', ') : T('No pattern'); }
    },
    {
      id: 'signal', group: 'Signals', label: 'Composite signal',
      help: 'The dashboard\'s rule-based score (trend, RSI, MACD, Bollinger, crosses). It is a teaching tool that summarises textbook rules, not a forecast.',
      params: [{ key: 'state', label: 'State', type: 'select', options: [['BUY', 'BUY'], ['SELL', 'SELL'], ['HOLD', 'HOLD']] }],
      defaults: { state: 'BUY' },
      test: function (s, p) { return s.signal == null ? null : s.signal === (p.state || 'BUY'); },
      describe: function (p) { return T('composite signal is {state}', { state: T(p.state || 'BUY') }); },
      explain: function (s) { return T('Signal {state} ({score})', { state: T(s.signal || 'HOLD'), score: isNum(s.score) ? (s.score > 0 ? '+' : '') + s.score : '—' }); }
    },
    {
      id: 'sector', group: 'Universe', label: 'Sector', static: true,
      help: 'Keep only stocks in the chosen sectors (ETFs and crypto have their own category labels).',
      params: [{ key: 'values', label: 'Sectors', type: 'multi', options: function () { return sectorOptions().map(function (s) { return [s, s]; }); } }],
      defaults: { values: ['Technology'] },
      test: function (s, p) { var vals = asList(p.values); return vals.length ? vals.indexOf(s.sector) >= 0 : true; },
      describe: function (p) { var vals = asList(p.values); return vals.length ? T('sector is {list}', { list: vals.map(function (v) { return T(v); }).join(' / ') }) : T('any sector'); },
      explain: function (s) { return T(s.sector || ''); }
    },
    {
      id: 'kind', group: 'Universe', label: 'Asset type', static: true,
      help: 'Stocks, exchange-traded funds or crypto.',
      params: [{ key: 'values', label: 'Types', type: 'multi', options: [['stock', 'Stocks'], ['etf', 'ETFs'], ['crypto', 'Crypto']] }],
      defaults: { values: ['stock'] },
      test: function (s, p) { var vals = asList(p.values); return vals.length ? vals.indexOf(s.kind) >= 0 : true; },
      describe: function (p) {
        var lbl = { stock: T('stocks'), etf: T('ETFs'), crypto: T('crypto') };
        var vals = asList(p.values);
        return vals.length ? T('type is {list}', { list: vals.map(function (v) { return lbl[v] || v; }).join(' / ') }) : T('any asset type');
      },
      explain: function (s) { return ({ stock: T('Stock'), etf: T('ETF'), crypto: T('Crypto') })[s.kind] || s.kind; }
    }
  ];
  function crossWithin(p) { var w = Math.floor(num(p.within) || 5); return Math.max(1, Math.min(CROSS_LOOKBACK, w)); }
  function crossTest(s, p, which) {
    var c = s.cross && s.cross[p.pair === '20/50' ? '20/50' : '50/200'];
    if (!c) return null;
    var slowNull = p.pair === '20/50' ? s.sma50 == null : s.sma200 == null;
    if (slowNull) return null;                  // not enough history to know
    var ago = c[which];
    return ago != null && ago < crossWithin(p);
  }
  function crossExplain(s, p, which) {
    var c = s.cross && s.cross[p.pair === '20/50' ? '20/50' : '50/200'], ago = c ? c[which] : null;
    if (ago == null) return T(which === 'golden' ? 'No recent golden cross' : 'No recent death cross');
    if (ago === 0) return T(which === 'golden' ? 'Golden cross today' : 'Death cross today');
    return T(which === 'golden' ? 'Golden cross {n} bars ago' : 'Death cross {n} bars ago', { n: ago });
  }

  var FILTER_BY_ID = {};
  FILTERS.forEach(function (f) { FILTER_BY_ID[f.id] = f; });

  /** Normalise [{id, params}] (or {id, ...params}) → [{id, params}] with defaults filled. Throws on unknown ids. */
  function normFilters(filters) {
    if (!filters) return [];
    if (!Array.isArray(filters)) filters = [filters];
    return filters.filter(Boolean).map(function (f) {
      if (typeof f === 'string') f = { id: f };
      var def = FILTER_BY_ID[f.id];
      if (!def) throw new Error('Unknown screener filter: ' + f.id);
      // No params at all → the catalogue defaults. Params given → choices (selects, lists, the cross window)
      // fall back to their defaults, but a missing numeric bound means "no bound", never a hidden default.
      var params = {};
      if (!f.params) params = Object.assign({}, def.defaults);
      else {
        def.params.forEach(function (pd) {
          var has = Object.prototype.hasOwnProperty.call(f.params, pd.key);
          var keepDefault = pd.type === 'select' || pd.type === 'multi' || pd.key === 'within';
          params[pd.key] = has ? f.params[pd.key] : (keepDefault && def.defaults[pd.key] !== undefined ? def.defaults[pd.key] : null);
        });
      }
      return { id: f.id, params: params };
    });
  }

  /** evaluate(snap, filters, match) → {pass, matched:[ids], results:[{id, ok}]} */
  function evaluate(snap, filters, match) {
    var list = normFilters(filters), matched = [], results = [];
    list.forEach(function (f) {
      var ok = null;
      try { ok = FILTER_BY_ID[f.id].test(snap, f.params); } catch (e) { ok = null; }
      results.push({ id: f.id, ok: ok });
      if (ok === true && matched.indexOf(f.id) < 0) matched.push(f.id);
    });
    var pass = !list.length ? true
      : match === 'any' ? results.some(function (r) { return r.ok === true; })
        : results.every(function (r) { return r.ok === true; });
    return { pass: pass, matched: matched, results: results };
  }

  /** describe(filters, match) → 'RSI(14) at most 30 and price above its SMA 200' (plain English, via BT.t). */
  function describe(filters, match) {
    var list;
    try { list = normFilters(filters); } catch (e) { return ''; }
    if (!list.length) return T('No filters: every symbol in the universe is listed.');
    var parts = list.map(function (f) { return FILTER_BY_ID[f.id].describe(f.params); });
    var joiner = match === 'any' ? T(' or ') : T(' and ');
    return T(match === 'any' ? 'Symbols with any of: {list}.' : 'Symbols with {list}.', { list: parts.join(joiner) });
  }

  /** Why a row matched: short text per filter. */
  function explain(snap, filters) {
    return normFilters(filters).map(function (f) {
      var def = FILTER_BY_ID[f.id];
      var ok = null; try { ok = def.test(snap, f.params); } catch (e) { /* ignore */ }
      return { id: f.id, ok: ok, text: def.explain ? def.explain(snap, f.params) : def.label };
    });
  }

  /* ------------------------------------------------------------------ *
   * Universe
   * ------------------------------------------------------------------ */
  var UNIVERSES = [
    { id: 'all', label: 'Whole demo universe' },
    { id: 'stock', label: 'Stocks only' },
    { id: 'etf', label: 'ETFs only' },
    { id: 'crypto', label: 'Crypto only' },
    { id: 'watchlist', label: 'My watchlist' }
  ];
  var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'AMZN'];   // js/app.js default
  function watchlist() {
    var wl = store.get('bt.watchlist', null);
    return Array.isArray(wl) ? wl.map(cleanSym).filter(Boolean) : DEFAULT_WATCHLIST.slice();
  }
  function metaFor(symbol) {
    var sym = cleanSym(symbol);
    var D = BT.data;
    var u = D && D.lookup ? D.lookup(sym) : null;
    var kind = (u && u.kind) || (D && D.kindOf ? D.kindOf(sym) : 'stock');
    return { symbol: sym, name: (u && u.name) || sym, sector: (u && u.sector) || '', kind: kind || 'stock' };
  }
  /** resolveUniverse(spec) → [{symbol, name, sector, kind}] */
  function resolveUniverse(spec) {
    var D = BT.data, all = (D && D.universe) || [];
    var list;
    if (spec == null || spec === 'all') list = all.map(function (u) { return u.symbol; });
    else if (spec === 'stock' || spec === 'etf' || spec === 'crypto') list = all.filter(function (u) { return (u.kind || 'stock') === spec; }).map(function (u) { return u.symbol; });
    else if (spec === 'watchlist') list = watchlist();
    else if (Array.isArray(spec)) {
      return dedupe(spec.map(function (x) {
        if (x && typeof x === 'object') {
          var m = metaFor(x.symbol);
          return { symbol: m.symbol, name: x.name || m.name, sector: x.sector != null ? x.sector : m.sector, kind: x.kind || m.kind };
        }
        return metaFor(x);
      }));
    } else list = asList(spec);
    return dedupe(list.map(metaFor));
  }
  function dedupe(items) {
    var seen = {}, out = [];
    items.forEach(function (m) { if (m && m.symbol && !seen[m.symbol]) { seen[m.symbol] = 1; out.push(m); } });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Built-in and saved scans
   * ------------------------------------------------------------------ */
  var BUILTINS = [
    {
      id: 'builtin:oversold-uptrend', builtin: true, name: 'Oversold in an uptrend',
      description: 'RSI(14) under 35 while price holds above its 200-day average: a pullback inside a long-term uptrend. Pullbacks can turn into reversals, so a plan needs a stop.',
      filters: [{ id: 'rsi', params: { min: null, max: 35 } }, { id: 'sma', params: { n: '200', side: 'above', minPct: null, maxPct: null } }]
    },
    {
      id: 'builtin:golden-week', builtin: true, name: 'Golden cross this week',
      description: 'SMA 50 crossed above SMA 200 in the last 5 bars. A slow, lagging trend signal: by the time it prints, much of the move may already have happened.',
      filters: [{ id: 'goldenCross', params: { pair: '50/200', within: 5 } }]
    },
    {
      id: 'builtin:squeeze', builtin: true, name: 'Squeeze setups',
      description: 'Bollinger Band width in the lowest 10 % of 120 bars. Volatility is coiled; the squeeze says a move may come, not which way.',
      filters: [{ id: 'squeeze', params: {} }]
    },
    {
      id: 'builtin:high52', builtin: true, name: '52-week highs',
      description: 'Names trading at a new one-year high today. Strength tends to persist for a while, yet breakouts also fail; study how each one got there.',
      filters: [{ id: 'high52', params: {} }]
    },
    {
      id: 'builtin:bull-engulfing', builtin: true, name: 'Bullish engulfing today',
      description: 'The latest candle is a bullish engulfing pattern. Most meaningful after a decline and on rising volume; wait for confirmation.',
      filters: [{ id: 'pattern', params: { name: 'Bullish engulfing' } }]
    },
    {
      id: 'builtin:strong-trend', builtin: true, name: 'Strong trend (ADX>25)',
      description: 'ADX(14) above 25: a strong trend in either direction. Check the price vs SMA 50 column to see which way it runs.',
      filters: [{ id: 'adx', params: { min: 25, max: null } }]
    }
  ];
  var SCANS_KEY = 'bt.screener.scans';
  var MAX_SAVED = 30;
  function savedScans() {
    var s = store.get(SCANS_KEY, []);
    return Array.isArray(s) ? s.filter(function (x) { return x && x.id && Array.isArray(x.filters); }) : [];
  }
  function scans() { return BUILTINS.map(cloneScan).concat(savedScans()); }
  function cloneScan(s) { return JSON.parse(JSON.stringify(s)); }
  function getScan(id) {
    var all = scans();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  /** saveScan({name, filters, universe, match, id?}) → saved scan (overwrites same id or same name). */
  function saveScan(scan) {
    scan = scan || {};
    var name = String(scan.name || '').trim().slice(0, 60);
    if (!name) throw new Error(T('Give the scan a name first.'));
    var filters = normFilters(scan.filters);
    var list = savedScans();
    var existing = list.filter(function (s) { return (scan.id && s.id === scan.id) || s.name.toLowerCase() === name.toLowerCase(); })[0];
    var rec = {
      id: existing ? existing.id : 'scan-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name: name, filters: filters,
      universe: typeof scan.universe === 'string' ? scan.universe : 'all',
      match: scan.match === 'any' ? 'any' : 'all',
      savedAt: new Date().toISOString()
    };
    if (existing) list = list.map(function (s) { return s.id === existing.id ? rec : s; });
    else {
      if (list.length >= MAX_SAVED) throw new Error(T('You can keep up to {n} saved scans. Delete one first.', { n: MAX_SAVED }));
      list.push(rec);
    }
    store.set(SCANS_KEY, list);
    return rec;
  }
  function deleteScan(id) {
    var list = savedScans(), next = list.filter(function (s) { return s.id !== id; });
    store.set(SCANS_KEY, next);
    return next.length !== list.length;
  }

  /* ------------------------------------------------------------------ *
   * Demo snapshot cache
   * ------------------------------------------------------------------ *
   * Demo snapshots are kept for 10 minutes — the same freshness BT.data gives cached live daily
   * candles — in memory and in localStorage ('bt.screener.cache', ≈ 50 KB for the whole
   * universe), so going back to the page or changing a filter rescans instantly.
   */
  var DEMO_TTL_MS = 10 * 60 * 1000;
  var CACHE_KEY = 'bt.screener.cache';
  var MEMO_MAX = 200;
  var memo = new Map(), memoLoaded = false, memoDirty = false;
  function memoKey(sym, interval, limit) { return sym + '|' + interval + '|' + limit; }
  function memoLoad() {
    if (memoLoaded) return;
    memoLoaded = true;
    var c = store.get(CACHE_KEY, null), now = nowMs();
    if (!c || c.v !== 1 || !c.entries || typeof c.entries !== 'object') return;
    Object.keys(c.entries).forEach(function (k) {
      var e = c.entries[k];
      if (e && e.snap && isNum(e.at) && now - e.at < DEMO_TTL_MS && now >= e.at) memo.set(k, e);
    });
  }
  function memoGet(k) {
    var e = memo.get(k);
    if (!e) return null;
    if (nowMs() - e.at >= DEMO_TTL_MS || nowMs() < e.at) { memo.delete(k); return null; }
    return e.snap;
  }
  function memoSet(k, snap) {
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
    memo.set(k, { at: nowMs(), snap: snap });
    memoDirty = true;
  }
  function memoSave() {
    if (!memoDirty) return;
    memoDirty = false;
    var entries = {}, now = nowMs();
    memo.forEach(function (e, k) { if (now - e.at < DEMO_TTL_MS) entries[k] = e; });
    store.set(CACHE_KEY, { v: 1, entries: entries });
  }
  function clearMemo() { memo.clear(); memoDirty = false; memoLoaded = true; try { root.localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------ *
   * Worker pool (demo provider only)
   * ------------------------------------------------------------------ *
   * Workers pull two symbols at a time from a shared queue, so a slow worker never holds up the
   * rest; the main thread pulls from the same queue between UI frames.
   */
  var pool = null, poolBroken = false, jobSeq = 0;
  function workersPossible() {
    if (IS_WORKER || poolBroken || !SCRIPT_URL) return false;
    if (typeof Worker !== 'function') return false;
    try { return typeof location !== 'undefined' && /^https?:$/.test(location.protocol); } catch (e) { return false; }
  }
  function poolSize() {
    var hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return Math.max(1, Math.min(6, hc - 1));
  }
  function getPool() {
    if (pool) return pool;
    if (!workersPossible()) return null;
    var size = poolSize(), ws = [];
    try {
      for (var i = 0; i < size; i++) {
        var w = new Worker(SCRIPT_URL);
        w._pending = {};
        w.onmessage = onWorkerMessage;
        w.onerror = onWorkerError;
        ws.push(w);
      }
    } catch (e) {
      ws.forEach(function (x) { try { x.terminate(); } catch (er) { /* ignore */ } });
      poolBroken = true; return null;
    }
    pool = ws;
    return pool;
  }
  /** Spawn the workers early (they load data.js + indicators.js while the page renders). */
  function prestart() {
    var D = BT.data;
    try { if (D && D.status && D.status().provider !== 'demo') return false; } catch (e) { return false; }
    return !!getPool();
  }
  function onWorkerMessage(ev) {
    var m = ev.data || {}, w = this;
    if (m.type === 'fatal') { failWorker(w, new Error(m.error || 'worker failed')); return; }
    var job = w._pending[m.id];
    if (!job) return;
    if (m.type === 'progress') { job.onItem(m.item); return; }
    if (m.type === 'done') { delete w._pending[m.id]; job.resolve(); }
  }
  function onWorkerError(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    failWorker(this, new Error((ev && ev.message) || 'worker error'));
  }
  function failWorker(w, err) {
    poolBroken = true;
    var ws = pool || [w];
    terminatePool();
    ws.forEach(function (x) {
      Object.keys(x._pending || {}).forEach(function (id) { var j = x._pending[id]; delete x._pending[id]; j.reject(err); });
    });
  }
  function terminatePool() {
    if (!pool) return;
    pool.forEach(function (w) { try { w.terminate(); } catch (e) { /* ignore */ } });
    pool = null;
  }

  /**
   * Drain `queue` (array of metas, consumed from the front) with the worker pool.
   * Calls onItem({symbol, snap?, error?}) per symbol. Resolves when every worker is idle;
   * rejects if the pool breaks (symbols in flight are then simply not reported).
   */
  function poolDrain(queue, interval, limit, tNow, onItem, stopped) {
    var ws = getPool();
    if (!ws) return Promise.reject(new Error('workers unavailable'));
    return new Promise(function (resolve, reject) {
      var busy = 0, finished = false;
      var timer = setTimeout(function () { fail(new Error('workers timed out')); }, 20000);
      function fail(e) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        poolBroken = true; terminatePool();
        reject(e);
      }
      function settle() { if (!finished && busy === 0 && (!queue.length || stopped())) { finished = true; clearTimeout(timer); resolve(); } }
      function pump(w) {
        if (finished) return;
        if (!queue.length || stopped()) { settle(); return; }
        var items = queue.splice(0, 2), id = ++jobSeq;
        busy++;
        w._pending[id] = {
          onItem: function (item) { if (!finished) onItem(item); },
          resolve: function () { busy--; pump(w); },
          reject: fail
        };
        try { w.postMessage({ type: 'scan', id: id, metas: items, interval: interval, limit: limit, nowMs: tNow }); }
        catch (e) { fail(e); }
      }
      ws.forEach(pump);
      settle();
    });
  }

  if (IS_WORKER) {
    self.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type !== 'scan') return;
      (m.metas || []).forEach(function (meta) {
        var item = { symbol: meta.symbol };
        try { item.snap = snapshot(BT.data.demo(meta.symbol, m.interval, m.limit, m.nowMs), meta); }
        catch (e) { item.error = String(e && e.message || e); }
        self.postMessage({ type: 'progress', id: m.id, item: item });
      });
      self.postMessage({ type: 'done', id: m.id });
    };
  }

  /* ------------------------------------------------------------------ *
   * run()
   * ------------------------------------------------------------------ */
  function defaultSleep(ms, signal) {
    return new Promise(function (resolve) {
      var t = setTimeout(done, ms);
      function done() { clearTimeout(t); if (signal && signal.removeEventListener) signal.removeEventListener('abort', done); resolve(); }
      if (signal && signal.addEventListener) signal.addEventListener('abort', done);
    });
  }
  function yieldTick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function nowMs() { return Date.now(); }
  function perfNow() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  /** The default limiter: BT.data's per-provider limiter + response cache. */
  function dataLimiter(provider, interval, limit) {
    var D = BT.data;
    return {
      provider: provider,
      isCached: function (sym) {
        try {
          var key = 'c|' + provider + '|' + (D.normSymbol ? D.normSymbol(sym) : sym) + '|' + interval + '|' + limit;
          return !!(D._internal && D._internal.cacheGet && D._internal.cacheGet(key));
        } catch (e) { return false; }
      },
      check: function () { return D.rateCheck ? D.rateCheck(provider) : { ok: true }; }
    };
  }

  /**
   * run(universe, filters, opts) → Promise<rows>. Rows are sorted by symbol in universe order;
   * the UI re-sorts. Never throws for a single bad symbol: it lands in rows.errors.
   */
  async function run(universe, filters, opts) {
    opts = opts || {};
    var t0 = perfNow();
    var D = BT.data;
    var interval = opts.interval || '1day';
    var limit = opts.limit || LIMIT[interval] || 400;
    var match = opts.match === 'any' ? 'any' : 'all';
    var list = normFilters(filters);
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var signal = opts.signal || null;
    var sleep = opts.sleep || defaultSleep;
    var metas = resolveUniverse(universe);
    var rows = [];
    rows.total = metas.length; rows.scanned = 0; rows.skipped = []; rows.errors = []; rows.simulated = 0; rows.cancelled = false;

    // 1) static filters (sector, type) need no data: drop non-matching symbols before any request.
    var staticList = list.filter(function (f) { return FILTER_BY_ID[f.id].static; });
    var todo = metas;
    if (staticList.length && match === 'all') {
      todo = metas.filter(function (m) { return evaluate(m, staticList, 'all').pass; });
    }
    rows.total = todo.length;

    var defaultFetch = !opts.fetch || (D && opts.fetch === D.candles);
    var fetch = opts.fetch || (D && D.candles);
    var provider = 'custom';
    if (defaultFetch) {
      if (!D) throw new Error('BT.data (js/data.js) must be loaded to scan without a custom fetch');
      provider = (D.status ? D.status().provider : (D.getSettings().provider || 'demo'));
    }
    var demoMode = defaultFetch && provider === 'demo';
    var limiter = opts.limiter || (defaultFetch && !demoMode ? dataLimiter(provider, interval, limit) : null);
    var done = 0;
    var snaps = {};
    function progress(extra) {
      onProgress(Object.assign({ done: done, total: todo.length, matches: countMatches(), mode: rows.mode }, extra || {}));
    }
    var matchCount = 0;
    function countMatches() { return matchCount; }
    function accept(meta, snap, extra) {
      snaps[meta.symbol] = snap;
      var ev = evaluate(snap, list, match);
      if (ev.pass) matchCount++;
      if (extra) snaps[meta.symbol]._extra = extra;
    }

    if (demoMode) {
      memoLoad();
      var tNow = nowMs();
      var need = [];
      todo.forEach(function (m) {
        var hit = memoGet(memoKey(m.symbol, interval, limit));
        if (hit) { accept(m, Object.assign({}, hit, { name: m.name, sector: m.sector, kind: m.kind })); done++; }
        else need.push(m);
      });
      rows.mode = 'demo';
      if (done) progress({ phase: 'fetch' });
      var stopped = function () { return !!(signal && signal.aborted); };
      var handled = {};
      var onSnap = function (m, snap, err) {
        if (handled[m.symbol]) return;
        handled[m.symbol] = true;
        if (err || !snap) rows.errors.push({ symbol: m.symbol, reason: err || 'no data' });
        else { memoSet(memoKey(m.symbol, interval, limit), snap); accept(m, snap); }
        done++;
        progress({ phase: 'fetch', symbol: m.symbol });
      };
      var queue0 = need.slice();
      var useWorkers = opts.workers !== false && need.length >= 6 && workersPossible();
      var poolP = null;
      if (useWorkers) {
        rows.mode = 'demo-workers';
        var byMeta = {};
        need.forEach(function (m) { byMeta[m.symbol] = m; });
        poolP = poolDrain(queue0, interval, limit, tNow, function (item) {
          var m = byMeta[item.symbol]; if (m) onSnap(m, item.snap, item.error);
        }, stopped).then(function () { return true; }, function () { return false; });
      }
      // Main thread pulls from the same queue in short slices so the page stays responsive.
      var sliceStart = perfNow();
      while (queue0.length) {
        if (stopped()) break;
        var m = queue0.shift();
        try { onSnap(m, snapshot(D.demo(m.symbol, interval, limit, tNow), m)); }
        catch (e) { onSnap(m, null, String(e && e.message || e)); }
        if (poolP || perfNow() - sliceStart > 40) { await yieldTick(); sliceStart = perfNow(); }
      }
      if (poolP) {
        var poolOk = await poolP;
        if (!poolOk) {
          rows.mode = 'demo';
          // The pool broke: finish whatever it never reported, on the main thread.
          var rest = need.filter(function (x) { return !handled[x.symbol]; });
          for (var r2 = 0; r2 < rest.length; r2++) {
            if (stopped()) break;
            try { onSnap(rest[r2], snapshot(D.demo(rest[r2].symbol, interval, limit, tNow), rest[r2])); }
            catch (e) { onSnap(rest[r2], null, String(e && e.message || e)); }
            if (perfNow() - sliceStart > 40) { await yieldTick(); sliceStart = perfNow(); }
          }
        }
      }
      if (stopped()) {
        rows.cancelled = true;
        need.forEach(function (x) { if (!handled[x.symbol]) rows.skipped.push({ symbol: x.symbol, reason: T('Scan cancelled') }); });
      }
      memoSave();
    } else {
      rows.mode = defaultFetch ? 'live' : 'custom';
      var concurrency = limiter ? 1 : Math.max(1, Math.min(8, opts.concurrency || 4));
      var queue = todo.slice();
      var stopReason = null;
      var worker = async function () {
        while (queue.length) {
          if (signal && signal.aborted) { rows.cancelled = true; return; }
          if (stopReason) return;
          var meta = queue.shift();
          var bars = null, attempt = 0;
          try {
            while (true) {
              if (limiter && !(limiter.isCached && limiter.isCached(meta.symbol))) {
                var rc = limiter.check() || { ok: true };
                if (!rc.ok) {
                  var wait = isNum(rc.retryInMs) ? rc.retryInMs : 60000;
                  if (wait > 90000) { stopReason = rc.reason || T('The data provider\'s daily limit is used up.'); queue.unshift(meta); return; }
                  progress({ phase: 'wait', waitMs: wait, symbol: meta.symbol, reason: rc.reason });
                  await sleep(wait, signal);
                  if (signal && signal.aborted) { rows.cancelled = true; queue.unshift(meta); return; }
                  continue;
                }
              }
              progress({ phase: 'fetch', symbol: meta.symbol });
              bars = await fetch(meta.symbol, interval, limit);
              // BT.data fell back to demo bars because the limiter refused at the last moment: wait and retry once.
              if (limiter && bars && bars.fallback && bars.code === 'rate_limit' && attempt < 1 && !(bars.retryInMs > 90000)) {
                attempt++;
                var w2 = isNum(bars.retryInMs) ? bars.retryInMs : 60000;
                progress({ phase: 'wait', waitMs: w2, symbol: meta.symbol, reason: bars.reason });
                await sleep(w2, signal);
                if (signal && signal.aborted) { rows.cancelled = true; queue.unshift(meta); return; }
                continue;
              }
              break;
            }
            if (!bars || !bars.length) throw new Error(T('No bars returned'));
            var snap = snapshot(bars, meta);
            accept(meta, snap, bars.fallback ? { simulated: true, reason: bars.reason || '' } : null);
          } catch (e) {
            rows.errors.push({ symbol: meta.symbol, reason: String(e && e.message || e) });
          }
          done++;
          progress({ phase: 'fetch', symbol: meta.symbol });
        }
      };
      var runners = [];
      for (var r = 0; r < concurrency; r++) runners.push(worker());
      await Promise.all(runners);
      if (stopReason) queue.forEach(function (m) { rows.skipped.push({ symbol: m.symbol, reason: stopReason }); });
      else if (rows.cancelled) queue.forEach(function (m) { rows.skipped.push({ symbol: m.symbol, reason: T('Scan cancelled') }); });
      rows.stopReason = stopReason;
    }

    // 2) build rows in universe order
    todo.forEach(function (m) {
      var snap = snaps[m.symbol];
      if (!snap) return;
      rows.scanned++;
      var ev = evaluate(snap, list, match);
      if (snap._extra && snap._extra.simulated) rows.simulated++;
      if (!ev.pass) return;
      rows.push(toRow(snap, ev.matched, list));
    });
    rows.elapsedMs = Math.round(perfNow() - t0);
    rows.filters = list; rows.match = match; rows.interval = interval;
    progress({ phase: 'done', done: todo.length - rows.skipped.length });
    return rows;
  }

  function toRow(snap, matched, list) {
    var ex = snap._extra || {};
    return {
      symbol: snap.symbol, name: snap.name, sector: snap.sector, kind: snap.kind,
      price: snap.price, chg1d: snap.chg1d, chg5d: snap.chg5d, chg1m: snap.chg1m, avgVol: snap.avgVol,
      rsi: isNum(snap.rsi) ? round(snap.rsi, 2) : null, adx: isNum(snap.adx) ? round(snap.adx, 2) : null,
      sma50Pct: snap.sma50Pct, sma200Pct: snap.sma200Pct,
      signal: snap.signal, score: snap.score,
      patterns: (snap.patterns || []).map(function (p) { return p.name; }),
      newHigh52: snap.newHigh52, newLow52: snap.newLow52, squeeze: snap.squeeze, bwRank: snap.bwRank,
      time: snap.time,
      matched: matched.slice(),
      why: explain(snap, list).filter(function (x) { return x.ok === true; }).map(function (x) { return x.text; }),
      simulated: !!ex.simulated, reason: ex.reason || ''
    };
  }

  /** Start workers and fill the memo in the background so the first scan feels instant. */
  function warm(universe) {
    var D = BT.data;
    if (!D || (D.status && D.status().provider !== 'demo')) return Promise.resolve(false);
    return run(universe || 'all', [], { onProgress: null }).then(function () { return true; }, function () { return false; });
  }

  /** Sort rows in place by a key ('symbol', 'price', 'chg1d', 'rsi', ...). Nulls last. */
  function sortRows(rows, key, dir) {
    var mul = dir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (key === 'signal') { x = a.score; y = b.score; }
      if (key === 'patterns') { x = (a.patterns || []).join(','); y = (b.patterns || []).join(','); }
      var xn = x == null || x === '' || (typeof x === 'number' && !isFinite(x));
      var yn = y == null || y === '' || (typeof y === 'number' && !isFinite(y));
      if (xn && yn) return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
      if (xn) return 1;
      if (yn) return -1;
      if (typeof x === 'string' || typeof y === 'string') { var c = String(x).localeCompare(String(y)); return c * mul || (a.symbol < b.symbol ? -1 : 1); }
      if (x === y) return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
      return (x < y ? -1 : 1) * mul;
    });
    return rows;
  }

  BT.screener = {
    filters: FILTER_BY_ID,
    filterList: FILTERS,
    run: run,
    snapshot: snapshot,
    evaluate: evaluate,
    describe: describe,
    explain: explain,
    normFilters: normFilters,
    builtins: BUILTINS,
    scans: scans,
    savedScans: savedScans,
    getScan: getScan,
    saveScan: saveScan,
    deleteScan: deleteScan,
    universes: UNIVERSES,
    resolveUniverse: resolveUniverse,
    watchlist: watchlist,
    sortRows: sortRows,
    warm: warm,
    format: { pct: fmtPct, num: fmtNum, price: fmtPrice, vol: fmtVol },
    PATTERN_NAMES: PATTERN_NAMES,
    SCANS_KEY: SCANS_KEY,
    LIMIT: LIMIT,
    prestart: prestart,
    _internal: { crossInfo: crossInfo, memo: memo, clearMemo: clearMemo, workersPossible: workersPossible, terminatePool: terminatePool, DEMO_TTL_MS: DEMO_TTL_MS },
    version: '0.5.0'
  };
})();
