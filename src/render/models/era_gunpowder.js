// Placeholder builders for the gunpowder era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const musketeer = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const grenadier = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const dragoon = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const cannon = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const rifleman = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const machine_gunner = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const steam_tank = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const howitzer = (tc) => stub(tc, 0.6, 1.1, 0.6);
