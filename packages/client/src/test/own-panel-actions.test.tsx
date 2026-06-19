/**
 * Night/day ACTION UI per real ability (audit gaps A1/A2/A3/A4/A5/A7/A8/A9,
 * H1/H2/H4/H5). OwnPanel now iterates the seat's REAL abilities and renders the
 * correct control per `targetDomain`/id:
 *   - multiple night abilities (Arsonist: douse picker + ignite toggle);
 *   - dead-target abilities (Coroner autopsy) list DEAD seats, not living;
 *   - self-toggle abilities (Veteran alert) render a button, not a grid;
 *   - the Jailor cell executes the prisoner (no free target grid);
 *   - the Guardian Angel's shield is restricted to its charge;
 *   - the Executioner's mark shows on the role card.
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

function seat(n: number, alive = true, name = `P${n}`, extra: Partial<PublicSeat> = {}): PublicSeat {
  return { seat: n, name, alive, connected: true, afk: false, ...extra };
}

function ownFor(
  role: RoleId,
  faction: Faction,
  abilities: AbilityInfo[],
  extra: Partial<OwnState> = {},
): OwnState {
  return {
    seat: 0,
    role,
    faction,
    abilities,
    assignedTarget: null,
    nightTarget: null,
    nightTarget2: null,
    nightAbility: null,
    jailTarget: null,
    revealed: false,
    lastWill: '',
    deathNote: '',
    vote: null,
    verdict: null,
    ...extra,
  };
}

const ab = (
  id: string,
  name: string,
  timing: AbilityInfo['timing'],
  targetDomain: AbilityInfo['targetDomain'],
  verb: string,
  usesRemaining: number | null = null,
): AbilityInfo => ({ id, name, timing, usesRemaining, targetDomain, verb });

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

const lastSent = () => sent[sent.length - 1] as Record<string, unknown>;

describe('Arsonist: both night abilities render (gap A1/A10)', () => {
  const DOUSE = ab('douse', 'Douse', 'night', 'living', 'Douse');
  const IGNITE = ab('ignite', 'Ignite', 'night', 'none', 'Ignite');
  const SEATS = [seat(0, true, 'Arso'), seat(1, true, 'Mark'), seat(2, true, 'Other')];

  it('shows a living douse picker AND a self-toggle ignite button', () => {
    useStore.setState({ own: ownFor('ARSONIST', 'NEUTRAL_KILLING', [DOUSE, IGNITE]) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);

    // Both ability headers present.
    expect(screen.getByText(GAME.tonightVerb('Douse'))).toBeInTheDocument();
    expect(screen.getByText(GAME.tonightVerb('Ignite'))).toBeInTheDocument();

    // Douse is a living-seat picker (a target grid).
    const douseGrid = within(screen.getByRole('group', { name: 'Douse' }));
    expect(douseGrid.getByText(/2 · Mark/)).toBeInTheDocument();

    // Ignite is a button (self-toggle), not a grid.
    expect(screen.queryByRole('group', { name: 'Ignite' })).not.toBeInTheDocument();
  });

  it('clicking a douse target sends night_action(douse, seat)', () => {
    useStore.setState({ own: ownFor('ARSONIST', 'NEUTRAL_KILLING', [DOUSE, IGNITE]) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Douse' })).getByText(/2 · Mark/));
    expect(useStore.getState().own?.nightAbility).toBe('douse');
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'douse', target: 1 });
  });

  it('clicking Ignite sends night_action(ignite, null) and arms the toggle', () => {
    useStore.setState({ own: ownFor('ARSONIST', 'NEUTRAL_KILLING', [DOUSE, IGNITE]) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    fireEvent.click(screen.getByText(GAME.selfToggleArm('Ignite')));
    expect(useStore.getState().own?.nightAbility).toBe('ignite');
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'ignite', target: null });
  });
});

describe('Self-toggle abilities render a button, not a grid (gap A3/A4/H5)', () => {
  const ALERT = ab('alert', 'Alert', 'night', 'self', 'Alert', 2);
  const SEATS = [seat(0, true, 'Vet'), seat(1, true, 'Other')];

  it('Veteran alert renders an arm button with uses, no seat grid', () => {
    useStore.setState({ own: ownFor('VETERAN', 'TOWN', [ALERT]) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    expect(screen.queryByRole('group', { name: 'Alert' })).not.toBeInTheDocument();
    expect(screen.queryByText(/2 · Other/)).not.toBeInTheDocument();
    // Uses are shown.
    expect(screen.getByText(GAME.tonightVerb('Alert'))).toBeInTheDocument();

    fireEvent.click(screen.getByText((t) => t.startsWith(GAME.selfToggleArm('Alert'))));
    expect(useStore.getState().own?.nightAbility).toBe('alert');
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'alert', target: null });
  });

  it('an already-armed toggle does not re-send (single-shot armed state)', () => {
    useStore.setState({
      own: ownFor('VETERAN', 'TOWN', [ALERT], { nightAbility: 'alert', nightTarget: null }),
    });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    expect(
      screen.getByText((t) => t.startsWith(GAME.selfToggleArmed('Alert'))),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Alert ✓'));
    expect(sent.length).toBe(0);
  });
});

describe('Dead-target abilities list DEAD seats (gap A7/A8/A9)', () => {
  const AUTOPSY = ab('autopsy', 'Autopsy', 'night', 'dead', 'Autopsy');
  // Seat 0 = Coroner (alive), 1 = alive, 2 = dead (revealed Doctor), 3 = dead.
  const SEATS = [
    seat(0, true, 'Coroner'),
    seat(1, true, 'Living'),
    seat(2, false, 'Corpse', { role: 'DOCTOR' }),
    seat(3, false, 'Stiff'),
  ];

  it('Coroner autopsy grid lists dead seats only and submits night_action(autopsy, deadSeat)', () => {
    useStore.setState({ own: ownFor('CORONER', 'TOWN', [AUTOPSY]) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    const grid = within(screen.getByRole('group', { name: 'Autopsy' }));
    // Dead seats present.
    expect(grid.getByText(/3 · Corpse/)).toBeInTheDocument();
    expect(grid.getByText(/4 · Stiff/)).toBeInTheDocument();
    // Living seats absent.
    expect(grid.queryByText(/1 · Coroner/)).not.toBeInTheDocument();
    expect(grid.queryByText(/2 · Living/)).not.toBeInTheDocument();

    fireEvent.click(grid.getByText(/3 · Corpse/));
    expect(useStore.getState().own?.nightTarget).toBe(2);
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'autopsy', target: 2 });
  });
});

describe('Jailor cell at night (gap A2/C4)', () => {
  const EXEC = ab('kill_jailor', 'Execute', 'night', 'living', 'Execute', 3);
  const SEATS = [seat(0, true, 'Jailor'), seat(1, true, 'Prisoner'), seat(2, true, 'Free')];

  it('with a prisoner: shows the cell, Execute targets the prisoner, no free grid', () => {
    useStore.setState({ own: ownFor('JAILOR', 'TOWN', [EXEC], { jailTarget: 1 }) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    expect(screen.getByText(GAME.cellTitle)).toBeInTheDocument();
    // No free target grid (the non-prisoner seat 2 is not a clickable option).
    expect(screen.queryByText(/3 · Free/)).not.toBeInTheDocument();
    // Executions remaining surfaced.
    expect(screen.getByText(GAME.executionsLeft(3))).toBeInTheDocument();

    fireEvent.click(screen.getByText(GAME.cellExecute(`2 · Prisoner`)));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'kill_jailor', target: 1 });
  });

  it('Spare sends a cancel (kill_jailor, null)', () => {
    useStore.setState({ own: ownFor('JAILOR', 'TOWN', [EXEC], { jailTarget: 1 }) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    fireEvent.click(screen.getByText(GAME.cellSpare));
    expect(useStore.getState().own?.nightTarget).toBeNull();
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'kill_jailor', target: null });
  });

  it('with no prisoner: shows the cannot-execute message and no buttons', () => {
    useStore.setState({ own: ownFor('JAILOR', 'TOWN', [EXEC], { jailTarget: null }) });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    expect(screen.getByText(GAME.cellNoPrisoner)).toBeInTheDocument();
    expect(screen.queryByText(/3 · Free/)).not.toBeInTheDocument();
  });
});

describe('Guardian Angel shield restricted to the charge (gap H2)', () => {
  const SHIELD = ab('shield', 'Watch over', 'night', 'living', 'Shield');
  const SEATS = [seat(0, true, 'Angel'), seat(1, true, 'Charge'), seat(2, true, 'Stranger')];

  it('offers only the charge as a target', () => {
    useStore.setState({
      own: ownFor('GUARDIAN_ANGEL', 'NEUTRAL_BENIGN', [SHIELD], { assignedTarget: 1 }),
    });
    render(<OwnPanel seats={SEATS} phase="NIGHT" />);
    // The charge is named (also echoed on the role card, hence getAllByText);
    // only one shield BUTTON targets it, and no stranger is offered.
    expect(screen.getAllByText(GAME.yourCharge('2 · Charge')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/3 · Stranger/)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Shield' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(GAME.shieldCharge('2 · Charge')));
    expect(useStore.getState().own?.nightTarget).toBe(1);
    expect(lastSent()).toEqual({ v: V, type: 'night_action', ability: 'shield', target: 1 });
  });
});

describe('Executioner mark on the role card (gap A11)', () => {
  it('shows "Your mark" prominently when assignedTarget is set', () => {
    const SEATS = [seat(0, true, 'Exe'), seat(1, true, 'Mark')];
    useStore.setState({ own: ownFor('EXECUTIONER', 'NEUTRAL_BENIGN', [], { assignedTarget: 1 }) });
    render(<OwnPanel seats={SEATS} phase="DAY_DISCUSSION" />);
    expect(screen.getByText(GAME.yourMark('2 · Mark'))).toBeInTheDocument();
  });
});
