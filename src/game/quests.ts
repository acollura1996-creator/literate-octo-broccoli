// Side quests: optional objectives that turn up over the game, each won by the first general to
// complete it (the computer generals pursue them too). Five kinds:
//   rescue   - bandits hold captives in a cage; kill the guards and bring a unit to free them
//   bounty   - a price on the head of one of the four lair bosses
//   treasure - a map to treasure buried somewhere in a circle; a Hero digs it up at the exact spot
//   escort   - a merchant's wagon must reach the next outpost through bandit ambushes
//   purge    - wipe out three creep camps of a region; the general who clears most is rewarded
// Engine-free: the HUD's quest log and the minimap read `list`.
import { UNITS } from '../data/units.ts';
import { ITEMS, randomDrop } from '../data/items.ts';
import { CENTER, EDGE_NAMES, REGION_NAMES, RING_ROAD, rotate } from '../world/layout.ts';
import type { Game } from './game.ts';
import type { Unit } from './unit.ts';
import type { CampState, Player, Point } from './types.ts';

export type QuestKind = 'rescue' | 'bounty' | 'treasure' | 'escort' | 'purge';
export interface QuestReward {
  gold?: number;
  lumber?: number;
  xp?: number;
  item?: string;
  /** Text for rewards that are not resources (the freed captives). */
  extra?: string;
}
export interface Quest {
  id: number;
  kind: QuestKind;
  title: string;
  /** What to do. */
  text: string;
  reward: QuestReward;
  /** Where it is (the minimap marks it; a circle of `radius` when only roughly known). */
  at: Point;
  radius: number;
  state: 'active' | 'done' | 'failed';
  winner: Player | null;
  started: number;
  /** Game time it ended, or lapses if nobody takes it up. */
  ends?: number;
  /** Progress, e.g. "1/3 camps". */
  progress?: string;
  camp?: CampState;
  camps?: CampState[];
  clearedBy?: Map<CampState, Player | null>;
  /** Treasure: the exact spot, and whether the human's side has seen it glint. */
  spot?: Point;
  found?: boolean;
  /** Escort: the wagon (neutral while it waits), its route and the ambushes still to come. */
  wagon?: Unit | null;
  route?: Point[];
  ambushes?: number[];
  routeLength?: number;
}

const ICONS: Record<QuestKind, string> = { rescue: '⛓️', bounty: '💀', treasure: '🗺️', escort: '🛒', purge: '⚔️' };
export const questIcon = (k: QuestKind): string => ICONS[k];

export class QuestManager {
  readonly game: Game;
  list: Quest[] = [];
  private nextId = 1;
  private timer = 0;
  /** Game time of the next quest of each kind. */
  private due: Record<'rescue' | 'treasure' | 'bounty' | 'escort' | 'purge', number> = { rescue: 90, treasure: 240, purge: 330, bounty: 480, escort: 620 };
  private lastBoss: string | null = null;
  /** Bumped when a quest starts or ends (the HUD redraws its log). */
  version = 0;

  constructor(game: Game) {
    this.game = game;
  }

  get active(): Quest[] {
    return this.list.filter((q) => q.state === 'active');
  }

  // ---------------------------------------------------------------- update
  update(dt: number): void {
    const g = this.game;
    if (g.over) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const t = g.time;
    if (t >= this.due.rescue) {
      this.due.rescue = Infinity;
      const camps = g.creepMgr.camps.filter((camp) => camp.captives && g.neutrals.cages.has(camp));
      for (const camp of camps) {
        this.startRescue(camp);
        g.ping(camp.at.x, camp.at.z, '#ffd700');
      }
      if (camps.length) {
        g.message(`⛓️ New quests: brigands keep captives caged in ${camps.length} camps across the land. Kill the guards and bring a unit to a cage: the captives will fight for you.`, '#ffe680');
        g.sound('questNew');
      }
    }
    if (t >= this.due.treasure && !this.active.some((q) => q.kind === 'treasure')) {
      this.due.treasure = t + 420;
      this.startTreasure();
    }
    if (t >= this.due.purge && !this.active.some((q) => q.kind === 'purge')) {
      this.due.purge = t + 360;
      this.startPurge();
    }
    if (t >= this.due.bounty && !this.active.some((q) => q.kind === 'bounty')) {
      this.due.bounty = t + 480;
      this.startBounty();
    }
    if (t >= this.due.escort && !this.active.some((q) => q.kind === 'escort')) {
      this.due.escort = t + 540;
      this.startEscort();
    }
    for (const q of this.active) {
      if (q.kind === 'treasure') this.checkTreasure(q);
      else if (q.kind === 'escort') this.checkEscort(q);
      else if (q.kind === 'bounty' && q.camp && q.camp.cleared && q.state === 'active' && !q.camp.units.some((u) => !u.dead)) {
        // The boss fell to someone other than a general.
        this.fail(q, `${q.title}: the beast was slain, but nobody claimed the bounty.`);
      }
    }
  }

