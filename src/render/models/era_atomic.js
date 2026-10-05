// Placeholder builders for the atomic era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const flamethrower = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const sniper = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const half_track = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const atomic_hall = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const house_atomic = (tc) => stub(tc, 1.9, 1.5, 1.9);
export const research_2 = (tc) => stub(tc, 2.8499999999999996, 1.5, 2.8499999999999996);
