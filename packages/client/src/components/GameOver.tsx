/**
 * Game-over screen (BUILD_SPEC §13.1): winners, full role-reveal table, personal
 * result, seed, and a "play again" button (keeps the crowd together, §7.7).
 */

import { useEffect, useRef, useState } from 'react';
import { getRole } from '@nocturne/shared';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead, FactionTag, RankBadge } from './common.js';
import { PointsCelebration } from './PointsCelebration.js';
import { GAME, WINNER_LABEL, OUTCOME_LABEL, POINTS, SHARE } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { copyReplayLink } from '../lib/social.js';
import { useModalA11y } from '../lib/useModalA11y.js';
import { leaveLobby, playAgain, quickPlay } from '../ws/actions.js';

// Stable empty reference (avoids the Zustand v5 fresh-array selector loop, #185).
const NO_SEATS: readonly never[] = [];

/** Grace window before "play again" falls back to Quick Play (§7.7). */
const REMATCH_FALLBACK_MS = 4000;

export function GameOver() {
  const navigate = useNavigate();
  const over = useStore((s) => s.gameOver);
  const seats = useStore((s) => s.game?.seats ?? NO_SEATS);
  const ownSeat = useStore((s) => s.own?.seat ?? null);
  const pointsAward = useStore((s) => s.pointsAward);
  const pushInfo = useStore((s) => s.pushInfo);
  // "Play again" pending state: once clicked we wait for the rematch lobby_state
  // (the screen routes away via useLobbyNav). If the server says 'no_game' or no
  // lobby appears within the grace window, we fall back to Quick Play (§7.7).
  const [rematching, setRematching] = useState(false);
  const fellBack = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Trap focus within the terminal game-over modal. It is not Escape-dismissable
  // (the player chooses Play Again / Leave), so onClose is a no-op.
  useModalA11y(dialogRef, !!over, { onClose: () => {} });

  useEffect(() => {
    if (!rematching) return;
    fellBack.current = false;
    const fallback = (): void => {
      if (fellBack.current) return;
      fellBack.current = true;
      quickPlay();
    };
    // 1) Explicit server signal: a 'no_game' error (detail) ⇒ fall back now.
    const unsub = useStore.subscribe((s, prev) => {
      if (s.toasts === prev.toasts) return;
      const fresh = s.toasts[s.toasts.length - 1];
      if (fresh && fresh.code === 'cannot_start' && fresh.detail === 'no_game') fallback();
    });
    // 2) Belt-and-suspenders: no rematch lobby after the grace window ⇒ fall back.
    const t = setTimeout(fallback, REMATCH_FALLBACK_MS);
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [rematching]);

  if (!over) return null;

  // Surface the points celebration only when it belongs to THIS match (a stale
  // award from a previous game must never bleed into the new game-over).
  const award = pointsAward && pointsAward.matchId === over.matchId ? pointsAward : null;

  const nameFor = (seat: number) =>
    sanitizeInline(seats.find((s) => s.seat === seat)?.name ?? `#${seat + 1}`);
  const mine = over.allRoles.find((r) => r.seat === ownSeat);

  return (
    <div className="overlay">
      <div
        ref={dialogRef}
        className="panel panel-pad modal stack gameover-modal"
        style={{ maxWidth: 680 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gameover-title"
      >
        <div className="win-result" id="gameover-title">
          {GAME.gameOver}
        </div>
        <div className="stack" style={{ alignItems: 'center' }}>
          {over.winners.map((w) => (
            <div key={w} className="win-loss win" style={{ fontFamily: 'var(--font-display)' }}>
              {WINNER_LABEL[w]}
            </div>
          ))}
        </div>

        {mine && (
          <div className={`win-loss ${mine.outcome === 'win' ? 'win' : 'loss'}`}>
            {GAME.yourResult}: {OUTCOME_LABEL[mine.outcome]} — you were the{' '}
            {getRole(mine.role).name}
          </div>
        )}

        {award && award.rankedDelta !== null && award.stats.ranked && (
          <div className="ranked-delta-row">
            <DecoHead>{POINTS.rankedHeading}</DecoHead>
            <div className="ranked-delta">
              <span className={`ranked-delta-val ${award.rankedDelta >= 0 ? 'up' : 'down'}`}>
                {POINTS.rankedDelta(award.rankedDelta)}
              </span>
              <RankBadge
                rankKey={award.stats.ranked.rank}
                rankName={award.stats.ranked.rankName}
                size="sm"
              />
              <span className="faint">
                {POINTS.rankedTo(award.stats.ranked.rankName, award.stats.ranked.mmr)}
              </span>
            </div>
          </div>
        )}

        {award && <PointsCelebration award={award} />}

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
                <tr
                  key={r.seat}
                  style={r.seat === ownSeat ? { color: 'var(--c-amber)' } : undefined}
                >
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
          {over.matchId && (
            <span className="row" style={{ gap: 12 }}>
              <button
                type="button"
                className="linkbtn"
                title={SHARE.title}
                onClick={() => {
                  void copyReplayLink(over.matchId!).then((ok) =>
                    pushInfo(ok ? SHARE.copied : SHARE.failed),
                  );
                }}
              >
                {SHARE.button}
              </button>
              <Link className="linkbtn" to={`/replay/${encodeURIComponent(over.matchId)}`}>
                {POINTS.viewReplay}
              </Link>
            </span>
          )}
        </div>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary grow"
            onClick={() => {
              leaveLobby();
              navigate('/');
              quickPlay();
            }}
          >
            Quick Play again
          </button>
          <button
            className="btn grow"
            disabled={rematching}
            onClick={() => {
              // "Play again" reconvenes the crowd in a fresh lobby (§7.7). The
              // FIRST clicker creates the rematch lobby (becomes host); others
              // join it. The rematch `lobby_state` clears the game view and
              // routes us to the lobby. A 'no_game' reply or a quiet grace
              // window falls back to Quick Play (see the effect above).
              setRematching(true);
              playAgain();
            }}
          >
            {rematching ? GAME.playAgainPending : GAME.playAgain}
          </button>
          <button
            className="btn"
            onClick={() => {
              leaveLobby();
              // Keep the authenticated socket ready for the next game.
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
