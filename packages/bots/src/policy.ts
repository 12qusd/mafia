/**
 * Bot play policy (BUILD_SPEC §12.2).
 *
 * "Random-legal-action with simple heuristics." The policy is driven entirely by
 * the bot's own {@link BotView} — the same information a human client has — plus a
 * seeded PRNG so games are reproducible. It NEVER consults the engine for play
 * decisions (§12.2): mafia coordinate a kill via mafia chat + night_action; town
 * roles act on random legal targets; everyone votes randomly with a small chance
 * to follow the existing tally; verdicts are random-weighted; occasional canned
 * noir chat lines are emitted.
 *
 * The policy reacts to two things: (1) phase_change frames (decide what to do this
 * phase) and (2) periodic ticks (so it can change a night action or follow a tally
 * before the deadline). It must handle every phase sequence without crashing.
 */

import { type BotClient } from './client.js';
import { type ServerMessage, type ClientMessage, type SeatId } from './protocol.js';
import { mulberry32, hashSeed } from './rng.js';

/** Canned ORIGINAL noir flavor (BUILD_SPEC §2.1.2 — written fresh for NOCTURNE). */
const NOIR_LINES = [
  'The rain never washes this town clean.',
  'Somebody at this table is lying through their teeth.',
  'I keep my cards close and my pistol closer.',
  'Quiet ones worry me more than the loud ones.',
  'Sleep light tonight. The lamplight hides knives.',
  'I trust the seat to my left about as far as I can throw a piano.',
  'Every alibi in this room smells like cheap gin.',
  'Name a number and let the dice fall where they may.',
  'You can vote me out, but the ledger still gets balanced.',
  'Three deaths in and nobody has clean hands.',
];

export interface PolicyOptions {
  /** Deterministic per-bot seed string. */
  seed: string;
  /** Probability of following the current vote tally instead of voting random. */
  followTallyChance?: number;
  /** Probability of emitting a chat line on a given day-discussion entry. */
  chatChance?: number;
}

/**
 * A stateless-ish policy bound to one BotClient. It writes decisions back through
 * the client's protocol-validated send path.
 */
export class BotPolicy {
  private readonly rng: () => number;
  private readonly followTallyChance: number;
  private readonly chatChance: number;
  /** Phase we last acted on, to act once per phase entry. */
  private lastActedPhase: string | null = null;
  /** The mafia kill target this night, coordinated by the lowest-seat mafia. */
  private mafiaPlanTarget: SeatId | null = null;

  constructor(
    private readonly bot: BotClient,
    opts: PolicyOptions,
  ) {
    this.rng = mulberry32(hashSeed(opts.seed));
    this.followTallyChance = opts.followTallyChance ?? 0.3;
    this.chatChance = opts.chatChance ?? 0.4;
  }

  /** React to one inbound frame. Safe to call on any frame in any order. */
  onFrame(msg: ServerMessage): void {
    if (this.bot.view.over) return;
    switch (msg.type) {
      case 'phase_change':
        this.onPhase(msg.phase);
        break;
      case 'vote_update':
        // Occasionally pile onto an existing accusation during DAY_VOTING.
        if (this.bot.view.phase === 'DAY_VOTING' && this.alive() && this.chance(0.15)) {
          this.castVote();
        }
        break;
      case 'trial_start':
        // Defense/judgment handled on phase_change; nothing here.
        break;
      default:
        break;
    }
  }

  /** Decide actions for a freshly entered phase. */
  private onPhase(phase: string): void {
    if (phase === this.lastActedPhase && phase !== 'NIGHT') return;
    this.lastActedPhase = phase;
    if (!this.alive()) return;

    switch (phase) {
      case 'DAY_0':
        this.maybeChat('day');
        // Jailor selects a prisoner from Day 1+ (not Day 0). Vigilante shoots N2+.
        break;
      case 'NIGHT':
        this.doNight();
        break;
      case 'DAWN':
        break;
      case 'DAY_DISCUSSION':
        this.maybeChat('day');
        this.maybeJailSelect();
        this.maybeMayorReveal();
        break;
      case 'DAY_VOTING':
        this.maybeChat('day');
        this.maybeJailSelect();
        this.castVote();
        break;
      case 'TRIAL_DEFENSE':
        this.maybeChat('day');
        break;
      case 'TRIAL_JUDGMENT':
        this.castVerdict();
        break;
      case 'EXECUTION':
        break;
      default:
        break;
    }
  }

