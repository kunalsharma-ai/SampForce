'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Color } from 'three';
import { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MotionLevel } from '@/lib/motion';

/** Reads a design token (an HSL triplet such as "189 100% 50%") as a three.js colour. */
export function tokenColor(name: string, fallback = '#00d9ff'): Color {
  if (typeof window === 'undefined') return new Color(fallback);
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const m = v.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  return m ? new Color().setHSL(Number(m[1]) / 360, Number(m[2]) / 100, Number(m[3]) / 100) : new Color(fallback);
}

const MAX_DPR = 2;

/**
 * Keeps the frame rate near the 60 FPS budget: when frames run slow for a second the pixel ratio steps down (to 1),
 * and steps back up after a sustained good stretch. Reports the measured rate for the optional on-screen readout.
 */
function AdaptiveQuality({ onFps, onSlow }: { onFps?: (fps: number, dpr: number) => void; onSlow?: (fps: number) => void }) {
  const { setDpr, viewport } = useThree();
  const acc = useRef({ frames: 0, time: 0, good: 0, slow: 0, told: false });
  useFrame((_, delta) => {
    const a = acc.current;
    // Ignore gaps (tab hidden, on-demand rendering paused) so they do not read as slow frames.
    if (delta > 0.25) return;
    a.frames += 1;
    a.time += delta;
    if (a.time < 1) return;
    const fps = a.frames / a.time;
    const dpr = viewport.dpr;
    if (fps < 50 && dpr > 1) {
      setDpr(Math.max(1, dpr - 0.5));
      a.good = 0;
    } else if (fps >= 58) {
      a.good += 1;
      if (a.good >= 3 && dpr < Math.min(MAX_DPR, window.devicePixelRatio || 1)) {
        setDpr(Math.min(MAX_DPR, dpr + 0.5));
        a.good = 0;
      }
    } else a.good = 0;
    // Already at the lowest pixel ratio and still well under budget for three seconds: offer the 2D view.
    a.slow = fps < 24 && dpr <= 1 ? a.slow + 1 : 0;
    if (a.slow >= 3 && !a.told) {
      a.told = true;
      onSlow?.(Math.round(fps));
    }
    onFps?.(Math.round(fps), dpr);
    a.frames = 0;
    a.time = 0;
  });
  return null;
}

/** On-demand rendering draws only on change; a few early redraws make sure late-loading data and sizing land. */
function SettleFrames() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const ids = [60, 300, 1000, 2500].map((t) => setTimeout(() => invalidate(), t));
    return () => ids.forEach(clearTimeout);
  }, [invalidate]);
  return null;
}

/** Orbit, zoom and pan. Under reduced motion there is no auto-rotation and no damping drift. */
export function Orbit({ motion, autoRotate = false, minDistance = 2, maxDistance = 60, onStart }: { motion: MotionLevel; autoRotate?: boolean; minDistance?: number; maxDistance?: number; onStart?: () => void }) {
  const { camera, gl, invalidate } = useThree();
  const ref = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => {
    const c = new OrbitControlsImpl(camera, gl.domElement);
    c.enableDamping = motion === 'full';
    c.dampingFactor = 0.08;
    c.minDistance = minDistance;
    c.maxDistance = maxDistance;
    c.autoRotateSpeed = 0.6;
    const changed = () => invalidate();
    const started = () => onStart?.();
    c.addEventListener('change', changed);
    c.addEventListener('start', started);
    ref.current = c;
    return () => {
      c.removeEventListener('change', changed);
      c.removeEventListener('start', started);
      c.dispose();
      ref.current = null;
    };
  }, [camera, gl, invalidate, motion, minDistance, maxDistance, onStart]);
  useFrame(() => {
    const c = ref.current;
    if (!c) return;
    c.autoRotate = autoRotate && motion === 'full';
    c.update();
  });
  return null;
}

export interface SceneProps {
  motion: MotionLevel;
  /** Continuous rendering while something animates; otherwise frames render only on change. */
  animating: boolean;
  camera: [number, number, number];
  label: string;
  onContextLost: () => void;
  onFps?: (fps: number, dpr: number) => void;
  /** Called once when the device cannot keep up even at the lowest quality. */
  onSlow?: (fps: number) => void;
  children: React.ReactNode;
}

/**
 * The shared 3D canvas. On-demand rendering when nothing moves (no GPU work while idle), a capped and adaptive
 * pixel ratio, and a fallback to 2D if the browser drops the WebGL context.
 */
export function Scene({ motion, animating, camera, label, onContextLost, onFps, onSlow, children }: SceneProps) {
  // Unmounting the canvas (for example switching to 2D) releases the context on purpose; that is not a loss.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Canvas
      role="img"
      aria-label={label}
      frameloop={animating && motion === 'full' ? 'always' : 'demand'}
      dpr={[1, MAX_DPR]}
      camera={{ position: camera, fov: 50, near: 0.05, far: 500 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          if (alive.current) onContextLost();
        });
      }}
    >
      <AdaptiveQuality onFps={onFps} onSlow={onSlow} />
      <SettleFrames />
      {children}
    </Canvas>
  );
}

/** Shown over a scene that renders too slowly on this device, with a one-click way to the 2D view. */
export function SlowNotice({ fps, onSwitch }: { fps: number | null; onSwitch: () => void }) {
  if (fps === null) return null;
  return (
    <div className="absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow" role="status">
      <span>This device is drawing the 3D view slowly (about {fps} frames a second). The 2D view shows the same data.</span>
      <button type="button" onClick={onSwitch} className="rounded border border-border px-2 py-1 font-medium hover:bg-muted">
        Switch to 2D
      </button>
    </div>
  );
}
