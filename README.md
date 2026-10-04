# Heroes & Empires 3D

A browser-based 3D real-time strategy / hero game modelled on the Warcraft III custom map
**Heroes & Empires** (by Lord_Squad and FinalLegacy):

> A group of Generals want to inhabit the land of Kalenden. Your mission is to kill Kalenden
> himself and claim his lands as your own. Your choice to work together or against each other.

Like the original, every general picks one of two paths:

- **Hero**: gain experience, buy items and survive. You control a single Hero from an Altar of
  Heroes. You level up to 10 on creep camps, learn four abilities, carry six items, hire
  mercenaries, and are revived at your Altar when you fall.
- **Empire**: build a sprawling base. You start with a Town Hall, a ring of road and five Peasants.
  Mine gold, cut lumber (a Lumber Yard by the woods shortens the trips), lay roads, build houses
  along them, and advance through four ages, each unlocking new troops.

Everything is built with [three.js](https://threejs.org). Models are procedural low-poly meshes and
sounds and music are synthesized with Web Audio, so the game ships no asset files.

## Running

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # single self-contained dist/index.html (open it directly in a browser)
npm run build:artifact # also writes dist/artifact.html (page body used for the hosted version)
```

The game needs a desktop browser with WebGL2, a mouse and a keyboard.

## The land of Kalenden

The 256×256 map is four-fold symmetric, in a Lordaeron Summer style:

- **Corners**: one start location per general (up to 4), each with open ground for a town, a gold
  mine, forests around it and a nearby Goblin Merchant.
- **Center**: Kalenden's walled citadel on a blighted plateau, ringed by a moat that can only be
  crossed at four diagonal fords. It holds his Keep, four Dark Spires, the Death Guard, skeletal
  warriors, and Kalenden himself.
- **Edge outposts**: an expansion gold mine, a Mercenary Camp, an Arcane Vault and a Fountain of
  Health, guarded by drakes and a rock golem.
- **Creep camps**: 40 camps of kobolds, gnolls, wolves, trolls, spiders, ogres, golems and drakes.
  They leash back home, drop treasure and respawn.

Every few minutes **Kalenden's Legion** marches on one of the generals. Destroy Kalenden's Keep to
stop the marches. You win by slaying Kalenden, or in free-for-all by being the last general
standing.

### Empire: roads, houses and the ages

- **Roads** are laid by dragging a line (2 gold per tile). Units move 30% faster on roads, and
  pathfinding prefers them.
- **Houses** must be built touching one of your roads, and only add population while that road
  network connects to your Town Hall. Houses not on the network are marked above them. A house holds
  4 / 6 / 8 / 10 population by age, and the Town Hall adds 10 (up to 150).
- **Ages** advance from the Town Hall:

  | Age | Town center | Requires | Unlocks |
  | --- | --- | --- | --- |
  | Tribal | Town Hall | — | Militia, Hunter, Barracks, Lumber Yard, Houses (Huts), Palisades |
  | Feudal | Keep | Barracks, Lumber Yard | Footman, Spearman, Archer, Scout Rider, Stable, Blacksmith, Guard Tower, stone walls |
  | Kingdom | Castle | Blacksmith, Stable | Crossbowman, Knight, Priest, Sorceress, Catapult, Arcane Sanctum, Workshop, fortified walls |
  | Imperial | Imperial Palace | Arcane Sanctum, Workshop | Champion, Royal Knight, Battle Mage, Trebuchet |

  When you advance, your houses (Hut → Cottage → Townhouse → Manor), walls and gates rebuild in
  the new style with more health, and your roads are repaved.
- **Walls** are dragged out like roads (one piece per tile). **Gates** can be dropped onto your
  own walls; they open for you and your allies and stay shut to everyone else.
- **Lumber Yard**: Peasants drop lumber here, and it researches better lumber harvesting.
- **Spearmen** deal triple damage to cavalry (Scout Riders, Knights, Royal Knights).

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
  march on Kalenden once strong enough.
- **AI empires** keep peasants on gold and lumber, site Lumber Yards at the forest edge, lay a grid
  of streets and build houses along them, advance through the four ages, train the units of each
  age, build a wall with a gate across the approach to their town, research upgrades, expand to
  new gold mines, clear creeps, attack rival bases and finally assault the citadel.
- **Allies** come to defend your base, join you when you fight a rival nearby, and join your
  assault on Kalenden.

The **Generals board** (top right, `F11`) shows every general's hero level or army, kills and
what they are doing right now, along with Kalenden's health and the next Legion march. Messages
announce their milestones: level-ups, new Keeps, armies on the march, heroes slain.

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
| Right-click | Smart order: move, attack, gather, follow, pick up items, set rally points. A label beside the cursor says what it will do; trees light up for selected Peasants. |
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
  main.js              title screen, game setup, main loop
  input.js             selection, smart orders, targeting, building placement, hotkeys
  audio.js             synthesized sound effects and music (Web Audio)
  data/                units, buildings, heroes, items
  game/                simulation: Game, Unit, orders/behaviour, abilities, fog of war
  ai/                  creep camps, Kalenden's Legion, rival general AI (hero and empire)
  world/               map layout, terrain generation, A* path grid, noise
  render/              view and camera, procedural models, unit views, effects, projectiles, overlay
  ui/                  HUD console, command card, minimap, icons and 3D portrait
tools/
  gallery.html         dev gallery of every procedural model (npm run dev → /tools/gallery.html)
  build-artifact.mjs   post-build step for the hosted version
```

Testing helpers (dev server only): `?autostart=hero:paladin` or `?autostart=empire` skips the
title screen, and `&rivals=hero-ranger-ally,empire,random` sets the computer generals
(`path[-hero][-side]` each). `&reveal=1` removes the fog of war, `&aiplayer=1` lets the AI play
for you, and `&speed=4` speeds up the game.

## Notes

This is a fan-made homage built from the map's public description and general knowledge of
Warcraft III. It is not affiliated with Blizzard Entertainment, and it contains no Blizzard
assets.
