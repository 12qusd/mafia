/**
 * Outbound command helpers (BUILD_SPEC §9.1). Each function constructs a
 * shared-typed client message and sends it through the validated connection.
 * Screens call these; they never build envelopes by hand.
 */

import {
  PROTOCOL_VERSION,
  type LobbyConfig,
  type LobbyVisibility,
  type ChatChannel,
  type VerdictValue,
  type ReportCategory,
  type TestBotPolicy,
} from '@nocturne/shared';
import { conn } from './connection.js';

const V = PROTOCOL_VERSION;

export function createLobby(
  name: string,
  visibility: LobbyVisibility,
  setupId: string,
  config?: LobbyConfig,
): void {
  conn.send({ v: V, type: 'create_lobby', name, visibility, setupId, ...(config ? { config } : {}) });
}

export function joinLobby(opts: { lobbyId?: string; inviteCode?: string; asSpectator?: boolean }): void {
  conn.send({
    v: V,
    type: 'join_lobby',
    ...(opts.lobbyId ? { lobbyId: opts.lobbyId } : {}),
    ...(opts.inviteCode ? { inviteCode: opts.inviteCode } : {}),
    ...(opts.asSpectator ? { asSpectator: true } : {}),
  });
}

export function leaveLobby(): void {
  conn.send({ v: V, type: 'leave_lobby' });
}

export function setLobbyConfig(config: LobbyConfig): void {
  conn.send({ v: V, type: 'lobby_config', config });
}

export function kick(seatOrUserId: number | string): void {
  conn.send({ v: V, type: 'kick', seatOrUserId });
}

export function startGame(): void {
  conn.send({ v: V, type: 'start_game' });
}

export function sendChat(channel: ChatChannel, text: string): void {
  conn.send({ v: V, type: 'chat', channel, text });
}

export function sendWhisper(toSeat: number, text: string): void {
  conn.send({ v: V, type: 'whisper', toSeat, text });
}

export function sendVote(target: number | 'skip' | null): void {
  conn.send({ v: V, type: 'vote', target });
}

export function sendVerdict(value: VerdictValue): void {
  conn.send({ v: V, type: 'verdict', value });
}

export function sendNightAction(ability: string, target: number | null): void {
  conn.send({ v: V, type: 'night_action', ability, target });
}

export function sendDayAbility(ability: string, target?: number): void {
  conn.send({ v: V, type: 'day_ability', ability, ...(target !== undefined ? { target } : {}) });
}

export function sendLastWill(text: string): void {
  conn.send({ v: V, type: 'last_will', text });
}

export function sendDeathNote(text: string): void {
  conn.send({ v: V, type: 'death_note', text });
}

export function reportPlayer(seat: number, category: ReportCategory, comment?: string): void {
  conn.send({ v: V, type: 'report_player', seat, category, ...(comment ? { comment } : {}) });
}

// ---------------------------------------------------------------------------
// TEST MODE host controls (`test_control`, host of a gated test lobby only).
// The server rejects these for non-hosts/non-test lobbies with an `error`
// frame (not_host / forbidden / wrong_phase / not_in_game), surfaced as a toast
// by the normal error path. See `packages/shared/src/protocol/debug.ts`.
// ---------------------------------------------------------------------------

/** Skip the current phase's timer (schedule its phase_end immediately). */
export function testEndPhase(): void {
  conn.send({ v: V, type: 'test_control', action: 'end_phase' });
}

/** Ask the server to resend the full `debug_state` snapshot. */
export function testRequestState(): void {
  conn.send({ v: V, type: 'test_control', action: 'request_state' });
}

/** Pre-game: backfill `count` bot seats with the given policy. */
export function testAddBots(count: number, policy: TestBotPolicy): void {
  conn.send({ v: V, type: 'test_control', action: 'add_bot', count, policy });
}

/** Pre-game: drop one backfill bot by seat, or all of them. */
export function testRemoveBot(seatOrAll: number | 'all'): void {
  conn.send({ v: V, type: 'test_control', action: 'remove_bot', seatOrAll });
}
