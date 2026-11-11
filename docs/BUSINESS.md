# Broward Trading — business plan

How to turn a free simulator and a free course into something that pays for itself (and for the people who maintain it) through memberships and verified certificates, **without taking anything away from free users**.

This is a working document, not legal or financial advice. Section 7 lists the things to check with a lawyer and an accountant before charging the first dollar.

---

## 1. The promise we are keeping

From `about.html`, which students can already read:

> The simulator and the core course stay free. If a paid tier arrives, it pays for verified credentials, human feedback and hosting, never for access to the tools you can already use today.

Everything below is designed around that sentence. The paid product is **proof and people**: proof that a student learned (a verified certificate with a graded assessment) and people who help them (feedback, cohorts, instructors). The software stays open source under MIT.

Why this works commercially: the free tier is the marketing. Every student who uses the simulator in a class, on a phone, or from a GitHub Pages link is a potential member, and the thing they cannot get for free (a credential someone else can verify) is exactly what employers, scholarship applications and transfer portfolios ask for.

## 2. Content and feature tiers

| | **Free** (forever) | **Pro member** | **Classroom** (instructor licence) |
|---|---|---|---|
| Dashboard, paper account, options lab, backtester | Yes | Yes | Yes |
| All six core modules, quizzes, exercises | Yes | Yes | Yes |
| Progress saved | Browser only | Cloud sync across devices | Cloud, per roster |
| Completion certificate | **Self-issued** (name typed by student, clearly marked "self-issued, not verified") | **Verified**: unique signed ID, public verification page, server-graded final assessment | Verified, bulk issued |
| Graded capstone (trading plan + backtest) with written human feedback | No | Yes (one included; more purchasable) | Instructor grades; rubric provided |
| Extra modules (futures mechanics, crypto market structure, US tax basics, psychology deep-dives, earnings and news) | No | Yes | Yes |
| Trading journal and cloud export | Local journal (v0.3) | Cloud journal, review prompts, monthly review report | Cohort view |
| Cohort sessions / moderated discussion | No | Yes | Private cohort per class |
| Live data | Bring your own free key | Shared delayed consolidated feed via our proxy (see `DATA_SOURCES.md` section 6) | Same |
| Instructor dashboard, assignments, CSV grade export | No | No | Yes |
| Support | Community issues | Email, 2 business days | Priority, onboarding call |

Rules for deciding what goes where:

- If it is a **tool** or **core knowledge**, it is free.
- If it costs us **marginal money per user** (data licence, storage, human time), it is paid.
- If it is **proof** (verification, grading), it is paid, because proof is only worth something when someone is accountable for it.

## 3. Pricing ideas

Student-affordable is a hard constraint; the audience is community-college students. Numbers are starting points for testing, not decisions.

| Offer | Price idea | Notes |
|---|---|---|
| Pro monthly | **$9/mo** | Cancel any time. Comparable to one streaming service. |
| Pro annual | **$59/yr** | About 45 % off monthly; the plan most learning sites actually sell. |
| Certificate only (one-time) | **$39** | Verified certificate with the server-graded assessment, no ongoing membership. Likely the most popular SKU for students who finished the free course. |
| Capstone review add-on | **$29** | One human-reviewed trading plan and backtest. Cost is instructor time (about 30 to 45 minutes), so price it to pay that fairly. |
| Classroom licence | **$149/semester per section** (up to 35 students) or **$5/seat** | Includes verified certificates for every student who qualifies. Sell to instructors and departments, not students. |
| Scholarship / hardship | **Free on request** | A simple form. Say yes by default. Budget 10 to 20 % of certificates as sponsored. |

Launch sequence that limits risk:

1. Start with **certificate-only** and the **capstone add-on** (one-time purchases, no recurring billing, no cancellation flows, simplest tax and refund story).
2. Add **Pro annual** when there are at least two extra modules and cloud sync.
3. Add **Pro monthly** last; monthly plans have the most churn and support load.
4. Pursue **classroom licences** in parallel through instructors who already use the free site.

Payment processing options, with trade-offs:

| Option | Fees (about) | Pros | Cons |
|---|---|---|---|
| **Stripe Checkout + Customer Portal** | 2.9 % + 30¢; Stripe Tax extra | Full control, subscriptions, webhooks, lowest fees at scale | You are the merchant: sales tax, VAT, refunds, chargebacks are yours. Needs a small backend for webhooks. |
| **Gumroad** | 10 % + processing | Zero backend needed; licence keys; handles global tax as merchant of record | Fee is high; branding less polished; subscriptions supported but basic. |
| **Lemon Squeezy / Paddle** | about 5 % + 50¢ | Merchant of record (they handle tax), licence keys, subscriptions, webhooks | Fees above Stripe; account approval takes time. |
| **Teachable / Thinkific / Podia** | $39 to $119/mo plus fees on low tiers | Hosted course player, drip, quizzes, built-in certificates and checkout | Duplicates our own course player; certificates are not cryptographically verifiable; monthly platform fee before the first sale. |

