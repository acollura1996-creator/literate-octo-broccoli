// Transient visual effects on Babylon: hit sparks, explosions, rings, spell visuals, order markers,
// level-up beams, the nuke and tree highlights. A port of src/render/effects.js (same API, same
// timings and shapes), built from FxKit instances. Effects are visual only: anything that affects
// the game (damage, timers) lives in the simulation.
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { FxKit, FxMaterial, FxNode, shape as geo } from './FxKit';
import type { EffectsApi } from '../game/hooks';

interface GameLike {
  terrain: { heightAt(x: number, z: number): number };
  fog: { isVisible(x: number, z: number): boolean };
}

interface Entry {
  obj: FxNode;
  update: (t: number, dt: number) => boolean;
  dispose?: () => void;
  t: number;
}

type Pos = { x: number; z: number };

function basic(color: number, opacity = 1, additive = false): FxMaterial {
  return new FxMaterial(color, opacity, additive, true);
}

export class Effects implements EffectsApi {
  private list: Entry[] = [];
  readonly kit: FxKit;
  private treeHL: { g: FxNode; ring: FxMaterial; shell: FxMaterial; shells: FxNode[] } | null = null;

  constructor(
    readonly game: GameLike,
    scene: Scene,
  ) {
    this.kit = new FxKit(scene);
  }

  visible(x: number, z: number): boolean {
    return this.game.fog.isVisible(x, z);
  }

  h(x: number, z: number): number {
    return this.game.terrain.heightAt(x, z);
  }

  add(obj: FxNode, update: Entry['update'], dispose?: () => void): void {
    obj.sync();
    this.list.push({ obj, update, dispose, t: 0 });
  }

  update(dt: number): void {
    const keep: Entry[] = [];
    for (const e of this.list) {
      e.t += dt;
      let alive = false;
      try {
        alive = e.update(e.t, dt);
      } catch (err) {
        console.error(err);
      }
      if (alive) {
        e.obj.sync();
        keep.push(e);
      } else {
        e.obj.dispose();
        e.dispose?.();
      }
    }
    this.list = keep;
  }

  clear(): void {
    for (const e of this.list) e.obj.dispose();
    this.list = [];
    this.treeHL?.g.dispose();
    this.treeHL = null;
  }

  // ------------------------------------------------------------- basics
  burst(x: number, y: number, z: number, color: number, count = 10, speed = 3, size = 0.08, life = 0.7): void {
    if (!this.visible(x, z)) return;
    const g = this.kit.group('burst');
    const m = basic(color, 1, true);
    const parts: Array<{ n: FxNode; v: Vector3 }> = [];
    for (let i = 0; i < count; i++) {
      const p = this.kit.mesh(geo.octa(size), m);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const s = speed * (0.4 + Math.random() * 0.6);
      const v = new Vector3(Math.cos(a) * s * (1 - up * 0.5), up * s * 1.2 + 0.5, Math.sin(a) * s * (1 - up * 0.5));
      g.add(p);
      parts.push({ n: p, v });
    }
    g.position.set(x, this.h(x, z) + y, z);
    this.add(g, (t, dt) => {
      for (const p of parts) {
        p.v.y -= 6 * dt;
        p.n.position.addInPlace(p.v.scale(dt));
        p.n.rotation.x += dt * 5;
      }
      m.opacity = Math.max(0, 1 - t / life);
      return t < life;
    });
  }

  hit(target: { x: number; z: number; view?: { height?: number } | null }, color = 0xffeecc): void {
    const y = (target.view?.height ?? 1) * 0.6;
    this.burst(target.x, y, target.z, color, 4, 2, 0.05, 0.35);
  }

