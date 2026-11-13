/* tests/csv.test.js — run with: node tests/csv.test.js */
'use strict';
const assert = require('assert');
const store = {};
global.window = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  }
};
require('../js/csv.js');
const C = window.BT.csv;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); }
}

function rowsDaily(n, start) {
  const out = [];
  const d = new Date(Date.UTC(2024, 0, 2));
  let p = start || 100;
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const o = p, c = +(p * (1 + (out.length % 7 - 3) / 200)).toFixed(2);
      out.push({ date: d.toISOString().slice(0, 10), o, h: +(Math.max(o, c) + 1).toFixed(2), l: +(Math.min(o, c) - 1).toFixed(2), c, v: 1000 + out.length });
      p = c;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test('Yahoo Finance format with Adj Close, oldest first', () => {
  const r = rowsDaily(250);
  const csv = 'Date,Open,High,Low,Close,Adj Close,Volume\n' + r.map(x => [x.date, x.o, x.h, x.l, x.c, x.c, x.v].join(',')).join('\n');
  const res = C.parse(csv, { filename: 'AAPL.csv' });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.bars.length, 250);
  assert.strictEqual(res.interval, '1day');
  assert.strictEqual(res.symbol, 'AAPL');
  assert.strictEqual(res.bars[0].time, '2024-01-02');
  assert.strictEqual(res.bars[0].close, r[0].c);
  assert.strictEqual(res.adjusted, false, 'adj == close so no adjustment needed');
});

test('Adj Close scales OHLC (split-adjusted)', () => {
  const csv = 'Date,Open,High,Low,Close,Adj Close,Volume\n' +
    rowsDaily(40).map((x, i) => [x.date, x.o, x.h, x.l, x.c, i < 20 ? x.c / 2 : x.c, x.v].join(',')).join('\n');
  const res = C.parse(csv);
  assert.strictEqual(res.adjusted, true);
  assert.ok(Math.abs(res.bars[0].close * 2 - rowsDaily(40)[0].c) < 1e-6);
  assert.ok(res.bars[0].high >= res.bars[0].close && res.bars[0].low <= res.bars[0].close);
  const noAdj = C.parse(csv, { useAdjusted: false });
  assert.strictEqual(noAdj.adjusted, false);
});

test('Newest-first rows are re-ordered and duplicates removed', () => {
  const r = rowsDaily(60);
  const lines = r.map(x => [x.date, x.o, x.h, x.l, x.c, x.v].join(',')).reverse();
  lines.splice(5, 0, lines[5]);
  const res = C.parse('Date,Open,High,Low,Close,Volume\n' + lines.join('\n'));
  assert.strictEqual(res.bars.length, 60);
  assert.strictEqual(res.bars[0].time, r[0].date);
  assert.strictEqual(res.stats.duplicates, 1);
  assert.ok(res.warnings.some(w => /newest-first/.test(w)));
});

test('Nasdaq.com export: "Close/Last", dollar signs, US dates, newest first', () => {
  const csv = 'Date,Close/Last,Volume,Open,High,Low\n' +
    rowsDaily(35).reverse().map(x => { const [y, m, d] = x.date.split('-'); return [`${m}/${d}/${y}`, '$' + x.c, x.v, '$' + x.o, '$' + x.h, '$' + x.l].join(','); }).join('\n');
  const res = C.parse(csv, { filename: 'HistoricalData_1731450000.csv' });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.bars.length, 35);
  assert.strictEqual(res.bars[0].time, '2024-01-02');
  assert.ok(res.bars[0].open > 0 && res.bars[0].volume > 0);
});

test('European Excel: semicolons, decimal commas, DD/MM/YYYY detected from day > 12', () => {
  const r = rowsDaily(40);
  const csv = 'Fecha;Apertura;Máximo;Mínimo;Cierre;Volumen\n' + r.map(x => {
    const [y, m, d] = x.date.split('-');
    const f = n => String(n).replace('.', ',');
    return [`${d}/${m}/${y}`, f(x.o), f(x.h), f(x.l), f(x.c), x.v].join(';');
  }).join('\n');
  const res = C.parse(csv);
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.delimiter, ';');
  assert.strictEqual(res.decimalComma, true);
  assert.strictEqual(res.bars[0].time, '2024-01-02');
  assert.strictEqual(res.bars[0].close, r[0].c);
  assert.ok(!res.warnings.some(w => /could be March/.test(w)), 'order was unambiguous');
});

