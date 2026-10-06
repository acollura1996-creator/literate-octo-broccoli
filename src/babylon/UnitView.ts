// Visual representation of a unit on Babylon: the baked model, the procedural animation driver,
// the selection ring, construction scaffold, death, carried resources, buff visuals and fog-of-war
// visibility. A port of the original three.js unit view with the same behaviour.
//
// The animation driver keeps three.js semantics: every animated node has an Euler rotation in XYZ
// order (three.js's default) that the driver sets per axis, converted to a quaternion when applied.
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/instancedMesh';
import type { GhostMode, ModelInstance, ModelLibrary, ModelParts } from './ModelLibrary';
import type { CharacterInstance, CharacterLibrary } from './Characters';
import type { FogOfWarPlugin } from './FogOfWar';
import { TeamColorPlugin } from './TeamColor';
import type { Unit } from '../game/unit.ts';
import type { Game } from '../game/game.ts';
import type { GroundItem } from '../game/types.ts';

// ---------------------------------------------------------------------------------- shared data
// Pole weapons thrust instead of swinging (same table as the original three.js unit view).
const THRUST: Record<string, number> = { spearman: 0.55, royal_knight: 0.05, hoplite: 1.1 };
const AURA_COLORS: Record<string, number> = { devotion_aura: 0xffe08a, brilliance_aura: 0x9f8cff, trueshot_aura: 0xb8f08a };
const RING_COLORS = { own: 0x33ff33, ally: 0xffee33, enemy: 0xff3333, neutral: 0xffee33 } as const;

/** Quaternion for a three.js-style Euler rotation (order XYZ). */
export function quatFromEulerXYZ(x: number, y: number, z: number, out = new Quaternion()): Quaternion {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
  return out;
}

/** three.js-style Euler angles (order XYZ) of a quaternion. */
export function eulerXYZFromQuat(q: Quaternion | null): [number, number, number] {
  if (!q) return [0, 0, 0];
  const { x, y, z, w } = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ry, 0];
}

/** An animated node: three.js-style position, Euler XYZ rotation and scale, applied on demand. */
class Pose {
  readonly rest: { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number };
  rx: number;
  ry: number;
  rz: number;
  constructor(readonly node: TransformNode) {
    const [rx, ry, rz] = eulerXYZFromQuat(node.rotationQuaternion);
    this.rx = rx;
    this.ry = ry;
    this.rz = rz;
    this.rest = { x: node.position.x, y: node.position.y, z: node.position.z, rx, ry, rz, s: node.scaling.x };
  }
  apply(): void {
    this.node.rotationQuaternion = quatFromEulerXYZ(this.rx, this.ry, this.rz, this.node.rotationQuaternion ?? new Quaternion());
  }
}

/** Flat ring in the XZ plane (three.js RingGeometry laid flat), Babylon winding. */
function ringMesh(name: string, inner: number, outer: number, segments: number, scene: Scene): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    positions.push(c * inner, 0, s * inner, c * outer, 0, s * outer);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, b, c, b, d, c); // Babylon's front-face winding, seen from above
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(m);
  return m;
}

