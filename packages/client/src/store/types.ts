/**
 * Client store state shapes (BUILD_SPEC §13). The store holds ONLY what the
 * server has sent (§13.2): it never infers or fabricates secret state. Every
 * incoming frame is zod-validated in the WS layer before it reaches a reducer.
 */

import type {
  Lobby,
  PublicSeat,
  Phase,
  RoleId,
  Faction,
  AbilityInfo,
  ChatChannel,
  ChatRecord,
  TallyEntry,
  PrivateResultPayload,
  DeathAnnounce,
  VerdictResult,
  WinningParty,
  SeatOutcome,
  VerdictValue,
  ErrorCode,
  DebugState,
  DebugTrace,
  DebugEvent,
  PointsBreakdown,
  UserStatsSummary,
} from '@nocturne/shared';
import type { ClockEstimate } from '../lib/clock.js';

/**
 * The signed-in account (or guest) as reported by `GET /api/me` (goal 4/8).
 * Held in the store so the profile card, leaderboard link, and admin gate can
 * read it. Server-sourced only — the client never fabricates `isAdmin`/`stats`.
 */
export interface MeState {
  id: string;
  name: string;
  isGuest: boolean;
  isAdmin: boolean;
  stats: UserStatsSummary | null;
}

/**
 * The most recent `points_awarded` frame for the *current* match (goal 3).
 * Surfaced in the GameOver celebration. Cleared when a new game starts.
 */
export interface PointsAwardState {
  matchId: string;
  breakdown: PointsBreakdown;
  stats: UserStatsSummary;
  newAchievements: string[];
}

/** Connection lifecycle (BUILD_SPEC §8 reconnection). */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'force_update';

/** A chat line as held for rendering (sanitization happens at render time). */
export interface ChatLine {
  /** Monotonic client id for React keys (server ts can collide). */
  id: number;
  channel: ChatChannel;
  from: number | 'Jailor';
  text: string;
  ts: number;
}

/** A public whisper-meta event, rendered inline in the day channel. */
export interface WhisperMetaLine {
  id: number;
  fromSeat: number;
  toSeat: number;
  ts: number;
}

/** A received private night-result (BUILD_SPEC §9.2). */
export interface PrivateResultLine {
  id: number;
  payload: PrivateResultPayload;
  /** Day the result arrived (for grouping in the log). */
  dayNumber: number;
}

/** A pending dawn death announcement (paced feed, §13.1). */
export type DeathFeedItem = DeathAnnounce;

/** Per-seat outcome row from game_over. */
export interface RoleRevealRow {
  seat: number;
  role: RoleId;
  faction: Faction;
  outcome: SeatOutcome;
}

/** Final game-over payload. */
export interface GameOverState {
  winners: WinningParty[];
  allRoles: RoleRevealRow[];
  seed: string;
  matchId: string;
}

/** Own seat's secret knowledge (delivered only to this seat, §5). */
export interface OwnState {
  seat: number;
  role: RoleId;
  faction: Faction;
  abilities: AbilityInfo[];
  /** Mafia roster (mafia seats only). */
  mates?: number[];
  /** Currently submitted night-action target (null = none/cancelled). */
  nightTarget: number | null;
  /**
   * Optional SECOND night-action target (local pending UI state, §13.2). Used
   * only by the Witch's `witch_control`: `nightTarget` is the PUPPET and
   * `nightTarget2` is the VICTIM the puppet's action is steered onto. Null for
   * every single-target ability.
   */
  nightTarget2: number | null;
  /** The ability id selected for the night action, if any. */
  nightAbility: string | null;
  /** Jailor's selected prisoner for the coming night. */
  jailTarget: number | null;
  /** Whether the Mayor has revealed. */
  revealed: boolean;
  lastWill: string;
  deathNote: string;
  /** This seat's current vote target in DAY_VOTING. */
  vote: number | 'skip' | null;
  /** This seat's submitted trial verdict, if any. */
  verdict: VerdictValue | null;
}

/** The whole game view (present once `game_started` arrives). */
export interface GameView {
  setupId: string;
  seats: PublicSeat[];
  phase: Phase;
  dayNumber: number;
  /** Server epoch ms deadline for the current phase (null = no deadline). */
  endsAt: number | null;
  /** Live vote tallies during DAY_VOTING. */
  tallies: TallyEntry[];
  /** voter seat → their target. */
  votesBySeat: { seat: number; target: number | 'skip' }[];
  /** Seat currently on trial, if any. */
  accusedSeat: number | null;
  /** Most recent revealed verdict (TRIAL_JUDGMENT result). */
  lastVerdict: VerdictResult | null;
  /** Queue of dawn deaths not yet dismissed by the player. */
  deathFeed: DeathFeedItem[];
  /** Whether this client is a spectator (read-only). */
  spectator: boolean;
  /**
   * Seats an admin has turned into non-voting "stumps" (goal 8, public via
   * `seat_transform`). A parallel set keyed by seat so we never mutate the
   * server-sent `PublicSeat` shape with client-fabricated fields.
   */
  stumpedSeats: number[];
}

/** A toast/error surfaced to the user. */
export interface Toast {
  id: number;
  code: ErrorCode | 'info';
  detail?: string;
}

/**
 * TEST-MODE god-view state (`packages/shared/src/protocol/debug.ts`). Present
 * ONLY for the host of a gated test lobby (the god audience); a normal client
 * never receives `debug_*` frames, so `debug` stays at its empty initial shape
 * and the Director panel never renders (§visibility gate).
 */
export interface DebugView {
  /** Latest full god-view snapshot, or null until the first `debug_state`. */
  state: DebugState | null;
  /** Per-night resolution traces; newest appended last (rendered newest-first). */
  traces: DebugTrace[];
  /** Action-log mirror, ring-buffered to the most recent events. */
  events: DebugEvent[];
}

/** Max retained `debug_event` rows (ring buffer, §debug_event mirror). */
export const DEBUG_EVENT_CAP = 500;

/** The complete client store state. */
export interface StoreState {
  // --- Connection ---------------------------------------------------------
  connection: ConnectionStatus;
  clock: ClockEstimate;
  /** Minimum protocol version demanded by a force_update, if any. */
  forceUpdateMin: number | null;
  userId: string | null;
  guestId: string | null;
  /** Signed-in account/guest from `GET /api/me` (goal 4/8). Null until fetched. */
  me: MeState | null;

  // --- Lobby --------------------------------------------------------------
  lobby: Lobby | null;

  // --- Game ---------------------------------------------------------------
  game: GameView | null;
  own: OwnState | null;
  gameOver: GameOverState | null;
  /** Last `points_awarded` for the current match (goal 3); null until it arrives. */
  pointsAward: PointsAwardState | null;

  // --- Chat & logs --------------------------------------------------------
  chat: ChatLine[];
  whisperMeta: WhisperMetaLine[];
  privateLog: PrivateResultLine[];

  // --- Ephemeral UI -------------------------------------------------------
  toasts: Toast[];

  // --- TEST MODE god-view (host of a test lobby only) ---------------------
  debug: DebugView;
}

/** A re-entrant chat backlog record (from the resume snapshot). */
export type { ChatRecord };
