# Broward Trading on your phone

Broward Trading is built phone-first. This guide covers installing it as an app on iPhone and Android, what works offline, how to use the charts and the order ticket on a small screen, and what to do when something does not look right.

The whole site, including the installed app, is still an educational simulator: no real orders, no real money, demo prices are simulated.

---

## 1. Install it

The site is a **progressive web app (PWA)**: a website that your phone can keep on the home screen with its own icon, open full-screen without browser bars, and run offline. There is nothing in the App Store or Play Store, and nothing to pay. You install it from the browser.

You need the site's **https://** address (for example `https://<user>.github.io/broward-trading/`). Installing does not work from a file opened directly or from a plain `http://` address, except `localhost` while developing.

### iPhone and iPad (Safari)

1. Open the site in **Safari**. Other browsers on iOS cannot add web apps to the home screen in most versions; if you are in Chrome or Firefox, copy the address into Safari.
2. Tap the **Share** button (the square with an arrow pointing up; at the bottom on iPhone, top right on iPad).
3. Scroll the sheet and tap **Add to Home Screen**. If you do not see it, scroll the action list further down or tap **Edit Actions** and enable it.
4. The name is pre-filled as "Broward Trading". Tap **Add**.
5. Find the icon on your home screen and open it. It launches full-screen with the bottom tab bar.

Notes for iOS:

- Open the installed app at least once while online so the service worker can save the app shell for offline use.
- iOS keeps the installed app's storage separate from Safari's. Progress you made in Safari before installing does not carry over automatically; export it first (Learn → certificate view → Export JSON; Journal → Export) and import it in the app, or just start fresh if you had not done much.
- iOS may clear a web app's storage after a long period of not opening it (typically weeks). Open the app now and then, and export your journal and progress occasionally.
- Browser notifications for alerts work on iOS 16.4 and later **only** from the installed home-screen app, not from a Safari tab, and only after you tap **Allow** when the app asks.

### Android (Chrome, Edge, Samsung Internet, Brave)

1. Open the site in Chrome (or another Chromium browser).
2. Either:
   - tap the **three-dot menu → Install app** (or **Add to Home screen**), or
   - tap **More** in the app's bottom tab bar and then **Install app**. This button only appears when the browser is ready to offer an install, so if it is missing use the browser menu.
3. Confirm **Install**. Android adds the icon to your home screen and app drawer and may show it in the app switcher like a native app.

Notes for Android:

- Chrome sometimes shows a small "Add Broward Trading to Home screen" banner on its own; tapping it does the same thing.
- Firefox for Android: three-dot menu → **Install**, or **Add to Home screen** on older versions.
- The installed app shares storage with the browser you installed from, so progress carries over.

### Desktop, for completeness

Chrome and Edge show an install icon in the address bar; Safari on macOS 14+ has **File → Add to Dock**. Everything in this guide applies, minus the tab bar.

## 2. What you get

- **An icon and a full-screen window.** No address bar; the app's own tab bar at the bottom: Dashboard, Learn, Replay, Portfolio, More.
- **Shortcuts.** Long-press the icon (Android) for jump links to Dashboard, Learn, Market Replay and Portfolio.
- **Offline.** The pages, styles, scripts, course lessons, drills, glossary and question bank are saved on first use. Demo prices are generated on your phone, so the dashboard, portfolio, backtester, Replay and course all work with no connection. Only live market data, the News page and the optional sign-in need the internet.
- **Updates.** When a new version of the site is published, the app fetches it in the background and shows a one-time "update ready" prompt with a Reload button. You can also close the app fully and reopen it.
- **Your data stays on the phone.** Portfolio, journal, course progress, alerts and settings are stored in the browser's local storage on this device. Nothing is uploaded unless you sign in to the optional Pro backend or opt in to a classroom leaderboard.

## 3. Using it on a small screen

**Navigation**

- The **bottom tab bar** has the four pages you use most. **More** opens a sheet with every other page (Backtest, Journal, News, Compare, Glossary, Pro, Verify, About), the dark / light switch and the Install button.
- Every page can be reached by a link too, which is how lessons send you to exercises: `index.html#symbol=NVDA&interval=1h&ov=sma20,bb&pane=rsi`, `replay.html#drill=sma-cross-msft-2024`, `journal.html#new`.

**Charts**

- **Pinch** to zoom the time axis, **drag** to pan, **tap and hold** a candle to see its open, high, low, close and volume in the legend.
- Panels (overlays, oscillators, signal, alerts, watchlist, trade ticket) **collapse**: tap a panel header to fold it. Keep one or two open at a time.
- Turn on **one** oscillator pane on a phone. Two panes plus the main chart leaves very little height for the candles.
- Landscape gives you more chart width. The layout adapts; the tab bar stays.

**Trading**

- The **trade ticket** is a form with 44 px tap targets. Fill side, quantity, type, and for limit / stop orders the prices, then confirm. Market orders fill at the price you see; limit and stop orders rest in **Portfolio → Open orders** until a bar touches them.
- Set the stop **in the same step** as the entry. The risk lessons say why; the order ticket makes it easy to forget.
- Market Replay has large **Step / Play / Pause** controls. Use **Play** at speed to reach the interesting part, **Pause**, then **Step** one bar at a time while you decide.

