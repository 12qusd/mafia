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
  ROLE_WIN_KEY_BY_ROLE,
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
export function detectAchievements(
  p: MatchPlayerRecord,
  finalDay: number,
  prev: { gamesPlayed: number; gamesWon: number; totalPoints: number },
  basePointsThisMatch: number,
  allPlayers: readonly MatchPlayerRecord[],
): string[] {
  const keys: string[] = [];
  const won = p.outcome === 'win';
  const stayed = p.outcome !== 'left';
  const daysDead = p.survived || p.deathDay === null ? 0 : Math.max(0, finalDay - p.deathDay);

  if (p.survived) keys.push('survivor');
  if (!p.survived && stayed && p.deathDay === 1) keys.push('martyr');
  if (!p.survived && stayed && daysDead >= 5) keys.push('loyal_dead');
  // The 'mastermind' achievement fires for a win as a member of EITHER informed
  // evil faction (Mafia or Triad) — both run the family/tong and play the same role.
  if (won && (p.faction === 'MAFIA' || p.faction === 'TRIAD')) keys.push('mastermind');
  if (won && p.role === 'SERIAL_KILLER') keys.push('lone_wolf');
  if (won && p.role === 'JESTER') keys.push('last_laugh');
  if (won && p.faction === 'TOWN' && p.survived) keys.push('clean_sweep');

  if (won && prev.gamesWon === 0) keys.push('first_win');
  if (prev.gamesPlayed + 1 >= 10) keys.push('veteran');
  if (prev.gamesPlayed + 1 >= 100) keys.push('centurion');
  if (prev.totalPoints + basePointsThisMatch >= 1000) keys.push('high_roller');

  // --- Win-with-each-role (generated catalog) -----------------------------
  // Uses the seat's FINAL role from the match record, so a converted Vampire
  // who wins earns `win_vampire`. One per role; first-time-only via the store.
  if (won) {
    const winKey = ROLE_WIN_KEY_BY_ROLE[p.role];
    if (winKey) keys.push(winKey);
  }

  // --- Feat achievements (detectable from this seat's record + finalDay) ----
  const lynched = p.deathDay !== null && !p.survived; // executed/killed on a day we can see
  if (won && !p.survived && p.deathDay === 1) keys.push('feat_dead_man_wins');
  if (!p.survived && p.deathDay === 1) keys.push('feat_first_blood');
  if (won && stayed && p.deathDay !== null && p.deathDay <= 2 && daysDead > 0) {
    keys.push('feat_grim_loyalty');
  }
  if (won && p.faction === 'TOWN' && p.survived) keys.push('feat_clean_hands');
  if (won && p.survived) keys.push('feat_untouchable');
  if (won && finalDay >= 7) keys.push('feat_final_curtain');
  if (p.survived && finalDay >= 7) keys.push('feat_long_haul');
  if (won && p.faction === 'TOWN' && lynched) keys.push('feat_martyrs_vindication');
  if (won && p.deathDay !== null && p.deathDay === finalDay && !p.survived) {
    keys.push('feat_pyrrhic');
  }
  if (won && daysDead >= 5) keys.push('feat_ghost_of_the_house');
  // Conversions: a seat whose FINAL role is the converted body but is benign-ish
  // (Vampire/Cultist) won — they were turned and rode the win home.
  if (won && p.role === 'VAMPIRE') keys.push('feat_turncoat');
  if (won && p.role === 'CULTIST') keys.push('feat_converted_faithful');
  // Independent-killer + standout-neutral wins.
  if (won && p.faction === 'NEUTRAL_KILLING' && p.survived) keys.push('feat_solo_carry');
  if (won && p.role === 'EXECUTIONER') keys.push('feat_kingmaker');
  if (won && p.role === 'SURVIVOR') keys.push('feat_one_more_drink');
  if (won && p.role === 'PESTILENCE') keys.push('feat_plague_apotheosis');
  if (won && p.role === 'PIRATE') keys.push('feat_house_always_wins');

  // --- Last Town standing (needs the full roster) -------------------------
  // Win as Town, alive at the end, and no OTHER Town seat survived.
  if (won && p.faction === 'TOWN' && p.survived) {
    const otherTownSurvivors = allPlayers.filter(
      (q) => q.seat !== p.seat && q.faction === 'TOWN' && q.survived,
    );
    if (otherTownSurvivors.length === 0) keys.push('feat_last_town_standing');
  }

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

      const candidateKeys = detectAchievements(p, finalDay, prev, basePoints, players);
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
