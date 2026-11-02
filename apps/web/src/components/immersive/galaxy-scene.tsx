'use client';

import type { GalaxyEdge, GalaxyNode } from '@dealflow/types';
import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, type Color, DoubleSide, type InstancedMesh, Matrix4, type Mesh, Quaternion, Vector3 } from 'three';
import type { MotionLevel } from '@/lib/motion';
import { Orbit, Scene, SlowNotice, tokenColor } from './scene';
import { FpsReadout } from './view-controls';
import { nodeColorToken, nodeSize } from '@/lib/galaxy-style';
import { titleCase } from '@/lib/crm';
import { inSentence, useT } from '@/lib/i18n';

export interface GalaxySceneProps {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  positions: Float32Array;
  visible: (n: GalaxyNode) => boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  motion: MotionLevel;
  showFps: boolean;
  onContextLost: () => void;
  onSwitch2D: () => void;
}

/** All nodes as one instanced mesh (one draw call) and all edges as one line set. */
function Graph({ nodes, edges, positions, visible, selectedId, onSelect, onHover }: Omit<GalaxySceneProps, 'motion' | 'showFps' | 'onContextLost' | 'onSwitch2D'> & { onHover: (h: { i: number; x: number; y: number } | null) => void }) {
  const mesh = useRef<InstancedMesh>(null);
  const index = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const maxCompany = useMemo(() => Math.max(0, ...nodes.filter((n) => n.kind === 'company').map((n) => n.value ?? 0)), [nodes]);
  const maxDeal = useMemo(() => Math.max(0, ...nodes.filter((n) => n.kind === 'deal').map((n) => n.value ?? 0)), [nodes]);
  const colors = useMemo(() => {
    const cache = new Map<string, Color>();
    return nodes.map((n) => {
      const t = nodeColorToken(n);
      if (!cache.has(t)) cache.set(t, tokenColor(t));
      return cache.get(t)!;
    });
  }, [nodes]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    nodes.forEach((n, i) => {
      const size = visible(n) ? nodeSize(n, maxCompany, maxDeal) * (n.id === selectedId ? 1.5 : 1) : 0;
      p.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      s.setScalar(size);
      m.setMatrixAt(i, mat.compose(p, q, s));
      m.setColorAt(i, colors[i]!);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [nodes, positions, visible, selectedId, colors, maxCompany, maxDeal]);

  const lines = useMemo(() => {
    const g = new BufferGeometry();
    const pts: number[] = [];
    for (const e of edges) {
      const a = index.get(e.source);
      const b = index.get(e.target);
      if (a === undefined || b === undefined || !visible(nodes[a]!) || !visible(nodes[b]!)) continue;
      pts.push(positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!, positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!);
    }
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, [edges, index, nodes, positions, visible]);
  const edgeColor = useMemo(() => tokenColor('muted-foreground', '#9daac8'), []);

  const pick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const i = e.instanceId;
    if (i === undefined || !visible(nodes[i]!)) return onHover(null);
    onHover({ i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  };

  return (
    <>
      <ambientLight intensity={0.7} />
      <pointLight position={[20, 25, 30]} intensity={600} />
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={edgeColor} transparent opacity={0.22} />
      </lineSegments>
      {selectedId && index.has(selectedId) && <Halo position={[positions[index.get(selectedId)! * 3]!, positions[index.get(selectedId)! * 3 + 1]!, positions[index.get(selectedId)! * 3 + 2]!]} size={nodeSize(nodes[index.get(selectedId)!]!, maxCompany, maxDeal) * 2.4} />}
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, nodes.length]}
        onPointerMove={pick}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined && visible(nodes[e.instanceId]!)) onSelect(nodes[e.instanceId]!.id);
        }}
      >
        <sphereGeometry args={[1, 14, 10]} />
        <meshLambertMaterial />
      </instancedMesh>
    </>
  );
}

/** Marks the selected record with a ring that always faces the camera. */
function Halo({ position, size }: { position: [number, number, number]; size: number }) {
  const color = useMemo(() => tokenColor('chart-4', '#ffb547'), []);
  const ref = useRef<Mesh>(null);
  useFrame(({ camera }) => ref.current?.quaternion.copy(camera.quaternion));
  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[size * 0.82, size, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} side={DoubleSide} />
    </mesh>
  );
}

export default function GalaxyScene(props: GalaxySceneProps) {
  const t = useT();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [fps, setFps] = useState<{ fps: number; dpr: number } | null>(null);
  const [slow, setSlow] = useState<number | null>(null);
  const hovered = hover ? props.nodes[hover.i] : undefined;
  const companyCount = props.nodes.filter((n) => n.kind === 'company').length;
  return (
    <div className="relative h-full w-full" style={{ cursor: hovered ? 'pointer' : 'grab' }}>
      <Scene
        motion={props.motion}
        animating={!interacted}
        camera={[0, 0, 26]}
        label={t.plural('count.galaxyCompanies', companyCount)}
        onContextLost={props.onContextLost}
        onFps={props.showFps ? (f, d) => setFps({ fps: f, dpr: d }) : undefined}
        onSlow={setSlow}
      >
        <Orbit motion={props.motion} autoRotate={!interacted} onStart={() => setInteracted(true)} />
        <Graph {...props} onHover={setHover} />
      </Scene>
      {hovered && hover && (
        <div className="pointer-events-none absolute z-10 max-w-60 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <span className="font-medium">{hovered.label}</span>
          <span className="block text-muted-foreground">{hovered.kind === 'deal' ? `${t('Deal')} · ${inSentence(t, t.maybe(titleCase(hovered.status ?? '')))}` : hovered.kind === 'company' ? t('Company') : t('Contact')}</span>
        </div>
      )}
      {props.showFps && <FpsReadout fps={fps} />}
      <SlowNotice fps={slow} onSwitch={props.onSwitch2D} />
    </div>
  );
}
