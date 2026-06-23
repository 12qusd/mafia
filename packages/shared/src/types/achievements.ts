/**
 * Achievement catalog — role-win achievements (one per role, generated from the
 * roster) + distinctive "feat" achievements (weird/skill plays). Folded into the
 * main ACHIEVEMENTS array in `points.ts` so the catalog/UI/award code see every
 * achievement uniformly.
 *
 * Pure data. Detection of role-win + feat achievements lives server-side in
 * `packages/server/src/points/award.ts`; this module only defines them and the
 * mapping helpers a detector needs (e.g. role id → win key, role → point tier).
 *
 * All copy is ORIGINAL noir-register text (§2.1.2) — no strings lifted from the
 * source games.
 */

import { ALL_ROLES } from '../roles/index.js';
import type { RoleDefinition } from '../roles/types.js';
import type { RoleId } from './role.js';
import type { Faction } from './faction.js';

/** Shared shape with `points.ts`'s AchievementDef (kept structural to avoid a cycle). */
export interface AchievementDefLike {
  key: string;
  name: string;
  description: string;
  points: number;
}

// --------------------------------------------------------------------------
// 1. Role-win achievements — generated, one per role in ALL_ROLES
// --------------------------------------------------------------------------

/**
 * Point value for "win as <Role>", scaled by how hard/rare a win with that role
 * is. Tuned by faction + a couple of standout neutrals so the value tracks the
 * roster automatically (add a role → it gets a sensible default with no edit).
 */
export const ROLE_WIN_POINTS = {
  /** Vanilla / supporting Town & evil-faction members — common wins. */
  COMMON: 25,
  /** Independent killers and unique converters — a harder, lonelier win. */
  KILLER: 40,
  /** Trickster / parasite neutrals whose win is a personal feat. */
  TRICKSTER: 50,
} as const;

/** Neutral-benign roles whose victory is a self-contained personal feat. */
const TRICKSTER_ROLES: ReadonlySet<RoleId> = new Set<RoleId>([
  'JESTER',
  'EXECUTIONER',
  'PIRATE',
  'WITCH',
]);

/**
 * The "win as" point tier for a role. Independent killers and the lone
 * converters (Serial Killer, Vampire, Cult Leader, etc.) score KILLER; the
 * trickster neutrals score TRICKSTER; everyone else (Town, Mafia, Triad,
 * Cultist body, support neutrals) scores COMMON.
 */
export function roleWinPoints(role: RoleDefinition): number {
  if (TRICKSTER_ROLES.has(role.id)) return ROLE_WIN_POINTS.TRICKSTER;
  const killerFactions: ReadonlySet<Faction> = new Set<Faction>(['NEUTRAL_KILLING', 'VAMPIRE']);
  if (killerFactions.has(role.faction)) return ROLE_WIN_POINTS.KILLER;
  // The unique converters earn the KILLER tier — a hard solo-ish carry.
  if (role.id === 'CULT_LEADER') return ROLE_WIN_POINTS.KILLER;
  return ROLE_WIN_POINTS.COMMON;
}

/** The achievement key for winning as a given role: `win_<roleid_lowercase>`. */
export function roleWinKey(roleId: RoleId): string {
  return `win_${roleId.toLowerCase()}`;
}

/**
 * Original one-line noir description for a role-win achievement. Generic but
 * role-flavoured so all 50 read distinctly without hand-authoring each.
 */
function roleWinDescription(role: RoleDefinition): string {
  switch (role.faction) {
    case 'TOWN':
      return `Carry the Town to dawn while holding the ${role.name}'s post.`;
    case 'MAFIA':
      return `Take the city for the family with the ${role.name} at the table.`;
    case 'TRIAD':
      return `Deliver the tong its victory wearing the ${role.name}'s colours.`;
    case 'VAMPIRE':
      return `Outlast the living and win the night as the ${role.name}.`;
    case 'CULT':
      return `See the faith triumph with the ${role.name} among the faithful.`;
    case 'NEUTRAL_KILLING':
      return `Be the last knife standing — win alone as the ${role.name}.`;
    case 'NEUTRAL_BENIGN':
      return `Pull off the ${role.name}'s private win and walk away clean.`;
    default:
      return `Win the game as the ${role.name}.`;
  }
}

/**
 * One "win as <Role>" achievement per role in ALL_ROLES, generated so the list
 * auto-tracks the roster. Keyed `win_<roleid_lowercase>`.
 */