**Reading and quizzes**

- Lessons are short screens; quizzes are one question per card. Terms with a dotted underline are glossary tooltips: tap to read, tap elsewhere to close.
- **Daily 5** on the Glossary page takes two minutes and keeps a streak. **Flashcards** work well in a queue.

**Alerts and notifications**

- Alerts are set on the dashboard (Alerts panel) and are checked while the dashboard is open. Grant notification permission when asked if you want a system notification; otherwise you get an in-page message.
- Alerts run in your browser; they are not a server-side service and they do not run while the app is closed. They are a learning tool, not a product.

**Theme and battery**

- Dark is the default and uses less power on OLED screens. **More → theme** switches to light. The choice is remembered.

## 4. Keep your data safe

Everything lives on the phone. Three things can erase it: clearing the browser's site data, uninstalling the app (Android), or iOS cleaning up an app you have not opened in weeks.

- **Course progress**: Learn → certificate view → **Export JSON**. Import it on the same screen on another device.
- **Journal**: Journal → **Export** as JSON or CSV.
- **Portfolio**: not exportable yet (on the roadmap). The journal export keeps a copy of every fill, so your trade history is not lost even if the account is reset.
- **Certificate**: download the PNG or long-press the image to save it. A browser-issued certificate id (`BT-YYYY-L…`) can only be verified on the device that issued it; a server-verified id (when the site runs the optional backend) can be checked anywhere at `verify.html`.

Do this at the end of each week if you are taking the course for credit.

## 5. Live data on a phone

Demo mode needs nothing. If you want real prices, open Dashboard → **Data settings**, choose a provider and paste your own free API key. The key is stored on your phone only and sent directly to that provider. Mobile data use is modest: one chart load is one request and responses are cached for 60 seconds (intraday) or 10 minutes (daily). The free-tier limits in the README still apply, and on a phone you notice them sooner because you check more often. The app falls back to demo data, with a visible badge, when a limit is hit.

The service worker never stores market data, so what you see is never older than the in-page cache described above.

## 6. Troubleshooting

| Problem | What is happening | Fix |
|---|---|---|
| No "Add to Home Screen" on iPhone | Not in Safari, or the action is hidden | Open the address in Safari; scroll the share sheet; **Edit Actions** to enable it |
| No "Install app" in the More sheet (Android) | The browser has not offered an install yet, or the app is already installed | Use the browser's three-dot menu → Install app; check the app drawer |
| Install option missing everywhere | The site is not served over HTTPS, or the manifest did not load | Check the address starts with `https://`; try again after the page has fully loaded once |
| The app opens but lessons, drills or glossary say they cannot load | First open was offline, or the course files are not reachable | Connect to the internet, open Learn once, then it works offline |
| Old version keeps showing after an update | The saved app shell is still in use | Tap Reload on the "update ready" prompt; or close the app completely and reopen it twice |
| Progress disappeared after installing on iPhone | iOS keeps Safari and the home-screen app separate | Export from Safari (Learn → certificate → Export JSON; Journal → Export) and import in the app |
| Progress disappeared after weeks away (iPhone) | iOS cleared the web app's storage | Restore from your last export; open the app regularly |
| Notifications never arrive | Permission not granted, or on iOS not using the installed app | Allow notifications when asked; on iOS use the home-screen app, iOS 16.4+ |
| Chart is blank | The chart library did not load from the CDN and the fallback failed, or a very old browser | Reload once online; the app carries a local copy of the chart library. Update the browser if it is more than two years old |
| Horizontal scrolling or tiny text | Browser zoom or a very old browser | Reset zoom (pinch); update the browser. The layout is checked at 390 px wide |
| Live data always shows the demo badge | No key, key over its daily limit, or no connection | Dashboard → Data settings; read the reason shown; see `docs/DATA_SOURCES.md` |
| "Sign in" says the backend is not configured | The site owner has not deployed the optional server | Expected. Everything else works; sign-in is only for Pro and server-verified certificates |

## 7. Uninstall

- **iPhone**: long-press the icon → Remove App → Delete. This also deletes the app's storage; export first.
- **Android**: long-press → Uninstall, or drag to Uninstall. Storage is shared with the browser, so your data stays in Chrome until you clear site data.

## 8. For site owners

- The installable behaviour comes from `manifest.json` (name, colours, icons, shortcuts, `start_url: index.html`, `scope: ./`) and `sw.js` (precached app shell, network-only for market data and the API), both injected by `js/nav.js`. Icons are in `icons/`.
- The site must be served over HTTPS. GitHub Pages does this by default (`docs/DEPLOY.md`).
- When you change a precached file and need users to get it at once, bump `VERSION` in `sw.js`. Users see the "update ready" prompt on their next visit.
- If you move the site to a new domain, installed apps keep pointing at the old one. Tell users to reinstall from the new address.
- Test at 390 × 844 in desktop DevTools before every release: no horizontal scroll, tap targets at least 44 px, the tab bar does not cover content (the body gets `has-tabbar` and bottom padding on phones).
