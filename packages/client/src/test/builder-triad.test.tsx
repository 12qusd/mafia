/**
 * Custom Setup Builder — RANDOM_TRIAD category + fixed Triad roles (gap 2).
 *
 * The builder must let an author (1) pick a RANDOM_TRIAD random-pool slot, and
 * (2) pick fixed Triad-faction roles (Dragon Head / Enforcer / Vanguard) grouped
 * by faction. The live faction summary must include a Triad row.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useStore } from '../store/store.js';
import { CustomSetupBuilder } from '../components/CustomSetupBuilder.js';
import { BUILDER, FACTION_LABEL } from '../lib/strings-extra.js';

// The builder fetches the author's saved setups; stub the API so the component
// renders without a network. No saved setups for these UI assertions.
vi.mock('../lib/api.js', () => ({
  fetchCustomSetups: vi.fn().mockResolvedValue([]),
  saveCustomSetup: vi.fn(),
  deleteCustomSetup: vi.fn(),
}));

function asRegistered() {
  useStore.setState({
    me: { id: 'u1', name: 'Author', isGuest: false, isAdmin: false, stats: null },
  });
}

describe('Custom Setup Builder: RANDOM_TRIAD + fixed Triad roles (gap 2)', () => {
  beforeEach(() => {
    useStore.getState().resetAll();
    asRegistered();
  });
  afterEach(() => cleanup());

  it('offers a Random Triad option in the slot category picker', () => {
    render(<CustomSetupBuilder />);
    // Default slots are RANDOM_TOWN category placeholders; each exposes a category
    // <select>. The first one must contain a "Random Triad" option.
    const categorySelect = screen.getAllByLabelText(/category$/i)[0] as HTMLSelectElement;
    const opts = within(categorySelect).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toContain(BUILDER.randomTown);
    expect(opts).toContain(BUILDER.randomMafia);
    expect(opts).toContain(BUILDER.randomTriad);
  });

  it('shows a Triad-faction preview chip when a slot is set to RANDOM_TRIAD', () => {
    const { container } = render(<CustomSetupBuilder />);
    const categorySelect = screen.getAllByLabelText(/category$/i)[0] as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: 'RANDOM_TRIAD' } });
    // The preview chip carries the Triad faction class + label (icon + text, not
    // color alone).
    expect(container.querySelector('.role-chip.faction-TRIAD')).toBeTruthy();
    expect(screen.getAllByText(BUILDER.randomTriad).length).toBeGreaterThan(0);
  });

  it('groups fixed-role choices by faction, including a Triad group with the three Triad roles', () => {
    render(<CustomSetupBuilder />);
    // Switch the first slot to a fixed role so its role <select> appears.
    const kindSelect = screen.getAllByLabelText(/kind$/i)[0] as HTMLSelectElement;
    fireEvent.change(kindSelect, { target: { value: 'fixed' } });

    const roleSelect = screen.getAllByLabelText(/role$/i)[0] as HTMLSelectElement;
    // A Triad optgroup exists.
    const triadGroup = roleSelect.querySelector(`optgroup[label="${FACTION_LABEL.TRIAD}"]`);
    expect(triadGroup).toBeTruthy();
    const triadRoleNames = Array.from(triadGroup!.querySelectorAll('option')).map((o) => o.textContent);
    expect(triadRoleNames).toEqual(expect.arrayContaining(['Dragon Head', 'Enforcer', 'Vanguard']));
  });

  it('the live faction summary includes a Triad row', () => {
    render(<CustomSetupBuilder />);
    // FactionTag renders the faction label text; the Triad summary row is present.
    expect(screen.getAllByText(FACTION_LABEL.TRIAD).length).toBeGreaterThan(0);
  });
});
