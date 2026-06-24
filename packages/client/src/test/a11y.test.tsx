/**
 * Accessibility-pass regression tests:
 *   - roster + chat author names are keyboard-reachable real <button>s, and an
 *     Enter/Space activation arms a whisper (a core mechanic was span-only);
 *   - the shared modal-a11y hook traps Tab, closes on Escape, and restores focus
 *     to the trigger on close;
 *   - the CharCount helper renders the {len}/{max} counter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { PublicSeat } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { PlayerList } from '../components/PlayerList.js';
import { ChatPane } from '../components/ChatPane.js';
import { CharCount } from '../components/common.js';
import { useModalA11y } from '../lib/useModalA11y.js';
import { conn } from '../ws/connection.js';

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
});

describe('Interactive names are keyboard-reachable buttons (Task 1)', () => {
  const baseProps = {
    phase: 'DAY_DISCUSSION' as const,
    ownSeat: 0,
    accusedSeat: null,
    tallies: [] as { seat: number; weight: number }[],
    votesBySeat: [] as { seat: number; target: number | 'skip' }[],
    stumpedSeats: [] as number[],
    alive: true,
    spectator: false,
  };

  it('renders a living roster name as an enabled <button>', () => {
    render(<PlayerList {...baseProps} seats={[seat(0, true, 'Me'), seat(1, true, 'Vera')]} onWhisper={() => {}} />);
    const btn = screen.getByText('Vera');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).not.toBeDisabled();
  });

  it('disables the self name and dead names (no whisper target)', () => {
    render(
      <PlayerList
        {...baseProps}
        seats={[seat(0, true, 'Me'), seat(1, false, 'Ghost')]}
        onWhisper={() => {}}
      />,
    );
    expect(screen.getByText('Me')).toBeDisabled();
    expect(screen.getByText('Ghost')).toBeDisabled();
  });

  it('keyboard activation (Enter) of a roster name arms a whisper', () => {
    const onWhisper = vi.fn();
    render(
      <PlayerList
        {...baseProps}
        seats={[seat(0, true, 'Me'), seat(1, true, 'Vera')]}
        onWhisper={onWhisper}
      />,
    );
    // A real <button> fires onClick on Enter/Space via the browser; in jsdom we
    // assert the click handler is wired by clicking the focusable button.
    const btn = screen.getByText('Vera');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onWhisper).toHaveBeenCalledWith(1);
  });

  it('chat author names are <button>s and arm a whisper on activation', () => {
    // Seed one day-channel line authored by seat 1.
    useStore.setState({
      chat: [{ id: 1, channel: 'day', from: 1, text: 'hello', ts: 0 }],
    });
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
    const author = screen.getByText('P1:');
    expect(author.tagName).toBe('BUTTON');
    act(() => fireEvent.click(author));
    // Arming switches the input to /w 2 compose for seat 1 (display #2).
    const input = screen.getByPlaceholderText(/./) as HTMLInputElement;
    expect(input.value).toBe('/w 2 ');
  });
});

describe('useModalA11y: focus trap + Escape + restore (Task 3)', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    useModalA11y(dialogRef, open, { onClose: () => setOpen(false) });
    return (
      <div>
        <button ref={triggerRef} onClick={() => setOpen(true)}>
          open
        </button>
        {open && (
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="test">
            <button>first</button>
            <button>last</button>
          </div>
        )}
      </div>
    );
  }

  it('moves focus into the dialog on open and closes on Escape, restoring focus', async () => {
    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    act(() => fireEvent.click(trigger));
    // Dialog mounted.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Focus moved into the dialog (rAF) — flush a frame.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(screen.getByText('first'));
    // Escape closes + restores focus to the trigger.
    act(() => fireEvent.keyDown(document, { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last focusable back to the first', async () => {
    render(<Harness />);
    act(() => fireEvent.click(screen.getByText('open')));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const last = screen.getByText('last');
    last.focus();
    act(() => fireEvent.keyDown(document, { key: 'Tab' }));
    expect(document.activeElement).toBe(screen.getByText('first'));
  });
});

describe('CharCount (Task 5)', () => {
  it('renders {len}/{max} and flags near-limit', () => {
    const { rerender, container } = render(<CharCount len={10} max={80} />);
    expect(screen.getByText('10/80')).toBeInTheDocument();
    expect(container.querySelector('.char-count-near')).toBeNull();
    rerender(<CharCount len={76} max={80} />);
    expect(container.querySelector('.char-count-near')).toBeTruthy();
  });
});
