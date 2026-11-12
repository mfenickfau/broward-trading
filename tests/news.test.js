/* Broward Trading — tests for js/news.js (BT.news)
 * Run with:  node tests/news.test.js
 * Plain node + assert, no framework. `window`, `localStorage` and `fetch` are shimmed;
 * data.js is loaded too so the shared rate limiter path is exercised. No network.
 */
'use strict';
const assert = require('assert');
const path = require('path');

// ---- shims -------------------------------------------------------------
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); }
};
global.window = { localStorage: global.localStorage, addEventListener() {}, dispatchEvent() {} };
const calls = [];
let routes = {};
function fakeFetch(url) {
  calls.push(url);
  const hit = Object.keys(routes).find(k => url.indexOf(k) >= 0);
  if (!hit) return Promise.reject(new TypeError('Failed to fetch'));
  const r = routes[hit];
  if (typeof r === 'function') return Promise.resolve(r(url));
  return Promise.resolve({ ok: r.status ? r.status < 400 : true, status: r.status || 200, json: () => Promise.resolve(r.body) });
}
global.fetch = fakeFetch;
window.fetch = fakeFetch;
require(path.join(__dirname, '..', 'js', 'data.js'));
require(path.join(__dirname, '..', 'js', 'news.js'));
const N = window.BT.news;
const D = window.BT.data;

let passed = 0, failed = 0;
function report(name, e) {
  if (!e) { passed++; console.log('  ok   ' + name); return; }
  failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
}
// Tests run strictly one after another (async ones included) because they share localStorage, the fake clock and the fetch routes.
let chain = Promise.resolve();
function test(name, fn) {
  chain = chain.then(async () => { try { await fn(); report(name); } catch (e) { report(name, e); } });
}
let fakeNow = Date.UTC(2026, 2, 10, 15, 0, 0);     // 2026-03-10 15:00 UTC, a Tuesday
N.setClock(() => fakeNow);
N.setFetch(fakeFetch);
function fresh(settings) {
  localStorage.clear(); N._reset(); calls.length = 0; routes = {};
  if (settings) D.setSettings(settings);
}

