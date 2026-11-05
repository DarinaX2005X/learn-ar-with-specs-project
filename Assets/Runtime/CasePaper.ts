import { Clue, Field, AnswerValue } from "../Domain/types";
import { DetectiveState } from "../Detective/DetectiveSession";
import { PlayTableSnapshot } from "./PlayTable";

const time = (tick: number): string => (tick * 0.5).toFixed(1) + " s";
const joined = (values: readonly AnswerValue[]): string => {
  const words = values.map(String);
  return words.length < 3
    ? words.join(" or ")
    : words.slice(0, -1).join(", ") + " or " + words[words.length - 1];
};

/** Only the observed public payload is named. Timeless object clues get no time. */
export function evidenceInscription(clue: Clue): string {
  if (clue.kind === "Rim") return "Rim contact\nTime not recorded";
  if (clue.kind === "Box")
    return (clue.present ? "Ruby in " : "No ruby in ") + clue.box;
  const fragment = clue.payload.fragments.length === 1
    ? clue.payload.fragments[0] : undefined;
  let finding = fragment
    ? (fragment.role ?? "Unidentified figure") +
      (fragment.via === "mirror" ? "\nin mirror" : "")
    : "Recorded view";
  if (!fragment && clue.observation?.kind === "hand")
    finding = clue.observation.present ? "Hand with ruby" : "No ruby in hand";
  if (!fragment && clue.payload.actions.length === 1) {
    const action = clue.payload.actions[0];
    finding = { Take: "Ruby taken", BrushRim: "Rim touched", Pass: "Ruby passed", Stash: "Ruby put away" }[action.kind];
  }
  if (clue.observation?.kind === "exhibit")
    finding = clue.payload.exhibit ? "Ruby in case" : "Empty case";
  const source = clue.witness === "entrance" ? "Entrance" : clue.witness;
  return finding + "\n" + source + " " + time(clue.tick);
}

function fieldFinding(field: Field, values: readonly AnswerValue[]): string {
  if (!values.length) return "";
  const choices = joined(values), one = values.length === 1;
  switch (field) {
    case "taker": return choices + (one ? " took the ruby." : " could have taken it.");
    case "recipient":
      if (one && values[0] === "None") return "No one received the ruby.";
      if (values.includes("None")) return "No transfer or a transfer to " + joined(values.filter(value => value !== "None")) + " fits.";
      return choices + (one ? " received the ruby." : " could have received it.");
    case "cache":
      if (one && values[0] === "None") return "The ruby was not put away.";
      if (values.includes("None")) return "No cache or " + joined(values.filter(value => value !== "None")) + " fits.";
      return one ? "Ruby in " + choices + "." : "Possible cache: " + choices + ".";
    default: {
      const action = { takeTick: "Taken", passTick: "Passed", stashTick: "Put away" }[field];
      if (values.includes("None")) return one ? "No " + (field === "passTick" ? "transfer" : "storage") + " recorded." : action + " time remains open.";
      const times = values.map(value => typeof value === "number" ? time(value) : String(value));
      return action + (one ? " at " : " possibly at ") + joined(times) + ".";
    }
  }
}

/** A fresh public verdict is required. Archived fields never resurrect stale ink. */
export function casePaperInscription(state: DetectiveState): string {
  const verdict = state.verdict;
  if (!verdict || state.checking) return "";
  if (verdict.status === "incomplete") return "Check unfinished.\nTry again.";
  if (verdict.status === "conflict") return "These observations conflict.\nReview the evidence.";
  const lines: string[] = [];
  if (verdict.status === "contradicted") lines.push("This claim conflicts with the evidence.");
  for (const field of state.questionFields) {
    const values = verdict.fieldValues[field] ??
      (field === "taker" ? verdict.possibleCulprits : []);
    const line = fieldFinding(field, values);
    if (line) lines.push(line);
  }
  if (!lines.length) return "The evidence leaves this finding open.";
  lines.push(verdict.scope === "selected" ? "From selected evidence." : "From all recorded evidence.");
  return lines.join("\n");
}

interface InkSurface { object: SceneObject; text: Text; }

