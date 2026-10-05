// Mouse & keyboard: selection, smart right-click orders, targeting modes,
// building placement, control groups and camera controls.
import { UNITS, ROAD } from './data/units.js';
import { Roads } from './game/roads.js';
import { ABILITIES } from './game/abilities.js';
import { canCast } from './game/behavior.js';

const MAX_SELECTION = 24;

const MAX_LINE = 160;

export class Input {
  constructor(game, view, canvas) {
    this.game = game;
    this.view = view;
    this.canvas = canvas;
    this.selection = [];
    this.activeType = null;
    this.cardMenu = null;
    this.targetMode = null;
    this.groups = {};
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null;
    this.dragRect = null;
    this.altDown = false;
    this.lastClick = { time: 0, unit: null };
    this.lastGroupKey = { key: null, time: 0 };
    this.hovered = null;
    this.placement = null;
    this.buttons = []; // current command-card buttons (set by the HUD)
    this.enabled = true;
    this.settings = { scrollSpeed: 1, wheelMode: 'auto', edgeScroll: true };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem('he3d-camera') || '{}'));
    } catch {
      // Storage unavailable: keep the defaults.
    }
    this.bind();
  }

  // ------------------------------------------------------------ selection
  activeUnit() {
    const sel = this.selection.filter((u) => !u.dead);
    if (!sel.length) return null;
    if (this.activeType) {
      const a = sel.find((u) => u.type === this.activeType);
      if (a) return a;
    }
    return sel[0];
  }

  sortSelection() {
    const rank = (u) => (u.isHero ? 0 : u.isBuilding ? 3 : u.def.worker ? 2 : 1);
    this.selection.sort((a, b) => rank(a) - rank(b) || UNITS[b.type].level - UNITS[a.type].level || a.id - b.id);
    if (!this.selection.some((u) => u.type === this.activeType)) this.activeType = this.selection[0]?.type ?? null;
  }

  setSelection(list, sound = true) {
    for (const u of this.selection) u.selected = false;
    this.selection = list.slice(0, MAX_SELECTION);
    for (const u of this.selection) u.selected = true;
    this.activeType = null;
    this.cardMenu = null;
    this.sortSelection();
    if (sound && list.length) {
      this.game.sound('select', undefined, undefined, 0.5);
      this.barkFor('select');
    }
  }

  /** The lead unit of the selection acknowledges, Warcraft III style ('select' | 'move' | 'attack'). */
  barkFor(kind) {
    const u = this.selection.find((s) => s.owner === this.game.human && !s.isBuilding && !s.dead);
    if (u) this.onBark?.(u, kind);
  }

  pruneSelection() {
    if (this.selection.some((u) => u.dead || u.removed)) {
      const alive = this.selection.filter((u) => !u.dead && !u.removed);
      for (const u of this.selection) if (u.dead) u.selected = false;
      this.selection = alive;
      this.sortSelection();
    }
    const hasWorker = this.selection.some((u) => u.def.worker && u.owner === this.game.human);
    if (this.placement && !hasWorker) this.cancelPlacement();
    if (this.linePlan && !hasWorker) this.cancelLine();
  }

  ownSelected() {
    return this.selection.filter((u) => !u.dead && u.owner === this.game.human);
  }

  // ------------------------------------------------------------- picking
  pickUnit(px, py) {
    const g = this.game;
    let best = null;
    let bestD = Infinity;
    for (const u of g.units) {
      if (u.dead || u.removed || !u.view?.visibleNow) continue;
      const gy = g.terrain.heightAt(u.x, u.z);
      const h = u.view.height * (u.mods.scale || 1);
      const bottom = this.view.project(u.x, gy + 0.1, u.z);
      if (bottom.behind) continue;
      const top = this.view.project(u.x, gy + h, u.z);
      const pr = Math.max(10, (u.isBuilding ? u.def.footprint * 0.5 : u.radius + 0.15) * this.view.pixelsPerUnit(u.x, gy + h / 2, u.z));
      // Distance from mouse to the vertical segment.
      const vx = top.x - bottom.x;
      const vy = top.y - bottom.y;
      const len2 = vx * vx + vy * vy || 1;
      let t = ((px - bottom.x) * vx + (py - bottom.y) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = bottom.x + vx * t;
      const cy = bottom.y + vy * t;
      const d = Math.hypot(px - cx, py - cy);
      if (d < pr && d - (u.isBuilding ? 0 : 6) < bestD) {
        bestD = d - (u.isBuilding ? 0 : 6);
        best = u;
      }
    }
    return best;
  }

  pickTree(px, py, ground) {
    if (!ground) return null;
    const t = this.game.terrain;
    let best = null;
    let bd = 26;
    const cx = Math.floor(ground.x);
    const cz = Math.floor(ground.z);
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const tr = t.treeAtCell(cx + dx, cz + dz);
        if (!tr || !this.game.fog.isExplored(tr.x, tr.z)) continue;
        const p = this.view.project(tr.x, t.heightAt(tr.x, tr.z) + 1.4 * tr.scale, tr.z);
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bd) {
          bd = d;
          best = tr;
        }
      }
    }
    return best;
  }

  pickItem(ground) {
    if (!ground) return null;
    return this.game.groundItems.find((it) => !it.taken && Math.hypot(it.x - ground.x, it.z - ground.z) < 0.9 && this.game.fog.isVisible(it.x, it.z)) ?? null;
  }

  // -------------------------------------------------------------- orders
  orderAll(order, shift = false) {
    const units = this.ownSelected().filter((u) => !u.isBuilding);
    for (const u of units) this.game.issueOrder(u, { ...order }, shift);
    if (order.type === 'idle') for (const u of units) u.orderQueue = [];
  }

  formationPoints(units, x, z) {
    const n = units.length;
    if (n <= 1) return [{ x, z }];
    const cols = Math.ceil(Math.sqrt(n));
    const spacing = 1.15;
    // Center of mass → direction of travel.
    let mx = 0;
    let mz = 0;
    for (const u of units) {
      mx += u.x;
      mz += u.z;
    }
    mx /= n;
    mz /= n;
    let dx = x - mx;
    let dz = z - mz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const px = -dz;
    const pz = dx;
    const slots = [];
    // Melee in front, ranged behind.
    const sorted = [...units].sort((a, b) => (a.def.projectile ? 1 : 0) - (b.def.projectile ? 1 : 0) || a.id - b.id);
    const rows = Math.ceil(n / cols);
    sorted.forEach((u, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const off = (c - (inRow - 1) / 2) * spacing;
      const back = (r - (rows - 1) / 2) * spacing;
      let sx = x + px * off - dx * back;
      let sz = z + pz * off - dz * back;
      const w = this.game.grid.nearestWalkable(sx, sz, 4);
      if (w) {
        sx = w.x;
        sz = w.z;
      }
      slots.push({ u, x: sx, z: sz });
    });
    return slots;
  }

  moveGroup(units, x, z, type, shift) {
    const slots = this.formationPoints(units, x, z);
    if (units.length === 1) {
      this.game.issueOrder(units[0], { type, point: { x, z } }, shift);
      return;
    }
    for (const s of slots) this.game.issueOrder(s.u, { type, point: { x: s.x, z: s.z } }, shift);
  }

  /** Right-click on the world (or minimap). */
  smartOrderAt(ground, target, shift = false, px = null, py = null) {
    const g = this.game;
    const own = this.ownSelected();
    if (!own.length) return;
    // Buildings: set rally point.
    const movers = own.filter((u) => !u.isBuilding);
    if (!movers.length) {
      const trainers = own.filter((u) => u.def.trains);
      for (const b of trainers) b.rally = target ? { x: target.x, z: target.z, target } : ground ? { x: ground.x, z: ground.z } : null;
      if (ground) this.view.fx.orderMarker(ground.x, ground.z, 0xffee55);
      return;
    }
    const tree = !target && px !== null ? this.pickTree(px, py, ground) : null;
    const item = !target && ground ? this.pickItem(ground) : null;

    if (target) {
      const enemy = g.isEnemy(g.human, target.owner);
      if (enemy && target.targetableBy(movers[0])) {
        for (const u of movers) {
          if (u.canAttack) g.issueOrder(u, { type: 'attack', target }, shift);
          else g.issueOrder(u, { type: 'move', point: { x: target.x, z: target.z }, range: 2 }, shift);
        }
        this.flash(target);
        g.sound('click', undefined, undefined, 0.4);
        this.barkFor('attack');
        return;
      }
      for (const u of movers) {
        if (u.def.worker && target.type === 'goldmine') g.issueOrder(u, { type: 'harvest', target }, shift);
        else if (u.def.worker && target.isBuilding && target.owner === g.human && target.underConstruction) {
          g.issueOrder(u, { type: 'construct', target }, shift);
        } else if (u.def.worker && u.carry && target.owner === g.human && (target.def.dropOff === true || target.def.dropOff === u.carry.kind) && !target.underConstruction) {
          g.issueOrder(u, { type: 'returnRes', resume: u.harvest?.kind === 'gold' ? { type: 'harvest', target: u.harvest.mine } : u.harvest?.tree ? { type: 'harvest', target: u.harvest.tree } : null }, shift);
        } else if (target.isBuilding) {
          g.issueOrder(u, { type: 'move', point: { x: target.x, z: target.z }, range: target.radius + u.radius + 0.6 }, shift);
        } else if (target !== u) g.issueOrder(u, { type: 'follow', target }, shift);
      }
      this.flash(target, true);
      g.sound('click', undefined, undefined, 0.4);
      this.barkFor('move');
      return;
    }
    if (item && movers.some((u) => u.isHero)) {
      const h = movers.find((u) => u.isHero && !u.isIllusion) ?? movers[0];
      g.issueOrder(h, { type: 'pickup', item }, shift);
      this.view.fx.orderMarker(item.x, item.z, 0xffee55);
      this.barkFor('move');
      return;
    }
    if (tree && movers.some((u) => u.def.worker)) {
      for (const u of movers) {
        if (u.def.worker) g.issueOrder(u, { type: 'harvest', target: tree }, shift);
      }
      this.flashTree(tree);
      this.barkFor('move');
      return;
    }
    if (!ground) return;
    this.moveGroup(movers, ground.x, ground.z, 'move', shift);
    this.view.fx.orderMarker(ground.x, ground.z, 0x40ff40);
    this.barkFor('move');
  }

  /** Show clearly which tree was chosen for harvesting. */
  flashTree(tree) {
    this.treeFlash = { tree, until: performance.now() + 1100 };
    this.view.fx.ring(tree.x, tree.z, 0x40ff40, 1.6, 0.5, 0.5);
    this.view.fx.orderMarker(tree.x, tree.z, 0x40ff40);
    this.game.sound('click', undefined, undefined, 0.4);
  }

  flash(target, friendly = false) {
    if (!target.view) return;
    target.view.flashUntil = this.game.time + 0.6;
    this.view.fx.ring(target.x, target.z, friendly ? 0x40ff40 : 0xff4040, (target.isBuilding ? target.def.footprint * 0.6 : target.radius * 1.5) + 0.2, 0.45, target.radius);
  }

  orderWorkersReturn() {
    for (const u of this.ownSelected()) {
      if (u.def.worker && u.carry) {
        const resume = u.harvest?.kind === 'gold' ? { type: 'harvest', target: u.harvest.mine } : u.harvest?.tree ? { type: 'harvest', target: u.harvest.tree } : null;
        this.game.issueOrder(u, { type: 'returnRes', resume });
      }
    }
  }

  // ---------------------------------------------------------- targeting
  beginTarget(mode) {
    this.targetMode = mode;
    this.canvas.style.cursor = 'crosshair';
  }

  cancelTarget() {
    this.targetMode = null;
    this.canvas.style.cursor = '';
  }

  useAbility(u, id) {
    const g = this.game;
    const ab = ABILITIES[id];
    if (!canCast(g, u, id, false)) {
      g.sound('error');
      return;
    }
    if (ab.target === 'none') {
      g.issueOrder(u, { type: 'cast', ability: id });
      return;
    }
    this.beginTarget({ kind: 'cast', ability: id, caster: u });
  }

  executeTargetAt(ground, target, shift, px = null, py = null) {
    const g = this.game;
    const m = this.targetMode;
    if (!m) return;
    const own = this.ownSelected();
    const movers = own.filter((u) => !u.isBuilding);
    switch (m.kind) {
      case 'move':
        if (target && target !== movers[0]) for (const u of movers) g.issueOrder(u, { type: 'follow', target }, shift);
        else if (ground) {
          this.moveGroup(movers, ground.x, ground.z, 'move', shift);
          this.view.fx.orderMarker(ground.x, ground.z, 0x40ff40);
        }
        this.barkFor('move');
        break;
      case 'attack':
        if (target && g.isEnemy(g.human, target.owner)) {
          for (const u of movers) g.issueOrder(u, { type: 'attack', target }, shift);
          this.flash(target);
        } else if (ground) {
          this.moveGroup(movers.filter((u) => u.canAttack), ground.x, ground.z, 'attackMove', shift);
          this.view.fx.orderMarker(ground.x, ground.z, 0xff4040);
        }
        this.barkFor('attack');
        break;
      case 'patrol':
        if (ground) {
          for (const u of movers) g.issueOrder(u, { type: 'patrol', point: { x: ground.x, z: ground.z } }, shift);
          this.view.fx.orderMarker(ground.x, ground.z, 0xffee55);
        }
        break;
      case 'gather': {
        const tree = !target && px !== null ? this.pickTree(px, py, ground) : null;
        const res = target?.type === 'goldmine' ? target : tree;
        if (!res) {
          g.message('Must target a Gold Mine or trees.', '#ff8080');
          g.sound('error');
          return;
        }
        for (const u of movers) if (u.def.worker) g.issueOrder(u, { type: 'harvest', target: res }, shift);
        if (tree) this.flashTree(tree);
        else this.flash(res, true);
        break;
      }
      case 'nuke': {
        if (!ground || m.silo.dead || !m.silo.nukeReady) break;
        if (!g.fog.isExplored(ground.x, ground.z)) {
          g.message('You can only target explored land.', '#ff8080');
          g.sound('error');
          return;
        }
        g.empires.launchNuke(m.silo, ground.x, ground.z);
        break;
      }
      case 'rally': {
        const tree = !target && px !== null ? this.pickTree(px, py, ground) : null;
        for (const b of own.filter((u) => u.def.trains)) {
          if (target) b.rally = { x: target.x, z: target.z, target };
          else if (tree) b.rally = { x: tree.x, z: tree.z, target: tree };
          else if (ground) b.rally = { x: ground.x, z: ground.z };
        }
        if (ground) this.view.fx.orderMarker(ground.x, ground.z, 0xffee55);
        break;
      }
      case 'cast': {
        const ab = ABILITIES[m.ability];
        const caster = m.caster;
        if (caster.dead) break;
        if (ab.target === 'unit') {
          if (!target) {
            g.message('Must target a unit.', '#ff8080');
            g.sound('error');
            return;
          }
          const enemy = g.isEnemy(caster.owner, target.owner);
          const ok =
            (ab.filter === 'enemy' && enemy) ||
            (ab.filter === 'ally' && !enemy && !target.isBuilding) ||
            (ab.filter === 'allyOrUndead' && ((!enemy && !target.isBuilding) || (enemy && target.def.undead))) ||
            ab.filter === 'any';
          if (!ok || target.def.invulnerable) {
            g.message(ab.filter === 'enemy' ? 'Must target an enemy unit.' : ab.filter === 'allyOrUndead' ? 'Must target a friendly unit or an undead enemy.' : 'Must target a friendly unit.', '#ff8080');
            g.sound('error');
            return;
          }
          g.issueOrder(caster, { type: 'cast', ability: m.ability, target }, shift);
          this.flash(target, !enemy);
        } else if (ab.target === 'point') {
          const pt = target ? { x: target.x, z: target.z } : ground;
          if (!pt) return;
          g.issueOrder(caster, { type: 'cast', ability: m.ability, point: pt }, shift);
          this.view.fx.ring(pt.x, pt.z, 0x9fd8ff, ab.aoe ?? 2, 0.4, (ab.aoe ?? 2) * 0.9, 0.5);
        }
        break;
      }
      default:
    }
    if (!shift || m.kind === 'cast') this.cancelTarget();
  }

  // ---------------------------------------------------------- placement
  beginPlacement(type) {
    const g = this.game;
    const def = UNITS[type];
    if (g.missingRequirements(g.human, def).length) return;
    if (!g.canAfford(g.human, def.cost)) {
      g.spend(g.human, def.cost); // shows the message
      return;
    }
    this.cancelPlacement();
    this.cancelLine();
    this.view.previews.beginPlacement(def.ageModels?.[Math.max(1, g.human.tier) - 1] ?? def.model, g.human.color, def.footprint);
    this.placement = { type, ok: false, x: 0, z: 0 };
    this.cardMenu = null;
  }

  cancelPlacement() {
    if (!this.placement) return;
    this.view.previews.endPlacement();
    this.placement = null;
  }

  updatePlacement() {
    const pl = this.placement;
    if (!pl) return;
    const ground = this.view.screenToGround(this.mouse.x, this.mouse.y);
    if (!ground) return;
    const g = this.game;
    const fp = UNITS[pl.type].footprint;
    const x = g.snap(ground.x, fp);
    const z = g.snap(ground.z, fp);
    pl.x = x;
    pl.z = z;
    pl.ok = g.canPlace(pl.type, x, z, g.human);
    this.view.previews.updatePlacement(x, g.terrain.heightAt(x, z), z, pl.ok);
  }

  confirmPlacement(shift) {
    const g = this.game;
    const pl = this.placement;
    if (!pl) return;
    if (!pl.ok) {
      g.message('Unable to build there.', '#ff8080');
      g.sound('error');
      return;
    }
    const workers = this.ownSelected().filter((u) => u.def.worker);
    if (!workers.length) return;
    const builder = workers.sort((a, b) => Math.hypot(a.x - pl.x, a.z - pl.z) - Math.hypot(b.x - pl.x, b.z - pl.z))[0];
    const def = UNITS[pl.type];
    if (!g.spend(g.human, def.cost)) return;
    g.issueOrder(builder, { type: 'build', building: pl.type, x: pl.x, z: pl.z, paid: true }, shift && builder.order.type !== 'idle');
    this.view.fx.orderMarker(pl.x, pl.z, 0x40ff40);
    if (!shift || !g.canAfford(g.human, def.cost)) this.cancelPlacement();
  }

  // ------------------------------------------------------- road / wall lines
  beginLine(kind) {
    this.cancelPlacement();
    this.cancelLine();
    this.cancelTarget();
    this.view.previews.beginLine(MAX_LINE);
    this.linePlan = { kind, start: null, cells: [], ok: [] };
    this.cardMenu = null;
  }

  cancelLine() {
    if (!this.linePlan) return;
    this.view.previews.endLine();
    this.linePlan = null;
  }

  lineCellOk(kind, cx, cz) {
    const g = this.game;
    if (kind === 'road') return g.roads.canPlace(cx, cz, g.human);
    return g.canPlace('wall', cx + 0.5, cz + 0.5, g.human);
  }

  updateLine() {
    const lp = this.linePlan;
    if (!lp) return;
    const ground = this.view.screenToGround(this.mouse.x, this.mouse.y);
    if (!ground) return;
    const cur = [Math.floor(ground.x), Math.floor(ground.z)];
    let cells = lp.start ? Roads.line(lp.start[0], lp.start[1], cur[0], cur[1]) : [cur];
    if (cells.length > MAX_LINE) cells = cells.slice(0, MAX_LINE);
    lp.cells = cells;
    lp.ok = cells.map(([cx, cz]) => this.lineCellOk(lp.kind, cx, cz));
    const centres = cells.map(([cx, cz]) => [cx + 0.5, this.game.terrain.heightAt(cx + 0.5, cz + 0.5) + 0.02, cz + 0.5]);
    this.view.previews.updateLine(centres, lp.ok, lp.kind === 'wall' ? 1.4 : 0.08);
  }

  lineSummary() {
    const lp = this.linePlan;
    const n = lp.ok.filter(Boolean).length;
    if (lp.kind === 'road') {
      return lp.start ? `Road: ${n} tile${n === 1 ? '' : 's'} · ${n * ROAD.cost.gold} gold` : 'Lay road: click and drag';
    }
    const c = UNITS.wall.cost;
    return lp.start ? `Wall: ${n} piece${n === 1 ? '' : 's'} · ${n * c.gold} gold, ${n * c.lumber} lumber` : 'Build wall: click and drag';
  }

  confirmLine(shift) {
    const g = this.game;
    const lp = this.linePlan;
    const cells = lp.cells.filter((_, i) => lp.ok[i]);
    lp.start = null;
    if (!cells.length) {
      g.message(lp.kind === 'road' ? "Can't lay a road there." : "Can't build a wall there.", '#ff8080');
      g.sound('error');
      return;
    }
    if (lp.kind === 'road') {
      const n = g.roads.place(cells, g.human);
      if (n > 0) {
        g.sound('build', undefined, undefined, 0.6);
        if (n < cells.length) g.message(`Laid ${n} of ${cells.length} road tiles: not enough gold.`, '#ffb070');
      }
    } else {
      const workers = this.ownSelected().filter((u) => u.def.worker);
      if (!workers.length) return;
      const plan = [];
      for (const c of cells) {
        if (!g.canAfford(g.human, UNITS.wall.cost)) break;
        g.spend(g.human, UNITS.wall.cost);
        plan.push(c);
      }
      if (!plan.length) {
        g.spend(g.human, UNITS.wall.cost); // explains what is missing
      } else {
        if (plan.length < cells.length) g.message(`Planned ${plan.length} of ${cells.length} wall pieces: not enough resources.`, '#ffb070');
        // Split the line into contiguous stretches, one per Peasant (nearest stretch first).
        const per = Math.ceil(plan.length / workers.length);
        const chunks = [];
        for (let i = 0; i < plan.length; i += per) chunks.push(plan.slice(i, i + per));
        const free = [...workers];
        for (const chunk of chunks) {
          const [fx, fz] = chunk[0];
          free.sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz));
          const w = free.shift();
          chunk.forEach(([cx, cz], i) => {
            g.issueOrder(w, { type: 'build', building: 'wall', x: cx + 0.5, z: cz + 0.5, paid: true }, i > 0 || (shift && w.order.type !== 'idle'));
          });
        }
        g.sound('build', undefined, undefined, 0.6);
      }
    }
    if (!shift) this.cancelLine();
  }

  cancelConstruction(b) {
    const g = this.game;
    if (!b.underConstruction || b.dead) return;
    const c = b.def.cost;
    g.refund(b.owner, { gold: Math.floor((c.gold || 0) * 0.75), lumber: Math.floor((c.lumber || 0) * 0.75) });
    g.kill(b, null);
  }

  // --------------------------------------------------------------- events
  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('mouseleave', () => (this.mouse.inside = false));
    c.addEventListener('mouseenter', () => (this.mouse.inside = true));
    // Edge scrolling works over the HUD too, but stops when the pointer leaves the window.
    document.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget) this.mouse.inWindow = false;
    });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.key === 'Alt') this.altDown = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.altDown = false;
    });
  }

  /**
   * Mouse wheels zoom; trackpads pan with two fingers and zoom with a pinch
   * (pinches arrive as ctrl+wheel). `wheelMode` can force either behaviour.
   */
  onWheel(e) {
    e.preventDefault();
    const cam = this.view.cam;
    const clampZoom = (v) => Math.max(cam.minDist, Math.min(cam.maxDist, v));
    const lineMode = e.deltaMode === 1;
    const looksLikeWheel = lineMode || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    const mode = this.settings.wheelMode;
    if (e.ctrlKey) {
      cam.zoomTarget = clampZoom(cam.zoomTarget * Math.exp(e.deltaY * 0.012));
    } else if (mode === 'zoom' || (mode === 'auto' && looksLikeWheel)) {
      const steps = lineMode ? e.deltaY / 3 : e.deltaY / 100;
      cam.zoomTarget = clampZoom(cam.zoomTarget + Math.sign(steps) * Math.max(1, Math.abs(steps)) * 3.5);
    } else {
      const k = (cam.distance / 700) * this.settings.scrollSpeed;
      cam.setTarget(cam.target.x + e.deltaX * k, cam.target.z + e.deltaY * k * 1.25);
    }
  }

  localXY(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    const { x, y } = this.localXY(e);
    if (e.button === 1) {
      // Grab the ground under the cursor and drag the map with it.
      e.preventDefault();
      const anchor = this.view.screenToGround(x, y);
      if (anchor) this.panDrag = { anchor };
      return;
    }
    const ground = this.view.screenToGround(x, y);
    const target = this.pickUnit(x, y);
    if (e.button === 2) {
      if (this.linePlan) {
        this.cancelLine();
        return;
      }
      if (this.placement) {
        this.cancelPlacement();
        return;
      }
      if (this.targetMode) {
        this.cancelTarget();
        return;
      }
      this.smartOrderAt(ground, target, e.shiftKey, x, y);
      return;
    }
    if (e.button !== 0) return;
    if (this.linePlan) {
      // Start dragging a road / wall line.
      if (ground) this.linePlan.start = [Math.floor(ground.x), Math.floor(ground.z)];
      return;
    }
    if (this.placement) {
      this.confirmPlacement(e.shiftKey);
      return;
    }
    if (this.targetMode) {
      this.executeTargetAt(ground, target, e.shiftKey, x, y);
      return;
    }
    this.drag = { x0: x, y0: y, x1: x, y1: y, shift: e.shiftKey, ctrl: e.ctrlKey, target };
  }

  onMouseMove(e) {
    const { x, y } = this.localXY(e);
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.inWindow = true;
    if (this.panDrag) {
      const now = this.view.screenToGround(x, y);
      if (now) {
        const cam = this.view.cam;
        cam.setTarget(cam.target.x + (this.panDrag.anchor.x - now.x), cam.target.z + (this.panDrag.anchor.z - now.z));
        cam.update(this.game.terrain);
      }
    }
    if (this.drag) {
      this.drag.x1 = x;
      this.drag.y1 = y;
      if (Math.abs(this.drag.x1 - this.drag.x0) > 5 || Math.abs(this.drag.y1 - this.drag.y0) > 5) this.dragRect = this.drag;
    }
  }

  onMouseUp(e) {
    if (e.button === 1) this.panDrag = null;
    if (e.button === 0 && this.linePlan?.start) {
      this.updateLine();
      this.confirmLine(e.shiftKey);
      return;
    }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    const g = this.game;
    if (this.dragRect) {
      this.dragRect = null;
      const x0 = Math.min(d.x0, d.x1);
      const x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      const y1 = Math.max(d.y0, d.y1);
      let picked = g.human.units.concat(g.human.buildings).filter((u) => {
        if (u.dead || !u.view?.visibleNow) return false;
        const p = this.view.project(u.x, g.terrain.heightAt(u.x, u.z) + 0.4, u.z);
        return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      });
      if (picked.some((u) => !u.isBuilding)) picked = picked.filter((u) => !u.isBuilding);
      if (!picked.length) return;
      if (d.shift) {
        const set = new Set(this.selection.filter((u) => u.owner === g.human));
        for (const u of picked) set.add(u);
        this.setSelection([...set]);
      } else this.setSelection(picked);
      return;
    }
    const u = d.target;
    if (!u) {
      if (!d.shift) this.setSelection([], false);
      return;
    }
    const now = performance.now();
    const dbl = this.lastClick.unit === u && now - this.lastClick.time < 350;
    this.lastClick = { unit: u, time: now };
    if ((dbl || d.ctrl) && u.owner === g.human) {
      // Select all of this type on screen.
      const same = g.human.units.concat(g.human.buildings).filter((o) => {
        if (o.dead || o.type !== u.type || !o.view?.visibleNow) return false;
        const p = this.view.project(o.x, g.terrain.heightAt(o.x, o.z), o.z);
        return p.x > 0 && p.y > 0 && p.x < this.view.width && p.y < this.view.height * 0.78;
      });
      this.setSelection(same);
      return;
    }
    if (d.shift && u.owner === g.human && this.selection.every((s) => s.owner === g.human)) {
      if (this.selection.includes(u)) {
        u.selected = false;
        this.selection = this.selection.filter((s) => s !== u);
        this.sortSelection();
      } else if (this.selection.length < MAX_SELECTION) {
        this.selection.push(u);
        u.selected = true;
        this.sortSelection();
      }
      return;
    }
    this.setSelection([u]);
  }

  onKeyDown(e) {
    if (!this.enabled) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const g = this.game;
    this.keys.add(e.code);
    if (e.key === 'Alt') {
      this.altDown = true;
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.linePlan) this.cancelLine();
      else if (this.placement) this.cancelPlacement();
      else if (this.targetMode) this.cancelTarget();
      else if (this.cardMenu) this.cardMenu = null;
      else {
        const btn = this.buttons.find((b) => b.hotkey === 'Escape');
        if (btn && !btn.disabled) btn.onClick();
      }
      return;
    }
    // Control groups.
    if (/^Digit[0-9]$/.test(e.code)) {
      const n = e.code.slice(5);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups[n] = this.selection.filter((u) => u.owner === g.human);
        g.message(`Control group ${n} assigned.`, '#ccc');
      } else if (this.groups[n]?.length) {
        const list = this.groups[n].filter((u) => !u.dead);
        const now = performance.now();
        if (this.lastGroupKey.key === n && now - this.lastGroupKey.time < 400 && list[0]) this.centerOn(list[0].x, list[0].z);
        this.lastGroupKey = { key: n, time: now };
        if (e.shiftKey) this.setSelection([...new Set([...this.selection, ...list])]);
        else this.setSelection(list);
      }
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      const h = g.human.hero;
      if (h && !h.dead) {
        const now = performance.now();
        if (this.selection.length === 1 && this.selection[0] === h && now - (this.lastF1 || 0) < 500) this.centerOn(h.x, h.z);
        this.lastF1 = now;
        this.setSelection([h]);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const types = [...new Set(this.selection.map((u) => u.type))];
      if (types.length > 1) {
        const i = types.indexOf(this.activeType);
        this.activeType = types[(i + 1) % types.length];
        this.cardMenu = null;
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (g.lastAlertPos) this.centerOn(g.lastAlertPos.x, g.lastAlertPos.z);
      else if (this.selection[0]) this.centerOn(this.selection[0].x, this.selection[0].z);
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      const home = g.homeOf(g.human);
      if (home) this.centerOn(home.x, home.z);
      return;
    }
    // Inventory (numpad like Warcraft III).
    const numpad = { Numpad7: 0, Numpad8: 1, Numpad4: 2, Numpad5: 3, Numpad1: 4, Numpad2: 5 };
    if (e.code in numpad) {
      this.onInventoryClick?.(numpad[e.code], e);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Command card hotkeys.
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const btn = this.buttons.find((b) => b.hotkey && b.hotkey.toUpperCase() === key);
    if (btn) {
      e.preventDefault();
      if (!btn.disabled) {
        btn.onClick(e);
        this.game.sound('click', undefined, undefined, 0.4);
      } else g.sound('error');
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('he3d-camera', JSON.stringify(this.settings));
    } catch {
      // Storage unavailable: settings last for this session only.
    }
  }

  centerOn(x, z) {
    this.view.cam.setTarget(x, z + this.view.cam.distance * 0.12);
  }

  // ---------------------------------------------------------- per frame
  update(dt) {
    this.pruneSelection();
    const cam = this.view.cam;
    // Smooth zoom.
    cam.distance += (cam.zoomTarget - cam.distance) * Math.min(1, dt * 10);
    // Desired scroll direction from the keys and the screen edges. The edge
    // zone is wide and speed ramps up toward the very edge.
    let dx = 0;
    let dz = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('ArrowDown')) dz += 1;
    if (this.settings.edgeScroll && this.mouse.inWindow && this.enabled && !this.drag && !this.panDrag && document.hasFocus()) {
      const zone = 26;
      const ramp = (d) => (d >= zone ? 0 : 0.3 + 0.7 * (1 - d / zone));
      const { x, y } = this.mouse;
      dx -= ramp(x);
      dx += ramp(this.view.width - 1 - x);
      dz -= ramp(y);
      dz += ramp(this.view.height - 1 - y);
    }
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const top = cam.distance * 1.7 * this.settings.scrollSpeed;
    const k = Math.min(1, dt * (len > 0 ? 9 : 12));
    cam.vel.x += (dx * top - cam.vel.x) * k;
    cam.vel.z += (dz * top - cam.vel.z) * k;
    if (Math.abs(cam.vel.x) > 0.01 || Math.abs(cam.vel.z) > 0.01) {
      cam.setTarget(cam.target.x + cam.vel.x * dt, cam.target.z + cam.vel.z * dt);
    }

    // Hover
    const h = this.mouse.inside && !this.drag ? this.pickUnit(this.mouse.x, this.mouse.y) : null;
    if (h !== this.hovered) {
      if (this.hovered?.view) this.hovered.view.hovered = false;
      if (h?.view) h.view.hovered = true;
      this.hovered = h;
    }
    // Trees under the cursor light up when Peasants could harvest them.
    const workers = this.ownSelected().some((u) => u.def.worker);
    const wantsTree = workers || this.targetMode?.kind === 'gather' || this.targetMode?.kind === 'rally';
    let ht = null;
    if (wantsTree && this.mouse.inside && !this.drag && !h && !this.placement && !this.linePlan) {
      ht = this.pickTree(this.mouse.x, this.mouse.y, this.view.screenToGround(this.mouse.x, this.mouse.y));
    }
    this.hoverTree = ht;
    const flash = this.treeFlash && performance.now() < this.treeFlash.until && this.treeFlash.tree.alive ? this.treeFlash.tree : null;
    if (flash) this.view.fx.highlightTree(flash, 0x40ff40);
    else if (ht) this.view.fx.highlightTree(ht, 0xffe14a);
    else this.view.fx.clearTreeHighlight();
    this.updatePlacement();
    this.updateLine();
    this.updateCursorLabel();
  }

  /** What a click would do right now, shown next to the cursor. */
  cursorText() {
    const g = this.game;
    if (this.linePlan) return this.lineSummary();
    if (this.placement) return this.placement.ok ? `Place ${UNITS[this.placement.type].name}` : g.placeReason || "Can't build here";
    const h = this.hovered;
    const tm = this.targetMode;
    if (tm) {
      switch (tm.kind) {
        case 'move':
          return h ? `Follow ${h.def.name}` : 'Move here';
        case 'attack':
          return h && g.isEnemy(g.human, h.owner) ? `Attack ${h.def.name}` : 'Attack-move here';
        case 'patrol':
          return 'Patrol to here';
        case 'gather':
          if (h?.type === 'goldmine') return 'Mine gold';
          return this.hoverTree ? 'Harvest lumber from this tree' : 'Choose a tree or gold mine';
        case 'rally':
          return this.hoverTree ? 'Rally on this tree' : h ? `Rally on ${h.def.name}` : 'Set rally point';
        case 'nuke':
          return 'Launch the nuclear missile here';
        case 'cast': {
          const ab = ABILITIES[tm.ability];
          if (ab.target === 'unit') return h ? `${ab.name}: ${h.def.name}` : `${ab.name}: choose a target`;
          return `${ab.name}: choose an area`;
        }
        default:
          return null;
      }
    }
    const own = this.ownSelected();
    const movers = own.filter((u) => !u.isBuilding);
    if (!movers.length) {
      if (own.some((u) => u.def.trains) && this.mouse.inside) return 'Right-click: set rally point';
      return null;
    }
    const workers = movers.some((u) => u.def.worker);
    if (h) {
      if (g.isEnemy(g.human, h.owner) && h.targetableBy(movers[0])) return `Attack ${h.def.name}`;
      if (workers && h.type === 'goldmine') return 'Mine gold';
      if (workers && h.owner === g.human && h.isBuilding && h.underConstruction) return 'Help build';
      if (workers && h.owner === g.human && h.def.dropOff && movers.some((u) => u.carry && (h.def.dropOff === true || h.def.dropOff === u.carry.kind))) return 'Return resources';
      if (h.def.shop && movers.some((u) => u.isHero)) return 'Go to the shop';
      if (!h.isBuilding && h.owner.general && h !== movers[0]) return `Follow ${h.def.name}`;
      return null;
    }
    if (workers && this.hoverTree) return 'Harvest lumber';
    return null;
  }

  updateCursorLabel() {
    const el = (this.cursorEl ??= document.getElementById('cursor-label'));
    if (!el) return;
    const text = this.mouse.inside && !this.drag ? this.cursorText() : null;
    if (text !== this.cursorTextShown) {
      this.cursorTextShown = text;
      el.textContent = text ?? '';
      el.classList.toggle('hidden', !text);
    }
    if (text) el.style.transform = `translate(${this.mouse.x + 18}px, ${this.mouse.y + 14}px)`;
  }
}
