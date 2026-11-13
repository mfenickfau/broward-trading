# Setting up Broward Trading Pro (membership backend)

A step-by-step guide for someone who has never deployed a server. Budget about 90 minutes the first time. Everything in this guide can be done from a laptop; a phone works for the account sign-ups but the terminal steps need a computer.

**You do not have to do any of this.** The site is complete and free without it. This guide only matters when you want:

- email sign-in (no passwords),
- a paid Pro tier through Stripe,
- certificates that anyone can check on `verify.html`,
- a classroom leaderboard by class code.

What you will create: one **Cloudflare Worker** (a tiny program that runs on Cloudflare's servers), four **KV namespaces** (small key-value databases), a **Stripe** product with two prices and a webhook, and a **Resend** account to send sign-in emails. The code is already written in `server/worker.js`; you only configure and upload it.

---

## 0. Before you start — what you need

| Item | Why | Cost |
|---|---|---|
| A computer with a terminal (macOS Terminal, Windows PowerShell, or Linux) | runs the upload commands | – |
| [Node.js](https://nodejs.org) 20 or newer | the `npx wrangler` command needs it | free |
| A Cloudflare account | hosts the Worker and databases | free |
| A Stripe account | takes payments | free; Stripe keeps 2.9 % + 30 ¢ per card payment in the US |
| A Resend account | sends the sign-in emails | free up to 3,000 emails / month |
| A domain you control (recommended, not required) | lets emails come from `sign-in@yourdomain.com` instead of Resend's test sender | ~$10–15 / year |
| The site already published (GitHub Pages, see `docs/DEPLOY.md`) | the API needs to know the site's address | free |

Write down your site address now, for example `https://YOUR-USER.github.io/broward-trading`. You will type it several times.

> **Keep secrets secret.** Several steps produce long random strings called keys or secrets (`sk_live_…`, `whsec_…`, `re_…`). Never paste them into a file inside the project folder, never commit them to GitHub, never put them in a chat. They go only into `wrangler secret put`, which stores them encrypted at Cloudflare.

---

## 1. Create the Cloudflare account and log in from the terminal

1. Go to <https://dash.cloudflare.com/sign-up> and create a free account. Verify your email.
2. Open a terminal and move into the project folder, then into `server`:

   ```bash
   cd /path/to/broward-trading/server
   ```

3. Log in. A browser window opens asking you to allow "Wrangler" — click **Allow**.

   ```bash
   npx wrangler login
   ```

   The first run downloads Wrangler (Cloudflare's command-line tool) — that is normal. If you see `command not found: npx`, install Node.js from the link above and open a new terminal.

4. Check it worked:

   ```bash
   npx wrangler whoami
   ```

   You should see your account name and an **Account ID**.

## 2. Create the four databases (KV namespaces)

Run these four commands one at a time. Each prints a block containing `id = "…"`.

```bash
npx wrangler kv namespace create MEMBERS
npx wrangler kv namespace create CERTS
npx wrangler kv namespace create TOKENS
npx wrangler kv namespace create LEADERBOARD
```

Open `server/wrangler.toml` in any text editor. Find the four `[[kv_namespaces]]` blocks and replace `PASTE_MEMBERS_ID`, `PASTE_CERTS_ID`, `PASTE_TOKENS_ID`, `PASTE_LEADERBOARD_ID` with the ids you were given (keep the quotes). Make sure the id you paste under `binding = "MEMBERS"` is the one printed for MEMBERS, and so on.

## 3. Fill in the public settings

Still in `server/wrangler.toml`, under `[vars]`:

| Setting | Put |
|---|---|
| `SITE_URL` | your site address, no trailing slash, e.g. `https://YOUR-USER.github.io/broward-trading` |
| `ALLOWED_ORIGINS` | the *origin* of your site (scheme + host only, no path): `https://YOUR-USER.github.io`. While testing locally you may add `,http://localhost:8080`. Remove it later. |
| `EMAIL_FROM` | leave as is for now; you will change it in step 6 |
| `CERT_REQUIRE_PRO` | `"false"` to let every signed-in student get a verified certificate, `"true"` to make it Pro-only |
| `DEBUG` | `"false"` |

Save the file.

## 4. Create the signing secret

This random string signs sign-in links and certificate ids. Generate one:

- macOS / Linux: `openssl rand -hex 32`
- Windows PowerShell: `-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`

Then store it:

```bash
npx wrangler secret put HMAC_SECRET
```

Paste the string when prompted and press Enter. (Nothing shows while you paste; that is normal.) If you ever change this secret, old sign-in links stop working — existing certificates remain valid because they are stored by id.

## 5. Deploy the Worker (first time)

```bash
npx wrangler deploy
```

The last lines show an address like `https://broward-trading-api.YOUR-ACCOUNT.workers.dev`. **Copy it.** Open `https://…workers.dev/health` in a browser: you should see `{"ok":true,…}`.

Connect the site to it: open `js/config.js` in the project and set

```js
apiBase: 'https://broward-trading-api.YOUR-ACCOUNT.workers.dev',
```

(no trailing slash). Publish the site again (commit + push, see `docs/DEPLOY.md`). From now on `pricing.html` shows a real sign-in form instead of the "backend not configured" notice.

## 6. Resend — sending the sign-in emails

1. Create a free account at <https://resend.com>.
2. **API Keys → Create API Key.** Name it "broward-trading", permission "Sending access". Copy the key (`re_…`); it is shown only once.
3. Store it:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

4. **Without a domain** you can only send to the email you signed up with, from `onboarding@resend.dev`. Good enough to test with yourself: leave `EMAIL_FROM` as `Broward Trading <onboarding@resend.dev>`.
5. **With a domain** (needed for real students): Resend → **Domains → Add Domain**, enter your domain, then add the DNS records Resend shows (two or three TXT/MX records) at the place you bought the domain. Click **Verify**; it can take up to an hour. Then set in `wrangler.toml`:

   ```toml
   EMAIL_FROM = "Broward Trading <sign-in@yourdomain.com>"
   ```

6. Redeploy (`npx wrangler deploy`), open your pricing page, enter your email, and check that the link arrives and signs you in. Check your spam folder the first time.

## 7. Stripe — the Pro product

Stripe has a **test mode** (fake cards, no money) and **live mode**. Do everything below in **test mode first** (toggle at the top of the Stripe dashboard), then repeat in live mode when you are ready to charge.

### 7a. Product and prices

1. Create an account at <https://stripe.com>. Activating payouts (business details, bank account) is required for live mode only.
2. **Product catalog → Add product.** Name: `Broward Trading Pro`. Description: `Verified certificate, instructor tools and member features for the Broward Trading course.`
3. Under Pricing add **two recurring prices**:
   - `$9.00` billed **Monthly**
   - `$79.00` billed **Yearly**

   (Change the amounts if you like; the website shows these two numbers as "planned" until you update `js/config.js` → `prices`.)
4. Save. Click each price and copy its **Price ID** (`price_…`). Store them:

   ```bash
   npx wrangler secret put STRIPE_PRICE_MONTHLY
   npx wrangler secret put STRIPE_PRICE_ANNUAL
   ```

### 7b. Secret key

**Developers → API keys → Secret key** (click *Reveal*). In test mode it starts with `sk_test_`. Store it:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

### 7c. Webhook (how Stripe tells the Worker someone paid)

1. **Developers → Webhooks → Add endpoint.**
2. Endpoint URL: your Worker address plus `/webhook/stripe`, e.g. `https://broward-trading-api.YOUR-ACCOUNT.workers.dev/webhook/stripe`.
3. **Select events** and tick:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Add endpoint. On the endpoint page click **Reveal** under *Signing secret* (`whsec_…`) and store it:

   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

### 7d. Customer portal (optional but recommended)

**Settings → Billing → Customer portal**: turn on "Cancel subscriptions" and "Update payment method" and save. Add the portal link Stripe gives you to your FAQ so members can cancel themselves.

### 7e. Test a purchase

Redeploy (`npx wrangler deploy`). On your pricing page: sign in with your email, click **Upgrade**. On the Stripe page use the test card `4242 4242 4242 4242`, any future expiry, any CVC and ZIP. You should land back on the pricing page with a "Pro" badge. In Stripe → Webhooks → your endpoint, the events should show `200`.

### 7f. Going live

Switch the Stripe dashboard to **live mode** and repeat 7a–7c: a new product with two live prices, the `sk_live_` key, and a new webhook endpoint with its own `whsec_`. Run the four `secret put` commands again with the live values. Test-mode payments never become real money.

## 7g. AI coach for Pro members (optional)

The free coach in the app reviews every trade with fixed rules and needs no server. Pro members can also get a short written review from Anthropic's Claude (model `claude-haiku-5-5`): it explains the student's own process (risk, stop, reward-to-risk, sticking to the plan) and is instructed never to recommend trades or predict prices. Each review costs a fraction of a cent.

1. Go to **console.anthropic.com**, create an account (or sign in), add a payment method under **Billing**, and set a monthly **spend limit** you are comfortable with (for example $10).
2. **API keys → Create key**, name it `broward-trading-coach`, and copy it (it starts with `sk-ant-`). You only see it once.
3. In the `server` folder run:

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

   and paste the key when asked.
4. Optional: limit how many AI reviews each member gets per day (default 20) by adding `COACH_DAILY_CAP = "10"` under `[vars]` in `server/wrangler.toml`.
5. Redeploy (`npx wrangler deploy`). `https://…workers.dev/health` now shows `"coach": true`.

Without the key everything keeps working: the app shows the rule-based review and the Worker answers `/coach` with "not configured". To turn the AI coach off again, run `npx wrangler secret delete ANTHROPIC_API_KEY`. What is sent: the trade's numbers, the rule-based findings and the student's journal note for that trade. The member's email is never sent. Mention Anthropic in your privacy notice (section 10) if you enable it.

## 7h. Leagues on the server (optional)

Leagues work offline with league codes and share codes. To let members join with a short 6-character code and see live standings, create one more database and redeploy:

```bash
npx wrangler kv namespace create LEAGUES
```

Add a `[[kv_namespaces]]` block with `binding = "LEAGUES"` and the printed id to `server/wrangler.toml`, then `npx wrangler deploy`. `/health` shows `"leagues": true`.

## 8. Lock it down

- Remove `http://localhost:8080` from `ALLOWED_ORIGINS` and redeploy.
- Confirm `DEBUG = "false"`.
- In Cloudflare dashboard → Workers & Pages → your worker → **Settings → Variables**, check that all six secrets are listed (values are hidden), plus `ANTHROPIC_API_KEY` if you turned on the AI coach.
- Optional: in the same place add a custom domain such as `api.yourdomain.com`, then update `apiBase` in `js/config.js` and the Stripe webhook URL.

## 9. What it costs

| Service | Free tier | When you would pay |
|---|---|---|
| Cloudflare Workers | 100,000 requests / day | Paid plan is $5 / month for 10 M requests; a class of 500 students will not come close |
| Cloudflare KV | 100,000 reads, 1,000 writes / day, 1 GB | each sign-in is ~3 writes, each certificate 2, each leaderboard post 1. 1,000 writes/day is the first limit you might touch on a busy launch day; the $5 plan raises it to 1 M |
| Anthropic API (only if 7g is on) | – | Claude Haiku 5.5 is about $0.10 per million input tokens and $0.50 per million output tokens; one review is roughly 1,000 tokens in and 300 out, so 1,000 reviews cost well under $1. The daily cap and the console spend limit keep it bounded |
| Resend | 3,000 emails / month, 100 / day | one email per sign-in; the $20 plan is 50,000 / month |
| Stripe | no monthly fee | 2.9 % + 30 ¢ per successful card charge in the US (so $8.44 of a $9 payment reaches you) |
| GitHub Pages | free | – |
| Domain (optional) | – | $10–15 / year |

**Realistic estimate:** $0 / month until you have hundreds of paying members, then $5–25 / month plus Stripe's percentage.

## 10. Legal and policy notes (not legal advice — check with a professional)

- **Terms and refunds.** Publish a refund policy before the first live charge. The pricing page states "cancel any time, full refund within 14 days of first payment if you have not downloaded a verified certificate" — edit it to match what you will actually honour. Stripe's dashboard lets you refund with one click.
- **Sales tax / VAT.** Digital subscriptions are taxable in many US states and in the EU/UK. Stripe Tax (an add-on, 0.5 % per transaction) can calculate and collect it. Register where your accountant says you must.
- **Privacy.** You now store emails, payment status and names on certificates. Add a privacy notice to `about.html` saying what is stored, where (Cloudflare, Stripe, Resend), and how to request deletion (`server/README.md` → *Privacy & data retention* has the commands). If any student may be in the EU, GDPR applies: a deletion process and a lawful basis (contract) are the minimum.
- **Students under 18.** Stripe requires the cardholder to be an adult. If classes include minors, bill the school or parent, not the student, and do not collect more than an email.
- **Not financial advice.** Keep the disclaimer on every page. Paying for Pro changes nothing about that: the certificate recognises course completion, it is not a licence or qualification, and the site never places real trades. Say so on the certificate and the verify page (both already do).
- **Trademarks and school names.** "Broward" is a place name; do not imply affiliation with Broward College or any institution unless you have written permission. Instructor leaderboards are opt-in with nicknames for this reason.
- **Accessibility.** Paid features must meet the same standard as free ones (the site targets WCAG AA contrast and 44 px tap targets); public colleges in the US are bound by Section 508 / ADA when they adopt tools.
- **Business registration.** Charging money usually means registering a sole proprietorship or LLC and reporting the income. Stripe will ask for a tax ID (SSN or EIN) to activate live payments.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Pricing page still says "backend not configured" | `apiBase` in `js/config.js` is empty or has a typo, or the site was not republished. Hard-refresh the page (the service worker caches `js/`). |
| "Origin not allowed" / request blocked in the browser console | add the site's origin (scheme + host, no path) to `ALLOWED_ORIGINS` and redeploy |
| Sign-in email never arrives | Resend → Emails shows the attempt. "Domain not verified" → finish step 6.5; using `onboarding@resend.dev` only delivers to your own address |
| Link says "invalid or expired" | links expire after 15 minutes and work once; the email app may have pre-opened it — request a new link and open it directly |
| Paid but no Pro badge | Stripe → Webhooks → endpoint → *Events*: a red status means the webhook secret is wrong or the URL is off. Fix and click *Resend* on the event |
| `wrangler deploy` says a KV id is invalid | the id in `wrangler.toml` must match exactly what `kv namespace create` printed, in quotes |
| Want to see errors in responses while debugging | set `DEBUG = "true"`, redeploy, then set it back |
| Logs | `npx wrangler tail` streams live requests and errors |

## 12. Turning on Pro-only lessons later

Nothing is gated today. When there is Pro-only content: mark lessons in `course/*.json` with `"pro": true` and set `proGating: true` in `js/config.js`. The core course must stay free (`docs/BUSINESS.md`, section 1).
