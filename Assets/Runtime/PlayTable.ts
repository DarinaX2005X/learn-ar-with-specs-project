import {
  ObservationContact,
  ObservationTargetView,
  observationContacts,
  nextObservation,
  observationLabel,
} from "../Runtime/MuseumGame/ObservationContacts";
import { AuthorPropsHandles } from "../Author/AuthorPropsHandles";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { AuthorSnapshot } from "../Author/AuthorSession";
import {
  AuthorViewSnapshot,
  AuthorViewAction,
  authorViewControls,
} from "../Author/AuthorViewSession";
import { AuthorCommand } from "../Author/AuthorController";
import {
  DetectiveState,
  DetectiveAction,
} from "../Detective/DetectiveSession";
import { FlowState } from "../Cases/CaseFlow";
import {
  Board,
  Clue,
  Field,
  Role,
  TrackId,
  Key,
  Vec3,
  FrameClue,
} from "../Domain/types";
import {
  recordedPaneViews,
  toggleRecordingDetail,
  recordingDetailEnabled,
} from "../Runtime/RecordedGlass";
import {
  CaseViewSnapshot,
  CaseViewAction,
  caseViewControls,
} from "../Spatial/CaseViewRouting";
import { caseViewHandleSlots } from "../Runtime/CaseViewHandles";
import { ShelfItem } from "../Shelf/SessionShelf";
import {
  RevealAction,
  RevealPlayback,
} from "../Runtime/MuseumGame/RevealTransport";

export interface CaseTargetView {
  readonly targetName: string;
  readonly id: string;
  readonly caseId: string;
  readonly rev: number;
  readonly state: ShelfItem["state"];
}

/** Public investigation data only. A vault never crosses this presentation port. */
export interface PlayTableSnapshot {
  reveal?: RevealPlayback;
  flow: FlowState;
  author?: AuthorSnapshot;
  authorView?: AuthorViewSnapshot;
  detective?: DetectiveState;
  board?: Board;
  view?: CaseViewSnapshot;
}
export type FlowAction =
  | "replayAlarm"
  | "stageTheft"
  | "resumeDraft"
  | "passCase"
  | "cancelHandoff"
  | "openCase"
  | "replayEvidence"
  | "finishAttempt"
  | "selectCase"
  | "skipTutorial"
  | "repeatHelp"
  | "leaveAuthor"
  | "resumeSavedDraft"
  | "editThisCase"
  | "keepThisRoom"
  | "emptyRoom";
export type PlayTableCommand =
  | {
      action: "flow";
      payload: {
        type: FlowAction;
        id?: string;
        rev?: number;
        confirmed?: boolean;
      };
    }
  | { action: "author"; payload: AuthorCommand }
  | { action: "authorView"; payload: AuthorViewAction }
  | { action: "detective"; payload: DetectiveAction }
  | { action: "reveal"; payload: RevealAction }
  | { action: "view"; payload: CaseViewAction };
export interface PlayTablePorts {
  soundAnchor?(object: SceneObject): void;
  cancelSound?(): void;
  propMaterial?: Material;
  dispatch(action: string, payload?: unknown): void;
}

const ROLES: Role[] = ["Courier", "Guard", "Conservator"];
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
type Point = readonly [number, number, number];
interface ObjectAction {
  object: SceneObject;
  inscription: SceneObject;
  text: Text;
  input: Interactable;
  shape: BoxShape;
  label: () => string;
  active: () => boolean;
  /** Undefined for lifetime-stable stations, otherwise the owning role generation. */
  ownerEpoch?: number;
}

/** Diegetic controls live on museum objects in native story centimetres.
 * No canvas, floating title, status fascia, or head-following menu is created.
 * Only the focused object's short instruction is exposed, at its surface.
 */
export class PlayTable {
  private root: SceneObject;
  private state: PlayTableSnapshot;
  private epoch = -1;
  private signature = "";
  private stationsBuilt = false;
  private pendingRoleRebuild = false;
  private registeringRole = false;
  private registeringPublicStation = false;
  private lifecycle: ScriptComponent;
  private lifecycleUpdate: SceneEvent;
  private props: AuthorPropsHandles | undefined;
  private disposed = false;
  private dragging = false;
  private inputGeneration = 0;
  private finishingInput = false;
  private viewIdentity = "";
  private authorViewIdentity = "";
  private actions = new Map<string, ObjectAction>();
  private sceneObjects = new Map<string, SceneObject>();
  private focus: string | undefined;
  private lastUsed: string | undefined;
  private rackPage = 0;
  private observationSlots = new Map<string, ObservationContact>();

