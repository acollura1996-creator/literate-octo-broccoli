// The land of Kalenden: a four-fold symmetric map. Four generals start in the
// corners, Kalenden's walled citadel sits on a plateau in the center behind a
// moat that can only be crossed at four diagonal fords, and the edge midpoints
// hold outposts (expansion gold mine, mercenary camp, arcane vault and a
// fountain of health) guarded by powerful creeps.

export const MAP_SIZE = 160;
export const CENTER = MAP_SIZE / 2;

/** Rotate a point around the map center by k quarter turns (NW -> NE -> SE -> SW). */
export function rotate(p, k) {
  let x = p[0] - CENTER;
  let z = p[1] - CENTER;
  for (let i = 0; i < k; i++) [x, z] = [-z, x];
  return [x + CENTER, z + CENTER];
}

// Corner slot index (0 NW, 1 NE, 2 SE, 3 SW) for each player index. The human
// is always in the south-west, the first rival in the opposite corner.
export const PLAYER_SLOTS = [3, 1, 0, 2];

// --- North-west quadrant template (rotated for every corner) ------------------
const BASE = {
  hall: [28, 28], // town hall (4x4) / altar (3x3, snapped)
  mine: [21.5, 21.5],
  towers: [[35, 23], [23, 35]],
  shop: [41.5, 33.5],
};

// Creep camps: tier 1 easy ... tier 4 deadly.
const QUAD_CAMPS = [
  { at: [47, 23], tier: 1, units: ['kobold', 'kobold', 'kobold'] },
  { at: [23, 47], tier: 1, units: ['gnoll', 'gnoll', 'gnoll_archer'] },
  { at: [42, 52], tier: 2, units: ['wolf', 'wolf', 'forest_troll'] },
  { at: [61, 31], tier: 2, units: ['forest_troll', 'forest_troll', 'spider'] },
  { at: [31, 61], tier: 2, units: ['spider', 'spider', 'gnoll'] },
  { at: [51, 64], tier: 3, units: ['ogre', 'ogre', 'forest_troll', 'forest_troll'] },
];

// --- North edge template (rotated for every edge) ----------------------------
const EDGE = {
  mine: [80.5, 9.5],
  merc: [67.5, 14.5],
  vault: [93.5, 14.5],
  fountain: [80.5, 36.5],
  camp: { at: [80, 22], tier: 4, units: ['drake', 'drake', 'rock_golem'] },
};

// Center: Kalenden's citadel.
export const CITADEL = {
  keep: [80, 80],
  half: 13, // walls run from CENTER-13 to CENTER+13
  gateHalf: 2,
  kalenden: [80, 86.5],
  towers: [
    [73, 73], [87, 73], [87, 87], [73, 87],
  ],
  guards: [
    { type: 'dark_knight', at: [78, 70] }, { type: 'dark_knight', at: [90, 78] },
    { type: 'dark_knight', at: [82, 90] }, { type: 'dark_knight', at: [70, 82] },
    { type: 'skeleton', at: [75, 72] }, { type: 'skeleton', at: [85, 72] },
    { type: 'skeleton', at: [88, 75] }, { type: 'skeleton', at: [88, 85] },
    { type: 'skeleton', at: [75, 88] }, { type: 'skeleton', at: [85, 88] },
    { type: 'skeleton', at: [72, 75] }, { type: 'skeleton', at: [72, 85] },
    { type: 'skeleton_archer', at: [76, 76] }, { type: 'skeleton_archer', at: [84, 76] },
    { type: 'skeleton_archer', at: [76, 84] }, { type: 'skeleton_archer', at: [84, 84] },
  ],
};

export const MOAT = { inner: 24, outer: 29, fordHalfWidth: 3.6 };

function rotCamp(c, k) {
  return { ...c, at: rotate(c.at, k) };
}

/** Build the full map description. */
export function buildLayout() {
  const bases = [];
  const camps = [];
  const neutrals = []; // { type, at }
  for (let k = 0; k < 4; k++) {
    bases.push({
      slot: k,
      hall: rotate(BASE.hall, k),
      mine: rotate(BASE.mine, k),
      towers: BASE.towers.map((t) => rotate(t, k)),
      shop: rotate(BASE.shop, k),
      // Direction from the base toward the map center (for spawning units).
      toCenter: (() => {
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
  const roads = [];
  for (let k = 0; k < 4; k++) {
    const hall = rotate(BASE.hall, k);
    const ford = rotate([CENTER - 18.8, CENTER - 18.8], k);
    const gateA = rotate([CENTER, CENTER - CITADEL.half - 1], k);
    const gateB = rotate([CENTER - CITADEL.half - 1, CENTER], k);
    roads.push([hall, ford]);
    roads.push([ford, rotate([CENTER - 9, CENTER - 21], k), gateA]);
    roads.push([ford, rotate([CENTER - 21, CENTER - 9], k), gateB]);
    roads.push([hall, rotate([52, 26], k), rotate([CENTER, 26], k), rotate(EDGE.mine, k)]);
    roads.push([rotate([CENTER, 26], k), rotate(EDGE.fountain, k)]);
  }

  return { bases, camps, neutrals, roads };
}