function hexColor3(hex: number): Color3 {
  return new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

function hexColor4(hex: number, a = 1): Color4 {
  return new Color4(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a);
}

/**
 * Meshes and materials shared by every unit view: the selection ring, the carried gold and
 * lumber, and the buff visuals. Units use instances of them.
 */
export class UnitAssets {
  readonly ring: Mesh;
  readonly gold: Mesh;
  readonly lumber: Mesh;
  readonly buff: Record<string, Mesh> = {};
  readonly shieldMaterial: StandardMaterial;
  /**
   * Camera culling for whole units (M9), set by the view each frame: true when a sphere at (x, y, z)
   * of radius r may be on screen. Units off screen are disabled outright, so none of their parts
   * is evaluated, animated or drawn.
   */
  inView: (x: number, y: number, z: number, r: number) => boolean = () => true;

  constructor(
    readonly scene: Scene,
    readonly models: ModelLibrary,
    /** Rigged characters (M14): units with a recipe are drawn by them instead of a baked model. */
    readonly characters: CharacterLibrary | null = null,
  ) {
    const unlit = (name: string, color: number, alpha: number, additive: boolean): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = hexColor3(color);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.alpha = alpha;
      m.disableDepthWrite = true;
      if (additive) m.alphaMode = Constants.ALPHA_ADD;
      const fog = m.pluginManager?.getPlugin('FogOfWar') as FogOfWarPlugin | null;
      if (fog) fog.fogEnabled = false; // like three.js's MeshBasicMaterial rings and effects
      return m;
    };
    const hidden = (m: Mesh, material: StandardMaterial): Mesh => {
      m.material = material;
      m.isVisible = false;
      m.isPickable = false;
      return m;
    };

    // Selection / hover ring, coloured per instance (relation colour and opacity). Unlit materials
    // show only their emissive colour, so the instance colour goes in through the team-colour
    // plugin's emissive term (k = 1, no offset).
    const ringMat = unlit('ring', 0x000000, 1, false);
    ringMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    ringMat.zOffset = -4;
    new TeamColorPlugin(ringMat, null, [1, 0, 0, 0]);
    this.ring = hidden(ringMesh('sel-ring', 0.84, 1, 40, scene), ringMat);
    this.ring.registerInstancedBuffer('color', 4);
    this.ring.instancedBuffers.color = new Color4(1, 1, 1, 0.9);
    this.ring.hasVertexAlpha = true;

    const lit = (name: string, color: number, emissive?: number, ei = 1): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = hexColor3(color);
      m.specularColor = Color3.Black();
      if (emissive !== undefined) {
        m.emissiveColor = hexColor3(emissive).scale(ei);
        m.useEmissiveAsIllumination = true;
      }
      return m;
    };
    this.gold = hidden(CreatePolyhedron('carry-gold', { type: 2, size: 0.17 / 1.2, flat: true }, scene), lit('carry-gold', 0xffcc33, 0x664400, 0.5));
    const lumber = CreateCylinder('carry-lumber', { height: 0.6, diameter: 0.14, tessellation: 6 }, scene);
    lumber.convertToFlatShadedMesh();
    this.lumber = hidden(lumber, lit('carry-lumber', 0x8b5a2b));

    // Buff visuals.
    const stun = unlit('buff-stun', 0xffee55, 0.9, true);
    this.buff.stun = hidden(CreatePolyhedron('buff-stun', { type: 1, size: 0.09 / 1.41, flat: true }, scene), stun);
    this.shieldMaterial = unlit('buff-shield', 0xffe680, 0.28, true);
    this.buff.shield = hidden(CreateSphere('buff-shield', { diameter: 2, segments: 8 }, scene), this.shieldMaterial);
    this.buff.slow = hidden(ringMesh('buff-slow', 0.75, 1, 24, scene), unlit('buff-slow', 0xa070ff, 0.55, true));
    const root = CreateCylinder('buff-root', { height: 0.8, diameterTop: 0, diameterBottom: 0.14, tessellation: 4 }, scene);
    root.convertToFlatShadedMesh();
    this.buff.roots = hidden(root, lit('buff-roots', 0x3f7a2a));
    this.buff.bladestorm = hidden(CreateTorus('buff-bladestorm', { diameter: 2, thickness: 0.16, tessellation: 24 }, scene), unlit('buff-bladestorm', 0xfff0c0, 0.6, true));
    for (const [id, color] of Object.entries(AURA_COLORS)) {
      this.buff[`aura:${id}`] = hidden(ringMesh(`aura-${id}`, 0.9, 1, 32, scene), unlit(`aura-${id}`, color, 0.35, true));
    }
  }
}

// ------------------------------------------------------------------------------------ unit view
/** Guns aim (weapon x rotation) and kick back when they fire (filled in like the three.js AIM). */
export const AIM: Record<string, number> = {};

export class UnitView {
  /** Read by the overlay, input, minimap and effects (same fields as the three.js view). */
  visibleNow = false;
  hovered = false;
  flashUntil = 0;
  height = 1.2;

  private readonly group: TransformNode;
  private model!: ModelInstance;
  private parts: ModelParts = {};
  private poses = new Map<TransformNode, Pose>();
  private rootPose!: Pose;
  private ring: InstancedMesh | null = null;
  private ringRelation = '';
  private scaffold: ModelInstance | null = null;
  private carryKind: string | null = null;
  private carryMesh: InstancedMesh | null = null;
  private readonly buffs = new Map<string, TransformNode>();
  private ghostMode: GhostMode | null = null;
  private doorOpen = 0;
  private rootScale = 1;
  /** The rigged character, when the unit has one (M14). */
  private character: CharacterInstance | null = null;
  /** Animation bookkeeping for characters. */
  private anim = { attackStart: -1, attackIndex: 0, lastFight: -99, idleUntil: 0, deathClip: '', spawned: false };
  /** Game time the view was made (units made after the start are new: raised, trained, summoned). */
  private readonly bornAt: number;

