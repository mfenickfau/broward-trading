# Broward Trading — brand & component guide

This document describes the visual system in `css/style.css` so that new pages and modules look like they belong together. The stylesheet is shared by every page (`index.html`, `learn.html`, `portfolio.html`, `backtest.html`, `about.html`); page-specific layout goes in a small `<style>` block in that page, never new colours or fonts.

Contents

1. Voice & principles
2. Setup (what every page includes)
3. Tokens
4. Theming (dark-first, light via OS or `data-theme`)
5. Layout: page shell, top nav, grids
6. Components (catalogue with markup)
7. Charts (reading tokens from JS)
8. Accessibility & motion
9. Do / don't

---

## 1. Voice & principles

Broward Trading is a **free educational simulator**. The look is a calm, dense, terminal-style trading workspace: dark surfaces, thin hairlines, tabular numbers, one accent colour, and green/red reserved strictly for gains/buy/bullish/correct and losses/sell/bearish/wrong.

Copy guidelines:

- Plain English, second person ("you"), short sentences. Students at Broward College are the primary audience; assume no prior finance knowledge.
- Explain the *why* next to every number or signal. Signals "describe what indicators say right now, not what will happen next."
- Always label simulated data as **demo** and keep the disclaimer footer on every page.
- Never promise profits, never call anything "advice". Prefer "candidate", "suggests", "historically".
- No emojis in UI copy. Unicode glyphs (✓ ✕ ▸ ◐ ✎) are fine as icons.

## 2. Setup

Every page includes, in `<head>`:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0f1319">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="css/style.css">
```

Body skeleton:

```html
<nav class="topnav" aria-label="Main"> … </nav>
<div class="page">
  <header> … brand / quote / pills … </header>
  <main> … </main>
  <footer class="footer">Broward Trading is a free educational simulator. No real orders are placed and no money changes hands. Demo prices are generated, not real.</footer>
</div>
<div class="toasts" id="toasts" aria-live="polite"></div>
```

Fonts: **IBM Plex Sans** for UI and prose, **IBM Plex Mono** for every number, ticker, code and axis label. Use `.num` on any element that shows a price, quantity or percentage so digits line up.

## 3. Tokens

All tokens live on `:root`. Use them via `var(--name)`; never hard-code a hex colour in a page or module.

### Surfaces & text

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0f1319` | `#f3f5f8` | page background |
| `--panel` | `#161c25` | `#ffffff` | cards, chart panes, modal |
| `--panel2` | `#1c2430` | `#eef1f5` | inputs, secondary buttons, nested surfaces |
| `--panel3` | `#222c3a` | `#e3e8ef` | hover / pressed surface |
| `--line` | `#263040` | `#d6dce5` | hairlines, borders, grid lines |
| `--line2` | `#34404f` | `#bfc8d4` | stronger border (hover, modal edge) |
| `--fg` | `#e6ebf2` | `#141a22` | primary text |
| `--muted` | `#8a97a8` | `#5f6b7a` | secondary text, labels |
| `--faint` | `#5c6878` | `#8a95a3` | placeholders, disabled |

### Semantic colour

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--accent` | `#4f8cff` | `#2563eb` | brand, links, primary action, focus ring, active nav |
| `--up` | `#22c55e` | `#16a34a` | gain, buy, bullish, live, correct, done |
| `--down` | `#ef4444` | `#dc2626` | loss, sell, bearish, wrong, danger |
| `--warn` | `#f5b84d` | `#b7791f` | demo mode, caution, trend lines |
| `--purple` | `#c084fc` | `#7c3aed` | RSI / EMA series, "key" callouts, advanced level |
| `--teal` | `#2dd4bf` | `#0d9488` | spare series colour |

Each semantic colour has a translucent `*-soft` partner (`--accent-soft`, `--up-soft`, `--down-soft`, `--warn-soft`) for tinted backgrounds (selected quiz option, callouts, hover states). `--accent-fg` is the text colour on an accent-filled surface.

