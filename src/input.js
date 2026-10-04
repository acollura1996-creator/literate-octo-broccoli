// Mouse & keyboard: selection, smart right-click orders, targeting modes,
// building placement, control groups and camera controls.
import * as THREE from 'three';
import { UNITS } from './data/units.js';
import { ABILITIES } from './game/abilities.js';
import { canCast } from './game/behavior.js';
import { createModel } from './render/models.js';
import { MAP_SIZE } from './world/layout.js';

const MAX_SELECTION = 24;

const ghostOk = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.45, depthWrite: false });

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
    if (sound && list.length) this.game.sound('select', undefined, undefined, 0.5);
  }

  pruneSelection() {
    if (this.selection.some((u) => u.dead || u.removed)) {
      const alive = this.selection.filter((u) => !u.dead && !u.removed);
      for (const u of this.selection) if (u.dead) u.selected = false;
      this.selection = alive;
      this.sortSelection();
    }
    if (this.placement && !this.selection.some((u) => u.def.worker && u.owner === this.game.human)) this.cancelPlacement();
  }

  ownSelected() {
    return this.selection.filter((u) => !u.dead && u.owner === this.game.human);
  }

  // ------------------------------------------------------------- picking
  pickUnit(px, py) {
    const g = this.game;
    let best = null;
    let bestD = Infinity;
    const cam = this.view.cam.camera;
    const fovK = this.view.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    for (const u of g.units) {
      if (u.dead || u.removed || !u.view?.visibleNow) continue;
      const gy = g.terrain.heightAt(u.x, u.z);
      const h = u.view.height * (u.mods.scale || 1);
      const bottom = this.view.project(u.x, gy + 0.1, u.z);
      if (bottom.behind) continue;
      const top = this.view.project(u.x, gy + h, u.z);
      const depth = cam.position.distanceTo(new THREE.Vector3(u.x, gy + h / 2, u.z));
      const pr = Math.max(10, (u.isBuilding ? u.def.footprint * 0.5 : u.radius + 0.15) * (fovK / depth));
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
        return;
      }
      for (const u of movers) {
        if (u.def.worker && target.type === 'goldmine') g.issueOrder(u, { type: 'harvest', target }, shift);
        else if (u.def.worker && target.isBuilding && target.owner === g.human && target.underConstruction) {
          g.issueOrder(u, { type: 'construct', target }, shift);
        } else if (u.def.worker && u.carry && target.owner === g.human && target.def.dropOff && !target.underConstruction) {
          g.issueOrder(u, { type: 'returnRes', resume: u.harvest?.kind === 'gold' ? { type: 'harvest', target: u.harvest.mine } : u.harvest?.tree ? { type: 'harvest', target: u.harvest.tree } : null }, shift);
        } else if (target.isBuilding) {
          g.issueOrder(u, { type: 'move', point: { x: target.x, z: target.z }, range: target.radius + u.radius + 0.6 }, shift);
        } else if (target !== u) g.issueOrder(u, { type: 'follow', target }, shift);
      }
      this.flash(target, true);
      g.sound('click', undefined, undefined, 0.4);
      return;
    }
    if (item && movers.some((u) => u.isHero)) {
      const h = movers.find((u) => u.isHero && !u.isIllusion) ?? movers[0];
      g.issueOrder(h, { type: 'pickup', item }, shift);
      this.view.fx.orderMarker(item.x, item.z, 0xffee55);
      return;
    }
    if (tree && movers.some((u) => u.def.worker)) {
      for (const u of movers) {
        if (u.def.worker) g.issueOrder(u, { type: 'harvest', target: tree }, shift);
      }
      this.view.fx.orderMarker(tree.x, tree.z, 0x40ff40);
      return;
    }
    if (!ground) return;
    this.moveGroup(movers, ground.x, ground.z, 'move', shift);
    this.view.fx.orderMarker(ground.x, ground.z, 0x40ff40);
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
        break;
      case 'attack':
        if (target && g.isEnemy(g.human, target.owner)) {
          for (const u of movers) g.issueOrder(u, { type: 'attack', target }, shift);
          this.flash(target);
        } else if (ground) {
          this.moveGroup(movers.filter((u) => u.canAttack), ground.x, ground.z, 'attackMove', shift);
          this.view.fx.orderMarker(ground.x, ground.z, 0xff4040);
        }
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
    const m = createModel(def.model, g.human.color);
    const ghost = new THREE.Group();
    ghost.add(m.root);
    const fp = def.footprint;
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(fp, fp, fp, fp), ghostOk);
    tiles.rotation.x = -Math.PI / 2;
    tiles.position.y = 0.12;
    ghost.add(tiles);
    const meshes = [];
    m.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    this.view.scene.add(ghost);
    this.placement = { type, ghost, tiles, meshes, ok: false, x: 0, z: 0 };
    this.cardMenu = null;
  }

  cancelPlacement() {
    if (!this.placement) return;
    this.placement.ghost.removeFromParent();
    this.placement.tiles.geometry.dispose();
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
    pl.ghost.position.set(x, g.terrain.heightAt(x, z), z);
    const m = pl.ok ? ghostOk : ghostBad;
    pl.tiles.material = m;
    for (const mesh of pl.meshes) mesh.material = m;
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
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cam = this.view.cam;
      cam.distance = Math.max(cam.minDist, Math.min(cam.maxDist, cam.distance + Math.sign(e.deltaY) * 2.5));
    }, { passive: false });
    c.addEventListener('mouseleave', () => (this.mouse.inside = false));
    c.addEventListener('mouseenter', () => (this.mouse.inside = true));
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

  localXY(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    const { x, y } = this.localXY(e);
    if (e.button === 1) {
      e.preventDefault();
      this.panDrag = { x, y, tx: this.view.cam.target.x, tz: this.view.cam.target.z };
      return;
    }
    const ground = this.view.screenToGround(x, y);
    const target = this.pickUnit(x, y);
    if (e.button === 2) {
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
    if (this.panDrag) {
      const k = this.view.cam.distance / 260;
      this.view.cam.setTarget(this.panDrag.tx - (x - this.panDrag.x) * k, this.panDrag.tz - (y - this.panDrag.y) * k * 1.3);
    }
    if (this.drag) {
      this.drag.x1 = x;
      this.drag.y1 = y;
      if (Math.abs(this.drag.x1 - this.drag.x0) > 5 || Math.abs(this.drag.y1 - this.drag.y0) > 5) this.dragRect = this.drag;
    }
  }

  onMouseUp(e) {
    if (e.button === 1) this.panDrag = null;
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
      if (this.placement) this.cancelPlacement();
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
        btn.onClick();
        this.game.sound('click', undefined, undefined, 0.4);
      } else g.sound('error');
    }
  }

  centerOn(x, z) {
    this.view.cam.setTarget(x, z + this.view.cam.distance * 0.12);
  }

  // ---------------------------------------------------------- per frame
  update(dt) {
    this.pruneSelection();
    const cam = this.view.cam;
    const speed = cam.distance * 1.15 * dt;
    let dx = 0;
    let dz = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('ArrowDown')) dz += 1;
    if (this.mouse.inside && !this.drag && document.hasFocus()) {
      const m = 6;
      if (this.mouse.x <= m) dx -= 1;
      if (this.mouse.x >= this.view.width - m) dx += 1;
      if (this.mouse.y <= m) dz -= 1;
      if (this.mouse.y >= this.view.height - m) dz += 1;
    }
    if (dx || dz) cam.setTarget(cam.target.x + dx * speed, cam.target.z + dz * speed);

    // Hover
    const h = this.mouse.inside && !this.drag ? this.pickUnit(this.mouse.x, this.mouse.y) : null;
    if (h !== this.hovered) {
      if (this.hovered?.view) this.hovered.view.hovered = false;
      if (h?.view) h.view.hovered = true;
      this.hovered = h;
    }
    this.updatePlacement();
  }
}
