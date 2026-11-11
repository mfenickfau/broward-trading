# Deploying Broward Trading

The site is static: HTML, CSS, JS and JSON. Any web server or static host can serve it. This guide covers **GitHub Pages** (free, recommended), custom domains, publishing from this folder, and a checklist to run before every deploy.

---

## 1. Before you publish

From the project folder:

```bash
# 1. Syntax-check every script
for f in js/*.js tests/*.js; do node --check "$f" || echo "FAILED: $f"; done

# 2. Run the module tests
node tests/indicators.test.js
node tests/paper.test.js
node tests/options.test.js
node tests/backtest.test.js

# 3. Validate course JSON parses
for f in course/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD JSON: $f"; done

# 4. Serve locally and click through every page
python3 -m http.server 8080   # open http://localhost:8080
```

Check on the local server, not `file://`, because `learn.html` fetches `course/*.json` and browsers block `fetch` on `file://`.

Make sure these files exist at the root: `index.html`, `.nojekyll` (tells Pages not to run Jekyll, which would otherwise ignore files and folders starting with an underscore and try to process the Markdown), `LICENSE`, `README.md`.

## 2. Publish from this folder to GitHub

The folder may already be a git repository (there is a `.git` directory). If it is not, start one.

```bash
cd /path/to/broward-trading

# only if there is no .git yet
git init
git branch -M main

git add .
git status                      # confirm no secrets or scratch files are staged (.gitignore covers the usual ones)
git commit -m "Broward Trading v0.2"
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

## 3. Turn on GitHub Pages

1. On GitHub, open the repository → **Settings** → **Pages** (left sidebar, under "Code and automation").
2. **Build and deployment → Source**: *Deploy from a branch*.
3. **Branch**: `main`, **Folder**: `/ (root)`. Save.
4. Wait 1 to 2 minutes. The page shows the URL, normally `https://<user>.github.io/broward-trading/`.
5. Tick **Enforce HTTPS** once the certificate is ready (a few minutes after the first deploy).

Every push to `main` redeploys automatically. There is nothing to build.

### Project site vs user site

- **Project site** (this repo): `https://<user>.github.io/broward-trading/`. All links in the app are relative (`css/style.css`, `learn.html`, `course/index.json`), so the sub-path works without changes.
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
        with: { node-version: 20 }
      - run: for f in js/*.js tests/*.js; do node --check "$f"; done
      - run: for t in tests/*.test.js; do node "$t"; done
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
3. On GitHub: **Settings → Pages → Custom domain**, enter the domain, Save. GitHub commits a `CNAME` file containing the domain to the repo root; keep it (it is a plain text file with one line, and it is fine to create it yourself).
4. Wait for the DNS check to pass (minutes to an hour), then tick **Enforce HTTPS**. GitHub provisions a Let's Encrypt certificate automatically.
5. Recommended: **verify the domain** for your account or organisation (Settings → Pages → Verified domains) so nobody else can claim it if the Pages site is ever removed.

Links in the app are relative, so moving from `github.io/broward-trading/` to a custom domain needs no code change.

## 5. Other free static hosts

Same folder, no changes:

- **Cloudflare Pages**: connect the repo, framework preset *None*, build command empty, output directory `/`. Free, fast, and the natural home for a future data proxy (Workers).
- **Netlify**: drag-and-drop the folder or connect the repo; publish directory `.`; no build command.
- **Vercel**: import repo, framework *Other*, output directory `.`.
- **Any school web server**: copy the folder; it works from a sub-directory.

## 6. What the browser needs to reach

The site itself is self-contained except for:

| Resource | Host | Why |
|---|---|---|
| lightweight-charts 4.2.0 | `unpkg.com` | chart library (pinned version) |
| IBM Plex Sans / Mono | `fonts.googleapis.com`, `fonts.gstatic.com` | typography; the site falls back to system fonts if blocked |
| Market data (optional) | `api.twelvedata.com`, `finnhub.io`, `www.alphavantage.co` | only when a student enters a key; otherwise demo mode, fully offline |

If your institution's network blocks `unpkg.com`, vendor the chart library: download `lightweight-charts.standalone.production.js` into `vendor/` and change the `<script src>` in each page. Its Apache-2.0 licence allows this; keep its licence file alongside.

If you add a `Content-Security-Policy` header or meta tag, allow `script-src 'self' https://unpkg.com`, `style-src 'self' https://fonts.googleapis.com 'unsafe-inline'`, `font-src https://fonts.gstatic.com`, and `connect-src 'self'` plus the three data hosts. The app treats a blocked `fetch` as a reason to fall back to demo data, so a too-strict policy degrades gracefully but silently; check the demo badge.

## 7. Updating the site

```bash
git add -A
git commit -m "Describe the change"
git push
```

Pages redeploys within a minute or two. Browsers may cache `css/style.css` and `js/*.js` for a while; if students report seeing old behaviour, hard-refresh (Ctrl/Cmd + Shift + R) or add a query string to the asset links (`js/app.js?v=0.2.1`) when you cut a release.

Student data (`localStorage` keys `bt.data`, `bt.portfolio`, `bt.course`) lives in their browsers and survives deploys. If a release changes a storage format, bump a `version` field inside the stored object and migrate on load rather than resetting students' progress.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 404 at the Pages URL | Pages not enabled, wrong branch/folder, or first build still running | Check Settings → Pages; wait two minutes; confirm `index.html` is at the repo root. |
| Course page shows "could not load lessons" | Opened from `file://`, or a JSON file has a syntax error | Serve over http; run the JSON validation loop in section 1. |
| Styles missing on the custom domain | Mixed content (http assets on https) or wrong relative path | All asset links must be relative, no leading slash. |
| Chart area empty | `unpkg.com` blocked, or the lightweight-charts version changed API | Vendor the library (section 6); keep the version pinned to 4.2.0. |
| Live data always falls back to demo | Missing or invalid key, provider over its free limit, or CSP blocking `connect-src` | Open Data settings; check the fallback reason the app shows; see `docs/DATA_SOURCES.md`. |
| HTTPS checkbox greyed out | DNS not propagated yet | Wait up to an hour; confirm records with `dig +short app.browardtrading.example`. |
| Pages ignores a folder | Jekyll processing enabled | Make sure `.nojekyll` exists at the root and is committed. |

## 9. Releases

Tag versions so students and instructors can reference them: `git tag -a v0.2.0 -m "Modular app" && git push --tags`. Keep `docs/ROADMAP.md` and the roadmap section of `about.html` in sync with each tag.