// ---- fixtures ------------------------------------------------------------
const FH_PROFILE = { country: 'US', currency: 'USD', exchange: 'NASDAQ NMS - GLOBAL MARKET', finnhubIndustry: 'Technology', ipo: '1980-12-12', logo: 'https://x/logo.png', marketCapitalization: 2950123.4, name: 'Apple Inc', phone: '14089961010', shareOutstanding: 15204.14, ticker: 'AAPL', weburl: 'https://www.apple.com/' };
const FH_METRIC = { metric: { '52WeekHigh': 260.1, '52WeekLow': 164.08, '52WeekHighDate': '2025-12-26', beta: 1.24, peTTM: 30.5, epsTTM: 6.42, dividendYieldIndicatedAnnual: 0.52, dividendPerShareAnnual: 1.0, revenueTTM: 391035, netProfitMarginTTM: 24.3 }, series: {} };
const FH_NEWS = [
  { category: 'company', datetime: 1773100000, headline: 'Apple beats estimates on strong iPhone demand', id: 1, image: '', related: 'AAPL', source: 'Reuters', summary: 'Quarterly results topped Wall Street expectations.', url: 'https://r.example/a' },
  { category: 'company', datetime: 1773000000, headline: 'Analyst upgrades Apple to Buy, raises price target', id: 2, image: '', related: 'AAPL', source: 'MarketWatch', summary: '', url: 'https://mw.example/b' },
  { category: 'company', datetime: 1773000000, headline: 'Analyst upgrades Apple to Buy, raises price target', id: 3, image: '', related: 'AAPL', source: 'MarketWatch', summary: '', url: 'https://mw.example/b/' },
  { category: 'company', datetime: 1772900000, headline: 'Apple unveils new chip at spring event', id: 4, image: '', related: 'AAPL', source: 'The Verge', summary: '', url: 'https://v.example/c' },
  { category: 'company', datetime: 1772800000, headline: '', id: 5, image: '', related: 'AAPL', source: 'x', summary: '', url: 'https://v.example/d' }
];
const FH_EARN = { earningsCalendar: [
  { date: '2026-04-30', epsActual: null, epsEstimate: 1.62, hour: 'amc', quarter: 2, revenueActual: null, revenueEstimate: 94000000000, symbol: 'AAPL', year: 2026 },
  { date: '2026-01-29', epsActual: 2.4, epsEstimate: 2.35, hour: 'amc', quarter: 1, revenueActual: 124300000000, revenueEstimate: 124000000000, symbol: 'AAPL', year: 2026 },
  { date: '2025-10-30', epsActual: 1.57, epsEstimate: 1.6, hour: 'amc', quarter: 4, revenueActual: 94900000000, revenueEstimate: 94500000000, symbol: 'AAPL', year: 2025 },
  { date: '2025-10-30', epsActual: 1.57, epsEstimate: 1.6, hour: 'amc', quarter: 4, revenueActual: 94900000000, revenueEstimate: 94500000000, symbol: 'AAPL', year: 2025 }
] };
const AV_OVERVIEW = { Symbol: 'MSFT', AssetType: 'Common Stock', Name: 'Microsoft Corporation', Description: 'Microsoft develops software.', Exchange: 'NASDAQ', Currency: 'USD', Country: 'USA', Sector: 'TECHNOLOGY', Industry: 'SERVICES-PREPACKAGED SOFTWARE', MarketCapitalization: '3100000000000', EPS: '12.5', PERatio: '34.2', ForwardPE: '30.1', DividendYield: '0.0072', DividendPerShare: '3.0', Beta: '0.9', '52WeekHigh': '468.35', '52WeekLow': '344.79', SharesOutstanding: '7430000000', RevenueTTM: '245000000000', ProfitMargin: '0.36', PEGRatio: 'None', AnalystTargetPrice: '500', FiscalYearEnd: 'June', LatestQuarter: '2025-12-31' };
const AV_EARNINGS = { symbol: 'MSFT', quarterlyEarnings: [
  { fiscalDateEnding: '2025-12-31', reportedDate: '2026-01-28', reportedEPS: '3.23', estimatedEPS: '3.11', surprise: '0.12', surprisePercentage: '3.8585', reportTime: 'post-market' },
  { fiscalDateEnding: '2025-09-30', reportedDate: '2025-10-29', reportedEPS: '3.30', estimatedEPS: '3.1', surprise: '0.2', surprisePercentage: '6.45', reportTime: 'post-market' },
  { fiscalDateEnding: '2025-06-30', reportedDate: '2025-07-30', reportedEPS: 'None', estimatedEPS: '2.9', surprise: 'None', surprisePercentage: 'None', reportTime: 'pre-market' }
] };
const AV_NEWS = { items: '2', feed: [
  { title: 'Microsoft raises full-year outlook', url: 'https://n.example/1', time_published: '20260309T213000', summary: 'Guidance up.', source: 'Benzinga', banner_image: '', ticker_sentiment: [{ ticker: 'MSFT', relevance_score: '0.9', ticker_sentiment_score: '0.41', ticker_sentiment_label: 'Bullish' }] },
  { title: 'Fed holds interest rates steady', url: 'https://n.example/2', time_published: '20260308T180000', summary: '', source: 'AP', banner_image: '', ticker_sentiment: [] }
] };

console.log('BT.news tests');

/* ---------------------------------------------------------------- surface */
test('module exposes the documented surface', () => {
  ['source', 'load', 'loadNews', 'loadEarnings', 'normalizeProfile', 'normalizeMetrics', 'normalizeNews', 'normalizeEarnings', 'splitEarnings',
    'classifyHeadline', 'whatMovedIt', 'fmt', 'EXPLAINERS', 'TOOLTIPS', 'KINDS', 'rateStatus', 'clearCache', 'explainError', 'rangePosition', 'capBucket']
    .forEach(k => assert.ok(k in N, 'missing ' + k));
});

test('educational copy covers every term the no-key state promises, with no numbers invented as live data', () => {
  const ids = N.EXPLAINERS.map(e => e.id);
  ['news', 'earnings', 'pe', 'eps', 'marketcap', 'dividend'].forEach(id => assert.ok(ids.includes(id), 'explainer ' + id));
  N.EXPLAINERS.forEach(e => {
    assert.ok(e.term && e.short && e.long && e.example && e.why, e.id + ' has all fields');
    assert.ok(e.long.length > 200, e.id + ' long copy is substantive');
    assert.ok(!/advice|guaranteed|will rise|will fall/i.test(e.long + e.short), e.id + ' avoids promises');
  });
  ['marketCap', 'pe', 'eps', 'dividendYield', 'beta', 'high52', 'low52', 'shares', 'nextEarnings'].forEach(k => assert.ok(N.TOOLTIPS[k], 'tooltip ' + k));
});