  constructor(
    readonly unit: Unit,
    readonly game: Game,
    private readonly assets: UnitAssets,
  ) {
    this.group = new TransformNode(`unit-${unit.id}`, assets.scene);
    this.bornAt = game.time;
    this.buildModel();
  }

  private pose(n: TransformNode | undefined): Pose | null {
    if (!n) return null;
    let p = this.poses.get(n);
    if (!p) this.poses.set(n, (p = new Pose(n)));
    return p;
  }

  buildModel(ghost: GhostMode | null = this.unit.isIllusion ? 'illusion' : null): void {
    const u = this.unit;
    this.model?.dispose();
    this.poses.clear();
    const chars = this.assets.characters;
    this.character = !u.isBuilding && chars?.has(u.modelId) ? chars.instantiate(u.modelId, u.def.modelColor ?? u.owner.color, `model-${u.id}`, ghost) : null;
    if (this.character && this.anim.deathClip) this.character.animator.play(this.anim.deathClip, { loop: false, fade: 0, at: 99 });
    this.model = this.character ?? this.assets.models.instantiate(u.modelId, u.def.modelColor ?? u.owner.color, `model-${u.id}`, ghost);
    this.model.root.parent = this.group;
    this.height = this.model.height ?? 1.2;
    this.parts = this.model.parts;
    this.rootPose = new Pose(this.model.root);
    this.rootScale = this.unit.mods.scale || 1;
    this.ghostMode = ghost;
    if (!this.ring) {
      const r = u.isBuilding ? u.def.footprint! * 0.62 : u.radius * 1.35 + 0.1;
      this.ring = this.assets.ring.createInstance(`ring-${u.id}`);
      this.ring.parent = this.group;
      this.ring.scaling.setAll(r);
      this.ring.position.y = 0.08;
      this.ring.isPickable = false;
      this.ring.setEnabled(false);
    }
    if (u.isBuilding) {
      this.scaffold?.dispose();
      this.scaffold = null;
    }
    this.carryKind = null;
    this.carryMesh = null;
  }

  /** Illusions and invisible units render see-through (and tinted for illusions). */
  private setGhost(mode: GhostMode | null): void {
    if (this.ghostMode === mode) return;
    this.buildModel(mode);
  }

  private relation(): keyof typeof RING_COLORS {
    const g = this.game;
    const u = this.unit;
    if (u.owner === g.human) return 'own';
    if (g.isEnemy(g.human, u.owner)) return 'enemy';
    if (u.owner.general) return 'ally';
    return 'neutral';
  }

  /** Should the human player see this unit right now? */
  private computeVisible(): boolean {
    const g = this.game;
    const u = this.unit;
    if (u.removed || u.hidden) return false;
    if (g.isAlliedToHuman(u.owner)) return true;
    if (u.isBuilding) {
      if (g.fog.isVisible(u.x, u.z)) u.seenByHuman = true;
      // Buildings stay remembered (darkened by fog) once seen.
      return !!u.seenByHuman && (!u.dead || g.fog.isVisible(u.x, u.z) || g.time - u.deathTime < 3);
    }
    if (u.invisible) return false;
    return g.fog.isVisible(u.x, u.z);
  }

