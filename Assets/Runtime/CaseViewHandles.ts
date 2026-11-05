import { CaseViewSnapshot } from "../Spatial/CaseViewRouting";
import { Placement } from "../Spatial/SpatialStage";
export interface CaseViewHandleSlot {
  id: string;
  placement: Placement;
  kind: "frame" | "tab" | "pull" | "latch";
}
function offset(base: Placement, x: number, y: number, z: number): Placement {
  const c = Math.cos(base.yawRad),
    s = Math.sin(base.yawRad);
  return {
    originCm: [
      base.originCm[0] + x * c + z * s,
      base.originCm[1] + y,
      base.originCm[2] + z * c - x * s,
    ],
    scale: 1,
    yawRad: base.yawRad,
  };
}
/** Shared physical slots. The stationary origin is the actual conservation bench.
 * Dynamic origins are already world-anchored by the explicit view action. */
export function caseViewHandleSlots(
  view: CaseViewSnapshot | undefined,
  bench: Placement,
): CaseViewHandleSlot[] {
  if (!view?.available) return [];
  if (view.mode === "museum")
    return [
      {
        id: "CaseViewHandle",
        placement: offset(bench, 0, 7, -29),
        kind: "frame",
      },
    ];
  if (view.mode === "choice")
    return [
      {
        id: "CaseViewSeated",
        placement: offset(bench, -13, 7, -15),
        kind: "tab",
      },
      {
        id: "CaseViewStanding",
        placement: offset(bench, 13, 7, -15),
        kind: "pull",
      },
      { id: "CaseViewClose", placement: offset(bench, 0, 7, 3), kind: "latch" },
    ];
  const base = view.presentation?.handlePlacement;
  if (!base) return [];
  const result: CaseViewHandleSlot[] = [
    { id: "CaseViewBack", placement: offset(base, -14, 0, 0), kind: "pull" },
    { id: "CaseViewClose", placement: offset(base, 14, 0, 0), kind: "latch" },
  ];
  if (view.mode === "table")
    result.push({
      id: "CaseViewStanding",
      placement: offset(base, 0, -14, 0),
      kind: "pull",
    });
  return result;
}
/** A sighting frame and its attached brass pulls, not an invisible hit-box panel.
 * Materials and lighting come from the museum. No labels, actors or camera are owned. */
