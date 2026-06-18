/**
 * Lobby & Room manager (BUILD_SPEC §7, §4.2, §13.4).
 *
 * Owns all Lobby and Room instances. Handles create/join/leave/list, start_game
 * (lock roster → build Room → engine init → drive loop), play-again (roster
 * flows back to a fresh lobby, §7.7), and graceful drain (§13.4: stop accepting
 * new lobbies, let running games finish).
 */

import {
  getSetup,
  type GameSetup,
  type LobbyVisibility,
  type LobbyConfig,
  type SetupSlot,
} from '@nocturne/shared';
import type { Connection } from '../ws/connection.js';
import type { Engine } from '../engine-adapter.js';
import type { Store } from '../db/index.js';
import type { Telemetry } from '../telemetry.js';
import type { BotManager } from '../bots/manager.js';
import { newId, newInviteCode, newSeed } from '../ids.js';
import { log } from '../log.js';
import { Lobby, resolveConfig } from './lobby.js';
import { Room, type ScheduleFn } from '../room/room.js';
import { fingerprintMatch } from '../audit/fingerprint.js';
import { awardMatchPoints } from '../points/award.js';

export interface ManagerDeps {
  engine: Engine;
  store: Store;
  telemetry: Telemetry;
  serverBuild: string;
  nameOf: (identityId: string) => string;
  /**
   * Injectable timer/clock seam for Rooms (§6.2). Production leaves these
   * undefined (Room falls back to real `setTimeout`/`Date.now`); tests and
   * accelerated sims pass a fake/accelerated clock so the whole game loop runs
   * deterministically without wall-clock waits.
   */
  schedule?: ScheduleFn;
  clock?: () => number;
  /**
   * Whether the server-wide TEST MODE gate is open (env NOCTURNE_TEST_MODE=1).
   * Test lobbies are also allowed when the creating session is an admin (checked
   * per-create via the connection identity).
   */
  testModeEnv?: boolean;
  /** BotManager hook (TEST MODE bot backfill), wired by app.ts. */
  bots?: BotManager;
  /** HMAC key for replay-integrity fingerprints (§9). */
  fingerprintSecret: string;
}

export class LobbyManager {
  private readonly lobbies = new Map<string, Lobby>();
  private readonly rooms = new Map<string, Room>();
  private readonly inviteIndex = new Map<string, string>(); // code → lobbyId
  /** identity id → lobby/room id they currently occupy. */
  private readonly identityScope = new Map<string, string>();
  private draining = false;

  constructor(private readonly deps: ManagerDeps) {}

  get isDraining(): boolean {
    return this.draining;
  }

  // --- Lobby creation / joining (§7.2, §7.3) -------------------------------

  createLobby(
    conn: Connection,
    input: { name: string; visibility: LobbyVisibility; setupId: string; config?: LobbyConfig },
  ): { lobby: Lobby } | { error: string } {
    if (this.draining) return { error: 'cannot_start' };
    const identityId = conn.identityId;
    if (!identityId) return { error: 'not_authenticated' };
    if (this.identityScope.has(identityId)) return { error: 'already_in_lobby' };
    const setup = getSetup(input.setupId);
    if (!setup) return { error: 'unknown_setup' };

    // TEST MODE gating (§5 is still law for normal games). A test lobby is only
    // honored when the env gate is open OR the creator is an admin. It is forced
    // private. Otherwise the testMode flag is stripped. Resolved BEFORE the
    // guest/public check so a forced-private test lobby is allowed for guests.
    const requestedTest = input.config?.testMode === true;
    let testMode = false;
    if (requestedTest) {
      const allowed = this.deps.testModeEnv === true || conn.identity?.isAdmin === true;
      if (!allowed) return { error: 'forbidden' };
      testMode = true;
    }
    const visibility: LobbyVisibility = testMode ? 'private' : input.visibility;
    if (conn.identity?.isGuest && visibility === 'public') {
      // Guests may only be in private lobbies (§7.1).
      return { error: 'forbidden' };
    }
    const cfg = resolveConfig(visibility, { ...input.config, testMode });
    const inviteCode = visibility === 'private' ? this.uniqueInvite() : null;
    const id = newId();
    const lobby = new Lobby(id, input.name, visibility, input.setupId, cfg, inviteCode, conn);
    this.lobbies.set(id, lobby);
    if (inviteCode) this.inviteIndex.set(inviteCode, id);
    this.identityScope.set(identityId, id);
    conn.lobbyId = id;
    this.deps.telemetry.lobbyCreated();
    log.info('lobby created', { id, visibility, setup: input.setupId, testMode });
    this.broadcastLobby(lobby);
    return { lobby };
  }

