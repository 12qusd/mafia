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

import { rankForMmr, type Glicko } from '@nocturne/shared';
import type { Store, MatchPlayerRecord, RankedResultInput, RatingRow } from '../db/types.js';
import { rateMatch, type RankedSeatInput, BOT_BASELINE_MMR, BOT_BASELINE_RD } from './rate.js';
import { DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL } from '@nocturne/shared';
import { log } from '../log.js';

/** The persisted ranked mode tag (matches.mode / ratings.mode / ranked_results.mode). */
export const RANKED_MODE = 'ranked';

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
}

/**
 * Apply ranked MMR updates for a finished ranked match. Returns a map of
 * userId → MMR delta (for the per-player game-over `rankedDelta` line). Humans
 * with no opposing humans still move (vs the bot baseline). On any store error
 * the whole award is skipped (logged) — ratings are best-effort, never block
 * the game-over flow.
 */
export async function awardRankedRatings(input: RankedAwardInput): Promise<Map<string, number>> {
  const { store, matchId, players, seasonId } = input;
  const deltas = new Map<string, number>();

  const humanSeats = players.filter((p) => isRealUser(p.userOrGuestId));
  if (humanSeats.length === 0) return deltas;

  try {
    // Read each human's current rating (or the default for a first ranked game).
    const seatInputs: RankedSeatInput[] = [];
    const beforeById = new Map<string, Glicko>();
    for (const p of humanSeats) {
      const row = await store.getRating(p.userOrGuestId, RANKED_MODE, seasonId);
      const before: Glicko = row
        ? { rating: row.mmr, rd: row.rd, vol: row.vol }
        : { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
      beforeById.set(p.userOrGuestId, before);
      seatInputs.push({ userId: p.userOrGuestId, rating: before, outcome: p.outcome });
    }

    const totalSeats = players.length;
    const results = rateMatch(seatInputs, totalSeats);

    const rankedRows: RankedResultInput[] = [];
    for (const r of results) {
      const prev = await store.getRating(r.userId, RANKED_MODE, seasonId);
      const updated: RatingRow = {
        userId: r.userId,
        mode: RANKED_MODE,
        seasonId,
        mmr: r.after.rating,
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
        mmrAfter: r.after.rating,
        rdBefore: r.before.rd,
        rdAfter: r.after.rd,
        delta: r.delta,
      });
      deltas.set(r.userId, r.delta);
    }
    if (rankedRows.length > 0) await store.writeRankedResults(rankedRows);
  } catch (err) {
    log.error('failed to award ranked ratings', { matchId, err: String(err) });
    deltas.clear();
  }
  return deltas;
}

/**
 * Build the wire `ranked` summary for a user's current standing (for /api/me,
 * /api/rank/:userId, and the inline `points_awarded` stats). Returns null when
 * the user has no ranked rating for this (mode, season).
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
  };
}

export { BOT_BASELINE_MMR, BOT_BASELINE_RD };