export class CaseViewHandles {
  private readonly root: SceneObject;
  private readonly frame: SceneObject;
  private readonly bridge: SceneObject;
  private readonly lowerStem: SceneObject;
  private readonly pieces = new Map<string, SceneObject>();
  private readonly supports = new Map<string, SceneObject>();
  private readonly brass: Material;
  private readonly wood: Material;
  private disposed = false;
  constructor(parent: SceneObject, material: Material) {
    this.root = global.scene.createSceneObject("CaseViewSightFrame");
    this.root.setParent(parent);
    this.brass = material.clone();
    this.brass.mainPass.baseColor = new vec4(0.58, 0.39, 0.16, 1);
    this.wood = material.clone();
    this.wood.mainPass.baseColor = new vec4(0.12, 0.22, 0.19, 1);
    this.frame = this.group("SightingRim");
    for (const x of [-10.5, 10.5])
      this.box(this.frame, "Stile", [x, 0, 0], [1.2, 12, 1.7], this.brass);
    for (const y of [-5.5, 5.5])
      this.box(this.frame, "Rail", [0, y, 0], [20, 1.1, 1.7], this.brass);
    this.box(this.frame, "LowerGrip", [0, -6.7, 0], [13, 1.4, 2.2], this.wood);
    this.bridge = this.group("ReturnFrameBridge");
    this.lowerStem = this.group("StandingPullStem");
    this.box(
      this.bridge,
      "ConnectedRail",
      [0, -5.5, 0],
      [39, 1.1, 1.7],
      this.brass,
    );
    this.box(
      this.lowerStem,
      "LowerPullStem",
      [0, -14, 0],
      [1.5, 17, 1.7],
      this.brass,
    );
    this.root.enabled = false;
  }
  render(view: CaseViewSnapshot | undefined, bench: Placement): void {
    if (this.disposed) return;
    this.root.enabled = !!view?.available;
    for (const piece of this.pieces.values()) piece.enabled = false;
    if (!view?.available) return;
    const dynamic = view.mode === "table" || view.mode === "room";
    const framePlacement =
      dynamic && view.presentation
        ? offset(view.presentation.handlePlacement, 0, 7, 0)
        : offset(bench, 0, 7, -29);
    this.place(this.frame, framePlacement);
    this.bridge.enabled = dynamic;
    if (dynamic) this.place(this.bridge, framePlacement);
    this.lowerStem.enabled = view.mode === "table";
    if (view.mode === "table") this.place(this.lowerStem, framePlacement);
    for (const slot of caseViewHandleSlots(view, bench)) {
      if (slot.kind === "frame") continue;
      let piece = this.pieces.get(slot.id);
      if (!piece) {
        piece = this.makeGrip(slot.id, slot.kind);
        this.pieces.set(slot.id, piece);
      }
      this.place(piece, slot.placement);
      piece.enabled = true;
      const support = this.supports.get(slot.id);
      if (support) support.enabled = !dynamic;
    }
  }
  private group(name: string): SceneObject {
    const node = global.scene.createSceneObject(name);
    node.setParent(this.root);
    return node;
  }
  private makeGrip(id: string, kind: "tab" | "pull" | "latch"): SceneObject {
    const node = this.group("Grip_" + id);
    if (kind !== "tab") {
      const support = global.scene.createSceneObject("BenchMount");
      support.setParent(node);
      this.box(
        support,
        "FixedFoot",
        [0, -4.75, 0],
        [kind === "pull" ? 12 : 5, 4.5, 3],
        this.wood,
      );
      this.supports.set(id, support);
    }
    if (kind === "tab") {
      this.box(node, "Foot", [0, -4, 0], [8, 7, 1.2], this.brass);
      this.box(node, "SeatedTab", [0, 0, 0], [12, 1.6, 5], this.wood);
    } else if (kind === "pull") {
      for (const x of [-5, 5])
        this.box(node, "ReturnPost", [x, 0, 0], [1.4, 5, 2], this.brass);
      this.box(node, "Pull", [0, 2, 0], [11, 1.6, 2.2], this.wood);
    } else {
      this.box(node, "Hinge", [0, -2, 0], [5, 1.5, 3], this.brass);
      this.box(node, "Latch", [0, 0, 0], [3.3, 6, 1.5], this.wood);
      this.box(node, "Lip", [0, 2.5, -0.8], [5.2, 1.3, 2.5], this.brass);
    }
    return node;
  }
  private place(node: SceneObject, placement: Placement): void {
    const transform = node.getTransform();
    transform.setWorldPosition(new vec3(...placement.originCm));
    transform.setWorldRotation(quat.fromEulerAngles(0, placement.yawRad, 0));
    transform.setWorldScale(new vec3(1, 1, 1));
  }
  private box(
    parent: SceneObject,
    name: string,
    centre: readonly [number, number, number],
    size: readonly [number, number, number],
    material: Material,
  ): void {
    const node = global.scene.createSceneObject(name);
    node.setParent(parent);
    node.getTransform().setLocalPosition(new vec3(...centre));
    const mesh = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mesh.topology = MeshTopology.Triangles;
    mesh.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [],
      indices: number[] = [];
    const faces = [
      [
        [1, 0, 0],
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
      [
        [-1, 0, 0],
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, -1],
      ],
      [
        [0, 1, 0],
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
      ],
      [
        [0, -1, 0],
        [-1, -1, 1],
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
      ],
      [
        [0, 0, 1],
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      [
        [0, 0, -1],
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    ];
    for (const face of faces) {
      const start = vertices.length / 8,
        normal = face[0];
      for (const point of face.slice(1))
        vertices.push(
          (point[0] * size[0]) / 2,
          (point[1] * size[1]) / 2,
          (point[2] * size[2]) / 2,
          ...normal,
          0,
          0,
        );
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    mesh.appendVerticesInterleaved(vertices);
    mesh.appendIndices(indices);
    mesh.updateMesh();
    const visual = node.createComponent("Component.RenderMeshVisual");
    visual.mesh = mesh.getMesh();
    visual.mainMaterial = material;
  }
  clear(): void {
    this.root.enabled = false;
    for (const piece of this.pieces.values()) piece.enabled = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.destroy();
    this.pieces.clear();
    this.supports.clear();
  }
}
