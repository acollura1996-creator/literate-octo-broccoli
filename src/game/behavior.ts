// Per-unit order execution: movement, combat, harvesting, construction,
// training and spell casting.
import { ABILITIES } from './abilities.ts';
import type { AbilityDef } from './abilities.ts';
import { UNITS } from '../data/units.ts';
import type { Game } from './game.ts';
import type { Unit } from './unit.ts';
import type { Tree } from '../world/terrain.ts';
import type { OrderOf, Point, Resource } from './types.ts';

const TAU = Math.PI * 2;

export type MoveResult = 'arrived' | 'moving' | 'blocked';
export type AttackResult = 'done' | 'out' | 'busy';

export function angleTo(u: Point, x: number, z: number): number {
  return Math.atan2(x - u.x, z - u.z);
}

export function turnToward(u: Unit, target: number, dt: number, rate: number | null = null): number {
  let diff = target - u.facing;
  diff = ((diff + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const r = (rate ?? u.def.turnRate) * dt;
  if (Math.abs(diff) <= r) u.facing = target;
  else u.facing += Math.sign(diff) * r;
  return Math.abs(diff);
}

export function stopMoving(u: Unit): void {
  u.moving = false;
  u.path = null;
  u.pathGoal = null;
}

/**
 * Move a unit toward (x, z) until within `range`. Returns 'arrived',
 * 'moving' or 'blocked'.
 */
export function moveToward(game: Game, u: Unit, x: number, z: number, range: number, dt: number): MoveResult {
  const dist = Math.hypot(x - u.x, z - u.z);
  if (dist <= range) {
    stopMoving(u);
    return 'arrived';
  }
  if (!u.canMove) return 'blocked';
  if (u.rooted || u.stunned) {
    u.moving = false;
    return 'moving';
  }
  const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - x, u.pathGoal.z - z) > Math.max(0.6, dist * 0.2);
  if (!u.path || goalMoved) {
    if (game.pathBudget <= 0 || game.pathNodes <= 0) {
      u.moving = false;
      return 'moving';
    }
    game.pathBudget--;
    const searchRange = range > 0.35 ? range : 0;
    // Long searches (e.g. toward a target behind walls) are capped; the unit
    // walks to the closest reachable point and deals with what is in the way.
    const path = game.grid.findPath(u.x, u.z, x, z, searchRange, Math.min(30000, game.pathNodes));
    game.pathNodes -= game.grid.lastExpanded ?? 0;
    u.pathGoal = { x, z };
    u.stuckTime = 0;
    u.lastProgressDist = dist;
    u.progressTimer = 0;
    if (!path) {
      u.path = null;
      u.failedPaths = (u.failedPaths || 0) + 1;
      if (u.failedPaths > 2) {
        u.failedPaths = 0;
        return 'blocked';
      }
      return 'moving';
    }
    u.failedPaths = 0;
    u.path = path;
    u.pathIndex = 0;
  }

  let wp = u.path![u.pathIndex];
  if (!wp) {
    // Path exhausted but not within range: approach directly if possible.
    if (game.grid.lineWalkable(u.x, u.z, x, z, 0)) wp = { x, z };
    else {
      if (dist < range + 1.5) {
        stopMoving(u);
        return 'arrived';
      }
      // Reached the end of a partial path: the goal is walled off.
      u.path = null;
      u.exhausted = (u.exhausted || 0) + 1;
      if (u.exhausted >= 2) {
        u.exhausted = 0;
        stopMoving(u);
        return 'blocked';
      }
      return 'moving';
    }
  }
  const dx = wp.x - u.x;
  const dz = wp.z - u.z;
  const d = Math.hypot(dx, dz);
  const step = u.speed * dt * (game.grid.road[Math.floor(u.z) * game.grid.size + Math.floor(u.x)] ? 1.3 : 1);
  const desired = Math.atan2(dx, dz);
  const angDiff = turnToward(u, desired, dt);
  u.moving = true;
  if (angDiff > 1.6) return 'moving'; // turn in place first
  let nx: number;
  let nz: number;
  if (d <= step) {
    nx = wp.x;
    nz = wp.z;
    u.pathIndex++;
  } else {
    nx = u.x + (dx / d) * step;
    nz = u.z + (dz / d) * step;
  }
  if (game.grid.walkableAt(nx, nz)) {
    u.x = nx;
    u.z = nz;
  } else if (game.grid.walkableAt(nx, u.z)) {
    u.x = nx;
  } else if (game.grid.walkableAt(u.x, nz)) {
    u.z = nz;
  } else {
    u.stuckTime += dt;
  }

  // Progress tracking: repath if not getting closer.
  u.progressTimer = (u.progressTimer || 0) + dt;
  if (u.progressTimer > 0.6) {
    u.progressTimer = 0;
    const nd = Math.hypot(x - u.x, z - u.z);
    if (nd > (u.lastProgressDist ?? Infinity) - 0.25) {
      u.noProgress = (u.noProgress || 0) + 1;
      if (nd < range + 2.2 && u.noProgress >= 2) {
        u.noProgress = 0;
        stopMoving(u);
        return 'arrived';
      }
      if (u.noProgress >= 2) u.path = null; // force repath
      if (u.noProgress >= 7) {
        u.noProgress = 0;
        stopMoving(u);
        return 'blocked';
      }
    } else u.noProgress = 0;
    u.lastProgressDist = nd;
  }
  return 'moving';
}

export function validTarget(game: Game, u: Unit, t: Unit | null | undefined): t is Unit {
  if (!t || t.dead || t.removed || t.hidden) return false;
  if (t.invulnerable && !t.def.invulnerable) return true; // divine shield: still a target, just takes no damage
  if (t.def.invulnerable) return false;
  if (!t.targetableBy(u)) return false;
  return true;
}

/** Acquire the best enemy target within radius. */
export function findTarget(game: Game, u: Unit, radius: number): Unit | null {
  let best: Unit | null = null;
  let bestScore = Infinity;
  const human = u.owner.isHuman || game.isAlliedToHuman(u.owner);
  for (const t of game.unitsNear(u.x, u.z, radius + 1.5)) {
    if (t === u || t.dead || t.hidden || t.def.invulnerable) continue;
    if (!game.isEnemy(u.owner, t.owner)) continue;
    if (!t.targetableBy(u)) continue;
    if (human && !game.fog.isVisible(t.x, t.z)) continue;
    const d = u.distTo(t) - t.radius;
    if (d > radius) continue;
    if (u.def.minRange && d < u.def.minRange) continue;
    let score = d;
    if (t.isBuilding) score += 8;
    if (t.def.worker) score += 1;
    if (t.order.type === 'attack' && t.order.target?.owner === u.owner) score -= 2;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function acquireRange(u: Unit): number {
  if (u.def.creep || (u.def.legion && u.guardPos)) return Math.max(4.5, u.range + 1);
  return Math.max(u.range + 1.5, 6);
}

/**
 * Attack a target: chase if needed, then swing/fire on cooldown.
 * Returns 'done' when the target is gone, 'out' if out of range and unable
 * to chase, 'busy' otherwise.
 */
export function attackTarget(game: Game, u: Unit, t: Unit | null | undefined, dt: number, chase = true): AttackResult {
  if (!validTarget(game, u, t)) return 'done';
  if (!u.canAttack || u.hasBuff('bladestorm')) {
    if (chase && u.canMove) moveToward(game, u, t.x, t.z, 1.5, dt);
    return 'busy';
  }
  const reach = u.range + u.radius + t.radius;
  const d = u.distTo(t);
  if (u.def.minRange && d < u.def.minRange + t.radius && u.windup <= 0) return 'out';
  if (d > reach + (u.windup > 0 ? 1.2 : 0)) {
    if (!chase || !u.canMove) return 'out';
    const r = moveToward(game, u, t.x, t.z, reach - 0.15, dt);
    if (r === 'blocked') {
      // Hack through whatever is in the way, then carry on.
      const obstacle = blockingStructure(game, u);
      if (obstacle && obstacle !== t) {
        const cur = u.order;
        u.order = { type: 'attack', target: obstacle, resume: cur.type === 'attack' && cur.target === t ? cur : ('resume' in cur ? cur.resume : undefined) ?? { type: 'attack', target: t } };
        return 'busy';
      }
      return 'out';
    }
    return 'busy';
  }
  stopMoving(u);
  if (u.rooted && !u.isBuilding && !u.projectile && d > reach) return 'out';
  const ang = angleTo(u, t.x, t.z);
  if (!u.isBuilding) turnToward(u, ang, dt, 12);
  if (u.windup <= 0 && u.attackTimer <= 0 && !u.rooted) {
    u.windup = Math.min(0.45, u.attackCooldown * 0.32);
    u.windupTarget = t;
    u.attackTimer = u.attackCooldown;
    u.anim = 'attack';
    u.animTime = 0;
    if (u.hasBuff('wind_walk')) u.windWalkStrike = true;
  }
  return 'busy';
}

/** The nearest enemy structure (wall, gate or building) right next to a stuck unit. */
export function blockingStructure(game: Game, u: Unit): Unit | null {
  let best: Unit | null = null;
  let bd = 3.5;
  for (const b of game.unitsNear(u.x, u.z, 3.5)) {
    if (!b.isBuilding || b.dead || b.def.invulnerable || !game.isEnemy(u.owner, b.owner)) continue;
    const d = u.distTo(b) - b.radius;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

const SHOT_SOUND: Record<string, string> = {
  rock: 'explosion', stone: 'arrowShoot', arrow: 'arrowShoot', axe: 'arrowShoot', bullet: 'gunshot', grenade: 'arrowShoot',
  cannonball: 'cannon', shell: 'cannon', rocket: 'rocket', laser: 'laser', plasma: 'laser', javelin: 'arrowShoot',
  flame: 'fire', rail: 'laser',
};

function deliverAttack(game: Game, u: Unit, t: Unit | null): void {
  if (!validTarget(game, u, t)) return;
  const reach = u.range + u.radius + t.radius + 1.6;
  if (u.distTo(t) > reach) return;
  const p = u.projectile;
  if (p) {
    const shots = u.def.salvo ?? 1;
    for (let i = 0; i < shots; i++) {
      const fire = () => {
        if (u.dead) return;
        const spread = shots > 1 ? 1.4 : 0;
        const point = p.arc ? { x: t.x + (Math.random() - 0.5) * spread, z: t.z + (Math.random() - 0.5) * spread } : null;
        game.projectiles.spawn({
          kind: p.kind, from: u, target: t, speed: p.speed, color: p.color, arc: p.arc, point,
          onHit(target, pt) {
            if (u.def.splash) game.splashHit(u, pt.x, pt.z, u.def.splash, shots > 1 ? 1 / shots + 0.15 : 1);
            else if (target) game.attackHit(u, target);
          },
        });
        game.sound(SHOT_SOUND[p.kind] ?? 'magicCast', u.x, u.z, 0.5);
        u.lastShotAt = game.time;
      };
      if (i === 0) fire();
      else game.later(i * 0.18, fire);
    }
  } else {
    game.attackHit(u, t);
  }
}

// ------------------------------------------------------------------ orders
export function finishOrder(game: Game, u: Unit): void {
  const o = u.order;
  if (o.type === 'move' || o.type === 'attackMove') u.lastGoal = { x: o.point.x, z: o.point.z, time: game.time };
  if (u.orderQueue.length) {
    u.order = u.orderQueue.shift()!;
  } else {
    u.order = { type: 'idle' };
  }
  stopMoving(u);
}

/** Team id used to let units through their own (and allied) gates. */
export function passTeamOf(u: Unit): number {
  return u.owner.team ?? -99;
}

export function updateUnit(game: Game, u: Unit, dt: number): void {
  if (u.dead) return;
  u.animTime += dt;
  game.grid.passTeam = passTeamOf(u);

  if (u.lifetime !== null) {
    u.lifetime -= dt;
    if (u.lifetime <= 0) {
      game.kill(u, null, { expire: true });
      return;
    }
  }
  if (u.buffs.size) u.updateBuffs(dt);
  if (u.dead) return;

  // Regeneration
  if (!u.underConstruction && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.hpRegen * dt);
  const mm = u.maxMana;
  if (mm > 0 && u.mana < mm) u.mana = Math.min(mm, u.mana + u.manaRegen * dt);
  if (u.attackTimer > 0) u.attackTimer -= dt;
  for (const k in u.cooldowns) if (u.cooldowns[k]! > 0) u.cooldowns[k]! -= dt;

  if (u.isBuilding) {
    updateBuilding(game, u, dt);
    return;
  }

  if (u.stunned) {
    u.windup = 0;
    u.castTimer = 0;
    u.moving = false;
    if (u.channel) game.endChannel(u);
    return;
  }

  // Attack wind-up (damage point).
  if (u.windup > 0) {
    u.windup -= dt;
    if (u.windup <= 0) {
      deliverAttack(game, u, u.windupTarget);
      u.windupTarget = null;
    }
  }

  if (u.channel) {
    updateChannel(game, u, dt);
    return;
  }

  if (u.castTimer > 0) {
    u.castTimer -= dt;
    if (u.castTimer <= 0) completeCast(game, u);
    return;
  }

  // Autocast spells (priests heal, sorceresses slow).
  if (u.def.abilities.length && !u.isHero) {
    u.autoTimer = (u.autoTimer || 0) - dt;
    if (u.autoTimer <= 0) {
      u.autoTimer = 0.5;
      if (tryAutocast(game, u)) return;
    }
  }

  const o = u.order;
  switch (o.type) {
    case 'idle':
      doIdle(game, u, dt);
      break;
    case 'stop':
      finishOrder(game, u);
      break;
    case 'move': {
      const r = moveToward(game, u, o.point.x, o.point.z, o.range ?? 0.15, dt);
      if (r !== 'moving') {
        if (o.then) {
          const next = o.then;
          u.order = next;
          stopMoving(u);
        } else finishOrder(game, u);
      }
      break;
    }
    case 'follow': {
      if (!o.target || o.target.dead || o.target.removed) {
        finishOrder(game, u);
        break;
      }
      if (u.distTo(o.target) > 2.5) moveToward(game, u, o.target.x, o.target.z, 2, dt);
      else {
        stopMoving(u);
        if (u.canAttack) doHoldAttack(game, u, dt, acquireRange(u));
      }
      break;
    }
    case 'attack': {
      const r = attackTarget(game, u, o.target, dt, true);
      if (r === 'done' || r === 'out') {
        if (o.resume) {
          u.order = o.resume;
          stopMoving(u);
        } else finishOrder(game, u);
      } else if (o.auto && o.anchor) {
        // Auto-acquired targets are not chased forever.
        const fromAnchor = Math.hypot(u.x - o.anchor.x, u.z - o.anchor.z);
        if (fromAnchor > (o.leash ?? 12)) {
          u.order = u.guardPos ? { type: 'guardReturn', point: u.guardPos } : { type: 'move', point: o.anchor, range: 0.5 };
          stopMoving(u);
        }
      }
      break;
    }
    case 'attackMove':
    case 'patrol':
      doAttackMove(game, u, o, dt);
      break;
    case 'hold':
      stopMoving(u);
      doHoldAttack(game, u, dt, u.range + 0.5);
      break;
    case 'harvest':
      doHarvest(game, u, o, dt);
      break;
    case 'returnRes':
      doReturn(game, u, o, dt);
      break;
    case 'build':
      doBuild(game, u, o, dt);
      break;
    case 'construct':
      doConstruct(game, u, o, dt);
      break;
    case 'cast':
      doCast(game, u, o, dt);
      break;
    case 'pickup':
      doPickup(game, u, o, dt);
      break;
    case 'guardReturn': {
      // Creeps walking home after a chase: ignore enemies, heal up.
      const r = moveToward(game, u, o.point.x, o.point.z, 0.5, dt);
      if (u.def.creep) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.08 * dt);
      if (r !== 'moving') {
        finishOrder(game, u);
        u.facing = u.guardPos?.facing ?? u.facing;
      }
      break;
    }
    default:
      finishOrder(game, u);
  }

  // Animation state.
  if (u.anim === 'attack' && u.animTime < Math.min(0.9, u.attackCooldown * 0.8)) {
    // keep attack anim
  } else if (u.anim === 'cast' && u.animTime < 0.6) {
    // keep
  } else if (u.order.type === 'construct' && !u.moving) u.anim = 'work';
  else if (u.harvest?.phase === 'chop' && !u.moving) u.anim = 'work';
  else u.anim = u.moving ? 'walk' : 'stand';
}

function doIdle(game: Game, u: Unit, dt: number): void {
  stopMoving(u);
  if (!u.canAttack || u.def.worker) return;
  u.acquireTimer -= dt;
  if (u.acquireTimer > 0) return;
  u.acquireTimer = 0.35 + Math.random() * 0.15;
  const t = findTarget(game, u, acquireRange(u));
  if (t) {
    if (u.guardPos) game.aggroCamp(u, t);
    else u.order = { type: 'attack', target: t, auto: true, anchor: { x: u.x, z: u.z }, leash: 10 };
  } else if (u.guardPos && Math.hypot(u.x - u.guardPos.x, u.z - u.guardPos.z) > 1.2) {
    u.order = { type: 'guardReturn', point: u.guardPos };
  }
}

function doHoldAttack(game: Game, u: Unit, dt: number, radius: number): void {
  if (u.order.engage && validTarget(game, u, u.order.engage)) {
    const r = attackTarget(game, u, u.order.engage, dt, false);
    if (r === 'busy') return;
  }
  u.order.engage = null;
  u.acquireTimer -= dt;
  if (u.acquireTimer > 0) return;
  u.acquireTimer = 0.3;
  const t = findTarget(game, u, radius);
  if (t) u.order.engage = t;
}

function doAttackMove(game: Game, u: Unit, o: OrderOf<'attackMove' | 'patrol'>, dt: number): void {
  if (o.engage) {
    if (validTarget(game, u, o.engage) && u.distTo(o.engage) < acquireRange(u) + 6) {
      const r = attackTarget(game, u, o.engage, dt, true);
      if (r === 'busy') return;
    }
    o.engage = null;
    stopMoving(u);
  }
  if (u.canAttack) {
    u.acquireTimer -= dt;
    if (u.acquireTimer <= 0) {
      u.acquireTimer = 0.3;
      const t = findTarget(game, u, acquireRange(u));
      if (t) {
        o.engage = t;
        stopMoving(u);
        return;
      }
    }
  }
  const r = moveToward(game, u, o.point.x, o.point.z, o.type === 'patrol' ? 0.6 : 1.0, dt);
  if (r === 'blocked' && u.canAttack) {
    const obstacle = blockingStructure(game, u);
    if (obstacle) {
      o.engage = obstacle;
      return;
    }
  }
  if (r !== 'moving') {
    if (o.type === 'patrol') {
      const tmp = o.point;
      o.point = o.origin!;
      o.origin = tmp;
      stopMoving(u);
    } else finishOrder(game, u);
  }
}

// --------------------------------------------------------------- harvesting
/** Nearest building that accepts `kind` ('gold' or 'lumber'); town centers take both. */
function nearestDropOff(_game: Game, u: Unit, kind: Resource | undefined = u.carry?.kind): Unit | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const b of u.owner.buildings) {
    if (b.dead || !b.def.dropOff || b.underConstruction) continue;
    if (b.def.dropOff !== true && kind && b.def.dropOff !== kind) continue;
    const d = u.distTo(b);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export function findNearestTree(game: Game, x: number, z: number, maxR = 14): Tree | null {
  const t = game.terrain;
  let best: Tree | null = null;
  let bd = Infinity;
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let r = 0; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const tree = t.treeAtCell(cx + dx, cz + dz);
        if (!tree) continue;
        // Must have a walkable neighbour.
        let open = false;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          if (game.grid.walkable(tree.cx + ox, tree.cz + oz)) open = true;
        }
        if (!open) continue;
        const d = Math.hypot(tree.x - x, tree.z - z);
        if (d < bd) {
          bd = d;
          best = tree;
        }
      }
    }
    if (best && r > 2) return best;
  }
  return best;
}

