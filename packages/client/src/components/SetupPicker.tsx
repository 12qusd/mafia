/**
 * Lobby setup picker (goal 5). A grouped chooser over:
 *   - Featured  — today's daily featured shipped setup (/api/setups/daily).
 *   - Standard  — the shipped catalog (/api/setups).
 *   - Chaos     — the daily generated chaos setup (chaos:-prefixed id).
 *   - My setups — the caller's saved custom setups (custom:-prefixed id).
 *
 * Emits the chosen `setupId` string (already correctly prefixed) up to the
 * create-lobby flow, which passes it straight into the `create_lobby` WS
 * message. Resilient: degrades to the shipped catalog if the network fails.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store.js';
import { PICKER } from '../lib/strings-extra.js';
import { sanitizeInline } from '../lib/sanitize.js';
import * as api from '../lib/api.js';
import type { SetupSummary, DailySetups, CustomSetupRecord } from '../lib/api.js';

interface Option {
  id: string;
  label: string;
  group: string;
  hint?: string;
}

export function SetupPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const me = useStore((s) => s.me);
  const [shipped, setShipped] = useState<SetupSummary[]>([]);
  const [daily, setDaily] = useState<DailySetups | null>(null);
  const [custom, setCustom] = useState<CustomSetupRecord[]>([]);

  const registered = !!me && !me.isGuest;

  useEffect(() => {
    let live = true;
    void Promise.all([api.fetchSetups(), api.fetchDailySetups()]).then(([s, d]) => {
      if (!live) return;
      setShipped(s);
      setDaily(d);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!registered) {
      setCustom([]);
      return;
    }
    let live = true;
    void api.fetchCustomSetups().then((c) => {
      if (live) setCustom(c);
    });
    return () => {
      live = false;
    };
  }, [registered]);

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    // Featured (daily) first.
    if (daily?.featured) {
      out.push({
        id: daily.featured.id,
        label: sanitizeInline(daily.featured.name),
        group: PICKER.groupFeatured,
        hint: PICKER.daily(daily.date),
      });
    }
    // Standard shipped catalog (dedupe the featured id so it isn't listed twice).
    for (const s of shipped) {
      if (daily?.featured && s.id === daily.featured.id) continue;
      out.push({ id: s.id, label: sanitizeInline(s.name), group: PICKER.groupStandard });
    }
    // Daily chaos (chaos:-prefixed id).
    if (daily?.chaos) {
      out.push({
        id: daily.chaos.id,
        label: `${PICKER.chaosDaily}: ${sanitizeInline(daily.chaos.setup.name)}`,
        group: PICKER.groupChaos,
      });
    }
    // The caller's saved custom setups (custom:-prefixed id).
    for (const c of custom) {
      out.push({
        id: c.id,
        label: `${PICKER.custom}: ${sanitizeInline(c.name)}`,
        group: PICKER.groupMine,
      });
    }
    return out;
  }, [shipped, daily, custom]);

  // Keep the selection valid: if the current value isn't an offered option yet
  // (initial render, before fetch), leave it; otherwise default to the first.
  // Intentionally keyed off `options` only — we do not want to re-default on
  // every parent re-render (which would fight the user's selection).
  const firstOptionId = options[0]?.id;
  const valueOffered = options.some((o) => o.id === value);
  useEffect(() => {
    if (firstOptionId !== undefined && !valueOffered) {
      onChange(firstOptionId);
    }
  }, [firstOptionId, valueOffered, onChange]);

  // Group options preserving insertion order.
  const groups = useMemo(() => {
    const map = new Map<string, Option[]>();
    for (const o of options) {
      const arr = map.get(o.group) ?? [];
      arr.push(o);
      map.set(o.group, arr);
    }
    return [...map.entries()];
  }, [options]);

  const selected = options.find((o) => o.id === value);

  return (
    <div className="stack" style={{ gap: 4 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Setup">
        {groups.map(([group, opts]) => (
          <optgroup key={group} label={group}>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected?.hint && <span className="faint" style={{ fontSize: '0.8em' }}>{selected.hint}</span>}
    </div>
  );
}
