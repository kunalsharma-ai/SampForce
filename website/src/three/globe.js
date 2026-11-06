/**
 * "Revenue Globe" for the immersive section: a dotted Earth (Natural Earth land, via world-atlas),
 * glowing deal arcs travelling between cities, and pulsing city beacons. Drag to spin.
 */
import * as THREE from 'three';
import land from './land-dots.json';

const CITIES = [
  ['London', 51.5, -0.1], ['New York', 40.7, -74], ['Mumbai', 19.1, 72.9], ['Dubai', 25.2, 55.3],
  ['Singapore', 1.35, 103.8], ['São Paulo', -23.5, -46.6], ['Berlin', 52.5, 13.4], ['Sydney', -33.9, 151.2],
  ['Tokyo', 35.7, 139.7], ['Johannesburg', -26.2, 28], ['Toronto', 43.7, -79.4], ['Riyadh', 24.7, 46.7],
  ['Delhi', 28.6, 77.2], ['Paris', 48.9, 2.35], ['Mexico City', 19.4, -99.1], ['Nairobi', -1.3, 36.8],
];
const ROUTES = [
  [0, 1], [0, 3], [3, 2], [2, 4], [4, 8], [1, 5], [6, 2], [7, 4], [9, 0], [10, 6], [11, 12], [13, 1], [14, 1], [15, 3],
  [12, 4], [8, 7], [5, 9], [13, 11],
];

const R = 2;
function toVec(lat, lon, r = R) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

const ARC_VERT = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ARC_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOffset;
  uniform vec3 uColor;
  varying float vT;
  void main() {
    float head = fract(uTime * 0.28 + uOffset);
    float d = head - vT;
    float trail = d >= 0.0 ? exp(-d * 9.0) : 0.0;
    float base = 0.12;
    gl_FragColor = vec4(uColor, base + trail * 0.95);
  }
`;

export function createGlobe(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.6, 8.2);
  camera.lookAt(0, 0, 0);

  const globe = new THREE.Group();
  globe.rotation.z = 0.2;
  scene.add(globe);

  // Inner sphere and atmosphere.
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 64), new THREE.MeshBasicMaterial({ color: '#120c1c' })));
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.12, 64, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(max(0.0, 0.62 - dot(vN, vec3(0.0,0.0,1.0))), 3.0); gl_FragColor = vec4(1.0, 0.45, 0.25, 1.0) * i * 0.9; }',
    }),
  );
  scene.add(atmo);

  // Land dots.
  const n = land.length / 2;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c1 = new THREE.Color('#ff9a5a');
  const c2 = new THREE.Color('#9b6bff');
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = toVec(land[i * 2], land[i * 2 + 1], R * 1.002);
    pos.set([v.x, v.y, v.z], i * 3);
    tmp.copy(c2).lerp(c1, (land[i * 2] + 60) / 140);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const dotsGeo = new THREE.BufferGeometry();
  dotsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dotsGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dots = new THREE.Points(dotsGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  globe.add(dots);

  // Arcs.
  const arcColors = ['#ffc857', '#ff6a3d', '#3de0ff', '#ff4d8d', '#2ee6a6'];
  const arcMaterials = [];
  ROUTES.forEach(([a, b], i) => {
    const A = toVec(CITIES[a][1], CITIES[a][2]);
    const B = toVec(CITIES[b][1], CITIES[b][2]);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const lift = 1 + A.distanceTo(B) * 0.28;
    mid.normalize().multiplyScalar(R * lift);
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    const geo = new THREE.TubeGeometry(curve, 64, 0.008, 6, false);
    const tAttr = new Float32Array(geo.attributes.position.count);
    // TubeGeometry lays vertices out ring by ring along the path.
    const rings = 65;
    const perRing = tAttr.length / rings;
    for (let r = 0; r < rings; r++) for (let k = 0; k < perRing; k++) tAttr[r * perRing + k] = r / (rings - 1);
    geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOffset: { value: i * 0.137 }, uColor: { value: new THREE.Color(arcColors[i % arcColors.length]) } },
    });
    arcMaterials.push(mat);
    globe.add(new THREE.Mesh(geo, mat));
  });

  // City beacons.
  const beacons = [];
  CITIES.forEach(([, lat, lon], i) => {
    const v = toVec(lat, lon, R * 1.01);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshBasicMaterial({ color: '#fff3d6' }));
    dot.position.copy(v);
    globe.add(dot);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.04, 0.055, 32),
      new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffc857' : '#ff6a3d', transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.position.copy(v);
    ring.lookAt(v.clone().multiplyScalar(2));
    globe.add(ring);
    beacons.push({ ring, phase: i * 0.37 });
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Drag to spin, with inertia.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let vel = reducedMotion ? 0 : 0.0025;
  let velX = 0;
  const autoSpin = reducedMotion ? 0 : 0.0025;
  canvas.style.touchAction = 'pan-y';
  const down = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture?.(e.pointerId); };
  const move = (e) => {
    if (!dragging) return;
    vel = (e.clientX - lastX) * 0.006;
    velX = (e.clientY - lastY) * 0.004;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const up = () => { dragging = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(canvas);

  const start = performance.now();
  let raf = 0;
  globe.rotation.y = -1.9;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const t = (performance.now() - start) / 1000;
    globe.rotation.y += vel;
    globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + velX, -0.6, 0.6);
    if (!dragging) { vel += (autoSpin - vel) * 0.02; velX *= 0.9; }
    if (!reducedMotion) {
      arcMaterials.forEach((m) => { m.uniforms.uTime.value = t; });
      beacons.forEach(({ ring, phase }) => {
        const s = 1 + ((t * 0.8 + phase) % 1) * 2.2;
        ring.scale.setScalar(s);
        ring.material.opacity = 1 - ((t * 0.8 + phase) % 1);
      });
    } else arcMaterials.forEach((m) => { m.uniforms.uTime.value = 1.5; });
    renderer.render(scene, camera);
  }
  frame();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      renderer.dispose();
    },
  };
}
