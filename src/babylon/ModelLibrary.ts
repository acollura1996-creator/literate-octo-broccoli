// The baked models (src/generated/models.glb, made by tools/bake-models.mjs from the original
// procedural three.js builders in tools/models/), loaded once with Babylon's glTF loader.
//
// Each model is a template hierarchy that stays hidden. A unit gets its own copy of the transform
// nodes (so its parts can animate) with InstancedMesh for every mesh: all units of a model share
// one draw call per part, whatever their team, because the team colour is an instance attribute
// (see TeamColor.ts).
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/loaders/glTF/2.0';
import modelsUrl from '../generated/models.glb?url';
import { classifyColor, paint, paintParams, type PainterlyPlugin } from './Painterly';
import { MergedModelPlugin, STYLE_KIND, creaseNormals } from './MergedModel';
import { UNITS } from '../data/units.ts';

/** Models of buildings (painted with brick, plank, thatch and tile structure; MergedModel.ts). */
const BUILDING_MODELS = new Set<string>(['wall_segment', 'wall_tower', 'construction']);
for (const d of Object.values(UNITS)) {
  if (d.kind !== 'building') continue;
  BUILDING_MODELS.add(d.model);
  for (const m of d.ageModels ?? []) BUILDING_MODELS.add(m);
}
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TeamColorPlugin, type TeamFactor } from './TeamColor';

/** Animation handles (the parts contract of tools/models/models.js), resolved to nodes. */
export interface ModelParts {
  body?: TransformNode;
  head?: TransformNode;
  weapon?: TransformNode;
  legs?: Array<{ obj: TransformNode; phase?: number; amp?: number }>;
  arms?: Array<{ obj: TransformNode; phase?: number }>;
  wings?: Array<{ obj: TransformNode; side?: number }>;
  doors?: Array<{ obj: TransformNode; side?: number }>;
  spin?: TransformNode[];
  bob?: TransformNode[];
  wheels?: TransformNode[];
  fire?: TransformNode[];
  glow?: TransformNode[];
}

type PartsSpec = Record<string, string | string[] | Array<Record<string, unknown> & { obj: string }>>;

interface Template {
  id: string;
  root: TransformNode;
  height: number;
  radius: number;
  parts: PartsSpec;
}

export interface ModelInstance {
  id: string;
  root: TransformNode;
  parts: ModelParts;
  height: number;
  radius: number;
  meshes: AbstractMesh[];
  dispose(): void;
}

const toGamma = (c: number): number => Math.pow(Math.max(0, c), 1 / 2.2);
/** Exact sRGB encoding (three.js's), to recognise palette colours. */
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function teamColor4(hex: number): Color4 {
  return new Color4(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1);
}

/** See-through variants for illusions (tinted blue) and invisible units, as in three.js. */
export type GhostMode = 'illusion' | 'invisible';

interface MaterialInfo {
  /** Linear colours from the bake. */
  base: [number, number, number];
  emissive: [number, number, number];
  team: TeamFactor | null;
  teamEmissive: TeamFactor | null;
}

const ILLUSION_TINT = [0x6f / 255, 0x9b / 255, 0xff / 255].map((c) => Math.pow(c, 2.2)) as [number, number, number];

export class ModelLibrary {
  private readonly templates = new Map<string, Template>();
  /** Source meshes whose material follows the team colour (they carry an instanced `color`). */
  private readonly teamMeshes = new Set<Mesh>();
  private readonly materialInfo = new Map<StandardMaterial, MaterialInfo>();
  private readonly ghostMaterials = new Map<string, StandardMaterial>();
  /** The shared materials of merged parts (single- and double-sided). */
  private readonly merged = new Map<boolean, StandardMaterial>();
  /** The merged meshes made at load (hidden template parts like the rest). */
  private readonly mergedMeshes: Mesh[] = [];
  /** Template meshes before and after merging (for the M9 statistics). */
  readonly stats = { meshesBefore: 0, meshesAfter: 0 };
  /** Source meshes of glowing parts (the glow layer renders only these). */
  readonly glowSources = new Set<Mesh>();
  /** Source meshes that receive shadows (instances follow their source). */
  readonly receivers = new Set<Mesh>();
  /** Called for every new instance of a shadow-casting part (the shadow generator's list). */
  onCaster: ((mesh: AbstractMesh) => void) | null = null;