function carryCap(u: Unit, kind: Resource): number {
  const up = u.owner.upgrades;
  return 10 + 2 * ((kind === 'lumber' ? up?.['forestry'] : up?.['mining']) ?? 0);
}

function doHarvest(game: Game, u: Unit, o: OrderOf<'harvest'>, dt: number): void {
  const h = (u.harvest ||= { phase: 'goto', timer: 0 });
  // Gold mines are buildings; trees are not units at all.
  const target = o.target;
  if (target && 'isBuilding' in target && target.isBuilding) {
    h.kind = 'gold';
    h.mine = target;
  } else {
    h.kind = 'lumber';
    h.tree = target as Tree | null | undefined;
  }

  if (u.carry && (u.carry.kind !== h.kind || u.carry.amount >= carryCap(u, u.carry.kind)) && h.phase !== 'inside') {
    u.order = { type: 'returnRes', resume: { type: 'harvest', target: h.kind === 'gold' ? h.mine : h.tree } };
    h.phase = 'goto';
    return;
  }

  if (h.kind === 'gold') {
    const mine = h.mine;
    if (!mine || mine.dead || mine.goldLeft <= 0) {
      if (h.phase === 'inside') exitMine(game, u, mine);
      u.harvest = null;
      finishOrder(game, u);
      return;
    }
    if (h.phase === 'inside') {
      h.timer -= dt;
      if (h.timer <= 0) {
        const amt = Math.min(carryCap(u, 'gold'), mine.goldLeft);
        mine.goldLeft -= amt;
        u.carry = { kind: 'gold', amount: amt };
        exitMine(game, u, mine);
        if (mine.goldLeft <= 0) game.collapseMine(mine);
        u.order = { type: 'returnRes', resume: { type: 'harvest', target: mine } };
        h.phase = 'goto';
      }
      return;
    }
    if (h.phase === 'wait') {
      // Only one Peasant fits inside a gold mine at a time.
      const occ = mine.occupant;
      if (occ && !occ.dead && occ.harvest?.inside && occ !== u) return;
      h.phase = 'goto';
    }
    const r = moveToward(game, u, mine.x, mine.z, mine.radius + u.radius + 0.25, dt);
    if (r === 'arrived') {
      const occ = mine.occupant;
      if (occ && occ !== u && !occ.dead && occ.harvest?.inside) {
        h.phase = 'wait';
        return;
      }
      mine.occupant = u;
      h.phase = 'inside';
      h.inside = true;
      h.timer = 1.0;
      u.moving = false;
    } else if (r === 'blocked') {
      finishOrder(game, u);
    }
    return;
  }

  // Lumber
  let tree = h.tree;
  if (!tree || !tree.alive) {
    tree = findNearestTree(game, tree?.x ?? u.x, tree?.z ?? u.z);
    if (!tree) {
      u.harvest = null;
      finishOrder(game, u);
      return;
    }
    o.target = tree;
    h.tree = tree;
    h.phase = 'goto';
  }
  if (h.phase === 'chop') {
    turnToward(u, angleTo(u, tree.x, tree.z), dt);
    h.timer -= dt;
    if (h.timer <= 0) {
      h.timer = 1.0 / (1 + 0.1 * (u.owner.upgrades?.['forestry'] ?? 0));
      const amt = Math.min(2, tree.lumber);
      tree.lumber -= amt;
      u.carry = { kind: 'lumber', amount: (u.carry?.kind === 'lumber' ? u.carry.amount : 0) + amt };
      game.sound('chop', u.x, u.z, 0.35);
      game.hooks.fx?.burst(tree.x, 0.7, tree.z, 0xb07a40, 4, 1.8, 0.05, 0.45);
      if (tree.lumber <= 0) game.terrain.fellTree(tree);
      if (u.carry.amount >= carryCap(u, 'lumber')) {
        u.order = { type: 'returnRes', resume: { type: 'harvest', target: tree } };
        h.phase = 'goto';
      } else if (!tree.alive) {
        h.phase = 'goto';
      }
    }
    return;
  }
  const r = moveToward(game, u, tree.x, tree.z, 1.25, dt);
  if (r === 'arrived') {
    h.phase = 'chop';
    h.timer = 1.0;
  } else if (r === 'blocked') {
    // Try another tree next time.
    h.tree = null;
    o.target = findNearestTree(game, u.x, u.z, 10);
    if (!o.target) finishOrder(game, u);
  }
}

