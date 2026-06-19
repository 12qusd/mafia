/**
 * Public role glossary tests (BUILD_SPEC §13.1).
 *
 * The glossary must list EVERY role in `ALL_ROLES` with the SAME canonical copy
 * shown on a player's own hand (anti fake-verify), be searchable, and be
 * dismissable. These run in jsdom — the glossary is plain DOM, no WebGL.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ALL_ROLES } from '@nocturne/shared';
import { Glossary, abilitySummary } from '../components/Glossary.js';

describe('Glossary — "The Cast"', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Glossary open={false} onClose={() => {}} />);
    expect(container.querySelector('.glossary-modal')).toBeNull();
  });

  it('renders an entry for every role in ALL_ROLES', () => {
    const { container } = render(<Glossary open onClose={() => {}} />);
    const entries = container.querySelectorAll('.glossary-entry');
    // One card per registered role — the count must match exactly (~52).
    expect(entries.length).toBe(ALL_ROLES.length);
    // Each role id appears exactly once.
    for (const def of ALL_ROLES) {
      expect(container.querySelector(`[data-role="${def.id}"]`)).toBeTruthy();
    }
  });

  it('shows the canonical name, tagline, description, and win hint for each role', () => {
    const { container } = render(<Glossary open onClose={() => {}} />);
    for (const def of ALL_ROLES) {
      const entry = container.querySelector(`[data-role="${def.id}"]`);
      expect(entry).toBeTruthy();
      const text = (entry as HTMLElement).textContent ?? '';
      // Same source-of-truth strings as the own-role card in OwnPanel.
      expect(text).toContain(def.name);
      expect(text).toContain(def.tagline);
      expect(text).toContain(def.description);
      expect(text).toContain(def.winHint);
    }
  });

  it('reports the full role count in the toolbar', () => {
    render(<Glossary open onClose={() => {}} />);
    expect(screen.getByText(`${ALL_ROLES.length} roles`)).toBeInTheDocument();
  });

  it('filters the list by role name', () => {
    const { container } = render(<Glossary open onClose={() => {}} />);
    const search = screen.getByPlaceholderText(/search/i);
    fireEvent.change(search, { target: { value: 'Sheriff' } });
    const entries = container.querySelectorAll('.glossary-entry');
    expect(entries.length).toBe(1);
    expect(container.querySelector('[data-role="SHERIFF"]')).toBeTruthy();
  });

  it('filters the list by faction', () => {
    const { container } = render(<Glossary open onClose={() => {}} />);
    const townCount = ALL_ROLES.filter((r) => r.faction === 'TOWN').length;
    const search = screen.getByPlaceholderText(/search/i);
    fireEvent.change(search, { target: { value: 'town' } });
    const entries = container.querySelectorAll('.glossary-entry');
    expect(entries.length).toBe(townCount);
    // Every shown entry is a Town role.
    for (const e of entries) {
      const id = e.getAttribute('data-role')!;
      expect(ALL_ROLES.find((r) => r.id === id)!.faction).toBe('TOWN');
    }
  });

  it('shows an empty-state when nothing matches', () => {
    const { container } = render(<Glossary open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'zzzznomatch' },
    });
    expect(container.querySelectorAll('.glossary-entry').length).toBe(0);
    expect(screen.getByText(/no role answers/i)).toBeInTheDocument();
  });

  it('closes on Escape, on backdrop click, and via the close button', () => {
    // Escape.
    let open = true;
    const { rerender, container } = render(
      <Glossary open onClose={() => (open = false)} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(open).toBe(false);

    // Backdrop click.
    open = true;
    rerender(<Glossary open onClose={() => (open = false)} />);
    fireEvent.click(screen.getByTestId('glossary-overlay'));
    expect(open).toBe(false);

    // Clicking inside the dialog does NOT close.
    open = true;
    rerender(<Glossary open onClose={() => (open = false)} />);
    fireEvent.click(container.querySelector('.glossary-modal')!);
    expect(open).toBe(true);

    // Explicit close button.
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(open).toBe(false);
  });

  it('exposes the dialog with an accessible label', () => {
    render(<Glossary open onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label');
  });

  it('derives a non-empty ability summary for every role', () => {
    for (const def of ALL_ROLES) {
      const lines = abilitySummary(def);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l.length).toBeGreaterThan(0);
    }
  });

  it('summarizes a passive role (Citizen) as having no special move', () => {
    const { container } = render(<Glossary open onClose={() => {}} />);
    const citizen = container.querySelector('[data-role="CITIZEN"]')!;
    expect(within(citizen as HTMLElement).getByText(/no special move/i)).toBeTruthy();
  });
});
