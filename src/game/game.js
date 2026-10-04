// The Game: owns the world state and runs the simulation.
import * as THREE from 'three';
import { Unit } from './unit.js';
import { UNITS, ATTACK_TABLE, UPGRADES, XP_BY_LEVEL, HERO_XP, MAX_HERO_LEVEL, AGE_NAMES, AGES } from '../data/units.js';
import { HERO_IDS, AI_GENERAL_NAMES } from '../data/heroes.js';
import { ITEMS } from '../data/items.js';
import { ABILITIES } from './abilities.js';
import { updateUnit, stopMoving, finishOrder } from './behavior.js';
import { PathGrid, BLOCK_BUILDING, BLOCK_GATE } from '../world/pathgrid.js';
import { Roads } from './roads.js';
import { Empires } from './empire.js';
import { GameEvents } from './events.js';
import { Terrain } from '../world/terrain.js';
import { buildLayout, MAP_SIZE, CENTER, CITADEL, PLAYER_SLOTS, CITY_RADIUS } from '../world/layout.js';
import { Fog } from './fog.js';
import { TEAM_COLORS } from '../render/assets.js';
import { createModel } from '../render/models.js';
import { CreepManager } from '../ai/creeps.js';
import { LegionManager } from '../ai/legion.js';
import { GeneralAI } from '../ai/general.js';

const GENERAL_COLORS = [
  ['Red', TEAM_COLORS.red],
  ['Blue', TEAM_COLORS.blue],
  ['Teal', TEAM_COLORS.teal],
  ['Purple', TEAM_COLORS.purple],
];

const HASH_CELL = 4;
const HASH_DIM = Math.ceil(MAP_SIZE / HASH_CELL);

export class Game {
  /**
   * opts: { mode: 'hero'|'empire', heroId, difficulty: 'easy'|'normal'|'hard',
   *         rivals: [{ mode: 'random'|'hero'|'empire', hero: 'random'|heroId, team: 'rival'|'ally' }] }
   *   (legacy: opponents (1-3) and diplomacy: 'ffa'|'allied' are still accepted)
   * hooks: { scene, onUnitAdded(u), onUnitRemoved(u), onUnitChanged(u), fx, projectiles, sound(name, vol) }
   */
  constructor(opts, hooks) {
    this.opts = opts;
    this.hooks = hooks;
    this.scene = hooks.scene;
    this.time = 0;
    this.frame = 0;
    this.units = [];
    this.unitById = new Map();
    this.timers = [];
    this.corpses = [];
    this.groundItems = [];
    this.messages = [];
    this.floats = [];
    this.pings = [];
    this.allied = false; // true when every general is on the player's team (set in createPlayers)
    this.over = null; // { victory: bool, text }
    this.pathBudget = 0;
    this.lastAlert = -99;
    this.lastAlertPos = null;
    this.shakeAmount = 0;
    this.buckets = Array.from({ length: HASH_DIM * HASH_DIM }, () => []);
    this.difficulty = { easy: 0, normal: 1, hard: 2 }[opts.difficulty] ?? 1;
  }

  // ------------------------------------------------------------------ setup
  setup() {
    this.layout = buildLayout();
    this.grid = new PathGrid(MAP_SIZE);
    this.terrain = new Terrain(this.layout, this.grid);
    this.fog = new Fog(this);
    this.roads = new Roads(this);
    this.empires = new Empires(this);
    this.events = new GameEvents(this);

    this.createPlayers();

    // Flat spots for all pre-placed buildings.
    const t = this.terrain;
    for (const b of this.layout.bases) {
      t.addFlatSpot(b.hall[0], b.hall[1], 4);
      t.addFlatSpot(b.mine[0], b.mine[1], 2.5);
      t.addFlatSpot(b.shop[0], b.shop[1], 2.5);
    }
    for (const n of this.layout.neutrals) t.addFlatSpot(n.at[0], n.at[1], 2.5);
    t.generateHeights();
    t.classify();
    this.blockCitadelWalls();

    // Keep these areas free of trees.
    const clear = [];
    for (const b of this.layout.bases) {
      clear.push({ x: b.hall[0], z: b.hall[1], r: CITY_RADIUS });
      clear.push({ x: b.mine[0], z: b.mine[1], r: 4.5 });
      clear.push({ x: b.shop[0], z: b.shop[1], r: 5 });
      // Lane between mine and hall.
      clear.push({ x: (b.hall[0] + b.mine[0]) / 2, z: (b.hall[1] + b.mine[1]) / 2, r: 6 });
    }
    for (const n of this.layout.neutrals) clear.push({ x: n.at[0], z: n.at[1], r: 5 });
    for (const c of this.layout.camps) clear.push({ x: c.at[0], z: c.at[1], r: 5 });
    t.plantTrees((x, z) => clear.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r));
    t.buildMeshes();
    this.scene.add(t.group);
    this.buildCitadelWalls();

    // Neutral buildings.
    for (const n of this.layout.neutrals) {
      const u = this.spawnUnit(n.type, this.passive, n.at[0], n.at[1], {
        facing: Math.atan2(CENTER - n.at[0], CENTER - n.at[1]),
        gold: n.startMine ? 16000 : 22000,
      });
      if (n.type === 'mercenary_camp') {
        u.stock = {};
        for (const m of u.def.mercenaries) u.stock[m] = 2;
        u.stockTimer = 0;
      }
    }

    // Kalenden's citadel.
    this.legionMgr = new LegionManager(this);
    this.legionMgr.setup();

    // Creep camps.
    this.creepMgr = new CreepManager(this);
    this.creepMgr.setup();

    // Generals.
    for (const p of this.generals) this.setupGeneral(p);

