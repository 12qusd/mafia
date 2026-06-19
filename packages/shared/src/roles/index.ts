import type { RoleId, InvestigatorClass } from '../types/role.js';
import type { RoleDefinition } from './types.js';

import { CITIZEN } from './citizen.js';
import { SHERIFF } from './sheriff.js';
import { INVESTIGATOR } from './investigator.js';
import { LOOKOUT } from './lookout.js';
import { DOCTOR } from './doctor.js';
import { ESCORT } from './escort.js';
import { JAILOR } from './jailor.js';
import { VIGILANTE } from './vigilante.js';
import { MAYOR } from './mayor.js';
import { GODFATHER } from './godfather.js';
import { MAFIOSO } from './mafioso.js';
import { CONSORT } from './consort.js';
import { FRAMER } from './framer.js';
import { SERIAL_KILLER } from './serial_killer.js';
import { JESTER } from './jester.js';
import { EXECUTIONER } from './executioner.js';
import { SURVIVOR } from './survivor.js';
import { CONSIGLIERE } from './consigliere.js';
import { FORGER } from './forger.js';
import { JANITOR } from './janitor.js';
import { BODYGUARD } from './bodyguard.js';
import { BLACKMAILER } from './blackmailer.js';
import { VETERAN } from './veteran.js';
import { TRACKER } from './tracker.js';
import { SPY } from './spy.js';
import { AMNESIAC } from './amnesiac.js';
import { DISGUISER } from './disguiser.js';
import { ARSONIST } from './arsonist.js';
import { CRUSADER } from './crusader.js';
import { AMBUSHER } from './ambusher.js';
import { PSYCHIC } from './psychic.js';
import { HYPNOTIST } from './hypnotist.js';
import { WEREWOLF } from './werewolf.js';
import { MASS_MURDERER } from './mass_murderer.js';
import { GUARDIAN_ANGEL } from './guardian_angel.js';
import { JUGGERNAUT } from './juggernaut.js';
import { DRAGON_HEAD } from './dragon_head.js';
import { ENFORCER } from './enforcer.js';
import { VANGUARD } from './vanguard.js';
import { WITCH } from './witch.js';
import { PIRATE } from './pirate.js';
import { PLAGUEBEARER } from './plaguebearer.js';
import { PESTILENCE } from './pestilence.js';
import { VAMPIRE } from './vampire.js';
import { VAMPIRE_HUNTER } from './vampire_hunter.js';
import { CULT_LEADER } from './cult_leader.js';
import { CULTIST } from './cultist.js';
import { TRANSPORTER } from './transporter.js';
import { CORONER } from './coroner.js';
import { TRAPPER } from './trapper.js';

export type { RoleDefinition } from './types.js';
export type { NightActionKind, DayActionKind, TargetScope, AbilityUses } from './types.js';

export {
  CITIZEN,
  SHERIFF,
  INVESTIGATOR,
  LOOKOUT,
  DOCTOR,
  ESCORT,
  JAILOR,
  VIGILANTE,
  MAYOR,
  GODFATHER,
  MAFIOSO,
  CONSORT,
  FRAMER,
  SERIAL_KILLER,
  JESTER,
  EXECUTIONER,
  SURVIVOR,
  CONSIGLIERE,
  FORGER,
  JANITOR,
  BODYGUARD,
  BLACKMAILER,
  VETERAN,
  TRACKER,
  SPY,
  AMNESIAC,
  DISGUISER,
  ARSONIST,
  CRUSADER,
  AMBUSHER,
  PSYCHIC,
  HYPNOTIST,
  WEREWOLF,
  MASS_MURDERER,
  GUARDIAN_ANGEL,
  JUGGERNAUT,
  DRAGON_HEAD,
  ENFORCER,
  VANGUARD,
  WITCH,
  PIRATE,
  PLAGUEBEARER,
  PESTILENCE,
  VAMPIRE,
  VAMPIRE_HUNTER,
  CULT_LEADER,
  CULTIST,
  TRANSPORTER,
  CORONER,
  TRAPPER,
};

