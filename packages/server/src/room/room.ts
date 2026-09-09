/**
 * An in-game Room (BUILD_SPEC §4.2, §5, §6, §8).
 *
 * Wraps one engine instance plus per-seat connection state. Responsibilities:
 *   - bind seats to identities, not sockets (§8); reconnect re-attaches.
 *   - drive the game loop: schedule phase deadlines from `nextDeadline` with the
 *     250 ms network grace (§6.2), append `phase_end`, deliver effects.
 *   - act as the AudienceProvider for the transport dispatcher (§5): map
 *     'public'/'dead'/'mafia'/SeatId[] to sockets using engine-derived
 *     membership; spectators get 'public' only, never secrets, regardless of
 *     deadSeeAll (§7.8).
 *   - accumulate per-seat private-knowledge log + chat backlog for resume (§8).
 *
 * All engine calls go through the injected `Engine` (the adapter). The Room
 * never reads engine state internals except via the adapter view helpers.
 */

import {
  CHAT_BACKLOG_PER_CHANNEL,
  AFK_PHASE_THRESHOLD,
  NETWORK_GRACE_MS,
  type Effect,
  type SeatId,
  type RoleId,
  type ServerMessage,
  type ResolvedLobbyConfig,
  type GameSetup,
  type ChatChannel,
  type SeatSnapshot,
  type Phase,
} from '@nocturne/shared';
import type { Engine, GameState, GameEvent, SeatPreference } from '../engine-adapter.js';
import {
  ScopedTransport,
  sendToSocket,
  type AudienceProvider,
  type Sendable,
} from '../transport.js';
import type { Connection } from '../ws/connection.js';
import { log } from '../log.js';

export interface SeatBinding {
  seat: SeatId;
  identityId: string;
  name: string;
  conn: Connection | null;
  connected: boolean;
  afk: boolean;
  /** Phases since this seat last issued a command (AFK detection, §8). */
  idlePhases: number;
  leaving: boolean;
  lastWill: string;
  deathNote: string;
  /** Private results delivered to this seat (resume privateLog, §8). */
  privateLog: ServerMessage[];
  /** Cached role/faction from your_role for snapshots. */
  role: string | null;
  faction: string | null;
  abilities: unknown[];
  mates: SeatId[] | null;
}

interface ChatRecord {
  channel: ChatChannel;
  from: SeatId | 'Jailor';
  text: string;
  ts: number;
}

export type ScheduleFn = (cb: () => void, ms: number) => { cancel: () => void };

const defaultSchedule: ScheduleFn = (cb, ms) => {
  const t = setTimeout(cb, ms);
  if (t.unref) t.unref();
  return { cancel: () => clearTimeout(t) };
};

export class Room implements AudienceProvider {
  readonly transport = new ScopedTransport(this);
  readonly startedAt = Date.now();
  state: GameState;
  /** Per-seat binding indexed by seat id. */
  readonly seats: SeatBinding[] = [];
  /** identity id → seat id. */
  private readonly identityToSeat = new Map<string, SeatId>();
  /** Spectator connections (public only, §7.8). */
  private readonly spectators = new Map<string, Connection>();
  /** Per-channel chat backlog (cap 200/channel, §8). */
  private readonly chatBacklog = new Map<ChatChannel, ChatRecord[]>();
  private currentPhase: Phase = 'DAY_0';
  private dayNumber = 0;
  private endsAt: number | null = null;
  private deadlineTimer: { cancel: () => void } | null = null;
  private over = false;
  /** Replay only already-public UI state after welcome, never a god/debug view. */
  private readonly publicResume = new Map<string, ServerMessage>();
  /**
   * Queue this match was played in (persisted with the MatchRecord, §10). Set by
   * the LobbyManager at start: 'quickplay' for matchmade games, otherwise left
   * undefined (casual). System-triggered start sets this before `begin()`.
   */
  mode: string | undefined = undefined;
  /** Ranked season this match counted toward (ranked play). Set alongside
   * `mode='ranked'`; undefined for casual/quickplay. Persisted with the match
   * record and used to scope MMR updates at game over. */
  seasonId: string | undefined = undefined;
  /** Ordered action log for persistence/replay (§4.3). */
  readonly actionLog: { seq: number; phase: string; event: unknown }[] = [];
  private seq = 0;
  /** Full ordered chat log for replay persistence (§9, §10). Uncapped within a
   * match; written once at match end. The masked `from` ('Jailor') becomes a
   * null sender_seat. */
  readonly chatLog: { seq: number; channel: string; senderSeat: number | null; body: string }[] =
    [];
  private chatSeq = 0;
  onGameOver: ((room: Room) => void) | null = null;

