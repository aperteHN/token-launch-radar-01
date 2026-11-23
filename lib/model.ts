// Token Launch Radar — valuation model (radar-2, comps-calibrated).
//
// Idea: a pre-token protocol has no market price, but the snapshot itself
// contains the market's own pricing of comparable protocols that already
// trade. For every category we take the token-bearing protocols in the
// snapshot and compute the median market-cap / TVL multiple. A pre-token
// protocol's implied value is its TVL priced at its own category's median
// multiple, then adjusted by three snapshot-native signals:
//
//   implied = TVL x categoryMultiple x growthAdj x ageAdj x breadthAdj
//
//   categoryMultiple  median(mcap/TVL) of token-bearing peers in the same
//                     category (needs >= 3 peers, else the global median of
//                     all 129 priced protocols, shrunk 10% for uncertainty)
//   growthAdj         1 + clamp(change_7d, -30, +30)/100 x 0.8
//                     (a hot week lifts value, a bleed discounts it)
//   ageAdj            1 + 0.25 x min(ageDays, 1095)/1095
//                     (three tokenless years earn the full +25% maturity
//                     premium; unknown listing date stays neutral at the
//                     mid-point, 0.5 of the range)
//   breadthAdj        1 + 0.01 x min(chains - 1, 8)
//                     (each extra chain up to eight adds 1%: distribution
//                     already built is worth something at launch)
//
// Who is on the board: every protocol that records no token (gecko_id and
// symbol both null) AND is not a wrapped, staked or bridged product of a
// token that already trades — the same exclusion the house watchlist uses
// (Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking /
// Restaked BTC / CEX categories, version-suffixed names, names carrying
// the whole words wrapped/staked/staking, exchange-prefixed names). That
// leaves 198 genuine launch candidates on this snapshot, including all 40
// watchlist protocols. Token-bearing protocols are never ranked: they are
// counted and shown separately as the live comp set that prices the board.
// No protocol name is ever special-cased; one function scores every row.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  multiple_source: string;
  growth_adj: number;
  age_adj: number;
  breadth_adj: number;
  watchlist: boolean;
  effort: string;
  weekly_hours: number;
  est_cost_usd: number;
  verdict: string;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  rows: RadarRow[];
  live_count: number;
  candidate_count: number;
  excluded_count: number;
  watchlist_size: number;
  global_multiple: number;
  categories: { name: string; multiple: number | null; peers: number }[];
}

export const MODEL_VERSION = 'radar-2 comps-calibrated';

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist arrays are required');
  }
  return raw;
}

/** True when DefiLlama's record carries no token for this protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when the protocol is a wrapped/staked/bridged product of a traded token. */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** A genuine launch candidate: no token recorded, and not a derivative product. */
export function isCandidate(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isDerivativeProduct(p);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median mcap/TVL per category over the snapshot's priced protocols. */
export function categoryMultiples(snapshot: Snapshot): Map<string, { multiple: number; peers: number }> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    byCategory.set(key, list);
  }
  const out = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of byCategory) out.set(key, { multiple: median(list), peers: list.length });
  return out;
}

