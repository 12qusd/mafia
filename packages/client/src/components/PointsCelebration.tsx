/**
 * Game-over points celebration (goal 3). When a `points_awarded` frame arrives
 * for the current match, this renders an animated breakdown: each award line
 * staggers in, the total counts up, and any newly-unlocked achievements get a
 * celebratory reveal. All motion respects `prefers-reduced-motion` — in that
 * case lines appear immediately and the total shows its final value at once.
 *
 * Reads only the server-sent breakdown from the store. Labels are original copy
 * from shared (already safe), but we sanitize defensively all the same.
 */

import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS_BY_KEY, tierForPoints } from '@nocturne/shared';
import type { PointsAwardState } from '../store/types.js';
import { DecoHead, TierBadge } from './common.js';
import { POINTS } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';

/** Whether the user prefers reduced motion (read once at mount). */
function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Count-up hook that snaps to the final value under reduced-motion. */
function useCountUp(target: number, reduced: boolean, durationMs = 900): number {
  const [value, setValue] = useState(reduced ? target : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic for a tasteful settle.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, reduced, durationMs]);

  return value;
}

export function PointsCelebration({ award }: { award: PointsAwardState }) {
  const reduced = prefersReducedMotion();
  const total = useCountUp(award.breakdown.total, reduced);
  const { breakdown, newAchievements, stats } = award;

  // Did this award push the player into a new tier? (best-effort, cosmetic).
  const newTier = tierForPoints(stats.totalPoints);
  const prevTier = tierForPoints(Math.max(0, stats.totalPoints - breakdown.total));
  const tieredUp = newTier.key !== prevTier.key;

  return (
    <div className={`points-cele ${reduced ? 'no-motion' : ''}`}>
      <DecoHead>{POINTS.heading}</DecoHead>

      <ul className="points-list">
        {breakdown.awards.map((a, i) => (
          <li
            key={`${a.code}-${a.detail ?? i}`}
            className="points-line"
            style={reduced ? undefined : { animationDelay: `${i * 110}ms` }}
          >
            <span className="points-label">{sanitizeInline(a.label)}</span>
            <span className={`points-pts ${a.points < 0 ? 'neg' : ''}`}>
              {a.points >= 0 ? '+' : ''}
              {a.points}
            </span>
          </li>
        ))}
      </ul>

      <div className="points-total-row">
        <span className="points-total-label">{POINTS.total}</span>
        <span className="points-total">{total}</span>
      </div>

      <div className="points-tier-row">
        <TierBadge totalPoints={stats.totalPoints} />
        {tieredUp && <span className="points-tierup">{POINTS.tierUp(newTier.name)}</span>}
      </div>

      {newAchievements.length > 0 && (
        <div className="points-achv">
          <div className="faint" style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {POINTS.newAchievements}
          </div>
          <div className="achv-reveal-grid">
            {newAchievements.map((key, i) => {
              const def = ACHIEVEMENTS_BY_KEY[key];
              return (
                <div
                  key={key}
                  className="achv-reveal"
                  style={reduced ? undefined : { animationDelay: `${600 + i * 160}ms` }}
                >
                  <span className="achv-medal" aria-hidden="true">
                    ★
                  </span>
                  <span className="achv-name">{sanitizeInline(def?.name ?? key)}</span>
                  {def && <span className="achv-pts">+{def.points}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
