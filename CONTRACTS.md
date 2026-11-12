# Broward Trading — module contracts (v0.2)

Static site, no build step, no framework. Every module is a classic `<script>` file that attaches to the global namespace `window.BT` (create it if missing: `window.BT = window.BT || {}`). Plain ES2020 JavaScript, no `import`/`export`, no TypeScript. Each module must be loadable standalone and must not touch the DOM unless it is a UI module (`js/app.js`, `js/learn.js`, `js/portfolio.js`, `js/backtest-ui.js`).

Chart library: TradingView lightweight-charts v4.2.0 UMD from
`https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js` (global `LightweightCharts`, v4 API: `addCandlestickSeries`, `addLineSeries`, `addHistogramSeries`, `createPriceLine`, `setMarkers`).

Bar shape everywhere: `{time, open, high, low, close, volume}` where `time` is `'YYYY-MM-DD'` for daily bars and a unix-seconds number for intraday bars. Arrays are oldest → newest.

## js/indicators.js → `BT.ind`
Pure functions. Every series function takes arrays and returns an array of the same length with `null` where undefined.
- `sma(values, n)`, `ema(values, n)`, `wma(values, n)`
- `rsi(closes, n=14)`
- `macd(closes, fast=12, slow=26, signal=9)` → `{macd:[], signal:[], hist:[]}`
- `bollinger(closes, n=20, k=2)` → `{upper:[], middle:[], lower:[], bandwidth:[]}`
- `atr(bars, n=14)`, `adx(bars, n=14)` → `{adx:[], plusDI:[], minusDI:[]}`
- `stochastic(bars, k=14, d=3)` → `{k:[], d:[]}`
- `vwap(bars)` (resets each day for intraday; cumulative for daily), `obv(bars)`
- `ichimoku(bars)` → `{tenkan, kijun, senkouA, senkouB, chikou}`
- `pivots(bars, left=5, right=5)` → `{highs:[{index,price}], lows:[{index,price}]}`
- `supportResistance(bars, lookback=120, max=3)` → `{support:[prices], resistance:[prices]}`
- `fibonacci(high, low)` → `[{level:0.236, price}, ...]` for 0, .236, .382, .5, .618, .786, 1
- `candlePatterns(bars)` → `[{index, name, bias:'bull'|'bear'|'neutral', description}]` for doji, hammer, shooting star, bullish/bearish engulfing, morning/evening star, three white soldiers / black crows
- `signals(bars, ind)` → composite scoring: `scoreAt(i)` style, returning `{score, max, state:'BUY'|'SELL'|'HOLD', reasons:[{pts,text,why}]}`; also `signalSeries(bars)` → array of states per bar, and `computeAll(bars)` → object holding every indicator above (what the dashboard needs in one call).

## js/data.js → `BT.data`
- `BT.data.providers`: `{demo, twelvedata, finnhub, alphavantage}`. Each provider: `async candles(symbol, interval, limit)` → bars, `async quote(symbol)` → `{price, time}`, `async search(query)` → `[{symbol,name,exchange}]` (demo returns a built-in list), `supports: {intervals:[...], realtime:boolean}`.
- Interval names: `'1day' | '1h' | '15min' | '5min' | '1min'`.
- `BT.data.getSettings()/setSettings({provider, keys:{twelvedata, finnhub, alphavantage}})` persisted in localStorage key `bt.data`.
- `BT.data.candles(symbol, interval, limit)` and `BT.data.quote(symbol)` use the configured provider with a localStorage cache (candles cached 60 s intraday / 10 min daily; quote 15 s) and a per-provider rate limiter honouring free tiers (Twelve Data 8/min & 800/day, Finnhub 60/min, Alpha Vantage 25/day). Fall back to demo with a `{fallback:true, reason}` flag on the returned array/object when a key is missing or a request fails (including CORS/CSP `TypeError`).
- `BT.data.demo(symbol, interval, limit)`: deterministic seeded random walk per symbol, plus `BT.data.demoTick(bars)` to mutate the last bar.
- `BT.data.marketStatus()` → `{open:boolean, phase:'pre'|'open'|'after'|'closed', nyTime:string}` for NYSE hours including weekends; US holidays list for the current and next year.
- Yahoo-style demo universe: at least 40 well-known US tickers with names and sectors for search and the watchlist.

