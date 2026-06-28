/** Transient error/info toasts (BUILD_SPEC §9 error replies, §13). */

import { useEffect } from 'react';
import { strings, RANKED_MIN_GAMES } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { sanitizeInline } from '../lib/sanitize.js';

/**
 * Friendly copy for a few known error `detail` codes the server attaches to a
 * generic `cannot_start` (so a player sees a real sentence, not "(ranked_locked)").
 */
const DETAIL_MESSAGE: Record<string, string> = {
  ranked_locked: `Ranked unlocks after ${RANKED_MIN_GAMES} games — play a few casual rounds first.`,
  cooldown: 'You left a ranked game recently — try again in a few minutes.',
  no_game: 'That table has already broken up.',
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  // Auto-dismiss after a few seconds.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 6000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const base = t.code === 'info' ? '' : strings.ERROR_TEXT[t.code];
        // A known detail code maps to a full friendly sentence (and replaces the
        // generic base); otherwise fall back to "base (detail)" as before.
        const friendly = t.detail ? DETAIL_MESSAGE[t.detail] : undefined;
        const detail = t.detail ? sanitizeInline(t.detail) : '';
        const text = friendly ?? (base && detail ? `${base} (${detail})` : base || detail);
        return (
          <div
            key={t.id}
            className={`toast ${t.code === 'info' ? '' : 'toast-error'}`}
            onClick={() => dismiss(t.id)}
            role="alert"
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}