  /**
   * Rematch lobby id ("play again", §7.7). After a game ends the room lingers so
   * the group can reconvene: the FIRST finished player to click "Play again"
   * CREATES a fresh private lobby and stamps its id here; subsequent clickers
   * JOIN that same lobby. Null until the first rematch is created.
   */
  rematchLobbyId: string | null = null;
  /**
   * Identity id of the lobby host this room was formed from (§7.7). Recorded at
   * `formGame` so a rematch can attribute/seed the new lobby; informational.
   */
  hostIdentityId: string | null = null;

  // --- TEST MODE god-view (gated; §5 still law for normal games) ------------
  /**
   * The god audience: the test lobby's host identity. Only set in a test-mode
   * room. The host receives debug_* frames IN ADDITION to normal play messages
   * (seated player) or spectate-only frames (host as spectator). Non-host
   * players in a test lobby receive nothing extra.
   */
  godIdentityId: string | null = null;
  /** Per-night trace history: full ResolutionTrace arrays keyed by emission. */
  readonly traceHistory: {
    dayNumber: number;
    nightNumber: number;
    traces: unknown[];
    deaths: { seat: SeatId; cause: string }[];
  }[] = [];
  /** Per-seat private-result history for the audit endpoint (seat → frames). */
  private readonly privateHistory = new Map<SeatId, ServerMessage[]>();

  constructor(
    readonly id: string,
    readonly setupId: string,
    readonly config: ResolvedLobbyConfig,
    readonly seed: string,
    private readonly engine: Engine,
    private readonly schedule: ScheduleFn = defaultSchedule,
    private readonly clock: () => number = Date.now,
  ) {
    this.state = {};
  }

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Initialize the engine with the locked roster and deliver role cards. Each
   * roster entry: { identityId, name }. Seat order follows roster order.
   */
  init(
    roster: { identityId: string; name: string; seatPreference?: SeatPreference }[],
    setup: GameSetup,
  ): void {
    // Build the per-seat preference array (seat order = roster order). Omit it
    // entirely when no seated player carries a preference so the engine takes the
    // byte-identical no-preference path (guests/bots and unentitled players carry
    // none — gated upstream in the lobby manager). See engine `assignWithPreferences`.
    const seatPreferences = roster.map((r) => r.seatPreference ?? { blacklist: [], prefer: [] });
    const anyPref = seatPreferences.some((p) => p.blacklist.length > 0 || p.prefer.length > 0);
    this.state = this.engine.init(setup, this.seed, {
      playerCount: roster.length,
      names: roster.map((r) => r.name),
      config: this.config,
      ...(anyPref ? { seatPreferences } : {}),
    });

    const seatIds = this.engine.allSeats(this.state);
    roster.forEach((r, i) => {
      const seat = seatIds[i] ?? i;
      const binding: SeatBinding = {
        seat,
        identityId: r.identityId,
        name: r.name,
        conn: null,
        connected: false,
        afk: false,
        idlePhases: 0,
        leaving: false,
        lastWill: '',
        deathNote: '',
        privateLog: [],
        role: null,
        faction: null,
        abilities: [],
        mates: null,
      };
      this.seats[seat] = binding;
      this.identityToSeat.set(r.identityId, seat);
    });
  }

  /**
   * Begin the game AFTER player connections have been attached to their seats.
   * Delivers role cards (seat-addressed, so sockets must already be bound),
   * schedules the first deadline, and broadcasts the opening phase.
   */
  begin(): void {
    this.deliverRoleCards();
    // Advance ASSIGN → DAY_0 (the engine emits the opening phase_change effect
    // and sets DAY_0's deadline). Uniform across real engine and fallback.
    this.applyEvent({ type: 'phase_end', ts: this.clock() });
    const info = this.engine.phaseInfo(this.state);
    this.currentPhase = info.phase;
    this.dayNumber = info.dayNumber;
    this.endsAt = info.endsAt;
    this.scheduleDeadline();
    // TEST MODE: seed the host with an initial god-view snapshot at game start.
    if (this.godIdentityId) this.emitDebugState();
  }

