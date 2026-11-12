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
10. [The certificate](#10-the-certificate)
11. [Academic honesty and the hidden future](#11-academic-honesty-and-the-hidden-future)
12. [Accessibility and accommodations](#12-accessibility-and-accommodations)
13. [Instructor checklist](#13-instructor-checklist)
14. [Appendix A — Deep links](#appendix-a--deep-links)
15. [Appendix B — Suggested slide outline per week](#appendix-b--suggested-slide-outline-per-week)
16. [Appendix C — Discussion prompts](#appendix-c--discussion-prompts)

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
| **App modules used** | All eight course modules (40 lessons), 10 Market Replay drills, journal, glossary, backtester, options lab, compare page |
| **Assessment** | Quizzes, replay drills, a graded journal, a trading-plan capstone, participation. P&L is never graded. |
| **Credential** | The app's completion certificate (free), optionally server-verified if the school runs the backend |

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
4. Decide how students submit work (section 9). The simplest is the school LMS with three uploads: progress JSON, journal CSV, capstone document.
5. Optional: if your school runs the membership backend (`docs/MEMBERSHIP_SETUP.md`), create a class code for the leaderboard and plan to issue verified certificates. Not needed for the course to work.

### Students, Week 1 in class (15 minutes)

1. Open the site on your phone and **add it to your home screen** (`docs/MOBILE.md`). Open it once from the icon.
2. Open **Learn** and confirm Module 1 loads. Open **Replay** and confirm the drill list loads. Both prove the course files are cached for offline use.
3. Open **Portfolio → settings** and confirm the starting cash is $100,000. Do not change commissions yet.
4. Open **Learn → certificate** (bottom of the course home) and find the **Export JSON** button. You will use it every Friday.
5. Open **Glossary → Daily 5** and do today's five questions.

Students who prefer a laptop get exactly the same site; nothing changes.

## 4. How the app supports teaching

| Need | Where it is in the app |
|---|---|
| Readings with embedded live charts and quizzes | Learn → 8 modules, 40 lessons. Every lesson ends with a quiz; scores are stored. |
| Exercises that open the right chart | Exercise blocks in lessons carry deep links (Appendix A). Students tap the button; the dashboard opens with the symbol, timeframe and overlays set. |
| Practice under uncertainty | Replay: the future is hidden; students step bar by bar. Drills grade themselves against criteria (min trades, used a stop, max drawdown, beat buy-and-hold, flat at end). |
| Separating practice from the "real" paper account | Replay trades go to a separate `replay` account; the main paper account stays clean for the forward test in Weeks 5 and 6. |
| Reflection | Journal: every fill becomes an entry; setup / tags / emotion / confidence / rating; stats by group; weekly review checklist with four questions. |
| Vocabulary | Glossary: 220 terms, flashcards with spaced repetition, Daily 5 quiz with streaks. `[[term]]` tooltips inside lessons. |
| Evidence of work | Learn → certificate → Export JSON (progress and quiz scores); Journal → Export CSV; Replay → session history and scorecards. |
| Honesty built in | Demo badge on simulated prices; hidden-future note in Replay; backtest page shows buy-and-hold next to every result; composite signal explains its points and says it is not a prediction. |

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
| 100–110 | Issue certificates (section 10). Final exports. |

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
| Participation and Daily 5 | 5 | In-class exercises; Daily 5 streak or total answered (Glossary → Daily 5 history) |

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

**Optional classroom leaderboard.** If the backend is running, students may opt in by nickname with your class code; it shows return, trades, win rate and max drawdown. Use it for discussion ("why does the top return have the worst drawdown?"), never for grades. It is anonymous and opt-in by design.

## 10. The certificate

Students earn the app's completion certificate when **every lesson is marked done and quiz scores average 80 % or better**. The app checks this (`Learn → certificate` shows a checklist of what is missing). The student enters the name to print, taps **Issue certificate**, and gets a 1600 × 1130 PNG with a certificate id, downloadable or long-pressable to save.

Two kinds of id:

- **Browser-issued** (`BT-YYYY-L…`): created on the student's device with no server. It proves the device completed the course; `verify.html` on that same device confirms it. Good enough for a class elective where the instructor already has the progress JSON.
- **Server-verified** (`BT-YYYY-XXXXXX`, no leading L): issued by the optional backend to a signed-in student, HMAC-signed, checkable by anyone at `verify.html` (name, date, modules, score; never the email). Requires the school to run the Worker (`docs/MEMBERSHIP_SETUP.md`). Recommended if students will put the certificate on a résumé.

The certificate is **not** a licence, a qualification to trade for others, or a statement about profitability. The about page and the certificate's own fine print say so; please repeat it in class.

For a course grade you do not need the certificate at all: the progress JSON carries the same data. The certificate is the student's.

## 11. Academic honesty and the hidden future

- **Replay hides the future.** The chart draws only revealed bars; indicators are computed from revealed bars only. Students cannot scroll ahead. They can, however, look up what the demo series did in a previous attempt, which is why drills grade rule-following (criteria) and not return.
- **Demo data is deterministic and the same for everyone.** That makes drills fair and comparable. It also means a student who memorises a series gains nothing the criteria reward.
- **A year in a drill title is a scenario label.** "NVDA 2023" is a simulated series shaped like a strong trend year, not the real 2023. Say this in Week 2 so nobody cites the drill as market history.
- **Progress and journal files are editable text.** They are evidence of work, not proof. Combine them with in-class exercises and the peer-reviewed capstone; the capstone's evidence must match the journal.
- **Collaboration** on drills and journals is encouraged; the journal entries must be the student's own trades.
- **No real-money advice.** Students must not present their plan to classmates as a recommendation. The disclaimer footer on every page applies to the classroom too.

## 12. Accessibility and accommodations

- The app is phone-first (390 px), with 44 px tap targets, collapsible panels, dark and light themes (More → theme), and system font scaling respected. Students who need larger text can use their phone's text-size setting; the layout reflows.
- All course text is HTML; screen readers read lessons and quizzes. Charts are visual; for students who cannot see them, pair the chart exercises with the backtest tables and the signal panel's written reasons, which carry the same information in text. A text summary of charts is on the roadmap.
- Everything works offline in demo mode once installed, so students without reliable data plans can do the full course; only the News page and live prices need a connection.
- Time: lessons list their minutes; quizzes are untimed and repeatable. Replay drills can be paused indefinitely and resumed.
- Language: the course is in English with a 220-term glossary; Spanish and Haitian Creole translations are planned (roadmap v0.4).

## 13. Instructor checklist

Before Week 1
- [ ] Site published over HTTPS; address shared
- [ ] Installed on your own phone; Module 1 Lesson 1, one drill and one journal entry done
- [ ] Decision: demo mode for the course (recommended)
- [ ] LMS assignments created: six weekly progress uploads, four journal uploads, capstone
- [ ] Optional: backend deployed, class code chosen

Every week
- [ ] Open the week's deep links on your phone the night before (Appendix A)
- [ ] Daily 5 together at the start of class
- [ ] Collect progress JSON (and journal from Week 3)
- [ ] Repeat once: demo prices are simulated; signals describe, they do not predict

Week 6
- [ ] Peer review sheets printed or shared
- [ ] Certificate eligibility checked with each student
- [ ] Students export journal and progress one last time (iOS can clear web-app storage after weeks of disuse)

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
