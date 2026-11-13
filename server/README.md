# Broward Trading — membership API (`server/`)

A single Cloudflare Worker (`worker.js`) that gives the static site optional accounts, Pro membership via Stripe, verifiable certificates and an opt-in classroom leaderboard. The site works completely without it; `js/config.js` leaves `apiBase` empty until you deploy this.

Non-developer walkthrough with screenshots-in-words: **[../docs/MEMBERSHIP_SETUP.md](../docs/MEMBERSHIP_SETUP.md)**. This file is the technical reference.

## Design

- **No framework, no npm dependencies.** Plain `fetch` handler, WebCrypto for every signature, Stripe and Resend called over REST with `fetch`. Nothing to build; `wrangler deploy` uploads the one file.
- **Six KV namespaces** (`CLASSES` and `LEAGUES` are optional: Classroom sync and online Leagues)

  | Binding | Keys | Value |
  |---|---|---|
  | `MEMBERS` | `member:<email>` · `customer:<stripeCustomerId>` | `{email, pro, plan, proUntil, stripeCustomerId, subscriptionId, …}` · email |
  | `CERTS` | `cert:<id>` · `by:<sha256(email)>` | `{id, name, issuedAt, modules, scorePct, course, pro, emailHash}` · `[ids]` |
  | `TOKENS` | `magic:<jti>` (15 min TTL) · `magic-used:<jti>` (15 min TTL) · `code:<code>` (60 s TTL) · `session:<sha256(id)>` (30 d TTL) · `rl:<bucket>:<hash>:<window>:<shard>` · `stripe:evt:<id>` | one-time magic payload · claim marker `{claim, ipHash, at}` · `{sessionId, email, at}` · `{email, expires}` · sharded counters · dedupe |
  | `LEADERBOARD` | `class:<CODE>` (180 d TTL) | `[{nickname, stats, owner, updatedAt}]` |
  | `CLASSES` | `class:<CODE>` · `student:<CODE>:<studentId>` · `removed:<CODE>:<studentId>` (all 400 d TTL) | `{code, name, section, term, createdAt, ownerKind, owner, tokenHash}` · sanitized snapshot · `'1'` |
  | `LEAGUES` (optional, v0.5) | `league:<CODE>` · `member:<CODE>:<studentId>` (400 d TTL, longer for long leagues) | `{code, name, createdBy, startDate, endDate, rules, createdAt}` · `{studentId, displayName, team, owner, joinedAt, updatedAt, league:{equity, startingCash, returnPct, trades, maxDrawdownPct, sharpe, consistencyScore, equityHistory}}` with a standings row in KV metadata |

