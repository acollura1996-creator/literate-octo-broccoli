// The baked models (src/generated/models.glb, made by tools/bake-models.mjs from the same
// procedural builders the three.js renderer uses), loaded once with Babylon's glTF loader.
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
import { classifyColor, paint } from './Painterly';
import { TeamColorPlugin, type TeamFactor } from './TeamColor';

/** Animation handles (the parts contract of src/render/models.js), resolved to nodes. */
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
    // Shadows (M8): the bake carries three.js's castShadow / receiveShadow per mesh node.
    for (const node of container.meshes) {
      const ex = node.metadata?.gltf?.extras as { receiveShadow?: boolean } | undefined;
      const src = node instanceof InstancedMesh ? node.sourceMesh : node;
      if (ex?.receiveShadow && src instanceof Mesh) lib.receivers.add(src);
    }
    // Templates never render themselves: only their copies do.
    for (const m of container.meshes) {
      m.isVisible = false;
      m.isPickable = false;
      m.doNotSyncBoundingInfo = true;
    }
    return lib;
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
