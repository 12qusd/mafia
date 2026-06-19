/**
 * Night resolution pipeline (BUILD_SPEC §6.8) — THE critical algorithm.
 *
 * Resolves all submitted night intents at NIGHT end, in the exact 9-step order.
 * Pure: mutates only a freshly-cloned `state` and returns accumulated effects +
 * traces. The only randomness is the injected PRNG (jester-grief target choice).
 */

import {
  type SeatId,
  type RoleId,
  type Faction,
  type DeathCause,
  type InvestigatorClass,
  type SheriffResult,
  INVESTIGATOR_CLASS_TABLE,
  FRAMED_INVESTIGATOR_CLASS,
  ROLES,
  UNIQUE_ROLES,
} from '@nocturne/shared';
import type { Effect } from '@nocturne/shared';
import type { GameState, SeatState, NightIntent, ResolutionTrace, NightAbility } from './state.js';
import { pick, shuffle, type PrngState } from './prng.js';
import { resolveBlocks, type BlockIntent } from './roleblock.js';
import { toSeat, seatOf } from './helpers.js';
import { initialUses } from './init.js';
import { yourRoleEffect } from './roleinfo.js';

/** Kill source order (fixed report order, §6.8.5). */
const KILL_SOURCE_ORDER: DeathCause[] = [
  'jailor_execute',
  'bodyguard',
  'veteran',
  'crusader',
  'staked',
  'vigilante',
  'mafia',
  'triad',
  'ambush',
  'serial_killer',
  'werewolf',
  'massacre',
  'juggernaut',
  'pestilence',
  'arsonist',
  'jester_grief',
];

/**
 * Attack sources a Bodyguard intercepts (basic attacks, batch A; batch C adds the
 * Crusader and Ambusher strikes — both basic attacks, not piercing).
 */
const BASIC_ATTACK_SOURCES: ReadonlySet<DeathCause> = new Set<DeathCause>([
  'mafia',
  'triad',
  'vigilante',
  'serial_killer',
  'veteran',
  'crusader',
  'ambush',
  // A Juggernaut attack is BASIC until the Juggernaut powers up (batch D); when it
  // powers up the kill carries `powerful: true` and pierces before this set is
  // consulted (the powerful branch runs first in the kill pass).
  'juggernaut',
]);

/**
 * POWERFUL attacks pierce basic defense (doctor heal / bodyguard / vest) but are
 * still stopped by jail and night-immunity. Werewolf, Mass Murderer, and Arsonist
 * are always powerful; a Juggernaut is powerful only once it carries the flag.
 */
function isPowerfulAttack(k: KillIntent): boolean {
  return k.source === 'werewolf' || k.source === 'massacre' || k.source === 'arsonist' || !!k.powerful;
}

interface KillIntent {
  source: DeathCause;
  attacker: SeatId | null;
  target: SeatId;
  /**
   * Whether this is a POWERFUL attack that pierces basic defense (doctor heal /
   * bodyguard / vest) but is still stopped by jail and night-immunity. Always true
   * for werewolf / massacre / arsonist; variable for the Juggernaut (basic until it
   * powers up). Basic attacks (mafia, vigilante, crusader, …) leave this falsey.
   */
  powerful?: boolean;
}

export interface ResolveResult {
  effects: Effect[];
  /**
   * Seats that died this night, in fixed report order (for dawn pacing/announce).
   * `forgedWill` (Forger, batch A): if present, the public death reveal shows this
   * counterfeit will instead of the victim's real last will.
   * `cleaned` (Janitor, batch A): if true, the public reveal omits the dead seat's
   * role and last will entirely (the body was sanitized).
   */
  deaths: { seat: SeatId; cause: DeathCause; forgedWill?: string; cleaned?: boolean }[];
  traces: ResolutionTrace[];
}

/**
 * Resolve the night. Mutates `state` (already cloned by caller). Returns effects
 * (private results) + ordered deaths + traces. DAWN announcements (death_announce)
 * are composed by the caller in step 7 using the returned `deaths`.
 */
