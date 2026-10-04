// Unit/building icons rendered from their 3D models, plus the animated 3D
// portrait shown in the console (like Warcraft III's talking heads).
import * as THREE from 'three';
import { createModel } from '../render/models.js';
import { fogUniforms } from '../render/assets.js';

const ICON_SIZE = 96;
const cache = new Map();
let iconScene = null;
let iconCam = null;
let target = null;

function setupIconScene() {
  iconScene = new THREE.Scene();
  iconScene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(2, 4, 5);
  iconScene.add(d);
  iconCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  target = new THREE.WebGLRenderTarget(ICON_SIZE, ICON_SIZE, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
}

/** Frame a model nicely: whole thing for buildings, upper body for units. */
function frame(cam, root, isBuilding, portrait = false) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  let focusY;
  let span;
  if (isBuilding) {
    focusY = center.y;
    span = Math.max(size.x, size.y, size.z) * 1.05;
  } else {
    focusY = box.min.y + size.y * (portrait ? 0.72 : 0.62);
    span = Math.max(size.y * (portrait ? 0.62 : 0.85), size.x * 0.7);
  }
  const dist = span / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) + 0.3;
  const dir = new THREE.Vector3(0.45, isBuilding ? 0.55 : 0.18, 1).normalize();
  cam.position.set(center.x + dir.x * dist, focusY + dir.y * dist, center.z + dir.z * dist);
  cam.lookAt(center.x, focusY, center.z);
}

/** Data URL icon for a model id rendered with a team color. */
export function modelIcon(renderer, modelId, color, isBuilding) {
  const key = `${modelId}|${color}`;
  if (cache.has(key)) return cache.get(key);
  if (!iconScene) setupIconScene();
  const m = createModel(modelId, color);
  iconScene.add(m.root);
  frame(iconCam, m.root, isBuilding);
  const prevFog = fogUniforms.uFogEnabled.value;
  fogUniforms.uFogEnabled.value = 0;
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(iconScene, iconCam);
  const buf = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, ICON_SIZE, ICON_SIZE, buf);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(0x000000, 1);
  fogUniforms.uFogEnabled.value = prevFog;
  iconScene.remove(m.root);

  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  // Background gradient like a Warcraft III icon.
  const grd = ctx.createLinearGradient(0, 0, 0, ICON_SIZE);
  grd.addColorStop(0, '#3b3f4a');
  grd.addColorStop(1, '#12141a');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
  const img = ctx.createImageData(ICON_SIZE, ICON_SIZE);
  // Flip vertically (GL origin is bottom-left).
  for (let y = 0; y < ICON_SIZE; y++) {
    const src = (ICON_SIZE - 1 - y) * ICON_SIZE * 4;
    img.data.set(buf.subarray(src, src + ICON_SIZE * 4), y * ICON_SIZE * 4);
  }
  const tmp = document.createElement('canvas');
  tmp.width = ICON_SIZE;
  tmp.height = ICON_SIZE;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

export class Portrait {
  constructor(renderer, element) {
    this.el = element;
    // The console covers the main canvas, so the portrait gets its own small canvas.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'portrait-canvas';
    element.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x2a2018, 1.5));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.4);
    key.position.set(3, 4, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
    rim.position.set(-4, 2, -3);
    this.scene.add(rim);
    this.cam = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
    this.current = null;
    this.model = null;
    this.size = { w: 0, h: 0 };
  }

  show(unit) {
    const key = unit ? `${unit.def.model}|${unit.owner.color}|${unit.id}` : null;
    if (key === this.current) return;
    this.current = key;
    if (this.model) this.scene.remove(this.model.root);
    this.model = null;
    this.unit = unit;
    if (!unit) {
      this.renderer.setClearColor(0x0b0d12, 1);
      this.renderer.clear();
      return;
    }
    this.model = createModel(unit.def.model, unit.def.modelColor ?? unit.owner.color);
    this.scene.add(this.model.root);
    this.model.root.rotation.y = 0.35;
    frame(this.cam, this.model.root, unit.isBuilding, true);
  }

  render(time) {
    if (!this.model) return;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w < 4 || h < 4) return;
    if (w !== this.size.w || h !== this.size.h) {
      this.size = { w, h };
      this.renderer.setSize(w, h, false);
      this.cam.aspect = w / h;
      this.cam.updateProjectionMatrix();
    }
    // Gentle idle motion.
    const P = this.model.parts ?? {};
    if (P.head) P.head.rotation.y = Math.sin(time * 0.7) * 0.25;
    if (P.body) P.body.rotation.y = Math.sin(time * 0.5) * 0.05;
    for (const s of P.spin ?? []) s.rotation.y = time * 1.5;
    for (const w2 of P.wings ?? []) w2.obj.rotation.z = (w2.side ?? 1) * Math.sin(time * 8) * 0.5;
    for (const f of P.fire ?? []) {
      f.userData.baseScale ??= f.scale.x;
      f.scale.setScalar(f.userData.baseScale * (0.85 + Math.random() * 0.3));
    }
    if (this.unit?.isBuilding) this.model.root.rotation.y = 0.35 + Math.sin(time * 0.3) * 0.15;
    const prevFog = fogUniforms.uFogEnabled.value;
    fogUniforms.uFogEnabled.value = 0;
    this.renderer.render(this.scene, this.cam);
    fogUniforms.uFogEnabled.value = prevFog;
  }
}
