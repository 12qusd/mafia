import { z } from 'zod';
import { SeatIdSchema, DisplayNameSchema } from './common.js';
import { LobbyConfigSchema, LobbyVisibilitySchema } from '../types/lobby.js';
import { PublicSeatSchema } from '../types/seat.js';
import { PhaseSchema } from '../types/phase.js';
import { RoleIdSchema } from '../types/role.js';
import { FactionSchema } from '../types/faction.js';
import { ChatChannelSchema } from '../types/chat.js';

/**
 * Composite protocol objects (BUILD_SPEC §9). These are the structured payloads
 * referenced by multiple messages (lobby object, role card, resume snapshot).
 */

/** A member of a lobby roster (pre-game, public). */
export const LobbyMemberSchema = z.object({
  userOrGuestId: z.string(),
  name: DisplayNameSchema,
  isHost: z.boolean(),
  isSpectator: z.boolean(),
  connected: z.boolean(),
});
export type LobbyMember = z.infer<typeof LobbyMemberSchema>;

/** Full lobby object (BUILD_SPEC §9.2 `lobby_state`). Public, pre-game data. */
export const LobbySchema = z.object({
  id: z.string(),
  name: z.string(),
  visibility: LobbyVisibilitySchema,
  setupId: z.string(),
  config: LobbyConfigSchema,
  hostUserOrGuestId: z.string(),
  members: z.array(LobbyMemberSchema),
  spectatorCount: z.number().int().min(0),
  status: z.enum(['waiting', 'in_game', 'finished']),
  /** TEST badge: true for a gated test-mode lobby (god-view + audit). */
  testMode: z.boolean().optional(),
});
export type Lobby = z.infer<typeof LobbySchema>;

/**
 * Ability descriptor sent on the role card (BUILD_SPEC §9.2 `your_role`,
 * §13.1 role card). Tells the client what the seat may do and how many uses
 * remain. `usesRemaining` is `null` for unlimited/passive abilities.
 */
export const AbilityInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** When the ability is used: a night action, a day action, or passive. */
  timing: z.enum(['night', 'day', 'passive']),
  usesRemaining: z.number().int().min(0).nullable(),
  /**
   * Which seats the ability may legally target, so the client can drive the right
   * picker: `living` (most actions), `dead` (grave-targeting — autopsy,
   * remember, disguise), `living_or_dead` (either), `self`/`none` (toggles with no
   * external target — alert, vest, ignite, spy, divine). Additive.
   */
  targetDomain: z.enum(['living', 'dead', 'living_or_dead', 'self', 'none']),
  /** Short imperative the UI shows on the action button (e.g. Heal, Shoot, Bite). */
  verb: z.string(),
});
export type AbilityInfo = z.infer<typeof AbilityInfoSchema>;

/** Vote tally row for open voting (BUILD_SPEC §9.2 `vote_update`). */
export const TallyEntrySchema = z.object({
  seat: SeatIdSchema,
  weight: z.number().int().min(0),
});
export type TallyEntry = z.infer<typeof TallyEntrySchema>;

/** A single recorded chat message (used in snapshots & chat backlog). */
export const ChatRecordSchema = z.object({
  channel: ChatChannelSchema,
  /** Sender seat, or the literal "Jailor" mask for jail chat (§6.4). */
  from: z.union([SeatIdSchema, z.literal('Jailor')]),
  text: z.string(),
  ts: z.number().int(),
});
export type ChatRecord = z.infer<typeof ChatRecordSchema>;

/**
 * Per-seat resume snapshot (BUILD_SPEC §8, §9.2 `welcome.resume`). Everything a
 * reconnecting seat is entitled to: public state, own role + private-knowledge
 * log, entitled chat backlog, current phase + deadline.
 */
export const SeatSnapshotSchema = z.object({
  seat: SeatIdSchema,
  phase: PhaseSchema,
  dayNumber: z.number().int().min(0),
  endsAt: z.number().int().nullable(),
  seats: z.array(PublicSeatSchema),
  ownRole: RoleIdSchema,
  ownFaction: FactionSchema,
  abilities: z.array(AbilityInfoSchema),
  /** Mafia roster, present only for mafia seats. */
  mates: z.array(SeatIdSchema).optional(),
  /** Every private result this seat has received (opaque records). */
  privateLog: z.array(z.unknown()),
  /** Chat backlog for entitled channels (cap last 200/channel, §8). */
  chatBacklog: z.array(ChatRecordSchema),
  /** Current last will text, if the seat keeps one. */
  lastWill: z.string().optional(),
  /** Current death note text, for killers. */
  deathNote: z.string().optional(),
});
export type SeatSnapshot = z.infer<typeof SeatSnapshotSchema>;
