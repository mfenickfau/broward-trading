# Changelog

All notable changes to Broward Trading. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning loosely (minor = new pages or modules, patch = fixes and copy). Dates are the day the version was tagged or, before tagging, the day work on it was completed.

The project's forward-looking plan is in `ROADMAP.md`; module interfaces are in `../CONTRACTS.md`.

## [Unreleased]

- Update the roadmap section of `about.html` to match `docs/ROADMAP.md`.
- First publish to GitHub Pages and install test on real phones.

## [0.3.0] - 2026-11-12

Theme: the learning loop (practise, journal, review) and a proper phone app.

### Added

- **Shared shell** `js/nav.js` (`BT.nav`): the only place nav, footer, theme toggle, manifest link and service-worker registration live. Top nav on desktop; fixed bottom tab bar on screens up to 760 px (Dashboard, Learn, Replay, Portfolio, More); "More" sheet with every other page, theme switch and Install button. Pages contain only `<div id="nav"></div>` and `<div id="footer"></div>`. Body gets `has-tabbar` on phones.
- **Market Replay** (`replay.html`, `js/replay.js`, `BT.replay`): trade past data bar by bar with the future hidden. `step()`, `play(speed)`, `pause()`, `jumpTo(date)`, `jumpToEnd()`; optional four-sub-step intraday ticks (open, first extreme, second extreme, close); orders through `BT.paper` on the `replay` account with limit / stop processing each step; honesty note; end-of-session scorecard (return vs buy-and-hold, trades, win rate, max drawdown, drill pass / fail); session history in `bt.replay.sessions`; save-to-journal.
- **Drills** `course/drills.json`: ten graded replay presets (SMA crossover MSFT 2024, 2022 bear-market survival, ride the trend NVDA 2023, crash and recovery XOM 2020, RSI range trading SPY 2018-19, short selling NVDA 2022, stop-loss discipline TSLA 2024, breakout entries META 2023, AAPL 5-minute intraday session, MSFT hourly swing) with objective, hints and criteria. Deep link `replay.html#drill=<id>`.
- **Multiple paper accounts** in `js/paper.js`: `BT.paper.use(id)`, `BT.paper.accounts()`. `main` keeps the `bt.portfolio` key; others use `bt.portfolio.<id>`.
- **Alerts** (`js/alerts.js`, `BT.alerts`): `price_above`, `price_below`, `rsi_above`, `rsi_below`, `sma_cross` (pair selectable), `signal_change`; persisted in `bt.alerts`; fire on transition; in-page toast and browser `Notification` when permitted; Alerts panel on the dashboard checked on every tick.
- **Trading journal** (`journal.html`, `js/journal.js`, `BT.journal`): entries auto-created from paper and replay fills and by hand; setup (19 presets), tags, emotion (9 states with explanations), confidence 1-5, notes, lessons, rating 1-5; stats by setup / tag / emotion; weekly review checklist (7 items with "why") and four review questions; JSON and CSV export. Persisted in `bt.journal`.
- **Glossary** (`glossary.html`, `js/glossary.js`, `course/glossary.json`): 220 terms with definition, example, related terms and lesson link; search and A-Z; flashcards with light spaced repetition (again / hard / good, `bt.flashcards`); Daily 5 quiz from `course/questionbank.json` (230 questions, deterministic per day, streaks in `bt.daily5`).
- **News and fundamentals** (`news.html`, `js/news.js`, `BT.news`): company profile, key stats, earnings calendar and headlines via Finnhub, or company overview via Alpha Vantage; headline classification; "what moved it?" prompts framed as questions; explicit "connect a key" state with explainers of earnings, P/E and market cap. Headlines are never fabricated.
- **Compare** (`compare.html`, `js/compare.js`, `BT.compare`): up to six symbols rebased to 100; correlation matrix on canvas; beta and relative strength vs SPY; per-symbol stats; watchlist heatmap tiles; diversification note.
- **Course modules 7 and 8**: `course/m7-replay.json` (Practice Drills: Market Replay, intermediate) and `course/m8-capstone.json` (Capstone: Your Trading Plan, advanced). 40 lessons in total. New `drill` block type renders a "Practice in Replay" button. `[[term]]` in lesson text renders a glossary tooltip. `course/index.json` version 0.3.0.
- **PWA**: `manifest.json` (standalone display, theme colours from tokens, shortcuts to Dashboard, Learn, Replay, Portfolio), `sw.js` (precached app shell and course JSON, network-first navigations, stale-while-revalidate for same-origin assets, cache-first for fonts and the chart CDN, **network-only for market-data, auth and payment hosts**, inline offline page, versioned caches), `icons/icon.svg`, `icon-192.png`, `icon-512.png`. Install button in the More sheet when the browser offers `beforeinstallprompt`. Vendored lightweight-charts fallback in `js/vendor/` with its licence.
- **Membership client** (`js/auth.js`, `BT.auth`) and **site config** (`js/config.js`): `signIn`, `session`, `isPro`, `signOut`, `checkout`, `issueCertificate`, `verify`, `leaderboard`, `submitScore`. Fully functional in local-only mode when `apiBase` is empty; browser-issued certificate ids start with `BT-YYYY-L`. `proGating` defaults to `false`.
- **Pages** `pricing.html` (free today, what Pro will add, sign-in and checkout only when configured) and `verify.html` (certificate verification, local or via API).
- **Optional backend** `server/worker.js` (Cloudflare Worker, zero dependencies) with `server/wrangler.toml` and `server/README.md`: magic-link sign-in via Resend, sessions, Stripe Checkout and webhook with signature verification, HMAC-signed certificate ids `BT-YYYY-XXXXXX`, `GET /verify/:id`, opt-in classroom leaderboard by class code, CORS allow-list, per-IP rate limits, four KV namespaces. `.gitignore` already excluded `.wrangler/`.
- **Tests**: `tests/alerts.test.js`, `auth.test.js`, `compare.test.js`, `glossary.test.js`, `icons.test.js`, `journal.test.js`, `nav.test.js`, `news.test.js`, `replay.test.js`; `paper.test.js` extended for accounts. 419 unit tests across fourteen files. `tests/e2e.playwright.js` now audits all twelve pages at 1280 px and 390 px (console and page errors, failed local requests, shared shell mounted, no horizontal overflow, tab bar visible only on phones, 44 px tabs) and drives the main flows: dashboard buy and alert, replay drill to scorecard, journal, glossary search / flashcards / Daily 5, compare, pricing, verify, learn (module 7 drill, module 8 exam, quiz), portfolio position, backtest run. Screenshots in `docs/screenshots/` refreshed from it (dark theme, device scale 1).
- **Docs**: `CHANGELOG.md` (this file), `TEACHING_GUIDE.md` (six-week college elective syllabus), `MOBILE.md` (PWA install and phone tips), `MEMBERSHIP_SETUP.md` (non-developer backend walkthrough), `server/README.md`. README rewritten for 0.3; ROADMAP and DEPLOY updated.

