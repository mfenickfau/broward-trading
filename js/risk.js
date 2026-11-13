/* Broward Trading — js/risk.js → BT.risk
 *
 * Pure risk-management maths for the "Plan this trade" panel (dashboard
 * ticket) and the risk calculator on portfolio.html. No DOM, no storage, no
 * network: every function takes numbers and returns numbers or plain objects.
 *
 * The core idea students should take away: decide how much you are willing to
 * LOSE first (a small % of equity, typically 0.5–2 %), place the stop where
 * the trade idea is proven wrong, and let the distance between entry and stop
 * decide the position size. Never the other way round.
 *
 *   positionSize({equity, riskPct, entry, stop, maxPositionPct?})
 *       → {shares, dollarRisk, positionValue, pctOfEquity, riskPerShare, side, cappedBy, error}
 *   rMultiple(entry, stop, exit)            result of a trade in units of initial risk (R)
 *   rewardRisk({entry, stop, target})       planned reward ÷ risk
 *   breakevenWinRate(rr)                    1 / (1 + rr): win rate needed to break even
 *   kellyFraction(winRate, rr)              W − (1 − W) / rr (educational only: use a fraction)
 *   expectancy(winRate, rr)                 average result per trade, in R
 *   planTrade({equity, riskPct, entry, stop, target})  everything above in one object
 *
 * Win rates may be given as a fraction (0.45) or a percentage (45).
 * Nothing here is a recommendation to trade; it is arithmetic for practice.
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
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v) { var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return isNum(n) ? n : NaN; }
  function cents(v) { return Math.round(v * 100) / 100; }
  function round(v, d) { var f = Math.pow(10, d == null ? 4 : d); return Math.round(v * f) / f; }
  // floor that forgives binary noise (1000 / 2.5 must be 400, not 399)
  function floorSafe(v) { return Math.floor(v + 1e-9); }
  function winFraction(w) {
    w = num(w);
    if (!isNum(w) || w < 0) return NaN;
    if (w > 1) w = w / 100;
    return w > 1 ? NaN : w;
  }

  /**
   * positionSize({equity, riskPct, entry, stop, maxPositionPct = 100, lot = 1})
   * shares = floor(equity × riskPct% ÷ |entry − stop|), rounded DOWN to whole
   * lots, then capped so the position never costs more than maxPositionPct of
   * equity (100 % = never more than the whole account, i.e. no leverage).
   * A stop above the entry means a short trade; the maths is symmetric.
   */
  function positionSize(o) {
    o = o || {};
    var equity = num(o.equity), riskPct = num(o.riskPct), entry = num(o.entry), stop = num(o.stop);
    var maxPct = o.maxPositionPct == null ? 100 : num(o.maxPositionPct);
    var lot = o.lot == null ? 1 : num(o.lot);
    var out = { shares: 0, dollarRisk: 0, positionValue: 0, pctOfEquity: 0, riskPerShare: 0, riskPctActual: 0, side: null, cappedBy: null, error: null };
    if (!(equity > 0)) { out.error = T('Enter your account equity (a positive amount).'); return out; }
    if (!(riskPct > 0)) { out.error = T('Enter the % of equity you are willing to risk (for example 1).'); return out; }
    if (riskPct > 100) { out.error = T('Risk per trade cannot be more than 100% of equity. Most traders use 0.5–2%.'); return out; }
    if (!(entry > 0)) { out.error = T('Enter a positive entry price.'); return out; }
    if (!(stop > 0)) { out.error = T('Enter a positive stop-loss price.'); return out; }
    if (entry === stop) { out.error = T('The stop must be different from the entry; the distance between them is your risk per share.'); return out; }
    if (!(maxPct > 0)) maxPct = 100;
    if (!(lot >= 1)) lot = 1;

    var riskPerShare = Math.abs(entry - stop);
    var budget = equity * riskPct / 100;
    var byRisk = floorSafe(budget / riskPerShare / lot) * lot;
    var byEquity = floorSafe(equity * Math.min(maxPct, 100) / 100 / entry / lot) * lot;    var shares = Math.max(0, Math.min(byRisk, byEquity));
    out.side = stop < entry ? 'long' : 'short';
    out.riskPerShare = round(riskPerShare, 4);
    if (byEquity < byRisk) out.cappedBy = maxPct < 100 ? 'maxPosition' : 'equity';
    out.shares = shares;
    out.dollarRisk = cents(shares * riskPerShare);
    out.positionValue = cents(shares * entry);
    out.pctOfEquity = round(shares * entry / equity * 100, 2);
    out.riskPctActual = round(shares * riskPerShare / equity * 100, 3);
    out.budget = cents(budget);
    if (shares === 0) {
      out.error = byRisk === 0
        ? T('Your risk budget of {budget} is smaller than the risk of one share ({per}). Widen your budget, use a closer stop, or skip this trade.', { budget: '$' + cents(budget).toFixed(2), per: '$' + round(riskPerShare, 4) })
        : T('One share costs more than you allow for a single position.');
    }
    return out;
  }

  /**
   * rMultiple(entry, stop, exit) or rMultiple({entry, stop, exit})
   * (exit − entry) ÷ (entry − stop): +2 means you made twice what you risked,
   * −1 means the stop was hit exactly. Works for shorts (stop above entry).
   */
  function rMultiple(entry, stop, exit) {
    if (entry && typeof entry === 'object') { stop = entry.stop; exit = entry.exit; entry = entry.entry; }
    entry = num(entry); stop = num(stop); exit = num(exit);
    if (!isNum(entry) || !isNum(stop) || !isNum(exit) || entry === stop) return null;
    return round((exit - entry) / (entry - stop), 4);
  }

  /** rewardRisk({entry, stop, target}) → planned reward ÷ risk, or null if the target is on the wrong side. */
  function rewardRisk(o) {
    o = o || {};
    var entry = num(o.entry), stop = num(o.stop), target = num(o.target);
    if (!isNum(entry) || !isNum(stop) || !isNum(target) || entry === stop) return null;
    var r = rMultiple(entry, stop, target);
    return r != null && r > 0 ? r : null;
  }

  /**
   * breakevenWinRate(rr) → fraction (0–1) of trades you must win to break even
   * when winners make rr × what losers lose: 1 / (1 + rr). At 1:1 you need
   * 50 %, at 2:1 only 33.3 %, at 3:1 just 25 % (before costs).
   */
  function breakevenWinRate(rr) {
    rr = num(rr);
    if (!(rr > 0)) return null;
    return 1 / (1 + rr);
  }

  /**
   * kellyFraction(winRate, rr) → W − (1 − W) / rr
   * The Kelly criterion's "optimal" fraction of equity to risk. It assumes you
   * know your true win rate and payoff exactly, which nobody does, so full
   * Kelly is far too aggressive in practice; traders who use it at all take a
   * quarter or a half. Zero or negative means the edge is not there: do not
   * size up a strategy that loses money. Educational only.
   */
  function kellyFraction(winRate, rr) {
    var w = winFraction(winRate);
    rr = num(rr);
    if (!isNum(w) || !(rr > 0)) return null;
    return round(w - (1 - w) / rr, 6);
  }

  /** expectancy(winRate, rr) → average result per trade in R: W × rr − (1 − W). */
  function expectancy(winRate, rr) {
    var w = winFraction(winRate);
    rr = num(rr);
    if (!isNum(w) || !(rr > 0)) return null;
    return round(w * rr - (1 - w), 6);
  }

  /**
   * planTrade({equity, riskPct, entry, stop, target, maxPositionPct})
   * positionSize() plus reward/risk, the win rate needed to break even, the
   * profit at target and plain-language warnings.
   */
  function planTrade(o) {
    o = o || {};
    var size = positionSize(o);
    var rr = rewardRisk(o);
    var target = num(o.target);
    var plan = {
      size: size,
      shares: size.shares,
      side: size.side,
      rewardRisk: rr,
      breakevenWinRate: rr ? breakevenWinRate(rr) : null,
      profitAtTarget: rr && size.shares ? cents(Math.abs(target - num(o.entry)) * size.shares) : null,
      lossAtStop: size.dollarRisk,
      warnings: []
    };
    var riskPct = num(o.riskPct);
    if (riskPct > 2) plan.warnings.push({ level: 'warn', code: 'risk', message: T('Risking more than 2% of equity on one trade means a normal losing streak can do serious damage. Many traders stay at 1% or less.') });
    if (isNum(target) && rr == null && size.side) plan.warnings.push({ level: 'warn', code: 'target', message: T('Your target is on the wrong side of the entry for a {side} trade.', { side: size.side === 'long' ? T('long') : T('short') }) });
    if (rr != null && rr < 1.5) plan.warnings.push({ level: 'tip', code: 'rr', message: T('Reward-to-risk below 1.5:1 needs a high win rate to pay off: at {rr}:1 you must win {pct}% of trades just to break even, before costs.', { rr: round(rr, 2), pct: round(breakevenWinRate(rr) * 100, 1) }) });
    if (size.cappedBy) plan.warnings.push({ level: 'tip', code: 'cap', message: size.cappedBy === 'equity' ? T('Size was limited by your account size: the stop is so close that the risk-based size would cost more than your whole equity.') : T('Size was limited by your maximum position size.') });
    return plan;
  }

  var glossary = {
    positionSize: 'Position size = money you are willing to lose ÷ distance from entry to stop. A wider stop means fewer shares for the same risk.',
    rMultiple: 'R is your initial risk on a trade. Measuring results in R (+2R, −1R) lets you compare trades of different sizes and see whether winners really outgrow losers.',
    breakeven: 'Break-even win rate = 1 ÷ (1 + reward/risk). With 2:1 trades you only need to win a third of the time to break even, before commissions and slippage.',
    kelly: 'The Kelly fraction is a formula for the bet size that maximises long-run growth if your edge is known exactly. Real edges are uncertain, so it is shown for education only; full Kelly produces huge drawdowns.'
  };

  root.BT.risk = {
    positionSize: positionSize,
    rMultiple: rMultiple,
    rewardRisk: rewardRisk,
    breakevenWinRate: breakevenWinRate,
    kellyFraction: kellyFraction,
    expectancy: expectancy,
    planTrade: planTrade,
    glossary: glossary
  };
})();
