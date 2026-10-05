// Placeholder unit visuals until the baked models arrive (milestone 4): a team-coloured column
// per unit and a block per building, sized from the legacy model, positioned and hidden exactly
// as the legacy unit view is (fog of war, death, flying height).
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
// Side effect: adds instancing (createInstance, registerInstancedBuffer) to Mesh.
import '@babylonjs/core/Meshes/instancedMesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { UnitLike } from './types';

interface Marker {
  unit: UnitLike;
  mesh: InstancedMesh;
}

function teamColor(hex: number): Color4 {
  return new Color4(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1);
}

export class UnitMarkers {
  private readonly unitBase: Mesh;
  private readonly buildingBase: Mesh;
  private readonly markers = new Map<number, Marker>();

  constructor(scene: Scene) {
    const mat = new StandardMaterial('marker', scene);
    mat.specularColor = Color3.Black();
    mat.diffuseColor = Color3.White();
    this.unitBase = CreateCylinder('unit-marker', { diameter: 1, height: 1, tessellation: 10 }, scene);
    this.unitBase.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    this.buildingBase = CreateBox('building-marker', { size: 1 }, scene);
    this.buildingBase.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    for (const base of [this.unitBase, this.buildingBase]) {
      base.material = mat;
      base.registerInstancedBuffer('color', 4);
      base.instancedBuffers.color = new Color4(1, 1, 1, 1);
      base.isVisible = false;
      base.isPickable = false;
    }
  }

  add(u: UnitLike): void {
    const base = u.isBuilding ? this.buildingBase : this.unitBase;
    const mesh = base.createInstance(`u${u.id}`);
    mesh.isPickable = false;
    mesh.instancedBuffers.color = teamColor(u.def.modelColor ?? u.owner.color);
    this.markers.set(u.id, { unit: u, mesh });
  }

  remove(u: UnitLike): void {
    const m = this.markers.get(u.id);
    if (!m) return;
    m.mesh.dispose();
    this.markers.delete(u.id);
  }

  clear(): void {
    for (const m of this.markers.values()) m.mesh.dispose();
    this.markers.clear();
  }

  sync(): void {
    for (const { unit: u, mesh } of this.markers.values()) {
      const v = u.view;
      const visible = !!v?.visibleNow && !u.dead && !u.removed;
      mesh.setEnabled(visible);
      if (!visible || !v) continue;
      const p = v.group?.position;
      mesh.position.set(u.x, p ? p.y : 0, u.z);
      mesh.rotation.y = u.isBuilding ? 0 : u.facing;
      const s = u.mods.scale || 1;
      const h = (v.height ?? 1.2) * s;
      if (u.isBuilding) {
        const f = (u.def.footprint ?? 2) * 0.9;
        mesh.scaling.set(f, h, f);
      } else {
        const d = Math.max(0.3, u.radius * 2 * s);
        mesh.scaling.set(d, h, d);
      }
    }
  }
}
