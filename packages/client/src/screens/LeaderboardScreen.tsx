/**
 * Leaderboard screen (goal 2). A ranked table of players by reputation, with
 * art-deco podium styling for the top three (brass / silver / bronze). Reads
 * `GET /api/leaderboard`. The signed-in account is highlighted. All
 * server-derived names are sanitized on render.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../store/store.js';
import { DecoHead, TierBadge } from '../components/common.js';
import { LEADERBOARD } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import * as api from '../lib/api.js';
import type { LeaderboardEntry } from '../lib/api.js';

function winRate(won: number, played: number): string {
  if (played <= 0) return '—';
  return `${Math.round((won / played) * 100)}%`;
}

const MEDALS = ['◆', '◆', '◆'];

export function LeaderboardScreen() {
  const me = useStore((s) => s.me);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    void api.fetchLeaderboard(50).then((e) => {
      if (live) setEntries(e);
    });
    return () => {
      live = false;
    };
  }, []);

  const top3 = (entries ?? []).slice(0, 3);
  const rest = (entries ?? []).slice(3);

  return (
    <div className="page stack">
      <div className="hero" style={{ paddingBottom: 8 }}>
        <h1>{LEADERBOARD.heading}</h1>
        <p>{LEADERBOARD.sub}</p>
      </div>

      {entries === null ? (
        <div className="panel panel-pad center" style={{ minHeight: 120 }}>
          <span className="muted">{LEADERBOARD.loading}</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="panel panel-pad center" style={{ minHeight: 120 }}>
          <span className="muted">{LEADERBOARD.empty}</span>
        </div>
      ) : (
        <>
          {top3.length > 0 && (
            <div className="podium">
              {top3.map((e, i) => (
                <div
                  key={e.userId || i}
                  className={`podium-spot podium-${i + 1} ${me && e.userId === me.id ? 'podium-you' : ''}`}
                >
                  <div className="podium-rank" aria-hidden="true">
                    {MEDALS[i]}
                  </div>
                  <div className="podium-place">{i + 1}</div>
                  <div className="podium-name">{sanitizeInline(e.username)}</div>
                  <TierBadge totalPoints={e.totalPoints} size="sm" />
                  <div className="podium-points">
                    {e.totalPoints} {LEADERBOARD.points.toLowerCase()}
                  </div>
                  <div className="faint" style={{ fontSize: '0.85em' }}>
                    {winRate(e.gamesWon, e.gamesPlayed)} · {e.gamesPlayed} {LEADERBOARD.games.toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="panel panel-pad stack">
            <DecoHead>{LEADERBOARD.heading}</DecoHead>
            <table className="reveal-table leaderboard-table">
              <thead>
                <tr>
                  <th>{LEADERBOARD.rank}</th>
                  <th>{LEADERBOARD.player}</th>
                  <th>{LEADERBOARD.points}</th>
                  <th>{LEADERBOARD.games}</th>
                  <th>{LEADERBOARD.winRate}</th>
                </tr>
              </thead>
              <tbody>
                {(rest.length > 0 ? rest : []).map((e, i) => {
                  const rank = i + 4;
                  const isMe = me && e.userId === me.id;
                  return (
                    <tr key={e.userId || rank} className={isMe ? 'lb-you' : ''}>
                      <td className="lb-rank">{rank}</td>
                      <td>
                        {sanitizeInline(e.username)}{' '}
                        {isMe && <span className="badge badge-you">{LEADERBOARD.you}</span>}
                      </td>
                      <td>
                        <TierBadge totalPoints={e.totalPoints} size="sm" /> {e.totalPoints}
                      </td>
                      <td>{e.gamesPlayed}</td>
                      <td>{winRate(e.gamesWon, e.gamesPlayed)}</td>
                    </tr>
                  );
                })}
                {rest.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
