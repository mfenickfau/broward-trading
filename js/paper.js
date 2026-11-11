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
 */
(function () {
  'use strict';
  window.BT = window.BT || {};

  var STORAGE_KEY = 'bt.portfolio';
  var DEFAULT_CASH = 100000;
  var SHORT_MARGIN = 1.5;        // cash must cover 150 % of short market value
  var NAKED_OPTION_MARGIN = 0.2; // plus 20 % of strike notional for written options
  var MS_PER_MINUTE = 60000;
  var TRADING_DAYS = 252;

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
      settings: { commission: 0 }
    };
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
      s.settings.commission = isNum(saved.settings.commission) && saved.settings.commission >= 0 ? saved.settings.commission : 0;
    }
    // nextId must stay ahead of any stored order/trade id
    var maxId = 0;
    s.orders.concat(s.trades).forEach(function (x) { if (isNum(x.id) && x.id > maxId) maxId = x.id; });
    if (s.nextId <= maxId) s.nextId = maxId + 1;
    return s;
  }

  function load() {
    state = sanitize(storageGet(STORAGE_KEY));
    return state;
  }
  function save() {
    return storageSet(STORAGE_KEY, state);
  }
  function reset(startingCash) {
    var keepCommission = state.settings.commission;
    state = freshState(startingCash == null ? DEFAULT_CASH : startingCash);
    state.settings.commission = keepCommission;
    save();
    return state;
  }
  function getState() { return state; }
  function setSettings(patch) {
    patch = patch || {};
    if (isNum(patch.commission) && patch.commission >= 0) state.settings.commission = patch.commission;
    save();
    return state.settings;
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
  function checkFill(symbol, side, qty, price, kind, meta) {
    var pos = state.positions[symbol];
    var mult = pos ? multiplierOf(pos) : ((meta && isNum(meta.multiplier)) ? meta.multiplier : 1);
    var commission = state.settings.commission;
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
   * The fill engine — the only place positions and cash change
   * ------------------------------------------------------------------ */
  function applyFill(symbol, side, qty, price, opts) {
    opts = opts || {};
    var kind = opts.kind || (state.positions[symbol] ? state.positions[symbol].kind : 'stock');
    var meta = opts.meta || (state.positions[symbol] ? state.positions[symbol].meta : {});
    if (!(isNum(qty) && qty > 0 && isNum(price) && price >= 0) || (side !== 'buy' && side !== 'sell')) {
      // Never let a malformed fill reach the books: NaN cash would be saved
      // and silently "repaired" on the next reload, erasing the student's P&L.
      throw new Error('applyFill: invalid fill (symbol ' + symbol + ', side ' + side + ', qty ' + qty + ', price ' + price + ')');
    }
    var pos = state.positions[symbol] || { qty: 0, avg: 0, kind: kind, meta: meta };
    var mult = multiplierOf(pos);
    var commission = isNum(opts.commission) ? opts.commission : state.settings.commission;
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
      note: opts.note || ''
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

  function fillOrder(order, price, time, note) {
    var reason = checkFill(order.symbol, order.side, order.qty, price, order.kind, order.meta);
    if (reason) {
      order.status = 'rejected';
      order.reason = reason;
      return null;
    }
    var trade = applyFill(order.symbol, order.side, order.qty, price, {
      orderId: order.id, kind: order.kind, meta: order.meta, time: time, note: note
    });
    order.status = 'filled';
    order.fillPrice = price;
    order.filledQty = order.qty;
    order.filledAt = trade.time;          // milliseconds, same as trade.time
    order.filledBarTime = trade.barTime;  // the bar's own time, as given
    order.commission = trade.commission;
    order.reason = note || ('Filled ' + order.qty + ' @ ' + money(price));
    return trade;
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
  function placeOrder(o, price) {
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
      fillOrder(order, price, now());
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
      if (px != null) {
        fillOrder(order, px, now(), 'Filled immediately: the ' + order.type.replace('_', '-') + ' price was already reached at ' + money(price));
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

    state.orders.forEach(function (order) {
      if (order.status !== 'open' || order.symbol !== symbol) return;

      // Day orders live for the trading day of the first bar they see.
      if (order.tif === 'day') {
        if (order.firstBarDay == null) order.firstBarDay = day;
        else if (day && order.firstBarDay !== day) {
          order.status = 'expired';
          order.reason = 'Day order expired unfilled at the end of ' + order.firstBarDay + '.';
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
        var trade = fillOrder(order, px, time, note);
        if (trade) fills.push({ order: order, trade: trade });
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
        o.reason = 'Cancelled by you.';
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
    dayPnL: 'Day P&L compares your equity now with your equity at the start of the day, including both realized trades and the change in open positions.'
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
    DEFAULT_CASH: DEFAULT_CASH,
    SHORT_MARGIN: SHORT_MARGIN,
    load: load,
    save: save,
    reset: reset,
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
    money: money
  };

  // Pick up any saved portfolio as soon as the script loads.
  load();
})();
