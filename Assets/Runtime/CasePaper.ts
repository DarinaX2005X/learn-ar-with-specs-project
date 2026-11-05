import { rimFinding } from "./RimEvidence";
import { MuseumFonts, applyMuseumFont } from "./MuseumFonts";
import { Clue, FrameClue, Role, Field, AnswerValue } from "../Domain/types";
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
  if (clue.kind === "Rim") return rimFinding(clue);
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


/** Separate type sizes on a pinned pane. These strings describe public evidence only. */
export interface EvidenceGlassText {
  finding: string;
  source: string;
}

function sourceName(witness: string): string {
  if (witness === "entrance") return "Entrance";
  if (witness === "passage") return "Passage";
  const authorCamera = /^author-camera-([1-9][0-9]*)$/.exec(witness);
  return authorCamera ? "Camera " + authorCamera[1] : witness;
}

function boxName(box: string): string {
  if (box === "canvas trunk") return "Canvas trunk";
  if (box === "brass case") return "Brass case";
  return box;
}

function roleRows(roles: readonly Role[]): string {
  const lines: string[] = [];
  let line = "";
  for (const role of roles) {
    const next = line ? line + ", " + role : role;
    if (line && next.length > 14) {
      lines.push(line);
      line = role;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function recordedText(frame: FrameClue, inlineMirror: boolean): EvidenceGlassText {
  const { observation, payload } = frame;
  const recording = sourceName(frame.witness) + " " + (frame.tick * 0.5).toFixed(1) + " s";
  let finding = "Recorded view";
  let via: "mirror" | "direct" | undefined;
  if (observation?.kind === "fragment") {
    const fragment = payload.fragments.find(item => item.segment === observation.segment);
    if (fragment) {
      finding = fragment.role ?? "Unidentified figure";
      via = fragment.via;
    }
  } else if (observation?.kind === "hand") {
    finding = observation.present ? "Ruby in hand" : "No ruby in hand";
    via = observation.via;
  } else if (observation?.kind === "action") {
    // getObservations retains the root index in the descriptor but stores
    // exactly the selected action in this crop, including legacy slices.
    const action = payload.actions[0];
    if (action && payload.actions.length === 1) {
      finding = {Take: "Ruby taken", BrushRim: "Rim touched", Pass: "Ruby passed", Stash: "Ruby stashed"}[action.kind];
      if (action.kind === "Stash" && action.box) finding += "\n" + boxName(action.box);
      via = action.via;
    }
  } else if (observation?.kind === "exhibit" && payload.exhibit !== undefined) {
    finding = payload.exhibit ? "Ruby in case" : "Empty case";
    via = payload.exhibitSurface?.via;
  }
  if (via === "mirror" && inlineMirror) return { finding: finding + " in mirror", source: recording };
  return { finding, source: via === "mirror" ? "In mirror\n" + recording : recording };
}

export function evidenceGlassText(clue: Clue, inlineMirror = false): EvidenceGlassText {
  if (clue.kind === "Frame") return recordedText(clue, inlineMirror);
  if (clue.kind === "Box") {
    return { finding: clue.present ? "Ruby found" : "No ruby", source: boxName(clue.box) };
  }
  return { finding: clue.shapes.length ? roleRows(clue.shapes) : "No marks", source: "Rim marks" };
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
  private detail: InkSurface;
  private evidence: { finding: InkSurface; source: InkSurface; inscription: string }[] = [];
  private covered = false;
  private disposed = false;
  private epoch: number | undefined;
  private signature = "";
  private live = false;
  constructor(private root: SceneObject, private fonts: MuseumFonts = {}) {
    this.layer = global.scene.createSceneObject("CasePaperInk");
    this.layer.setParent(root);
    this.result = this.surface("CheckedFinding", [0, 9.35, -15], 37, 24, 128, true);
    // Keep focused ink on the rear of the existing leaf, clear of its brass clip.
    this.detail = this.surface("SelectedEvidenceDetail", [0, 9.35, -12.45], 36, 17.8 / 1.15, 162, true);
    this.detail.object.getTransform().setLocalScale(new vec3(1, 1.15, 1));
    // A 16.8 cm writing face fits inside each original 18 cm glass. The loupe
    // covers the front of the middle pane. Its two lines use the clear rear band.
    for (let index = 0; index < 3; index++) {
      const x = -24 + 24 * index;
      const middle = index === 1;
      const finding = this.glassLine("PinnedEvidenceInk" + index, x,
        middle ? -36.04 : -40, middle ? 3.12 : 7.5, middle ? 136 : 172,
        middle ? 1.10 : 1.30, "bold");
      const source = this.glassLine("EvidenceSourceInk" + index, x,
        middle ? -38.59 : -46, middle ? 1.99 : 5.7, middle ? 83 : 98,
        middle ? 1.04 : 1.20, "regular");
      this.evidence.push({ finding, source, inscription: "" });
    }
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
    applyMuseumFont(text, this.fonts, paper ? "bold" : "regular");
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
  private glassLine(name: string, x: number, z: number, height: number,
    size: number, depthScale: number, weight: "regular" | "bold"): InkSurface {
    const surface = this.surface(name, [x, 6.85, z], 16.8, height / depthScale, size, false);
    applyMuseumFont(surface.text, this.fonts, weight);
    // Optical compensation stays in the physical plane. Its final printed
    // height is limited by the same measured rectangle after scaling.
    surface.object.getTransform().setLocalScale(new vec3(1, depthScale, 1));
    surface.text.horizontalOverflow = HorizontalOverflow.Shrink;
    return surface;
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
    let detail = "";
    const focused = state.focusedObservation ?? state.frame;
    const leafFree = snapshot.flow.mode === "detective" && state.mode !== "reconstruction" &&
      !state.verdict && !state.checking;
    for (let index = 0; index < this.evidence.length; index++) {
      const item = state.visibleGlass[index];
      const pane = this.evidence[index];
      pane.inscription = item ? evidenceInscription(item.clue) : "";
      let finding = "", source = "";
      if (item) {
        const label = evidenceGlassText(item.clue, index === 1);
        finding = label.finding;
        source = label.source;
        // The middle glass has one clear line per field behind the loupe.
        // Long custom names also need more width on the outer two glasses.
        if (leafFree && item.selected && item.id === focused?.id &&
            (source.split("\n").some(line => line.length > 18) ||
             finding.split("\n").some(line => line.length > 19) ||
             (index === 1 && (finding.includes("\n") || finding.length > 16)))) {
          const full = evidenceGlassText(item.clue, true);
          const text = item.clue.kind === "Rim"
            ? full.source + "\n" + item.clue.shapes.join(", ")
            : full.finding + "\n" + (item.clue.kind === "Frame"
              ? full.source.replace(/ s$/, "\u00a0s") : full.source);
          // Preserve long author IDs; zero-width spaces give Wrap a break
          // within uninterrupted ASCII runs. The stored clue stays verbatim.
          detail = text.replace(/([A-Za-z0-9_]{16})(?=[A-Za-z0-9_])/g, "$1\u200b");
        }
      }
      pane.finding.text.text = finding;
      pane.source.text.text = source;
      const color = item?.selected
        ? new vec4(1, 0.867, 0.569, 1)
        : new vec4(0.949, 0.969, 0.937, 1);
      pane.finding.text.textFill.color = color;
      pane.source.text.textFill.color = color;
      pane.finding.object.enabled = !!item;
      pane.source.object.enabled = !!item;
    }
    this.live = true;
    this.layer.enabled = !this.covered;
    this.result.object.enabled = !!this.result.text.text;
    this.detail.text.text = detail;
    this.detail.object.enabled = !!detail;
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
    this.detail.text.text = "";
    this.detail.object.enabled = false;
    for (const pane of this.evidence) {
      pane.finding.text.text = "";
      pane.source.text.text = "";
      pane.inscription = "";
    }
    this.layer.enabled = false;
  }
  read(): { visible: boolean; case: string; result: string; evidence: string[] } {
    return { visible: this.live && !this.covered, case: this.signature,
      result: this.result.text.text, evidence: this.evidence.map(pane => pane.inscription) };
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.layer.destroy();
    this.disposed = true;
  }
}
