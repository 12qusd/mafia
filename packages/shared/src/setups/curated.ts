import type { GameSetup, SetupSlot } from '../types/setup.js';
import type { RoleId } from '../types/role.js';

const F = (role: RoleId): SetupSlot => ({ kind: 'fixed', role });
const RANDOM_TOWN: SetupSlot = { kind: 'category', category: 'RANDOM_TOWN' };
const RANDOM_MAFIA: SetupSlot = { kind: 'category', category: 'RANDOM_MAFIA' };

/**
 * "Cross-Examination" — a 15-player investigation duel. The Town is stacked
 * with information roles and the Mafia leans on a Framer to muddy every read,
 * with a Serial Killer lurking to punish sloppy claims.
 *
 * Town (9): Sheriff, Investigator, Investigator, Lookout, Doctor, Jailor,
 *           Escort, Mayor, + one RANDOM_TOWN.
 * Mafia (3): Godfather, Mafioso, Framer.
 * Neutral (3): Serial Killer, Jester, Executioner.
 */
const CROSS_EXAMINATION_15: SetupSlot[] = [
  // Town
  F('SHERIFF'),
  F('INVESTIGATOR'),
  F('INVESTIGATOR'),
  F('LOOKOUT'),
  F('DOCTOR'),
  F('JAILOR'),
  F('ESCORT'),
  F('MAYOR'),
  RANDOM_TOWN,
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  F('FRAMER'),
  // Neutral
  F('SERIAL_KILLER'),
  F('JESTER'),
  F('EXECUTIONER'),
];

export const CROSS_EXAMINATION: GameSetup = {
  id: 'cross-examination',
  name: 'Cross-Examination',
  description:
    'An information war for 15. The Town fields a small army of investigators; the Mafia ' +
    'answers with a forger who can frame anyone, and a lone killer waits for the town to ' +
    'trust the wrong read.',
  minPlayers: 15,
  maxPlayers: 15,
  // RANDOM_TOWN draws a support/protective role to round out the Town.
  townPool: ['CITIZEN', 'DOCTOR', 'ESCORT', 'VIGILANTE', 'LOOKOUT'],
  slotsByPlayerCount: {
    '15': CROSS_EXAMINATION_15,
  },
};

/**
 * "Gunsmoke" — a 15-player bloodbath. Killing power everywhere: two Vigilantes,
 * a Serial Killer, and a full Mafia, with extra doctors and a Survivor trying to
 * ride out the carnage. Claims get tested with bullets.
 *
 * Town (8): Jailor, Vigilante, Vigilante, Doctor, Doctor, Sheriff, Lookout,
 *           Citizen.
 * Mafia (3): Godfather, Mafioso, + one RANDOM_MAFIA.
 * Neutral (4): Serial Killer, Survivor, Jester, Executioner.
 */
const GUNSMOKE_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('VIGILANTE'),
  F('VIGILANTE'),
  F('DOCTOR'),
  F('DOCTOR'),
  F('SHERIFF'),
  F('LOOKOUT'),
  F('CITIZEN'),
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  RANDOM_MAFIA,
  // Neutral
  F('SERIAL_KILLER'),
  F('SURVIVOR'),
  F('JESTER'),
  F('EXECUTIONER'),
];

export const GUNSMOKE: GameSetup = {
  id: 'gunsmoke',
  name: 'Gunsmoke',
  description:
    'A 15-player powder keg. Two Vigilantes, a Serial Killer, and a full Mafia mean the body ' +
    'count runs high — extra Doctors and a Survivor scramble to keep anyone breathing.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'VIGILANTE', 'SHERIFF', 'LOOKOUT'],
  slotsByPlayerCount: {
    '15': GUNSMOKE_15,
  },
};

