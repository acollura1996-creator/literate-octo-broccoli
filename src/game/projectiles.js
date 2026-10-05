// Projectiles in flight: arrows, magic bolts, thrown axes, rocks and fireballs, Storm Bolt
// hammers, bullets, grenades, cannonballs, shells, rockets, plasma, and instant lasers and rail
// shots. Engine-free: this is where shots travel and land (calling their `onHit`); the renderers
// draw `list` (src/render/projectiles.js, src/babylon/Projectiles.ts). Homing unless they are lobbed
// at a point.
import { MUZZLE } from '../data/muzzles.js';

let nextId = 1;

export class Projectiles {
  constructor(game) {
    this.game = game;
    /** In-flight shots and fading beams, read by the renderers. */
    this.list = [];
  }

  /** Aim height: half the target's model height (as drawn). */
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
    const p = {
      ...o,
      id: nextId++,
      x: sx,
      y: sy,
      z: sz,
      sx,
      sy,
      sz,
      t: 0,
      dest: o.point ? { ...o.point } : { x: o.target.x, z: o.target.z },
    };
    if (o.arc) {
      p.dist = Math.max(1, Math.hypot(p.dest.x - sx, p.dest.z - sz));
    }
    this.list.push(p);
    return p;
  }

  /** Lasers hit instantly; the beam lingers briefly for the renderers. */
  beam(o, sx, sy, sz, width = 1) {
    const g = this.game;
    const t = o.target;
    const tx = t.x;
    const tz = t.z;
    const ty = g.terrain.heightAt(tx, tz) + this.unitHeight(t) * 0.5;
    try {
      o.onHit?.(t && !t.dead ? t : null, { x: tx, z: tz });
    } catch (e) {
      console.error(e);
    }
    const b = { id: nextId++, beam: true, kind: o.kind, color: o.color ?? 0x5ff2ff, width, sx, sy, sz, tx, ty, tz, t: 0, life: 0.14 };
    this.list.push(b);
    return b;
  }

  update(dt) {
    const g = this.game;
    const keep = [];
    for (const p of this.list) {
      if (p.beam) {
        p.t += dt;
        if (p.t < p.life) keep.push(p);
        continue;
      }
      let done = false;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
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
      if (done) {
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
