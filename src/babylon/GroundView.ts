// The terrain heightfield with the painted ground map. Milestone 2 version: the same mesh layout
// and painted texture as the three.js ground; detail map, water, trees, doodads, roads and fog of
// war follow in milestone 3.
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TerrainLike } from './types';

export class GroundView {
  readonly terrain: TerrainLike;
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture | null;

  constructor(scene: Scene, terrain: TerrainLike) {
    this.terrain = terrain;
    const S = terrain.size;
    const n = S + 1;
    const h = terrain.heights;
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    const at = (x: number, z: number): number => h[Math.min(S, Math.max(0, z)) * n + Math.min(S, Math.max(0, x))]!;
    for (let z = 0; z <= S; z++) {
      for (let x = 0; x <= S; x++) {
        const i = z * n + x;
        positions[i * 3] = x;
        positions[i * 3 + 1] = at(x, z);
        positions[i * 3 + 2] = z;
        // Normal from central differences of the heightfield.
        const nx = at(x - 1, z) - at(x + 1, z);
        const nz = at(x, z - 1) - at(x, z + 1);
        const len = Math.hypot(nx, 2, nz);
        normals[i * 3] = nx / len;
        normals[i * 3 + 1] = 2 / len;
        normals[i * 3 + 2] = nz / len;
        // Canvas row 0 is world z = 0 (as in the three.js ground).
        uvs[i * 2] = x / S;
        uvs[i * 2 + 1] = 1 - z / S;
      }
    }
    const indices = new Uint32Array(S * S * 6);
    let k = 0;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const a = z * n + x;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // Babylon's front-face winding, which it keeps in right-handed scenes too: the opposite
        // of three.js (same order as MeshBuilder.CreateGround).
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = c;
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    this.mesh = new Mesh('ground', scene);
    data.applyToMesh(this.mesh, false);
    this.mesh.isPickable = false;
    this.mesh.freezeWorldMatrix();

    this.material = new StandardMaterial('ground', scene);
    this.material.specularColor = Color3.Black();
    this.texture = null;
    if (terrain.textureCanvas) {
      const tex = new DynamicTexture('ground-paint', terrain.textureCanvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
      tex.anisotropicFilteringLevel = 8;
      tex.update(true);
      this.texture = tex;
      this.material.diffuseTexture = tex;
    } else {
      this.material.diffuseColor = new Color3(0.36, 0.56, 0.18);
    }
    this.mesh.material = this.material;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}
