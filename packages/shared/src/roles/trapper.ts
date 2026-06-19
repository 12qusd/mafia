import type { RoleDefinition } from './types.js';

export const TRAPPER: RoleDefinition = {
  id: 'TRAPPER',
  name: 'Trapper',
  faction: 'TOWN',
  // Protective role: it shields a ward from one basic attack AND names a caller it
  // catches — but, unlike the Crusader, it does NOT kill. The engine drives the
  // real behavior via the `trap` night ability.
  nightAction: 'protect',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R7',
  tagline: 'Set the snare at dusk, and read the morning by what it caught.',
  description:
    'You are no gunhand — you are a trapper, and your craft is the snare, not the kill. Each ' +
    'night you may rig a trap at one neighbor\'s house. If a killer comes for them, the snare ' +
    'snaps shut on the blow: your ward walks off whole, spared a single strike. And the trap ' +
    'does not forget — come morning you can name one of the strangers it caught lurking at ' +
    'that door. You do not cut anyone down for it, the way a holy zealot might; you simply ' +
    'shield the one inside and hand yourself a name. Choose the door you rig with care.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
