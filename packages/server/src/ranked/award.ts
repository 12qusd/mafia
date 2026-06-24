/**
 * Ranked rating award (ranked play). Called from LobbyManager.onGameOver AFTER
 * the match row is written, for RANKED matches only. Updates MMR for each HUMAN
 * player and persists the audit trail. The engine stays pure — all rating math
 * is server-side and seedless (see `rate.ts`).
 *
 * Exclusions: guests (`guest:` ids → no account → no MMR) and bots (also `guest:`
 * loopback identities) are filtered out here, exactly as points are. TEST-mode
 * matches are excluded by the caller. Each human's update uses the CURRENT
 * season id.
 *
 * Persistence per human:
 *  - upsertRating: new {mmr, rd, vol}; games += 1; wins += (won ? 1 : 0).
 *  - writeRankedResults: {mmr_before/after, rd_before/after, delta, mode, match,
 *    user} — an append-only ledger ((match,user) is idempotent).
 */

import {
  rankForMmr,
  inflateForInactivity,
  inactivePeriods,
  PLACEMENT_GAMES,
  type Glicko,
} from '@nocturne/shared';
import type { Store, MatchPlayerRecord, RankedResultInput, RatingRow } from '../db/types.js';
import { rateMatch, type RankedSeatInput, BOT_BASELINE_MMR, BOT_BASELINE_RD } from './rate.js';
import { DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL } from '@nocturne/shared';
import { log } from '../log.js';

/** The persisted ranked mode tag (matches.mode / ratings.mode / ranked_results.mode). */
export const RANKED_MODE = 'ranked';

/**
 * Extra MMR debit a human who ABANDONED a ranked match (`outcome === 'left'`)
 * takes ON TOP of their normal (loss) rating change — a deterrent for ragequits.
 * Applied after the Glicko update so it never feeds back into the opponent math.
 * Normal losses/draws, bots, and guests are NOT penalized.
 */
export const LEAVER_PENALTY = 30;

function isRealUser(id: string): boolean {
  return !id.startsWith('guest:');
}

export interface RankedAwardInput {
  store: Store;
  matchId: string;
  /** All seats in the match (humans + bots/guests); filtered here. */
  players: readonly MatchPlayerRecord[];
  /** Current season id (ratings + results are scoped to it). */
  seasonId: string;
  /**
   * Epoch ms "now" used to compute inactivity RD inflation at game ENTRY (whole
   * rating periods since each player's rating was last updated). Defaults to
   * Date.now(); tests pass a fixed value so the inflation is deterministic.
   */
  now?: number;
}

/** Outcome of a ranked award: per-human MMR delta + the leavers to cool down. */
export interface RankedAwardResult {
  /** userId → MMR delta (for the per-player game-over `rankedDelta` line). */
  deltas: Map<string, number>;
  /** Human user ids whose outcome was 'left' (abandoned) — matchmaker cooldown. */
  leavers: string[];
}

/**
 * Apply ranked MMR updates for a finished ranked match. Returns each human's MMR
 * delta + the list of abandoners (the matchmaker imposes a short re-queue
 * cooldown on them). Humans with no opposing humans still move (vs the bot
 * baseline). On any store error the whole award is skipped (logged) — ratings
 * are best-effort, never block the game-over flow.
 *
 * Two lifecycle adjustments layer on the base Glicko update:
 *  - INACTIVITY: a returning player's pre-game RD is inflated by the Glicko-2
 *    RD-grows-with-time step for whole periods since their last game, so the
 *    first game back moves their MMR faster (they re-converge quickly).
 *  - LEAVER PENALTY: a human who ABANDONED ('left') takes an extra
 *    {@link LEAVER_PENALTY} MMR debit beyond the normal (loss) change.
 */
