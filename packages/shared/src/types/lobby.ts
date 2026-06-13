import { z } from 'zod';
import { FirstPhaseSchema } from './phase.js';
import { PHASE_TIMING_BOUNDS } from '../constants.js';

/**
 * Per-phase configurable timing (seconds), validated against the [min,max]
 * bounds in BUILD_SPEC §6.2. Only the phases the host may tune appear here;
 * fixed-duration phases (DAWN, EXECUTION) are not configurable.
 */
function boundedSeconds(phase: keyof typeof PHASE_TIMING_BOUNDS) {
  const { min, max } = PHASE_TIMING_BOUNDS[phase];
  return z.number().int().min(min).max(max);
}

/** Configurable phase durations (seconds). All optional; defaults applied server-side. */
export const PhaseTimingsSchema = z
  .object({
    DAY_0: boundedSeconds('DAY_0'),
    NIGHT: boundedSeconds('NIGHT'),
    DAY_DISCUSSION: boundedSeconds('DAY_DISCUSSION'),
    DAY_VOTING: boundedSeconds('DAY_VOTING'),
    TRIAL_DEFENSE: boundedSeconds('TRIAL_DEFENSE'),
    TRIAL_JUDGMENT: boundedSeconds('TRIAL_JUDGMENT'),
  })
  .partial();

export type PhaseTimings = z.infer<typeof PhaseTimingsSchema>;

/**
 * Lobby configuration (BUILD_SPEC §6.2, §6.4, §7.2). Host-set, validated
 * server-side. All fields optional on the wire; the server fills defaults from
 * `constants.ts` (DEFAULT_LOBBY_CONFIG).
 */
export const LobbyConfigSchema = z
  .object({
    timings: PhaseTimingsSchema,
    /** Whether whispers are allowed (default true). */
    whispersEnabled: z.boolean(),
    /**
     * Whether the dead see all hidden info (default true in private lobbies,
     * false in public lobbies). When false the dead see dead chat + public
     * info only (§5).
     */
    deadSeeAll: z.boolean(),
    /** Whether last wills are enabled (default true). */
    lastWillsEnabled: z.boolean(),
    /** Which phase the match opens on after DAY_0. MVP: `day_no_lynch` only. */
    firstPhase: FirstPhaseSchema,
    /**
     * TEST MODE (gated): a test lobby has full god-view/audit for the host and
     * is excluded from real stats. The server only honors this when
     * NOCTURNE_TEST_MODE=1 or the creating session is an admin; it is forced
     * false otherwise. Test lobbies are forced private (§5 still law for normal
     * games).
     */
    testMode: z.boolean(),
  })
  .partial();

export type LobbyConfig = z.infer<typeof LobbyConfigSchema>;

/** A fully-resolved lobby config (no optional fields), as held in a Room. */
export interface ResolvedLobbyConfig {
  timings: Required<PhaseTimings>;
  whispersEnabled: boolean;
  deadSeeAll: boolean;
  lastWillsEnabled: boolean;
  firstPhase: z.infer<typeof FirstPhaseSchema>;
  /** Whether this lobby/room is a gated test-mode game (god-view + audit). */
  testMode: boolean;
}

/** Lobby visibility (BUILD_SPEC §7.2). */
export const LOBBY_VISIBILITIES = ['public', 'private'] as const;
export const LobbyVisibilitySchema = z.enum(LOBBY_VISIBILITIES);
export type LobbyVisibility = z.infer<typeof LobbyVisibilitySchema>;
