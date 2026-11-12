# Broward Trading — membership API (`server/`)

A single Cloudflare Worker (`worker.js`) that gives the static site optional accounts, Pro membership via Stripe, verifiable certificates and an opt-in classroom leaderboard. The site works completely without it; `js/config.js` leaves `apiBase` empty until you deploy this.

Non-developer walkthrough with screenshots-in-words: **[../docs/MEMBERSHIP_SETUP.md](../docs/MEMBERSHIP_SETUP.md)**. This file is the technical reference.

## Design

- **No framework, no npm dependencies.** Plain `fetch` handler, WebCrypto for every signature, Stripe and Resend called over REST with `fetch`. Nothing to build; `wrangler deploy` uploads the one file.
- **Four KV namespaces**

  | Binding | Keys | Value |
  |---|---|---|
  | `MEMBERS` | `member:<email>` · `customer:<stripeCustomerId>` | `{email, pro, plan, proUntil, stripeCustomerId, subscriptionId, …}` · email |
  | `CERTS` | `cert:<id>` · `by:<sha256(email)>` | `{id, name, issuedAt, modules, scorePct, course, pro, emailHash}` · `[ids]` |
  | `TOKENS` | `magic:<jti>` (15 min TTL) · `magic-used:<jti>` (15 min TTL) · `code:<code>` (60 s TTL) · `session:<sha256(id)>` (30 d TTL) · `rl:<bucket>:<hash>:<window>:<shard>` · `stripe:evt:<id>` | one-time magic payload · claim marker `{claim, ipHash, at}` · `{sessionId, email, at}` · `{email, expires}` · sharded counters · dedupe |
  | `LEADERBOARD` | `class:<CODE>` (180 d TTL) | `[{nickname, stats, owner, updatedAt}]` |

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

Errors are `{error: "message"}` with 4xx/5xx; `notConfigured:true` marks a missing secret so the client can show a friendly state.

## Configuration

`wrangler.toml` holds the public settings (`SITE_URL`, `ALLOWED_ORIGINS`, `EMAIL_FROM`, `CERT_REQUIRE_PRO`, `DEBUG`) and the KV ids. Secrets are set with `npx wrangler secret put NAME`:

```
HMAC_SECRET            openssl rand -hex 32
RESEND_API_KEY         re_…
STRIPE_SECRET_KEY      sk_test_… / sk_live_…
STRIPE_WEBHOOK_SECRET  whsec_…
STRIPE_PRICE_MONTHLY   price_…
STRIPE_PRICE_ANNUAL    price_…
```

## Local development

```bash
cd server
npx wrangler login
npx wrangler kv namespace create MEMBERS      # repeat for CERTS, TOKENS, LEADERBOARD; paste ids into wrangler.toml
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

The pure parts (token sign/verify, certificate id derivation, Stripe signature check, CORS allow-list, rate limiter, magic-link claim, login-code exchange, leaderboard ownership) are exercised from `tests/auth.test.js`, which imports `_internal` from this file under Node 22+ (WebCrypto is global there). Run `node tests/auth.test.js` from the project root.

## Privacy & data retention

- Stored: email, Pro status, Stripe customer/subscription ids, certificate names and course scores, leaderboard nicknames and stats. No passwords exist.
- Delete a member: `npx wrangler kv key delete --binding MEMBERS "member:<email>"` (and the matching `customer:` key); certificates stay valid unless you delete `cert:<id>` too.
- Sessions, magic tokens, claim markers and login codes expire on their own via KV TTL.
- Leaderboard rows written before v0.3's HMAC owners (plain sha256 / IP hashes) can no longer be updated by their owners (`409`). Fine before launch; otherwise wipe the `class:*` keys in `LEADERBOARD` once.