  ring(x: number, z: number, color: number, radius: number, dur = 0.6, startR = 0.2, opacity = 0.9): void {
    if (!this.visible(x, z)) return;
    const m = basic(color, opacity, true);
    const mesh = this.kit.mesh(geo.ring(0.85, 1, 40), m);
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

  explosion(x: number, z: number, size = 1): void {
    if (!this.visible(x, z)) return;
    const m = basic(0xffa040, 0.9, true);
    const m2 = basic(0x553b2a, 0.6, false);
    const g = this.kit.group('explosion');
    const ball = this.kit.mesh(geo.sphere(1, 10, 8), m);
    const smoke = this.kit.mesh(geo.ico(1, 1), m2);
    g.add(ball, smoke);
    g.position.set(x, this.h(x, z) + 0.4 * size, z);
    this.add(g, (t) => {
      const k = t / 0.7;
      ball.scale.setAll(size * (0.3 + k * 1.1));
      m.opacity = Math.max(0, 0.9 - k * 1.3);
      smoke.scale.setAll(size * (0.4 + k * 1.4));
      smoke.position.y = k * size;
      m2.opacity = Math.max(0, 0.6 - k * 0.7);
      return t < 0.85;
    });
    this.burst(x, 0.3, z, 0xffb347, Math.round(8 * size), 4 * size, 0.08);
  }

  /** Brief flash at a gun's muzzle. */
  muzzle(x: number, y: number, z: number, color = 0xffd27a, size = 0.22): void {
    if (!this.visible(x, z)) return;
    const m = basic(color, 1, true);
    const mesh = this.kit.mesh(geo.octa(1), m);
    mesh.position.set(x, y, z);
    this.add(mesh, (t) => {
      const k = t / 0.09;
      mesh.scale.setAll(size * (0.6 + k));
      mesh.rotation.y += 1.3;
      m.opacity = Math.max(0, 1 - k);
      return t < 0.09;
    });
  }

  /** Small smoke puff (rocket trails, exhaust). */
  puff(x: number, y: number, z: number, color = 0xb8b2a8, size = 0.25, life = 0.8): void {
    if (!this.visible(x, z)) return;
    const m = basic(color, 0.55);
    const mesh = this.kit.mesh(geo.ico(1, 0), m);
    mesh.position.set(x, y, z);
    this.add(mesh, (t, dt) => {
      const k = t / life;
      mesh.scale.setAll(size * (0.6 + k * 1.6));
      mesh.position.y += dt * 0.5;
      m.opacity = Math.max(0, 0.55 * (1 - k));
      return t < life;
    });
  }

  /** A nuclear missile rises from its silo, arcs over the land and falls on (x, z). */
  nukeLaunch(silo: Pos, x: number, z: number, flight: number): void {
    const gm = basic(0xdcdcdc, 1);
    const fm = basic(0xffb347, 1, true);
    const g = this.kit.group('nuke');
    const body = this.kit.mesh(geo.cyl(0.18, 0.18, 1.6, 8), gm);
    const nose = this.kit.mesh(geo.cone(0.18, 0.45, 8), basic(0xc0392b, 1));
    nose.position.y = 1.02;
    const flame = this.kit.mesh(geo.cone(0.2, 0.9, 8), fm);
    flame.rotation.x = Math.PI;
    flame.position.y = -1.2;
    g.add(body, nose, flame);
    const sx = silo.x;
    const sz = silo.z;
    const sy = this.h(sx, sz) + 1;
    const ty = this.h(x, z);
    const peak = 45;
    g.position.set(sx, sy, sz);
    // Red warning circle at the target, visible to everyone.
    const rm = basic(0xff2020, 0.6, true);
    const ring = this.kit.mesh(geo.ring(0.92, 1, 48), rm);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, ty + 0.2, z);
    const dot = this.kit.mesh(geo.circle(1, 24), basic(0xff2020, 0.25, true));
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(x, ty + 0.18, z);
    dot.scale.setAll(0.6);
    this.add(ring, (t) => {
      const pulse = 0.5 + 0.5 * Math.sin(t * 10);
      ring.scale.setAll(9 * (0.92 + 0.08 * pulse));
      rm.opacity = 0.35 + 0.4 * pulse;
      return t < flight;
    });
    this.add(dot, (t) => {
      dot.scale.setAll(0.6 + 0.4 * Math.sin(t * 10));
      return t < flight;
    });
    let lastPuff = 0;
    const prev = new Vector3();
    this.add(g, (t) => {
      const k = Math.min(1, t / flight);
      prev.copyFrom(g.position);
      const px = sx + (x - sx) * k;
      const pz = sz + (z - sz) * k;
      const py = sy + (ty - sy) * k + Math.sin(Math.PI * k) * peak;
      g.position.set(px, py, pz);
      const dir = g.position.subtract(prev);
      if (dir.lengthSquared() > 1e-6) g.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
      flame.scale.setAll(0.8 + Math.random() * 0.4);
      if (t - lastPuff > 0.06) {
        lastPuff = t;
        this.puff(prev.x, prev.y, prev.z, 0xd8d2c8, 0.45, 1.6);
      }
      return k < 1;
    });
  }

