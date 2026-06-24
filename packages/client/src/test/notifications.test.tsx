/**
 * Notifications center client (QoL wave): the topbar bell feed rendering + the
 * rank-up celebration detection. Pure client UI — no game state mutated.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationsBell } from '../components/NotificationsBell.js';
import { RankUpToast } from '../components/RankUpToast.js';
import { useStore } from '../store/store.js';
import type { PointsAwardState } from '../store/types.js';

function stubFetch(notifications: unknown[], unread: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (typeof url === 'string' && url.startsWith('/api/me/notifications/read')) {
        return { ok: true, json: async () => ({ ok: true, unread: 0 }) } as Response;
      }
      if (typeof url === 'string' && url.startsWith('/api/me/notifications')) {
        return { ok: true, json: async () => ({ notifications, unread }) } as Response;
      }
      void init;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }),
  );
}

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanup();
});

describe('NotificationsBell', () => {
  it('shows the unread badge and renders human text per type on open', async () => {
    stubFetch(
      [
        { id: 'n1', type: 'friend_request', payload: { fromUsername: 'Capone' }, createdAt: Date.now(), readAt: null },
        { id: 'n2', type: 'rank_up', payload: { rankName: 'Fixer', mmr: 1510 }, createdAt: Date.now(), readAt: null },
        { id: 'n3', type: 'achievement', payload: { name: 'First Blood', points: 25 }, createdAt: Date.now(), readAt: null },
      ],
      3,
    );

    render(
      <MemoryRouter>
        <NotificationsBell />
      </MemoryRouter>,
    );

    // The poll resolves; the unread badge appears.
    expect(await screen.findByText('3')).toBeInTheDocument();

    // Open the panel.
    const btn = screen.getByRole('button');
    await act(async () => {
      btn.click();
    });

    expect(screen.getByText(/Capone wants in/i)).toBeInTheDocument();
    expect(screen.getByText(/climbed to Fixer/i)).toBeInTheDocument();
    expect(screen.getByText(/First Blood/i)).toBeInTheDocument();
  });

  it('sanitizes a malicious username in a notification', async () => {
    stubFetch(
      [
        {
          id: 'n1',
          type: 'friend_request',
          // zero-width + control chars should be stripped on render.
          payload: { fromUsername: 'Ev​il' },
          createdAt: Date.now(),
          readAt: null,
        },
      ],
      1,
    );
    render(
      <MemoryRouter>
        <NotificationsBell />
      </MemoryRouter>,
    );
    await screen.findByText('1');
    await act(async () => {
      screen.getByRole('button').click();
    });
    // The collapsed/sanitized name ("Evil") shows, not the raw spoofed string.
    expect(screen.getByText(/Evil wants in/i)).toBeInTheDocument();
  });
});

describe('RankUpToast', () => {
  beforeEach(() => {
    useStore.setState({ pointsAward: null });
  });

  function award(mmrAfter: number, rankedDelta: number, rank: string, rankName: string): PointsAwardState {
    return {
      matchId: 'm1',
      breakdown: { total: 0, awards: [] } as unknown as PointsAwardState['breakdown'],
      stats: {
        userId: 'u1',
        username: 'me',
        totalPoints: 0,
        gamesPlayed: 1,
        gamesWon: 1,
        gamesSurvived: 1,
        daysDeadWatched: 0,
        achievements: [],
        tier: 'drifter',
        ranked: { mmr: mmrAfter, rd: 60, rank, rankName, games: 5, wins: 3, seasonId: 's1' },
      } as unknown as PointsAwardState['stats'],
      newAchievements: [],
      rankedDelta,
    };
  }

  it('celebrates when the rung climbs (Bagman → Fixer across 1500)', () => {
    setReducedMotion(false);
    render(<RankUpToast />);
    // before 1490 (Bagman), after 1510 (Fixer): a real rung-up.
    act(() => {
      useStore.setState({ pointsAward: award(1510, 20, 'fixer', 'Fixer') });
    });
    expect(screen.getByText(/You ascend/i)).toBeInTheDocument();
    expect(screen.getByText(/rise to Fixer/i)).toBeInTheDocument();
  });

  it('does NOT celebrate a within-rung gain (no rung change)', () => {
    setReducedMotion(false);
    render(<RankUpToast />);
    // before 1310, after 1330: both Bagman — no celebration.
    act(() => {
      useStore.setState({ pointsAward: award(1330, 20, 'runner', 'Bagman') });
    });
    expect(screen.queryByText(/You ascend/i)).not.toBeInTheDocument();
  });

  it('does NOT celebrate a casual game (rankedDelta null)', () => {
    setReducedMotion(false);
    render(<RankUpToast />);
    act(() => {
      useStore.setState({ pointsAward: award(1510, 0, 'fixer', 'Fixer') as PointsAwardState });
    });
    // Casual: rankedDelta is null → no before/after, no celebration.
    const a = award(1510, 0, 'fixer', 'Fixer');
    (a as { rankedDelta: number | null }).rankedDelta = null;
    act(() => {
      useStore.setState({ pointsAward: a });
    });
    expect(screen.queryByText(/You ascend/i)).not.toBeInTheDocument();
  });
});
