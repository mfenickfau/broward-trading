/* Broward Trading — js/leagues-ui.js: the Leagues page (leagues.html).
 *
 * Builds on BT.leagues (js/leagues.js). Sections: My leagues (countdown, own
 * return, share/sync, leave), Join (paste a 'BTL1.' code, or a 6-character code
 * when the league server is configured), Create (presets + full rules form),
 * Standings (table on wide screens, card list on phones, sparklines, team
 * standings, share-code import) and the Projector view.
 *
 * Projector view: fullscreen-friendly rotating slides — standings pages of 8,
 * biggest movers, team standings — in very large type and high contrast.
 * Auto-advances every 10 s; ← / → (and PageUp/PageDown) change slides, Space
 * pauses, F toggles full screen, Escape exits. Opens directly with
 * leagues.html?projector=1&league=CODE.
 */
(function () {
  'use strict';
  var BT = window.BT = window.BT || {};
  var L = BT.leagues;
  if (!L || typeof document === 'undefined') return;

  var UI_KEY = 'bt.leagues.ui';
  var SLIDE_MS = 10000;
  var ROWS_PER_SLIDE = 8;

  function T(s, v) { return BT.t ? BT.t(s, v) : String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uiGet() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function uiSet(patch) { try { var s = uiGet(); Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); localStorage.setItem(UI_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ } }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function money(v) {
    if (!isNum(v)) return '—';
    if (BT.i18n && BT.i18n.fmtMoney) { try { return BT.i18n.fmtMoney(v, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); } catch (e) { /* fall through */ } }
    return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(v, dp) { if (!isNum(v)) return '—'; var s = v.toFixed(dp == null ? 2 : dp); return (v > 0 ? '+' : '') + s + '%'; }
  function num(v, dp) { return isNum(v) ? v.toFixed(dp == null ? 2 : dp) : '—'; }
  function tone(v) { return !isNum(v) || Math.abs(v) < 1e-9 ? '' : (v > 0 ? 'gain' : 'loss'); }
  function fmtDate(key) {
    var p = String(key || '').split('-');
    if (p.length !== 3) return key || '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    try { return BT.i18n && BT.i18n.fmtDate ? BT.i18n.fmtDate(d, { month: 'short', day: 'numeric', year: 'numeric' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return key; }
  }
  function toast(msg, kind, title) {
    if (BT.nav && BT.nav.toast) BT.nav.toast(msg, kind, title);
    else if (BT.a11y && BT.a11y.announce) BT.a11y.announce(msg);
  }
  function flash(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
    clearTimeout(el._t);
    if (text && kind !== 'err') el._t = setTimeout(function () { el.textContent = ''; }, 7000);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); return ok;
  }
  function online() { return L.remote.configured(); }
  function kindLabel(k) { return { stock: T('Stocks'), etf: T('ETFs'), crypto: T('Crypto'), option: T('Options') }[k] || k; }
  function rulesPills(lg) {
    var r = lg.rules, out = [];
    out.push(T('{cash} start', { cash: money(r.startingCash) }));
    out.push(r.assets.map(kindLabel).join(' · '));
    out.push(r.commission ? T('{c} commission', { c: '$' + r.commission.toFixed(2) }) : T('No commission'));
    if (r.slippageBps) out.push(T('{n} bps slippage', { n: r.slippageBps }));
    out.push(r.dayTrading ? T('Day trading on') : T('No day trading'));
    out.push(r.shortSelling ? T('Shorting on') : T('No shorting'));
    if (r.maxPositionPct < 100) out.push(T('Max {n}% per position', { n: r.maxPositionPct }));
    if (r.teams) out.push(T('Teams: {t}', { t: r.teamNames.join(', ') }));
    out.push(rankLabel(lg));
    return out;
  }
  function rankBy(lg) { var b = lg && lg.rules && lg.rules.rankBy; return b === 'return' || b === 'consistency' ? b : 'riskAdjusted'; }
  function rankLabel(lg) {
    var b = rankBy(lg);
    return b === 'return' ? T('Ranked by raw return') : b === 'consistency' ? T('Ranked by consistency') : T('Ranked by risk-adjusted return');
  }
  function standingsCaption(lg) {
    var b = rankBy(lg);
    return b === 'return' ? T('Standings for {name}, sorted by return', { name: lg.name })
      : b === 'consistency' ? T('Standings for {name}, sorted by consistency', { name: lg.name })
      : T('Standings for {name}, sorted by risk-adjusted return', { name: lg.name });
  }
  function phasePill(ph) {
    if (ph === 'active') return '<span class="pill live"><span class="dot"></span>' + esc(T('Live')) + '</span>';
    if (ph === 'upcoming') return '<span class="pill accent">' + esc(T('Upcoming')) + '</span>';
    if (ph === 'ended') return '<span class="pill solid">' + esc(T('Finished')) + '</span>';
    return '';
  }
  function sparkSvg(values, cls, w, h) {
    w = w || 96; h = h || 28;
    var v = (values || []).filter(isNum);
    var d = L.sparkPath(v, w, h, 2);
    if (!d) return '<svg class="spark flat ' + (cls || '') + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(T('Not enough equity points yet')) + '"></svg>';
    var ch = v[0] > 0 ? (v[v.length - 1] - v[0]) / v[0] * 100 : 0;
    var dir = ch > 0.005 ? 'up' : (ch < -0.005 ? 'down' : 'flat');
    var label = T('Equity trend over {n} points: {chg}', { n: v.length, chg: pct(ch, 1) });
    return '<svg class="spark ' + dir + ' ' + (cls || '') + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '"><path d="' + d + '" vector-effect="non-scaling-stroke"/></svg>';
  }

  /* ------------------------------------------------------------------ *
   * data: rows for a league (online fetch or local computation)
   * ------------------------------------------------------------------ */
  var cache = {};   // code → {rows, teams, at, online}
  function localRows(lg) {
    var rows = L.standings(lg, L.knownSnapshots(lg.code));
    return { rows: rows, teams: lg.rules.teams ? L.teamStandings(rows, lg) : [], online: false, at: Date.now() };
  }
  function loadRows(lg, opts) {
    opts = opts || {};
    if (!lg) return Promise.resolve({ rows: [], teams: [] });
    if (!(lg.online && online())) { cache[lg.code] = localRows(lg); return Promise.resolve(cache[lg.code]); }
    var pre = opts.sync && L.membership(lg.code) ? L.remote.sync(lg.code) : Promise.resolve(null);
    return pre.then(function () { return L.remote.standings(lg.code); }).then(function (r) {
      if (!r.ok) {
        var fallback = localRows(lg); fallback.error = r.error; cache[lg.code] = fallback; return fallback;
      }
      var mine = null; try { mine = L.studentId(); } catch (e) { mine = null; }
      var rows = (r.standings || []).map(function (s) {
        return { rank: s.rank, studentId: s.studentId, displayName: s.displayName, team: s.team, equity: s.equity, returnPct: s.returnPct, sharpe: s.sharpe, maxDrawdownPct: s.maxDrawdownPct, trades: s.trades, consistencyScore: s.consistencyScore, equityHistory: s.spark || [], me: s.studentId === mine };
      });
      cache[lg.code] = { rows: rows, teams: r.teams || [], online: true, at: Date.now() };
      return cache[lg.code];
    });
  }

  /* ------------------------------------------------------------------ *
   * My leagues
   * ------------------------------------------------------------------ */
  function selected() {
    var all = L.list();
    var want = uiGet().selected;
    return all.filter(function (l) { return l.code === want; })[0] || L.joined()[0] || all[0] || null;
  }
  function select(code) { uiSet({ selected: code }); renderMy(); renderStandingsSelect(); renderStandings(); }

  function renderMy() {
    var list = $('myList'), joined = L.joined(), sel = selected();
    $('myEmpty').hidden = joined.length > 0;
    list.innerHTML = joined.map(function (lg) {
      var cd = L.countdown(lg);
      var s = L.leagueSnapshot(lg.code);
      var mem = L.membership(lg.code) || {};
      var share = lg.online && online()
        ? '<button type="button" data-act="sync" data-code="' + lg.code + '">' + esc(T('Sync now')) + '</button>'
        : '<button type="button" data-act="share" data-code="' + lg.code + '">' + esc(T('Copy my share code')) + '</button>';
      return '<li class="my-item' + (sel && sel.code === lg.code ? ' sel' : '') + '">' +
        '<div><h3>' + esc(lg.name) + ' ' + phasePill(cd.phase) + '</h3>' +
        '<p class="meta">' + esc(fmtDate(lg.startDate) + ' – ' + fmtDate(lg.endDate)) + ' · <span class="countdown">' + esc(cd.label) + '</span>' +
        (mem.team ? ' · ' + esc(T('Team {t}', { t: mem.team })) : '') + (mem.displayName ? ' · ' + esc(mem.displayName) : '') + '</p></div>' +
        '<div class="figs"><b class="' + tone(s.returnPct) + '">' + esc(pct(s.returnPct)) + '</b><span>' + esc(money(s.equity)) + '</span></div>' +
        '<div class="acts">' +
          '<a class="btn primary" href="index.html">' + esc(T('Trade on the dashboard')) + '</a>' +
          '<button type="button" data-act="view" data-code="' + lg.code + '">' + esc(T('Standings')) + '</button>' +
          share +
          '<button type="button" data-act="code" data-code="' + lg.code + '">' + esc(T('Copy league code')) + '</button>' +
          '<button type="button" class="ghost" data-act="leave" data-code="' + lg.code + '">' + esc(T('Leave')) + '</button>' +
        '</div></li>';
    }).join('');
    if (joined.length) {
      var hint = T('On the dashboard, pick the league in the ticket\'s account switcher so trades count here and the league rules apply.');
      list.insertAdjacentHTML('beforeend', '<li class="note">' + esc(hint) + '</li>');
    }
  }
  function onMyClick(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var code = b.getAttribute('data-code'), lg = L.get(code), act = b.getAttribute('data-act');
    if (!lg) return;
    if (act === 'view') { select(code); $('standingsCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (act === 'code') { copyText(L.encodeLeague(lg)).then(function (ok) { flash($('myMsg'), ok ? T('League code copied. Paste it to anyone you want to invite.') : T('Copy failed. Open Create → the league code box, or select the code by hand.'), ok ? 'ok' : 'err'); }); return; }
    if (act === 'share') {
      L.encodeShare().then(function (c) { return copyText(c); }).then(function (ok) {
        flash($('myMsg'), ok ? T('Share code copied. Send it to the league organiser; it holds your league results and course progress, never your email.') : T('Could not copy the share code.'), ok ? 'ok' : 'err');
      });
      return;
    }
    if (act === 'sync') {
      b.disabled = true;
      L.remote.sync(code).then(function (r) {
        b.disabled = false;
        flash($('myMsg'), r.ok ? T('Sent. The standings now show your latest equity.') : (r.error || T('Could not reach the league server.')), r.ok ? 'ok' : 'err');
        if (r.ok) renderStandings();
      });
      return;
    }
    if (act === 'leave') {
      if (!window.confirm(T('Leave {name}? Your league paper account stays on this device, but you stop appearing in new standings.', { name: lg.name }))) return;
      L.leave(code);
      toast(T('You left {name}.', { name: lg.name }), 'ok');
      renderAll();
    }
  }

  /* ------------------------------------------------------------------ *
   * Join
   * ------------------------------------------------------------------ */
  var pendingJoin = null;   // decoded or fetched league awaiting submit
  function describe(lg) { return lg.name + ' · ' + fmtDate(lg.startDate) + ' – ' + fmtDate(lg.endDate) + ' · ' + rulesPills(lg).join(' · '); }
  function setTeams(lg) {
    var f = $('joinTeamField'), sel = $('joinTeam');
    if (lg && lg.rules.teams) {
      sel.innerHTML = '<option value="">' + esc(T('Choose a team')) + '</option>' + lg.rules.teamNames.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
      f.hidden = false;
    } else { f.hidden = true; sel.innerHTML = ''; }
  }
  var previewTimer = null;
  function previewJoin() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var raw = $('joinCode').value.trim(), out = $('joinPreview');
      pendingJoin = null; setTeams(null);
      if (!raw) { out.textContent = ''; return; }
      var codes = L.parseLeagueCodes(raw);
      var d = L.decodeLeague(codes[0] || raw);
      if (d.ok) { pendingJoin = d.league; out.textContent = describe(d.league); setTeams(d.league); return; }
      if (d.reason === 'short-code' && online()) {
        out.textContent = T('Looking up {code}…', { code: d.code });
        L.remote.fetch(d.code).then(function (r) {
          if ($('joinCode').value.trim() !== raw) return;
          if (r.ok && r.league) { pendingJoin = r.league; out.textContent = describe(r.league); setTeams(r.league); }
          else out.textContent = r.error || T('No league has that code.');
        });
        return;
      }
      out.textContent = d.error;
    }, 250);
  }
  function onJoin(e) {
    e.preventDefault();
    var msg = $('joinMsg');
    if (!pendingJoin) { flash(msg, $('joinPreview').textContent || T('Paste the league code first.'), 'err'); return; }
    var lg = pendingJoin;
    var opts = { displayName: $('joinName').value, team: $('joinTeam').value };
    var r = L.join(lg, opts);
    if (!r.ok) {
      if (r.reason === 'locked') {
        // The pasted code differs from the copy this device already holds for a running league.
        var known = L.get(lg.code);
        flash(msg, r.error + ' ' + T('This device keeps the rules the league started with; ask the organiser for the original code if you think this is a mistake.'), 'err');
        if (known) { uiSet({ selected: known.code }); renderAll(); }
        return;
      }
      flash(msg, r.error, 'err'); return;
    }
    var done = function (extra) {
      flash(msg, T('You joined {name}. A fresh {cash} paper account is ready for it.', { name: r.league.name, cash: money(r.league.rules.startingCash) }) + (extra ? ' ' + extra : ''), 'ok');
      $('joinCode').value = ''; $('joinPreview').textContent = ''; pendingJoin = null; setTeams(null);
      uiSet({ selected: r.code });
      renderAll();
    };
    if (lg.online && online()) {
      L.remote.join(r.code, opts).then(function (res) {
        if (res.ok) done();
        else done(T('The league server did not accept the join yet ({err}); your account works offline and you can try Sync later.', { err: res.error || res.status }));
      });
    } else done();
  }

  /* ------------------------------------------------------------------ *
   * Create
   * ------------------------------------------------------------------ */
  var preset = 'classroom';
  function dateKey(d) { return L._internal.dayKey(d.getTime()); }
  function applyPreset(id) {
    preset = id;
    var p = L.PRESETS.filter(function (x) { return x.id === id; })[0];
    Array.prototype.forEach.call($('presetRow').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === id)); });
    if (!p) return;
    $('presetDesc').textContent = T(p.description);
    var r = L.normalizeRules(p.rules);
    $('cCash').value = r.startingCash; $('cComm').value = r.commission; $('cSlip').value = r.slippageBps; $('cMaxPos').value = r.maxPositionPct;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=asset]'), function (c) { c.checked = r.assets.indexOf(c.value) >= 0; });
    $('cDay').checked = r.dayTrading; $('cShort').checked = r.shortSelling;
    if ($('cRank')) $('cRank').value = r.rankBy;
    var start = $('cStart').value || dateKey(new Date());
    $('cStart').value = start;
    $('cEnd').value = L._internal.addDays(start, p.days - 1);
  }
  function renderPresets() {
    $('presetRow').innerHTML = L.PRESETS.map(function (p) {
      return '<button type="button" data-id="' + p.id + '" aria-pressed="false">' + esc(T(p.name)) + '</button>';
    }).join('');
    $('presetRow').addEventListener('click', function (e) { var b = e.target.closest('button[data-id]'); if (b) applyPreset(b.getAttribute('data-id')); });
    $('cTeams').addEventListener('change', function () { $('teamNamesField').hidden = !$('cTeams').checked; });
    applyPreset(preset);
  }
  function formRules() {
    return {
      startingCash: +$('cCash').value, commission: +$('cComm').value, slippageBps: +$('cSlip').value, maxPositionPct: +$('cMaxPos').value,
      assets: Array.prototype.filter.call(document.querySelectorAll('input[name=asset]'), function (c) { return c.checked; }).map(function (c) { return c.value; }),
      dayTrading: $('cDay').checked, shortSelling: $('cShort').checked, teams: $('cTeams').checked, teamNames: $('cTeamNames').value,
      rankBy: $('cRank') ? $('cRank').value : undefined
    };
  }
  function showCode(lg) {
    $('codeOut').hidden = false;
    $('codeShort').textContent = lg.code;
    $('codeShort').setAttribute('aria-label', T('Short league code {code}', { code: lg.code.split('').join(' ') }));
    $('codeLong').value = L.encodeLeague(lg);
    $('codeOut').dataset.code = lg.code;
  }
  function inviteText(lg) {
    var url = location.href.split(/[?#]/)[0];
    return T('Join my Broward Trading league "{name}" ({start} – {end}). Open {url}, tap Join a league and paste this code:', { name: lg.name, start: fmtDate(lg.startDate), end: fmtDate(lg.endDate), url: url }) + '\n\n' + L.encodeLeague(lg) +
      '\n\n' + T('Play money only: no real orders, no fees.');
  }
  function onCreate(e) {
    e.preventDefault();
    var msg = $('createMsg'), btn = $('createBtn');
    var r = L.create({ name: $('cName').value, startDate: $('cStart').value, endDate: $('cEnd').value, preset: preset, rules: formRules(), createdBy: $('cBy').value });
    if (!r.ok) { flash(msg, r.errors.join(' '), 'err'); return; }
    var finish = function (lg, note) {
      showCode(lg);
      if ($('cJoin').checked) {
        var j = L.join(lg, { displayName: $('cBy').value, team: lg.rules.teams ? lg.rules.teamNames[0] : '' });
        if (j.ok && lg.online && online()) L.remote.join(lg.code, { displayName: $('cBy').value, team: lg.rules.teams ? lg.rules.teamNames[0] : '' });
      }
      uiSet({ selected: lg.code });
      flash(msg, T('League created.') + (note ? ' ' + note : ''), 'ok');
      renderAll();
      $('codeOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    if (online()) {
      btn.disabled = true;
      L.remote.create(r.league).then(function (res) {
        btn.disabled = false;
        if (res.ok && res.league) finish(res.league, T('Members can join with the short code {code} or the full code below.', { code: res.league.code }));
        else { L.save(r.league); finish(r.league, T('The league server was not available ({err}), so this league runs offline with share codes.', { err: res.error || res.status })); }
      });
    } else { L.save(r.league); finish(r.league); }
  }

  /* ------------------------------------------------------------------ *
   * Standings
   * ------------------------------------------------------------------ */
  function renderStandingsSelect() {
    var all = L.list(), sel = selected(), s = $('stLeague');
    s.innerHTML = all.length ? all.map(function (lg) { return '<option value="' + lg.code + '"' + (sel && sel.code === lg.code ? ' selected' : '') + '>' + esc(lg.name) + ' (' + lg.code + ')</option>'; }).join('') : '<option value="">' + esc(T('No leagues yet')) + '</option>';
    s.disabled = !all.length;
    $('stProjector').disabled = !all.length;
  }
  function renderStandings() {
    var lg = selected(), body = $('stBody');
    $('stRefresh').hidden = !(lg && lg.online && online());
    $('importBox').hidden = !lg || (lg.online && online());
    if (!lg) {
      $('rulesSum').innerHTML = ''; $('teamBlock').hidden = true;
      body.innerHTML = '<div class="empty"><b>' + esc(T('No league selected.')) + '</b>' + esc(T('Create or join a league to see its standings here.')) + '</div>';
      return;
    }
    $('rulesSum').innerHTML = rulesPills(lg).map(function (p) { return '<li class="pill solid">' + esc(p) + '</li>'; }).join('') + '<li>' + phasePill(L.phase(lg)) + '</li>';
    body.innerHTML = '<p class="note">' + esc(T('Loading standings…')) + '</p>';
    loadRows(lg, { sync: true }).then(function (data) {
      if (selected() && selected().code !== lg.code) return;
      paintStandings(lg, data);
    });
  }
  function paintStandings(lg, data) {
    var rows = data.rows, body = $('stBody');
    var head = (data.error ? '<p class="msg err" role="status">' + esc(T('Showing this device\'s copy: {err}', { err: data.error })) + '</p>' : '') +
      '<p class="note rank-note">' + esc(L.rankNote ? L.rankNote(lg) : '') + '</p>';
    var mismatch = function (r) {
      return r.rulesMismatch ? ' <span class="pill demo mismatch" title="' + esc(T('This result was made under different dates or rules than your copy of the league.')) + '">' + esc(T('Rules differ')) + '</span>' : '';
    };
    if (!rows.length) {
      body.innerHTML = head + '<div class="empty"><b>' + esc(T('Nobody on the board yet.')) + '</b>' + esc(lg.online && online() ? T('Members appear after they join and sync.') : T('Join the league yourself, or import members\' share codes below.')) + '</div>';
    } else {
      var who = function (r) { return '<b>' + esc(r.displayName || T('Anonymous')) + (r.me ? ' <span class="pill accent">' + esc(T('You')) + '</span>' : '') + mismatch(r) + '</b><span>' + esc(r.team ? T('Team {t}', { t: r.team }) : r.studentId) + '</span>'; };
      var table = '<div class="table-wrap st-table"><table class="standings"><caption class="sr-only">' + esc(standingsCaption(lg)) + '</caption><thead><tr>' +
        '<th scope="col">#</th><th scope="col">' + esc(T('Member')) + '</th><th scope="col" class="num">' + esc(T('Return')) + '</th><th scope="col" class="num">' + esc(T('Max drawdown')) + '</th><th scope="col" class="num">' + esc(T('Sharpe')) + '</th><th scope="col" class="num">' + esc(T('Consistency')) + '</th><th scope="col" class="num">' + esc(T('Trades')) + '</th><th scope="col">' + esc(T('Equity')) + '</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr' + (r.me ? ' class="me"' : '') + '><td class="rank">' + r.rank + '</td><td class="who">' + who(r) + '</td>' +
            '<td class="num ' + tone(r.returnPct) + '">' + esc(pct(r.returnPct)) + '</td><td class="num">' + esc(num(r.maxDrawdownPct, 1)) + '%</td>' +
            '<td class="num">' + esc(num(r.sharpe)) + '</td><td class="num">' + esc(isNum(r.consistencyScore) ? String(r.consistencyScore) : '—') + '</td><td class="num">' + esc(String(r.trades || 0)) + '</td>' +
            '<td>' + sparkSvg(r.equityHistory) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      var cards = '<ol class="st-cards" aria-label="' + esc(standingsCaption(lg)) + '">' + rows.map(function (r) {
        return '<li class="st-card' + (r.me ? ' me' : '') + '"><span class="rank">' + r.rank + '</span><span class="who">' + who(r) + '</span><span class="ret ' + tone(r.returnPct) + '">' + esc(pct(r.returnPct)) + '</span>' +
          '<dl><div><dt>' + esc(T('Drawdown')) + '</dt><dd>' + esc(num(r.maxDrawdownPct, 1)) + '%</dd></div><div><dt>' + esc(T('Sharpe')) + '</dt><dd>' + esc(num(r.sharpe)) + '</dd></div><div><dt>' + esc(T('Consistency')) + '</dt><dd>' + esc(isNum(r.consistencyScore) ? String(r.consistencyScore) : '—') + '</dd></div><div><dt>' + esc(T('Trades')) + '</dt><dd>' + esc(String(r.trades || 0)) + '</dd></div></dl>' +
          ((r.equityHistory || []).filter(isNum).length >= 2 ? sparkSvg(r.equityHistory, '', 300, 32) : '<span class="muted xs spark-none">' + esc(T('Not enough equity points yet')) + '</span>') + '</li>';
      }).join('') + '</ol>';
      var diff = rows.some(function (r) { return r.rulesMismatch; })
        ? '<p class="note">' + esc(T('Rows marked "Rules differ" come from share codes made under different dates or rules than your copy of this league, so their results are not comparable. Ask those members to rejoin with the current league code.')) + '</p>' : '';
      body.innerHTML = head + table + cards + diff;
    }
    var teams = data.teams || [];
    $('teamBlock').hidden = !(lg.rules.teams && teams.length);
    $('teamList').innerHTML = teams.map(function (t) {
      return '<li><b>' + t.rank + '. ' + esc(t.team) + '</b><span class="' + tone(t.avgReturnPct) + '">' + esc(t.members ? pct(t.avgReturnPct) : '—') + '</span> <span>' + esc(T(t.members === 1 ? '{n} member · avg drawdown {dd}%' : '{n} members · avg drawdown {dd}%', { n: t.members, dd: num(t.avgDrawdownPct, 1) })) + '</span></li>';
    }).join('');
  }
  function onImport() {
    var lg = selected(), msg = $('importMsg');
    if (!lg) return;
    var codes = L.parseShareCodes($('importText').value);
    if (!codes.length) { flash(msg, T('No share codes found. Each one starts with "BT1.".'), 'err'); return; }
    Promise.all(codes.map(function (c) { return L.decodeShare(c); })).then(function (res) {
      var good = res.filter(function (r) { return r.ok; }).map(function (r) { return r.snapshot; });
      var bad = res.length - good.length;
      var out = L.importShares(lg.code, good);
      var noLeague = out.skipped;
      flash(msg, T('{a} added, {u} updated.', { a: out.added, u: out.updated }) +
        (noLeague ? ' ' + T('{n} had no results for this league (the member may not have joined it on that device).', { n: noLeague }) : '') +
        (bad ? ' ' + T('{n} could not be read; ask for a fresh copy.', { n: bad }) : ''), out.added + out.updated ? 'ok' : 'err');
      if (out.added + out.updated) $('importText').value = '';
      renderStandings();
    });
  }

  /* ------------------------------------------------------------------ *
   * Projector view
   * ------------------------------------------------------------------ */
  var proj = { open: false, slides: [], i: 0, paused: false, timer: null, tick: null, opener: null, lg: null };
  function buildSlides(lg, data) {
    var rows = data.rows || [], slides = [];
    var row = function (r, val) {
      return '<li><span class="r">' + r.rank + '</span><span class="n">' + esc(r.displayName || T('Anonymous')) + (r.team ? '<small>' + esc(r.team) + '</small>' : '') + '</span><span class="v ' + (r.returnPct > 0 ? 'up' : r.returnPct < 0 ? 'down' : '') + '">' + esc(val || pct(r.returnPct, 1)) + '</span></li>';
    };
    if (!rows.length) {
      slides.push({ title: lg.name, sub: rulesPills(lg).slice(0, 4).join(' · '), html: '<p class="proj-empty">' + esc(T('No results yet. Members join with the league code and their accounts appear here.')) + '</p><p class="proj-empty" style="font-family:var(--mono);color:#ffd166">' + esc(lg.code) + '</p>' });
      return slides;
    }
    for (var p = 0; p * ROWS_PER_SLIDE < rows.length && p < 6; p++) {
      var part = rows.slice(p * ROWS_PER_SLIDE, (p + 1) * ROWS_PER_SLIDE);
      slides.push({ title: lg.name, sub: rows.length > ROWS_PER_SLIDE ? T('Standings · places {a}–{b} of {n}', { a: p * ROWS_PER_SLIDE + 1, b: p * ROWS_PER_SLIDE + part.length, n: rows.length }) : (rankBy(lg) === 'return' ? T('Standings · by return') : rankBy(lg) === 'consistency' ? T('Standings · by consistency') : T('Standings · risk-adjusted')), html: '<ol class="proj-rows">' + part.map(function (r) { return row(r); }).join('') + '</ol>' });
    }
    var mv = L.movers(rows, { lookback: 5, count: 4 });
    if (mv.up.length || mv.down.length) {
      var list = function (arr) { return arr.length ? '<ol class="proj-rows">' + arr.map(function (m) { return '<li><span class="n">' + esc(m.row.displayName || T('Anonymous')) + '</span><span class="v ' + (m.changePct > 0 ? 'up' : 'down') + '">' + esc(pct(m.changePct, 1)) + '</span></li>'; }).join('') + '</ol>' : '<p class="proj-empty">—</p>'; };
      slides.push({ title: T('Biggest movers'), sub: T('Change over the last few equity points'), html: '<div class="proj-two"><div><h3>' + esc(T('Up')) + '</h3>' + list(mv.up) + '</div><div><h3>' + esc(T('Down')) + '</h3>' + list(mv.down) + '</div></div>' });
    }
    var steady = rows.filter(function (r) { return isNum(r.consistencyScore); }).slice().sort(function (a, b) { return b.consistencyScore - a.consistencyScore || a.maxDrawdownPct - b.maxDrawdownPct; }).slice(0, ROWS_PER_SLIDE);
    if (steady.length >= 2) {
      slides.push({ title: T('Steadiest traders'), sub: T('Consistency score (rising often, small drawdowns)'), html: '<ol class="proj-rows">' + steady.map(function (r, i) { return '<li><span class="r">' + (i + 1) + '</span><span class="n">' + esc(r.displayName || T('Anonymous')) + '</span><span class="v">' + r.consistencyScore + '</span></li>'; }).join('') + '</ol>' });
    }
    var teams = (data.teams || []).filter(function (t) { return t.members > 0; });
    if (lg.rules.teams && teams.length) {
      slides.push({ title: T('Team standings'), sub: T('Average return of each team'), html: '<ol class="proj-rows">' + teams.map(function (t) { return '<li><span class="r">' + t.rank + '</span><span class="n">' + esc(t.team) + '<small>' + esc(T(t.members === 1 ? '{n} member' : '{n} members', { n: t.members })) + '</small></span><span class="v ' + (t.avgReturnPct > 0 ? 'up' : t.avgReturnPct < 0 ? 'down' : '') + '">' + esc(pct(t.avgReturnPct, 1)) + '</span></li>'; }).join('') + '</ol>' });
    }
    return slides;
  }
  function paintSlide() {
    var s = proj.slides[proj.i] || { title: '', sub: '', html: '' };
    $('projTitle').textContent = s.title;
    $('projSub').textContent = s.sub;
    $('projBody').innerHTML = s.html;
    $('projDots').innerHTML = proj.slides.map(function (_, i) { return '<i' + (i === proj.i ? ' class="on"' : '') + '></i>'; }).join('');
    $('projClock').textContent = proj.lg ? L.countdown(proj.lg).label : '';
    restartBar();
  }
  function restartBar() {
    var bar = $('projBar');
    bar.classList.remove('run'); bar.style.transitionDuration = '0ms'; bar.style.width = '0';
    if (proj.paused || proj.slides.length < 2) return;
    void bar.offsetWidth;   // reflow so the transition restarts
    bar.classList.add('run'); bar.style.transitionDuration = SLIDE_MS + 'ms'; bar.style.width = '100%';
  }
  function schedule() {
    clearTimeout(proj.timer);
    if (!proj.open || proj.paused) return;
    proj.timer = setTimeout(function () { go(1, true); }, SLIDE_MS);
  }
  function go(step, auto) {
    if (!proj.slides.length) return;
    var next = proj.i + step;
    // Each time the rotation wraps, refresh the data so a projector left running stays current.
    if (auto && next >= proj.slides.length) { refreshProjector(true); return; }
    proj.i = (next + proj.slides.length) % proj.slides.length;
    paintSlide(); schedule();
  }
  function refreshProjector(fromStart) {
    var lg = proj.lg;
    if (!lg) return;
    loadRows(lg, { sync: false }).then(function (data) {
      if (!proj.open) return;
      proj.slides = buildSlides(lg, data);
      proj.i = fromStart ? 0 : Math.min(proj.i, proj.slides.length - 1);
      paintSlide(); schedule();
    });
  }
  function setPaused(p) {
    proj.paused = p;
    var b = $('projPause');
    b.textContent = p ? T('Play') : T('Pause');
    b.setAttribute('aria-label', p ? T('Resume auto-advance') : T('Pause auto-advance'));
    restartBar(); schedule();
  }
  function openProjector(code) {
    var lg = code ? L.get(code) : selected();
    if (!lg) { toast(T('Create or join a league first.'), 'warn'); return; }
    proj.lg = lg; proj.open = true; proj.i = 0; proj.opener = document.activeElement;
    $('proj').hidden = false;
    document.body.classList.add('proj-open');
    setPaused(false);
    proj.slides = [{ title: lg.name, sub: T('Loading standings…'), html: '' }];
    paintSlide();
    refreshProjector(true);
    clearInterval(proj.tick);
    proj.tick = setInterval(function () { if (proj.lg) $('projClock').textContent = L.countdown(proj.lg).label; }, 30000);
    $('projNext').focus();
    try { var u = new URL(location.href); u.searchParams.set('projector', '1'); u.searchParams.set('league', lg.code); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ }
  }
  function closeProjector() {
    if (!proj.open) return;
    proj.open = false;
    clearTimeout(proj.timer); clearInterval(proj.tick);
    $('proj').hidden = true;
    document.body.classList.remove('proj-open');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* ignore */ });
    try { var u = new URL(location.href); u.searchParams.delete('projector'); u.searchParams.delete('league'); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ }
    if (proj.opener && proj.opener.focus) proj.opener.focus();
  }
  function toggleFull() {
    var el = $('proj');
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(function () {}); }
    else if (el.requestFullscreen) el.requestFullscreen().catch(function () { toast(T('This browser blocked full screen. Use the browser\'s own full-screen key (often F11).'), 'warn'); });
  }
  function onProjKey(e) {
    if (!proj.open) return;
    var k = e.key;
    if (k === 'Escape') {
      // In browser full screen the first Escape is consumed by the browser; exit the view on the next one.
      e.preventDefault(); closeProjector(); return;
    }
    if (k === 'ArrowRight' || k === 'PageDown' || k === 'ArrowDown') { e.preventDefault(); go(1); return; }
    if (k === 'ArrowLeft' || k === 'PageUp' || k === 'ArrowUp') { e.preventDefault(); go(-1); return; }
    if ((k === ' ' || k === 'Spacebar') && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); setPaused(!proj.paused); return; }
    if (k === 'f' || k === 'F') { e.preventDefault(); toggleFull(); return; }
    if (k === 'Tab') {
      // keep focus inside the projector controls
      var f = Array.prototype.slice.call($('proj').querySelectorAll('button'));
      var idx = f.indexOf(document.activeElement);
      e.preventDefault();
      var n = e.shiftKey ? (idx <= 0 ? f.length - 1 : idx - 1) : (idx === f.length - 1 ? 0 : idx + 1);
      f[n].focus();
    }
  }

  /* ------------------------------------------------------------------ *
   * wiring
   * ------------------------------------------------------------------ */
  function renderAll() { renderMy(); renderStandingsSelect(); renderStandings(); }
  function init() {
    var pill = $('pillMode');
    if (online()) { pill.textContent = T('online: league server'); pill.className = 'pill live'; }
    renderPresets();
    $('cStart').value = dateKey(new Date()); applyPreset(preset);
    $('myList').addEventListener('click', onMyClick);
    $('joinCode').addEventListener('input', previewJoin);
    $('joinForm').addEventListener('submit', onJoin);
    $('createForm').addEventListener('submit', onCreate);
    $('cStart').addEventListener('change', function () {
      var p = L.PRESETS.filter(function (x) { return x.id === preset; })[0];
      if (p && $('cStart').value && (!$('cEnd').value || $('cEnd').value < $('cStart').value)) $('cEnd').value = L._internal.addDays($('cStart').value, p.days - 1);
    });
    $('copyCode').addEventListener('click', function () { copyText($('codeLong').value).then(function (ok) { flash($('codeMsg'), ok ? T('League code copied.') : T('Copy failed; select the code and copy it by hand.'), ok ? 'ok' : 'err'); }); });
    $('copyInvite').addEventListener('click', function () { var lg = L.get($('codeOut').dataset.code); if (lg) copyText(inviteText(lg)).then(function (ok) { flash($('codeMsg'), ok ? T('Invitation copied. Paste it into an email, the course page or a group chat.') : T('Copy failed.'), ok ? 'ok' : 'err'); }); });
    $('stLeague').addEventListener('change', function () { select($('stLeague').value); });
    $('stRefresh').addEventListener('click', renderStandings);
    $('stProjector').addEventListener('click', function () { openProjector(); });
    $('importBtn').addEventListener('click', onImport);
    $('clearImported').addEventListener('click', function () {
      var lg = selected(); if (!lg) return;
      if (!window.confirm(T('Remove every imported member from {name} on this device? Your own entry stays.', { name: lg.name }))) return;
      L.clearImported(lg.code); flash($('importMsg'), T('Imported members cleared.'), 'ok'); renderStandings();
    });
    $('projPrev').addEventListener('click', function () { go(-1); });
    $('projNext').addEventListener('click', function () { go(1); });
    $('projPause').addEventListener('click', function () { setPaused(!proj.paused); });
    $('projFull').addEventListener('click', toggleFull);
    $('projExit').addEventListener('click', closeProjector);
    document.addEventListener('keydown', onProjKey);
    document.addEventListener('visibilitychange', function () { if (proj.open && !document.hidden) refreshProjector(false); });
    window.addEventListener('storage', function (e) { if (e.key === L.KEY || (e.key && e.key.indexOf('bt.portfolio.league-') === 0)) { renderMy(); if (!proj.open) renderStandings(); } });
    // Countdowns tick once a minute.
    setInterval(function () { if (!document.hidden && !proj.open && !$('myList').contains(document.activeElement)) renderMy(); }, 60000);

    // Deep links: ?join=BTL1.… prefills the join box; ?projector=1&league=CODE opens the projector.
    var q = new URLSearchParams(location.search);
    var j = q.get('join');
    if (j) { $('joinCode').value = j; previewJoin(); }
    var code = L.normalizeCode(q.get('league') || '');
    if (code && L.get(code)) uiSet({ selected: code });
    renderAll();
    if (q.get('projector') === '1') openProjector(code && L.get(code) ? code : null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
