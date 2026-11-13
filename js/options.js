/* Broward Trading — js/options.js → BT.options
 *
 * Options pricing and strategy analysis for the paper-trading lab.
 * Pure functions, no DOM, no network, no state. Loadable standalone.
 *
 * What lives here
 *   bs()          Black-Scholes-Merton price + greeks (with optional dividend yield q)
 *   impliedVol()  implied volatility by bisection
 *   chain()       a synthetic but realistic option chain (smile/skew, spreads, OI)
 *   payoff()      profit/loss at expiration for any set of legs
 *   analyze()     max profit, max loss, breakevens (solved numerically), cost
 *   strategies    preset multi-leg strategies with educational descriptions
 *   occ()/parseOcc()  OCC-style contract ids such as AAPL260117C00200000
 *
 * Conventions (match what students see on a broker screen):
 *   T is in YEARS (30 days = 30/365). r and sigma are decimals (0.05 = 5 %).
 *   theta is per CALENDAR DAY, vega is per 1 VOL POINT (sigma +0.01),
 *   rho is per 1 PERCENTAGE POINT of rates. All of them are per share;
 *   multiply by 100 for one standard contract.
 *   Premiums in legs are per share. Positive qty = long, negative = short.
 */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.BT = root.BT || {};
  var BT = root.BT;

  var SQRT2PI = Math.sqrt(2 * Math.PI);
  var DAYS_PER_YEAR = 365;
  var MULTIPLIER = 100;

  /* ------------------------------------------------------------------ *
   * Normal distribution
   * ------------------------------------------------------------------ */

  /** Standard normal density n(x). */
  function normPdf(x) { return Math.exp(-0.5 * x * x) / SQRT2PI; }

  /**
   * Standard normal CDF N(x), double-precision accurate (~1e-15).
   * Hart (1968) rational approximation as popularised by Graeme West,
   * "Better approximations to cumulative normal functions" (Wilmott, 2005).
   * Far more accurate than the usual Abramowitz-Stegun 26.2.17 polynomial
   * (1.5e-7), which matters when we back out implied vols from cheap options.
   */
  function normCdf(x) {
    if (!isFinite(x)) return x > 0 ? 1 : (x < 0 ? 0 : NaN);
    var xa = Math.abs(x), c, b;
    if (xa > 37) {
      c = 0;
    } else {
      var e = Math.exp(-xa * xa / 2);
      if (xa < 7.07106781186547) {
        b = 3.52624965998911e-02 * xa + 0.700383064443688;
        b = b * xa + 6.37396220353165;
        b = b * xa + 33.912866078383;
        b = b * xa + 112.079291497871;
        b = b * xa + 221.213596169931;
        b = b * xa + 220.206867912376;
        c = e * b;
        b = 8.83883476483184e-02 * xa + 1.75566716318264;
        b = b * xa + 16.064177579207;
        b = b * xa + 86.7807322029461;
        b = b * xa + 296.564248779674;
        b = b * xa + 637.333633378831;
        b = b * xa + 793.826512519948;
        b = b * xa + 440.413735824752;
        c = c / b;
      } else {
        b = xa + 0.65;
        b = xa + 4 / b;
        b = xa + 3 / b;
        b = xa + 2 / b;
        b = xa + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  }

  /**
   * Inverse normal CDF (Acklam's algorithm, relative error ~1.15e-9, then one
   * Newton refinement step → near machine precision). Used to build
   * delta-based strike ranges and in the course's probability exercises.
   */
  function normInv(p) {
    if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : (p === 1 ? Infinity : NaN);
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, ph = 1 - pl, q, r, x;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= ph) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    // One Newton step: x -= (N(x) - p) / n(x)
    var err = normCdf(x) - p;
    x = x - err / normPdf(x);
    return x;
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, def) { v = Number(v); return isFinite(v) ? v : def; }
  function round(v, dp) { var m = Math.pow(10, dp == null ? 2 : dp); return Math.round(v * m) / m; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function normRight(right) {
    var r = String(right || '').toUpperCase();
    if (r === 'C' || r === 'CALL') return 'C';
    if (r === 'P' || r === 'PUT') return 'P';
    if (r === 'S' || r === 'STOCK' || r === 'SHARES') return 'S';
    throw new Error('options: unknown right "' + right + '" (use C, P or S)');
  }
  function typeOf(right) { return right === 'P' ? 'put' : 'call'; }

  /** Deterministic PRNG so the synthetic chain is stable between renders. */
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * Dates
   * ------------------------------------------------------------------ */

  /** 'YYYY-MM-DD' (UTC) for a Date. */
  function isoDate(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2);
  }
  /** Parse 'YYYY-MM-DD' as a UTC date (noon, to dodge DST edge cases). */
  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  }
  /** Expiry date `days` from `now` (default today) as ISO. */
  function expiryFromDays(days, now) {
    var d = now ? new Date(now.getTime()) : new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + Math.round(num(days, 0)));
    return isoDate(d);
  }
  /** Third Friday of a month (standard monthly expiration). y = full year, m = 0..11 */
  function thirdFriday(y, m) {
    var d = new Date(Date.UTC(y, m, 1, 12));
    var dow = d.getUTCDay();                 // 0 = Sunday … 5 = Friday
    var firstFri = 1 + ((5 - dow + 7) % 7);
    return new Date(Date.UTC(y, m, firstFri + 14, 12));
  }
  /** Upcoming standard monthly expiries (third Fridays), as ISO strings. */
  function monthlyExpiries(count, now) {
    count = num(count, 4);
    var d = now ? new Date(now.getTime()) : new Date();
    var out = [], y = d.getUTCFullYear(), m = d.getUTCMonth();
    while (out.length < count) {
      var f = thirdFriday(y, m);
      if (f.getTime() > d.getTime()) out.push(isoDate(f));
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }
  /** Calendar days until expiry (may be fractional). */
  function daysToExpiry(expiryISO, now) {
    var e = parseISO(expiryISO);
    if (!e) return NaN;
    var n = now ? new Date(now.getTime()) : new Date();
    // Options expire at the close (4 pm New York ≈ 21:00 UTC); use a 16:00-ish anchor.
    e.setUTCHours(21, 0, 0, 0);
    return (e.getTime() - n.getTime()) / 86400000;
  }
  /** Years to expiry, floored at 0. */
  function yearsToExpiry(expiryISO, now) {
    var d = daysToExpiry(expiryISO, now);
    return isNum(d) ? Math.max(0, d) / DAYS_PER_YEAR : NaN;
  }

  /* ------------------------------------------------------------------ *
   * OCC contract ids
   * ------------------------------------------------------------------ *
   * Format: ROOT + YYMMDD + C|P + strike × 1000 as 8 digits.
   * AAPL260117C00200000 = AAPL, 2026-01-17, Call, $200 strike.
   * The suffix is always 15 characters, so the root is everything before it.
   */
  function occ(underlying, expiryISO, right, strike) {
    var root = String(underlying || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (!root) throw new Error('options.occ: underlying symbol required');
    var e = parseISO(expiryISO);
    if (!e) throw new Error('options.occ: expiry must be YYYY-MM-DD, got ' + expiryISO);
    var k = Math.round(num(strike, NaN) * 1000);
    if (!isNum(k) || k < 0 || k > 99999999) throw new Error('options.occ: bad strike ' + strike);
    var r = normRight(right);
    if (r === 'S') throw new Error('options.occ: right must be C or P');
    return root + pad(e.getUTCFullYear() % 100, 2) + pad(e.getUTCMonth() + 1, 2) + pad(e.getUTCDate(), 2) + r + pad(k, 8);
  }

  /** Decode an OCC id → {underlying, expiry:'YYYY-MM-DD', right:'C'|'P', strike, multiplier} or null. */
  function parseOcc(id) {
    var s = String(id || '').toUpperCase().trim();
    if (s.length < 16) return null;
    var tail = s.slice(-15), head = s.slice(0, -15);
    var m = /^(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(tail);
    if (!m || !/^[A-Z][A-Z0-9.\-]*$/.test(head)) return null;
    var yy = +m[1], mm = +m[2], dd = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    var expiry = (2000 + yy) + '-' + pad(mm, 2) + '-' + pad(dd, 2);
    return { underlying: head, expiry: expiry, right: m[4], strike: (+m[5]) / 1000, multiplier: MULTIPLIER };
  }

  /** Human-readable contract label: 'AAPL 17 Jan 2026 $200 Call'. */
  function describeContract(id) {
    var p = typeof id === 'string' ? parseOcc(id) : id;
    if (!p) return String(id);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = parseISO(p.expiry);
    var when = d ? (d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear()) : p.expiry;
    return p.underlying + ' ' + when + ' $' + (Math.round(p.strike * 100) / 100) + ' ' + (p.right === 'P' ? 'Put' : 'Call');
  }

  /* ------------------------------------------------------------------ *
   * Black-Scholes-Merton
   * ------------------------------------------------------------------ */

  /**
   * bs({S, K, T, r, sigma, type:'call'|'put', q})
   *   S spot, K strike, T years to expiry, r continuous risk-free rate,
   *   sigma annualised volatility, q continuous dividend yield (default 0).
   * Returns {price, delta, gamma, theta, vega, rho, d1, d2, intrinsic, extrinsic, type}
   *   theta per calendar day, vega per 1 vol point, rho per 1 pct point.
   * Degenerate inputs (T ≤ 0 or sigma ≤ 0) fall back to intrinsic value so a
   * chain still renders on expiration day.
   */
  function bs(p) {
    p = p || {};
    var S = num(p.S, NaN), K = num(p.K, NaN), T = num(p.T, 0), r = num(p.r, 0), sigma = num(p.sigma, 0), q = num(p.q, 0);
    var type = (p.type === 'put' || p.type === 'P' || p.right === 'P') ? 'put' : 'call';
    if (!isNum(S) || !isNum(K) || S < 0 || K < 0) throw new Error('options.bs: S and K must be non-negative numbers');
    var isCall = type === 'call';
    var out = { type: type, S: S, K: K, T: T, r: r, sigma: sigma, q: q };

    var intrinsic = Math.max(0, isCall ? S - K : K - S);
    if (T <= 0 || sigma <= 0 || S === 0 || K === 0) {
      out.gamma = 0; out.vega = 0;
      if (T > 0) {
        // Deterministic (sigma = 0) but not yet expired: the option is worth the
        // discounted FORWARD intrinsic, max(0, S e^{-qT} - K e^{-rT}). Moneyness
        // is judged on the forward, and the greeks are the sigma -> 0 limits of
        // Black-Scholes so sliding IV down to 0 in the lab stays continuous:
        //   delta = +/- e^{-qT}, theta = -(carry), rho = +/- T K e^{-rT}.
        var Sq = S * Math.exp(-q * T), Kr = K * Math.exp(-r * T);
        var fwdItm = isCall ? Sq > Kr : Kr > Sq;
        var carry = r * Kr - q * Sq;           // dPrice/dT for a forward-ITM call
        out.price = Math.max(0, isCall ? Sq - Kr : Kr - Sq);
        out.delta = fwdItm ? (isCall ? Math.exp(-q * T) : -Math.exp(-q * T)) : 0;
        out.theta = fwdItm ? (isCall ? -carry : carry) / DAYS_PER_YEAR : 0;
        out.rho = fwdItm ? (isCall ? T * Kr : -T * Kr) / 100 : 0;
        out.d1 = fwdItm ? Infinity : -Infinity; out.d2 = out.d1;
        out.probITM = fwdItm ? 1 : 0;
      } else {
        // Expired: pure intrinsic. At-the-money pin gets the conventional 0.5 delta.
        var itm = isCall ? S > K : S < K;
        out.price = intrinsic;
        out.delta = itm ? (isCall ? 1 : -1) : (S === K ? (isCall ? 0.5 : -0.5) : 0);
        out.theta = 0; out.rho = 0;
        out.d1 = itm ? Infinity : -Infinity; out.d2 = out.d1;
        out.probITM = itm ? 1 : (S === K ? 0.5 : 0);
      }
      out.intrinsic = intrinsic; out.extrinsic = Math.max(0, out.price - intrinsic);
      return out;
    }

    var sqT = Math.sqrt(T);
    var d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqT);
    var d2 = d1 - sigma * sqT;
    var eqT = Math.exp(-q * T), erT = Math.exp(-r * T);
    var Nd1 = normCdf(d1), Nd2 = normCdf(d2), nd1 = normPdf(d1);

    var price, delta, rho, thetaYear;
    var gamma = eqT * nd1 / (S * sigma * sqT);
    var vegaRaw = S * eqT * nd1 * sqT;              // per 1.00 of sigma
    var decay = -(S * eqT * nd1 * sigma) / (2 * sqT); // common time-decay term
    if (isCall) {
      price = S * eqT * Nd1 - K * erT * Nd2;
      delta = eqT * Nd1;
      thetaYear = decay - r * K * erT * Nd2 + q * S * eqT * Nd1;
      rho = K * T * erT * Nd2;
    } else {
      var Nmd1 = normCdf(-d1), Nmd2 = normCdf(-d2);
      price = K * erT * Nmd2 - S * eqT * Nmd1;
      delta = -eqT * Nmd1;
      thetaYear = decay + r * K * erT * Nmd2 - q * S * eqT * Nmd1;
      rho = -K * T * erT * Nmd2;
    }
    out.price = Math.max(0, price);
    out.delta = delta;
    out.gamma = gamma;
    out.theta = thetaYear / DAYS_PER_YEAR;  // per calendar day
    out.vega = vegaRaw / 100;               // per 1 vol point
    out.rho = rho / 100;                    // per 1 percentage point of r
    out.d1 = d1; out.d2 = d2;
    out.intrinsic = intrinsic;
    out.extrinsic = Math.max(0, out.price - intrinsic);
    // Educational extras: risk-neutral probability of finishing in the money.
    out.probITM = isCall ? Nd2 : normCdf(-d2);
    return out;
  }

  /** Price only (convenience). */
  function price(p) { return bs(p).price; }

  /**
   * impliedVol({price, S, K, T, r, q, type}) → sigma, or null when no vol
   * reproduces the price (price below intrinsic / above the upper bound).
   * Bisection on [1e-4, 10]: BS price is monotone increasing in sigma so the
   * bracket always works; 200 halvings gets us to machine precision.
   */
  function impliedVol(p) {
    p = p || {};
    var target = num(p.price, NaN), S = num(p.S, NaN), K = num(p.K, NaN), T = num(p.T, 0), r = num(p.r, 0), q = num(p.q, 0);
    var type = (p.type === 'put' || p.type === 'P' || p.right === 'P') ? 'put' : 'call';
    if (!isNum(target) || !isNum(S) || !isNum(K) || T <= 0 || S <= 0 || K <= 0) return null;
    var lo = 1e-4, hi = 10;
    var args = { S: S, K: K, T: T, r: r, q: q, type: type };
    args.sigma = lo; var pLo = bs(args).price;
    args.sigma = hi; var pHi = bs(args).price;
    var tol = Math.max(1e-10, Math.abs(target) * 1e-12);
    if (target < pLo - 1e-9 || target > pHi + 1e-9) return null;
    if (Math.abs(target - pLo) <= tol) return lo;
    for (var i = 0; i < 200; i++) {
      var mid = 0.5 * (lo + hi);
      args.sigma = mid;
      var pm = bs(args).price;
      if (Math.abs(pm - target) <= tol || (hi - lo) < 1e-12) return mid;
      if (pm > target) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  /* ------------------------------------------------------------------ *
   * Synthetic option chain
   * ------------------------------------------------------------------ */

  /** Strike increment by price level, like US listed equity options. */
  function strikeIncrement(S) {
    if (S < 25) return 1;
    if (S < 100) return 2.5;
    if (S < 250) return 5;
    return 10;
  }

  /**
   * Volatility smile / skew: puts richer than calls.
   *   m = standardised log-moneyness ln(K/S) / (ivBase * sqrt(T))
   *   iv = ivBase * (1 - skew*m + curve*m²), with the skew steepening and the
   *   curvature increasing as expiry approaches (short-dated smiles are sharper).
   * This mimics the equity-index pattern students see on real chains:
   * downside protection costs more, so OTM puts carry higher IV than OTM calls.
   */
  function smileIV(S, K, T, ivBase, opts) {
    opts = opts || {};
    var skew = num(opts.skew, 0.10), curve = num(opts.curve, 0.025);
    var Tc = Math.max(T, 1 / DAYS_PER_YEAR);
    var m = Math.log(K / S) / (ivBase * Math.sqrt(Tc));
    var termFactor = Math.pow(0.25 / Tc, 0.15);          // >1 for < 3 months, <1 beyond
    termFactor = Math.min(1.6, Math.max(0.75, termFactor));
    var iv = ivBase * (1 - skew * termFactor * m + curve * termFactor * m * m);
    // Mild term structure: short expiries trade a touch above long ones in calm markets.
    iv *= 1 + 0.03 * Math.log(0.25 / Tc) * 0.5;
    return Math.min(3, Math.max(0.05, iv));
  }

  /** US-style tick: $0.01 under $3, $0.05 at or above. */
  function tickFor(mid) { return mid >= 3 ? 0.05 : 0.01; }
  function roundTick(v, tick) { return Math.round(v / tick) * tick; }

  /**
   * chain(S, {symbol, expiries:[days...], ivBase, r, q, now, strikesEachSide})
   * Returns rows sorted by expiry, strike, right (C before P):
   *   {contract, underlying, strike, expiry, dte, right, bid, ask, mid, iv,
   *    delta, gamma, theta, vega, oi, volume, itm}
   * Also sets rows.expiries (ISO list) and rows.spot for convenience.
   */
  function chain(S, opts) {
    opts = opts || {};
    S = num(S, NaN);
    if (!isNum(S) || S <= 0) throw new Error('options.chain: spot must be > 0');
    var symbol = String(opts.symbol || 'DEMO').toUpperCase();
    var ivBase = num(opts.ivBase, 0.25);
    var r = num(opts.r, 0.05), q = num(opts.q, 0);
    var now = opts.now instanceof Date ? opts.now : new Date();
    var expiriesDays = Array.isArray(opts.expiries) && opts.expiries.length ? opts.expiries : [7, 14, 30, 60, 90, 180];
    var inc = num(opts.increment, strikeIncrement(S));
    var each = Math.max(3, Math.round(num(opts.strikesEachSide, Math.max(6, Math.round(S * 0.25 / inc)))));
    var atm = Math.round(S / inc) * inc;

    var rows = [], expiries = [];
    for (var ei = 0; ei < expiriesDays.length; ei++) {
      var days = num(expiriesDays[ei], NaN);
      if (!isNum(days) || days <= 0) continue;
      var expiry = expiryFromDays(days, now);
      var T = days / DAYS_PER_YEAR;
      expiries.push(expiry);
      for (var si = -each; si <= each; si++) {
        var K = round(atm + si * inc, 2);
        if (K <= 0) continue;
        var iv = smileIV(S, K, T, ivBase, opts);
        var rights = ['C', 'P'];
        for (var ri = 0; ri < 2; ri++) {
          var right = rights[ri];
          var g = bs({ S: S, K: K, T: T, r: r, q: q, sigma: iv, type: typeOf(right) });
          var id = occ(symbol, expiry, right, K);
          var rnd = mulberry32(hashStr(id));
          // Spread widens away from the money and for longer-dated, less liquid contracts.
          var distance = Math.abs(Math.log(K / S)) / (ivBase * Math.sqrt(Math.max(T, 1 / DAYS_PER_YEAR)));
          var spreadPct = 0.02 + 0.03 * Math.min(3, distance) + 0.01 * Math.min(2, T * 2);
          var mid = g.price;
          var tick = tickFor(mid);
          // Half-spread: percentage of mid, but capped so deep-ITM contracts (mostly intrinsic) stay sane.
          var half = Math.max(tick / 2, Math.min(mid * spreadPct / 2, 0.25 + 0.02 * mid));
          var bid = Math.max(0, roundTick(mid - half, tick));
          var ask = Math.max(bid + tick, roundTick(mid + half, tick));
          bid = round(bid, 2); ask = round(ask, 2);
          var quotedMid = round((bid + ask) / 2, 3);
          // Open interest & volume: concentrated near the money and at round strikes; decays far OTM.
          var liquidity = Math.exp(-0.5 * distance * distance) * (K % (inc * 2) === 0 ? 1.4 : 1) * (T < 0.1 ? 1.3 : T < 0.3 ? 1 : 0.6);
          var baseOI = 400 + 12000 * liquidity;
          var oi = Math.round(baseOI * (0.6 + 0.8 * rnd()));
          var volume = Math.round(oi * (0.03 + 0.25 * rnd()) * (T < 0.1 ? 1.5 : 1));
          var itm = right === 'C' ? K < S : K > S;
          rows.push({
            contract: id, underlying: symbol, strike: K, expiry: expiry, dte: Math.round(days), right: right,
            bid: bid, ask: ask, mid: quotedMid, last: round(bid + (ask - bid) * rnd(), 2),
            iv: round(iv, 4), delta: round(g.delta, 4), gamma: round(g.gamma, 5), theta: round(g.theta, 4), vega: round(g.vega, 4),
            oi: oi, volume: volume, itm: itm, intrinsic: round(g.intrinsic, 2), extrinsic: round(Math.max(0, quotedMid - g.intrinsic), 2)
          });
        }
      }
    }
    rows.spot = S;
    rows.expiries = expiries;
    rows.symbol = symbol;
    rows.ivBase = ivBase;
    return rows;
  }

  /** Filter a chain to one expiry and (optionally) one right. */
  function chainSlice(rows, expiry, right) {
    return rows.filter(function (r) { return r.expiry === expiry && (!right || r.right === right); });
  }

  /** Find the row whose strike is closest to the spot for an expiry/right. */
  function atmRow(rows, expiry, right) {
    var best = null, bestD = Infinity, S = rows.spot;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.expiry !== expiry || row.right !== right) continue;
      var d = Math.abs(row.strike - S);
      if (d < bestD) { bestD = d; best = row; }
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Payoff at expiration
   * ------------------------------------------------------------------ */

  /** Normalise a leg: {right:'C'|'P'|'S', strike, qty, premium, multiplier}. */
  function normLeg(leg) {
    var right = normRight(leg.right || leg.type);
    var qty = num(leg.qty, 1);
    var mult = num(leg.multiplier, right === 'S' ? 1 : MULTIPLIER);
    var strike = num(leg.strike, NaN);
    var premium = num(leg.premium, 0);
    if (right === 'S') {
      // For shares, the "strike" is the entry price. Accept either field.
      if (!isNum(strike)) strike = premium;
      premium = 0;
    } else if (!isNum(strike)) {
      throw new Error('options.payoff: option leg needs a strike');
    }
    return { right: right, strike: strike, qty: qty, premium: Math.max(0, premium), multiplier: mult, label: leg.label || null };
  }

  /** Value of one leg per unit at expiration price S (before premium). */
  function legValueAt(leg, S) {
    if (leg.right === 'S') return S - leg.strike;
    if (leg.right === 'C') return Math.max(0, S - leg.strike);
    return Math.max(0, leg.strike - S);
  }

  /** Total P&L of a position at expiration price S. */
  function pnlAt(legs, S) {
    var total = 0;
    for (var i = 0; i < legs.length; i++) {
      var l = legs[i];
      total += l.qty * l.multiplier * (legValueAt(l, S) - l.premium);
    }
    return total === 0 ? 0 : total; // normalise -0 so comparisons and JSON stay clean
  }

  /** Default plotting range: strikes ± 30 %, at least ±25 % of spot-ish centre. */
  function defaultRange(legs, steps) {
    var ks = legs.map(function (l) { return l.strike; }).filter(isNum);
    var lo = Math.min.apply(null, ks), hi = Math.max.apply(null, ks);
    if (!isFinite(lo)) { lo = 50; hi = 150; }
    var centre = (lo + hi) / 2, span = Math.max(hi - lo, centre * 0.5);
    var min = Math.max(0, centre - span), max = centre + span;
    steps = steps || 121;
    var out = [];
    for (var i = 0; i < steps; i++) out.push(min + (max - min) * i / (steps - 1));
    return out;
  }

  /**
   * payoff(legs, Srange) → [{S, pnl}]
   *   legs   [{right:'C'|'P'|'S', strike, qty, premium}] — qty>0 long, qty<0 short.
   *          Option legs use a 100 multiplier, stock legs 1 share per qty.
   *   Srange an array of prices, or {min, max, steps}, or omitted for auto.
   * Strike prices are always inserted so the kinks in the diagram are exact.
   */
  function payoff(legs, Srange) {
    var L = (legs || []).map(normLeg);
    var xs;
    if (Array.isArray(Srange)) xs = Srange.slice();
    else if (Srange && typeof Srange === 'object') {
      var min = num(Srange.min, 0), max = num(Srange.max, min + 100), steps = Math.max(2, Math.round(num(Srange.steps, 121)));
      xs = [];
      for (var i = 0; i < steps; i++) xs.push(min + (max - min) * i / (steps - 1));
    } else xs = defaultRange(L);
    // add exact strikes within range so the kinks render sharply
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    L.forEach(function (l) { if (isNum(l.strike) && l.strike >= lo && l.strike <= hi) xs.push(l.strike); });
    xs = xs.filter(isNum).sort(function (a, b) { return a - b; }).filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    return xs.map(function (S) { return { S: S, pnl: pnlAt(L, S) }; });
  }

  /**
   * analyze(legs, {spot}) → {
   *   maxProfit, maxLoss (Infinity / -Infinity when unbounded),
   *   breakevens:[S...], netCost (debit > 0, credit < 0), isCredit,
   *   profitAbove / profitBelow (where applicable), riskReward,
   *   slopeLeft, slopeRight (P&L change per $1 move at the extremes),
   *   probProfit (if spot & iv & T supplied), legs (normalised)
   * }
   * Max/min of a piecewise-linear payoff occur at kinks (strikes), at S = 0 or
   * at ±∞, so we evaluate those and read the slope beyond the last strike.
   * Breakevens are solved numerically by bisection on each segment with a
   * sign change (robust even when the user adds odd legs).
   */
  function analyze(legs, opts) {
    opts = opts || {};
    var L = (legs || []).map(normLeg);
    if (!L.length) return { maxProfit: 0, maxLoss: 0, breakevens: [], netCost: 0, isCredit: false, legs: [], slopeLeft: 0, slopeRight: 0, riskReward: null };

    var ks = L.map(function (l) { return l.strike; }).filter(isNum).sort(function (a, b) { return a - b; })
      .filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    var kMax = ks.length ? ks[ks.length - 1] : 100;
    var far = kMax * 2 + 100;

    // Slopes at the extremes
    var slopeRight = 0, slopeLeft = 0;
    L.forEach(function (l) {
      var qm = l.qty * l.multiplier;
      if (l.right === 'S') { slopeRight += qm; slopeLeft += qm; }
      else if (l.right === 'C') { slopeRight += qm; }
      else { slopeLeft -= qm; } // put value falls $1 per $1 rise when S < K
    });

    var points = [0].concat(ks, [far]);
    var vals = points.map(function (S) { return pnlAt(L, S); });
    var maxProfit = Math.max.apply(null, vals.slice(0, -1));
    var maxLoss = Math.min.apply(null, vals.slice(0, -1));
    if (slopeRight > 1e-9) maxProfit = Infinity;
    if (slopeRight < -1e-9) maxLoss = -Infinity;
    // Guard against -0 noise
    if (Math.abs(maxProfit) < 1e-9) maxProfit = 0;
    if (Math.abs(maxLoss) < 1e-9) maxLoss = 0;

    // Breakevens via bisection on every segment with a sign change.
    var breakevens = [];
    var f = function (S) { return pnlAt(L, S); };
    var segs = [0].concat(ks, [slopeRight !== 0 ? far : kMax]);
    for (var i = 0; i < segs.length - 1; i++) {
      var a = segs[i], b = segs[i + 1];
      if (b <= a) continue;
      var fa = f(a), fb = f(b);
      if (Math.abs(fa) < 1e-9) { pushUnique(breakevens, a); continue; }
      if (fa * fb < 0) {
        var lo = a, hi = b;
        for (var it = 0; it < 100; it++) {
          var mid = 0.5 * (lo + hi), fm = f(mid);
          if (Math.abs(fm) < 1e-9 || (hi - lo) < 1e-9) { lo = hi = mid; break; }
          if ((fm < 0) === (fa < 0)) { lo = mid; fa = fm; } else hi = mid;
        }
        pushUnique(breakevens, 0.5 * (lo + hi));
      }
    }
    // A breakeven exactly at the last kink (fb == 0) is included if the function crosses there.
    var fLast = f(kMax);
    if (Math.abs(fLast) < 1e-9 && ks.length) pushUnique(breakevens, kMax);
    breakevens = breakevens.filter(function (v) { return v > 1e-9; }).map(function (v) { return round(v, 4); });

    var netCost = 0;
    L.forEach(function (l) { if (l.right !== 'S') netCost += l.qty * l.multiplier * l.premium; });
    var isCredit = netCost < -1e-9;

    var rr = null;
    if (isFinite(maxProfit) && isFinite(maxLoss) && maxLoss < 0) rr = round(maxProfit / -maxLoss, 2);

    var out = {
      maxProfit: isFinite(maxProfit) ? round(maxProfit, 2) : maxProfit,
      maxLoss: isFinite(maxLoss) ? round(maxLoss, 2) : maxLoss,
      breakevens: breakevens,
      netCost: round(netCost, 2),
      isCredit: isCredit,
      slopeLeft: slopeLeft,
      slopeRight: slopeRight,
      riskReward: rr,
      legs: L
    };
    // Where is the position profitable at expiry? Useful text for the UI.
    if (breakevens.length === 1) {
      if (slopeRight > 0 || (slopeRight === 0 && f(far) > 0)) out.profitAbove = breakevens[0];
      else out.profitBelow = breakevens[0];
    } else if (breakevens.length === 2) {
      var midS = (breakevens[0] + breakevens[1]) / 2;
      if (f(midS) > 0) out.profitBetween = breakevens.slice();
      else out.profitOutside = breakevens.slice();
    }
    // Optional probability of profit from a lognormal terminal distribution.
    var spot = num(opts.spot, NaN), iv = num(opts.iv, NaN), T = num(opts.T, NaN), r = num(opts.r, 0);
    if (isNum(spot) && isNum(iv) && isNum(T) && spot > 0 && iv > 0 && T > 0) {
      out.probProfit = round(probabilityOfProfit(L, spot, iv, T, r), 4);
    }
    out.summary = summarize(out);
    return out;
  }

  function pushUnique(arr, v) {
    for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - v) < 1e-6) return;
    arr.push(v);
  }

  /** P(S_T lands where pnl > 0) under a lognormal with drift r, via the breakeven regions. */
  function probabilityOfProfit(L, S, iv, T, r) {
    // Probability S_T < x under risk-neutral lognormal
    var cdf = function (x) {
      if (x <= 0) return 0;
      var d = (Math.log(x / S) - (r - 0.5 * iv * iv) * T) / (iv * Math.sqrt(T));
      return normCdf(d);
    };
    // Sample profit sign on a fine grid between breakeven points and integrate.
    var a = analyzeBreakpointsOnly(L);
    var pts = [0].concat(a, [Infinity]);
    var p = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var lo = pts[i], hi = pts[i + 1];
      var probe = isFinite(hi) ? (lo + hi) / 2 : lo * 1.5 + 1;
      if (pnlAt(L, probe) > 0) p += (isFinite(hi) ? cdf(hi) : 1) - cdf(lo);
    }
    return Math.min(1, Math.max(0, p));
  }
  function analyzeBreakpointsOnly(L) {
    var ks = L.map(function (l) { return l.strike; }).filter(isNum);
    var kMax = ks.length ? Math.max.apply(null, ks) : 100, far = kMax * 2 + 100;
    var segs = [0].concat(ks.slice().sort(function (a, b) { return a - b; }), [far]);
    var out = [];
    for (var i = 0; i < segs.length - 1; i++) {
      var a = segs[i], b = segs[i + 1];
      if (b <= a) continue;
      var fa = pnlAt(L, a), fb = pnlAt(L, b);
      if (fa * fb < 0) {
        var lo = a, hi = b;
        for (var it = 0; it < 80; it++) { var m = (lo + hi) / 2; var fm = pnlAt(L, m); if ((fm < 0) === (fa < 0)) { lo = m; fa = fm; } else hi = m; }
        out.push((lo + hi) / 2);
      }
    }
    return out;
  }

  function money(v) {
    if (v === Infinity) return 'unlimited';
    if (v === -Infinity) return 'unlimited';
    var s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-$' : '$') + s;
  }
  /** One-line plain-English summary for the UI. */
  function summarize(a) {
    var parts = [];
    parts.push(a.isCredit ? 'Opened for a ' + money(-a.netCost) + ' credit.' : (a.netCost > 0 ? 'Costs ' + money(a.netCost) + ' to open.' : 'No net premium.'));
    parts.push('Max profit ' + money(a.maxProfit) + (a.maxProfit === Infinity ? ' (grows as the stock rises).' : '.'));
    parts.push('Max loss ' + money(a.maxLoss) + (a.maxLoss === -Infinity ? ' (grows as the stock rises — short upside exposure).' : '.'));
    if (a.breakevens.length) parts.push('Breakeven at ' + a.breakevens.map(function (b) { return '$' + round(b, 2); }).join(' and ') + '.');
    else parts.push(a.maxLoss >= 0 ? 'Profitable at every price (check your inputs — free money does not exist).' : 'Never profitable at expiration with these prices.');
    if (a.riskReward != null) parts.push('Reward-to-risk ' + a.riskReward + ':1.');
    return parts.join(' ');
  }

  /* ------------------------------------------------------------------ *
   * Strategy presets
   * ------------------------------------------------------------------ *
   * Each preset builds priced legs from a spot price using bs() so students
   * see realistic premiums. build(S, {iv, T, r, q, width}) → legs. Strikes
   * snap to the chain's strike increment for the price level.
   */
  function snap(S, inc) { return Math.round(S / inc) * inc; }
  function priced(S, K, T, right, iv, r, q) {
    var g = bs({ S: S, K: K, T: T, r: r, q: q, sigma: iv, type: typeOf(right) });
    return round(g.price, 2);
  }
  function ctx(S, o) {
    o = o || {};
    var inc = num(o.increment, strikeIncrement(S));
    return {
      S: S, inc: inc, atm: snap(S, inc),
      iv: num(o.iv, 0.25), T: num(o.T, 45 / DAYS_PER_YEAR), r: num(o.r, 0.05), q: num(o.q, 0),
      width: num(o.width, inc)
    };
  }
  function opt(c, K, right, qty, label) {
    // Smile-aware pricing so put legs look richer, like a real chain.
    var iv = smileIV(c.S, K, c.T, c.iv);
    return { right: right, strike: round(K, 2), qty: qty, premium: priced(c.S, K, c.T, right, iv, c.r, c.q), label: label || ((qty > 0 ? 'Buy ' : 'Sell ') + Math.abs(qty) + ' ' + round(K, 2) + (right === 'C' ? ' call' : ' put')) };
  }
  function shares(c, qty) {
    return { right: 'S', strike: round(c.S, 2), qty: qty, premium: 0, label: (qty > 0 ? 'Buy ' : 'Sell ') + Math.abs(qty) + ' shares @ ' + round(c.S, 2) };
  }

  var strategies = {
    longCall: {
      id: 'longCall', name: 'Long Call', outlook: 'bullish', complexity: 1,
      description: 'Buy one call option. You pay a premium for the right (not the obligation) to buy 100 shares at the strike price before expiration. Your loss is capped at the premium you paid, while profit is theoretically unlimited as the stock climbs. The trade-off is time: every day that passes without a move erodes the option\'s value (theta decay), and the stock must rise past the strike plus the premium just to break even. Students use this to learn leverage: a 10 % move in the stock can double or wipe out the call.',
      when: 'You expect a sharp move up within a defined time window and want limited risk.',
      risk: 'Limited to the premium paid. Most OTM calls expire worthless, so size small.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm, 'C', 1)]; }
    },
    longPut: {
      id: 'longPut', name: 'Long Put', outlook: 'bearish', complexity: 1,
      description: 'Buy one put option: the right to sell 100 shares at the strike price. It profits when the stock falls below the strike by more than the premium paid and is the cleanest way to bet on a decline without the unlimited risk of shorting shares. The maximum loss is the premium; the maximum profit is the strike minus the premium (the stock cannot go below zero). Puts also get a tailwind when fear rises, because implied volatility usually climbs in sell-offs.',
      when: 'You expect a drop, or want a defined-risk way to express a bearish view.',
      risk: 'Limited to the premium paid.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm, 'P', 1)]; }
    },
    coveredCall: {
      id: 'coveredCall', name: 'Covered Call', outlook: 'neutral-bullish', complexity: 2,
      description: 'Own 100 shares and sell one call against them, usually slightly out of the money. The premium you collect lowers your cost basis and produces income while you wait, but you agree to sell the shares at the strike if the stock rallies past it, which caps your upside. Downside risk is the same as owning stock, cushioned by the premium. This is the most common first options strategy for long-term investors and the one most brokers approve at the lowest options level.',
      when: 'You already own the shares, expect a flat-to-mildly-bullish market, and are happy to sell at the strike.',
      risk: 'Stock risk below the breakeven; opportunity cost above the strike.',
      build: function (S, o) { var c = ctx(S, o); return [shares(c, 100), opt(c, c.atm + c.width, 'C', -1)]; }
    },
    protectivePut: {
      id: 'protectivePut', name: 'Protective Put', outlook: 'bullish-with-insurance', complexity: 2,
      description: 'Own 100 shares and buy one put as insurance. If the stock crashes you can still sell at the strike, so your maximum loss is known in advance; if the stock rallies you keep all the upside minus the cost of the put. Think of the premium as an insurance deductible you pay every expiration cycle. It is the textbook hedge for a portfolio heading into earnings or a macro event.',
      when: 'You want to stay long but cannot stomach a large drawdown over a specific period.',
      risk: 'Limited to (stock price - strike) + premium. Recurring premiums are a drag if nothing happens.',
      build: function (S, o) { var c = ctx(S, o); return [shares(c, 100), opt(c, c.atm - c.width, 'P', 1)]; }
    },
    bullCallSpread: {
      id: 'bullCallSpread', name: 'Bull Call Spread', outlook: 'moderately bullish', complexity: 2,
      description: 'Buy a call at a lower strike and sell a call at a higher strike with the same expiration. Selling the higher call pays for part of the long call, so the position costs less and suffers less from time decay than a naked long call, but the profit is capped at the distance between the strikes minus the net debit. Max loss is the debit. This is how professionals express a "the stock will rise, but probably not to the moon" view with a defined reward-to-risk.',
      when: 'You expect a moderate rise to around the upper strike by expiration.',
      risk: 'Limited to the net debit paid.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm, 'C', 1), opt(c, c.atm + 2 * c.width, 'C', -1)]; }
    },
    bearPutSpread: {
      id: 'bearPutSpread', name: 'Bear Put Spread', outlook: 'moderately bearish', complexity: 2,
      description: 'Buy a put at a higher strike and sell a put at a lower strike, same expiration. The short put reduces the cost of the hedge in exchange for capping the profit at the strike width minus the debit. It is the mirror image of the bull call spread: a cheaper, defined-risk way to profit from a modest decline, less sensitive to volatility and time decay than an outright long put.',
      when: 'You expect a moderate decline to around the lower strike.',
      risk: 'Limited to the net debit paid.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm, 'P', 1), opt(c, c.atm - 2 * c.width, 'P', -1)]; }
    },
    straddle: {
      id: 'straddle', name: 'Long Straddle', outlook: 'big move, either direction', complexity: 3,
      description: 'Buy a call and a put at the same at-the-money strike and expiration. You do not care which way the stock goes, only that it moves a lot: profit begins once the move exceeds the combined premium in either direction. It is a pure bet on volatility, often placed before earnings or a court ruling. The danger is paying for two options and watching the stock sit still while both decay. Also note that implied volatility usually collapses after the event ("IV crush"), which can hurt even when the stock moves.',
      when: 'You expect a large move but have no directional edge, and implied volatility looks cheap relative to the likely move.',
      risk: 'Limited to the total premium paid (both legs).',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm, 'C', 1), opt(c, c.atm, 'P', 1)]; }
    },
    strangle: {
      id: 'strangle', name: 'Long Strangle', outlook: 'very big move, either direction', complexity: 3,
      description: 'Like a straddle, but buy an out-of-the-money call and an out-of-the-money put instead of the at-the-money pair. It is cheaper to put on, so the max loss is smaller, but the stock has to travel further before either option is in the money, so breakevens are wider apart. A strangle is a bet that the market is badly underestimating how far the stock can move.',
      when: 'You expect an outsized move and want to pay less premium than a straddle.',
      risk: 'Limited to the total premium paid; a high probability of losing it all if the stock stays in the range.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm + c.width, 'C', 1), opt(c, c.atm - c.width, 'P', 1)]; }
    },
    ironCondor: {
      id: 'ironCondor', name: 'Iron Condor', outlook: 'neutral (range-bound)', complexity: 4,
      description: 'Sell an out-of-the-money put spread and an out-of-the-money call spread at the same time: four legs, all the same expiration. You collect a net credit and keep all of it if the stock finishes between the two short strikes. The long wings cap your loss at the width of a spread minus the credit. Iron condors are the classic income strategy for quiet markets, and the classic way beginners get hurt: the loss on a breakout is several times the credit, so the win rate must be high to come out ahead.',
      when: 'You expect the stock to stay in a range through expiration and implied volatility is elevated (richer premiums).',
      risk: 'Limited to (wing width - credit) x 100, on either side. Manage early when a short strike is threatened.',
      build: function (S, o) {
        var c = ctx(S, o), w = c.width;
        return [opt(c, c.atm - 3 * w, 'P', 1), opt(c, c.atm - 2 * w, 'P', -1), opt(c, c.atm + 2 * w, 'C', -1), opt(c, c.atm + 3 * w, 'C', 1)];
      }
    },
    bullPutSpread: {
      id: 'bullPutSpread', name: 'Bull Put Spread (credit)', outlook: 'neutral-bullish', complexity: 3,
      description: 'Sell a put at a higher strike and buy a put at a lower strike for protection. You receive a net credit up front and keep it as long as the stock stays above the short strike at expiration. The long put limits the loss to the strike width minus the credit. It is a high-probability, limited-reward trade that profits from time decay and is a favourite for "the stock will not fall below support" views.',
      when: 'You believe a support level will hold and want to be paid to wait.',
      risk: 'Limited to (width - credit) x 100.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm - c.width, 'P', -1), opt(c, c.atm - 2 * c.width, 'P', 1)]; }
    },
    bearCallSpread: {
      id: 'bearCallSpread', name: 'Bear Call Spread (credit)', outlook: 'neutral-bearish', complexity: 3,
      description: 'Sell a call at a lower strike and buy a call at a higher strike. You collect a credit and keep it if the stock stays below the short strike. The long call caps the loss. Use it when you think a resistance level will hold; it is the mirror image of the bull put spread.',
      when: 'You believe resistance will hold through expiration.',
      risk: 'Limited to (width - credit) x 100.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm + c.width, 'C', -1), opt(c, c.atm + 2 * c.width, 'C', 1)]; }
    },
    collar: {
      id: 'collar', name: 'Collar', outlook: 'protective', complexity: 3,
      description: 'Own 100 shares, buy a protective put below the market and sell a covered call above it. The call premium pays for most or all of the put, so the hedge is cheap or free, in exchange for giving up upside beyond the call strike. Both the floor and the ceiling are known in advance, which is why collars are popular with executives holding concentrated stock positions.',
      when: 'You want downside protection on a stock you own and are willing to cap gains to pay for it.',
      risk: 'Limited to (stock - put strike) +/- net premium.',
      build: function (S, o) { var c = ctx(S, o); return [shares(c, 100), opt(c, c.atm - c.width, 'P', 1), opt(c, c.atm + c.width, 'C', -1)]; }
    },
    longButterfly: {
      id: 'longButterfly', name: 'Long Call Butterfly', outlook: 'pin at a price', complexity: 4,
      description: 'Buy one call at a lower strike, sell two calls at the middle strike and buy one call at a higher strike, all equally spaced. The position costs a small debit and pays off most when the stock closes exactly at the middle strike at expiration, with a loss limited to the debit on either side. It is a cheap, low-probability, high-payoff way to bet that a stock will "pin" to a specific price.',
      when: 'You have a precise price target and expiration date in mind.',
      risk: 'Limited to the net debit paid.',
      build: function (S, o) { var c = ctx(S, o); return [opt(c, c.atm - c.width, 'C', 1), opt(c, c.atm, 'C', -2), opt(c, c.atm + c.width, 'C', 1)]; }
    }
  };

  /** Ordered list of presets for menus (contract-listed nine first). */
  var strategyOrder = ['longCall', 'longPut', 'coveredCall', 'protectivePut', 'bullCallSpread', 'bearPutSpread', 'straddle', 'strangle', 'ironCondor', 'bullPutSpread', 'bearCallSpread', 'collar', 'longButterfly'];
  function strategyList() { return strategyOrder.map(function (id) { return strategies[id]; }); }

  /**
   * buildStrategy(id, S, opts) → {strategy, legs, analysis, payoff}
   * One call for the UI: priced legs, the numbers and the diagram data.
   */
  function buildStrategy(id, S, opts) {
    var s = strategies[id];
    if (!s) throw new Error('options: unknown strategy "' + id + '"');
    S = num(S, NaN);
    if (!isNum(S) || S <= 0) throw new Error('options.buildStrategy: spot must be > 0');
    var legs = s.build(S, opts);
    var c = ctx(S, opts);
    var analysis = analyze(legs, { spot: S, iv: c.iv, T: c.T, r: c.r });
    return { strategy: s, legs: legs, analysis: analysis, payoff: payoff(legs) };
  }

  /* ------------------------------------------------------------------ *
   * Position greeks (sum of legs) — handy for the portfolio page
   * ------------------------------------------------------------------ */
  function positionGreeks(legs, S, opts) {
    opts = opts || {};
    var T = num(opts.T, 30 / DAYS_PER_YEAR), r = num(opts.r, 0.05), q = num(opts.q, 0), ivBase = num(opts.iv, 0.25);
    var tot = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    (legs || []).map(normLeg).forEach(function (l) {
      var qm = l.qty * l.multiplier;
      if (l.right === 'S') { tot.delta += qm; return; }
      var iv = num(opts.ivFor && opts.ivFor(l), smileIV(S, l.strike, T, ivBase));
      var g = bs({ S: S, K: l.strike, T: T, r: r, q: q, sigma: iv, type: typeOf(l.right) });
      tot.delta += qm * g.delta; tot.gamma += qm * g.gamma; tot.theta += qm * g.theta; tot.vega += qm * g.vega; tot.rho += qm * g.rho;
    });
    Object.keys(tot).forEach(function (k) { tot[k] = round(tot[k], 4); });
    return tot;
  }

  /* ------------------------------------------------------------------ *
   * What-if analysis (v0.5): value a position at a future date, price
   * and volatility, P&L curves at several dates, the 1σ/2σ probability
   * range and a lognormal probability of profit.
   * ------------------------------------------------------------------ *
   * Legs are the same shape as payoff() legs, plus an optional time to
   * expiry per option leg, so calendar spreads work too:
   *   {right, strike, qty, premium, days?, expiry?, iv?}
   *   days    calendar days to expiry measured from today
   *   expiry  'YYYY-MM-DD' (used when days is missing; measured from opts.now)
   *   iv      the leg's own implied volatility (decimal)
   * Missing values fall back to opts.days (default 30) and opts.iv
   * (default 0.25). opts.ivFor(leg, T) may supply a vol per leg, e.g.
   * the chain's smile. ivShift is added to every leg's vol (0.05 = +5 vol
   * points) and the result is floored at 1 %.
   */
  function legDays(leg, opts) {
    var d = num(leg.days, NaN);
    if (!isNum(d) && leg.expiry) d = daysToExpiry(leg.expiry, opts.now);
    if (!isNum(d)) d = num(opts.days, 30);
    return Math.max(0, d);
  }
  function legIv(leg, T, opts) {
    var base = num(leg.iv, NaN);
    if (!isNum(base) && typeof opts.ivFor === 'function') base = num(opts.ivFor(leg, T), NaN);
    if (!isNum(base)) base = num(opts.iv, 0.25);
    return Math.max(0.01, base + num(opts.ivShift, 0));
  }
  /* Normalise legs and remember each option leg's days to expiry and vol inputs. */
  function whatIfLegs(legs, opts) {
    return (legs || []).map(function (raw) {
      var l = normLeg(raw);
      if (l.right !== 'S') { l.days = legDays(raw, opts); l.iv = num(raw.iv, NaN); l.raw = raw; }
      return l;
    });
  }
  function valueLegsAt(L, S, daysForward, opts) {
    var r = num(opts.r, 0.05), q = num(opts.q, 0);
    var out = { S: S, daysForward: daysForward, value: 0, cost: 0, pnl: 0, delta: 0, gamma: 0, theta: 0, vega: 0, expired: true, legs: [] };
    for (var i = 0; i < L.length; i++) {
      var l = L[i], qm = l.qty * l.multiplier, px, g = null, left = 0, iv = null;
      if (l.right === 'S') {
        px = S;
        out.value += qm * S; out.cost += qm * l.strike; out.delta += qm;
        out.legs.push({ right: 'S', strike: l.strike, qty: l.qty, price: S, daysLeft: null, iv: null, pnl: qm * (S - l.strike) });
        continue;
      }
      left = Math.max(0, l.days - daysForward);
      var T = left / DAYS_PER_YEAR;
      iv = legIv(l.raw || l, T, opts);
      if (T > 0) {
        out.expired = false;
        g = bs({ S: S, K: l.strike, T: T, r: r, q: q, sigma: iv, type: typeOf(l.right) });
        px = g.price;
        out.delta += qm * g.delta; out.gamma += qm * g.gamma; out.theta += qm * g.theta; out.vega += qm * g.vega;
      } else {
        px = legValueAt(l, S);
        var itm = l.right === 'C' ? S > l.strike : S < l.strike;
        if (itm) out.delta += qm * (l.right === 'C' ? 1 : -1);
      }
      out.value += qm * px; out.cost += qm * l.premium;
      out.legs.push({ right: l.right, strike: l.strike, qty: l.qty, price: px, daysLeft: left, iv: T > 0 ? iv : null, pnl: qm * (px - l.premium) });
    }
    out.pnl = out.value - out.cost;
    if (Math.abs(out.pnl) < 1e-9) out.pnl = 0;
    return out;
  }

  /**
   * whatIf(legs, {S, daysForward=0, ivShift=0, r=0.05, q=0, iv, days, ivFor, now})
   *   → {S, daysForward, value, cost, pnl, delta, gamma, theta, vega, expired, legs:[{price, daysLeft, iv, pnl}]}
   * value is what the whole position is worth (dollars, multiplier included),
   * cost what it cost to open (negative for a credit), pnl = value − cost.
   * At daysForward = 0 the option legs are worth their Black-Scholes value
   * today; once daysForward reaches a leg's expiry that leg is worth its
   * intrinsic value, so at the last expiry pnl equals payoff().
   */
  function whatIf(legs, opts) {
    opts = opts || {};
    var L = whatIfLegs(legs, opts);
    var S = num(opts.S, NaN);
    if (!isNum(S)) {
      var ks = L.map(function (l) { return l.strike; }).filter(isNum);
      S = ks.length ? ks.reduce(function (a, b) { return a + b; }, 0) / ks.length : 100;
    }
    return valueLegsAt(L, Math.max(0, S), Math.max(0, num(opts.daysForward, 0)), opts);
  }

  /** Days until the last option leg expires (0 for a stock-only position). */
  function lastExpiryDays(legs, opts) {
    opts = opts || {};
    return whatIfLegs(legs, opts).reduce(function (m, l) { return l.right === 'S' ? m : Math.max(m, l.days); }, 0);
  }

  /**
   * curves(legs, Srange, dates, opts) → [{daysForward, label, points:[{S, pnl}]}]
   *   Srange  as payoff(): an array of prices, {min, max, steps} or omitted.
   *   dates   days forward to draw; default today, half-way and the last expiry.
   *   opts    as whatIf (r, q, iv, ivShift, ivFor, days, now).
   * The expiry curve uses intrinsic values, so it matches payoff() exactly.
   */
  function curves(legs, Srange, dates, opts) {
    opts = opts || {};
    var L = whatIfLegs(legs, opts);
    if (!L.length) return [];
    var last = L.reduce(function (m, l) { return l.right === 'S' ? m : Math.max(m, l.days); }, 0);
    var ds = Array.isArray(dates) && dates.length ? dates.slice() : (last > 0 ? [0, Math.round(last / 2), last] : [0]);
    var xs = payoff(legs, Srange).map(function (p) { return p.S; });
    ds = ds.map(function (d) { return Math.max(0, num(d, 0)); })
      .filter(function (d, i, a) { return a.indexOf(d) === i; });
    return ds.map(function (d) {
      var label = d === 0 ? 'Today' : (d >= last && last > 0 ? 'At expiration' : 'In ' + round(d, 0) + ' days');
      return {
        daysForward: d,
        label: label,
        points: xs.map(function (S) { return { S: S, pnl: round(valueLegsAt(L, S, d, opts).pnl, 4) }; })
      };
    });
  }

  /**
   * probRange(S, iv, days) → {S, iv, days, sdLog, low1, high1, low2, high2, move1, move2}
   * The range the stock lands in about 68 % (1σ) and 95 % (2σ) of the time
   * if it follows a driftless lognormal walk at volatility iv: the bounds
   * are S·e^(±kσ√t), symmetric in log space (so the dollar move up is a
   * little larger than the move down). move1/move2 are the simple
   * S·kσ√t "expected move" numbers traders quote.
   */
  function probRange(S, iv, days) {
    S = num(S, NaN); iv = Math.max(0, num(iv, 0)); days = Math.max(0, num(days, 0));
    if (!isNum(S) || S <= 0) throw new Error('options.probRange: spot must be > 0');
    var sd = iv * Math.sqrt(days / DAYS_PER_YEAR);
    return {
      S: S, iv: iv, days: days, sdLog: sd,
      low1: S * Math.exp(-sd), high1: S * Math.exp(sd),
      low2: S * Math.exp(-2 * sd), high2: S * Math.exp(2 * sd),
      move1: S * sd, move2: 2 * S * sd
    };
  }

  /**
   * probProfit(legs, S, iv, days, {r=0, daysForward, ivShift, ivFor, now}) → 0..1
   * Lognormal estimate of the chance the position shows a profit `days`
   * from now (default: its last expiry). With r = 0 the walk is driftless,
   * a neutral assumption for teaching; pass r to use the risk-neutral drift.
   * When every option leg has expired by then the payoff is piecewise
   * linear and the answer is exact; otherwise (calendars, or a date before
   * expiry) it integrates the model value over the lognormal density.
   */
  function probProfit(legs, S, iv, days, opts) {
    opts = opts || {};
    S = num(S, NaN); iv = num(iv, NaN);
    var L = whatIfLegs(legs, opts);
    if (!L.length || !isNum(S) || S <= 0) return 0;
    var last = L.reduce(function (m, l) { return l.right === 'S' ? m : Math.max(m, l.days); }, 0);
    days = num(days, NaN);
    if (!isNum(days)) days = last;
    days = Math.max(0, days);
    var r = num(opts.r, 0);
    var T = days / DAYS_PER_YEAR;
    var sig = Math.max(0, iv);
    if (T <= 0 || sig <= 0) {
      // No randomness left: the stock is where it is (or drifts at r).
      var ST = S * Math.exp(r * T);
      return valueLegsAt(L, ST, days, opts).pnl > 0 ? 1 : 0;
    }
    var allExpired = L.every(function (l) { return l.right === 'S' || l.days <= days + 1e-9; });
    if (allExpired) return round(probabilityOfProfit(L, S, sig, T, r), 6);
    // Midpoint rule over log-price from −6σ to +6σ.
    var sd = sig * Math.sqrt(T), mu = Math.log(S) + (r - 0.5 * sig * sig) * T;
    var n = 600, lo = -6, hi = 6, step = (hi - lo) / n, p = 0, mass = 0;
    for (var i = 0; i < n; i++) {
      var z = lo + (i + 0.5) * step;
      var w = normCdf(z + step / 2) - normCdf(z - step / 2);
      mass += w;
      if (valueLegsAt(L, Math.exp(mu + sd * z), days, opts).pnl > 0) p += w;
    }
    return round(Math.min(1, Math.max(0, p / mass)), 6);
  }

  /**
   * greeksCurve(legs, Srange, opts) → [{S, delta, gamma, theta, vega}]
   * Position greeks (dollars, multiplier included) across a price range at
   * opts.daysForward — the "greeks over price" mini chart.
   */
  function greeksCurve(legs, Srange, opts) {
    opts = opts || {};
    var L = whatIfLegs(legs, opts);
    if (!L.length) return [];
    var xs = payoff(legs, Srange).map(function (p) { return p.S; });
    var d = Math.max(0, num(opts.daysForward, 0));
    return xs.map(function (S) {
      var v = valueLegsAt(L, S, d, opts);
      return { S: S, delta: v.delta, gamma: v.gamma, theta: v.theta, vega: v.vega };
    });
  }

  /**
   * warnings(legs, {S, daysForward, exDividendDays, dividend, now, days}) → [{level, code, title, message}]
   * Plain-English risk flags for the analyzer:
   *   assignment   short option in the money with ≤ 5 days left
   *   pin          short option within 1 % of the strike with ≤ 2 days left
   *   earlyExercise short call in the money when an ex-dividend date comes
   *                before expiry and the dividend exceeds the put's time value
   *   nakedCall    short calls not covered by long calls or shares
   */
  function warnings(legs, opts) {
    opts = opts || {};
    var L = whatIfLegs(legs, opts);
    var S = num(opts.S, NaN), out = [];
    if (!isNum(S) || !L.length) return out;
    var fwd = Math.max(0, num(opts.daysForward, 0));
    var exDiv = num(opts.exDividendDays, NaN), div = num(opts.dividend, NaN);
    var r = num(opts.r, 0.05);
    var longCalls = 0, shortCalls = 0, sharesHeld = 0;
    L.forEach(function (l) {
      if (l.right === 'S') { sharesHeld += l.qty; return; }
      if (l.right === 'C') { if (l.qty > 0) longCalls += l.qty * l.multiplier; else shortCalls += -l.qty * l.multiplier; }
      if (l.qty >= 0) return;
      var left = Math.max(0, l.days - fwd);
      var itm = l.right === 'C' ? S > l.strike : S < l.strike;
      var what = round(l.strike, 2) + (l.right === 'C' ? ' call' : ' put');
      if (itm && left <= 5) {
        out.push({ level: 'warn', code: 'assignment', strike: l.strike, right: l.right,
          title: 'Assignment risk',
          message: 'Your short ' + what + ' is in the money with ' + round(left, 0) + ' day(s) left. The buyer can exercise at any time, and in-the-money options are exercised automatically at expiration, so you could be assigned ' + (l.right === 'C' ? 'a short stock position' : 'shares you must pay for') + '. Closing or rolling before expiry avoids the surprise.' });
      } else if (!itm && left <= 2 && Math.abs(S / l.strike - 1) <= 0.01) {
        out.push({ level: 'tip', code: 'pin', strike: l.strike, right: l.right,
          title: 'Pin risk',
          message: 'The stock is within 1% of your short ' + what + ' strike right before expiry. A small move at the close decides whether you are assigned, and you will not know until the next morning.' });
      }
      if (l.right === 'C' && itm && isNum(exDiv) && exDiv >= fwd && exDiv < l.days) {
        var tLeft = Math.max(0, l.days - exDiv) / DAYS_PER_YEAR;
        var iv = legIv(l.raw || l, tLeft, opts);
        var putTime = tLeft > 0 ? bs({ S: S, K: l.strike, T: tLeft, r: r, sigma: iv, type: 'put' }).price : 0;
        if (!isNum(div) || div > putTime) {
          out.push({ level: 'warn', code: 'earlyExercise', strike: l.strike, right: 'C',
            title: 'Early exercise before the ex-dividend date',
            message: 'Your short ' + what + ' is in the money and the stock goes ex-dividend in about ' + round(exDiv - fwd, 0) + ' day(s), before expiry. Call owners often exercise the day before to collect the dividend' + (isNum(div) ? ' (about $' + round(div, 2) + ' a share, more than the option\'s remaining time value)' : '') + ', which would leave you short the shares and owing the dividend.' });
        }
      }
    });
    var cover = longCalls + Math.max(0, sharesHeld);
    if (shortCalls > cover + 1e-9) {
      out.push({ level: 'warn', code: 'nakedCall', title: 'Uncovered short call',
        message: 'You are short more calls than you own shares or long calls, so the loss grows without limit if the stock keeps rising. Brokers require high option approval and margin for this.' });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Glossary — short definitions the UI can show as tooltips
   * ------------------------------------------------------------------ */
  var glossary = {
    delta: 'How much the option price changes for a $1 move in the stock. Also roughly the probability of expiring in the money. Calls 0 to 1, puts -1 to 0.',
    gamma: 'How fast delta changes as the stock moves. Highest at the money and near expiration; it is what makes short options dangerous into expiry.',
    theta: 'Time decay: how much value the option loses per calendar day if nothing else changes. Negative for long options, positive for short.',
    vega: 'Sensitivity to a 1-point change in implied volatility. Long options gain when IV rises; this is why options get expensive before earnings.',
    rho: 'Sensitivity to a 1-percentage-point change in interest rates. Small for short-dated options; matters more for LEAPS.',
    iv: 'Implied volatility: the annualised volatility the market price implies. Compare it with realised volatility to judge whether options are cheap or rich.',
    intrinsic: 'The value if exercised right now: max(0, S - K) for calls, max(0, K - S) for puts.',
    extrinsic: 'Time value: the premium above intrinsic. It is what you pay for time and volatility, and it goes to zero at expiration.',
    breakeven: 'The stock price at expiration where the position neither makes nor loses money.',
    oi: 'Open interest: contracts outstanding. High OI usually means tighter spreads and easier exits.',
    occ: 'The standard contract id: root symbol, expiry YYMMDD, C or P, strike x 1000 as eight digits.'
  };

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */
  BT.options = {
    // math
    normCdf: normCdf, normPdf: normPdf, normInv: normInv,
    // pricing
    bs: bs, price: price, impliedVol: impliedVol, positionGreeks: positionGreeks,
    // chain
    chain: chain, chainSlice: chainSlice, atmRow: atmRow, smileIV: smileIV, strikeIncrement: strikeIncrement,
    // payoff & analysis
    payoff: payoff, analyze: analyze, pnlAt: function (legs, S) { return pnlAt((legs || []).map(normLeg), S); },
    strategies: strategies, strategyList: strategyList, buildStrategy: buildStrategy,
    // what-if analyzer (v0.5)
    whatIf: whatIf, curves: curves, probRange: probRange, probProfit: probProfit,
    greeksCurve: greeksCurve, warnings: warnings, lastExpiryDays: lastExpiryDays,
    // contract ids & dates
    occ: occ, parseOcc: parseOcc, describeContract: describeContract,
    expiryFromDays: expiryFromDays, monthlyExpiries: monthlyExpiries, daysToExpiry: daysToExpiry, yearsToExpiry: yearsToExpiry,
    // reference
    glossary: glossary, MULTIPLIER: MULTIPLIER, DAYS_PER_YEAR: DAYS_PER_YEAR
  };
})();