  private constructor(private readonly scene: Scene) {}

  static async load(scene: Scene): Promise<ModelLibrary> {
    const lib = new ModelLibrary(scene);
    const container = await LoadAssetContainerAsync(modelsUrl, scene, { pluginExtension: '.glb' });
    container.addAllToScene();
    lib.convertMaterials(container.materials as PBRMaterial[], container.meshes);
    for (const node of container.transformNodes.concat(container.meshes as unknown as TransformNode[])) {
      const extras = node.metadata?.gltf?.extras as { model?: string; height?: number; radius?: number; parts?: PartsSpec } | undefined;
      if (!extras?.model) continue;
      lib.templates.set(extras.model, {
        id: extras.model,
        root: node,
        height: extras.height ?? 1.2,
        radius: extras.radius ?? 0.5,
        parts: extras.parts ?? {},
      });
    }
    // Performance (M9): merge each model's static parts per animated node (`?merge=0` turns it off,
    // to compare).
    if (new URLSearchParams(location.search).get('merge') !== '0') for (const t of lib.templates.values()) lib.compact(t);
    // Shadows (M8): the bake carries three.js's castShadow / receiveShadow per mesh node.
    const all: AbstractMesh[] = [...container.meshes, ...lib.mergedMeshes];
    for (const node of all) {
      const ex = node.metadata?.gltf?.extras as { receiveShadow?: boolean } | undefined;
      const src = node instanceof InstancedMesh ? node.sourceMesh : node;
      if (ex?.receiveShadow && src instanceof Mesh) lib.receivers.add(src);
    }
    // Templates never render themselves: only their copies do. Their roots are disabled too, so
    // the scene skips their meshes each frame (instances only check their own enabled state).
    for (const m of all) {
      m.isVisible = false;
      m.isPickable = false;
      m.doNotSyncBoundingInfo = true;
    }
    for (const t of lib.templates.values()) t.root.setEnabled(false);
    for (const m of all) if (!m.parent) m.setEnabled(false);
    return lib;
  }

  /** The shared material of merged parts. */
  private mergedMaterial(doubleSided: boolean): StandardMaterial {
    let m = this.merged.get(doubleSided);
    if (!m) {
      m = new StandardMaterial(doubleSided ? 'model-merged-2s' : 'model-merged', this.scene);
      m.diffuseColor = Color3.White();
      m.specularColor = Color3.Black();
      m.backFaceCulling = !doubleSided;
      new MergedModelPlugin(m);
      this.merged.set(doubleSided, m);
    }
    return m;
  }