/** Registry of every role definition, keyed by id (BUILD_SPEC §6.5). */
export const ROLES: Readonly<Record<RoleId, RoleDefinition>> = {
  CITIZEN,
  SHERIFF,
  INVESTIGATOR,
  LOOKOUT,
  DOCTOR,
  ESCORT,
  JAILOR,
  VIGILANTE,
  MAYOR,
  GODFATHER,
  MAFIOSO,
  CONSORT,
  FRAMER,
  SERIAL_KILLER,
  JESTER,
  EXECUTIONER,
  SURVIVOR,
  CONSIGLIERE,
  FORGER,
  JANITOR,
  BODYGUARD,
  BLACKMAILER,
  VETERAN,
  TRACKER,
  SPY,
  AMNESIAC,
  DISGUISER,
  ARSONIST,
  CRUSADER,
  AMBUSHER,
  PSYCHIC,
  HYPNOTIST,
  WEREWOLF,
  MASS_MURDERER,
  GUARDIAN_ANGEL,
  JUGGERNAUT,
  DRAGON_HEAD,
  ENFORCER,
  VANGUARD,
  WITCH,
  PIRATE,
  PLAGUEBEARER,
  PESTILENCE,
  VAMPIRE,
  VAMPIRE_HUNTER,
  CULT_LEADER,
  CULTIST,
  TRANSPORTER,
  CORONER,
  TRAPPER,
};

/** Look up a role definition by id. */
export function getRole(id: RoleId): RoleDefinition {
  return ROLES[id];
}

/** All role definitions as an array. */
export const ALL_ROLES: readonly RoleDefinition[] = Object.values(ROLES);

/**
 * Investigator result-class table (BUILD_SPEC §6.6). Maps each class to the
 * roles that report there *un-framed*. Framed targets report R6 regardless
 * (handled by the engine, not this static table).
 */
export const INVESTIGATOR_CLASS_TABLE: Readonly<Record<InvestigatorClass, readonly RoleId[]>> = {
  R1: ['CITIZEN', 'SURVIVOR', 'EXECUTIONER', 'AMNESIAC', 'GUARDIAN_ANGEL', 'CULT_LEADER', 'CULTIST'],
  R2: ['SHERIFF', 'JAILOR', 'BLACKMAILER', 'TRACKER', 'VAMPIRE_HUNTER'],
  R3: ['INVESTIGATOR', 'JESTER', 'CONSIGLIERE', 'SPY', 'PSYCHIC', 'CORONER'],
  R4: ['DOCTOR', 'SERIAL_KILLER', 'MASS_MURDERER', 'PLAGUEBEARER', 'PESTILENCE', 'VAMPIRE'],
  R5: ['ESCORT', 'CONSORT', 'JANITOR', 'HYPNOTIST', 'VANGUARD'],
  R6: ['VIGILANTE', 'MAFIOSO', 'VETERAN', 'CRUSADER', 'WEREWOLF', 'JUGGERNAUT', 'ENFORCER', 'PIRATE'],
  R7: ['GODFATHER', 'MAYOR', 'BODYGUARD', 'ARSONIST', 'DRAGON_HEAD', 'TRAPPER'],
  R8: ['FRAMER', 'LOOKOUT', 'FORGER', 'DISGUISER', 'AMBUSHER', 'WITCH', 'TRANSPORTER'],
};

/**
 * The investigator class a framed target reports (BUILD_SPEC §6.6, §6.5 #13:
 * "result class containing Mafioso").
 */
export const FRAMED_INVESTIGATOR_CLASS: InvestigatorClass = 'R6';

/** Unique roles: at most one per setup (BUILD_SPEC §6.10). */
export const UNIQUE_ROLES: readonly RoleId[] = ALL_ROLES.filter((r) => r.unique).map((r) => r.id);

/** Roles a `RANDOM_MAFIA` slot may draw (BUILD_SPEC §6.10; batch A/B add support). */
export const RANDOM_MAFIA_POOL: readonly RoleId[] = [
  'CONSORT',
  'FRAMER',
  'CONSIGLIERE',
  'FORGER',
  'BLACKMAILER',
  'DISGUISER',
  'AMBUSHER',
  'HYPNOTIST',
];

/**
 * Roles a `RANDOM_TRIAD` slot may draw (Triad faction). Mirrors RANDOM_MAFIA but
 * scoped to the Triad's own support roster. The Triad's killing core (Dragon
 * Head / Enforcer) is placed via fixed slots, exactly like the Mafia core; this
 * pool fills the Triad's flexible support slot. Currently the Vanguard is the
 * only Triad support role, so a RANDOM_TRIAD slot resolves to a VANGUARD.
 */
export const RANDOM_TRIAD_POOL: readonly RoleId[] = ['VANGUARD'];
