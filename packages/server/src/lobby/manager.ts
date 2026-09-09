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
  chaosSetup,
  validateSetup,
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
import { fetchGatedSeatPreference } from './preferences.js';
import {
  Matchmaker,
  type MatchmakerHost,
  type MatchmakerTimings,
  type QueueMode,
} from './matchmaker.js';
import { Room, type ScheduleFn } from '../room/room.js';
import { fingerprintMatch } from '../audit/fingerprint.js';
import { awardMatchPoints } from '../points/award.js';
import { buildUserStatsSummary } from '../points/stats.js';
import { awardRankedRatings, RANKED_MODE } from '../ranked/award.js';
import { DEFAULT_RATING, type AdminAction } from '@nocturne/shared';

/**
 * Leaver re-queue cooldown (ranked): after abandoning a ranked match, a human is
 * blocked from re-queuing ranked for this long. Bounded, in-memory; bots/guests
 * never reach this path. Documented alongside LEAVER_PENALTY in ranked/award.ts.
 */
const LEAVER_COOLDOWN_MS = 5 * 60 * 1000;

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
  /**
   * Whether an LLM is configured (LLM_BASE_URL set). The quick-play matchmaker
   * uses this to decide whether to sprinkle a few LLM bots into the backfill;
   * scripted bots are always the reliable default and the floor.
   */
  llmAvailable?: boolean;
  /**
   * Override the quick-play matchmaker timings (fill window, bot-join poll). Used
   * by tests to make matchmaking complete in milliseconds; production omits it.
   */
  matchmakingTimings?: Partial<MatchmakerTimings>;
}

export class LobbyManager {
  private readonly lobbies = new Map<string, Lobby>();
  private readonly rooms = new Map<string, Room>();
  private readonly inviteIndex = new Map<string, string>(); // code → lobbyId
  /** identity id → lobby/room id they currently occupy. */
  private readonly identityScope = new Map<string, string>();
  private draining = false;
  /** Quick-play (casual) matchmaking queue + auto-forming (cold-start backfill). */
  readonly matchmaker: Matchmaker;
  /** Ranked matchmaking queue: forms season-tagged ranked games, MMR-bucketed. */
  readonly rankedMatchmaker: Matchmaker;
  /**
   * Current ranked season id, cached after {@link ensureSeason}. Ranked matches
   * and MMR updates are scoped to it. Null until the season is ensured on boot.
   */
  private currentSeasonId: string | null = null;
  /**
   * Best-effort MMR cache (identityId → mmr) for synchronous ranked bucketing.
   * Refreshed when a player enters the ranked queue; defaults to {@link DEFAULT_RATING}.
   * Bounded to {@link MMR_CACHE_CAP} entries with simple FIFO eviction so a long-
   * lived server with many distinct ranked players cannot grow it unboundedly.
   */
  private readonly mmrCache = new Map<string, number>();
  /**
   * Leaver re-queue cooldowns: userId → epoch-ms the ranked cooldown expires.
   * Set at game-over for anyone who abandoned a ranked match; checked (and lazily
   * pruned) in {@link quickPlay} for the 'ranked' queue. Bounded by the active
   * ranked population; expired entries are dropped on read.
   */
  private readonly rankedCooldownUntil = new Map<string, number>();

  constructor(private readonly deps: ManagerDeps) {
    this.matchmaker = new Matchmaker(
      this.makeMatchmakerHost(),
      this.deps.matchmakingTimings,
      'casual',
    );
    this.rankedMatchmaker = new Matchmaker(
      this.makeMatchmakerHost(),
      this.deps.matchmakingTimings,
      'ranked',
    );
  }

  /**
   * Ensure a current ranked season exists and cache its id (called on boot).
   * Idempotent. Without a persistent store this is a no-op (ranked needs accounts).
   */
  async ensureSeason(name: string): Promise<void> {
    try {
      const season = await this.deps.store.ensureCurrentSeason(name);
      this.currentSeasonId = season.id;
    } catch (err) {
      log.warn('could not ensure ranked season', { err: String(err) });
    }
  }

