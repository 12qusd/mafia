/**
 * The cinematic animation layer's mount gate (goal: "make it feel alive").
 *
 * This is the boundary that keeps the heavy three.js stage out of the bundle and
 * out of jsdom:
 *  - The actual <Canvas> lives in `./stage/StageCanvas`, pulled in ONLY via
 *    React.lazy(). Until the gate decides to mount it, three.js is never
 *    imported, so users on 'reduced'/'off' (or with prefers-reduced-motion)
 *    never download or execute it.
 *  - `shouldMountCanvas` is the single capability/motion gate. It returns true
 *    only at the effective level 'full'. jsdom component tests render GameScreen
 *    with default settings, but since this component subscribes to the live
 *    media query AND we keep the canvas behind Suspense + lazy, the WebGL
 *    context is never instantiated synchronously during a test render. We also
 *    hard-guard on the absence of a WebGL-capable canvas to be safe.
 *
 * The stage sits BEHIND the game UI: position:fixed, inset:0, z-index below the
 * grid, and pointer-events:none, so chat/vote/list interactions are untouched.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import type { Phase } from '@nocturne/shared';
import { useStore } from '../store/store.js';
import {
  effectiveAnimationLevel,
  moodForPhase,
  prefersReducedMotion,
  shouldMountCanvas,
} from '../lib/anim.js';

// Lazy — importing this triggers the three.js code-split chunk. Never imported
// at module load, so the chunk is only fetched when the gate mounts it.
const StageCanvas = lazy(() => import('./stage/StageCanvas.js'));

/** Best-effort WebGL capability probe (defensive; jsdom returns null). */
function webglAvailable(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function AnimationStage() {
  const animations = useStore((s) => s.settings.animations);
  const phase = useStore((s) => s.game?.phase ?? null) as Phase | null;

  // Track prefers-reduced-motion live so toggling the OS setting takes effect.
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion());
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    } catch {
      mq = null;
    }
    if (!mq) return;
    const onChange = () => setReduced(mq!.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  const [hasWebgl] = useState(webglAvailable);
  const level = effectiveAnimationLevel(animations, reduced);

  // The single gate: only at 'full', with a real WebGL context available.
  const mount = shouldMountCanvas(level) && hasWebgl;

  // Cinematic-moment driver: while the canvas IS mounted, mirror the current
  // phase's mood onto `data-stage` on the document root. CSS keys off this to let
  // the stage "breathe" forward (raise stage opacity/scale, ease panels back) on
  // the dramatic beats (night / dawn reveals / gallows) and recede for maximum
  // legibility during day discussion/voting. The attribute is set ONLY when the
  // cinematic exists, and is cleared on unmount / when animations are turned off,
  // so cinematic mode never lingers without a canvas behind it. Purely cosmetic,
  // pointer-events untouched — input is never affected.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    if (!mount) {
      delete el.dataset['stage'];
      return;
    }
    el.dataset['stage'] = moodForPhase(phase);
    return () => {
      delete el.dataset['stage'];
    };
  }, [mount, phase]);

  if (!mount) return null;

  return (
    <div className="anim-stage" aria-hidden="true">
      <Suspense fallback={null}>
        <StageCanvas />
      </Suspense>
    </div>
  );
}