Recommendation: **Stripe Checkout** if we are comfortable running a tiny backend anyway (we need one for verification), otherwise **Lemon Squeezy** as merchant of record to avoid sales-tax administration. Gumroad is the fastest way to sell a one-off certificate while testing demand.

## 4. Certificate verification design

### 4.1 The problem with the free certificate

The free certificate is drawn in the browser from `localStorage` progress. Anyone can mark every lesson done in DevTools and type any name. That is fine for a self-issued "I finished" memento, and the certificate must say so on its face ("Self-issued. Not verified. Verify a Pro certificate at <domain>/verify").

A **verified** certificate must rest on something the student cannot forge:

1. **Identity**: an account (email magic link, optionally student ID or photo ID check for classroom licences).
2. **Assessment**: a **server-graded** final assessment (question bank drawn randomly, answers submitted to the server, time-limited, scored server-side). Browser quiz scores are evidence, not proof.
3. **Issuance**: a certificate record created only by the server after payment and passing score, with a **signed ID** that a verification page can check.

### 4.2 Certificate ID and signature

Format: `BT-<year>-<6 base32 chars>-<4 check chars>`, for example `BT-2027-K7Q2MX-4H9A`. Short enough to type from a printed page, no ambiguous characters (Crockford base32).

Record stored server-side:

```json
{
  "id": "BT-2027-K7Q2MX-4H9A",
  "holder_name": "Ana Pérez",
  "holder_display": "full",            // "full" | "initials" | "hidden" (student's privacy choice)
  "course": "Broward Trading Core",
  "course_version": "1.0.0",
  "modules": ["m1-foundations", "...", "m6-strategy"],
  "assessment_score": 91,
  "capstone": "passed",                 // or "not_taken"
  "issued_at": "2027-03-14T18:22:05Z",
  "expires_at": null,
  "status": "valid",                    // "valid" | "revoked"
  "signature": "ed25519:base64..."
}
```

Signature: Ed25519 over the canonical JSON of the fields above excluding `signature`, with a private key kept only in the backend's secrets. The **public key** is published at `/.well-known/bt-cert-pubkey.txt` and in the repo, so anyone, including people who do not trust our server, can verify an exported certificate JSON offline. Rotate keys yearly; keep old public keys published with their validity window.

What is printed on the certificate (PDF and PNG):

- Name, course, date, score band (e.g. "Passed with distinction, 90 % +"), certificate ID.
- A QR code pointing to `https://<domain>/verify?id=BT-2027-K7Q2MX-4H9A`.
- The sentence: "Verify this certificate at <domain>/verify. Broward Trading is an independent educational project and not a licensed financial adviser, broker-dealer or accredited institution."

### 4.3 Verification page

`verify.html?id=...` (a static page in this repo) calls `GET /api/verify/:id` and shows:

- Valid / revoked / not found.
- Holder name as the holder chose to display it, course, version, date, score band.
- "Signature verified in your browser" using the published public key (WebCrypto supports Ed25519 in current browsers; fall back to server verification).

No login needed to verify. Rate-limit the endpoint to stop enumeration (IDs are random, but still).

### 4.4 Backend options

We need: auth, a database, a place to run grading and signing, webhooks from the payment provider, and file storage for certificate PDFs. Two good small-team options:

**Supabase** (recommended): Postgres, auth with magic links, Row Level Security, Edge Functions (Deno) for grading and signing, Storage for PDFs. Free tier is enough to launch; Pro is $25/mo.

```sql
create table profiles (
  id uuid primary key references auth.users,
  full_name text,
  display_pref text default 'full',
  created_at timestamptz default now()
);

create table memberships (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),
  plan text,                      -- 'cert_once' | 'pro_month' | 'pro_year' | 'classroom'
  provider text,                  -- 'stripe' | 'lemonsqueezy' | 'gumroad'
  provider_ref text,              -- subscription / order id
  status text,                    -- 'active' | 'canceled' | 'past_due'
  started_at timestamptz, ends_at timestamptz
);

create table assessments (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),
  question_ids int[],             -- which items were served (random draw)
  answers jsonb,                  -- submitted answers
  score numeric,                  -- graded server-side
  started_at timestamptz, submitted_at timestamptz
);

create table certificates (
  id text primary key,            -- BT-2027-XXXXXX-XXXX
  user_id uuid references profiles(id),
  course text, course_version text,
  assessment_id bigint references assessments(id),
  capstone text default 'not_taken',
  payload jsonb,                  -- canonical signed fields
  signature text,
  status text default 'valid',
  issued_at timestamptz default now(),
  revoked_at timestamptz, revoke_reason text
);
```