- **Magic links**: `POST /auth/magic-link` signs a JWT-like token (`header.payload.sig`, HS256 with `HMAC_SECRET`, `exp` = 15 min, random `jti`) and stores the `jti` in `TOKENS`. `GET /auth/callback?token=` verifies the signature and expiry, then *claims* the `jti` so a link works exactly once: with the optional `MAGIC_LOCK` Durable Object binding the first claim wins atomically; without it a random claim marker is written to `magic-used:<jti>` (a KV write error counts as losing the race), `magic:<jti>` is deleted and the callback proceeds only if its own marker is what KV holds. It then creates a session and redirects to `SITE_URL/pricing.html#code=<one-time code>`. The session id never appears in a URL: the client (`js/auth.js`) scrubs the fragment, posts the code to `POST /auth/exchange` (browser-only, `Origin` required, code deleted on first use, 60 s TTL), confirms the resulting email against the sign-in it started (or asks the student), and only then stores the id as a bearer token and calls `GET /me`. Legacy `#session=<id>` fragments are still understood by the client during a rolling deploy.
- **Sessions**: 32 random bytes, base64url. Only `sha256(id)` is stored, with a 30-day TTL. `POST /auth/signout` deletes it.
- **Stripe**: `POST /checkout` creates a subscription Checkout Session for the monthly or annual Price and returns its URL. `POST /webhook/stripe` verifies `Stripe-Signature` (`t=…,v1=…`, HMAC-SHA256 of `t.rawBody`, constant-time compare, 300 s tolerance), dedupes by event id, and flips `pro` on `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`; `invoice.payment_failed` is recorded. `proUntil` comes from `current_period_end` with a 3-day grace period.
- **Certificates**: `POST /certificates` (signed in; Pro only when `CERT_REQUIRE_PRO="true"`) derives `BT-YYYY-XXXXXX` from `HMAC(secret, "cert|email|name|issuedAt|nonce")` using a 32-character alphabet with no `0/1/O/I`. Ids whose first letter is `L` are reserved for browser self-issued ids (`js/auth.js` → `localCertId`) so the verify page can tell them apart. `GET /verify/:id` returns name, date, modules and score — never the email.
- **Leaderboard**: anonymous and opt-in. One row per nickname per class code; a row can only be updated by its owner. Owner = `HMAC(HMAC_SECRET, 'lb|email|<email>')` for signed-in students, or `HMAC(HMAC_SECRET, 'lb|token|<ownerToken>')` for anonymous ones, where `ownerToken` is a random 32-character token minted on the first anonymous submit and returned in the response; `js/auth.js` keeps it in `localStorage` (`bt.auth.lbToken`) and sends it back with later submits. A signed-in student may pass the token to claim a row they made anonymously. IP addresses are never used, so a whole class behind one school NAT cannot overwrite each other's rows. Owner values are never returned by any route. Mismatch → `409`. Capped at 200 rows per class, top 100 returned.
- **CORS**: only origins in `ALLOWED_ORIGINS` receive CORS headers; a browser request from any other origin is refused with 403. Webhooks and email-link clicks carry no `Origin` and are unaffected.
- **Rate limits**: `rateLimit(env, request, bucket, max, {key, windowSec, failOpen})`. Per-IP by default (magic link 5/min, exchange 20/min, certificates 10/min, verify 60/min, leaderboard write 20/min, leaderboard read 120/min) plus a per-recipient bucket for magic links (3 per 10 min, keyed by `HMAC(secret, email)`; when tripped the response is byte-identical to a success and no email is sent). Write routes **fail closed** (a KV error rejects the request); only GET routes (`/verify/:id`, `GET /leaderboard`) fail open. The KV fallback spreads each counter over 4 shard keys (`rl:<bucket>:<hash>:<window>:<shard>`) so a burst does not hit KV's one-write-per-second-per-key limit; over-limit calls do no write. If a Workers Rate Limiting binding named `RL_<BUCKET>` exists (`RL_MAGIC`, `RL_MAGIC_EMAIL`, `RL_EXCHANGE`, `RL_CERT`, `RL_VERIFY`, `RL_LB`, `RL_LB_READ`; see the commented blocks in `wrangler.toml`) it is used instead and is atomic.

