/**
 * Zustand store (BUILD_SPEC §13). DECISIONS.md: state lives in a single
 * zustand store; the server-message handling is the pure `reduce` function in
 * `reducer.ts`, kept separate so it is trivially unit-testable.
 *
 * The store also holds client-only state (settings, clock samples, optimistic
 * own-action selections) and exposes thin action setters the UI calls. Nothing
 * here invents secret state (§13.2).
 */

import { create } from 'zustand';
import type { ServerMessage } from '@nocturne/shared';
import { reduce, allocId, emptyDebug } from './reducer.js';
import type { StoreState, ConnectionStatus, MeState } from './types.js';
import {
  INITIAL_CLOCK_ESTIMATE,
  updateEstimate,
  type ClockSample,
} from '../lib/clock.js';
import {
  loadSettings,
  saveSettings,
  type ClientSettings,
  type TextScale,
  type AnimationLevel,
} from '../lib/storage.js';

interface StoreActions {
  /** Feed a validated server message through the pure reducer. */
  ingest(msg: ServerMessage): void;
  /** Update connection lifecycle status. */
  setConnection(status: ConnectionStatus): void;
  /** Store the signed-in account/guest from `GET /api/me` (null = signed out). */
  setMe(me: MeState | null): void;
  /** Fold a ping/pong round-trip into the clock estimate. */
  addClockSample(sample: ClockSample): void;
  /** Dismiss the oldest queued dawn-death feed item. */
  dismissDeath(): void;
  /** Remove a toast by id. */
  dismissToast(id: number): void;
  /** Push a local info toast. */
  pushInfo(detail: string): void;
  /**
   * Arm (or clear) a click-to-whisper target seat. Roster name-clicks set it;
   * the ChatPane consumes it into its whisper-compose state and clears it.
   */
  setWhisperArm(seat: number | null): void;
  /** Reset to a clean post-game / disconnected lobby view. */
  resetGame(): void;
  /** Hard reset everything (logout / leave). */
  resetAll(): void;

  // --- Optimistic own-state selections (confirmed by server acks) ---------
  setNightSelection(ability: string | null, target: number | null): void;
  /**
   * Set the local pending SECOND night target (Witch `witch_control` victim).
   * Mirrors `setNightSelection`; purely local pending UI state (§13.2).
   */
  setNightSelection2(target2: number | null): void;
  setVote(target: number | 'skip' | null): void;
  setVerdict(value: 'guilty' | 'innocent' | 'abstain' | null): void;
  setLastWill(text: string): void;
  setDeathNote(text: string): void;
  setSpectator(on: boolean): void;

  // --- Client settings ----------------------------------------------------
  settings: ClientSettings;
  setProfanityFilter(on: boolean): void;
  setColorblind(on: boolean): void;
  setTextScale(scale: TextScale): void;
  setSound(on: boolean): void;
  setAnimations(level: AnimationLevel): void;
  toggleMute(seat: number): void;
}

export type Store = StoreState & StoreActions;

const initialState: StoreState = {
  connection: 'idle',
  clock: INITIAL_CLOCK_ESTIMATE,
  forceUpdateMin: null,
  userId: null,
  guestId: null,
  me: null,
  lobby: null,
  game: null,
  own: null,
  gameOver: null,
  pointsAward: null,
  chat: [],
  whisperMeta: [],
  privateLog: [],
  jailedThisNight: false,
  silencedToday: false,
  toasts: [],
  whisperArm: null,
  debug: emptyDebug(),
};

function persistSettings(get: () => Store, patch: Partial<ClientSettings>): ClientSettings {
  const next = { ...get().settings, ...patch };
  saveSettings(next);
  return next;
}

export const useStore = create<Store>((set, get) => ({
  ...initialState,
  settings: loadSettings(),

  ingest(msg) {
    set((s) => reduce(s, msg));
  },

  setConnection(status) {
    set({ connection: status });
  },

  setMe(me) {
    set({ me });
  },

  addClockSample(sample) {
    set((s) => ({ clock: updateEstimate(s.clock, sample) }));
  },

  dismissDeath() {
    set((s) => {
      if (!s.game || s.game.deathFeed.length === 0) return {};
      return { game: { ...s.game, deathFeed: s.game.deathFeed.slice(1) } };
    });
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  pushInfo(detail) {
    set((s) => ({ toasts: [...s.toasts, { id: allocId(), code: 'info', detail }] }));
  },

  setWhisperArm(seat) {
    set({ whisperArm: seat });
  },

  resetGame() {
    set({
      game: null,
      own: null,
      gameOver: null,
      pointsAward: null,
      chat: [],
      whisperMeta: [],
      privateLog: [],
      jailedThisNight: false,
      silencedToday: false,
      whisperArm: null,
      debug: emptyDebug(),
    });
  },

  resetAll() {
    set({ ...initialState, settings: get().settings });
  },

  setNightSelection(ability, target) {
    set((s) =>
      s.own
        ? {
            own: {
              ...s.own,
              nightAbility: ability,
              nightTarget: target,
              // Clearing the puppet (target = null) also drops a pending victim:
              // a witch_control with no puppet carries no victim either.
              ...(target === null ? { nightTarget2: null } : {}),
            },
          }
        : {},
    );
  },
  setNightSelection2(target2) {
    set((s) => (s.own ? { own: { ...s.own, nightTarget2: target2 } } : {}));
  },
  setVote(target) {
    set((s) => (s.own ? { own: { ...s.own, vote: target } } : {}));
  },
  setVerdict(value) {
    set((s) => (s.own ? { own: { ...s.own, verdict: value } } : {}));
  },
  setLastWill(text) {
    set((s) => (s.own ? { own: { ...s.own, lastWill: text } } : {}));
  },
  setDeathNote(text) {
    set((s) => (s.own ? { own: { ...s.own, deathNote: text } } : {}));
  },
  setSpectator(on) {
    set((s) => (s.game ? { game: { ...s.game, spectator: on } } : {}));
  },

  setProfanityFilter(on) {
    set({ settings: persistSettings(get, { profanityFilter: on }) });
  },
  setColorblind(on) {
    set({ settings: persistSettings(get, { colorblind: on }) });
  },
  setTextScale(scale) {
    set({ settings: persistSettings(get, { textScale: scale }) });
  },
  setSound(on) {
    set({ settings: persistSettings(get, { sound: on }) });
  },
  setAnimations(level) {
    set({ settings: persistSettings(get, { animations: level }) });
  },
  toggleMute(seat) {
    const cur = get().settings.mutedSeats;
    const next = cur.includes(seat) ? cur.filter((s) => s !== seat) : [...cur, seat];
    set({ settings: persistSettings(get, { mutedSeats: next }) });
  },
}));
