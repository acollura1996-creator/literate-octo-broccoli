// Random events, as in the original map: every few minutes something happens somewhere in the
// land of Kalenden: a bountiful harvest, a plague, a bandit raid, a merchant caravan laden
// with gold, or a golden age for a happy empire.
import { CENTER, rotate } from '../world/layout.js';
import { DROP_TABLES } from '../data/items.js';
import { moodOf } from './empire.js';

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class GameEvents {
  constructor(game) {
    this.game = game;
    this.next = 240;
    this.harvestUntil = 0;
    this.goldenUntil = new Map(); // general -> time the golden age ends
    this.caravans = [];
    this.log = [];
  }

  harvestMult() {
    return this.game.time < this.harvestUntil ? 2 : 1;
  }
  incomeMult(p) {
    return (this.goldenUntil.get(p) ?? 0) > this.game.time ? 1.25 : 1;
  }

  update(dt) {
    const g = this.game;
    if (g.over) return;
    if (g.time >= this.next) {
      this.next = g.time + 200 + Math.random() * 100;
      this.fire();
    }
    // Caravans leave the map when they reach the end of their road.
    this.caravans = this.caravans.filter((c) => {
      if (c.dead) return false;
      if (c.order.type === 'idle' && !c.orderQueue.length) {
        g.kill(c, null, { expire: true });
        g.message('The merchant caravan has left the land safely.', '#cfc6a8');
        return false;
      }
      return true;
    });
  }

  empires() {
    return this.game.generals.filter((p) => !p.defeated && p.mode === 'empire');
  }

  fire() {
    const g = this.game;
    const options = ['harvest', 'bandits', 'caravan'];
    if (this.empires().some((p) => p.citizens >= 15)) options.push('plague');
    if (this.empires().some((p) => moodOf(p.happiness).income >= 1.1)) options.push('golden');
    const kind = pick(options);
    this.log.push({ kind, time: g.time });
    this[kind]();
  }

  announce(text, color = '#ffd27a') {
    this.game.message(`📜 ${text}`, color);
    this.game.sound('horn');
  }

  harvest() {
    this.harvestUntil = this.game.time + 90;
    this.announce('A bountiful harvest! Every farm in the land yields double food for 90 seconds.');
  }

  plague() {
    const g = this.game;
    const victims = this.empires().filter((p) => p.citizens >= 15);
    const p = pick(victims);
    const hardy = p.rations >= 14;
    const loss = Math.round(p.citizens * (hardy ? 0.1 : 0.2) * Math.pow(0.85, p.upgrades?.medicine ?? 0));
    p.citizens -= loss;
    p.unrest += hardy ? 6 : 15;
    if (p.isHuman) {
      this.announce(`Plague! ${loss} of your citizens have died.${hardy ? ' Your well-fed people resisted the worst of it.' : ' Generous rations help your people resist disease.'}`, '#ff8a6a');
    } else this.announce(`Plague strikes ${p.name}'s empire.`);
  }

  bandits() {
    const g = this.game;
    const targets = g.generals.filter((p) => !p.defeated && p.base);
    if (!targets.length) return;
    const p = pick(targets);
    const home = p.buildings.find((b) => !b.dead && (b.def.tier || b.def.revivesHeroes)) ?? p.buildings.find((b) => !b.dead);
    if (!home) return;
    const [tx, tz] = p.base.toCenter;
    const from = g.grid.nearestWalkable(home.x + tx * 30, home.z + tz * 30, 10);
    if (!from) return;
    const minutes = Math.max(0, g.time / 60);
    const pool = minutes < 12 ? ['gnoll', 'gnoll_archer', 'kobold'] : minutes < 25 ? ['ogre', 'forest_troll', 'gnoll_archer'] : ['ogre_lord', 'rock_golem', 'forest_troll', 'drake'];
    const n = Math.min(9, 3 + Math.floor(minutes / 5));
    for (let i = 0; i < n; i++) {
      const pos = g.grid.nearestWalkable(from.x + (Math.random() - 0.5) * 4, from.z + (Math.random() - 0.5) * 4, 10) ?? from;
      const u = g.spawnUnit(pick(pool), g.creeps, pos.x, pos.z);
      u.raider = true;
      g.creepMgr.empower?.(u);
      g.issueOrder(u, { type: 'attackMove', point: { x: home.x, z: home.z } });
    }
    if (p.isHuman || g.isAlliedToHuman(p)) g.ping(from.x, from.z, '#ff4040');
    this.announce(p.isHuman ? `Bandits! A band of ${n} raiders is marching on your base.` : `Bandits are raiding ${p.name}'s lands.`, p.isHuman ? '#ff8a6a' : '#ffd27a');
  }

  caravan() {
    const g = this.game;
    const k = Math.floor(Math.random() * 4);
    const dir = Math.random() < 0.5 ? 1 : 3;
    const start = rotate([CENTER, 8], k);
    const route = [rotate([CENTER, 40], k), rotate([CENTER, 40], (k + dir) % 4), rotate([CENTER, 8], (k + dir) % 4)];
    const pos = g.grid.nearestWalkable(start[0], start[1], 8);
    if (!pos) return;
    const w = g.spawnUnit('cargo_wagon', g.creeps, pos.x, pos.z);
    w.caravan = true;
    route.forEach(([x, z], i) => {
      const p = g.grid.nearestWalkable(x, z, 8) ?? { x, z };
      g.issueOrder(w, { type: 'move', point: p }, i > 0);
    });
    w.onDeath = (killer) => {
      if (killer?.owner?.general) g.dropItem(w.x, w.z, pick(DROP_TABLES[3]));
    };
    this.caravans.push(w);
    g.ping(pos.x, pos.z, '#ffd700');
    this.announce('A merchant caravan laden with gold is crossing the land. Whoever stops it keeps the treasure!');
  }

  golden() {
    const g = this.game;
    const happy = this.empires().filter((p) => moodOf(p.happiness).income >= 1.1);
    const p = pick(happy);
    this.goldenUntil.set(p, g.time + 120);
    if (p.isHuman) this.announce('A golden age! Your happy people pay 25% more taxes for 2 minutes.', '#9fe89f');
    else this.announce(`${p.name}'s empire enters a golden age.`);
  }
}