### Changed

- Every page (`index`, `learn`, `portfolio`, `backtest`, `about`) replaced its hard-coded `<nav>` and `<footer>` with the `js/nav.js` mounts and now loads `manifest.json` through the shell.
- Every page re-checked at 390 px: tap targets at least 44 px, no horizontal scroll, panels collapsible, bottom padding for the tab bar.
- Theme preference is now written by `js/nav.js` to `bt.theme` as a JSON-quoted string; older bare values are still read.
- `learn.js` renders `drill` blocks and glossary tooltips; `course/index.json` lists eight modules.
- Dashboard (`js/app.js`) gained the Alerts panel and calls `BT.alerts.check` on every tick.
- README screenshots now point at the real captures in `docs/screenshots/` instead of placeholders.

### Security and privacy

- No secrets in any committed file. The Worker reads all secrets from `wrangler secret put`; `js/config.js` is public by design.
- The service worker never stores market-data, auth or payment responses.
- `GET /verify/:id` returns name, date, modules and score, never the email.

## [0.2.0] - 2026-11-11

Theme: from a single-file prototype to a modular app with a course.

### Added

- `CONTRACTS.md` defining `BT.ind`, `BT.data`, `BT.paper`, `BT.options`, `BT.backtest`, `BT.course`.
- `css/style.css` design system and `docs/BRAND.md`: dark-first tokens, light theme via `prefers-color-scheme` and `data-theme`, IBM Plex Sans / Mono.
- `js/indicators.js`: SMA / EMA / WMA, RSI, MACD, Bollinger, ATR, ADX, Stochastic, VWAP, OBV, Ichimoku, pivots, support / resistance, Fibonacci, candle patterns, composite `signals()` with reasons, `computeAll()`.
- `js/data.js`: demo, Twelve Data, Finnhub and Alpha Vantage providers; localStorage cache; per-provider free-tier rate limiter; demo fallback flagged with a reason; NYSE market status with holidays; 40+ ticker demo universe.
- `js/paper.js`: market / limit / stop / stop-limit orders, day / GTC, shorting, commissions, mark-to-market, equity history, `stats()`, option positions by OCC id.
- `js/options.js`: Black-Scholes-Merton with Greeks, implied volatility, synthetic chain with smile, payoff diagrams, nine strategy presets with `analyze()`.
- `js/backtest.js`: strategy objects, seven built-ins, `run()` with sizing / commission / slippage / shorting, honest stats vs buy-and-hold, chart markers, `optimize()` capped at 200 combinations.
- `js/course.js` and `learn.html`: six modules (30 lessons) of JSON blocks (text, callout, chart, exercise, quiz), markdown subset with escape-first rendering, progress in `bt.course`, canvas certificate.
- Pages `index.html` (rewired onto the modules), `learn.html`, `portfolio.html`, `backtest.html`, `about.html` with shared nav and disclaimer footer.
- `tests/indicators.test.js`, `paper.test.js`, `options.test.js`, `backtest.test.js` (155 tests) and `tests/e2e.playwright.js` with screenshots at 1280 px and 390 px.
- Docs: README, LICENSE (MIT), ROADMAP, DATA_SOURCES, BUSINESS, DEPLOY; `.nojekyll`; `.gitignore`.

## [0.1.0] - 2026-11-10

- Single-file prototype `index.html`: candlestick chart, RSI, MACD, Bollinger Bands, a composite signal, a basic paper account and Twelve Data live quotes. Established the tone and the "explain the why" approach.

[Unreleased]: ROADMAP.md
[0.3.0]: ROADMAP.md#v03--learning-loop-and-phone-app-current
[0.2.0]: ROADMAP.md#v02--modular-app-done
[0.1.0]: ROADMAP.md#v01--single-file-prototype-done
