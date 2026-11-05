import { roleSilhouette } from "../Scripts/TableKit/RoleSilhouette";
import { RECORDED_HEAD_ART } from "./MuseumScene/RecordedHeadArt";

type Point = readonly [number, number];
const ROLES = ["Courier", "Guard", "Conservator"] as const;
/** Public printed roster. No case, track, observation or verdict input is accepted. */
export class BenchCameos {
  private root: SceneObject | undefined;
  constructor(parent: SceneObject, material: Material, font?: Font) {
    const find = (name: string, node: SceneObject): SceneObject | undefined => {
      if (node.name === name) return node;
      for (let i = 0; i < node.getChildrenCount(); i++) {
        const found = find(name, node.getChild(i));
        if (found) return found;
      }
      return undefined;
    };
    let bench: SceneObject | undefined;
    for (let i = 0; i < global.scene.getRootObjectsCount() && !bench; i++)
      bench = find("Anchor_ConservationBench", global.scene.getRootObject(i));
    if (!bench) return;
    const group = global.scene.createSceneObject("BenchCameoPrints");
    group.setParent(parent);
    this.root = group;
    group
      .getTransform()
      .setWorldPosition(bench.getTransform().getWorldPosition());
    group
      .getTransform()
      .setWorldRotation(bench.getTransform().getWorldRotation());
    group.getTransform().setWorldScale(new vec3(1, 1, 1));
    ROLES.forEach((role, index) => {
      const card = global.scene.createSceneObject("CameoPrint_" + role);
      card.setParent(group);
      card.getTransform().setLocalPosition(new vec3(-24 + 24 * index, 5.98, 6));
      card
        .getTransform()
        .setLocalRotation(
          quat
            .fromEulerAngles(-Math.PI / 2, 0, 0)
            .multiply(quat.fromEulerAngles(0, 0, Math.PI)),
        );
      const outline = roleSilhouette(role),
        art = RECORDED_HEAD_ART[role],
        xs = outline.map((p) => p[0]),
        ys = outline.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cy = (Math.min(...ys) + Math.max(...ys)) / 2,
        scale = 7.4 / (Math.max(...ys) - Math.min(...ys));
      const map = (p: Point): Point => [
        (p[0] - cx) * scale - 4,
        (p[1] - cy) * scale + 6.25,
      ];
      this.ink(
        card,
        material,
        "Face",
        triangulate(outline).map((t) => t.map(map)),
        art.base,
        0,
      );
      art.patches.forEach((patch, layer) =>
        this.ink(
          card,
          material,
          patch.kind,
          patch.triangles.map((t) => t.map(map)),
          patch.color,
          0.002 * (layer + 1),
        ),
      );
      const name = global.scene.createSceneObject("PrintedRoleName_" + role);
      name.setParent(card);
      name.getTransform().setLocalPosition(new vec3(0, 1.45, 0.02));
      const text = name.createComponent("Component.Text");
      text.text = role;
      text.size = 100;
      if (font) text.font = font;
      text.horizontalAlignment = HorizontalAlignment.Left;
      text.verticalAlignment = VerticalAlignment.Center;
      text.horizontalOverflow = HorizontalOverflow.Shrink;
      text.verticalOverflow = VerticalOverflow.Shrink;
      text.layoutRect = Rect.create(-8.4, 8.4, -1.6, 1.6);
      text.textFill.color = new vec4(0.016, 0.049, 0.041, 1);
      text.depthTest = true;
    });
  }
  private ink(
    parent: SceneObject,
    source: Material,
    name: string,
    triangles: readonly (readonly Point[])[],
    rgb: readonly number[],
    z: number,
  ): void {
    if (!triangles.length) return;
    const mesh = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mesh.topology = MeshTopology.Triangles;
    mesh.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [],
      indices: number[] = [];
    for (const triangle of triangles) {
      const [a, b, c] = triangle;
      if (!a || !b || !c) continue;
      const start = vertices.length / 8;
      for (const p of triangle) vertices.push(p[0], p[1], z, 0, 0, 1, 0, 0);
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0)
        indices.push(start, start + 1, start + 2);
      else indices.push(start, start + 2, start + 1);
    }
    mesh.appendVerticesInterleaved(vertices);
    mesh.appendIndices(indices);
    mesh.updateMesh();
    const node = global.scene.createSceneObject("Printed_" + name);
    node.setParent(parent);
    const visual = node.createComponent("Component.RenderMeshVisual");
    visual.mesh = mesh.getMesh();
    const ink = source.clone();
    ink.mainPass.baseColor = new vec4(rgb[0], rgb[1], rgb[2], 1);
    ink.mainPass.depthTest = true;
    ink.mainPass.depthWrite = false;
    ink.mainPass.twoSided = false;
    visual.mainMaterial = ink;
  }
  dispose(): void {
    this.root?.destroy();
    this.root = undefined;
  }
}
/** Ear clipping retains the original concave cap profiles, without a hull fill. */
function triangulate(outline: readonly Point[]): Point[][] {
  const points = [...outline],
    area = points.reduce((s, p, i) => {
      const q = points[(i + 1) % points.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0);
  if (area < 0) points.reverse();
  const ring = points.map((_, i) => i),
    result: Point[][] = [];
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (
    let guard = 0;
    ring.length > 3 && guard < points.length * points.length;
    guard++
  ) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const a = points[ring[(i + ring.length - 1) % ring.length]],
        b = points[ring[i]],
        c = points[ring[(i + 1) % ring.length]];
      if (cross(a, b, c) <= 1e-12) continue;
      if (
        ring.some(
          (id, j) =>
            j !== i &&
            j !== (i + ring.length - 1) % ring.length &&
            j !== (i + 1) % ring.length &&
            cross(a, b, points[id]) >= -1e-12 &&
            cross(b, c, points[id]) >= -1e-12 &&
            cross(c, a, points[id]) >= -1e-12,
        )
      )
        continue;
      result.push([a, b, c]);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (ring.length === 3) result.push(ring.map((i) => points[i]));
  return result;
}
