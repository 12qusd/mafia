/**
 * Default public chat rooms (Social feature). The SQL schema seeds these rows
 * via `INSERT ... ON CONFLICT (slug) DO NOTHING`; the NO_DB MemoryStore seeds
 * the SAME rooms so `/api/rooms` works identically in guests-only/CI mode.
 *
 * Keep this in lock-step with the `chat_rooms` seed in schema.sql.
 */

export interface DefaultRoom {
  slug: string;
  name: string;
  topic: string;
  kind: 'shoutbox' | 'channel';
  sort: number;
}

export const DEFAULT_ROOMS: readonly DefaultRoom[] = [
  { slug: 'shoutbox', name: 'The Wire', topic: 'Word on the street — keep it short.', kind: 'shoutbox', sort: 0 },
  { slug: 'parlor', name: 'The Parlor', topic: 'General chatter for made men and marks alike.', kind: 'channel', sort: 1 },
  { slug: 'strategy', name: 'The Back Room', topic: 'Strategy, role talk, post-game tells.', kind: 'channel', sort: 2 },
  { slug: 'offtopic', name: 'The Speakeasy', topic: 'Anything goes after hours.', kind: 'channel', sort: 3 },
];
