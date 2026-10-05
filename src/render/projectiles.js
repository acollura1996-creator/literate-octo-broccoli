// Draws the simulation's projectiles (src/game/projectiles.js): arrows, magic bolts, thrown axes,
// rocks and fireballs, Storm Bolt hammers, bullets, grenades, cannonballs, shells, rockets, plasma
// and fading laser beams, oriented along their flight, with spin and smoke trails.
import * as THREE from 'three';
import { geo, mat } from './assets.js';

function makeMesh(kind, color) {
  const g = new THREE.Group();
  switch (kind) {
    case 'arrow': {
      const shaft = new THREE.Mesh(geo.box(0.04, 0.04, 0.75), mat(color ?? 0x8b6b3e, { noFog: true }));
      const tip = new THREE.Mesh(geo.cone(0.05, 0.14, 4), mat(0xcfcfcf, { noFog: true }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.42;
      const fl = new THREE.Mesh(geo.box(0.12, 0.01, 0.14), mat(0xffffff, { noFog: true }));
      fl.position.z = -0.32;
      g.add(shaft, tip, fl);
      break;
    }
    case 'axe': {
      const handle = new THREE.Mesh(geo.box(0.05, 0.05, 0.45), mat(0x6b4a2b, { noFog: true }));
      const blade = new THREE.Mesh(geo.box(0.04, 0.25, 0.18), mat(0xb0b0b0, { noFog: true }));
      blade.position.set(0, 0.08, 0.18);
      const spin = new THREE.Group();
      spin.add(handle, blade);
      g.add(spin);
      g.userData.spin = spin;
      break;
    }
    case 'rock': {
      const m = new THREE.Mesh(geo.dodeca(0.28, 0), mat(0x7a7268, { noFog: true }));
      g.add(m);
      g.userData.spin = m;
      break;
    }
    case 'fireball': {
      g.add(new THREE.Mesh(geo.sphere(0.22, 8, 6), mat(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 1.2, noFog: true })));
      g.add(new THREE.Mesh(geo.sphere(0.34, 8, 6), mat(0xffb347, { transparent: true, opacity: 0.35, emissive: 0xff8800, noFog: true })));
      break;
    }
    case 'hammer': {
      const spin = new THREE.Group();
      const head = new THREE.Mesh(geo.box(0.32, 0.22, 0.22), mat(0x9fd0ff, { emissive: 0x3a7bd5, emissiveIntensity: 0.9, noFog: true }));
      const handle = new THREE.Mesh(geo.box(0.06, 0.4, 0.06), mat(0x6b4a2b, { noFog: true }));
      handle.position.y = -0.25;
      spin.add(head, handle);
      g.add(spin);
      g.add(new THREE.Mesh(geo.sphere(0.36, 8, 6), mat(0x9fd0ff, { transparent: true, opacity: 0.3, emissive: 0x6fb7ff, noFog: true })));
      g.userData.spin = spin;
      break;
    }
    case 'javelin': {
      const shaft = new THREE.Mesh(geo.box(0.035, 0.035, 1.0), mat(0x8b6b3e, { noFog: true }));
      const tip = new THREE.Mesh(geo.cone(0.045, 0.2, 4), mat(0x9aa0a6, { noFog: true }));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.58;
      g.add(shaft, tip);
      break;
    }
    case 'flame': {
      g.add(new THREE.Mesh(geo.sphere(0.2, 8, 6), mat(0xffd27a, { emissive: 0xff8a00, emissiveIntensity: 1.6, noFog: true })));
      g.add(new THREE.Mesh(geo.sphere(0.38, 8, 6), mat(0xff6a1a, { transparent: true, opacity: 0.5, emissive: 0xff4a00, noFog: true })));
      g.userData.trail = 'flame';
      break;
    }
    case 'stone': {
      const m = new THREE.Mesh(geo.dodeca(0.13, 0), mat(0x8a8276, { noFog: true }));
      g.add(m);
      g.userData.spin = m;
      break;
    }
    case 'bullet': {
      g.add(new THREE.Mesh(geo.box(0.035, 0.035, 0.6), mat(0xffe9a0, { emissive: 0xffc860, emissiveIntensity: 1.4, noFog: true })));
      break;
    }
    case 'grenade': {
      const m = new THREE.Mesh(geo.sphere(0.11, 8, 6), mat(0x1c1c1c, { noFog: true }));
      const spark = new THREE.Mesh(geo.sphere(0.05, 6, 4), mat(0xffb347, { emissive: 0xff8a00, emissiveIntensity: 1.5, noFog: true }));
      spark.position.y = 0.12;
      m.add(spark);
      g.add(m);
      g.userData.spin = m;
      break;
    }
    case 'cannonball': {
      g.add(new THREE.Mesh(geo.sphere(0.17, 10, 8), mat(0x26241f, { noFog: true })));
      break;
    }
    case 'shell': {
      const m = new THREE.Mesh(geo.box(0.09, 0.09, 0.32), mat(0x5a5040, { noFog: true }));
      const tail = new THREE.Mesh(geo.box(0.07, 0.07, 0.5), mat(0xffd27a, { transparent: true, opacity: 0.6, emissive: 0xffa040, emissiveIntensity: 1.2, noFog: true }));
      tail.position.z = -0.35;
      g.add(m, tail);
      break;
    }
    case 'rocket': {
      const body = new THREE.Mesh(geo.cyl(0.06, 0.06, 0.45, 6), mat(0x6c7466, { noFog: true }));
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(geo.cone(0.06, 0.14, 6), mat(0x9a3a2a, { noFog: true }));
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.29;
      const flame = new THREE.Mesh(geo.cone(0.07, 0.3, 6), mat(0xffb347, { transparent: true, opacity: 0.85, emissive: 0xff7a00, emissiveIntensity: 1.6, noFog: true }));
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -0.35;
      g.add(body, nose, flame);
      g.userData.trail = true;
      break;
    }
    case 'plasma': {
      const c = color ?? 0x6af7ff;
      g.add(new THREE.Mesh(geo.sphere(0.18, 8, 6), mat(0xffffff, { emissive: c, emissiveIntensity: 1.6, noFog: true })));
      g.add(new THREE.Mesh(geo.sphere(0.34, 8, 6), mat(c, { transparent: true, opacity: 0.45, emissive: c, noFog: true })));
      const tail = new THREE.Mesh(geo.cone(0.2, 0.9, 8), mat(c, { transparent: true, opacity: 0.35, emissive: c, noFog: true }));
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -0.5;
      g.add(tail);
      break;
    }
    default: {
      // Magic bolt
      const c = color ?? 0x9fd8ff;
      g.add(new THREE.Mesh(geo.sphere(0.14, 8, 6), mat(c, { emissive: c, emissiveIntensity: 1.0, noFog: true })));
      g.add(new THREE.Mesh(geo.sphere(0.26, 8, 6), mat(c, { transparent: true, opacity: 0.35, emissive: c, noFog: true })));
    }
  }
  return g;
}

export class ProjectileView {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.views = new Map(); // simulation projectile -> { mesh, ... }
  }

  makeBeam(p) {
    const width = p.width ?? 1;
    const beamMat = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = beamMat(p.color, 0.9);
    const core = beamMat(0xffffff, 0.95);
    const mesh = new THREE.Group();
    const outer = new THREE.Mesh(geo.box(0.09 * width, 0.09 * width, 1), m);
    const inner = new THREE.Mesh(geo.box(0.035 * width, 0.035 * width, 1), core);
    mesh.add(outer, inner);
    const len = Math.hypot(p.tx - p.sx, p.ty - p.sy, p.tz - p.sz);
    mesh.scale.set(1, 1, len);
    mesh.position.set((p.sx + p.tx) / 2, (p.sy + p.ty) / 2, (p.sz + p.tz) / 2);
    mesh.lookAt(p.tx, p.ty, p.tz);
    mesh.visible = this.game.fog.isVisible(p.sx, p.sz) || this.game.fog.isVisible(p.tx, p.tz);
    return { mesh, m, core };
  }

  update(dt) {
    const g = this.game;
    const list = g.projectiles.list;
    const live = new Set(list);
    for (const [p, v] of this.views) {
      if (live.has(p)) continue;
      this.scene.remove(v.mesh);
      v.m?.dispose();
      v.core?.dispose();
      this.views.delete(p);
    }
    for (const p of list) {
      let v = this.views.get(p);
      if (!v) {
        v = p.beam ? this.makeBeam(p) : { mesh: makeMesh(p.kind, p.color) };
        this.scene.add(v.mesh);
        this.views.set(p, v);
      }
      if (p.beam) {
        v.m.opacity = 0.9 * (1 - p.t / p.life);
        v.core.opacity = 0.95 * (1 - p.t / p.life);
        continue;
      }
      const mesh = v.mesh;
      mesh.position.set(p.x, p.y, p.z);
      const px = p.px ?? p.x;
      const py = p.py ?? p.y;
      const pz = p.pz ?? p.z;
      const vx = p.x - px;
      const vy = p.y - py;
      const vz = p.z - pz;
      if (vx * vx + vy * vy + vz * vz > 1e-8) mesh.lookAt(p.x + vx, p.y + vy, p.z + vz);
      if (mesh.userData.spin) mesh.userData.spin.rotation.x += dt * 18;
      if (mesh.userData.trail) {
        v.trailT = (v.trailT ?? 0) + dt;
        if (v.trailT > 0.04) {
          v.trailT = 0;
          if (mesh.userData.trail === 'flame') g.hooks.fx?.puff(px, py, pz, 0x4a3a30, 0.18, 0.5);
          else g.hooks.fx?.puff(px, py, pz, 0xc8c2b8, 0.16, 0.6);
        }
      }
      mesh.visible = g.fog.isVisible(p.x, p.z);
    }
  }
}