function exitMine(game: Game, u: Unit, mine: Unit | null | undefined): void {
  if (!u.harvest) return;
  u.harvest.inside = false;
  if (!mine) return;
  if (mine.occupant === u) mine.occupant = null;
  const drop = nearestDropOff(game, u, 'gold');
  const tx = drop ? drop.x : u.x;
  const tz = drop ? drop.z : u.z;
  const a = Math.atan2(tx - mine.x, tz - mine.z);
  const p = game.grid.nearestWalkable(mine.x + Math.sin(a) * (mine.radius + 0.6), mine.z + Math.cos(a) * (mine.radius + 0.6), 4);
  if (p) {
    u.x = p.x;
    u.z = p.z;
  }
  u.facing = a;
}

function doReturn(game: Game, u: Unit, o: OrderOf<'returnRes'>, dt: number): void {
  if (!u.carry) {
    if (o.resume) u.order = o.resume;
    else finishOrder(game, u);
    return;
  }
  const drop = nearestDropOff(game, u);
  if (!drop) {
    if (u.owner.isHuman) game.message('You need a town center to return resources to.', '#f88');
    u.harvest = null;
    finishOrder(game, u);
    return;
  }
  const r = moveToward(game, u, drop.x, drop.z, drop.radius + u.radius + 0.35, dt);
  if (r === 'arrived') {
    const { kind, amount } = u.carry;
    u.owner[kind] += amount;
    u.owner.stats[kind === 'gold' ? 'goldMined' : 'lumberHarvested'] += amount;
    if (u.owner.isHuman) game.floatText(drop.x, drop.z, `+${amount}`, kind === 'gold' ? '#ffd700' : '#7cfc00', 1.1);
    u.carry = null;
    if (o.resume) u.order = o.resume;
    else finishOrder(game, u);
  } else if (r === 'blocked') finishOrder(game, u);
}

