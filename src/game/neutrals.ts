// The map's neutral wonders: waygates that carry units across the land, shrines that bless an
// army, runes and tomes in out-of-the-way places, the Marketplaces' changing stock, the treasure
// chests of the boss lairs and the bandits' cages of captives. Engine-free.
import { ITEMS, itemPrice } from '../data/items.ts';
import { CENTER } from '../world/layout.ts';
import { stopMoving, finishOrder } from './behavior.ts';
import type { Game } from './game.ts';
import type { Unit } from './unit.ts';
import type { CampState, GroundItem, Order, Point, Ware } from './types.ts';

const RUNES = ['rune_healing', 'rune_mana', 'rune_speed', 'rune_gold'];
const STASH = ['tome_str', 'tome_agi', 'tome_int'];
/** Items the Marketplaces stock, by tier (weights favour the middle tiers). */
const MARKET_TIERS = [1, 2, 2, 3, 3, 3, 4];
const MARKET_SLOTS = 8;
/** A route through a waygate must save at least this share of the walk. */
const GATE_SAVING = 0.7;

interface RuneSpot extends Point {
  item: GroundItem | null;
  nextAt: number;
}

export class Neutrals {
  readonly game: Game;
  gates: Unit[] = [];
  shrines: Unit[] = [];
  markets: Unit[] = [];
  /** Cages of captives by the camp that guards them. */
  cages = new Map<CampState, Unit>();
  runeSpots: RuneSpot[] = [];
  private timer = 0;

  constructor(game: Game) {
    this.game = game;
  }

  /** After the neutral buildings and creep camps exist. */
  setup(): void {
    const g = this.game;
    const neutral = g.passive.buildings;
    this.gates = neutral.filter((u) => u.def.walkable && u.link);
    for (const a of this.gates) a.twin = this.gates.find((b) => b !== a && b.link === a.link) ?? null;
    this.shrines = neutral.filter((u) => u.def.shrine);
    for (const s of this.shrines) s.readyAt = 0;
    this.markets = neutral.filter((u) => u.def.shop === 'market');
    for (const m of this.markets) {
      m.wares = [];
      while (m.wares.length < MARKET_SLOTS) this.restock(m);
    }
    // Runes in the ruins and on the lakeshores; tomes in the hidden stashes.
    for (const s of g.layout.spots) {
      const p = g.grid.nearestWalkable(s.at[0], s.at[1], 4);
      if (!p) continue;
      if (s.kind === 'rune') this.runeSpots.push({ x: p.x, z: p.z, item: null, nextAt: 30 + Math.random() * 60 });
      else if (s.kind === 'stash') {
        g.dropItem(p.x, p.z, STASH[Math.floor(Math.random() * STASH.length)]!);
        g.dropItem(p.x + 1.2, p.z, 'tome_xp');
      }
    }
    // A chest of gold at the back of every boss lair.
    for (const camp of g.creepMgr.camps) {
      if (!camp.boss) continue;
      const dx = CENTER - camp.at.x;
      const dz = CENTER - camp.at.z;
      const l = Math.hypot(dx, dz) || 1;
      const p = g.grid.nearestWalkable(camp.at.x - (dx / l) * 7, camp.at.z - (dz / l) * 7, 4);
      if (p) g.dropItem(p.x, p.z, 'chest_gold');
    }
    // Cages beside the camps that hold captives.
    for (const camp of g.creepMgr.camps) {
      if (!camp.captives) continue;
      const dx = CENTER - camp.at.x;
      const dz = CENTER - camp.at.z;
      const l = Math.hypot(dx, dz) || 1;
      const x = camp.at.x - (dx / l) * 3.5;
      const z = camp.at.z - (dz / l) * 3.5;
      const cage = g.spawnUnit('cage', g.passive, x, z, { facing: Math.atan2(dx, dz) });
      this.cages.set(camp, cage);
    }
  }

  // ------------------------------------------------------------ marketplace
  /** Fill an empty (or the oldest) slot of a Marketplace with a new item. */
  restock(m: Unit): void {
    const wares = m.wares!;
    const tier = MARKET_TIERS[Math.floor(Math.random() * MARKET_TIERS.length)]!;
    const pool = Object.entries(ITEMS)
      .filter(([id, it]) => it.tier === tier && !wares.some((w) => w.id === id && w.stock > 0) && !it.use?.startsWith('area') && id !== 'chest_gold' && id !== 'rune_gold')
      .map(([id]) => id);
    if (!pool.length) return;
    const ware: Ware = { id: pool[Math.floor(Math.random() * pool.length)]!, stock: 1 };
    const empty = wares.findIndex((w) => w.stock <= 0);
    if (empty >= 0) wares[empty] = ware;
    else if (wares.length < MARKET_SLOTS) wares.push(ware);
    else wares[Math.floor(Math.random() * wares.length)] = ware;
  }