/**
 * "Smoke and Mirrors" — a 15-player table showcasing the expanded (batch-A and
 * batch-B) role roster. Every new trade gets a seat: a Mafia leaning on a
 * Janitor and a Disguiser to bury the truth, against a Town that fields a
 * Bodyguard, a Veteran, a Tracker, a Spy, and a Medium — plus a wandering
 * Amnesiac and a patient Arsonist among the neutrals.
 *
 * Town (8): Jailor, Sheriff, Bodyguard, Crusader, Veteran, Tracker, Psychic,
 *           Medium.
 * Mafia (3): Godfather, Janitor, + one RANDOM_MAFIA (Consigliere / Forger /
 *            Blackmailer / Disguiser / Ambusher / Hypnotist / Consort / Framer).
 * Neutral (4): Serial Killer, Arsonist, Amnesiac, Executioner.
 *
 * Showcases the full expanded roster: the Janitor is fixed (it is not in the
 * random pool) and the other Mafia support rotates through the RANDOM_MAFIA slot
 * (which now includes the Disguiser, Ambusher, and Hypnotist); the Town fields
 * the batch-B information roles (Tracker, Psychic, Medium) and the batch-A/C
 * protectives (Bodyguard, Crusader, Veteran); the neutrals add the batch-B
 * Amnesiac and Arsonist alongside the Serial Killer.
 */
const SMOKE_AND_MIRRORS_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('SHERIFF'),
  F('BODYGUARD'),
  F('CRUSADER'),
  F('VETERAN'),
  F('TRACKER'),
  F('PSYCHIC'),
  F('MEDIUM'),
  // Mafia
  F('GODFATHER'),
  F('JANITOR'),
  RANDOM_MAFIA,
  // Neutral
  F('SERIAL_KILLER'),
  F('ARSONIST'),
  F('AMNESIAC'),
  F('EXECUTIONER'),
];

export const SMOKE_AND_MIRRORS: GameSetup = {
  id: 'smoke-and-mirrors',
  name: 'Smoke and Mirrors',
  description:
    'A 15-player showcase of the expanded roster. The Mafia buries the truth with new tricks ' +
    'while the Town learns to make every late-night visit count — and a drifter and a firebug ' +
    'play their own games in the margins.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: [
    'CITIZEN',
    'DOCTOR',
    'SHERIFF',
    'LOOKOUT',
    'TRACKER',
    'SPY',
    'MEDIUM',
    'CRUSADER',
    'PSYCHIC',
  ],
  slotsByPlayerCount: {
    '15': SMOKE_AND_MIRRORS_15,
  },
};

/**
 * "Full Moon" — a 15-player showcase of the batch-D iconic neutrals. Three lone
 * killers stalk the same town — a Werewolf that only bites under a full moon, a
 * Mass Murderer who empties whole houses, and a Juggernaut that grows with every
 * body — while a Guardian Angel fights to keep one chosen soul breathing through
 * the slaughter. The Town leans on its protectives and the Mafia keeps its head
 * down and counts on the neutrals to thin the herd.
 *
 * Town (8): Jailor, Sheriff, Doctor, Bodyguard, Lookout, Vigilante, Escort,
 *           Citizen.
 * Mafia (3): Godfather, Mafioso, + one RANDOM_MAFIA.
 * Neutral (4): Werewolf, Mass Murderer, Juggernaut, Guardian Angel.
 */
const FULL_MOON_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('SHERIFF'),
  F('DOCTOR'),
  F('BODYGUARD'),
  F('LOOKOUT'),
  F('VIGILANTE'),
  F('ESCORT'),
  F('CITIZEN'),
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  RANDOM_MAFIA,
  // Neutral
  F('WEREWOLF'),
  F('MASS_MURDERER'),
  F('JUGGERNAUT'),
  F('GUARDIAN_ANGEL'),
];

export const FULL_MOON: GameSetup = {
  id: 'full-moon',
  name: 'Full Moon',
  description:
    'A 15-player bloodbath built around the lone killers. A Werewolf, a Mass Murderer, and a ' +
    'Juggernaut all hunt the same streets while a Guardian Angel guards one charge against the ' +
    'carnage. The Town clings to its protectives; the Mafia keeps its head down.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'BODYGUARD'],
  slotsByPlayerCount: {
    '15': FULL_MOON_15,
  },
};

