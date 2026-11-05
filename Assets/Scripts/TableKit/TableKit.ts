/** Visual adapter. No scene ownership, time source, case data or SIK singleton.
 * Editor mounts imported models and implements these narrow ports once.
 * All geometry and joint transforms are shared by every view and dev gallery.
 */
export type Role = "Guard" | "Courier" | "Conservator";
export type Vec3 = readonly [number, number, number];
export type Mode = "author" | "witness" | "hypothesis" | "reveal";
export type GrabState = "free" | "hover" | "grabbed" | "cancelled";
export interface ActorPose {
  readonly role: Role;
  readonly positionCm: Vec3;
  readonly yawRad: number;
  readonly joints?: Readonly<
    Partial<
      Record<
        | "Shoulder_L"
        | "Shoulder_R"
        | "Forearm_L"
        | "Forearm_R"
        | "Hand_L"
        | "Hand_R"
        | "Hip_L"
        | "Hip_R"
        | "Knee_L"
        | "Knee_R"
        | "Head",
        Vec3
      >
    >
  >;
  readonly grab?: GrabState;
}
/** Already-public triangles from the exact recorded tick and fixed observer.
 * Fragments must be clipped by the witness compiler; never pass a live actor.
 * Unknown identity uses anonymous material and must not include role geometry.
 */
export interface ObservedFragment {
  readonly id: string;
  readonly verticesCm: readonly Vec3[];
  readonly indices: readonly number[];
  readonly material:
    | "anonymous"
    | "limestone"
    | "clothTeal"
    | "brass"
    | "ruby"
    | "edge";
  readonly roleMark?: Role;
}
export interface WitnessView {
  readonly kind: "witness";
  readonly revision: string;
  readonly fragments: readonly ObservedFragment[];
  readonly aperture: number;
}
export interface WorldView {
  readonly kind: "world";
  readonly revision: string;
  readonly actors: readonly ActorPose[];
  readonly aperture: number;
  readonly ruby: { readonly positionCm: Vec3; readonly visible: boolean };
}
export interface RenderPose {
  readonly playing: boolean;
  readonly muted?: boolean;
  readonly curtainGrab?: GrabState;
}
export interface TableKitPorts {
  /** Must clear *all* role models, labels, cached proxy meshes and shadows first. */
  clearActors(): void;
  drawActor(pose: ActorPose): void;
  drawObserved(fragment: ObservedFragment): void;
  drawRuby(positionCm: Vec3, visible: boolean): void;
  /** Fold x values, handle x and focus state share the canonical aperture. */
  drawCurtain(state: CurtainVisual): void;
  playAtCurtain(sound: "engage" | "cloth" | "latch"): void;
}
export interface CurtainVisual {
  readonly aperture: number;
  readonly foldXCm: readonly number[];
  readonly foldScaleX: number;
  readonly handleXCm: number;
  readonly focus: boolean;
  readonly grabbed: boolean;
}
export type ActionHandler = (value: unknown) => void;
const clamp = (v: number) =>
  Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