    this.fog.update(true);
  }

  /** The computer generals: [{ mode, hero, team }], also accepting the legacy options. */
  rivalLineup() {
    let rivals = this.opts.rivals;
    if (!rivals?.length) {
      const n = Math.max(1, Math.min(3, this.opts.opponents ?? 3));
      const team = this.opts.diplomacy === 'allied' ? 'ally' : 'rival';
      rivals = Array.from({ length: n }, () => ({ mode: 'random', hero: 'random', team }));
    }
    return rivals.slice(0, 3);
  }

  createPlayers() {
    const rivals = this.rivalLineup();
    const n = 1 + rivals.length;
    this.generals = [];
    const names = [...AI_GENERAL_NAMES].sort(() => Math.random() - 0.5);
    // Random paths are resolved so the computer generals mix heroes and empires.
    const modes = rivals.map((r) => (r.mode === 'hero' || r.mode === 'empire' ? r.mode : null));
    rivals.forEach((r, i) => {
      if (modes[i]) return;
      const heroes = modes.filter((m) => m === 'hero').length;
      const empires = modes.filter((m) => m === 'empire').length;
      modes[i] = heroes < empires ? 'hero' : empires < heroes ? 'empire' : Math.random() < 0.5 ? 'hero' : 'empire';
    });
    // Random heroes avoid the ones already in play.
    const taken = new Set([this.opts.mode === 'hero' ? this.opts.heroId : null, ...rivals.map((r) => r.hero)]);
    const heroPool = HERO_IDS.filter((h) => !taken.has(h)).sort(() => Math.random() - 0.5);
    let poolIndex = 0;
    const pickHero = (r) => (r.hero && r.hero !== 'random' ? r.hero : heroPool[poolIndex++ % Math.max(1, heroPool.length)] ?? HERO_IDS[0]);
    const handicap = [0.85, 1.0, 1.15][this.difficulty];
    for (let i = 0; i < n; i++) {
      const isHuman = i === 0;
      const r = rivals[i - 1];
      const mode = isHuman ? this.opts.mode : modes[i - 1];
      const heroType = isHuman ? this.opts.heroId : pickHero(r);
      const [colorName, color] = GENERAL_COLORS[i];
      const p = this.makePlayer({
        index: i,
        name: isHuman ? (this.opts.playerName || 'You') : names[i - 1],
        colorName,
        color,
        isHuman,
        general: true,
        mode,
        team: isHuman || r.team === 'ally' ? 0 : i,
        heroType: mode === 'hero' ? heroType : null,
        slot: PLAYER_SLOTS[i],
        handicap: isHuman ? 1 : handicap,
        damageMult: isHuman ? 1 : handicap,
      });
      p.homeTeam = p.team;
      this.generals.push(p);
    }
    this.human = this.generals[0];
    this.allied = this.generals.every((p) => p.team === this.human.team);
    this.creeps = this.makePlayer({ index: 10, name: 'Neutral Hostile', colorName: 'Creeps', color: TEAM_COLORS.neutral, mode: 'creep' });
    this.legion = this.makePlayer({ index: 11, name: 'Kalenden', colorName: 'Legion', color: TEAM_COLORS.kalenden, mode: 'legion' });
    this.passive = this.makePlayer({ index: 12, name: 'Neutral Passive', colorName: 'Neutral', color: TEAM_COLORS.neutral, mode: 'passive' });
    this.players = [...this.generals, this.creeps, this.legion, this.passive];
  }

  makePlayer(d) {
    return {
      gold: 0,
      lumber: 0,
      foodUsed: 0,
      foodCap: 0,
      tier: 0,
      upgrades: { weapons: 0, armor: 0, lumber: 0 },
      units: [],
      buildings: [],
      hero: null,
      defeated: false,
      general: false,
      isHuman: false,
      handicap: 1,
      damageMult: 1,
      stats: { kills: 0, unitsLost: 0, goldMined: 0, lumberHarvested: 0, unitsTrained: 0, creepsKilled: 0 },
      incomeAcc: 0,
      ...d,
    };
  }

  setupGeneral(p) {
    const base = this.layout.bases[p.slot];
    p.base = base;
    const [hx, hz] = base.hall;
    const [tcx, tcz] = base.toCenter;
    if (p.mode === 'empire') {
      p.gold = 500;
      p.lumber = 150;
      p.tier = 1;
      this.empires.init(p);
      const th = this.spawnUnit('townhall', p, hx, hz);
      this.layStartingRoads(p, th);
      const mx = base.mine[0];
      const mz = base.mine[1];
      for (let i = 0; i < 5; i++) {
        const a = Math.atan2(mx - hx, mz - hz) + (i - 2) * 0.45;
        const pos = this.grid.nearestWalkable(hx + Math.sin(a) * 3.6, hz + Math.cos(a) * 3.6, 5);
        const peasant = this.spawnUnit('peasant', p, pos.x, pos.z, { facing: a });
        const mine = this.units.find((u) => u.type === 'goldmine' && Math.hypot(u.x - mx, u.z - mz) < 1);
        if (mine) this.issueOrder(peasant, { type: 'harvest', target: mine });
      }
    } else {
      p.gold = 250;
      p.lumber = 0;
      this.spawnUnit('altar', p, hx, hz);
      for (const [tx, tz] of base.towers) this.spawnUnit('guardtower', p, tx, tz);
      const pos = this.grid.nearestWalkable(hx + tcx * 3.5, hz + tcz * 3.5, 6);
      const hero = this.spawnUnit(p.heroType, p, pos.x, pos.z, { facing: Math.atan2(tcx, tcz) });
      p.hero = hero;
    }
    if (!p.isHuman) p.ai = new GeneralAI(this, p);
  }

  /** A town square: roads ringing the Town Hall plus a high street toward the map center. */
  layStartingRoads(p, th) {
    const { x: cx, z: cz } = th.cell;
    const fp = th.def.footprint;
    const cells = [];
    for (let i = -1; i <= fp; i++) cells.push([cx + i, cz - 1], [cx + i, cz + fp], [cx - 1, cz + i], [cx + fp, cz + i]);
    // High street: from the ring toward the center of the map.
    const [tx, tz] = p.base.toCenter;
    const sx = Math.round(th.x + tx * (fp / 2 + 1));
    const sz = Math.round(th.z + tz * (fp / 2 + 1));
    const ex = Math.round(th.x + tx * (fp / 2 + 12));
    const ez = Math.round(th.z + tz * (fp / 2 + 12));
    cells.push(...Roads.line(sx, sz, ex, ez));
    this.roads.place(cells, p, true);
  }

  blockCitadelWalls() {
    const half = CITADEL.half;
    const g = CITADEL.gateHalf;
    const lo = CENTER - half;
    const hi = CENTER + half;
    this.wallCells = [];
    for (let i = lo; i <= hi; i++) {
      const inGate = i >= CENTER - g && i < CENTER + g;
      if (inGate) continue;
      for (const [cx, cz] of [[i, lo], [i, hi], [lo, i], [hi, i]]) {
        this.grid.setFlag(cx, cz, BLOCK_BUILDING, true);
        this.wallCells.push([cx, cz]);
      }
    }
  }

  buildCitadelWalls() {
    const half = CITADEL.half;
    const g = CITADEL.gateHalf;
    const lo = CENTER - half;
    const hi = CENTER + half;
    const group = new THREE.Group();
    const place = (id, x, z, rotY) => {
      const m = createModel(id, TEAM_COLORS.kalenden);
      m.root.position.set(x, this.terrain.heightAt(x, z) - 0.05, z);
      m.root.rotation.y = rotY;
      m.root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      group.add(m.root);
    };
    // Segments are 2 long along X; place along each side.
    for (let i = lo; i < hi; i += 2) {
      const mid = i + 1;
      if (Math.abs(mid - CENTER) < g + 0.5) continue;
      place('wall_segment', mid, lo + 0.5, 0);
      place('wall_segment', mid, hi + 0.5, 0);
      place('wall_segment', lo + 0.5, mid, Math.PI / 2);
      place('wall_segment', hi + 0.5, mid, Math.PI / 2);
    }
    for (const [x, z] of [[lo, lo], [hi + 1, lo], [lo, hi + 1], [hi + 1, hi + 1]]) place('wall_tower', x, z, 0);
    // Gate towers.
    for (const s of [-1, 1]) {
      place('wall_tower', CENTER + s * (g + 0.6), lo + 0.5, 0);
      place('wall_tower', CENTER + s * (g + 0.6), hi + 0.5, 0);
      place('wall_tower', lo + 0.5, CENTER + s * (g + 0.6), 0);
      place('wall_tower', hi + 0.5, CENTER + s * (g + 0.6), 0);
    }
    this.scene.add(group);
    this.wallGroup = group;
  }

  // -------------------------------------------------------------- relations
  isEnemy(a, b) {
    if (!a || !b || a === b) return false;
    if (a.mode === 'passive' || b.mode === 'passive') return false;
    if (!a.general && !b.general) return false;
    if (a.general && b.general) return a.team !== b.team;
    return true;
  }
  isAlly(a, b) {
    return a === b || (!this.isEnemy(a, b) && a.mode !== 'passive' && b.mode !== 'passive');
  }
  isAlliedToHuman(p) {
    return p === this.human || (p.general && p.team === this.human.team);
  }
  /** CSS color for a player's name in messages (team colors lightened to read on dark UI). */
  nameColor(p) {
    const c = new THREE.Color(p.color).lerp(new THREE.Color(0xffffff), 0.35);
    return `#${c.getHexString()}`;
  }
  /** A message about another general's doings, in their color. */
  notify(p, text) {
    if (p?.isHuman) return;
    this.message(text, p ? this.nameColor(p) : '#ffd700');
  }
  get isNight() {
    const h = this.timeOfDay;
    return h < 6 || h >= 18;
  }
  /** Hours 0-24. A full day lasts 8 minutes; the game starts at 8:00. */
  get timeOfDay() {
    return (8 + (this.time / 480) * 24) % 24;
  }

  // ---------------------------------------------------------------- spawning
  snap(v, fp) {
    return fp % 2 === 0 ? Math.round(v) : Math.floor(v) + 0.5;
  }

  spawnUnit(type, owner, x, z, opts = {}) {
    const def = UNITS[type];
    if (def.kind === 'building') {
      x = this.snap(x, def.footprint);
      z = this.snap(z, def.footprint);
    }
    const u = new Unit(this, type, owner, x, z, opts);
    if (u.isBuilding) {
      const fp = def.footprint;
      u.cell = { x: Math.round(x - fp / 2), z: Math.round(z - fp / 2) };
      if (def.gate) {
        this.grid.setRect(u.cell.x, u.cell.z, fp, fp, BLOCK_GATE, true);
        for (let zz = u.cell.z; zz < u.cell.z + fp; zz++) {
          for (let xx = u.cell.x; xx < u.cell.x + fp; xx++) if (this.grid.inBounds(xx, zz)) this.grid.gateTeam[zz * MAP_SIZE + xx] = owner.team ?? -1;
        }
      } else this.grid.setRect(u.cell.x, u.cell.z, fp, fp, BLOCK_BUILDING, true);
      if (!def.gate) this.roads?.clear(u.cell.x, u.cell.z, fp, fp); // gates keep the road running through them
      owner.buildings.push(u);
      if (opts.construction) {
        u.underConstruction = true;
        u.buildProgress = 0;
        u.hp = Math.max(1, u.maxHp * 0.1);
      }
    } else {
      owner.units.push(u);
    }
    if (opts.illusion) u.isIllusion = true;
    this.units.push(u);
    this.unitById.set(u.id, u);
    this.hooks.onUnitAdded?.(u);
    this.updateTier(owner);
    return u;
  }

  removeUnit(u) {
    if (u.removed) return;
    u.removed = true;
    const arr = u.isBuilding ? u.owner.buildings : u.owner.units;
    const i = arr.indexOf(u);
    if (i >= 0) arr.splice(i, 1);
    this.unitById.delete(u.id);
    this.hooks.onUnitRemoved?.(u);
  }

  // ------------------------------------------------------------------ orders
  issueOrder(u, order, queue = false) {
    if (u.dead) return;
    if (queue && u.order.type !== 'idle') {
      u.orderQueue.push(order);
      return;
    }
    if (u.channel) this.endChannel(u);
    if (u.harvest?.inside) return; // can't be ordered while inside a mine
    if (order.type !== 'harvest' && order.type !== 'returnRes') u.harvest = null;
    u.orderQueue = [];
    u.castTimer = 0;
    u.castOrder = null;
    if (order.type === 'patrol') order.origin = { x: u.x, z: u.z };
    u.order = order;
    stopMoving(u);
  }

  // ------------------------------------------------------------- spatial
  rebuildHash() {
    for (const b of this.buckets) b.length = 0;
    for (const u of this.units) {
      if (u.dead || u.removed) continue;
      const cx = Math.min(HASH_DIM - 1, Math.max(0, Math.floor(u.x / HASH_CELL)));
      const cz = Math.min(HASH_DIM - 1, Math.max(0, Math.floor(u.z / HASH_CELL)));
      this.buckets[cz * HASH_DIM + cx].push(u);
    }
  }

  /** Living units whose edge lies within r of (x, z). */
  unitsNear(x, z, r) {
    const out = [];
    const pad = 3; // largest radius
    const x0 = Math.max(0, Math.floor((x - r - pad) / HASH_CELL));
    const x1 = Math.min(HASH_DIM - 1, Math.floor((x + r + pad) / HASH_CELL));
    const z0 = Math.max(0, Math.floor((z - r - pad) / HASH_CELL));
    const z1 = Math.min(HASH_DIM - 1, Math.floor((z + r + pad) / HASH_CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const u of this.buckets[cz * HASH_DIM + cx]) {
          if (u.dead) continue;
          const d = Math.hypot(u.x - x, u.z - z) - u.radius;
          if (d <= r) out.push(u);
        }
      }
    }
    return out;
  }

  enemiesInRadius(owner, x, z, r) {
    return this.unitsNear(x, z, r).filter(
      (u) => this.isEnemy(owner, u.owner) && !u.hidden && !u.def.invulnerable && u.targetableBy({ owner }),
    );
  }

  // ------------------------------------------------------------------ combat
  armorReduction(armor) {
    if (armor >= 0) return 1 - (0.06 * armor) / (1 + 0.06 * armor);
    return 2 - Math.pow(0.94, -armor);
  }

  dealDamage(src, t, amount, attackType, opts = {}) {
    if (!t || t.dead || t.def.invulnerable) return 0;
    if (t.invulnerable) return 0;
    if (opts.spell && t.spellImmune) return 0;
    if (opts.spell && t.isBuilding && attackType === 'spell' && !opts.siege) amount *= 0.5;
    let mult = ATTACK_TABLE[attackType]?.[t.def.armorType] ?? 1;
    let dmg = amount * mult;
    if (!opts.spell && !opts.pure) dmg *= this.armorReduction(t.armor);
    if (src?.isIllusion) dmg = 0;
    if (t.isIllusion) dmg *= 2;
    if (t.underConstruction) dmg *= 1.0;
    if (dmg <= 0) return 0;
    t.hp -= dmg;
    t.lastAttackedAt = this.time;
    if (src && !src.dead) t.lastAttacker = src;
    if (src?.owner?.general) src.owner.lastFight = { time: this.time, x: t.x, z: t.z, vs: t.owner };
    if (src && t.owner.general) t.owner.lastFight = { time: this.time, x: t.x, z: t.z, vs: src.owner };

    if (src && src.owner !== t.owner) this.onDamaged(t, src);
    if (t.hp <= 0) this.kill(t, src);
    return dmg;
  }

  onDamaged(t, src) {
    if (!this.isEnemy(t.owner, src.owner)) return;
    // Retaliate.
    if (!t.isBuilding && t.canAttack && !t.def.worker && !t.dead) {
      if (t.guardPos) {
        if (t.order.type !== 'guardReturn') this.aggroCamp(t, src);
      } else if (t.order.type === 'idle' || (t.order.type === 'attack' && t.order.auto && t.order.target?.isBuilding)) {
        t.order = { type: 'attack', target: src, auto: true, anchor: { x: t.x, z: t.z }, leash: 14 };
      } else if ((t.order.type === 'attackMove' || t.order.type === 'patrol') && !t.order.engage) {
        t.order.engage = src;
      }
    }
    // Call for help from idle friends.
    if (this.frame % 3 === 0 && !t.guardPos) {
      for (const f of this.unitsNear(t.x, t.z, 7)) {
        if (f.owner !== t.owner || f === t || f.isBuilding || !f.canAttack || f.def.worker) continue;
        if (f.order.type === 'idle') f.order = { type: 'attack', target: src, auto: true, anchor: { x: f.x, z: f.z }, leash: 12 };
      }
    }
    t.owner.ai?.onAttacked?.(t, src);
    if (t.isBuilding && t.owner.general && src.owner !== this.creeps) {
      t.owner.underAttack = { time: this.time, x: t.x, z: t.z, by: src.owner };
    }
    // Let the player know when another general storms the citadel.
    if (t.owner === this.legion && src.owner.general && !src.owner.isHuman && (t.def.boss || t.type === 'kalenden_keep')) {
      const p = src.owner;
      if (this.time - (p.lastCitadelNotice ?? -999) > 90) {
        p.lastCitadelNotice = this.time;
        this.notify(p, `${p.name}${this.isAlliedToHuman(p) ? ' (your ally)' : ''} is attacking ${t.def.boss ? 'Kalenden himself' : "Kalenden's Keep"}!`);
      }
    }
    if (t.owner.isHuman && this.time - this.lastAlert > 20) {
      this.lastAlert = this.time;
      this.lastAlertPos = { x: t.x, z: t.z };
      const where = t.isBuilding ? 'Your base is under attack!' : t.isHero ? 'Your Hero is under attack!' : 'Your forces are under attack!';
      if (!this.hooks.isOnScreen?.(t.x, t.z)) {
        this.message(where, '#ff6b6b');
        this.sound('warning');
      }
      this.ping(t.x, t.z, '#ff3333');
    }
  }

  rollDamage(u) {
    const [a, b] = u.damageRange;
    return a + Math.random() * (b - a);
  }

  /** A basic attack connects. */
  attackHit(u, t) {
    if (!t || t.dead) return;
    let dmg = this.rollDamage(u);
    let crit = false;
    let stun = 0;
    // Wind Walk backstab
    const ww = u.buffs.get('wind_walk');
    if (ww) {
      dmg += ww.bonusDamage;
      u.removeBuff('wind_walk');
      crit = true;
    }
    if (u.isHero && !u.isIllusion) {
      const cs = u.abilityLevel('critical_strike');
      if (cs > 0 && Math.random() < ABILITIES.critical_strike.chance) {
        dmg *= ABILITIES.critical_strike.mult[cs - 1];
        crit = true;
      }
      const bash = u.abilityLevel('bash');
      if (bash > 0 && Math.random() < ABILITIES.bash.chance[bash - 1] && !t.isBuilding) {
        dmg += 25;
        stun = t.isHero ? 1 : 2;
      }
    }
    if (u.def.bonusVsCavalry && t.def.cavalry) dmg *= u.def.bonusVsCavalry;
    const dealt = this.dealDamage(u, t, dmg, u.def.attackType);
    if (crit && dealt > 0) this.floatText(t.x, t.z, `${Math.round(dealt)}!`, '#ff4040', 1.2);
    if (stun && !t.dead && !t.spellImmune) this.stun(t, stun);
    // Lifesteal (Mask of Death)
    const ls = u.itemStat?.('lifesteal') || 0;
    if (ls > 0 && dealt > 0 && !t.isBuilding) this.heal(u, dealt * ls, u, true);
    // Cleave (Kalenden)
    if (u.def.cleave) {
      for (const e of this.enemiesInRadius(u.owner, t.x, t.z, 2.2)) {
        if (e !== t) this.dealDamage(u, e, dmg * u.def.cleave, u.def.attackType);
      }
    }
    const proj = u.projectile;
    if (!proj) {
      const heavy = u.def.radius >= 0.65 || u.def.boss;
      this.sound(heavy ? 'heavyHit' : 'swordHit', t.x, t.z, 0.45);
    } else if (proj.kind === 'arrow' || proj.kind === 'axe' || proj.kind === 'bullet') {
      this.sound('arrowHit', t.x, t.z, 0.3);
    }
    this.hooks.fx?.hit(t, proj ? proj.color ?? (proj.kind === 'bullet' ? 0xffe28a : 0xffffff) : 0xffeecc);
  }

  splashHit(u, x, z, radius, scale = 1) {
    const dmg = this.rollDamage(u) * scale;
    for (const e of this.enemiesInRadius(u.owner, x, z, radius)) {
      const d = Math.hypot(e.x - x, e.z - z) - e.radius;
      const f = d < radius * 0.4 ? 1 : 0.5;
      this.dealDamage(u, e, dmg * f, u.def.attackType);
    }
    this.hooks.fx?.explosion(x, z, 0.9);
  }

  heal(t, amount, src, quiet = false) {
    if (!t || t.dead) return;
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + amount);
    if (!quiet && t.hp - before >= 50) this.floatText(t.x, t.z, `+${Math.round(t.hp - before)}`, '#7CFC00', 1.0);
  }

  stun(t, dur) {
    if (!t || t.dead || t.isBuilding || t.spellImmune || t.def.boss) return;
    t.addBuff('stun', dur, { stun: true, visual: 'stun' });
  }

  kill(u, killer, opts = {}) {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    u.deathTime = this.time;
    u.anim = 'death';
    u.animTime = 0;
    u.selected = false;
    if (u.channel) u.channel = null;
    if (u.harvest?.inside) u.harvest.inside = false;
    const owner = u.owner;
    if (u.isBuilding) {
      const fp = u.def.footprint;
      this.grid.setRect(u.cell.x, u.cell.z, fp, fp, u.def.gate ? BLOCK_GATE : BLOCK_BUILDING, false);
      if (owner.general && (u.def.tier || u.def.needsRoad)) {
        this.updateTier(owner);
        this.roads.recompute(owner);
      }
      // Refund queued training.
      for (const q of u.trainQueue) this.refund(owner, UNITS[q.type].cost);
      u.trainQueue = [];
      this.hooks.fx?.explosion(u.x, u.z, u.def.footprint * 0.6);
      this.sound('explosion', u.x, u.z, 0.6);
    } else if (!opts.expire) {
      this.sound('death', u.x, u.z, 0.35);
    }
    if (opts.expire || u.isIllusion) this.hooks.fx?.burst(u.x, 0.7, u.z, 0x9fd8ff, 10);

    const kOwner = killer?.owner;
    if (kOwner && kOwner !== owner && !u.isIllusion && !u.summoned) {
      if (kOwner.general) kOwner.stats.kills++;
      if (owner.general) owner.stats.unitsLost++;
      // Bounty
      if (kOwner.general && (owner === this.creeps || owner === this.legion || u.isHero) && u.def.bounty !== null) {
        const [a, b] = u.isHero ? [80 + 20 * u.level, 100 + 20 * u.level] : u.def.bounty ?? [0, 0];
        const g = Math.round((a + Math.random() * (b - a)) * (u.isHero ? 1 : 1.3));
        if (g > 0) {
          kOwner.gold += g;
          if (this.isAlliedToHuman(kOwner) || kOwner.isHuman) this.floatText(u.x, u.z, `+${g}`, '#ffd700', 1.6);
          if (kOwner.isHuman) this.sound('gold', u.x, u.z, 0.5);
        }
        if (owner === this.creeps) kOwner.stats.creepsKilled++;
      }
      this.giveXp(killer, u);
    }
    if (owner.general && !u.isBuilding && !u.isHero && !u.summoned && !u.isIllusion) {
      this.corpses.push({ type: u.type, owner, x: u.x, z: u.z, facing: u.facing, time: this.time });
      if (this.corpses.length > 200) this.corpses.shift();
    }
    if (u.camp) this.creepMgr.onCreepDied(u);
    u.onDeath?.(killer);
    if (u.isHero && owner.general && !u.isIllusion) {
      u.reviveAt = this.time + 12 + 4 * u.level;
      if (owner.isHuman) {
        const altar = owner.buildings.find((b) => b.def.revivesHeroes && !b.dead);
        this.message(
          altar ? `Your Hero has fallen! It will return at the Altar in ${Math.round(u.reviveAt - this.time)} seconds.` : 'Your Hero has fallen!',
          '#ff6b6b',
        );
      } else if (kOwner?.isHuman) {
        this.message(`You have slain ${owner.name}'s ${u.def.name}!`, '#ffd700');
      }
    }
    if (owner.general && !u.isIllusion && kOwner && kOwner !== owner) {
      const by = kOwner?.general ? (kOwner.isHuman ? 'you' : kOwner.name) : kOwner === this.legion ? "Kalenden's Legion" : 'creeps';
      if (u.isHero && !owner.isHuman && !kOwner?.isHuman) this.notify(owner, `${owner.name}'s ${u.def.name} was slain by ${by}.`);
      if (u.isBuilding && (u.def.tier || u.def.revivesHeroes) && !owner.isHuman && !u.underConstruction) {
        this.notify(owner, `${owner.name}'s ${u.def.name} was destroyed by ${by}!`);
      }
    }
    if (u.type === 'kalenden') this.onKalendenSlain(killer);
    if (u.type === 'kalenden_keep') {
      this.message("Kalenden's Keep has fallen! The Legion will march no more.", '#ffd700');
    }
    this.hooks.onUnitChanged?.(u);
  }

  giveXp(killer, victim) {
    if (victim.isIllusion || victim.summoned) return;
    let base;
    if (victim.isHero) base = 100 + 80 * victim.level;
    else if (victim.isBuilding) base = victim.type === 'kalenden_keep' ? 400 : victim.owner.general ? 30 : 0;
    else base = XP_BY_LEVEL[Math.min(15, victim.def.level)] ?? 25;
    if (base <= 0) return;
    const heroes = [];
    for (const p of this.generals) {
      if (!p.hero || p.hero.dead || p.defeated) continue;
      if (p.team !== killer.owner.team) continue; // allied heroes nearby share experience
      if (p.hero.distTo(victim) <= 14) heroes.push(p.hero);
    }
    if (!heroes.length) return;
    const share = base / heroes.length;
    for (const h of heroes) {
      let amt = share;
      if (victim.owner === this.creeps) amt *= 1.5 * ([1, 1, 1, 1, 1, 0.9, 0.8, 0.7, 0.65, 0.6, 0.55][h.level] ?? 0.5);
      this.addXp(h, amt);
    }
  }

  addXp(h, amt) {
    if (h.level >= MAX_HERO_LEVEL) return;
    h.xp += amt;
    while (h.level < MAX_HERO_LEVEL && h.xp >= HERO_XP[h.level + 1]) {
      const hpRatio = h.hp / h.maxHp;
      const mpRatio = h.maxMana ? h.mana / h.maxMana : 1;
      h.level++;
      h.skillPoints++;
      h.hp = h.maxHp * hpRatio;
      h.mana = h.maxMana * mpRatio;
      this.hooks.fx?.levelUp(h);
      if (h.owner.isHuman) {
        this.sound('levelUp', h.x, h.z);
        this.message(`${h.def.name} has reached level ${h.level}!`, '#ffd700');
      } else if (!h.isIllusion && [3, 6, 8, 10].includes(h.level)) {
        this.notify(h.owner, `${h.owner.name}'s ${h.def.name} has reached level ${h.level}.`);
      }
      h.owner.ai?.onLevelUp?.(h);
    }
  }

  // ----------------------------------------------------------- abilities
  startChannel(u, ch) {
    u.channel = { ...ch, elapsed: 0, timer: 0 };
    u.order = { type: 'channel' };
    stopMoving(u);
  }
  endChannel(u) {
    u.channel = null;
    if (u.order.type === 'channel') finishOrder(this, u);
  }
  later(delay, fn) {
    this.timers.push({ at: this.time + delay, fn });
  }

  resurrect(caster, radius, max) {
    let n = 0;
    const fresh = this.corpses.filter(
      (c) => c.owner === caster.owner && this.time - c.time < 90 && Math.hypot(c.x - caster.x, c.z - caster.z) <= radius,
    );
    fresh.sort((a, b) => UNITS[b.type].level - UNITS[a.type].level);
    for (const c of fresh.slice(0, max)) {
      const p = this.grid.nearestWalkable(c.x, c.z, 4);
      if (!p) continue;
      const u = this.spawnUnit(c.type, c.owner, p.x, p.z, { facing: c.facing });
      this.hooks.fx?.holyLight(u);
      this.corpses.splice(this.corpses.indexOf(c), 1);
      n++;
    }
    return n;
  }

  mirrorImage(c, count) {
    // Remove existing illusions of this hero.
    for (const u of c.owner.units) if (u.isIllusion && u.type === c.type && !u.dead) this.kill(u, null, { expire: true });
    const spots = [];
    for (let i = 0; i <= count; i++) {
      const a = (i / (count + 1)) * Math.PI * 2 + Math.random();
      const p = this.grid.nearestWalkable(c.x + Math.cos(a) * 1.6, c.z + Math.sin(a) * 1.6, 4) ?? { x: c.x, z: c.z };
      spots.push(p);
    }
    spots.sort(() => Math.random() - 0.5);
    const realSpot = spots.pop();
    for (const s of spots) {
      const u = this.spawnUnit(c.type, c.owner, s.x, s.z, { illusion: true, lifetime: 60, facing: c.facing });
      u.level = c.level;
      u.tomes = { ...c.tomes };
      u.inventory = c.inventory.map((it) => (it ? { ...it } : null));
      u.skillPoints = 0;
      for (const k in u.abilityLevels) u.abilityLevels[k] = 0;
      u.hp = u.maxHp * (c.hp / c.maxHp);
      u.mana = 0;
      this.hooks.fx?.burst(s.x, 0.7, s.z, 0x9ab8ff, 10);
      if (c.order.type === 'attack') this.issueOrder(u, { type: 'attack', target: c.order.target });
    }
    c.x = realSpot.x;
    c.z = realSpot.z;
    stopMoving(c);
    this.hooks.fx?.burst(c.x, 0.7, c.z, 0x9ab8ff, 10);
  }

  learnAbility(h, abilityId) {
    if (!h.isHero || h.skillPoints <= 0) return false;
    const ab = ABILITIES[abilityId];
    const cur = h.abilityLevels[abilityId] ?? 0;
    if (cur >= ab.levels) return false;
    const req = ab.ultimate ? 6 : [1, 3, 5][cur];
    if (h.level < req) return false;
    h.abilityLevels[abilityId] = cur + 1;
    h.skillPoints--;
    return true;
  }

  // ----------------------------------------------------------- economy
  canAfford(p, cost) {
    return p.gold >= (cost.gold || 0) && p.lumber >= (cost.lumber || 0);
  }
  spend(p, cost) {
    if (!this.canAfford(p, cost)) {
      if (p.isHuman) {
        this.message(p.gold < (cost.gold || 0) ? 'Not enough gold.' : 'Not enough lumber.', '#ff8080');
        this.sound('error');
      }
      return false;
    }
    p.gold -= cost.gold || 0;
    p.lumber -= cost.lumber || 0;
    return true;
  }
  refund(p, cost) {
    p.gold += cost.gold || 0;
    p.lumber += cost.lumber || 0;
  }

  hasRequirement(p, req) {
    const age = /^age(\d)$/.exec(req);
    if (age) return p.tier >= Number(age[1]);
    return p.buildings.some((b) => !b.dead && !b.underConstruction && (b.type === req || (req === 'scouttower' && b.type === 'guardtower')));
  }
  requirementName(req) {
    const m = /^age(\d)$/.exec(req);
    if (m) return AGE_NAMES[Number(m[1])];
    return UNITS[req]?.name ?? req;
  }
  missingRequirements(p, def) {
    return (def.requires || []).filter((r) => !this.hasRequirement(p, r));
  }

  /** Ages are researched at the town center and never lost; hero generals stay at 0. */
  updateTier(p) {
    if (p.mode === 'empire') p.tier = Math.max(p.tier, 1);
  }

  /** Supply (army food) and housing for citizens. Houses only count while connected by road. */
  computeFood(p) {
    let cap = 0;
    let used = 0;
    let housing = 0;
    for (const b of p.buildings) {
      if (b.dead) continue;
      if (!b.underConstruction) {
        if (b.def.foodProvided) cap += b.def.foodProvided;
        if (b.def.housing) housing += b.def.housing;
        if (b.def.housingByAge && b.roadConnected) {
          const h = b.def.housingByAge[b.ageLevel - 1];
          cap += h;
          housing += h;
        }
      }
      for (const q of b.trainQueue) used += UNITS[q.type].food;
    }
    for (const u of p.units) {
      if (u.dead || u.summoned || u.isIllusion) continue;
      used += u.def.food;
    }
    for (const r of p.pendingRevives ?? []) used += r;
    p.foodCap = Math.min(p.mode === 'empire' ? 200 : 100, cap);
    p.foodUsed = used;
    p.housing = housing;
  }

  /**
   * Can `type` be placed centered at (x, z)? Sets this.placeReason when not.
   * Houses must touch one of the owner's roads; gates may replace the owner's walls.
   */
  canPlace(type, x, z, p = null) {
    const def = UNITS[type];
    const fp = def.footprint;
    const cx = Math.round(x - fp / 2);
    const cz = Math.round(z - fp / 2);
    this.placeReason = "Can't build there";
    if (def.gate && p) {
      for (let zz = cz; zz < cz + fp; zz++) {
        for (let xx = cx; xx < cx + fp; xx++) {
          if (this.grid.rectFree(xx, zz, 1, 1)) continue;
          const w = this.wallAt(xx, zz);
          if (!w || w.owner !== p) return false;
        }
      }
    } else if (!this.grid.rectFree(cx, cz, fp, fp)) return false;
    for (let zz = cz; zz < cz + fp; zz++) {
      for (let xx = cx; xx < cx + fp; xx++) {
        if (this.roads.isRoad(xx, zz) && !def.gate) {
          this.placeReason = "Can't build on a road";
          return false;
        }
      }
    }
    if (p?.isHuman && !p.ai) {
      for (let zz = cz; zz < cz + fp; zz++) for (let xx = cx; xx < cx + fp; xx++) if (!this.fog.isExplored(xx + 0.5, zz + 0.5)) return false;
    }
    if (def.needsRoad && p && !this.roads.touchesRoad(cx, cz, fp, p)) {
      this.placeReason = 'Must be built next to one of your roads';
      return false;
    }
    // Keep town halls a little away from gold mines, everything off the mine itself.
    for (const m of this.units) {
      if (m.type !== 'goldmine' || m.dead) continue;
      const d = Math.max(Math.abs(m.x - (cx + fp / 2)), Math.abs(m.z - (cz + fp / 2)));
      if (d < m.radius + fp / 2 + (def.dropOff ? 2.5 : 0.5)) return false;
    }
    return true;
  }

  /** The wall piece occupying a cell, if any. */
  wallAt(cx, cz) {
    for (const u of this.unitsNear(cx + 0.5, cz + 0.5, 0.2)) {
      if (u.def.wall && !u.dead && u.cell.x === cx && u.cell.z === cz) return u;
    }
    return null;
  }

  placeBuilding(builder, type, x, z) {
    const def = UNITS[type];
    const fp = def.footprint;
    const sx = this.snap(x, fp);
    const sz = this.snap(z, fp);
    if (!this.canPlace(type, sx, sz, builder.owner)) return null;
    if (def.gate) {
      // A gate replaces the builder's own wall pieces under it.
      const cx = Math.round(sx - fp / 2);
      const cz = Math.round(sz - fp / 2);
      for (let zz = cz; zz < cz + fp; zz++) {
        for (let xx = cx; xx < cx + fp; xx++) {
          const w = this.wallAt(xx, zz);
          if (w && w.owner === builder.owner) {
            this.grid.setRect(w.cell.x, w.cell.z, 1, 1, BLOCK_BUILDING, false);
            w.dead = true;
            w.deathTime = this.time - 10;
            this.removeUnit(w);
          }
        }
      }
    }
    const b = this.spawnUnit(type, builder.owner, sx, sz, { construction: true, facing: Math.PI });
    // Shove units out of the footprint.
    for (const u of this.unitsNear(sx, sz, fp * 0.75)) {
      if (u.isBuilding || u.dead) continue;
      if (Math.abs(u.x - sx) < fp / 2 + u.radius && Math.abs(u.z - sz) < fp / 2 + u.radius) {
        const p = this.grid.nearestWalkable(u.x, u.z, fp + 3);
        if (p) {
          u.x = p.x;
          u.z = p.z;
        }
      }
    }
    if (builder.owner.isHuman) this.sound('build', sx, sz);
    return b;
  }

  progressConstruction(b, dt) {
    if (b.buildFrame !== this.frame) {
      b.buildFrame = this.frame;
      b.buildersThisFrame = 0;
    }
    const f = b.buildersThisFrame === 0 ? 1 : 0.6;
    b.buildersThisFrame++;
    const speed = b.owner.isHuman ? 1 : [0.85, 1, 1.15][this.difficulty];
    const dp = (dt * f * speed) / b.def.buildTime;
    b.buildProgress = Math.min(1, b.buildProgress + dp);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dp);
    if (b.buildProgress >= 1) this.finishConstruction(b);
  }

  finishConstruction(b) {
    b.underConstruction = false;
    b.buildProgress = 1;
    this.updateTier(b.owner);
    if (b.def.tier || b.def.needsRoad) this.roads.recompute(b.owner);
    if (b.def.needsRoad && !b.roadConnected && b.owner.isHuman) {
      this.message('This house is not connected to your town center by road, so nobody can move in.', '#ffb070');
    }
    this.hooks.onUnitChanged?.(b);
    if (b.owner.isHuman) {
      this.sound('buildComplete', b.x, b.z);
      this.message(`${b.def.name} construction complete.`, '#9fe89f');
    }
    b.owner.ai?.onBuilt?.(b);
  }

  trainUnit(b, type) {
    const p = b.owner;
    const def = UNITS[type];
    if (b.underConstruction || b.dead) return false;
    if (b.trainQueue.length >= 5) {
      if (p.isHuman) this.message('The training queue is full.', '#ff8080');
      return false;
    }
    const missing = this.missingRequirements(p, def);
    if (missing.length) {
      if (p.isHuman) this.message(`Requires: ${missing.map((m) => this.requirementName(m)).join(', ')}.`, '#ff8080');
      return false;
    }
    this.computeFood(p);
    if (p.foodUsed + def.food > p.foodCap) {
      if (p.isHuman) {
        this.message(p.foodCap >= (p.mode === 'empire' ? 200 : 100) ? 'Army limit reached.' : p.mode === 'empire' ? 'Not enough housing. Build more Houses along your roads.' : 'Not enough food.', '#ff8080');
        this.sound('error');
      }
      return false;
    }
    if (!this.spend(p, def.cost)) return false;
    b.trainQueue.push({ type, time: 0, total: def.buildTime * (p.isHuman ? 1 : [1.15, 1, 0.9][this.difficulty]) });
    return true;
  }

  cancelTrain(b, index) {
    const q = b.trainQueue[index];
    if (!q) return;
    b.trainQueue.splice(index, 1);
    this.refund(b.owner, UNITS[q.type].cost);
  }

  spawnPointNear(b, toward) {
    let dx = 0;
    let dz = 1;
    if (toward) {
      dx = toward.x - b.x;
      dz = toward.z - b.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    } else if (b.owner.base) {
      [dx, dz] = b.owner.base.toCenter;
    }
    return (
      this.grid.nearestWalkable(b.x + dx * (b.radius + 0.9), b.z + dz * (b.radius + 0.9), 8) ?? { x: b.x, z: b.z + b.radius + 1 }
    );
  }

  finishTraining(b, type) {
    const p = b.owner;
    const sp = this.spawnPointNear(b, b.rally);
    const u = this.spawnUnit(type, p, sp.x, sp.z, { facing: Math.atan2(sp.x - b.x, sp.z - b.z) });
    p.stats.unitsTrained++;
    if (b.rally) {
      if (b.rally.target && u.def.worker && (b.rally.target.type === 'goldmine' || b.rally.target.lumber !== undefined)) {
        this.issueOrder(u, { type: 'harvest', target: b.rally.target });
      } else if (b.rally.target && !b.rally.target.dead && b.rally.target.isBuilding === false) {
        this.issueOrder(u, { type: 'follow', target: b.rally.target });
      } else {
        this.issueOrder(u, { type: 'move', point: { x: b.rally.x, z: b.rally.z } });
      }
    }
    if (p.isHuman) this.sound('unitReady', b.x, b.z, 0.6);
    p.ai?.onTrained?.(u);
    return u;
  }

  startUpgrade(b) {
    const p = b.owner;
    const to = b.def.upgradesTo;
    if (!to || b.upgrading || b.underConstruction || b.trainQueue.length) return false;
    const def = UNITS[to];
    const missing = this.missingRequirements(p, def);
    if (missing.length) {
      if (p.isHuman) this.message(`Requires: ${missing.map((m) => this.requirementName(m)).join(', ')}.`, '#ff8080');
      return false;
    }
    if (!this.spend(p, def.cost)) return false;
    b.upgrading = { to, time: 0, total: def.buildTime };
    return true;
  }

  cancelUpgrade(b) {
    if (!b.upgrading) return;
    this.refund(b.owner, b.upgrading.age ? AGES[b.upgrading.age].cost : UNITS[b.upgrading.to].cost);
    b.upgrading = null;
  }

  finishUpgrade(b) {
    if (b.upgrading.age) {
      const p = b.owner;
      p.tier = Math.max(p.tier, b.upgrading.age);
      b.upgrading = null;
      this.onAgeAdvanced(p);
      return;
    }
    const to = b.upgrading.to;
    b.upgrading = null;
    const ratio = b.hp / b.maxHp;
    const p = b.owner;
    const before = p.tier;
    b.def = UNITS[to];
    b.type = to;
    b.hp = b.maxHp * ratio;
    this.updateTier(p);
    this.hooks.onUnitChanged?.(b, true);
    if (p.tier > before) this.onAgeAdvanced(p);
    else if (p.isHuman) {
      this.sound('buildComplete', b.x, b.z);
      this.message(`Upgrade complete: ${b.def.name}.`, '#9fe89f');
    }
  }

  /** A general reached a new age: houses, walls and gates rebuild in the new style. */
  onAgeAdvanced(p) {
    const age = AGE_NAMES[p.tier];
    if (p.isHuman) {
      this.sound('levelUp');
      this.message(`Your empire has advanced to the ${age}! New units are available, and your town is being rebuilt in the style of the new age.`, '#ffe680');
    } else {
      this.notify(p, `${p.name} has advanced to the ${age}.`);
    }
    for (const b of p.buildings) {
      if (b.dead || !b.def.ageModels || b.ageLevel >= p.tier) continue;
      this.later(0.5 + Math.random() * 5, () => this.upgradeStructureAge(b, p.tier));
    }
    this.roads.dirty = true;
    p.ai?.onAgeAdvanced?.();
    this.hooks.onAgeAdvanced?.(p);
  }

  upgradeStructureAge(b, tier) {
    if (b.dead || b.ageLevel >= tier) return;
    const ratio = b.hp / b.maxHp;
    b.ageLevel = tier;
    b.hp = b.maxHp * ratio;
    this.hooks.onUnitChanged?.(b, true);
    this.hooks.fx?.burst(b.x, 0.8, b.z, 0xd8c8a0, 10, 2.5, 0.07, 0.6);
    this.computeFood(b.owner);
  }

  startResearch(b, upg) {
    const p = b.owner;
    const U = UPGRADES[upg];
    const lvl = p.upgrades[upg];
    if (b.researching || b.underConstruction || lvl >= (U.levels ?? 3)) return false;
    if (p.researchingUpg?.[upg]) return false;
    if (p.tier < U.tier[lvl]) {
      if (p.isHuman) this.message(`Requires the ${AGE_NAMES[U.tier[lvl]]}.`, '#ff8080');
      return false;
    }
    if (!this.spend(p, U.cost[lvl])) return false;
    b.researching = { upg, time: 0, total: U.time[lvl] };
    (p.researchingUpg ||= {})[upg] = true;
    return true;
  }

  cancelResearch(b) {
    if (!b.researching) return;
    const p = b.owner;
    const { upg } = b.researching;
    this.refund(p, UPGRADES[upg].cost[p.upgrades[upg]]);
    p.researchingUpg[upg] = false;
    b.researching = null;
  }

  finishResearch(b) {
    const p = b.owner;
    const { upg } = b.researching;
    b.researching = null;
    p.upgrades[upg]++;
    p.researchingUpg[upg] = false;
    if (p.isHuman) {
      this.sound('buildComplete', b.x, b.z);
      this.message(`Research complete: ${UPGRADES[upg].name[p.upgrades[upg] - 1]}.`, '#9fe89f');
    }
  }

  collapseMine(mine) {
    if (mine.dead) return;
    this.message('A gold mine has collapsed!', '#ffd700');
    this.kill(mine, null);
  }

  // ------------------------------------------------------------- items
  heroOf(p) {
    return p.hero && !p.hero.dead ? p.hero : null;
  }

  shopCustomer(p, shop) {
    const h = this.heroOf(p);
    if (h && h.distTo(shop) <= shop.radius + 7) return h;
    return null;
  }

  buyItem(p, shop, itemId) {
    const item = ITEMS[itemId];
    const h = this.shopCustomer(p, shop);
    if (!h) {
      if (p.isHuman) {
        this.message(this.heroOf(p) ? 'Your Hero must be near the shop to buy items.' : 'Only a living Hero can buy items.', '#ff8080');
        this.sound('error');
      }
      return false;
    }
    // Stack consumables of the same kind.
    let slot = h.inventory.findIndex((s) => s && s.id === itemId && item.use && item.charges);
    if (slot < 0) slot = h.inventory.findIndex((s) => s === null);
    if (slot < 0) {
      if (p.isHuman) {
        this.message('Inventory is full.', '#ff8080');
        this.sound('error');
      }
      return false;
    }
    if (!this.spend(p, { gold: item.cost })) return false;
    if (h.inventory[slot]) h.inventory[slot].charges += item.charges;
    else h.inventory[slot] = { id: itemId, charges: item.charges ?? 0 };
    if (p.isHuman) this.sound('buy', shop.x, shop.z);
    if (item.stats?.hp) h.hp += item.stats.hp;
    return true;
  }

  sellItem(h, slot) {
    const it = h.inventory[slot];
    if (!it) return;
    const shop = this.units.find((s) => s.def.shop && !s.dead && h.distTo(s) < s.radius + 7);
    if (!shop) {
      if (h.owner.isHuman) this.message('Your Hero must be near a shop to sell items.', '#ff8080');
      return;
    }
    const def = ITEMS[it.id];
    const value = Math.round(((def.cost ?? 100) * 0.5 * (def.use ? Math.max(1, it.charges) / (def.charges || 1) : 1)));
    h.owner.gold += value;
    h.inventory[slot] = null;
    h.hp = Math.min(h.hp, h.maxHp);
    if (h.owner.isHuman) {
      this.sound('buy', h.x, h.z);
      this.floatText(h.x, h.z, `+${value}`, '#ffd700', 1.4);
    }
  }

  hireMerc(p, camp, type) {
    const def = UNITS[type];
    const near = p.units.find((u) => !u.dead && u.distTo(camp) <= camp.radius + 7);
    if (!near) {
      if (p.isHuman) {
        this.message('You need a unit near the Mercenary Camp to hire.', '#ff8080');
        this.sound('error');
      }
      return false;
    }
    if ((camp.stock[type] ?? 0) < 1) {
      if (p.isHuman) this.message('No mercenaries of that kind are available yet.', '#ff8080');
      return false;
    }
    this.computeFood(p);
    if (p.foodUsed + def.food > p.foodCap) {
      if (p.isHuman) {
        this.message('Not enough food.', '#ff8080');
        this.sound('error');
      }
      return false;
    }
    if (!this.spend(p, def.cost)) return false;
    camp.stock[type]--;
    const sp = this.spawnPointNear(camp, near);
    const u = this.spawnUnit(type, p, sp.x, sp.z, { facing: Math.atan2(near.x - sp.x, near.z - sp.z) });
    if (p.hero && !p.hero.dead) this.issueOrder(u, { type: 'follow', target: p.hero });
    if (p.isHuman) this.sound('unitReady', camp.x, camp.z);
    return u;
  }

  dropItem(x, z, itemId) {
    const it = { id: itemId, x, z, taken: false, spawnTime: this.time };
    this.groundItems.push(it);
    this.hooks.onItemDropped?.(it);
    return it;
  }

  pickupItem(h, it) {
    if (!h.isHero || h.isIllusion || it.taken) return false;
    const def = ITEMS[it.id];
    if (def.autoUse) {
      it.taken = true;
      this.applyItemEffect(h, def);
      this.hooks.onItemTaken?.(it);
      return true;
    }
    let slot = h.inventory.findIndex((s) => s && s.id === it.id && def.use && def.charges);
    if (slot < 0) slot = h.inventory.findIndex((s) => s === null);
    if (slot < 0) {
      if (h.owner.isHuman) this.message('Inventory is full.', '#ff8080');
      return false;
    }
    it.taken = true;
    if (h.inventory[slot]) h.inventory[slot].charges += def.charges;
    else h.inventory[slot] = { id: it.id, charges: def.charges ?? 0 };
    if (def.stats?.hp) h.hp += def.stats.hp;
    this.hooks.onItemTaken?.(it);
    if (h.owner.isHuman) this.message(`Picked up ${def.name}.`, '#ffd700');
    return true;
  }

  useItem(h, slot) {
    const it = h.inventory[slot];
    if (!it || h.dead) return false;
    const def = ITEMS[it.id];
    if (!def.use) return false;
    if (def.use === 'heal' && h.hp >= h.maxHp) {
      if (h.owner.isHuman) this.message('Already at full health.', '#ccc');
      return false;
    }
    if (def.use === 'mana' && h.mana >= h.maxMana) {
      if (h.owner.isHuman) this.message('Already at full mana.', '#ccc');
      return false;
    }
    if (h.itemCooldown > this.time) return false;
    h.itemCooldown = this.time + 0.5;
    this.applyItemEffect(h, def);
    it.charges--;
    if (it.charges <= 0) h.inventory[slot] = null;
    return true;
  }

  applyItemEffect(h, def) {
    switch (def.use) {
      case 'heal':
        this.heal(h, def.amount, h);
        this.hooks.fx?.burst(h.x, 0.8, h.z, 0x7cfc00, 12);
        this.sound('heal', h.x, h.z, 0.6);
        break;
      case 'mana':
        h.mana = Math.min(h.maxMana, h.mana + def.amount);
        this.hooks.fx?.burst(h.x, 0.8, h.z, 0x6fa8ff, 12);
        this.sound('magicCast', h.x, h.z, 0.6);
        break;
      case 'xp':
        this.addXp(h, def.amount);
        this.hooks.fx?.burst(h.x, 0.8, h.z, 0xffd700, 12);
        break;
      case 'str':
      case 'agi':
      case 'int': {
        const hpRatio = h.hp / h.maxHp;
        h.tomes[def.use] += def.amount;
        h.hp = h.maxHp * hpRatio;
        this.hooks.fx?.burst(h.x, 0.8, h.z, 0xffd700, 12);
        if (h.owner.isHuman) this.message(`${def.name}: +${def.amount} ${def.use.toUpperCase()}.`, '#ffd700');
        break;
      }
      case 'areaHeal':
        for (const u of this.unitsNear(h.x, h.z, 6)) if (u.owner === h.owner && !u.isBuilding) this.heal(u, def.amount, h);
        this.hooks.fx?.ring(h.x, h.z, 0x7cfc00, 6, 0.7);
        this.sound('heal', h.x, h.z);
        break;
      case 'gold':
        h.owner.gold += def.amount;
        if (h.owner.isHuman) this.floatText(h.x, h.z, `+${def.amount}`, '#ffd700', 1.6);
        this.sound('gold', h.x, h.z);
        break;
      case 'townPortal':
        this.townPortal(h);
        break;
      default:
    }
  }

  homeOf(p) {
    const ok = (x) => !x.dead && !x.underConstruction;
    const b = p.buildings.find((x) => ok(x) && (x.def.dropOff === true || x.def.revivesHeroes)) ?? p.buildings.find((x) => ok(x) && x.def.dropOff);
    return b || null;
  }

  townPortal(h) {
    const home = this.homeOf(h.owner);
    if (!home) {
      if (h.owner.isHuman) this.message('You have no base to return to.', '#ff8080');
      return;
    }
    this.hooks.fx?.ring(h.x, h.z, 0x9ab8ff, 5, 2.0);
    this.sound('teleport', h.x, h.z);
    const group = this.unitsNear(h.x, h.z, 5).filter((u) => u.owner === h.owner && !u.isBuilding);
    this.later(2.0, () => {
      if (h.dead) return;
      for (const u of group) {
        if (u.dead) continue;
        const p = this.spawnPointNear(home, null);
        const q = this.grid.nearestWalkable(p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, 6) ?? p;
        u.x = q.x;
        u.z = q.z;
        this.issueOrder(u, { type: 'idle' });
        this.hooks.fx?.burst(u.x, 0.8, u.z, 0x9ab8ff, 8);
      }
      this.sound('teleport', home.x, home.z);
      if (h.owner.isHuman) this.hooks.centerOn?.(h.x, h.z);
    });
  }

  reviveHero(p) {
    const h = p.hero;
    const altar = p.buildings.find((b) => b.def.revivesHeroes && !b.dead && !b.underConstruction);
    if (!h || !h.dead || !altar) return;
    const sp = this.spawnPointNear(altar, null);
    h.dead = false;
    h.removed = false;
    h.x = sp.x;
    h.z = sp.z;
    h.hp = h.maxHp;
    h.mana = h.maxMana;
    h.buffs.clear();
    h.recomputeMods();
    h.order = { type: 'idle' };
    h.orderQueue = [];
    h.anim = 'stand';
    h.reviveAt = null;
    stopMoving(h);
    p.units.push(h);
    this.units.push(h);
    this.unitById.set(h.id, h);
    this.hooks.onUnitAdded?.(h);
    this.hooks.fx?.holyLight(h);
    if (p.isHuman) {
      this.message(`${h.def.name} has been revived!`, '#9fe89f');
      this.sound('levelUp', h.x, h.z);
    }
    p.ai?.onHeroRevived?.(h);
  }

  aggroCamp(creep, target) {
    if (creep.camp) this.creepMgr.aggro(creep.camp, target);
    else if (creep.guardPos) {
      creep.order = { type: 'attack', target, auto: true, anchor: creep.guardPos, leash: creep.guardPos.leash ?? 12 };
    }
  }

  onKalendenSlain(killer) {
    const p = killer?.owner?.general ? killer.owner : null;
    this.kalendenSlainBy = p;
    this.sound('roar');
    if (p?.isHuman) {
      this.endGame(true, 'You have slain Kalenden and claimed his lands as your own!');
    } else if (!p || p.team === this.human.team) {
      this.endGame(true, p ? `Your ally ${p.name} has slain Kalenden. Together you claim his lands!` : 'Kalenden has been slain! The land is yours to divide.');
    } else {
      this.endGame(false, `${p.name} has slain Kalenden and claimed the land. Your campaign has failed.`);
    }
  }

  endGame(victory, text) {
    if (this.over) return;
    this.over = { victory, text, time: this.time };
    this.sound(victory ? 'victory' : 'defeat');
    this.hooks.onGameOver?.(this.over);
  }

  checkDefeats() {
    for (const p of this.generals) {
      if (p.defeated) continue;
      const hasBuilding = p.buildings.some((b) => !b.dead && !b.def.wall && !b.def.gate); // fortifications alone don't count
      const heroAlive = p.hero && !p.hero.dead;
      const anyUnit = p.units.some((u) => !u.dead && !u.isIllusion && !u.summoned);
      let out = false;
      if (p.mode === 'hero') out = !hasBuilding && !heroAlive;
      else {
        out = !hasBuilding && !anyUnit;
        // An empire falls 20 seconds after losing its last town center unless it starts another.
        const hall = p.buildings.some((b) => !b.dead && b.def.tier);
        if (hall) p.hallLostAt = null;
        else {
          if (p.hallLostAt == null) {
            p.hallLostAt = this.time;
            if (p.isHuman) {
              this.message('Your last town center has fallen! Start building a new one within 20 seconds or your empire will collapse.', '#ff5a5a');
              this.sound('warning');
            } else this.notify(p, `${p.name} has lost their last town center!`);
          }
          if (this.time - p.hallLostAt >= 20) out = true;
        }
      }
      if (out) {
        p.defeated = true;
        if (p.hiredBy) this.empires.endContract(p);
        for (const u of [...p.units]) if (!u.dead) this.kill(u, null);
        if (p.mode === 'empire') for (const b of [...p.buildings]) if (!b.dead) this.kill(b, null);
        if (p.isHuman) this.endGame(false, p.mode === 'empire' ? 'Your empire has collapsed. Kalenden’s land will never be yours.' : 'Your forces have been destroyed. Kalenden’s land will never be yours.');
        else this.message(`${p.name} has been defeated!`, this.isAlliedToHuman(p) ? '#ff8a7a' : '#ffd700');
      }
    }
    const home = (p) => p.homeTeam ?? p.team;
    const enemies = this.generals.filter((p) => home(p) !== home(this.human));
    if (!this.over && enemies.length && enemies.every((p) => p.defeated) && !this.human.defeated) {
      this.endGame(true, 'All rival generals have fallen. The land of Kalenden bows before you!');
    }
  }

  /** Change a general's team (Heroes hired by an empire fight on its side). */
  setTeam(p, team) {
    if (p.team === team) return;
    p.team = team;
    for (const b of p.buildings) {
      if (b.dead || !b.def.gate) continue;
      const fp = b.def.footprint;
      for (let zz = b.cell.z; zz < b.cell.z + fp; zz++) {
        for (let xx = b.cell.x; xx < b.cell.x + fp; xx++) if (this.grid.inBounds(xx, zz)) this.grid.gateTeam[zz * MAP_SIZE + xx] = team;
      }
    }
    // Nobody keeps fighting a new friend.
    for (const u of this.units) {
      if (u.dead) continue;
      const t = u.order.target;
      if (t?.owner && (t.owner === p || u.owner === p) && !this.isEnemy(u.owner, t.owner) && (u.order.type === 'attack')) {
        u.order = { type: 'idle' };
        u.path = null;
      }
      if (u.windupTarget?.owner && !this.isEnemy(u.owner, u.windupTarget.owner)) u.windupTarget = null;
    }
    this.hooks.onTeamsChanged?.();
  }

  // ------------------------------------------------------------- feedback
  message(text, color = '#fff') {
    this.messages.push({ text, color, time: performance.now() });
    if (this.messages.length > 8) this.messages.shift();
  }
  floatText(x, z, text, color = '#fff', size = 1) {
    if (!this.fog.isVisible(x, z)) return;
    this.floats.push({ x, z, y: this.terrain.heightAt(x, z) + 2.2, text, color, size, t: 0 });
  }
  ping(x, z, color = '#ff3333') {
    this.pings.push({ x, z, color, t: 0 });
  }
  sound(name, x, z, vol = 1) {
    if (x !== undefined && !this.fog.isVisible(x, z)) return;
    this.hooks.sound?.(name, vol, x, z);
  }
  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  // --------------------------------------------------------------- update
  update(dt) {
    if (this.over && this.time - this.over.time > 4) {
      // Keep the world animating behind the end screen, but slowly.
      dt *= 0.25;
    }
    this.time += dt;
    this.frame++;
    this.pathBudget = 28;
    this.pathNodes = 90000; // A* node expansions allowed per frame
    this.rebuildHash();

    // Timers
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const t of due) t.fn();
      }
    }

    const list = this.units;
    for (let i = 0; i < list.length; i++) updateUnit(this, list[i], dt);

    this.separate(dt);
    this.grid.passTeam = -99;
    this.hooks.projectiles?.update(dt);

    // Remove dead units after their death animation.
    for (const u of list) {
      if (u.dead && !u.removed && this.time - u.deathTime > (u.isBuilding ? 2.5 : u.isHero ? 2 : 4)) this.removeUnit(u);
    }
    if (this.frame % 30 === 0) this.units = list.filter((u) => !u.removed);

    // Periodic systems
    this.auraTimer = (this.auraTimer || 0) - dt;
    if (this.auraTimer <= 0) {
      this.auraTimer = 0.5;
      this.applyAuras();
      this.fountains();
    }
    this.slowTimer = (this.slowTimer || 0) - dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.25;
      for (const p of this.generals) this.computeFood(p);
      this.heroUpkeep();
      this.itemPickups();
    }
    this.creepMgr.update(dt);
    this.legionMgr.update(dt);
    this.empires.update(dt);
    this.events.update(dt);
    for (const p of this.generals) if (p.ai && !p.defeated) p.ai.update(dt);
    this.fog.update();

    this.defeatTimer = (this.defeatTimer || 0) - dt;
    if (this.defeatTimer <= 0) {
      this.defeatTimer = 1;
      if (!this.over) this.checkDefeats();
      this.corpses = this.corpses.filter((c) => this.time - c.time < 90);
    }
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < 1.6);
    for (const pg of this.pings) pg.t += dt;
    this.pings = this.pings.filter((pg) => pg.t < 3);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.5);
  }

  heroUpkeep() {
    for (const p of this.generals) {
      if (p.defeated) continue;
      // Hero-path generals receive tribute from their followers.
      if (p.mode === 'hero') {
        p.incomeAcc += 0.25 * 2.5;
        if (p.incomeAcc >= 1) {
          const g = Math.floor(p.incomeAcc);
          p.gold += g;
          p.incomeAcc -= g;
        }
      }
      const h = p.hero;
      if (h && h.dead && h.reviveAt && this.time >= h.reviveAt) this.reviveHero(p);
    }
    // Mercenary stock
    for (const u of this.passive.buildings) {
      if (!u.stock) continue;
      u.stockTimer += 0.25;
      if (u.stockTimer >= 45) {
        u.stockTimer = 0;
        for (const k in u.stock) u.stock[k] = Math.min(2, u.stock[k] + 1);
      }
    }
  }

  itemPickups() {
    if (!this.groundItems.length) return;
    for (const it of this.groundItems) {
      if (it.taken) continue;
      for (const u of this.unitsNear(it.x, it.z, 0.6)) {
        if (u.isHero && !u.isIllusion && u.owner.general && this.pickupItem(u, it)) break;
      }
    }
    this.groundItems = this.groundItems.filter((i) => !i.taken);
  }

  applyAuras() {
    for (const u of this.units) {
      if (u.dead || !u.isHero || u.isIllusion) continue;
      for (const id of u.heroDef.abilities) {
        const ab = ABILITIES[id];
        if (ab.target !== 'aura') continue;
        const lvl = u.abilityLevel(id);
        if (lvl <= 0) continue;
        const mods = ab.aura(lvl);
        for (const t of this.unitsNear(u.x, u.z, ab.radius)) {
          if (t.isBuilding || !this.isAlly(u.owner, t.owner)) continue;
          t.addBuff(`aura_${id}`, 1.0, { ...mods, replace: true, aura: true });
        }
      }
    }
  }

  fountains() {
    for (const f of this.passive.buildings) {
      if (f.type !== 'fountain') continue;
      for (const u of this.unitsNear(f.x, f.z, 5)) {
        if (u.isBuilding || u.dead || !u.owner.general) continue;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02 * 0.5 + 1);
        if (u.maxMana) u.mana = Math.min(u.maxMana, u.mana + 1.5);
      }
    }
    // Altars of Heroes are sanctuaries for their owner's units.
    for (const p of this.generals) {
      for (const b of p.buildings) {
        if (!b.def.sanctuary || b.dead || b.underConstruction) continue;
        for (const u of this.unitsNear(b.x, b.z, 6)) {
          if (u.isBuilding || u.dead || u.owner !== p) continue;
          u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.015 * 0.5);
          if (u.maxMana) u.mana = Math.min(u.maxMana, u.mana + 0.75);
        }
      }
    }
  }

  /** Push overlapping ground units apart. */
  separate(dt) {
    const grid = this.grid;
    for (const u of this.units) {
      if (u.dead || u.isBuilding || u.hidden) continue;
      const near = this.unitsNear(u.x, u.z, u.radius + 0.1);
      for (const o of near) {
        if (o === u || o.isBuilding || o.dead || o.hidden || o.id < u.id) continue;
        const dx = o.x - u.x;
        const dz = o.z - u.z;
        const d = Math.hypot(dx, dz);
        const min = (u.radius + o.radius) * 0.9;
        if (d >= min) continue;
        const overlap = min - d;
        let nx;
        let nz;
        if (d < 1e-4) {
          const a = Math.random() * Math.PI * 2;
          nx = Math.cos(a);
          nz = Math.sin(a);
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        // Moving units shove stationary ones; attackers in place resist.
        const wu = this.pushWeight(u);
        const wo = this.pushWeight(o);
        const total = wu + wo || 1;
        const push = Math.min(overlap, 3 * dt + overlap * 0.5);
        const pu = (push * wu) / total;
        const po = (push * wo) / total;
        const ux = u.x - nx * pu;
        const uz = u.z - nz * pu;
        grid.passTeam = u.owner.team ?? -99;
        if (grid.walkableAt(ux, uz)) {
          u.x = ux;
          u.z = uz;
        }
        const ox = o.x + nx * po;
        const oz = o.z + nz * po;
        grid.passTeam = o.owner.team ?? -99;
        if (grid.walkableAt(ox, oz)) {
          o.x = ox;
          o.z = oz;
        }
      }
    }
  }

  pushWeight(u) {
    if (u.moving) return 0.35;
    if (u.windup > 0 || u.anim === 'attack' || u.order.type === 'construct' || u.harvest?.phase === 'chop') return 0.25;
    if (u.def.boss) return 0.05;
    return 1;
  }
}
