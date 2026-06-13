/**
 * Derived identity helpers. The client's own id is whichever of userId/guestId
 * the server returned in `welcome` (BUILD_SPEC §7.1, §9.2).
 */

import type { StoreState } from '../store/types.js';
import type { Lobby } from '@nocturne/shared';

export function selfId(state: Pick<StoreState, 'userId' | 'guestId'>): string | null {
  return state.userId ?? state.guestId ?? null;
}

export function isHost(lobby: Lobby | null, self: string | null): boolean {
  if (!lobby || !self) return false;
  return lobby.hostUserOrGuestId === self;
}
