// Gun muzzle positions per model, used to start shots at the barrel. Engine-free data.

export type Vec3 = [number, number, number];

/**
 * Muzzle offsets in model space ([x, y, z], model facing +Z) for units whose shots should leave
 * the barrel rather than the unit's chest.
 */
export const MUZZLE: Record<string, Vec3 | Vec3[]> = {
  grenadier: [-0.204, 0.568, 0.195],
  musketeer: [0, 0.646, 1.031],
  cannon: [0, 0.676, 0.789],
  rifleman: [0, 0.644, 0.988],
  machine_gunner: [-0.021, 0.543, 0.874],
  steam_tank: [0, 0.6, 1.425],
  howitzer: [0, 1.053, 0.803],
  tower_bunker: [0, 0.92, 0.9],
  laser_trooper: [-0.104, 0.707, 0.805],
  // Twin guns alternate barrels.
  hover_tank: [[0.1, 0.8, 0.75], [-0.1, 0.8, 0.75]],
  mech_walker: [[0.6, 1.65, 0.89], [-0.6, 1.65, 0.89]],
  tower_laser: [0, 1.98, 0.95],
  javelineer: [-0.3, 0.836, -0.045],
  ballista: [0, 0.978, 0.684],
  flamethrower: [-0.18, 0.519, 0.604],
  sniper: [-0.12, 0.657, 0.974],
  half_track: [0, 1.17, 0.456],
  railgunner: [-0.116, 0.761, 1.071],
  combat_drone: [0, 0.86, 0.56],
  stealth_tank: [0, 0.74, 1.88],
  void_trooper: [-0.113, 0.767, 0.868],
  starfighter: [[0.21, 1.25, 1.01], [-0.21, 1.25, 1.01]],
  titan: [[0.98, 2.45, 1.27], [-0.98, 2.45, 1.27]],
  graviton: [0, 1.852, 1.471],
  infantry: [-0.105, 0.7, 0.7],
  bazooka: [-0.16, 0.81, 0.57],
  tank: [0, 0.82, 1.82],
  rocket_artillery: [0, 1.29, -0.33],
};
