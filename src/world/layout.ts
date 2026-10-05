// The land of Kalenden: a four-fold symmetric map. Four generals start in the
// corners, Kalenden's walled citadel sits on a plateau in the center behind a
// moat that can only be crossed at four diagonal fords, and the edge midpoints
// hold outposts (expansion gold mine, mercenary camp, arcane vault and a
// fountain of health) guarded by powerful creeps.

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
}
export interface NeutralDef {
  type: string;
  at: Vec2;
  /** The gold mine at a start location (it holds less gold). */
  startMine?: boolean;
}
export interface Layout {
  bases: Base[];
  camps: CampDef[];
  neutrals: NeutralDef[];
  /** Polylines of the map's dirt roads. */
  roads: Vec2[][];
}

export const MAP_SIZE = 256;
export const CENTER = MAP_SIZE / 2;

/** Rotate a point around the map center by k quarter turns (NW -> NE -> SE -> SW). */
export function rotate(p: Vec2, k: number): Vec2 {
  let x = p[0] - CENTER;
  let z = p[1] - CENTER;
  for (let i = 0; i < k; i++) [x, z] = [-z, x];
  return [x + CENTER, z + CENTER];
}

// Corner slot index (0 NW, 1 NE, 2 SE, 3 SW) for each player index. The human
// is always in the south-west, the first rival in the opposite corner.
export const PLAYER_SLOTS = [3, 1, 0, 2];

// --- North-west quadrant template (rotated for every corner) ------------------
const BASE: { hall: Vec2; mine: Vec2; towers: Vec2[]; shop: Vec2 } = {
  hall: [46, 46], // town hall (4x4) / altar (3x3, snapped)
  mine: [39.5, 39.5],
  towers: [[55, 41], [41, 55]],
  shop: [80.5, 52.5],
};

/** Radius around a start location kept free of trees and creeps, for building a city. */
export const CITY_RADIUS = 24;

// Creep camps: tier 1 easy ... tier 4 deadly.
const QUAD_CAMPS: CampDef[] = [
  { at: [84, 32], tier: 1, units: ['kobold', 'kobold', 'kobold'] },
  { at: [32, 84], tier: 1, units: ['gnoll', 'gnoll', 'gnoll_archer'] },
  { at: [64, 20], tier: 1, units: ['kobold', 'kobold', 'gnoll_archer'] },
  { at: [20, 64], tier: 2, units: ['wolf', 'wolf', 'gnoll'] },
  { at: [78, 94], tier: 2, units: ['wolf', 'wolf', 'forest_troll'] },
  { at: [100, 48], tier: 2, units: ['forest_troll', 'forest_troll', 'spider'] },
  { at: [48, 100], tier: 2, units: ['spider', 'spider', 'gnoll'] },
  { at: [92, 110], tier: 3, units: ['ogre', 'ogre', 'forest_troll', 'forest_troll'] },
  { at: [112, 70], tier: 3, units: ['ogre_lord', 'ogre', 'forest_troll'] },
];

// --- North edge template (rotated for every edge) ----------------------------
const EDGE: { mine: Vec2; merc: Vec2; vault: Vec2; fountain: Vec2; camp: CampDef } = {
  mine: [CENTER + 0.5, 13.5],
  merc: [CENTER - 17.5, 22.5],
  vault: [CENTER + 18.5, 22.5],
  fountain: [CENTER + 0.5, 50.5],
  camp: { at: [CENTER, 30], tier: 4, units: ['drake', 'drake', 'rock_golem'] },
};

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

export const MOAT = { inner: 32, outer: 38, fordHalfWidth: 4 };

function rotCamp(c: CampDef, k: number): CampDef {
  return { ...c, at: rotate(c.at, k) };
}

/** Build the full map description. */
export function buildLayout(): Layout {
  const bases: Base[] = [];
  const camps: CampDef[] = [];
  const neutrals: NeutralDef[] = [];
  for (let k = 0; k < 4; k++) {
    bases.push({
      slot: k,
      hall: rotate(BASE.hall, k),
      mine: rotate(BASE.mine, k),
      towers: BASE.towers.map((t) => rotate(t, k)),
      shop: rotate(BASE.shop, k),
      // Direction from the base toward the map center (for spawning units).
      toCenter: ((): Vec2 => {
        const h = rotate(BASE.hall, k);
        const dx = CENTER - h[0];
        const dz = CENTER - h[1];
        const l = Math.hypot(dx, dz);
        return [dx / l, dz / l];
      })(),
    });
    neutrals.push({ type: 'goldmine', at: rotate(BASE.mine, k), startMine: true });
    neutrals.push({ type: 'shop', at: rotate(BASE.shop, k) });
    for (const c of QUAD_CAMPS) camps.push(rotCamp(c, k));
    // Edge outposts.
    neutrals.push({ type: 'goldmine', at: rotate(EDGE.mine, k) });
    neutrals.push({ type: 'mercenary_camp', at: rotate(EDGE.merc, k) });
    neutrals.push({ type: 'vault', at: rotate(EDGE.vault, k) });
    neutrals.push({ type: 'fountain', at: rotate(EDGE.fountain, k) });
    camps.push(rotCamp(EDGE.camp, k));
  }

  // Roads (polylines) used for terrain painting and to keep paths free of trees.
  const roads: Vec2[][] = [];
  const fordR = (MOAT.inner + MOAT.outer) / 2 / Math.SQRT2;
  for (let k = 0; k < 4; k++) {
    const hall = rotate(BASE.hall, k);
    const ford = rotate([CENTER - fordR, CENTER - fordR], k);
    const gateA = rotate([CENTER, CENTER - CITADEL.half - 1], k);
    const gateB = rotate([CENTER - CITADEL.half - 1, CENTER], k);
    roads.push([hall, ford]);
    roads.push([ford, rotate([CENTER - 11, CENTER - 27], k), gateA]);
    roads.push([ford, rotate([CENTER - 27, CENTER - 11], k), gateB]);
    roads.push([hall, rotate([80, 40], k), rotate([CENTER, 40], k), rotate(EDGE.mine, k)]);
    roads.push([rotate([CENTER, 40], k), rotate(EDGE.fountain, k)]);
  }

  return { bases, camps, neutrals, roads };
}
