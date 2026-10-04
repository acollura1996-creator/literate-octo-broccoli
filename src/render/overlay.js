// 2D overlay drawn over the 3D view: health/mana bars, floating combat
// text, the drag-selection rectangle and construction progress.

export class Overlay {
  constructor(canvas, game, view, input) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.view = view;
    this.input = input;
    this.pt = { x: 0, y: 0, behind: false };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(this.view.width * dpr);
    this.canvas.height = Math.round(this.view.height * dpr);
    this.dpr = dpr;
  }

  hpColor(r) {
    if (r > 0.66) return '#2fd12f';
    if (r > 0.33) return '#e8d22a';
    return '#e8352a';
  }

  draw() {
    const ctx = this.ctx;
    const g = this.game;
    const v = this.view;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.width, v.height);
    const showAll = this.input.altDown;
    const maxY = v.height * 0.79;

    for (const u of g.units) {
      if (u.dead || u.removed || !u.view?.visibleNow || u.def.invulnerable) continue;
      const damaged = u.hp < u.maxHp - 0.5;
      const show = showAll || u.selected || u.view.hovered || (damaged && !u.isBuilding) || u.underConstruction || (u.isHero && u.owner === g.human);
      if (!show) continue;
      const h = (u.view.height ?? 1) * (u.mods.scale || 1);
      const p = v.project(u.x, g.terrain.heightAt(u.x, u.z) + h + 0.35, u.z, this.pt);
      if (p.behind || p.x < -50 || p.y < -20 || p.x > v.width + 50 || p.y > maxY) continue;
      const scale = Math.max(0.55, Math.min(1.3, 30 / v.cam.distance));
      const w = (u.isBuilding ? 56 : u.isHero || u.def.boss ? 52 : 34) * scale;
      const bh = (u.isHero || u.def.boss ? 5 : 4) * Math.max(0.8, scale);
      const x = Math.round(p.x - w / 2);
      let y = Math.round(p.y);
      const ratio = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x - 1, y - 1, w + 2, bh + 2);
      ctx.fillStyle = this.hpColor(ratio);
      ctx.fillRect(x, y, w * ratio, bh);
      if (u.maxMana > 0 && (u.isHero || u.selected || showAll)) {
        y += bh + 1;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x - 1, y - 1, w + 2, bh - 1 + 2);
        ctx.fillStyle = '#3a7bff';
        ctx.fillRect(x, y, w * Math.max(0, u.mana / u.maxMana), bh - 1);
      }
      if (u.underConstruction) {
        y += bh + 1;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x - 1, y - 1, w + 2, 4);
        ctx.fillStyle = '#d9b44a';
        ctx.fillRect(x, y, w * u.buildProgress, 2);
      }
      if (u.isHero && (u.selected || u.view.hovered || showAll)) {
        ctx.font = `bold ${Math.round(11 * Math.max(0.8, scale))}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000';
        ctx.fillText(`${u.def.name}${u.isIllusion ? '' : ` (${u.level})`}`, p.x + 1, Math.round(p.y) - 4);
        ctx.fillStyle = u.owner === g.human ? '#ffe680' : g.isEnemy(g.human, u.owner) ? '#ff9a9a' : '#ffffff';
        ctx.fillText(`${u.def.name}${u.isIllusion ? '' : ` (${u.level})`}`, p.x, Math.round(p.y) - 5);
      }
      if (u.def.boss) {
        ctx.font = 'bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000';
        ctx.fillText('KALENDEN', p.x + 1, Math.round(p.y) - 5);
        ctx.fillStyle = '#ff6a5a';
        ctx.fillText('KALENDEN', p.x, Math.round(p.y) - 6);
      }
    }

    // Floating text
    ctx.textAlign = 'center';
    for (const f of g.floats) {
      const p = v.project(f.x, f.y + f.t * 1.4, f.z, this.pt);
      if (p.behind || p.y > maxY) continue;
      const a = Math.max(0, 1 - f.t / 1.6);
      ctx.globalAlpha = a;
      ctx.font = `bold ${Math.round(14 * f.size)}px Georgia, serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, p.x + 1, p.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    // Drag rectangle
    const d = this.input.dragRect;
    if (d) {
      const x0 = Math.min(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      ctx.strokeStyle = '#33ff33';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.fillStyle = 'rgba(51,255,51,0.06)';
      ctx.fillRect(x0, y0, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
  }
}
