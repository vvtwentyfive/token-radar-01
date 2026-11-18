// The radar's board builder: snapshot in, ranked board and dashboard data
// out. All scoring lives in the shared engine (dashboard/engine.js), which
// this module loads with createRequire so Node 22 runs it as-is alongside
// this TypeScript. The fit is computed once per snapshot; every row is
// scored by that one fit, so the board is one model's ranking, not a mix.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The engine's constants, as fitted-model parameters the dashboard states. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_extra: number;
}

/** The comparables fit, with honest leave-one-out errors and the baseline. */
export interface FitResult {
  intercept: number;
  slope: number;
  n: number;
  r2: number;
  resid_sd_log10: number;
  loo_rmse_log10: number;
  loo_mae_log10: number;
  base_rmse_log10: number;
  base_mae_log10: number;
}

/** One protocol's scored value under the fit. */
export interface ImpliedResult {
  implied: number;
  base: number;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  low: number;
  high: number;
  age_days: number | null;
}

/** One farm step as the engine builds it, before it becomes a string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  gas_usd: number;
  capital_usd: number;
  minutes: number;
  hold_days?: number;
}

/** The engine's public surface, as dashboard/engine.js exports it. */
export interface EngineApi {
  MODEL: ModelConstants;
  MODEL_VERSION: string;
  ageDays(asOf: string, listedAt: string | null): number | null;
  isPreToken(p: SnapshotProtocol): boolean;
  isRankable(p: SnapshotProtocol): boolean;
  fitComps(protocols: SnapshotProtocol[]): FitResult;
  impliedValue(p: SnapshotProtocol, asOf: string, fit: FitResult, model: ModelConstants): ImpliedResult;
  farmSteps(p: SnapshotProtocol, ageDaysValue: number | null): FarmStep[];
  stepText(step: FarmStep): string;
  planTotals(steps: FarmStep[]): { gas_usd: number; capital_usd: number; active_minutes: number; hold_days: number };
}

export const engine: EngineApi = require('../dashboard/engine.js') as EngineApi;
export const MODEL: ModelConstants = engine.MODEL;
export const MODEL_VERSION: string = engine.MODEL_VERSION;

/** One row of board.json: the ranked board's row, with its model breakdown. */
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
  token_status: 'pre-token';
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    fit_intercept: number;
    fit_slope: number;
    fit_n: number;
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the market's own value stands. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the board, the live set, the fit. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitResult;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  above_floor_off_watchlist: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** How many live-token protocols the dashboard's live view carries. */
export const LIVE_ROWS = 32;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** The snapshot out of a file's text, refused unless it is exactly the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot is not valid JSON');
  }
  if (!isRecord(raw)) throw new Error('snapshot must be a JSON object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of) || !Number.isFinite(Date.parse(`${raw.as_of}T00:00:00Z`))) {
    throw new Error('snapshot as_of must be a YYYY-MM-DD date');
  }
  if (typeof raw.source !== 'string' || raw.source.length === 0) throw new Error('snapshot source must be a non-empty string');
  if (typeof raw.floor_usd !== 'number' || !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) {
    throw new Error('snapshot floor_usd must be a positive whole number');
  }
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot protocols must be an array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) {
    throw new Error('snapshot watchlist must be an array of slug strings');
  }
  const seen = new Set<string>();
  const protocols: SnapshotProtocol[] = raw.protocols.map((v, i) => {
    if (!isRecord(v)) throw new Error(`snapshot protocol at index ${i} is not an object`);
    if (typeof v.slug !== 'string' || v.slug.length === 0) throw new Error(`snapshot protocol at index ${i} has no slug`);
    if (seen.has(v.slug)) throw new Error(`snapshot protocol slug ${v.slug} appears twice`);
    seen.add(v.slug);
    if (typeof v.name !== 'string' || v.name.length === 0) throw new Error(`snapshot protocol ${v.slug} has no name`);
    if (!isFiniteNumber(v.tvl_usd)) throw new Error(`snapshot protocol ${v.slug} has no finite tvl_usd`);
    if (!Array.isArray(v.chains) || v.chains.some((c) => typeof c !== 'string')) throw new Error(`snapshot protocol ${v.slug} has no chains array of strings`);
    if (!(v.category === null || typeof v.category === 'string')) throw new Error(`snapshot protocol ${v.slug} has a category that is neither a string nor null`);
    if (!(v.change_7d === null || isFiniteNumber(v.change_7d))) throw new Error(`snapshot protocol ${v.slug} has a change_7d that is neither a finite number nor null`);
    if (!(v.mcap_usd === null || isFiniteNumber(v.mcap_usd))) throw new Error(`snapshot protocol ${v.slug} has a mcap_usd that is neither a finite number nor null`);
    for (const key of ['listed_at', 'gecko_id', 'symbol'] as const) {
      if (!(v[key] === null || typeof v[key] === 'string')) throw new Error(`snapshot protocol ${v.slug} has a ${key} that is neither a string nor null`);
    }
    return {
      slug: v.slug,
      name: v.name,
      category: v.category as string | null,
      chains: v.chains as string[],
      tvl_usd: v.tvl_usd,
      change_7d: v.change_7d as number | null,
      mcap_usd: v.mcap_usd as number | null,
      listed_at: v.listed_at as string | null,
      gecko_id: v.gecko_id as string | null,
      symbol: v.symbol as string | null,
    };
  });
  for (const slug of raw.watchlist as string[]) {
    if (!seen.has(slug)) throw new Error(`snapshot watchlist names ${slug}, which is not among the protocols`);
  }
  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: raw.watchlist as string[],
  };
}

