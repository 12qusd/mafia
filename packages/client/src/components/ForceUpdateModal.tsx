/** force_update reload prompt (BUILD_SPEC §8, §9.2 force_update). */

import { useRef } from 'react';
import { useStore } from '../store/store.js';
import { useModalA11y } from '../lib/useModalA11y.js';

export function ForceUpdateModal() {
  const status = useStore((s) => s.connection);
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = status === 'force_update';
  // Terminal prompt: trap focus on the Refresh button. Escape is a no-op (the
  // player must update to continue).
  useModalA11y(dialogRef, open, { onClose: () => {} });
  if (!open) return null;
  return (
    <div className="overlay">
      <div
        ref={dialogRef}
        className="panel panel-pad modal stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="force-update-title"
      >
        <h2 id="force-update-title">The house has updated</h2>
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
