# Deploying Broward Trading

The site is static: HTML, CSS, JS, JSON and a few icons. Any web server or static host can serve it. This guide covers **GitHub Pages** (free, recommended), custom domains, publishing from this folder, the service worker, the optional membership backend, and a checklist to run before every deploy.

If you are reading this on a phone: everything in sections 2 and 3 needs a computer with `git`, or the GitHub website's "upload files" button. The checks in section 1 need Node.

---

## 1. Before you publish

From the project folder:

```bash
# 1. Syntax-check every script (inline <script> blocks are not checked by this; the e2e test catches those)
for f in js/*.js tests/*.js sw.js server/worker.js; do node --check "$f" || echo "FAILED: $f"; done

# 2. Run every unit test (Node 18+; tests/auth.test.js needs Node 22+ for WebCrypto)
for t in tests/*.test.js; do echo "== $t"; node "$t" || echo "FAILED: $t"; done

# 3. Validate every JSON file parses
for f in course/*.json manifest.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD JSON: $f"; done

# 4. Serve locally and click through every page at phone width (390 px) and desktop
python3 -m http.server 8080   # open http://localhost:8080

# 5. Optional: the Playwright smoke test (needs the playwright package + Chromium)
python3 -m http.server 8765 &
node tests/e2e.playwright.js
```

Check on the local server, not `file://`: `learn.html`, `replay.html` and `glossary.html` fetch JSON, and the service worker only registers over http(s).

Make sure these files exist at the root: `index.html`, `.nojekyll` (tells Pages not to run Jekyll, which would otherwise ignore files and folders starting with an underscore and try to process the Markdown), `manifest.json`, `sw.js`, `LICENSE`, `README.md`.

### If you changed a precached file

`sw.js` precaches the app shell (every page, `css/style.css`, every `js/*.js`, course JSON, icons). Returning visitors get the cached copy first and the new one on their *next* load (stale-while-revalidate). If a change must reach everyone immediately (a fixed bug in `js/paper.js`, a corrected quiz answer), bump the `VERSION` constant at the top of `sw.js`:

```js
const VERSION = 'bt-v0.3.1';
```

A new version installs in the background, and `js/nav.js` shows a one-time "update ready, reload" prompt. Old caches are deleted on activation. Market data and the API are never cached by the worker, so a `VERSION` bump is never needed for data problems.

## 2. Publish from this folder to GitHub

The folder may already be a git repository (there is a `.git` directory). If it is not, start one.

```bash
cd /path/to/broward-trading

# only if there is no .git yet
git init
git branch -M main

git add .
git status                      # confirm no secrets or scratch files are staged (.gitignore covers .wrangler/, .env, *.key)
git commit -m "Broward Trading v0.3"
```

Create an empty repository on GitHub (no README, no licence, so there is nothing to merge), then:

```bash
git remote add origin https://github.com/<your-user-or-org>/broward-trading.git
# or with SSH: git remote add origin git@github.com:<your-user-or-org>/broward-trading.git

git push -u origin main
```

If a remote named `origin` already exists and points somewhere else: `git remote set-url origin <new-url>`.

Using the GitHub CLI instead:

```bash
gh repo create broward-trading --public --source=. --remote=origin --push
```

**Never commit** `server/.dev.vars`, anything under `.wrangler/`, or a `wrangler.toml` with real KV ids you consider private (the ids are not secrets, but the file is public once pushed; secrets themselves only ever go through `wrangler secret put`).

## 3. Turn on GitHub Pages

1. On GitHub, open the repository → **Settings** → **Pages** (left sidebar, under "Code and automation").
2. **Build and deployment → Source**: *Deploy from a branch*.
3. **Branch**: `main`, **Folder**: `/ (root)`. Save.
4. Wait 1 to 2 minutes. The page shows the URL, normally `https://<user>.github.io/broward-trading/`.
5. Tick **Enforce HTTPS** once the certificate is ready (a few minutes after the first deploy). HTTPS is required for the service worker, notifications and "Add to Home Screen".

Every push to `main` redeploys automatically. There is nothing to build.

### Project site vs user site

- **Project site** (this repo): `https://<user>.github.io/broward-trading/`. All links in the app are relative (`css/style.css`, `learn.html`, `course/index.json`), the manifest uses `"start_url": "index.html"` and `"scope": "./"`, and the service worker registers as `sw.js` relative to the page, so the sub-path works without changes.
- **User / organisation site**: name the repository `<user>.github.io` and it serves at `https://<user>.github.io/`. Same files, no sub-path.

