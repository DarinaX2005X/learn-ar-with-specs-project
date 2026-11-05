import {
  AuthorViewSnapshot,
  AuthorRecording,
} from "../../Author/AuthorViewSession";
import { CaseDraft, Field, AnswerValue, Board } from "../../Domain/types";
import { RecordedGlass } from "../RecordedGlass";
interface Pane {
  root: SceneObject;
  glass: RecordedGlass;
  caption: Text;
  key: string;
}
const fieldName: Record<Field, string> = {
  taker: "Taker",
  recipient: "Recipient",
  cache: "Cache",
  takeTick: "Take time",
  passTick: "Pass time",
  stashTick: "Stash time",
};
/** Uses the existing camera rear plate and two genuine bench glass slots. */
export class AuthorGlass {
  private camera: Pane;
  private before: Pane;
  private after: Pane;
  private disposed = false;
  constructor(
    private parent: SceneObject,
    private material: Material,
  ) {
    this.camera = this.pane("AuthorCameraGlass", 1);
    this.before = this.pane("AuthorOriginalGlass", 0.45);
    this.after = this.pane("AuthorChangedGlass", 0.45);
    this.clear();
  }
  private pane(name: string, scale: number): Pane {
    const root = global.scene.createSceneObject(name);
    root.setParent(this.parent);
    root.getTransform().setLocalScale(new vec3(scale, scale, scale));
    const captionObject = global.scene.createSceneObject(name + "_SurfaceInk");
    captionObject.setParent(root);
    captionObject
      .getTransform()
      .setLocalPosition(new vec3(0, scale === 1 ? -11.7 : -14, 0.24));
    const text = captionObject.createComponent("Component.Text");
    text.text = "";
    text.size = scale === 1 ? 32 : 48;
    text.depthTest = true;
    text.horizontalAlignment = HorizontalAlignment.Center;
    text.verticalAlignment = VerticalAlignment.Center;
    text.horizontalOverflow = HorizontalOverflow.Wrap;
    text.verticalOverflow = VerticalOverflow.Shrink;
    text.layoutRect = Rect.create(
      -17.5,
      17.5,
      scale === 1 ? -1.6 : -3.75,
      scale === 1 ? 1.6 : 3.75,
    );
    text.textFill.color = new vec4(0.9, 0.91, 0.82, 1);
    return {
      root,
      glass: new RecordedGlass(root, this.material),
      caption: text,
      key: "",
    };
  }
  private find(name: string, node: SceneObject): SceneObject | undefined {
    if (node.name === name) return node;
    for (let i = 0; i < node.getChildrenCount(); i++) {
      const found = this.find(name, node.getChild(i));
      if (found) return found;
    }
    return undefined;
  }
  private global(name: string): SceneObject | undefined {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const found = this.find(name, global.scene.getRootObject(i));
      if (found) return found;
    }
    return undefined;
  }
  private show(
    pane: Pane,
    recording: AuthorRecording | undefined,
    caption: string,
  ): void {
    const key =
      recording?.board && recording.frame
        ? JSON.stringify([recording.board, recording.frame])
        : "";
    if (key !== pane.key) {
      pane.key = key;
      pane.glass.clear();
      if (key && recording?.board)
        pane.glass.render(recording.board, recording.frame, true);
    }
    pane.caption.text = caption;
    pane.root.enabled = true;
  }
  private values(field: Field, values: AnswerValue[]): string {
    return values
      .map((value) =>
        typeof value === "number" && field.endsWith("Tick")
          ? (value / 2).toFixed(1) + " s"
          : String(value).replace(/([a-z])([A-Z])/g, "$1 $2"),
      )
      .join(" or ");
  }
  private assessment(
    recording: AuthorRecording | undefined,
    view: AuthorViewSnapshot,
  ): string {
    if (view.comparing) return "Checking the recording";
    if (!view.before?.verdict || !view.after?.verdict)
      return "Compare this change";
    const verdict = recording?.verdict;
    if (!verdict) return "Compare this change";
    if (verdict.status === "incomplete" || verdict.status === "conflict")
      return verdict.message ?? "Check this recording";
    return (
      "Whole recording\n" +
      (recording?.board?.fields ?? [])
        .map(
          (field) =>
            fieldName[field] +
            "  " +
            (this.values(field, verdict.fieldValues[field] ?? []) ||
              "Not determined"),
        )
        .join("\n")
    );
  }
  render(view: AuthorViewSnapshot | undefined, draft?: CaseDraft): void {
    if (this.disposed) return;
    if (!view?.enabled || !view.watching) {
      this.clear();
      return;
    }
    const recording = view.mode === "change" ? view.after : view.recording;
    const witness = (
      recording?.board?.witnesses ??
      draft?.witnesses ??
      []
    ).find((w) => w.id === view.source);
    if (witness) {
      const rotation = quat.fromEulerAngles(0, witness.yaw + Math.PI, 0),
        local = new vec3(
          witness.position.x * 100 - 350 - Math.sin(witness.yaw) * 64.2,
          witness.position.y * 100,
          witness.position.z * 100 - 250 - Math.cos(witness.yaw) * 64.2,
        );
      this.camera.root
        .getTransform()
        .setWorldPosition(
          this.parent.getTransform().getWorldTransform().multiplyPoint(local),
        );
      this.camera.root
        .getTransform()
        .setWorldRotation(
          this.parent.getTransform().getWorldRotation().multiply(rotation),
        );
      const reason = recording?.errors[0]?.message;
      this.show(
        this.camera,
        recording,
        reason ?? view.source + " · " + (view.tick / 2).toFixed(1) + " s",
      );
    } else {
      this.camera.glass.clear();
      this.camera.key = "";
      this.camera.root.enabled = false;
    }
    const bench = this.global("Anchor_ConservationBench");
    if (!bench) {
      this.before.root.enabled = false;
      this.after.root.enabled = false;
      return;
    }
    for (const [pane, x] of [
      [this.before, -24],
      [this.after, 0],
    ] as const) {
      const transform = bench.getTransform();
      pane.root
        .getTransform()
        .setWorldPosition(
          transform
            .getWorldPosition()
            .add(
              transform.getWorldRotation().multiplyVec3(new vec3(x, 6.85, -42)),
            ),
        );
      pane.root.getTransform().setWorldRotation(
        transform
          .getWorldRotation()
          .multiply(quat.fromEulerAngles(-Math.PI / 2, 0, 0))
          .multiply(quat.fromEulerAngles(0, 0, Math.PI)),
      );
    }
    if (view.mode !== "change") {
      this.show(
        this.before,
        recording,
        recording?.errors[0]?.message ??
          view.source + " \u00b7 " + (view.tick / 2).toFixed(1) + " s",
      );
      this.after.glass.clear();
      this.after.key = "";
      this.after.caption.text = "";
      this.after.root.enabled = false;
      return;
    }
    this.show(
      this.before,
      view.before,
      "Original · " +
        (view.tick / 2).toFixed(1) +
        " s\n" +
        (view.before?.errors[0]?.message ?? this.assessment(view.before, view)),
    );
    this.show(
      this.after,
      view.after,
      "Changed · " +
        (view.tick / 2).toFixed(1) +
        " s\n" +
        (view.after?.errors[0]?.message ?? this.assessment(view.after, view)),
    );
  }
  clear(): void {
    for (const pane of [this.camera, this.before, this.after]) {
      pane.glass.clear();
      pane.key = "";
      pane.caption.text = "";
      pane.root.enabled = false;
    }
  }
  read() {
    return {
      camera: this.camera.root.enabled
        ? {
            roles: this.camera.glass.renderedRoles,
            caption: this.camera.caption.text,
          }
        : undefined,
      before: this.before.root.enabled
        ? {
            roles: this.before.glass.renderedRoles,
            caption: this.before.caption.text,
          }
        : undefined,
      after: this.after.root.enabled
        ? {
            roles: this.after.glass.renderedRoles,
            caption: this.after.caption.text,
          }
        : undefined,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const pane of [this.camera, this.before, this.after]) {
      pane.glass.dispose();
      pane.root.destroy();
    }
    this.disposed = true;
  }
}
