/**
 * Hero scene: thousands of particles swirl as a "lead galaxy", then condense into the SampForce bolt,
 * hold, and scatter again. Leads become momentum. Pointer movement pushes particles away and tilts the scene.
 *
 * Plain three.js (no React) so it can be reused anywhere. Call createHeroField(canvas) and keep the
 * returned object to call .dispose() on unmount.
 */
import * as THREE from 'three';

// Bolt polygons from the SampForce icon (viewBox units), split into triangles.
const BOLT_TRIS = [
  [[41, 2], [13, 37.5], [31.5, 37.5]],
  [[41, 2], [31.5, 37.5], [36.5, 27]],
  [[33, 27], [53, 27], [24, 62]],
  [[33, 27], [24, 62], [29.5, 37.5]],
];
// Speed lines left of the bolt (x, y, w, h).
const STREAKS = [[1, 19, 10, 3.4], [-2, 27.5, 8, 3.4], [2, 47, 9, 3.4]];
const OUTLINE = [[41, 2], [13, 37.5], [29.5, 37.5], [24, 62], [53, 27], [36.5, 27], [41, 2]];

const toWorld = ([x, y]) => [(x - 31) / 10.5, -(y - 32) / 10.5];
const area = ([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

function sampleTriangle([a, b, c]) {
  let u = Math.random();
  let v = Math.random();
  if (u + v > 1) { u = 1 - u; v = 1 - v; }
  return [a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]), a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1])];
}

function boltPoint() {
  const r = Math.random();
  let p;
  if (r < 0.22) {
    // Edge points make the silhouette crisp.
    const i = Math.floor(Math.random() * (OUTLINE.length - 1));
    const t = Math.random();
    const a = OUTLINE[i];
    const b = OUTLINE[i + 1];
    p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  } else if (r < 0.3) {
    const [x, y, w, h] = STREAKS[Math.floor(Math.random() * STREAKS.length)];
    p = [x + Math.random() * w, y + Math.random() * h];
  } else {
    const total = BOLT_TRIS.reduce((s, t) => s + area(t), 0);
    let pick = Math.random() * total;
    let tri = BOLT_TRIS[0];
    for (const t of BOLT_TRIS) { pick -= area(t); if (pick <= 0) { tri = t; break; } }
    p = sampleTriangle(tri);
  }
  const [x, y] = toWorld(p);
  return [x, y, (Math.random() - 0.5) * 0.55];
}

function galaxyPoint() {
  const arms = 3;
  const radius = Math.pow(Math.random(), 0.7) * 6.2 + 0.25;
  const arm = Math.floor(Math.random() * arms);
  const angle = (arm / arms) * Math.PI * 2 + radius * 0.85;
  const spread = 0.35 + radius * 0.09;
  const jx = (Math.random() - 0.5) * spread * 2;
  const jz = (Math.random() - 0.5) * spread * 2;
  return [Math.cos(angle) * radius + jx, (Math.random() - 0.5) * 0.4 * (1.2 - radius / 7), Math.sin(angle) * radius + jz, radius];
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uMorph;
  uniform float uSize;
  uniform vec2 uPointer;
  uniform float uPixelRatio;
  attribute vec3 aGalaxy;
  attribute vec3 aBolt;
  attribute vec3 aColorA;
  attribute vec3 aColorB;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;

  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    // Galaxy: differential rotation, tilted towards the viewer.
    vec3 g = aGalaxy;
    float r = length(g.xz);
    g.xz = rot(uTime * (0.22 / (0.6 + r * 0.35)) + aSeed * 0.2) * g.xz;
    g.yz = rot(-1.05) * g.yz;
    g.xy = rot(0.35) * g.xy;

    // Bolt: gentle breathing and shimmer.
    vec3 b = aBolt;
    b += 0.035 * vec3(sin(uTime * 2.1 + aSeed * 40.0), cos(uTime * 1.7 + aSeed * 31.0), sin(uTime * 1.3 + aSeed * 17.0));

    // Staggered morph: each particle travels on its own curve.
    float delay = aSeed * 0.35;
    float t = clamp((uMorph - delay) / (1.0 - 0.35), 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    vec3 mid = mix(g, b, 0.5) + vec3(0.0, 0.0, sin(aSeed * 6.2831) * 2.2);
    vec3 p = mix(mix(g, mid, t), mix(mid, b, t), t);

    // Pointer repulsion in screen-ish space.
    vec2 d = p.xy - uPointer * vec2(6.0, 3.6);
    float f = exp(-dot(d, d) * 0.9) * 0.9;
    p.xy += normalize(d + 0.0001) * f;
    p.z += f * 0.8;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.75 + 0.25 * sin(uTime * 3.0 + aSeed * 100.0);
    gl_PointSize = uSize * uPixelRatio * (0.6 + aSeed * 0.9) * twinkle * (7.0 / -mv.z);
    vColor = mix(aColorA, aColorB, t);
    vAlpha = mix(0.75, 1.0, t) * (0.55 + 0.45 * twinkle);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.2);
    gl_FragColor = vec4(vColor * (0.6 + glow * 1.4), core * vAlpha);
  }
