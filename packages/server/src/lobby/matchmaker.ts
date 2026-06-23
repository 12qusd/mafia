/**
 * Quick-Play matchmaking with bot backfill (cold-start linchpin).
 *
 * A player clicks "Quick Play" and ALWAYS gets a full game within seconds. Real
 * players who are also queuing join the same table; the rest of the seats are
 * filled by AI bots. This makes the game playable with zero population.
 *
 * Flow:
 *  - A connection enters the queue via {@link enqueue} (the `quick_play` handler).
 *    It immediately gets a `queue_status {state:'searching'}` with its position.
 *  - The FIRST player to enter an empty queue arms a short FILL WINDOW
 *    ({@link FILL_WINDOW_MS}) so other humans can join the same table. The window
 *    is scheduled on the injected clock/schedule seam (deterministic in tests).
 *  - When the window expires — or the queue reaches the table cap
 *    ({@link TABLE_CAP}) — the matchmaker FORMS a game: it creates a PRIVATE
 *    matchmaking lobby (guests allowed, NOT shown in the public browser),
 *    moves all queued humans into it, BACKFILLS the remaining seats up to
 *    {@link TARGET_SEATS} (at least MIN_PLAYERS) with BOTS via
 *    `BotManager.addBots`, and AUTO-STARTS the game (system-triggered — no host
 *    "Deal" click).
 *  - A solo queuer therefore gets a 1-human + (MIN_PLAYERS−1)-bot table.
 *
 * Determinism / leak invariant: the matchmaking lobby/room runs the NORMAL
 * Room/transport, and bots are ordinary guest WS clients, so BUILD_SPEC §5 is
 * enforced exactly as for any other game. Nothing here bypasses the transport.
 *
 * Bot policy: backfill defaults to SCRIPTED bots (legal, deterministic moves) so
 * a match is never blocked on LLM availability. A small number of LLM bots are
 * used only when an LLM is configured, and `BotManager.addBots` already falls
 * back to scripted if the LLM is unreachable — so LLM trouble never blocks a
 * match.
 */

import { MIN_PLAYERS, type TestBotPolicy } from '@nocturne/shared';
import type { Connection } from '../ws/connection.js';
import type { Lobby } from './lobby.js';
import { log } from '../log.js';

/** The setup matchmade tables play (auto-scaling classic, 7–15). */
export const QUICKPLAY_SETUP_ID = 'classic-nocturne';

/**
 * Fill window: how long the FIRST queuer waits for other humans before the table
 * forms (ms). Tunable; a few-second wait keeps "within seconds" while giving
 * concurrent humans a chance to share a table.
 */
export const FILL_WINDOW_MS = 12_000;

/** Maximum humans on one matchmade table — forms immediately when reached. */
export const TABLE_CAP = 15;

/**
 * Target seat count to fill to (humans + bots). MIN_PLAYERS guarantees a legal
 * start; a slightly higher target makes a more interesting game. Clamped to at
 * least the current human count and at most TABLE_CAP.
 */
export const TARGET_SEATS = Math.max(MIN_PLAYERS, 7);

/**
 * How many of the backfill bots should be LLM-driven (when an LLM is
 * configured). The rest are scripted. Kept small so a match never waits on the
 * LLM; addBots also falls back to scripted if the LLM is unavailable.
 */
export const MAX_LLM_BACKFILL = 2;

/** Poll interval while waiting for bots to finish joining over loopback WS (ms). */
const BOT_JOIN_POLL_MS = 250;
/** Hard cap on how long to wait for bots to join before starting anyway (ms). */
const BOT_JOIN_TIMEOUT_MS = 8_000;

/**
 * Tunable timings (production defaults above). Tests inject tiny values so the
 * fill window + bot-join poll complete in milliseconds. These run on REAL timers
 * (not the room's clock seam): bots connect over real loopback WS in real time,
 * so the matchmaker must wait real time for them — independent of any FakeClock
 * driving the room's phase deadlines.
 */
export interface MatchmakerTimings {
  fillWindowMs: number;
  botJoinPollMs: number;
  botJoinTimeoutMs: number;
}

export const DEFAULT_TIMINGS: MatchmakerTimings = {
  fillWindowMs: FILL_WINDOW_MS,
  botJoinPollMs: BOT_JOIN_POLL_MS,
  botJoinTimeoutMs: BOT_JOIN_TIMEOUT_MS,
};

