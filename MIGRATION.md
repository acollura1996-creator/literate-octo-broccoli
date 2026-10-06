# Migration plan: three.js → TypeScript + Babylon.js + Vite + Electron

Status: **done.** All milestones are complete (section 3), including two added after review: M13,
the art pass (M8's upgrade kept the original look under post-processing, and the result still looked
like the three.js version), and M14: rigged and animated characters and buildings, unit sounds, a
larger map with more to do, and Warcraft III-style scrolling. The game is strict TypeScript on Babylon.js, built with Vite and packaged with
Electron; three.js is used only at build time, to bake the procedural models. One item couldn't be
checked in this environment: running the installed game from the Windows `.exe` needs a Windows PC
(D5).

Branch: `babylon-migration`, created from `claude/heroes-empires-3d-game-gytx45` at `fbda849`. The
original stays untouched on its own branch. The three.js version kept running alongside the port until
every milestone had been ported and checked, and was removed in M12.

Visual target: the chunky shapes, bold colours and hand-painted look of Warcraft III, with modern
lighting and effects on top, in the spirit of Warcraft III: Reforged.

---

## 0. Decisions to approve before converting

These are the places where the request and the codebase don't line up one-to-one. Each one has a
recommendation.

| # | Topic | Situation | Recommendation |
| --- | --- | --- | --- |
| D1 | **147 procedural 3D models** | Every unit, building, creep and prop is built in code from three.js geometry: about 10,700 lines in `src/render/models/*`, using `BoxGeometry`, `CylinderGeometry`, `ExtrudeGeometry` with `Shape`, `LatheGeometry`, `mergeGeometries` and so on. There are no model files. | **Bake them to glTF.** A Node script (`tools/bake-models.ts`) runs the existing builders on the CPU (three.js geometry needs no WebGL) and writes `public/models/*.glb`. Team-coloured materials are tagged, and the animation "parts" contract (legs, arms, weapon, doors, …) goes into glTF `extras`. The game loads the GLBs with `@babylonjs/loaders`, so **the shipped app contains no three.js**. three.js stays only as a dev dependency of the bake script, which keeps the models editable as code. The alternative is to hand-port all 10,700 lines to Babylon `MeshBuilder`. That is a large job with a real risk of visual drift, so I don't recommend it. **Outcome (M4, M12):** as recommended. The bake script is `tools/bake-models.mjs` (plain JavaScript, since the builders it runs are three.js code), and the builders moved to `tools/models/`. The shipped game contains no three.js. |
| D2 | **TypeScript strict** | About 19,000 lines of JavaScript, with dynamic objects everywhere (units and players gain properties at runtime). | All **new** code is strict TypeScript from day one. The engine-free simulation is converted **file by file**, so the game keeps running throughout: `allowJs` at first, then `.ts` with interfaces for Unit, Player, Order and Game. Milestone M11 finishes this. **Outcome:** the simulation was converted in M11 and the rest of the app in M12; every file in `src/` is strict TypeScript. |
| D3 | **Hand-painted textures** | The game has no textures today: everything is flat-coloured Lambert material. | Generate tileable **painterly textures procedurally** at load time (stone, wood, thatch, metal, cloth, leather, foliage, earth, skin). Apply them **triplanar** through a Babylon `MaterialPluginBase`, so baked models need no UV work. No external art assets are needed. **Outcome (M8):** `PainterlyPlugin` (`src/babylon/Painterly.ts`), on every model, tree, rock and bush. |
| D4 | **Unit acknowledgements** | There are no voice lines. All audio is synthesized with Web Audio: 36 effects plus procedural music. | Pre-render the existing synths into `AudioBuffer`s and play them as Babylon `StaticSound`s with spatial positioning. Add **new synthesized acknowledgement "barks"** (formant-synth grunts per unit type and age) for select, move and attack. These are new content, not ported content. **Outcome (M7):** as recommended, plus ambient loops (wind, birds, crickets, the citadel's drone). |
| D5 | **Windows installer** | This environment is Linux with no Wine and no Windows machine. | `electron-builder --win nsis` can cross-build the installer here (with `signAndEditExecutable: false`, since Wine isn't available to embed the icon). I'll check the unpacked app runs under Electron on Linux (Xvfb), and that the NSIS `.exe` is produced and well formed. **Installing and running the `.exe` has to be done on a Windows PC.** I can install Wine for a best-effort smoke test, but Electron under Wine is unreliable, so this item stays flagged. **Outcome (M10):** electron-builder 26 embeds the icon without Wine, so only signing is off (`signExecutable: false`). The installer was built, installed, uninstalled and reinstalled under Wine 9. Electron doesn't draw a window under Wine, so **running the game from the `.exe` still has to be confirmed on Windows.** |
| D6 | **Claude Artifact build** | `npm run build:artifact` builds a single-file web version, which is what's published at the claude.ai link. | Keep it working as a secondary target. Babylon's bundle is larger but still fits in one file. **Outcome:** kept working throughout; the single file is about 10.6 MB and also runs from `file://`. |
| D7 | **Skeletal animation and AnimationGroups** | No model has a skeleton. Animation is procedural: the code rotates "part" nodes every frame. | Keep the procedural animation driver, ported to Babylon `TransformNode`s. `AnimationGroup` is used only where it helps (door swings, UI). The "baked vertex animation" step in milestone 9 doesn't apply; the performance work goes into instancing instead (see M9). **Outcome:** as planned (M4, M9). |

---

## 1. Inventory

### 1.1 Features (everything the Babylon version must match)

- **Title and setup screens:** path (Hero or Empire), hero, rival slots (path, hero, side), difficulty, camera options (scroll speed, wheel mode, edge scrolling), fullscreen button, loading screen.
- **Game modes:** single player against or alongside up to 3 AI generals (hero or empire AI), victory and defeat rules, end screen.
- **Map:** 256×256, four-fold symmetric.
  - Heightfield terrain with a painted ground texture and a tiling detail texture, a moat with an animated water shader, and fords.
  - Kalenden's citadel: custom wall segments and towers.
  - About 20,000 trees, instanced in 32×32 chunks, which can be felled.
  - Instanced doodads, 40 creep camps, neutral buildings, and road polylines painted into the ground.
- **Fog of war:** black mask and explored fog, using a 256×256 `R8` data texture that every material samples.
- **Camera:** RTS view at 56° pitch, 42° vertical FOV.
  - Distance 12–68 with smooth zoom.
  - Ramped edge scrolling with velocity, keyboard panning, middle-drag grab-pan.
  - Wheel modes: auto (zoom with a mouse, pan with a trackpad) and pinch zoom.
  - Screen shake; the camera follows the terrain height.
- **Units:** 147 model ids (units, heroes, creeps, Legion, buildings in 12 age styles, walls, gates, doodads), all procedural.
  - Team colours, and per-age models for town centers, houses, farms, walls, gates and towers.
  - Procedural animation: walk, attack (swing, thrust, recoil), cast, work, death, door swing, spin, bob, wheels, fire flicker, glow.
  - Selection and hover rings, construction scaffolding and growth, buff visuals, carried resources, building ghosts.
- **Selection and orders:**
  - Click, drag box, double-click (all of a type), shift-add, control groups.
  - Smart right-click: move, attack, gather, follow, return resources, rally.
  - Targeting modes: attack-move, patrol, gather, rally, spell targets, nuke.
  - Building placement ghost, line tool for roads and walls, gates placed over walls.
  - Tree hover highlight, contextual cursor label.
- **Simulation:** independent of the engine, apart from the coupling listed in 1.2.
  - A* pathfinding on a grid with gates and roads.
  - Combat with Warcraft III armor and attack tables; projectiles (arrows, bullets, shells, rockets, lasers, plasma, nukes); abilities.
  - Heroes: XP, items, shops, mercenaries.
  - Empire economy: gold, lumber, food, citizens, taxes, rations, mood, riots.
  - 12 ages, research, roads and connectivity, walls and gates, hiring heroes, nukes, random events.
  - Creep camps that scale with time, Kalenden's Legion waves, AI generals for both heroes and empires.
- **Effects:**
  - burst, hit, ring, explosion, muzzle flash, puff, order marker, beam;
  - Holy Light, level-up, Blizzard, meteor, volley, starfall;
  - tree highlight, nuke launch and nuke blast (with mushroom cloud);
  - instant laser and rail beams, rocket smoke trails.
- **HUD (HTML and CSS):**
  - Top bar: resources, food, citizens, mood, age, day/night clock.
  - Hero bar, Generals board, minimap (2D canvas with pings and fog), command card (4×3 grid of 3D-rendered icons with tooltips).
  - Info panel with a **live 3D portrait**, inventory, messages and event feed, hire-offer dialog.
  - Menus: game menu, quests, help, end screen.
  - 2D canvas overlay: health and mana bars, floating text, drag rectangle, construction progress, axe markers, unconnected-house markers.
- **Audio:** 36 synthesized sound effects with distance attenuation and voice limiting, procedural music, mute button.
- **Tools:** `tools/gallery.html` (development model gallery), `tools/build-artifact.mjs` (Artifact build).

### 1.2 Files

This is the inventory taken before the port; `README.md` describes the final layout.

Engine coupling: **none** means no three.js; **render** means pure rendering; **mixed** means logic and rendering in the same file and must be split.

| File | Lines | Purpose | Coupling | Plan |
| --- | ---: | --- | --- | --- |
| `src/game/game.js` | 1732 | Simulation core: players, spawning, combat, economy hooks, defeat rules | **mixed**: imports THREE, `createModel` and `TEAM_COLORS` only for the citadel wall meshes | Move the citadel wall visuals into the renderer; the core becomes `sim/game.ts`. **Done in M4**: `game.js` only computes the wall placements. |
| `src/game/behavior.js` | 947 | Orders, movement, harvesting, attacks | none | Reuse as-is, then TypeScript (M11) |
| `src/game/unit.js` | 326 | Unit state and derived stats | none | Reuse, then TypeScript |
| `src/game/abilities.js` | 363 | Hero and creep abilities | none (calls `hooks.fx`) | Reuse |
| `src/game/empire.js` | 358 | Citizens, taxes, ages, hiring, nukes | none (calls `hooks.fx`) | Reuse |
| `src/game/events.js` | 137 | Random events | none | Reuse |
| `src/game/roads.js` | 286 | Road network and connectivity, **plus the road mesh** | **mixed** | Split into `sim/roads.ts` and `render/RoadMesh.ts`. **Done in M3**: data plus a `version` counter; meshes in `render/terrainView.js` and `babylon/TerrainView.ts`. |
| `src/game/fog.js` | 116 | Visibility grid, **plus a THREE.DataTexture** | **mixed** | The grid goes to `sim`; the texture becomes a Babylon `RawTexture` in the renderer. **Done in M3.** |
| `src/ai/*.js` | 1583 | Creeps, Legion, general AI | none | Reuse |
| `src/data/*.js` | 921 | Units, heroes, items, ages, research, economy | none | Reuse, then typed data |
| `src/world/pathgrid.js` | 317 | A* pathfinding grid | none | Reuse |
| `src/world/layout.js`, `noise.js` | 194 | Map layout, noise | none | Reuse |
| `src/world/terrain.js` | 704 | Heights, classification and trees (**data**), plus ground, water, tree and doodad **meshes** | **mixed** | Split into `sim/terrainData.ts` and `render/TerrainView.ts`. **Done in M3** (`world/terrain.js` is the data; `render/terrainView.js` and `babylon/TerrainView.ts` are the views). |
| `src/render/view.js` | 223 | Renderer, lights, day/night, RTS camera, ground picking | render | `render/BabylonView.ts` |
| `src/render/assets.js` | 133 | Material and geometry caches, fog-of-war shader patch, team colours | render | Material library plus `FogOfWarPlugin` |
| `src/render/models.js` | 436 | Model registry, template cache, static-mesh merging, cloning | render | Bake script plus GLB library and instancing (D1) |
| `src/render/models/*.js` (14 files) | 10,700 | 147 procedural model builders | render | Bake to GLB (D1) |
| `src/render/unitview.js` | 464 | Per-unit visual: animation driver, rings, buffs, carry, scaffold, doors | render | `render/UnitView.ts` |
| `src/render/effects.js` | 485 | Transient effects | render | Babylon meshes plus `GPUParticleSystem` |
| `src/render/projectiles.js` | 326 | Projectile meshes, beams, trails, muzzles | render | `render/Projectiles.ts` |
| `src/render/overlay.js` | 154 | 2D canvas overlay | uses `view.project` | Keep, via a Babylon `Vector3.Project` adapter |
| `src/input.js` | 1013 | Selection, orders, camera input, placement, line tool, cursor | **mixed**: placement ghosts and line preview meshes | Logic stays; preview meshes go into `render/Previews.ts` |
| `src/ui/hud.js`, `commands.js`, `minimap.js` | 1157 | HTML HUD, command card, minimap | none, apart from icons | Keep the HTML/CSS overlay |
| `src/ui/icons.js` | 162 | Offscreen icon renderer (`WebGLRenderTarget`) and live 3D portrait (second `WebGLRenderer`) | render | Babylon `RenderTargetTexture` with `readPixels`; portrait via `engine.registerView` |
| `src/audio.js` | 1471 | Web Audio synth effects and music | none | Babylon AudioEngineV2 spatial sounds from pre-rendered buffers, plus the music synth (M7) |
| `src/main.js` | 492 | Boot, title screen, game loop | `requestAnimationFrame` | `engine.runRenderLoop` with a fixed-step simulation |
| `index.html`, `src/styles.css` | 1557 | Markup and styles for the HUD and menus | none | Keep |
| `tools/gallery.*` | 290 | Model gallery | render | Babylon gallery that loads the baked GLBs |
| `tools/build-artifact.mjs`, `vite.config.js` | 29 | Build | — | `vite.config.ts`; keep the single-file Artifact build (D6) |

### 1.3 three.js API usage → Babylon.js equivalents

Counts are occurrences of `THREE.X` across `src` and `tools`.

| three.js | Count | Babylon.js | Notes |
| --- | ---: | --- | --- |
| `WebGLRenderer` | 3 | `Engine` (WebGL2) or `WebGPUEngine` | WebGL2 by default. `engine.setHardwareScalingLevel` replaces `setPixelRatio`. |
| `Scene` | 4 | `Scene` | **`scene.useRightHandedSystem = true`**, so +Z faces and model winding match three.js. Check that models aren't mirrored (M4). |
| `PerspectiveCamera` (FOV 42°) | 4 | `UniversalCamera` / `TargetCamera`, driven by our own RTS controller | FOV in radians: 42° = 0.733 rad. |
| `Group`, `Object3D` | 138 | `TransformNode` | |
| `Mesh` | 81 | `Mesh`; `InstancedMesh` for repeats | |
| `InstancedMesh` | 4 | Thin instances (`thinInstanceAdd`) for trees and doodads; `InstancedMesh` for unit parts | Felling a tree hides its thin instance (zero-scale matrix, like today). |
| `MeshLambertMaterial` (flat shaded) | 3 | `StandardMaterial` (low specular) | Flat look from faceted normals (`convertToFlatShadedMesh`), or keep the baked normals. |
| `MeshBasicMaterial` | 13 | `StandardMaterial` with `disableLighting` and `emissiveColor` | Effects, ghosts, rings. |
| `ShaderMaterial` (water) | 1 | `ShaderMaterial` | Uniforms and attributes renamed (`world`, `worldViewProjection`, …). |
| `onBeforeCompile` patches (fog of war on all materials; terrain detail texture) | 2 | **`MaterialPluginBase`** | Same idea: inject GLSL into Standard and PBR materials. |
| `BoxGeometry`, `CylinderGeometry`, `SphereGeometry`, `ConeGeometry`, `TorusGeometry`, `RingGeometry`, `PlaneGeometry`, `CircleGeometry`, `IcosahedronGeometry`, `DodecahedronGeometry`, `OctahedronGeometry`, `TetrahedronGeometry`, `LatheGeometry`, `ExtrudeGeometry` with `Shape`/`Path` | about 150 | `MeshBuilder.CreateBox`, `CreateCylinder`, `CreateSphere`, `CreateTorus`, `CreateDisc`, `CreateGround`, `CreatePolyhedron`, `CreateLathe`, `ExtrudePolygon` (needs earcut) | Only used by model builders, effects and terrain. Models are handled by the bake (D1); effects and terrain use `MeshBuilder` directly. |
| `BufferGeometry`, `BufferAttribute`, `Float32BufferAttribute` | 25 | `VertexData` / `VertexBuffer` | Terrain heightfield, road mesh. |
| `BufferGeometryUtils.mergeGeometries` (addon) | 12 files | `Mesh.MergeMeshes` / `VertexData.merge` | Bake-time only for models. |
| `CanvasTexture` | 3 | `DynamicTexture` | Ground paint, detail texture, road cobbles. |
| `DataTexture` (R8 fog) | 2 | `RawTexture.CreateRTexture` with `update()` | |
| `WebGLRenderTarget` with `readRenderTargetPixels` | 1 | `RenderTargetTexture` with `readPixels()` | Command card icons. |
| `HemisphereLight` | 4 | `HemisphericLight` (with `groundColor`) | |
| `DirectionalLight` with shadow camera | 5 | `DirectionalLight` with **`CascadedShadowGenerator`** | Soft cascaded shadows (M8). |
| `PCFShadowMap` | 2 | `ShadowGenerator.usePercentageCloserFiltering` / contact hardening | |
| `Raycaster` | 1 | `scene.createPickingRay` / `scene.pick` | Ground picking is our own heightfield march, kept as-is. |
| `Vector2`, `Vector3`, `Quaternion`, `Matrix4`, `Euler`, `Box3`, `Color`, `MathUtils` | 125 | `Vector2`, `Vector3`, `Quaternion`, `Matrix`, rotation vectors, `BoundingInfo`, `Color3`, `Scalar` / `Tools.ToRadians` | |
| `AdditiveBlending`, `NormalBlending`, `DoubleSide`, `FrontSide` | 23 | `material.alphaMode = Constants.ALPHA_ADD`, `backFaceCulling = false` | |
| `SRGBColorSpace` | 5 | Babylon image processing (gamma handled in post) | |
| `LineSegments`, `EdgesGeometry`, `LineBasicMaterial` | 3 | `MeshBuilder.CreateLineSystem` or `enableEdgesRendering` | Development helpers only. |
| `Object3D.lookAt`, `traverse`, `clone` | — | `lookAt`, `getChildMeshes`, `instantiateHierarchy` / `AssetContainer.instantiateModelsToScene` | |
| Render loop (`requestAnimationFrame`) | — | `engine.runRenderLoop`, `scene.onBeforeRenderObservable` | |
| `AnimationMixer` | 0 | — | Not used (D7). |
| GLTFLoader / other loaders | 0 | `@babylonjs/loaders` | Used for the baked GLBs (D1). |

### 1.4 Custom shaders

1. **Fog of war patch** (`render/assets.js`). It's injected into every Lambert material and every instanced material, and multiplies the final colour by the fog texture sampled at the world XZ position. Port: `FogOfWarPlugin extends MaterialPluginBase`, which reads the world position (`vPositionW`) in the fragment shader. Instanced meshes are covered automatically.
2. **Ground detail** (`world/terrain.js`). A tiling detail texture multiplies the painted ground map. Port: the same plugin family (`GroundDetailPlugin`), or a `StandardMaterial.detailMap` (Babylon has built-in detail maps).
3. **Moat water** (`world/terrain.js`, `ShaderMaterial`). Animated colour bands and transparency. Port: `ShaderMaterial` with renamed uniforms (`world`, `viewProjection`, `time`), or Babylon's `WaterMaterial` (`@babylonjs/materials`) for a richer Reforged-style look.
4. **New in M8:**
   - a team-colour shader (instanced team colour attribute, plus a painterly triplanar texture);
   - a glow layer for emissive parts and spells;
   - the `DefaultRenderingPipeline` (bloom, ACES tone mapping, colour grading, FXAA);
   - SSAO2, distance fog, and `GPUParticleSystem` effects.

### 1.5 Asset formats

- **Models:** none on disk; all 147 are procedural (D1). After the bake: `public/models/*.glb`.
- **Textures:** none on disk; generated on canvas at runtime (ground, detail, road cobbles). After M8: procedural painterly texture atlases (D3).
- **Audio:** none on disk; synthesized with Web Audio (D4).
- **Fonts:** Google Fonts (Cinzel and others) linked from `index.html`. **Electron must work offline**, so the fonts will be bundled locally (`@fontsource`) and the CSS fallbacks kept.

### 1.6 Build steps today

- `npm run dev` runs the Vite dev server.
- `npm run build` runs Vite with `vite-plugin-singlefile` to produce one self-contained `dist/index.html`.
- `npm run build:artifact` additionally strips the page wrapper for claude.ai Artifact hosting.
- There is no TypeScript, linter config, test runner or Electron. Testing is done with ad-hoc Playwright scripts kept outside the repo.

---

## 2. Target architecture

```
src/
  sim/        engine-free simulation (no Babylon, no DOM): game, units, orders, pathfinding, combat,
              economy, AI, data. Talks to the outside world only through a typed `SimHooks` interface
              (unit added/removed/changed, fx events, sounds, messages).
  render/     Babylon.js: engine/scene setup, RTS camera, terrain, models (GLB library + instancing),
              unit views and animation driver, effects/particles, projectiles, previews, post-processing.
  ui/         HTML/CSS HUD (kept), minimap, overlay canvas, icons (via render/IconRenderer).
  audio/      Babylon AudioEngineV2 wrapper + synth bank (pre-rendered buffers) + music.
  input/      input → orders (kept logic), camera control, placement/line tools.
  main.ts     boot, title screen, fixed-step loop on engine.runRenderLoop.
electron/
  main.ts     BrowserWindow (contextIsolation, sandbox, no nodeIntegration, single instance, F11
              and Alt+Enter fullscreen, devtools only when !app.isPackaged), CSP, offline loading
              from the app:// protocol.
  preload.ts  contextBridge: { isElectron, toggleFullscreen }.
tools/
  bake-models.ts   runs the procedural builders (three.js, dev-only) → public/models/*.glb
  gallery.html     Babylon model gallery.
```

**Outcome.** The final code kept the existing folder names rather than introducing `sim/`, `render/`,
`audio/` and `input/`, since renaming would have touched every import for no change in behaviour:

- the simulation is `src/data`, `src/world`, `src/game` and `src/ai` (no engine, no DOM; checked by
  `tsconfig.sim.json` and by `npm run sim`, which runs it in Node);
- the renderer is `src/babylon/`;
- input is `src/input.ts`, and the HUD is `src/ui/`;
- audio is `src/audio.ts` (the synthesizer and the music) plus `src/babylon/SpatialAudio.ts` (Babylon
  AudioEngineV2);
- `electron/` is as planned, and the bake script is `tools/bake-models.mjs`.

**Migration path** (as followed until M12). While the port was in progress, the Babylon renderer
lived in `src/babylon/` and was selected with `?renderer=babylon` (the desktop build opted in). `BabylonView` implements the same
interface as the three.js `View`. Whatever is not ported yet runs on a hidden three.js view inside
it, which is updated every frame but never drawn, so the full game stays playable on Babylon after
every milestone. Each milestone moves another part across. In M12, `src/babylon/` replaces
`src/render/` and the hidden view is removed.

**Simulation and rendering boundary.** The simulation already reports through `game.hooks`
(`onUnitAdded`, `onUnitRemoved`, `onUnitChanged`, `fx.*`, `projectiles.*`, `sound`). M5 formalises
this as a typed interface and removes the three remaining direct dependencies: citadel wall
visuals, the road mesh and the fog texture.

**Handedness.** `scene.useRightHandedSystem = true`, so world coordinates (X right, Z toward the
camera, Y up) and the models' +Z facing carry over unchanged.

---

## 3. Milestones

Each milestone ends with the same check:

1. Start the Vite dev server.
2. Open the game in a headless Chromium (Playwright), take a screenshot, and read the console.
3. Fix every error before moving on.
4. Commit and push to `babylon-migration`.

The three.js renderer kept working in parallel, behind `?renderer=three`, until M12 removed it.

- [x] **M1 – Scaffold the stack.**
  - [x] Add TypeScript (strict), `@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/materials`, Electron and electron-builder.
  - [x] `tsconfig` uses `allowJs` for the legacy simulation; add `vite.config.ts`.
  - [x] Add the Electron main process and preload with secure defaults (`electron/main.ts`, `electron/preload.ts`).
  - [x] npm scripts: `dev`, `dev:electron`, `build`, `dist` (plus `typecheck` and `preview`).
  - [x] An empty Babylon scene (ground plane plus light) renders in the browser and in Electron (checked under Xvfb).
  - Notes:
    - `?renderer=babylon` opens the Babylon scene (`src/babylon/`); the default is still three.js.
    - `dist-electron/` is CommonJS: `scripts/build-electron.mjs` writes a `package.json` with `"type": "commonjs"` next to it, because the root package is an ES module package.
    - The packaged app serves `dist/` from a custom `app://game` protocol with a strict CSP, rather than `file://`.
    - Electron is checked with a development-only self-capture: `HE3D_SCREENSHOT=out.png` saves a window screenshot, prints the page console and confirms `require`/`process` are not exposed, then quits. It is ignored in packaged builds.
    - In this container Electron also needs `--no-sandbox` (it runs as root) and SwiftShader WebGL flags (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). These are passed on the command line for the check only; the app does not set them.
    - Checked: handedness matches three.js (+X to the right, +Z toward the camera); Babylon reports WebGL2; the three.js game still runs with a clean console.
- [x] **M2 – RTS camera.**
  - [x] Port `RTSCamera` (`src/babylon/RTSCamera.ts`): 56° pitch, FOV 42° converted to radians, distance 12–68 with smooth zoom.
  - [x] Ramped edge scrolling, keyboard panning, middle-drag, wheel modes, shake, terrain following.
  - [x] Port ground picking and `project()`. Projection uses the camera's view-projection matrix directly (the same maths as `Vector3.Project`, plus the "behind the camera" flag the overlay needs).
  - Notes:
    - `?renderer=babylon` now runs the **real game** through `BabylonView` (`src/babylon/BabylonView.ts`), which has the same interface as the three.js `View`. The camera controls in `src/input.js`, the minimap and the overlay drive it unchanged.
    - Parts not ported yet keep running on a hidden three.js view inside `BabylonView` (`legacy`): it is updated each frame but never drawn (see section 2, "Migration path"). M2 draws the painted ground and team-coloured placeholder blocks for units and buildings.
    - `input.js` no longer touches the camera object directly for pick radii: both views provide `pixelsPerUnit()`. `View.render()` is split into `update()` and `draw()`, and the scene clean-up moved into `View.clearWorld()`.
    - Babylon's own pointer handling is detached (`scene.detachControl()`). It cancels `pointerdown`, which stops the browser from sending the mouse events the game listens for.
    - Babylon keeps its own front-face winding in right-handed scenes (the opposite of three.js). Hand-built geometry uses Babylon's order; the glTF loader handles the baked models.
    - Checked against three.js at the same camera position: ground picking within 0.02 units, projection within about 1 px, the minimap view polygon within 0.2 units. Zoom steps, middle-drag (4.51 against 4.56 units), keyboard and edge panning and minimap clicks all behave the same. Pan distances per second differ in the headless check only because software-rendered three.js runs at a few frames per second and hits the 0.1 s frame cap.
    - Scenario tests (interaction, walls, mechanics, research, town-centre UI) pass on both renderers. The research test was flaky on both: random bandit raids and the first Legion wave could kill its units, so the test now holds them off.
- [x] **M3 – Terrain and props.**
  - [x] Split `terrain.js` into data and view. `src/world/terrain.js` is now engine-free (heights, ground types, trees with their tints, scattered doodads, the painted ground canvas, felling). The three.js meshes moved to `src/render/terrainView.js`, and the Babylon ones are in `src/babylon/TerrainView.ts`. `fog.js` and `roads.js` no longer import three.js either: they expose their data plus a `version` counter that each renderer watches. The shared canvas art (detail map, road cobbles) and road geometry are in `src/world/groundArt.js`.
  - [x] Heightfield mesh with the painted ground (`DynamicTexture`) and detail map (a `GroundDetailPlugin` material plugin), moat water (`ShaderMaterial` with the same shader), and roads drawn over the ground.
  - [x] Trees and doodads as **thin instances** per 32×32-cell chunk and species, with felling (stumps).
  - [→ M4] Citadel walls: they are built from the procedural models, so they arrive with the model bake.
  - [x] Fog-of-war material plugin (`FogOfWarPlugin`, registered for every material) with a single-channel `RawTexture`.
  - Notes:
    - The hidden three.js view no longer builds terrain, roads or the fog texture when Babylon draws them (`View.drawsWorld`).
    - Colour parity until M8: three.js lights in linear space and encodes to sRGB, while Babylon's StandardMaterial works in gamma space. Linear instance and vertex colours (tree tints, doodads, roads) are converted to gamma once. The detail-map factor is raised to 1/2.2, and the day/night light intensities are scaled so flat ground matches three.js's brightness at every hour. M8 replaces this with a linear pipeline.
    - Babylon stores thin-instance buffers on the geometry, which clones share, so each tree chunk calls `makeGeometryUnique()`.
    - Babylon ES modules are excluded from Vite's dependency pre-bundling (`optimizeDeps.exclude`). Otherwise each newly imported Babylon module makes the dev server re-optimise and fail the next page load (HTTP 504 "Outdated Optimize Dep").
    - Checked against three.js at the same camera position: home base, zoomed out, moat water, citadel plaza, fog of war (black mask and explored areas), night and noon, and felled trees. Shadows are not drawn on Babylon until M8.
    - Fixed in passing:
      - The HUD clock showed `-1:-1:-1` for the first split second of a game (game time starts slightly below zero).
      - The hero contract offer box was rebuilt every second (its countdown was part of the rebuild signature), which could swallow a click on Accept or Decline. It now rebuilds only when the offers change and updates the countdown in place.
      - Two scenario tests were made robust: the research test holds off raids, and the offer test waits for the dialog.
- [x] **M4 – Models and units.**
  - [x] Bake script (`tools/bake-models.mjs`, run by `npm run bake` and before `dev`, `dev:electron`, `build` and `build:artifact`; it is skipped when up to date). It writes all 147 models into one GLB (`src/generated/models.glb`, 4.2 MB, not committed) with the parts contract and team-colour factors in glTF `extras`. Details:
    - Vertices are welded (573k → 124k).
    - Flat-shaded meshes carry no normals; Babylon's StandardMaterial derives face normals, as three.js `flatShading` does.
    - Team colour is found by building each model with three different team colours. Each team-coloured material stores `colour = k × team + b` (linear): `mat(team)`, `shade(team, k)` and blends such as `lerp(team, white, 0.55)` all fit, and the bake fails if a builder ever uses the team colour in some other way.
  - [x] GLB library (`src/babylon/ModelLibrary.ts`), loaded with `@babylonjs/loaders`:
    - Materials are converted to StandardMaterial.
    - Each model is a hidden template. A unit gets its own transform nodes (so its parts animate) and an `InstancedMesh` per part.
    - The team colour is an instance attribute read by `TeamColorPlugin` (`src/babylon/TeamColor.ts`), so all units of a model share one draw call per part, whatever their team.
  - [x] Unit views (`src/babylon/UnitView.ts`, a port of `src/render/unitview.js`):
    - [x] instanced parts with an instanced team colour;
    - [x] the animation driver for every part type: legs, arms, body bob, weapon swing, thrust, gun kick, spin, doors, bob, wings, wheels, fire, glow and bladestorm. Node rotations keep three.js's Euler XYZ semantics, converted to quaternions;
    - [x] selection and hover rings, construction scaffold, death, buff visuals (stun, shield, slow, roots, bladestorm, auras), carried gold and lumber, gate doors, and ghost copies for illusions and invisible units;
    - [x] ground items (`ItemView`).
  - [x] Citadel walls (moved from M3): `game.js` now only computes their placements (`game.citadelWalls`), and each renderer draws them.
  - [x] Check that models are not mirrored, comparing against the current renderer.
    - New Babylon model gallery, `tools/gallery-babylon.html`, with the same layout and options as the three.js gallery (`tools/gallery.html`).
    - All 147 models compared side by side. The exact vertex bounds of every model match three.js within 0.01 units, and the mesh counts are identical.
  - [x] Drag-box selection and right-click move/attack work through the existing input logic (scenario tests).
  - Notes:
    - The simulation (`src/game`, `src/ai`, `src/world`, `src/data`) no longer imports three.js or anything from `src/render`. Player colours moved to `src/data/colors.js`; `nameColor` uses an engine-free sRGB/linear blend identical to three.js `Color.lerp`. `hooks.scene` is gone.
    - Lighting parity: `LinearLightingPlugin` (`src/babylon/Lighting.ts`) gamma-encodes the accumulated light per pixel, which is what three.js's linear lighting with sRGB output amounts to. Faces turned away from the sun now match too. This replaced the M3 light-scaling workaround.
    - The glTF loader turns meshes shared by several nodes into `InstancedMesh` templates; the library instances their source mesh.
    - Unlit StandardMaterials show only their emissive colour, so the selection ring's per-instance colour goes in through the team-colour plugin's emissive term.
    - `BabylonView.ready` resolves once the models are loaded; `main.js` waits for it before creating a game.
- [x] **M5 – Reconnect the game logic.**
  - [x] (done in M3/M4) Move the citadel walls, road mesh and fog texture out of the simulation.
  - [x] Typed `SimHooks` and `EffectsApi` (`src/game/hooks.ts`). The Babylon `Effects` implements `EffectsApi`, and `main.js` annotates its hooks object with the type.
  - [x] Projectiles.
    - Flight now lives in the simulation (`src/game/projectiles.js`): homing, arcs, beams, and the moment a shot lands and calls `onHit`. Before, a renderer object moved them and the game advanced it through `hooks.projectiles`, so damage timing depended on the renderer.
    - The muzzle table moved to `src/data/muzzles.js`.
    - Both renderers draw `game.projectiles.list`: `ProjectileView` in `src/render/projectiles.js` and `src/babylon/Projectiles.ts`.
  - [x] All effects (meshes now, particles in M8) in `src/babylon/Effects.ts`: the same API, timings and shapes as `src/render/effects.js`.
    - Built on `src/babylon/FxKit.ts`, a small three.js-style toolkit. Each shape is created once per style; every visual is an `InstancedMesh` with per-instance colour and opacity, so effects create no materials or shaders at runtime.
    - The Meteor Shower's damage, stun and screen shake are now timed by the game (`game.later(0.7, …)`) rather than by the falling-meteor effect.
  - [x] Placement ghosts, the road/wall line tool and tree highlights.
    - `src/input.js` keeps the logic and draws through `view.previews` (`src/render/previews.js`, `src/babylon/Previews.ts`). `input.js` no longer imports three.js.
    - Tree highlights are part of the effects API.
  - [x] Full-game check. The scenario tests (interaction, walls, mechanics, research, town-centre UI, tree hover) pass against both renderers.
    - A 28-minute AI game (the AI plays all four empires and heroes) ran on the Babylon renderer through 11 ages to an empire's collapse with a clean console.
    - Scene objects stay proportional to the units on the map (about 21 instanced parts per unit), and effects are released as they expire.
  - Notes:
    - The hidden three.js view inside `BabylonView` is no longer updated each frame. All that remains on it is the command-card icon renderer (M6).
    - Leaving a game now also cancels an active road/wall line tool. Before, its preview could linger into the next game.
    - The walls test now waits for the camera to settle before dragging (it drags in screen pixels).
- [x] **M6 – HUD and interface.**
  - [x] Keep the HTML/CSS HUD (unchanged). It now asks the view for pictures: `view.icon(model, colour, isBuilding)` and `view.createPortrait(element)`. The three.js `View` keeps `src/ui/icons.js`, and the Babylon view uses `src/babylon/UiRenderer.ts`.
  - [x] Command-card icons via `RenderTargetTexture`. They render once per model and colour into a 96×96 target, are read back synchronously, composited on the icon gradient and cached as data URLs, as before.
  - [x] Live portrait: an equivalent of `engine.registerView` without its per-frame canvas resize.
    - The portrait renders each frame into the main canvas, in the rectangle hidden under the portrait box, with a scissored clear.
    - That rectangle is copied into the box's own 2D canvas.
    - No second WebGL context and no pixel readback.
  - [x] Overlay canvas and minimap work unchanged.
  - [x] Fonts bundled locally: Cinzel from `@fontsource/cinzel`, imported by `main.js`. Google Fonts links are gone from `index.html` and from the Electron CSP, so the desktop app works offline.
  - Notes:
    - Icons and the portrait use a separate Babylon scene with its own copy of the models (no fog of war, their own lights).
    - Babylon compiles shaders asynchronously, so that scene compiles all model materials up front (`forceCompilationAsync`). That lets icons be drawn synchronously, as the HUD's HTML templates expect.
    - One light rig is re-set between icons and the portrait, so the shaders never need recompiling. Light layer masks don't work for instances, which take the template mesh's layer.
    - The icon camera's projection is fixed to a square aspect. Otherwise the render-target pass uses the main canvas's aspect ratio and squeezes the icons.
    - `BabylonView` no longer contains a hidden three.js view: nothing it draws uses three.js.
- [x] **M7 – Audio.**
  - [x] Babylon AudioEngineV2 (`src/babylon/SpatialAudio.ts`): spatial `StaticSound`s from pre-rendered synth buffers, with the listener on the camera target.
    - `src/audio.js` renders any of its synths offline (`renderOffline`). For the length of a build, it points its context, noise buffer, reverb send and random source at an `OfflineAudioContext`. The synths run unchanged.
    - A cheap first pass with the same seed measures the sound's length and whether it uses the reverb. The real render is then exactly long enough, with the reverb baked in.
    - Every effect is rendered at boot, in the background, with no user gesture needed: three variants each at 32 kHz, and one for effects longer than 2 s (fanfares, sirens, thunder). That makes 88 buffers, about 12 MB. Each effect gets a pool of spatial sounds that cycles through its variants, plus ±3 % random pitch.
  - [x] Distance and panning.
    - The listener hovers 8 units above the camera target, looking down, with its "up" along the camera's view across the ground. Sounds pan with their position on screen and follow camera rotation.
    - Volume falls off linearly with distance, adjusted for the listener's height, so it stays within about 2 % of the old 14 → 50 unit rule.
    - Sounds with no position stay under the listener.
  - [x] Voice limits and per-sound throttling kept: 24 voices, per-name maximum and minimum gap, priority stealing with a short fade.
  - [x] The procedural music stays on raw Web Audio (risk table, section 4).
    - The engine is created on audio.js's own `AudioContext` (`CreateAudioEngineAsync({ audioContext })`).
    - Its main output is re-wired into audio.js's effects input, ahead of the shared compressor and master gain. Mute and volume therefore cover everything, and the compressor still glues loud battles.
    - AudioEngineV2 has no public option for this, so it is the one internal property used (`mainOut._inNode`). If that ever changes shape, the engine keeps its own output and mirrors the mute button.
    - The victory and defeat fanfares duck the live music, as before.
  - [x] Fallback: until the first user gesture creates the engine, or while a sound is still rendering, the game plays audio.js's live synth as before.
  - [x] New: unit acknowledgement barks (D4).
    - A small formant synthesizer speaks gibberish lines in the spirit of Warcraft III: a glottal buzz through three gliding vowel formants, with noise for consonants.
    - Voices are mapped from unit data:
      - workers, cavemen, soldiers, heavy troops, mystics and the sorceress;
      - radio chatter in the Atomic to Digital Ages, robot voices in the Future and Galactic Ages;
      - one voice per hero.
    - Engines (combustion vehicles), droid bleeps (Digital Age vehicles and later), a trumpet (war elephant) and bubbles (water elemental).
    - The lead unit of the selection answers selection, move and attack orders (`Input.barkFor`), one unit at a time.
    - Lines render on first use; the player's worker and hero voices render at game start. The three.js path plays them with the live synth.
  - [x] New: ambient beds, rendered offline into seamless loops (cross-faded loop points).
    - Wind grows louder as the camera zooms out.
    - Birds chirp by day at random spots around the camera; crickets play at night. Both follow the game clock.
    - The citadel has a spatial drone, heard from just outside its moat.
  - Verified in Chromium against the live mix with a stereo analyser:
    - A sound 12 units right of the target plays about 3 : 1 right/left, and is mirrored when the camera turns 180°.
    - Barks are centred.
    - The ambient volumes follow day and night.
    - Mute silences the engine.
    - The console is clean.
- [x] **M8 – Visual upgrade (the Reforged look).** `src/babylon/Graphics.ts`, `Painterly.ts`, `Particles.ts`.
  - [x] Painterly triplanar texture plugin (D3).
    - One tileable 256 × 256 texture is generated at load, with four painted patterns: stone blotches and cracks, wood grain, cloth weave, brush strokes.
    - `PainterlyPlugin` samples it triplanar in object space (normals from screen-space derivatives, as the models are flat shaded), so paint sticks to moving units and the baked models need no UVs.
    - Each material mixes the patterns according to its kind: exact palette colours first, then hue, saturation and value; team-coloured parts count as cloth.
    - Applied to every model (the HUD's icons and portrait too), trees, rocks and bushes.
  - [x] Team-colour shader: done in M4 (`TeamColorPlugin`, one material and draw call per part for every team); the paint applies on top.
  - [x] `CascadedShadowGenerator` with PCF filtering: 2 cascades at 1024 on Medium, 3 cascades at 2048 (high-quality PCF) on High.
    - Casters and receivers come from the bake's castShadow / receiveShadow flags. `ModelLibrary.onCaster` registers each new instance and removes it when disposed.
    - Trees, rocks and bushes cast shadows; the ground receives them.
  - [x] `SSAO2RenderingPipeline` on High (half resolution, 12 samples).
  - [x] `GlowLayer` for emissive parts (Medium and High).
  - [x] `DefaultRenderingPipeline`.
    - A half-float HDR target with ACES tone mapping, contrast, `ColorCurves`, bloom (threshold 0.82), sharpen and a light vignette.
    - FXAA on Medium, 4× MSAA on High.
    - StandardMaterial writes linear colour through its `IMAGEPROCESSINGPOSTPROCESS` path. The plugins follow:
      - the fog-of-war factor is linearized;
      - lit colour may exceed 1 so the tone mapping rolls highlights off;
      - unlit translucent overlays use alpha^1.5, because linear blending makes them look much stronger;
      - additive effects are brightened so spells feed the bloom.
    - The water shader outputs linear colour too.
    - With HDR the sun is 25 % stronger for more contrast between light and shade.
  - [x] Distance haze: linear scene fog from 1.05× to 3.2× the camera distance (none in the foreground, about a fifth at the top of the screen at any zoom). It is coloured by the time of day, and the water gets the same.
  - [x] `GPUParticleSystem`, with the CPU `ParticleSystem` as fallback. Sprites are drawn procedurally; systems are pooled per kind; the quality preset scales the particle counts.
    - Fire, smoke and sparks on explosions.
    - The nuke's fireball and rising smoke column, and the meteor's fire trail.
    - Blizzard snow, and sparkles for Holy Light and level-ups.
    - New: buildings below half health burn and smoke as in Warcraft III, more fiercely closer to collapse (the 24 nearest visible ones).
  - [x] Day/night colour grading.
    - Keyframed `ColorCurves` and exposure: neutral, slightly warm days, golden hour at dawn and before the 18:00 nightfall, lifted nights.
    - A moonlight post-process at night maps the image onto a blue luminance ramp, while bright saturated lights (fires, magic, team colours) keep their colour. `ColorCurves` can't do this: their tint multiplies, so green grass stays green.
  - [x] Quality presets in the game menu (Babylon renderer), saved between sessions; `?quality=low|medium|high` overrides them.
    - **Low** is the original look: no post-processing, no paint, no shadows.
    - **Medium** adds HDR, tone mapping, grading, bloom, haze, glow, paint and 2 shadow cascades.
    - **High** adds 3 sharper cascades, SSAO and MSAA.
  - Verified with screenshots against Low and three.js: home base, citadel (wide and close), dusk, night, zoomed out, close-ups, effects and a burning building. Runtime switching through the menu works, with a clean console.
  - In this scene High draws about 7× as many calls as Low (the shadow cascades, SSAO's geometry pass and the glow layer each redraw the scene). M9 addresses this.
- [x] **M9 – Performance.** Target: 60 fps with 200+ units on screen.
  - [x] Benchmark scene.
    - `?bench=240` spawns two armies of 16 unit types, from the Bronze Age to the Galactic Age, between your base and the citadel, and makes them fight.
    - `?fps=1`, or **Ctrl+Shift+F** in any build, shows a readout: fps, simulation / view / HUD milliseconds, draw calls and active meshes.
    - `window.__perf` exposes the same numbers for headless measurement, and Babylon's `SceneInstrumentation` supplies the per-frame draw calls and evaluation times.
  - [x] Instanced unit parts, merged.
    - At load, every static part under each animated node of a model (the nodes named in its parts contract, and the root) is merged into one mesh in that node's space, whatever its material.
    - Colours, team-colour factors and paint become vertex attributes read by one shared material (`MergedModel.ts`). The team colour stays per instance, so each merged part is one draw call for every unit of a model on every team.
    - Glowing, translucent and depth-write-off parts keep their own materials.
    - Template meshes go from 3,097 to 925: footman 24 → 6, knight 31 → 8, rifleman 31 → 6.
    - All 147 models keep exactly the vertex bounds of the three.js version. Close-ups match with and without merging (`?merge=0` turns it off for comparison).
    - Winding follows the glTF meshes (counter-clockwise), and mirrored parts flip.
  - [x] Unit-level culling: a unit outside the camera frustum is disabled outright, with a margin for its shadow, so none of its parts is evaluated, animated or drawn. Hidden model templates are disabled too, so the scene no longer walks their ~4,000 meshes each frame.
  - [x] Thin instances for every repeated prop (trees per 32 × 32 chunk and species, rocks, bushes, flowers; since M3).
  - [x] Shadow casters are culled per cascade. Babylon's `CascadedShadowGenerator` draws every caster into every cascade, so `Graphics.cullCascades` gives each cascade's map a custom render list of only the casters inside that cascade's light frustum. The shadow distance follows the camera zoom, and off-screen units cast nothing (they are disabled).
  - [x] The glow layer draws only the parts that glow (emissive or team-emissive parts kept out of the merge), instead of re-rendering the whole scene in black.
  - Not done, with reasons:
    - Freezing world matrices and materials for static buildings: Babylon already skips recomputing the world matrix of a node that hasn't moved. Freezing materials would stop the fog-of-war texture and paint toggles from binding.
    - Merging static buildings across instances: merging per model already makes each building part one instanced draw call.
  - [x] First-run quality check: with no saved preset, the game starts on High, measures six seconds of play and steps down to Medium below 45 fps (then Low below 30). It saves the result and tells the player.
  - Measured with the 240-unit benchmark (390 units on the map, software rendering, Low; CPU-side numbers, as fps here is bound by the software rasterizer):

    | | before M9 | after M9 |
    |---|---|---|
    | draw calls per frame | 537 | 220 |
    | active meshes | 7,005 | 1,994 |
    | meshes in the scene | 14,484 | 7,715 |
    | active-mesh evaluation | 75 ms | 29 ms |
    | Babylon render (CPU) | 21.8 ms | 9.5 ms |

  - The same benchmark at 120 units on High (shadows, SSAO, glow): 1,489 → 652 draw calls per frame. The glow pass went from 183 to 25 draws and the shadow cascades from about 1,116 to about 440. Screenshots of the M8 scenes on High show the same shadows as before.
  - **Real-GPU fps needs checking on real hardware.** This environment renders with SwiftShader on the CPU, so it can't show the frame rate a graphics card gives. The CPU-side cost per frame has dropped about 2.5×, and the first-run check keeps slower machines smooth.
- [x] **M10 – Package with Electron.**
  - [x] `npm run dist` builds `release/Heroes-and-Empires-Setup-0.1.0.exe`, an NSIS installer for x64 Windows (113 MB):
    - per-user, no admin rights needed, with a choice of folder;
    - Start-menu and desktop shortcuts;
    - an uninstaller registered in *Apps & features*.
  - [x] App icon: `build/icon.png` (512 × 512), embedded in the `.exe` at 16–256 px with the version info (product name, version, company). It is also the window and taskbar icon.
  - [x] Smaller package: Vite bundles the whole game (Babylon, fonts and the three.js renderer that is still selectable), so those packages are now devDependencies. `app.asar` holds only `dist/` and `dist-electron/`: 97 MB → 10 MB.
  - [x] Publishing is off (`publish: null`, `--publish never`); the game has no auto-updater.
  - [x] Fullscreen: F11 (title screen and menus), Alt+Enter (anywhere) and the ⛶ button all toggle the window's fullscreen through the preload bridge. During a game F11 opens the Generals board, as before.
  - Checked here:
    - The packaged app (same `app.asar`, as an unpacked Linux build) runs under Xvfb: title screen, offline fonts, starting a game on High, AI generals playing, no errors. Fullscreen through F11, Alt+Enter and the button was checked in Electron.
    - The installer `.exe` is a well-formed NSIS PE32 file, and the app `.exe` a PE32+ x64 GUI binary carrying the icon and version resources.
    - Under Wine 9, a silent install (`/S /D=…`) puts 378 MB in the chosen folder with the uninstaller, both shortcuts and the *Apps & features* entry. The silent uninstall removes them, and a reinstall works.
  - Not checked here **(flag D5)**: running the game from the installed `.exe`. Electron starts under Wine but draws no window (Wine has no DirectComposition), so this needs a Windows PC.
  - Building on Linux needs Wine, 64- and 32-bit: electron-builder runs the uninstaller stub under it. Its downloadable Wine 11 bundle for Linux lacks the Windows-side DLLs, so it doesn't work. Building on Windows needs nothing extra (README).
  - Testing under Wine needs one workaround in the Wine prefix: Wine's `powershell.exe` stub returns success for everything, so the installer's "is the game still running?" check always answers yes and the install aborts. With the stub removed, the installer falls back to `tasklist`. Real Windows runs the actual query.
- [x] **M11 – TypeScript simulation.** The whole engine-free simulation is strict TypeScript: 22 files and about 9,100 lines in `src/data`, `src/world`, `src/game` and `src/ai`, converted in four steps (data, world, core game, AI) with the game running and tested after each.
  - [x] Shared types:
    - `data/types.ts`: `UnitDef` (every field the 93 unit and building definitions use), `HeroDef`, `ItemDef`, `AgeDef`, `UpgradeDef`, `Mood`.
    - `game/types.ts`: `Player` (with the empire economy as `EmpirePlayer` and an `isEmpire` guard), `Order` as a discriminated union of the 16 order types, `Buff`/`Mods`, harvest state, training and research queues, corpses, ground items, creep camps.
    - The classes are their own types: `Game`, `Unit` (every field it carries is declared, including the ones that used to appear at runtime), `Terrain`, `PathGrid`, `Roads`, `Fog`, `Projectiles` (`Shot | Beam`), `GeneralAI`.
    - `SimHooks` (`game/hooks.ts`) now speaks `Unit`, `Player` and `GroundItem`.
  - [x] The Babylon renderer uses these types directly. Its stand-in interfaces (`babylon/types.ts` and the local `*Like` types) and the `as never` casts are gone; components that need only a few fields take a `Pick<>` of the real type.
  - [x] Imports of the converted modules use `.ts` specifiers (`allowImportingTsExtensions`), which Vite, `tsc` and Node's type stripping all accept. `tsconfig.sim.json` (part of `npm run typecheck`) keeps the simulation to erasable syntax, so Node can run it directly: the model bake tool does, and so does the new `npm run sim`.
  - [x] `npm run sim` runs a seeded game with four computer generals and no renderer, printing a hash of the whole world state (every unit's position, health and order, every player's economy, the fog) each game minute. This is also the check that the simulation does not depend on an engine.
  - [x] No behaviour changes, checked three ways:
    - Seeded headless runs of the converted code produce exactly the same per-minute world hashes as the JavaScript it replaced: 15 minutes on Hard with four AI generals, and 30 minutes on Easy with a Hero and allied empires reaching the eleventh age.
    - Map generation (heights, ground types, path flags, trees, doodads) hashes identically before and after.
    - The scenario suites pass on both renderers (67/67 each), and a boot test of both renderers plays with no console errors after each step.
  - Where the types meet the dynamic code: about 16 type assertions (`as`), mostly at call sites whose invariant the code already relies on (a harvest order's target is a gold mine or a tree, a unit-target spell always has a target). Non-null assertions (`!`) mark values that are present by construction (typed-array reads, a building's footprint, a hero's level), exactly where the JavaScript read them without checks.
  - Still JavaScript after M11 (outside the simulation): the HUD (`ui/`), `input.js`, `main.js`, `audio.js` and the three.js renderer (`render/`). M12 removes the three.js renderer and converts the rest.
- [x] **M12 – Remove three.js.**
  - [x] Dropped the `?renderer=three` path and every three.js import from `src/`.
    - Deleted the three.js renderer: `src/render/view.js`, `terrainView.js`, `unitview.js`, `effects.js`, `projectiles.js`, `previews.js`, and `src/ui/icons.js`.
    - `main.ts` always loads `BabylonView` and `SpatialAudio`.
    - The 2D overlay moved to `src/ui/overlay.ts`.
    - The Electron development launcher's `HE3D_QUERY` passes test parameters to the page in unpackaged runs only.
  - [x] three.js remains only as a devDependency of the model bake (D1).
    - The procedural builders and their asset helpers moved from `src/render/` to `tools/models/`, next to the three.js gallery that edits them.
    - `tools/bake-models.mjs` bakes from there. The baked GLB is byte-identical to the one baked from the old location.
    - Neither `dist/` nor the single-file Artifact build contains any three.js code (checked by searching the bundles).
  - [x] Converted the rest of the application to strict TypeScript: `main.ts`, `input.ts`, `audio.ts` and the HUD (`ui/hud.ts`, `commands.ts`, `minimap.ts`, `overlay.ts`), about 5,600 lines. Every file in `src/` is now TypeScript.
    - New shared types:
      - `input.ts`: `TargetMode`, what the next click does (a union of the order modes, a nuke silo or a spell caster);
      - `ui/commands.ts`: `CommandButton`, the command card's button model;
      - `audio.ts`: its voices, synth functions, music state and voice tables (`BarkKind`, `Speaker`, `Formants`, …);
      - `globals.d.ts`: the desktop bridge and the debug handles on `window`.
    - `SimHooks.onGameOver` now passes the game's own `GameOver`.
    - Dropped renderer feature checks in `main.ts` (`typeof view.setQuality === 'function'` and similar): Babylon is the only view.
    - Behaviour is unchanged, checked with the original JavaScript `audio.js` side by side in Chromium:
      - all 287 sounds (every effect in two variants, every bark line of every voice, the ambient loops and bird calls) rendered offline by both synths match sample for sample, apart from reverb rounding. The reverb's convolver varies by up to about 0.005 from run to run, by the same amount between two runs of the old code;
      - the live path creates the same Web Audio nodes for every effect and bark, and the music scheduler runs.
  - [x] Final checks:
    - `npm run typecheck`, `npm run build` and `npm run build:artifact` pass.
    - The 67 scenario checks pass (interaction, walls and gates, map mechanics, research, town-centre UI).
    - A boot test of an empire game and a hero game plays with a clean console, and so does the title-screen walk-through in the table below.
    - The seeded headless runs still give the M11 world hashes exactly (15 minutes on Hard, and 30 minutes on Easy with a Hero).
    - The 120-unit benchmark on High draws 595–611 calls per frame (652 after M9).
    - The production build runs in Electron (`app://`, offline fonts, no `require` or `process` in the page) and `npm run dist` builds the installer.
  - [x] Feature parity with section 1.1:

    | Feature group (1.1) | Where it was checked |
    | --- | --- |
    | Title and setup screens, menus, end screen | An M12 walk through `main.ts`'s UI with no `autostart` (13 checks, clean console): pick the Empire path, remove and add computer generals, make one an allied hero, set the difficulty, start; open the menu (F10), switch the graphics preset, open Quests, close; lose, then return to the title screen with the settings kept. Fullscreen through F11, Alt+Enter and ⛶ (M10). |
    | Game modes, victory and defeat | Scenario checks ("empire falls 20 s after losing its last town center", allied hiring); M5's 28-minute AI game to an empire's collapse; the seeded headless runs. |
    | Map, terrain, water, citadel, trees, doodads, camps, roads | M3 and M4 comparisons against three.js; the screenshots below. |
    | Fog of war | M3 (black mask and explored fog); the night and citadel screenshots. |
    | Camera | M2 (picking, projection, zoom, panning, edge scrolling, wheel modes); the walls check drags in screen space. |
    | Units, models, animation, rings, buffs, carried resources, ghosts | M4: all 147 models, vertex bounds within 0.01 units; M9: merged parts with identical bounds. |
    | Selection and orders | `interact` checks: click, box select, smart right-click, attack, targeting, casting, placement, the road tool, rally; `walls` checks: line tool, gates. |
    | Simulation | M11 hashes, unchanged in M12. |
    | Effects and projectiles | M5 (same API, timings and shapes) and M8 (particles); the battle screenshot. |
    | HUD, command card, portrait, minimap, overlay | M6; the `tcui` and `research` checks read the command card, tooltips, hotkeys and mood display. |
    | Audio | M7 (spatial mix, voice limits, mute, music); the M12 synth equivalence check above. |
    | Tools | `tools/gallery.html` (three.js builders) and `tools/gallery-babylon.html` (baked models); `build-artifact.mjs`. |

  - [x] Before and after screenshots: [`docs/migration/`](docs/migration/). Each image shows the three.js and JavaScript version (left) and the Babylon.js and TypeScript version on High (right), at the same camera position and hour. Since M13 the right-hand side shows the Warcraft III art pass.
    - [Home base](docs/migration/compare_home.jpg), [close-up](docs/migration/compare_closeup.jpg), [the citadel](docs/migration/compare_citadel.jpg) and [close](docs/migration/compare_citadelclose.jpg), [dusk](docs/migration/compare_dusk.jpg), [night](docs/migration/compare_night.jpg), [zoomed out](docs/migration/compare_zoomout.jpg) and [a 120-unit battle](docs/migration/compare_battle.jpg).
    - Rendered in software (SwiftShader). Both shots of each pair are taken from the same headless setup.
  - [x] `README.md`: TypeScript and Babylon.js throughout, the run and build commands, the code layout without `src/render/`, and the model builders under `tools/models/`.
- [x] **M13 – Warcraft III art pass** (added after review). M8 added HDR, grading, shadows and a faint paint layer, but kept the original flat colours, faceted low-poly props and blurry ground, so the game looked the same as the three.js version. M13 replaces the art itself. Everything is still generated in code, and the simulation is untouched (its seeded hashes are unchanged).
  - [x] Hand-painted ground (`GroundPaint.ts`, `GroundMaterial.ts`).
    - Eight tileable 512 × 512 paintings made with Canvas 2D at load: Lordaeron grass (layered blades, tufts, a few flowers), forest floor with fallen leaves and needles, dirt with painted pebbles and cracks, rough road, flagstones for the citadel, wet shore with ripple marks, veined blight, cliff rock. Each has a height map. `tools/textures.html` previews them.
    - A splat shader blends them from the simulation's ground types (one weight per map cell; steep banks turn to rock). Height blending gives the crisp, irregular borders of Warcraft III's tiles. A rotated second sample hides tiling, and a macro noise map varies brightness and warmth. Ground at the waterline is darker, as if wet.
    - Replaces the 2048 px colour map and noise detail map (still painted, for the minimap).
  - [x] Water: turquoise shallows to deep blue by the real depth, scrolling ripples with sky reflection and sun glints, painted caustic streaks, and foam lapping at the shore.
  - [x] Foliage (`Foliage.ts`).
    - Trees built from lumpy blob clusters with soft normals and vertex ambient occlusion: full broadleaf crowns on stout trunks, drooping five-tier pines, crooked blighted dead trees. Bushes, mossy boulders, and flower clumps.
    - 32,688 grass tufts over the meadows. Trees, grass, bushes, boulders and flowers are batched per 32 × 32-cell chunk, so they're culled per batch.
    - A foliage shader paints greyscale leaf, needle, bark and stone textures into warm sunlit and cool shaded colour, adds moss to the tops of stones, and sways canopies and grass in the wind. Grass and flowers sink away where buildings, gates or roads stand (a per-cell mask from the path grid and roads).
    - Deep, saturated canopy colours instead of pale mint. Canopies cast shadows but don't receive them, so forests stay green.
  - [x] Models (`MergedModel.ts`).
    - Smooth normals with a 42° crease angle. The baked parts carried no normals, so every face had been lit flat; now round parts shade round and box edges stay crisp.
    - Buildings get painted structure by surface kind: brick courses on stone, planks on wood, overlapping rows of straw on thatch, tiles on team-coloured roofs.
    - Ground contact (models darken toward the terrain below them), a rim light in the sky's colour, and a painted sheen on metal and gold.
    - Player-built roads use painted cobbles, tinted per age as before.
  - [x] Low preset: no grass tufts or flowers, broadleaf crowns with fewer facets, one ground sample per layer instead of two, and plain model colours. The painted textures are made while the models load, before the first game.
  - [x] Grading: Khronos PBR Neutral tone mapping instead of ACES (which greyed out bold colours), saturated warm days, and warm-light / cool-shade shading in the lighting plugin. Night keeps the blue moonlight.
  - [x] Checks:
    - `npm run typecheck` and the builds pass. The seeded headless runs give the same world hashes, since the simulation wasn't touched.
    - The 67 scenario checks pass.
    - Opening view, software rendered: High draws 1.27M triangles in 255 draw calls, Low 0.70M in 64 (M12: 228 and 53 draw calls).
    - The 120-unit benchmark on High: 658–674 draw calls (595–611 before M13).
    - CPU-side frame time is unchanged. The extra cost is GPU work: in this environment's software renderer, the opening view runs at about 1.7 fps on Low against M12's 3.3, and at 0.38 fps on High against 0.52. That is 1.4–1.9× the rasterization for a much richer scene. A graphics card absorbs this easily, and the first-run quality check still steps slow machines down to Medium or Low. **Real-GPU frame rates still need checking on real hardware**, as for M9.
  - Screenshots: [`docs/migration/`](docs/migration/) now compares the three.js version with the M13 look; the M12 images, which looked almost the same as the three.js version, were replaced. The battle shot fast-forwards until the armies meet, since software rendering on High draws about one frame per second.
- [x] **M14 – Rigged characters and buildings, unit sounds, a larger map, scrolling** (added after review: "the models and animations are low quality … more sound effects for all of the units … the map is still too small and there should be more to do on it … scrolling is still a little weird").
  - **Characters.** Infantry, casters and heroes from the Stone to the Galactic Age, and Kalenden's Legion, are now rigged and animated characters: Kay Lousberg's KayKit *Adventurers* and *Skeletons* packs (CC0; fetched from GitHub by `tools/kaykit/import.mjs`, which writes `src/assets/kaykit/kaykit.bin` with the packs' licences beside it).
    - 38 unit types use them (`src/babylon/CharacterRecipes.ts`), brigands and the Bandit Lord included: a body, props (helmets, capes, shields, swords, axes, staves, crossbows), a height and the clips for each simulation state. Firearms for the gunpowder to galactic ages are built in code in the packs' style (`CharacterProps.ts`), some with glowing parts.
    - Rendering (`Characters.ts`): one material for every character, skinned on the GPU from a vertex animation texture (every frame of every clip as half-float skinning matrices). Each unit is an instance with its team colour and its frames as instance attributes, so a unit type is one draw call whatever its units are doing. Frames are interpolated, clips crossfade, and shadow maps run the same skinning (nearest frame).
    - Animation (`UnitView.ts`): the blow lands when the simulation deals damage (the clip's impact moment, found by the importer, is timed to the wind-up), walks are paced to the unit's speed, idles vary, fighters keep a combat stance for a moment, rapid-fire units loop their firing clip, deaths play out and sink, raised undead climb out of the ground, Bladestorm spins.
    - Portraits and command-card icons show the characters.
    - Cavalry, siege, vehicles and beasts keep their procedural models, with livelier animation: beasts bite and lunge, bodies lean into a walk, heads look about, and four-legged creatures roll onto their side when they die.
  - **Buildings.** The *Medieval Hexagon* pack (same author, CC0) supplies the Medieval Age town center (a castle), the Dark and Medieval Age houses, barracks, lumber yard, research center (a smithy), arcane sanctum (a church), scout and guard towers, the tavern and the marketplace. Their blue roofs and banners take the team colour, as on Warcraft III's human buildings. They rise through the pack's construction stages and collapse into its rubble. The character material draws them unskinned, one draw call per building type. Other buildings, and every age's other styles, stay procedural.
  - **Sounds** (`src/unitSounds.ts`, `src/audio.ts`). Every unit and building sounds like itself, still synthesized in code:
    - melee blows by weapon and by what they strike (flesh, armour, wood, stone, bone, water);
    - shots and impacts for every weapon from slings to graviton lances, and deaths by kind (soldiers, riders, beasts, undead, machines, buildings);
    - select, move, attack and ready voices for every class;
    - building clicks that change with the age;
    - creature calls near creep camps and a roar when a camp is attacked;
    - movement loops for tracks, hover engines, walkers, hooves and wheels;
    - effects for the new map content.
    - A director turns the simulation's generic sound names into the unit-specific sounds, so the simulation didn't change for it. New sounds render in the background on first use. Group limits and a soft clipper keep 200-unit battles clear: peaks of −6 dBFS and no clipped samples, measured.
  - **Map** (`src/world/layout.ts`, `src/game/neutrals.ts`, `src/game/quests.ts`). 384 × 384 instead of 256 × 256, still four-fold symmetric.
    - Regions: four quadrants, edge outposts and four ring-road villages.
    - Camps and bosses: 64 creep camps (tiers 1–5) with new creeps (murlocs, brigands, harpies, troll shamans, naga sirens), and four lair bosses with spells and their own artifacts.
    - Items: tiered loot scaled to the camp.
    - Neutral buildings: taverns to recruit Heroes, marketplaces, themed mercenary camps, fountains of health and mana, goblin labs, linked waygates and shrines.
    - Quests, shown in a quest log: free caged captives, bounties on bosses, buried treasure, wagon escorts, and clearing a region.
    - Expansions and secrets: guarded expansion mines with lumber groves, secret glades, hidden tome stashes, runes.
    - The computer generals use the waygates, taverns, mercenary camps and quests, and expand to the new mines.
  - **Scrolling.** As in Warcraft III, only a thin band at the window edge scrolls, at full speed from the start, so the HUD along the edges no longer drags the map. Acceleration, braking, zoom and the camera's height over hills ease by real time, so they feel the same at any frame rate. A slider in the menu sets the speed from 40 to 250 %.
  - **Fixes on the way:** lobbed stones and javelins never dealt damage (arcing shots reached their target as null); the first frame of a game could run the clocks backwards; an AI empire without a town hall crashed the general AI.

---

## 4. Risks and things with no direct equivalent

| Item | Risk | Mitigation |
| --- | --- | --- |
| Procedural model builders | No Babylon equivalent of three's full geometry API (`ExtrudeGeometry` bevels, `LatheGeometry` UVs). | Bake with three.js at build time (D1). |
| `onBeforeCompile` string patches | Babylon shaders are structured differently. | `MaterialPluginBase` gives defined hook points. |
| Live portrait (second `WebGLRenderer`) | Babylon prefers one engine. | Resolved in M6, without `registerView`: the portrait renders into a scissored rectangle of the main canvas each frame and is copied into its own 2D canvas, with no second WebGL context. |
| Procedural music on raw Web Audio | AudioEngineV2 hides some low-level scheduling. | Resolved in M7: the engine runs on audio.js's `AudioContext`, and the music stays a raw Web Audio scheduler on it. The engine's output is routed into the same compressor and master gain, through one internal property (`mainOut._inNode`) with a fallback. |
| Windows `.exe` verification | No Windows here; Electron draws no window under Wine. | D5: installer checked under Wine (install, uninstall, reinstall); running the game needs a Windows PC. |
| Size of the strict-TypeScript conversion | About 19,000 lines of dynamic JavaScript. | Incremental `allowJs` → `.ts` (D2): the simulation in M11, checked against the old code with seeded headless runs; the UI in M12. |
| 200+ units at 60 fps on integrated GPUs | Many small meshes per unit. | M9: parts merged per animated node and instanced with the team colour per instance, unit-level frustum culling, shadow casters culled per cascade, quality presets and a first-run quality check. No LOD was added. The GPU frame rate still has to be measured on real hardware. |
| Headless verification | Screenshots use software rendering (SwiftShader), so fps numbers aren't representative. | Report draw calls, active meshes and CPU frame time from the benchmark scene. GPU fps must be checked on real hardware. |
