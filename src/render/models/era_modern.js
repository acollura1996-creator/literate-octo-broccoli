// Placeholder builders for the modern era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const infantry = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const bazooka = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const tank = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const rocket_artillery = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const missile_silo = (tc) => stub(tc, 2.8499999999999996, 1.5, 2.8499999999999996);
export const capitol = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const house_mod = (tc) => stub(tc, 1.9, 1.5, 1.9);
