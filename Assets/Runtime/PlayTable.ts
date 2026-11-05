import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { AuthorSnapshot } from "../Author/AuthorSession";
import { AuthorCommand } from "../Author/AuthorController";
import { DetectiveState, DetectiveAction } from "../Detective/DetectiveSession";
import { FlowState } from "../Cases/CaseFlow";
import { Board, Clue, Field, Role, TrackId, Key, Vec3 } from "../Domain/types";

/** Public investigation data only. A vault never crosses this presentation port. */
export interface PlayTableSnapshot {
  flow: FlowState;
  author?: AuthorSnapshot;
  detective?: DetectiveState;
  board?: Board;
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
  | { action: "detective"; payload: DetectiveAction };
export interface PlayTablePorts {
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
  label: () => string;
  active: () => boolean;
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
  private disposed = false;
  private dragging = false;
  private actions = new Map<string, ObjectAction>();
  private sceneObjects = new Map<string, SceneObject>();
  private focus: string | undefined;
  private lastUsed: string | undefined;
  private rackPage = 0;

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
  }

  render(snapshot: PlayTableSnapshot): void {
    if (this.disposed) return;
    const previousEpoch = this.epoch;
    snapshot = {
      ...snapshot,
      author: snapshot.flow.mode === "author" ? snapshot.author : undefined,
      detective: ["detective", "finished"].includes(snapshot.flow.mode)
        ? snapshot.detective
        : undefined,
    };
    this.state = snapshot;
    this.epoch = snapshot.flow.inputEpoch;
    const signature = [
      snapshot.flow.mode,
      snapshot.flow.inputEpoch,
      snapshot.flow.shelf.map((item) => `${item.id}/${item.rev}`).join(","),
      snapshot.author?.draft.tracks.map((track) => track.id).join(","),
      snapshot.author?.draft.witnesses.map((source) => source.id).join(","),
      snapshot.detective?.visibleGlass.map((glass) => glass.id).join(","),
      snapshot.detective?.objects.map((clue) => clue.id).join(","),
      snapshot.detective?.questionFields.join(","),
      this.rackPage,
    ].join("|");
    if (
      previousEpoch !== this.epoch ||
      (signature !== this.signature && !this.dragging)
    ) {
      this.clear();
      this.signature = signature;
      this.build();
    }
    this.updateMovingTargets();
    for (const [id, action] of this.actions) {
      action.object.enabled = action.active();
      action.text.text = action.label();
      action.inscription.enabled = this.focus === id && action.object.enabled;
    }
    this.updateError();
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
    text.text = label();
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
    const action = { object, inscription, text, input, label, active };
    this.actions.set(id, action);
    let capturedEpoch = -1;
    let dragged = false;
    input.onDragStart.add(() => {
      dragged = true;
    });
    input.onHoverEnter.add(() => {
      if (!active()) return;
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
      dragged = false;
      this.lastUsed = id;
      inscription.getTransform().setLocalScale(new vec3(0.97, 0.97, 0.97));
    });
    input.onTriggerEnd.add(() => {
      inscription.getTransform().setLocalScale(new vec3(1, 1, 1));
      if (
        capturedEpoch === this.epoch &&
        active() &&
        !this.dragging &&
        !dragged
      )
        invoke();
      capturedEpoch = -1;
    });
    const cancel = () => {
      capturedEpoch = -1;
      inscription.getTransform().setLocalScale(new vec3(1, 1, 1));
    };
    input.onTriggerCanceled.add(cancel);
    input.onTriggerEndOutside.add(cancel);
    return action;
  }

  private build(): void {
    const entryClock = this.anchor("Anchor_EntryClock", [490, 115, -240]);
    this.bindClock("EntryClock", entryClock);
    const hallClock = this.anchor("Anchor_HallClock", [340, 100, 95]);
    this.bindClock("HallClock", hallClock);
    const bench = this.anchor("Anchor_ConservationBench", [-350, 94, 380]);
    this.bindClock("WorkshopClock", this.offset(bench, 70, 7, -20));
    this.caseRack();
    this.workbench(bench);
    if (this.state.author) this.authorObjects();
    if (this.state.detective && this.state.flow.mode === "detective")
      this.detectiveObjects(bench);
  }

