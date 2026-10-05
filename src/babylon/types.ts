// The parts of the (still JavaScript) simulation that the Babylon renderer reads. These become
// the real simulation types when the simulation is converted to TypeScript (MIGRATION.md, M11).

export interface TreeLike {
  x: number;
  z: number;
  cx: number;
  cz: number;
  species: 0 | 1 | 2;
  scale: number;
  rot: number;
  alive: boolean;
  tint: [number, number, number];
}

export interface DoodadLike {
  x: number;
  y: number;
  z: number;
  rot: [number, number, number];
  scale: [number, number, number];
  color: [number, number, number];
}

export interface TerrainLike {
  size: number;
  heights: Float32Array;
  types: Uint8Array;
  trees: TreeLike[];
  /** Trees cut down, in order; renderers replay it. */
  felled: TreeLike[];
  doodads: { rocks: DoodadLike[]; bushes: DoodadLike[]; flowers: DoodadLike[] } | null;
  /** The painted ground map (2048² canvas), set when the game is set up. */
  textureCanvas?: HTMLCanvasElement;
  heightAt(x: number, z: number): number;
  paintTexture(): HTMLCanvasElement;
  scatterDoodads(): { rocks: DoodadLike[]; bushes: DoodadLike[]; flowers: DoodadLike[] };
}

export interface RoadsLike {
  size: number;
  count: number;
  version: number;
  owner: Int8Array;
  colorFor(p: PlayerLike | undefined): number[];
}

export interface FogGridLike {
  size: number;
  texData: Uint8Array;
  version: number;
}

export interface PlayerLike {
  color: number;
}

export interface UnitLike {
  id: number;
  x: number;
  z: number;
  facing: number;
  radius: number;
  dead: boolean;
  removed?: boolean;
  isBuilding: boolean;
  owner: PlayerLike;
  def: { footprint?: number; modelColor?: number };
  mods: { scale?: number };
  /** The renderer's view of this unit (visibility, model height, hover state). */
  view: { visibleNow?: boolean; height?: number; hovered?: boolean } | null;
}

export type ItemLike = object;

export interface CitadelWall {
  model: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  color: number;
}

export interface GameLike {
  citadelWalls?: CitadelWall[];
  time: number;
  timeOfDay: number;
  shakeAmount: number;
  terrain: TerrainLike;
  roads?: RoadsLike;
  fog: FogGridLike;
  generals: PlayerLike[];
  units: UnitLike[];
}
