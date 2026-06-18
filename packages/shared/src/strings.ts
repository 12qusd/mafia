import { GAME_NAME } from './constants.js';
import type { ErrorCode } from './protocol/errors.js';
import type { PrivateResultKind } from './protocol/enums.js';
import type { DeathCause } from './types/death.js';
import type { SheriffResult } from './types/role.js';

/**
 * Single source of all user-facing copy (BUILD_SPEC §13.2).
 *
 * Every string here is ORIGINAL, written fresh for this project in a 1920s
 * noir/Prohibition voice (§2.1.2, §2.1.4). None is copied from Town of Salem,
 * SC2Mafia, or any other game. Mechanical facts are stated in our own words.
 *
 * Keeping all copy in one module enables localization later (§13.2). The client
 * renders these; the engine/protocol carry only machine keys.
 */

/** Generic UI labels. */
export const UI = {
  appName: GAME_NAME,
  tagline: 'A town full of secrets, and a long night ahead.',
  playAsGuest: 'Slip in quietly',
  login: 'Sign in',
  register: 'Open an account',
  createLobby: 'Start a table',
  joinByCode: 'Join with a code',
  startGame: 'Deal the cards',
  playAgain: 'Same crowd, again',
  leaveGame: 'Walk out',
  spectate: 'Watch from the shadows',
  lastWillLabel: 'Last will',
  deathNoteLabel: 'Calling card',
  reveal: 'Show your hand',
  jail: 'Jail',
  execute: 'Send to the gallows',
  vote: 'Cast a vote',
  skip: 'Skip the day',
  guilty: 'Guilty',
  innocent: 'Innocent',
  abstain: 'Stay silent',
} as const;

/** Phase banners (public announcement headers). */
export const PHASE_BANNER = {
  LOBBY: 'Gathering at the table',
  ASSIGN: 'The cards are dealt',
  DAY_0: 'First light — no rope today',
  NIGHT: 'Night falls over the city',
  DAWN: 'Morning, and a reckoning',
  DAY_DISCUSSION: 'The town talks it over',
  DAY_VOTING: 'Time to name a name',
  TRIAL_DEFENSE: 'The accused has the floor',
  TRIAL_JUDGMENT: 'The town renders its verdict',
  EXECUTION: 'Last words at the gallows',
  GAME_OVER: 'The dust settles',
} as const;

/**
 * Public announcements (parameterized by callers). Functions take only plain
 * data so they stay pure and localizable.
 */
export const ANNOUNCE = {
  gameStart: `The lamps are lit and the cards are dealt. Trust no one until ${GAME_NAME} is won.`,
  noOneDied: 'The night passed quietly. No bodies this morning — for once.',
  nightFalls: 'Doors lock and lamps dim. Whatever happens now happens in the dark.',
  trialBegins: (seatLabel: string) => `${seatLabel} stands accused. Speak now or swing.`,
  putOnTrial: (seatLabel: string) => `The town has dragged ${seatLabel} before the bench.`,
  foundGuilty: (seatLabel: string) => `${seatLabel} is found guilty. Walk them out.`,
  foundInnocent: (seatLabel: string) => `${seatLabel} walks free — the town could not agree.`,
  dayEndsNoLynch: 'The town could not settle on anyone. No rope today.',
  mayorRevealed: (seatLabel: string) =>
    `${seatLabel} steps forward as Mayor — their word now carries the weight of three.`,
  stalemate: 'Three silent nights in a row. The standoff breaks; the larger force takes the town.',
} as const;

/**
 * Death announcement lines, keyed by cause (BUILD_SPEC §6.8, §13.2). The caller
 * supplies the seat label and revealed role name.
 */
export function deathLine(cause: DeathCause, seatLabel: string, roleName: string): string {
  switch (cause) {
    case 'mafia':
      return `${seatLabel} was found in an alley, cold. They were the ${roleName}.`;
    case 'serial_killer':
      return `${seatLabel} met a private kind of violence in the night. They were the ${roleName}.`;
    case 'vigilante':
      return `${seatLabel} was gunned down by a citizen who took the law in hand. They were the ${roleName}.`;
    case 'jailor_execute':
      return `${seatLabel} did not leave the cell alive. They were the ${roleName}.`;
    case 'jester_grief':
      return `${seatLabel} died in the night, struck down by grief no one could mend. They were the ${roleName}.`;
    case 'lynch':
      return `${seatLabel} dropped at the end of the town's rope. They were the ${roleName}.`;
    case 'leave':
      return `${seatLabel} walked out into the dark and never came back. They were the ${roleName}.`;
    case 'admin':
      return `${seatLabel} was struck from the game by the hand of the house. They were the ${roleName}.`;
    case 'bodyguard':
      return `${seatLabel} was cut down by a hired guard while reaching for someone else. They were the ${roleName}.`;
    case 'veteran':
      return `${seatLabel} knocked on the wrong door and met a barrel of buckshot. They were the ${roleName}.`;
    case 'arsonist':
      return `${seatLabel} woke to a house full of fire and never made it out. They were the ${roleName}.`;
    default: {
      // Exhaustiveness guard.
      const _never: never = cause;
      return _never;
    }
  }
}

/**
 * Death line for a body the Janitor sanitized (batch A): the cause is shown but
 * the role and last will are gone — the town learns nothing from the corpse.
 */
export function cleanedDeathLine(seatLabel: string): string {
  return `${seatLabel} was found in the morning, but the scene had been wiped clean — no papers, no clue what they were.`;
}

