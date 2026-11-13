/* Broward Trading — js/coach.js → BT.coach (v0.5)
 *
 * A free, rule-based trade coach. It reviews each new order and each closed
 * trade against the habits the course teaches and returns short findings:
 *
 *   BT.coach.reviewOrder(order, ctx)  → [{level:'tip'|'warn', id, title, message, lessonId}]
 *   BT.coach.reviewTrade(trade, ctx)  → same shape, for a closed (round-trip) trade
 *   BT.coach.ai(trade, opts?)         → Promise<{ok, source:'ai'|'rules', text, findings, fallback, reason}>
 *   BT.coach.lessonUrl(id)            → 'learn.html#/lesson/<id>'
 *   BT.coach.toJournal(findings)      → compact copy for a journal entry's `coach` field
 *   BT.coach.summary(findings)        → one friendly sentence for the UI
 *
 * ctx = {account, bars, ind, journal, equity?, price?, time?, now?}
 *   account  BT.paper state ({cash, startingCash, positions, orders, trades, marks, equityHistory});
 *            defaults to BT.paper.getState() when BT.paper is loaded
 *   bars     the visible bars (Market Replay passes only bars up to the cursor)
 *   ind      BT.ind.computeAll(bars) result (only `sma50` is read; computed from bars if absent)
 *   journal  BT.journal entries (optional; the note is sent to the Pro AI coach)
 *   equity   overrides the equity computed from the account
 *   price    current price for an unfilled order
 *   time     current bar time (Replay); `now` wall-clock ms override (tests)
 *
 * Rules (thresholds in BT.coach.THRESHOLDS):
 *   risk      more than 1 % (tip) / 2 % (warn) of equity between entry and stop
 *   noStop    no planned stop and no protective stop order
 *   rr        planned reward-to-risk below 1.5 (warn below 1, or target on the wrong side)
 *   stopSlip  closed trade lost clearly more than the planned 1R
 *   trend     long below a falling SMA50, or short above a rising SMA50
 *   revenge   new position within 10 minutes (or 2 bars in Replay) of a losing close
 *   overtrade more than 5 new positions in one day
 *   size      position worth more than 25 % of equity
 *   avgDown   adding to a position that is already losing
 *
 * Educational only: findings describe the student's own process; nothing here
 * predicts prices or recommends a trade. All copy goes through BT.t.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.BT = root.BT || {};

  function T(s, v) {
    var BT = root.BT;
    if (BT && typeof BT.t === 'function') { try { return BT.t(s, v); } catch (e) { /* fall through */ } }
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; });
  }

  var THRESHOLDS = {
    riskTipPct: 1,
    riskWarnPct: 2,
    minRR: 1.5,
    revengeMinutes: 10,
    revengeBars: 2,
    maxTradesPerDay: 5,
    maxPositionPct: 25,
    stopSlipR: 1.25
  };

  // Every lesson id below exists in course/index.json (tests check it).
  var LESSONS = {
    risk: 'm4-l1',       // Position Sizing and the 1% Rule
    noStop: 'm4-l2',     // Stop Losses, Risk/Reward and Expectancy
    rr: 'm4-l2',
    stopSlip: 'm4-l2',
    trend: 'm3-l1',      // Moving averages and crossovers
    revenge: 'm4-l3',    // Drawdowns, Streaks and Trading Psychology
    overtrade: 'm4-l5',  // Your Trading Plan, Journal and Using the Paper Account Well
    size: 'm4-l1',
    avgDown: 'm4-l3'
  };
  var LESSON_TITLES = {
    'm3-l1': 'Moving averages and crossovers',
    'm4-l1': 'Position Sizing and the 1% Rule',
    'm4-l2': 'Stop Losses, Risk/Reward and Expectancy',
    'm4-l3': 'Drawdowns, Streaks and Trading Psychology',
    'm4-l5': 'Your Trading Plan, Journal and Using the Paper Account Well'
  };

  /* ------------------------------------------------------------------ *
   * small helpers
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isObj(v) { return v != null && typeof v === 'object'; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function firstNum() { for (var i = 0; i < arguments.length; i++) if (isNum(arguments[i])) return arguments[i]; return null; }
  function round(v, d) { var f = Math.pow(10, d == null ? 2 : d); return Math.round(v * f) / f; }
  function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  function money(v) {
    var BT = root.BT;
    if (BT && BT.i18n && typeof BT.i18n.fmtMoney === 'function') { try { return BT.i18n.fmtMoney(v); } catch (e) { /* fall through */ } }
    var s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-$' : '$') + s;
  }
  function pct(v) { return String(round(v, 1)); }
  function nowMs(ctx) { return isNum(ctx && ctx.now) ? ctx.now : Date.now(); }

  // Any bar / fill time → epoch milliseconds ('YYYY-MM-DD' strings, unix seconds or ms).
  function toMs(t) {
    if (isNum(t)) return t < 1e11 ? t * 1000 : t;
    if (typeof t === 'string' && t) { var p = Date.parse(t.length === 10 ? t + 'T00:00:00Z' : t); return isNum(p) ? p : null; }
    if (isObj(t) && isNum(t.year)) return Date.UTC(t.year, (t.month || 1) - 1, t.day || 1);
    return null;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // Bar times: day strings pass through; numbers are UTC (as in BT.paper's barDay).
  function barDay(t) {
    if (typeof t === 'string') return t.slice(0, 10);
    var ms = toMs(t);
    return ms == null ? null : new Date(ms).toISOString().slice(0, 10);
  }

  function finding(id, level, title, message) {
    return { id: id, level: level, title: title, message: message, lessonId: LESSONS[id] };
  }
  function finish(list) {
    var seen = {};
    return list.filter(function (f) { if (seen[f.id]) return false; seen[f.id] = true; return true; })
      .sort(function (a, b) { return (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1); });
  }

  function accountOf(ctx) {
    if (ctx && isObj(ctx.account)) return ctx.account;
    var P = root.BT && root.BT.paper;
    if (P && typeof P.getState === 'function') { try { var s = P.getState(); if (isObj(s)) return s; } catch (e) { /* ignore */ } }
    return {};
  }
  function multOf(o, pos) {
    var m = o && isObj(o.meta) ? o.meta.multiplier : null;
    if (!isNum(m) && pos && isObj(pos.meta)) m = pos.meta.multiplier;
    if (!isNum(m) && o && isNum(o.multiplier)) m = o.multiplier;
    return isNum(m) && m > 0 ? m : 1;
  }

  /** Equity: ctx.equity, else cash + positions at their last marks, else the last equity point, else starting cash. */
  function equityOf(acct, ctx) {
    if (ctx && isNum(ctx.equity) && ctx.equity > 0) return ctx.equity;
    if (isNum(acct.cash)) {
      var eq = acct.cash, marks = isObj(acct.marks) ? acct.marks : {}, pos = isObj(acct.positions) ? acct.positions : {};
      Object.keys(pos).forEach(function (s) {
        var p = pos[s];
        if (!isObj(p) || !isNum(p.qty)) return;
        var px = firstNum(marks[s], p.avg);
        if (isNum(px)) eq += p.qty * px * multOf(null, p);
      });
      if (eq > 0) return eq;
    }
    var hist = arr(acct.equityHistory);
    if (hist.length && isObj(hist[hist.length - 1]) && isNum(hist[hist.length - 1].equity)) return hist[hist.length - 1].equity;
    return isNum(acct.startingCash) && acct.startingCash > 0 ? acct.startingCash : null;
  }
  /** Equity at a past moment: the last equity-history point at or before `ms`. */
  function equityAt(acct, ms, ctx) {
    if (ctx && isNum(ctx.equity) && ctx.equity > 0) return ctx.equity;
    var hist = arr(acct.equityHistory), best = null;
    if (isNum(ms)) hist.forEach(function (h) { if (isObj(h) && isNum(h.equity) && isNum(toMs(h.t)) && toMs(h.t) <= ms) best = h.equity; });
    if (isNum(best) && best > 0) return best;
    return equityOf(acct, ctx);
  }

  /** Planned stop / target / risk % saved on an order's meta by the 'Plan this trade' panel. */
  function planOf(o) {
    if (!isObj(o)) return { stop: null, target: null };
    var m = isObj(o.meta) ? o.meta : {};
    var p = isObj(m.plan) ? m.plan : (isObj(m.risk) ? m.risk : {});
    return {
      stop: firstNum(p.stop, p.stopPrice, m.stop, m.plannedStop, m.stopLoss, m.stopPrice, o.stop, o.stopLoss),
      target: firstNum(p.target, p.targetPrice, m.target, m.plannedTarget, m.takeProfit, m.targetPrice, o.target, o.takeProfit)
    };
  }

  /* ------------------------------------------------------------------ *
   * bars & trend
   * ------------------------------------------------------------------ */
  function barIndexAt(bars, t) {
    var ms = toMs(t);
    if (!isNum(ms) || !bars.length) return -1;
    var idx = -1;
    for (var i = 0; i < bars.length; i++) {
      var b = toMs(bars[i] && bars[i].time);
      if (isNum(b) && b <= ms) idx = i; else if (isNum(b) && b > ms) break;
    }
    return idx;
  }
  function exactBarIndex(bars, t) {
    var ms = toMs(t);
    if (!isNum(ms)) return -1;
    for (var i = bars.length - 1; i >= 0; i--) if (toMs(bars[i] && bars[i].time) === ms) return i;
    return -1;
  }
  function sma50At(ctx, bars, i) {
    var ind = ctx && ctx.ind;
    if (ind && Array.isArray(ind.sma50) && ind.sma50.length === bars.length) return isNum(ind.sma50[i]) ? ind.sma50[i] : null;
    if (i < 49) return null;
    var sum = 0;
    for (var k = i - 49; k <= i; k++) { var c = bars[k] && bars[k].close; if (!isNum(c)) return null; sum += c; }
    return sum / 50;
  }
  /** {against, close, sma, dir} for a position direction (+1 long, -1 short) at bar i; null when unknown. */
  function trendCheck(ctx, dir, i) {
    var bars = arr(ctx && ctx.bars);
    if (!bars.length) return null;
    if (i == null || i < 0 || i >= bars.length) i = bars.length - 1;
    var now = sma50At(ctx, bars, i), before = i >= 5 ? sma50At(ctx, bars, i - 5) : null;
    var close = bars[i] && bars[i].close;
    if (!isNum(now) || !isNum(before) || !isNum(close)) return null;
    var falling = now < before, rising = now > before;
    var against = dir > 0 ? (close < now && falling) : (close > now && rising);
    return { against: against, close: close, sma: now };
  }

  /* ------------------------------------------------------------------ *
   * shared rule builders
   * ------------------------------------------------------------------ */
  function riskFindings(out, dir, entry, stop, target, qty, mult, equity, closed) {
    if (!isNum(stop)) return null;
    var perUnit = (entry - stop) * dir;
    if (!(perUnit > 0)) {
      out.push(finding('noStop', 'warn', T('Stop on the wrong side'),
        T('Your planned stop ({stop}) is not {where} the entry ({entry}), so it would not limit a loss. A long stop sits below the entry and a short stop above it.',
          { stop: money(stop), entry: money(entry), where: dir > 0 ? T('below') : T('above') })));
      return null;
    }
    var dollarRisk = perUnit * qty * mult;
    if (isNum(equity) && equity > 0) {
      var rp = dollarRisk / equity * 100;
      if (rp > THRESHOLDS.riskWarnPct + 1e-9) {
        out.push(finding('risk', 'warn', T('Risk above 2% of the account'),
          T('{verb} {risk} between entry and stop, {pct}% of your {equity} account. A normal losing streak at this size can take a deep bite out of the account. Many traders keep each trade at 1% or less.',
            { verb: closed ? T('This trade risked') : T('This order risks'), risk: money(dollarRisk), pct: pct(rp), equity: money(equity) })));
      } else if (rp > THRESHOLDS.riskTipPct + 1e-9) {
        out.push(finding('risk', 'tip', T('Risk above the 1% guideline'),
          T('{verb} {risk}, {pct}% of your account. That is inside the common 2% ceiling but above the 1% many traders use while they are still learning.',
            { verb: closed ? T('This trade risked') : T('This order risks'), risk: money(dollarRisk), pct: pct(rp) })));
      }
    }
    if (isNum(target)) {
      var reward = (target - entry) * dir;
      if (!(reward > 0)) {
        out.push(finding('rr', 'warn', T('Target on the wrong side'),
          T('Your target ({target}) is not {where} the entry ({entry}), so reaching it would not be a profit. Check the side of the trade and the target price.',
            { target: money(target), entry: money(entry), where: dir > 0 ? T('above') : T('below') })));
      } else {
        var rr = reward / perUnit;
        if (rr < THRESHOLDS.minRR - 1e-9) {
          var be = 100 / (1 + rr);
          out.push(finding('rr', rr < 1 ? 'warn' : 'tip', T('Low reward-to-risk'),
            T('The plan aims for {rr}:1 (reward ÷ risk). At that ratio you must win about {be}% of trades just to break even, before costs. A target at least 1.5 times the risk gives you more room to be wrong.',
              { rr: round(rr, 2), be: round(be, 0) })));
        }
      }
    }
    return perUnit;
  }
  function noStopFinding(closed) {
    return finding('noStop', 'warn', T('No stop-loss'),
      closed
        ? T('No stop was planned or placed for this trade. Without one, a single bad move can turn a small loss into a large one. Decide where you are wrong before you enter, and save the stop with the order.')
        : T('This order has no planned stop and there is no protective stop order for it. Decide the price where your idea is wrong before you enter, and size the trade from that distance.'));
  }
  function sizeFinding(value, equity) {
    if (!(isNum(equity) && equity > 0 && isNum(value))) return null;
    var p = Math.abs(value) / equity * 100;
    if (p <= THRESHOLDS.maxPositionPct + 1e-9) return null;
    return finding('size', 'warn', T('Large position'),
      T('This position is worth {value}, {pct}% of your account. With more than a quarter of the account in one name, an overnight gap through your stop would hurt far more than planned.',
        { value: money(Math.abs(value)), pct: pct(p) }));
  }
  function trendFinding(dir) {
    return finding('trend', 'tip', T('Against the SMA50 trend'),
      dir > 0
        ? T('You bought while price was below a falling 50-bar moving average (SMA50). Trades against the trend can work, but they fail more often, so they deserve a clear reason and a smaller size.')
        : T('You sold short while price was above a rising 50-bar moving average (SMA50). Trades against the trend can work, but they fail more often, so they deserve a clear reason and a smaller size.'));
  }
  function revengeFinding(loss, gap) {
    return finding('revenge', 'warn', T('Possible revenge trade'),
      T('This position was opened {gap} after a losing trade ({loss}). Jumping straight back in to win the money back is one of the most expensive habits in trading. A short pause and a check against your plan help.',
        { gap: gap, loss: money(loss) }));
  }
  function overtradeFinding(n) {
    return finding('overtrade', 'warn', T('Overtrading'),
      T('That makes {n} new positions in one day. More trades mean more costs and more decisions made in a hurry. Most plans set a daily limit; trade only the setups your plan describes.', { n: n }));
  }
  function avgDownFinding(avg, price) {
    return finding('avgDown', 'warn', T('Adding to a loser'),
      T('You added to a position that was already losing (average cost {avg}, new fill {price}). Averaging down grows your risk exactly when the market is telling you the idea is not working. Decide in advance whether adds are part of your plan.',
        { avg: money(avg), price: money(price) }));
  }

  /* Most recent losing close before `beforeMs`, ignoring fills of `skipOrderId`. */
  function lastLossBefore(trades, beforeMs, skipOrderId, beforeTradeId) {
    var best = null, stop = false;
    trades.forEach(function (t) {
      if (stop || (beforeTradeId != null && isObj(t) && t.id === beforeTradeId)) { stop = true; return; }
      if (!isObj(t) || !(t.closedQty > 0) || !(isNum(t.realized) && t.realized < 0)) return;
      if (skipOrderId != null && t.orderId === skipOrderId) return;
      if (isNum(beforeMs) && isNum(t.time) && t.time > beforeMs) return;
      if (!best || (isNum(t.time) && t.time >= best.time)) best = t;
    });
    return best;
  }
  /** Revenge check: bar distance when both bar times are known on the given bars, else wall-clock minutes. */
  function revengeGap(loss, ctx, entryMs, entryBarTime) {
    var bars = arr(ctx && ctx.bars);
    // Only when the loss was booked on one of these bars (Replay); dashboard fills carry wall-clock times.
    var li = loss.barTime != null ? exactBarIndex(bars, loss.barTime) : -1;
    if (li >= 0) {
      var ei = entryBarTime != null ? exactBarIndex(bars, entryBarTime) : bars.length - 1;
      if (li >= 0 && ei >= 0) {
        var d = ei - li;
        if (d < 0 || d > THRESHOLDS.revengeBars) return null;
        return d === 0 ? T('in the same bar') : (d === 1 ? T('one bar') : T('{n} bars', { n: d }));
      }
    }
    if (!isNum(loss.time) || !isNum(entryMs)) return null;
    var min = (entryMs - loss.time) / 60000;
    if (min < 0 || min > THRESHOLDS.revengeMinutes) return null;
    return min < 1 ? T('less than a minute') : T('{n} minutes', { n: Math.round(min) });
  }
  /** Distinct new positions (opening fills grouped by order) on a day. */
  function opensOnDay(trades, day, useBar, skipOrderId) {
    var keys = {};
    trades.forEach(function (t) {
      if (!isObj(t) || !(t.openedQty > 0)) return;
      if (skipOrderId != null && t.orderId === skipOrderId) return;
      var d = useBar && t.barTime != null ? barDay(t.barTime) : (isNum(t.time) ? localDay(t.time) : null);
      if (d === day) keys[t.orderId != null ? 'o' + t.orderId : 't' + t.id] = 1;
    });
    return Object.keys(keys).length;
  }

  /* ------------------------------------------------------------------ *
   * reviewOrder
   * ------------------------------------------------------------------ */
  function reviewOrder(order, ctx) {
    ctx = ctx || {};
    if (!isObj(order) || (order.side !== 'buy' && order.side !== 'sell')) return [];
    if (order.status === 'rejected' || order.status === 'cancelled') return [];
    var acct = accountOf(ctx);
    var trades = arr(acct.trades), orders = arr(acct.orders);
    var symbol = String(order.symbol || '').toUpperCase();
    var positions = isObj(acct.positions) ? acct.positions : {};
    var pos = positions[symbol] || positions[order.symbol] || null;
    var dir = order.side === 'buy' ? 1 : -1;
    var qty = Number(order.qty);
    var bars = arr(ctx.bars);
    var lastClose = bars.length && isObj(bars[bars.length - 1]) ? bars[bars.length - 1].close : null;
    var marks = isObj(acct.marks) ? acct.marks : {};

    // Fills already made by this order (when reviewed after the fill).
    var fills = order.id != null ? trades.filter(function (t) { return isObj(t) && t.orderId === order.id; }) : [];
    var entry, openQty, preQty, preAvg;
    var curQty = pos && isNum(pos.qty) ? pos.qty : 0;
    if (fills.length) {
      var opened = 0, closedQ = 0, signed = 0, pv = 0, fq = 0, openPv = 0;
      fills.forEach(function (t) {
        opened += t.openedQty || 0; closedQ += t.closedQty || 0;
        signed += (t.side === 'buy' ? 1 : -1) * t.qty; pv += t.price * t.qty; fq += t.qty;
        openPv += t.price * (t.openedQty || 0);
      });
      if (!(opened > 0)) return [];                    // purely a closing order: nothing to plan
      entry = fq ? pv / fq : null;
      openQty = opened;
      preQty = closedQ > 0 ? 0 : curQty - signed;      // a reversal starts from flat
      preAvg = null;
      if (preQty !== 0 && pos && isNum(pos.avg)) {
        var a = (pos.avg * Math.abs(curQty) - openPv) / Math.abs(preQty);
        preAvg = a > 0 ? a : null;
      }
    } else {
      if (!(qty > 0)) return [];
      entry = firstNum(order.fillPrice, order.price, ctx.price,
        (order.type === 'limit' || order.type === 'stop_limit') ? order.limitPrice : null,
        order.type === 'stop' ? order.stopPrice : null, marks[symbol], lastClose);
      preQty = curQty; preAvg = pos && isNum(pos.avg) ? pos.avg : null;
      if (preQty !== 0 && sign(preQty) !== dir) {
        if (qty <= Math.abs(preQty)) return [];        // closing or reducing
        openQty = qty - Math.abs(preQty); preQty = 0; preAvg = null;
      } else openQty = qty;
    }
    if (!isNum(entry) || !(entry > 0) || !(openQty > 0)) return [];

    var out = [];
    var mult = multOf(order, pos);
    var equity = equityOf(acct, ctx);
    var plan = planOf(order);
    var stop = plan.stop;
    if (!isNum(stop)) {
      // A protective stop order already working on the account counts.
      var prot = orders.filter(function (o) {
        return isObj(o) && o !== order && o.id !== order.id && String(o.symbol || '').toUpperCase() === symbol &&
          (o.type === 'stop' || o.type === 'stop_limit') && (o.status === 'open' || o.status === 'partial') &&
          o.side === (dir > 0 ? 'sell' : 'buy') && isNum(o.stopPrice) && (dir > 0 ? o.stopPrice < entry : o.stopPrice > entry);
      })[0];
      if (prot) stop = prot.stopPrice;
    }
    var totalQty = Math.abs(preQty) + openQty;
    if (!isNum(stop)) out.push(noStopFinding(false));
    else riskFindings(out, dir, entry, stop, plan.target, totalQty, mult, equity, false);

    var sf = sizeFinding(totalQty * entry * mult, equity);
    if (sf) out.push(sf);

    if (preQty !== 0 && sign(preQty) === dir && isNum(preAvg) && (dir > 0 ? entry < preAvg * 0.999 : entry > preAvg * 1.001)) {
      out.push(avgDownFinding(preAvg, entry));
    }

    if ((order.kind || 'stock') !== 'option') {
      var tc = trendCheck(ctx, dir, null);
      if (tc && tc.against) out.push(trendFinding(dir));
    }

    var refMs = isNum(order.filledAt) ? order.filledAt : nowMs(ctx);
    var refBar = ctx.time != null ? ctx.time : (order.filledBarTime != null ? order.filledBarTime : null);
    var loss = lastLossBefore(trades, refMs, order.id, null);
    if (loss) {
      var gap = revengeGap(loss, ctx, refMs, refBar);
      if (gap) out.push(revengeFinding(loss.realized, gap));
    }

    var useBar = refBar != null;
    var day = useBar ? barDay(refBar) : localDay(refMs);
    var n = opensOnDay(trades, day, useBar, order.id) + 1;
    if (n > THRESHOLDS.maxTradesPerDay) out.push(overtradeFinding(n));

    return finish(out);
  }

  /* ------------------------------------------------------------------ *
   * reviewTrade
   * ------------------------------------------------------------------ */
  /** Rebuild a round trip from a paper closing fill and the account's history. */
  function roundTripFromFill(t, acct) {
    var trades = arr(acct.trades), orders = arr(acct.orders);
    var byId = {};
    orders.forEach(function (o) { if (isObj(o) && o.id != null) byId[o.id] = o; });
    var mult = isNum(t.multiplier) && t.multiplier > 0 ? t.multiplier : 1;
    var dir = t.side === 'sell' ? 1 : -1;                 // direction of the position being closed
    var qty = t.closedQty;
    var commission = isNum(t.commission) ? t.commission : 0;
    var entry = isNum(t.realized) ? t.price - (t.realized + commission) / (qty * mult * dir) : null;

    var same = trades.filter(function (x) { return isObj(x) && x.symbol === t.symbol; });
    var idx = same.indexOf(t);
    if (idx < 0) for (var j = 0; j < same.length; j++) if (same[j].id === t.id) { idx = j; break; }
    if (idx < 0) idx = same.length;
    // find the start of the episode that this fill closes
    var q = 0, start = 0;
    for (var i = 0; i < idx; i++) {
      var x = same[i], s = (x.side === 'buy' ? 1 : -1) * x.qty;
      var before = q; q += s;
      if (Math.abs(q) < 1e-9) { q = 0; start = i + 1; }
      else if (before !== 0 && sign(before) !== sign(q)) start = i;   // reversal opened a new episode
    }
    var opens = [], running = 0, avg = 0, maxQty = 0, avgDown = null;
    for (var k = start; k < idx; k++) {
      var f = same[k];
      if (f.openedQty > 0 && (f.side === 'buy' ? 1 : -1) === dir) {
        if (running > 0 && !avgDown && (dir > 0 ? f.price < avg * 0.999 : f.price > avg * 1.001)) avgDown = { avg: avg, price: f.price };
        avg = (avg * running + f.price * f.openedQty) / (running + f.openedQty);
        running += f.openedQty;
        opens.push(f);
      } else if (f.closedQty > 0) running = Math.max(0, running - f.closedQty);
      if (running > maxQty) maxQty = running;
    }
    var first = opens[0] || null;
    var entryOrder = first && first.orderId != null ? byId[first.orderId] : null;
    var plan = planOf(entryOrder);
    for (var m = 1; m < opens.length && !isNum(plan.stop); m++) {
      var p2 = planOf(byId[opens[m].orderId]);
      if (isNum(p2.stop)) plan = p2;
    }
    var stop = plan.stop;
    if (!isNum(stop)) {
      var exitOrder = t.orderId != null ? byId[t.orderId] : null;
      if (exitOrder && (exitOrder.type === 'stop' || exitOrder.type === 'stop_limit') && isNum(exitOrder.stopPrice)) stop = exitOrder.stopPrice;
    }
    if (!isNum(stop)) {
      var from = entryOrder && isNum(entryOrder.placedAt) ? entryOrder.placedAt - 1000 : (first && isNum(first.time) ? first.time - 1000 : -Infinity);
      var to = isNum(t.time) ? t.time + 1000 : Infinity;
      var prot = orders.filter(function (o) {
        return isObj(o) && o.symbol === t.symbol && (o.type === 'stop' || o.type === 'stop_limit') && o.status !== 'rejected' &&
          o.side === (dir > 0 ? 'sell' : 'buy') && isNum(o.stopPrice) && isNum(o.placedAt) && o.placedAt >= from && o.placedAt <= to;
      })[0];
      if (prot) stop = prot.stopPrice;
    }
    return {
      symbol: t.symbol, kind: t.kind || 'stock', dir: dir, qty: qty, maxQty: Math.max(maxQty, qty), mult: mult,
      entry: first ? (isNum(entry) && entry > 0 ? entry : first.price) : entry, exit: t.price, stop: stop, target: plan.target,
      pnl: isNum(t.realized) ? t.realized : null,
      entryTime: first ? first.time : null, entryBarTime: first ? first.barTime : null,
      entryOrderId: first ? first.orderId : null, entryTradeId: first ? first.id : null,
      exitTime: t.time, avgDown: avgDown, entryFound: !!first
    };
  }
  /** Accept an already-summarised round trip ({side:'long'|'short', entry, exit, ...}). */
  function roundTripFromSummary(t) {
    var dir = (t.side === 'short' || t.side === 'sell') ? -1 : 1;
    var adds = arr(t.adds), avgDown = null;
    if (adds.length) {
      var run = 0, avg = 0;
      [{ price: t.entry, qty: t.qty }].concat(adds).forEach(function (a) {
        if (!isNum(a.price) || !(a.qty > 0)) return;
        if (run > 0 && !avgDown && (dir > 0 ? a.price < avg * 0.999 : a.price > avg * 1.001)) avgDown = { avg: avg, price: a.price };
        avg = (avg * run + a.price * a.qty) / (run + a.qty); run += a.qty;
      });
    }
    return {
      symbol: t.symbol, kind: t.kind || 'stock', dir: dir, qty: Number(t.qty), maxQty: firstNum(t.maxQty, Number(t.qty)),
      mult: isNum(t.multiplier) && t.multiplier > 0 ? t.multiplier : 1,
      entry: t.entry, exit: t.exit, stop: firstNum(t.stop), target: firstNum(t.target), pnl: firstNum(t.pnl, t.realized),
      entryTime: toMs(firstNum(t.entryTime, t.openedAt)), entryBarTime: t.entryBarTime != null ? t.entryBarTime : null,
      entryOrderId: t.entryOrderId != null ? t.entryOrderId : null, entryTradeId: null,
      exitTime: toMs(firstNum(t.exitTime, t.closedAt)), avgDown: avgDown, entryFound: true, equity: firstNum(t.equity)
    };
  }

  function reviewTrade(trade, ctx) {
    ctx = ctx || {};
    if (!isObj(trade)) return [];
    var acct = accountOf(ctx);
    var rt;
    if (isNum(trade.entry) && isNum(trade.exit)) rt = roundTripFromSummary(trade);
    else if (trade.closedQty > 0 && isNum(trade.price)) rt = roundTripFromFill(trade, acct);
    else if (trade.openedQty > 0) {
      // An opening fill: review it as the order it came from.
      var o = arr(acct.orders).filter(function (x) { return isObj(x) && x.id === trade.orderId; })[0];
      return reviewOrder(o || { id: trade.orderId, symbol: trade.symbol, side: trade.side, qty: trade.qty, price: trade.price, status: 'filled', filledAt: trade.time, filledBarTime: trade.barTime, kind: trade.kind }, ctx);
    } else return [];
    if (!isNum(rt.entry) || !(rt.entry > 0) || !(rt.qty > 0)) return [];

    var out = [];
    var trades = arr(acct.trades);
    var equity = isNum(rt.equity) ? rt.equity : equityAt(acct, rt.entryTime, ctx);

    if (!isNum(rt.stop)) out.push(noStopFinding(true));
    else {
      var perUnit = riskFindings(out, rt.dir, rt.entry, rt.stop, rt.target, rt.maxQty, rt.mult, equity, true);
      if (perUnit && isNum(rt.exit)) {
        var r = (rt.exit - rt.entry) * rt.dir / perUnit;
        if (r < -THRESHOLDS.stopSlipR) {
          out.push(finding('stopSlip', 'warn', T('Loss bigger than planned'),
            T('This trade lost {r}R, more than the 1R your stop allowed. Either the stop was moved or removed, or price gapped past it. Keep the stop where you planned it, and size smaller in names that gap.',
              { r: round(Math.abs(r), 1) })));
        }
      }
    }

    var sf = sizeFinding(rt.maxQty * rt.entry * rt.mult, equity);
    if (sf) out.push(sf);
    if (rt.avgDown) out.push(avgDownFinding(rt.avgDown.avg, rt.avgDown.price));

    if (rt.kind !== 'option') {
      var bars = arr(ctx.bars), bi = null;
      if (bars.length) {
        if (rt.entryBarTime != null) bi = barIndexAt(bars, rt.entryBarTime);
        else if (isNum(rt.entryTime)) bi = barIndexAt(bars, rt.entryTime);
        if (bi != null && bi < 0) bi = -2;                 // entry before the loaded bars: unknown
      }
      if (bi !== -2) {
        var tc = trendCheck(ctx, rt.dir, bi);
        if (tc && tc.against) out.push(trendFinding(rt.dir));
      }
    }

    if (rt.entryFound && isNum(rt.entryTime)) {
      var loss = lastLossBefore(trades, rt.entryTime, rt.entryOrderId, rt.entryTradeId);
      if (loss) {
        var gap = revengeGap(loss, ctx, rt.entryTime, rt.entryBarTime);
        if (gap) out.push(revengeFinding(loss.realized, gap));
      }
      var useBar = rt.entryBarTime != null;
      var day = useBar ? barDay(rt.entryBarTime) : localDay(rt.entryTime);
      var n = opensOnDay(trades.filter(function (x) { return isObj(x) && isNum(x.time) && x.time <= rt.entryTime; }), day, useBar, null);
      if (rt.entryOrderId == null && rt.entryTradeId == null) n += 1;
      if (n > THRESHOLDS.maxTradesPerDay) out.push(overtradeFinding(n));
    }
    return finish(out);
  }

  /* ------------------------------------------------------------------ *
   * presentation helpers
   * ------------------------------------------------------------------ */
  function lessonUrl(id) { return 'learn.html#/lesson/' + encodeURIComponent(id || ''); }
  function lessonTitle(id) { return LESSON_TITLES[id] ? T(LESSON_TITLES[id]) : ''; }
  function summary(findings) {
    var list = arr(findings);
    var warns = list.filter(function (f) { return f && f.level === 'warn'; }).length;
    if (!list.length) return T('Coach: no issues found in the plan or sizing. Win or lose, a trade with a planned stop and a sensible size is a well-run trade.');
    if (!warns) return list.length === 1 ? T('Coach: 1 tip for this trade.') : T('Coach: {n} tips for this trade.', { n: list.length });
    return warns === 1 ? T('Coach: 1 thing to fix and {n} tips.', { n: list.length - 1 }) : T('Coach: {w} things to fix and {n} tips.', { w: warns, n: list.length - warns });
  }
  /** Compact, storable copy for journal entries (`coach` field). */
  function toJournal(findings, extra) {
    var out = {
      at: Date.now(),
      findings: arr(findings).slice(0, 10).map(function (f) {
        return { id: f.id, level: f.level === 'warn' ? 'warn' : 'tip', title: String(f.title || ''), message: String(f.message || ''), lessonId: f.lessonId || null };
      })
    };
    if (isObj(extra) && typeof extra.ai === 'string' && extra.ai) out.ai = extra.ai.slice(0, 2000);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Pro AI coach
   * ------------------------------------------------------------------ */
  function langCode() {
    var I = root.BT && root.BT.i18n;
    try { if (I && typeof I.lang === 'function') return I.lang() === 'es' ? 'es' : 'en'; } catch (e) { /* ignore */ }
    return 'en';
  }
  function noteFor(trade, opts) {
    if (opts && typeof opts.note === 'string') return opts.note;
    var list = arr(opts && opts.journal);
    if (!list.length && root.BT && root.BT.journal && typeof root.BT.journal.list === 'function') {
      try { list = arr(root.BT.journal.list()); } catch (e) { list = []; }
    }
    var e = list.filter(function (x) {
      return isObj(x) && isObj(x.trade) && trade && (x.trade.id === trade.id || (x.tradeId && String(x.tradeId).slice(-String(trade.id).length - 1) === ':' + trade.id));
    })[0];
    return e ? [e.setup ? 'Setup: ' + e.setup : '', e.emotion ? 'Emotion: ' + e.emotion : '', e.notes || '', e.lessons || ''].filter(Boolean).join('\n') : '';
  }
  /** Facts sent to the worker (matches server/worker.js sanitizeCoachTrade). */
  function aiFacts(trade, ctx) {
    var acct = accountOf(ctx);
    var rt = null;
    if (isObj(trade)) {
      if (isNum(trade.entry) && isNum(trade.exit)) rt = roundTripFromSummary(trade);
      else if (trade.closedQty > 0 && isNum(trade.price)) rt = roundTripFromFill(trade, acct);
    }
    if (!rt) {
      return { symbol: trade && trade.symbol, kind: trade && trade.kind, side: trade && trade.side === 'sell' ? 'short' : 'long',
        qty: trade && trade.qty, entry: trade && trade.price };
    }
    var equity = isNum(rt.equity) ? rt.equity : equityAt(acct, rt.entryTime, ctx);
    var perUnit = isNum(rt.stop) ? (rt.entry - rt.stop) * rt.dir : null;
    var facts = {
      symbol: rt.symbol, kind: rt.kind, side: rt.dir > 0 ? 'long' : 'short', qty: rt.qty,
      entry: round(rt.entry, 4), exit: rt.exit, stop: rt.stop, target: rt.target, pnl: rt.pnl,
      pnlPct: isNum(rt.exit) ? round((rt.exit - rt.entry) * rt.dir / rt.entry * 100, 2) : null,
      rMultiple: perUnit > 0 && isNum(rt.exit) ? round((rt.exit - rt.entry) * rt.dir / perUnit, 2) : null,
      riskPct: perUnit > 0 && equity ? round(perUnit * rt.maxQty * rt.mult / equity * 100, 2) : null,
      positionPct: equity ? round(rt.maxQty * rt.entry * rt.mult / equity * 100, 2) : null,
      equity: equity,
      holdMinutes: isNum(rt.entryTime) && isNum(rt.exitTime) ? Math.max(0, Math.round((rt.exitTime - rt.entryTime) / 60000)) : null,
      opened: isNum(rt.entryTime) ? new Date(rt.entryTime).toISOString() : null,
      closed: isNum(rt.exitTime) ? new Date(rt.exitTime).toISOString() : null
    };
    Object.keys(facts).forEach(function (k) { if (facts[k] == null) delete facts[k]; });
    return facts;
  }

  /**
   * ai(trade, opts?) → Promise resolving (never rejecting) to
   *   {ok, source:'ai'|'rules', text, findings, fallback:boolean, reason, remaining?}
   * opts = {ctx, note, journal, findings, fetch}. Posts to the worker's /coach route only when an API
   * base is configured and the member is Pro; otherwise (or on any failure) it returns the rule-based
   * findings with fallback:true so the UI can keep showing them.
   */
  function ai(trade, opts) {
    opts = opts || {};
    var ctx = opts.ctx || opts;
    var findings;
    try { findings = Array.isArray(opts.findings) ? opts.findings : reviewTrade(trade, ctx); } catch (e) { findings = []; }
    function fallback(reason, extra) {
      var r = { ok: false, source: 'rules', text: '', findings: findings, fallback: true, reason: reason };
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      return r;
    }
    var A = root.BT && root.BT.auth;
    var fetchFn = typeof opts.fetch === 'function' ? opts.fetch : (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    try {
      if (!A || typeof A.configured !== 'function' || !A.configured()) return Promise.resolve(fallback('not-configured'));
      if (typeof A.isPro !== 'function' || !A.isPro()) return Promise.resolve(fallback('not-pro'));
      if (!fetchFn) return Promise.resolve(fallback('network'));
    } catch (e) { return Promise.resolve(fallback('error')); }

    var token = null;
    try {
      var s = A._store && typeof A._store.get === 'function' ? A._store.get('bt.auth', null) : JSON.parse(root.localStorage.getItem('bt.auth') || 'null');
      token = s && s.token ? s.token : null;
    } catch (e) { token = null; }
    if (!token) return Promise.resolve(fallback('not-signed-in'));

    var body;
    try {
      body = JSON.stringify({
        trade: aiFacts(trade, ctx),
        note: String(noteFor(trade, opts) || '').slice(0, 1000),
        rules: findings.slice(0, 8).map(function (f) { return { level: f.level, title: f.title, message: f.message }; }),
        lang: langCode()
      });
    } catch (e) { return Promise.resolve(fallback('error')); }

    var url = typeof A.apiUrl === 'function' ? A.apiUrl('/coach') : String(A.config && A.config.apiBase || '').replace(/\/+$/, '') + '/coach';
    var ctrl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ignore */ } }, 20000) : null;
    var p;
    try {
      p = Promise.resolve(fetchFn(url, {
        method: 'POST', mode: 'cors', signal: ctrl ? ctrl.signal : undefined,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: body
      }));
    } catch (e) { p = Promise.reject(e); }
    return p.then(function (res) {
      return Promise.resolve(res && typeof res.json === 'function' ? res.json() : null).catch(function () { return null; }).then(function (data) {
        if (!res || !res.ok || !data || !data.ok || typeof data.text !== 'string' || !data.text.trim()) {
          return fallback(res && res.status === 429 ? 'limit' : (res && (res.status === 401 || res.status === 403) ? 'not-pro' : 'unavailable'),
            { status: res ? res.status : 0, error: data && data.error ? String(data.error) : '' });
        }
        return { ok: true, source: 'ai', text: data.text.trim(), findings: findings, fallback: false, reason: null,
          remaining: isNum(data.remaining) ? data.remaining : null, model: data.model || null };
      });
    }, function () { return fallback('network'); }).then(function (r) { if (timer) clearTimeout(timer); return r; });
  }

  root.BT.coach = {
    reviewOrder: reviewOrder,
    reviewTrade: reviewTrade,
    ai: ai,
    lessonUrl: lessonUrl,
    lessonTitle: lessonTitle,
    summary: summary,
    toJournal: toJournal,
    THRESHOLDS: THRESHOLDS,
    LESSONS: LESSONS,
    _aiFacts: aiFacts
  };
})();
