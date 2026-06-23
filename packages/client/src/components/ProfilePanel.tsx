/**
 * Account dashboard / profile card (goal 1). Rendered on the HomeScreen for a
 * signed-in registered account: name, tier badge, reputation/points, games &
 * win-rate, and an achievements showcase (unlocked vs locked). Guests instead
 * see a prompt to open an account.
 *
 * Reads only server-sourced data from the store (`me`) plus the achievements
 * catalog from `/api/achievements`. All server-derived text is sanitized.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACHIEVEMENTS_BY_KEY } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead, TierBadge, RankBadge } from './common.js';
import { PROFILE } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import * as api from '../lib/api.js';
import type { AchievementCatalogEntry } from '../lib/api.js';

function winRate(won: number, played: number): string {
  if (played <= 0) return '—';
  return `${Math.round((won / played) * 100)}%`;
}

export function ProfilePanel() {
  const me = useStore((s) => s.me);
  const [catalog, setCatalog] = useState<AchievementCatalogEntry[]>([]);

  useEffect(() => {
    let live = true;
    void api.fetchAchievements().then((a) => {
      if (live) setCatalog(a);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!me) return null;

  // Guests: prompt to register (no stats kept).
  if (me.isGuest) {
    return (
      <div className="panel panel-pad stack profile-card">
        <DecoHead>{PROFILE.guestHeading}</DecoHead>
        <p className="muted">{PROFILE.guestPrompt}</p>
      </div>
    );
  }

  const stats = me.stats;
  const unlocked = new Set(stats?.achievements ?? []);

  // Order the showcase: catalog order, unlocked first then locked.
  const ordered = [...catalog].sort((a, b) => {
    const ua = unlocked.has(a.key) ? 0 : 1;
    const ub = unlocked.has(b.key) ? 0 : 1;
    return ua - ub;
  });

  return (
    <div className="panel panel-pad stack profile-card">
      <DecoHead>{PROFILE.heading}</DecoHead>

      <div className="profile-head">
        <div className="profile-name">{sanitizeInline(me.name)}</div>
        <div className="profile-badges">
          <TierBadge totalPoints={stats?.totalPoints ?? 0} />
          {stats?.ranked && (
            <RankBadge
              rankKey={stats.ranked.rank}
              rankName={stats.ranked.rankName}
              mmr={stats.ranked.mmr}
            />
          )}
        </div>
      </div>

      {stats ? (
        <>
          <div className="profile-stats">
            <Stat
              label={PROFILE.totalPoints}
              value={`${stats.totalPoints} ${PROFILE.points}`}
              hero
            />
            <Stat label={PROFILE.gamesPlayed} value={String(stats.gamesPlayed)} />
            <Stat label={PROFILE.gamesWon} value={String(stats.gamesWon)} />
            <Stat label={PROFILE.winRate} value={winRate(stats.gamesWon, stats.gamesPlayed)} />
            <Stat label={PROFILE.survived} value={String(stats.gamesSurvived)} />
            {stats.ranked && (
              <>
                <Stat label={PROFILE.mmrLabel} value={String(stats.ranked.mmr)} />
                <Stat label={PROFILE.rankLabel} value={stats.ranked.rankName} />
              </>
            )}
          </div>

          <div className="spread">
            <DecoHead>{PROFILE.achievements}</DecoHead>
          </div>
          <div className="faint" style={{ marginTop: -6 }}>
            {PROFILE.achievementsUnlocked(unlocked.size, catalog.length || unlocked.size)}
          </div>
          <div className="achv-grid">
            {ordered.map((a) => {
              const have = unlocked.has(a.key);
              const def = ACHIEVEMENTS_BY_KEY[a.key];
              return (
                <div key={a.key} className={`achv ${have ? 'achv-on' : 'achv-off'}`}>
                  <div className="achv-row">
                    <span className="achv-medal" aria-hidden="true">
                      {have ? '★' : '☆'}
                    </span>
                    <span className="achv-name">{sanitizeInline(def?.name ?? a.name)}</span>
                    <span className="achv-pts">{def?.points ?? a.points}</span>
                  </div>
                  <div className="achv-desc">
                    {have ? sanitizeInline(def?.description ?? a.description) : PROFILE.locked}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row">
            <Link className="btn btn-sm" to="/leaderboard">
              {PROFILE.viewLeaderboard}
            </Link>
          </div>
        </>
      ) : (
        <p className="muted">{PROFILE.noStats}</p>
      )}
    </div>
  );
}

function Stat({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className={`profile-stat ${hero ? 'profile-stat-hero' : ''}`}>
      <div className="profile-stat-val">{value}</div>
      <div className="profile-stat-label">{label}</div>
    </div>
  );
}
