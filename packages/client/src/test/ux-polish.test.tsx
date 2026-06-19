/**
 * Final UX-polish wave (audit E5 / H6 / E7):
 *   - PlayerList shows the weighted-majority "votes to put on trial" threshold
 *     during DAY_VOTING, plus each candidate's running tally against it and a
 *     skip-day tally vs the same threshold (E5);
 *   - clicking a roster name arms a whisper (store `whisperArm`), which the
 *     ChatPane consumes into its whisper-compose state (H6);
 *   - the DeathFeed auto-advances after a UI-only delay (fake timers), while
 *     keeping the manual Continue button, and does NOT auto-advance under
 *     prefers-reduced-motion (E7).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { PublicSeat } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { PlayerList } from '../components/PlayerList.js';
import { ChatPane } from '../components/ChatPane.js';
import { DeathFeed, DEATH_AUTOADVANCE_MS } from '../components/DeathFeed.js';
import { GAME } from '../lib/strings-extra.js';
import { conn } from '../ws/connection.js';
import type { DeathFeedItem } from '../store/types.js';

function seat(n: number, alive = true, name = `P${n}`): PublicSeat {
  return { seat: n, name, alive, connected: true, afk: false };
}

beforeEach(() => {
  useStore.getState().resetAll();
  vi.spyOn(conn, 'send').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- E5: vote threshold ----------------------------------------------------
describe('PlayerList: vote threshold during DAY_VOTING (E5)', () => {
  const baseProps = {
    ownSeat: 0,
    accusedSeat: null,
    votesBySeat: [] as { seat: number; target: number | 'skip' }[],
    stumpedSeats: [] as number[],
    alive: true,
    spectator: false,
    onWhisper: () => {},
  };

  it('shows the "voices to put a soul on trial" threshold while voting', () => {
    // 5 living seats → floor(5/2)+1 = 3.
    const seats = [seat(0), seat(1), seat(2), seat(3), seat(4)];
    render(
      <PlayerList
        {...baseProps}
        seats={seats}
        phase="DAY_VOTING"
        tallies={[]}
      />,
    );
    expect(screen.getByText(GAME.voteThreshold(3))).toBeInTheDocument();
  });

  it('does NOT show the threshold outside DAY_VOTING', () => {
    const seats = [seat(0), seat(1), seat(2), seat(3), seat(4)];
    render(
      <PlayerList
        {...baseProps}
        seats={seats}
        phase="DAY_DISCUSSION"
        tallies={[]}
      />,
    );
    expect(screen.queryByText(GAME.voteThreshold(3))).not.toBeInTheDocument();
  });

  it('excludes stumped seats from the living vote weight', () => {
    // 5 living, 1 stumped → weight 4 → floor(4/2)+1 = 3 (would be 3 either way),
    // so use 6 seats with 1 stump: weight 5 → 3, vs 6 → 4 without the stump.
    const seats = [seat(0), seat(1), seat(2), seat(3), seat(4), seat(5)];
    render(
      <PlayerList
        {...baseProps}
        seats={seats}
        phase="DAY_VOTING"
        stumpedSeats={[5]}
        tallies={[]}
      />,
    );
    // weight 5 → floor(5/2)+1 = 3, NOT 4 (the no-stump value).
    expect(screen.getByText(GAME.voteThreshold(3))).toBeInTheDocument();
    expect(screen.queryByText(GAME.voteThreshold(4))).not.toBeInTheDocument();
  });

  it('renders a candidate tally as "have / threshold"', () => {
    const seats = [seat(0), seat(1), seat(2), seat(3), seat(4)];
    render(
      <PlayerList
        {...baseProps}
        seats={seats}
        phase="DAY_VOTING"
        tallies={[{ seat: 2, weight: 2 }]}
      />,
    );
    // 2 of 3 needed.
    expect(screen.getByText(GAME.tallyOfThreshold(2, 3))).toBeInTheDocument();
  });

  it('surfaces a running skip tally vs the threshold when skip votes exist', () => {
    const seats = [seat(0), seat(1), seat(2), seat(3), seat(4)];
    render(
      <PlayerList
        {...baseProps}
        seats={seats}
        phase="DAY_VOTING"
        tallies={[]}
        votesBySeat={[
          { seat: 1, target: 'skip' },
          { seat: 3, target: 'skip' },
        ]}
      />,
    );
    expect(screen.getByText(GAME.skipThreshold(2, 3))).toBeInTheDocument();
  });
});

// --- H6: click-a-name-to-whisper ------------------------------------------
describe('PlayerList → store → ChatPane: click-to-whisper arming (H6)', () => {
  it('clicking a living roster name arms whisperArm in the store', () => {
    const seats = [seat(0, true, 'Me'), seat(1, true, 'Vera')];
    const onWhisper = vi.fn((s: number) => useStore.getState().setWhisperArm(s));
    render(
      <PlayerList
        seats={seats}
        phase="DAY_DISCUSSION"
        ownSeat={0}
        accusedSeat={null}
        tallies={[]}
        votesBySeat={[]}
        stumpedSeats={[]}
        alive
        spectator={false}
        onWhisper={onWhisper}
      />,
    );
    fireEvent.click(screen.getByText('Vera'));
    expect(onWhisper).toHaveBeenCalledWith(1);
    expect(useStore.getState().whisperArm).toBe(1);
  });

  it('ChatPane consumes whisperArm into whisper-compose and clears it', () => {
    render(
      <ChatPane
        channels={['day']}
        activeDefault="day"
        seatCount={3}
        seatNameFor={(n) => `P${n}`}
        canSpeak
        onSend={() => {}}
        onWhisper={() => {}}
      />,
    );
    // Arm a whisper to seat 1 (display #2). The store update drives a ChatPane
    // re-render + consume effect, so flush it inside act().
    act(() => useStore.getState().setWhisperArm(1));
    // The compose pill names the target, and the input is prefilled with /w 2.
    expect(screen.getByText(GAME.whisperingTo('P1'))).toBeInTheDocument();
    const input = screen.getByPlaceholderText(GAME.chatPlaceholder) as HTMLInputElement;
    expect(input.value).toBe('/w 2 ');
    // The arm is consumed (cleared) so it never re-fires.
    expect(useStore.getState().whisperArm).toBeNull();
  });

  it('clears the arm even when the pane offers no whisper (lobby-style, no onWhisper)', () => {
    render(
      <ChatPane
        channels={['day']}
        activeDefault="day"
        seatNameFor={(n) => `P${n}`}
        canSpeak
        onSend={() => {}}
      />,
    );
    act(() => useStore.getState().setWhisperArm(1));
    // No whisper-compose pill (no onWhisper), but the arm is still drained.
    expect(screen.queryByText(GAME.whisperingTo('P1'))).not.toBeInTheDocument();
    expect(useStore.getState().whisperArm).toBeNull();
  });
});

// --- E7: DeathFeed auto-advance -------------------------------------------
function deathItem(s: number): DeathFeedItem {
  return {
    v: 1,
    type: 'death_announce',
    seat: s,
    cause: 'mafia',
  } as unknown as DeathFeedItem;
}

function seedFeed(items: DeathFeedItem[]): void {
  useStore.setState({
    game: {
      setupId: 's',
      seats: [seat(0), seat(1)],
      phase: 'DAWN',
      dayNumber: 1,
      endsAt: null,
      tallies: [],
      votesBySeat: [],
      accusedSeat: null,
      lastVerdict: null,
      deathFeed: items,
      spectator: false,
      stumpedSeats: [],
    },
  });
}

describe('DeathFeed: gentle auto-advance (E7)', () => {
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

  afterEach(() => vi.unstubAllGlobals());

  it('auto-advances to the next death after the delay (fake timers)', () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    seedFeed([deathItem(0), deathItem(1)]);
    render(<DeathFeed seatNameFor={(n) => `P${n}`} />);

    // First death visible; one more queued.
    expect(useStore.getState().game?.deathFeed.length).toBe(2);

    act(() => vi.advanceTimersByTime(DEATH_AUTOADVANCE_MS + 10));
    // The first death auto-dismissed; the second remains.
    expect(useStore.getState().game?.deathFeed.length).toBe(1);
    expect(useStore.getState().game?.deathFeed[0]?.seat).toBe(1);
  });

  it('does NOT auto-advance under prefers-reduced-motion', () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    seedFeed([deathItem(0), deathItem(1)]);
    render(<DeathFeed seatNameFor={(n) => `P${n}`} />);

    act(() => vi.advanceTimersByTime(DEATH_AUTOADVANCE_MS * 3));
    // Still showing the first; nothing auto-dismissed.
    expect(useStore.getState().game?.deathFeed.length).toBe(2);
  });

  it('keeps the manual Continue control', () => {
    setReducedMotion(false);
    seedFeed([deathItem(0), deathItem(1)]);
    render(<DeathFeed seatNameFor={(n) => `P${n}`} />);
    // "Continue (1 more)" button present and dismisses on click.
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(useStore.getState().game?.deathFeed.length).toBe(1);
  });
});
