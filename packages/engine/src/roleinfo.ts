/**
 * Role → engine ability mapping and `your_role` / ability-info construction.
 *
 * The protocol's `night_action.ability` is a free-form string the server
 * validates; the engine works in concrete {@link NightAbility} keys. This module
 * maps a seat's role to its night ability key (so the server can translate a
 * generic "act" command), and builds the per-seat `your_role` effect with the
 * mafia roster delivered only to mafia (§5).
 */

import {
  type RoleId,
  type SeatId,
  type Effect,
  ROLES,
  PROTOCOL_VERSION,
  VIGILANTE_BULLETS,
  JAILOR_EXECUTIONS,
  SURVIVOR_VESTS,
} from '@nocturne/shared';
import type { AbilityInfo } from '@nocturne/shared';
import type { GameState, NightAbility, SeatState } from './state.js';

/** The concrete night ability a role submits (or null for passive roles). */
export function roleToNightAbility(role: RoleId): NightAbility | null {
  switch (role) {
    case 'SHERIFF':
      return 'investigate_sheriff';
    case 'INVESTIGATOR':
      return 'investigate_investigator';
    case 'CONSIGLIERE':
      return 'investigate_consigliere';
    case 'LOOKOUT':
      return 'watch';
    case 'TRACKER':
      return 'investigate_track';
    case 'SPY':
      return 'spy';
    case 'AMNESIAC':
      return 'remember';
    case 'DOCTOR':
      return 'protect';
    case 'BODYGUARD':
      return 'guard';
    case 'CRUSADER':
      return 'crusade';
    case 'AMBUSHER':
      return 'ambush';
    case 'PSYCHIC':
      return 'divine';
    case 'HYPNOTIST':
      return 'hypnotize';
    case 'WEREWOLF':
      return 'rampage';
    case 'MASS_MURDERER':
      return 'massacre';
    case 'GUARDIAN_ANGEL':
      return 'shield';
    case 'JUGGERNAUT':
      return 'juggernaut';
    case 'SURVIVOR':
      return 'vest';
    case 'ESCORT':
    case 'CONSORT':
    case 'VANGUARD':
      return 'roleblock';
    case 'VIGILANTE':
      return 'kill_vigilante';
    case 'VETERAN':
      return 'alert';
    case 'MAFIOSO':
      return 'kill_mafia';
    case 'ENFORCER':
      return 'kill_triad';
    case 'DRAGON_HEAD':
      return 'triad_control';
    case 'SERIAL_KILLER':
      return 'kill_serial';
    case 'FRAMER':
      return 'frame';
    case 'FORGER':
      return 'forge';
    case 'JANITOR':
      return 'clean';
    case 'BLACKMAILER':
      return 'blackmail';
    case 'DISGUISER':
      return 'disguise';
    case 'ARSONIST':
      // Default night key is the douse (the kill is the separate `ignite` toggle,
      // surfaced as its own ability-info entry below).
      return 'douse';
    case 'GODFATHER':
      return 'mafia_control';
    // --- Role-expansion batch E ---
    case 'WITCH':
      return 'witch_control';
    case 'PIRATE':
      return 'duel';
    case 'PLAGUEBEARER':
      return 'infect';
    case 'PESTILENCE':
      return 'pestilence';
    case 'RETRIBUTIONIST':
      return 'retribute';
    // --- Vampire conversion faction ---
    case 'VAMPIRE':
      return 'bite';
    case 'VAMPIRE_HUNTER':
      return 'vampire_check';
    // --- Cult conversion faction ---
    case 'CULT_LEADER':
      return 'recruit';
    // CULTIST has no night ability (only the Leader recruits).
    // --- Role-expansion batch F ---
    case 'TRANSPORTER':
      return 'transport';
    case 'CORONER':
      return 'autopsy';
    case 'TRAPPER':
      return 'trap';
    // JAILOR's execution uses 'kill_jailor', but only after a jailing — handled
    // by the server when the jailor presses "execute".
    case 'JAILOR':
      return 'kill_jailor';
    default:
      return null;
  }
}