/* ---------------------------------------------------------------- source */
test('source(): no keys → demo/connect state with an honest reason', () => {
  fresh({ provider: 'demo', keys: { twelvedata: '', finnhub: '', alphavantage: '' } });
  const s = N.source();
  assert.strictEqual(s.provider, null); assert.strictEqual(s.live, false);
  assert.ok(/No Finnhub or Alpha Vantage key/.test(s.reason));
  assert.strictEqual(s.canNews, false);
});
test('source(): Twelve Data-only setup explains why it cannot serve this page', () => {
  fresh({ provider: 'twelvedata', keys: { twelvedata: 'TDKEY' } });
  const s = N.source();
  assert.strictEqual(s.provider, null);
  assert.ok(/Twelve Data/.test(s.reason) && /Finnhub/.test(s.reason));
});
test('source(): configured provider wins, otherwise Finnhub before Alpha Vantage, with the budget note', () => {
  fresh({ provider: 'alphavantage', keys: { finnhub: 'FH', alphavantage: 'AV' } });
  let s = N.source();
  assert.strictEqual(s.provider, 'alphavantage'); assert.strictEqual(s.key, 'AV'); assert.strictEqual(s.reason, '');
  assert.strictEqual(s.budget.perDay, 25);
  fresh({ provider: 'twelvedata', keys: { twelvedata: 'TD', finnhub: 'FH', alphavantage: 'AV' } });
  s = N.source();
  assert.strictEqual(s.provider, 'finnhub'); assert.ok(/saved Finnhub key/.test(s.reason)); assert.strictEqual(s.budget.perDay, Infinity);
  fresh({ provider: 'demo', keys: { alphavantage: ' AV2 ' } });
  s = N.source();
  assert.strictEqual(s.provider, 'alphavantage'); assert.strictEqual(s.key, 'AV2');
});
test('source() works from raw localStorage when BT.data is absent', () => {
  fresh();
  localStorage.setItem('bt.data', JSON.stringify({ provider: 'finnhub', keys: { finnhub: 'K' } }));
  const saved = window.BT.data; window.BT.data = null;
  try { const s = N.source(); assert.strictEqual(s.provider, 'finnhub'); assert.strictEqual(s.key, 'K'); }
  finally { window.BT.data = saved; }
});

/* ---------------------------------------------------------------- fmt */
test('fmt.big scales market caps and share counts', () => {
  assert.strictEqual(N.fmt.big(2.95e12), '$2.95T');
  assert.strictEqual(N.fmt.big(48.04e9), '$48.0B');
  assert.strictEqual(N.fmt.big(312e6), '$312M');
  assert.strictEqual(N.fmt.big(15204.14e6, ''), '15.2B');
  assert.strictEqual(N.fmt.big(950), '$950');
  assert.strictEqual(N.fmt.big(null), '—');
  assert.strictEqual(N.fmt.big(-1.5e9), '−$1.50B');
});
test('fmt.pct treats fractions as fractions and percents as percents', () => {
  assert.strictEqual(N.fmt.pct(0.0052), '0.52%');
  assert.strictEqual(N.fmt.pct(24.3, true), '24.3%');
  assert.strictEqual(N.fmt.signedPct(3.8585), '+3.86%');
  assert.strictEqual(N.fmt.signedPct(-12.5), '−12.5%');
  assert.strictEqual(N.fmt.pct(NaN), '—');
});
test('fmt.relTime and dateLabel read naturally', () => {
  const nowSec = Math.floor(fakeNow / 1000);
  assert.strictEqual(N.fmt.relTime(nowSec - 30, fakeNow), 'just now');
  assert.strictEqual(N.fmt.relTime(nowSec - 5 * 60, fakeNow), '5 min ago');
  assert.strictEqual(N.fmt.relTime(nowSec - 3 * 3600, fakeNow), '3 h ago');
  assert.strictEqual(N.fmt.relTime(nowSec - 30 * 3600, fakeNow), 'Yesterday');
  assert.strictEqual(N.fmt.relTime(nowSec - 4 * 86400, fakeNow), '4 days ago');
  assert.ok(/^[A-Z][a-z]{2} \d+$/.test(N.fmt.relTime(nowSec - 20 * 86400, fakeNow)));
  assert.strictEqual(N.fmt.dateLabel('2026-04-30', fakeNow), 'Apr 30');
  assert.strictEqual(N.fmt.dateLabel('2025-10-30', fakeNow), 'Oct 30, 2025');
  assert.strictEqual(N.fmt.daysUntil('2026-03-12', fakeNow), 2);
  assert.strictEqual(N.fmt.daysUntil('2026-03-09', fakeNow), -1);
});

