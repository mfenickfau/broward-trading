/* Broward Trading — js/replay.js → BT.replay
 *
 * Market Replay engine. You pick a symbol, an interval and a start date; the
 * engine holds the whole bar array but only ever hands out the bars that have
 * been "revealed" so far (`bars.slice(0, cursor)`), one step at a time, so you
 * can practise deciding with the same information a trader had at the time
 * and without the hindsight a static chart gives away.
 *
 * What it does
 *   - step(), play(speed), pause(), jumpTo(date), jumpToEnd() over a hidden
 *     future. With `ticks` on, each bar is revealed along a SYNTHETIC
 *     intrabar path: a seeded pseudo-random walk from the real open through
 *     the real high and low (reached at unknown sub-steps, in unknown order)
 *     to the real close, 7–10 sub-steps per bar. The seed is the symbol plus
 *     the bar, so every student sees the same path — but nothing in a partial
 *     bar tells you whether the current price is a final extreme, how many
 *     sub-steps remain, or which way the bar will close. Stops and limits
 *     fill on each consecutive price segment, the way they would have inside
 *     the bar.
 *   - Trades go through BT.paper on its 'replay' account, filled at the price
 *     that is currently visible; resting limit / stop orders are processed on
 *     every step with BT.paper.processOrders against the newly revealed bar
 *     (or the newly revealed price segment when ticking). Orders that work
 *     against an open position are treated as reduce-only / one-cancels-other
 *     (a stop and a target on the same position never both fill), see
 *     prepareWorkingOrders().
 *   - A scorecard at the end: return vs buy-and-hold, trades, win rate, max
 *     drawdown, and pass / fail against a drill's success criteria.
 *   - Drill presets from course/drills.json, a session history in
 *     localStorage `bt.replay.sessions`, and a "save to journal" writer that
 *     appends an entry to `bt.journal` for js/journal.js.
 *
 * Nothing here touches the DOM; replay.html owns the UI. Plain ES2020 on
 * window.BT. Load after js/indicators.js, js/data.js and js/paper.js
 * (indicators and data are optional for the pure engine, required for
 * loadBars()).
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;
  /* i18n: BT.t when js/i18n.js is loaded (js/nav.js loads it before page scripts); plain {var} interpolation otherwise. */
  function T(s, v) { var tf = (window.BT && window.BT.t); if (tf) return tf(s, v); return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : s; }

  var ACCOUNT = 'replay';
  var SESSIONS_KEY = 'bt.replay.sessions';
  var JOURNAL_KEY = 'bt.journal';
  var DRILLS_URL = 'course/drills.json';
  var SPEEDS = [1, 2, 5, 10, 20];
  var BASE_MS = 1000;                 // one step per second at 1×
  var WARMUP = 60;                    // bars of history revealed before the start date (so SMA 50 is defined)
  var MAX_SESSIONS = 100;
  var MAX_LOG = 500;
  var MAX_LIMIT = 5000;               // BT.data.demo cap
  var INTRADAY_PER_SESSION = { '1h': 7, '15min': 26, '5min': 78, '1min': 390 };
  var DEFAULT_SESSIONS = { '1day': 126, '1h': 10, '15min': 5, '5min': 2, '1min': 1 }; // default span in trading days

  var MIN_TICKS = 5;                  // interior sub-steps between a bar's open and close when ticking (the count itself is seeded)
  var MAX_TICKS = 8;

  var HONESTY = 'Replay hides the future: the chart, every indicator and the price you trade at are computed only from the bars revealed so far. ' +
    'With intrabar ticks on, the path inside a forming bar is synthetic: a seeded random walk between the bar\'s real open, high, low and close. ' +
    'Nobody knows the true order of trades inside a historical bar, so a forming bar\'s price, range and volume are a simulation, not a record. ' +
    'Demo prices are simulated, so a replay dated 2022 is a scenario, not the real 2022. Fills are idealised (no spread, no slippage, no partial fills), ' +
    'which flatters your results; real trading costs more. Nothing here is investment advice.';

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function cents(v) { return Math.round(v * 100) / 100; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function normSymbol(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

  function storageGet(key, fallback) {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : (window.localStorage || null);
      if (!ls) return fallback;
      var raw = ls.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function storageSet(key, value) {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : (window.localStorage || null);
      if (!ls) return false;
      ls.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  /** 'YYYY-MM-DD' for any bar time (strings pass through, unix seconds are read in New York time when possible). */
  function barDay(time) {
    if (typeof time === 'string') return time.slice(0, 10);
    if (isNum(time)) {
      var ms = time < 1e11 ? time * 1000 : time;
      if (BT.data && BT.data.time && typeof BT.data.time.unixToNyDate === 'function') {
        try { var d = BT.data.time.unixToNyDate(Math.floor(ms / 1000)); if (typeof d === 'string') return d; } catch (e) { /* fall through */ }
      }
      return new Date(ms).toISOString().slice(0, 10);
    }
    return null;
  }
  /** Bar time → wall-clock milliseconds (daily bars stamped at the 4 pm ET close, 21:00 UTC — same rule as BT.paper). */
  function toMs(t) {
    if (typeof t === 'string') { var p = Date.parse(t.length === 10 ? t + 'T21:00:00Z' : t); return isNum(p) ? p : Date.now(); }
    if (isNum(t)) return t < 1e11 ? Math.round(t * 1000) : t;
    return Date.now();
  }
  /** Milliseconds of the 4 pm ET close on `date` ('YYYY-MM-DD'), used as the demo clock so that session is complete. */
  function closeMsOf(date) {
    var y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
    if (BT.data && BT.data.time && typeof BT.data.time.nyToUnix === 'function') return BT.data.time.nyToUnix(y, m, d, 16, 0, 0) * 1000;
    return Date.UTC(y, m - 1, d, 21, 0, 0);
  }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtTime(time) {
    if (typeof time === 'string') return time;
    if (!isNum(time)) return '';
    var day = barDay(time);
    try {
      var hm = new Date(toMs(time)).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
      return day + ' ' + hm + ' ET';
    } catch (e) { return day; }
  }
  function money(v) { return BT.paper && BT.paper.money ? BT.paper.money(v) : (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2); }
  function pct(v) { return (v > 0 ? '+' : '') + (isNum(v) ? v.toFixed(2) : '0.00') + ' %'; }

  /* ------------------------------------------------------------------ *
   * Intrabar ticks — the path a bar is revealed along
   * ------------------------------------------------------------------ */
  /*
   * Why a seeded random path and not "open → low → high → close"?
   * A fixed path leaks the future: if the first move after the open is down,
   * the student knows the bar will close up (the low came first), and the
   * price sitting exactly on an extreme tells them it will not be exceeded.
   * Here the high and the low are each placed at a random, unknown interior
   * sub-step and every other interior point is drawn inside [low, high], so
   * at any moment the running range may still be extended and the direction
   * of the first move says nothing about the close. The seed is the symbol
   * plus the bar's time and prices, so a drill replays identically for every
   * student and the path never changes between sessions.
   */
  function hashSeed(str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  /** mulberry32: a tiny deterministic PRNG, uniform in [0, 1). */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function tickSeed(bar, seed) {
    return hashSeed((seed == null ? '' : String(seed)) + '|' + String(bar.time) + '|' + bar.open + '|' + bar.high + '|' + bar.low + '|' + bar.close);
  }
  /**
   * intrabar(bar, seed) → { path: [open, p1 … pK, close], volume: [f1 … fL], steps: L }
   * path    : L = K + 2 prices (K interior points, 5..8, itself seeded). The
   *           bar's high and low each sit at a distinct random interior index
   *           among the first K-1 interior points; every other interior point
   *           is uniform inside [low, high], rounded to cents and clamped.
   * volume  : cumulative share of the bar's volume traded after each of the L
   *           sub-steps (strictly increasing, volume[L-1] = 1), also seeded so
   *           the final volume cannot be recovered from a forming bar.
   * The same (bar, seed) always gives the same result.
   */
  function intrabar(bar, seed) {
    var r = rng(tickSeed(bar, seed));
    var K = MIN_TICKS + Math.floor(r() * (MAX_TICKS - MIN_TICKS + 1));
    var slots = K - 1;                                   // the last interior point is never forced to be an extreme
    var iHi = Math.floor(r() * slots);
    var iLo = Math.floor(r() * (slots - 1)); if (iLo >= iHi) iLo += 1;
    var hi = Math.max(bar.high, bar.low), lo = Math.min(bar.high, bar.low);
    var path = [bar.open];
    for (var i = 0; i < K; i++) {
      var px;
      if (i === iHi) px = hi;
      else if (i === iLo) px = lo;
      else { px = cents(lo + r() * (hi - lo)); px = Math.min(hi, Math.max(lo, px)); }
      path.push(px);
    }
    path.push(bar.close);
    var L = path.length;
    var weights = [], total = 0;
    for (var w = 0; w < L; w++) { var wt = 0.5 + r(); weights.push(wt); total += wt; }
    var volume = [], cum = 0;
    for (var v = 0; v < L; v++) { cum += weights[v]; volume.push(v === L - 1 ? 1 : cum / total); }
    return { path: path, volume: volume, steps: L };
  }
  /** tickPath(bar, seed) → the synthetic intrabar price path [open, …, close] (see intrabar). */
  function tickPath(bar, seed) { return intrabar(bar, seed).path; }
  /**
   * partialBar(bar, phase, seed) → the bar as it looks after `phase` sub-steps
   * (1 = just the open; 2..steps-1 = the running range and the latest price;
   * steps or more = the complete bar). Partial bars carry `partial: true`,
   * `phase` and `phases` (the total number of sub-steps for this bar).
   */
  function partialBar(bar, phase, seed) {
    var ib = intrabar(bar, seed);
    if (phase >= ib.steps) return Object.assign({}, bar);
    var seen = ib.path.slice(0, Math.max(1, phase));
    var hi = Math.max.apply(null, seen), lo = Math.min.apply(null, seen);
    var vol = isNum(bar.volume) ? Math.round(bar.volume * ib.volume[Math.max(1, phase) - 1]) : 0;
    return { time: bar.time, open: bar.open, high: hi, low: lo, close: seen[seen.length - 1], volume: vol, partial: true, phase: phase, phases: ib.steps };
  }

  /* ------------------------------------------------------------------ *
   * Session
   * ------------------------------------------------------------------ */
  /**
   * createSession(bars, opts) → session
   * bars  : full oldest→newest array (the engine copies it; never mutated)
   * opts  : { symbol, interval, startIndex | start ('YYYY-MM-DD'), cash=100000,
   *           drill, ticks=false, speed=1, account='replay', paper=BT.paper,
   *           timers={setInterval, clearInterval},
   *           validateOrder(request, ctx) → {ok, reason}  optional rule check run before every
   *             order reaches BT.paper (replay.html uses it to practise under a league's rules) }
   * order(o) also accepts o.validate (same signature, per order) and o.meta (merged into the
   * placed order's meta, e.g. {plan:{stop, target, riskPct}} from the "Plan this trade" panel).
   * Resets the paper account, reveals bars[0..startIndex] as history and
   * stands ready for step(). The first visible price is bars[startIndex].close.
   */
  function createSession(bars, opts) {
    opts = opts || {};
    var paper = opts.paper || BT.paper;
    if (!paper) throw new Error('BT.replay needs BT.paper (load js/paper.js first).');
    if (!Array.isArray(bars) || bars.length < 2) throw new Error('A replay needs at least two bars.');
    var all = bars.map(function (b) { return { time: b.time, open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: isNum(+b.volume) ? +b.volume : 0 }; });
    for (var k = 0; k < all.length; k++) {
      var bb = all[k];
      if (!isNum(bb.open) || !isNum(bb.high) || !isNum(bb.low) || !isNum(bb.close)) throw new Error('Bar ' + k + ' has a non-numeric price.');
    }
    var symbol = normSymbol(opts.symbol || bars.symbol || 'DEMO') || 'DEMO';
    var interval = opts.interval || bars.interval || (typeof all[0].time === 'string' ? '1day' : '5min');
    var startIndex = isNum(opts.startIndex) ? Math.floor(opts.startIndex) : -1;
    if (startIndex < 0 && isDate(opts.start)) {
      for (var i = 0; i < all.length; i++) { if (barDay(all[i].time) >= opts.start) { startIndex = i; break; } }
    }
    if (startIndex < 0) startIndex = 0;
    startIndex = Math.max(0, Math.min(all.length - 2, startIndex));
    var timers = opts.timers || { setInterval: function (f, ms) { return setInterval(f, ms); }, clearInterval: function (id) { clearInterval(id); } };
    var accountId = opts.account || ACCOUNT;

    var S = {
      symbol: symbol,
      interval: interval,
      startIndex: startIndex,
      drill: opts.drill || null,
      cash: isNum(opts.cash) && opts.cash > 0 ? opts.cash : (paper.DEFAULT_CASH || 100000),
      ticks: !!opts.ticks,
      speed: SPEEDS.indexOf(opts.speed) >= 0 ? opts.speed : 1,
      source: opts.source || (bars.source || 'demo'),
      note: opts.note || null,
      length: all.length
    };
    var cursor = startIndex + 1;    // number of fully revealed bars
    var phase = 0;                  // 0 = no partial bar; 1..3 = ticks revealed of all[cursor]
    var playing = false, timer = null, done = false, destroyed = false;
    var listeners = {};
    var log = [];
    var card = null;
    var counters = { orders: 0, stops: 0, limits: 0, shorts: 0, cancels: 0, ocoCancels: 0 };
    var steps = 0;
    var previousAccount = typeof paper.account === 'function' ? paper.account() : 'main';

    function emit(ev, payload) {
      var fns = listeners[ev] || [];
      for (var i = 0; i < fns.length; i++) { try { fns[i](payload, api); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }
    }
    function addLog(kind, text, extra) {
      var entry = Object.assign({ at: nowMs(), time: currentTime(), kind: kind, text: text }, extra || {});
      log.push(entry);
      if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
      emit('log', entry);
      return entry;
    }

    /* ---- what is visible ---- */
    // The synthetic path of the bar currently forming (cached per bar; see intrabar()).
    var ibCache = { index: -1, ib: null };
    function intrabarFor(i) {
      if (ibCache.index !== i) { ibCache = { index: i, ib: intrabar(all[i], symbol) }; }
      return ibCache.ib;
    }
    function phasesFor(i) { return i < all.length ? intrabarFor(i).steps : 1; }
    function visible() {
      var out = all.slice(0, cursor);
      if (phase > 0 && cursor < all.length) out.push(partialBar(all[cursor], phase, symbol));
      return out;
    }
    function currentBar() { return phase > 0 && cursor < all.length ? partialBar(all[cursor], phase, symbol) : all[cursor - 1]; }
    function currentTime() { return currentBar().time; }
    function price() { return currentBar().close; }
    function nowMs() { return toMs(currentTime()); }
    function index() { return phase > 0 ? cursor : cursor - 1; }
    function progress() {
      var total = all.length - startIndex - 1;
      var revealed = Math.min(total, cursor - startIndex - 1 + (phase > 0 ? phase / phasesFor(cursor) : 0));
      return { revealed: revealed, total: total, pct: total > 0 ? Math.min(100, revealed / total * 100) : 100, barsLeft: Math.max(0, all.length - cursor) };
    }
    /** 'bar forming' while a partial bar is showing, '' otherwise. Deliberately says nothing about which sub-step this is. */
    function phaseLabel() { return S.ticks && phase > 0 ? T('bar forming') : ''; }

    /* ---- account plumbing ---- */
    // paper.use() saves the outgoing account from memory before switching. That
    // memory copy may be stale: another tab (portfolio.html on a phone) can have
    // traded on 'main' since this page loaded, and writing the stale copy back
    // would silently erase those trades. Re-read the outgoing account from
    // storage first so the implicit save writes back exactly what is there.
    if (typeof paper.load === 'function' && typeof paper.account === 'function' && paper.account() !== accountId) paper.load();
    paper.use(accountId);
    paper.reset(S.cash);
    if (typeof paper.setClock === 'function') paper.setClock(function () { return destroyed ? Date.now() : nowMs(); });
    function objWith(k, v) { var o = {}; o[k] = v; return o; }
    function mark() { return paper.markToMarket(objWith(symbol, price()), nowMs()); }
    mark();
    addLog('info', T('Replay started: {symbol} {interval} from {time}. {n} bars hidden ahead.', { symbol: symbol, interval: interval, time: fmtTime(all[startIndex].time), n: all.length - startIndex - 1 }));

    function snapshot() {
      var st = paper.getState();
      var v = paper.valuation(objWith(symbol, price()));
      var pos = st.positions[symbol] || null;
      var equity = cents(st.cash + v.marketValue);
      var row = null;
      for (var i = 0; i < v.rows.length; i++) if (v.rows[i].symbol === symbol) row = v.rows[i];
      return {
        cash: st.cash,
        equity: equity,
        startingCash: st.startingCash,
        pnl: cents(equity - st.startingCash),
        pnlPct: st.startingCash ? (equity - st.startingCash) / st.startingCash * 100 : 0,
        realized: st.realized,
        unrealized: v.unrealized,
        position: pos ? { qty: pos.qty, avg: pos.avg, side: pos.qty > 0 ? 'long' : 'short', marketValue: row ? row.marketValue : null, unrealized: row ? row.unrealized : 0, unrealizedPct: row ? row.unrealizedPct : 0 } : null,
        openOrders: paper.openOrders(symbol),
        price: price(),
        time: currentTime()
      };
    }

    /* ---- fills while revealing ---- */
    function posQty() { var p = paper.getState().positions[symbol]; return p ? p.qty : 0; }
    function signOf(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
    function signedQty(o) { return o.side === 'buy' ? o.qty : -o.qty; }
    /** Would BT.paper.processOrders fill this open order against `seg`? Mirrors its rules (limit, stop, stop-limit, market). */
    function wouldFill(o, seg) {
      var buy = o.side === 'buy';
      switch (o.type) {
        case 'market': return true;
        case 'limit': return buy ? seg.low <= o.limitPrice : seg.high >= o.limitPrice;
        case 'stop': return buy ? seg.high >= o.stopPrice : seg.low <= o.stopPrice;
        case 'stop_limit':
          if (o.triggered) return buy ? seg.low <= o.limitPrice : seg.high >= o.limitPrice;
          if (buy) { if (seg.high < o.stopPrice) return false; var cb = Math.max(o.stopPrice, seg.open); return cb <= o.limitPrice || seg.low <= o.limitPrice; }
          if (seg.low > o.stopPrice) return false; var cs = Math.min(o.stopPrice, seg.open); return cs >= o.limitPrice || seg.high >= o.limitPrice;
      }
      return false;
    }
    /** The price at which an order would first be touched, to decide which of several hits a segment reaches first. */
    function triggerPrice(o, seg) {
      if (o.type === 'limit') return o.limitPrice;
      if (o.type === 'stop' || o.type === 'stop_limit') return o.triggered ? o.limitPrice : o.stopPrice;
      return seg.open;
    }
    function cancelWith(o, reason, kind) {
      var c = paper.cancelOrder(o.id);
      if (!c) return null;
      c.reason = reason; c._replayLogged = true;
      if (typeof paper.save === 'function') paper.save();
      counters.ocoCancels += 1;
      addLog('info', T('Order #{id} cancelled — {reason}', { id: c.id, reason: reason }), { orderId: c.id, oco: kind || 'oco' });
      emit('order', c);
      return c;
    }
    /**
     * markReduceOnly(): any working order that would shrink the current position
     * (opposite side, size no bigger than the position) is flagged reduce-only.
     * The flag is sticky — an exit order stays an exit order after the position
     * it protected is gone, which is exactly when it must be cancelled rather
     * than filled. prepareWorkingOrders() and reconcile() enforce it. Working
     * orders bigger than the position are left alone: that is a deliberate
     * stop-and-reverse.
     */
    function markReduceOnly() {
      var q = posQty();
      if (q === 0) return;
      var open = paper.openOrders(symbol);
      for (var i = 0; i < open.length; i++) {
        var o = open[i];
        if (signOf(signedQty(o)) === -signOf(q) && o.qty <= Math.abs(q)) o.reduceOnly = true;
      }
    }
    /**
     * prepareWorkingOrders(seg): run before BT.paper.processOrders on each
     * revealed bar / price segment. BT.paper fills every order the range
     * reaches with no idea of brackets, so a protective stop and a take-profit
     * limit on the same long would BOTH fill and leave the student short.
     * We simulate the fills in the order the segment would reach them (nearest
     * to the segment's open first; a tie goes to the stop — the pessimistic
     * assumption) and, once the position is used up, clamp or cancel the
     * remaining reduce-only orders (one-cancels-other). Orders that open or
     * add to a position are left untouched.
     */
    function prepareWorkingOrders(seg) {
      var open = paper.openOrders(symbol);
      if (!open.length) return;
      var hits = [];
      for (var i = 0; i < open.length; i++) if (wouldFill(open[i], seg)) hits.push(open[i]);
      if (hits.length < 2 && posQty() === 0) return;
      hits.sort(function (a, b) {
        var da = Math.abs(triggerPrice(a, seg) - seg.open), db = Math.abs(triggerPrice(b, seg) - seg.open);
        if (da !== db) return da - db;
        var sa = a.type === 'stop' || a.type === 'stop_limit', sb = b.type === 'stop' || b.type === 'stop_limit';
        if (sa !== sb) return sa ? -1 : 1;
        return a.id - b.id;
      });
      var q = posQty();
      var closedDir = 0, closedSize = 0;   // the position a reducer in this pass just took to zero
      for (var h = 0; h < hits.length; h++) {
        var o = hits[h];
        var sq = signedQty(o);
        var reducing = o.reduceOnly ||
          (q !== 0 && signOf(sq) === -signOf(q) && o.qty <= Math.abs(q)) ||
          // a bracket placed while flat: the entry and both exits reached in one bar — once the entry's
          // position has been closed by one exit, the other exit (same size or smaller) is its OCO sibling
          (q === 0 && closedDir !== 0 && signOf(sq) === -closedDir && o.qty <= closedSize);
        if (!reducing) { q += sq; continue; }
        var allowed = (q !== 0 && signOf(sq) === -signOf(q)) ? Math.min(o.qty, Math.abs(q)) : 0;
        if (allowed <= 0) {
          cancelWith(o, T('OCO: the position it protected was already closed by another order in the same bar ({order}).', { order: paper.describeOrder ? paper.describeOrder(o) : o.type + ' order' }), 'oco');
          continue;
        }
        if (allowed < o.qty) {
          o.qty = allowed;
          o.reason = T('Reduce-only: size cut to the {n} shares still open.', { n: allowed });
          addLog('info', T('Order #{id} reduced to {n} shares — only {n} remain to close.', { id: o.id, n: allowed }), { orderId: o.id, oco: 'clamp' });
        }
        closedDir = signOf(q); closedSize = Math.abs(q);
        q += (sq > 0 ? allowed : -allowed);
        if (q !== 0) { closedDir = 0; closedSize = 0; }
      }
    }
    /**
     * reconcile(qtyBefore, fills): safety net after fills. If a reduce-only
     * order still managed to flip the position's sign (something the
     * simulation above did not foresee), reverse the excess at the same fill
     * price so the student is flat rather than accidentally short / long, and
     * say so in the log. Then re-flag reduce-only orders and drop the ones
     * whose position is gone.
     */
    function reconcile(qtyBefore, fills) {
      var q = posQty();
      if (qtyBefore !== 0 && q !== 0 && signOf(q) === -signOf(qtyBefore)) {
        var culprit = null;
        for (var i = fills.length - 1; i >= 0 && !culprit; i--) if (fills[i].order.reduceOnly) culprit = fills[i];
        if (culprit) {
          var fix = paper.placeOrder({ symbol: symbol, side: q > 0 ? 'sell' : 'buy', qty: Math.abs(q), type: 'market' }, culprit.trade.price);
          if (fix && fix.status === 'filled') {
            fix._replayLogged = true; fix.reason = T('OCO correction: a reduce-only order can only close a position, never reverse it.');
            addLog('info', T('OCO: reduce-only fill of order #{id} could not reverse your position; the excess {n} shares were undone @ {price}.', { id: culprit.order.id, n: Math.abs(q), price: money(culprit.trade.price) }), { orderId: fix.id, oco: 'correction' });
          }
        }
      }
      markReduceOnly();
      if (posQty() === 0) {
        var open = paper.openOrders(symbol);
        for (var k = 0; k < open.length; k++) if (open[k].reduceOnly) cancelWith(open[k], T('OCO: the position it protected is closed.'), 'oco');
      }
    }
    function processAgainst(bar) {
      var qtyBefore = posQty();
      prepareWorkingOrders(bar);
      var fills = paper.processOrders(symbol, bar);
      if (fills.length) noteShort(qtyBefore);
      for (var i = 0; i < fills.length; i++) {
        var f = fills[i];
        addLog('fill', T(f.order.side === 'buy' ? 'Bought {qty} {symbol} @ {price} — {reason}' : 'Sold {qty} {symbol} @ {price} — {reason}', { qty: f.trade.qty, symbol: symbol, price: money(f.trade.price), reason: f.order.reason || T('order filled') }), { orderId: f.order.id, tradeId: f.trade.id, side: f.order.side, qty: f.trade.qty, price: f.trade.price, realized: f.trade.realized });
        emit('fill', f);
      }
      if (fills.length) reconcile(qtyBefore, fills);
      // orders that worked but were rejected on fill (cash / margin) must surface too
      var st = paper.getState();
      for (var j = 0; j < st.orders.length; j++) {
        var o = st.orders[j];
        if (o.status === 'rejected' && o.symbol === symbol && !o._replayLogged) {
          o._replayLogged = true;
          addLog('reject', T('Order #{id} could not fill: {reason}', { id: o.id, reason: o.reason }), { orderId: o.id });
        }
        if (o.status === 'expired' && o.symbol === symbol && !o._replayLogged) { o._replayLogged = true; addLog('info', T('Order #{id} expired: {reason}', { id: o.id, reason: o.reason }), { orderId: o.id }); }
      }
      return fills;
    }

    function finish() {
      if (done) return card;
      done = true;
      pause();
      card = buildScorecard();
      addLog('end', T('Replay finished. Return {ret} vs buy-and-hold {bh}.', { ret: pct(card.returnPct), bh: pct(card.buyHoldPct) }));
      emit('end', card);
      return card;
    }

    /**
     * step() → {bar, fills, done}
     * Reveal the next bar (or, with ticks on, the next sub-step of the current
     * bar), fill any resting orders it reaches and mark the account.
     */
    function step() {
      if (destroyed) return null;
      if (done) return card;
      if (cursor >= all.length) return finish();
      var revealed, segment;
      if (S.ticks) {
        var bar = all[cursor];
        var path = intrabarFor(cursor).path;
        var last = path.length - 1;          // index of the close
        var prevPx = phase === 0 ? all[cursor - 1].close : path[phase - 1];
        if (phase < last) {
          phase += 1;
          var px = path[phase - 1];
          // Phase 1 is the open: a gap, so a single-price segment (stops fill at the open, not at their stop price).
          segment = phase === 1
            ? { time: bar.time, open: px, high: px, low: px, close: px, volume: 0 }
            : { time: bar.time, open: prevPx, high: Math.max(prevPx, px), low: Math.min(prevPx, px), close: px, volume: 0 };
          revealed = partialBar(bar, phase, symbol);
        } else {
          phase = 0; cursor += 1;
          segment = { time: bar.time, open: prevPx, high: Math.max(prevPx, bar.close), low: Math.min(prevPx, bar.close), close: bar.close, volume: bar.volume };
          revealed = bar;
        }
      } else {
        revealed = all[cursor];
        segment = revealed;
        cursor += 1;
      }
      steps += 1;
      var fills = processAgainst(segment);
      mark();
      var payload = { bar: revealed, fills: fills, index: index(), partial: phase > 0, phase: phase, phases: phase > 0 ? phasesFor(cursor) : 0, done: false, snapshot: snapshot() };
      emit('step', payload);
      if (cursor >= all.length && phase === 0) { finish(); payload.done = true; }
      return payload;
    }
    /** Complete the current bar (all remaining ticks), or reveal one whole bar. */
    function stepBar() {
      if (done || destroyed) return null;
      var last = null;
      if (S.ticks && phase > 0) { while (!done && phase !== 0) last = step(); return last; }
      if (S.ticks) { do { last = step(); } while (!done && phase !== 0); return last; }
      return step();
    }

    /* ---- play / pause ---- */
    function setSpeed(x) {
      x = +x; if (SPEEDS.indexOf(x) === -1) x = SPEEDS.reduce(function (b, s) { return Math.abs(s - x) < Math.abs(b - x) ? s : b; }, SPEEDS[0]);
      S.speed = x;
      if (playing) { stopTimer(); startTimer(); }
      emit('speed', x);
      return x;
    }
    function startTimer() { timer = timers.setInterval(function () { if (done) { pause(); return; } step(); }, Math.max(20, Math.round(BASE_MS / S.speed))); }
    function stopTimer() { if (timer != null) { timers.clearInterval(timer); timer = null; } }
    function play(speed) {
      if (done || destroyed) return false;
      if (speed != null) setSpeed(speed);
      if (playing) return true;
      playing = true; startTimer();
      emit('play', S.speed);
      return true;
    }
    function pause() {
      if (!playing) return false;
      playing = false; stopTimer();
      emit('pause');
      return true;
    }
    function toggle() { return playing ? pause() : play(); }

    /**
     * jumpTo(target): reveal whole bars until the current bar's date reaches
     * `target` ('YYYY-MM-DD'), an index, or a unix time. Orders are processed
     * bar by bar on the way, so nothing is skipped — only fast-forwarded.
     */
    function jumpTo(target) {
      if (done || destroyed) return currentBar();
      pause();
      var wasTicks = S.ticks; S.ticks = false;
      if (phase > 0) { S.ticks = true; stepBar(); S.ticks = false; }
      var guard = 0;
      while (!done && cursor < all.length && guard++ < MAX_LIMIT + 10) {
        var next = all[cursor];
        if (isDate(target)) { if (barDay(next.time) > target) break; }
        else if (isNum(target) && target < 1e9) { if (cursor > target) break; }
        else if (isNum(target)) { if (toMs(next.time) > toMs(target)) break; }
        else break;
        step();
      }
      S.ticks = wasTicks;
      emit('jump', currentBar());
      return currentBar();
    }
    function jumpToEnd() {
      if (done || destroyed) return card;
      pause();
      var wasTicks = S.ticks; S.ticks = false;
      if (phase > 0) { S.ticks = true; stepBar(); S.ticks = false; }
      var guard = 0;
      while (!done && guard++ < MAX_LIMIT + 10) step();
      S.ticks = wasTicks;
      emit('jump', currentBar());
      return card;
    }

    /* ---- trading ---- */
    function order(o) {
      if (destroyed) return null;
      o = o || {};
      var req = {
        symbol: symbol, side: o.side, qty: Number(o.qty), type: o.type || 'market',
        limitPrice: isNum(+o.limitPrice) && o.limitPrice !== '' && o.limitPrice != null ? +o.limitPrice : undefined,
        stopPrice: isNum(+o.stopPrice) && o.stopPrice !== '' && o.stopPrice != null ? +o.stopPrice : undefined,
        tif: o.tif || 'gtc'
      };
      if (done) {
        var dead = { status: 'rejected', reason: T('The replay has finished — start a new session to keep trading.'), symbol: symbol, side: o.side, qty: req.qty, type: req.type };
        addLog('reject', dead.reason);
        return dead;
      }
      // Optional rule check before the order reaches BT.paper (e.g. league rules via BT.leagues.validateOrder).
      // A per-order o.validate wins over the session-wide opts.validateOrder; both get the request and context.
      var check = typeof o.validate === 'function' ? o.validate : (typeof opts.validateOrder === 'function' ? opts.validateOrder : null);
      if (check) {
        var verdict = null;
        try { verdict = check(Object.assign({}, req, { price: price(), time: nowMs() }), { session: api, account: paper.getState(), price: price(), time: nowMs() }); } catch (e) { verdict = null; }
        if (verdict && verdict.ok === false) {
          var blocked = { status: 'rejected', reason: verdict.reason || T('This order breaks the rules you chose for this session.'), symbol: symbol, side: o.side, qty: req.qty, type: req.type, blockedByRules: true };
          counters.orders += 1;
          addLog('reject', T('Rejected: {reason}', { reason: blocked.reason }));
          emit('order', blocked);
          return blocked;
        }
      }
      var posBefore = paper.getState().positions[symbol];
      var qtyBefore = posBefore ? posBefore.qty : 0;
      var placed = paper.placeOrder(req, price());
      // Planned stop / target (the "Plan this trade" panel) travel on the order's meta so the journal,
      // the coach and the XP badges can see that the trade had a plan.
      if (o.meta && typeof o.meta === 'object' && placed && placed.status !== 'rejected') {
        placed.meta = Object.assign({}, placed.meta || {}, o.meta);
        if (typeof paper.save === 'function') paper.save();
      }
      counters.orders += 1;
      if (placed.status !== 'rejected') {
        if (placed.type === 'stop' || placed.type === 'stop_limit') counters.stops += 1;
        if (placed.type === 'limit') counters.limits += 1;
      }
      noteShort(qtyBefore);
      var label = (o.intent || (placed.side === 'buy' ? 'buy' : 'sell'));
      if (placed.status === 'filled') {
        var tr = paper.getState().trades[paper.getState().trades.length - 1];
        placed._replayLogged = true;
        addLog('fill', fillText(label, placed.qty, placed.fillPrice, tr && tr.realized ? tr.realized : 0), { orderId: placed.id, tradeId: tr ? tr.id : null, side: placed.side, qty: placed.qty, price: placed.fillPrice, realized: tr ? tr.realized : 0 });
        emit('fill', { order: placed, trade: tr });
      } else if (placed.status === 'open') {
        markReduceOnly();
        addLog('order', T('Working: {order}', { order: paper.describeOrder ? paper.describeOrder(placed) : placed.type + ' order #' + placed.id }) + (placed.reduceOnly ? ' ' + T('(reduce-only: it can only close your position, and is cancelled if another order closes it first)') : ''), { orderId: placed.id, reduceOnly: !!placed.reduceOnly });
      } else {
        placed._replayLogged = true;
        addLog('reject', T('Rejected: {reason}', { reason: placed.reason }), { orderId: placed.id });
      }
      if (placed.status === 'filled') reconcile(qtyBefore, []);
      emit('order', placed);
      mark();
      return placed;
    }
    /* 'Buy 10 AAPL filled @ $190.00 (realized $12.00)': one template per intent so each language can order the words. */
    function fillText(intent, qty, px, realized) {
      var base = { buy: 'Buy {qty} {symbol} filled @ {price}', sell: 'Sell {qty} {symbol} filled @ {price}', short: 'Short {qty} {symbol} filled @ {price}', cover: 'Cover {qty} {symbol} filled @ {price}' }[intent] || 'Buy {qty} {symbol} filled @ {price}';
      var v = { qty: qty, symbol: symbol, price: money(px), realized: money(realized) };
      return realized ? T(base + ' (realized {realized})', v) : T(base, v);
    }
    // A short is "opened" whenever the position goes (more) negative — on placement or on a later fill.
    var lastQtySeen = 0;
    function noteShort(qtyBefore) {
      var pos = paper.getState().positions[symbol];
      var q = pos ? pos.qty : 0;
      if (q < 0 && q < Math.min(0, qtyBefore)) counters.shorts += 1;
      lastQtySeen = q;
    }
    function buy(qty, extra) { return order(Object.assign({}, extra || {}, { side: 'buy', qty: qty, intent: 'buy' })); }
    function sell(qty, extra) { return order(Object.assign({}, extra || {}, { side: 'sell', qty: qty, intent: 'sell' })); }
    function short(qty, extra) { return order(Object.assign({}, extra || {}, { side: 'sell', qty: qty, intent: 'short' })); }
    function cover(qty, extra) { return order(Object.assign({}, extra || {}, { side: 'buy', qty: qty, intent: 'cover' })); }
    function closePosition() {
      if (destroyed || done) return null;
      var pos = paper.getState().positions[symbol];
      if (!pos) { addLog('reject', T('Nothing to close: you have no position in {symbol}.', { symbol: symbol })); return null; }
      var o = paper.closePosition(symbol, price());
      if (o.status === 'filled') {
        var tr = paper.getState().trades[paper.getState().trades.length - 1];
        o._replayLogged = true;
        addLog('fill', T(pos.qty > 0 ? (tr ? 'Closed long {qty} {symbol} @ {price} (realized {realized})' : 'Closed long {qty} {symbol} @ {price}') : (tr ? 'Covered short {qty} {symbol} @ {price} (realized {realized})' : 'Covered short {qty} {symbol} @ {price}'), { qty: Math.abs(pos.qty), symbol: symbol, price: money(o.fillPrice), realized: tr ? money(tr.realized) : '' }), { orderId: o.id, tradeId: tr ? tr.id : null, side: o.side, qty: o.qty, price: o.fillPrice, realized: tr ? tr.realized : 0 });
        emit('fill', { order: o, trade: tr });
      } else { o._replayLogged = true; addLog('reject', T('Close rejected: {reason}', { reason: o.reason })); }
      if (o.status === 'filled') reconcile(pos.qty, []);
      emit('order', o);
      mark();
      return o;
    }
    function cancel(id) {
      var o = paper.cancelOrder(id);
      if (o) { counters.cancels += 1; addLog('info', T('Cancelled order #{id}.', { id: o.id }), { orderId: o.id }); emit('order', o); }
      return o;
    }
    function position() { return paper.getState().positions[symbol] || null; }
    function openOrders() { return paper.openOrders(symbol); }
    function trades() { return paper.getState().trades.slice(); }

    /* ---- scorecard ---- */
    function buildScorecard() {
      var st = paper.stats();
      var snap = snapshot();
      var first = all[startIndex].close, lastPx = price();
      var bh = first > 0 ? (lastPx / first - 1) * 100 : 0;
      var c = {
        id: 'rs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        symbol: symbol, interval: interval,
        start: all[startIndex].time, end: currentTime(),
        startLabel: fmtTime(all[startIndex].time), endLabel: fmtTime(currentTime()),
        bars: all.length - startIndex - 1,
        barsRevealed: cursor - startIndex - 1,
        completed: done && cursor >= all.length,
        startingCash: snap.startingCash, equity: snap.equity, pnl: snap.pnl,
        returnPct: round2(snap.pnlPct), buyHoldPct: round2(bh), alphaPct: round2(snap.pnlPct - bh),
        startPrice: first, endPrice: lastPx,
        trades: st.trades, fills: st.fills, wins: st.wins, losses: st.losses,
        winRate: st.winRate == null ? null : round2(st.winRate),
        profitFactor: st.profitFactor == null ? null : round2(st.profitFactor),
        avgWin: st.avgWin, avgLoss: st.avgLoss, expectancy: st.expectancy,
        bestTrade: st.bestTrade, worstTrade: st.worstTrade,
        maxDrawdownPct: round2(st.maxDrawdownPct), maxDrawdown: st.maxDrawdown,
        sharpe: st.sharpe == null ? null : round2(st.sharpe),
        realized: snap.realized, unrealized: snap.unrealized,
        openPosition: snap.position ? { qty: snap.position.qty, avg: snap.position.avg, unrealized: snap.position.unrealized } : null,
        ordersPlaced: counters.orders, stopsUsed: counters.stops, limitsUsed: counters.limits, shortsOpened: counters.shorts, cancels: counters.cancels, ocoCancels: counters.ocoCancels,
        ticks: S.ticks, source: S.source,
        finishedAt: Date.now(),
        drill: null
      };
      if (S.drill) {
        // A drill can only be passed on the whole session. Ending early is
        // hindsight-free, but choosing the end date after seeing the result is
        // cherry-picking — exactly what the scorecard exists to prevent.
        var results = [{ type: 'completed', text: T('Reveal the whole session (ending early cannot pass a drill)'), pass: c.completed, actual: c.barsRevealed, target: c.bars, actualText: T(c.completed ? '{n} of {total} bars' : '{n} of {total} bars — ended early', { n: c.barsRevealed, total: c.bars }) }]
          .concat(evaluateDrill(S.drill, c));
        c.drill = { id: S.drill.id, title: S.drill.title, results: results, completed: c.completed, passed: c.completed && results.length > 1 && results.every(function (r) { return r.pass; }) };
      }
      return c;
    }
    function scorecard() { return done && card ? card : buildScorecard(); }

    /* ---- lifecycle ---- */
    function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return function () { off(ev, fn); }; }
    function off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); }
    function destroy() {
      if (destroyed) return;
      pause();
      destroyed = true;
      if (typeof paper.setClock === 'function') paper.setClock(null);
      // The outgoing account here is 'replay' (ours), so the implicit save is harmless; re-load anyway so nothing stale is written.
      if (previousAccount && previousAccount !== accountId) { if (typeof paper.load === 'function') paper.load(); paper.use(previousAccount); }
      listeners = {};
    }
    function setTicks(onOff) { S.ticks = !!onOff; emit('ticks', S.ticks); return S.ticks; }

    var api = {
      get symbol() { return symbol; },
      get interval() { return interval; },
      get startIndex() { return startIndex; },
      get cursor() { return cursor; },
      get phase() { return phase; },
      get phases() { return phase > 0 ? phasesFor(cursor) : 0; },
      get length() { return all.length; },
      get drill() { return S.drill; },
      get speed() { return S.speed; },
      get ticks() { return S.ticks; },
      get playing() { return playing; },
      get done() { return done; },
      get destroyed() { return destroyed; },
      get log() { return log; },
      get source() { return S.source; },
      get note() { return S.note; },
      get steps() { return steps; },
      get account() { return accountId; },
      visible: visible, currentBar: currentBar, currentTime: currentTime, price: price, nowMs: nowMs, index: index, progress: progress, phaseLabel: phaseLabel,
      step: step, stepBar: stepBar, play: play, pause: pause, toggle: toggle, setSpeed: setSpeed, setTicks: setTicks, jumpTo: jumpTo, jumpToEnd: jumpToEnd,
      order: order, buy: buy, sell: sell, short: short, cover: cover, closePosition: closePosition, cancel: cancel,
      position: position, openOrders: openOrders, trades: trades, snapshot: snapshot, scorecard: scorecard, finish: finish,
      on: on, off: off, destroy: destroy,
      // Only for tests: the hidden bars. The UI must never read this.
      _all: function () { return all; }
    };
    return api;
  }

  /* ------------------------------------------------------------------ *
   * Drills
   * ------------------------------------------------------------------ */
  var drills = null;
  var drillsPromise = null;

  function normDrill(d) {
    if (!d || typeof d !== 'object' || !d.id) return null;
    return {
      id: String(d.id), title: String(d.title || d.id),
      level: d.level || 'intermediate',
      symbol: normSymbol(d.symbol || 'SPY'), interval: d.interval || '1day',
      start: d.start, end: d.end, cash: isNum(d.cash) ? d.cash : 100000,
      ticks: !!d.ticks,
      objective: d.objective || '', hints: Array.isArray(d.hints) ? d.hints : [],
      criteria: Array.isArray(d.criteria) ? d.criteria : [],
      lesson: d.lesson || null, minutes: d.minutes || null, tags: Array.isArray(d.tags) ? d.tags : []
    };
  }
  /** loadDrills(url?) → Promise<drills[]>. Cached after the first load; `BT.replay.drills` is filled in. */
  function loadDrills(url) {
    if (drills) return Promise.resolve(drills);
    if (drillsPromise) return drillsPromise;
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch is not available'));
    drillsPromise = fetch(url || DRILLS_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' loading drills');
      return r.json();
    }).then(function (json) {
      var list = Array.isArray(json) ? json : (json && Array.isArray(json.drills) ? json.drills : []);
      drills = list.map(normDrill).filter(Boolean);
      BT.replay.drills = drills;
      return drills;
    }).catch(function (e) { drillsPromise = null; throw e; });
    return drillsPromise;
  }
  function setDrills(list) { drills = (Array.isArray(list) ? list : []).map(normDrill).filter(Boolean); BT.replay.drills = drills; return drills; }
  function getDrill(id) { if (!drills || !id) return null; for (var i = 0; i < drills.length; i++) if (drills[i].id === id) return drills[i]; return null; }

  /**
   * evaluateDrill(drill, scorecard) → [{type, text, pass, actual, target}]
   * Criteria types (each may carry its own `text`):
   *   min_trades {value}  max_trades {value}  min_return_pct {value}  positive_return
   *   beat_buy_hold       max_drawdown_pct {value}  min_win_rate_pct {value}
   *   min_profit_factor {value}  flat_at_end  used_stop  used_limit  used_short  no_short
   */
  function evaluateDrill(drill, c) {
    var out = [];
    var crit = (drill && Array.isArray(drill.criteria)) ? drill.criteria : [];
    crit.forEach(function (k) {
      if (!k || !k.type) return;
      var v = isNum(+k.value) ? +k.value : null;
      var r = { type: k.type, target: v, text: k.text || '', pass: false, actual: null };
      switch (k.type) {
        case 'min_trades': r.actual = c.trades; r.pass = c.trades >= (v == null ? 1 : v); r.text = r.text || T((v == null ? 1 : v) === 1 ? 'Complete at least {n} round trip (a position opened and closed)' : 'Complete at least {n} round trips (a position opened and closed)', { n: v == null ? 1 : v }); r.actualText = T('{n} closed', { n: c.trades }); break;
        case 'max_trades': r.actual = c.trades; r.pass = c.trades <= (v == null ? 999 : v); r.text = r.text || T('Make no more than {n} round trips — patience over activity', { n: v }); r.actualText = T('{n} closed', { n: c.trades }); break;
        case 'min_return_pct': r.actual = c.returnPct; r.pass = c.returnPct >= (v == null ? 0 : v); r.text = r.text || T('Finish with a return of at least {pct}', { pct: pct(v == null ? 0 : v) }); r.actualText = pct(c.returnPct); break;
        case 'positive_return': r.actual = c.returnPct; r.pass = c.returnPct > 0; r.text = r.text || T('Finish the session with a positive return'); r.actualText = pct(c.returnPct); break;
        case 'beat_buy_hold': r.actual = c.alphaPct; r.pass = c.returnPct > c.buyHoldPct; r.text = r.text || T('Beat buy-and-hold over the same period'); r.actualText = pct(c.returnPct) + ' vs ' + pct(c.buyHoldPct); break;
        case 'max_drawdown_pct': r.actual = c.maxDrawdownPct; r.pass = c.maxDrawdownPct <= (v == null ? 100 : v); r.text = r.text || T('Keep your max drawdown under {n} %', { n: v == null ? 100 : v }); r.actualText = c.maxDrawdownPct.toFixed(2) + ' %'; break;
        case 'min_win_rate_pct': r.actual = c.winRate; r.pass = c.winRate != null && c.winRate >= (v == null ? 50 : v); r.text = r.text || T('Win at least {n} % of your closed trades', { n: v == null ? 50 : v }); r.actualText = c.winRate == null ? T('no closed trades') : c.winRate.toFixed(0) + ' %'; break;
        case 'min_profit_factor': r.actual = c.profitFactor; r.pass = (c.profitFactor == null && c.wins > 0 && c.losses === 0) || (c.profitFactor != null && c.profitFactor >= (v == null ? 1 : v)); r.text = r.text || T('Profit factor of at least {n}', { n: v == null ? 1 : v }); r.actualText = c.profitFactor == null ? (c.wins > 0 ? T('no losing trades') : 'n/a') : c.profitFactor.toFixed(2); break;
        case 'flat_at_end': r.actual = c.openPosition ? c.openPosition.qty : 0; r.pass = !c.openPosition; r.text = r.text || T('Be flat (no open position) when the session ends'); r.actualText = c.openPosition ? T('{n} shares open', { n: c.openPosition.qty }) : T('flat'); break;
        case 'used_stop': r.actual = c.stopsUsed; r.pass = c.stopsUsed >= (v == null ? 1 : v); r.text = r.text || (v == null ? T('Protect at least one position with a stop order') : T(v > 1 ? 'Protect at least {n} positions with a stop order' : 'Protect at least {n} position with a stop order', { n: v })); r.actualText = T(c.stopsUsed === 1 ? '{n} stop order' : '{n} stop orders', { n: c.stopsUsed }); break;
        case 'used_limit': r.actual = c.limitsUsed; r.pass = c.limitsUsed >= (v == null ? 1 : v); r.text = r.text || (v == null ? T('Enter or exit with at least one limit order') : T('Enter or exit with at least {n} limit order', { n: v })); r.actualText = T(c.limitsUsed === 1 ? '{n} limit order' : '{n} limit orders', { n: c.limitsUsed }); break;
        case 'used_short': r.actual = c.shortsOpened; r.pass = c.shortsOpened >= (v == null ? 1 : v); r.text = r.text || (v == null ? T('Open at least one short position') : T('Open at least {n} short position', { n: v })); r.actualText = T(c.shortsOpened === 1 ? '{n} short' : '{n} shorts', { n: c.shortsOpened }); break;
        case 'no_short': r.actual = c.shortsOpened; r.pass = c.shortsOpened === 0; r.text = r.text || T('Stay long-only: no short sales'); r.actualText = T(c.shortsOpened === 1 ? '{n} short' : '{n} shorts', { n: c.shortsOpened }); break;
        default: return; // unknown criterion: ignored rather than failed
      }
      out.push(r);
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Sessions history (bt.replay.sessions) and journal (bt.journal)
   * ------------------------------------------------------------------ */
  function sessions() { var s = storageGet(SESSIONS_KEY, []); return Array.isArray(s) ? s : []; }
  function saveSession(card) {
    if (!card || typeof card !== 'object') return null;
    var list = sessions();
    var summary = {
      id: card.id, at: card.finishedAt || Date.now(), symbol: card.symbol, interval: card.interval,
      start: card.start, end: card.end, bars: card.bars, completed: !!card.completed,
      returnPct: card.returnPct, buyHoldPct: card.buyHoldPct, alphaPct: card.alphaPct,
      trades: card.trades, winRate: card.winRate, maxDrawdownPct: card.maxDrawdownPct, profitFactor: card.profitFactor,
      equity: card.equity, startingCash: card.startingCash,
      drill: card.drill ? { id: card.drill.id, title: card.drill.title, passed: card.drill.passed } : null
    };
    list = list.filter(function (s) { return s && s.id !== summary.id; });
    list.push(summary);
    if (list.length > MAX_SESSIONS) list.splice(0, list.length - MAX_SESSIONS);
    storageSet(SESSIONS_KEY, list);
    return summary;
  }
  function clearSessions() { storageSet(SESSIONS_KEY, []); }

  function summaryText(card) {
    var lines = [
      'Market Replay ' + card.symbol + ' ' + card.interval + ' · ' + card.startLabel + ' → ' + card.endLabel + ' (' + card.barsRevealed + ' of ' + card.bars + ' bars)',
      'Return ' + pct(card.returnPct) + ' vs buy-and-hold ' + pct(card.buyHoldPct) + ' (alpha ' + pct(card.alphaPct) + ')',
      'Closed trades ' + card.trades + (card.winRate == null ? '' : ', win rate ' + card.winRate.toFixed(0) + ' %') + (card.profitFactor == null ? '' : ', profit factor ' + card.profitFactor.toFixed(2)) + ', max drawdown ' + card.maxDrawdownPct.toFixed(2) + ' %',
      'Equity ' + money(card.equity) + ' from ' + money(card.startingCash) + (card.openPosition ? ' with ' + card.openPosition.qty + ' shares still open' : ', flat at the end')
    ];
    if (card.drill) lines.push(T('Drill "{title}":', { title: card.drill.title }) + ' ' + (card.drill.passed ? T('passed') : T('not passed')) + ' — ' + card.drill.results.map(function (r) { return (r.pass ? '✓ ' : '✕ ') + r.text + ' (' + r.actualText + ')'; }).join('; '));
    return lines.join('\n');
  }
  /**
   * toJournalEntry(card, extra) → journal entry in the js/journal.js shape:
   * {id, tradeId?, symbol, date, setup, tags[], emotion, confidence 1-5, notes, lessons, rating 1-5}
   * plus `source:'replay'` and a compact `replay` block for the journal's stats.
   */
  function toJournalEntry(card, extra) {
    extra = extra || {};
    var clamp5 = function (v, d) { v = Math.round(+v); return isNum(v) && v >= 1 && v <= 5 ? v : d; };
    var tags = ['replay', card.symbol, card.interval];
    if (card.drill) tags.push('drill:' + card.drill.id);
    if (card.returnPct > 0) tags.push('winner'); else if (card.returnPct < 0) tags.push('loser');
    (Array.isArray(extra.tags) ? extra.tags : []).forEach(function (t) { if (t && tags.indexOf(t) === -1) tags.push(String(t)); });
    return {
      id: 'jr-' + (card.id || Date.now().toString(36)),
      tradeId: null,
      source: 'replay',
      sessionId: card.id,
      symbol: card.symbol,
      date: todayStr(),
      setup: extra.setup || (card.drill ? T('Replay drill: {title}', { title: card.drill.title }) : T('Market Replay: {symbol} {interval}', { symbol: card.symbol, interval: card.interval })),
      tags: tags,
      emotion: typeof extra.emotion === 'string' ? extra.emotion : '',
      confidence: clamp5(extra.confidence, 3),
      notes: (extra.notes ? String(extra.notes).trim() + '\n\n' : '') + summaryText(card),
      lessons: extra.lessons ? String(extra.lessons).trim() : '',
      rating: clamp5(extra.rating, card.returnPct > 0 ? 4 : 2),
      replay: {
        start: card.start, end: card.end, bars: card.bars, returnPct: card.returnPct, buyHoldPct: card.buyHoldPct, alphaPct: card.alphaPct,
        trades: card.trades, winRate: card.winRate, maxDrawdownPct: card.maxDrawdownPct, profitFactor: card.profitFactor, equity: card.equity, startingCash: card.startingCash,
        drill: card.drill ? { id: card.drill.id, title: card.drill.title, passed: card.drill.passed } : null
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
  /**
   * saveToJournal(card, extra) → entry. Appends to localStorage `bt.journal`.
   * The journal may be stored as a plain array of entries or as an object
   * with an `entries` array; both shapes are preserved (a fresh journal is
   * created as an array).
   */
  function saveToJournal(card, extra) {
    var entry = toJournalEntry(card, extra);
    var j = storageGet(JOURNAL_KEY, null);
    if (Array.isArray(j)) {
      j = j.filter(function (e) { return !(e && e.id === entry.id); });
      j.push(entry);
      storageSet(JOURNAL_KEY, j);
    } else if (j && typeof j === 'object' && Array.isArray(j.entries)) {
      j.entries = j.entries.filter(function (e) { return !(e && e.id === entry.id); });
      j.entries.push(entry);
      storageSet(JOURNAL_KEY, j);
    } else {
      storageSet(JOURNAL_KEY, [entry]);
    }
    return entry;
  }

  /* ------------------------------------------------------------------ *
   * Data loading
   * ------------------------------------------------------------------ */
  function perSession(interval) { return INTRADAY_PER_SESSION[interval] || 1; }
  function tradingDaysBetween(start, end) {
    if (BT.data && BT.data.calendar) return BT.data.calendar.tradingDaysBetween(start, end);
    var out = [], d = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
    while (d <= e) { var wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  /** defaultEnd(start, interval) → the end date that gives a sensible session length for the interval. */
  function defaultEnd(start, interval) {
    var n = DEFAULT_SESSIONS[interval] || DEFAULT_SESSIONS['1day'];
    var d = start;
    if (BT.data && BT.data.calendar) {
      var cal = BT.data.calendar;
      if (!cal.isTradingDay(d)) d = cal.nextTradingDay(d);
      for (var i = 1; i < n; i++) d = cal.nextTradingDay(d);
      return d;
    }
    var dt = new Date(start + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + Math.ceil(n * 7 / 5)); return dt.toISOString().slice(0, 10);
  }
  /** How many bars a start→end span needs, including warm-up; `truncated` when it exceeds the demo cap. */
  function barBudget(interval, start, end) {
    var days = tradingDaysBetween(start, end).length;
    var per = interval === '1day' ? 1 : perSession(interval);
    var wanted = days * per + WARMUP;
    return { days: days, per: per, wanted: wanted, limit: Math.min(MAX_LIMIT, Math.max(2, wanted)), truncated: wanted > MAX_LIMIT };
  }

  /**
   * loadBars({symbol, interval, start, end}) → Promise<{bars, startIndex, source, note, truncated, start, end}>
   * Demo data is generated deterministically up to the end date's close, so a
   * past session is reproducible for every student. With a live provider the
   * engine uses its candles when they cover the start date, otherwise it falls
   * back to demo and says so in `note`.
   */
  function loadBars(req) {
    req = req || {};
    var data = BT.data;
    if (!data) return Promise.reject(new Error('BT.replay.loadBars needs BT.data (load js/data.js first).'));
    var symbol = normSymbol(req.symbol || 'AAPL') || 'AAPL';
    var interval = (data.INTERVALS || ['1day', '1h', '15min', '5min', '1min']).indexOf(req.interval) >= 0 ? req.interval : '1day';
    var today = todayStr();
    var start = isDate(req.start) ? req.start : null;
    var end = isDate(req.end) ? req.end : null;
    if (!start) { start = defaultEndBack(today, interval); }
    if (!end || end < start) end = defaultEnd(start, interval);
    if (end > today) end = today;
    if (start > end) start = end;
    var budget = barBudget(interval, start, end);
    var endMs = closeMsOf(end);
    var nowMs = Date.now();
    var clockMs = Math.min(endMs, nowMs);

    function fromDemo(note) {
      var bars = data.demo(symbol, interval, budget.limit, clockMs);
      return finishLoad(bars, 'demo', note);
    }
    function finishLoad(bars, source, note) {
      var kept = [];
      for (var i = 0; i < bars.length; i++) { if (barDay(bars[i].time) <= end) kept.push(bars[i]); }
      if (kept.length < 2) throw new Error(T('No bars available for {symbol} up to {date}.', { symbol: symbol, date: end }));
      var startIndex = -1;
      for (var j = 0; j < kept.length; j++) { if (barDay(kept[j].time) >= start) { startIndex = j; break; } }
      if (startIndex < 0 || startIndex >= kept.length - 1) throw new Error(T('No bars after the start date {date} for {symbol} {interval}. Pick an earlier start or a later end.', { date: start, symbol: symbol, interval: interval }));
      var notes = [];
      if (note) notes.push(note);
      if (budget.truncated) notes.push(T('That span needs {wanted} bars; the engine loads at most {max}, so the session starts at {time}.', { wanted: budget.wanted.toLocaleString(), max: MAX_LIMIT.toLocaleString(), time: fmtTime(kept[startIndex].time) }));
      if (startIndex === 0) notes.push(T('No warm-up history before the start date: indicators such as SMA 50 appear once enough bars are revealed.'));
      kept.symbol = symbol; kept.interval = interval; kept.source = source;
      return { bars: kept, startIndex: startIndex, source: source, note: notes.join(' ') || null, truncated: budget.truncated, start: start, end: end, symbol: symbol, interval: interval };
    }

    var st = null;
    try { st = typeof data.status === 'function' ? data.status() : null; } catch (e) { st = null; }
    var live = !!(st && st.live);
    if (!live) return new Promise(function (resolve, reject) { try { resolve(fromDemo(null)); } catch (e) { reject(e); } });

    return data.candles(symbol, interval, budget.limit).then(function (bars) {
      if (!bars || !bars.length) return fromDemo(T('The data provider returned no candles; showing demo data.'));
      if (bars.fallback) return fromDemo(bars.reason || T('The data provider was unavailable; showing demo data.'));
      var firstDay = barDay(bars[0].time);
      if (firstDay > start) return fromDemo(T('Your provider\'s free history for {symbol} {interval} starts on {date}, after your start date, so this replay uses demo data.', { symbol: symbol, interval: interval, date: firstDay }));
      return finishLoad(bars, bars.source || (st && st.provider) || 'live', null);
    }).catch(function (e) {
      return fromDemo(T('Live candles failed ({error}); showing demo data.', { error: e && e.message ? e.message : e }));
    });
  }
  function defaultEndBack(today, interval) {
    // a default start date when the UI gives none: one default span before today
    var n = DEFAULT_SESSIONS[interval] || DEFAULT_SESSIONS['1day'];
    if (BT.data && BT.data.calendar) { var days = BT.data.calendar.tradingDays(today, n + 1); return days[0]; }
    var dt = new Date(today + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - Math.ceil(n * 7 / 5)); return dt.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  BT.replay = {
    ACCOUNT: ACCOUNT,
    SESSIONS_KEY: SESSIONS_KEY,
    JOURNAL_KEY: JOURNAL_KEY,
    DRILLS_URL: DRILLS_URL,
    SPEEDS: SPEEDS,
    WARMUP: WARMUP,
    MAX_LIMIT: MAX_LIMIT,
    HONESTY: HONESTY,
    createSession: createSession,
    loadBars: loadBars,
    barBudget: barBudget,
    defaultEnd: defaultEnd,
    loadDrills: loadDrills,
    setDrills: setDrills,
    getDrill: getDrill,
    drills: null,
    evaluateDrill: evaluateDrill,
    sessions: sessions,
    saveSession: saveSession,
    clearSessions: clearSessions,
    toJournalEntry: toJournalEntry,
    saveToJournal: saveToJournal,
    summaryText: summaryText,
    tickPath: tickPath,
    intrabar: intrabar,
    partialBar: partialBar,
    MIN_TICKS: MIN_TICKS,
    MAX_TICKS: MAX_TICKS,
    barDay: barDay,
    toMs: toMs,
    fmtTime: fmtTime,
    version: '0.3.0'
  };
})();
