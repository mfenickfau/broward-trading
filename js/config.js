/* Broward Trading — js/config.js (site configuration, v0.3)
 *
 * The ONE file a site owner edits to turn on the optional membership backend.
 * Load it before js/auth.js on any page that signs in, checks Pro status,
 * issues or verifies certificates (pricing.html, verify.html, learn.html).
 *
 * Everything stays free and fully working when this file is left as-is:
 *   - apiBase ''      → BT.auth runs in "local only" mode: no network calls,
 *                       certificates are self-issued in the browser, the
 *                       sign-in form explains that the backend is not set up.
 *   - proGating false → no lesson is ever locked, even if a module JSON marks
 *                       it `pro:true`.
 *
 * After deploying server/worker.js (see docs/MEMBERSHIP_SETUP.md) set
 * apiBase to the Worker URL, e.g. 'https://broward-trading-api.<you>.workers.dev'
 * (no trailing slash). Nothing here is secret; this file is public.
 *
 * Plain ES2020, no imports. Safe to load in Node for tests.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};
  BT.auth = BT.auth || {};

  var config = {
    /* Base URL of the Cloudflare Worker API. Empty string = backend not configured. */
    apiBase: '',

    /* When true, lessons flagged `pro:true` in course/*.json show a locked preview
     * for non-members. Keep false until the backend is live AND there is Pro-only
     * content worth gating. The core course must stay free (docs/BUSINESS.md). */
    proGating: false,

    /* Planned prices shown on pricing.html. Labelled "planned" in the UI until
     * Stripe is live; the real prices come from the Stripe Price objects the
     * Worker is configured with, never from here. */
    prices: { monthly: 9, annual: 79, currency: 'USD' },

    /* Session length the client trusts. The Worker enforces the real expiry. */
    sessionDays: 30,

    /* Public, non-secret contact shown on pricing/verify pages. */
    supportEmail: '',

    /* Where magic links send people back to. Empty = this origin. */
    siteUrl: ''
  };

  // Allow an earlier inline script (or a test) to pre-seed values.
  var existing = BT.auth.config;
  if (existing && typeof existing === 'object') {
    Object.keys(existing).forEach(function (k) { config[k] = existing[k]; });
  }
  BT.auth.config = config;
  BT.config = config; // convenience alias
})();
