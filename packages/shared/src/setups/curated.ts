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
 * "Smoke and Mirrors" — a 15-player table showcasing the expanded (batch-A)
 * role roster. Every new trade gets a seat: a Mafia leaning on a Consigliere,
 * Forger, Janitor, and Blackmailer to bury the truth, against a Town that fields
 * a Bodyguard and a Veteran to make the family pay for every visit.
 *
 * Town (8): Jailor, Sheriff, Doctor, Lookout, Mayor, Bodyguard, Veteran, Vigilante.
 * Mafia (4): Godfather, Mafioso, Janitor, + one RANDOM_MAFIA (Consigliere /
 *            Forger / Blackmailer / Consort / Framer).
 * Neutral (3): Serial Killer, Jester, Executioner.
 *
 * Showcases the full batch-A roster: the Janitor is fixed (it is not in the
 * random pool) and the other batch-A Mafia support rotates through the
 * RANDOM_MAFIA slot; the Town fields the Bodyguard and Veteran.
 */
const SMOKE_AND_MIRRORS_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('SHERIFF'),
  F('DOCTOR'),
  F('LOOKOUT'),
  F('MAYOR'),
  F('BODYGUARD'),
  F('VETERAN'),
  F('VIGILANTE'),
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  F('JANITOR'),
  RANDOM_MAFIA,
  // Neutral
  F('SERIAL_KILLER'),
  F('JESTER'),
  F('EXECUTIONER'),
];

export const SMOKE_AND_MIRRORS: GameSetup = {
  id: 'smoke-and-mirrors',
  name: 'Smoke and Mirrors',
  description:
    'A 15-player showcase of the expanded roster. The Mafia buries the truth with new tricks ' +
    'while the Town learns to make every late-night visit count.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE'],
  slotsByPlayerCount: {
    '15': SMOKE_AND_MIRRORS_15,
  },
};
