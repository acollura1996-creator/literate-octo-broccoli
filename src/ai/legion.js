// Kalenden and his Legion: the boss holds the citadel at the center of the
// map and periodically sends armies to crush the generals.
import { CITADEL, CENTER } from '../world/layout.js';
import { ABILITIES } from '../game/abilities.js';

export class LegionManager {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    const d = game.difficulty;
    this.waveTimer = [380, 300, 240][d];
    this.waveInterval = [240, 200, 165][d];
    this.waveUnits = [];
    this.targetOrder = [];
    this.thinkTimer = 0;
    this.awake = false;
  }

  setup() {
    const g = this.game;
    const L = g.legion;
    const [kx, kz] = CITADEL.keep;
    this.keep = g.spawnUnit('kalenden_keep', L, kx, kz);
    for (const [x, z] of CITADEL.towers) g.spawnUnit('dark_tower', L, x, z);
    const [bx, bz] = CITADEL.kalenden;
    this.kalenden = g.spawnUnit('kalenden', L, bx, bz, { facing: 0 });
    this.kalenden.guardPos = { x: bx, z: bz, facing: 0, leash: 17 };
    const hpBonus = [-1500, 0, 2000][g.difficulty];
    if (hpBonus) {
      this.kalenden.addBuff('tyrant_might', 1e9, { hp: hpBonus });
      this.kalenden.hp = this.kalenden.maxHp;
    }
    this.guards = [];
    for (const gd of CITADEL.guards) {
      const p = g.grid.nearestWalkable(gd.at[0], gd.at[1], 3);
      const face = Math.atan2(gd.at[0] - CENTER, gd.at[1] - CENTER);
      const u = g.spawnUnit(gd.type, L, p.x, p.z, { facing: face });
      u.guardPos = { x: p.x, z: p.z, facing: face, leash: 15 };
      this.guards.push(u);
    }
  }

  gateFor(target) {
    const [hx, hz] = target.base.hall;
    const dx = hx - CENTER;
    const dz = hz - CENTER;
    // Pick the gate whose side faces the target most directly.
    const h = CITADEL.half;
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? { x: CENTER + h - 2.5, z: CENTER } : { x: CENTER - h + 2.5, z: CENTER };
    return dz > 0 ? { x: CENTER, z: CENTER + h - 2.5 } : { x: CENTER, z: CENTER - h + 2.5 };
  }

  pickTarget() {
    const alive = this.game.generals.filter((p) => !p.defeated);
    if (!alive.length) return null;
    if (!this.targetOrder.length) this.targetOrder = [...alive].sort(() => Math.random() - 0.5);
    while (this.targetOrder.length) {
      const p = this.targetOrder.shift();
      if (!p.defeated) return p;
    }
    return alive[0];
  }

  launchWave() {
    const g = this.game;
    const target = this.pickTarget();
    if (!target) return;
    this.wave++;
    const n = this.wave;
    const comp = [];
    // Hero-path generals have small bases, so they face smaller waves.
    const k = (target.mode === 'hero' ? 0.6 : 1) * [0.8, 1, 1.2][g.difficulty];
    for (let i = 0; i < Math.round(Math.min(8, 2 + n) * k); i++) comp.push('skeleton');
    for (let i = 0; i < Math.round(Math.min(4, 1 + Math.floor(n / 3)) * k); i++) comp.push('skeleton_archer');
    for (let i = 0; i < Math.floor(Math.min(3, Math.floor(n / 3)) * k); i++) comp.push('dark_knight');
    const gate = this.gateFor(target);
    const goal = { x: target.base.hall[0], z: target.base.hall[1] };
    comp.forEach((type, i) => {
      const a = (i / comp.length) * Math.PI * 2;
      const p = g.grid.nearestWalkable(gate.x + Math.cos(a) * 1.8, gate.z + Math.sin(a) * 1.8, 5);
      if (!p) return;
      const u = g.spawnUnit(type, g.legion, p.x, p.z, { facing: Math.atan2(goal.x - p.x, goal.z - p.z) });
      u.wave = { target };
      g.issueOrder(u, { type: 'attackMove', point: goal });
      this.waveUnits.push(u);
      g.hooks.fx?.burst(p.x, 0.4, p.z, 0x9dff6a, 6);
    });
    const col = `#${target.color.toString(16).padStart(6, '0')}`;
    g.message(`Kalenden's Legion (wave ${n}) marches on ${target.isHuman ? 'YOU' : target.name}!`, target.isHuman ? '#ff5050' : col);
    g.sound('horn');
    if (target.isHuman) g.ping(gate.x, gate.z, '#ff3333');
  }

  /**
   * Kalenden's power grows with the most advanced empire: from the Dark Age on, each age gives
   * him, his citadel and his Legion +25% health, +15% damage and more armor.
   */
  scaleWithAges() {
    const g = this.game;
    const top = Math.max(1, ...g.generals.filter((p) => !p.defeated).map((p) => p.tier || 1));
    const k = Math.max(0, top - 3);
    for (const u of g.legion.units.concat(g.legion.buildings)) {
      if (u.dead) continue;
      const cur = u.buffs.get('dominion');
      if ((cur?.k ?? 0) === k) continue;
      const ratio = u.hp / u.maxHp;
      if (k === 0) u.removeBuff('dominion');
      else {
        const [d0, d1] = u.def.damage ?? [0, 0];
        u.addBuff('dominion', Infinity, { k, replace: true, hp: Math.round(u.def.hp * 0.25 * k), damage: Math.round(((d0 + d1) / 2) * 0.15 * k), armor: Math.round(k * 0.6) });
      }
      u.hp = Math.max(1, u.maxHp * ratio);
    }
  }

  update(dt) {
    const g = this.game;
    if (g.over) return;
    if (!this.keep.dead) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveTimer = this.waveInterval;
        this.launchWave();
      }
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 0.5;
    this.scaleTimer = (this.scaleTimer ?? 0) - 0.5;
    if (this.scaleTimer <= 0) {
      this.scaleTimer = 5;
      this.scaleWithAges();
    }

    // Wave units that run out of orders keep pressing the attack.
    this.waveUnits = this.waveUnits.filter((u) => !u.dead);
    for (const u of this.waveUnits) {
      if (u.order.type !== 'idle') continue;
      let t = u.wave.target;
      if (t.defeated) t = u.wave.target = this.pickTarget() ?? t;
      const b = this.nearestStructure(t, u);
      if (b) g.issueOrder(u, { type: 'attackMove', point: { x: b.x, z: b.z } });
    }

    // Kalenden's spells.
    const k = this.kalenden;
    if (!k.dead) {
      const near = g.enemiesInRadius(k.owner, k.x, k.z, 5.5);
      if (near.length && !this.awake) {
        this.awake = true;
        g.message('Kalenden: "Who dares enter my citadel? Your bones will join my Legion!"', '#ff7070');
        g.sound('roar', k.x, k.z);
      }
      if (near.length >= 2 || near.some((u) => u.isHero)) this.tryCast(k, 'war_stomp');
      if (k.hp < k.maxHp * 0.9 && g.enemiesInRadius(k.owner, k.x, k.z, 10).length) this.tryCast(k, 'raise_dead');
      if (!near.length && k.order.type === 'idle') this.awake = false;
    }
  }

  tryCast(u, id) {
    if ((u.cooldowns[id] || 0) > 0 || u.stunned) return;
    const ab = ABILITIES[id];
    u.cooldowns[id] = ab.cooldown[0];
    u.anim = 'cast';
    u.animTime = 0;
    ab.cast(this.game, u, 1);
  }

  nearestStructure(p, from) {
    let best = null;
    let bd = Infinity;
    for (const b of p.buildings) {
      if (b.dead) continue;
      const d = from.distTo(b);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best && p.hero && !p.hero.dead) return p.hero;
    return best;
  }
}
