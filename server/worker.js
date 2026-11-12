/* Broward Trading — server/worker.js (Cloudflare Worker, membership API v0.3)
 *
 * Plain `fetch` handler, no framework, no npm dependencies. Runs on the
 * Workers free tier with four KV namespaces. The static site (GitHub Pages)
 * talks to it from js/auth.js when js/config.js sets `apiBase`.
 *
 * Routes
 *   POST /auth/magic-link        {email, redirect?}   → emails a 15-minute sign-in link (Resend)
 *   GET  /auth/callback?token=   verifies the link, creates a 30-day session, redirects to the site with #code=<one-time code>
 *   POST /auth/exchange          {code} (browser only: Origin required) → {session, email}; the code works once, 60 s
 *   GET  /me                     Bearer session → {email, pro, plan, proUntil, expires}
 *   POST /auth/signout           Bearer session → deletes the session
 *   POST /checkout               Bearer session, {plan:'monthly'|'annual', successUrl, cancelUrl} → {url} (Stripe Checkout)
 *   POST /webhook/stripe         Stripe-Signature verified with WebCrypto; sets/clears pro
 *   POST /certificates           Bearer session, {name, modules, scorePct} → {id:'BT-YYYY-XXXXXX', url, ...}
 *   GET  /verify/:id             → {found, record:{id,name,issuedAt,modules,scorePct}} (name only, no email)
 *   GET  /leaderboard?code=      → {entries:[...]}   opt-in classroom leaderboard keyed by class code
 *   POST /leaderboard            {classCode, nickname, stats, ownerToken?} → {entries, ownerToken?}
 *   POST /classes                instructor (Bearer session, or INSTRUCTOR_SECRET) {name, section, term} → {code, instructorToken, ...}
 *   GET  /classes/:code          → {code, name, section, term}   lets a student confirm a code before joining
 *   POST /classes/:code/snapshots  student snapshot from js/classroom.js → {ok, className}; 410 {removed:true} after a DELETE
 *   GET  /classes/:code/roster   instructor (creator's session, X-Class-Token, or INSTRUCTOR_SECRET) → {class, students:[snapshots]}
 *   DELETE /classes/:code/students/:id  instructor → {ok}; the student's device stops re-adding itself
 *   GET  /health                 → {ok:true}
 *
 * Bindings (server/wrangler.toml)
 *   KV: MEMBERS (email → member), CERTS (id → certificate), TOKENS (magic + session tokens, TTL),
 *       LEADERBOARD (class code → entries), CLASSES (class:<CODE>, student:<CODE>:<id>, removed:<CODE>:<id>)
 *   optional: MAGIC_LOCK (Durable Object, class MagicLock) for atomic one-time magic links;
 *             RL_MAGIC, RL_MAGIC_EMAIL, RL_EXCHANGE, RL_CERT, RL_VERIFY, RL_LB, RL_LB_READ (Rate Limiting bindings)
 *   vars:    ALLOWED_ORIGINS (comma list), SITE_URL, EMAIL_FROM, CERT_REQUIRE_PRO ('true'|'false')
 *   secrets: HMAC_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY,
 *            STRIPE_PRICE_ANNUAL, RESEND_API_KEY, INSTRUCTOR_SECRET (optional: lets instructors
 *            create classes without magic-link accounts; share it only with teaching staff)
 *
 * Security notes
 *   - Magic-link tokens are JWT-like (header.payload.signature, HMAC-SHA256) AND
 *     one-time: the jti is stored in TOKENS for 15 minutes; the callback claims it
 *     with a "magic-used:<jti>" marker that is re-read after writing so two
 *     callbacks racing for the same link cannot both win (see claimMagicToken).
 *   - Session ids are 32 random bytes; only a SHA-256 hash of the id is stored.
 *   - Certificate ids come from an HMAC so they cannot be guessed or forged;
 *     verification exposes the student's name and course data, never the email.
 *   - Stripe signatures are checked with a constant-time compare and a 5-minute
 *     timestamp tolerance; the pro flag is only ever changed by verified events.
 *   - Rate limits on the public routes: Workers Rate Limiting bindings when they
 *     exist (RL_MAGIC, RL_MAGIC_EMAIL, RL_CERT, RL_VERIFY, RL_LB — see wrangler.toml),
 *     otherwise sharded KV counters. Write-side limits FAIL CLOSED (a KV error
 *     counts as "over the limit"); the magic-link route also has a per-recipient
 *     limit so no inbox can be flooded, answered with the same {ok:true,sent:true}
 *     body so addresses cannot be enumerated.
 *   - Leaderboard ownership is an HMAC (never a plain hash of email or IP) and is
 *     never returned to clients. Anonymous students get a random ownerToken on
 *     their first submit (stored by js/auth.js) instead of an IP-derived owner, so
 *     classmates behind one school NAT cannot overwrite each other's rows.
 *   - Classroom snapshots are pseudonymous by construction: the client sends a
 *     random studentId and an optional display name, never an email. The server
 *     stores exactly the whitelisted fields of the snapshot (sanitizeSnapshot),
 *     capped in size, with a 400-day TTL. Roster reads need the creating
 *     instructor's session, the per-class instructorToken (only its SHA-256 is
 *     stored) or the INSTRUCTOR_SECRET. A removed student is remembered so their
 *     device stops re-posting (410 {removed:true} makes js/classroom.js leave).
 */

const MAGIC_TTL_SEC = 15 * 60;
const SESSION_TTL_SEC = 30 * 24 * 3600;
const STRIPE_TOLERANCE_SEC = 300;
const MAGIC_EMAIL_WINDOW_SEC = 10 * 60;   // per-recipient magic-link window
const MAGIC_EMAIL_MAX = 3;                // links per recipient per window
const RL_SHARDS = 4;                      // KV counter shards per (bucket, key, window)
const CERT_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/1/O/I; 'L' first char is reserved for local ids
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/* ------------------------------------------------------------------ *
 * small utilities
 * ------------------------------------------------------------------ */
const enc = new TextEncoder();

