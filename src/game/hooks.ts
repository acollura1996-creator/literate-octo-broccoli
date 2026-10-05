// The simulation's only connection to the outside world. `new Game(opts, hooks)` takes these; a
// renderer, the HUD and the audio implement them, and a headless run can leave any of them out.
// The simulation never imports an engine: it reports what happened through these calls and the
// renderers read its state (units, terrain, roads, fog, projectiles) each frame.

/** Anything the game simulates (units, buildings, heroes). Typed fully in M11. */
export type SimUnit = { id: number; x: number; z: number; [key: string]: unknown };
export type SimItem = { id: string; x: number; z: number; [key: string]: unknown };
export type SimPlayer = { index: number; color: number; [key: string]: unknown };
export interface Point {
  x: number;
  z: number;
}

/** Visual effects the simulation asks for. Purely visual: game timing never depends on them. */
export interface EffectsApi {
  burst(x: number, y: number, z: number, color: number, count?: number, speed?: number, size?: number, life?: number): void;
  hit(target: SimUnit, color?: number): void;
  ring(x: number, z: number, color: number, radius: number, dur?: number, startR?: number, opacity?: number): void;
  explosion(x: number, z: number, size?: number): void;
  muzzle(x: number, y: number, z: number, color?: number, size?: number): void;
  puff(x: number, y: number, z: number, color?: number, size?: number, life?: number): void;
  nukeLaunch(silo: Point, x: number, z: number, flight: number): void;
  nukeBlast(x: number, z: number, radius: number): void;
  orderMarker(x: number, z: number, color?: number): void;
  beam(x: number, z: number, color: number, height?: number, radius?: number, dur?: number): void;
  holyLight(target: Point): void;
  levelUp(hero: Point): void;
  blizzard(x: number, z: number, radius: number): void;
  /** A falling meteor; the simulation times the impact itself (0.7 s). */
  meteor(x: number, z: number): void;
  volley(caster: Point, x: number, z: number, radius: number): void;
  star(x: number, z: number): void;
  highlightTree(tree: { x: number; z: number; scale: number; species: number }, color: number): void;
  clearTreeHighlight(): void;
}

export interface SimHooks {
  onUnitAdded?(u: SimUnit): void;
  onUnitRemoved?(u: SimUnit): void;
  /** A unit changed appearance (`modelChanged`: a new model, e.g. a town hall's age style). */
  onUnitChanged?(u: SimUnit, modelChanged?: boolean): void;
  onItemDropped?(item: SimItem): void;
  onItemTaken?(item: SimItem): void;
  /** Is this map position on screen? (for alerts) */
  isOnScreen?(x: number, z: number): boolean;
  centerOn?(x: number, z: number): void;
  /** Play a sound, optionally at a map position (volume falls off with camera distance). */
  sound?(name: string, volume: number, x?: number, z?: number): void;
  onGameOver?(over: { victory: boolean; text: string }): void;
  onAgeAdvanced?(player: SimPlayer): void;
  onOffersChanged?(): void;
  onTeamsChanged?(): void;
  fx?: EffectsApi;
}