/**
 * The target-domain an ability picker presents (BUILD_SPEC §13.1). This is the
 * single source of truth the client uses to choose its picker: a LIVING-seat
 * picker, a DEAD-grave picker, or a no-target SELF toggle.
 *   - `dead`   — grave-targeting abilities: autopsy (Coroner), retribute
 *                (Retributionist), remember (Amnesiac), disguise (Disguiser).
 *   - `self` / `none` — no external target: alert (Veteran), vest (Survivor),
 *                ignite (Arsonist), spy (Spy), divine (Psychic), séance (Medium),
 *                and self-passive reveals (Mayor).
 *   - `living` — everything else (it resolves against a living seat in resolve.ts).
 * Two-target abilities (witch_control, transport) keep `living` (both ends live).
 */
const ABILITY_DOMAIN: Record<string, AbilityInfo['targetDomain']> = {
  // --- DEAD-grave targets ---
  autopsy: 'dead',
  retribute: 'dead',
  remember: 'dead',
  disguise: 'dead',
  // --- SELF / no-target toggles ---
  alert: 'self',
  vest: 'self',
  ignite: 'self',
  spy: 'self',
  divine: 'self',
  seance: 'self',
  reveal: 'self',
};

/** Short imperative the UI shows on each ability button (BUILD_SPEC §13.1). */
const ABILITY_VERB: Record<string, string> = {
  // Town investigative
  investigate_sheriff: 'Check',
  investigate_investigator: 'Investigate',
  investigate_consigliere: 'Investigate',
  investigate_track: 'Track',
  watch: 'Watch',
  spy: 'Listen',
  divine: 'Divine',
  seance: 'Séance',
  // Town protective / support
  protect: 'Heal',
  guard: 'Guard',
  crusade: 'Crusade',
  shield: 'Shield',
  vest: 'Vest',
  alert: 'Alert',
  transport: 'Transport',
  trap: 'Trap',
  // Town killing
  kill_vigilante: 'Shoot',
  kill_jailor: 'Execute',
  jail: 'Jail',
  retribute: 'Revive',
  vampire_check: 'Hunt',
  // Roleblocks / control
  roleblock: 'Roleblock',
  hypnotize: 'Hypnotize',
  witch_control: 'Control',
  // Mafia / Triad
  kill_mafia: 'Kill',
  kill_triad: 'Kill',
  mafia_control: 'Order kill',
  triad_control: 'Order kill',
  frame: 'Frame',
  forge: 'Forge',
  clean: 'Clean',
  blackmail: 'Blackmail',
  disguise: 'Disguise',
  ambush: 'Ambush',
  // Neutral killing
  kill_serial: 'Stab',
  douse: 'Douse',
  ignite: 'Ignite',
  rampage: 'Rampage',
  massacre: 'Massacre',
  juggernaut: 'Crush',
  infect: 'Infect',
  pestilence: 'Reap',
  // Conversion factions
  bite: 'Bite',
  recruit: 'Recruit',
  // Neutral benign / other
  duel: 'Duel',
  autopsy: 'Autopsy',
  remember: 'Remember',
  reveal: 'Reveal',
};

/** Domain for an ability id — defaults to `living` (the common case). */
function domainOf(id: string): AbilityInfo['targetDomain'] {
  return ABILITY_DOMAIN[id] ?? 'living';
}

/** Verb for an ability id — falls back to a generic "Act" if unmapped. */
function verbOf(id: string): string {
  return ABILITY_VERB[id] ?? 'Act';
}

/** Build one AbilityInfo, attaching its domain + verb from the central tables. */
function ability(
  id: string,
  name: string,
  timing: AbilityInfo['timing'],
  usesRemaining: number | null,
): AbilityInfo {
  return { id, name, timing, usesRemaining, targetDomain: domainOf(id), verb: verbOf(id) };
}