## Routes

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| GET | `/health` | – | – | `{ok:true}` |
| POST | `/auth/magic-link` | – | `{email, redirect?}` | `{ok, sent, expiresInSec}` |
| GET | `/auth/callback` | – | `?token=` | 302 → site `#code=<one-time code>` or `#auth_error=` |
| POST | `/auth/exchange` | – (browser `Origin` required) | `{code}` | `{session, email}`; `400` bad shape, `410` used/expired |
| GET | `/me` | Bearer | – | `{email, pro, plan, proUntil, expires}` |
| POST | `/auth/signout` | Bearer | – | `{ok}` |
| POST | `/checkout` | Bearer | `{plan, successUrl?, cancelUrl?}` | `{url, id}` |
| POST | `/webhook/stripe` | Stripe signature | raw event | `{received}` |
| POST | `/certificates` | Bearer | `{name, modules?, scorePct?, course?}` | `201 {id, url, name, issuedAt, modules, scorePct, verified:true}` |
| GET | `/verify/:id` | – | – | `{found, record}` or `404 {found:false}` |
| GET | `/leaderboard` | – | `?code=` | `{code, entries:[{rank, nickname, stats, updatedAt}]}` |
| POST | `/leaderboard` | optional Bearer | `{classCode, nickname, stats:{returnPct, trades, winRate, maxDrawdownPct}, ownerToken?}` | `{ok, code, entries, ownerToken?}` (`ownerToken` only for anonymous submits; `409` when the nickname belongs to someone else) |
| POST | `/classes` | Bearer (any signed-in member) **or** `X-Instructor-Secret` / `{instructorSecret}` | `{name, section?, term?}` | `201 {code, name, section, term, createdAt, instructorToken, ownerKind}`; `401 {requiresInstructor, canSignIn}`; `503 {notConfigured}` without the `CLASSES` binding |
| GET | `/classes/:code` | – | – | `{found, code, name, section, term, createdAt}` or `404 {found:false}` (a student checks the code before joining) |
| POST | `/classes/:code/snapshots` | – (+ `ownerToken` in the body after the first snapshot) | the `BT.classroom.snapshot()` object (≤ 64 KB) | `{ok, code, className, receivedAt, updatedAt, ownerToken?}` (`ownerToken` only on the first snapshot for this class + id); `404` unknown code; `409 {ownerMismatch:true}` wrong or missing token; `409 {full:true}` class at 500 students; `410 {removed:true}` after the instructor deleted this student; `413` too large; `429 {retryAfterSec}` over the per-student or per-class limit |
| GET | `/classes/:code/roster` | instructor: creator's Bearer, `X-Class-Token`, or `X-Instructor-Secret` | `?view=full\|summary&limit=&cursor=` | `{ok, class, view, students:[…], count, cursor, hasMore, pageMax, via}`; `full` (default) pages 40 snapshots (max 100) per call, `summary` returns up to 500 compact rows from KV metadata in one call; pass `cursor` back while `hasMore` is true; `403` otherwise |
| GET | `/classes/:code/students/:id` | instructor (same three ways) | – | `{ok, code, student}`; `400` malformed id; `404` unknown |
| DELETE | `/classes/:code/students/:id` | instructor (same three ways) | – | `{ok, removed:true}`; the id is remembered for 400 days so the device's next snapshot gets `410` and `js/classroom.js` leaves the class |
| DELETE | `/classes/:code/students` | instructor (same three ways) | `{ids:[≤ 50]}` or `{all:true}` | `{ok, removed, ids, remaining, hasMore}`; `all` removes 50 records per call in key order (call again while `hasMore`); every removed id is locked out like the single delete |
| POST | `/leagues` | – (5/min per IP) | `{name, createdBy?, startDate, endDate, rules:{startingCash, commission, slippageBps, assets, dayTrading, maxPositionPct, shortSelling, teams, teamNames}}` | `201 {ok, code, league}`; `400` bad name/dates (end before start, > 366 days, already over, teams with < 2 names); `503 {notConfigured}` without `LEAGUES` |
| GET | `/leagues/:code` | – | – | `{ok, found, league, phase:'upcoming'\|'active'\|'ended'\|'closed'}` or `404 {found:false}` |
| POST | `/leagues/:code/join` | – (+ `ownerToken` after the first join) | `{studentId, displayName?, team?, ownerToken?}` | `{ok, code, league, team, ownerToken?}` (`ownerToken` only on the first join for this id); `400` missing/unknown team; `409 {ownerMismatch}`; `409 {full}` at 500 members; `409 {ended}` once closed |
| POST | `/leagues/:code/snapshots` | `ownerToken` in the body | `{studentId, ownerToken, league:{equity, returnPct, trades, maxDrawdownPct, equityHistory:[≤ 60]}}` (≤ 16 KB) | `{ok, code, updatedAt, returnPct}` — return and drawdown are recomputed from the equity numbers; `404 {notJoined}`; `409 {ownerMismatch}`; `409 {upcoming}` before the start; `409 {ended}` 24 h after the end; `429 {retryAfterSec}` over 6/min per member |
| GET | `/leagues/:code/standings` | – (120/min, fail open) | – | `{ok, code, league, phase, standings:[{rank, studentId, displayName, team, equity, returnPct, trades, maxDrawdownPct, sharpe, consistencyScore, spark:[≤ 30], updatedAt}], teams:[{rank, team, members, avgReturnPct, avgDrawdownPct}]}` — one `list()` call, rows from KV metadata; sorted by return, ties to the smaller drawdown |
| POST | `/coach` | Bearer, **Pro** | `{trade:{symbol, kind, side, qty, entry, exit, stop, target, pnl, pnlPct, rMultiple, riskPct, positionPct, equity, holdBars, setup, emotion, …}, note?, rules?:[{level, title, message}], lang?:'en'\|'es'}` | `{ok, text, model, truncated, cap, remaining, lang}`; `401`/`403 {requiresPro}`/`503 {notConfigured}`/`429 {capReached}`/`502` — every error carries `fallback:true` so `js/coach.js` shows the rule-based review |
| GET | `/health` | – | – | `{ok, classroom, leagues, coach, rateLimitStore:'TOKENS'\|'CLASSES'\|'LEAGUES'\|null, version}` |

