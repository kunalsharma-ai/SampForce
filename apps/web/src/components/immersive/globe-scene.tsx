'use client';

import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { MotionLevel } from '@/lib/motion';
import { Orbit, Scene, SlowNotice, tokenColor } from './scene';
import { FpsReadout } from './view-controls';

export interface GlobeBar {
  country: string;
  label: string;
  lat: number;
  lng: number;
  /** 0..1 share of the largest value. */
  share: number;
}

export function latLngToVector(lat: number, lng: number, r: number): Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return new Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Country borders from Natural Earth (1:110m), loaded once and drawn as a single line set. */
function useBorders(): BufferGeometry | null {
  const [geo, setGeo] = useState<BufferGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/geo/borders-110m.json')
      .then((r) => r.json() as Promise<number[][]>)
      .then((lines) => {
        if (cancelled) return;
        const pts: number[] = [];
        for (const line of lines) {
          for (let i = 0; i + 3 < line.length; i += 2) {
            const a = latLngToVector(line[i + 1]!, line[i]!, 1.002);
            const b = latLngToVector(line[i + 3]!, line[i + 2]!, 1.002);
            pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
        setGeo(g);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return geo;
}

function Bars({ bars, selected, onHover, onSelect }: { bars: GlobeBar[]; selected: string | null; onHover: (h: { i: number; x: number; y: number } | null) => void; onSelect: (c: string) => void }) {
  const mesh = useRef<InstancedMesh>(null);
  const [base, highlight] = useMemo(() => [tokenColor('chart-1'), tokenColor('chart-4', '#ffb547')], []);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const up = new Vector3(0, 1, 0);
    const mat = new Matrix4();
    bars.forEach((b, i) => {
      const h = 0.02 + 0.32 * b.share;
      const dir = latLngToVector(b.lat, b.lng, 1).normalize();
      const pos = dir.clone().multiplyScalar(1 + h / 2);
      const q = new Quaternion().setFromUnitVectors(up, dir);
      const w = b.country === selected ? 0.018 : 0.012;
      m.setMatrixAt(i, mat.compose(pos, q, new Vector3(w, h, w)));
      m.setColorAt(i, b.country === selected ? highlight : base);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [bars, selected, base, highlight]);
  const pick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId === undefined) return onHover(null);
    onHover({ i: e.instanceId, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  };
  return (
    <instancedMesh
      key={bars.length}
      ref={mesh}
      args={[undefined, undefined, Math.max(1, bars.length)]}
      onPointerMove={pick}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (e.instanceId !== undefined && bars[e.instanceId]) onSelect(bars[e.instanceId]!.country);
      }}
    >
      <cylinderGeometry args={[1, 1, 1, 10]} />
      <meshLambertMaterial emissive={base} emissiveIntensity={0.35} />
    </instancedMesh>
  );
}

export default function GlobeScene({ bars, selected, onSelect, motion, showFps, onContextLost, onSwitch2D, describe }: { bars: GlobeBar[]; selected: string | null; onSelect: (c: string) => void; motion: MotionLevel; showFps: boolean; onContextLost: () => void; onSwitch2D: () => void; describe: (country: string) => string }) {
  const borders = useBorders();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [fps, setFps] = useState<{ fps: number; dpr: number } | null>(null);
  const [slow, setSlow] = useState<number | null>(null);
  const [surface, line] = useMemo(() => [tokenColor('surface-raised', '#1a2240'), tokenColor('muted-foreground', '#9daac8')], []);
  const hovered = hover ? bars[hover.i] : undefined;
  return (
    <div className="relative h-full w-full" style={{ cursor: hovered ? 'pointer' : 'grab' }}>
      <Scene
        motion={motion}
        animating={!interacted}
        camera={[0, 0.6, 3.1]}
        label={`Revenue Globe with ${bars.length} countries. The table beside it holds the same figures.`}
        onContextLost={onContextLost}
        onFps={showFps ? (f, d) => setFps({ fps: f, dpr: d }) : undefined}
        onSlow={setSlow}
      >
        <Orbit motion={motion} autoRotate={!interacted} minDistance={1.6} maxDistance={6} onStart={() => setInteracted(true)} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 2, 4]} intensity={1.4} />
        <mesh>
          <sphereGeometry args={[1, 48, 32]} />
          <meshLambertMaterial color={surface} />
        </mesh>
        {borders && (
          <lineSegments geometry={borders}>
            <lineBasicMaterial color={line} transparent opacity={0.45} />
          </lineSegments>
        )}
        {bars.length > 0 && <Bars bars={bars} selected={selected} onHover={setHover} onSelect={onSelect} />}
      </Scene>
      {hovered && hover && (
        <div className="pointer-events-none absolute z-10 max-w-60 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <span className="font-medium">{hovered.label}</span>
          <span className="block text-muted-foreground">{describe(hovered.country)}</span>
        </div>
      )}
      {showFps && <FpsReadout fps={fps} />}
      <SlowNotice fps={slow} onSwitch={onSwitch2D} />
    </div>
  );
}
