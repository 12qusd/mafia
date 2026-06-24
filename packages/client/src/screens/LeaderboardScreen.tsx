/**
 * Leaderboard screen (goal 2 + ranked play). A ranked table of players with
 * art-deco podium styling for the top three. A Casual / Ranked toggle switches
 * between lifetime REPUTATION (points) and competitive MMR (the ranked ladder).
 * Reads `GET /api/leaderboard` and `GET /api/leaderboard/ranked`. The signed-in
 * account is highlighted; all server-derived names are sanitized on render.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store.js';
import { DecoHead, TierBadge, RankBadge, InlineLoader } from '../components/common.js';
import { LEADERBOARD } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import * as api from '../lib/api.js';
import type { LeaderboardEntry, RankedLeaderboardEntry } from '../lib/api.js';

function winRate(won: number, played: number): string {
  if (played <= 0) return '—';
  return `${Math.round((won / played) * 100)}%`;
}

const MEDALS = ['◆', '◆', '◆'];

type Tab = 'casual' | 'ranked';

export function LeaderboardScreen() {
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState<Tab>('casual');
  const [casual, setCasual] = useState<LeaderboardEntry[] | null>(null);
  const [ranked, setRanked] = useState<RankedLeaderboardEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    if (tab === 'casual' && casual === null) {
      void api.fetchLeaderboard(50).then((e) => {
        if (live) setCasual(e);
      });
    } else if (tab === 'ranked' && ranked === null) {
      void api.fetchRankedLeaderboard(50).then((e) => {
        if (live) setRanked(e);
      });
    }
    return () => {
      live = false;
    };
  }, [tab, casual, ranked]);

  return (
    <div className="page stack">
      <div className="hero" style={{ paddingBottom: 8 }}>
        <h1>{LEADERBOARD.heading}</h1>
        <p>{LEADERBOARD.sub}</p>
      </div>

      <div
        className="lb-tabs"
        role="tablist"
        aria-label={LEADERBOARD.heading}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const next = tab === 'casual' ? 'ranked' : 'casual';
          setTab(next);
          document.getElementById(`lb-tab-${next}`)?.focus();
        }}
      >
        <button
          id="lb-tab-casual"
          role="tab"
          aria-selected={tab === 'casual'}
          aria-controls="lb-tabpanel"
          tabIndex={tab === 'casual' ? 0 : -1}
          className={`btn btn-sm ${tab === 'casual' ? 'btn-primary' : ''}`}
          onClick={() => setTab('casual')}
        >
          {LEADERBOARD.tabCasual}
        </button>
        <button
          id="lb-tab-ranked"
          role="tab"
          aria-selected={tab === 'ranked'}
          aria-controls="lb-tabpanel"
          tabIndex={tab === 'ranked' ? 0 : -1}
          className={`btn btn-sm ${tab === 'ranked' ? 'btn-primary' : ''}`}
          onClick={() => setTab('ranked')}
        >
          {LEADERBOARD.tabRanked}
        </button>
      </div>

      <div id="lb-tabpanel" role="tabpanel" aria-labelledby={`lb-tab-${tab}`}>
        {tab === 'casual' ? (
          <CasualBoard entries={casual} me={me} />
        ) : (
          <RankedBoard entries={ranked} me={me} />
        )}
      </div>
    </div>
  );
}

function CasualBoard({
  entries,
  me,
}: {
  entries: LeaderboardEntry[] | null;
  me: { id: string } | null;
}) {
  if (entries === null) {
    return (
      <div className="panel panel-pad center" style={{ minHeight: 120 }}>
        <InlineLoader label={LEADERBOARD.loading} />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="panel panel-pad center" style={{ minHeight: 120 }}>
        <span className="muted">{LEADERBOARD.empty}</span>
      </div>
    );
  }
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
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
              <Link className="podium-name lb-link" to={`/u/${encodeURIComponent(e.username)}`}>
                {sanitizeInline(e.username)}
              </Link>
              <TierBadge totalPoints={e.totalPoints} size="sm" />
              <div className="podium-points">
                {e.totalPoints} {LEADERBOARD.points.toLowerCase()}
              </div>
              <div className="faint" style={{ fontSize: '0.85em' }}>
                {winRate(e.gamesWon, e.gamesPlayed)} · {e.gamesPlayed}{' '}
                {LEADERBOARD.games.toLowerCase()}
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
            {rest.map((e, i) => {
              const rank = i + 4;
              const isMe = me && e.userId === me.id;
              return (
                <tr key={e.userId || rank} className={isMe ? 'lb-you' : ''}>
                  <td className="lb-rank">{rank}</td>
                  <td>
                    <Link className="lb-link" to={`/u/${encodeURIComponent(e.username)}`}>
                      {sanitizeInline(e.username)}
                    </Link>{' '}
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
  );
}

function RankedBoard({
  entries,
  me,
}: {
  entries: RankedLeaderboardEntry[] | null;
  me: { id: string } | null;
}) {
  if (entries === null) {
    return (
      <div className="panel panel-pad center" style={{ minHeight: 120 }}>
        <InlineLoader label={LEADERBOARD.loading} />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="panel panel-pad center" style={{ minHeight: 120 }}>
        <span className="muted">{LEADERBOARD.rankedEmpty}</span>
      </div>
    );
  }
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
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
              <Link className="podium-name lb-link" to={`/u/${encodeURIComponent(e.username)}`}>
                {sanitizeInline(e.username)}
              </Link>
              <RankBadge rankKey={e.rank} rankName={e.rankName} size="sm" />
              <div className="podium-points">
                {e.mmr} {LEADERBOARD.mmr}
              </div>
              <div className="faint" style={{ fontSize: '0.85em' }}>
                {winRate(e.gamesWon, e.gamesPlayed)} · {e.gamesPlayed}{' '}
                {LEADERBOARD.games.toLowerCase()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel panel-pad stack">
        <DecoHead>{LEADERBOARD.tabRanked}</DecoHead>
        <table className="reveal-table leaderboard-table">
          <thead>
            <tr>
              <th>{LEADERBOARD.rank}</th>
              <th>{LEADERBOARD.player}</th>
              <th>{LEADERBOARD.standing}</th>
              <th>{LEADERBOARD.mmr}</th>
              <th>{LEADERBOARD.winRate}</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((e, i) => {
              const rank = i + 4;
              const isMe = me && e.userId === me.id;
              return (
                <tr key={e.userId || rank} className={isMe ? 'lb-you' : ''}>
                  <td className="lb-rank">{rank}</td>
                  <td>
                    <Link className="lb-link" to={`/u/${encodeURIComponent(e.username)}`}>
                      {sanitizeInline(e.username)}
                    </Link>{' '}
                    {isMe && <span className="badge badge-you">{LEADERBOARD.you}</span>}
                  </td>
                  <td>
                    <RankBadge rankKey={e.rank} rankName={e.rankName} size="sm" />
                  </td>
                  <td>{e.mmr}</td>
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
  );
}
