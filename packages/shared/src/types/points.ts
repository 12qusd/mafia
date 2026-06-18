/**
 * Points, achievements & player progression (goal: full points system).
 *
 * BUILD_SPEC §17 deferred ratings to Phase B; this is our own original,
 * deterministic scoring system. Scoring is a PURE function so it is unit-tested
 * and identical on server and (for preview) client — no I/O, no clock. The
 * server is the only authority that *persists* points (§points hook in
 * onGameOver); guests and TEST-mode games are excluded by the caller.
 */

import { z } from 'zod';

// --------------------------------------------------------------------------
// Award reasons & breakdown
// --------------------------------------------------------------------------

/** Stable identifiers for why points were granted (persisted in point_log). */
export type PointReason =
  | 'played'
  | 'win'
  | 'survived_to_end'
  | 'loyalty_dead'
  | 'achievement'
  | 'admin';

export const PointAwardSchema = z.object({
  code: z.enum(['played', 'win', 'survived_to_end', 'loyalty_dead', 'achievement', 'admin']),
  /** Human-facing label (original copy, noir register). */
  label: z.string(),
  points: z.number().int(),
  /** For achievement awards: the achievement key. */
  detail: z.string().optional(),
});
export type PointAward = z.infer<typeof PointAwardSchema>;

export const PointsBreakdownSchema = z.object({
  awards: z.array(PointAwardSchema),
  total: z.number().int(),
});
export type PointsBreakdown = z.infer<typeof PointsBreakdownSchema>;

// --------------------------------------------------------------------------
// Scoring weights (tunable; central so balance lives in one place)
// --------------------------------------------------------------------------

export const POINTS = {
  /** Base award for completing a game without quitting. */
  PLAYED: 10,
  /** Bonus for being on the winning side (faction or personal). */
  WIN: 50,
  /** Bonus for being alive when the game ends. */
  SURVIVED_TO_END: 25,
  /** Per in-game day a dead player remained instead of quitting. */
  LOYALTY_PER_DAY_DEAD: 6,
  /** Cap on the loyalty bonus so long games don't dwarf everything else. */
  LOYALTY_MAX: 72,
} as const;

// --------------------------------------------------------------------------
// Achievements catalog (definitions only; detection lives server-side)
// --------------------------------------------------------------------------

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  points: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { key: 'first_win', name: 'First Blood', description: 'Win your very first game.', points: 30 },
  { key: 'survivor', name: 'Last One Standing', description: 'Be alive when the game ends.', points: 20 },
  {
    key: 'martyr',
    name: 'Martyr',
    description: 'Die on the first night but stay to the final curtain.',
    points: 35,
  },
  {
    key: 'loyal_dead',
    name: 'Loyal to the End',
    description: 'Linger five or more days after your death.',
    points: 25,
  },
  {
    key: 'mastermind',
    name: 'Mastermind',
    description: 'Win as a member of the Mafia.',
    points: 30,
  },
  {
    key: 'lone_wolf',
    name: 'Lone Wolf',
    description: 'Win as the Serial Killer — the last knife in the dark.',
    points: 60,
  },
  {
    key: 'last_laugh',
    name: 'The Last Laugh',
    description: 'Win as the Jester by getting yourself lynched.',
    points: 45,
  },
  {
    key: 'clean_sweep',
    name: 'Clean Sweep',
    description: 'Win with the Town without ever dying.',
    points: 30,
  },
  { key: 'veteran', name: 'Veteran', description: 'Play ten games.', points: 25 },
  { key: 'centurion', name: 'Centurion', description: 'Play one hundred games.', points: 100 },
  { key: 'high_roller', name: 'High Roller', description: 'Bank one thousand points.', points: 50 },
] as const;

export const ACHIEVEMENTS_BY_KEY: Readonly<Record<string, AchievementDef>> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);

export function achievementPoints(key: string): number {
  return ACHIEVEMENTS_BY_KEY[key]?.points ?? 0;
}