function b64url(bytes) {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function randomId(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a); }
function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmac(secret, msg) { return crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)); }
async function sha256(msg) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(msg))); }
function nowSec() { return Math.floor(Date.now() / 1000); }
function isEmail(s) { s = String(s || '').trim(); return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function error(message, status = 400, extra = {}) { return json({ error: message, ...extra }, status); }

/* ------------------------------------------------------------------ *
 * CORS: only origins listed in ALLOWED_ORIGINS (comma separated) get headers.
 * ------------------------------------------------------------------ */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const list = allowedOrigins(env);
  const ok = list.includes(origin) || (list.includes('*') && !origin.startsWith('null'));
  if (!ok) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-Class-Token, X-Instructor-Secret',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}
function withCors(res, cors) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/* ------------------------------------------------------------------ *
 * rate limiting
 *
 * rateLimit(env, request, bucket, max, opts) → true when the call may proceed.
 *   opts.key       what to count (default: the caller's IP). Hashed before use.
 *   opts.windowSec window length (default 60).
 *   opts.failOpen  true → a storage error lets the call through (only for
 *                  read-only routes); default false → a storage error REJECTS.
 *
 * 1) Preferred: a Workers Rate Limiting binding named RL_<BUCKET> (e.g. RL_MAGIC,
 *    RL_MAGIC_EMAIL), configured in wrangler.toml with
 *      [[unsafe.bindings]] name = "RL_MAGIC" type = "ratelimit" namespace_id = "1001"
 *      simple = { limit = 5, period = 60 }
 *    It is atomic and free, so a burst cannot slip past it. The limit/period
 *    live in the binding; `max`/`windowSec` are then documentation only.
 * 2) Fallback: sharded KV counters. Cloudflare KV refuses more than one write
 *    per second to the same key, so one counter key per IP would throw under a
 *    burst — which the old code answered by letting everything through. Now each
 *    hit increments one of RL_SHARDS random keys and the shards are summed on
 *    read, and any KV error on a write-side bucket is treated as "over".
 *    KV is eventually consistent, so the KV path is approximate; the binding is
 *    the exact one.
 * ------------------------------------------------------------------ */
function rlBindingName(bucket) { return 'RL_' + String(bucket).toUpperCase().replace(/[^A-Z0-9]/g, '_'); }
async function rateLimit(env, request, bucket, max, opts = {}) {
  const failOpen = !!opts.failOpen;
  const subject = opts.key != null ? String(opts.key) : (request.headers.get('CF-Connecting-IP') || 'unknown');
  const windowSec = opts.windowSec || 60;
  try {
    const binding = env[rlBindingName(bucket)];
    if (binding && typeof binding.limit === 'function') {
      const r = await binding.limit({ key: `${bucket}:${subject}` });
      return !!(r && r.success);
    }
    if (!env.TOKENS) return failOpen;
    const id = await sha256(`${bucket}|${subject}`);
    const win = Math.floor(Date.now() / (windowSec * 1000));
    const base = `rl:${bucket}:${id}:${win}:`;
    const counts = await Promise.all(Array.from({ length: RL_SHARDS }, (_, i) => env.TOKENS.get(base + i)));
    const total = counts.reduce((s, v) => s + (parseInt(v || '0', 10) || 0), 0) + 1;
    if (total > max) return false;                       // over: no write needed
    const shard = Math.floor(Math.random() * RL_SHARDS);
    const mine = (parseInt(counts[shard] || '0', 10) || 0) + 1;
    await env.TOKENS.put(base + shard, String(mine), { expirationTtl: Math.max(60, windowSec * 2) });
    return true;
  } catch (e) {
    return failOpen;
  }
}

/* ------------------------------------------------------------------ *
 * JWT-like tokens (HS256)
 * ------------------------------------------------------------------ */
async function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(await hmac(secret, `${header}.${body}`));
  return `${header}.${body}.${sig}`;
}
async function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = b64url(await hmac(secret, `${parts[0]}.${parts[1]}`));
  if (!timingSafeEqual(expected, parts[2])) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < nowSec()) return null;
  return payload;
}

/* ------------------------------------------------------------------ *
 * certificate ids: BT-YYYY-XXXXXX from HMAC(secret, email|name|issuedAt|nonce)
 * ------------------------------------------------------------------ */
function idFromBytes(bytes, year) {
  const u = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < 6; i++) out += CERT_ALPHABET.charAt(u[i] % CERT_ALPHABET.length);
  if (out.charAt(0) === 'L') out = CERT_ALPHABET.charAt((u[0] + 1) % CERT_ALPHABET.length) + out.slice(1); // 'L' = local/self-issued
  return `BT-${year}-${out}`;
}
async function certificateId(secret, { email, name, issuedAt, nonce = '' }) {
  const year = new Date(issuedAt).getUTCFullYear();
  const mac = await hmac(secret, `cert|${email}|${name}|${issuedAt}|${nonce}`);
  return idFromBytes(mac, year);
}
const CERT_RE = /^BT-(\d{4})-([A-Z0-9]{6})$/;
function normalizeCertId(id) { return String(id || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^BT(?=[0-9A-Z])/, 'BT-'); }

/* ------------------------------------------------------------------ *
 * Stripe webhook signature (https://stripe.com/docs/webhooks/signatures)
 * header: t=<unix>,v1=<hex>[,v1=<hex>...]
 * ------------------------------------------------------------------ */
function parseStripeSignature(header) {
  const out = { t: null, v1: [] };
  String(header || '').split(',').forEach(part => {
    const [k, v] = part.split('=').map(s => (s || '').trim());
    if (k === 't') out.t = parseInt(v, 10);
    else if (k === 'v1' && v) out.v1.push(v);
  });
  return out;
}
async function verifyStripeSignature(rawBody, header, secret, now = nowSec(), tolerance = STRIPE_TOLERANCE_SEC) {
  const sig = parseStripeSignature(header);
  if (!sig.t || !sig.v1.length) return false;
  if (Math.abs(now - sig.t) > tolerance) return false;
  const expected = hex(await hmac(secret, `${sig.t}.${rawBody}`));
  return sig.v1.some(v => timingSafeEqual(v, expected));
}

/* ------------------------------------------------------------------ *
 * members & sessions
 * ------------------------------------------------------------------ */
async function getMember(env, email) {
  const raw = await env.MEMBERS.get(`member:${email}`);
  return raw ? JSON.parse(raw) : null;
}
async function putMember(env, member) {
  member.updatedAt = new Date().toISOString();
  await env.MEMBERS.put(`member:${member.email}`, JSON.stringify(member));
  if (member.stripeCustomerId) await env.MEMBERS.put(`customer:${member.stripeCustomerId}`, member.email);
  return member;
}
async function ensureMember(env, email) {
  return (await getMember(env, email)) || putMember(env, { email, pro: false, plan: null, proUntil: null, createdAt: new Date().toISOString() });
}
function isProNow(member) {
  if (!member || !member.pro) return false;
  if (member.proUntil && Date.parse(member.proUntil) < Date.now() - 3 * 864e5) return false; // 3-day grace for renewals
  return true;
}
function publicMember(member, session) {
  return { email: member.email, pro: isProNow(member), plan: member.plan || null, proUntil: member.proUntil || null, expires: session ? session.expires : null };
}
async function createSession(env, email) {
  const id = randomId(32);
  const expires = new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString();
  await env.TOKENS.put(`session:${await sha256(id)}`, JSON.stringify({ email, expires, createdAt: new Date().toISOString() }), { expirationTtl: SESSION_TTL_SEC });
  return { id, expires };
}
async function readSession(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const raw = await env.TOKENS.get(`session:${await sha256(m[1].trim())}`);
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (Date.parse(s.expires) < Date.now()) return null;
  s.hash = await sha256(m[1].trim());
  return s;
}

