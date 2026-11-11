# Broward Trading

**A free, open-source paper-trading and technical-analysis lab with a built-in trading course.**
Static site, no build step, no accounts, no money. Open `index.html` and start learning.

> Broward Trading is an educational simulator. No real orders are placed and no money changes hands.
> Demo prices are generated, not real. Nothing here is investment advice. See [Disclaimer](#disclaimer).

---

## Contents

1. [What it is](#what-it-is)
2. [Screenshots](#screenshots)
3. [Features](#features)
4. [Quick start](#quick-start)
5. [Live market data and free-tier limits](#live-market-data-and-free-tier-limits)
6. [Architecture](#architecture)
7. [Course structure](#course-structure)
8. [Running the tests](#running-the-tests)
9. [Contributing](#contributing)
10. [Roadmap, business plan and other docs](#other-docs)
11. [Disclaimer](#disclaimer)
12. [License](#license)

---

## What it is

Broward Trading was built for students (first at Broward College, then anyone) who want to learn how
markets, charts, indicators, risk management and options work **by doing**, without risking a dollar.

It is three things in one static website:

| Part | What you get |
|---|---|
| **Simulator** | Candlestick charts, 15+ indicators, a composite BUY / SELL / HOLD signal that explains itself, a paper-trading account with market / limit / stop orders and shorting, a synthetic options chain with Greeks and payoff diagrams, and a strategy backtester with parameter optimisation. |
| **Course** | Six modules (30 lessons) from "what is a stock?" to writing and backtesting your own rule-based strategy. Every lesson links to a live exercise in the simulator. Quizzes track your progress and unlock a completion certificate. |
| **Data layer** | A deterministic **demo mode** that works offline with no key, plus optional **live mode** using your own free API key from Twelve Data, Finnhub or Alpha Vantage. Keys never leave your browser. |

Everything (portfolio, course progress, settings) is stored in your browser's `localStorage`. There is no server.

## Screenshots

<!-- TODO: replace placeholders with real captures (1600 px wide, dark theme) -->

| Dashboard | Course | Options lab | Backtester |
|---|---|---|---|
| ![Dashboard screenshot placeholder](docs/img/screenshot-dashboard.png) | ![Course screenshot placeholder](docs/img/screenshot-learn.png) | ![Options screenshot placeholder](docs/img/screenshot-options.png) | ![Backtest screenshot placeholder](docs/img/screenshot-backtest.png) |

## Features

### Dashboard (`index.html`)
- TradingView **lightweight-charts** candlesticks with volume, on daily, 1 h, 15 min, 5 min and 1 min bars.
- Overlays: SMA / EMA / WMA, Bollinger Bands, VWAP, Ichimoku cloud, pivots, support / resistance, Fibonacci retracements.
- Oscillator panes: RSI, MACD, Stochastic, ADX / DI, ATR, OBV.
- Automatic **candlestick-pattern detection** (doji, hammer, shooting star, engulfing, morning / evening star, three white soldiers / black crows) with plain-English descriptions.
- A **composite signal** that scores every indicator, shows the points each one contributed and *why*, and states clearly that it describes what indicators say right now, not what will happen next.
- Market status (pre-market, open, after-hours, closed, US holidays) in New York time.
- Watchlist and symbol search over a 40+ ticker demo universe; live search when a provider key is configured.

### Paper trading (`portfolio.html`)
- $100,000 starting balance (configurable, resettable), cash, positions, open orders, trade log and equity curve.
- Market, limit, stop and stop-limit orders with day / GTC time-in-force; shorting; optional commissions.
- Mark-to-market P&L, realised vs unrealised, day P&L, and statistics: total return, win rate, average win / loss, profit factor, max drawdown, Sharpe.

### Options lab (`portfolio.html`)
- Black-Scholes-Merton pricing and Greeks (delta, gamma, theta, vega, rho) and implied volatility.
- A synthetic option chain around spot with a volatility smile and bid / ask spread, using OCC-style contract ids.
- Payoff diagrams and `analyze()` for nine preset strategies (long call, long put, covered call, protective put, bull call spread, bear put spread, straddle, strangle, iron condor), each with max profit / loss, breakevens and a one-paragraph explanation.

### Strategy lab (`backtest.html`)
- Built-in strategies: SMA cross, RSI mean reversion, MACD cross, Bollinger bounce, breakout, composite signal, buy-and-hold.
- Honest statistics: return vs buy-and-hold, CAGR, win rate, profit factor, max drawdown, Sharpe, exposure, trade count; trades drawn as chart markers.
- Grid optimisation (capped at 200 combinations) with a lesson on why the best backtest is usually overfit.

### Course (`learn.html`)
- Six modules, five lessons each, with text, callouts, embedded live charts, exercises that send you to the simulator, and quizzes.
- Progress tracked per lesson and per quiz; a module progress bar; a **completion certificate** drawn to canvas when every lesson is done and quizzes average 80 % or better.

### Design
- Dark-first, light theme via OS preference or `data-theme`; IBM Plex Sans / Mono; one accent colour; green and red reserved for gain / loss. See `docs/BRAND.md`.
- Works on phones; keyboard-navigable; no emojis in UI copy.

## Quick start

### Option A — just open it
Download or clone this folder and double-click `index.html`. The dashboard, portfolio, options and backtester all work from `file://`.

> The course page loads lesson JSON with `fetch()`, which most browsers block on `file://`. For `learn.html`, use option B.

### Option B — serve locally (recommended)
Any static file server works. Pick one:

```bash
# Python 3 (preinstalled on macOS / most Linux)
cd broward-trading
python3 -m http.server 8080
# then open http://localhost:8080

# Node
npx serve .          # or: npx http-server -p 8080

# VS Code: install the "Live Server" extension and click "Go Live"
```

### Option C — GitHub Pages (free hosting)
1. Create a repository on GitHub (for example `broward-trading`).
2. From this folder: `git init` (if needed), `git add .`, `git commit -m "Initial import"`, `git remote add origin https://github.com/<you>/broward-trading.git`, `git push -u origin main`.
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`, Save.
4. Wait a minute, then open `https://<you>.github.io/broward-trading/`.

The `.nojekyll` file in this repo tells Pages to serve files exactly as they are. Full details, custom domains and troubleshooting are in [docs/DEPLOY.md](docs/DEPLOY.md).

### Turning on live data
Open the dashboard, click **Data settings**, choose a provider and paste your free API key. The key is stored in your browser only (`localStorage` key `bt.data`) and sent only to that provider, directly from your device. Clear it any time.

## Live market data and free-tier limits

Broward Trading never proxies market data through a server of ours; your browser talks to the provider. That keeps the project free to host, but it means **you bring your own key** and the app must respect each provider's free limits. The data layer (`js/data.js`) caches responses and rate-limits requests so a classroom of students does not burn through a key in a minute.

| Provider | Free tier (approximate, verify on their site) | Best for | Notes |
|---|---|---|---|
| **Demo mode** (default) | Unlimited, offline | Learning the tools, classrooms, no sign-up | Deterministic seeded random walk per symbol. Realistic shape, **not real prices**. Ticks every few seconds while the market is "open". |
| **Twelve Data** | 800 requests / day, 8 / minute | History (daily and intraday candles) and US quotes | Recommended for most students. Intraday and daily bars on the free plan; real-time for US stocks. Daily cap is the binding limit: one chart load with indicators is one request. |
| **Finnhub** | 60 requests / minute | Real-time US quotes, symbol search, company news | Quotes are real-time for US stocks on the free plan, but **candles require a paid plan**, so the app pairs Finnhub quotes with Twelve Data or demo history. |
| **Alpha Vantage** | 25 requests / day | End-of-day history when nothing else is available | Very tight daily cap. Intraday is delayed / limited on free. Fine for a daily chart of one or two symbols. |

What "accurate" means for an education tool, delayed vs real-time, consolidated vs single-exchange prices, and paid upgrade paths with rough prices are covered in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

When a key is missing or a request fails (including CORS or network errors), the data layer falls back to demo data and flags the result with `{fallback: true, reason}` so the UI can show a clear "demo" badge instead of pretending.

## Architecture

Plain ES2020 JavaScript, no bundler, no framework, no TypeScript. Every module is a classic `<script>` that attaches to the global namespace `window.BT` and can be loaded standalone (and unit-tested in Node with a `window` shim). The interface of every module is specified in [CONTRACTS.md](CONTRACTS.md); pages and modules are built against that contract, so you can replace one module without touching the others.

```
broward-trading/
├── index.html            Dashboard: chart, indicators, signal, watchlist, data settings
├── learn.html            Course player, progress, certificate
├── portfolio.html        Paper account, orders, options lab
├── backtest.html         Strategy lab and optimiser
├── about.html            Mission, disclaimer, pricing roadmap, FAQ
├── css/style.css         Shared design tokens and components (see docs/BRAND.md)
├── js/
│   ├── indicators.js     BT.ind       pure indicator math, patterns, composite signal
│   ├── data.js           BT.data      providers, cache, rate limits, demo generator, market hours
│   ├── paper.js          BT.paper     portfolio engine, orders, mark-to-market, stats
│   ├── options.js        BT.options   Black-Scholes, IV, synthetic chain, payoffs, strategies
│   ├── backtest.js       BT.backtest  strategies, runner, statistics, optimiser
│   ├── course.js         BT.course    lesson loader, markdown subset, progress, certificate
│   ├── app.js            dashboard UI (index.html)
│   ├── learn.js          course UI (learn.html)
│   └── portfolio.js      portfolio + options UI (portfolio.html)
├── course/
│   ├── index.json        module and lesson index
│   └── m*-*.json         one file per module with lesson blocks and quizzes
├── tests/                node tests/<module>.test.js, plain assert, no framework
├── docs/                 BRAND, ROADMAP, DATA_SOURCES, BUSINESS, DEPLOY
├── CONTRACTS.md          the module interfaces everything is built against
├── .nojekyll             tells GitHub Pages to serve files verbatim
└── LICENSE               MIT
```

### Module summary

| Module | Namespace | Responsibility |
|---|---|---|
| `js/indicators.js` | `BT.ind` | SMA / EMA / WMA, RSI, MACD, Bollinger, ATR, ADX, Stochastic, VWAP, OBV, Ichimoku, pivots, support / resistance, Fibonacci, candle patterns, `signals()` composite scoring, `computeAll()`. Pure functions; `null` where undefined. |
| `js/data.js` | `BT.data` | `providers.{demo,twelvedata,finnhub,alphavantage}` each with `candles`, `quote`, `search`; settings in `localStorage` `bt.data`; cache (60 s intraday / 10 min daily / 15 s quotes); per-provider rate limiter; demo random walk and `demoTick`; `marketStatus()` with NYSE hours and US holidays. |
| `js/paper.js` | `BT.paper` | State in `bt.portfolio`; `placeOrder`, `processOrders`, `markToMarket`, `closePosition`, `cancelOrder`, option positions by OCC id, `stats()`. |
| `js/options.js` | `BT.options` | `bs()`, `impliedVol()`, `chain()`, `payoff()`, `analyze()`, strategy presets, `occ()` / `parseOcc()`. |
| `js/backtest.js` | `BT.backtest` | Strategy objects with `onBar(ctx, i)`, built-ins, `run()` with cash / sizing / commission / slippage / shorting, `optimize()`. |
| `js/course.js` | `BT.course` | Loads `course/*.json`, `renderMd()` (escape first, then markdown), progress in `bt.course`, `certificateEligible()`, `certificate({name})` to canvas. |

Bars everywhere are `{time, open, high, low, close, volume}`, oldest to newest; `time` is `'YYYY-MM-DD'` for daily and unix seconds for intraday. Charts use lightweight-charts v4.2.0 from unpkg.

## Course structure

Six modules, roughly 5.5 hours of reading plus exercises. Each lesson ends with a quiz; the certificate unlocks when every lesson is marked done and quiz scores average 80 % or better.

| # | Module | Level | Minutes | Covers |
|---|---|---|---|---|
| 1 | Market Foundations | Beginner | 45 | What markets are, how orders work, what moves prices, why paper trading first |
| 2 | Reading Charts & Candlesticks | Beginner | 50 | Candlesticks, timeframes, trends, support / resistance, reversal patterns |
| 3 | Technical Indicators | Intermediate | 60 | Moving averages, RSI, MACD, Bollinger Bands, volume tools, the composite signal |
| 4 | Risk Management & Paper Trading | Intermediate | 55 | Position sizing, stops, expectancy, drawdowns, the trading journal |
| 5 | Options Basics | Advanced | 65 | Calls, puts, premium, Greeks, payoff diagrams, defined-risk strategies |
| 6 | Strategy & Backtesting | Advanced | 70 | Rules into strategies, honest backtests, overfitting, writing a trading plan |

Lessons are JSON (`course/<module>.json`) made of blocks: `text`, `callout`, `chart` (a live chart with overlays), `exercise` (a task plus a deep link into the simulator) and `quiz`. Adding a lesson is editing a JSON file; no code changes needed. The course is free and will stay free; see [docs/BUSINESS.md](docs/BUSINESS.md) for how a paid, verified certificate could sit on top of it.

## Running the tests

The pure modules have Node tests that need nothing but Node 18+:

```bash
node tests/indicators.test.js
node tests/paper.test.js
node tests/options.test.js
node tests/backtest.test.js

# syntax check everything
for f in js/*.js tests/*.js; do node --check "$f"; done
```

## Contributing

Contributions are welcome: lessons, indicators, strategies, translations, accessibility fixes, bug reports.

1. Read [CONTRACTS.md](CONTRACTS.md) and [docs/BRAND.md](docs/BRAND.md) first. Modules must keep their contract; pages must use the shared tokens.
2. Keep it plain: ES2020, no imports, no frameworks, no build step. Attach to `window.BT`.
3. Educational copy: plain English, second person, explain the *why* next to every number, never promise profits, never call anything "advice". Label simulated data as demo.
4. Run the tests and `node --check` before opening a pull request.
5. Open an issue before a large change so we can agree on the contract first.

Course content contributions should include sources for any factual claim and should not include real-money trade recommendations.

## Other docs

- [docs/ROADMAP.md](docs/ROADMAP.md) — what is done, what is next, what we will not build.
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — market-data options, accuracy, costs, recommendation.
- [docs/BUSINESS.md](docs/BUSINESS.md) — turning the course into a membership with verified certificates while the simulator stays free.
- [docs/DEPLOY.md](docs/DEPLOY.md) — GitHub Pages, custom domains, publishing from this folder.
- [docs/BRAND.md](docs/BRAND.md) — visual system and component catalogue.
- [CONTRACTS.md](CONTRACTS.md) — module interfaces.

## Disclaimer

Broward Trading is a free educational simulator. **No real orders are placed and no money changes hands.** Demo prices are generated by a seeded random walk and are not real market prices. Live prices come from the third-party provider you configure with your own key and may be delayed, incomplete or wrong. Indicators and the composite signal describe what a formula says about past prices; they do not predict the future. Nothing on this site is investment, legal or tax advice, and nothing is a recommendation to buy or sell any security. Trading real money involves risk, including the loss of your entire investment. Past performance, simulated or real, does not guarantee future results.

Broward Trading is an independent project and is not affiliated with, endorsed by or sponsored by Broward College or any broker, exchange or data provider.

## License

MIT. Copyright 2026 Broward Trading contributors. See [LICENSE](LICENSE).

Course text and lesson JSON are also MIT-licensed so teachers can adapt them. Third-party components keep their own licences: TradingView lightweight-charts (Apache-2.0), IBM Plex fonts (OFL-1.1). Market data belongs to its provider and is subject to their terms.
