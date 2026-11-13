/* Broward Trading — js/paper.js → BT.paper
 *
 * The paper-trading portfolio engine. Nothing here touches the DOM or the
 * network; it is a pure bookkeeping module that the dashboard, the portfolio
 * page and the course exercises all share. State is persisted in localStorage
 * under the key `bt.portfolio`.
 *
 * What it models (and teaches):
 *   - Cash account that starts at $100,000 of play money.
 *   - Market, limit, stop and stop-limit orders with real trigger semantics,
 *     filled against each bar's high/low so students see when and why an
 *     order would (or would not) have executed.
 *   - Long and short positions. Negative quantity = short. Shorting requires
 *     margin: after the sale your cash must cover 150 % of everything you are
 *     short (the classic Reg-T style initial requirement, simplified).
 *   - Average-cost accounting, realized and unrealized P&L, commissions.
 *   - Options contracts (OCC-style ids, multiplier 100) bought or written for
 *     a premium.
 *   - An equity curve and the performance statistics traders actually quote:
 *     total return, win rate, profit factor, max drawdown and Sharpe ratio.
 *
 * All money is in dollars as JavaScript numbers (never strings). Prices and
 * cash are rounded to the cent where they are stored.
 *
 * Multiple accounts (v0.3): BT.paper.use(id) switches the active account.
 * 'main' (the default) keeps the historical storage key `bt.portfolio`;
 * any other id ('replay' for Market Replay, 'class-a', ...) is stored under
 * `bt.portfolio.<id>`. Every other function acts on the active account.
 * League accounts use ids 'league:<CODE>' (stored as `bt.portfolio.league-<code>`).
 *
 * Realism (v0.5) — every switch lives in `settings` and is OFF by default, so
 * an account that never touches them behaves exactly as before:
 *   fillModel      'instant' (default) | 'volume': a fill may take at most
 *                  maxVolumePct (10 %) of a bar's volume; the rest of the order
 *                  stays open as a partial fill and keeps filling on later bars.
 *   slippageBps    basis points added to market/stop fills against you
 *                  (buys fill higher, sells lower). Limits never fill past the limit.
 *   commissionPreset 'per-trade' (default: flat `commission` per order, $0 unless
 *                  set) | 'zero' | 'per-share' ($0.005/share, $1 minimum, capped at
 *                  1 % of the trade; options $0.65 per contract).
 *   dividends      true → approximate quarterly dividends for dividend payers on
 *                  their ex-dates: credited to longs, debited from shorts.
 *   cashInterestPct annual % paid on free cash, accrued daily.
 *   borrowFeePct   annual % charged on short stock value, accrued daily.
 *   pdtRule        true → block a 4th day trade within 5 business days while
 *                  equity is under $25,000 (the US pattern-day-trader rule).
 */