export function resolveNight(state: GameState): ResolveResult {
  const effects: Effect[] = [];
  const traces: ResolutionTrace[] = [];

  const intents = state.nightIntents
    .slice()
    .sort((a, b) => a.seat - b.seat)
    // Step 0: drop intents of dead seats (safety).
    .filter((i) => seatOf(state, i.seat).alive);

  const intentBySeat = new Map<SeatId, NightIntent>();
  for (const i of intents) intentBySeat.set(i.seat, i);

  // -------------------------------------------------------------------------
  // Step 0.5: WITCH CONTROL (batch E) — runs BEFORE everything resolves.
  // -------------------------------------------------------------------------
  // Each living Witch seizes a PUPPET (the intent's `target`) and steers their
  // night action onto a VICTIM (`target2`). The puppet's intent target is
  // overwritten (or, if the puppet submitted nothing, an intent is created so the
  // puppet's natural ability fires at the victim). The Witch is control-immune (a
  // Witch cannot be a puppet) and a Witch who would be controlled is skipped here.
  // The puppet is told privately they were controlled — WITHOUT the controller's
  // identity. Resolved in deterministic Witch-seat order; the lowest-seat Witch
  // wins if two seize the same puppet. The control is applied even to a roleblocked
  // puppet's slot — the later roleblock/jail steps then act on the redirected
  // intent exactly as they would on any other (a jailed/blocked puppet is still
  // stopped). The Witch herself visits the puppet (handled by `actorVisits`).
  const controlledBy = new Map<SeatId, SeatId>(); // puppet → controlling witch
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'witch_control') continue;
    const witch = seatOf(state, i.seat);
    if (witch.role !== 'WITCH') continue;
    const puppet = i.target;
    const victim = i.target2 ?? null;
    if (puppet === null || victim === null) continue;
    if (puppet === i.seat) continue; // cannot ride yourself
    const pSeat = seatOf(state, puppet);
    // A Witch cannot control another control-immune seat (another Witch).
    if (!pSeat.alive || pSeat.role === 'WITCH') {
      traces.push({ step: 'witch', witch: i.seat, puppet, victim, redirected: false });
      continue;
    }
    if (controlledBy.has(puppet)) continue; // lowest-seat witch already took them
    controlledBy.set(puppet, i.seat);
    // Steer the puppet's action onto the victim. If the puppet has no natural
    // night ability, the control does nothing mechanical (still a visit/feedback).
    const natural = roleNightAbility(pSeat.role);
    if (natural !== null) {
      const existing = intentBySeat.get(puppet);
      if (existing && existing.seat === puppet) {
        existing.target = victim;
      } else {
        intentBySeat.set(puppet, { seat: puppet, ability: natural, target: victim });
      }
    }
    traces.push({ step: 'witch', witch: i.seat, puppet, victim, redirected: natural !== null });
    // Tell the puppet privately their hand was moved — no controller identity.
    effects.push(toSeat(puppet, { type: 'private_result', kind: 'controlled' }));
  }

  // -------------------------------------------------------------------------
  // Step 0.6: TRANSPORT (batch F) — runs AFTER Witch control, BEFORE jail /
  // roleblock / kills, mirroring where the Witch's redirect is applied.
  // -------------------------------------------------------------------------
  // Each living Transporter SWAPS two seats (a, b): every action/visit aimed at a
  // is redirected onto b and vice-versa. A Doctor healing a actually heals b; a
  // kill on a lands on b; a watcher of a watches b. The two swapped seats still act
  // normally on their OWN turn — transport only rewrites actions TARGETING them.
  //
  // INTERACTION WITH THE WITCH: the Witch's control resolved FIRST (above), so by
  // the time we swap, a controlled puppet's intent already points at the Witch's
  // victim; the transport then redirects that (and every other) target through the
  // swap exactly like any other action. (Recorded order: Witch control → Transport.)
  //
  // DETERMINISM: a fixed swap, no randomness. Transporters resolve in ascending
  // seat order; each builds a fresh single-swap remap and applies it to EVERY
  // intent's `target`/`target2` (including those a previous, lower-seat Transporter
  // already rewrote — so two Transporters compose as sequential swaps). A swap is a
  // NO-OP (swapped:false) when a===b, an endpoint is a self/dead seat, or an
  // endpoint was already moved by a lower-seat Transporter this night (each seat may
  // be a swap endpoint at most once, keeping the composition a clean permutation).
  const transportedSeats = new Set<SeatId>(); // seats already used as a swap endpoint
  const transporterPairs: { transporter: SeatId; a: SeatId; b: SeatId }[] = [];
  for (const i of [...intentBySeat.values()].sort((x, y) => x.seat - y.seat)) {
    if (i.ability !== 'transport') continue;
    if (seatOf(state, i.seat).role !== 'TRANSPORTER') continue;
    const a = i.target;
    const b = i.target2 ?? null;
    const valid =
      a !== null &&
      b !== null &&
      a !== b &&
      a !== i.seat &&
      b !== i.seat &&
      seatOf(state, a).alive &&
      seatOf(state, b).alive &&
      !transportedSeats.has(a) &&
      !transportedSeats.has(b);
    if (!valid) {
      traces.push({ step: 'transport', transporter: i.seat, a: a ?? i.seat, b: b ?? i.seat, swapped: false });
      continue;
    }
    transportedSeats.add(a);
    transportedSeats.add(b);
    transporterPairs.push({ transporter: i.seat, a, b });
    // Apply this single swap to EVERY intent's target/target2 (composes with any
    // earlier Transporter's already-applied swap). The Transporter's OWN transport
    // intent is left untouched (it names the houses to switch; it is not itself a
    // redirectable action), as are the control rows whose target2 is a steer victim.
    const swap = (seat: SeatId | null | undefined): SeatId | null | undefined =>
      seat === a ? b : seat === b ? a : seat;
    for (const j of intentBySeat.values()) {
      if (j.ability === 'transport') continue; // do not rewrite a Transporter's own swap pair
      j.target = swap(j.target) as SeatId | null;
      if (j.target2 !== undefined && j.ability !== 'witch_control') {
        j.target2 = swap(j.target2) as SeatId | null;
      }
    }
    traces.push({ step: 'transport', transporter: i.seat, a, b, swapped: true });
  }
  // The Transporter VISITS both houses it switched (a Lookout/Veteran/Crusader/
  // Ambusher/Coroner sees the call). Each visit edge is itself routed through any
  // OTHER Transporter's swap that ran after it — but to keep this bounded and
  // deterministic we record the visit against the FINAL (post-all-swaps) identity
  // of each endpoint, which is simply a/b (a later Transporter cannot reuse an
  // endpoint already taken, by the once-per-endpoint rule above). These extra visit
  // edges are threaded into the visitor computations below.
  const extraVisits: { actor: SeatId; target: SeatId }[] = [];
  for (const p of transporterPairs) {
    extraVisits.push({ actor: p.transporter, target: p.a });
    extraVisits.push({ actor: p.transporter, target: p.b });
  }

  // Werewolf (batch D): on a NON-full-moon night the beast sleeps. Drop any
  // `rampage` intent so the Werewolf neither visits (a Lookout sees nothing) nor
  // kills tonight — it simply stayed home. The rampage trace is still recorded in
  // the kill step below (fullMoon=false, no victims). On full-moon nights the
  // intent is kept and resolves normally (and can be jailed/roleblocked).
  if (!isFullMoon(state)) {
    for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
      if (i.ability === 'rampage' && seatOf(state, i.seat).role === 'WEREWOLF') {
        intentBySeat.delete(i.seat);
        traces.push({ step: 'rampage', werewolf: i.seat, target: i.target, fullMoon: false, victims: [] });
      }
    }
  }

  // Veteran (batch A): seats that go on alert this night (have alerts remaining).
  // While alerting a Veteran is night- AND roleblock-immune and kills every seat
  // that visits them. A jailed Veteran cannot alert (resolved below after jail).
  const alerting = new Set<SeatId>();
  for (const i of intentBySeat.values()) {
    if (i.ability === 'alert' && seatOf(state, i.seat).role === 'VETERAN' && seatOf(state, i.seat).usesRemaining > 0) {
      alerting.add(i.seat);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: JAIL
  // -------------------------------------------------------------------------
  const jailed = new Set<SeatId>();
  const jailorSeat = findJailor(state);
  if (state.jailTarget !== null && jailorSeat !== null) {
    const prisoner = state.jailTarget;
    if (seatOf(state, prisoner).alive) {
      jailed.add(prisoner);
      traces.push({ step: 'jail', jailor: jailorSeat, prisoner });
      // Prisoner's own intent is removed (a jailed Veteran cannot alert).
      intentBySeat.delete(prisoner);
      alerting.delete(prisoner);
      // Notify prisoner.
      effects.push(toSeat(prisoner, { type: 'private_result', kind: 'jailed' }));
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: ROLEBLOCKS (fixed point, §6.7) + SK redirect
  // -------------------------------------------------------------------------
  const blockIntents: BlockIntent[] = [];
  for (const i of intentBySeat.values()) {
    if (i.ability === 'roleblock' && i.target !== null) {
      blockIntents.push({ blocker: i.seat, target: i.target });
    }
  }

  // Pirate duel (batch E): each Pirate calls one living soul out for a duel. The
  // dueled target is OCCUPIED for the night — roleblocked AND plundered: untouchable
  // by every kill (like a jailed prisoner), but they survive (a duel, not a
  // killing). The duel's outcome is decided by the seeded PRNG against a FIXED
  // rock-paper-scissors rule: the Pirate draws an attack a∈{0,1,2}, the target a
  // defense d∈{0,1,2}; the plunder SUCCEEDS iff (a-d+3)%3===1 (the attack "beats"
  // the defense). A successful plunder credits the Pirate's counter (step 8).
  // Resolved in deterministic Pirate-seat order; a jailed Pirate's intent was
  // already removed. The duel still ROLEBLOCKS the target even on a failed plunder.
  const dueledTargets = new Set<SeatId>(); // targets occupied + shielded by a duel
  const duelOutcomes: { pirate: SeatId; target: SeatId; attack: number; success: boolean }[] = [];
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'duel' || i.target === null || i.target === i.seat) continue;
    if (seatOf(state, i.seat).role !== 'PIRATE') continue;
    const tgt = seatOf(state, i.target);
    if (!tgt.alive) continue;
    const aPick = pick(state.prng, [0, 1, 2]);
    state.prng = aPick.state;
    const dPick = pick(state.prng, [0, 1, 2]);
    state.prng = dPick.state;
    const attack = aPick.value;
    const defense = dPick.value;
    const success = (attack - defense + 3) % 3 === 1;
    dueledTargets.add(i.target);
    // The duel occupies the target (roleblock). A dueled Witch/Pestilence is
    // roleblock-immune, so resolveBlocks will leave their action standing — but the
    // plunder shield (untouchable) still applies below.
    blockIntents.push({ blocker: i.seat, target: i.target });
    duelOutcomes.push({ pirate: i.seat, target: i.target, attack, success });
  }
  // Immune to roleblock: roleblockImmune roles (Godfather) + the SK (hazard) +
  // an alerting Veteran (batch A — barred door).
  const immune = new Set<SeatId>();
  for (const s of state.seats) {
    if (!s.alive) continue;
    if (isRoleblockImmune(s)) immune.add(s.seat);
    if (s.role === 'SERIAL_KILLER') immune.add(s.seat);
    if (alerting.has(s.seat)) immune.add(s.seat);
  }
  // Jailed blockers are dropped inside resolveBlocks.
  const blockRes = resolveBlocks(blockIntents, jailed, immune);

  // SK redirect: any active block whose target is an SK redirects the SK's kill
  // onto the blocker; the SK's original target survives.
  const skRedirect = new Map<SeatId, SeatId>(); // sk → new target (blocker)
  for (const b of blockRes.activeBlocks) {
    const tgt = seatOf(state, b.target);
    if (tgt.role === 'SERIAL_KILLER') {
      // Lowest-seat blocker wins if multiple (deterministic; activeBlocks sorted).
      if (!skRedirect.has(b.target)) skRedirect.set(b.target, b.blocker);
    }
  }

  // Emit roleblock traces + private results.
  for (const b of blockRes.activeBlocks) {
    const tgt = seatOf(state, b.target);
    if (immune.has(b.target)) {
      // Block failed (target RB-immune, e.g. Godfather). Blocker told block_failed.
      traces.push({ step: 'roleblock', blocker: b.blocker, target: b.target, outcome: 'immune' });
      effects.push(toSeat(b.blocker, { type: 'private_result', kind: 'block_failed' }));
    } else {
      traces.push({ step: 'roleblock', blocker: b.blocker, target: b.target, outcome: 'blocked' });
      // Target told they were distracted (only if they had an action to lose).
      const ti = intentBySeat.get(b.target);
      if (ti && ti.ability !== 'mafia_control' && ti.ability !== 'triad_control') {
        effects.push(toSeat(b.target, { type: 'private_result', kind: 'roleblocked' }));
      }
    }
    void tgt;
  }

  // Cancel blocked seats' intents.
  for (const seat of blockRes.blocked) {
    intentBySeat.delete(seat);
  }

  // Pirate duel (batch E): record the duel outcomes (sorted) and credit each
  // successful plunder to the Pirate's counter (drives the personal win, step 8).
  // The trace carries the chosen attack + success; the dueled target's roleblock
  // and untouchable shield were applied above. A plundered Witch/Pestilence is
  // roleblock-immune (their action stands) but still shielded from kills.
  for (const d of duelOutcomes.sort((a, b) => a.pirate - b.pirate || a.target - b.target)) {
    traces.push({ step: 'duel', pirate: d.pirate, target: d.target, attack: d.attack, success: d.success });
    if (d.success) {
      const p = seatOf(state, d.pirate);
      if (p.alive && p.role === 'PIRATE') p.plunderCount += 1;
    }
  }

  // Apply SK redirects: rewrite the SK's kill target.
  for (const [sk, newTarget] of skRedirect) {
    const skIntent = intentBySeat.get(sk);
    const original = skIntent && skIntent.ability === 'kill_serial' ? skIntent.target : null;
    if (skIntent && skIntent.ability === 'kill_serial') {
      skIntent.target = newTarget;
    } else {
      // SK had no kill submitted (or none): still kills the blocker.
      intentBySeat.set(sk, { seat: sk, ability: 'kill_serial', target: newTarget });
    }
    traces.push({ step: 'sk_redirect', sk, blocker: newTarget, originalTarget: original });
  }

  // -------------------------------------------------------------------------
  // Step 3: PROTECTION (doctor shields, survivor vests, jail protection)
  // -------------------------------------------------------------------------
  const doctorShield = new Map<SeatId, SeatId>(); // protected seat → doctor
  const vested = new Set<SeatId>(); // seats with an active vest (night-immune this night)
  // Bodyguards (batch A): ward → queue of guarding bodyguards (lowest-seat first).
  // Each bodyguard intercepts at most one basic attack on its ward this night.
  const guardsByWard = new Map<SeatId, SeatId[]>();
  for (const i of intentBySeat.values()) {
    if (i.ability === 'protect' && i.target !== null) {
      // A revealed Mayor can no longer be healed by the Doctor (§6.5 #9).
      if (seatOf(state, i.target).mayorRevealed) continue;
      doctorShield.set(i.target, i.seat);
      traces.push({ step: 'protect', doctor: i.seat, target: i.target, kind: 'doctor' });
    } else if (i.ability === 'vest') {
      vested.add(i.seat);
      traces.push({ step: 'protect', doctor: i.seat, target: i.seat, kind: 'vest' });
    } else if (i.ability === 'guard' && i.target !== null && i.target !== i.seat) {
      const q = guardsByWard.get(i.target) ?? [];
      q.push(i.seat);
      guardsByWard.set(i.target, q);
    } else if (i.ability === 'crusade' && i.target !== null && i.target !== i.seat) {
      // Crusader (batch C): the ward gets a one-attack basic shield, exactly like a
      // doctor heal (lowest-seat crusader wins if two ward the same seat). The
      // separate "strike a visitor" half is resolved in the kill step below.
      if (!seatOf(state, i.target).mayorRevealed && !doctorShield.has(i.target)) {
        doctorShield.set(i.target, i.seat);
        traces.push({ step: 'protect', doctor: i.seat, target: i.target, kind: 'doctor' });
      }
    } else if (i.ability === 'shield' && i.target !== null && i.target !== i.seat) {
      // Guardian Angel (batch D): wards the charge from one attack, exactly like a
      // doctor heal. Only the GA's ASSIGNED charge is a legal target (the server
      // enforces this; the engine also checks). Lowest-seat protector wins if both
      // a doctor and a GA shield the same seat. A revealed Mayor cannot be healed.
      const self = seatOf(state, i.seat);
      if (
        self.role === 'GUARDIAN_ANGEL' &&
        self.gaTarget === i.target &&
        !seatOf(state, i.target).mayorRevealed &&
        !doctorShield.has(i.target)
      ) {
        doctorShield.set(i.target, i.seat);
        traces.push({ step: 'protect', doctor: i.seat, target: i.target, kind: 'doctor' });
        traces.push({ step: 'shield', angel: i.seat, charge: i.target });
      }
    } else if (i.ability === 'trap' && i.target !== null && i.target !== i.seat) {
      // Trapper (batch F): arm a one-night trap at the ward. Mechanically it grants
      // the SAME one-attack basic shield as a doctor heal (lowest-seat protector
      // wins if two shield the same seat; a revealed Mayor cannot be shielded). The
      // separate "name a caught caller" half is resolved in the investigation step.
      // Distinct from the Crusader: the Trapper PROTECTS + INFORMS but does NOT
      // KILL the caller it catches.
      if (
        seatOf(state, i.seat).role === 'TRAPPER' &&
        !seatOf(state, i.target).mayorRevealed &&
        !doctorShield.has(i.target)
      ) {
        doctorShield.set(i.target, i.seat);
        traces.push({ step: 'protect', doctor: i.seat, target: i.target, kind: 'doctor' });
      }
    }
  }
  // Keep each ward's bodyguard queue deterministic (lowest seat intercepts first).
  for (const q of guardsByWard.values()) q.sort((a, b) => a - b);
  // Jail protection: prisoner is shielded.
  for (const p of jailed) {
    traces.push({ step: 'protect', doctor: jailorSeat ?? p, target: p, kind: 'jail' });
  }

  // -------------------------------------------------------------------------
  // Step 4: DECEPTION (framer marks)
  // -------------------------------------------------------------------------
  const framed = new Set<SeatId>();
  // Forger marks: target seat → the forger's prepared counterfeit will. If the
  // marked seat dies tonight, the public death reveal shows this text instead of
  // the victim's real last will. Lowest-seat forger wins if two mark the same.
  const forgedWillByTarget = new Map<SeatId, { forger: SeatId; will: string }>();
  // Janitor marks: target seat → janitor. If the MAFIA kill lands on that seat,
  // the body is cleaned (role + will hidden publicly) and the janitor privately
  // learns them. Lowest-seat janitor wins if two mark the same (with uses left).
  const cleanByTarget = new Map<SeatId, SeatId>();
  // Hypnotist marks (batch C): target seat → hypnotist. The target receives a
  // FAKE benign feedback at the end of resolution (no real effect). Lowest-seat
  // hypnotist wins if two target the same seat.
  const hypnotized = new Map<SeatId, SeatId>();
  for (const i of intentBySeat.values()) {
    if (i.ability === 'frame' && i.target !== null) {
      framed.add(i.target);
      traces.push({ step: 'frame', framer: i.seat, target: i.target });
    } else if (i.ability === 'forge' && i.target !== null) {
      if (!forgedWillByTarget.has(i.target)) {
        // The forger prepares the counterfeit will in their death-note field.
        forgedWillByTarget.set(i.target, { forger: i.seat, will: seatOf(state, i.seat).deathNote });
      }
    } else if (i.ability === 'clean' && i.target !== null) {
      // Only a janitor with cleanings remaining can mark.
      if (!cleanByTarget.has(i.target) && seatOf(state, i.seat).usesRemaining > 0) {
        cleanByTarget.set(i.target, i.seat);
      }
    } else if (i.ability === 'blackmail' && i.target !== null) {
      // Blackmailer (batch A): silence the target's day chat for the day phases
      // immediately following this night. Anchored on the current nightNumber.
      const t = seatOf(state, i.target);
      t.silencedForNight = state.nightNumber;
      traces.push({ step: 'blackmail', blackmailer: i.seat, target: i.target });
      effects.push(toSeat(i.target, { type: 'private_result', kind: 'blackmailed' }));
    } else if (i.ability === 'disguise' && i.target !== null) {
      // Disguiser (batch B): take on a DEAD target's role appearance. The overlay
      // is applied to the disguiser's own seat and is sticky until re-disguise/
      // death. Only a dead target yields a meaningful disguise; a living target is
      // ignored (no appearance to borrow).
      const t = seatOf(state, i.target);
      if (!t.alive) {
        const self = seatOf(state, i.seat);
        self.apparentRole = t.role;
        traces.push({ step: 'disguise', disguiser: i.seat, target: i.target, apparentRole: t.role });
      }
    } else if (i.ability === 'douse' && i.target !== null && i.target !== i.seat) {
      // Arsonist (batch B): mark the target as doused (no kill). Persists until an
      // ignite burns it or the dousing arsonist dies. The doused player is NOT
      // notified (classic design). Idempotent.
      const t = seatOf(state, i.target);
      if (t.alive) {
        t.doused = true;
        traces.push({ step: 'douse', arsonist: i.seat, target: i.target });
      }
    } else if (i.ability === 'hypnotize' && i.target !== null && i.target !== i.seat) {
      // Hypnotist (batch C): plant a FALSE memory of the night in the target. No
      // real mechanical effect — the target's action still resolves normally. We
      // reuse the existing `roleblocked` private_result (a benign "you were
      // distracted" feedback that carries NO seats and NO roles), so this adds no
      // leakable surface and reveals no real secret. The fake is queued here and
      // delivered after the real night results are computed, so it does NOT
      // overwrite a real roleblocked/result the target legitimately earned.
      if (!hypnotized.has(i.target)) hypnotized.set(i.target, i.seat);
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: KILLS — collect, then resolve simultaneously in fixed source order
  // -------------------------------------------------------------------------
  const kills: KillIntent[] = [];

  // Leaver suicides: queued unpreventable deaths at this night's resolution (§8).
  for (const s of state.seats) {
    if (s.alive && s.leaving) {
      kills.push({ source: 'leave', attacker: s.seat, target: s.seat });
    }
  }

  // Jailor execution: the jailor submits a 'kill_jailor' night_action targeting
  // the prisoner. Valid only if they have executions left and the prisoner is
  // actually the jailed seat.
  const jailorExec = readJailorExecution(state, jailorSeat, intentBySeat);
  if (jailorExec !== null) {
    kills.push({ source: 'jailor_execute', attacker: jailorSeat, target: jailorExec });
  }

  // Vigilante / SK / mafia kills from intents.
  for (const i of intentBySeat.values()) {
    if (i.target === null) continue;
    if (i.ability === 'kill_vigilante') {
      kills.push({ source: 'vigilante', attacker: i.seat, target: i.target });
    } else if (i.ability === 'kill_serial') {
      kills.push({ source: 'serial_killer', attacker: i.seat, target: i.target });
    } else if (i.ability === 'kill_mafia') {
      kills.push({ source: 'mafia', attacker: i.seat, target: i.target });
    } else if (i.ability === 'kill_triad') {
      kills.push({ source: 'triad', attacker: i.seat, target: i.target });
    }
  }

  // Veteran alert (batch A): an alerting Veteran kills every seat that VISITS them
  // this night (post-block, post-redirect intents). A visit by the mafia kill
  // performer, a doctor, a sheriff, etc. all count; self-targets and
  // non-visiting actions (control, jail, vest, alert) do not. The counter is a
  // basic attack — a night-immune visitor (Godfather / Serial Killer) survives.
  const veteranVisitors = new Map<SeatId, Set<SeatId>>(); // veteran → visitor set
  if (alerting.size > 0) {
    for (const i of intentBySeat.values()) {
      if (i.target === null) continue;
      if (!alerting.has(i.target)) continue;
      if (i.seat === i.target) continue; // a self-target is not a visit
      if (!actorVisits(seatOf(state, i.seat), i)) continue;
      const set = veteranVisitors.get(i.target) ?? new Set<SeatId>();
      set.add(i.seat);
      veteranVisitors.set(i.target, set);
    }
    // Transporter (batch F): a Transporter that switched a house with an alerting
    // Veteran VISITS that Veteran, and so is mauled like any other caller.
    for (const v of extraVisits) {
      if (!alerting.has(v.target)) continue;
      if (v.actor === v.target) continue;
      const set = veteranVisitors.get(v.target) ?? new Set<SeatId>();
      set.add(v.actor);
      veteranVisitors.set(v.target, set);
    }
    for (const [vet, visitorSet] of veteranVisitors) {
      const visitors = [...visitorSet].sort((a, b) => a - b);
      for (const v of visitors) {
        kills.push({ source: 'veteran', attacker: vet, target: v });
      }
    }
    // Record one alert trace per alerting Veteran (with its visitor list), sorted.
    for (const vet of [...alerting].sort((a, b) => a - b)) {
      const list = [...(veteranVisitors.get(vet) ?? new Set<SeatId>())].sort((a, b) => a - b);
      traces.push({ step: 'alert', veteran: vet, visitors: list });
    }
  }

  // Crusader (batch C): each Crusader strikes the LOWEST-seat visitor to its ward
  // this night. The strike is a basic Town-aligned attack (death cause
  // `crusader`). Excluded from the candidate visitors: the ward itself, the
  // Crusader, and any non-visiting / astral actor (reuses the same `actorVisits`
  // visit set the Lookout/Veteran use). The ward's one-attack shield was set up in
  // step 3. Resolved in deterministic Crusader-seat order.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'crusade' || i.target === null || i.target === i.seat) continue;
    const ward = i.target;
    const visitor = lowestVisitorTo(state, intentBySeat, ward, [i.seat, ward], extraVisits);
    if (visitor !== null) {
      kills.push({ source: 'crusader', attacker: i.seat, target: visitor });
    }
    traces.push({ step: 'crusade', crusader: i.seat, ward, struck: visitor });
  }

  // Ambusher (batch C): the Mafia mirror of the Crusade strike. Each Ambusher
  // stakes out a house and kills the LOWEST-seat visitor to it (death cause
  // `ambush`, a basic Mafia attack). Excludes only the Ambusher itself — anyone
  // who calls on the watched house is fair game (the watched seat IS a valid
  // victim if someone else also visits it; the watched seat is never excluded).
  // The Ambusher visits the house (handled by `actorVisits`), so a Lookout sees
  // them. Resolved in deterministic Ambusher-seat order.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'ambush' || i.target === null) continue;
    const visitor = lowestVisitorTo(state, intentBySeat, i.target, [i.seat], extraVisits);
    if (visitor !== null) {
      kills.push({ source: 'ambush', attacker: i.seat, target: visitor });
    }
    traces.push({ step: 'ambush', ambusher: i.seat, target: i.target, struck: visitor });
  }

  // Werewolf rampage (batch D): on a FULL-MOON night (deterministically the
  // even-numbered nights) the Werewolf tears out and kills its chosen target AND
  // every seat that VISITED the Werewolf that night (a rampage keyed off visitors
  // to ITSELF). On non-full-moon nights the beast sleeps: the Werewolf stays home
  // and kills no one (the simpler classic rule — recorded). A powerful attack
  // (pierces basic defense; stopped only by jail / night-immunity). Resolved in
  // deterministic Werewolf-seat order. A jailed Werewolf had its intent removed.
  const fullMoon = isFullMoon(state);
  if (fullMoon) {
    for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
      if (i.ability !== 'rampage' || seatOf(state, i.seat).role !== 'WEREWOLF') continue;
      const victims: SeatId[] = [];
      // Chosen target (a self-target means "stay home and only maul visitors").
      if (i.target !== null && i.target !== i.seat && seatOf(state, i.target).alive) {
        victims.push(i.target);
      }
      // Everyone who visited the Werewolf this night (post-block intents).
      for (const v of visitorsTo(state, intentBySeat, i.seat, [i.seat], extraVisits)) {
        if (!victims.includes(v)) victims.push(v);
      }
      victims.sort((a, b) => a - b);
      for (const v of victims) {
        kills.push({ source: 'werewolf', attacker: i.seat, target: v, powerful: true });
      }
      traces.push({ step: 'rampage', werewolf: i.seat, target: i.target, fullMoon, victims: victims.slice() });
    }
  }

  // Mass Murderer massacre (batch D): visits a chosen house and kills the resident
  // AND every OTHER visitor to that house (a slaughter at a LOCATION — distinct
  // from the Werewolf, which keys off visitors to ITSELF). A powerful attack.
  // Resolved in deterministic Murderer-seat order. A jailed MM had its intent
  // removed. The murderer never kills itself even if it self-targets.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'massacre' || seatOf(state, i.seat).role !== 'MASS_MURDERER') continue;
    if (i.target === null || i.target === i.seat) {
      traces.push({ step: 'massacre', murderer: i.seat, house: i.seat, victims: [] });
      continue;
    }
    const house = i.target;
    const victims: SeatId[] = [];
    if (seatOf(state, house).alive) victims.push(house);
    for (const v of visitorsTo(state, intentBySeat, house, [i.seat, house], extraVisits)) {
      if (!victims.includes(v)) victims.push(v);
    }
    victims.sort((a, b) => a - b);
    for (const v of victims) {
      kills.push({ source: 'massacre', attacker: i.seat, target: v, powerful: true });
    }
    traces.push({ step: 'massacre', murderer: i.seat, house, victims: victims.slice() });
  }

  // Juggernaut (batch D): an escalating lone killer. It may strike only on a
  // full-moon night UNTIL it has landed its first kill; thereafter it may strike
  // on any night. Once it reaches the power threshold, its attack becomes POWERFUL
  // (pierces basic defense) and mauls everyone who visited the victim's house too.
  // The kill counter (`killCount`) is incremented in step 8 from this night's
  // deaths. Resolved in deterministic Juggernaut-seat order.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'juggernaut' || seatOf(state, i.seat).role !== 'JUGGERNAUT') continue;
    if (i.target === null || i.target === i.seat) continue;
    const self = seatOf(state, i.seat);
    // Gate: locked to full-moon nights until the first kill is on the board.
    if (self.killCount === 0 && !fullMoon) continue;
    const powerful = self.killCount >= JUGGERNAUT_POWER_THRESHOLD;
    const victims: SeatId[] = [];
    if (seatOf(state, i.target).alive) victims.push(i.target);
    if (powerful) {
      // A powered-up Juggernaut also mauls every other visitor to the victim's house.
      for (const v of visitorsTo(state, intentBySeat, i.target, [i.seat, i.target], extraVisits)) {
        if (!victims.includes(v)) victims.push(v);
      }
    }
    victims.sort((a, b) => a - b);
    for (const v of victims) {
      kills.push({ source: 'juggernaut', attacker: i.seat, target: v, powerful });
    }
    traces.push({ step: 'juggernaut', juggernaut: i.seat, target: i.target, powerful, victims: victims.slice() });
  }

  // Pestilence (batch E): the Plaguebearer's final form. A powerful lone-killer
  // attack (pierces basic defense; stopped only by jail/plunder and night-immunity).
  // Strikes a single chosen victim. Resolved in deterministic Pestilence-seat
  // order; a single (unique) Pestilence owns it. The Plaguebearer itself does NOT
  // kill — only its transformed form does.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'pestilence' || seatOf(state, i.seat).role !== 'PESTILENCE') continue;
    if (i.target === null || i.target === i.seat) continue;
    if (!seatOf(state, i.target).alive) continue;
    kills.push({ source: 'pestilence', attacker: i.seat, target: i.target, powerful: true });
  }

  // Arsonist ignite (batch B): an arsonist who strikes the match burns EVERY
  // currently-doused living seat at once. A powerful attack — it pierces basic
  // defense (heal / bodyguard / vest) but is still stopped by jail and
  // night-immunity (handled in the kill pass). The lowest-seat igniting arsonist
  // is recorded as the attacker; all doused marks are cleared afterward.
  const ignitingArsonists = [...intentBySeat.values()]
    .filter((i) => i.ability === 'ignite' && seatOf(state, i.seat).role === 'ARSONIST')
    .map((i) => i.seat)
    .sort((a, b) => a - b);
  if (ignitingArsonists.length > 0) {
    const igniter = ignitingArsonists[0]!;
    const dousedVictims = state.seats
      .filter((s) => s.alive && s.doused)
      .map((s) => s.seat)
      .sort((a, b) => a - b);
    for (const v of dousedVictims) {
      kills.push({ source: 'arsonist', attacker: igniter, target: v });
    }
    traces.push({ step: 'ignite', arsonist: igniter, victims: dousedVictims.slice() });
    // The blaze consumes all the kerosene: clear every doused mark.
    for (const s of state.seats) s.doused = false;
  }

  // Jester grief (scheduled from a previous day): one PRNG-chosen guilty voter.
  if (state.pendingJesterGrief) {
    const candidates = state.pendingJesterGrief.guiltyVoters.filter(
      (v) => seatOf(state, v).alive,
    );
    if (candidates.length > 0) {
      const r = pick(state.prng, candidates);
      state.prng = r.state;
      kills.push({ source: 'jester_grief', attacker: null, target: r.value });
    }
    state.pendingJesterGrief = null;
  }

  // Vampire bite (Vampire faction): determine the SINGLE bite that resolves this
  // night. To keep the conversion deterministic and bounded, only ONE vampire
  // bites per night — the lowest-seat LIVING vampire with a (still-standing) bite
  // intent and a valid target (recorded decision). Other vampires' bites are
  // dropped. The bite is a VISIT (so a Lookout/Veteran/Crusader/Ambusher sees it).
  // The actual conversion is applied in step 8 (after kills are known); here we
  // only resolve the Vampire Hunter STAKE: if the bite lands on a reachable
  // Vampire Hunter, the biting vampire is staked (a powerful counter — see the
  // kill pass) and the bite fails. The chosen bite is carried in `resolvingBite`.
  let resolvingBite: { vampire: SeatId; target: SeatId } | null = null;
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'bite' || i.target === null || i.target === i.seat) continue;
    const v = seatOf(state, i.seat);
    if (!v.alive || v.faction !== 'VAMPIRE') continue;
    if (!seatOf(state, i.target).alive) continue;
    resolvingBite = { vampire: i.seat, target: i.target };
    break; // lowest-seat vampire wins (intents iterated in seat order)
  }
  // Stake: a vampire that bites a Vampire Hunter is killed on the Hunter's ward.
  // Only a REACHABLE Hunter stakes — a jailed/dueled Hunter is locked away, so the
  // vampire never reaches them (the bite simply fails, handled in step 8). The
  // stake is a basic Town kill on the vampire (cause `staked`); the vampire's
  // immunity does not save it (a stake to the heart), but we route it through the
  // normal kill pass as a basic attack so jail/redirect bookkeeping stays uniform.
  if (
    resolvingBite !== null &&
    seatOf(state, resolvingBite.target).role === 'VAMPIRE_HUNTER' &&
    !jailed.has(resolvingBite.target) &&
    !dueledTargets.has(resolvingBite.target)
  ) {
    kills.push({ source: 'staked', attacker: resolvingBite.target, target: resolvingBite.vampire, powerful: true });
  }

  // Cult recruit (Cult faction): determine the SINGLE recruit that resolves this
  // night. ONLY the (unique) Cult Leader recruits — the rank-and-file Cultists
  // cannot grow the Cult. We pick the lowest-seat living CULT_LEADER with a
  // still-standing `recruit` intent and a valid living target. (In a valid setup
  // the Cult Leader is unique, so this is "the" Leader; the lowest-seat iteration
  // keeps it deterministic even in a degenerate multi-Leader setup.) Unlike the
  // Vampire there is NO counter-stake — the Cult has no killing power, so nothing
  // is pushed to the kill pass here; the conversion is applied in step 8 after
  // kills are settled. The recruit is a VISIT (a Lookout/Veteran/etc. sees it).
  let resolvingRecruit: { leader: SeatId; target: SeatId } | null = null;
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'recruit' || i.target === null || i.target === i.seat) continue;
    const leader = seatOf(state, i.seat);
    if (!leader.alive || leader.role !== 'CULT_LEADER') continue;
    if (!seatOf(state, i.target).alive) continue;
    resolvingRecruit = { leader: i.seat, target: i.target };
    break; // lowest-seat Cult Leader wins (intents iterated in seat order)
  }

  // Resolve kills simultaneously against state after steps 1–4.
  // Track which seats die; a doctor shield absorbs exactly one successful kill.
  const shieldUsed = new Set<SeatId>();
  const willDie = new Map<SeatId, DeathCause>(); // target → first lethal cause (report order)
  const attackedSurvivors = new Set<SeatId>(); // told "was_attacked"
  const healedTargets = new Set<SeatId>(); // told "was_healed"

  // Bodyguard interception bookkeeping (batch A). A mutable per-ward queue of
  // still-available bodyguards; counterattacks are collected and resolved after
  // the main kill pass (so they themselves respect the attacker's immunity).
  const availableGuards = new Map<SeatId, SeatId[]>();
  for (const [ward, q] of guardsByWard) availableGuards.set(ward, q.slice());
  const bgCounters: { bodyguard: SeatId; attacker: SeatId; ward: SeatId }[] = [];
  const bgSaved = new Set<SeatId>(); // wards saved by a bodyguard this night

  // Process in fixed source order; within a source, by target seat for determinism.
  const ordered = kills
    .slice()
    .sort(
      (a, b) =>
        sourceRank(a.source) - sourceRank(b.source) ||
        a.target - b.target ||
        (a.attacker ?? -1) - (b.attacker ?? -1),
    );

  for (const k of ordered) {
    const target = seatOf(state, k.target);
    const pierces = k.source === 'jailor_execute' || k.source === 'jester_grief' || k.source === 'leave';

    // (a) jailed & not a jailor execution → unreachable.
    if (jailed.has(k.target) && k.source !== 'jailor_execute' && k.source !== 'leave') {
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'unreachable' });
      if (k.attacker !== null) {
        effects.push(toSeat(k.attacker, { type: 'private_result', kind: 'target_unreachable' }));
      }
      continue;
    }

    // (a.5) PLUNDERED (batch E, Pirate duel) → unreachable. A dueled soul is locked
    // in the duel all night and cannot be killed by anyone (they survive the night);
    // a leaver suicide is the only exception (their own choice). Same shape as jail.
    if (dueledTargets.has(k.target) && k.source !== 'leave') {
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'unreachable' });
      if (k.attacker !== null) {
        effects.push(toSeat(k.attacker, { type: 'private_result', kind: 'target_unreachable' }));
      }
      continue;
    }

    // (b) pierces (jailor_execute / jester_grief / leave) → dies, ignore heals/immunity.
    if (pierces) {
      if (!willDie.has(k.target)) willDie.set(k.target, k.source);
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'died' });
      continue;
    }

    // (c) night-immune (role flag, active vest, alerting Veteran) → fail; target
    // told they were attacked.
    if (isNightImmune(target) || vested.has(k.target) || alerting.has(k.target)) {
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'immune' });
      attackedSurvivors.add(k.target);
      if (k.attacker !== null) {
        effects.push(toSeat(k.attacker, { type: 'private_result', kind: 'attacked_survived' }));
      }
      continue;
    }

    // (c.25) POWERFUL attacks (batch B Arsonist ignite; batch D Werewolf rampage,
    // Mass Murderer massacre, and a powered-up Juggernaut): these pierce basic
    // defense — past this point (not jailed, not night-immune) they cannot be
    // stopped by a doctor's heal, a bodyguard, or a vest. The victim dies.
    if (isPowerfulAttack(k)) {
      if (!willDie.has(k.target)) willDie.set(k.target, k.source);
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'died' });
      continue;
    }

    // (c.5) bodyguard interception (batch A): a basic attack on a warded seat is
    // taken by a guarding bodyguard. The ward survives; the bodyguard dies in
    // their place and counterattacks the assailant. One bodyguard per attack.
    if (BASIC_ATTACK_SOURCES.has(k.source) && k.attacker !== null) {
      const q = availableGuards.get(k.target);
      if (q && q.length > 0) {
        const bodyguard = q.shift()!;
        bgSaved.add(k.target);
        healedTargets.add(k.target); // the ward learns they were attacked but saved
        // The bodyguard dies in the ward's place (cause = the attack that came in).
        if (!willDie.has(bodyguard)) willDie.set(bodyguard, k.source);
        // Queue the counterattack on the assailant (resolved after this pass).
        bgCounters.push({ bodyguard, attacker: k.attacker, ward: k.target });
        traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'healed' });
        continue;
      }
    }

    // (d) doctor shield absorbs exactly one successful kill.
    if (doctorShield.has(k.target) && !shieldUsed.has(k.target)) {
      shieldUsed.add(k.target);
      healedTargets.add(k.target);
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'healed' });
      // Attacker told nothing (per §6.8.5d).
      continue;
    }

    // Otherwise: dies.
    if (!willDie.has(k.target)) willDie.set(k.target, k.source);
    traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'died' });
  }

  // Bodyguard counterattacks (batch A): resolved after the main pass, in a fixed
  // order (by attacker, then bodyguard). A counter is a BASIC attack — it kills
  // the assailant unless they are night-immune (Godfather / Serial Killer), in
  // which case the trade still costs the bodyguard but the assailant walks. The
  // counter is not stopped by the assailant's doctor (it is point-blank).
  for (const c of bgCounters.slice().sort((a, b) => a.attacker - b.attacker || a.bodyguard - b.bodyguard)) {
    const assailant = seatOf(state, c.attacker);
    const immune = isNightImmune(assailant) || vested.has(c.attacker);
    if (!immune) {
      if (!willDie.has(c.attacker)) willDie.set(c.attacker, 'bodyguard');
    }
    traces.push({
      step: 'guard',
      bodyguard: c.bodyguard,
      ward: c.ward,
      attacker: c.attacker,
      killedAttacker: !immune,
    });
  }

  // Deliver "attacked but survived" / "healed" notices (one per seat).
  for (const seat of attackedSurvivors) {
    if (!willDie.has(seat)) {
      effects.push(toSeat(seat, { type: 'private_result', kind: 'was_attacked' }));
    }
  }
  for (const seat of healedTargets) {
    if (!willDie.has(seat)) {
      effects.push(toSeat(seat, { type: 'private_result', kind: 'was_healed' }));
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: INVESTIGATIONS (see post-kill state; deaths unknown until dawn)
  // -------------------------------------------------------------------------
  // Compute visitors per target (intents that survived steps 1–2 and targeted X).
  // Mafia kill visit attributed to its performer (the kill_mafia actor), not GF.
  const visitorsByTarget = new Map<SeatId, SeatId[]>();
  // Tracker (batch B): the inverse index — who each ACTOR visited (visitor →
  // targets). Reuses the same `actorVisits` visit set as the Lookout, indexed by
  // actor instead of by target.
  const visitedByActor = new Map<SeatId, SeatId[]>();
  for (const i of intentBySeat.values()) {
    if (i.target === null) continue;
    const actor = seatOf(state, i.seat);
    if (!actorVisits(actor, i)) continue;
    // Self-targets are not visits.
    if (i.target === i.seat) continue;
    const list = visitorsByTarget.get(i.target) ?? [];
    list.push(i.seat);
    visitorsByTarget.set(i.target, list);
    const vlist = visitedByActor.get(i.seat) ?? [];
    vlist.push(i.target);
    visitedByActor.set(i.seat, vlist);
  }
  // Transporter (batch F): fold its two visit edges into BOTH visit indices, so a
  // Lookout/Tracker/Coroner sees the Transporter at the houses it switched. Guarded
  // against duplicates (a Transporter never also has a single-target intent here).
  for (const v of extraVisits) {
    const list = visitorsByTarget.get(v.target) ?? [];
    if (!list.includes(v.actor)) list.push(v.actor);
    visitorsByTarget.set(v.target, list);
    const vlist = visitedByActor.get(v.actor) ?? [];
    if (!vlist.includes(v.target)) vlist.push(v.target);
    visitedByActor.set(v.actor, vlist);
  }

  // Spy (batch B): the set of seats the MAFIA visited this night. Reuses the same
  // visit set; a seat counts iff a living MAFIA-faction actor visited it (Godfather
  // control does NOT visit, mirroring the Lookout/Tracker view). Carries seats
  // only, never mafia identities or roles, so it is leak-trivial.
  const mafiaVisited = new Set<SeatId>();
  for (const i of intentBySeat.values()) {
    if (i.target === null || i.target === i.seat) continue;
    const actor = seatOf(state, i.seat);
    if (actor.faction !== 'MAFIA') continue;
    if (!actorVisits(actor, i)) continue;
    mafiaVisited.add(i.target);
  }
  const mafiaVisitedSorted = [...mafiaVisited].sort((a, b) => a - b);

  for (const i of intentBySeat.values()) {
    if (i.target === null) continue;
    if (i.ability === 'investigate_sheriff') {
      const result = sheriffRead(seatOf(state, i.target), framed);
      traces.push({ step: 'investigate', kind: 'sheriff', investigator: i.seat, target: i.target, result });
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'sheriff_result', target: i.target, result }));
    } else if (i.ability === 'investigate_investigator') {
      const result = investigatorRead(seatOf(state, i.target), framed);
      traces.push({ step: 'investigate', kind: 'investigator', investigator: i.seat, target: i.target, result });
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'investigator_result', target: i.target, resultClass: result }));
    } else if (i.ability === 'investigate_consigliere') {
      // The Consigliere learns the target's current APPARENT role exactly; framing
      // (which only fogs sheriff/investigator reads) does not change it, but a
      // Disguiser's overlay does (the consigliere reads the disguise, batch B).
      const result = apparentRoleOf(seatOf(state, i.target));
      traces.push({ step: 'investigate', kind: 'consigliere', investigator: i.seat, target: i.target, result });
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'consigliere_result', target: i.target, role: result }));
    } else if (i.ability === 'watch') {
      const visitors = (visitorsByTarget.get(i.target) ?? [])
        .filter((v) => v !== i.seat) // lookout doesn't see itself
        .sort((a, b) => a - b);
      traces.push({ step: 'investigate', kind: 'lookout', investigator: i.seat, target: i.target, visitors });
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'lookout_result', target: i.target, visitors }));
    } else if (i.ability === 'investigate_track') {
      // Tracker (batch B): learn who the watched target VISITED tonight (the
      // inverse of the Lookout). Carries seats only — never roles.
      const visited = (visitedByActor.get(i.target) ?? [])
        .filter((v) => v !== i.seat) // a tracker watching itself is excluded above anyway
        .sort((a, b) => a - b);
      traces.push({ step: 'investigate', kind: 'tracker', investigator: i.seat, target: i.target, visited });
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'tracker_result', target: i.target, visited }));
    }
  }

  // Spy (batch B): each spying Spy learns the seats the mafia visited tonight.
  for (const i of intentBySeat.values()) {
    if (i.ability !== 'spy') continue;
    traces.push({ step: 'investigate', kind: 'spy', investigator: i.seat, seats: mafiaVisitedSorted.slice() });
    effects.push(toSeat(i.seat, { type: 'private_result', kind: 'spy_result', seats: mafiaVisitedSorted.slice() }));
  }

  // Coroner (batch F): each Coroner that opened a DEAD seat learns that seat's
  // exact (apparent) ROLE and the sorted seats that visited it the NIGHT IT DIED
  // (read back from the frozen `deathVisitors`, recorded at that seat's death). The
  // role is of an already-publicly-revealed corpse, so it leaks nothing new; the
  // result is addressed to the Coroner alone and whitelisted as a per-seat role
  // carrier. A living / cleaned-and-secret target is no valid corpse — read fails.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'autopsy' || i.target === null) continue;
    if (seatOf(state, i.seat).role !== 'CORONER') continue;
    const tgt = seatOf(state, i.target);
    // A valid corpse: dead AND publicly revealed (a Janitor-cleaned body keeps its
    // secret — nothing on the slab to read). The role read is the APPARENT role,
    // matching every other reveal (a Disguiser's borrowed face).
    const valid = !tgt.alive && tgt.revealed;
    if (!valid) {
      traces.push({ step: 'autopsy', coroner: i.seat, target: i.target, role: null, visitors: [], read: false });
      continue;
    }
    const role = apparentRoleOf(tgt);
    const visitors = tgt.deathVisitors.slice().sort((a, b) => a - b);
    traces.push({ step: 'autopsy', coroner: i.seat, target: i.target, role, visitors, read: true });
    effects.push(
      toSeat(i.seat, { type: 'private_result', kind: 'coroner_result', target: i.target, role, visitors }),
    );
  }

  // Trapper (batch F): each Trapper's snare at its ward catches the LOWEST-seat
  // caller at that door this night (excluding the ward and the Trapper itself —
  // the same visitor set the Crusader strikes, including the Transporter's extra
  // visit edges). It does NOT kill — it only names the caught seat to the Trapper.
  // `sprung` records whether the trap's shield actually absorbed an attack tonight.
  // Carries ONLY a seat id (leak-trivial). Resolved in deterministic seat order.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'trap' || i.target === null || i.target === i.seat) continue;
    if (seatOf(state, i.seat).role !== 'TRAPPER') continue;
    const ward = i.target;
    const caught = lowestVisitorTo(state, intentBySeat, ward, [i.seat, ward], extraVisits);
    // The trap "sprang" iff the ward's shield (set in step 3 to this Trapper) was
    // the one that absorbed an attack — i.e. the ward was healed by this seat.
    const sprung = healedTargets.has(ward) && doctorShield.get(ward) === i.seat;
    traces.push({ step: 'trap', trapper: i.seat, ward, caught, sprung });
    if (caught !== null) {
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'trapper_result', target: ward, caught }));
    }
  }

  // Psychic (batch C): each Psychic receives a vision — a sorted list of living
  // seats among which AT LEAST ONE is evil (odd nights) or good (even nights),
  // drawn deterministically from the seeded PRNG. Carries seats only, never roles
  // or factions. Skipped for a jailed/blocked Psychic (their intent was removed).
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'divine') continue;
    const vision = buildPsychicVision(state, i.seat);
    state.prng = vision.prng;
    traces.push({ step: 'divine', psychic: i.seat, parity: vision.parity, seats: vision.seats.slice() });
    effects.push(
      toSeat(i.seat, { type: 'private_result', kind: 'psychic_vision', parity: vision.parity, seats: vision.seats.slice() }),
    );
  }

  // Vampire Hunter (Vampire faction): each Hunter who studied a target learns
  // whether that target is currently a vampire — a single yes/no read carrying
  // ONLY the target seat + the flag (no role strings), so it is leak-trivial like
  // the sheriff's read. The faction is read from the CURRENT state: a seat the
  // coven turns THIS same night converts later in step 8, so it reads as "not a
  // vampire" tonight (the Hunter sees them as they were before dawn — fair).
  // Skipped for a jailed/blocked Hunter (their intent was already removed).
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'vampire_check' || i.target === null) continue;
    if (seatOf(state, i.seat).role !== 'VAMPIRE_HUNTER') continue;
    const isVampire = seatOf(state, i.target).faction === 'VAMPIRE';
    traces.push({ step: 'vampire_check', hunter: i.seat, target: i.target, isVampire });
    effects.push(
      toSeat(i.seat, { type: 'private_result', kind: 'vampire_hunter_result', target: i.target, isVampire }),
    );
  }

  // Hypnotist (batch C): deliver each planted FAKE feedback. We reuse the benign
  // `roleblocked` private_result (carries no seats / no roles), so it adds no
  // leakable surface. It is delivered even if the target had no real result —
  // that is the point: a phantom roleblocker the target will chase tomorrow.
  for (const [target, hypnotist] of [...hypnotized.entries()].sort((a, b) => a[0] - b[0])) {
    effects.push(toSeat(target, { type: 'private_result', kind: 'roleblocked' }));
    traces.push({ step: 'hypnotize', hypnotist, target, fake: 'roleblocked' });
  }

  // -------------------------------------------------------------------------
  // Step 7 (partial): record deaths in fixed report order. Mutate seat state.
  // The caller composes death_announce effects for DAWN (or game_over).
  // -------------------------------------------------------------------------
  const deaths: { seat: SeatId; cause: DeathCause; forgedWill?: string }[] = [];
  // Order deaths by kill-source rank, then seat.
  const dyingSeats = [...willDie.entries()].sort(
    (a, b) => sourceRank(a[1]) - sourceRank(b[1]) || a[0] - b[0],
  );
  const dyingSet = new Set(dyingSeats.map(([seat]) => seat));
  const cleanedTargets = new Set<SeatId>(); // marked seats actually cleaned tonight
  for (const [seat, cause] of dyingSeats) {
    const s = seatOf(state, seat);
    s.alive = false;
    s.revealed = true;
    s.deathCause = cause;
    s.deathDay = state.dayNumber;
    // Coroner (batch F): FREEZE the seats that visited this seat tonight, for a
    // later autopsy. Taken from this night's visit graph (the same set the Lookout
    // sees), excluding self. Recorded once, at death — a later night cannot rewrite
    // it (the seat is dead and submits no intents; the field is only set here).
    s.deathVisitors = (visitorsByTarget.get(seat) ?? [])
      .filter((v) => v !== seat)
      .slice()
      .sort((a, b) => a - b);
    const forge = forgedWillByTarget.get(seat);
    // Janitor cleaning: only the MAFIA faction kill is sanitizable. A cleaned body
    // hides BOTH role and will publicly; a forged will on a cleaned body is moot.
    const janitor = cleanByTarget.get(seat);
    const cleaned = janitor !== undefined && cause === 'mafia';
    if (cleaned) {
      cleanedTargets.add(seat);
      // The cleaned victim is NOT legally revealed to the public — keep the seat's
      // role secret. (The seat is still dead; `revealed` here is the internal flag,
      // but the PUBLIC death_announce omits the role, so no one learns it.)
      s.revealed = false;
      // The janitor privately learns the scrubbed victim's role and will.
      effects.push(
        toSeat(janitor, {
          type: 'private_result',
          kind: 'janitor_result',
          target: seat,
          role: s.role,
          ...(s.lastWill ? { lastWill: s.lastWill } : {}),
        }),
      );
    }
    deaths.push({
      seat,
      cause,
      ...(cleaned ? { cleaned: true } : forge ? { forgedWill: forge.will } : {}),
    });
    // Disguiser (batch B): the death reveal shows the APPARENT role (the borrowed
    // name), not the true one. Cleaned bodies reveal nothing regardless.
    traces.push({ step: 'death', seat, role: apparentRoleOf(s), cause });
  }
  // Forger traces: a forge "applied" iff its marked target actually died tonight.
  for (const [target, forge] of [...forgedWillByTarget.entries()].sort((a, b) => a[0] - b[0])) {
    traces.push({ step: 'forge', forger: forge.forger, target, applied: dyingSet.has(target) });
  }
  // Janitor traces + use decrement: a clean "applied" iff the body was cleaned.
  for (const [target, janitor] of [...cleanByTarget.entries()].sort((a, b) => a[0] - b[0])) {
    const applied = cleanedTargets.has(target);
    if (applied) {
      const j = seatOf(state, janitor);
      j.usesRemaining = Math.max(0, j.usesRemaining - 1);
    }
    traces.push({ step: 'clean', janitor, target, applied });
  }

  // -------------------------------------------------------------------------
  // Step 8: PROMOTIONS & BOOKKEEPING
  // -------------------------------------------------------------------------
  // Decrement uses for actions that fired.
  applyUseDecrements(state, intentBySeat, jailorExec, jailorSeat);

  // Mafia succession: GF died & no living Mafioso ⇒ senior (lowest-seat) living
  // mafia becomes Mafioso (effective next night). Re-emit the role card so the new
  // Mafioso's UI gains the faction kill (and the correct mafia roster).
  const promotedMafioso = applyMafiaSuccession(state, traces);
  if (promotedMafioso) effects.push(yourRoleEffect(state, promotedMafioso));

  // Triad succession: Dragon Head died & no living Enforcer ⇒ senior (lowest-seat)
  // living triad becomes Enforcer (effective next night). Exact mirror of the
  // Mafia succession above (re-emit the new Enforcer's role card too).
  const promotedEnforcer = applyTriadSuccession(state, traces);
  if (promotedEnforcer) effects.push(yourRoleEffect(state, promotedEnforcer));

  // Executioner → Jester if target died at night.
  for (const s of state.seats) {
    if (s.role === 'EXECUTIONER' && s.alive && s.exeTarget !== null) {
      const tgt = seatOf(state, s.exeTarget);
      if (!tgt.alive && tgt.deathDay === state.dayNumber && deaths.some((d) => d.seat === s.exeTarget)) {
        s.role = 'JESTER';
        s.faction = 'NEUTRAL_BENIGN';
        s.exeTarget = null;
        traces.push({ step: 'promotion', kind: 'executioner_to_jester', seat: s.seat });
        // Re-emit the role card so the (now-Jester) seat's UI reflects the change.
        effects.push(yourRoleEffect(state, s));
      }
    }
  }

  // Amnesiac remembers (batch B): an alive Amnesiac who knelt at a (still-dead,
  // valid) grave BECOMES that role — role + faction change, mirroring the
  // executioner→jester conversion. Resolved in deterministic seat order.
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'remember' || i.target === null) continue;
    const s = seatOf(state, i.seat);
    if (s.role !== 'AMNESIAC' || !s.alive) continue;
    const tgt = seatOf(state, i.target);
    if (!canRemember(state, tgt)) continue;
    const newRole = tgt.role;
    s.role = newRole;
    s.faction = ROLES[newRole].faction as Faction;
    const u = initialUses(newRole);
    s.usesRemaining = u.uses;
    s.selfUsesRemaining = u.self;
    traces.push({ step: 'promotion', kind: 'amnesiac_remember', seat: s.seat, newRole });
    effects.push(
      toSeat(s.seat, { type: 'private_result', kind: 'remember_result', target: i.target, role: newRole }),
    );
    // Re-emit the role card so the remembered role's abilities (and, if the new
    // role is mafia/triad, that faction's roster) appear on the seat's UI.
    effects.push(yourRoleEffect(state, s));
  }

  // Juggernaut (batch D): credit kills landed THIS night to the killer's counter,
  // which powers up future nights (escalation). A seat counts iff it actually died
  // with the `juggernaut` cause (a higher-priority cause stealing the kill does not
  // count). Deterministic; a single (unique) Juggernaut owns all such deaths.
  for (const s of state.seats) {
    if (s.role !== 'JUGGERNAUT' || !s.alive) continue;
    const landed = [...willDie.entries()].filter(([, cause]) => cause === 'juggernaut').length;
    if (landed > 0) s.killCount += landed;
  }

  // Plaguebearer infection spread (batch E). The contagion spreads through this
  // night's VISIT graph (the same `visitorsByTarget` / `visitedByActor` maps the
  // Lookout/Tracker use). Classic spread rule (recorded, and guaranteed to
  // terminate — it is a single bounded pass over a finite, fixed graph):
  //   1. The Plaguebearer infects everyone IT visited and everyone who visited IT.
  //   2. The plague then creeps one step outward from every already-infected seat:
  //      everyone an infected seat visited, and everyone who visited an infected
  //      seat, also catches it.
  // Only LIVING seats are infected (the dead are past saving). When EVERY living
  // seat is infected, the Plaguebearer transforms into Pestilence (role + faction
  // change within NEUTRAL_KILLING — it reuses the NK win, no new faction). The
  // transformation is the conversion mirror of executioner→jester.
  const livingPlague = state.seats.filter((s) => s.alive && s.role === 'PLAGUEBEARER');
  if (livingPlague.length > 0) {
    const newlyInfected = new Set<SeatId>();
    const infectFrom = (seat: SeatId): void => {
      for (const v of visitedByActor.get(seat) ?? []) {
        if (seatOf(state, v).alive) newlyInfected.add(v);
      }
      for (const v of visitorsByTarget.get(seat) ?? []) {
        if (seatOf(state, v).alive) newlyInfected.add(v);
      }
    };
    // Step 1: seed from each Plaguebearer's own visit edges.
    for (const pb of livingPlague) infectFrom(pb.seat);
    // Step 2: one-step outward creep from every seat ALREADY carrying the plague
    // (persisted `infected` flag) plus this night's freshly-seeded carriers.
    const carriers = state.seats.filter((s) => s.alive && s.infected).map((s) => s.seat);
    for (const c of [...carriers, ...newlyInfected]) infectFrom(c);
    // Apply: mark every newly-infected living seat (and the Plaguebearer itself is
    // considered infected — it is patient zero).
    for (const seat of newlyInfected) seatOf(state, seat).infected = true;
    for (const pb of livingPlague) pb.infected = true;
    // Determine whether ALL living seats now carry the plague.
    const living = state.seats.filter((s) => s.alive);
    const allInfected = living.length > 0 && living.every((s) => s.infected);
    traces.push({
      step: 'infect',
      plaguebearer: livingPlague.map((p) => p.seat).sort((a, b) => a - b)[0]!,
      infected: [...newlyInfected].sort((a, b) => a - b),
      allInfected,
    });
    if (allInfected) {
      for (const pb of livingPlague) {
        pb.role = 'PESTILENCE';
        // faction stays NEUTRAL_KILLING (reuses the existing NK / last-killer win).
        const u = initialUses('PESTILENCE');
        pb.usesRemaining = u.uses;
        pb.selfUsesRemaining = u.self;
        traces.push({ step: 'promotion', kind: 'plaguebearer_to_pestilence', seat: pb.seat });
        // Re-emit the role card so the now-Pestilence seat sees Reap, not Infect.
        effects.push(yourRoleEffect(state, pb));
      }
    }
  }

  // Guardian Angel (batch D): if the GA's assigned charge died THIS night, the GA's
  // purpose is spent — it becomes a Survivor (the simpler classic rule; recorded).
  // The charge link is cleared. Mirrors the executioner→jester conversion.
  for (const s of state.seats) {
    if (s.role !== 'GUARDIAN_ANGEL' || !s.alive || s.gaTarget === null) continue;
    const charge = seatOf(state, s.gaTarget);
    if (!charge.alive && deaths.some((d) => d.seat === s.gaTarget)) {
      s.role = 'SURVIVOR';
      s.faction = 'NEUTRAL_BENIGN';
      s.gaTarget = null;
      const u = initialUses('SURVIVOR');
      s.usesRemaining = u.uses;
      s.selfUsesRemaining = u.self;
      traces.push({ step: 'promotion', kind: 'guardian_to_survivor', seat: s.seat });
      // Re-emit the role card so the now-Survivor seat sees Vest, not Watch over.
      effects.push(yourRoleEffect(state, s));
    }
  }

  // Retributionist revive (batch E). Once per game, a living Retributionist who
  // knelt at the grave of a DEAD TOWN seat raises them: they return alive with
  // their original role and faction intact. Resolved in deterministic
  // Retributionist-seat order; the lowest-seat Retributionist wins if two target
  // the same grave. Only a DEAD seat of the TOWN faction is a legal target (the
  // dark and lone killers stay buried). The revived seat's role was already
  // publicly revealed at death, so re-aliving leaks nothing new (everyone who saw
  // the death_announce already knows it); we keep `revealed=true` accordingly.
  const revivedThisNight = new Set<SeatId>();
  for (const i of [...intentBySeat.values()].sort((a, b) => a.seat - b.seat)) {
    if (i.ability !== 'retribute' || i.target === null) continue;
    const ret = seatOf(state, i.seat);
    if (ret.role !== 'RETRIBUTIONIST' || !ret.alive || ret.usesRemaining <= 0) continue;
    const tgt = seatOf(state, i.target);
    const valid =
      !tgt.alive &&
      tgt.faction === 'TOWN' &&
      !revivedThisNight.has(i.target) &&
      !tgt.leaving; // a seat that walked out cannot be raised
    if (!valid) {
      traces.push({ step: 'retribute', retributionist: i.seat, target: i.target, revived: false });
      continue;
    }
    // Raise the dead: restore life, clear the death bookkeeping, keep role/faction.
    tgt.alive = true;
    tgt.deathCause = null;
    tgt.deathDay = null;
    // `revealed` stays true — the role is already public from the death reveal; this
    // does NOT re-leak. Consume the Retributionist's single use.
    ret.usesRemaining = Math.max(0, ret.usesRemaining - 1);
    revivedThisNight.add(i.target);
    traces.push({ step: 'retribute', retributionist: i.seat, target: i.target, revived: true });
  }

  // Vampire conversion (Vampire faction). The single resolving bite (the lowest-
  // seat vampire's, chosen above) TURNS its target into a new Vampire — a role +
  // faction change, mirroring the executioner→jester / plaguebearer→pestilence
  // conversions. The bite CONVERTS iff, after this night's kills are settled:
  //   - the biting vampire is still alive (a staked vampire turns no one), and
  //   - the target is still alive (a corpse cannot be turned), and
  //   - the target was reachable (not jailed / dueled away), and
  //   - the target is CONVERTIBLE: a living TOWN or NEUTRAL_BENIGN seat that is
  //     NOT already a vampire and is NOT night-immune (recorded rule — Mafia/Triad/
  //     NK/other neutrals are left non-convertible; the bite just fails on them).
  // The converted seat is told privately "you have been turned" — carrying NO
  // other identity or role (as leak-trivial as `roleblocked`). A `convert` trace
  // records the outcome either way. A FRESH your_role is re-emitted to the convert
  // so its UI shows the Bite ability — and because yourRoleEffect omits `mates` for
  // the VAMPIRE faction, it carries the new (no-roster) role card ONLY, so the
  // knowledge-isolated design still leaks nothing (see DECISIONS.md "Vampire
  // conversion faction").
  if (resolvingBite !== null) {
    const vampire = seatOf(state, resolvingBite.vampire);
    const target = seatOf(state, resolvingBite.target);
    const vampireSurvived = vampire.alive && !dyingSet.has(resolvingBite.vampire);
    const targetSurvived = target.alive && !dyingSet.has(resolvingBite.target);
    const reachable = !jailed.has(resolvingBite.target) && !dueledTargets.has(resolvingBite.target);
    const convertible =
      (target.faction === 'TOWN' || target.faction === 'NEUTRAL_BENIGN') &&
      !isNightImmune(target);
    const staked = !vampireSurvived; // the vampire died — staked by a Hunter (or otherwise)
    const converted = vampireSurvived && targetSurvived && reachable && convertible;
    if (converted) {
      target.role = 'VAMPIRE';
      target.faction = 'VAMPIRE';
      const u = initialUses('VAMPIRE');
      target.usesRemaining = u.uses;
      target.selfUsesRemaining = u.self;
      // Tell the convert privately — no other seat's identity revealed.
      effects.push(toSeat(resolvingBite.target, { type: 'private_result', kind: 'turned' }));
      // Re-emit the role card so the convert's UI shows Bite. yourRoleEffect omits
      // `mates` for VAMPIRE → no roster leaks (knowledge-isolation preserved).
      effects.push(yourRoleEffect(state, target));
    }
    traces.push({
      step: 'convert',
      vampire: resolvingBite.vampire,
      target: resolvingBite.target,
      converted,
      staked,
    });
  }

  // Cult recruitment (Cult faction). The single resolving recruit (the Cult
  // Leader's, chosen above) DRAWS its target into the Cult — a role + faction
  // change to CULTIST/CULT, mirroring the vampire turn. The recruit CONVERTS iff,
  // after this night's kills are settled:
  //   - the Cult Leader is still alive (a dead Leader recruits no one — and with no
  //     Leader alive, recruitment is over for good: death STOPS growth), and
  //   - the target is still alive (a corpse cannot be drawn in), and
  //   - the target was reachable (not jailed / dueled away), and
  //   - the target is CONVERTIBLE: a living TOWN or NEUTRAL_BENIGN seat that is NOT
  //     already Cult and NOT night-immune (same convertible set as the Vampire —
  //     Mafia/Triad/Vampire/NK/other neutrals resist; the recruit just fails), and
  //   - the one-night COOLDOWN is clear: the Leader must rest the night after each
  //     conversion, so a recruit on night N forbids a recruit on night N+1
  //     (state.cultLastRecruitNight tracks the last successful-recruit night).
  // The recruited seat is told privately "you have been drawn into the Cult" —
  // carrying NO other identity or role (as leak-trivial as `roleblocked`/`turned`).
  // A `recruit` trace records the outcome either way. A FRESH your_role is re-emitted
  // to the recruit so its UI reflects the new CULTIST card — and because
  // yourRoleEffect omits `mates` for the CULT faction, it carries the new (no-roster)
  // role card ONLY, so the knowledge-isolated design still leaks nothing (see
  // DECISIONS.md "Cult conversion faction").
  if (resolvingRecruit !== null) {
    const leader = seatOf(state, resolvingRecruit.leader);
    const target = seatOf(state, resolvingRecruit.target);
    const leaderSurvived = leader.alive && !dyingSet.has(resolvingRecruit.leader);
    const targetSurvived = target.alive && !dyingSet.has(resolvingRecruit.target);
    const reachable = !jailed.has(resolvingRecruit.target) && !dueledTargets.has(resolvingRecruit.target);
    const convertible =
      (target.faction === 'TOWN' || target.faction === 'NEUTRAL_BENIGN') && !isNightImmune(target);
    const cooldownClear = state.nightNumber !== state.cultLastRecruitNight + 1;
    const recruited =
      leaderSurvived && targetSurvived && reachable && convertible && cooldownClear;
    if (recruited) {
      target.role = 'CULTIST';
      target.faction = 'CULT';
      const u = initialUses('CULTIST');
      target.usesRemaining = u.uses;
      target.selfUsesRemaining = u.self;
      // Record the conversion night for the one-night cooldown.
      state.cultLastRecruitNight = state.nightNumber;
      // Tell the recruit privately — no other seat's identity revealed.
      effects.push(toSeat(resolvingRecruit.target, { type: 'private_result', kind: 'recruited' }));
      // Re-emit the role card so the recruit's UI reflects CULTIST. yourRoleEffect
      // omits `mates` for CULT → no roster leaks (knowledge-isolation preserved).
      effects.push(yourRoleEffect(state, target));
    }
    traces.push({
      step: 'recruit',
      leader: resolvingRecruit.leader,
      target: resolvingRecruit.target,
      recruited,
    });
  }

  // Vampire Hunter retirement (Vampire faction): once NO vampires remain in the
  // game, every living Vampire Hunter's hunt is over — it becomes a Vigilante
  // (role change within TOWN, mirroring the executioner→jester / guardian→survivor
  // conversions). Evaluated AFTER this night's conversions and deaths, so a Hunter
  // does not retire while a freshly-turned vampire still walks. Resolved in
  // deterministic seat order.
  const anyVampireAlive = state.seats.some((s) => s.alive && s.faction === 'VAMPIRE');
  if (!anyVampireAlive) {
    for (const s of state.seats) {
      if (s.role !== 'VAMPIRE_HUNTER' || !s.alive) continue;
      s.role = 'VIGILANTE';
      // faction stays TOWN.
      const u = initialUses('VIGILANTE');
      s.usesRemaining = u.uses;
      s.selfUsesRemaining = u.self;
      traces.push({ step: 'promotion', kind: 'hunter_to_vigilante', seat: s.seat });
      // Re-emit the role card so the now-Vigilante seat sees Shoot, not Hunt.
      effects.push(yourRoleEffect(state, s));
    }
  }

  // Refresh mafia roster (drop dead members; a new Amnesiac→mafia is added).
  state.mafiaSeats = state.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);
  // Refresh triad roster (mirror of the mafia roster refresh above).
  state.triadSeats = state.seats.filter((s) => s.faction === 'TRIAD').map((s) => s.seat);

  return { effects, deaths, traces };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceRank(source: DeathCause): number {
  const i = KILL_SOURCE_ORDER.indexOf(source);
  return i === -1 ? KILL_SOURCE_ORDER.length : i;
}

