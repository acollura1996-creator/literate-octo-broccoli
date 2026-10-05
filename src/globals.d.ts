// Globals the page reads or exposes: the desktop bridge (electron/preload.ts), the claude.ai
// Artifact host, and the debug handles used by the test scripts.
import type { Game } from './game/game.ts';
import type { Input } from './input.ts';
import type { BabylonView } from './babylon/BabylonView.ts';
import type { SpatialAudio } from './babylon/SpatialAudio.ts';
import type { UNITS } from './data/units.ts';
import type { Roads } from './game/roads.ts';

/** Frame timing and scene counts (?fps=1, ?bench=N, Ctrl+Shift+F). */
export interface PerfStats {
  fps: number;
  simMs: number;
  viewMs: number;
  uiMs: number;
  units: number;
  drawCalls?: number;
  activeMeshes?: number;
  meshes?: number;
  evalMs?: number;
  renderMs?: number;
  frameMs?: number;
}

/** The Artifact viewer's hot-reload hooks (keeps the title-screen settings across updates). */
export interface ArtifactHot<T> {
  data?: T;
  ready?(boot: (data: T) => void): void;
  snapshot?(take: () => T): void;
}

declare global {
  /** Older Safari's prefixed OfflineAudioContext. */
  var webkitOfflineAudioContext: typeof OfflineAudioContext | undefined;
  interface Window {
    /** The Electron preload bridge (absent in browsers). */
    desktop?: { isElectron: boolean; toggleFullscreen(): Promise<boolean> };
    claude?: { hot?: ArtifactHot<unknown> };
    webkitAudioContext?: typeof AudioContext;
    // Debug and test handles.
    __game?: Game;
    __input?: Input;
    __view?: BabylonView;
    __U?: typeof UNITS;
    __R?: typeof Roads;
    __perf?: PerfStats | null;
    __setSpeed?: (speed: number) => number;
    __initSound?: () => void;
    __audio?: () => SpatialAudio | null;
  }
}
