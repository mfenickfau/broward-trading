/* Broward Trading — js/backtest.js → BT.backtest
 * Strategy backtesting engine for the Strategy Lab (backtest.html) and the course.
 *
 * Plain ES2020, no imports, no DOM. Attaches to window.BT.backtest.
 * Depends (softly) on js/indicators.js (BT.ind). If BT.ind is missing the
 * module falls back to small built-in versions of the few indicators the
 * built-in strategies need, so it stays loadable standalone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEACHING NOTE 1 — what a backtest is (and is not)
 * A backtest replays history bar by bar and asks: "if I had followed these
 * rules mechanically, what would have happened?" It measures the *past*
 * behaviour of a rule set. It does not predict the future. Markets change
 * regime (trending → ranging → crashing), so a rule that looked great over
 * one window can lose money in the next. Treat every result here as evidence,
 * never as proof.
 *
 * TEACHING NOTE 2 — look-ahead bias (the #1 rookie backtest bug)
 * A signal computed from bar i uses bar i's CLOSE (the RSI, the moving
 * average, the MACD all need the closing price). In real life you only know
 * that close once the bar has finished — so you cannot possibly have bought
 * at that same close. This engine therefore fills every order at the OPEN of
 * the NEXT bar (i + 1). Fill at bar i's close and you silently assume you can
 * see the future by one bar; over hundreds of trades that fantasy adds up to
 * returns you will never get in a live account.
 * Related traps: indicators that peek forward (pivot highs/lows need `right`
 * bars after the point to confirm, so `ind.pivots` and `ind.supportResistance`
 * computed over the whole series are NOT safe for bar-by-bar decisions), and
 * survivorship bias (testing only on companies that still exist today).
 *
 * TEACHING NOTE 3 — overfitting (curve fitting)
 * With enough knobs you can make any strategy look perfect on any history —
 * you are then describing the past, not finding an edge. Defences:
 *   • prefer few parameters and round-ish values (SMA 20/50, not 23/47);
 *   • demand many trades (statistics on 5 trades mean nothing);
 *   • hold out data: tune on the first 70 % (in-sample), then check the last
 *     30 % you never looked at (out-of-sample) — see optimize({oosPct});
 *   • look for a smooth plateau of good parameters, not one spiky winner;
 *   • include realistic costs (commission + slippage): many "edges" vanish.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;

  /* ───────────────────────── small math / time helpers ───────────────────── */

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function round(x, d) { if (!isNum(x)) return null; var p = Math.pow(10, d == null ? 2 : d); return Math.round(x * p) / p; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /** Bar time → unix seconds. Accepts 'YYYY-MM-DD', unix seconds, unix ms, or
   *  lightweight-charts {year, month, day}. */
  function timeToSeconds(t) {
    if (t == null) return NaN;
    if (typeof t === 'number') return t > 1e11 ? Math.floor(t / 1000) : t;  // ms → s
    if (typeof t === 'string') {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
      var d = Date.parse(t); return isNaN(d) ? NaN : Math.floor(d / 1000);
    }
    if (typeof t === 'object' && t.year) return Date.UTC(t.year, t.month - 1, t.day) / 1000;
    return NaN;
  }

  /** Median spacing between bars, in seconds (ignores gaps > 10× the median
   *  so weekends/holidays do not distort intraday series). */
  function medianBarSeconds(bars) {
    var ds = [];
    for (var i = 1; i < bars.length; i++) {
      var d = timeToSeconds(bars[i].time) - timeToSeconds(bars[i - 1].time);
      if (isNum(d) && d > 0) ds.push(d);
    }
    if (!ds.length) return 86400;
    ds.sort(function (a, b) { return a - b; });
    return ds[Math.floor(ds.length / 2)];
  }

  /** How many bars make a trading year — needed to annualise Sharpe.
   *  Daily → 252 sessions; weekly → 52; intraday → 252 sessions × 6.5 h.  */
  function barsPerYear(bars) {
    var s = medianBarSeconds(bars);
    if (s >= 6 * 86400) return 52;                 // weekly or slower
    if (s >= 0.9 * 86400) return 252;              // daily
    return Math.round(252 * (6.5 * 3600) / s);     // intraday: 390 min per session
  }

  /** Calendar years between first and last bar, from their timestamps. */
  function spanYears(bars) {
    if (!bars || bars.length < 2) return 0;
    var a = timeToSeconds(bars[0].time), b = timeToSeconds(bars[bars.length - 1].time);
    if (!isNum(a) || !isNum(b) || b <= a) return 0;
    return (b - a) / (365.25 * 86400);
  }

  function mean(xs) { if (!xs.length) return 0; var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s / xs.length; }
  function stdev(xs) {
    if (xs.length < 2) return 0;
    var m = mean(xs), s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return Math.sqrt(s / (xs.length - 1));
  }

  /* ─────────────── indicator access (BT.ind preferred, fallback inside) ───── */

  function fbSma(values, n) {
    var out = new Array(values.length).fill(null), sum = 0, cnt = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i]; if (isNum(v)) { sum += v; cnt++; }
      if (i >= n) { var o = values[i - n]; if (isNum(o)) { sum -= o; cnt--; } }
      out[i] = (i >= n - 1 && cnt === n) ? sum / n : null;
    }
    return out;
  }
  function fbEma(values, n) {
    var out = new Array(values.length).fill(null), k = 2 / (n + 1), prev = null, seed = [], i;
    for (i = 0; i < values.length; i++) {
      var v = values[i]; if (!isNum(v)) { out[i] = prev; continue; }
      if (prev == null) { seed.push(v); if (seed.length === n) { prev = mean(seed); out[i] = prev; } continue; }
      prev = v * k + prev * (1 - k); out[i] = prev;
    }
    return out;
  }
  function fbRsi(values, n) {
    n = n || 14;
    var out = new Array(values.length).fill(null), ag = 0, al = 0, i;
    for (i = 1; i < values.length; i++) {
      var ch = values[i] - values[i - 1], g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      if (i <= n) { ag += g / n; al += l / n; if (i === n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); continue; }
      ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }
  function fbMacd(values, fast, slow, sig) {
    var f = fbEma(values, fast || 12), s = fbEma(values, slow || 26), line = values.map(function (_, i) { return isNum(f[i]) && isNum(s[i]) ? f[i] - s[i] : null; });
    var signal = fbEma(line.map(function (v) { return v == null ? NaN : v; }), sig || 9);
    var hist = line.map(function (v, i) { return isNum(v) && isNum(signal[i]) ? v - signal[i] : null; });
    return { macd: line, signal: signal.map(function (v) { return isNum(v) ? v : null; }), hist: hist };
  }
  function fbBollinger(values, n, k) {
    n = n || 20; k = k == null ? 2 : k;
    var mid = fbSma(values, n), up = [], lo = [], bw = [];
    for (var i = 0; i < values.length; i++) {
      if (!isNum(mid[i])) { up.push(null); lo.push(null); bw.push(null); continue; }
      var w = values.slice(i - n + 1, i + 1), sd = Math.sqrt(mean(w.map(function (v) { return (v - mid[i]) * (v - mid[i]); })));
      up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); bw.push(mid[i] ? (2 * k * sd) / mid[i] : null);
    }
    return { upper: up, middle: mid, lower: lo, bandwidth: bw };
  }

  function ind() { return BT.ind || null; }
  function closes(bars) { return bars.map(function (b) { return b.close; }); }

  /**
   * Build the indicator context once per run. Uses BT.ind.computeAll when it is
   * loaded (full set: sma20/50/200, ema9/21, rsi, macd, bollinger, atr, adx…)
   * and otherwise a minimal fallback with the same field names.
   */
  function buildInd(bars) {
    var I = ind(), c = closes(bars), out;
    if (I && typeof I.computeAll === 'function') out = I.computeAll(bars);
    else {
      out = {
        bars: bars, closes: c,
        sma20: fbSma(c, 20), sma50: fbSma(c, 50), sma200: fbSma(c, 200),
        ema9: fbEma(c, 9), ema21: fbEma(c, 21),
        rsi: fbRsi(c, 14), macd: fbMacd(c, 12, 26, 9), bollinger: fbBollinger(c, 20, 2)
      };
    }
    // Memoised helpers strategies may call for custom lengths: ctx.ind.smaN(n)
    var cache = {};
    out.smaN = function (n) { return cache['sma' + n] || (cache['sma' + n] = (I && I.sma ? I.sma(c, n) : fbSma(c, n))); };
    out.emaN = function (n) { return cache['ema' + n] || (cache['ema' + n] = (I && I.ema ? I.ema(c, n) : fbEma(c, n))); };
    out.rsiN = function (n) { return cache['rsi' + n] || (cache['rsi' + n] = (I && I.rsi ? I.rsi(c, n) : fbRsi(c, n))); };
    /* Highest high / lowest low over the PREVIOUS n bars, excluding the
     * current bar — so a breakout test at bar i only sees bars i-n … i-1.
     * (Including bar i would make every new high "break out" of itself.) */
    out.priorHigh = function (n) {
      var key = 'ph' + n; if (cache[key]) return cache[key];
      var o = new Array(bars.length).fill(null);
      for (var i = n; i < bars.length; i++) { var m = -Infinity; for (var j = i - n; j < i; j++) if (bars[j].high > m) m = bars[j].high; o[i] = m; }
      return (cache[key] = o);
    };
    out.priorLow = function (n) {
      var key = 'pl' + n; if (cache[key]) return cache[key];
      var o = new Array(bars.length).fill(null);
      for (var i = n; i < bars.length; i++) { var m = Infinity; for (var j = i - n; j < i; j++) if (bars[j].low < m) m = bars[j].low; o[i] = m; }
      return (cache[key] = o);
    };
    return out;
  }

  /* ───────────────────────────── built-in strategies ─────────────────────── */

  /** Crossing helpers: true when series a crosses above / below series b at i. */
  function crossUp(a, b, i) {
    if (i < 1) return false;
    var a0 = a[i - 1], a1 = a[i], b0 = typeof b === 'number' ? b : b[i - 1], b1 = typeof b === 'number' ? b : b[i];
    return isNum(a0) && isNum(a1) && isNum(b0) && isNum(b1) && a0 <= b0 && a1 > b1;
  }
  function crossDown(a, b, i) {
    if (i < 1) return false;
    var a0 = a[i - 1], a1 = a[i], b0 = typeof b === 'number' ? b : b[i - 1], b1 = typeof b === 'number' ? b : b[i];
    return isNum(a0) && isNum(a1) && isNum(b0) && isNum(b1) && a0 >= b0 && a1 < b1;
  }

  /** Factories accept positional args OR a single params object, so
   *  optimize() can call `factory({fast:10, slow:50})` uniformly. */
  function argsOf(args, names, defaults) {
    var p = {}, i;
    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
      for (i = 0; i < names.length; i++) p[names[i]] = args[0][names[i]] != null ? args[0][names[i]] : defaults[i];
    } else {
      for (i = 0; i < names.length; i++) p[names[i]] = args[i] != null ? args[i] : defaults[i];
    }
    return p;
  }

  /**
   * smaCross(fast=20, slow=50) — the classic trend follower.
   * Buy when the fast SMA crosses above the slow SMA ("golden cross" at 50/200),
   * sell/short when it crosses below ("death cross"). Lags by design: it will
   * never catch the exact turn, but it keeps you on the right side of long
   * trends and out of long bear markets. Whipsaws in sideways markets.
   */
  function smaCross() {
    var p = argsOf(arguments, ['fast', 'slow'], [20, 50]);
    if (p.fast >= p.slow) { var t = p.fast; p.fast = p.slow; p.slow = t; }
    return {
      id: 'smaCross', name: 'SMA crossover (' + p.fast + '/' + p.slow + ')',
      description: 'Trend following. Go long when the ' + p.fast + '-bar SMA crosses above the ' + p.slow + '-bar SMA; exit (or short) when it crosses back below. Expect many small losses in choppy markets paid for by a few large trend wins.',
      params: p,
      onBar: function (ctx, i) {
        var f = ctx.ind.smaN(p.fast), s = ctx.ind.smaN(p.slow);
        if (crossUp(f, s, i)) return 'buy';
        if (crossDown(f, s, i)) return 'sell';
        return null;
      }
    };
  }

  /**
   * rsiReversion(low=30, high=70, n=14) — mean reversion.
   * Buy when RSI climbs back up through `low` (oversold bounce), sell/short when
   * it falls back down through `high` (overbought fade). Works in ranges, gets
   * run over in strong trends (RSI can stay above 70 for weeks in a bull run).
   */
  function rsiReversion() {
    var p = argsOf(arguments, ['low', 'high', 'n'], [30, 70, 14]);
    return {
      id: 'rsiReversion', name: 'RSI reversion (' + p.low + '/' + p.high + ')',
      description: 'Mean reversion. Buy when the ' + p.n + '-bar RSI crosses back above ' + p.low + ' after being oversold; sell when it crosses back below ' + p.high + ' after being overbought. Best in sideways markets; dangerous in strong trends.',
      params: p,
      onBar: function (ctx, i) {
        var r = ctx.ind.rsiN(p.n);
        if (crossUp(r, p.low, i)) return 'buy';
        if (crossDown(r, p.high, i)) return 'sell';
        return null;
      }
    };
  }

  /**
   * macdCross(fast=12, slow=26, signal=9) — momentum.
   * Buy when the MACD line crosses above its signal line, sell when it crosses
   * below. Equivalent to watching the histogram flip sign.
   */
  function macdCross() {
    var p = argsOf(arguments, ['fast', 'slow', 'signal'], [12, 26, 9]);
    return {
      id: 'macdCross', name: 'MACD cross (' + p.fast + ',' + p.slow + ',' + p.signal + ')',
      description: 'Momentum. Buy when the MACD line crosses above its signal line (histogram turns positive); sell when it crosses below. Faster than an SMA crossover, so more trades and more false starts.',
      params: p,
      onBar: function (ctx, i) {
        var m = ctx.ind._macdCache || (ctx.ind._macdCache = (p.fast === 12 && p.slow === 26 && p.signal === 9 && ctx.ind.macd) ? ctx.ind.macd
          : (ind() && ind().macd ? ind().macd(ctx.ind.closes, p.fast, p.slow, p.signal) : fbMacd(ctx.ind.closes, p.fast, p.slow, p.signal)));
        if (crossUp(m.macd, m.signal, i)) return 'buy';
        if (crossDown(m.macd, m.signal, i)) return 'sell';
        return null;
      }
    };
  }

  /**
   * bollingerBounce(n=20, k=2) — volatility mean reversion.
   * Buy when the close re-enters the bands from below the lower band; sell when
   * it re-enters from above the upper band. Trading the touch itself is a common
   * beginner mistake: in a strong trend price can "walk the band" for weeks.
   */
  function bollingerBounce() {
    var p = argsOf(arguments, ['n', 'k'], [20, 2]);
    return {
      id: 'bollingerBounce', name: 'Bollinger bounce (' + p.n + ', ' + p.k + 'σ)',
      description: 'Mean reversion on volatility bands. Buy when price closes back inside the bands after closing below the lower band; sell when it closes back inside after closing above the upper band. Waiting for the re-entry filters out some "walking the band" trends.',
      params: p,
      onBar: function (ctx, i) {
        if (i < 1) return null;
        var bb = ctx.ind._bbCache || (ctx.ind._bbCache = (p.n === 20 && p.k === 2 && ctx.ind.bollinger) ? ctx.ind.bollinger
          : (ind() && ind().bollinger ? ind().bollinger(ctx.ind.closes, p.n, p.k) : fbBollinger(ctx.ind.closes, p.n, p.k)));
        var c0 = ctx.bars[i - 1].close, c1 = ctx.bars[i].close;
        var lo0 = bb.lower[i - 1], lo1 = bb.lower[i], up0 = bb.upper[i - 1], up1 = bb.upper[i];
        if (!isNum(lo0) || !isNum(lo1) || !isNum(up0) || !isNum(up1)) return null;
        if (c0 < lo0 && c1 >= lo1) return 'buy';
        if (c0 > up0 && c1 <= up1) return 'sell';
        return null;
      }
    };
  }

  /**
   * breakout(n=20) — Donchian-style channel breakout (the "Turtle" idea).
   * Buy when the close exceeds the highest high of the previous n bars; sell /
   * short when it falls below the lowest low of the previous n bars. Uses only
   * bars BEFORE the current one, so there is no self-reference look-ahead.
   */
  function breakout() {
    var p = argsOf(arguments, ['n'], [20]);
    return {
      id: 'breakout', name: p.n + '-bar breakout',
      description: 'Trend following via price channels. Buy when today\'s close is above the highest high of the previous ' + p.n + ' bars; sell when it is below the lowest low of the previous ' + p.n + ' bars. Catches big moves early, with many small false breakouts.',
      params: p,
      onBar: function (ctx, i) {
        var hi = ctx.ind.priorHigh(p.n)[i], lo = ctx.ind.priorLow(p.n)[i], c = ctx.bars[i].close;
        if (!isNum(hi) || !isNum(lo)) return null;
        if (c > hi) return 'buy';
        if (c < lo) return 'sell';
        return null;
      }
    };
  }

  /**
   * compositeSignal(buyAt=+3, sellAt=−3) — the dashboard's own ±8 score.
   * Follows exactly what the Signal card on index.html says: BUY when the
   * composite score reaches `buyAt`, SELL at `sellAt`. A good way for students
   * to discover how a "reasonable looking" signal actually performs with costs.
   * Falls back to an SMA 20/50 crossover when BT.ind is not loaded.
   */
  function compositeSignal() {
    var p = argsOf(arguments, ['buyAt', 'sellAt'], [3, -3]);
    return {
      id: 'compositeSignal', name: 'Composite signal (≥' + p.buyAt + ' / ≤' + p.sellAt + ')',
      description: 'Trades the dashboard\'s composite indicator score (−8…+8): buy when the score reaches ' + p.buyAt + ', sell when it drops to ' + p.sellAt + '. Because the score re-fires every bar, the engine ignores repeated signals while already positioned.',
      params: p,
      onBar: function (ctx, i) {
        var I = ind();
        if (!I || typeof I.signals !== 'function') {
          var f = ctx.ind.smaN(20), s = ctx.ind.smaN(50);
          return crossUp(f, s, i) ? 'buy' : crossDown(f, s, i) ? 'sell' : null;
        }
        var scores = ctx.ind._scoreCache;
        if (!scores) {
          scores = ctx.ind._scoreCache = typeof I.scoreSeries === 'function' ? I.scoreSeries(ctx.bars, ctx.ind)
            : ctx.bars.map(function (_, k) { return I.signals(ctx.bars, ctx.ind, k).score; });
        }
        var sc = scores[i];
        if (!isNum(sc)) return null;
        if (sc >= p.buyAt) return 'buy';
        if (sc <= p.sellAt) return 'sell';
        return null;
      }
    };
  }

  /**
   * buyAndHold — the benchmark every active strategy must beat.
   * Buys on the first bar the engine consults (so it also works after a warm-up
   * / out-of-sample startIndex) and never sells. State-based rather than
   * index-based: repeated 'buy' signals while long are ignored by the engine.
   * Exported both as a ready strategy object and as a zero-arg factory.
   */
  function buyAndHoldFactory() {
    return {
      id: 'buyAndHold', name: 'Buy & hold',
      description: 'Buy once at the start and hold to the end. This is the benchmark: an active strategy that trades more, pays more commissions and still earns less than this has not added value.',
      params: {},
      onBar: function (ctx) { return ctx.position ? null : 'buy'; }
    };
  }
  var buyAndHold = buyAndHoldFactory();

  /** Registry the UI can render as a dropdown with editable params. */
  var builtins = [
    { id: 'smaCross', name: 'SMA crossover', factory: smaCross, defaults: { fast: 20, slow: 50 }, grid: { fast: [5, 10, 20, 50], slow: [50, 100, 200] } },
    { id: 'rsiReversion', name: 'RSI reversion', factory: rsiReversion, defaults: { low: 30, high: 70, n: 14 }, grid: { low: [20, 25, 30, 35], high: [65, 70, 75, 80], n: [14] } },
    { id: 'macdCross', name: 'MACD cross', factory: macdCross, defaults: { fast: 12, slow: 26, signal: 9 }, grid: { fast: [8, 12], slow: [21, 26], signal: [9] } },
    { id: 'bollingerBounce', name: 'Bollinger bounce', factory: bollingerBounce, defaults: { n: 20, k: 2 }, grid: { n: [10, 20, 30], k: [1.5, 2, 2.5] } },
    { id: 'breakout', name: 'Channel breakout', factory: breakout, defaults: { n: 20 }, grid: { n: [10, 20, 30, 55] } },
    { id: 'compositeSignal', name: 'Composite signal', factory: compositeSignal, defaults: { buyAt: 3, sellAt: -3 }, grid: { buyAt: [2, 3, 4], sellAt: [-2, -3, -4] } },
    { id: 'buyAndHold', name: 'Buy & hold', factory: buyAndHoldFactory, defaults: {}, grid: {} }
  ];
  function get(id, params) {
    for (var i = 0; i < builtins.length; i++) if (builtins[i].id === id) return builtins[i].factory(params || builtins[i].defaults);
    return null;
  }

  /* ──────────────────────────────── the engine ───────────────────────────── */

  var UP = '#22c55e', DOWN = '#ef4444', NEUTRAL = '#8a97a8';
  var MARKER_TEXT_MAX_TRADES = 12;   // above this, chart arrows carry no text label

  function emptyResult(reason, opts) {
    return {
      trades: [], equity: [], markers: [], error: reason || 'No data',
      stats: { totalReturnPct: 0, buyHoldReturnPct: 0, cagr: null, winRate: null, profitFactor: null, maxDrawdownPct: 0, sharpe: null, exposurePct: 0, trades: 0, startCash: opts && opts.cash || 0, finalEquity: opts && opts.cash || 0 },
      options: opts || {}
    };
  }

  /**
   * run(strategy, bars, options) → result
   *
   * options: cash=100000 · sizePct=100 (percent of current equity per entry)
   *          commission=0 (dollars per fill) · slippageBps=0 (basis points
   *          against you on every fill) · allowShort=false
   *          startIndex=0 (warm-up: indicators are computed over every bar, but
   *          no signal is taken and no stats are counted before this index —
   *          used by optimize() for honest out-of-sample tests)
   *
   * Mechanics, in order, for each bar i:
   *   1. Fill any order queued on the previous bar at THIS bar's open
   *      (+/- slippage). This is the next-bar-open rule — see teaching note 2.
   *   2. Mark equity to this bar's close.
   *   3. Ask the strategy for a signal using data up to and including bar i.
   *      'buy' while flat → queue long entry; while short → queue cover (and go
   *      long: stop-and-reverse). 'sell' while long → queue exit (and short if
   *      allowShort); while flat → queue short only if allowShort.
   *      'exit' / 'close' → queue flat. Repeated signals in the same direction
   *      are ignored (no pyramiding), so a strategy that shouts BUY every bar
   *      buys exactly once.
   * A position still open on the last bar is closed at the last close and
   * flagged `openAtEnd:true` so its paper profit counts in the stats.
   */
  function run(strategy, bars, options) {
    var o = Object.assign({ cash: 100000, sizePct: 100, commission: 0, slippageBps: 0, allowShort: false, startIndex: 0 }, options || {});
    if (typeof strategy === 'function') strategy = strategy();
    if (!strategy || typeof strategy.onBar !== 'function') return emptyResult('Strategy must have an onBar(ctx, i) function', o);
    bars = Array.isArray(bars) ? bars : [];
    if (bars.length < 2) return emptyResult('Need at least 2 bars to backtest (signals fill on the next bar)', o);
    o.sizePct = clamp(+o.sizePct || 0, 0, 100);
    var slip = (+o.slippageBps || 0) / 10000, comm = Math.max(0, +o.commission || 0);
    var startIndex = clamp(Math.floor(+o.startIndex || 0), 0, bars.length - 2);

    var indObj = buildInd(bars);
    var cash = +o.cash, qty = 0, pos = null, pending = null, n = bars.length;
    var trades = [], equity = new Array(n), markers = [], barsInMarket = 0, errors = 0;
    var ctx = { bars: bars, ind: indObj, position: null, cash: cash, equity: cash, params: strategy.params || {}, options: o };

    function fillPrice(open, side) { return side === 'buy' ? open * (1 + slip) : open * (1 - slip); }

    function openPosition(i, side) {
      var px = fillPrice(bars[i].open, side === 'long' ? 'buy' : 'sell');
      var eq = cash;  // flat at this point, so equity == cash
      var budget = eq * o.sizePct / 100 - comm;
      var q = Math.floor(budget / px);
      if (q < 1 || px <= 0) return false;
      if (side === 'long') { cash -= q * px + comm; qty = q; }
      else { cash += q * px - comm; qty = -q; }
      pos = { side: side, qty: q, entry: px, entryIndex: i, entryTime: bars[i].time, commission: comm };
      markers.push({ time: bars[i].time, position: side === 'long' ? 'belowBar' : 'aboveBar', color: side === 'long' ? UP : DOWN, shape: side === 'long' ? 'arrowUp' : 'arrowDown', text: String(round(px, 2)), detail: (side === 'long' ? 'Buy ' : 'Short ') + q + ' @ ' + round(px, 2) });
      return true;
    }

    function closePosition(i, px, atEnd) {
      if (!pos) return;
      var q = pos.qty, pnl;
      if (pos.side === 'long') { cash += q * px - comm; pnl = (px - pos.entry) * q - pos.commission - comm; }
      else { cash -= q * px + comm; pnl = (pos.entry - px) * q - pos.commission - comm; }
      var cost = pos.entry * q;
      trades.push({
        side: pos.side, entryIndex: pos.entryIndex, exitIndex: i, entryTime: pos.entryTime, exitTime: bars[i].time,
        entry: pos.entry, exit: px, qty: q, pnl: pnl, pnlPct: cost ? (pnl / cost) * 100 : 0,
        bars: i - pos.entryIndex, commission: pos.commission + comm, openAtEnd: !!atEnd
      });
      if (!atEnd) markers.push({ time: bars[i].time, position: pos.side === 'long' ? 'aboveBar' : 'belowBar', color: pnl >= 0 ? UP : DOWN, shape: pos.side === 'long' ? 'arrowDown' : 'arrowUp', text: String(round(px, 2)), detail: (pos.side === 'long' ? 'Sell ' : 'Cover ') + q + ' @ ' + round(px, 2) + ' (' + (pnl >= 0 ? '+' : '') + round(pnl, 0) + ')' });
      qty = 0; pos = null;
    }

    for (var i = 0; i < n; i++) {
      var b = bars[i];
      // 1. fill last bar's order at this bar's open
      if (pending) {
        if (pending === 'long') {
          if (pos && pos.side === 'short') closePosition(i, fillPrice(b.open, 'buy'));
          if (!pos) openPosition(i, 'long');
        } else if (pending === 'short') {
          if (pos && pos.side === 'long') closePosition(i, fillPrice(b.open, 'sell'));
          if (!pos && o.allowShort) openPosition(i, 'short');
        } else if (pending === 'flat') {
          if (pos) closePosition(i, fillPrice(b.open, pos.side === 'long' ? 'sell' : 'buy'));
        }
        pending = null;
      }
      // 2. mark to market at the close (signed qty handles shorts)
      var eq = cash + qty * b.close;
      equity[i] = { time: b.time, equity: eq };
      if (pos) barsInMarket++;
      if (i < startIndex) continue;   // warm-up: indicators only, no decisions yet
      // 3. ask the strategy, using only data up to and including bar i
      ctx.position = pos ? { side: pos.side, qty: pos.qty, entry: pos.entry, entryIndex: pos.entryIndex, barsHeld: i - pos.entryIndex, pnlPct: (pos.side === 'long' ? (b.close - pos.entry) / pos.entry : (pos.entry - b.close) / pos.entry) * 100 } : null;
      ctx.cash = cash; ctx.equity = eq;
      var sig = null;
      try { sig = strategy.onBar(ctx, i); } catch (e) { errors++; if (errors === 1 && typeof console !== 'undefined') console.warn('[BT.backtest] strategy threw at bar ' + i + ':', e && e.message); }
      if (sig === 'buy') { if (!pos || pos.side === 'short') pending = 'long'; }
      else if (sig === 'sell') { if (pos && pos.side === 'long') pending = o.allowShort ? 'short' : 'flat'; else if (!pos && o.allowShort) pending = 'short'; }
      else if (sig === 'exit' || sig === 'close') { if (pos) pending = 'flat'; }
    }

    // close anything still open at the final close so its P&L is visible
    var last = bars[n - 1];
    var pendingSignal = pending;   // a signal on the last bar cannot fill — surface it for the UI
    if (pos) closePosition(n - 1, last.close, true);
    equity[n - 1] = { time: last.time, equity: cash };

    /* Marker labels: the arrows carry only the fill price so neighbours do not
     * overprint each other; the full "Sell 281 @ 419.51 (-199)" lives in
     * marker.detail (for tooltips) and in the trade table. With many trades even
     * the price tags collide, so drop the text and keep the arrows. */
    if (trades.length > MARKER_TEXT_MAX_TRADES) markers.forEach(function (m) { m.text = ''; });

    var stats = computeStats(trades, startIndex ? equity.slice(startIndex) : equity, startIndex ? bars.slice(startIndex) : bars, o, barsInMarket);
    return {
      strategy: { id: strategy.id, name: strategy.name, description: strategy.description, params: strategy.params },
      trades: trades, equity: equity, stats: stats, markers: markers,
      pendingSignal: pendingSignal, options: o, errors: errors, error: null
    };
  }

  /* ──────────────────────────────── statistics ───────────────────────────── */

  /**
   * Buy-and-hold benchmark with the same conventions as the engine: buy at the
   * first fill opportunity (open of bar 1), hold to the last close. No costs,
   * so an active strategy also has to beat its own commissions to win.
   */
  function buyHoldReturnPct(bars) {
    if (!bars || bars.length < 2) return 0;
    var start = bars[1].open, end = bars[bars.length - 1].close;
    return start > 0 ? (end / start - 1) * 100 : 0;
  }

  function maxDrawdown(equity) {
    var peak = -Infinity, mdd = 0, peakIdx = 0, troughIdx = 0, curPeakIdx = 0, longest = 0, since = 0;
    for (var i = 0; i < equity.length; i++) {
      var e = equity[i].equity;
      if (e > peak) { peak = e; curPeakIdx = i; since = 0; } else { since++; if (since > longest) longest = since; }
      var dd = peak > 0 ? (peak - e) / peak : 0;
      if (dd > mdd) { mdd = dd; peakIdx = curPeakIdx; troughIdx = i; }
    }
    return { pct: mdd * 100, peakIndex: peakIdx, troughIndex: troughIdx, longestBars: longest };
  }

  function computeStats(trades, equity, bars, o, barsInMarket) {
    var start = +o.cash, end = equity.length ? equity[equity.length - 1].equity : start;
    var wins = trades.filter(function (t) { return t.pnl > 0; }), losses = trades.filter(function (t) { return t.pnl <= 0; });
    var gross = wins.reduce(function (s, t) { return s + t.pnl; }, 0), grossLoss = -losses.reduce(function (s, t) { return s + t.pnl; }, 0);
    var years = spanYears(bars), bpy = barsPerYear(bars);

    // Per-bar returns of the equity curve → Sharpe (risk-free 0, annualised).
    var rets = [];
    for (var i = 1; i < equity.length; i++) { var a = equity[i - 1].equity, b = equity[i].equity; if (a > 0) rets.push(b / a - 1); }
    var sd = stdev(rets), sharpe = sd > 0 ? (mean(rets) / sd) * Math.sqrt(bpy) : null;
    /* Sortino: textbook downside deviation averages min(r,0)^2 over ALL N bars
     * (Sortino & van der Meer), not just the losing ones — otherwise a strategy
     * that sits in cash most of the time is punished for being flat. */
    var dsd = rets.length ? Math.sqrt(rets.reduce(function (s, r) { return s + (r < 0 ? r * r : 0); }, 0) / rets.length) : 0;
    var sortino = dsd > 0 ? (mean(rets) / dsd) * Math.sqrt(bpy) : null;

    var dd = maxDrawdown(equity);
    var totalReturnPct = start > 0 ? (end / start - 1) * 100 : 0;
    /* CAGR from the real timestamps, not from the bar count: 500 daily bars are
     * about two calendar years, 500 five-minute bars are about a week. */
    var cagr = (years > 1 / 52 && start > 0 && end > 0) ? (Math.pow(end / start, 1 / years) - 1) * 100 : null;
    var bh = buyHoldReturnPct(bars);
    var avgWin = wins.length ? gross / wins.length : 0, avgLoss = losses.length ? -grossLoss / losses.length : 0;
    var winRate = trades.length ? (wins.length / trades.length) * 100 : null;
    var expectancy = trades.length ? (gross - grossLoss) / trades.length : 0;
    var totalCommission = trades.reduce(function (s, t) { return s + (t.commission || 0); }, 0);

    return {
      totalReturnPct: totalReturnPct,
      buyHoldReturnPct: bh,
      excessVsBuyHoldPct: totalReturnPct - bh,
      cagr: cagr,
      winRate: winRate,
      profitFactor: grossLoss > 0 ? gross / grossLoss : (gross > 0 ? Infinity : null),
      maxDrawdownPct: dd.pct,
      maxDrawdownPeakIndex: dd.peakIndex, maxDrawdownTroughIndex: dd.troughIndex, longestDrawdownBars: dd.longestBars,
      sharpe: sharpe, sortino: sortino,
      exposurePct: bars.length ? (barsInMarket / bars.length) * 100 : 0,
      trades: trades.length, wins: wins.length, losses: losses.length,
      avgWin: avgWin, avgLoss: avgLoss, expectancy: expectancy,
      avgPnlPct: trades.length ? mean(trades.map(function (t) { return t.pnlPct; })) : 0,
      bestTradePct: trades.length ? Math.max.apply(null, trades.map(function (t) { return t.pnlPct; })) : 0,
      worstTradePct: trades.length ? Math.min.apply(null, trades.map(function (t) { return t.pnlPct; })) : 0,
      avgBarsHeld: trades.length ? mean(trades.map(function (t) { return t.bars; })) : 0,
      totalCommission: totalCommission,
      startCash: start, finalEquity: end, netProfit: end - start,
      years: years, barsPerYear: bpy, bars: bars.length
    };
  }

  /* ────────────────────────────── optimisation ───────────────────────────── */

  var OPTIMIZE_CAP = 200;

  /** Cartesian product of {param:[values]} → [{param:value}], in stable order. */
  function expandGrid(grid) {
    var keys = Object.keys(grid || {}).filter(function (k) { return Array.isArray(grid[k]) && grid[k].length; });
    var combos = [{}];
    keys.forEach(function (k) {
      var next = [];
      combos.forEach(function (c) { grid[k].forEach(function (v) { var d = Object.assign({}, c); d[k] = v; next.push(d); }); });
      combos = next;
    });
    return combos;
  }

  /**
   * optimize(strategyFactory, bars, grid, options) → ranked array of
   *   {rank, params, score, stats, oosStats|null, name}
   * with extra properties on the array: total, tested, truncated, metric, warning.
   *
   * grid: {fast:[5,10,20], slow:[50,100]} → every combination (cap 200: beyond
   * that we take an evenly-spaced subset, because a grid you cannot inspect by
   * eye is a grid you will overfit with).
   * options: everything run() takes, plus
   *   metric   'sharpe' | 'totalReturnPct' | 'profitFactor' | 'cagr' | 'calmar'
   *            (default 'sharpe' — risk-adjusted beats raw return for ranking)
   *   minTrades (default 5) — combos with fewer trades are ranked last; a
   *            back-test with 2 trades is an anecdote, not a statistic
   *   oosPct   (default 0) — percent of the most recent bars held out. Each
   *            combo is tuned on the first part only and then re-run on the
   *            held-out part; compare `stats` (in-sample) to `oosStats`.
   *            A large gap is the smell of overfitting.
   *   filter(params) → boolean to skip nonsense combos (e.g. fast >= slow).
   *
   * TEACHING NOTE: the top row of this table is almost always too good to be
   * true. Look at the whole table — is there a neighbourhood of similar
   * parameters that all do fine? That plateau is what you can trust.
   */
  function optimize(strategyFactory, bars, grid, options) {
    var o = Object.assign({ metric: 'sharpe', minTrades: 5, oosPct: 0 }, options || {});
    var all = expandGrid(grid), total = all.length, combos = all;
    if (typeof o.filter === 'function') combos = combos.filter(o.filter);
    var truncated = false;
    if (combos.length > OPTIMIZE_CAP) {
      truncated = true;
      var step = combos.length / OPTIMIZE_CAP, picked = [];
      for (var k = 0; k < OPTIMIZE_CAP; k++) picked.push(combos[Math.floor(k * step)]);
      combos = picked;
    }
    bars = Array.isArray(bars) ? bars : [];
    var oosPct = clamp(+o.oosPct || 0, 0, 80), split = oosPct ? Math.floor(bars.length * (1 - oosPct / 100)) : bars.length;
    // The out-of-sample slice carries up to 250 earlier bars as warm-up so slow
    // indicators (SMA 200…) are defined on day one; run() ignores them for
    // decisions and stats via startIndex.
    var WARMUP = 250;
    var inSample = bars.slice(0, split), oosFrom = Math.max(0, split - WARMUP);
    var outSample = oosPct ? bars.slice(oosFrom) : null, oosOffset = outSample ? split - oosFrom : 0;
    var runOpts = {}; ['cash', 'sizePct', 'commission', 'slippageBps', 'allowShort'].forEach(function (key) { if (o[key] != null) runOpts[key] = o[key]; });

    function metricOf(st) {
      if (!st) return -Infinity;
      var v;
      if (o.metric === 'calmar') v = st.maxDrawdownPct > 0 && st.cagr != null ? st.cagr / st.maxDrawdownPct : (st.cagr || 0);
      else v = st[o.metric];
      if (v === Infinity) v = 1e9;
      return isNum(v) ? v : -Infinity;
    }

    var results = [];
    combos.forEach(function (params) {
      var strat;
      try { strat = strategyFactory(params); } catch (e) { return; }
      if (!strat) return;
      var res = run(strat, inSample, runOpts);
      var row = { params: params, name: strat.name, stats: res.stats, score: metricOf(res.stats), oosStats: null, oosScore: null, enoughTrades: res.stats.trades >= o.minTrades };
      if (outSample && outSample.length > 2) {
        var oos = run(strategyFactory(params), outSample, Object.assign({}, runOpts, { startIndex: oosOffset }));
        row.oosStats = oos.stats; row.oosScore = metricOf(oos.stats); row.oosStartIndex = oosOffset;
      }
      results.push(row);
    });
    results.sort(function (a, b) {
      if (a.enoughTrades !== b.enoughTrades) return a.enoughTrades ? -1 : 1;
      return b.score - a.score;
    });
    results.forEach(function (r, i) { r.rank = i + 1; });

    results.total = total; results.tested = results.length; results.truncated = truncated; results.metric = o.metric;
    results.inSampleBars = inSample.length; results.oosBars = outSample ? outSample.length - oosOffset : 0;
    results.warning = truncated
      ? 'Grid had ' + total + ' combinations; only ' + OPTIMIZE_CAP + ' evenly spaced ones were tested. Narrow the grid for full coverage.'
      : 'Reminder: the best parameters on past data are partly luck. Prefer a plateau of similar good results over one spike, and check the out-of-sample column.';
    return results;
  }

  /* ─────────────────────────── plain-English coaching ────────────────────── */

  /** explain(result) → array of short sentences a student can read next to the
   *  stats table. Deliberately blunt: the point is to teach what the numbers mean. */
  function explain(result) {
    if (!result || !result.stats) return ['Run a backtest first.'];
    var s = result.stats, out = [];
    if (result.error) return [result.error];
    var name = result.strategy ? result.strategy.name : 'The strategy';
    out.push(name + ' turned $' + fmt(s.startCash) + ' into $' + fmt(s.finalEquity) + ' (' + pct(s.totalReturnPct) + ') over ' + s.bars + ' bars' + (s.years > 0.1 ? ' ≈ ' + round(s.years, 1) + ' years' : '') + '.');
    if (s.trades === 0) { out.push('It never traded. Either the rules never triggered on this data or the position size was too small to buy one share.'); return out; }
    var vs = s.excessVsBuyHoldPct;
    out.push(Math.abs(vs) < 0.5 ? 'That is about the same as simply buying and holding (' + pct(s.buyHoldReturnPct) + ').'
      : vs > 0 ? 'It beat buy-and-hold (' + pct(s.buyHoldReturnPct) + ') by ' + pct(vs) + '.'
        : 'Buy-and-hold (' + pct(s.buyHoldReturnPct) + ') did better by ' + pct(-vs) + '. Activity is not the same as edge.');
    if (s.trades < 10) out.push('Only ' + s.trades + ' trades: too few to trust any statistic here. Try a longer history or a faster timeframe.');
    if (s.winRate != null) out.push('Win rate ' + round(s.winRate, 0) + ' %' + (s.profitFactor != null && s.profitFactor !== Infinity ? ', profit factor ' + round(s.profitFactor, 2) : '') + '. ' + (s.winRate < 45 && s.profitFactor > 1.2 ? 'Losing more often than winning yet still profitable — classic trend following: small losses, big wins.' : s.winRate > 60 && s.profitFactor < 1 ? 'Winning often but losing money overall — the losers are bigger than the winners. Where are the stops?' : s.profitFactor != null && s.profitFactor < 1 ? 'A profit factor below 1 means gross losses exceeded gross gains.' : 'A profit factor above 1.5 with 30+ trades starts to be interesting.'));
    out.push('Worst peak-to-trough drop was ' + round(s.maxDrawdownPct, 1) + ' %' + (s.maxDrawdownPct > 30 ? ' — could you really keep following the rules while down that much? Most people quit, which is why drawdown matters more than return.' : '.'));
    if (s.sharpe != null) out.push('Sharpe ratio ' + round(s.sharpe, 2) + (s.sharpe < 0.5 ? ' (weak: lots of volatility per unit of return)' : s.sharpe < 1 ? ' (ordinary)' : s.sharpe < 2 ? ' (good — be suspicious if it came from a small parameter search)' : ' (suspiciously high: check for look-ahead or overfitting)') + '.');
    if (s.totalCommission > 0 && s.netProfit > 0 && s.totalCommission > 0.25 * s.netProfit) out.push('Costs ate $' + fmt(s.totalCommission) + ' — more than a quarter of the profit. Trading less often may help more than a better signal.');
    out.push('In the market ' + round(s.exposurePct, 0) + ' % of the time. Returns earned while mostly in cash carry less risk than the same return fully invested.');
    return out;
  }
  function fmt(x) { return isNum(x) ? Math.round(x).toLocaleString('en-US') : '—'; }
  function pct(x) { return isNum(x) ? (x >= 0 ? '+' : '') + round(x, 1) + ' %' : '—'; }

  /** Equity curve for buy-and-hold on the same bars, for charting against the strategy. */
  function buyHoldEquity(bars, cash) {
    cash = cash || 100000;
    if (!bars || bars.length < 2) return [];
    var q = Math.floor(cash / bars[1].open), rest = cash - q * bars[1].open;
    return bars.map(function (b, i) { return { time: b.time, equity: i === 0 ? cash : rest + q * b.close }; });
  }

  /** Series of drawdown % for a drawdown pane under the equity chart. */
  function drawdownSeries(equity) {
    var peak = -Infinity;
    return (equity || []).map(function (e) { if (e.equity > peak) peak = e.equity; return { time: e.time, value: peak > 0 ? -((peak - e.equity) / peak) * 100 : 0 }; });
  }

  /* ─────────────────────────────────── export ────────────────────────────── */

  BT.backtest = {
    // strategies
    smaCross: smaCross, rsiReversion: rsiReversion, macdCross: macdCross, bollingerBounce: bollingerBounce,
    breakout: breakout, compositeSignal: compositeSignal, buyAndHold: buyAndHold, buyAndHoldFactory: buyAndHoldFactory,
    builtins: builtins, get: get,
    // engine
    run: run, optimize: optimize, OPTIMIZE_CAP: OPTIMIZE_CAP,
    // helpers for the UI / course
    explain: explain, buyHoldEquity: buyHoldEquity, buyHoldReturnPct: buyHoldReturnPct, drawdownSeries: drawdownSeries,
    expandGrid: expandGrid, barsPerYear: barsPerYear, spanYears: spanYears, timeToSeconds: timeToSeconds,
    crossUp: crossUp, crossDown: crossDown, buildInd: buildInd,
    glossary: {
      lookAhead: 'Look-ahead bias: using information that was not yet available at decision time. This engine fills at the next bar\'s open to avoid it.',
      overfitting: 'Overfitting: tuning parameters until they fit past noise. Defend with few parameters, many trades and out-of-sample testing.',
      sharpe: 'Sharpe ratio: average return per unit of volatility, annualised. Above 1 is good; above 2 on a small sample is suspicious.',
      drawdown: 'Max drawdown: the largest peak-to-trough fall of the equity curve. It is the pain you must sit through to get the return.',
      profitFactor: 'Profit factor: gross profits ÷ gross losses. Below 1 loses money; above 1.5 is respectable.',
      exposure: 'Exposure: share of bars spent holding a position. Lower exposure for the same return means less risk taken.',
      slippage: 'Slippage: the difference between the price you expected and the price you got. Modelled here in basis points against you on every fill.',
      cagr: 'CAGR: compound annual growth rate, from the real calendar span of the data, so results on different timeframes are comparable.'
    },
    version: '0.2.0'
  };
})();
