// RadarEngine: shared model engine, pure deterministic JS (no DOM, no
// network, no clock, no randomness). Required by lib/model.ts in Node;
// globalThis.RadarEngine in the dashboard page. Values are fitted from the
// snapshot itself (log10 mcap on log10 TVL over live comparables); no name
// is special-cased. Plans never claim a points program or airdrop exists.
var MODEL = { growth_weight: 0.6, growth_floor: -50, growth_cap: 150,
  maturity_floor: 0.55, maturity_range: 0.45, maturity_days: 1460,
  unknown_age_days: 300, breadth_step: 0.03, breadth_max_extra: 4 };
var MODEL_VERSION = 'radar-comps-1';
var EXCLUDED = { Bridge: 1, 'Canonical Bridge': 1, 'Liquid Staking': 1,
  'Liquid Restaking': 1, 'Restaked BTC': 1, CEX: 1 };
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
var WRAPSTAKE = /\b(wrapped|staked|staking)\b/i;
var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function ageDays(asOf, listedAt) {
  if (listedAt === null || listedAt === undefined) return null;
  var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86400000));
}
function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
function badName(p) { return VERSIONED.test(p.name) || WRAPSTAKE.test(p.name) || EXCHANGE.test(p.name); }
// isRankable applies the house watchlist's own exclusion rule (snapshot
// field guide) to every row: wrapped, staked and bridged products of a
// token that already trades are not protocols awaiting a launch.
function isRankable(p) { return isPreToken(p) && !EXCLUDED[p.category] && !badName(p); }
function ols(xs, ys) {
  var n = xs.length, mx = 0, my = 0, sxx = 0, sxy = 0, i;
  for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); }
  var s = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - s * mx, slope: s };
}
function median(v) {
  var s = v.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// OLS over live-token comparables; LOO refits (or re-medians) leaving each
// comp out, so the errors are honest out-of-sample figures, not in-sample.
function fitComps(protocols) {
  var comps = protocols.filter(function (p) {
    return p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !EXCLUDED[p.category] && !badName(p);
  });
  var xs = comps.map(function (p) { return Math.log10(p.tvl_usd); });
  var ys = comps.map(function (p) { return Math.log10(p.mcap_usd); });
  var n = comps.length;
  var z = { intercept: 0, slope: 0, n: n, r2: 0, resid_sd_log10: 0, loo_rmse_log10: 0,
    loo_mae_log10: 0, base_rmse_log10: 0, base_mae_log10: 0 };
  if (n < 2) return z;
  var f = ols(xs, ys), sse = 0, sst = 0, my = 0, i, r;
  for (i = 0; i < n; i++) my += ys[i];
  my /= n;
  for (i = 0; i < n; i++) { r = ys[i] - (f.intercept + f.slope * xs[i]); sse += r * r; sst += (ys[i] - my) * (ys[i] - my); }
  var lse = 0, lae = 0, bse = 0, bae = 0;
  var ratios = comps.map(function (p) { return p.mcap_usd / p.tvl_usd; });
  for (i = 0; i < n; i++) {
    var g = ols(xs.slice(0, i).concat(xs.slice(i + 1)), ys.slice(0, i).concat(ys.slice(i + 1)));
    var e = (g.intercept + g.slope * xs[i]) - ys[i];
    lse += e * e; lae += Math.abs(e);
    var be = Math.log10(comps[i].tvl_usd * median(ratios.slice(0, i).concat(ratios.slice(i + 1)))) - ys[i];
    bse += be * be; bae += Math.abs(be);
  }
  return { intercept: f.intercept, slope: f.slope, n: n, r2: sst === 0 ? 0 : 1 - sse / sst,
    resid_sd_log10: n > 2 ? Math.sqrt(sse / (n - 2)) : 0, loo_rmse_log10: Math.sqrt(lse / n),
    loo_mae_log10: lae / n, base_rmse_log10: Math.sqrt(bse / n), base_mae_log10: bae / n };
}
function impliedValue(p, asOf, fit, model) {
  var m = model || MODEL;
  var raw = (typeof p.change_7d === 'number' && isFinite(p.change_7d)) ? p.change_7d : 0;
  var gp = clamp(raw, m.growth_floor, m.growth_cap);
  var gm = 1 + (gp / 100) * m.growth_weight;
  var age = ageDays(asOf, p.listed_at);
  var used = age === null ? m.unknown_age_days : age;
  var mm = m.maturity_floor + (clamp(used, 0, m.maturity_days) / m.maturity_days) * m.maturity_range;
  var ch = Array.isArray(p.chains) ? p.chains : [];
  var bm = 1 + m.breadth_step * clamp(ch.length - 1, 0, m.breadth_max_extra);
  var base = Math.pow(10, fit.intercept + fit.slope * Math.log10(p.tvl_usd));
  var imp = Math.max(1, Math.round(base * gm * mm * bm));
  var sd = fit.resid_sd_log10, lo = imp, hi = imp;
  if (typeof sd === 'number' && isFinite(sd) && sd > 0) {
    lo = Math.max(1, Math.round(imp * Math.pow(10, -sd)));
    hi = Math.round(imp * Math.pow(10, sd));
  }
  return { implied: imp, base: base, growth_pct: gp, growth_mult: gm,
    maturity_mult: mm, breadth_mult: bm, low: lo, high: hi, age_days: age };
}
function money(n) { return '$' + (Math.round(n) === n ? String(n) : n.toFixed(2)); }
function gasPerTx(chain) {
  var c = String(chain || '').toLowerCase();
  if (c.indexOf('ethereum') !== -1) return 9;
  if (/base|arbitrum|optimism|plasma|zksync|starknet|scroll|linea|mode|blast|mantle|opbnb/.test(c)) return 0.5;
  return 2;
}
function capitalTier(t) { return t >= 5e9 ? 300 : t >= 1e9 ? 200 : t >= 1e8 ? 120 : 60; }
function holdWindow(a) { return (a === null || a === undefined) ? 60 : a < 180 ? 75 : a < 365 ? 60 : 45; }
// Core action in the category's own verbs (%C capital, %N name, %H chain).
function coreAction(p, cap, chain) {
  var c = String(p.category || '').toLowerCase(), t;
  if (c.indexOf('bridge') !== -1) t = 'Send %C of USDC through %N from %H to another chain it serves, then bring it back days later so both legs are recorded.';
  else if (c.indexOf('stak') !== -1) t = 'Stake %C of the staking asset through %N on %H, keep the receipt token in the fresh wallet, and do not unstake before the hold ends.';
  else if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateral') !== -1) t = 'Supply %C of USDC to %N\'s lending market on %H and leave it supplied; if you borrow, keep the loan under a third of the collateral.';
  else if (c.indexOf('dex') !== -1 || c.indexOf('liquidity') !== -1) t = 'Add %C of liquidity to %N\'s deepest pool on %H in a balanced pair and keep the LP tokens in the fresh wallet.';
  else if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1 || c.indexOf('vault') !== -1 || c.indexOf('aggregator') !== -1 || c.indexOf('index') !== -1) t = 'Deposit %C of USDC into one %N vault on %H, keep the vault shares in the fresh wallet, and leave it untouched for the hold window.';
  else if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('option') !== -1 || c.indexOf('synthetic') !== -1) t = 'Deposit %C of USDC as margin on %N on %H, open one small hedged position at 2x leverage or less, and close it within a week.';
  else if (c.indexOf('prediction') !== -1) t = 'Fund %C on %N on %H and take one position in a market settling within the month, sized so a loss costs at most %Q.';
  else if (c.indexOf('stable') !== -1) t = 'Mint or buy %C of %N\'s stable asset on %H, hold it in the fresh wallet, and use it once in the protocol\'s own app.';
  else if (c.indexOf('rwa') !== -1) t = 'Mint %C of %N\'s tokenised asset on %H, hold it in the fresh wallet, and read the redemption terms on its own page first.';
  else if (c.indexOf('insurance') !== -1) t = 'Buy %C of cover from %N on %H for a protocol you actually use, keep the policy active for the hold window, and note its expiry.';
  else if (c.indexOf('yield') !== -1 || c.indexOf('farm') !== -1 || c.indexOf('basis') !== -1) t = 'Deposit %C of USDC into %N\'s main yield strategy on %H, claim or compound weekly, and keep the deposit in place for the hold.';
  else t = 'Deposit %C of USDC into %N on %H through its main feature, keep the receipt in the fresh wallet, and leave it for the hold window.';
  return t.split('%C').join(money(cap)).split('%Q').join(money(Math.round(cap / 4))).split('%N').join(p.name).split('%H').join(chain);
}
function st(text, cost, time, gas, cap, min, hold) {
  var s = { text: text, cost: cost, time: time, gas_usd: gas, capital_usd: cap, minutes: min };
  if (hold) s.hold_days = hold;
  return s;
}
// Exactly 8 steps. Capital counts once, at the core action (plus the
// smaller second position); the weekly step carries a 4-week block; only
// the hold step carries hold_days, which planTotals reads as the window.
function farmSteps(p, age) {
  var ch = Array.isArray(p.chains) ? p.chains : [];
  var chain = ch.length > 0 ? ch[0] : 'its main chain';
  var tx = gasPerTx(chain), cap = capitalTier(p.tvl_usd), hold = holdWindow(age);
  var buf = Math.ceil(tx * 3), steps = [
    st('Create a fresh wallet only for ' + p.name + ', write its recovery phrase on paper and store it offline, then send a $1 test transfer on ' + chain + '.',
      'the $1 test transfer plus about ' + money(tx) + ' of gas', '10 minutes', tx, 0, 10),
    st('Fund the fresh wallet on ' + chain + ' with ' + money(cap) + ' of USDC plus ' + money(buf) + ' for gas, and confirm the full balance arrived before touching ' + p.name + '.',
      money(cap) + ' of capital plus ' + money(buf) + ' held for gas', '15 minutes', 0, 0, 15),
    st(coreAction(p, cap, chain),
      money(cap) + ' of capital and about ' + money(tx * 2) + ' of gas for two transactions', '20 minutes to set up', tx * 2, cap, 20)
  ];
  if (ch.length > 1) {
    var half = Math.max(10, Math.round(cap / 2));
    steps.push(st('Open a second position of ' + money(half) + ' on ' + ch[1] + ' through ' + p.name + ' with the same wallet, repeating the core action, so activity shows on two chains.',
      money(half) + ' of extra capital and about ' + money(tx * 2) + ' of gas for the bridge and deposit', '20 minutes', tx * 2, half, 20));
  } else {
    steps.push(st('Make a second kind of interaction with ' + p.name + ' on ' + chain + ' from the same wallet: a $10 deposit into another pool, or a vote if one is live.',
      '$10 of extra capital and about ' + money(tx) + ' of gas', '15 minutes', tx, 10, 15));
  }
  var why = (age === null || age === undefined) ? 'No listing date is reported, so this uses the standard window' : p.name + ' has been tracked for ' + age + ' days';
  steps.push(
    st('Once a week for 4 weeks, return to ' + p.name + ' on ' + chain + ' for one real interaction: a small deposit, a claim, a vote, or a rebalance.',
      'about ' + money(tx) + ' of gas each week', '10 minutes a week for 4 weeks', tx * 4, 0, 40),
    st('Hold the main position at least ' + hold + ' days from the first deposit. ' + why + '; staying in across several weekly snapshots matters more than the entry day.',
      'the ' + money(cap) + ' stays in the position', hold + ' days', 0, 0, 5, hold),
    st('Check ' + p.name + '\'s own website and docs for a points or rewards page, and claim only through a link that page publishes. Never pay to claim, ignore DM links, and revoke approvals you no longer need.',
      'nothing to check; about ' + money(tx) + ' of gas to revoke one approval', '10 minutes', tx, 0, 10),
    st('Log the wallet, dates, amounts and transaction hashes in one note. Exit only after the hold ends: withdraw in two parts a week apart, confirm each landed, and keep the log for a year.',
      'about ' + money(tx) + ' of gas to unwind', '10 minutes plus a week between the two withdrawals', tx, 0, 10));
  return steps;
}
function stepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s += ' Keep the position open and re-check the protocol\'s own page before acting.';
  return s;
}
function planTotals(steps) {
  var gas = 0, cap = 0, min = 0, hold = 0;
  for (var i = 0; i < steps.length; i++) {
    gas += steps[i].gas_usd || 0; cap += steps[i].capital_usd || 0; min += steps[i].minutes || 0;
    if (steps[i].hold_days > hold) hold = steps[i].hold_days;
  }
  return { gas_usd: Math.round(gas * 100) / 100, capital_usd: cap, active_minutes: min, hold_days: hold };
}
var api = { MODEL: MODEL, MODEL_VERSION: MODEL_VERSION, ageDays: ageDays,
  isPreToken: isPreToken, isRankable: isRankable, fitComps: fitComps,
  impliedValue: impliedValue, farmSteps: farmSteps, stepText: stepText,
  planTotals: planTotals };
if (typeof module === 'object' && module.exports) module.exports = api;
globalThis.RadarEngine = api;
