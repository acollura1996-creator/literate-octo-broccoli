// Dev gallery: lays out every procedural model on a green field.
// URL options:
//   ids=footman,knight   only these models (default: all MODEL_IDS)
//   animate=1            drive parts per the animation contract
//   t=1.2                freeze animation time (seconds) for deterministic shots
//   atk=2.4              force weapon.rotation.x (wind-up +, strike -)
//   team=0042ff,ff0303   team color(s), cycled per model
//   zoom=2 dist=30 pitch=55 yaw=0 fov=40   camera
//   rot=45               rotate every model about Y (degrees)
//   labels=0 help=0 fp=0 hide labels / help / footprint squares
//   merge=0              disable static-mesh merging (debug)
//   cols=4 gap=0.7       layout
import * as THREE from 'three';
import { createModel, MODEL_IDS, MODEL_OPTIONS } from '../src/render/models.js';
import { fogUniforms, mat, geo } from '../src/render/assets.js';

const q = new URLSearchParams(location.search);
const ids = q.get('ids') ? q.get('ids').split(',').filter(Boolean) : MODEL_IDS;
const animate = q.get('animate') === '1';
const tFixed = q.has('t') ? parseFloat(q.get('t')) : null;
const atk = q.has('atk') ? parseFloat(q.get('atk')) : null;
const teams = (q.get('team') ?? 'ff0303,0042ff').split(',').map((h) => parseInt(h, 16));
const zoom = parseFloat(q.get('zoom') ?? '1');
const pitch = THREE.MathUtils.degToRad(parseFloat(q.get('pitch') ?? '55'));
const yaw = THREE.MathUtils.degToRad(parseFloat(q.get('yaw') ?? '0'));
const fixedDist = q.has('dist') ? parseFloat(q.get('dist')) : null;
const fov = parseFloat(q.get('fov') ?? '40');
const rot = THREE.MathUtils.degToRad(parseFloat(q.get('rot') ?? '0'));
const gap = parseFloat(q.get('gap') ?? '0.7');
const showLabels = q.get('labels') !== '0';
const showFp = q.get('fp') !== '0';
if (q.get('help') === '0') document.getElementById('help')?.remove();
MODEL_OPTIONS.mergeStatic = q.get('merge') !== '0';

// Building footprints (cells) for the footprint guide squares.
const FP = {
  townhall: 4, keep: 4, castle: 4, farm: 2, barracks: 3, blacksmith: 3, sanctum: 3, workshop: 3,
  scouttower: 2, guardtower: 2, altar: 3, construction: 1, goldmine: 3, shop: 3, mercenary_camp: 3,
  fountain: 3, kalenden_keep: 6, dark_tower: 2, wall_segment: [2, 1], wall_tower: 2,
  house_1: 2, house_2: 2, house_3: 2, house_4: 2, lumberyard: 3, stable: 3, palace: 4,
  wall_palisade: 1, wall_stone: 1, wall_fortified: 1, gate_wood: 2, gate_stone: 2, gate_fortified: 2,
  stone_camp: 4, bronze_hall: 4, house_stone: 2, farm_1: 3, city_hall: 4, house_ind: 2, farm_2: 3, factory: 3,
  tower_bunker: 2, wall_concrete: 1, gate_concrete: 2, missile_silo: 3, capitol: 4, house_mod: 2, nexus: 4,
  house_fut: 2, farm_3: 3, wall_energy: 1, gate_energy: 2, tower_laser: 2,
};

// Fog-of-war patch: disable and feed a white texture.
fogUniforms.uFogEnabled.value = 0;
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
white.needsUpdate = true;
fogUniforms.uFogTex.value = white;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fbbe0);

// --- models + shelf layout ---------------------------------------------------
const items = ids.map((id, i) => {
  const m = createModel(id, teams[i % teams.length]);
  m.root.rotation.y = rot;
  const fp = FP[id];
  const fw = Array.isArray(fp) ? fp[0] : fp ?? 0;
  const fd = Array.isArray(fp) ? fp[1] : fp ?? 0;
  const r = Math.max(m.radius, 0.35);
  return { id, m, fw, fd, w: Math.max(2 * r, fw) + gap, d: Math.max(2 * r, fd) + gap + m.height * 0.35 };
});
const totalArea = items.reduce((s, it) => s + it.w * it.d, 0);
const aspect = window.innerWidth / window.innerHeight;
const cols = q.has('cols') ? parseInt(q.get('cols'), 10) : 0;
const rowW = Math.max(Math.sqrt(totalArea * aspect * 1.2), ...items.map((i) => i.w));
const rows = [];
let cur = { list: [], width: 0, depth: 0 };
for (const it of items) {
  if (cur.list.length && (cols ? cur.list.length >= cols : cur.width + it.w > rowW)) {
    rows.push(cur);
    cur = { list: [], width: 0, depth: 0 };
  }
  it.x = cur.width + it.w / 2;
  cur.width += it.w;
  cur.depth = Math.max(cur.depth, it.d);
  cur.list.push(it);
}
rows.push(cur);
const totalD = rows.reduce((s, r) => s + r.depth, 0);
const maxW = Math.max(...rows.map((r) => r.width));
let zAcc = -totalD / 2;
for (const row of rows) {
  for (const it of row.list) {
    it.x -= row.width / 2;
    it.z = zAcc + row.depth / 2;
    it.m.root.position.set(it.x, 0, it.z);
    scene.add(it.m.root);
  }
  zAcc += row.depth;
}

