// Terrain generation: heightmap, painted ground texture (Lordaeron Summer
// look with a blighted citadel), water, trees and decorative doodads.
import * as THREE from 'three';
import { fbm, valueNoise, mulberry32, smoothstep, distToSegment } from './noise.js';
import { MAP_SIZE, CENTER, CITADEL, MOAT } from './layout.js';
import { BLOCK_TERRAIN, BLOCK_TREE } from './pathgrid.js';
import { fogUniforms, patchFog, mat, geo } from '../render/assets.js';

export const WATER_LEVEL = -0.35;

// Ground types used for painting.
const T_GRASS = 0;
const T_FOREST = 1;
const T_ROAD = 2;
const T_DIRT = 3;
const T_COBBLE = 4;
const T_SHORE = 5;
const T_BLIGHT = 6;

const TYPE_COLORS = {
  [T_GRASS]: [0.36, 0.56, 0.18],
  [T_FOREST]: [0.25, 0.4, 0.13],
  [T_ROAD]: [0.62, 0.5, 0.32],
  [T_DIRT]: [0.5, 0.41, 0.25],
  [T_COBBLE]: [0.5, 0.49, 0.45],
  [T_SHORE]: [0.55, 0.5, 0.33],
  [T_BLIGHT]: [0.3, 0.24, 0.33],
};

function moatInfo(x, z) {
  const dx = x - CENTER;
  const dz = z - CENTER;
  const r = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const wobble = fbm(Math.cos(ang) * 2 + 10, Math.sin(ang) * 2 + 10, 7, 3) * 1.6;
  const inner = MOAT.inner + wobble;
  const outer = MOAT.outer + wobble;
  // Distance (in world units, along the arc) to the nearest diagonal ford.
  let fordDist = Infinity;
  for (let k = 0; k < 4; k++) {
    const fa = Math.PI / 4 + (k * Math.PI) / 2;
    let da = Math.abs(ang - fa);
    if (da > Math.PI) da = Math.PI * 2 - da;
    fordDist = Math.min(fordDist, da * r);
  }
  const inBand = r > inner && r < outer;
  const bandDist = inBand ? Math.min(r - inner, outer - r) : -Math.min(Math.abs(r - inner), Math.abs(r - outer));
  return { r, inner, outer, inBand, bandDist, fordDist, isFord: fordDist < MOAT.fordHalfWidth };
}

export class Terrain {
  constructor(layout, grid, seed = 1337) {
    this.size = MAP_SIZE;
    this.layout = layout;
    this.grid = grid;
    this.seed = seed;
    const n = MAP_SIZE + 1;
    this.heights = new Float32Array(n * n);
    this.types = new Uint8Array(MAP_SIZE * MAP_SIZE);
    this.trees = [];
    this.flatSpots = [];
    this.group = new THREE.Group();
  }

  /** Register a spot (center + radius) that should be flat (for buildings). */
  addFlatSpot(x, z, radius) {
    this.flatSpots.push({ x, z, radius });
  }

  rawHeight(x, z) {
    let h = 0.45 + fbm(x * 0.035, z * 0.035, this.seed, 4) * 0.9 + fbm(x * 0.12, z * 0.12, this.seed + 3, 2) * 0.15;
    // Keep the open land above the waterline (only the moat holds water).
    if (h < 0.1) h = 0.1 - (0.1 - h) * 0.15;
    const r = Math.hypot(x - CENTER, z - CENTER);
    // Central plateau.
    const plateau = smoothstep(21.5, 18.5, r);
    h = h * (1 - plateau) + 1.6 * plateau;
    // Moat.
    const m = moatInfo(x, z);
    if (m.r > m.inner - 2.5 && m.r < m.outer + 2.5) {
      const depthT = smoothstep(-2.0, 1.2, m.bandDist);
      const fordT = smoothstep(MOAT.fordHalfWidth + 2.5, MOAT.fordHalfWidth - 0.5, m.fordDist);
      const bed = -1.7 * (1 - fordT) + -0.5 * fordT;
      h = h * (1 - depthT) + bed * depthT;
    }
    // Map border rises a little (hills behind the forests).
    const edge = Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
    h += smoothstep(6, 0, edge) * 1.5;
    return h;
  }

