/* Broward Trading — js/indicators.js → BT.ind
 *
 * Pure technical-analysis functions. No DOM, no network, no state.
 * Every series function takes arrays (oldest → newest) and returns an array of
 * the SAME length, with `null` wherever the indicator is not yet defined
 * (the "warm-up" period). That keeps everything index-aligned with the bars,
 * which is what the chart, the signal engine and the backtester all rely on.
 *
 * Bar shape: {time, open, high, low, close, volume}.
 *
 * Formulas follow the textbook definitions (Wilder, Appel, Bollinger, Lane,
 * Hosoda) so numbers match what students see in StockCharts / TradingView.
 * Each function carries a short "what it means" note for the course.
 */
(function () {
  'use strict';
  /* Reason texts for the composite signal are UI strings: translated through BT.t when js/i18n.js is loaded
   * (looked up at call time, so load order does not matter); plain {var} interpolation otherwise.
   * Candlestick patterns keep `name` in English (it is an identifier: the screener and the dashboard match on it)
   * and add `label` (the translated name); `description` and every signal `text` / `why` go through T(). */
  function T(s, v) {
    var tf = typeof window !== 'undefined' && window.BT && window.BT.t;
    if (tf) { try { return tf(s, v); } catch (e) { /* fall through */ } }
    return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s;
  }
  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.BT = root.BT || {};
  var BT = root.BT;

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function nulls(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = null; return a; }
  function closes(bars) { return bars.map(function (b) { return b.close; }); }
  function highs(bars) { return bars.map(function (b) { return b.high; }); }
  function lows(bars) { return bars.map(function (b) { return b.low; }); }
  function clampInt(n, def) { n = Math.floor(Number(n)); return (isFinite(n) && n > 0) ? n : def; }

  /** Rolling maximum / minimum over the trailing n values (null during warm-up). */
  function rollingMax(values, n) {
    var out = nulls(values.length);
    for (var i = n - 1; i < values.length; i++) {
      var m = -Infinity, ok = true;
      for (var j = i - n + 1; j <= i; j++) { if (!isNum(values[j])) { ok = false; break; } if (values[j] > m) m = values[j]; }
      out[i] = ok ? m : null;
    }
    return out;
  }
  function rollingMin(values, n) {
    var out = nulls(values.length);
    for (var i = n - 1; i < values.length; i++) {
      var m = Infinity, ok = true;
      for (var j = i - n + 1; j <= i; j++) { if (!isNum(values[j])) { ok = false; break; } if (values[j] < m) m = values[j]; }
      out[i] = ok ? m : null;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Moving averages
   * ------------------------------------------------------------------ */

  /**
   * Simple Moving Average: the arithmetic mean of the last n values.
   * Meaning: the "fair price" of the last n bars; price above a rising SMA is an uptrend.
   */
  function sma(values, n) {
    n = clampInt(n, 20);
    var len = values.length, out = nulls(len);
    var sum = 0, bad = 0; // running sum, count of non-numeric values inside the window
    for (var i = 0; i < len; i++) {
      var v = values[i];
      if (isNum(v)) sum += v; else bad++;
      if (i >= n) { var old = values[i - n]; if (isNum(old)) sum -= old; else bad--; }
      if (i >= n - 1 && bad === 0) out[i] = sum / n;
    }
    return out;
  }

  /**
   * Exponential Moving Average, seeded with the SMA of the first n values, then
   * EMA_t = price_t * k + EMA_{t-1} * (1 - k) with k = 2 / (n + 1).
   * Meaning: like an SMA but recent bars weigh more, so it turns sooner.
   */
  function ema(values, n) {
    n = clampInt(n, 20);
    var len = values.length, out = nulls(len), k = 2 / (n + 1);
    var prev = null, start = -1;
    // find the first window of n consecutive numeric values to seed from
    var run = 0;
    for (var i = 0; i < len; i++) {
      if (isNum(values[i])) run++; else run = 0;
      if (run === n) { start = i; break; }
    }
    if (start < 0) return out;
    var seed = 0;
    for (var j = start - n + 1; j <= start; j++) seed += values[j];
    prev = seed / n; out[start] = prev;
    for (var t = start + 1; t < len; t++) {
      var v = values[t];
      if (!isNum(v)) { out[t] = null; continue; } // hold the chain; skip the gap
      prev = v * k + prev * (1 - k);
      out[t] = prev;
    }
    return out;
  }

  /**
   * Weighted Moving Average: linear weights 1..n (newest bar weighs n).
   * Meaning: between SMA and EMA in responsiveness; weights sum to n(n+1)/2.
   */
  function wma(values, n) {
    n = clampInt(n, 20);
    var len = values.length, out = nulls(len), denom = n * (n + 1) / 2;
    for (var i = n - 1; i < len; i++) {
      var acc = 0, ok = true;
      for (var j = 0; j < n; j++) {
        var v = values[i - n + 1 + j];
        if (!isNum(v)) { ok = false; break; }
        acc += v * (j + 1);
      }
      out[i] = ok ? acc / denom : null;
    }
    return out;
  }

  /** Rolling population standard deviation (what Bollinger uses). */
  function stdev(values, n) {
    n = clampInt(n, 20);
    var len = values.length, out = nulls(len);
    var sum = 0, sumSq = 0, bad = 0;
    for (var i = 0; i < len; i++) {
      var v = values[i];
      if (isNum(v)) { sum += v; sumSq += v * v; } else bad++;
      if (i >= n) { var old = values[i - n]; if (isNum(old)) { sum -= old; sumSq -= old * old; } else bad--; }
      if (i >= n - 1 && bad === 0) {
        var mean = sum / n, varc = sumSq / n - mean * mean;
        out[i] = Math.sqrt(varc > 0 ? varc : 0); // guard tiny negative rounding
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Momentum
   * ------------------------------------------------------------------ */

  /**
   * Relative Strength Index (Wilder, 1978).
   * First average gain/loss = simple mean of the first n changes; after that
   * avg = (prevAvg * (n - 1) + current) / n (Wilder smoothing).
   * RSI = 100 - 100 / (1 + avgGain / avgLoss). First value appears at index n.
   * Meaning: 0–100 momentum. Below 30 "oversold", above 70 "overbought".
   */
  function rsi(values, n) {
    n = clampInt(n, 14);
    var len = values.length, out = nulls(len);
    if (len <= n) return out;
    var gain = 0, loss = 0, i;
    for (i = 1; i <= n; i++) {
      // A null (missing) close must not coerce to 0 — bail out of warm-up.
      if (!isNum(values[i]) || !isNum(values[i - 1])) return out;
      var d = values[i] - values[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    out[n] = rsiValue(gain, loss);
    for (i = n + 1; i < len; i++) {
      // Gap in the data: emit null and keep the Wilder state frozen.
      if (!isNum(values[i]) || !isNum(values[i - 1])) { out[i] = null; continue; }
      var ch = values[i] - values[i - 1];
      gain = (gain * (n - 1) + (ch > 0 ? ch : 0)) / n;
      loss = (loss * (n - 1) + (ch < 0 ? -ch : 0)) / n;
      out[i] = rsiValue(gain, loss);
    }
    return out;
  }
  function rsiValue(gain, loss) {
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  }

  /**
   * MACD (Appel): macd = EMA(fast) - EMA(slow); signal = EMA(signal) of the MACD
   * line; histogram = macd - signal.
   * Meaning: distance between two trends. Histogram crossing zero = the lines crossed.
   */
  function macd(values, fast, slow, signal) {
    fast = clampInt(fast, 12); slow = clampInt(slow, 26); signal = clampInt(signal, 9);
    var eF = ema(values, fast), eS = ema(values, slow), len = values.length;
    var line = nulls(len);
    for (var i = 0; i < len; i++) if (eF[i] != null && eS[i] != null) line[i] = eF[i] - eS[i];
    // signal line: EMA of the MACD line, starting where the line starts
    var first = -1;
    for (var j = 0; j < len; j++) if (line[j] != null) { first = j; break; }
    var sig = nulls(len), hist = nulls(len);
    if (first >= 0) {
      var sub = ema(line.slice(first), signal);
      for (var t = 0; t < sub.length; t++) {
        sig[first + t] = sub[t];
        if (sub[t] != null && line[first + t] != null) hist[first + t] = line[first + t] - sub[t];
      }
    }
    return { macd: line, signal: sig, hist: hist };
  }

  /**
   * Bollinger Bands: middle = SMA(n); upper/lower = middle ± k · population stdev.
   * bandwidth = (upper - lower) / middle (a "squeeze" is a low bandwidth).
   * Meaning: statistically normal range; ~95 % of closes sit inside 2σ bands.
   */
  function bollinger(values, n, k) {
    n = clampInt(n, 20); k = isNum(Number(k)) ? Number(k) : 2;
    var mid = sma(values, n), sd = stdev(values, n), len = values.length;
    var upper = nulls(len), lower = nulls(len), bw = nulls(len);
    for (var i = 0; i < len; i++) {
      if (mid[i] == null || sd[i] == null) continue;
      upper[i] = mid[i] + k * sd[i];
      lower[i] = mid[i] - k * sd[i];
      bw[i] = mid[i] !== 0 ? (upper[i] - lower[i]) / mid[i] : null;
    }
    return { upper: upper, middle: mid, lower: lower, bandwidth: bw };
  }

  /* ------------------------------------------------------------------ *
   * Volatility & trend strength
   * ------------------------------------------------------------------ */

  /** True Range per bar: max(H-L, |H-prevC|, |L-prevC|). Bar 0 uses H-L.
   *  A bar with a null high/low (or a null previous close) yields null. */
  function trueRange(bars) {
    var out = nulls(bars.length);
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (!b || !isNum(b.high) || !isNum(b.low)) continue;
      if (i === 0) { out[i] = b.high - b.low; continue; }
      var pc = bars[i - 1] ? bars[i - 1].close : null;
      if (!isNum(pc)) continue;
      out[i] = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    }
    return out;
  }

  /**
   * Average True Range (Wilder). First ATR (at index n) is the simple mean of
   * TR[1..n]; afterwards ATR = (prevATR * (n - 1) + TR) / n.
   * Meaning: how much the stock typically moves per bar. Used for stops and sizing.
   */
  function atr(bars, n) {
    n = clampInt(n, 14);
    var len = bars.length, out = nulls(len);
    if (len <= n) return out;
    var tr = trueRange(bars), acc = 0, i;
    for (i = 1; i <= n; i++) { if (!isNum(tr[i])) return out; acc += tr[i]; }
    var a = acc / n; out[n] = a;
    for (i = n + 1; i < len; i++) {
      if (!isNum(tr[i])) { out[i] = null; continue; } // data gap: hold state, emit null
      a = (a * (n - 1) + tr[i]) / n; out[i] = a;
    }
    return out;
  }

  /**
   * Average Directional Index (Wilder).
   * +DM = up-move when it exceeds the down-move (else 0); -DM mirrored.
   * Smoothed sums use Wilder's accumulation: S_t = S_{t-1} - S_{t-1}/n + X_t,
   * seeded with the plain sum of the first n values (indices 1..n).
   * +DI = 100 · S(+DM)/S(TR); DX = 100 · |+DI - -DI| / (+DI + -DI);
   * ADX = Wilder average of DX, first value (index 2n-1) = mean of first n DX.
   * Meaning: ADX measures trend STRENGTH (not direction): < 20 flat, > 25 trending.
   * The DI lines give direction: +DI above -DI = buyers in control.
   */
  function adx(bars, n) {
    n = clampInt(n, 14);
    var len = bars.length;
    var res = { adx: nulls(len), plusDI: nulls(len), minusDI: nulls(len) };
    if (len <= n) return res;
    var tr = trueRange(bars), pdm = nulls(len), mdm = nulls(len), i;
    for (i = 1; i < len; i++) {
      if (!isNum(tr[i])) continue; // null high/low on this or the previous bar
      var up = bars[i].high - bars[i - 1].high, dn = bars[i - 1].low - bars[i].low;
      pdm[i] = (up > dn && up > 0) ? up : 0;
      mdm[i] = (dn > up && dn > 0) ? dn : 0;
    }
    var sTR = 0, sP = 0, sM = 0;
    for (i = 1; i <= n; i++) { if (!isNum(tr[i])) return res; sTR += tr[i]; sP += pdm[i]; sM += mdm[i]; }
    var dx = nulls(len);
    function emit(idx) {
      var p = sTR > 0 ? 100 * sP / sTR : 0, m = sTR > 0 ? 100 * sM / sTR : 0;
      res.plusDI[idx] = p; res.minusDI[idx] = m;
      dx[idx] = (p + m) > 0 ? 100 * Math.abs(p - m) / (p + m) : 0;
    }
    emit(n);
    for (i = n + 1; i < len; i++) {
      if (!isNum(tr[i])) continue; // data gap: hold state, leave this bar null
      sTR = sTR - sTR / n + tr[i];
      sP = sP - sP / n + pdm[i];
      sM = sM - sM / n + mdm[i];
      emit(i);
    }
    // ADX: Wilder average of DX, seeded at index 2n-1
    var firstAdxIdx = 2 * n - 1;
    if (len <= firstAdxIdx) return res;
    var acc = 0;
    for (i = n; i <= firstAdxIdx; i++) { if (!isNum(dx[i])) return res; acc += dx[i]; }
    var a = acc / n; res.adx[firstAdxIdx] = a;
    for (i = firstAdxIdx + 1; i < len; i++) {
      if (!isNum(dx[i])) continue;
      a = (a * (n - 1) + dx[i]) / n; res.adx[i] = a;
    }
    return res;
  }

  /**
   * Stochastic oscillator (Lane): %K = 100 · (C - LL_k) / (HH_k - LL_k), %D = SMA_d(%K).
   * Meaning: where the close sits inside the recent range. > 80 high, < 20 low.
   */
  function stochastic(bars, k, d) {
    k = clampInt(k, 14); d = clampInt(d, 3);
    var hh = rollingMax(highs(bars), k), ll = rollingMin(lows(bars), k), len = bars.length;
    var kArr = nulls(len);
    for (var i = 0; i < len; i++) {
      if (hh[i] == null || ll[i] == null) continue;
      var range = hh[i] - ll[i];
      kArr[i] = range > 0 ? 100 * (bars[i].close - ll[i]) / range : 50;
    }
    var dArr = nulls(len), first = -1;
    for (var j = 0; j < len; j++) if (kArr[j] != null) { first = j; break; }
    if (first >= 0) { var sub = sma(kArr.slice(first), d); for (var t = 0; t < sub.length; t++) dArr[first + t] = sub[t]; }
    return { k: kArr, d: dArr };
  }

  /* ------------------------------------------------------------------ *
   * Volume
   * ------------------------------------------------------------------ */

  /** Trading-day key for a bar: 'YYYY-MM-DD' strings as-is; unix seconds → New York calendar day. */
  var _dayCache = {};
  function dayKey(time) {
    if (typeof time === 'string') return time.slice(0, 10);
    if (!isNum(time)) return String(time);
    var hourBucket = Math.floor(time / 3600);
    if (_dayCache[hourBucket]) return _dayCache[hourBucket];
    var key;
    try {
      key = new Date(time * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    } catch (e) {
      key = new Date(time * 1000).toISOString().slice(0, 10);
    }
    _dayCache[hourBucket] = key;
    return key;
  }

  /**
   * Volume-Weighted Average Price: Σ(typical price · volume) / Σ volume, where
   * typical price = (H + L + C) / 3. Resets at each new session for intraday
   * bars (numeric times); cumulative for daily bars (string dates).
   * Meaning: the average price actually paid today. Institutions benchmark against it.
   */
  function vwap(bars) {
    var len = bars.length, out = nulls(len);
    if (!len) return out;
    var intraday = typeof bars[0].time === 'number';
    var pv = 0, vol = 0, day = null;
    for (var i = 0; i < len; i++) {
      var b = bars[i];
      if (intraday) {
        var k = dayKey(b.time);
        if (k !== day) { day = k; pv = 0; vol = 0; }
      }
      var v = isNum(b.volume) ? b.volume : 0;
      pv += ((b.high + b.low + b.close) / 3) * v; vol += v;
      out[i] = vol > 0 ? pv / vol : b.close;
    }
    return out;
  }

  /**
   * On-Balance Volume: running total that adds volume on up-closes and subtracts
   * it on down-closes. Meaning: is volume flowing in (rising OBV) or out?
   */
  function obv(bars) {
    var len = bars.length, out = nulls(len);
    if (!len) return out;
    var acc = 0; out[0] = 0;
    for (var i = 1; i < len; i++) {
      var c = bars[i].close, pc = bars[i - 1].close;
      if (!isNum(c) || !isNum(pc)) { out[i] = null; continue; } // null close: no direction, emit null
      var v = isNum(bars[i].volume) ? bars[i].volume : 0;
      if (c > pc) acc += v;
      else if (c < pc) acc -= v;
      out[i] = acc;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Ichimoku Kinko Hyo (Hosoda) — 9 / 26 / 52
   * ------------------------------------------------------------------ */

  /**
   * tenkan (conversion) = midpoint of the 9-bar high/low range
   * kijun (base)        = midpoint of the 26-bar range
   * senkouA (leading A) = (tenkan + kijun) / 2, PLOTTED 26 bars ahead
   * senkouB (leading B) = midpoint of the 52-bar range, PLOTTED 26 bars ahead
   * chikou (lagging)    = close, PLOTTED 26 bars behind
   *
   * All five arrays are indexed to the bar they were COMPUTED from (same length
   * as `bars`), and `displacement` (26) tells the renderer how far to shift
   * senkouA/senkouB forward and chikou backward. For convenience `shifted`
   * holds the plotted alignment within the existing bars: shifted.senkouA[i]
   * is the cloud value that belongs ABOVE bar i (computed at bar i-26), and
   * shifted.chikou[i] is the close from bar i+26 (null near the right edge).
   * The 26 cloud values that extend beyond the last bar are in `future`.
   * Meaning: price above the cloud = uptrend; cloud thickness = support strength.
   */
  function ichimoku(bars, tenkanN, kijunN, senkouN) {
    tenkanN = clampInt(tenkanN, 9); kijunN = clampInt(kijunN, 26); senkouN = clampInt(senkouN, 52);
    var H = highs(bars), L = lows(bars), len = bars.length, i;
    var disp = kijunN;
    function mid(n) {
      var hh = rollingMax(H, n), ll = rollingMin(L, n), o = nulls(len);
      for (var j = 0; j < len; j++) if (hh[j] != null && ll[j] != null) o[j] = (hh[j] + ll[j]) / 2;
      return o;
    }
    var tenkan = mid(tenkanN), kijun = mid(kijunN), senkouB = mid(senkouN);
    var senkouA = nulls(len);
    for (i = 0; i < len; i++) if (tenkan[i] != null && kijun[i] != null) senkouA[i] = (tenkan[i] + kijun[i]) / 2;
    var chikou = closes(bars);
    var shifted = { senkouA: nulls(len), senkouB: nulls(len), chikou: nulls(len) };
    for (i = 0; i < len; i++) {
      if (i - disp >= 0) { shifted.senkouA[i] = senkouA[i - disp]; shifted.senkouB[i] = senkouB[i - disp]; }
      if (i + disp < len) shifted.chikou[i] = chikou[i + disp];
    }
    var future = [];
    for (i = Math.max(0, len - disp); i < len; i++) future.push({ offset: i + disp - (len - 1), senkouA: senkouA[i], senkouB: senkouB[i] });
    return { tenkan: tenkan, kijun: kijun, senkouA: senkouA, senkouB: senkouB, chikou: chikou,
      displacement: disp, periods: { tenkan: tenkanN, kijun: kijunN, senkou: senkouN }, shifted: shifted, future: future };
  }

  /* ------------------------------------------------------------------ *
   * Structure: pivots, support / resistance, Fibonacci
   * ------------------------------------------------------------------ */

  /**
   * Swing points. Bar i is a pivot high when its high is the highest of the
   * `left` bars before and `right` bars after it (ties allowed on the left,
   * strict on the right so a plateau yields one pivot). Mirrored for lows.
   * Meaning: the turning points traders connect for trend lines and S/R.
   */
  function pivots(bars, left, right) {
    left = clampInt(left, 5); right = clampInt(right, 5);
    var out = { highs: [], lows: [] };
    for (var i = left; i < bars.length - right; i++) {
      var h = bars[i].high, l = bars[i].low, isH = true, isL = true;
      for (var j = i - left; j <= i + right && (isH || isL); j++) {
        if (j === i) continue;
        if (j < i) { if (bars[j].high > h) isH = false; if (bars[j].low < l) isL = false; }
        else { if (bars[j].high >= h) isH = false; if (bars[j].low <= l) isL = false; }
      }
      if (isH) out.highs.push({ index: i, price: h });
      if (isL) out.lows.push({ index: i, price: l });
    }
    return out;
  }

  /**
   * Support & resistance: cluster recent pivot prices (within 0.6 %) into
   * levels, then split them around the last close — levels below are support,
   * levels above are resistance (a broken resistance becomes support, which is
   * why we classify by position, not by whether it was a high or a low).
   * Returns at most `max` of each, nearest to price first.
   */
  function supportResistance(bars, lookback, max) {
    lookback = clampInt(lookback, 120); max = clampInt(max, 3);
    var res = { support: [], resistance: [] };
    if (!bars.length) return res;
    var from = Math.max(0, bars.length - lookback), slice = bars.slice(from);
    var pv = pivots(slice, 5, 5);
    var pts = pv.highs.concat(pv.lows).map(function (p) { return { price: p.price, index: p.index + from }; });
    pts.sort(function (a, b) { return a.price - b.price; });
    // cluster adjacent prices within 0.6 %
    var clusters = [];
    for (var i = 0; i < pts.length; i++) {
      var c = clusters[clusters.length - 1];
      if (c && Math.abs(pts[i].price - c.mean) / c.mean <= 0.006) {
        c.sum += pts[i].price; c.count++; c.mean = c.sum / c.count; c.last = Math.max(c.last, pts[i].index);
      } else clusters.push({ sum: pts[i].price, count: 1, mean: pts[i].price, last: pts[i].index });
    }
    var px = bars[bars.length - 1].close;
    var below = clusters.filter(function (c) { return c.mean <= px; }).sort(function (a, b) { return b.mean - a.mean; });
    var above = clusters.filter(function (c) { return c.mean > px; }).sort(function (a, b) { return a.mean - b.mean; });
    var round = function (v) { return Math.round(v * 100) / 100; };
    res.support = below.slice(0, max).map(function (c) { return round(c.mean); });
    res.resistance = above.slice(0, max).map(function (c) { return round(c.mean); });
    res.levels = clusters.map(function (c) { return { price: round(c.mean), touches: c.count, lastIndex: c.last, kind: c.mean <= px ? 'support' : 'resistance' }; });
    return res;
  }

  /**
   * Fibonacci retracement levels between a swing high and a swing low.
   * price(level) = high - (high - low) · level, so 0 = the high and 1 = the low.
   * Meaning: common pullback depths. 0.382–0.618 is "the golden pocket".
   */
  var FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  function fibonacci(high, low) {
    var hi = Math.max(high, low), lo = Math.min(high, low), range = hi - lo;
    return FIB_LEVELS.map(function (lv) {
      return { level: lv, price: hi - range * lv, label: lv === 0 ? '0 % (high)' : lv === 1 ? '100 % (low)' : (lv * 100).toFixed(1) + ' %' };
    });
  }

  /* ------------------------------------------------------------------ *
   * Candlestick patterns
   * ------------------------------------------------------------------ */
  function anatomy(b) {
    var body = Math.abs(b.close - b.open), range = b.high - b.low;
    return {
      body: body, range: range,
      upper: b.high - Math.max(b.open, b.close),
      lower: Math.min(b.open, b.close) - b.low,
      bull: b.close > b.open, bear: b.close < b.open,
      mid: (b.open + b.close) / 2
    };
  }
  /** Did price fall into bar i? (closes trending down over the prior 3 bars) */
  function downTrendInto(bars, i) {
    if (i < 3) return true; // not enough history to object
    return bars[i - 1].close < bars[i - 3].close;
  }
  function upTrendInto(bars, i) {
    if (i < 3) return true;
    return bars[i - 1].close > bars[i - 3].close;
  }

  /**
   * Scans every bar and returns the single-, two- and three-candle patterns
   * found, each anchored at the LAST bar of the pattern.
   */
  function candlePatterns(bars) {
    var out = [];
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i], a = anatomy(b);
      if (!(a.range > 0)) continue;

      // ---- single candle ----
      if (a.body <= a.range * 0.1) {
        out.push({ index: i, name: 'Doji', label: T('Doji'), bias: 'neutral',
          description: T('Open and close are nearly equal: buyers and sellers fought to a draw. After a strong move it warns the trend may be tiring; wait for the next candle to confirm direction.') });
      } else if (a.lower >= 2 * a.body && a.upper <= a.body * 0.5 && a.body >= a.range * 0.1 && downTrendInto(bars, i)) {
        out.push({ index: i, name: 'Hammer', label: T('Hammer'), bias: 'bull',
          description: T('A small body at the top with a long lower wick after a decline. Sellers pushed price down hard, but buyers took it all back by the close: a potential bottom, confirmed if the next bar closes higher.') });
      } else if (a.upper >= 2 * a.body && a.lower <= a.body * 0.5 && a.body >= a.range * 0.1 && upTrendInto(bars, i)) {
        out.push({ index: i, name: 'Shooting star', label: T('Shooting star'), bias: 'bear',
          description: T('A small body at the bottom with a long upper wick after a rally. Buyers tried to extend the move and were rejected: a potential top, confirmed if the next bar closes lower.') });
      }

      // ---- two candles ----
      if (i >= 1) {
        var p = bars[i - 1], pa = anatomy(p);
        if (pa.bear && a.bull && b.open <= p.close && b.close >= p.open && a.body > pa.body && pa.body > 0) {
          out.push({ index: i, name: 'Bullish engulfing', label: T('Bullish engulfing'), bias: 'bull',
            description: T('A green body that completely covers the previous red body. Buyers overwhelmed the prior session\'s sellers; strongest after a downtrend and on heavier volume.') });
        } else if (pa.bull && a.bear && b.open >= p.close && b.close <= p.open && a.body > pa.body && pa.body > 0) {
          out.push({ index: i, name: 'Bearish engulfing', label: T('Bearish engulfing'), bias: 'bear',
            description: T('A red body that completely covers the previous green body. Sellers overwhelmed the prior session\'s buyers; strongest after an uptrend.') });
        }
      }

      // ---- three candles ----
      if (i >= 2) {
        var b1 = bars[i - 2], b2 = bars[i - 1], a1 = anatomy(b1), a2 = anatomy(b2);
        var long1 = a1.body >= a1.range * 0.5 && a1.range > 0;
        // Morning star: long red, small body below it, long green closing above red's midpoint
        if (long1 && a1.bear && a2.body <= a1.body * 0.3 && Math.max(b2.open, b2.close) <= b1.close &&
            a.bull && b.close >= a1.mid && a.body >= a1.body * 0.5) {
          out.push({ index: i, name: 'Morning star', label: T('Morning star'), bias: 'bull',
            description: T('Three-bar bottom: a strong red candle, a small indecision candle gapping lower, then a strong green candle that recovers past the midpoint of the first. Selling pressure stalled and buyers took over.') });
        }
        // Evening star: mirror image at a top
        if (long1 && a1.bull && a2.body <= a1.body * 0.3 && Math.min(b2.open, b2.close) >= b1.close &&
            a.bear && b.close <= a1.mid && a.body >= a1.body * 0.5) {
          out.push({ index: i, name: 'Evening star', label: T('Evening star'), bias: 'bear',
            description: T('Three-bar top: a strong green candle, a small indecision candle gapping higher, then a strong red candle that falls past the midpoint of the first. Buying pressure stalled and sellers took over.') });
        }
        // Three white soldiers / three black crows
        var solid = function (x) { return x.body >= x.range * 0.5; };
        if (a1.bull && a2.bull && a.bull && solid(a1) && solid(a2) && solid(a) &&
            b2.open >= b1.open && b2.open <= b1.close && b2.close > b1.close &&
            b.open >= b2.open && b.open <= b2.close && b.close > b2.close) {
          out.push({ index: i, name: 'Three white soldiers', label: T('Three white soldiers'), bias: 'bull',
            description: T('Three consecutive strong green candles, each opening inside the prior body and closing at a new high. Steady, confident buying; often marks the start of an advance after a base.') });
        }
        if (a1.bear && a2.bear && a.bear && solid(a1) && solid(a2) && solid(a) &&
            b2.open <= b1.open && b2.open >= b1.close && b2.close < b1.close &&
            b.open <= b2.open && b.open >= b2.close && b.close < b2.close) {
          out.push({ index: i, name: 'Three black crows', label: T('Three black crows'), bias: 'bear',
            description: T('Three consecutive strong red candles, each opening inside the prior body and closing at a new low. Persistent selling; often marks the start of a decline after a top.') });
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Composite signal engine
   * ------------------------------------------------------------------ */
  var SIGNAL_MAX = 8;        // sum of the absolute weights below
  var BUY_AT = 3, SELL_AT = -3;

  /**
   * computeAll(bars) → every indicator the dashboard, course and backtester need
   * in one object. Expensive-ish (O(n · window)), so call once per data load.
   */
  function computeAll(bars) {
    bars = bars || [];
    var c = closes(bars);
    var out = {
      bars: bars, closes: c,
      sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200),
      ema9: ema(c, 9), ema21: ema(c, 21), wma20: wma(c, 20),
      rsi: rsi(c, 14),
      macd: macd(c, 12, 26, 9),
      bollinger: bollinger(c, 20, 2),
      atr: atr(bars, 14),
      adx: adx(bars, 14),
      stochastic: stochastic(bars, 14, 3),
      vwap: vwap(bars),
      obv: obv(bars),
      ichimoku: ichimoku(bars),
      pivots: pivots(bars, 5, 5),
      sr: supportResistance(bars, 120, 3),
      patterns: candlePatterns(bars),
      fib: null
    };
    // Fibonacci on the last 120-bar swing
    if (bars.length) {
      var recent = bars.slice(-120), hi = -Infinity, lo = Infinity;
      for (var i = 0; i < recent.length; i++) { if (recent[i].high > hi) hi = recent[i].high; if (recent[i].low < lo) lo = recent[i].low; }
      out.fib = fibonacci(hi, lo);
    }
    // aliases the v0.1 dashboard used, so old call sites keep working
    out.bbU = out.bollinger.upper; out.bbL = out.bollinger.lower;
    out.sig = out.macd.signal; out.hist = out.macd.hist; out.macdLine = out.macd.macd;
    out.res = out.sr.resistance; out.sup = out.sr.support;
    return out;
  }

  /** Ensure `ind` has what the scorer needs; compute if missing. */
  function ensureInd(bars, ind) {
    if (ind && ind.sma20 && ind.sma50 && ind.rsi && ind.macd && ind.bollinger) return ind;
    if (ind && ind.sma20 && ind.sma50 && ind.rsi && ind.hist && ind.bbU && ind.bbL) {
      // v0.1-style flat object
      return Object.assign({}, ind, {
        macd: ind.macd && ind.macd.hist ? ind.macd : { macd: ind.macdLine || ind.macd || [], signal: ind.sig || [], hist: ind.hist },
        bollinger: { upper: ind.bbU, lower: ind.bbL, middle: ind.sma20, bandwidth: [] }
      });
    }
    return computeAll(bars);
  }

  /**
   * signals(bars, ind, i) — composite score for bar i (default: the last bar).
   * Six rule-based components, each explained, totalling ±8:
   *   ±1 price vs SMA 50 · ±1 SMA 20 vs SMA 50 · ±2 RSI zone · ±1 MACD histogram
   *   ±1 Bollinger position · ±2 golden/death cross on this bar.
   * BUY at +3 or more, SELL at −3 or less, otherwise HOLD. ADX is reported as
   * context (0 pts) so students learn to weigh trend strength.
   * Returns {score, max, state, reasons:[{pts, text, why}], index, close}.
   */
  function signals(bars, ind, i) {
    bars = bars || [];
    if (!bars.length) return { score: 0, max: SIGNAL_MAX, state: 'HOLD', reasons: [{ pts: 0, text: T('No data'), why: T('Load a symbol first') }], index: -1, close: null };
    ind = ensureInd(bars, ind);
    if (i == null || i < 0 || i >= bars.length) i = bars.length - 1;
    return scoreAt(bars, ind, i);
  }

  function scoreAt(bars, ind, i) {
    var c = bars[i].close, r = [], s = 0;
    var add = function (pts, text, why) { s += pts; r.push({ pts: pts, text: text, why: why }); };
    var sma20 = ind.sma20[i], sma50 = ind.sma50[i];
    var hist = ind.macd.hist, bbU = ind.bollinger.upper[i], bbL = ind.bollinger.lower[i];

    if (sma50 != null) {
      add(c > sma50 ? 1 : -1, c > sma50 ? T('Price above SMA 50') : T('Price below SMA 50'), T('Long-term trend filter: trade in the direction of the 50-bar average'));
    } else add(0, T('SMA 50 not available yet'), T('Needs 50 bars of history'));

    if (sma20 != null && sma50 != null) {
      var bullAlign = sma20 > sma50;
      add(bullAlign ? 1 : -1, bullAlign ? T('SMA 20 above SMA 50 (bullish alignment)') : T('SMA 20 below SMA 50 (bearish alignment)'), T('Trend direction: short-term average leading the long-term one'));
    }

    if (ind.rsi[i] != null) {
      var v = ind.rsi[i];
      if (v < 30) add(2, T('RSI {v} is oversold', { v: v.toFixed(0) }), T('Momentum stretched down; sellers may be exhausted (bounce candidate)'));
      else if (v > 70) add(-2, T('RSI {v} is overbought', { v: v.toFixed(0) }), T('Momentum stretched up; buyers may be exhausted (pullback candidate)'));
      else add(0, T('RSI {v} is neutral', { v: v.toFixed(0) }), T('Between 30 and 70: no extreme'));
    }

    if (hist[i] != null) {
      var h = hist[i], ph = hist[i - 1] != null ? hist[i - 1] : h;
      if (h > 0 && h >= ph) add(1, T('MACD histogram positive and rising'), T('Upward momentum accelerating'));
      else if (h < 0 && h <= ph) add(-1, T('MACD histogram negative and falling'), T('Downward momentum accelerating'));
      else add(0, h > 0 ? T('MACD positive but fading') : T('MACD negative but recovering'), T('Momentum losing steam; watch for a cross'));
    }

    if (bbL != null && bbU != null) {
      if (c < bbL) add(1, T('Close below lower Bollinger Band'), T('More than 2 standard deviations below the 20-bar mean: statistically stretched down'));
      else if (c > bbU) add(-1, T('Close above upper Bollinger Band'), T('More than 2 standard deviations above the 20-bar mean: statistically stretched up'));
      else add(0, T('Inside Bollinger Bands'), T('Normal range'));
    }

    if (i > 0 && sma20 != null && sma50 != null && ind.sma20[i - 1] != null && ind.sma50[i - 1] != null) {
      var up = sma20 > sma50, pu = ind.sma20[i - 1] > ind.sma50[i - 1];
      if (up && !pu) add(2, T('Golden cross on this bar'), T('SMA 20 crossed above SMA 50: a classic trend-change signal'));
      else if (!up && pu) add(-2, T('Death cross on this bar'), T('SMA 20 crossed below SMA 50: a classic trend-change signal'));
    }

    // Context (no points): trend strength
    if (ind.adx && ind.adx.adx && ind.adx.adx[i] != null) {
      var ax = ind.adx.adx[i];
      add(0, T(ax >= 25 ? 'ADX {v}: strong trend' : ax < 20 ? 'ADX {v}: no clear trend' : 'ADX {v}: trend building', { v: ax.toFixed(0) }),
        ax >= 25 ? T('Trend-following signals are more reliable; mean-reversion (RSI/Bollinger) less so') : ax < 20 ? T('Range-bound market: mean-reversion signals matter more, crossovers whipsaw') : T('Transitional'));
    }

    // Context: the latest candlestick pattern ending on this bar
    if (ind.patterns && ind.patterns.length) {
      for (var p = ind.patterns.length - 1; p >= 0; p--) {
        if (ind.patterns[p].index === i) { var pt = ind.patterns[p]; add(0, T('Candle: {name}', { name: pt.label || T(pt.name) }), pt.description); break; }
        if (ind.patterns[p].index < i) break;
      }
    }

    return { score: s, max: SIGNAL_MAX, state: s >= BUY_AT ? 'BUY' : s <= SELL_AT ? 'SELL' : 'HOLD', reasons: r, index: i, close: c };
  }

  /** State per bar ('BUY' | 'SELL' | 'HOLD'), same length as bars. */
  function signalSeries(bars, ind) {
    bars = bars || [];
    if (!bars.length) return [];
    ind = ensureInd(bars, ind);
    var out = new Array(bars.length);
    for (var i = 0; i < bars.length; i++) out[i] = scoreAt(bars, ind, i).state;
    return out;
  }

  /** Scores per bar, handy for charts/backtests that want the number too. */
  function scoreSeries(bars, ind) {
    bars = bars || [];
    if (!bars.length) return [];
    ind = ensureInd(bars, ind);
    var out = new Array(bars.length);
    for (var i = 0; i < bars.length; i++) out[i] = scoreAt(bars, ind, i).score;
    return out;
  }

  /**
   * Convert a null-padded series into lightweight-charts line data
   * ([{time, value}], nulls dropped). `shift` moves values forward (+) or
   * backward (−) by that many bars, for Ichimoku cloud/chikou plotting.
   */
  function toLineData(bars, series, shift) {
    shift = shift | 0;
    var out = [];
    for (var i = 0; i < series.length; i++) {
      var j = i + shift;
      if (series[i] == null || j < 0 || j >= bars.length) continue;
      out.push({ time: bars[j].time, value: series[i] });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Plain-language glossary for the Learn pages and tooltips
   * ------------------------------------------------------------------ */
  var glossary = {
    sma: 'Simple Moving Average: mean close of the last N bars. Smooths noise; slope shows trend.',
    ema: 'Exponential Moving Average: like SMA but recent bars count more, so it reacts faster.',
    wma: 'Weighted Moving Average: linear weights, newest bar heaviest.',
    rsi: 'Relative Strength Index (0–100): speed of recent gains vs losses. <30 oversold, >70 overbought.',
    macd: 'Moving Average Convergence/Divergence: EMA12 − EMA26 with a 9-bar signal line; histogram = their gap.',
    bollinger: 'Bollinger Bands: SMA20 ± 2 standard deviations. Price outside the bands is statistically stretched.',
    atr: 'Average True Range: typical bar-to-bar movement. Use it to size stops (e.g. 2 × ATR).',
    adx: 'Average Directional Index: trend strength 0–100 regardless of direction. >25 trending, <20 ranging.',
    stochastic: 'Stochastic %K/%D: where the close sits in the recent high-low range. >80 high, <20 low.',
    vwap: 'Volume-Weighted Average Price: the average price paid today. Above VWAP = buyers paying up.',
    obv: 'On-Balance Volume: cumulative volume signed by the day\'s direction. Confirms or diverges from price.',
    ichimoku: 'Ichimoku cloud: five lines (9/26/52) showing trend, momentum and future support/resistance at once.',
    pivots: 'Swing highs and lows: local turning points used for trend lines and support/resistance.',
    supportResistance: 'Price zones where reversals clustered before. Support below price, resistance above.',
    fibonacci: 'Fibonacci retracements: 23.6 / 38.2 / 50 / 61.8 / 78.6 % pullback levels of a swing.',
    candlePatterns: 'Single and multi-candle shapes (doji, hammer, engulfing, stars, soldiers/crows) that hint at reversals.',
    signals: 'Composite score (−8…+8) from six classic rules. BUY ≥ +3, SELL ≤ −3. Educational, not advice.'
  };

  BT.ind = {
    // moving averages & stats
    sma: sma, ema: ema, wma: wma, stdev: stdev,
    // momentum
    rsi: rsi, macd: macd, bollinger: bollinger, stochastic: stochastic,
    // volatility / trend strength
    trueRange: trueRange, atr: atr, adx: adx,
    // volume
    vwap: vwap, obv: obv,
    // structure
    ichimoku: ichimoku, pivots: pivots, supportResistance: supportResistance, fibonacci: fibonacci, FIB_LEVELS: FIB_LEVELS,
    // patterns
    candlePatterns: candlePatterns,
    // composite
    signals: signals, scoreAt: function (bars, ind, i) { return signals(bars, ind, i); },
    signalSeries: signalSeries, scoreSeries: scoreSeries, computeAll: computeAll,
    SIGNAL_MAX: SIGNAL_MAX, BUY_AT: BUY_AT, SELL_AT: SELL_AT,
    // utilities
    toLineData: toLineData, rollingMax: rollingMax, rollingMin: rollingMin, glossary: glossary,
    version: '0.2.0'
  };
})();
