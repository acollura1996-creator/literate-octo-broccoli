// Shared, cached geometries and materials. Every material created here is
// patched so it is darkened by the fog-of-war texture, like Warcraft III's
// black mask / fog of war.
import * as THREE from 'three';

export const fogUniforms = {
  uFogTex: { value: null },
  uWorldSize: { value: new THREE.Vector2(160, 160) },
  uFogEnabled: { value: 1.0 },
};

const FOG_VERT_DECL = 'varying vec3 vFogWorldPos;';
const FOG_VERT_CODE = `
  vec4 fogWP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  fogWP = modelMatrix * fogWP;
  vFogWorldPos = fogWP.xyz;
`;
const FOG_FRAG_DECL = `
  varying vec3 vFogWorldPos;
  uniform sampler2D uFogTex;
  uniform vec2 uWorldSize;
  uniform float uFogEnabled;
`;
const FOG_FRAG_CODE = `
  float fogV = texture2D(uFogTex, vFogWorldPos.xz / uWorldSize).r;
  gl_FragColor.rgb *= mix(1.0, fogV, uFogEnabled);
`;

/** Patch a built-in three.js material so it samples the fog-of-war texture. */
export function patchFog(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFogTex = fogUniforms.uFogTex;
    shader.uniforms.uWorldSize = fogUniforms.uWorldSize;
    shader.uniforms.uFogEnabled = fogUniforms.uFogEnabled;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FOG_VERT_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FOG_VERT_CODE}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOG_FRAG_DECL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FOG_FRAG_CODE}`);
  };
  material.customProgramCacheKey = () => 'fogpatch';
  return material;
}

const matCache = new Map();

/**
 * Cached low-poly material.
 * opts: { emissive, emissiveIntensity, transparent, opacity, flat (default true),
 *         side, noFog, depthWrite }
 */
export function mat(color, opts = {}) {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.transparent ? 1 : 0}|${opts.opacity ?? 1}|${opts.flat === false ? 0 : 1}|${opts.side ?? ''}|${opts.noFog ? 1 : 0}|${opts.depthWrite ?? ''}`;
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshLambertMaterial({
    color: c,
    flatShading: opts.flat !== false,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (opts.depthWrite !== undefined) m.depthWrite = opts.depthWrite;
  if (!opts.noFog) patchFog(m);
  matCache.set(key, m);
  return m;
}

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const r = (v) => Math.round(v * 1000) / 1000;

/** Cached geometry helpers. Shapes are centered on their origin (like three.js defaults). */
export const geo = {
  box: (w, h, d) => cached(`box${r(w)},${r(h)},${r(d)}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, seg = 8) =>
    cached(`cyl${r(rt)},${r(rb)},${r(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  cone: (rad, h, seg = 8) => cached(`cone${r(rad)},${r(h)},${seg}`, () => new THREE.ConeGeometry(rad, h, seg)),
  sphere: (rad, ws = 8, hs = 6) =>
    cached(`sph${r(rad)},${ws},${hs}`, () => new THREE.SphereGeometry(rad, ws, hs)),
  ico: (rad, detail = 0) => cached(`ico${r(rad)},${detail}`, () => new THREE.IcosahedronGeometry(rad, detail)),
  dodeca: (rad, detail = 0) =>
    cached(`dod${r(rad)},${detail}`, () => new THREE.DodecahedronGeometry(rad, detail)),
  torus: (rad, tube, rs = 6, ts = 12, arc = Math.PI * 2) =>
    cached(`tor${r(rad)},${r(tube)},${rs},${ts},${r(arc)}`, () => new THREE.TorusGeometry(rad, tube, rs, ts, arc)),
  ring: (inner, outer, seg = 32) =>
    cached(`ring${r(inner)},${r(outer)},${seg}`, () => new THREE.RingGeometry(inner, outer, seg)),
  plane: (w, h) => cached(`pl${r(w)},${r(h)}`, () => new THREE.PlaneGeometry(w, h)),
  tetra: (rad) => cached(`tet${r(rad)}`, () => new THREE.TetrahedronGeometry(rad)),
  octa: (rad) => cached(`oct${r(rad)}`, () => new THREE.OctahedronGeometry(rad)),
  /** Arbitrary cached geometry built by `make` and stored under `key`. */
  custom: (key, make) => cached(`custom:${key}`, make),
};

/** Convenience: create a mesh from cached geometry + material and place it. */
export function mesh(geometry, material, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

// Player colours live with the engine-free data; re-exported for the existing imports.
export { TEAM_COLORS } from '../../src/data/colors.ts';
