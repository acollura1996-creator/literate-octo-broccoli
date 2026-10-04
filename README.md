# Heroes & Empires 3D

A browser-based 3D real-time strategy / hero game modelled on the Warcraft III custom map
**Heroes & Empires** (by Lord_Squad and FinalLegacy):

> A group of Generals want to inhabit the land of Kalenden. Your mission is to kill Kalenden
> himself and claim his lands as your own. Your choice to work together or against each other.

Like the original, every general picks one of two paths:

- **Hero**: gain experience, buy items and survive. You control a single Hero from an Altar of
  Heroes. You level up to 10 on creep camps, learn four abilities, carry six items, hire
  mercenaries, and are revived at your Altar when you fall.
- **Empire**: build houses, an economy and soldiers, and advance through history: from cavemen
  with clubs in the Stone Age, through bronze, iron, gunpowder and steam, to tanks, nuclear missiles
  and laser-armed mechs in the Future Age. Your citizens pay the taxes and eat the food from your
  farms, and they riot if you treat them badly.

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

### Empire: citizens, taxes and the eight ages

The original map's empires are run like a little nation, and so are they here:

- **Citizens** live in **Houses**, and Houses must touch a road that leads back to your town
  center (Houses off the network are marked above them). Each House shelters more people in later
  ages (4 in the Stone Age up to 14 in the Future Age) and also raises your army supply.
- **Gold comes mostly from taxes.** Every citizen pays your tax rate in gold. The gold mine still
  helps early on.
- **Farms grow food**, and every citizen eats their **ration** of it. Bigger rations make people
  happier and help them shrug off plague, but cost more food.
- **Mood** runs from 😍 Love through Happy, Normal and Unhappy to 😡 Hate. Low taxes, generous
  rations and plenty of **roads** ("build roads and make your people love you") make people
  happier; heavy taxes, hunger, plague and very crowded cities make them angry.
  - Loving and happy people pay up to 25% more and move in faster.
  - Nobody pays taxes while they **starve** or **hate** you.
  - Unhappy citizens **riot**: armed rebels spill out of their houses and march on your town
    center.
- Set taxes (`Z` / `X`) and rations (`C` / `V`) at the town center. The top bar shows your food
  stock and its rate, citizens / housing and the people's mood.
- **Ages**: research the next age at the town center. Everything from the town center to houses,
  farms, walls, gates, towers and roads is rebuilt in the new age's style:

  | Age | Town center | Requires | New units |
  | --- | --- | --- | --- |
  | Stone | Tribal Camp | — | Clubman, Rock Thrower |
  | Bronze | Chiefdom Hall | Barracks | Hoplite, Bowman, War Chariot |
  | Dark | Town Hall | Farm, Stable | Footman, Pikeman, Archer, Light Cavalry, Knight, Catapult, Priest |
  | Medieval | Castle | Blacksmith, Workshop | Crossbowman, Champion, Royal Knight, Trebuchet, Sorceress, Battle Mage |
  | Gunpowder | Palace | Arcane Sanctum | Musketeer, Grenadier, Dragoon, Cannon |
  | Industrial | City Hall | Workshop | Rifleman, Machine Gunner, Landship, Howitzer |
  | Modern | Capitol | Factory | Infantry, Rocket Trooper, Battle Tank, Rocket Artillery, nuclear missiles |
  | Future | Nexus | Missile Silo | Laser Trooper, Exo Trooper, Hover Tank, Mech Walker |

  Production buildings offer the units of your current and previous age. Houses go from hide huts
  to round huts, cottages, townhouses, manors, rowhouses, apartment blocks and habitat pods. Walls
  go from palisades to stone, castle and bastion walls, then concrete, then energy walls. Towers
  fire arrows, then musket balls, then machine guns, then lasers. Roads go from dirt to cobbles,
  paving, macadam and asphalt.
- **Nuclear war**: in the Modern Age a **Missile Silo** builds nuclear missiles. Everyone sees the
  launch warning and the target circle, and 7 seconds later the blast flattens nearly everything
  near the target, friend or foe, and terrifies nearby citizens.
- **Hire a Hero** from the town center (`H`): the Hero fights for you for 3 minutes, and your
  enemies become theirs. Their fee grows with their level. When you play a Hero, computer empires
  may offer you a contract.
- **Walls** are dragged out like roads (one piece per tile). **Gates** can be dropped onto your
  own walls; they open for you and your allies and stay shut to everyone else.
- **Lumber Yard**: Peasants drop lumber here, and it researches better lumber harvesting.
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
- **AI empires** balance peasants between gold and lumber, site Lumber Yards at the forest edge,
  lay a grid of streets and build houses along them, and build farms to feed their citizens. They
  tune taxes and rations to keep their people happy, advance through the eight ages, and train
  the best units of each age. They also build a wall with a gate across the approach to their
  town, research upgrades and expand to new gold mines. In battle they clear creeps, hire Heroes,
  launch nuclear missiles, attack rival bases and finally assault the citadel.
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
  game/                simulation: Game, Unit, orders/behaviour, abilities, fog of war, roads,
                       empire economy (citizens, taxes, ages, hiring, nukes) and random events
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
