// Building-placement ghost and road/wall line preview on Babylon (the logic is in src/input.js).
// Same look as the original three.js previews: a see-through green or red copy of the building over its
// footprint tiles, and one translucent block per road or wall cell.
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { ModelInstance, ModelLibrary } from './ModelLibrary';
import { TeamColorPlugin } from './TeamColor';
import type { FogOfWarPlugin } from './FogOfWar';
import { hexToColor3 } from './FxKit';

function basic(scene: Scene, name: string, color: number, opacity: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = hexToColor3(color);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.alpha = opacity;
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.disableDepthWrite = true;
  const fog = m.pluginManager?.getPlugin('FogOfWar') as FogOfWarPlugin | null;
  if (fog) fog.fogEnabled = false;
  return m;
}

export class Previews {
  private readonly ok: StandardMaterial;
  private readonly bad: StandardMaterial;
  private readonly lineMat: StandardMaterial;
  private placement: { model: ModelInstance; tiles: Mesh } | null = null;
  private line: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly models: ModelLibrary,
  ) {
    this.ok = basic(scene, 'ghost-ok', 0x40ff60, 0.45);
    this.bad = basic(scene, 'ghost-bad', 0xff3030, 0.45);
    // Line blocks: white, coloured per instance (the colour goes in through the emissive term).
    this.lineMat = basic(scene, 'line-preview', 0x000000, 0.5);
    new TeamColorPlugin(this.lineMat, null, [1, 0, 0, 0]);
  }

  beginPlacement(modelId: string, _color: number, footprint: number): void {
    this.endPlacement();
    const model = this.models.instantiateFlat(modelId, this.ok, 'placement');
    const tiles = CreateGround('placement-tiles', { width: footprint, height: footprint, subdivisions: footprint }, this.scene);
    tiles.material = this.ok;
    tiles.position.y = 0.12;
    tiles.parent = model.root;
    tiles.isPickable = false;
    model.root.setEnabled(false);
    this.placement = { model, tiles };
  }

  updatePlacement(x: number, y: number, z: number, ok: boolean): void {
    const pl = this.placement;
    if (!pl) return;
    pl.model.root.setEnabled(true);
    pl.model.root.position.set(x, y, z);
    const m = ok ? this.ok : this.bad;
    if (pl.tiles.material !== m) {
      pl.tiles.material = m;
      for (const mesh of pl.model.meshes) mesh.material = m;
    }
  }

  endPlacement(): void {
    if (!this.placement) return;
    this.placement.model.dispose();
    this.placement.tiles.dispose();
    this.placement = null;
  }

  beginLine(_maxCells: number): void {
    this.endLine();
    const box = CreateBox('line-preview', { width: 0.96, height: 1, depth: 0.96 }, this.scene);
    box.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    box.material = this.lineMat;
    box.isPickable = false;
    box.alwaysSelectAsActiveMesh = true;
    box.hasVertexAlpha = false;
    box.setEnabled(false);
    this.line = box;
  }

  updateLine(cells: Array<[number, number, number]>, ok: boolean[], tall: number): void {
    const box = this.line;
    if (!box) return;
    if (!cells.length) {
      box.setEnabled(false);
      return;
    }
    const matrices = new Float32Array(cells.length * 16);
    const colors = new Float32Array(cells.length * 4);
    const q = Quaternion.Identity();
    cells.forEach(([x, y, z], i) => {
      Matrix.Compose(new Vector3(1, tall, 1), q, new Vector3(x, y, z)).copyToArray(matrices, i * 16);
      const c = hexToColor3(ok[i] ? 0x40ff60 : 0xff3030);
      colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    box.thinInstanceSetBuffer('matrix', matrices, 16, false);
    box.thinInstanceSetBuffer('color', colors, 4, false);
    box.setEnabled(true);
  }

  endLine(): void {
    this.line?.dispose();
    this.line = null;
  }
}
