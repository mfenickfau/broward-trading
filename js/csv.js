/* Broward Trading — CSV price-data import (BT.csv)
 *
 * Turns a CSV file a student brings (Yahoo Finance download, broker export,
 * TradingView "Export chart data", a spreadsheet saved as CSV …) into the bar
 * shape every module uses: {time, open, high, low, close, volume}, oldest → newest,
 * time = 'YYYY-MM-DD' for daily-or-slower bars, unix seconds for intraday bars.
 *
 * Also keeps a small library of uploaded datasets in localStorage so a student
 * can come back and re-run tests on the same file.
 *
 * Pure parsing functions work in node (tests/csv.test.js); storage functions
 * need localStorage and fail soft without it.
 */
(function (root) {
  'use strict';
  var BT = root.BT = root.BT || {};

  var MAX_ROWS = 50000;
  var INDEX_KEY = 'bt.csv.datasets';
  var DATA_PREFIX = 'bt.csv.data.';

  /* ---------------------------------------------------------------- *
   * Low-level CSV tokenising (RFC 4180 quotes, any delimiter)
   * ---------------------------------------------------------------- */
  function detectDelimiter(text) {
    var lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ''; }).slice(0, 10);
    var cands = [',', ';', '\t', '|'];
    var best = ',', bestScore = -1;
    cands.forEach(function (d) {
      var counts = lines.map(function (l) { return splitLine(l, d).length; });
      if (!counts.length) return;
      var first = counts[0];
      if (first < 2) return;
      var consistent = counts.filter(function (c) { return c === first; }).length;
      var score = consistent * 100 + first;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  function tokenize(text, d) {
    // Handles quoted fields that contain newlines.
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cur.trim()); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur.trim()); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur.trim());
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  /* ---------------------------------------------------------------- *
   * Column mapping
   * ---------------------------------------------------------------- */
  var ALIASES = {
    datetime: ['datetime', 'timestamp', 'time', 'date', 'day', 'tradedate', 'tradingday', 'datetimeutc', 'timeutc', 'dateutc', 'period', 'bardate', 'fecha', 'gmttime', 'localtime', 'opentime', 'unix', 'unixtime'],
    date: ['date', 'day', 'tradedate', 'fecha'],
    time: ['time', 'hora', 'barTime'.toLowerCase()],
    open: ['open', 'o', 'openprice', 'opening', 'apertura', 'first'],
    high: ['high', 'h', 'highprice', 'max', 'maximo', 'alto'],
    low: ['low', 'l', 'lowprice', 'min', 'minimo', 'bajo'],
    close: ['close', 'c', 'closeprice', 'closing', 'last', 'lastprice', 'price', 'cierre', 'closelast', 'value'],
    adjclose: ['adjclose', 'adjustedclose', 'adjclose*', 'adjcloseprice', 'adj', 'closeadj'],
    volume: ['volume', 'vol', 'v', 'volumen', 'tickvolume', 'qty', 'shares']
  };
  function norm(h) {
    var t = String(h || '').replace(/^\ufeff/, '').toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* old engines: keep as is */ }
    return t.replace(/[^a-z0-9]/g, '');
  }

  function mapColumns(header) {
    var n = header.map(norm), map = {};
    function find(key, exclude) {
      var al = ALIASES[key];
      for (var a = 0; a < al.length; a++) {
        var idx = n.indexOf(norm(al[a]));
        if (idx !== -1 && exclude.indexOf(idx) === -1) return idx;
      }
      return -1;
    }
    var used = [];
    ['adjclose', 'open', 'high', 'low', 'close', 'volume'].forEach(function (k) {
      var i = find(k, used);
      if (i !== -1) { map[k] = i; used.push(i); }
    });
    // separate Date + Time columns (MetaTrader, many brokers) vs one combined column
    var di = find('date', used), ti = find('time', used.concat(di === -1 ? [] : [di]));
    if (di !== -1 && ti !== -1 && di !== ti) { map.date = di; map.time = ti; }
    else {
      var dt = find('datetime', used);
      if (dt !== -1) map.datetime = dt;
    }
    return map;
  }

  function looksLikeHeader(row) {
    var hits = 0;
    row.forEach(function (c) {
      var k = norm(c);
      Object.keys(ALIASES).forEach(function (key) { if (ALIASES[key].map(norm).indexOf(k) !== -1) hits++; });
    });
    var numeric = row.filter(function (c) { return c !== '' && !isNaN(parseFloat(String(c).replace(/[$,\s]/g, ''))) && /^[\s$\-+.,\d]+$/.test(c); }).length;
    return hits >= 1 && numeric < row.length;
  }

  /* ---------------------------------------------------------------- *
   * Numbers
   * ---------------------------------------------------------------- */
  function makeNumberParser(decimalComma) {
    return function (s) {
      if (s == null) return NaN;
      var t = String(s).trim();
      if (t === '' || /^(null|nan|n\/a|na|-|—)$/i.test(t)) return NaN;
      t = t.replace(/[$€£\s]/g, '').replace(/^\((.*)\)$/, '-$1');
      if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
      var mult = 1;
      var m = /^(-?[\d.]+)([kKmMbB])$/.exec(t);
      if (m) { t = m[1]; mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()]; }
      if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
      return parseFloat(t) * mult;
    };
  }

  /* ---------------------------------------------------------------- *
   * Dates and times
   * ---------------------------------------------------------------- */
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    ene: 1, abr: 4, ago: 8, dic: 12 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function validYMD(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Offset (minutes) of America/New_York at a UTC instant, via Intl; EST fallback.
  function nyOffsetMinutes(utcMs) {
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var p = {};
      f.formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
      var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return Math.round((asUtc - utcMs) / 60000);
    } catch (e) { return -300; }
  }
  // Wall-clock time in New York → unix seconds (handles DST).
  function nyToUnix(y, mo, d, h, mi, s) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, s);
    var off = nyOffsetMinutes(guess);
    var t = guess - off * 60000;
    var off2 = nyOffsetMinutes(t);
    if (off2 !== off) t = guess - off2 * 60000;
    return Math.round(t / 1000);
  }

  // Parse a time-of-day "9:30", "09:30:00", "9:30 PM", "0930"
  function parseClock(s) {
    if (s == null || s === '') return null;
    var t = String(s).trim();
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap]\.?m\.?)?$/i.exec(t);
    if (!m) { var m4 = /^(\d{2})(\d{2})(\d{2})?$/.exec(t); if (m4) m = [t, m4[1], m4[2], m4[3], null]; }
    if (!m) return null;
    var h = +m[1], mi = +m[2], se = +(m[3] || 0);
    if (m[4]) { var pm = /p/i.test(m[4]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    if (h > 23 || mi > 59 || se > 59) return null;
    return { h: h, mi: mi, s: se };
  }

  /* Returns {y, m, d, clock|null, unix|null (when the source carried a zone or epoch)} or null.
   * order: 'mdy' | 'dmy' for ambiguous slash dates. */
  function parseDateCell(raw, order) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(/^"|"$/g, '');
    if (s === '') return null;
    var m;
    // epoch seconds / milliseconds / YYYYMMDD
    if (/^\d+(\.\d+)?$/.test(s)) {
      var v = parseFloat(s);
      if (/^\d{8}$/.test(s)) {
        var y8 = +s.slice(0, 4), m8 = +s.slice(4, 6), d8 = +s.slice(6, 8);
        if (validYMD(y8, m8, d8)) return { y: y8, m: m8, d: d8, clock: null, unix: null };
      }
      if (v > 1e11) v = v / 1000;           // milliseconds
      if (v > 3e8 && v < 7e9) {             // 1979 … 2191
        var dt = new Date(v * 1000);
        return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), clock: { h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() }, unix: Math.round(v) };
      }
      return null;
    }
    // ISO-ish: 2024-01-15, 2024/01/15, 2024.01.15, optional T/space time and zone
    m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s]+(.+?))?$/.exec(s);
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      if (!validYMD(y, mo, d)) return null;
      return withTime(y, mo, d, m[4]);
    }
    // 01/15/2024 or 15/01/2024 (also - and .), 2-digit years allowed
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:[T\s,]+(.+?))?$/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], yy = +m[3];
      if (m[3].length === 2) yy += yy < 70 ? 2000 : 1900;
      var mm, dd;
      if (order === 'dmy') { dd = a; mm = b; } else { mm = a; dd = b; }
      if (!validYMD(yy, mm, dd)) return null;
      return withTime(yy, mm, dd, m[4]);
    }
    // 15-Jan-2024, 15 Jan 2024, Jan 15, 2024, January 15 2024
    m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})(?:[T\s,]+(.+?))?$/.exec(s);
    if (m) {
      var mon = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
      var y2 = +m[3]; if (m[3].length === 2) y2 += y2 < 70 ? 2000 : 1900;
      if (mon && validYMD(y2, mon, +m[1])) return withTime(y2, mon, +m[1], m[4]);
      return null;
    }
    m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[T\s,]+(.+?))?$/.exec(s);
    if (m) {
      var mon2 = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (mon2 && validYMD(+m[3], mon2, +m[2])) return withTime(+m[3], mon2, +m[2], m[4]);
      return null;
    }
    return null;
  }

  function withTime(y, mo, d, rest) {
    if (!rest) return { y: y, m: mo, d: d, clock: null, unix: null };
    var r = String(rest).trim();
    var zone = null, zm = /(Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i.exec(r);
    if (zm) { zone = zm[1]; r = r.slice(0, zm.index).trim(); }
    var clock = parseClock(r);
    if (!clock) return { y: y, m: mo, d: d, clock: null, unix: null, badTime: true };
    var unix = null;
    if (zone) {
      var offMin = 0;
      if (!/^(Z|UTC|GMT)$/i.test(zone)) {
        var zz = /([+-])(\d{2}):?(\d{2})/.exec(zone);
        offMin = (zz[1] === '-' ? -1 : 1) * (+zz[2] * 60 + +zz[3]);
      }
      unix = Math.round((Date.UTC(y, mo - 1, d, clock.h, clock.mi, clock.s) - offMin * 60000) / 1000);
    }
    return { y: y, m: mo, d: d, clock: clock, unix: unix };
  }

  // Decide month/day order for slash dates by looking at every value.
  function detectDateOrder(values) {
    var mdy = false, dmy = false;
    values.forEach(function (v) {
      var m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/.exec(String(v || '').trim());
      if (!m) return;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    if (dmy && !mdy) return { order: 'dmy', ambiguous: false };
    if (mdy && !dmy) return { order: 'mdy', ambiguous: false };
    var any = values.some(function (v) { return /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/.test(String(v || '').trim()); });
    return { order: 'mdy', ambiguous: any && !(dmy && mdy) };
  }

  /* ---------------------------------------------------------------- *
   * Interval detection
   * ---------------------------------------------------------------- */
  function median(arr) { if (!arr.length) return NaN; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
  function intervalFromSeconds(sec, intraday) {
    if (!intraday) {
      var days = sec / 86400;
      if (days <= 4) return '1day';
      if (days <= 10) return '1week';
      if (days <= 45) return '1month';
      return 'custom';
    }
    var table = [[60, '1min'], [300, '5min'], [900, '15min'], [1800, '30min'], [3600, '1h'], [14400, '4h']];
    for (var i = 0; i < table.length; i++) if (Math.abs(sec - table[i][0]) <= table[i][0] * 0.1) return table[i][1];
    return 'custom';
  }
  var INTERVAL_LABEL = { '1min': '1 minute', '5min': '5 minutes', '15min': '15 minutes', '30min': '30 minutes', '1h': '1 hour', '4h': '4 hours', '1day': 'Daily', '1week': 'Weekly', '1month': 'Monthly', custom: 'Irregular' };

  function guessSymbol(filename) {
    if (!filename) return '';
    var base = String(filename).replace(/^.*[\\\/]/, '').replace(/\.(csv|txt|tsv)$/i, '');
    var m = /^([A-Za-z]{1,6}(?:[.\-][A-Za-z]{1,4})?|[A-Za-z]{2,6}[-\/]?USD[T]?)(?=$|[_\s\-,(]|\d)/.exec(base);
    var s = (m ? m[1] : base.split(/[_\s,(]/)[0]).toUpperCase();
    return s.replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
  }

  /* ---------------------------------------------------------------- *
   * Main entry: parse(text, {filename, useAdjusted=true, maxRows})
   * ---------------------------------------------------------------- */
  function parse(text, opts) {
    opts = opts || {};
    var warnings = [], errors = [], warnKeys = [], errKeys = [];
    // Each message is kept twice: as plain English (warnings/errors) and as a
    // template + values (warningKeys/errorKeys) so the page can translate it with BT.t.
    function fill(t, v) { return v ? t.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : String(v[k]); }) : t; }
    function W(t, v) { warnings.push(fill(t, v)); warnKeys.push({ t: t, v: v || null }); }
    function E(t, v) { errors.push(fill(t, v)); errKeys.push({ t: t, v: v || null }); }
    var res = { bars: [], interval: null, intervalLabel: '', symbol: guessSymbol(opts.filename), columns: {}, delimiter: ',', decimalComma: false,
      adjusted: false, closeOnly: false, warnings: warnings, errors: errors, warningKeys: warnKeys, errorKeys: errKeys, stats: { rows: 0, used: 0, skipped: 0, duplicates: 0, repaired: 0, from: null, to: null } };
    if (typeof text !== 'string' || !text.trim()) { E('The file is empty.'); return res; }
    text = text.replace(/^﻿/, '');
    if (/^\s*[{\[]/.test(text)) { E('This looks like JSON, not CSV. Save the data as a .csv file with one row per bar.'); return res; }
    if (/<html|<table/i.test(text.slice(0, 500))) { E('This looks like a web page, not CSV. Use the site\'s "Download" or "Export" button to get a .csv file.'); return res; }

    var d = detectDelimiter(text);
    res.delimiter = d;
    var rows = tokenize(text, d);
    // skip leading comment/title lines (e.g. "# exported by …", "Historical data for AAPL")
    while (rows.length && (rows[0].length < 2 || /^#/.test(rows[0][0]))) rows.shift();
    if (rows.length < 2) { E('Need a header row and at least one row of prices.'); return res; }

    var header, body, map;
    if (looksLikeHeader(rows[0])) { header = rows[0]; body = rows.slice(1); map = mapColumns(header); }
    else {
      header = null; body = rows;
      var w = rows[0].length;
      if (w >= 6) map = { datetime: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 };
      else if (w === 5) map = { datetime: 0, open: 1, high: 2, low: 3, close: 4 };
      else if (w === 2) map = { datetime: 0, close: 1 };
      else { E('No header row found. Add a first row like: Date,Open,High,Low,Close,Volume'); return res; }
      W('No header row, so columns were read as Date, Open, High, Low, Close, Volume.');
    }
    var hasTime = map.datetime != null || map.date != null;
    if (!hasTime) { E('Could not find a date or time column. Name it "Date", "Time" or "Timestamp".'); return res; }
    if (map.close == null && map.adjclose == null) { E('Could not find a closing price column. Name it "Close" (or "Adj Close", "Price", "Last").'); return res; }
    if (map.close == null) { map.close = map.adjclose; delete map.adjclose; }

    // decimal comma? only plausible with ; or tab delimiters (Excel in Spanish/European locales)
    if (d !== ',') {
      var sample = body.slice(0, 50).map(function (r) { return r[map.close]; });
      res.decimalComma = sample.some(function (v) { return /^-?\d{1,3}(\.\d{3})*,\d+$/.test(v || '') || /^-?\d+,\d+$/.test(v || ''); });
    }
    var num = makeNumberParser(res.decimalComma);

    var dateVals = body.map(function (r) { return map.date != null ? r[map.date] : r[map.datetime]; });
    var ord = detectDateOrder(dateVals);
    // Spreadsheets saved in Spanish/European locales (semicolons, decimal commas, Spanish headers)
    // write day/month/year, so prefer that reading when the dates alone cannot tell.
    var euroHint = res.decimalComma || d === ';' || (header && header.some(function (h) { return /^(fecha|cierre|apertura|volumen|datum|schluss)$/.test(norm(h)); }));
    if (ord.ambiguous && euroHint) {
      ord.order = 'dmy'; ord.ambiguous = false;
      W('Dates like 03/04/2024 were read as day/month/year because the file uses European/Latin American spreadsheet formatting. If they are month/day/year, rename the column to "Date (MDY)".');
    }
    if (header && /mdy|mmdd/i.test(header[map.date != null ? map.date : map.datetime] || '')) { ord.order = 'mdy'; ord.ambiguous = false; }
    if (ord.ambiguous) W('Dates like 03/04/2024 could be March 4 or April 3. They were read as month/day/year (US style). If your file uses day/month/year, rename the column to "Date (DMY)".');
    if (header && /dmy|ddmm|europe/i.test(header[map.date != null ? map.date : map.datetime] || '')) ord.order = 'dmy';

    var limit = opts.maxRows || MAX_ROWS;
    if (body.length > limit) { W('The file has {n} rows; only the most recent {limit} were kept to stay fast in the browser.', { n: body.length.toLocaleString('en-US'), limit: limit.toLocaleString('en-US') }); }

    var parsed = [], anyClock = false, badRows = 0, badTimes = 0, zoned = false;
    body.forEach(function (r) {
      res.stats.rows++;
      var dt = map.date != null
        ? parseDateCell(String(r[map.date] || '') + (r[map.time] ? ' ' + r[map.time] : ''), ord.order)
        : parseDateCell(r[map.datetime], ord.order);
      var c = num(r[map.close]);
      if (!dt || !(c > 0)) { badRows++; return; }
      if (dt.badTime) badTimes++;
      var o = map.open != null ? num(r[map.open]) : NaN;
      var h = map.high != null ? num(r[map.high]) : NaN;
      var l = map.low != null ? num(r[map.low]) : NaN;
      var v = map.volume != null ? num(r[map.volume]) : NaN;
      var adj = map.adjclose != null ? num(r[map.adjclose]) : NaN;
      if (dt.clock && (dt.clock.h || dt.clock.mi || dt.clock.s)) anyClock = true;
      if (dt.unix != null && dt.clock) zoned = true;
      parsed.push({ dt: dt, o: o, h: h, l: l, c: c, v: v, adj: adj });
    });
    if (badRows) { res.stats.skipped = badRows; W(badRows === 1 ? '1 row was skipped because the date or closing price could not be read.' : '{n} rows were skipped because the date or closing price could not be read.', { n: badRows }); }
    if (badTimes) W('{n} time value(s) could not be read; those rows were treated as daily bars.', { n: badTimes });
    if (!parsed.length) { E('No usable rows. Check that the file has dates and prices, one bar per row.'); return res; }

    // Build bars
    var intraday = anyClock;
    var bars = parsed.map(function (p) {
      var t;
      if (intraday) {
        var ck = p.dt.clock || { h: 0, mi: 0, s: 0 };
        t = p.dt.unix != null ? p.dt.unix : nyToUnix(p.dt.y, p.dt.m, p.dt.d, ck.h, ck.mi, ck.s);
      } else t = p.dt.y + '-' + pad(p.dt.m) + '-' + pad(p.dt.d);
      return { time: t, open: p.o, high: p.h, low: p.l, close: p.c, volume: p.v, adj: p.adj };
    });
    if (intraday && !zoned) W('Times without a time zone were read as New York (exchange) time.');

    // Sort ascending (Yahoo/most brokers are oldest-first, many others newest-first)
    var desc = bars.length > 1 && cmpTime(bars[0].time, bars[bars.length - 1].time) > 0;
    bars.sort(function (a, b) { return cmpTime(a.time, b.time); });
    if (desc) W('Rows were newest-first; they were re-ordered oldest-first.');
    // Dedupe (keep the last occurrence)
    var out = [];
    bars.forEach(function (b) {
      if (out.length && out[out.length - 1].time === b.time) { out[out.length - 1] = b; res.stats.duplicates++; }
      else out.push(b);
    });
    if (res.stats.duplicates) W('{n} duplicate timestamp(s) removed (kept the last row for each).', { n: res.stats.duplicates });
    if (out.length > limit) out = out.slice(out.length - limit);

    // Adjusted close: scale OHLC so splits and dividends don't look like crashes
    var useAdj = opts.useAdjusted !== false && map.adjclose != null && out.some(function (b) { return b.adj > 0 && Math.abs(b.adj - b.close) / b.close > 1e-6; });
    // Fill and repair
    var closeOnly = map.open == null || map.high == null || map.low == null;
    res.closeOnly = closeOnly;
    if (closeOnly) W('No Open/High/Low columns, so each bar uses the close for all four prices. Strategies that look at highs and lows (breakouts, ATR, stochastic) will be less accurate.');
    var noVol = map.volume == null;
    if (noVol) W('No Volume column; volume was set to 0, so VWAP and OBV will not mean anything.');
    out.forEach(function (b) {
      if (useAdj && b.adj > 0) { var k = b.adj / b.close; b.open *= k; b.high *= k; b.low *= k; b.close = b.adj; }
      if (!(b.open > 0)) b.open = b.close;
      if (!(b.high > 0)) b.high = Math.max(b.open, b.close);
      if (!(b.low > 0)) b.low = Math.min(b.open, b.close);
      var hi = Math.max(b.open, b.close, b.high), lo = Math.min(b.open, b.close, b.low);
      if (hi !== b.high || lo !== b.low) { res.stats.repaired++; b.high = hi; b.low = lo; }
      b.volume = b.volume >= 0 ? b.volume : 0;
      ['open', 'high', 'low', 'close'].forEach(function (k2) { b[k2] = Math.round(b[k2] * 1e6) / 1e6; });
      delete b.adj;
    });
    if (useAdj) { res.adjusted = true; W('Prices were adjusted using the "Adj Close" column so stock splits and dividends do not show up as fake crashes.'); }
    if (res.stats.repaired) W('{n} bar(s) had a high below the open/close or a low above it; those highs/lows were widened to fit.', { n: res.stats.repaired });

    // Interval
    var diffs = [];
    for (var i = 1; i < out.length && i < 2000; i++) diffs.push(toSec(out[i].time) - toSec(out[i - 1].time));
    var med = median(diffs);
    // Epoch timestamps on daily-or-slower bars (TradingView "Export chart data" does this):
    // convert to exchange-local calendar dates so the rest of the app treats them as daily bars.
    if (intraday && isFinite(med) && med >= 72000) {
      var seen = {};
      out = out.filter(function (b) {
        var ms = b.time * 1000, off = nyOffsetMinutes(ms), dt = new Date(ms + off * 60000);
        b.time = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
        if (seen[b.time]) return false;
        seen[b.time] = true; return true;
      });
      intraday = false;
      for (var wk = warnKeys.length - 1; wk >= 0; wk--) {
        if (warnKeys[wk].t.indexOf('read as New York') !== -1) { warnKeys.splice(wk, 1); warnings.splice(wk, 1); }
      }
      diffs = [];
      for (var j = 1; j < out.length && j < 2000; j++) diffs.push(toSec(out[j].time) - toSec(out[j - 1].time));
      med = median(diffs);
    }
    res.interval = out.length > 1 ? intervalFromSeconds(med, intraday) : (intraday ? 'custom' : '1day');
    res.intervalLabel = INTERVAL_LABEL[res.interval] || res.interval;
    // gaps: more than 5× the usual spacing (ignores weekends for daily)
    if (out.length > 10 && isFinite(med) && med > 0) {
      var gapLimit = intraday ? med * 5 : Math.max(med * 5, 6 * 86400);
      var gaps = diffs.filter(function (x) { return x > gapLimit && (!intraday || x < 12 * 3600); }).length;
      if (gaps) W('{n} unusually large gap(s) in the dates. Missing data can make a strategy look better or worse than it really is.', { n: gaps });
    }
    if (out.length < 30) E('Only {n} usable bars. The back-tester needs at least 30, and 200+ gives far more trustworthy results.', { n: out.length });
    else if (out.length < 200) W('Only {n} bars. Long moving averages (like the 200-bar) need more history, and results from a short sample are mostly luck.', { n: out.length });

    res.columns = map;
    res.bars = out;
    res.stats.used = out.length;
    res.stats.from = out.length ? out[0].time : null;
    res.stats.to = out.length ? out[out.length - 1].time : null;
    return res;
  }

  function toSec(t) { if (typeof t === 'number') return t; var p = t.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 1000; }
  function cmpTime(a, b) { return toSec(a) - toSec(b); }

  /* Bars → CSV text (for the sample and for "copy these bars") */
  function toCsv(bars) {
    var lines = ['Date,Open,High,Low,Close,Volume'];
    (bars || []).forEach(function (b) {
      var t = typeof b.time === 'number' ? new Date(b.time * 1000).toISOString().replace('.000Z', 'Z') : b.time;
      lines.push([t, b.open, b.high, b.low, b.close, Math.round(b.volume || 0)].join(','));
    });
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------- *
   * Dataset library (localStorage)
   * ---------------------------------------------------------------- */
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function list() {
    var s = ls(); if (!s) return [];
    try {
      var v = JSON.parse(s.getItem(INDEX_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return x && typeof x.id === 'string' && /^[a-z0-9]{6,20}$/.test(x.id); }) : [];
    } catch (e) { return []; }
  }
  function writeIndex(arr) { var s = ls(); if (!s) return false; try { s.setItem(INDEX_KEY, JSON.stringify(arr)); return true; } catch (e) { return false; } }
  function newId() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* save({name, symbol, interval, bars, filename}) → {ok, id, stored:boolean, reason} */
  var memory = {};
  function save(ds) {
    var id = newId();
    var meta = { id: id, name: String(ds.name || ds.symbol || 'My data').slice(0, 60), symbol: String(ds.symbol || '').slice(0, 12), interval: ds.interval || '1day',
      rows: ds.bars.length, from: ds.bars.length ? ds.bars[0].time : null, to: ds.bars.length ? ds.bars[ds.bars.length - 1].time : null,
      filename: String(ds.filename || '').slice(0, 120), addedAt: new Date().toISOString() };
    memory[id] = ds.bars;
    var packed = ds.bars.map(function (b) { return [b.time, b.open, b.high, b.low, b.close, b.volume || 0]; });
    var s = ls(), stored = false, reason = '';
    if (s) {
      try { s.setItem(DATA_PREFIX + id, JSON.stringify(packed)); stored = true; }
      catch (e) { reason = 'Browser storage is full, so this file is loaded for this visit only. Delete an older dataset to keep it.'; }
    } else reason = 'Browser storage is unavailable here, so this file is loaded for this visit only.';
    var idx = list().filter(function (x) { return x.id !== id; });
    meta.stored = stored;
    idx.unshift(meta);
    if (stored) writeIndex(idx.filter(function (x) { return x.stored !== false; }));
    return { ok: true, id: id, stored: stored, reason: reason, meta: meta };
  }
  function get(id) {
    if (memory[id]) return memory[id].slice();
    var s = ls(); if (!s) return null;
    try {
      var packed = JSON.parse(s.getItem(DATA_PREFIX + id) || 'null');
      if (!Array.isArray(packed)) return null;
      var bars = packed.filter(function (r) { return Array.isArray(r) && r.length >= 5; }).map(function (r) {
        return { time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] || 0 };
      }).filter(function (b) { return (typeof b.time === 'string' || typeof b.time === 'number') && b.close > 0 && b.high >= b.low; });
      memory[id] = bars;
      return bars.slice();
    } catch (e) { return null; }
  }
  function meta(id) { var m = list().filter(function (x) { return x.id === id; })[0]; return m || null; }
  function rename(id, name) {
    var idx = list(), changed = false;
    idx.forEach(function (m) { if (m.id === id) { m.name = String(name || '').slice(0, 60); changed = true; } });
    if (changed) writeIndex(idx);
    return changed;
  }
  function remove(id) {
    delete memory[id];
    var s = ls(); if (s) { try { s.removeItem(DATA_PREFIX + id); } catch (e) { /* ignore */ } }
    writeIndex(list().filter(function (x) { return x.id !== id; }));
  }

  BT.csv = {
    parse: parse, toCsv: toCsv, guessSymbol: guessSymbol,
    list: list, save: save, get: get, meta: meta, rename: rename, remove: remove,
    INTERVAL_LABEL: INTERVAL_LABEL, MAX_ROWS: MAX_ROWS,
    _internal: { detectDelimiter: detectDelimiter, tokenize: tokenize, mapColumns: mapColumns, parseDateCell: parseDateCell, detectDateOrder: detectDateOrder, makeNumberParser: makeNumberParser, nyToUnix: nyToUnix, intervalFromSeconds: intervalFromSeconds }
  };
})(typeof window !== 'undefined' ? window : globalThis);