### Chart series palette

Ordered palette for overlay lines, used in this order so the same indicator always has the same colour across the dashboard, lessons and backtester:

| Token | Dark | Light | Conventional use |
|---|---|---|---|
| `--s1` | `#f5b84d` | `#b7791f` | SMA 20, MACD signal line |
| `--s2` | `#4f8cff` | `#2563eb` | SMA 50, MACD line |
| `--s3` | `#c084fc` | `#7c3aed` | EMA 9, RSI |
| `--s4` | `#2dd4bf` | `#0d9488` | VWAP, extra |
| `--s5` | `#fb7185` | `#e11d48` | extra |
| `--s6` | `#a3e635` | `#65a30d` | extra |

Bollinger Bands use `--muted` dashed. Candles and volume use `--up` / `--down`.

### Type scale

`--font`, `--mono`; sizes `--fs-xs` 11 · `--fs-sm` 12 · `--fs` 13 (body) · `--fs-md` 15 · `--fs-lg` 18 · `--fs-xl` 24 · `--fs-2xl` 32; line-height `--lh` 1.45 (prose uses 1.65).

### Shape & space

Radii `--r-sm` 4 · `--r` 6 (buttons, inputs) · `--r-md` 8 (cards, panes) · `--r-lg` 12 (modal) · `--r-pill`.
Spacing `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48.
Layout `--page-max` 1400px · `--gutter` = `max(16px, env(safe-area-inset-left))` · `--measure` 65ch · `--topnav-h` 52px.
Elevation `--shadow-1/2/3`. Motion `--dur` 160ms, `--ease`.

## 4. Theming

Dark is the default. Light is applied two ways, both defining the same token overrides:

1. **OS preference:** `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { … } }`
2. **Explicit pin:** `:root[data-theme="light"] { … }`; `data-theme="dark"` forces dark regardless of OS.

The theme toggle (see `about.html`) stores the choice in `localStorage['bt.theme']` and sets `data-theme` on `<html>`; removing the attribute returns to "follow the OS". Charts must re-read tokens after a theme change (see §7).

`color-scheme` is set per theme so native form controls and scrollbars match.

## 5. Layout

### Page shell

`.page` centres content at `--page-max` (1400px) with 16px side gutters that grow for notched phones via `max(16px, env(safe-area-inset-*))`. `.page.narrow` caps at 900px for reading-heavy pages. There is never horizontal page scroll; wide tables go inside `.table-wrap`.

### Top nav `.topnav`

Sticky, translucent, blurred. Contains `.brand`, `.links` (one `<a>` per page: Dashboard, Learn, Portfolio, Backtest, About) and `.right` (pills, theme button). The current page gets `class="active" aria-current="page"` (accent underline). Under 720px the links wrap to their own row and scroll horizontally with a fade on the right edge.

```html
<nav class="topnav" aria-label="Main">
  <a class="brand" href="index.html">Broward Trading</a>
  <div class="links">
    <a href="index.html">Dashboard</a>
    <a href="learn.html" class="active" aria-current="page">Learn</a>
    …
  </div>
  <div class="right"><span class="pill demo">demo</span><button class="ghost themebtn" aria-label="Toggle theme">◐</button></div>
</nav>
```

### Grids

- `.grid.cols-2 / .cols-3 / .cols-4` — equal columns; collapse at 1100 → 900 → 600px.
- `.grid.auto / .auto-sm / .auto-lg` — `auto-fill` with 240 / 160 / 320px minimums.
- `.grid.workspace` — chart stack + 340px control rail (the dashboard). Stacks under 900px.
- `.grid.sidebar` — 260px index + content (the Learn page). Stacks under 900px.
- `.span-2`, `.span-all`; `.row` (flex, wrap, 8px gap) with `.between .end .center .nowrap`; `.stack` (vertical).

## 6. Components

### Cards

`.card` (12px padding) · `.card.pad` (16px) · `.card.flat` · `.card.raised` · `.card.accent` (tinted) · `.card.clickable` · `.card.done` (green edge) · `.card.locked`. A card's `h2` is the uppercase muted section label and may hold a small button on the right.

```html
<div class="card">
  <h2>Paper account <button class="sm">Reset</button></h2>
  …
