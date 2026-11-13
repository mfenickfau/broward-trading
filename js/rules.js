/* Broward Trading — js/rules.js → BT.rules
 *
 * The no-code strategy builder's engine. A rule is plain JSON that a student
 * builds from blocks ("RSI(14) crosses above 30 AND close is above SMA(200)"),
 * and this module turns it into:
 *   - a BT.backtest strategy object      compile(rule)
 *   - a plain-English / Spanish sentence describe(rule, lang)
 *   - a list of problems                 validate(rule) / warnings(rule)
 *   - a point-in-time verdict            evaluate(rule, bars, {index})
 *     (used by BT.alerts kind 'rule' and by the dashboard's semi-auto mode)
 *
 * Rule JSON (contract v0.5):
 *   { name, side:'long'|'short',
 *     entry:{ op:'and'|'or', conditions:[{ left:OPERAND, cmp, right:OPERAND }] },
 *     exit: { op, conditions:[...], stopPct?, targetPct?, trailingPct?, maxBars? } }
 *   OPERAND = { ind:'rsi'|'sma'|'ema'|'close'|'macd'|'macdSignal'|'bbUpper'|
 *                    'bbLower'|'adx'|'stochK'|'volume'|'value', params:{n}, value? }
 *   cmp     = '>' | '<' | 'crossesAbove' | 'crossesBelow'
 *
 * TEACHING NOTE — no look-ahead. A decision at bar i may only use bars 0…i.
 *   * Indicator series are computed once per run over the bar array, but every
 *     indicator used here (SMA, EMA, RSI, MACD, Bollinger, ADX, Stochastic) is
 *     causal: its value at i depends only on bars up to i. tests/rules.test.js
 *     proves this by comparing every decision with one made on bars.slice(0,i+1)
 *     and by instrumenting the bar array with a Proxy.
 *   * "crosses above" compares bar i-1 with bar i: it was at or below, now it
 *     is above. Nothing ever reads bar i+1.
 *   * The backtest engine fills the resulting order at the NEXT bar's open.
 *   * Stops, targets and trailing stops are checked on CLOSING prices and also
 *     fill at the next open, so a gap can make a real loss bigger than the stop
 *     percentage. That is honest: it is exactly what a close-based stop does.
 *
 * Plain ES2020, no DOM, no imports. Soft dependency on BT.ind (js/indicators.js);
 * SMA/EMA/RSI have small fallbacks so the module loads standalone.
 */
