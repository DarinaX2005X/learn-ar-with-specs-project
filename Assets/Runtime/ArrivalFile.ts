import { PlayTableSnapshot } from "./PlayTable";

/** One physical first-case sheet. It has no input, case data or private pose. */
export class ArrivalFile {
  private mount: SceneObject | undefined;
  private sheet: SceneObject | undefined;
  private visible = false;
  private closing = false;
  private elapsed = 0;
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
    const mount = global.scene.createSceneObject("FirstCaseSheetMount");
    mount.setParent(parent);
    this.mount = mount;
    const transform = anchor.getTransform();
    // Counter top maxY=95.5, frontZ=-177.5 cm. The 1 mm return lies
    // on that top and reaches 8 cm past the 3.5 cm bevel to real support.
    mount.getTransform().setWorldPosition(transform.getWorldPosition().add(
      transform.getWorldRotation().multiplyVec3(new vec3(44, -19.45, -62.5))));
    mount.getTransform().setWorldRotation(transform.getWorldRotation()
      .multiply(quat.fromEulerAngles(0, Math.PI, 0)));
    mount.getTransform().setWorldScale(new vec3(1, 1, 1));
    const sheet = global.scene.createSceneObject("FirstCaseSheet");
    sheet.setParent(mount);
    // Existing shoulders end at worldZ=-179.75 cm. Hang in front at
    // -181 cm, retaining a physical gap, rather than hiding their depth.
    sheet.getTransform().setLocalPosition(new vec3(0, 0, 3.5));
    this.sheet = sheet;
    // 88 x 27 cm hanging face. Only this face rotates around its outer
    // crease; the supporting return stays seated on the counter.
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
    face(0.05, 1, false); face(-0.05, -1, true);
    mesh.appendVerticesInterleaved(vertices); mesh.appendIndices(indices); mesh.updateMesh();
    const visual = sheet.createComponent("Component.RenderMeshVisual");
    visual.mesh = mesh.getMesh();
    const paper = material.clone();
    paper.mainPass.baseColor = new vec4(0.925, 0.882, 0.776, 1);
    paper.mainPass.depthTest = true; paper.mainPass.depthWrite = true;
    paper.mainPass.twoSided = false; visual.mainMaterial = paper;
    const returnMesh = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    returnMesh.topology = MeshTopology.Triangles;
    returnMesh.indexType = MeshIndexType.UInt16;
    const returnVertices: number[] = [];
    for (const side of [1, -1])
      for (const [x, z] of [[-44, -8], [-44, 3.5], [44, 3.5], [44, -8]])
        returnVertices.push(x, side * 0.05, z, 0, side, 0, (x + 44) / 88, (z + 8) / 11.5);
    returnMesh.appendVerticesInterleaved(returnVertices);
    returnMesh.appendIndices([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    returnMesh.updateMesh();
    const returnObject = global.scene.createSceneObject("FirstCasePaperReturn");
    returnObject.setParent(mount);
    const returnVisual = returnObject.createComponent("Component.RenderMeshVisual");
    returnVisual.mesh = returnMesh.getMesh();
    returnVisual.mainMaterial = paper;
    this.ink("CaseQuestion", "Who took the ruby?", -7, 8, 240, font);
    this.ink("ClockAction", "Drag the clock to rewind", -18, 8, 220, font);
    mount.enabled = false;
  }
  private ink(name: string, words: string, y: number, height: number,
    size: number, font?: Font): void {
    if (!this.sheet) return;
    const node = global.scene.createSceneObject(name);
    node.setParent(this.sheet);
    node.getTransform().setLocalPosition(new vec3(0, y, 0.08));
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
    if (!this.sheet || !this.mount) return;
    const active = snapshot.arrivalHelp === true && snapshot.flow.mode === "detective"
      && !!snapshot.detective && !snapshot.reveal;
    if (active) {
      this.visible = true;
      this.mount.enabled = true;
    } else if (this.visible && !this.closing) {
      this.closing = true;
      this.elapsed = 0;
    }
    // Role/scale switches never leave the first sheet in another work area.
    if (snapshot.flow.mode !== "detective" || snapshot.reveal) this.clear();
  }
  update(seconds: number): void {
    if (!this.sheet || !this.closing || !Number.isFinite(seconds) || seconds < 0) return;
    this.elapsed += seconds;
    const t = Math.min(1, this.elapsed / 0.32), eased = t * t * (3 - 2 * t);
    // Fold toward the visitor, outside the cabinet, not through its top.
    this.sheet.getTransform().setLocalRotation(
      quat.fromEulerAngles(-eased * Math.PI / 2, 0, 0));
    if (t === 1) this.clear();
  }
  clear(): void {
    this.visible = false; this.closing = false;
    if (this.mount) this.mount.enabled = false;
  }
  dispose(): void { this.mount?.destroy(); this.mount = undefined; this.sheet = undefined; }
}
