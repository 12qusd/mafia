/**
 * Small reusable presentation components (BUILD_SPEC §13.1). Faction is always
 * shown as color + icon + label (colorblind requirement).
 */

import { getRole, tierForPoints, type Faction, type RoleId } from '@nocturne/shared';
import { FactionIcon } from './Icons.js';
import { FACTION_LABEL } from '../lib/strings-extra.js';

/** Faction tag: color class + icon + text label (never color alone). */
export function FactionTag({ faction }: { faction: Faction }) {
  return (
    <span className={`faction-tag faction-${faction}`}>
      <FactionIcon faction={faction} />
      {FACTION_LABEL[faction]}
    </span>
  );
}

/** A role chip for setup previews / reveals: icon (by faction) + role name. */
export function RoleChip({ role }: { role: RoleId }) {
  const def = getRole(role);
  return (
    <span className={`role-chip faction-${def.faction}`} title={def.tagline}>
      <FactionIcon faction={def.faction} />
      {def.name}
    </span>
  );
}

/** Section header with art-deco rules. */
export function DecoHead({ children }: { children: React.ReactNode }) {
  return <div className="deco-head">{children}</div>;
}

/**
 * TEST badge — shown wherever a gated test-mode lobby/game is in play
 * (`lobby_state.lobby.testMode`). Test lobbies have god-view + audit and are
 * excluded from real stats; the badge makes that unmistakable.
 */
export function TestBadge() {
  return (
    <span className="badge director-test-badge" title="Test mode: god view + audit, not ranked">
      TEST
    </span>
  );
}

/**
 * Progression tier badge (goal 1/2). Color is driven by a per-tier class so the
 * standing reads at a glance; the tier *name* is always shown alongside the
 * color, so this is never a color-only signal.
 */
export function TierBadge({ totalPoints, size = 'md' }: { totalPoints: number; size?: 'sm' | 'md' }) {
  const tier = tierForPoints(totalPoints);
  return (
    <span className={`tier-badge tier-${tier.key} ${size === 'sm' ? 'tier-sm' : ''}`} title={`${tier.name} · ${tier.minPoints}+ pts`}>
      <span className="tier-pip" aria-hidden="true">◆</span>
      {tier.name}
    </span>
  );
}

/** A simple on/off toggle switch. */
export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`switch ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}