  /** Deliver per-seat role cards via the engine's `your_role` effect (§5). */
  private deliverRoleCards(): void {
    const views = this.engine.seats(this.state);
    for (const s of views) {
      const binding = this.seats[s.seat];
      if (!binding) continue;
      binding.role = s.role;
      binding.faction = s.faction;
      binding.abilities = this.engine.abilities(this.state, s.seat);
      const effect = this.engine.yourRole(this.state, s.seat);
      if (!effect) continue;
      const msg = effect.msg as { mates?: SeatId[] };
      binding.mates = msg.mates ?? null;
      binding.privateLog.push(effect.msg);
      this.transport.dispatchEffect(effect);
    }
  }

  // --- AudienceProvider (§5 transport routing) -----------------------------

  publicSockets(): Iterable<Sendable> {
    const out: Sendable[] = [];
    for (const s of this.seats) if (s?.conn) out.push(s.conn.socket);
    for (const c of this.spectators.values()) out.push(c.socket);
    return out;
  }
  socketsForSeats(seats: Iterable<SeatId>): Iterable<Sendable> {
    const out: Sendable[] = [];
    for (const seat of seats) {
      const b = this.seats[seat];
      if (b?.conn) out.push(b.conn.socket);
    }
    return out;
  }
  mafiaSeats(): SeatId[] {
    return this.engine.mafiaSeats(this.state);
  }
  triadSeats(): SeatId[] {
    return this.engine.triadSeats(this.state);
  }
  deadSeats(): SeatId[] {
    return this.engine.deadSeats(this.state);
  }

  // --- Connection binding (§8) ---------------------------------------------

  seatForIdentity(identityId: string): SeatId | undefined {
    return this.identityToSeat.get(identityId);
  }

  /** Attach a (re)connecting player to its seat; newest wins (§8). */
  attach(identityId: string, conn: Connection): SeatId | null {
    const seat = this.identityToSeat.get(identityId);
    if (seat === undefined) return null;
    const b = this.seats[seat];
    if (!b) return null;
    if (b.conn && b.conn !== conn) {
      // Duplicate connection: close the old one (newest wins, §8).
      b.conn.close(4000, 'superseded');
    }
    b.conn = conn;
    b.connected = true;
    this.broadcastSeatStatus(seat);
    return seat;
  }

  addSpectator(identityId: string, conn: Connection): void {
    this.spectators.set(identityId, conn);
  }
  removeSpectator(identityId: string): void {
    this.spectators.delete(identityId);
  }

  /** Mark a seat disconnected; game never pauses (§8). */
  detach(identityId: string): void {
    const seat = this.identityToSeat.get(identityId);
    if (seat === undefined) {
      this.spectators.delete(identityId);
      return;
    }
    const b = this.seats[seat];
    if (b) {
      b.conn = null;
      b.connected = false;
      this.broadcastSeatStatus(seat);
    }
  }

  isMember(identityId: string): boolean {
    return this.identityToSeat.has(identityId) || this.spectators.has(identityId);
  }

  /**
   * Whether any live connection is still attached to this room — a seated player
   * with a bound socket, or a spectator. Used after a "play again" detach to
   * decide if a finished room can be disposed (§7.7) so it does not leak.
   */
  hasAttachedConnections(): boolean {
    for (const s of this.seats) if (s?.conn) return true;
    return this.spectators.size > 0;
  }

  // --- Game loop (§6.2) ----------------------------------------------------

  private scheduleDeadline(): void {
    this.deadlineTimer?.cancel();
    const dl = this.engine.nextDeadline(this.state);
    if (!dl) {
      this.endsAt = null;
      return;
    }
    this.endsAt = dl.endsAt;
    const wait = Math.max(0, dl.endsAt - this.clock()) + NETWORK_GRACE_MS;
    this.deadlineTimer = this.schedule(() => this.onDeadline(), wait);
  }

  private onDeadline(): void {
    const prevPhase = this.currentPhase;
    this.applyEvent({ type: 'phase_end', ts: this.clock() });
    if (this.over) return;
    const info = this.engine.phaseInfo(this.state);
    if (info.phase !== prevPhase || info.dayNumber !== this.dayNumber) {
      // Phase changed: bump idle counters and AFK flags (§8). The engine already
      // emitted the authoritative phase_change effect; we do not re-broadcast.
      for (const s of this.seats) {
        if (!s || !s.connected) continue;
        s.idlePhases += 1;
        if (s.idlePhases >= AFK_PHASE_THRESHOLD && !s.afk) {
          s.afk = true;
          this.broadcastSeatStatus(s.seat);
        }
      }
    }
    this.currentPhase = info.phase;
    this.dayNumber = info.dayNumber;
    this.endsAt = info.endsAt;
    this.scheduleDeadline();
  }

