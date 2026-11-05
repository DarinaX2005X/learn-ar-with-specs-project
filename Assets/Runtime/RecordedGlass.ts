import {
  Board,
  FrameClue,
  Fragment,
  projectVisibleSurface,
} from "../Domain/index";
import { roleSilhouette } from "../Scripts/TableKit/RoleSilhouette";
import { RECORDED_HEAD_ART } from "./MuseumScene/RecordedHeadArt";
export interface RecordedSurface {
  segment: string;
  via: "direct" | "mirror";
  centerCm: readonly [number, number, number];
  widthCm: number;
  heightCm: number;
}
const panes = new Map<string, RecordedGlass>();
export function getRecordingSurfaces(rootName: string): RecordedSurface[] {
  return panes.get(rootName)?.surfaces ?? [];
}
export function recordedPaneViews(): readonly {
  root: SceneObject;
  surfaces: RecordedSurface[];
}[] {
  return Array.from(panes.values()).map((pane) => pane.view());
}
export function toggleRecordingDetail(rootName: string): boolean {
  return panes.get(rootName)?.toggleDetail() ?? false;
}
export function recordingDetailEnabled(rootName: string): boolean {
  return panes.get(rootName)?.detailEnabled ?? false;
}
type RGB = readonly number[];
/** Fixed-witness public art; every material patch uses the same clipping as its observed surface. */
export class RecordedGlass {
  private objects: SceneObject[] = [];
  private roles: string[] = [];
  private bounds: RecordedSurface[] = [];
  private inks: {
    segment: string;
    via: "direct" | "mirror";
    material: Material;
    normal: RGB;
    selected: RGB;
  }[] = [];
  private board: Board | undefined;
  private frame: FrameClue | undefined;
  private zoom = false;
  private detail: string | undefined;
  private focused: string | undefined;
  private detailActive = false;
  private disposed = false;
  constructor(
    private parent: SceneObject,
    private material: Material,
    private opticalDetail = false,
  ) {
    panes.set(parent.name, this);
  }
  render(board: Board, frame: FrameClue | undefined, zoom = false) {
    if (this.disposed) return;
    this.board = board;
    this.frame = frame;
    this.zoom = zoom;
    this.draw();
  }
  private draw(): void {
    this.clearGeometry();
    const board = this.board,
      frame = this.frame;
    if (!board || !frame) return;
    const observed = frame.payload.fragments
      .map((fragment) => ({
        fragment,
        triangles: projectVisibleSurface(
          board,
          frame.witness,
          fragment,
          roleSilhouette(fragment.role),
        ),
      }))
      .filter((item) => item.triangles.length > 0);
    const selected =
      this.opticalDetail && this.detail
        ? observed.filter((item) => this.key(item.fragment) === this.detail)
        : [];
    const visible = selected.length ? selected : observed;
    const points = visible.flatMap((item) =>
      item.triangles.flatMap((triangle) =>
        triangle.map((point) => this.point(point)),
      ),
    );
    if (!points.length) return;
    const left = Math.min(...points.map((p) => p[0])),
      right = Math.max(...points.map((p) => p[0])),
      bottom = Math.min(...points.map((p) => p[1])),
      top = Math.max(...points.map((p) => p[1]));
    const gain = this.zoom
      ? Math.min(
          selected.length ? 1200 : 160,
          32 / Math.max(0.001, right - left),
          16 / Math.max(0.001, top - bottom),
        )
      : 12 / Math.tan(Math.PI / 3);
    const centerX = this.zoom ? (left + right) / 2 : 0,
      centerY = this.zoom ? (bottom + top) / 2 : 0;
    const map = (p: {
      horizontal: number;
      vertical: number;
    }): readonly [number, number] => {
      const q = this.point(p);
      return [
        (q[0] - centerX) * gain,
        this.zoom
          ? (q[1] - centerY) * gain
          : (q[1] / Math.tan(Math.PI * 0.4)) * 6,
      ];
    };
    for (const { fragment, triangles } of visible) {
      const art = fragment.role ? RECORDED_HEAD_ART[fragment.role] : undefined;
      const base: RGB = art?.base ?? [0.24, 0.29, 0.28];
      const projected = triangles.map((triangle) => triangle.map(map));
      const xs = projected.flatMap((triangle) => triangle.map((p) => p[0])),
        ys = projected.flatMap((triangle) => triangle.map((p) => p[1]));
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
      this.bounds.push({
        segment: fragment.segment,
        via: fragment.via,
        centerCm: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
        widthCm: maxX - minX,
        heightCm: maxY - minY,
      });
      // A dim outer contour carries selection; faces retain their original colours.
      const cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2;
      const contour = projected.map((triangle) =>
        triangle.map(
          (p) => [cx + (p[0] - cx) * 1.045, cy + (p[1] - cy) * 1.045] as const,
        ),
      );
      this.mesh(
        fragment,
        "Contour",
        contour,
        [0.018, 0.029, 0.025],
        0.025,
        [0.62, 0.3, 0.055],
      );
      this.mesh(fragment, "Face", projected, base, 0.045);
      if (art)
        for (let layer = 0; layer < art.patches.length; layer++) {
          const patch = art.patches[layer];
          const clipped = patch.triangles.flatMap((outline) =>
            projectVisibleSurface(board, frame.witness, fragment, outline),
          );
          this.mesh(
            fragment,
            patch.kind,
            clipped.map((triangle) => triangle.map(map)),
            patch.color,
            0.065 + layer * 0.018,
          );
        }
      if (fragment.role) this.roles.push(fragment.role);
    }
    this.paintFocus();
  }
  private key(fragment: Pick<Fragment, "segment" | "via">): string {
    return fragment.segment + "|" + fragment.via;
  }
  private point(p: {
    horizontal: number;
    vertical: number;
  }): readonly [number, number] {
    const x = Math.tan(p.horizontal);
    return [x, Math.tan(p.vertical) * Math.sqrt(1 + x * x)];
  }
  private mesh(
    fragment: Fragment,
    label: string,
    triangles: readonly (readonly (readonly [number, number])[])[],
    color: RGB,
    z: number,
    selectedColor: RGB = color,
  ): void {
    if (!triangles.length) return;
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [],
      indices: number[] = [];
    for (const triangle of triangles) {
      if (triangle.length !== 3) continue;
      const start = vertices.length / 8;
      for (const p of triangle) vertices.push(p[0], p[1], z, 0, 0, 1, 0, 0);
      const [a, b, c] = triangle;
      const cross =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross >= 0) indices.push(start, start + 1, start + 2);
      else indices.push(start, start + 2, start + 1);
    }
    builder.appendVerticesInterleaved(vertices);
    builder.appendIndices(indices);
    builder.updateMesh();
    const object = global.scene.createSceneObject(
      "RecordedFragment_" + fragment.segment + "_" + label,
    );
    object.setParent(this.parent);
    const visual = object.createComponent("Component.RenderMeshVisual");
    visual.mesh = builder.getMesh();
    const material = this.material.clone();
    material.mainPass.baseColor = new vec4(color[0], color[1], color[2], 1);
    material.mainPass.twoSided = true;
    visual.mainMaterial = material;
    this.objects.push(object);
    this.inks.push({
      segment: fragment.segment,
      via: fragment.via,
      material,
      normal: color,
      selected: selectedColor,
    });
  }
  get renderedRoles(): string[] {
    return this.roles.slice();
  }
  view(): { root: SceneObject; surfaces: RecordedSurface[] } {
    return { root: this.parent, surfaces: this.surfaces };
  }
  select(
    segment: string | undefined,
    via: "direct" | "mirror" | undefined,
  ): void {
    this.focused = segment && via ? segment + "|" + via : undefined;
    const detail = this.detailActive ? this.focused : undefined;
    if (this.opticalDetail && detail !== this.detail) {
      this.detail = detail;
      this.draw();
    }
    this.paintFocus();
  }
  private paintFocus(): void {
    for (const ink of this.inks) {
      const color =
        ink.segment + "|" + ink.via === this.focused
          ? ink.selected
          : ink.normal;
      ink.material.mainPass.baseColor = new vec4(
        color[0],
        color[1],
        color[2],
        1,
      );
    }
  }
  get detailEnabled(): boolean {
    return this.detailActive;
  }
  toggleDetail(): boolean {
    if (this.disposed) return false;
    if (!this.opticalDetail || !this.focused) return false;
    this.detailActive = !this.detailActive;
    this.detail = this.detailActive ? this.focused : undefined;
    this.draw();
    return this.detailActive;
  }
  get surfaces(): RecordedSurface[] {
    return this.bounds.map((surface) => ({
      ...surface,
      centerCm: [...surface.centerCm] as [number, number, number],
    }));
  }
  private clearGeometry(): void {
    for (const object of this.objects) object.destroy();
    this.objects = [];
    this.roles = [];
    this.bounds = [];
    this.inks = [];
  }
  clear(): void {
    this.clearGeometry();
    this.board = undefined;
    this.frame = undefined;
    this.detail = undefined;
    this.focused = undefined;
    this.detailActive = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    if (panes.get(this.parent.name) === this) panes.delete(this.parent.name);
  }
}
