/**
 * Role-preferences screen (point-unlocked, goal 3).
 *
 * Lists every role grouped by faction (reusing the glossary's ALL_ROLES data +
 * FactionTag). Each role has a three-state control — Neutral / Blacklist /
 * Prefer — where BLACKLIST is enabled only once `canBlacklistRoles` and PREFER
 * only once `canPreferRoles` (both gated server-side too; the client gate is
 * convenience). Locked tiers show a clear "X reputation to unlock" hint from the
 * server's `unlocks.nextUnlock`.
 *
 * The deal is a WEIGHTED bias, not a guarantee — stated up front. Reads
 * `GET /api/me/preferences`, writes `POST /api/preferences`. Server-data-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ALL_ROLES, FACTIONS, UNLOCKS, type Faction } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead, FactionTag } from '../components/common.js';
import { PREFERENCES } from '../lib/strings-extra.js';
import * as api from '../lib/api.js';
import type { PreferenceUnlocks } from '../lib/api.js';

/** Faction grouping order (Town first, neutrals last) — same as the glossary. */
const FACTION_ORDER: readonly Faction[] = [
  'TOWN',
  'MAFIA',
  'TRIAD',
  'VAMPIRE',
  'CULT',
  'NEUTRAL_KILLING',
  'NEUTRAL_BENIGN',
];
const ORDERED_FACTIONS: readonly Faction[] = [
  ...FACTION_ORDER,
  ...FACTIONS.filter((f) => !FACTION_ORDER.includes(f)),
];

type PrefState = 'none' | 'blacklist' | 'prefer';

const LOCKED_UNLOCKS: PreferenceUnlocks = {
  canBlacklistRoles: false,
  canPreferRoles: false,
  nextUnlock: null,
};