  /** Apply one engine event, dispatch effects, persist to the action log. */
  applyEvent(event: GameEvent): void {
    if (this.over) return;
    const phase = this.currentPhase;
    const god = this.godIdentityId !== null;
    const traceCountBefore = god ? this.engine.traceCount(this.state) : 0;
    const phaseBefore = god ? this.engine.phaseInfo(this.state) : null;
    const { state, effects } = this.engine.apply(this.state, event);
    this.state = state;
    const seq = this.seq++;
    this.actionLog.push({ seq, phase, event });
    // TEST MODE: mirror every validated GameEvent to the god audience (debug_event).
    this.emitDebugEvent(seq, phase, event);
    // Detect a night resolution (traces grew) BEFORE dispatching so debug_trace
    // is emitted alongside the dawn frames. resolveNight appends traces on the
    // NIGHT→DAWN/GAME_OVER transition (phase_end during NIGHT).
    if (god && event.type === 'phase_end' && phase === 'NIGHT') {
      const nightDeaths = effects
        .filter((e) => (e.msg as { type?: string }).type === 'death_announce')
        .map((e) => {
          const m = e.msg as unknown as { seat: SeatId; cause: string };
          return { seat: m.seat, cause: m.cause };
        });
      this.emitDebugTrace(traceCountBefore, nightDeaths);
    }
    for (const e of effects) this.recordAndDispatch(e);
    // TEST MODE: a phase/day transition means the god gets a fresh snapshot.
    // (Derived from engine phaseInfo so it works for both the real engine and the
    // in-server fallback, which does not emit a phase_change effect.)
    if (god) {
      const after = this.engine.phaseInfo(this.state);
      if (
        !phaseBefore ||
        after.phase !== phaseBefore.phase ||
        after.dayNumber !== phaseBefore.dayNumber
      ) {
        this.emitDebugState();
      }
    }
    if (this.engine.isOver(this.state) && !this.over) {
      this.over = true;
      this.deadlineTimer?.cancel();
      this.onGameOver?.(this);
    }
  }

  // --- TEST MODE god-view emission -----------------------------------------

  /** Sockets in the god audience (the test-lobby host, seated or spectating). */
  private godSockets(): Sendable[] {
    if (!this.godIdentityId) return [];
    const out: Sendable[] = [];
    const seat = this.identityToSeat.get(this.godIdentityId);
    if (seat !== undefined) {
      const b = this.seats[seat];
      if (b?.conn) out.push(b.conn.socket);
    }
    const spec = this.spectators.get(this.godIdentityId);
    if (spec) out.push(spec.socket);
    return out;
  }

  /** Send a debug frame to the god audience only (never the normal audience). */
  private sendGod(msg: ServerMessage): void {
    for (const sock of this.godSockets()) sendToSocket(sock, msg);
  }

  /** Emit a full god-view snapshot (debug_state) to the host. */
  emitDebugState(): void {
    if (!this.godIdentityId) return;
    const view = this.engine.debugView(this.state);
    if (!view) return;
    this.sendGod({
      v: 1,
      type: 'debug_state',
      phase: view.phase,
      dayNumber: view.dayNumber,
      nightNumber: view.nightNumber,
      seats: view.seats,
      mafiaRoster: view.mafiaRoster,
      intents: view.intents,
      jailTarget: view.jailTarget,
      pendingJesterGrief: view.pendingJesterGrief,
      voteTallies: view.voteTallies,
      votesBySeat: view.votesBySeat,
      trial: view.trial,
      executionerTargets: view.executionerTargets,
    } as unknown as ServerMessage);
  }

  /** Emit the new traces produced by a night resolution (debug_trace). */
  private emitDebugTrace(
    traceCountBefore: number,
    deaths: { seat: SeatId; cause: string }[],
  ): void {
    const all = this.engine.debugTraces(this.state);
    const fresh = all.slice(traceCountBefore);
    const view = this.engine.debugView(this.state);
    const record = {
      dayNumber: view?.dayNumber ?? 0,
      nightNumber: view?.nightNumber ?? 0,
      traces: fresh,
      deaths,
    };
    this.traceHistory.push(record);
    this.sendGod({
      v: 1,
      type: 'debug_trace',
      dayNumber: record.dayNumber,
      nightNumber: record.nightNumber,
      traces: fresh,
      deaths,
    } as unknown as ServerMessage);
  }