/**
 * Private night-result strings (BUILD_SPEC §6.7, §6.8, §13.2) — reworded fresh
 * in noir voice. The `target`/extra labels are supplied by the caller.
 */
export const PRIVATE_RESULT_TEXT: Record<PrivateResultKind, string> = {
  sheriff_result: '', // resolved via sheriffResultLine (needs the verdict)
  investigator_result: '', // resolved via investigatorResultLine (needs the class)
  consigliere_result: '', // resolved via consigliereResultLine (needs the role)
  janitor_result: '', // resolved via janitorResultLine (needs the cleaned role)
  lookout_result: '', // resolved via lookoutResultLine (needs the visitors)
  roleblocked: 'Someone kept you tied up all evening. Your work never got done.',
  block_failed: 'You tried, but your mark would not be drawn away from their business.',
  target_unreachable: 'Your mark was nowhere to be found tonight — locked away beyond your reach.',
  attacked_survived: 'You struck, but your mark shrugged it off and walked away whole.',
  was_attacked: 'A blade came for you in the dark — and somehow it did not land.',
  was_healed: 'You were attacked tonight, but a steady hand patched you up before dawn.',
  jailed: 'Rough hands hauled you to a cell. You spent the night behind bars, idle.',
  blackmailed:
    'A note slid under your door names a secret you cannot afford aired. Keep your mouth shut tomorrow, or it goes public.',
  tracker_result: '', // resolved via trackerResultLine (needs the visited seats)
  spy_result: '', // resolved via spyResultLine (needs the mafia-visited seats)
  remember_result: '', // resolved via rememberResultLine (needs the new role)
};

/** Sheriff result line (BUILD_SPEC §6.6). */
export function sheriffResultLine(targetLabel: string, result: SheriffResult): string {
  return result === 'suspicious'
    ? `Your gut says ${targetLabel} is mixed up in something rotten — suspicious.`
    : `${targetLabel} came back clean. Nothing to pin on them — not suspicious.`;
}

/** Investigator result line (BUILD_SPEC §6.6). The caller formats the role list. */
export function investigatorResultLine(targetLabel: string, possibleRoleNames: string[]): string {
  const list = possibleRoleNames.join(', ');
  return `Your digging on ${targetLabel} narrows them to one of: ${list}.`;
}

/** Consigliere exact-role result line (batch A). The caller supplies the role name. */
export function consigliereResultLine(targetLabel: string, roleName: string): string {
  return `Your inquiries into ${targetLabel} leave no doubt — they are the ${roleName}.`;
}

/** Janitor cleaned-body result line (batch A). The caller supplies the role name. */
export function janitorResultLine(targetLabel: string, roleName: string): string {
  return `You scrubbed the scene around ${targetLabel} clean. For the record, they were the ${roleName}.`;
}

/** Lookout result line (BUILD_SPEC §6.5). */
export function lookoutResultLine(targetLabel: string, visitorLabels: string[]): string {
  if (visitorLabels.length === 0) {
    return `No one came to ${targetLabel}'s door all night.`;
  }
  return `You watched ${targetLabel}'s door. Callers tonight: ${visitorLabels.join(', ')}.`;
}

/** Tracker result line (batch B). The caller formats the visited-seat labels. */
export function trackerResultLine(targetLabel: string, visitedLabels: string[]): string {
  if (visitedLabels.length === 0) {
    return `You shadowed ${targetLabel} all night. They never left their own doorstep.`;
  }
  return `You shadowed ${targetLabel}. They paid a call on: ${visitedLabels.join(', ')}.`;
}

/** Spy result line (batch B). The caller formats the mafia-visited seat labels. */
export function spyResultLine(visitedLabels: string[]): string {
  if (visitedLabels.length === 0) {
    return `You kept your ear to the wall, but the family stayed in all night.`;
  }
  return `Word from the inside: the family called on ${visitedLabels.join(', ')} tonight.`;
}

/** Amnesiac remember result line (batch B). The caller supplies the new role name. */
export function rememberResultLine(targetLabel: string, roleName: string): string {
  return `You knelt at ${targetLabel}'s grave and it all came back — you are the ${roleName} now.`;
}

/** Error-code → human message (BUILD_SPEC §9). */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_message: 'That message did not make sense to the table.',
  unknown_type: 'The table does not understand that request.',
  unsupported_protocol: 'Your client is out of date. Please refresh.',
  rate_limited: 'Slow down — you are talking too fast.',
  not_authenticated: 'You need to be signed in to do that.',
  lobby_not_found: 'No such table.',
  lobby_full: 'That table is full.',
  invalid_invite_code: 'That invite code does not open any door.',
  not_host: 'Only the host can do that.',
  already_in_lobby: 'You are already seated at a table.',
  not_in_lobby: 'You are not at a table.',
  bad_config: 'Those settings fall outside what the house allows.',
  unknown_setup: 'No such game setup.',
  cannot_start: 'The table is not ready to begin.',
  not_in_game: 'There is no game underway for you.',
  wrong_phase: 'You cannot do that right now.',
  seat_dead: 'The dead do not act.',
  illegal_target: 'You cannot choose that target.',
  ability_unavailable: 'You have no such move to make.',
  not_your_turn: 'It is not your moment to act.',
  whispers_disabled: 'Whispering is off at this table.',
  spectator_forbidden: 'Onlookers cannot take part in the game.',
  forbidden: 'You are not allowed to do that.',
  internal_error: 'Something went wrong at the table. Try again.',
};
