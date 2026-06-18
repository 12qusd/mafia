/**
 * The lazily-loaded R3F host. This is the ONLY module that pulls in three.js /
 * @react-three/fiber at the top level, so importing it triggers the heavy
 * code-split chunk. It is reached exclusively through AnimationStage's
 * React.lazy + a `shouldMountCanvas` guard, so reduced-motion users and jsdom
 * tests never load or execute it.
 *
 * Responsibilities:
 *  - drive a single <Canvas> with capped DPR and frameloop="demand",
 *  - track the current mood (from store.game.phase) in a ref the scene eases to,
 *  - kick a brief continuous render window on phase change / death so the
 *    cross-fade and cinematics animate, then fall idle to save the GPU,
 *  - pause entirely when the tab is hidden.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import type { Phase, DeathAnnounce } from '@nocturne/shared';
import { useStore } from '../../store/store.js';
import {
  moodForPhase,
  transitionForChange,
  deathSpecForTier,
  effectForCause,
  type SceneMood,
  type PhaseTransition,
} from '../../lib/anim.js';
import { SceneContent } from './SceneContent.js';
import { TransitionFlourish } from './TransitionFlourish.js';
import { DeathCinematic, type DeathCue } from './DeathCinematic.js';

/**
 * Bridges React state changes (mood, cues) into the imperative render loop.
 * While any animation is "live" we ask R3F to keep rendering; otherwise we let
 * frameloop="demand" idle. A heartbeat invalidate keeps ambient drift alive at
 * a gentle cadence even when otherwise idle.
 */
function RenderPump({ activeUntil }: { activeUntil: React.MutableRefObject<number> }) {
  const { invalidate } = useThree();
  useFrame(() => {
    if (performance.now() < activeUntil.current) {
      invalidate();
    }
  });
  // Ambient heartbeat: a slow tick so fog/lanterns keep drifting subtly.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 90) {
        // ~11fps idle ambiance
        invalidate();
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [invalidate]);
  return null;
}

let cueSeq = 1;

export default function StageCanvas() {
  const phase = useStore((s) => s.game?.phase ?? null) as Phase | null;
  const deathFeed = useStore((s) => s.game?.deathFeed ?? []);
  const ownSeat = useStore((s) => s.own?.seat ?? null);
  const tier = useStore((s) => s.me?.stats?.tier ?? null);
  const seatNameOf = useStore((s) => (seat: number) =>
    s.game?.seats.find((x) => x.seat === seat)?.name ?? `Seat ${seat + 1}`,
  );

  const moodRef = useRef<SceneMood>(moodForPhase(phase));
  const activeUntil = useRef<number>(performance.now() + 1500);
  const prevMood = useRef<SceneMood>(moodForPhase(phase));
  const seenDeaths = useRef<Set<string>>(new Set());

  const [transition, setTransition] = useState<{ t: NonNullable<PhaseTransition>; at: number } | null>(null);
  const [cue, setCue] = useState<DeathCue | null>(null);

  // React to phase → mood changes: cross-fade + transition flourish.
  useEffect(() => {
    const nextMood = moodForPhase(phase);
    moodRef.current = nextMood;
    if (nextMood !== prevMood.current) {
      const trans = transitionForChange(prevMood.current, nextMood);
      prevMood.current = nextMood;
      // Keep rendering through the cross-fade.
      activeUntil.current = performance.now() + 2200;
      if (trans) {
        const at = performance.now();
        setTransition({ t: trans, at });
        window.setTimeout(() => {
          setTransition((cur) => (cur && cur.at === at ? null : cur));
        }, 1700);
      }
    }
  }, [phase]);

  // React to the *head* of the death feed (the item currently being shown by
  // DeathFeed). We accompany it with a cinematic, deduped by a stable key.
  useEffect(() => {
    const head: DeathAnnounce | undefined = deathFeed[0];
    if (!head) return;
    const key = `${head.seat}:${head.cause}:${head.role}`;
    if (seenDeaths.current.has(key)) return;
    seenDeaths.current.add(key);

    const isOwn = ownSeat !== null && head.seat === ownSeat;
    const startedAt = performance.now();
    const next: DeathCue = isOwn
      ? {
          id: cueSeq++,
          own: true,
          spec: deathSpecForTier(tier),
          name: seatNameOf(head.seat),
          startedAt,
        }
      : {
          id: cueSeq++,
          own: false,
          effect: effectForCause(head.cause),
          name: seatNameOf(head.seat),
          startedAt,
        };
    const holdMs = next.spec?.durationMs ?? 1300;
    activeUntil.current = Math.max(activeUntil.current, startedAt + holdMs + 200);
    setCue(next);
    const id = window.setTimeout(() => {
      setCue((cur) => (cur && cur.id === next.id ? null : cur));
    }, holdMs + 150);
    return () => window.clearTimeout(id);
  }, [deathFeed, ownSeat, tier, seatNameOf]);

  // Pause work when the tab is hidden; resume with a brief render window.
  const [hidden, setHidden] = useState<boolean>(
    typeof document !== 'undefined' ? document.hidden : false,
  );
  useEffect(() => {
    const onVis = () => {
      const h = document.hidden;
      setHidden(h);
      if (!h) activeUntil.current = performance.now() + 1200;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return (
    <Canvas
      frameloop={hidden ? 'never' : 'demand'}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
      camera={{ position: [0, 0, 12], fov: 55 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#07060d']} />
      <RenderPump activeUntil={activeUntil} />
      <SceneContent moodRef={moodRef} />
      {transition && <TransitionFlourish transition={transition.t} startedAt={transition.at} />}
      {cue && <DeathCinematic cue={cue} />}
    </Canvas>
  );
}