  private uniqueInvite(): string {
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode();
      if (!this.inviteIndex.has(code)) return code;
    }
    return newInviteCode();
  }

  joinLobby(
    conn: Connection,
    input: { lobbyId?: string; inviteCode?: string; asSpectator?: boolean },
  ): { lobby: Lobby } | { error: string } {
    const identityId = conn.identityId;
    if (!identityId) return { error: 'not_authenticated' };
    let lobbyId = input.lobbyId;
    if (!lobbyId && input.inviteCode) {
      lobbyId = this.inviteIndex.get(input.inviteCode.toUpperCase());
      if (!lobbyId) return { error: 'invalid_invite_code' };
    }
    if (!lobbyId) return { error: 'lobby_not_found' };
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return { error: 'lobby_not_found' };
    const existing = this.identityScope.get(identityId);
    if (existing && existing !== lobbyId) return { error: 'already_in_lobby' };
    const err = lobby.join(conn, input.asSpectator ?? false);
    if (err) return { error: err };
    this.identityScope.set(identityId, lobbyId);
    conn.lobbyId = lobbyId;
    conn.spectator = input.asSpectator ?? false;
    this.broadcastLobby(lobby);
    return { lobby };
  }

  leaveLobby(conn: Connection): void {
    const identityId = conn.identityId;
    if (!identityId) return;
    const scopeId = this.identityScope.get(identityId);
    if (!scopeId) return;
    const lobby = this.lobbies.get(scopeId);
    if (lobby) {
      const empty = lobby.leave(identityId);
      this.identityScope.delete(identityId);
      conn.lobbyId = null;
      if (empty) this.disposeLobby(lobby);
      else this.broadcastLobby(lobby);
      return;
    }
    // In a room: explicit leave = suicide at next night (§8).
    const room = this.rooms.get(scopeId);
    if (room) {
      room.markLeaving(identityId);
    }
  }

  // --- TEST MODE controls (§test mode) -------------------------------------

  /**
   * Handle a host-only `test_control` command. Returns an error code or null.
   * Validates: the connection is the host of a TEST-mode lobby/room. add/remove
   * bot are pre-game only; end_phase/request_state are in-game.
   */
  async testControl(
    conn: Connection,
    msg: { action: string; count?: number; policy?: 'scripted' | 'llm'; seatOrAll?: number | 'all' },
  ): Promise<string | null> {
    const identityId = conn.identityId;
    if (!identityId) return 'not_authenticated';

    // In-game controls (room exists).
    const room = this.roomOf(conn);
    if (room) {
      if (!room.isTestMode) return 'forbidden';
      if (room.godIdentityId !== identityId) return 'not_host';
      switch (msg.action) {
        case 'end_phase':
          room.endPhaseNow();
          return null;
        case 'request_state':
          room.emitDebugState();
          return null;
        case 'add_bot':
        case 'remove_bot':
          return 'wrong_phase'; // bot roster changes are pre-game only
        default:
          return 'bad_message';
      }
    }

    // Pre-game controls (lobby exists).
    const lobby = this.lobbyOf(conn);
    if (!lobby) return 'not_in_lobby';
    if (!lobby.config.testMode) return 'forbidden';
    if (!lobby.isHost(identityId)) return 'not_host';
    const bots = this.deps.bots;
    if (!bots) return 'forbidden';

    switch (msg.action) {
      case 'add_bot': {
        if (!lobby.inviteCode) return 'forbidden';
        const count = msg.count ?? 1;
        await bots.addBots(lobby.id, lobby.inviteCode, count, msg.policy ?? 'scripted');
        return null;
      }
      case 'remove_bot': {
        const which = msg.seatOrAll ?? 'all';
        bots.removeBots(lobby.id, which);
        return null;
      }
      case 'end_phase':
      case 'request_state':
        return 'not_in_game';
      default:
        return 'bad_message';
    }
  }

  // --- Host powers (§7.4) --------------------------------------------------

  setConfig(conn: Connection, config: LobbyConfig): string | null {
    const lobby = this.lobbyOf(conn);
    if (!lobby) return 'not_in_lobby';
    if (!lobby.isHost(conn.identityId as string)) return 'not_host';
    if (lobby.status !== 'waiting') return 'cannot_start';
    lobby.config = resolveConfig(lobby.visibility, config);
    this.broadcastLobby(lobby);
    return null;
  }

  kick(conn: Connection, targetIdentityId: string): string | null {
    const lobby = this.lobbyOf(conn);
    if (!lobby) return 'not_in_lobby';
    if (!lobby.isHost(conn.identityId as string)) return 'not_host';
    const err = lobby.kick(targetIdentityId);
    if (err) return err;
    this.identityScope.delete(targetIdentityId);
    this.broadcastLobby(lobby);
    return null;
  }

  // --- Start game (§7.5) ---------------------------------------------------

  startGame(conn: Connection): { room: Room } | { error: string } {
    if (this.draining) return { error: 'cannot_start' };
    const lobby = this.lobbyOf(conn);
    if (!lobby) return { error: 'not_in_lobby' };
    if (!lobby.isHost(conn.identityId as string)) return { error: 'not_host' };
    if (!lobby.canStart()) return { error: 'cannot_start' };

    const players = lobby.playerConnections();
    const roster = players.map((c) => ({
      identityId: c.identityId as string,
      name: this.deps.nameOf(c.identityId as string),
    }));
    const setup = getSetup(lobby.setupId);
    if (!setup) return { error: 'unknown_setup' };
    const playerCount = roster.length;
    const lockedSetup = lockSetupToCount(setup, playerCount);
    if (!lockedSetup) return { error: 'cannot_start' };

    const seed = newSeed();
    const roomId = lobby.id; // reuse the id; scope continuity.
    const room = new Room(
      roomId,
      lobby.setupId,
      lobby.config,
      seed,
      this.deps.engine,
      this.deps.schedule,
      this.deps.clock,
    );
    room.onGameOver = (r) => void this.onGameOver(r);
    // TEST MODE: the host becomes the god audience (debug_* in addition to
    // normal play). Set before init so begin()'s initial snapshot reaches them.
    if (lobby.config.testMode) room.godIdentityId = lobby.hostId;
    this.rooms.set(roomId, room);
    lobby.status = 'in_game';

    // Move all member connections into the room scope.
    for (const c of lobby.allConnections()) {
      const id = c.identityId as string;
      this.identityScope.set(id, roomId);
    }

    room.init(roster, lockedSetup);

    // Attach player connections to their seats; spectators as spectators. This
    // MUST happen before role delivery so seat-addressed effects reach sockets.
    for (const c of players) room.attach(c.identityId as string, c);
    for (const c of lobby.allConnections()) {
      if (!players.includes(c)) room.addSpectator(c.identityId as string, c);
    }

    // Emit game_started (public seat list).
    room.transport.broadcastPublic({
      v: 1,
      type: 'game_started',
      seats: room.publicSeats() as never,
      setupId: lobby.setupId,
      config: lobby.config,
    } as never);

    // Now deliver role cards + opening phase (sockets are bound to seats).
    room.begin();

    this.deps.telemetry.matchStarted(playerCount, playerCount, Date.now() - lobby.createdAt);
    this.lobbies.delete(lobby.id);
    if (lobby.inviteCode) this.inviteIndex.delete(lobby.inviteCode);
    log.info('game started', { room: roomId, players: playerCount });
    return { room };
  }

  private async onGameOver(room: Room): Promise<void> {
    this.deps.telemetry.matchCompleted();
    // TEST MODE: tear down any backfill bots for this room (auto-cleanup).
    this.deps.bots?.cleanup(room.id);
    // Persist match at end (§10) with a replay-integrity fingerprint (§9).
    try {
      const matchId = newId();
      const rec = room.matchRecord(matchId, this.deps.serverBuild);
      const events = room.actionLog.map((e) => ({ seq: e.seq, phase: e.phase, event: e.event }));
      const chat = room.chatLog.map((c) => ({
        seq: c.seq,
        channel: c.channel,
        senderSeat: c.senderSeat,
        body: c.body,
      }));
      const fingerprint = fingerprintMatch(
        {
          id: matchId,
          setupId: room.setupId,
          seed: room.seed,
          outcome: 'completed',
          players: rec.players,
          events,
          chat,
        },
        this.deps.fingerprintSecret,
      );
      await this.deps.store.writeMatch({
        id: matchId,
        setupId: room.setupId,
        config: room.config,
        seed: room.seed,
        startedAt: room.startedAt,
        endedAt: Date.now(),
        outcome: 'completed',
        serverBuild: this.deps.serverBuild,
        fingerprint,
        players: rec.players,
        events,
        chat,
      });
      // Award points & achievements to registered players (goal 4). Guests and
      // TEST-mode games are excluded inside awardMatchPoints. The engine stays
      // pure — all scoring is computed here, server-side.
      if (!room.isTestMode) {
        await awardMatchPoints({
          store: this.deps.store,
          room,
          matchId,
          players: rec.players,
          finalDay: rec.finalDay,
        });
      }
    } catch (err) {
      log.error('failed to persist match', { err: String(err) });
    }
    // Roster flows back into a fresh lobby (§7.7 play again). We create a new
    // waiting lobby keyed off the room; clients send create/join again. MVP:
    // simply dispose the room after a grace; "play again" is host re-creating.
    log.info('game over', { room: room.id });
  }

  // --- Lobby list (§7.3) ---------------------------------------------------

  publicLobbyList(): {
    id: string;
    name: string;
    players: number;
    capacity: number;
    setup: string;
    status: string;
  }[] {
    const out = [];
    for (const lobby of this.lobbies.values()) {
      if (lobby.visibility !== 'public') continue;
      const setup = getSetup(lobby.setupId);
      out.push({
        id: lobby.id,
        name: lobby.name,
        players: lobby.playerCount,
        capacity: setup?.maxPlayers ?? 15,
        setup: lobby.setupId,
        status: lobby.status,
      });
    }
    return out;
  }

  // --- Connection scope lookups --------------------------------------------

  lobbyOf(conn: Connection): Lobby | undefined {
    const id = conn.identityId ? this.identityScope.get(conn.identityId) : undefined;
    return id ? this.lobbies.get(id) : undefined;
  }
  roomOf(conn: Connection): Room | undefined {
    const id = conn.identityId ? this.identityScope.get(conn.identityId) : undefined;
    return id ? this.rooms.get(id) : undefined;
  }
  scopeIdOf(identityId: string): string | undefined {
    return this.identityScope.get(identityId);
  }
  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }
  getLobby(id: string): Lobby | undefined {
    return this.lobbies.get(id);
  }

  /** Handle a socket disconnect: detach from lobby/room, host migrate (§8). */
  onDisconnect(conn: Connection): void {
    const identityId = conn.identityId;
    if (!identityId) return;
    const scopeId = this.identityScope.get(identityId);
    if (!scopeId) return;
    const room = this.rooms.get(scopeId);
    if (room) {
      // Only detach if this exact connection is the bound one.
      const seat = room.seatForIdentity(identityId);
      if (seat !== undefined && room.seats[seat]?.conn === conn) {
        room.detach(identityId);
        this.deps.telemetry.disconnect();
      } else if (seat === undefined) {
        room.removeSpectator(identityId);
      }
      return;
    }
    const lobby = this.lobbies.get(scopeId);
    if (lobby) {
      const member = lobby.getMember(identityId);
      if (member && member.conn === conn) {
        const empty = lobby.leave(identityId);
        this.identityScope.delete(identityId);
        if (empty) this.disposeLobby(lobby);
        else this.broadcastLobby(lobby);
      }
    }
  }

  private disposeLobby(lobby: Lobby): void {
    this.lobbies.delete(lobby.id);
    if (lobby.inviteCode) this.inviteIndex.delete(lobby.inviteCode);
    // TEST MODE: clean up any backfill bots if the lobby closes pre-game.
    this.deps.bots?.cleanup(lobby.id);
  }

  broadcastLobby(lobby: Lobby): void {
    lobby.broadcast({
      v: 1,
      type: 'lobby_state',
      lobby: lobby.toDTO(this.deps.nameOf),
    } as never);
  }

  // --- Graceful drain (§13.4) ----------------------------------------------

  startDrain(): void {
    this.draining = true;
    // Reject new lobbies; let running games finish. Dispose empty lobbies.
    for (const lobby of [...this.lobbies.values()]) {
      if (lobby.status === 'waiting') {
        lobby.broadcast({ v: 1, type: 'error', code: 'cannot_start', detail: 'server draining' } as never);
      }
    }
  }

  /** Number of rooms still running (drain waits on this, §13.4). */
  activeRooms(): number {
    let n = 0;
    for (const r of this.rooms.values()) if (!r.isOver) n++;
    return n;
  }

  disposeAll(): void {
    this.deps.bots?.disposeAll();
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
    this.lobbies.clear();
  }
}

/**
 * Build a single-count setup whose `slotsByPlayerCount` has exactly the locked
 * roster size. The engine init reads the one entry. Category slots remain;
 * assignment is the engine's job (§6.10).
 */
function lockSetupToCount(setup: GameSetup, count: number): GameSetup | null {
  const slots: readonly SetupSlot[] | undefined = setup.slotsByPlayerCount[String(count)];
  if (!slots) return null;
  return {
    ...setup,
    minPlayers: count,
    maxPlayers: count,
    slotsByPlayerCount: { [String(count)]: [...slots] },
  };
}
