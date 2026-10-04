// Projectiles: arrows, magic bolts, thrown axes, catapult rocks, fireballs
// and Storm Bolt hammers. Homing unless they are lobbed at a point.
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
    default: {
      // Magic bolt
      const c = color ?? 0x9fd8ff;
      g.add(new THREE.Mesh(geo.sphere(0.14, 8, 6), mat(c, { emissive: c, emissiveIntensity: 1.0, noFog: true })));
      g.add(new THREE.Mesh(geo.sphere(0.26, 8, 6), mat(c, { transparent: true, opacity: 0.35, emissive: c, noFog: true })));
    }
  }
  return g;
}

export class Projectiles {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.list = [];
  }

  unitHeight(u) {
    return u.view?.height ?? 1;
  }

  spawn(o) {
    const g = this.game;
    const from = o.from;
    const sx = from.x + Math.sin(from.facing) * from.radius * 0.6;
    const sz = from.z + Math.cos(from.facing) * from.radius * 0.6;
    const sy = g.terrain.heightAt(from.x, from.z) + this.unitHeight(from) * (from.isBuilding ? 0.85 : 0.6);
    const mesh = makeMesh(o.kind, o.color);
    mesh.position.set(sx, sy, sz);
    this.scene.add(mesh);
    const p = {
      ...o,
      x: sx,
      y: sy,
      z: sz,
      sx,
      sy,
      sz,
      mesh,
      t: 0,
      dest: o.point ? { ...o.point } : { x: o.target.x, z: o.target.z },
    };
    if (o.arc) {
      p.dist = Math.max(1, Math.hypot(p.dest.x - sx, p.dest.z - sz));
    }
    this.list.push(p);
    return p;
  }

  update(dt) {
    const g = this.game;
    const keep = [];
    for (const p of this.list) {
      let done = false;
      const prev = { x: p.x, y: p.y, z: p.z };
      if (p.arc) {
        p.t += (dt * p.speed) / p.dist;
        const t = Math.min(1, p.t);
        const dy = g.terrain.heightAt(p.dest.x, p.dest.z) + 0.2;
        p.x = p.sx + (p.dest.x - p.sx) * t;
        p.z = p.sz + (p.dest.z - p.sz) * t;
        p.y = p.sy + (dy - p.sy) * t + Math.sin(Math.PI * t) * p.dist * 0.32;
        if (t >= 1) done = true;
      } else {
        const t = p.target;
        if (t && !t.dead && !t.removed) {
          p.dest.x = t.x;
          p.dest.z = t.z;
          p.destY = g.terrain.heightAt(t.x, t.z) + this.unitHeight(t) * 0.5;
        } else if (p.destY === undefined) {
          p.destY = g.terrain.heightAt(p.dest.x, p.dest.z) + 0.5;
        }
        const dx = p.dest.x - p.x;
        const dy = p.destY - p.y;
        const dz = p.dest.z - p.z;
        const d = Math.hypot(dx, dy, dz);
        const step = p.speed * dt;
        if (d <= Math.max(step, 0.25)) {
          p.x = p.dest.x;
          p.y = p.destY;
          p.z = p.dest.z;
          done = true;
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
          p.z += (dz / d) * step;
        }
      }
      p.mesh.position.set(p.x, p.y, p.z);
      const vx = p.x - prev.x;
      const vy = p.y - prev.y;
      const vz = p.z - prev.z;
      if (vx * vx + vy * vy + vz * vz > 1e-8) p.mesh.lookAt(p.x + vx, p.y + vy, p.z + vz);
      if (p.mesh.userData.spin) p.mesh.userData.spin.rotation.x += dt * 18;
      p.mesh.visible = g.fog.isVisible(p.x, p.z);
      if (done) {
        this.scene.remove(p.mesh);
        const target = p.target && !p.target.dead && !p.arc ? p.target : null;
        try {
          p.onHit?.(target, { x: p.dest.x, z: p.dest.z });
        } catch (e) {
          console.error(e);
        }
      } else keep.push(p);
    }
    this.list = keep;
  }
}
