import type { RoleDefinition } from './types.js';

export const CRUSADER: RoleDefinition = {
  id: 'CRUSADER',
  name: 'Crusader',
  faction: 'TOWN',
  // Protective/killing: shields a ward AND strikes a caller. The engine drives
  // the real behavior via the `crusade` night ability (mirrors the Bodyguard).
  nightAction: 'protect',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R6',
  tagline: 'You stand a holy watch — and woe to whoever comes calling.',
  description:
    'You keep a righteous vigil. Each night you may stand guard over one neighbor. A killer ' +
    'who comes for them finds you in the way — your ward walks off untouched, shielded from a ' +
    'single blow. But your zeal does not stop at the door: the first stranger you catch ' +
    'darkening your ward\'s step, you cut down where they stand, whoever they turn out to be. ' +
    'Guard a popular soul and you may strike an innocent caller by mistake. Choose the door ' +
    'you watch with care.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
