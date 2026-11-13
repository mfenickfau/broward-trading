# Changelog

All notable changes to Broward Trading. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning loosely (minor = new pages or modules, patch = fixes and copy). Dates are the day the version was tagged or, before tagging, the day work on it was completed.

The project's forward-looking plan is in `ROADMAP.md`; module interfaces are in `../CONTRACTS.md`.

## [Unreleased]

- Spanish course files `course/es/*.json` are added module by module; modules without one show the "English only" badge until they land.
- Extend `tests/e2e.playwright.js` to `start.html`, `instructor.html` and `certificate.html` and refresh `docs/screenshots/`.
- Update the roadmap section of `about.html` to match `docs/ROADMAP.md` (it still describes v0.2 as current).
- Bump `VERSION` in `sw.js` and add the new pages, `css/print.css`, `i18n/es.json`, `course/firstweek.json` and `course/m9-crypto-etf.json` to the precache list.
- v0.5 feature backlog from `docs/COMPETITIVE_ANALYSIS.md`: leagues, screener, strategy builder, gamification, options analyzer, coach.

## [0.4.0] - 2026-11-12

Theme: classroom tools, Spanish, a guided first week, crypto and ETFs, and the first public deployment.

The site is live at <https://mfenickfau.github.io/broward-trading/>, deployed by `.github/workflows/pages.yml`, which runs every unit test on each push to `main` and deploys only when they all pass.

### Added

