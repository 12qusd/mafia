/**
 * Glicko-2 rating math + the Nocturne RANK ladder (ranked play, goal: MMR).
 *
 * BUILD_SPEC §17 deferred competitive ratings to Phase B; this is that system.
 * Everything here is PURE — no I/O, no `Date.now`, no `Math.random` — so it is
 * unit-testable against published Glicko-2 reference values and identical on
 * server and (for preview) client. The server is the only authority that
 * PERSISTS ratings (the `onGameOver` ranked hook); guests and bots get none.
 *
 * Reference: Glickman, "Example of the Glicko-2 system" (Boston University,
 * 2013). The constants and the worked example there are the test oracle.
 *
 * Two scales are in play:
 *  - the "Glicko" scale players SEE (rating ~1500, rd ~350): {@link Glicko};
 *  - the internal Glicko-2 scale (mu, phi) the iteration runs on.
 * `toGlicko2` / `fromGlicko2` convert between them. {@link updateRating} folds a
 * whole rating period (one or more game results) in one step.
 *
 * SEPARATE from the lifetime POINTS ladder (`points.ts`, drifter→kingpin): that
 * is a cosmetic status symbol off total points; THIS is the competitive rank off
 * MMR. Do not conflate them — the names are deliberately distinct.
 */

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Default starting rating (the Glicko/MMR scale players see). */
export const DEFAULT_RATING = 1500;
/** Default starting rating deviation (uncertainty), Glicko scale. */
export const DEFAULT_RD = 350;
/** Default starting volatility (expected fluctuation), Glicko-2 scale. */
export const DEFAULT_VOL = 0.06;

/**
 * The Glicko-2 system constant `tau`: it constrains how much the volatility can
 * change between rating periods. Smaller ⇒ steadier ratings. Reasonable values
 * are 0.3–1.2; we use 0.5 (the value Glickman uses in the worked example, and a
 * common default for games with moderate result noise).
 */
export const TAU = 0.5;

/** Convergence tolerance for the volatility iteration (Glickman uses 1e-6). */
const EPSILON = 0.000001;

/** The 173.7178 scale factor between the Glicko and Glicko-2 rating scales. */
const SCALE = 173.7178;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** A rating on the visible Glicko scale (what we persist + display). */
export interface Glicko {
  /** Rating (MMR), ~1500 at start. */
  rating: number;
  /** Rating deviation (uncertainty), ~350 at start. */
  rd: number;
  /** Volatility (Glicko-2 scale), ~0.06 at start. */
  vol: number;
}

/** A single opponent in a rating period: their rating/rd + the score vs them. */
export interface GlickoOpponent {
  rating: number;
  rd: number;
  /** Game result vs this opponent from the subject's view: 1 win, 0 loss, 0.5 draw. */
  score: number;
}

// --------------------------------------------------------------------------
// Scale conversions
// --------------------------------------------------------------------------

/** Convert a visible-scale rating to the internal Glicko-2 scale. */
export function toGlicko2(g: Glicko): { mu: number; phi: number; sigma: number } {
  return {
    mu: (g.rating - DEFAULT_RATING) / SCALE,
    phi: g.rd / SCALE,
    sigma: g.vol,
  };
}

/** Convert an internal Glicko-2 rating back to the visible scale. */
export function fromGlicko2(g: { mu: number; phi: number; sigma: number }): Glicko {
  return {
    rating: g.mu * SCALE + DEFAULT_RATING,
    rd: g.phi * SCALE,
    vol: g.sigma,
  };
}

// --------------------------------------------------------------------------
// Glicko-2 math (Glickman 2013, step by step)
// --------------------------------------------------------------------------

/** g(phi): the deviation-weighting factor for an opponent. */
function gFn(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(mu, mu_j, phi_j): expected score vs an opponent. */
function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-gFn(phiJ) * (mu - muJ)));
}

/**
 * Solve for the new volatility sigma' via Glickman's Illinois-algorithm
 * iteration (the worked-example procedure). Pure and bounded.
 */
function newVolatility(phi: number, v: number, delta: number, sigma: number): number {
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const tau2 = TAU * TAU;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta2 - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / tau2;
  };

  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let iter = 0;
  while (Math.abs(B - A) > EPSILON && iter < 1000) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    iter += 1;
  }
  return Math.exp(A / 2);
}

