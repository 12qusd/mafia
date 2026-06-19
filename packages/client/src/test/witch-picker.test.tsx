/**
 * Witch two-target night picker (client UI gap 1). The Witch's `witch_control`
 * carries the PUPPET in `target` and the VICTIM in `target2`. This exercises the
 * OwnPanel night-action picker: a second ("victim") picker appears only for the
 * Witch, both targets are submitted via `night_action`, the choice persists in
 * the store (`nightTarget` / `nightTarget2`), and non-Witch roles are unaffected
 * (single picker, no `target2`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import {
  PROTOCOL_VERSION,
  ClientMessageSchema,
  type PublicSeat,
  type AbilityInfo,
  type RoleId,
  type Faction,
} from '@nocturne/shared';
import { useStore } from '../store/store.js';
import { conn } from '../ws/connection.js';
import { OwnPanel } from '../components/OwnPanel.js';
import type { OwnState } from '../store/types.js';
import { GAME } from '../lib/strings-extra.js';

const V = PROTOCOL_VERSION;

function seat(n: number, alive = true, name = `P${n}`): PublicSeat {
  return { seat: n, name, alive, connected: true, afk: false };
}

function ownFor(role: RoleId, faction: Faction, ability: AbilityInfo): OwnState {
  return {
    seat: 0,
    role,
    faction,
    abilities: [ability],
    nightTarget: null,
    nightTarget2: null,
    nightAbility: null,
    jailTarget: null,
    revealed: false,
    lastWill: '',
    deathNote: '',
    vote: null,
    verdict: null,
  };
}

const WITCH_ABILITY: AbilityInfo = { id: 'witch_control', name: 'Control', timing: 'night', usesRemaining: null };
// Seats: 0 = the Witch herself (never targetable), 1 = Puppet, 2 = Victim.
const SEATS = [seat(0, true, 'Witch'), seat(1, true, 'Puppet'), seat(2, true, 'Victim')];

/** The puppet ("whose hand to move") picker group. */
function puppetGrid() {
  return within(screen.getByRole('group', { name: GAME.witchPuppet }));
}
/** The victim ("where to point it") picker group. */
function victimGrid() {
  return within(screen.getByRole('group', { name: GAME.witchVictim }));
}

describe('Witch two-target night picker (gap 1)', () => {
  let sent: unknown[];
  beforeEach(() => {
    sent = [];
    vi.spyOn(conn, 'send').mockImplementation((msg) => {
      // Every frame we emit must be a valid client message (defence-in-depth).
      expect(() => ClientMessageSchema.parse(msg)).not.toThrow();
      sent.push(msg);
    });
    useStore.getState().resetAll();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders both labelled pickers and submits target + target2', () => {
    useStore.setState({ own: ownFor('WITCH', 'NEUTRAL_BENIGN', WITCH_ABILITY) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);

    // Both noir labels are present.
    expect(screen.getByText(GAME.witchPuppet)).toBeInTheDocument();
    expect(screen.getByText(GAME.witchVictim)).toBeInTheDocument();

    // Until a puppet is picked, the victim picker is gated.
    expect(screen.getByText(GAME.witchNeedPuppet)).toBeInTheDocument();

    // Pick the puppet (seat 1). The store holds the puppet; the pair is not yet
    // complete, so a bare cancel is the most recent server frame.
    fireEvent.click(puppetGrid().getByText(/2 · Puppet/));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(useStore.getState().own?.nightTarget2).toBeNull();

    // Pick the victim (seat 2). Now the full pair is submitted.
    fireEvent.click(victimGrid().getByText(/3 · Victim/));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(useStore.getState().own?.nightTarget2).toBe(2);

    const last = sent[sent.length - 1];
    expect(last).toEqual({ v: V, type: 'night_action', ability: 'witch_control', target: 1, target2: 2 });
  });

  it('never offers the Witch herself and excludes the chosen puppet from the victim list', () => {
    useStore.setState({ own: ownFor('WITCH', 'NEUTRAL_BENIGN', WITCH_ABILITY) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);

    // The Witch (seat 0) is never a target in the puppet picker.
    expect(puppetGrid().queryByText(/1 · Witch/)).not.toBeInTheDocument();

    fireEvent.click(puppetGrid().getByText(/2 · Puppet/));
    // The victim list offers seat 2 but not the seat 1 puppet (nor the Witch).
    expect(victimGrid().getByText(/3 · Victim/)).toBeInTheDocument();
    expect(victimGrid().queryByText(/2 · Puppet/)).not.toBeInTheDocument();
    expect(victimGrid().queryByText(/1 · Witch/)).not.toBeInTheDocument();
  });

  it('non-Witch roles get a single picker and submit only `target`', () => {
    useStore.setState({
      own: ownFor('DOCTOR', 'TOWN', { id: 'protect', name: 'Heal', timing: 'night', usesRemaining: null }),
    });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);

    // No Witch labels / no second picker.
    expect(screen.queryByText(GAME.witchPuppet)).not.toBeInTheDocument();
    expect(screen.queryByText(GAME.witchVictim)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: GAME.witchVictim })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/2 · Puppet/));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(useStore.getState().own?.nightTarget2).toBeNull();

    const last = sent[sent.length - 1] as Record<string, unknown>;
    expect(last.type).toBe('night_action');
    expect(last.target).toBe(1);
    expect('target2' in last).toBe(false);
  });

  it('cancelling a complete selection clears both targets and sends a bare cancel', () => {
    useStore.setState({ own: ownFor('WITCH', 'NEUTRAL_BENIGN', WITCH_ABILITY) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    fireEvent.click(puppetGrid().getByText(/2 · Puppet/));
    fireEvent.click(victimGrid().getByText(/3 · Victim/));
    fireEvent.click(screen.getByText(GAME.cancelAction));

    expect(useStore.getState().own?.nightTarget).toBeNull();
    expect(useStore.getState().own?.nightTarget2).toBeNull();
    const last = sent[sent.length - 1];
    expect(last).toEqual({ v: V, type: 'night_action', ability: 'witch_control', target: null });
  });
});

