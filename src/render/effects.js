// Transient visual effects: hit sparks, explosions, rings, spell visuals,
// order markers and level-up beams.
import * as THREE from 'three';
import { geo } from './assets.js';

function basic(color, opacity = 1, additive = false) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

export class Effects {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.list = [];
  }

  visible(x, z) {
    return this.game.fog.isVisible(x, z);
  }

  h(x, z) {
    return this.game.terrain.heightAt(x, z);
  }

  add(obj, update, dispose) {
    this.scene.add(obj);
    this.list.push({ obj, update, dispose, t: 0 });
  }

  update(dt) {
    const keep = [];
    for (const e of this.list) {
      e.t += dt;
      let alive = false;
      try {
        alive = e.update(e.t, dt);
      } catch (err) {
        console.error(err);
      }
      if (alive) keep.push(e);
      else {
        this.scene.remove(e.obj);
        e.obj.traverse((o) => {
          if (o.material && o.material.dispose && !o.material.userData?.shared) o.material.dispose();
        });
        e.dispose?.();
      }
    }
    this.list = keep;
  }

  // ------------------------------------------------------------- basics
  burst(x, y, z, color, count = 10, speed = 3, size = 0.08, life = 0.7) {
    if (!this.visible(x, z)) return;
    const g = new THREE.Group();
    const m = basic(color, 1, true);
    const parts = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo.octa(size), m);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const s = speed * (0.4 + Math.random() * 0.6);
      p.userData.v = new THREE.Vector3(Math.cos(a) * s * (1 - up * 0.5), up * s * 1.2 + 0.5, Math.sin(a) * s * (1 - up * 0.5));
      p.position.set(0, 0, 0);
      g.add(p);
      parts.push(p);
    }
    g.position.set(x, this.h(x, z) + y, z);
    this.add(g, (t, dt) => {
      for (const p of parts) {
        p.userData.v.y -= 6 * dt;
        p.position.addScaledVector(p.userData.v, dt);
        p.rotation.x += dt * 5;
      }
      m.opacity = Math.max(0, 1 - t / life);
      return t < life;
    });
  }

  hit(target, color = 0xffeecc) {
    const y = (target.view?.height ?? 1) * 0.6;
    this.burst(target.x, y, target.z, color, 4, 2, 0.05, 0.35);
  }

  ring(x, z, color, radius, dur = 0.6, startR = 0.2, opacity = 0.9) {
    if (!this.visible(x, z)) return;
    const m = basic(color, opacity, true);
    const mesh = new THREE.Mesh(geo.ring(0.85, 1, 40), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.h(x, z) + 0.15, z);
    this.add(mesh, (t) => {
      const k = Math.min(1, t / dur);
      const r = startR + (radius - startR) * (1 - (1 - k) * (1 - k));
      mesh.scale.set(r, r, r);
      m.opacity = opacity * (1 - k);
      return t < dur;
    });
  }

  explosion(x, z, size = 1) {
    if (!this.visible(x, z)) return;
    const m = basic(0xffa040, 0.9, true);
    const m2 = basic(0x553b2a, 0.6, false);
    const g = new THREE.Group();
    const ball = new THREE.Mesh(geo.sphere(1, 10, 8), m);
    const smoke = new THREE.Mesh(geo.ico(1, 1), m2);
    g.add(ball, smoke);
    g.position.set(x, this.h(x, z) + 0.4 * size, z);
    this.add(g, (t) => {
      const k = t / 0.7;
      ball.scale.setScalar(size * (0.3 + k * 1.1));
      m.opacity = Math.max(0, 0.9 - k * 1.3);
      smoke.scale.setScalar(size * (0.4 + k * 1.4));
      smoke.position.y = k * size;
      m2.opacity = Math.max(0, 0.6 - k * 0.7);
      return t < 0.85;
    });
    this.burst(x, 0.3, z, 0xffb347, Math.round(8 * size), 4 * size, 0.08);
  }

  /** Green/red arrows on the ground where an order was given. */
  orderMarker(x, z, color = 0x40ff40) {
    const m = basic(color, 1, true);
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(geo.cone(0.13, 0.45, 4), m);
      c.rotation.x = Math.PI;
      const a = (i / 3) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.45, 0.4, Math.sin(a) * 0.45);
      c.rotation.z = Math.cos(a) * 0.6;
      c.rotation.x = Math.PI + Math.sin(a) * 0.6;
      g.add(c);
    }
    const ring = new THREE.Mesh(geo.ring(0.35, 0.5, 24), m);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    g.position.set(x, this.h(x, z), z);
    this.add(g, (t) => {
      const k = t / 0.6;
      g.scale.setScalar(1.4 - k * 0.6);
      g.position.y = this.h(x, z) + (1 - k) * 0.3;
      m.opacity = 1 - k;
      return t < 0.6;
    });
  }

  beam(x, z, color, height = 8, radius = 0.7, dur = 1.0) {
    if (!this.visible(x, z)) return;
    const m = basic(color, 0.7, true);
    const mesh = new THREE.Mesh(geo.cyl(1, 1, 1, 16), m);
    mesh.position.set(x, this.h(x, z) + height / 2, z);
    mesh.scale.set(radius, height, radius);
    this.add(mesh, (t) => {
      const k = t / dur;
      mesh.scale.x = mesh.scale.z = radius * (1 - k * 0.7);
      m.opacity = 0.7 * (1 - k);
      return t < dur;
    });
  }

  holyLight(target) {
    this.beam(target.x, target.z, 0xfff3a0, 7, 0.75, 1.0);
    this.burst(target.x, 0.6, target.z, 0xfff3a0, 14, 2.5);
  }

  levelUp(h) {
    this.beam(h.x, h.z, 0xffd700, 9, 0.9, 1.4);
    this.ring(h.x, h.z, 0xffd700, 2.5, 1.0);
    this.burst(h.x, 1, h.z, 0xffe680, 20, 3);
  }

  // -------------------------------------------------------------- spells
  blizzard(x, z, r) {
    if (!this.visible(x, z)) return;
    const m = basic(0x7fc8ff, 0.7, true);
    const g = new THREE.Group();
    const shards = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(geo.cone(0.06, 0.45, 4), m);
      s.rotation.x = Math.PI;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      s.position.set(Math.cos(a) * rr, 6 + Math.random() * 3, Math.sin(a) * rr);
      s.userData.delay = Math.random() * 0.3;
      g.add(s);
      shards.push(s);
    }
    g.position.set(x, this.h(x, z), z);
    this.add(g, (t, dt) => {
      for (const s of shards) {
        if (t > s.userData.delay) s.position.y = Math.max(0.2, s.position.y - dt * 16);
      }
      m.opacity = t > 0.6 ? Math.max(0, 0.7 - (t - 0.6) * 2) : 0.7;
      return t < 1.0;
    });
    this.later(0.45, () => this.ring(x, z, 0x3f7fbf, r, 0.4, r * 0.9, 0.45));
  }

  meteor(x, z, onImpact) {
    const m = basic(0xff7a1a, 1, true);
    const m2 = basic(0xffd27a, 0.5, true);
    const g = new THREE.Group();
    const rock = new THREE.Mesh(geo.ico(0.45, 0), m);
    const glow = new THREE.Mesh(geo.sphere(0.8, 10, 8), m2);
    g.add(rock, glow);
    const gy = this.h(x, z);
    const sx = x - 5;
    const sz = z - 5;
    const sy = gy + 14;
    g.position.set(sx, sy, sz);
    const dur = 0.7;
    let hit = false;
    g.visible = this.visible(x, z);
    this.add(g, (t) => {
      const k = Math.min(1, t / dur);
      g.position.set(sx + (x - sx) * k, sy + (gy - sy) * k, sz + (z - sz) * k);
      rock.rotation.x += 0.2;
      if (k >= 1 && !hit) {
        hit = true;
        onImpact?.();
        this.explosion(x, z, 1.4);
        this.game.shake(0.2);
      }
      return k < 1;
    });
  }

  volley(caster, x, z, r) {
    if (!this.visible(x, z) && !this.visible(caster.x, caster.z)) return;
    const m = basic(0xe8ffe0, 1, true);
    const g = new THREE.Group();
    const arrows = [];
    for (let i = 0; i < 18; i++) {
      const a = new THREE.Mesh(geo.box(0.04, 0.04, 0.7), m);
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      a.userData.tx = x + Math.cos(ang) * rr;
      a.userData.tz = z + Math.sin(ang) * rr;
      a.userData.delay = Math.random() * 0.15;
      g.add(a);
      arrows.push(a);
    }
    const sx = caster.x;
    const sz = caster.z;
    const sy = this.h(sx, sz) + 1.2;
    this.add(g, (t) => {
      for (const a of arrows) {
        const k = Math.min(1, Math.max(0, (t - a.userData.delay) / 0.55));
        const ty = this.h(a.userData.tx, a.userData.tz) + 0.2;
        const px = sx + (a.userData.tx - sx) * k;
        const pz = sz + (a.userData.tz - sz) * k;
        const py = sy + (ty - sy) * k + Math.sin(Math.PI * k) * 5;
        const nk = Math.min(1, k + 0.02);
        const nx = sx + (a.userData.tx - sx) * nk;
        const nz = sz + (a.userData.tz - sz) * nk;
        const ny = sy + (ty - sy) * nk + Math.sin(Math.PI * nk) * 5;
        a.position.set(px, py, pz);
        a.lookAt(nx, ny, nz);
      }
      m.opacity = t > 0.7 ? Math.max(0, 1 - (t - 0.7) * 4) : 1;
      return t < 0.95;
    });
  }

  star(x, z) {
    if (!this.visible(x, z)) return;
    const m = basic(0xe6dcff, 1, true);
    const g = new THREE.Group();
    const s = new THREE.Mesh(geo.octa(0.3), m);
    const trail = new THREE.Mesh(geo.cyl(0.02, 0.18, 3, 6), basic(0xb9a6ff, 0.5, true));
    trail.position.y = 1.6;
    g.add(s, trail);
    const gy = this.h(x, z);
    this.add(g, (t) => {
      const k = Math.min(1, t / 0.5);
      g.position.set(x + (1 - k) * 3, gy + 10 * (1 - k) + 0.3, z - (1 - k) * 3);
      s.rotation.y += 0.3;
      if (k >= 1) {
        this.burst(x, 0.3, z, 0xd4c2ff, 8, 2.5);
        return false;
      }
      return true;
    });
  }

  later(delay, fn) {
    const dummy = new THREE.Object3D();
    this.add(dummy, (t) => {
      if (t >= delay) {
        fn();
        return false;
      }
      return true;
    });
  }
}
