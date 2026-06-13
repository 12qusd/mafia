import type { ResolvedLobbyConfig } from './lobby.js';
import { DEFAULT_PHASE_SECONDS } from '../constants.js';

/**
 * Default resolved lobby config (BUILD_SPEC §6.2, §6.4).
 *
 * `deadSeeAll` defaults to `true` here, matching the private-lobby default
 * (§5). The server overrides it to `false` when creating a public lobby.
 */
export const DEFAULT_LOBBY_CONFIG: ResolvedLobbyConfig = {
  timings: {
    DAY_0: DEFAULT_PHASE_SECONDS.DAY_0,
    NIGHT: DEFAULT_PHASE_SECONDS.NIGHT,
    DAY_DISCUSSION: DEFAULT_PHASE_SECONDS.DAY_DISCUSSION,
    DAY_VOTING: DEFAULT_PHASE_SECONDS.DAY_VOTING,
    TRIAL_DEFENSE: DEFAULT_PHASE_SECONDS.TRIAL_DEFENSE,
    TRIAL_JUDGMENT: DEFAULT_PHASE_SECONDS.TRIAL_JUDGMENT,
  },
  whispersEnabled: true,
  deadSeeAll: true,
  lastWillsEnabled: true,
  firstPhase: 'day_no_lynch',
  testMode: false,
};