  /** The nuclear blast: white flash, fireball, shockwave and a rising mushroom cloud. */
  nukeBlast(x: number, z: number, R: number): void {
    const y = this.h(x, z);
    const flashM = basic(0xffffff, 1, true);
    const flash = this.kit.mesh(geo.sphere(1, 16, 12), flashM);
    flash.position.set(x, y + 1, z);
    this.add(flash, (t) => {
      flash.scale.setAll(2 + t * R * 3);
      flashM.opacity = Math.max(0, 1 - t / 0.35);
      return t < 0.35;
    });
    const fireM = basic(0xff8a2a, 0.95, true);
    const fire = this.kit.mesh(geo.sphere(1, 16, 12), fireM);
    fire.position.set(x, y + 1, z);
    this.add(fire, (t) => {
      const k = t / 2.2;
      fire.scale.setAll(R * 0.25 + R * 0.55 * Math.min(1, k * 2));
      fire.position.y = y + 1 + k * 4;
      fireM.setHSL(0.07 - k * 0.05, 1, 0.55 - k * 0.25);
      fireM.opacity = Math.max(0, 0.95 - k);
      return t < 2.2;
    });
    // Shockwave rings.
    this.ring(x, z, 0xffe2b0, R * 2.2, 1.2, 1, 0.9);
    this.later(0.15, () => this.ring(x, z, 0xff9a5a, R * 1.6, 1.0, 1, 0.7));
    // Mushroom cloud: a rising stem and a billowing cap.
    const smokeM = basic(0x6a5a50, 0.8);
    const capM = basic(0x8a7464, 0.85);
    const cloud = this.kit.group('mushroom');
    const stem = this.kit.mesh(geo.cyl(0.7, 1.1, 1, 10), smokeM);
    const cap = this.kit.mesh(geo.sphere(1, 14, 10), capM);
    const skirt = this.kit.mesh(geo.ring(0.6, 1, 24), capM);
    skirt.rotation.x = -Math.PI / 2;
    cloud.add(stem, cap, skirt);
    cloud.position.set(x, y, z);
    this.add(cloud, (t) => {
      const k = Math.min(1, t / 3.5);
      const h = 2 + k * 16;
      stem.scale.set(1 + k * 1.5, h, 1 + k * 1.5);
      stem.position.y = h / 2;
      cap.scale.set(3 + k * 6, 2 + k * 3.5, 3 + k * 6);
      cap.position.y = h + 1;
      skirt.scale.setAll(3 + k * 7);
      skirt.position.y = h - 0.5;
      const fade = t > 6 ? Math.max(0, 1 - (t - 6) / 3) : 1;
      smokeM.opacity = 0.8 * fade;
      capM.opacity = 0.85 * fade;
      capM.setHSL(0.05, 0.25 + 0.4 * (1 - k), 0.3 + 0.25 * (1 - k));
      return t < 9;
    });
    for (let i = 0; i < 4; i++) this.later(i * 0.15, () => this.burst(x, 1, z, 0xffb347, 18, 9, 0.18, 1.2));
  }

