// Visual representation of a unit: model, procedural animation, selection
// circle, buff visuals and fog-of-war visibility.
import * as THREE from 'three';
import { createModel } from './models.js';
import { geo, mat } from './assets.js';

const ghostCache = new Map();
// Pole weapons thrust instead of swinging: the weapon tilts to this angle (lowering the
// pike or lance level) while the arm draws back and then lunges forward.
const THRUST = { spearman: 0.55, royal_knight: 0.05 };
// Guns aim (weapon.rotation.x) and kick back when they fire instead of swinging.
export const AIM = {};
function ghostMaterial(m, tint) {
  const key = `${m.uuid}|${tint ?? ''}`;
  let g = ghostCache.get(key);
  if (!g) {
    g = m.clone();
    g.transparent = true;
    g.opacity = tint ? 0.75 : 0.4;
    g.depthWrite = !!tint;
    if (tint) g.color = g.color.clone().lerp(new THREE.Color(tint), 0.45);
    g.onBeforeCompile = m.onBeforeCompile;
    g.customProgramCacheKey = m.customProgramCacheKey;
    ghostCache.set(key, g);
  }
  return g;
}

const RING_MATS = {
  own: new THREE.MeshBasicMaterial({ color: 0x33ff33, transparent: true, opacity: 0.9, depthWrite: false }),
  ally: new THREE.MeshBasicMaterial({ color: 0xffee33, transparent: true, opacity: 0.9, depthWrite: false }),
  enemy: new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.9, depthWrite: false }),
  neutral: new THREE.MeshBasicMaterial({ color: 0xffee33, transparent: true, opacity: 0.9, depthWrite: false }),
  hover: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
};
for (const m of Object.values(RING_MATS)) {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -4;
}

const AURA_COLORS = { devotion_aura: 0xffe08a, brilliance_aura: 0x9f8cff, trueshot_aura: 0xb8f08a };

export class UnitView {
  constructor(unit, game, scene) {
    this.unit = unit;
    this.game = game;
    this.scene = scene;
    this.group = new THREE.Group();
    this.buildModel();
    scene.add(this.group);
    this.hovered = false;
  }

