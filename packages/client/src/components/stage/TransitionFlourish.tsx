/**
 * A brief (~1.6s) choreographed title that floats up and fades when the mood
 * changes — "Night falls", "Dawn breaks", "The town gathers", "To the gallows".
 * Rendered as drei <Text> (Georgia-like serif via a safe default font) inside
 * the canvas, purely as a visual flourish layered over the authoritative state.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type * as THREE from 'three';
import type { PhaseTransition } from '../../lib/anim.js';
import { TRANSITION_LABEL } from '../../lib/anim.js';
import { PALETTE } from './palette.js';

const DURATION_MS = 1600;

export function TransitionFlourish({
  transition,
  startedAt,
}: {
  transition: NonNullable<PhaseTransition>;
  startedAt: number;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const e = (performance.now() - startedAt) / DURATION_MS;
    // Float up gently.
    g.position.y = 1 + e * 1.4;
    // Ease in (first 20%), hold, ease out (last 35%).
    let opacity: number;
    if (e < 0.2) opacity = e / 0.2;
    else if (e > 0.65) opacity = Math.max(0, 1 - (e - 0.65) / 0.35);
    else opacity = 1;
    g.traverse((o) => {
      const t = o as THREE.Mesh;
      const mat = t.material as THREE.Material | undefined;
      if (mat && 'opacity' in mat) {
        (mat as THREE.MeshBasicMaterial).transparent = true;
        (mat as THREE.MeshBasicMaterial).opacity = opacity;
      }
    });
  });

  const accent =
    transition === 'gallows'
      ? PALETTE.blood
      : transition === 'daybreak'
        ? PALETTE.amber
        : PALETTE.brass;

  return (
    <group ref={group} position={[0, 1, -3]}>
      <Text
        fontSize={1.4}
        color={accent}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.14}
        outlineWidth={0.01}
        outlineColor={PALETTE.inkDeep}
      >
        {TRANSITION_LABEL[transition]}
      </Text>
    </group>
  );
}
