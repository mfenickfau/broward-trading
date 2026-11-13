/* Broward Trading — tests for js/data.js (BT.data)
 * Run with:  node tests/data.test.js
 * Plain node + assert, no framework. `window` and `localStorage` are shimmed. No network: the provider
 * tests feed recorded response shapes to the exported parsers. Covers the v0.4 crypto/ETF additions
 * (asset kinds, 24/7 calendar, symbol mapping, Alpha Vantage DIGITAL_CURRENCY_DAILY) plus the
 * backward-compatible NYSE behaviour the rest of the app relies on.
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
require(path.join(__dirname, '..', 'js', 'data.js'));
const D = window.BT.data;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n       ') : e)); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n       ') : e)); }
}
const utcDay = s => new Date(s + 'T00:00:00Z').getUTCDay();
const SAT_NOON_UTC = Date.UTC(2025, 6, 5, 12, 0, 0);        // Saturday 5 July 2025, 08:00 ET

console.log('data.js');

/* ---- universe & kinds ------------------------------------------------- */
test('universe: stocks, ETFs and crypto all carry a kind; ids are unique', () => {
  const kinds = new Set(D.universe.map(u => u.kind));
  assert.deepStrictEqual([...kinds].sort(), ['crypto', 'etf', 'stock']);
  const syms = D.universe.map(u => u.symbol);
  assert.strictEqual(new Set(syms).size, syms.length, 'duplicate symbols');
  assert.ok(D.universe.length >= 60, 'universe has ' + D.universe.length + ' entries');
  for (const u of D.universe) {
    assert.ok(u.symbol && u.name && u.sector && u.exchange, u.symbol + ' meta');
    assert.ok(u.base > 0 && u.vol > 0 && u.adv > 0, u.symbol + ' numbers');
    assert.ok(D.KIND_LABEL[u.kind], u.symbol + ' kind ' + u.kind);
  }
});
test('universe: the three contract crypto pairs exist with 24/7 exchange metadata', () => {
  for (const s of ['BTC-USD', 'ETH-USD', 'SOL-USD']) {
    const u = D.lookup(s);
    assert.strictEqual(u.kind, 'crypto', s);
    assert.ok(!u.synthetic, s + ' is a real universe entry');
    assert.strictEqual(u.quoteAsset, 'USD');
    assert.strictEqual(u.baseAsset, s.slice(0, 3));
    assert.ok(/24\/7/.test(u.exchange));
  }
  assert.strictEqual(D.universeByKind('crypto').length, 3);
});
test('universe: every ETF has an expense ratio in percent, an etfType and what it tracks', () => {
  const etfs = D.universeByKind('etf');
  assert.ok(etfs.length >= 10, 'only ' + etfs.length + ' ETFs');
  const types = new Set();
  for (const u of etfs) {
    assert.ok(typeof u.expenseRatio === 'number' && u.expenseRatio > 0 && u.expenseRatio < 2, u.symbol + ' expense ratio ' + u.expenseRatio);
    assert.ok(u.etfType && u.tracks && u.issuer, u.symbol + ' etf metadata');
    types.add(u.etfType);
    if (u.etfType === 'leveraged') assert.ok(Math.abs(u.leverage) >= 2, u.symbol + ' leverage factor');
  }
  for (const t of ['index', 'sector', 'bond', 'commodity', 'leveraged']) assert.ok(types.has(t), 'no ' + t + ' ETF');
  assert.strictEqual(D.lookup('SPY').expenseRatio, 0.0945);
  assert.ok(D.lookup('VOO').expenseRatio < D.lookup('SPY').expenseRatio, 'VOO is cheaper than SPY');
  assert.ok(D.lookup('TQQQ').expenseRatio > D.lookup('QQQ').expenseRatio, 'leveraged funds cost more');
  assert.strictEqual(D.lookup('SQQQ').leverage, -3);
});
test('universe: old ETF entries kept their symbols (SPY, QQQ, DIA, IWM, GLD, TLT, XLE, XLF)', () => {
  for (const s of ['SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'TLT', 'XLE', 'XLF']) assert.strictEqual(D.lookup(s).kind, 'etf', s);
  for (const s of ['AAPL', 'MSFT', 'BRK.B', 'COIN']) assert.strictEqual(D.lookup(s).kind, 'stock', s);
});
test('kindOf / isCrypto: universe first, then the BASE-USD pattern; plain tickers are stocks', () => {
  assert.strictEqual(D.kindOf('BTC-USD'), 'crypto');
  assert.strictEqual(D.kindOf('spy'), 'etf');
  assert.strictEqual(D.kindOf('AAPL'), 'stock');
  assert.strictEqual(D.kindOf('DOGE-USD'), 'crypto', 'unknown pair still counts as crypto');
  assert.strictEqual(D.kindOf('ZZZZ'), 'stock');
  assert.strictEqual(D.kindOf('COIN'), 'stock', 'Coinbase the stock is not a coin');
  assert.strictEqual(D.kindOf('IBIT'), 'etf', 'a spot-bitcoin ETF trades on NASDAQ hours');
  assert.strictEqual(D.isCrypto('eth-usd'), true);
  assert.strictEqual(D.isCrypto(''), false);
});
test('normSymbol folds provider spellings into BASE-USD and leaves stocks alone', () => {
  assert.strictEqual(D.normSymbol('btc/usd'), 'BTC-USD');
  assert.strictEqual(D.normSymbol('BINANCE:BTCUSDT'), 'BTC-USD');
  assert.strictEqual(D.normSymbol('COINBASE:ETH-USD'), 'ETH-USD');
  assert.strictEqual(D.normSymbol('sol-usdt'), 'SOL-USD');
  assert.strictEqual(D.normSymbol(' brk.b '), 'BRK.B');
  assert.strictEqual(D.normSymbol('aapl'), 'AAPL');
  assert.strictEqual(D.normSymbol(null), '');
});
test('parseSymbol splits crypto pairs and treats stocks as USD-quoted', () => {
  assert.deepStrictEqual(D.parseSymbol('BTC-USD'), { symbol: 'BTC-USD', kind: 'crypto', base: 'BTC', quote: 'USD' });
  assert.deepStrictEqual(D.parseSymbol('eth/eur'), { symbol: 'ETH-EUR', kind: 'crypto', base: 'ETH', quote: 'EUR' });
  assert.deepStrictEqual(D.parseSymbol('SPY'), { symbol: 'SPY', kind: 'etf', base: 'SPY', quote: 'USD' });
});
test('providerSymbol: Twelve Data BTC/USD, Finnhub BINANCE:BTCUSDT, Alpha Vantage BTC (+market) and BRK-B', () => {
  assert.strictEqual(D.providerSymbol('twelvedata', 'BTC-USD'), 'BTC/USD');
  assert.strictEqual(D.providerSymbol('finnhub', 'BTC-USD'), 'BINANCE:BTCUSDT');
  assert.strictEqual(D.providerSymbol('finnhub', 'ETH-USD'), 'BINANCE:ETHUSDT');
  assert.strictEqual(D.providerSymbol('alphavantage', 'BTC-USD'), 'BTC');
  assert.strictEqual(D.providerSymbol('alphavantage', 'BRK.B'), 'BRK-B');
  assert.strictEqual(D.providerSymbol('twelvedata', 'BRK.B'), 'BRK.B');
  assert.strictEqual(D.providerSymbol('finnhub', 'aapl'), 'AAPL');
  assert.strictEqual(D.providerSymbol('demo', 'BTC-USD'), 'BTC-USD');
});
test('lookup synthesizes a crypto profile for unknown pairs and a stock profile for unknown tickers', () => {
  const c = D.lookup('DOGE-USD');
  assert.strictEqual(c.kind, 'crypto'); assert.strictEqual(c.synthetic, true); assert.strictEqual(c.baseAsset, 'DOGE');
  assert.ok(c.base > 0 && c.vol >= 0.7, 'coins are volatile');
  const s = D.lookup('ZZZZ');
  assert.strictEqual(s.kind, 'stock'); assert.strictEqual(s.synthetic, true);
  assert.deepStrictEqual(D.lookup('ZZZZ'), s, 'deterministic');
});
test('universeSearch understands "crypto", "etf", coin names and base assets; rows carry kind', () => {
  assert.deepStrictEqual(D.universeSearch('crypto').map(r => r.symbol), ['BTC-USD', 'ETH-USD', 'SOL-USD']);
  const etfRows = D.universeSearch('etf', 50);
  assert.ok(etfRows.length >= 10);
  assert.ok(etfRows.slice(0, D.universeByKind('etf').length).every(r => r.kind === 'etf'), 'every ETF ranks ahead of name matches such as nETFlix');
  assert.strictEqual(D.universeSearch('BTC')[0].symbol, 'BTC-USD');
  assert.strictEqual(D.universeSearch('btc/usd')[0].symbol, 'BTC-USD');
  assert.strictEqual(D.universeSearch('bitcoin')[0].symbol, 'BTC-USD');
  assert.ok(D.universeSearch('bitcoin').some(r => r.symbol === 'IBIT'), 'the spot ETF shows up for bitcoin too');
  const spy = D.universeSearch('SPY')[0];
  assert.strictEqual(spy.kind, 'etf'); assert.strictEqual(spy.expenseRatio, 0.0945); assert.strictEqual(spy.etfType, 'index');
  assert.strictEqual(D.universeSearch('AAPL')[0].kind, 'stock');
  assert.ok(D.universeSearch('').length > 0, 'empty query lists the start of the universe');
});

/* ---- market status ------------------------------------------------------ */
test('marketStatus(): no-arg form still returns the NYSE shape with kind stock', () => {
  const s = D.marketStatus();
  for (const k of ['open', 'phase', 'nyTime', 'nyDate', 'weekday', 'isTradingDay', 'nextOpen', 'holidays', 'earlyCloses']) assert.ok(k in s, 'missing ' + k);
  assert.ok(['pre', 'open', 'after', 'closed'].includes(s.phase));
  assert.strictEqual(s.kind, 'stock'); assert.strictEqual(s.always, false);
  assert.ok(/^\d{2}:\d{2} ET$/.test(s.nyTime));
});
test('marketStatus(nowMs): legacy numeric argument is still the clock', () => {
  const sat = D.marketStatus(SAT_NOON_UTC);
  assert.strictEqual(sat.open, false); assert.strictEqual(sat.phase, 'closed'); assert.strictEqual(sat.reason, 'Weekend');
  const wedOpen = D.marketStatus(Date.UTC(2025, 6, 9, 15, 0));          // Wed 9 Jul 2025, 11:00 ET
  assert.strictEqual(wedOpen.open, true); assert.strictEqual(wedOpen.phase, 'open');
  const jul3 = D.marketStatus(Date.UTC(2025, 6, 3, 18, 0));             // Thu 3 Jul 2025, 14:00 ET: early close at 13:00
  assert.strictEqual(jul3.earlyClose, true); assert.strictEqual(jul3.phase, 'after'); assert.strictEqual(jul3.closesAt, '13:00 ET');
  const jul4 = D.marketStatus(Date.UTC(2025, 6, 4, 15, 0));
  assert.strictEqual(jul4.isTradingDay, false); assert.strictEqual(jul4.holiday, 'Independence Day');
});
test('marketStatus(symbol, nowMs): stocks and ETFs follow NYSE hours and report their kind', () => {
  const spy = D.marketStatus('SPY', SAT_NOON_UTC);
  assert.strictEqual(spy.open, false); assert.strictEqual(spy.kind, 'etf'); assert.strictEqual(spy.always, false);
  const aapl = D.marketStatus('AAPL', Date.UTC(2025, 6, 9, 15, 0));
  assert.strictEqual(aapl.open, true); assert.strictEqual(aapl.kind, 'stock');
  const obj = D.marketStatus({ symbol: 'AAPL', now: SAT_NOON_UTC });
  assert.strictEqual(obj.open, false); assert.strictEqual(obj.reason, 'Weekend');
});
test('marketStatus(crypto): open 24/7 — weekend, holiday, 3 am — with no next-open and no holidays', () => {
  for (const now of [SAT_NOON_UTC, Date.UTC(2025, 11, 25, 15, 0), Date.UTC(2025, 6, 9, 7, 0), Date.UTC(2025, 0, 1, 0, 0)]) {
    const s = D.marketStatus('BTC-USD', now);
    assert.strictEqual(s.open, true); assert.strictEqual(s.phase, 'open');
    assert.strictEqual(s.kind, 'crypto'); assert.strictEqual(s.always, true);
    assert.strictEqual(s.isTradingDay, true); assert.strictEqual(s.holiday, null); assert.strictEqual(s.earlyClose, false);
    assert.strictEqual(s.nextOpen, null); assert.strictEqual(s.reason, null);
    assert.deepStrictEqual(s.holidays, {}); assert.deepStrictEqual(s.earlyCloses, []);
    assert.ok(/^\d{2}:\d{2} ET$/.test(s.nyTime)); assert.ok(/^\d{2}:\d{2} UTC$/.test(s.utcTime));
  }
  assert.strictEqual(D.marketStatus('BTC-USD', SAT_NOON_UTC).utcDate, '2025-07-05');
  assert.strictEqual(D.marketStatus('DOGE-USD', SAT_NOON_UTC).open, true, 'unknown pairs are 24/7 too');
  assert.strictEqual(D.marketStatus('IBIT', SAT_NOON_UTC).open, false, 'but the bitcoin ETF keeps NYSE hours');
});
test('calendarFor: NYSE for stocks/ETFs, 24/7 calendar for crypto', () => {
  assert.strictEqual(D.calendarFor('AAPL').id, 'nyse'); assert.strictEqual(D.calendarFor('SPY').always, false);
  const c = D.calendarFor('ETH-USD');
  assert.strictEqual(c.id, 'crypto'); assert.strictEqual(c.always, true);
  assert.strictEqual(c.isDay('2025-07-05'), true, 'Saturday is a session');
  assert.strictEqual(c.isDay('2025-12-25'), true, 'Christmas is a session');
  assert.strictEqual(c.sessionMinutes('2025-07-03'), 1440, 'no early closes');
  assert.deepStrictEqual(c.days('2025-07-06', 3), ['2025-07-04', '2025-07-05', '2025-07-06']);
  assert.deepStrictEqual(D.calendarFor('AAPL').days('2025-07-06', 3), ['2025-07-01', '2025-07-02', '2025-07-03'], 'NYSE skips Jul 4 and the weekend');
  assert.strictEqual(c.openUnix('2025-07-05'), Date.UTC(2025, 6, 5) / 1000, 'crypto day opens at 00:00 UTC');
  assert.strictEqual(c.daysBetween('2025-02-27', '2025-03-02').length, 4);
});

/* ---- demo generator: NYSE (unchanged behaviour) ------------------------------ */
test('demo(stock, 1day): only NYSE trading days, deterministic, consistent across limits', () => {
  const b = D.demo('AAPL', '1day', 60, SAT_NOON_UTC);
  assert.strictEqual(b.length, 60);
  assert.strictEqual(b[b.length - 1].time, '2025-07-03', 'last session before the Saturday is Thursday (Jul 4 is a holiday)');
  for (const x of b) { const wd = utcDay(x.time); assert.ok(wd >= 1 && wd <= 5, x.time + ' is a weekend'); assert.ok(!D.calendar.holidayName(x.time), x.time + ' is a holiday'); }
  for (const x of b) { assert.ok(x.high >= Math.max(x.open, x.close) && x.low <= Math.min(x.open, x.close), 'OHLC sanity ' + x.time); assert.ok(x.volume >= 1000); }
  const again = D.demo('AAPL', '1day', 60, SAT_NOON_UTC);
  assert.deepStrictEqual(again.map(x => x.close), b.map(x => x.close), 'deterministic');
  const longer = D.demo('AAPL', '1day', 200, SAT_NOON_UTC);
  assert.deepStrictEqual(longer.slice(-60).map(x => x.close), b.map(x => x.close), 'same bars whatever the limit');
  assert.strictEqual(b.kind, 'stock'); assert.strictEqual(b.source, 'demo'); assert.strictEqual(b.symbol, 'AAPL');
  const anchor = D.demo('AAPL', '1day', 10, Date.UTC(2025, 6, 1, 21)).pop();
  assert.strictEqual(anchor.time, '2025-07-01'); assert.strictEqual(anchor.close, D.lookup('AAPL').base, 'anchored to the base price');
});
test('demo(stock, 5min): bars sit inside 9:30–16:00 ET and aggregate to the daily bar', () => {
  const b = D.demo('MSFT', '5min', 78, Date.UTC(2025, 6, 2, 21));        // Wed 2 Jul 2025 after the close: exactly one session
  assert.strictEqual(b.length, 78);
  const open930 = D.time.nyToUnix(2025, 7, 2, 9, 30, 0);
  assert.strictEqual(b[0].time, open930);
  assert.strictEqual(b[b.length - 1].time, open930 + 385 * 60);
  const daily = D.demo('MSFT', '1day', 2, Date.UTC(2025, 6, 2, 21))[1];
  assert.strictEqual(daily.time, '2025-07-02');
  assert.strictEqual(b[0].open, daily.open);
  assert.strictEqual(b[b.length - 1].close, daily.close);
  const hi = Math.max(...b.map(x => x.high)), lo = Math.min(...b.map(x => x.low));
  assert.ok(hi <= daily.high * 1.002 && lo >= daily.low * 0.998, 'intraday range stays inside the daily range');
  assert.ok(b.every(x => x.volume >= 100));
});

/* ---- demo generator: crypto (24/7) ------------------------------------- */
test('demo(crypto, 1day): every calendar day including weekends and holidays, UTC dates, anchored', () => {
  const b = D.demo('BTC-USD', '1day', 400, SAT_NOON_UTC);
  assert.strictEqual(b.length, 400);
  assert.strictEqual(b.kind, 'crypto');
  assert.strictEqual(b[b.length - 1].time, '2025-07-05', 'the Saturday itself is the current (in-progress) session');
  for (let i = 1; i < b.length; i++) assert.strictEqual(b[i].time, D.calendar.addDays(b[i - 1].time, 1), 'gap in calendar at ' + b[i].time);
  assert.ok(b.some(x => utcDay(x.time) === 0) && b.some(x => utcDay(x.time) === 6), 'weekends present');
  assert.ok(b.some(x => x.time === '2024-12-25') && b.some(x => x.time === '2025-01-01'), 'holidays present');
  const anchor = b.find(x => x.time === '2025-07-01');
  assert.strictEqual(anchor.close, 107000, 'anchored to the base level');
  for (const x of b) { assert.ok(x.high >= Math.max(x.open, x.close) && x.low <= Math.min(x.open, x.close), 'OHLC ' + x.time); assert.ok(x.volume >= 1, 'volume ' + x.time); }
});
test('demo(crypto, 1day): continuous trading — each open equals the previous close (no overnight gaps)', () => {
  const b = D.demo('ETH-USD', '1day', 300, Date.UTC(2025, 6, 10, 3));
  let maxGap = 0;
  for (let i = 1; i < b.length; i++) maxGap = Math.max(maxGap, Math.abs(b[i].open / b[i - 1].close - 1));
  assert.ok(maxGap < 1e-9, 'max gap ' + maxGap);
  const s = D.demo('AAPL', '1day', 300, Date.UTC(2025, 6, 10, 3));
  let stockGap = 0;
  for (let i = 1; i < s.length; i++) stockGap = Math.max(stockGap, Math.abs(s[i].open / s[i - 1].close - 1));
  assert.ok(stockGap > 0.002, 'stocks do gap overnight (' + stockGap + ')');
});
test('demo(crypto): deterministic, same bars for every limit, weekend volume lighter on average', () => {
  const a = D.demo('SOL-USD', '1day', 120, SAT_NOON_UTC), b = D.demo('SOL-USD', '1day', 120, SAT_NOON_UTC);
  assert.deepStrictEqual(a.map(x => x.close), b.map(x => x.close));
  const long = D.demo('SOL-USD', '1day', 700, SAT_NOON_UTC);
  assert.deepStrictEqual(long.slice(-120).map(x => x.close), a.map(x => x.close));
  const full = long.slice(0, -1);                           // drop the in-progress Saturday
  const wk = full.filter(x => utcDay(x.time) === 0 || utcDay(x.time) === 6), wd = full.filter(x => utcDay(x.time) >= 1 && utcDay(x.time) <= 5);
  const avg = arr => arr.reduce((s, x) => s + x.volume, 0) / arr.length;
  assert.ok(avg(wk) < avg(wd), 'weekend volume ' + avg(wk) + ' vs weekday ' + avg(wd));
});
test('demo(crypto, 1h): 24 bars per UTC day, aligned to the hour, last bar is the current hour', () => {
  const now = Date.UTC(2025, 6, 5, 12, 30);
  const b = D.demo('BTC-USD', '1h', 100, now);
  assert.strictEqual(b.length, 100);
  assert.ok(b.every(x => typeof x.time === 'number' && x.time % 3600 === 0), 'hour-aligned unix times');
  assert.strictEqual(b[b.length - 1].time, Date.UTC(2025, 6, 5, 12) / 1000, 'current hour is the live bar');
  for (let i = 1; i < b.length; i++) assert.strictEqual(b[i].time - b[i - 1].time, 3600, 'no gaps across midnight or the weekend');
  const sat = b.filter(x => x.time >= Date.UTC(2025, 6, 5) / 1000);
  assert.strictEqual(sat.length, 13, '00:00 … 12:00 UTC on the Saturday');
  const daily = D.demo('BTC-USD', '1day', 2, now);
  assert.strictEqual(sat[0].open, daily[1].open, 'the day\'s first hourly open is the daily open');
  assert.strictEqual(sat[sat.length - 1].close, daily[1].close, 'the live hourly close is the daily close');
  const fri = b.filter(x => x.time >= Date.UTC(2025, 6, 4) / 1000 && x.time < Date.UTC(2025, 6, 5) / 1000);
  assert.strictEqual(fri.length, 24);
  assert.strictEqual(fri[fri.length - 1].close, daily[0].close, 'Friday\'s last hour closes at Friday\'s daily close');
});
test('demo(crypto, 1min): right after midnight UTC only the first bar of the new day exists', () => {
  const b = D.demo('ETH-USD', '1min', 5, Date.UTC(2025, 6, 5, 0, 0, 30));
  assert.strictEqual(b.length, 5);
  assert.strictEqual(b[b.length - 1].time, Date.UTC(2025, 6, 5) / 1000);
  assert.strictEqual(b[b.length - 2].time, Date.UTC(2025, 6, 4, 23, 59) / 1000);
});
test('demo: crypto sessions have no U-shaped bell volume; stock sessions do', () => {
  const bar = (sym, now) => D.demo(sym, '15min', 26, now);
  const s = bar('AAPL', Date.UTC(2025, 6, 2, 21));             // one full NYSE session
  const first = s[0].volume + s[1].volume, mid = s[12].volume + s[13].volume;
  assert.ok(first > mid, 'stock open busier than lunch: ' + first + ' vs ' + mid);
  const c = D.demo('BTC-USD', '1h', 24, Date.UTC(2025, 6, 5, 0, 0, 30)).slice(0, 23);   // Friday 01:00–23:00 UTC, all complete
  const mx = Math.max(...c.map(x => x.volume)), mn = Math.min(...c.map(x => x.volume));
  assert.ok(mx / mn < 6, 'crypto hourly volume is comparatively even: ' + mx + '/' + mn);
});
test('demoTick mutates the last bar within sanity bounds for crypto and stocks', () => {
  for (const sym of ['BTC-USD', 'AAPL']) {
    const b = D.demo(sym, '1day', 5);
    const before = b[b.length - 1].close;
    D.demoTick(b);
    const last = b[b.length - 1];
    assert.ok(Math.abs(last.close / before - 1) < 0.05, sym + ' tick moved too far');
    assert.ok(last.high >= last.close && last.low <= last.close, sym + ' high/low updated');
  }
});
test('_internal.dayCore keeps the NYSE call signature (3 args) and takes a calendar as a 4th', () => {
  const I = D._internal;
  const prof = D.lookup('AAPL');
  const a = I.dayCore('AAPL', prof, '2025-03-03'), b = I.dayCore('AAPL', prof, '2025-03-03', I.EQUITY_CAL);
  assert.deepStrictEqual(a, b);
  const c = I.dayCore('BTC-USD', D.lookup('BTC-USD'), '2025-03-03', I.CRYPTO_CAL);
  assert.strictEqual(c.gap, 0, 'crypto has no overnight gap');
  assert.ok(c.sigma > 0);
});

/* ---- demo provider & facade ---------------------------------------------- */
atest('facade in demo mode: candles/quote/search work for crypto and tag the kind', async () => {
  D.setSettings({ provider: 'demo' });
  const bars = await D.candles('btc/usd', '1day', 30);
  assert.strictEqual(bars.length, 30); assert.strictEqual(bars.symbol, 'BTC-USD'); assert.strictEqual(bars.kind, 'crypto');
  assert.ok(!bars.fallback, 'demo is not a fallback when demo is chosen');
  const q = await D.quote('ETH-USD');
  assert.ok(q.price > 0); assert.strictEqual(q.symbol, 'ETH-USD'); assert.strictEqual(q.source, 'demo');
  const rows = await D.search('sol');
  assert.ok(rows.some(r => r.symbol === 'SOL-USD' && r.kind === 'crypto'));
}).then(() => atest('facade with a provider but no key: crypto falls back to demo with the nokey reason', async () => {
  D.setSettings({ provider: 'twelvedata', keys: { twelvedata: '' } });
  const bars = await D.candles('BTC-USD', '1h', 20);
  assert.strictEqual(bars.fallback, true); assert.strictEqual(bars.code, 'nokey'); assert.strictEqual(bars.length, 20);
  assert.strictEqual(bars.kind, 'crypto');
  D.setSettings({ provider: 'demo' });
})).then(() => atest('facade: Alpha Vantage crypto intraday is refused up front (premium) without spending a credit', async () => {
  D.clearCache();
  D.setSettings({ provider: 'alphavantage', keys: { alphavantage: 'demo-key' } });
  const before = D.rateStatus('alphavantage').dayUsed;
  const bars = await D.candles('BTC-USD', '5min', 20);
  assert.strictEqual(bars.fallback, true); assert.strictEqual(bars.code, 'interval');
  assert.ok(/daily|1day/i.test(bars.reason), bars.reason);
  assert.strictEqual(D.rateStatus('alphavantage').dayUsed, before, 'no request was counted');
  D.setSettings({ provider: 'demo' });
})).then(() => atest('facade: a failing live request for crypto falls back to 24/7 demo bars and explains why', async () => {
  D.clearCache();
  D.setSettings({ provider: 'twelvedata', keys: { twelvedata: 'test-key' } });
  const realFetch = global.fetch;
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    const bars = await D.candles('BTC-USD', '1day', 10);
    assert.strictEqual(bars.fallback, true); assert.strictEqual(bars.code, 'network');
    assert.ok(/blocked|CORS|offline/i.test(bars.reason), bars.reason);
    assert.ok(bars.some(x => utcDay(x.time) === 0 || utcDay(x.time) === 6) || bars.length === 10);
  } finally { global.fetch = realFetch; D.setSettings({ provider: 'demo' }); }
})).then(() => atest('facade: Twelve Data crypto request uses BTC/USD and UTC, parses the live bars', async () => {
  D.clearCache();
  D.setSettings({ provider: 'twelvedata', keys: { twelvedata: 'test-key' } });
  const realFetch = global.fetch;
  let url = '';
  global.fetch = async (u) => {
    url = String(u);
    return { ok: true, status: 200, json: async () => ({ meta: { symbol: 'BTC/USD' }, values: [
      { datetime: '2025-07-05', open: '108000', high: '110000', low: '107500', close: '109500', volume: '12000' },
      { datetime: '2025-07-04', open: '107000', high: '108500', low: '106000', close: '108000', volume: '15000' }
    ], status: 'ok' }) };
  };
  try {
    const bars = await D.candles('BTC-USD', '1day', 10);
    assert.ok(/symbol=BTC%2FUSD/.test(url), url);
    assert.ok(/timezone=UTC/.test(url), url);
    assert.strictEqual(bars.live, true); assert.strictEqual(bars.length, 2);
    assert.deepStrictEqual(bars.map(b => b.time), ['2025-07-04', '2025-07-05']);
    assert.strictEqual(bars.symbol, 'BTC-USD');
  } finally { global.fetch = realFetch; D.setSettings({ provider: 'demo' }); D.clearCache(); }
})).then(runParsers);

/* ---- provider response parsing (recorded shapes, no network) ------------------- */
function runParsers() {
  const I = D._internal;
  test('parseTwelveData: crypto intraday datetimes are UTC, stock ones are New York', () => {
    const j = { values: [{ datetime: '2025-07-07 14:00:00', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] };
    assert.strictEqual(I.parseTwelveData(j, '1h', 'BTC-USD', true)[0].time, Date.UTC(2025, 6, 7, 14) / 1000);
    assert.strictEqual(I.parseTwelveData(j, '1h', 'AAPL', false)[0].time, D.time.nyToUnix(2025, 7, 7, 14, 0, 0));
    assert.throws(() => I.parseTwelveData({ values: [] }, '1day', 'X', false), /no bars/);
  });
  test('parseFinnhubCandles: crypto daily candles are dated in UTC, stock candles in New York', () => {
    const midnightUtc = Date.UTC(2025, 6, 5) / 1000;                   // Sat 00:00 UTC = Fri 20:00 ET
    const j = { s: 'ok', t: [midnightUtc], o: [100], h: [110], l: [90], c: [105], v: [5] };
    assert.strictEqual(I.parseFinnhubCandles(j, '1day', true)[0].time, '2025-07-05');
    assert.strictEqual(I.parseFinnhubCandles(j, '1day', false)[0].time, '2025-07-04');
    assert.strictEqual(I.parseFinnhubCandles(j, '1h', true)[0].time, midnightUtc);
    assert.deepStrictEqual(I.parseFinnhubCandles({ s: 'no_data' }, '1day', true), []);
    assert.deepStrictEqual(I.parseFinnhubCandles(null, '1day', true), []);
  });
  test('finnhubWindow: crypto windows count calendar days from 00:00 UTC; stock windows count sessions', () => {
    const now = SAT_NOON_UTC;
    const c = I.finnhubWindow('1day', 10, now, 'BTC-USD');
    assert.strictEqual(c.to, Math.floor(now / 1000));
    assert.strictEqual(c.from, Date.UTC(2025, 5, 25) / 1000, '10 bars + 1 padding day, ending Jul 5, at midnight UTC');
    assert.strictEqual(c.from % 86400, 0);
    const s = I.finnhubWindow('1day', 10, now, 'AAPL');
    assert.ok(s.from < Date.UTC(2025, 5, 20) / 1000, 'stock window reaches further back because weekends/Jul 4 are skipped');
    const h = I.finnhubWindow('1h', 48, now, 'BTC-USD');
    assert.strictEqual((c.to - h.from) / 86400 >= 3, true, '48 hourly bars need at least 2 crypto days + padding');
  });
  test('parseAlphaVantage: DIGITAL_CURRENCY_DAILY (current "1. open" shape) → bars oldest → newest', () => {
    const j = {
      'Meta Data': { '1. Information': 'Daily Prices and Volumes for Digital Currency', '2. Digital Currency Code': 'BTC', '4. Market Code': 'USD', '6. Last Refreshed': '2025-07-05 00:00:00', '7. Time Zone': 'UTC' },
      'Time Series (Digital Currency Daily)': {
        '2025-07-05': { '1. open': '108000.12345678', '2. high': '110000.00000000', '3. low': '107500.00000000', '4. close': '109500.50000000', '5. volume': '12345.67890000' },
        '2025-07-04': { '1. open': '107000.00000000', '2. high': '108500.00000000', '3. low': '106000.00000000', '4. close': '108000.12345678', '5. volume': '15000.00000000' }
      }
    };
    const bars = I.parseAlphaVantage(j, '1day', 'BTC-USD');
    assert.strictEqual(bars.length, 2);
    assert.deepStrictEqual(bars.map(b => b.time), ['2025-07-04', '2025-07-05']);
    assert.strictEqual(bars[1].open, 108000.12345678); assert.strictEqual(bars[1].close, 109500.5);
    assert.strictEqual(bars[1].high, 110000); assert.strictEqual(bars[1].low, 107500);
    assert.strictEqual(bars[1].volume, 12346, 'volume rounded to whole coins');
  });
  test('parseAlphaVantage: legacy DIGITAL_CURRENCY_DAILY shape ("1a. open (USD)" … "6. market cap") is accepted', () => {
    const j = {
      'Time Series (Digital Currency Daily)': {
        '2024-02-01': { '1a. open (USD)': '42500.00', '1b. open (USD)': '42500.00', '2a. high (USD)': '43200.00', '2b. high (USD)': '43200.00', '3a. low (USD)': '41900.00', '3b. low (USD)': '41900.00', '4a. close (USD)': '43050.00', '4b. close (USD)': '43050.00', '5. volume': '31000.5', '6. market cap (USD)': '31000.5' }
      }
    };
    const b = I.parseAlphaVantage(j, '1day', 'BTC-USD')[0];
    assert.deepStrictEqual(b, { time: '2024-02-01', open: 42500, high: 43200, low: 41900, close: 43050, volume: 31001 });
  });
  test('parseAlphaVantage: stock daily and intraday rows still parse (intraday stamps shift back one bar)', () => {
    const daily = I.parseAlphaVantage({ 'Time Series (Daily)': { '2025-07-03': { '1. open': '10', '2. high': '12', '3. low': '9', '4. close': '11', '5. volume': '100' } } }, '1day', 'AAPL');
    assert.deepStrictEqual(daily, [{ time: '2025-07-03', open: 10, high: 12, low: 9, close: 11, volume: 100 }]);
    const intra = I.parseAlphaVantage({ 'Time Series (5min)': { '2025-07-03 09:35:00': { '1. open': '10', '2. high': '12', '3. low': '9', '4. close': '11', '5. volume': '100' } } }, '5min', 'AAPL');
    assert.strictEqual(intra[0].time, D.time.nyToUnix(2025, 7, 3, 9, 30, 0));
    assert.throws(() => I.parseAlphaVantage({ 'Meta Data': {} }, '1day', 'AAPL'), /no bars/);
  });
  test('avField matches "1. open", "1a. open (USD)" and ignores unrelated keys', () => {
    assert.strictEqual(I.avField({ '1. open': '5' }, 1, 'open'), 5);
    assert.strictEqual(I.avField({ '1a. open (USD)': '7', '1b. open (USD)': '7' }, 1, 'open'), 7);
    assert.strictEqual(I.avField({ '1a. open (EUR)': '6', '1b. open (USD)': '7' }, 1, 'open'), 7, 'prefers the USD twin');
    assert.ok(Number.isNaN(I.avField({ '2. high': '9' }, 1, 'open')));
    assert.ok(Number.isNaN(I.avField({ '10. open': '9' }, 1, 'open')), 'prefix must match the whole number');
  });
  test('parseAlphaVantageRate: CURRENCY_EXCHANGE_RATE → crypto quote with bid/ask', () => {
    const j = { 'Realtime Currency Exchange Rate': {
      '1. From_Currency Code': 'BTC', '2. From_Currency Name': 'Bitcoin', '3. To_Currency Code': 'USD', '4. To_Currency Name': 'United States Dollar',
      '5. Exchange Rate': '109123.45000000', '6. Last Refreshed': '2025-07-05 12:34:56', '7. Time Zone': 'UTC', '8. Bid Price': '109120.00000000', '9. Ask Price': '109126.00000000' } };
    const q = I.parseAlphaVantageRate(j, 'btc-usd');
    assert.strictEqual(q.price, 109123.45); assert.strictEqual(q.symbol, 'BTC-USD'); assert.strictEqual(q.kind, 'crypto');
    assert.strictEqual(q.time, Date.UTC(2025, 6, 5, 12, 34, 56) / 1000);
    assert.strictEqual(q.bid, 109120); assert.strictEqual(q.ask, 109126);
    assert.throws(() => I.parseAlphaVantageRate({}, 'BTC-USD'), /no exchange rate/);
  });
  test('time helpers: unixToUtcDate / utcStringToUnix round-trip', () => {
    assert.strictEqual(D.time.unixToUtcDate(Date.UTC(2025, 6, 5, 23, 59) / 1000), '2025-07-05');
    assert.strictEqual(D.time.utcStringToUnix('2025-07-05 23:59:00'), Date.UTC(2025, 6, 5, 23, 59) / 1000);
    assert.strictEqual(D.time.utcStringToUnix('2025-07-05'), Date.UTC(2025, 6, 5) / 1000);
    assert.ok(Number.isNaN(D.time.utcStringToUnix('nope')));
  });
  test('status() still reports the NYSE market for the settings panel', () => {
    D.setSettings({ provider: 'demo' });
    const s = D.status();
    assert.strictEqual(s.provider, 'demo'); assert.strictEqual(s.market.kind, 'stock');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
