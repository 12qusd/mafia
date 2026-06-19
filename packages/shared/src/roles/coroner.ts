import type { RoleDefinition } from './types.js';

export const CORONER: RoleDefinition = {
  id: 'CORONER',
  name: 'Coroner',
  faction: 'TOWN',
  // Information role: produces a private read on a DEAD seat (the engine drives
  // the real behavior via the `autopsy` night ability).
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R3',
  tagline: 'The dead keep no secrets from the one who reads their wounds.',
  description:
    'You work the slab by lamplight, and you have learned that a body tells the whole story if ' +
    'you ask it right. Each night you may open up one of the dead and read what they were — ' +
    'their true trade laid bare, whatever face they wore in life. And the wounds remember ' +
    'hands: you can name everyone who came calling on that soul the night they died, the ' +
    'healer and the killer alike. The living guard their secrets; the dead cannot. Pick a ' +
    'fresh grave with a story worth telling.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
