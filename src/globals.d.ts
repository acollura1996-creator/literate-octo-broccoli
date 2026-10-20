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

/** The desktop app's Warcraft III importer (electron/wc3/desktop.ts). */
export interface Wc3Status {
  installed: boolean;
  enabled: boolean;
  source?: string;
  created?: string;
  bytes?: number;
  units?: number;
  missing?: string[];
  failed?: string[];
  busy: boolean;
}
export interface Wc3Progress {
  stage: 'open' | 'data' | 'models' | 'write' | 'done';
  done: number;
  total: number;
  current?: string;
}
export interface Wc3Bridge {
  status(): Promise<Wc3Status>;
  choose(): Promise<string | null>;
  import(dir: string): Promise<{ ok: boolean; error?: string; log?: string[]; status: Wc3Status }>;
  enable(on: boolean): Promise<Wc3Status>;
  remove(): Promise<Wc3Status>;
  showReport(): Promise<boolean>;
  pack(): Promise<Uint8Array | null>;
  onProgress(cb: (p: Wc3Progress) => void): () => void;
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
    desktop?: { isElectron: boolean; toggleFullscreen(): Promise<boolean>; wc3?: Wc3Bridge };
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
