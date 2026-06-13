import type { RoleDefinition } from './types.js';

export const MAYOR: RoleDefinition = {
  id: 'MAYOR',
  name: 'Mayor',
  faction: 'TOWN',
  nightAction: 'none',
  dayAction: 'reveal',
  targetScope: 'none',
  unique: true,
  nightImmune: false,
  roleblockImmune: false,
  visits: false,
  sheriffResult: 'not_suspicious',
  investigatorClass: 'R7',
  tagline: 'The town gavel, once you choose to bang it.',
  description:
    'You hold office, but no one knows it until you say so. Once in a game you may stand up ' +
    'and reveal yourself to the whole town; from that moment your word at the ballot carries ' +
    'the weight of three voices. The trade is steep: a revealed mayor is a marked mayor, and ' +
    'no doctor will keep you breathing once you have shown your hand. Pick your moment.',
  winHint: 'Win with the Town: see every member of the Mafia and any lone killer dead.',
};