/**
 * The concrete night ability a role naturally submits (batch E, Witch control).
 * Used to steer a controlled puppet's action onto the Witch's victim when the
 * puppet submitted nothing. Self-only / control / passive abilities (vest, spy,
 * alert, ignite, divine, the GF/Dragon-Head/Witch control, séance, jail-execute)
 * cannot be meaningfully redirected at a victim, so they return null. Mirrors
 * roleinfo.ts `roleToNightAbility` but scoped to the redirectable, single-target
 * "act on someone" abilities a Witch can weaponize.
 */
function roleNightAbility(role: RoleId): NightAbility | null {
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
    case 'DOCTOR':
      return 'protect';
    case 'BODYGUARD':
      return 'guard';
    case 'CRUSADER':
      return 'crusade';
    case 'AMBUSHER':
      return 'ambush';
    case 'HYPNOTIST':
      return 'hypnotize';
    case 'MASS_MURDERER':
      return 'massacre';
    case 'JUGGERNAUT':
      return 'juggernaut';
    case 'GUARDIAN_ANGEL':
      return 'shield';
    case 'ESCORT':
    case 'CONSORT':
    case 'VANGUARD':
      return 'roleblock';
    case 'VIGILANTE':
      return 'kill_vigilante';
    case 'MAFIOSO':
      return 'kill_mafia';
    case 'ENFORCER':
      return 'kill_triad';
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
    case 'PIRATE':
      return 'duel';
    case 'PLAGUEBEARER':
      return 'infect';
    case 'PESTILENCE':
      return 'pestilence';
    // Arsonist's douse is its visiting single-target action.
    case 'ARSONIST':
      return 'douse';
    // Not meaningfully redirectable at a victim (self / control / passive / convert).
    default:
      return null;
  }
}

