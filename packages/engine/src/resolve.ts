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
import type { GameState, SeatState, NightIntent, ResolutionTrace } from './state.js';
import { pick } from './prng.js';
import { resolveBlocks, type BlockIntent } from './roleblock.js';
import { toSeat, seatOf } from './helpers.js';
import { initialUses } from './init.js';

/** Kill source order (fixed report order, §6.8.5). */
const KILL_SOURCE_ORDER: DeathCause[] = [
  'jailor_execute',
  'bodyguard',
  'veteran',
  'vigilante',
  'mafia',
  'serial_killer',
  'arsonist',
  'jester_grief',
];

/** Attack sources a Bodyguard intercepts (basic attacks, batch A). */
const BASIC_ATTACK_SOURCES: ReadonlySet<DeathCause> = new Set<DeathCause>([
  'mafia',
  'vigilante',
  'serial_killer',
  'veteran',
]);

interface KillIntent {
  source: DeathCause;
  attacker: SeatId | null;
  target: SeatId;
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
      if (ti && ti.ability !== 'mafia_control') {
        effects.push(toSeat(b.target, { type: 'private_result', kind: 'roleblocked' }));
      }
    }
    void tgt;
  }

  // Cancel blocked seats' intents.
  for (const seat of blockRes.blocked) {
    intentBySeat.delete(seat);
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
    }
  }

  // Veteran alert (batch A): an alerting Veteran kills every seat that VISITS them
  // this night (post-block, post-redirect intents). A visit by the mafia kill
  // performer, a doctor, a sheriff, etc. all count; self-targets and
  // non-visiting actions (control, jail, vest, alert) do not. The counter is a
  // basic attack — a night-immune visitor (Godfather / Serial Killer) survives.
  const veteranVisitors = new Map<SeatId, SeatId[]>(); // veteran → visitor list
  if (alerting.size > 0) {
    for (const i of intentBySeat.values()) {
      if (i.target === null) continue;
      if (!alerting.has(i.target)) continue;
      if (i.seat === i.target) continue; // a self-target is not a visit
      if (!actorVisits(seatOf(state, i.seat), i)) continue;
      const list = veteranVisitors.get(i.target) ?? [];
      list.push(i.seat);
      veteranVisitors.set(i.target, list);
    }
    for (const [vet, visitors] of veteranVisitors) {
      visitors.sort((a, b) => a - b);
      for (const v of visitors) {
        kills.push({ source: 'veteran', attacker: vet, target: v });
      }
    }
    // Record one alert trace per alerting Veteran (with its visitor list), sorted.
    for (const vet of [...alerting].sort((a, b) => a - b)) {
      traces.push({ step: 'alert', veteran: vet, visitors: (veteranVisitors.get(vet) ?? []).slice() });
    }
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

    // (c.25) Arsonist ignite (batch B): a POWERFUL attack that pierces basic
    // defense — past this point (not jailed, not night-immune) it cannot be
    // stopped by a doctor's heal, a bodyguard, or a vest. The doused seat burns.
    if (k.source === 'arsonist') {
      if (!willDie.has(k.target)) willDie.set(k.target, 'arsonist');
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
  // mafia becomes Mafioso (effective next night).
  applyMafiaSuccession(state, traces);

  // Executioner → Jester if target died at night.
  for (const s of state.seats) {
    if (s.role === 'EXECUTIONER' && s.alive && s.exeTarget !== null) {
      const tgt = seatOf(state, s.exeTarget);
      if (!tgt.alive && tgt.deathDay === state.dayNumber && deaths.some((d) => d.seat === s.exeTarget)) {
        s.role = 'JESTER';
        s.faction = 'NEUTRAL_BENIGN';
        s.exeTarget = null;
        traces.push({ step: 'promotion', kind: 'executioner_to_jester', seat: s.seat });
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
  }

  // Refresh mafia roster (drop dead members; a new Amnesiac→mafia is added).
  state.mafiaSeats = state.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);

  return { effects, deaths, traces };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceRank(source: DeathCause): number {
  const i = KILL_SOURCE_ORDER.indexOf(source);
  return i === -1 ? KILL_SOURCE_ORDER.length : i;
}

function findJailor(state: GameState): SeatId | null {
  const j = state.seats.find((s) => s.role === 'JAILOR' && s.alive);
  return j ? j.seat : null;
}

function isNightImmune(seat: SeatState): boolean {
  return (
    seat.role === 'GODFATHER' ||
    seat.role === 'SERIAL_KILLER' ||
    seat.role === 'EXECUTIONER' ||
    seat.role === 'ARSONIST'
  );
}

function isRoleblockImmune(seat: SeatState): boolean {
  return seat.role === 'GODFATHER';
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

function actorVisits(_actor: SeatState, intent: NightIntent): boolean {
  // GF control never visits; mafia kill performer (kill_mafia) DOES visit.
  switch (intent.ability) {
    case 'mafia_control':
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
    case 'kill_vigilante':
    case 'kill_mafia':
    case 'kill_serial':
      return true;
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

function applyMafiaSuccession(state: GameState, traces: ResolutionTrace[]): void {
  const livingMafia = state.seats.filter((s) => s.alive && s.faction === 'MAFIA');
  const hasGodfather = livingMafia.some((s) => s.role === 'GODFATHER');
  const hasMafioso = livingMafia.some((s) => s.role === 'MAFIOSO');
  if (!hasGodfather && !hasMafioso && livingMafia.length > 0) {
    // Senior = lowest seat index among living mafia.
    const senior = livingMafia.slice().sort((a, b) => a.seat - b.seat)[0]!;
    senior.role = 'MAFIOSO';
    // faction stays MAFIA.
    traces.push({ step: 'promotion', kind: 'mafia_succession', seat: senior.seat, newRole: 'MAFIOSO' });
  }
}