// --------------------------------------------------------------------------
// Progression tiers (drive cosmetic perks, e.g. death animations in goal 3)
// --------------------------------------------------------------------------

export interface PointsTier {
  key: string;
  name: string;
  minPoints: number;
}

/** Ordered ascending by `minPoints`. */
export const POINTS_TIERS: readonly PointsTier[] = [
  { key: 'drifter', name: 'Drifter', minPoints: 0 },
  { key: 'made', name: 'Made', minPoints: 250 },
  { key: 'capo', name: 'Capo', minPoints: 1000 },
  { key: 'boss', name: 'Boss', minPoints: 3000 },
  { key: 'kingpin', name: 'Kingpin', minPoints: 8000 },
] as const;

export function tierForPoints(total: number): PointsTier {
  let current: PointsTier = POINTS_TIERS[0] as PointsTier;
  for (const t of POINTS_TIERS) {
    if (total >= t.minPoints) current = t;
    else break;
  }
  return current;
}

// --------------------------------------------------------------------------
// Pure match scoring
// --------------------------------------------------------------------------

export interface MatchPlayerScoreInput {
  /** Faction/personal result for this seat. */
  outcome: 'win' | 'loss' | 'draw' | 'left';
  /** Alive when the game ended. */
  survived: boolean;
  /** 1-based in-game day the player died, or null if they survived. */
  deathDay: number | null;
  /** Final in-game day number the match reached. */
  finalDay: number;
  /** Achievement keys unlocked this match (detected server-side). */
  achievements?: readonly string[];
}

/**
 * Compute the point award breakdown for one player in one finished match.
 * Pure and total: same input ⇒ same output. A player who quit (`left`) forfeits
 * the played base and the loyalty bonus.
 */
export function computeMatchPoints(input: MatchPlayerScoreInput): PointsBreakdown {
  const awards: PointAward[] = [];
  const stayed = input.outcome !== 'left';

  if (stayed) {
    awards.push({ code: 'played', label: 'Played a full game', points: POINTS.PLAYED });
  }
  if (input.outcome === 'win') {
    awards.push({ code: 'win', label: 'Victory', points: POINTS.WIN });
  }
  if (input.survived) {
    awards.push({
      code: 'survived_to_end',
      label: 'Survived to the end',
      points: POINTS.SURVIVED_TO_END,
    });
  }
  if (!input.survived && stayed && input.deathDay !== null) {
    const daysDead = Math.max(0, input.finalDay - input.deathDay);
    if (daysDead > 0) {
      const pts = Math.min(POINTS.LOYALTY_MAX, daysDead * POINTS.LOYALTY_PER_DAY_DEAD);
      awards.push({
        code: 'loyalty_dead',
        label: `Stayed ${daysDead} day${daysDead === 1 ? '' : 's'} after dying`,
        points: pts,
      });
    }
  }
  for (const key of input.achievements ?? []) {
    const def = ACHIEVEMENTS_BY_KEY[key];
    if (def) {
      awards.push({ code: 'achievement', label: def.name, points: def.points, detail: key });
    }
  }

  const total = awards.reduce((sum, a) => sum + a.points, 0);
  return { awards, total };
}

// --------------------------------------------------------------------------
// User stats summary (wire shape for /api/me, leaderboard, points_awarded)
// --------------------------------------------------------------------------

export const UserStatsSummarySchema = z.object({
  userId: z.string(),
  username: z.string(),
  totalPoints: z.number().int(),
  gamesPlayed: z.number().int(),
  gamesWon: z.number().int(),
  gamesSurvived: z.number().int(),
  /** Sum of in-game days this player spent dead-but-watching (loyalty signal). */
  daysDeadWatched: z.number().int(),
  achievements: z.array(z.string()),
  tier: z.string(),
});
export type UserStatsSummary = z.infer<typeof UserStatsSummarySchema>;