function findJailor(state: GameState): SeatId | null {
  const j = state.seats.find((s) => s.role === 'JAILOR' && s.alive);
  return j ? j.seat : null;
}

function isNightImmune(seat: SeatState): boolean {
  return (
    seat.role === 'GODFATHER' ||
    seat.role === 'DRAGON_HEAD' ||
    seat.role === 'SERIAL_KILLER' ||
    seat.role === 'EXECUTIONER' ||
    seat.role === 'ARSONIST' ||
    seat.role === 'WEREWOLF' ||
    seat.role === 'MASS_MURDERER' ||
    seat.role === 'JUGGERNAUT' ||
    // Batch E: the Witch (control/spoiler) and Pestilence (the Plaguebearer's
    // powerful final form) are both untouchable in the night.
    seat.role === 'WITCH' ||
    seat.role === 'PESTILENCE'
  );
}

function isRoleblockImmune(seat: SeatState): boolean {
  return (
    seat.role === 'GODFATHER' ||
    seat.role === 'DRAGON_HEAD' ||
    // Batch E: the Witch and Pestilence cannot be roleblocked.
    seat.role === 'WITCH' ||
    seat.role === 'PESTILENCE'
  );
}

/** Roles an Amnesiac may NOT remember (the "win by a trick" benigns, batch B). */
const AMNESIAC_FORBIDDEN: ReadonlySet<RoleId> = new Set<RoleId>([
  'AMNESIAC',
  'JESTER',
  'EXECUTIONER',
]);