- **Spanish** (`js/i18n.js`, `BT.i18n`, `BT.t`, `i18n/es.json`): DOM-based translation of the whole interface from a dictionary of exact English strings (2,700+ `ui` entries plus `attrs` for `placeholder`, `title`, `aria-label` and `alt`); a MutationObserver translates content inserted later (toasts, rendered tables, lesson blocks) and skips `<script>`, `<style>`, `<code>`, `<pre>`, `<textarea>`, `<svg>`, `.no-i18n` and input values; originals are remembered on each node so switching back restores English. `BT.t(str, vars)` for JavaScript-built strings with `{name}` interpolation; `fmtNumber` / `fmtMoney` / `fmtPercent` / `fmtDate` via `Intl` for the active locale (`en-US`, `es-419`). Language persisted in `bt.lang`, applied to `<html lang>`, announced with the `bt:lang` event; dictionaries cached in `bt.i18n.<code>` so JS strings translate from the first render. The language list is extensible with `addLang()`. **EN / ES toggle** in the top nav and the More sheet (`js/nav.js`).
- **Language-aware course loading** (`js/course.js`): `lang()` / `setLang()`, `fileFor(name, lang)` → `course/<lang>/<name>`, English fallback per file with an `englishOnly` flag that `learn.js` shows as an "English only" badge on the index, module and lesson; caches drop on `bt:lang`; a switch during an in-flight load never leaves stale data. Same mechanism for `glossary.json`, `drills.json`, `questionbank.json` and `index.json`.
- **Up next** recommendation on the course home (`BT.course.recommend()`): start, resume, next lesson, take the missing quiz, retake the lowest quiz below 80 %, claim the certificate, done. `certificateRecord()` persists the issued certificate (`bt.cert`) for the printable page.
- **Classroom, student side** (`js/classroom.js`, `BT.classroom`): join a class with a six-character code (alphabet without `0`, `O`, `1`, `I`) and an optional display name; pseudonymous `studentId` generated on the device; `snapshot()` built only from localStorage (lessons done, quiz scores, drill scorecards, paper stats, journal counts, Daily 5 streak); **share codes** `BT1.` + base64url of deflate-raw JSON when `CompressionStream` exists, plain base64url JSON otherwise, decodable either way; `parseShareCodes()` finds every code in pasted text; `sync()` posts to `/classes/:code/snapshots` when `apiBase` is set, throttled to once per five minutes except right after a finished lesson or quiz; a **Classroom card** on `learn.html`. State in `bt.classroom`.
- **Instructor page** (`instructor.html`, `js/instructor.js`): create classes (name, section, term) and get a code plus invitation text; import many share codes from one paste; refresh from the server with the per-class instructor token or the instructor secret; sortable roster (label, progress %, quiz average, drills passed and required passed, paper return marked "never graded", journal counts, Daily 5, last active with a stale marker); per-student drawer with module breakdown, drill history, grade sheet and private note; **gradebook** with the Teaching Guide's weights (quizzes 20, drills 20, journal 20, forward test 10, capstone 25, participation 5), editable weights and required-drill list, automatic scores and manual overrides, letters with an incomplete marker; roster CSV, gradebook CSV (with `_source` columns), backup and restore JSON; privacy notice. Formula-leading cells are quoted in CSV. State in `bt.instructor` and `bt.instructor.ui`.
- **Worker classroom routes** (`server/worker.js`): `POST /classes` (instructor session or `INSTRUCTOR_SECRET`) → `{code, instructorToken}`, `GET /classes/:code`, `POST /classes/:code/snapshots` (whitelisted and clamped by `sanitizeSnapshot`, 410 after removal), `GET /classes/:code/roster` (creator session, `X-Class-Token`, or secret), `DELETE /classes/:code/students/:id`; KV namespace `CLASSES` with 400-day expiry; per-IP rate limits; CORS extended for `DELETE` and the classroom headers. Only `sha256(instructorToken)` is stored.
- **First Week** (`start.html`, `js/onboarding.js`, `BT.onboarding`, `course/firstweek.json`): seven days × three tasks for complete beginners with a "why", steps, a deep link and a check (`tour`, `lesson`, `quiz`, `trade`, `replay`, `journal`, `alert`, `watchlist`, `glossary`, `manual`); `status()` evaluates checks against `bt.course`, `bt.portfolio`, `bt.replay.sessions`, `bt.journal`, `bt.alerts`, `bt.flashcards`, `bt.daily5`, `bt.watchlist` and `bt.tour.done` so most tasks tick themselves; days unlock in order and can be skipped; progress in `bt.onboarding`; "Your first week" card on the course home.
- **Dashboard tour** (`js/app.js`): eight-step first-run tour of the chart, indicators, signal, watchlist and trade ticket; re-openable from the Tour button or `?`; completion in `bt.tour.done`.
- **Crypto and ETFs** (`js/data.js`): universe now 50+ US stocks, **17 ETFs** (`kind:'etf'`, `etfType`, `expenseRatio`, `tracks`, `holdings`, `issuer`) and **BTC-USD, ETH-USD, SOL-USD** (`kind:'crypto'`); the demo generator runs a 24/7 calendar for crypto; `marketStatus(symbol)` reports crypto open around the clock; `providerSymbol()` maps `BTC-USD` to `BTC/USD` (Twelve Data), `BINANCE:BTCUSDT` (Finnhub) and the `DIGITAL_CURRENCY_DAILY` function (Alpha Vantage); provider spellings are folded back to `BASE-QUOTE` so cache keys and positions stay consistent. `tests/data.test.js` added.
- **Course module 9** `course/m9-crypto-etf.json`, *Crypto & ETFs: Different Markets, Same Discipline* (intermediate, 58 min, m9-l1 to m9-l5): what an ETF is and what the expense ratio costs; index, sector, bond, commodity and leveraged ETFs; what crypto is and how it trades 24/7; volatility and position sizing; the same toolkit on a different clock. 45 lessons in total; `course/index.json` version 0.4.0.
- **Printing** (`css/print.css`): media-print stylesheet linked from `learn.html` and `certificate.html`; forces the light palette, hides the shell and every button, prints prose on a 65ch measure, replaces live charts with their caption, prints quizzes as worksheets without answers unless already answered, page break between lessons when printing a whole module. **Print / Save as PDF** button in the lesson reader (this lesson or the whole module), hidden when `window.print` is unavailable or the page is framed.
- **Printable certificate** `certificate.html`: landscape sheet with name, course, date, certificate id, verify URL, signature line and the Broward Trading mark, filled from the saved certificate record or `?name=&id=&date=` query parameters; linked from Learn once a certificate exists; hidden from the nav.
- **Shell**: `start.html` (First Week) and `instructor.html` (Instructor) in the More sheet with icons and descriptions; `js/nav.js` injects `js/i18n.js` before a page's own scripts when the page does not include it, so `BT.t` exists everywhere.
- **Tests**: `tests/i18n.test.js`, `classroom.test.js`, `course-v04.test.js`, `data.test.js`, `onboarding.test.js`; `tests/course.test.js` extended. Nineteen unit-test files, more than 500 tests. `tests/course-v04.test.js` validates that every `course/es/*.json` present mirrors its English file (ids, lesson order, quiz answer indexes); `tests/i18n.test.js` validates the dictionary (normalised keys, no empty values, placeholders preserved, brand name never translated).
- **Deployment**: `.github/workflows/pages.yml` (test job, then `actions/deploy-pages`), the live URL and a workflow badge in the README.
- **Docs**: `I18N.md` (translation mechanics, adding a language, keeping Spanish current, the validator), `INSTRUCTOR_GUIDE.md` (Classroom tooling end to end), `MARKETING.md` (landing copy, personas, free-to-Pro email sequence, social posts, compliance checklist), `COMPETITIVE_ANALYSIS.md` (what similar products do and the v0.5 backlog derived from them); `TEACHING_GUIDE.md` gains the classroom code workflow, a First Week assignment and an optional crypto / ETF week; README, ROADMAP and CONTRACTS (v0.4 additions) updated.

