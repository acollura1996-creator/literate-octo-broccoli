// Headless run of the simulation: no renderer, no engine, no browser. Four computer generals play
// a seeded game and the tool prints a hash of the whole world state every game minute, so two runs
// (or two versions of the code) can be compared exactly.
//
//   npm run sim                      15 minutes, seed 12345
//   npm run sim -- --minutes 30 --seed 777 --hero
//
// --hero makes the first general a Mountain King (allied with two others) instead of an empire.
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const minutes = Number(opt('minutes', 15));
const seed = Number(opt('seed', 12345)) >>> 0;
const heroStart = args.includes('--hero');

// The terrain paints its ground texture on a canvas once; a stand-in is enough here.
const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

// Seeded Math.random (mulberry32), so the run is repeatable.
let a = seed;
Math.random = () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { Game } = await import('../src/game/game.ts');
const { GeneralAI } = await import('../src/ai/general.ts');

const options = heroStart
  ? {
      mode: 'hero', heroId: 'mountainking', difficulty: 'easy',
      rivals: [
        { mode: 'empire', hero: 'random', team: 'ally' },
        { mode: 'empire', hero: 'random', team: 'rival' },
        { mode: 'hero', hero: 'ranger', team: 'ally' },
      ],
    }
  : {
      mode: 'empire', difficulty: 'hard',
      rivals: [
        { mode: 'empire', hero: 'random', team: 'rival' },
        { mode: 'hero', hero: 'random', team: 'rival' },
        { mode: 'hero', hero: 'random', team: 'ally' },
      ],
    };
const game = new Game(options, {});
game.setup();
game.human.ai = new GeneralAI(game, game.human); // the "player" is a computer general too

const t0 = Date.now();
const STEPS_PER_MINUTE = 60 * 30;
for (let step = 1; step <= minutes * STEPS_PER_MINUTE; step++) {
  game.update(1 / 30);
  if (step % STEPS_PER_MINUTE) continue;
  const h = createHash('sha256');
  for (const u of game.units) {
    h.update(`${u.id}|${u.type}|${u.owner.index}|${u.x.toFixed(4)}|${u.z.toFixed(4)}|${u.hp.toFixed(3)}|${u.dead}|${u.order.type};`);
  }
  for (const p of game.players) {
    h.update(`${p.index}|${p.gold.toFixed(3)}|${p.lumber.toFixed(3)}|${p.tier}|${(p.citizens ?? 0).toFixed(3)}|${p.defeated}|${p.hero?.level ?? 0};`);
  }
  h.update(Buffer.from(game.fog.explored.buffer));
  const gens = game.generals.map((p) => (p.mode === 'empire' ? `age ${p.tier}` : `hero lv ${p.hero?.level ?? 0}`)).join(', ');
  console.log(`${String(step / STEPS_PER_MINUTE).padStart(3)} min  ${h.digest('hex').slice(0, 12)}  ${String(game.units.length).padStart(4)} units  ${gens}`);
}
const end = game.over ? `game over: ${game.over.text}` : 'still playing';
console.log(`${minutes} game minutes in ${((Date.now() - t0) / 1000).toFixed(1)} s (${end})`);