  buildModel() {
    const u = this.unit;
    if (this.model) this.group.remove(this.model.root);
    const m = createModel(u.modelId, u.def.modelColor ?? u.owner.color);
    this.model = m;
    this.height = m.height ?? 1.2;
    this.parts = m.parts ?? {};
    m.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = u.isBuilding;
      }
    });
    // Remember rest positions for bobbing parts.
    for (const b of this.parts.bob ?? []) b.userData.baseY ??= b.position.y;
    this.group.add(m.root);
    this.ghostMode = null;
    if (u.isIllusion) this.setGhost('illusion');

    // Selection ring
    if (!this.ring) {
      const r = u.isBuilding ? u.def.footprint * 0.62 : u.radius * 1.35 + 0.1;
      this.ring = new THREE.Mesh(geo.ring(0.84, 1, 40), RING_MATS.own);
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.scale.setScalar(r);
      this.ring.position.y = 0.08;
      this.ring.renderOrder = 2;
      this.ring.visible = false;
      this.group.add(this.ring);
    }
    if (u.isBuilding) {
      this.scaffold?.removeFromParent();
      this.scaffold = null;
    }
  }

  setGhost(mode) {
    if (this.ghostMode === mode) return;
    this.ghostMode = mode;
    this.model.root.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.origMat ??= o.material;
      if (!mode) o.material = o.userData.origMat;
      else o.material = ghostMaterial(o.userData.origMat, mode === 'illusion' ? 0x6f9bff : null);
    });
  }

  relation() {
    const g = this.game;
    const u = this.unit;
    if (u.owner === g.human) return 'own';
    if (g.isEnemy(g.human, u.owner)) return 'enemy';
    if (u.owner.general) return 'ally';
    return 'neutral';
  }

  /** Should the human player see this unit right now? */
  computeVisible() {
    const g = this.game;
    const u = this.unit;
    if (u.removed) return false;
    if (u.hidden) return false;
    if (g.isAlliedToHuman(u.owner)) return true;
    if (u.isBuilding) {
      if (g.fog.isVisible(u.x, u.z)) u.seenByHuman = true;
      // Buildings stay remembered (darkened by fog) once seen.
      return u.seenByHuman && (!u.dead || g.fog.isVisible(u.x, u.z) || g.time - u.deathTime < 3);
    }
    if (u.invisible) return false;
    return g.fog.isVisible(u.x, u.z);
  }

  sync(dt, time) {
    const u = this.unit;
    const g = this.game;
    const vis = this.computeVisible();
    this.group.visible = vis;
    this.visibleNow = vis;
    if (!vis) return;

    const ground = g.terrain.heightAt(u.x, u.z);
    this.group.position.set(u.x, ground, u.z);
    const root = this.model.root;
    const P = this.parts;

    // Ghost (wind walk for own units)
    const wantGhost = u.isIllusion ? 'illusion' : u.invisible ? 'invisible' : null;
    if (wantGhost !== this.ghostMode) this.setGhost(wantGhost);

    // Scale (Avatar) and facing
    const s = u.mods.scale || 1;
    const curS = root.scale.x;
    const ns = curS + (s - curS) * Math.min(1, dt * 4);
    root.scale.setScalar(ns);
    if (!u.isBuilding) root.rotation.y = u.facing;
    else root.rotation.y = 0;

    // Construction
    if (u.isBuilding) this.syncConstruction(u);

    // Death
    if (u.dead) {
      const t = time - u.deathTime;
      if (u.isBuilding) {
        root.position.y = -Math.min(1, t / 2.2) * this.height * 0.8;
        root.rotation.z = Math.min(1, t / 2.2) * 0.12;
      } else {
        const k = Math.min(1, t / 0.45);
        root.rotation.x = -k * k * 1.45;
        root.position.y = t > 1.8 ? -(t - 1.8) * 0.35 : 0;
      }
      this.ring.visible = false;
      this.syncBuffVisuals(u, dt, time, true);
      return;
    }
    root.rotation.x = 0;
    root.position.y = 0;

    this.animate(u, dt, time, P);
    this.syncBuffVisuals(u, dt, time, false);
    this.syncCarry(u);

    // Selection / hover ring
    const rel = this.relation();
    if (u.selected) {
      this.ring.visible = true;
      this.ring.material = RING_MATS[rel];
    } else if (this.hovered) {
      this.ring.visible = true;
      this.ring.material = RING_MATS.hover;
    } else this.ring.visible = false;
  }

  syncConstruction(u) {
    const root = this.model.root;
    if (u.underConstruction) {
      const k = Math.max(0.05, u.buildProgress);
      root.scale.y = 0.08 + 0.92 * k;
      if (!this.scaffold) {
        const sc = createModel('construction', u.owner.color);
        const fp = u.def.footprint;
        sc.root.scale.set(fp, fp * 0.8, fp);
        this.scaffold = sc.root;
        this.group.add(this.scaffold);
      }
      this.scaffold.visible = true;
    } else if (this.scaffold) {
      this.scaffold.removeFromParent();
      this.scaffold = null;
      root.scale.y = root.scale.x;
    }
  }

  animate(u, dt, time, P) {
    const anim = u.anim;
    const t = u.animTime;
    // Walking
    if (anim === 'walk') u.walkCycle += dt * (u.speed * 2.6 + 2);
    const walking = anim === 'walk';
    const lerpTo = (obj, axis, v, k = 10) => {
      obj.rotation[axis] += (v - obj.rotation[axis]) * Math.min(1, dt * k);
    };
    for (const leg of P.legs ?? []) {
      const target = walking ? Math.sin(u.walkCycle + (leg.phase ?? 0)) * (leg.amp ?? 0.6) : 0;
      if (walking) leg.obj.rotation.x = target;
      else lerpTo(leg.obj, 'x', 0);
    }
    for (const arm of P.arms ?? []) {
      let target = walking ? Math.sin(u.walkCycle + (arm.phase ?? 0) + Math.PI) * 0.45 : 0;
      if (anim === 'cast') target = 1.3;
      lerpTo(arm.obj, 'x', target, 12);
    }
    if (P.body) {
      P.body.userData.baseY ??= P.body.position.y;
      const bob = walking ? Math.abs(Math.sin(u.walkCycle)) * 0.04 : Math.sin(time * 2 + u.id) * 0.01;
      P.body.position.y = P.body.userData.baseY + bob;
    }
    // Weapon arm
    if (P.weapon) {
      let w = walking ? Math.sin(u.walkCycle) * 0.3 : 0;
      const ranged = !!u.projectile;
      const thrust = THRUST[u.modelId];
      const rz = P.weapon.userData.restPosition?.z ?? 0;
      const gun = u.def.firearm || (u.isBuilding && u.projectile && u.projectile.kind !== 'arrow' && u.projectile.kind !== 'bolt');
      if (gun) {
        const aim = AIM[u.modelId] ?? 0;
        const since = this.game.time - (u.lastShotAt ?? -9);
        const kick = since < 0.22 ? 1 - since / 0.22 : 0;
        const heavy = u.def.vehicle || u.isBuilding || u.def.attackGround;
        if (anim === 'attack' || kick > 0) P.weapon.rotation.x = aim - kick * (heavy ? 0.06 : 0.14);
        else lerpTo(P.weapon, 'x', walking && !u.def.vehicle ? w * 0.4 : 0, 8);
        P.weapon.position.z = rz - kick * (heavy ? 0.12 : 0.06);
      } else if (thrust !== undefined && anim === 'attack') {
        const wind = Math.min(0.45, u.attackCooldown * 0.32);
        let reach;
        if (t < wind) {
          w = (t / wind) * thrust;
          reach = -(t / wind) * 0.12;
        } else if (t < wind + 0.1) {
          w = thrust;
          reach = -0.12 + ((t - wind) / 0.1) * 0.4;
        } else {
          const k = Math.max(0, 1 - (t - wind - 0.1) / 0.35);
          w = thrust * k;
          reach = 0.28 * k;
        }
        P.weapon.rotation.x = w;
        P.weapon.position.z = rz + reach;
      } else if (anim === 'attack') {
        const wind = Math.min(0.45, u.attackCooldown * 0.32);
        const siege = u.def.attackGround;
        const amp = siege ? 0.9 : ranged ? 0.55 : 2.1;
        const strike = siege ? -1.5 : ranged ? -0.25 : -0.95;
        if (t < wind) w = (t / wind) * amp;
        else if (t < wind + 0.1) w = amp + ((t - wind) / 0.1) * (strike - amp);
        else w = strike * Math.max(0, 1 - (t - wind - 0.1) / 0.3);
        P.weapon.rotation.x = w;
      } else if (anim === 'cast') {
        lerpTo(P.weapon, 'x', 2.5, 12);
      } else if (anim === 'work') {
        const c = (time * 1.6 + u.id * 0.37) % 1;
        P.weapon.rotation.x = c < 0.6 ? (c / 0.6) * 2.0 : 2.0 - ((c - 0.6) / 0.4) * 2.8;
      } else lerpTo(P.weapon, 'x', w, 10);
      if (thrust !== undefined && anim !== 'attack') P.weapon.position.z += (rz - P.weapon.position.z) * Math.min(1, dt * 10);
    }
    for (const sp of P.spin ?? []) sp.rotation.y += dt * 1.6;
    // Gates swing open for their owner's team.
    if (P.doors?.length) {
      const g = this.game;
      const friend = g.unitsNear(u.x, u.z, 2.6).some((o) => !o.isBuilding && !o.dead && o.owner.team !== undefined && o.owner.team === u.owner.team);
      this.doorOpen = (this.doorOpen ?? 0) + ((friend ? 1 : 0) - (this.doorOpen ?? 0)) * Math.min(1, dt * 5);
      for (const d of P.doors) d.obj.rotation.y = (d.side ?? 1) * this.doorOpen * 1.4;
    }
    for (const b of P.bob ?? []) {
      b.userData.baseY ??= b.position.y;
      b.position.y = b.userData.baseY + Math.sin(time * 2.2 + u.id) * 0.12;
    }
    for (const w of P.wings ?? []) w.obj.rotation.z = (w.side ?? 1) * Math.sin(time * 8 + u.id) * 0.6;
    if (u.moving) for (const wh of P.wheels ?? []) wh.rotation.x += dt * u.speed * 2.2;
    for (const f of P.fire ?? []) {
      f.userData.baseScale ??= f.scale.x;
      const k = f.userData.baseScale * (0.85 + Math.random() * 0.3);
      f.scale.set(k, f.userData.baseScale * (0.8 + Math.random() * 0.45), k);
    }
    for (const gl of P.glow ?? []) {
      gl.userData.baseScale ??= gl.scale.x;
      gl.scale.setScalar(gl.userData.baseScale * (1 + Math.sin(time * 3 + u.id) * 0.08));
    }
    // Bladestorm spin
    if (u.hasBuff('bladestorm')) this.model.root.rotation.y = time * 22;
  }

  syncCarry(u) {
    if (!u.def.worker) return;
    const kind = u.carry?.kind ?? null;
    if (kind === this.carryKind) return;
    this.carryKind = kind;
    this.carryMesh?.removeFromParent();
    this.carryMesh = null;
    if (!kind) return;
    const m =
      kind === 'gold'
        ? new THREE.Mesh(geo.dodeca(0.17, 0), mat(0xffcc33, { emissive: 0x664400, emissiveIntensity: 0.5 }))
        : new THREE.Mesh(geo.cyl(0.07, 0.07, 0.6, 6), mat(0x8b5a2b));
    if (kind === 'lumber') m.rotation.z = Math.PI / 2;
    m.position.set(0, this.height * 0.8, -0.2);
    m.castShadow = true;
    this.model.root.add(m);
    this.carryMesh = m;
  }

  syncBuffVisuals(u, dt, time, dead) {
    const want = new Set();
    if (!dead) {
      for (const b of u.buffs.values()) if (b.visual) want.add(b.visual);
      if (u.isHero) {
        for (const id of u.heroDef.abilities) {
          if (AURA_COLORS[id] && u.abilityLevel(id) > 0) want.add(`aura:${id}`);
        }
      }
    }
    this.fx ??= new Map();
    for (const [k, obj] of this.fx) {
      if (!want.has(k)) {
        obj.removeFromParent();
        this.fx.delete(k);
      }
    }
    for (const k of want) {
      let obj = this.fx.get(k);
      if (!obj) {
        obj = this.makeBuffVisual(k);
        if (!obj) continue;
        this.group.add(obj);
        this.fx.set(k, obj);
      }
      this.updateBuffVisual(k, obj, dt, time);
    }
  }

  makeBuffVisual(k) {
    const h = this.height;
    const r = this.unit.radius;
    const add = (c, o = 0.5) =>
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
    if (k === 'stun') {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(geo.octa(0.09), add(0xffee55, 0.9));
        const a = (i / 3) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
        g.add(s);
      }
      g.position.y = h + 0.25;
      return g;
    }
    if (k === 'shield') {
      const m = new THREE.Mesh(geo.sphere(1, 16, 12), add(0xffe680, 0.28));
      m.scale.setScalar(Math.max(0.9, h * 0.7));
      m.position.y = h * 0.5;
      return m;
    }
    if (k === 'slow') {
      const m = new THREE.Mesh(geo.ring(0.75, 1, 24), add(0xa070ff, 0.55));
      m.rotation.x = -Math.PI / 2;
      m.scale.setScalar(r * 1.6 + 0.2);
      m.position.y = 0.12;
      return m;
    }
    if (k === 'roots') {
      const g = new THREE.Group();
      const vm = mat(0x3f7a2a);
      for (let i = 0; i < 6; i++) {
        const v = new THREE.Mesh(geo.cone(0.07, 0.8, 4), vm);
        const a = (i / 6) * Math.PI * 2;
        v.position.set(Math.cos(a) * (r + 0.1), 0.3, Math.sin(a) * (r + 0.1));
        v.rotation.z = Math.cos(a) * -0.4;
        v.rotation.x = Math.sin(a) * 0.4;
        g.add(v);
      }
      return g;
    }
    if (k === 'bladestorm') {
      const m = new THREE.Mesh(geo.torus(1, 0.08, 4, 24), add(0xfff0c0, 0.6));
      m.rotation.x = Math.PI / 2;
      m.scale.setScalar(2.2);
      m.position.y = 0.6;
      return m;
    }
    if (k.startsWith('aura:')) {
      const id = k.slice(5);
      const m = new THREE.Mesh(geo.ring(0.9, 1, 32), add(AURA_COLORS[id], 0.35));
      m.rotation.x = -Math.PI / 2;
      m.scale.setScalar(1.3);
      m.position.y = 0.1;
      return m;
    }
    return null;
  }

  updateBuffVisual(k, obj, dt, time) {
    if (k === 'stun') obj.rotation.y += dt * 5;
    else if (k === 'shield') obj.material.opacity = 0.22 + Math.sin(time * 4) * 0.06;
    else if (k === 'bladestorm') obj.rotation.z += dt * 20;
    else if (k.startsWith('aura:')) {
      obj.rotation.z += dt * 0.8;
      obj.scale.setScalar(1.2 + Math.sin(time * 2) * 0.08);
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

/** Ground item (dropped by creeps). */
export class ItemView {
  constructor(item, game, scene, color) {
    this.item = item;
    this.game = game;
    const g = new THREE.Group();
    const box = new THREE.Mesh(geo.box(0.42, 0.3, 0.32), mat(0x7a4a22));
    box.position.y = 0.18;
    const lid = new THREE.Mesh(geo.box(0.44, 0.08, 0.34), mat(color));
    lid.position.y = 0.36;
    const glow = new THREE.Mesh(
      geo.ring(0.35, 0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    g.add(box, lid, glow);
    box.castShadow = true;
    this.spin = new THREE.Group();
    this.spin.add(box, lid);
    g.add(this.spin);
    this.group = g;
    this.glow = glow;
    g.position.set(item.x, game.terrain.heightAt(item.x, item.z), item.z);
    scene.add(g);
  }
  sync(dt, time) {
    this.group.visible = this.game.fog.isVisible(this.item.x, this.item.z);
    this.spin.rotation.y += dt;
    this.spin.position.y = 0.1 + Math.sin(time * 3) * 0.06;
    this.glow.material.opacity = 0.45 + Math.sin(time * 4) * 0.2;
  }
  dispose() {
    this.group.removeFromParent();
  }
}
