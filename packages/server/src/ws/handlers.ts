/**
 * Inbound message handlers (BUILD_SPEC §9, §5, §6.4, §11).
 *
 * Each handler receives a validated `ClientMessage` and the originating
 * Connection. Handlers validate server-side preconditions (§5.5: seat alive?
 * phase correct? target legal? rate limit ok?), enforce chat/whisper rate limits
 * (§6.4), and translate commands into engine events or lobby/manager calls.
 *
 * Outbound delivery is ALWAYS via a ScopedTransport (the lobby/room transport)
 * or the connection's pre-lobby send. No direct socket writes here (§5).
 */

import {
  PROTOCOL_VERSION,
  CHAT_TEXT_MAX,
  WHISPER_TEXT_MAX,
  LAST_WILL_MAX,
  DEATH_NOTE_MAX,
  type ClientMessage,
  type ServerMessage,
  type ErrorCode,
  type ChatChannel,
  type SeatId,
} from '@nocturne/shared';
import type { Connection } from './connection.js';
import type { GatewayContext } from './context.js';
import { processChat, sanitizeMultiline } from '../text.js';
import { log } from '../log.js';

function errorMsg(code: ErrorCode, detail?: string): ServerMessage {
  return { v: 1, type: 'error', code, ...(detail ? { detail } : {}) } as ServerMessage;
}

/** Send an error to the connection (pre-lobby/diagnostic path). */
function replyError(conn: Connection, code: ErrorCode, detail?: string): void {
  conn.send(errorMsg(code, detail));
}

export class MessageHandlers {
  constructor(
    private readonly ctx: GatewayContext,
    private readonly onIdentityBound: (conn: Connection) => void,
  ) {}

  /** Dispatch one validated message. Never throws (gateway also wraps). */
  async handle(conn: Connection, msg: ClientMessage): Promise<void> {
    // `ping` is an identity-free keepalive (it only echoes a `pong` with the
    // caller's timestamp). The client starts pinging the moment the socket opens
    // — immediately after `hello` — and the gateway dispatches frames
    // concurrently, so a ping can race ahead of the still-resolving async hello.
    // Exempting it from the pre-hello guard avoids a spurious "send hello first"
    // error toast on every page load. All other commands still require hello.
    if (msg.type !== 'hello' && msg.type !== 'ping' && !conn.helloDone) {
      replyError(conn, 'not_authenticated', 'send hello first');
      return;
    }
    switch (msg.type) {
      case 'hello':
        return this.onHello(conn, msg);
      case 'create_lobby':
        return this.onCreateLobby(conn, msg);
      case 'join_lobby':
        return this.onJoinLobby(conn, msg);
      case 'leave_lobby':
        return this.onLeaveLobby(conn);
      case 'lobby_config':
        return this.onLobbyConfig(conn, msg);
      case 'kick':
        return this.onKick(conn, msg);
      case 'start_game':
        return this.onStartGame(conn);
      case 'quick_play':
        return this.onQuickPlay(conn, msg);
      case 'leave_queue':
        return this.onLeaveQueue(conn);
      case 'play_again':
        return this.onPlayAgain(conn);
      case 'chat':
        return this.onChat(conn, msg);
      case 'whisper':
        return this.onWhisper(conn, msg);
      case 'vote':
        return this.onVote(conn, msg);
      case 'verdict':
        return this.onVerdict(conn, msg);
      case 'night_action':
        return this.onNightAction(conn, msg);
      case 'day_ability':
        return this.onDayAbility(conn, msg);
      case 'last_will':
        return this.onLastWill(conn, msg);
      case 'death_note':
        return this.onDeathNote(conn, msg);
      case 'report_player':
        return this.onReport(conn, msg);
      case 'ping':
        conn.lastPingT = msg.t;
        conn.send({ v: 1, type: 'pong', t: msg.t } as ServerMessage);
        return;
      case 'test_control':
        return this.onTestControl(conn, msg);
      case 'admin_action':
        return this.onAdminAction(conn, msg);
      default:
        replyError(conn, 'unknown_type');
    }
  }

  // --- Admin god-powers (in-game; admin only, goal 8) ----------------------

