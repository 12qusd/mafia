import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { apply, init, type GameEvent } from '../src/index.js';
import { yourRoleEffect } from '../src/roleinfo.js';
import { CLASSIC_NOCTURNE, DEFAULT_LOBBY_CONFIG, type Effect, type SeatId } from '@nocturne/shared';
import { runRandomGame } from './simbot.js';

/**
 * Engine-level leak detector (§5, §12.3 mini-check). For every effect emitted
 * during a random game, verify the §5 entitlement table: no message addressed to
 * a recipient set NOT entitled to a seat's secret may carry that seat's
 * role/faction string, before legal reveal.
 *
 * The engine emits `your_role` only on demand (server-driven), so here we audit
 * the gameplay effects (`apply`) and additionally exercise `yourRoleEffect`
 * addressing directly.
 */

interface Capture {
  effect: Effect;
  liveRoles: { seat: SeatId; role: string; faction: string; alive: boolean; revealed: boolean }[];
  mafiaSeats: SeatId[];
}

function snapshotRoles(state: ReturnType<typeof init>): Capture['liveRoles'] {
  return state.seats.map((s) => ({
    seat: s.seat,
    role: s.role,
    faction: s.faction,
    alive: s.alive,
    revealed: s.revealed,
  }));
}

/** Does `text` contain seat `other`'s role token (rough textual check, §12.1)? */
function containsRoleToken(text: string, role: string): boolean {
  return text.includes(`"${role}"`) || text.includes(`:${role}`) || text.includes(`"${role.toLowerCase()}"`);
}

function auditEffect(cap: Capture): string[] {
  const violations: string[] = [];
  const { effect, liveRoles, mafiaSeats } = cap;
  const body = JSON.stringify(effect.msg);

  // game_over reveals everyone — always allowed.
  if (effect.msg.type === 'game_over') return violations;
  // death_announce IS the legal reveal of the announced (now-dead) seat; the
  // engine marks that seat revealed in the same resolution. Allowed by §5.
  if (effect.msg.type === 'death_announce') return violations;
  // consigliere_result / janitor_result (batch A) + remember_result (batch B)
  // legitimately carry a role to the acting seat alone; the engine addresses each
  // via toSeat([actor]). The §5 addressing IS the entitlement, mirroring your_role.
  // (tracker_result / spy_result carry only seat ids — never roles — so they are
  // not role carriers and need no whitelist here.)
  // coroner_result (batch F) likewise carries a role — of an ALREADY-revealed dead
  // seat — to the Coroner alone; the §5 addressing IS the entitlement, like
  // your_role / consigliere_result. (trapper_result carries only a seat id.)
  if (
    effect.msg.type === 'private_result' &&
    ['consigliere_result', 'janitor_result', 'remember_result', 'coroner_result'].includes(
      (effect.msg as { kind?: string }).kind ?? '',
    )
  ) {
    return violations;
  }

  // Determine the entitled audience for this effect.
  const to = effect.to;

  for (const seat of liveRoles) {
    // A seat's role string may appear if: the seat is revealed (death/mayor),
    // OR the message is addressed only to that seat, OR (mafia roster) to mafia.
    if (seat.revealed) continue;
    if (!containsRoleToken(body, seat.role)) continue;

    // The role token appears. Check who can see it.
    if (to === 'public' || to === 'dead') {
      // death_announce/verdict carry roles only for revealed seats; if not
      // revealed, it's a leak. (your_role/private go to SeatId[] only.)
      violations.push(`${effect.msg.type} → ${String(to)} leaked seat ${seat.seat} role ${seat.role}`);
    } else if (to === 'mafia') {
      // Mafia channel: a mafia seat's role may be visible to mafia (roster). A
      // non-mafia seat's role must NOT appear.
      if (seat.faction !== 'MAFIA') {
        violations.push(`mafia channel leaked non-mafia seat ${seat.seat} role ${seat.role}`);
      }
    } else if (Array.isArray(to)) {
      // Addressed set: the role may appear only if every recipient is the seat
      // itself or (for mafia roster) a mafia member.
      const everyoneEntitled = to.every(
        (r) => r === seat.seat || (mafiaSeats.includes(r) && seat.faction === 'MAFIA'),
      );
      if (!everyoneEntitled) {
        violations.push(`addressed effect ${effect.msg.type} leaked seat ${seat.seat} role to ${to.join(',')}`);
      }
    }
  }
  return violations;
}

describe('§5 / §12.3 engine leak detector', () => {
  it('no gameplay effect leaks an unrevealed seat role to an unentitled audience', () => {
    fc.assert(
      fc.property(fc.integer({ min: 7, max: 12 }), fc.string({ minLength: 1, maxLength: 10 }), (pc, seed) => {
        const { events } = runRandomGame(pc, seed);
        let state = init(CLASSIC_NOCTURNE, seed, { playerCount: pc, config: DEFAULT_LOBBY_CONFIG });
        const allViolations: string[] = [];
        for (const ev of events as GameEvent[]) {
          const { state: next, effects } = apply(state, ev);
          const mafiaSeats = next.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);
          for (const effect of effects) {
            allViolations.push(
              ...auditEffect({ effect, liveRoles: snapshotRoles(next), mafiaSeats }),
            );
          }
          state = next;
        }
        expect(allViolations).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  it('your_role: mafia roster delivered only to mafia; town role only to its own seat', () => {
    const state = init(CLASSIC_NOCTURNE, 'roster-seed', { playerCount: 10, config: DEFAULT_LOBBY_CONFIG });
    for (const seat of state.seats) {
      const eff = yourRoleEffect(state, seat);
      expect(eff.to).toEqual([seat.seat]); // addressed to the owning seat only
      if (seat.faction === 'MAFIA') {
        const msg = eff.msg as { mates?: number[] };
        // mates only mafia.
        for (const m of msg.mates ?? []) {
          expect(state.seats[m]!.faction).toBe('MAFIA');
        }
      } else {
        const msg = eff.msg as { mates?: number[] };
        expect(msg.mates).toBeUndefined();
      }
    }
  });
});