/**
 * Whether an Amnesiac may remember `tgt`'s role (batch B). The target must be a
 * DEAD seat whose role is not on the forbidden list, and — for a UNIQUE role — no
 * LIVING seat may currently hold that role (you cannot duplicate a one-of-a-kind
 * office that is still occupied).
 */
function canRemember(state: GameState, tgt: SeatState): boolean {
  if (tgt.alive) return false;
  const role = tgt.role;
  if (AMNESIAC_FORBIDDEN.has(role)) return false;
  if (UNIQUE_ROLES.includes(role) && state.seats.some((s) => s.alive && s.role === role)) {
    return false;
  }
  return true;
}

/**
 * Detect a Jailor execution: the jailor submitted a 'kill_jailor' night_action
 * targeting the (alive) prisoner and has executions remaining.
 */
function readJailorExecution(
  state: GameState,
  jailorSeat: SeatId | null,
  intents: Map<SeatId, NightIntent>,
): SeatId | null {
  if (jailorSeat === null || state.jailTarget === null) return null;
  if (seatOf(state, jailorSeat).usesRemaining <= 0) return null;
  if (!seatOf(state, state.jailTarget).alive) return null;
  const ji = intents.get(jailorSeat);
  if (ji && ji.ability === 'kill_jailor' && ji.target === state.jailTarget) {
    return state.jailTarget;
  }
  return null;
}