</div>
```

`.stat` tile: `.label` / `.value` (mono, 24px) / `.sub`.

### Buttons

Base `<button>` or `<a class="btn">`: secondary surface, accent border on hover.

| Class | Use |
|---|---|
| `.primary` | the one main action in a view |
| `.buy` / `.sell` | order entry only, never for generic yes/no |
| `.ghost` | borderless, low-emphasis (nav icons, close) |
| `.danger` | destructive outline (reset account) |
| `.on` | toggled state for toolbar toggles (`.tf`, `.ov`) |
| `.lg` / `.sm` | size variants |
| `.btn-group` | segmented control of buttons |

### Pills `.pill`

Uppercase status chips. Variants: `.live` (green), `.demo` (amber), `.accent`, `.up`, `.down`, `.solid`, course levels `.beginner .intermediate .advanced`. Add `<span class="dot"></span>` for a status dot (pulses on `.live`).

### Signal `.badge` + `.reasons`

`.badge.buy / .sell / .hold` is the large composite state; `.reasons li` rows hold a `.dot.b/.s` and the text with a `<small>` "why".

### Tables

Plain `<table>`: uppercase muted `th`, hairline rows, last column right-aligned. Modifiers `.dense`, `.striped`, `.hover`; cells `.num .right .center`. Wrap wide tables in `.table-wrap`. `.kv` is a two-column key/value grid for account summaries. `.log` is a scrolling trade log.

### Forms

Inputs, selects and textareas share the `--panel2` surface, accent focus ring (`box-shadow` with `--accent-soft`). Structure fields with `.field` (`label`, control, `.help` / `.error`), lay them out with `.form-row`, join an input and button with `.input-group`. `.trade` is the buy/sell order grid from v0.1. `.msg` (`.ok`, `.err`) is an inline status line.

### Progress

- `.ring` — conic-gradient ring driven by `--pct` (0–100): `<div class="ring" style="--pct:65"><span>65</span></div>`. The `%` is added by CSS. Variants `.sm .lg .done .warn .flat`.
- `.bar` — horizontal bar, same `--pct` variable; `.up .down .warn .thick`.
- `.steps` — numbered checklist (`li.done`, `li.current`).
- `.timeline` — roadmap list (`li.done`, `li.now`, `li.soon`).

### Quiz

```html
<div class="quiz">
  <div>
    <div class="q"><span class="n">1.</span>What does RSI below 30 suggest?</div>
    <div class="options">
      <button class="option"><span class="key"><span>A</span></span>Overbought</button>
      <button class="option correct" disabled><span class="key"><span>B</span></span>Oversold</button>
      <button class="option wrong" disabled><span class="key"><span>C</span></span>Trend is up</button>
    </div>
    <div class="explain correct"><b>Correct.</b> Below 30 momentum is stretched down…</div>
  </div>
  <div class="quiz-result pass"><div class="big">80%</div><div>…</div></div>