  /**
   * Season rollover (admin-triggered, ranked lifecycle). Ends the current season,
   * opens a new one, and soft-resets every rating into it (the store does this
   * transactionally). The manager then PICKS UP the new season: it updates the
   * cached {@link seasonId} so subsequent ranked games are tagged with the new
   * season, and clears the MMR bucketing cache so it re-warms from the reset
   * ratings. Returns the new current season. Persistent stores only.
   */
  async rolloverSeason(newName: string): Promise<{ id: string; name: string } | { error: string }> {
    if (!this.deps.store.persistent) return { error: 'not_persistent' };
    try {
      const season = await this.deps.store.rolloverSeason(newName);
      this.currentSeasonId = season.id;
      // The bucketing cache holds OLD-season MMRs; drop it so it re-warms from the
      // soft-reset new-season ratings on the next ranked queue.
      this.mmrCache.clear();
      log.info('season rolled over', { seasonId: season.id, name: season.name });
      return { id: season.id, name: season.name };
    } catch (err) {
      log.error('season rollover failed', { err: String(err) });
      return { error: 'internal_error' };
    }
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** The current ranked season id, or null if none has been ensured (ranked play). */
  get seasonId(): string | null {
    return this.currentSeasonId;
  }

  // --- Lobby creation / joining (§7.2, §7.3) -------------------------------

  async createLobby(
    conn: Connection,
    input: { name: string; visibility: LobbyVisibility; setupId: string; config?: LobbyConfig },
  ): Promise<{ lobby: Lobby } | { error: string }> {
    if (this.draining) return { error: 'cannot_start' };
    const identityId = conn.identityId;
    if (!identityId) return { error: 'not_authenticated' };
    if (this.identityScope.has(identityId)) return { error: 'already_in_lobby' };
    // Resolve shipped / custom: / chaos: setups to a concrete GameSetup. Custom
    // setups are async store reads; all are validated before use so a malformed
    // setup can never reach engine init().
    const resolved = await this.resolveSetup(input.setupId);
    if ('error' in resolved) return { error: resolved.error };

    // TEST MODE gating (§5 is still law for normal games). A test lobby is only
    // honored when the env gate is open OR the creator is an admin. It is forced
    // private. Otherwise the testMode flag is stripped. Resolved BEFORE the
    // guest/public check so a forced-private test lobby is allowed for guests.
    const requestedTest = input.config?.testMode === true;
    let testMode = false;
    if (requestedTest) {
      if (!this.testModeAllowed(conn)) return { error: 'forbidden' };
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
    const lobby = new Lobby(
      id,
      input.name,
      visibility,
      input.setupId,
      cfg,
      inviteCode,
      conn,
      resolved.setup,
    );
    this.lobbies.set(id, lobby);
    if (inviteCode) this.inviteIndex.set(inviteCode, id);
    this.identityScope.set(identityId, id);
    conn.lobbyId = id;
    this.deps.telemetry.lobbyCreated();
    log.info('lobby created', { id, visibility, setup: input.setupId, testMode });
    this.broadcastLobby(lobby);
    return { lobby };
  }

  /**
   * Whether this connection may create or control a TEST-mode lobby.
   *
   * - Persistent store (production with real accounts): admin-only. The
   *   NOCTURNE_TEST_MODE env gate no longer opens test mode to any user — it
   *   would let any player reach test/audit/debug surfaces. Owner QA still works
   *   via an admin account. (Task A: close the abuse hole.)
   * - Non-persistent store (NO_DB/CI/dev, no accounts exist): keep it open —
   *   honored when the env gate is on OR the (mock) identity is admin, so the
   *   existing test-mode test suite behaves unchanged.
   */
  private testModeAllowed(conn: Connection): boolean {
    if (this.deps.store.persistent) return conn.identity?.isAdmin === true;
    return this.deps.testModeEnv === true || conn.identity?.isAdmin === true;
  }

  private uniqueInvite(): string {
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode();
      if (!this.inviteIndex.has(code)) return code;
    }
    return newInviteCode();
  }

  /**
   * Resolve a setupId to a concrete, validated GameSetup. Routes by prefix:
   *  - `custom:<uuid>` → loaded from the store (404 ⇒ unknown_setup).
   *  - `chaos:<seed>`  → generated deterministically (multi-count, 7..15).
   *  - otherwise       → a shipped setup via `getSetup`.
   * Every resolved setup is validated; an invalid one (e.g. tampered custom row)
   * is rejected so it can never crash engine init().
   */
  private async resolveSetup(setupId: string): Promise<{ setup: GameSetup } | { error: string }> {
    let setup: GameSetup | undefined;
    if (setupId.startsWith('custom:')) {
      const row = await this.deps.store.getCustomSetup(setupId);
      if (!row) return { error: 'unknown_setup' };
      setup = row.setup;
    } else if (setupId.startsWith('chaos:')) {
      // Build a full auto-scaling chaos setup from the seed in the id.
      setup = chaosSetup(setupId.slice('chaos:'.length));
    } else {
      setup = getSetup(setupId);
    }
    if (!setup) return { error: 'unknown_setup' };
    if (!validateSetup(setup).ok) return { error: 'unknown_setup' };
    return { setup };
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
    // Pre-fetch this player's UNLOCK-GATED role preferences (goal 3) into the
    // connection so the synchronous start path can read them without an await.
    // Best-effort; failures leave the cache null (⇒ no preferences). Refreshed
    // again at game-start to pick up any mid-lobby edits.
    void this.refreshSeatPreference(conn);
    this.broadcastLobby(lobby);
    return { lobby };
  }

  /**
   * Refresh a connection's cached, UNLOCK-GATED role preferences (goal 3) from
   * the store. Best-effort: on any error the cache is left as-is. Called on
   * lobby-join and again just before a game forms so the synchronous start path
   * reads fresh, gate-enforced preferences without an await.
   */
  async refreshSeatPreference(conn: Connection): Promise<void> {
    const id = conn.identityId;
    if (!id) return;
    try {
      conn.seatPreference = await fetchGatedSeatPreference(this.deps.store, id);
    } catch (e) {
      log.warn('refreshSeatPreference failed', { id, err: String(e) });
    }
  }

  /** Refresh every player connection's cached preferences for a lobby (pre-start). */
  private async refreshLobbyPreferences(lobby: Lobby): Promise<void> {
    await Promise.all(lobby.playerConnections().map((c) => this.refreshSeatPreference(c)));
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
      if (room.isOver) {
        room.detach(identityId);
        room.removeSpectator(identityId);
        this.identityScope.delete(identityId);
        conn.lobbyId = null;
        conn.spectator = false;
        this.disposeRoomIfEmpty(room);
      } else {
        room.markLeaving(identityId);
      }
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
    msg: {
      action: string;
      count?: number;
      policy?: 'scripted' | 'llm';
      seatOrAll?: number | 'all';
    },
  ): Promise<string | null> {
    const identityId = conn.identityId;
    if (!identityId) return 'not_authenticated';
    // Persistent (production) test-control is admin-only — same gate as creating
    // a test lobby. In NO_DB the gate is open (the host check below suffices).
    if (this.deps.store.persistent && conn.identity?.isAdmin !== true) return 'forbidden';

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

  // --- Admin god-powers (in-game; admin only, goal 8) ----------------------

  /**
   * Handle an in-game `admin_action`. Requires the connection's identity to be
   * an admin. kill/stump go to the engine as logged, replayable events;
   * points/ban/force-phase are applied server-side. Every action is logged to
   * admin_audit. Returns an error code or null.
   */
  async adminControl(conn: Connection, msg: AdminAction): Promise<string | null> {
    const identityId = conn.identityId;
    if (!identityId) return 'not_authenticated';
    if (!conn.identity?.isAdmin) return 'forbidden';
    const room = this.roomOf(conn);
    if (!room) return 'not_in_game';
    const now = this.deps.clock?.() ?? Date.now();
    const store = this.deps.store;
    const audit = (detail: unknown): void => {
      void store.logAdminAction(identityId, `admin_${msg.action}`, detail);
    };

    switch (msg.action) {
      case 'force_phase':
        room.endPhaseNow();
        audit({ room: room.id });
        return null;
      case 'kill': {
        if (msg.targetSeat === undefined) return 'illegal_target';
        room.applyEvent({ type: 'admin_kill', seat: msg.targetSeat, ts: now });
        audit({ room: room.id, seat: msg.targetSeat, reason: msg.reason });
        return null;
      }
      case 'stump': {
        if (msg.targetSeat === undefined) return 'illegal_target';
        room.applyEvent({ type: 'admin_stump', seat: msg.targetSeat, ts: now });
        audit({ room: room.id, seat: msg.targetSeat, reason: msg.reason });
        return null;
      }
      case 'grant_points':
      case 'revoke_points': {
        if (msg.targetSeat === undefined) return 'illegal_target';
        const userId = room.identityForSeat(msg.targetSeat);
        if (!userId || userId.startsWith('guest:')) return 'illegal_target';
        const amount = (msg.points ?? 0) * (msg.action === 'grant_points' ? 1 : -1);
        await this.adminAdjustPoints(room, msg.targetSeat, userId, amount, identityId, now);
        return null;
      }
      case 'temp_ban': {
        if (msg.targetSeat === undefined) return 'illegal_target';
        const userId = room.identityForSeat(msg.targetSeat);
        if (!userId || userId.startsWith('guest:')) return 'illegal_target';
        const dur = msg.durationMs ?? 60 * 60 * 1000;
        await store.applySanction({
          userId,
          type: 'temp_ban',
          reason: msg.reason ?? 'in-game admin ban',
          reportId: null,
          issuedBy: identityId,
          expiresAt: now + dur,
        });
        room.markLeaving(userId);
        audit({ room: room.id, seat: msg.targetSeat, userId, durationMs: dur, reason: msg.reason });
        return null;
      }
      default:
        return 'bad_message';
    }
  }

  private async adminAdjustPoints(
    room: Room,
    seat: number,
    userId: string,
    amount: number,
    adminId: string,
    now: number,
  ): Promise<void> {
    if (amount !== 0) {
      await this.deps.store.addToUserStats(
        userId,
        { points: amount, gamesPlayed: 0, gamesWon: 0, gamesSurvived: 0, daysDeadWatched: 0 },
        now,
      );
      await this.deps.store.recordPoints(userId, [
        { matchId: null, reason: 'admin', detail: adminId, points: amount },
      ]);
    }
    await this.deps.store.logAdminAction(
      adminId,
      amount >= 0 ? 'admin_grant_points' : 'admin_revoke_points',
      { seat, userId, amount },
    );
    const summary = await buildUserStatsSummary(this.deps.store, userId);
    if (summary) {
      room.sendToSeat(seat, {
        v: 1,
        type: 'points_awarded',
        matchId: 'admin',
        breakdown: {
          awards: [
            {
              code: 'admin',
              label: amount >= 0 ? 'Admin granted points' : 'Admin revoked points',
              points: amount,
            },
          ],
          total: amount,
        },
        stats: summary,
        newAchievements: [],
      });
    }
  }

  // --- Host powers (§7.4) --------------------------------------------------

  setConfig(conn: Connection, config: LobbyConfig): string | null {
    const lobby = this.lobbyOf(conn);
    if (!lobby) return 'not_in_lobby';
    if (!lobby.isHost(conn.identityId as string)) return 'not_host';
    if (lobby.status !== 'waiting') return 'cannot_start';
    // §5: test mode hands the host a god-view (every seat's role via debug_*
    // frames + the audit endpoint). createLobby gates it behind testModeAllowed
    // (admin-only in a persistent/production store); this host-power path MUST
    // apply the SAME gate or a non-admin host could flip testMode:true on a
    // waiting lobby after creation and leak the live game. A non-allowed request
    // to enable it is forced false; an admin-set value is preserved across a
    // partial update that omits the field.
    const testMode =
      config.testMode === true
        ? this.testModeAllowed(conn)
        : (config.testMode ?? lobby.config.testMode);
    lobby.config = resolveConfig(lobby.visibility, { ...config, testMode });
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

  async startGame(conn: Connection): Promise<{ room: Room } | { error: string }> {
    if (this.draining) return { error: 'cannot_start' };
    const lobby = this.lobbyOf(conn);
    if (!lobby) return { error: 'not_in_lobby' };
    if (!lobby.isHost(conn.identityId as string)) return { error: 'not_host' };
    if (!lobby.canStart()) return { error: 'cannot_start' };
    // Refresh every player's UNLOCK-GATED role preferences so a mid-lobby edit is
    // reflected at deal-time (goal 3). Cache already seeded at join; this catches
    // changes. Failures leave the last-known cache (best-effort).
    await this.refreshLobbyPreferences(lobby);
    return this.formGame(lobby, {});
  }

  /**
   * System-triggered start for a matchmade quick-play table (no host "Deal"
   * click). The matchmaker calls this once a lobby is full (humans + bot
   * backfill). Same locked-roster → Room → init → role-delivery path as the
   * host-triggered {@link startGame}, but: it does NOT require a host, it sets
   * the match `mode='quickplay'` for persistence, and it re-checks `canStart()`
   * itself (the matchmaker only calls it when the lobby has filled).
   */
  startMatchmadeGame(lobby: Lobby, mode: QueueMode = 'casual'): { room: Room } | { error: string } {
    if (this.draining) return { error: 'cannot_start' };
    if (lobby.status !== 'waiting') return { error: 'cannot_start' };
    if (!this.lobbies.has(lobby.id)) return { error: 'lobby_not_found' };
    if (!lobby.canStart()) return { error: 'cannot_start' };
    // Ranked games are tagged 'ranked' + the current season; casual tables keep
    // the legacy 'quickplay' tag. A ranked game with no season cannot count.
    if (mode === 'ranked') {
      if (!this.currentSeasonId) return { error: 'cannot_start' };
      return this.formGame(lobby, { mode: RANKED_MODE, seasonId: this.currentSeasonId });
    }
    return this.formGame(lobby, { mode: 'quickplay' });
  }

  /**
   * Shared lock-roster → build Room → engine init → deliver roles core, reused
   * by host-triggered {@link startGame} and system-triggered
   * {@link startMatchmadeGame}. Preconditions (host/canStart) are validated by
   * the caller; this method assumes the lobby is startable.
   */
  private formGame(
    lobby: Lobby,
    opts: { mode?: string; seasonId?: string },
  ): { room: Room } | { error: string } {
    const players = lobby.playerConnections();
    const roster = players.map((c) => ({
      identityId: c.identityId as string,
      name: this.deps.nameOf(c.identityId as string),
      // UNLOCK-GATED role preferences (goal 3), cached on the connection at
      // join + pre-start refresh. Guests/bots/unentitled players carry null ⇒
      // no preferences ⇒ the engine's byte-identical no-preference assignment.
      ...(c.seatPreference ? { seatPreference: c.seatPreference } : {}),
    }));
    const setup = lobby.resolvedSetup;
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
    // Record the forming lobby's host so a later "play again" can attribute the
    // rematch (§7.7). The lingering room carries this through game-over.
    room.hostIdentityId = lobby.hostId;
    // Queue mode is persisted with the MatchRecord (§10); quickplay for
    // matchmade tables, undefined (casual) otherwise. Ranked tables also carry
    // the season id so MMR updates at game over are season-scoped.
    if (opts.mode) room.mode = opts.mode;
    if (opts.seasonId) room.seasonId = opts.seasonId;
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
    log.info('game started', { room: roomId, players: playerCount, mode: opts.mode ?? 'casual' });
    return { room };
  }

  // --- Quick-Play matchmaking (cold-start bot backfill) --------------------

  /**
   * Enter a matchmaking queue. The matchmaker forms a full table + auto-starts.
   *  - 'casual' (default): the classic quick-play queue; guests allowed.
   *  - 'ranked': requires a REGISTERED account (guests rejected with
   *    'not_authenticated' so the client prompts to sign in) and a persistent
   *    store with a current season; forms season-tagged ranked games. A recent
   *    leaver is rejected with 'cooldown' (the handler maps it to a
   *    `cannot_start`/`cooldown` error) until their re-queue cooldown expires.
   */
  quickPlay(conn: Connection, mode: QueueMode = 'casual'): string | null {
    if (this.draining) return 'cannot_start';
    if (!conn.identityId) return 'not_authenticated';
    // Already in a lobby/room? Matchmaking is a front-door action only.
    if (this.identityScope.has(conn.identityId)) return 'already_in_lobby';
    if (mode === 'ranked') {
      // Ranked requires a real account and an open season.
      if (conn.identity?.isGuest !== false) return 'not_authenticated';
      if (!this.deps.store.persistent || !this.currentSeasonId) return 'cannot_start';
      // Leaver cooldown: block (and lazily prune) a recent abandoner.
      const now = this.deps.clock?.() ?? Date.now();
      const until = this.rankedCooldownUntil.get(conn.identityId);
      if (until !== undefined) {
        if (until > now) return 'cooldown';
        this.rankedCooldownUntil.delete(conn.identityId);
      }
      // Warm the MMR cache for bucketing (best-effort; default until resolved).
      this.refreshMmrCache(conn.identityId);
      this.rankedMatchmaker.enqueue(conn);
      return null;
    }
    this.matchmaker.enqueue(conn);
    return null;
  }

  /** Leave whichever matchmaking queue the player is in before a match forms. */
  leaveQueue(conn: Connection): void {
    this.matchmaker.leave(conn);
    this.rankedMatchmaker.leave(conn);
  }

  // --- Play again / rematch (§7.7) -----------------------------------------

  /**
   * "Play again" from a finished game (§7.7). Keeps the crowd together: the
   * FIRST finished player to call this CREATES a fresh private lobby (becomes
   * host) seeded with the finished game's setup and stamps its id on the
   * lingering room; subsequent callers JOIN that same lobby so the group
   * reconvenes. The created lobby is a NORMAL game (testMode forced off — a
   * rematch never inherits a test/god room).
   *
   * Returns null on success (a `lobby_state` was broadcast to the caller by the
   * reused create/join path), or an error string:
   *  - 'no_game' when the caller is no longer scoped to a finished room (e.g.
   *    they already left). The client falls back to Quick Play.
   *
   * Mirrors the {@link quickPlay}/{@link startGame} return convention.
   */
  async playAgain(conn: Connection): Promise<string | null> {
    const identityId = conn.identityId;
    if (!identityId) return 'not_authenticated';
    const room = this.roomOf(conn);
    // Not in a (finished) room anymore → caller falls back to Quick Play.
    if (!room) return 'no_game';
    if (!room.isOver) return 'wrong_phase';

    // Detach this connection from the dead room scope exactly as the disconnect
    // path does, so the player is no longer scoped to the finished room and may
    // enter a lobby (createLobby/joinLobby both reject an already-scoped id).
    const seat = room.seatForIdentity(identityId);
    if (seat !== undefined) room.detach(identityId);
    else room.removeSpectator(identityId);
    this.identityScope.delete(identityId);
    conn.lobbyId = null;
    conn.spectator = false;

    // JOIN the existing rematch lobby if one was already created and still open.
    // (Host migration on that lobby already handles a departed original host.)
    if (room.rematchLobbyId && this.lobbies.has(room.rematchLobbyId)) {
      const res = this.joinLobby(conn, { lobbyId: room.rematchLobbyId });
      this.disposeRoomIfEmpty(room);
      if ('error' in res) return res.error;
      return null;
    }

    // Else CREATE a fresh private rematch lobby hosted by this connection, seeded
    // with the finished room's setup + config (testMode forced false). The create
    // path broadcasts `lobby_state` to the new host.
    const res = await this.createLobby(conn, {
      name: 'Rematch',
      visibility: 'private',
      setupId: room.setupId,
      config: { ...room.config, testMode: false },
    });
    if ('error' in res) {
      this.disposeRoomIfEmpty(room);
      return res.error;
    }
    room.rematchLobbyId = res.lobby.id;
    this.disposeRoomIfEmpty(room);
    return null;
  }

  /**
   * Dispose a finished room once no live connection remains attached to it, so
   * "play again" departures don't leak the lingering room (§7.7). Mirrors the
   * dispose used elsewhere (cancel timers via Room.dispose + drop from the map).
   */
  private disposeRoomIfEmpty(room: Room): void {
    if (room.hasAttachedConnections()) return;
    room.dispose();
    this.rooms.delete(room.id);
    this.deps.bots?.cleanup(room.id);
  }

  /** Refresh the MMR cache for an identity (async; best-effort for bucketing). */
  private refreshMmrCache(identityId: string): void {
    if (!this.currentSeasonId) return;
    void this.deps.store
      .getRating(identityId, RANKED_MODE, this.currentSeasonId)
      .then((row) => {
        if (row) this.setMmrCache(identityId, row.mmr);
      })
      .catch(() => {});
  }

  /**
   * Insert into the bounded MMR cache. When at capacity, evict the oldest entry
   * (Map preserves insertion order, so the first key is the oldest). Re-setting
   * an existing key keeps its original position — acceptable for a best-effort
   * bucketing cache and keeps eviction simple and deterministic.
   */
  private setMmrCache(identityId: string, mmr: number): void {
    if (!this.mmrCache.has(identityId) && this.mmrCache.size >= MMR_CACHE_CAP) {
      const oldest = this.mmrCache.keys().next().value;
      if (oldest !== undefined) this.mmrCache.delete(oldest);
    }
    this.mmrCache.set(identityId, mmr);
  }

  /**
   * Build the host surface the {@link Matchmaker} drives. Bundles the lobby
   * create/join/start/bot operations against `this`, plus the clock/schedule
   * seam so the fill window + bot-join polling are deterministic in tests.
   */
  private makeMatchmakerHost(): MatchmakerHost {
    return {
      isDraining: () => this.draining,
      createMatchmakingLobby: (conn, setupId) =>
        this.createLobby(conn, {
          name: 'Quick Play',
          visibility: 'private',
          setupId,
        }),
      joinMatchmadeLobby: (conn, lobbyId) => this.joinLobby(conn, { lobbyId }),
      addBots: async (lobbyId, inviteCode, count, policy) => {
        const bots = this.deps.bots;
        if (!bots) return 0;
        return bots.addBots(lobbyId, inviteCode, count, policy);
      },
      lobbyPlayerCount: (lobbyId) => this.lobbies.get(lobbyId)?.playerCount ?? 0,
      lobbyIsWaiting: (lobbyId) => this.lobbies.get(lobbyId)?.status === 'waiting',
      startMatchmadeGame: (lobbyId, mode) => {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return { error: 'lobby_not_found' };
        const res = this.startMatchmadeGame(lobby, mode);
        return 'error' in res ? { error: res.error } : { ok: true };
      },
      disposeMatchmakingLobby: (lobbyId) => {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;
        // Tell any seated humans the table fell through (they navigated on the
        // 'matched' frame); a `cannot_start` error surfaces as a client toast.
        lobby.broadcast({
          v: 1,
          type: 'error',
          code: 'cannot_start',
          detail: 'could not seat a full table',
        } as never);
        // Clear identityScope for members so they can re-queue / re-join.
        for (const c of lobby.allConnections()) {
          const id = c.identityId;
          if (id) {
            this.identityScope.delete(id);
            c.lobbyId = null;
          }
        }
        this.disposeLobby(lobby);
      },
      llmAvailable: this.deps.llmAvailable === true,
      ratingFor: (identityId) => this.mmrCache.get(identityId) ?? DEFAULT_RATING,
    };
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
        // Queue mode (§10): 'quickplay' for matchmade tables, 'ranked' for
        // ranked games (with the season id), omitted otherwise.
        ...(room.mode ? { mode: room.mode } : {}),
        ...(room.seasonId ? { seasonId: room.seasonId } : {}),
        players: rec.players,
        events,
        chat,
      });
      // RANKED (ranked play): update MMR for each HUMAN player BEFORE points, so
      // the per-player MMR delta + new ranked standing ride along on the
      // `points_awarded` frame. Guests/bots get no rating (filtered inside).
      // TEST-mode games never count.
      let rankedDeltas: Map<string, number> | undefined;
      let rankedSeasonId: string | undefined;
      if (!room.isTestMode && room.mode === RANKED_MODE && room.seasonId) {
        const award = await awardRankedRatings({
          store: this.deps.store,
          matchId,
          players: rec.players,
          seasonId: room.seasonId,
          now: this.deps.clock?.() ?? Date.now(),
        });
        rankedDeltas = award.deltas;
        rankedSeasonId = room.seasonId;
        // Keep the bucketing cache fresh for the next queue.
        for (const [userId] of rankedDeltas) {
          this.refreshMmrCache(userId);
        }
        // Leaver / queue-dodge: a short re-queue cooldown for anyone who
        // abandoned the match (checked in quickPlay('ranked')).
        for (const userId of award.leavers) {
          this.rankedCooldownUntil.set(
            userId,
            (this.deps.clock?.() ?? Date.now()) + LEAVER_COOLDOWN_MS,
          );
        }
      }
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
          ...(rankedDeltas ? { rankedDeltas } : {}),
          ...(rankedSeasonId ? { rankedSeasonId } : {}),
        });
      }
    } catch (err) {
      log.error('failed to persist match', { err: String(err) });
    }
    // Roster flows back into a fresh lobby (§7.7 play again). The room is NOT
    // disposed here: it lingers so its `rematchLobbyId` persists for the group.
    // The FIRST finished player to send `play_again` creates a fresh private
    // lobby (see {@link playAgain}); others join it. The room is disposed once
    // the last connection detaches via `play_again` (disposeRoomIfEmpty).
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
      out.push({
        id: lobby.id,
        name: lobby.name,
        players: lobby.playerCount,
        capacity: lobby.resolvedSetup.maxPlayers,
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
    // A queued (not-yet-seated) matchmaking player: drop them from either queue.
    this.matchmaker.onDisconnect(identityId);
    this.rankedMatchmaker.onDisconnect(identityId);
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
    // Cancel both matchmaking queues: no new tables form while draining.
    this.matchmaker.dispose();
    this.rankedMatchmaker.dispose();
    // Reject new lobbies; let running games finish. Dispose empty lobbies.
    for (const lobby of [...this.lobbies.values()]) {
      if (lobby.status === 'waiting') {
        lobby.broadcast({
          v: 1,
          type: 'error',
          code: 'cannot_start',
          detail: 'server draining',
        } as never);
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
    this.matchmaker.dispose();
    this.rankedMatchmaker.dispose();
    this.deps.bots?.disposeAll();
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
    this.lobbies.clear();
  }
}

/** Max entries kept in the best-effort MMR bucketing cache (Task E). */
const MMR_CACHE_CAP = 10_000;

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
