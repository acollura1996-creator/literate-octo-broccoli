// Draws the simulation's projectiles (src/game/projectiles.js) on Babylon: the same meshes as the
// three.js version (src/render/projectiles.js), oriented along their flight, with spin, smoke
// trails and fading laser beams.
import type { FxKit, FxNode, LitSpec } from './FxKit';
import { FxMaterial, shape as geo } from './FxKit';
import type { Effects } from './Effects';
import type { Game } from '../game/game.ts';
import type { Beam, Projectile } from '../game/projectiles.ts';

/** What the projectile view reads from the game. */
type GameLike = Pick<Game, 'projectiles' | 'fog'>;

interface ShotView {
  root: FxNode;
  spin?: FxNode;
  trail?: 'smoke' | 'flame';
  trailT: number;
  outer?: FxMaterial;
  core?: FxMaterial;
}

const lit = (color: number, extra: Omit<LitSpec, 'color'> = {}): LitSpec => ({ color, ...extra });

function makeShot(kit: FxKit, kind: string, color?: number): ShotView {
  const g = kit.group(`shot-${kind}`);
  const v: ShotView = { root: g, trailT: 0 };
  switch (kind) {
    case 'arrow': {
      const shaft = kit.lit(geo.box(0.04, 0.04, 0.75), lit(color ?? 0x8b6b3e));
      const tip = kit.lit(geo.cone(0.05, 0.14, 4), lit(0xcfcfcf));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.42;
      const fl = kit.lit(geo.box(0.12, 0.01, 0.14), lit(0xffffff));
      fl.position.z = -0.32;
      g.add(shaft, tip, fl);
      break;
    }
    case 'axe': {
      const handle = kit.lit(geo.box(0.05, 0.05, 0.45), lit(0x6b4a2b));
      const blade = kit.lit(geo.box(0.04, 0.25, 0.18), lit(0xb0b0b0));
      blade.position.set(0, 0.08, 0.18);
      const spin = kit.group('spin');
      spin.add(handle, blade);
      g.add(spin);
      v.spin = spin;
      break;
    }
    case 'rock': {
      const m = kit.lit(geo.dodeca(0.28), lit(0x7a7268));
      g.add(m);
      v.spin = m;
      break;
    }
    case 'fireball': {
      g.add(kit.lit(geo.sphere(0.22, 8, 6), lit(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 1.2 })));
      g.add(kit.lit(geo.sphere(0.34, 8, 6), lit(0xffb347, { opacity: 0.35, emissive: 0xff8800 })));
      break;
    }
    case 'hammer': {
      const spin = kit.group('spin');
      const head = kit.lit(geo.box(0.32, 0.22, 0.22), lit(0x9fd0ff, { emissive: 0x3a7bd5, emissiveIntensity: 0.9 }));
      const handle = kit.lit(geo.box(0.06, 0.4, 0.06), lit(0x6b4a2b));
      handle.position.y = -0.25;
      spin.add(head, handle);
      g.add(spin);
      g.add(kit.lit(geo.sphere(0.36, 8, 6), lit(0x9fd0ff, { opacity: 0.3, emissive: 0x6fb7ff })));
      v.spin = spin;
      break;
    }
    case 'javelin': {
      const shaft = kit.lit(geo.box(0.035, 0.035, 1.0), lit(0x8b6b3e));
      const tip = kit.lit(geo.cone(0.045, 0.2, 4), lit(0x9aa0a6));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.58;
      g.add(shaft, tip);
      break;
    }
    case 'flame': {
      g.add(kit.lit(geo.sphere(0.2, 8, 6), lit(0xffd27a, { emissive: 0xff8a00, emissiveIntensity: 1.6 })));
      g.add(kit.lit(geo.sphere(0.38, 8, 6), lit(0xff6a1a, { opacity: 0.5, emissive: 0xff4a00 })));
      v.trail = 'flame';
      break;
    }
    case 'stone': {
      const m = kit.lit(geo.dodeca(0.13), lit(0x8a8276));
      g.add(m);
      v.spin = m;
      break;
    }
    case 'bullet': {
      g.add(kit.lit(geo.box(0.035, 0.035, 0.6), lit(0xffe9a0, { emissive: 0xffc860, emissiveIntensity: 1.4 })));
      break;
    }
    case 'grenade': {
      const m = kit.lit(geo.sphere(0.11, 8, 6), lit(0x1c1c1c));
      const spark = kit.lit(geo.sphere(0.05, 6, 4), lit(0xffb347, { emissive: 0xff8a00, emissiveIntensity: 1.5 }));
      spark.position.y = 0.12;
      m.add(spark);
      g.add(m);
      v.spin = m;
      break;
    }
    case 'cannonball': {
      g.add(kit.lit(geo.sphere(0.17, 10, 8), lit(0x26241f)));
      break;
    }
    case 'shell': {
      const m = kit.lit(geo.box(0.09, 0.09, 0.32), lit(0x5a5040));
      const tail = kit.lit(geo.box(0.07, 0.07, 0.5), lit(0xffd27a, { opacity: 0.6, emissive: 0xffa040, emissiveIntensity: 1.2 }));
      tail.position.z = -0.35;
      g.add(m, tail);
      break;
    }
    case 'rocket': {
      const body = kit.lit(geo.cyl(0.06, 0.06, 0.45, 6), lit(0x6c7466));
      body.rotation.x = Math.PI / 2;
      const nose = kit.lit(geo.cone(0.06, 0.14, 6), lit(0x9a3a2a));
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.29;
      const flame = kit.lit(geo.cone(0.07, 0.3, 6), lit(0xffb347, { opacity: 0.85, emissive: 0xff7a00, emissiveIntensity: 1.6 }));
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -0.35;
      g.add(body, nose, flame);
      v.trail = 'smoke';
      break;
    }
    case 'plasma': {
      const c = color ?? 0x6af7ff;
      g.add(kit.lit(geo.sphere(0.18, 8, 6), lit(0xffffff, { emissive: c, emissiveIntensity: 1.6 })));
      g.add(kit.lit(geo.sphere(0.34, 8, 6), lit(c, { opacity: 0.45, emissive: c })));
      const tail = kit.lit(geo.cone(0.2, 0.9, 8), lit(c, { opacity: 0.35, emissive: c }));
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -0.5;
      g.add(tail);
      break;
    }
    default: {
      // Magic bolt.
      const c = color ?? 0x9fd8ff;
      g.add(kit.lit(geo.sphere(0.14, 8, 6), lit(c, { emissive: c, emissiveIntensity: 1.0 })));
      g.add(kit.lit(geo.sphere(0.26, 8, 6), lit(c, { opacity: 0.35, emissive: c })));
    }
  }
  return v;
}

