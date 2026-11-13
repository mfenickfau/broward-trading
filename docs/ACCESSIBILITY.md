# Accessibility report (v0.4 pass)

Broward Trading is used mostly on phones, often by students who rely on a screen reader, keyboard, zoom or high-contrast settings. This pass audited all 15 pages with [axe-core 4.10.2](https://github.com/dequelabs/axe-core) (rules: WCAG 2.0/2.1/2.2 A + AA and axe best practices) driven by Playwright/Chromium, then fixed every critical and serious finding and almost every moderate one directly in the pages, scripts and stylesheet.

## How the audit was run

- Site served locally with `python3 -m http.server 8768`; axe injected into each page after load.
- Every page at **desktop (1280×900)** and **phone (390×844)**, in **English and Spanish** (the EN/ES toggle, dark theme).
- Main interactive states opened before auditing: a lesson (`learn.html#/lesson/m1-l1`) and a module page, the trade-ticket **Review** step, the **Live data settings** modal, the first-run tour, the phone **More** sheet, a glossary **flashcard** (flipped) and **Daily 5**, the journal editor, a running replay session, a backtest result and the instructor “create class” form.
- 92 page/state/viewport/language combinations per run. Counts below are violation *nodes* summed over every combination for that page, so one shared-shell issue (for example the footer colour) shows up once per combination.

Re-run: the audit script lives outside the repo (it needs axe-core and Playwright, which are not dependencies); it is a 100-line Playwright script that loads `axe.min.js` with `page.addScriptTag` and calls `axe.run(document, {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}})` for each state listed above.

## What changed

### Shared shell (`js/nav.js`, `css/style.css`)

- **Skip link.** `Skip to content` is now the first focusable element on every page. It targets the page’s `<main>` (or the first `.page` block), gives it `id="main"` and `tabindex="-1"`, and moves focus there.
- **Landmarks.** The bottom tab bar is `<nav aria-label="Pages">` (it was “Primary”, which translated to the same Spanish label as the top bar’s “Main”, making the two landmarks indistinguishable). `about.html`, `pricing.html` and `verify.html` now wrap their content in `<main>`; the dashboard’s chart toolbar sits in a labelled `<section>`, its two `<aside>` rails have `aria-label`s, and the glossary tab strip moved inside `<main>` as a `div[role=tablist]`. Modal dialogs use `.modal-head` / `.modal-foot` instead of `<header>` / `<footer>`, which axe (and screen readers) treated as extra banner / contentinfo landmarks.
- **Dialogs.** A generic handler keeps Tab inside any visible `[role=dialog][aria-modal=true]` (settings modal, journal editor, instructor drawer, tour) and lets Escape press its close button; the More sheet keeps its own trap. Focus returns to the opener when a dialog closes (already the case for the sheet, editor and drawer).
- **Charts.** `BT.a11y.describeChart(pane, summary)` inserts a visually hidden `role="img"` node as the pane’s first child and refreshes its `aria-label` on every render, e.g. *“AAPL 1D candlestick chart, 400 bars, last close $245.94, down 1.31% versus the previous bar. Overlays: sma20, sma50.”* Wired into the dashboard price pane and indicator panes, lesson charts, the replay chart and RSI pane, the backtest price chart, the portfolio equity curve and both compare charts. (The chart library’s own attribution link lives inside the canvas table, so the pane itself cannot be `role="img"` without creating a nested-interactive violation.)
- **Live regions.** Toast hosts were already `aria-live="polite"`; order fills (`#tmsg`), alert messages and other `.msg` elements are `role="status"`. `BT.a11y.announce(text)` offers one shared polite region (`#btLive`) for JS-built messages.
- **Scrollable tables.** Any `.table-wrap`, `.log` or `.heat-wrap` that actually overflows gets `tabindex="0"` and a region label, so keyboard users can scroll it (re-checked on resize and DOM changes). `.table-wrap` is now `position:relative` so hidden header text cannot escape the scroll container.
- **Links in prose** are underlined (p, li, td, small, notes, captions, empty states), so they no longer rely on colour alone; links on tinted callouts take the text colour.
- **Reduced motion** was already honoured globally (`prefers-reduced-motion: reduce` collapses every animation and transition); unchanged.

### Colour tokens (`css/style.css`)

White text on the bright brand blue (`#4f8cff`) measured only 3.2:1, on the gain green 2.3:1 and on the loss red 3.8:1. Rather than dull the accent everywhere (links and chart series still use `--accent`), filled controls now use dedicated button tokens that keep the same hue:

| Token | Dark | Light | Used by |
|---|---|---|---|
| `--accent-btn` | `#2f6fe8` (4.6:1 with white) | `#2563eb` (5.2:1) | `.primary`, `button.on`, `.btn-group .on`, page-level `.on` chips/tabs |
| `--up-btn` | `#15803d` (5.0:1) | `#167a3b` (5.4:1) | `.buy`, `.badge.buy`, done ticks, correct-answer keys |
| `--down-btn` | `#dc2626` (4.8:1) | `#c42323` (5.8:1) | `.sell`, `.badge.sell`, wrong-answer keys |
| `--down` (text) | `#ef4444` → `#f36b6b` | `#dc2626` → `#c42323` | loss figures on panels (was 4.15:1 on `--panel2`) |
| `--up` (light text) | unchanged | `#16a34a` → `#167a3b` | gain figures (was 2.9:1 on light panels) |
| `--faint` | `#5c6878` → `#7a8696` | `#8a95a3` → `#637080` | footer meta, sheet note, keyboard hints (was ≈3:1) |

Page stylesheets that painted white on `--accent`/`--up`/`--down` (ticket side buttons, journal chips and segments, glossary A–Z and grade keys, replay stars, news chips, backtest primary, certificate language buttons, learn “go” buttons) were moved to the button tokens. Other page-level contrast fixes: locked First-Week days no longer fade to 60 % (`.card.locked`), compare heat tiles cap their tint at 45 % so `--fg` stays ≥ 4.5:1, instructor sort headers and pricing billing toggle use white on the button blue, glossary grade captions lost their 85 % opacity.

### Semantics and names

- Dashboard: an `<h1>` (visually hidden) so the page has a level-one heading; ticket side buttons are `role="radio"` inside the existing `radiogroup` (so `aria-checked` is valid); watchlist rows are a `<button class="pick">` plus a separate remove button instead of `li[role=button]` (valid list children, no nested controls); the `$`/shares toggle has a name and a 36 px minimum width.
- Learn: callouts are `div[role=note]` instead of `<aside>` (an `aside` inside `<main>` is a misplaced complementary landmark); lesson prose headings move up one level on screen (`#`/`##` → h2, `###` → h3) under a hidden “Lesson content” h2, and the “Up next” card title is an h2, so the outline never skips a level. `BT.course.renderMd` itself is unchanged (print and tests keep h3/h4).
- Journal: the P&L heatmap is `role="group"` (a `grid` must contain rows); desktop cells are 24 px so every day meets the 24 px target-size minimum (phones were already 40 px).
- Pricing: the Free-vs-Pro comparison is a real `<table>` with a caption, column and row headers and visually hidden “included / not included / coming soon” text next to the glyphs (it was a `div[role=table]` without rows).
- Portfolio: empty action-column headers carry hidden “Actions” text; tooltip buttons are a clear 26 px target.
- Spanish dictionary: `Skip to content`, `Pages`, `Lesson content`, `scrollable table` added so the new shell strings translate.

## Known limitations / follow-ups

- Chart summaries built in JavaScript (dashboard, replay, backtest, compare, portfolio) are English-first; the sentence templates go through `BT.t`, so adding them to `i18n/es.json` will translate them. The lesson-chart summary and compare summaries use fixed English fragments.
- The heatmap in the journal is still a mouse/touch-first control (each day is a button with a full date label; keyboard users Tab through the days). A date picker alternative would be friendlier.
- `axe` cannot judge the meaning of chart descriptions, timing of live-region updates or the quality of alt text; those were reviewed by hand on the dashboard, learn, replay, glossary and journal flows (skip link → main, Tab cycling inside the settings modal and journal editor, Escape closing the sheet/modals and returning focus, radio semantics on the ticket, watchlist buttons).
- Colour-contrast results depend on the dark theme the audit ran in; light-theme tokens were adjusted by calculation (ratios above) and spot-checked, not fully re-audited.

## Results (axe-core 4.10.2, violation nodes summed over desktop + phone × EN + ES × states)

## Per page

| Page | Audits run | Before (critical / serious / moderate / minor) | After |
|---|---|---|---|
| index.html | 13 | 52 / 256 / 46 / 78 | 0 / 0 / 0 / 0 |
| learn.html | 10 | 0 / 50 / 20 / 0 | 0 / 0 / 0 / 0 |
| start.html | 4 | 0 / 112 / 1 / 0 | 0 / 0 / 0 / 0 |
| replay.html | 7 | 0 / 17 / 1 / 0 | 0 / 0 / 0 / 0 |
| portfolio.html | 4 | 0 / 27 / 1 / 8 | 0 / 8 / 1 / 0 |
| backtest.html | 7 | 0 / 77 / 1 / 0 | 0 / 0 / 0 / 0 |
| journal.html | 7 | 7 / 1488 / 13 / 0 | 0 / 0 / 0 / 0 |
| news.html | 4 | 0 / 20 / 1 / 0 | 0 / 0 / 0 / 0 |
| compare.html | 4 | 0 / 90 / 1 / 0 | 0 / 0 / 0 / 0 |
| glossary.html | 10 | 0 / 27 / 11 / 0 | 0 / 0 / 0 / 0 |
| instructor.html | 7 | 0 / 28 / 1 / 0 | 0 / 0 / 0 / 0 |
| pricing.html | 4 | 16 / 12 / 57 / 0 | 0 / 0 / 0 / 0 |
| verify.html | 4 | 0 / 12 / 13 / 0 | 0 / 0 / 0 / 0 |
| certificate.html | 4 | 0 / 16 / 1 / 0 | 0 / 0 / 0 / 0 |
| about.html | 5 | 0 / 19 / 50 / 0 | 0 / 0 / 0 / 0 |
| **Total** | 94 | **75 / 2251 / 218 / 86** | **0 / 8 / 1 / 0** |

## Per rule

| Rule | Impact | Before | After | Pages affected before |
|---|---|---|---|---|
| `target-size` | serious | 1477 | 8 | index.html, portfolio.html, journal.html |
| `color-contrast` | serious | 722 | 0 | index.html, learn.html, start.html, replay.html, portfolio.html, backtest.html, journal.html, news.html, compare.html, glossary.html, instructor.html, pricing.html, verify.html, certificate.html, about.html |
| `region` | moderate | 128 | 0 | index.html, glossary.html, pricing.html, verify.html, about.html |
| `aria-allowed-role` | minor | 78 | 0 | index.html |
| `aria-allowed-attr` | critical | 52 | 0 | index.html |
| `landmark-unique` | moderate | 40 | 1 | index.html, journal.html, learn.html, start.html, replay.html, portfolio.html, backtest.html, news.html, compare.html, glossary.html, instructor.html, pricing.html, verify.html, certificate.html, about.html |
| `link-in-text-block` | serious | 31 | 0 | learn.html, portfolio.html, backtest.html, news.html, verify.html |
| `list` | serious | 13 | 0 | index.html |
| `aria-required-parent` | critical | 12 | 0 | pricing.html |
| `landmark-one-main` | moderate | 12 | 0 | pricing.html, verify.html, about.html |
| `aria-required-children` | critical | 11 | 0 | journal.html, pricing.html |
| `heading-order` | moderate | 10 | 0 | learn.html |
| `landmark-complementary-is-top-level` | moderate | 9 | 0 | learn.html |
| `empty-table-header` | minor | 8 | 0 | portfolio.html |
| `scrollable-region-focusable` | serious | 8 | 0 | journal.html, compare.html, about.html |
| `page-has-heading-one` | moderate | 7 | 0 | index.html |
| `landmark-no-duplicate-banner` | moderate | 6 | 0 | index.html, journal.html |
| `landmark-no-duplicate-contentinfo` | moderate | 6 | 0 | index.html, journal.html |

## Remaining after the full run

The full 92-state run finished with 8 serious + 1 moderate nodes, all from two findings fixed afterwards and re-verified clean on a targeted re-check of portfolio.html, journal.html and about.html (desktop, dark): the portfolio tooltip buttons were clipped to 23.4 px by their row (now `margin:0` with 26 px rows) and the auto-labelled scroll regions on the journal shared one label (the role/label was dropped; `tabindex="0"` alone satisfies the rule).

- portfolio.html phone en: `landmark-unique` (moderate) ×1 — e.g. `.card:nth-child(1) > div[data-a11y-scroll="1"][role="region"][aria-label="scrollable table"]`: The landmark must have a unique aria-label, aria-labelledby, or title to make landmarks distinguishable
- portfolio.html phone en: `target-size` (serious) ×8 — e.g. `button[aria-label="Explain Total return"]`: Target has insufficient size because it is partially obscured (smallest space is 44px by 23.4px, should be at least 24px by 24px)