</div>
```

States: `.selected` before checking, then `.correct` / `.wrong` (the letter is replaced by ✓ / ✕). Disable all options after checking.

### Callouts

`.callout` (info, accent) · `.callout.tip` (green ✓) · `.callout.warn` (amber !) · `.callout.key` (purple ★, "key idea") · `.callout.danger`. Optional `.title` span; `.compact`, `.bare` (no icon). Course blocks of `type:'callout'` map `tone` 1:1 to these classes. `.disclaimer` is the dashed strip for the standing disclaimer inside cards.

### Lesson prose `.prose`

65ch measure, 15px / 1.65. Styles h2–h4, lists, `strong`, `em`, inline code, blockquote, tables, `dl`, figures. `.prose.wide` removes the measure. Companions: `.lesson-meta` (minutes, level pills), `.lesson-nav` (prev / next), `.toc` (module index with `li.done` ✓ and `a.active`). `<details>` is styled as a collapsible with a ▸ marker.

### Chart panes `.pane`

`.pane.price` 420px, `.pane.sub` 130px (RSI, MACD), `.pane.lesson-chart` 260px. `.tag` is the top-left label, `.drawhint` top-right, `.overlay` a centred message (loading / error). `.legend .sw` swatches and `.caption` for lesson charts.

### Modal

Either a `<div class="modal-backdrop" hidden><div class="modal" role="dialog" aria-modal="true">…</div></div>` or a native `<dialog class="modal">`. Inside: `header` (title + `.close`), body, `footer` (actions, right-aligned). `.modal.wide` for 900px. On phones it becomes a bottom sheet. Add `body.modal-open` to lock scroll.

### Toast

Container `.toasts` fixed at the bottom centre. Each `.toast` has an accent left edge; `.ok`, `.warn`, `.err`. Add `.leaving` before removal for the exit animation.

```js
function toast(msg, kind){ const el=document.createElement('div'); el.className='toast '+(kind||''); el.innerHTML='<div class="t-body">'+msg+'</div>'; document.getElementById('toasts').appendChild(el); setTimeout(()=>{el.classList.add('leaving'); setTimeout(()=>el.remove(),200)},3500); }
```

### Misc

`.tabs` / `.tabpanel`, `.skeleton` (loading shimmer), `.empty` (empty state), `.certificate` (course certificate `<img>`), `.plan` (pricing card), utilities `.mt-* .mb-* .center .right .nowrap .truncate .hide-sm .show-sm .muted .faint .up .down`.

## 7. Charts

Lightweight-charts cannot read CSS variables, so chart code reads tokens at runtime:

```js
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
chart.applyOptions({ layout:{ background:{type:'solid', color:css('--panel')}, textColor:css('--muted'), fontFamily:css('--mono') },
                     grid:{ vertLines:{color:css('--line')}, horzLines:{color:css('--line')} } });
```

Re-apply after a theme toggle (listen for clicks on `#theme` or a `MutationObserver` on `<html>[data-theme]`, plus `matchMedia('(prefers-color-scheme: light)').addEventListener('change', …)`). Candle up/down = `--up` / `--down`; overlays follow the `--s1…--s6` order in §3.

## 8. Accessibility & motion

- Focus is always visible: 2px accent outline on every interactive element.
- Colour is never the only signal: pills carry text, quiz options carry ✓/✕, signals carry the word BUY/SELL/HOLD.
- Contrast: all text tokens meet WCAG AA on their surfaces in both themes (`--muted` on `--panel` ≈ 5:1 dark, ≈ 5.5:1 light).
- Touch targets in the nav and quiz options are at least 36px tall; buttons are 30px minimum and may be enlarged with `.lg`.
- `prefers-reduced-motion: reduce` disables animations and transitions globally.
- Print styles turn the theme light, hide the nav and buttons, and keep cards intact for printing lessons and certificates.

## 9. Do / don't

**Do**

- Use `--up` / `--down` only for direction and buy/sell semantics.
- Put every number in `.num` (or a mono context) so columns align.
- Keep the demo pill and disclaimer visible whenever prices are shown.
- Add new tokens to `:root` **and** both light-theme blocks.

**Don't**

- Introduce a second accent colour or a new font.
- Hard-code hex colours in HTML or JS (read tokens with `css('--x')`).
- Use red/green for generic success/error toasts about non-trading things; prefer `.toast.ok` sparingly and neutral info toasts otherwise.
- Create page-level styles that duplicate a component here; extend `css/style.css` instead and document the addition in this file.