export async function awardRankedRatings(input: RankedAwardInput): Promise<RankedAwardResult> {
  const { store, matchId, players, seasonId } = input;
  const now = input.now ?? Date.now();
  const deltas = new Map<string, number>();
  const leavers: string[] = [];

  const humanSeats = players.filter((p) => isRealUser(p.userOrGuestId));
  if (humanSeats.length === 0) return { deltas, leavers };

  // Leavers are reported regardless of whether the rating write succeeds, so the
  // cooldown still bites even if the store hiccups.
  for (const p of humanSeats) {
    if (p.outcome === 'left') leavers.push(p.userOrGuestId);
  }

  try {
    // Read each human's current rating (or the default for a first ranked game),
    // inflating RD for inactivity at ENTRY so a returning player re-converges fast.
    const seatInputs: RankedSeatInput[] = [];
    const leaverSet = new Set(leavers);
    for (const p of humanSeats) {
      const row = await store.getRating(p.userOrGuestId, RANKED_MODE, seasonId);
      const before: Glicko = row
        ? {
            rating: row.mmr,
            rd: inflateForInactivity(row.rd, row.vol, inactivePeriods(row.updatedAt, now)),
            vol: row.vol,
          }
        : { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
      seatInputs.push({ userId: p.userOrGuestId, rating: before, outcome: p.outcome });
    }

    const totalSeats = players.length;
    const results = rateMatch(seatInputs, totalSeats);

    const rankedRows: RankedResultInput[] = [];
    for (const r of results) {
      const prev = await store.getRating(r.userId, RANKED_MODE, seasonId);
      // Extra debit for abandoning, applied AFTER the Glicko update so it never
      // feeds back into the opponent math (rate.ts already saw them as a loser).
      const penalty = leaverSet.has(r.userId) ? LEAVER_PENALTY : 0;
      const finalMmr = r.after.rating - penalty;
      const finalDelta = finalMmr - r.before.rating;
      const updated: RatingRow = {
        userId: r.userId,
        mode: RANKED_MODE,
        seasonId,
        mmr: finalMmr,
        rd: r.after.rd,
        vol: r.after.vol,
        games: (prev?.games ?? 0) + 1,
        wins: (prev?.wins ?? 0) + (r.won ? 1 : 0),
        updatedAt: 0, // set by the store
      };
      await store.upsertRating(updated);
      rankedRows.push({
        matchId,
        userId: r.userId,
        mode: RANKED_MODE,
        mmrBefore: r.before.rating,
        mmrAfter: finalMmr,
        rdBefore: r.before.rd,
        rdAfter: r.after.rd,
        delta: finalDelta,
      });
      deltas.set(r.userId, finalDelta);
    }
    if (rankedRows.length > 0) await store.writeRankedResults(rankedRows);
  } catch (err) {
    log.error('failed to award ranked ratings', { matchId, err: String(err) });
    deltas.clear();
  }
  return { deltas, leavers };
}

/**
 * Build the wire `ranked` summary for a user's current standing (for /api/me,
 * /api/rank/:userId, and the inline `points_awarded` stats). Returns null when
 * the user has no ranked rating for this (mode, season).
 *
 * A player with fewer than {@link PLACEMENT_GAMES} games this season is "in
 * placements": the summary still carries the MMR/rank (the math is unchanged),
 * plus a `placements: { played, total }` marker so the client shows
 * "Unranked — X/5 placements" instead of the ladder badge until they place.
 */
export async function buildRankedSummary(
  store: Store,
  userId: string,
  seasonId: string,
): Promise<{
  mmr: number;
  rd: number;
  rank: string;
  rankName: string;
  games: number;
  wins: number;
  seasonId: string;
  placements?: { played: number; total: number };
} | null> {
  const row = await store.getRating(userId, RANKED_MODE, seasonId);
  if (!row) return null;
  const rank = rankForMmr(row.mmr);
  return {
    mmr: Math.round(row.mmr),
    rd: Math.round(row.rd),
    rank: rank.key,
    rankName: rank.name,
    games: row.games,
    wins: row.wins,
    seasonId,
    ...(row.games < PLACEMENT_GAMES
      ? { placements: { played: row.games, total: PLACEMENT_GAMES } }
      : {}),
  };
}

export { BOT_BASELINE_MMR, BOT_BASELINE_RD };
