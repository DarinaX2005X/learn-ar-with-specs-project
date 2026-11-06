import { PublicMechanisms } from "../Scripts/TableKit/NativeMuseumFoley";

function fingerprint(values: ArrayLike<number>, integer = false): number {
  const bytes = new DataView(new ArrayBuffer(4));
  let hash = 2166136261;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return -1;
    if (integer) bytes.setUint32(0, values[i], true);
    else bytes.setFloat32(0, values[i], true);
    for (let j = 0; j < 4; j++)
      hash = Math.imul(hash ^ bytes.getUint8(j), 16777619) >>> 0;
  }
  return hash;
}

/** Frozen GLB and the same mesh read natively in Lens Studio 5.23.2.
 * Cache/native signatures are paired with exact ordered source-triangle proof in the fixture.
 * Index fingerprints normalize numeric indices to uint32; no stream is guessed or converted. */
const STAMP_LAYOUTS = [
  { name: "raw-glb", vertices: 576, position: 1755565443, normal: 1590565765,
    uv: 797969904, indices: 1534247237, handleVertices: 216, fixedVertices: 360 },
  { name: "lens-studio-5.23.2", vertices: 380, position: 2125077833, normal: 3530669029,
    uv: 3369513616, indices: 2103677321, handleVertices: 134, fixedVertices: 246 },
] as const;

/** Exact identified buffers only. Unreadable or different imported art stays intact. */
export function stampPartition(mesh: RenderMesh): {
  layout: "raw-glb" | "lens-studio-5.23.2";
  position: Float32Array; normal: Float32Array; uv: Float32Array;
  fixed: number[]; handle: number[];
} | undefined {
  const position = mesh.getVertexDataForAttribute("position");
  const normal = mesh.getVertexDataForAttribute("normal");
  const uv = mesh.getVertexDataForAttribute("texture0");
  const indices = mesh.getIndexBuffer();
  if (mesh.topology !== MeshTopology.Triangles || indices.length !== 576) return;
  const layout = STAMP_LAYOUTS.find(item => position.length === item.vertices * 3 &&
    normal.length === item.vertices * 3 && uv.length === item.vertices * 2);
  if (!layout || fingerprint(position) !== layout.position ||
    fingerprint(normal) !== layout.normal || fingerprint(uv) !== layout.uv ||
    fingerprint(indices, true) !== layout.indices) return;
  const vertexCount = position.length / 3;
  const fixed: number[] = [], handle: number[] = [];
  const inside = (i: number): boolean => position[i * 3] >= -3.56501 &&
    position[i * 3] <= -3.43499 && position[i * 3 + 1] >= 1.01499 &&
    position[i * 3 + 1] <= 1.16001 && position[i * 3 + 2] >= 4.11499 &&
    position[i * 3 + 2] <= 4.24501;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (![a,b,c].every(index => Number.isInteger(index) && index >= 0 && index < vertexCount)) return;
    const count = Number(inside(a)) + Number(inside(b)) + Number(inside(c));
    if (count !== 0 && count !== 3) return;
    (count === 3 ? handle : fixed).push(a,b,c);
  }
  if (handle.length !== 216 || fixed.length !== 360) return;
  const moving = new Set(handle), stationary = new Set(fixed);
  if (moving.size !== layout.handleVertices || stationary.size !== layout.fixedVertices ||
    fixed.some(index => moving.has(index))) return;
  return { layout: layout.name, position, normal, uv, fixed, handle };
}

