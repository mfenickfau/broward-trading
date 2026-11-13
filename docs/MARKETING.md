# Marketing — Broward Trading

How to talk about a free educational trading simulator and course without ever sounding like the people it warns students about. This document holds the landing copy for a course sales page, three student personas, the outline of a free-to-Pro email sequence, social post ideas, and a compliance checklist for marketing an educational finance product.

Read `docs/BUSINESS.md` first for what is free, what Pro is, and the prices (placeholders until payments launch: Pro about $9 / month or $59 to $79 / year, verified certificate $39 one-time, capstone review $29, classroom licence per section). Read `docs/COMPETITIVE_ANALYSIS.md` for who else is in this space.

Two rules run through everything below:

1. **We sell proof and people, never profit.** The free product is the simulator and the course. Pro pays for a verified certificate, human feedback, sync and classroom tools. No copy anywhere implies that using the site makes money.
2. **Every claim is checkable in the product.** Lesson counts, drill counts, what the roster shows, what is stored. If the copy says 45 lessons, `course/index.json` says 45 lessons.

---

## Contents

1. [Positioning](#1-positioning)
2. [Landing page copy](#2-landing-page-copy)
3. [Student personas](#3-student-personas)
4. [Email sequence: free to Pro](#4-email-sequence-free-to-pro)
5. [Social post ideas](#5-social-post-ideas)
6. [Instructor outreach](#6-instructor-outreach)
7. [Compliance checklist](#7-compliance-checklist)
8. [Words we use and words we do not](#8-words-we-use-and-words-we-do-not)
9. [Measuring it](#9-measuring-it)

---

## 1. Positioning

**One sentence.** Broward Trading is a free, phone-first paper-trading lab and course that teaches you how markets, charts, risk and options work by doing, in English or Spanish, with a certificate you can verify and a classroom mode your instructor can run with no budget.

**Who it is for.** Community-college students and adult beginners who want to understand markets before risking money; instructors who need a semester's worth of hands-on finance material on students' phones; anyone who has been burned by a "signals" account and wants to learn the real thing.

**Against the alternatives.**

| Alternative | What they are good at | Where we differ |
|---|---|---|
| Broker paper accounts (thinkorswim paperMoney, Webull) | Real-time data, real order types | No course, no replay that saves results, no journal, no instructor tools, require a brokerage sign-up |
| TradingView | Charts, replay, screener, strategy scripting | Replay does not save scorecards; learning content is community-made; paid tiers for the useful parts |
| Investopedia Simulator, HowTheMarketWorks, Stock Market Game | Competitions and classroom contests | Education is thin or separate; leaderboards by return teach the wrong lesson; accounts and emails required |
| Babypips School | A long, well-structured free course | Forex-only, no simulator wired to the lessons, no drills |
| Paid "mentorship" and signal groups | Marketing | Everything we refuse to be |

**What only we do**: Market Replay tied to a paper account and a journal with graded drills; a complete free course with quizzes, glossary, flashcards, First Week and certificate in one product; an instructor roster and gradebook that work offline from share codes with no student emails; Spanish interface and course; an installable PWA, open source, no account to start.

**Proof points to reuse (verify against the repo before each use)**: 9 modules, 45 lessons, about 8.5 hours of reading; 10 graded Replay drills; 220-term glossary; 300+ Daily 5 questions; 17 ETFs and 3 crypto pairs in the demo universe; 2,700+ translated interface strings; MIT licence; 500+ automated tests run before every deploy.

## 2. Landing page copy

For a single sales page (`pricing.html` is the in-app version; this is the standalone page or the top of the README when the site is promoted). Headlines first, then sections in order. Keep the page honest and short; the product is the demo.

### Hero

**Headline options**

- Learn to trade the way pilots learn to fly: in a simulator, with an instructor, before anything is at stake.
- The trading course that grades your discipline, not your profit.
- Markets, charts, risk and options, by doing. Free, on your phone, in English or Spanish.

**Sub-headline.** A free paper-trading lab with a built-in course, Market Replay drills, a trading journal and a certificate you can verify. No account to start. No real money, ever.

**Primary button.** Start free (opens the live site). **Secondary.** Watch a 90-second tour (or: Try the First Week).

**Under the buttons.** Broward Trading is an educational simulator. No real orders are placed and no money changes hands. Nothing here is investment advice.

### Section: what you will be able to do

Written as outcomes, lifted from the Teaching Guide's learning outcomes, in second person:

- Read a chart in any timeframe and say in plain words what buyers and sellers did.
- Use market, limit, stop and stop-limit orders correctly, and know when each one is wrong.
- Size a position from your stop so one losing trade costs 1 % of your account, not 10 %.
- Compute RSI, MACD, Bollinger Bands, ATR and ADX, and explain what each one does **and does not** tell you.
- Read an options chain, the Greeks and the payoff of a covered call or a vertical spread.
- Backtest a rule honestly and explain why the best backtest is usually the one to distrust.
- Trade a historical period bar by bar with the future hidden, follow your rule under uncertainty, and compare the result with buy-and-hold.
- Keep a journal that shows you, in your own numbers, which emotion costs you the most.

### Section: how it works

Three tiles: **Learn** (45 lessons with live charts and quizzes), **Practise** (paper account, Replay drills, alerts, options lab, backtester), **Review** (journal, weekly review, stats by setup and emotion). One line under the tiles: Every lesson links to the exact chart it talks about; every trade becomes a journal entry; every drill gives you a scorecard against the rule you were supposed to follow.

### Section: Market Replay

Headline: **Practise on the past without peeking.** Body: The chart shows only the bars you have reached. Step, play or jump. Place real paper orders; stops and limits fill the way they would have inside the bar. At the end, a scorecard tells you whether you followed the rule, how deep your drawdown went and how you did against simply holding. Ten drills, from riding a trend to surviving a bear market. (Screenshot: the replay page at 390 px with the hidden-future note visible.)

### Section: the First Week

Headline: **Never looked at a chart? Start here.** Body: Seven days, twenty minutes a day, three small tasks each: take the tour, read one short lesson, place one trade, protect it with a stop, finish one drill, write one journal line. Tasks tick themselves as you do them. By Day 7 the tools and the two habits that matter are familiar. One week does not make a trader; it makes the course work for you.

### Section: in Spanish

Headline: **Todo el curso, también en español.** Body (bilingual): One tap switches the interface; course modules are translated one by one and tell you honestly when a lesson is still English only. Quizzes, progress and certificates are identical in both languages.

### Section: for instructors

Headline: **Run a section from your phone. No budget, no IT ticket, no student emails.** Body: Create a class code in five minutes. Students join with a nickname. Your roster shows lessons done, quiz averages, drill results, journal counts and who has gone quiet. A gradebook applies the six-week syllabus's rubric and exports CSV. Works entirely offline from share codes; syncs when your school runs the optional server. Button: Read the Teaching Guide.

### Section: free and Pro

Two columns, mirroring `pricing.html`:

**Free, forever**: the whole simulator, the whole course, Replay, journal, glossary, alerts, options lab, backtester, First Week, classroom join, self-issued certificate, Spanish. Stored in your browser. No account.

**Pro** (when payments launch; price shown before anything is charged): a **verified certificate** with a signed id anyone can check at `verify.html`; **human feedback** on your trading-plan capstone; **sync** of your portfolio, journal and progress across devices; extra modules (futures mechanics, tax basics, psychology deep-dives); priority support. Pro never unlocks a tool that free users cannot use today.

**Classroom licence**: verified certificates for every qualifying student, roster sync, priority support, for the price of a textbook per section.

### Section: honesty block (keep it on the page, not in a footer)

Headline: **What this will not do.** Body: It will not make you money. Simulated results overstate real ones: no slippage from your own size, no fear, no taxes. Demo prices are generated, not real. Indicators and the composite signal describe what a formula says about past prices; they do not predict. We do not sell signals, we do not connect to brokers, and we will not simulate leveraged 24/7 products as if they were beginner-friendly. If a course promises you returns, close the tab; this one promises you understanding.

### Section: FAQ (short)

- *Do I need an account?* No. Everything is in your browser. Pro adds an account for sync and the verified certificate.
- *Is the data real?* Demo mode is a realistic simulation, the same for every student. You can add your own free API key for delayed or real-time quotes; the app tells you which you are looking at.
- *Can I use it on my phone?* It was built for a 390 px screen first. Add it to your home screen and it works offline.
- *Is it really free?* Yes, MIT-licensed, source on GitHub. The simulator and the core course stay free; see the roadmap.
- *Can my school use it?* Yes; start with the Teaching Guide and the Instructor Guide. No procurement needed for the free tier.

### Closing call to action

**Open the simulator.** It takes ten seconds and costs nothing, including your email address.

## 3. Student personas

Three composites built from the audience the course was written for. Use them to decide what a page, email or post should say first.

### Persona 1: Daniela, 19, first-year community-college student

- Taking the elective because a friend did; phone-only (an older Android, limited data plan); works 20 hours a week; family speaks Spanish at home; has a cash app and has seen crypto screenshots on social media.
- **Wants**: to not feel stupid in class, to understand what people are talking about, a credential she can mention on a transfer application.
- **Fears**: losing money, being scammed, math.
- **What convinces her**: the First Week ("twenty minutes a day"), Spanish toggle, offline mode, "no account, no money", the glossary tooltips, the certificate.
- **What loses her**: jargon on the landing page, a sign-up wall, anything that looks like a broker.
- **Pro trigger**: the verified certificate at the end of the course, framed as a line on a résumé or transfer application. Price sensitivity is high; the hardship form matters.
- **Channel**: the instructor's syllabus, TikTok / Instagram explainers, the school's LMS.

### Persona 2: Marcus, 34, adult learner with a brokerage account

- Works in logistics; opened a brokerage account two years ago; bought options on a tip and lost; follows finance YouTube; suspects most of it is noise; wants a method.
- **Wants**: to understand indicators and options properly, to backtest ideas, to stop making the same mistakes.
- **Fears**: wasting more money, paying for another course that is marketing, being sold signals.
- **What convinces him**: the backtester showing buy-and-hold next to every result, the overfitting demonstration, the journal stats by emotion, the "what this will not do" block, open source.
- **What loses him**: gamification that feels childish, anything that promises returns, a thin course.
- **Pro trigger**: human feedback on his trading plan and strategy (the capstone review), cloud sync between phone and laptop, the extra modules (tax basics, psychology).
- **Channel**: Reddit and forum threads about paper trading, GitHub, search ("free backtester", "options payoff calculator"), word of mouth.

### Persona 3: Professor Alvarez, 48, adjunct business instructor

- Teaches at a community college and a dual-enrolment high-school programme; has been asked to add a "personal finance / investing" elective; has no budget, no IT support, a 30-student section on phones; worried about FERPA and about students treating the class as a stock-picking contest.
- **Wants**: a ready syllabus, exercises that work on phones, a way to see who is keeping up, grades that defend themselves to a dean, nothing to install.
- **Fears**: student data leaking, a tool that disappears mid-semester, grading P&L (knows it is wrong), a vendor contract.
- **What convinces her**: the six-week Teaching Guide with rubrics, the Instructor Guide's privacy section (no emails, pseudonymous ids, 400-day expiry), the gradebook that grades process, share codes that work with no server, MIT licence, the deploy-your-own option.
- **What loses her**: leaderboards by return as the headline feature, "AI predictions", anything that needs a credit card to try.
- **Pro trigger**: the classroom licence (verified certificates for her students, roster sync) paid by the department, not by her.
- **Channel**: the Teaching Guide shared instructor to instructor, faculty development sessions, economics and business education mailing lists, a conference poster.

## 4. Email sequence: free to Pro

A free-to-Pro funnel only makes sense once payments exist (`docs/BUSINESS.md` phase 2) and only for students who **chose** to leave an email (the magic-link sign-in or a separate "tell me when Pro launches" form). The site itself never asks for an email to work, and classroom snapshots never carry one. Every email: plain text or minimal HTML, one idea, one link, an unsubscribe link, the educational disclaimer in the footer, no urgency theatre.

Trigger: sign-in or waitlist opt-in. Cadence below assumes the student is active; pause the sequence for anyone who has not opened the app in 14 days and send the re-engagement mail instead.

| # | When | Subject (draft) | Purpose | Body outline | Link |
|---|---|---|---|---|---|
| 0 | Immediately | Your sign-in link (or: You're on the list) | Deliver the magic link / confirm | One line of what to expect: a handful of emails about learning, never about buying anything. | Sign-in |
| 1 | Day 1 | Twenty minutes a day for seven days | Get them doing the First Week | What the First Week is; the first task (take the tour, read one lesson); "tasks tick themselves". | `start.html` |
| 2 | Day 3 | The one rule that protects you | Teach, no pitch | The 1 % rule worked example (risk $1,000 on $100,000; stop $7.50 away; 133 shares). Place one trade with a stop today. | Dashboard with the sizing lesson deep link |
| 3 | Day 6 | Trade 2023 without knowing how it ends | Replay | What Market Replay is; the hidden-future note; one drill. "A drill where you followed the rule and lost is a pass." | `replay.html#drill=ride-the-trend-nvda-2023` |
| 4 | Day 10 | What your journal already knows about you | Journal | Stats by emotion; the FOMO and revenge rows; the weekly review checklist. | `journal.html#view=stats` |
| 5 | Day 14 | Why the best backtest is the wrong one | Teach | Overfitting in one example; run the optimiser, then try the parameters on another symbol. | Backtest deep link |
| 6 | Day 21 | Halfway: what the certificate is, and is not | Introduce the credential honestly | Eligibility (every lesson, 80 % quiz average); self-issued vs verified; what a verifier sees (name, date, modules, score; never email). No price yet if payments have not launched. | `learn.html#/certificate` |
| 7 | Day 30 or on certificate eligibility, whichever first | You qualified. Here is how to make it verifiable. | The Pro offer | Congratulate on the specific achievement (lessons done, quiz average). Verified certificate: one-time price, what it includes, the hardship form on the same page. Also mention capstone review for those who finished Module 8. | `pricing.html` |
| 8 | Day 37 (only if not purchased) | A question, not a pitch | Learn why not | One question: what would make the certificate worth it to you? Reply goes to a human. Mention that the free product is not going anywhere. | Reply |
| 9 | Day 45 (only if not purchased) | Last one from us about Pro | Close the loop | Restate the offer once, plainly; say this is the last Pro email; keep the monthly "what's new" opt-in separate. | `pricing.html` |
| R | 14 days inactive | Your paper account is still there | Re-engagement | What they left (equity, open positions, lessons done, streak); one small next step. No Pro mention. | Dashboard |
| M | Monthly, opt-in | What changed this month | Retention | Changelog highlights in plain language; one teaching idea; one instructor story with permission. | Changelog |

**Instructor track** (separate list, opt-in from the Instructor page): Day 0 welcome with the Teaching Guide; Day 7 the Friday roster routine; Day 21 the gradebook and CSV export; end of term: the classroom licence, framed around verified certificates for students, with a department-friendly one-page PDF.

**Rules for the sequence**

- Emails 1 to 5 contain no offer at all. They are the course's marketing because they are useful.
- No countdown timers, no "only 3 left", no fake scarcity of a digital certificate.
- Every email that mentions Pro also mentions that free stays free and names the hardship option.
- Nothing in any email talks about market direction, a symbol to watch, or a "setup of the day" that could be read as a recommendation.
- Suppress Pro emails for anyone under 18 where that is known (classroom licences for dual-enrolment cover them through the school).

## 5. Social post ideas

Format-agnostic (short video, carousel, text thread). Each is a lesson in miniature with the app as the demonstration; none names a stock to buy. Always include the disclaimer line in the caption: *Educational simulator. No real money. Not advice.*

**Teach something (the bulk of posts)**

1. "You can win 70 % of your trades and lose money. Here is the arithmetic." (Expectancy table from Week 3.)
2. "How many shares? Not 'how much cash do I have'. Start from the stop." (The 1 % rule, screen recording of sizing a trade.)
3. "The optimiser found a strategy that returned 180 %. Watch what happens on a different symbol." (Overfitting demo from Week 5.)
4. "Trade a bear market without knowing how it ends." (Replay drill, hidden-future note on screen, scorecard at the end.)
5. "A 3× leveraged ETF in a sideways market: +4 %, −4 %, six times. Where does it end?" (Module 9 exercise.)
6. "0.03 % vs 0.95 %: the fee you never see leave." (Expense ratio compounding; ETF metadata in the app.)
7. "RSI above 70 means 'sell'? We counted. Here is what happened in the next ten bars." (Week 2 tally.)
8. "Your journal's most expensive emotion, in your own numbers." (Journal stats view, anonymised.)
9. "What a stop order actually does inside a bar." (Replay with tick sub-steps on.)
10. "Why the signal card says 'describes, does not predict' every time." (Composite signal reasons.)
11. "The same chart, demo vs live. Spot the difference, and why it does not change the lesson." (Week 6 moment.)
12. "Candlestick patterns the app found that you probably would not have." (Pattern detector with descriptions.)

**Show the product**

13. "Add it to your home screen; it works offline on the bus." (PWA install, 15 seconds.)
14. "Un toque y todo el curso está en español." (Language toggle, bilingual caption.)
15. "Seven days, twenty minutes a day, tasks that tick themselves." (First Week card filling in.)
16. "Print a lesson as a worksheet with the quiz answers hidden." (Print preview.)
17. "The certificate: what a verifier sees, and what they never see." (`verify.html`, no email shown.)

**For instructors**

18. "Thirty students on phones, no budget, one class code." (Roster filling from share codes.)
19. "A gradebook that refuses to grade profit." (Gradebook with the 'never graded' paper-return column.)
20. "FERPA-minded by design: what a classroom snapshot contains, in full." (The snapshot JSON from the Instructor Guide appendix.)
21. "Six weeks, ready to run: the Teaching Guide." (Scroll through the weekly plan.)

**Community and open source**

22. "Everything is a JSON file. Here is how a lesson is written." (Lesson block types.)
23. "Spanish is done; Haitian Creole is next. Here is how to help." (I18N doc.)
24. "What we will never build." (The roadmap's 'Explicitly not planned' list as a carousel.)
25. "Release notes, in plain language." (Each changelog entry.)

**Posting rules**: no screenshots of real P&L presented as results; demo badge visible in every chart capture; no "I made X %"; no hashtags that signal trading hype (#signals, #100xgems, #passiveincome); reply to "what should I buy?" comments with the Module 9 answer (risk budget first, no lesson here can tell you what a price will do) and a link to the course, never a symbol.

## 6. Instructor outreach

Instructors are the highest-leverage channel: one adoption is 30 students and a semester of retention. They do not respond to marketing; they respond to a syllabus that saves them a weekend.

- **The artefact**: the Teaching Guide as a PDF (print `docs/TEACHING_GUIDE.md`) plus a one-page "run it in five steps" sheet: publish or use the live URL, create a class code, hand out the invitation text, Friday roster routine, gradebook CSV at the end.
- **Where**: economics and business faculty lists, community-college faculty development, dual-enrolment coordinators, FBLA / DECA advisers, financial-literacy standards committees (the course-to-standards mapping on the roadmap is for them), library and tutoring-centre staff who run workshops.
- **The message**: lead with their problem (phones, no budget, grading P&L is wrong, FERPA), show the roster and the gradebook, state the privacy facts, offer the free tier with nothing to sign. Mention the classroom licence only as "when your department wants verified certificates for students".
- **Follow-up**: ask for one thing in return, a 15-minute call after Week 3 about what did not work. That feedback is the roadmap.

## 7. Compliance checklist

Broward Trading is education, not investment advice, and the marketing has to keep it that way in substance and in appearance. This checklist is a working tool, not legal advice; have a lawyer review the sales page, the terms and the refund policy before the first paid transaction (see `docs/BUSINESS.md` section 7).

**Claims and language**

- [ ] No statement, image or testimonial implies that using the product leads to trading profits, income or financial independence.
- [ ] No past-performance figures from the simulator, the backtester or Replay appear in marketing as results. If a backtest screenshot is used to teach, buy-and-hold is visible next to it and the demo badge is in frame.
- [ ] No specific security, ETF or crypto asset is presented as a good or bad purchase in any post, email or page. Symbols appear only as examples of a chart, a tool or a lesson.
- [ ] The words "advice", "recommendation", "signal(s)" (as a product), "guaranteed", "risk-free", "passive income", "financial freedom" and "beat the market" do not appear in marketing copy except inside a sentence that says we do not offer them.
- [ ] The composite signal, alerts and the future coach are described as learning tools that describe indicator states, never as predictions or trade recommendations.
- [ ] Simulated data is called "demo" or "simulated" wherever it is shown; a scenario year in a drill title is explained as a label, not market history.
- [ ] Every marketing page and every email carries the disclaimer: free educational simulator; no real orders; no money; demo prices simulated; nothing is investment, legal or tax advice; trading real money involves risk including loss of the entire investment; past performance, simulated or real, does not guarantee future results.

**Testimonials and endorsements**

- [ ] Student and instructor quotes are real, used with written permission, and describe learning ("I finally understand position sizing"), never money ("I made 20 %").
- [ ] Any material connection (a reviewer who received a free Pro membership) is disclosed next to the quote, per FTC endorsement guidance.
- [ ] No fabricated reviews, no "as seen in" logos without a real article, no invented user counts. Numbers come from the repo or from measured analytics and are dated.

**Credential**

- [ ] The certificate is described as a certificate of **completion** of an educational course. It is not called a licence, qualification, certification, designation or accreditation, and no copy suggests it permits trading for others or is recognised by any regulator or exchange.
- [ ] Self-issued and verified certificates are distinguished exactly as `verify.html` distinguishes them.
- [ ] The verification page is described accurately: it shows name, date, modules and score and never an email.

**Pricing and payments**

- [ ] Prices are shown before any charge, in the buyer's currency where Stripe provides it, with taxes stated as included or added.
- [ ] Subscription terms (renewal, cancellation in one click, refund window) are on the pricing page, not only in checkout.
- [ ] Placeholder prices in the app are labelled as placeholders until payments launch (they are today).
- [ ] No countdown timers, false scarcity or "price goes up tomorrow" unless literally true and scheduled.
- [ ] The hardship / scholarship option is as easy to find as the buy button.

**Privacy and audience**

- [ ] The site works without an email address; marketing never implies otherwise.
- [ ] Email lists are opt-in with a stated purpose, unsubscribe in every message, and no purchased lists.
- [ ] Classroom marketing states plainly what a snapshot contains and does not contain (pseudonymous id, progress numbers; no emails, names unless typed, journal text or trade lists) and that data lives in the instructor's browser or the school's own account.
- [ ] Students known to be under 18 (dual enrolment) are not sent Pro offers; schools are the buyer.
- [ ] Any analytics on the public site are described in the privacy notice; no third-party ad trackers.

**Affiliations**

- [ ] "Broward Trading is an independent project and is not affiliated with, endorsed by or sponsored by Broward College or any broker, exchange or data provider" appears wherever the name could be read as institutional.
- [ ] Data providers (Twelve Data, Finnhub, Alpha Vantage) and TradingView lightweight-charts are credited per their terms; no implied partnership.
- [ ] If a sponsored league or scholarship is ever run (roadmap, tier 3), prize rules, eligibility and sponsor disclosure are reviewed by counsel first.

**Jurisdiction notes to check with counsel**

- [ ] Whether any content could be read as personalised investment advice under the Investment Advisers Act / state equivalents (general education typically is not; "what should I buy" replies must stay general).
- [ ] FTC rules on endorsements, "free" claims and negative-option (subscription) billing.
- [ ] State consumer-protection and automatic-renewal statutes (several states require clear renewal disclosure and easy cancellation).
- [ ] FERPA considerations for the classroom licence contract language (the product is designed so the school, not us, holds identifiable records).
- [ ] Sales tax on digital goods and courses in the states where buyers live; or use a merchant of record (Lemon Squeezy / Paddle) to carry it.
- [ ] Crypto and ETF content: educational only; no custody, no exchange referrals, no affiliate links to exchanges or brokers of any kind.

## 8. Words we use and words we do not

| Use | Avoid |
|---|---|
| learn, practise, understand, drill, review, discipline, process | win, profit, beat, crush, secret, hack, passive income |
| paper trading, simulator, demo prices, simulated | "risk-free trading" (there is no trading), "real-time" unless the provider is real-time |
| describes what indicators say now | predicts, forecasts, calls, picks |
| certificate of completion, verified certificate | certification, licence, qualification, accredited |
| learning tool, alert you set in your own browser | signals, trade alerts (as a product) |
| what this will not do | fine print |
| free, forever, open source, MIT | "free trial", "limited time" |
| grades process, never profit | leaderboard (unless clearly opt-in and for discussion) |

Tone: plain English, second person, explain the why, no emojis, no exclamation marks in headlines, numbers with units. If a sentence would sound wrong read aloud in a classroom, cut it.

## 9. Measuring it

Only measure what we can without tracking people. The free product has no accounts, so most metrics are aggregate or come from opt-in channels.

- **Reach**: GitHub stars and forks (a proxy for instructor and developer interest), referrals to the live URL from the docs, mailing-list size.
- **Activation** (from the e2e-free product itself we cannot see this; from opt-in sign-ins we can): First Week day-7 completion, Module 1 completion, first Replay drill finished.
- **Learning**: quiz averages by module (aggregate, from classroom snapshots where instructors share anonymised totals), drill pass rates by drill.
- **Retention**: Daily 5 streak distribution, weekly reviews saved per active journal.
- **Pro** (when live): certificate conversion among eligible students, capstone-review uptake, refund rate (target under 5 %), hardship grants as a share of certificates (budget 10 to 20 %).
- **Classroom**: sections created, students per section, share codes imported per week, licences.

What we do not measure: individual behaviour on the public site without consent, anything from the Worker's logs beyond rate-limit counters, and anything that would require adding a tracker to a page.