/** Build the per-role ability-info list for the role card (§9.2 your_role). */
export function abilityInfoFor(seat: SeatState): AbilityInfo[] {
  const def = ROLES[seat.role];
  const out: AbilityInfo[] = [];
  switch (seat.role) {
    case 'VIGILANTE':
      out.push(ability('kill_vigilante', 'Shoot', 'night', seat.usesRemaining));
      break;
    case 'VETERAN':
      out.push(ability('alert', 'Alert', 'night', seat.usesRemaining));
      break;
    case 'JAILOR':
      out.push(ability('jail', 'Jail', 'day', null));
      out.push(ability('kill_jailor', 'Execute', 'night', seat.usesRemaining));
      break;
    case 'SURVIVOR':
      out.push(ability('vest', 'Vest', 'night', seat.usesRemaining));
      break;
    case 'JANITOR':
      out.push(ability('clean', 'Clean', 'night', seat.usesRemaining));
      break;
    case 'MEDIUM':
      // The séance is opened during the day (like jailing) and resolves at night.
      out.push(ability('seance', 'Séance', 'day', seat.usesRemaining));
      break;
    case 'ARSONIST':
      out.push(ability('douse', 'Douse', 'night', null));
      out.push(ability('ignite', 'Ignite', 'night', null));
      break;
    case 'WEREWOLF':
      out.push(ability('rampage', 'Rampage', 'night', null));
      break;
    case 'MASS_MURDERER':
      out.push(ability('massacre', 'Massacre', 'night', null));
      break;
    case 'GUARDIAN_ANGEL':
      out.push(ability('shield', 'Watch over', 'night', null));
      break;
    case 'JUGGERNAUT':
      out.push(ability('juggernaut', 'Crush', 'night', null));
      break;
    case 'WITCH':
      out.push(ability('witch_control', 'Control', 'night', null));
      break;
    case 'PIRATE':
      out.push(ability('duel', 'Duel', 'night', null));
      break;
    case 'PLAGUEBEARER':
      out.push(ability('infect', 'Infect', 'night', null));
      break;
    case 'PESTILENCE':
      out.push(ability('pestilence', 'Reap', 'night', null));
      break;
    case 'RETRIBUTIONIST':
      out.push(ability('retribute', 'Revive', 'night', seat.usesRemaining));
      break;
    case 'VAMPIRE':
      out.push(ability('bite', 'Bite', 'night', null));
      break;
    case 'VAMPIRE_HUNTER':
      out.push(ability('vampire_check', 'Hunt', 'night', null));
      break;
    case 'CULT_LEADER':
      out.push(ability('recruit', 'Recruit', 'night', null));
      break;
    // CULTIST has no night ability (only the Cult Leader recruits).
    case 'TRANSPORTER':
      out.push(ability('transport', 'Transport', 'night', null));
      break;
    case 'CORONER':
      out.push(ability('autopsy', 'Autopsy', 'night', null));
      break;
    case 'TRAPPER':
      out.push(ability('trap', 'Set trap', 'night', null));
      break;
    case 'DOCTOR':
      out.push(ability('protect', 'Heal', 'night', null));
      break;
    case 'BODYGUARD':
      out.push(ability('guard', 'Guard', 'night', null));
      break;
    case 'MAYOR':
      out.push(ability('reveal', 'Reveal', 'day', seat.mayorRevealed ? 0 : 1));
      break;
    default: {
      const ab = roleToNightAbility(seat.role);
      if (ab) out.push(ability(ab, def.name, 'night', null));
    }
  }
  void VIGILANTE_BULLETS;
  void JAILOR_EXECUTIONS;
  void SURVIVOR_VESTS;
  return out;
}

/**
 * Build the `your_role` effect for a seat (§5). The faction roster ("mates") is
 * delivered ONLY to seats of an informed evil faction — a MAFIA seat learns the
 * Mafia roster, a TRIAD seat learns the Triad roster, and crucially NEVER the
 * other faction's roster. Town/neutral seats receive no mates at all. The frame
 * is addressed to the owning seat alone, so a non-faction seat can never receive
 * it (mirrors the mafia-only delivery the leak auditor enforces).
 */
export function yourRoleEffect(state: GameState, seat: SeatState): Effect {
  const def = ROLES[seat.role];
  const abilities = abilityInfoFor(seat);
  const mates =
    seat.faction === 'MAFIA' || seat.faction === 'TRIAD'
      ? state.seats
          .filter((s) => s.faction === seat.faction && s.seat !== seat.seat)
          .map((s) => s.seat)
      : undefined;
  // The seat's OWN private bound target: the Executioner's mark / the Guardian
  // Angel's charge. Leak-safe — it is this seat's own info, addressed only here.
  const assignedTarget =
    seat.role === 'EXECUTIONER'
      ? (seat.exeTarget ?? undefined)
      : seat.role === 'GUARDIAN_ANGEL'
        ? (seat.gaTarget ?? undefined)
        : undefined;
  const payload: Record<string, unknown> = {
    type: 'your_role',
    role: seat.role,
    faction: def.faction,
    abilities,
  };
  if (mates) payload.mates = mates;
  if (assignedTarget !== undefined) payload.assignedTarget = assignedTarget;
  return { to: [seat.seat] as SeatId[], msg: { v: PROTOCOL_VERSION, ...payload } as never };
}
