/**
 * The create-table "Test mode" toggle is admin-only.
 *
 * The server admin-gates test-lobby creation in production, so a normal user
 * toggling it just gets rejected. The CreateLobbyCard must therefore render the
 * toggle ONLY when the signed-in account is an admin (`me.isAdmin`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStore } from '../store/store.js';
import { CreateLobbyCard } from '../screens/HomeScreen.js';
import { HOME } from '../lib/strings-extra.js';

// SetupPicker (inside CreateLobbyCard) fetches setups; stub those so the card
// renders without a network. The lobby actions are stubbed (no WS in jsdom).
vi.mock('../lib/api.js', () => ({
  fetchSetups: vi.fn().mockResolvedValue([]),
  fetchDailySetups: vi.fn().mockResolvedValue({ date: '', featured: null, chaos: null }),
  fetchCustomSetups: vi.fn().mockResolvedValue([]),
}));
vi.mock('../ws/actions.js', () => ({ createLobby: vi.fn() }));

function signInAs(isAdmin: boolean) {
  useStore.setState({
    me: {
      id: 'u1',
      name: 'Boss',
      isGuest: false,
      isAdmin,
      stats: null,
      emailVerified: null,
      hasEmail: false,
    },
  });
}

describe('CreateLobbyCard: Test mode toggle is admin-only', () => {
  beforeEach(() => useStore.getState().resetAll());
  afterEach(() => cleanup());

  it('hides the Test mode toggle for a NON-admin account', () => {
    signInAs(false);
    render(<CreateLobbyCard />);
    // The toggle's accessible switch carries the test-mode label; it must be absent.
    expect(screen.queryByLabelText(HOME.testModeLabel)).toBeNull();
  });

  it('shows the Test mode toggle for an ADMIN account', () => {
    signInAs(true);
    render(<CreateLobbyCard />);
    expect(screen.getByLabelText(HOME.testModeLabel)).toBeTruthy();
  });
});