/** Minimal surface the matchmaker needs from the LobbyManager. */
export interface MatchmakerHost {
  /** Whether the server is draining (no new tables form). Read live. */
  isDraining(): boolean;
  /** Create a forced-private, non-test matchmaking lobby hosted by `conn`. */
  createMatchmakingLobby(
    conn: Connection,
    setupId: string,
  ): Promise<{ lobby: Lobby } | { error: string }>;
  /** Move `conn` into an existing matchmaking lobby. */
  joinMatchmadeLobby(conn: Connection, lobbyId: string): { lobby: Lobby } | { error: string };
  /** Backfill `count` bots into a lobby via its invite code (best-effort). */
  addBots(
    lobbyId: string,
    inviteCode: string,
    count: number,
    policy: TestBotPolicy,
  ): Promise<number>;
  /** Current PLAYER count (humans + joined bots) of a lobby. */
  lobbyPlayerCount(lobbyId: string): number;
  /** Whether the lobby still exists and is waiting. */
  lobbyIsWaiting(lobbyId: string): boolean;
  /** System-triggered start of a filled matchmaking lobby (no host click). */
  startMatchmadeGame(lobbyId: string): { ok: true } | { error: string };
  /** Tear down a matchmaking lobby that failed to form (drops bots too). */
  disposeMatchmakingLobby(lobbyId: string): void;
  /** Whether LLM bots are available (LLM_BASE_URL configured). */
  llmAvailable: boolean;
}

interface QueueEntry {
  conn: Connection;
  identityId: string;
}

export class Matchmaker {
  private readonly queue: QueueEntry[] = [];
  private fillTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guard against re-entrant form attempts. */
  private forming = false;
  private readonly timings: MatchmakerTimings;

