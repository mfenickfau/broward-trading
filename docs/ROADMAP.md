# Broward Trading — roadmap

This is the working plan for the project. It mirrors the public roadmap on `about.html`; when one changes, change the other. Items move as students and instructors tell us what helps them learn. Dates are intentions, not promises. Shipped changes are listed release by release in `docs/CHANGELOG.md`; what similar products do, and which of their ideas we are adopting, is in `docs/COMPETITIVE_ANALYSIS.md`.

The site is live at <https://mfenickfau.github.io/broward-trading/>. Every push to `main` runs the unit tests and deploys when they pass.

Guiding rules that do not change between releases:

1. **The simulator and the core course stay free.** Paid features pay for verified credentials, human feedback and hosting, never for access to tools students can already use.
2. **No build step, no framework.** Plain ES2020 attached to `window.BT`, loadable from `file://` or any static host. Anyone can read the source in a browser and learn from it.
3. **Label everything honestly.** Demo prices are marked demo, live prices show their provider and delay, signals say what indicators say now, not what will happen. News is never invented.
4. **Every module has a contract** (`CONTRACTS.md`) and tests before it has a UI. A failing test blocks the deploy.
5. **Phone first.** The primary user is on a 390 px screen. Every page is built and checked at that width before desktop.
6. **Grade process, never profit.** Anything that ranks students by return is a discussion tool, opt-in, and never a grade.

---

## v0.1 — Single-file prototype (done)

- One `index.html`: candlestick chart, RSI, MACD, Bollinger Bands, composite signal, a basic paper account, Twelve Data live quotes.
- Established the visual tokens, tone and the "explain the why" approach that everything since reuses.

## v0.2 — Modular app (done)

- [x] `CONTRACTS.md` v0.2 defining `BT.ind`, `BT.data`, `BT.paper`, `BT.options`, `BT.backtest`, `BT.course`.
- [x] Shared design system `css/style.css` and `docs/BRAND.md` (dark-first, light theme, IBM Plex).
- [x] Full indicator library with candle patterns, pivots, S/R, Fibonacci, Ichimoku and the composite `signals()`.
- [x] Multi-provider data layer: demo, Twelve Data, Finnhub, Alpha Vantage; cache; per-provider rate limiter; demo fallback with reason; NYSE market status with holidays.
- [x] Paper-trading engine: market / limit / stop / stop-limit, day / GTC, shorting, commissions, mark-to-market, equity history, statistics.
- [x] Options lab: Black-Scholes, implied vol, synthetic chain with smile, payoff diagrams, nine strategy presets.
- [x] Backtester: seven built-in strategies, honest stats vs buy-and-hold, chart markers, grid optimiser.
- [x] Six-module course (30 lessons) with charts, exercises, quizzes, progress and a canvas certificate.
- [x] Pages: `index.html`, `learn.html`, `portfolio.html`, `backtest.html`, `about.html`.
- [x] Node tests for the four pure modules (155 tests); Playwright smoke test with screenshots.
- [x] Repo docs: README, LICENSE, ROADMAP, DATA_SOURCES, BUSINESS, DEPLOY.

## v0.3 — Learning loop and phone app (done)

Goal: close the gap between reading a lesson and changing behaviour, and make the whole thing excellent on a phone.

- [x] **Shared shell** `js/nav.js`: top nav, bottom tab bar on phones, "More" sheet, theme toggle, footer, manifest and service-worker registration in one module.
- [x] **Market Replay** (`replay.html`, `BT.replay`): hidden-future bar-by-bar replay, intraday tick sub-steps, trades on a separate `replay` account, scorecard vs buy-and-hold, session history, ten graded drills.
- [x] **Multiple paper accounts**, **alerts**, **trading journal** with weekly review and export, **glossary** with flashcards and Daily 5, **news and fundamentals** that never fabricate, **compare** page.
- [x] **Course modules 7 and 8**; `drill` block type; `[[term]]` tooltips.
- [x] **PWA**: manifest, service worker (market data never cached), icons, install button, offline page.
- [x] **Membership client and optional backend** (`BT.auth`, `pricing.html`, `verify.html`, Cloudflare Worker). Off by default; everything stays free.
- [x] Tests for every new module; docs: CHANGELOG, TEACHING_GUIDE, MOBILE, MEMBERSHIP_SETUP, server/README.
- [x] Published to GitHub Pages through GitHub Actions (tests gate the deploy).

## v0.4 — Classroom tools, Spanish and First Week (current)

Goal: make this usable by an instructor with 30 students, phones only and no IT budget; make it usable by students whose first language is Spanish; give complete beginners a guided first week; teach crypto and ETFs with the same discipline as stocks.