  private bindClock(id: string, position: Point): void {
    const clock = this.bindObject(
      id,
      position,
      [22, 24, 8],
      () => {
        const playing =
          this.state.author?.playing ?? this.state.detective?.playing;
        const tick = this.state.author?.tick ?? this.state.detective?.tick;
        return playing && tick !== undefined
          ? "Pause " + (tick / 2).toFixed(1) + " s"
          : "Replay the alarm";
      },
      () => {
        if (this.state.flow.mode === "ready") this.flow("replayAlarm");
        else if (this.state.author)
          this.author({ kind: this.state.author.playing ? "pause" : "play" });
        else if (this.state.detective)
          this.detective({
            type: this.state.detective.playing ? "freeze" : "replay",
          });
      },
      () =>
        this.state.flow.mode !== "handoff" &&
        this.state.flow.mode !== "finished",
    );
    let startTick = 0,
      distance = 0,
      captured = -1;
    clock.input.onDragStart.add(() => {
      captured = this.epoch;
      this.dragging = true;
      distance = 0;
      startTick = this.state.author?.tick ?? this.state.detective?.tick ?? 12;
    });
    clock.input.onDragUpdate.add((event) => {
      if (captured !== this.epoch) return;
      distance += this.storyDelta(event.dragVector).x;
      const tick = clamp(Math.round(startTick + distance / 2), 0, 24);
      if (this.state.author) this.author({ kind: "setTick", tick });
      else this.detective({ type: "seek", tick });
      clock.text.text = (tick / 2).toFixed(1) + " s";
    });
    this.finishDrag(clock.input, () => {
      captured = -1;
    });
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
    if (this.state.author) this.author({ kind: "stepTick", delta });
    else this.detective({ type: "step", delta });
  }