Errors are `{error: "message"}` with 4xx/5xx; `notConfigured:true` marks a missing secret so the client can show a friendly state.

### Classroom (v0.4)

- **KV `CLASSES`**: `class:<CODE>` → `{code, name, section, term, createdAt, ownerKind:'email'|'secret', owner, tokenHash}`; `student:<CODE>:<studentId>` → sanitized snapshot + `receivedAt`/`updatedAt` (server clock), `clientUpdatedAt` (the device's own stamp, `null` when unparseable or more than 5 minutes in the future), `firstSeenAt`, `owner` (never returned) — with a compact roster row (`v:2`: `studentId, displayName, lessonsCount, lessonsTotal, quizAvg, quizCount, drillsPassed, drillsAttempted, paperReturnPct, paperTrades, paperWinRate, journalEntries, streak, certificateId, lastActive, updatedAt, receivedAt`) in the key's **metadata** so `?view=summary` needs no per-student reads (400-day TTL); `removed:<CODE>:<studentId>` → `'1'` (400-day TTL); `rl:*` counters when `TOKENS` is absent. Create it with `npx wrangler kv namespace create CLASSES` and uncomment the `CLASSES` block in `wrangler.toml`. Without the binding every `/classes` route answers `503 {notConfigured:true}` and the instructor page keeps working from pasted share codes. Any write route also needs a counter store: `TOKENS`, else `CLASSES`, else an `RL_<BUCKET>` binding — otherwise it answers `503 {notConfigured:true, error:'Rate limiting needs the TOKENS KV binding …'}`; `/health` reports which store is in use as `rateLimitStore`.
- **Snapshot ownership**: the first `POST /classes/:code/snapshots` for a (class, `studentId`) mints a random `ownerToken`, returns it **once**, and stores only `HMAC(HMAC_SECRET, 'cls|code|id|token')`. Every later POST must carry `ownerToken` in the body; a mismatch or a missing token is `409 {ownerMismatch:true}`, so knowing a classmate's id (it is visible on the roster) is not enough to overwrite their row. `js/classroom.js` keeps the token in `bt.classroom` and, after a 409, offers 'Rejoin with a fresh id' on the Learn page. Records written before ownership existed are claimed by the next POST. Server time is authoritative: `updatedAt === receivedAt`; the device's value is kept as `clientUpdatedAt` only.
- **Roster size**: a class holds at most 500 distinct ids (`MAX_ROSTER`); the 501st new id gets `409 {full:true}` while existing students keep syncing. Bulk `DELETE /classes/:code/students` cleans up flooded or finished classes (the instructor page has a 'Remove all students from the server' button).
- **Class codes** are six characters from the certificate alphabet (no `0/1/O/I`), minted server-side with collision retry. Codes made offline by the instructor page use the same alphabet, so a class can start offline and never needs the server.
- **Who is the instructor**: `POST /classes` needs either a Bearer session (any member who can sign in may create classes; the class owner is `HMAC(secret,'lb|class|<email>')`, never the email) or the optional `INSTRUCTOR_SECRET` (`npx wrangler secret put INSTRUCTOR_SECRET`) for schools that do not run magic-link sign-in. The response carries a per-class `instructorToken` exactly once; only `sha256(token)` is stored. Roster reads and deletes accept the creator's session, the token (`X-Class-Token`), or the secret (`X-Instructor-Secret`), all compared in constant time.
- **Snapshots are whitelisted**, not stored as sent: `sanitizeSnapshot()` keeps `studentId` (`^[A-Za-z0-9_-]{4,40}$`), `displayName` (≤ 40 chars), lesson ids, quiz percentages (clamped 0–100), up to 40 drill rows, paper stats, journal counts, Daily 5 counts and ISO dates. No journal text, trade list, email, IP or user agent is ever written. Body limit 64 KB.
- **Rate limits**: class creation 5/min per IP; snapshots **6/min per (class, student)** (`snap`, keyed by `sha256(code|id)`), **120 new ids per class per minute** (`snap-new`) and a loose **600/min per IP** flood ceiling (`snap-ip`) — a whole class on campus Wi-Fi shares one IP, so the per-IP bucket is deliberately generous; all three fail closed and answer `429 {retryAfterSec:60}`, which `js/classroom.js` honours with a back-off instead of giving up; class lookup 60/min (fail open); roster, student reads and deletes 60/min. Optional atomic bindings: `RL_SNAP`, `RL_SNAP_NEW`, `RL_SNAP_IP`, `RL_ROSTER` (see `wrangler.toml`).
- **CORS** now allows `DELETE` and the `X-Class-Token` / `X-Instructor-Secret` headers for the listed origins.
- Tests: `tests/classroom.test.js` drives `route()` end to end against an in-memory KV (secret and session ownership, token access, delete → 410, rate limit, sanitizer).

### Leagues (v0.5)

- **Who can create**: anyone (5/min per IP). Leagues store no personal data: a pseudonymous `studentId`, an optional display name, a team and paper-account numbers.
- **Membership ownership** mirrors classroom snapshots: the first `join` for (code, `studentId`) returns a random `ownerToken` once; only `HMAC(HMAC_SECRET, 'lg|code|id|token')` is stored (SHA-256 without the secret). `js/leagues.js` keeps the token in `bt.leagues` and sends it with every later join and snapshot.
- **Sanitising**: rules are clamped (`startingCash` 1,000–10,000,000, `commission` 0–100, `slippageBps` 0–500, `maxPositionPct` 1–100, unknown asset classes dropped, ≤ 12 team names); snapshots keep at most 60 equity points and the server recomputes return, drawdown, Sharpe and consistency with the same formulas as `BT.leagues.metrics`, so a client cannot claim a return its equity numbers do not show.
- **Dates**: phases are computed with the widest time-zone margins (start − 14 h, end + 12 h) so no member is locked out early; snapshots close 24 h after that (`phase:'closed'`), freezing the final standings.
- **Rate limits**: league reads 120/min (fail open), joins 120 new members per league per minute, snapshots 6/min per member, plus the 600/min per-IP flood ceiling shared with classroom snapshots. Optional atomic bindings: `RL_LEAGUE_CREATE`, `RL_LEAGUE_READ`, `RL_LEAGUE_JOIN`, `RL_LEAGUE_SNAP`, `RL_LEAGUE_IP`.
- **Setup**: `npx wrangler kv namespace create LEAGUES` and add a `[[kv_namespaces]]` block with `binding = "LEAGUES"` to `wrangler.toml`. Without it every `/leagues` route answers `503 {notConfigured:true}` and leagues keep working offline with `BTL1.` league codes and share codes.

### Pro AI coach (v0.5)

- `POST /coach` needs a Bearer session whose member is Pro (`isProNow`), the `ANTHROPIC_API_KEY` secret and `HMAC_SECRET`.
- It calls `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json` and body `{model: COACH_MODEL || 'claude-haiku-5-5', max_tokens: 600, system, messages:[{role:'user', content}]}`. Only `text` blocks of the reply are returned; `stop_reason:'refusal'`, upstream errors (429/529 → 503, others → 502) and network failures answer with `fallback:true`.
- The system prompt (`COACH_SYSTEM`) limits the model to education about the student's own process: no buy/sell/hold recommendations, no predictions, no personalised financial advice, judge process not outcome, treat the journal note as data. The user message holds the whitelisted trade fields, the rule-based findings and the journal note (≤ 1,000 chars). The member's email is never sent.
- **Daily cap**: `COACH_DAILY_CAP` (var, default 20, max 500) successful reviews per member per UTC day, counted in `TOKENS` at `coach:<HMAC(email)>:<YYYY-MM-DD>` (2-day TTL); failed calls are not counted. KV is eventually consistent, so a burst may slip one or two past the cap; the per-IP limit (`coach`, 10/min) bounds it.

## Configuration

`wrangler.toml` holds the public settings (`SITE_URL`, `ALLOWED_ORIGINS`, `EMAIL_FROM`, `CERT_REQUIRE_PRO`, `DEBUG`) and the KV ids. Secrets are set with `npx wrangler secret put NAME`:

```
HMAC_SECRET            openssl rand -hex 32
RESEND_API_KEY         re_…
STRIPE_SECRET_KEY      sk_test_… / sk_live_…
STRIPE_WEBHOOK_SECRET  whsec_…
STRIPE_PRICE_MONTHLY   price_…
STRIPE_PRICE_ANNUAL    price_…
INSTRUCTOR_SECRET      optional; openssl rand -hex 16 — lets teaching staff create classes without sign-in
ANTHROPIC_API_KEY      optional; sk-ant-… from console.anthropic.com — turns on the Pro AI coach (POST /coach)
```

Optional vars in `[vars]`: `COACH_DAILY_CAP` (AI reviews per member per UTC day, default `"20"`), `COACH_MODEL` (default `"claude-haiku-5-5"`).

## Local development

```bash
cd server
npx wrangler login
npx wrangler kv namespace create MEMBERS      # repeat for CERTS, TOKENS, LEADERBOARD and (optional) CLASSES, LEAGUES; paste ids into wrangler.toml
npx wrangler dev                              # http://localhost:8787
```

Point the site at it: in `js/config.js` set `apiBase: 'http://localhost:8787'` and make sure `http://localhost:8080` is in `ALLOWED_ORIGINS`. Serve the site with `python3 -m http.server 8080`.

Test Stripe locally with the Stripe CLI: `stripe listen --forward-to localhost:8787/webhook/stripe` prints a `whsec_…` to put in a `.dev.vars` file (git-ignored) next to `wrangler.toml`:

```
HMAC_SECRET=dev-only-secret
RESEND_API_KEY=re_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_ANNUAL=price_...
```

Then `stripe trigger checkout.session.completed`.

## Deploy

```bash
cd server && npx wrangler deploy
```

The output prints the Worker URL (`https://broward-trading-api.<account>.workers.dev`). Put it in `js/config.js` → `apiBase`, add the Stripe webhook endpoint `https://…workers.dev/webhook/stripe`, and republish the site.

## Tests

The pure parts (token sign/verify, certificate id derivation, Stripe signature check, CORS allow-list, rate limiter, magic-link claim, login-code exchange, leaderboard ownership) are exercised from `tests/auth.test.js`, which imports `_internal` from this file under Node 22+ (WebCrypto is global there). Run `node tests/auth.test.js` from the project root. `tests/classroom.test.js` and `tests/leagues.test.js` drive the `/classes`, `/leagues` and `/coach` routes end to end against an in-memory KV and a stubbed `fetch` (no network).

## Privacy & data retention

- Stored: email, Pro status, Stripe customer/subscription ids, certificate names and course scores, leaderboard nicknames and stats, classroom snapshots (random student id, optional display name, course statistics; see **Classroom** above). No passwords exist.
- Delete a classroom student: `DELETE /classes/:code/students/:id` from the instructor page, or `npx wrangler kv key delete --binding CLASSES "student:<CODE>:<id>"`. Delete a whole class by removing its `class:<CODE>` key and the `student:<CODE>:*` keys; everything expires on its own after 400 days.
- Delete a league: remove `league:<CODE>` and the `member:<CODE>:*` keys from `LEAGUES` (`npx wrangler kv key delete --binding LEAGUES …`); everything expires on its own.
- AI coach: nothing is stored except a per-day counter keyed by an HMAC of the email. The trade numbers and journal note are sent to Anthropic for that one review.
- Delete a member: `npx wrangler kv key delete --binding MEMBERS "member:<email>"` (and the matching `customer:` key); certificates stay valid unless you delete `cert:<id>` too.
- Sessions, magic tokens, claim markers and login codes expire on their own via KV TTL.
- Leaderboard rows written before v0.3's HMAC owners (plain sha256 / IP hashes) can no longer be updated by their owners (`409`). Fine before launch; otherwise wipe the `class:*` keys in `LEADERBOARD` once.
