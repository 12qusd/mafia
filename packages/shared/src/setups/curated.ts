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
 * Bodyguard, a Veteran, a Tracker, a Psychic, and a Spy — plus a wandering
 * Amnesiac and a patient Arsonist among the neutrals.
 *
 * Town (8): Jailor, Sheriff, Bodyguard, Crusader, Veteran, Tracker, Psychic,
 *           Spy.
 * Mafia (3): Godfather, Janitor, + one RANDOM_MAFIA (Consigliere / Forger /
 *            Blackmailer / Disguiser / Ambusher / Hypnotist / Consort / Framer).
 * Neutral (4): Serial Killer, Arsonist, Amnesiac, Executioner.
 *
 * Showcases the full expanded roster: the Janitor is fixed (it is not in the
 * random pool) and the other Mafia support rotates through the RANDOM_MAFIA slot
 * (which now includes the Disguiser, Ambusher, and Hypnotist); the Town fields
 * the batch-B information roles (Tracker, Psychic, Spy) and the batch-A/C
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
  F('SPY'),
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
 * Plaguebearer creeps toward the transformation into Pestilence, and a Coroner
 * works the slab to read the truth the dead carried out of the world. The Mafia
 * keeps its head down while the spoilers and the plague carve up the board.
 *
 * Town (8): Jailor, Sheriff, Doctor, Lookout, Vigilante, Escort, Coroner,
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
  F('CORONER'),
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
    'transformation — while a Coroner works the slab to read the truth the dead carried out ' +
    'of the world.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'CORONER'],
  slotsByPlayerCount: {
    '15': RECKONING_15,
  },
};

/**
 * "The Long Night" — a 15-player showcase of the Vampire conversion faction. Two
 * Vampires open the night, and every successful bite swells the coven from the
 * town's own ranks — so the danger grows the longer the town dithers. A lone
 * Vampire Hunter is the town's one true answer: a stake for any vampire that comes
 * to turn them, and a check to root the coven out by lamplight (and when the last
 * vampire falls, the Hunter takes up a pistol as a Vigilante). A small Mafia keeps
 * its head down and works the chaos, while the town fields its readers and
 * protectives. Conversion play happens, and the game still terminates: the coven
 * wins by reaching parity, or the town stakes and lynches it out.
 *
 * Town (10): Vampire Hunter, Jailor, Sheriff, Investigator, Doctor, Lookout,
 *            Escort, Vigilante, + two RANDOM_TOWN.
 * Mafia (3): Godfather, Mafioso, + one RANDOM_MAFIA.
 * Vampire (2): Vampire, Vampire.
 *
 * Exercises the full conversion path: the `bite` ability + the `turned`
 * private_result, the lowest-seat one-bite-per-night rule, the Vampire Hunter's
 * stake (cause `staked`) + check + retirement to Vigilante, the third evil
 * faction in the generalized win check, and the knowledge-isolated design (no
 * vampire chat / roster — verified by the leak sweep).
 */
const LONG_NIGHT_15: SetupSlot[] = [
  // Town
  F('VAMPIRE_HUNTER'),
  F('JAILOR'),
  F('SHERIFF'),
  F('INVESTIGATOR'),
  F('DOCTOR'),
  F('LOOKOUT'),
  F('ESCORT'),
  F('VIGILANTE'),
  RANDOM_TOWN,
  RANDOM_TOWN,
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  RANDOM_MAFIA,
  // Vampire
  F('VAMPIRE'),
  F('VAMPIRE'),
];

export const LONG_NIGHT: GameSetup = {
  id: 'the-long-night',
  name: 'The Long Night',
  description:
    'A 15-player showcase of the coven. Two Vampires turn the town against itself one bite at a ' +
    'time — every kill recruits — while a lone Vampire Hunter stakes the ones who come for them ' +
    'and hunts the rest by lamplight. A quiet Mafia works the chaos. The longer the town waits, ' +
    'the larger the coven grows.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'BODYGUARD'],
  slotsByPlayerCount: {
    '15': LONG_NIGHT_15,
  },
};

