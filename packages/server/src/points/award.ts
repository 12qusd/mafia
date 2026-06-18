/**
 * Post-match points & achievements award (goal 4).
 *
 * Called from LobbyManager.onGameOver AFTER the match row is written. The game
 * ENGINE stays pure — all scoring happens here, server-side. Guests
 * (`guest:` identities) and TEST-mode games are excluded so the ladder is not
 * polluted (synthesis risk: guest/test pollution). Each registered player gets
 * their own `points_awarded` frame (§5: individually addressed; a player never
 * sees another's points).
 */

import {
  computeMatchPoints,
  achievementPoints,
  tierForPoints,
  ACHIEVEMENTS_BY_KEY,
  type UserStatsSummary,
} from '@nocturne/shared';
import type { Store, MatchPlayerRecord } from '../db/types.js';
import type { Room } from '../room/room.js';
import { log } from '../log.js';

export interface AwardInput {
  store: Store;
  room: Room;
  matchId: string;
  players: MatchPlayerRecord[];
  finalDay: number;
}

function isRealUser(id: string): boolean {
  return !id.startsWith('guest:');
}

/**
 * Detect which achievement keys a player's match performance qualifies for,
 * given their pre-match lifetime counts. Count-based achievements (veteran,
 * centurion, high_roller, first_win) use the pre-match numbers + this match.
 */
function detectAchievements(
  p: MatchPlayerRecord,
  finalDay: number,
  prev: { gamesPlayed: number; gamesWon: number; totalPoints: number },
  basePointsThisMatch: number,
): string[] {
  const keys: string[] = [];
  const won = p.outcome === 'win';
  const stayed = p.outcome !== 'left';
  const daysDead = p.survived || p.deathDay === null ? 0 : Math.max(0, finalDay - p.deathDay);

  if (p.survived) keys.push('survivor');
  if (!p.survived && stayed && p.deathDay === 1) keys.push('martyr');
  if (!p.survived && stayed && daysDead >= 5) keys.push('loyal_dead');
  if (won && p.faction === 'MAFIA') keys.push('mastermind');
  if (won && p.role === 'SERIAL_KILLER') keys.push('lone_wolf');
  if (won && p.role === 'JESTER') keys.push('last_laugh');
  if (won && p.faction === 'TOWN' && p.survived) keys.push('clean_sweep');

  if (won && prev.gamesWon === 0) keys.push('first_win');
  if (prev.gamesPlayed + 1 >= 10) keys.push('veteran');
  if (prev.gamesPlayed + 1 >= 100) keys.push('centurion');
  if (prev.totalPoints + basePointsThisMatch >= 1000) keys.push('high_roller');

  // Only keep keys that exist in the catalog.
  return keys.filter((k) => ACHIEVEMENTS_BY_KEY[k]);
}

export async function awardMatchPoints(input: AwardInput): Promise<void> {
  const { store, room, matchId, players, finalDay } = input;

  for (const p of players) {
    if (!isRealUser(p.userOrGuestId)) continue;
    const userId = p.userOrGuestId;
    try {
      const prevStats = await store.getUserStats(userId);
      const prev = {
        gamesPlayed: prevStats?.gamesPlayed ?? 0,
        gamesWon: prevStats?.gamesWon ?? 0,
        totalPoints: prevStats?.totalPoints ?? 0,
      };

      // Base points (no achievements) to feed count-based achievement checks.
      const basePoints = computeMatchPoints({
        outcome: p.outcome as 'win' | 'loss' | 'draw' | 'left',
        survived: p.survived,
        deathDay: p.deathDay,
        finalDay,
      }).total;

      const candidateKeys = detectAchievements(p, finalDay, prev, basePoints);
      // Only award achievement points the first time each is unlocked.
      const newlyUnlocked = await store.unlockAchievements(
        userId,
        candidateKeys.map((k) => ({ key: k, points: achievementPoints(k) })),
      );

      const breakdown = computeMatchPoints({
        outcome: p.outcome as 'win' | 'loss' | 'draw' | 'left',
        survived: p.survived,
        deathDay: p.deathDay,
        finalDay,
        achievements: newlyUnlocked,
      });

      const won = p.outcome === 'win';
      const daysDead =
        p.survived || p.deathDay === null ? 0 : Math.max(0, finalDay - p.deathDay);

      const at = Date.now();
      await store.addToUserStats(
        userId,
        {
          points: breakdown.total,
          gamesPlayed: 1,
          gamesWon: won ? 1 : 0,
          gamesSurvived: p.survived ? 1 : 0,
          daysDeadWatched: daysDead,
        },
        at,
      );
      await store.recordPoints(
        userId,
        breakdown.awards.map((a) => ({
          matchId,
          reason: a.code,
          detail: a.detail ?? null,
          points: a.points,
        })),
      );

      // Build the post-award summary for this player.
      const stats = await store.getUserStats(userId);
      const achievements = await store.getUserAchievements(userId);
      const totalPoints = stats?.totalPoints ?? prev.totalPoints + breakdown.total;
      const summary: UserStatsSummary = {
        userId,
        username: room.nameForSeat(p.seat) ?? userId,
        totalPoints,
        gamesPlayed: stats?.gamesPlayed ?? prev.gamesPlayed + 1,
        gamesWon: stats?.gamesWon ?? prev.gamesWon + (won ? 1 : 0),
        gamesSurvived: stats?.gamesSurvived ?? 0,
        daysDeadWatched: stats?.daysDeadWatched ?? 0,
        achievements,
        tier: tierForPoints(totalPoints).key,
      };

      room.sendToSeat(p.seat, {
        v: 1,
        type: 'points_awarded',
        matchId,
        breakdown,
        stats: summary,
        newAchievements: newlyUnlocked,
      });
    } catch (err) {
      log.error('failed to award points', { userId, err: String(err) });
    }
  }
}
