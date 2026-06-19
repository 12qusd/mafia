/**
 * TEST-MODE god-view + Director controls (BUILD_SPEC test mode;
 * `packages/shared/src/protocol/debug.ts`).
 *
 * Covers: store handling of the three `debug_*` frames, the visibility gate
 * (panel hidden with no debug_state, shown with one), the resolution-trace
 * viewer rendering a sample ResolutionTrace, and the `test_control` senders.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  ClientMessageSchema,
  type ServerMessage,
  type DebugState,
  type DebugTrace,
} from '@nocturne/shared';
import { reduce, __resetIds } from '../store/reducer.js';
import { DEBUG_EVENT_CAP } from '../store/types.js';
import { INITIAL_CLOCK_ESTIMATE } from '../lib/clock.js';
import type { StoreState } from '../store/types.js';
import { useStore } from '../store/store.js';
import { DirectorGate, describeTrace } from '../components/DirectorPanel.js';
import { conn } from '../ws/connection.js';
import {
  testEndPhase,
  testRequestState,
  testAddBots,
  testRemoveBot,
} from '../ws/actions.js';

const V = PROTOCOL_VERSION;

function baseState(): StoreState {
  return {
    connection: 'open',
    clock: INITIAL_CLOCK_ESTIMATE,
    forceUpdateMin: null,
    userId: null,
    guestId: null,
    me: null,
    lobby: null,
    game: null,
    own: null,
    gameOver: null,
    pointsAward: null,
    chat: [],
    whisperMeta: [],
    privateLog: [],
    jailedThisNight: false,
    silencedToday: false,
    toasts: [],
    whisperArm: null,
    debug: { state: null, traces: [], events: [] },
  };
}

function apply(state: StoreState, msg: ServerMessage): StoreState {
  const parsed = ServerMessageSchema.parse(msg) as ServerMessage;
  return { ...state, ...reduce(state, parsed) };
}

function sampleDebugState(over: Partial<DebugState> = {}): DebugState {
  return {
    v: V,
    type: 'debug_state',
    phase: 'NIGHT',
    dayNumber: 1,
    nightNumber: 1,
    seats: [
      {
        seat: 0,
        name: 'Capone',
        role: 'GODFATHER',
        faction: 'MAFIA',
        alive: true,
        revealed: false,
        usesRemaining: null,
        selfUsesRemaining: null,
        nightImmune: true,
        mayorRevealed: false,
        exeTarget: null,
        leaving: false,
        connected: true,
        afk: false,
      },
      {
        seat: 1,
        name: 'Eliot',
        role: 'DOCTOR',
        faction: 'TOWN',
        alive: true,
        revealed: false,
        usesRemaining: 1,
        selfUsesRemaining: 1,
        nightImmune: false,
        mayorRevealed: false,
        exeTarget: null,
        leaving: false,
        connected: true,
        afk: false,
      },
    ],
    mafiaRoster: [0],
    intents: [{ seat: 0, ability: 'mafia_kill', target: 1 }],
    jailTarget: null,
    pendingJesterGrief: null,
    voteTallies: [],
    votesBySeat: [],
    trial: null,
    executionerTargets: [],
    ...over,
  };
}

function sampleTrace(): DebugTrace {
  return {
    v: V,
    type: 'debug_trace',
    dayNumber: 1,
    nightNumber: 1,
    traces: [
      { step: 'protect', doctor: 1, target: 1, kind: 'doctor' },
      { step: 'kill', source: 'mafia', attacker: 0, target: 1, outcome: 'healed' },
    ],
    deaths: [],
  };
}

beforeEach(() => __resetIds());
afterEach(() => {
  cleanup();
  useStore.getState().resetAll();
});

describe('reduce: debug_* frames (god audience only)', () => {
  it('debug_state keeps the latest snapshot', () => {
    let s = baseState();
    s = apply(s, sampleDebugState());
    expect(s.debug.state?.seats).toHaveLength(2);
    s = apply(s, sampleDebugState({ nightNumber: 2 }));
    expect(s.debug.state?.nightNumber).toBe(2);
  });

  it('debug_trace appends per-night and de-dupes a resend', () => {
    let s = baseState();
    s = apply(s, sampleTrace());
    s = apply(s, sampleTrace()); // same nightNumber → replaces, not doubles
    expect(s.debug.traces).toHaveLength(1);
    s = apply(s, { ...sampleTrace(), nightNumber: 2 });
    expect(s.debug.traces).toHaveLength(2);
  });

  it('debug_event ring-buffers to the cap, keeping newest', () => {
    let s = baseState();
    for (let seq = 0; seq < DEBUG_EVENT_CAP + 5; seq++) {
      s = apply(s, {
        v: V,
        type: 'debug_event',
        seq,
        phase: 'NIGHT',
        eventType: 'night_action',
        payload: { n: seq },
        ts: seq,
      });
    }
    expect(s.debug.events).toHaveLength(DEBUG_EVENT_CAP);
    expect(s.debug.events[0]?.seq).toBe(5);
    expect(s.debug.events.at(-1)?.seq).toBe(DEBUG_EVENT_CAP + 4);
  });

  it('game_started resets the god-view', () => {
    let s = baseState();
    s = apply(s, sampleDebugState());
    s = apply(s, sampleTrace());
    s = apply(s, { v: V, type: 'game_started', seats: [], setupId: 'x', config: {} });
    expect(s.debug.state).toBeNull();
    expect(s.debug.traces).toHaveLength(0);
  });
});

describe('describeTrace: ResolutionTrace → legible line (§6.8 audit)', () => {
  const name = (seat: number) => `#${seat + 1}`;
  it('renders kill/protect interactions clearly', () => {
    expect(describeTrace({ step: 'protect', doctor: 1, target: 1, kind: 'doctor' }, name)).toBe(
      '#2 protects #2 (doctor)',
    );
    expect(
      describeTrace({ step: 'kill', source: 'mafia', attacker: 0, target: 1, outcome: 'healed' }, name),
    ).toBe('mafia: #1 → #2 → healed');
  });
  it('renders investigations and deaths', () => {
    expect(
      describeTrace(
        { step: 'investigate', kind: 'sheriff', investigator: 0, target: 1, result: 'suspicious' },
        name,
      ),
    ).toContain('sheriff #1 on #2 → suspicious');
    expect(describeTrace({ step: 'death', seat: 1, role: 'DOCTOR', cause: 'mafia' }, name)).toContain(
      '#2 dies',
    );
  });
});

describe('DirectorGate: visibility gate (no regression to normal play)', () => {
  function seedStore(withDebug: boolean) {
    const st = useStore.getState();
    st.resetAll();
    if (withDebug) st.ingest(sampleDebugState() as ServerMessage);
  }

  it('renders NOTHING with no debug_state (normal client)', () => {
    seedStore(false);
    const { container } = render(<DirectorGate />);
    expect(container.querySelector('.director-panel')).toBeNull();
    expect(screen.queryByText('Director')).toBeNull();
  });

  it('renders the panel once a debug_state arrives (god audience)', () => {
    seedStore(true);
    const { container } = render(<DirectorGate />);
    expect(container.querySelector('.director-panel')).toBeTruthy();
    expect(screen.getByText('Director')).toBeInTheDocument();
    // Live board shows a true role normally secret.
    expect(screen.getByText('Godfather')).toBeInTheDocument();
  });

  it('renders the resolution-trace viewer for a night', () => {
    const st = useStore.getState();
    st.resetAll();
    st.ingest(sampleDebugState() as ServerMessage);
    st.ingest(sampleTrace() as ServerMessage);
    render(<DirectorGate />);
    fireEvent.click(screen.getByRole('tab', { name: 'Resolution traces' }));
    expect(screen.getByText('Night 1')).toBeInTheDocument();
    expect(screen.getByText('mafia: #1 Capone → #2 Eliot → healed')).toBeInTheDocument();
  });
});

describe('test_control senders (host of a test lobby)', () => {
  let sent: unknown[];
  beforeEach(() => {
    sent = [];
    // The connection validates against ClientMessageSchema before sending; we
    // assert each frame is a valid client message and capture it.
    vi.spyOn(conn, 'send').mockImplementation((msg) => {
      expect(() => ClientMessageSchema.parse(msg)).not.toThrow();
      sent.push(msg);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('end_phase / request_state', () => {
    testEndPhase();
    testRequestState();
    expect(sent).toEqual([
      { v: V, type: 'test_control', action: 'end_phase' },
      { v: V, type: 'test_control', action: 'request_state' },
    ]);
  });

  it('add_bot with count + policy', () => {
    testAddBots(3, 'llm');
    expect(sent[0]).toEqual({ v: V, type: 'test_control', action: 'add_bot', count: 3, policy: 'llm' });
  });

  it('remove_bot by seat and all', () => {
    testRemoveBot(2);
    testRemoveBot('all');
    expect(sent).toEqual([
      { v: V, type: 'test_control', action: 'remove_bot', seatOrAll: 2 },
      { v: V, type: 'test_control', action: 'remove_bot', seatOrAll: 'all' },
    ]);
  });
});
