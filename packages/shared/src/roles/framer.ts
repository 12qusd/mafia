import type { RoleDefinition } from './types.js';

export const FRAMER: RoleDefinition = {
  id: 'FRAMER',
  name: 'Framer',
  faction: 'MAFIA',
  nightAction: 'frame',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R8',
  tagline: 'Evidence is whatever you leave behind.',
  description:
    'You deal in false trails. Each night you may plant the marks of guilt on one neighbor: ' +
    'for that night a sheriff will read them as a criminal, and a careful investigator will ' +
    'find the signs of a hired gun. The lie washes out by the next dawn, so your craft is in ' +
    'timing — set up an honest townsman to take the rope while your family keeps its hands ' +
    'clean.',
  winHint: 'Win with the Mafia: control the town by reaching numbers no one can vote down.',
};
