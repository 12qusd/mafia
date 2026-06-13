/**
 * A pre-game lobby (BUILD_SPEC §7).
 *
 * Holds the roster (players + spectators), host, setup choice, and resolved
 * config. Emits `lobby_state` (public data only, §5/§7.3) on every change. Host
 * powers (kick pre-game, transfer, start) and host migration on disconnect
 * (longest-seated, §7.4) live here. When the host starts, the LobbyManager
 * converts the lobby into a Room.
 */

import {
  DEFAULT_LOBBY_CONFIG,
  SPECTATOR_CAP,
  MIN_PLAYERS,
  MAX_PLAYERS,
  getSetup,
  type Lobby as LobbyDTO,
  type LobbyConfig,
  type LobbyVisibility,
  type ResolvedLobbyConfig,
  type ServerMessage,
  type SeatId,
} from '@nocturne/shared';
import type { Connection } from '../ws/connection.js';
import { ScopedTransport, type AudienceProvider, type Sendable } from '../transport.js';

export interface LobbyMemberState {
  conn: Connection;
  joinedAt: number;
  spectator: boolean;
}

export function resolveConfig(
  visibility: LobbyVisibility,
  overrides: LobbyConfig | undefined,
): ResolvedLobbyConfig {
  const base: ResolvedLobbyConfig = {
    ...DEFAULT_LOBBY_CONFIG,
    timings: { ...DEFAULT_LOBBY_CONFIG.timings },
    // Public lobbies default deadSeeAll=false (§5).
    deadSeeAll: visibility === 'private',
  };
  if (!overrides) return base;
  if (overrides.timings) base.timings = { ...base.timings, ...overrides.timings };
  if (overrides.whispersEnabled !== undefined) base.whispersEnabled = overrides.whispersEnabled;
  if (overrides.deadSeeAll !== undefined) base.deadSeeAll = overrides.deadSeeAll;
  if (overrides.lastWillsEnabled !== undefined) base.lastWillsEnabled = overrides.lastWillsEnabled;
  if (overrides.firstPhase !== undefined) base.firstPhase = overrides.firstPhase;
  if (overrides.testMode !== undefined) base.testMode = overrides.testMode;
  return base;
}

export class Lobby implements AudienceProvider {
  status: 'waiting' | 'in_game' | 'finished' = 'waiting';
  readonly transport = new ScopedTransport(this);
  readonly createdAt = Date.now();
  /** Members keyed by identity id (§8: bound to identity, not socket). */
  private readonly members = new Map<string, LobbyMemberState>();
  hostId: string;

  constructor(
    readonly id: string,
    public name: string,
    readonly visibility: LobbyVisibility,
    readonly setupId: string,
    public config: ResolvedLobbyConfig,
    readonly inviteCode: string | null,
    hostConn: Connection,
  ) {
    this.hostId = hostConn.identityId as string;
    this.members.set(this.hostId, { conn: hostConn, joinedAt: this.createdAt, spectator: false });
  }

  // --- AudienceProvider (lobby chat scope) ---------------------------------

  publicSockets(): Iterable<Sendable> {
    const out: Sendable[] = [];
    for (const m of this.members.values()) out.push(m.conn.socket);
    return out;
  }
  socketsForSeats(_seats: Iterable<SeatId>): Iterable<Sendable> {
    // Lobbies have no seats; addressing-by-seat is a no-op pre-game.
    return [];
  }
  mafiaSeats(): SeatId[] {
    return [];
  }
  deadSeats(): SeatId[] {
    return [];
  }

  // --- Membership ----------------------------------------------------------

  get playerCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (!m.spectator) n++;
    return n;
  }
  get spectatorCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.spectator) n++;
    return n;
  }
  has(identityId: string): boolean {
    return this.members.has(identityId);
  }
  getMember(identityId: string): LobbyMemberState | undefined {
    return this.members.get(identityId);
  }
  allConnections(): Connection[] {
    return [...this.members.values()].map((m) => m.conn);
  }
  playerConnections(): Connection[] {
    return [...this.members.values()].filter((m) => !m.spectator).map((m) => m.conn);
  }

  /** Add a member. Returns an error code or null on success. */
  join(conn: Connection, asSpectator: boolean): string | null {
    const id = conn.identityId as string;
    if (this.members.has(id)) {
      // Reconnect / duplicate: swap the socket onto the existing membership.
      const m = this.members.get(id) as LobbyMemberState;
      m.conn = conn;
      return null;
    }
    if (this.status !== 'waiting' && !asSpectator) return 'cannot_start';
    if (asSpectator) {
      if (this.spectatorCount >= SPECTATOR_CAP) return 'lobby_full';
    } else {
      const setup = getSetup(this.setupId);
      const cap = setup ? Math.min(setup.maxPlayers, MAX_PLAYERS) : MAX_PLAYERS;
      if (this.playerCount >= cap) return 'lobby_full';
    }
    this.members.set(id, { conn, joinedAt: Date.now(), spectator: asSpectator });
    return null;
  }

  /** Remove a member; returns true if the lobby is now empty. */
  leave(identityId: string): boolean {
    this.members.delete(identityId);
    if (identityId === this.hostId) this.migrateHost();
    return this.members.size === 0;
  }

  /** Host migration to longest-seated player (§7.4). */
  migrateHost(): void {
    let best: { id: string; joinedAt: number } | null = null;
    for (const [id, m] of this.members) {
      if (m.spectator) continue;
      if (!best || m.joinedAt < best.joinedAt) best = { id, joinedAt: m.joinedAt };
    }
    if (best) this.hostId = best.id;
    else {
      // Only spectators remain; pick any.
      const first = [...this.members.keys()][0];
      if (first) this.hostId = first;
    }
  }

  /** Kick a member (host, pre-game only) (§7.4). */
  kick(targetIdentityId: string): string | null {
    if (this.status !== 'waiting') return 'cannot_start';
    if (targetIdentityId === this.hostId) return 'forbidden';
    if (!this.members.has(targetIdentityId)) return 'not_in_lobby';
    this.members.delete(targetIdentityId);
    return null;
  }

  isHost(identityId: string): boolean {
    return this.hostId === identityId;
  }

  /** Whether start preconditions are met (§7.4). */
  canStart(): boolean {
    const setup = getSetup(this.setupId);
    if (!setup) return false;
    const n = this.playerCount;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) return false;
    if (n < setup.minPlayers || n > setup.maxPlayers) return false;
    return setup.slotsByPlayerCount[String(n)] !== undefined;
  }

  // --- DTO & broadcast -----------------------------------------------------

  toDTO(name: (id: string) => string): LobbyDTO {
    return {
      id: this.id,
      name: this.name,
      visibility: this.visibility,
      setupId: this.setupId,
      config: this.config,
      hostUserOrGuestId: this.hostId,
      members: [...this.members.entries()].map(([id, m]) => ({
        userOrGuestId: id,
        name: name(id),
        isHost: id === this.hostId,
        isSpectator: m.spectator,
        connected: true,
      })),
      spectatorCount: this.spectatorCount,
      status: this.status,
      ...(this.config.testMode ? { testMode: true } : {}),
    };
  }

  broadcast(msg: ServerMessage): void {
    this.transport.broadcastPublic(msg);
  }
}