export class ProjectileView {
  private readonly views = new Map<Projectile, ShotView>();

  constructor(
    readonly game: GameLike,
    private readonly fx: Effects,
  ) {}

  private makeBeam(p: Beam): ShotView {
    const kit = this.fx.kit;
    const width = p.width ?? 1;
    const outer = new FxMaterial(p.color ?? 0x5ff2ff, 0.9, true, false);
    const core = new FxMaterial(0xffffff, 0.95, true, false);
    const g = kit.group('beam');
    g.add(kit.mesh(geo.box(0.09 * width, 0.09 * width, 1), outer), kit.mesh(geo.box(0.035 * width, 0.035 * width, 1), core));
    const len = Math.hypot(p.tx - p.sx, p.ty - p.sy, p.tz - p.sz);
    g.scale.set(1, 1, len);
    g.position.set((p.sx + p.tx) / 2, (p.sy + p.ty) / 2, (p.sz + p.tz) / 2);
    g.node.computeWorldMatrix(true);
    g.lookAt(p.tx, p.ty, p.tz);
    g.visible = this.game.fog.isVisible(p.sx, p.sz) || this.game.fog.isVisible(p.tx, p.tz);
    return { root: g, trailT: 0, outer, core };
  }

  update(dt: number): void {
    const list = this.game.projectiles.list;
    const live = new Set(list);
    for (const [p, v] of this.views) {
      if (!live.has(p)) {
        v.root.dispose();
        this.views.delete(p);
      }
    }
    for (const p of list) {
      let v = this.views.get(p);
      if (!v) {
        v = p.beam ? this.makeBeam(p) : makeShot(this.fx.kit, p.kind, p.color);
        this.views.set(p, v);
      }
      if (p.beam) {
        const k = 1 - p.t / (p.life ?? 0.14);
        v.outer!.opacity = 0.9 * k;
        v.core!.opacity = 0.95 * k;
        v.root.sync();
        continue;
      }
      const g = v.root;
      g.position.set(p.x, p.y, p.z);
      const px = p.px ?? p.x;
      const py = p.py ?? p.y;
      const pz = p.pz ?? p.z;
      const vx = p.x - px;
      const vy = p.y - py;
      const vz = p.z - pz;
      if (vx * vx + vy * vy + vz * vz > 1e-8) {
        g.node.computeWorldMatrix(true);
        g.lookAt(p.x + vx, p.y + vy, p.z + vz);
      }
      if (v.spin) v.spin.rotation.x += dt * 18;
      if (v.trail) {
        v.trailT += dt;
        if (v.trailT > 0.04) {
          v.trailT = 0;
          if (v.trail === 'flame') this.fx.puff(px, py, pz, 0x4a3a30, 0.18, 0.5);
          else this.fx.puff(px, py, pz, 0xc8c2b8, 0.16, 0.6);
        }
      }
      g.visible = this.game.fog.isVisible(p.x, p.z);
      g.sync();
    }
  }

  clear(): void {
    for (const v of this.views.values()) v.root.dispose();
    this.views.clear();
  }
}
