import type { RoleDefinition } from './types.js';
import { DOCTOR_SELF_HEALS } from '../constants.js';

export const DOCTOR: RoleDefinition = {
  id: 'DOCTOR',
  name: 'Doctor',
  faction: 'TOWN',
  nightAction: 'protect',
  dayAction: 'none',
  targetScope: 'others_or_self',
  uses: { total: Infinity, selfTotal: DOCTOR_SELF_HEALS },
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R4',
  tagline: 'A black bag and no questions asked.',
  description:
    'Each night you may sit up with one neighbor and keep them breathing. If a killer comes ' +
    'for the patient you chose, you turn aside a single blade and they wake bruised but ' +
    'alive — you never learn who you saved, only that you worked. You may patch yourself just ' +
    'once in a game. You cannot pull a prisoner off the gallows, and an execution carried out ' +
    'in a jail cell is beyond any medicine.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
