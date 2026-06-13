/**
 * `/join/:code` (BUILD_SPEC §13.1 invite-link route). Sends `join_lobby` by
 * invite code once connected, then navigation flows reactively when the server
 * places us in the lobby (or rejects with an error toast).
 */

import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { INVITE_CODE_LENGTH } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { useLobbyNav } from '../components/useLobbyNav.js';
import { joinLobby } from '../ws/actions.js';

export function JoinScreen() {
  useLobbyNav();
  const { code } = useParams();
  const connection = useStore((s) => s.connection);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    if (connection !== 'open') return;
    if (!code || code.length !== INVITE_CODE_LENGTH) return;
    sent.current = true;
    joinLobby({ inviteCode: code.toUpperCase() });
  }, [connection, code]);

  return (
    <div className="page center" style={{ minHeight: '40vh' }}>
      <div className="panel panel-pad center stack" style={{ textAlign: 'center' }}>
        <h2>Knocking at the door…</h2>
        <p className="muted">
          {code && code.length === INVITE_CODE_LENGTH
            ? `Joining table ${code.toUpperCase()}`
            : 'That invite code does not look right.'}
        </p>
      </div>
    </div>
  );
}