const TRANSPORT_ABILITY: AbilityInfo = { id: 'transport', name: 'Transport', timing: 'night', usesRemaining: null };
// Seats: 0 = the Transporter (never targetable), 1 = House A, 2 = House B.
const TP_SEATS = [seat(0, true, 'Driver'), seat(1, true, 'HouseA'), seat(2, true, 'HouseB')];

/** The first-house picker group. */
function firstGrid() {
  return within(screen.getByRole('group', { name: GAME.transportFirst }));
}
/** The second-house picker group. */
function secondGrid() {
  return within(screen.getByRole('group', { name: GAME.transportSecond }));
}

describe('Transporter two-target night picker (batch F)', () => {
  let sent: unknown[];
  beforeEach(() => {
    sent = [];
    vi.spyOn(conn, 'send').mockImplementation((msg) => {
      expect(() => ClientMessageSchema.parse(msg)).not.toThrow();
      sent.push(msg);
    });
    useStore.getState().resetAll();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reuses the generalized two-target picker with Transporter labels + submits target + target2', () => {
    useStore.setState({ own: ownFor('TRANSPORTER', 'TOWN', TRANSPORT_ABILITY) });
    render(<OwnPanel seats={TP_SEATS} phase="NIGHT" />);

    // Transporter-appropriate labels (NOT the Witch's).
    expect(screen.getByText(GAME.transportFirst)).toBeInTheDocument();
    expect(screen.getByText(GAME.transportSecond)).toBeInTheDocument();
    expect(screen.queryByText(GAME.witchPuppet)).not.toBeInTheDocument();

    // Until a first house is picked, the second picker is gated.
    expect(screen.getByText(GAME.transportNeedFirst)).toBeInTheDocument();

    fireEvent.click(firstGrid().getByText(/2 · HouseA/));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(useStore.getState().own?.nightTarget2).toBeNull();

    fireEvent.click(secondGrid().getByText(/3 · HouseB/));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(useStore.getState().own?.nightTarget2).toBe(2);

    const last = sent[sent.length - 1];
    expect(last).toEqual({ v: V, type: 'night_action', ability: 'transport', target: 1, target2: 2 });
  });

  it('never offers the Transporter itself and excludes the first house from the second list', () => {
    useStore.setState({ own: ownFor('TRANSPORTER', 'TOWN', TRANSPORT_ABILITY) });
    render(<OwnPanel seats={TP_SEATS} phase="NIGHT" />);
    expect(firstGrid().queryByText(/1 · Driver/)).not.toBeInTheDocument();
    fireEvent.click(firstGrid().getByText(/2 · HouseA/));
    expect(secondGrid().getByText(/3 · HouseB/)).toBeInTheDocument();
    expect(secondGrid().queryByText(/2 · HouseA/)).not.toBeInTheDocument();
    expect(secondGrid().queryByText(/1 · Driver/)).not.toBeInTheDocument();
  });
});
