import type { GameSetup, SetupSlot } from '../types/setup.js';
import type { RoleId } from '../types/role.js';

/** Convenience builders. */
const F = (role: RoleId): SetupSlot => ({ kind: 'fixed', role });
const RANDOM_MAFIA: SetupSlot = { kind: 'category', category: 'RANDOM_MAFIA' };

/**
 * "Classic Nocturne" — the default auto-scaling setup, 7–15 players, built
 * exactly from the BUILD_SPEC §6.10 table. Each count adds one slot to the
 * previous, cumulatively.
 *
 * | Players | Town | Mafia | Neutral |
 * |---------|------|-------|---------|
 * | 7       | 4    | 2     | 1       |
 * | 8       | 5    | 2     | 1       |
 * | 9       | 6    | 2     | 1       |
 * | 10      | 6    | 2     | 2       |
 * | 11      | 7    | 2     | 2       |
 * | 12      | 7    | 3     | 2       |
 * | 13      | 8    | 3     | 2       |
 * | 14      | 8    | 3     | 3       |
 * | 15      | 9    | 3     | 3       |
 */

// 7: Sheriff, Doctor, Jailor, Citizen | Godfather, Mafioso | Jester
const P7: SetupSlot[] = [
  F('SHERIFF'),
  F('DOCTOR'),
  F('JAILOR'),
  F('CITIZEN'),
  F('GODFATHER'),
  F('MAFIOSO'),
  F('JESTER'),
];

// 8: + Escort
const P8: SetupSlot[] = [...P7, F('ESCORT')];

// 9: + Vigilante
const P9: SetupSlot[] = [...P8, F('VIGILANTE')];

// 10: + Serial Killer
const P10: SetupSlot[] = [...P9, F('SERIAL_KILLER')];

// 11: + Investigator
const P11: SetupSlot[] = [...P10, F('INVESTIGATOR')];

// 12: + RANDOM_MAFIA
const P12: SetupSlot[] = [...P11, RANDOM_MAFIA];

// 13: + Lookout
const P13: SetupSlot[] = [...P12, F('LOOKOUT')];

// 14: + Executioner
const P14: SetupSlot[] = [...P13, F('EXECUTIONER')];

// 15: + Mayor
const P15: SetupSlot[] = [...P14, F('MAYOR')];

export const CLASSIC_NOCTURNE: GameSetup = {
  id: 'classic-nocturne',
  name: 'Classic Nocturne',
  description:
    'The house standard. Scales cleanly from 7 to 15 players: a dependable Town core, ' +
    'a small Mafia, and a rotating cast of neutrals that grows with the table.',
  minPlayers: 7,
  maxPlayers: 15,
  // RANDOM_TOWN is unused here (Town slots are all fixed), but the pool lists
  // the Town roles this setup draws on, for tooling/preview purposes.
  townPool: [
    'SHERIFF',
    'DOCTOR',
    'JAILOR',
    'CITIZEN',
    'ESCORT',
    'VIGILANTE',
    'INVESTIGATOR',
    'LOOKOUT',
    'MAYOR',
  ],
  slotsByPlayerCount: {
    '7': P7,
    '8': P8,
    '9': P9,
    '10': P10,
    '11': P11,
    '12': P12,
    '13': P13,
    '14': P14,
    '15': P15,
  },
};