// ------------------------------------------------------------ construction
function doBuild(game: Game, u: Unit, o: OrderOf<'build'>, dt: number): void {
  const def = UNITS[o.building]!;
  const fp = def.footprint!;
  const r = moveToward(game, u, o.x, o.z, fp * 0.5 + u.radius + 0.6, dt);
  if (r === 'moving') return;
  const b = game.placeBuilding(u, o.building, o.x, o.z);
  if (!b) {
    if (o.paid) game.refund(u.owner, def.cost);
    if (u.owner.isHuman) game.message('Unable to build there.', '#f88');
    finishOrder(game, u);
    return;
  }
  u.order = { type: 'construct', target: b };
}

function doConstruct(game: Game, u: Unit, o: OrderOf<'construct'>, dt: number): void {
  const b = o.target;
  if (!b || b.dead || !b.underConstruction) {
    finishOrder(game, u);
    return;
  }
  const r = moveToward(game, u, b.x, b.z, b.radius + u.radius + 0.55, dt);
  if (r === 'moving') return;
  if (r === 'blocked') {
    finishOrder(game, u);
    return;
  }
  turnToward(u, angleTo(u, b.x, b.z), dt);
  game.progressConstruction(b, dt);
  u.buildSoundTimer = (u.buildSoundTimer || 0) - dt;
  if (u.buildSoundTimer <= 0) {
    u.buildSoundTimer = 2.2;
    game.sound('build', b.x, b.z, 0.35);
  }
}