  /** Mirror a validated GameEvent to the god audience (debug_event). */
  private emitDebugEvent(seq: number, phase: string, event: GameEvent): void {
    if (!this.godIdentityId) return;
    const { type, seat, ts, ...payload } = event as GameEvent & { ts?: number };
    this.sendGod({
      v: 1,
      type: 'debug_event',
      seq,
      phase,
      eventType: type,
      ...(typeof seat === 'number' ? { seat } : {}),
      payload,
      ts: ts ?? this.clock(),
    } as unknown as ServerMessage);
  }

  /** Record private/chat effects into per-seat logs, then dispatch (§5, §8). */
  private recordAndDispatch(effect: Effect): void {
    const type = (effect.msg as { type?: string }).type;
    if (effect.to === 'public') {
      const msg = effect.msg;
      if (msg.type === 'phase_change') {
        if (msg.phase !== 'DAY_VOTING') this.publicResume.delete('vote_update');
        if (!['TRIAL_DEFENSE', 'TRIAL_JUDGMENT', 'EXECUTION'].includes(msg.phase)) {
          this.publicResume.delete('trial_start');
          this.publicResume.delete('verdict_result');
        }
      } else if (['vote_update', 'trial_start', 'verdict_result', 'game_over'].includes(msg.type)) {
        this.publicResume.set(msg.type, msg);
      } else if (msg.type === 'seat_transform') {
        this.publicResume.set(`seat_transform:${msg.seat}`, msg);
      }
    }
    // Accumulate per-seat private knowledge for resume (§8).
    if (Array.isArray(effect.to) && (type === 'private_result' || type === 'your_role')) {
      for (const seat of effect.to) {
        const b = this.seats[seat];
        if (b) {
          b.privateLog.push(effect.msg);
          if (effect.msg.type === 'your_role') {
            b.role = effect.msg.role;
            b.faction = effect.msg.faction;
            b.abilities = effect.msg.abilities;
            b.mates = effect.msg.mates ?? null;
          }
        }
        // TEST MODE: keep an uncapped per-seat private-result history for the
        // audit endpoint (downloadable evidence; only retained in test rooms).
        if (this.godIdentityId) {
          let h = this.privateHistory.get(seat);
          if (!h) {
            h = [];
            this.privateHistory.set(seat, h);
          }
          h.push(effect.msg);
        }
      }
    }
    if (type === 'chat_message') {
      const m = effect.msg as unknown as ChatRecord & { channel: ChatChannel };
      this.appendChat(m.channel, { channel: m.channel, from: m.from, text: m.text, ts: m.ts });
      // Full ordered log for replay persistence (§9). Masked 'Jailor' → null seat.
      this.chatLog.push({
        seq: this.chatSeq++,
        channel: m.channel,
        senderSeat: typeof m.from === 'number' ? m.from : null,
        body: m.text,
      });
    }
    this.transport.dispatchEffect(effect);
  }

  private appendChat(channel: ChatChannel, rec: ChatRecord): void {
    let arr = this.chatBacklog.get(channel);
    if (!arr) {
      arr = [];
      this.chatBacklog.set(channel, arr);
    }
    arr.push(rec);
    if (arr.length > CHAT_BACKLOG_PER_CHANNEL) arr.shift();
  }

  /** The engine NightAbility key for a role (for night_action translation). */
  nightAbility(role: RoleId): string | null {
    return this.engine.nightAbilityFor(role);
  }

  /**
   * Publish only the public whisper metadata when the recipient has muted the
   * sender (§11.2): the "X whispers to Y" event is public, the content is not.
   */
  suppressedWhisperMeta(fromSeat: SeatId, toSeat: SeatId): void {
    this.transport.broadcastPublic({
      v: 1,
      type: 'whisper_meta',
      fromSeat,
      toSeat,
    } as unknown as ServerMessage);
  }

  /** Mark that a seat issued a command this phase (resets AFK, §8). */
  notedAction(seat: SeatId): void {
    const b = this.seats[seat];
    if (!b) return;
    b.idlePhases = 0;
    if (b.afk) {
      b.afk = false;
      this.broadcastSeatStatus(seat);
    }
  }