/**
 * The LOWEST-seat actor that VISITS `target` this night (per `actorVisits`,
 * excluding self-targets), among the post-block intents, skipping any seat in
 * `exclude`. Returns null if no qualifying visitor (batch C: Crusader/Ambusher).
 */
function lowestVisitorTo(
  state: GameState,
  intents: Map<SeatId, NightIntent>,
  target: SeatId,
  exclude: readonly SeatId[],
  extraVisits: readonly { actor: SeatId; target: SeatId }[] = [],
): SeatId | null {
  const excluded = new Set<SeatId>(exclude);
  let best: SeatId | null = null;
  for (const i of intents.values()) {
    if (i.target !== target) continue;
    if (i.seat === i.target) continue; // a self-target is not a visit
    if (excluded.has(i.seat)) continue;
    if (!actorVisits(seatOf(state, i.seat), i)) continue;
    if (best === null || i.seat < best) best = i.seat;
  }
  // Transporter (batch F) extra visit edges (it visits both houses it swapped).
  for (const v of extraVisits) {
    if (v.target !== target) continue;
    if (excluded.has(v.actor)) continue;
    if (!seatOf(state, v.actor).alive) continue;
    if (best === null || v.actor < best) best = v.actor;
  }
  return best;
}

/**
 * ALL actors that VISIT `target` this night (per `actorVisits`, excluding
 * self-targets), among the post-block intents, skipping any seat in `exclude`.
 * Returned sorted ascending. Used by the batch-D rampage/massacre killers, which
 * maul every visitor (not just the lowest like the Crusader/Ambusher).
 */
