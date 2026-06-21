/**
 * In-game MOBILE layout: under the ~820px breakpoint the desktop three-column
 * grid is replaced by a single full-width pane at a time, swapped by a segmented
 * tab control. This module holds the pure pane definitions + the next-pane logic
 * so the tab switcher can be unit-tested in jsdom without measuring a viewport
 * (the breakpoint itself is CSS / a `matchMedia` hook).
 *
 * PRESENTATIONAL ONLY — choosing a pane never changes game state, the store, or
 * the protocol; it only controls which existing column is visible on a phone.
 */

/** The three swappable in-game views on mobile. */
export type GameMobilePane = 'role' | 'table' | 'chat';

export interface GameMobilePaneDef {
  id: GameMobilePane;
  /** Short tab label. */
  label: string;
  /** Accessible label for the tab control. */
  aria: string;
}

/** Tab order, left → right: Your Role · The Table · Chat. */
export const GAME_MOBILE_PANES: readonly GameMobilePaneDef[] = [
  { id: 'role', label: 'Your Role', aria: 'Your role, actions and wills' },
  { id: 'table', label: 'The Table', aria: 'The table: players, votes and tallies' },
  { id: 'chat', label: 'Chat', aria: 'Chat channels' },
] as const;

const ORDER: readonly GameMobilePane[] = GAME_MOBILE_PANES.map((p) => p.id);

/** True when `id` is one of the three valid mobile panes. */
export function isGameMobilePane(id: string): id is GameMobilePane {
  return (ORDER as readonly string[]).includes(id);
}

/**
 * Resolve the pane to show. Falls back to the first pane ('role') for any
 * unknown value, so a stale/invalid pane can never blank the screen.
 */
export function resolveGameMobilePane(id: string | null | undefined): GameMobilePane {
  return id && isGameMobilePane(id) ? id : ORDER[0]!;
}
