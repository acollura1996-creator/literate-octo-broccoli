// The land of Kalenden: a four-fold symmetric map of 384 × 384 cells. Four generals start in the
// corners, Kalenden's walled citadel sits on a plateau in the center behind a moat that can only be
// crossed at four diagonal fords, and a ring road circles the moat.
//
// Every edge has the same three stops on its midline, from the map border inward:
//   - an outpost (gold mine, mercenary camp, arcane vault, fountains of health and mana, a goblin
//     laboratory and a waygate to the opposite outpost), guarded by drakes and a golem;
//   - a boss lair in a ring of cliffs: the Red Dragon (north), the Hydra (east), the Bandit Lord
//     (south) and the Broodmother (west);
//   - a village on the ring road (tavern, marketplace and a waygate across the citadel).
// Every quadrant has the general's base, two guarded expansion mines with lumber groves along the
// edges, a lake with murlocs and naga, old ruins with harpies, a bandit camp holding captives, a
// hill mercenary camp, and two secret glades in the forest (a shrine and a stash of tomes).
import { smoothstep } from './noise.ts';

/** A map position [x, z]. */
export type Vec2 = [number, number];

/** A general's start location (one per corner). */
export interface Base {
  slot: number;
  hall: Vec2;
  mine: Vec2;
  towers: Vec2[];
  shop: Vec2;
  /** Unit vector from the hall toward the map center. */
  toCenter: Vec2;
}
export interface CampDef {
  at: Vec2;
  tier: number;
  units: string[];
  /** Quadrant (0 NW, 1 NE, 2 SE, 3 SW) for region quests, or -1 on an edge midline. */
  region: number;
  /** A boss lair: big treasure, slow respawn. */
  boss?: boolean;
  /** Captives are caged here (a rescue quest). */
  captives?: boolean;
}
export interface NeutralDef {
  type: string;
  at: Vec2;
  /** The gold mine at a start location (it holds less gold). */
  startMine?: boolean;
  /** Gold in a mine (default 22000). */
  gold?: number;
  /** Waygates with the same link key are a pair. */
  link?: string;
  region: number;
}
/** A lake: deep (unwalkable) in the middle with a shallow, walkable rim. */
export interface Lake {
  at: Vec2;
  r: number;
}
/** A ring of cliffs around `at`, open toward `gapDir` (radians, atan2(dz, dx)) by ±gapHalf. */
export interface Ridge {
  at: Vec2;
  r: number;
  w: number;
  h: number;
  gapDir: number;
  gapHalf: number;
}
/** A circle (dense forest or a clearing). */
export interface Circle {
  at: Vec2;
  r: number;
}
/** A special spot: a rune spawn, a stash of tomes, a treasure dig site, ancient ruins. */
export interface Spot {
  at: Vec2;
  kind: 'rune' | 'stash' | 'dig' | 'ruins';
  region: number;
}
export interface Layout {
  bases: Base[];
  camps: CampDef[];
  neutrals: NeutralDef[];
  /** Polylines of the map's dirt roads (they speed movement like a general's roads). */
  roads: Vec2[][];
  lakes: Lake[];
  ridges: Ridge[];
  /** Dense lumber forests. */
  groves: Circle[];
  /** Kept free of trees (lairs, glades, villages, ruins). */
  clearings: Circle[];
  /** Narrow paths cut through the forest to the secret glades (not painted as roads). */
  secretPaths: Vec2[][];
  spots: Spot[];
}

export const MAP_SIZE = 384;
export const CENTER = MAP_SIZE / 2;

/** The four quadrants, for quest texts and the minimap (index = layout region). */
export const REGION_NAMES = ['Greywood', 'Thornmoor', 'Duskmere', 'Ashvale'];
/** The four edges (index = rotation of the north edge). */
export const EDGE_NAMES = ['north', 'east', 'south', 'west'];