  private caseRack(): void {
    const rack = this.anchor("Anchor_FileRack", [555, 102, -260]);
    this.bindObject(
      "StagingFile",
      this.offset(rack, -16, 0, 0),
      [13, 18, 9],
      () => "Stage a theft",
      () => this.flow("stageTheft", { confirmed: true }),
      () => ["ready", "detective"].includes(this.state.flow.mode),
    );
    const items = this.state.flow.shelf;
    items
      .slice(this.rackPage * 3, this.rackPage * 3 + 3)
      .forEach((item, index) => {
        this.bindObject(
          "CaseSpine" + index,
          this.offset(rack, index * 9, 0, 0),
          [7, 18, 9],
          () => item.spine,
          () => {
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
          () => this.state.flow.mode !== "handoff",
        );
      });
    if (items.length > 3)
      this.bindObject(
        "RackPage",
        this.offset(rack, 35, 0, 0),
        [10, 18, 9],
        () => "Next files",
        () => {
          this.rackPage = (this.rackPage + 1) % Math.ceil(items.length / 3);
          this.signature = "";
          this.render(this.state);
        },
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
          else if (this.state.author.canSeal) this.flow("passCase");
          else this.author({ kind: "startTest" });
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
              kind: "setEvent",
              event: { kind: "Take", track, tick: this.state.author.tick },
            },
          });
      },
      () => !!this.selectedTrack(),
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
      () => !!this.selectedTrack(),
    );
    this.bindCurtain();
    for (const witness of author.draft.witnesses)
      this.bindAuthorCamera(witness.id);
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
          () => !!this.selectedTrack(),
        );
      }
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
      position = { ...witness.position };
    camera.input.onDragStart.add(() => {
      captured = this.epoch;
      this.dragging = true;
      position = { ...current().position };
      this.author({ kind: "beginGesture" });
    });
    camera.input.onDragUpdate.add((event) => {
      if (captured !== this.epoch) return;
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
        if (captured === this.epoch) this.author({ kind: "commitGesture" });
        captured = -1;
      },
      () => {
        if (captured === this.epoch) this.author({ kind: "cancelGesture" });
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
      () => !!this.selectedTrack(),
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
      captured = -1;
    base.input.onDragStart.add(() => {
      captured = this.epoch;
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
      if (captured !== this.epoch) return;
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
        if (captured === this.epoch) this.author({ kind: "commitGesture" });
        captured = -1;
      },
      () => {
        if (captured === this.epoch) this.author({ kind: "cancelGesture" });
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
    let aperture = 0,
      captured = -1;
    curtain.input.onDragStart.add(() => {
      captured = this.epoch;
      this.dragging = true;
      aperture = this.state.author.draft.room.mirror.aperture;
      this.author({ kind: "beginGesture" });
    });
    curtain.input.onDragUpdate.add((event) => {
      if (captured !== this.epoch) return;
      aperture = clamp(
        aperture + this.storyDelta(event.dragVector).x / 100,
        0,
        1,
      );
      this.author({ kind: "preview", edit: { kind: "setAperture", aperture } });
    });
    this.finishDrag(
      curtain.input,
      () => {
        if (captured === this.epoch) this.author({ kind: "commitGesture" });
        captured = -1;
      },
      () => {
        if (captured === this.epoch) this.author({ kind: "cancelGesture" });
        captured = -1;
      },
    );
  }

  private detectiveObjects(bench: Point): void {
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
    const loupe = this.anchor("Anchor_PinGlass", this.offset(bench, 0, 8, -58));
    this.bindObject(
      "PinGlass",
      loupe,
      [25, 8, 25],
      () =>
        this.state.detective.mode === "reconstruction"
          ? "Back to observations"
          : "Pin evidence",
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
    detective.visibleGlass.forEach((glass, index) =>
      this.bindObject(
        "Evidence" + index,
        this.offset(bench, -24 + index * 24, 4, -42),
        [20, 5, 18],
        () => this.clueLabel(glass.clue),
        () => this.detective({ type: "selectClue", id: glass.id }),
        () => this.state.detective.mode !== "reconstruction",
        true,
      ),
    );
    if (detective.glass.length > 3)
      this.bindObject(
        "MoreEvidence",
        this.offset(bench, 52, 4, -42),
        [12, 5, 18],
        () => "Next evidence",
        () => this.detective({ type: "tabPage", delta: 1 }),
        () => this.state.detective.mode !== "reconstruction",
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
    this.state.detective.questionFields.forEach((field, index) =>
      this.bindObject(
        "Finding" + field,
        this.offset(bench, -60, 5, -35 + index * 20),
        [20, 5, 17],
        () => this.fieldLabel(field),
        () => this.detective({ type: "selectField", field }),
        () => this.state.detective.mode !== "reconstruction",
        true,
      ),
    );
    for (const [index, box] of (this.state.board.room.boxes ?? []).entries())
      this.bindObject(
        "CacheChoice" + box.id,
        this.offset(bench, -15 + index * 30, 5, 6),
        [25, 5, 22],
        () => box.id,
        () =>
          this.detective({ type: "claimField", field: "cache", value: box.id }),
        () =>
          this.state.detective.selectedField === "cache" &&
          this.state.detective.mode !== "reconstruction",
        true,
      );
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
        () => this.hasVersion(index),
        true,
      );
    }
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
    if (clue.kind === "Frame")
      return clue.witness + " " + (clue.tick / 2).toFixed(1) + " s";
    if (clue.kind === "Rim") return "Rim mark";
    return clue.box;
  }

  private updateMovingTargets(): void {
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
    input.onDragEnd.add(() => {
      commit();
      this.dragging = false;
    });
    input.onTriggerCanceled.add(() => {
      cancel();
      this.dragging = false;
    });
    input.onTriggerEndOutside.add(() => {
      cancel();
      this.dragging = false;
    });
  }
  private updateError(): void {
    const error = this.state.author?.errors[0]?.message;
    if (error && this.lastUsed) {
      const action = this.actions.get(this.lastUsed);
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
    this.clear();
    this.root.destroy();
  }
}
