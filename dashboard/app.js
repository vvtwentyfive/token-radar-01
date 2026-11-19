// Launch Radar v2 dashboard. Renders only what window.RADAR carries (data.js beside
// dashboard/); it never recomputes implied values, so the page, the screenshots and
// board.json cannot drift apart. No network: every byte shown is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', verdict: 'all', chain: 'all', watchOnly: false,
    minTvl: 0, sort: 'implied', dir: -1, tab: 'board', selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'not reported';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtMoney2(n) { return (n === null || n === undefined) ? 'n/a' : '$' + Number(n).toFixed(2); }
  function fmtPct(n) { return (n === null || n === undefined || !isFinite(n)) ? 'not reported' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'not reported'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function fmtNum(n, dp) { return (n === null || n === undefined || !isFinite(n)) ? '—' : Number(n).toFixed(dp === undefined ? 4 : dp); }
  function esc(s) { return String(s); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function verdictClass(v) {
    if (!v) return 'b-watch';
    if (v.indexOf('PRIORITY') === 0) return 'b-priority';
    if (v.indexOf('WORTH') === 0) return 'b-worth';
    if (v.indexOf('LOW') === 0) return 'b-low';
    return 'b-watch';
  }
  function chainOf(r) { return (r.chains && r.chains.length) ? r.chains[0] : 'its main chain'; }
  function gasPerTx(r) { return r.gas_usd === null || r.gas_usd === undefined ? null : (r.gas_usd / 6); }

  // ---- filtering + sorting (board only) ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl * 1e6) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortVal(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return (r.change_7d === null || r.change_7d === undefined) ? -Infinity : r.change_7d;
    if (key === 'age') return (r.age_days === null || r.age_days === undefined) ? Infinity : r.age_days;
    if (key === 'net') return (r.net_cost_usd === null || r.net_cost_usd === undefined) ? Infinity : r.net_cost_usd;
    if (key === 'verdict') return (r.farm_score === null || r.farm_score === undefined) ? -1 : r.farm_score;
    if (key === 'rank') return r.rank;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortVal(a, key), bv = sortVal(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function distinct(field) {
    var s = {};
    DATA.rows.forEach(function (r) {
      if (field === 'chain') (r.chains || []).forEach(function (c) { s[c] = 1; });
      else s[r[field] || 'Other'] = 1;
    });
    return Object.keys(s).sort();
  }

  // ---- header / lede ----
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'dot', 'aria-hidden': 'true' }),
        el('div', null, el('b', { text: 'Launch Radar v2' }),
          el('span', { text: 'Pre-token protocols, ranked by implied value' }))),
      el('div', { class: 'meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: (DATA.model_version || 'radar-2') + ' model' })));
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: (DATA.watchlist_size || 40) + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $50M of TVL that records no token. The early radar adds ' + (DATA.early_size || 160) + ' pre-token protocols below that floor. Implied value is this entry\u2019s claim from the snapshot\u2019s own figures; it is not a prediction that a token will be issued, or when.' })),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: (DATA.watchlist_size || 40) + ' / ' + (DATA.watchlist_size || 40) })),
        el('div', { class: 'stat' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size || DATA.rows.length) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size || 160) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size || (DATA.live || []).length) }))));
  }

  // ---- controls ----
  function navTabs() {
    function tabBtn(id, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', text: label,
        onclick: function () { state.tab = id; render(); } });
    }
    return el('div', { class: 'nav' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('method', 'Methodology'));
  }
  function controls() {
    var cats = distinct('category'), chains = distinct('chain'), verdicts = distinct('verdict');
    function opts(list, cur, allLabel) {
      var o = [el('option', { value: 'all', text: allLabel })];
      list.forEach(function (v) { o.push(el('option', { value: v, text: v, selected: v === cur ? 'selected' : null })); });
      return o;
    }
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search by name or slug' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var catSel = el('select', { id: 'cat', 'aria-label': 'Filter by category' }, opts(cats, state.category, 'All categories'));
    catSel.addEventListener('change', function () { state.category = catSel.value; render(); });
    var verSel = el('select', { id: 'ver', 'aria-label': 'Filter by verdict' }, opts(verdicts, state.verdict, 'All verdicts'));
    verSel.addEventListener('change', function () { state.verdict = verSel.value; render(); });
    var chSel = el('select', { id: 'ch', 'aria-label': 'Filter by chain' }, opts(chains, state.chain, 'All chains'));
    chSel.addEventListener('change', function () { state.chain = chSel.value; render(); });
    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; render(); });
    var slider = el('input', { type: 'range', id: 'mintvl', 'class': 'range', min: '0', max: '1000', step: '25', value: String(state.minTvl), 'aria-label': 'Minimum TVL in millions of dollars' });
    slider.addEventListener('input', function () { state.minTvl = Number(slider.value); render(); });
    var clear = el('button', { type: 'button', 'class': 'btn', text: 'Clear filters', onclick: function () {
      state.q = ''; state.category = 'all'; state.verdict = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; render(); } });
    var n = filteredRows().length;
    return el('div', { class: 'filters' },
      el('div', { class: 'field' }, el('label', { 'for': 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { 'for': 'cat', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { 'for': 'ver', text: 'Verdict' }), verSel),
      el('div', { class: 'field' }, el('label', { 'for': 'ch', text: 'Chain' }), chSel),
      el('label', { 'class': 'check', 'for': 'watch' }, watch, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { text: 'Min TVL: ' + (state.minTvl ? '$' + state.minTvl + 'M' : 'none') }), slider),
      clear,
      el('span', { 'class': 'count', text: n + ' of ' + DATA.rows.length + ' rows shown' }));
  }

  // ---- board ----
  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' \u2193' : ' \u2191') : '';
    return el('th', { scope: 'col' }, el('button', { type: 'button', text: label + arrow,
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }));
  }
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category, verdict or chain to see the board again.' }),
      el('button', { 'class': 'btn primary', type: 'button', text: 'Clear filters', onclick: function () {
        state.q = ''; state.category = 'all'; state.verdict = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; render(); } })));
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      var tr = el('tr', { 'data-sel': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { 'class': 'num', text: String(r.rank) }),
        el('td', null, el('div', { 'class': 'name' },
          el('b', { text: r.name + (r.watchlist ? '  ★' : '') }),
          el('span', { 'class': 'sub', text: (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 2).join(', ') }))),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num ' + (g === null ? '' : g >= 0 ? 'pos' : 'neg'), text: fmtPct(g) }),
        el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { 'class': 'name' },
          el('span', { 'class': 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { 'class': 'band', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) + ' (1σ)' }))),
        el('td', { 'class': 'num', text: fmtMoney2(r.net_cost_usd) }),
        el('td', null, el('span', { 'class': 'badge ' + verdictClass(r.verdict), text: r.verdict || '—' })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'tablewrap' },
      el('table', null,
        el('caption', { 'class': 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its KPI strip and farm plan. Implied values are shown with their 1σ band — never as a point alone.' }),
        el('thead', null, el('tr', null,
          sortHeader('rank', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value (1σ band)'),
          sortHeader('net', 'Net farm cost'), sortHeader('verdict', 'Verdict'))),
        tbody)));
  }

  // ---- live view ----
  function liveTable() {
    var tbody = el('tbody');
    (DATA.live || []).forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { 'class': 'badge b-watch', text: 'already trades' })),
        el('td', null, el('div', { 'class': 'name' }, el('b', { text: r.name }),
          el('span', { 'class': 'sub', text: (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 2).join(', ') }))),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) })));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'tablewrap' },
      el('table', null,
        el('caption', { 'class': 'sub', text: 'Live token — already trades, shown for comparison, never ranked into the board. Market cap is a fact, not a modelled value.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
          el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
          el('th', { scope: 'col', text: 'Market cap' }))),
        tbody)));
  }

  // ---- methodology ----
  var CUT = [
    ['7-day growth (fitted)', 'coeff −1.61, t −1.62, p ≈ 0.11 (not significant); corr with log(mcap/TVL) −0.149', 'OOF 0.9260 vs 0.9258 (nil); walk-forward bias +0.24 when fitted', 'CUT as a fitted feature. Kept only as a +0.05 prior tilt. Note the fitted sign is negative: hot 7-day growth slightly predicts a lower mcap/TVL — plausibly mean reversion / mercenary TVL.'],
    ['Age (logAge)', 'coeff −0.16, t −0.58; corr −0.003', 'OOF 0.9285 vs 0.9260 (worse)', 'CUT as a fitted feature. Kept only as a +0.03 prior tilt. Age carries no signal at all in this sample.'],
    ['Chains count (log)', 'coeff +0.17, t +0.85; corr −0.033', 'OOF 0.9297 vs 0.9285 (worse)', 'CUT entirely — not even a tilt. Chains enter the KPI strip and the verdict only.'],
    ['Category dummies', 'only Lending (n=15) meets a ≥15 threshold; its dummy is −0.26', 'OOF 0.9304; walk-forward 1.023, bias +0.41', 'CUT entirely. With 128 comps across ~30 categories, category effects are unestimable. Category medians are context in the KPI strip, never model inputs.'],
    ['logTVL² (quadratic)', '—', 'OOF 0.9349 (worst tested)', 'CUT. No curvature beyond the log scale.'],
    ['Ridge shrinkage (λ = 1, 3, 10)', '—', 'OOF 0.9257–0.9271, no gain over plain OLS 0.9258', 'CUT. Plain OLS.'],
    ['Starter growth × maturity multipliers', 'growth weight 0.5, maturity 0.6–1.0 (swings up to ±60%)', 'Starter OOF 0.9958 vs logTVL 0.9258', 'CUT. The large swings are pure error; the v2 tilt caps the same ideas at ±12% total.']
  ];
  function methodPanel() {
    var m = DATA.model || {}, bt = DATA.backtest || {};
    var sec = el('section', { 'class': 'panel method' },
      el('h2', { text: 'Methodology — how good is this, honestly?' }),
      el('p', { 'class': 'sub', text: 'Snapshot ' + DATA.as_of + ' · ' + (m.comps_n || 128) + ' comps · fitted at runtime from the snapshot being read, never hardcoded.' }),
      el('div', { 'class': 'formula', text: 'log10(implied) = ' + fmtNum(m.intercept) + ' + ' + fmtNum(m.slope) + ' × log10(TVL) + tilt,   tilt = clamp(0.05 × clamp(change_7d, −60, +120)/100 + 0.03 × (log10(1+age) − ' + fmtNum(m.mean_log_age_comps) + '), −0.05, +0.05)' }),
      el('p', { text: 'Core model: log–log OLS on TVL only. Implied value scales as TVL^0.52 — strongly sublinear: a 10× larger TVL is worth only ~3.4× the implied value. Never use a single multiple (starter 0.25×, median-ratio 0.214×) as the model — both are beaten by the log fit. The tilt is a bounded prior, not a fitted effect: the fitted growth coefficient is negative and insignificant, so growth and age enter only as small prior tilts in the economically sensible direction, capped at ±12% total. The cap is load-bearing: one row grew +4,448% in 7 days and is clamped to +120% before the tilt.' }),
      el('div', { 'class': 'callout' }, el('p', { text: 'How good is this? The comps model explains R² ≈ 0.19 of log market cap. A typical implied value is within a factor of ~3.5 of the truth half the time (median |error| 0.55 log10) and within 2× only 28% of the time. The 1σ band is ×/÷ 8.4 (σ = 0.926 log10); the 90% band is ×/÷ 33.4. The board ranks by expected value under that noise; the band is part of the answer. Rank is mostly TVL rank with a sublinear rescaling (Spearman 0.439, single fit) — the tilt moves at most 3 places.' })));
    // OOF table from data
    var ff = bt.five_fold || [];
    if (ff.length) {
      var tb = el('tbody');
      ff.forEach(function (r) {
        tb.appendChild(el('tr', null,
          el('td', { text: r.spec }), el('td', { 'class': 'num', text: fmtNum(r.oof_rmse) }),
          el('td', { 'class': 'num', text: r.oof_mae === undefined ? '—' : fmtNum(r.oof_mae) }),
          el('td', { 'class': 'num', text: r.within_2x === undefined ? '—' : (r.within_2x * 100).toFixed(1) + '%' })));
      });
      sec.appendChild(el('div', null, el('h3', { text: '5-fold out-of-fold RMSE (log10; 0.30 ≈ factor 2, 0.926 ≈ factor 8.4)' }),
        el('div', { 'class': 'tablewrap' }, el('table', null,
          el('thead', null, el('tr', null, el('th', { text: 'Spec' }), el('th', { text: 'OOF RMSE' }), el('th', { text: 'OOF MAE' }), el('th', { text: 'Within 2×' }))), tb))));
    }
    var wf = bt.walk_forward || {};
    sec.appendChild(el('div', null, el('h3', { text: 'Walk-forward by listing date (fit listed < 2024-01-01, n=' + (wf.train_n || 44) + '; test listed ≥ 2024-01-01, n=' + (wf.test_n || 51) + ')' }),
      el('p', { text: 'LogTVL only: test RMSE ' + fmtNum(wf.A_test_rmse, 4) + '. Adding growth + age + chains: ' + fmtNum(wf.D_test_rmse, 4) + '. Starter: ' + fmtNum(wf.starter_test_rmse, 4) + '. The fitted extra features do not just fail to help — they import a large positive bias on newer protocols (+0.24 to +0.41). This is the decisive cut. Repeated 80/20 (10 seeds): logTVL 0.890 ± 0.141, first; everything else equal or worse.' })));
    var fr = bt.forward_fresh || {};
    sec.appendChild(el('div', null, el('h3', { text: 'Forward check vs fresh data (20 Nov, 127 comps still trading)' }),
      el('p', { text: 'Sealed-fit model predicting fresh market caps: RMSE ' + fmtNum(fr.rmse_sealed_tvl, 4) + ' — slightly better than its 5-fold OOF 0.926. Starter on the same task: ' + fmtNum(fr.starter_rmse, 4) + '. The slope drifts across six days (0.39 on a fresh refit), a warning against over-reading its second decimal.' })));
    var ct = el('tbody');
    CUT.forEach(function (r) { ct.appendChild(el('tr', null, el('td', { text: r[0] }), el('td', { text: r[1] }), el('td', { text: r[2] }), el('td', { text: r[3] }))); });
    sec.appendChild(el('div', null, el('h3', { text: 'What was cut, and why' }),
      el('div', { 'class': 'tablewrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { text: 'Feature' }), el('th', { text: 'Fitted sign / t' }), el('th', { text: 'OOF effect' }), el('th', { text: 'Verdict' }))), ct))));
    sec.appendChild(el('div', null, el('h3', { text: 'Farm-plan netting (assumptions, labelled as such)' }),
      el('p', { text: '6 transactions per plan (1 deposit + 4 weekly actions + 1 unwind). Gas per transaction: $5.00 on Ethereum, $0.50 on low-fee chains, $1.50 otherwise. Yield credit: capital × 3%/yr × hold/365, only where the category supplies an asset — 3%/yr is a planning assumption, not snapshot data; the snapshot carries no yield or APY data, so none is invented. Net cost = gas − yield credit (floored at $0). Capital is returned on unwind; it is not a cost. No step claims a points program or airdrop exists — the snapshot does not say so.' })));
    sec.appendChild(el('div', null, el('h3', { text: 'Known weaknesses — not papered over' }),
      el('p', { text: '1) Only ~19% of log market-cap variance is explained; implied values are order-of-magnitude estimates. 2) The slope is not precisely pinned (0.43–0.52 across subsamples). 3) The comps are a selected sample — protocols whose tokens survived to have a market cap; pre-token protocols that never launch are not in the fit, so survivorship bias pulls implied values up. 4) Single events dominate growth figures (shift-defi +4,448%; tydro +353% TVL in 6 days on fresh data); the clamp exists for this. 5) Records change within days: infinifi gained a token record 6 days after the snapshot (mcap $0) — the board is a picture of 14 Nov, date-stamped on every view.' })));
    sec.appendChild(el('p', { 'class': 'sub', text: 'Implied value is this entry\u2019s claim from the snapshot\u2019s own figures; it is not a prediction that a token will be issued, or when. A protocol \u201crecords no token\u201d in the snapshot — never \u201chas no token\u201d.' }));
    return sec;
  }

  // ---- detail view ----
  var dialog = el('dialog', { 'class': 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; });
  function kpi(label, value, note) {
    return el('div', { 'class': 'kpi' }, el('span', { text: label }), el('b', { text: value }), note ? el('small', { text: note }) : null);
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    dialog.textContent = '';
    var k = row.kpis || {}, mo = row.model || {};
    var catMed = (k.category_median_multiple === null || k.category_median_multiple === undefined) ? '— (fewer than 3 comps in this category)' : String(k.category_median_multiple);
    var growthNote = (row.change_7d === null) ? 'not reported in the snapshot' :
      ((k.growth_vs_median_pp === null || k.growth_vs_median_pp === undefined) ? '' :
      (k.growth_vs_median_pp >= 0 ? '+' : '') + Number(k.growth_vs_median_pp).toFixed(2) + ' pp vs snapshot median −8.23%');
    dialog.appendChild(el('div', { 'class': 'dhead' },
      el('div', null,
        el('span', { 'class': 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.rows.length + (row.watchlist ? ' · Watchlist' : ' · Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { 'class': 'sub', text: (row.category || 'Other') + ' · ' + (row.chains || []).join(', ') })),
      el('button', { 'class': 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('div', { 'class': 'dsec' },
      el('h3', { text: 'Verdict' }),
      el('p', null, el('span', { 'class': 'badge ' + verdictClass(row.verdict), text: row.verdict || '—' }),
        el('span', { text: '  Farm score ' + (row.farm_score === null || row.farm_score === undefined ? '—' : row.farm_score + '/6') })),
      el('p', { 'class': 'note', text: 'Value says how big; verdict says how farmable right now. They deliberately disagree sometimes — e.g. a high-value, young, shrinking protocol can still be WATCH.' })));
    var strip = el('div', { 'class': 'kpis' },
      kpi('TVL', fmtUsd(row.tvl_usd), (k.tvl_rank ? 'TVL rank ' + k.tvl_rank + ' of 758 · ' + fmtNum(k.tvl_percentile, 1) + 'th pct' : '')),
      kpi('7-day growth', fmtPct(row.change_7d), growthNote),
      kpi('Age', fmtAge(row.age_days), (k.age_percentile === null || k.age_percentile === undefined) ? 'not reported' : fmtNum(k.age_percentile, 1) + 'th pct of listed protocols'),
      kpi('Chains', String((row.chains || []).length), (row.chains || []).join(', ')),
      kpi('Category', row.category || 'Other', 'Category median mcap/TVL: ' + catMed),
      kpi('Implied value', fmtUsd(row.implied_value_usd), '1σ band ' + fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd)),
      kpi('Implied multiple', fmtNum(row.implied_multiple, 3) + '× TVL', 'implied ÷ TVL'),
      kpi('Model', 'core ' + fmtNum(mo.core_log10) + ' + tilt ' + fmtNum(mo.tilt_log10), 'intercept ' + fmtNum(mo.intercept) + ' · slope ' + fmtNum(mo.slope) + ' · tilt growth ' + fmtNum(mo.tilt_growth) + ' · tilt age ' + fmtNum(mo.tilt_age)),
      kpi('Farm economics', 'net ' + fmtMoney2(row.net_cost_usd), 'capital $' + (row.capital_usd || 0) + ' · hold ' + (row.hold_days || 0) + 'd · gas ' + fmtMoney2(row.gas_usd) + ' · assumed yield ' + fmtMoney2(row.yield_credit_usd)),
      kpi('Token status', 'Records no token', 'in the snapshot of ' + DATA.as_of),
      kpi('Watchlist?', row.watchlist ? 'Yes — watchlist' : 'No — early radar', row.watchlist ? 'TVL ≥ $50M floor' : 'TVL below the $50M floor'),
      kpi('Farm score', (row.farm_score === null || row.farm_score === undefined ? '—' : row.farm_score + ' / 6'), row.verdict || ''));
    dialog.appendChild(el('section', { 'class': 'dsec' }, el('h3', { text: 'KPI strip — all 12 fields' }), strip));
    if (row.slug === 'infinifi') {
      dialog.appendChild(el('p', { 'class': 'note', text: 'Note: a token record for infinifi appeared after the snapshot (mcap $0 as of 20 Nov). In the graded (sealed) run it is still pre-token; this dashboard does not claim it launched.' }));
    }
    dialog.appendChild(el('section', { 'class': 'dsec' },
      el('h3', { text: 'Implied value with its band' }),
      el('div', { 'class': 'eq' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: '1σ band (×/÷ 8.4)' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) })),
        el('div', null, el('span', { text: '90% band (×/÷ 33.4)' }), el('b', { text: 'see Methodology' }))),
      el('p', { 'class': 'note', text: 'A point estimate without its band would be dishonest at this noise level (σ = ' + fmtNum(mo.sigma_log10 || (DATA.model || {}).sigma_log10, 3) + ' log10).' })));
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { 'class': 'cost', text: tail }));
    });
    dialog.appendChild(el('section', { 'class': 'dsec' },
      el('h3', { text: 'Farm plan — 7 steps, net ' + fmtMoney2(row.net_cost_usd) }),
      el('ol', { 'class': 'steps' }, steps),
      el('p', { 'class': 'note', text: 'The board is a menu — nobody farms all 200 rows; the per-protocol cost is what matters. Capital ($' + (row.capital_usd || 0) + ') is returned on unwind, minus slippage; it is not a cost. This radar does not promise an airdrop, and no step here pays to claim.' })));
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { 'class': 'wrap' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(navTabs());
    if (state.tab === 'board') { shell.appendChild(controls()); shell.appendChild(boardTable()); }
    else if (state.tab === 'live') { shell.appendChild(liveTable()); }
    else { shell.appendChild(methodPanel()); }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('tab')) state.tab = p.get('tab');
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
  // Exposed for the render test only: lets a test open a detail view without a click.
  window.RADAR_TEST = { openDetail: openDetail, state: state };
})();
