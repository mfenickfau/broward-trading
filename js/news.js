/* Broward Trading — js/news.js → BT.news (v0.3)
 *
 * Company profile, key statistics, earnings calendar and headlines for news.html.
 *
 *   BT.news.source()                      which provider/key can serve fundamentals right now
 *   BT.news.load(symbol, opts)            Promise → {symbol, provider, profile, stats, news, earnings, prompts, errors, requests}
 *   BT.news.loadNews / loadEarnings       the two "on demand" halves (Alpha Vantage users pay 1 request each)
 *   BT.news.normalizeProfile(provider, raw) / normalizeNews / normalizeEarnings   pure adapters
 *   BT.news.classifyHeadline(text)        'earnings' | 'guidance' | 'analyst' | 'product' | 'legal' | 'deal' | 'macro' | 'insider' | 'other'
 *   BT.news.whatMovedIt({news, earnings, bars, now})   educational prompts (questions, never claims)
 *   BT.news.EXPLAINERS / TOOLTIPS         the copy used by the no-key state and the stat tooltips
 *   BT.news.fmt                           big(), pct(), relTime(), dateLabel(), num()
 *
 * Providers: Finnhub (/stock/profile2, /stock/metric, /company-news, /calendar/earnings) and
 * Alpha Vantage (OVERVIEW, plus EARNINGS and NEWS_SENTIMENT on demand). Twelve Data has no free
 * fundamentals endpoint, so a Twelve Data-only setup is treated as "no key" here and the page
 * explains that honestly. Nothing is ever invented: demo mode shows explainers, not numbers.
 *
 * Rate limits go through BT.data's persisted limiter (rateCheck + _internal.rateTake) when
 * data.js is loaded; otherwise a small local limiter with the same free-tier numbers is used.
 * Responses are cached in localStorage 'bt.news.cache' (profile 24 h, stats 6 h, earnings 6 h,
 * news 10 min) so reloading the page never costs a second request.
 *
 * Plain ES2020, no imports, no DOM access. Loadable standalone and in Node (tests/news.test.js).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (root.BT && root.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */

  var CACHE_KEY = 'bt.news.cache';
  var LOCAL_RATE_KEY = 'bt.news.rate';
  var MAX_CACHE = 40;
  var FH_BASE = 'https://finnhub.io/api/v1';
  var AV_BASE = 'https://www.alphavantage.co/query';
  var NEWS_DAYS = 14;              // Finnhub company-news window
  var EARN_PAST_DAYS = 400;        // ~ 4 quarters back …
  var EARN_FUTURE_DAYS = 120;      // … and the next one or two ahead
  var MAX_NEWS = 40;

  var TTL = { profile: 24 * 3600e3, stats: 6 * 3600e3, earnings: 6 * 3600e3, news: 10 * 60e3 };

  var PROVIDER_LABEL = { finnhub: 'Finnhub', alphavantage: 'Alpha Vantage', twelvedata: 'Twelve Data', demo: 'Demo (simulated)' };
  var LOCAL_LIMITS = { finnhub: { perMinute: 60, perDay: Infinity }, alphavantage: { perMinute: 5, perDay: 25 } };

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                    */
  /* ------------------------------------------------------------------ */

  var store = {
    get: function (k, d) { try { var v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  var _clock = function () { return Date.now(); };
  function now() { return _clock(); }
  function normSymbol(s) { return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  /** Parse a provider number: strings, "None", "-", "" and nulls all become null. */
  function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s || /^(none|null|n\/a|na|-|—)$/i.test(s)) return null;
    var n = parseFloat(s.replace(/[,$%]/g, ''));
    return isFinite(n) ? n : null;
  }
  function str(v) { if (v == null) return ''; var s = String(v).trim(); return /^(none|null|n\/a)$/i.test(s) ? '' : s; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function qs(params) {
    return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  }
  function redact(text, key) { return key ? String(text).split(key).join('***') : String(text); }

  function NewsError(message, code, detail) {
    var e = new Error(message); e.name = 'NewsError'; e.code = code || 'error'; if (detail !== undefined) e.detail = detail; return e;
  }

  /* ------------------------------------------------------------------ */
  /* Formatting helpers (shared with the page)                          */
  /* ------------------------------------------------------------------ */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var fmt = {
    /** 2950000000000 → "$2.95T"; 48000000 → "$48.0M". `unit` defaults to "$"; pass '' for share counts. */
    big: function (v, unit) {
      if (!isNum(v)) return '—';
      unit = unit == null ? '$' : unit;
      var a = Math.abs(v), sign = v < 0 ? '−' : '';
      var tiers = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
      for (var i = 0; i < tiers.length; i++) {
        if (a >= tiers[i][0]) { var x = a / tiers[i][0]; return sign + unit + (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + tiers[i][1]; }
      }
      return sign + unit + (a >= 100 ? a.toFixed(0) : a.toFixed(2));
    },
    num: function (v, dp) {
      if (!isNum(v)) return '—';
      if (dp == null) dp = Math.abs(v) >= 100 ? 0 : 2;
      return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    },
    /** 0.0052 (fraction) → "0.52%". `v` is a fraction unless `alreadyPct` is true. */
    pct: function (v, alreadyPct, dp) {
      if (!isNum(v)) return '—';
      var p = alreadyPct ? v : v * 100;
      if (dp == null) dp = Math.abs(p) >= 10 ? 1 : 2;
      return (p < 0 ? '−' : '') + Math.abs(p).toFixed(dp) + '%';
    },
    signedPct: function (v, dp) {
      if (!isNum(v)) return '—';
      if (dp == null) dp = Math.abs(v) >= 10 ? 1 : 2;
      return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
    },
    money: function (v, dp) { if (!isNum(v)) return '—'; return (v < 0 ? '−' : '') + '$' + fmt.num(Math.abs(v), dp == null ? 2 : dp); },
    /** unix seconds → "3 min ago" / "2 h ago" / "Yesterday" / "Mar 4". */
    relTime: function (unixSec, nowMs) {
      if (!isNum(unixSec)) return '';
      var ms = unixSec * 1000, diff = (nowMs == null ? now() : nowMs) - ms;
      if (diff < 0) diff = 0;
      var m = Math.floor(diff / 60000);
      if (m < 1) return T('just now');
      if (m < 60) return T('{n} min ago', { n: m });
      var h = Math.floor(m / 60);
      if (h < 24) return T('{n} h ago', { n: h });
      var d = Math.floor(h / 24);
      if (d === 1) return T('Yesterday');
      if (d < 7) return T('{n} days ago', { n: d });
      var dt = new Date(ms);
      return MONTHS[dt.getMonth()] + ' ' + dt.getDate() + (dt.getFullYear() !== new Date(nowMs == null ? now() : nowMs).getFullYear() ? ', ' + dt.getFullYear() : '');
    },
    /** 'YYYY-MM-DD' → "Mar 4, 2026" (year only when it differs from this year). */
    dateLabel: function (iso, nowMs) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      if (!m) return String(iso || '—');
      var y = +m[1], thisYear = new Date(nowMs == null ? now() : nowMs).getFullYear();
      return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + (y !== thisYear ? ', ' + y : '');
    },
    /** Days from `nowMs` to an ISO date: negative = past. */
    daysUntil: function (iso, nowMs) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      if (!m) return null;
      var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      var today = (nowMs == null ? now() : nowMs);
      var td = Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), new Date(today).getUTCDate());
      return Math.round((t - td) / 86400000);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Educational copy                                                   */
  /* ------------------------------------------------------------------ */

  /** Long-form explainers shown in the no-key state (and behind "Learn more" with a key). */
  var EXPLAINERS = [
    {
      id: 'news', term: 'Company news',
      short: 'Headlines about a company from wire services and financial press, with the source and time.',
      long: 'Prices move when new information arrives. A headline is only "news" to the market if it changes what investors expect: a surprise product delay matters, a scheduled press release usually does not. Read the source and the time stamp first. Wire services (Reuters, AP, Bloomberg) report facts fast; blogs and aggregators add opinion. Ask: is this new, is it material, and had the price already moved before I read it?',
      example: 'A chipmaker announces a recall at 7:05 a.m. The stock opens 6% lower. The move happened at the open; by the time you read it at lunch, the information is already in the price.',
      why: 'Traders use news to explain a move they see on the chart ("what moved it?") and to know when a scheduled event could make a position riskier than usual.'
    },
    {
      id: 'earnings', term: 'Earnings report',
      short: 'Every quarter a public company reports revenue and profit. Dates are scheduled; results are not.',
      long: 'US public companies publish quarterly results (10-Q) and an annual report (10-K). Analysts publish estimates beforehand; the gap between the estimate and the actual number is the "surprise". Stocks often gap up or down on the next open because the result changes expectations for the future. Reports land either before the market opens (BMO) or after the close (AMC), so the first reaction usually happens when you cannot trade.',
      example: 'Analysts expect EPS of $1.20. The company reports $1.35 (a +12.5% surprise) but guides next quarter lower. The stock falls anyway: the market cares about the future more than the past.',
      why: 'Holding a position through earnings means accepting a gap risk that stop orders cannot protect against. Many traders reduce size or stay flat around the date.'
    },
    {
      id: 'eps', term: 'EPS (earnings per share)',
      short: 'Net profit divided by the number of shares. The "per share" slice of the company\'s profit.',
      long: 'EPS = net income ÷ weighted average shares outstanding. It is reported per quarter and summed over four quarters as "trailing twelve months" (TTM). Companies also publish an "adjusted" EPS that removes one-off items; analysts usually estimate the adjusted figure, so compare like with like. A higher EPS is not automatically better: a company can raise EPS by buying back shares without earning a dollar more.',
      example: 'Net income $10B, 4B shares → EPS $2.50. If the company buys back 10% of its shares, the same $10B becomes EPS $2.78.',
      why: 'EPS is the denominator of the P/E ratio and the number that earnings "beats" and "misses" refer to.'
    },
    {
      id: 'pe', term: 'P/E ratio (price to earnings)',
      short: 'Share price divided by EPS: how many dollars you pay for one dollar of annual profit.',
      long: 'P/E = price ÷ EPS (usually trailing twelve months; "forward P/E" uses next year\'s estimate). A P/E of 25 means you pay $25 for $1 of yearly earnings, which is a 4% earnings yield. High P/E usually means the market expects fast growth (or earnings are temporarily depressed); low P/E can mean a bargain or a business in decline. P/E is meaningless when earnings are negative, and it only makes sense compared with the same company\'s history or close peers in the same industry.',
      example: 'Two retailers: one at P/E 12, the other at 30. The second is not "worse", the market simply expects its profits to grow much faster. If growth disappoints, that premium can vanish quickly.',
      why: 'A quick sanity check on valuation before you treat a chart pattern as the whole story.'
    },
    {
      id: 'marketcap', term: 'Market cap (market capitalization)',
      short: 'Share price × shares outstanding: what the market says the whole company is worth.',
      long: 'Market cap is the total value of all shares. Rough buckets: mega (> $200B), large ($10–200B), mid ($2–10B), small ($300M–2B), micro (< $300M). Bigger companies tend to move less in a day and have tighter spreads; smaller ones move more and can be harder to exit. A $5 share price says nothing about size: a company with billions of $5 shares can be worth more than one with a $500 share price.',
      example: '15.2B shares × $190 = about $2.9T. A 1% move in that company changes its value by about $29B in a day.',
      why: 'Position sizing and expectations: a 10% daily move is common for a micro-cap and extraordinary for a mega-cap.'
    },
    {
      id: 'dividend', term: 'Dividend yield',
      short: 'Annual dividends per share divided by the share price, as a percentage.',
      long: 'Companies may pay part of their profit to shareholders in cash, usually quarterly. Yield = annual dividend ÷ price. A 2% yield at a $100 price means $2 a year per share. The price typically drops by the dividend amount on the "ex-dividend" date, so the payout is not free money. Many growth companies pay nothing and reinvest instead. An unusually high yield can be a warning: the price may have fallen because investors expect the dividend to be cut.',
      example: 'Dividend $0.96 a year, price $48 → yield 2.0%. If the price halves to $24 and the payout is unchanged, the yield shows 4%, but the business may be in trouble.',
      why: 'Total return = price change + dividends. Backtests and paper trades here ignore dividends, so yield tells you what is missing from the picture.'
    },
    {
      id: 'beta', term: 'Beta',
      short: 'How much a stock tends to move relative to the market (S&P 500 = 1.0).',
      long: 'Beta is measured from past returns. Beta 1.5 means the stock has historically moved about 1.5% when the market moved 1%; beta 0.5 means half as much; a negative beta moves opposite. It describes sensitivity to the market, not total risk, and it changes over time.',
      example: 'Market falls 2%. A beta-1.8 stock would be expected (on average, historically) to fall about 3.6%.',
      why: 'When sizing a position, high-beta names deserve smaller size for the same dollar risk.'
    },
    {
      id: 'range52', term: '52-week range',
      short: 'The lowest and highest prices over the past year.',
      long: 'Where the current price sits inside its 52-week range is a quick trend check. Near the high, the trend is up and breakouts are possible; near the low, the stock is out of favour. Neither is a signal on its own: "cheap" stocks can keep making new lows and strong ones new highs.',
      example: 'Range $120–$210, price $205 → the stock sits at 94% of its yearly range, close to the high.',
      why: 'Context for support and resistance levels on the chart.'
    }
  ];

  /** One-line tooltips for the stat tiles. Keys match the `stats` object fields. */
  var TOOLTIPS = {
    price: 'Last traded price from your data provider (may be delayed on free plans).',
    marketCap: 'Share price × shares outstanding: what the whole company is valued at.',
    pe: 'Price ÷ earnings per share (trailing twelve months). Dollars paid per $1 of yearly profit. Blank when earnings are negative.',
    forwardPe: 'Price ÷ analysts\' estimated EPS for the next year.',
    eps: 'Net profit per share over the last four reported quarters (trailing twelve months).',
    dividendYield: 'Annual dividends ÷ price. 0% means the company reinvests instead of paying cash.',
    beta: 'Sensitivity to the overall market: 1.0 moves with it, 2.0 twice as much, 0.5 half as much.',
    high52: 'Highest price in the past 52 weeks.',
    low52: 'Lowest price in the past 52 weeks.',
    shares: 'Shares outstanding: the number of shares that exist. Multiply by price to get market cap.',
    revenueTTM: 'Total sales over the last four quarters.',
    profitMargin: 'Net income ÷ revenue: cents of profit kept from each dollar of sales.',
    ipo: 'Initial public offering date: when the shares first traded publicly.',
    nextEarnings: 'Next scheduled quarterly report. Gaps are common on the following open.',
    sector: 'Broad business category used to group peers.',
    industry: 'Narrower business category than sector.'
  };

  /* ------------------------------------------------------------------ */
  /* Provider / key selection                                           */
  /* ------------------------------------------------------------------ */

  function settings() {
    try { if (BT.data && typeof BT.data.getSettings === 'function') return BT.data.getSettings(); } catch (e) { /* fall through */ }
    var s = store.get('bt.data', null) || {};
    return { provider: s.provider || 'demo', keys: Object.assign({ twelvedata: '', finnhub: '', alphavantage: '' }, s.keys || {}) };
  }

  /**
   * Which provider can serve this page. Preference: the configured provider if it does fundamentals and has a
   * key; otherwise any saved Finnhub key, then Alpha Vantage. Twelve Data cannot help here.
   * → {provider:'finnhub'|'alphavantage'|null, key, label, live, reason, configured, canNews, canEarnings, budget}
   */
  function source(s) {
    s = s || settings();
    var keys = s.keys || {};
    var order = [];
    if (s.provider === 'finnhub' || s.provider === 'alphavantage') order.push(s.provider);
    ['finnhub', 'alphavantage'].forEach(function (p) { if (order.indexOf(p) < 0) order.push(p); });
    var pick = null;
    for (var i = 0; i < order.length; i++) if (String(keys[order[i]] || '').trim()) { pick = order[i]; break; }
    if (!pick) {
      var reason = s.provider === 'twelvedata' && keys.twelvedata
        ? 'Your Twelve Data key powers the charts, but Twelve Data\'s free plan has no company profile or news endpoint. Add a free Finnhub key for this page.'
        : 'No Finnhub or Alpha Vantage key is saved. Demo mode shows how to read these numbers; it never invents them.';
      return { provider: null, key: '', label: PROVIDER_LABEL.demo, live: false, configured: s.provider, reason: reason, canNews: false, canEarnings: false, budget: null };
    }
    return {
      provider: pick, key: String(keys[pick]).trim(), label: PROVIDER_LABEL[pick], live: true, configured: s.provider,
      reason: pick === s.provider ? '' : T('Using your saved {provider} key for company data (charts stay on {chartProvider}).', { provider: PROVIDER_LABEL[pick], chartProvider: PROVIDER_LABEL[s.provider] || s.provider }),
      canNews: true, canEarnings: true,
      budget: pick === 'alphavantage' ? { perDay: 25, note: 'Alpha Vantage allows 25 requests a day. The profile costs 1; headlines and earnings are loaded only when you ask.' } : { perDay: Infinity, note: 'Finnhub allows 60 requests a minute with no daily cap.' }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Rate limiting: BT.data's limiter when present, else a local one    */
  /* ------------------------------------------------------------------ */

  function localRateLoad() { var s = store.get(LOCAL_RATE_KEY, null); return (s && typeof s === 'object') ? s : {}; }
  function localRateEntry(state, provider, nowMs) {
    var day = isoDate(nowMs);
    var e = state[provider];
    if (!e || e.day !== day) e = state[provider] = { day: day, count: 0, stamps: [] };
    e.stamps = (e.stamps || []).filter(function (t) { return nowMs - t < 60000; });
    return e;
  }
  var localLimiter = {
    check: function (provider, nowMs) {
      nowMs = nowMs == null ? now() : nowMs;
      var lim = LOCAL_LIMITS[provider]; if (!lim) return { ok: true };
      var e = localRateEntry(localRateLoad(), provider, nowMs);
      var label = PROVIDER_LABEL[provider] || provider;
      if (e.count >= lim.perDay) return { ok: false, code: 'rate_limit', reason: T('{provider} daily free-tier limit ({n} requests) reached. Try again tomorrow.', { provider: label, n: lim.perDay }), retryInMs: 3600000 };
      if (e.stamps.length >= lim.perMinute) { var r = 60000 - (nowMs - e.stamps[0]) + 250; return { ok: false, code: 'rate_limit', reason: T('{provider} per-minute limit ({n}/min) reached. Try again in {s} s.', { provider: label, n: lim.perMinute, s: Math.ceil(r / 1000) }), retryInMs: r }; }
      return { ok: true };
    },
    take: function (provider, nowMs) {
      nowMs = nowMs == null ? now() : nowMs;
      var chk = localLimiter.check(provider, nowMs); if (!chk.ok) return chk;
      if (!LOCAL_LIMITS[provider]) return chk;
      var state = localRateLoad(), e = localRateEntry(state, provider, nowMs);
      e.stamps.push(nowMs); e.count += 1; store.set(LOCAL_RATE_KEY, state);
      return { ok: true };
    },
    status: function (provider, nowMs) {
      nowMs = nowMs == null ? now() : nowMs;
      var lim = LOCAL_LIMITS[provider] || { perMinute: Infinity, perDay: Infinity };
      var e = localRateEntry(localRateLoad(), provider, nowMs);
      return { provider: provider, minuteUsed: e.stamps.length, minuteLimit: lim.perMinute, dayUsed: e.count, dayLimit: lim.perDay, source: 'local' };
    }
  };
  function sharedLimiter() {
    var d = BT.data;
    if (d && typeof d.rateCheck === 'function' && d._internal && typeof d._internal.rateTake === 'function') {
      return { check: d.rateCheck, take: d._internal.rateTake, status: function (p, t) { var s = d.rateStatus(p, t); s.source = 'shared'; return s; } };
    }
    return null;
  }
  function limiter() { return sharedLimiter() || localLimiter; }
  function rateStatus(provider) { return limiter().status(provider || (source().provider || 'demo'), now()); }

  /* ------------------------------------------------------------------ */
  /* Cache                                                              */
  /* ------------------------------------------------------------------ */

  var _mem = null;
  function cacheLoad() { if (_mem) return _mem; var c = store.get(CACHE_KEY, null); _mem = (c && c.entries) ? c : { entries: {} }; return _mem; }
  function cacheGet(key, allowStale) {
    var e = cacheLoad().entries[key]; if (!e) return null;
    var age = now() - e.t;
    if (!allowStale && age > e.ttl) return null;
    return { value: e.v, age: age, stale: age > e.ttl, t: e.t };
  }
  function cacheSet(key, value, ttl) {
    var c = cacheLoad();
    c.entries[key] = { t: now(), ttl: ttl, v: value };
    var keys = Object.keys(c.entries);
    if (keys.length > MAX_CACHE) { keys.sort(function (a, b) { return c.entries[a].t - c.entries[b].t; }); keys.slice(0, keys.length - MAX_CACHE).forEach(function (k) { delete c.entries[k]; }); }
    if (!store.set(CACHE_KEY, c)) { keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (k) { delete c.entries[k]; }); store.set(CACHE_KEY, c); }
  }
  function clearCache() { _mem = { entries: {} }; store.del(CACHE_KEY); }

  /* ------------------------------------------------------------------ */
  /* HTTP                                                               */
  /* ------------------------------------------------------------------ */

  var _fetch = null;
  function doFetch(url, opts) { var f = _fetch || root.fetch; if (typeof f !== 'function') throw NewsError('fetch() is not available', 'network'); return f(url, opts); }

  async function getJSON(url, key, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    var ctrl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var res;
    try { res = await doFetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' }); }
    catch (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw NewsError('Request timed out after ' + Math.round(timeoutMs / 1000) + ' s', 'timeout');
      throw NewsError(redact(e && e.message ? e.message : 'Network error', key), 'network');
    }
    if (timer) clearTimeout(timer);
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      var err = NewsError('HTTP ' + res.status, res.status === 401 || res.status === 403 ? 'auth' : 'http', body);
      err.status = res.status;
      if (res.status === 429) { err.code = 'rate_limit'; err.message = 'The provider says we are sending requests too fast (HTTP 429).'; }
      throw err;
    }
    if (body == null) throw NewsError('Empty or non-JSON response', 'parse');
    return body;
  }

  /** One metered request: check the limiter, take a credit, fetch. */
  async function metered(provider, url, key) {
    var lim = limiter();
    var chk = lim.take(provider, now());
    if (!chk.ok) { var e = NewsError(chk.reason, 'rate_limit'); e.retryInMs = chk.retryInMs; throw e; }
    return getJSON(url, key);
  }

  /** Plain-English explanation of a failure for the page. */
  function explainError(e, provider) {
    var label = PROVIDER_LABEL[provider] || 'the data provider';
    if (!e) return T('Unknown error.');
    if (e instanceof TypeError || e.code === 'network') return T('The request to {provider} was blocked (offline, CORS/CSP, or an embedded preview). Open the site directly in your browser and try again.', { provider: label });
    if (e.code === 'rate_limit') return e.message;
    if (e.code === 'auth') return T('{provider} rejected the API key. Check it in the dashboard\'s Live data settings.', { provider: label });
    if (e.code === 'plan') return e.message;
    if (e.code === 'symbol') return e.message;
    if (e.code === 'timeout') return T('{provider} did not answer in time.', { provider: label });
    if (e.code === 'http') return T('{provider} answered HTTP {status}.', { provider: label, status: e.status });
    return e.message || String(e);
  }

  /* ------------------------------------------------------------------ */
  /* Alpha Vantage response checks                                      */
  /* ------------------------------------------------------------------ */

  function avCheck(j) {
    if (!j || typeof j !== 'object') throw NewsError('Empty response from Alpha Vantage', 'parse');
    var em = j['Error Message'];
    if (em) {
      if (/apikey|api key/i.test(em)) throw NewsError('Alpha Vantage: ' + em, 'auth');
      throw NewsError('Alpha Vantage: ' + em, 'symbol');
    }
    var note = j.Note || j.Information;
    if (note) {
      if (/premium endpoint|premium member|premium plan/i.test(note)) throw NewsError('Alpha Vantage: this endpoint needs a paid plan.', 'plan');
      if (/per day|per minute|rate limit|requests|call frequency|higher api call/i.test(note)) throw NewsError('Alpha Vantage free-tier limit reached (25 requests per day). ' + note, 'rate_limit');
      throw NewsError('Alpha Vantage: ' + note, 'provider');
    }
    return j;
  }
  function avSymbol(symbol) { return normSymbol(symbol).replace(/\./g, '-'); }

  /* ------------------------------------------------------------------ */
  /* Normalizers (pure)                                                 */
  /* ------------------------------------------------------------------ */

  /** Finnhub /stock/profile2 or Alpha Vantage OVERVIEW → unified profile. Returns null when the payload is empty. */
  function normalizeProfile(provider, raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (provider === 'finnhub') {
      if (!raw.ticker && !raw.name) return null;
      var mcM = num(raw.marketCapitalization), shM = num(raw.shareOutstanding);
      return {
        symbol: normSymbol(raw.ticker), name: str(raw.name), exchange: str(raw.exchange), industry: str(raw.finnhubIndustry), sector: '',
        country: str(raw.country), currency: str(raw.currency) || 'USD', ipo: str(raw.ipo), website: str(raw.weburl), logo: str(raw.logo),
        description: '', marketCap: mcM == null ? null : mcM * 1e6, shares: shM == null ? null : shM * 1e6,
        phone: str(raw.phone), provider: 'finnhub'
      };
    }
    if (provider === 'alphavantage') {
      if (!raw.Symbol && !raw.Name) return null;
      var dy = num(raw.DividendYield);
      return {
        symbol: normSymbol(raw.Symbol).replace(/-/g, '.'), name: str(raw.Name), exchange: str(raw.Exchange), industry: titleCase(str(raw.Industry)), sector: titleCase(str(raw.Sector)),
        country: str(raw.Country), currency: str(raw.Currency) || 'USD', ipo: '', website: str(raw.OfficialSite), logo: '',
        description: str(raw.Description), marketCap: num(raw.MarketCapitalization), shares: num(raw.SharesOutstanding),
        fiscalYearEnd: str(raw.FiscalYearEnd), latestQuarter: str(raw.LatestQuarter), provider: 'alphavantage',
        // key stats come along in the same payload
        stats: {
          pe: num(raw.PERatio), forwardPe: num(raw.ForwardPE), eps: num(raw.EPS), dividendYield: dy, dividendPerShare: num(raw.DividendPerShare),
          beta: num(raw.Beta), high52: num(raw['52WeekHigh']), low52: num(raw['52WeekLow']), revenueTTM: num(raw.RevenueTTM), profitMargin: num(raw.ProfitMargin),
          pegRatio: num(raw.PEGRatio), priceToBook: num(raw.PriceToBookRatio), sma50: num(raw['50DayMovingAverage']), sma200: num(raw['200DayMovingAverage']),
          exDividendDate: str(raw.ExDividendDate), dividendDate: str(raw.DividendDate), analystTarget: num(raw.AnalystTargetPrice)
        }
      };
    }
    return null;
  }
  function titleCase(s) {
    if (!s || s !== s.toUpperCase()) return s;    // Alpha Vantage shouts "TECHNOLOGY"; leave mixed case alone
    return s.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  /** Finnhub /stock/metric?metric=all → unified stats (same keys as Alpha Vantage). */
  function normalizeMetrics(raw) {
    var m = raw && raw.metric; if (!m || typeof m !== 'object') return null;
    var dy = num(m.dividendYieldIndicatedAnnual != null ? m.dividendYieldIndicatedAnnual : m.currentDividendYieldTTM);
    return {
      pe: num(m.peTTM != null ? m.peTTM : m.peBasicExclExtraTTM), forwardPe: null, eps: num(m.epsTTM != null ? m.epsTTM : m.epsBasicExclExtraItemsTTM),
      dividendYield: dy == null ? null : dy / 100,         // Finnhub reports percent; keep yields as fractions everywhere
      dividendPerShare: num(m.dividendPerShareAnnual), beta: num(m.beta), high52: num(m['52WeekHigh']), low52: num(m['52WeekLow']),
      high52Date: str(m['52WeekHighDate']), low52Date: str(m['52WeekLowDate']), revenueTTM: num(m.revenueTTM) == null ? null : num(m.revenueTTM) * 1e6,
      profitMargin: num(m.netProfitMarginTTM) == null ? null : num(m.netProfitMarginTTM) / 100, pegRatio: num(m.pegTTM), priceToBook: num(m.pbAnnual),
      sma50: null, sma200: null, revenueGrowth: num(m.revenueGrowthTTMYoy) == null ? null : num(m.revenueGrowthTTMYoy) / 100
    };
  }

  /** Finnhub /company-news or Alpha Vantage NEWS_SENTIMENT → [{id, headline, summary, source, url, time, image, kind}], newest first, deduped. */
  function normalizeNews(provider, raw, symbol) {
    var rows = [];
    if (provider === 'finnhub' && Array.isArray(raw)) {
      rows = raw.map(function (r) {
        return { id: r.id != null ? String(r.id) : '', headline: str(r.headline), summary: str(r.summary), source: str(r.source), url: str(r.url), time: num(r.datetime), image: str(r.image), related: str(r.related) };
      });
    } else if (provider === 'alphavantage' && raw && Array.isArray(raw.feed)) {
      rows = raw.feed.map(function (r) {
        var sent = null;
        if (symbol && Array.isArray(r.ticker_sentiment)) {
          var hit = r.ticker_sentiment.filter(function (t) { return normSymbol(t.ticker) === normSymbol(symbol); })[0];
          if (hit) sent = { score: num(hit.ticker_sentiment_score), label: str(hit.ticker_sentiment_label), relevance: num(hit.relevance_score) };
        }
        return { id: '', headline: str(r.title), summary: str(r.summary), source: str(r.source), url: str(r.url), time: avTime(r.time_published), image: str(r.banner_image), related: '', sentiment: sent };
      });
    }
    var seen = {}, out = [];
    rows.forEach(function (r) {
      if (!r.headline) return;
      var k = (r.url || r.headline).toLowerCase().replace(/\/+$/, '');
      if (seen[k]) return; seen[k] = true;
      if (!r.id) r.id = hashId(k);
      r.kind = classifyHeadline(r.headline + ' ' + r.summary);
      out.push(r);
    });
    out.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    return out.slice(0, MAX_NEWS);
  }
  function avTime(s) {      // "20240304T133000" → unix seconds
    var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/.exec(String(s || ''));
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000);
  }
  function hashId(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return 'n' + (h >>> 0).toString(36); }

  /**
   * Finnhub /calendar/earnings or Alpha Vantage EARNINGS → [{date, epsEstimate, epsActual, surprisePct, revenueEstimate, revenueActual, hour, quarter, year, reported}]
   * sorted oldest → newest. `hour` is 'bmo' (before open), 'amc' (after close), 'dmh' (during hours) or ''.
   */
  function normalizeEarnings(provider, raw) {
    var rows = [];
    if (provider === 'finnhub' && raw && Array.isArray(raw.earningsCalendar)) {
      rows = raw.earningsCalendar.map(function (r) {
        var est = num(r.epsEstimate), act = num(r.epsActual);
        return {
          date: str(r.date), epsEstimate: est, epsActual: act, surprisePct: surprise(est, act),
          revenueEstimate: num(r.revenueEstimate), revenueActual: num(r.revenueActual), hour: str(r.hour).toLowerCase(),
          quarter: num(r.quarter), year: num(r.year), reported: act != null, symbol: normSymbol(r.symbol)
        };
      });
    } else if (provider === 'alphavantage' && raw && Array.isArray(raw.quarterlyEarnings)) {
      rows = raw.quarterlyEarnings.map(function (r) {
        var est = num(r.estimatedEPS), act = num(r.reportedEPS);
        var fde = str(r.fiscalDateEnding), m = /^(\d{4})-(\d{2})/.exec(fde);
        return {
          date: str(r.reportedDate) || fde, epsEstimate: est, epsActual: act, surprisePct: num(r.surprisePercentage) != null ? num(r.surprisePercentage) : surprise(est, act),
          revenueEstimate: null, revenueActual: null, hour: str(r.reportTime) === 'pre-market' ? 'bmo' : str(r.reportTime) === 'post-market' ? 'amc' : '',
          quarter: m ? Math.ceil(+m[2] / 3) : null, year: m ? +m[1] : null, fiscalDateEnding: fde, reported: act != null, symbol: normSymbol(raw.symbol)
        };
      });
    }
    rows = rows.filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.date); });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var seen = {}, out = [];
    rows.forEach(function (r) { if (seen[r.date]) return; seen[r.date] = true; out.push(r); });
    return out;
  }
  function surprise(est, act) { if (est == null || act == null || est === 0) return null; return +((act - est) / Math.abs(est) * 100).toFixed(2); }

  /** Split an earnings list by `nowIso`: {next, upcoming:[...], past:[...] newest first, last}. */
  function splitEarnings(rows, nowMs) {
    var today = isoDate(nowMs == null ? now() : nowMs);
    var upcoming = [], past = [];
    (rows || []).forEach(function (r) { if (r.date >= today && !r.reported) upcoming.push(r); else past.push(r); });
    past.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { next: upcoming[0] || null, upcoming: upcoming, past: past, last: past[0] || null };
  }

  /* ------------------------------------------------------------------ */
  /* Headline classification + "what moved it" prompts (pure)           */
  /* ------------------------------------------------------------------ */

  var KINDS = [
    { kind: 'earnings', re: /\b(earnings|quarterly results|q[1-4] results|fiscal (first|second|third|fourth) quarter|beats? (estimates|expectations)|misses? (estimates|expectations)|revenue (rose|fell|jumped|dropped)|eps\b|profit (rose|fell|jumped|slumped))/i, label: 'Earnings', hint: 'Compare the reported numbers with the estimate below and look for a gap on the chart the next morning.' },
    { kind: 'guidance', re: /\b(guidance|outlook|forecast|raises? (its )?(full-year|annual)|cuts? (its )?(full-year|annual)|expects? (revenue|sales|growth))/i, label: 'Guidance', hint: 'Markets price the future: a change in guidance often matters more than the quarter just reported.' },
    { kind: 'analyst', re: /\b(upgrade[sd]?|downgrade[sd]?|price target|initiates? coverage|overweight|underweight|outperform|underperform|buy rating|sell rating|analysts?\b)/i, label: 'Analyst', hint: 'Rating changes can move a stock for a day; check whether volume confirmed the move.' },
    { kind: 'deal', re: /\b(acqui(re|res|red|sition)|merger|takeover|buyout|to buy\b|agrees to (buy|sell)|stake in|spin-?off|divest)/i, label: 'M&A / deal', hint: 'Acquirers often dip and targets jump toward the offer price. Which side is this company on?' },
    { kind: 'legal', re: /\b(lawsuit|sues?|sued|antitrust|regulator[sy]?|investigation|probe|fine[ds]?|settlement|recall|FTC|DOJ|SEC\b|court)/i, label: 'Legal / regulatory', hint: 'Legal news is uncertain by nature; the reaction often fades or reverses as details arrive.' },
    { kind: 'product', re: /\b(launch(es|ed)?|unveil(s|ed)?|announce[sd]? (a |the )?(new|next)|new (model|chip|phone|drug|product|service)|FDA (approv|clear)|approval|release[sd]? (the|its)|partnership|contract)/i, label: 'Product / business', hint: 'Was this already expected? Scheduled launches rarely move a stock; surprises do.' },
    { kind: 'insider', re: /\b(insider|CEO (sells|buys|sold|bought)|buyback|share repurchase|dividend (increase|hike|cut|raise)|stock split)/i, label: 'Capital / insider', hint: 'Buybacks and dividends change EPS and yield without changing the business itself.' },
    { kind: 'macro', re: /\b(Fed\b|Federal Reserve|interest rates?|inflation|tariffs?|jobs report|CPI\b|GDP\b|recession|treasury yields?|dollar\b|oil prices?)/i, label: 'Macro', hint: 'Market-wide news moves most stocks together. Compare with SPY before crediting the company.' }
  ];
  function classifyHeadline(text) {
    var t = String(text || '');
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].re.test(t)) return KINDS[i].kind;
    return 'other';
  }
  function kindInfo(kind) { return KINDS.filter(function (k) { return k.kind === kind; })[0] || { kind: 'other', label: 'General', hint: 'Ask whether this changes what the company will earn, or just describes what already happened.' }; }

  /**
   * Educational prompts linking what happened to what the chart shows. Every prompt is a question or
   * an instruction to check something — never a statement about why the price moved.
   * {news, earnings, bars (daily, optional), now} → [{kind, title, text, date?}]
   */
  function whatMovedIt(input) {
    input = input || {};
    var nowMs = input.now == null ? now() : input.now;
    var out = [];
    var news = input.news || [], earn = splitEarnings(input.earnings || [], nowMs), bars = Array.isArray(input.bars) ? input.bars : [];

    // 1. Biggest recent daily move from the chart, if bars were supplied.
    var big = biggestMove(bars.slice(-30));
    if (big) {
      var same = news.filter(function (n) { return n.time && isoDateLocal(n.time * 1000) === big.time; });
      out.push({
        kind: 'move', date: big.time,
        title: 'Biggest move in the last 30 sessions: ' + fmt.signedPct(big.pct) + ' on ' + fmt.dateLabel(big.time, nowMs),
        text: same.length
          ? same.length + ' headline' + (same.length > 1 ? 's' : '') + ' landed that day. Read ' + (same.length > 1 ? 'them' : 'it') + ' and decide: did the news cause the move, or did the move come first and the news explain it afterwards?'
          : 'No headline in the list matches that date. Moves without news are common: index rebalancing, options expiry, a sector-wide rotation or simply more sellers than buyers. Check SPY on the same day before blaming the company.'
      });
    }

    // 2. Last earnings: the one event guaranteed to matter.
    if (earn.last) {
      var l = earn.last, dir = l.surprisePct == null ? '' : l.surprisePct > 0 ? 'beat' : l.surprisePct < 0 ? 'missed' : 'matched';
      out.push({
        kind: 'earnings', date: l.date,
        title: 'Last earnings: ' + fmt.dateLabel(l.date, nowMs) + (dir ? ' (' + dir + ' by ' + fmt.signedPct(l.surprisePct) + ')' : ''),
        text: 'Open the chart on that date and the next session. Did the stock gap? Did the gap fill within a week? A beat followed by a drop usually means guidance or expectations mattered more than the reported number' + (l.hour === 'amc' ? '. This report came after the close, so the first reaction was the next morning\'s open.' : l.hour === 'bmo' ? '. This report came before the open, so the reaction was the same day.' : '.')
      });
    }

    // 3. Next earnings: risk management.
    if (earn.next) {
      var d = fmt.daysUntil(earn.next.date, nowMs);
      out.push({
        kind: 'upcoming', date: earn.next.date,
        title: T('Next earnings in {when}', { when: d === 0 ? T('less than a day') : d === 1 ? T('1 day') : T('{n} days', { n: d }) }) + ' (' + fmt.dateLabel(earn.next.date, nowMs) + (earn.next.hour === 'amc' ? ', ' + T('after the close') : earn.next.hour === 'bmo' ? ', ' + T('before the open') : '') + ')',
        text: 'A stop-loss cannot protect a position through an overnight gap. Before the date, decide: hold full size, reduce, or step aside. Write the plan in your Journal before the report, not after.'
      });
    }

    // 4. Themes in the headlines.
    var counts = {};
    news.forEach(function (n) { counts[n.kind] = (counts[n.kind] || 0) + 1; });
    var top = Object.keys(counts).filter(function (k) { return k !== 'other'; }).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    if (top && counts[top] >= 2) {
      var ki = kindInfo(top);
      out.push({ kind: 'theme', title: counts[top] + ' recent headlines are about ' + ki.label.toLowerCase(), text: ki.hint });
    }

    // 5. Volume of news.
    if (news.length) {
      var newest = news[0].time ? fmt.relTime(news[0].time, nowMs) : '';
      out.push({
        kind: 'coverage',
        title: T(news.length > 1 ? '{n} headlines in the last {days} days' : '{n} headline in the last {days} days', { n: news.length, days: NEWS_DAYS }) + (newest ? ', ' + T('newest {date}', { date: newest }) : ''),
        text: news.length >= 20 ? 'Heavy coverage usually means the stock is in play: expect wider ranges and more gaps than usual.' : 'Light coverage is normal for most companies most of the time. Quiet periods are when technical levels tend to work best.'
      });
    }
    return out;
  }
  function biggestMove(bars) {
    var best = null;
    for (var i = 1; i < bars.length; i++) {
      var p = bars[i - 1].close, c = bars[i].close;
      if (!(p > 0) || !(c > 0)) continue;
      var pct = (c / p - 1) * 100;
      if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { time: String(bars[i].time), pct: +pct.toFixed(2) };
    }
    return best;
  }
  function isoDateLocal(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  /** Position of price inside the 52-week range as a fraction 0..1, or null. */
  function rangePosition(price, low, high) {
    if (!isNum(price) || !isNum(low) || !isNum(high) || high <= low) return null;
    return Math.max(0, Math.min(1, (price - low) / (high - low)));
  }
  /** Market-cap bucket label. */
  function capBucket(mc) {
    if (!isNum(mc)) return '';
    if (mc >= 200e9) return 'Mega cap'; if (mc >= 10e9) return 'Large cap'; if (mc >= 2e9) return 'Mid cap'; if (mc >= 300e6) return 'Small cap'; return 'Micro cap';
  }

  /* ------------------------------------------------------------------ */
  /* Fetching (metered, cached)                                         */
  /* ------------------------------------------------------------------ */

  async function cached(kind, provider, symbol, ttl, force, fetcher, result) {
    var key = kind + '|' + provider + '|' + symbol;
    if (!force) { var hit = cacheGet(key); if (hit) { result.cached.push(kind); return hit.value; } }
    var v = await fetcher();
    result.requests += 1;
    cacheSet(key, v, ttl);
    return v;
  }

  async function loadProfile(symbol, src, result, force) {
    if (src.provider === 'finnhub') {
      var raw = await cached('profile', 'finnhub', symbol, TTL.profile, force, function () { return metered('finnhub', FH_BASE + '/stock/profile2?' + qs({ symbol: symbol, token: src.key }), src.key); }, result);
      if (raw && raw.error) throw NewsError(raw.error, /key|auth|token/i.test(raw.error) ? 'auth' : 'provider');
      var p = normalizeProfile('finnhub', raw);
      if (!p) throw NewsError(T('Finnhub has no company profile for {symbol}. Check the ticker (US stocks only on the free plan).', { symbol: symbol }), 'symbol');
      return p;
    }
    var j = avCheck(await cached('profile', 'alphavantage', symbol, TTL.profile, force, function () { return metered('alphavantage', AV_BASE + '?' + qs({ function: 'OVERVIEW', symbol: avSymbol(symbol), apikey: src.key }), src.key); }, result));
    var pa = normalizeProfile('alphavantage', j);
    if (!pa) throw NewsError(T('Alpha Vantage has no company overview for {symbol}. Check the ticker.', { symbol: symbol }), 'symbol');
    return pa;
  }
  async function loadStats(symbol, src, result, force) {
    if (src.provider !== 'finnhub') return null;      // Alpha Vantage stats ride along with OVERVIEW
    var raw = await cached('stats', 'finnhub', symbol, TTL.stats, force, function () { return metered('finnhub', FH_BASE + '/stock/metric?' + qs({ symbol: symbol, metric: 'all', token: src.key }), src.key); }, result);
    if (raw && raw.error) throw NewsError(raw.error, 'provider');
    return normalizeMetrics(raw);
  }
  async function loadNews(symbol, opts) {
    opts = opts || {};
    symbol = normSymbol(symbol);
    var src = opts.source || source();
    var result = { symbol: symbol, provider: src.provider, news: [], requests: 0, cached: [], error: null };
    if (!src.provider) { result.error = NewsError(src.reason, 'nokey'); return result; }
    try {
      if (src.provider === 'finnhub') {
        var to = isoDate(now()), from = isoDate(now() - NEWS_DAYS * 86400e3);
        var raw = await cached('news', 'finnhub', symbol, TTL.news, opts.force, function () { return metered('finnhub', FH_BASE + '/company-news?' + qs({ symbol: symbol, from: from, to: to, token: src.key }), src.key); }, result);
        if (raw && raw.error) throw NewsError(raw.error, 'provider');
        result.news = normalizeNews('finnhub', raw, symbol);
      } else {
        var j = avCheck(await cached('news', 'alphavantage', symbol, TTL.news, opts.force, function () { return metered('alphavantage', AV_BASE + '?' + qs({ function: 'NEWS_SENTIMENT', tickers: avSymbol(symbol), limit: 50, sort: 'LATEST', apikey: src.key }), src.key); }, result));
        result.news = normalizeNews('alphavantage', j, symbol);
      }
    } catch (e) { result.error = e; }
    return result;
  }
  async function loadEarnings(symbol, opts) {
    opts = opts || {};
    symbol = normSymbol(symbol);
    var src = opts.source || source();
    var result = { symbol: symbol, provider: src.provider, earnings: [], requests: 0, cached: [], error: null };
    if (!src.provider) { result.error = NewsError(src.reason, 'nokey'); return result; }
    try {
      if (src.provider === 'finnhub') {
        var from = isoDate(now() - EARN_PAST_DAYS * 86400e3), to = isoDate(now() + EARN_FUTURE_DAYS * 86400e3);
        var raw = await cached('earnings', 'finnhub', symbol, TTL.earnings, opts.force, function () { return metered('finnhub', FH_BASE + '/calendar/earnings?' + qs({ symbol: symbol, from: from, to: to, token: src.key }), src.key); }, result);
        if (raw && raw.error) throw NewsError(raw.error, 'provider');
        result.earnings = normalizeEarnings('finnhub', raw);
      } else {
        var j = avCheck(await cached('earnings', 'alphavantage', symbol, TTL.earnings, opts.force, function () { return metered('alphavantage', AV_BASE + '?' + qs({ function: 'EARNINGS', symbol: avSymbol(symbol), apikey: src.key }), src.key); }, result));
        result.earnings = normalizeEarnings('alphavantage', j).slice(-8);
      }
    } catch (e) { result.error = e; }
    return result;
  }

  /**
   * Load everything the page shows. With Finnhub all four calls run (they are cheap: 60/min, no daily cap).
   * With Alpha Vantage only OVERVIEW runs unless opts.news / opts.earnings are true, because the free plan
   * allows 25 requests a day. Never throws: per-section errors land in `errors`.
   *   → {symbol, provider, label, live, source, profile, stats, quote, news, earnings, earningsSplit, prompts, errors:[{section, code, message}], requests, cached, loadedAt, skipped:[]}
   */
  async function load(symbol, opts) {
    opts = opts || {};
    symbol = normSymbol(symbol);
    var src = opts.source || source();
    var result = {
      symbol: symbol, provider: src.provider, label: src.label, live: !!src.provider, source: src,
      profile: null, stats: null, quote: null, news: [], earnings: [], earningsSplit: splitEarnings([], now()), prompts: [],
      errors: [], requests: 0, cached: [], skipped: [], loadedAt: now()
    };
    if (!symbol) { result.errors.push({ section: 'symbol', code: 'symbol', message: 'Type a ticker symbol first.' }); return result; }
    if (!src.provider) { result.errors.push({ section: 'key', code: 'nokey', message: src.reason }); return result; }

    var isAV = src.provider === 'alphavantage';
    var wantNews = isAV ? !!opts.news : opts.news !== false;
    var wantEarn = isAV ? !!opts.earnings : opts.earnings !== false;
    if (!wantNews) result.skipped.push('news');
    if (!wantEarn) result.skipped.push('earnings');

    function fail(section, e) { result.errors.push({ section: section, code: e && e.code || 'error', message: explainError(e, src.provider), retryInMs: e && e.retryInMs }); }

    // Profile first: if the symbol is unknown or the key is bad there is no point spending more requests.
    try { result.profile = await loadProfile(symbol, src, result, opts.force); }
    catch (e) { fail('profile', e); if (e && (e.code === 'auth' || e.code === 'symbol' || e.code === 'rate_limit' || e.code === 'network')) { return finish(result, opts); } }
    if (result.profile && result.profile.stats) { result.stats = result.profile.stats; delete result.profile.stats; }

    var jobs = [];
    if (!isAV) jobs.push(loadStats(symbol, src, result, opts.force).then(function (s) { if (s) result.stats = s; }, function (e) { fail('stats', e); }));
    if (wantNews) jobs.push(loadNews(symbol, { source: src, force: opts.force }).then(function (r) { result.news = r.news; result.requests += r.requests; result.cached = result.cached.concat(r.cached); if (r.error) fail('news', r.error); }));
    if (wantEarn) jobs.push(loadEarnings(symbol, { source: src, force: opts.force }).then(function (r) { result.earnings = r.earnings; result.requests += r.requests; result.cached = result.cached.concat(r.cached); if (r.error) fail('earnings', r.error); }));
    // Price via BT.data (its own cache + meter), so P/E can be derived when the provider leaves it blank.
    if (opts.quote !== false && BT.data && typeof BT.data.quote === 'function') {
      jobs.push(Promise.resolve().then(function () { return BT.data.quote(symbol); }).then(function (q) { if (q && isNum(q.price) && !q.fallback) result.quote = q; }, function () { /* quote is optional */ }));
    }
    await Promise.all(jobs);
    return finish(result, opts);
  }
  function finish(result, opts) {
    var st = result.stats = result.stats || {};
    var price = result.quote && result.quote.price;
    if (isNum(price)) {
      st.price = price;
      if (st.pe == null && isNum(st.eps) && st.eps > 0) { st.pe = +(price / st.eps).toFixed(2); st.peDerived = true; }
      if (result.profile && result.profile.marketCap == null && isNum(result.profile.shares)) { result.profile.marketCap = price * result.profile.shares; result.profile.marketCapDerived = true; }
    }
    st.rangePos = rangePosition(price, st.low52, st.high52);
    result.earningsSplit = splitEarnings(result.earnings, now());
    if (result.earningsSplit.next) st.nextEarnings = result.earningsSplit.next.date;
    result.prompts = whatMovedIt({ news: result.news, earnings: result.earnings, bars: opts && opts.bars, now: now() });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                         */
  /* ------------------------------------------------------------------ */

  BT.news = {
    // data
    source: source,
    load: load,
    loadNews: loadNews,
    loadEarnings: loadEarnings,
    rateStatus: rateStatus,
    clearCache: clearCache,
    explainError: explainError,
    // pure helpers
    normalizeProfile: normalizeProfile,
    normalizeMetrics: normalizeMetrics,
    normalizeNews: normalizeNews,
    normalizeEarnings: normalizeEarnings,
    splitEarnings: splitEarnings,
    classifyHeadline: classifyHeadline,
    kindInfo: kindInfo,
    whatMovedIt: whatMovedIt,
    rangePosition: rangePosition,
    capBucket: capBucket,
    fmt: fmt,
    // copy
    EXPLAINERS: EXPLAINERS,
    TOOLTIPS: TOOLTIPS,
    KINDS: KINDS.map(function (k) { return { kind: k.kind, label: k.label, hint: k.hint }; }),
    PROVIDER_LABEL: PROVIDER_LABEL,
    TTL: TTL,
    // test hooks
    setFetch: function (fn) { _fetch = typeof fn === 'function' ? fn : null; },
    setClock: function (fn) { _clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; },
    _reset: function () { _mem = null; store.del(CACHE_KEY); store.del(LOCAL_RATE_KEY); },
    _internal: { localLimiter: localLimiter, limiter: limiter, cacheGet: cacheGet, cacheSet: cacheSet, num: num, avCheck: avCheck, avTime: avTime, biggestMove: biggestMove }
  };
})();
