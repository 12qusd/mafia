import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_LOBBY_CONFIG } from '@nocturne/shared';
import { GameScreen } from '../screens/GameScreen.js';
import { useStore } from '../store/store.js';
import { conn } from '../ws/connection.js';
beforeEach(() => {
  useStore.getState().resetAll();
  useStore.getState().setAnimations('off');
  vi.spyOn(conn, 'send').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('renders a game arriving after the loading screen without changing hook order', () => {
  render(
    <MemoryRouter>
      <GameScreen />
    </MemoryRouter>,
  );
  act(() => {
    useStore
      .getState()
      .ingest({
        v: 1,
        type: 'game_started',
        setupId: 'classic-nocturne',
        config: DEFAULT_LOBBY_CONFIG,
        seats: [{ seat: 0, name: 'Player', alive: true, connected: true, afk: false }],
      });
    useStore
      .getState()
      .ingest({ v: 1, type: 'your_role', role: 'SHERIFF', faction: 'TOWN', abilities: [] });
  });
  expect(screen.getByText('Sheriff')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Town square' })).toBeInTheDocument();
  act(() => useStore.getState().resetGame());
  expect(screen.queryByText('Sheriff')).not.toBeInTheDocument();
});
