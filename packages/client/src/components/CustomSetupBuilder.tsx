/**
 * Custom Setup Builder (goal 4) — the flagship visual setup editor.
 *
 * The author:
 *   1. names the setup + writes a short description,
 *   2. picks a player-count range (min..max); a slot layout is maintained per
 *      count in the range,
 *   3. edits each seat's slot: a fixed role (grouped by faction with icons) or a
 *      category placeholder (RANDOM_TOWN / RANDOM_MAFIA),
 *   4. curates the Town pool that RANDOM_TOWN draws from,
 *   5. sees a live per-count faction-count summary,
 *   6. saves via POST /api/setups/custom, with server validation errors shown
 *      inline.
 *
 * Below the editor, the author's saved setups are listed with delete controls.
 *
 * The store is never used to hold draft state — this is local UI working state,
 * not server-sent data. Saved setups are fetched from the server.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ALL_ROLES,
  FACTIONS,
  getRole,
  slotFaction,
  validateSetup,
  MIN_PLAYERS,
  MAX_PLAYERS,
  DISPLAY_NAME_MAX,
  type Faction,
  type RoleId,
  type SetupSlot,
  type GameSetup,
} from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { DecoHead, FactionTag, RoleChip } from './common.js';
import { FactionIcon } from './Icons.js';
import { BUILDER, FACTION_LABEL } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import * as api from '../lib/api.js';
import type { CustomSetupRecord } from '../lib/api.js';

/** A draft slot in the editor (fixed role or a category placeholder). */
type DraftSlot =
  | { kind: 'fixed'; role: RoleId }
  | { kind: 'category'; category: 'RANDOM_TOWN' | 'RANDOM_MAFIA' };

/** Sensible default for a new slot: a Random Town placeholder. */
const DEFAULT_SLOT: DraftSlot = { kind: 'category', category: 'RANDOM_TOWN' };

/** Roles grouped by faction for the role picker. */
const ROLES_BY_FACTION: Record<Faction, RoleId[]> = (() => {
  const out = { TOWN: [], MAFIA: [], TRIAD: [], NEUTRAL_KILLING: [], NEUTRAL_BENIGN: [] } as Record<
    Faction,
    RoleId[]
  >;
  for (const r of ALL_ROLES) out[r.faction].push(r.id);
  return out;
})();

/** Default Town pool: every Town role (a safe, full allowlist). */
const ALL_TOWN_ROLES: RoleId[] = ALL_ROLES.filter((r) => r.faction === 'TOWN').map((r) => r.id);

function toSetupSlot(s: DraftSlot): SetupSlot {
  return s.kind === 'fixed' ? { kind: 'fixed', role: s.role } : { kind: 'category', category: s.category };
}

