/**
 * Reactive navigation: when the server places us in a lobby or starts a game,
 * route accordingly (BUILD_SPEC §7 flow). The client navigates only in response
 * to server state, never optimistically.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store.js';

export function useLobbyNav() {
  const navigate = useNavigate();
  const lobbyId = useStore((s) => s.lobby?.id ?? null);
  const inGame = useStore((s) => s.game !== null);
  const lobbyStatus = useStore((s) => s.lobby?.status ?? null);
  const prevInGame = useRef(false);

  useEffect(() => {
    if (inGame && !prevInGame.current) {
      navigate('/game');
    }
    prevInGame.current = inGame;
  }, [inGame, navigate]);

  useEffect(() => {
    if (lobbyId && !inGame && lobbyStatus !== 'in_game') {
      navigate(`/lobby/${lobbyId}`);
    }
  }, [lobbyId, inGame, lobbyStatus, navigate]);
}