/* ---------------------------------------------------------------- normalizers */
test('normalizeProfile(finnhub) converts millions to dollars and keeps the ticker', () => {
  const p = N.normalizeProfile('finnhub', FH_PROFILE);
  assert.strictEqual(p.symbol, 'AAPL'); assert.strictEqual(p.name, 'Apple Inc');
  assert.ok(Math.abs(p.marketCap - 2950123.4e6) < 1);
  assert.ok(Math.abs(p.shares - 15204.14e6) < 1);
  assert.strictEqual(p.industry, 'Technology'); assert.strictEqual(p.ipo, '1980-12-12');
  assert.strictEqual(N.normalizeProfile('finnhub', {}), null, 'empty payload → null');
});
test('normalizeProfile(alphavantage) parses strings, "None" → null, carries stats and title-cases sector', () => {
  const p = N.normalizeProfile('alphavantage', AV_OVERVIEW);
  assert.strictEqual(p.symbol, 'MSFT'); assert.strictEqual(p.marketCap, 3.1e12); assert.strictEqual(p.shares, 7.43e9);
  assert.strictEqual(p.sector, 'Technology'); assert.strictEqual(p.industry, 'Services-Prepackaged Software');
  assert.strictEqual(p.stats.pe, 34.2); assert.strictEqual(p.stats.eps, 12.5); assert.strictEqual(p.stats.dividendYield, 0.0072);
  assert.strictEqual(p.stats.pegRatio, null); assert.strictEqual(p.stats.high52, 468.35);
  assert.strictEqual(p.description, 'Microsoft develops software.');
  assert.strictEqual(N.normalizeProfile('alphavantage', {}), null);
});
test('normalizeMetrics(finnhub) converts percent yields/margins to fractions and revenue millions to dollars', () => {
  const s = N.normalizeMetrics(FH_METRIC);
  assert.strictEqual(s.pe, 30.5); assert.strictEqual(s.eps, 6.42);
  assert.ok(Math.abs(s.dividendYield - 0.0052) < 1e-9);
  assert.ok(Math.abs(s.profitMargin - 0.243) < 1e-9);
  assert.strictEqual(s.revenueTTM, 391035e6);
  assert.strictEqual(s.high52, 260.1); assert.strictEqual(s.high52Date, '2025-12-26');
  assert.strictEqual(N.normalizeMetrics({}), null);
});
test('normalizeNews(finnhub) dedupes by URL, drops empty headlines, sorts newest first and classifies', () => {
  const n = N.normalizeNews('finnhub', FH_NEWS, 'AAPL');
  assert.strictEqual(n.length, 3);
  assert.strictEqual(n[0].headline, 'Apple beats estimates on strong iPhone demand');
  assert.strictEqual(n[0].kind, 'earnings'); assert.strictEqual(n[1].kind, 'analyst'); assert.strictEqual(n[2].kind, 'product');
  assert.strictEqual(n[0].source, 'Reuters'); assert.strictEqual(n[0].time, 1773100000);
  assert.ok(n.every(x => x.id));
});
test('normalizeNews(alphavantage) parses compact timestamps and per-ticker sentiment', () => {
  const n = N.normalizeNews('alphavantage', AV_NEWS, 'MSFT');
  assert.strictEqual(n.length, 2);
  assert.strictEqual(n[0].time, Math.floor(Date.UTC(2026, 2, 9, 21, 30, 0) / 1000));
  assert.strictEqual(n[0].kind, 'guidance'); assert.strictEqual(n[0].sentiment.label, 'Bullish');
  assert.strictEqual(n[1].kind, 'macro'); assert.strictEqual(n[1].sentiment, null);
  assert.deepStrictEqual(N.normalizeNews('alphavantage', { Information: 'x' }, 'MSFT'), []);
  assert.deepStrictEqual(N.normalizeNews('finnhub', null, 'AAPL'), []);
});
test('normalizeEarnings(finnhub) dedupes dates, sorts oldest → newest and computes surprise %', () => {
  const e = N.normalizeEarnings('finnhub', FH_EARN);
  assert.deepStrictEqual(e.map(x => x.date), ['2025-10-30', '2026-01-29', '2026-04-30']);
  assert.strictEqual(e[0].surprisePct, -1.88); assert.strictEqual(e[1].surprisePct, 2.13);
  assert.strictEqual(e[2].surprisePct, null); assert.strictEqual(e[2].reported, false); assert.strictEqual(e[2].hour, 'amc');
  assert.strictEqual(e[1].revenueActual, 124300000000);
});
test('normalizeEarnings(alphavantage) uses reportedDate, maps report time and keeps the provider surprise', () => {
  const e = N.normalizeEarnings('alphavantage', AV_EARNINGS);
  assert.deepStrictEqual(e.map(x => x.date), ['2025-07-30', '2025-10-29', '2026-01-28']);
  assert.strictEqual(e[2].surprisePct, 3.8585); assert.strictEqual(e[2].hour, 'amc'); assert.strictEqual(e[2].quarter, 4); assert.strictEqual(e[2].year, 2025);
  assert.strictEqual(e[0].epsActual, null); assert.strictEqual(e[0].hour, 'bmo'); assert.strictEqual(e[0].reported, false);
});
test('splitEarnings separates the next report from the history', () => {
  const sp = N.splitEarnings(N.normalizeEarnings('finnhub', FH_EARN), fakeNow);
  assert.strictEqual(sp.next.date, '2026-04-30');
  assert.strictEqual(sp.last.date, '2026-01-29');
  assert.deepStrictEqual(sp.past.map(x => x.date), ['2026-01-29', '2025-10-30']);
});

