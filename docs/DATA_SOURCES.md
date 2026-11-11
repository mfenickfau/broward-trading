# Market data sources for Broward Trading

How to get prices that are accurate enough to learn from, at no or very low cost, from a static website that has no server of its own.

Prices, limits and plan names below were checked while writing this in late 2026 and **will change**. Always confirm on the provider's pricing page before telling students what to expect. Where a number is a guess it says "about".

---

## 1. What "accurate" means for an education tool

Students do not need the same data a market maker needs. They need data that is **honest about what it is** and **consistent enough that the lessons hold**. Concretely:

| Property | Why it matters for learning | Our bar |
|---|---|---|
| **Correct OHLCV shape** | Candlestick lessons, patterns and every indicator assume open ≤ high, low ≤ close, etc. | Validate bars; drop or repair malformed ones; never display a candle with high < low. |
| **Consistent bar alignment** | A 15-minute bar that starts at 09:30 on one day and 09:35 on another breaks VWAP, session logic and comparisons. | Align intraday bars to the exchange session (09:30 New York) and label `time` in unix seconds. |
| **Split and dividend adjustment** | An unadjusted chart shows a fake 50 % crash on a 2-for-1 split; a moving average crossing that "crash" is a false lesson. | Prefer adjusted closes for daily history; tell the student which they are looking at. |
| **Known delay** | A "real-time" label on a 15-minute-delayed quote teaches students that prices move slower than they do, and that fills are easier than they are. | Show the provider and its delay next to every live price. Demo data is labelled demo. |
| **Consolidated vs single-exchange** | US stocks trade on 16 exchanges plus dark pools. A single-exchange feed (e.g. IEX only, about 2 to 3 % of volume) has gappy prices and tiny volume numbers. Consolidated SIP data is what brokers show. | Daily bars should be consolidated. Intraday single-exchange data is acceptable if labelled. |
| **Survivorship** | Backtesting only on companies that still exist flatters every strategy. | Teach it explicitly in Module 6; the free universe cannot fix it, so we say so. |
| **Volume** | Several free feeds report partial or zero volume intraday. OBV and VWAP lessons then mislead. | Hide volume-based indicators when the feed's volume is unreliable, with a note. |

**Real-time is not the goal.** For learning technical analysis on daily and hourly charts, 15-minute-delayed consolidated data is indistinguishable from real-time. Real-time matters only for the paper-trading *fill* experience on intraday charts, and even then a quote that is a few seconds behind the tape is fine. What is **not** fine is pretending.

## 2. The constraint: a static site has no server

Every page runs in the student's browser and calls the provider's API directly with the student's own key. That means:

- The provider must allow **cross-origin (CORS) requests** from a browser. Twelve Data, Finnhub, Alpha Vantage and Polygon do. Yahoo Finance's unofficial endpoints and most brokerage APIs do not, so they would need a proxy.
- The key is in the browser. That is acceptable for a **free-tier personal key** a student creates for themselves; it is not acceptable for a key we pay for, because anyone could read it from the page and spend our quota. Paid data therefore requires a tiny backend (see section 6).
- Rate limits are per key, and in a classroom every student has their own, so free tiers scale with the class. This is a feature.
- We never store or redistribute data. Each student gets data under their own agreement with the provider. Check each provider's terms: free tiers are usually for personal, non-commercial use, which is why the app never ships a shared key.

## 3. Options compared

### 3.1 Providers the app supports today

| | Twelve Data | Finnhub | Alpha Vantage | Demo mode |
|---|---|---|---|---|
| Free limits | 800 requests/day, 8/min | 60 requests/min (no stated daily cap) | 25 requests/day | none |
| Daily candles (free) | Yes, long history | **No, paid only** for stocks | Yes, 20+ years | Yes (synthetic) |
| Intraday candles (free) | Yes: 1, 5, 15, 30, 60 min | No (paid) | Limited; recent months, delayed | Yes |
| Quotes (free) | Real-time US stocks | Real-time US stocks | Delayed end-of-day style | Simulated ticks |
| Adjusted data | Yes (`adjust` parameter) | n/a on free | Daily adjusted endpoint is **premium** since 2024 | n/a |
| Symbol search | Yes | Yes | Yes (counts against the 25) | Built-in 40+ tickers |
| CORS | Yes | Yes | Yes | n/a |
| Credit-card required | No | No | No | No |
| Weak spot | Daily cap in a heavy session | No history | Tiny cap, slow | Not real |

