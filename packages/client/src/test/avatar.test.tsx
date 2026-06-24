/**
 * Avatar (QoL social rendering): a DETERMINISTIC, hash-derived noir identicon.
 * Same id → identical SVG markup; different ids differ. No network/storage.
 */

import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { Avatar } from '../components/Avatar.js';

afterEach(cleanup);

function svgHtml(id: string, name: string, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const { container } = render(<Avatar id={id} name={name} size={size} />);
  const svg = container.querySelector('svg');
  return svg?.outerHTML ?? '';
}

describe('Avatar determinism', () => {
  it('renders identical SVG markup for the same id', () => {
    const a = svgHtml('user-123', 'Capone');
    const b = svgHtml('user-123', 'Capone');
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('differs across different ids', () => {
    const a = svgHtml('user-aaa', 'Capone');
    const b = svgHtml('user-bbb', 'Capone');
    expect(a).not.toBe(b);
  });

  it('the visual mark (colors + geometry) depends on id, not the display name', () => {
    // Same id, different names → same hash-derived colors/geometry. Only the SR
    // aria-label and the monogram initial vary, so we strip those before
    // comparing the backdrop + ring + any glyph paths.
    const a = svgHtml('user-xyz', 'Alpha');
    const b = svgHtml('user-xyz', 'Beta');
    const strip = (s: string) =>
      s.replace(/<text[\s\S]*?<\/text>/g, '').replace(/aria-label="[^"]*"/g, '');
    expect(strip(a)).toBe(strip(b));
    // And the hash-derived stroke color is the same for both.
    const colorOf = (s: string) => s.match(/stroke="(#[0-9a-f]+)"/i)?.[1];
    expect(colorOf(a)).toBe(colorOf(b));
  });

  it('exposes role="img" and an aria-label of the username (a11y)', () => {
    const { container } = render(<Avatar id="u1" name="Torrio" size="lg" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Torrio');
  });

  it('honors the size prop (sm < md < lg) and a raw px size', () => {
    const sm = render(<Avatar id="u" name="N" size="sm" />).container.querySelector('svg')!;
    cleanup();
    const lg = render(<Avatar id="u" name="N" size="lg" />).container.querySelector('svg')!;
    expect(Number(sm.getAttribute('width'))).toBeLessThan(Number(lg.getAttribute('width')));
    cleanup();
    const raw = render(<Avatar id="u" name="N" size={40} />).container.querySelector('svg')!;
    expect(raw.getAttribute('width')).toBe('40');
  });

  it('never injects raw HTML — a markup-like name creates no real elements', () => {
    // The name only feeds the SR aria-label (an attribute React escapes) and the
    // monogram initial; it is NEVER parsed as markup. Assert on the DOM, not the
    // serialized string: no <img>/<script> element and no event handler exist.
    const { container } = render(<Avatar id="user-1" name="<img src=x onerror=alert(1)>" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const svg = container.querySelector('svg')!;
    // The aria-label holds the literal text safely as an attribute value.
    expect(svg.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>');
    // No inline onerror handler leaked onto any node.
    expect(container.querySelector('[onerror]')).toBeNull();
  });
});
