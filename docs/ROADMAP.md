# Broward Trading — roadmap

This is the working plan for the project. It mirrors the public roadmap on `about.html`; when one changes, change the other. Items move as students tell us what helps them learn. Dates are intentions, not promises. Shipped changes are listed release by release in `docs/CHANGELOG.md`.

Guiding rules that do not change between releases:

1. **The simulator and the core course stay free.** Paid features pay for verified credentials, human feedback and hosting, never for access to tools students can already use.
2. **No build step, no framework.** Plain ES2020 attached to `window.BT`, loadable from `file://` or any static host. Anyone can read the source in a browser and learn from it.
3. **Label everything honestly.** Demo prices are marked demo, live prices show their provider and delay, signals say what indicators say now, not what will happen. News is never invented.
4. **Every module has a contract** (`CONTRACTS.md`) and tests before it has a UI.
5. **Phone first.** The primary user is on a 390 px screen. Every page is built and checked at that width before desktop.

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

## v0.3 — Learning loop and phone app (current)

Goal: close the gap between reading a lesson and changing behaviour, and make the whole thing excellent on a phone.

- [x] **Shared shell** `js/nav.js`: top nav, bottom tab bar on phones, "More" sheet, theme toggle, footer, manifest and service-worker registration in one module. Pages no longer carry their own nav markup.
- [x] **Market Replay** (`replay.html`, `BT.replay`): hidden-future bar-by-bar replay with step / play / pause / jump, intraday tick sub-steps, trades on a separate `replay` paper account, scorecard vs buy-and-hold, session history, ten graded drills in `course/drills.json`.
- [x] **Multiple paper accounts** (`BT.paper.use`, `accounts()`), backward compatible with the `bt.portfolio` key.
- [x] **Alerts** (`BT.alerts`): price, RSI, SMA cross and signal-change alerts, in-page toasts and browser notifications, checked on every dashboard tick.
- [x] **Trading journal** (`journal.html`, `BT.journal`): auto-synced entries from fills, setup / tags / emotion / confidence / rating, stats by group, weekly review checklist, JSON and CSV export.
- [x] **Glossary** (220 terms), flashcards with light spaced repetition, Daily 5 quiz from a 230-question bank; `[[term]]` tooltips in lessons.
- [x] **News and fundamentals** page with Finnhub / Alpha Vantage, honest "connect a key" state, never fabricated headlines.
- [x] **Compare** page: rebased performance, correlation matrix, beta, relative strength vs SPY, watchlist heatmap.
- [x] **Course modules 7 and 8**: Practice Drills: Market Replay; Capstone: Your Trading Plan. 40 lessons total; `drill` block type.
- [x] **PWA**: `manifest.json`, `sw.js` (precached shell, market data never cached), icons, install button, offline page.
- [x] **Membership client and optional backend**: `BT.auth`, `pricing.html`, `verify.html`, `js/config.js`; Cloudflare Worker in `server/` with magic-link sign-in, Stripe Checkout, signed certificates, verification, opt-in leaderboard. Off by default; everything stays free.
- [x] Tests for every new module (355 unit tests across twelve files).
- [x] Docs: CHANGELOG, TEACHING_GUIDE (six-week syllabus), MOBILE (PWA install), MEMBERSHIP_SETUP, server/README.
- [ ] Extend `tests/e2e.playwright.js` to the seven new pages and refresh `docs/screenshots/`.
- [ ] Publish to GitHub Pages and install on a real iPhone and Android phone from the published URL (see `docs/DEPLOY.md`, `docs/MOBILE.md`).
- [ ] Update the roadmap section of `about.html` to match this file.

### Deferred from the original v0.3 plan

These were listed for v0.3 and were not built; they move to v0.4 unless students ask sooner.