- [x] **Spanish interface** (`js/i18n.js`, `i18n/es.json`, EN / ES toggle in the shell): DOM-based translation with no page rewrites, `BT.t()` for JS strings, `Intl` formatting per locale, extensible language list.
- [x] **Language-aware course loading** with per-file English fallback and an "English only" badge; `course/es/` mirrors `course/` by filename.
- [ ] **Spanish course content**: `course/es/index.json`, `m1` to `m9`, `drills.json`, `glossary.json`, `questionbank.json`. Module files land one at a time and are validated by `tests/course-v04.test.js`. Target: Modules 1 to 4 first (the First Week and the most-read lessons), then 7 and 9, then 5, 6, 8.
- [x] **Classroom, student side** (`BT.classroom`): class codes, pseudonymous snapshots, share codes that work with no server, automatic sync with the Worker.
- [x] **Instructor page** (`instructor.html`): classes, share-code import, roster, student drawer, gradebook with the Teaching Guide's weights, CSV and JSON exports, privacy notice.
- [x] **Worker classroom routes** (`/classes`, snapshots, roster, delete) with the `CLASSES` KV namespace, rate limits and an instructor secret.
- [x] **First Week** (`start.html`, `BT.onboarding`, `course/firstweek.json`): seven days × three tasks with self-ticking checks; "Your first week" card on the course home.
- [x] **Dashboard tour** for first visits.
- [x] **Crypto and ETFs** in the data layer (24/7 calendar, provider symbol mapping, ETF metadata with expense ratios) and **Module 9**.
- [x] **Printing**: `css/print.css`, Print / Save as PDF in the lesson reader, `certificate.html`.
- [x] **Up next** recommendation and the saved certificate record.
- [x] **Docs**: I18N, INSTRUCTOR_GUIDE, MARKETING, COMPETITIVE_ANALYSIS; TEACHING_GUIDE additions; README with the live URL and workflow badge.

### v0.4 release checklist (before tagging)

- [ ] Fix the three assertions in `tests/classroom.test.js` that assume an eight-module course (module 9 changes the quiz denominator and the module grouping). CI blocks the deploy while they fail.
- [ ] Bump `VERSION` in `sw.js` to `bt-v0.4.0` and add `start.html`, `instructor.html`, `certificate.html`, `css/print.css`, `js/i18n.js`, `js/classroom.js`, `js/onboarding.js`, `js/instructor.js`, `i18n/es.json`, `course/firstweek.json`, `course/m9-crypto-etf.json` and `course/es/*` to the precache list.
- [ ] Extend `tests/e2e.playwright.js` to the three new pages (module card count 8 → 9) and refresh `docs/screenshots/`, including one Spanish capture.
- [ ] Update the roadmap section of `about.html` to match this file (it still marks v0.2 as current and promises a screener in v0.3).
- [ ] Install from the live URL on an iPhone and an Android phone; run the First Week on one of them.
- [ ] Add `course/es/index.json` and `course/es/m1-foundations.json` at minimum, so the Spanish toggle shows translated course content on day one.

### Deferred from v0.3 and v0.4

Still wanted; not built yet. They move into v0.5 unless students ask sooner.

- **Self-checking exercises** in lessons (expected paper-account state → marked done automatically). First Week checks and Replay drills do this; lesson exercises still rely on the "done" tick.
- **Portfolio export / import** as JSON (the journal and instructor data export; the portfolio does not).
- **More patterns and indicators**: harami, piercing line, dark cloud cover, tweezers; Keltner, Donchian, Parabolic SAR, Williams %R, CCI, MFI.
- **Data accuracy**: adjusted-close toggle, provider delay badge on every price, stale-data warning when cache age exceeds the interval.
- **Accessibility pass**: WCAG 2.2 AA audit, reduced-motion, screen-reader text summaries of charts.
- **Lesson authoring guide** and a standalone JSON validator script (today the validators are tests; see `docs/I18N.md`).
- **Haitian Creole** interface and course (`ht`), the second most common home language after Spanish in Broward County. The i18n layer is ready; it needs a dictionary and translators.
- **Assign modules and drills with due dates** from the instructor page; a Canvas-friendly gradebook export.

## v0.5 — Compete, screen, build, coach

Goal: adopt the features that the best learning and trading products have and we do not, without giving up our rules. Full reasoning and sources in `docs/COMPETITIVE_ANALYSIS.md`. Each item gets a `CONTRACTS.md` entry and tests before a page.

