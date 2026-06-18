/**
 * In-game ADMIN god-powers panel (goal 8). Rendered ONLY when `GET /api/me`
 * reported `isAdmin`. Distinct from the test-mode DirectorPanel: this is the
 * "House" — a discreet but unmistakable blood-accented control that lets an
 * admin target a seat and Kill / Stump / Grant / Revoke points / Temp-ban, or
 * Force the phase. Destructive actions (kill, ban) require confirmation.
 *
 * Every action is sent via the `admin_action` ws builder; the server enforces
 * `identity.isAdmin` and logs each action, rejecting non-admins with an `error`
 * toast. Stumped seats are marked publicly via `seat_transform` → the store.
 */

import { useState } from 'react';
import type { PublicSeat } from '@nocturne/shared';
import { ADMIN } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import { adminAction } from '../ws/actions.js';

const HOUR_MS = 60 * 60 * 1000;

export function AdminPanel({ seats }: { seats: PublicSeat[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [points, setPoints] = useState(50);
  const [banHours, setBanHours] = useState(24);
  const [reason, setReason] = useState('');

  const targetLabel =
    target !== null
      ? sanitizeInline(seats.find((s) => s.seat === target)?.name ?? `#${target + 1}`)
      : ADMIN.noTarget;
  const hasTarget = target !== null;

  function confirmAnd(message: string, run: () => void) {
    if (globalThis.confirm?.(message) ?? true) run();
  }

  return (
    <section className="admin-panel panel" aria-label={ADMIN.title}>
      <header className="admin-head">
        <span className="badge admin-badge">{ADMIN.title}</span>
        <span className="muted">{ADMIN.subtitle}</span>
        <button
          className="btn btn-sm admin-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? ADMIN.expand : ADMIN.collapse}
        </button>
      </header>

      {!collapsed && (
        <div className="admin-body stack">
          <div>
            <label>{ADMIN.target}</label>
            <select
              value={target === null ? '' : String(target)}
              onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{ADMIN.noTarget}</option>
              {seats.map((s) => (
                <option key={s.seat} value={s.seat}>
                  #{s.seat + 1} · {sanitizeInline(s.name)}
                  {s.alive ? '' : ' (dead)'}
                </option>
              ))}
            </select>
          </div>

          {/* Targeted actions. */}
          <div className="row admin-actions">
            <button
              className="btn btn-sm btn-danger"
              disabled={!hasTarget}
              onClick={() =>
                confirmAnd(ADMIN.confirmKill(targetLabel), () =>
                  adminAction({ action: 'kill', targetSeat: target! }),
                )
              }
            >
              {ADMIN.kill}
            </button>
            <button
              className="btn btn-sm"
              disabled={!hasTarget}
              onClick={() => adminAction({ action: 'stump', targetSeat: target! })}
            >
              {ADMIN.stump}
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={!hasTarget}
              onClick={() =>
                confirmAnd(ADMIN.confirmBan(targetLabel), () =>
                  adminAction({
                    action: 'temp_ban',
                    targetSeat: target!,
                    durationMs: Math.max(0, banHours) * HOUR_MS,
                    ...(reason.trim() ? { reason: sanitizeInline(reason) } : {}),
                  }),
                )
              }
            >
              {ADMIN.tempBan}
            </button>
          </div>

          {/* Points. */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ width: 110 }}>
              <label>{ADMIN.pointsLabel}</label>
              <input
                type="number"
                min={0}
                max={100000}
                value={points}
                onChange={(e) => setPoints(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))}
              />
            </div>
            <button
              className="btn btn-sm"
              disabled={!hasTarget}
              onClick={() => adminAction({ action: 'grant_points', targetSeat: target!, points })}
            >
              {ADMIN.grant}
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={!hasTarget}
              onClick={() => adminAction({ action: 'revoke_points', targetSeat: target!, points })}
            >
              {ADMIN.revoke}
            </button>
          </div>

          {/* Ban duration + reason. */}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ width: 110 }}>
              <label>{ADMIN.durationLabel}</label>
              <input
                type="number"
                min={1}
                max={720}
                value={banHours}
                onChange={(e) => setBanHours(Math.max(1, Math.min(720, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="grow">
              <label>{ADMIN.reasonLabel}</label>
              <input
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          {/* Untargeted action. */}
          <div className="row">
            <button className="btn btn-sm" onClick={() => adminAction({ action: 'force_phase' })}>
              {ADMIN.forcePhase}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
