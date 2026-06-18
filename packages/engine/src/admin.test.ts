import { describe, it, expect } from 'vitest';
import { init, apply, hashState } from './index.js';
import { CLASSIC_NOCTURNE } from '@nocturne/shared';
import type { GameState } from './state.js';
import type { GameEvent } from './events.js';

/** Init then advance ASSIGN → DAY_0 so seats are live and votable. */
function day0(seed = 'admin-seed'): GameState {
  let state = init(CLASSIC_NOCTURNE, seed, { playerCount: 7 });
  state = apply(state, { type: 'phase_end', ts: 1 }).state;
  return state;
}

function fold(state: GameState, events: GameEvent[]): GameState {
  let s = state;
  for (const e of events) s = apply(s, e).state;
  return s;
}

describe('admin god-powers (goal 8)', () => {
  it('admin_kill kills, reveals, and stamps the admin death cause', () => {
    const state = day0();
    const victim = 2;
    const { state: next, effects } = apply(state, { type: 'admin_kill', seat: victim, ts: 10 });
    const s = next.seats[victim]!;
    expect(s.alive).toBe(false);
    expect(s.revealed).toBe(true);
    expect(s.deathCause).toBe('admin');
    expect(s.deathDay).toBe(next.dayNumber);
    // Public death reveal emitted.
    const reveal = effects.find((e) => (e.msg as { type?: string }).type === 'death_announce');
    expect(reveal).toBeDefined();
    expect((reveal!.msg as { cause: string }).cause).toBe('admin');
    // A death trace was recorded for the audit trail.
    expect(next.traces.some((t) => t.step === 'death' && t.seat === victim)).toBe(true);
  });

  it('admin_kill on an already-dead seat does not double-kill or re-trace', () => {
    let state = day0();
    state = apply(state, { type: 'admin_kill', seat: 1, ts: 10 }).state;
    const traceCount = state.traces.length;
    const { state: after, effects } = apply(state, { type: 'admin_kill', seat: 1, ts: 11 });
    expect(after.seats[1]!.deathDay).toBe(state.seats[1]!.deathDay); // unchanged
    expect(after.traces.length).toBe(traceCount); // no new death trace
    expect(effects.length).toBe(0); // no announcement re-emitted
  });

  it('admin_kill can end the game (removing the mafia)', () => {
    const state = day0();
    const mafia = state.seats.filter((s) => s.faction === 'MAFIA').map((s) => s.seat);
    let next = state;
    for (const m of mafia) next = apply(next, { type: 'admin_kill', seat: m, ts: 20 }).state;
    // No mafia, no SK left in a classic 7p ⇒ town wins.
    expect(next.gameOver).not.toBeNull();
    expect(next.gameOver!.winners).toContain('TOWN');
  });

  it('admin_stump turns a seat town-aligned, non-voting, and strips agency', () => {
    const state = day0();
    const target = state.seats.find((s) => s.faction === 'MAFIA')!.seat;
    const { state: next, effects } = apply(state, { type: 'admin_stump', seat: target, ts: 30 });
    const s = next.seats[target]!;
    expect(s.stumped).toBe(true);
    expect(s.faction).toBe('TOWN');
    expect(s.alive).toBe(true);
    expect(next.mafiaSeats).not.toContain(target);
    expect(effects.some((e) => (e.msg as { type?: string }).type === 'seat_transform')).toBe(true);
  });

  it('a stumped seat cannot vote', () => {
    let state = day0();
    // Reach DAY_VOTING: DAY_0 → NIGHT → (resolve) → ... is long; instead just
    // verify the vote guard directly by stumping then forcing a vote in voting.
    const target = 3;
    state = apply(state, { type: 'admin_stump', seat: target, ts: 30 }).state;
    // Drive to a DAY_VOTING phase.
    let guard = 0;
    while (state.phase !== 'DAY_VOTING' && !state.gameOver && guard++ < 20) {
      state = apply(state, { type: 'phase_end', ts: 100 + guard }).state;
    }
    if (state.phase === 'DAY_VOTING' && state.seats[target]!.alive) {
      const before = JSON.stringify(state.nomination.votes);
      state = apply(state, { type: 'vote', seat: target, target: 0, ts: 200 }).state;
      expect(JSON.stringify(state.nomination.votes)).toBe(before); // vote ignored
    }
  });

  it('admin events are deterministic and replayable (same log ⇒ same hash)', () => {
    const events: GameEvent[] = [
      { type: 'admin_stump', seat: 4, ts: 10 },
      { type: 'admin_kill', seat: 5, ts: 11 },
    ];
    const a = fold(day0('det'), events);
    const b = fold(day0('det'), events);
    expect(hashState(a)).toBe(hashState(b));
  });
});
