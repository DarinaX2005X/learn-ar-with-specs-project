import { PlayTableSnapshot } from "./PlayTable";

/** One physical first-case sheet. It has no input, case data or private pose. */
export class ArrivalFile {
  private sheet: SceneObject | undefined;
  private visible = false;
  private closing = false;
  private elapsed = 0;
  private rotation: quat | undefined;
  constructor(parent: SceneObject, material: Material, font?: Font) {
    const find = (name: string, node: SceneObject): SceneObject | undefined => {
      if (node.name === name) return node;
      for (let i = 0; i < node.getChildrenCount(); i++) {
        const found = find(name, node.getChild(i));
        if (found) return found;
      }
      return undefined;
    };
    let anchor: SceneObject | undefined;
    for (let i = 0; i < global.scene.getRootObjectsCount() && !anchor; i++)
      anchor = find("Anchor_EntryClock", global.scene.getRootObject(i));
    if (!anchor) return;
    const sheet = global.scene.createSceneObject("FirstCaseSheet");
    sheet.setParent(parent);
    const transform = anchor.getTransform();
    sheet.getTransform().setWorldPosition(transform.getWorldPosition().add(
      transform.getWorldRotation().multiplyVec3(new vec3(44, -19.3, -63))));
    this.rotation = transform.getWorldRotation().multiply(quat.fromEulerAngles(0, Math.PI, 0));
    sheet.getTransform().setWorldRotation(this.rotation);
    sheet.getTransform().setWorldScale(new vec3(1, 1, 1));
    this.sheet = sheet;
    // 88 x 27 cm sheet folds over the actual 95.5 cm counter lip. Its slight
    // thickness and back belong to the same object; nothing covers the dial.
    const mesh = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mesh.topology = MeshTopology.Triangles;
    mesh.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [], indices: number[] = [];
    const face = (z: number, normal: number, reverse: boolean) => {
      const start = vertices.length / 8;
      for (const [x, y] of [[-44, 0], [-44, -27], [44, -27], [44, 0]])
        vertices.push(x, y, z, 0, 0, normal, (x + 44) / 88, -y / 27);
      indices.push(...(reverse ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
        .map(index => start + index));
    };
    face(0.08, 1, false); face(-0.08, -1, true);
    mesh.appendVerticesInterleaved(vertices); mesh.appendIndices(indices); mesh.updateMesh();
    const visual = sheet.createComponent("Component.RenderMeshVisual");
    visual.mesh = mesh.getMesh();
    const paper = material.clone();
    paper.mainPass.baseColor = new vec4(0.925, 0.882, 0.776, 1);
    paper.mainPass.depthTest = true; paper.mainPass.depthWrite = true;
    paper.mainPass.twoSided = false; visual.mainMaterial = paper;
    this.ink("CaseQuestion", "Who took the ruby?", -7, 8, 240, font);
    this.ink("ClockAction", "Drag the clock to rewind", -18, 8, 180, font);
    sheet.enabled = false;
  }
  private ink(name: string, words: string, y: number, height: number,
    size: number, font?: Font): void {
    if (!this.sheet) return;
    const node = global.scene.createSceneObject(name);
    node.setParent(this.sheet);
    node.getTransform().setLocalPosition(new vec3(0, y, 0.11));
    const text = node.createComponent("Component.Text");
    text.text = words; text.size = size; if (font) text.font = font;
    text.depthTest = true;
    text.horizontalAlignment = HorizontalAlignment.Center;
    text.verticalAlignment = VerticalAlignment.Center;
    text.horizontalOverflow = HorizontalOverflow.Shrink;
    text.verticalOverflow = VerticalOverflow.Shrink;
    text.layoutRect = Rect.create(-41, 41, -height / 2, height / 2);
    text.textFill.color = new vec4(0.04, 0.12, 0.11, 1);
  }
  render(snapshot: PlayTableSnapshot): void {
    if (!this.sheet) return;
    const active = snapshot.arrivalHelp === true && snapshot.flow.mode === "detective"
      && !!snapshot.detective && !snapshot.reveal;
    if (active) {
      this.visible = true;
      this.sheet.enabled = true;
    } else if (this.visible && !this.closing) {
      this.closing = true;
      this.elapsed = 0;
    }
    // Role/scale switches never leave the first sheet in another work area.
    if (snapshot.flow.mode !== "detective" || snapshot.reveal) this.clear();
  }
  update(seconds: number): void {
    if (!this.sheet || !this.rotation || !this.closing || !Number.isFinite(seconds) || seconds < 0) return;
    this.elapsed += seconds;
    const t = Math.min(1, this.elapsed / 0.32), eased = t * t * (3 - 2 * t);
    this.sheet.getTransform().setWorldRotation(this.rotation
      .multiply(quat.fromEulerAngles(eased * Math.PI / 2, 0, 0)));
    if (t === 1) this.clear();
  }
  clear(): void {
    this.visible = false; this.closing = false;
    if (this.sheet) this.sheet.enabled = false;
  }
  dispose(): void { this.sheet?.destroy(); this.sheet = undefined; }
}