const RANDOM_TRIAD: SetupSlot = { kind: 'category', category: 'RANDOM_TRIAD' };

/**
 * "Tong War" — a 15-player two-evil-faction brawl. A small Mafia and a small
 * Triad share the same streets: two informed killing factions that are NOT allies
 * — they must wipe each other (and a lurking Serial Killer) out before either can
 * win on parity. The Town, caught in the crossfire, tries to read which kills
 * belong to which family while a Jester angles to be lynched.
 *
 * Town (7): Jailor, Sheriff, Investigator, Doctor, Escort, Lookout, + RANDOM_TOWN.
 * Mafia (3): Godfather, Mafioso, + one RANDOM_MAFIA support.
 * Triad (3): Dragon Head, Enforcer, Vanguard (the Mafia's structural mirror).
 * Neutral (2): Serial Killer, Jester.
 *
 * This setup exercises the full two-evil-faction path: the 'triad' chat channel,
 * the Triad faction kill, both faction rosters, and the generalized win check
 * (Town vs Mafia vs Triad vs SK — no premature end while two killing factions live).
 */
const TONG_WAR_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('SHERIFF'),
  F('INVESTIGATOR'),
  F('DOCTOR'),
  F('ESCORT'),
  F('LOOKOUT'),
  RANDOM_TOWN,
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  RANDOM_MAFIA,
  // Triad
  F('DRAGON_HEAD'),
  F('ENFORCER'),
  RANDOM_TRIAD,
  // Neutral
  F('SERIAL_KILLER'),
  F('JESTER'),
];

export const TONG_WAR: GameSetup = {
  id: 'tong-war',
  name: 'Tong War',
  description:
    'A 15-player turf war between two crime families. A Mafia and a Triad work the same streets ' +
    "— rival killers who must bury each other before either can take the town. The Town reads " +
    'the bodies for a pattern; a lone cutthroat and a fool play their own angles.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'INVESTIGATOR'],
  slotsByPlayerCount: {
    '15': TONG_WAR_15,
  },
};

/**
 * "The Reckoning" — a 15-player showcase of the batch-E complex neutrals. A Witch
 * bends the town's own hands against itself, a Pirate duels for personal glory, a
 * Plaguebearer creeps toward the transformation into Pestilence, and a
 * Retributionist holds a single miracle in reserve to claw a fallen townsperson
 * back from the grave. The Mafia keeps its head down while the spoilers and the
 * plague carve up the board.
 *
 * Town (8): Jailor, Sheriff, Doctor, Lookout, Vigilante, Escort, Retributionist,
 *           Citizen.
 * Mafia (3): Godfather, Mafioso, + one RANDOM_MAFIA.
 * Neutral (4): Witch, Pirate, Plaguebearer, Serial Killer.
 */
const RECKONING_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('SHERIFF'),
  F('DOCTOR'),
  F('LOOKOUT'),
  F('VIGILANTE'),
  F('ESCORT'),
  F('RETRIBUTIONIST'),
  F('CITIZEN'),
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  RANDOM_MAFIA,
  // Neutral
  F('WITCH'),
  F('PIRATE'),
  F('PLAGUEBEARER'),
  F('SERIAL_KILLER'),
];

export const RECKONING: GameSetup = {
  id: 'reckoning',
  name: 'The Reckoning',
  description:
    'A 15-player showcase of the strangest neutrals. A Witch turns the town against itself, a ' +
    'Pirate duels for plunder, and a Plaguebearer spreads a sickness toward a terrible ' +
    'transformation — while a Retributionist guards a single miracle to call one fallen ' +
    'townsperson back from the dead.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'RETRIBUTIONIST'],
  slotsByPlayerCount: {
    '15': RECKONING_15,
  },
};