### Optional: deploy with GitHub Actions

Not needed, but if you prefer the Actions-based Pages flow (lets you run tests before deploying), choose **Source: GitHub Actions** and add `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: for f in js/*.js tests/*.js sw.js server/worker.js; do node --check "$f"; done
      - run: for t in tests/*.test.js; do node "$t"; done
      - run: for f in course/*.json manifest.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done
  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }
      - id: deployment
        uses: actions/deploy-pages@v4
```

## 4. Custom domain

Example: `app.browardtrading.example`.

1. Buy the domain from any registrar (about $10 to $15/year for a `.com`).
2. **DNS** at the registrar:
   - For a subdomain such as `app.` or `www.`: add a **CNAME** record pointing to `<user>.github.io` (no repository name).
   - For the apex domain (`browardtrading.example`): add **A** records to GitHub Pages' IPs, currently `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, and **AAAA** records `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`. Confirm the current list in GitHub's Pages documentation; it changes rarely but it does change.
3. On GitHub: **Settings → Pages → Custom domain**, enter the domain, Save. GitHub commits a `CNAME` file containing the domain to the repo root; keep it.
4. Wait for the DNS check to pass (minutes to an hour), then tick **Enforce HTTPS**. GitHub provisions a Let's Encrypt certificate automatically.
5. Recommended: **verify the domain** for your account or organisation (Settings → Pages → Verified domains) so nobody else can claim it if the Pages site is ever removed.

Links in the app are relative, so moving from `github.io/broward-trading/` to a custom domain needs no code change. Two things do change:

- Students who installed the PWA from the old URL keep an app pointing at the old URL. Ask them to reinstall from the new one (`docs/MOBILE.md`).
- If the membership backend is deployed, update `SITE_URL` and `ALLOWED_ORIGINS` in `server/wrangler.toml` and redeploy the Worker (section 7).

## 5. Other free static hosts

Same folder, no changes:

- **Cloudflare Pages**: connect the repo, framework preset *None*, build command empty, output directory `/`. Free, fast, and the natural home if you also run the Worker in `server/`.
- **Netlify**: drag-and-drop the folder or connect the repo; publish directory `.`; no build command.
- **Vercel**: import repo, framework *Other*, output directory `.`.
- **Any school web server**: copy the folder; it works from a sub-directory. It must be served over HTTPS for the service worker and install prompt; plain http on `localhost` is also accepted by browsers for testing.

## 6. What the browser needs to reach

The site itself is self-contained except for:

| Resource | Host | Why |
|---|---|---|
| lightweight-charts 4.2.0 | `unpkg.com` | chart library (pinned version). **Falls back automatically** to the vendored copy in `js/vendor/` when the CDN is blocked or offline. |
| IBM Plex Sans / Mono | `fonts.googleapis.com`, `fonts.gstatic.com` | typography; the site falls back to system fonts if blocked |
| Market data (optional) | `api.twelvedata.com`, `finnhub.io`, `www.alphavantage.co` | only when a student enters a key; otherwise demo mode, fully offline |
| Membership API (optional) | your `*.workers.dev` URL or custom API domain | only when `apiBase` is set in `js/config.js` |
| Stripe Checkout (optional) | `checkout.stripe.com` | only when a student starts a Pro checkout |

If your institution's network blocks `unpkg.com`, nothing breaks: every page loads the vendored copy. If you want to avoid the CDN request entirely, point the `<script src>` in each page at `js/vendor/lightweight-charts.standalone.production.js` and delete the fallback line. Its Apache-2.0 licence file is kept alongside.

If you add a `Content-Security-Policy` header or meta tag, allow `script-src 'self' https://unpkg.com`, `style-src 'self' https://fonts.googleapis.com 'unsafe-inline'`, `font-src https://fonts.gstatic.com`, `img-src 'self' data:`, `worker-src 'self'`, and `connect-src 'self'` plus the three data hosts and your API host. The app treats a blocked `fetch` as a reason to fall back to demo data, so a too-strict policy degrades gracefully but silently; check the demo badge.

## 7. Deploying the optional membership backend