  /** Periodic tick (the sim calls this a few times per phase). */
  tick(): void {
    if (this.bot.view.over || !this.alive()) return;
    const phase = this.bot.view.phase;
    if (phase === 'DAY_VOTING' && this.chance(this.followTallyChance)) {
      this.followTally();
    } else if (phase === 'NIGHT' && this.isMafiaKiller() && this.chance(0.2)) {
      // Re-affirm the coordinated kill (last submission wins, §6.2).
      this.submitMafiaKill();
    }
  }

  // --- Night ----------------------------------------------------------------

  private doNight(): void {
    const ability = this.nightAbility();
    if (!ability) return;

    // Vigilante cannot shoot Night 1 (§6.5). Night 1 follows DAY_0 (day 0), so
    // the first NIGHT has dayNumber 0; the engine enforces, but we respect it.
    if (ability === 'kill_vigilante' && this.firstNight()) return;

    if (this.isMafiaKiller()) {
      // Coordinate via mafia chat then submit. The lowest living mafia seat picks.
      this.coordinateMafiaKill();
      this.submitMafiaKill();
      return;
    }

    const target = this.pickNightTarget(ability);
    if (target === null && ability !== 'vest') return;
    this.bot.send({ v: 1, type: 'night_action', ability, target } as ClientMessage);
  }

  /** The lowest living mafia seat announces a kill target in mafia chat. */
  private coordinateMafiaKill(): void {
    const seat = this.bot.view.seat;
    if (seat === null) return;
    const livingMates = this.bot.view.mates.filter((m) => this.bot.view.alive.has(m));
    const allMafiaLiving = [seat, ...livingMates].filter((s) => this.bot.view.alive.has(s));
    const leader = Math.min(...allMafiaLiving);
    if (seat !== leader) return; // only the leader proposes
    const target = this.pickMafiaTarget();
    if (target === null) return;
    this.mafiaPlanTarget = target;
    this.bot.send({ v: 1, type: 'chat', channel: 'mafia', text: `Tonight: ${target}.` } as ClientMessage);
  }

  private submitMafiaKill(): void {
    const ability = this.nightAbility();
    if (ability !== 'kill_mafia' && ability !== 'mafia_control') return;
    const target = this.mafiaPlanTarget ?? this.pickMafiaTarget();
    if (target === null) return;
    this.bot.send({ v: 1, type: 'night_action', ability, target } as ClientMessage);
  }

  /** Choose a random non-mafia living seat as the mafia victim (§12.2). */
  private pickMafiaTarget(): SeatId | null {
    const mafia = new Set([this.bot.view.seat as SeatId, ...this.bot.view.mates]);
    const candidates = [...this.bot.view.alive].filter((s) => !mafia.has(s));
    return this.choice(candidates);
  }

  private pickNightTarget(ability: string): SeatId | null {
    const self = this.bot.view.seat;
    let candidates = [...this.bot.view.alive];
    // Most abilities target others; doctor/survivor may self-target.
    if (ability === 'vest') return self; // survivor vests self
    if (ability !== 'protect') {
      candidates = candidates.filter((s) => s !== self);
    }
    // Jailor execute: only if we actually jailed someone (server enforces); the
    // policy just tries occasionally.
    if (ability === 'kill_jailor') {
      if (!this.chance(0.5)) return null;
      candidates = candidates.filter((s) => s !== self);
    }
    return this.choice(candidates);
  }

  // --- Day abilities --------------------------------------------------------