/* ------------------------------------------------------------------ *
 * email (Resend)
 * ------------------------------------------------------------------ */
async function sendMagicEmail(env, email, link) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY secret is not set');
  const from = env.EMAIL_FROM || 'Broward Trading <onboarding@resend.dev>';
  const text = `Sign in to Broward Trading\n\nOpen this link on the device you want to use. It expires in 15 minutes and works once:\n\n${link}\n\nIf you did not request this, ignore this email. Nobody can sign in without the link.\n\nBroward Trading is a free educational simulator. No real orders are placed.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#141a22">
  <h2 style="margin:0 0 12px">Sign in to Broward Trading</h2>
  <p>Open this link on the device you want to use. It expires in <b>15 minutes</b> and works once.</p>
  <p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Sign in</a></p>
  <p style="font-size:13px;color:#5f6b7a">Or paste this address into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
  <p style="font-size:13px;color:#5f6b7a">If you did not request this, ignore this email. Nobody can sign in without the link.</p>
  <hr style="border:0;border-top:1px solid #d6dce5;margin:20px 0">
  <p style="font-size:12px;color:#8a97a8">Broward Trading is a free educational simulator. No real orders are placed and no money changes hands.</p>
</div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject: 'Your Broward Trading sign-in link', text, html })
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/* ------------------------------------------------------------------ *
 * Stripe (form-encoded REST, no SDK)
 * ------------------------------------------------------------------ */
async function stripe(env, path, params) {
  const body = new URLSearchParams();
  const add = (k, v) => { if (v === undefined || v === null) return; if (typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => add(`${k}[${kk}]`, vv)); else body.append(k, String(v)); };
  Object.entries(params || {}).forEach(([k, v]) => add(k, v));
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `Stripe error ${res.status}`);
  return data;
}
async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2024-06-20' } });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `Stripe error ${res.status}`);
  return data;
}

/* ------------------------------------------------------------------ *
 * route handlers
 * ------------------------------------------------------------------ */
function siteUrl(env, request) {
  const s = String(env.SITE_URL || '').replace(/\/+$/, '');
  if (s) return s;
  const o = request.headers.get('Origin');
  return o && allowedOrigins(env).includes(o) ? o : '';
}
function safeRedirect(env, request, candidate) {
  // Only redirect to the configured site or an allowed origin.
  const site = siteUrl(env, request);
  const allowed = [site, ...allowedOrigins(env)].filter(Boolean);
  try {
    const u = new URL(candidate, site || undefined);
    if (allowed.some(a => u.origin === new URL(a).origin)) return u.origin + u.pathname;
  } catch (e) { /* fall through */ }
  return `${site}/pricing.html`;
}
async function readJson(request) { try { return await request.json(); } catch (e) { return null; } }

async function postMagicLink(request, env) {
  if (!(await rateLimit(env, request, 'magic', 5))) return error('Too many sign-in requests. Try again in a minute.', 429);
  const body = await readJson(request) || {};
  const email = normEmail(body.email);
  if (!isEmail(email)) return error('Enter a valid email address.');
  if (!env.HMAC_SECRET) return error('Server is missing HMAC_SECRET.', 500);
  // Per-recipient limit: at most MAGIC_EMAIL_MAX links per inbox per 10 minutes,
  // whoever asks. When it trips we answer exactly like a success and send
  // nothing, so the response cannot be used to tell real addresses from fake
  // ones and no inbox can be flooded from many IPs.
  const emailKey = hex(await hmac(env.HMAC_SECRET, `rl|magic-email|${email}`));
  if (!(await rateLimit(env, request, 'magic-email', MAGIC_EMAIL_MAX, { key: emailKey, windowSec: MAGIC_EMAIL_WINDOW_SEC }))) {
    return json({ ok: true, sent: true, expiresInSec: MAGIC_TTL_SEC });
  }
  const jti = randomId(16);
  const exp = nowSec() + MAGIC_TTL_SEC;
  const redirect = safeRedirect(env, request, body.redirect || `${siteUrl(env, request)}/pricing.html`);
  const token = await signToken({ sub: email, jti, exp, typ: 'magic' }, env.HMAC_SECRET);
  await env.TOKENS.put(`magic:${jti}`, JSON.stringify({ email, redirect }), { expirationTtl: MAGIC_TTL_SEC });
  const link = `${new URL(request.url).origin}/auth/callback?token=${encodeURIComponent(token)}`;
  try { await sendMagicEmail(env, email, link); }
  catch (e) { return error('Could not send the email right now. ' + (env.DEBUG === 'true' ? e.message : 'Please try again later.'), 502); }
  return json({ ok: true, sent: true, expiresInSec: MAGIC_TTL_SEC });
}

/* One-time use for magic links.
 * KV has no compare-and-swap and is eventually consistent, so a plain
 * get-then-delete lets two callbacks that arrive close together (user + a
 * link-prefetching mail scanner, or two tabs) both mint a session.
 *
 * Preferred: a Durable Object lock (binding MAGIC_LOCK → class MagicLock below,
 * free-tier SQLite DO; see wrangler.toml). One object per jti, single-threaded,
 * so exactly one claim succeeds. Configure with
 *   [[durable_objects.bindings]] name = "MAGIC_LOCK" class_name = "MagicLock"
 *   [[migrations]] tag = "v1" new_sqlite_classes = ["MagicLock"]
 *
 * Fallback (KV only): each callback writes its own random claim to
 * "magic-used:<jti>" and reads it back. Two facts make this a usable lock:
 *   - KV refuses more than one write per second to the same key, so the second
 *     of two near-simultaneous claims throws and that caller loses;
 *   - within a location KV is read-your-writes, so a claim written more than a
 *     second earlier is seen by the initial get and refused; last-write-wins
 *     plus the read-back refuses a caller whose claim was overwritten.
 * The claim also records a hash of the caller's IP. Residual window on the KV
 * path: two callbacks at different edges, more than one second apart but
 * before the claim has replicated (normally seconds, documented up to 60 s).
 * Bind MAGIC_LOCK to remove it entirely.
 */
async function claimMagicToken(env, request, jti) {
  const pendingKey = `magic:${jti}`;
  const usedKey = `magic-used:${jti}`;
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  const claim = randomId(16);
  if (await env.TOKENS.get(usedKey)) return null;                         // already claimed somewhere we can see
  const raw = await env.TOKENS.get(pendingKey);
  if (!raw) return null;
  let record; try { record = JSON.parse(raw); } catch (e) { return null; }

  if (env.MAGIC_LOCK && typeof env.MAGIC_LOCK.idFromName === 'function') {
    const stub = env.MAGIC_LOCK.get(env.MAGIC_LOCK.idFromName(`magic:${jti}`));
    const res = await stub.fetch('https://magic-lock/claim', { method: 'POST', body: JSON.stringify({ claim, ipHash, ttlSec: MAGIC_TTL_SEC }) });
    const out = res.ok ? await res.json() : null;
    if (!out || !out.claimed) return null;
    await env.TOKENS.put(usedKey, JSON.stringify({ claim, ipHash, at: nowSec() }), { expirationTtl: MAGIC_TTL_SEC }).catch(() => {});
    await env.TOKENS.delete(pendingKey).catch(() => {});
    return record;
  }

  try {
    await env.TOKENS.put(usedKey, JSON.stringify({ claim, ipHash, at: nowSec() }), { expirationTtl: MAGIC_TTL_SEC });
  } catch (e) { return null; }                                             // KV's 1 write/s/key rule: another claim just landed
  await env.TOKENS.delete(pendingKey).catch(() => {});
  let w = null; try { w = JSON.parse(await env.TOKENS.get(usedKey)); } catch (e) { /* ignore */ }
  if (!w || w.claim !== claim || w.ipHash !== ipHash) return null;        // overwritten: someone else claimed it
  return record;
}

/* Durable Object: one instance per magic jti; the first POST /claim wins.
 * Needs no KV; the object remembers the claim for ttlSec and then forgets it
 * (an alarm clears storage so the free-tier footprint stays near zero). */
export class MagicLock {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/claim') {
      let body = {}; try { body = await request.json(); } catch (e) { /* ignore */ }
      const existing = await this.state.storage.get('claim');
      if (existing) return new Response(JSON.stringify({ claimed: false, at: existing.at }), { headers: JSON_HEADERS });
      const rec = { claim: String(body.claim || ''), ipHash: String(body.ipHash || ''), at: nowSec() };
      await this.state.storage.put('claim', rec);
      const ttl = Math.min(86400, Math.max(60, +body.ttlSec || MAGIC_TTL_SEC));
      if (typeof this.state.storage.setAlarm === 'function') await this.state.storage.setAlarm(Date.now() + ttl * 1000);
      return new Response(JSON.stringify({ claimed: true }), { headers: JSON_HEADERS });
    }
    if (request.method === 'GET') {
      const existing = await this.state.storage.get('claim');
      return new Response(JSON.stringify({ claimed: !!existing }), { headers: JSON_HEADERS });
    }
    return new Response('Not found', { status: 404 });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}

async function getCallback(request, env) {
  const url = new URL(request.url);
  const site = siteUrl(env, request);
  const fail = (msg) => Response.redirect(`${site}/pricing.html#auth_error=${encodeURIComponent(msg)}`, 302);
  const payload = await verifyToken(url.searchParams.get('token'), env.HMAC_SECRET || '');
  if (!payload || payload.typ !== 'magic' || !payload.jti) return fail('That sign-in link is invalid or has expired. Request a new one.');
  const record = await claimMagicToken(env, request, payload.jti);
  if (!record) return fail('That sign-in link was already used or has expired. Request a new one.');
  const { email, redirect } = record;
  if (email !== payload.sub) return fail('Sign-in link mismatch.');
  await ensureMember(env, email);
  const session = await createSession(env, email);
  // The session id itself never travels in a URL: the redirect carries a short-lived
  // one-time code that js/auth.js swaps for the id with POST /auth/exchange. A code
  // that leaks through a referrer, history sync or a shared screenshot is useless
  // after 60 s or one use, and it cannot be used as a bearer token at all.
  const code = await mintLoginCode(env, session.id, email);
  const dest = `${redirect || `${site}/pricing.html`}#code=${encodeURIComponent(code)}`;
  return Response.redirect(dest, 302);
}

