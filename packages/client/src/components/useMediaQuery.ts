/**
 * Tiny `matchMedia` hook for presentational, mobile-only behavior. SSR/jsdom
 * safe: when `matchMedia` is unavailable (or the query never matches, as in the
 * test environment) it simply returns `false`, so the desktop DOM is the
 * default and existing tests/snapshots are unaffected.
 *
 * VISUAL ONLY — this never changes game logic, store wiring, or protocol; it
 * only lets a component pick a mobile presentation under a breakpoint.
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const get = () => globalThis.matchMedia?.(query).matches ?? false;
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    onChange();
    // addEventListener is the modern API; guard for older Safari (addListener).
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

/** Shared breakpoint: the in-game layout flips to the single-pane mobile tabs. */
export const MOBILE_GAME_QUERY = '(max-width: 820px)';