  // --- Broadcast helpers ---------------------------------------------------

  private broadcastSeatStatus(seat: SeatId): void {
    const b = this.seats[seat];
    if (!b) return;
    this.transport.broadcastPublic({
      v: 1,
      type: 'seat_status',
      seat,
      connected: b.connected,
      afk: b.afk,
    } as unknown as ServerMessage);
  }

  // --- Public state & snapshots (§5, §8) -----------------------------------

  /** Public seat list (no secrets); revealed role only for revealed seats (§5). */
  publicSeats(): unknown[] {
    const reveal = new Map<SeatId, { role: string; faction: string }>();
    // Public per-seat flags that affect the weighted vote: a revealed Mayor
    // weighs 3, an admin stump weighs 0. Both are already public knowledge (the
    // mayor reveal is a public `day_ability_ack`; a stump is a public
    // `seat_transform`), so exposing them here leaks nothing (§5).
    const mayorRevealed = new Set<SeatId>();
    const stumped = new Set<SeatId>();
    for (const s of this.engine.seats(this.state)) {
      if (s.revealed) reveal.set(s.seat, { role: s.role, faction: s.faction });
      if (s.mayorRevealed) mayorRevealed.add(s.seat);
      if (s.stumped) stumped.add(s.seat);
    }
    const dead = new Set(this.deadSeats());
    return this.seats
      .filter((s): s is SeatBinding => !!s)
      .map((s) => {
        const rev = reveal.get(s.seat);
        return {
          seat: s.seat,
          name: s.name,
          alive: !dead.has(s.seat),
          connected: s.connected,
          afk: s.afk,
          ...(rev ? { role: rev.role, faction: rev.faction } : {}),
          ...(mayorRevealed.has(s.seat) ? { mayorRevealed: true } : {}),
          ...(stumped.has(s.seat) ? { stumped: true } : {}),
        };
      });
  }

  /** Build the per-seat filtered resume snapshot (§8). */
  buildSnapshot(seat: SeatId): SeatSnapshot | null {
    const b = this.seats[seat];
    if (!b || b.role === null || b.faction === null) return null;
    const roleEffect = this.engine.yourRole(this.state, seat);
    const role = roleEffect?.msg.type === 'your_role' ? roleEffect.msg : null;
    const entitledChannels = this.entitledChannels(seat);
    const backlog: ChatRecord[] = [];
    for (const ch of entitledChannels) {
      for (const rec of this.chatBacklog.get(ch) ?? []) backlog.push(rec);
    }
    return {
      seat,
      phase: this.currentPhase,
      dayNumber: this.dayNumber,
      endsAt: this.endsAt,
      seats: this.publicSeats() as SeatSnapshot['seats'],
      ownRole: role?.role ?? (b.role as SeatSnapshot['ownRole']),
      ownFaction: role?.faction ?? (b.faction as SeatSnapshot['ownFaction']),
      abilities: this.engine.abilities(this.state, seat),
      ...(role?.mates ? { mates: role.mates } : {}),
      privateLog: b.privateLog,
      chatBacklog: backlog as SeatSnapshot['chatBacklog'],
      ...(b.lastWill ? { lastWill: b.lastWill } : {}),
      ...(b.deathNote ? { deathNote: b.deathNote } : {}),
    };
  }

  /** Called AFTER welcome so the client has a game before receiving its controls. */
  sendResumeContext(identityId: string): void {
    const seat = this.seatForIdentity(identityId);
    if (seat === undefined) return;
    const role = this.engine.yourRole(this.state, seat);
    if (role) this.transport.dispatchEffect(role);
    for (const msg of this.publicResume.values()) {
      this.transport.dispatchEffect({ to: [seat], msg });
    }
  }

  /** Chat channels a seat may read from for the backlog (§5, §6.4). */
  private entitledChannels(seat: SeatId): ChatChannel[] {
    const out: ChatChannel[] = ['day'];
    const dead = new Set(this.deadSeats());
    const mafia = new Set(this.mafiaSeats());
    const triad = new Set(this.triadSeats());
    if (mafia.has(seat)) out.push('mafia');
    if (triad.has(seat)) out.push('triad');
    if (dead.has(seat)) out.push('dead');
    return out;
  }

  // --- Persistence helper (§10) --------------------------------------------

  endedOutcome = 'abandoned';