1. **Competitions and leagues** (`BT.league`, `league.html`). Anyone creates a league: name, start and end dates, starting cash, commission, slippage, allowed asset classes (stocks, ETFs, crypto, options), day trading on or off, max position %, shorting on or off. A separate paper account per league (`BT.paper.use('league:<id>')`). Leaderboard by return, risk-adjusted return (return / max drawdown) and consistency; team accounts; a **projector view** that cycles rankings for a classroom display; join by code. Local or share-code mode without a server; through the Worker's leaderboard store when configured. Inspired by HowTheMarketWorks, the Stock Market Game and the Investopedia Simulator. Stays opt-in, pseudonymous and never a grade.
2. **Screener** (`BT.screen`, `screener.html`). Filter the demo universe and the watchlist by price, % change, volume, RSI zone, distance to SMA 50 / 200, golden or death cross today, Bollinger squeeze, candlestick pattern today, sector and kind (stock / ETF / crypto). Saved scans, "send to watchlist", "open in Replay". Works on provider data with a key while respecting rate limits. Inspired by TradingView's screener.
3. **No-code strategy builder** (`BT.rules`). Rule blocks (indicator, comparator, value or other indicator, lookback) joined with AND / OR for entry and exit, plus stop, target and trailing-stop rules. One definition feeds the backtester, the alerts and a "semi-auto" paper mode that proposes trades for one-tap confirmation. Export and import as JSON; share as a code like the classroom share codes. Inspired by TradingView's strategy tester, minus the scripting language.
4. **Gamification layer** (`BT.progress`). XP for lessons, quizzes, drills, journal entries and streaks; a grade ladder (Freshman → Sophomore → Junior → Senior → Graduate) that maps to module completion; badges with honest, checkable criteria ("Ten journal entries with a specific lesson", never "Made $10,000"); a "What kind of trader are you?" quiz that recommends a learning path; opt-in quiz-score comparison with the cohort. Inspired by Babypips and the mobile trading games.
5. **Options analyzer** in the options lab. What-if sliders for underlying price, days to expiry and implied volatility; P&L curves at several dates; a probability cone from IV; Greeks across the range; assignment and early-exercise warnings. Inspired by thinkorswim's Analyze tab.
6. **Trade planner and risk calculator** in the trade ticket and the journal. Entry, stop, target and account risk % → shares, dollar risk, R multiple and the breakeven win rate. The 1 % rule becomes a tool, not a reminder.
7. **Paper-engine realism**: volume-limited partial fills, configurable slippage model, commission presets, dividends and cash interest, a pattern-day-trader rule toggle, a short-borrow fee, demo corporate actions (splits, dividends).
8. **Coach** (`BT.coach`). A free rule-based coach that reviews every fill for the mistakes the course warns about (no stop, size above the 1 % rule, trading against the trend the student's own indicators show, re-entry within five bars of a stop, more than N trades a day) and writes a short note into the journal entry. Pro: an AI coach through the Worker using a server-side model key, limited to lesson content and the student's own trades, never to predictions.

Also in v0.5: the deferred items above, **chart of the day** (a detected setup with a two-question check), **multi-chart layouts** (2 and 4 panes) with saved templates, **economic and dividend calendars** with educational notes, **push reminders** for streaks and league deadlines, and a mapping of the course to Florida financial-literacy standards in the Teaching Guide.

## v1.0 — Pro membership

Goal: a sustainable project. Payment arrives only with this release, and only when there is Pro-only value worth paying for. Full design in `docs/BUSINESS.md` and `docs/MARKETING.md`; the backend already exists in `server/` and is deployed by the site owner following `docs/MEMBERSHIP_SETUP.md`.

- **Turn on the backend** for the public site: magic-link accounts, Stripe Checkout, server-signed certificates that `verify.html` checks, classroom sync, opt-in leaderboards and leagues.
- **Cloud sync** of portfolio, journal, progress and strategies across devices (currently everything is per-browser).
- **Graded capstone**: the Module 8 trading plan plus a backtested strategy and a replay record, reviewed by a human with written feedback.
- **Extra modules**: futures mechanics, forex and futures demo assets with margin explained, tax basics for traders (US), trading psychology deep-dives, reading earnings and news.
- **Cohort sessions**, a moderated discussion space and a shared chart-ideas feed.
- **Instructor licences** for schools (bulk seats, roster import, grade export, verified certificates for every qualifying student).

## Always

Not tied to a version; picked up whenever there is time.

- Better data accuracy within free-tier limits (smarter caching, batching symbols, respecting provider ToS).
- Mobile polish: chart gestures, bottom-sheet order ticket, large-type mode, haptics where the browser allows.
- Performance: web worker for backtests and optimisation over long histories.
- More strategies in the backtester, more drills in Replay (earnings gaps, crypto weekends, ETF rebalancing), more worked examples in Modules 6 to 9.
- Translations: keep `i18n/es.json` and `course/es/` in step with English on every release (`docs/I18N.md`).
- Keep dependencies minimal: lightweight-charts and fonts only; everything else first-party. The Worker has zero npm dependencies and should stay that way.

## Explicitly not planned

- Real-money trading or brokerage connections of any kind.
- Selling trade signals, "alerts" as a product, or anything presented as advice. The in-app alerts and the coach are learning tools evaluated in the student's own browser.
- Leveraged or perpetual crypto and forex *trading*. Module 9 teaches crypto and ETF market structure and simulates spot crypto on the paper account; we will not simulate 24/7 leveraged products as if they were beginner-friendly.
- Fabricated news, prices or "AI predictions". The Pro coach reviews what a student did; it never says what a price will do.
- Ads, selling student data, or collecting more than the pseudonymous classroom snapshot.

## How to propose a change

Open an issue describing the student problem first, the feature second. If the change touches a module interface, propose the `CONTRACTS.md` diff in the issue before writing code. If it touches a page, say how it looks at 390 px and in Spanish. If it is inspired by another product, say which one and what we should deliberately leave out.