Flow:

1. Student finishes the free course (browser progress) and clicks **Get verified**.
2. Signs in (magic link). Profile row created.
3. Stripe Checkout session (or Lemon Squeezy / Gumroad link) → payment → **webhook** to an Edge Function → `memberships` row with `status='active'`.
4. Edge Function `start_assessment` serves 40 random questions from a 200+ item bank (reuse and expand the lesson quizzes; keep the bank private, never in the repo). 60-minute window.
5. Edge Function `submit_assessment` grades server-side. Pass mark 80 %. One retake included after 24 hours.
6. Edge Function `issue_certificate` checks membership + pass, generates ID, signs payload, renders PDF/PNG (reuse the `BT.course.certificate` canvas design on the server with a headless renderer, or draw with a PDF library), stores it, emails the link.
7. `GET /api/verify/:id` is a read-only function with caching.

**Firebase** works equally well (Auth, Firestore, Cloud Functions, Storage) if the team already knows it; Firestore is less convenient for the reporting queries an instructor dashboard needs.

**Cloudflare Workers + D1 + KV** is the cheapest at scale and pairs naturally with the data proxy in `DATA_SOURCES.md`, but you assemble auth yourself.

### 4.5 Keeping the honest story straight

- The free certificate stays available and stays labelled self-issued. Never degrade it to push upgrades.
- Verification pages must say what was verified: an online assessment and, if taken, a reviewed capstone. Nothing about real trading skill or results.
- Revocation exists (fraud, chargeback, impersonation). Revoked certificates verify as "revoked" with a date, not as "not found".
- Students can request deletion; the certificate record then shows "withdrawn by holder" rather than leaking the name.

## 5. Content production for paid modules

Each extra module follows the same JSON format as the free ones so the same player renders it; the only change is that paid lesson files are served from the backend to authenticated members instead of from `course/` in the repo.

Suggested order, by demand from students and by how much they reuse the existing simulator:

1. **Trading psychology deep-dives** (journal-driven; uses the paper account).
2. **Reading earnings, news and the calendar** (uses Finnhub news on the free tier).
3. **US tax basics for traders** (wash sales, short-term vs long-term, 1099-B; review by a CPA before publishing).
4. **Futures mechanics** (contract specs, margin, rollover; simulated only).
5. **Crypto market structure** (24/7 markets, exchanges vs on-chain, why leverage is dangerous; no trading simulation).

Production cost per module: about 40 to 60 hours of writing, chart building and quiz authoring, plus review. Record a 5 to 10-minute video per lesson later if members ask; text-first keeps the open-source player simple and accessible.

## 6. Phased plan

| Phase | When | What ships | Revenue | Decision gate to move on |
|---|---|---|---|---|
| **0. Free and public** | Now (v0.2) | GitHub Pages site, course, self-issued certificate, README and docs | $0 | 200 students have finished Module 1; 20 have the self-issued certificate; at least two instructors using it. |
| **1. Validate** | v0.3 | "Get verified" waitlist form; Gumroad pre-order for the certificate at $39 with refund promise; interviews with 10 students and 3 instructors | Pre-orders | 50 pre-orders or 3 classroom letters of intent. If not, keep improving the free product and do not build a backend yet. |
| **2. Certificate MVP** | v0.4 to v1.0 | Supabase auth, server-graded assessment, signed certificates, verification page, Stripe or Lemon Squeezy one-time checkout, terms and privacy policy | Certificate-only sales | 100 certificates issued; refund rate under 5 %; verification page used by third parties. |
| **3. Membership** | v1.0 | Cloud sync, two extra modules, journal, shared delayed data feed, Pro annual then monthly | Subscriptions | 12-month retention above 40 % on annual; support load under 2 hours/week per 100 members. |
| **4. Classroom** | v1.x | Instructor dashboard, roster, grade export, bulk certificates, invoicing, accessibility conformance report (VPAT) for college procurement | Licences | Two paying institutions. |
| **5. Scale** | later | Spanish and Haitian Creole certificates, partnerships with workforce programmes, affiliate for brokers only if strictly educational and disclosed | | |

Costs to launch Phase 2 are small: Supabase free or $25/mo, domain about $15/yr, email (Resend or Postmark) free tier, data proxy $30/mo when members exist, payment fees per sale, plus the real cost: someone's time to grade capstones and answer support.

Simple unit economics for the certificate SKU at $39: fee about $1.45 (Stripe) to $4.40 (Gumroad), hosting share under $0.50, so gross margin above $33. The capstone add-on at $29 should pay a reviewer at least $20 for 30 to 45 minutes; price it up before paying reviewers down.

## 7. Legal and compliance notes