  /** Price of an item at a Marketplace. */
  price(id: string): number {
    return itemPrice(id);
  }

  // --------------------------------------------------------------- waygates
  /** Did this unit mean to step onto the gate? (Sent there, or its last move ended there.) */
  private wantsGate(u: Unit, gate: Unit): boolean {
    const o = u.order;
    const near = (p: Point): boolean => Math.hypot(p.x - gate.x, p.z - gate.z) < 1.6;
    if ((o.type === 'move' || o.type === 'attackMove' || o.type === 'patrol') && near(o.point)) return true;
    const last = u.lastGoal;
    return !!last && this.game.time - last.time < 0.6 && near(last) && (o.type === 'idle' || o.type === 'hold' || o.type === 'stop');
  }

  /** Units sent onto a waygate step out of its twin. */
  private updateGates(): void {
    const g = this.game;
    for (const gate of this.gates) {
      const twin = gate.twin;
      if (!twin) continue;
      for (const u of g.unitsNear(gate.x, gate.z, 1.4)) {
        if (u.isBuilding || u.dead || u.hidden || !u.canMove || !u.owner.general) continue;
        if ((u.gateUntil ?? 0) > g.time || !this.wantsGate(u, gate)) continue;
        this.teleport(u, gate, twin);
      }
    }
  }

  teleport(u: Unit, from: Unit, to: Unit): void {
    const g = this.game;
    // Step out on the side of the twin that faces the middle of the map.
    const dx = CENTER - to.x;
    const dz = CENTER - to.z;
    const l = Math.hypot(dx, dz) || 1;
    const a = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.2;
    const exit = g.grid.nearestWalkable(to.x + Math.cos(a) * 3, to.z + Math.sin(a) * 3, 6) ?? g.grid.nearestWalkable(to.x + (dx / l) * 3, to.z + (dz / l) * 3, 8);
    if (!exit) return;
    g.fx.burst(u.x, 0.8, u.z, 0x8ad8ff, 10);
    u.x = exit.x;
    u.z = exit.z;
    u.gateUntil = g.time + 2.5;
    u.lastGoal = null;
    stopMoving(u);
    const o = u.order;
    if ((o.type === 'move' && (o.gate === from || Math.hypot(o.point.x - from.x, o.point.z - from.z) < 1.6)) || ((o.type === 'attackMove' || o.type === 'patrol') && Math.hypot(o.point.x - from.x, o.point.z - from.z) < 1.6)) {
      finishOrder(g, u);
    }
    g.fx.burst(u.x, 0.8, u.z, 0x8ad8ff, 12);
    g.sound('teleport', u.x, u.z, 0.6);
    // Units following this one take the gate too.
    for (const f of g.unitsNear(from.x, from.z, 30)) {
      if (f.owner !== u.owner || f === u || f.isBuilding || f.dead || f.order.type !== 'follow' || f.order.target !== u) continue;
      g.issueOrder(f, { type: 'move', point: { x: from.x, z: from.z }, range: 0.3, gate: from });
      f.orderQueue.push({ type: 'follow', target: u });
    }
  }

  /** The waygate whose center is at (or right by) a point. */
  gateAt(p: Point): Unit | null {
    return this.gates.find((gate) => Math.hypot(p.x - gate.x, p.z - gate.z) < 1.6) ?? null;
  }

  /** The waygate that makes a trip from `u` to `to` much shorter, if any (for the computer generals). */
  gateFor(u: Point, to: Point): Unit | null {
    const direct = Math.hypot(to.x - u.x, to.z - u.z);
    if (direct < 70) return null;
    let best: Unit | null = null;
    let bestD = direct * GATE_SAVING;
    for (const gate of this.gates) {
      if (!gate.twin) continue;
      const d = Math.hypot(gate.x - u.x, gate.z - u.z) + Math.hypot(to.x - gate.twin.x, to.z - gate.twin.z) + 8;
      if (d < bestD) {
        bestD = d;
        best = gate;
      }
    }
    return best;
  }

  /**
   * Give `u` an order that ends at `to`, through a waygate when that is much shorter. Returns false
   * (doing nothing) when the unit is already on its way.
   */
  orderVia(u: Unit, order: Order & { point: Point }): boolean {
    const g = this.game;
    const o = u.order;
    if (o.type === 'move' && o.gate) {
      const next = u.orderQueue[0];
      if (next && 'point' in next && next.point && Math.hypot(next.point.x - order.point.x, next.point.z - order.point.z) < 3) return false;
    }
    const gate = this.gateFor(u, order.point);
    if (!gate) {
      g.issueOrder(u, order);
      return true;
    }
    g.issueOrder(u, { type: 'move', point: { x: gate.x, z: gate.z }, range: 0.3, gate });
    u.orderQueue.push(order);
    return true;
  }

