/**
 * MOBILE in-game tab switcher (responsive layout pass). jsdom cannot measure a
 * viewport, so this tests the pane STATE LOGIC and the tab control's switching
 * behavior — not the CSS media query that gates visibility. The breakpoint is
 * exercised by screenshot validation at a phone viewport, not here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  GAME_MOBILE_PANES,
  isGameMobilePane,
  resolveGameMobilePane,
  type GameMobilePane,
} from '../components/gameMobilePanes.js';

afterEach(cleanup);

describe('game mobile pane definitions', () => {
  it('exposes exactly the three swappable panes in order', () => {
    expect(GAME_MOBILE_PANES.map((p) => p.id)).toEqual(['role', 'table', 'chat']);
  });

  it('every pane has a label and an accessible aria string', () => {
    for (const p of GAME_MOBILE_PANES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.aria.length).toBeGreaterThan(0);
    }
  });

  it('recognises only valid pane ids', () => {
    expect(isGameMobilePane('role')).toBe(true);
    expect(isGameMobilePane('table')).toBe(true);
    expect(isGameMobilePane('chat')).toBe(true);
    expect(isGameMobilePane('bogus')).toBe(false);
  });

  it('resolves unknown/stale ids back to the first pane (never blanks)', () => {
    expect(resolveGameMobilePane('chat')).toBe('chat');
    expect(resolveGameMobilePane('bogus')).toBe('role');
    expect(resolveGameMobilePane(null)).toBe('role');
    expect(resolveGameMobilePane(undefined)).toBe('role');
  });
});

/**
 * A minimal harness mirroring the GameScreen tab bar + pane wrapper markup, to
 * verify that tapping a tab swaps the active pane class and the aria-selected
 * state — the exact behaviour the real screen relies on.
 */
function MobileTabsHarness() {
  const [pane, setPane] = useState<GameMobilePane>('role');
  return (
    <div className={`game-shell game-mobile-pane-${pane}`}>
      <div className="game-mobile-tabs" role="tablist">
        {GAME_MOBILE_PANES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pane === p.id}
            className={`game-mobile-tab ${pane === p.id ? 'active' : ''}`}
            onClick={() => setPane(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

describe('mobile tab switcher behaviour', () => {
  it('starts on the role pane and switches to table then chat on tap', () => {
    const { container } = render(<MobileTabsHarness />);
    const shell = container.querySelector('.game-shell')!;

    // Default pane.
    expect(shell.className).toContain('game-mobile-pane-role');
    expect(screen.getByRole('tab', { name: 'Your Role' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'The Table' }));
    expect(shell.className).toContain('game-mobile-pane-table');
    expect(screen.getByRole('tab', { name: 'The Table' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Your Role' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(shell.className).toContain('game-mobile-pane-chat');
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders exactly three tabs', () => {
    render(<MobileTabsHarness />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
