// lib/model.ts — token-radar-01 v2 model ("Launch Radar v2").
//
// A fresh implementation of MODEL-SPEC-tokenradar-v2.md. Node 22 standard
// library only, no network, deterministic: two runs on the same snapshot
// write byte-identical outputs.
//
// The model, in one paragraph: the implied value of a pre-token protocol is
// fitted from the snapshot itself. Over the token-bearing protocols with a
// positive market cap ("comps"), log10(market cap) is regressed on
// log10(TVL) by ordinary least squares at runtime — nothing about the fit
// is hardcoded. A small bounded prior tilt (±0.05 in log10, at most ±12%)
// then rewards faster 7-day TVL growth and longer survival, because the
// fitted growth and age effects are insignificant and wrong-signed, so they
// are kept only as a disclosed prior, never as fitted features. The 1-sigma
// band comes from the 5-fold out-of-fold RMSE of the core fit, recomputed
// at runtime with a fixed seed-0 shuffle.
//
// Farm plans are deposit-sized and netted: a capital tier by TVL, a hold
// window by age, gas by first chain, and an assumed 3%/yr supply yield
// where the category supplies an asset (labelled as an assumption — the
// snapshot carries no yield data). No step ever claims an airdrop or a
// points program exists.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface ModelFit {
  /** Intercept of log10(mcap) on log10(TVL), fitted at runtime. */
  intercept: number;
  /** Slope of log10(mcap) on log10(TVL), fitted at runtime. */
  slope: number;
  /** In-sample R^2 of the core fit. */
  r2: number;
  /** Number of comps the fit used. */
  compsN: number;
  /** 5-fold out-of-fold RMSE of the core fit, in log10 (also the band sigma). */
  oofRmse: number;
  /** Band half-width in log10; equals oofRmse except on the fallback path. */
  sigma: number;
  /** Mean log10(1 + age_days) over comps (unknown age counts as 365 days). */
  meanLogAge: number;
  /** Median mcap/TVL over comps. */
  medianRatio: number;
  /** True only when the comps set was too thin to fit OLS (never on the sealed snapshot). */
  fallback: boolean;
}

export interface Implied {
  value: number;
  low: number;
  high: number;
  coreLog10: number;
  tiltLog10: number;
  tiltGrowth: number;
  tiltAge: number;
}

export interface FarmEconomics {
  capitalUsd: number;
  holdDays: number;
  gasPerTx: number;
  gasUsd: number;
  yieldCreditUsd: number;
  netCostUsd: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  implied_multiple: number;
  model: {
    intercept: number;
    slope: number;
    core_log10: number;
    tilt_log10: number;
    tilt_growth: number;
    tilt_age: number;
    sigma_log10: number;
  };
  verdict: string;
  farm_score: number;
  capital_usd: number;
  hold_days: number;
  gas_usd: number;
  yield_credit_usd: number;
  net_cost_usd: number;
  kpis: {
    tvl_rank: number;
    tvl_percentile: number;
    growth_vs_median_pp: number | null;
    age_percentile: number | null;
    category_median_multiple: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: Record<string, unknown>;
  backtest: Record<string, unknown>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

// ------------------------------------------------------------------ constants
// These are structural choices from the spec, not fitted values: tilt
// weights and cap, the growth clamp, the unknown-age stand-in, the capital
// tiers, the gas table and the 3%/yr planning yield. Each is labelled as a
// chosen constant in the dashboard methodology.

const TILT_GROWTH_WEIGHT = 0.05;
const TILT_AGE_WEIGHT = 0.03;
const TILT_CAP = 0.05;
const GROWTH_CLAMP_LO = -60;
const GROWTH_CLAMP_HI = 120;
const UNKNOWN_AGE_DAYS = 365;

/** A name ending in a version marker ("V2", "v3", "2.0", ...): not rankable. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Chains whose per-transaction gas is taken as $0.50 in the farm plan. */
const LOW_FEE_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Polygon', 'Blast', 'Linea',
  'Scroll', 'Ink', 'Unichain', 'Berachain', 'Plume Mainnet', 'Pharos',
  'Stellar', 'Flare', 'Arc', 'Mezo', 'Noble', 'Algorand', 'Bittensor',
  'Solana', 'Tron', 'Ripple', 'Bitcoin', 'BSquared', 'Avalanche', 'Sui',
  'Hyperliquid L1',
]);

