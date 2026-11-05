import { MuseumFonts, applyMuseumFont } from "./MuseumFonts";
import { caseTitle } from "../Shelf/CaseTitles";
/** Public name printed on the existing case's leather front edge. No mesh,
 * floating title, private case data, input target or camera dependency. */
export class CaseTitleInk {
  private object: SceneObject;
  private text: Text;
  private disposed = false;
  constructor(root: SceneObject, fonts: MuseumFonts = {}) {
    let top = root;
    while (top.getParent()) top = top.getParent();
    const find = (node: SceneObject): SceneObject | undefined => {
      if (node.name === "Anchor_ConservationBench") return node;
      for (let i = 0; i < node.getChildrenCount(); i++) {
        const found = find(node.getChild(i));
        if (found) return found;
      }
      return undefined;
    };
    const bench = find(top);
    if (!bench) throw new Error("Case title requires the conservation bench anchor");
    this.object = global.scene.createSceneObject("CaseLeatherTitleInk");
    this.object.setParent(root);
    const anchor = bench.getTransform(), rotation = anchor.getWorldRotation();
    // Existing OpenCaseBase centre bench+(0,4,-15),45x8x32cm.
    // Its front face is z=-31, y=0..8 relative to the bench anchor.
    // BenchMat reaches y=3.4; keep the entire ink within y=4.2..7.8.
    this.object.getTransform().setWorldPosition(anchor.getWorldPosition()
      .add(rotation.multiplyVec3(new vec3(0, 6, -31.05))));
    this.object.getTransform().setWorldRotation(rotation
      .multiply(quat.fromEulerAngles(0, Math.PI, 0)));
    this.text = this.object.createComponent("Component.Text");
    applyMuseumFont(this.text, fonts, "bold");
    this.text.text = "";
    this.text.size = 64;
    this.text.depthTest = true;
    this.text.horizontalAlignment = HorizontalAlignment.Center;
    this.text.verticalAlignment = VerticalAlignment.Center;
    this.text.horizontalOverflow = HorizontalOverflow.Wrap;
    this.text.verticalOverflow = VerticalOverflow.Shrink;
    this.text.layoutRect = Rect.create(-21, 21, -1.8, 1.8);
    this.text.textFill.color = new vec4(0.91, 0.85, 0.69, 1);
    this.clear();
  }
  render(title: string): void {
    if (this.disposed) return;
    this.text.text = caseTitle(title);
    this.object.enabled = true;
  }
  clear(): void {
    if (this.disposed) return;
    this.text.text = "";
    this.object.enabled = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.object.destroy();
    this.disposed = true;
  }
}
