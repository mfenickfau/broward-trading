/* Broward Trading — sw.js (service worker, v0.5)
 *
 * Goal: the app shell and the course open instantly and work offline; market
 * data is never served stale from here.
 *
 *   App shell (html, css, js, course JSON, icons, manifest)
 *     - precached on install; missing files (pages another release adds) are
 *       skipped instead of failing the whole install
 *     - navigations: network first, cached page as fallback, then an inline
 *       offline page
 *     - other same-origin assets: stale-while-revalidate (fast now, fresh next time)
 *   Third-party static (Google Fonts, unpkg chart library): cache first
 *   Market-data and API hosts (api.twelvedata.com, finnhub.io, alphavantage.co,
 *   Stripe, workers.dev) and same-origin API paths (/auth, /me, /checkout,
 *   /certificates, /verify, /leaderboard, /webhook, /classes, /leagues, /coach — for when the Worker is
 *   mounted on the site's origin): network only. Nothing from them is stored
 *   here, so no response can be older than the 60 s limit in CONTRACTS.md.
 *   Requests carrying an Authorization header are never cached either.
 *   js/data.js keeps its own short in-page cache.
 *
 * Bump VERSION whenever a precached file changes in a way that must reach users
 * immediately; otherwise stale-while-revalidate picks changes up on the next load.
 */
/* eslint-env serviceworker */
'use strict';

const VERSION = 'bt-v0.5.0';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

const SHELL = [
  './',
  'index.html', 'learn.html', 'start.html', 'replay.html', 'portfolio.html', 'backtest.html', 'journal.html',
  'news.html', 'compare.html', 'glossary.html', 'instructor.html', 'pricing.html', 'verify.html',
  'certificate.html', 'about.html',
  'leagues.html', 'screener.html', 'builder.html', 'profile.html',
  'css/style.css', 'css/print.css',
  'js/nav.js', 'js/i18n.js', 'js/indicators.js', 'js/data.js', 'js/paper.js', 'js/options.js', 'js/backtest.js',
  'js/course.js', 'js/app.js', 'js/learn.js', 'js/portfolio.js', 'js/backtest-ui.js',
  'js/replay.js', 'js/alerts.js', 'js/journal.js', 'js/auth.js', 'js/config.js',
  'js/glossary.js', 'js/news.js', 'js/compare.js',
  'js/onboarding.js', 'js/classroom.js', 'js/instructor.js', 'js/csv.js',
  'js/leagues.js', 'js/leagues-ui.js', 'js/screener.js', 'js/screener-ui.js', 'js/rules.js', 'js/builder-ui.js',
  'js/xp.js', 'js/risk.js', 'js/coach.js',
  'js/vendor/lightweight-charts.standalone.production.js',
  'i18n/es.json',
  'course/index.json', 'course/m1-foundations.json', 'course/m2-charts.json', 'course/m3-indicators.json',
  'course/m4-risk.json', 'course/m5-options.json', 'course/m6-strategy.json', 'course/m7-replay.json',
  'course/m8-capstone.json', 'course/m9-crypto-etf.json', 'course/drills.json', 'course/glossary.json',
  'course/questionbank.json', 'course/firstweek.json', 'course/personality.json', 'course/m10-toolkit.json',
  'course/es/index.json', 'course/es/m1-foundations.json', 'course/es/m2-charts.json', 'course/es/m3-indicators.json',
  'course/es/m4-risk.json', 'course/es/m5-options.json', 'course/es/m6-strategy.json', 'course/es/m7-replay.json',
  'course/es/m8-capstone.json', 'course/es/m9-crypto-etf.json', 'course/es/drills.json', 'course/es/glossary.json',
  'course/es/questionbank.json', 'course/es/firstweek.json', 'course/es/personality.json', 'course/es/m10-toolkit.json',
  'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

/* Hosts whose responses must never be cached here (live market data, auth, payments). */
const NETWORK_ONLY_HOSTS = [
  'api.twelvedata.com', 'finnhub.io', 'www.alphavantage.co', 'alphavantage.co',
  'api.stripe.com', 'checkout.stripe.com', 'workers.dev'
];
const NETWORK_ONLY_PATHS = /^\/(auth|me|checkout|certificates|verify|leaderboard|webhook|classes|leagues|coach)(\/|$)/;

/* Third-party static assets that are safe to keep (versioned URLs, fonts). */
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

const OFFLINE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline · Broward Trading</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1319;color:#e6ebf2;font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif;padding:24px;text-align:center}' +
  'main{max-width:36ch}h1{font-size:22px;margin:0 0 8px}p{color:#8a97a8;margin:0 0 16px}a{color:#4f8cff}</style></head><body><main>' +
  '<h1>You are offline</h1><p>This page has not been saved for offline use yet. Pages you have opened before still work, and the demo prices never need a connection.</p>' +
  '<p><a href="index.html">Open the dashboard</a> · <a href="learn.html">Continue the course</a></p></main></body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Add one by one: a 404 for a page this deployment does not have yet must not break the install.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('bt-') && n !== SHELL_CACHE && n !== RUNTIME_CACHE).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* unsupported */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith('bt-')).map((n) => caches.delete(n)))));
  }
});

function isNetworkOnly(url) {
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return true;
  if (url.origin === self.location.origin && NETWORK_ONLY_PATHS.test(url.pathname)) return true;
  return false;
}
function isStaticHost(url) {
  return STATIC_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}
function cacheable(res) {
  return !!res && (res.ok || res.type === 'opaque') && !(res.headers.get('cache-control') || '').includes('no-store');
}
/* A request that carries credentials gets a personalised body; never store or serve it from cache. */
function isAuthenticated(req) {
  return !!(req && req.headers && req.headers.has('authorization'));
}

async function networkFirstPage(event) {
  const req = event.request;
  if (isAuthenticated(req)) return fetch(req);
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const res = preload || await fetch(req);
    if (cacheable(res) && res.type !== 'opaque') cache.put(req, res.clone()).catch(() => null);
    return res;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true }) || await cache.match(new URL(req.url).pathname.split('/').pop() || './');
    if (cached) return cached;
    return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  if (isAuthenticated(req)) return fetch(req);
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: req.url.includes('?v=') });
  const refresh = fetch(req).then((res) => {
    if (cacheable(res)) cache.put(req, res.clone()).catch(() => null);
    return res;
  }).catch(() => null);
  if (cached) { refresh.catch(() => null); return cached; }
  const res = await refresh;
  if (res) return res;
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function cacheFirst(req, cacheName) {
  if (isAuthenticated(req)) return fetch(req);
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone()).catch(() => null);
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Live data and account APIs: straight to the network, nothing stored, nothing served stale.
  if (isNetworkOnly(url)) return;

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      event.respondWith(networkFirstPage(event));
      return;
    }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  if (isStaticHost(url)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
  // Anything else cross-origin falls through to the browser untouched.
});