The site is complete without it. When you want sign-in, Pro, verified certificates or the classroom leaderboard:

1. Follow [MEMBERSHIP_SETUP.md](MEMBERSHIP_SETUP.md) (non-developer walkthrough, about 90 minutes) or [../server/README.md](../server/README.md) (technical reference). In short: `cd server && npx wrangler login && npx wrangler deploy` after filling in `wrangler.toml` and setting secrets with `npx wrangler secret put`.
2. Put the Worker URL in `js/config.js` → `apiBase` (no trailing slash). That file is public; it contains no secrets.
3. Make sure `ALLOWED_ORIGINS` in `wrangler.toml` contains your site's origin (`https://<user>.github.io`, no path) and `SITE_URL` contains the full site URL including the `/broward-trading` path when it is a project site.
4. Commit and push the `js/config.js` change; Pages redeploys. Since `js/config.js` is precached, bump `VERSION` in `sw.js` in the same commit so installed apps pick it up immediately.
5. Open `pricing.html` on the live site, request a magic link to yourself and confirm the round trip. Open `verify.html` with a certificate id to confirm CORS is right.

Leave `proGating` at `false` until there is Pro-only content worth gating; the core course must stay free (`docs/BUSINESS.md`).

## 8. Updating the site

```bash
git add -A
git commit -m "Describe the change"
git push
```

Pages redeploys within a minute or two. Three layers of caching are in play:

| Layer | Behaviour | What to do |
|---|---|---|
| GitHub Pages CDN | Short TTL, usually under ten minutes | Wait, or hard-refresh |
| Service worker (`sw.js`) | Shell files served from cache first, refreshed in the background for the next load | Bump `VERSION` in `sw.js` when a change must be immediate; students see an "update ready" prompt |
| Browser HTTP cache | Varies | Hard-refresh (Ctrl/Cmd + Shift + R). On a phone: close the installed app fully and reopen it twice. |

Student data lives in their browsers (`localStorage` keys listed in the README under "Browser storage keys") and survives deploys. If a release changes a storage format, bump a `version` field inside the stored object and migrate on load rather than resetting students' progress; `BT.paper` already does this for the multi-account change in v0.3.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 404 at the Pages URL | Pages not enabled, wrong branch/folder, or first build still running | Check Settings → Pages; wait two minutes; confirm `index.html` is at the repo root. |
| Course / Replay / Glossary page shows "could not load" | Opened from `file://`, or a JSON file has a syntax error | Serve over http; run the JSON validation loop in section 1. |
| Styles missing on the custom domain | Mixed content (http assets on https) or wrong relative path | All asset links must be relative, no leading slash. |
| Chart area empty | Both unpkg and the vendored copy failed, or a page's script order changed | Check the console; the vendored fallback line must stay directly after the unpkg `<script>`. Keep the version pinned to 4.2.0. |
| Live data always falls back to demo | Missing or invalid key, provider over its free limit, or CSP blocking `connect-src` | Open Data settings; check the fallback reason the app shows; see `docs/DATA_SOURCES.md`. |
| Students see old behaviour after a deploy | Service worker serving the cached shell | Bump `VERSION` in `sw.js` and push; or have them reload twice. |
| "Install app" never appears on Android | Site not on HTTPS, manifest or icons not reachable, or the student already installed it | Check DevTools → Application → Manifest on a desktop Chrome; see `docs/MOBILE.md`. |
| Sign-in email never arrives | Backend not deployed, `apiBase` empty, Resend domain not verified, or the origin is missing from `ALLOWED_ORIGINS` | Open the browser console on `pricing.html`; a 403 means CORS. See `docs/MEMBERSHIP_SETUP.md` troubleshooting. |
| HTTPS checkbox greyed out | DNS not propagated yet | Wait up to an hour; confirm records with `dig +short app.browardtrading.example`. |
| Pages ignores a folder | Jekyll processing enabled | Make sure `.nojekyll` exists at the root and is committed. |

## 10. Releases

Tag versions so students and instructors can reference them: `git tag -a v0.3.0 -m "Learning loop and phone app" && git push --tags`. For each tag:

1. Add the release to `docs/CHANGELOG.md`.
2. Keep `docs/ROADMAP.md` and the roadmap section of `about.html` in sync.
3. Bump `VERSION` in `sw.js` and the `"version"` field in `course/index.json` if course files changed.