  sync(dt: number, time: number): void {
    const u = this.unit;
    const g = this.game;
    const vis = this.computeVisible();
    this.visibleNow = vis;
    // Off-screen units skip everything (with a margin for their shadows).
    const h = this.height || 1.2;
    const shown = vis && this.assets.inView(u.x, g.terrain.heightAt(u.x, u.z) + h / 2, u.z, (this.model?.radius ?? 1) + h * 1.6 + 1.5);
    this.group.setEnabled(shown);
    if (!shown) return;

    this.group.position.set(u.x, g.terrain.heightAt(u.x, u.z), u.z);
    const root = this.rootPose;
    const rootNode = this.model.root;

    const wantGhost: GhostMode | null = u.isIllusion ? 'illusion' : u.invisible ? 'invisible' : null;
    if (wantGhost !== this.ghostMode) this.setGhost(wantGhost);

    // Scale (Avatar) and facing.
    const s = u.mods.scale || 1;
    this.rootScale += (s - this.rootScale) * Math.min(1, dt * 4);
    rootNode.scaling.setAll(this.rootScale);
    root.ry = u.isBuilding ? 0 : u.facing;

    if (u.isBuilding) this.syncConstruction(u);

    if (u.dead) {
      const t = time - u.deathTime;
      if (this.character) {
        this.animateCharacterDeath(u, dt, t);
        root.apply();
        this.ring!.setEnabled(false);
        this.syncBuffVisuals(u, dt, time, true);
        return;
      }
      if (u.isBuilding) {
        rootNode.position.y = -Math.min(1, t / 2.2) * this.height * 0.8;
        root.rz = Math.min(1, t / 2.2) * 0.12;
      } else {
        // A fall with a small bounce as the body lands; four-legged creatures roll onto a side.
        const k = Math.min(1, t / 0.5);
        const fall = k < 0.8 ? (k / 0.8) ** 2 : 1 - Math.sin(((k - 0.8) / 0.2) * Math.PI) * 0.08;
        if ((this.parts.legs?.length ?? 0) >= 4 || this.parts.wings) root.rz = (u.id % 2 ? 1 : -1) * fall * 1.5;
        else root.rx = -fall * 1.45;
        for (const leg of this.parts.legs ?? []) {
          const p = this.pose(leg.obj)!;
          p.rx = (leg.phase ? 0.5 : -0.4) * fall;
          p.apply();
        }
        rootNode.position.y = t > 1.8 ? -(t - 1.8) * 0.35 : 0;
      }
      root.apply();
      this.ring!.setEnabled(false);
      this.syncBuffVisuals(u, dt, time, true);
      return;
    }
    root.rx = 0;
    if (!u.isBuilding) root.rz = 0;
    rootNode.position.y = 0;
    if (this.character) this.animateCharacter(u, dt, time);
    else this.animate(u, dt, time, this.parts);
    root.apply();
    this.syncBuffVisuals(u, dt, time, false);
    this.syncCarry(u);

    // Selection / hover ring.
    const ring = this.ring!;
    if (u.selected || this.hovered) {
      const rel = u.selected ? this.relation() : 'hover';
      if (rel !== this.ringRelation) {
        this.ringRelation = rel;
        ring.instancedBuffers.color = rel === 'hover' ? new Color4(1, 1, 1, 0.35) : hexColor4(RING_COLORS[rel], 0.9);
      }
      ring.setEnabled(true);
    } else ring.setEnabled(false);
  }

  private syncConstruction(u: Unit): void {
    const rootNode = this.model.root;
    if (u.underConstruction) {
      const k = Math.max(0.05, u.buildProgress);
      rootNode.scaling.y = this.rootScale * (0.08 + 0.92 * k);
      if (!this.scaffold) {
        const sc = this.assets.models.instantiate('construction', u.owner.color, `scaffold-${u.id}`);
        const fp = u.def.footprint!;
        sc.root.scaling.set(fp, fp * 0.8, fp);
        sc.root.parent = this.group;
        this.scaffold = sc;
      }
    } else if (this.scaffold) {
      this.scaffold.dispose();
      this.scaffold = null;
    }
  }

