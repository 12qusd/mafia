/**
 * RankUpToast (notifications center, QoL wave) — the post-match rank-up
 * celebration. When a `points_awarded` frame carries a ranked standing whose
 * rung is HIGHER than the one the player held going in, a tasteful noir
 * announcement rises ("You ascend to <Rank>"), reusing the RankBadge.
 *
 * The rank-up is detected entirely client-side from fields the frame already
 * carries (no game WS protocol change): `mmrBefore = stats.ranked.mmr −
 * rankedDelta`, and a climb is `rankForMmr(after).index > rankForMmr(before)`.
 * Only a strictly-higher rung shows — never a placement/sideways/down move.
 *
 * Respects `prefers-reduced-motion` (the entrance animation is dropped). Auto-
 * dismisses; click to dismiss early.
 */

import { useEffect, useState } from 'react';
import { rankForMmr } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { RankBadge } from './common.js';
import { NOTIFICATIONS } from '../lib/strings-extra.js';
import { useMediaQuery } from './useMediaQuery.js';

/** How long the celebration lingers before auto-dismissing. */
const LINGER_MS = 7000;

export function RankUpToast() {
  const award = useStore((s) => s.pointsAward);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [shown, setShown] = useState<{ rankKey: string; rankName: string; mmr: number } | null>(
    null,
  );

  useEffect(() => {
    const ranked = award?.stats.ranked;
    // Ranked games only, and only when we can establish the before/after rung.
    if (!ranked || award?.rankedDelta === null || award?.rankedDelta === undefined) {
      return;
    }
    const mmrAfter = ranked.mmr;
    const mmrBefore = mmrAfter - award.rankedDelta;
    const before = rankForMmr(mmrBefore);
    const after = rankForMmr(mmrAfter);
    if (after.index > before.index) {
      // The server already computed the post-match rank key/name on the frame —
      // prefer those over re-deriving so the badge matches the dossier exactly.
      setShown({ rankKey: ranked.rank, rankName: ranked.rankName, mmr: mmrAfter });
    }
  }, [award]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), LINGER_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      className={`rankup-toast ${reduceMotion ? 'rankup-still' : 'rankup-rise'}`}
      role="status"
      aria-live="polite"
      onClick={() => setShown(null)}
    >
      <div className="rankup-title">{NOTIFICATIONS.ascendTitle}</div>
      <div className="rankup-badge-row">
        <RankBadge rankKey={shown.rankKey} rankName={shown.rankName} mmr={shown.mmr} />
      </div>
      <div className="rankup-sub">{NOTIFICATIONS.ascend(shown.rankName)}</div>
    </div>
  );
}
