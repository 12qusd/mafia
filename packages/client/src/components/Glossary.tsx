/**
 * Public role glossary — "The Cast" (BUILD_SPEC §13.1).
 *
 * A modal listing EVERY role, open to the whole table from the topbar on every
 * screen (lobby, game, home). The point is verification: a player can read any
 * role's card and abilities, so "what does your card say?" can never be used to
 * fake-confirm — the canonical copy here is the SAME `RoleDefinition` text shown
 * on a player's own hand in OwnPanel (both pull from `@nocturne/shared`), so
 * there is no discrepancy to exploit.
 *
 * Role data is static and trusted (not user-derived), so it is rendered directly
 * — no sanitization needed. Faction is always shown as icon + label via
 * `FactionTag` (colorblind requirement, never color alone).
 */

import { useMemo, useRef, useState } from 'react';
import {
  ALL_ROLES,
  FACTIONS,
  type Faction,
  type RoleDefinition,
} from '@nocturne/shared';
import { FactionTag } from './common.js';
import { FACTION_LABEL, GLOSSARY } from '../lib/strings-extra.js';
import { useModalA11y } from '../lib/useModalA11y.js';

/** Faction grouping order for the section headers (Town first, neutrals last). */
const FACTION_ORDER: readonly Faction[] = [
  'TOWN',
  'MAFIA',
  'TRIAD',
  'VAMPIRE',
  'CULT',
  'NEUTRAL_KILLING',
  'NEUTRAL_BENIGN',
];
// Guard: if the shared FACTIONS list ever grows, fall back to its order for any
// faction we didn't explicitly rank, so no role is ever silently dropped.
const ORDERED_FACTIONS: readonly Faction[] = [
  ...FACTION_ORDER,
  ...FACTIONS.filter((f) => !FACTION_ORDER.includes(f)),
];

/**
 * Build the human-readable ability summary lines for a role, derived from its
 * `RoleDefinition` metadata (nightAction, dayAction, uses, immunities, unique,
 * visits). Original noir phrasing — no mechanics number is invented, everything
 * is read off the descriptor.
 */
export function abilitySummary(def: RoleDefinition): string[] {
  const lines: string[] = [];

  // Night action (with a use-count clause where the ability is metered).
  if (def.nightAction !== 'none') {
    const verb = GLOSSARY.nightVerb[def.nightAction] ?? '';
    if (verb) {
      let line = `At night, ${verb}`;
      if (def.uses) {
        const total = def.uses.total;
        if (!Number.isFinite(total)) line += ` — ${GLOSSARY.usesUnlimited}`;
        else if (total === 1) line += ` — ${GLOSSARY.usesOnce}`;
        else line += ` — ${GLOSSARY.usesN(total)}`;
        if (def.uses.selfTotal !== undefined) {
          line += `, ${GLOSSARY.usesSelf(def.uses.selfTotal)}`;
        }
      }
      lines.push(`${line}.`);
    }
  }

  // Day action.
  if (def.dayAction === 'reveal') lines.push(GLOSSARY.dayReveal);
  else if (def.dayAction === 'jail') lines.push(GLOSSARY.dayJail);

  // Trait flags.
  if (def.unique) lines.push(GLOSSARY.traitUnique);
  if (def.nightImmune) lines.push(GLOSSARY.traitNightImmune);
  if (def.roleblockImmune) lines.push(GLOSSARY.traitRoleblockImmune);
  // A role that takes a night action but doesn't visit is acting from afar.
  if (def.nightAction !== 'none' && !def.visits) lines.push(GLOSSARY.traitNoVisit);

  if (lines.length === 0) lines.push(GLOSSARY.abilityNone);
  return lines;
}

/** A single role's glossary entry — same canonical copy as the own-role card. */
function GlossaryEntry({ def }: { def: RoleDefinition }) {
  return (
    <div className="glossary-entry" data-role={def.id}>
      <div className="spread glossary-entry-head">
        <span className="role-name glossary-entry-name">{def.name}</span>
        <FactionTag faction={def.faction} />
      </div>
      <div className="role-tagline">{def.tagline}</div>
      <div className="role-desc">{def.description}</div>

      <div className="glossary-sub">{GLOSSARY.abilities}</div>
      <ul className="glossary-abilities">
        {abilitySummary(def).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      <div className="glossary-sub">{GLOSSARY.winCondition}</div>
      <div className="role-desc glossary-win">{def.winHint}</div>
    </div>
  );
}

/**
 * The glossary modal. Mounted at the app root (like Toasts / ForceUpdateModal),
 * shown when `open`. Dismissable with Esc, by clicking the backdrop, or via the
 * explicit close button; focus moves into the dialog on open.
 */
export function Glossary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus management: trap Tab, Esc to close, restore focus to the trigger on
  // close, and focus the search field first (shared modal-a11y hook).
  useModalA11y(dialogRef, open, { onClose, initialFocus: searchRef });

  // Filter by role name, faction key, or faction label (case-insensitive).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_ROLES;
    return ALL_ROLES.filter((def) => {
      const factionLabel = FACTION_LABEL[def.faction].toLowerCase();
      const sectionLabel = GLOSSARY.sections[def.faction].toLowerCase();
      return (
        def.name.toLowerCase().includes(q) ||
        def.faction.toLowerCase().includes(q) ||
        factionLabel.includes(q) ||
        sectionLabel.includes(q)
      );
    });
  }, [query]);

  // Group the (filtered) roles by faction, in display order, dropping empties.
  const groups = useMemo(
    () =>
      ORDERED_FACTIONS.map((faction) => ({
        faction,
        roles: filtered.filter((r) => r.faction === faction),
      })).filter((g) => g.roles.length > 0),
    [filtered],
  );

  if (!open) return null;

  return (
    <div
      className="overlay glossary-overlay"
      onClick={onClose}
      data-testid="glossary-overlay"
    >
      <div
        ref={dialogRef}
        className="panel glossary-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glossary-header">
          <div className="spread">
            <div className="stack" style={{ gap: 2 }}>
              <h2 className="glossary-title" id="glossary-title">{GLOSSARY.heading}</h2>
              <span className="faint">{GLOSSARY.sub}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm glossary-close"
              onClick={onClose}
              aria-label={GLOSSARY.closeTitle}
            >
              {GLOSSARY.close}
            </button>
          </div>
          <div className="glossary-toolbar">
            <input
              ref={searchRef}
              type="search"
              className="glossary-search"
              placeholder={GLOSSARY.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={GLOSSARY.searchPlaceholder}
            />
            <span className="muted glossary-count">
              {GLOSSARY.shown(filtered.length, ALL_ROLES.length)}
            </span>
          </div>
        </div>

        <div className="glossary-body">
          {groups.length === 0 ? (
            <p className="muted glossary-empty">{GLOSSARY.noMatches}</p>
          ) : (
            groups.map((group) => (
              <section key={group.faction} className="glossary-section">
                <div className="deco-head glossary-section-head">
                  {GLOSSARY.sections[group.faction]}
                </div>
                <div className="glossary-grid">
                  {group.roles.map((def) => (
                    <GlossaryEntry key={def.id} def={def} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