  /**
   * Merge a template's static parts. Animated nodes (those named in the parts contract) and the
   * root become plain transform nodes; every opaque, non-glowing mesh below each of them, down to
   * the next animated node, becomes part of one mesh in that node's space, its material turned into
   * vertex attributes (MergedModel.ts). Glowing, translucent and depth-write-off parts stay as they
   * are. The hierarchy keeps every animated node's name, so the parts contract still resolves.
   */
  private compact(t: Template): void {
    const names = new Set<string>();
    const collect = (v: unknown): void => {
      if (typeof v === 'string') names.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object' && typeof (v as { obj?: unknown }).obj === 'string') names.add((v as { obj: string }).obj);
    };
    Object.values(t.parts).forEach(collect);
    const hasGeometry = (n: TransformNode): boolean => n instanceof InstancedMesh || (n instanceof Mesh && n.getTotalVertices() > 0);

    // Animated mesh nodes become transform nodes; their own geometry moves into a child.
    const anchors = new Set<TransformNode>();
    const subtree = [t.root, ...t.root.getDescendants(false)] as TransformNode[];
    for (const n of subtree) {
      if (n !== t.root && !names.has(n.name)) continue;
      if (!hasGeometry(n)) {
        anchors.add(n);
        continue;
      }
      const tn = new TransformNode(n.name, this.scene);
      tn.parent = n.parent;
      tn.position.copyFrom(n.position);
      if (n.rotationQuaternion) tn.rotationQuaternion = n.rotationQuaternion.clone();
      else tn.rotation.copyFrom(n.rotation);
      tn.scaling.copyFrom(n.scaling);
      tn.metadata = n.metadata;
      for (const c of n.getChildren(undefined, true)) (c as TransformNode).parent = tn;
      n.parent = tn;
      n.position.setAll(0);
      n.rotationQuaternion = null;
      n.rotation.setAll(0);
      n.scaling.setAll(1);
      n.name = `${n.name}#geo`;
      anchors.add(tn);
      if (n === t.root) t.root = tn;
    }

    // Group mergeable meshes by nearest animated ancestor and sidedness.
    const groups = new Map<string, { anchor: TransformNode; doubleSided: boolean; meshes: AbstractMesh[] }>();
    const meshes = ([t.root, ...t.root.getDescendants(false)] as TransformNode[]).filter(hasGeometry) as AbstractMesh[];
    this.stats.meshesBefore += meshes.length;
    let kept = 0;
    for (const m of meshes) {
      const mat = m.material as StandardMaterial | null;
      const info = mat ? this.materialInfo.get(mat) : undefined;
      const glow = info ? Math.max(...info.emissive) > 0.002 || !!info.teamEmissive : true;
      if (!mat || !info || glow || mat.alpha < 1 || mat.disableDepthWrite || mat.transparencyMode === Material.MATERIAL_ALPHABLEND) {
        if (glow && info) {
          const src = m instanceof InstancedMesh ? m.sourceMesh : m;
          if (src instanceof Mesh) this.glowSources.add(src);
        }
        kept++;
        continue;
      }
      let a: TransformNode | null = m.parent as TransformNode | null;
      while (a && !anchors.has(a)) a = a.parent as TransformNode | null;
      if (!a) {
        kept++;
        continue;
      }
      const key = `${a.uniqueId}|${mat.backFaceCulling ? 1 : 2}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { anchor: a, doubleSided: !mat.backFaceCulling, meshes: [] }));
      g.meshes.push(m);
    }

    // World matrices top-down: hidden templates were never rendered, and the hierarchy just changed.
    const refresh = (n: TransformNode): void => {
      n.computeWorldMatrix(true);
      for (const c of n.getChildren(undefined, true)) refresh(c as TransformNode);
    };
    let top: TransformNode = t.root;
    while (top.parent) top = top.parent as TransformNode;
    refresh(top);
    const inv = new Matrix();
    const rel = new Matrix();
    const v = new Vector3();
    for (const g of groups.values()) {
      g.anchor.getWorldMatrix().invertToRef(inv);
      const pos: number[] = [];
      const idx: number[] = [];
      const albedo: number[] = [];
      const teamB: number[] = [];
      const paintW: number[] = [];
      const style: number[] = [];
      const building = BUILDING_MODELS.has(t.id) ? 1 : 0;
      let cast = false;
      let receive = false;
      for (const m of g.meshes) {
        const src = m instanceof InstancedMesh ? m.sourceMesh : (m as Mesh);
        const p = src.getVerticesData(VertexBuffer.PositionKind);
        const ind = src.getIndices();
        if (!p || !ind) continue;
        m.getWorldMatrix().multiplyToRef(inv, rel);
        const base = pos.length / 3;
        for (let i = 0; i < p.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, rel, v);
          pos.push(v.x, v.y, v.z);
        }
        // The merged mesh winds counter-clockwise (as the glTF loader sets its meshes); parts that
        // wind the other way, or are mirrored, flip their triangles.
        const ccw = (src.sideOrientation ?? Material.ClockWiseSideOrientation) === Material.CounterClockWiseSideOrientation;
        const flip = (rel.determinant() < 0) !== !ccw;
        for (let i = 0; i < ind.length; i += 3) {
          if (flip) idx.push(base + ind[i]!, base + ind[i + 2]!, base + ind[i + 1]!);
          else idx.push(base + ind[i]!, base + ind[i + 1]!, base + ind[i + 2]!);
        }
        const mat = m.material as StandardMaterial;
        const info = this.materialInfo.get(mat)!;
        const kind = (mat.pluginManager?.getPlugin('Painterly') as PainterlyPlugin | null)?.kind ?? 'plain';
        const pp = paintParams(kind);
        const a4 = info.team ? [0, 0, 0, info.team[0]] : [toGamma(info.base[0]), toGamma(info.base[1]), toGamma(info.base[2]), 0];
        const b4 = info.team ? [info.team[1], info.team[2], info.team[3], pp.scale] : [0, 0, 0, pp.scale];
        const n = p.length / 3;
        const kindId = STYLE_KIND[kind];
        for (let i = 0; i < n; i++) {
          albedo.push(a4[0]!, a4[1]!, a4[2]!, a4[3]!);
          teamB.push(b4[0]!, b4[1]!, b4[2]!, b4[3]!);
          paintW.push(pp.weights[0], pp.weights[1], pp.weights[2], pp.weights[3]);
          style.push(building, kindId, 0, 0);
        }
        const ex = (m.metadata?.gltf?.extras ?? {}) as { castShadow?: boolean; receiveShadow?: boolean };
        cast ||= !!ex.castShadow;
        receive ||= !!ex.receiveShadow;
      }
      if (!pos.length) continue;
      // Smooth shading with crisp edges (M13): the baked parts carry no normals.
      const sm = creaseNormals(pos, idx, [albedo, teamB, paintW, style]);
      const merged = new Mesh(`${g.anchor.name}#merged${g.doubleSided ? '2' : ''}`, this.scene);
      merged.sideOrientation = Material.CounterClockWiseSideOrientation;
      const vd = new VertexData();
      vd.positions = sm.pos;
      vd.indices = sm.idx;
      vd.normals = sm.normals;
      vd.applyToMesh(merged, false);
      merged.setVerticesData('mAlbedo', sm.attrs[0]!, false, 4);
      merged.setVerticesData('mTeamB', sm.attrs[1]!, false, 4);
      merged.setVerticesData('mPaint', sm.attrs[2]!, false, 4);
      merged.setVerticesData('mStyle', sm.attrs[3]!, false, 4);
      merged.parent = g.anchor;
      merged.material = this.mergedMaterial(g.doubleSided);
      merged.metadata = { gltf: { extras: { castShadow: cast, receiveShadow: receive } } };
      merged.registerInstancedBuffer('color', 4);
      merged.instancedBuffers.color = new Color4(0.58, 0.59, 0.59, 1);
      this.teamMeshes.add(merged);
      this.mergedMeshes.push(merged);
      // The originals leave the template. They stay enabled (hidden like every template mesh):
      // a mesh merged here may still be the instance source of a glowing part kept elsewhere.
      for (const m of g.meshes) m.parent = null;
    }
    // Plain nodes left without any mesh below them are dropped from the template.
    for (const n of [...t.root.getDescendants(false)] as TransformNode[]) {
      if (anchors.has(n) || hasGeometry(n)) continue;
      if (!n.getDescendants(false).some((d) => hasGeometry(d as TransformNode) || anchors.has(d as TransformNode))) n.parent = null;
    }
    this.stats.meshesAfter += groups.size + kept;
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  get ids(): string[] {
    return [...this.templates.keys()];
  }

  /**
   * glTF materials load as PBR; the renderer uses StandardMaterial (gamma space, matching the
   * three.js look until the visual upgrade in M8). Colours and team factors come from the bake.
   */
  private convertMaterials(pbrs: PBRMaterial[], meshes: AbstractMesh[]): void {
    const map = new Map<PBRMaterial, StandardMaterial>();
    for (const p of pbrs) {
      const extras = (p.metadata?.gltf?.extras ?? {}) as { team?: TeamFactor; teamEmissive?: TeamFactor; depthWrite?: boolean };
      const m = new StandardMaterial(p.name, this.scene);
      m.diffuseColor = new Color3(toGamma(p.albedoColor.r), toGamma(p.albedoColor.g), toGamma(p.albedoColor.b));
      m.specularColor = Color3.Black();
      // three.js adds emissive light on top (it is not tinted by the diffuse colour).
      m.emissiveColor = new Color3(toGamma(p.emissiveColor.r), toGamma(p.emissiveColor.g), toGamma(p.emissiveColor.b));
      m.useEmissiveAsIllumination = true;
      m.alpha = p.alpha;
      if (p.alpha < 1 || p.transparencyMode === Material.MATERIAL_ALPHABLEND) m.transparencyMode = Material.MATERIAL_ALPHABLEND;
      m.backFaceCulling = p.backFaceCulling;
      if (extras.depthWrite === false) m.disableDepthWrite = true;
      this.materialInfo.set(m, {
        base: [p.albedoColor.r, p.albedoColor.g, p.albedoColor.b],
        emissive: [p.emissiveColor.r, p.emissiveColor.g, p.emissiveColor.b],
        team: extras.team ?? null,
        teamEmissive: extras.teamEmissive ?? null,
      });
      // Hand-painted surface by colour (team-coloured parts are cloth); not on glass or glowing parts.
      const glowing = Math.max(p.emissiveColor.r, p.emissiveColor.g, p.emissiveColor.b) > 0.25;
      if (p.alpha >= 1 && !glowing) {
        const c = p.albedoColor;
        paint(m, extras.team ? 'cloth' : classifyColor(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b)));
      }
      if (extras.team || extras.teamEmissive) {
        new TeamColorPlugin(m, extras.team ?? null, extras.teamEmissive ?? null);
        if (extras.team) m.diffuseColor = Color3.White();
        if (extras.teamEmissive) m.emissiveColor = Color3.Black();
      }
      map.set(p, m);
    }
    for (const mesh of meshes) {
      const p = mesh.material as PBRMaterial | null;
      const m = p && map.get(p);
      if (!m) continue;
      mesh.material = m;
      if (m.pluginManager?.getPlugin('TeamColor') && mesh instanceof Mesh) {
        mesh.registerInstancedBuffer('color', 4);
        mesh.instancedBuffers.color = new Color4(0.58, 0.59, 0.59, 1);
        this.teamMeshes.add(mesh);
      }
    }
    for (const p of pbrs) p.dispose(true, true);
  }

