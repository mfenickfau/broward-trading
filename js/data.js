/* Broward Trading — js/data.js → BT.data (v0.4)
 *
 * Market data layer for the dashboard, portfolio, backtester and course pages.
 *
 *   BT.data.candles(symbol, interval, limit)   bars oldest → newest, cached + rate-limited
 *   BT.data.quote(symbol)                      {price, time}
 *   BT.data.search(query)                      [{symbol, name, exchange, kind}]
 *   BT.data.providers.{demo,twelvedata,finnhub,alphavantage}
 *   BT.data.getSettings() / setSettings({provider, keys})   persisted in localStorage 'bt.data'
 *   BT.data.demo(symbol, interval, limit) / BT.data.demoTick(bars)
 *   BT.data.marketStatus()                     NYSE {open, phase, nyTime, ...}; marketStatus('BTC-USD') → open 24/7
 *   BT.data.universe                           50+ US stocks, 17 ETFs (with expense ratios) and 3 crypto pairs
 *   BT.data.kindOf(symbol)                     'stock' | 'etf' | 'crypto'   (BASE-USD pairs are crypto)
 *   BT.data.providerSymbol(provider, symbol)   'BTC-USD' → 'BTC/USD' (Twelve Data) / 'BINANCE:BTCUSDT' (Finnhub) / 'BTC' (Alpha Vantage)
 *
 * Crypto trades 24/7: its demo generator uses one 1,440-minute session per UTC calendar day (no weekends, no
 * holidays, no overnight gaps) and daily candles are stamped with the UTC date. Stocks and ETFs follow the NYSE
 * calendar below.
 *
 * Bar shape: {time, open, high, low, close, volume}. `time` is 'YYYY-MM-DD' for daily bars
 * and unix seconds for intraday bars. Whenever live data is unavailable (no key, rate limit,
 * CORS block, bad symbol…) the returned array/object carries `fallback: true` and a plain-English
 * `reason`, and the data is the deterministic demo series — so the app always has something to
 * teach with, and always says so honestly.
 *
 * Plain ES2020, no imports, no DOM access. Loadable standalone.
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  const BT = window.BT;

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */

  const INTERVALS = ['1day', '1h', '15min', '5min', '1min'];
  const INTERVAL_SECONDS = { '1day': 86400, '1h': 3600, '15min': 900, '5min': 300, '1min': 60 };
  const SESSION_MINUTES = 390;                 // 9:30 → 16:00 ET
  const CRYPTO_SESSION_MINUTES = 1440;         // crypto never closes: one "session" = one UTC calendar day
  const SESSION_OPEN_MIN = 9 * 60 + 30;        // minutes after midnight ET
  const SESSION_CLOSE_MIN = 16 * 60;
  const EARLY_CLOSE_MIN = 13 * 60;
  const PRE_OPEN_MIN = 4 * 60;                 // pre-market starts 4:00 ET
  const AFTER_CLOSE_MIN = 20 * 60;             // after-hours ends 20:00 ET
  const NY = 'America/New_York';
  const DEMO_ANCHOR_DATE = '2025-07-01';       // demo prices equal the "plausible 2025 level" on this date
  const DEMO_GEN_START = '2000-01-03';         // returns are always generated from here so every limit sees the same history
                                               // (5,000 trading days back from 2026 reaches ~2007, so MAX_LIMIT is covered)
  const DEMO_MEAN_REVERSION = 0.004;           // daily pull toward the anchor level (half-life ≈ 170 trading days)
  const MAX_LIMIT = 5000;

  const SETTINGS_KEY = 'bt.data';
  const CACHE_KEY = 'bt.data.cache';
  const RATE_KEY = 'bt.data.rate';

  const PROVIDER_LABEL = {
    demo: 'Demo (simulated)',
    twelvedata: 'Twelve Data',
    finnhub: 'Finnhub',
    alphavantage: 'Alpha Vantage'
  };

  // Free-tier limits we promise to stay under. Twelve Data credits reset at 00:00 UTC,
  // Alpha Vantage at midnight US/Eastern. Finnhub has no daily cap on the free plan.
  const RATE_LIMITS = {
    demo: { perMinute: Infinity, perDay: Infinity, resetZone: 'UTC' },
    twelvedata: { perMinute: 8, perDay: 800, resetZone: 'UTC' },
    finnhub: { perMinute: 60, perDay: Infinity, resetZone: 'UTC' },
    alphavantage: { perMinute: 5, perDay: 25, resetZone: 'NY' }
  };

  const TTL = { intraday: 60 * 1000, daily: 10 * 60 * 1000, quote: 15 * 1000 };

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                    */
  /* ------------------------------------------------------------------ */

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /**
   * Canonical symbol. Stocks/ETFs are plain upper-case tickers (BRK.B keeps its dot). Crypto is spelled
   * BASE-QUOTE (BTC-USD, the Yahoo/Coinbase style); provider spellings such as 'BTC/USD' (Twelve Data),
   * 'BINANCE:BTCUSDT' (Finnhub) or 'BTCUSD' are folded into that form so every cache key and portfolio
   * position refers to the same thing.
   */
  function normSymbol(s) {
    let sym = String(s || '').trim().toUpperCase();
    if (!sym) return '';
    let m;
    if ((m = /^(?:[A-Z]+:)?([A-Z0-9]{2,10})[\/-](USD|USDT|USDC|EUR|GBP)$/.exec(sym))) sym = m[1] + '-' + (m[2] === 'USDT' || m[2] === 'USDC' ? 'USD' : m[2]);
    else if ((m = /^[A-Z]+:([A-Z0-9]{2,10}?)(USDT|USDC|USD)$/.exec(sym))) sym = m[1] + '-USD';
    return sym;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function round(v, dp) { const m = Math.pow(10, dp); return Math.round(v * m) / m; }
  function priceRound(v) { return v < 1 ? round(v, 4) : round(v, 2); }

  class DataError extends Error {
    constructor(message, code, detail) { super(message); this.name = 'DataError'; this.code = code || 'error'; if (detail !== undefined) this.detail = detail; }
  }

  /** Human-readable explanation of why live data failed — shown to students in the UI. */
  function explainError(e, providerName) {
    const label = PROVIDER_LABEL[providerName] || 'the data provider';
    if (!e) return 'Unknown error.';
    if (e instanceof TypeError || e.code === 'network') {
      return 'The request to ' + label + ' was blocked (CORS/CSP or offline). Open the site directly in your browser — some sandboxed viewers forbid outside requests.';
    }
    if (e.code === 'rate_limit') return e.message;
    if (e.code === 'auth') return label + ' rejected the API key. Check it in Live data settings.';
    if (e.code === 'plan') return e.message;
    if (e.code === 'symbol') return e.message;
    if (e.code === 'timeout') return label + ' did not answer within 15 seconds.';
    if (e.code === 'http') return label + ' answered HTTP ' + e.status + (e.status === 429 ? ' (too many requests).' : '.');
    return (e.message || String(e));
  }

  /* ------------------------------------------------------------------ */
  /* New York time helpers                                              */
  /* ------------------------------------------------------------------ */

  let _nyFmt = null;
  try {
    _nyFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: NY, hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (e) { _nyFmt = null; }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Wall-clock parts in New York for a given epoch-ms. */
  function nyParts(ms) {
    if (_nyFmt) {
      const o = {};
      for (const p of _nyFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
      let h = +o.hour; if (h === 24) h = 0;              // some engines print 24:00 for midnight
      return {
        y: +o.year, m: +o.month, d: +o.day, h, mi: +o.minute, s: +o.second,
        wd: WEEKDAYS.indexOf(o.weekday),
        date: o.year + '-' + o.month + '-' + o.day,
        minutes: h * 60 + (+o.minute)
      };
    }
    // Fallback without Intl: assume Eastern Standard Time (UTC−5).
    const d = new Date(ms - 5 * 3600 * 1000);
    return {
      y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
      wd: d.getUTCDay(), date: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()),
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
    };
  }

  /** Offset (ms) such that NY wall clock = UTC + offset at the given instant. Negative for New York. */
  function nyOffsetMs(ms) {
    const p = nyParts(ms);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  /** New York wall-clock → unix seconds (handles DST by iterating the offset once). */
  function nyToUnix(y, m, d, h, mi, s) {
    h = h || 0; mi = mi || 0; s = s || 0;
    const guess = Date.UTC(y, m - 1, d, h, mi, s);
    let off = nyOffsetMs(guess);
    let t = guess - off;
    const off2 = nyOffsetMs(t);
    if (off2 !== off) t = guess - off2;
    return Math.floor(t / 1000);
  }

  /** Parse 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[:SS]' (NY local) → unix seconds. */
  function nyStringToUnix(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(str));
    if (!m) return NaN;
    return nyToUnix(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  /** Unix seconds → 'YYYY-MM-DD' in New York. */
  function unixToNyDate(sec) { return nyParts(sec * 1000).date; }
  /** Unix seconds → 'YYYY-MM-DD' in UTC (crypto daily candles close at 00:00 UTC). */
  function unixToUtcDate(sec) { return new Date(sec * 1000).toISOString().slice(0, 10); }
  /** Parse 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[:SS]' as UTC → unix seconds. */
  function utcStringToUnix(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(str));
    if (!m) return NaN;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Calendar: weekends, NYSE holidays, early closes                    */
  /* ------------------------------------------------------------------ */

  function dateToSerial(dateStr) {            // days since 1970-01-01, from 'YYYY-MM-DD'
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function serialToDate(serial) {
    const d = new Date(serial * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDays(dateStr, n) { return serialToDate(dateToSerial(dateStr) + n); }
  function weekday(dateStr) { return new Date(dateToSerial(dateStr) * 86400000).getUTCDay(); }  // 0 = Sunday
  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  function nthWeekdayOfMonth(y, m, wd, n) {   // n-th (1-based) weekday wd in month m
    const first = weekday(ymd(y, m, 1));
    const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return ymd(y, m, day);
  }
  function lastWeekdayOfMonth(y, m, wd) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = weekday(ymd(y, m, lastDay));
    return ymd(y, m, lastDay - ((last - wd + 7) % 7));
  }
  function easterSunday(y) {                  // Anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, month, day);
  }
  /** NYSE observance: Saturday holidays move to Friday, Sunday to Monday — except New Year's Day,
   *  which is not observed on Dec 31 when Jan 1 falls on a Saturday. */
  function observed(dateStr, isNewYear) {
    const wd = weekday(dateStr);
    if (wd === 6) return isNewYear ? null : addDays(dateStr, -1);
    if (wd === 0) return addDays(dateStr, 1);
    return dateStr;
  }

  // Official NYSE calendars. These take precedence over the rule-based generator below.
  const NYSE_HOLIDAYS = {
    2025: {
      '2025-01-01': "New Year's Day", '2025-01-09': 'National Day of Mourning (President Carter)',
      '2025-01-20': 'Martin Luther King Jr. Day', '2025-02-17': "Presidents' Day", '2025-04-18': 'Good Friday',
      '2025-05-26': 'Memorial Day', '2025-06-19': 'Juneteenth', '2025-07-04': 'Independence Day',
      '2025-09-01': 'Labor Day', '2025-11-27': 'Thanksgiving Day', '2025-12-25': 'Christmas Day'
    },
    2026: {
      '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
      '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
      '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving Day',
      '2026-12-25': 'Christmas Day'
    },
    2027: {
      '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
      '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
      '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving Day',
      '2027-12-24': 'Christmas Day (observed)'
    }
  };
  // 1:00 pm ET closes.
  const NYSE_EARLY_CLOSES = {
    2025: ['2025-07-03', '2025-11-28', '2025-12-24'],
    2026: ['2026-11-27', '2026-12-24'],
    2027: ['2027-11-26']
  };

  const _holidayCache = {};
  /** Map of 'YYYY-MM-DD' → holiday name for a year (official table, or NYSE rules for other years). */
  function holidays(year) {
    year = +year;
    if (_holidayCache[year]) return _holidayCache[year];
    let map;
    if (NYSE_HOLIDAYS[year]) {
      map = Object.assign({}, NYSE_HOLIDAYS[year]);
    } else {
      map = {};
      const put = (d, name) => { if (d) map[d] = name; };
      put(observed(ymd(year, 1, 1), true), "New Year's Day");
      put(nthWeekdayOfMonth(year, 1, 1, 3), 'Martin Luther King Jr. Day');
      put(nthWeekdayOfMonth(year, 2, 1, 3), "Presidents' Day");
      put(addDays(easterSunday(year), -2), 'Good Friday');
      put(lastWeekdayOfMonth(year, 5, 1), 'Memorial Day');
      put(observed(ymd(year, 6, 19)), 'Juneteenth');
      put(observed(ymd(year, 7, 4)), 'Independence Day');
      put(nthWeekdayOfMonth(year, 9, 1, 1), 'Labor Day');
      put(nthWeekdayOfMonth(year, 11, 4, 4), 'Thanksgiving Day');
      put(observed(ymd(year, 12, 25)), 'Christmas Day');
    }
    _holidayCache[year] = map;
    return map;
  }
  /** Early-close dates for a year (official list, or the usual rules). */
  function earlyCloses(year) {
    year = +year;
    if (NYSE_EARLY_CLOSES[year]) return NYSE_EARLY_CLOSES[year].slice();
    const out = [];
    const hol = holidays(year);
    const jul3 = ymd(year, 7, 3);
    if (weekday(jul3) >= 1 && weekday(jul3) <= 5 && !hol[jul3] && hol[ymd(year, 7, 4)]) out.push(jul3);
    out.push(addDays(nthWeekdayOfMonth(year, 11, 4, 4), 1));               // day after Thanksgiving
    const dec24 = ymd(year, 12, 24);
    if (weekday(dec24) >= 1 && weekday(dec24) <= 4 && !hol[dec24]) out.push(dec24);
    return out;
  }
  function holidayName(dateStr) { return holidays(+dateStr.slice(0, 4))[dateStr] || null; }
  function isEarlyClose(dateStr) { return earlyCloses(+dateStr.slice(0, 4)).indexOf(dateStr) >= 0; }
  function isTradingDay(dateStr) {
    const wd = weekday(dateStr);
    return wd !== 0 && wd !== 6 && !holidayName(dateStr);
  }
  function prevTradingDay(dateStr) { let d = addDays(dateStr, -1); while (!isTradingDay(d)) d = addDays(d, -1); return d; }
  function nextTradingDay(dateStr) { let d = addDays(dateStr, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d; }
  /** `n` trading days ending on `endDate` (inclusive if it is a trading day), oldest → newest. */
  function tradingDays(endDate, n) {
    const out = [];
    let d = isTradingDay(endDate) ? endDate : prevTradingDay(endDate);
    while (out.length < n) { out.push(d); d = prevTradingDay(d); }
    return out.reverse();
  }
  /** Trading days between two dates inclusive, oldest → newest. */
  function tradingDaysBetween(startDate, endDate) {
    const out = [];
    let d = isTradingDay(startDate) ? startDate : nextTradingDay(startDate);
    while (dateToSerial(d) <= dateToSerial(endDate)) { out.push(d); d = nextTradingDay(d); }
    return out;
  }
  function sessionCloseMinutes(dateStr) { return isEarlyClose(dateStr) ? EARLY_CLOSE_MIN : SESSION_CLOSE_MIN; }

  /* ------------------------------------------------------------------ */
  /* Market status                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Where are we in the NYSE day right now?
   *  phase: 'pre' (4:00–9:30 ET), 'open' (9:30–16:00, or 13:00 on early-close days),
   *         'after' (16:00–20:00), 'closed' (overnight, weekends, holidays).
   */
  /**
   * marketStatus()                 → NYSE status now (stocks and ETFs)
   * marketStatus(nowMs)            → NYSE status at that instant (legacy numeric form)
   * marketStatus('BTC-USD')        → crypto: open 24/7, phase 'open', no holidays
   * marketStatus(symbol, nowMs) / marketStatus({symbol, now})
   * Every result carries `kind` ('stock' | 'etf' | 'crypto') and `always` (true when the market never closes).
   */
  function marketStatus(symbolOrNow, nowMs) {
    let symbol = null;
    if (symbolOrNow != null && typeof symbolOrNow === 'object') { symbol = symbolOrNow.symbol || null; nowMs = symbolOrNow.now != null ? symbolOrNow.now : nowMs; }
    else if (typeof symbolOrNow === 'string') symbol = symbolOrNow;
    else if (typeof symbolOrNow === 'number') nowMs = symbolOrNow;
    const kind = symbol ? kindOf(symbol) : 'stock';
    if (kind === 'crypto') return cryptoStatus(nowMs);
    const st = nyseStatus(nowMs);
    st.kind = kind;
    st.always = false;
    return st;
  }

  /** Crypto spot markets trade every minute of every day; the "session" is the UTC calendar day. */
  function cryptoStatus(nowMs) {
    const ms = nowMs == null ? Date.now() : nowMs;
    const p = nyParts(ms);
    const d = new Date(ms);
    return {
      open: true,
      phase: 'open',
      nyTime: pad2(p.h) + ':' + pad2(p.mi) + ' ET',
      nyDate: p.date,
      utcDate: d.toISOString().slice(0, 10),
      utcTime: pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC',
      weekday: WEEKDAYS[p.wd],
      isTradingDay: true,
      holiday: null,
      earlyClose: false,
      closesAt: null,
      reason: null,
      nextOpen: null,
      nextOpenDate: null,
      holidays: {},
      earlyCloses: [],
      kind: 'crypto',
      always: true,
      note: 'Crypto trades 24 hours a day, 7 days a week. Daily candles roll at 00:00 UTC.'
    };
  }

  function nyseStatus(nowMs) {
    const ms = nowMs == null ? Date.now() : nowMs;
    const p = nyParts(ms);
    const today = p.date;
    const hol = holidayName(today);
    const trading = p.wd !== 0 && p.wd !== 6 && !hol;
    const closeMin = sessionCloseMinutes(today);
    let phase = 'closed';
    if (trading) {
      if (p.minutes >= PRE_OPEN_MIN && p.minutes < SESSION_OPEN_MIN) phase = 'pre';
      else if (p.minutes >= SESSION_OPEN_MIN && p.minutes < closeMin) phase = 'open';
      else if (p.minutes >= closeMin && p.minutes < AFTER_CLOSE_MIN) phase = 'after';
    }
    const nyTime = pad2(p.h) + ':' + pad2(p.mi) + ' ET';
    // When does the next regular session start?
    let nextDate = (trading && p.minutes < SESSION_OPEN_MIN) ? today : nextTradingDay(today);
    const nextOpen = nyToUnix(+nextDate.slice(0, 4), +nextDate.slice(5, 7), +nextDate.slice(8, 10), 9, 30, 0);
    let reason = null;
    if (!trading) reason = hol ? 'Holiday: ' + hol : 'Weekend';
    else if (phase === 'closed') reason = p.minutes < PRE_OPEN_MIN ? 'Overnight' : 'Evening';
    const yr = p.y;
    return {
      open: phase === 'open',
      phase,
      nyTime,
      nyDate: today,
      weekday: WEEKDAYS[p.wd],
      isTradingDay: trading,
      holiday: hol,
      earlyClose: trading && isEarlyClose(today),
      closesAt: trading ? (pad2(Math.floor(closeMin / 60)) + ':' + pad2(closeMin % 60) + ' ET') : null,
      reason,
      nextOpen,                                  // unix seconds of the next 9:30 ET bell
      nextOpenDate: nextDate,
      holidays: Object.assign({}, holidays(yr), holidays(yr + 1)),
      earlyCloses: earlyCloses(yr).concat(earlyCloses(yr + 1))
    };
  }

  /* ------------------------------------------------------------------ */
  /* Demo universe                                                      */
  /* ------------------------------------------------------------------ */
  // base: plausible mid-2025 price level (USD), vol: annualised volatility, adv: average daily volume
  // (shares, or coins for crypto). `kind` is 'stock' (default), 'etf' or 'crypto'.
  // ETF metadata: expenseRatio is the annual fee in percent (0.0945 = 0.0945 % a year, i.e. $0.95 per $1,000),
  // approximate and as published by the issuer in 2025 — always check the fund page before relying on it.
  // etfType: 'index' | 'sector' | 'bond' | 'commodity' | 'international' | 'thematic' | 'crypto' | 'leveraged'.
  const UNIVERSE = [
    { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', exchange: 'NASDAQ', base: 255, vol: 0.28, adv: 55e6 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', exchange: 'NASDAQ', base: 510, vol: 0.24, adv: 22e6 },
    { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', sector: 'Communication Services', exchange: 'NASDAQ', base: 250, vol: 0.30, adv: 30e6 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', exchange: 'NASDAQ', base: 220, vol: 0.32, adv: 40e6 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', exchange: 'NASDAQ', base: 185, vol: 0.48, adv: 200e6 },
    { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Communication Services', exchange: 'NASDAQ', base: 730, vol: 0.36, adv: 12e6 },
    { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Discretionary', exchange: 'NASDAQ', base: 430, vol: 0.62, adv: 90e6 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology', exchange: 'NASDAQ', base: 350, vol: 0.40, adv: 20e6 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway Class B', sector: 'Financials', exchange: 'NYSE', base: 495, vol: 0.16, adv: 4e6 },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials', exchange: 'NYSE', base: 300, vol: 0.24, adv: 9e6 },
    { symbol: 'V', name: 'Visa Inc.', sector: 'Financials', exchange: 'NYSE', base: 345, vol: 0.20, adv: 6e6 },
    { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financials', exchange: 'NYSE', base: 570, vol: 0.20, adv: 2.5e6 },
    { symbol: 'BAC', name: 'Bank of America Corp.', sector: 'Financials', exchange: 'NYSE', base: 50, vol: 0.27, adv: 35e6 },
    { symbol: 'GS', name: 'Goldman Sachs Group', sector: 'Financials', exchange: 'NYSE', base: 760, vol: 0.28, adv: 2e6 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Health Care', exchange: 'NYSE', base: 185, vol: 0.16, adv: 8e6 },
    { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Health Care', exchange: 'NYSE', base: 350, vol: 0.34, adv: 6e6 },
    { symbol: 'LLY', name: 'Eli Lilly & Co.', sector: 'Health Care', exchange: 'NYSE', base: 800, vol: 0.32, adv: 3e6 },
    { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Health Care', exchange: 'NYSE', base: 25, vol: 0.24, adv: 40e6 },
    { symbol: 'MRK', name: 'Merck & Co.', sector: 'Health Care', exchange: 'NYSE', base: 85, vol: 0.24, adv: 10e6 },
    { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Health Care', exchange: 'NYSE', base: 230, vol: 0.22, adv: 6e6 },
    { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Staples', exchange: 'NYSE', base: 100, vol: 0.20, adv: 18e6 },
    { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer Staples', exchange: 'NASDAQ', base: 920, vol: 0.20, adv: 2e6 },
    { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer Staples', exchange: 'NYSE', base: 155, vol: 0.15, adv: 7e6 },
    { symbol: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer Staples', exchange: 'NYSE', base: 68, vol: 0.14, adv: 15e6 },
    { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer Staples', exchange: 'NASDAQ', base: 145, vol: 0.17, adv: 7e6 },
    { symbol: 'MCD', name: "McDonald's Corp.", sector: 'Consumer Discretionary', exchange: 'NYSE', base: 300, vol: 0.17, adv: 3e6 },
    { symbol: 'SBUX', name: 'Starbucks Corp.', sector: 'Consumer Discretionary', exchange: 'NASDAQ', base: 85, vol: 0.30, adv: 10e6 },
    { symbol: 'NKE', name: 'Nike Inc.', sector: 'Consumer Discretionary', exchange: 'NYSE', base: 70, vol: 0.34, adv: 12e6 },
    { symbol: 'HD', name: 'Home Depot Inc.', sector: 'Consumer Discretionary', exchange: 'NYSE', base: 400, vol: 0.20, adv: 3.5e6 },
    { symbol: 'DIS', name: 'Walt Disney Co.', sector: 'Communication Services', exchange: 'NYSE', base: 115, vol: 0.28, adv: 9e6 },
    { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Communication Services', exchange: 'NASDAQ', base: 118, vol: 0.34, adv: 30e6 },
    { symbol: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy', exchange: 'NYSE', base: 112, vol: 0.22, adv: 14e6 },
    { symbol: 'CVX', name: 'Chevron Corp.', sector: 'Energy', exchange: 'NYSE', base: 155, vol: 0.22, adv: 8e6 },
    { symbol: 'BA', name: 'Boeing Co.', sector: 'Industrials', exchange: 'NYSE', base: 215, vol: 0.36, adv: 7e6 },
    { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrials', exchange: 'NYSE', base: 480, vol: 0.26, adv: 2.5e6 },
    { symbol: 'GE', name: 'GE Aerospace', sector: 'Industrials', exchange: 'NYSE', base: 300, vol: 0.28, adv: 4e6 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', exchange: 'NASDAQ', base: 240, vol: 0.50, adv: 40e6 },
    { symbol: 'INTC', name: 'Intel Corp.', sector: 'Technology', exchange: 'NASDAQ', base: 38, vol: 0.48, adv: 90e6 },
    { symbol: 'CSCO', name: 'Cisco Systems', sector: 'Technology', exchange: 'NASDAQ', base: 70, vol: 0.20, adv: 18e6 },
    { symbol: 'ORCL', name: 'Oracle Corp.', sector: 'Technology', exchange: 'NYSE', base: 280, vol: 0.38, adv: 12e6 },
    { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', exchange: 'NYSE', base: 250, vol: 0.30, adv: 6e6 },
    { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', exchange: 'NASDAQ', base: 350, vol: 0.30, adv: 3e6 },
    { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', exchange: 'NASDAQ', base: 180, vol: 0.70, adv: 60e6 },
    { symbol: 'UBER', name: 'Uber Technologies', sector: 'Industrials', exchange: 'NYSE', base: 95, vol: 0.34, adv: 20e6 },
    { symbol: 'ABNB', name: 'Airbnb Inc.', sector: 'Consumer Discretionary', exchange: 'NASDAQ', base: 125, vol: 0.34, adv: 5e6 },
    { symbol: 'SHOP', name: 'Shopify Inc.', sector: 'Technology', exchange: 'NASDAQ', base: 150, vol: 0.50, adv: 8e6 },
    { symbol: 'PYPL', name: 'PayPal Holdings', sector: 'Financials', exchange: 'NASDAQ', base: 70, vol: 0.36, adv: 12e6 },
    { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financials', exchange: 'NASDAQ', base: 330, vol: 0.80, adv: 10e6 },
    { symbol: 'SOFI', name: 'SoFi Technologies', sector: 'Financials', exchange: 'NASDAQ', base: 27, vol: 0.60, adv: 60e6 },
    { symbol: 'F', name: 'Ford Motor Co.', sector: 'Consumer Discretionary', exchange: 'NYSE', base: 12, vol: 0.32, adv: 70e6 },
    { symbol: 'GM', name: 'General Motors', sector: 'Consumer Discretionary', exchange: 'NYSE', base: 60, vol: 0.32, adv: 10e6 },
    { symbol: 'T', name: 'AT&T Inc.', sector: 'Communication Services', exchange: 'NYSE', base: 27, vol: 0.18, adv: 35e6 },
    { symbol: 'VZ', name: 'Verizon Communications', sector: 'Communication Services', exchange: 'NYSE', base: 42, vol: 0.18, adv: 20e6 },
    // --- ETFs ---------------------------------------------------------------------------------------
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', sector: 'ETF — US large cap', exchange: 'NYSE Arca', base: 620, vol: 0.15, adv: 70e6, kind: 'etf', etfType: 'index', expenseRatio: 0.0945, tracks: 'S&P 500', holdings: 503, issuer: 'State Street' },
    { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', sector: 'ETF — US large cap', exchange: 'NYSE Arca', base: 570, vol: 0.15, adv: 5e6, kind: 'etf', etfType: 'index', expenseRatio: 0.03, tracks: 'S&P 500', holdings: 505, issuer: 'Vanguard' },
    { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', sector: 'ETF — US total market', exchange: 'NYSE Arca', base: 305, vol: 0.16, adv: 3.5e6, kind: 'etf', etfType: 'index', expenseRatio: 0.03, tracks: 'CRSP US Total Market', holdings: 3600, issuer: 'Vanguard' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq-100)', sector: 'ETF — US tech / growth', exchange: 'NASDAQ', base: 550, vol: 0.20, adv: 40e6, kind: 'etf', etfType: 'index', expenseRatio: 0.20, tracks: 'Nasdaq-100', holdings: 101, issuer: 'Invesco' },
    { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', sector: 'ETF — US blue chip', exchange: 'NYSE Arca', base: 440, vol: 0.14, adv: 3e6, kind: 'etf', etfType: 'index', expenseRatio: 0.16, tracks: 'Dow Jones Industrial Average', holdings: 30, issuer: 'State Street' },
    { symbol: 'IWM', name: 'iShares Russell 2000 ETF', sector: 'ETF — US small cap', exchange: 'NYSE Arca', base: 215, vol: 0.22, adv: 30e6, kind: 'etf', etfType: 'index', expenseRatio: 0.19, tracks: 'Russell 2000', holdings: 1960, issuer: 'iShares' },
    { symbol: 'EFA', name: 'iShares MSCI EAFE ETF', sector: 'ETF — Developed markets ex-US', exchange: 'NYSE Arca', base: 88, vol: 0.16, adv: 15e6, kind: 'etf', etfType: 'international', expenseRatio: 0.33, tracks: 'MSCI EAFE', holdings: 700, issuer: 'iShares' },
    { symbol: 'XLK', name: 'Technology Select Sector SPDR', sector: 'ETF — Technology', exchange: 'NYSE Arca', base: 250, vol: 0.24, adv: 6e6, kind: 'etf', etfType: 'sector', expenseRatio: 0.08, tracks: 'S&P 500 Technology sector', holdings: 70, issuer: 'State Street' },
    { symbol: 'XLF', name: 'Financial Select Sector SPDR', sector: 'ETF — Financials', exchange: 'NYSE Arca', base: 52, vol: 0.17, adv: 40e6, kind: 'etf', etfType: 'sector', expenseRatio: 0.08, tracks: 'S&P 500 Financials sector', holdings: 73, issuer: 'State Street' },
    { symbol: 'XLE', name: 'Energy Select Sector SPDR', sector: 'ETF — Energy', exchange: 'NYSE Arca', base: 86, vol: 0.22, adv: 15e6, kind: 'etf', etfType: 'sector', expenseRatio: 0.08, tracks: 'S&P 500 Energy sector', holdings: 23, issuer: 'State Street' },
    { symbol: 'XLV', name: 'Health Care Select Sector SPDR', sector: 'ETF — Health care', exchange: 'NYSE Arca', base: 135, vol: 0.15, adv: 9e6, kind: 'etf', etfType: 'sector', expenseRatio: 0.08, tracks: 'S&P 500 Health Care sector', holdings: 60, issuer: 'State Street' },
    { symbol: 'GLD', name: 'SPDR Gold Shares', sector: 'ETF — Gold', exchange: 'NYSE Arca', base: 305, vol: 0.15, adv: 8e6, kind: 'etf', etfType: 'commodity', expenseRatio: 0.40, tracks: 'Gold bullion (LBMA price)', holdings: 1, issuer: 'State Street' },
    { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', sector: 'ETF — Long bonds', exchange: 'NASDAQ', base: 87, vol: 0.15, adv: 35e6, kind: 'etf', etfType: 'bond', expenseRatio: 0.15, tracks: 'ICE US Treasury 20+ Year', holdings: 40, issuer: 'iShares' },
    { symbol: 'ARKK', name: 'ARK Innovation ETF (active)', sector: 'ETF — Thematic / active', exchange: 'NYSE Arca', base: 70, vol: 0.45, adv: 8e6, kind: 'etf', etfType: 'thematic', expenseRatio: 0.75, tracks: 'None — actively managed', holdings: 35, issuer: 'ARK Invest' },
    { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF', sector: 'ETF — Spot bitcoin', exchange: 'NASDAQ', base: 61, vol: 0.55, adv: 40e6, kind: 'etf', etfType: 'crypto', expenseRatio: 0.25, tracks: 'Bitcoin (CME CF Bitcoin Reference Rate)', holdings: 1, issuer: 'iShares' },
    { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ (3× daily)', sector: 'ETF — Leveraged 3× Nasdaq-100', exchange: 'NASDAQ', base: 75, vol: 0.60, adv: 60e6, kind: 'etf', etfType: 'leveraged', leverage: 3, expenseRatio: 0.84, tracks: '3× the daily return of the Nasdaq-100', holdings: 101, issuer: 'ProShares' },
    { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ (−3× daily)', sector: 'ETF — Inverse 3× Nasdaq-100', exchange: 'NASDAQ', base: 25, vol: 0.60, adv: 100e6, kind: 'etf', etfType: 'leveraged', leverage: -3, expenseRatio: 0.95, tracks: '−3× the daily return of the Nasdaq-100', holdings: 101, issuer: 'ProShares' },
    // --- Crypto (spot, quoted in USD, trades 24/7; volume is in coins) --------------------------------
    { symbol: 'BTC-USD', name: 'Bitcoin', sector: 'Crypto — Layer 1', exchange: 'Crypto (24/7)', base: 107000, vol: 0.55, adv: 25e3, kind: 'crypto', baseAsset: 'BTC', quoteAsset: 'USD', launched: 2009, supplyCap: 21e6 },
    { symbol: 'ETH-USD', name: 'Ether (Ethereum)', sector: 'Crypto — Smart contracts', exchange: 'Crypto (24/7)', base: 2500, vol: 0.75, adv: 400e3, kind: 'crypto', baseAsset: 'ETH', quoteAsset: 'USD', launched: 2015, supplyCap: null },
    { symbol: 'SOL-USD', name: 'Solana', sector: 'Crypto — Smart contracts', exchange: 'Crypto (24/7)', base: 150, vol: 1.0, adv: 3e6, kind: 'crypto', baseAsset: 'SOL', quoteAsset: 'USD', launched: 2020, supplyCap: null }
  ];
  UNIVERSE.forEach(u => { if (!u.kind) u.kind = 'stock'; });
  const UNIVERSE_BY_SYMBOL = {};
  UNIVERSE.forEach(u => { UNIVERSE_BY_SYMBOL[u.symbol] = u; });

  const KIND_LABEL = { stock: 'Stock', etf: 'ETF', crypto: 'Crypto' };
  const CRYPTO_RE = /^[A-Z0-9]{2,10}-(USD|EUR|GBP)$/;
  const CRYPTO_QUOTE_RE = /^[A-Z0-9]{2,10}-(USD|EUR|GBP)$/;

  /** 'stock' | 'etf' | 'crypto' for any symbol (unknown BASE-USD pairs count as crypto). */
  function kindOf(symbol) {
    symbol = normSymbol(symbol);
    const u = UNIVERSE_BY_SYMBOL[symbol];
    if (u) return u.kind;
    return CRYPTO_RE.test(symbol) ? 'crypto' : 'stock';
  }
  function isCrypto(symbol) { return kindOf(symbol) === 'crypto'; }

  /** Split a symbol into its parts: {symbol, kind, base, quote}. Stocks have quote 'USD' and base = ticker. */
  function parseSymbol(symbol) {
    symbol = normSymbol(symbol);
    const kind = kindOf(symbol);
    if (kind === 'crypto') {
      const m = CRYPTO_QUOTE_RE.exec(symbol);
      const base = symbol.slice(0, symbol.lastIndexOf('-'));
      return { symbol, kind, base, quote: m ? m[1] : 'USD' };
    }
    return { symbol, kind, base: symbol, quote: 'USD' };
  }

  /**
   * How each provider spells a symbol. Stocks: Twelve Data and Finnhub use the plain ticker, Alpha Vantage
   * writes share classes with a dash (BRK-B). Crypto: Twelve Data 'BTC/USD', Finnhub 'BINANCE:BTCUSDT'
   * (its free crypto feed is exchange-prefixed and quoted in the USDT stablecoin, which tracks USD closely),
   * Alpha Vantage splits the pair into symbol 'BTC' + market 'USD' for DIGITAL_CURRENCY_DAILY.
   */
  function providerSymbol(provider, symbol) {
    const p = parseSymbol(symbol);
    if (p.kind === 'crypto') {
      if (provider === 'twelvedata') return p.base + '/' + p.quote;
      if (provider === 'finnhub') return 'BINANCE:' + p.base + (p.quote === 'USD' ? 'USDT' : p.quote);
      if (provider === 'alphavantage') return p.base;             // + market=p.quote as a separate parameter
      return p.symbol;
    }
    if (provider === 'alphavantage') return p.symbol.replace(/\./g, '-');
    return p.symbol;
  }

  /** Universe entry for a symbol, or a synthesized profile for unknown tickers (so any symbol charts). */
  function lookup(symbol) {
    symbol = normSymbol(symbol);
    if (UNIVERSE_BY_SYMBOL[symbol]) return UNIVERSE_BY_SYMBOL[symbol];
    const h = hash32(symbol);
    const kind = kindOf(symbol);
    if (kind === 'crypto') {
      const p = parseSymbol(symbol);
      const base = priceRound(0.05 + Math.pow(10, ((h % 1000) / 1000) * 4));   // 1 .. 10,000, log-distributed
      return { symbol, name: p.base + ' (unknown coin — simulated)', sector: 'Crypto — Unknown', exchange: 'Crypto (24/7)', base, vol: 0.7 + ((h >>> 8) % 60) / 100, adv: 1e5 + ((h >>> 16) % 50) * 1e5, kind, baseAsset: p.base, quoteAsset: p.quote, synthetic: true };
    }
    const base = priceRound(5 + Math.pow(10, 1 + ((h % 1000) / 1000) * 1.7));   // 15 .. 500, log-distributed
    return { symbol, name: symbol + ' (unknown — simulated)', sector: 'Unknown', exchange: 'DEMO', base, vol: 0.25 + ((h >>> 8) % 40) / 100, adv: 3e6 + ((h >>> 16) % 30) * 1e6, kind: 'stock', synthetic: true };
  }

  function universeSearch(query, max) {
    const q = String(query || '').trim().toUpperCase();
    max = max || 12;
    if (!q) return UNIVERSE.slice(0, max).map(toSearchRow);
    const scored = [];
    for (const u of UNIVERSE) {
      let score = 0;
      if (u.symbol === q || normSymbol(q) === u.symbol) score = 100;
      else if (u.symbol.startsWith(q)) score = 60;
      else if (u.kind === 'crypto' && u.baseAsset && u.baseAsset.startsWith(q)) score = 55;
      else if (u.name.toUpperCase().startsWith(q)) score = 50;
      else if (u.kind.toUpperCase() === q || (KIND_LABEL[u.kind] || '').toUpperCase() === q) score = 40;   // "etf" lists the ETFs before Netflix
      else if (u.name.toUpperCase().includes(q)) score = 30;
      else if (u.sector.toUpperCase().includes(q)) score = 10;
      if (score) scored.push({ score, u });
    }
    scored.sort((a, b) => b.score - a.score || a.u.symbol.localeCompare(b.u.symbol));
    return scored.slice(0, max).map(x => toSearchRow(x.u));
  }
  function toSearchRow(u) {
    const row = { symbol: u.symbol, name: u.name, exchange: u.exchange, sector: u.sector, kind: u.kind };
    if (u.kind === 'etf') { row.expenseRatio = u.expenseRatio; row.etfType = u.etfType; }
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Demo data generator                                                */
  /* ------------------------------------------------------------------ */
  // Design goals: (1) deterministic per symbol so every student sees the same chart and a lesson
  // can say "look at the March gap on AAPL"; (2) realistic — trending/sideways regimes, volatility
  // clusters, overnight gaps, earnings-style jumps with volume spikes, U-shaped intraday volume;
  // (3) consistent across intervals — the 5-minute bars for a day aggregate to that day's daily bar.

  function hash32(str) {                        // FNV-1a
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {                           // Box–Muller
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Regime (bull / bear / sideways + volatility multiplier) for a trading-day serial. ~45-day blocks. */
  function regimeFor(symbol, serial) {
    const salt = hash32(symbol + '|regime') % 30;
    const block = Math.floor((serial + salt) / 45);
    const r = mulberry32(hash32(symbol + '|r|' + block));
    const u = r();
    let drift;                                  // daily log drift
    if (u < 0.38) drift = 0.0007 + r() * 0.0009;            // bull: ≈ +18…40 % annualised
    else if (u < 0.66) drift = -(0.0006 + r() * 0.0009);    // bear: ≈ −15…−38 % annualised
    else drift = (r() - 0.5) * 0.0004;                      // sideways
    const volMult = 0.65 + r() * 0.95;                      // calm ↔ stormy
    return { drift, volMult, kind: u < 0.38 ? 'bull' : u < 0.66 ? 'bear' : 'range' };
  }

  /* ------------------------------------------------------------------ */
  /* Trading calendars: NYSE sessions vs the 24/7 crypto day            */
  /* ------------------------------------------------------------------ */
  // The generator asks the calendar which days exist, how long a session is, when it opens (unix) and
  // where "now" falls. Stocks and ETFs follow the NYSE calendar above; crypto has one 1,440-minute
  // session per UTC calendar day, every day of the year, with no overnight gap and a flatter intraday
  // volume curve (activity rises during US and European hours but never stops).

  function calendarDays(endDate, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addDays(endDate, -i));
    return out;
  }
  function calendarDaysBetween(startDate, endDate) {
    const out = [];
    let s = dateToSerial(startDate);
    const e = dateToSerial(endDate);
    while (s <= e) { out.push(serialToDate(s)); s++; }
    return out;
  }

  const EQUITY_CAL = {
    id: 'nyse',
    always: false,
    sqrtDays: Math.sqrt(252),                   // trading days per year, for daily volatility
    volShape: 1.6,                              // U-shaped intraday volatility (busy bells, quiet lunch)
    gapScale: 1,                                // overnight gaps happen
    weekendVolume: 1,                           // (there are no weekend sessions)
    maxSessionMinutes: SESSION_MINUTES,
    sessionMinutes(date) { return sessionCloseMinutes(date) - SESSION_OPEN_MIN; },
    isDay: isTradingDay,
    prevDay: prevTradingDay,
    nextDay: nextTradingDay,
    days: tradingDays,
    daysBetween: tradingDaysBetween,
    openUnix(date) { return nyToUnix(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10), 9, 30, 0); },
    /** Which session is current and how many minutes of it are complete. */
    clock(nowMs) {
      const st = nyseStatus(nowMs);
      const p = nyParts(nowMs == null ? Date.now() : nowMs);
      let date, elapsed;
      if (st.isTradingDay && p.minutes >= SESSION_OPEN_MIN) {
        date = p.date;
        const closeMin = sessionCloseMinutes(date);
        elapsed = clamp(p.minutes - SESSION_OPEN_MIN, 0, closeMin - SESSION_OPEN_MIN);
      } else {
        date = prevTradingDay(p.date);
        elapsed = sessionCloseMinutes(date) - SESSION_OPEN_MIN;
      }
      return { date, elapsed, sessionMinutes: sessionCloseMinutes(date) - SESSION_OPEN_MIN, inProgress: st.open, calendar: 'nyse' };
    }
  };

  const CRYPTO_CAL = {
    id: 'crypto',
    always: true,
    sqrtDays: Math.sqrt(365),                   // crypto trades every day, so annual vol spreads over 365 days
    volShape: 0.35,                             // gentle bump, never a closing bell
    gapScale: 0,                                // continuous trading: today's open is yesterday's close
    weekendVolume: 0.7,                         // weekends are real sessions but quieter
    maxSessionMinutes: CRYPTO_SESSION_MINUTES,
    sessionMinutes() { return CRYPTO_SESSION_MINUTES; },
    isDay() { return true; },
    prevDay(date) { return addDays(date, -1); },
    nextDay(date) { return addDays(date, 1); },
    days: calendarDays,
    daysBetween: calendarDaysBetween,
    openUnix(date) { return dateToSerial(date) * 86400; },           // 00:00 UTC
    clock(nowMs) {
      const ms = nowMs == null ? Date.now() : nowMs;
      const d = new Date(ms);
      const date = d.toISOString().slice(0, 10);
      const elapsed = d.getUTCHours() * 60 + d.getUTCMinutes();
      return { date, elapsed, sessionMinutes: CRYPTO_SESSION_MINUTES, inProgress: true, calendar: 'crypto' };
    }
  };

  /** The calendar a symbol trades on. */
  function calendarFor(symbol) { return isCrypto(symbol) ? CRYPTO_CAL : EQUITY_CAL; }

  /* ------------------------------------------------------------------ */
  /* Demo data generator (continued)                                    */
  /* ------------------------------------------------------------------ */

  /** Per-day core numbers, deterministic from (symbol, date). `cal` defaults to the NYSE calendar. */
  function dayCore(symbol, profile, date, cal) {
    cal = cal || EQUITY_CAL;
    const serial = dateToSerial(date);
    const r = mulberry32(hash32(symbol + '|d|' + date));
    const reg = regimeFor(symbol, serial);
    const sigma = (profile.vol / cal.sqrtDays) * reg.volMult;
    // Overnight gap: usually small; ~3 % of days carry an "event" gap (earnings, news). Crypto never closes,
    // so its gapScale is 0 and the event move lands inside the day instead.
    const gapNoise = gauss(r);                                        // always drawn, so the NYSE sequence is unchanged
    let gap = cal.gapScale ? cal.gapScale * 0.35 * sigma * gapNoise : 0, event = false, spike = 1, eventMove = 0;
    if (r() < 0.03) {
      event = true;
      // Event size scales with how volatile the name is: ~1–3 % for KO, ~4–14 % for TSLA.
      const size = clamp((0.02 + r() * 0.05) * (profile.vol / 0.3), 0.012, 0.14);
      const signed = (r() < 0.5 ? -1 : 1) * size;
      if (cal.gapScale) gap += signed; else eventMove = signed;
      spike = 2.5 + r() * 3.5;
    }
    const intra = reg.drift + sigma * gauss(r) + eventMove;           // open → close log return
    const wd = weekday(date);
    let weekdayVol = wd === 1 || wd === 5 ? 0.95 : 1.05;              // Mondays/Fridays a little lighter
    if ((wd === 0 || wd === 6) && cal.weekendVolume !== 1) weekdayVol = cal.weekendVolume;
    const volume = profile.adv * weekdayVol * Math.exp(0.35 * gauss(r)) * (1 + 1.4 * Math.abs(gap + intra) / Math.max(sigma, 1e-6) * 0.25) * spike;
    return { date, serial, gap, intra, sigma, volume: Math.max(cal === CRYPTO_CAL ? 1 : 1000, Math.round(volume)), event, regime: reg.kind };
  }

  /**
   * Minute-resolution log-price path for one session: a Brownian bridge from logOpen to logClose with a
   * U-shaped volatility profile (busy open, quiet lunch, busy close). Returns `minutes + 1` points plus
   * per-minute volume weights. `shape` sets how pronounced the U is (0 = flat).
   */
  function sessionPath(symbol, date, logOpen, logClose, sigmaDay, minutes, shape) {
    shape = shape == null ? EQUITY_CAL.volShape : shape;
    const r = mulberry32(hash32(symbol + '|m|' + date));
    const n = minutes;
    const z = new Array(n), w = new Array(n);
    let cum = 0;
    const cumArr = new Array(n + 1); cumArr[0] = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const u = 1 + shape * Math.pow(2 * (t - 0.5), 2);     // U-shape: ~2.6× at the bells, 1× at lunch (shape 1.6)
      w[i] = u;
      z[i] = gauss(r) * Math.sqrt(u);
      cum += z[i];
      cumArr[i + 1] = cum;
    }
    const total = cumArr[n];
    const meanU = round(1 + shape / 3, 2);                   // mean of u over the session (1.53 for the NYSE shape)
    const scale = (sigmaDay * 0.85) / Math.sqrt(n * meanU);
    const path = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      path[i] = logOpen + f * (logClose - logOpen) + scale * (cumArr[i] - f * total);
    }
    return { path, weights: w };
  }

  /** Where "now" is for the demo clock of a calendar (NYSE by default): current session + minutes complete. */
  function demoClock(nowMs, cal) { return (cal || EQUITY_CAL).clock(nowMs); }

  // In-memory memo of generated daily series so the dashboard can re-request cheaply.
  const _demoMemo = new Map();

  /**
   * Daily demo bars for `dates` (array of session-day strings on the symbol's calendar) plus the per-day log
   * open/close needed by the intraday generator. Prices are anchored so the close on DEMO_ANCHOR_DATE equals
   * the universe base price.
   */
  function demoDailySeries(symbol, dates, clock, cal) {
    const profile = lookup(symbol);
    cal = cal || calendarFor(symbol);
    // Nothing exists before the generation start: clamp rather than move the start, so the path never shifts.
    if (dates.length && dateToSerial(dates[0]) < dateToSerial(DEMO_GEN_START)) dates = dates.filter(d => dateToSerial(d) >= dateToSerial(DEMO_GEN_START));
    if (!dates.length) dates = [DEMO_GEN_START];
    const first = dates[0], last = dates[dates.length - 1];
    const memoKey = symbol + '|' + first + '|' + last + '|' + clock.date + '|' + clock.elapsed;
    if (_demoMemo.has(memoKey)) return _demoMemo.get(memoKey);

    // Generate returns from a fixed start so the path (and therefore every bar) is identical whatever
    // `limit` the caller asks for. A gentle mean reversion keeps multi-year demo prices in a believable
    // band around the anchor level while still allowing months-long trends.
    const genStart = DEMO_GEN_START;
    const allDates = cal.daysBetween(genStart, last);
    const cores = allDates.map(d => dayCore(symbol, profile, d, cal));
    const logC = new Array(cores.length), logO = new Array(cores.length);
    let lc = 0;
    for (let i = 0; i < cores.length; i++) {
      const c = cores[i];
      logO[i] = lc + c.gap;
      lc = logO[i] + c.intra - DEMO_MEAN_REVERSION * lc;
      logC[i] = lc;
    }
    // Anchor: close on the anchor date (or the nearest trading day after it) = base price.
    let anchorIdx = allDates.findIndex(d => dateToSerial(d) >= dateToSerial(DEMO_ANCHOR_DATE));
    if (anchorIdx < 0) anchorIdx = allDates.length - 1;
    const shift = Math.log(profile.base) - logC[anchorIdx];

    const wanted = new Set(dates);
    const bars = [], meta = {};
    for (let i = 0; i < cores.length; i++) {
      const d = allDates[i];
      if (!wanted.has(d)) continue;
      const c = cores[i];
      const lo = logO[i] + shift, lcl = logC[i] + shift;
      const sessionMin = cal.sessionMinutes(d);
      const sp = sessionPath(symbol, d, lo, lcl, c.sigma, sessionMin, cal.volShape);
      const upto = (d === clock.date) ? Math.max(1, Math.min(sessionMin, clock.elapsed)) : sessionMin;
      let hi = -Infinity, low = Infinity, volW = 0, totW = 0;
      for (let k = 0; k <= upto; k++) { if (sp.path[k] > hi) hi = sp.path[k]; if (sp.path[k] < low) low = sp.path[k]; }
      for (let k = 0; k < sessionMin; k++) { totW += sp.weights[k]; if (k < upto) volW += sp.weights[k]; }
      const open = Math.exp(lo), close = Math.exp(sp.path[upto]);
      const wick = 1 + c.sigma * 0.08;
      bars.push({
        time: d,
        open: priceRound(open),
        high: priceRound(Math.max(open, close, Math.exp(hi) * wick)),
        low: priceRound(Math.min(open, close, Math.exp(low) / wick)),
        close: priceRound(close),
        volume: Math.round(c.volume * (volW / totW))
      });
      meta[d] = { logOpen: lo, logClose: lcl, sigma: c.sigma, volume: c.volume, event: c.event, regime: c.regime, sessionMin, path: sp };
    }
    const out = { bars, meta };
    if (_demoMemo.size > 24) _demoMemo.delete(_demoMemo.keys().next().value);
    _demoMemo.set(memoKey, out);
    return out;
  }

  function demoDaily(symbol, limit, nowMs) {
    const cal = calendarFor(symbol);
    const clock = cal.clock(nowMs);
    const dates = cal.days(clock.date, limit);
    return demoDailySeries(symbol, dates, clock, cal).bars.map(b => Object.assign({}, b));
  }

  function demoIntraday(symbol, interval, limit, nowMs) {
    const step = INTERVAL_SECONDS[interval] / 60;            // minutes per bar
    const cal = calendarFor(symbol);
    const clock = cal.clock(nowMs);
    const perSession = Math.ceil(cal.maxSessionMinutes / step);
    const sessions = Math.ceil(limit / perSession) + 1;
    const dates = cal.days(clock.date, sessions);
    const daily = demoDailySeries(symbol, dates, clock, cal);
    const bars = [];
    for (const d of dates) {
      const m = daily.meta[d];
      if (!m) continue;
      const sessionOpenUnix = cal.openUnix(d);
      const upto = d === clock.date ? Math.max(1, Math.min(m.sessionMin, clock.elapsed)) : m.sessionMin;
      let totW = 0; for (let k = 0; k < m.sessionMin; k++) totW += m.path.weights[k];
      const noise = mulberry32(hash32(symbol + '|v|' + d + '|' + interval));
      for (let a = 0; a < m.sessionMin; a += step) {
        if (a >= upto) break;                                  // bar has not started yet
        const b = Math.min(a + step, m.sessionMin, upto);      // partial last bar when in progress
        let hi = -Infinity, lo = Infinity, w = 0;
        for (let k = a; k <= b; k++) { const v = m.path.path[k]; if (v > hi) hi = v; if (v < lo) lo = v; }
        for (let k = a; k < b; k++) w += m.path.weights[k];
        const open = Math.exp(m.path.path[a]), close = Math.exp(m.path.path[b]);
        const wick = 1 + m.sigma * 0.015;
        bars.push({
          time: sessionOpenUnix + a * 60,
          open: priceRound(open),
          high: priceRound(Math.max(open, close, Math.exp(hi) * wick)),
          low: priceRound(Math.min(open, close, Math.exp(lo) / wick)),
          close: priceRound(close),
          volume: Math.max(cal === CRYPTO_CAL ? 1 : 100, Math.round(m.volume * (w / totW) * (0.8 + noise() * 0.4)))
        });
      }
    }
    return bars.slice(-limit);
  }

  /** Deterministic simulated bars. Same symbol + interval → same chart for every student. */
  function demo(symbol, interval, limit, nowMs) {
    symbol = normSymbol(symbol) || 'AAPL';
    interval = INTERVALS.includes(interval) ? interval : '1day';
    limit = clamp(Math.floor(+limit) || (interval === '1day' ? 400 : 390), 2, MAX_LIMIT);
    const bars = interval === '1day' ? demoDaily(symbol, limit, nowMs) : demoIntraday(symbol, interval, limit, nowMs);
    bars.source = 'demo';
    bars.symbol = symbol;
    bars.interval = interval;
    bars.kind = kindOf(symbol);
    return bars;
  }

  /**
   * Nudge the last bar as if a trade just printed (used for the "live-looking" demo ticker).
   * Mutates and returns `bars`. For intraday bars, rolls a new bar when the current one has elapsed
   * and the market is open (always, for crypto), so a chart left running behaves like a real one.
   */
  function demoTick(bars) {
    if (!bars || !bars.length) return bars;
    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2] : null;
    const intraday = typeof last.time === 'number';
    const step = intraday && prev ? Math.max(60, last.time - prev.time) : 0;
    const symbol = bars.symbol || 'AAPL';
    const profile = lookup(symbol);
    const cal = calendarFor(symbol);
    const tickSigma = (profile.vol / cal.sqrtDays) / Math.sqrt(cal.maxSessionMinutes) * 0.6;   // ~ a 40-second move
    const r = Math.random;
    const g = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    const now = Math.floor(Date.now() / 1000);
    const status = marketStatus(symbol);
    if (intraday && step && status.open && now >= last.time + step) {
      // Start a new bar aligned to the interval grid.
      const t = last.time + step * Math.floor((now - last.time) / step);
      const o = last.close;
      bars.push({ time: t, open: o, high: o, low: o, close: o, volume: 0 });
      return demoTick(bars);
    }
    const c = priceRound(Math.max(0.01, last.close * Math.exp(g * tickSigma)));
    last.close = c;
    if (c > last.high) last.high = c;
    if (c < last.low) last.low = c;
    last.volume = (last.volume || 0) + Math.round(profile.adv / cal.maxSessionMinutes / 20 * (0.5 + r()));
    return bars;
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                           */
  /* ------------------------------------------------------------------ */

  const DEFAULT_SETTINGS = { provider: 'demo', keys: { twelvedata: '', finnhub: '', alphavantage: '' }, autoFallback: true };

  function getSettings() {
    let s = store.get(SETTINGS_KEY, null);
    if (!s) {
      s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      // Migrate the v0.1 single Twelve Data key if one was saved.
      const old = store.get('bt.key', '');
      if (old && typeof old === 'string') { s.keys.twelvedata = old; s.provider = 'twelvedata'; }
    }
    const out = Object.assign({}, DEFAULT_SETTINGS, s);
    out.keys = Object.assign({}, DEFAULT_SETTINGS.keys, s.keys || {});
    if (!PROVIDER_LABEL[out.provider]) out.provider = 'demo';
    return out;
  }
  function setSettings(patch) {
    const cur = getSettings();
    patch = patch || {};
    const next = Object.assign({}, cur, patch);
    next.keys = Object.assign({}, cur.keys, patch.keys || {});
    Object.keys(next.keys).forEach(k => { next.keys[k] = String(next.keys[k] || '').trim(); });
    if (!PROVIDER_LABEL[next.provider]) next.provider = 'demo';
    store.set(SETTINGS_KEY, next);
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* Rate limiter (persisted so a page reload cannot burn the quota)    */
  /* ------------------------------------------------------------------ */

  function rateDayKey(provider, nowMs) {
    const zone = (RATE_LIMITS[provider] || RATE_LIMITS.demo).resetZone;
    if (zone === 'NY') return nyParts(nowMs).date;
    return new Date(nowMs).toISOString().slice(0, 10);
  }
  function rateLoad() { const s = store.get(RATE_KEY, null); return (s && typeof s === 'object') ? s : {}; }
  function rateSave(state) { store.set(RATE_KEY, state); }
  function rateEntry(state, provider, nowMs) {
    const day = rateDayKey(provider, nowMs);
    let e = state[provider];
    if (!e || e.day !== day) e = state[provider] = { day, count: 0, stamps: [] };
    e.stamps = (e.stamps || []).filter(t => nowMs - t < 60000);
    return e;
  }
  /** Can we make a request now? → {ok, reason, retryInMs} without consuming a credit. */
  function rateCheck(provider, nowMs) {
    nowMs = nowMs == null ? Date.now() : nowMs;
    const lim = RATE_LIMITS[provider] || RATE_LIMITS.demo;
    const state = rateLoad();
    const e = rateEntry(state, provider, nowMs);
    const label = PROVIDER_LABEL[provider] || provider;
    if (e.count >= lim.perDay) {
      return { ok: false, code: 'rate_limit', reason: label + ' daily free-tier limit (' + lim.perDay + ' requests) reached. Showing demo data until the quota resets.', retryInMs: 3600000 };
    }
    if (e.stamps.length >= lim.perMinute) {
      const retryInMs = 60000 - (nowMs - e.stamps[0]) + 250;
      return { ok: false, code: 'rate_limit', reason: label + ' per-minute limit (' + lim.perMinute + '/min) reached. Try again in ' + Math.ceil(retryInMs / 1000) + ' s.', retryInMs };
    }
    return { ok: true };
  }
  /** Consume one credit (call right before the request). */
  function rateTake(provider, nowMs) {
    nowMs = nowMs == null ? Date.now() : nowMs;
    const chk = rateCheck(provider, nowMs);
    if (!chk.ok) return chk;
    if (provider === 'demo') return chk;
    const state = rateLoad();
    const e = rateEntry(state, provider, nowMs);
    e.stamps.push(nowMs);
    e.count += 1;
    rateSave(state);
    return { ok: true };
  }
  function rateStatus(provider, nowMs) {
    nowMs = nowMs == null ? Date.now() : nowMs;
    provider = provider || getSettings().provider;
    const lim = RATE_LIMITS[provider] || RATE_LIMITS.demo;
    const e = rateEntry(rateLoad(), provider, nowMs);
    return { provider, minuteUsed: e.stamps.length, minuteLimit: lim.perMinute, dayUsed: e.count, dayLimit: lim.perDay, dayKey: e.day, resetZone: lim.resetZone };
  }

  /* ------------------------------------------------------------------ */
  /* Response cache (localStorage + memory)                             */
  /* ------------------------------------------------------------------ */

  const MAX_CACHE_ENTRIES = 48;
  let _mem = null;
  function cacheLoad() {
    if (_mem) return _mem;
    const c = store.get(CACHE_KEY, null);
    _mem = (c && typeof c === 'object' && c.entries) ? c : { entries: {} };
    return _mem;
  }
  function cacheSave() {
    const c = cacheLoad();
    const keys = Object.keys(c.entries);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys.sort((a, b) => c.entries[a].t - c.entries[b].t);
      keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach(k => { delete c.entries[k]; });
    }
    if (!store.set(CACHE_KEY, c)) {
      // Quota exceeded: drop the bulkiest half and retry once.
      keys.sort((a, b) => JSON.stringify(c.entries[b]).length - JSON.stringify(c.entries[a]).length);
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => { delete c.entries[k]; });
      store.set(CACHE_KEY, c);
    }
  }
  function cacheGet(key, allowStale) {
    const e = cacheLoad().entries[key];
    if (!e) return null;
    const age = Date.now() - e.t;
    if (!allowStale && age > e.ttl) return null;
    return { value: e.v, age, stale: age > e.ttl };
  }
  function cacheSet(key, value, ttl) {
    const c = cacheLoad();
    c.entries[key] = { t: Date.now(), ttl, v: value };
    cacheSave();
  }
  function clearCache() { _mem = { entries: {} }; store.del(CACHE_KEY); }

  /* ------------------------------------------------------------------ */
  /* HTTP helper                                                        */
  /* ------------------------------------------------------------------ */

  function redact(text, key) { return key ? String(text).split(key).join('***') : String(text); }

  async function getJSON(url, key, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new DataError('Request timed out', 'timeout');
      // fetch() throws a TypeError for network failure, CORS and CSP blocks.
      const err = new DataError(redact(e && e.message ? e.message : 'Network error', key), 'network');
      throw err;
    }
    if (timer) clearTimeout(timer);
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const err = new DataError('HTTP ' + res.status, res.status === 401 || res.status === 403 ? 'auth' : 'http', body);
      err.status = res.status;
      if (res.status === 429) { err.code = 'rate_limit'; err.message = 'The provider says we are sending requests too fast (HTTP 429).'; }
      throw err;
    }
    if (body == null) throw new DataError('Empty or non-JSON response', 'parse');
    return body;
  }
  function qs(params) {
    return Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  }
  function sortBars(bars) {
    bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    // De-duplicate on time (providers occasionally repeat the live bar).
    const out = [];
    for (const b of bars) { if (!out.length || out[out.length - 1].time !== b.time) out.push(b); else out[out.length - 1] = b; }
    return out;
  }
  function cleanBar(b) {
    if (!(b.open > 0) || !(b.close > 0)) return null;
    const high = Math.max(b.high || 0, b.open, b.close), low = Math.min(b.low || Infinity, b.open, b.close);
    return { time: b.time, open: +b.open, high: +high, low: +low, close: +b.close, volume: Math.max(0, Math.round(+b.volume || 0)) };
  }
  function keyFor(name) { return (getSettings().keys || {})[name] || ''; }

  /* ------------------------------------------------------------------ */
  /* Provider: demo                                                     */
  /* ------------------------------------------------------------------ */

  const demoProvider = {
    id: 'demo',
    label: PROVIDER_LABEL.demo,
    supports: { intervals: INTERVALS.slice(), realtime: false, search: true },
    async candles(symbol, interval, limit) { return demo(symbol, interval, limit); },
    async quote(symbol) {
      const bars = demo(symbol, '1min', 2);
      const last = bars[bars.length - 1];
      return { price: last.close, time: Math.floor(Date.now() / 1000), source: 'demo', symbol: normSymbol(symbol) };
    },
    async search(query) { return universeSearch(query); }
  };

  /* ------------------------------------------------------------------ */
  /* Provider: Twelve Data                                              */
  /* ------------------------------------------------------------------ */
  // Free plan: 8 requests/min, 800/day, real-time US stocks. Datetimes are exchange-local
  // (New York for US listings) so we convert with nyStringToUnix.

  const TD_BASE = 'https://api.twelvedata.com';
  function tdCheck(j) {
    if (j && j.status === 'error') {
      const code = +j.code;
      if (code === 401) throw new DataError(j.message || 'Invalid Twelve Data API key', 'auth');
      if (code === 429) throw new DataError('Twelve Data free-tier rate limit reached (8 requests/minute). ' + (j.message || ''), 'rate_limit');
      if (code === 400 || code === 404) throw new DataError(j.message || 'Symbol not found', 'symbol');
      throw new DataError(j.message || 'Twelve Data error ' + code, 'provider');
    }
    return j;
  }
  /** Twelve Data /time_series body → bars. Exposed for tests. */
  function parseTwelveData(j, interval, symbol, crypto) {
    const values = Array.isArray(j && j.values) ? j.values : [];
    if (!values.length) throw new DataError('Twelve Data returned no bars for ' + symbol, 'symbol');
    const daily = interval === '1day';
    const toUnix = crypto ? utcStringToUnix : nyStringToUnix;
    const bars = values.map(v => cleanBar({
      time: daily ? String(v.datetime).slice(0, 10) : toUnix(v.datetime),
      open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +v.volume || 0
    })).filter(Boolean);
    return sortBars(bars);
  }
  const twelvedataProvider = {
    id: 'twelvedata',
    label: PROVIDER_LABEL.twelvedata,
    supports: { intervals: INTERVALS.slice(), realtime: true, search: true },
    async candles(symbol, interval, limit, key) {
      key = key || keyFor('twelvedata');
      if (!key) throw new DataError('No Twelve Data API key', 'nokey');
      // Crypto pairs are spelled BTC/USD and their daily candles roll at 00:00 UTC, so ask for UTC timestamps.
      const crypto = isCrypto(symbol);
      const url = TD_BASE + '/time_series?' + qs({ symbol: providerSymbol('twelvedata', symbol), interval, outputsize: clamp(limit, 1, MAX_LIMIT), timezone: crypto ? 'UTC' : NY, order: 'ASC', apikey: key });
      const j = tdCheck(await getJSON(url, key));
      return parseTwelveData(j, interval, symbol, crypto);
    },
    async quote(symbol, key) {
      key = key || keyFor('twelvedata');
      if (!key) throw new DataError('No Twelve Data API key', 'nokey');
      const j = tdCheck(await getJSON(TD_BASE + '/price?' + qs({ symbol: providerSymbol('twelvedata', symbol), apikey: key }), key));
      const price = +j.price;
      if (!(price > 0)) throw new DataError('No price for ' + symbol, 'symbol');
      return { price, time: Math.floor(Date.now() / 1000), symbol: normSymbol(symbol), source: 'twelvedata' };
    },
    async search(query, key) {
      key = key || keyFor('twelvedata');
      if (!key) throw new DataError('No Twelve Data API key', 'nokey');
      const j = tdCheck(await getJSON(TD_BASE + '/symbol_search?' + qs({ symbol: query, outputsize: 30, apikey: key }), key));
      const rows = Array.isArray(j.data) ? j.data : [];
      const us = rows.filter(r => r.country === 'United States' || /NASDAQ|NYSE|AMEX|ARCA|BATS/i.test(r.exchange || ''));
      return (us.length ? us : rows).slice(0, 15).map(r => ({ symbol: r.symbol, name: r.instrument_name, exchange: r.exchange, type: r.instrument_type }));
    }
  };

  /* ------------------------------------------------------------------ */
  /* Provider: Finnhub                                                  */
  /* ------------------------------------------------------------------ */
  // Free plan: 60 requests/min, real-time US quotes. Historical candles need a paid plan — if
  // /stock/candle is refused we hand back demo candles re-anchored to the live quote.

  const FH_BASE = 'https://finnhub.io/api/v1';
  const FH_RESOLUTION = { '1day': 'D', '1h': '60', '15min': '15', '5min': '5', '1min': '1' };
  const FH_PAID_PLAN_REASON = 'Finnhub historical candles require a paid plan. Showing simulated history anchored to the live Finnhub quote.';
  let _fhCandlesDeniedKey = null;              // key that got HTTP 403 on /stock/candle this session (free plan)

  /**
   * Unix [from, to] window that holds at least `limit` bars, counted in trading sessions rather than wall-clock
   * time, so weekends, overnight gaps and NYSE holidays never shrink the result. Starts at 4:00 ET (pre-market)
   * on the first session and pads by one extra session for safety.
   */
  function finnhubWindow(interval, limit, nowMs, symbol) {
    const now = nowMs == null ? Date.now() : nowMs;
    const step = INTERVAL_SECONDS[interval];
    const cal = calendarFor(symbol || 'AAPL');
    const perSession = interval === '1day' ? 1 : Math.ceil(cal.maxSessionMinutes / (step / 60));
    const sessions = interval === '1day' ? limit : Math.ceil(limit / perSession) + 1;
    if (cal.always) {
      // Crypto: every calendar day is a session and the day starts at 00:00 UTC.
      const firstDay = calendarDays(unixToUtcDate(Math.floor(now / 1000)), sessions + 1)[0];
      return { from: dateToSerial(firstDay) * 86400, to: Math.floor(now / 1000) };
    }
    const first = tradingDays(nyParts(now).date, sessions + 1)[0];
    const from = nyToUnix(+first.slice(0, 4), +first.slice(5, 7), +first.slice(8, 10), 4, 0, 0);
    return { from, to: Math.floor(now / 1000) };
  }
  /** Finnhub /stock/candle or /crypto/candle body ({t,o,h,l,c,v,s}) → bars. Exposed for tests. */
  function parseFinnhubCandles(j, interval, crypto) {
    if (!j || j.s === 'no_data' || !Array.isArray(j.t) || !j.t.length) return [];
    const daily = interval === '1day';
    const toDate = crypto ? unixToUtcDate : unixToNyDate;
    const bars = j.t.map((t, i) => cleanBar({
      time: daily ? toDate(+t) : +t,
      open: j.o[i], high: j.h[i], low: j.l[i], close: j.c[i], volume: j.v ? j.v[i] : 0
    })).filter(Boolean);
    return sortBars(bars);
  }
  const finnhubProvider = {
    id: 'finnhub',
    label: PROVIDER_LABEL.finnhub,
    supports: { intervals: INTERVALS.slice(), realtime: true, search: true, candlesMayRequirePaidPlan: true },
    async candles(symbol, interval, limit, key) {
      key = key || keyFor('finnhub');
      if (!key) throw new DataError('No Finnhub API key', 'nokey');
      if (_fhCandlesDeniedKey === key) {
        // This key was already refused on /stock/candle this session — do not burn another request on it.
        return finnhubDemoWithLiveQuote(symbol, interval, limit, key, FH_PAID_PLAN_REASON);
      }
      const crypto = isCrypto(symbol);
      const { from, to } = finnhubWindow(interval, limit, null, symbol);
      const endpoint = crypto ? '/crypto/candle' : '/stock/candle';
      let j;
      try {
        j = await getJSON(FH_BASE + endpoint + '?' + qs({ symbol: providerSymbol('finnhub', symbol), resolution: FH_RESOLUTION[interval], from, to, token: key }), key);
      } catch (e) {
        if (e.code === 'auth' && e.status === 403) {
          _fhCandlesDeniedKey = key;
          return finnhubDemoWithLiveQuote(symbol, interval, limit, key, FH_PAID_PLAN_REASON);
        }
        throw e;
      }
      if (j.error) throw new DataError(j.error, /key|auth|token/i.test(j.error) ? 'auth' : 'provider');
      const bars = parseFinnhubCandles(j, interval, crypto);
      if (!bars.length) {
        return finnhubDemoWithLiveQuote(symbol, interval, limit, key, 'Finnhub returned no candles for ' + symbol + '. Showing simulated history anchored to the live quote.');
      }
      return bars.slice(-limit);
    },
    async quote(symbol, key) {
      key = key || keyFor('finnhub');
      if (!key) throw new DataError('No Finnhub API key', 'nokey');
      if (isCrypto(symbol)) {
        // Finnhub's /quote endpoint is stocks-only; the latest 1-minute crypto candle is the live price.
        const to = Math.floor(Date.now() / 1000);
        const j = await getJSON(FH_BASE + '/crypto/candle?' + qs({ symbol: providerSymbol('finnhub', symbol), resolution: '1', from: to - 15 * 60, to, token: key }), key);
        if (j.error) throw new DataError(j.error, 'auth');
        const bars = parseFinnhubCandles(j, '1min', true);
        if (!bars.length) throw new DataError('Finnhub has no recent trades for ' + symbol, 'symbol');
        const last = bars[bars.length - 1];
        return { price: last.close, time: last.time, symbol: normSymbol(symbol), source: 'finnhub', open: last.open, high: last.high, low: last.low, kind: 'crypto' };
      }
      const j = await getJSON(FH_BASE + '/quote?' + qs({ symbol, token: key }), key);
      if (j.error) throw new DataError(j.error, 'auth');
      const price = +j.c;
      if (!(price > 0)) throw new DataError('Finnhub has no quote for ' + symbol + ' (unknown symbol?)', 'symbol');
      return {
        price, time: +j.t || Math.floor(Date.now() / 1000), symbol: normSymbol(symbol), source: 'finnhub',
        open: +j.o, high: +j.h, low: +j.l, prevClose: +j.pc, change: +j.d, changePct: +j.dp
      };
    },
    async search(query, key) {
      key = key || keyFor('finnhub');
      if (!key) throw new DataError('No Finnhub API key', 'nokey');
      const j = await getJSON(FH_BASE + '/search?' + qs({ q: query, token: key }), key);
      if (j.error) throw new DataError(j.error, 'auth');
      const rows = Array.isArray(j.result) ? j.result : [];
      return rows
        .filter(r => !/\.|:/.test(r.symbol || '') || /^BRK\./.test(r.symbol))   // keep US-style tickers first
        .slice(0, 15)
        .map(r => ({ symbol: r.displaySymbol || r.symbol, name: r.description, exchange: 'US', type: r.type }));
    }
  };
  async function finnhubDemoWithLiveQuote(symbol, interval, limit, key, reason) {
    const bars = demo(symbol, interval, limit);
    // The quote is a real Finnhub request, so it goes through the same 15 s cache and the 60/min meter as
    // BT.data.quote() — otherwise every chart refresh on the free plan would cost two un-counted calls.
    const qk = 'q|finnhub|' + normSymbol(symbol);
    let q = null;
    const hit = cacheGet(qk);
    if (hit && hit.value && hit.value.price > 0) {
      q = Object.assign({}, hit.value, { cached: true, ageMs: hit.age });
    } else if (rateTake('finnhub').ok) {
      try {
        q = await finnhubProvider.quote(symbol, key);
        cacheSet(qk, Object.assign({ live: true }, q), TTL.quote);
      } catch (e) { q = null; }
    } else {
      const stale = cacheGet(qk, true);
      if (stale && stale.value && stale.value.price > 0) q = Object.assign({}, stale.value, { cached: true, stale: true, ageMs: stale.age });
    }
    if (q && q.price > 0) {
      // Rescale the simulated history so it ends at today's real price.
      const ratio = q.price / bars[bars.length - 1].close;
      for (const b of bars) { b.open = priceRound(b.open * ratio); b.high = priceRound(b.high * ratio); b.low = priceRound(b.low * ratio); b.close = priceRound(b.close * ratio); }
      const last = bars[bars.length - 1];
      last.close = q.price; if (q.price > last.high) last.high = q.price; if (q.price < last.low) last.low = q.price;
      bars.quote = q;
      bars.anchoredToLiveQuote = true;
    }
    bars.fallback = true;
    bars.reason = reason + (q ? '' : ' (live quote also unavailable).');
    bars.source = 'demo';
    return bars;
  }

  /* ------------------------------------------------------------------ */
  /* Provider: Alpha Vantage                                            */
  /* ------------------------------------------------------------------ */
  // Free plan: 25 requests/day (and 5/min). Intraday timestamps are US/Eastern and mark the END of
  // each bar, so we shift them back one interval to match the open-time convention used elsewhere.

  const AV_BASE = 'https://www.alphavantage.co/query';
  const AV_INTERVAL = { '1h': '60min', '15min': '15min', '5min': '5min', '1min': '1min' };
  function avCheck(j) {
    if (!j || typeof j !== 'object') throw new DataError('Empty response from Alpha Vantage', 'parse');
    const em = j['Error Message'];
    if (em) {
      // A bad key also arrives as "Error Message" ("the parameter apikey is invalid or missing").
      if (/apikey|api key/i.test(em)) throw new DataError('Alpha Vantage: ' + em, 'auth');
      throw new DataError('Alpha Vantage: ' + em, 'symbol');
    }
    const note = j['Note'] || j['Information'];
    if (note) {
      if (/premium endpoint|premium member|premium plan/i.test(note)) throw new DataError('Alpha Vantage: this endpoint needs a paid plan. ' + note, 'plan');
      if (/per day|per minute|rate limit|requests|call frequency|higher api call/i.test(note)) throw new DataError('Alpha Vantage free-tier limit reached (25 requests per day). ' + note, 'rate_limit');
      throw new DataError('Alpha Vantage: ' + note, 'provider');
    }
    return j;
  }
  /** Alpha Vantage spells share classes with a dash (BRK-B), while the universe and other providers use BRK.B. */
  function avSymbol(symbol) { return providerSymbol('alphavantage', symbol); }
  function avSeries(j) {
    const k = Object.keys(j).find(x => /^Time Series/.test(x) || /^Weekly|^Monthly/.test(x));
    return k ? j[k] : null;
  }
  /**
   * Pick a field out of an Alpha Vantage OHLCV row by its number prefix. Stock rows are '1. open' … '5. volume'.
   * DIGITAL_CURRENCY_DAILY rows have been published in two shapes: the current one ('1. open', '2. high', '3. low',
   * '4. close', '5. volume') and the older one with a market suffix and a USD twin ('1a. open (USD)', '1b. open (USD)',
   * …, '5. volume', '6. market cap (USD)'). We accept either, preferring the (USD)-suffixed twin when present.
   */
  function avField(row, n, name) {
    const keys = Object.keys(row);
    const re = new RegExp('^' + n + '[ab]?\\.\\s*' + name + '\\b', 'i');
    const matches = keys.filter(k => re.test(k));
    if (!matches.length) return NaN;
    const usd = matches.find(k => /\(USD\)/i.test(k));
    return +row[usd || matches[0]];
  }
  /**
   * Alpha Vantage daily/intraday series (stocks) or DIGITAL_CURRENCY_DAILY (crypto) → bars. Intraday stock timestamps
   * mark the END of each bar in US/Eastern, so they are shifted back one interval; daily keys are plain dates.
   * Exposed for tests.
   */
  function parseAlphaVantage(j, interval, symbol) {
    const series = avSeries(j);
    if (!series) throw new DataError('Alpha Vantage returned no bars for ' + symbol, 'symbol');
    const daily = interval === '1day';
    const step = INTERVAL_SECONDS[interval];
    const bars = Object.keys(series).map(ts => {
      const v = series[ts];
      return cleanBar({
        time: daily ? ts.slice(0, 10) : nyStringToUnix(ts) - step,
        open: avField(v, 1, 'open'), high: avField(v, 2, 'high'), low: avField(v, 3, 'low'), close: avField(v, 4, 'close'),
        volume: avField(v, 5, 'volume') || avField(v, 6, 'volume') || 0
      });
    }).filter(Boolean);
    return sortBars(bars);
  }
  const alphavantageProvider = {
    id: 'alphavantage',
    label: PROVIDER_LABEL.alphavantage,
    supports: { intervals: INTERVALS.slice(), realtime: false, search: true, cryptoIntervals: ['1day'] },
    async candles(symbol, interval, limit, key) {
      key = key || keyFor('alphavantage');
      if (!key) throw new DataError('No Alpha Vantage API key', 'nokey');
      const daily = interval === '1day';
      if (isCrypto(symbol)) {
        // Free plan: DIGITAL_CURRENCY_DAILY only. CRYPTO_INTRADAY is a premium endpoint, so say so instead of burning
        // one of the 25 daily requests on a call that cannot succeed.
        if (!daily) throw new DataError('Alpha Vantage only offers daily crypto candles on the free plan (CRYPTO_INTRADAY is a premium endpoint). Showing simulated ' + interval + ' bars.', 'plan');
        const p = parseSymbol(symbol);
        const j = avCheck(await getJSON(AV_BASE + '?' + qs({ function: 'DIGITAL_CURRENCY_DAILY', symbol: p.base, market: p.quote, apikey: key }), key));
        return parseAlphaVantage(j, interval, symbol).slice(-limit);
      }
      const params = daily
        ? { function: 'TIME_SERIES_DAILY', symbol: avSymbol(symbol), outputsize: limit > 100 ? 'full' : 'compact', apikey: key }
        : { function: 'TIME_SERIES_INTRADAY', symbol: avSymbol(symbol), interval: AV_INTERVAL[interval], outputsize: limit > 100 ? 'full' : 'compact', extended_hours: 'false', apikey: key };
      const j = avCheck(await getJSON(AV_BASE + '?' + qs(params), key));
      return parseAlphaVantage(j, interval, symbol).slice(-limit);
    },
    async quote(symbol, key) {
      key = key || keyFor('alphavantage');
      if (!key) throw new DataError('No Alpha Vantage API key', 'nokey');
      if (isCrypto(symbol)) {
        const p = parseSymbol(symbol);
        const j = avCheck(await getJSON(AV_BASE + '?' + qs({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: p.base, to_currency: p.quote, apikey: key }), key));
        return parseAlphaVantageRate(j, symbol);
      }
      const j = avCheck(await getJSON(AV_BASE + '?' + qs({ function: 'GLOBAL_QUOTE', symbol: avSymbol(symbol), apikey: key }), key));
      const g = j['Global Quote'] || {};
      const price = +g['05. price'];
      if (!(price > 0)) throw new DataError('Alpha Vantage has no quote for ' + symbol, 'symbol');
      const day = g['07. latest trading day'];
      const time = day ? nyToUnix(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 16, 0, 0) : Math.floor(Date.now() / 1000);
      return { price, time, symbol: normSymbol(symbol), source: 'alphavantage', open: +g['02. open'], high: +g['03. high'], low: +g['04. low'], prevClose: +g['08. previous close'], latestTradingDay: day };
    },
    async search(query, key) {
      key = key || keyFor('alphavantage');
      if (!key) throw new DataError('No Alpha Vantage API key', 'nokey');
      const j = avCheck(await getJSON(AV_BASE + '?' + qs({ function: 'SYMBOL_SEARCH', keywords: query, apikey: key }), key));
      const rows = Array.isArray(j.bestMatches) ? j.bestMatches : [];
      return rows.filter(r => (r['4. region'] || '') === 'United States' || !/\./.test(r['1. symbol'] || ''))
        .slice(0, 15).map(r => ({ symbol: r['1. symbol'], name: r['2. name'], exchange: r['4. region'] === 'United States' ? 'US' : r['4. region'], type: r['3. type'] }));
    }
  };

  /** CURRENCY_EXCHANGE_RATE body → quote. Exposed for tests. */
  function parseAlphaVantageRate(j, symbol) {
    const r = (j && j['Realtime Currency Exchange Rate']) || {};
    const price = +r['5. Exchange Rate'];
    if (!(price > 0)) throw new DataError('Alpha Vantage has no exchange rate for ' + symbol, 'symbol');
    const ts = r['6. Last Refreshed'];
    const time = ts ? (utcStringToUnix(ts) || Math.floor(Date.now() / 1000)) : Math.floor(Date.now() / 1000);
    const out = { price, time, symbol: normSymbol(symbol), source: 'alphavantage', kind: 'crypto' };
    if (+r['8. Bid Price'] > 0) out.bid = +r['8. Bid Price'];
    if (+r['9. Ask Price'] > 0) out.ask = +r['9. Ask Price'];
    return out;
  }

  const providers = { demo: demoProvider, twelvedata: twelvedataProvider, finnhub: finnhubProvider, alphavantage: alphavantageProvider };

  /* ------------------------------------------------------------------ */
  /* Facade: provider selection, cache, rate limiting, demo fallback    */
  /* ------------------------------------------------------------------ */

  function tagBars(bars, props) { Object.assign(bars, props); return bars; }
  function cloneBars(bars) { return bars.map(b => Object.assign({}, b)); }
  function fallbackBars(symbol, interval, limit, reason, extra) {
    const bars = demo(symbol, interval, limit);
    return tagBars(bars, Object.assign({ fallback: true, reason, source: 'demo', fetchedAt: Date.now() }, extra || {}));
  }

  /** Resolve the active provider for live requests. Returns {name, provider, key, why} where `why` explains a forced demo. */
  function activeProvider() {
    const s = getSettings();
    const name = providers[s.provider] ? s.provider : 'demo';
    if (name === 'demo') return { name, provider: providers.demo, key: '', why: null };
    const key = s.keys[name] || '';
    if (!key) return { name, provider: providers[name], key: '', why: 'No ' + PROVIDER_LABEL[name] + ' API key saved. Add a free key in Live data settings to see real prices; until then the chart is simulated.' };
    return { name, provider: providers[name], key, why: null };
  }

  /**
   * Bars for `symbol` at `interval`, newest last. Live when a provider + key are configured;
   * otherwise (or on any failure) demo bars with `fallback:true` and a `reason`.
   */
  async function candles(symbol, interval, limit) {
    symbol = normSymbol(symbol);
    interval = INTERVALS.includes(interval) ? interval : '1day';
    limit = clamp(Math.floor(+limit) || (interval === '1day' ? 400 : 390), 2, MAX_LIMIT);
    if (!symbol) throw new DataError('A symbol is required', 'input');

    const ap = activeProvider();
    if (ap.name === 'demo') return tagBars(demo(symbol, interval, limit), { fetchedAt: Date.now() });
    if (ap.why) return fallbackBars(symbol, interval, limit, ap.why, { code: 'nokey' });
    if (!ap.provider.supports.intervals.includes(interval)) {
      return fallbackBars(symbol, interval, limit, PROVIDER_LABEL[ap.name] + ' does not offer ' + interval + ' bars on the free plan.', { code: 'interval' });
    }
    const cryptoIntervals = ap.provider.supports.cryptoIntervals;
    if (isCrypto(symbol) && Array.isArray(cryptoIntervals) && !cryptoIntervals.includes(interval)) {
      // e.g. Alpha Vantage: CRYPTO_INTRADAY is premium. Decide here so no rate-limit credit is spent on it.
      return fallbackBars(symbol, interval, limit, PROVIDER_LABEL[ap.name] + ' only offers ' + cryptoIntervals.join('/') + ' crypto candles on the free plan; ' + interval + ' bars are simulated.', { code: 'interval' });
    }

    const ttl = interval === '1day' ? TTL.daily : TTL.intraday;
    const ck = 'c|' + ap.name + '|' + symbol + '|' + interval + '|' + limit;
    const hit = cacheGet(ck);
    if (hit) return tagBars(cloneBars(hit.value), { symbol, interval, source: ap.name, live: true, cached: true, ageMs: hit.age, fetchedAt: Date.now() - hit.age });

    if (ap.name === 'finnhub' && _fhCandlesDeniedKey === ap.key) {
      // Free Finnhub plan: /stock/candle already answered 403 this session. Go straight to the quote-anchored
      // demo (which meters its own quote request) instead of spending a rate token on a doomed call.
      const bars = await finnhubDemoWithLiveQuote(symbol, interval, limit, ap.key, FH_PAID_PLAN_REASON);
      return tagBars(bars, { fetchedAt: Date.now(), provider: ap.name });
    }

    const rc = rateTake(ap.name);
    if (!rc.ok) {
      const stale = cacheGet(ck, true);
      if (stale) return tagBars(cloneBars(stale.value), { symbol, interval, source: ap.name, live: true, cached: true, stale: true, ageMs: stale.age, reason: rc.reason, fetchedAt: Date.now() - stale.age });
      return fallbackBars(symbol, interval, limit, rc.reason, { code: 'rate_limit', retryInMs: rc.retryInMs });
    }
    try {
      const bars = await ap.provider.candles(symbol, interval, limit, ap.key);
      if (!bars || !bars.length) throw new DataError('No bars returned for ' + symbol, 'symbol');
      if (bars.fallback) {                                        // provider-level fallback (e.g. Finnhub candles)
        return tagBars(bars, { fetchedAt: Date.now(), provider: ap.name });
      }
      cacheSet(ck, bars, ttl);
      return tagBars(cloneBars(bars), { source: ap.name, live: true, cached: false, fetchedAt: Date.now(), symbol, interval });
    } catch (e) {
      const stale = cacheGet(ck, true);
      const reason = explainError(e, ap.name);
      if (stale) return tagBars(cloneBars(stale.value), { symbol, interval, source: ap.name, live: true, cached: true, stale: true, ageMs: stale.age, reason, fetchedAt: Date.now() - stale.age });
      return fallbackBars(symbol, interval, limit, reason, { code: e && e.code, error: e });
    }
  }

  /** Latest price → {price, time}. Cached 15 s. Falls back to the demo series with `fallback:true`. */
  async function quote(symbol) {
    symbol = normSymbol(symbol);
    if (!symbol) throw new DataError('A symbol is required', 'input');
    const ap = activeProvider();
    const demoQuote = async (reason, extra) => Object.assign(await providers.demo.quote(symbol), { fallback: true, reason }, extra || {});
    if (ap.name === 'demo') return providers.demo.quote(symbol);
    if (ap.why) return demoQuote(ap.why, { code: 'nokey' });
    const ck = 'q|' + ap.name + '|' + symbol;
    const hit = cacheGet(ck);
    if (hit) return Object.assign({}, hit.value, { cached: true, ageMs: hit.age });
    const rc = rateTake(ap.name);
    if (!rc.ok) {
      const stale = cacheGet(ck, true);
      if (stale) return Object.assign({}, stale.value, { cached: true, stale: true, ageMs: stale.age, reason: rc.reason });
      return demoQuote(rc.reason, { code: 'rate_limit', retryInMs: rc.retryInMs });
    }
    try {
      const q = await ap.provider.quote(symbol, ap.key);
      q.live = true;
      cacheSet(ck, q, TTL.quote);
      return Object.assign({}, q);
    } catch (e) {
      const stale = cacheGet(ck, true);
      const reason = explainError(e, ap.name);
      if (stale) return Object.assign({}, stale.value, { cached: true, stale: true, ageMs: stale.age, reason });
      return demoQuote(reason, { code: e && e.code });
    }
  }

  /** Symbol search. Always includes matches from the built-in universe; live providers extend the list. */
  async function search(query) {
    const local = universeSearch(query);
    const ap = activeProvider();
    if (ap.name === 'demo' || ap.why || !String(query || '').trim()) return local;
    const ck = 's|' + ap.name + '|' + String(query).trim().toUpperCase();
    const hit = cacheGet(ck);
    let remote = hit ? hit.value : null;
    if (!remote) {
      const rc = rateTake(ap.name);
      if (!rc.ok) return tagBars(local, { fallback: true, reason: rc.reason });
      try {
        remote = await ap.provider.search(query, ap.key);
        cacheSet(ck, remote, TTL.daily);
      } catch (e) {
        return tagBars(local, { fallback: true, reason: explainError(e, ap.name) });
      }
    }
    const seen = new Set(local.map(r => r.symbol));
    const merged = local.slice();
    for (const r of remote) { if (r && r.symbol && !seen.has(r.symbol)) { seen.add(r.symbol); merged.push(r); } }
    return merged.slice(0, 20);
  }

  /** Summary for a settings panel: which provider, whether a key is saved, and quota usage. */
  function status() {
    const s = getSettings();
    const name = providers[s.provider] ? s.provider : 'demo';
    return {
      provider: name,
      label: PROVIDER_LABEL[name],
      hasKey: name === 'demo' ? true : !!(s.keys[name]),
      live: name !== 'demo' && !!(s.keys[name]),
      supports: providers[name].supports,
      rate: rateStatus(name),
      limits: RATE_LIMITS[name],
      market: marketStatus()
    };
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                         */
  /* ------------------------------------------------------------------ */

  BT.data = {
    // contract surface
    providers,
    candles,
    quote,
    search,
    getSettings,
    setSettings,
    demo,
    demoTick,
    marketStatus,
    universe: UNIVERSE,
    // helpers other modules may use
    INTERVALS,
    INTERVAL_SECONDS,
    PROVIDER_LABEL,
    RATE_LIMITS,
    KIND_LABEL,
    DataError,
    lookup,
    universeSearch,
    // v0.4: asset kinds (stock | etf | crypto)
    kindOf,
    isCrypto,
    parseSymbol,
    providerSymbol,
    normSymbol,
    universeByKind(kind) { return UNIVERSE.filter(u => u.kind === kind); },
    calendarFor,
    status,
    rateStatus,
    rateCheck,
    clearCache,
    explainError,
    calendar: {
      holidays, earlyCloses, holidayName, isEarlyClose, isTradingDay, prevTradingDay, nextTradingDay, tradingDays, tradingDaysBetween, addDays, weekday
    },
    time: { nyParts, nyToUnix, nyStringToUnix, unixToNyDate, unixToUtcDate, utcStringToUnix, NY },
    _internal: {
      hash32, mulberry32, dayCore, sessionPath, demoClock, cacheGet, cacheSet, rateTake,
      EQUITY_CAL, CRYPTO_CAL, finnhubWindow,
      parseTwelveData, parseFinnhubCandles, parseAlphaVantage, parseAlphaVantageRate, avField
    }
  };
})();
