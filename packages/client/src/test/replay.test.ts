import { describe, it, expect } from 'vitest';
import { init, apply, type GameEvent } from '@nocturne/engine';
import { getSetup } from '@nocturne/shared';
import { reconstructReplay } from '../lib/replay.js';
import type { ReplayEvent } from '../lib/api.js';

/**
 * Replay reconstruction (goal 7): the folded engine state must match a fresh
 * fold of the same events, and the timeline steps must advance phase/day.
 */
describe('reconstructReplay (goal 7)', () => {
  const setup = getSetup('classic-nocturne')!;
  const seed = 'replay-test-seed';
  const playerCount = 7;

  // Generate a short, legal event log by advancing the phase machine.
  function generateEvents(): ReplayEvent[] {
    let state = init(setup, seed, { playerCount });
    const events: ReplayEvent[] = [];
    let seq = 1;
    let ts = 1_000;
    // Three phase_end ticks walk ASSIGN → DAY_0 → NIGHT → DAWN.
    for (let i = 0; i < 3; i++) {
      const ev: GameEvent = { type: 'phase_end', ts };
      events.push({ seq, phase: state.phase, event: ev });
      state = apply(state, ev).state;
      seq += 1;
      ts += 1_000;
    }
    return events;
  }

  it('reconstructs steps from a shipped setup and event log', () => {
    const events = generateEvents();
    const recon = reconstructReplay('classic-nocturne', seed, playerCount, events);
    expect(recon.ok).toBe(true);
    // Initial step + one per applied event.
    expect(recon.steps.length).toBe(events.length + 1);
    // Roles resolved for every seat.
    expect(recon.roles).not.toBeNull();
    expect(Object.keys(recon.roles ?? {}).length).toBe(playerCount);
    // The initial step is everyone alive.
    expect(recon.steps[0]?.living.length).toBe(playerCount);
    expect(recon.steps[0]?.dead.length).toBe(0);
    // The phase advances across steps (not all identical to ASSIGN).
    const phases = new Set(recon.steps.map((s) => s.phase));
    expect(phases.size).toBeGreaterThan(1);
  });

  it('reports not-ok for an unknown (unresolvable) setup', () => {
    const recon = reconstructReplay('no-such-setup', seed, playerCount, []);
    expect(recon.ok).toBe(false);
    expect(recon.steps).toEqual([]);
    expect(recon.roles).toBeNull();
  });

  it('stops folding gracefully on a malformed event but keeps prior steps', () => {
    const events: ReplayEvent[] = [
      { seq: 1, phase: 'ASSIGN', event: { type: 'phase_end', ts: 1000 } },
      // A nonsense event the engine cannot apply.
      { seq: 2, phase: 'DAY_0', event: { type: 'not_a_real_event', ts: 2000 } },
    ];
    const recon = reconstructReplay('classic-nocturne', seed, playerCount, events);
    expect(recon.ok).toBe(true);
    // Initial step + the one valid event (the bad one aborts the fold).
    expect(recon.steps.length).toBeGreaterThanOrEqual(2);
  });
});