  // ---------------------------------------------------------------- shrines
  private updateShrines(): void {
    const g = this.game;
    for (const s of this.shrines) {
      if ((s.readyAt ?? 0) > g.time) continue;
      const hero = g.unitsNear(s.x, s.z, 3.5).find((u) => u.isHero && !u.isIllusion && !u.dead && u.owner.general);
      if (!hero) continue;
      const p = hero.owner;
      s.readyAt = g.time + 240;
      let n = 0;
      for (const u of g.unitsNear(s.x, s.z, 10)) {
        if (u.owner !== p || u.isBuilding || u.dead) continue;
        u.addBuff('blessing', 90, { armor: 4, damage: 12, hpRegen: 6, replace: true });
        g.fx.burst(u.x, 0.9, u.z, 0xfff0a0, 6);
        n++;
      }
      g.fx.ring(s.x, s.z, 0xfff0a0, 10, 1.0);
      g.fx.beam(s.x, s.z, 0xfff0a0, 8, 0.8, 1.2);
      g.sound('levelUp', s.x, s.z, 0.7);
      if (p.isHuman) g.message(`The Shrine of the Ancients blesses ${n} of your units: +4 armor, +12 damage and swift healing for 90 seconds.`, '#ffe680');
      else if (g.isAlliedToHuman(p)) g.notify(p, `${p.name} has drawn on a Shrine of the Ancients.`);
    }
  }

  // ------------------------------------------------------------------ runes
  private updateRunes(): void {
    const g = this.game;
    for (const s of this.runeSpots) {
      if (s.item) {
        if (!s.item.taken) continue;
        s.item = null;
        s.nextAt = g.time + 180 + Math.random() * 90;
      }
      if (g.time < s.nextAt) continue;
      s.item = g.dropItem(s.x, s.z, RUNES[Math.floor(Math.random() * RUNES.length)]!);
    }
  }

  // ------------------------------------------------------------------ cages
  /** Captives go free once their guards are dead and a general's unit comes to the cage. */
  private updateCages(): void {
    const g = this.game;
    for (const [camp, cage] of this.cages) {
      if (!camp.cleared || cage.dead) continue;
      const rescuer = g.unitsNear(cage.x, cage.z, 4).find((u) => u.owner.general && !u.isBuilding && !u.dead && !u.isIllusion);
      if (!rescuer) continue;
      this.cages.delete(camp);
      this.freeCaptives(cage, rescuer);
    }
  }

  freeCaptives(cage: Unit, rescuer: Unit): void {
    const g = this.game;
    const p = rescuer.owner;
    // An empire's captives are soldiers of its own age; a Hero's are footmen, an archer and a priest.
    const types = p.mode === 'empire' ? [g.empires.footSoldier(Math.max(1, p.tier)), g.empires.footSoldier(Math.max(1, p.tier)), 'archer', 'priest'] : ['footman', 'footman', 'archer', 'priest'];
    g.removeQuietly(cage);
    const freed: Unit[] = [];
    types.forEach((type, i) => {
      const a = (i / types.length) * Math.PI * 2;
      const pos = g.grid.nearestWalkable(cage.x + Math.cos(a) * 1.4, cage.z + Math.sin(a) * 1.4, 4) ?? { x: cage.x, z: cage.z };
      const u = g.spawnUnit(type, p, pos.x, pos.z, { facing: rescuer.facing });
      g.fx.burst(u.x, 0.8, u.z, 0xfff0a0, 8);
      freed.push(u);
    });
    g.fx.ring(cage.x, cage.z, 0xfff0a0, 3, 0.8);
    g.sound('buildComplete', cage.x, cage.z);
    if (p.hero && !p.hero.dead && p.mode === 'hero') for (const u of freed) g.issueOrder(u, { type: 'follow', target: p.hero });
    g.quests?.onCaptivesFreed(cage, p, freed);
  }

  update(dt: number): void {
    this.updateGates();
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    this.updateShrines();
    this.updateCages();
    this.updateRunes();
    // Marketplaces bring out a new treasure every 70 seconds.
    for (const m of this.markets) {
      m.stockTimer = (m.stockTimer ?? 0) + 0.5;
      if (m.stockTimer >= 70) {
        m.stockTimer = 0;
        this.restock(m);
      }
    }
  }
}