const LOGIN_CODE_TTL_SEC = 60;
const LOGIN_CODE_RE = /^[A-Za-z0-9_-]{32}$/;
async function mintLoginCode(env, sessionId, email) {
  const code = randomId(24); // 32 base64url chars
  await env.TOKENS.put(`code:${code}`, JSON.stringify({ sessionId, email, at: nowSec() }), { expirationTtl: LOGIN_CODE_TTL_SEC });
  return code;
}
/* POST /auth/exchange {code} → {session, email}. Browser-only: unlike webhooks and
 * link clicks, this call always comes from the site's JavaScript, so a MISSING
 * Origin header is refused too (the top-level handler already refuses origins
 * that are not allow-listed). The code is deleted on first use. */
async function postExchange(request, env) {
  if (!request.headers.get('Origin')) return error('Origin required.', 403);
  if (!(await rateLimit(env, request, 'exchange', 20))) return error('Too many attempts. Try again in a minute.', 429);
  const body = await readJson(request) || {};
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!LOGIN_CODE_RE.test(code)) return error('That sign-in code is invalid. Request a new link.', 400);
  const key = `code:${code}`;
  const raw = await env.TOKENS.get(key);
  if (!raw) return error('That sign-in code has expired or was already used. Request a new link.', 410);
  await env.TOKENS.delete(key);
  let rec;
  try { rec = JSON.parse(raw); } catch (e) { rec = null; }
  if (!rec || !rec.sessionId || !rec.email || (rec.at && nowSec() - rec.at > LOGIN_CODE_TTL_SEC)) {
    return error('That sign-in code has expired or was already used. Request a new link.', 410);
  }
  return json({ session: rec.sessionId, email: rec.email });
}

async function getMe(request, env) {
  const s = await readSession(env, request);
  if (!s) return error('Not signed in.', 401);
  const member = await ensureMember(env, s.email);
  return json(publicMember(member, s));
}

async function postSignOut(request, env) {
  const s = await readSession(env, request);
  if (s) await env.TOKENS.delete(`session:${s.hash}`);
  return json({ ok: true });
}

async function postCheckout(request, env) {
  const s = await readSession(env, request);
  if (!s) return error('Sign in first.', 401);
  if (!env.STRIPE_SECRET_KEY) return error('Payments are not configured on this server yet.', 503, { notConfigured: true });
  const body = await readJson(request) || {};
  const plan = body.plan === 'annual' ? 'annual' : 'monthly';
  const price = plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : env.STRIPE_PRICE_MONTHLY;
  if (!price) return error(`No Stripe price configured for the ${plan} plan.`, 503, { notConfigured: true });
  const member = await ensureMember(env, s.email);
  if (isProNow(member)) return error('This account is already Pro.', 409);
  const site = siteUrl(env, request);
  const success = safeRedirect(env, request, body.successUrl || `${site}/pricing.html`) + '#checkout=success';
  const cancel = safeRedirect(env, request, body.cancelUrl || `${site}/pricing.html`) + '#checkout=cancel';
  try {
    const params = {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': 1,
      success_url: success,
      cancel_url: cancel,
      client_reference_id: await sha256(member.email),
      allow_promotion_codes: 'true',
      'metadata[email]': member.email,
      'metadata[plan]': plan,
      'subscription_data[metadata][email]': member.email,
      'subscription_data[metadata][plan]': plan
    };
    if (member.stripeCustomerId) params.customer = member.stripeCustomerId; else params.customer_email = member.email;
    const session = await stripe(env, 'checkout/sessions', params);
    return json({ url: session.url, id: session.id });
  } catch (e) {
    return error('Could not start checkout: ' + e.message, 502);
  }
}

