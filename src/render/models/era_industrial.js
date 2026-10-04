// Placeholder builders for the industrial era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const city_hall = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const house_ind = (tc) => stub(tc, 1.9, 1.5, 1.9);
export const farm_2 = (tc) => stub(tc, 2.8499999999999996, 1.5, 2.8499999999999996);
export const factory = (tc) => stub(tc, 2.8499999999999996, 1.5, 2.8499999999999996);
export const tower_bunker = (tc) => stub(tc, 1.9, 1.5, 1.9);
export const wall_concrete = (tc) => stub(tc, 0.95, 1.2, 0.95);
export const gate_concrete = (tc) => stub(tc, 1.9, 1.5, 1.9);
