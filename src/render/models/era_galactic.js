// Placeholder builders for the galactic era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const void_trooper = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const starfighter = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const titan = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const graviton = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const galactic_citadel = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const house_galactic = (tc) => stub(tc, 1.9, 1.5, 1.9);
export const wall_force = (tc) => stub(tc, 0.95, 1.2, 0.95);
export const gate_force = (tc) => stub(tc, 1.9, 1.5, 1.9);