/** Rotate a point around the map center by k quarter turns (NW -> NE -> SE -> SW). */
export function rotate(p: Vec2, k: number): Vec2 {
  let x = p[0] - CENTER;
  let z = p[1] - CENTER;
  for (let i = 0; i < k; i++) [x, z] = [-z, x];
  return [x + CENTER, z + CENTER];
}

/** Mirror a point of the north-west quadrant across its diagonal. */
const mirror = (p: Vec2): Vec2 => [p[1], p[0]];

/** Quadrant (0 NW, 1 NE, 2 SE, 3 SW) of a map position. */
export function regionAt(x: number, z: number): number {
  const east = x >= CENTER;
  const south = z >= CENTER;
  return !east && !south ? 0 : east && !south ? 1 : east && south ? 2 : 3;
}

// Corner slot index (0 NW, 1 NE, 2 SE, 3 SW) for each player index. The human
// is always in the south-west, the first rival in the opposite corner.
export const PLAYER_SLOTS = [3, 1, 0, 2];

// --- North-west quadrant template (rotated for every corner) ------------------
const BASE: { hall: Vec2; mine: Vec2; towers: Vec2[]; shop: Vec2 } = {
  hall: [64, 64], // town hall (4x4) / altar (3x3, snapped)
  mine: [57.5, 57.5],
  towers: [[73, 59], [59, 73]],
  shop: [100.5, 70.5],
};

/** Radius around a start location kept free of trees and creeps, for building a city. */
export const CITY_RADIUS = 24;
/** Radius of the forest grove in each map corner (lumber behind the bases). */
export const CORNER_GROVE = 60;

type QuadCamp = { at: Vec2; tier: number; units: string[]; alt?: string[]; captives?: boolean };

// Creep camps: tier 1 easy (green) ... tier 3 hard (red); tier 4 guards the outposts. The camps
// with `alt` are mirrored across the quadrant's diagonal (with the alternate creeps there).
const QUAD_CAMPS: QuadCamp[] = [
  { at: [108, 40], tier: 1, units: ['kobold', 'kobold', 'kobold'], alt: ['gnoll', 'gnoll', 'gnoll_archer'] },
  { at: [104, 88], tier: 1, units: ['gnoll', 'gnoll_archer', 'kobold'], alt: ['kobold', 'kobold', 'gnoll_archer'] },
  // Guards of the expansion mines.
  { at: [128, 38], tier: 2, units: ['brigand', 'brigand', 'gnoll_archer'], alt: ['wolf', 'wolf', 'gnoll'] },
  { at: [132, 68], tier: 2, units: ['forest_troll', 'forest_troll', 'gnoll'], alt: ['spider', 'spider', 'gnoll'] },
  { at: [150, 128], tier: 3, units: ['ogre_lord', 'ogre', 'forest_troll'], alt: ['ogre', 'ogre', 'troll_shaman', 'forest_troll'] },
  // The lake (clockwise side of the base).
  { at: [128, 111], tier: 2, units: ['murloc', 'murloc', 'murloc', 'murloc'] },
  { at: [157, 92], tier: 3, units: ['naga_siren', 'naga_siren', 'murloc', 'murloc'] },
  // The ruins (counter-clockwise side): harpies, and bandits holding captives.
  { at: [111, 131], tier: 2, units: ['harpy', 'harpy', 'harpy'] },
  { at: [92, 158], tier: 3, units: ['brigand', 'brigand', 'brigand', 'troll_shaman'], captives: true },
];

/** Neutral buildings of a quadrant (`m`: mirrored as well). */
const QUAD_NEUTRALS: { type: string; at: Vec2; m?: boolean; gold?: number }[] = [
  { type: 'goldmine', at: [128.5, 24.5], m: true, gold: 14000 }, // expansion mines along both edges
  { type: 'mercenary_camp', at: [70.5, 100.5] }, // the hill camp (mirror of the goblin merchant)
  { type: 'shrine', at: [86, 17] }, // in the secret glade
];