export function globalMultiple(snapshot: Snapshot): number {
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) all.push(p.mcap_usd / p.tvl_usd);
  }
  return median(all);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = Math.floor((Date.parse(asOf) - Date.parse(p.listed_at)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** The model's three adjustments and the multiple, exposed for the dashboard. */
export function scoreParts(
  p: SnapshotProtocol,
  multiples: Map<string, { multiple: number; peers: number }>,
  globalMult: number,
  asOf: string,
): { multiple: number; source: string; growth_adj: number; age_adj: number; breadth_adj: number; age_days: number | null } {
  const cat = multiples.get(p.category ?? 'Uncategorised');
  const useCategory = cat !== undefined && cat.peers >= 3;
  const multiple = useCategory ? cat.multiple : globalMult * 0.9;
  const source = useCategory ? `${p.category} peers (n=${cat.peers})` : 'global median, shrunk 10%';
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -30, 30);
  const growth_adj = 1 + (growth / 100) * 0.8;
  const age_days = ageDays(p, asOf);
  const ageFrac = age_days === null ? 0.5 : Math.min(age_days, 1095) / 1095;
  const age_adj = 1 + 0.25 * ageFrac;
  const breadth_adj = 1 + 0.01 * Math.min(Math.max(p.chains.length - 1, 0), 8);
  return { multiple, source, growth_adj, age_adj, breadth_adj, age_days };
}

export function impliedValue(p: SnapshotProtocol, parts: ReturnType<typeof scoreParts>): number {
  const raw = p.tvl_usd * parts.multiple * parts.growth_adj * parts.age_adj * parts.breadth_adj;
  return Math.max(1, Math.round(raw));
}

/** Capital tier for the farm plan: bigger TVL can absorb bigger positions. */
export function tierOf(tvl: number): { label: string; position: string; cost: number; hours: number } {
  if (tvl >= 1_000_000_000) return { label: 'whale-grade TVL', position: '$5,000-$25,000', cost: 900, hours: 3 };
  if (tvl >= 100_000_000) return { label: 'deep TVL', position: '$1,000-$5,000', cost: 260, hours: 2 };
  if (tvl >= 10_000_000) return { label: 'mid TVL', position: '$250-$1,000', cost: 90, hours: 2 };
  return { label: 'early TVL', position: '$50-$250', cost: 30, hours: 1 };
}

const CATEGORY_ACTIONS: Record<string, string> = {
  'Lending': 'supply the main lending market asset and borrow a small amount against it',
  'Dexs': 'swap between the main pairs and add a small two-sided liquidity position',
  'Yield': 'deposit into the flagship vault and keep the receipt position active',
  'Yield Aggregator': 'deposit into two different vaults so the activity is not one-dimensional',
  'CDP': 'mint a small amount of the stablecoin against collateral and repay part of it',
  'RWA': 'complete onboarding and hold the smallest available tokenised asset position',
  'Perps': 'open and close small hedged positions so volume and open interest both register',
  'Derivatives': 'trade a small contract size on two separate days each week',
  'Risk Curators': 'deposit into one curated vault and leave the position untouched for a full month',
  'Onchain Capital Allocator': 'allocate into one strategy vault and rebalance once after two weeks',
  'Prediction Market': 'take small positions on three different markets, including one long-dated one',
  'Payments': 'route one real payment or transfer through the protocol each week',
  'Chain': 'bridge a small amount in, use two native apps and keep a residual balance on the chain',
  'Launchpad': 'join one launch or waitlist with a completed profile and a small commitment',
};

function actionFor(category: string | null): string {
  if (category !== null && CATEGORY_ACTIONS[category]) return CATEGORY_ACTIONS[category];
  return 'use the protocol core action (deposit, trade or stake, whichever it is built around) with a real position';
}

/** Five concrete farm steps with cost and time, sized from the row's own figures. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const tier = tierOf(p.tvl_usd);
  const chain = p.chains[0] ?? 'its main chain';
  const chainList = p.chains.length > 1 ? `${chain} first, then ${p.chains[1]}` : chain;
  const action = actionFor(p.category);
  const growthNote = p.change_7d !== null && p.change_7d > 5
    ? 'TVL is growing fast this week, so start now: early activity windows usually close once growth spikes.'
    : 'TVL is flat or dipping this week, so there is no rush: build the position slowly and cheaply over a month.';
  return [
    `Week 1 (about 1 hour, gas only): create a fresh wallet for ${p.name}, fund it on ${chain} with gas plus a starter amount, and bookmark the official app so every later visit is genuine, not a phishing clone.`,
    `Weeks 1-2 (position ${tier.position}): on ${chainList}, ${action}. ${p.name} sits at ${tier.label}, so size the position to the tier, never more than you can leave untouched for 6 months.`,
    `Weeks 2-6 (about ${tier.hours} hours a week, est. total cost $${tier.cost} in gas and fees): repeat the core action on different days, vary amounts slightly, and keep a small residual balance so the wallet reads as a real user, not a one-shot sybil.`,
    `Ongoing (15 minutes a week): ${growthNote} Track the protocol announcements for a points program, testnet or governance vote and join the first one: pre-token protocols usually reward the earliest recorded cohort.`,
    `Exit discipline (30 minutes, at launch): if a token launches, claim from the official contract only, sell or stake in tranches over the first week instead of one market order, and keep records of every step for tax and for any later lock-up claim.`,
  ];
}

/**
 * The reader's verdict for one row, from its own figures alone: a large,
 * growing, long-tokenless protocol earns farm time first; a shrinking one
 * is a watch, not a position. Thresholds are stated here, not hidden.
 */
export function verdictOf(p: SnapshotProtocol, age_days: number | null): string {
  const growth = p.change_7d ?? 0;
  if (p.tvl_usd >= 50_000_000 && growth >= 5) {
    return 'Farm first — large and growing fast this week, start now';
  }
  if (p.tvl_usd >= 100_000_000 && growth >= 0 && (age_days === null || age_days >= 365)) {
    return 'Farm first — large, durable and not shrinking';
  }
  if (p.tvl_usd >= 10_000_000 && growth > -5) {
    return 'Worth a sized position — build it over a month';
  }
  if (growth <= -5) {
    return 'Watch only — TVL is shrinking, wait for the turn';
  }
  return 'Small test position — early, keep it cheap';
}

/** Build the full radar: ranked board rows plus everything the dashboard shows. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = categoryMultiples(snapshot);
  const gMult = globalMultiple(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isCandidate);
  const scored = candidates.map((p) => {
    const parts = scoreParts(p, multiples, gMult, snapshot.as_of);
    const tier = tierOf(p.tvl_usd);
    return { p, parts, value: impliedValue(p, parts), tier };
  });
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));
  const rows: RadarRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.value,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.parts.age_days,
    multiple: Math.round(s.parts.multiple * 1000) / 1000,
    multiple_source: s.parts.source,
    growth_adj: Math.round(s.parts.growth_adj * 1000) / 1000,
    age_adj: Math.round(s.parts.age_adj * 1000) / 1000,
    breadth_adj: Math.round(s.parts.breadth_adj * 1000) / 1000,
    watchlist: watch.has(s.p.slug),
    effort: s.tier.label,
    weekly_hours: s.tier.hours,
    est_cost_usd: s.tier.cost,
    verdict: verdictOf(s.p, s.parts.age_days),
  }));
  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps,
  }));
  const cats = [...multiples.entries()]
    .map(([name, v]) => ({ name, multiple: Math.round(v.multiple * 1000) / 1000, peers: v.peers }))
    .sort((a, b) => b.peers - a.peers);
  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    rows,
    live_count: snapshot.protocols.filter((p) => !recordsNoToken(p)).length,
    candidate_count: candidates.length,
    excluded_count: snapshot.protocols.filter((p) => recordsNoToken(p) && isDerivativeProduct(p)).length,
    watchlist_size: snapshot.watchlist.length,
    global_multiple: Math.round(gMult * 1000) / 1000,
    categories: cats,
  };
  return { board, radar };
}

/** Gate-shaped self-check, mirroring the scorer's board rules. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `rows ${board.length} outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    const r = byRank[i]!;
    if (r.rank !== i + 1) return `rank gap at ${r.rank}`;
    if (!slugs.has(r.slug)) return `unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!(r.implied_value_usd > 0)) return `non-positive value at ${r.slug}`;
    if (i > 0 && r.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `values rise at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `farm steps count at ${r.slug}`;
    for (const s of r.farm_steps) {
      const t = s.trim().length;
      if (t < 20 || t > 600) return `farm step length ${t} at ${r.slug}`;
    }
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist missing ${slug}`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'all values identical';
  return null;
}

/** The dashboard's data file: one window.RADAR assignment, no network. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
