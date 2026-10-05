# Migration plan: three.js → TypeScript + Babylon.js + Vite + Electron

Status: **in progress.** Milestones M1–M5 are done; see section 3.

Branch: `babylon-migration`, created from `claude/heroes-empires-3d-game-gytx45` at `fbda849`. The
original stays untouched on its own branch, and the three.js version keeps running until every
milestone below has been ported and checked.

Visual target: the chunky shapes, bold colours and hand-painted look of Warcraft III, with modern
lighting and effects on top, in the spirit of Warcraft III: Reforged.

---

## 0. Decisions to approve before converting

These are the places where the request and the codebase don't line up one-to-one. Each one has a
recommendation.

| # | Topic | Situation | Recommendation |
| --- | --- | --- | --- |
| D1 | **147 procedural 3D models** | Every unit, building, creep and prop is built in code from three.js geometry: about 10,700 lines in `src/render/models/*`, using `BoxGeometry`, `CylinderGeometry`, `ExtrudeGeometry` with `Shape`, `LatheGeometry`, `mergeGeometries` and so on. There are no model files. | **Bake them to glTF.** A Node script (`tools/bake-models.ts`) runs the existing builders on the CPU (three.js geometry needs no WebGL) and writes `public/models/*.glb`. Team-coloured materials are tagged, and the animation "parts" contract (legs, arms, weapon, doors, …) goes into glTF `extras`. The game loads the GLBs with `@babylonjs/loaders`, so **the shipped app contains no three.js**. three.js stays only as a dev dependency of the bake script, which keeps the models editable as code. The alternative is to hand-port all 10,700 lines to Babylon `MeshBuilder`. That is a large job with a real risk of visual drift, so I don't recommend it. |
| D2 | **TypeScript strict** | About 19,000 lines of JavaScript, with dynamic objects everywhere (units and players gain properties at runtime). | All **new** code is strict TypeScript from day one. The engine-free simulation is converted **file by file**, so the game keeps running throughout: `allowJs` at first, then `.ts` with interfaces for Unit, Player, Order and Game. Milestone M11 finishes this. |
| D3 | **Hand-painted textures** | The game has no textures today: everything is flat-coloured Lambert material. | Generate tileable **painterly textures procedurally** at load time (stone, wood, thatch, metal, cloth, leather, foliage, earth, skin). Apply them **triplanar** through a Babylon `MaterialPluginBase`, so baked models need no UV work. No external art assets are needed. |
| D4 | **Unit acknowledgements** | There are no voice lines. All audio is synthesized with Web Audio: 36 effects plus procedural music. | Pre-render the existing synths into `AudioBuffer`s and play them as Babylon `StaticSound`s with spatial positioning. Add **new synthesized acknowledgement "barks"** (formant-synth grunts per unit type and age) for select, move and attack. These are new content, not ported content. |
| D5 | **Windows installer** | This environment is Linux with no Wine and no Windows machine. | `electron-builder --win nsis` can cross-build the installer here (with `signAndEditExecutable: false`, since Wine isn't available to embed the icon). I'll check the unpacked app runs under Electron on Linux (Xvfb), and that the NSIS `.exe` is produced and well formed. **Installing and running the `.exe` has to be done on a Windows PC.** I can install Wine for a best-effort smoke test, but Electron under Wine is unreliable, so this item stays flagged. |
| D6 | **Claude Artifact build** | `npm run build:artifact` builds a single-file web version, which is what's published at the claude.ai link. | Keep it working as a secondary target. Babylon's bundle is larger but still fits in one file. |
| D7 | **Skeletal animation and AnimationGroups** | No model has a skeleton. Animation is procedural: the code rotates "part" nodes every frame. | Keep the procedural animation driver, ported to Babylon `TransformNode`s. `AnimationGroup` is used only where it helps (door swings, UI). The "baked vertex animation" step in milestone 9 doesn't apply; the performance work goes into instancing instead (see M9). |

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
              fullscreen, devtools only when !app.isPackaged), CSP, offline file:// loading.
  preload.ts  contextBridge: { toggleFullscreen, isElectron, appVersion }.
