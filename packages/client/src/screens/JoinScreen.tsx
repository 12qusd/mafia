/** Invite flow: validate, join once per code, and offer recovery on rejection. */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { INVITE_CODE_LENGTH } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { useLobbyNav } from '../components/useLobbyNav.js';
import { joinLobby } from '../ws/actions.js';

export function JoinScreen() {
  useLobbyNav();
  const { code } = useParams();
  const connection = useStore((s) => s.connection);
  const toasts = useStore((s) => s.toasts);
  const sent = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const valid = !!code && new RegExp(`^[A-Za-z0-9]{${INVITE_CODE_LENGTH}}$`).test(code);
  const normalized = code?.toUpperCase() ?? '';
  const [errorFloor, setErrorFloor] = useState(0);
  const failed = toasts.some((t) => t.id > errorFloor && t.code !== 'info');
  useEffect(() => {
    setWaitingTooLong(false);
    setErrorFloor(Math.max(0, ...useStore.getState().toasts.map((t) => t.id)));
    if (connection !== 'open' || !valid) return;
    const key = `${normalized}:${attempt}`;
    if (sent.current !== key) {
      sent.current = key;
      joinLobby({ inviteCode: normalized });
    }
    const timer = setTimeout(() => setWaitingTooLong(true), 12000);
    return () => clearTimeout(timer);
  }, [connection, normalized, valid, attempt]);
  return (
    <div className="page center" style={{ minHeight: '60vh' }}>
      <div className="panel panel-pad center stack" style={{ textAlign: 'center', maxWidth: 460 }}>
        <div className="eyebrow">An invitation to Nocturne</div>
        <h2>
          {!valid
            ? 'Check your invitation'
            : failed
              ? 'The door didn’t open'
              : 'Knocking at the door…'}
        </h2>
        <p className="muted">
          {!valid
            ? 'Enter the six-character code shared by your host.'
            : failed
              ? 'The table may have closed or filled up. Check the code with your host.'
              : `Joining table ${normalized}`}
        </p>
        {waitingTooLong && !failed && (
          <p className="muted">The table is taking longer than expected to respond.</p>
        )}
        <div className="row">
          {valid && (failed || waitingTooLong) && (
            <button
              className="btn"
              disabled={connection !== 'open'}
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          )}
          <Link className="btn" to="/">
            Back to tables
          </Link>
        </div>
      </div>
    </div>
  );
}