  constructor(
    private parent: SceneObject,
    private ports: PlayTablePorts,
  ) {
    this.root = global.scene.createSceneObject("MuseumObjectInteractions");
    this.root.setParent(parent);
    const theatreCenter = parent.getTransform().getLocalPosition();
    this.root
      .getTransform()
      .setLocalPosition(
        new vec3(-theatreCenter.x, -theatreCenter.y, -theatreCenter.z),
      );
    this.root.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, 0));
    this.root.getTransform().setLocalScale(new vec3(1, 1, 1));
    this.lifecycle = this.root.createComponent(
      "Component.ScriptComponent",
    ) as ScriptComponent;
    this.lifecycleUpdate = this.lifecycle.createEvent("UpdateEvent");
    this.lifecycleUpdate.bind(() => this.flushRoleRebuild());
  }

  render(snapshot: PlayTableSnapshot): void {
    if (this.disposed) return;
    const previousEpoch = this.epoch;
    snapshot = {
      ...snapshot,
      author: snapshot.flow.mode === "author" ? snapshot.author : undefined,
      authorView:
        snapshot.flow.mode === "author" ? snapshot.authorView : undefined,
      detective:
        !snapshot.reveal &&
        ["detective", "finished"].includes(snapshot.flow.mode)
          ? snapshot.detective
          : undefined,
    };
    this.state = snapshot;
    this.epoch = snapshot.flow.inputEpoch;
    const viewIdentity = snapshot.view
      ? [snapshot.view.mode, snapshot.view.caseId, snapshot.view.rev].join("|")
      : "museum";
    const authorViewIdentity = snapshot.authorView
      ? [snapshot.authorView.enabled, snapshot.authorView.generation].join("/")
      : "closed";
    const changedView = !!this.viewIdentity && viewIdentity !== this.viewIdentity;
    const changedAuthor = !!this.authorViewIdentity && authorViewIdentity !== this.authorViewIdentity;
    // Publish identity before cancellation can synchronously render changed local tools.
    this.viewIdentity = viewIdentity;
    this.authorViewIdentity = authorViewIdentity;
    if (changedView || changedAuthor) this.finishTimeDrag();
    // Evidence pages, shelf records, selection and proof results are data changes.
    // They must never replace a native Interactable that is dispatching a release.
    const signature = [
      snapshot.flow.mode,
      snapshot.flow.inputEpoch,
      snapshot.author?.draft.tracks.map((track) => track.id).join(","),
      snapshot.author?.draft.witnesses.map((source) => source.id).join(","),
      snapshot.board?.witnesses.map((source) => source.id).join(","),
      snapshot.detective?.objects.map((clue) => clue.id).join(","),
    ].join("|");
    if (!this.stationsBuilt) {
      this.buildStations();
      this.stationsBuilt = true;
      this.signature = signature;
      this.buildRoleObjects();
    } else if (signature !== this.signature) {
      this.signature = signature;
      this.pendingRoleRebuild = true;
      if (previousEpoch !== this.epoch) {
        this.dragging = false;
        this.sceneObjects.clear();
      }
    }
    this.props?.sync();
    this.updateCaseLidTarget();
    this.updateMovingTargets();
    this.updateObservationTargets();
    this.updateViewHandles();
    for (const [id, action] of this.actions) {
      action.object.enabled = action.active();
      if (action.object.enabled) action.text.text = action.label();
      action.inscription.enabled = this.focus === id && action.object.enabled;
    }
    this.updateError();
  }

  /** Finalize at the already authoritative tick, then ignore the held old input.
   * MuseumGame freezes its session afterwards. No second seek or replay occurs. */
  finishTimeDrag(): void {
    if (this.finishingInput) return;
    this.finishingInput = true;
    try {
      this.props?.cancel();
      this.inputGeneration++;
      this.dragging = false;
    } finally { this.finishingInput = false; }
  }

  readCaseTargets(): readonly CaseTargetView[] {
    const targets: CaseTargetView[] = [];
    if (!this.state) return targets;
    for (let index = 0; index < 3; index++) {
      const item = this.state.flow.shelf[this.rackPage * 3 + index],
        action = this.actions.get("CaseSpine" + index);
      if (item && action?.object.enabled && action.active())
        targets.push({
          targetName: action.object.name,
          id: item.id,
          caseId: item.id,
          rev: item.rev,
          state: item.state,
        });
    }
    return targets;
  }

  readObservationTargets(): readonly ObservationTargetView[] {
    const targets: ObservationTargetView[] = [];
    for (const [id, contact] of this.observationSlots) {
      const action = this.actions.get(id);
      if (action?.object.enabled && action.active()) {
        const focused = this.state.detective?.focusedObservation?.id;
        const selected = contact.observations.find(
          (view) => view.id === focused,
        );
        targets.push({
          targetName: action.object.name,
          observationId: (selected ?? contact.observations[0]).id,
          observationIds: contact.observations.map((view) => view.id),
          selectedObservationId: selected?.id,
        });
      }
    }
    return targets;
  }

  /** Geometry and identity come from the same public clipped observation.
   * Slots grow without replacing any previously registered native target. */
  private updateObservationTargets(): void {
    this.observationSlots.clear();
    const detective = this.state.detective;
    if (
      !detective ||
      this.state.flow.mode !== "detective" ||
      detective.mode === "reconstruction"
    )
      return;
    for (const pane of recordedPaneViews()) {
      if (
        !["PublicRecordedGlass", "EntryRecordedGlass"].includes(
          pane.root.name,
        ) ||
        !pane.root.isEnabledInHierarchy
      )
        continue;
      const contacts = observationContacts(
        pane.surfaces,
        detective.observations,
      );
      for (const contact of contacts) {
        const id = "Observation_" + pane.root.name + "_" + contact.slot;
        this.observationSlots.set(id, contact);
        if (!this.actions.has(id)) this.bindObservationTarget(id);
        const action = this.actions.get(id);
        action.shape.size = new vec3(contact.widthCm, contact.heightCm, 1.5);
        const world = pane.root
          .getTransform()
          .getWorldTransform()
          .multiplyPoint(
            new vec3(
              contact.centerCm[0],
              contact.centerCm[1],
              contact.centerCm[2] + 1,
            ),
          );
        action.object.getTransform().setWorldPosition(world);
        action.object
          .getTransform()
          .setWorldRotation(pane.root.getTransform().getWorldRotation());
        action.object
          .getTransform()
          .setWorldScale(pane.root.getTransform().getWorldScale());
        action.inscription
          .getTransform()
          .setLocalPosition(new vec3(0, contact.heightCm / 2 + 2, 1));
        action.inscription
          .getTransform()
          .setLocalRotation(quat.fromEulerAngles(0, 0, 0));
      }
    }
  }

  private bindObservationTarget(id: string): void {
    const publicRegistration = this.registeringPublicStation;
    this.registeringPublicStation = true;
    let capturedId: string | undefined;
    let capturedEpoch = -1;
    const action = this.bindObject(
      id,
      [0, 0, 0],
      [2, 3, 1.5],
      () => {
        const contact = this.observationSlots.get(id);
        if (!contact) return "";
        const focused = this.state.detective?.focusedObservation;
        const selected = contact.observations.find(
          (view) => view.id === focused?.id,
        );
        return selected
          ? observationLabel(selected) +
              " selected" +
              (contact.observations.length > 1 ? " / next mark" : "")
          : "Select " + observationLabel(contact.observations[0]);
      },
      () => {
        const contact = this.observationSlots.get(id);
        if (
          capturedEpoch === this.epoch &&
          capturedId &&
          contact?.observations.some((view) => view.id === capturedId)
        )
          this.detective({ type: "selectObservation", id: capturedId });
      },
      () => this.observationSlots.has(id),
    );
    this.registeringPublicStation = publicRegistration;
    action.text.size = 18;
    action.input.onTriggerStart.add(() => {
      const contact = this.observationSlots.get(id);
      capturedId = contact
        ? nextObservation(contact, this.state.detective?.focusedObservation?.id)
            ?.id
        : undefined;
      capturedEpoch = this.epoch;
    });
  }

  private pinLabel(): string {
    const detective = this.state.detective;
    if (detective.mode === "reconstruction") return "Back to observations";
    if (detective.focusedObservation)
      return "Pin " + observationLabel(detective.focusedObservation);
    if (
      detective.frame?.kind === "Frame" &&
      detective.observations.length > 1 &&
      !detective.focusedObservation
    )
      return "Select a visible mark";
    return "Pin evidence";
  }

  private object(name: string, position: Point): SceneObject {
    const object = global.scene.createSceneObject(name);
    object.setParent(this.root);
    object.getTransform().setLocalPosition(new vec3(...position));
    return object;
  }

  private find(name: string, parent?: SceneObject): SceneObject | undefined {
    if (!parent) {
      const cached = this.sceneObjects.get(name);
      if (cached) return cached;
      for (let index = 0; index < global.scene.getRootObjectsCount(); index++) {
        const found = this.find(name, global.scene.getRootObject(index));
        if (found) {
          this.sceneObjects.set(name, found);
          return found;
        }
      }
      return undefined;
    }
    if (parent.name === name) return parent;
    for (let index = 0; index < parent.getChildrenCount(); index++) {
      const found = this.find(name, parent.getChild(index));
      if (found) return found;
    }
    return undefined;
  }

  private anchor(name: string, fallback: Point): Point {
    const position = this.find(name)?.getTransform().getWorldPosition();
    return position ? this.storyPoint(position) : fallback;
  }

  private storyPoint(world: vec3): Point {
    const point = this.root
      .getTransform()
      .getInvertedWorldTransform()
      .multiplyPoint(world);
    return [point.x, point.y, point.z];
  }
  private storyDelta(world: vec3): vec3 {
    return this.root
      .getTransform()
      .getInvertedWorldTransform()
      .multiplyDirection(world);
  }
  private offset(point: Point, x = 0, y = 0, z = 0): Point {
    return [point[0] + x, point[1] + y, point[2] + z];
  }

  private send(action: string, payload: unknown, epoch = this.epoch): void {
    if (this.disposed || epoch !== this.state.flow.inputEpoch) return;
    const receiver = this.lastUsed ? this.actions.get(this.lastUsed)?.object : undefined;
    if (receiver) this.ports.soundAnchor?.(receiver);
    this.ports.dispatch(action, payload);
  }
  private flow(type: FlowAction, extra: object = {}): void {
    this.send("flow", { type, ...extra });
  }
  private author(command: AuthorCommand): void {
    if (this.state.flow.mode === "author") this.send("author", command);
  }
  private detective(action: DetectiveAction): void {
    if (this.state.detective) this.send("detective", action);
  }
  private reveal(action: RevealAction): void {
    if (this.state.reveal) this.send("reveal", action);
  }

  /** The hit area belongs to an actual object. Its inscription never follows the viewer. */
  private bindObject(
    id: string,
    position: Point,
    size: Point,
    label: () => string,
    invoke: () => void,
    active = () => true,
    onTop = false,
  ): ObjectAction {
    const ownerEpoch = this.registeringRole ? this.epoch : undefined;
    const ownerMode = this.registeringRole ? this.state.flow.mode : undefined;
    const publicStation = this.registeringPublicStation;
    const isPublicContext = () => {
      if (!publicStation) return true;
      if (!this.state.detective) return false;
      if (this.state.flow.mode === "detective") return true;
      return (
        this.state.flow.mode === "finished" &&
        ([
          "CompareVersions",
          "VersionFile0",
          "VersionFile1",
          "PinGlass",
        ].includes(id) ||
          id.startsWith("CaseView"))
      );
    };
    const canUse = () =>
      !this.disposed &&
      (ownerEpoch === undefined || ownerEpoch === this.epoch) &&
      (ownerMode === undefined || ownerMode === this.state.flow.mode) &&
      isPublicContext() &&
      active();
    const object = this.object("Use_" + id, position);
    const collider = object.createComponent("Physics.ColliderComponent");
    const shape = Shape.createBoxShape();
    shape.size = new vec3(...size);
    collider.shape = shape;
    const input = object.createComponent(
      Interactable.getTypeName(),
    ) as Interactable;
    input.targetingMode = 3;
    const inscription = global.scene.createSceneObject("Engraving_" + id);
    inscription.setParent(object);
    inscription
      .getTransform()
      .setLocalPosition(
        onTop
          ? new vec3(0, size[1] / 2 + 0.15, 0)
          : new vec3(0, 0, -size[2] / 2 - 0.15),
      );
    inscription
      .getTransform()
      .setLocalRotation(
        onTop
          ? quat.fromEulerAngles(-Math.PI / 2, 0, 0)
          : quat.fromEulerAngles(0, Math.PI, 0),
      );
    const text = inscription.createComponent("Component.Text");
    text.text = canUse() ? label() : "";
    text.size = size[0] < 15 ? 18 : 28;
    text.depthTest = true;
    text.horizontalAlignment = HorizontalAlignment.Center;
    text.verticalAlignment = VerticalAlignment.Center;
    const inkWidth = Math.max(12, size[0]);
    const inkHeight = Math.max(10, onTop ? size[2] : size[1]);
    text.layoutRect = Rect.create(
      -inkWidth / 2,
      inkWidth / 2,
      -inkHeight / 2,
      inkHeight / 2,
    );
    text.horizontalOverflow = HorizontalOverflow.Wrap;
    inscription.enabled = false;
    const action: ObjectAction = {
      object,
      inscription,
      text,
      input,
      shape,
      label,
      active: canUse,
      ownerEpoch,
    };
    this.actions.set(id, action);
    let capturedEpoch = -1;
    let capturedGeneration = -1;
    let dragged = false;
    input.onDragStart.add(() => {
      dragged = true;
    });
    input.onHoverEnter.add(() => {
      if (!canUse()) return;
      if (this.focus)
        this.actions.get(this.focus)?.inscription &&
          (this.actions.get(this.focus).inscription.enabled = false);
      this.focus = id;
      inscription.enabled = true;
    });
    input.onHoverExit.add(() => {
      if (this.focus === id && !this.dragging) {
        this.focus = undefined;
        inscription.enabled = false;
      }
    });
    input.onTriggerStart.add(() => {
      capturedEpoch = this.epoch;
      capturedGeneration = this.inputGeneration;
      dragged = false;
      this.lastUsed = id;
      inscription.getTransform().setLocalScale(new vec3(0.97, 0.97, 0.97));
    });
    input.onTriggerEnd.add(() => {
      inscription.getTransform().setLocalScale(new vec3(1, 1, 1));
      const acceptedRelease =
        capturedEpoch === this.epoch &&
        capturedGeneration === this.inputGeneration &&
        canUse() &&
        (!this.dragging ||
          id.startsWith("CaseView") ||
          id.startsWith("AuthorView")) &&
        !dragged;
      // Release ownership BEFORE dispatch can synchronously disable this target.
      capturedEpoch = -1;
      if (acceptedRelease) invoke();
    });
    const cancel = () => {
      const ownsCapture = capturedEpoch === this.epoch && capturedEpoch >= 0 &&
        capturedGeneration === this.inputGeneration;
      capturedEpoch = -1;
      if (ownsCapture) this.ports.cancelSound?.();
      inscription.getTransform().setLocalScale(new vec3(1, 1, 1));
    };
    input.onTriggerCanceled.add(cancel);
    input.onTriggerEndOutside.add(cancel);
    return action;
  }

  private buildStations(): void {
    const entryClock = this.anchor("Anchor_EntryClock", [360, 115, -115]);
    this.bindClock("EntryClock", entryClock);
    this.bindClock(
      "HallClock",
      this.anchor("Anchor_HallClock", [340, 100, 95]),
    );
    const bench = this.anchor("Anchor_ConservationBench", [-350, 94, 380]);
    this.bindClock("WorkshopClock", this.offset(bench, 70, 7, -20));
    this.caseRack();
    this.workbench(bench);
    this.registeringPublicStation = true;
    this.publicWorkbench(bench);
    this.viewHandles(bench);
    this.registeringPublicStation = false;
    this.installAuthorProps();
  }

  private installAuthorProps(): void {
    const material =
      this.ports.propMaterial ??
      this.propMaterial(this.find("Pedestal", this.find("DisplayCase"))) ??
      this.propMaterial(this.find("Courier"));
    if (!material)
      throw new Error(
        "Author tools need the actual display-case visual material",
      );
    this.props = new AuthorPropsHandles({
      parent: this.root,
      material,
      bind: (...args) => this.bindObject(...args),
      anchor: (name, fallback) => this.anchor(name, fallback),
      toWorld: (point) =>
        this.root
          .getTransform()
          .getWorldTransform()
          .multiplyPoint(new vec3(...point)),
      toStory: (point) => this.storyPoint(point),
      deltaToStory: (delta) => this.storyDelta(delta),
      template: (name) =>
        name === "MuseumPartitionShortTemplate"
          ? this.find(name)
          : this.find(name, this.parent),
      mode: () => this.state.flow.mode,
      scope: () => `${this.epoch}/${this.inputGeneration}`,
      read: () => this.state.author,
      author: (command) => this.author(command),
      flow: (type, confirmed) => this.flow(type, { confirmed }),
      changed: () => this.render(this.state),
    });
  }
  private propMaterial(root: SceneObject | undefined): Material | undefined {
    if (!root) return undefined;
    const visual = root.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual;
    if (visual?.mainMaterial) return visual.mainMaterial;
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const material = this.propMaterial(root.getChild(i));
      if (material) return material;
    }
    return undefined;
  }

  private buildRoleObjects(): void {
    this.registeringRole = true;
    if (this.state.author) this.authorObjects();
    if (this.state.detective && this.state.flow.mode === "detective")
      this.detectiveObjects();
    this.registeringRole = false;
  }

  /** Native event observers only request replacement. Destruction happens after
   * their dispatch stack has returned, in the next lifecycle update. */
  private flushRoleRebuild(): void {
    if (this.disposed || !this.pendingRoleRebuild || this.dragging) return;
    this.pendingRoleRebuild = false;
    for (const [id, action] of this.actions) {
      if (action.ownerEpoch === undefined) continue;
      if (this.focus === id) this.focus = undefined;
      if (this.lastUsed === id) this.lastUsed = undefined;
      this.actions.delete(id);
      action.object.destroy();
    }
    this.sceneObjects.clear();
    this.buildRoleObjects();
    this.render(this.state);
  }

  private bindClock(id: string, position: Point): void {
    const clock = this.bindObject(
      id,
      position,
      [22, 24, 8],
      () => {
        if (this.state.reveal)
          return (
            (this.state.reveal.playing ? "Pause theft " : "Play theft ") +
            (this.state.reveal.tick / 2).toFixed(1) +
            " s"
          );
        const playing =
          this.state.author?.playing ?? this.state.detective?.playing;
        const tick = this.state.author?.tick ?? this.state.detective?.tick;
        if (tick === undefined || (!playing && this.state.detective?.tick === 24))
          return "Replay from alarm";
        return (playing ? "Pause " : "Play ") + (tick / 2).toFixed(1) + " s";
      },
      () => {
        if (this.state.flow.mode === "ready") this.flow("replayAlarm");
        else if (this.state.reveal)
          this.reveal({ type: this.state.reveal.playing ? "pause" : "play" });
        else if (this.state.author)
          this.author({ kind: this.state.author.playing ? "pause" : "play" });
        else if (this.state.detective)
          this.detective({
            type: this.state.detective.playing
              ? "freeze"
              : this.state.detective.tick === 24 ? "replay" : "play",
          });
      },
      () =>
        this.state.flow.mode !== "handoff" &&
        (!!this.state.reveal ||
          this.state.flow.mode !== "finished" ||
          this.state.detective?.mode === "reconstruction"),
    );
    let startTick = 0,
      distance = 0,
      captured = -1,
      capturedGeneration = -1;
    clock.input.onDragStart.add(() => {
      captured = this.epoch;
      capturedGeneration = this.inputGeneration;
      this.dragging = true;
      distance = 0;
      startTick =
        this.state.reveal?.tick ??
        this.state.author?.tick ??
        this.state.detective?.tick ??
        12;
    });
    clock.input.onDragUpdate.add((event) => {
      if (
        captured !== this.epoch ||
        capturedGeneration !== this.inputGeneration
      )
        return;
      distance += this.storyDelta(event.dragVector).x;
      const tick = clamp(Math.round(startTick + distance / 2), 0, 24);
      if (this.state.reveal) this.reveal({ type: "seek", tick });
      else if (this.state.author) this.author({ kind: "setTick", tick });
      else this.detective({ type: "seek", tick });
      clock.text.text = (tick / 2).toFixed(1) + " s";
    });
    this.finishDrag(clock.input, () => {
      captured = -1;
    });
    this.bindObject(
      id + "Reset",
      this.offset(position, 0, -17, 0),
      [12, 6, 8],
      () => this.state.reveal ? "Replay the theft" : "Replay from alarm",
      () => this.state.reveal
        ? this.reveal({ type: "replay" })
        : this.detective({ type: "replay" }),
      () => !!this.state.reveal || (!!this.state.detective && clock.active()),
    );
    this.bindObject(
      id + "Previous",
      this.offset(position, -15, 0, 0),
      [7, 12, 8],
      () => "Previous frame",
      () => this.step(-1),
      clock.active,
    );
    this.bindObject(
      id + "Next",
      this.offset(position, 15, 0, 0),
      [7, 12, 8],
      () => "Next frame",
      () => this.step(1),
      clock.active,
    );
  }
  private step(delta: -1 | 1): void {
    if (this.state.reveal) this.reveal({ type: "step", delta });
    else if (this.state.author) this.author({ kind: "stepTick", delta });
    else this.detective({ type: "step", delta });
  }

  private caseRack(): void {
    const rack = this.anchor("Anchor_FileRack", [395, 104.2, -130]);
    this.bindObject(
      "StagingFile",
      rack,
      [13, 3, 9],
      () => "Stage a theft",
      () => this.flow("stageTheft", { confirmed: true }),
      () => ["ready", "detective"].includes(this.state.flow.mode),
      true,
    );
    for (let index = 0; index < 3; index++) {
      const itemAtSlot = () => this.state.flow.shelf[this.rackPage * 3 + index];
      let capturedCase: string | undefined;
      const spine = this.bindObject(
        "CaseSpine" + index,
        this.offset(
          rack,
          ...([
            [0, 0, -18],
            [69.5, 0, 5],
            [65, 0, -18],
          ][index] as [number, number, number]),
        ),
        index === 1 ? [4, 3, 7] : [7, 3, 7],
        () => itemAtSlot()?.spine ?? "",
        () => {
          const item = itemAtSlot();
          if (!item || capturedCase !== item.id + "/" + item.rev) return;
          if (this.state.flow.mode === "author") this.flow("leaveAuthor");
          if (["detective", "finished"].includes(this.state.flow.mode))
            this.flow("finishAttempt", { confirmed: true });
          if (item.state === "Draft")
            this.flow("resumeSavedDraft", { id: item.id });
          else {
            this.flow("selectCase", { id: item.id, rev: item.rev });
            this.flow("replayAlarm");
          }
        },
        () => !!itemAtSlot() && this.state.flow.mode !== "handoff",
        true,
      );
      spine.input.onTriggerStart.add(() => {
        const item = itemAtSlot();
        capturedCase = item ? item.id + "/" + item.rev : undefined;
      });
    }
    this.bindObject(
      "RackPage",
      this.offset(rack, 65, 0, -6),
      [7, 3, 5],
      () => "Next files",
      () => {
        this.rackPage =
          (this.rackPage + 1) % Math.ceil(this.state.flow.shelf.length / 3);
        this.render(this.state);
      },
      () => this.state.flow.shelf.length > 3,
      true,
    );
  }

  private workbench(bench: Point): void {
    this.bindObject(
      "CaseLid",
      this.offset(bench, 0, 2, -15),
      [45, 8, 32],
      () => {
        if (this.state.flow.mode === "handoff") return "Open the case";
        if (this.state.flow.mode === "finished")
          return this.state.detective
            ? "Reveal the theft"
            : "Replay the evidence";
        const author = this.state.author;
        if (author?.testing) return "Checking the recording";
        if (author?.needsAmbiguityConfirmation) return "Keep different thefts";
        if (this.state.authorView?.mode === "change" && author?.canSeal)
          return "Keep or discard this change first";
        return author?.canSeal ? "Pass the case" : "Test case";
      },
      () => {
        if (this.state.flow.mode === "handoff") this.flow("openCase");
        else if (this.state.flow.mode === "finished") {
          if (this.state.detective) this.detective({ type: "reveal" });
          else this.flow("replayEvidence");
        } else if (this.state.author) {
          if (this.state.author.needsAmbiguityConfirmation)
            this.author({ kind: "confirmAmbiguity" });
          else if (this.state.author.canSeal) {
            if (this.state.authorView?.mode !== "change") this.flow("passCase");
          } else this.author({ kind: "startTest" });
        }
      },
      () => ["author", "handoff", "finished"].includes(this.state.flow.mode),
      true,
    );
    this.bindObject(
      "UndoStamp",
      this.offset(bench, 42, 3, -20),
      [15, 8, 16],
      () => "Undo",
      () => this.author({ kind: "undo" }),
      () => !!this.state.author?.canUndo,
      true,
    );
    this.bindObject(
      "SaveFile",
      this.offset(bench, -42, 3, -20),
      [15, 8, 16],
      () =>
        this.state.flow.mode === "handoff"
          ? "Return to staging"
          : "Save to shelf",
      () => {
        if (this.state.flow.mode === "handoff") this.flow("cancelHandoff");
        else this.flow("leaveAuthor");
      },
      () => ["author", "handoff"].includes(this.state.flow.mode),
      true,
    );
    this.bindObject(
      "EditFile",
      this.offset(bench, -42, 3, -20),
      [15, 8, 16],
      () => "Edit this case",
      () => this.flow("editThisCase"),
      () => this.state.flow.mode === "finished",
      true,
    );
    this.bindObject(
      "NewFile",
      this.offset(bench, 42, 3, -20),
      [15, 8, 16],
      () => "New game",
      () => this.flow("finishAttempt", { confirmed: true }),
      () => this.state.flow.mode === "finished",
      true,
    );
    this.bindObject(
      "ReplayGlass",
      this.anchor("Anchor_PinGlass", this.offset(bench, 0, 8, -58)),
      [25, 8, 25],
      () => "Replay the evidence",
      () => this.flow("replayEvidence"),
      () => this.state.flow.mode === "finished",
      true,
    );
    this.bindObject(
      "KeepRoomFile",
      this.offset(bench, -68, 3, -20),
      [15, 8, 16],
      () => "Keep this room",
      () => this.flow("keepThisRoom"),
      () => this.state.flow.mode === "finished",
      true,
    );
  }

  private selectedTrack(): TrackId | undefined {
    const author = this.state.author;
    if (!author) return undefined;
    return (
      author.draft.tracks.find((track) => track.id === author.selected)?.id ??
      (Object.keys(author.draft.casting) as TrackId[]).find(
        (track) => author.draft.casting[track] === author.selected,
      )
    );
  }
  private pathPose(track: TrackId): Key {
    const author = this.state.author;
    const keys = author.draft.tracks.find((item) => item.id === track).keys;
    const tick = author.tick;
    const before = keys.filter((key) => key.tick <= tick).pop() ?? keys[0];
    const after = keys.find((key) => key.tick >= tick) ?? keys[keys.length - 1];
    const amount =
      after.tick === before.tick
        ? 0
        : (tick - before.tick) / (after.tick - before.tick);
    return {
      tick,
      x: before.x + (after.x - before.x) * amount,
      z: before.z + (after.z - before.z) * amount,
      yaw: before.yaw + (after.yaw - before.yaw) * amount,
    };
  }
  private authorObjects(): void {
    const author = this.state.author;
    for (const track of author.draft.tracks) this.bindActor(track.id);
    const exhibit = author.draft.room.exhibit.position;
    this.bindObject(
      "TakeRuby",
      [exhibit.x * 100, 95, exhibit.z * 100],
      [24, 20, 24],
      () => "Take ruby",
      () => {
        const track = this.selectedTrack();
        if (track)
          this.author({
            kind: "edit",
            edit: {
              kind: "stageTake",
              track,
              tick: this.state.author.tick,
            },
          });
      },
      () => !!this.selectedTrack() && !this.props?.controller.isPlacing(),
    );
    this.bindObject(
      "TouchRim",
      [exhibit.x * 100 + 20, 88, exhibit.z * 100],
      [15, 10, 20],
      () => "Touch rim",
      () => {
        const track = this.selectedTrack();
        if (track)
          this.author({
            kind: "edit",
            edit: {
              kind: "setEvent",
              event: { kind: "BrushRim", track, tick: this.state.author.tick },
            },
          });
      },
      () => !!this.selectedTrack() && !this.props?.controller.isPlacing(),
    );
    this.bindCurtain();
    for (const witness of author.draft.witnesses)
      this.bindAuthorCamera(witness.id);
    this.bindAuthorView();
    this.bindFloorPlacement();
    if (author.draft.chain)
      for (const box of author.draft.room.boxes ?? []) {
        this.bindObject(
          "Stash" + box.id,
          [box.position.x * 100, 70, box.position.z * 100],
          [35, 25, 35],
          () => "Stash ruby",
          () => {
            const carrier = this.selectedTrack();
            if (carrier)
              this.author({
                kind: "edit",
                edit: {
                  kind: "setEvent",
                  event: {
                    kind: "Stash",
                    carrier,
                    box: box.id,
                    tick: this.state.author.tick,
                  },
                },
              });
          },
          () => !!this.selectedTrack() && !this.props?.controller.isPlacing(),
        );
      }
  }

  private authorViewControl(id: string) {
    return this.state.authorView && this.state.author
      ? authorViewControls(
          this.state.authorView,
          this.state.author.draft.witnesses,
        ).find((control) => control.id === id)
      : undefined;
  }
  private bindAuthorView(): void {
    const author = this.state.author;
    if (!author) return;
    const bench = this.anchor("Anchor_ConservationBench", [-350, 94, 380]);
    const bind = (
      id: string,
      controlId: string,
      position: Point,
      size: Point,
      onTop = true,
    ) =>
      this.bindObject(
        id,
        position,
        size,
        () => this.authorViewControl(controlId)?.label ?? "",
        () => {
          const control = this.authorViewControl(controlId);
          if (!control) return;
          this.finishTimeDrag();
          this.send("authorView", control.action);
        },
        () =>
          this.state.flow.mode === "author" &&
          !!this.authorViewControl(controlId) &&
          (controlId !== "CompareThisChange" ||
            !!this.state.authorView?.canCompare),
        onTop,
      );
    for (const witness of author.draft.witnesses) {
      const watch = bind(
        "AuthorViewWatchCamera_" + witness.id,
        "WatchThisView-" + witness.id,
        this.authorWatchPosition(witness),
        [35, 22, 4],
        false,
      );
      watch.object
        .getTransform()
        .setLocalRotation(quat.fromEulerAngles(0, witness.yaw, 0));
      watch.inscription
        .getTransform()
        .setLocalPosition(new vec3(0, -13, -2.15));
      bind(
        "AuthorViewWatchBench_" + witness.id,
        "WatchThisView-" + witness.id,
        this.offset(
          bench,
          -68 + author.draft.witnesses.indexOf(witness) * 22,
          7,
          -42,
        ),
        [19, 6, 16],
      );
    }
    bind(
      "AuthorViewTryChange",
      "TryAChange",
      this.offset(bench, -26, 5, 20),
      [18, 6, 14],
    );
    bind(
      "AuthorViewCompareChange",
      "CompareThisChange",
      this.offset(bench, 0, 5, 20),
      [20, 6, 14],
    );
    bind(
      "AuthorViewKeepChange",
      "KeepThisChange",
      this.offset(bench, -26, 5, 39),
      [20, 6, 14],
    );
    bind(
      "AuthorViewDiscardChange",
      "DiscardChange",
      this.offset(bench, 0, 5, 39),
      [20, 6, 14],
    );
    bind(
      "AuthorViewBackToStage",
      "BackToStage",
      this.offset(bench, 26, 5, 20),
      [18, 6, 14],
    );
  }
  private authorWatchPosition(witness: { position: Vec3; yaw: number }): Point {
    return [
      witness.position.x * 100 - 64.2 * Math.sin(witness.yaw),
      witness.position.y * 100,
      witness.position.z * 100 - 64.2 * Math.cos(witness.yaw),
    ];
  }
  private bindAuthorCamera(id: string): void {
    const current = () =>
      this.state.author.draft.witnesses.find((witness) => witness.id === id);
    const witness = current();
    const camera = this.bindObject(
      "Record" + id,
      [
        witness.position.x * 100,
        witness.position.y * 100,
        witness.position.z * 100,
      ],
      [20, 15, 20],
      () =>
        this.state.author.recordingTrack
          ? "Finish recording"
          : this.selectedTrack()
            ? "Record movement"
            : "Turn camera",
      () => {
        if (this.state.author.recordingTrack)
          this.author({ kind: "commitGesture" });
        else {
          const track = this.selectedTrack();
          if (track) this.author({ kind: "beginRecording", track });
          else
            this.author({
              kind: "edit",
              edit: {
                kind: "setWitness",
                witness: { ...current(), yaw: current().yaw + Math.PI / 12 },
              },
            });
        }
      },
    );
    let captured = -1,
      capturedGeneration = -1,
      position = { ...witness.position };
    camera.input.onDragStart.add(() => {
      captured = this.epoch;
      capturedGeneration = this.inputGeneration;
      this.dragging = true;
      position = { ...current().position };
      this.author({ kind: "beginGesture" });
    });
    camera.input.onDragUpdate.add((event) => {
      if (
        captured !== this.epoch ||
        capturedGeneration !== this.inputGeneration
      )
        return;
      const delta = this.storyDelta(event.dragVector),
        room = this.state.author.draft.room;
      position = {
        x: clamp(position.x + delta.x / 100, 0, room.width),
        y: position.y,
        z: clamp(position.z + delta.z / 100, 0, room.depth),
      };
      this.author({
        kind: "preview",
        edit: { kind: "setWitness", witness: { ...current(), position } },
      });
      this.move("Record" + id, [
        position.x * 100,
        position.y * 100,
        position.z * 100,
      ]);
    });
    this.finishDrag(
      camera.input,
      () => {
        if (
          captured === this.epoch &&
          capturedGeneration === this.inputGeneration
        )
          this.author({ kind: "commitGesture" });
        captured = -1;
      },
      () => {
        if (
          captured === this.epoch &&
          capturedGeneration === this.inputGeneration
        )
          this.author({ kind: "cancelGesture" });
        captured = -1;
      },
    );
  }
  private bindFloorPlacement(): void {
    const room = this.state.author.draft.room;
    let floorPoint: vec3 | null = null;
    const floor = this.bindObject(
      "PathFloor",
      [room.width * 50, -1, room.depth * 50],
      [room.width * 100, 2, room.depth * 100],
      () => "",
      () => {
        const track = this.selectedTrack();
        if (!track || !floorPoint) return;
        const point = this.storyPoint(floorPoint);
        this.author({
          kind: "edit",
          edit: {
            kind: "setPathKey",
            track,
            key: {
              ...this.pathPose(track),
              x: point[0] / 100,
              z: point[2] / 100,
            },
          },
        });
      },
      () => !!this.selectedTrack() && !this.props?.controller.isPlacing(),
    );
    floor.input.onTriggerStart.add((event) => {
      floorPoint = event.interactor.targetHitPosition;
    });
  }
  private bindActor(track: TrackId): void {
    const base = this.bindObject(
      "ActorBase" + track,
      [0, 30, 0],
      [35, 60, 35],
      () => "Select " + this.state.author.draft.casting[track],
      () => this.author({ kind: "select", id: track }),
    );
    const head = this.bindObject(
      "ActorCasting" + track,
      [0, 160, 0],
      [25, 25, 25],
      () => "Change person",
      () => {
        const role = this.state.author.draft.casting[track];
        this.author({
          kind: "edit",
          edit: {
            kind: "assignRole",
            track,
            role: ROLES[(ROLES.indexOf(role) + 1) % ROLES.length],
          },
        });
      },
    );
    let origin: Key,
      dx = 0,
      dz = 0,
      captured = -1,
      capturedGeneration = -1;
    base.input.onDragStart.add(() => {
      captured = this.epoch;
      capturedGeneration = this.inputGeneration;
      this.dragging = true;
      origin = this.pathPose(track);
      dx = 0;
      dz = 0;
      if (this.state.author.selected !== track)
        this.author({ kind: "select", id: track });
      if (!this.state.author.recordingTrack)
        this.author({ kind: "beginGesture" });
    });
    base.input.onDragUpdate.add((event) => {
      if (
        captured !== this.epoch ||
        capturedGeneration !== this.inputGeneration
      )
        return;
      const movement = this.storyDelta(event.dragVector);
      dx += movement.x / 100;
      dz += movement.z / 100;
      const room = this.state.author.draft.room;
      const point = {
        ...origin,
        x: clamp(origin.x + dx, 0, room.width),
        z: clamp(origin.z + dz, 0, room.depth),
      };
      if (this.state.author.recordingTrack)
        this.author({ kind: "recordPoint", point });
      else
        this.author({
          kind: "preview",
          edit: { kind: "setPathKey", track, key: point },
        });
    });
    this.finishDrag(
      base.input,
      () => {
        if (
          captured === this.epoch &&
          capturedGeneration === this.inputGeneration
        )
          this.author({ kind: "commitGesture" });
        captured = -1;
      },
      () => {
        if (
          captured === this.epoch &&
          capturedGeneration === this.inputGeneration
        )
          this.author({ kind: "cancelGesture" });
        captured = -1;
      },
    );
    if (this.state.author.draft.chain)
      this.bindObject(
        "PassHand" + track,
        [0, 105, 0],
        [20, 20, 20],
        () => "Pass ruby",
        () => {
          const from = this.selectedTrack();
          if (from && from !== track)
            this.author({
              kind: "edit",
              edit: {
                kind: "setEvent",
                event: {
                  kind: "Pass",
                  from,
                  to: track,
                  tick: this.state.author.tick,
                },
              },
            });
        },
        () => !!this.selectedTrack() && this.selectedTrack() !== track,
      );
  }

  private bindCurtain(): void {
    const mirror = this.state.author.draft.room.mirror;
    if (!mirror) return;
    const handle = this.find("CurtainHandle")
      ?.getTransform()
      .getWorldPosition();
    const position: Point = handle
      ? this.storyPoint(handle)
      : [mirror.origin.x * 100, 115, mirror.origin.z * 100];
    const curtain = this.bindObject(
      "CurtainHandle",
      position,
      [15, 25, 15],
      () => "Move curtain",
      () =>
        this.author({
          kind: "edit",
          edit: {
            kind: "setAperture",
            aperture:
              this.state.author.draft.room.mirror.aperture > 0.5 ? 0 : 1,
          },
        }),
    );
    // The two rail end stops are the sequential equivalent of dragging the handle.
    // They share the real mirror plane and remain at fixed positions as cloth moves.
    for (const endpoint of [
      { id: "CurtainOpen", aperture: 1, side: 1, label: "Open mirror" },
      { id: "CurtainClose", aperture: 0, side: -1, label: "Close mirror" },
    ]) {
      const distance = mirror.width * 50 * endpoint.side;
      const stop: Point = [
        mirror.origin.x * 100 + mirror.right.x * distance + mirror.normal.x * 3,
        115,
        mirror.origin.z * 100 + mirror.right.z * distance + mirror.normal.z * 3,
      ];
      this.bindObject(
        endpoint.id,
        stop,
        [16, 22, 16],
        () => endpoint.label,
        () =>
          this.author({
            kind: "edit",
            edit: { kind: "setAperture", aperture: endpoint.aperture },
          }),
      );
    }
    let aperture = 0,
      captured = -1,
      capturedGeneration = -1;
    curtain.input.onDragStart.add(() => {
      captured = this.epoch;
      capturedGeneration = this.inputGeneration;
      this.dragging = true;
      aperture = this.state.author.draft.room.mirror.aperture;
      this.author({ kind: "beginGesture" });
    });
    curtain.input.onDragUpdate.add((event) => {
      if (
        captured !== this.epoch ||
        capturedGeneration !== this.inputGeneration
      )
        return;
      const rail = this.state.author?.draft.room.mirror;
      if (!rail || !(rail.width > 0)) return;
      const delta = this.storyDelta(event.dragVector);
      const alongCm = delta.x * rail.right.x + delta.y * rail.right.y + delta.z * rail.right.z;
      const next = clamp(aperture + alongCm / (rail.width * 100), 0, 1);
      if (next === aperture) return;
      aperture = next;
      this.author({ kind: "preview", edit: { kind: "setAperture", aperture } });
    });
    this.finishDrag(
      curtain.input,
      () => {
        if (
          captured === this.epoch &&
          capturedGeneration === this.inputGeneration
        )
          this.author({ kind: "commitGesture" });
        captured = -1;
      },
      () => {
        if (
          captured === this.epoch &&
          capturedGeneration === this.inputGeneration
        )
          this.author({ kind: "cancelGesture" });
        captured = -1;
      },
    );
  }

  private detectiveObjects(): void {
    const detective = this.state.detective;
    for (const witness of this.state.board?.witnesses ?? [])
      this.bindObject(
        "Source" + witness.id,
        [
          witness.position.x * 100,
          witness.position.y * 100,
          witness.position.z * 100,
        ],
        [22, 20, 22],
        () => "Watch this view",
        () => this.detective({ type: "source", source: witness.id }),
        () => this.state.detective.mode !== "reconstruction",
      );
    for (const clue of detective.objects) {
      if (clue.kind === "Box") {
        const box = this.state.board.room.boxes?.find(
          (item) => item.id === clue.box,
        );
        if (!box) continue;
        this.bindObject(
          "Inspect" + clue.id,
          [box.position.x * 100, 70, box.position.z * 100],
          [35, 25, 35],
          () => "Open " + box.id,
          () => this.detective({ type: "inspectObject", id: clue.id }),
          () => this.state.detective.mode !== "reconstruction",
        );
      } else if (clue.kind === "Rim") {
        const exhibit = this.state.board.room.exhibit.position;
        this.bindObject(
          "Inspect" + clue.id,
          [exhibit.x * 100, 88, exhibit.z * 100],
          [32, 15, 32],
          () => "Inspect rim",
          () => this.detective({ type: "inspectObject", id: clue.id }),
          () => this.state.detective.mode !== "reconstruction",
        );
      }
    }
  }

  /** Fixed glass slots and tools retain their native identity across pin, page,
   * removal, solved states and case changes. Only their current record changes. */
  private publicWorkbench(bench: Point): void {
    const loupe = this.anchor("Anchor_PinGlass", this.offset(bench, 0, 8, -58));
    this.bindObject(
      "PinGlass",
      this.anchor("Anchor_PinHandle", this.offset(loupe, 25, -0.1, -15)),
      [10, 8, 14],
      () => this.pinLabel(),
      () =>
        this.detective({
          type:
            this.state.detective.mode === "reconstruction"
              ? "returnObservations"
              : "pin",
        }),
      () =>
        !!this.state.detective.frame ||
        this.state.detective.mode === "reconstruction",
      true,
    );
    const entryPin = this.bindObject(
      "EntryPinGlass",
      this.anchor("Anchor_EntryPinClip", [402.5, 108.5096, -173.8743]),
      [3, 5, 3],
      () => this.pinLabel(),
      () => this.detective({ type: "pin" }),
      () =>
        !!this.state.detective.frame &&
        this.state.detective.mode !== "reconstruction",
    );
    const clipAnchor = this.find("Anchor_EntryPinClip");
    if (clipAnchor)
      entryPin.object
        .getTransform()
        .setWorldRotation(clipAnchor.getTransform().getWorldRotation());
    entryPin.inscription
      .getTransform()
      .setLocalRotation(quat.fromEulerAngles(0, 0, 0));
    entryPin.inscription.getTransform().setLocalPosition(new vec3(0, 0, 1.7));
    for (let index = 0; index < 3; index++) {
      const glassAtSlot = () => this.state.detective?.visibleGlass[index];
      let capturedGlass: string | undefined;
      const glassTarget = this.bindObject(
        "Evidence" + index,
        this.offset(bench, -24 + index * 24, 4, -42),
        [20, 5, 18],
        () => {
          const glass = glassAtSlot();
          return glass ? this.clueLabel(glass.clue) : "";
        },
        () => {
          const glass = glassAtSlot();
          if (glass && glass.id === capturedGlass)
            this.detective({ type: "selectClue", id: glass.id });
        },
        () => !!glassAtSlot() && this.state.detective.mode !== "reconstruction",
        true,
      );
      glassTarget.input.onTriggerStart.add(() => {
        capturedGlass = glassAtSlot()?.id;
      });
    }
    this.bindObject(
      "MoreEvidence",
      this.offset(bench, 52, 4, -42),
      [12, 5, 18],
      () => "Next evidence",
      () => this.detective({ type: "tabPage", delta: 1 }),
      () =>
        this.state.detective.glass.length > 3 &&
        this.state.detective.mode !== "reconstruction",
      true,
    );
    this.bindObject(
      "RemoveEvidence",
      this.offset(bench, 52, 4, -62),
      [15, 5, 15],
      () => "Remove evidence",
      () => this.detective({ type: "remove" }),
      () =>
        this.state.detective.glass.some(
          (glass) => glass.id === this.state.detective.selected,
        ),
      true,
    );
    this.bindObject(
      "UndoEvidence",
      this.offset(bench, 42, 3, -20),
      [15, 8, 16],
      () => "Undo evidence removal",
      () => this.detective({ type: "undo" }),
      () => this.state.detective.canUndoEvidence,
      true,
    );
    this.bindObject(
      "LoupeDetail",
      this.offset(loupe, -11, 1, 0),
      [5, 5, 5],
      () =>
        recordingDetailEnabled("PublicRecordedGlass")
          ? "Show all marks"
          : "Enlarge selected mark",
      () => {
        toggleRecordingDetail("PublicRecordedGlass");
        this.render(this.state);
      },
      () =>
        this.state.detective.mode !== "reconstruction" &&
        (recordingDetailEnabled("PublicRecordedGlass") ||
          !!this.state.detective.focusedObservation),
      true,
    );
    this.findingObjects(bench);
  }

  private findingObjects(bench: Point): void {
    ROLES.forEach((role, index) =>
      this.bindObject(
        "Suspect" + role,
        this.offset(bench, -24 + index * 24, 5, 6),
        [19, 5, 22],
        () => role,
        () => {
          const field = this.state.detective.selectedField;
          if (field !== "cache")
            this.detective({ type: "claimField", field, value: role });
        },
        () =>
          this.state.detective.mode !== "reconstruction" &&
          this.state.detective.selectedField !== "cache",
        true,
      ),
    );
    const fields: Field[] = [
      "taker",
      "recipient",
      "cache",
      "takeTick",
      "passTick",
      "stashTick",
    ];
    fields.forEach((field, index) =>
      this.bindObject(
        "Finding" + field,
        this.offset(bench, -60, 5, -35 + index * 20),
        [20, 5, 17],
        () => this.fieldLabel(field),
        () => this.detective({ type: "selectField", field }),
        () =>
          this.state.detective.questionFields.includes(field) &&
          this.state.detective.mode !== "reconstruction",
        true,
      ),
    );
    for (let index = 0; index < 2; index++) {
      const boxAtSlot = () => this.state.board?.room.boxes?.[index];
      this.bindObject(
        "CacheChoice" + index,
        this.offset(bench, -15 + index * 30, 5, 6),
        [25, 5, 22],
        () => boxAtSlot()?.id ?? "",
        () => {
          const box = boxAtSlot();
          if (box)
            this.detective({
              type: "claimField",
              field: "cache",
              value: box.id,
            });
        },
        () =>
          !!boxAtSlot() &&
          this.state.detective.selectedField === "cache" &&
          this.state.detective.mode !== "reconstruction",
        true,
      );
    }
    this.bindObject(
      "UnknownFinding",
      this.offset(bench, 52, 5, 6),
      [20, 5, 22],
      () => "Could be either",
      () =>
        this.detective({
          type: "claimField",
          field: this.state.detective.selectedField,
          value: "Underdetermined",
        }),
      () => this.state.detective.mode !== "reconstruction",
      true,
    );
    this.bindObject(
      "CheckStamp",
      this.offset(bench, 0, 7, 38),
      [27, 9, 20],
      () =>
        this.state.detective.checking
          ? "Checking the evidence"
          : this.state.detective.verdict
            ? this.state.detective.message
            : "Check accusation",
      () => this.detective({ type: "check" }),
      () =>
        this.state.detective.mode !== "reconstruction" &&
        !this.state.detective.checking,
      true,
    );
    for (let index = 0; index < 2; index++) {
      this.bindObject(
        "VersionFile" + index,
        this.offset(bench, index === 0 ? -52 : 52, 5, 38),
        [20, 5, 20],
        () => this.versionLabel(index),
        () => this.versionAction(index),
        () => this.hasVersion(index) && (index !== 0 || !this.canCompare()),
        true,
      );
    }
    this.bindObject(
      "CompareVersions",
      this.offset(bench, -52, 5, 38),
      [20, 5, 20],
      () => "Compare reconstructions",
      () =>
        this.detective({
          type: "compareVersions",
          field: this.state.detective.selectedField,
        }),
      () => this.canCompare(),
      true,
    );
    this.bindObject(
      "NoneFinding",
      this.offset(bench, 52, 5, -14),
      [20, 5, 17],
      () => "None",
      () =>
        this.detective({
          type: "claimField",
          field: this.state.detective.selectedField,
          value: "None",
        }),
      () =>
        this.state.detective.selectedField !== "taker" &&
        this.state.detective.mode !== "reconstruction",
      true,
    );
  }
  private canCompare(): boolean {
    const detective = this.state.detective;
    if (!detective?.verdict) return false;
    return detective.selectedField === "taker"
      ? detective.verdict.possibleCulprits.length > 1
      : (detective.verdict.examplesByField[detective.selectedField]?.length ??
          0) > 1;
  }

  private viewHandles(bench: Point): void {
    const positions: Record<string, Point> = {
      CaseViewHandle: this.offset(bench, 0, 7, -29),
      CaseViewSeated: this.offset(bench, -13, 7, -15),
      CaseViewStanding: this.offset(bench, 13, 7, -15),
      CaseViewClose: this.offset(bench, 0, 7, 3),
      CaseViewBack: this.offset(bench, -14, 7, -15),
    };
    for (const id of Object.keys(positions)) {
      const control = () =>
        this.state.view
          ? caseViewControls(this.state.view).find(
              (control) => control.id === id,
            )
          : undefined;
      this.bindObject(
        id,
        positions[id],
        id === "CaseViewHandle"
          ? [18, 8, 8]
          : id === "CaseViewClose"
            ? [10, 8, 8]
            : [18, 8, 14],
        () => control()?.label ?? "",
        () => {
          const action = control()?.action;
          if (action) {
            this.finishTimeDrag();
            this.send("view", action);
          }
        },
        () => !!control(),
        true,
      );
    }
  }

  private updateViewHandles(): void {
    const bench = this.anchor("Anchor_ConservationBench", [-350, 94, 380]);
    const transform = this.root.getTransform().getWorldTransform();
    const position = transform.multiplyPoint(new vec3(...bench));
    const forward = transform.multiplyDirection(new vec3(0, 0, 1));
    const slots = caseViewHandleSlots(this.state.view, {
      originCm: [position.x, position.y, position.z],
      scale: 1,
      yawRad: Math.atan2(forward.x, forward.z),
    });
    for (const slot of slots) {
      const action = this.actions.get(slot.id);
      if (!action) continue;
      const dynamic =
        this.state.view?.mode === "room" || this.state.view?.mode === "table";
      const size: Point = dynamic
        ? slot.id === "CaseViewStanding"
          ? [24, 10, 8]
          : [22, 10, 8]
        : slot.id === "CaseViewHandle"
          ? [18, 8, 8]
          : slot.id === "CaseViewClose"
            ? [10, 8, 8]
            : [18, 8, 14];
      action.shape.size = new vec3(...size);
      action.object
        .getTransform()
        .setWorldPosition(new vec3(...slot.placement.originCm));
      action.object
        .getTransform()
        .setWorldRotation(quat.fromEulerAngles(0, slot.placement.yawRad, 0));
      action.object.getTransform().setWorldScale(new vec3(1, 1, 1));
      action.inscription
        .getTransform()
        .setLocalRotation(
          slot.kind === "tab"
            ? quat.fromEulerAngles(-Math.PI / 2, 0, 0)
            : quat.fromEulerAngles(0, Math.PI, 0),
        );
      action.inscription
        .getTransform()
        .setLocalPosition(
          slot.kind === "tab"
            ? new vec3(0, size[1] / 2 + 0.15, 0)
            : new vec3(0, 0, -size[2] / 2 - 0.15),
        );
    }
  }

  private hasVersion(index: number): boolean {
    const detective = this.state.detective;
    if (!detective.verdict) return false;
    return detective.selectedField === "taker"
      ? detective.verdict.possibleCulprits.length > index
      : (detective.verdict.examplesByField[detective.selectedField]?.length ??
          0) > index;
  }
  private versionLabel(index: number): string {
    const detective = this.state.detective;
    const role =
      detective.selectedField === "taker"
        ? detective.verdict?.possibleCulprits[index]
        : undefined;
    return role ? "See " + role + " version" : "See this version";
  }
  private fieldLabel(field: Field): string {
    const labels: Record<Field, string> = {
      taker: "Who took it",
      recipient: "Who received it",
      cache: "Where is it",
      takeTick: "Time taken",
      passTick: "Time passed",
      stashTick: "Time hidden",
    };
    return labels[field];
  }
  private versionAction(index: number): void {
    const detective = this.state.detective;
    const field = detective.selectedField;
    if (field !== "taker")
      this.detective({ type: "versionField", field, index });
    else {
      const role = detective.verdict?.possibleCulprits[index];
      if (role) this.detective({ type: "version", role });
    }
  }
  private clueLabel(clue: Clue): string {
    if (clue.kind === "Frame") {
      const fragment =
        clue.payload.fragments.length === 1
          ? clue.payload.fragments[0]
          : undefined;
      const mark = fragment
        ? (fragment.role ?? "Unidentified mark") +
          (fragment.via === "mirror" ? " in mirror" : "")
        : "Recording";
      return (
        mark + "\n" + clue.witness + " " + (clue.tick / 2).toFixed(1) + " s"
      );
    }
    if (clue.kind === "Rim") return "Rim mark";
    return clue.box;
  }

  /** Follow the actual hinged panel, including the building's world placement.
   * Its authored mesh uses metre vertices under an import scale; these collider
   * dimensions are the resulting physical centimetres, not that import scale. */
  private updateCaseLidTarget(): void {
    const action = this.actions.get("CaseLid");
    const surface = this.find("CaseLidSurface");
    if (!action || !surface) return;
    const physical = surface.getTransform();
    const target = action.object.getTransform();
    target.setWorldPosition(physical.getWorldPosition());
    target.setWorldRotation(physical.getWorldRotation());
    target.setWorldScale(new vec3(1, 1, 1));
    action.shape.size = new vec3(45, 2.5, 32);
    action.inscription.getTransform().setLocalPosition(new vec3(0, 1.4, 0));
  }

  private updateMovingTargets(): void {
    const propDisplay = this.state.author?.draft.room.exhibit.position;
    if (propDisplay)
      this.move("TakeRuby", [propDisplay.x * 100, 95, propDisplay.z * 100]);
    if (!this.state.author) return;
    for (const track of this.state.author.draft.tracks) {
      const pose = this.pathPose(track.id);
      this.move("ActorBase" + track.id, [pose.x * 100, 30, pose.z * 100]);
      this.move("ActorCasting" + track.id, [pose.x * 100, 160, pose.z * 100]);
      const role = this.state.author.draft.casting[track.id];
      const theatre = this.find("Theatre");
      const actor = theatre ? this.find(role, theatre) : undefined;
      const hand = actor
        ? this.find("Hand_R", actor)?.getTransform().getWorldPosition()
        : undefined;
      this.move(
        "PassHand" + track.id,
        hand ? this.storyPoint(hand) : [pose.x * 100 + 20, 105, pose.z * 100],
      );
    }
    for (const witness of this.state.author.draft.witnesses) {
      this.move(
        "AuthorViewWatchCamera_" + witness.id,
        this.authorWatchPosition(witness),
      );
      this.actions
        .get("AuthorViewWatchCamera_" + witness.id)
        ?.object.getTransform()
        .setLocalRotation(quat.fromEulerAngles(0, witness.yaw, 0));
      this.move("Record" + witness.id, [
        witness.position.x * 100,
        witness.position.y * 100,
        witness.position.z * 100,
      ]);
    }
    const handle = this.find("CurtainHandle")
      ?.getTransform()
      .getWorldPosition();
    if (handle) this.move("CurtainHandle", this.storyPoint(handle));
  }
  private move(id: string, position: Point): void {
    this.actions
      .get(id)
      ?.object.getTransform()
      .setLocalPosition(new vec3(...position));
  }
  private finishDrag(
    input: Interactable,
    commit: () => void,
    cancel = commit,
  ): void {
    let dragEpoch = -1, dragGeneration = -1;
    input.onDragStart.add(() => {
      dragEpoch = this.epoch; dragGeneration = this.inputGeneration;
    });
    const takeDrag = () => {
      const owned = dragEpoch === this.epoch && dragEpoch >= 0 && dragGeneration === this.inputGeneration;
      dragEpoch = -1;
      return owned;
    };
    input.onDragEnd.add(() => {
      if (!takeDrag()) return;
      commit();
      this.dragging = false;
    });
    const cancelDrag = () => {
      if (!takeDrag()) return;
      this.ports.cancelSound?.();
      cancel();
      this.dragging = false;
    };
    input.onTriggerCanceled.add(cancelDrag);
    input.onTriggerEndOutside.add(cancelDrag);
  }
  private updateError(): void {
    const error = this.state.author?.errors[0]?.message;
    if (error && this.lastUsed) {
      const id =
        this.lastUsed === "PathFloor" && this.selectedTrack()
          ? "ActorBase" + this.selectedTrack()
          : this.lastUsed;
      const action = this.actions.get(id);
      if (action) {
        action.text.text = error;
        action.inscription.enabled = true;
      }
    }
  }
  private clear(): void {
    this.dragging = false;
    this.focus = undefined;
    this.lastUsed = undefined;
    this.actions.clear();
    this.sceneObjects.clear();
    while (this.root.getChildrenCount()) this.root.getChild(0).destroy();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.props?.dispose();
    this.lifecycle.removeEvent(this.lifecycleUpdate);
    this.clear();
    this.root.destroy();
  }
}