function visitorsTo(
  state: GameState,
  intents: Map<SeatId, NightIntent>,
  target: SeatId,
  exclude: readonly SeatId[],
  extraVisits: readonly { actor: SeatId; target: SeatId }[] = [],
): SeatId[] {
  const excluded = new Set<SeatId>(exclude);
  const out = new Set<SeatId>();
  for (const i of intents.values()) {
    if (i.target !== target) continue;
    if (i.seat === i.target) continue; // a self-target is not a visit
    if (excluded.has(i.seat)) continue;
    if (!actorVisits(seatOf(state, i.seat), i)) continue;
    if (!seatOf(state, i.seat).alive) continue;
    out.add(i.seat);
  }
  // Transporter (batch F) extra visit edges (it visits both houses it swapped).
  for (const v of extraVisits) {
    if (v.target !== target) continue;
    if (excluded.has(v.actor)) continue;
    if (!seatOf(state, v.actor).alive) continue;
    out.add(v.actor);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Whether tonight is a FULL MOON (batch D Werewolf / Juggernaut gate). Defined
 * deterministically as the EVEN-numbered nights (night 2, 4, …). Night 1 is not a
 * full moon, so the Werewolf and a fresh Juggernaut cannot kill on the first night.
 */
function isFullMoon(state: GameState): boolean {
  return state.nightNumber % 2 === 0;
}

/** Kills a Juggernaut needs before its attacks turn POWERFUL (batch D). */
const JUGGERNAUT_POWER_THRESHOLD = 2;

function actorVisits(_actor: SeatState, intent: NightIntent): boolean {
  // GF/Dragon-Head control never visits; the faction kill performer
  // (kill_mafia / kill_triad) DOES visit.
  switch (intent.ability) {
    case 'mafia_control':
    case 'triad_control':
      return false;
    case 'kill_jailor':
      return false; // jailing is not a street visit
    case 'vest':
      return false; // self
    case 'alert':
      return false; // the Veteran sits at home; alerting is not a visit
    case 'spy':
      return false; // the Spy stays home and listens
    case 'ignite':
      return false; // the Arsonist strikes the match at home
    case 'divine':
      return false; // the Psychic stays home; the vision comes to them
    case 'investigate_sheriff':
    case 'investigate_investigator':
    case 'investigate_consigliere':
    case 'investigate_track':
    case 'watch':
    case 'protect':
    case 'roleblock':
    case 'frame':
    case 'forge':
    case 'clean':
    case 'guard':
    case 'blackmail':
    case 'remember':
    case 'disguise':
    case 'douse':
    case 'crusade':
    case 'ambush':
    case 'hypnotize':
    case 'rampage':
    case 'massacre':
    case 'shield':
    case 'juggernaut':
    // Batch E: the Witch visits the puppet she rides; the Pirate visits the seat it
    // duels; the Plaguebearer/Pestilence visit their target.
    case 'witch_control': // eslint-disable-line no-fallthrough
    case 'duel':
    case 'infect':
    case 'pestilence':
    // Vampire faction: the Vampire visits the throat it bites; the Vampire Hunter
    // visits the neighbor it studies (so a Lookout sees both, and a vampire that
    // bites a Hunter is a visitor the Hunter can stake).
    case 'bite': // eslint-disable-line no-fallthrough
    case 'vampire_check':
    // Cult faction: the Cult Leader visits the soul it recruits (so a Lookout/
    // Tracker/Veteran/Crusader/Ambusher sees the call).
    case 'recruit': // eslint-disable-line no-fallthrough
    case 'kill_vigilante':
    case 'kill_mafia':
    case 'kill_triad':
    case 'kill_serial':
      return true;
    case 'retribute':
      // Retributionist (batch E): the revive is resolved in the promotion step, not
      // as a street visit — a graveside vigil, not a call on a living house.
      return false;
    // Batch F: the Trapper visits the ward it rigs (a Lookout/Veteran sees it). The
    // Transporter's two visits are recorded separately via `extraVisits` (it has two
    // houses, not one), so its own `transport` row contributes no single-target
    // visit here. The Coroner reads a grave, not a living house — no street visit.
    case 'trap':
      return true;
    case 'transport':
    case 'autopsy':
      return false;
    default:
      return false;
  }
}

/**
 * The role a target APPEARS to be for investigations / death reveal. A Disguiser
 * (batch B) overlays a dead seat's role here; everyone else shows their true role.
 */
function apparentRoleOf(target: SeatState): RoleId {
  return target.apparentRole ?? target.role;
}

/** Factions the Psychic's vision treats as "evil" (batch C; +VAMPIRE, +CULT). */
const PSYCHIC_EVIL_FACTIONS: ReadonlySet<Faction> = new Set<Faction>([
  'MAFIA',
  'TRIAD',
  'VAMPIRE',
  'CULT',
  'NEUTRAL_KILLING',
]);

/** Target size of a Psychic vision on a full board (capped by living seats). */
const PSYCHIC_VISION_SIZE = 3;

/**
 * Build a Psychic vision for `psychic` (batch C): a sorted set of living seats
 * (excluding the Psychic) that is GUARANTEED to contain at least one seat of the
 * required alignment — evil on odd nights, good on even nights — drawn from the
 * seeded PRNG. The payload carries only seat ids + the parity tag (no roles), so
 * it leaks nothing. If no anchor of the required alignment exists, an empty
 * vision is returned (the classic "no read tonight").
 */
function buildPsychicVision(
  state: GameState,
  psychic: SeatId,
): { parity: 'evil' | 'good'; seats: SeatId[]; prng: PrngState } {
  const parity: 'evil' | 'good' = state.nightNumber % 2 === 1 ? 'evil' : 'good';
  let prng = state.prng;

  const living = state.seats.filter((s) => s.alive && s.seat !== psychic);
  const isEvil = (s: SeatState): boolean => PSYCHIC_EVIL_FACTIONS.has(s.faction);
  const anchors = living.filter((s) => (parity === 'evil' ? isEvil(s) : !isEvil(s)));
  if (anchors.length === 0) {
    return { parity, seats: [], prng };
  }

  // Pick the guaranteed anchor seat of the required alignment.
  const pickedAnchor = pick(prng, anchors.map((s) => s.seat));
  prng = pickedAnchor.state;
  const anchorSeat = pickedAnchor.value;

  // Fill the rest of the vision from the OTHER living seats, PRNG-shuffled, up to
  // the target size. Then sort, so the payload reveals nothing about which seat
  // is the anchor.
  const others = living.map((s) => s.seat).filter((seat) => seat !== anchorSeat);
  const shuffled = shuffle(prng, others);
  prng = shuffled.state;
  const fill = shuffled.value.slice(0, Math.max(0, PSYCHIC_VISION_SIZE - 1));
  const seats = [anchorSeat, ...fill].sort((a, b) => a - b);
  return { parity, seats, prng };
}

function sheriffRead(target: SeatState, framed: ReadonlySet<SeatId>): SheriffResult {
  if (framed.has(target.seat)) return 'suspicious';
  // suspicious = Mafioso, Consort, Framer, Consigliere, Blackmailer, Disguiser,
  // Serial Killer, Arsonist (read against the APPARENT role, so a disguised
  // Disguiser reads as their disguise — batch B).
  const suspiciousRoles: RoleId[] = [
    'MAFIOSO',
    'CONSORT',
    'FRAMER',
    'CONSIGLIERE',
    'BLACKMAILER',
    'DISGUISER',
    'SERIAL_KILLER',
    'ARSONIST',
    'WEREWOLF',
    'MASS_MURDERER',
    'JUGGERNAUT',
    // Triad: the Enforcer and Vanguard read suspicious, mirroring their Mafia
    // counterparts (Mafioso / Consort). The Dragon Head reads clean like the GF.
    'ENFORCER',
    'VANGUARD',
    // Vampire faction: a Vampire reads suspicious (the Vampire Hunter, a Town role,
    // reads clean). A seat the coven turns therefore starts reading suspicious from
    // the night it is turned — its sheriff alignment tracks its true faction.
    'VAMPIRE',
    // Cult faction: the Cult Leader and the Cultist both read suspicious. A seat the
    // Cult recruits starts reading suspicious from the night it is drawn in — its
    // sheriff alignment tracks its true faction.
    'CULT_LEADER',
    'CULTIST',
  ];
  return suspiciousRoles.includes(apparentRoleOf(target)) ? 'suspicious' : 'not_suspicious';
}

function investigatorRead(target: SeatState, framed: ReadonlySet<SeatId>): InvestigatorClass {
  if (framed.has(target.seat)) return FRAMED_INVESTIGATOR_CLASS;
  const role = apparentRoleOf(target);
  for (const cls of Object.keys(INVESTIGATOR_CLASS_TABLE) as InvestigatorClass[]) {
    if (INVESTIGATOR_CLASS_TABLE[cls].includes(role)) return cls;
  }
  // Defensive default.
  return 'R1';
}

function applyUseDecrements(
  state: GameState,
  intents: Map<SeatId, NightIntent>,
  jailorExec: SeatId | null,
  jailorSeat: SeatId | null,
): void {
  for (const i of intents.values()) {
    const s = seatOf(state, i.seat);
    if (i.ability === 'kill_vigilante' && i.target !== null) {
      s.usesRemaining = Math.max(0, s.usesRemaining - 1);
    } else if (i.ability === 'alert' && s.role === 'VETERAN' && s.usesRemaining > 0) {
      // A Veteran consumes one alert per alerting night (jailed Veterans had their
      // intent removed before this point, so they do not burn an alert).
      s.usesRemaining = Math.max(0, s.usesRemaining - 1);
    } else if (i.ability === 'vest') {
      s.usesRemaining = Math.max(0, s.usesRemaining - 1);
      s.selfUsesRemaining = Math.max(0, s.selfUsesRemaining - 1);
    } else if (i.ability === 'protect' && i.target === i.seat) {
      // Doctor self-heal consumes a self-use.
      s.selfUsesRemaining = Math.max(0, s.selfUsesRemaining - 1);
    }
  }
  // Jailor execution consumes one execution use.
  if (jailorExec !== null && jailorSeat !== null) {
    const s = seatOf(state, jailorSeat);
    s.usesRemaining = Math.max(0, s.usesRemaining - 1);
  }
}

/**
 * Returns the seat promoted to Mafioso this night (so the caller can re-emit its
 * role card), or null if no succession fired.
 */
function applyMafiaSuccession(state: GameState, traces: ResolutionTrace[]): SeatState | null {
  const livingMafia = state.seats.filter((s) => s.alive && s.faction === 'MAFIA');
  const hasGodfather = livingMafia.some((s) => s.role === 'GODFATHER');
  const hasMafioso = livingMafia.some((s) => s.role === 'MAFIOSO');
  if (!hasGodfather && !hasMafioso && livingMafia.length > 0) {
    // Senior = lowest seat index among living mafia.
    const senior = livingMafia.slice().sort((a, b) => a.seat - b.seat)[0]!;
    senior.role = 'MAFIOSO';
    // faction stays MAFIA.
    traces.push({ step: 'promotion', kind: 'mafia_succession', seat: senior.seat, newRole: 'MAFIOSO' });
    return senior;
  }
  return null;
}

/**
 * Triad succession (mirror of {@link applyMafiaSuccession}). If the Dragon Head
 * and the last Enforcer are both gone but living Triad remain, the senior
 * (lowest-seat) living Triad member is promoted to Enforcer so the faction kill
 * carries on next night.
 */
function applyTriadSuccession(state: GameState, traces: ResolutionTrace[]): SeatState | null {
  const livingTriad = state.seats.filter((s) => s.alive && s.faction === 'TRIAD');
  const hasDragonHead = livingTriad.some((s) => s.role === 'DRAGON_HEAD');
  const hasEnforcer = livingTriad.some((s) => s.role === 'ENFORCER');
  if (!hasDragonHead && !hasEnforcer && livingTriad.length > 0) {
    const senior = livingTriad.slice().sort((a, b) => a.seat - b.seat)[0]!;
    senior.role = 'ENFORCER';
    // faction stays TRIAD.
    traces.push({ step: 'promotion', kind: 'triad_succession', seat: senior.seat, newRole: 'ENFORCER' });
    return senior;
  }
  return null;
}