  generateHeights() {
    const n = MAP_SIZE + 1;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) this.heights[z * n + x] = this.rawHeight(x, z);
    // Flatten building spots.
    for (const s of this.flatSpots) {
      let sum = 0;
      let cnt = 0;
      const r0 = Math.ceil(s.radius);
      for (let z = Math.floor(s.z - r0); z <= s.z + r0; z++) {
        for (let x = Math.floor(s.x - r0); x <= s.x + r0; x++) {
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          sum += this.heights[z * n + x];
          cnt++;
        }
      }
      const target = cnt ? sum / cnt : 0;
      const outer = s.radius + 3;
      for (let z = Math.floor(s.z - outer); z <= s.z + outer; z++) {
        for (let x = Math.floor(s.x - outer); x <= s.x + outer; x++) {
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const d = Math.hypot(x - s.x, z - s.z);
          const t = smoothstep(outer, s.radius, d);
          const i = z * n + x;
          this.heights[i] = this.heights[i] * (1 - t) + target * t;
        }
      }
    }
  }

  heightAt(x, z) {
    const n = MAP_SIZE + 1;
    x = Math.min(MAP_SIZE - 0.001, Math.max(0, x));
    z = Math.min(MAP_SIZE - 0.001, Math.max(0, z));
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fz = z - zi;
    const h = this.heights;
    const a = h[zi * n + xi];
    const b = h[zi * n + xi + 1];
    const c = h[(zi + 1) * n + xi];
    const d = h[(zi + 1) * n + xi + 1];
    return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
  }

  /** Classify every cell and mark unwalkable water in the path grid. */
  classify() {
    const { roads } = this.layout;
    for (let cz = 0; cz < MAP_SIZE; cz++) {
      for (let cx = 0; cx < MAP_SIZE; cx++) {
        const x = cx + 0.5;
        const z = cz + 0.5;
        const i = cz * MAP_SIZE + cx;
        const h = this.heightAt(x, z);
        let t = T_GRASS;
        const r = Math.hypot(x - CENTER, z - CENTER);
        if (h < WATER_LEVEL - 0.05) t = T_SHORE;
        else if (h < WATER_LEVEL + 0.35) t = T_SHORE;
        // Roads
        let rd = Infinity;
        for (const road of roads) {
          for (let k = 0; k < road.length - 1; k++) {
            rd = Math.min(rd, distToSegment(x, z, road[k][0], road[k][1], road[k + 1][0], road[k + 1][1]));
          }
        }
        this.roadDist ??= new Float32Array(MAP_SIZE * MAP_SIZE);
        this.roadDist[i] = rd;
        if (t === T_GRASS) {
          if (rd < 1.4) t = T_ROAD;
          else if (rd < 2.4 + valueNoise(x * 0.4, z * 0.4, 5) * 1.2) t = T_DIRT;
        }
        // Citadel cobbles and blight.
        const half = CITADEL.half;
        if (Math.abs(x - CENTER) < half + 0.5 && Math.abs(z - CENTER) < half + 0.5) t = T_COBBLE;
        else if (r < 23 + fbm(x * 0.2, z * 0.2, 9, 2) * 2 && t !== T_ROAD && t !== T_SHORE) t = T_BLIGHT;
        this.types[i] = t;
        // Deep water is unwalkable.
        if (h < -0.75) this.grid.setFlag(cx, cz, BLOCK_TERRAIN, true);
        // Map border.
        if (cx < 1 || cz < 1 || cx >= MAP_SIZE - 1 || cz >= MAP_SIZE - 1) this.grid.setFlag(cx, cz, BLOCK_TERRAIN, true);
      }
    }
  }

  /** Scatter forests. `keepClear(x, z)` returns true where trees must not grow. */
  plantTrees(keepClear) {
    const rand = mulberry32(this.seed + 99);
    for (let cz = 1; cz < MAP_SIZE - 1; cz++) {
      for (let cx = 1; cx < MAP_SIZE - 1; cx++) {
        const x = cx + 0.5;
        const z = cz + 0.5;
        const i = cz * MAP_SIZE + cx;
        if (this.grid.flags[i] !== 0) continue;
        const t = this.types[i];
        if (t === T_ROAD || t === T_COBBLE || t === T_SHORE) continue;
        if (this.roadDist[i] < 3.2) continue;
        if (keepClear(x, z)) continue;
        const edge = Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
        const r = Math.hypot(x - CENTER, z - CENTER);
        if (r < MOAT.outer + 3.5) continue;
        const n = fbm(x * 0.07, z * 0.07, this.seed + 21, 3);
        let p = 0;
        if (edge < 7) p = 0.92;
        else if (edge < 10) p = 0.55;
        // Corner groves behind each base (lumber for the starting peasants).
        const cornerDist = Math.min(
          Math.hypot(x, z), Math.hypot(MAP_SIZE - x, z), Math.hypot(x, MAP_SIZE - z), Math.hypot(MAP_SIZE - x, MAP_SIZE - z),
        );
        if (cornerDist < 34) p = Math.max(p, 0.9);
        if (n > 0.24) p = Math.max(p, 0.75);
        else if (n > 0.15) p = Math.max(p, 0.2);
        if (rand() < p) {
          const species = t === T_BLIGHT ? 2 : rand() < 0.55 ? 0 : 1;
          this.trees.push({
            x: x + (rand() - 0.5) * 0.35,
            z: z + (rand() - 0.5) * 0.35,
            cx,
            cz,
            lumber: 50,
            alive: true,
            species,
            scale: 0.7 + rand() * 0.3,
            rot: rand() * Math.PI * 2,
            index: -1,
          });
          this.types[i] = this.types[i] === T_GRASS ? T_FOREST : this.types[i];
          this.grid.setFlag(cx, cz, BLOCK_TREE, true);
        }
      }
    }
    this.treeByCell = new Map();
    for (const tr of this.trees) this.treeByCell.set(tr.cz * MAP_SIZE + tr.cx, tr);
  }

  treeAtCell(cx, cz) {
    const t = this.treeByCell.get(cz * MAP_SIZE + cx);
    return t && t.alive ? t : null;
  }

  // ------------------------------------------------------------------ meshes
  buildMeshes() {
    this.buildGround();
    this.buildWater();
    this.buildTrees();
    this.buildDoodads();
  }

  paintTexture() {
    const RES = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = RES;
    canvas.height = RES;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(RES, RES);
    const data = img.data;
    const S = MAP_SIZE;

    // Per-cell base colors (with slight per-cell variation).
    const cellCol = new Float32Array(S * S * 3);
    const cobbleW = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const cx = i % S;
      const cz = (i - cx) / S;
      const c = TYPE_COLORS[this.types[i]];
      const v = 0.92 + valueNoise(cx * 0.31, cz * 0.31, 3) * 0.16;
      const tint = fbm(cx * 0.05, cz * 0.05, 11, 2) * 0.06;
      cellCol[i * 3] = c[0] * v + tint * 0.4;
      cellCol[i * 3 + 1] = c[1] * v + tint;
      cellCol[i * 3 + 2] = c[2] * v;
      cobbleW[i] = this.types[i] === T_COBBLE ? 1 : 0;
    }
    // Fine noise tile.
    const NT = 256;
    const fine = new Float32Array(NT * NT);
    const rand = mulberry32(4242);
    for (let i = 0; i < NT * NT; i++) fine[i] = rand();
    // Smooth the fine noise a bit (blur pass) for blades/specks.
    const fine2 = new Float32Array(NT * NT);
    for (let y = 0; y < NT; y++) {
      for (let x = 0; x < NT; x++) {
        let s = 0;
        for (let k = -1; k <= 1; k++) s += fine[y * NT + ((x + k + NT) % NT)] + fine[((y + k + NT) % NT) * NT + x];
        fine2[y * NT + x] = fine[y * NT + x] * 0.6 + (s / 6) * 0.4;
      }
    }
    // Low-frequency warp so borders between ground types look organic.
    const WN = S + 1;
    const warpX = new Float32Array(WN * WN);
    const warpZ = new Float32Array(WN * WN);
    for (let z = 0; z < WN; z++) {
      for (let x = 0; x < WN; x++) {
        warpX[z * WN + x] = fbm(x * 0.25, z * 0.25, 31, 2) * 0.9;
        warpZ[z * WN + x] = fbm(x * 0.25, z * 0.25, 57, 2) * 0.9;
      }
    }
    const sampleBil = (arr, W, x, z) => {
      const xi = Math.max(0, Math.min(W - 2, Math.floor(x)));
      const zi = Math.max(0, Math.min(W - 2, Math.floor(z)));
      const fx = Math.min(1, Math.max(0, x - xi));
      const fz = Math.min(1, Math.max(0, z - zi));
      const a = arr[zi * W + xi];
      const b = arr[zi * W + xi + 1];
      const c = arr[(zi + 1) * W + xi];
      const d = arr[(zi + 1) * W + xi + 1];
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };

    const scale = S / RES;
    for (let py = 0; py < RES; py++) {
      const wz = (py + 0.5) * scale;
      for (let px = 0; px < RES; px++) {
        const wx = (px + 0.5) * scale;
        const sx = wx + sampleBil(warpX, WN, wx, wz) - 0.5;
        const sz = wz + sampleBil(warpZ, WN, wx, wz) - 0.5;
        // Bilinear blend of cell colors.
        const xi = Math.max(0, Math.min(S - 2, Math.floor(sx)));
        const zi = Math.max(0, Math.min(S - 2, Math.floor(sz)));
        let fx = Math.min(1, Math.max(0, sx - xi));
        let fz = Math.min(1, Math.max(0, sz - zi));
        // Sharpen the blend a little.
        fx = fx * fx * (3 - 2 * fx);
        fz = fz * fz * (3 - 2 * fz);
        const i00 = (zi * S + xi) * 3;
        const i10 = i00 + 3;
        const i01 = i00 + S * 3;
        const i11 = i01 + 3;
        const w00 = (1 - fx) * (1 - fz);
        const w10 = fx * (1 - fz);
        const w01 = (1 - fx) * fz;
        const w11 = fx * fz;
        let r = cellCol[i00] * w00 + cellCol[i10] * w10 + cellCol[i01] * w01 + cellCol[i11] * w11;
        let g = cellCol[i00 + 1] * w00 + cellCol[i10 + 1] * w10 + cellCol[i01 + 1] * w01 + cellCol[i11 + 1] * w11;
        let b = cellCol[i00 + 2] * w00 + cellCol[i10 + 2] * w10 + cellCol[i01 + 2] * w01 + cellCol[i11 + 2] * w11;
        const ci = i00 / 3;
        const cw = cobbleW[ci] * w00 + cobbleW[ci + 1] * w10 + cobbleW[ci + S] * w01 + cobbleW[ci + S + 1] * w11;
        const fn = fine2[(py & (NT - 1)) * NT + (px & (NT - 1))];
        let m = 0.86 + fn * 0.28;
        if (cw > 0.3) {
          // Cobblestone pattern.
          const bx = wx * 2.2 + (Math.floor(wz * 2.2) % 2) * 0.5;
          const bz = wz * 2.2;
          const ex = Math.abs(bx - Math.round(bx));
          const ez = Math.abs(bz - Math.round(bz));
          if (ex < 0.07 || ez < 0.07) m *= 1 - 0.35 * cw;
        }
        r *= m;
        g *= m;
        b *= m;
        const o = (py * RES + px) * 4;
        data[o] = Math.min(255, r * 255);
        data[o + 1] = Math.min(255, g * 255);
        data[o + 2] = Math.min(255, b * 255);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.textureCanvas = canvas;
    return canvas;
  }

  buildGround() {
    const S = MAP_SIZE;
    const geom = new THREE.PlaneGeometry(S, S, S, S);
    geom.rotateX(-Math.PI / 2);
    geom.translate(S / 2, 0, S / 2);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const xi = Math.round(x);
      const zi = Math.round(z);
      pos.setY(i, this.heights[zi * (S + 1) + xi]);
    }
    geom.computeVertexNormals();
    const canvas = this.paintTexture();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const material = patchFog(new THREE.MeshLambertMaterial({ map: tex }));
    // A tiling detail texture keeps the ground crisp up close on the large map.
    const detail = makeDetailTexture();
    const fogCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader) => {
      fogCompile(shader);
      shader.uniforms.uDetail = { value: detail };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float dA = texture2D(uDetail, vFogWorldPos.xz * 0.37).r;
          float dB = texture2D(uDetail, vFogWorldPos.xz * 0.091 + 0.37).g;
          diffuseColor.rgb *= 0.62 + 0.5 * dA + 0.26 * (dB - 0.5);`,
        );
    };
    material.customProgramCacheKey = () => 'ground-detail';
    const m = new THREE.Mesh(geom, material);
    m.receiveShadow = true;
    m.name = 'ground';
    this.groundMesh = m;
    this.group.add(m);
  }

  buildWater() {
    const geomW = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1);
    geomW.rotateX(-Math.PI / 2);
    geomW.translate(MAP_SIZE / 2, WATER_LEVEL, MAP_SIZE / 2);
    this.waterUniforms = { uTime: { value: 0 } };
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.waterUniforms.uTime,
        uFogTex: fogUniforms.uFogTex,
        uWorldSize: fogUniforms.uWorldSize,
        uFogEnabled: fogUniforms.uFogEnabled,
      },
      vertexShader: `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        varying vec3 vW;
        uniform float uTime;
        uniform sampler2D uFogTex;
        uniform vec2 uWorldSize;
        uniform float uFogEnabled;
        void main() {
          float w1 = sin(vW.x * 1.3 + uTime * 1.1) * sin(vW.z * 1.1 - uTime * 0.9);
          float w2 = sin((vW.x + vW.z) * 2.3 + uTime * 1.7);
          float s = w1 * 0.5 + w2 * 0.25;
          vec3 deep = vec3(0.08, 0.27, 0.42);
          vec3 light = vec3(0.32, 0.6, 0.72);
          vec3 col = mix(deep, light, 0.45 + s * 0.25);
          col += vec3(0.9) * smoothstep(0.62, 0.75, s) * 0.35;
          float fogV = texture2D(uFogTex, vW.xz / uWorldSize).r;
          col *= mix(1.0, fogV, uFogEnabled);
          gl_FragColor = vec4(col, 0.78);
        }`,
    });
    const water = new THREE.Mesh(geomW, material);
    water.renderOrder = 1;
    this.group.add(water);
  }

  buildTrees() {
    // Three species: 0 summer pine, 1 broadleaf ash, 2 dead/blighted tree.
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.16, 1.0, 6);
    trunkGeo.translate(0, 0.5, 0);
    const pineGeo = (() => {
      const parts = [];
      const a = new THREE.ConeGeometry(0.85, 1.3, 7);
      a.translate(0, 1.35, 0);
      const b = new THREE.ConeGeometry(0.68, 1.15, 7);
      b.translate(0, 2.0, 0);
      const c = new THREE.ConeGeometry(0.45, 0.95, 7);
      c.translate(0, 2.6, 0);
      parts.push(a, b, c);
      return mergeGeometries(parts);
    })();
    const ashGeo = (() => {
      const a = new THREE.IcosahedronGeometry(0.85, 0);
      a.translate(0, 1.85, 0);
      const b = new THREE.IcosahedronGeometry(0.6, 0);
      b.translate(0.45, 1.5, 0.2);
      const c = new THREE.IcosahedronGeometry(0.58, 0);
      c.translate(-0.4, 1.55, -0.25);
      const d = new THREE.IcosahedronGeometry(0.5, 0);
      d.translate(0.05, 2.45, 0.1);
      return mergeGeometries([a, b, c, d]);
    })();
    const deadGeo = (() => {
      const a = new THREE.ConeGeometry(0.06, 1.0, 4);
      a.rotateZ(0.9);
      a.translate(0.35, 1.5, 0);
      const b = new THREE.ConeGeometry(0.05, 0.9, 4);
      b.rotateZ(-0.8);
      b.translate(-0.3, 1.7, 0.1);
      const c = new THREE.ConeGeometry(0.05, 0.8, 4);
      c.rotateX(0.8);
      c.translate(0, 1.6, 0.3);
      const d = new THREE.ConeGeometry(0.08, 1.2, 5);
      d.translate(0, 1.9, 0);
      return mergeGeometries([a, b, c, d]);
    })();

    // Trees are batched per 32x32-cell chunk so off-screen forests are culled
    // (in both the main and the shadow pass).
    const CH = 32;
    const chunksPerSide = Math.ceil(MAP_SIZE / CH);
    const trunkMat = mat(0x6b4a2b);
    const leafMats = [mat(0xffffff), mat(0xffffff), mat(0x4a3a40)];
    const canopyGeos = [pineGeo, ashGeo, deadGeo];
    const buckets = new Map();
    for (const t of this.trees) {
      const key = `${Math.floor(t.cx / CH) + Math.floor(t.cz / CH) * chunksPerSide}:${t.species}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const rand = mulberry32(this.seed + 7);
    for (const list of buckets.values()) {
      const s = list[0].species;
      const trunks = new THREE.InstancedMesh(trunkGeo, s === 2 ? mat(0x3d3236) : trunkMat, list.length);
      const canopy = new THREE.InstancedMesh(canopyGeos[s], leafMats[s], list.length);
      trunks.castShadow = true;
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      list.forEach((t, i) => {
        t.index = i;
        t.mesh = { trunks, canopy };
        dummy.position.set(t.x, this.heightAt(t.x, t.z) - 0.05, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        canopy.setMatrixAt(i, dummy.matrix);
        if (s === 0) color.setRGB(0.13 + rand() * 0.05, 0.36 + rand() * 0.1, 0.16 + rand() * 0.05);
        else if (s === 1) color.setRGB(0.27 + rand() * 0.1, 0.5 + rand() * 0.12, 0.14 + rand() * 0.05);
        else color.setRGB(0.32, 0.27, 0.3);
        canopy.setColorAt(i, color);
      });
      trunks.instanceMatrix.needsUpdate = true;
      canopy.instanceMatrix.needsUpdate = true;
      if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
      trunks.computeBoundingSphere();
      canopy.computeBoundingSphere();
      this.group.add(trunks, canopy);
    }
  }

  /** Remove a chopped-down tree. */
  fellTree(tree) {
    if (!tree.alive) return;
    tree.alive = false;
    const tm = tree.mesh;
    const dummy = new THREE.Object3D();
    dummy.position.set(tree.x, this.heightAt(tree.x, tree.z) - 0.05, tree.z);
    dummy.scale.set(tree.scale * 1.3, 0.12, tree.scale * 1.3);
    dummy.updateMatrix();
    tm.trunks.setMatrixAt(tree.index, dummy.matrix);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    tm.canopy.setMatrixAt(tree.index, dummy.matrix);
    tm.trunks.instanceMatrix.needsUpdate = true;
    tm.canopy.instanceMatrix.needsUpdate = true;
    this.grid.setFlag(tree.cx, tree.cz, BLOCK_TREE, false);
    this.types[tree.cz * MAP_SIZE + tree.cx] = T_GRASS;
  }

  buildDoodads() {
    const rand = mulberry32(this.seed + 31);
    const rocks = [];
    const bushes = [];
    const flowers = [];
    for (let i = 0; i < Math.round(2600 * (MAP_SIZE / 160) ** 2); i++) {
      const x = 2 + rand() * (MAP_SIZE - 4);
      const z = 2 + rand() * (MAP_SIZE - 4);
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      const ci = cz * MAP_SIZE + cx;
      if (this.grid.flags[ci] & BLOCK_TERRAIN) continue;
      const t = this.types[ci];
      if (t === T_ROAD || t === T_COBBLE) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.1) continue;
      if (this.isNearFlatSpot(x, z)) continue;
      const roll = rand();
      if (t === T_FOREST || t === T_BLIGHT) {
        if (roll < 0.35) rocks.push({ x, z, s: 0.25 + rand() * 0.35 });
        else if (roll < 0.75 && t !== T_BLIGHT) bushes.push({ x, z, s: 0.3 + rand() * 0.35 });
      } else if (t === T_GRASS) {
        if (roll < 0.06) rocks.push({ x, z, s: 0.2 + rand() * 0.3 });
        else if (roll < 0.16) bushes.push({ x, z, s: 0.25 + rand() * 0.3 });
        else if (roll < 0.36) flowers.push({ x, z, s: 0.5 + rand() * 0.6 });
      }
    }
    const dummy = new THREE.Object3D();
    const place = (list, geometry, material, castShadow, yOff, colorFn) => {
      const im = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
      im.count = list.length;
      const col = new THREE.Color();
      list.forEach((d, i) => {
        dummy.position.set(d.x, this.heightAt(d.x, d.z) + yOff * d.s, d.z);
        dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.3);
        dummy.scale.set(d.s, d.s * (0.7 + rand() * 0.5), d.s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        if (colorFn) {
          colorFn(col);
          im.setColorAt(i, col);
        }
      });
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    };
    place(rocks, geo.dodeca(1, 0), mat(0xffffff), true, 0.3, (c) => {
      const v = 0.45 + rand() * 0.2;
      c.setRGB(v, v * 0.97, v * 0.92);
    });
    place(bushes, geo.ico(1, 0), mat(0xffffff), true, 0.5, (c) => c.setRGB(0.18 + rand() * 0.1, 0.38 + rand() * 0.12, 0.12));
    const flowerGeo = geo.custom('flowerpatch', () => {
      const parts = [];
      for (let k = 0; k < 5; k++) {
        const p = new THREE.OctahedronGeometry(0.07, 0);
        const a = (k / 5) * Math.PI * 2;
        p.translate(Math.cos(a) * 0.22, 0.06, Math.sin(a) * 0.22);
        parts.push(p);
      }
      return mergeGeometries(parts);
    });
    place(flowers, flowerGeo, mat(0xffffff, { flat: true }), false, 0, (c) => {
      const pal = [[1, 0.9, 0.3], [1, 1, 1], [0.9, 0.4, 0.8], [0.5, 0.6, 1], [1, 0.5, 0.3]];
      const p = pal[Math.floor(rand() * pal.length)];
      c.setRGB(p[0], p[1], p[2]);
    });
  }

  isNearFlatSpot(x, z) {
    for (const s of this.flatSpots) if (Math.hypot(x - s.x, z - s.z) < s.radius + 1.5) return true;
    return false;
  }

  update(time) {
    if (this.waterUniforms) this.waterUniforms.uTime.value = time;
  }
}

/** Grayscale tiling noise (R: fine blades/specks, G: soft blotches) for ground detail. */
function makeDetailTexture() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const rand = mulberry32(777);
  const fine = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) fine[i] = rand();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Short vertical streaks read as grass blades from the RTS camera.
      let v = 0;
      for (let k = 0; k < 3; k++) v += fine[((y + k) % N) * N + x];
      v = v / 3;
      // Tileable soft noise from wrapped value noise.
      const u = (x / N) * 8;
      const w = (y / N) * 8;
      const s = valueNoiseWrap(u, w, 8);
      const o = (y * N + x) * 4;
      img.data[o] = Math.round(v * 255);
      img.data[o + 1] = Math.round(s * 255);
      img.data[o + 2] = 0;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function valueNoiseWrap(x, z, period) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const h = (a, b) => valueNoise(((a % period) + period) % period, ((b % period) + period) % period, 99);
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Minimal geometry merge (non-indexed output) to avoid pulling in addons. */
export function mergeGeometries(geoms) {
  let total = 0;
  const prepared = geoms.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    total += ng.attributes.position.count;
    return ng;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of prepared) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