/** Categories whose position is assumed to earn a 3%/yr supply yield. */
const YIELD_BEARING = new Set([
  'Lending', 'Yield', 'Dexs', 'CDP', 'Risk Curators',
  'Onchain Capital Allocator', 'Restaking', 'Liquid Staking',
  'Yield Aggregator', 'Stablecoin Wrapper', 'RWA', 'CeDeFi',
  'Basis Trading', 'Staking Pool', 'Collateral Markets',
  'Leveraged Farming',
]);

// ------------------------------------------------------------------ helpers

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

const roundDp = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Parse a "YYYY-MM-DD" UTC day; null when it is not a day. */
function dayMs(day: string | null): number | null {
  if (day === null || day === undefined) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

// ------------------------------------------------------------------ snapshot

/** Parse and minimally validate the sealed snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('parseSnapshot: the snapshot is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || typeof o.source !== 'string') {
    throw new Error('parseSnapshot: the snapshot has no as_of/source strings');
  }
  if (typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols)) {
    throw new Error('parseSnapshot: the snapshot has no floor_usd/protocols');
  }
  if (!Array.isArray(o.watchlist) || !o.watchlist.every((s) => typeof s === 'string')) {
    throw new Error('parseSnapshot: the snapshot has no string watchlist');
  }
  return o as unknown as Snapshot;
}

/** True when the snapshot records no token at all for the protocol. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * True when the protocol may be ranked into the early radar: pre-token,
 * not a CEX, and its name does not end in a version marker.
 */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name ?? '');
}

/** Days from listed_at to as_of (UTC days), clamped at 0; null when unknown. */
export function ageDays(p: Protocol, asOf: string): number | null {
  const asOfMs = dayMs(asOf);
  const listedMs = dayMs(p.listed_at);
  if (asOfMs === null || listedMs === null) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / 86_400_000));
}

function logAge(p: Protocol, asOf: string): number {
  return Math.log10(1 + (ageDays(p, asOf) ?? UNKNOWN_AGE_DAYS));
}

// ------------------------------------------------------------------ MT19937
// The 5-fold out-of-fold RMSE uses a fixed seed-0 shuffle, matching the
// reference procedure (NumPy legacy RandomState(0): MT19937 seeded with
// init_genrand(0), Fisher-Yates driven by the masked-rejection interval
// draw). Reimplemented here from the public MT19937 description so the
// shipped code needs no dependency; verified against the reference
// permutation and against the spec's OOF RMSE 0.9258 on the sealed snapshot.

const MT_N = 624;
const MT_M = 397;

