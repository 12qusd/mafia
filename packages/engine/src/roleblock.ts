/**
 * Roleblock fixed-point resolution (BUILD_SPEC §6.7).
 *
 * Build the directed graph of block intents (blocker → target). Resolve to a
 * deterministic, unique fixed point:
 *
 *   1. Drop blocks whose blocker is jailed.
 *   2. A block is *neutralized* when its blocker's action is cancelled by an
 *      active block. We compute the set of cancelled (blocked) seats so that:
 *        - chains resolve (A→B→C: A blocks B, so B's block on C is neutralized,
 *          so C acts),
 *        - pure cycles (A↔B) stabilize with both blocks ACTIVE — both seats are
 *          blocked, per §6.7's explicit override.
 *
 * Roleblock-immune blockers/targets (Godfather; the Serial Killer for the kill
 * cancellation) never have their action cancelled, and a block ON them never
 * counts as cancelling their action (the resolver still reports the visit /
 * block_failed). The SK kill-redirect hazard is applied by the resolver.
 *
 * Determinism: the algorithm depends only on the (sorted) block set, so the
 * fixed point is unique (property-tested).
 */

import type { SeatId } from '@nocturne/shared';

/** A single block intent: blocker distracts target. */
export interface BlockIntent {
  blocker: SeatId;
  target: SeatId;
}

export interface BlockResolution {
  /** Set of seats that end up successfully roleblocked (action cancelled). */
  blocked: Set<SeatId>;
  /** Blocks that ended active (their blocker actually distracted the target). */
  activeBlocks: BlockIntent[];
}

export function resolveBlocks(
  blocks: readonly BlockIntent[],
  jailed: ReadonlySet<SeatId>,
  immune: ReadonlySet<SeatId>,
): BlockResolution {
  // Step 1: drop jailed blockers, sort for determinism.
  const active = blocks
    .filter((b) => !jailed.has(b.blocker))
    .slice()
    .sort((a, b) => a.blocker - b.blocker || a.target - b.target);

  // `cancelled` = seats whose own action is roleblocked. A block is active iff
  // its blocker is NOT cancelled and the block isn't on an immune target.
  //
  // We grow `cancelled` MONOTONICALLY from grounded sources, which gives the
  // unique §6.7 fixed point including the cycle override:
  //
  //   1. A blocker that can never be cancelled is a SOURCE: it is immune, or it
  //      is targeted by no block at all. Source blocks are unconditionally active
  //      ⇒ their (non-immune) targets are cancelled.
  //   2. Once a seat is cancelled, its outgoing block is dead; re-examine blocks
  //      to find newly-grounded ones (blocker is now a "source" because all its
  //      blockers are cancelled). Repeat to closure.
  //   3. Any block still neither active-from-source nor dead belongs to a pure
  //      cycle of mutually-blocking live seats; §6.7 keeps these ACTIVE, so their
  //      targets are cancelled too.
  //
  // Steps 1–2 are a least-fixed-point from sources (handles chains); step 3 is
  // the explicit cycle override.
  const isTargeted = new Set<SeatId>();
  for (const b of active) isTargeted.add(b.target);

  // `deadBlocker` = seats whose action is cancelled by a GROUNDED (source-rooted)
  // block — their own blocks become inactive. Grows monotonically from sources.
  const deadBlocker = new Set<SeatId>();
  // `blocked` = seats whose action is cancelled (by any active block).
  const blocked = new Set<SeatId>();

  // Steps 1–2: grounded propagation. A block is active iff its blocker isn't a
  // deadBlocker. A grounded blocker (source, or all incoming blockers dead) whose
  // block lands marks the target blocked AND a deadBlocker (its block dies).
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of active) {
      if (immune.has(b.target) || deadBlocker.has(b.blocker)) continue;
      if (!isGrounded(b.blocker, active, deadBlocker, immune, isTargeted)) continue;
      if (!blocked.has(b.target)) {
        blocked.add(b.target);
        changed = true;
      }
      // The blocked target's own blocks die (it is grounded-blocked).
      if (!immune.has(b.target) && !deadBlocker.has(b.target)) {
        deadBlocker.add(b.target);
        changed = true;
      }
    }
  }

  // Step 3: cycle override. Any block whose blocker is NOT a deadBlocker is still
  // active (§6.7 keeps cycle blocks active); cancel its non-immune target.
  for (const b of active) {
    if (immune.has(b.target) || deadBlocker.has(b.blocker)) continue;
    blocked.add(b.target);
  }

  const activeBlocks: BlockIntent[] = [];
  for (const b of active) {
    if (deadBlocker.has(b.blocker)) continue; // blocker grounded-blocked ⇒ inactive
    activeBlocks.push(b);
  }

  return { blocked, activeBlocks };
}

/**
 * A blocker is "grounded" when its action is cancelled or freed by source-rooted
 * blocks only (no cycle): it is immune, targeted by no block, or every block
 * aimed at it has a dead blocker. Cycle-only-supported blockers are NOT grounded.
 */
function isGrounded(
  blocker: SeatId,
  active: readonly BlockIntent[],
  deadBlocker: ReadonlySet<SeatId>,
  immune: ReadonlySet<SeatId>,
  isTargeted: ReadonlySet<SeatId>,
): boolean {
  if (immune.has(blocker) || !isTargeted.has(blocker)) return true;
  for (const b of active) {
    if (b.target !== blocker) continue;
    if (!deadBlocker.has(b.blocker)) return false; // a live incoming block
  }
  return true;
}
