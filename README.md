# Heroes & Empires 3D

A browser-based 3D real-time strategy / hero game modelled on the Warcraft III custom map
**Heroes & Empires** (by Lord_Squad and FinalLegacy):

> A group of Generals want to inhabit the land of Kalenden. Your mission is to kill Kalenden
> himself and claim his lands as your own. Your choice to work together or against each other.

Like the original, every general picks one of two paths:

- **Hero**: gain experience, buy items and survive. You control a single Hero from an Altar of
  Heroes. You level up to 10 on creep camps, learn four abilities, carry six items, hire
  mercenaries, and are revived at your Altar when you fall.
- **Empire**: build a sprawling base. You start with a Town Hall and five Peasants. Mine gold, cut
  lumber, build Farms, Barracks, a Blacksmith, an Arcane Sanctum, a Workshop and towers, then
  upgrade to a Keep and a Castle and raise an army.

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

The 160×160 map is four-fold symmetric, in a Lordaeron Summer style:

- **Corners**: one start location per general (up to 4), each with a gold mine, a lumber grove
  and a nearby Goblin Merchant.
- **Center**: Kalenden's walled citadel on a blighted plateau, ringed by a moat that can only be
  crossed at four diagonal fords. It holds his Keep, four Dark Spires, the Death Guard, skeletal
  warriors, and Kalenden himself.
- **Edge outposts**: an expansion gold mine, a Mercenary Camp, an Arcane Vault and a Fountain of
  Health, guarded by drakes and a rock golem.
- **Creep camps**: 28 camps of kobolds, gnolls, wolves, trolls, spiders, ogres, golems and drakes.
  They leash back home, drop treasure and respawn.

Every few minutes **Kalenden's Legion** marches on one of the generals. Destroy Kalenden's Keep to
stop the marches. You win by slaying Kalenden, or in free-for-all by being the last general
standing.

### Game setup

- **Rival generals**: 1–3 computer opponents, each randomly on the Hero or Empire path.
- **Diplomacy**: free-for-all, or all generals allied against Kalenden.
- **Difficulty**: Easy / Normal / Hard (affects AI bonuses, Kalenden's health and the Legion's
  strength).

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
| Right-click | Smart order: move, attack, gather, follow, pick up items, set rally points |
| Command card hotkeys | `M` move, `S` stop, `H` hold, `A` attack-move, `P` patrol, `B` build, `O` learn skill, `Q W E R` spells |
| `F1` | Select your Hero (press twice to center) |
| `Ctrl+1–9` / `1–9` | Assign / recall control groups |
| `Tab` | Cycle the active subgroup |
| `Space` / `Backspace` | Jump to the last alert / your base |
| `Alt` | Show all health bars |
| Numpad `7 8 4 5 1 2` | Use inventory items (Shift-click an item near a shop to sell it) |
| Arrow keys, screen edges, middle-drag, wheel | Scroll and zoom the camera |
| `F9` / `F10` / `Pause` | Quests / menu / pause |

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
title screen. `&reveal=1` removes the fog of war, `&aiplayer=1` lets the AI play for you, and
`&speed=4` speeds up the game.

## Notes

This is a fan-made homage built from the map's public description and general knowledge of
Warcraft III. It is not affiliated with Blizzard Entertainment, and it contains no Blizzard
assets.
