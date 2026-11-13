/* Broward Trading — js/compare.js → BT.compare (v0.3)
 *
 * Pure maths for compare.html: aligning several symbols' bars on common dates,
 * rebasing to 100, daily returns, Pearson correlation, a correlation matrix,
 * beta and relative strength against a benchmark (SPY by default), heatmap
 * colour intensity for watchlist tiles, and the educational copy the page shows.
 *
 *   BT.compare.PERIODS                           [{id, label, bars|ytd|max, note}]
 *   BT.compare.align(barsBySymbol)               {times, closes:{SYM:[...]}, dropped:{SYM:n}}
 *   BT.compare.periodStart(times, periodId, now) index of the first bar inside the period
 *   BT.compare.slice(aligned, periodId, now)     aligned data cut to the period
 *   BT.compare.rebase(closes, base=100)          normalized series (first value = base)
 *   BT.compare.returns(closes) / logReturns(closes)
 *   BT.compare.pearson(a, b)                     correlation coefficient, null when undefined
 *   BT.compare.correlationMatrix(closesBySymbol) {symbols, matrix, n, avg}
 *   BT.compare.beta(assetCloses, benchCloses)    cov / var on daily returns
 *   BT.compare.relativeStrength(closes, bench)   ratio line rebased to 100
 *   BT.compare.stats(closes)                     {totalReturnPct, annVolPct, maxDrawdownPct, sharpe, bars}
 *   BT.compare.pctChange(bars, lookbackBars)     % change over the last N bars
 *   BT.compare.heat(pct, scalePct)               {intensity 0–100, sign:'up'|'down'|'flat'}
 *   BT.compare.tileWeight(pct, scalePct)         flex-grow weight for a heatmap tile
 *   BT.compare.describeCorrelation(r)            {label, tone, text}
 *   BT.compare.diversification(matrix)           {avg, label, text}
 *   BT.compare.drawMatrix(canvas, corr, opts)    canvas heatmap with the values written in
 *   BT.compare.NOTES                             short educational notes for the page
 *
 * Plain ES2020, no imports, no DOM lookups (drawMatrix only draws on the canvas
 * it is handed, so tests can run in Node without a document).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (root.BT && root.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }

  var MAX_SYMBOLS = 6;
  var BENCHMARK = 'SPY';
  var TRADING_DAYS = 252;

  /* ------------------------------------------------------------------ *
   * Period selector. `bars` is a trading-day count (21 ≈ 1 month).
   * ------------------------------------------------------------------ */
  var PERIODS = [
    { id: '1m',  label: '1M',  bars: 21,  note: 'about one month of trading days' },
    { id: '3m',  label: '3M',  bars: 63,  note: 'one quarter' },
    { id: '6m',  label: '6M',  bars: 126, note: 'half a year' },
    { id: 'ytd', label: 'YTD', ytd: true, note: 'since the first trading day of this year' },
    { id: '1y',  label: '1Y',  bars: 252, note: 'one year' },
    { id: '2y',  label: '2Y',  bars: 504, note: 'two years' },
    { id: 'max', label: 'Max', max: true, note: 'every bar we have for all symbols' }
  ];
  function periodById(id) {
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].id === id) return PERIODS[i];
    return PERIODS[2];
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function mean(a) { var s = 0, n = 0; for (var i = 0; i < a.length; i++) if (isNum(a[i])) { s += a[i]; n++; } return n ? s / n : null; }
  function round(v, dp) { if (!isNum(v)) return null; var m = Math.pow(10, dp == null ? 2 : dp); return Math.round(v * m) / m; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function yearOf(t) {
    if (typeof t === 'string') return +t.slice(0, 4);
    if (isNum(t)) return new Date(t * 1000).getUTCFullYear();
    return NaN;
  }
  function timeKey(t) { return typeof t === 'string' ? t : String(t); }

  /* ------------------------------------------------------------------ *
   * align: keep only the dates every symbol has a bar for (the intersection),
   * so every series has the same length and index i means the same day.
   * Symbols with no bars at all are dropped and reported in `missing`.
   * ------------------------------------------------------------------ */
  function align(barsBySymbol) {
    var symbols = Object.keys(barsBySymbol || {}).filter(function (s) {
      return Array.isArray(barsBySymbol[s]) && barsBySymbol[s].length > 0;
    });
    var missing = Object.keys(barsBySymbol || {}).filter(function (s) { return symbols.indexOf(s) < 0; });
    if (!symbols.length) return { times: [], closes: {}, symbols: [], missing: missing, dropped: {} };

    // Map time → close per symbol
    var maps = {};
    symbols.forEach(function (s) {
      var m = {};
      barsBySymbol[s].forEach(function (b) { if (b && b.time != null && isNum(b.close)) m[timeKey(b.time)] = b.close; });
      maps[s] = m;
    });
    // Shortest series drives the intersection
    var base = symbols.slice().sort(function (a, b) { return barsBySymbol[a].length - barsBySymbol[b].length; })[0];
    var times = [];
    barsBySymbol[base].forEach(function (b) {
      if (!b || b.time == null) return;
      var k = timeKey(b.time);
      for (var i = 0; i < symbols.length; i++) if (!(k in maps[symbols[i]])) return;
      times.push(b.time);
    });
    var closes = {}, dropped = {};
    symbols.forEach(function (s) {
      closes[s] = times.map(function (t) { return maps[s][timeKey(t)]; });
      dropped[s] = barsBySymbol[s].length - times.length;
    });
    return { times: times, closes: closes, symbols: symbols, missing: missing, dropped: dropped };
  }

  /** Index of the first bar that belongs to the period. Always leaves at least 2 bars when possible. */
  function periodStart(times, periodId, now) {
    var n = times.length;
    if (n === 0) return 0;
    var p = periodById(periodId);
    var start;
    if (p.max) start = 0;
    else if (p.ytd) {
      var year = yearOf(times[n - 1]);
      if (now != null) year = typeof now === 'number' ? new Date(now).getFullYear() : yearOf(now);
      start = n - 1;
      while (start > 0 && yearOf(times[start - 1]) === year) start--;
      // Include the last bar of the previous year so YTD starts from last year's close (how brokers quote it)
      if (start > 0) start--;
    } else start = Math.max(0, n - 1 - p.bars);
    return clamp(start, 0, Math.max(0, n - 2));
  }

  /** Cut an align() result down to a period. */
  function slice(aligned, periodId, now) {
    var start = periodStart(aligned.times, periodId, now);
    var out = { times: aligned.times.slice(start), closes: {}, symbols: aligned.symbols.slice(), start: start };
    aligned.symbols.forEach(function (s) { out.closes[s] = aligned.closes[s].slice(start); });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Series maths
   * ------------------------------------------------------------------ */
  /** Rebase so the first finite value equals `base` (default 100): 110 means +10 %. */
  function rebase(closes, base) {
    base = base == null ? 100 : base;
    var first = null;
    for (var i = 0; i < closes.length; i++) if (isNum(closes[i]) && closes[i] !== 0) { first = closes[i]; break; }
    return closes.map(function (c) { return first == null || !isNum(c) ? null : c / first * base; });
  }
  /** Simple daily returns: r[i] = c[i+1]/c[i] − 1. Length n−1. */
  function returns(closes) {
    var out = [];
    for (var i = 1; i < closes.length; i++) {
      out.push(isNum(closes[i]) && isNum(closes[i - 1]) && closes[i - 1] !== 0 ? closes[i] / closes[i - 1] - 1 : null);
    }
    return out;
  }
  /** Log returns ln(c[i+1]/c[i]). Length n−1. */
  function logReturns(closes) {
    var out = [];
    for (var i = 1; i < closes.length; i++) {
      out.push(isNum(closes[i]) && isNum(closes[i - 1]) && closes[i] > 0 && closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : null);
    }
    return out;
  }
  /** Pairs where both values are finite. */
  function pairs(a, b) {
    var xs = [], ys = [], n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) if (isNum(a[i]) && isNum(b[i])) { xs.push(a[i]); ys.push(b[i]); }
    return { x: xs, y: ys };
  }
  /** Pearson correlation of two equal-length arrays (nulls skipped). null when < 3 pairs or zero variance. */
  function pearson(a, b) {
    var p = pairs(a || [], b || []);
    var n = p.x.length;
    if (n < 3) return null;
    var mx = mean(p.x), my = mean(p.y);
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = p.x[i] - mx, dy = p.y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    return clamp(sxy / Math.sqrt(sxx * syy), -1, 1);
  }
  /** Sample covariance and variance helpers on paired finite values. */
  function covariance(a, b) {
    var p = pairs(a, b), n = p.x.length;
    if (n < 2) return null;
    var mx = mean(p.x), my = mean(p.y), s = 0;
    for (var i = 0; i < n; i++) s += (p.x[i] - mx) * (p.y[i] - my);
    return s / (n - 1);
  }
  function variance(a) { return covariance(a, a); }
  function stdev(a) { var v = variance(a); return v == null ? null : Math.sqrt(v); }

  /**
   * Correlation matrix of daily log returns.
   * @param closesBySymbol {SYM:[closes]} already aligned (same length, same dates)
   * @returns {symbols, matrix (rows = cols = symbols, 1 on the diagonal), n (overlapping return days shared by every pair), avg (off-diagonal mean)}
   */
  function correlationMatrix(closesBySymbol, symbolOrder) {
    var symbols = symbolOrder || Object.keys(closesBySymbol || {});
    var rets = {};
    symbols.forEach(function (s) { rets[s] = logReturns(closesBySymbol[s] || []); });
    var matrix = [], sum = 0, cnt = 0, n = null;
    for (var i = 0; i < symbols.length; i++) {
      var row = [];
      for (var j = 0; j < symbols.length; j++) {
        var r;
        if (i === j) r = 1;
        else if (j < i) r = matrix[j][i];
        else {
          r = pearson(rets[symbols[i]], rets[symbols[j]]);
          if (r != null) { sum += r; cnt++; }
          // n = the smallest number of overlapping return days any pair actually shares,
          // so the sample size shown to the user never overstates the evidence.
          var np = pairs(rets[symbols[i]], rets[symbols[j]]).x.length;
          n = n == null ? np : Math.min(n, np);
        }
        row.push(r);
      }
      matrix.push(row);
    }
    // A single symbol has no pairs: report its own finite return count instead.
    if (n == null) n = symbols.length === 1 ? pairs(rets[symbols[0]], rets[symbols[0]]).x.length : 0;
    return { symbols: symbols, matrix: matrix, n: n, avg: cnt ? sum / cnt : null };
  }

  /** Beta of an asset against a benchmark: cov(ra, rb) / var(rb) on simple daily returns. */
  function beta(assetCloses, benchCloses) {
    var ra = returns(assetCloses || []), rb = returns(benchCloses || []);
    // Covariance and variance on the same paired sample (days where both returns are finite).
    var p = pairs(ra, rb);
    var c = covariance(p.x, p.y), v = variance(p.y);
    if (c == null || !v) return null;
    return c / v;
  }

  /** Relative strength line: asset / benchmark, rebased to 100. Rising = asset outperforming. */
  function relativeStrength(closes, benchCloses, base) {
    var ratio = [];
    for (var i = 0; i < closes.length; i++) {
      var a = closes[i], b = benchCloses[i];
      ratio.push(isNum(a) && isNum(b) && b !== 0 ? a / b : null);
    }
    return rebase(ratio, base);
  }

  /** Max drawdown in % (negative number), from a close series. */
  function maxDrawdownPct(closes) {
    var peak = null, worst = 0;
    for (var i = 0; i < closes.length; i++) {
      var c = closes[i];
      if (!isNum(c)) continue;
      if (peak == null || c > peak) peak = c;
      if (peak > 0) worst = Math.min(worst, (c / peak - 1) * 100);
    }
    return worst;
  }

  /** Per-symbol statistics over the visible period. */
  function stats(closes) {
    var first = null, last = null;
    for (var i = 0; i < closes.length; i++) if (isNum(closes[i])) { if (first == null) first = closes[i]; last = closes[i]; }
    var r = returns(closes);
    var sd = stdev(r), mu = mean(r);
    var annVol = sd == null ? null : sd * Math.sqrt(TRADING_DAYS) * 100;
    var sharpe = sd ? (mu / sd) * Math.sqrt(TRADING_DAYS) : null;   // risk-free assumed 0; educational
    return {
      totalReturnPct: first && last != null ? (last / first - 1) * 100 : null,
      annVolPct: annVol,
      maxDrawdownPct: maxDrawdownPct(closes),
      sharpe: sharpe,
      bars: closes.length,
      first: first,
      last: last
    };
  }

  /** % change of the last close vs the close `lookbackBars` bars earlier (1 = one day). */
  function pctChange(bars, lookbackBars) {
    if (!Array.isArray(bars) || bars.length < 2) return null;
    var n = bars.length, k = Math.max(1, Math.min(n - 1, lookbackBars || 1));
    var a = bars[n - 1 - k], b = bars[n - 1];
    if (!a || !b || !isNum(a.close) || !isNum(b.close) || a.close === 0) return null;
    return (b.close / a.close - 1) * 100;
  }

  /* ------------------------------------------------------------------ *
   * Heatmap helpers (colour decisions stay in CSS; we only give intensity)
   * ------------------------------------------------------------------ */
  /** Intensity 0–100 for a tile; `scalePct` is the % change that maps to full intensity. */
  function heat(pct, scalePct) {
    scalePct = scalePct || 5;
    if (!isNum(pct)) return { intensity: 0, sign: 'flat' };
    var k = clamp(Math.abs(pct) / scalePct, 0, 1);
    var intensity = Math.round(12 + 88 * Math.sqrt(k));   // sqrt so small moves are still visible
    return { intensity: intensity, sign: pct > 0.0001 ? 'up' : pct < -0.0001 ? 'down' : 'flat' };
  }
  /** Flex-grow weight so bigger moves get bigger tiles (1 ≤ w ≤ 4). */
  function tileWeight(pct, scalePct) {
    scalePct = scalePct || 5;
    if (!isNum(pct)) return 1;
    return round(1 + 3 * clamp(Math.abs(pct) / scalePct, 0, 1), 2);
  }

  /* ------------------------------------------------------------------ *
   * Plain-English readings
   * ------------------------------------------------------------------ */
  function describeCorrelation(r) {
    if (!isNum(r)) return { label: 'n/a', tone: 'muted', text: 'Not enough overlapping days to measure.' };
    var a = Math.abs(r), sign = r >= 0 ? 'positive' : 'negative';
    var strength = a >= 0.8 ? 'very strong' : a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'near zero';
    var text;
    if (a < 0.2) text = 'These two mostly move independently day to day. Holding both spreads risk.';
    else if (r > 0) text = a >= 0.6
      ? 'They tend to move together. Owning both is closer to one bigger bet than two separate ones.'
      : 'They lean the same way more often than not, but each still has its own drivers.';
    else text = a >= 0.6
      ? 'One tends to rise when the other falls. That is rare between stocks and is what hedges aim for.'
      : 'They lean in opposite directions a bit, which smooths a combined portfolio.';
    return { label: a < 0.2 ? 'near zero' : strength + ' ' + sign, tone: a < 0.2 ? 'muted' : r > 0 ? 'up' : 'down', text: text };
  }

  function diversification(matrixResult) {
    var avg = matrixResult && isNum(matrixResult.avg) ? matrixResult.avg : null;
    if (avg == null) return { avg: null, label: 'n/a', text: 'Add at least two symbols with overlapping history to measure diversification.' };
    var label = avg >= 0.7 ? 'low' : avg >= 0.45 ? 'moderate' : avg >= 0.2 ? 'good' : 'high';
    var text = {
      low: T('Average correlation {avg}: these names mostly rise and fall together, so this basket behaves like one concentrated position. Mixing in a different sector, bonds or gold would lower it.', { avg: avg.toFixed(2) }),
      moderate: T('Average correlation {avg}: some diversification, but a broad sell-off would still hit most of the basket at once.', { avg: avg.toFixed(2) }),
      good: T('Average correlation {avg}: the basket spreads risk reasonably well. Each name adds something the others do not.', { avg: avg.toFixed(2) }),
      high: T('Average correlation {avg}: unusually independent moves. Check the period is long enough to trust the numbers.', { avg: avg.toFixed(2) })
    }[label];
    return { avg: avg, label: label, text: text };
  }

  function describeBeta(b) {
    if (!isNum(b)) return T('Beta needs overlapping history with the benchmark.');
    if (b > 1.3) return T('High beta: moves roughly {beta}× as much as SPY on a typical day, in both directions.', { beta: b.toFixed(1) });
    if (b > 0.8) return T('Beta near 1: tends to move about as much as the market.');
    if (b > 0.3) return T('Low beta: a market-wide move shows up here muted.');
    if (b > -0.3) return T('Beta near 0: day-to-day moves barely track the market.');
    return T('Negative beta: tends to move against the market. Unusual for a stock; common for inverse funds.');
  }

  var NOTES = [
    {
      id: 'rebase',
      title: 'Why rebase to 100?',
      text: 'A $500 stock and a $20 stock cannot share a price axis, so every line starts at 100 on the first day of the period. 112 means up 12 %, 95 means down 5 %. You are comparing journeys, not prices. Change the period and the lines re-anchor, so the ranking can flip: a stock that leads over one month may trail over a year.'
    },
    {
      id: 'diversification',
      title: 'Diversification is about correlation, not count',
      text: 'Owning six technology stocks is not six bets. If they move together (correlation above 0.7) a bad week for the sector hits all of them. Real diversification comes from holdings that respond to different things: another sector, bonds, international stocks, commodities. The matrix shows you where your basket is secretly one position.'
    },
    {
      id: 'causation',
      title: 'Correlation is not causation',
      text: 'Two stocks moving together does not mean one drives the other. Usually both react to the same thing: the overall market, interest rates, or their sector. Correlations also drift: pairs that were independent for years can suddenly move in lockstep during a crash, exactly when you hoped diversification would help. Always check the number over more than one period.'
    },
    {
      id: 'beta',
      title: 'Beta intuition',
      text: 'Beta answers "when the market moves 1 %, how much does this stock typically move?" A beta of 1.5 means about 1.5 % up on an up day and 1.5 % down on a down day; 0.5 means half as much. High beta is not "better": it is more exposure to the same market swing. It is measured on past daily returns, so it is an estimate that changes with the period you pick.'
    },
    {
      id: 'rs',
      title: 'Reading relative strength',
      text: 'The relative strength line divides a stock\'s price by SPY and rebases to 100. Rising means the stock is beating the index; falling means lagging, even if both are going up. Traders watch it to find leaders in a rally and laggards in a decline. It says nothing about absolute gains: a stock can have rising relative strength while losing money if the market falls faster.'
    },
    {
      id: 'heatmap',
      title: 'How to read the heatmap',
      text: 'Each tile is one watchlist symbol. Green is up, red is down; a deeper shade and a bigger tile mean a bigger move over the lookback you chose. The heatmap is a quick scan of what moved, not a signal: a big green tile tells you where the action was, not where it is going.'
    }
  ];

  /* ------------------------------------------------------------------ *
   * Canvas heatmap of the correlation matrix. `opts.colors` supplies the
   * theme (read from CSS tokens by the page); nothing here reads the DOM.
   * ------------------------------------------------------------------ */
  function hexToRgb(hex) {
    var h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(c1, c2, t) {          // c1, c2 as rgb arrays; t in [0,1]
    return 'rgb(' + c1.map(function (v, i) { return Math.round(v + (c2[i] - v) * t); }).join(',') + ')';
  }
  /** Fill colour for a correlation value r ∈ [−1, 1]. */
  function cellColor(r, colors) {
    var panel = hexToRgb(colors.panel) || [28, 36, 48];
    var up = hexToRgb(colors.up) || [34, 197, 94];
    var down = hexToRgb(colors.down) || [239, 68, 68];
    if (!isNum(r)) return mix(panel, panel, 0);
    var t = Math.pow(Math.abs(r), 0.9);
    return mix(panel, r >= 0 ? up : down, 0.1 + 0.75 * t);
  }

  /**
   * Draw the matrix. Returns the cell geometry so the page can map taps to cells:
   * {cell, left, top, size}. Safe to call with a null canvas (no-op, returns null).
   */
  function drawMatrix(canvas, corr, opts) {
    if (!canvas || !canvas.getContext || !corr || !corr.symbols) return null;
    opts = opts || {};
    var colors = Object.assign({ panel: '#1c2430', bg: '#161c25', line: '#263040', fg: '#e6ebf2', muted: '#8a97a8', up: '#22c55e', down: '#ef4444', accent: '#4f8cff' }, opts.colors || {});
    var font = opts.font || 'IBM Plex Mono, ui-monospace, Menlo, monospace';
    var syms = corr.symbols, n = syms.length;
    var dpr = opts.dpr || 1;
    var W = opts.width || canvas.width / dpr || 320;
    var labelW = Math.max(44, Math.min(64, W * 0.16));
    var size = n ? Math.floor((W - labelW) / n) : 0;
    var H = labelW + size * n;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (canvas.style) { canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; }
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
    if (!n) return { cell: 0, left: labelW, top: labelW, size: 0 };

    var fs = Math.max(10, Math.min(14, size * 0.26));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Column labels
    ctx.fillStyle = colors.muted; ctx.font = '500 ' + Math.max(10, Math.min(13, size * 0.24)) + 'px ' + font;
    for (var c = 0; c < n; c++) ctx.fillText(syms[c], labelW + c * size + size / 2, labelW / 2, size - 4);
    // Rows
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = colors.muted; ctx.textAlign = 'right';
      ctx.fillText(syms[i], labelW - 6, labelW + i * size + size / 2, labelW - 8);
      for (var j = 0; j < n; j++) {
        var r = corr.matrix[i][j];
        var x = labelW + j * size, y = labelW + i * size;
        ctx.fillStyle = cellColor(r, colors);
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
        if (opts.highlight && opts.highlight.row === i && opts.highlight.col === j) {
          ctx.strokeStyle = colors.accent; ctx.lineWidth = 2; ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = (isNum(r) && Math.abs(r) > 0.55) ? '#ffffff' : colors.fg;
        ctx.font = (i === j ? '400 ' : '500 ') + fs + 'px ' + font;
        ctx.fillText(isNum(r) ? (i === j ? '1.00' : r.toFixed(2)) : '—', x + size / 2, y + size / 2);
      }
    }
    return { cell: size, left: labelW, top: labelW, size: size, n: n };
  }

  /** Map a canvas-relative (x, y) in CSS px to {row, col} or null. */
  function cellAt(geom, x, y) {
    if (!geom || !geom.size) return null;
    var col = Math.floor((x - geom.left) / geom.size), row = Math.floor((y - geom.top) / geom.size);
    if (col < 0 || row < 0 || col >= geom.n || row >= geom.n) return null;
    return { row: row, col: col };
  }

  /* ------------------------------------------------------------------ *
   * Symbol list helpers shared with the page (and tested)
   * ------------------------------------------------------------------ */
  function normalizeSymbols(list, max) {
    max = max || MAX_SYMBOLS;
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var sym = String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
      if (sym && sym.length <= 10 && out.indexOf(sym) < 0 && out.length < max) out.push(sym);
    });
    return out;
  }

  BT.compare = {
    MAX_SYMBOLS: MAX_SYMBOLS,
    BENCHMARK: BENCHMARK,
    PERIODS: PERIODS,
    NOTES: NOTES,
    periodById: periodById,
    align: align,
    periodStart: periodStart,
    slice: slice,
    rebase: rebase,
    returns: returns,
    logReturns: logReturns,
    pearson: pearson,
    covariance: covariance,
    variance: variance,
    stdev: stdev,
    correlationMatrix: correlationMatrix,
    beta: beta,
    relativeStrength: relativeStrength,
    maxDrawdownPct: maxDrawdownPct,
    stats: stats,
    pctChange: pctChange,
    heat: heat,
    tileWeight: tileWeight,
    describeCorrelation: describeCorrelation,
    describeBeta: describeBeta,
    diversification: diversification,
    drawMatrix: drawMatrix,
    cellAt: cellAt,
    cellColor: cellColor,
    normalizeSymbols: normalizeSymbols
  };
})();