/**
 * Apply one Glicko-2 rating period to `player` given the results against one or
 * more `opponents`. Pure: same inputs ⇒ same output. With zero opponents the
 * player did not play; only their RD increases (uncertainty grows), per the
 * "did not compete" rule.
 */
export function updateRating(player: Glicko, opponents: readonly GlickoOpponent[]): Glicko {
  const self = toGlicko2(player);
  const { mu, phi, sigma } = self;

  // Did-not-compete: RD grows by the volatility step, rating/vol unchanged.
  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return fromGlicko2({ mu, phi: phiStar, sigma });
  }

  // Step 3: estimated variance `v` from game outcomes.
  let vInv = 0;
  // Step 4 numerator accumulator (delta = v * sum).
  let deltaSum = 0;
  for (const opp of opponents) {
    const o = toGlicko2({ rating: opp.rating, rd: opp.rd, vol: DEFAULT_VOL });
    const gj = gFn(o.phi);
    const ej = expectedScore(mu, o.mu, o.phi);
    vInv += gj * gj * ej * (1 - ej);
    deltaSum += gj * (opp.score - ej);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility.
  const sigmaPrime = newVolatility(phi, v, delta, sigma);

  // Step 6: pre-rating-period RD.
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: new RD and rating.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return fromGlicko2({ mu: muPrime, phi: phiPrime, sigma: sigmaPrime });
}

// --------------------------------------------------------------------------
// The Nocturne RANK ladder (visible competitive standing off MMR)
// --------------------------------------------------------------------------
//
// Noir / Prohibition-era underworld ranks, ORIGINAL and deliberately distinct
// from the lifetime-points tiers (drifter/made/capo/boss/kingpin). Seven rungs,
// floor-keyed on MMR; the bottom rung is the floor so every MMR maps to a rank.

export interface RankTier {
  key: string;
  name: string;
  /** Inclusive MMR floor for this rank. */
  minMmr: number;
}

/** Ordered ascending by `minMmr`; first entry is the floor (minMmr 0). */
export const RANK_TIERS: readonly RankTier[] = [
  { key: 'stray', name: 'Stray Cat', minMmr: 0 },
  { key: 'runner', name: 'Bagman', minMmr: 1300 },
  { key: 'fixer', name: 'Fixer', minMmr: 1500 },
  { key: 'shadow', name: 'Shadow', minMmr: 1700 },
  { key: 'enforcer', name: 'Enforcer', minMmr: 1900 },
  { key: 'consigliere', name: 'Consigliere', minMmr: 2100 },
  { key: 'don', name: 'The Don', minMmr: 2300 },
] as const;

/** The visible rank for an MMR, plus the rank's index (0-based, lowest first). */
export interface RankInfo {
  key: string;
  name: string;
  /** 0-based position in {@link RANK_TIERS} (lowest = 0). */
  index: number;
}

/** Pure: map an MMR to its visible rank tier. Total — every number maps. */
export function rankForMmr(mmr: number): RankInfo {
  let current = RANK_TIERS[0] as RankTier;
  let index = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    const t = RANK_TIERS[i] as RankTier;
    if (mmr >= t.minMmr) {
      current = t;
      index = i;
    } else {
      break;
    }
  }
  return { key: current.key, name: current.name, index };
}

/**
 * Pure: the MMR threshold for the NEXT rank above this MMR, or null if already
 * at the top rung. Drives a "X to the next rank" UI.
 */
export function nextRankThreshold(mmr: number): { name: string; at: number } | null {
  for (const t of RANK_TIERS) {
    if (mmr < t.minMmr) return { name: t.name, at: t.minMmr };
  }
  return null;
}

// --------------------------------------------------------------------------
// Wire shape: a player's ranked standing (server → client, /api/me/rank etc.)
// --------------------------------------------------------------------------

/**
 * A user's competitive standing for the current season + mode. The `rank`/`rankName`
 * are derived from `mmr` server-side so the client never recomputes the ladder.
 */
export interface UserRankSummary {
  mmr: number;
  rd: number;
  /** Rank key (RANK_TIERS.key), derived from `mmr`. */
  rank: string;
  /** Rank display name (RANK_TIERS.name). */
  rankName: string;
  games: number;
  wins: number;
  seasonId: string;
}
