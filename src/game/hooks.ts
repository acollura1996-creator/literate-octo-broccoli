// The simulation's only connection to the outside world. `new Game(opts, hooks)` takes these; a
// renderer, the HUD and the audio implement them, and a headless run can leave any of them out.
// The simulation never imports an engine: it reports what happened through these calls and the
// renderers read its state (units, terrain, roads, fog, projectiles) each frame.

import type { Unit } from './unit.ts';
import type { GameOver, GroundItem, Player } from './types.ts';

export interface Point {
  x: number;
  z: number;
}

/**
 * The renderer's object for a unit (`unit.view`). The simulation only reads these: the model's
 * height (to aim shots), and its scale and turn (to place gun muzzles).
 */
export interface UnitViewHandle {
  height?: number;
  visibleNow?: boolean;
  hovered?: boolean;
  /** Game time until which the unit flashes (the player just ordered something at it). */
  flashUntil?: number;
  root?: { scale?: { x: number }; rotation?: { y: number } };
}

/** Visual effects the simulation asks for. Purely visual: game timing never depends on them. */
export interface EffectsApi {
  burst(x: number, y: number, z: number, color: number, count?: number, speed?: number, size?: number, life?: number): void;
  hit(target: Unit, color?: number): void;
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
  onUnitAdded?(u: Unit): void;
  onUnitRemoved?(u: Unit): void;
  /** A unit changed appearance (`modelChanged`: a new model, e.g. a town hall's age style). */
  onUnitChanged?(u: Unit, modelChanged?: boolean): void;
  onItemDropped?(item: GroundItem): void;
  onItemTaken?(item: GroundItem): void;
  /** Is this map position on screen? (for alerts) */
  isOnScreen?(x: number, z: number): boolean;
  centerOn?(x: number, z: number): void;
  /** Play a sound, optionally at a map position (volume falls off with camera distance). */
  sound?(name: string, volume: number, x?: number, z?: number): void;
  onGameOver?(over: GameOver): void;
  onAgeAdvanced?(player: Player): void;
  onOffersChanged?(): void;
  onTeamsChanged?(): void;
  fx?: EffectsApi;
}