async function setPro(env, email, pro, extra = {}) {
  const member = await ensureMember(env, email);
  member.pro = !!pro;
  Object.assign(member, extra);
  await putMember(env, member);
  return member;
}
async function emailForCustomer(env, customerId, fallback) {
  if (fallback && isEmail(fallback)) return normEmail(fallback);
  if (!customerId) return null;
  const e = await env.MEMBERS.get(`customer:${customerId}`);
  if (e) return e;
  try { const c = await stripeGet(env, `customers/${customerId}`); return c && c.email ? normEmail(c.email) : null; } catch (err) { return null; }
}
async function postStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return error('Webhook secret not configured.', 503);
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return error('Invalid signature.', 400);
  let event;
  try { event = JSON.parse(raw); } catch (e) { return error('Bad JSON.'); }
  // Idempotency: Stripe retries; remember processed event ids for a day.
  const seenKey = `stripe:evt:${event.id}`;
  if (await env.TOKENS.get(seenKey)) return json({ received: true, duplicate: true });
  const obj = (event.data && event.data.object) || {};
  const meta = obj.metadata || {};
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const email = await emailForCustomer(env, obj.customer, meta.email || (obj.customer_details && obj.customer_details.email) || obj.customer_email);
        if (email) {
          const plan = meta.plan || null;
          const extra = { stripeCustomerId: obj.customer || null, subscriptionId: obj.subscription || null, plan, proSince: new Date().toISOString() };
          if (obj.subscription) {
            try { const sub = await stripeGet(env, `subscriptions/${obj.subscription}`); if (sub.current_period_end) extra.proUntil = new Date(sub.current_period_end * 1000).toISOString(); } catch (e) { /* keep going */ }
          }
          await setPro(env, email, true, extra);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const email = await emailForCustomer(env, obj.customer, meta.email);
        if (email) {
          const active = ['active', 'trialing', 'past_due'].includes(obj.status);
          const extra = { subscriptionId: obj.id, stripeCustomerId: obj.customer || null, plan: meta.plan || null, subscriptionStatus: obj.status };
          if (obj.current_period_end) extra.proUntil = new Date(obj.current_period_end * 1000).toISOString();
          if (obj.cancel_at_period_end) extra.cancelAtPeriodEnd = true;
          await setPro(env, email, active, extra);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const email = await emailForCustomer(env, obj.customer, meta.email);
        if (email) await setPro(env, email, false, { subscriptionStatus: 'canceled', canceledAt: new Date().toISOString() });
        break;
      }
      case 'invoice.payment_failed': {
        const email = await emailForCustomer(env, obj.customer, obj.customer_email);
        if (email) { const m = await ensureMember(env, email); m.lastPaymentFailedAt = new Date().toISOString(); await putMember(env, m); }
        break;
      }
      default: break; // ignore everything else
    }
  } catch (e) {
    return error('Webhook handler failed: ' + e.message, 500);
  }
  await env.TOKENS.put(seenKey, '1', { expirationTtl: 86400 });
  return json({ received: true });
}

function cleanModules(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map(m => ({
    id: String((m && m.id) || '').slice(0, 40),
    title: String((m && m.title) || '').slice(0, 120),
    done: !!(m && m.done),
    quizAvg: m && typeof m.quizAvg === 'number' ? Math.round(m.quizAvg) : null
  })).filter(m => m.id);
}
async function postCertificates(request, env) {
  const s = await readSession(env, request);
  if (!s) return error('Sign in to issue a verified certificate.', 401);
  if (!(await rateLimit(env, request, 'cert', 10))) return error('Too many requests. Try again in a minute.', 429);
  const member = await ensureMember(env, s.email);
  const requirePro = String(env.CERT_REQUIRE_PRO || 'false') === 'true';
  if (requirePro && !isProNow(member)) return error('Verified certificates are a Pro feature.', 403, { requiresPro: true });
  const body = await readJson(request) || {};
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 2) return error('Enter the name that should appear on the certificate.');
  const modules = cleanModules(body.modules);
  const scorePct = body.scorePct == null ? null : Math.max(0, Math.min(100, Math.round(+body.scorePct || 0)));
  const issuedAt = new Date().toISOString();
  let id, nonce = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    id = await certificateId(env.HMAC_SECRET, { email: member.email, name, issuedAt, nonce });
    if (!(await env.CERTS.get(`cert:${id}`))) break;
    nonce = randomId(4);
  }
  const record = { id, name, issuedAt, modules, scorePct, course: String(body.course || 'Broward Trading Course').slice(0, 120), pro: isProNow(member), emailHash: await sha256(member.email) };
  await env.CERTS.put(`cert:${id}`, JSON.stringify(record));
  // index by member so a student can list their own certificates later
  const idxKey = `by:${record.emailHash}`;
  const idx = JSON.parse((await env.CERTS.get(idxKey)) || '[]');
  idx.unshift(id);
  await env.CERTS.put(idxKey, JSON.stringify(idx.slice(0, 20)));
  const site = siteUrl(env, request);
  return json({ id, url: `${site}/verify.html?id=${encodeURIComponent(id)}`, name, issuedAt, modules, scorePct, verified: true }, 201);
}

async function getVerify(request, env, rawId) {
  const id = normalizeCertId(decodeURIComponent(rawId || ''));
  if (!CERT_RE.test(id)) return json({ found: false, invalid: true, id });
  if (!(await rateLimit(env, request, 'verify', 60))) return error('Too many requests. Try again in a minute.', 429);
  const raw = await env.CERTS.get(`cert:${id}`);
  if (!raw) return json({ found: false, id }, 404);
  const r = JSON.parse(raw);
  // Never expose the email hash; the public record is name + course facts.
  return json({ found: true, record: { id: r.id, name: r.name, issuedAt: r.issuedAt, modules: r.modules, scorePct: r.scorePct, course: r.course, verified: true } }, 200, { 'cache-control': 'public, max-age=300' });
}

const CODE_RE = /^[A-Z0-9-]{3,16}$/;
function rankEntries(entries) {
  return entries.slice().sort((a, b) => (b.stats.returnPct - a.stats.returnPct) || (a.stats.maxDrawdownPct - b.stats.maxDrawdownPct)).slice(0, 100)
    .map((e, i) => ({ rank: i + 1, ...e }));
}
/* Public view of a row: rank, nickname, stats, updatedAt. The owner value never
 * leaves the server (it is an HMAC, but there is no reason to show it at all). */
