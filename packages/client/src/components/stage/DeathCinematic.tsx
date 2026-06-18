/**
 * The choreographed death send-off rendered inside the persistent <Canvas>.
 *
 * Two flavours:
 *  - OWN death: tier-scaled (drifter → kingpin). Restrained ember puff for a
 *    drifter; a screen-wide brass bloom + engraved memorial card + slow-mo for a
 *    kingpin. Driven entirely by `deathSpecForTier`.
 *  - OTHER deaths: a small, cause-appropriate flourish (knife glint, muzzle
 *    flash, noose drop, poison haze, shroud) at a uniform modest scale.
 *
 * The cinematic is mounted while a "cue" is active (paced by the parent, which
 * watches the death feed) and cleans up its geometry/particles on unmount.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type * as THREE from 'three';
import type { CauseEffect, DeathVariantSpec } from '../../lib/anim.js';
import { PALETTE } from './palette.js';

const ACCENT_HEX: Record<DeathVariantSpec['accent'], string> = {
  ember: PALETTE.blood,
  brass: PALETTE.brass,
  gold: PALETTE.amber,
};

export interface DeathCue {
  id: number;
  /** True when this is the local player's own seat. */
  own: boolean;
  /** Tier spec (own deaths only). */
  spec?: DeathVariantSpec;
  /** Cause effect (other deaths). */
  effect?: CauseEffect;
  /** Display name for the memorial card. */
  name?: string;
  startedAt: number;
}

/** A burst of instanced embers that rise, scatter, and fade. */
function EmberBurst({
  count,
  color,
  spread,
  rise,
  startedAt,
  durationMs,
  slowmo,
}: {
  count: number;
  color: string;
  spread: number;
  rise: number;
  startedAt: number;
  durationMs: number;
  slowmo: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      velocities[i * 3] = Math.cos(a) * r * spread;
      velocities[i * 3 + 1] = rise * (0.4 + Math.random());
      velocities[i * 3 + 2] = Math.sin(a) * r * spread * 0.5;
      positions[i * 3] = (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 2] = -6;
    }
    return { positions, velocities };
  }, [count, spread, rise]);

  useFrame(() => {
    const pts = ref.current;
    const mat = matRef.current;
    if (!pts || !mat) return;
    const elapsed = (performance.now() - startedAt) / durationMs;
    const timeScale = 1 - slowmo; // slow-mo stretches perceived motion.
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const p = Math.min(1, elapsed) * timeScale * 6;
      arr[i * 3] = (Math.random() - 0.5) * 0.5 + velocities[i * 3]! * p;
      arr[i * 3 + 1] = velocities[i * 3 + 1]! * p - 0.3 * p * p;
      arr[i * 3 + 2] = -6 + velocities[i * 3 + 2]! * p;
    }
    attr.needsUpdate = true;
    mat.opacity = Math.max(0, 1 - elapsed);
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.22}
        color={color}
        transparent
        opacity={1}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/** A screen-wide brass bloom for the grand (boss/kingpin) send-offs. */
function ScreenBloom({ color, startedAt, durationMs }: { color: string; startedAt: number; durationMs: number }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    const e = (performance.now() - startedAt) / durationMs;
    // Quick flash up, slow fade out.
    const up = Math.min(1, e * 6);
    const down = Math.max(0, 1 - e);
    mat.opacity = 0.5 * up * down;
  });
  return (
    <mesh position={[0, 0, -5]} scale={[120, 70, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** An engraved brass memorial card that rises and settles (capo+). */
function MemorialCard({ name, color, startedAt, durationMs }: { name: string; color: string; startedAt: number; durationMs: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const e = (performance.now() - startedAt) / durationMs;
    const inT = Math.min(1, e * 3);
    g.position.y = -2 + inT * 2; // rise into view
    g.scale.setScalar(0.6 + inT * 0.4);
    const out = e > 0.7 ? Math.max(0, 1 - (e - 0.7) / 0.3) : 1;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && 'opacity' in mat) {
        (mat as THREE.MeshBasicMaterial).transparent = true;
        (mat as THREE.MeshBasicMaterial).opacity = inT * out;
      }
    });
  });
  return (
    <group ref={group} position={[0, 0, -4]}>
      <mesh>
        <planeGeometry args={[6, 2.4]} />
        <meshBasicMaterial color={PALETTE.inkDeep} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <ringGeometry args={[3.0, 3.15, 4]} />
        <meshBasicMaterial color={color} transparent />
      </mesh>
      <Text
        position={[0, 0.35, 0.05]}
        fontSize={0.62}
        color={color}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.08}
        outlineWidth={0}
      >
        {name || 'Rest in peace'}
      </Text>
      <Text
        position={[0, -0.55, 0.05]}
        fontSize={0.32}
        color={PALETTE.moon}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.22}
      >
        REST IN PEACE
      </Text>
    </group>
  );
}

/** A small cause-flavoured flourish for other seats. */
function CauseFlourish({ effect, startedAt }: { effect: CauseEffect; startedAt: number }) {
  const cfg: Record<CauseEffect, { color: string; spread: number; rise: number; count: number }> = {
    knife: { color: PALETTE.blood, spread: 1.4, rise: 0.6, count: 24 },
    shot: { color: PALETTE.amber, spread: 2.2, rise: 0.4, count: 30 },
    noose: { color: PALETTE.brassDim, spread: 0.6, rise: 0.2, count: 16 },
    poison: { color: PALETTE.verdigris, spread: 1.0, rise: 1.2, count: 34 },
    shroud: { color: PALETTE.fog, spread: 1.6, rise: 0.5, count: 28 },
  };
  const c = cfg[effect];
  return (
    <EmberBurst
      count={c.count}
      color={c.color}
      spread={c.spread}
      rise={c.rise}
      startedAt={startedAt}
      durationMs={1200}
      slowmo={0}
    />
  );
}

export function DeathCinematic({ cue }: { cue: DeathCue }) {
  if (cue.own && cue.spec) {
    const spec = cue.spec;
    const color = ACCENT_HEX[spec.accent];
    return (
      <group key={cue.id}>
        <EmberBurst
          count={spec.particles}
          color={color}
          spread={spec.screenWide ? 4 : 2}
          rise={1}
          startedAt={cue.startedAt}
          durationMs={spec.durationMs}
          slowmo={spec.slowmo}
        />
        {spec.screenWide && <ScreenBloom color={color} startedAt={cue.startedAt} durationMs={spec.durationMs} />}
        {spec.memorialCard && (
          <MemorialCard name={cue.name ?? ''} color={color} startedAt={cue.startedAt} durationMs={spec.durationMs} />
        )}
      </group>
    );
  }
  if (cue.effect) {
    return <CauseFlourish key={cue.id} effect={cue.effect} startedAt={cue.startedAt} />;
  }
  return null;
}