(function () {
  'use strict';
  window.BT = window.BT || {};
  var BT = window.BT;

  var STORAGE_KEY = 'bt.rules';
  var MAX_SAVED = 50;
  var MAX_CONDITIONS = 8;

  /* ------------------------------------------------------------------ *
   * Catalogue
   * ------------------------------------------------------------------ */
  /* scale: 'price' operands share the price axis (drawn on the price chart);
   * 'osc' are oscillators with their own range; 'volume' and 'value' are their
   * own thing. Comparing a price with RSI is legal but almost always a mistake,
   * so warnings() flags mixed scales. */
  var OPERANDS = {
    close:      { label: 'Close price', scale: 'price', params: {} },
    sma:        { label: 'SMA', scale: 'price', params: { n: 20 } },
    ema:        { label: 'EMA', scale: 'price', params: { n: 20 } },
    bbUpper:    { label: 'Upper Bollinger Band', scale: 'price', params: { n: 20, k: 2 } },
    bbLower:    { label: 'Lower Bollinger Band', scale: 'price', params: { n: 20, k: 2 } },
    rsi:        { label: 'RSI', scale: 'osc', range: [0, 100], params: { n: 14 } },
    stochK:     { label: 'Stochastic %K', scale: 'osc', range: [0, 100], params: { n: 14 } },
    adx:        { label: 'ADX', scale: 'osc', range: [0, 100], params: { n: 14 } },
    macd:       { label: 'MACD line', scale: 'macd', params: { fast: 12, slow: 26, signal: 9 } },
    macdSignal: { label: 'MACD signal line', scale: 'macd', params: { fast: 12, slow: 26, signal: 9 } },
    volume:     { label: 'Volume', scale: 'volume', params: {} },
    value:      { label: 'A number', scale: 'value', params: {} }
  };
  var OPERAND_ORDER = ['close', 'sma', 'ema', 'bbUpper', 'bbLower', 'rsi', 'stochK', 'adx', 'macd', 'macdSignal', 'volume', 'value'];
  var CMPS = {
    '>': { label: 'is above' },
    '<': { label: 'is below' },
    crossesAbove: { label: 'crosses above' },
    crossesBelow: { label: 'crosses below' }
  };
  var CMP_ORDER = ['>', '<', 'crossesAbove', 'crossesBelow'];

  /* ------------------------------------------------------------------ *
   * i18n. describe() takes an explicit language; UI strings follow BT.t.
   * The Spanish templates below are the same keys BT.t would look up in
   * i18n/es.json, so describe(rule, 'es') works even before the dictionary
   * has them; once es.json carries them, the dictionary wins.
   * ------------------------------------------------------------------ */
  var ES = {
    'Go long when {cond}.': 'Compra (posición larga) cuando {cond}.',
    'Go short when {cond}.': 'Vende en corto cuando {cond}.',
    'Exit {parts}.': 'Sal {parts}.',
    'Never exits on its own: the backtest closes the trade on the last bar.': 'Nunca sale por sí sola: el backtest cierra la operación en la última barra.',
    'Waits for an entry condition.': 'Espera una condición de entrada.',
    'when {cond}': 'cuando {cond}',
    'with a {pct}% stop-loss': 'con un stop-loss del {pct}%',
    'at a {pct}% profit target': 'con un objetivo de ganancia del {pct}%',
    'with a {pct}% trailing stop': 'con un stop dinámico del {pct}%',
    'after {n} bars': 'después de {n} barras',
    'after 1 bar': 'después de 1 barra',
    '{a} and {b}': '{a} y {b}',
    '{a} or {b}': '{a} o {b}',
    '{left} is above {right}': '{left} está por encima de {right}',
    '{left} is below {right}': '{left} está por debajo de {right}',
    '{left} crosses above {right}': '{left} cruza por encima de {right}',
    '{left} crosses below {right}': '{left} cruza por debajo de {right}',
    'the close': 'el cierre',
    'volume': 'el volumen',
    'SMA({n})': 'la SMA({n})',
    'EMA({n})': 'la EMA({n})',
    'RSI({n})': 'el RSI({n})',
    'ADX({n})': 'el ADX({n})',
    'Stochastic %K({n})': 'el %K estocástico({n})',
    'the upper Bollinger Band({n}, {k})': 'la banda de Bollinger superior({n}, {k})',
    'the lower Bollinger Band({n}, {k})': 'la banda de Bollinger inferior({n}, {k})',
    'the MACD line({fast}, {slow}, {signal})': 'la línea MACD({fast}, {slow}, {signal})',
    'the MACD signal line({fast}, {slow}, {signal})': 'la línea de señal MACD({fast}, {slow}, {signal})',
    'the MACD line': 'la línea MACD',
    'the MACD signal line': 'la línea de señal MACD'
  };
  function interp(s, v) { return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : String(s); }
  function curLang() { try { return BT.i18n && BT.i18n.lang ? BT.i18n.lang() : 'en'; } catch (e) { return 'en'; } }
  /** UI strings: BT.t when loaded, plain interpolation otherwise. */
  function T(s, v) { var tf = BT.t; if (tf) return tf(s, v); return interp(s, v); }
  /** describe() strings in an explicit language. */
  function L(lang, s, v) {
    if (lang === 'es') {
      if (BT.t && curLang() === 'es') { var tr = BT.t(s); if (tr !== s) return interp(tr, v); }
      return interp(ES[s] != null ? ES[s] : s, v);
    }
    if (lang && lang !== 'en' && BT.t && curLang() === lang) return BT.t(s, v);
    return interp(s, v);
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function int(v, d, lo, hi) { var n = Math.round(+v); if (!isFinite(n)) n = d; return Math.max(lo, Math.min(hi, n)); }
  function posNum(v) { var n = typeof v === 'string' ? parseFloat(v) : v; return isNum(n) && n > 0 ? n : null; }
  function fmtNum(x) {
    if (!isNum(x)) return '—';
    var a = Math.abs(x), d = a >= 1000 ? 0 : a >= 1 ? 2 : 4;
    var s = x.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Normalisation
   * ------------------------------------------------------------------ */
  function normOperand(o) {
    o = o && typeof o === 'object' ? o : {};
    var ind = OPERANDS[o.ind] ? o.ind : 'value';
    var def = OPERANDS[ind], p = o.params && typeof o.params === 'object' ? o.params : {}, out = { ind: ind, params: {} };
    if ('n' in def.params) out.params.n = int(p.n, def.params.n, 1, 500);
    if ('k' in def.params) { var k = parseFloat(p.k); out.params.k = isNum(k) && k > 0 && k <= 5 ? k : def.params.k; }
    if (ind === 'macd' || ind === 'macdSignal') {
      out.params.fast = int(p.fast, 12, 1, 200); out.params.slow = int(p.slow, 26, 2, 400); out.params.signal = int(p.signal, 9, 1, 200);
      if (out.params.fast >= out.params.slow) { out.params.fast = 12; out.params.slow = 26; }
    }
    if (ind === 'value') {
      var v = typeof o.value === 'string' ? parseFloat(o.value) : o.value;
      out.value = isNum(v) ? v : 0;
    }
    return out;
  }
  function normCond(c) {
    c = c && typeof c === 'object' ? c : {};
    return { left: normOperand(c.left), cmp: CMPS[c.cmp] ? c.cmp : '>', right: normOperand(c.right) };
  }
  function normBlock(b, isExit) {
    b = b && typeof b === 'object' ? b : {};
    var out = { op: b.op === 'or' ? 'or' : 'and', conditions: (Array.isArray(b.conditions) ? b.conditions : []).slice(0, MAX_CONDITIONS).map(normCond) };
    if (isExit) ['stopPct', 'targetPct', 'trailingPct'].forEach(function (k) { var v = posNum(b[k]); if (v != null) out[k] = Math.min(v, 100); });
    if (isExit) { var mb = posNum(b.maxBars); if (mb != null) out.maxBars = Math.max(1, Math.round(mb)); }
    return out;
  }
  /** Fill defaults, clamp lengths, drop unknown fields. Never throws. */
  function normalize(rule) {
    rule = rule && typeof rule === 'object' ? rule : {};
    var out = {
      name: String(rule.name == null ? '' : rule.name).trim().slice(0, 60) || 'My rule',
      side: rule.side === 'short' ? 'short' : 'long',
      entry: normBlock(rule.entry, false),
      exit: normBlock(rule.exit, true)
    };
    if (rule.id != null) out.id = String(rule.id).slice(0, 40);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Validation
   * ------------------------------------------------------------------ */
  function validOperandShape(o) { return o && typeof o === 'object' && OPERANDS[o.ind]; }
  /** validate(rule) → array of readable error strings (empty when the rule can run). */
  function validate(rule) {
    var errs = [];
    if (!rule || typeof rule !== 'object') return [T('A rule must be an object with entry and exit blocks.')];
    if (rule.side != null && rule.side !== 'long' && rule.side !== 'short') errs.push(T('Side must be long or short.'));
    ['entry', 'exit'].forEach(function (which) {
      var b = rule[which];
      var label = which === 'entry' ? T('Entry') : T('Exit');
      if (b == null) { if (which === 'entry') errs.push(T('Add at least one entry condition.')); return; }
      if (typeof b !== 'object') { errs.push(T('{block}: must be an object.', { block: label })); return; }
      if (b.op != null && b.op !== 'and' && b.op !== 'or') errs.push(T('{block}: combine conditions with AND or OR.', { block: label }));
      var conds = b.conditions == null ? [] : b.conditions;
      if (!Array.isArray(conds)) { errs.push(T('{block}: conditions must be a list.', { block: label })); return; }
      if (which === 'entry' && !conds.length) errs.push(T('Add at least one entry condition.'));
      if (conds.length > MAX_CONDITIONS) errs.push(T('{block}: keep it to {max} conditions or fewer. Simple rules are easier to trust.', { block: label, max: MAX_CONDITIONS }));
      conds.forEach(function (c, i) {
        var where = T('{block} condition {n}', { block: label, n: i + 1 });
        if (!c || typeof c !== 'object') { errs.push(T('{where}: is empty.', { where: where })); return; }
        if (!validOperandShape(c.left)) errs.push(T('{where}: pick what to measure on the left.', { where: where }));
        if (!validOperandShape(c.right)) errs.push(T('{where}: pick what to compare with on the right.', { where: where }));
        if (!CMPS[c.cmp]) errs.push(T('{where}: choose is above, is below, crosses above or crosses below.', { where: where }));
        [c.left, c.right].forEach(function (o) {
          if (!validOperandShape(o)) return;
          if (o.ind === 'value') {
            var v = typeof o.value === 'string' ? parseFloat(o.value) : o.value;
            if (!isNum(v)) errs.push(T('{where}: type a number.', { where: where }));
          }
          var p = o.params || {};
          if ('n' in OPERANDS[o.ind].params && p.n != null && !(Math.round(+p.n) >= 1 && Math.round(+p.n) <= 500)) errs.push(T('{where}: the length must be between 1 and 500 bars.', { where: where }));
          if ((o.ind === 'macd' || o.ind === 'macdSignal') && p.fast != null && p.slow != null && +p.fast >= +p.slow) errs.push(T('{where}: the MACD fast length must be shorter than the slow one.', { where: where }));
        });
        if (validOperandShape(c.left) && validOperandShape(c.right) && c.left.ind === 'value' && c.right.ind === 'value') errs.push(T('{where}: compare an indicator with something; two plain numbers never change.', { where: where }));
      });
      if (which === 'exit') {
        [['stopPct', T('Stop-loss')], ['targetPct', T('Profit target')], ['trailingPct', T('Trailing stop')]].forEach(function (kv) {
          var v = b[kv[0]];
          if (v == null || v === '') return;
          var n = typeof v === 'string' ? parseFloat(v) : v;
          if (!isNum(n) || n <= 0 || n > 100) errs.push(T('{what} must be a percentage between 0 and 100.', { what: kv[1] }));
        });
        if (b.maxBars != null && b.maxBars !== '') { var mb = +b.maxBars; if (!isNum(mb) || mb < 1 || mb > 5000) errs.push(T('Maximum bars in a trade must be between 1 and 5000.')); }
      }
    });
    return errs;
  }

  /** warnings(rule) → advice that does not stop the rule from running. */
  function warnings(rule) {
    var r = normalize(rule), w = [];
    var ex = r.exit, hasRisk = ex.stopPct != null || ex.targetPct != null || ex.trailingPct != null || ex.maxBars != null;
    if (!ex.conditions.length && !hasRisk) w.push(T('There is no exit: the trade is only closed on the last bar. Add an exit condition or a stop-loss.'));
    if (ex.stopPct == null && ex.trailingPct == null) w.push(T('No stop-loss. Real traders decide where they are wrong before they enter.'));
    [['entry', r.entry], ['exit', r.exit]].forEach(function (pair) {
      pair[1].conditions.forEach(function (c, i) {
        var a = OPERANDS[c.left.ind].scale, b = OPERANDS[c.right.ind].scale;
        var where = T('{block} condition {n}', { block: pair[0] === 'entry' ? T('Entry') : T('Exit'), n: i + 1 });
        if (a !== 'value' && b !== 'value' && a !== b) w.push(T('{where} compares values on different scales (for example a price with RSI). That is rarely what you mean.', { where: where }));
        [c.left, c.right].forEach(function (o, side) {
          var other = side === 0 ? c.right : c.left;
          if (o.ind === 'value' && OPERANDS[other.ind].range) {
            var rg = OPERANDS[other.ind].range;
            if (o.value < rg[0] || o.value > rg[1]) w.push(T('{where}: {ind} only moves between {lo} and {hi}, so {v} can never be reached.', { where: where, ind: T(OPERANDS[other.ind].label), lo: rg[0], hi: rg[1], v: fmtNum(o.value) }));
          }
        });
        if (JSON.stringify(c.left) === JSON.stringify(c.right)) w.push(T('{where} compares something with itself, so it never fires.', { where: where }));
      });
    });
    if (r.entry.op === 'and' && r.entry.conditions.filter(function (c) { return c.cmp === 'crossesAbove' || c.cmp === 'crossesBelow'; }).length > 1) w.push(T('Two "crosses" conditions joined with AND must happen on the same bar, which is rare. Consider making one of them "is above" or "is below".'));
    return w;
  }

  /* ------------------------------------------------------------------ *
   * Series (computed once per bar array; causal indicators only)
   * ------------------------------------------------------------------ */
  function fbSma(v, n) {
    var out = new Array(v.length).fill(null), s = 0;
    for (var i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }
  function fbEma(v, n) {
    var out = new Array(v.length).fill(null), k = 2 / (n + 1), prev = null;
    for (var i = 0; i < v.length; i++) {
      if (i === n - 1) { var s = 0; for (var j = 0; j < n; j++) s += v[j]; prev = s / n; out[i] = prev; }
      else if (i >= n) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
    }
    return out;
  }
  function fbRsi(v, n) {
    var out = new Array(v.length).fill(null), g = 0, l = 0;
    for (var i = 1; i < v.length; i++) {
      var d = v[i] - v[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return out;
  }
  function nulls(n) { return new Array(n).fill(null); }

  function operandKey(o) {
    var p = o.params || {};
    switch (o.ind) {
      case 'sma': case 'ema': case 'rsi': case 'adx': case 'stochK': return o.ind + ':' + p.n;
      case 'bbUpper': case 'bbLower': return o.ind + ':' + p.n + ':' + p.k;
      case 'macd': case 'macdSignal': return o.ind + ':' + p.fast + ':' + p.slow + ':' + p.signal;
    }
    return o.ind;
  }

  /** Full series for an operand, length bars.length, null where undefined. */
  function computeSeries(bars, o, cache) {
    var key = operandKey(o);
    if (cache && cache[key]) return cache[key];
    var I = BT.ind, p = o.params || {}, n = bars.length, out;
    var closes = cache && cache._closes || bars.map(function (b) { return b.close; });
    if (cache) cache._closes = closes;
    switch (o.ind) {
      case 'close': out = closes; break;
      case 'volume': out = bars.map(function (b) { return isNum(b.volume) ? b.volume : null; }); break;
      case 'sma': out = I && I.sma ? I.sma(closes, p.n) : fbSma(closes, p.n); break;
      case 'ema': out = I && I.ema ? I.ema(closes, p.n) : fbEma(closes, p.n); break;
      case 'rsi': out = I && I.rsi ? I.rsi(closes, p.n) : fbRsi(closes, p.n); break;
      case 'bbUpper': case 'bbLower': {
        var bb = I && I.bollinger ? I.bollinger(closes, p.n, p.k) : null;
        out = bb ? (o.ind === 'bbUpper' ? bb.upper : bb.lower) : nulls(n);
        break;
      }
      case 'macd': case 'macdSignal': {
        var m = I && I.macd ? I.macd(closes, p.fast, p.slow, p.signal) : null;
        out = m ? (o.ind === 'macd' ? m.macd : m.signal) : nulls(n);
        break;
      }
      case 'adx': { var a = I && I.adx ? I.adx(bars, p.n) : null; out = a ? a.adx : nulls(n); break; }
      case 'stochK': { var s = I && I.stochastic ? I.stochastic(bars, p.n, 3) : null; out = s ? s.k : nulls(n); break; }
      default: out = nulls(n);
    }
    if (cache) cache[key] = out;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Condition evaluation at bar i (reads only i-1 and i)
   * ------------------------------------------------------------------ */
  /** Value of an operand at index j. close/volume read the bar directly so the
   *  instrumented-bars test can see exactly which bars a decision touches. */
  function valueAt(o, bars, series, j) {
    if (j < 0) return null;
    if (o.ind === 'value') return o.value;
    if (o.ind === 'close') { var b = bars[j]; return b && isNum(b.close) ? b.close : null; }
    if (o.ind === 'volume') { var bv = bars[j]; return bv && isNum(bv.volume) ? bv.volume : null; }
    var s = series[operandKey(o)];
    var v = s ? s[j] : null;
    return isNum(v) ? v : null;
  }
  /** → {pass:boolean|null, a, b, a0, b0}; pass null = not enough data yet. */
  function evalCond(c, bars, series, i) {
    var a = valueAt(c.left, bars, series, i), b = valueAt(c.right, bars, series, i);
    if (a == null || b == null) return { pass: null, a: a, b: b };
    if (c.cmp === '>') return { pass: a > b, a: a, b: b };
    if (c.cmp === '<') return { pass: a < b, a: a, b: b };
    // crosses: compare the previous bar (i-1) with this bar (i)
    var a0 = valueAt(c.left, bars, series, i - 1), b0 = valueAt(c.right, bars, series, i - 1);
    if (a0 == null || b0 == null) return { pass: null, a: a, b: b };
    var pass = c.cmp === 'crossesAbove' ? (a0 <= b0 && a > b) : (a0 >= b0 && a < b);
    return { pass: pass, a: a, b: b, a0: a0, b0: b0 };
  }
  function evalBlock(block, bars, series, i) {
    var conds = block.conditions;
    if (!conds.length) return { pass: false, results: [] };
    var results = conds.map(function (c) { return evalCond(c, bars, series, i); });
    var pass = block.op === 'or' ? results.some(function (r) { return r.pass === true; }) : results.every(function (r) { return r.pass === true; });
    return { pass: pass, results: results };
  }

  /** Risk exits for an open position at bar i. Reads bars entryIndex…i only. */
  function riskExit(ex, side, pos, bars, i) {
    if (!pos) return null;
    var entry = pos.entry, close = bars[i] && bars[i].close;
    if (!isNum(entry) || !isNum(close) || entry <= 0) return null;
    var pnlPct = side === 'short' ? (entry - close) / entry * 100 : (close - entry) / entry * 100;
    if (ex.stopPct != null && pnlPct <= -ex.stopPct) return { reason: 'stop', pnlPct: pnlPct };
    if (ex.targetPct != null && pnlPct >= ex.targetPct) return { reason: 'target', pnlPct: pnlPct };
    if (ex.trailingPct != null && isNum(pos.entryIndex)) {
      var best = entry;
      for (var j = Math.max(0, pos.entryIndex); j <= i; j++) {
        var c = bars[j] && bars[j].close;
        if (!isNum(c)) continue;
        if (side === 'short' ? c < best : c > best) best = c;
      }
      var give = side === 'short' ? (close - best) / best * 100 : (best - close) / best * 100;
      if (give >= ex.trailingPct) return { reason: 'trailing', pnlPct: pnlPct };
    }
    var held = isNum(pos.barsHeld) ? pos.barsHeld : (isNum(pos.entryIndex) ? i - pos.entryIndex : null);
    if (ex.maxBars != null && held != null && held >= ex.maxBars) return { reason: 'time', pnlPct: pnlPct };
    return null;
  }

  function operandsOf(r) {
    var list = [];
    [r.entry, r.exit].forEach(function (b) { b.conditions.forEach(function (c) { list.push(c.left, c.right); }); });
    return list;
  }
  /** Precompute every series a rule needs for one bar array. */
  function prepareSeries(r, bars) {
    var cache = {};
    operandsOf(r).forEach(function (o) { if (o.ind !== 'value' && o.ind !== 'close' && o.ind !== 'volume') computeSeries(bars, o, cache); });
    return cache;
  }

  /* ------------------------------------------------------------------ *
   * compile(rule) → BT.backtest strategy
   * ------------------------------------------------------------------ */
  /**
   * opts.strict = true recomputes indicators on bars.slice(0, i+1) at every bar
   * (O(n²), for tests and paranoid checks): the decision then provably cannot
   * depend on any bar after i. The default precomputes series once per bar
   * array, which gives identical decisions because the indicators are causal.
   */
  function compile(rule, opts) {
    opts = opts || {};
    var r = normalize(rule);
    var errs = validate(rule);
    var memoBars = null, memoSeries = null, lastWhy = null;
    function seriesFor(bars, i) {
      if (opts.strict) { var pre = bars.slice(0, i + 1); return { bars: pre, series: prepareSeries(r, pre) }; }
      if (memoBars !== bars) { memoBars = bars; memoSeries = prepareSeries(r, bars); }
      return { bars: bars, series: memoSeries };
    }
    var strat = {
      id: 'rule',
      name: r.name,
      description: describe(r, 'en'),
      params: { rule: r },
      rule: r,
      errors: errs,
      side: r.side,
      /** BT.backtest.run options this strategy needs (shorts must be allowed for a short rule). */
      runOptions: { allowShort: r.side === 'short' },
      prepare: function (bars) { memoBars = bars; memoSeries = prepareSeries(r, bars); return memoSeries; },
      /** Why the last non-null signal fired: {kind:'entry'|'exit', reason, index}. */
      lastReason: function () { return lastWhy; },
      onBar: function (ctx, i) {
        if (errs.length || !ctx || !ctx.bars || i < 0) return null;
        var pos = ctx.position;
        var mySide = r.side;
        var s = seriesFor(ctx.bars, i), bars = s.bars;
        if (pos && pos.side === mySide) {
          var rx = riskExit(r.exit, mySide, pos, bars, i);
          if (rx) { lastWhy = { kind: 'exit', reason: rx.reason, index: i }; return 'exit'; }
          var ev = evalBlock(r.exit, bars, s.series, i);
          if (ev.pass) { lastWhy = { kind: 'exit', reason: 'rule', index: i }; return 'exit'; }
          return null;
        }
        if (pos) return null;   // a position from something else: leave it alone
        var en = evalBlock(r.entry, bars, s.series, i);
        if (en.pass) { lastWhy = { kind: 'entry', reason: 'rule', index: i }; return mySide === 'short' ? 'sell' : 'buy'; }
        return null;
      }
    };
    return strat;
  }

  /** Convenience: compile + BT.backtest.run with the right allowShort. */
  function backtest(rule, bars, options) {
    if (!BT.backtest || !BT.backtest.run) throw new Error('BT.backtest is not loaded');
    var s = compile(rule);
    return BT.backtest.run(s, bars, Object.assign({}, options || {}, s.runOptions));
  }

  /* ------------------------------------------------------------------ *
   * evaluate(rule, bars, {index, position}) — one bar, for alerts and the
   * dashboard's semi-auto proposals. Uses only bars 0…index.
   * ------------------------------------------------------------------ */
  function evaluate(rule, bars, opts) {
    opts = opts || {};
    if (!Array.isArray(bars) || bars.length < 2) return null;
    if (validate(rule).length) return null;
    var r = normalize(rule);
    var i = opts.index == null ? bars.length - 1 : Math.min(bars.length - 1, Math.max(0, opts.index | 0));
    var pre = i === bars.length - 1 ? bars : bars.slice(0, i + 1);
    var series = prepareSeries(r, pre);
    var en = evalBlock(r.entry, pre, series, i), ex = evalBlock(r.exit, pre, series, i);
    var known = en.results.some(function (x) { return x.pass !== null; });
    var risk = opts.position ? riskExit(r.exit, r.side, opts.position, pre, i) : null;
    return {
      index: i, time: pre[i].time, close: pre[i].close,
      entry: en.pass, exit: ex.pass || !!risk, risk: risk,
      ready: known,
      entryResults: en.results, exitResults: ex.results
    };
  }

  /**
   * propose(rule, bars, position) → null or {action, side, price, time, reason}
   * for the dashboard's semi-auto paper mode. It only PROPOSES: the caller must
   * show it and wait for the student's tap. Nothing here places an order.
   * `position` is the student's current position in that symbol (or null),
   * as {side:'long'|'short', entry, entryIndex?, barsHeld?}.
   */
  function propose(rule, bars, position, lang) {
    var ev = evaluate(rule, bars, { position: position || null });
    if (!ev) return null;
    var r = normalize(rule);
    lang = lang || curLang();
    if (position && position.side === r.side) {
      if (!ev.exit) return null;
      var why = ev.risk ? { stop: T('stop-loss hit'), target: T('profit target reached'), trailing: T('trailing stop hit'), time: T('time limit reached') }[ev.risk.reason] : T('exit rule fired');
      return { action: r.side === 'short' ? 'buy' : 'sell', intent: 'exit', side: r.side, price: ev.close, time: ev.time, reason: why, rule: r.name };
    }
    if (position) return null;
    if (!ev.entry) return null;
    return { action: r.side === 'short' ? 'sell' : 'buy', intent: 'entry', side: r.side, price: ev.close, time: ev.time, reason: describe(r, lang), rule: r.name };
  }

  /* ------------------------------------------------------------------ *
   * describe(rule, lang) — natural English / Spanish
   * ------------------------------------------------------------------ */
  function operandText(o, lang) {
    var p = o.params || {};
    switch (o.ind) {
      case 'value': return fmtNum(o.value);
      case 'close': return L(lang, 'the close');
      case 'volume': return L(lang, 'volume');
      case 'sma': return L(lang, 'SMA({n})', { n: p.n });
      case 'ema': return L(lang, 'EMA({n})', { n: p.n });
      case 'rsi': return L(lang, 'RSI({n})', { n: p.n });
      case 'adx': return L(lang, 'ADX({n})', { n: p.n });
      case 'stochK': return L(lang, 'Stochastic %K({n})', { n: p.n });
      case 'bbUpper': return L(lang, 'the upper Bollinger Band({n}, {k})', { n: p.n, k: p.k });
      case 'bbLower': return L(lang, 'the lower Bollinger Band({n}, {k})', { n: p.n, k: p.k });
      case 'macd': case 'macdSignal': {
        var std = p.fast === 12 && p.slow === 26 && p.signal === 9;
        var base = o.ind === 'macd' ? 'the MACD line' : 'the MACD signal line';
        return std ? L(lang, base) : L(lang, base + '({fast}, {slow}, {signal})', p);
      }
    }
    return o.ind;
  }
  var CMP_TEMPLATE = { '>': '{left} is above {right}', '<': '{left} is below {right}', crossesAbove: '{left} crosses above {right}', crossesBelow: '{left} crosses below {right}' };
  function condText(c, lang) {
    var s = L(lang, CMP_TEMPLATE[c.cmp], { left: operandText(c.left, lang), right: operandText(c.right, lang) });
    if (lang === 'es') s = s.replace(/\bde el\b/g, 'del').replace(/\ba el\b/g, 'al');
    return s;
  }
  /** "a", "a and b", "a, b and c" (or "or"), via the '{a} and {b}' template. */
  function joinList(items, op, lang) {
    if (!items.length) return '';
    if (items.length === 1) return items[0];
    var tpl = op === 'or' ? '{a} or {b}' : '{a} and {b}';
    return L(lang, tpl, { a: items.slice(0, -1).join(', '), b: items[items.length - 1] });
  }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /**
   * describe(rule, lang='en'|'es') → e.g.
   *   "Go long when RSI(14) crosses above 30 and the close is above SMA(200).
   *    Exit when RSI(14) crosses above 70, with a 5% stop-loss or after 20 bars."
   */
  function describe(rule, lang) {
    lang = lang || curLang() || 'en';
    var r = normalize(rule);
    var out = [];
    if (r.entry.conditions.length) {
      var ec = joinList(r.entry.conditions.map(function (c) { return condText(c, lang); }), r.entry.op, lang);
      out.push(L(lang, r.side === 'short' ? 'Go short when {cond}.' : 'Go long when {cond}.', { cond: ec }));
    } else out.push(L(lang, 'Waits for an entry condition.'));
    var parts = [];
    if (r.exit.conditions.length) parts.push(L(lang, 'when {cond}', { cond: joinList(r.exit.conditions.map(function (c) { return condText(c, lang); }), r.exit.op, lang) }));
    if (r.exit.stopPct != null) parts.push(L(lang, 'with a {pct}% stop-loss', { pct: fmtNum(r.exit.stopPct) }));
    if (r.exit.targetPct != null) parts.push(L(lang, 'at a {pct}% profit target', { pct: fmtNum(r.exit.targetPct) }));
    if (r.exit.trailingPct != null) parts.push(L(lang, 'with a {pct}% trailing stop', { pct: fmtNum(r.exit.trailingPct) }));
    if (r.exit.maxBars != null) parts.push(r.exit.maxBars === 1 ? L(lang, 'after 1 bar') : L(lang, 'after {n} bars', { n: r.exit.maxBars }));
    if (parts.length) out.push(L(lang, 'Exit {parts}.', { parts: joinList(parts, 'or', lang) }));
    else out.push(L(lang, 'Never exits on its own: the backtest closes the trade on the last bar.'));
    return out.map(capFirst).join(' ');
  }
  /** Just one condition, for UI rows and alert messages. */
  function describeCondition(c, lang) { return capFirst(condText(normCond(c), lang || curLang() || 'en')); }

  /* ------------------------------------------------------------------ *
   * Templates
   * ------------------------------------------------------------------ */
  function op(ind, params, value) { var o = { ind: ind, params: params || {} }; if (value != null) o.value = value; return o; }
  var TEMPLATES = [
    { id: 'smaCross', name: 'SMA crossover', blurb: 'Trend following: buy when the 20-bar average crosses above the 50-bar average, sell when it crosses back below.',
      rule: { name: 'SMA crossover 20/50', side: 'long',
        entry: { op: 'and', conditions: [{ left: op('sma', { n: 20 }), cmp: 'crossesAbove', right: op('sma', { n: 50 }) }] },
        exit: { op: 'or', conditions: [{ left: op('sma', { n: 20 }), cmp: 'crossesBelow', right: op('sma', { n: 50 }) }], stopPct: 8 } } },
    { id: 'rsiReversion', name: 'RSI reversion', blurb: 'Mean reversion inside an uptrend: buy when RSI climbs back above 30 while price is above its 200-bar average; exit when RSI reaches 70.',
      rule: { name: 'RSI reversion', side: 'long',
        entry: { op: 'and', conditions: [{ left: op('rsi', { n: 14 }), cmp: 'crossesAbove', right: op('value', {}, 30) }, { left: op('close'), cmp: '>', right: op('sma', { n: 200 }) }] },
        exit: { op: 'or', conditions: [{ left: op('rsi', { n: 14 }), cmp: 'crossesAbove', right: op('value', {}, 70) }], stopPct: 6, maxBars: 30 } } },
    { id: 'macdMomentum', name: 'MACD momentum', blurb: 'Momentum: buy when the MACD line crosses above its signal line while above zero; exit on the opposite cross or a trailing stop.',
      rule: { name: 'MACD momentum', side: 'long',
        entry: { op: 'and', conditions: [{ left: op('macd', { fast: 12, slow: 26, signal: 9 }), cmp: 'crossesAbove', right: op('macdSignal', { fast: 12, slow: 26, signal: 9 }) }, { left: op('macd', { fast: 12, slow: 26, signal: 9 }), cmp: '>', right: op('value', {}, 0) }] },
        exit: { op: 'or', conditions: [{ left: op('macd', { fast: 12, slow: 26, signal: 9 }), cmp: 'crossesBelow', right: op('macdSignal', { fast: 12, slow: 26, signal: 9 }) }], trailingPct: 7 } } },
    { id: 'bollingerBreakout', name: 'Bollinger breakout', blurb: 'Volatility breakout: buy when the close pushes through the upper band while ADX shows a trend; exit when the close falls back below the 20-bar average.',
      rule: { name: 'Bollinger breakout', side: 'long',
        entry: { op: 'and', conditions: [{ left: op('close'), cmp: 'crossesAbove', right: op('bbUpper', { n: 20, k: 2 }) }, { left: op('adx', { n: 14 }), cmp: '>', right: op('value', {}, 20) }] },
        exit: { op: 'or', conditions: [{ left: op('close'), cmp: 'crossesBelow', right: op('sma', { n: 20 }) }], stopPct: 5, targetPct: 15 } } }
  ];
  function template(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return normalize(clone(TEMPLATES[i].rule));
    return null;
  }
  function blank() {
    return normalize({ name: 'My rule', side: 'long',
      entry: { op: 'and', conditions: [{ left: op('rsi', { n: 14 }), cmp: '<', right: op('value', {}, 30) }] },
      exit: { op: 'or', conditions: [{ left: op('rsi', { n: 14 }), cmp: '>', right: op('value', {}, 70) }], stopPct: 5 } });
  }

  /* ------------------------------------------------------------------ *
   * Persistence: bt.rules = {rules:[...], draft, semiAuto:{enabled, ruleId, symbol}}
   * ------------------------------------------------------------------ */
  function readStore() {
    try {
      var raw = window.localStorage && localStorage.getItem(STORAGE_KEY);
      var v = raw ? JSON.parse(raw) : null;
      if (Array.isArray(v)) v = { rules: v };   // tolerate a bare array
      if (!v || typeof v !== 'object') v = {};
      if (!Array.isArray(v.rules)) v.rules = [];
      return v;
    } catch (e) { return { rules: [] }; }
  }
  function writeStore(v) { try { if (window.localStorage) localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  var clock = function () { return Date.now(); };

  function list() { return readStore().rules.map(function (x) { return clone(x); }); }
  function get(id) { var r = readStore().rules.filter(function (x) { return x.id === String(id); })[0]; return r ? clone(r) : null; }
  /** save(rule) → {ok, rule, errors}. Same id updates; same name without id updates too. */
  function save(rule) {
    var errs = validate(rule);
    if (errs.length) return { ok: false, errors: errs };
    var st = readStore(), r = normalize(rule), now = clock();
    var idx = -1;
    if (r.id) idx = st.rules.findIndex(function (x) { return x.id === r.id; });
    if (idx < 0) idx = st.rules.findIndex(function (x) { return x.name.toLowerCase() === r.name.toLowerCase(); });
    if (idx >= 0) { r.id = st.rules[idx].id; r.createdAt = st.rules[idx].createdAt || now; r.updatedAt = now; st.rules[idx] = r; }
    else {
      if (st.rules.length >= MAX_SAVED) return { ok: false, errors: [T('You can keep up to {max} saved rules. Delete one first.', { max: MAX_SAVED })] };
      r.id = 'r' + now.toString(36) + Math.floor(Math.random() * 1296).toString(36);
      r.createdAt = now; r.updatedAt = now; st.rules.push(r);
    }
    writeStore(st);
    return { ok: true, rule: clone(r), errors: [] };
  }
  function remove(id) {
    var st = readStore(), n = st.rules.length;
    st.rules = st.rules.filter(function (x) { return x.id !== String(id); });
    if (st.semiAuto && st.semiAuto.ruleId === String(id)) st.semiAuto.enabled = false;
    writeStore(st);
    return st.rules.length < n;
  }
  function getDraft() { var d = readStore().draft; return d ? normalize(d) : null; }
  function setDraft(rule) { var st = readStore(); st.draft = rule ? normalize(rule) : null; writeStore(st); }
  var semiAuto = {
    /** {enabled:boolean, ruleId:string|null, symbol:string|null} for the dashboard toggle. */
    get: function () { var s = readStore().semiAuto || {}; return { enabled: !!s.enabled, ruleId: s.ruleId || null, symbol: s.symbol || null }; },
    set: function (v) { var st = readStore(), cur = st.semiAuto || {}; v = v || {}; st.semiAuto = { enabled: v.enabled != null ? !!v.enabled : !!cur.enabled, ruleId: v.ruleId !== undefined ? (v.ruleId ? String(v.ruleId) : null) : (cur.ruleId || null), symbol: v.symbol !== undefined ? (v.symbol ? String(v.symbol).toUpperCase() : null) : (cur.symbol || null) }; writeStore(st); return semiAuto.get(); },
    /** The saved rule the dashboard should watch, or null. */
    rule: function () { var s = semiAuto.get(); return s.enabled && s.ruleId ? get(s.ruleId) : null; }
  };

  /* ------------------------------------------------------------------ *
   * Export / import
   * ------------------------------------------------------------------ */
  function exportJSON(rule) {
    var r = normalize(rule); delete r.id;
    return JSON.stringify(Object.assign({ format: 'broward-rule', version: 1 }, r), null, 2);
  }
  /** importJSON(text) → {ok, rule, errors}. Accepts the export format or a bare rule. */
  function importJSON(text) {
    var obj;
    try { obj = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (e) { return { ok: false, errors: [T('That is not valid JSON. Paste the whole text, from the first { to the last }.')] }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: [T('Expected a rule object with entry and exit blocks.')] };
    var errs = validate(obj);
    if (errs.length) return { ok: false, errors: errs };
    var r = normalize(obj); delete r.id;
    return { ok: true, rule: r, errors: [] };
  }

  /** Indicator lines worth drawing on the price chart for this rule. */
  function overlays(rule) {
    var r = normalize(rule), seen = {}, out = [];
    operandsOf(r).forEach(function (o) {
      var k = operandKey(o);
      if (seen[k] || OPERANDS[o.ind].scale !== 'price' || o.ind === 'close') return;
      seen[k] = true; out.push({ key: k, operand: o, label: operandText(o, 'en').replace(/^the /, '') });
    });
    return out;
  }

  BT.rules = {
    version: '0.5.0',
    STORAGE_KEY: STORAGE_KEY,
    MAX_CONDITIONS: MAX_CONDITIONS,
    OPERANDS: OPERANDS,
    operands: OPERAND_ORDER.slice(),
    CMPS: CMPS,
    cmps: CMP_ORDER.slice(),
    ES: ES,
    templates: TEMPLATES.map(function (t) { return { id: t.id, name: t.name, blurb: t.blurb }; }),
    template: template,
    blank: blank,
    normalize: normalize,
    validate: validate,
    warnings: warnings,
    compile: compile,
    backtest: backtest,
    evaluate: evaluate,
    propose: propose,
    describe: describe,
    describeCondition: describeCondition,
    operandText: function (o, lang) { return operandText(normOperand(o), lang || curLang() || 'en'); },
    series: function (bars, o) { return computeSeries(bars, normOperand(o), {}); },
    overlays: overlays,
    list: list,
    get: get,
    save: save,
    remove: remove,
    getDraft: getDraft,
    setDraft: setDraft,
    semiAuto: semiAuto,
    exportJSON: exportJSON,
    importJSON: importJSON,
    setClock: function (fn) { clock = typeof fn === 'function' ? fn : function () { return Date.now(); }; },
    _evalCond: function (c, bars, series, i) { return evalCond(normCond(c), bars, series, i); },
    _operandKey: function (o) { return operandKey(normOperand(o)); }
  };
})();
