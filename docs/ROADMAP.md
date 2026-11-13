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

## v0.4 — Classroom tools, Spanish and First Week (done)

Goal: make this usable by an instructor with 30 students, phones only and no IT budget; make it usable by students whose first language is Spanish; give complete beginners a guided first week; teach crypto and ETFs with the same discipline as stocks.

- [x] **Spanish interface** (`js/i18n.js`, `i18n/es.json`, EN / ES toggle in the shell): DOM-based translation with no page rewrites, `BT.t()` for JS strings, `Intl` formatting per locale, extensible language list.
- [x] **Language-aware course loading** with per-file English fallback and an "English only" badge; `course/es/` mirrors `course/` by filename.
- [x] **Spanish course content**: `course/es/index.json`, `m1` to `m9`, `drills.json`, `glossary.json`, `questionbank.json`, `firstweek.json`, validated by `tests/i18n-structure.test.js` and `tests/course-v04.test.js`.
- [x] **Classroom, student side** (`BT.classroom`): class codes, pseudonymous snapshots, share codes that work with no server, automatic sync with the Worker.
- [x] **Instructor page** (`instructor.html`): classes, share-code import, roster, student drawer, gradebook with the Teaching Guide's weights, CSV and JSON exports, privacy notice.
- [x] **Worker classroom routes** (`/classes`, snapshots, roster, delete) with the `CLASSES` KV namespace, rate limits and an instructor secret.
- [x] **First Week** (`start.html`, `BT.onboarding`, `course/firstweek.json`): seven days × three tasks with self-ticking checks; "Your first week" card on the course home.
- [x] **Dashboard tour** for first visits.
- [x] **Crypto and ETFs** in the data layer (24/7 calendar, provider symbol mapping, ETF metadata with expense ratios) and **Module 9**.
- [x] **Printing**: `css/print.css`, Print / Save as PDF in the lesson reader, `certificate.html`.
- [x] **Up next** recommendation and the saved certificate record.
- [x] **Accessibility pass**: axe-core audit of every page in both languages, skip link, focus traps, chart text summaries, contrast tokens (`docs/ACCESSIBILITY.md`).
- [x] **Docs**: I18N, INSTRUCTOR_GUIDE, MARKETING, COMPETITIVE_ANALYSIS, ACCESSIBILITY; TEACHING_GUIDE additions; README with the live URL and workflow badge.
- [x] Published at <https://mfenickfau.github.io/broward-trading/> with CI-gated deploys; `sw.js` precache, e2e coverage and screenshots updated for the new pages.

Left over from the v0.4 checklist: update the roadmap section of `about.html` to match this file, and install from the live URL on an iPhone and an Android phone and run the First Week on one of them.

## v0.5 — Compete, screen, build, coach (current)

Goal: adopt the features that the best learning and trading products have and we did not, without giving up our rules. Full reasoning and sources in `docs/COMPETITIVE_ANALYSIS.md`; what shipped, file by file, in `docs/CHANGELOG.md` [0.5.0]. Every item has a `CONTRACTS.md` entry ("v0.5 additions") and tests.

- [x] **Competitions and leagues** (`BT.leagues`, `leagues.html`): rules for dates, cash, commission, slippage, asset classes, day trading, max position %, shorting and teams; four presets; a separate paper account per league with rules checked in the dashboard and Replay tickets; standings by return with drawdown, Sharpe and consistency; team standings; **projector view**; offline with `BTL1.` league codes and share codes, online through the Worker's `/leagues` routes. Opt-in, pseudonymous and never a grade. Guide: `docs/LEAGUES.md`.
- [x] **Screener** (`BT.screener`, `screener.html`): price, % change, volume, RSI, distance to SMA 50 / 200, golden / death cross, Bollinger squeeze, 52-week high / low, candle pattern today, composite signal, ADX, sector and kind; six built-in scans; saved scans; send to watchlist; rate-limit-aware on live data.
- [x] **No-code strategy builder** (`BT.rules`, `builder.html`): AND / OR rule blocks for entry and exit with stop, target, trailing stop and max bars; one definition feeds the backtester, a `rule` alert kind and the dashboard's **semi-auto** mode, which proposes trades for a one-tap confirmation and never executes on its own; JSON export and import.
- [x] **Gamification layer** (`BT.xp`, `profile.html`): XP, a seven-step level ladder (Freshman → Portfolio Manager), 28 badges with honest, checkable criteria that never reward profit, streaks, the "What kind of trader are you?" quiz with a recommended path.
- [x] **Options analyzer** in the Options Lab: what-if sliders, P&L curves at several dates, the 1σ / 2σ probability cone, probability of profit, greeks across the range, assignment and early-exercise warnings.
- [x] **Trade planner and risk calculator** (`BT.risk`): "Plan this trade" in the dashboard and Replay tickets and a standalone calculator; the planned stop and target are saved with the order.
- [x] **Paper-engine realism**: volume-limited partial fills, slippage, commission presets, dividends, cash interest, a pattern-day-trader toggle and a short-borrow fee, all off by default.
- [x] **Coach** (`BT.coach`): free rule-based review of every order and closed trade (risk, stops, reward-to-risk, loss beyond plan, trend, revenge trading, overtrading, size, averaging down) with lesson links. Pro AI coach through the Worker's `/coach` route with an education-only prompt, a daily cap and a rule-based fallback. Guide: `docs/COACH.md`.
- [x] **CSV upload** for back-testing on your own data (`BT.csv`).
- [x] **Module 10**, *Your Trading Toolkit: Screeners, Rules & Competitions* (`course/m10-toolkit.json`).
- [x] **Docs**: LEAGUES, COACH; TEACHING_GUIDE (four-week league assignment, screener lab, rule-builder lab, XP and participation); COMPETITIVE_ANALYSIS Tier 1 marked shipped.