  /**
   * The see-through material three.js uses for ghosts: 40% opaque without depth writes, or for
   * illusions 75% opaque and blended 45% toward blue. Per team, since the team colour is baked in.
   */
  private ghostMaterial(src: StandardMaterial, mode: GhostMode, team: number): StandardMaterial {
    const key = `${src.uniqueId}|${mode}|${team}`;
    let m = this.ghostMaterials.get(key);
    if (m) return m;
    if (src.pluginManager?.getPlugin('MergedModel')) {
      // Merged parts keep their per-vertex colours; the team colour and tint become uniforms.
      m = new StandardMaterial(`${src.name}-${mode}`, this.scene);
      m.diffuseColor = Color3.White();
      m.specularColor = Color3.Black();
      const plugin = new MergedModelPlugin(m);
      plugin.fallback = [((team >> 16) & 255) / 255, ((team >> 8) & 255) / 255, (team & 255) / 255];
      if (mode === 'illusion') plugin.tint = [ILLUSION_TINT[0], ILLUSION_TINT[1], ILLUSION_TINT[2], 0.45];
      m.backFaceCulling = src.backFaceCulling;
      m.alpha = mode === 'illusion' ? 0.75 : 0.4;
      m.transparencyMode = Material.MATERIAL_ALPHABLEND;
      m.disableDepthWrite = mode !== 'illusion';
      this.ghostMaterials.set(key, m);
      return m;
    }
    const info = this.materialInfo.get(src);
    const teamLin = [16, 8, 0].map((sh) => Math.pow(((team >> sh) & 255) / 255, 2.2));
    const apply = (f: TeamFactor): [number, number, number] => [0, 1, 2].map((i) => f[0] * teamLin[i]! + f[i + 1]!) as [number, number, number];
    let base = info?.team ? apply(info.team) : info?.base ?? [1, 1, 1];
    const emissive = info?.teamEmissive ? apply(info.teamEmissive) : info?.emissive ?? [0, 0, 0];
    if (mode === 'illusion') base = base.map((c, i) => c + (ILLUSION_TINT[i]! - c) * 0.45) as [number, number, number];
    m = new StandardMaterial(`${src.name}-${mode}`, this.scene);
    m.diffuseColor = new Color3(toGamma(base[0]), toGamma(base[1]), toGamma(base[2]));
    m.emissiveColor = new Color3(toGamma(emissive[0]), toGamma(emissive[1]), toGamma(emissive[2]));
    m.useEmissiveAsIllumination = true;
    m.specularColor = Color3.Black();
    m.backFaceCulling = src.backFaceCulling;
    m.alpha = mode === 'illusion' ? 0.75 : 0.4;
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    m.disableDepthWrite = mode !== 'illusion';
    this.ghostMaterials.set(key, m);
    return m;
  }