/* ---------------------------------------------------------------- classification & prompts */
test('classifyHeadline recognises the main kinds and falls back to other', () => {
  assert.strictEqual(N.classifyHeadline('Tesla Q3 results: revenue rose 8%'), 'earnings');
  assert.strictEqual(N.classifyHeadline('Nvidia raises full-year guidance'), 'guidance');
  assert.strictEqual(N.classifyHeadline('Morgan Stanley downgrades Ford to Underweight'), 'analyst');
  assert.strictEqual(N.classifyHeadline('Broadcom agrees to buy VMware in $61B deal'), 'deal');
  assert.strictEqual(N.classifyHeadline('FTC opens antitrust probe into Amazon'), 'legal');
  assert.strictEqual(N.classifyHeadline('Pfizer wins FDA approval for new vaccine'), 'product');
  assert.strictEqual(N.classifyHeadline('Board approves $90B share repurchase and dividend increase'), 'insider');
  assert.strictEqual(N.classifyHeadline('Stocks slide as Fed signals higher interest rates'), 'macro');
  assert.strictEqual(N.classifyHeadline('Company opens new office in Miami'), 'other');
  assert.strictEqual(N.classifyHeadline(''), 'other');
  assert.ok(N.kindInfo('macro').hint.length > 20 && N.kindInfo('zzz').label === 'General');
});
test('whatMovedIt returns only questions/checks, never a causal claim, and nothing without data', () => {
  assert.deepStrictEqual(N.whatMovedIt({ news: [], earnings: [], now: fakeNow }), []);
  const bars = [];
  for (let i = 0; i < 31; i++) { const d = new Date(Date.UTC(2026, 1, 1 + i)); bars.push({ time: d.toISOString().slice(0, 10), open: 100, high: 101, low: 99, close: i === 20 ? 112 : 100 + i * 0.1, volume: 1 }); }
  const news = N.normalizeNews('finnhub', FH_NEWS, 'AAPL');
  const earnings = N.normalizeEarnings('finnhub', FH_EARN);
  const p = N.whatMovedIt({ news, earnings, bars, now: fakeNow });
  const kinds = p.map(x => x.kind);
  assert.ok(kinds.includes('move') && kinds.includes('earnings') && kinds.includes('upcoming') && kinds.includes('coverage'), kinds.join(','));
  const move = p.find(x => x.kind === 'move');
  assert.ok(/\+9\.9\d%/.test(move.title), move.title);
  assert.ok(/No headline in the list matches/.test(move.text));
  const up = p.find(x => x.kind === 'upcoming');
  assert.ok(/51 days/.test(up.title) && /after the close/.test(up.title), up.title);
  const last = p.find(x => x.kind === 'earnings');
  assert.ok(/beat by \+2\.13%/.test(last.title), last.title);
  p.forEach(x => assert.ok(!/because the|caused by|due to the news/i.test(x.text), 'no causal claims: ' + x.text));
});
test('whatMovedIt links a headline to the day of the biggest move when dates match', () => {
  const day = '2026-02-21';
  const bars = [{ time: '2026-02-20', close: 100, open: 100, high: 100, low: 100 }, { time: day, close: 90, open: 100, high: 100, low: 90 }];
  const t = Math.floor(new Date(2026, 1, 21, 12, 0, 0).getTime() / 1000);   // local noon that day, like isoDateLocal
  const news = [{ id: 'x', headline: 'Regulator fines company', summary: '', source: 'AP', url: 'u', time: t, kind: 'legal' }];
  const p = N.whatMovedIt({ news, earnings: [], bars, now: fakeNow });
  assert.ok(/1 headline landed that day/.test(p[0].text), p[0].text);
  assert.ok(/−10\.0%/.test(p[0].title), p[0].title);
});
test('rangePosition and capBucket', () => {
  assert.strictEqual(N.rangePosition(205, 120, 210), (205 - 120) / 90);
  assert.strictEqual(N.rangePosition(300, 120, 210), 1);
  assert.strictEqual(N.rangePosition(null, 1, 2), null);
  assert.strictEqual(N.capBucket(2.9e12), 'Mega cap'); assert.strictEqual(N.capBucket(5e9), 'Mid cap'); assert.strictEqual(N.capBucket(1e8), 'Micro cap'); assert.strictEqual(N.capBucket(null), '');
});