## js/paper.js → `BT.paper`
Portfolio engine, persisted in localStorage key `bt.portfolio`. All money in dollars, numbers not strings.
- `BT.paper.load()/save()/reset(startingCash=100000)`; state: `{cash, startingCash, positions:{SYM:{qty, avg, kind:'stock'|'option', meta}}, orders:[], trades:[], equityHistory:[{t, equity}]}`. Negative `qty` = short.
- `placeOrder({symbol, side:'buy'|'sell', qty, type:'market'|'limit'|'stop'|'stop_limit', limitPrice, stopPrice, tif:'day'|'gtc'})` → order object with `status:'filled'|'open'|'rejected'` and `reason`. Market orders fill immediately at given `price` argument (`placeOrder(order, price)`). Commissions configurable (`settings.commission`, default 0).
- `processOrders(symbol, bar)`: fills open limit/stop orders against a bar's high/low.
- `markToMarket(prices)` where `prices = {SYM: price}` → `{equity, cash, marketValue, unrealized, realized, dayPnL}` and appends to equityHistory (deduped per minute).
- `closePosition(symbol, price)`, `cancelOrder(id)`.
- Options: positions keyed by an OCC-style contract id (`AAPL260117C00200000`) with `meta:{underlying, strike, expiry, right:'C'|'P', multiplier:100}`; `placeOptionOrder({contract, side, qty}, premium)`.
- `stats()` → `{totalReturnPct, winRate, trades, avgWin, avgLoss, profitFactor, maxDrawdownPct, sharpe}` computed from trades + equityHistory.

## js/options.js → `BT.options`
- `bs({S, K, T, r, sigma, type:'call'|'put'})` → `{price, delta, gamma, theta, vega, rho}` (Black-Scholes-Merton, T in years, theta per day).
- `impliedVol({price, S, K, T, r, type})` bisection.
- `chain(S, {expiries:[days...], ivBase})` → synthetic option chain: strikes around spot (2.5/5/10 increments by price), with bid/ask spread and a volatility smile; each row `{contract, strike, expiry, right, bid, ask, mid, iv, delta, gamma, theta, vega, oi, volume}`.
- `payoff(legs, Srange)` → `[{S, pnl}]` where `legs = [{right:'C'|'P'|'S'(stock), strike, qty, premium}]`; `strategies` presets: long call, long put, covered call, protective put, bull call spread, bear put spread, straddle, strangle, iron condor, each with a one-paragraph educational description, max profit/loss and breakevens via `analyze(legs)`.
- `occ(underlying, expiryISO, right, strike)` ↔ `parseOcc(id)`.

## js/backtest.js → `BT.backtest`
- Strategy definition: `{id, name, description, params:{...}, onBar(ctx, i) -> 'buy'|'sell'|null}` with `ctx = {bars, ind, position}`.
- Built-ins: `smaCross(fast,slow)`, `rsiReversion(low,high)`, `macdCross()`, `bollingerBounce()`, `breakout(n)`, `compositeSignal()` (uses `BT.ind.signals`), `buyAndHold`.
- `run(strategy, bars, {cash=100000, sizePct=100, commission=0, slippageBps=0, allowShort=false})` → `{trades:[{entryIndex, exitIndex, entry, exit, qty, pnl, pnlPct, bars}], equity:[{time, equity}], stats:{totalReturnPct, buyHoldReturnPct, cagr, winRate, profitFactor, maxDrawdownPct, sharpe, exposurePct, trades}, markers:[lightweight-charts markers]}`.
- `optimize(strategyFactory, bars, grid)` → ranked param sets (cap at 200 combos).

