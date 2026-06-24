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
// Lifecycle constants (placements, soft-reset, inactivity) — ranked-progression
// depth. PURE values consumed by the server's ranked lifecycle (season rollover,
// placement gating, inactivity RD inflation). Kept here so client + server agree.
// --------------------------------------------------------------------------

/**
 * Number of ranked games a player must finish IN A SEASON before they are
 * "placed" (a numeric rank/ladder badge is shown). Below this they are
 * "Unranked — X/5 placements" — the Glicko RD is still wide early, so the math
 * is unchanged; this only gates the visible STATUS.
 */
export const PLACEMENT_GAMES = 5;

/**
 * Season soft-reset: how much of a player's distance from the mean carries into
 * the new season. `new = MEAN + (old - MEAN) * CARRY`. 0 ⇒ everyone resets to
 * the mean; 1 ⇒ full carry. 0.5 pulls everyone halfway toward the mean so the
 * ladder re-spreads each season while preserving relative ordering.
 */
export const SEASON_CARRY = 0.5;

/** The mean rating a soft-reset (and the rating scale) is centered on. */
export const SEASON_MEAN = DEFAULT_RATING;

/**
 * RD a soft-reset re-inflates uncertainty UP to (a calibration value): high
 * enough that the first games of the new season move MMR quickly so players
 * re-converge fast, but below the cold-start {@link DEFAULT_RD}. A carried
 * rating keeps its old RD only if it was already above this.
 */
export const SEASON_RESET_RD = 200;

/**
 * One ranked "rating period" for inactivity purposes, in ms (7 days). Whole
 * periods elapsed since a rating's last update drive {@link inflateForInactivity}.
 */
export const RATING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

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
// Lifecycle math (PURE): season soft-reset + inactivity RD inflation
// --------------------------------------------------------------------------

/**
 * Pure season soft-reset of one rating into a new season. The MMR is pulled
 * toward {@link SEASON_MEAN} by {@link SEASON_CARRY} (preserving relative
 * ordering); RD is re-inflated UP to {@link SEASON_RESET_RD} (or kept if it was
 * already wider), and volatility resets to {@link DEFAULT_VOL}. games/wins are a
 * persistence concern (reset by the caller), not part of the rating math.
 *
 * Same inputs ⇒ same output (no clock / randomness).
 */
export function softResetRating(g: Glicko): Glicko {
  return {
    rating: SEASON_MEAN + (g.rating - SEASON_MEAN) * SEASON_CARRY,
    rd: Math.max(g.rd, SEASON_RESET_RD),
    vol: DEFAULT_VOL,
  };
}

/**
 * Pure Glicko-2 inactivity RD inflation: the "did-not-compete" RD-grows-with-
 * time step applied for `inactivePeriods` whole rating periods, in one closed
 * form. In Glicko-2 a single skipped period grows φ to `sqrt(φ² + σ²)`; over `t`
 * periods this is `φ' = sqrt(φ² + σ²·t)` (since σ is held fixed across the gap).
 * The result is clamped to {@link DEFAULT_RD} (uncertainty never exceeds the
 * cold-start ceiling) and is a no-op for `t ≤ 0`.
 *
 * Returns the inflated RD on the VISIBLE (Glicko) scale. Rating + vol are
 * unchanged by inactivity, so only RD is returned. `vol` is passed in because
 * the inflation depends on the player's current volatility.
 *
 * Monotonic non-decreasing in `inactivePeriods`; pure (no clock — the caller
 * computes whole periods from a `now` it passes in).
 */
export function inflateForInactivity(rd: number, vol: number, inactivePeriods: number): number {
  if (!(inactivePeriods > 0)) return rd;
  // Convert to the Glicko-2 scale, grow φ over t periods, convert back.
  const phi = rd / SCALE;
  const sigma = vol;
  const phiStar = Math.sqrt(phi * phi + sigma * sigma * inactivePeriods);
  const inflated = phiStar * SCALE;
  return Math.min(DEFAULT_RD, Math.max(rd, inflated));
}

/**
 * Whole rating periods elapsed between `updatedAt` and `now` (both epoch ms),
 * for {@link inflateForInactivity}. Pure: the clock is passed in. Never negative.
 */
export function inactivePeriods(updatedAt: number, now: number): number {
  if (!(now > updatedAt)) return 0;
  return Math.floor((now - updatedAt) / RATING_PERIOD_MS);
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
  /**
   * Placement status when the player has not yet finished {@link PLACEMENT_GAMES}
   * ranked games this season (the client shows "Unranked — played/total" instead
   * of the ladder badge). Absent once placed.
   */
  placements?: { played: number; total: number };
}
