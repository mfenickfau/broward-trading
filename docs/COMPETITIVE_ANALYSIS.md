# Competitive analysis and feature backlog

Reviewed November 2026. Sources are third-party reviews and vendor pages; plan tiers and
counts change often, so re-check before quoting them in marketing.

## Who we compared against

| Product | Category | What they do well | What we take from it |
|---|---|---|---|
| TradingView | Charting + paper trading | Bar replay, server-side alerts with webhooks, Pine Script strategies and strategy tester, stock screener with saved scans, multi-chart layouts, community "ideas" | Screener, no-code strategy builder, saved layouts, publishable chart ideas |
| thinkorswim paperMoney / OnDemand | Broker simulator | Live-market paper trading for stocks, options, futures, forex; OnDemand historical replay; options Analyze tab with risk profiles, probability cones, real-time greeks | Options what-if analyzer, probability cone, futures/forex demo assets |
| Investopedia Stock Simulator | Beginner simulator | Free, $100k virtual portfolio, competitions and leaderboards, education woven into the simulator | Public competitions with leaderboards |
| HowTheMarketWorks / Stock-Trak | Classroom games | Teacher-run contests with 30+ rules (dates, starting cash, commissions, day-trading on/off), anonymous student accounts, assignments, teacher reports, class rankings on a projector | League rules engine, assignments with due dates, projector view, teacher reports |
| The Stock Market Game (SIFMA) | Classroom competition | Team accounts, state and national rankings, curriculum alignment | Team accounts, standards mapping in the teaching guide |
| Wall Street Survivor | Courses + contests | Courses paired with prize contests, badges | Badges and course-linked contests |
| Babypips School of Pipsology | Structured course | Grade ladder from Preschool to Graduation, 350–450 bite-sized lessons, 50+ quizzes with score comparison, trader personality quizzes, Premium tier for advanced modules | Grade ladder, lesson count progress bar, personality quiz, Pro-only advanced modules |
| Trading Game / Three Investeers | Mobile learning apps | Ordered micro-lessons, daily analyst setups, an AI coach after each trade, streaks and XP | Gamification layer, daily "chart of the day", AI coach with a free rule-based fallback |
| Webull paper trading | Broker simulator | Fully free real-time paper trading with options | Real-time data expectations; options paper trading parity |

## What Broward Trading already has that most of them do not

- Market Replay that is tied to paper trading and saves results (TradingView's replay does not save; most simulators have no replay).
- A full course with quizzes, drills, glossary, flashcards, journal and certificate in one free product.
- Instructor dashboard that works offline from share codes, with no student emails required.
- Spanish interface and course.
- Installable PWA, open source, and no account needed to start.

## Gaps turned into features

### Tier 1: build next (v0.5)

1. **Competitions and leagues.** Instructor or anyone creates a league: name, start and end dates, starting cash, commission, slippage, allowed asset classes, day-trading allowed, max position %, short selling on/off. Separate paper account per league. Leaderboard by return, risk-adjusted return and consistency. Team accounts. "Projector view" that cycles rankings for a classroom display. Student join by code. Backed by the worker when configured; local or share-code mode otherwise.
2. **Stock screener.** Filter the universe by price, % change, volume, RSI, distance to SMA 50/200, golden cross today, Bollinger squeeze, candlestick pattern today, sector, kind. Saved scans; "send to watchlist". Works on the demo universe out of the box and on provider data with a key, respecting rate limits.
3. **No-code strategy builder.** Rule blocks (indicator, comparator, value or other indicator, lookback) combined with AND/OR for entry and exit, plus stop/target/trailing rules. Feeds the backtester, alerts, and a "semi-auto" paper mode that proposes trades for one-tap confirmation. Export and import as JSON.
4. **Gamification layer.** XP for lessons, quizzes, drills, journal entries and streaks; levels named after the Babypips-style ladder (Freshman to Graduate); badges with honest criteria; "What kind of trader are you?" personality quiz that recommends a learning path; optional opt-in quiz score comparison.
5. **Options analyzer.** What-if sliders for underlying price, days to expiry and implied volatility; P&L curves at multiple dates; probability cone from IV; greeks over the range; assignment and early-exercise warnings.
6. **Trade planner and risk calculator.** Entry, stop, target, account risk % → shares, dollar risk, R multiple, breakeven win rate. Wired into the trade ticket and the journal.
7. **Realism upgrades to the paper engine.** Volume-limited partial fills, configurable slippage model, commission presets, dividends and cash interest, pattern day-trader rule toggle, short borrow fee, demo corporate actions (splits, dividends).
8. **Coach.** Free rule-based coach that reviews every trade (risk/reward, size vs the 1% rule, trading against the trend, revenge trading after a loss, overtrading) and writes a short note into the journal. Pro: AI coach through the worker, using a server-side model key, limited to lesson content and the student's own trades.

### Tier 2: after v0.5

9. Chart of the day: an automatically detected setup from the demo or live scan each day, with a two-question check.
10. Multi-chart layouts (2 and 4 panes) with saved templates.
11. Share a chart as an image with annotations; community ideas feed when the backend exists.
12. Economic calendar and dividend calendar (Finnhub) with educational notes on CPI, FOMC and jobs reports.
13. Forex and futures demo assets with margin and contract specs explained.
14. Push reminders for streaks and league deadlines (PWA notifications).
15. Assignments with due dates in the instructor dashboard and a gradebook export in Canvas-friendly CSV.
16. Mapping of the course to Florida financial-literacy standards and to common college syllabi in the teaching guide.

### Tier 3: ideas to evaluate

17. Mutual funds and bonds in the simulator (HowTheMarketWorks covers them for younger students).
18. App-store presence by wrapping the PWA (Trusted Web Activity for Android).
19. Live classroom mode with the instructor's chart mirrored to students (room capability or WebSocket on the worker).
20. Scholarship or prize leagues sponsored by local businesses, with the legal review noted in docs/BUSINESS.md.

## Sources

- TradingView review and feature pages: https://chartwisehub.com/tradingview-review/ , https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/ , https://www.luxalgo.com/compare/tradingview/bar-replay/ , https://blog.traderspost.io/article/what-is-tradingview-paper-trading
- thinkorswim paperMoney and OnDemand: https://international.schwab.com/thinkorswim/paper-money-trading , https://www.schwab.com/public/schwab/active_trader/trading_tools/trading_software , https://daytradingtoolkit.com/reviews/thinkorswim-review
- Investopedia Simulator coverage: https://wtop.com/news/2026/08/5-of-the-best-sites-for-paper-trading-stocks/ , https://bullishbears.com/investopedia-review/
- HowTheMarketWorks and Stock-Trak classroom features: https://www.howthemarketworks.com/classroom/ , https://www.stocktrak.com/?p=214185 , https://content.stocktrak.com
- Babypips School of Pipsology: https://www.babypips.com/school/ , https://support.babypips.com/hc/en-us/articles/214791886-How-do-I-register-with-Babypips-com-What-do-I-get , https://takeprofitapp.com/en/learn/babypips-school-of-pipsology-review
- 2026 simulator roundups: https://financeillustrated.com/best-stock-market-simulators/ , https://www.tradicted.com/learn/best-stock-market-simulators/ , https://stockmarketgame.net/stock-market-simulator-for-students , https://chartinglens.com/blog/best-stock-market-simulator-paper-trading