  // -------------------------------------------------------------- creation
  private add(q: Omit<Quest, 'id' | 'state' | 'winner' | 'started'>, announce = true): Quest {
    const g = this.game;
    const quest: Quest = { ...q, id: this.nextId++, state: 'active', winner: null, started: g.time };
    this.list.push(quest);
    this.version++;
    if (announce) {
      g.message(`${ICONS[q.kind]} New quest: ${q.title}. ${q.text}`, '#ffe680');
      g.sound('questNew');
      g.ping(q.at.x, q.at.z, '#ffd700');
    }
    return quest;
  }

  startRescue(camp: CampState): Quest {
    const region = REGION_NAMES[camp.region] ?? 'the wilds';
    return this.add({
      kind: 'rescue', title: `Captives of ${region}`, camp, at: { ...camp.at }, radius: 0,
      text: `Brigands keep captives caged in ${region}. Kill the guards and bring any unit to the cage to free them.`,
      reward: { gold: 150, xp: 120, extra: '4 freed captives join you' },
    }, false);
  }

  startBounty(): Quest | null {
    const g = this.game;
    const lairs = g.creepMgr.camps.filter((c) => c.boss && !c.cleared && c.boss !== this.lastBoss);
    if (!lairs.length) return null;
    const camp = lairs[Math.floor(Math.random() * lairs.length)]!;
    this.lastBoss = camp.boss!;
    const name = UNITS[camp.boss!]!.name;
    const edge = EDGE_NAMES[this.edgeOf(camp.at)]!;
    return this.add({
      kind: 'bounty', title: `Bounty: ${name}`, camp, at: { ...camp.at }, radius: 0,
      text: `The lords of the land pay a fortune for the head of ${name}, in the lair on the ${edge} road.`,
      reward: { gold: 600, lumber: 250, xp: 400, item: randomDrop(5) },
    });
  }

  startTreasure(): Quest | null {
    const g = this.game;
    const halls = g.layout.bases.map((b) => b.hall);
    const sites = g.layout.spots.filter((s) => s.kind === 'dig' && halls.every((h) => Math.hypot(h[0] - s.at[0], h[1] - s.at[1]) > 45));
    for (let tries = 0; tries < 8 && sites.length; tries++) {
      const s = sites[Math.floor(Math.random() * sites.length)]!;
      const p = g.grid.nearestWalkable(s.at[0], s.at[1], 4);
      if (!p || !g.grid.findPath(p.x, p.z, CENTER, CENTER - RING_ROAD, 2, 40000)) continue;
      // The map only shows roughly where: a circle around the spot, not centered on it.
      const a = Math.random() * Math.PI * 2;
      const off = 4 + Math.random() * 8;
      const region = REGION_NAMES[s.region] ?? 'the wilds';
      return this.add({
        kind: 'treasure', title: `The Lost Hoard of ${region}`, spot: p, found: false,
        at: { x: p.x + Math.cos(a) * off, z: p.z + Math.sin(a) * off }, radius: 16,
        text: `A tattered map shows treasure buried somewhere in the marked circle in ${region}. Search it with a Hero: the spot glints when one comes close.`,
        reward: { gold: 400, xp: 150, item: randomDrop(Math.random() < 0.5 ? 3 : 4) },
      });
    }
    return null;
  }

