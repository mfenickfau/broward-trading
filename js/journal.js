/* Broward Trading — js/journal.js → BT.journal
 *
 * The trading journal engine. Nothing here touches the DOM: journal.html is
 * the UI. State is persisted in localStorage under `bt.journal`.
 *
 * Why a journal (what this module teaches)
 *   A paper account tells you *what* happened: fills, P&L, a win rate. It
 *   cannot tell you *why*: which setup you were trading, how confident you
 *   were, whether you were bored, scared or revenge-trading, and what you
 *   would do differently. Those are the variables a trader actually controls,
 *   and they only become visible when every trade is written down and the
 *   notes are grouped. Group 40 trades by setup and one line usually pays
 *   for the rest; group them by emotion and "FOMO" is usually red. That is
 *   the whole point: a journal turns a stream of outcomes into a dataset
 *   about your own decisions.
 *
 * Entry shape (CONTRACTS.md v0.3)
 *   {id, tradeId?, symbol, date, setup, tags[], emotion, confidence 1-5,
 *    notes, lessons, rating 1-5}
 *   plus bookkeeping this module adds:
 *   source   'paper' (auto-synced fill) | 'manual' | 'replay' (js/replay.js)
 *   account  paper account id the fill came from ('main', 'replay', ...)
 *   trade    {side, qty, price, realized, closedQty, openedQty, kind, time,
 *             role:'open'|'close'|'reverse', value} — the fill, copied so the
 *             entry survives an account reset
 *   pnl      realized P&L of a closing fill (null for opening fills and for
 *            manual entries without a P&L)
 *   createdAt, updatedAt (ms)
 *
 * Auto-sync: sync() reads every paper account (BT.paper.accounts() plus each
 * account's saved state, always from localStorage so fills placed in another
 * tab are seen) and creates one entry per fill, keyed by
 * tradeId = '<account>:<generation>:<trade.id>' where generation is the paper
 * account's createdAt. paper.js restarts trade ids at 1 on every reset, so the
 * generation is what keeps a fill from one account lifetime distinct from the
 * same-numbered fill after a Reset-account or the next Market Replay session.
 * Pre-v0.3.1 keys ('<account>:<trade.id>') are migrated on the first sync when
 * the copied fill (symbol, time, side, qty, price) still matches. Student edits
 * are never overwritten: re-syncing only refreshes the copied `trade` block.
 * Deleting a synced entry remembers the tradeId so the fill does not come back
 * on the next sync.
 *
 * Replay P&L is counted once: js/replay.js saves one scorecard entry per
 * session (pnl = equity − startingCash, open position included), so the fills
 * synced from the 'replay' paper account are journaled for annotation with
 * pnl = null (their realized figure stays in `trade.realized`). Otherwise every
 * replay round trip would enter the totals twice.
 *
 * Stored shape: {version:1, entries:[], reviews:{weekKey:{...}}, hidden:[]}.
 * js/replay.js may create the key first as a plain array of entries or push
 * into `entries`; load() accepts both.
 *
 * Plain ES2020, no imports, loadable in Node with a `window` shim (tests/journal.test.js).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BT = root.BT = root.BT || {};

  var STORAGE_KEY = 'bt.journal';
  var VERSION = 1;
  var MAX_ENTRIES = 5000;
  var MAX_TEXT = 4000;
  var MAX_TAGS = 20;
  // Paper account used by js/replay.js; its fills never carry P&L in the journal (see header).
  function replayAccountId() { return BT.replay && typeof BT.replay.ACCOUNT === 'string' ? BT.replay.ACCOUNT : 'replay'; }
  function isReplayFill(source, account) { return source === 'paper' && account === replayAccountId(); }

  /* ------------------------------------------------------------------ *
   * Reference data: emotions, setups, review checklist, educational copy
   * ------------------------------------------------------------------ */
  var EMOTIONS = [
    { id: 'calm',      label: 'Calm',      tone: 'good', help: 'Followed the plan without urgency. The state you want to be in for every decision.' },
    { id: 'confident', label: 'Confident', tone: 'good', help: 'Clear thesis, sized correctly. Healthy when it is earned by preparation, dangerous after a winning streak.' },
    { id: 'hesitant',  label: 'Hesitant',  tone: 'neutral', help: 'Saw the setup but waited. Late entries worsen the risk/reward of a good idea.' },
    { id: 'bored',     label: 'Bored',     tone: 'warn', help: 'Traded because nothing was happening. Boredom trades rarely have an edge.' },
    { id: 'fomo',      label: 'FOMO',      tone: 'bad', help: 'Chased a move that had already happened because you did not want to miss it. Usually the worst-performing tag in any journal.' },
    { id: 'anxious',   label: 'Anxious',   tone: 'warn', help: 'Position felt too big or the thesis unclear. Often a sign the size, not the idea, was wrong.' },
    { id: 'greedy',    label: 'Greedy',    tone: 'bad', help: 'Held past the target or added size without a reason. Giving back open profit is a common pattern here.' },
    { id: 'revenge',   label: 'Revenge',   tone: 'bad', help: 'Traded to win back a loss. The market does not know you lost; the next trade must stand on its own.' },
    { id: 'tired',     label: 'Tired',     tone: 'warn', help: 'Low energy or distracted. Attention is part of risk management.' }
  ];
  var EMOTION_IDS = EMOTIONS.map(function (e) { return e.id; });

  var SETUPS = [
    'Trend pullback', 'Breakout', 'Breakdown (short)', 'Mean reversion', 'SMA crossover', 'RSI oversold bounce',
    'RSI overbought fade', 'MACD cross', 'Bollinger bounce', 'Support bounce', 'Resistance rejection', 'Gap fill',
    'Earnings play', 'News reaction', 'Range trade', 'Options: covered call', 'Options: protective put', 'Options: spread', 'No setup (impulse)'
  ];

  var TAG_SUGGESTIONS = ['daily', 'intraday', 'swing', 'long', 'short', 'followed-plan', 'broke-rules', 'stop-hit', 'target-hit',
    'moved-stop', 'oversized', 'undersized', 'early-exit', 'late-entry', 'good-exit', 'news', 'earnings', 'trend', 'range', 'options'];

  var REVIEW_CHECKLIST = [
    { id: 'all_logged',   text: 'Every trade this week has a setup and an emotion filled in',
      why: 'An unlabelled trade cannot be grouped, so it teaches nothing. Five minutes of tagging makes the stats below meaningful.' },
    { id: 'plan',         text: 'I followed my written plan on every trade (or tagged the ones where I did not)',
      why: 'The goal is not a perfect week; it is knowing exactly which trades were outside the plan, so you can see what they cost.' },
    { id: 'sizing',       text: 'No single trade risked more than my per-trade limit',
      why: 'Position size decides whether a normal losing streak is survivable. Check it weekly, before the streak.' },
    { id: 'stops',        text: 'Every position had a stop or an exit rule before entry, and I did not move stops further away',
      why: 'Moving a stop away converts a small planned loss into an unplanned large one. It is the single most expensive habit in most journals.' },
    { id: 'best_worst',   text: 'I re-read my best and worst trade and wrote one lesson from each',
      why: 'The best trade shows what to repeat; the worst shows what to stop. Both are more useful than the average.' },
    { id: 'stats',        text: 'I looked at the stats by setup and by emotion, not just the total P&L',
      why: 'Total P&L mixes luck with skill. The breakdown shows where the edge is, and where the leaks are.' },
    { id: 'next_week',    text: 'I wrote one specific thing to do differently next week',
      why: 'One change you can actually check ("no entries in the first 15 minutes") beats five vague ones.' }
  ];

  var REVIEW_QUESTIONS = [
    { id: 'went_well',  label: 'What went well this week?',           placeholder: 'A trade, a decision, a habit you kept. Be specific.' },
    { id: 'mistakes',   label: 'What mistakes did I repeat?',          placeholder: 'Look at the emotion and tag stats. Which red line keeps showing up?' },
    { id: 'best_setup', label: 'Which setup is working, and which is not?', placeholder: 'Use the Setup breakdown. Would you keep trading the worst one?' },
    { id: 'next_week',  label: 'One thing I will do differently next week', placeholder: 'A rule you can check next Friday: yes or no.' }
  ];

  var WHY = {
    title: 'Why journaling improves traders',
    intro: 'Your paper account records what happened. Only a journal records why. Writing down the setup, your confidence and your emotional state for every trade turns a stream of wins and losses into a dataset about your own decisions, the one thing you actually control.',
    points: [
      { title: 'It separates luck from skill', text: 'A single trade\'s outcome is mostly noise. Forty trades grouped by setup show which ideas have an edge and which only felt like they did. Expectancy per setup is the number that matters, not the last P&L.' },
      { title: 'It makes emotions measurable', text: 'Tag each trade with how you felt. Most journals show the same picture: calm, planned trades are profitable; FOMO, revenge and boredom trades are not. Seeing it in your own numbers changes behaviour faster than any lecture.' },
      { title: 'It catches process errors early', text: 'Moving a stop, oversizing, chasing a late entry: each is cheap once and ruinous as a habit. The weekly review puts them in front of you while the sample is still small.' },
      { title: 'It builds a plan you believe in', text: 'Lessons written after real (paper) losses stick. Over a few months the "lessons" field becomes your personal trading plan, written in evidence rather than theory.' }
    ],
    howTo: [
      'Journal every trade, not just the interesting ones. The boring losers are where the pattern hides.',
      'Fill in the setup and emotion the same day, while you still remember how it felt.',
      'Rate the decision (1-5), not the result. A good decision can lose; a bad one can win.',
      'Review weekly. Read the breakdowns, answer the four questions, pick one change.'
    ]
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function cents(v) { return Math.round(v * 100) / 100; }
  function clampInt(v, lo, hi, d) { v = Math.round(Number(v)); return isNum(v) && v >= lo && v <= hi ? v : d; }
  function str(v, max) { return String(v == null ? '' : v).slice(0, max || MAX_TEXT); }
  function normSymbol(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 24); }
  function normTag(t) {
    return String(t == null ? '' : t).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_:.\-]/g, '').replace(/^-+|-+$/g, '').slice(0, 32);
  }
  function normTags(list) {
    var out = [];
    (Array.isArray(list) ? list : String(list == null ? '' : list).split(/[,\n]/)).forEach(function (t) {
      var n = normTag(t);
      if (n && out.indexOf(n) === -1 && out.length < MAX_TAGS) out.push(n);
    });
    return out;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // Local-calendar day for a wall-clock ms timestamp (the student's day, matching paper.js).
  function dayOf(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function parseDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function addDays(dayStr, n) { var d = parseDay(dayStr); d.setDate(d.getDate() + n); return dayOf(d.getTime()); }

  var clock = function () { return Date.now(); };
  function now() { return clock(); }
  function todayStr() { return dayOf(now()); }
  var seq = 0;
  function newId(prefix) { return (prefix || 'j') + '-' + now().toString(36) + '-' + (++seq).toString(36); }

  var storage = {
    get: function () {
      try { var ls = root.localStorage; if (!ls) return null; var raw = ls.getItem(STORAGE_KEY); return raw == null ? null : JSON.parse(raw); }
      catch (e) { return null; }
    },
    set: function (v) { try { var ls = root.localStorage; if (!ls) return false; ls.setItem(STORAGE_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } },
    getRaw: function (key) {
      try { var ls = root.localStorage; if (!ls) return null; var raw = ls.getItem(key); return raw == null ? null : JSON.parse(raw); }
      catch (e) { return null; }
    }
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  function freshState() { return { version: VERSION, entries: [], reviews: {}, hidden: [], updatedAt: 0 }; }
  var state = freshState();

  /** normalizeEntry(obj) → a clean entry or null when nothing usable is there. */
  function normalizeEntry(e, existing) {
    if (!e || typeof e !== 'object') return null;
    var base = existing || {};
    var tradeIn = e.trade && typeof e.trade === 'object' ? e.trade : null;
    var trade = tradeIn ? {
      side: tradeIn.side === 'sell' ? 'sell' : (tradeIn.side === 'buy' ? 'buy' : null),
      qty: isNum(tradeIn.qty) ? tradeIn.qty : null,
      price: isNum(tradeIn.price) ? tradeIn.price : null,
      realized: isNum(tradeIn.realized) ? tradeIn.realized : null,
      closedQty: isNum(tradeIn.closedQty) ? tradeIn.closedQty : 0,
      openedQty: isNum(tradeIn.openedQty) ? tradeIn.openedQty : 0,
      kind: tradeIn.kind === 'option' ? 'option' : 'stock',
      time: isNum(tradeIn.time) ? tradeIn.time : null,
      role: ['open', 'close', 'reverse'].indexOf(tradeIn.role) !== -1 ? tradeIn.role : (tradeIn.closedQty > 0 ? 'close' : 'open'),
      value: isNum(tradeIn.value) ? tradeIn.value : null
    } : (base.trade || null);
    var source = ['paper', 'manual', 'replay'].indexOf(e.source) !== -1 ? e.source : (base.source || (e.tradeId ? 'paper' : 'manual'));
    var account = typeof e.account === 'string' && e.account ? e.account.slice(0, 32) : (base.account || null);
    var pnl = isNum(e.pnl) ? cents(e.pnl) : (e.pnl === null ? null : (isNum(base.pnl) ? base.pnl : null));
    if (pnl == null && trade && trade.closedQty > 0 && isNum(trade.realized)) pnl = trade.realized;
    if (isReplayFill(source, account)) pnl = null;   // the session scorecard carries the P&L
    var date = isDay(e.date) ? e.date.slice(0, 10) : (isDay(base.date) ? base.date : (trade && isNum(trade.time) ? dayOf(trade.time) : todayStr()));
    var out = {
      id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : (typeof e.id === 'number' ? String(e.id) : (base.id || newId())),
      tradeId: typeof e.tradeId === 'string' && e.tradeId ? e.tradeId.slice(0, 96) : (base.tradeId || null),
      account: account,
      source: source,
      symbol: normSymbol(e.symbol != null ? e.symbol : base.symbol) || (base.symbol || ''),
      date: date,
      setup: str(e.setup != null ? e.setup : base.setup, 120).trim(),
      tags: normTags(e.tags != null ? e.tags : base.tags),
      emotion: EMOTION_IDS.indexOf(e.emotion) !== -1 ? e.emotion : (typeof e.emotion === 'string' && e.emotion ? normTag(e.emotion) : (base.emotion || '')),
      confidence: clampInt(e.confidence, 1, 5, clampInt(base.confidence, 1, 5, 3)),
      notes: str(e.notes != null ? e.notes : base.notes).trim(),
      lessons: str(e.lessons != null ? e.lessons : base.lessons).trim(),
      rating: clampInt(e.rating, 1, 5, clampInt(base.rating, 1, 5, 3)),
      pnl: pnl,
      trade: trade,
      createdAt: isNum(e.createdAt) ? e.createdAt : (isNum(base.createdAt) ? base.createdAt : now()),
      updatedAt: isNum(e.updatedAt) ? e.updatedAt : now()
    };
    // Replay entries carry a compact scorecard; keep it and make it count as a P&L-bearing trade.
    if (e.replay && typeof e.replay === 'object') {
      out.replay = e.replay;
      if (out.pnl == null && isNum(e.replay.equity) && isNum(e.replay.startingCash)) out.pnl = cents(e.replay.equity - e.replay.startingCash);
    } else if (base.replay) out.replay = base.replay;
    if (!out.symbol && !out.setup && !out.notes && !out.lessons && !out.trade && !out.replay) return null;
    return out;
  }

  function sanitize(saved) {
    var s = freshState();
    var list = null;
    if (Array.isArray(saved)) list = saved;                               // legacy / replay-created array
    else if (saved && typeof saved === 'object') {
      list = Array.isArray(saved.entries) ? saved.entries : [];
      if (saved.reviews && typeof saved.reviews === 'object') {
        Object.keys(saved.reviews).forEach(function (k) { var r = normalizeReview(saved.reviews[k]); if (r && isWeekKey(k)) s.reviews[k] = r; });
      }
      if (Array.isArray(saved.hidden)) s.hidden = saved.hidden.filter(function (x) { return typeof x === 'string'; }).slice(0, MAX_ENTRIES);
      if (isNum(saved.updatedAt)) s.updatedAt = saved.updatedAt;
    }
    var seen = {};
    (list || []).forEach(function (e) {
      var n = normalizeEntry(e);
      if (n && !seen[n.id]) { seen[n.id] = true; s.entries.push(n); }
    });
    if (s.entries.length > MAX_ENTRIES) s.entries = s.entries.slice(-MAX_ENTRIES);
    return s;
  }

  function load() { state = sanitize(storage.get()); return state; }
  function save() { state.updatedAt = now(); return storage.set(state); }
  function reset() { state = freshState(); save(); return state; }
  function getState() { return state; }

  /* ------------------------------------------------------------------ *
   * CRUD
   * ------------------------------------------------------------------ */
  function findIndex(id) { for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) return i; return -1; }
  function get(id) { var i = findIndex(id); return i === -1 ? null : state.entries[i]; }

  /** add(entry) → the stored entry. Manual entries default to source 'manual'. */
  function add(entry) {
    var e = normalizeEntry(Object.assign({ source: 'manual' }, entry || {}, { id: entry && entry.id ? entry.id : newId() }));
    if (!e) return null;
    if (findIndex(e.id) !== -1) e.id = newId();
    e.createdAt = e.updatedAt = now();
    state.entries.push(e);
    if (state.entries.length > MAX_ENTRIES) state.entries.splice(0, state.entries.length - MAX_ENTRIES);
    save();
    return e;
  }

  /** update(id, patch) → the updated entry or null. Only the fields in patch change. */
  function update(id, patch) {
    var i = findIndex(id);
    if (i === -1 || !patch || typeof patch !== 'object') return null;
    var cur = state.entries[i];
    var merged = normalizeEntry(Object.assign({}, patch, { id: cur.id, tradeId: cur.tradeId, account: cur.account, source: cur.source, createdAt: cur.createdAt, updatedAt: now() }), cur);
    if (!merged) return null;
    if (patch.trade === undefined) merged.trade = cur.trade;
    if (patch.replay === undefined && cur.replay) merged.replay = cur.replay;
    state.entries[i] = merged;
    save();
    return merged;
  }

  /** remove(id) → true when something was deleted. A synced fill is remembered so sync() does not recreate it. */
  function remove(id) {
    var i = findIndex(id);
    if (i === -1) return false;
    var e = state.entries[i];
    if (e.tradeId && state.hidden.indexOf(e.tradeId) === -1) state.hidden.push(e.tradeId);
    state.entries.splice(i, 1);
    save();
    return true;
  }

  /** entries() → copy sorted newest first (by date, then trade time, then createdAt). */
  function entries(filters) {
    var list = state.entries.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      var ta = a.trade && isNum(a.trade.time) ? a.trade.time : a.createdAt, tb = b.trade && isNum(b.trade.time) ? b.trade.time : b.createdAt;
      return tb - ta;
    });
    return filters ? filter(list, filters) : list;
  }

  /* ------------------------------------------------------------------ *
   * Sync from BT.paper (every account)
   * ------------------------------------------------------------------ */
  function roleOf(t) { return t.closedQty > 0 && t.openedQty > 0 ? 'reverse' : (t.closedQty > 0 ? 'close' : 'open'); }

  /**
   * accountState(paper, accountId) → {createdAt, trades[]}
   * Always prefers the persisted state: paper.js saves on every mutation, so
   * localStorage is the source of truth and also reflects fills placed in
   * another tab (Dashboard, Replay) that this tab's in-memory copy has not
   * loaded. The in-memory state is only a fallback for the active account when
   * storage is unavailable (private mode) or empty.
   */
  function accountState(paper, accountId) {
    var key = paper.storageKeyFor ? paper.storageKeyFor(accountId) : (accountId === 'main' ? 'bt.portfolio' : 'bt.portfolio.' + accountId);
    var st = storage.getRaw(key);
    if (!(st && Array.isArray(st.trades)) && paper.account && paper.account() === accountId && paper.getState) st = paper.getState();
    if (!st || typeof st !== 'object') return { createdAt: 0, trades: [] };
    return { createdAt: isNum(st.createdAt) ? st.createdAt : 0, trades: Array.isArray(st.trades) ? st.trades.slice() : [] };
  }
  function tradesOf(paper, accountId) { return accountState(paper, accountId).trades; }

  /** A legacy '<account>:<id>' entry belongs to this fill only when the copied fill is identical. */
  function sameFill(entry, t, block) {
    var b = entry && entry.trade;
    return !!b && entry.symbol === normSymbol(t.symbol) && b.side === block.side && b.qty === block.qty && b.price === block.price &&
      (b.time === block.time || !isNum(b.time));
  }

  function autoTags(t, accountId) {
    var tags = ['paper', accountId];
    if (t.kind === 'option') tags.push('options');
    var role = roleOf(t);
    if (role === 'open') tags.push(t.side === 'buy' ? 'long' : 'short');
    else {
      tags.push(t.side === 'sell' ? 'long' : 'short');  // selling closes a long; buying closes a short
      if (t.realized > 0) tags.push('winner'); else if (t.realized < 0) tags.push('loser'); else tags.push('scratch');
    }
    return tags;
  }

  /**
   * sync(paper = BT.paper) → {added, updated, accounts}
   * Creates one entry per paper fill across every account; refreshes the copied
   * trade block of existing synced entries (never the student's notes/tags).
   */
  function sync(paper) {
    paper = paper || BT.paper;
    var result = { added: 0, updated: 0, accounts: [] };
    if (!paper) return result;
    var ids = [];
    try { ids = (paper.accounts ? paper.accounts() : []).map(function (a) { return a.id; }); } catch (e) { ids = []; }
    if (ids.indexOf('main') === -1) ids.unshift('main');
    var byTrade = {};
    state.entries.forEach(function (e) { if (e.tradeId) byTrade[e.tradeId] = e; });
    var changed = false;
    ids.forEach(function (acc) {
      var st = accountState(paper, acc);
      var trades = st.trades, gen = st.createdAt;
      var noPnl = isReplayFill('paper', acc);
      result.accounts.push({ id: acc, trades: trades.length, createdAt: gen });
      trades.forEach(function (t) {
        if (!t || !isNum(t.id) || !isNum(t.qty) || !isNum(t.price)) return;
        var tradeId = acc + ':' + gen + ':' + t.id;
        var legacyId = acc + ':' + t.id;
        var block = {
          side: t.side, qty: t.qty, price: t.price, realized: isNum(t.realized) ? t.realized : 0,
          closedQty: isNum(t.closedQty) ? t.closedQty : 0, openedQty: isNum(t.openedQty) ? t.openedQty : 0,
          kind: t.kind === 'option' ? 'option' : 'stock', time: isNum(t.time) ? t.time : now(), role: roleOf(t), value: isNum(t.value) ? t.value : cents(t.qty * t.price)
        };
        var fillPnl = noPnl ? null : (block.closedQty > 0 ? block.realized : null);
        var existing = byTrade[tradeId];
        // One-time migration of a pre-generation key: only when it is demonstrably the same fill.
        if (!existing && byTrade[legacyId] && sameFill(byTrade[legacyId], t, block)) {
          existing = byTrade[legacyId];
          delete byTrade[legacyId];
          existing.tradeId = tradeId; byTrade[tradeId] = existing;
          changed = true;
        }
        if (state.hidden.indexOf(tradeId) !== -1) return;
        var hiddenLegacy = state.hidden.indexOf(legacyId);
        if (!existing && hiddenLegacy !== -1) {
          // A legacy hidden key is assumed to belong to the generation seen first; pin it so later generations are not hidden too.
          state.hidden[hiddenLegacy] = tradeId; changed = true;
          return;
        }
        if (existing) {
          if (JSON.stringify(existing.trade) !== JSON.stringify(block) || (noPnl && existing.pnl != null)) {
            existing.trade = block;
            existing.pnl = noPnl ? null : (block.closedQty > 0 ? block.realized : existing.pnl);
            changed = true; result.updated++;
          }
          return;
        }
        var entry = {
          id: 'tr-' + acc + '-' + gen.toString(36) + '-' + t.id, tradeId: tradeId, account: acc, source: 'paper',
          symbol: normSymbol(t.symbol), date: dayOf(block.time),
          setup: '', tags: autoTags(t, acc), emotion: '', confidence: 3,
          notes: t.note ? String(t.note) : '', lessons: '', rating: 3,
          pnl: fillPnl, trade: block, createdAt: now(), updatedAt: now()
        };
        if (findIndex(entry.id) !== -1) entry.id = newId('tr');
        var n = normalizeEntry(entry);
        if (n) { state.entries.push(n); byTrade[tradeId] = n; changed = true; result.added++; }
      });
    });
    if (changed) save();
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Filtering
   * ------------------------------------------------------------------ */
  /**
   * filter(list, f) with f = {account, symbol, tag, setup, emotion, outcome:'win'|'loss'|'closed'|'open',
   *   source, from:'YYYY-MM-DD', to:'YYYY-MM-DD', q (free text), reviewed:boolean (has setup & emotion), minRating}
   */
  function filter(list, f) {
    f = f || {};
    var q = f.q ? String(f.q).toLowerCase() : '';
    var sym = f.symbol ? normSymbol(f.symbol) : '';
    var tag = f.tag ? normTag(f.tag) : '';
    return list.filter(function (e) {
      if (f.account && e.account !== f.account) return false;
      if (sym && e.symbol !== sym) return false;
      if (tag && e.tags.indexOf(tag) === -1) return false;
      if (f.setup && e.setup !== f.setup) return false;
      if (f.emotion && e.emotion !== f.emotion) return false;
      if (f.source && e.source !== f.source) return false;
      if (f.from && e.date < f.from) return false;
      if (f.to && e.date > f.to) return false;
      if (f.outcome === 'win' && !(e.pnl > 0)) return false;
      if (f.outcome === 'loss' && !(e.pnl < 0)) return false;
      if (f.outcome === 'closed' && e.pnl == null) return false;
      if (f.outcome === 'open' && e.pnl != null) return false;
      if (f.reviewed === true && !(e.setup && e.emotion)) return false;
      if (f.reviewed === false && e.setup && e.emotion) return false;
      if (isNum(f.minRating) && e.rating < f.minRating) return false;
      if (q) {
        var hay = [e.symbol, e.setup, e.notes, e.lessons, e.emotion, e.tags.join(' '), e.account].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------------------------ *
   * Statistics
   * ------------------------------------------------------------------ */
  /**
   * summary(list) → {count, closed, wins, losses, scratches, winRate, total, avgPnl, avgWin, avgLoss,
   *   expectancy, profitFactor, best, worst, avgRating, avgConfidence, reviewedPct}
   * P&L figures use entries with a numeric pnl (closing fills, replay sessions, manual entries with a P&L).
   */
  function summary(list) {
    list = list || state.entries;
    var closed = list.filter(function (e) { return isNum(e.pnl); });
    var wins = closed.filter(function (e) { return e.pnl > 0; });
    var losses = closed.filter(function (e) { return e.pnl < 0; });
    var sum = function (a) { return a.reduce(function (s, e) { return s + e.pnl; }, 0); };
    var grossWin = sum(wins), grossLoss = -sum(losses), total = sum(closed);
    var avgWin = wins.length ? grossWin / wins.length : 0;
    var avgLoss = losses.length ? grossLoss / losses.length : 0;
    var winRate = closed.length ? wins.length / closed.length : null;
    var lossRate = closed.length ? losses.length / closed.length : null;
    // Expectancy per trade = P(win)·avgWin − P(loss)·avgLoss; the average dollars a trade "should" make.
    var expectancy = closed.length ? cents(winRate * avgWin - lossRate * avgLoss) : null;
    var reviewed = list.filter(function (e) { return e.setup && e.emotion; }).length;
    var mean = function (key) { return list.length ? list.reduce(function (s, e) { return s + e[key]; }, 0) / list.length : null; };
    return {
      count: list.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      scratches: closed.length - wins.length - losses.length,
      winRate: winRate == null ? null : Math.round(winRate * 1000) / 10,
      total: cents(total),
      avgPnl: closed.length ? cents(total / closed.length) : null,
      avgWin: cents(avgWin),
      avgLoss: cents(avgLoss),
      expectancy: expectancy,
      profitFactor: grossLoss > 0 ? Math.round(grossWin / grossLoss * 100) / 100 : (grossWin > 0 ? null : (closed.length ? 0 : null)),
      best: closed.reduce(function (b, e) { return b == null || e.pnl > b.pnl ? e : b; }, null),
      worst: closed.reduce(function (b, e) { return b == null || e.pnl < b.pnl ? e : b; }, null),
      avgRating: mean('rating') == null ? null : Math.round(mean('rating') * 10) / 10,
      avgConfidence: mean('confidence') == null ? null : Math.round(mean('confidence') * 10) / 10,
      reviewedPct: list.length ? Math.round(reviewed / list.length * 100) : 0
    };
  }

  /**
   * groupStats(list, by) with by = 'tag' | 'setup' | 'emotion' | 'symbol' | 'account' | 'weekday' | 'rating' | 'confidence'
   * → [{key, label, ...summary(group)}] sorted by total P&L descending, entries without a value under key '' are skipped
   * (except setup/emotion, where '(not set)' is kept so the student sees how much is unlabelled).
   */
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function keysOf(e, by) {
    switch (by) {
      case 'tag': case 'tags': return e.tags;
      case 'setup': return [e.setup || ''];
      case 'emotion': return [e.emotion || ''];
      case 'symbol': return [e.symbol || ''];
      case 'account': return [e.account || (e.source === 'replay' ? 'replay' : 'manual')];
      case 'weekday': var d = parseDay(e.date); return [d ? WEEKDAYS[d.getDay()] : ''];
      case 'rating': return [String(e.rating)];
      case 'confidence': return [String(e.confidence)];
      default: return [];
    }
  }
  function labelOf(key, by) {
    if (key === '') return '(not set)';
    if (by === 'emotion') { var em = EMOTIONS.filter(function (x) { return x.id === key; })[0]; return em ? em.label : key; }
    if (by === 'rating') return key + ' star' + (key === '1' ? '' : 's');
    if (by === 'confidence') return 'confidence ' + key;
    return key;
  }
  function groupStats(list, by) {
    list = list || state.entries;
    var groups = {};
    list.forEach(function (e) {
      keysOf(e, by).forEach(function (k) {
        if (k === '' && by !== 'setup' && by !== 'emotion') return;
        (groups[k] = groups[k] || []).push(e);
      });
    });
    return Object.keys(groups).map(function (k) {
      var s = summary(groups[k]);
      s.key = k; s.label = labelOf(k, by);
      return s;
    }).sort(function (a, b) { return b.total - a.total || b.count - a.count; });
  }

  /**
   * calendar(list, {weeks=26, end=today}) → {start, end, days:[{date, pnl, count, closed}], max}
   * One object per calendar day (oldest first) covering whole weeks (Sunday → Saturday), for the heatmap.
   */
  function calendar(list, opts) {
    list = list || state.entries;
    opts = opts || {};
    var weeks = clampInt(opts.weeks, 1, 104, 26);
    var end = isDay(opts.end) ? opts.end : todayStr();
    var endD = parseDay(end);
    // extend to Saturday so the last column is complete
    var endSat = addDays(end, 6 - endD.getDay());
    var start = addDays(endSat, -(weeks * 7 - 1));
    var byDay = {};
    list.forEach(function (e) {
      var d = byDay[e.date] = byDay[e.date] || { pnl: 0, count: 0, closed: 0 };
      d.count++;
      if (isNum(e.pnl)) { d.pnl = cents(d.pnl + e.pnl); d.closed++; }
    });
    var days = [], max = 0, cur = start;
    for (var i = 0; i < weeks * 7; i++) {
      var d = byDay[cur] || { pnl: 0, count: 0, closed: 0 };
      days.push({ date: cur, pnl: d.pnl, count: d.count, closed: d.closed });
      if (Math.abs(d.pnl) > max) max = Math.abs(d.pnl);
      cur = addDays(cur, 1);
    }
    return { start: start, end: endSat, days: days, max: max, weeks: weeks };
  }

  /** streaks(list) → {current:{kind:'win'|'loss'|null, n}, longestWin, longestLoss} over closed entries, oldest first. */
  function streaks(list) {
    var closed = (list || state.entries).filter(function (e) { return isNum(e.pnl) && e.pnl !== 0; }).slice().sort(function (a, b) {
      var ta = a.trade && isNum(a.trade.time) ? a.trade.time : Date.parse(a.date), tb = b.trade && isNum(b.trade.time) ? b.trade.time : Date.parse(b.date);
      return ta - tb;
    });
    var longestWin = 0, longestLoss = 0, run = 0, kind = null;
    closed.forEach(function (e) {
      var k = e.pnl > 0 ? 'win' : 'loss';
      if (k === kind) run++; else { kind = k; run = 1; }
      if (k === 'win') longestWin = Math.max(longestWin, run); else longestLoss = Math.max(longestLoss, run);
    });
    return { current: { kind: kind, n: run }, longestWin: longestWin, longestLoss: longestLoss };
  }

  /** tagSuggestions(list) → tags ordered by frequency in the journal, then the built-in suggestions. */
  function tagSuggestions(list) {
    var counts = {};
    (list || state.entries).forEach(function (e) { e.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var mine = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
    TAG_SUGGESTIONS.forEach(function (t) { if (mine.indexOf(t) === -1) mine.push(t); });
    return mine;
  }
  /** setupSuggestions(list) → setups used in the journal first, then the built-in list. */
  function setupSuggestions(list) {
    var counts = {};
    (list || state.entries).forEach(function (e) { if (e.setup) counts[e.setup] = (counts[e.setup] || 0) + 1; });
    var mine = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
    SETUPS.forEach(function (s) { if (mine.indexOf(s) === -1) mine.push(s); });
    return mine;
  }

  /* ------------------------------------------------------------------ *
   * Weekly review
   * ------------------------------------------------------------------ */
  // Week key = the Monday that starts the week, 'YYYY-MM-DD'.
  function weekKey(dateStr) {
    var d = parseDay(dateStr || todayStr()) || new Date(now());
    var dow = d.getDay();                        // 0 Sunday … 6 Saturday
    var back = dow === 0 ? 6 : dow - 1;          // days since Monday
    d.setDate(d.getDate() - back);
    return dayOf(d.getTime());
  }
  function isWeekKey(k) { return isDay(k) && weekKey(k) === k; }
  function weekRange(key) { key = weekKey(key); return { from: key, to: addDays(key, 6), key: key }; }

  function normalizeReview(r) {
    if (!r || typeof r !== 'object') return null;
    var out = { checks: {}, answers: {}, savedAt: isNum(r.savedAt) ? r.savedAt : now() };
    REVIEW_CHECKLIST.forEach(function (c) { if (r.checks && r.checks[c.id]) out.checks[c.id] = true; });
    REVIEW_QUESTIONS.forEach(function (q) { if (r.answers && typeof r.answers[q.id] === 'string' && r.answers[q.id].trim()) out.answers[q.id] = str(r.answers[q.id]).trim(); });
    return out;
  }
  /** getReview(weekKey) → {checks, answers, savedAt, done, total, complete} (blank when never saved). */
  function getReview(key) {
    key = weekKey(key);
    var r = state.reviews[key] || { checks: {}, answers: {}, savedAt: null };
    var done = REVIEW_CHECKLIST.filter(function (c) { return !!r.checks[c.id]; }).length;
    var answered = REVIEW_QUESTIONS.filter(function (q) { return !!r.answers[q.id]; }).length;
    return { key: key, checks: Object.assign({}, r.checks), answers: Object.assign({}, r.answers), savedAt: r.savedAt,
      done: done, total: REVIEW_CHECKLIST.length, answered: answered, questions: REVIEW_QUESTIONS.length,
      complete: done === REVIEW_CHECKLIST.length && answered === REVIEW_QUESTIONS.length };
  }
  /** saveReview(weekKey, {checks, answers}) → getReview(weekKey). Empty reviews are removed. */
  function saveReview(key, review) {
    key = weekKey(key);
    var r = normalizeReview(Object.assign({}, review || {}, { savedAt: now() }));
    if (!r || (Object.keys(r.checks).length === 0 && Object.keys(r.answers).length === 0)) delete state.reviews[key];
    else state.reviews[key] = r;
    save();
    return getReview(key);
  }
  /** reviewWeeks() → week keys that have a saved review, newest first. */
  function reviewWeeks() { return Object.keys(state.reviews).sort().reverse(); }
  /** weekSummary(weekKey, list) → summary() of the entries dated inside that week. */
  function weekSummary(key, list) { var r = weekRange(key); return summary(filter(list || state.entries, { from: r.from, to: r.to })); }

  /* ------------------------------------------------------------------ *
   * Export / import
   * ------------------------------------------------------------------ */
  function exportJSON(list) {
    return JSON.stringify({ app: 'Broward Trading', kind: 'journal', version: VERSION, exportedAt: new Date(now()).toISOString(),
      entries: list || entries(), reviews: state.reviews }, null, 2);
  }
  var CSV_COLUMNS = ['id', 'date', 'symbol', 'account', 'source', 'side', 'qty', 'price', 'role', 'pnl', 'setup', 'tags', 'emotion', 'confidence', 'rating', 'notes', 'lessons', 'tradeId'];
  // Spreadsheets evaluate cells that start with = + - @ (and tab / CR tricks) as formulas. Free text
  // (notes, lessons, setup, tags, imported from anyone's export) is therefore prefixed with a quote,
  // which Excel / LibreOffice / Sheets show as literal text. entryFromCSVRow() strips it on re-import.
  var FORMULA_START = /^[=+\-@\t\r]/;
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    var s = String(v);
    var guard = FORMULA_START.test(s);
    if (guard) s = "'" + s;
    return guard || /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function unguard(s) { return typeof s === 'string' && s.charAt(0) === "'" && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s; }
  function exportCSV(list) {
    var rows = [CSV_COLUMNS.join(',')];
    (list || entries()).forEach(function (e) {
      var t = e.trade || {};
      rows.push([e.id, e.date, e.symbol, e.account || '', e.source, t.side || '', t.qty == null ? '' : t.qty, t.price == null ? '' : t.price, t.role || '',
        e.pnl == null ? '' : e.pnl, e.setup, e.tags.join(' '), e.emotion, e.confidence, e.rating, e.notes, e.lessons, e.tradeId || ''].map(csvCell).join(','));
    });
    return rows.join('\r\n');
  }
  /** parseCSV(text) → array of row objects keyed by the header (RFC 4180 quoting). */
  function parseCSV(text) {
    var rows = [], row = [], cell = '', inQ = false, s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).filter(function (r) { return r.some(function (x) { return x !== ''; }); }).map(function (r) {
      var o = {}; header.forEach(function (h, i) { o[h] = r[i] == null ? '' : r[i]; }); return o;
    });
  }
  function entryFromCSVRow(r) {
    var num = function (v) { var n = parseFloat(unguard(v)); return isFinite(n) ? n : null; };
    var e = { id: r.id || undefined, date: r.date, symbol: unguard(r.symbol), account: r.account || undefined, source: r.source || undefined,
      setup: unguard(r.setup), tags: r.tags ? unguard(r.tags).split(/[ ,]+/) : [], emotion: unguard(r.emotion), confidence: num(r.confidence), rating: num(r.rating),
      notes: unguard(r.notes), lessons: unguard(r.lessons), tradeId: r.tradeId || undefined, pnl: num(r.pnl) };
    if (r.side || r.qty || r.price) e.trade = { side: r.side, qty: num(r.qty), price: num(r.price), role: r.role, realized: num(r.pnl), closedQty: r.role === 'open' ? 0 : 1, openedQty: r.role === 'open' ? 1 : 0 };
    return e;
  }

  /**
   * importJSON(text, {mode:'merge'|'replace'}) → {added, updated, skipped, reviews, errors:[]}
   * Accepts this module's export, a bare array of entries, a `{entries:[...]}` object or CSV from exportCSV().
   * merge (default): entries with a known id are updated when the import is newer; replace: wipes the journal first.
   */
  function importJSON(text, opts) {
    opts = opts || {};
    var result = { added: 0, updated: 0, skipped: 0, reviews: 0, errors: [] };
    var parsed = null;
    var raw = String(text == null ? '' : text).trim();
    if (!raw) { result.errors.push('Nothing to import: paste a journal export first.'); return result; }
    if (raw[0] === '{' || raw[0] === '[') {
      try { parsed = JSON.parse(raw); } catch (e) { result.errors.push('That is not valid JSON (' + (e && e.message ? e.message : 'parse error') + ').'); return result; }
    } else {
      var rows = parseCSV(raw);
      if (!rows.length || !('date' in rows[0] && 'symbol' in rows[0])) { result.errors.push('Could not read this as JSON or as a journal CSV (needs date and symbol columns).'); return result; }
      parsed = { entries: rows.map(entryFromCSVRow) };
    }
    var list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.entries) ? parsed.entries : null);
    if (!list) { result.errors.push('No entries found. Expected an array of entries or an object with an "entries" array.'); return result; }
    if (opts.mode === 'replace') state = freshState();
    list.forEach(function (raw, idx) {
      var n = normalizeEntry(raw);
      if (!n) { result.skipped++; if (result.errors.length < 10) result.errors.push('Entry ' + (idx + 1) + ' skipped: no symbol, notes or trade.'); return; }
      var i = findIndex(n.id);
      if (i === -1) { state.entries.push(n); result.added++; }
      else if (n.updatedAt >= state.entries[i].updatedAt) { state.entries[i] = n; result.updated++; }
      else result.skipped++;
    });
    if (parsed && parsed.reviews && typeof parsed.reviews === 'object') {
      Object.keys(parsed.reviews).forEach(function (k) {
        var r = normalizeReview(parsed.reviews[k]);
        if (!r || !isWeekKey(k)) return;
        if (!state.reviews[k] || r.savedAt >= state.reviews[k].savedAt) { state.reviews[k] = r; result.reviews++; }
      });
    }
    if (state.entries.length > MAX_ENTRIES) state.entries = state.entries.slice(-MAX_ENTRIES);
    save();
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  BT.journal = {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    EMOTIONS: EMOTIONS,
    SETUPS: SETUPS,
    TAG_SUGGESTIONS: TAG_SUGGESTIONS,
    REVIEW_CHECKLIST: REVIEW_CHECKLIST,
    REVIEW_QUESTIONS: REVIEW_QUESTIONS,
    WHY: WHY,
    load: load, save: save, reset: reset, getState: getState,
    get state() { return state; },
    setClock: function (fn) { clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; },
    normalizeEntry: normalizeEntry, normTag: normTag, normTags: normTags,
    entries: entries, get: get, add: add, update: update, remove: remove,
    sync: sync,
    filter: filter, summary: summary, groupStats: groupStats, calendar: calendar, streaks: streaks,
    tagSuggestions: tagSuggestions, setupSuggestions: setupSuggestions,
    weekKey: weekKey, weekRange: weekRange, getReview: getReview, saveReview: saveReview, reviewWeeks: reviewWeeks, weekSummary: weekSummary,
    exportJSON: exportJSON, exportCSV: exportCSV, parseCSV: parseCSV, importJSON: importJSON,
    CSV_COLUMNS: CSV_COLUMNS
  };

  load();
})();