/** The board: every watchlist slug, plus every rankable protocol below the floor. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const fit = engine.fitComps(snapshot.protocols);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchSet = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && engine.isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, score: engine.impliedValue(p, snapshot.as_of, fit, MODEL) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.score.age_days,
    on_watchlist: watchSet.has(s.p.slug),
    implied_value_usd: s.score.implied,
    implied_low_usd: s.score.low,
    implied_high_usd: s.score.high,
    model: {
      fit_intercept: fit.intercept,
      fit_slope: fit.slope,
      fit_n: fit.n,
      base_usd: Math.round(s.score.base),
      growth_pct: s.score.growth_pct,
      growth_multiplier: round4(s.score.growth_mult),
      maturity_multiplier: round4(s.score.maturity_mult),
      breadth_multiplier: round4(s.score.breadth_mult),
      age_days: s.score.age_days,
    },
    farm_steps: engine.farmSteps(s.p, s.score.age_days).map((step) => engine.stepText(step)),
  }));
}

/** The live-token protocols, by market cap then TVL, kept apart from the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !engine.isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Pre-token protocols the exclusion rule sets aside, counted for transparency. */
export function setAsideCount(snapshot: Snapshot): number {
  return snapshot.protocols.filter((p) => engine.isPreToken(p) && !engine.isRankable(p)).length;
}

/** Everything the dashboard renders, from one snapshot and one fit. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const fit = engine.fitComps(snapshot.protocols);
  const watchSet = new Set(snapshot.watchlist);
  const aboveFloorOffWatchlist = snapshot.protocols.filter(
    (p) => p.tvl_usd >= snapshot.floor_usd && !watchSet.has(p.slug) && engine.isRankable(p),
  ).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    set_aside_size: setAsideCount(snapshot),
    above_floor_off_watchlist: aboveFloorOffWatchlist,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      base_usd: r.model.base_usd,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      on_watchlist: r.on_watchlist,
    })),
    live,
  };
  return { board, radar };
}

/** The first reason a board fails the gate, or null when it passes every check. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const inSnapshot = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice on the board`;
    seen.add(r.slug);
    if (!inSnapshot.has(r.slug)) return `slug ${r.slug} is not one of the snapshot's protocols`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..${board.length}: position ${i + 1} holds rank ${ranks[i]}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `rank ${byRank[i]!.rank} (${byRank[i]!.slug}) outranks rank ${byRank[i - 1]!.rank} on implied value`;
    }
  }
  if (board.length >= 2 && new Set(board.map((r) => r.implied_value_usd)).size === 1) {
    return `all ${board.length} rows share implied value ${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}, not a positive whole number within the cap`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} carries ${r.farm_steps.length} farm steps, not 3..12`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters once trimmed, not 20..600`;
    }
  }
  return null;
}

/** The dashboard's data as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