  startPurge(): Quest | null {
    const g = this.game;
    const region = Math.floor(Math.random() * 4);
    const camps = g.creepMgr.camps
      .filter((c) => c.region === region && !c.cleared && !c.boss && !c.captives && c.tier >= 2)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    if (camps.length < 2) return null;
    const at = { x: camps.reduce((s, c) => s + c.at.x, 0) / camps.length, z: camps.reduce((s, c) => s + c.at.z, 0) / camps.length };
    const radius = Math.max(...camps.map((c) => Math.hypot(c.at.x - at.x, c.at.z - at.z))) + 8;
    const name = REGION_NAMES[region]!;
    return this.add({
      kind: 'purge', title: `Cleanse ${name}`, camps, clearedBy: new Map(), at, radius,
      text: `The farmers of ${name} beg for help: wipe out the ${camps.length} creep camps marked on the map. The general who clears the most of them is rewarded.`,
      reward: { gold: 350, lumber: 200, xp: 200, item: randomDrop(3) }, progress: `0/${camps.length} camps`,
    });
  }

  startEscort(): Quest | null {
    const g = this.game;
    // From the village of one edge, along the ring road, to the outpost of the next edge.
    const k = Math.floor(Math.random() * 4);
    const dir = Math.random() < 0.5 ? 1 : 3;
    const k2 = (k + dir) % 4;
    const village = rotate([CENTER - 6, CENTER - RING_ROAD - 4], k);
    const diag = rotate([CENTER, CENTER - RING_ROAD], k);
    const mid: [number, number] = [(diag[0] + rotate([CENTER, CENTER - RING_ROAD], k2)[0]) / 2, (diag[1] + rotate([CENTER, CENTER - RING_ROAD], k2)[1]) / 2];
    const len = Math.hypot(mid[0] - CENTER, mid[1] - CENTER) || 1;
    const ringMid: [number, number] = [CENTER + ((mid[0] - CENTER) / len) * RING_ROAD, CENTER + ((mid[1] - CENTER) / len) * RING_ROAD];
    const route = [diag, ringMid, rotate([CENTER, CENTER - RING_ROAD], k2), rotate([CENTER, 66], k2)]
      .map(([x, z]) => g.grid.nearestWalkable(x, z, 8) ?? { x, z });
    const start = g.grid.nearestWalkable(village[0], village[1], 6);
    if (!start) return null;
    const wagon = g.spawnUnit('merchant_wagon', g.passive, start.x, start.z, { facing: Math.atan2(CENTER - start.x, CENTER - start.z) });
    let routeLength = Math.hypot(route[0]!.x - start.x, route[0]!.z - start.z);
    for (let i = 1; i < route.length; i++) routeLength += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.z - route[i - 1]!.z);
    return this.add({
      kind: 'escort', title: 'The Merchant’s Wagon', wagon, route, ambushes: [0.35, 0.7], routeLength,
      at: { x: start.x, z: start.z }, radius: 0, ends: g.time + 150,
      text: `A merchant at the ${EDGE_NAMES[k]} village needs an escort to the ${EDGE_NAMES[k2]} outpost. Bring any unit to the wagon to take the contract, then keep it alive through the bandits' ambushes.`,
      reward: { gold: 500, lumber: 200, xp: 200, item: randomDrop(3) },
    });
  }

  /** Index of the edge (0 north ... 3 west) nearest a point. */
  private edgeOf(p: Point): number {
    const dx = p.x - CENTER;
    const dz = p.z - CENTER;
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
    return dz > 0 ? 2 : 0;
  }

  // ---------------------------------------------------------------- checks
  private checkTreasure(q: Quest): void {
    const g = this.game;
    const s = q.spot!;
    for (const u of g.unitsNear(s.x, s.z, 10)) {
      if (!u.isHero || u.dead || u.isIllusion || !u.owner.general) continue;
      if (!q.found && g.isAlliedToHuman(u.owner)) {
        q.found = true;
        this.version++;
        g.fx.beam(s.x, s.z, 0xffe680, 3, 0.4, 2);
        if (u.owner.isHuman) g.message('Your Hero spots something glinting in the ground nearby!', '#ffe680');
      }
      if (u.distTo(s) <= 2.2) {
        g.fx.burst(s.x, 0.5, s.z, 0xffd700, 24, 2.5);
        g.sound('dig', s.x, s.z);
        this.complete(q, u.owner, s);
        return;
      }
    }
  }

  private checkEscort(q: Quest): void {
    const g = this.game;
    const w = q.wagon;
    if (!w || w.dead) {
      this.fail(q, w?.owner.general ? 'The merchant’s wagon was destroyed. The escort has failed.' : 'The merchant’s wagon was lost.');
      return;
    }
    if (w.owner === g.passive) {
      // Waiting for someone to take the contract.
      if (q.ends !== undefined && g.time > q.ends) {
        g.removeQuietly(w);
        this.fail(q, 'Nobody escorted the merchant, so he went on his way alone.');
        return;
      }
      const taker = g.unitsNear(w.x, w.z, 4).find((u) => u.owner.general && !u.isBuilding && !u.dead && !u.isIllusion);
      if (taker) this.acceptEscort(q, taker.owner);
      return;
    }
    // On the road: ambushes along the way, success at the last stop.
    const route = q.route!;
    const dest = route[route.length - 1]!;
    if (w.distTo(dest) < 5) {
      const p = w.owner;
      this.complete(q, p, { x: w.x, z: w.z });
      g.removeQuietly(w);
      return;
    }
    const left = this.remaining(w, route);
    const done = 1 - left / Math.max(1, q.routeLength!);
    if (q.ambushes!.length && done >= q.ambushes![0]!) {
      q.ambushes!.shift();
      this.ambush(w);
    }
    // Keep it rolling if it was stopped.
    if (w.order.type === 'idle' && !w.orderQueue.length) this.drive(w, route);
  }

  private remaining(w: Unit, route: Point[]): number {
    // Distance still to go: to the nearest remaining waypoint, then along the rest.
    let best = 0;
    let bestD = Infinity;
    route.forEach((p, i) => {
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    let len = bestD;
    for (let i = best + 1; i < route.length; i++) len += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.z - route[i - 1]!.z);
    return len;
  }

  private drive(w: Unit, route: Point[]): void {
    const g = this.game;
    // Head for the waypoints still ahead (the one nearest the destination that is not behind us).
    const dest = route[route.length - 1]!;
    let from = 0;
    for (let i = 0; i < route.length; i++) if (Math.hypot(route[i]!.x - dest.x, route[i]!.z - dest.z) >= w.distTo(dest)) from = i + 1;
    route.slice(Math.min(from, route.length - 1)).forEach((p, i) => g.issueOrder(w, { type: 'move', point: p }, i > 0));
  }

  private acceptEscort(q: Quest, p: Player): void {
    const g = this.game;
    const old = q.wagon!;
    const w = g.spawnUnit('merchant_wagon', p, old.x, old.z, { facing: old.facing });
    g.removeQuietly(old);
    q.wagon = w;
    q.ends = undefined;
    q.progress = `escorted by ${p.isHuman ? 'you' : p.name}`;
    this.version++;
    this.drive(w, q.route!);
    if (p.isHuman) {
      g.message('You have taken the merchant’s contract. Keep his wagon alive until it reaches the outpost!', '#ffe680');
      g.sound('buildComplete');
    } else g.message(`${p.name} is escorting the merchant’s wagon.`, g.nameColor(p));
    g.ping(w.x, w.z, '#ffd700');
  }

  /** Bandits strike at the wagon from the roadside. */
  private ambush(w: Unit): void {
    const g = this.game;
    const minutes = g.time / 60;
    const n = Math.min(7, 2 + Math.floor(minutes / 8));
    const a = Math.random() * Math.PI * 2;
    const from = g.grid.nearestWalkable(w.x + Math.cos(a) * 11, w.z + Math.sin(a) * 11, 8);
    if (!from) return;
    for (let i = 0; i < n; i++) {
      const pos = g.grid.nearestWalkable(from.x + (Math.random() - 0.5) * 4, from.z + (Math.random() - 0.5) * 4, 6) ?? from;
      const u = g.spawnUnit(i % 3 === 2 ? 'gnoll_archer' : minutes > 20 && i === 0 ? 'ogre' : 'brigand', g.creeps, pos.x, pos.z);
      u.raider = true;
      g.creepMgr.empower(u);
      g.issueOrder(u, { type: 'attack', target: w });
    }
    if (w.owner.isHuman || g.isAlliedToHuman(w.owner)) {
      g.message('Ambush! Bandits are attacking the merchant’s wagon!', '#ff8a6a');
      g.ping(from.x, from.z, '#ff4040');
    }
    g.sound('warning', w.x, w.z);
  }

  // ----------------------------------------------------------------- hooks
  /** A camp was wiped out (by `killer`). */
  onCampCleared(camp: CampState, killer: Unit | null): void {
    const p = killer?.owner?.general ? killer.owner : null;
    for (const q of this.active) {
      if (q.kind === 'bounty' && q.camp === camp && camp.boss) {
        if (p) this.complete(q, p, { x: camp.at.x, z: camp.at.z });
      } else if (q.kind === 'purge' && q.camps!.includes(camp) && !q.clearedBy!.has(camp)) {
        q.clearedBy!.set(camp, p);
        q.progress = `${q.clearedBy!.size}/${q.camps!.length} camps`;
        this.version++;
        if (q.clearedBy!.size >= q.camps!.length) {
          // The general who cleared the most camps (the last one breaks a tie).
          const tally = new Map<Player, number>();
          for (const who of q.clearedBy!.values()) if (who) tally.set(who, (tally.get(who) ?? 0) + 1);
          let winner: Player | null = null;
          let most = 0;
          for (const [who, n] of tally) if (n > most || (n === most && who === p)) [winner, most] = [who, n];
          if (winner) this.complete(q, winner, { x: camp.at.x, z: camp.at.z });
          else this.fail(q, `${q.title}: the camps are gone, but no general can claim the reward.`);
        }
      }
    }
  }

  onCaptivesFreed(_cage: Unit, p: Player, freed: Unit[]): void {
    const q = this.active.find((x) => x.kind === 'rescue' && x.camp && !this.game.neutrals.cages.has(x.camp));
    if (q) this.complete(q, p, { x: freed[0]?.x ?? q.at.x, z: freed[0]?.z ?? q.at.z });
  }

  // --------------------------------------------------------------- endings
  complete(q: Quest, p: Player, where: Point): void {
    const g = this.game;
    if (q.state !== 'active') return;
    q.state = 'done';
    q.winner = p;
    q.ends = g.time;
    this.version++;
    const r = q.reward;
    p.gold += r.gold ?? 0;
    p.lumber += r.lumber ?? 0;
    const h = p.hero && !p.hero.dead ? p.hero : null;
    if (r.xp && h) g.addXp(h, r.xp);
    else if (r.xp) p.gold += Math.round(r.xp / 2); // no Hero to learn from it: paid in gold
    if (r.item) {
      const at = h && h.distTo(where) < 30 ? h : where;
      const pos = g.grid.nearestWalkable(at.x + 1, at.z, 3) ?? at;
      g.dropItem(pos.x, pos.z, r.item);
    }
    const got = [r.gold ? `${r.gold + (r.xp && !h ? Math.round(r.xp / 2) : 0)} gold` : '', r.lumber ? `${r.lumber} lumber` : '', r.xp && h ? `${r.xp} experience` : '', r.item ? ITEMS[r.item]!.name : '', r.extra ?? '']
      .filter(Boolean)
      .join(', ');
    if (p.isHuman) {
      g.message(`✔ Quest completed: ${q.title}! Reward: ${got}.`, '#9fe89f');
      g.sound('questDone');
    } else g.message(`${ICONS[q.kind]} ${p.name} has completed the quest ${q.title}.`, g.nameColor(p));
    g.ping(where.x, where.z, '#9fe89f');
  }

  fail(q: Quest, text: string): void {
    const g = this.game;
    if (q.state !== 'active') return;
    q.state = 'failed';
    q.ends = g.time;
    this.version++;
    g.message(`✖ ${text}`, '#ffae5a');
    g.sound('questFail');
  }

  /** Quest marker for the computer generals: where a general should go to work on it (null if nowhere useful). */
  targetFor(q: Quest, p: Player): Point | null {
    if (q.state !== 'active') return null;
    switch (q.kind) {
      case 'treasure':
        return q.spot ?? null;
      case 'bounty':
        return q.camp && !q.camp.cleared ? q.camp.at : null;
      case 'escort': {
        const w = q.wagon;
        if (!w || w.dead) return null;
        return w.owner === this.game.passive || w.owner === p ? { x: w.x, z: w.z } : null;
      }
      case 'rescue': {
        const cage = q.camp ? this.game.neutrals.cages.get(q.camp) : null;
        return cage && q.camp!.cleared ? { x: cage.x, z: cage.z } : null;
      }
      default:
        return null;
    }
  }
}
