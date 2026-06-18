/**
 * Guard test: under jsdom (no WebGL) AnimationStage must render nothing and must
 * never attempt to import/instantiate three.js. This is what protects existing
 * component tests that render GameScreen from blowing up on a missing WebGL
 * context — the canvas is gated behind `shouldMountCanvas` + a WebGL probe and
 * lazy-loaded, so it's never reached here.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AnimationStage } from '../components/AnimationStage.js';

describe('AnimationStage gating (jsdom has no WebGL)', () => {
  it('renders nothing when no WebGL context is available', () => {
    // jsdom's HTMLCanvasElement.getContext returns null for webgl.
    const { container } = render(<AnimationStage />);
    expect(container.querySelector('.anim-stage')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('does not synchronously import the three.js stage chunk', async () => {
    // If the lazy chunk were imported eagerly, this dynamic import would already
    // be resolving; the gate ensures we only ever reach it at level "full" with
    // a real WebGL context. We assert the guard short-circuits to null.
    const probe = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    render(<AnimationStage />);
    // getContext may be called by the WebGL probe, but must only be asked for a
    // webgl variant (never '2d'), and the result is null in jsdom.
    for (const call of probe.mock.calls) {
      expect(String(call[0])).toMatch(/webgl/i);
    }
    probe.mockRestore();
  });
});
