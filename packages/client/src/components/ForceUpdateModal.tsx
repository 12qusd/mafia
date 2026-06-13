/** force_update reload prompt (BUILD_SPEC §8, §9.2 force_update). */

import { useStore } from '../store/store.js';

export function ForceUpdateModal() {
  const status = useStore((s) => s.connection);
  if (status !== 'force_update') return null;
  return (
    <div className="overlay">
      <div className="panel panel-pad modal stack">
        <h2>The house has updated</h2>
        <p className="muted">
          A newer version of the game is required to keep playing. Refresh to continue.
        </p>
        <button className="btn btn-primary" onClick={() => globalThis.location.reload()}>
          Refresh
        </button>
      </div>
    </div>
  );
}
