// Projectiles: arrows, magic bolts, thrown axes, rocks and fireballs, Storm Bolt hammers, and the
// weapons of later ages: bullets, grenades, cannonballs, shells, rockets, plasma and instant lasers.
// Homing unless they are lobbed at a point.
import * as THREE from 'three';
import { geo, mat } from './assets.js';

/**
 * Muzzle offsets in model space ([x, y, z], model facing +Z) for units whose shots should leave
 * the barrel rather than the unit's chest.
 */
export const MUZZLE = {
  grenadier: [-0.204, 0.568, 0.195],
  musketeer: [0, 0.646, 1.031],
  cannon: [0, 0.676, 0.789],
  rifleman: [0, 0.644, 0.988],
  machine_gunner: [-0.021, 0.543, 0.874],
  steam_tank: [0, 0.6, 1.425],
  howitzer: [0, 1.053, 0.803],
  tower_bunker: [0, 0.92, 0.9],
  laser_trooper: [-0.104, 0.707, 0.805],
  // Twin guns alternate barrels.
  hover_tank: [[0.1, 0.8, 0.75], [-0.1, 0.8, 0.75]],
  mech_walker: [[0.6, 1.65, 0.89], [-0.6, 1.65, 0.89]],
  tower_laser: [0, 1.98, 0.95],
  infantry: [-0.105, 0.7, 0.7],
  bazooka: [-0.16, 0.81, 0.57],
  tank: [0, 0.82, 1.82],
  rocket_artillery: [0, 1.29, -0.33],
};

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

export class Projectiles {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.list = [];
  }

  unitHeight(u) {
    return u.view?.height ?? 1;
  }

  /** World position of a unit's muzzle (model-space MUZZLE offsets, or a sensible default). */
  muzzleOf(from) {
    const g = this.game;
    let m = MUZZLE[from.modelId];
    if (m && Array.isArray(m[0])) {
      from.shotIndex = ((from.shotIndex ?? 0) + 1) % m.length;
      m = m[from.shotIndex];
    }
    const ground = g.terrain.heightAt(from.x, from.z);
    if (m) {
      const sc = from.view?.root?.scale?.x ?? 1;
      const f = from.view?.root?.rotation?.y ?? from.facing;
      const c = Math.cos(f);
      const sn = Math.sin(f);
      return { x: from.x + (m[0] * c + m[2] * sn) * sc, y: ground + m[1] * sc, z: from.z + (-m[0] * sn + m[2] * c) * sc };
    }
    return {
      x: from.x + Math.sin(from.facing) * from.radius * 0.6,
      y: ground + this.unitHeight(from) * (from.isBuilding ? 0.85 : 0.6),
      z: from.z + Math.cos(from.facing) * from.radius * 0.6,
    };
  }

  spawn(o) {
    const g = this.game;
    const from = o.from;
    const { x: sx, y: sy, z: sz } = this.muzzleOf(from);
    if (from.def.firearm || from.projectile?.kind === 'bullet' || from.projectile?.kind === 'laser') {
      const c = o.kind === 'laser' || o.kind === 'plasma' || o.kind === 'rail' ? o.color ?? 0x6af7ff : o.kind === 'flame' ? 0xff8a2a : 0xffd27a;
      g.hooks.fx?.muzzle(sx, sy, sz, c, o.kind === 'shell' || o.kind === 'cannonball' ? 0.45 : 0.22);
      if (o.kind === 'shell' || o.kind === 'cannonball') g.hooks.fx?.puff(sx, sy, sz, 0xcfc8bc, 0.4, 1.0);
    }
    if (o.kind === 'laser' || o.kind === 'rail') return this.beam(o, sx, sy, sz, o.kind === 'rail' ? 1.8 : 1);
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

  /** Lasers hit instantly: draw a beam that fades out. */
  beam(o, sx, sy, sz, width = 1) {
    const g = this.game;
    const t = o.target;
    const tx = t.x;
    const tz = t.z;
    const ty = g.terrain.heightAt(tx, tz) + this.unitHeight(t) * 0.5;
    const len = Math.hypot(tx - sx, ty - sy, tz - sz);
    const c = o.color ?? 0x5ff2ff;
    const beamMat = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = beamMat(c, 0.9);
    const core = beamMat(0xffffff, 0.95);
    const mesh = new THREE.Group();
    const outer = new THREE.Mesh(geo.box(0.09 * width, 0.09 * width, 1), m);
    const inner = new THREE.Mesh(geo.box(0.035 * width, 0.035 * width, 1), core);
    mesh.add(outer, inner);
    mesh.scale.set(1, 1, len);
    mesh.position.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2);
    mesh.lookAt(tx, ty, tz);
    mesh.visible = g.fog.isVisible(sx, sz) || g.fog.isVisible(tx, tz);
    this.scene.add(mesh);
    try {
      o.onHit?.(t && !t.dead ? t : null, { x: tx, z: tz });
    } catch (e) {
      console.error(e);
    }
    this.list.push({ beam: true, mesh, t: 0, life: 0.14, m, core });
  }

  update(dt) {
    const g = this.game;
    const keep = [];
    for (const p of this.list) {
      if (p.beam) {
        p.t += dt;
        p.m.opacity = 0.9 * (1 - p.t / p.life);
        p.core.opacity = 0.95 * (1 - p.t / p.life);
        if (p.t >= p.life) {
          this.scene.remove(p.mesh);
          p.m.dispose();
          p.core.dispose();
        } else keep.push(p);
        continue;
      }
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
      if (p.mesh.userData.trail) {
        p.trailT = (p.trailT ?? 0) + dt;
        if (p.trailT > 0.04) {
          p.trailT = 0;
          if (p.mesh.userData.trail === 'flame') g.hooks.fx?.puff(prev.x, prev.y, prev.z, 0x4a3a30, 0.18, 0.5);
          else g.hooks.fx?.puff(prev.x, prev.y, prev.z, 0xc8c2b8, 0.16, 0.6);
        }
      }
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
