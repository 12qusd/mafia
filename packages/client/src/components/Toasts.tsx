/** Transient error/info toasts (BUILD_SPEC §9 error replies, §13). */

import { useEffect } from 'react';
import { strings } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { sanitizeInline } from '../lib/sanitize.js';

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
        const detail = t.detail ? sanitizeInline(t.detail) : '';
        const text = base && detail ? `${base} (${detail})` : base || detail;
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