- **Self-checking exercises**: lesson exercises that specify an expected paper-account state and are marked done automatically. Replay drills now do this for drills; dashboard exercises still rely on the student ticking "done".
- **Screener** over the demo universe and the watchlist (trend, RSI zone, pattern detected, distance to 52-week high). The Compare heatmap covers part of the need.
- **Portfolio export / import** as JSON. The journal exports; the portfolio does not yet.
- **More patterns and indicators**: harami, piercing line, dark cloud cover, tweezers; Keltner, Donchian, Parabolic SAR, Williams %R, CCI, MFI.
- **Data accuracy**: adjusted-close toggle, provider delay badge on every price, stale-data warning when cache age exceeds the interval.
- **Accessibility pass**: WCAG 2.2 AA audit, reduced-motion, screen-reader text summaries of charts.

## v0.4 — Classroom tools

Goal: make this usable by an instructor with 30 students, phones only and no IT budget. The six-week syllabus in `docs/TEACHING_GUIDE.md` is the specification: everything an instructor has to do by hand there is a candidate for this release.

- **Progress report file**: one tap exports a student's lessons done, quiz averages, drill results, journal stats and paper-account stats as a signed JSON the instructor can import into a grade sheet. First without a server, then through the Worker when a class code is set.
- **Instructor mode** behind a class code (uses the Worker's leaderboard store): anonymised cohort progress, assign modules and drills with due dates, export grades as CSV.
- **Self-checking exercises**, screener, portfolio export / import, extra indicators and the accuracy items deferred from v0.3.
- **Lesson authoring guide** and a JSON validator script for `course/*.json`, `drills.json`, `glossary.json` and `questionbank.json`.
- **Translations** of the course into Spanish and Haitian Creole (the two most common home languages after English in Broward County). Course JSON gains a `lang` field; UI strings move to a dictionary.
- **Printable lesson notes** and a one-page cheat sheet per module (the "lesson PDFs" listed on `pricing.html`).
- **Replay improvements**: more drills (earnings gaps, options in replay), drill difficulty tiers, a classroom "same drill, compare scorecards" view.
- **Accessibility**: WCAG 2.2 AA audit, reduced-motion, screen-reader chart summaries.

## v1.0 — Pro membership

Goal: a sustainable project. Payment arrives only with this release, and only when there is Pro-only value worth paying for. Full design in `docs/BUSINESS.md`; the backend already exists in `server/` and is deployed by the site owner following `docs/MEMBERSHIP_SETUP.md`.

- **Turn on the backend** for the public site: magic-link accounts, Stripe Checkout, server-signed certificates that `verify.html` checks, opt-in classroom leaderboard.
- **Cloud sync** of portfolio, journal and progress across devices (currently everything is per-browser).
- **Graded capstone**: the Module 8 trading plan plus a backtested strategy and a replay record, reviewed by a human with written feedback.
- **Extra modules**: futures mechanics, crypto market structure, tax basics for traders (US), trading psychology deep-dives, reading earnings and news.
- **Cohort sessions** and a moderated discussion space.
- **Instructor licences** for schools (bulk seats, roster import, grade export).

## Always

Not tied to a version; picked up whenever there is time.

- Better data accuracy within free-tier limits (smarter caching, batching symbols, respecting provider ToS).
- Mobile polish: chart gestures, bottom-sheet order ticket, large-type mode, haptics where the browser allows.
- Performance: web worker for backtests and optimisation over long histories.
- More strategies in the backtester, more drills in Replay, more worked examples in Modules 6 to 8.
- Keep dependencies minimal: lightweight-charts and fonts only; everything else first-party. The Worker has zero npm dependencies and should stay that way.

## Explicitly not planned

- Real-money trading or brokerage connections of any kind.
- Selling trade signals, "alerts" as a product, or anything presented as advice. The in-app alerts are a learning tool evaluated in the student's own browser.
- Crypto or forex *trading*; we may teach market structure but we will not simulate 24/7 leveraged products as if they were beginner-friendly.
- Fabricated news, prices or "AI predictions".
- Ads or selling student data.

## How to propose a change

Open an issue describing the student problem first, the feature second. If the change touches a module interface, propose the `CONTRACTS.md` diff in the issue before writing code. If it touches a page, say how it looks at 390 px.