function mt19937Seed0(): { nextUint32: () => number } {
  const state = new Uint32Array(MT_N);
  state[0] = 0;
  for (let i = 1; i < MT_N; i++) {
    const prev = state[i - 1]!;
    state[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
  }
  let index = MT_N;
  const twist = (): void => {
    for (let i = 0; i < MT_N; i++) {
      const y = ((state[i]! & 0x80000000) | (state[(i + 1) % MT_N]! & 0x7fffffff)) >>> 0;
      let v = state[(i + MT_M) % MT_N]! ^ (y >>> 1);
      if ((y & 1) !== 0) v ^= 0x9908b0df;
      state[i] = v >>> 0;
    }
    index = 0;
  };
  return {
    nextUint32(): number {
      if (index >= MT_N) twist();
      let y = state[index++]!;
      y ^= y >>> 11;
      y ^= (y << 7) & 0x9d2c5680;
      y ^= (y << 15) & 0xefc60000;
      y ^= y >>> 18;
      return y >>> 0;
    },
  };
}

/** Uniform integer in [0, max): masked rejection, as the reference does. */
function interval(rng: { nextUint32: () => number }, max: number): number {
  if (max <= 0) return 0;
  let mask = max - 1;
  mask |= mask >>> 1;
  mask |= mask >>> 2;
  mask |= mask >>> 4;
  mask |= mask >>> 8;
  mask |= mask >>> 16;
  for (;;) {
    const v = rng.nextUint32() & mask;
    if (v < max) return v;
  }
}

/** Seed-0 Fisher-Yates shuffle of 0..n-1. */
function shuffledIndices(n: number): number[] {
  const rng = mt19937Seed0();
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = interval(rng, i + 1);
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}

// ------------------------------------------------------------------ the fit

interface Ols {
  intercept: number;
  slope: number;
}

function ols(xs: number[], ys: number[]): Ols {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxy += dx * (ys[i]! - my);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/** 5-fold out-of-fold RMSE of the log-log core, seed-0 shuffle, sklearn-sized folds. */
function oofRmse(xs: number[], ys: number[]): number {
  const n = xs.length;
  const order = shuffledIndices(n);
  const base = Math.floor(n / 5);
  const rem = n % 5;
  const sizes = [0, 1, 2, 3, 4].map((k) => base + (k < rem ? 1 : 0));
  let se = 0;
  let at = 0;
  for (const size of sizes) {
    const test = order.slice(at, at + size);
    at += size;
    const inTest = new Set(test);
    const train = order.filter((i) => !inTest.has(i));
    const fit = ols(
      train.map((i) => xs[i]!),
      train.map((i) => ys[i]!),
    );
    for (const i of test) {
      const e = ys[i]! - (fit.intercept + fit.slope * xs[i]!);
      se += e * e;
    }
  }
  return Math.sqrt(se / n);
}

function fitModel(snapshot: Snapshot): ModelFit {
  const comps = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd);
  const medianRatio = ratios.length > 0 ? median(ratios) : 0.25;
  const meanLogAge =
    comps.length > 0
      ? comps.reduce((s, p) => s + logAge(p, snapshot.as_of), 0) / comps.length
      : Math.log10(1 + UNKNOWN_AGE_DAYS);

  if (comps.length >= 10) {
    const xs = comps.map((p) => Math.log10(p.tvl_usd));
    const ys = comps.map((p) => Math.log10(p.mcap_usd!));
    const fit = ols(xs, ys);
    let ssRes = 0;
    let ssTot = 0;
    const my = ys.reduce((s, y) => s + y, 0) / ys.length;
    for (let i = 0; i < ys.length; i++) {
      const pred = fit.intercept + fit.slope * xs[i]!;
      ssRes += (ys[i]! - pred) ** 2;
      ssTot += (ys[i]! - my) ** 2;
    }
    const sigma = oofRmse(xs, ys);
    return {
      intercept: fit.intercept,
      slope: fit.slope,
      r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
      compsN: comps.length,
      oofRmse: sigma,
      sigma,
      meanLogAge,
      medianRatio,
      fallback: false,
    };
  }

  // Degenerate-input fallback (never triggers on the sealed snapshot):
  // no fit is possible, so the implied value is TVL times the median
  // comps multiple, or 0.25x when there are no usable comps at all.
  const ratio = comps.length > 0 ? medianRatio : 0.25;
  process.stdout.write(
    `token radar: fallback fit: only ${comps.length} usable comps, ` +
      `using implied = TVL x ${ratio} (no OLS fit)\n`,
  );
  return {
    intercept: Math.log10(ratio),
    slope: 1,
    r2: 0,
    compsN: comps.length,
    oofRmse: 0.926,
    sigma: 0.926,
    meanLogAge,
    medianRatio: ratio,
    fallback: true,
  };
}

// ------------------------------------------------------------------ implied value

/** The implied value of one protocol under the fitted model (never hardcoded). */
export function impliedValue(p: Protocol, fit: ModelFit, asOf: string): Implied {
  const core = fit.intercept + fit.slope * Math.log10(p.tvl_usd);
  const growth = clamp(p.change_7d ?? 0, GROWTH_CLAMP_LO, GROWTH_CLAMP_HI) / 100;
  const tiltGrowth = TILT_GROWTH_WEIGHT * growth;
  const tiltAge = TILT_AGE_WEIGHT * (logAge(p, asOf) - fit.meanLogAge);
  const tilt = clamp(tiltGrowth + tiltAge, -TILT_CAP, TILT_CAP);
  // The band is taken from the unrounded value, as the spec's worked
  // examples are: low/high of the rounded value differ by a dollar or two.
  const unrounded = 10 ** (core + tilt);
  const factor = 10 ** fit.sigma;
  return {
    value: Math.max(1, Math.round(unrounded)),
    low: Math.max(1, Math.round(unrounded / factor)),
    high: Math.round(unrounded * factor),
    coreLog10: core,
    tiltLog10: tilt,
    tiltGrowth,
    tiltAge,
  };
}

// ------------------------------------------------------------------ farm plan

/** Capital tier, hold window, gas and netting for one protocol. */
export function farmEconomics(p: Protocol, asOf: string): FarmEconomics {
  const tvl = p.tvl_usd;
  const capitalUsd =
    tvl >= 1_000_000_000 ? 250 : tvl >= 250_000_000 ? 150 : tvl >= 100_000_000 ? 100 : 50;
  const age = ageDays(p, asOf);
  const holdDays = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const firstChain = (p.chains ?? [])[0] ?? null;
  const gasPerTx =
    firstChain === 'Ethereum' ? 5.0 : firstChain !== null && LOW_FEE_CHAINS.has(firstChain) ? 0.5 : 1.5;
  const gasUsd = roundDp(6 * gasPerTx, 2);
  const yieldCreditUsd =
    p.category !== null && YIELD_BEARING.has(p.category)
      ? roundDp((capitalUsd * 0.03 * holdDays) / 365, 2)
      : 0;
  const netCostUsd = Math.max(0, roundDp(gasUsd - yieldCreditUsd, 2));
  return { capitalUsd, holdDays, gasPerTx, gasUsd, yieldCreditUsd, netCostUsd };
}

/** Step 2's action, by category; first matching rule wins. */
function categoryAction(p: Protocol, capitalUsd: number, firstChain: string): string {
  const cat = p.category ?? '';
  const k = `$${capitalUsd}`;
  const n = p.name;
  if (/lending|cdp|collateral/i.test(cat)) {
    return `Supply ${k} of USDC to ${n} on ${firstChain} as collateral and keep the position open.`;
  }
  if (/dexs|yield|leveraged farming/i.test(cat)) {
    return `Provide ${k} of liquidity to ${n}'s main pool on ${firstChain} and keep the position open.`;
  }
  if (/bridge/i.test(cat)) {
    return `Bridge ${k} of USDC to ${firstChain} through ${n} and use the bridged funds in its app.`;
  }
  if (/liquid staking|restaking|restaked btc|staking pool/i.test(cat)) {
    return `Stake ${k} of the chain's staking asset through ${n} on ${firstChain} and keep the receipt token.`;
  }
  if (/derivatives|perpetual|options/i.test(cat)) {
    return `Deposit ${k} of USDC as margin on ${n} on ${firstChain} and open one small hedged position.`;
  }
  if (/prediction market/i.test(cat)) {
    return `Fund ${k} and place one market position on ${n} on ${firstChain}.`;
  }
  if (/risk curators|onchain capital allocator/i.test(cat)) {
    return `Deposit ${k} into a ${n} vault on ${firstChain} and keep the vault shares.`;
  }
  if (/stablecoin wrapper|stablecoin issuer|cdp manager/i.test(cat)) {
    return `Mint or deposit ${k} of the stable asset through ${n} on ${firstChain} and hold it.`;
  }
  if (/rwa/i.test(cat)) {
    return `Mint ${k} of ${n}'s yield asset on ${firstChain} and hold it.`;
  }
  if (/insurance/i.test(cat)) {
    return `Buy ${k} of cover from ${n} on ${firstChain} and keep the policy.`;
  }
  if (/chain|payments/i.test(cat)) {
    return (
      `Use ${n} on ${firstChain} with ${k}: move funds through it in two separate weeks ` +
      `and keep the receipts. There is no deposit surface to farm here.`
    );
  }
  if (/governance incentives/i.test(cat)) {
    return `Deposit ${k} into ${n}'s incentives pool on ${firstChain} and vote once while the position is open.`;
  }
  if (/yield aggregator|farm|indexes/i.test(cat)) {
    return `Deposit ${k} into ${n}'s main vault on ${firstChain} and keep the shares for the full hold.`;
  }
  if (/basis trading/i.test(cat)) {
    return `Deposit ${k} of USDC into ${n}'s basis vault on ${firstChain} and keep the position open.`;
  }
  if (/cedefi/i.test(cat)) {
    return `Deposit ${k} of USDC into ${n}'s earn product on ${firstChain} and keep the position open.`;
  }
  return `Deposit ${k} of USDC into ${n} on ${firstChain} and keep the position open.`;
}

/**
 * The 7 farm steps for one protocol. Every step ends with
 * "Cost: <...>. Time: <...>.", is 20-600 chars, and never claims an
 * airdrop or a points program exists.
 */
export function farmSteps(p: Protocol, asOf: string): string[] {
  const econ = farmEconomics(p, asOf);
  const firstChain = (p.chains ?? [])[0] ?? 'its main chain';
  const k = `$${econ.capitalUsd}`;
  const gas = `$${econ.gasUsd.toFixed(2)}`;
  const perTx = `$${econ.gasPerTx.toFixed(2)}`;
  const yld = `$${econ.yieldCreditUsd.toFixed(2)}`;
  const net = `$${econ.netCostUsd.toFixed(2)}`;
  const act = categoryAction(p, econ.capitalUsd, firstChain);
  return [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ' +
      'Never reuse an exchange withdrawal address for farming. ' +
      'Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    `${act} Cost: ${k} of capital and about ${gas} of gas in total across the plan. Time: 15 minutes to set up.`,
    `Make one qualifying action each week on ${p.name} — a deposit, a borrow, a swap or a vote — ` +
      `so the wallet shows repeated use, not a single deposit. ` +
      `Cost: about ${perTx} of gas a week on ${firstChain}. Time: 10 minutes a week.`,
    `Hold the position for at least ${econ.holdDays} days so the activity is counted in more than one snapshot, ` +
      `and do not withdraw early. Cost: the ${k} stays in the position; it is returned on unwind. ` +
      `Time: ${econ.holdDays} days.`,
    `Before you withdraw, open ${p.name}'s own points or rewards page from the link the protocol itself publishes ` +
      `and check whether anything is claimable. This radar does not promise an airdrop, and no step here pays to claim. ` +
      `Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    'Unwind the position in one transaction, keep a small dust balance only if you plan to return, ' +
      `and record the exit date. Cost: about ${perTx} of gas. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log, and total the plan: ` +
      `${k} capital returned, ${gas} gas, ${yld} assumed yield, net cost ${net}. ` +
      `Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

// ------------------------------------------------------------------ verdict

/** Farm score 0-6 and its label. Display only — never used for ranking. */
export function verdict(p: Protocol, asOf: string): { score: number; label: string } {
  let score = 0;
  if (p.tvl_usd >= 250_000_000) score += 2;
  else if (p.tvl_usd >= 100_000_000) score += 1;
  const change = p.change_7d ?? 0;
  if (change > 0) score += 1;
  if (change > 5) score += 1;
  const age = ageDays(p, asOf);
  if (age !== null && age >= 365) score += 1;
  if ((p.chains ?? []).length >= 3) score += 1;
  const label =
    score >= 5
      ? 'PRIORITY — farm first'
      : score >= 3
        ? 'WORTH FARMING'
        : score >= 1
          ? 'WATCH — small position only'
          : 'LOW PRIORITY — monitor';
  return { score, label };
}

// ------------------------------------------------------------------ board

interface Analysis {
  fit: ModelFit;
  board: BoardRow[];
  live: LiveRow[];
  earlySize: number;
}

function analyse(snapshot: Snapshot): Analysis {
  const fit = fitModel(snapshot);
  const asOf = snapshot.as_of;
  const watchlist = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  // TVL rank among every protocol in the snapshot (1 = largest).
  const byTvl = [...snapshot.protocols].sort((a, b) =>
    b.tvl_usd !== a.tvl_usd ? b.tvl_usd - a.tvl_usd : a.slug < b.slug ? -1 : 1,
  );
  const tvlRank = new Map(byTvl.map((p, i) => [p.slug, i + 1]));
  const nAll = snapshot.protocols.length;

  // Snapshot medians the KPI strip quotes.
  const growths = snapshot.protocols
    .map((p) => p.change_7d)
    .filter((g): g is number => g !== null);
  const growthMedian = growths.length > 0 ? median(growths) : 0;
  const ages = snapshot.protocols
    .map((p) => ageDays(p, asOf))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);

  // Category median mcap/TVL over comps (only where a category has >= 3).
  const comps = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const byCategory = new Map<string, number[]>();
  for (const p of comps) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(p.category, list);
  }
  const categoryMedian = new Map<string, number>();
  for (const [cat, ratios] of [...byCategory.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (ratios.length >= 3) categoryMedian.set(cat, roundDp(median(ratios), 4));
  }

  const rowFor = (p: Protocol): BoardRow => {
    const imp = impliedValue(p, fit, asOf);
    const econ = farmEconomics(p, asOf);
    const v = verdict(p, asOf);
    const age = ageDays(p, asOf);
    const rank = tvlRank.get(p.slug) ?? nAll;
    return {
      rank: 0, // assigned after the sort
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...(p.chains ?? [])],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      watchlist: watchlist.has(p.slug),
      age_days: age,
      implied_value_usd: imp.value,
      implied_low_usd: imp.low,
      implied_high_usd: imp.high,
      implied_multiple: roundDp(imp.value / p.tvl_usd, 4),
      model: {
        intercept: roundDp(fit.intercept, 4),
        slope: roundDp(fit.slope, 4),
        core_log10: roundDp(imp.coreLog10, 4),
        tilt_log10: roundDp(imp.tiltLog10, 4),
        tilt_growth: roundDp(imp.tiltGrowth, 4),
        tilt_age: roundDp(imp.tiltAge, 4),
        sigma_log10: roundDp(fit.sigma, 3),
      },
      verdict: v.label,
      farm_score: v.score,
      capital_usd: econ.capitalUsd,
      hold_days: econ.holdDays,
      gas_usd: econ.gasUsd,
      yield_credit_usd: econ.yieldCreditUsd,
      net_cost_usd: econ.netCostUsd,
      kpis: {
        tvl_rank: rank,
        tvl_percentile: roundDp(((nAll - rank) / nAll) * 100, 1),
        growth_vs_median_pp:
          p.change_7d === null ? null : roundDp(p.change_7d - growthMedian, 2),
        age_percentile:
          age === null
            ? null
            : roundDp((ages.filter((a) => a < age).length / ages.length) * 100, 1),
        category_median_multiple:
          p.category !== null ? (categoryMedian.get(p.category) ?? null) : null,
      },
      farm_steps: farmSteps(p, asOf),
    };
  };

  // The board: every watchlist slug present in the snapshot, plus the top
  // 160 rankable pre-token protocols below the floor, by final implied
  // value. Live-token protocols are never ranked into the board.
  const chosen: Protocol[] = [];
  const seen = new Set<string>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p === undefined) {
      throw new Error(`buildBoard: watchlist slug ${slug} is not in the snapshot`);
    }
    chosen.push(p);
    seen.add(slug);
  }
  const early = snapshot.protocols
    .filter((p) => !seen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, value: impliedValue(p, fit, asOf).value }))
    .sort((a, b) => (b.value !== a.value ? b.value - a.value : a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, 160)
    .map((e) => e.p);
  for (const p of early) chosen.push(p);

  const board = chosen
    .map(rowFor)
    .sort((a, b) =>
      b.implied_value_usd !== a.implied_value_usd
        ? b.implied_value_usd - a.implied_value_usd
        : a.slug < b.slug
          ? -1
          : 1,
    );
  board.forEach((row, i) => {
    row.rank = i + 1;
  });

  // The live view: the top 24 token-bearing protocols (not CEX) at market
  // value — shown for comparison, never ranked, never modelled.
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) =>
      b.mcap_usd! !== a.mcap_usd!
        ? b.mcap_usd! - a.mcap_usd!
        : a.slug < b.slug
          ? -1
          : 1,
    )
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...(p.chains ?? [])],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));

  return { fit, board, live, earlySize: early.length };
}