const LAKE: Lake = { at: [140, 98], r: 11 };
const RUINS: Vec2 = [100, 140];
const GLADE: { grove: Circle; glade: Circle; path: Vec2[] } = {
  grove: { at: [86, 20], r: 15 },
  glade: { at: [86, 18], r: 4.5 },
  path: [[87, 37], [83, 31], [88, 26], [86, 21]],
};
const LUMBER_GROVE: Circle = { at: [150, 22], r: 9 };
/** Woods just outside every city (mirrored), so all four generals have the same lumber at hand. */
const HOME_GROVE: Circle = { at: [30, 90], r: 9 };
/** Treasure dig sites (the quest picks one), checked for reachability when the game starts. */
const DIG_SITES: Vec2[] = [[98, 147], [147, 116], [42, 152], [152, 42], [122, 92]];

// --- North edge template (rotated for every edge) ----------------------------
const EDGE = {
  mine: [CENTER + 0.5, 14.5] as Vec2,
  merc: [CENTER - 23.5, 20.5] as Vec2,
  vault: [CENTER + 24.5, 20.5] as Vec2,
  fountain: [CENTER - 13.5, 40.5] as Vec2,
  fountainMana: [CENTER + 14.5, 40.5] as Vec2,
  gate: [CENTER + 0.5, 46.5] as Vec2,
  lab: [CENTER + 0.5, 60.5] as Vec2,
  camp: { at: [CENTER, 28] as Vec2, tier: 4, units: ['drake', 'drake', 'rock_golem'] },
  // The boss lair: a ring of cliffs open toward the center.
  lair: [CENTER, 88] as Vec2,
  // The village on the ring road.
  tavern: [CENTER - 13.5, 126.5] as Vec2,
  villageGate: [CENTER + 0.5, 124.5] as Vec2,
  market: [CENTER + 14.5, 126.5] as Vec2,
};
/** Themed mercenary camps of the four edges and the bosses of their lairs. */
const EDGE_MERCS = ['merc_highland', 'merc_lake', 'merc_bandit', 'merc_forest'];
const LAIRS: { boss: string; units: string[]; pond?: boolean }[] = [
  { boss: 'dragon', units: ['drake'] },
  { boss: 'hydra', units: ['naga_siren', 'murloc'], pond: true },
  { boss: 'bandit_lord', units: ['brigand', 'brigand', 'troll_shaman'] },
  { boss: 'broodmother', units: ['spider', 'spider'] },
];

// Center: Kalenden's citadel (offsets are relative to the map center).
const C = (dx: number, dz: number): Vec2 => [CENTER + dx, CENTER + dz];
export const CITADEL = {
  keep: C(0, 0),
  half: 13, // walls run from CENTER-13 to CENTER+13
  gateHalf: 2,
  kalenden: C(0, 6.5),
  towers: [C(-7, -7), C(7, -7), C(7, 7), C(-7, 7)],
  guards: [
    { type: 'dark_knight', at: C(-2, -10) }, { type: 'dark_knight', at: C(10, -2) },
    { type: 'dark_knight', at: C(2, 10) }, { type: 'dark_knight', at: C(-10, 2) },
    { type: 'skeleton', at: C(-5, -8) }, { type: 'skeleton', at: C(5, -8) },
    { type: 'skeleton', at: C(8, -5) }, { type: 'skeleton', at: C(8, 5) },
    { type: 'skeleton', at: C(-5, 8) }, { type: 'skeleton', at: C(5, 8) },
    { type: 'skeleton', at: C(-8, -5) }, { type: 'skeleton', at: C(-8, 5) },
    { type: 'skeleton_archer', at: C(-4, -4) }, { type: 'skeleton_archer', at: C(4, -4) },
    { type: 'skeleton_archer', at: C(-4, 4) }, { type: 'skeleton_archer', at: C(4, 4) },
  ],
};

export const MOAT = { inner: 34, outer: 41, fordHalfWidth: 4.5 };
/** Radius of the ring road around the moat. */
export const RING_ROAD = 54;