/**
 * "The Faithful" — a 15-player showcase of the Cult conversion faction. A lone
 * Cult Leader preaches in the dark, drawing the town into the fold one soul at a
 * time (one recruit per night, with a night's rest after each). Every conversion
 * is a townsperson lost — so the longer the town waits, the larger the flock. But
 * the Cult lives and dies with its Leader: kill or lynch them and the recruiting
 * stops cold (a headless flock can hold a room by numbers, but it grows no more).
 * The town fields its readers and a Vigilante/Jailor to root the Leader out, while
 * a small Mafia works the chaos. The game terminates: the Cult wins by reaching
 * parity, or the town finds the Leader and ends the gathering.
 *
 * Town (11): Jailor, Sheriff, Investigator, Doctor, Lookout, Escort, Vigilante,
 *            Bodyguard, + three RANDOM_TOWN.
 * Mafia (3): Godfather, Mafioso, + one RANDOM_MAFIA.
 * Cult (1): Cult Leader.
 *
 * Exercises the full recruitment path: the `recruit` ability + the `recruited`
 * private_result, the Cult-Leader-only one-recruit-per-night rule, the one-night
 * cooldown, recruitment stopping when the Leader dies, the fourth evil faction in
 * the generalized win check, and the knowledge-isolated design (no cult chat /
 * roster — verified by the leak sweep).
 */
const FAITHFUL_15: SetupSlot[] = [
  // Town
  F('JAILOR'),
  F('SHERIFF'),
  F('INVESTIGATOR'),
  F('DOCTOR'),
  F('LOOKOUT'),
  F('ESCORT'),
  F('VIGILANTE'),
  F('BODYGUARD'),
  RANDOM_TOWN,
  RANDOM_TOWN,
  RANDOM_TOWN,
  // Mafia
  F('GODFATHER'),
  F('MAFIOSO'),
  RANDOM_MAFIA,
  // Cult
  F('CULT_LEADER'),
];

export const FAITHFUL: GameSetup = {
  id: 'the-faithful',
  name: 'The Faithful',
  description:
    'A 15-player showcase of the Cult. A lone Cult Leader draws the town into the fold one soul ' +
    'at a time — every convert is one of the town’s own, sworn and silent — while a small ' +
    'Mafia works the chaos. The flock lives and dies with its Leader: find them, and the ' +
    'gathering ends. The longer the town waits, the more of it belongs to the Cult.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'BODYGUARD'],
  slotsByPlayerCount: {
    '15': FAITHFUL_15,
  },
};

/**
 * "Cold Cases" — a 15-player showcase of the batch-F distinct-mechanic Town roles.
 * A Transporter swaps two houses each night, carrying a killer's knife onto an
 * empty bed or a doctor's hand onto a dying friend; a Coroner reads the dead on the
 * slab to learn what they were and who came calling the night they fell; and a
 * Trapper rigs snares that spare a ward one blow and hand it a caller's name — but
 * never a kill. The Mafia fields a Janitor and a Framer to fog the bodies the
 * Coroner would read, while a Serial Killer and a Jester play their own angles.
 *
 * Town (8): Transporter, Coroner, Trapper, Jailor, Sheriff, Doctor, Lookout,
 *           Vigilante.
 * Mafia (3): Godfather, Janitor, + one RANDOM_MAFIA.
 * Neutral (4): Serial Killer, Jester, Executioner, Survivor.
 *
 * Exercises the full batch-F path: the `transport` two-target swap + its kill/visit
 * redirect, the `autopsy` read (the `coroner_result` role carrier) against the
 * Janitor/Framer fog, and the `trap` protect-and-name (the leak-trivial
 * `trapper_result`). Added to the leakcheck + sim CLI SETUP_MAPs.
 */
const COLD_CASES_15: SetupSlot[] = [
  // Town
  F('TRANSPORTER'),
  F('CORONER'),
  F('TRAPPER'),
  F('JAILOR'),
  F('SHERIFF'),
  F('DOCTOR'),
  F('LOOKOUT'),
  F('VIGILANTE'),
  // Mafia
  F('GODFATHER'),
  F('JANITOR'),
  RANDOM_MAFIA,
  // Neutral
  F('SERIAL_KILLER'),
  F('JESTER'),
  F('EXECUTIONER'),
  F('SURVIVOR'),
];

export const COLD_CASES: GameSetup = {
  id: 'cold-cases',
  name: 'Cold Cases',
  description:
    'A 15-player showcase of the strangest honest trades in town. A Transporter quietly swaps ' +
    'two houses each night, a Coroner reads the dead for the truth they kept in life, and a ' +
    'Trapper rigs snares that shield a friend and name a prowler — while a Mafia Janitor scrubs ' +
    'the very bodies the Coroner would open.',
  minPlayers: 15,
  maxPlayers: 15,
  townPool: ['CITIZEN', 'DOCTOR', 'SHERIFF', 'LOOKOUT', 'VIGILANTE', 'TRANSPORTER', 'CORONER', 'TRAPPER'],
  slotsByPlayerCount: {
    '15': COLD_CASES_15,
  },
};
