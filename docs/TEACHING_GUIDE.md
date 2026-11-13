# Teaching with Broward Trading — a six-week elective

A ready-to-run syllabus for a one-credit college elective (or a six-week club, continuing-education or dual-enrolment course) built entirely on the free Broward Trading app. It was written for Broward College students, most of whom will take it on a phone, with an instructor who has no budget and no IT department. Adapt freely: the course content, drills and this guide are MIT-licensed.

Nothing in this course involves real money. Students trade a simulated $100,000 account on simulated or delayed prices, and the course grades **process**, never profit.

---

## Contents

1. [Course at a glance](#1-course-at-a-glance)
2. [Learning outcomes](#2-learning-outcomes)
3. [Setup for instructors and students](#3-setup-for-instructors-and-students)
4. [How the app supports teaching](#4-how-the-app-supports-teaching)
5. [Weekly plan](#5-weekly-plan)
   - [Week 1 — Markets, orders and charts](#week-1--markets-orders-and-charts)
   - [Week 2 — Indicators and the composite signal](#week-2--indicators-and-the-composite-signal)
   - [Week 3 — Risk, position sizing and the journal](#week-3--risk-position-sizing-and-the-journal)
   - [Week 4 — Options basics](#week-4--options-basics)
   - [Week 5 — Strategy, backtesting and replay drills](#week-5--strategy-backtesting-and-replay-drills)
   - [Week 6 — Capstone: the written trading plan](#week-6--capstone-the-written-trading-plan)
6. [Journal assignments](#6-journal-assignments)
7. [Replay drill schedule and pass criteria](#7-replay-drill-schedule-and-pass-criteria)
8. [Grading](#8-grading)
9. [Collecting student work](#9-collecting-student-work)
10. [The classroom code workflow](#10-the-classroom-code-workflow)
11. [The certificate](#11-the-certificate)
12. [Academic honesty and the hidden future](#12-academic-honesty-and-the-hidden-future)
13. [Accessibility, language and accommodations](#13-accessibility-language-and-accommodations)
14. [Instructor checklist](#14-instructor-checklist)
15. [Appendix A — Deep links](#appendix-a--deep-links)
16. [Appendix B — Suggested slide outline per week](#appendix-b--suggested-slide-outline-per-week)
17. [Appendix C — Discussion prompts](#appendix-c--discussion-prompts)
18. [Appendix D — The First Week assignment](#appendix-d--the-first-week-assignment)
19. [Appendix E — Optional week: crypto and ETFs](#appendix-e--optional-week-crypto-and-etfs)
20. [Appendix F — A four-week league assignment](#appendix-f--a-four-week-league-assignment)
21. [Appendix G — Screener lab](#appendix-g--screener-lab)
22. [Appendix H — Rule-builder lab](#appendix-h--rule-builder-lab)
23. [Appendix I — XP, badges and participation](#appendix-i--xp-badges-and-participation)

---

## 1. Course at a glance

| | |
|---|---|
| **Title** | Markets by Doing: Paper Trading and Technical Analysis |
| **Length** | 6 weeks, one 110-minute meeting per week (or two 50-minute meetings) plus 2 to 3 hours of homework a week |
| **Level** | Open elective; no finance or math prerequisite beyond percentages and basic algebra |
| **Format** | Face-to-face, hybrid or fully online. Every exercise is done in the student's own browser. |
| **Devices** | Phone is enough. A laptop helps for the backtester and the capstone write-up but is not required. |
| **Cost** | $0. No textbook, no accounts, no API keys needed (demo mode). |
| **App modules used** | Course Modules 1 to 8 (40 lessons; Module 9 on crypto and ETFs is optional, Appendix E; Module 10 on the screener, rule builder, risk calculator, coach and leagues supports Appendices F to H), 10 Market Replay drills, journal, glossary, backtester, options lab, compare page, the First Week path for beginners (Appendix D), Classroom codes (section 10), and optionally a class league (Appendix F), the screener (Appendix G) and the strategy builder (Appendix H) |
| **Assessment** | Quizzes, replay drills, a graded journal, a trading-plan capstone, participation. P&L is never graded. |
| **Credential** | The app's completion certificate (free, printable from `certificate.html`), optionally server-verified if the school runs the backend |
| **Language** | The interface and the course are in English and Spanish (EN / ES toggle in the app); students may work in either. Quiz ids and answers are identical in both, so grading is unaffected. |

Time budget per week for students: about 60 minutes of lessons (two modules in Week 1, one module in Weeks 2 to 6, plus Module 7 drills spread across weeks), 30 to 45 minutes of drills and paper trading, 20 minutes of journaling, 10 minutes of Daily 5 / flashcards.

## 2. Learning outcomes

By the end of the course a student can:

1. Explain what a share, an exchange, a quote and the spread are, and read a chart in any timeframe.
2. Use market, limit, stop and stop-limit orders correctly and explain when each is appropriate.
3. Compute and interpret moving averages, RSI, MACD, Bollinger Bands, ATR and ADX, and explain what each one does **and** does not tell you.
4. Size a position from a risk budget (the 1 % rule), place a stop at entry, and compute risk / reward and expectancy.
5. Describe calls, puts, premium, the Greeks and the payoff of a covered call, protective put and vertical spread.
6. Write a rule-based strategy, backtest it honestly, identify look-ahead bias and overfitting, and explain why the best backtest is usually the wrong one to trust.
7. Trade a historical period bar by bar with the future hidden, follow a stated rule under uncertainty, and evaluate the result against buy-and-hold.
8. Keep a trading journal with setup, emotion and lesson for every trade, and run a weekly review that produces one concrete change.
9. Write a one-page trading plan with edge, rules, risk architecture, routine and review process, and defend it.
10. Explain, in plain language, why none of the above predicts the future and why simulated results overstate real ones.

Outcome 10 is not a footnote. It is the one that protects students once the course is over.

## 3. Setup for instructors and students

### Instructor, before Week 1 (about one hour)

1. Publish the site (GitHub Pages is free; `docs/DEPLOY.md`). Confirm it opens over `https://`. Write the address somewhere students will see every week.
2. Install it on your own phone (`docs/MOBILE.md`) and work through Module 1 Lesson 1, one Replay drill (`ride-the-trend-nvda-2023`) and one journal entry, so you have seen every screen students will see.
3. Decide whether to use live data. **Recommended: demo mode for the whole course.** Demo prices are deterministic, so every student sees the same chart and every drill is gradable. Live data is a good Week 6 "now look at the real thing" moment.
4. Decide how students submit work (section 9). The simplest is **a class code** (section 10): students join once and you see the whole section's progress on one page, with no uploads. Keep the LMS for the capstone document and, if you grade the journal's reflection, the journal export.
5. **Create your class code** on `instructor.html` (More → Instructor), five minutes; copy the invitation text into your syllabus and first slide. Full walkthrough in `docs/INSTRUCTOR_GUIDE.md`.
6. Optional: if your school runs the membership backend (`docs/MEMBERSHIP_SETUP.md`), classroom snapshots sync automatically and you can issue verified certificates. Not needed for the course to work; share codes do the same job by hand.
7. If several students are new to markets altogether, consider assigning the **First Week** (`start.html`) before Week 1 or alongside it (Appendix D).

### Students, Week 1 in class (15 minutes)

1. Open the site on your phone and **add it to your home screen** (`docs/MOBILE.md`). Open it once from the icon.
2. Open **Learn** and confirm Module 1 loads. Open **Replay** and confirm the drill list loads. Both prove the course files are cached for offline use.
3. Scroll to the **Classroom** card on the course home, enter the class code and a first name or nickname, and tap **Join**. Read the two-sentence privacy line with the class (section 10).
4. Open **Portfolio → settings** and confirm the starting cash is $100,000. Do not change commissions yet.
5. Open **Learn → certificate** (bottom of the course home) and find the **Export JSON** button, the backup route if a share code ever fails.
6. Open **Glossary → Daily 5** and do today's five questions.
7. Students who prefer Spanish tap **ES** in the nav. Everything, including quizzes and the certificate, stays identical for grading.

Students who prefer a laptop get exactly the same site; nothing changes.

## 4. How the app supports teaching

| Need | Where it is in the app |
|---|---|
| Readings with embedded live charts and quizzes | Learn → Modules 1 to 8 (40 lessons) for this syllabus, plus the optional Modules 9 and 10. Every lesson ends with a quiz; scores are stored. |
| Exercises that open the right chart | Exercise blocks in lessons carry deep links (Appendix A). Students tap the button; the dashboard opens with the symbol, timeframe and overlays set. |
| Practice under uncertainty | Replay: the future is hidden; students step bar by bar. Drills grade themselves against criteria (min trades, used a stop, max drawdown, beat buy-and-hold, flat at end). |
| Separating practice from the "real" paper account | Replay trades go to a separate `replay` account; the main paper account stays clean for the forward test in Weeks 5 and 6. |
| Reflection | Journal: every fill becomes an entry; setup / tags / emotion / confidence / rating; stats by group; weekly review checklist with four questions. |
| Vocabulary | Glossary: 220 terms, flashcards with spaced repetition, Daily 5 quiz with streaks. `[[term]]` tooltips inside lessons. |
| Evidence of work | **Classroom**: students join with your class code and their progress, quiz scores, drill scorecards, paper stats and journal counts appear on your roster (section 10). Fallbacks: Learn → certificate → Export JSON; Journal → Export CSV; Replay → session history. |
| A gradebook that follows this guide | Instructor page → Gradebook: the weights in section 8, automatic scores for quizzes, drills, journal completeness and Daily 5, manual boxes for the forward test and capstone, CSV export. |
| A gentle start for beginners | First Week (`start.html`): seven days × three tasks with checks that tick themselves (Appendix D). |
| A class competition that grades process, not rank | Leagues (`leagues.html`): one rule set for everyone, a separate paper account per league, standings with drawdown and Sharpe next to return, a projector view; works offline with codes (Appendix F, `docs/LEAGUES.md`). |
| Feedback on every trade without grading it by hand | The coach notes under the trade ticket flag missing stops, oversized risk, low reward-to-risk, revenge trades and overtrading, with a lesson link (`docs/COACH.md`). |
| Sizing from a risk budget | "Plan this trade" in the ticket (`BT.risk`): equity, risk % and stop → shares; the planned stop and target are saved with the order and seen by the coach. |
| Finding and testing setups | Screener (Appendix G) and Strategy Builder (Appendix H): ready-made scans, AND / OR rule blocks, a plain-English description and a backtest in one screen. |
| Motivation without rewarding gambling | XP, levels and badges on `profile.html`; no XP for profit or rank (Appendix I). |
| Spanish-speaking students | EN / ES toggle translates the interface and, where the files exist, the course; untranslated lessons show an "English only" badge and open in English. |
| Printed hand-outs | Every lesson has Print / Save as PDF (one lesson or the whole module); quizzes print as worksheets without answers. `certificate.html` prints the certificate on one landscape sheet. |
| Honesty built in | Demo badge on simulated prices; hidden-future note in Replay; backtest page shows buy-and-hold next to every result; composite signal explains its points and says it is not a prediction; the roster marks paper return "never graded". |

## 5. Weekly plan

Each week lists: the lessons students read **before** class, what to do **in class**, the **drill** (from Week 2), the **journal assignment**, and the **deliverable** that is graded. "Lesson ids" refer to `course/*.json` and can be opened directly with `learn.html#/lesson/<id>`.

### Week 1 — Markets, orders and charts

**Before class (about 100 minutes):** Module 1 (m1-l1 to m1-l5) and Module 2 (m2-l1 to m2-l5). This is the heaviest reading week; tell students so. Quizzes for both modules.

**In class (110 minutes)**

| Min | Activity |
|---|---|
| 0–15 | Setup (section 3). Everyone installs the app and exports a first (empty) progress file so Friday's export is familiar. |
| 15–30 | Discussion: "The price of a share is set by other people." What does that imply about charts? Use `index.html#symbol=AAPL&interval=1day&ov=` with everything turned off. Ask: trend? where would buyers step in? |
| 30–50 | **Exercise 1.1 — Read a quote.** On the dashboard, tap the price. Identify last, change, bid / ask if shown, volume. Switch to 5-minute bars (`#symbol=MSFT&interval=5min&ov=vwap`): what changed, what did not. |
| 50–75 | **Exercise 1.2 — Place every order type.** In the trade ticket on AAPL, daily: (a) buy 10 shares at market; (b) place a limit buy 2 % below the last price; (c) place a stop sell 3 % below the last price on the shares you own. Open Portfolio → Open orders and explain to a neighbour which order is resting and why. Cancel the limit. **Leave the stop.** |
| 75–95 | **Exercise 1.3 — Support, resistance and patterns.** `#symbol=MSFT&interval=1day&ov=sma20,sma50,sr`: name the levels the app drew; disagree with one and say why. Then `#symbol=AAPL&interval=1day&ov=sma20,pat,sr`: find one pattern the detector flagged, read its description, decide whether you would have noticed it without the label. |
| 95–110 | Introduce the journal: `journal.html`. The market buy from Exercise 1.2 is already there (auto-synced). Fill setup = "No setup (impulse)", emotion = whatever is true, confidence, one-line notes. First Daily 5 together. |

**Drill:** none yet; Replay is introduced in Week 2.

**Journal assignment:** complete the entry for today's market buy. Add one manual entry titled "What I believed about trading before this course" (symbol can be blank or SPY; use notes and lessons).

**Deliverable (Friday):** progress JSON showing Modules 1 and 2 lessons done and both quizzes attempted. Quiz scores below 80 % may be retaken; the best score is stored.

### Week 2 — Indicators and the composite signal

**Before class (about 60 minutes):** Module 3 (m3-l1 to m3-l5) and m7-l1 "How to use Market Replay honestly".

**In class**

| Min | Activity |
|---|---|
| 0–10 | Daily 5 together. Review one quiz question from Module 3 that most students missed (ask for a show of hands per choice). |
| 10–35 | **Exercise 2.1 — Moving averages are late on purpose.** `#symbol=AAPL&interval=1day&ov=sma20,sma50`. Find the last crossover; count the bars between the price turning and the crossover. Then run `backtest.html#sym=AAPL&tf=1day&strategy=smaCross&fast=20&slow=50&run=1`. Compare the return to buy-and-hold on the same screen. Discussion: lag is the cost of filtering noise. |
| 35–55 | **Exercise 2.2 — Oscillators.** `#symbol=NVDA&interval=1day&ov=ema9,ema21&pane=rsi`. Mark every RSI reading above 70. How many were followed by a drop within 10 bars? How many by a further rise? Students tally on paper; collect the numbers. |
| 55–75 | **Exercise 2.3 — Bands and volatility.** `backtest.html#sym=MSFT&tf=1day&strategy=bollingerBounce&n=20&k=2&run=1`. Then `#symbol=AAPL&interval=1day&ov=sma20,sma50,sr&pane=atr,rsi`: what does ATR tell you that RSI does not? |
| 75–95 | **Exercise 2.4 — The composite signal explains itself.** On any chart open the Signal panel. Read each reason and its points. Ask: which reasons would you remove? Run `backtest.html#sym=AAPL&tf=1day&strategy=compositeSignal&buyAt=3&sellAt=-3&run=1`. Say out loud, together: "This describes what indicators say now, not what will happen next." |
| 95–110 | **Introduce Replay.** Open `replay.html#drill=ride-the-trend-nvda-2023`. Demonstrate Step, Play, Pause and the hidden-future note. Place one trade live in front of the class and show it appears in the `replay` account, not the main one. |

**Drill (homework):** `ride-the-trend-nvda-2023` (beginner, 12 min). Pass criteria come from the drill; see section 7.

**Journal assignment:** the replay drill writes a session entry; add setup = "Trend pullback" or "SMA crossover", emotion, and one lesson. Set two alerts on the dashboard (RSI below 30 on one symbol, SMA cross on another); write a one-line manual journal entry when either fires during the week, or "none fired" on Friday.

**Deliverable:** progress JSON (Module 3 done, m7-l1 done), replay session visible in Replay → sessions (screenshot or exported later with the journal).

### Week 3 — Risk, position sizing and the journal

This is the most important week. If a student remembers one week, it should be this one.

**Before class (about 60 minutes):** Module 4 (m4-l1 to m4-l5) and m7-l4 "Risk drills".

**In class**

| Min | Activity |
|---|---|
| 0–10 | Daily 5. Quick poll: "How many shares of a $150 stock may you buy if you risk 1 % of $100,000 and your stop is 5 % below entry?" (Answer: risk $1,000; stop distance $7.50; 133 shares.) Most get it wrong the first time; that is the lesson. |
| 10–35 | **Exercise 3.1 — Size from the stop, not from the cash.** Everyone opens AAPL daily and writes down: entry (last price), stop (below the nearest support the app drew), risk per share, shares for a $1,000 risk. Place the buy **and the stop in the same minute**. Check Portfolio → Open orders. |
| 35–60 | **Exercise 3.2 — Expectancy on paper.** Give three scenario strategies (win rate / avg win / avg loss): 70 % / $200 / $500; 40 % / $600 / $300; 55 % / $400 / $400. Compute expectancy. Discuss why the 70 % one loses money. Link to the backtester's profit factor. |
| 60–80 | **Exercise 3.3 — Drawdowns and streaks.** `replay.html#drill=bear-market-survival-2022`, five minutes of play together, pause at the first big rally. Ask: add to a long? Why do the hints say no? |
| 80–100 | **Exercise 3.4 — The journal's stats view.** `journal.html#view=stats`. Students with at least four entries look at P&L by emotion. Discuss what the "FOMO" and "Revenge" rows usually show across most journals. Then `journal.html#view=review`: walk through the seven-item checklist and why each item exists. |
| 100–110 | Assign the drills. Explain that **drills are graded on criteria, not on P&L**, and that the criteria are visible before you start. |

**Drills (homework, choose two of three):** `stop-discipline-tsla-2024` (required), then one of `bear-market-survival-2022` or `crash-and-recovery-xom-2020`.

**Journal assignment:** complete every entry from the drills (setup, emotion, confidence, rating, one lesson each). Run the **weekly review** on Friday: tick the checklist honestly (unticked items are fine; they are the point) and answer all four questions. This is the first graded journal week (rubric in section 8).

**Deliverable:** progress JSON (Module 4 and m7-l4 done), journal export (CSV or JSON) including the weekly review.

### Week 4 — Options basics

Options are advanced; the goal is literacy, not trading. Students use the options lab's synthetic chain (clearly labelled as synthetic) and never need live data.

**Before class (about 60 minutes):** Module 5 (m5-l1 to m5-l5).

**In class**

| Min | Activity |
|---|---|
| 0–10 | Daily 5. Flashcards: everyone grades ten cards from Module 5 vocabulary (strike, premium, intrinsic, extrinsic, delta, theta, IV, assignment). |
| 10–35 | **Exercise 4.1 — Read a chain.** `portfolio.html#options/AAPL`. Pick the nearest expiry. Find the at-the-money call: identify bid, ask, mid, IV, delta. Move one strike up and down; what happens to delta and premium? Why is the far out-of-the-money put still not free? |
| 35–60 | **Exercise 4.2 — Time is a cost.** Same chain: compare the same strike across two expiries. Theta per day is shown; multiply by days to expiry. Discuss who is paid for theta (the seller) and what they give up. |
| 60–85 | **Exercise 4.3 — Payoff diagrams.** Build a covered call and a protective put on the shares bought in Week 3. Read max profit, max loss, breakeven from `analyze()`. Then a bull call spread: what did you give up for the lower cost? |
| 85–100 | **Exercise 4.4 — Why beginners lose with options.** Open a straddle and an iron condor. Discuss: the condor has a high probability of a small win and a small probability of a large loss. Connect to Week 3 expectancy. |
| 100–110 | Paper-trade one defined-risk option position (max 1 % of equity at risk) via `placeOptionOrder` in the lab, with a written exit rule in the journal **before** entry. |

**Drill (homework):** `range-trading-spy-2018` (intermediate, 12 min). Options are not available in Replay; this drill keeps the hidden-future habit going and reinforces mean reversion from Week 2.

**Journal assignment:** the option position entry (setup = "Options: covered call" / "protective put" / "spread") with the exit rule in notes; close or keep the position by Friday and record the lesson. Weekly review.

**Deliverable:** progress JSON (Module 5 done), journal export with the option entry and review.

### Week 5 — Strategy, backtesting and replay drills

**Before class (about 75 minutes):** Module 6 (m6-l1 to m6-l5) and m7-l2, m7-l3 (trend and reversal drills).

**In class**

| Min | Activity |
|---|---|
| 0–10 | Daily 5. One-sentence check: "What is look-ahead bias?" Collect three answers. |
| 10–35 | **Exercise 5.1 — Honest baseline.** `backtest.html#sym=TSLA&tf=1day&strategy=buyAndHold&run=1`. Then the same symbol with `smaCross`. Which has the larger max drawdown? Which would you have actually held through? |
| 35–60 | **Exercise 5.2 — Costs change the answer.** `backtest.html#sym=AAPL&tf=1day&strategy=rsiReversion&low=30&high=70&commission=1&slippageBps=10&run=1` vs the same with no costs. How many trades, and how much did costs eat? Repeat with `smaCross` and `commission=1&slippageBps=10`. |
| 60–85 | **Exercise 5.3 — Overfitting live.** Run the optimiser on `smaCross` over a grid. Take the best parameter pair. Now run those parameters on a different symbol. Discuss the gap. This is the single most memorable demonstration in the course; do not skip it. |
| 85–100 | **Exercise 5.4 — Correlation and diversification.** `compare.html#SPY,AAPL,MSFT,NVDA,JPM,XOM`. Read the correlation matrix. Which pair diversifies? Relative strength vs SPY: which symbol is leading? |
| 100–110 | Assign the forward test: from today, the **main** paper account is the forward test of each student's chosen strategy for the capstone. Replay stays the sandbox. |

**Drills (homework, two required):** `sma-cross-msft-2024` (the rule-following drill) and `breakout-meta-2023`. Students aiming for the top grade band add `short-selling-nvda-2022` or `hourly-swing-msft-2024`.

**Journal assignment:** every forward-test trade logged with setup matching the strategy name and tag `followed-plan` or `broke-rules`. Weekly review. In the "next week" answer, write the one rule you will test in the capstone.

**Deliverable:** progress JSON (Module 6, m7-l2, m7-l3 done), journal export, a screenshot or the exported session list showing the two drill scorecards.

### Week 6 — Capstone: the written trading plan

**Before class (about 60 minutes):** Module 8 (m8-l1 to m8-l5) and m7-l5 (self-review). Draft the trading plan using the lesson's template.

**In class**

| Min | Activity |
|---|---|
| 0–10 | Daily 5. Streak check: who kept it all six weeks? |
| 10–40 | **Peer review of plans.** Pairs swap plans (one page). Each reviewer answers: Is the edge stated as a testable rule? Is the position size derived from the stop? Is there a daily and weekly loss limit? Is there a review routine with a day and time? Could I follow this plan without asking the author anything? |
| 40–65 | **Exercise 6.1 — Prove it.** Each student shows, on their own phone, the three pieces of evidence the plan rests on: the backtest result (with buy-and-hold next to it), one replay drill scorecard that used the same rule, and the forward-test journal stats by setup. |
| 65–85 | **Exercise 6.2 — Live data, once.** Optional. Students who want to enter a free Twelve Data key do so now; others watch. Open the same chart in demo and live. Discussion: the demo was a random walk with realistic shape; what is different about the real one, and what is the same? Reinforce that the course's conclusions do not depend on demo vs live. |
| 85–100 | **Graduation checklist** (m8-l5) together. Students check certificate eligibility in Learn → certificate. |
| 100–110 | Issue certificates (section 11). Final exports. |

**Drill:** `intraday-aapl-5min` (advanced, optional, extra credit): a single simulated session on 5-minute bars with ticks on. Good for students who think intraday is easy.

**Journal assignment:** final weekly review; a closing manual entry titled "What I believe about trading now" to pair with Week 1's.

**Deliverable:** the **trading plan** (one page, PDF or text, rubric below), final progress JSON, final journal export, certificate PNG or id.

## 6. Journal assignments

The journal is graded from Week 3 onward, on completeness and reflection, never on P&L.

Minimum per week: every paper and replay fill carries setup, emotion, confidence and rating; at least one "lessons" field with a specific sentence; the weekly review checklist and all four questions answered on Friday.

What a good "lesson" looks like (share these with students):

- Weak: "Should have waited." Strong: "Entered at the open after a gap up; the hint said to wait for the first pullback. Next time: no entries in the first bar after a gap."
- Weak: "Stop too tight." Strong: "Stop was 1.2 % below entry on a stock whose ATR is 3 %; the stop was inside normal noise. Rule: stop at least 1 ATR away, size down to keep risk at 1 %."
- Weak: "Felt bad." Strong: "Tagged revenge: I re-entered two bars after the stop hit, same direction, no new signal. Cost $640. Rule: after a stop, no re-entry for five bars."

Rubric for one graded journal week (10 points):

| Points | Completeness (5) | Reflection (5) |
|---|---|---|
| 5 | Every fill has setup, emotion, confidence, rating; review checklist and four questions done | Lessons name a specific behaviour and a checkable rule; review's "next week" item is specific |
| 3–4 | One or two entries incomplete, or one review question skipped | Lessons are honest but general ("be patient") |
| 1–2 | Several entries blank; review partly done | Lessons are outcomes ("lost money"), not decisions |
| 0 | No journal export submitted | — |

## 7. Replay drill schedule and pass criteria

Drills come from `course/drills.json`. Each shows its objective, hints and criteria before the student starts, and the scorecard marks each criterion pass / fail at the end. Students may **repeat a drill**; the demo series is deterministic, so a repeat is practice, not a different exam. Grade the best attempt.

| Week | Drill id | Title | Level | Linked lesson | Criteria the scorecard checks |
|---|---|---|---|---|---|
| 2 | `ride-the-trend-nvda-2023` | Ride the trend: NVDA 2023 | Beginner | m2-l2 | At most 3 round trips; return of at least 20 %; no shorts |
| 3 | `stop-discipline-tsla-2024` | Stop-loss discipline: TSLA 2024 | Intermediate | m4-l1 | At least 3 trades; at least 3 stop orders used; max drawdown under 10 % |
| 3 | `bear-market-survival-2022` | 2022 bear market survival | Intermediate | m4-l3 | Max drawdown under 15 %; beat buy-and-hold; at least 1 stop order |
| 3 | `crash-and-recovery-xom-2020` | Crash and recovery: XOM 2020 | Advanced | m4-l2 | Positive return; max drawdown under 20 %; at least 2 stop orders |
| 4 | `range-trading-spy-2018` | Range trading with RSI: SPY 2018–19 | Intermediate | m3-l2 | At least 3 trades; at least 2 limit orders; beat buy-and-hold; win rate 50 % or better |
| 5 | `sma-cross-msft-2024` | Trade the SMA crossover on MSFT 2024 | Intermediate | m3-l1 | 2 to 8 round trips; no shorts; flat at end |
| 5 | `breakout-meta-2023` | Breakout entries: META 2023 | Intermediate | m2-l5 | At least 2 stop orders; return of at least 30 %; max drawdown under 25 %; no shorts |
| 5 (opt.) | `short-selling-nvda-2022` | Short selling practice: NVDA 2022 | Advanced | m4-l4 | At least 1 short; at least 1 stop order; positive return; flat at end |
| 5 (opt.) | `hourly-swing-msft-2024` | Two-week swing trade: MSFT hourly | Intermediate | m6-l1 | 1 or 2 trades; at least 1 stop order; profit factor of at least 1 |
| 6 (opt.) | `intraday-aapl-5min` | Intraday session: AAPL 5-minute | Advanced | m3-l4 | 1 to 4 trades; flat at end; max drawdown under 2 % |

Some drills do carry a return criterion (`ride-the-trend`, `breakout`, `crash-and-recovery`, `short-selling`). They are deliberately generous thresholds on a deterministic series whose shape the drill tells you about in advance; they test whether the student held the position the rule said to hold, not whether they out-traded anyone. Read the criteria aloud before students start.

Drill grading (per required drill, 5 points): 5 = all criteria pass; 3 = attempted to the end with a saved scorecard and a journal entry, some criteria failed; 1 = started, not finished; 0 = not attempted. The instructor never adds a return target beyond what the drill lists, and never ranks students by return.

Say this to students in Week 2 and again in Week 5: a drill where you followed the rule and lost is a pass; a drill where you abandoned the rule and won is the failure the course is trying to prevent.

## 8. Grading

Suggested weights for a 100-point course:

| Component | Weight | Source of evidence |
|---|---|---|
| Lesson quizzes (8 modules) | 20 | Progress JSON: `quizScores` per lesson; grade the module average; best attempt counts |
| Replay drills (6 required) | 20 | Scorecards in Replay → sessions; journal entries with `source: replay` |
| Journal (Weeks 3, 4, 5, 6) | 20 | Journal export, rubric in section 6 |
| Forward test process (Weeks 5–6) | 10 | Journal stats: share of trades tagged `followed-plan`; every trade has a stop; no trade risked more than the plan's limit. Not P&L. |
| Capstone trading plan | 25 | Document plus evidence, rubric below |
| Participation and Daily 5 | 5 | In-class exercises; Daily 5 streak or total answered (Glossary → Daily 5 history); optionally two process badges (Appendix I) |

Letter bands: A 90+, B 80–89, C 70–79, D 60–69.

### Capstone rubric (25 points)

| Criterion | 5 | 3 | 1 |
|---|---|---|---|
| **Edge** stated as testable rules (market, timeframe, setup, entry, exit) | Anyone could execute it without asking the author | Mostly clear; one rule needs judgement | Vague ("buy strong stocks") |
| **Risk architecture** (position size from stop, per-trade %, daily and weekly loss limits, max positions) | All present and consistent with each other | One missing or inconsistent | Size not tied to the stop |
| **Evidence** (backtest vs buy-and-hold with costs, at least one replay drill on the rule, forward-test journal stats) | All three, honestly reported, including what went badly | Two of three | Backtest only, or results cherry-picked |
| **Routine and review** (when to trade, when to journal, weekly review day, what triggers a plan change) | Specific days and times; a rule for changing the plan | Routine present but loose | None |
| **Honesty** (limitations: demo data, small sample, overfitting risk, why simulated results overstate real ones) | Names at least three specific limitations of their own evidence | Generic disclaimer | Claims the plan "works" |

Deduct up to 5 points for a plan that promises a return, uses leverage or shorting without stops, or presents the composite signal as a prediction.

## 9. Collecting student work

Everything is on the student's device; there is no instructor server unless the school deploys the optional backend. Three files per student per week is enough.

| What | How the student gets it | Format |
|---|---|---|
| Course progress and quiz scores | Learn → scroll to certificate → **Export JSON** | `broward-trading-progress.json`: `lessonsDone`, `quizScores` (percent per lesson id), `startedAt` |
| Journal, including replay sessions and weekly reviews | Journal → **Export** → JSON or CSV | One row per entry; `source` is `paper`, `replay` or `manual`; `tags`, `emotion`, `rating`, `pnl` |
| Drill scorecards | Replay → sessions list (screenshot), or rely on the replay journal entries | Screenshot or journal rows |
| Capstone | Any document tool; one page | PDF or text |
| Certificate | Learn → certificate → Download PNG, or the id | PNG or `BT-YYYY-…` id |

On a phone, exports download to Files (iOS) or Downloads (Android); students upload them to the LMS from there. If downloads are blocked in a school-managed browser, the Journal export also shows the text in a box for copy and paste.

Grading the progress JSON quickly: open it in any text viewer; `quizScores` is a flat object of `lessonId: percent`. A spreadsheet formula over 40 ids is enough. A small import script is on the roadmap (v0.4 "progress report file").

**Optional class league.** A league (`leagues.html`) supersedes the opt-in classroom leaderboard: everyone trades the same rules in a separate paper account, and the standings show return, max drawdown, Sharpe ratio and consistency side by side. It works offline with codes, or syncs when the backend runs. Use it for discussion ("why does the top return have the worst drawdown?"), never for grades. Appendix F turns it into a four-week assignment that grades the process around it.

Most sections will not need the three-files-a-week routine at all: the class code in section 10 replaces the progress JSON and the drill screenshots, and reduces the journal upload to the weeks you grade reflection.

## 10. The classroom code workflow

The Classroom feature turns the weekly collection above into one page. The mechanics (modes, roster columns, drawer, gradebook, exports, backups, privacy, troubleshooting) are documented in `docs/INSTRUCTOR_GUIDE.md`; this section is the week-by-week routine for this syllabus.

### Before Week 1

1. Open `instructor.html` (More → Instructor). Create one class per section: name ("FIN 1100 — Markets by Doing"), section, term. You get a six-character code such as `K7Q2MX` (never containing `0`, `O`, `1` or `I`).
2. Tap **Copy invitation text** and paste it into the syllabus, the LMS announcement and the first slide.
3. Open **Export & backup → Backup JSON** and save it in institutional storage. It is how you recover the class on another device.
4. In the gradebook, check the weights match section 8 (they do by default) and that the **required drills** list matches section 7 (`ride-the-trend-nvda-2023`, `stop-discipline-tsla-2024`, one of the Week 3 options, `range-trading-spy-2018`, `sma-cross-msft-2024`, `breakout-meta-2023`). Edit if your section differs.

### Week 1, in class (3 minutes)

Students open Learn → **Classroom** card, type the code and a first name or nickname (tell them which: first name and last initial is usually right), tap **Join**. Read the privacy line aloud:

> The app sends me your course statistics: lessons done, quiz scores, drill results, how much you journal, your paper-trading numbers. It does not send your email, your name unless you type one, your journal text, or your trades. Your paper-trading profit is never graded. You can leave the class at any time from this card.

- **With the classroom server** (`server: connected` in the instructor page header): nothing else; snapshots arrive after every finished lesson or quiz.
- **Without it** (`offline: share codes`): show students **Copy share code**. The code is one line starting with `BT1.`; they paste it into the LMS assignment box each Friday (the LMS timestamps it). Create six weekly "share code" assignments that accept text.

### Every Friday (10 minutes)

1. Paste the week's share codes into **Import share codes** (the box accepts a whole thread of pasted text and finds every code) or tap **Refresh from server**.
2. Sort by **Last active**: anyone quiet for more than a week gets a message on Monday.
3. Sort by **Progress** and compare with the week's reading (Modules 1 and 2 by Week 1, Module 3 by Week 2, Module 4 by Week 3, Module 5 by Week 4, Module 6 by Week 5, Module 8 by Week 6, Module 7 lessons spread across Weeks 2 to 6).
4. Sort by **Quiz avg**; below 80 % is below the certificate threshold and students may retake. Open the drawer to see which module is dragging.
5. From Week 2, sort by **Drills** and check the "required passed" count against the week's assignments.
6. From Week 3, glance at **Journal** (entries, reviewed, weekly reviews). The count is a proxy; the reflection half of the journal rubric still needs you to read the export in Weeks 3 to 6.
7. Never sort by **Paper return** except to pick a discussion prompt.

### Grading weeks and the end of term

- The gradebook computes quizzes, drills, journal completeness and participation automatically with the weights from section 8 and shows a dash where it needs you: forward test (Week 5 to 6 journal export: `followed-plan` share, a stop on every trade, risk within the plan) and the capstone (rubric in section 8). Type the points; clear a box to return to automatic.
- Override the automatic journal score with your rubric score for Weeks 3 to 6; the export records which numbers were yours.
- **Gradebook CSV** → paste into Sheets or Excel (Data → Split text to columns) and match rows by the label you gave each student. Keep the `student_id` column for students who re-joined from a new phone.
- Back up again before entering final grades, then **Delete this class from this device** after grades are submitted. Server snapshots expire by themselves after 400 days.

### What the code does not do

It does not prove identity (a share code is editable text; pair it with in-class exercises and the peer-reviewed capstone), it does not carry journal text or the trade list (ask for the journal export when you grade reflection), and it does not rank anyone. Those are design decisions, not gaps; see `docs/INSTRUCTOR_GUIDE.md` section 10 before changing how you use it.

## 11. The certificate

Students earn the app's completion certificate when **every lesson is marked done and quiz scores average 80 % or better**. The app checks this (`Learn → certificate` shows a checklist of what is missing). The student enters the name to print, taps **Issue certificate**, and gets a 1600 × 1130 PNG with a certificate id, downloadable or long-pressable to save. A **Printable certificate** button then opens `certificate.html`, a single landscape sheet with the name, course, date, id, verification URL and a signature line for you; print it or save it as a PDF from the phone's share sheet.

With Modules 9 and 10 in the course, "every lesson" includes m9-l1 to m9-l5 and m10-l1 to m10-l5 (50 lessons in all). If your section skips the crypto / ETF module (Appendix E) or does not use the screener, builder and league appendices, tell students that the certificate needs those short lessons and quizzes too; each module takes about an hour and stands on its own.

Two kinds of id:

- **Browser-issued** (`BT-YYYY-L…`): created on the student's device with no server. It proves the device completed the course; `verify.html` on that same device confirms it. Good enough for a class elective where the instructor already has the progress JSON.
- **Server-verified** (`BT-YYYY-XXXXXX`, no leading L): issued by the optional backend to a signed-in student, HMAC-signed, checkable by anyone at `verify.html` (name, date, modules, score; never the email). Requires the school to run the Worker (`docs/MEMBERSHIP_SETUP.md`). Recommended if students will put the certificate on a résumé.

The certificate is **not** a licence, a qualification to trade for others, or a statement about profitability. The about page and the certificate's own fine print say so; please repeat it in class.

For a course grade you do not need the certificate at all: the progress JSON carries the same data. The certificate is the student's.

## 12. Academic honesty and the hidden future

- **Replay hides the future.** The chart draws only revealed bars; indicators are computed from revealed bars only. Students cannot scroll ahead. They can, however, look up what the demo series did in a previous attempt, which is why drills grade rule-following (criteria) and not return.
- **Demo data is deterministic and the same for everyone.** That makes drills fair and comparable. It also means a student who memorises a series gains nothing the criteria reward.
- **A year in a drill title is a scenario label.** "NVDA 2023" is a simulated series shaped like a strong trend year, not the real 2023. Say this in Week 2 so nobody cites the drill as market history.
- **Progress files, share codes and journal exports are editable text.** They are evidence of work, not proof. Combine them with in-class exercises and the peer-reviewed capstone; the capstone's evidence must match the journal.
- **Collaboration** on drills and journals is encouraged; the journal entries must be the student's own trades.
- **No real-money advice.** Students must not present their plan to classmates as a recommendation. The disclaimer footer on every page applies to the classroom too.

## 13. Accessibility, language and accommodations

- The app is phone-first (390 px), with 44 px tap targets, collapsible panels, dark and light themes (More → theme), and system font scaling respected. Students who need larger text can use their phone's text-size setting; the layout reflows.
- All course text is HTML; screen readers read lessons and quizzes. Charts are visual; for students who cannot see them, pair the chart exercises with the backtest tables and the signal panel's written reasons, which carry the same information in text. A text summary of charts is on the roadmap.
- Everything works offline in demo mode once installed, so students without reliable data plans can do the full course; only the News page and live prices need a connection.
- Time: lessons list their minutes; quizzes are untimed and repeatable. Replay drills can be paused indefinitely and resumed.
- **Print**: any lesson or whole module prints (or saves as PDF) as clean pages with quizzes as worksheets, for students who read better on paper or need a copy for a reader.
- **Language**: the interface is fully available in **Spanish** (EN / ES in the nav), and the course is translated module by module; a lesson without a Spanish file yet opens in English with an "English only" badge. Quiz ids and answers are identical in both languages, so a student may switch at any time and nothing about grading changes. The 220-term glossary is in both languages where translated. Haitian Creole is next on the roadmap; `docs/I18N.md` explains how a bilingual student or colleague can contribute a translation.
- Students may write journal entries and the capstone in Spanish if you can read it; the journal export is plain text.

## 14. Instructor checklist

Before Week 1
- [ ] Site published over HTTPS; address shared (the public one is https://mfenickfau.github.io/broward-trading/)
- [ ] Decided whether to run the four-week league (Appendix F) and which labs to use (Appendices G and H); if running the league, created it with the **Classroom 4-week** preset and saved its league code
- [ ] Installed on your own phone; Module 1 Lesson 1, one drill and one journal entry done
- [ ] Decision: demo mode for the course (recommended)
- [ ] Class code created on `instructor.html`; invitation text in the syllabus; backup JSON saved (section 10)
- [ ] LMS assignments created: capstone, four journal uploads (Weeks 3 to 6), and six weekly "share code" text boxes if there is no classroom server
- [ ] Decided whether to assign the First Week (Appendix D) and the crypto / ETF week (Appendix E)
- [ ] Optional: backend deployed so snapshots sync automatically

Every week
- [ ] Open the week's deep links on your phone the night before (Appendix A)
- [ ] Daily 5 together at the start of class
- [ ] Friday: import share codes or refresh the roster; sort by Last active, Progress, Quiz avg (section 10)
- [ ] From Week 3: collect the journal export in grading weeks
- [ ] Repeat once: demo prices are simulated; signals describe, they do not predict

Week 6
- [ ] Peer review sheets printed or shared
- [ ] Certificate eligibility checked with each student; printable certificate shown
- [ ] Students export journal and progress one last time (iOS can clear web-app storage after weeks of disuse)
- [ ] Gradebook CSV exported and instructor backup saved before final grades

## Appendix A — Deep links

All relative to the site root. On the installed app, tap a link from the lesson's exercise button or paste the fragment into the address bar of the browser version.

**Dashboard** `index.html#symbol=<SYM>&interval=<1day|1h|15min|5min|1min>&ov=<overlays>&pane=<panes>`
Overlays: `sma20`, `sma50`, `ema9`, `ema21`, `bb`, `vwap`, `ichimoku`, `sr` (support / resistance), `pat` (patterns). Panes: `rsi`, `atr`, `macd`, `stoch`, `adx`, `obv` (comma-separated).

| Use | Link |
|---|---|
| Bare chart | `index.html#symbol=AAPL&interval=1day&ov=` |
| Trend and S/R | `index.html#symbol=MSFT&interval=1day&ov=sma20,sma50,sr` |
| Patterns | `index.html#symbol=AAPL&interval=1day&ov=sma20,pat,sr` |
| Oscillators | `index.html#symbol=NVDA&interval=1day&ov=ema9,ema21&pane=rsi` |
| Volatility | `index.html#symbol=AAPL&interval=1day&ov=sma20,sma50,sr&pane=atr,rsi` |
| Intraday with VWAP | `index.html#symbol=MSFT&interval=5min&ov=vwap` |
| Ichimoku | `index.html#symbol=AAPL&interval=1day&ov=ichimoku` |

**Backtester** `backtest.html#sym=<SYM>&tf=<interval>&strategy=<id>&<params>&run=1`
Strategies and params: `smaCross` (`fast`, `slow`), `rsiReversion` (`low`, `high`), `macdCross`, `bollingerBounce` (`n`, `k`), `breakout` (`n`), `compositeSignal` (`buyAt`, `sellAt`), `buyAndHold`. Costs: `commission=1&slippageBps=10`.

**Replay** `replay.html#drill=<drill id>` (ids in section 7).

**Portfolio** `portfolio.html#positions`, `portfolio.html#settings`, `portfolio.html#options/<SYM>`.

**Journal** `journal.html#new`, `journal.html#view=stats`, `journal.html#view=review`, `journal.html#entry=<id>`.

**Compare** `compare.html#SPY,AAPL,MSFT,NVDA,JPM,XOM` (up to six symbols).

**Glossary** `glossary.html#browse`, `glossary.html#flashcards`, `glossary.html#daily`.

**Course** `learn.html#/module/<moduleId>`, `learn.html#/lesson/<lessonId>`, `learn.html#/certificate`.

**First Week** `start.html` (the day list; each task carries its own link into the app).

**Instructor** `instructor.html` (classes, roster, gradebook, exports). **Printable certificate** `certificate.html` (opened from Learn once a certificate exists; accepts `?name=&id=&date=` for a reprint).

**Crypto and ETFs** `index.html#symbol=BTC-USD&interval=1h&ov=sma20,sma50&pane=rsi,atr`, `index.html#symbol=SPY&interval=1day&ov=sma50,sma200`, `compare.html#SPY,QQQ,IWM,GLD,BTC-USD,ETH-USD`, `learn.html#/module/m9-crypto-etf`.

**Leagues** `leagues.html` (create, join, standings), `leagues.html?join=<BTL1 league code>` (prefills the join box), `leagues.html?projector=1&league=<CODE>` (projector view). Guide: `docs/LEAGUES.md`.

**Screener** `screener.html`, or a built-in scan directly: `screener.html?scan=builtin:oversold-uptrend` (also `builtin:golden-week`, `builtin:squeeze`, `builtin:high52`, `builtin:bull-engulfing`, `builtin:strong-trend`).

**Strategy Builder** `builder.html`, or a template: `builder.html#template=smaCross` (also `rsiReversion`, `macdMomentum`, `bollingerBreakout`).

**Profile** `profile.html` (level, XP history, badges, streak calendar, personality quiz). **Module 10** `learn.html#/module/m10-toolkit`.

## Appendix B — Suggested slide outline per week

Keep slides to five or six; the app is the slide deck.

1. **Week 1**: What a share is → who sets the price → the order book in one picture → four order types in one table → "a chart is a record of crowd behaviour" → tonight's reading.
2. **Week 2**: Lag vs noise → one indicator, one question it answers → the oscillator tally results from class → the composite signal's reasons → "describes, does not predict" → Replay rules.
3. **Week 3**: The 1 % rule worked example → expectancy table → the drawdown-recovery table (lose 50 %, need 100 %) → what journals usually show by emotion → this week's drills and criteria.
4. **Week 4**: Call and put in one diagram each → the chain's columns → theta as rent → covered call and protective put payoffs → why condors hurt beginners.
5. **Week 5**: Buy-and-hold is the bar → costs table from class → the overfitting demonstration (best params on a new symbol) → correlation matrix → forward-test rules.
6. **Week 6**: The one-page plan template → peer-review questions → three pieces of evidence → limitations slide → what the certificate is and is not.

## Appendix C — Discussion prompts

- If the price is "set by other people", what exactly does a moving average measure?
- A strategy wins 70 % of the time and loses money. How?
- Your stop is hit and the stock immediately reverses. Was the stop wrong?
- The optimiser found parameters that returned 180 %. Name three reasons not to trade them.
- The composite signal says BUY with a score of 5 out of a possible 8 (BUY starts at 3). What does that sentence mean, and what does it not mean?
- Which journal emotion would you expect to be the most expensive, and why does seeing it in your own data matter more than hearing it from me?
- The drill series is a simulated 2022. What can it teach you about a bear market, and what can it not?
- Your plan's forward test is 11 trades. What can you conclude? What can't you?
- Why does this course refuse to grade profit?
- An ETF charges 0.03 % a year and another tracking the same index charges 0.95 %. Over thirty years, what is the difference on $10,000, and who received it?
- Bitcoin trades on Sunday at 3 a.m. Your stop order is resting. What is different about that compared with a stock, and what does it mean for position size?

## Appendix D — The First Week assignment

`start.html` is a seven-day path (about twenty minutes a day, three tasks a day) for students who have never looked at a chart. Each task has a "why", step-by-step instructions, a button into the right screen, and a **check that ticks itself** from what the student has actually done in the app: a lesson read, a quiz scored 60 % or better, a market order filled, a stop resting under an open position, an alert set, a Replay drill finished, a journal entry saved, flashcards reviewed, the Daily 5 played. Two tasks per week are manual ticks. Days unlock in order but can be skipped, so nobody is blocked.

| Day | Title | Tasks (check type) |
|---|---|---|
| 1 | Get your bearings | Dashboard tour (`tour`); read m1-l1 "What a stock actually is" (`lesson`); add three companies to the watchlist (`watchlist`) |
| 2 | Read a chart | Read m1-l3 "Reading a quote" and m2-l1 "Anatomy of a candlestick" (`lesson`); look at one stock on three timeframes (`manual`) |
| 3 | Your first paper trade | Read m1-l4 "Order types" (`lesson`); score 60 %+ on its quiz (`quiz`); buy 10 shares with a market order (`trade`) |
| 4 | Risk before reward | Read m4-l1 "Position sizing and the 1 % rule" (`lesson`); place a stop under the open position (`trade`); set a price alert (`alert`) |
| 5 | Indicators, honestly | Read m3-l1 "Moving averages and crossovers" (`lesson`); turn on SMA 20 / 50 and RSI and read the signal card's reasons (`manual`); review five flashcards (`glossary`) |
| 6 | Travel back in time | Read m7-l1 "How to use Market Replay honestly" (`lesson`); finish a Replay drill, suggested `ride-the-trend-nvda-2023` (`replay`); write one lesson in the journal (`journal`) |
| 7 | Make it a habit | Today's Daily 5 (`glossary`); read m4-l5 "Your trading plan, journal and using the paper account well" (`lesson`); save the first weekly review (`journal`) |

**Three ways to use it**

1. **Pre-course warm-up (recommended for open-enrolment sections).** Assign the First Week in the seven days before the first meeting. Students arrive having installed the app, placed a trade, set a stop and finished a drill, so Week 1's setup block shrinks to the class code and the Week 1 exercises go faster. Half of the First Week's lessons (m1-l1, m1-l3, m1-l4, m2-l1) are Week 1 reading anyway, and the rest (m3-l1, m4-l1, m4-l5, m7-l1) are previewed, not replaced.
2. **Differentiated Week 1.** Students who already trade (or think they do) do the Week 1 reading; complete beginners do the First Week instead and catch up on Module 2 in Week 2. The checks keep both groups accountable without extra work for you.
3. **Club or orientation version.** A six-week elective is too long for a club meeting series; the First Week on its own is a complete one-week unit with a visible finish line.

**Grading (optional, 5 points, replaces or supplements Participation in section 8):** 5 = all 21 tasks ticked (the roster's progress and the share code show the lessons, quiz, drill and journal checks; the two manual ticks and the alert / watchlist checks are visible on the student's phone, so ask for a screenshot of Day 7 or trust it); 3 = at least five days complete; 1 = started. The First Week's quiz check is the Module 1 Lesson 4 quiz, which the gradebook already counts, so do not double-grade it.

**What to say to students:** the page says it in its own words, and it is worth repeating. One week does not make a profitable trader. It makes the tools, the words and the two habits (stop at entry, journal after) familiar enough that the course can teach you something every time you open it.

## Appendix E — Optional week: crypto and ETFs

Module 9, *Crypto & ETFs: Different Markets, Same Discipline* (intermediate, 58 minutes, m9-l1 to m9-l5), is in the course because students ask about both in the first ten minutes of any section, and because the honest answer ("same risk rules, different clock and fee structure") is more useful than silence. It is **not** in the six-week plan by default. Three ways to fit it:

- **Week 7** of a seven-week version (the cleanest).
- **Replace Week 4 (options)** in a section where options are out of scope; the risk and sizing lessons in Module 9 carry the same expectancy and position-sizing ideas forward.
- **Homework plus one 30-minute block** in Week 5 or 6, using Exercise E.1 and E.3 only.

**Before class (about 60 minutes):** Module 9 (m9-l1 to m9-l5). The lessons use the demo universe's 17 ETFs (index, sector, international, bond, commodity; each carries its expense ratio, issuer, holdings and what it tracks) and three crypto pairs (BTC-USD, ETH-USD, SOL-USD) that trade 24/7 in the simulator.

**In class (110 minutes)**

| Min | Activity |
|---|---|
| 0–10 | Daily 5. Poll: "Which costs you more over a career: a 0.95 % expense ratio or a 0.03 % one, on $10,000, over 30 years at 7 % before fees?" Compute together: about $75,500 vs about $58,300 after fees; the difference is roughly $17,000, and the fund company received it. |
| 10–35 | **Exercise E.1 — What an ETF is.** Open `compare.html#SPY,VOO,QQQ,IWM,GLD,XLE`. Read the correlation matrix: SPY and VOO are the same index with different fees (why own the dearer one?); QQQ and IWM diverge; GLD and XLE answer to different things. Then on the dashboard open `index.html#symbol=SPY&interval=1day&ov=sma50,sma200`: the same tools as a stock, a basket underneath. |
| 35–55 | **Exercise E.2 — Leveraged and inverse decay.** Quick version on the board: an index goes +10 % then −10 %; a 3× daily fund goes +30 % then −30 %. Finish: index −1 %, fund −9 %. Then the m9-l2 exercise on phones: start both at 100 and apply +4 %, −4 % six times; the fund ends well below the index. Discuss who these products are for (not a buy-and-hold beginner) and why the course does not simulate leveraged trading. |
| 55–80 | **Exercise E.3 — The clock changes, the rule does not.** `index.html#symbol=BTC-USD&interval=1h&ov=sma20,sma50&pane=rsi,atr`. Compare ATR as a % of price with AAPL's. Re-run the Week 3 sizing poll with the new stop distance: risking 1 % of $100,000 on a crypto position whose sensible stop is 8 % away is 125 "units" of a $100 asset, not 1,000. Place that paper trade **with its stop**. Notice `marketStatus` says open on a Saturday; ask what a stop resting overnight on a Sunday means for sleep. |
| 80–100 | **Exercise E.4 — Same toolkit.** Run `backtest.html#sym=BTC-USD&tf=1day&strategy=smaCross&fast=20&slow=50&commission=0&slippageBps=25&run=1` and compare it with buy-and-hold on the same screen, then with AAPL on the same parameters. Slippage is higher on purpose. Discuss: what carries over (trend, drawdown, costs), what does not (hours, custody, no earnings, no circuit breakers). |
| 100–110 | Risk and reality check (m9-l3 on custody, m9-l4 on sizing): a crypto balance at an exchange has no SIPC-style protection, self-custody means nobody can reset a lost key, and major coins have fallen by more than half in past drawdowns. The course teaches market structure and sizing; it does not recommend buying anything. |

**Drill:** none is required. Optional: repeat `ride-the-trend-nvda-2023` and ask students to write in the journal what would have been different had the series been a 24/7 asset with triple the ATR.

**Journal assignment:** one entry for the sized crypto paper trade (setup "Trend pullback" or "Range", the stop distance and the unit count in notes), one manual entry titled "ETF vs stock: what changed in my watchlist and why".

**Deliverable:** Module 9 done and quizzes attempted (visible on the roster), the journal export if it is a graded week. If you run Week 7, add Module 9 to the gradebook's quiz component; it is included automatically because the gradebook sums over every lesson in the course.

**Compliance note for instructors:** keep the framing educational. Do not name a coin or fund as a good buy, do not discuss where to open a crypto account, and repeat the disclaimer footer's line that nothing in the app is a recommendation. If a student asks whether they should buy, the answer the course gives is the one in m9-l4: decide the risk budget first, and know that no lesson here can tell you what a price will do.

## Appendix F — A four-week league assignment

A class league gives students a reason to trade every day for a month, and gives you a month of trades to talk about. Run carelessly, it teaches the opposite of this course: that the person who bet the most on the luckiest day is the best trader. This assignment keeps the competition and grades only the process around it. Mechanics, privacy and fair-play notes are in `docs/LEAGUES.md`; the student-facing lesson is m10-l5, "Competing in leagues: ethics, luck and what leaderboards hide".

**When:** Weeks 3 to 6, starting after the risk lesson (m4-l1) and the first journal assignment, and running alongside the forward test. A league account is separate from the main account, so the forward test in Weeks 5 and 6 stays clean. In a section that skips the forward test, the league can *be* the forward test (see grading).

**Setup (instructor, 10 minutes, the week before)**

1. Open `leagues.html` → **Create a league** → tap **Classroom 4-week**. Name it after the section ("FIN 1100 Spring League"), set the start to the Monday of Week 3 and the end to the Sunday of Week 6. Leave the preset rules as they are: $100,000, $1 commission, 5 bps slippage, stocks and ETFs, day trading on, shorting off, no position above 25 % of equity. Optional: turn on **Teams** with four or five team names.
2. Tap **Create league**, then **Copy invitation text** and post it with the week's announcement. Add the league to the **Leagues** tab on `instructor.html` (paste the `BTL1.` code) so standings sit next to the roster.
3. Without the backend, create four weekly LMS text assignments, "League share code, week N". With the backend, members sync themselves.

**The assignment, as students see it**

| When | Task | Evidence |
|---|---|---|
| Before the start | **League plan**, half a page: which setups you will trade (from the course), your risk per trade (at most 1 % of league equity), where stops go, your maximum number of open positions, and one rule you will follow when you are losing. | Uploaded to the LMS |
| Every trade | Size it with **Plan this trade**, enter with a stop, and annotate the journal entry: setup, emotion, one sentence of reasoning. Read the coach notes after the fill. | Journal export |
| Each Friday | One weekly review in the journal. Tap **Copy my share code** on the league card and paste it into the week's LMS box (or **Sync now** with the backend). | Share code, journal |
| After the end | **Reflection**, one page: your return, max drawdown, Sharpe and consistency from the standings; which coach findings came up most and what you changed; one trade you are proud of regardless of outcome; and why your rank says little about your skill over four weeks. | Uploaded to the LMS |

**In class**

- Week 3, 10 minutes: join together; read the privacy line from section 10; show a rule refusal live (try to short, or buy 40 % of the account) so everyone sees the rules are real.
- Weeks 4 and 5, 10 minutes each: put the **Projector view** up (`leagues.html?projector=1&league=CODE`). Ask the same three questions every time. Who has the smallest drawdown? Whose Sharpe is highest, and is it the same person as the top return? What would the top return look like if the market had gone the other way this week?
- Week 6, 20 minutes: final standings, then discuss the m10-l5 questions. The best discussion is usually about the gap between the return column and the drawdown column.

**Grading (10 points; use it as the forward-test component in section 8, or as extra participation)**

| Criterion | Points | Evidence |
|---|---|---|
| League plan submitted before the start, with a risk-per-trade number and a stop rule | 2 | LMS timestamp |
| Every league trade had a stop and risked no more than the plan's limit | 3 | Journal export and coach findings: no "No stop-loss" or "Risk above 2% of the account" warnings, or each one explained in the journal |
| Every league trade journaled with setup, emotion and reasoning | 2 | Journal export |
| Weekly reviews and share codes submitted (4) | 1 | LMS, journal |
| Reflection that uses drawdown, Sharpe and consistency, names the coach findings and discusses luck honestly | 2 | LMS |

**Rank, return and trade count earn nothing.** A student at the bottom of the table with a full journal and a stop on every trade earns 10 out of 10. A student at the top who abandoned the plan does not. Say this on the first day of the league and again at the end. If you want to recognise someone, recognise the best journal or the smallest drawdown, and never with a real-money prize (`docs/LEAGUES.md`, section 8).

**Variations:** a one-week **Day-trading sprint** for a club meeting (same rubric, scaled to 5 points); the **Long-only investor** preset for a personal-finance section, where the reflection compares the account with simply holding SPY; the **Options challenge** after Week 4 for advanced sections, where the plan must state the maximum premium at risk per trade.

## Appendix G — Screener lab

One 50-minute block, best in Week 2 or 3 after the indicator lessons, or alongside m10-l1, "Using a screener without fooling yourself". The point is not to find stocks to buy. It is to learn that a screener produces candidates to study, and that adding filters until something looks perfect is the same overfitting the backtester lesson warns about.

**Before class:** m10-l1 (12 minutes). Everyone uses demo mode, so every student who scans on the same day sees the same results.

| Min | Activity |
|---|---|
| 0–5 | Poll: "If a screen shows 3 stocks that are oversold in an uptrend, how many of them should you buy?" Keep the answers for minute 45. |
| 5–15 | **G.1 — Read a built-in scan.** Open `screener.html?scan=builtin:oversold-uptrend` and tap **Run scan**. Read the scan's own description aloud: RSI(14) under 35 while price holds above the 200-day average, "a pullback inside a long-term uptrend. Pullbacks can turn into reversals, so a plan needs a stop." Every built-in scan carries a sentence like this; ask students to find the warning in two more (Golden cross this week, Squeeze setups). |
| 15–25 | **G.2 — From row to chart.** Each student picks one result, taps **Open chart**, turns on SMA 50, SMA 200 and RSI, and writes three lines in a manual journal entry: what the scan saw, what the chart adds (trend, support and resistance, volume), and where a stop would have to go. Pairs compare. |
| 25–35 | **G.3 — Build your own.** Start from the filters: price vs moving average (SMA 50, above), RSI between 40 and 60, average volume above 1 million. Tap **Save scan** with a name. This earns the *Screener Scout* badge. Then set **Universe** to *My watchlist* and run it again; **+ Watchlist** on any result adds it to the dashboard watchlist. |
| 35–45 | **G.4 — The data-mining trap.** Keep adding filters (a golden cross within 20 bars, ADX above 25, a candle pattern today) until the list has one name. Ask: is that one stock "the best", or the one that happened to fit five rules you chose after looking? Compare with the backtester's overfitting lesson: the more knobs you turn after seeing the data, the less the result means. |
| 45–50 | Back to the poll. The course's answer: none until each candidate has a plan with an entry, a stop and a size from the risk calculator. |

**Deliverable:** the journal entry from G.2 and a screenshot of the saved scan (or the profile's *Screener Scout* badge). Grade as participation or as part of the Week 2 or 3 journal.

**With a live data key:** a scan of the whole universe takes many requests. The screener waits out per-minute limits instead of burning the key, and stops at a daily limit, listing what it could not reach. In class, keep live scans to the watchlist or one sector.

**Say it once:** a screen finds what matches a rule today. It does not know the future, and a stock appearing in a scan is not a recommendation, from the app or from you.

## Appendix H — Rule-builder lab

One 50- to 60-minute block in Week 5, alongside m10-l2 ("Writing rules a computer could test") and m10-l3 ("From rule to backtest to replay to paper"). It turns the capstone's first criterion, an edge stated as rules anyone could execute, into something students can test before they write it up.

**Before class:** m10-l2 and m10-l3 (25 minutes); m6-l1 (entry and exit rules) if it is not fresh.

| Min | Activity |
|---|---|
| 0–10 | **H.1 — Read a rule.** Open `builder.html#template=smaCross`. Read the **In plain English** box aloud. Ask: could two classmates follow this sentence and make the same trades? (Yes; that is the test for the capstone too.) Switch the site to ES and read it in Spanish if the section is bilingual. |
| 10–25 | **H.2 — Backtest it honestly.** In **Backtest it**, keep the defaults, then set commission to $1 and slippage to 10 bps and run again. Compare with buy-and-hold, as in Week 5. Add a **Stop-loss %** of 5 under Risk exits and run once more. Write down the trades, return, max drawdown and buy-and-hold return for each run. Note the page's warning: risk exits fill at the next bar's open, so a gap can make a loss bigger than the stop. |
| 25–40 | **H.3 — Your capstone rule.** Tap **Start a blank rule** and build the entry and exit you plan to use in the capstone (two or three conditions, AND or OR). Name it and tap **Save rule** (the *Rule Maker* badge). Run it on the symbol you chose, then on a **second symbol you did not look at first**. If it only works on the first, that is the overfitting lesson in your own data. |
| 40–50 | **H.4 — Put it to work, safely.** Tap **Create alert from entry rule**. Then, on the dashboard, turn on **Semi-auto mode** with the saved rule. When the rule fires, the app *proposes* a sized paper trade and waits; nothing is placed without your tap. Discuss why the course built it that way: a rule that trades by itself is how small mistakes become large ones. |
| 50–60 | Optional: **Export current rule** and paste the JSON into the LMS, or swap rules with a partner via Import and backtest each other's. |

**Deliverable:** the exported rule JSON plus a short table of the H.2 and H.3 runs (with costs, against buy-and-hold, on two symbols). It becomes the backtest piece of the capstone's evidence criterion (section 8). The rubric's honesty criterion applies: a rule that loses to buy-and-hold, reported honestly, scores better than a cherry-picked winner.

**Common mistakes to watch for:** conditions that can never be true together (RSI below 30 AND crosses above 70 on the same bar); exits that never fire, so the backtest holds one trade forever; and changing parameters ten times on one symbol, then presenting the best run. The builder's `validate()` catches empty or incomplete rules; only a second symbol and an honest write-up catch the last one.

## Appendix I — XP, badges and participation

The profile page (`profile.html`) gives every student XP, a level (Freshman, Sophomore, Junior, Senior, Graduate, Analyst, Portfolio Manager), badges and a practice-streak calendar. It is built to reward studying and good habits, and it can count toward the participation component in section 8 as long as you keep that intent.

**What earns XP.** Lessons (20 each), quizzes passed at 80 % or more (30, plus 10 at 100 %), finished Replay drills (25), journal entries the student annotated themselves (10), the first paper trade ever (15, once), creating an alert (5), a flashcard session (10), each active day (5) and finishing a league (50). Each award is granted once per item and never taken away, and work done before v0.5 counts automatically.

**What never earns XP.** Profit, return, league rank, number of trades, or trade size. The only XP tied to trading at all is the one-time first fill and the league-finished award, which needs just one league trade. A student cannot level up by trading more or by taking bigger risks.

**How to count it toward participation (suggested: 2 of the 5 participation points)**

1. **Process badges, not totals.** Pick three or four badges that match the habits this course grades and ask for any two by the end of term:
   - *Risk Manager* — 10 trades opened with a stop and no more than 1 % of the account at risk
   - *Journal Keeper* — 14 journal entries
   - *Weekly Reviewer* — a weekly review saved
   - *Drill Passed* — every check of a Replay drill passed
   - *Honor Roll* — 10 quizzes passed at 80 % or more
   - *Flashcard Regular* or *Streak 7* — practice spread over many days
2. **Or a level by a date.** For example: Junior (500 XP) by the end of Week 3 and Senior (1,000 XP) by Week 6. Lessons and quizzes alone get a student there on the syllabus schedule, so this rewards keeping up, not trading.
3. **Evidence.** XP and badges live on the student's device and are not yet part of the classroom snapshot. Ask for a screenshot of the profile page (the badges grid shows earned and locked badges with their criteria), or check it on the student's phone in class.

**What to avoid**

- **Do not count *Replay Pro*** (beat buy-and-hold in five drills) toward a grade. It is the one badge that depends on an outcome, and section 7 says drills grade rule-following, not return. It is fine as a personal goal.
- **Do not grade XP totals or rank students by XP.** Totals reward volume. A student could write empty journal entries for points; cap anything you count, and spot-check the journal export.
- **Do not create your own badges for profit**, "top of the league" or "biggest winner", even informally. They tell students that this course secretly does grade P&L.
- **Keep it optional for students who do not want it.** A student who studies in the printed lessons and on a borrowed laptop may have a thin profile. Offer the Daily 5 history or in-class work as an alternative route to the same points.

**What to say to students:** XP measures how much of the course you have worked through and whether you practise the habits it teaches. It does not measure whether you would make money, and nothing in this app does.
