// Building-placement ghost and road/wall line preview (three.js). The placement and line logic
// lives in src/input.js; this only draws it.
import * as THREE from 'three';
import { createModel } from './models.js';

const linePreviewMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
const ghostOk = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.45, depthWrite: false });

export class Previews {
  constructor(scene) {
    this.scene = scene;
    this.placement = null;
    this.line = null;
  }

  /** A see-through copy of a building and its footprint tiles. */
  beginPlacement(modelId, color, footprint) {
    this.endPlacement();
    const m = createModel(modelId, color);
    const ghost = new THREE.Group();
    ghost.add(m.root);
    const fp = footprint;
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(fp, fp, fp, fp), ghostOk);
    tiles.rotation.x = -Math.PI / 2;
    tiles.position.y = 0.12;
    ghost.add(tiles);
    const meshes = [];
    m.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    this.scene.add(ghost);
    this.placement = { ghost, tiles, meshes };
  }

  /** Move the ghost; green where it can be built, red where not. */
  updatePlacement(x, y, z, ok) {
    const pl = this.placement;
    if (!pl) return;
    pl.ghost.position.set(x, y, z);
    const m = ok ? ghostOk : ghostBad;
    pl.tiles.material = m;
    for (const mesh of pl.meshes) mesh.material = m;
  }

  endPlacement() {
    if (!this.placement) return;
    this.placement.ghost.removeFromParent();
    this.placement.tiles.geometry.dispose();
    this.placement = null;
  }

  beginLine(maxCells) {
    this.endLine();
    const geo = new THREE.BoxGeometry(0.96, 1, 0.96);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, linePreviewMat, maxCells);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.line = mesh;
  }

  /** One block per cell ([x, y, z] cell centre), `tall` high, green or red. */
  updateLine(cells, ok, tall) {
    const mesh = this.line;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    cells.forEach(([x, y, z], i) => {
      m.makeScale(1, tall, 1).setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(ok[i] ? 0x40ff60 : 0xff3030));
    });
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  endLine() {
    if (!this.line) return;
    this.line.removeFromParent();
    this.line.geometry.dispose();
    this.line.dispose();
    this.line = null;
  }
}