test('Accented Spanish headers map High/Low; ambiguous dates in a European-format file read day first', () => {
  const csv = 'Fecha;Hora;Apertura;Máximo;Mínimo;Cierre;Volumen\n' +
    Array.from({ length: 40 }, (_, i) => `08/07/2024;${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')};50,0;51,5;49,5;50,5;100`).join('\n');
  const res = C.parse(csv);
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.columns.high, 3);
  assert.strictEqual(res.columns.low, 4);
  assert.strictEqual(res.bars[0].high, 51.5);
  // 8 July 2024 10:00 New York (EDT) = 14:00 UTC
  assert.strictEqual(res.bars[0].time, Date.UTC(2024, 6, 8, 14, 0) / 1000);
  assert.ok(res.warnings.some(w => /day\/month\/year/.test(w)));
});

test('Ambiguous slash dates default to US order with a warning', () => {
  const csv = 'Date,Close\n' + ['01/02/2024', '01/03/2024', '01/04/2024'].map((d, i) => d + ',' + (100 + i)).join('\n');
  const res = C.parse(csv);
  assert.ok(res.warnings.some(w => /month\/day\/year/.test(w)));
  assert.strictEqual(res.bars[0].time, '2024-01-02');
});

test('Close-only file fills OHLC and warns; fewer than 30 bars is an error', () => {
  const res = C.parse('Date,Close\n2024-01-02,10\n2024-01-03,11\n');
  assert.ok(res.closeOnly);
  assert.strictEqual(res.bars[0].open, 10);
  assert.ok(res.errors.some(e => /at least 30/.test(e)));
});

test('Intraday with separate Date and Time columns (MetaTrader style) → unix seconds in NY time', () => {
  const lines = [];
  for (let i = 0; i < 60; i++) {
    const mins = 9 * 60 + 30 + i * 5;
    lines.push(`2024.07.15,${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')},100,101,99,100.5,500`);
  }
  const res = C.parse('Date,Time,Open,High,Low,Close,Volume\n' + lines.join('\n'));
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.interval, '5min');
  // 2024-07-15 09:30 EDT = 13:30 UTC
  assert.strictEqual(res.bars[0].time, Date.UTC(2024, 6, 15, 13, 30) / 1000);
  assert.ok(res.warnings.some(w => /New York/.test(w)));
});

test('ISO timestamps with Z are taken as UTC', () => {
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(new Date(Date.UTC(2024, 0, 15, 14, 0) + i * 3600e3).toISOString() + ',1,2,0.5,1.5,10');
  const res = C.parse('timestamp,open,high,low,close,volume\n' + lines.join('\n'));
  assert.strictEqual(res.interval, '1h');
  assert.strictEqual(res.bars[0].time, Date.UTC(2024, 0, 15, 14, 0) / 1000);
  assert.ok(!res.warnings.some(w => /New York/.test(w)));
});

test('TradingView export: epoch seconds on daily bars become calendar dates', () => {
  const lines = [];
  let t = Date.UTC(2024, 0, 2, 14, 30) / 1000; // 09:30 New York
  for (let i = 0; i < 50; i++) { lines.push(`${t},100,102,99,101,1000`); t += 86400 * (i % 5 === 4 ? 3 : 1); }
  const res = C.parse('time,open,high,low,close,Volume\n' + lines.join('\n'), { filename: 'BATS_MSFT, 1D.csv' });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.interval, '1day');
  assert.strictEqual(res.bars[0].time, '2024-01-02');
  assert.strictEqual(typeof res.bars[10].time, 'string');
});

test('Epoch milliseconds are recognised', () => {
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(`${Date.UTC(2024, 2, 1, 15, i)} ,1,1,1,1,1`);
  const res = C.parse('Timestamp,Open,High,Low,Close,Volume\n' + lines.join('\n'));
  assert.strictEqual(res.interval, '1min');
  assert.strictEqual(res.bars[0].time, Date.UTC(2024, 2, 1, 15, 0) / 1000);
});

test('No header row: six numeric-looking columns read as D,O,H,L,C,V with a warning', () => {
  const r = rowsDaily(40);
  const res = C.parse(r.map(x => [x.date, x.o, x.h, x.l, x.c, x.v].join(',')).join('\n'));
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.bars.length, 40);
  assert.ok(res.warnings.some(w => /No header row/.test(w)));
});