tools/
  bake-models.ts   runs the procedural builders (three.js, dev-only) → public/models/*.glb
  gallery.html     Babylon model gallery.
```

**Migration path.** While the port is in progress, the Babylon renderer lives in `src/babylon/` and
is selected with `?renderer=babylon` (the desktop build opts in). `BabylonView` implements the same
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

The three.js renderer keeps working in parallel, behind `?renderer=three`, until M12.

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
- [ ] **M6 – HUD and interface.**
  - Keep the HTML/CSS HUD.
  - Port command-card icons to `RenderTargetTexture` and the live portrait to `engine.registerView`.
  - Keep the overlay canvas and minimap working; bundle the fonts locally for offline Electron.
- [ ] **M7 – Audio.**
  - Babylon AudioEngineV2: spatial `StaticSound`s from pre-rendered synth buffers, with the listener on the camera target.
  - Keep the voice limits and per-sound throttling; port the procedural music onto the engine's bus.
  - New: unit acknowledgement barks (D4) and ambient beds (wind and birds by day, crickets by night, the citadel's drone).
- [ ] **M8 – Visual upgrade (the Reforged look).**
  - Painterly triplanar texture plugin (D3) and a team-colour shader.
  - `CascadedShadowGenerator` with soft PCF shadows, SSAO2, and a `GlowLayer` for emissive parts and spells.
  - `DefaultRenderingPipeline`: bloom, **ACES tone mapping**, colour grading (`ColorCurves`/LUT), FXAA, plus distance fog (`scene.fogMode`).
  - `GPUParticleSystem` for spells, explosions, fire, smoke and the nuke.
  - Day/night colour grading.
  - Quality presets (Low/Medium/High) in the options menu.
- [ ] **M9 – Performance.**
  - Target: 60 fps with 200+ units on screen.
  - Instanced unit parts (one draw call per part type across all units and teams).
  - Freeze world matrices and materials for static buildings; thin instances for every repeated prop.
  - Merge static building meshes per age style; cull shadow casters per cascade.
  - Benchmark scene with an fps readout and a headless measurement of draw calls and frame time.
- [ ] **M10 – Package with Electron.**
  - electron-builder NSIS `x64` installer, app icon, offline fonts.
  - Check the unpacked app runs under Electron (Linux, Xvfb).
  - Produce the Windows installer **(flag D5: run it on Windows to confirm)**.
- [ ] **M11 – TypeScript simulation.** Convert `sim/` file by file to strict TypeScript with interfaces for the core entities. No behaviour changes: the simulation and scenario tests must pass after each file.
- [ ] **M12 – Remove three.js.**
  - Drop the `?renderer=three` path and every three.js import from `src/`.
  - three.js remains only as a devDependency of `tools/bake-models.ts` (D1).
  - Final feature-parity pass against section 1.1, before/after screenshots, updated `README.md`, every box ticked here.

---

## 4. Risks and things with no direct equivalent

| Item | Risk | Mitigation |
| --- | --- | --- |
| Procedural model builders | No Babylon equivalent of three's full geometry API (`ExtrudeGeometry` bevels, `LatheGeometry` UVs). | Bake with three.js at build time (D1). |
| `onBeforeCompile` string patches | Babylon shaders are structured differently. | `MaterialPluginBase` gives defined hook points. |
| Live portrait (second `WebGLRenderer`) | Babylon prefers one engine. | `engine.registerView(canvas, camera)` renders a second camera into the portrait canvas. |
| Procedural music on raw Web Audio | AudioEngineV2 hides some low-level scheduling. | Keep a raw-Web-Audio music synth connected to the engine's audio context if the API allows; otherwise the music keeps its own `AudioContext`. Flagged in M7. |
| Windows `.exe` verification | No Windows or Wine here. | D5. |
| Size of the strict-TypeScript conversion | About 19,000 lines of dynamic JavaScript. | Incremental `allowJs` → `.ts` (D2, M11). |
| 200+ units at 60 fps on integrated GPUs | Many small meshes per unit. | Part instancing with instanced team colour; LOD (hide small details beyond a distance); quality presets. |
| Headless verification | Screenshots use software rendering (SwiftShader), so fps numbers aren't representative. | Report draw calls, active meshes and CPU frame time from the benchmark scene. GPU fps must be checked on real hardware. |