/* ---------------------------------------------------------------- load(): demo / no key */
test('load() without a key makes no request and reports the nokey error (never fabricates)', async () => {
  fresh({ provider: 'demo', keys: {} });
  const r = await N.load('AAPL');
  assert.strictEqual(r.live, false); assert.strictEqual(r.profile, null);
  assert.deepStrictEqual(r.news, []); assert.deepStrictEqual(r.earnings, []); assert.deepStrictEqual(r.prompts, []);
  assert.strictEqual(r.errors[0].code, 'nokey');
  assert.strictEqual(calls.length, 0);
});
test('load() with an empty symbol asks for one', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FH' } });
  const r = await N.load('   ');
  assert.strictEqual(r.errors[0].section, 'symbol'); assert.strictEqual(calls.length, 0);
});

/* ---------------------------------------------------------------- load(): finnhub */
function finnhubRoutes() {
  routes = {
    '/stock/profile2': { body: FH_PROFILE },
    '/stock/metric': { body: FH_METRIC },
    '/company-news': { body: FH_NEWS },
    '/calendar/earnings': { body: FH_EARN },
    '/quote?': { body: { c: 195.8, d: 1.2, dp: 0.6, h: 196, l: 193, o: 194, pc: 194.6, t: Math.floor(fakeNow / 1000) } }
  };
}
test('load(finnhub) fetches profile, metrics, news and earnings, assembles stats and prompts, and meters 4 requests', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  const r = await N.load('aapl');
  assert.strictEqual(r.symbol, 'AAPL'); assert.strictEqual(r.provider, 'finnhub'); assert.strictEqual(r.live, true);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.profile.name, 'Apple Inc');
  assert.strictEqual(r.stats.pe, 30.5); assert.strictEqual(r.stats.eps, 6.42);
  assert.strictEqual(r.stats.price, 195.8, 'quote price attached via BT.data.quote');
  assert.ok(r.stats.rangePos > 0 && r.stats.rangePos < 1);
  assert.strictEqual(r.stats.nextEarnings, '2026-04-30');
  assert.strictEqual(r.news.length, 3); assert.strictEqual(r.earnings.length, 3);
  assert.ok(r.prompts.length >= 3);
  assert.strictEqual(r.requests, 4, 'four metered fundamentals requests');
  assert.ok(calls.every(u => u.indexOf('token=FHKEY') > 0));
  const rs = N.rateStatus('finnhub');
  assert.strictEqual(rs.source, 'shared', 'uses BT.data\'s persisted limiter');
});
test('the four fundamentals calls are counted on BT.data\'s persisted Finnhub meter', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  await N.load('AAPL', { quote: false });   // BT.data.quote stamps with the real clock, so leave it out here
  const rs = N.rateStatus('finnhub');
  assert.strictEqual(rs.minuteUsed, 4, 'shared meter counted the calls: ' + rs.minuteUsed);
  assert.strictEqual(rs.minuteLimit, 60);
});
test('load(finnhub) a second time is served from cache: zero new fundamentals requests', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  await N.load('AAPL');
  const before = calls.filter(u => u.indexOf('/quote') < 0).length;
  const r = await N.load('AAPL');
  const after = calls.filter(u => u.indexOf('/quote') < 0).length;
  assert.strictEqual(after, before);
  assert.strictEqual(r.requests, 0);
  assert.deepStrictEqual(r.cached.slice().sort(), ['earnings', 'news', 'profile', 'stats']);
  assert.strictEqual(r.profile.name, 'Apple Inc');
});
test('news cache expires after 10 minutes while the profile stays cached for a day', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  await N.load('AAPL');
  fakeNow += 11 * 60 * 1000;
  try {
    const r = await N.load('AAPL');
    assert.strictEqual(r.requests, 1); assert.ok(r.cached.includes('profile') && !r.cached.includes('news'));
  } finally { fakeNow -= 11 * 60 * 1000; }
});
test('force:true refetches everything', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  await N.load('AAPL');
  const r = await N.load('AAPL', { force: true });
  assert.strictEqual(r.requests, 4);
});
test('an unknown symbol on Finnhub stops after the profile request (no credits wasted)', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes(); routes['/stock/profile2'] = { body: {} };
  const r = await N.load('ZZZZ');
  assert.strictEqual(r.profile, null);
  assert.strictEqual(r.errors.length, 1); assert.strictEqual(r.errors[0].code, 'symbol');
  assert.strictEqual(calls.length, 1);
});
test('a rejected key is explained and stops the load', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'BAD' } });
  finnhubRoutes(); routes['/stock/profile2'] = { status: 401, body: { error: 'Invalid API key' } };
  const r = await N.load('AAPL');
  assert.strictEqual(r.errors[0].code, 'auth');
  assert.ok(/rejected the API key/.test(r.errors[0].message));
  assert.ok(!/BAD/.test(JSON.stringify(r.errors)), 'key never appears in messages');
  assert.strictEqual(calls.length, 1);
});
test('a network/CORS failure is explained in plain English', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  routes = {};
  const r = await N.load('AAPL');
  assert.strictEqual(r.errors[0].code, 'network');
  assert.ok(/blocked/.test(r.errors[0].message));
});
test('a failing section does not sink the others', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes(); routes['/company-news'] = { status: 500, body: null };
  const r = await N.load('AAPL');
  assert.strictEqual(r.profile.name, 'Apple Inc'); assert.strictEqual(r.earnings.length, 3);
  assert.deepStrictEqual(r.news, []);
  assert.strictEqual(r.errors.length, 1); assert.strictEqual(r.errors[0].section, 'news'); assert.ok(/HTTP 500/.test(r.errors[0].message));
});
test('P/E is derived from price ÷ EPS only when the provider leaves it blank', async () => {
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  routes['/stock/metric'] = { body: { metric: { epsTTM: 5, peTTM: null } } };
  const r = await N.load('AAPL');
  assert.strictEqual(r.stats.pe, +(195.8 / 5).toFixed(2)); assert.strictEqual(r.stats.peDerived, true);
});

