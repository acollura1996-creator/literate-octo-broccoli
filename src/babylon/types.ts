// The parts of the (still JavaScript) simulation that the Babylon renderer reads. These become
// the real simulation types when the simulation is converted to TypeScript (MIGRATION.md, M11).

export interface TerrainLike {
  size: number;
  heights: Float32Array;
  types: Uint8Array;
  /** The painted ground map (2048² canvas), set when the terrain is built. */
  textureCanvas?: HTMLCanvasElement;
  heightAt(x: number, z: number): number;
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
  /** The legacy three.js unit view; supplies visibility and model height until M4. */
  view: {
    visibleNow?: boolean;
    height?: number;
    group?: { position: { x: number; y: number; z: number } };
  } | null;
}

export type ItemLike = object;

export interface GameLike {
  time: number;
  timeOfDay: number;
  shakeAmount: number;
  terrain: TerrainLike;
  units: UnitLike[];
}