  private maybeJailSelect(): void {
    if (this.bot.view.role !== 'JAILOR') return;
    if (this.bot.view.dayNumber < 1) return; // cannot jail on Day 0 (§6.5)
    if (!this.hasAbility('jail')) return;
    const self = this.bot.view.seat;
    const candidates = [...this.bot.view.alive].filter((s) => s !== self);
    const target = this.choice(candidates);
    if (target === null) return;
    this.bot.send({ v: 1, type: 'day_ability', ability: 'jail', target } as ClientMessage);
  }

  private maybeMayorReveal(): void {
    if (this.bot.view.role !== 'MAYOR' || this.bot.view.mayorRevealed) return;
    // Reveal sometimes from Day 2 onward (a real Mayor weighs the risk, §6.5).
    if (this.bot.view.dayNumber >= 2 && this.chance(0.4)) {
      this.bot.send({ v: 1, type: 'day_ability', ability: 'reveal' } as ClientMessage);
    }
  }

  // --- Voting & verdicts ----------------------------------------------------

  private castVote(): void {
    // Small chance to follow the tally leader; otherwise vote a random living
    // non-self seat, with some chance to skip.
    if (this.chance(this.followTallyChance) && this.bot.view.tallies.size > 0) {
      this.followTally();
      return;
    }
    if (this.chance(0.2)) {
      this.bot.send({ v: 1, type: 'vote', target: 'skip' } as ClientMessage);
      return;
    }
    const self = this.bot.view.seat;
    const candidates = [...this.bot.view.alive].filter((s) => s !== self);
    const target = this.choice(candidates);
    if (target === null) return;
    this.bot.send({ v: 1, type: 'vote', target } as ClientMessage);
  }

  private followTally(): void {
    if (this.bot.view.tallies.size === 0) {
      this.castVote();
      return;
    }
    let best: SeatId | null = null;
    let bestW = -1;
    for (const [seat, w] of this.bot.view.tallies) {
      if (seat === this.bot.view.seat) continue;
      if (w > bestW) {
        bestW = w;
        best = seat;
      }
    }
    if (best !== null && this.bot.view.alive.has(best)) {
      this.bot.send({ v: 1, type: 'vote', target: best } as ClientMessage);
    }
  }

  private castVerdict(): void {
    // Don't vote on our own trial (server ignores it anyway).
    if (this.bot.view.trialAccused === this.bot.view.seat) return;
    const r = this.rng();
    // Random-weighted: lean guilty a bit so games progress to executions.
    const value = r < 0.45 ? 'guilty' : r < 0.85 ? 'innocent' : 'abstain';
    this.bot.send({ v: 1, type: 'verdict', value } as ClientMessage);
  }

  // --- Chat -----------------------------------------------------------------

  private maybeChat(_channel: 'day'): void {
    if (!this.chance(this.chatChance)) return;
    const line = NOIR_LINES[Math.floor(this.rng() * NOIR_LINES.length)] ?? NOIR_LINES[0]!;
    this.bot.send({ v: 1, type: 'chat', channel: 'day', text: line } as ClientMessage);
  }

  // --- Helpers --------------------------------------------------------------

  private nightAbility(): string | null {
    const night = this.bot.view.abilities.find((a) => a.timing === 'night');
    return night?.id ?? null;
  }
  private hasAbility(id: string): boolean {
    return this.bot.view.abilities.some((a) => a.id === id);
  }
  private isMafiaKiller(): boolean {
    const ab = this.nightAbility();
    return ab === 'kill_mafia' || ab === 'mafia_control';
  }
  private alive(): boolean {
    return this.bot.view.selfAlive;
  }
  private firstNight(): boolean {
    // The first NIGHT comes right after DAY_0 (dayNumber 0). Subsequent nights
    // come after DAY_VOTING which bumps dayNumber. So firstNight ⇔ dayNumber 0.
    return this.bot.view.dayNumber === 0;
  }
  private choice<T>(arr: T[]): T | null {
    if (arr.length === 0) return null;
    return arr[Math.floor(this.rng() * arr.length)] ?? null;
  }
  private chance(p: number): boolean {
    return this.rng() < p;
  }
}
