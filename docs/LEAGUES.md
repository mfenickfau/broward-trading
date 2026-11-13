# Running a paper-trading league

Leagues are paper-trading competitions for a class, a club or a group of friends. Everyone trades the same simulated rules in a separate paper account, and a standings table shows how each account did. This guide covers both ways to run one: **offline**, with codes passed by hand and no server, and **online**, through the optional Cloudflare Worker. It also explains the rule presets and what a leaderboard can and cannot tell you.

No real money is involved anywhere. A league ranks simulated results for discussion; it is not a grade, a prize draw or evidence that anyone can trade.

Code: `js/leagues.js` (`BT.leagues`, pure logic), `leagues.html` + `js/leagues-ui.js` (the page), the Leagues tab on `instructor.html`, and the `/leagues` routes in `server/worker.js`. The interface is specified in `CONTRACTS.md`, "v0.5 additions".

---

## Contents

1. [How a league works](#1-how-a-league-works)
2. [Rules and presets](#2-rules-and-presets)
3. [Running a league offline (codes, no server)](#3-running-a-league-offline-codes-no-server)
4. [Running a league online (with the backend)](#4-running-a-league-online-with-the-backend)
5. [How the standings are calculated](#5-how-the-standings-are-calculated)
6. [Projector view](#6-projector-view)
7. [Teams](#7-teams)
8. [Fair play](#8-fair-play)
9. [Privacy](#9-privacy)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. How a league works

| Piece | What it is |
|---|---|
| **League** | A name, a start and end date (at most 366 days apart), a set of rules, and a six-character code such as `K7Q2MX`. Codes never contain `0`, `O`, `1` or `I`, the same alphabet as class codes. |
| **League account** | Each league a student joins gets its own paper account (`BT.paper.use('league:<CODE>')`, stored as `bt.portfolio.league-<code>`). It starts with the league's starting cash. The main account, the Replay account and every other league stay untouched. |
| **Account switcher** | The trade ticket on the dashboard and in Market Replay has an account switcher: Main, Replay and one entry per joined league. When a league account is active, every order is checked against the league's rules (`BT.leagues.validateOrder`) before it reaches the paper engine, and a rejected order explains which rule stopped it. |
| **Snapshot** | A small summary of a member's league account: equity, return, closed trades, max drawdown and at most 60 points of the equity curve. This is all that ever leaves the device. |
| **Standings** | Members ranked by return, with ties broken by the smaller drawdown. Sharpe ratio, consistency and a sparkline sit next to each row. |

A league moves through three phases. **Upcoming**: members can join, but orders are refused until the start date. **Active**: trading under the rules. **Ended**: from the day after the end date the league account is frozen, so the final standings cannot change. Members who are still in the league when it ends and placed at least one trade in it earn the *League Finisher* badge and 50 XP. Rank and return play no part in that award.

## 2. Rules and presets

| Rule | Range | What it enforces |
|---|---|---|
| Starting cash | $1,000 to $10,000,000 | Opening balance of every member's league account. |
| Commission per order | $0 to $100 | Charged on each fill by the paper engine. Even $1 makes overtrading visible in the results. |
| Slippage | 0 to 500 basis points | Each fill is that much worse than the quoted price (10 bps = 0.10 %). |
| Allowed assets | stocks, ETFs, crypto, options | Orders for any other asset class are refused. |
| Day trading | on / off | When off, a position opened today cannot be closed until tomorrow. |
| Max position | 1 to 100 % of equity | An order that would make one holding larger than this share of league equity is refused, and the message says the largest quantity that would fit. |
| Short selling | on / off | When off, a member can sell only what they own. |
| Teams | on / off, 2 to 12 team names | Members pick a team when they join; team standings average their members. |

Cash, buying power and margin stay the paper engine's job, exactly as in the main account.

### Presets

The create form on `leagues.html` offers four presets. Each fills the form; every field can still be changed.

| Preset | Length | Cash | Commission / slippage | Assets | Day trading | Shorts | Max position | Why |
|---|---|---|---|---|---|---|---|---|
| **Classroom 4-week** | 28 days | $100,000 | $1 / 5 bps | stocks, ETFs | on | off | 25 % | A month-long class contest. The commission makes overtrading cost something; the 25 % cap stops anyone betting the account on one ticker. Pairs with the four-week assignment in `docs/TEACHING_GUIDE.md`, Appendix F. |
| **Day-trading sprint** | 5 days | $25,000 | $0 / 10 bps | stocks, ETFs, crypto | on | on | 50 % | One week with a smaller account and realistic slippage. Shows how fast costs add up when you trade often. |
| **Long-only investor** | 56 days | $100,000 | $0 / 2 bps | stocks, ETFs | off | off | 20 % | Eight weeks of buying, diversifying and holding. No shorts and no same-day round trips. |
| **Options challenge** | 21 days | $50,000 | $0.65 / 10 bps | stocks, ETFs, options | on | off | 15 % | Three weeks with options. The cap is low because options can lose all of their premium quickly. |

For a first class league, use **Classroom 4-week** unchanged. It is the preset the teaching materials assume.

## 3. Running a league offline (codes, no server)

This is the default. It works on the public site, on any copy hosted on GitHub Pages, and from a phone with no account and no backend.

### The organiser

1. Open **More → Leagues** (`leagues.html`) and scroll to **Create a league**.
2. Tap a preset, then set the name and dates. Type an organiser name if you like (optional), and leave **Join this league myself** ticked if you will trade in it too.
3. Tap **Create league**. The page shows the **league code to share**: one long line starting with `BTL1.`. It holds the whole league definition (name, dates, rules, team names), so members need nothing else.
4. Tap **Copy invitation text** and post it in the LMS, a group chat or on a slide. Students can also open `leagues.html?join=<the BTL1 code>`, which fills the join box for them.

An instructor can also add the league to the **Leagues** tab on `instructor.html` (paste the `BTL1.` code into *Add a league by its league code*) to keep league standings next to the class roster.

### Members

1. Open **More → Leagues**, paste the `BTL1.` code into **Join a league**, add a display name (optional; a first name or nickname is enough) and pick a team if the league has teams.
2. Tap **Join league**. A league card appears under **My leagues** with a countdown to the start or the end.
3. Trade from the dashboard or Replay with the league selected in the ticket's account switcher.
4. When the organiser asks (weekly works well, plus once after the end date), tap **Copy my share code** on the league card and send the code to the organiser. It is a line starting with `BT1.`, the same format the Classroom card uses, with a `leagues` block added.

### Collecting standings

1. On `leagues.html` (or the instructor page's Leagues tab), choose the league under **Standings**.
2. Paste the members' share codes into **Import members' share codes**. One code per line, or a whole pasted thread of messages: the box finds every code in the text.
3. Tap **Import codes**. Only the league block of each code is kept. A code from someone who has not joined *this* league is skipped, and a newer code replaces an older one from the same member.
4. The standings, team standings and projector view update straight away. **Clear imported members** starts again from nothing.

Share codes are editable text, so treat offline standings as a discussion tool. The fair-play notes in section 8 explain how to keep that honest.

## 4. Running a league online (with the backend)

When the site owner has deployed the Worker (`docs/MEMBERSHIP_SETUP.md`) with a `LEAGUES` KV namespace and set `apiBase` in `js/config.js`, leagues sync without anyone pasting codes.

### What changes

| | Offline | Online |
|---|---|---|
| League code | `BTL1.` code with the whole definition | The server issues the six-character code, and members can join with just `K7Q2MX`. The `BTL1.` code still works. |
| Joining | Stored on the device | `POST /leagues/:code/join` adds the member on the server. The first join returns an `ownerToken` that only that device holds. |
| Standings | Built from imported share codes | Each member's device posts its league snapshot (`POST /leagues/:code/snapshots`) when they tap **Sync now** on the league card or open the standings, and everyone sees the same table from `GET /leagues/:code/standings`. **Refresh from server** pulls the latest. |
| Accounts | Not needed | Not needed. Leagues use the same pseudonymous student id as the Classroom card. No email, no sign-in. |

### Server setup (site owner, once)

```bash
cd server
npx wrangler kv namespace create LEAGUES
# paste the id into wrangler.toml as a [[kv_namespaces]] block with binding = "LEAGUES"
npx wrangler deploy
```

`GET /health` then reports `leagues: true`. Without the binding every `/leagues` route answers `503 {notConfigured:true}`, and the page quietly stays in offline mode. Full route reference: `server/README.md`.

### Server protections

- **Ownership.** Only the device that joined can post snapshots for that member (`409 {ownerMismatch}` otherwise). The server stores an HMAC of the owner token, never the token itself.
- **Recomputed numbers.** Rules are clamped to the ranges in section 2. Each snapshot keeps at most 60 equity points, and the server recomputes return, drawdown, Sharpe and consistency from those points with the same formulas as `BT.leagues.metrics`. A client cannot claim a return its own equity curve does not show.
- **Phase checks.** Snapshots are refused before the start (`409 {upcoming}`) and from 24 hours after the end (`409 {ended}`).
- **Limits.** 500 members per league, 6 snapshots per member per minute, 5 new leagues per network per minute. League data expires on its own (400 days, longer for long leagues).

## 5. How the standings are calculated

The same formulas run on the device (`BT.leagues.metrics`) and on the server, so offline and online tables agree.

| Column | Meaning |
|---|---|
| **Return** | Equity now versus the league's starting cash. The table is sorted by this, and ties go to the smaller drawdown. |
| **Max drawdown** | The biggest fall from a peak to a later low on the equity curve. Smaller means the account took less pain. |
| **Sharpe ratio** | Average step-to-step return divided by how much it swung, annualised as if the points were daily (×√252). It needs at least three equity points. It rewards steady gains over wild swings. |
| **Consistency** (0 to 100) | 60 % from how often the account rose between equity points, plus 40 % from keeping drawdown small (0 % drawdown scores full marks, 20 % or more scores nothing). |
| **Trades** | Closed trades in the league account. |
| **Sparkline** | The equity curve, at most 60 points. |

Read the table from left to right in class: the highest return is often not the best Sharpe or consistency, and that gap is the most useful discussion a league produces.

## 6. Projector view

Tap **Projector view** under Standings, or open `leagues.html?projector=1&league=<CODE>`. It is built for a classroom screen:

- large type, fullscreen-friendly, dark or light theme as set in the app;
- slides that rotate every 10 seconds: pages of eight standings rows, team standings when the league has teams, and the biggest movers up and down over each member's last few equity points;
- the data refreshes each time the rotation wraps and whenever the tab becomes visible again, so a projector left running stays current (online leagues pull from the server; offline leagues show the latest imports);
- presenter keys: Left / Right arrows or Page Up / Page Down change slides, Space pauses the rotation, F toggles full screen, Escape closes the view.

Before you put it on screen, check the display names. Anyone can type one, and the projector shows exactly what was typed.

## 7. Teams

Turn on **Teams** and list two to twelve team names (comma separated). Members choose a team when they join. Team standings rank teams by the **average** return of their members, with ties broken by average drawdown, so a big team has no advantage over a small one. Teams work well for a class that has just met: a weaker student contributes to a group result instead of sitting at the bottom of a list.

## 8. Fair play

A league is only useful if everyone believes the table. These are the design choices behind it and what the organiser can add.

**Built into the app**

- **Same rules for everyone.** The rules travel with the league code and are checked before every order. Changing them means creating a new league.
- **Frozen after the end.** Orders are refused once the league has ended, and the server refuses late snapshots.
- **Separate account.** A member cannot move a good result from the main or Replay account into a league; each league account starts from the league's cash.
- **No look-ahead.** League trading happens on the live dashboard. Replay drills can reveal future bars of a demo series once you have seen them, so Replay results are never imported into a league.
- **Server recomputation.** Online, the return shown is the return the equity curve supports, from the same capped history for everyone.

**What the app cannot guarantee**

- **Offline share codes are editable text.** A determined student can forge one. Treat offline standings as a discussion tool, never as evidence, and never attach a grade or a prize to them.
- **Resets and second devices.** Someone can leave and rejoin, or join from a second phone under another name. Online, a new device gets a new id, so that shows up as a second row. A short roster check before the projector goes up catches most of it.
- **Luck dominates short leagues.** Over five to twenty-eight days, the top return is mostly a measure of who took the most risk on the day things went their way. The course says so in Module 10, Lesson 5 ("Competing in leagues: ethics, luck and what leaderboards hide").

**Recommended organiser rules**

1. **Never grade on rank or return.** If a league is part of a course, grade the process: a written plan before the start, a journal entry for every trade, stops on every position, a reflection at the end. `docs/TEACHING_GUIDE.md` Appendix F has a rubric.
2. **Show drawdown and Sharpe next to return** every time you show the table, and ask "who would you trust with the class fund?" as well as "who is first?".
3. **No real prizes** unless your institution has reviewed it. Prize contests can bring gambling and securities rules into play; see `docs/BUSINESS.md`. A certificate of participation or a shout-out for the best journal is safer and teaches more.
4. **Display names.** Ask for a first name and last initial, or a nickname, and say that offensive names will be removed (an offline league: clear and re-import without that code; an online league: the site owner can delete the member key).
5. **Talk about the losers' trades too.** The most useful projector slide is often the biggest *down* mover, discussed kindly and with permission.

## 9. Privacy

- **No email, no real name, no account.** A league member is a random student id generated on the device, an optional display name and an optional team.
- **What leaves the device:** the league block of the snapshot only (equity, return, closed-trade count, max drawdown, up to 60 equity points). The trade list, symbols, journal text and the main account never leave.
- **Where it is stored:** offline, in the organiser's browser (`bt.leagues`); online, in the Worker's `LEAGUES` namespace with automatic expiry. The server does not log the sender's IP address with league data.
- **Leaving:** a member can leave a league from its card at any time. Online, the organiser or site owner can delete the member's key from `LEAGUES` (`server/README.md`, "Maintenance").

Read the classroom privacy line from `docs/TEACHING_GUIDE.md` section 10 aloud when a class joins a league. It is just as true here.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| "This league allows stocks, ETFs only" | The organiser excluded that asset class. Switch the ticket back to Main to practise it there. |
| "Day trading is off in this league" | The position was opened today; it can be closed from tomorrow. That is the point of the rule. |
| "This order would make AAPL 31 % of your league equity" | The max-position rule. The message gives the largest quantity that fits. |
| Orders refused before the start date | The league is still upcoming. The card shows the countdown. |
| A member is missing from the offline standings | They have not sent a share code since joining, or their code is from a different league. Ask for a fresh **Copy my share code**. |
| A share code is "not in this league" | The member joined a different league (check the code on their card), or pasted a classroom share code from before they joined. |
| Online standings stuck | Tap **Refresh from server**. A member's device posts its snapshot when they tap **Sync now** on their league card or open the league's standings; a member who never opens the Leagues page again stays at their last snapshot. Ask members to tap **Sync now** after trading and once after the end date. |
| `503 notConfigured` in the console | The Worker has no `LEAGUES` binding. The page falls back to offline mode; see section 4 to add it. |
| The league disappeared after clearing site data | Leagues live in browser storage. Members rejoin with the same code; the organiser re-imports share codes. Online leagues are still on the server: join again by code. |