export function CustomSetupBuilder() {
  const me = useStore((s) => s.me);
  const pushInfo = useStore((s) => s.pushInfo);
  const registered = !!me && !me.isGuest;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minPlayers, setMinPlayers] = useState<number>(MIN_PLAYERS);
  const [maxPlayers, setMaxPlayers] = useState<number>(MIN_PLAYERS);
  // Slot layouts keyed by player count.
  const [layouts, setLayouts] = useState<Record<number, DraftSlot[]>>({
    [MIN_PLAYERS]: Array.from({ length: MIN_PLAYERS }, () => ({ ...DEFAULT_SLOT })),
  });
  const [editingCount, setEditingCount] = useState<number>(MIN_PLAYERS);
  const [townPool, setTownPool] = useState<RoleId[]>([...ALL_TOWN_ROLES]);

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<CustomSetupRecord[]>([]);

  // Refresh the author's saved setups.
  function reloadSaved() {
    if (!registered) {
      setSaved([]);
      return;
    }
    void api.fetchCustomSetups().then(setSaved);
  }
  useEffect(reloadSaved, [registered]);

  // Keep one layout per count in [min..max]; default new counts to RANDOM_TOWN.
  useEffect(() => {
    setLayouts((prev) => {
      const next: Record<number, DraftSlot[]> = {};
      for (let c = minPlayers; c <= maxPlayers; c++) {
        const existing = prev[c];
        if (existing) {
          // Resize the existing layout to exactly `c` slots.
          const resized = existing.slice(0, c);
          while (resized.length < c) resized.push({ ...DEFAULT_SLOT });
          next[c] = resized;
        } else {
          next[c] = Array.from({ length: c }, () => ({ ...DEFAULT_SLOT }));
        }
      }
      return next;
    });
    setEditingCount((c) => Math.min(Math.max(c, minPlayers), maxPlayers));
  }, [minPlayers, maxPlayers]);

  const counts = useMemo(() => {
    const arr: number[] = [];
    for (let c = minPlayers; c <= maxPlayers; c++) arr.push(c);
    return arr;
  }, [minPlayers, maxPlayers]);

  const slots = layouts[editingCount] ?? [];

  function setSlot(i: number, slot: DraftSlot) {
    setLayouts((prev) => {
      const cur = (prev[editingCount] ?? []).slice();
      cur[i] = slot;
      return { ...prev, [editingCount]: cur };
    });
  }

  // Live faction summary for the editing count (category slots count by their pool).
  const factionCounts = useMemo(() => {
    const tally: Record<Faction, number> = {
      TOWN: 0,
      MAFIA: 0,
      TRIAD: 0,
      NEUTRAL_KILLING: 0,
      NEUTRAL_BENIGN: 0,
    };
    for (const s of slots) {
      tally[slotFaction(toSetupSlot(s))] += 1;
    }
    return tally;
  }, [slots]);

  function buildSetup(): GameSetup {
    const slotsByPlayerCount: Record<string, SetupSlot[]> = {};
    for (const c of counts) {
      slotsByPlayerCount[String(c)] = (layouts[c] ?? []).map(toSetupSlot);
    }
    return {
      id: 'draft', // server assigns the real (custom:-prefixed) id.
      name: sanitizeInline(name) || 'Untitled setup',
      description: sanitizeInline(description),
      minPlayers,
      maxPlayers,
      townPool: townPool.slice(),
      slotsByPlayerCount,
    };
  }

  // Live client-side validation mirrors the server's `validateSetup`, so the
  // author gets immediate feedback before pressing Save.
  const liveValidation = useMemo(() => validateSetup(buildSetup()), [
    name,
    description,
    minPlayers,
    maxPlayers,
    layouts,
    townPool,
    counts,
  ]);

  async function save() {
    setErrors([]);
    const setup = buildSetup();
    const local = validateSetup(setup);
    if (!local.ok) {
      setErrors(local.errors);
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveCustomSetup(setup.name, setup);
      if (res.ok) {
        pushInfo(BUILDER.saved);
        reloadSaved();
      } else {
        setErrors(res.errors);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!registered) {
    return (
      <div className="panel panel-pad stack">
        <DecoHead>{BUILDER.heading}</DecoHead>
        <p className="muted">{BUILDER.signInPrompt}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel panel-pad stack">
        <DecoHead>{BUILDER.heading}</DecoHead>
        <p className="muted" style={{ marginTop: -4 }}>{BUILDER.sub}</p>

        <div className="grid-2">
          <div>
            <label>{BUILDER.nameLabel}</label>
            <input
              value={name}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={BUILDER.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>{BUILDER.descLabel}</label>
            <input
              value={description}
              maxLength={200}
              placeholder={BUILDER.descPlaceholder}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <div>
            <label>{BUILDER.rangeLabel} (min)</label>
            <input
              type="number"
              min={1}
              max={MAX_PLAYERS}
              value={minPlayers}
              style={{ width: 90 }}
              onChange={(e) => {
                const n = clampInt(e.target.value, 1, MAX_PLAYERS);
                setMinPlayers(n);
                if (n > maxPlayers) setMaxPlayers(n);
              }}
            />
          </div>
          <div>
            <label>{BUILDER.rangeLabel} (max)</label>
            <input
              type="number"
              min={1}
              max={MAX_PLAYERS}
              value={maxPlayers}
              style={{ width: 90 }}
              onChange={(e) => setMaxPlayers(clampInt(e.target.value, minPlayers, MAX_PLAYERS))}
            />
          </div>
        </div>

        {counts.length > 1 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {counts.map((c) => (
              <button
                key={c}
                className={`btn btn-sm ${c === editingCount ? 'btn-active' : ''}`}
                onClick={() => setEditingCount(c)}
              >
                {BUILDER.countLabel(c)}
              </button>
            ))}
          </div>
        )}
        <div className="faint">{BUILDER.editingCount(editingCount)}</div>
      </div>

      {/* Slot editor for the current count. */}
      <div className="panel panel-pad stack">
        <div className="spread">
          <DecoHead>{BUILDER.slot}s</DecoHead>
          <div className="builder-faction-summary">
            {FACTIONS.map((f) => (
              <span key={f} className="row" style={{ gap: 4 }}>
                <FactionTag faction={f} />
                <strong>{factionCounts[f]}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="builder-slots">
          {slots.map((slot, i) => (
            <SlotEditor key={i} index={i} slot={slot} onChange={(s) => setSlot(i, s)} />
          ))}
        </div>
      </div>

      {/* Town pool editor. */}
      <div className="panel panel-pad stack">
        <DecoHead>{BUILDER.townPool}</DecoHead>
        <p className="faint" style={{ marginTop: -4 }}>{BUILDER.townPoolHint}</p>
        <div className="setup-roles">
          {ALL_TOWN_ROLES.map((role) => {
            const on = townPool.includes(role);
            return (
              <button
                key={role}
                className={`role-chip faction-TOWN builder-pool-chip ${on ? 'on' : 'off'}`}
                aria-pressed={on}
                onClick={() =>
                  setTownPool((prev) =>
                    prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
                  )
                }
              >
                <FactionIcon faction="TOWN" />
                {getRole(role).name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Validation + save. */}
      {(errors.length > 0 || !liveValidation.ok) && (
        <div className="panel panel-pad stack builder-errors">
          <strong className="error-text">{BUILDER.errors}</strong>
          <ul className="builder-error-list">
            {(errors.length > 0 ? errors : liveValidation.ok ? [] : liveValidation.errors).map(
              (e, i) => (
                <li key={i} className="error-text">
                  {sanitizeInline(e)}
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      <div className="row">
        <button
          className="btn btn-primary"
          disabled={saving || !liveValidation.ok || name.trim().length === 0}
          onClick={() => void save()}
        >
          {saving ? BUILDER.saving : BUILDER.save}
        </button>
      </div>

      {/* The author's saved setups. */}
      <div className="panel panel-pad stack">
        <DecoHead>{BUILDER.mySetups}</DecoHead>
        {saved.length === 0 ? (
          <p className="muted">{BUILDER.noSetups}</p>
        ) : (
          <div className="stack">
            {saved.map((s) => (
              <div className="lobby-row builder-saved-row" key={s.id}>
                <strong>{sanitizeInline(s.name)}</strong>
                <span className="muted">
                  {s.setup.minPlayers}
                  {s.setup.maxPlayers !== s.setup.minPlayers ? `–${s.setup.maxPlayers}` : ''} seats
                </span>
                <span className="faint" style={{ fontSize: '0.85em' }}>
                  {sanitizeInline(s.setup.description)}
                </span>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    void api.deleteCustomSetup(s.id).then((ok) => {
                      if (ok) {
                        pushInfo(BUILDER.deleted);
                        reloadSaved();
                      }
                    });
                  }}
                >
                  {BUILDER.delete}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A single seat's slot editor: fixed role vs. category placeholder. */
function SlotEditor({
  index,
  slot,
  onChange,
}: {
  index: number;
  slot: DraftSlot;
  onChange: (s: DraftSlot) => void;
}) {
  const mode: 'fixed' | 'category' = slot.kind;
  return (
    <div className="builder-slot">
      <span className="seat-num">{index + 1}</span>
      <select
        value={mode}
        aria-label={`${BUILDER.slot} ${index + 1} kind`}
        onChange={(e) => {
          const m = e.target.value as 'fixed' | 'category';
          if (m === 'fixed') onChange({ kind: 'fixed', role: ALL_TOWN_ROLES[0] ?? 'CITIZEN' });
          else onChange({ kind: 'category', category: 'RANDOM_TOWN' });
        }}
      >
        <option value="fixed">{BUILDER.fixedRole}</option>
        <option value="category">{BUILDER.category}</option>
      </select>

      {slot.kind === 'fixed' ? (
        <select
          value={slot.role}
          aria-label={`${BUILDER.slot} ${index + 1} role`}
          onChange={(e) => onChange({ kind: 'fixed', role: e.target.value as RoleId })}
        >
          {FACTIONS.map((f) => (
            <optgroup key={f} label={FACTION_LABEL[f]}>
              {ROLES_BY_FACTION[f].map((r) => (
                <option key={r} value={r}>
                  {getRole(r).name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <select
          value={slot.category}
          aria-label={`${BUILDER.slot} ${index + 1} category`}
          onChange={(e) =>
            onChange({ kind: 'category', category: e.target.value as 'RANDOM_TOWN' | 'RANDOM_MAFIA' })
          }
        >
          <option value="RANDOM_TOWN">{BUILDER.randomTown}</option>
          <option value="RANDOM_MAFIA">{BUILDER.randomMafia}</option>
        </select>
      )}

      <span className="builder-slot-preview">
        {slot.kind === 'fixed' ? (
          <RoleChip role={slot.role} />
        ) : (
          <span className={`role-chip faction-${slot.category === 'RANDOM_TOWN' ? 'TOWN' : 'MAFIA'}`}>
            <FactionIcon faction={slot.category === 'RANDOM_TOWN' ? 'TOWN' : 'MAFIA'} />
            {slot.category === 'RANDOM_TOWN' ? BUILDER.randomTown : BUILDER.randomMafia}
          </span>
        )}
      </span>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(raw) || min));
}