  /**
   * Rigged characters (M14): pick the clip for the simulation's animation state. Attacks are timed
   * so the blow lands when the simulation deals the damage (the end of the wind-up); walks are sped
   * up or slowed to the unit's speed so the feet don't slide; idles vary.
   */
  private animateCharacter(u: Unit, dt: number, time: number): void {
    const c = this.character!;
    const r = c.recipe;
    const a = c.animator;
    const st = this.anim;
    const scale = this.assets.characters!.scaleOf(u.modelId) * this.rootScale;
    st.deathClip = ''; // alive (again, for a revived hero)
    a.update(dt);
    // Raised and summoned undead climb out of the ground once.
    if (!st.spawned) {
      st.spawned = true;
      if (r.spawn && this.bornAt > 1 && time - this.bornAt < 0.5) {
        a.play(r.spawn, { loop: false, fade: 0 });
        st.idleUntil = time + (c.animator.clipInfo(r.spawn)?.duration ?? 1);
      }
    }
    if (time < st.idleUntil && a.current === r.spawn && !u.moving) {
      c.syncFrames();
      return;
    }
    if (u.hasBuff('bladestorm') && r.spin) {
      a.play(r.spin, { loop: true, rate: 1.4 });
      c.syncFrames();
      return;
    }
    const attackStart = u.anim === 'attack' ? time - u.animTime : -1;
    if (r.rapid && (u.anim === 'attack' || time - (u.lastShotAt ?? -9) < 0.6)) {
      // Rapid fire: the firing clip loops for as long as the shooting lasts.
      st.lastFight = time;
      a.play(r.attack[0]!, { loop: true, rate: 1, fade: 0.1 });
    } else if (u.anim === 'attack' && Math.abs(attackStart - st.attackStart) > 0.05) {
      // A new swing or shot: the clip's impact lands at the end of the simulation's wind-up.
      st.attackStart = attackStart;
      st.lastFight = time;
      const name = r.attack[st.attackIndex++ % r.attack.length]!;
      const info = a.clipInfo(name);
      const windup = Math.max(0.08, Math.min(0.45, u.attackCooldown * 0.32));
      const rate = info ? Math.max(0.7, Math.min(2.6, info.impact / windup)) : 1;
      a.play(name, { loop: false, rate, restart: true, fade: 0.08, at: u.animTime * rate > 0 ? u.animTime : 0 });
    } else if (u.anim === 'cast' && a.current !== r.cast) {
      st.lastFight = time;
      a.play(r.cast, { loop: false, rate: 1.25, restart: true, fade: 0.1 });
    } else if (u.anim === 'walk' || u.moving) {
      const speed = u.speed;
      const run = r.run && speed > (r.runAbove ?? 3.6) ? r.run : r.walk;
      const info = a.clipInfo(run);
      // Feet planted: the clip's ground speed (model units) × the scale → world speed.
      const rate = info ? Math.max(0.55, Math.min(2.2, speed / Math.max(0.2, info.groundSpeed * scale))) : 1;
      a.play(run, { loop: true, rate });
    } else if (u.anim === 'work' && r.work) {
      a.play(r.work, { loop: true, rate: 1 });
    } else {
      // Finish a swing or cast before settling; then idle, a fighting stance right after a fight.
      const busy = (a.current !== r.walk && a.current !== r.run && r.attack.includes(a.current)) || a.current === r.cast;
      if (!busy || a.finished) {
        const fighting = time - st.lastFight < 3 && r.combatIdle;
        let idle = fighting ? r.combatIdle! : r.idle[0]!;
        // Now and then an idle variation (each unit on its own beat).
        if (!fighting && r.idle.length > 1) {
          const beat = Math.floor((time + u.id * 1.7) / 7);
          if ((beat * 31 + u.id) % 4 === 0) idle = r.idle[1 + ((beat + u.id) % (r.idle.length - 1))]!;
        }
        a.play(idle, { loop: true, rate: 1, fade: 0.25 });
      }
    }
    c.syncFrames();
  }

  /** A character's death: one of its death clips, held, then sinking into the ground. */
  private animateCharacterDeath(u: Unit, dt: number, t: number): void {
    const c = this.character!;
    const st = this.anim;
    if (!st.deathClip) {
      const list = c.recipe.death;
      st.deathClip = list[u.id % list.length]!;
      c.animator.play(st.deathClip, { loop: false, fade: 0.1, restart: true });
    }
    c.animator.update(dt);
    c.syncFrames();
    const length = c.animator.clipInfo(st.deathClip)?.duration ?? 1;
    const sink = length + 1.2;
    this.model.root.position.y = t > sink ? -(t - sink) * 0.35 : 0;
  }