// ---------------------------------------------------------------- buildings
function updateBuilding(game: Game, b: Unit, dt: number): void {
  if (b.underConstruction) return;
  // Training
  if (b.trainQueue.length) {
    const q = b.trainQueue[0]!;
    q.time += dt;
    if (q.time >= q.total) {
      b.trainQueue.shift();
      game.finishTraining(b, q.type);
    }
  }
  if (b.upgrading) {
    b.upgrading.time += dt;
    if (b.upgrading.time >= b.upgrading.total) game.finishUpgrade(b);
  }
  if (b.researching) {
    b.researching.time += dt;
    if (b.researching.time >= b.researching.total) game.finishResearch(b);
  }
  // Towers
  if (b.canAttack) {
    if (b.windup > 0) {
      b.windup -= dt;
      if (b.windup <= 0) {
        deliverAttack(game, b, b.windupTarget);
        b.windupTarget = null;
      }
    }
    const o = b.order;
    if (o.engage && attackTarget(game, b, o.engage, dt, false) === 'busy') return;
    o.engage = null;
    b.acquireTimer -= dt;
    if (b.acquireTimer <= 0) {
      b.acquireTimer = 0.3;
      o.engage = findTarget(game, b, b.range + 0.5);
    }
  }
}

// ------------------------------------------------------------------ casting
export function canCast(game: Game, u: Unit, abilityId: string, silent = true): boolean {
  const ab = ABILITIES[abilityId];
  if (!ab || ab.target === 'passive' || ab.target === 'aura') return false;
  const lvl = u.abilityLevel(abilityId);
  if (lvl <= 0) return false;
  if ((u.cooldowns[abilityId] || 0) > 0) {
    if (!silent && u.owner.isHuman) game.message('That ability is not ready yet.', '#f88');
    return false;
  }
  const mana = ab.mana![Math.min(ab.mana!.length, lvl) - 1] ?? 0;
  if (u.mana < mana) {
    if (!silent && u.owner.isHuman) game.message('Not enough mana.', '#88f');
    return false;
  }
  return true;
}

