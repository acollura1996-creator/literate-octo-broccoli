// three.js meshes for the terrain data (src/world/terrain.js): the painted ground with its detail
// map, the moat water, instanced trees and doodads, the road surface and the fog-of-war texture.
import * as THREE from 'three';
import { MAP_SIZE } from '../world/layout.js';
import { WATER_LEVEL } from '../world/terrain.js';
import { makeDetailCanvas, makeCobbleCanvas, roadGeometry } from '../world/groundArt.js';
import { fogUniforms, patchFog, mat, geo } from './assets.js';

export class TerrainView {
  constructor(terrain, scene) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.treeMeshes = new Map(); // tree -> { trunks, canopy, index }
    this.felledSeen = 0;
    this.buildGround();
    this.buildWater();
    this.buildTrees();
    this.buildDoodads();
    scene.add(this.group);
  }

  /** Per frame: animate the water and turn newly felled trees into stumps. */
  update(time) {
    this.waterUniforms.uTime.value = time;
    const felled = this.terrain.felled;
    while (this.felledSeen < felled.length) this.fellTree(felled[this.felledSeen++]);
  }

  buildGround() {
    const t = this.terrain;
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
      pos.setY(i, t.heights[zi * (S + 1) + xi]);
    }
    geom.computeVertexNormals();
    const canvas = t.textureCanvas ?? t.paintTexture();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const material = patchFog(new THREE.MeshLambertMaterial({ map: tex }));
    // A tiling detail texture keeps the ground crisp up close on the large map.
    const detail = new THREE.CanvasTexture(makeDetailCanvas());
    detail.wrapS = THREE.RepeatWrapping;
    detail.wrapT = THREE.RepeatWrapping;
    detail.anisotropy = 8;
    detail.generateMipmaps = true;
    detail.minFilter = THREE.LinearMipmapLinearFilter;
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
      const a = new THREE.ConeGeometry(0.85, 1.3, 7);
      a.translate(0, 1.35, 0);
      const b = new THREE.ConeGeometry(0.68, 1.15, 7);
      b.translate(0, 2.0, 0);
      const c = new THREE.ConeGeometry(0.45, 0.95, 7);
      c.translate(0, 2.6, 0);
      return mergeGeometries([a, b, c]);
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
    for (const t of this.terrain.trees) {
      const key = `${Math.floor(t.cx / CH) + Math.floor(t.cz / CH) * chunksPerSide}:${t.species}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (const list of buckets.values()) {
      const s = list[0].species;
      const trunks = new THREE.InstancedMesh(trunkGeo, s === 2 ? mat(0x3d3236) : trunkMat, list.length);
      const canopy = new THREE.InstancedMesh(canopyGeos[s], leafMats[s], list.length);
      trunks.castShadow = true;
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      list.forEach((t, i) => {
        this.treeMeshes.set(t, { trunks, canopy, index: i });
        dummy.position.set(t.x, this.terrain.heightAt(t.x, t.z) - 0.05, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        canopy.setMatrixAt(i, dummy.matrix);
        canopy.setColorAt(i, color.setRGB(t.tint[0], t.tint[1], t.tint[2]));
      });
      trunks.instanceMatrix.needsUpdate = true;
      canopy.instanceMatrix.needsUpdate = true;
      if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
      trunks.computeBoundingSphere();
      canopy.computeBoundingSphere();
      this.group.add(trunks, canopy);
    }
  }

  /** A felled tree leaves a low stump and no canopy. */
  fellTree(tree) {
    const tm = this.treeMeshes.get(tree);
    if (!tm) return;
    const dummy = new THREE.Object3D();
    dummy.position.set(tree.x, this.terrain.heightAt(tree.x, tree.z) - 0.05, tree.z);
    dummy.scale.set(tree.scale * 1.3, 0.12, tree.scale * 1.3);
    dummy.updateMatrix();
    tm.trunks.setMatrixAt(tm.index, dummy.matrix);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    tm.canopy.setMatrixAt(tm.index, dummy.matrix);
    tm.trunks.instanceMatrix.needsUpdate = true;
    tm.canopy.instanceMatrix.needsUpdate = true;
  }

  buildDoodads() {
    const { rocks, bushes, flowers } = this.terrain.doodads ?? this.terrain.scatterDoodads();
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const place = (list, geometry, material, castShadow) => {
      const im = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
      im.count = list.length;
      list.forEach((d, i) => {
        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
        dummy.scale.set(d.scale[0], d.scale[1], d.scale[2]);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, col.setRGB(d.color[0], d.color[1], d.color[2]));
      });
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    };
    place(rocks, geo.dodeca(1, 0), mat(0xffffff), true);
    place(bushes, geo.ico(1, 0), mat(0xffffff), true);
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
    place(flowers, flowerGeo, mat(0xffffff, { flat: true }), false);
  }
}

/** The road surface mesh, rebuilt when the road network or a general's age changes. */
export class RoadMesh {
  constructor(roads, game, scene) {
    this.roads = roads;
    this.game = game;
    this.scene = scene;
    this.version = -1;
    this.mesh = null;
    const tex = new THREE.CanvasTexture(makeCobbleCanvas());
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.material = patchFog(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
    this.material.polygonOffset = true;
    this.material.polygonOffsetFactor = -2;
    this.material.polygonOffsetUnits = -2;
  }

  update() {
    if (this.version === this.roads.version) return;
    this.version = this.roads.version;
    const r = roadGeometry(this.roads, this.game);
    const idx = new Uint32Array(r.quads * 6);
    for (let q = 0; q < r.quads; q++) idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2));
    geom.setAttribute('color', new THREE.BufferAttribute(r.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geom;
    } else {
      this.mesh = new THREE.Mesh(geom, this.material);
      this.mesh.receiveShadow = true;
      this.mesh.renderOrder = 1;
      this.scene.add(this.mesh);
    }
  }
}

/** Uploads the fog-of-war grid (src/game/fog.js) to the texture every material samples. */
export class FogTexture {
  constructor(fog) {
    this.fog = fog;
    this.version = -1;
    this.texture = new THREE.DataTexture(fog.texData, fog.size, fog.size, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    fogUniforms.uFogTex.value = this.texture;
    fogUniforms.uWorldSize.value.set(fog.size, fog.size);
  }

  update() {
    if (this.version === this.fog.version) return;
    this.version = this.fog.version;
    this.texture.needsUpdate = true;
  }
}

/** Minimal geometry merge (non-indexed output) to avoid pulling in addons. */
function mergeGeometries(geoms) {
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
