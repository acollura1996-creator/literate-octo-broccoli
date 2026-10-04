// Procedural low-poly model factory (Warcraft III "Lordaeron Summer" look).
//
//   createModel(modelId, teamColor) -> { root, parts, height, radius }
//
// root   : new THREE.Group, origin at ground center, facing +Z.
// parts  : animation handles (see README contract in the builders):
//          body, head, legs[{obj,phase,amp}], arms[{obj,phase}], weapon, spin[], bob[],
//          wings[{obj,side}], wheels[], fire[], glow[].
// All meshes share cached geometries/materials from ./assets.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, geo, mesh } from './assets.js';
import * as U from './models/units.js';
import * as C from './models/creeps.js';
import * as B from './models/buildings.js';
import * as N from './models/neutral.js';
import * as A from './models/ages.js';

const BUILDERS = {
  // Empire units
  peasant: U.peasant,
  footman: U.footman,
  archer: U.archer,
  knight: U.knight,
  priest: U.priest,
  sorceress: U.sorceress,
  catapult: U.catapult,
  // Heroes
  paladin: U.paladin,
  archmage: U.archmage,
  blademaster: U.blademaster,
  mountainking: U.mountainking,
  ranger: U.ranger,
  water_elemental: U.water_elemental,
  // Creeps
  kobold: C.kobold,
  gnoll: C.gnoll,
  gnoll_archer: C.gnoll_archer,
  wolf: C.wolf,
  forest_troll: C.forest_troll,
  ogre: C.ogre,
  ogre_lord: C.ogre_lord,
  spider: C.spider,
  rock_golem: C.rock_golem,
  drake: C.drake,
  // Kalenden's Dark Legion
  kalenden: C.kalenden,
  dark_knight: C.dark_knight,
  skeleton: C.skeleton,
  skeleton_archer: C.skeleton_archer,
  // Empire buildings
  townhall: B.townhall,
  keep: B.keep,
  castle: B.castle,
  farm: B.farm,
  barracks: B.barracks,
  blacksmith: B.blacksmith,
  sanctum: B.sanctum,
  workshop: B.workshop,
  scouttower: B.scouttower,
  guardtower: B.guardtower,
  altar: B.altar,
  construction: B.construction,
  // Neutral buildings
  goldmine: N.goldmine,
  shop: N.shop,
  mercenary_camp: N.mercenary_camp,
  fountain: N.fountain,
  kalenden_keep: N.kalenden_keep,
  dark_tower: N.dark_tower,
  wall_segment: N.wall_segment,
  wall_tower: N.wall_tower,
  // Doodads
  rock: N.rock,
  bush: N.bush,
  flowers: N.flowers,
  crate: N.crate,
  barrel: N.barrel,
  campfire: N.campfire,
  ruins_pillar: N.ruins_pillar,
  banner_pole: N.banner_pole,
  stump: N.stump,
  mushrooms: N.mushrooms,
  // Ages: units
  militia: A.militia,
  hunter: A.hunter,
  spearman: A.spearman,
  scout_rider: A.scout_rider,
  crossbowman: A.crossbowman,
  champion: A.champion,
  royal_knight: A.royal_knight,
  battlemage: A.battlemage,
  trebuchet: A.trebuchet,
};

export const MODEL_IDS = Object.keys(BUILDERS);

/** Static models (buildings + doodads) also receive shadows. */
const STATIC_IDS = new Set([
  'townhall', 'keep', 'castle', 'farm', 'barracks', 'blacksmith', 'sanctum', 'workshop', 'scouttower',
  'guardtower', 'altar', 'construction', 'goldmine', 'shop', 'mercenary_camp', 'fountain', 'kalenden_keep',
  'dark_tower', 'wall_segment', 'wall_tower', 'rock', 'bush', 'flowers', 'crate', 'barrel', 'campfire',
  'ruins_pillar', 'banner_pole', 'stump', 'mushrooms',
]);

const DEFAULT_TEAM = 0x959697;

/**
 * Re-parent `o` under a new holder group that takes over its transform pieces, so that `o`
 * itself rests at identity for those pieces (lets the animator set absolute scale/position).
 */
