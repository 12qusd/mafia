import type { RoleDefinition } from './types.js';

export const TRACKER: RoleDefinition = {
  id: 'TRACKER',
  name: 'Tracker',
  faction: 'TOWN',
  // Information role: produces a private read (the engine drives the real
  // behavior via the `investigate_track` night ability).
  nightAction: 'investigate',
  dayAction: 'none',
  targetScope: 'others',
  unique: false,
  nightImmune: false,
  roleblockImmune: false,
  visits: true,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R2',
  tagline: 'You don\'t watch a door — you follow the man through it.',
  description:
    'You learned your trade tailing people who did not want to be tailed. Each night you may ' +
    'pick one neighbor and shadow them through the dark. Come morning you can name every door ' +
    'they knocked on — the souls they went out to visit, whatever errand carried them there. ' +
    'It is the mirror of a watcher on a stoop: they see who came to a house, but you see where ' +
    'a person went. A neighbor who stayed home, or whose business kept them off the street, ' +
    'leaves you nothing to report.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