  private animate(u: Unit, dt: number, time: number, P: ModelParts): void {
    const anim = u.anim;
    const t = u.animTime;
    if (anim === 'walk') u.walkCycle += dt * (u.speed * 2.6 + 2);
    const walking = anim === 'walk';
    const lerpTo = (p: Pose, axis: 'rx' | 'ry' | 'rz', v: number, k = 10): void => {
      p[axis] += (v - p[axis]) * Math.min(1, dt * k);
    };
    const touched: Pose[] = [];
    for (const leg of P.legs ?? []) {
      const p = this.pose(leg.obj)!;
      const target = walking ? Math.sin(u.walkCycle + (leg.phase ?? 0)) * (leg.amp ?? 0.6) : 0;
      if (walking) p.rx = target;
      else lerpTo(p, 'rx', 0);
      touched.push(p);
    }
    for (const arm of P.arms ?? []) {
      const p = this.pose(arm.obj)!;
      let target = walking ? Math.sin(u.walkCycle + (arm.phase ?? 0) + Math.PI) * 0.45 : 0;
      if (anim === 'cast') target = 1.3;
      lerpTo(p, 'rx', target, 12);
      touched.push(p);
    }
    const body = this.pose(P.body);
    const head = this.pose(P.head);
    // Creatures without a weapon bite: the head rears back, then snaps forward as the body lunges.
    let lunge = 0;
    if (!P.weapon && anim === 'attack' && head) {
      const wind = Math.max(0.12, Math.min(0.45, u.attackCooldown * 0.32));
      let bite: number;
      if (t < wind) bite = -(t / wind) * 0.45;
      else if (t < wind + 0.12) bite = -0.45 + ((t - wind) / 0.12) * 0.9;
      else bite = 0.45 * Math.max(0, 1 - (t - wind - 0.12) / 0.3);
      head.rx = head.rest.rx + bite;
      lunge = t < wind ? -(t / wind) * 0.05 : Math.max(0, 0.14 * (1 - Math.abs(t - wind - 0.08) / 0.25));
      touched.push(head);
    } else if (head && P.head !== P.body) {
      // Idle creatures and soldiers look about now and then.
      const look = anim === 'stand' ? Math.sin(time * 0.6 + u.id * 1.3) * Math.max(0, Math.sin(time * 0.23 + u.id)) * 0.35 : 0;
      lerpTo(head, 'ry', head.rest.ry + look, 3);
      if (!P.weapon) lerpTo(head, 'rx', head.rest.rx, 8);
      touched.push(head);
    }
    if (body) {
      const bob = walking ? Math.abs(Math.sin(u.walkCycle)) * 0.04 : Math.sin(time * 2 + u.id) * 0.01;
      body.node.position.y = body.rest.y + bob;
      body.node.position.z = body.rest.z + lunge;
      // Lean into the walk, and sway with each step.
      lerpTo(body, 'rx', body.rest.rx + (walking && !u.def.vehicle ? 0.07 : 0), 6);
      body.rz = body.rest.rz + (walking && !u.def.vehicle ? Math.sin(u.walkCycle) * 0.035 : 0);
      touched.push(body);
    }
    const weapon = this.pose(P.weapon);
    if (weapon) {
      let w = walking ? Math.sin(u.walkCycle) * 0.3 : 0;
      const ranged = !!u.projectile;
      const thrust = THRUST[u.modelId];
      const rz = weapon.rest.z;
      const pos = weapon.node.position;
      const gun = u.def.firearm || (u.isBuilding && u.projectile && u.projectile.kind !== 'arrow' && u.projectile.kind !== 'bolt');
      if (gun) {
        const aim = AIM[u.modelId] ?? 0;
        const since = this.game.time - (u.lastShotAt ?? -9);
        const kick = since < 0.22 ? 1 - since / 0.22 : 0;
        const heavy = u.def.vehicle || u.isBuilding || u.def.attackGround;
        if (anim === 'attack' || kick > 0) weapon.rx = aim - kick * (heavy ? 0.06 : 0.14);
        else lerpTo(weapon, 'rx', walking && !u.def.vehicle ? w * 0.4 : 0, 8);
        pos.z = rz - kick * (heavy ? 0.12 : 0.06);
      } else if (thrust !== undefined && anim === 'attack') {
        const wind = Math.min(0.45, u.attackCooldown * 0.32);
        let reach: number;
        if (t < wind) {
          w = (t / wind) * thrust;
          reach = -(t / wind) * 0.12;
        } else if (t < wind + 0.1) {
          w = thrust;
          reach = -0.12 + ((t - wind) / 0.1) * 0.4;
        } else {
          const k = Math.max(0, 1 - (t - wind - 0.1) / 0.35);
          w = thrust * k;
          reach = 0.28 * k;
        }
        weapon.rx = w;
        pos.z = rz + reach;
      } else if (anim === 'attack') {
        const wind = Math.min(0.45, u.attackCooldown * 0.32);
        const siege = u.def.attackGround;
        const amp = siege ? 0.9 : ranged ? 0.55 : 2.1;
        const strike = siege ? -1.5 : ranged ? -0.25 : -0.95;
        if (t < wind) w = (t / wind) * amp;
        else if (t < wind + 0.1) w = amp + ((t - wind) / 0.1) * (strike - amp);
        else w = strike * Math.max(0, 1 - (t - wind - 0.1) / 0.3);
        weapon.rx = w;
      } else if (anim === 'cast') {
        lerpTo(weapon, 'rx', 2.5, 12);
      } else if (anim === 'work') {
        const c = (time * 1.6 + u.id * 0.37) % 1;
        weapon.rx = c < 0.6 ? (c / 0.6) * 2.0 : 2.0 - ((c - 0.6) / 0.4) * 2.8;
      } else lerpTo(weapon, 'rx', w, 10);
      if (thrust !== undefined && anim !== 'attack') pos.z += (rz - pos.z) * Math.min(1, dt * 10);
      touched.push(weapon);
    }
    for (const sp of P.spin ?? []) {
      const p = this.pose(sp)!;
      p.ry += dt * 1.6;
      touched.push(p);
    }
    // Gates swing open for their owner's team.
    if (P.doors?.length) {
      const g = this.game;
      const friend = g.unitsNear(u.x, u.z, 2.6).some((o) => !o.isBuilding && !o.dead && o.owner.team !== undefined && o.owner.team === u.owner.team);
      this.doorOpen += ((friend ? 1 : 0) - this.doorOpen) * Math.min(1, dt * 5);
      for (const d of P.doors) {
        const p = this.pose(d.obj)!;
        p.ry = (d.side ?? 1) * this.doorOpen * 1.4;
        touched.push(p);
      }
    }
    for (const b of P.bob ?? []) {
      const p = this.pose(b)!;
      b.position.y = p.rest.y + Math.sin(time * 2.2 + u.id) * 0.12;
    }
    for (const w of P.wings ?? []) {
      const p = this.pose(w.obj)!;
      p.rz = (w.side ?? 1) * Math.sin(time * 8 + u.id) * 0.6;
      touched.push(p);
    }
    if (u.moving) {
      for (const wh of P.wheels ?? []) {
        const p = this.pose(wh)!;
        p.rx += dt * u.speed * 2.2;
        touched.push(p);
      }
    }
    for (const f of P.fire ?? []) {
      const base = this.pose(f)!.rest.s;
      const k = base * (0.85 + Math.random() * 0.3);
      f.scaling.set(k, base * (0.8 + Math.random() * 0.45), k);
    }
    for (const gl of P.glow ?? []) {
      const base = this.pose(gl)!.rest.s;
      gl.scaling.setAll(base * (1 + Math.sin(time * 3 + u.id) * 0.08));
    }
    for (const p of touched) p.apply();
    // Bladestorm spin.
    if (u.hasBuff('bladestorm')) this.rootPose.ry = time * 22;
  }