function hoist(o, { position = true, rotation = true, scale = true }) {
  const parent = o.parent;
  if (!parent) return;
  const holder = new THREE.Group();
  if (position) { holder.position.copy(o.position); o.position.set(0, 0, 0); }
  if (rotation) { holder.quaternion.copy(o.quaternion); o.quaternion.identity(); }
  if (scale) { holder.scale.copy(o.scale); o.scale.set(1, 1, 1); }
  const idx = parent.children.indexOf(o);
  parent.children.splice(idx, 1, holder);
  holder.parent = parent;
  o.parent = null;
  holder.add(o);
}

const isUnit = (v) => Math.abs(v.x - 1) < 1e-6 && Math.abs(v.y - 1) < 1e-6 && Math.abs(v.z - 1) < 1e-6;

/** Make the animated handles safe to drive with absolute values (run once per template). */
function normalizeParts(parts) {
  for (const o of [...(parts.glow ?? []), ...(parts.fire ?? [])]) {
    if (!isUnit(o.scale)) hoist(o, { position: true, rotation: true, scale: true });
  }
  for (const o of parts.bob ?? []) {
    if (o.position.lengthSq() > 0) hoist(o, { position: true, rotation: false, scale: false });
  }
  // Drop empty arrays so "field present" means "has something to animate".
  for (const k of Object.keys(parts)) {
    if (Array.isArray(parts[k]) && parts[k].length === 0) delete parts[k];
    else if (parts[k] === undefined || parts[k] === null) delete parts[k];
  }
}

/** Remember rest transforms so the animator can work relative to them. */
function recordRest(parts) {
  const rest = (o) => {
    if (!o) return;
    o.userData.restPosition = o.position.clone();
    o.userData.restRotation = o.rotation.clone();
  };
  rest(parts.body);
  rest(parts.head);
  rest(parts.weapon);
  for (const o of parts.bob ?? []) rest(o);
  for (const o of parts.spin ?? []) rest(o);
  for (const w of parts.wings ?? []) rest(w.obj);
}

// ---------------------------------------------------------------------------
// Static-mesh merging: inside every animated group ("anchor"), meshes that do not move relative
// to it and share a material are baked into one cached geometry. Cuts draw calls a lot while the
// animated handles in `parts` keep working exactly as built.
// ---------------------------------------------------------------------------
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

function anchorSet(root, parts) {
  const set = new Set([root]);
  for (const k of ['body', 'head', 'weapon']) if (parts[k]) set.add(parts[k]);
  for (const l of parts.legs ?? []) set.add(l.obj);
  for (const a of parts.arms ?? []) set.add(a.obj);
  for (const w of parts.wings ?? []) set.add(w.obj);
  for (const k of ['spin', 'bob', 'wheels', 'fire']) for (const o of parts[k] ?? []) set.add(o);
  return set;
}

function bakeGeometry(meshObj, rel) {
  const src = meshObj.geometry;
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  g.applyMatrix4(rel);
  if (rel.determinant() < 0) {
    // mirrored transform: restore counter-clockwise winding so front faces stay visible
    for (const attr of [g.attributes.position, g.attributes.normal]) {
      const a = attr.array, n = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < n; k++) {
          const t = a[(i + 1) * n + k];
          a[(i + 1) * n + k] = a[(i + 2) * n + k];
          a[(i + 2) * n + k] = t;
        }
      }
    }
  }
  return g;
}

function mergeStatic(root, parts, key) {
  root.updateMatrixWorld(true);
  const anchors = anchorSet(root, parts);
  const glow = new Set(parts.glow ?? []);
  const ordered = [];
  const ordinal = new Map();
  root.traverse((n) => {
    if (anchors.has(n)) ordered.push(n);
    if (n.isMesh) ordinal.set(n, ordinal.size);
  });
  ordered.forEach((anchor, ai) => {
    const buckets = new Map();
    const visit = (node) => {
      for (const c of node.children) {
        if (anchors.has(c)) continue;
        if (c.isMesh) {
          if (glow.has(c)) continue;
          const bk = `${c.material.uuid}|${c.castShadow ? 1 : 0}|${c.receiveShadow ? 1 : 0}`;
          if (!buckets.has(bk)) buckets.set(bk, []);
          buckets.get(bk).push(c);
        }
        if (c.children.length) visit(c);
      }
    };
    visit(anchor);
    _inv.copy(anchor.matrixWorld).invert();
    for (const meshes of buckets.values()) {
      if (meshes.length < 2 || meshes.some((m) => m.children.length)) continue;
      // keyed by content (which meshes), so every team color shares the same merged geometry
      const geometry = geo.custom(`merged:${key}|${ai}|${meshes.map((m) => ordinal.get(m)).join(',')}`, () => {
        const list = meshes.map((m) => bakeGeometry(m, _rel.multiplyMatrices(_inv, m.matrixWorld)));
        const merged = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        return merged;
      });
      const merged = new THREE.Mesh(geometry, meshes[0].material);
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      anchor.add(merged);
      for (const m of meshes) m.removeFromParent();
    }
  });
}

