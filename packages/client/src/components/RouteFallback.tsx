/**
 * Suspense fallback for lazily-loaded routes (perf code-splitting).
 *
 * A small, on-aesthetic noir spinner shown while a route chunk is fetched. It is
 * marked `aria-busy` and carries a polite live message so a screen reader knows
 * the page is loading rather than empty.
 */

import { UI_A11Y } from '../lib/strings-extra.js';

export function RouteFallback() {
  return (
    <div className="route-loading" role="status" aria-busy="true" aria-live="polite">
      <div className="noir-spinner" aria-hidden="true" />
      <span className="faint route-loading-text">{UI_A11Y.loading}</span>
    </div>
  );
}