### v0.5 follow-ups (before tagging, or first thing in v0.6)

- [ ] Wire a "Ask the AI coach" button into the coach notes box (dashboard and Replay) for Pro members, labelled as an AI review and shown under the rule-based notes (`docs/COACH.md`, section 6).
- [x] Coach findings land in the journal entry's `coach` field after a fill (dashboard and Replay) and show in the journal entry editor, with an 'Ask the AI coach (Pro)' button there.
- [ ] Show coach findings in the journal's weekly review.
- [x] `course/es/m10-toolkit.json` (Spanish Module 10) and Spanish strings for the league, screener, builder and profile pages (the e2e Spanish pass measures 85–98 % of visible text changing).
- [x] Extend `tests/e2e.playwright.js` to the four new pages (league create → join → order refused by a rule → standings → projector; a built-in scan; a template backtest in the builder; the profile page) and refresh `docs/screenshots/`.
- [ ] Screener "open in Replay" from a result row; share a rule as a short code.
- [ ] XP level and badge count in the classroom snapshot so the instructor roster can show them (opt-in, no new personal data).
- [ ] Demo stock splits in the paper engine.
- [ ] Bump `course/index.json` `version` to `0.5.0`.

### Deferred from v0.3 and v0.4

Still wanted; not built yet.

- **Self-checking exercises** in lessons (expected paper-account state → marked done automatically). First Week checks and Replay drills do this; lesson exercises still rely on the "done" tick.
- **Portfolio export / import** as JSON (the journal and instructor data export; the portfolio does not).
- **More patterns and indicators**: harami, piercing line, dark cloud cover, tweezers; Keltner, Donchian, Parabolic SAR, Williams %R, CCI, MFI.
- **Data accuracy**: provider delay badge on every price, stale-data warning when cache age exceeds the interval (the adjusted-close toggle shipped for CSV uploads).
- **Lesson authoring guide** and a standalone JSON validator script (today the validators are tests; see `docs/I18N.md`).
- **Haitian Creole** interface and course (`ht`), the second most common home language after Spanish in Broward County. The i18n layer is ready; it needs a dictionary and translators.
- **Assign modules and drills with due dates** from the instructor page; a Canvas-friendly gradebook export.

## v0.6 — Daily habit and classroom depth (next)

Goal: give students a reason to open the app every day and give instructors the assignment tools that classroom games have. Drawn from Tier 2 of `docs/COMPETITIVE_ANALYSIS.md` and the deferred list above.

1. **Chart of the day**: a setup detected from the demo or live scan each day (reusing `BT.screener`), with a two-question check and XP.
2. **Assignments with due dates** in the instructor dashboard (modules, drills, a league), and a Canvas-friendly gradebook CSV.
3. **Push reminders** (PWA notifications, opt-in) for streaks, assignment due dates and league deadlines.
4. **Multi-chart layouts** (2 and 4 panes) with saved templates.
5. **Economic and dividend calendars** (Finnhub) with educational notes on CPI, FOMC and jobs reports; never invented events.
6. **Share a chart as an image** with annotations.
7. **Course mapping** to Florida financial-literacy standards and common college syllabi in the Teaching Guide.
8. The v0.5 follow-ups above that did not make the tag.

## v1.0 — Pro membership

Goal: a sustainable project. Payment arrives only with this release, and only when there is Pro-only value worth paying for. Full design in `docs/BUSINESS.md` and `docs/MARKETING.md`; the backend already exists in `server/` and is deployed by the site owner following `docs/MEMBERSHIP_SETUP.md`.

- **Turn on the backend** for the public site: magic-link accounts, Stripe Checkout, server-signed certificates that `verify.html` checks, classroom sync, online leagues and the Pro AI coach (all built in v0.3 to v0.5 and off by default).
- **Cloud sync** of portfolio, journal, progress and strategies across devices (currently everything is per-browser).
- **Graded capstone**: the Module 8 trading plan plus a backtested strategy and a replay record, reviewed by a human with written feedback.
- **Extra modules**: futures mechanics, forex and futures demo assets with margin explained (Tier 2 in `docs/COMPETITIVE_ANALYSIS.md`), tax basics for traders (US), trading psychology deep-dives, reading earnings and news.
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
- Selling trade signals, "alerts" as a product, or anything presented as advice. The in-app alerts, the screener, semi-auto mode and the coach are learning tools evaluated in the student's own browser; semi-auto mode only proposes, and the student confirms every order.
- XP, badges or league prizes for profit. Gamification rewards learning and process; league standings are discussion tools, never grades.
- Leveraged or perpetual crypto and forex *trading*. Module 9 teaches crypto and ETF market structure and simulates spot crypto on the paper account; we will not simulate 24/7 leveraged products as if they were beginner-friendly.
- Fabricated news, prices or "AI predictions". The Pro AI coach reviews what a student did, under a system prompt that forbids recommendations and predictions (`docs/COACH.md`); it never says what a price will do.
- Ads, selling student data, or collecting more than the pseudonymous classroom snapshot.

## How to propose a change

Open an issue describing the student problem first, the feature second. If the change touches a module interface, propose the `CONTRACTS.md` diff in the issue before writing code. If it touches a page, say how it looks at 390 px and in Spanish. If it is inspired by another product, say which one and what we should deliberately leave out.