// ---------------------------------------------------------------------------
// Templates: each (model, team color) is built and merged once, then cloned per call.
// ---------------------------------------------------------------------------
const templates = new Map();

function pathOf(root, node) {
  const p = [];
  for (let n = node; n !== root; n = n.parent) p.unshift(n.parent.children.indexOf(n));
  return p;
}
function nodeAt(root, path) {
  let n = root;
  for (const i of path) n = n.children[i];
  return n;
}

function buildTemplate(modelId, teamColor) {
  const model = BUILDERS[modelId](teamColor);
  const parts = model.parts ?? {};
  normalizeParts(parts);
  if (STATIC_IDS.has(modelId)) model.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  if (MODEL_OPTIONS.mergeStatic) mergeStatic(model.root, parts, modelId);
  const r = model.root;
  const spec = {};
  for (const [k, v] of Object.entries(parts)) {
    if (Array.isArray(v)) {
      spec[k] = v[0]?.isObject3D
        ? { nodes: v.map((o) => pathOf(r, o)) }
        : { entries: v.map((e) => ({ ...e, obj: pathOf(r, e.obj) })) };
    } else if (v && v.isObject3D) {
      spec[k] = { node: pathOf(r, v) };
    }
  }
  return { root: r, spec, height: model.height, radius: model.radius };
}

function instantiate(t, modelId) {
  const root = t.root.clone(true);
  const parts = {};
  for (const [k, v] of Object.entries(t.spec)) {
    if (v.nodes) parts[k] = v.nodes.map((p) => nodeAt(root, p));
    else if (v.entries) parts[k] = v.entries.map((e) => ({ ...e, obj: nodeAt(root, e.obj) }));
    else parts[k] = nodeAt(root, v.node);
  }
  recordRest(parts);
  root.name = modelId;
  root.userData.modelId = modelId;
  return { root, parts, height: t.height, radius: t.radius };
}

/** Tunables (mainly for debugging in the gallery). */
export const MODEL_OPTIONS = { mergeStatic: true };

function fallbackModel(modelId) {
  const root = new THREE.Group();
  const m = mesh(geo.box(0.8, 0.8, 0.8), mat(0xff00ff), 0, 0.4, 0, root);
  m.castShadow = true;
  root.name = `missing:${modelId}`;
  return { root, parts: {}, height: 0.8, radius: 0.5 };
}

/**
 * Create a new instance of a model.
 * @param {string} modelId one of MODEL_IDS
 * @param {number} teamColor hex color for team-colored parts
 * @returns {{root: THREE.Group, parts: object, height: number, radius: number}}
 */
export function createModel(modelId, teamColor = DEFAULT_TEAM) {
  if (!Object.prototype.hasOwnProperty.call(BUILDERS, modelId)) {
    console.warn(`[models] unknown model id "${modelId}", using fallback`);
    return fallbackModel(modelId);
  }
  const team = new THREE.Color(teamColor ?? DEFAULT_TEAM).getHex();
  const key = `${modelId}|${team}|${MODEL_OPTIONS.mergeStatic ? 1 : 0}`;
  let t = templates.get(key);
  if (!t) {
    try {
      t = buildTemplate(modelId, team);
    } catch (err) {
      console.warn(`[models] failed to build "${modelId}", using fallback`, err);
      return fallbackModel(modelId);
    }
    templates.set(key, t);
  }
  return instantiate(t, modelId);
}
