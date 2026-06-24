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
import { Avatar } from '../components/Avatar.js';
import { LEADERBOARD } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import * as api from '../lib/api.js';
import type {
  LeaderboardEntry,
  RankedLeaderboardEntry,
  RankedLeaderboardPage,
  SeasonInfo,
  MyRank,
} from '../lib/api.js';

function winRate(won: number, played: number): string {
  if (played <= 0) return '—';
  return `${Math.round((won / played) * 100)}%`;
}

const MEDALS = ['◆', '◆', '◆'];
const RANKED_PAGE_SIZE = 25;

type Tab = 'casual' | 'ranked';

export function LeaderboardScreen() {
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState<Tab>('casual');
  const [casual, setCasual] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    if (tab === 'casual' && casual === null) {
      void api.fetchLeaderboard(50).then((e) => {
        if (live) setCasual(e);
      });
    }
    return () => {
      live = false;
    };
  }, [tab, casual]);

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
        {tab === 'casual' ? <CasualBoard entries={casual} me={me} /> : <RankedBoard me={me} />}
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
              <Avatar id={e.userId} name={e.username} size="md" />
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
                    <span className="lb-player">
                      <Avatar id={e.userId} name={e.username} size="sm" />
                      <Link className="lb-link" to={`/u/${encodeURIComponent(e.username)}`}>
                        {sanitizeInline(e.username)}
                      </Link>
                    </span>{' '}
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

function rankedRow(e: RankedLeaderboardEntry) {
  return e.placements ? (
    <RankBadge placements={e.placements} size="sm" />
  ) : (
    <RankBadge rankKey={e.rank} rankName={e.rankName} size="sm" />
  );
}

function RankedBoard({ me }: { me: { id: string } | null }) {
  const [seasons, setSeasons] = useState<SeasonInfo[] | null>(null);
  const [seasonId, setSeasonId] = useState<string>(''); // '' ⇒ current
  const [page, setPage] = useState(0);
  const [data, setData] = useState<RankedLeaderboardPage | null>(null);
  const [myRank, setMyRank] = useState<MyRank | null | undefined>(undefined);

  // Season archive for the filter dropdown (once).
  useEffect(() => {
    let live = true;
    void api.fetchSeasons().then((s) => {
      if (live) setSeasons(s);
    });
    return () => {
      live = false;
    };
  }, []);

  // The signed-in account's own rank (current season only).
  useEffect(() => {
    if (!me) {
      setMyRank(null);
      return;
    }
    let live = true;
    void api.fetchMyRank().then((r) => {
      if (live) setMyRank(r);
    });
    return () => {
      live = false;
    };
  }, [me]);

  // The current page of the board for the selected season.
  useEffect(() => {
    let live = true;
    setData(null);
    void api
      .fetchRankedLeaderboard({
        page,
        limit: RANKED_PAGE_SIZE,
        ...(seasonId ? { seasonId } : {}),
      })
      .then((d) => {
        if (live) setData(d);
      });
    return () => {
      live = false;
    };
  }, [page, seasonId]);

  const onSeasonChange = (id: string) => {
    setSeasonId(id);
    setPage(0);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.limit || RANKED_PAGE_SIZE))) : 1;
  const viewingCurrent = seasonId === '' || seasons?.find((s) => s.id === seasonId)?.isCurrent;

  return (
    <div className="stack">
      <div className="lb-ranked-controls">
        {seasons && seasons.length > 0 && (
          <label className="lb-season-filter">
            {LEADERBOARD.season}:{' '}
            <select
              className="select"
              value={seasonId}
              onChange={(e) => onSeasonChange(e.target.value)}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.isCurrent ? '' : s.id}>
                  {sanitizeInline(s.name)}
                  {s.isCurrent ? ' ★' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* Own rank line — only meaningful for the current season. */}
        {me && viewingCurrent && myRank !== undefined && (
          <div className="lb-your-rank faint">
            {myRank === null ? (
              <span>{LEADERBOARD.yourRankUnplaced}</span>
            ) : myRank.placements ? (
              <span>
                {LEADERBOARD.yourRank}: <RankBadge placements={myRank.placements} size="sm" />
              </span>
            ) : (
              <span>
                {LEADERBOARD.yourRank}: <strong>#{myRank.position}</strong>{' '}
                <RankBadge rankKey={myRank.rank} rankName={myRank.rankName} size="sm" /> · {myRank.mmr}{' '}
                {LEADERBOARD.mmr}
              </span>
            )}
          </div>
        )}
      </div>

      {data === null ? (
        <div className="panel panel-pad center" style={{ minHeight: 120 }}>
          <InlineLoader label={LEADERBOARD.loading} />
        </div>
      ) : data.entries.length === 0 ? (
        <div className="panel panel-pad center" style={{ minHeight: 120 }}>
          <span className="muted">{LEADERBOARD.rankedEmpty}</span>
        </div>
      ) : (
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
              {data.entries.map((e) => {
                const isMe = me && e.userId === me.id;
                return (
                  <tr key={e.userId || e.position} className={isMe ? 'lb-you' : ''}>
                    <td className="lb-rank">{e.position}</td>
                    <td>
                      <span className="lb-player">
                        <Avatar id={e.userId} name={e.username} size="sm" />
                        <Link className="lb-link" to={`/u/${encodeURIComponent(e.username)}`}>
                          {sanitizeInline(e.username)}
                        </Link>
                      </span>{' '}
                      {isMe && <span className="badge badge-you">{LEADERBOARD.you}</span>}
                    </td>
                    <td>{rankedRow(e)}</td>
                    <td>{e.mmr}</td>
                    <td>{winRate(e.gamesWon, e.gamesPlayed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="lb-pager">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {LEADERBOARD.prev}
              </button>
              <span className="faint">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {LEADERBOARD.next}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