export const ROLE_WIN_ACHIEVEMENTS: readonly AchievementDefLike[] = ALL_ROLES.map((role) => ({
  key: roleWinKey(role.id),
  name: `Win as ${role.name}`,
  description: roleWinDescription(role),
  points: roleWinPoints(role),
}));

/** roleId → win achievement key, for the server detector. */
export const ROLE_WIN_KEY_BY_ROLE: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_ROLES.map((role) => [role.id, roleWinKey(role.id)]),
);

// --------------------------------------------------------------------------
// 2. Feat achievements — distinctive weird/skill plays
// --------------------------------------------------------------------------
//
// SHIPPED here are only feats detectable from the per-player match record
// (`outcome`, `survived`, `deathDay`, `faction`, `role`) plus the match
// `finalDay`. The server detector in award.ts owns the conditions; the copy and
// point values live here. See DECISIONS.md for the feats deliberately SKIPPED as
// undetectable with today's signals (and what extra signal each would need).

export const FEAT_ACHIEVEMENTS: readonly AchievementDefLike[] = [
  {
    key: 'feat_dead_man_wins',
    name: "Dead Man's Hand",
    description: 'Die on the first night and still end up on the winning side.',
    points: 40,
  },
  {
    key: 'feat_first_blood',
    name: 'Cold Open',
    description: 'Be the very first body of the game — dead before the first dawn.',
    points: 15,
  },
  {
    key: 'feat_last_town_standing',
    name: 'Last Lamp Lit',
    description: 'Win as the only member of the Town left breathing at the end.',
    points: 45,
  },
  {
    key: 'feat_final_curtain',
    name: 'Final Curtain',
    description: 'Win a long siege — a game that ran seven in-game days or more.',
    points: 35,
  },
  {
    key: 'feat_long_haul',
    name: 'The Long Haul',
    description: 'Survive to the end of a game that lasted seven days or more.',
    points: 40,
  },
  {
    key: 'feat_martyrs_vindication',
    name: "Martyr's Vindication",
    description: 'Be lynched while loyal to the Town, yet see your side win anyway.',
    points: 40,
  },
  {
    key: 'feat_turncoat',
    name: 'Turncoat',
    description: 'Win after being converted — start one thing, end a Vampire and triumph.',
    points: 45,
  },
  {
    key: 'feat_converted_faithful',
    name: 'New Convert',
    description: 'Win after being recruited into the Cult and dying for nobody.',
    points: 45,
  },
  {
    key: 'feat_ghost_of_the_house',
    name: 'Ghost of the House',
    description: 'Linger as a watching corpse for five days or more after you fall.',
    points: 30,
  },
  {
    key: 'feat_untouchable',
    name: 'Untouchable',
    description: 'Win without ever leaving your seat in the graveyard — alive at the last.',
    points: 25,
  },
  {
    key: 'feat_pyrrhic',
    name: 'Pyrrhic Victory',
    description: 'Win the game on the very night you died — a victory you never saw.',
    points: 35,
  },
  {
    key: 'feat_solo_carry',
    name: 'Solo Carry',
    description: 'Win as an independent killer who outlived every rival blade.',
    points: 50,
  },
  {
    key: 'feat_kingmaker',
    name: 'Kingmaker',
    description: 'Win as the Executioner — bend the mob to your private grudge.',
    points: 45,
  },
  {
    key: 'feat_one_more_drink',
    name: 'One More Drink',
    description: 'Win as the Survivor — outlast the whole bloody affair by doing nothing.',
    points: 35,
  },
  {
    key: 'feat_plague_apotheosis',
    name: 'Apotheosis',
    description: 'Win having risen into Pestilence — the city rots and you remain.',
    points: 50,
  },
  {
    key: 'feat_house_always_wins',
    name: 'The House Always Wins',
    description: 'Win as the Pirate — plunder your duels and sail off rich.',
    points: 50,
  },
  {
    key: 'feat_grim_loyalty',
    name: 'Grim Loyalty',
    description: 'Die early (by day two) yet stay to the final curtain and still win.',
    points: 35,
  },
  {
    key: 'feat_clean_hands',
    name: 'Clean Hands',
    description: 'Win for the Town and walk away untouched — alive, the night it ended.',
    points: 30,
  },
] as const;

/** Every generated + feat achievement, ready to fold into the main catalog. */
export const EXTRA_ACHIEVEMENTS: readonly AchievementDefLike[] = [
  ...ROLE_WIN_ACHIEVEMENTS,
  ...FEAT_ACHIEVEMENTS,
];
