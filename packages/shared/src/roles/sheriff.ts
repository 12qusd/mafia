import type { RoleDefinition } from './types.js';

export const SHERIFF: RoleDefinition = {
  id: 'SHERIFF',
  name: 'Sheriff',
  faction: 'TOWN',
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R2',
  tagline: 'A badge that still means something after dark.',
  description:
    'Each night you may shadow one neighbor and decide whether they smell of crime. ' +
    'Your report comes back plain: "suspicious" or "not suspicious." A working triggerman, ' +
    'a hired distraction, a forger, or a lone cutthroat will set off your instincts. ' +
    'But a careful boss can keep his hands clean enough to read innocent, and a framer can ' +
    'pin guilt on an honest soul for a night. Trust the pattern, not a single look.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