/** Curtain gathers to right. Opening is [−3, −3+6*a]; kernel must use same rule. */
export function curtainVisual(
  aperture: number,
  grab: GrabState = "free",
): CurtainVisual {
  const a = clamp(aperture),
    width = 6 - 5.5 * a;
  return {
    aperture: a,
    foldXCm: Array.from(
      { length: 12 },
      (_, i) => -3 + 6 * a + ((i + 0.5) * width) / 12,
    ),
    foldScaleX: width / 6,
    handleXCm: -3 + 6 * a,
    focus: grab === "hover" || grab === "grabbed",
    grabbed: grab === "grabbed",
  };
}
export class TableKit {
  private actions = new Map<string, ActionHandler>();
  private soundKeys = new Set<string>();
  private soundRevision = "";
  private previousGrab: GrabState = "free";
  private previousAperture = 0;
  private committedAperture = 0;
  constructor(private readonly ports: TableKitPorts) {}
  bind(actionId: string, handler: ActionHandler): () => void {
    this.actions.set(actionId, handler);
    return () => {
      if (this.actions.get(actionId) === handler) this.actions.delete(actionId);
    };
  }
  /** SIK adapter calls once per authoritative event, never once per render frame. */
  dispatch(actionId: string, value: unknown): void {
    this.actions.get(actionId)?.(value);
  }
  render(
    mode: "witness",
    view: WitnessView,
    tick: number,
    pose: RenderPose,
  ): void;
  render(
    mode: "author" | "hypothesis" | "reveal",
    view: WorldView,
    tick: number,
    pose: RenderPose,
  ): void;
  render(
    mode: Mode,
    view: WitnessView | WorldView,
    tick: number,
    pose: RenderPose,
  ): void {
    if ((mode === "witness") !== (view.kind === "witness"))
      throw new Error("TableKit view/mode mismatch");
    if (!Number.isFinite(tick)) throw new Error("TableKit tick must be finite");
    this.ports.clearActors();
    if (view.kind === "witness") {
      // No independent ruby, shadow or live figure can leak hidden ownership.
      this.ports.drawRuby([0, 0, 0], false);
      for (const fragment of view.fragments) this.ports.drawObserved(fragment);
    } else {
      for (const actor of view.actors) this.ports.drawActor(actor);
      this.ports.drawRuby(view.ruby.positionCm, view.ruby.visible);
    }
    const aperture = clamp(view.aperture),
      grab = pose.curtainGrab || "free";
    this.ports.drawCurtain(curtainVisual(aperture, grab));
    // Playback keys are scoped to revision; scrubbing is silent.
    if (this.soundRevision !== view.revision) {
      this.soundRevision = view.revision;
      this.soundKeys.clear();
    }
    if (pose.playing && !pose.muted) {
      let sound: "engage" | "cloth" | "latch" | undefined;
      if (grab === "grabbed" && this.previousGrab !== "grabbed")
        sound = "engage";
      else if (grab === "free" && this.previousGrab === "grabbed")
        sound = "latch";
      else if (
        Math.abs(aperture - this.previousAperture) > 0.035 &&
        grab === "grabbed"
      )
        sound = "cloth";
      if (sound) {
        const key = tick + ":" + sound;
        if (!this.soundKeys.has(key)) {
          this.soundKeys.add(key);
          this.ports.playAtCurtain(sound);
        }
      }
    }
    this.previousGrab = grab;
    this.previousAperture = aperture;
  }
  beginCurtain(): number {
    return this.previousAperture;
  }
  commitCurtain(aperture: number): void {
    this.committedAperture = clamp(aperture);
    this.dispatch("curtain.commit", this.committedAperture);
  }
  cancelCurtain(): number {
    this.ports.drawCurtain(curtainVisual(this.committedAperture, "cancelled"));
    this.dispatch("curtain.cancel", this.committedAperture);
    return this.committedAperture;
  }
  /** Seed from loaded case, so tracking loss restores the current committed state. */
  setCommittedCurtain(aperture: number): void {
    this.committedAperture = clamp(aperture);
  }
}
export const TABLEKIT_COPY = {
  replay: "Replay the alarm",
  accusation: "Who took the ruby?",
  check: "Check accusation",
  mirror: "Seen in the mirror",
  camera: "Seen by the camera",
  hypothesis: "Possible reconstruction",
  handoff: "Pass to the detective",
  two: "Two suspects fit",
  three: "Three suspects fit",
} as const;
/** Private developer switch; no diagnostic menu or automatic activation. */
export function galleryStates(developerEnabled: boolean): readonly {
  name: string;
  scale: number;
  aperture: number;
  grab: GrabState;
  tick: number;
}[] {
  if (!developerEnabled) return [];
  return [
    { name: "Free", scale: 1, aperture: 1, grab: "free", tick: 12 },
    { name: "Grabbed", scale: 1, aperture: 0.5, grab: "grabbed", tick: 12 },
    { name: "Cancelled", scale: 1, aperture: 0, grab: "cancelled", tick: 12 },
    { name: "Partial", scale: 1, aperture: 0.5, grab: "free", tick: 12 },
    { name: "Closed", scale: 1, aperture: 0, grab: "free", tick: 12 },
    { name: "Life size", scale: 100 / 6, aperture: 1, grab: "free", tick: 12 },
  ];
}
