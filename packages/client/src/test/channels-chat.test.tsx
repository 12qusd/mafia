/**
 * In-game CHAT/CHANNEL behavior (BUILD_SPEC §6.4, §13.1). Covers the wave's
 * chat fixes:
 *   - the Jailor and the jailed PRISONER each get a `jail` tab at NIGHT,
 *     BEFORE a single line is spoken (C2 blocker);
 *   - a living séance Medium gets the `dead` tab at NIGHT (A5/F3);
 *   - a blackmailed seat's day-chat input is disabled (E6);
 *   - the disabled-input copy is context-aware: spectator vs dead vs the town
 *     simply being asleep at night (BLOCKER-ish UX);
 *   - the store flags (jailedThisNight / seancePending / silencedToday) are set
 *     and cleared off the right server frames.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  JAILOR_CHAT_ALIAS,
  type ServerMessage,
  type PublicSeat,
} from '@nocturne/shared';
import {
  entitledChannels,
  canSpeakIn,
  muteReasonFor,
  type ChannelContext,
} from '../lib/channels.js';
import { reduce, __resetIds } from '../store/reducer.js';
import { useStore } from '../store/store.js';
import { ChatPane } from '../components/ChatPane.js';
import { GAME } from '../lib/strings-extra.js';
import type { StoreState } from '../store/types.js';
import { INITIAL_CLOCK_ESTIMATE } from '../lib/clock.js';

const V = PROTOCOL_VERSION;

// --- channels.ts context helper -------------------------------------------
function ctxOf(extra: Partial<ChannelContext> = {}): ChannelContext {
  return {
    phase: 'NIGHT',
    alive: true,
    spectator: false,
    isMafia: false,
    isTriad: false,
    isJailor: false,
    isMedium: false,
    jailTarget: null,
    jailedThisNight: false,
    seancePending: false,
    silencedToday: false,
    chat: [],
    ...extra,
  };
}

describe('entitledChannels: jail tab (C2)', () => {
  it('offers the jail tab to the Jailor at NIGHT once a prisoner is set — no traffic yet', () => {
    const tabs = entitledChannels(ctxOf({ isJailor: true, jailTarget: 3 }));
    expect(tabs).toContain('jail');
  });

  it('does NOT offer jail to the Jailor with no prisoner selected', () => {
    const tabs = entitledChannels(ctxOf({ isJailor: true, jailTarget: null }));
    expect(tabs).not.toContain('jail');
  });

  it('offers the jail tab to the jailed PRISONER at NIGHT — no traffic yet', () => {
    const tabs = entitledChannels(ctxOf({ jailedThisNight: true }));
    expect(tabs).toContain('jail');
  });

  it('does not offer jail during the day even with a prisoner set', () => {
    const tabs = entitledChannels(
      ctxOf({ phase: 'DAY_DISCUSSION', isJailor: true, jailTarget: 3 }),
    );
    expect(tabs).not.toContain('jail');
  });

  it('still offers jail once traffic has arrived (legacy path)', () => {
    const tabs = entitledChannels(
      ctxOf({
        phase: 'DAY_DISCUSSION',
        chat: [{ id: 1, channel: 'jail', from: JAILOR_CHAT_ALIAS, text: 'hi', ts: 0 }],
      }),
    );
    expect(tabs).toContain('jail');
  });

  it('both jailor and prisoner can SPEAK in the cell at night', () => {
    expect(canSpeakIn('jail', ctxOf({ isJailor: true, jailTarget: 3 }))).toBe(true);
    expect(canSpeakIn('jail', ctxOf({ jailedThisNight: true }))).toBe(true);
    // A bystander cannot.
    expect(canSpeakIn('jail', ctxOf({}))).toBe(false);
  });
});

describe('entitledChannels: séance dead tab for a living Medium (A5/F3)', () => {
  it('offers the dead tab to a living Medium with a pending séance at NIGHT', () => {
    const tabs = entitledChannels(ctxOf({ isMedium: true, seancePending: true }));
    expect(tabs).toContain('dead');
    expect(canSpeakIn('dead', ctxOf({ isMedium: true, seancePending: true }))).toBe(true);
  });

  it('does NOT offer the dead tab to a living Medium with no séance open', () => {
    const tabs = entitledChannels(ctxOf({ isMedium: true, seancePending: false }));
    expect(tabs).not.toContain('dead');
  });

  it('does not offer the séance dead tab during the day', () => {
    const tabs = entitledChannels(
      ctxOf({ phase: 'DAY_DISCUSSION', isMedium: true, seancePending: true }),
    );
    expect(tabs).not.toContain('dead');
  });

  it('a dead seat still gets the dead tab regardless of séance', () => {
    const tabs = entitledChannels(ctxOf({ alive: false }));
    expect(tabs).toContain('dead');
  });
});

describe('canSpeakIn / muteReasonFor: blackmail + context-aware copy', () => {
  it('a silenced (blackmailed) living seat cannot speak in day chat', () => {
    const ctx = ctxOf({ phase: 'DAY_DISCUSSION', silencedToday: true });
    expect(canSpeakIn('day', ctx)).toBe(false);
    expect(muteReasonFor('day', ctx)).toBe('silenced');
  });

  it('spectators get the onlooker reason', () => {
    const ctx = ctxOf({ phase: 'DAY_DISCUSSION', spectator: true });
    expect(muteReasonFor('day', ctx)).toBe('spectator');
  });

  it('a living town seat at NIGHT gets the phase (asleep) reason, not spectator/dead', () => {
    const ctx = ctxOf({ phase: 'NIGHT' });
    expect(canSpeakIn('day', ctx)).toBe(false);
    expect(muteReasonFor('day', ctx)).toBe('phase');
  });

  it('a dead seat looking at the day channel gets the dead reason', () => {
    const ctx = ctxOf({ phase: 'DAY_DISCUSSION', alive: false });
    expect(muteReasonFor('day', ctx)).toBe('dead');
  });

  it('returns null (can speak) for a living seat in day chat during the day', () => {
    const ctx = ctxOf({ phase: 'DAY_DISCUSSION' });
    expect(muteReasonFor('day', ctx)).toBeNull();
  });
});

// --- reducer flag wiring ---------------------------------------------------
function baseState(): StoreState {
  return {
    connection: 'open',
    clock: INITIAL_CLOCK_ESTIMATE,
    forceUpdateMin: null,
    userId: null,
    guestId: null,
    me: null,
    lobby: null,
    game: {
      setupId: 's',
      seats: [],
      phase: 'NIGHT',
      dayNumber: 1,
      endsAt: null,
      tallies: [],
      votesBySeat: [],
      accusedSeat: null,
      lastVerdict: null,
      deathFeed: [],
      spectator: false,
      stumpedSeats: [],
    },
    own: null,
    gameOver: null,
    pointsAward: null,
    chat: [],
    whisperMeta: [],
    privateLog: [],
    jailedThisNight: false,
    seancePending: false,
    silencedToday: false,
    toasts: [],
    debug: { state: null, traces: [], events: [] },
  };
}

function apply(state: StoreState, msg: ServerMessage): StoreState {
  const parsed = ServerMessageSchema.parse(msg);
  return { ...state, ...reduce(state, parsed as ServerMessage) };
}

describe('reduce: chat-context flags', () => {
  beforeEach(() => __resetIds());

  it('a `jailed` private_result sets jailedThisNight; leaving NIGHT clears it', () => {
    let s = baseState();
    s = apply(s, { v: V, type: 'private_result', kind: 'jailed' });
    expect(s.jailedThisNight).toBe(true);
    s = apply(s, { v: V, type: 'phase_change', phase: 'DAWN', dayNumber: 1, endsAt: null });
    expect(s.jailedThisNight).toBe(false);
  });

  it('a `blackmailed` private_result sets silencedToday; entering NIGHT clears it', () => {
    let s = baseState();
    s = apply(s, { v: V, type: 'private_result', kind: 'blackmailed' });
    expect(s.silencedToday).toBe(true);
    // A fresh NIGHT clears the prior silence.
    s = apply(s, { v: V, type: 'phase_change', phase: 'NIGHT', dayNumber: 2, endsAt: null });
    expect(s.silencedToday).toBe(false);
  });

  it('a séance day_ability_ack sets seancePending; leaving NIGHT clears it', () => {
    let s = baseState();
    s = apply(s, { v: V, type: 'day_ability_ack', ability: 'seance', target: 0 });
    expect(s.seancePending).toBe(true);
    s = apply(s, { v: V, type: 'phase_change', phase: 'DAWN', dayNumber: 1, endsAt: null });
    expect(s.seancePending).toBe(false);
  });
});

// --- ChatPane: input disabling + context-aware muted copy ------------------
function seat(n: number, name = `P${n}`): PublicSeat {
  return { seat: n, name, alive: true, connected: true, afk: false };
}

describe('ChatPane: silenced input + context-aware muted message', () => {
  afterEach(() => cleanup());

  const common = {
    channels: ['day'] as const,
    activeDefault: 'day' as const,
    seatNameFor: (n: number) => `P${n}`,
    seatCount: 3,
    onSend: vi.fn(),
  };

  it("disables the day input and shows the blackmail note for a silenced seat", () => {
    const ctx = ctxOf({ phase: 'DAY_DISCUSSION', silencedToday: true });
    render(
      <ChatPane
        {...common}
        channels={['day']}
        canSpeak={false}
        canSpeakInChannel={(ch) => canSpeakIn(ch, ctx)}
        muteReasonFor={(ch) => muteReasonFor(ch, ctx)}
      />,
    );
    const input = screen.getByPlaceholderText(GAME.chatSilenced) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('shows the spectator copy for an onlooker, NOT the asleep-town copy', () => {
    const ctx = ctxOf({ phase: 'NIGHT', spectator: true });
    render(
      <ChatPane
        {...common}
        channels={['day']}
        canSpeak={false}
        canSpeakInChannel={(ch) => canSpeakIn(ch, ctx)}
        muteReasonFor={(ch) => muteReasonFor(ch, ctx)}
      />,
    );
    expect(screen.getByPlaceholderText(GAME.chatMutedSpectator)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(GAME.chatMutedPhase)).not.toBeInTheDocument();
  });

  it('shows the asleep-town copy for a LIVING seat at night (the old spectator bug)', () => {
    const ctx = ctxOf({ phase: 'NIGHT', alive: true });
    render(
      <ChatPane
        {...common}
        channels={['day']}
        canSpeak={false}
        canSpeakInChannel={(ch) => canSpeakIn(ch, ctx)}
        muteReasonFor={(ch) => muteReasonFor(ch, ctx)}
      />,
    );
    expect(screen.getByPlaceholderText(GAME.chatMutedPhase)).toBeInTheDocument();
    // Crucially NOT the spectator message.
    expect(screen.queryByPlaceholderText(GAME.chatMutedSpectator)).not.toBeInTheDocument();
  });

  it('masks the Jailor from-label via the shared alias (C3)', () => {
    // Seed a jail line authored by the masked jailor into the store first.
    useStore.setState({
      chat: [{ id: 1, channel: 'jail', from: JAILOR_CHAT_ALIAS, text: 'speak', ts: 0 }],
    });
    render(
      <ChatPane {...common} channels={['jail']} activeDefault="jail" canSpeak={false} />,
    );
    expect(screen.getByText(`${JAILOR_CHAT_ALIAS}:`)).toBeInTheDocument();
    useStore.setState({ chat: [] });
    void seat;
  });
});