// ground + footprint guides
const ground = new THREE.Mesh(geo.plane(400, 400), mat(0x6aa636));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
if (showFp) {
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2f5a18 });
  for (const it of items) {
    if (!it.fw) continue;
    const pad = new THREE.Mesh(geo.plane(it.fw, it.fd), mat(0x5e9a2e));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(it.x, 0.004, it.z);
    pad.receiveShadow = true;
    scene.add(pad);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(it.fw, it.fd)), lineMat);
    edges.rotation.x = -Math.PI / 2;
    edges.position.set(it.x, 0.008, it.z);
    scene.add(edges);
  }
}

// --- lights (sunny Lordaeron day) --------------------------------------------
scene.add(new THREE.HemisphereLight(0xdcecff, 0x58773a, 1.15));
const sun = new THREE.DirectionalLight(0xfff0d2, 2.5);
const ext = Math.max(maxW, totalD) / 2 + 4;
sun.position.set(-0.55 * ext * 2, ext * 2.2, 0.75 * ext * 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -ext * 1.3, right: ext * 1.3, top: ext * 1.3, bottom: -ext * 1.3, near: 0.5, far: ext * 8 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// --- camera ------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 2000);
const maxH = Math.max(...items.map((i) => i.m.height));
const target = new THREE.Vector3(0, 0, 0);
const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
const corners = [];
for (const it of items) {
  const hw = it.w / 2 - gap * 0.3, hd = it.d / 2 - gap * 0.3;
  for (const y of [0, it.m.height]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(it.x + sx * hw, y, it.z + sz * hd));
}
function placeCamera(d) {
  camera.position.copy(target).addScaledVector(dir, d);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}
function fits(d) {
  placeCamera(d);
  const v = new THREE.Vector3();
  return corners.every((c) => {
    v.copy(c).project(camera);
    return Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.95 && v.z < 1;
  });
}
{
  const bb = new THREE.Box3().setFromPoints(corners);
  bb.getCenter(target);
  target.y = Math.min(target.y, maxH * 0.3);
}
let lo = 0.5, hi = 1000;
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2;
  if (fits(mid)) hi = mid; else lo = mid;
}
placeCamera(fixedDist ?? hi / zoom);

// --- labels ------------------------------------------------------------------
const labelRoot = document.getElementById('labels');
const labels = showLabels
  ? items.map((it) => {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.textContent = it.id;
      labelRoot.appendChild(el);
      return el;
    })
  : [];
function placeLabels() {
  const v = new THREE.Vector3();
  items.forEach((it, i) => {
    if (!labels[i]) return;
    v.set(it.x, 0, it.z + it.d / 2 - gap * 0.35).project(camera);
    labels[i].style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    labels[i].style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
  });
}

// --- animation per the parts contract -------------------------------------
function attackCurve(t) {
  const p = (t % 1.6) / 1.6;
  if (p < 0.45) return 2.4 * Math.sin((p / 0.45) * (Math.PI / 2));
  if (p < 0.6) return 2.4 + (-0.9 - 2.4) * ((p - 0.45) / 0.15);
  return -0.9 * (1 - (p - 0.6) / 0.4);
}
function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function drive(m, t, k) {
  const p = m.parts;
  const cycle = t * 7 + k;
  for (const l of p.legs ?? []) l.obj.rotation.x = Math.sin(cycle + l.phase) * (l.amp ?? 0.6);
  for (const a of p.arms ?? []) a.obj.rotation.x = Math.sin(cycle + a.phase) * 0.5;
  if (p.weapon) p.weapon.rotation.x = atk ?? attackCurve(t + k * 0.1);
  for (const o of p.spin ?? []) o.rotation.y = t * 2;
  for (const o of p.bob ?? []) o.position.y = Math.sin(t * 2.5 + k) * 0.08;
  for (const w of p.wings ?? []) w.obj.rotation.z = w.side * Math.sin(t * 8) * 0.6;
  for (const w of p.wheels ?? []) w.rotation.x = t * 3;
  (p.fire ?? []).forEach((f, i) => f.scale.setScalar(0.85 + 0.3 * hash(Math.floor(t * 12) + i + k)));
  for (const g of p.glow ?? []) g.scale.setScalar(1 + 0.08 * Math.sin(t * 4 + k));
  if (p.body && p.legs) {
    const rest = p.body.userData.restPosition;
    p.body.position.y = rest.y + Math.abs(Math.sin(cycle)) * 0.02;
  }
}
if (atk !== null && !animate) for (const it of items) if (it.m.parts.weapon) it.m.parts.weapon.rotation.x = atk;

// --- stats for automated checks ----------------------------------------------
const box = new THREE.Box3();
window.__stats = items.map((it) => {
  const saved = it.m.root.position.clone();
  it.m.root.position.set(0, 0, 0);
  it.m.root.updateMatrixWorld(true);
  box.setFromObject(it.m.root, true);
  it.m.root.position.copy(saved);
  let meshes = 0;
  it.m.root.traverse((o) => { if (o.isMesh) meshes++; });
  const s = new THREE.Vector3();
  box.getSize(s);
  return {
    id: it.id, meshes, height: it.m.height, radius: it.m.radius,
    min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)),
    size: s.toArray().map((v) => +v.toFixed(2)),
    parts: Object.keys(it.m.parts),
  };
});

// --- loop --------------------------------------------------------------------
const t0 = performance.now();
let frames = 0;
function frame() {
  const t = tFixed ?? (performance.now() - t0) / 1000;
  if (animate) items.forEach((it, i) => drive(it.m, t, i * 0.37));
  renderer.render(scene, camera);
  placeLabels();
  if (++frames === 3) window.__ready = true;
  if (tFixed === null || frames < 3) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