**Not legal advice.** Confirm with a Florida-licensed attorney and a CPA before launch. The list is what to ask about.

### 7.1 Not financial advice; adviser and broker-dealer status

- Keep every page labelled as **education**. No personalised recommendations, no "buy this now", no managed accounts, no signals service. General educational content of regular and general circulation falls under the publisher's exclusion in the Investment Advisers Act of 1940; personalised advice for compensation does not. The membership must stay on the education side of that line, which also means capstone feedback is about the *process* (plan quality, risk rules, backtest honesty), never about whether to trade a specific security.
- We are not a broker-dealer and do not execute, route or introduce orders. Keep it that way: no brokerage affiliate links that pay per funded account unless counsel reviews them, because referral compensation can create registration questions.
- Florida has its own securities regulator (Office of Financial Regulation) under Chapter 517; ask counsel to confirm that an educational subscription does not require state registration.

### 7.2 Marketing claims (SEC / FINRA / FTC)

- FINRA Rule 2210 binds member firms, which we are not, but its standards are the right benchmark: fair and balanced, no exaggerated or promissory claims, no implying that technical analysis predicts results. SEC's Marketing Rule logic (hypothetical performance needs context and risks) applies by analogy to every backtest screenshot we publish.
- Never advertise returns, win rates or "students made X %". Simulated results are not results. If we show a backtest, show drawdown, the period, and the buy-and-hold comparison next to it.
- FTC Endorsement Guides (updated 2023): testimonials must be typical or say they are not; disclose any compensation to reviewers; no fake reviews. The 2024 FTC rule on fake reviews carries civil penalties.
- Subscriptions: comply with state auto-renewal laws (California's ARL, Florida's Automatic Renewal Law, New York, others): clear terms before purchase, consent to recurring charges, easy online cancellation, renewal reminders. Federal "click-to-cancel" rulemaking has been contested in court; follow the strictest state rule and you are covered either way.
- Refund policy in writing. For digital content, a 14-day no-questions refund on memberships and a refund on certificates if the assessment is not attempted is simple and defensible.

### 7.3 Broward College and the name

- "Broward" is a county name and cannot be owned, but **"Broward College"** and its seal, logos and colours are the college's marks. Do not use them, do not say "Broward College course", and do not imply endorsement. The site already says it is independent; keep that sentence on the certificate and the About page.
- If an instructor at the college adopts the course, that is their classroom decision, not an endorsement; ask them not to use college branding in our materials and get **written permission** from the college's marketing or legal office before any co-branding, campus posters or ".edu" links.
- Consider registering our own trademark for "Broward Trading" (or choosing a more distinctive name before Phase 3) so the brand is defensible and clearly not the college's.

### 7.4 Students and data

- Terms of service and privacy policy before accounts exist. Collect the minimum: email, name as it should appear on the certificate, progress and assessment data. No tracking ads.
- If an institution buys a classroom licence, student records may fall under **FERPA** as the institution's education records; be ready to sign a data-processing agreement and delete on request. **COPPA** is unlikely (college audience) but gate accounts at 16+ to be safe; under 18 needs guardian consent for payment anyway.
- Accessibility: public colleges purchase against WCAG 2.1/2.2 AA. The free site already aims for AA; produce a VPAT before Phase 4.
- Sales tax: digital goods and online courses are taxable in many states and in the EU/UK. Use a merchant of record (Lemon Squeezy, Paddle, Gumroad) or Stripe Tax so we do not hand-file.
- Market data terms: never redistribute provider data to non-members or in bulk; the student's own free key is under the student's own agreement with the provider; a shared paid key must be on a plan that allows display to end users.

### 7.5 Open source and paid content

- Software stays MIT. Free course JSON stays MIT so teachers can adapt it.
- Paid modules, the assessment question bank and the signing key are **not** in the public repo. Keep them in a private repo or the backend. The code that serves them can be public.
- Contributor licence: contributions to the public repo are MIT by the repo's licence; say so in CONTRIBUTING to avoid later disputes.

## 8. Metrics to watch

- Free: weekly active learners, lessons completed per learner, Module 1 → Module 6 completion rate, self-issued certificates per month, GitHub stars and forks (a proxy for instructor adoption).
- Paid: visits to "Get verified" → purchases, assessment pass rate (target 70 to 85 %; too high means it is too easy, too low means the course is not teaching what it tests), refund rate, verification-page lookups by third parties (the real signal that the credential has value), annual retention.
- Support: minutes of human time per certificate and per capstone.

## 9. What we will not do, even for money

- Sell signals, alerts or anything presented as advice.
- Promise or imply profits.
- Hide the free simulator or degrade it to push upgrades.
- Put ads on lesson pages or sell student data.
- Use the college's name or marks without written permission.