  constructor(
    private readonly host: MatchmakerHost,
    timings?: Partial<MatchmakerTimings>,
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  /** Arm the fill window on real timers; broadcasts status with the eta. */
  private armWindow(): void {
    if (this.fillTimer) return;
    const eta = Date.now() + this.timings.fillWindowMs;
    const t = setTimeout(() => {
      this.fillTimer = null;
      void this.formTable();
    }, this.timings.fillWindowMs);
    if (t.unref) t.unref();
    this.fillTimer = t;
    this.broadcastStatus(eta);
  }

  /** Number of players currently queued (telemetry / tests). */
  get queued(): number {
    return this.queue.length;
  }

  /**
   * Enter the quick-play queue. Idempotent for an identity (a second enqueue just
   * refreshes the connection). Arms the fill window on the first entrant; forms
   * immediately if the cap is reached.
   */
  enqueue(conn: Connection): void {
    const identityId = conn.identityId;
    if (!identityId) return;
    if (this.host.isDraining()) {
      this.sendCancelled(conn);
      return;
    }
    const existing = this.queue.find((e) => e.identityId === identityId);
    if (existing) {
      existing.conn = conn; // reconnect / duplicate: keep newest socket.
    } else {
      this.queue.push({ conn, identityId });
    }

    if (this.queue.length >= TABLE_CAP) {
      void this.formTable();
      return;
    }
    if (!this.fillTimer) {
      this.armWindow();
    } else {
      this.broadcastStatus(undefined);
    }
  }

  /** Leave the queue before a match forms. */
  leave(conn: Connection): void {
    const identityId = conn.identityId;
    if (!identityId) return;
    const idx = this.queue.findIndex((e) => e.identityId === identityId);
    if (idx < 0) return;
    const [entry] = this.queue.splice(idx, 1);
    if (entry) this.sendCancelled(entry.conn);
    if (this.queue.length === 0) this.cancelWindow();
    else this.broadcastStatus(undefined);
  }

  /** A queued connection disconnected: drop it from the queue (no notify). */
  onDisconnect(identityId: string): void {
    const idx = this.queue.findIndex((e) => e.identityId === identityId);
    if (idx < 0) return;
    this.queue.splice(idx, 1);
    if (this.queue.length === 0) this.cancelWindow();
    else this.broadcastStatus(undefined);
  }

  /** Drain: cancel the window and clear the queue (server shutdown). */
  dispose(): void {
    this.cancelWindow();
    for (const e of this.queue) this.sendCancelled(e.conn);
    this.queue.length = 0;
  }

  // --- internals -----------------------------------------------------------

  private cancelWindow(): void {
    if (this.fillTimer) {
      clearTimeout(this.fillTimer);
      this.fillTimer = null;
    }
  }

  /** Send each queued player their current position + queue size. */
  private broadcastStatus(eta: number | undefined): void {
    const queued = this.queue.length;
    this.queue.forEach((e, i) => {
      e.conn.send({
        v: 1,
        type: 'queue_status',
        state: 'searching',
        position: i + 1,
        queued,
        ...(eta !== undefined ? { eta } : {}),
      } as never);
    });
  }

  private sendCancelled(conn: Connection): void {
    conn.send({ v: 1, type: 'queue_status', state: 'cancelled' } as never);
  }

  /**
   * Form a table from the current queue: create a private lobby, move humans in,
   * backfill bots, and auto-start. Best-effort and re-entrancy-guarded; on any
   * failure the queued players are cancelled so the client leaves the overlay.
   */
  private async formTable(): Promise<void> {
    if (this.forming) return;
    this.cancelWindow();
    const entrants = this.queue.splice(0, TABLE_CAP);
    if (entrants.length === 0) return;
    if (this.host.isDraining()) {
      for (const e of entrants) this.sendCancelled(e.conn);
      return;
    }
    this.forming = true;
    try {
      await this.formTableInner(entrants);
    } catch (err) {
      log.error('matchmaker form failed', { err: String(err) });
      for (const e of entrants) this.sendCancelled(e.conn);
    } finally {
      this.forming = false;
    }
    // Any players who queued WHILE we were forming start a fresh window.
    if (this.queue.length > 0 && !this.fillTimer && !this.host.isDraining()) {
      this.armWindow();
    }
  }

  private async formTableInner(entrants: QueueEntry[]): Promise<void> {
    const [host, ...rest] = entrants;
    if (!host) return;

    const created = await this.host.createMatchmakingLobby(host.conn, QUICKPLAY_SETUP_ID);
    if ('error' in created) {
      for (const e of entrants) this.sendCancelled(e.conn);
      return;
    }
    const lobby = created.lobby;
    const lobbyId = lobby.id;
    const inviteCode = lobby.inviteCode;
    if (!inviteCode) {
      this.host.disposeMatchmakingLobby(lobbyId);
      for (const e of entrants) this.sendCancelled(e.conn);
      return;
    }

    // Move the remaining humans into the same lobby.
    for (const e of rest) {
      const res = this.host.joinMatchmadeLobby(e.conn, lobbyId);
      if ('error' in res) {
        // Could not seat this human (rare); cancel just them, keep the table.
        this.sendCancelled(e.conn);
      }
    }

    const humans = this.host.lobbyPlayerCount(lobbyId);
    const target = Math.min(Math.max(humans, TARGET_SEATS), TABLE_CAP);
    const botsNeeded = Math.max(0, target - humans);

    // Tell the seated humans a table formed (client navigates; game frames
    // follow). Do this NOW so they leave the searching overlay promptly even
    // while bots are still connecting.
    for (const e of entrants) {
      e.conn.send({
        v: 1,
        type: 'queue_status',
        state: 'matched',
        lobbyId,
      } as never);
    }

    if (botsNeeded > 0) {
      // Default to scripted; sprinkle a few LLM bots only when available.
      const llm = this.host.llmAvailable ? Math.min(MAX_LLM_BACKFILL, botsNeeded) : 0;
      const scripted = botsNeeded - llm;
      if (scripted > 0) await this.host.addBots(lobbyId, inviteCode, scripted, 'scripted');
      if (llm > 0) await this.host.addBots(lobbyId, inviteCode, llm, 'llm');
    }

    // Wait for the bots to finish joining over loopback WS, then auto-start.
    await this.waitForFillAndStart(lobbyId, target);
  }

  /**
   * Poll until the lobby reaches `target` players (humans + joined bots) or a
   * timeout, then system-start it. Bots join asynchronously over real WS, so we
   * cannot start synchronously after addBots. Uses the clock/schedule seam so a
   * test driving a fake clock advances the polls deterministically.
   */
  private waitForFillAndStart(lobbyId: string, target: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const deadline = Date.now() + this.timings.botJoinTimeoutMs;
      const attempt = (): void => {
        if (!this.host.lobbyIsWaiting(lobbyId)) {
          resolve();
          return;
        }
        const count = this.host.lobbyPlayerCount(lobbyId);
        const full = count >= target;
        const expired = Date.now() >= deadline;
        if ((full || expired) && count >= MIN_PLAYERS) {
          const res = this.host.startMatchmadeGame(lobbyId);
          if ('error' in res) {
            // Could not start (e.g. not enough players joined): tear down so we
            // never strand a half-formed lobby.
            log.warn('matchmade start failed; disposing', { lobbyId, error: res.error, count });
            this.host.disposeMatchmakingLobby(lobbyId);
          } else {
            log.info('matchmade table started', { lobbyId, players: count });
          }
          resolve();
          return;
        }
        if (expired && count < MIN_PLAYERS) {
          // Bots never arrived (e.g. no BotManager / loopback unavailable). Don't
          // strand the table: tear it down so queued humans get 'cancelled'.
          log.warn('matchmade table never filled; disposing', { lobbyId, count });
          this.host.disposeMatchmakingLobby(lobbyId);
          resolve();
          return;
        }
        const t = setTimeout(attempt, this.timings.botJoinPollMs);
        if (t.unref) t.unref();
      };
      attempt();
    });
  }
}
