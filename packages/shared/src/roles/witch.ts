import type { RoleDefinition } from './types.js';

export const WITCH: RoleDefinition = {
  id: 'WITCH',
  name: 'Witch',
  faction: 'NEUTRAL_BENIGN',
  // Control family: the engine drives the real behavior via the `witch_control`
  // night ability — she seizes a puppet (the night's `target`) and turns their
  // action against a second soul of her choosing (`target2`). The puppet visits
  // for her; the Witch herself visits the puppet she rides.
  nightAction: 'control',
  dayAction: 'none',
  targetScope: 'others',
  unique: true,
  // The dark answers to her: she cannot be roleblocked, controlled, or killed in
  // the night. Only the cell and the rope can reach her.
  nightImmune: true,
  roleblockImmune: true,
  visits: true,
  sheriffResult: 'suspicious',
  investigatorClass: 'R8',
  tagline: 'You do not kill. You make others kill for you.',
  description:
    'You keep no knife and fire no shot — your power is the hand of another. Each night you ' +
    'seize a soul and bend their will: whatever they meant to do, you point it instead at a ' +
    'name of your choosing. A doctor heals your enemy; a gunman shoots their own friend; a ' +
    'killer is steered to a door you pick. The one you ride feels only that a force not their ' +
    'own moved their hand — they never see your face. No roleblock holds you, no other puppeteer ' +
    'can seize you, and the night cannot kill you. You answer to no faction; you simply want to ' +
    'be standing when the dust settles, on whichever side the town does not win.',
  winHint:
    'Win as a spoiler: be alive at the end of a game the Town does NOT win — ride any other side.',
};
