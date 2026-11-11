# Broward Trading — roadmap

This is the working plan for the project. It mirrors the public roadmap on `about.html`; when one changes, change the other. Items move as students tell us what helps them learn. Dates are intentions, not promises.

Guiding rules that do not change between releases:

1. **The simulator and the core course stay free.** Paid features pay for verified credentials, human feedback and hosting, never for access to tools students can already use.
2. **No build step, no framework.** Plain ES2020 attached to `window.BT`, loadable from `file://` or any static host. Anyone can read the source in a browser and learn from it.
3. **Label everything honestly.** Demo prices are marked demo, live prices show their provider and delay, signals say what indicators say now, not what will happen.
4. **Every module has a contract** (`CONTRACTS.md`) and tests before it has a UI.

---

## v0.1 — Single-file prototype (done)

- One `index.html`: candlestick chart, RSI, MACD, Bollinger Bands, composite signal, a basic paper account, Twelve Data live quotes.
- Established the visual tokens, tone and the "explain the why" approach that everything since reuses.

## v0.2 — Modular app (current)

Shipping now. Scope:

- [x] `CONTRACTS.md` v0.2 defining `BT.ind`, `BT.data`, `BT.paper`, `BT.options`, `BT.backtest`, `BT.course`.
- [x] Shared design system `css/style.css` and `docs/BRAND.md` (dark-first, light theme, IBM Plex).
- [x] Full indicator library with candle patterns, pivots, S/R, Fibonacci, Ichimoku and the composite `signals()`.
- [x] Multi-provider data layer: demo, Twelve Data, Finnhub, Alpha Vantage; cache; per-provider rate limiter; demo fallback with reason; NYSE market status with holidays.
- [x] Paper-trading engine: market / limit / stop / stop-limit, day / GTC, shorting, commissions, mark-to-market, equity history, statistics.
- [x] Options lab: Black-Scholes, implied vol, synthetic chain with smile, payoff diagrams, nine strategy presets.
- [x] Backtester: seven built-in strategies, honest stats vs buy-and-hold, chart markers, grid optimiser.
- [x] Six-module course (30 lessons) with charts, exercises, quizzes, progress and a canvas certificate.
- [x] Pages: `index.html`, `learn.html`, `portfolio.html`, `backtest.html`, `about.html`; shared nav and disclaimer footer.
- [x] Node tests for the four pure modules.
- [x] Repo docs: README, LICENSE, ROADMAP, DATA_SOURCES, BUSINESS, DEPLOY.
- [ ] Real screenshots in the README.
- [ ] Publish to GitHub Pages (see `docs/DEPLOY.md`).

## v0.3 — Learning loop

Goal: close the gap between reading a lesson and changing behaviour.

- **Trading journal.** Every paper trade can carry a thesis, a tag set (setup, timeframe, emotion), and a post-trade review. Review prompts appear after a position is closed. Journal export as CSV and JSON.
- **Self-checking exercises.** Lesson exercises specify an expected state (for example "place a limit order 2 % below the last price with a stop") and `BT.course` checks the paper account to mark them done automatically.
- **Watchlist alerts.** Price-cross and indicator-state alerts (RSI < 30, MACD cross) evaluated in the browser while the tab is open; browser notifications with permission.
- **Screener** over the demo universe and over a user's watchlist in live mode: filter by trend, RSI zone, pattern detected, distance to 52-week high.
- **Portfolio export / import** (JSON) so students can move between devices before cloud sync exists.
- **More patterns and indicators**: harami, piercing line, dark cloud cover, tweezers; Keltner channels, Donchian, Parabolic SAR, Williams %R, CCI, Money Flow Index.
- **Data accuracy**: adjusted-close handling and a visible "adjusted / unadjusted" toggle; provider delay badge on every price; stale-data warning when cache age exceeds the interval.
- **Accessibility pass**: WCAG 2.2 AA audit, reduced-motion, screen-reader labels on chart summaries (a text description of what the chart shows).

## v0.4 — Classroom tools

Goal: make this usable by an instructor with 30 students and no IT budget.

- **Instructor mode** behind a class code: anonymised cohort progress (lessons done, quiz averages, paper-account stats), assign modules with due dates, export grades as CSV. Implemented first as a shareable "progress report" file the student generates, then as a small backend when accounts exist.
- **Lesson authoring guide** and a JSON validator script for `course/*.json`.
- **Translations** of the course into Spanish and Haitian Creole (the two most common home languages after English in Broward County). Course JSON gains a `lang` field; UI strings move to a dictionary.
- **Printable lesson notes** and a one-page "cheat sheet" per module.
- **Offline support** via a service worker so the simulator works in a lab with poor connectivity (demo mode only).

## v1.0 — Pro membership

Goal: a sustainable project. Payment arrives only with this release. Full design in `docs/BUSINESS.md`.

- **Accounts** (email magic link) and **cloud sync** of portfolio, journal and progress.
- **Verified certificate**: server-graded final assessment, unique signed certificate ID, public verification page, optional LinkedIn-friendly share image.
- **Graded capstone**: a written trading plan plus a backtested strategy, reviewed by a human with written feedback.
- **Extra modules**: futures mechanics, crypto market structure, tax basics for traders (US), trading psychology deep-dives, reading earnings and news.
- **Cohort sessions** and a moderated discussion space.
- **Instructor licences** for schools (bulk seats, roster import, grade export).

## Always

Not tied to a version; picked up whenever there is time.

- Better data accuracy within free-tier limits (smarter caching, batching symbols, respecting provider ToS).
- Mobile polish: chart gestures, bottom-sheet order ticket, large-type mode.
- Performance: web worker for backtests and optimisation over long histories.
- More strategies in the backtester and more worked examples in Module 6.
- Keep dependencies minimal: lightweight-charts and fonts only; everything else first-party.

## Explicitly not planned

- Real-money trading or brokerage connections of any kind.
- Selling trade signals, "alerts", or anything presented as advice.
- Crypto or forex *trading*; we may teach market structure but we will not simulate 24/7 leveraged products as if they were beginner-friendly.
- Ads or selling student data.

## How to propose a change

Open an issue describing the student problem first, the feature second. If the change touches a module interface, propose the `CONTRACTS.md` diff in the issue before writing code.
