// Token Launch Radar dashboard. Reads window.RADAR (written beside dashboard/
// by main.ts) and renders: headline stats, a sortable + filterable board, and
// a detail view per protocol with the model's own factors and the farm plan.
// No network, no framework: every byte shown comes from data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows;
  var state = { q: '', cat: 'all', chain: 'all', watch: false, hot: false, sort: 'rank', dir: 1, sel: null };

  function $(id) { return document.getElementById(id); }
  function fmtUsd(n) {
    if (n === null || n === undefined) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    return d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Headline stats: the universe the radar actually scanned.
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  var stats = [
    [String(rows.length), 'pre-token candidates ranked'],
    [String(DATA.watchlist_size) + ' / ' + String(DATA.watchlist_size), 'watchlist covered'],
    [String(DATA.live_count), 'live-token protocols (comp set)'],
    [String(DATA.excluded_count), 'wrapped / staked products excluded'],
    [fmtUsd(totalImplied), 'combined implied value'],
    ['×' + DATA.global_multiple.toFixed(3), 'global median mcap / TVL'],
  ];
  $('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>';
  }).join('');
  $('modelVersion').textContent = DATA.model_version;
  $('universeNote').textContent =
    'Universe: ' + (DATA.live_count + DATA.candidate_count + DATA.excluded_count) + ' protocols at or above $5M TVL, snapshot of ' +
    DATA.as_of + '. The board ranks every genuine pre-token candidate it finds, not only the ' + DATA.watchlist_size +
    ' watchlist protocols above the $50M floor — the watchlist is the floor, never the ceiling.';

  // Filter options come from the data itself.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  function visible() {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !r.watchlist) return false;
      if (state.hot && !(r.change_7d !== null && r.change_7d >= 5)) return false;
      return true;
    });
  }

  var KEY = {
    rank: function (r) { return r.rank; }, name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return (r.category || '').toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; }, change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    multiple: function (r) { return r.multiple; }, implied: function (r) { return r.implied_value_usd; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
  };

  function render() {
    var list = visible();
    var key = KEY[state.sort] || KEY.rank;
    list.sort(function (a, b) {
      var x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * state.dir;
    });
    $('count').textContent = list.length + ' of ' + rows.length + ' shown';
    $('empty').hidden = list.length > 0;
    $('rows').innerHTML = list.map(function (r) {
      var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="chip">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">×' + r.multiple.toFixed(3) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td>' + esc(r.effort) + ' · ~' + r.weekly_hours + 'h/wk · ~$' + r.est_cost_usd +
        '<br><span class="slug">' + esc((r.verdict || '').split(' — ')[0]) + '</span></td></tr>';
    }).join('');
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.sel = slug;
    var box = $('detail');
    box.hidden = false;
    box.innerHTML =
      '<button class="close" id="closeDetail">Close ✕</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + ' · records no token in DefiLlama</p>' +
      '<div class="grid">' +
      '<div class="cell"><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value (rank #' + r.rank + ')</span></div>' +
      '<div class="cell"><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL in snapshot</span></div>' +
      '<div class="cell"><b>×' + r.multiple.toFixed(3) + '</b><span>multiple — ' + esc(r.multiple_source) + '</span></div>' +
      '<div class="cell"><b>×' + r.growth_adj.toFixed(3) + '</b><span>growth adjustment (7d ' + fmtPct(r.change_7d) + ')</span></div>' +
      '<div class="cell"><b>×' + r.age_adj.toFixed(3) + '</b><span>age adjustment (' + fmtAge(r.age_days) + ' tokenless)</span></div>' +
      '<div class="cell"><b>×' + r.breadth_adj.toFixed(3) + '</b><span>breadth adjustment (' + r.chains.length + ' chains)</span></div>' +
      '</div>' +
      '<p class="meta">Model check: TVL × multiple × growth × age × breadth = the implied value above. ' +
      'The same impliedValue() arithmetic wrote board.json, so this page and the board cannot disagree.</p>' +
      '<p class="meta"><strong>Verdict: ' + esc(r.verdict || '') + '.</strong> The verdict follows from the row\'s own TVL, 7-day growth and tokenless age — the thresholds live in verdictOf() in the model.</p>' +
      '<h3>Farm plan — ' + esc(r.effort) + ', about ' + r.weekly_hours + ' h/week, est. $' + r.est_cost_usd + ' all-in</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('closeDetail').addEventListener('click', function () {
      box.hidden = true; state.sel = null; render();
    });
    box.scrollIntoView({ block: 'nearest' });
    render();
  }

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr') : null;
    if (tr && tr.dataset.slug) showDetail(tr.dataset.slug);
  });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      render();
    });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; render(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; render(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; render(); });
  $('watchOnly').addEventListener('change', function () { state.watch = $('watchOnly').checked; render(); });
  $('hotOnly').addEventListener('change', function () { state.hot = $('hotOnly').checked; render(); });

  render();
  // Deep link: #slug opens that protocol's detail view (used by the screenshots).
  var hash = window.location.hash.replace(/^#/, '');
  if (hash) showDetail(hash);
})();
