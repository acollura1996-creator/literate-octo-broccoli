// The minimap: terrain, fog of war, unit dots, icons for the neutral buildings, quest markers,
// camera frustum and pings.
import { MAP_SIZE } from '../world/layout.ts';
import type { Unit } from '../game/unit.ts';
import type { Game } from '../game/game.ts';
import type { Input } from '../input.ts';
import type { BabylonView } from '../babylon/BabylonView.ts';

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  game: Game;
  readonly view: BabylonView;
  readonly input: Input;
  /** Canvas size in pixels (square). */
  readonly size: number;
  private timer: number;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImg: ImageData;
  /** Terrain and water, drawn once per game. */
  private bg!: HTMLCanvasElement;
  private treeLayer!: HTMLCanvasElement;
  private treeCount = 0;

  constructor(canvas: HTMLCanvasElement, game: Game, view: BabylonView, input: Input) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.game = game;
    this.view = view;
    this.input = input;
    this.size = canvas.width;
    this.timer = 0;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = MAP_SIZE;
    this.fogCanvas.height = MAP_SIZE;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(MAP_SIZE, MAP_SIZE);
    this.bindEvents();
    this.attach(game);
  }

  attach(game: Game): void {
    this.game = game;
    this.timer = 0;
    this.buildBackground();
  }

  buildBackground(): void {
    const S = this.size;
    const bg = document.createElement('canvas');
    bg.width = S;
    bg.height = S;
    const c = bg.getContext('2d')!;
    c.drawImage(this.game.terrain.textureCanvas!, 0, 0, S, S);
    // Darken a touch and add the water.
    const k = S / MAP_SIZE;
    const t = this.game.terrain;
    for (let z = 0; z < MAP_SIZE; z++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const h = t.heightAt(x + 0.5, z + 0.5);
        if (h < -0.35) {
          c.fillStyle = h < -0.75 ? '#1d4a6e' : '#3a7392';
          c.fillRect(x * k, z * k, k + 0.5, k + 0.5);
        }
      }
    }
    this.bg = bg;
    this.treeLayer = document.createElement('canvas');
    this.treeLayer.width = S;
    this.treeLayer.height = S;
    this.drawTrees();
  }

  drawTrees(): void {
    const S = this.size;
    const k = S / MAP_SIZE;
    const c = this.treeLayer.getContext('2d')!;
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#1f4a17';
    for (const tr of this.game.terrain.trees) {
      if (!tr.alive) continue;
      c.fillRect(tr.cx * k, tr.cz * k, k + 0.3, k + 0.3);
    }
    this.treeCount = this.game.terrain.trees.filter((t) => t.alive).length;
  }

  /** A small icon for a neutral building: what it offers at a glance. */
  drawIcon(u: Unit, x: number, z: number): void {
    const ctx = this.ctx;
    const d = u.def;
    const dot = (fill: string, r = 3.2): void => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    const glyph = (t: string, color = '#000'): void => {
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(t, x, z + 0.5);
      ctx.textBaseline = 'alphabetic';
    };
    if (d.walkable) {
      // Waygate: a blue ring.
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, z, 3.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#6ad8ff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else if (d.fountain) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 3.5, z - 1.5, 7, 3);
      ctx.fillRect(x - 1.5, z - 3.5, 3, 7);
      ctx.fillStyle = d.fountain === 'health' ? '#5aff6a' : '#6a9aff';
      ctx.fillRect(x - 2.5, z - 0.75, 5, 1.5);
      ctx.fillRect(x - 0.75, z - 2.5, 1.5, 5);
    } else if (d.shrine) {
      ctx.fillStyle = (u.readyAt ?? 0) > this.game.time ? '#8a7a4a' : '#ffe680';
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(x, z - 3.5);
      ctx.lineTo(x + 2.5, z);
      ctx.lineTo(x, z + 3.5);
      ctx.lineTo(x - 2.5, z);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (d.tavern) {
      dot('#ff9a3a');
      glyph('T');
    } else if (d.mercenaries) {
      dot('#d8483a');
      glyph('M', '#fff');
    } else if (d.shop) {
      dot(d.shop === 'vault' ? '#b48aff' : d.shop === 'lab' ? '#8aff6a' : d.shop === 'market' ? '#ffd08a' : '#ffe24a');
      glyph('$');
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 2, z - 2, 4, 4);
      ctx.fillStyle = '#c8c0b0';
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
  }

  toWorld(e: MouseEvent): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * MAP_SIZE;
    const z = ((e.clientY - r.top) / r.height) * MAP_SIZE;
    return { x: Math.max(0, Math.min(MAP_SIZE, x)), z: Math.max(0, Math.min(MAP_SIZE, z)) };
  }

  bindEvents(): void {
    let dragging = false;
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = this.toWorld(e);
      if (e.button === 0) {
        if (this.input.targetMode) {
          this.input.executeTargetAt(p, null, e.shiftKey);
          return;
        }
        dragging = true;
        this.view.cam.setTarget(p.x, p.z + 6);
      } else if (e.button === 2) {
        this.input.smartOrderAt(p, null, e.shiftKey);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const p = this.toWorld(e);
      this.view.cam.setTarget(p.x, p.z + 6);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const g = this.game;
    const ctx = this.ctx;
    const S = this.size;
    const k = S / MAP_SIZE;
    if (g.frame % 60 === 0) {
      const alive = g.terrain.trees.reduce((s, t) => s + (t.alive ? 1 : 0), 0);
      if (alive !== this.treeCount) this.drawTrees();
    }
    ctx.drawImage(this.bg, 0, 0);
    ctx.drawImage(this.treeLayer, 0, 0);

    // Units
    for (const u of g.units) {
      if (u.dead || u.removed || !u.view?.visibleNow) continue;
      let col: string;
      if (u.owner.general) col = `#${u.owner.color.toString(16).padStart(6, '0')}`;
      else if (u.type === 'goldmine') col = '#ffd700';
      else if (u.owner === g.passive) col = '#e0e0e0';
      else if (u.owner === g.legion) col = '#7a2a2a';
      else col = '#8a8a8a';
      if (u.isBuilding && u.owner === g.passive && u.type !== 'goldmine') {
        this.drawIcon(u, u.x * k, u.z * k);
      } else if (u.isBuilding) {
        const s = Math.max(3, u.def.footprint! * k);
        ctx.fillStyle = '#000';
        ctx.fillRect(u.x * k - s / 2 - 1, u.z * k - s / 2 - 1, s + 2, s + 2);
        ctx.fillStyle = col;
        ctx.fillRect(u.x * k - s / 2, u.z * k - s / 2, s, s);
      } else {
        const s = u.isHero || u.def.boss ? 4 : 2.5;
        ctx.fillStyle = col;
        ctx.fillRect(u.x * k - s / 2, u.z * k - s / 2, s, s);
        if (u.isHero) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.strokeRect(u.x * k - s / 2 - 1, u.z * k - s / 2 - 1, s + 2, s + 2);
        }
      }
    }
    // Ground items
    ctx.fillStyle = '#ffe680';
    for (const it of g.groundItems) if (!it.taken && g.fog.isVisible(it.x, it.z)) ctx.fillRect(it.x * k - 1.5, it.z * k - 1.5, 3, 3);

    // Boss lairs the player has seen.
    for (const c of g.creepMgr.camps) {
      if (!c.boss || !g.fog.isExplored(c.at.x, c.at.z)) continue;
      const x = c.at.x * k;
      const z = c.at.z * k;
      ctx.fillStyle = c.cleared ? 'rgba(90,60,60,0.9)' : '#c8281e';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, z - 4.5);
      ctx.lineTo(x + 4.5, z);
      ctx.lineTo(x, z + 4.5);
      ctx.lineTo(x - 4.5, z);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Fog of war overlay
    const fog = g.fog;
    if (!fog.revealAll) {
      const d = this.fogImg.data;
      for (let i = 0; i < fog.visible.length; i++) {
        const o = i * 4;
        d[o] = 0;
        d[o + 1] = 0;
        d[o + 2] = 0;
        d[o + 3] = fog.visible[i] ? 0 : fog.explored[i] ? 120 : 255;
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, S, S);
    }

    // Quest markers (over the fog: the quest giver tells you where).
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of g.quests?.active ?? []) {
      const exact = q.kind === 'treasure' && q.found && q.spot;
      const at = exact ? q.spot! : q.at;
      const x = at.x * k;
      const z = at.z * k;
      if (q.radius && !exact) {
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = 'rgba(255,215,0,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, z, q.radius * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#000';
      ctx.fillText('!', x + 1, z + 1);
      ctx.fillStyle = q.kind === 'bounty' ? '#ff7a5a' : '#ffd700';
      ctx.fillText('!', x, z);
    }
    ctx.textBaseline = 'alphabetic';

    // Camera frustum
    const poly = this.view.viewPolygon();
    if (poly.length >= 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.z * k) : ctx.moveTo(p.x * k, p.z * k)));
      ctx.closePath();
      ctx.stroke();
    }

    // Pings
    for (const p of g.pings) {
      const r = 4 + (p.t % 1) * 14;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - (p.t % 1);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x * k, p.z * k, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
