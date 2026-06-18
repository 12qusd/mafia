/**
 * Account bootstrap (goals 1, 2, 4, 8). Fetches `GET /api/me` and writes the
 * result into the store. Called on app mount and after an auth re-bind so the
 * profile card, leaderboard, custom-setup builder, and admin gate all read a
 * single server-sourced identity. The store holds only what the server sent.
 */

import { fetchMe } from './api.js';
import { useStore } from '../store/store.js';

/** Refresh the cached `me` from the server. Resilient: null on any failure. */
export async function refreshMe(): Promise<void> {
  const me = await fetchMe();
  useStore.getState().setMe(me);
}
