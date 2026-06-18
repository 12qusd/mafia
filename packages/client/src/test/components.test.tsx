import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactionTag, RoleChip, TierBadge } from '../components/common.js';

describe('FactionTag (BUILD_SPEC §13.1 colorblind: color is never the only signal)', () => {
  it('renders a text label and an icon alongside the color class', () => {
    const { container } = render(<FactionTag faction="MAFIA" />);
    // Text label present (not color-only).
    expect(screen.getByText('Mafia')).toBeInTheDocument();
    // Icon (svg) present.
    expect(container.querySelector('svg')).toBeTruthy();
    // Color class applied.
    expect(container.querySelector('.faction-MAFIA')).toBeTruthy();
  });
});

describe('RoleChip', () => {
  it('renders the role name with a faction icon', () => {
    const { container } = render(<RoleChip role="SHERIFF" />);
    expect(screen.getByText('Sheriff')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('TierBadge (goal 1/2: tier name is always shown, not color alone)', () => {
  it('shows the Drifter tier at 0 points', () => {
    const { container } = render(<TierBadge totalPoints={0} />);
    expect(screen.getByText('Drifter')).toBeInTheDocument();
    expect(container.querySelector('.tier-drifter')).toBeTruthy();
  });

  it('shows a higher tier name for a big balance', () => {
    render(<TierBadge totalPoints={5000} />);
    // 3000+ → Boss.
    expect(screen.getByText('Boss')).toBeInTheDocument();
  });
});
