/**
 * Read-only god-view extractor tests (NOCTURNE test mode). `debugView` must
 * surface the normally-secret live state (roles, factions, night intents, marks)
 * without mutating the engine state, and `debugTraces` must return the full
 * accumulated resolution trace array.
 */

import { describe, it, expect } from 'vitest';
import { debugView, debugTraces, traceCount, hashState } from '../src/index.js';
import { makeGame, toFirstNight, night, resolveNightPhase } from './harness.js';

describe('debugView — full god snapshot (read-only)', () => {
  it('reveals every seat role/faction and is pure (no mutation)', () => {
    const s = makeGame(['JAILOR', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'DOCTOR']);
    const before = hashState(s);
    const view = debugView(s);
    expect(hashState(s)).toBe(before); // unchanged
    expect(view.seats.map((x) => x.role)).toEqual([
      'JAILOR',
      'GODFATHER',
      'MAFIOSO',
      'CITIZEN',
      'DOCTOR',
    ]);
    expect(view.mafiaRoster).toEqual([1, 2]);
    // Godfather is night-immune by role.
    expect(view.seats[1]!.nightImmune).toBe(true);
    expect(view.seats[3]!.nightImmune).toBe(false);
  });

  it('surfaces submitted night intents (who → ability → whom)', () => {
    let s = makeGame(['JAILOR', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 2, 'kill_mafia', 3); // mafioso targets citizen 3
    s = night(s, 4, 'protect', 3); // doctor protects citizen 3
    const view = debugView(s);
    const mafia = view.intents.find((i) => i.seat === 2);
    expect(mafia).toEqual({ seat: 2, ability: 'kill_mafia', target: 3 });
    const doc = view.intents.find((i) => i.seat === 4);
    expect(doc).toEqual({ seat: 4, ability: 'protect', target: 3 });
  });

  it('debugTraces returns the accumulated trace array after a night', () => {
    let s = makeGame(['JAILOR', 'GODFATHER', 'MAFIOSO', 'CITIZEN', 'DOCTOR']);
    s = toFirstNight(s);
    s = night(s, 2, 'kill_mafia', 3);
    expect(traceCount(s)).toBe(0);
    const { state } = resolveNightPhase(s);
    const traces = debugTraces(state);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.length).toBe(traceCount(state));
    // Mutating the returned copy does not affect engine state.
    traces.push({ step: 'death', seat: 99, role: 'CITIZEN', cause: 'mafia' });
    expect(debugTraces(state).length).toBe(traces.length - 1);
  });
});