## js/course.js → `BT.course`
Course data lives in `course/*.json`, one file per module, loaded with `fetch('course/'+id+'.json')`, index in `course/index.json`: `{modules:[{id, title, level:'beginner'|'intermediate'|'advanced', minutes, summary, lessons:[{id,title}]}]}`.
Lesson JSON: `{id, title, minutes, blocks:[{type:'text', md}, {type:'callout', tone:'tip'|'warn'|'key', md}, {type:'chart', symbol, interval, overlays:['sma20',...], caption}, {type:'exercise', md, action:{page:'index.html', hash}}, {type:'quiz', questions:[{q, choices:[...], answer:index, explain}]}]}`. `md` is a small markdown subset: paragraphs, `**bold**`, `*italic*`, `- lists`, `### headings`, inline code.
- `BT.course.renderMd(md)` → safe HTML (escape first, then apply markdown).
- `BT.course.progress` persisted in localStorage `bt.course`: `{lessonsDone:{id:true}, quizScores:{lessonId:pct}, startedAt}`; `markDone(id)`, `recordQuiz(id, pct)`, `moduleProgress(moduleId)` → `{done, total, pct}`, `certificateEligible()` → true when every module's quizzes average ≥ 80 % and all lessons done.
- `BT.course.certificate({name})` draws a certificate on a `<canvas>` (1600×1130) and returns a dataURL; the page shows it as an `<img>` (downloads are blocked in some viewers, so also show "right-click / long-press to save").

## Pages
- `index.html` dashboard (existing v0.1, to be rewired onto the modules), `learn.html` course, `portfolio.html` paper account & options, `backtest.html` strategy lab, `about.html` (mission, disclaimer, pricing roadmap). Shared `css/style.css` with the existing token system (dark-first, light theme via `prefers-color-scheme` and `data-theme`). Shared top nav `<nav class="topnav">` on every page with links to all five pages and the active one marked.
- Every page shows the disclaimer footer: free educational simulator, no real orders, demo prices are simulated.

# v0.3 additions

## js/nav.js (shared shell) — the ONLY place nav/footer markup lives from now on
Every page replaces its hard-coded `<nav class="topnav">` and `<footer>` with `<div id="nav"></div>` right after `<body>` and `<div id="footer"></div>` at the end, and loads `js/nav.js` (after css). `BT.nav.mount()` runs automatically on DOMContentLoaded and injects: the top nav (desktop), a fixed bottom tab bar on phones (≤ 760px) with 5 primary tabs (Dashboard, Learn, Replay, Portfolio, More) where "More" opens a sheet listing every other page, the theme toggle (inline SVG icon, persists `bt.theme` to `data-theme`), the disclaimer footer, `<link rel="manifest" href="manifest.json">`, and service-worker registration of `sw.js` when `navigator.serviceWorker` exists and the page is served over http(s). Pages: index.html Dashboard · learn.html Learn · replay.html Replay · portfolio.html Portfolio · backtest.html Backtest · journal.html Journal · news.html News · compare.html Compare · glossary.html Glossary · pricing.html Pro · verify.html Verify certificate · about.html About. Active page detected from `location.pathname`. Body gets class `has-tabbar` on phones so pages add bottom padding.

## js/paper.js — multiple accounts
`BT.paper.use(accountId)` switches the active account ('main' default; 'replay' for Market Replay). Storage key `bt.portfolio` stays for 'main' (backward compatible); others use `bt.portfolio.<id>`. `BT.paper.accounts()` lists ids with equity. All existing functions act on the active account.

## js/replay.js → `BT.replay` + replay.html
Market Replay: choose symbol, interval, start date; the engine holds the full bar array but exposes only `bars.slice(0, cursor)`; `step()`, `play(speed)`, `pause()`, `jumpTo(date)`; intraday ticks can be simulated inside a bar (open→high/low→close sub-steps). Trades go through `BT.paper` on account 'replay' with fills at the current visible price; open limit/stop orders processed each step via `BT.paper.processOrders`. Shows hidden-future honesty note, a scorecard at the end (return vs buy-and-hold, trades, win rate, max drawdown) and saves a session summary list in `bt.replay.sessions`. Drills: presets (e.g. 'Trade the SMA crossover on MSFT 2024', '2022 bear market survival') from `course/drills.json`.

## js/alerts.js → `BT.alerts`
`add({symbol, kind:'price_above'|'price_below'|'rsi_above'|'rsi_below'|'sma_cross'|'signal_change', value})`, `list()`, `remove(id)`, `check(symbol, bars, ind)` → fired alerts; persisted `bt.alerts`; fires an in-page toast and, when permission granted, a `Notification`. Dashboard (js/app.js) gets an Alerts panel and calls `check` on every tick.

