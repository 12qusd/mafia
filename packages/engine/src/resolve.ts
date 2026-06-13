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
  type DeathCause,
  type InvestigatorClass,
  type SheriffResult,
  INVESTIGATOR_CLASS_TABLE,
  FRAMED_INVESTIGATOR_CLASS,
} from '@nocturne/shared';
import type { Effect } from '@nocturne/shared';
import type { GameState, SeatState, NightIntent, ResolutionTrace } from './state.js';
import { pick } from './prng.js';
import { resolveBlocks, type BlockIntent } from './roleblock.js';
import { toSeat, seatOf } from './helpers.js';

/** Kill source order (fixed report order, §6.8.5). */
const KILL_SOURCE_ORDER: DeathCause[] = [
  'jailor_execute',
  'vigilante',
  'mafia',
  'serial_killer',
  'jester_grief',
];

interface KillIntent {
  source: DeathCause;
  attacker: SeatId | null;
  target: SeatId;
}

export interface ResolveResult {
  effects: Effect[];
  /** Seats that died this night, in fixed report order (for dawn pacing/announce). */
  deaths: { seat: SeatId; cause: DeathCause }[];
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
  // Step 1: JAIL
  // -------------------------------------------------------------------------
  const jailed = new Set<SeatId>();
  const jailorSeat = findJailor(state);
  if (state.jailTarget !== null && jailorSeat !== null) {
    const prisoner = state.jailTarget;
    if (seatOf(state, prisoner).alive) {
      jailed.add(prisoner);
      traces.push({ step: 'jail', jailor: jailorSeat, prisoner });
      // Prisoner's own intent is removed.
      intentBySeat.delete(prisoner);
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
  // Immune to roleblock: roleblockImmune roles (Godfather) + the SK (hazard).
  const immune = new Set<SeatId>();
  for (const s of state.seats) {
    if (!s.alive) continue;
    if (isRoleblockImmune(s)) immune.add(s.seat);
    if (s.role === 'SERIAL_KILLER') immune.add(s.seat);
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
  for (const i of intentBySeat.values()) {
    if (i.ability === 'protect' && i.target !== null) {
      // A revealed Mayor can no longer be healed by the Doctor (§6.5 #9).
      if (seatOf(state, i.target).mayorRevealed) continue;
      doctorShield.set(i.target, i.seat);
      traces.push({ step: 'protect', doctor: i.seat, target: i.target, kind: 'doctor' });
    } else if (i.ability === 'vest') {
      vested.add(i.seat);
      traces.push({ step: 'protect', doctor: i.seat, target: i.seat, kind: 'vest' });
    }
  }
  // Jail protection: prisoner is shielded.
  for (const p of jailed) {
    traces.push({ step: 'protect', doctor: jailorSeat ?? p, target: p, kind: 'jail' });
  }

  // -------------------------------------------------------------------------
  // Step 4: DECEPTION (framer marks)
  // -------------------------------------------------------------------------
  const framed = new Set<SeatId>();
  for (const i of intentBySeat.values()) {
    if (i.ability === 'frame' && i.target !== null) {
      framed.add(i.target);
      traces.push({ step: 'frame', framer: i.seat, target: i.target });
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

    // (c) night-immune (role flag, active vest) → fail; target told they were attacked.
    if (isNightImmune(target) || vested.has(k.target)) {
      traces.push({ step: 'kill', source: k.source, attacker: k.attacker, target: k.target, outcome: 'immune' });
      attackedSurvivors.add(k.target);
      if (k.attacker !== null) {
        effects.push(toSeat(k.attacker, { type: 'private_result', kind: 'attacked_survived' }));
      }
      continue;
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
  for (const i of intentBySeat.values()) {
    if (i.target === null) continue;
    const actor = seatOf(state, i.seat);
    if (!actorVisits(actor, i)) continue;
    // Self-targets are not visits.
    if (i.target === i.seat) continue;
    const list = visitorsByTarget.get(i.target) ?? [];
    list.push(i.seat);
    visitorsByTarget.set(i.target, list);
  }

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
    } else if (i.ability === 'watch') {
      const visitors = (visitorsByTarget.get(i.target) ?? [])
        .filter((v) => v !== i.seat) // lookout doesn't see itself
        .sort((a, b) => a - b);
      traces.push({ step: 'investigate', kind: 'lookout', investigator: i.seat, target: i.target, visitors });
      effects.push(toSeat(i.seat, { type: 'private_result', kind: 'lookout_result', target: i.target, visitors }));
    }
  }

  // -------------------------------------------------------------------------
  // Step 7 (partial): record deaths in fixed report order. Mutate seat state.
  // The caller composes death_announce effects for DAWN (or game_over).
  // -------------------------------------------------------------------------
  const deaths: { seat: SeatId; cause: DeathCause }[] = [];
  // Order deaths by kill-source rank, then seat.
  const dyingSeats = [...willDie.entries()].sort(
    (a, b) => sourceRank(a[1]) - sourceRank(b[1]) || a[0] - b[0],
  );
  for (const [seat, cause] of dyingSeats) {
    const s = seatOf(state, seat);
    s.alive = false;
    s.revealed = true;
    s.deathCause = cause;
    s.deathDay = state.dayNumber;
    deaths.push({ seat, cause });
    traces.push({ step: 'death', seat, role: s.role, cause });
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

  // Refresh mafia roster (drop dead members).
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
  return seat.role === 'GODFATHER' || seat.role === 'SERIAL_KILLER' || seat.role === 'EXECUTIONER';
}

function isRoleblockImmune(seat: SeatState): boolean {
  return seat.role === 'GODFATHER';
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
    case 'investigate_sheriff':
    case 'investigate_investigator':
    case 'watch':
    case 'protect':
    case 'roleblock':
    case 'frame':
    case 'kill_vigilante':
    case 'kill_mafia':
    case 'kill_serial':
      return true;
    default:
      return false;
  }
}

function sheriffRead(target: SeatState, framed: ReadonlySet<SeatId>): SheriffResult {
  if (framed.has(target.seat)) return 'suspicious';
  // suspicious = Mafioso, Consort, Framer, Serial Killer
  const suspiciousRoles: RoleId[] = ['MAFIOSO', 'CONSORT', 'FRAMER', 'SERIAL_KILLER'];
  return suspiciousRoles.includes(target.role) ? 'suspicious' : 'not_suspicious';
}

function investigatorRead(target: SeatState, framed: ReadonlySet<SeatId>): InvestigatorClass {
  if (framed.has(target.seat)) return FRAMED_INVESTIGATOR_CLASS;
  for (const cls of Object.keys(INVESTIGATOR_CLASS_TABLE) as InvestigatorClass[]) {
    if (INVESTIGATOR_CLASS_TABLE[cls].includes(target.role)) return cls;
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