function abilityTargetOk(game: Game, u: Unit, ab: AbilityDef, t: Unit | null | undefined): t is Unit {
  if (!t || t.dead || t.removed || t.def.invulnerable) return false;
  const enemy = game.isEnemy(u.owner, t.owner);
  switch (ab.filter) {
    case 'ally':
      return !enemy && !t.isBuilding;
    case 'enemy':
      return enemy && t.targetableBy(u);
    case 'allyOrUndead':
      return (!enemy && !t.isBuilding) || (enemy && !!t.def.undead && t.targetableBy(u));
    default:
      return true;
  }
}

function doCast(game: Game, u: Unit, o: OrderOf<'cast'>, dt: number): void {
  const ab = ABILITIES[o.ability]!;
  if (!canCast(game, u, o.ability, false)) {
    finishOrder(game, u);
    return;
  }
  if (ab.target === 'unit') {
    if (!abilityTargetOk(game, u, ab, o.target)) {
      finishOrder(game, u);
      return;
    }
    const r = moveToward(game, u, o.target.x, o.target.z, ab.range! + u.radius + o.target.radius, dt);
    if (r === 'moving') return;
    if (r === 'blocked') {
      finishOrder(game, u);
      return;
    }
    u.facing = angleTo(u, o.target.x, o.target.z);
  } else if (ab.target === 'point') {
    const point = o.point!;
    const r = moveToward(game, u, point.x, point.z, ab.range!, dt);
    if (r === 'moving') return;
    if (r === 'blocked') {
      finishOrder(game, u);
      return;
    }
    u.facing = angleTo(u, point.x, point.z);
  }
  stopMoving(u);
  u.castTimer = ab.target === 'none' ? 0.15 : 0.3;
  u.castOrder = o;
  u.anim = 'cast';
  u.animTime = 0;
}