## js/journal.js → `BT.journal` + journal.html
Entries auto-created from `BT.paper` trades (keyed by trade id) plus manual entries: `{id, tradeId?, symbol, date, setup, tags[], emotion, confidence 1-5, notes, lessons, rating 1-5}`; stats by tag/setup/emotion; weekly review checklist; export as JSON/CSV text. Persisted `bt.journal`.

## js/auth.js → `BT.auth` + pricing.html + verify.html + server/
Client: `BT.auth.config = {apiBase:'', proGating:false, confirmSignIn:null}` (set in js/config.js, created by the auth agent); `signIn(email)` requests a magic link and records a pending sign-in (`bt.auth.pending`, 60 min), `handleCallback(opts?)` consumes `#code=` (exchanged via POST /auth/exchange; legacy `#session=` still accepted) and `#checkout=` after a redirect — the token is persisted only when it matches the pending sign-in's email, or when the same email is already signed in, or when the student confirms via `opts.confirm(email)` / `config.confirmSignIn(email)` / `window.confirm`; otherwise it is refused and revoked and the result carries `reason` ('invalid'|'wrong-account'|'declined'|'unconfirmed'|'network'|'not-configured') and `error`. `session()` → `{email, pro, expires}` from `bt.auth`, `isPro()`, `signOut()`, `checkout()` → redirects to Stripe Checkout session URL from the API, `issueCertificate({name})` → `{id, url}` or local-only fallback id when no apiBase, `verify(id)`, `leaderboard(code)`, `submitScore({classCode, nickname, stats})` (keeps the server's anonymous `ownerToken` in `bt.auth.lbToken` and sends it back). When `proGating` is true, lessons flagged `pro:true` in module JSON show a locked preview; default false so everything stays free now.
Server (`server/worker.js`, Cloudflare Worker + KV, free tier; `server/wrangler.toml`, `server/README.md`): routes POST /auth/magic-link (Resend email), GET /auth/callback?token (302 → site `#code=<one-time code>`), POST /auth/exchange {code} → {session, email} (browser-only, 60 s, single use), GET /me, POST /checkout (Stripe Checkout), POST /webhook/stripe (verify signature, set pro), POST /certificates (HMAC-signed id `BT-YYYY-XXXXXX`, store {name, issuedAt, modules, scorePct}), GET /verify/:id, GET /leaderboard & POST /leaderboard (opt-in classroom leaderboard keyed by class code; rows owned by HMAC(email) or HMAC(ownerToken), never IP). CORS limited to configured origins. No secrets in code; all via wrangler secrets.

## Other new pages
- glossary.html + js/glossary.js + course/glossary.json (≥ 120 terms, each with definition, example, related terms, lesson link) with search, A–Z, flashcard mode (spaced repetition light: again/hard/good, persisted `bt.flashcards`), and 'Daily 5' quiz drawn from course/questionbank.json (built from all module quizzes plus ≥ 60 new questions).
- news.html + js/news.js: company profile & news via Finnhub (`/stock/profile2`, `/company-news`, `/calendar/earnings`) or Alpha Vantage `OVERVIEW`; demo mode shows an explicit "connect a key" state with an educational explainer of earnings, P/E, market cap; never fabricate headlines.
- compare.html + js/compare.js: normalized % performance lines for up to 6 symbols, correlation matrix, watchlist heatmap tiles (% change), relative strength vs SPY, drawn with lightweight-charts and canvas.
- PWA: manifest.json (name Broward Trading, theme colors from tokens, icons/icon-192.png, icons/icon-512.png, icons/icon.svg), sw.js (precache app shell + course JSON, network-first for API hosts, never cache api.twelvedata.com / finnhub.io / alphavantage.co responses longer than 60 s).
- Course: course/m7-replay.json 'Practice Drills: Market Replay' (intermediate) and course/m8-capstone.json 'Capstone: Your Trading Plan' (advanced); index.json gains them; learn.js shows glossary term tooltips (`[[term]]` in md) and a 'Practice in Replay' button on drill blocks (`{type:'drill', drillId}`).