  /** Green/red arrows on the ground where an order was given. */
  orderMarker(x: number, z: number, color = 0x40ff40): void {
    const m = basic(color, 1, true);
    const g = this.kit.group('order');
    for (let i = 0; i < 3; i++) {
      const c = this.kit.mesh(geo.cone(0.13, 0.45, 4), m);
      const a = (i / 3) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.45, 0.4, Math.sin(a) * 0.45);
      c.rotation.z = Math.cos(a) * 0.6;
      c.rotation.x = Math.PI + Math.sin(a) * 0.6;
      g.add(c);
    }
    const ring = this.kit.mesh(geo.ring(0.35, 0.5, 24), m);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    g.position.set(x, this.h(x, z), z);
    this.add(g, (t) => {
      const k = t / 0.6;
      g.scale.setAll(1.4 - k * 0.6);
      g.position.y = this.h(x, z) + (1 - k) * 0.3;
      m.opacity = 1 - k;
      return t < 0.6;
    });
  }

  beam(x: number, z: number, color: number, height = 8, radius = 0.7, dur = 1.0): void {
    if (!this.visible(x, z)) return;
    const m = basic(color, 0.7, true);
    const mesh = this.kit.mesh(geo.cyl(1, 1, 1, 16), m);
    mesh.position.set(x, this.h(x, z) + height / 2, z);
    mesh.scale.set(radius, height, radius);
    this.add(mesh, (t) => {
      const k = t / dur;
      mesh.scale.x = mesh.scale.z = radius * (1 - k * 0.7);
      m.opacity = 0.7 * (1 - k);
      return t < dur;
    });
  }

  holyLight(target: Pos): void {
    this.beam(target.x, target.z, 0xfff3a0, 7, 0.75, 1.0);
    this.burst(target.x, 0.6, target.z, 0xfff3a0, 14, 2.5);
  }

  levelUp(h: Pos): void {
    this.beam(h.x, h.z, 0xffd700, 9, 0.9, 1.4);
    this.ring(h.x, h.z, 0xffd700, 2.5, 1.0);
    this.burst(h.x, 1, h.z, 0xffe680, 20, 3);
  }

  // -------------------------------------------------------------- spells
  blizzard(x: number, z: number, r: number): void {
    if (!this.visible(x, z)) return;
    const m = basic(0x7fc8ff, 0.7, true);
    const g = this.kit.group('blizzard');
    const shards: Array<{ n: FxNode; delay: number }> = [];
    for (let i = 0; i < 14; i++) {
      const s = this.kit.mesh(geo.cone(0.06, 0.45, 4), m);
      s.rotation.x = Math.PI;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      s.position.set(Math.cos(a) * rr, 6 + Math.random() * 3, Math.sin(a) * rr);
      g.add(s);
      shards.push({ n: s, delay: Math.random() * 0.3 });
    }
    g.position.set(x, this.h(x, z), z);
    this.add(g, (t, dt) => {
      for (const s of shards) {
        if (t > s.delay) s.n.position.y = Math.max(0.2, s.n.position.y - dt * 16);
      }
      m.opacity = t > 0.6 ? Math.max(0, 0.7 - (t - 0.6) * 2) : 0.7;
      return t < 1.0;
    });
    this.later(0.45, () => this.ring(x, z, 0x3f7fbf, r, 0.4, r * 0.9, 0.45));
  }

  /** A falling meteor (the impact itself is timed by the simulation, which calls onImpact). */
  meteor(x: number, z: number, onImpact?: () => void): void {
    const m = basic(0xff7a1a, 1, true);
    const m2 = basic(0xffd27a, 0.5, true);
    const g = this.kit.group('meteor');
    const rock = this.kit.mesh(geo.ico(0.45, 0), m);
    const glow = this.kit.mesh(geo.sphere(0.8, 10, 8), m2);
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
      }
      return k < 1;
    });
  }

  volley(caster: Pos, x: number, z: number, r: number): void {
    if (!this.visible(x, z) && !this.visible(caster.x, caster.z)) return;
    const m = basic(0xe8ffe0, 1, true);
    const g = this.kit.group('volley');
    const arrows: Array<{ n: FxNode; tx: number; tz: number; delay: number }> = [];
    for (let i = 0; i < 18; i++) {
      const a = this.kit.mesh(geo.box(0.04, 0.04, 0.7), m);
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      g.add(a);
      arrows.push({ n: a, tx: x + Math.cos(ang) * rr, tz: z + Math.sin(ang) * rr, delay: Math.random() * 0.15 });
    }
    const sx = caster.x;
    const sz = caster.z;
    const sy = this.h(sx, sz) + 1.2;
    this.add(g, (t) => {
      for (const a of arrows) {
        const k = Math.min(1, Math.max(0, (t - a.delay) / 0.55));
        const ty = this.h(a.tx, a.tz) + 0.2;
        const px = sx + (a.tx - sx) * k;
        const pz = sz + (a.tz - sz) * k;
        const py = sy + (ty - sy) * k + Math.sin(Math.PI * k) * 5;
        const nk = Math.min(1, k + 0.02);
        const nx = sx + (a.tx - sx) * nk;
        const nz = sz + (a.tz - sz) * nk;
        const ny = sy + (ty - sy) * nk + Math.sin(Math.PI * nk) * 5;
        a.n.position.set(px, py, pz);
        a.n.node.computeWorldMatrix(true);
        a.n.lookAt(nx, ny, nz);
      }
      m.opacity = t > 0.7 ? Math.max(0, 1 - (t - 0.7) * 4) : 1;
      return t < 0.95;
    });
  }

  star(x: number, z: number): void {
    if (!this.visible(x, z)) return;
    const m = basic(0xe6dcff, 1, true);
    const g = this.kit.group('star');
    const s = this.kit.mesh(geo.octa(0.3), m);
    const trail = this.kit.mesh(geo.cyl(0.02, 0.18, 3, 6), basic(0xb9a6ff, 0.5, true));
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

  /** Persistent highlight around one tree (hover / chosen for harvesting). */
  highlightTree(tree: { x: number; z: number; scale: number; species: number }, color: number): void {
    if (!this.treeHL) {
      const ring = new FxMaterial(0xffffff, 0.9, false);
      const shell = basic(0xffffff, 0.28, true);
      const g = this.kit.group('tree-highlight');
      const r = this.kit.mesh(geo.ring(0.62, 0.82, 32), ring);
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.1;
      const shells = [this.kit.mesh(geo.cone(1.0, 2.7, 8), shell), this.kit.mesh(geo.sphere(1.15, 10, 8), shell), this.kit.mesh(geo.cyl(0.35, 0.45, 2.4, 6), shell)];
      shells[0]!.position.y = 1.95;
      shells[1]!.position.y = 1.9;
      shells[2]!.position.y = 1.4;
      g.add(r, ...shells);
      this.treeHL = { g, ring, shell, shells };
    }
    const h = this.treeHL;
    h.g.visible = true;
    h.g.position.set(tree.x, this.h(tree.x, tree.z), tree.z);
    h.g.scale.setAll(tree.scale);
    h.shells.forEach((m, i) => (m.visible = i === tree.species));
    h.ring.setHex(color);
    h.shell.setHex(color);
    h.shell.opacity = 0.22 + Math.sin(performance.now() / 160) * 0.08;
    h.g.sync();
  }

  clearTreeHighlight(): void {
    if (this.treeHL) this.treeHL.g.visible = false;
  }

  later(delay: number, fn: () => void): void {
    this.add(this.kit.group('later'), (t) => {
      if (t >= delay) {
        fn();
        return false;
      }
      return true;
    });
  }
}