### Changed

- `course/index.json` lists nine modules and carries version `0.4.0`; `learn.js` shows the First Week and Classroom cards side by side on desktop and stacked on phones, the Up next card, "English only" badges and the print bar.
- Every UI module (`app.js`, `learn.js`, `portfolio.js`, `backtest-ui.js`, `replay.js`, `journal.js`, `glossary.js`, `news.js`, `compare.js`, `alerts.js`) wraps user-visible strings in `BT.t()` so toasts, table headers and signal reasons translate; English output is byte-identical to v0.3.
- `BT.data.marketStatus()` accepts an optional symbol; with no argument it still describes NYSE.
- `server/README.md` documents the classroom routes, the `CLASSES` namespace and the `INSTRUCTOR_SECRET`.
- Disclaimer copy mentions ETFs and crypto explicitly.

### Security and privacy

- Classroom snapshots never contain emails, real names (unless typed), IP addresses, journal text or trade lists; the Worker whitelists and clamps every field and does not log the sender.
- Instructor authority is the creator's session, a per-class token stored only as a SHA-256 hash, or the deployment's `INSTRUCTOR_SECRET`; roster reads and deletes require one of them.
- CSV exports quote cells that start with `=`, `+`, `-` or `@` so a nickname cannot run as a spreadsheet formula.
- The translation layer never writes into form values and skips `<script>` and `<style>`, so a dictionary entry cannot inject markup or change what a student submits.

### Known issues

- `course/es/` is empty at the time of this entry; Spanish course content shows the "English only" badge until each file lands. The UI dictionary is complete.
- Three assertions in `tests/classroom.test.js` were written against an eight-module course and must be updated for module 9 before the next push (they currently fail locally; see the ROADMAP's release checklist).

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
[0.4.0]: ROADMAP.md#v04--classroom-tools-spanish-and-first-week-current
[0.3.0]: ROADMAP.md#v03--learning-loop-and-phone-app-done
[0.2.0]: ROADMAP.md#v02--modular-app-done
[0.1.0]: ROADMAP.md#v01--single-file-prototype-done