function publicEntries(entries) { return rankEntries(entries).map(({ owner: _o, ...e }) => e); }
const OWNER_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
/* Owner values are HMACs with the server secret, so a leaked KV dump cannot be
 * reversed to an email or IP (plain sha256 of either is brute-forceable). */
async function ownerFor(env, kind, value) { return hex(await hmac(env.HMAC_SECRET, `lb|${kind}|${value}`)); }

async function getLeaderboard(request, env) {
  const code = String(new URL(request.url).searchParams.get('code') || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return error('Class code must be 3–16 letters, digits or dashes.');
  if (!(await rateLimit(env, request, 'lb-read', 120, { failOpen: true }))) return error('Too many requests. Try again in a minute.', 429);
  const raw = await env.LEADERBOARD.get(`class:${code}`);
  const entries = raw ? JSON.parse(raw) : [];
  return json({ code, entries: publicEntries(entries), updatedAt: new Date().toISOString() });
}
async function postLeaderboard(request, env) {
  if (!(await rateLimit(env, request, 'lb', 20))) return error('Too many submissions. Try again in a minute.', 429);
  const body = await readJson(request) || {};
  const code = String(body.classCode || '').trim().toUpperCase();
  const nickname = String(body.nickname || '').trim().replace(/[^\w .'-]/g, '').slice(0, 24);
  if (!CODE_RE.test(code)) return error('Class code must be 3–16 letters, digits or dashes.');
  if (nickname.length < 2) return error('Nickname must be at least 2 characters.');
  const st = body.stats || {};
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
  const stats = { returnPct: +num(st.returnPct, -100, 10000).toFixed(2), trades: Math.round(num(st.trades, 0, 100000)), winRate: +num(st.winRate, 0, 100).toFixed(1), maxDrawdownPct: +num(st.maxDrawdownPct, 0, 100).toFixed(2) };
  if (!env.HMAC_SECRET) return error('Server is missing HMAC_SECRET.', 500);
  // Ownership. Signed-in students own rows by (HMAC of) email. Anonymous
  // students own rows by a random per-browser ownerToken: the first submit
  // without one mints it and returns it, js/auth.js stores it and sends it back
  // with later submits. IPs are never used, so a whole class behind one school
  // NAT cannot overwrite each other's rows, and nothing stored can be reversed.
  const s = await readSession(env, request);
  const sentToken = typeof body.ownerToken === 'string' && OWNER_TOKEN_RE.test(body.ownerToken) ? body.ownerToken : null;
  const ownerToken = sentToken || randomId(24);
  const tokenOwner = await ownerFor(env, 'token', ownerToken);
  const emailOwner = s ? await ownerFor(env, 'email', s.email) : null;
  const owner = emailOwner || tokenOwner;
  const key = `class:${code}`;
  const raw = await env.LEADERBOARD.get(key);
  let entries = raw ? JSON.parse(raw) : [];
  // one row per nickname per class; only the owner may update it
  const existing = entries.find(e => e.nickname.toLowerCase() === nickname.toLowerCase());
  if (existing && existing.owner !== owner && !(sentToken && existing.owner === tokenOwner)) {
    return error('That nickname is taken in this class. Pick another, or submit from the browser that created it.', 409);
  }
  entries = entries.filter(e => e !== existing);
  entries.push({ nickname, stats, owner, updatedAt: new Date().toISOString() });
  if (entries.length > 200) entries = rankEntries(entries).slice(0, 200).map(({ rank, ...e }) => e);
  await env.LEADERBOARD.put(key, JSON.stringify(entries), { expirationTtl: 180 * 86400 });
  const out = { ok: true, code, entries: publicEntries(entries) };
  if (!emailOwner) out.ownerToken = ownerToken; // anonymous: client keeps this to update its row later
  return json(out);
}

/* ------------------------------------------------------------------ *
 * classroom (v0.4): classes, student snapshots, instructor roster
 *
 * KV CLASSES
 *   class:<CODE>            {code, name, section, term, createdAt, ownerKind, owner, tokenHash}
 *   student:<CODE>:<id>     sanitized snapshot + receivedAt + ipless (400-day TTL)
 *   removed:<CODE>:<id>     '1' for 400 days after an instructor DELETE
 *
 * Who may act as the instructor of a class (classAuth):
 *   1. the Bearer session of the member who created it (owner = HMAC of email);
 *   2. the per-class instructorToken returned once by POST /classes, sent back
 *      as `X-Class-Token` (only sha256(token) is stored; the instructor page
 *      keeps the token in localStorage 'bt.instructor');
 *   3. the deployment-wide INSTRUCTOR_SECRET (`X-Instructor-Secret`), for a
 *      school that runs the Worker without magic-link accounts.
 * ------------------------------------------------------------------ */
const CLASS_CODE_RE = /^[23456789A-HJ-NP-Z]{6}$/;          // CERT_ALPHABET: no 0/1/O/I
const STUDENT_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const CLASS_TTL_SEC = 400 * 86400;
const MAX_ROSTER = 500;
const SNAPSHOT_MAX_BYTES = 64 * 1024;

function normClassCode(s) { return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function newClassCode() {
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  let out = '';
  for (let i = 0; i < 6; i++) out += CERT_ALPHABET.charAt(a[i] % CERT_ALPHABET.length);
  return out;
}
function cleanText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function clampNum(v, lo, hi, dp = 2) {
  if (v === null || v === undefined || v === '') return null;
  const n = +v; if (!isFinite(n)) return null;
  return +Math.max(lo, Math.min(hi, n)).toFixed(dp);
}
/* Whitelist the snapshot: only known fields, bounded sizes, numbers clamped. Anything else is dropped. */
function sanitizeSnapshot(body) {
  const b = body && typeof body === 'object' ? body : {};
  const lessonsDone = Array.isArray(b.lessonsDone) ? [...new Set(b.lessonsDone.map(x => cleanText(x, 40)).filter(Boolean))].slice(0, 400) : [];
  const quizScores = {};
  if (b.quizScores && typeof b.quizScores === 'object') {
    Object.keys(b.quizScores).slice(0, 400).forEach(k => { const key = cleanText(k, 40); const v = clampNum(b.quizScores[k], 0, 100, 0); if (key && v !== null) quizScores[key] = v; });
  }
  const drills = (Array.isArray(b.drills) ? b.drills : []).slice(0, 40).map(d => d && typeof d === 'object' ? {
    id: cleanText(d.id, 60), title: cleanText(d.title, 120), returnPct: clampNum(d.returnPct, -100, 100000), buyHoldPct: clampNum(d.buyHoldPct, -100, 100000),
    maxDrawdownPct: clampNum(d.maxDrawdownPct, 0, 100), trades: Math.round(clampNum(d.trades, 0, 100000, 0) || 0), passed: !!d.passed, completed: !!d.completed,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? String(d.date) : null
  } : null).filter(d => d && d.id);
  const p = b.paper && typeof b.paper === 'object' ? b.paper : {};
  const paper = { equity: clampNum(p.equity, 0, 1e12), startingCash: clampNum(p.startingCash, 0, 1e12), returnPct: clampNum(p.returnPct, -100, 1e6), trades: Math.round(clampNum(p.trades, 0, 1e6, 0) || 0), winRate: clampNum(p.winRate, 0, 100, 1), fills: Math.round(clampNum(p.fills, 0, 1e6, 0) || 0), positions: Math.round(clampNum(p.positions, 0, 1e4, 0) || 0) };
  const j = b.journal && typeof b.journal === 'object' ? b.journal : {};
  const journalEntries = Math.round(clampNum(b.journalEntries, 0, 1e6, 0) || 0);
  const journal = { entries: journalEntries, reviewed: Math.round(clampNum(j.reviewed, 0, 1e6, 0) || 0), withLessons: Math.round(clampNum(j.withLessons, 0, 1e6, 0) || 0), weeklyReviews: Math.round(clampNum(j.weeklyReviews, 0, 1e4, 0) || 0), lastDate: /^\d{4}-\d{2}-\d{2}$/.test(String(j.lastDate || '')) ? String(j.lastDate) : null };
  const d5 = b.daily && typeof b.daily === 'object' ? b.daily : {};
  const streak = Math.round(clampNum(b.streak, 0, 10000, 0) || 0);
  const lessonsTotal = clampNum(b.lessonsTotal, 1, 10000, 0);
  const cert = b.certificate && typeof b.certificate === 'object' && b.certificate.id ? { id: cleanText(b.certificate.id, 24), date: cleanText(b.certificate.date, 40) || null } : null;
  return {
    v: 1,
    studentId: STUDENT_ID_RE.test(String(b.studentId || '')) ? String(b.studentId) : null,
    displayName: cleanText(b.displayName, 40),
    lessonsDone, quizScores, lessonsTotal, startedAt: cleanText(b.startedAt, 40) || null, certificate: cert,
    drills, paper, journalEntries, journal, streak,
    daily: { streak, days: Math.round(clampNum(d5.days, 0, 10000, 0) || 0), best: Math.round(clampNum(d5.best, 0, 10000, 0) || 0) },
    lastActive: /^\d{4}-\d{2}-\d{2}$/.test(String(b.lastActive || '')) ? String(b.lastActive) : null,
    updatedAt: cleanText(b.updatedAt, 40) || null
  };
}
function publicClass(c) { return { code: c.code, name: c.name, section: c.section, term: c.term, createdAt: c.createdAt }; }
async function getClassRecord(env, code) {
  const raw = await env.CLASSES.get(`class:${code}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function instructorSecretOk(env, request, body) {
  if (!env.INSTRUCTOR_SECRET) return false;
  const sent = request.headers.get('X-Instructor-Secret') || (body && typeof body.instructorSecret === 'string' ? body.instructorSecret : '');
  return !!sent && timingSafeEqual(sent, env.INSTRUCTOR_SECRET);
}
/* classAuth(request, env, cls, body?) → 'session' | 'token' | 'secret' | null */
async function classAuth(request, env, cls, body) {
  if (instructorSecretOk(env, request, body)) return 'secret';
  const tok = request.headers.get('X-Class-Token') || '';
  if (tok && cls.tokenHash && timingSafeEqual(await sha256(tok.trim()), cls.tokenHash)) return 'token';
  if (env.TOKENS && env.HMAC_SECRET && cls.ownerKind === 'email') {
    const s = await readSession(env, request);
    if (s && timingSafeEqual(await ownerFor(env, 'class', s.email), cls.owner)) return 'session';
  }
  return null;
}
function classesReady(env) { return !!(env.CLASSES && typeof env.CLASSES.get === 'function'); }

async function postClasses(request, env) {
  if (!classesReady(env)) return error('Classroom is not configured on this server (CLASSES KV binding missing).', 503, { notConfigured: true });
  if (!(await rateLimit(env, request, 'class-create', 5))) return error('Too many classes created from this network. Try again in a minute.', 429);
  const body = await readJson(request) || {};
  let ownerKind = null, owner = null;
  if (instructorSecretOk(env, request, body)) { ownerKind = 'secret'; owner = 'secret'; }
  else if (env.TOKENS && env.HMAC_SECRET) {
    const s = await readSession(env, request);
    if (s) { ownerKind = 'email'; owner = await ownerFor(env, 'class', s.email); }
  }
  if (!ownerKind) {
    const canSignIn = !!(env.TOKENS && env.HMAC_SECRET && env.RESEND_API_KEY);
    return error(canSignIn ? 'Sign in first (More → Pro → sign in), or enter the instructor secret your school set.' : 'This server needs an instructor secret to create classes. Ask whoever deployed it to set INSTRUCTOR_SECRET.', 401, { requiresInstructor: true, canSignIn });
  }
  const name = cleanText(body.name, 80);
  if (name.length < 2) return error('Give the class a name students will recognise, e.g. "FIN 1100 Markets by Doing".');
  const section = cleanText(body.section, 40), term = cleanText(body.term, 40);
  let code = null;
  for (let attempt = 0; attempt < 8; attempt++) { const c = newClassCode(); if (!(await env.CLASSES.get(`class:${c}`))) { code = c; break; } }
  if (!code) return error('Could not allocate a class code. Try again.', 503);
  const instructorToken = randomId(24);
  const record = { code, name, section, term, createdAt: new Date().toISOString(), ownerKind, owner, tokenHash: await sha256(instructorToken) };
  await env.CLASSES.put(`class:${code}`, JSON.stringify(record), { expirationTtl: CLASS_TTL_SEC });
  return json({ ...publicClass(record), instructorToken, ownerKind }, 201);
}
async function getClass(request, env, rawCode) {
  if (!classesReady(env)) return error('Classroom is not configured on this server.', 503, { notConfigured: true });
  const code = normClassCode(rawCode);
  if (!CLASS_CODE_RE.test(code)) return error('A class code is 6 letters or digits.', 400);
  if (!(await rateLimit(env, request, 'class-read', 60, { failOpen: true }))) return error('Too many requests. Try again in a minute.', 429);
  const cls = await getClassRecord(env, code);
  if (!cls) return json({ found: false, code, error: 'No class has that code. Check it with your instructor.' }, 404);
  return json({ found: true, ...publicClass(cls) });
}
async function postSnapshot(request, env, rawCode) {
  if (!classesReady(env)) return error('Classroom is not configured on this server.', 503, { notConfigured: true });
  const code = normClassCode(rawCode);
  if (!CLASS_CODE_RE.test(code)) return error('A class code is 6 letters or digits.', 400);
  if (!(await rateLimit(env, request, 'snap', 30))) return error('Too many snapshots. Try again in a minute.', 429);
  const len = +request.headers.get('content-length') || 0;
  if (len > SNAPSHOT_MAX_BYTES) return error('Snapshot too large.', 413);
  const raw = await request.text();
  if (raw.length > SNAPSHOT_MAX_BYTES) return error('Snapshot too large.', 413);
  let body; try { body = JSON.parse(raw); } catch (e) { return error('Bad JSON.'); }
  const snap = sanitizeSnapshot(body);
  if (!snap.studentId) return error('Snapshot is missing a valid studentId.', 400);
  const cls = await getClassRecord(env, code);
  if (!cls) return error('No class has that code. Check it with your instructor.', 404);
  if (await env.CLASSES.get(`removed:${code}:${snap.studentId}`)) return json({ error: 'Your instructor removed you from this class. Nothing more is sent.', removed: true }, 410);
  // No IP, no user agent, no email: exactly the whitelisted snapshot plus a server timestamp.
  snap.receivedAt = new Date().toISOString();
  await env.CLASSES.put(`student:${code}:${snap.studentId}`, JSON.stringify(snap), { expirationTtl: CLASS_TTL_SEC });
  return json({ ok: true, code, className: cls.name, receivedAt: snap.receivedAt });
}
async function listRoster(env, code) {
  const prefix = `student:${code}:`;
  const keys = [];
  let cursor;
  do {
    const page = await env.CLASSES.list({ prefix, cursor, limit: 1000 });
    (page.keys || []).forEach(k => keys.push(k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && keys.length < MAX_ROSTER);
  const rows = await Promise.all(keys.slice(0, MAX_ROSTER).map(k => env.CLASSES.get(k)));
  return rows.map(r => { try { return r ? JSON.parse(r) : null; } catch (e) { return null; } }).filter(Boolean);
}
async function getRoster(request, env, rawCode) {
  if (!classesReady(env)) return error('Classroom is not configured on this server.', 503, { notConfigured: true });
  const code = normClassCode(rawCode);
  if (!CLASS_CODE_RE.test(code)) return error('A class code is 6 letters or digits.', 400);
  if (!(await rateLimit(env, request, 'roster', 60))) return error('Too many requests. Try again in a minute.', 429);
  const cls = await getClassRecord(env, code);
  if (!cls) return error('No class has that code.', 404);
  const via = await classAuth(request, env, cls);
  if (!via) return error('Only the instructor who created this class can read its roster.', 403);
  const students = await listRoster(env, code);
  return json({ ok: true, class: publicClass(cls), students, count: students.length, via });
}
async function deleteStudent(request, env, rawCode, rawId) {
  if (!classesReady(env)) return error('Classroom is not configured on this server.', 503, { notConfigured: true });
  const code = normClassCode(rawCode);
  const id = decodeURIComponent(String(rawId || ''));
  if (!CLASS_CODE_RE.test(code)) return error('A class code is 6 letters or digits.', 400);
  if (!STUDENT_ID_RE.test(id)) return error('Invalid student id.', 400);
  if (!(await rateLimit(env, request, 'roster', 60))) return error('Too many requests. Try again in a minute.', 429);
  const cls = await getClassRecord(env, code);
  if (!cls) return error('No class has that code.', 404);
  const via = await classAuth(request, env, cls);
  if (!via) return error('Only the instructor who created this class can remove students.', 403);
  await env.CLASSES.delete(`student:${code}:${id}`);
  await env.CLASSES.put(`removed:${code}:${id}`, '1', { expirationTtl: CLASS_TTL_SEC });
  return json({ ok: true, code, studentId: id, removed: true });
}

/* ------------------------------------------------------------------ *
 * router
 * ------------------------------------------------------------------ */
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;

  if (m === 'GET' && (path === '/' || path === '/health')) return json({ ok: true, service: 'broward-trading-api', version: '0.4.0', classroom: classesReady(env) });
  if (m === 'POST' && path === '/auth/magic-link') return postMagicLink(request, env);
  if (m === 'GET' && path === '/auth/callback') return getCallback(request, env);
  if (m === 'POST' && path === '/auth/exchange') return postExchange(request, env);
  if (m === 'GET' && path === '/me') return getMe(request, env);
  if (m === 'POST' && path === '/auth/signout') return postSignOut(request, env);
  if (m === 'POST' && path === '/checkout') return postCheckout(request, env);
  if (m === 'POST' && path === '/webhook/stripe') return postStripeWebhook(request, env);
  if (m === 'POST' && path === '/certificates') return postCertificates(request, env);
  if (m === 'GET' && path.startsWith('/verify/')) return getVerify(request, env, path.slice('/verify/'.length));
  if (m === 'GET' && path === '/leaderboard') return getLeaderboard(request, env);
  if (m === 'POST' && path === '/leaderboard') return postLeaderboard(request, env);
  if (m === 'POST' && path === '/classes') return postClasses(request, env);
  const cls = /^\/classes\/([^/]+)(?:\/(snapshots|roster|students\/([^/]+)))?$/.exec(path);
  if (cls) {
    const [, code, sub, studentId] = cls;
    if (m === 'GET' && !sub) return getClass(request, env, code);
    if (m === 'POST' && sub === 'snapshots') return postSnapshot(request, env, code);
    if (m === 'GET' && sub === 'roster') return getRoster(request, env, code);
    if (m === 'DELETE' && sub && sub.startsWith('students/')) return deleteStudent(request, env, code, studentId);
  }
  return error('Not found.', 404);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
    }
    // Browser calls must come from an allowed origin; webhooks and link clicks have no Origin header.
    const origin = request.headers.get('Origin');
    if (origin && !Object.keys(cors).length) return json({ error: 'Origin not allowed.' }, 403);
    let res;
    try { res = await route(request, env); }
    catch (e) { res = error('Internal error' + (env.DEBUG === 'true' ? ': ' + e.message : '.'), 500); }
    return withCors(res, cors);
  }
};

/* Exported for tests (tests/auth.test.js imports this module in Node 22+). */
export const _internal = {
  b64url, b64urlDecode, timingSafeEqual, signToken, verifyToken, certificateId, idFromBytes, CERT_RE, CERT_ALPHABET,
  normalizeCertId, parseStripeSignature, verifyStripeSignature, isEmail, isProNow, rankEntries, publicEntries, corsHeaders, hex, sha256,
  rateLimit, rlBindingName, claimMagicToken, MagicLock, ownerFor, OWNER_TOKEN_RE,
  mintLoginCode, postExchange, LOGIN_CODE_RE, LOGIN_CODE_TTL_SEC,
  MAGIC_TTL_SEC, SESSION_TTL_SEC, MAGIC_EMAIL_WINDOW_SEC, MAGIC_EMAIL_MAX, RL_SHARDS,
  // classroom (v0.4)
  CLASS_CODE_RE, STUDENT_ID_RE, CLASS_TTL_SEC, SNAPSHOT_MAX_BYTES, newClassCode, normClassCode, sanitizeSnapshot, classAuth,
  postClasses, getClass, postSnapshot, getRoster, deleteStudent, route
};