(function () {
  'use strict';
  window.BT = window.BT || {};

  var STORAGE_KEY = 'bt.portfolio';          // the 'main' account (backward compatible)
  var ACCOUNTS_KEY = 'bt.portfolio.accounts'; // registry of account ids that have been used
  var MAIN_ACCOUNT = 'main';
  var DEFAULT_CASH = 100000;
  var SHORT_MARGIN = 1.5;        // cash must cover 150 % of short market value
  var NAKED_OPTION_MARGIN = 0.2; // plus 20 % of strike notional for written options
  var MS_PER_MINUTE = 60000;
  var TRADING_DAYS = 252;
  var MS_PER_DAY = 86400000;
  var PDT_EQUITY = 25000;        // FINRA pattern-day-trader minimum equity
  var PDT_MAX_DAY_TRADES = 3;    // a 4th day trade inside 5 business days is blocked
  var PDT_WINDOW_DAYS = 5;
  var FILL_MODELS = ['instant', 'volume'];
  var COMMISSION_PRESETS = {
    'zero': { label: 'Zero commission', description: 'No commission, like most US app brokers today. You still pay the bid/ask spread and any slippage.', commission: 0 },
    'per-share': { label: 'Per share', description: '$0.005 per share with a $1.00 minimum and a cap of 1 % of the trade value (options: $0.65 per contract). Common at brokers aimed at active traders.', perShare: 0.005, perShareMin: 1, perShareMaxPct: 1, perContract: 0.65 },
    'per-trade': { label: 'Flat per trade', description: 'A fixed fee per order, like $4.95, the way most brokers charged before 2019. Small trades become expensive in percentage terms.', commission: 4.95 }
  };
  function defaultSettings() {
    return {
      commission: 0,               // flat $ per order when commissionPreset is 'per-trade'
      commissionPreset: 'per-trade',
      perShare: 0.005, perShareMin: 1, perShareMaxPct: 1, perContract: 0.65,
      fillModel: 'instant',
      maxVolumePct: 10,
      slippageBps: 0,
      dividends: false,
      cashInterestPct: 0,
      borrowFeePct: 0,
      pdtRule: false
    };
  }
  // Translate a dynamic string when js/i18n.js is loaded; plain interpolation otherwise.
  function T(s, v) {
    if (window.BT && typeof window.BT.t === 'function') { try { return window.BT.t(s, v); } catch (e) { /* fall through */ } }
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; });
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function cents(v) { return Math.round(v * 100) / 100; }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }
  function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  function money(v) {
    var neg = v < 0; v = Math.abs(v);
    var s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + s;
  }
  function normSymbol(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

  // Injectable clock so tests (and course replays) can control "now".
  var clock = function () { return Date.now(); };
  function now() { return clock(); }

  // Day key for a wall-clock timestamp (local time) — used for day P&L.
  function dayKeyOf(ms) {
    var d = new Date(ms);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  // Day key for a bar time: 'YYYY-MM-DD' strings pass through; unix seconds are
  // converted in UTC so the result is stable regardless of the viewer's zone.
  function barDay(time) {
    if (typeof time === 'string') return time.slice(0, 10);
    if (isNum(time)) return new Date(time < 1e11 ? time * 1000 : time).toISOString().slice(0, 10);
    return null;
  }
  // Normalise any bar/fill time to wall-clock milliseconds so the UI can sort,
  // filter and format every trade the same way:
  //   'YYYY-MM-DD'  → that day's 4 pm New York close (stamped at 21:00 UTC)
  //   ISO string    → Date.parse
  //   unix seconds  → × 1000 (anything below 1e11 is treated as seconds)
  //   milliseconds  → unchanged; anything unusable → now()
  function toMs(t) {
    if (typeof t === 'string') {
      // A bare date is a daily bar; stamp it at the 4 pm ET close (21:00 UTC,
      // 20:00 UTC in summer — we use 21:00 so it never sorts before an intraday
      // fill from the same session).
      var parsed = Date.parse(t.length === 10 ? t + 'T21:00:00Z' : t);
      return isNum(parsed) ? parsed : now();
    }
    if (isNum(t)) return t < 1e11 ? Math.round(t * 1000) : t;
    return now();
  }

  /* ------------------------------------------------------------------ *
   * Storage shim — localStorage may be missing (node) or throw (private
   * windows), so every access is guarded.
   * ------------------------------------------------------------------ */
  function storageGet(key) {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : (window.localStorage || null);
      if (!ls) return null;
      var raw = ls.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : (window.localStorage || null);
      if (!ls) return false;
      ls.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }
  function storageRemove(key) {
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : (window.localStorage || null);
      if (!ls) return false;
      ls.removeItem(key);
      return true;
    } catch (e) { return false; }
  }
  // Every stored key, when the storage supports enumeration (browsers do; test shims may not).
  function storageKeys() {
    var out = [];
    try {
      var ls = (typeof localStorage !== 'undefined') ? localStorage : (window.localStorage || null);
      if (!ls || typeof ls.key !== 'function' || !isNum(ls.length)) return out;
      for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (typeof k === 'string') out.push(k); }
    } catch (e) { /* ignore */ }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Accounts — which localStorage key the active account lives under
   * ------------------------------------------------------------------ */
  function normAccountId(id) {
    var s = String(id == null ? MAIN_ACCOUNT : id).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return s || MAIN_ACCOUNT;
  }
  function keyFor(id) { return id === MAIN_ACCOUNT ? STORAGE_KEY : STORAGE_KEY + '.' + id; }
  var activeAccount = MAIN_ACCOUNT;

  function readRegistry() {
    var reg = storageGet(ACCOUNTS_KEY);
    var ids = Array.isArray(reg) ? reg.filter(function (x) { return typeof x === 'string'; }).map(normAccountId) : [];
    if (ids.indexOf(MAIN_ACCOUNT) === -1) ids.unshift(MAIN_ACCOUNT);
    return ids;
  }
  function rememberAccount(id) {
    var ids = readRegistry();
    if (ids.indexOf(id) === -1) { ids.push(id); storageSet(ACCOUNTS_KEY, ids); }
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  function freshState(startingCash) {
    var cash = isNum(startingCash) && startingCash > 0 ? cents(startingCash) : DEFAULT_CASH;
    return {
      version: 2,
      cash: cash,
      startingCash: cash,
      positions: {},            // SYM → {qty, avg, kind:'stock'|'option', meta}
      orders: [],               // every order ever placed, newest last
      trades: [],               // every fill, newest last
      equityHistory: [],        // [{t (ms), equity}]
      realized: 0,              // cumulative realized P&L net of commissions
      marks: {},                // last known price per symbol / contract
      dayStart: null,           // {day, equity} for day P&L
      nextId: 1,
      createdAt: now(),
      settings: defaultSettings(),
      cashflows: [],            // dividends, interest and borrow fees: [{id, type, symbol, amount, time, day, note}]
      income: { dividends: 0, interest: 0, borrowFees: 0 },
      accrual: { lastDay: null, carryInterest: 0, carryBorrow: 0 },
      lastBarDay: {}            // SYM → last bar day seen by processOrders (dividend ex-date detection)
    };
  }

  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function numIn(v, lo, hi, d) { return isNum(v) && v >= lo && v <= hi ? v : d; }
  // Merge a (possibly partial or corrupted) settings object onto `base`.
  function mergeSettings(base, src) {
    var s = base;
    if (!src || typeof src !== 'object') return s;
    if ('commission' in src) s.commission = numIn(src.commission, 0, 1e6, s.commission);
    if (src.commissionPreset != null && COMMISSION_PRESETS[src.commissionPreset]) s.commissionPreset = src.commissionPreset;
    if ('perShare' in src) s.perShare = numIn(src.perShare, 0, 100, s.perShare);
    if ('perShareMin' in src) s.perShareMin = numIn(src.perShareMin, 0, 1e4, s.perShareMin);
    if ('perShareMaxPct' in src) s.perShareMaxPct = numIn(src.perShareMaxPct, 0, 100, s.perShareMaxPct);
    if ('perContract' in src) s.perContract = numIn(src.perContract, 0, 1e3, s.perContract);
    if (FILL_MODELS.indexOf(src.fillModel) !== -1) s.fillModel = src.fillModel;
    if ('maxVolumePct' in src) s.maxVolumePct = numIn(src.maxVolumePct, 0.01, 100, s.maxVolumePct);
    if ('slippageBps' in src) s.slippageBps = numIn(src.slippageBps, 0, 1000, s.slippageBps);
    s.dividends = bool(src.dividends, s.dividends);
    if ('cashInterestPct' in src) s.cashInterestPct = numIn(src.cashInterestPct, 0, 25, s.cashInterestPct);
    if ('borrowFeePct' in src) s.borrowFeePct = numIn(src.borrowFeePct, 0, 200, s.borrowFeePct);
    s.pdtRule = bool(src.pdtRule, s.pdtRule);
    return s;
  }

  var state = freshState(DEFAULT_CASH);

  function sanitize(saved) {
    // Merge a stored object onto a fresh state so older saves keep working.
    var s = freshState(isNum(saved && saved.startingCash) ? saved.startingCash : DEFAULT_CASH);
    if (!saved || typeof saved !== 'object') return s;
    if (isNum(saved.cash)) s.cash = saved.cash;
    if (saved.positions && typeof saved.positions === 'object') {
      Object.keys(saved.positions).forEach(function (k) {
        var p = saved.positions[k];
        if (p && isNum(p.qty) && p.qty !== 0 && isNum(p.avg)) {
          s.positions[k] = {
            qty: p.qty, avg: p.avg,
            kind: p.kind === 'option' ? 'option' : 'stock',
            meta: (p.meta && typeof p.meta === 'object') ? p.meta : {}
          };
        }
      });
    }
    if (Array.isArray(saved.orders)) {
      s.orders = [];
      saved.orders.forEach(function (o) {
        // A corrupted order that reaches the fill engine would turn cash into
        // NaN, so only structurally sound orders survive a reload.
        if (!o || typeof o !== 'object' || !isNum(o.id)) return;
        if (typeof o.symbol !== 'string' || !(isNum(o.qty) && o.qty > 0)) return;
        if (o.side !== 'buy' && o.side !== 'sell') return;
        if (ORDER_TYPES.indexOf(o.type) === -1) return;
        if (o.status === 'open' && validateOrder(o)) {
          o.status = 'rejected';
          o.reason = 'Corrupted order dropped on load: ' + validateOrder(o);
        }
        s.orders.push(o);
      });
    }
    if (Array.isArray(saved.trades)) s.trades = saved.trades.filter(function (t) { return t && isNum(t.qty); });
    if (Array.isArray(saved.equityHistory)) s.equityHistory = saved.equityHistory.filter(function (e) { return e && isNum(e.t) && isNum(e.equity); });
    if (isNum(saved.realized)) s.realized = saved.realized;
    if (saved.marks && typeof saved.marks === 'object') {
      Object.keys(saved.marks).forEach(function (k) { if (isNum(saved.marks[k])) s.marks[k] = saved.marks[k]; });
    }
    if (saved.dayStart && typeof saved.dayStart === 'object' && typeof saved.dayStart.day === 'string' && isNum(saved.dayStart.equity)) {
      s.dayStart = { day: saved.dayStart.day, equity: saved.dayStart.equity };
    }
    if (isNum(saved.nextId)) s.nextId = saved.nextId;
    if (isNum(saved.createdAt)) s.createdAt = saved.createdAt;
    if (saved.settings && typeof saved.settings === 'object') {
      s.settings = mergeSettings(defaultSettings(), saved.settings);
      s.settings.commission = isNum(saved.settings.commission) && saved.settings.commission >= 0 ? saved.settings.commission : 0;
    }
    if (Array.isArray(saved.cashflows)) s.cashflows = saved.cashflows.filter(function (c) { return c && isNum(c.amount) && typeof c.type === 'string'; });
    if (saved.income && typeof saved.income === 'object') {
      ['dividends', 'interest', 'borrowFees'].forEach(function (k) { if (isNum(saved.income[k])) s.income[k] = saved.income[k]; });
    }
    if (saved.accrual && typeof saved.accrual === 'object') {
      if (typeof saved.accrual.lastDay === 'string') s.accrual.lastDay = saved.accrual.lastDay;
      if (isNum(saved.accrual.carryInterest)) s.accrual.carryInterest = saved.accrual.carryInterest;
      if (isNum(saved.accrual.carryBorrow)) s.accrual.carryBorrow = saved.accrual.carryBorrow;
    }
    if (saved.lastBarDay && typeof saved.lastBarDay === 'object') {
      Object.keys(saved.lastBarDay).forEach(function (k) { if (typeof saved.lastBarDay[k] === 'string') s.lastBarDay[k] = saved.lastBarDay[k]; });
    }
    // nextId must stay ahead of any stored order/trade id
    var maxId = 0;
    s.orders.concat(s.trades, s.cashflows).forEach(function (x) { if (isNum(x.id) && x.id > maxId) maxId = x.id; });
    if (s.nextId <= maxId) s.nextId = maxId + 1;
    return s;
  }

  function load() {
    state = sanitize(storageGet(keyFor(activeAccount)));
    return state;
  }
  function save() {
    if (activeAccount !== MAIN_ACCOUNT) rememberAccount(activeAccount);
    return storageSet(keyFor(activeAccount), state);
  }

  /**
   * use(accountId) → state
   * Switch the active account. The current account is already persisted on
   * every mutation, so switching simply loads the other account's saved state
   * (a fresh $100,000 account when it has never been used). 'main' is the
   * default and keeps the legacy `bt.portfolio` key; other ids live under
   * `bt.portfolio.<id>`. Returns the now-active state.
   *
   * The outgoing account is deliberately NOT written back from memory: another
   * tab (the Dashboard on 'main' while Replay or Journal is open) may have
   * traded since this page loaded, and writing this page's stale snapshot would
   * erase those fills. The only write is for an account that has never been
   * stored at all, so its fresh state is visible to accounts() in other tabs.
   */
  function use(accountId) {
    var id = normAccountId(accountId);
    if (id === activeAccount) return state;
    if (storageGet(keyFor(activeAccount)) == null) save();
    activeAccount = id;
    load();
    if (id !== MAIN_ACCOUNT) rememberAccount(id);
    return state;
  }
  function account() { return activeAccount; }

  /**
   * accounts() → [{id, equity, cash, startingCash, positions, trades, active, storageKey}]
   * Every account that has been used (the registry plus any `bt.portfolio.*`
   * key found in storage), valued at its last known marks. 'main' is always
   * listed first.
   */
  function accounts() {
    var ids = readRegistry();
    storageKeys().forEach(function (k) {
      if (k === STORAGE_KEY) return;
      // 'bt.portfolio.ui' is the portfolio page's UI preferences, not an account.
      if (k.indexOf(STORAGE_KEY + '.') === 0 && k !== ACCOUNTS_KEY && k !== STORAGE_KEY + '.ui' && k.indexOf('.', STORAGE_KEY.length + 1) === -1) {
        var id = normAccountId(k.slice(STORAGE_KEY.length + 1));
        if (ids.indexOf(id) === -1) ids.push(id);
      }
    });
    if (ids.indexOf(activeAccount) === -1) ids.push(activeAccount);
    var current = state;
    var out = ids.map(function (id) {
      var st = id === activeAccount ? current : sanitize(storageGet(keyFor(id)));
      var saved = state; state = st;              // valuation() reads the module-level state
      var v = valuation({});
      state = saved;
      return {
        id: id,
        equity: cents(st.cash + v.marketValue),
        cash: st.cash,
        startingCash: st.startingCash,
        positions: Object.keys(st.positions).length,
        trades: st.trades.length,
        active: id === activeAccount,
        storageKey: keyFor(id)
      };
    });
    return out;
  }

  /** deleteAccount(id): remove a non-main account's saved state (switches to 'main' if it was active). */
  function deleteAccount(accountId) {
    var id = normAccountId(accountId);
    if (id === MAIN_ACCOUNT) return false;
    if (id === activeAccount) { activeAccount = MAIN_ACCOUNT; load(); }
    storageRemove(keyFor(id));
    storageSet(ACCOUNTS_KEY, readRegistry().filter(function (x) { return x !== id; }));
    return true;
  }
  function reset(startingCash) {
    // Settings are preferences, not history: a reset keeps them (commission, realism switches).
    var keep = mergeSettings(defaultSettings(), state.settings);
    keep.commission = state.settings.commission;
    state = freshState(startingCash == null ? DEFAULT_CASH : startingCash);
    state.settings = keep;
    save();
    return state;
  }
  function getState() { return state; }
  /**
   * setSettings(patch) → settings
   * Accepts any subset of the settings documented at the top of this file;
   * invalid values are ignored. Interest and borrow fees owed under the old
   * rates are settled first, so a rate change never applies retroactively.
   * Giving a flat `commission` while the preset is 'zero' switches the preset
   * to 'per-trade' (so `setSettings({commission: 1})` keeps its v0.2 meaning).
   */
  function setSettings(patch) {
    patch = patch || {};
    accrue(now());
    var hadPreset = patch.commissionPreset != null && COMMISSION_PRESETS[patch.commissionPreset];
    mergeSettings(state.settings, patch);
    if (!hadPreset && isNum(patch.commission) && patch.commission > 0 && state.settings.commissionPreset === 'zero') state.settings.commissionPreset = 'per-trade';
    save();
    return state.settings;
  }
  /** applyCommissionPreset(id): switch preset AND load its typical numbers (e.g. $4.95 per trade). */
  function applyCommissionPreset(id) {
    var p = COMMISSION_PRESETS[id];
    if (!p) return null;
    var patch = { commissionPreset: id };
    ['commission', 'perShare', 'perShareMin', 'perShareMaxPct', 'perContract'].forEach(function (k) { if (k in p) patch[k] = p[k]; });
    return setSettings(patch);
  }

  /* ------------------------------------------------------------------ *
   * Positions & marks
   * ------------------------------------------------------------------ */
  function multiplierOf(pos) {
    return (pos && pos.meta && isNum(pos.meta.multiplier) && pos.meta.multiplier > 0) ? pos.meta.multiplier : 1;
  }
  function markOf(symbol, prices) {
    if (prices && isNum(prices[symbol])) return prices[symbol];
    if (isNum(state.marks[symbol])) return state.marks[symbol];
    var p = state.positions[symbol];
    return p ? p.avg : null;
  }
  // Total market value of everything we are short (positive number), valuing
  // `overrideSym` at `overridePrice` and adding `extraQty` more units of it.
  // `extraQty` may be negative to value the shorts that remain after covering
  // that many units of `overrideSym`. `extraMult` is the contract multiplier
  // for a brand-new short (no position yet), so a written option counts ×100.
  function shortExposure(overrideSym, overridePrice, extraQty, extraMult) {
    var total = 0;
    var p2 = state.positions[overrideSym];
    var mult2 = p2 ? multiplierOf(p2) : (isNum(extraMult) && extraMult > 0 ? extraMult : 1);
    Object.keys(state.positions).forEach(function (sym) {
      var p = state.positions[sym];
      if (p.qty >= 0) return;
      var px = sym === overrideSym ? overridePrice : markOf(sym);
      var units = Math.abs(p.qty);
      if (sym === overrideSym && extraQty < 0) units = Math.max(0, units + extraQty); // covering reduces exposure
      total += units * (isNum(px) ? px : p.avg) * multiplierOf(p);
    });
    if (extraQty > 0) total += extraQty * overridePrice * mult2;
    return total;
  }
  function nakedOptionRequirement(meta, qty) {
    if (!meta || meta.multiplier !== 100 || !isNum(meta.strike)) return 0;
    return NAKED_OPTION_MARGIN * meta.strike * meta.multiplier * qty;
  }
  // Strike-notional margin on every written option we would still hold after
  // buying back `coverQty` units of `symbol`.
  function nakedOptionRequirementAfterBuy(symbol, coverQty) {
    var total = 0;
    Object.keys(state.positions).forEach(function (sym) {
      var p = state.positions[sym];
      if (p.qty >= 0 || p.kind !== 'option') return;
      var units = Math.abs(p.qty) - (sym === symbol ? coverQty : 0);
      if (units > 0) total += nakedOptionRequirement(p.meta, units);
    });
    return total;
  }

  /* ------------------------------------------------------------------ *
   * Pre-trade checks — return a human-readable reason or null when OK
   * ------------------------------------------------------------------ */
  function checkFill(symbol, side, qty, price, kind, meta, commissionOverride) {
    var pos = state.positions[symbol];
    var mult = pos ? multiplierOf(pos) : ((meta && isNum(meta.multiplier)) ? meta.multiplier : 1);
    var commission = isNum(commissionOverride) ? commissionOverride : commissionFor(qty, price, mult, kind, true);
    var gross = qty * price * mult;

    if (side === 'buy') {
      var coverQty = pos && pos.qty < 0 ? Math.min(-pos.qty, qty) : 0;
      var openQty = qty - coverQty;
      var cashAfter = state.cash - gross - commission;
      if (openQty > 0 && cashAfter < 0) {
        var affordable = Math.floor((state.cash - commission) / (price * mult));
        return 'Not enough cash: ' + (openQty === qty ? 'buying ' : 'the part of this order that opens a new long position, ') +
          qty + ' × ' + money(price) + (mult !== 1 ? ' × ' + mult : '') + ' = ' + money(gross) +
          (commission ? ' plus ' + money(commission) + ' commission' : '') +
          ', but you only have ' + money(state.cash) + '.' +
          (affordable > 0 ? ' You could afford up to ' + affordable + '.' : '');
      }
      // Spending cash must not leave the shorts you keep under-margined —
      // otherwise the 150 % rule could be sidestepped one order later.
      var remainingExposure = shortExposure(symbol, price, -coverQty, mult);
      if (remainingExposure > 0) {
        var stillRequired = SHORT_MARGIN * remainingExposure + nakedOptionRequirementAfterBuy(symbol, coverQty);
        if (cashAfter < stillRequired) {
          return 'Buy rejected: this purchase would leave you with ' + money(cashAfter) + ' in cash, but your remaining short positions (' +
            money(remainingExposure) + ' of exposure) need ' + money(stillRequired) + ' held as margin (' + (SHORT_MARGIN * 100) +
            ' %). Buying it would leave your remaining shorts under-margined — cover some shorts first, or buy less.';
        }
      }
      return null;
    }

    // sell: anything beyond what we hold long opens (or adds to) a short
    var longQty = pos && pos.qty > 0 ? pos.qty : 0;
    var shortOpen = Math.max(0, qty - longQty);
    if (shortOpen === 0) return null;

    var cashAfterSell = state.cash + gross - commission;
    var exposure = shortExposure(symbol, price, shortOpen, mult);
    // strike-notional margin on the contracts written now plus every other option already written
    var required = SHORT_MARGIN * exposure + nakedOptionRequirement(meta || (pos && pos.meta), shortOpen) + nakedOptionRequirementAfterBuy(symbol, 0);
    if (cashAfterSell < required) {
      var what = kind === 'option' ? 'writing' : 'shorting';
      return 'Short sale rejected: ' + what + ' ' + shortOpen + ' ' + symbol + ' would leave you with ' + money(cashAfterSell) +
        ' in cash, but the margin rule needs ' + money(required) + ' (' + (SHORT_MARGIN * 100) + ' % of your total short exposure of ' +
        money(exposure) + (kind === 'option' ? ' plus 20 % of the strike notional' : '') + '). Short less, or close other shorts first.';
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Realism helpers: commissions, slippage, pattern-day-trader rule
   * ------------------------------------------------------------------ */
  function round4(v) { return Math.round(v * 1e4) / 1e4; }

  /**
   * commissionFor(qty, price, multiplier, kind, firstFill) → dollars
   * 'zero' → 0; 'per-trade' → the flat fee, charged once per order (on its
   * first fill); 'per-share' → perShare × shares with a perShareMin minimum on
   * the first fill, capped at perShareMaxPct of the trade value; options pay
   * perContract × contracts.
   */
  function commissionFor(qty, price, mult, kind, firstFill) {
    var s = state.settings;
    if (firstFill == null) firstFill = true;
    if (s.commissionPreset === 'zero') return 0;
    if (s.commissionPreset === 'per-share') {
      if (kind === 'option' || mult === 100) return cents(s.perContract * qty);
      var c = s.perShare * qty;
      if (firstFill) c = Math.max(c, s.perShareMin);
      var cap = (s.perShareMaxPct / 100) * qty * (isNum(price) ? price : 0) * (mult || 1);
      if (s.perShareMaxPct > 0 && cap > 0) c = Math.min(c, cap);
      return cents(c);
    }
    return firstFill ? s.commission : 0;
  }

  /**
   * slipPrice(side, price, type, limitPrice) → the price you actually get.
   * Market and stop fills (and anything that becomes a market order) are moved
   * slippageBps against you: buys higher, sells lower. A plain limit order is
   * never slipped, and a stop-limit is never slipped past its limit.
   */
  function slipPrice(side, price, type, limitPrice) {
    var bps = state.settings.slippageBps;
    if (!(bps > 0) || !isNum(price) || type === 'limit') return price;
    var out = round4(price * (side === 'buy' ? 1 + bps / 10000 : 1 - bps / 10000));
    if (type === 'stop_limit' && isNum(limitPrice)) out = side === 'buy' ? Math.min(out, limitPrice) : Math.max(out, limitPrice);
    return Math.max(0, out);
  }

  // Trading day of a fill: daily bar strings keep their own date; anything else is the local day.
  function fillDay(time) {
    if (typeof time === 'string' && /^\d{4}-\d{2}-\d{2}/.test(time)) return time.slice(0, 10);
    return dayKeyOf(toMs(time == null ? now() : time));
  }
  function tradeDay(t) {
    if (typeof t.barTime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.barTime)) return t.barTime.slice(0, 10);
    return isNum(t.time) ? dayKeyOf(t.time) : null;
  }
  // `day` itself (even a weekend: crypto and late-evening clocks trade then)
  // plus the weekdays before it, `n` days in all, newest first.
  function businessDays(day, n) {
    var out = [];
    var d = new Date(day + 'T12:00:00Z');
    if (!isNum(d.getTime())) return out;
    out.push(day);
    d = new Date(d.getTime() - MS_PER_DAY);
    while (out.length < n) {
      var wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() - MS_PER_DAY);
    }
    return out;
  }
  // Would a `side` fill of `symbol` on `day` close shares that were opened that same day?
  // FINRA day-trade accounting treats shares held overnight as sold first, so
  // selling part of a position that was added to today is only a day trade
  // once the closing quantity exceeds what was still held from before today.
  function isDayTrade(symbol, side, day, qty) {
    var pos = state.positions[symbol];
    if (!pos || pos.qty === 0) return false;
    var closing = side === 'buy' ? pos.qty < 0 : pos.qty > 0;
    if (!closing) return false;
    var dir = pos.qty > 0 ? 1 : -1;
    var today = state.trades.filter(function (t) { return t.symbol === symbol && tradeDay(t) === day; });
    var openedToday = today.some(function (t) { return t.side === (dir > 0 ? 'buy' : 'sell') && t.openedQty > 0; });
    if (!openedToday) return false;
    // Position at the start of the day = current position minus today's fills.
    var startQty = pos.qty;
    today.forEach(function (t) { startQty -= t.side === 'buy' ? t.qty : -t.qty; });
    var overnightLeft = sign(startQty) === dir ? Math.abs(startQty) : 0;
    // Today's earlier closing fills used up the overnight shares first.
    today.forEach(function (t) { if (t.closedQty > 0) overnightLeft = Math.max(0, overnightLeft - t.closedQty); });
    var closeQty = Math.min(isNum(qty) && qty > 0 ? qty : Math.abs(pos.qty), Math.abs(pos.qty));
    return closeQty > overnightLeft + 1e-9;
  }
  /**
   * dayTradeCount(day?) → day trades in the 5 business days ending on `day` (default today).
   * One closing order counts once, however many partial fills it took.
   */
  function dayTradeCount(day) {
    day = day || fillDay(now());
    var win = businessDays(day, PDT_WINDOW_DAYS);
    var seen = {};
    state.trades.forEach(function (t) {
      if (t.dayTrade && win.indexOf(tradeDay(t)) !== -1) seen[t.orderId != null ? 'o' + t.orderId : 't' + t.id] = true;
    });
    return Object.keys(seen).length;
  }
  /** pdtStatus(day?) → {enabled, dayTrades, max, equity, minEquity, restricted, remaining} */
  function pdtStatus(day) {
    var equity = cents(state.cash + valuation({}).marketValue);
    var count = dayTradeCount(day);
    var restricted = state.settings.pdtRule && equity < PDT_EQUITY;
    return {
      enabled: !!state.settings.pdtRule, dayTrades: count, max: PDT_MAX_DAY_TRADES, windowDays: PDT_WINDOW_DAYS,
      equity: equity, minEquity: PDT_EQUITY, restricted: restricted,
      remaining: restricted ? Math.max(0, PDT_MAX_DAY_TRADES - count) : null
    };
  }
  function pdtBlock(symbol, side, time, qty, orderId) {
    if (!state.settings.pdtRule) return null;
    var day = fillDay(time);
    if (!isDayTrade(symbol, side, day, qty)) return null;
    // A later partial fill of an order already counted as a day trade adds no new one.
    if (orderId != null && state.trades.some(function (t) { return t.orderId === orderId && t.dayTrade && tradeDay(t) === day; })) return null;
    var st = pdtStatus(day);
    if (!st.restricted || st.dayTrades < PDT_MAX_DAY_TRADES) return null;
    return T('Blocked by the pattern day trader (PDT) rule: closing {symbol} today would be your {n}th day trade (opening and closing the same position on the same day) in 5 business days, and your equity of {equity} is under {min}. US brokers stop margin accounts below $25,000 from doing that, so this order did not fill. You can close the position on the next trading day; a stop-loss on a position opened today is blocked the same way. You can turn the PDT rule off in the realism settings.', {
      symbol: symbol, n: st.dayTrades + 1, equity: money(st.equity), min: money(PDT_EQUITY)
    });
  }

  /* ------------------------------------------------------------------ *
   * The fill engine — the only place positions and cash change
   * ------------------------------------------------------------------ */
  // Settle everything owed on the balances as they stood BEFORE a fill changes
  // them: daily interest / borrow fees for the days already elapsed, and any
  // dividend ex-dates since the last bar seen for this symbol (paid to the
  // pre-fill position). Afterwards the symbol's last-seen day is the fill day,
  // so a position opened from flat only receives ex-dates after it.
  // Idempotent: a second call for the same time is a no-op.
  function settleBefore(symbol, kind, time, price) {
    var t = time == null ? now() : time;
    accrue(toMs(t));
    if (kind !== 'option') processDividends(symbol, fillDay(t), t, price);
  }

  function applyFill(symbol, side, qty, price, opts) {
    opts = opts || {};
    var kind = opts.kind || (state.positions[symbol] ? state.positions[symbol].kind : 'stock');
    var meta = opts.meta || (state.positions[symbol] ? state.positions[symbol].meta : {});
    if (!(isNum(qty) && qty > 0 && isNum(price) && price >= 0) || (side !== 'buy' && side !== 'sell')) {
      // Never let a malformed fill reach the books: NaN cash would be saved
      // and silently "repaired" on the next reload, erasing the student's P&L.
      throw new Error('applyFill: invalid fill (symbol ' + symbol + ', side ' + side + ', qty ' + qty + ', price ' + price + ')');
    }
    settleBefore(symbol, kind, opts.time, price);
    var dayTrade = isDayTrade(symbol, side, fillDay(opts.time), qty);
    var pos = state.positions[symbol] || { qty: 0, avg: 0, kind: kind, meta: meta };
    var mult = multiplierOf(pos);
    var commission = isNum(opts.commission) ? opts.commission : commissionFor(qty, price, mult, kind, true);
    var signed = side === 'buy' ? qty : -qty;
    var realized = 0, closedQty = 0, openedQty = 0;
    var prevQty = pos.qty, prevAvg = pos.avg;

    if (pos.qty !== 0 && sign(pos.qty) !== sign(signed)) {
      // Closing (and maybe reversing) the existing position.
      closedQty = Math.min(Math.abs(pos.qty), qty);
      var dir = pos.qty > 0 ? 1 : -1;      // long profits when price > avg; short when price < avg
      realized = (price - pos.avg) * closedQty * mult * dir;
      var left = qty - closedQty;
      if (left > 0) {                      // reversal: new position in the opposite direction at this price
        pos.qty = sign(signed) * left;
        pos.avg = price;
        openedQty = left;
      } else {
        pos.qty = pos.qty + signed;        // partial or full close, average cost unchanged
      }
    } else {
      // Opening or adding in the same direction: weighted average cost.
      var newQty = pos.qty + signed;
      pos.avg = round6((pos.avg * Math.abs(pos.qty) + price * qty) / Math.abs(newQty));
      pos.qty = newQty;
      openedQty = qty;
    }

    var newCash = cents(state.cash - signed * price * mult - commission);
    if (!isNum(newCash) || !isNum(pos.qty) || !isNum(pos.avg)) {
      pos.qty = prevQty; pos.avg = prevAvg; // undo before failing loudly
      throw new Error('applyFill: non-numeric result (symbol ' + symbol + ', qty ' + qty + ', price ' + price + ')');
    }
    state.cash = newCash;
    realized = cents(realized - commission);
    state.realized = cents(state.realized + realized);
    state.marks[symbol] = price;

    if (pos.qty === 0) delete state.positions[symbol];
    else state.positions[symbol] = pos;

    var trade = {
      id: state.nextId++,
      orderId: opts.orderId == null ? null : opts.orderId,
      symbol: symbol,
      side: side,
      qty: qty,
      price: price,
      multiplier: mult,
      commission: commission,
      value: cents(qty * price * mult),
      closedQty: closedQty,
      openedQty: openedQty,
      realized: realized,
      kind: kind,
      time: toMs(opts.time),      // always wall-clock milliseconds
      barTime: opts.time == null ? null : opts.time, // the bar's own time, as given (seconds or 'YYYY-MM-DD')
      note: opts.note || '',
      dayTrade: dayTrade,
      // price before slippage and the dollars slippage cost you (0 when slippage is off)
      basePrice: isNum(opts.basePrice) ? opts.basePrice : price,
      slippage: isNum(opts.basePrice) ? cents(Math.abs(price - opts.basePrice) * qty * mult) : 0
    };
    state.trades.push(trade);
    return trade;
  }

  /* ------------------------------------------------------------------ *
   * Orders
   * ------------------------------------------------------------------ */
  var ORDER_TYPES = ['market', 'limit', 'stop', 'stop_limit'];

  function validateOrder(o) {
    if (!o || typeof o !== 'object') return 'No order given.';
    var symbol = normSymbol(o.symbol);
    if (!symbol) return 'Please enter a ticker symbol.';
    if (o.side !== 'buy' && o.side !== 'sell') return 'Side must be "buy" or "sell".';
    var qty = Number(o.qty);
    if (!isNum(qty) || qty <= 0) return 'Quantity must be a positive number.';
    if (Math.floor(qty) !== qty) return 'Quantity must be a whole number of shares or contracts (fractional trading is not simulated).';
    var type = o.type || 'market';
    if (ORDER_TYPES.indexOf(type) === -1) return 'Unknown order type "' + o.type + '". Use market, limit, stop or stop_limit.';
    if ((type === 'limit' || type === 'stop_limit') && !(isNum(o.limitPrice) && o.limitPrice > 0)) return 'A ' + type.replace('_', '-') + ' order needs a positive limit price.';
    if ((type === 'stop' || type === 'stop_limit') && !(isNum(o.stopPrice) && o.stopPrice > 0)) return 'A ' + type.replace('_', '-') + ' order needs a positive stop price.';
    if (type === 'stop_limit') {
      if (o.side === 'buy' && o.limitPrice < o.stopPrice) return 'For a buy stop-limit the limit price must be at or above the stop price, otherwise it can never fill once triggered.';
      if (o.side === 'sell' && o.limitPrice > o.stopPrice) return 'For a sell stop-limit the limit price must be at or below the stop price, otherwise it can never fill once triggered.';
    }
    if (o.tif != null && o.tif !== 'day' && o.tif !== 'gtc') return 'Time in force must be "day" or "gtc" (good-till-cancelled).';
    return null;
  }

  function makeOrder(o, extra) {
    var order = {
      id: state.nextId++,
      symbol: normSymbol(o.symbol),
      side: o.side,
      qty: Number(o.qty),
      type: o.type || 'market',
      limitPrice: isNum(o.limitPrice) ? o.limitPrice : null,
      stopPrice: isNum(o.stopPrice) ? o.stopPrice : null,
      tif: o.tif === 'day' ? 'day' : 'gtc',
      status: 'open',
      reason: '',
      placedAt: now(),
      filledAt: null,
      fillPrice: null,
      filledQty: 0,
      commission: 0,
      kind: 'stock',
      meta: {},
      triggered: false,
      firstBarDay: null
    };
    if (extra) Object.keys(extra).forEach(function (k) { order[k] = extra[k]; });
    return order;
  }

  function rejectOrder(order, reason) {
    order.status = 'rejected';
    order.reason = reason;
    state.orders.push(order);
    save();
    return order;
  }

  function remainingQty(order) { return order.qty - (isNum(order.filledQty) ? order.filledQty : 0); }

  /**
   * fillOrder(order, basePrice, time, note, fillQty)
   * Fills `fillQty` (default: everything still unfilled) of `order` at
   * `basePrice` adjusted for slippage. A fill smaller than the remainder
   * leaves the order 'open' with `partial: true` (volume fill model).
   */
  function fillOrder(order, basePrice, time, note, fillQty) {
    var remaining = remainingQty(order);
    var q = isNum(fillQty) && fillQty > 0 ? Math.min(fillQty, remaining) : remaining;
    var price = slipPrice(order.side, basePrice, order.type, order.limitPrice);
    var pos = state.positions[order.symbol];
    var mult = pos ? multiplierOf(pos) : ((order.meta && isNum(order.meta.multiplier) && order.meta.multiplier > 0) ? order.meta.multiplier : 1);
    var firstFill = !(order.filledQty > 0);
    var commission = commissionFor(q, price, mult, order.kind, firstFill);
    var partialPrefix = firstFill ? '' : T('Partially filled {filled} of {qty}, then: ', { filled: order.filledQty, qty: order.qty });
    settleBefore(order.symbol, order.kind, time, basePrice);
    var reason = pdtBlock(order.symbol, order.side, time, q, order.id) ||
      checkFill(order.symbol, order.side, q, price, order.kind, order.meta, commission);
    if (reason) {
      order.status = 'rejected';
      order.reason = partialPrefix + reason;
      return null;
    }
    var trade = applyFill(order.symbol, order.side, q, price, {
      orderId: order.id, kind: order.kind, meta: order.meta, time: time, note: note,
      commission: commission, basePrice: price !== basePrice ? basePrice : undefined
    });
    var prevQty = firstFill ? 0 : order.filledQty;
    order.fillPrice = firstFill ? price : round6((order.fillPrice * prevQty + price * q) / (prevQty + q)); // volume-weighted average
    order.filledQty = prevQty + q;
    order.filledAt = trade.time;          // milliseconds, same as trade.time
    order.filledBarTime = trade.barTime;  // the bar's own time, as given
    order.commission = cents((firstFill ? 0 : (order.commission || 0)) + trade.commission);
    if (!Array.isArray(order.fills)) order.fills = [];
    order.fills.push({ qty: q, price: price, time: trade.time, tradeId: trade.id });
    var slipNote = price !== basePrice ? ' ' + T('Slippage of {bps} bps moved the fill from {from} to {to}.', { bps: state.settings.slippageBps, from: money(basePrice), to: money(price) }) : '';
    if (order.filledQty >= order.qty) {
      order.status = 'filled';
      order.partial = false;
      order.reason = (note || ('Filled ' + order.qty + ' @ ' + money(price))) + slipNote;
    } else {
      order.status = 'open';
      order.partial = true;
      order.reason = T('Partially filled {filled} of {qty} (average {avg}). The volume fill model lets an order take at most {pct}% of a bar\'s volume, so the remaining {left} stay open and keep filling on the next bars.', {
        filled: order.filledQty, qty: order.qty, avg: money(order.fillPrice), pct: state.settings.maxVolumePct, left: order.qty - order.filledQty
      }) + slipNote;
    }
    return trade;
  }

  // How many units the volume fill model allows against a bar of `volume`
  // (Infinity when the model is off or the volume is unknown).
  function volumeCap(volume) {
    if (state.settings.fillModel !== 'volume' || !(isNum(volume) && volume > 0)) return Infinity;
    return Math.floor(volume * state.settings.maxVolumePct / 100);
  }

  // Is a resting order immediately executable at this single price?
  // Returns the execution price or null. Only market and marketable limit
  // orders fill on placement; stops on the wrong side of the market are
  // rejected in placeOrder (see wrongSideStop) rather than filled.
  function immediatePrice(order, price) {
    var buy = order.side === 'buy';
    switch (order.type) {
      case 'market': return price;
      case 'limit':
        // Marketable limit: buy when price <= limit, sell when price >= limit. You get the current price.
        return (buy ? price <= order.limitPrice : price >= order.limitPrice) ? price : null;
    }
    return null;
  }

  // A sell stop must sit below the market and a buy stop above it; otherwise
  // the stop is "already triggered" and a real broker rejects the order.
  function wrongSideStop(order, price) {
    if (order.type !== 'stop' && order.type !== 'stop_limit') return null;
    var buy = order.side === 'buy';
    if (buy ? order.stopPrice <= price : order.stopPrice >= price) {
      return 'A sell stop must be below the current price (' + money(price) + ') and a buy stop above it; you entered ' +
        money(order.stopPrice) + '. Stops are meant to trigger when price moves against you (or breaks out), not right away. ' +
        'Did you mean a ' + (buy ? 'buy' : 'sell') + ' limit order?';
    }
    return null;
  }

  // The price a working order would really execute at if `price` is known —
  // used for the pre-trade cash/margin check so a marketable buy limit above
  // the market is tested at the (cheaper) market price it would actually get.
  // Stops keep their stop/limit price: they fill later, at that price or worse.
  function referencePrice(order, price, hasPrice) {
    var refPx = order.type === 'stop' ? order.stopPrice : order.limitPrice;
    if (!hasPrice || order.type !== 'limit') return refPx;
    return order.side === 'buy' ? Math.min(refPx, price) : Math.max(refPx, price);
  }

  /**
   * placeOrder(order, price)
   * Market orders fill at `price` right away. Limit / stop / stop-limit
   * orders fill right away if `price` already satisfies them; otherwise they
   * rest in `orders` with status 'open' until processOrders() sees a bar that
   * reaches them. Returns the order object.
   */
  function placeOrder(o, price, ctx) {
    ctx = ctx || {};
    var cap = volumeCap(ctx.volume);   // volume fill model: units the current bar can absorb
    var err = validateOrder(o);
    if (err) {
      var bad = makeOrder({ symbol: (o && o.symbol) || '?', side: (o && o.side) || 'buy', qty: (o && isNum(Number(o.qty))) ? Number(o.qty) : 0, type: (o && o.type) || 'market' });
      bad.limitPrice = o && isNum(o.limitPrice) ? o.limitPrice : null;
      bad.stopPrice = o && isNum(o.stopPrice) ? o.stopPrice : null;
      return rejectOrder(bad, err);
    }
    var order = makeOrder(o);
    var hasPrice = isNum(price) && price > 0;

    if (order.type === 'market') {
      if (!hasPrice) return rejectOrder(order, 'A market order needs a current price to fill against. Load a chart (or pass a price) first.');
      if (cap === 0) {
        order.reason = T('Waiting for volume: this bar traded too few shares for any fill under the volume model ({pct}% of bar volume). The order stays open and fills at the next bar.', { pct: state.settings.maxVolumePct });
        state.marks[order.symbol] = price;
      } else {
        fillOrder(order, price, now(), undefined, isFinite(cap) ? cap : undefined);
      }
      state.orders.push(order);
      save();
      return order;
    }

    // Stops on the wrong side of the market are rejected, not filled.
    if (hasPrice) {
      var wrong = wrongSideStop(order, price);
      if (wrong) return rejectOrder(order, wrong);
    }

    // Working orders: check cash/margin at the price the order would really
    // execute at, so we never accept an order that could not be honoured.
    var refPx = referencePrice(order, price, hasPrice);
    var pre = checkFill(order.symbol, order.side, order.qty, refPx, order.kind, order.meta);
    if (pre) return rejectOrder(order, pre);

    if (hasPrice) {
      var px = immediatePrice(order, price);
      if (px != null && cap !== 0) {
        fillOrder(order, px, now(), 'Filled immediately: the ' + order.type.replace('_', '-') + ' price was already reached at ' + money(price), isFinite(cap) ? cap : undefined);
        state.orders.push(order);
        save();
        return order;
      }
      if (order.type === 'limit' && order.side === 'buy' && order.limitPrice > price) {
        // allowed, but worth noting for the student
        order.reason = 'Working. Note: your limit is above the current price, so it would have filled now if a price had been supplied with the order.';
      }
    }
    if (!order.reason) order.reason = describeOrder(order);
    state.marks[order.symbol] = hasPrice ? price : state.marks[order.symbol];
    state.orders.push(order);
    save();
    return order;
  }

  /**
   * processOrders(symbol, bar)
   * Walk every open order for `symbol` and fill the ones this bar reaches.
   * Semantics (the lesson students should take away):
   *   buy limit   fills when bar.low  <= limit, at the better of open/limit
   *   sell limit  fills when bar.high >= limit, at the better of open/limit
   *   buy stop    fills when bar.high >= stop,  at the worse  of open/stop (gaps hurt you)
   *   sell stop   fills when bar.low  <= stop,  at the worse  of open/stop
   *   stop-limit  triggers like a stop, then fills only if the limit is reachable
   *   day orders  expire when a bar from a later day arrives unfilled
   * Returns an array of fills `{order, trade}` made against this bar.
   */
  function processOrders(symbol, bar) {
    symbol = normSymbol(symbol);
    var fills = [];
    if (!bar || !isNum(bar.high) || !isNum(bar.low)) return fills;
    var open = isNum(bar.open) ? bar.open : bar.close;
    var day = barDay(bar.time);
    var time = bar.time == null ? now() : bar.time;

    // Dividends go to whoever held the stock at the previous close, so they are
    // settled before this bar's orders can change the position.
    processDividends(symbol, day, time, open);

    // Volume fill model: every order on this symbol shares the same bar's volume.
    var barCap = volumeCap(bar.volume);
    var usedThisBar = 0;

    state.orders.forEach(function (order) {
      if (order.status !== 'open' || order.symbol !== symbol) return;

      // Day orders live for the trading day of the first bar they see.
      if (order.tif === 'day') {
        if (order.firstBarDay == null) order.firstBarDay = day;
        else if (day && order.firstBarDay !== day) {
          order.status = 'expired';
          order.reason = order.filledQty > 0
            ? T('Day order partially filled ({filled} of {qty}); the remaining {left} expired at the end of {day}.', { filled: order.filledQty, qty: order.qty, left: order.qty - order.filledQty, day: order.firstBarDay })
            : 'Day order expired unfilled at the end of ' + order.firstBarDay + '.';
          return;
        }
      }

      var buy = order.side === 'buy';
      var px = null, note = '';
      switch (order.type) {
        case 'market':
          px = open; note = 'Market order filled at the open of the next bar.';
          break;
        case 'limit':
          if (buy && bar.low <= order.limitPrice) { px = Math.min(order.limitPrice, open); }
          else if (!buy && bar.high >= order.limitPrice) { px = Math.max(order.limitPrice, open); }
          if (px != null) note = 'Limit reached (bar ' + (buy ? 'low ' + money(bar.low) : 'high ' + money(bar.high)) + ').' + (px !== order.limitPrice ? ' Price gapped past your limit, so you got the better open price.' : '');
          break;
        case 'stop':
          if (order.triggered) { px = open; note = 'Stop already triggered: the rest of the order fills at the market (the open of this bar).'; break; }
          if (buy && bar.high >= order.stopPrice) { px = Math.max(order.stopPrice, open); }
          else if (!buy && bar.low <= order.stopPrice) { px = Math.min(order.stopPrice, open); }
          if (px != null) note = 'Stop triggered (bar ' + (buy ? 'high ' + money(bar.high) : 'low ' + money(bar.low)) + ').' + (px !== order.stopPrice ? ' Price gapped through your stop, so you were filled at the worse open price — stops do not guarantee a price.' : '');
          break;
        case 'stop_limit':
          var candidate = null;
          if (!order.triggered) {
            if (buy && bar.high >= order.stopPrice) { order.triggered = true; candidate = Math.max(order.stopPrice, open); }
            else if (!buy && bar.low <= order.stopPrice) { order.triggered = true; candidate = Math.min(order.stopPrice, open); }
          } else {
            candidate = open; // already triggered: behaves like a plain limit order
          }
          if (order.triggered) {
            if (buy) {
              if (candidate <= order.limitPrice) px = candidate;
              else if (bar.low <= order.limitPrice) px = order.limitPrice;
            } else {
              if (candidate >= order.limitPrice) px = candidate;
              else if (bar.high >= order.limitPrice) px = order.limitPrice;
            }
            if (px != null) note = 'Stop triggered and the limit was reachable, filled at ' + money(px) + '.';
            else order.reason = 'Stop triggered at ' + money(order.stopPrice) + ' but price moved past your limit of ' + money(order.limitPrice) + ' before filling. The order is still working as a limit order — this is the protection (and the risk) of a stop-limit.';
          }
          break;
      }

      if (px != null) {
        px = cents(px);
        var allowed = isFinite(barCap) ? Math.max(0, barCap - usedThisBar) : undefined;
        if (allowed === 0) {
          if (order.type === 'stop') order.triggered = true;   // it became a market order; fill the rest later
          order.reason = T('Waiting for volume: other fills already used this bar\'s share of volume ({pct}% of bar volume). The order stays open for the next bar.', { pct: state.settings.maxVolumePct });
          return;
        }
        var trade = fillOrder(order, px, time, note, allowed);
        if (trade) {
          usedThisBar += trade.qty;
          if (order.status === 'open' && order.type === 'stop') order.triggered = true;
          fills.push({ order: order, trade: trade });
        }
      }
    });

    if (isNum(bar.close)) state.marks[symbol] = bar.close;
    save();
    return fills;
  }

  function cancelOrder(id) {
    for (var i = 0; i < state.orders.length; i++) {
      var o = state.orders[i];
      if (o.id === id) {
        if (o.status !== 'open') return null;
        o.status = 'cancelled';
        o.reason = o.filledQty > 0
          ? T('Cancelled by you after a partial fill: {filled} of {qty} filled, the remaining {left} cancelled.', { filled: o.filledQty, qty: o.qty, left: o.qty - o.filledQty })
          : 'Cancelled by you.';
        o.cancelledAt = now();
        save();
        return o;
      }
    }
    return null;
  }

  function openOrders(symbol) {
    symbol = symbol == null ? null : normSymbol(symbol);
    return state.orders.filter(function (o) { return o.status === 'open' && (symbol == null || o.symbol === symbol); });
  }

  /** closePosition(symbol, price): market order for the whole position (stock or option). */
  function closePosition(symbol, price) {
    symbol = normSymbol(symbol);
    var pos = state.positions[symbol];
    if (!pos) {
      return rejectOrder(makeOrder({ symbol: symbol, side: 'sell', qty: 1, type: 'market' }), 'You have no open position in ' + symbol + ' to close.');
    }
    if (!(isNum(price) && price > 0)) {
      return rejectOrder(makeOrder({ symbol: symbol, side: pos.qty > 0 ? 'sell' : 'buy', qty: Math.abs(pos.qty), type: 'market' }), 'Closing a position needs a current price to fill against.');
    }
    var order = makeOrder({ symbol: symbol, side: pos.qty > 0 ? 'sell' : 'buy', qty: Math.abs(pos.qty), type: 'market' }, { kind: pos.kind, meta: pos.meta });
    fillOrder(order, price, now(), (pos.qty > 0 ? 'Sold to close ' : 'Bought to cover ') + Math.abs(pos.qty) + ' ' + symbol + ' @ ' + money(price));
    state.orders.push(order);
    save();
    return order;
  }

  /* ------------------------------------------------------------------ *
   * Options
   * ------------------------------------------------------------------ */
  var OCC_RE = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

  function parseContract(id) {
    var m = OCC_RE.exec(String(id || '').trim().toUpperCase());
    if (!m) return null;
    var yy = Number(m[2]), mm = Number(m[3]), dd = Number(m[4]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    var expiry = (2000 + yy) + '-' + m[3] + '-' + m[4];
    return {
      contract: m[0],
      underlying: m[1],
      expiry: expiry,
      right: m[5],
      strike: Number(m[6]) / 1000,
      multiplier: 100
    };
  }

  /**
   * placeOptionOrder({contract, side, qty, meta?}, premium)
   * Buys (long) or writes (short) `qty` contracts at `premium` per share; the
   * cash moved is premium × 100 × qty. Writing requires the short margin rule
   * plus 20 % of the strike notional, so students feel why "naked" options are
   * treated as risky by brokers.
   */
  function placeOptionOrder(o, premium) {
    o = o || {};
    var parsed = parseContract(o.contract);
    var meta = parsed ? { underlying: parsed.underlying, strike: parsed.strike, expiry: parsed.expiry, right: parsed.right, multiplier: 100 } : null;
    if (!meta && o.meta && isNum(o.meta.strike) && (o.meta.right === 'C' || o.meta.right === 'P')) {
      meta = { underlying: normSymbol(o.meta.underlying || ''), strike: o.meta.strike, expiry: o.meta.expiry || null, right: o.meta.right, multiplier: 100 };
    }
    var symbol = normSymbol(o.contract);
    var base = { symbol: symbol || 'OPTION', side: o.side, qty: o.qty, type: 'market' };
    var order;
    if (!meta) {
      order = makeOrder(base, { kind: 'option' });
      return rejectOrder(order, 'That does not look like an option contract. Use the OCC format, e.g. AAPL260117C00200000 = AAPL, expiring 2026-01-17, Call, strike $200.');
    }
    var err = validateOrder(base);
    if (err) return rejectOrder(makeOrder({ symbol: symbol, side: o.side || 'buy', qty: isNum(Number(o.qty)) ? Number(o.qty) : 0, type: 'market' }, { kind: 'option', meta: meta }), err);
    order = makeOrder(base, { kind: 'option', meta: meta });
    if (!(isNum(premium) && premium >= 0)) return rejectOrder(order, 'An option order needs the premium (price per share) to fill against.');
    if (meta.expiry && meta.expiry < new Date(now()).toISOString().slice(0, 10)) {
      return rejectOrder(order, 'That contract expired on ' + meta.expiry + '. Pick a later expiry.');
    }
    var existing = state.positions[symbol];
    var side = o.side;
    var label = side === 'buy'
      ? ((existing && existing.qty < 0) ? 'Bought to close' : 'Bought to open')
      : ((existing && existing.qty > 0) ? 'Sold to close' : 'Sold to open (wrote)');
    fillOrder(order, premium, now(), label + ' ' + order.qty + ' ' + meta.underlying + ' ' + money(meta.strike) + ' ' + (meta.right === 'C' ? 'call' : 'put') + (meta.expiry ? ' exp ' + meta.expiry : '') + ' @ ' + money(premium) + ' (' + money(premium * 100) + ' per contract)');
    state.orders.push(order);
    save();
    return order;
  }

  /* ------------------------------------------------------------------ *
   * Dividends, cash interest, short borrow fees (cash flows)
   * ------------------------------------------------------------------ */
  // Approximate annual dividend yields (fraction of price) and quarterly
  // ex-date cycles for the dividend payers in the demo universe. Real amounts
  // and dates differ; this is a teaching approximation so students see that
  // holding a stock pays (and shorting one costs) dividends. A universe entry
  // in BT.data with `divYield` (fraction) and optional `divMonths` / `divExDay`
  // overrides this table.
  //   cycle: 'jan' → Jan/Apr/Jul/Oct, 'feb' → Feb/May/Aug/Nov, 'mar' → Mar/Jun/Sep/Dec
  var DIVIDEND_TABLE = {
    AAPL: [0.004, 'feb', 10], MSFT: [0.007, 'feb', 20], GOOGL: [0.004, 'mar', 9], META: [0.003, 'mar', 14],
    AVGO: [0.007, 'mar', 20], JPM: [0.02, 'jan', 6], V: [0.007, 'feb', 10], MA: [0.005, 'jan', 9],
    BAC: [0.022, 'mar', 6], GS: [0.017, 'mar', 1], JNJ: [0.029, 'feb', 25], UNH: [0.025, 'mar', 16],
    LLY: [0.007, 'feb', 15], PFE: [0.068, 'jan', 25], MRK: [0.038, 'mar', 15], ABBV: [0.03, 'jan', 15],
    WMT: [0.009, 'mar', 14], COST: [0.005, 'feb', 1], PG: [0.026, 'jan', 20], KO: [0.029, 'mar', 14],
    PEP: [0.039, 'mar', 6], MCD: [0.024, 'mar', 1], SBUX: [0.029, 'feb', 14], NKE: [0.023, 'mar', 2],
    HD: [0.023, 'mar', 6], DIS: [0.009, 'jan', 8], XOM: [0.035, 'feb', 14], CVX: [0.044, 'feb', 18],
    CAT: [0.012, 'jan', 20], GE: [0.005, 'mar', 8], CSCO: [0.024, 'jan', 3], ORCL: [0.007, 'jan', 10],
    CRM: [0.006, 'mar', 18], INTC: [0.0, 'feb', 7], PYPL: [0.0, 'feb', 1], F: [0.05, 'feb', 1],
    GM: [0.009, 'mar', 6], T: [0.041, 'jan', 10], VZ: [0.064, 'jan', 10], SPY: [0.012, 'mar', 20],
    VOO: [0.012, 'mar', 26], VTI: [0.013, 'mar', 26], QQQ: [0.006, 'mar', 22], DIA: [0.015, 'mar', 20],
    IWM: [0.011, 'mar', 12], EFA: [0.03, 'mar', 12], XLK: [0.006, 'mar', 22], XLF: [0.014, 'mar', 22],
    XLE: [0.033, 'mar', 22], XLV: [0.016, 'mar', 22], TLT: [0.042, 'mar', 2]
  };
  var CYCLES = { jan: [1, 4, 7, 10], feb: [2, 5, 8, 11], mar: [3, 6, 9, 12] };

  /** dividendInfo(symbol) → {symbol, yield, months, exDay, source} or null for non-payers. */
  function dividendInfo(symbol) {
    symbol = normSymbol(symbol);
    var u = null;
    try {
      var uni = window.BT && window.BT.data && window.BT.data.universe;
      if (Array.isArray(uni)) u = uni.filter(function (x) { return x && x.symbol === symbol; })[0] || null;
    } catch (e) { u = null; }
    var y = u && isNum(u.divYield) ? u.divYield : (u && isNum(u.dividendYield) ? u.dividendYield : null);
    if (y != null && y > 1) y = y / 100;                       // accept percent as well as fraction
    var row = DIVIDEND_TABLE[symbol];
    if (y == null && row) y = row[0];
    if (!(isNum(y) && y > 0)) return null;
    var months = u && Array.isArray(u.divMonths) && u.divMonths.length ? u.divMonths.filter(function (m) { return isNum(m) && m >= 1 && m <= 12; }) : CYCLES[row ? row[1] : 'mar'];
    var exDay = u && isNum(u.divExDay) ? Math.min(28, Math.max(1, Math.round(u.divExDay))) : (row ? Math.min(28, Math.max(1, row[2])) : 15);
    return { symbol: symbol, yield: y, months: months.slice().sort(function (a, b) { return a - b; }), exDay: exDay, source: (u && u.divYield != null) ? 'universe' : 'table' };
  }

  /** exDates(symbol, afterDay, throughDay) → ex-dividend days with afterDay < d <= throughDay. */
  function exDates(symbol, afterDay, throughDay) {
    var info = typeof symbol === 'object' && symbol ? symbol : dividendInfo(symbol);
    var out = [];
    if (!info || typeof afterDay !== 'string' || typeof throughDay !== 'string' || throughDay <= afterDay) return out;
    var y0 = Number(afterDay.slice(0, 4)), y1 = Number(throughDay.slice(0, 4));
    if (!isNum(y0) || !isNum(y1) || y1 - y0 > 30) return out;
    for (var y = y0; y <= y1; y++) {
      info.months.forEach(function (m) {
        var d = y + '-' + (m < 10 ? '0' : '') + m + '-' + (info.exDay < 10 ? '0' : '') + info.exDay;
        if (d > afterDay && d <= throughDay) out.push(d);
      });
    }
    return out.sort();
  }

  function pushCashflow(rec) {
    rec.id = state.nextId++;
    state.cashflows.push(rec);
    if (state.cashflows.length > 2000) state.cashflows.splice(0, state.cashflows.length - 2000);
    return rec;
  }

  /**
   * applyDividend(symbol, perShare, {time, day, note}) → cash-flow record or null
   * Long stock receives qty × perShare; a short pays it to the share lender.
   */
  function applyDividend(symbol, perShare, opts) {
    opts = opts || {};
    symbol = normSymbol(symbol);
    var pos = state.positions[symbol];
    if (!pos || pos.kind === 'option' || !(isNum(perShare) && perShare > 0)) return null;
    var amount = cents(pos.qty * perShare);
    if (amount === 0) return null;
    accrue(toMs(opts.time == null ? now() : opts.time)); // earlier days accrue on the pre-dividend cash
    var day = opts.day || fillDay(opts.time);
    state.cash = cents(state.cash + amount);
    state.income.dividends = cents(state.income.dividends + amount);
    var note = opts.note || (pos.qty > 0
      ? T('Dividend: {qty} shares × {ps} = {amt} credited to cash (ex-date {day}). The share price usually drops by about the dividend on the ex-date, so it is not free money.', { qty: pos.qty, ps: money(perShare), amt: money(amount), day: day })
      : T('Dividend on a short: you borrowed {qty} shares, so you pay the lender the {ps} dividend per share. {amt} debited from cash (ex-date {day}).', { qty: -pos.qty, ps: money(perShare), amt: money(-amount), day: day }));
    var rec = pushCashflow({ type: 'dividend', symbol: symbol, qty: pos.qty, perShare: perShare, amount: amount, time: toMs(opts.time), day: day, note: note });
    save();
    return rec;
  }

  // Called by processOrders before a bar's orders: pays every ex-date passed
  // since the previous bar seen for this symbol (holders at the prior close).
  function processDividends(symbol, day, time, fallbackPrice) {
    if (!day) return [];
    var prev = state.lastBarDay[symbol];
    if (!prev || day > prev) state.lastBarDay[symbol] = day;
    if (!state.settings.dividends || !prev || day <= prev) return [];
    var pos = state.positions[symbol];
    if (!pos || pos.kind === 'option') return [];
    var info = dividendInfo(symbol);
    if (!info) return [];
    var ref = isNum(state.marks[symbol]) ? state.marks[symbol] : fallbackPrice;
    if (!(isNum(ref) && ref > 0)) return [];
    var perShare = round4(info.yield * ref / 4);
    var out = [];
    exDates(info, prev, day).forEach(function (d) {
      var rec = applyDividend(symbol, perShare, { time: time, day: d });
      if (rec) out.push(rec);
    });
    return out;
  }

  function daysBetween(a, b) {
    var ta = Date.parse(a + 'T00:00:00Z'), tb = Date.parse(b + 'T00:00:00Z');
    return isNum(ta) && isNum(tb) ? Math.round((tb - ta) / MS_PER_DAY) : 0;
  }
  function floorCents(v) { return v >= 0 ? Math.floor(v * 100 + 1e-7) / 100 : -Math.floor(-v * 100 + 1e-7) / 100; }

  /**
   * accrue(at?) → cash-flow records posted
   * Daily accrual of interest on free cash (cash not backing short sales) and
   * of the borrow fee on short stock, for each calendar day since the last
   * accrual, at the current balances. Fractions of a cent are carried forward
   * so small balances still earn (and owe) the right amount over time.
   * Called automatically by markToMarket() and before any settings change.
   */
  function accrue(at) {
    var t = isNum(at) ? at : now();
    var today = dayKeyOf(t);
    var last = state.accrual.lastDay;
    if (!last || today > last) state.accrual.lastDay = today;
    if (!last || today <= last) return [];
    var days = Math.min(3660, daysBetween(last, today));
    var ir = state.settings.cashInterestPct / 100, br = state.settings.borrowFeePct / 100;
    if (days <= 0 || (!(ir > 0) && !(br > 0))) return [];
    var shortStock = 0, shortAll = 0;
    Object.keys(state.positions).forEach(function (sym) {
      var p = state.positions[sym];
      if (p.qty >= 0) return;
      var px = markOf(sym);
      var v = -p.qty * (isNum(px) ? px : p.avg) * multiplierOf(p);
      shortAll += v;
      if (p.kind !== 'option') shortStock += v;
    });
    var out = [];
    if (ir > 0) {
      var base = Math.max(0, state.cash - shortAll);
      var owedI = state.accrual.carryInterest + base * ir * days / 365;
      var postI = floorCents(owedI);
      state.accrual.carryInterest = round6(owedI - postI);
      if (postI !== 0) {
        state.cash = cents(state.cash + postI);
        state.income.interest = cents(state.income.interest + postI);
        out.push(pushCashflow({ type: 'interest', symbol: null, amount: postI, days: days, time: t, day: today,
          note: T('Cash interest: {amt} for {days} day(s) at {rate}% a year on {base} of free cash.', { amt: money(postI), days: days, rate: state.settings.cashInterestPct, base: money(base) }) }));
      }
    }
    if (br > 0 && shortStock > 0) {
      var owedB = state.accrual.carryBorrow + shortStock * br * days / 365;
      var postB = floorCents(owedB);
      state.accrual.carryBorrow = round6(owedB - postB);
      if (postB !== 0) {
        state.cash = cents(state.cash - postB);
        state.income.borrowFees = cents(state.income.borrowFees + postB);
        out.push(pushCashflow({ type: 'borrow', symbol: null, amount: -postB, days: days, time: t, day: today,
          note: T('Short borrow fee: {amt} for {days} day(s) at {rate}% a year on {base} of borrowed shares. Shorting costs money every day you hold it.', { amt: money(postB), days: days, rate: state.settings.borrowFeePct, base: money(shortStock) }) }));
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Mark to market, equity history
   * ------------------------------------------------------------------ */
  function valuation(prices) {
    var marketValue = 0, unrealized = 0, longValue = 0, shortValue = 0;
    var rows = [];
    Object.keys(state.positions).forEach(function (sym) {
      var p = state.positions[sym];
      var px = markOf(sym, prices);
      if (prices && isNum(prices[sym])) state.marks[sym] = prices[sym];
      var mult = multiplierOf(p);
      var mv = p.qty * px * mult;
      var upl = (px - p.avg) * p.qty * mult;
      marketValue += mv; unrealized += upl;
      if (mv >= 0) longValue += mv; else shortValue += -mv;
      rows.push({
        symbol: sym, qty: p.qty, avg: p.avg, price: px, kind: p.kind, meta: p.meta,
        multiplier: mult, marketValue: cents(mv), unrealized: cents(upl),
        unrealizedPct: p.avg ? round6(((px - p.avg) / p.avg) * 100 * (p.qty > 0 ? 1 : -1)) : 0,
        side: p.qty > 0 ? 'long' : 'short'
      });
    });
    return { marketValue: cents(marketValue), unrealized: cents(unrealized), longValue: cents(longValue), shortValue: cents(shortValue), rows: rows };
  }

  /**
   * markToMarket(prices) → {equity, cash, marketValue, unrealized, realized, dayPnL, ...}
   * Appends `{t, equity}` to equityHistory, replacing the previous point when
   * it falls in the same minute so a live ticking chart does not flood it.
   */
  function markToMarket(prices, at) {
    var t = isNum(at) ? at : now();
    if (prices) Object.keys(prices).forEach(function (k) { if (state.positions[k] && isNum(prices[k])) state.marks[k] = prices[k]; });
    accrue(t);                                  // daily interest / borrow fees (no-op when both are off)
    var v = valuation(prices || {});
    var equity = cents(state.cash + v.marketValue);

    var today = dayKeyOf(t);
    if (!state.dayStart || state.dayStart.day !== today) {
      var last = state.equityHistory.length ? state.equityHistory[state.equityHistory.length - 1].equity : equity;
      state.dayStart = { day: today, equity: last };
    }

    var hist = state.equityHistory;
    var point = { t: t, equity: equity };
    if (hist.length && Math.floor(hist[hist.length - 1].t / MS_PER_MINUTE) === Math.floor(t / MS_PER_MINUTE)) hist[hist.length - 1] = point;
    else hist.push(point);
    if (hist.length > 5000) hist.splice(0, hist.length - 5000); // keep storage bounded

    save();
    return {
      equity: equity,
      cash: state.cash,
      marketValue: v.marketValue,
      longValue: v.longValue,
      shortValue: v.shortValue,
      unrealized: v.unrealized,
      realized: state.realized,
      totalPnL: cents(equity - state.startingCash),
      totalPnLPct: state.startingCash ? round6((equity - state.startingCash) / state.startingCash * 100) : 0,
      dayPnL: cents(equity - state.dayStart.equity),
      buyingPower: cents(Math.max(0, state.cash)),
      marginUsed: cents(v.shortValue * SHORT_MARGIN),
      // true when cash no longer covers 150 % of short exposure (prices moved
      // against the shorts since they were opened) — the UI should warn.
      marginCall: v.shortValue > 0 && state.cash < v.shortValue * SHORT_MARGIN,
      positions: v.rows,
      t: t
    };
  }

  /* ------------------------------------------------------------------ *
   * Statistics
   * ------------------------------------------------------------------ */
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function stdev(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }

  function maxDrawdown(curve) {
    var peak = -Infinity, dd = 0, ddAbs = 0;
    for (var i = 0; i < curve.length; i++) {
      var e = curve[i];
      if (e > peak) peak = e;
      if (peak > 0) {
        var d = (peak - e) / peak;
        if (d > dd) { dd = d; ddAbs = peak - e; }
      }
    }
    return { pct: round6(dd * 100), abs: cents(ddAbs) };
  }

  /**
   * stats() → {totalReturnPct, winRate, trades, avgWin, avgLoss, profitFactor, maxDrawdownPct, sharpe, ...}
   * - A "trade" for win-rate purposes is a fill that closed some quantity
   *   (realized P&L happened). Opening fills are not wins or losses yet.
   * - Sharpe uses the equity history resampled to one point per calendar day
   *   (the last mark of each day): simple returns between those daily closes,
   *   annualised with √252, risk-free rate 0. Intraday marks every few seconds
   *   must not be annualised as if they were days, so the ratio is null until
   *   there are at least 3 distinct days of history.
   */
  function dailyCloses(hist) {
    var out = [];
    for (var i = 0; i < hist.length; i++) {
      var key = dayKeyOf(hist[i].t);
      if (out.length && out[out.length - 1].day === key) out[out.length - 1].equity = hist[i].equity;
      else out.push({ day: key, equity: hist[i].equity });
    }
    return out;
  }
  function stats() {
    var closing = state.trades.filter(function (t) { return t.closedQty > 0; });
    var wins = closing.filter(function (t) { return t.realized > 0; });
    var losses = closing.filter(function (t) { return t.realized < 0; });
    var grossWin = wins.reduce(function (s, t) { return s + t.realized; }, 0);
    var grossLoss = -losses.reduce(function (s, t) { return s + t.realized; }, 0);

    var hist = state.equityHistory;
    var lastEquity = hist.length ? hist[hist.length - 1].equity : cents(state.cash + valuation({}).marketValue);
    var curve = [state.startingCash].concat(hist.map(function (h) { return h.equity; }));
    var dd = maxDrawdown(curve);

    var daily = dailyCloses(hist);
    var rets = [];
    for (var i = 1; i < daily.length; i++) {
      if (daily[i - 1].equity > 0) rets.push(daily[i].equity / daily[i - 1].equity - 1);
    }
    var sd = stdev(rets);
    var sharpe = (daily.length >= 3 && rets.length >= 2 && sd > 0) ? round6(mean(rets) / sd * Math.sqrt(TRADING_DAYS)) : null;

    var best = closing.reduce(function (b, t) { return b == null || t.realized > b.realized ? t : b; }, null);
    var worst = closing.reduce(function (b, t) { return b == null || t.realized < b.realized ? t : b; }, null);

    return {
      totalReturnPct: state.startingCash ? round6((lastEquity - state.startingCash) / state.startingCash * 100) : 0,
      equity: lastEquity,
      realized: state.realized,
      winRate: closing.length ? round6(wins.length / closing.length * 100) : null,
      trades: closing.length,
      fills: state.trades.length,
      wins: wins.length,
      losses: losses.length,
      avgWin: wins.length ? cents(grossWin / wins.length) : null,
      avgLoss: losses.length ? cents(-grossLoss / losses.length) : null,
      profitFactor: grossLoss > 0 ? round6(grossWin / grossLoss) : null, // undefined (infinite) with no losing trades
      expectancy: closing.length ? cents((grossWin - grossLoss) / closing.length) : null,
      maxDrawdownPct: dd.pct,
      maxDrawdown: dd.abs,
      sharpe: sharpe,
      bestTrade: best ? best.realized : null,
      worstTrade: worst ? worst.realized : null,
      commissionsPaid: cents(state.trades.reduce(function (s, t) { return s + t.commission; }, 0)),
      slippagePaid: cents(state.trades.reduce(function (s, t) { return s + (isNum(t.slippage) ? t.slippage : 0); }, 0)),
      dividends: state.income.dividends,
      interest: state.income.interest,
      borrowFees: state.income.borrowFees,
      dayTrades: dayTradeCount(),
      points: hist.length
    };
  }

  /* ------------------------------------------------------------------ *
   * Educational copy
   * ------------------------------------------------------------------ */
  var glossary = {
    market: 'A market order says "fill me now at whatever the market will give me". It is the only order that is guaranteed to execute, but not at a guaranteed price — in a fast market you can pay more (or receive less) than you expected.',
    limit: 'A limit order names the worst price you will accept: a buy limit fills at your price or lower, a sell limit at your price or higher. You control the price but not whether it ever fills.',
    stop: 'A stop order sleeps until the market touches your stop price, then becomes a market order. Traders use sell stops below a long position to cap losses, and buy stops above resistance to join a breakout. Because it becomes a market order, a gap can fill you well past the stop.',
    stop_limit: 'A stop-limit order triggers like a stop but then becomes a limit order instead of a market order. That protects you from a terrible fill after a gap — but it may not fill at all, leaving you in the trade you wanted out of.',
    short: 'Selling short means borrowing shares to sell now, hoping to buy them back cheaper later. Profit is capped (the stock can only fall to zero) and loss is unlimited, so the simulator requires cash equal to 150 % of your short exposure, like a real margin account.',
    averageCost: 'Your average cost is the share-weighted mean of what you paid. Buying more at a lower price lowers it; selling part of a position does not change it — it realizes a gain or loss on the shares sold.',
    options: 'One option contract controls 100 shares, so a premium quoted at $2.50 costs $250. Buying options risks only the premium; writing (selling) them collects the premium but takes on the obligation, which is why writing needs margin.',
    sharpe: 'Sharpe ratio = average return divided by its volatility, annualised. Above 1 is good, above 2 is excellent; it rewards steady gains over wild swings that happen to end higher.',
    drawdown: 'Max drawdown is the largest peak-to-trough fall of your equity. Two accounts can end at the same value; the one with the smaller drawdown took far less pain (and risk of ruin) getting there.',
    profitFactor: 'Profit factor = gross profits ÷ gross losses. Above 1 means you made money overall; a strategy with a 40 % win rate can still have a profit factor of 2 if winners are much bigger than losers.',
    dayPnL: 'Day P&L compares your equity now with your equity at the start of the day, including both realized trades and the change in open positions.',
    slippage: 'Slippage is the gap between the price you saw and the price you got. Market and stop orders take whatever the market offers, so buys tend to fill a little higher and sells a little lower, especially in fast or thin markets. A limit order avoids slippage but may not fill.',
    partialFill: 'A partial fill means only part of your order traded. A real market can only absorb so many shares at once; the volume fill model lets an order take at most 10 % of each bar\'s volume, and the rest waits for later bars.',
    commission: 'Commissions are what a broker charges to execute a trade. Many US apps charge zero for stocks, others charge per share or a flat fee per order. Fees look tiny, but they add up quickly for frequent traders and small accounts.',
    dividend: 'A dividend is cash a company pays its shareholders, usually every quarter. You get it if you hold the stock at the close before the ex-dividend date. If you are short on that date you must pay the dividend to the lender of the shares.',
    cashInterest: 'Brokers pay interest on uninvested cash, quoted as an annual rate and accrued daily. Cash that backs a short sale usually earns nothing, so only free cash counts here.',
    borrowFee: 'To sell short you borrow shares, and the lender charges a fee: an annual rate accrued every day you stay short. Easy-to-borrow stocks cost well under 1 % a year; hard-to-borrow ones can cost 20 % or much more.',
    pdt: 'The pattern day trader (PDT) rule: in a US margin account with less than $25,000, making 4 or more day trades (opening and closing the same position on the same day) within 5 business days gets the account restricted. Many brokers simply block the 4th day trade, which is what the simulator does when the rule is on.'
  };

  function describeOrder(order) {
    if (!order) return '';
    var verb = order.side === 'buy' ? 'Buy' : 'Sell';
    var what = order.qty + ' ' + order.symbol;
    switch (order.type) {
      case 'market': return verb + ' ' + what + ' at the market.';
      case 'limit': return verb + ' ' + what + ' at ' + money(order.limitPrice) + ' or ' + (order.side === 'buy' ? 'better (lower)' : 'better (higher)') + '.';
      case 'stop': return verb + ' ' + what + ' if price ' + (order.side === 'buy' ? 'rises to' : 'falls to') + ' ' + money(order.stopPrice) + ' (becomes a market order).';
      case 'stop_limit': return verb + ' ' + what + ' if price ' + (order.side === 'buy' ? 'rises to' : 'falls to') + ' ' + money(order.stopPrice) + ', but only at ' + money(order.limitPrice) + ' or better.';
    }
    return verb + ' ' + what + '.';
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  window.BT.paper = {
    STORAGE_KEY: STORAGE_KEY,
    ACCOUNTS_KEY: ACCOUNTS_KEY,
    DEFAULT_CASH: DEFAULT_CASH,
    SHORT_MARGIN: SHORT_MARGIN,
    load: load,
    save: save,
    reset: reset,
    use: use,
    account: account,
    accounts: accounts,
    deleteAccount: deleteAccount,
    storageKeyFor: function (id) { return keyFor(normAccountId(id)); },
    getState: getState,
    get state() { return state; },
    get settings() { return state.settings; },
    setSettings: setSettings,
    setClock: function (fn) { clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; },
    placeOrder: placeOrder,
    processOrders: processOrders,
    cancelOrder: cancelOrder,
    openOrders: openOrders,
    closePosition: closePosition,
    placeOptionOrder: placeOptionOrder,
    parseContract: parseContract,
    markToMarket: markToMarket,
    valuation: valuation,
    stats: stats,
    describeOrder: describeOrder,
    glossary: glossary,
    money: money,
    // v0.5 realism
    PDT_EQUITY: PDT_EQUITY,
    commissionPresets: COMMISSION_PRESETS,
    defaultSettings: defaultSettings,
    applyCommissionPreset: applyCommissionPreset,
    commissionFor: function (qty, price, mult, kind, firstFill) { return commissionFor(qty, price, mult || 1, kind || 'stock', firstFill); },
    slipPrice: slipPrice,
    dividendInfo: dividendInfo,
    exDates: exDates,
    applyDividend: applyDividend,
    accrue: function (at) { var r = accrue(at); save(); return r; },
    cashflows: function () { return state.cashflows.slice(); },
    dayTradeCount: dayTradeCount,
    pdtStatus: pdtStatus
  };

  // Pick up any saved portfolio as soon as the script loads.
  load();

  // Cross-tab sync: when another tab writes the active account's key, reload it
  // so this page never trades against (or later persists) a stale snapshot.
  // The `storage` event only fires in *other* tabs, so our own saves are ignored.
  try {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('storage', function (ev) {
        if (!ev || ev.key !== keyFor(activeAccount)) return;
        load();
        try { window.dispatchEvent(new CustomEvent('bt:paper-sync', { detail: { account: activeAccount } })); } catch (e) { /* optional */ }
      });
    }
  } catch (e) { /* no window events (node) */ }
})();