**One request per chart load.** Loading a daily chart of one symbol with every indicator costs one candle request; indicators are computed locally. A student who opens 10 symbols on 3 intervals and refreshes a few times uses perhaps 50 requests. 800/day is comfortable for one person; 25/day is not.

### 3.2 Other free or cheap options considered

| Provider | Free tier | Why not (yet) |
|---|---|---|
| **Polygon.io** | 5 requests/min, end-of-day only, 2 years history | Good quality and CORS, but 5/min is painful in a UI and no intraday on free. Their $29/mo Starter plan (15-min delayed, unlimited requests) is a strong upgrade path; see section 5. |
| **Alpaca Market Data** | Free with an Alpaca account: IEX-only feed, 200 requests/min, real-time websocket | Excellent limits but IEX-only intraday (gappy, low volume) and requires creating a brokerage-adjacent account, which is a barrier for students. Their $99/mo plan is full SIP. Candidate for v1.0 behind a backend. |
| **Tiingo** | Free: end-of-day plus IEX intraday, 50/hour, 1000/day | Good adjusted daily data; no CORS from the browser in our tests, so needs a proxy. |
| **EODHD** | Free: 20 requests/day, one year of EOD | Too small. Paid from about $20/mo for all-world EOD. |
| **Marketstack** | Free: 100 requests/month, EOD only | Too small. |
| **Yahoo Finance (unofficial)** | Unlimited in practice | No API terms, no CORS, breaks without notice; unsuitable for a classroom or a product. |
| **Stooq / Nasdaq Data Link CSV** | Free daily CSV downloads | Fine for one-off offline datasets we might bundle as teaching examples (with attribution), not for live use. |
| **Brokerage APIs** (Schwab, Tradier, IBKR) | Free with a funded account | Requires a real brokerage account and OAuth; wrong fit for a no-money educational tool. |
| **Databento, Intrinio, Nasdaq Basic, Xignite** | Enterprise | Professional-grade, hundreds to thousands per month. Not needed. |

Note: the **IEX Cloud** API, long the default free choice, shut down in August 2024. Guides that still recommend it are out of date.

### 3.3 Delayed vs real-time, in plain terms

- **Real-time (SIP / consolidated):** what a broker shows. Exchanges charge for it; a provider offering it free to non-professionals is subsidising it or using a cheaper feed.
- **Real-time (single exchange):** usually IEX or a Cboe venue. Trade prices are correct for *those* trades but you see a fraction of the volume and some minutes have no trades at all in less-liquid names.
- **Delayed 15 minutes (consolidated):** exchanges let providers give this away. For daily, 4-hour and hourly charts it is identical to real-time. For a 1-minute paper-trading exercise it means your "market order" fills at a price from 15 minutes ago. The app shows the delay so students understand.
- **End-of-day:** one bar per day after the close. Enough for Modules 1 to 4 and 6; not for intraday lessons.

## 4. Recommendation

**For students (free):**

1. **Twelve Data free** as the default live provider. It is the only free tier that gives both daily and intraday candles plus real-time US quotes without a credit card and with CORS. The 800/day cap is the main risk; the app's caching (60 s intraday / 10 min daily) and rate limiter are tuned to it.
2. **Finnhub free** for the real-time quote and symbol search when a student wants the quote to update every few seconds without spending Twelve Data credits. The app pairs Finnhub quotes with Twelve Data (or demo) history.
3. **Alpha Vantage free** only as a last resort for daily history of a handful of symbols.
4. **Demo mode** for classrooms, offline, and the whole of Modules 1 and 2 where the *shape* of price action matters more than which company it is.

**For the project (when there is revenue):** add a small backend (Cloudflare Worker or Supabase Edge Function) that holds one paid key, caches aggressively, and serves 15-minute-delayed consolidated bars to logged-in members. Polygon Starter or Twelve Data Grow are the candidates; see section 5. Until then, bring-your-own-key is the honest design.

## 5. Upgrade paths and rough monthly prices

All approximate, in US dollars, as checked in late 2026. Verify before budgeting.