  matchRecord(
    _matchId: string,
    _serverBuild: string,
  ): {
    players: {
      userOrGuestId: string;
      seat: number;
      role: string;
      faction: string;
      outcome: string;
      survived: boolean;
      deathDay: number | null;
    }[];
    /** Final in-game day the match reached (for loyalty/days-dead scoring §4). */
    finalDay: number;
  } {
    const views = this.engine.seats(this.state);
    const aliveBySeat = new Map(views.map((s) => [s.seat, s.alive]));
    const deathDayBySeat = new Map(views.map((s) => [s.seat, s.deathDay]));
    const over = this.engine.gameOver(this.state);
    const outcomeBySeat = new Map((over?.results ?? []).map((r) => [r.seat, r.outcome]));
    let finalDay = this.dayNumber;
    for (const dd of deathDayBySeat.values()) {
      if (dd !== null && dd > finalDay) finalDay = dd;
    }
    const players = this.seats
      .filter((s): s is SeatBinding => !!s)
      .map((s) => ({
        userOrGuestId: s.identityId,
        seat: s.seat,
        role: s.role ?? 'CITIZEN',
        faction: s.faction ?? 'TOWN',
        outcome: s.leaving ? 'left' : (outcomeBySeat.get(s.seat) ?? 'loss'),
        survived: aliveBySeat.get(s.seat) ?? false,
        deathDay: deathDayBySeat.get(s.seat) ?? null,
      }));
    return { players, finalDay };
  }

  get isOver(): boolean {
    return this.over;
  }

  dispose(): void {
    this.deadlineTimer?.cancel();
  }

  rosterIdentities(): { identityId: string; name: string }[] {
    return this.seats
      .filter((s): s is SeatBinding => !!s)
      .map((s) => ({ identityId: s.identityId, name: s.name }));
  }

  /** Send a server message to one seat's socket (e.g. post-game points_awarded,
   * §5: individually addressed). Routes through the single transport send path. */
  sendToSeat(seat: SeatId, msg: ServerMessage): void {
    this.transport.sendTo([seat], msg);
  }

  /** Display name bound to a seat, or null. */
  nameForSeat(seat: SeatId): string | null {
    return this.seats[seat]?.name ?? null;
  }

  /** Identity id bound to a seat, or null (admin god-powers, goal 8). */
  identityForSeat(seat: SeatId): string | null {
    return this.seats[seat]?.identityId ?? null;
  }

  // --- TEST MODE controls & audit ------------------------------------------

  get isTestMode(): boolean {
    return this.config.testMode === true;
  }

  /**
   * Immediately end the current phase (test_control end_phase). Cancels the
   * pending deadline timer and runs the same phase-end path as a natural
   * deadline, so the game advances without waiting out the clock.
   */
  endPhaseNow(): void {
    if (this.over) return;
    this.deadlineTimer?.cancel();
    this.onDeadline();
  }

  /**
   * Build the full audit JSON for a test room (god/admin only, §test audit):
   * setup, seed, action log, all traces, per-seat private-result history. This
   * is downloadable evidence for engine disputes + fixtures for golden tests.
   */
  buildAudit(): unknown {
    const view = this.engine.debugView(this.state);
    const over = this.engine.gameOver(this.state);
    return {
      roomId: this.id,
      setupId: this.setupId,
      seed: this.seed,
      config: this.config,
      startedAt: this.startedAt,
      phase: this.currentPhase,
      dayNumber: this.dayNumber,
      over: this.over,
      seats: this.seats
        .filter((s): s is SeatBinding => !!s)
        .map((s) => ({
          seat: s.seat,
          name: s.name,
          identityId: s.identityId,
          role: s.role,
          faction: s.faction,
          lastWill: s.lastWill,
          deathNote: s.deathNote,
        })),
      debugState: view,
      actionLog: this.actionLog,
      traces: this.engine.debugTraces(this.state),
      traceHistory: this.traceHistory,
      privateResults: [...this.privateHistory.entries()].map(([seat, frames]) => ({
        seat,
        frames,
      })),
      gameOver: over,
    };
  }

  /** Mark a leaver (explicit leave game, §8). */
  markLeaving(identityId: string): void {
    const seat = this.identityToSeat.get(identityId);
    if (seat === undefined) return;
    const b = this.seats[seat];
    if (b) b.leaving = true;
    this.applyEvent({ type: 'seat_left', seat, ts: this.clock() });
    log.info('seat marked leaving', { room: this.id, seat });
  }
}
