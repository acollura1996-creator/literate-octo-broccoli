// Placeholder builders for the ancient era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const caveman = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const rock_thrower = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const hoplite = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const chariot = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const cargo_wagon = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const stone_camp = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const bronze_hall = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const house_stone = (tc) => stub(tc, 1.9, 1.5, 1.9);
export const farm_1 = (tc) => stub(tc, 2.8499999999999996, 1.5, 2.8499999999999996);
