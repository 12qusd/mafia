import type { RoleDefinition } from './types.js';

export const EXECUTIONER: RoleDefinition = {
  id: 'EXECUTIONER',
  name: 'Executioner',
  faction: 'NEUTRAL_BENIGN',
  nightAction: 'none',
  dayAction: 'none',
  targetScope: 'none',
  unique: false,
  nightImmune: true,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R1',
  tagline: 'A grudge with a name already chosen.',
  description:
    'You have marked one ordinary townsman for the gallows, and nothing else will satisfy ' +
    'you. You have no night action, but you cannot be killed in the dark — you mean to live ' +
    'long enough to watch your mark swing. Win by steering the town into voting your target ' +
    'to execution while you still draw breath. If your mark slips away to a night killing ' +
    'instead of the rope, your purpose curdles and you become a Jester, hungry only for your ' +
    'own hanging.',
  winHint: 'Win alone: get your assigned target executed by daylight vote while you live.',
};