| Plan | About | What you get | When it makes sense |
|---|---|---|---|
| Twelve Data **Grow** | $29/mo | about 55 requests/min, higher daily cap, more intervals, WebSocket add-on | First upgrade for an individual power user or a single instructor demo machine. |
| Twelve Data **Pro** | $79/mo | about 610 requests/min, bulk endpoints | A shared backend serving a class. |
| Finnhub **paid** | from about $50 to $60/mo | Stock candles, higher limits, fundamentals | Only if we want Finnhub candles specifically; otherwise Twelve Data covers it. |
| Alpha Vantage **Premium** | $49.99/mo entry, up to about $250/mo | 75 to 1200 requests/min, adjusted daily endpoint | Weak value for us; included for completeness. |
| Polygon **Stocks Starter** | $29/mo | Unlimited requests, 15-min delayed, 5 years history, all intervals, consolidated | Best value for a backend serving delayed consolidated bars to many students. |
| Polygon **Developer** | $79/mo | Real-time consolidated data, longer history; confirm current tier names and limits on their pricing page | Real-time intraday paper trading for members. |
| Alpaca **Algo Trader Plus** | $99/mo | Full SIP real-time, 10,000 requests/min, WebSocket | Real-time at scale, once there is a backend and an Alpaca account. |
| Proxy hosting (Cloudflare Workers) | $0 to $5/mo | 100,000 requests/day free, then $5/mo for 10 million | The backend itself is nearly free; the data licence is the cost. |

A realistic "first paid month" budget for a backend serving a few hundred students on delayed data is **about $30 to $35**: one Polygon Starter or Twelve Data Grow key plus free Cloudflare Workers. Real-time for members roughly triples that.

## 6. Design of the optional data proxy (future)

When a shared paid key exists it must sit behind a proxy, never in the page:

```
browser (member, logged in)
   │  GET /bars?symbol=AAPL&interval=15min   (Authorization: member session)
   ▼
Cloudflare Worker / Supabase Edge Function
   │  1. verify session   2. check per-user quota   3. look in KV cache (keyed symbol+interval+bar time)
   │  4. on miss: call provider with the secret key   5. normalise to BT bar shape   6. store with TTL
   ▼
provider (Polygon / Twelve Data)
```

Rules:

- Cache TTL = the bar interval for intraday, until next close for daily. Hundreds of students viewing AAPL cost one upstream request per interval.
- Return `{bars, provider, delayMinutes, adjusted, cachedAt}` so the UI can label it.
- Enforce a per-user quota so one script cannot drain the shared key.
- Keep the provider's redistribution terms: data is served only to authenticated members for display, never offered for download in bulk.
- Keep the demo and bring-your-own-key paths working; the proxy is an addition, not a replacement, so the free product never depends on a bill being paid.

## 7. Provider notes for implementers

**Twelve Data.** `GET https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&outputsize=500&apikey=KEY` returns `values` newest first; reverse them. Intervals: `1min,5min,15min,30min,1h,1day`. Rate-limit responses come back as HTTP 200 with `{"code":429,...}`, so check the body. Add `&adjust=all` for adjusted daily data if the plan allows. Quotes: `/quote` or `/price`.

**Finnhub.** `GET https://finnhub.io/api/v1/quote?symbol=AAPL&token=KEY` gives `{c, h, l, o, pc, t}` (current, high, low, open, previous close, time). `/stock/candle` returns `{"s":"no_data"}` or HTTP 403 on free plans; treat as "candles unsupported" and do not retry. `/search?q=` for symbol lookup. Limit: 60/min, HTTP 429 when exceeded.

**Alpha Vantage.** `GET https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=AAPL&outputsize=compact&apikey=KEY`. Over-limit responses are HTTP 200 with an `Information` or `Note` field instead of data; detect that. `TIME_SERIES_DAILY_ADJUSTED` is premium. Intraday: `TIME_SERIES_INTRADAY&interval=15min` (free, recent data, may be delayed).

**All providers.** Treat `TypeError: Failed to fetch` as a possible CORS or content-security-policy block and fall back to demo with a reason, as the `BT.data` contract requires. Never log keys. Cache in `localStorage` with the provider name in the key so switching providers does not mix data.

## 8. Teaching students about data

Module 1 should include, and the dashboard should hint at, these three sentences:

1. "Demo prices are generated. They look like markets, they are not markets."
2. "Live prices come from the provider you chose, with the delay shown next to the price."
3. "Every indicator here is arithmetic on past prices. Better data makes the arithmetic truer, not predictive."
