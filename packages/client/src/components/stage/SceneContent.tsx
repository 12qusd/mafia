/**
 * The procedural noir backdrop rendered inside the R3F <Canvas>. Everything is
 * low-poly / instanced and cross-fades between moods (no hard cuts): each frame
 * the live colours and light intensities ease toward the current mood's target,
 * so a NIGHT→DAWN→DAY→GALLOWS change reads as a smooth dissolve.
 *
 * This module imports three.js, so it MUST only ever be reached via the lazily
 * loaded AnimationStage (never under jsdom / reduced-motion). Kept GPU-light:
 *  - one big-disc sky gradient + a moon sprite,
 *  - an instanced city silhouette (a handful of boxes),
 *  - instanced drifting fog motes,
 *  - a couple of lantern point-lights,
 *  - a gallows that fades in only for trial/execution moods.
 */

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneMood } from '../../lib/anim.js';
import { MOOD_COLORS, PALETTE } from './palette.js';

const MOTE_COUNT = 90;

/** Ease a colour toward a target, in place. */
function lerpColor(cur: THREE.Color, target: THREE.Color, t: number): void {
  cur.lerp(target, t);
}

function Sky({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  const skyRef = useRef<THREE.Color>(new THREE.Color(MOOD_COLORS.night.sky));
  const horizonRef = useRef<THREE.Color>(new THREE.Color(MOOD_COLORS.night.horizon));
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uSky: { value: new THREE.Color(MOOD_COLORS.night.sky) },
      uHorizon: { value: new THREE.Color(MOOD_COLORS.night.horizon) },
    }),
    [],
  );

  useFrame((_, delta) => {
    const m = MOOD_COLORS[moodRef.current];
    const t = Math.min(1, delta * 1.8);
    lerpColor(skyRef.current, new THREE.Color(m.sky), t);
    lerpColor(horizonRef.current, new THREE.Color(m.horizon), t);
    uniforms.uSky.value.copy(skyRef.current);
    uniforms.uHorizon.value.copy(horizonRef.current);
  });

  return (
    <mesh position={[0, 0, -40]} scale={[120, 70, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        depthWrite={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          uniform vec3 uSky;
          uniform vec3 uHorizon;
          void main() {
            float g = smoothstep(0.0, 0.85, vUv.y);
            vec3 col = mix(uHorizon, uSky, g);
            // Subtle vignette toward the edges for a framed, cinematic feel.
            float d = distance(vUv, vec2(0.5));
            col *= 1.0 - 0.35 * smoothstep(0.4, 0.95, d);
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function Moon({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    const visible = MOOD_COLORS[moodRef.current].moon;
    const mat = matRef.current;
    const mesh = ref.current;
    if (!mat || !mesh) return;
    // Fade the moon's opacity and let it rise/set with the mood.
    const targetOpacity = visible ? 0.9 : 0;
    mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, delta * 1.6);
    const targetY = visible ? 13 : 4;
    mesh.position.y += (targetY - mesh.position.y) * Math.min(1, delta * 1.2);
    mesh.visible = mat.opacity > 0.01;
  });

  return (
    <mesh ref={ref} position={[16, 4, -30]}>
      <circleGeometry args={[3.4, 48]} />
      <meshBasicMaterial
        ref={matRef}
        color={PALETTE.moon}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

/** A low instanced skyline of art-deco towers along the horizon. */
function Skyline() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const towers = useMemo(() => {
    const out: { x: number; h: number; w: number }[] = [];
    let x = -45;
    let seed = 7;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    while (x < 45) {
      const w = 2 + rng() * 4;
      const h = 5 + rng() * 16;
      out.push({ x, h, w });
      x += w + 0.6 + rng() * 1.4;
    }
    return out;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  useMemo(() => {
    // Position instances once.
    const mesh = ref.current;
    if (!mesh) return;
    towers.forEach((t, i) => {
      dummy.position.set(t.x, -8 + t.h / 2, -26);
      dummy.scale.set(t.w, t.h, 1.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [towers, dummy]);

  // Ensure instances are set even if ref attached after first memo run.
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh || (mesh.userData['placed'] as boolean)) return;
    towers.forEach((t, i) => {
      dummy.position.set(t.x, -8 + t.h / 2, -26);
      dummy.scale.set(t.w, t.h, 1.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData['placed'] = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, towers.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={PALETTE.inkDeep} roughness={1} metalness={0} />
    </instancedMesh>
  );
}

/** Drifting fog motes — instanced points that slowly rise and recycle. */
function Fog({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(MOTE_COUNT * 3);
    const speeds = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = -10 - Math.random() * 18;
      speeds[i] = 0.3 + Math.random() * 0.9;
    }
    return { positions, speeds };
  }, []);

  const color = useRef<THREE.Color>(new THREE.Color(MOOD_COLORS.night.atmosphere));

  useFrame((_, delta) => {
    const pts = ref.current;
    const mat = matRef.current;
    if (!pts || !mat) return;
    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const yi = i * 3 + 1;
      const xi = i * 3;
      let y = (arr[yi] ?? 0) + (speeds[i] ?? 0) * dt;
      if (y > 16) y = -16;
      arr[yi] = y;
      arr[xi] = (arr[xi] ?? 0) + Math.sin((y + i) * 0.2) * dt * 0.3;
    }
    attr.needsUpdate = true;

    const m = MOOD_COLORS[moodRef.current];
    color.current.lerp(new THREE.Color(m.atmosphere), Math.min(1, delta * 1.5));
    mat.color.copy(color.current);
    // Fog is densest at night, sparsest by day.
    const targetOpacity = moodRef.current === 'night' ? 0.5 : moodRef.current === 'gallows' ? 0.4 : 0.22;
    mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, delta * 1.5);
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.9}
        transparent
        opacity={0.4}
        depthWrite={false}
        sizeAttenuation
        color={PALETTE.fog}
      />
    </points>
  );
}

/** Two warm street lanterns that breathe and warm up by day. */
function Lanterns({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  const l1 = useRef<THREE.PointLight>(null);
  const l2 = useRef<THREE.PointLight>(null);
  useFrame((state, delta) => {
    const m = MOOD_COLORS[moodRef.current];
    const flicker = 0.85 + Math.sin(state.clock.elapsedTime * 6) * 0.08;
    const target = (moodRef.current === 'night' ? 2.4 : 0.8) * flicker;
    for (const ref of [l1, l2]) {
      const light = ref.current;
      if (!light) continue;
      light.intensity += (target - light.intensity) * Math.min(1, delta * 2);
      light.color.lerp(new THREE.Color(m.key), Math.min(1, delta * 1.5));
    }
  });
  return (
    <>
      <pointLight ref={l1} position={[-12, -2, -8]} color={PALETTE.amber} intensity={1.2} distance={28} decay={1.4} />
      <pointLight ref={l2} position={[12, -2, -8]} color={PALETTE.amber} intensity={1.2} distance={28} decay={1.4} />
    </>
  );
}

/** A gallows + slowly swaying noose that fades in for trial/execution moods. */
function Gallows({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  const group = useRef<THREE.Group>(null);
  const rope = useRef<THREE.Group>(null);
  const opacityRef = useRef(0);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const visible = MOOD_COLORS[moodRef.current].gallows;
    const target = visible ? 1 : 0;
    opacityRef.current += (target - opacityRef.current) * Math.min(1, delta * 1.4);
    const o = opacityRef.current;
    g.visible = o > 0.01;
    g.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && 'opacity' in mat) {
        (mat as THREE.MeshStandardMaterial).transparent = true;
        (mat as THREE.MeshStandardMaterial).opacity = o;
      }
    });
    // Slow, ominous sway and a slow tightening descent.
    if (rope.current) {
      rope.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.7) * 0.08 * o;
    }
    g.position.y = -8 + (1 - o) * -2;
  });

  return (
    <group ref={group} position={[0, -8, -12]} visible={false}>
      {/* Posts + beam */}
      <mesh position={[-3, 4, 0]}>
        <boxGeometry args={[0.4, 8, 0.4]} />
        <meshStandardMaterial color={PALETTE.brassDim} roughness={0.8} />
      </mesh>
      <mesh position={[3, 4, 0]}>
        <boxGeometry args={[0.4, 8, 0.4]} />
        <meshStandardMaterial color={PALETTE.brassDim} roughness={0.8} />
      </mesh>
      <mesh position={[0, 8, 0]}>
        <boxGeometry args={[6.6, 0.4, 0.4]} />
        <meshStandardMaterial color={PALETTE.brassDim} roughness={0.8} />
      </mesh>
      {/* Noose */}
      <group ref={rope} position={[0, 8, 0]}>
        <mesh position={[0, -2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 4, 6]} />
          <meshStandardMaterial color={PALETTE.brass} roughness={0.9} />
        </mesh>
        <mesh position={[0, -4.2, 0]}>
          <torusGeometry args={[0.4, 0.07, 6, 16]} />
          <meshStandardMaterial color={PALETTE.brass} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/** Lights that ease toward the current mood. */
function MoodLights({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  useFrame((_, delta) => {
    const m = MOOD_COLORS[moodRef.current];
    const t = Math.min(1, delta * 1.6);
    if (key.current) {
      key.current.intensity += (m.keyIntensity - key.current.intensity) * t;
      key.current.color.lerp(new THREE.Color(m.key), t);
    }
    if (ambient.current) {
      ambient.current.intensity += (m.ambient - ambient.current.intensity) * t;
    }
  });
  return (
    <>
      <ambientLight ref={ambient} intensity={0.22} />
      <directionalLight ref={key} position={[6, 12, 6]} intensity={0.5} color={PALETTE.brass} />
    </>
  );
}

export function SceneContent({ moodRef }: { moodRef: React.MutableRefObject<SceneMood> }) {
  // Gentle camera parallax so the scene never feels static.
  const { camera } = useThree();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.position.x = Math.sin(t * 0.08) * 1.2;
    camera.position.y = Math.cos(t * 0.06) * 0.6;
    camera.lookAt(0, 0, -20);
  });

  return (
    <>
      <Sky moodRef={moodRef} />
      <MoodLights moodRef={moodRef} />
      <Moon moodRef={moodRef} />
      <Skyline />
      <Lanterns moodRef={moodRef} />
      <Fog moodRef={moodRef} />
      <Gallows moodRef={moodRef} />
    </>
  );
}
