/**
 * Live countdown hook (BUILD_SPEC §6.2). Renders seconds-remaining from the
 * server `endsAt` deadline corrected by the store's clock-offset estimate. The
 * local wall clock is used only as a ticking source — the *value* is always
 * `endsAt - serverNow`, never a locally-counted timer (§6.2: never trust the
 * client clock for game timing).
 */

import { useEffect, useState } from 'react';
import { useStore } from '../store/store.js';
import { secondsRemaining } from '../lib/clock.js';

export function useCountdown(endsAt: number | null): number {
  const clock = useStore((s) => s.clock);
  const [, force] = useState(0);

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  return secondsRemaining(endsAt, Date.now(), clock);
}
