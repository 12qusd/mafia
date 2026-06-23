/**
 * Match → MMR model (ranked play, the crux). PURE and seedless: given the
 * per-seat outcomes + each human's current rating, it computes the new ratings.
 * No I/O, no clock, no randomness — so it is unit-testable and deterministic.
 *
 * Model (recorded in DECISIONS.md):
 *  1. Partition the match's HUMAN players (non-`guest:`, non-bot) into WINNERS
 *     (seat outcome === 'win') and LOSERS (anything else: loss/draw/left).
 *  2. Each human plays ONE Glicko-2 rating period against a single synthetic
 *     opponent: the AVERAGE rating of the OPPOSING human group — winners vs the
 *     losers' mean (score 1), losers vs the winners' mean (score 0). The
 *     opponent's RD is the mean RD of that group (uncertainty of the field).
 *  3. If a side has zero humans (e.g. a solo human carried by bots, or an
 *     all-human sweep), the opponent falls back to a fixed BOT baseline
 *     (rating {@link BOT_BASELINE_MMR}, rd {@link BOT_BASELINE_RD}) with the
 *     appropriate score. So a lone human still moves — just against the baseline.
 *  4. BOT-HEAVY DAMPENING: scale each human's resulting DELTA (rating AND rd
 *     change) by `humanDensity = humanCount / totalSeats`. A 1-human/6-bot game
 *     (density ≈ 0.14) barely moves MMR; an all-human game (density 1) moves it
 *     fully. The dampening is linear in density — simple, monotonic, and easy to
 *     reason about. RD is also dampened so confidence still grows but slowly in
 *     mostly-bot games.
 *
 * Bots and guests are excluded by the caller (they have no rating). The caller
 * passes only humans; this module never sees a `guest:`/bot id.
 */

import { updateRating, type Glicko } from '@nocturne/shared';

/** Fixed baseline a bot field is treated as, when a human's opposing side is all bots. */
export const BOT_BASELINE_MMR = 1500;
/** RD of the bot baseline opponent (moderately certain — bots are a known quantity). */
export const BOT_BASELINE_RD = 350;

/** One human seat's pre-match rating + their seat outcome. */
export interface RankedSeatInput {
  userId: string;
  rating: Glicko;
  /** Seat outcome from the match record ('win' ⇒ winner; else loser). */
  outcome: string;
}

/** One human's computed rating change for the match. */
export interface RankedSeatResult {
  userId: string;
  before: Glicko;
  after: Glicko;
  /** Rating (MMR) delta, after dampening (after.rating - before.rating). */
  delta: number;
  /** Whether this seat was on the winning side. */
  won: boolean;
}

function mean(xs: readonly number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Compute new ratings for every human in a finished ranked match.
 *
 * @param humans   pre-match ratings + outcomes for the HUMAN players only.
 * @param totalSeats total seats in the match (humans + bots) — drives dampening.
 * @returns one result per human (same order), or [] if there are no humans.
 */
export function rateMatch(
  humans: readonly RankedSeatInput[],
  totalSeats: number,
): RankedSeatResult[] {
  if (humans.length === 0) return [];

  const winners = humans.filter((h) => h.outcome === 'win');
  const losers = humans.filter((h) => h.outcome !== 'win');

  // Opposing-group averages. Empty side ⇒ bot baseline.
  const winnersMeanMmr = mean(
    winners.map((w) => w.rating.rating),
    BOT_BASELINE_MMR,
  );
  const winnersMeanRd = mean(
    winners.map((w) => w.rating.rd),
    BOT_BASELINE_RD,
  );
  const losersMeanMmr = mean(
    losers.map((l) => l.rating.rating),
    BOT_BASELINE_MMR,
  );
  const losersMeanRd = mean(
    losers.map((l) => l.rating.rd),
    BOT_BASELINE_RD,
  );

  // Bot-heavy dampening: linear in human density. Clamp to (0, 1].
  const density = Math.max(0, Math.min(1, humans.length / Math.max(1, totalSeats)));

  const results: RankedSeatResult[] = [];
  for (const h of humans) {
    const won = h.outcome === 'win';
    // Opposing group's average is the single synthetic opponent.
    const oppMmr = won ? losersMeanMmr : winnersMeanMmr;
    const oppRd = won ? losersMeanRd : winnersMeanRd;
    const score = won ? 1 : 0;

    const raw = updateRating(h.rating, [{ rating: oppMmr, rd: oppRd, score }]);

    // Dampen the deltas by human density (mostly-bot games barely move MMR).
    const after: Glicko = {
      rating: h.rating.rating + (raw.rating - h.rating.rating) * density,
      rd: h.rating.rd + (raw.rd - h.rating.rd) * density,
      // Volatility tracks the dampened RD path: interpolate toward the raw vol.
      vol: h.rating.vol + (raw.vol - h.rating.vol) * density,
    };

    results.push({
      userId: h.userId,
      before: h.rating,
      after,
      delta: after.rating - h.rating.rating,
      won,
    });
  }
  return results;
}
