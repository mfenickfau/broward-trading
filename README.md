# Broward Trading

[![Deploy to GitHub Pages](https://github.com/mfenickfau/broward-trading/actions/workflows/pages.yml/badge.svg)](https://github.com/mfenickfau/broward-trading/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A free, open-source paper-trading and technical-analysis lab with a built-in trading course in English and Spanish, Market Replay, a trading journal, classroom tools for instructors and an installable phone app.**
Static site, no build step, no accounts required, no money.

**Live site: <https://mfenickfau.github.io/broward-trading/>** (open it on your phone and add it to your home screen). Every push to `main` runs the unit tests and, when they pass, deploys this folder to GitHub Pages through the workflow the badge above links to.

> Broward Trading is an educational simulator. No real orders are placed and no money changes hands.
> Demo prices are generated, not real. Nothing here is investment advice. See [Disclaimer](#disclaimer).

---

## Contents

1. [What it is](#what-it-is)
2. [Screenshots](#screenshots)
3. [Features](#features)
4. [Pages](#pages)
5. [Quick start](#quick-start)
6. [Install it on your phone](#install-it-on-your-phone)
7. [Live market data and free-tier limits](#live-market-data-and-free-tier-limits)
8. [Architecture](#architecture)
9. [Course structure](#course-structure)
10. [Languages](#languages)
11. [Teaching with it](#teaching-with-it)
12. [How it compares](#how-it-compares)
13. [Membership backend (optional)](#membership-backend-optional)
14. [Running the tests](#running-the-tests)
15. [Contributing](#contributing)
16. [Other docs](#other-docs)
17. [Disclaimer](#disclaimer)
18. [License](#license)

---

## What it is

Broward Trading was built for students (first at Broward College, then anyone) who want to learn how
markets, charts, indicators, risk management and options work **by doing**, without risking a dollar.

It is five things in one static website:

| Part | What you get |
|---|---|
| **Simulator** | Candlestick charts, 15+ indicators, a composite BUY / SELL / HOLD signal that explains itself, a paper-trading account with market / limit / stop orders and shorting, price and indicator alerts, a synthetic options chain with Greeks and payoff diagrams, a strategy backtester with parameter optimisation, and a symbol comparison page with correlation and relative strength. The demo universe covers 50+ US stocks, 17 ETFs with expense ratios and three crypto pairs that trade 24/7. |
| **Market Replay** | Trade past data bar by bar with the future hidden. Ten graded drills (trend following, breakouts, range trading, bear-market survival, stop discipline, short selling, intraday) with a scorecard at the end and a separate practice account so your main portfolio stays clean. |
| **Course** | Nine modules (45 lessons) from "what is a stock?" through indicators, risk, options and backtesting to replay drills, a written trading plan, and crypto and ETFs. A guided **First Week** for complete beginners. Every lesson links to a live exercise. Quizzes track progress and unlock a printable certificate. A 220-term glossary with flashcards and a "Daily 5" quiz keeps the vocabulary fresh. The interface and the course are available in **English and Spanish**. |
| **Journal & review** | Every paper trade becomes a journal entry you tag with setup, emotion and confidence; stats by tag show where your edge and your leaks are; a weekly review checklist and export to JSON / CSV. |
| **Classroom** | Instructors create a six-character class code; students join from their phones with no email and no real name. The instructor page shows a roster (progress, quiz average, drills, journal counts, last active), a gradebook using the Teaching Guide's rubric and CSV export. It works entirely offline from pasted **share codes**, and syncs automatically when a school deploys the optional backend. |

Everything (portfolio, journal, course progress, settings) is stored in your browser's `localStorage`. The site works with no server at all. An **optional** Cloudflare Worker adds email sign-in, a Pro tier, server-verified certificates and classroom sync when a site owner chooses to deploy it; see [Membership backend](#membership-backend-optional).

## Screenshots

Captured by the Playwright smoke test (`tests/e2e.playwright.js`) at 1280 px and 390 px, dark theme.

| Dashboard | Course | Portfolio | Backtester |
|---|---|---|---|
| ![Dashboard](docs/screenshots/index-desktop.png) | ![Course](docs/screenshots/learn-desktop.png) | ![Portfolio](docs/screenshots/portfolio-desktop.png) | ![Backtest](docs/screenshots/backtest-desktop.png) |
| ![Dashboard on a phone](docs/screenshots/index-phone.png) | ![Course on a phone](docs/screenshots/learn-phone.png) | ![Portfolio on a phone](docs/screenshots/portfolio-phone.png) | ![Backtest on a phone](docs/screenshots/backtest-phone.png) |

Screenshots of the v0.4 pages (First Week, Instructor, printable certificate) are added when the e2e script's page list is extended; see `docs/ROADMAP.md`.

## Features

### Dashboard (`index.html`)
- TradingView **lightweight-charts** candlesticks with volume, on daily, 1 h, 15 min, 5 min and 1 min bars. Served from unpkg with a vendored fallback in `js/vendor/` so the chart works when the CDN is blocked or you are offline.
- Overlays: SMA / EMA / WMA, Bollinger Bands, VWAP, Ichimoku cloud, pivots, support / resistance, Fibonacci retracements.
- Oscillator panes: RSI, MACD, Stochastic, ADX / DI, ATR, OBV.
- Automatic **candlestick-pattern detection** (doji, hammer, shooting star, engulfing, morning / evening star, three white soldiers / black crows) with plain-English descriptions.
- A **composite signal** that scores every indicator, shows the points each one contributed and *why*, and states clearly that it describes what indicators say right now, not what will happen next.
- **Alerts panel** (new in v0.3): price above / below, RSI above / below, SMA cross, composite-signal change. Checked on every tick; in-page toast plus a browser `Notification` when you grant permission.
- Market status (pre-market, open, after-hours, closed, US holidays) in New York time; crypto symbols show as open 24/7.
- Watchlist and symbol search over a demo universe of 50+ US stocks, 17 ETFs (with expense ratio, issuer and what each one tracks) and three crypto pairs (BTC-USD, ETH-USD, SOL-USD); live search when a provider key is configured.
- A short first-run **tour** of the dashboard (also under the Tour button, or press `?`).
- Deep links: `index.html#symbol=NVDA&interval=1h&ov=sma20,bb&pane=rsi` opens exactly that chart; lessons use these for exercises.

### Market Replay (`replay.html`, new in v0.3)
- Pick a symbol, interval and start date. The engine holds every bar but shows only `bars.slice(0, cursor)`; step one bar, play at a chosen speed, pause, or jump to a date. Optional intraday ticks reveal each bar in four sub-steps (open, first extreme, second extreme, close) so stops and limits fill the way they would have inside the bar.
- Trades go through the paper engine on a dedicated **`replay` account**; resting limit / stop orders are processed on every step.
- A visible **hidden-future honesty note**, a **scorecard** at the end (return vs buy-and-hold, trades, win rate, max drawdown, pass / fail against the drill's criteria) and a session history in `bt.replay.sessions`.
- Ten **drills** from `course/drills.json`, each tied to a lesson, with objective, hints and graded criteria. "Practice in Replay" buttons in the course open them directly (`replay.html#drill=<id>`).

### Paper trading (`portfolio.html`)
- $100,000 starting balance (configurable, resettable), cash, positions, open orders, trade log and equity curve.
- Market, limit, stop and stop-limit orders with day / GTC time-in-force; shorting; optional commissions.
- Mark-to-market P&L, realised vs unrealised, day P&L, and statistics: total return, win rate, average win / loss, profit factor, max drawdown, Sharpe.
- **Multiple accounts** (new in v0.3): `main` for the dashboard and portfolio, `replay` for Market Replay; `BT.paper.use(id)` switches, `BT.paper.accounts()` lists them with equity. Storage stays backward compatible.

### Options lab (`portfolio.html`)
- Black-Scholes-Merton pricing and Greeks (delta, gamma, theta, vega, rho) and implied volatility.
- A synthetic option chain around spot with a volatility smile and bid / ask spread, using OCC-style contract ids.
- Payoff diagrams and `analyze()` for nine preset strategies (long call, long put, covered call, protective put, bull call spread, bear put spread, straddle, strangle, iron condor), each with max profit / loss, breakevens and a one-paragraph explanation.

### Strategy lab (`backtest.html`)
- Built-in strategies: SMA cross, RSI mean reversion, MACD cross, Bollinger bounce, breakout, composite signal, buy-and-hold.
- Honest statistics: return vs buy-and-hold, CAGR, win rate, profit factor, max drawdown, Sharpe, exposure, trade count; trades drawn as chart markers.
- Grid optimisation (capped at 200 combinations) with a lesson on why the best backtest is usually overfit.

### Trading journal (`journal.html`, new in v0.3)
- Entries are created automatically from paper and replay fills (keyed by trade id) and can be added by hand.
- Each entry: symbol, date, **setup** (19 presets), **tags**, **emotion** (calm, confident, hesitant, bored, FOMO, anxious, greedy, revenge, tired), **confidence 1-5**, notes, lessons, **rating 1-5**.
- Stats grouped by setup, tag and emotion; a seven-item **weekly review checklist** with "why it matters" for each item and four review questions.
- Export as JSON or CSV text (copy or save; nothing leaves the browser).

### Glossary, flashcards and Daily 5 (`glossary.html`, new in v0.3)
- 220 terms, each with a definition, an example, related terms and a link to the lesson that teaches it. Search and A-Z browsing.
- **Flashcard mode** with light spaced repetition (again / hard / good, persisted in `bt.flashcards`).
- **Daily 5**: five questions a day, deterministic per calendar day, drawn from a 230-question bank built from every module quiz plus new questions; streak tracking.
- Lessons show glossary tooltips wherever the text uses `[[term]]`.

### News and fundamentals (`news.html`, new in v0.3)
- Company profile, key statistics, earnings calendar and headlines via Finnhub, or company overview via Alpha Vantage, using your own key.
- Headlines classified by type (earnings, guidance, analyst, product, legal, deal, macro, insider) and "what moved it?" prompts framed as questions, never claims.
- **Demo mode never fabricates headlines.** Without a key the page shows an explicit "connect a key" state and an educational explainer of earnings, P/E and market cap.

### Compare (`compare.html`, new in v0.3)
- Up to six symbols rebased to 100 on one chart, over selectable periods.
- Correlation matrix (canvas heatmap with values), beta and **relative strength vs SPY**, per-symbol stats (return, volatility, max drawdown, Sharpe).
- Watchlist **heatmap tiles** sized and coloured by % change, with a plain-English diversification note.

### Course (`learn.html`)
- Nine modules, five lessons each, with text, callouts, embedded live charts, exercises that send you to the simulator, drills that send you to Replay, and quizzes. Module 9 (new in v0.4) covers crypto and ETFs with the same risk discipline as the rest of the course.
- Progress tracked per lesson and per quiz; a module progress bar; an **Up next** recommendation (start, resume, next lesson, take or retake a quiz, claim the certificate); a **completion certificate** drawn to canvas when every lesson is done and quizzes average 80 % or better.
- Certificates can be verified at `verify.html`. Browser-issued certificates carry an id starting with `BT-YYYY-L…`; server-verified ones (when the optional backend is deployed) carry a signed id and are checked against the server.
- **Print / Save as PDF** (new in v0.4) in every lesson, for one lesson or a whole module: `css/print.css` hides the shell, prints prose at a readable size, replaces live charts with their captions, prints quizzes as worksheets and starts each lesson on a new page. The button is hidden where `window.print` is unavailable or the page is framed.
- **Printable certificate** `certificate.html` (new in v0.4): a standalone landscape sheet with name, course, date, certificate id, verify URL and signature line, filled from the saved certificate record or from query parameters.
- Lessons whose Spanish translation does not exist yet show a small **English only** badge instead of failing; see [Languages](#languages).

### First Week (`start.html`, new in v0.4)
- A seven-day path for complete beginners (about twenty minutes a day): get your bearings, read a chart, your first paper trade, risk before reward, indicators honestly, travel back in time (Replay), make it a habit.
- Three tasks a day defined in `course/firstweek.json`, each with a "why", steps and a check. Most checks **tick themselves** from what is already in your browser (lesson done, quiz score, a trade placed, a stop under an open position, an alert set, a Replay drill finished, a journal entry, flashcards reviewed, Daily 5 played); manual tasks have a checkbox.
- Days unlock in order but can be skipped. Progress in `bt.onboarding`; a compact "Your first week" card on the course home links here.
- Honest framing on the page itself: one week makes the tools and habits familiar; it does not make anyone a profitable trader.

### Classroom (`learn.html` card and `instructor.html`, new in v0.4)
- **Students** join a class with a six-character code (never containing `0`, `O`, `1` or `I`) and an optional display name. The app builds a pseudonymous **snapshot** (random student id, lessons done, quiz scores, drill scorecards, paper-account stats, journal counts, Daily 5 streak). Without a backend it produces a **share code** (`BT1.` + compressed JSON) to paste to the instructor; with the backend it posts snapshots automatically after each finished lesson or quiz and at most every five minutes otherwise.
- **Instructors** create classes (name, section, term), paste many share codes at once or refresh from the server, and get a sortable roster, a per-student drawer with module breakdown and drill history, a **gradebook** with the Teaching Guide's weights (editable) and manual overrides, roster and gradebook **CSV export**, backup / restore JSON, and a privacy notice. Instructor data lives in `bt.instructor`.
- Privacy by design: no emails, no real names unless typed, no journal text, no trade lists, no IP addresses stored. Details and the FERPA-minded data-minimisation notes are in [docs/INSTRUCTOR_GUIDE.md](docs/INSTRUCTOR_GUIDE.md).

### Crypto and ETFs (new in v0.4)
- The demo universe gains **BTC-USD, ETH-USD and SOL-USD** with a 24/7 calendar in the demo generator and `marketStatus(symbol)` reporting them open around the clock, and **17 ETFs** (index, sector, international, bond, commodity) tagged `kind:'etf'` with expense ratio, issuer, holdings and what each tracks.
- Provider symbol mapping is handled for you (`BTC/USD` on Twelve Data, `BINANCE:BTCUSDT` on Finnhub, `DIGITAL_CURRENCY_DAILY` on Alpha Vantage).
- **Module 9, Crypto & ETFs: Different Markets, Same Discipline**, teaches what an ETF is and what the expense ratio costs, the ETF families (including why leveraged ETFs decay), what crypto is and how 24/7 trading changes risk, position sizing when volatility triples, and applying the same technical toolkit on a different clock. Crypto *trading* with leverage is deliberately not simulated; see [docs/ROADMAP.md](docs/ROADMAP.md).

### Pro and verification (`pricing.html`, `verify.html`, new in v0.3)
- `pricing.html` states plainly that everything is free today and lists what Pro will add (verified certificate, instructor dashboard and classroom leaderboard, lesson PDFs, priority support). Sign-in and checkout appear only when a site owner has configured the backend in `js/config.js`.
- `verify.html` checks a certificate id, locally for browser-issued ids and against the API for signed ones.
- `proGating` is `false` by default: no lesson is ever locked unless a site owner turns it on *and* marks lessons `pro:true`.

### Phone app (PWA, new in v0.3)
- `manifest.json`, `sw.js` and icons make the site installable on iPhone and Android with an app icon, standalone window and offline app shell. See [docs/MOBILE.md](docs/MOBILE.md).
- On screens up to 760 px wide a **fixed bottom tab bar** shows Dashboard, Learn, Replay, Portfolio and More; "More" opens a sheet with every other page, the theme switch and an Install button when the browser offers one.
- Every page is laid out for 390 px: tap targets at least 44 px, no horizontal scroll, collapsible panels.
- Market data is never cached by the service worker for longer than 60 s (in practice it is never cached at all; `js/data.js` keeps its own short cache).

### Spanish interface and course (new in v0.4)
- An **EN / ES** toggle in the nav (and the More sheet on phones) switches the whole interface without reloading. `js/i18n.js` translates the live DOM from a dictionary of exact English strings (`i18n/es.json`, 2,700+ entries), watches for content added later, and restores English when you switch back. `BT.t()` translates strings built in JavaScript; `Intl` formatters follow the active locale.
- Course content is translated file by file: `course/es/<same file>.json` with identical ids, structure and quiz answers. Anything not yet translated falls back to English with an "English only" badge. How it works and how to add a language: [docs/I18N.md](docs/I18N.md).

### Design
- Dark-first, light theme via OS preference or `data-theme` (toggle persisted in `bt.theme`); IBM Plex Sans / Mono; one accent colour; green and red reserved for gain / loss. See `docs/BRAND.md`.
- Keyboard-navigable; no emojis in UI copy; shared nav and footer injected by one module (`js/nav.js`) so every page stays consistent.

## Pages

| Page | What it does | Primary tab on phones |
|---|---|---|
| `index.html` | Dashboard: chart, indicators, signal, alerts, watchlist, trade ticket, data settings, first-run tour | Dashboard |
| `learn.html` | Course player, progress, Up next, First Week card, Classroom card, certificate | Learn |
| `start.html` | First Week: seven days of guided first steps for beginners | More |
| `replay.html` | Market Replay and drills | Replay |
| `portfolio.html` | Paper account, orders, options lab | Portfolio |
| `backtest.html` | Strategy lab and optimiser | More |
| `journal.html` | Trading journal, stats, weekly review, export | More |
| `news.html` | Company profile, earnings, headlines (key required) | More |
| `compare.html` | Relative performance, correlation, heatmap, RS vs SPY | More |
| `glossary.html` | Glossary, flashcards, Daily 5 | More |
| `instructor.html` | Instructor: class codes, roster, gradebook, share-code import, CSV export | More |
| `pricing.html` | What is free, what Pro will add, sign-in when configured | More |
| `verify.html` | Certificate verification | More |
| `certificate.html` | Printable certificate (linked from Learn, not in the nav) | — |
| `about.html` | Mission, data sources, disclaimer, roadmap, FAQ | More |

## Quick start

### Option A: just open it
Download or clone this folder and double-click `index.html`. The dashboard, portfolio, options and backtester all work from `file://`.

> Pages that load JSON with `fetch()` (`learn.html`, `replay.html` drills, `glossary.html`) are blocked by most browsers on `file://`, and the service worker only registers over http(s). Use option B for the full site.

### Option B: serve locally (recommended)
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

### Option C: use the live site
The current `main` branch is always at **<https://mfenickfau.github.io/broward-trading/>**. Nothing to install; add it to your home screen from there.

### Option D: host your own copy on GitHub Pages (free)
1. Fork or push this repository to GitHub (for example `broward-trading`).
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included workflow `.github/workflows/pages.yml` runs every `tests/*.test.js` on each push to `main` and deploys the folder only when they all pass, so a broken test never reaches students.
3. Wait a minute, then open `https://<you>.github.io/broward-trading/`. (If you prefer the simpler "Deploy from a branch" mode, that works too; the `.nojekyll` file tells Pages to serve files exactly as they are.)

GitHub Pages is served over HTTPS, which is what the service worker and "Add to Home Screen" need. Full details, custom domains, service-worker cache busting and troubleshooting are in [docs/DEPLOY.md](docs/DEPLOY.md).

### Turning on live data
Open the dashboard, tap **Data settings**, choose a provider and paste your free API key. The key is stored in your browser only (`localStorage` key `bt.data`) and sent only to that provider, directly from your device. Clear it any time.

## Install it on your phone

Once the site is served over HTTPS (GitHub Pages does this for you):

- **iPhone / iPad (Safari)**: Share button → **Add to Home Screen** → Add.
- **Android (Chrome)**: the three-dot menu → **Install app** (or **Add to Home screen**), or tap **Install app** in the More sheet when Chrome offers it.

You get an icon, a full-screen window without browser chrome, and the app shell and course work offline in demo mode. Step-by-step with troubleshooting, plus tips for using the charts and order ticket on a small screen, are in [docs/MOBILE.md](docs/MOBILE.md).

## Live market data and free-tier limits

Broward Trading never proxies market data through a server of ours; your browser talks to the provider. That keeps the project free to host, but it means **you bring your own key** and the app must respect each provider's free limits. The data layer (`js/data.js`) caches responses and rate-limits requests so a classroom of students does not burn through a key in a minute.

| Provider | Free tier (approximate, verify on their site) | Best for | Notes |
|---|---|---|---|
| **Demo mode** (default) | Unlimited, offline | Learning the tools, classrooms, Replay drills, no sign-up | Deterministic seeded random walk per symbol. Realistic shape, **not real prices**. Ticks every few seconds while the market is "open". Every student sees the same bars, which is what makes drills gradable. |
| **Twelve Data** | 800 requests / day, 8 / minute | History (daily and intraday candles) and US quotes | Recommended for most students. Intraday and daily bars on the free plan; real-time for US stocks. Daily cap is the binding limit: one chart load with indicators is one request. |
| **Finnhub** | 60 requests / minute | Real-time US quotes, symbol search, company profile, news, earnings calendar | Quotes, profiles and news are free; **candles require a paid plan**, so the app pairs Finnhub quotes with Twelve Data or demo history. The News page works best with a Finnhub key. |
| **Alpha Vantage** | 25 requests / day | End-of-day history and company overview when nothing else is available | Very tight daily cap. Intraday is delayed / limited on free. Fine for a daily chart of one or two symbols. |

What "accurate" means for an education tool, delayed vs real-time, consolidated vs single-exchange prices, and paid upgrade paths with rough prices are covered in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

When a key is missing or a request fails (including CORS or network errors), the data layer falls back to demo data and flags the result with `{fallback: true, reason}` so the UI can show a clear "demo" badge instead of pretending. The News page is the one exception: it never falls back to invented content; it shows the "connect a key" state instead.

## Architecture

Plain ES2020 JavaScript, no bundler, no framework, no TypeScript. Every module is a classic `<script>` that attaches to the global namespace `window.BT` and can be loaded standalone (and unit-tested in Node with a `window` shim). The interface of every module is specified in [CONTRACTS.md](CONTRACTS.md); pages and modules are built against that contract, so you can replace one module without touching the others.

```
broward-trading/
├── index.html            Dashboard: chart, indicators, signal, alerts, watchlist, data settings, tour
├── learn.html            Course player, progress, Up next, First Week and Classroom cards, certificate
├── start.html            First Week: seven-day beginner path
├── replay.html           Market Replay and drills
├── portfolio.html        Paper account, orders, options lab
├── backtest.html         Strategy lab and optimiser
├── journal.html          Trading journal, stats, weekly review, export
├── news.html             Company profile, earnings, headlines (key required)
├── compare.html          Relative performance, correlation, heatmap, RS vs SPY
├── glossary.html         Glossary, flashcards, Daily 5
├── instructor.html       Instructor: classes, roster, gradebook, share-code import, CSV export
├── pricing.html          Free vs Pro, sign-in and checkout when the backend is configured
├── verify.html           Certificate verification
├── certificate.html      Printable certificate (landscape print CSS)
├── about.html            Mission, disclaimer, roadmap, FAQ
├── manifest.json         PWA manifest (name, colours, icons, shortcuts)
├── sw.js                 Service worker: precached app shell, never caches market data
├── icons/                icon.svg, icon-192.png, icon-512.png
├── css/
│   ├── style.css         Shared design tokens and components (see docs/BRAND.md)
│   └── print.css         Print stylesheet: lessons as readable pages, quizzes as worksheets, certificate sheet
├── i18n/
│   └── es.json           Spanish UI dictionary: { ui: {English: Spanish}, attrs: {...} }
├── js/
│   ├── nav.js            BT.nav        the ONLY place nav, tab bar, footer, theme, EN/ES toggle, manifest + SW live
│   ├── config.js         BT.config     site owner settings: apiBase, proGating (public, no secrets)
│   ├── i18n.js           BT.i18n, BT.t DOM-based translation, dictionaries, Intl formatters
│   ├── indicators.js     BT.ind        pure indicator math, patterns, composite signal
│   ├── data.js           BT.data       providers, cache, rate limits, demo generator, market hours, crypto / ETF universe
│   ├── paper.js          BT.paper      portfolio engine, multiple accounts, orders, mark-to-market, stats
│   ├── options.js        BT.options    Black-Scholes, IV, synthetic chain, payoffs, strategies
│   ├── backtest.js       BT.backtest   strategies, runner, statistics, optimiser
│   ├── course.js         BT.course     language-aware lesson loader, markdown subset, progress, Up next, certificate
│   ├── replay.js         BT.replay     hidden-future replay engine, drills, scorecard, sessions
│   ├── alerts.js         BT.alerts     alert definitions, evaluation, notifications
│   ├── journal.js        BT.journal    entries, auto-sync from fills, stats, review, export
│   ├── glossary.js       BT.glossary   terms, search, flashcards, Daily 5
│   ├── news.js           BT.news       Finnhub / Alpha Vantage adapters, classification, explainers
│   ├── compare.js        BT.compare    align, rebase, correlation, beta, RS, heatmap maths
│   ├── auth.js           BT.auth       membership client; works offline when apiBase is ''
│   ├── classroom.js      BT.classroom  student side: join a class, snapshot, share codes, sync
│   ├── onboarding.js     BT.onboarding First Week tasks and self-ticking checks
│   ├── app.js            dashboard UI (index.html)
│   ├── learn.js          course UI (learn.html)
│   ├── portfolio.js      portfolio + options UI (portfolio.html)
│   ├── backtest-ui.js    strategy lab UI (backtest.html)
│   ├── instructor.js     instructor UI (instructor.html): roster, gradebook, exports
│   └── vendor/           lightweight-charts 4.2.0 fallback + its licence
├── course/
│   ├── index.json        module and lesson index (9 modules, 45 lessons)
│   ├── m1-…m9-*.json     one file per module with lesson blocks and quizzes
│   ├── firstweek.json    First Week: 7 days × 3 tasks with self-checks
│   ├── drills.json       Market Replay drills
│   ├── glossary.json     220 terms
│   ├── questionbank.json 300+ questions for Daily 5
│   └── es/               Spanish course files with the same names and ids (added file by file)
├── server/               optional Cloudflare Worker (worker.js, wrangler.toml, README.md)
├── tests/                node tests/<module>.test.js, plain assert, no framework; e2e.playwright.js
├── docs/                 BRAND, ROADMAP, CHANGELOG, DATA_SOURCES, BUSINESS, DEPLOY, MOBILE, TEACHING_GUIDE,
│                         INSTRUCTOR_GUIDE, I18N, MARKETING, COMPETITIVE_ANALYSIS, MEMBERSHIP_SETUP, screenshots/
├── .github/workflows/pages.yml   CI: run every unit test, then deploy to GitHub Pages
├── CONTRACTS.md          the module interfaces everything is built against
├── .nojekyll             tells GitHub Pages to serve files verbatim
└── LICENSE               MIT
```

### Module summary

| Module | Namespace | Responsibility |
|---|---|---|
| `js/nav.js` | `BT.nav` | Injects top nav, phone tab bar and "More" sheet, theme toggle (`bt.theme`), disclaimer footer, manifest link, service-worker registration. Pages contain only `<div id="nav"></div>` and `<div id="footer"></div>`. |
| `js/indicators.js` | `BT.ind` | SMA / EMA / WMA, RSI, MACD, Bollinger, ATR, ADX, Stochastic, VWAP, OBV, Ichimoku, pivots, support / resistance, Fibonacci, candle patterns, `signals()` composite scoring, `computeAll()`. Pure functions; `null` where undefined. |
| `js/data.js` | `BT.data` | `providers.{demo,twelvedata,finnhub,alphavantage}` each with `candles`, `quote`, `search`; settings in `bt.data`; cache (60 s intraday / 10 min daily / 15 s quotes); per-provider rate limiter; demo random walk and `demoTick`; `marketStatus()` with NYSE hours and US holidays. |
| `js/paper.js` | `BT.paper` | `use(accountId)` / `accounts()`; state in `bt.portfolio` (main) and `bt.portfolio.<id>`; `placeOrder`, `processOrders`, `markToMarket`, `closePosition`, `cancelOrder`, option positions by OCC id, `stats()`. |
| `js/options.js` | `BT.options` | `bs()`, `impliedVol()`, `chain()`, `payoff()`, `analyze()`, strategy presets, `occ()` / `parseOcc()`. |
| `js/backtest.js` | `BT.backtest` | Strategy objects with `onBar(ctx, i)`, built-ins, `run()` with cash / sizing / commission / slippage / shorting, `optimize()`. |
| `js/course.js` | `BT.course` | Loads `course/*.json`, `renderMd()` (escape first, then markdown), progress in `bt.course`, `certificateEligible()`, `certificate({name})` to canvas. |
| `js/replay.js` | `BT.replay` | `step()`, `play(speed)`, `pause()`, `jumpTo(date)`, tick sub-steps, trades on the `replay` account, scorecard, drills from `course/drills.json`, sessions in `bt.replay.sessions`, save-to-journal. |
| `js/alerts.js` | `BT.alerts` | `add()`, `list()`, `remove()`, `check(symbol, bars, ind)`; persisted `bt.alerts`; toast + `Notification`. Fires on the transition into the condition. |
| `js/journal.js` | `BT.journal` | Entries in `bt.journal`, `sync()` from every paper account, stats by setup / tag / emotion, weekly review checklist and questions, `exportJSON()` / `exportCSV()`. |
| `js/glossary.js` | `BT.glossary` | `load()`, `search()`, `get()`, `linkify()`; `flashcards.*` in `bt.flashcards`; `daily.*` in `bt.daily5`. |
| `js/news.js` | `BT.news` | `source()`, `load(symbol)`, normalisers for Finnhub and Alpha Vantage, `classifyHeadline()`, `whatMovedIt()`, explainers; cache in `bt.news.cache`. |
| `js/compare.js` | `BT.compare` | `align()`, `rebase()`, `returns()`, `pearson()`, `correlationMatrix()`, `beta()`, `relativeStrength()`, `stats()`, `heat()`, `drawMatrix()`. |
| `js/auth.js` | `BT.auth` | `signIn(email)`, `session()`, `isPro()`, `signOut()`, `checkout(plan)`, `issueCertificate({name})`, `verify(id)`, `leaderboard()` / `submitScore()`; fully functional in local-only mode when `apiBase` is empty. |
| `js/i18n.js` | `BT.i18n`, `BT.t` | `lang()` / `setLang(code)` (persisted `bt.lang`, sets `<html lang>`, fires `bt:lang`), `translatePage()` over text nodes and `placeholder` / `title` / `aria-label` / `alt`, MutationObserver for later content, `BT.t(str, vars)` with `{name}` interpolation, `fmtNumber` / `fmtMoney` / `fmtPercent` / `fmtDate`, `addLang()`. |
| `js/classroom.js` | `BT.classroom` | `join(code, name)` / `leave()`, `snapshot()`, `encodeShare()` / `decodeShare()` / `parseShareCodes()`, `sync(reason)` to the Worker when `apiBase` is set (throttled 5 min, immediate after lesson / quiz); state in `bt.classroom`. |
| `js/onboarding.js` | `BT.onboarding` | Loads `course/firstweek.json`; `status()` evaluates every task's check against localStorage; manual ticks and day unlocks in `bt.onboarding`. |
| `js/instructor.js` | (UI) | Classes, roster maths, gradebook with editable weights, share-code import, CSV / JSON exports; state in `bt.instructor`. |

Bars everywhere are `{time, open, high, low, close, volume}`, oldest to newest; `time` is `'YYYY-MM-DD'` for daily and unix seconds for intraday. Charts use lightweight-charts v4.2.0 from unpkg with the vendored copy as fallback.

### Browser storage keys

`bt.data`, `bt.portfolio`, `bt.portfolio.replay`, `bt.course`, `bt.cert`, `bt.theme`, `bt.lang`, `bt.i18n.<code>` (cached dictionary), `bt.alerts`, `bt.journal`, `bt.replay.sessions`, `bt.flashcards`, `bt.daily5`, `bt.news.cache`, `bt.auth`, `bt.auth.certs`, `bt.classroom`, `bt.onboarding`, `bt.tour.done`, `bt.instructor`, `bt.instructor.ui`, plus dashboard preferences (`bt.sym`, `bt.tf`, `bt.ov`, `bt.panes`, `bt.watchlist`, `bt.lines`). Clearing site data resets all of them; the journal, portfolio progress and instructor data can be exported first.

## Course structure

Nine modules, roughly 8.5 hours of reading plus exercises and drills. Each lesson ends with a quiz; the certificate unlocks when every lesson is marked done and quiz scores average 80 % or better.

| # | Module | Level | Minutes | Covers |
|---|---|---|---|---|
| 1 | Market Foundations | Beginner | 52 | What a stock is, exchanges and hours, bid / ask / spread, order types, brokers and paper trading |
| 2 | Reading Charts & Candlesticks | Beginner | 52 | Candlesticks and timeframes, trend, support / resistance, trend lines and volume, candle patterns, chart patterns |
| 3 | Technical Indicators | Intermediate | 58 | Moving averages, RSI and stochastic, MACD / Bollinger / ATR, ADX / VWAP / Ichimoku, the composite signal |
| 4 | Risk Management & Paper Trading | Intermediate | 56 | Position sizing and the 1 % rule, stops and expectancy, drawdowns and psychology, shorting and margin, the plan and the journal |
| 5 | Options Basics | Advanced | 58 | Calls and puts, the chain, Greeks and IV, covered calls / protective puts / verticals, straddles / strangles / condors |
| 6 | Strategy & Backtesting | Advanced | 57 | Entry and exit rules, backtest metrics, why backtests lie, costs, build and paper-trade your own strategy |
| 7 | Practice Drills: Market Replay | Intermediate | 57 | Using Replay honestly, trend drills, reversal and range drills, risk drills, self-review with scorecard and journal |
| 8 | Capstone: Your Trading Plan | Advanced | 60 | Why a written plan, defining your edge, risk architecture, proving the plan, the routine and graduation checklist |
| 9 | Crypto & ETFs: Different Markets, Same Discipline | Intermediate | 58 | What an ETF is and what the expense ratio costs, ETF families (index, sector, bond, commodity, leveraged), what crypto is and how it trades 24/7, sizing when volatility triples, the same toolkit on a different clock |

Before the course, complete beginners can take the **First Week** (`start.html`): seven days, three short tasks a day, drawn from Modules 1 to 4 and 7 plus the simulator, Replay, glossary and journal, with checks that tick themselves.

Lessons are JSON (`course/<module>.json`) made of blocks: `text`, `callout`, `chart` (a live chart with overlays), `exercise` (a task plus a deep link into the simulator), `drill` (a "Practice in Replay" button for a `drillId`) and `quiz`. `[[term]]` in any text becomes a glossary tooltip. Adding a lesson is editing a JSON file; no code changes needed. The course is free and will stay free; see [docs/BUSINESS.md](docs/BUSINESS.md) for how a paid, verified certificate sits on top of it.

## Languages

The interface and the course are available in **English** and **Spanish** (`es-419`, neutral Latin American Spanish); switch with the EN / ES toggle in the nav or the More sheet. The choice is remembered in `bt.lang` and applied to `<html lang>`, so screen readers switch voice too.

- **UI**: `i18n/es.json` maps exact English strings to Spanish; `js/i18n.js` swaps them in the live DOM and keeps watching for new content. No page markup changes are needed to add a translation, which is also why the English strings in HTML and JS must stay exactly as they appear in the dictionary.
- **Course**: `course/es/` mirrors `course/` file by file with identical ids and quiz answers. A module, drill set, glossary or question bank that has not been translated yet loads in English with an "English only" badge.
- **Adding a language** (Haitian Creole is next on the roadmap) is a dictionary file, a `course/<code>/` folder and one line in the language list. The full workflow, the rules for keeping Spanish in step with English, and the structure validator are in [docs/I18N.md](docs/I18N.md).

## Teaching with it

[docs/TEACHING_GUIDE.md](docs/TEACHING_GUIDE.md) is a ready-to-run **six-week syllabus** for a college elective built on the app: weekly lessons mapped to modules, in-class exercises with the exact deep links, Replay drills with pass criteria, journal assignments, a grading rubric, how the certificate fits, the **classroom code workflow**, a **First Week assignment** for mixed-experience sections and an optional **crypto / ETF week**. It assumes students are on phones and the instructor has no budget.

[docs/INSTRUCTOR_GUIDE.md](docs/INSTRUCTOR_GUIDE.md) covers the tooling: creating a class code, importing share codes, reading the roster, the gradebook and its weights, CSV export, backups and the privacy notice to read to students.

## How it compares

We looked at TradingView, thinkorswim paperMoney / OnDemand, the Investopedia Simulator, HowTheMarketWorks / Stock-Trak, the SIFMA Stock Market Game, Wall Street Survivor, Babypips and the mobile trading-game apps before planning v0.4 and v0.5 ([docs/COMPETITIVE_ANALYSIS.md](docs/COMPETITIVE_ANALYSIS.md)).

What Broward Trading already does that most of them do not: Market Replay that saves scorecards and is wired into the paper account and the journal; a complete course, glossary, flashcards, journal and certificate in one free product; an instructor dashboard that works offline from share codes with no student emails; a Spanish interface and course; an installable open-source PWA with no account required.

What they do better, and which we are adopting: classroom **competitions and leagues** with configurable rules and a projector view (HowTheMarketWorks, Stock Market Game, Investopedia); a **screener** with saved scans (TradingView); a **no-code strategy builder** feeding the backtester and alerts (TradingView's strategy tester, without the scripting); an **options what-if analyzer** with probability cones (thinkorswim); a **grade ladder, XP and badges** with honest criteria (Babypips, Trading Game); and a **rule-based coach** that reviews each trade for the mistakes the course warns about. These are the v0.5 plan in [docs/ROADMAP.md](docs/ROADMAP.md). We will not copy leveraged 24/7 products, "AI predictions" or paid signals.

## Membership backend (optional)

Everything above runs with no server. If you want email sign-in, a paid Pro tier, server-verified certificates, automatic classroom sync (`POST /classes`, `/classes/:code/snapshots`, `/classes/:code/roster`) and an opt-in classroom leaderboard, the repo includes a single **Cloudflare Worker** (`server/worker.js`) with KV storage, Stripe Checkout and Resend email, all on free tiers, with no npm dependencies and no secrets in code.

- Technical reference, routes, KV layout and local development: [server/README.md](server/README.md).
- Step-by-step setup for a non-developer (about 90 minutes): [docs/MEMBERSHIP_SETUP.md](docs/MEMBERSHIP_SETUP.md).
- Business rationale and pricing: [docs/BUSINESS.md](docs/BUSINESS.md).

To connect the site to a deployed Worker, set `apiBase` in `js/config.js` to the Worker URL. That file is public and contains no secrets; `proGating` stays `false` unless you deliberately decide to gate Pro-only lessons. With `apiBase` empty, `pricing.html` explains that the backend is not set up, and `verify.html` still verifies browser-issued certificates.

## Running the tests

The pure modules have Node tests that need nothing but Node 18+ (`tests/auth.test.js` needs Node 22+ for global WebCrypto):

```bash
# run every unit test file
for t in tests/*.test.js; do echo "== $t"; node "$t" || exit 1; done

# or one at a time
node tests/indicators.test.js
node tests/paper.test.js
node tests/replay.test.js
node tests/journal.test.js

# syntax check everything
for f in js/*.js tests/*.js sw.js server/worker.js; do node --check "$f"; done

# validate course JSON and translations
for f in course/*.json course/es/*.json i18n/*.json manifest.json; do [ -f "$f" ] && { node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD JSON: $f"; }; done
```

As of v0.4 there are nineteen unit-test files (alerts, auth, backtest, classroom, compare, course, course-v04, data, glossary, i18n, icons, indicators, journal, nav, news, onboarding, options, paper, replay) holding more than 500 assertions-as-tests. `tests/i18n.test.js` and `tests/course-v04.test.js` double as the translation **structure validator**: dictionary keys normalised, `{placeholders}` preserved, every `course/es/*.json` mirroring its English file's ids and quiz answers (see [docs/I18N.md](docs/I18N.md)).

**Continuous integration**: `.github/workflows/pages.yml` runs every unit-test file on each push to `main` and deploys to GitHub Pages only when all of them pass. A failing test blocks the deploy, so never push one.

End-to-end smoke test (opens every page at desktop and phone widths, places a paper trade, saves screenshots to `docs/screenshots/`): serve the site, then `node tests/e2e.playwright.js`. Needs the `playwright` npm package with Chromium installed; it is not part of the unit tests.

## Contributing

Contributions are welcome: lessons, drills, glossary terms, indicators, strategies, translations, accessibility fixes, bug reports.

1. Read [CONTRACTS.md](CONTRACTS.md) and [docs/BRAND.md](docs/BRAND.md) first. Modules must keep their contract; pages must use the shared tokens and must not contain their own nav or footer markup (that lives in `js/nav.js`).
2. Keep it plain: ES2020, no imports, no frameworks, no build step. Attach to `window.BT`.
3. Design for a 390 px phone first: tap targets at least 44 px, no horizontal scroll, panels collapsible.
4. Educational copy: plain English, second person, explain the *why* next to every number, never promise profits, never call anything "advice". Label simulated data as demo. Never fabricate news or prices.
5. Run the tests and `node --check` before opening a pull request. If you change a precached file in a way users must get immediately, bump `VERSION` in `sw.js`.
6. If you change or add an English UI string, add its Spanish entry to `i18n/es.json` (or leave a note in the PR so a translator can). If you change a lesson in `course/`, make the same structural change in `course/es/` or note that the translation is now behind. See [docs/I18N.md](docs/I18N.md).
7. Open an issue before a large change so we can agree on the contract first.

Course content contributions should include sources for any factual claim and should not include real-money trade recommendations. Translations are especially welcome: Spanish gaps, and Haitian Creole next.

## Other docs

- [docs/CHANGELOG.md](docs/CHANGELOG.md): what changed in each release.
- [docs/ROADMAP.md](docs/ROADMAP.md): what is done, what is next, what we will not build.
- [docs/TEACHING_GUIDE.md](docs/TEACHING_GUIDE.md): six-week syllabus, exercises, drills, rubric, certificate, classroom code workflow, First Week assignment, crypto / ETF week.
- [docs/INSTRUCTOR_GUIDE.md](docs/INSTRUCTOR_GUIDE.md): the Classroom tooling: class codes, share codes, roster, gradebook, exports, privacy.
- [docs/I18N.md](docs/I18N.md): how translation works, adding a language, keeping Spanish in step with English, the structure validator.
- [docs/MARKETING.md](docs/MARKETING.md): landing copy, student personas, free-to-Pro email sequence, social post ideas, compliance checklist for educational finance marketing.
- [docs/COMPETITIVE_ANALYSIS.md](docs/COMPETITIVE_ANALYSIS.md): what similar learning and trading products do well and which features we are adopting.
- [docs/MOBILE.md](docs/MOBILE.md): installing as a PWA on iPhone / Android, phone tips.
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md): market-data options, accuracy, costs, recommendation.
- [docs/BUSINESS.md](docs/BUSINESS.md): turning the course into a membership with verified certificates while the simulator stays free.
- [docs/MEMBERSHIP_SETUP.md](docs/MEMBERSHIP_SETUP.md) and [server/README.md](server/README.md): the optional backend.
- [docs/DEPLOY.md](docs/DEPLOY.md): GitHub Pages, custom domains, service worker, publishing from this folder.
- [docs/BRAND.md](docs/BRAND.md): visual system and component catalogue.
- [CONTRACTS.md](CONTRACTS.md): module interfaces.

## Disclaimer

Broward Trading is a free educational simulator. **No real orders are placed and no money changes hands.** Demo prices are generated by a seeded random walk and are not real market prices; a year in a Replay drill title is a scenario label, not the real market of that year. Live prices come from the third-party provider you configure with your own key and may be delayed, incomplete or wrong. Indicators, the composite signal, alerts and backtests describe what a formula says about past prices; they do not predict the future. Nothing on this site is investment, legal or tax advice, and nothing is a recommendation to buy or sell any security, ETF or cryptocurrency. Trading real money involves risk, including the loss of your entire investment; crypto assets can lose most of their value quickly and are not covered by the protections that apply to securities accounts. Past performance, simulated or real, does not guarantee future results.

Broward Trading is an independent project and is not affiliated with, endorsed by or sponsored by Broward College or any broker, exchange or data provider.

## License

MIT. Copyright 2026 Broward Trading contributors. See [LICENSE](LICENSE).

Course text, lesson JSON, drills and glossary are also MIT-licensed so teachers can adapt them. Third-party components keep their own licences: TradingView lightweight-charts (Apache-2.0, licence file in `js/vendor/`), IBM Plex fonts (OFL-1.1). Market data belongs to its provider and is subject to their terms.
