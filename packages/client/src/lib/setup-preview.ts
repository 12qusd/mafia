/**
 * Setup role-list preview (BUILD_SPEC §13.1 lobby setup summary). Produces an
 * ordered list of role chips / category labels for the lobby's player count.
 * Category slots (RANDOM_TOWN / RANDOM_MAFIA) are shown as faction-tagged
 * placeholders since the actual draw is the server's at start.
 */

import { type GameSetup, type RoleId, type Faction } from '@nocturne/shared';

export type PreviewSlot =
  | { kind: 'role'; role: RoleId }
  | { kind: 'category'; label: string; faction: Faction };

/** Choose the slot list closest to a player count (exact, else nearest). */
function slotsFor(setup: GameSetup, count: number): readonly { kind: string }[] {
  const exact = setup.slotsByPlayerCount[String(count)];
  if (exact) return exact;
  // Fall back to the largest available count ≤ requested, else the smallest.
  const counts = Object.keys(setup.slotsByPlayerCount)
    .map(Number)
    .sort((a, b) => a - b);
  if (counts.length === 0) return [];
  const le = counts.filter((c) => c <= count);
  const pick = le.length ? le[le.length - 1]! : counts[0]!;
  return setup.slotsByPlayerCount[String(pick)] ?? [];
}

export function previewSlots(setup: GameSetup, playerCount: number): PreviewSlot[] {
  const slots = slotsFor(setup, playerCount) as readonly (
    | { kind: 'fixed'; role: RoleId }
    | { kind: 'category'; category: 'RANDOM_TOWN' | 'RANDOM_MAFIA' }
  )[];
  return slots.map((s) =>
    s.kind === 'fixed'
      ? { kind: 'role', role: s.role }
      : {
          kind: 'category',
          label: s.category === 'RANDOM_TOWN' ? 'Random Town' : 'Random Mafia',
          faction: s.category === 'RANDOM_TOWN' ? 'TOWN' : 'MAFIA',
        },
  );
}