/* ---------------------------------------------------------------- load(): alpha vantage */
function avRoutes() {
  routes = {
    'function=OVERVIEW': { body: AV_OVERVIEW },
    'function=EARNINGS': { body: AV_EARNINGS },
    'function=NEWS_SENTIMENT': { body: AV_NEWS },
    'function=GLOBAL_QUOTE': { body: { 'Global Quote': { '05. price': '410.00', '07. latest trading day': '2026-03-09', '08. previous close': '405.00', '09. change': '5.00', '10. change percent': '1.23%' } } }
  };
}
test('load(alphavantage) spends only one request by default and skips news/earnings until asked', async () => {
  fresh({ provider: 'alphavantage', keys: { alphavantage: 'AVKEY' } });
  avRoutes();
  const r = await N.load('MSFT');
  assert.strictEqual(r.provider, 'alphavantage');
  assert.strictEqual(r.profile.name, 'Microsoft Corporation');
  assert.strictEqual(r.stats.pe, 34.2); assert.strictEqual(r.stats.dividendYield, 0.0072);
  assert.strictEqual(r.profile.stats, undefined, 'stats hoisted out of the profile');
  assert.deepStrictEqual(r.skipped.slice().sort(), ['earnings', 'news']);
  assert.strictEqual(r.requests, 1);
  assert.strictEqual(calls.filter(u => u.indexOf('alphavantage') > 0 && u.indexOf('GLOBAL_QUOTE') < 0).length, 1);
});
test('load(alphavantage, {news, earnings}) loads them on demand and parses both', async () => {
  fresh({ provider: 'alphavantage', keys: { alphavantage: 'AVKEY' } });
  avRoutes();
  const r = await N.load('MSFT', { news: true, earnings: true, quote: false });
  assert.strictEqual(r.requests, 3);
  assert.strictEqual(r.news.length, 2); assert.strictEqual(r.news[0].kind, 'guidance');
  assert.strictEqual(r.earnings.length, 3); assert.strictEqual(r.earningsSplit.last.date, '2026-01-28');
  assert.deepStrictEqual(r.skipped, []);
});
test('Alpha Vantage rate-limit note (HTTP 200) is recognised and explained', async () => {
  fresh({ provider: 'alphavantage', keys: { alphavantage: 'AVKEY' } });
  routes = { 'function=OVERVIEW': { body: { Information: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.' } } };
  const r = await N.load('MSFT', { quote: false });
  assert.strictEqual(r.errors[0].code, 'rate_limit'); assert.ok(/25 requests per day/.test(r.errors[0].message));
});
test('Alpha Vantage hyphenates share classes (BRK.B → BRK-B) and un-hyphenates on the way back', async () => {
  fresh({ provider: 'alphavantage', keys: { alphavantage: 'AVKEY' } });
  routes = { 'function=OVERVIEW': { body: Object.assign({}, AV_OVERVIEW, { Symbol: 'BRK-B', Name: 'Berkshire Hathaway' }) } };
  const r = await N.load('BRK.B', { quote: false });
  assert.ok(calls[0].indexOf('symbol=BRK-B') > 0);
  assert.strictEqual(r.profile.symbol, 'BRK.B');
});
test('loadNews / loadEarnings alone: no key → nokey error, with key → metered', async () => {
  fresh({ provider: 'demo', keys: {} });
  let r = await N.loadNews('AAPL');
  assert.strictEqual(r.error.code, 'nokey'); assert.strictEqual(calls.length, 0);
  fresh({ provider: 'finnhub', keys: { finnhub: 'FHKEY' } });
  finnhubRoutes();
  r = await N.loadNews('AAPL');
  assert.strictEqual(r.news.length, 3); assert.strictEqual(r.requests, 1);
  const e = await N.loadEarnings('AAPL');
  assert.strictEqual(e.earnings.length, 3); assert.strictEqual(e.requests, 1);
});

/* ---------------------------------------------------------------- rate limiting */
test('the shared limiter blocks before a request is sent when the per-minute budget is spent', async () => {
  fresh({ provider: 'alphavantage', keys: { alphavantage: 'AVKEY' } });
  avRoutes();
  for (let i = 0; i < 5; i++) D._internal.rateTake('alphavantage', fakeNow);
  const r = await N.load('MSFT', { quote: false });
  assert.strictEqual(r.errors[0].code, 'rate_limit');
  assert.ok(/per-minute limit/.test(r.errors[0].message));
  assert.strictEqual(calls.length, 0, 'nothing sent');
});
test('local fallback limiter enforces Alpha Vantage 5/min and 25/day when BT.data is missing', () => {
  fresh();
  const L = N._internal.localLimiter;
  let t = fakeNow;
  for (let i = 0; i < 5; i++) assert.strictEqual(L.take('alphavantage', t).ok, true);
  const blocked = L.check('alphavantage', t);
  assert.strictEqual(blocked.ok, false); assert.ok(/per-minute/.test(blocked.reason)); assert.ok(blocked.retryInMs > 0);
  t += 61000;
  assert.strictEqual(L.check('alphavantage', t).ok, true);
  for (let i = 0; i < 20; i++) { L.take('alphavantage', t); t += 13000; }
  const day = L.check('alphavantage', t);
  assert.strictEqual(day.ok, false); assert.ok(/daily/.test(day.reason));
  assert.strictEqual(L.status('alphavantage', t).dayUsed, 25);
  t += 86400000;
  assert.strictEqual(L.check('alphavantage', t).ok, true, 'new day resets');
  assert.strictEqual(L.check('finnhub', t).ok, true);
  const saved = window.BT.data; window.BT.data = null;
  try { assert.strictEqual(N._internal.limiter(), L); assert.strictEqual(N.rateStatus('finnhub').source, 'local'); }
  finally { window.BT.data = saved; }
});
test('the cache never grows past its cap and survives a reload of the module state', () => {
  fresh();
  for (let i = 0; i < 50; i++) N._internal.cacheSet('k' + i, { i }, 60000);
  const raw = JSON.parse(localStorage.getItem('bt.news.cache'));
  assert.ok(Object.keys(raw.entries).length <= 40);
  assert.strictEqual(N._internal.cacheGet('k49').value.i, 49);
  assert.strictEqual(N._internal.cacheGet('k0'), null, 'oldest evicted');
  N.clearCache();
  assert.strictEqual(localStorage.getItem('bt.news.cache'), null);
});
test('num() parses provider strings defensively', () => {
  const num = N._internal.num;
  assert.strictEqual(num('None'), null); assert.strictEqual(num('-'), null); assert.strictEqual(num(''), null); assert.strictEqual(num(null), null);
  assert.strictEqual(num('3,100,000'), 3100000); assert.strictEqual(num('1.23%'), 1.23); assert.strictEqual(num(NaN), null); assert.strictEqual(num(4), 4);
  assert.strictEqual(N._internal.avTime('20260309T213000'), Math.floor(Date.UTC(2026, 2, 9, 21, 30) / 1000));
  assert.strictEqual(N._internal.avTime('bad'), null);
});

chain.then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