  /** A copy of a model drawn entirely in one material (placement previews). */
  instantiateFlat(id: string, material: StandardMaterial, name = id): ModelInstance {
    return this.instantiate(id, 0, name, null, material);
  }

  /** A new copy of a model for one unit, with the given team colour (hex). */
  instantiate(id: string, team: number, name = id, ghost: GhostMode | null = null, flat: StandardMaterial | null = null): ModelInstance {
    const t = this.templates.get(id) ?? this.templates.get('construction')!;
    const color = teamColor4(team);
    const byName = new Map<string, TransformNode>();
    const meshes: AbstractMesh[] = [];
    const copy = (src: TransformNode, parent: TransformNode | null): TransformNode => {
      let node: TransformNode;
      // The glTF loader turns a mesh shared by several nodes into instances of its first node.
      const mesh = src instanceof InstancedMesh ? src.sourceMesh : src instanceof Mesh && src.getTotalVertices() > 0 ? src : null;
      if (mesh && (ghost || flat)) {
        // Ghosts are rare (illusions, wind walk) and previews single: plain copies with their own
        // materials.
        const clone = mesh.clone(src.name, null, true);
        clone.material = flat ?? this.ghostMaterial(mesh.material as StandardMaterial, ghost!, team);
        clone.isVisible = true;
        clone.isPickable = false;
        clone.doNotSyncBoundingInfo = false;
        meshes.push(clone);
        node = clone;
      } else if (mesh) {
        const inst: InstancedMesh = mesh.createInstance(src.name);
        inst.isPickable = false;
        if (this.teamMeshes.has(mesh)) inst.instancedBuffers.color = color;
        if ((src.metadata?.gltf?.extras as { castShadow?: boolean } | undefined)?.castShadow) this.onCaster?.(inst);
        meshes.push(inst);
        node = inst;
      } else {
        node = new TransformNode(src.name, this.scene);
      }
      node.parent = parent;
      node.position.copyFrom(src.position);
      if (src.rotationQuaternion) node.rotationQuaternion = src.rotationQuaternion.clone();
      else node.rotation.copyFrom(src.rotation);
      node.scaling.copyFrom(src.scaling);
      byName.set(src.name, node);
      for (const c of src.getChildren(undefined, true)) copy(c as TransformNode, node);
      return node;
    };
    const root = copy(t.root, null);
    root.name = name;
    root.position.setAll(0);
    if (root.rotationQuaternion) root.rotationQuaternion = null;
    root.rotation.setAll(0);
    root.scaling.setAll(1);

    const parts: ModelParts = {};
    const node = (n: string): TransformNode => byName.get(n)!;
    for (const [k, v] of Object.entries(t.parts)) {
      if (typeof v === 'string') (parts as Record<string, unknown>)[k] = node(v);
      else if (Array.isArray(v)) {
        (parts as Record<string, unknown>)[k] = (v as Array<string | (Record<string, unknown> & { obj: string })>).map((e) =>
          typeof e === 'string' ? node(e) : { ...e, obj: node(e.obj) },
        );
      }
    }
    return {
      id,
      root,
      parts,
      height: t.height,
      radius: t.radius,
      meshes,
      dispose: () => root.dispose(false, false),
    };
  }
}