/** Lair cliffs: radius, wall width and height, and the opening (half-angle) toward the center. */
const LAIR_RIDGE = { r: 15, w: 3, h: 2.2, gapHalf: 0.95 };

/** Build the full map description. */
export function buildLayout(): Layout {
  const bases: Base[] = [];
  const camps: CampDef[] = [];
  const neutrals: NeutralDef[] = [];
  const lakes: Lake[] = [];
  const ridges: Ridge[] = [];
  const groves: Circle[] = [];
  const clearings: Circle[] = [];
  const secretPaths: Vec2[][] = [];
  const spots: Spot[] = [];
  const circle = (c: Circle, k: number, m = false): Circle => ({ at: rotate(m ? mirror(c.at) : c.at, k), r: c.r });

  for (let k = 0; k < 4; k++) {
    const R = (p: Vec2): Vec2 => rotate(p, k);
    const RM = (p: Vec2): Vec2 => rotate(mirror(p), k);
    // ---- the quadrant of corner k
    bases.push({
      slot: k,
      hall: R(BASE.hall),
      mine: R(BASE.mine),
      towers: BASE.towers.map(R),
      shop: R(BASE.shop),
      // Direction from the base toward the map center (for spawning units).
      toCenter: ((): Vec2 => {
        const h = R(BASE.hall);
        const dx = CENTER - h[0];
        const dz = CENTER - h[1];
        const l = Math.hypot(dx, dz);
        return [dx / l, dz / l];
      })(),
    });
    neutrals.push({ type: 'goldmine', at: R(BASE.mine), startMine: true, gold: 16000, region: k });
    neutrals.push({ type: 'shop', at: R(BASE.shop), region: k });
    for (const n of QUAD_NEUTRALS) {
      neutrals.push({ type: n.type, at: R(n.at), gold: n.gold, region: k });
      if (n.m) neutrals.push({ type: n.type, at: RM(n.at), gold: n.gold, region: k });
    }
    for (const c of QUAD_CAMPS) {
      camps.push({ at: R(c.at), tier: c.tier, units: c.units, region: k, captives: c.captives });
      if (c.alt) camps.push({ at: RM(c.at), tier: c.tier, units: c.alt, region: k });
    }
    lakes.push({ at: R(LAKE.at), r: LAKE.r });
    groves.push(circle(LUMBER_GROVE, k), circle(LUMBER_GROVE, k, true));
    groves.push(circle(HOME_GROVE, k), circle(HOME_GROVE, k, true));
    groves.push(circle(GLADE.grove, k), circle(GLADE.grove, k, true));
    clearings.push(circle(GLADE.glade, k), circle(GLADE.glade, k, true));
    secretPaths.push(GLADE.path.map(R), GLADE.path.map(RM));
    clearings.push({ at: R(RUINS), r: 9 });
    spots.push({ at: R(RUINS), kind: 'ruins', region: k });
    spots.push({ at: R(RUINS), kind: 'rune', region: k });
    spots.push({ at: RM(GLADE.glade.at), kind: 'stash', region: k });
    spots.push({ at: R([LAKE.at[0], LAKE.at[1] + LAKE.r + 5]), kind: 'rune', region: k });
    for (const d of DIG_SITES) spots.push({ at: R(d), kind: 'dig', region: k });

    // ---- the edge k (north for k = 0)
    neutrals.push({ type: 'goldmine', at: R(EDGE.mine), region: -1 });
    neutrals.push({ type: EDGE_MERCS[k]!, at: R(EDGE.merc), region: -1 });
    neutrals.push({ type: 'vault', at: R(EDGE.vault), region: -1 });
    neutrals.push({ type: 'fountain', at: R(EDGE.fountain), region: -1 });
    neutrals.push({ type: 'fountain_mana', at: R(EDGE.fountainMana), region: -1 });
    neutrals.push({ type: 'waygate', at: R(EDGE.gate), link: `outpost${k % 2}`, region: -1 });
    neutrals.push({ type: 'goblin_lab', at: R(EDGE.lab), region: -1 });
    neutrals.push({ type: 'tavern', at: R(EDGE.tavern), region: -1 });
    neutrals.push({ type: 'waygate', at: R(EDGE.villageGate), link: `village${k % 2}`, region: -1 });
    neutrals.push({ type: 'marketplace', at: R(EDGE.market), region: -1 });
    camps.push({ at: R(EDGE.camp.at), tier: EDGE.camp.tier, units: EDGE.camp.units, region: -1 });
    const lair = LAIRS[k]!;
    const la = R(EDGE.lair);
    camps.push({ at: R([EDGE.lair[0], EDGE.lair[1] + (lair.pond ? 6 : 0)]), tier: 5, units: [lair.boss, ...lair.units], boss: true, region: -1 });
    ridges.push({ at: la, ...LAIR_RIDGE, gapDir: Math.PI / 2 + (k * Math.PI) / 2 });
    clearings.push({ at: la, r: LAIR_RIDGE.r - 1 });
    if (lair.pond) lakes.push({ at: R([EDGE.lair[0], EDGE.lair[1] - 3]), r: 6 });
    clearings.push({ at: R([CENTER, 30]), r: 30 }, { at: R([CENTER, 124]), r: 18 });
  }

  // Roads (polylines) used for terrain painting, faster movement and to keep paths free of trees.
  const roads: Vec2[][] = [];
  const fordR = (MOAT.inner + MOAT.outer) / 2 / Math.SQRT2;
  const lateral: Vec2[] = [BASE.hall, [100, 58], [150, 52], [CENTER - 8, 52]];
  for (let k = 0; k < 4; k++) {
    const R = (p: Vec2): Vec2 => rotate(p, k);
    const hall = R(BASE.hall);
    const ford = R([CENTER - fordR, CENTER - fordR]);
    const gateA = R([CENTER, CENTER - CITADEL.half - 1]);
    const gateB = R([CENTER - CITADEL.half - 1, CENTER]);
    roads.push([hall, ford]);
    roads.push([ford, R([CENTER - 12, CENTER - 30]), gateA]);
    roads.push([ford, R([CENTER - 30, CENTER - 12]), gateB]);
    // Along both edges to the outposts, which link up with the neighbouring base's roads.
    roads.push(lateral.map(R), lateral.map((p) => R(mirror(p))));
    roads.push([R([CENTER - 8, 52]), R([CENTER + 8, 52])]);
    // Village spur from the ring road.
    roads.push([R([CENTER, CENTER - RING_ROAD - 1]), R([CENTER, 127])]);
  }
  const ring: Vec2[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([CENTER + Math.cos(a) * RING_ROAD, CENTER + Math.sin(a) * RING_ROAD]);
  }
  roads.push(ring);

  return { bases, camps, neutrals, roads, lakes, ridges, groves, clearings, secretPaths, spots };
}

/** Distance from (x, z) to a ridge's arc (round caps at the opening). */
export function ridgeDistance(rd: Ridge, x: number, z: number): number {
  const dx = x - rd.at[0];
  const dz = z - rd.at[1];
  const ang = Math.atan2(dz, dx);
  let da = Math.abs(ang - rd.gapDir) % (Math.PI * 2);
  if (da > Math.PI) da = Math.PI * 2 - da;
  if (da >= rd.gapHalf) return Math.abs(Math.hypot(dx, dz) - rd.r);
  // In the opening: distance to the nearer end of the arc.
  let best = Infinity;
  for (const s of [-1, 1]) {
    const a = rd.gapDir + s * rd.gapHalf;
    best = Math.min(best, Math.hypot(x - (rd.at[0] + Math.cos(a) * rd.r), z - (rd.at[1] + Math.sin(a) * rd.r)));
  }
  return best;
}

/** Height a ridge adds at a distance from its arc (steep rock walls). */
export function ridgeLift(rd: Ridge, d: number): number {
  return rd.h * smoothstep(rd.w / 2 + 2.2, rd.w / 2, d);
}
