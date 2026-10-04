// Renderer, scene, lighting (with a day/night cycle) and the RTS camera.
import * as THREE from 'three';
import { UnitView, ItemView } from './unitview.js';
import { Effects } from './effects.js';
import { Projectiles } from './projectiles.js';
import { MAP_SIZE } from '../world/layout.js';
import { ITEMS } from '../data/items.js';

export class RTSCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.5, 400);
    this.target = new THREE.Vector3(40, 0, 120);
    this.distance = 34;
    this.zoomTarget = 34;
    this.minDist = 12;
    this.maxDist = 68;
    this.vel = { x: 0, z: 0 };
    this.pitch = THREE.MathUtils.degToRad(56);
    this.yaw = 0;
    this.shake = 0;
  }

  setTarget(x, z) {
    this.target.x = Math.max(4, Math.min(MAP_SIZE - 4, x));
    this.target.z = Math.max(6, Math.min(MAP_SIZE + 4, z));
  }

  update(terrain, shakeAmount = 0) {
    const ty = terrain ? terrain.heightAt(this.target.x, Math.min(MAP_SIZE - 0.01, this.target.z)) : 0;
    this.target.y += (ty - this.target.y) * 0.15;
    const d = this.distance;
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch) * d, Math.sin(this.pitch) * d, Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    const c = this.camera;
    c.position.copy(this.target).add(off);
    if (shakeAmount > 0) {
      c.position.x += (Math.random() - 0.5) * shakeAmount;
      c.position.y += (Math.random() - 0.5) * shakeAmount;
    }
    c.lookAt(this.target);
  }

  /** Intersect a screen ray with the terrain heightfield. */
  screenToGround(ndcX, ndcY, terrain) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const o = ray.ray.origin;
    const dir = ray.ray.direction;
    let prevT = 0;
    let t = 0;
    const step = 0.6;
    for (let i = 0; i < 800; i++) {
      t += step;
      const x = o.x + dir.x * t;
      const y = o.y + dir.y * t;
      const z = o.z + dir.z * t;
      const h = terrain.heightAt(Math.max(0, Math.min(MAP_SIZE, x)), Math.max(0, Math.min(MAP_SIZE, z)));
      if (y <= h) {
        // Bisection refine.
        let a = prevT;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          const mx = o.x + dir.x * m;
          const my = o.y + dir.y * m;
          const mz = o.z + dir.z * m;
          if (my <= terrain.heightAt(Math.max(0, Math.min(MAP_SIZE, mx)), Math.max(0, Math.min(MAP_SIZE, mz)))) b = m;
          else a = m;
        }
        return { x: o.x + dir.x * b, z: o.z + dir.z * b };
      }
      prevT = t;
    }
    // Fall back to the y=0 plane.
    if (dir.y < 0) {
      const tt = -o.y / dir.y;
      return { x: o.x + dir.x * tt, z: o.z + dir.z * tt };
    }
    return null;
  }
}

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.cam = new RTSCamera(1);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a30, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38;
    sc.right = 38;
    sc.top = 38;
    sc.bottom = -38;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.unitViews = new Map();
    this.itemViews = new Map();
    this.resize();
  }

  attachGame(game) {
    this.game = game;
    this.fx = new Effects(game, this.scene);
    this.projectiles = new Projectiles(game, this.scene);
  }

  addUnit(u) {
    const v = new UnitView(u, this.game, this.scene);
    u.view = v;
    this.unitViews.set(u.id, v);
  }

  removeUnit(u) {
    const v = this.unitViews.get(u.id);
    if (v) v.dispose();
    this.unitViews.delete(u.id);
    u.view = null;
  }

  changeUnit(u, modelChanged) {
    if (modelChanged && u.view) u.view.buildModel();
  }

  addItem(it) {
    const def = ITEMS[it.id];
    const v = new ItemView(it, this.game, this.scene, new THREE.Color(def.color ?? '#ffd700').getHex());
    this.itemViews.set(it, v);
  }

  removeItem(it) {
    this.itemViews.get(it)?.dispose();
    this.itemViews.delete(it);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.width = w;
    this.height = h;
  }

  updateLighting() {
    const g = this.game;
    const hour = g.timeOfDay;
    // 0 at midnight, 1 at noon.
    const dayness = THREE.MathUtils.clamp(Math.sin(((hour - 6) / 12) * Math.PI) * 1.4 + 0.25, 0, 1);
    const night = 1 - dayness;
    this.sun.intensity = 0.55 + dayness * 1.75;
    this.sun.color.setRGB(1 - night * 0.45, 0.95 - night * 0.3, 0.85 + night * 0.15);
    this.hemi.intensity = 0.75 + dayness * 0.55;
    this.hemi.color.setRGB(0.81 - night * 0.35, 0.9 - night * 0.3, 1.0);
    this.hemi.groundColor.setRGB(0.35 - night * 0.15, 0.29 - night * 0.12, 0.19 + night * 0.05);
    // The sun moves across the sky; shadows follow the camera target.
    const ang = ((hour - 6) / 12) * Math.PI;
    const t = this.cam.target;
    const sx = Math.cos(ang) * 30;
    const sy = 45 + Math.abs(Math.sin(ang)) * 20;
    this.sun.position.set(t.x + sx, sy, t.z + 25);
    this.sun.target.position.set(t.x, 0, t.z);
  }

  render(dt) {
    const g = this.game;
    const time = g.time;
    g.terrain.update(time);
    g.roads?.update(this.scene);
    this.updateLighting();
    for (const v of this.unitViews.values()) v.sync(dt, time);
    for (const v of this.itemViews.values()) v.sync(dt, time);
    this.fx.update(dt);
    this.cam.update(g.terrain, g.shakeAmount);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** Project a world point to CSS pixel coordinates. */
  project(x, y, z, out = { x: 0, y: 0, behind: false }) {
    const v = new THREE.Vector3(x, y, z).project(this.cam.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    out.behind = v.z > 1;
    return out;
  }

  screenToGround(px, py) {
    return this.cam.screenToGround((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1, this.game.terrain);
  }

  /** Ground-plane polygon visible on screen (for the minimap). */
  viewPolygon() {
    const pts = [];
    for (const [x, y] of [[0, 0], [this.width, 0], [this.width, this.height * 0.78], [0, this.height * 0.78]]) {
      const p = this.screenToGround(x, y);
      if (p) pts.push(p);
    }
    return pts;
  }

  isOnScreen(x, z) {
    const p = this.project(x, this.game.terrain.heightAt(x, z), z);
    return !p.behind && p.x > 0 && p.y > 0 && p.x < this.width && p.y < this.height * 0.78;
  }
}
