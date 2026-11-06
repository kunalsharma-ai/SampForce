import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * The hero's WebGL scene: the SampForce bolt, extruded in 3D, with a vortex of particles (leads) spiralling in from
 * cool cyan and violet to hot coral and amber as they reach it (deals closing). Orbit rings, mouse parallax.
 * Renders one still frame for people who prefer reduced motion, pauses off screen, and falls back to the flat
 * logo when WebGL is unavailable.
 */
export function HeroScene({ reduced }: { reduced: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    const small = window.innerWidth < 760;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    camera.position.set(0, 0, small ? 34 : 31);

    // ---- the bolt: logo outline "41,2 13,37.5 29.5,37.5 24,62 53,27 36.5,27" (SVG y grows downwards) ----
    const pts: [number, number][] = [[41, 2], [13, 37.5], [29.5, 37.5], [24, 62], [53, 27], [36.5, 27]];
    const shape = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? shape.lineTo((x - 33) / 6, -(y - 32) / 6) : shape.moveTo((x - 33) / 6, -(y - 32) / 6)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.22, bevelSegments: 6, curveSegments: 4 });
    geo.center();
    // Vertex colours: amber at the top, ember in the middle, crimson at the tip.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color('#ffd27a'), mid = new THREE.Color('#ff4a3d'), low = new THREE.Color('#9b1515');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + 5) / 10, 0, 1);
      if (t > 0.5) c.copy(mid).lerp(top, (t - 0.5) * 2);
      else c.copy(low).lerp(mid, t * 2);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const boltMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, metalness: 0.25, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15,
      emissive: new THREE.Color('#ff3b2f'), emissiveIntensity: 0.28, sheen: 0.6, sheenColor: new THREE.Color('#ffc857'),
    });
    const bolt = new THREE.Mesh(geo, boltMat);
    const boltGroup = new THREE.Group();
    boltGroup.add(bolt);
    scene.add(boltGroup);

    // Soft glow behind the bolt.
    const glowTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const g = cv.getContext('2d')!;
      const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, 'rgba(255,120,80,0.9)');
      grd.addColorStop(0.35, 'rgba(255,60,50,0.35)');
      grd.addColorStop(1, 'rgba(255,60,50,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(cv);
    })();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(22, 22, 1);
    glow.position.z = -3;
    scene.add(glow);

    // Lights.
    scene.add(new THREE.AmbientLight('#ffffff', 0.35));
    const key = new THREE.PointLight('#ffd6a0', 260, 60);
    key.position.set(6, 8, 10);
    scene.add(key);
    const rim = new THREE.PointLight('#22d3ee', 220, 60);
    rim.position.set(-9, -4, 4);
    scene.add(rim);
    const back = new THREE.PointLight('#8057ff', 200, 60);
    back.position.set(0, 4, -8);
    scene.add(back);

    // ---- particle vortex ----
    const N = small ? 1600 : 3600;
    const radius = new Float32Array(N), angle = new Float32Array(N), height = new Float32Array(N), speed = new Float32Array(N);
    const positions = new Float32Array(N * 3), pColors = new Float32Array(N * 3), sizes = new Float32Array(N);
    const cold = [new THREE.Color('#22d3ee'), new THREE.Color('#2f6bff'), new THREE.Color('#8057ff')];
    const hot = [new THREE.Color('#ff8a8a'), new THREE.Color('#ff5a4e'), new THREE.Color('#ffc857')];
    const R_MAX = 22, R_MIN = 2.2;
    const reset = (i: number, anywhere: boolean) => {
      radius[i] = anywhere ? R_MIN + Math.random() * (R_MAX - R_MIN) : R_MAX * (0.8 + Math.random() * 0.25);
      angle[i] = Math.random() * Math.PI * 2;
      height[i] = (Math.random() - 0.5) * 9;
      speed[i] = 0.6 + Math.random() * 0.9;
      sizes[i] = 0.6 + Math.random() * 1.8;
    };
    for (let i = 0; i < N; i++) reset(i, true);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
    pGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { uPixel: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute float size; varying vec3 vColor; uniform float uPixel;
        void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uPixel*(42.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vColor; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); gl_FragColor=vec4(vColor*1.4,a*a); }`,
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pGeo, pMat);
    points.rotation.x = 0.42;
    scene.add(points);

    const writeParticles = (dt: number) => {
      for (let i = 0; i < N; i++) {
        angle[i] += (speed[i] * dt * 2.2) / Math.max(radius[i], 1.5);
        radius[i] -= dt * speed[i] * 1.15;
        height[i] *= 1 - dt * 0.35;
        if (radius[i] < R_MIN) reset(i, false);
        const r = radius[i];
        positions[i * 3] = Math.cos(angle[i]) * r;
        positions[i * 3 + 1] = height[i] * (r / R_MAX) * 1.4;
        positions[i * 3 + 2] = Math.sin(angle[i]) * r;
        const t = 1 - (r - R_MIN) / (R_MAX - R_MIN); // 0 far, 1 near the bolt
        const k = i % 3;
        c.copy(cold[k]).lerp(hot[k], THREE.MathUtils.smoothstep(t, 0.35, 0.95));
        const fade = Math.min(1, (R_MAX - r) / 3) * (0.35 + t * 0.9);
        pColors[i * 3] = c.r * fade;
        pColors[i * 3 + 1] = c.g * fade;
        pColors[i * 3 + 2] = c.b * fade;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    };

    // ---- orbit rings ----
    const rings: THREE.Mesh[] = [];
    ([['#22d3ee', 8.5, 0.5], ['#8057ff', 11.5, -0.7], ['#ffc857', 14.5, 0.25]] as const).forEach(([col, r, tilt]) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.025, 8, 220),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
      );
      ring.rotation.set(Math.PI / 2 + tilt, tilt * 0.6, 0);
      scene.add(ring);
      rings.push(ring);
      // a bright bead travelling on each ring
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color: col }));
      bead.position.set(r, 0, 0);
      ring.add(bead);
    });

    // ---- sizing, input, loop ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      // keep the bolt to the right on wide screens, centred on phones
      boltGroup.position.x = w > 1000 ? 9.5 : 0;
      points.position.x = glow.position.x = boltGroup.position.x;
      rings.forEach((r) => (r.position.x = boltGroup.position.x));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const mouse = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      writeParticles(dt);
      boltGroup.rotation.y = Math.sin(t * 0.5) * 0.55 + mouse.x * 0.35;
      boltGroup.rotation.x = Math.sin(t * 0.37) * 0.12 + mouse.y * 0.15;
      boltGroup.position.y = Math.sin(t * 0.9) * 0.35;
      boltMat.emissiveIntensity = 0.25 + Math.max(0, Math.sin(t * 2.4)) ** 8 * 0.9; // a periodic "strike"
      glow.material.opacity = 0.7 + Math.sin(t * 1.3) * 0.15 + (boltMat.emissiveIntensity - 0.25) * 0.4;
      points.rotation.y = t * 0.04;
      rings.forEach((r, i) => (r.rotation.z = t * (0.18 + i * 0.07) * (i % 2 ? -1 : 1)));
      camera.position.x += (mouse.x * 1.6 - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 1.0 - camera.position.y) * 0.04;
      camera.lookAt(boltGroup.position.x * 0.5, 0, 0);
      renderer.render(scene, camera);
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (visible && !document.hidden) frame();
    };
    if (reduced) {
      for (let i = 0; i < 40; i++) writeParticles(0.05);
      renderer.render(scene, camera);
    } else loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      glowTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reduced]);

  return (
    <div ref={host} className="hero-scene" aria-hidden>
      {failed && <div className="hero-fallback" />}
    </div>
  );
}