  private async onAdminAction(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'admin_action' }>,
  ): Promise<void> {
    const err = await this.ctx.manager.adminControl(conn, msg);
    if (err) replyError(conn, err as ErrorCode);
  }

  // --- TEST MODE control (host of a test lobby only) -----------------------

  private async onTestControl(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'test_control' }>,
  ): Promise<void> {
    const input: {
      action: string;
      count?: number;
      policy?: 'scripted' | 'llm';
      seatOrAll?: number | 'all';
    } = {
      action: msg.action,
    };
    if (msg.action === 'add_bot') {
      if (msg.count !== undefined) input.count = msg.count;
      if (msg.policy !== undefined) input.policy = msg.policy;
    } else if (msg.action === 'remove_bot') {
      input.seatOrAll = msg.seatOrAll;
    }
    const err = await this.ctx.manager.testControl(conn, input);
    if (err) replyError(conn, err as ErrorCode);
  }

  // --- hello / welcome (§9, §7.1, §8) --------------------------------------

  private async onHello(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'hello' }>,
  ): Promise<void> {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      conn.send({
        v: 1,
        type: 'force_update',
        minProtocolVersion: PROTOCOL_VERSION,
      } as ServerMessage);
      return;
    }
    let identity = await this.ctx.identity.resolveToken(msg.token);
    let issuedToken: string | undefined;
    if (!identity) {
      const guest = this.ctx.identity.createGuest();
      identity = guest.identity;
      issuedToken = guest.token;
    } else if (await this.ctx.identity.isBanned(identity)) {
      replyError(conn, 'forbidden', 'account banned');
      conn.close(4003, 'banned');
      return;
    }
    conn.identity = identity;
    conn.helloDone = true;
    this.onIdentityBound(conn);
    this.ctx.telemetry.seenUser(identity.id);

    // Resume snapshot if mid-game (§8).
    const scopeId = this.ctx.manager.scopeIdOf(identity.id);
    let resumeSnapshot: unknown;
    if (scopeId) {
      const room = this.ctx.manager.getRoom(scopeId);
      if (room) {
        const seat = room.attach(identity.id, conn);
        if (seat !== null) {
          resumeSnapshot = room.buildSnapshot(seat) ?? undefined;
          this.ctx.telemetry.resume();
        } else {
          room.addSpectator(identity.id, conn);
        }
      }
    }

    conn.send({
      v: 1,
      type: 'welcome',
      ...(identity.isGuest ? { guestId: identity.id } : { userId: identity.id }),
      ...(resumeSnapshot ? { resume: resumeSnapshot } : {}),
    } as ServerMessage);
    void issuedToken; // token also set via HTTP cookie; WS clients keep their own.

    // If the connection rejoined a lobby (pre-game), resend lobby_state.
    if (scopeId) {
      const lobby = this.ctx.manager.getLobby(scopeId);
      if (lobby) this.ctx.manager.broadcastLobby(lobby);
    }
  }

  // --- Lobby flow (§7) -----------------------------------------------------

  private async onCreateLobby(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'create_lobby' }>,
  ): Promise<void> {
    if (conn.identity && (await this.ctx.identity.isBanned(conn.identity))) {
      replyError(conn, 'forbidden', 'banned');
      return;
    }
    const res = await this.ctx.manager.createLobby(conn, {
      name: msg.name,
      visibility: msg.visibility,
      setupId: msg.setupId,
      ...(msg.config ? { config: msg.config } : {}),
    });
    if ('error' in res) {
      replyError(conn, res.error as ErrorCode);
      return;
    }
    conn.send({
      v: 1,
      type: 'lobby_state',
      lobby: res.lobby.toDTO(this.ctx.nameOf),
    } as ServerMessage);
  }

  private async onJoinLobby(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'join_lobby' }>,
  ): Promise<void> {
    if (conn.identity && (await this.ctx.identity.isBanned(conn.identity))) {
      replyError(conn, 'forbidden', 'banned');
      return;
    }
    const res = this.ctx.manager.joinLobby(conn, {
      ...(msg.lobbyId ? { lobbyId: msg.lobbyId } : {}),
      ...(msg.inviteCode ? { inviteCode: msg.inviteCode } : {}),
      ...(msg.asSpectator !== undefined ? { asSpectator: msg.asSpectator } : {}),
    });
    if ('error' in res) {
      replyError(conn, res.error as ErrorCode);
      return;
    }
    conn.send({
      v: 1,
      type: 'lobby_state',
      lobby: res.lobby.toDTO(this.ctx.nameOf),
    } as ServerMessage);
  }

  private onLeaveLobby(conn: Connection): void {
    this.ctx.manager.leaveLobby(conn);
  }

  private onLobbyConfig(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'lobby_config' }>,
  ): void {
    const err = this.ctx.manager.setConfig(conn, msg.config);
    if (err) replyError(conn, err as ErrorCode);
  }

  private onKick(conn: Connection, msg: Extract<ClientMessage, { type: 'kick' }>): void {
    const target =
      typeof msg.seatOrUserId === 'number'
        ? this.seatToIdentity(conn, msg.seatOrUserId)
        : msg.seatOrUserId;
    if (!target) {
      replyError(conn, 'not_in_lobby');
      return;
    }
    const err = this.ctx.manager.kick(conn, target);
    if (err) replyError(conn, err as ErrorCode);
  }

  private seatToIdentity(conn: Connection, seat: SeatId): string | null {
    const room = this.ctx.manager.roomOf(conn);
    if (room) return room.seats[seat]?.identityId ?? null;
    return null;
  }

  private async onStartGame(conn: Connection): Promise<void> {
    const res = await this.ctx.manager.startGame(conn);
    if ('error' in res) replyError(conn, res.error as ErrorCode);
  }

  // --- Quick-Play matchmaking (cold-start bot backfill) --------------------

  private async onQuickPlay(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'quick_play' }>,
  ): Promise<void> {
    if (conn.identity && (await this.ctx.identity.isBanned(conn.identity))) {
      replyError(conn, 'forbidden', 'banned');
      return;
    }
    // mode defaults to 'casual'; 'ranked' is account-gated inside quickPlay
    // (guests get 'not_authenticated' → the client prompts to sign in).
    const err = this.ctx.manager.quickPlay(conn, msg.mode ?? 'casual');
    if (err) replyError(conn, err as ErrorCode);
  }

  private onLeaveQueue(conn: Connection): void {
    this.ctx.manager.leaveQueue(conn);
  }

  // --- Play again / rematch (§7.7) -----------------------------------------

  /**
   * "Play again" from the game-over screen. The manager keeps the crowd together
   * (first caller creates a fresh private lobby, others join it) and broadcasts
   * `lobby_state` on success. On 'no_game' (the caller already left the finished
   * room) we reply `cannot_start` with a `no_game` detail so the client can fall
   * back to Quick Play; other error strings surface as their own code (mirrors
   * how {@link onQuickPlay}/{@link onStartGame} surface manager errors).
   */
  private async onPlayAgain(conn: Connection): Promise<void> {
    const err = await this.ctx.manager.playAgain(conn);
    if (!err) return;
    if (err === 'no_game') {
      replyError(conn, 'cannot_start', 'no_game');
      return;
    }
    replyError(conn, err as ErrorCode);
  }

  // --- In-game commands (§5.5, §6) -----------------------------------------

  private onChat(conn: Connection, msg: Extract<ClientMessage, { type: 'chat' }>): void {
    const channel = msg.channel as ChatChannel;
    if (!conn.chatLimiter.tryChat(channel)) {
      replyError(conn, 'rate_limited');
      return;
    }
    const { text } = processChat(msg.text, CHAT_TEXT_MAX);
    if (!text) return;

    // Lobby chat (pre-game).
    const lobby = this.ctx.manager.lobbyOf(conn);
    if (lobby) {
      if (channel !== 'lobby') {
        replyError(conn, 'wrong_phase');
        return;
      }
      const seat = 0; // lobbies have no seats; use a sentinel 'from' that the
      // client renders by member, not seat. We deliver via lobby transport.
      void seat;
      lobby.transport.broadcastPublic({
        v: 1,
        type: 'chat_message',
        channel: 'lobby',
        from: 0,
        text,
        ts: Date.now(),
      } as ServerMessage);
      return;
    }

    const room = this.ctx.manager.roomOf(conn);
    if (!room) {
      replyError(conn, 'not_in_lobby');
      return;
    }
    const seat = room.seatForIdentity(conn.identityId as string);
    if (seat === undefined) {
      replyError(conn, 'spectator_forbidden');
      return;
    }
    // Sanitize + rate-limit here (server's job, §6.4/§11.6); the engine owns
    // channel entitlement (§5/§6.4) and emits the addressed chat_message effects.
    room.applyEvent({ type: 'chat', seat, channel, text, ts: Date.now() });
    room.notedAction(seat);
  }

  private onWhisper(conn: Connection, msg: Extract<ClientMessage, { type: 'whisper' }>): void {
    const room = this.ctx.manager.roomOf(conn);
    if (!room) {
      replyError(conn, 'not_in_game');
      return;
    }
    if (!room.config.whispersEnabled) {
      replyError(conn, 'whispers_disabled');
      return;
    }
    if (!conn.chatLimiter.tryWhisper()) {
      replyError(conn, 'rate_limited');
      return;
    }
    const fromSeat = room.seatForIdentity(conn.identityId as string);
    if (fromSeat === undefined) {
      replyError(conn, 'spectator_forbidden');
      return;
    }
    const toSeat = msg.toSeat;
    if (!room.seats[toSeat]) {
      replyError(conn, 'illegal_target');
      return;
    }
    const { text } = processChat(msg.text, WHISPER_TEXT_MAX);
    if (!text) return;
    // Server-enforced mute (§11.2): if recipient muted sender, suppress content
    // delivery but still publish the public "X whispers to Y" metadata (§5).
    const recipientId = room.seats[toSeat]?.identityId;
    const muted = recipientId
      ? this.ctx.moderation.isMuted(recipientId, conn.identityId as string)
      : false;
    if (muted) {
      room.suppressedWhisperMeta(fromSeat, toSeat);
    } else {
      room.applyEvent({ type: 'whisper', seat: fromSeat, toSeat, text, ts: Date.now() });
    }
  }

  private onVote(conn: Connection, msg: Extract<ClientMessage, { type: 'vote' }>): void {
    const seat = this.requireSeat(conn);
    if (seat === null) return;
    const room = this.ctx.manager.roomOf(conn)!;
    room.applyEvent({ type: 'vote', seat, target: msg.target, ts: Date.now() });
    room.notedAction(seat);
  }

  private onVerdict(conn: Connection, msg: Extract<ClientMessage, { type: 'verdict' }>): void {
    const seat = this.requireSeat(conn);
    if (seat === null) return;
    const room = this.ctx.manager.roomOf(conn)!;
    room.applyEvent({ type: 'verdict', seat, value: msg.value, ts: Date.now() });
    room.notedAction(seat);
  }

  private onNightAction(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'night_action' }>,
  ): void {
    const seat = this.requireSeat(conn);
    if (seat === null) return;
    const room = this.ctx.manager.roomOf(conn)!;
    // Translate the client's ability string into the engine's NightAbility key
    // for the seat's role (the engine validates legality). `kill_jailor` is the
    // jailor's execute; other abilities map from the role.
    const binding = room.seats[seat];
    const role = binding?.role as Parameters<typeof room.nightAbility>[0] | undefined;
    const ability = role ? (room.nightAbility(role) ?? msg.ability) : msg.ability;
    room.applyEvent({
      type: 'night_action',
      seat,
      ability,
      target: msg.target,
      // Witch control (batch E) carries a SECOND target (the victim).
      ...(msg.target2 !== undefined ? { target2: msg.target2 } : {}),
      ts: Date.now(),
    });
    room.notedAction(seat);
  }

  private onDayAbility(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'day_ability' }>,
  ): void {
    const seat = this.requireSeat(conn);
    if (seat === null) return;
    const room = this.ctx.manager.roomOf(conn)!;
    room.applyEvent({
      type: 'day_ability',
      seat,
      ability: msg.ability,
      ...(msg.target !== undefined ? { target: msg.target } : {}),
      ts: Date.now(),
    });
    room.notedAction(seat);
  }

  private onLastWill(conn: Connection, msg: Extract<ClientMessage, { type: 'last_will' }>): void {
    const room = this.ctx.manager.roomOf(conn);
    const seat = room?.seatForIdentity(conn.identityId as string);
    if (!room || seat === undefined) {
      replyError(conn, 'not_in_game');
      return;
    }
    if (!room.config.lastWillsEnabled) return;
    const text = sanitizeMultiline(msg.text, LAST_WILL_MAX);
    const b = room.seats[seat];
    if (b) b.lastWill = text; // cached for resume snapshot (§8)
    // Forward to the engine so it reveals the will on death (§6.4).
    room.applyEvent({ type: 'last_will', seat, text, ts: Date.now() });
  }

  private onDeathNote(conn: Connection, msg: Extract<ClientMessage, { type: 'death_note' }>): void {
    const room = this.ctx.manager.roomOf(conn);
    const seat = room?.seatForIdentity(conn.identityId as string);
    if (!room || seat === undefined) {
      replyError(conn, 'not_in_game');
      return;
    }
    const text = sanitizeMultiline(msg.text, DEATH_NOTE_MAX);
    const b = room.seats[seat];
    if (b) b.deathNote = text;
    room.applyEvent({ type: 'death_note', seat, text, ts: Date.now() });
  }

  private async onReport(
    conn: Connection,
    msg: Extract<ClientMessage, { type: 'report_player' }>,
  ): Promise<void> {
    const room = this.ctx.manager.roomOf(conn);
    if (!room) {
      replyError(conn, 'not_in_game');
      return;
    }
    const targetBinding = room.seats[msg.seat];
    if (!targetBinding) {
      replyError(conn, 'illegal_target');
      return;
    }
    await this.ctx.moderation.report({
      reporter: conn.identityId as string,
      targetUser: targetBinding.identityId,
      matchId: room.id,
      category: msg.category,
      comment: msg.comment ?? null,
      chatContext: [],
    });
    this.ctx.telemetry.report();
  }

  private requireSeat(conn: Connection): SeatId | null {
    const room = this.ctx.manager.roomOf(conn);
    if (!room) {
      replyError(conn, 'not_in_game');
      return null;
    }
    const seat = room.seatForIdentity(conn.identityId as string);
    if (seat === undefined) {
      replyError(conn, 'spectator_forbidden');
      return null;
    }
    if (room.deadSeats().includes(seat)) {
      replyError(conn, 'seat_dead');
      return null;
    }
    return seat;
  }
}

export { errorMsg };
void log;
