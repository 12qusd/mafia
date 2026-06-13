/**
 * Minimal random-policy driver for property tests (§12.1): plays random *legal*
 * actions through the engine until game over or a cycle cap, using a seeded RNG
 * so runs are reproducible. Pure: drives only via `apply`.
 */

import { apply, type GameState, type GameEvent } from '../src/index.js';
import { roleToNightAbility } from '../src/roleinfo.js';
import { nextInt, seedPrng, type PrngState } from '../src/prng.js';
import { init } from '../src/index.js';
import { CLASSIC_NOCTURNE } from '@nocturne/shared';
import { DEFAULT_LOBBY_CONFIG } from '@nocturne/shared';

export interface SimResult {
  finalState: GameState;
  events: GameEvent[];
  cycles: number;
  terminated: boolean;
}

/** Run a full random game for a Classic Nocturne table of `playerCount`. */
export function runRandomGame(playerCount: number, seedStr: string): SimResult {
  let state = init(CLASSIC_NOCTURNE, seedStr, {
    playerCount,
    config: DEFAULT_LOBBY_CONFIG,
  });
  let rng: PrngState = seedPrng(`${seedStr}:bot`);
  const events: GameEvent[] = [];
  let ts = 1000;
  const tick = () => (ts += 1000);

  const apply1 = (ev: GameEvent) => {
    events.push(ev);
    state = apply(state, ev).state;
  };

  let cycles = 0;
  let guard = 0;
  const MAX_STEPS = 5000;

  while (!state.gameOver && guard < MAX_STEPS) {
    guard++;
    switch (state.phase) {
      case 'ASSIGN':
      case 'DAY_0':
      case 'DAWN':
      case 'DAY_DISCUSSION':
      case 'TRIAL_DEFENSE':
        apply1({ type: 'phase_end', ts: tick() });
        break;
      case 'NIGHT': {
        cycles++;
        // Each living seat with a night ability acts on a random living target.
        for (const seat of state.seats) {
          if (!seat.alive) continue;
          const ability = roleToNightAbility(seat.role);
          if (!ability) continue;
          if (ability === 'kill_jailor') continue; // jailor exec handled rarely
          if (ability === 'vest') {
            const r = nextInt(rng, 2);
            rng = r.state;
            if (r.value === 0) apply1({ type: 'night_action', seat: seat.seat, ability, target: null });
            continue;
          }
          const living = state.seats.filter((x) => x.alive && x.seat !== seat.seat);
          if (living.length === 0) continue;
          const r = nextInt(rng, living.length);
          rng = r.state;
          const target = living[r.value]!.seat;
          apply1({ type: 'night_action', seat: seat.seat, ability, target });
        }
        apply1({ type: 'phase_end', ts: tick() });
        break;
      }
      case 'DAY_VOTING': {
        // Random living seat votes a random living target until a trial or timeout.
        const living = state.seats.filter((x) => x.alive);
        // 50% chance everyone votes one seat to force a trial.
        const rr = nextInt(rng, 2);
        rng = rr.state;
        if (rr.value === 0 && living.length > 1) {
          const tr = nextInt(rng, living.length);
          rng = tr.state;
          const target = living[tr.value]!.seat;
          for (const v of living) {
            if (v.seat === target) continue;
            apply1({ type: 'vote', seat: v.seat, target });
            if (state.phase !== 'DAY_VOTING') break;
          }
        }
        if (state.phase === 'DAY_VOTING') {
          apply1({ type: 'phase_end', ts: tick() });
        }
        break;
      }
      case 'TRIAL_JUDGMENT': {
        const accused = state.trial?.accused;
        for (const v of state.seats) {
          if (!v.alive || v.seat === accused) continue;
          const r = nextInt(rng, 3);
          rng = r.state;
          const value = (['guilty', 'innocent', 'abstain'] as const)[r.value]!;
          apply1({ type: 'verdict', seat: v.seat, value });
        }
        apply1({ type: 'phase_end', ts: tick() });
        break;
      }
      case 'EXECUTION':
        apply1({ type: 'phase_end', ts: tick() });
        break;
      default:
        apply1({ type: 'phase_end', ts: tick() });
        break;
    }
  }

  return { finalState: state, events, cycles, terminated: !!state.gameOver };
}

/** Replay an event log from a fresh init; returns the final state. */
export function replay(playerCount: number, seedStr: string, events: GameEvent[]): GameState {
  let state = init(CLASSIC_NOCTURNE, seedStr, { playerCount, config: DEFAULT_LOBBY_CONFIG });
  for (const ev of events) state = apply(state, ev).state;
  return state;
}