  private syncCarry(u: Unit): void {
    if (!u.def.worker) return;
    const kind = u.carry?.kind ?? null;
    if (kind === this.carryKind) return;
    this.carryKind = kind;
    this.carryMesh?.dispose();
    this.carryMesh = null;
    if (!kind) return;
    const m = (kind === 'gold' ? this.assets.gold : this.assets.lumber).createInstance(`carry-${u.id}`);
    m.isPickable = false;
    if (kind === 'lumber') m.rotationQuaternion = quatFromEulerXYZ(0, 0, Math.PI / 2);
    m.position.set(0, this.height * 0.8, -0.2);
    m.parent = this.model.root;
    this.carryMesh = m;
  }

  private syncBuffVisuals(u: Unit, dt: number, time: number, dead: boolean): void {
    const want = new Set<string>();
    if (!dead) {
      for (const b of u.buffs.values()) if (b.visual) want.add(b.visual);
      if (u.isHero && u.heroDef) {
        for (const id of u.heroDef.abilities) if (AURA_COLORS[id] && u.abilityLevel(id) > 0) want.add(`aura:${id}`);
      }
    }
    for (const [k, obj] of this.buffs) {
      if (!want.has(k)) {
        obj.dispose();
        this.buffs.delete(k);
      }
    }
    for (const k of want) {
      let obj = this.buffs.get(k);
      if (!obj) {
        const made = this.makeBuffVisual(k);
        if (!made) continue;
        obj = made;
        obj.parent = this.group;
        this.buffs.set(k, obj);
      }
      this.updateBuffVisual(k, obj, dt, time);
    }
  }