`;

const GALAXY_COLORS = ['#3de0ff', '#9b6bff', '#ff4d8d', '#ffc857', '#ffffff', '#7aa7ff'].map((c) => new THREE.Color(c));

export function createHeroField(canvas, { reducedMotion = false, onPhase } = {}) {
  const small = window.matchMedia('(max-width: 760px)').matches;
  const count = small ? 4200 : 11000;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 11);

  const geo = new THREE.BufferGeometry();
  const galaxy = new Float32Array(count * 3);
  const bolt = new Float32Array(count * 3);
  const colA = new Float32Array(count * 3);
  const colB = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const boltTop = new THREE.Color('#ffd27a');
  const boltMid = new THREE.Color('#ff7a45');
  const boltLow = new THREE.Color('#e0245e');
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const [gx, gy, gz, gr] = galaxyPoint();
    galaxy.set([gx, gy, gz], i * 3);
    const [bx, by, bz] = boltPoint();
    bolt.set([bx, by, bz], i * 3);
    const gc = gr < 1.2 && Math.random() < 0.6 ? GALAXY_COLORS[3] : GALAXY_COLORS[Math.floor(Math.random() * GALAXY_COLORS.length)];
    colA.set([gc.r, gc.g, gc.b], i * 3);
    const k = THREE.MathUtils.clamp((by + 2.9) / 5.8, 0, 1);
    if (k > 0.5) tmp.copy(boltMid).lerp(boltTop, (k - 0.5) * 2);
    else tmp.copy(boltLow).lerp(boltMid, k * 2);
    if (Math.random() < 0.06) tmp.set('#ffffff');
    colB.set([tmp.r, tmp.g, tmp.b], i * 3);
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(galaxy.slice(), 3));
  geo.setAttribute('aGalaxy', new THREE.BufferAttribute(galaxy, 3));
  geo.setAttribute('aBolt', new THREE.BufferAttribute(bolt, 3));
  geo.setAttribute('aColorA', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('aColorB', new THREE.BufferAttribute(colB, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

  const uniforms = {
    uTime: { value: 0 },
    uMorph: { value: reducedMotion ? 1 : 0 },
    uSize: { value: small ? 7.5 : 6.5 },
    uPointer: { value: new THREE.Vector2(9, 9) },
    uPixelRatio: { value: pixelRatio },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // Layout: the bolt sits to the right of the headline on wide screens, centred behind it on phones.
  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const wide = w / h > 1.15;
    group.position.x = wide ? 3.9 : 0;
    group.position.y = wide ? 0 : 1.2;
    group.scale.setScalar(wide ? 0.9 : 0.78);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const pointer = new THREE.Vector2(9, 9);
  const tilt = new THREE.Vector2();
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    tilt.set(x, y);
    // Convert to the group's local frame (roughly) so repulsion follows the cursor.
    pointer.set((x - group.position.x / 6) / group.scale.x, (y - group.position.y / 3.6) / group.scale.y);
  }
  function onLeave() { pointer.set(9, 9); tilt.set(0, 0); }
  window.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave);

  // Timeline: galaxy (3s) -> converge (1.6s) -> bolt hold (4.4s) -> scatter (1.4s)
  const CYCLE = [3, 1.6, 4.4, 1.4];
  const TOTAL = CYCLE.reduce((a, b) => a + b, 0);
  let lastPhase = -1;
  function morphAt(t) {
    const m = t % TOTAL;
    if (m < CYCLE[0]) return [0, 0];
    if (m < CYCLE[0] + CYCLE[1]) return [(m - CYCLE[0]) / CYCLE[1], 1];
    if (m < CYCLE[0] + CYCLE[1] + CYCLE[2]) return [1, 2];
    return [1 - (m - CYCLE[0] - CYCLE[1] - CYCLE[2]) / CYCLE[3], 3];
  }

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  io.observe(canvas);

  let last = performance.now();
  let raf = 0;
  let elapsed = 1.2; // start a little into the galaxy phase
  function frame(now = performance.now()) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!visible || document.hidden) return;
    if (!reducedMotion) elapsed += dt;
    uniforms.uTime.value = elapsed;
    if (!reducedMotion) {
      const [m, phase] = morphAt(elapsed);
      uniforms.uMorph.value = m;
      if (phase !== lastPhase) { lastPhase = phase; onPhase?.(phase); }
    }
    uniforms.uPointer.value.lerp(pointer, 0.12);
    group.rotation.y += ((tilt.x * 0.35) - group.rotation.y) * 0.05;
    group.rotation.x += ((-tilt.y * 0.22) - group.rotation.x) * 0.05;
    renderer.render(scene, camera);
  }
  frame();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      geo.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