/** One real rear teal-pad handle; no input target, sound origin or verdict is moved. */
export class CheckStampMotion {
  private visual: RenderMeshVisual | undefined;
  private original: RenderMesh | undefined;
  private fixed: RenderMesh | undefined;
  private handle: SceneObject | undefined;
  private elapsed = -1;
  private fromY = 0;
  private identity = "";
  private disposed = false;
  private refusal = "not mounted";
  constructor() {
    this.mount();
  }
  status(): { ready: boolean; reason: string } {
    return { ready: !!this.handle, reason: this.refusal };
  }
  private mount(): void {
    let child: SceneObject | undefined;
    let source: RenderMeshVisual | undefined;
    let original: RenderMesh | undefined;
    try {
      const matches: SceneObject[] = [];
      const visit = (node: SceneObject, inBuilding = false): void => {
        const building = inBuilding || node.name === "MuseumBuilding";
        if (building && node.name === "WorkshopFurniture__wood")
          matches.push(node);
        for (let i = 0; i < node.getChildrenCount(); i++)
          visit(node.getChild(i), building);
      };
      for (let i = 0; i < global.scene.getRootObjectsCount(); i++)
        visit(global.scene.getRootObject(i));
      if (matches.length !== 1) {
        this.refusal = "unique museum wood instance unavailable";
        return;
      }
      const node = matches[0],
        scale = node.getTransform().getWorldScale();
      if (
        [scale.x, scale.y, scale.z].some((v) => Math.abs(v - 100) > 0.001) ||
        node.getComponents("Physics.ColliderComponent").length
      ) {
        this.refusal = "unexpected physical scale/components";
        return;
      }
      const visuals = node.getComponents("Component.RenderMeshVisual");
      if (
        visuals.length !== 1 ||
        visuals[0].getMaterialsCount() !== 1 ||
        visuals[0].getBlendShapeNames().length
      ) {
        this.refusal = "unexpected visual/material/deformation layout";
        return;
      }
      source = visuals[0];
      original = source.mesh;
      const data = stampPartition(original);
      if (!data) {
        this.refusal = "unrecognized imported mesh buffers";
        return;
      }
      const build = (indices: number[]): RenderMesh => {
        const builder = new MeshBuilder([
          { name: "position", components: 3 },
          { name: "normal", components: 3 },
          { name: "texture0", components: 2 },
        ]);
        builder.topology = MeshTopology.Triangles;
        builder.indexType = MeshIndexType.UInt16;
        const compact: number[] = [],
          remapped: number[] = [],
          remap = new Map<number, number>();
        for (const index of indices) {
          let mapped = remap.get(index);
          if (mapped === undefined) {
            mapped = compact.length / 8;
            remap.set(index, mapped);
            // Preserve the identified native attributes exactly, including imported V.
            compact.push(data.position[index * 3], data.position[index * 3 + 1],
              data.position[index * 3 + 2], data.normal[index * 3],
              data.normal[index * 3 + 1], data.normal[index * 3 + 2],
              data.uv[index * 2], data.uv[index * 2 + 1]);
          }
          remapped.push(mapped);
        }
        builder.appendVerticesInterleaved(compact);
        builder.appendIndices(remapped);
        builder.updateMesh();
        return builder.getMesh();
      };
      // Both complete meshes exist before touching the original visual.
      const fixed = build(data.fixed),
        moving = build(data.handle);
      child = global.scene.createSceneObject("CheckStampHandleMotion");
      child.enabled = false;
      child.setParent(node);
      child.layer = node.layer;
      child.getTransform().setLocalPosition(new vec3(0, 0, 0));
      child.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, 0));
      child.getTransform().setLocalScale(new vec3(1, 1, 1));
      // SDK component copy preserves shader/material/render/shadow state, rather than rebuilding a lookalike.
      const copy = child.copyComponent(source);
      copy.mesh = moving;
      const a = source.shadowColor,
        b = copy.shadowColor;
      if (
        copy.getMaterial(0) !== source.getMaterial(0) ||
        copy.getMaterialsCount() !== source.getMaterialsCount() ||
        copy.getRenderOrder() !== source.getRenderOrder() ||
        copy.meshShadowMode !== source.meshShadowMode ||
        copy.shadowDensity !== source.shadowDensity ||
        a.x !== b.x ||
        a.y !== b.y ||
        a.z !== b.z ||
        a.w !== b.w ||
        copy.emitter !== source.emitter ||
        copy.receiver !== source.receiver ||
        copy.enabled !== source.enabled
      )
        throw new Error("visual copy differs");
      source.mesh = fixed;
      child.enabled = true;
      this.visual = source;
      this.original = original;
      this.fixed = fixed;
      this.handle = child;
      this.refusal = "";
    } catch (_) {
      // A native mesh-read/copy refusal must leave the complete original art and game usable.
      if (source && original && !isNull(source) && source.mesh !== original)
        source.mesh = original;
      if (child && !isNull(child)) child.destroy();
      this.refusal = "native mesh access/copy unavailable";
    }
  }
  observe(identity: string): void {
    if (identity !== this.identity) {
      this.cancel();
      this.identity = identity;
    }
  }
  accepted(
    action: string,
    type: string,
    accepted: boolean,
    before: PublicMechanisms,
    after: PublicMechanisms,
  ): void {
    this.observe(after.identity);
    if (
      ["seek", "setTick", "replay", "cancelGesture", "cancelTest"].includes(
        type,
      )
    ) {
      this.cancel();
      return;
    }
    if (
      this.disposed ||
      !this.handle ||
      !accepted ||
      before.identity !== after.identity
    )
      return;
    if (
      action !== "detective" ||
      !["check", "checkAll", "finish"].includes(type) ||
      !(
        (!before.completed && after.completed) ||
        (!before.checking && after.checking)
      )
    )
      return;
    this.fromY = this.handle.getTransform().getLocalPosition().y;
    this.elapsed = 0;
  }
  update(seconds: number): void {
    if (this.disposed || !this.handle || this.elapsed < 0) return;
    if (
      isNull(this.handle) ||
      !this.handle.isEnabledInHierarchy ||
      !this.visual ||
      isNull(this.visual) ||
      this.visual.mesh !== this.fixed
    ) {
      this.cancel();
      return;
    }
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.elapsed += seconds;
    const t = this.elapsed;
    let y = 0;
    if (t < 0.06) {
      const p = 1 - Math.pow(1 - t / 0.06, 2);
      y = this.fromY + (-0.022 - this.fromY) * p;
    } else if (t < 0.1) y = -0.022;
    else if (t < 0.3) {
      const p = (t - 0.1) / 0.2;
      y = -0.022 * (1 - p) * (1 - p);
    } else this.elapsed = -1;
    this.handle.getTransform().setLocalPosition(new vec3(0, y, 0));
  }
  cancel(): void {
    this.elapsed = -1;
    if (this.handle && !isNull(this.handle) && !this.handle.isBeingDestroyed)
      this.handle.getTransform().setLocalPosition(new vec3(0, 0, 0));
  }
  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    if (
      this.visual &&
      this.original &&
      !isNull(this.visual) &&
      !this.visual.isBeingDestroyed &&
      this.visual.mesh === this.fixed
    )
      this.visual.mesh = this.original;
    if (this.handle && !isNull(this.handle)) this.handle.destroy();
    this.handle = undefined;
    this.visual = undefined;
    this.original = undefined;
    this.fixed = undefined;
    this.disposed = true;
  }
}
