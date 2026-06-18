import type { RoleDefinition } from './types.js';

export const AMBUSHER: RoleDefinition = {
  id: 'AMBUSHER',
  name: 'Ambusher',
  faction: 'MAFIA',
  // Killing support: stakes out a house and kills a caller. The engine drives
  // the real behavior via the `ambush` night ability (mafia mirror of Crusade).
  nightAction: 'kill',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R8',
  tagline: 'You wait in the dark across the street, and you do not wait alone for long.',
  description:
    'You do your work by sitting still. Each night you pick a house and lie in wait across the ' +
    'way. The first soul you see come calling on that door, you fall on — one caller, dead in ' +
    'the gutter, whoever they were. The one whose house you watched may never know how close ' +
    'it came. Stake out a busy address and you cannot choose who walks into your knife. Anyone ' +
    'keeping an eye on that street will spot you at your post, so pick your corner well.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