/** The 200-row ranked board for a snapshot. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  return analyse(snapshot).board;
}

/** The board plus the dashboard data (model, backtest, live view). */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { fit, board, live, earlySize } = analyse(snapshot);
  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-2',
    model: {
      kind: 'log-log OLS on TVL + bounded prior tilt',
      intercept: roundDp(fit.intercept, 4),
      slope: roundDp(fit.slope, 4),
      comps_n: fit.compsN,
      oof_rmse_log10: roundDp(fit.oofRmse, 3),
      sigma_log10: roundDp(fit.sigma, 3),
      r2_in_sample: roundDp(fit.r2, 3),
      tilt_growth_weight: TILT_GROWTH_WEIGHT,
      tilt_age_weight: TILT_AGE_WEIGHT,
      tilt_cap_log10: TILT_CAP,
      growth_clamp: [GROWTH_CLAMP_LO, GROWTH_CLAMP_HI],
      unknown_age_days: UNKNOWN_AGE_DAYS,
      mean_log_age_comps: roundDp(fit.meanLogAge, 4),
      median_mcap_tvl_comps: roundDp(fit.medianRatio, 4),
      fallback_used: fit.fallback,
    },
    backtest: {
      five_fold: [
        { spec: 'A logTVL only', oof_rmse: 0.9258, oof_mae: 0.7079, within_2x: 0.281 },
        { spec: 'B A + growth (clamped)', oof_rmse: 0.926, oof_mae: 0.7155, within_2x: 0.258 },
        { spec: 'C B + logAge', oof_rmse: 0.9285, oof_mae: 0.7166, within_2x: 0.281 },
        { spec: 'D C + logChains', oof_rmse: 0.9297, oof_mae: 0.7205, within_2x: 0.266 },
        { spec: 'E D + category dummies (>=15 comps)', oof_rmse: 0.9304, oof_mae: 0.7176, within_2x: 0.289 },
        { spec: 'Starter (0.25x TVL x growth x maturity)', oof_rmse: 0.9958, oof_mae: 0.7726, within_2x: 0.297 },
        { spec: 'Median-ratio (mcap = 0.2138x TVL)', oof_rmse: 0.9889, oof_mae: 0.7667, within_2x: 0.352 },
        { spec: 'FINAL (A + capped tilt)', oof_rmse: 0.927, oof_mae: null, within_2x: null },
      ],
      walk_forward: {
        train_n: 44,
        test_n: 51,
        A_test_rmse: 0.8937,
        D_test_rmse: 0.9361,
        starter_test_rmse: 1.0276,
      },
      forward_fresh: {
        n: 127,
        rmse_sealed_tvl: 0.9141,
        rmse_fresh_tvl: 0.9577,
        starter_rmse: 1.0073,
      },
      note: 'Full table in the methodology panel; numbers are from the sealed snapshot except forward_fresh (20 Nov fetch).',
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/**
 * The first gate rule a board breaks, or null when it is valid: 100-4000
 * rows, ranks exactly 1..N once each, implied values non-increasing with
 * rank, slugs unique and in the snapshot, every watchlist slug covered,
 * farm_steps 3-12 strings of 20-600 chars each, implied values positive
 * whole dollars, and not a board that ranks nothing (all values equal).
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board holds ${board.length} rows, under the 100-row floor`;
  if (board.length > 4000) return `board holds ${board.length} rows, over the 4000-row cap`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = [...board.map((r) => r.rank)].sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..${board.length} (rank ${ranks[i]} at position ${i + 1})`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  let firstValue: number | null = null;
  let allEqual = true;
  for (let i = 0; i < byRank.length; i++) {
    const row = byRank[i]!;
    if (!slugs.has(row.slug)) return `row ${row.rank} names ${row.slug}, not a snapshot protocol`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (typeof row.name !== 'string' || row.name.length === 0) {
      return `row ${row.rank} has no name`;
    }
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.rank} (${row.slug}) has no positive whole-dollar implied value`;
    }
    if (firstValue === null) firstValue = row.implied_value_usd;
    else if (row.implied_value_usd !== firstValue) allEqual = false;
    if (i > 0 && row.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `implied value rises from rank ${byRank[i - 1]!.rank} to rank ${row.rank}`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.rank} (${row.slug}) holds ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 0} farm steps, not 3-12`;
    }
    for (const step of row.farm_steps) {
      const len = typeof step === 'string' ? step.trim().length : 0;
      if (len < 20 || len > 600) {
        return `row ${row.rank} (${row.slug}) has a farm step of ${len} chars, not 20-600`;
      }
    }
  }
  if (allEqual) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one statement, the board rows verbatim. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
