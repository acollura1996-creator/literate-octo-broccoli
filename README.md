# Heroes & Empires 3D

A browser-based 3D real-time strategy / hero game modelled on the Warcraft III custom map
**Heroes & Empires** (by Lord_Squad and FinalLegacy):

> A group of Generals want to inhabit the land of Kalenden. Your mission is to kill Kalenden
> himself and claim his lands as your own. Your choice to work together or against each other.

Like the original, every general picks one of two paths:

- **Hero**: gain experience, buy items and survive. You control a single Hero from an Altar of
  Heroes. You level up to 10 on creep camps, learn four abilities, carry six items, hire
  mercenaries, and are revived at your Altar when you fall.
- **Empire**: build houses, an economy and soldiers, and advance through history across twelve
  ages: from cavemen with clubs in the Stone Age, through bronze, iron, gunpowder and steam, to
  tanks, nuclear missiles and laser-armed mechs, and finally war titans and starfighters in the
  Galactic Age. Your citizens pay the taxes and eat the food from your
  farms, and they riot if you treat them badly.

The game is written in TypeScript and drawn with [Babylon.js](https://www.babylonjs.com), built with
Vite and packaged for Windows with Electron. Its look follows Warcraft III: hand-painted ground
tiles (Lordaeron grass, dirt, flagstones, blight, cliff rock) with crisp, irregular borders, lush
rounded trees, grass tufts and flowers, bright water with shore foam, and chunky models with
painted brick, plank, thatch and tile detail under warm, saturated light.

Soldiers, spellcasters, heroes and Kalenden's undead are rigged, animated characters from Kay
Lousberg's free [KayKit](https://kaylousberg.com) *Adventurers* and *Skeletons* packs (CC0): they
swing, shoot, cast, cheer and fall with hand-made animations, timed to the game's attacks and
paced to their speed, and wear team colours. Firearms from muskets to plasma rifles are made in
code in the same style. Everything else is generated in code: buildings, cavalry, siege engines,
vehicles and beasts are procedural meshes (baked to one glTF file at build time), the textures are
painted with Canvas 2D at load, and sounds and music are synthesized with Web Audio.
`tools/textures.html` previews the paintings and `tools/characters.html` the characters.

## Running

```bash
npm install
npm run dev            # browser, http://localhost:5173
npm run dev:electron   # desktop window (Electron) against the dev server, with hot reload
npm run typecheck      # TypeScript, game and Electron code
npm run sim            # headless game (no renderer): four computer generals, a state hash per minute
npm run build          # typecheck, then dist/ (game) and dist-electron/ (desktop main process)
npm run preview        # serve dist/ in the browser
npm run dist           # build, then the Windows installer in release/ (electron-builder, NSIS x64)
npm run build:artifact # single self-contained dist-artifact/index.html and artifact.html
```

The game needs WebGL2, a mouse and a keyboard. It was migrated from three.js and JavaScript to
Babylon.js and TypeScript; [MIGRATION.md](MIGRATION.md) records how, milestone by milestone.

### Windows desktop build

`npm run dist` writes `release/Heroes-and-Empires-Setup-<version>.exe`, an NSIS installer for 64-bit
Windows (the unpacked app is in `release/win-unpacked/`). It installs for the current user without
admin rights, lets the player choose the folder, adds Start-menu and desktop shortcuts, and registers
an uninstaller in *Apps & features*. The app icon comes from `build/icon.png`.

- **On Windows** no other tools are needed.
- **On Linux**, electron-builder runs a step of the NSIS build under Wine, 64- and 32-bit (on
  Ubuntu: `sudo dpkg --add-architecture i386 && sudo apt install wine64 wine32:i386`).
- The installer isn't code-signed, so on first run Windows SmartScreen may say "Windows protected
  your PC": choose *More info → Run anyway*. To sign it, set `build.win.signExecutable` to `true`
  in `package.json` and supply a certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`).
- Vite bundles the whole game, so every package is a devDependency and the installer ships only
  `dist/` and `dist-electron/`.

In the desktop app, **F11** or **Alt+Enter** toggles fullscreen (during a game F11 opens the
Generals board, so use Alt+Enter or the ⛶ button). Developer tools are disabled in the installed app.

## The land of Kalenden

The 384×384 map is four-fold symmetric, in a Lordaeron Summer style (even the forests mirror each
other, so every general has the same woods). Dirt roads, which speed movement, link the bases to
the outposts and to a ring road around the moat.

- **Corners**: one start location per general (up to 4), each with open ground for a town, a gold
  mine, forests around it, a nearby Goblin Merchant and a hill Mercenary Camp.
- **Center**: Kalenden's walled citadel on a blighted plateau, ringed by a moat that can only be
  crossed at four diagonal fords. It holds his Keep, four Dark Spires, the Death Guard, skeletal
  warriors, and Kalenden himself.
- **Edge outposts**: an expansion gold mine, a themed Mercenary Camp (highland ogres and harpies,
  lakeside murlocs and naga, southern brigands, western trolls and wolves), an Arcane Vault,
  Fountains of Health and Mana, a Goblin Laboratory and a Waygate to the opposite outpost, guarded
  by drakes and a rock golem.
- **Boss lairs**: behind each outpost, a ring of cliffs holds a boss with its treasure: Vyrnax the
  Red (north), the Ancient Hydra in its pool (east), Varrok the Bandit Lord (south) and the
  Broodmother (west). Bosses cast spells, drop their own artifact and return after ten minutes.
- **Villages** on the ring road: a Tavern, a Marketplace and a Waygate across the citadel.
- **Quadrants**: two guarded expansion mines along the edges with lumber groves beside them, a
  lake with murlocs and naga, ruins with harpies and runes, a brigand camp holding captives, and
  two secret glades in the forest, reached by narrow tracks: a Shrine of the Ancients and a stash
  of tomes.
- **Creep camps**: 64 camps, easy near the bases and harder farther out: kobolds, gnolls,
  murlocs, brigands, wolves, trolls and troll shamans, spiders, harpies, naga, ogres, golems and
  drakes. They leash back home, drop treasure of the tier their strength earns and respawn.

**Neutral buildings** work for your units in range, as in Warcraft III: shops and the Goblin
Laboratory (blasting charges, speed potions, flares) sell to a Hero; Marketplaces sell a changing
stock of rare finds, one of each; mercenaries and Taverns serve any of your units. A **Tavern**
recruits a Hero for a general who has none (an empire's town center revives it) or hires a Hero
general for three minutes. Right-click a **Waygate** with your units to step through to its twin.
A **Shrine** blesses the army of the first Hero to reach it, then recharges. Items come in six
tiers, from potions to each boss's own treasure.

Every few minutes **Kalenden's Legion** marches on one of the generals. Destroy Kalenden's Keep to
stop the marches. You win by slaying Kalenden, or in free-for-all by being the last general
standing.

### Empire: citizens, taxes, research and the twelve ages

The original map's empires are run like a little nation, and so are they here:

- **Citizens** live in **Houses**, and Houses must touch a road that leads back to your town
  center (Houses off the network are marked above them). Each House shelters more people in later
  ages (4 in the Stone Age up to 14 in the Future Age) and also raises your army supply.
- **Gold comes mostly from taxes.** Every citizen pays your tax rate in gold. The gold mine still
  helps early on.
- **Farms grow food**, and every citizen eats their **ration** of it. Bigger rations make people
  happier and help them shrug off plague, but cost more food.
- **Taxes and rations have no upper limit.** Your people's mood keeps them in check.
- **Mood** runs from 🌟 Utopia, 🤩 Ecstatic, 🥰 Devoted and 😍 Love through Happy, Normal and
  Unhappy to 😡 Hate. Low taxes, generous
  rations and plenty of **roads** ("build roads and make your people love you") make people
  happier; heavy taxes, hunger, plague and very crowded cities make them angry.
  - Content people pay more and move in faster, from +10% when Happy up to +60% in Utopia.
  - Nobody pays taxes while they **starve** or **hate** you.
  - Unhappy citizens **riot**: armed rebels spill out of their houses and march on your town
    center.
- Set taxes (`Z` / `X`) and rations (`C` / `V`) at the town center; hold Shift to change them by 5. The top bar shows your food
  stock and its rate, citizens / housing and the people's mood.
- **Ages**: research the next age at the town center. Everything from the town center to houses,
  farms, walls, gates, towers and roads is rebuilt in the new age's style:

  | Age | Town center | Requires | New units |
  | --- | --- | --- | --- |
  | Stone | Tribal Camp | — | Clubman, Rock Thrower |
  | Bronze | Chiefdom Hall | Barracks | Hoplite, Bowman, War Chariot |
  | Iron | Forum | Farm, Research Center | Legionary, Javelineer, War Elephant, Ballista |
  | Dark | Town Hall | Stable, Workshop | Footman, Pikeman, Archer, Light Cavalry, Knight, Catapult, Priest |
  | Medieval | Castle | Arcane Sanctum | Crossbowman, Champion, Royal Knight, Trebuchet, Sorceress, Battle Mage |
  | Gunpowder | Palace | Workshop | Musketeer, Grenadier, Dragoon, Cannon |
  | Industrial | City Hall | Research Center | Rifleman, Machine Gunner, Landship, Howitzer |
  | Atomic | Ministry | Factory | Flamethrower, Sniper, Half-track |
  | Modern | Capitol | Factory | Infantry, Rocket Trooper, Battle Tank, Rocket Artillery, nuclear missiles |
  | Digital | Smart Hub | Missile Silo | Railgunner, Combat Drone, Stealth Tank |
  | Future | Nexus | Research Center | Laser Trooper, Exo Trooper, Hover Tank, Mech Walker |
  | Galactic | Star Citadel | Missile Silo | Void Trooper, Starfighter, War Titan, Graviton Lance |

  Production buildings offer the units of your current and previous age. Houses go from hide huts
  to round huts, Roman domus, cottages, townhouses, manors, rowhouses, bungalows, apartment
  blocks, smart homes, habitat pods and floating sky habitats. Walls go from palisades to stone,
  castle and bastion walls, then concrete, then energy walls and force fields. Towers
  fire arrows, then musket balls, then machine guns, then lasers. Roads go from dirt to cobbles,
  paving, macadam and asphalt.
- **Research Center** (Peasant's advanced build menu): twelve researches, each with many levels:

  | Research | Each level |
  | --- | --- |
  | Weaponry | +6% damage for your units and towers |
  | Armor Plating | +1 armor for your units |
  | Vitality | +6% health for your units |
  | Mobility | +4% movement speed |
  | Forestry | +2 lumber per trip, 10% faster chopping |
  | Mining | +2 gold per trip |
  | Housing | +1 citizen and +1 supply in every house |
  | Agriculture | +10% food from every farm |
  | Masonry | +10% building health, 10% faster construction |
  | Commerce | +5% tax income |
  | Civics | +3 happiness |
  | Medicine | +0.4 health regeneration; plague kills 15% fewer |

  Each age you reach unlocks two more levels of every research (up to 24 in the Galactic Age),
  and each level costs a little more than the last. Several Research Centers can research
  different topics at once.
- **Nuclear war**: in the Modern Age a **Missile Silo** builds nuclear missiles. Everyone sees the
  launch warning and the target circle, and 7 seconds later the blast flattens nearly everything
  near the target, friend or foe, and terrifies nearby citizens.
- **Hire a Hero** from the town center (`H`): the Hero fights for you for 3 minutes, and your
  enemies become theirs. Their fee grows with their level. When you play a Hero, computer empires
  may offer you a contract.
- **Walls** are dragged out like roads (one piece per tile). **Gates** can be dropped onto your
  own walls; they open for you and your allies and stay shut to everyone else.
- **Lumber Yard**: Peasants drop lumber here, so they spend less time walking.
- **Hoplites and Pikemen** deal extra damage to chariots and cavalry.
- **Losing your town center**: an empire falls 20 seconds after losing its last town center
  unless it starts building another one.

### Events

Every few minutes something happens somewhere in the land:

- a **bountiful harvest** (farms yield double);
- a **plague** (an empire loses citizens; well-fed people resist it);
- a **bandit raid** on a general's base;
- a **merchant caravan** crossing the land with a fortune in gold for whoever stops it;
- a **golden age** for a happy empire.

**Creep camps grow stronger** the longer the game goes on.

### Side quests

Optional quests turn up over the game and go to the first general who completes them; the quest
log (top left) lists them, a click on one shows where it is, the minimap marks them and `F9` has
the details. Rewards are gold, lumber, experience and items.

- **Captives**: brigands keep captives caged in each quadrant. Kill the guards and bring any unit
  to the cage: four freed soldiers join you.
- **Bounty**: a price on the head of one of the lair bosses.
- **Buried treasure**: a map marks a circle; a Hero searching it sees the spot glint, and digs.
- **The merchant's wagon**: take the contract at a village and keep the wagon alive through two
  bandit ambushes on its way to the next outpost.
- **Cleanse a region**: wipe out three camps; the general who clears the most of them is paid.

### Single player: the computer generals

You play against (or alongside) up to three computer-controlled generals. For each one you
choose:

- **Path**: Hero, Empire, or Random. Random slots are resolved so the computer generals include
  both heroes and empires.
- **Hero**: a specific hero or Random (for the Hero path).
- **Side**: Rival or Ally.

The default lineup is one AI hero, one AI empire and one random rival. **Difficulty**
(Easy / Normal / Hard) affects AI bonuses, how soon rivals start raiding bases (16 / 12 / 8
minutes), Kalenden's health and the Legion's strength.

What the computer generals do on their own:

- **AI heroes** hunt creep camps suited to their level, learn skills, buy items from merchants and
  arcane vaults, hire mercenaries, retreat to heal, Town-Portal home to defend, raid rivals, and
  march on Kalenden once strong enough. They dig up treasure, free captives, take the merchant's
  contract and claim bounties on lair bosses when they are strong enough.
- **AI empires** balance peasants between gold and lumber, site Lumber Yards at the forest edge,
  lay a grid of streets and build houses along them, and build farms to feed their citizens. They
  tune taxes and rations to keep their people happy, advance through the twelve ages, and train
  the best units of each age. They also build a wall with a gate across the approach to their
  town, research upgrades and expand to new gold mines. In battle they clear creeps, hire Heroes,
  launch nuclear missiles, research at their Research Centers, attack rival bases and finally assault the citadel.
  Rich empires recruit a Hero at a Tavern, who fights beside their army, and a big army may go
  after a bounty.
- **Armies and heroes take the waygates** when that makes a long march much shorter.
- **AI heroes** you hire guard your lands and join your battles for the length of the contract.
- **Allies** come to defend your base, join you when you fight a rival nearby, and join your
  assault on Kalenden.

The **Generals board** (top right, `F11`) shows every general's hero level or army, kills and
what they are doing right now, along with Kalenden's health and the next Legion march. Messages
announce their milestones: level-ups, new ages, armies on the march, heroes slain, Heroes hired.

### Heroes

| Hero | Primary | Abilities (Q W E / ultimate R) |
| --- | --- | --- |
| Paladin | Strength | Holy Light, Divine Shield, Devotion Aura, Resurrection |
| Archmage | Intelligence | Blizzard, Summon Water Elemental, Brilliance Aura, Meteor Shower |
| Blademaster | Agility | Wind Walk, Mirror Image, Critical Strike, Bladestorm |
| Mountain King | Strength | Storm Bolt, Thunder Clap, Bash, Avatar |
| Ranger | Agility | Volley, Entangling Roots, Trueshot Aura, Starfall |

Hero stats follow Warcraft III rules: Strength gives HP and regeneration, Agility gives armor and
attack speed, Intelligence gives mana, and the primary attribute adds damage. The game also uses
WC3's attack-type/armor-type damage table and armor formula.

## Controls

| Input | Action |
| --- | --- |
| Left-click / drag | Select / box-select (Shift adds, double-click selects all of a type on screen) |
| Right-click | Smart order: move, attack, gather, follow, pick up items, set rally points, step through a Waygate. A label beside the cursor says what it will do; trees light up for selected Peasants. |
| Click and drag (road / wall tool) | Lay a line of road or wall |
| Command card hotkeys | `M` move, `S` stop, `H` hold, `A` attack-move, `P` patrol, `B` build, `O` learn skill, `Q W E R` spells |
| `F1` | Select your Hero (press twice to center) |
| `Ctrl+1–9` / `1–9` | Assign / recall control groups |
| `Tab` | Cycle the active subgroup |
| `Space` / `Backspace` | Jump to the last alert / your base |
| `Alt` | Show all health bars |
| Numpad `7 8 4 5 1 2` | Use inventory items (Shift-click an item near a shop to sell it) |
| Screen edges, arrow keys, middle-drag (grab), two-finger trackpad swipe | Scroll the camera (speed in the Menu) |
| Mouse wheel / pinch | Zoom |
| `F9` / `F10` / `F11` / `Pause` | Quests / menu / Generals board / pause |

## Code layout

```
src/
  main.ts              title screen, game setup, main loop
  input.ts             selection, smart orders, targeting, building placement, hotkeys
  audio.ts             synthesized sound effects, unit acknowledgements, ambience and music (Web Audio)
  unitSounds.ts        which sound each unit makes: weapon on armour, shots, impacts, deaths, voices,
                       building clicks, creature calls, movement loops
  globals.d.ts         the desktop bridge and the debug handles on `window`
  data/                units, buildings, heroes, items (types.ts: UnitDef, ItemDef, ...)
  game/                simulation: Game, Unit, orders/behaviour, abilities, fog of war, roads,
                       empire economy (citizens, taxes, ages, hiring, nukes), random events,
                       neutral wonders (waygates, shrines, runes, markets, cages) and side quests;
                       types.ts: Player, Order, Buff, ...; hooks.ts: what the simulation reports
  ai/                  creep camps, Kalenden's Legion, rival general AI (hero and empire)
  world/               map layout, terrain generation, A* path grid, noise
  babylon/             Babylon.js renderer: view, camera, painted terrain and water, foliage,
                       models, rigged characters (Characters.ts: GPU skinning from a vertex
                       animation texture; CharacterRecipes.ts: which unit wears what and plays
                       which clips), effects, HUD icons and portrait, spatial audio
  ui/                  HUD console, command card, minimap, 2D overlay (health bars, floating text)
  assets/kaykit/        the KayKit characters (kaykit.bin, palette atlases, licences), made by tools/kaykit/import.mjs
  generated/           models.glb, baked by tools/bake-models.mjs (not committed)
tools/
  models/              the procedural model builders (three.js geometry, build time only)
  bake-models.mjs      runs the builders in Node and writes src/generated/models.glb
  kaykit/import.mjs    fetches the KayKit packs from GitHub and writes src/assets/kaykit/kaykit.bin
  characters.html      dev gallery of the rigged characters in any animation (/tools/characters.html)
  gallery-babylon.html dev gallery of the baked models in the game's renderer (/tools/gallery-babylon.html)
  textures.html        preview of the procedurally painted ground and foliage textures (/tools/textures.html)
  gallery.html         the builders' own three.js gallery, for editing models (/tools/gallery.html)
  build-artifact.mjs   post-build step for the hosted version
  headless-sim.mjs     npm run sim: the simulation without any renderer
```

Everything in `src/` is strict TypeScript. The simulation (`data/`, `world/`, `game/`, `ai/`)
never imports an engine; renderers read its state and implement `SimHooks`. It sticks to erasable
TypeScript syntax (checked by `tsconfig.sim.json`), so Node runs it directly for the model bake and
`npm run sim`. The model builders in `tools/models/` stay JavaScript on three.js geometry: they run
only at build time, and three.js is a build tool here, not part of the game.

Testing helpers (dev server only): `?autostart=hero:paladin` or `?autostart=empire` skips the
title screen, and `&rivals=hero-ranger-ally,empire,random` sets the computer generals
(`path[-hero][-side]` each). `&reveal=1` removes the fog of war, `&aiplayer=1` lets the AI play
for you, and `&speed=4` speeds up the game. `&quality=low|medium|high`
picks the graphics preset (also in the in-game Menu): Low keeps the painted world but draws without
post-processing or shadows and with plain model colours; Medium and High add HDR tone mapping, colour
grading, bloom, painted model detail, shadows, ambient occlusion and GPU particles. `&bench=240` stages a 240-unit battle with a frame-rate readout (the readout
also toggles with Ctrl+Shift+F in any build).

## Notes

This is a fan-made homage built from the map's public descriptions and community comments, and
general knowledge of Warcraft III. Those sources describe:

- empires that "build houses, an economy, soldiers and even advance through history", "from the
  dark ages to the highest technological advances", up to "future ages";
- "build roads and make your people love you, or drive them into the ground with nuclear war";
- gold from taxes, food from farms, rations and a happiness scale from Love down to rebellion,
  with no income while the people starve or hate you;
- empires hiring heroes for protection;
- random events and creeps that get harder over time;
- empires falling 20 seconds after losing their last town hall.

The exact age names, unit rosters, numbers and balance of the original are not documented
publicly, so those details here are this project's own design. The game is not affiliated with
Blizzard Entertainment and contains no Blizzard assets.