export function PreferencesScreen() {
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const [unlocks, setUnlocks] = useState<PreferenceUnlocks>(LOCKED_UNLOCKS);
  const [prefs, setPrefs] = useState<Record<string, PrefState>>({});
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  const isAccount = !!me && !me.isGuest;

  useEffect(() => {
    if (!isAccount) {
      setLoading(false);
      return;
    }
    let live = true;
    void api.fetchPreferences().then((res) => {
      if (!live) return;
      setUnlocks(res.unlocks);
      const map: Record<string, PrefState> = {};
      for (const p of res.preferences) map[p.role] = p.preference;
      setPrefs(map);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [isAccount]);

  // Group the roles by faction (display order), dropping empty factions.
  const groups = useMemo(
    () =>
      ORDERED_FACTIONS.map((faction) => ({
        faction,
        roles: ALL_ROLES.filter((r) => r.faction === faction),
      })).filter((g) => g.roles.length > 0),
    [],
  );

  async function choose(role: string, next: PrefState): Promise<void> {
    const current = prefs[role] ?? 'none';
    if (current === next) return;
    // Gate client-side (server re-checks): block locked tiers.
    if (next === 'blacklist' && !unlocks.canBlacklistRoles) return;
    if (next === 'prefer' && !unlocks.canPreferRoles) return;

    setPendingRole(role);
    // Optimistic update; revert on failure.
    setPrefs((p) => ({ ...p, [role]: next }));
    const wire = next === 'none' ? null : next;
    const res = await api.setPreference(role, wire);
    setPendingRole(null);
    if (res.ok) {
      setNote(
        next === 'blacklist'
          ? PREFERENCES.savedBlacklist
          : next === 'prefer'
            ? PREFERENCES.savedPrefer
            : PREFERENCES.savedCleared,
      );
    } else {
      // Revert.
      setPrefs((p) => ({ ...p, [role]: current }));
      setNote(res.ok === false && res.locked ? PREFERENCES.saveFailedLocked : PREFERENCES.saveFailed);
    }
  }

  if (!isAccount) {
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <div className="spread">
          <h1 style={{ margin: 0 }}>{PREFERENCES.heading}</h1>
          <button className="btn" onClick={() => navigate(-1)}>
            {PREFERENCES.back}
          </button>
        </div>
        <div className="panel panel-pad stack">
          <p className="muted">{PREFERENCES.signInRequired}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page stack" style={{ maxWidth: 720 }}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h1 style={{ margin: 0 }}>{PREFERENCES.heading}</h1>
          <span className="faint">{PREFERENCES.sub}</span>
        </div>
        <button className="btn" onClick={() => navigate(-1)}>
          {PREFERENCES.back}
        </button>
      </div>

      <div className="panel panel-pad stack">
        <p className="faint" style={{ margin: 0 }}>
          {PREFERENCES.disclaimer}
        </p>
        <UnlockHints unlocks={unlocks} />
      </div>

      {note && (
        <div className="panel panel-pad" role="status" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <span className="muted">{note}</span>
        </div>
      )}

      {loading ? (
        <div className="panel panel-pad">
          <p className="muted">{PREFERENCES.loading}</p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.faction} className="panel panel-pad stack">
            <DecoHead>
              <FactionTag faction={group.faction} />
            </DecoHead>
            <div className="stack" style={{ gap: 8 }}>
              {group.roles.map((def) => (
                <div className="spread pref-row" key={def.id}>
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="role-name">{def.name}</span>
                    <span className="faint" style={{ fontSize: '0.85em' }}>
                      {def.tagline}
                    </span>
                  </div>
                  <PrefControl
                    state={prefs[def.id] ?? 'none'}
                    unlocks={unlocks}
                    disabled={pendingRole === def.id}
                    onChange={(next) => void choose(def.id, next)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** The "X reputation to unlock" progress hints (from unlocks.nextUnlock). */
function UnlockHints({ unlocks }: { unlocks: PreferenceUnlocks }) {
  return (
    <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <span className={`badge ${unlocks.canBlacklistRoles ? 'tier-badge tier-made' : ''}`}>
        {unlocks.canBlacklistRoles
          ? PREFERENCES.blacklistUnlocked
          : PREFERENCES.blacklistLockedHint(UNLOCKS.ROLE_BLACKLIST_AT)}
      </span>
      <span className={`badge ${unlocks.canPreferRoles ? 'tier-badge tier-capo' : ''}`}>
        {unlocks.canPreferRoles
          ? PREFERENCES.preferUnlocked
          : PREFERENCES.preferLockedHint(UNLOCKS.ROLE_PREFER_AT)}
      </span>
      {unlocks.nextUnlock && (
        <span className="faint">
          {PREFERENCES.progressTo(unlocks.nextUnlock.label, unlocks.nextUnlock.at)}
        </span>
      )}
    </div>
  );
}

/** Three-state segmented control: Neutral / Blacklist / Prefer (gated). */
function PrefControl({
  state,
  unlocks,
  disabled,
  onChange,
}: {
  state: PrefState;
  unlocks: PreferenceUnlocks;
  disabled: boolean;
  onChange: (next: PrefState) => void;
}) {
  const blacklistLocked = !unlocks.canBlacklistRoles;
  const preferLocked = !unlocks.canPreferRoles;
  return (
    <div className="row segmented pref-control" role="group" aria-label={state}>
      <button
        type="button"
        className={`btn btn-sm ${state === 'none' ? 'btn-active' : ''}`}
        onClick={() => onChange('none')}
        disabled={disabled}
        title={PREFERENCES.stateNoneTitle}
      >
        {PREFERENCES.stateNone}
      </button>
      <button
        type="button"
        className={`btn btn-sm pref-blacklist ${state === 'blacklist' ? 'btn-active' : ''}`}
        onClick={() => onChange('blacklist')}
        disabled={disabled || blacklistLocked}
        aria-disabled={blacklistLocked}
        title={blacklistLocked ? PREFERENCES.blacklistLockedTitle : PREFERENCES.stateBlacklistTitle}
      >
        {blacklistLocked ? `🔒 ${PREFERENCES.stateBlacklist}` : PREFERENCES.stateBlacklist}
      </button>
      <button
        type="button"
        className={`btn btn-sm pref-prefer ${state === 'prefer' ? 'btn-active' : ''}`}
        onClick={() => onChange('prefer')}
        disabled={disabled || preferLocked}
        aria-disabled={preferLocked}
        title={preferLocked ? PREFERENCES.preferLockedTitle : PREFERENCES.statePreferTitle}
      >
        {preferLocked ? `🔒 ${PREFERENCES.statePrefer}` : PREFERENCES.statePrefer}
      </button>
    </div>
  );
}