test('Quoted fields with thousands separators, BOM, and a title line', () => {
  const r = rowsDaily(40, 1500);
  const csv = '﻿# Exported by MyBroker\n"Date","Open","High","Low","Close","Volume"\n' +
    r.map(x => `"${x.date}","${x.o.toLocaleString('en-US')}","${x.h.toLocaleString('en-US')}","${x.l.toLocaleString('en-US')}","${x.c.toLocaleString('en-US')}","${(x.v * 1000).toLocaleString('en-US')}"`).join('\n');
  const res = C.parse(csv);
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.bars[0].close, r[0].c);
  assert.strictEqual(res.bars[0].volume, r[0].v * 1000);
});

test('Bad bars repaired; unreadable rows skipped and counted', () => {
  const r = rowsDaily(40);
  const lines = r.map(x => [x.date, x.o, x.h, x.l, x.c, x.v].join(','));
  lines[3] = r[3].date + ',' + r[3].o + ',' + (Math.min(r[3].o, r[3].c) - 5) + ',' + r[3].l + ',' + r[3].c + ',1'; // high below close
  lines.push('not-a-date,1,2,3,4,5', '2024-12-31,,,,,');
  const res = C.parse('Date,Open,High,Low,Close,Volume\n' + lines.join('\n'));
  assert.strictEqual(res.stats.skipped, 2);
  assert.strictEqual(res.stats.repaired, 1);
  res.bars.forEach(b => assert.ok(b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close)));
});

test('Helpful errors for JSON, HTML and missing columns', () => {
  assert.ok(C.parse('[{"a":1}]').errors[0].includes('JSON'));
  assert.ok(C.parse('<html><table></table></html>').errors[0].includes('web page'));
  assert.ok(C.parse('Symbol,Open\nAAPL,1\nAAPL,2').errors[0].includes('date'));
  assert.ok(C.parse('Date,Open\n2024-01-02,1\n2024-01-03,2').errors[0].includes('closing price'));
  assert.ok(C.parse('').errors[0].includes('empty'));
});

test('Row cap keeps the most recent rows', () => {
  const r = rowsDaily(120);
  const res = C.parse('Date,Close\n' + r.map(x => x.date + ',' + x.c).join('\n'), { maxRows: 100 });
  assert.strictEqual(res.bars.length, 100);
  assert.strictEqual(res.bars[99].time, r[119].date);
});

test('guessSymbol from common filenames', () => {
  assert.strictEqual(C.guessSymbol('AAPL.csv'), 'AAPL');
  assert.strictEqual(C.guessSymbol('/x/y/msft_daily_2020.csv'), 'MSFT');
  assert.strictEqual(C.guessSymbol('BTC-USD.csv'), 'BTC-USD');
  assert.strictEqual(C.guessSymbol('BRK.B.csv'), 'BRK.B');
});

test('toCsv round-trips through parse', () => {
  const r = rowsDaily(50);
  const first = C.parse('Date,Open,High,Low,Close,Volume\n' + r.map(x => [x.date, x.o, x.h, x.l, x.c, x.v].join(',')).join('\n'));
  const again = C.parse(C.toCsv(first.bars));
  assert.deepStrictEqual(again.bars, first.bars);
});

test('Dataset library: save, list, get, remove, corrupt data tolerated', () => {
  const r = C.parse('Date,Close\n' + rowsDaily(40).map(x => x.date + ',' + x.c).join('\n'));
  const s = C.save({ name: 'Test set', symbol: 'TST', interval: r.interval, bars: r.bars, filename: 'tst.csv' });
  assert.ok(s.ok && s.stored);
  assert.strictEqual(C.list()[0].id, s.id);
  assert.strictEqual(C.list()[0].rows, 40);
  assert.deepStrictEqual(C.get(s.id), r.bars);
  store['bt.csv.datasets'] = '{not json';
  assert.deepStrictEqual(C.list(), []);
  store['bt.csv.datasets'] = JSON.stringify([{ id: s.id, name: 'x' }, { id: '../evil', name: 'y' }]);
  assert.strictEqual(C.list().length, 1, 'ids are validated');
  C.remove(s.id);
  assert.strictEqual(C.list().length, 0);
  assert.strictEqual(C.get(s.id), null);
});

test('Spanish month names and "15-Jan-2024" style dates', () => {
  const p = C._internal.parseDateCell;
  assert.deepStrictEqual([p('15-Jan-2024').y, p('15-Jan-2024').m, p('15-Jan-2024').d], [2024, 1, 15]);
  assert.strictEqual(p('15 ene 2024').m, 1);
  assert.strictEqual(p('Jan 5, 2024').d, 5);
  assert.strictEqual(p('20240131').d, 31);
  assert.strictEqual(p('2024-02-30'), null, 'invalid calendar date rejected');
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