  private makeBuffVisual(k: string): TransformNode | null {
    const h = this.height;
    const r = this.unit.radius;
    const a = this.assets;
    const sc = a.scene;
    const inst = (src: Mesh, name: string): InstancedMesh => {
      const m = src.createInstance(name);
      m.isPickable = false;
      return m;
    };
    if (k === 'stun') {
      const g = new TransformNode('stun', sc);
      for (let i = 0; i < 3; i++) {
        const s = inst(a.buff.stun!, 'stun-star');
        const ang = (i / 3) * Math.PI * 2;
        s.position.set(Math.cos(ang) * 0.35, 0, Math.sin(ang) * 0.35);
        s.parent = g;
      }
      g.position.y = h + 0.25;
      return g;
    }
    if (k === 'shield') {
      const m = inst(a.buff.shield!, 'shield');
      m.scaling.setAll(Math.max(0.9, h * 0.7));
      m.position.y = h * 0.5;
      return m;
    }
    if (k === 'slow') {
      const m = inst(a.buff.slow!, 'slow');
      m.scaling.setAll(r * 1.6 + 0.2);
      m.position.y = 0.12;
      return m;
    }
    if (k === 'roots') {
      const g = new TransformNode('roots', sc);
      for (let i = 0; i < 6; i++) {
        const v = inst(a.buff.roots!, 'root');
        const ang = (i / 6) * Math.PI * 2;
        v.position.set(Math.cos(ang) * (r + 0.1), 0.3, Math.sin(ang) * (r + 0.1));
        v.rotationQuaternion = quatFromEulerXYZ(Math.sin(ang) * 0.4, 0, Math.cos(ang) * -0.4);
        v.parent = g;
      }
      return g;
    }
    if (k === 'bladestorm') {
      const m = inst(a.buff.bladestorm!, 'bladestorm');
      m.scaling.setAll(2.2);
      m.position.y = 0.6;
      return m;
    }
    if (k.startsWith('aura:') && a.buff[k]) {
      const m = inst(a.buff[k]!, 'aura');
      m.scaling.setAll(1.3);
      m.position.y = 0.1;
      return m;
    }
    return null;
  }

  private updateBuffVisual(k: string, obj: TransformNode, dt: number, time: number): void {
    if (k === 'stun') obj.rotation.y += dt * 5;
    else if (k === 'shield') this.assets.shieldMaterial.alpha = 0.22 + Math.sin(time * 4) * 0.06;
    else if (k === 'bladestorm') obj.rotation.y += dt * 20;
    else if (k.startsWith('aura:')) {
      obj.rotation.y += dt * 0.8;
      obj.scaling.setAll(1.2 + Math.sin(time * 2) * 0.08);
    }
  }

  dispose(): void {
    this.scaffold?.dispose();
    this.group.dispose(false, false);
  }
}

// ------------------------------------------------------------------------------------ ground items
/** Ground item (dropped by creeps): a chest with a coloured lid over a glowing ring. */
export class ItemView {
  private readonly group: TransformNode;
  private readonly spin: TransformNode;
  private readonly glow: StandardMaterial;

  constructor(
    readonly item: GroundItem,
    readonly game: Game,
    scene: Scene,
    color: number,
  ) {
    const lit = (c: number): StandardMaterial => {
      const m = new StandardMaterial('item', scene);
      m.diffuseColor = hexColor3(c);
      m.specularColor = Color3.Black();
      return m;
    };
    this.group = new TransformNode('item', scene);
    this.spin = new TransformNode('item-spin', scene);
    this.spin.parent = this.group;
    const box = CreateBox('item-box', { width: 0.42, height: 0.3, depth: 0.32 }, scene);
    box.material = lit(0x7a4a22);
    box.position.y = 0.18;
    box.parent = this.spin;
    const lid = CreateBox('item-lid', { width: 0.44, height: 0.08, depth: 0.34 }, scene);
    lid.material = lit(color);
    lid.position.y = 0.36;
    lid.parent = this.spin;
    const ring = ringMesh('item-glow', 0.35, 0.55, 24, scene);
    this.glow = new StandardMaterial('item-glow', scene);
    this.glow.disableLighting = true;
    this.glow.emissiveColor = hexColor3(0xffe680);
    this.glow.alpha = 0.6;
    this.glow.alphaMode = Constants.ALPHA_ADD;
    this.glow.disableDepthWrite = true;
    ring.material = this.glow;
    ring.position.y = 0.06;
    ring.parent = this.group;
    for (const m of [box, lid, ring]) m.isPickable = false;
    this.group.position.set(item.x, game.terrain.heightAt(item.x, item.z), item.z);
  }

  sync(dt: number, time: number): void {
    this.group.setEnabled(this.game.fog.isVisible(this.item.x, this.item.z));
    this.spin.rotation.y += dt;
    this.spin.position.y = 0.1 + Math.sin(time * 3) * 0.06;
    this.glow.alpha = 0.45 + Math.sin(time * 4) * 0.2;
  }

  dispose(): void {
    this.group.dispose(false, true);
  }
}
