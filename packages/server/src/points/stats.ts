/**
 * Read-side helpers for the points system (goal 4): assemble the wire-shaped
 * UserStatsSummary the client renders on profiles, /api/me and the leaderboard.
 */

import { tierForPoints, type UserStatsSummary } from '@nocturne/shared';
import type { Store } from '../db/types.js';

/**
 * Build a UserStatsSummary for a registered user, or null if the user does not
 * exist. A user with no recorded matches yet yields a zeroed summary.
 */
export async function buildUserStatsSummary(
  store: Store,
  userId: string,
): Promise<UserStatsSummary | null> {
  const user = await store.getUserById(userId);
  if (!user) return null;
  const stats = await store.getUserStats(userId);
  const achievements = await store.getUserAchievements(userId);
  const totalPoints = stats?.totalPoints ?? 0;
  return {
    userId,
    username: user.username,
    totalPoints,
    gamesPlayed: stats?.gamesPlayed ?? 0,
    gamesWon: stats?.gamesWon ?? 0,
    gamesSurvived: stats?.gamesSurvived ?? 0,
    daysDeadWatched: stats?.daysDeadWatched ?? 0,
    achievements,
    tier: tierForPoints(totalPoints).key,
  };
}
