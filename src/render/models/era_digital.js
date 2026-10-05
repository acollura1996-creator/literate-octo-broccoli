// Placeholder builders for the digital era (replaced by the real models).
import { THREE, mat, add, geo } from './common.js';

function stub(tc, w, h, d) {
  const root = new THREE.Group();
  add(root, geo.box(w, h, d), mat(tc), [0, h / 2, 0]);
  return { root, parts: {}, height: h, radius: Math.max(w, d) / 2 };
}

export const railgunner = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const combat_drone = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const stealth_tank = (tc) => stub(tc, 0.6, 1.1, 0.6);
export const digital_hub = (tc) => stub(tc, 3.8, 1.5, 3.8);
export const house_digital = (tc) => stub(tc, 1.9, 1.5, 1.9);
export const research_3 = (tc) => stub(tc, 2.8499999999999996, 1.5, 2.8499999999999996);
