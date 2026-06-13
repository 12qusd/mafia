/**
 * Game-over screen (BUILD_SPEC §13.1): winners, full role-reveal table, personal
 * result, seed, and a "play again" button (keeps the crowd together, §7.7).
 */

import { getRole } from '@nocturne/shared';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead, FactionTag } from './common.js';
import { GAME, WINNER_LABEL, OUTCOME_LABEL } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { leaveLobby } from '../ws/actions.js';

export function GameOver() {
  const navigate = useNavigate();
  const over = useStore((s) => s.gameOver);
  const seats = useStore((s) => s.game?.seats ?? []);
  const ownSeat = useStore((s) => s.own?.seat ?? null);
  const resetGame = useStore((s) => s.resetGame);
  if (!over) return null;

  const nameFor = (seat: number) =>
    sanitizeInline(seats.find((s) => s.seat === seat)?.name ?? `#${seat + 1}`);
  const mine = over.allRoles.find((r) => r.seat === ownSeat);

  return (
    <div className="overlay">
      <div className="panel panel-pad modal stack" style={{ maxWidth: 680 }}>
        <div className="win-result">{GAME.gameOver}</div>
        <div className="stack" style={{ alignItems: 'center' }}>
          {over.winners.map((w) => (
            <div key={w} className="win-loss win" style={{ fontFamily: 'var(--font-display)' }}>
              {WINNER_LABEL[w]}
            </div>
          ))}
        </div>

        {mine && (
          <div className={`win-loss ${mine.outcome === 'win' ? 'win' : 'loss'}`}>
            {GAME.yourResult}: {OUTCOME_LABEL[mine.outcome]} — you were the {getRole(mine.role).name}
          </div>
        )}

        <DecoHead>{GAME.roleReveal}</DecoHead>
        <table className="reveal-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Role</th>
              <th>Faction</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {over.allRoles
              .slice()
              .sort((a, b) => a.seat - b.seat)
              .map((r) => (
                <tr key={r.seat} style={r.seat === ownSeat ? { color: 'var(--c-amber)' } : undefined}>
                  <td>{r.seat + 1}</td>
                  <td>{nameFor(r.seat)}</td>
                  <td>{getRole(r.role).name}</td>
                  <td>
                    <FactionTag faction={r.faction} />
                  </td>
                  <td>{OUTCOME_LABEL[r.outcome]}</td>
                </tr>
              ))}
          </tbody>
        </table>

        <div className="spread">
          <span className="faint">
            {GAME.seedLabel}: <code>{sanitizeInline(over.seed)}</code>
          </span>
        </div>

        <div className="row">
          <button
            className="btn btn-primary grow"
            onClick={() => {
              // "Play again" returns the group to a fresh lobby (§7.7). The
              // server keeps the roster; we drop the finished game view.
              resetGame();
            }}
          >
            {GAME.playAgain}
          </button>
          <button
            className="btn"
            onClick={() => {
              leaveLobby();
              useStore.getState().resetAll();
              navigate('/');
            }}
          >
            {GAME.backToTables}
          </button>
        </div>
      </div>
    </div>
  );
}