function completeCast(game: Game, u: Unit): void {
  const o = u.castOrder;
  u.castOrder = null;
  if (!o) return;
  const ab = ABILITIES[o.ability]!;
  const lvl = u.abilityLevel(o.ability);
  if (!canCast(game, u, o.ability)) {
    finishOrder(game, u);
    return;
  }
  if (ab.target === 'unit' && !abilityTargetOk(game, u, ab, o.target)) {
    finishOrder(game, u);
    return;
  }
  u.mana -= ab.mana![Math.min(ab.mana!.length, lvl) - 1] ?? 0;
  u.cooldowns[o.ability] = ab.cooldown![Math.min(ab.cooldown!.length, lvl) - 1] ?? 0;
  if (u.hasBuff('wind_walk') && o.ability !== 'wind_walk') u.removeBuff('wind_walk');
  finishOrder(game, u);
  ab.cast!(game, u, lvl, o.target, o.point);
}

function updateChannel(game: Game, u: Unit, dt: number): void {
  const ch = u.channel!;
  u.anim = 'cast';
  if (u.animTime > 0.6) u.animTime = 0.3;
  ch.elapsed += dt;
  ch.timer -= dt;
  if (ch.timer <= 0) {
    ch.timer += ch.interval;
    ch.tick();
  }
  if (ch.elapsed >= ch.duration) game.endChannel(u);
}