/** Ink on existing museum paper and glass only. Creates no mesh, canvas or input. */
export class CasePaper {
  private layer: SceneObject;
  private result: InkSurface;
  private evidence: InkSurface[] = [];
  private covered = false;
  private disposed = false;
  private epoch: number | undefined;
  private signature = "";
  private live = false;
  constructor(private root: SceneObject) {
    this.layer = global.scene.createSceneObject("CasePaperInk");
    this.layer.setParent(root);
    this.result = this.surface("CheckedFinding", [0, 9.35, -15], 37, 24, 128, true);
    // Ink occupies the far 5 cm of each existing evidence pane. At the normal
    // bench eye the loupe rim hides the middle of its pane, not this rear band.
    // Keep the complete label inside the original 20 x 18 cm Evidence target;
    // the physical pane, recorded image and interaction anchor stay in place.
    for (let index = 0; index < 3; index++)
      this.evidence.push(this.surface("PinnedEvidenceInk" + index,
        [-24 + 24 * index, 6.85, -37], 17, 5, 60, false));
    this.clear();
  }
  private find(name: string, from: SceneObject): SceneObject | undefined {
    if (from.name === name) return from;
    for (let index = 0; index < from.getChildrenCount(); index++) {
      const found = this.find(name, from.getChild(index));
      if (found) return found;
    }
    return undefined;
  }
  private bench(): SceneObject | undefined {
    let top = this.root;
    while (top.getParent()) top = top.getParent();
    return this.find("Anchor_ConservationBench", top);
  }
  private surface(name: string, offset: [number, number, number], width: number,
    height: number, size: number, paper: boolean): InkSurface {
    const object = global.scene.createSceneObject(name);
    object.setParent(this.layer);
    const anchor = this.bench();
    if (!anchor) throw new Error("Case paper requires the conservation bench anchor");
    const transform = anchor.getTransform(), rotation = transform.getWorldRotation();
    object.getTransform().setWorldPosition(transform.getWorldPosition().add(rotation.multiplyVec3(new vec3(...offset))));
    // Front visitor stands at story -Z: top of the paper points away, toward +Z.
    // Rotate within the horizontal plane without turning its +Y ink normal over.
    object.getTransform().setWorldRotation(rotation
      .multiply(quat.fromEulerAngles(-Math.PI / 2, 0, 0))
      .multiply(quat.fromEulerAngles(0, 0, Math.PI)));
    const text = object.createComponent("Component.Text");
    text.text = "";
    text.size = size;
    text.depthTest = true;
    text.horizontalAlignment = HorizontalAlignment.Center;
    text.verticalAlignment = VerticalAlignment.Center;
    text.horizontalOverflow = HorizontalOverflow.Wrap;
    text.verticalOverflow = VerticalOverflow.Shrink;
    text.layoutRect = Rect.create(-width / 2, width / 2, -height / 2, height / 2);
    text.textFill.color = paper
      ? new vec4(0.086, 0.235, 0.227, 1)
      : new vec4(0.949, 0.969, 0.937, 1);
    return { object, text };
  }
  render(snapshot: PlayTableSnapshot): void {
    if (this.disposed) return;
    if (this.epoch !== snapshot.flow.inputEpoch) {
      this.clear();
      this.epoch = snapshot.flow.inputEpoch;
    }
    const state = snapshot.detective;
    if (!state || !["detective", "finished"].includes(snapshot.flow.mode) ||
      state.caseId !== snapshot.flow.caseId || state.rev !== snapshot.flow.revision) {
      this.clear(); return;
    }
    this.result.text.text = casePaperInscription(state);
    for (let index = 0; index < this.evidence.length; index++) {
      const item = state.visibleGlass[index];
      this.evidence[index].text.text = item ? evidenceInscription(item.clue) : "";
      this.evidence[index].text.textFill.color = item?.selected
        ? new vec4(1, 0.867, 0.569, 1)
        : new vec4(0.949, 0.969, 0.937, 1);
      this.evidence[index].object.enabled = !!item;
    }
    this.live = true;
    this.layer.enabled = !this.covered;
    this.result.object.enabled = !!this.result.text.text;
    this.signature = state.caseId + ":" + state.rev;
  }
  setCovered(covered: boolean): void {
    this.covered = covered;
    if (!this.disposed) this.layer.enabled = this.live && !covered;
  }
  clear(): void {
    this.live = false;
    this.signature = "";
    this.result.text.text = "";
    for (const surface of this.evidence) surface.text.text = "";
    this.layer.enabled = false;
  }
  read(): { visible: boolean; case: string; result: string; evidence: string[] } {
    return { visible: this.live && !this.covered, case: this.signature,
      result: this.result.text.text, evidence: this.evidence.map(surface => surface.text.text) };
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.layer.destroy();
    this.disposed = true;
  }
}
