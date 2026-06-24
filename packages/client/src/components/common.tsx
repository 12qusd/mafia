/**
 * Small reusable presentation components (BUILD_SPEC §13.1). Faction is always
 * shown as color + icon + label (colorblind requirement).
 */

import { getRole, tierForPoints, rankForMmr, type Faction, type RoleId } from '@nocturne/shared';
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
export function TierBadge({
  totalPoints,
  size = 'md',
}: {
  totalPoints: number;
  size?: 'sm' | 'md';
}) {
  const tier = tierForPoints(totalPoints);
  return (
    <span
      className={`tier-badge tier-${tier.key} ${size === 'sm' ? 'tier-sm' : ''}`}
      title={`${tier.name} · ${tier.minPoints}+ pts`}
    >
      <span className="tier-pip" aria-hidden="true">
        ◆
      </span>
      {tier.name}
    </span>
  );
}

/**
 * Competitive RANK badge (ranked play). Derives the rank from MMR via the shared
 * ladder — DISTINCT from the lifetime-points {@link TierBadge}. Either pass an
 * `mmr` (badge computes the rank) or a precomputed `rankKey`/`rankName` (from the
 * wire). Color is per-rank class; the rank name is always shown alongside it
 * (never a color-only signal). Optionally shows the MMR.
 *
 * When `placements` is set (the player has not finished their placement games),
 * the ladder badge is REPLACED by an "Unranked — X/Y placements" pill, since a
 * numeric rank isn't earned yet (the RD is still wide). The status text always
 * carries the meaning so it is never a color-only signal.
 */
export function RankBadge({
  mmr,
  rankKey,
  rankName,
  showMmr = false,
  size = 'md',
  placements,
}: {
  mmr?: number;
  rankKey?: string;
  rankName?: string;
  showMmr?: boolean;
  size?: 'sm' | 'md';
  placements?: { played: number; total: number };
}) {
  if (placements) {
    return (
      <span
        className={`rank-badge rank-placements ${size === 'sm' ? 'rank-sm' : ''}`}
        title={`Unranked — ${placements.played}/${placements.total} placement games`}
      >
        <span className="rank-pip" aria-hidden="true">
          ♠
        </span>
        Unranked — {placements.played}/{placements.total}
      </span>
    );
  }
  const derived = mmr !== undefined ? rankForMmr(mmr) : null;
  const key = rankKey ?? derived?.key ?? 'stray';
  const name = rankName ?? derived?.name ?? '';
  return (
    <span
      className={`rank-badge rank-${key} ${size === 'sm' ? 'rank-sm' : ''}`}
      title={mmr !== undefined ? `${name} · ${Math.round(mmr)} MMR` : name}
    >
      <span className="rank-pip" aria-hidden="true">
        ♠
      </span>
      {name}
      {showMmr && mmr !== undefined && <span className="rank-mmr">{Math.round(mmr)}</span>}
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

/**
 * Inline panel loader: a small noir spinner + caption, marked `aria-busy` with a
 * polite live region so a screen reader knows content is on the way. Use inside a
 * panel where data is being fetched (leaderboard, forum, profile, …).
 */
export function InlineLoader({ label }: { label: string }) {
  return (
    <div className="inline-loader" role="status" aria-busy="true" aria-live="polite">
      <span className="noir-spinner noir-spinner-sm" aria-hidden="true" />
      <span className="faint">{label}</span>
    </div>
  );
}

/**
 * A `{len}/{max}` character counter for capped text inputs — the same pattern as
 * the last-will editor (OwnPanel). Link it to its input via `aria-describedby`
 * (pass a matching `id`). It turns amber as the limit nears so the cap is visible
 * before it bites. Decorative-ish, but kept in the a11y tree so SR users hear it.
 */
export function CharCount({ id, len, max }: { id?: string; len: number; max: number }) {
  const near = len >= max * 0.9;
  return (
    <span
      id={id}
      className={`char-count faint ${near ? 'char-count-near' : ''}`}
      aria-live="polite"
    >
      {len}/{max}
    </span>
  );
}
