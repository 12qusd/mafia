/**
 * Default forum categories + boards (Forums feature). The SQL schema seeds these
 * rows via `INSERT ... ON CONFLICT (slug) DO NOTHING`; the NO_DB MemoryStore
 * seeds the SAME categories/boards so the forum index works identically in
 * guests-only/CI mode.
 *
 * Keep this in lock-step with the `forum_categories` / `forum_boards` seed in
 * schema.sql.
 */

export interface DefaultForumBoard {
  slug: string;
  name: string;
  description: string;
  sort: number;
}

export interface DefaultForumCategory {
  slug: string;
  name: string;
  sort: number;
  boards: readonly DefaultForumBoard[];
}

export const DEFAULT_FORUM: readonly DefaultForumCategory[] = [
  {
    slug: 'the-family',
    name: 'The Family',
    sort: 0,
    boards: [
      { slug: 'announcements', name: 'Announcements', description: 'Word from the bosses.', sort: 0 },
      {
        slug: 'introductions',
        name: 'New in Town',
        description: 'Introduce yourself to the family.',
        sort: 1,
      },
    ],
  },
  {
    slug: 'the-game',
    name: 'The Game',
    sort: 1,
    boards: [
      {
        slug: 'strategy',
        name: 'Strategy & Roles',
        description: 'Tactics, role talk, setups.',
        sort: 0,
      },
      {
        slug: 'results',
        name: 'Results & Replays',
        description: 'Post your games and tells.',
        sort: 1,
      },
    ],
  },
  {
    slug: 'after-hours',
    name: 'After Hours',
    sort: 2,
    boards: [
      {
        slug: 'offtopic',
        name: 'The Speakeasy',
        description: 'Anything goes after dark.',
        sort: 0,
      },
    ],
  },
];