function tryAutocast(game: Game, u: Unit): boolean {
  for (const id of u.def.abilities) {
    const ab = ABILITIES[id]!;
    if (!ab.autocast || !u.autocast[id]) continue;
    if (!canCast(game, u, id)) continue;
    if (u.order.type === 'move' || u.order.type === 'cast') continue;
    let target: Unit | null = null;
    if (id === 'heal') {
      let worst = 0.97;
      for (const t of game.unitsNear(u.x, u.z, ab.range! + 1)) {
        if (t.dead || t.isBuilding || t.owner !== u.owner || t.def.invulnerable) continue;
        const ratio = t.hp / t.maxHp;
        if (ratio < worst) {
          worst = ratio;
          target = t;
        }
      }
    } else if (id === 'slow') {
      for (const t of game.unitsNear(u.x, u.z, ab.range!)) {
        if (t.dead || t.isBuilding || !game.isEnemy(u.owner, t.owner) || t.hasBuff('slow') || !t.targetableBy(u)) continue;
        if (t.def.invulnerable || t.spellImmune) continue;
        if ((u.owner.isHuman || game.isAlliedToHuman(u.owner)) && !game.fog.isVisible(t.x, t.z)) continue;
        target = t;
        break;
      }
    }
    if (target) {
      const resume = u.order.type === 'idle' ? null : u.order;
      u.order = { type: 'cast', ability: id, target };
      if (resume) u.orderQueue.unshift(resume);
      return true;
    }
  }
  return false;
}

function doPickup(game: Game, u: Unit, o: OrderOf<'pickup'>, dt: number): void {
  const it = o.item;
  if (!it || it.taken) {
    finishOrder(game, u);
    return;
  }
  const r = moveToward(game, u, it.x, it.z, 0.9, dt);
  if (r === 'arrived') {
    game.pickupItem(u, it);
    finishOrder(game, u);
  } else if (r === 'blocked') finishOrder(game, u);
}
