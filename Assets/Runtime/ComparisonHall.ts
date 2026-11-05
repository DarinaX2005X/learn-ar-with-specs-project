import { Board, Field, History, WitnessTape, Vec3 } from "../Domain/types";
import { answer, compareObservations, observe } from "../Domain/observe";
import { reconstructionIssue } from "../Detective/Reconstruction";
import {
  SpatialContext,
  SpatialStage,
  Placement,
} from "../Spatial/SpatialStage";
import { ActionPose } from "../Spatial/Reconstruction";
import { LensArmAdapter } from "../Spatial/ArmIK";
import { TABLEKIT_MODEL_TO_STORY } from "../Spatial/TheatreMount";
import { ActorPose, Role, TableKit } from "../Scripts/TableKit/TableKit";

export interface ComparisonRequest {
  pair: readonly [History, History];
  scope: "all" | "selected";
  field: Field;
  /** Original public evidence, never assembled from the currently visible frame. */
  tape: WitnessTape;
}
export interface ComparisonCaseView {
  kind: "table" | "room";
  /** Story board minimum-floor origin, world centimetres. */
  placement: Placement;
}
export interface ComparisonHallOptions {
  finishTimeDrag?(): void;
  stopSound?(): void;
  reportIssue?(message: string): void;
}
interface NativeWing {
  root: SceneObject;
  geometry: SceneObject;
  actors: Map<Role, SceneObject>;
  arms: Map<Role, LensArmAdapter<vec3, quat>>;
  poses: Map<Role, ActorPose>;
  ruby: SceneObject;
  label: SceneObject;
  inscription: Text;
  kit: TableKit;
}
const ROLES: Role[] = ["Courier", "Guard", "Conservator"];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const modelPoint = (point: readonly number[]): vec3 =>
  new vec3(point[0] * 0.06, point[1] * 0.06, point[2] * 0.06);

/** Two possible plays on one physical conservation bench. No camera, case flow,
 * vault, recording renderer, independent clock or input singleton is owned here.
 * MuseumScene calls sync only for an explicitly chosen public comparison and
 * hides its ordinary live actors while this returns true. Its existing recorded
 * pane continues rendering the original WitnessTape at the same clock tick.
 */
export class ComparisonHall {
  private stage?: SpatialStage;
  private common?: SceneObject;
  private wings: NativeWing[] = [];
  private board?: Board;
  private request?: ComparisonRequest;
  private context?: SpatialContext;
  private entered?: SpatialContext;
  private presentation?: ComparisonCaseView;
  private identity = "";
  private issue?: string;
  private disposed = false;
  private roomMode = false;
  // Two 70 x 50 cm gallery studies fit the existing 240 x 150 cm workbench.
  private readonly benchScale = 0.1;
  private readonly gapCm = 12;

  constructor(
    private parent: SceneObject,
    private material: Material,
    private options: ComparisonHallOptions = {},
  ) {}

  sync(
    board: Board | undefined,
    request: ComparisonRequest | undefined,
    context?: SpatialContext,
  ): boolean {
    if (this.disposed) return false;
    if (!board || !request || !context) {
      this.exit();
      return false;
    }
    if (
      !Number.isFinite(context.tick) ||
      !board.witnesses.some((w) => w.id === context.witnessId)
    ) {
      this.reject("Choose an available recording and time");
      return false;
    }
    const identity = JSON.stringify({
      caseId: board.caseId,
      rev: board.rev,
      pair: request.pair,
      field: request.field,
      scope: request.scope,
      ids:
        request.scope === "selected"
          ? [...new Set(context.selectedIds)].sort()
          : [],
    });
    if (identity !== this.identity) {
      const problem = this.validate(board, request, context.selectedIds);
      if (problem) {
        this.reject(problem);
        return false;
      }
      this.exit();
      this.board = copy(board);
      this.request = copy(request);
      this.context = copy(context);
      this.entered = copy(context);
      if (!this.mount()) {
        this.reject("The comparison bench or its case models are unavailable");
        return false;
      }
      this.identity = identity;
      this.stage!.setVersions(this.request.pair, this.request.scope, true);
    }
    this.context = copy(context);
    this.context.tick = Math.max(0, Math.min(24, context.tick));
    this.stage!.syncContext(this.context);
    return true;
  }

  private validate(
    board: Board,
    request: ComparisonRequest,
    selected: readonly string[],
  ): string | undefined {
    if (
      !board.fields.includes(request.field) ||
      !["all", "selected"].includes(request.scope)
    )
      return "Choose a question from this case";
    if (
      !request.tape ||
      request.tape.caseId !== board.caseId ||
      request.tape.rev !== board.rev
    )
      return "These versions belong to a different case revision";
    if (!Array.isArray(request.pair) || request.pair.length !== 2)
      return "Choose two compatible versions";
    for (const history of request.pair) {
      const issue = reconstructionIssue(board, history);
      if (issue) return issue;
      const candidate = observe(board, history);
      if (
        compareObservations(
          request.tape,
          candidate,
          request.scope === "all" ? undefined : selected,
        ).length
      )
        return "This version does not fit the chosen evidence";
    }
    if (
      answer(board, request.pair[0], request.field) ===
      answer(board, request.pair[1], request.field)
    )
      return "Choose versions with different answers to this question";
    return undefined;
  }

  /** CaseViewRouting supplies a stable relocation. No camera writes or flights. */
  applyCaseView(presentation: ComparisonCaseView | undefined): void {
    this.presentation = presentation ? copy(presentation) : undefined;
    this.roomMode = presentation?.kind === "room";
    if (this.roomMode) this.stage?.render();
    else this.stage?.backToTable();
  }
  /** Fractional pose from the session's existing playback clock. This never
   * advances logical time, records a frame, selects evidence or starts a clock. */
  presentPose(tick: number): void {
    if (!this.stage || !this.context || !Number.isFinite(tick)) return;
    this.context.tick = Math.max(0, Math.min(24, tick));
    this.stage.syncContext(this.context);
  }
  setVersion(index: number): void {
    if (index !== 0 && index !== 1) return;
    if (this.context) this.context.versionIndex = index;
    this.stage?.setVersion(index);
  }
  enterRoom(eye: Vec3, forward: Vec3): void {
    if (!this.stage || !this.context) return;
    this.presentation = undefined;
    this.roomMode = true;
    this.stage.enterRoom(eye, forward, () => copy(this.context!));
  }
  backToTable(): SpatialContext | undefined {
    this.roomMode = false;
    this.presentation = undefined;
    return this.stage?.backToTable();
  }
  snapshot(): SpatialContext | undefined {
    return this.stage?.snapshot();
  }
  read() {
    return {
      active: !!this.stage,
      caseId: this.board?.caseId,
      rev: this.board?.rev,
      tick: this.context?.tick,
      field: this.request?.field,
      scope: this.request?.scope,
      visibleWings: this.wings.filter((wing) => wing.root.enabled).length,
      issue: this.issue,
    };
  }

  /** Destroy every reconstruction and clear all retained history references.
   * The caller restores its own station/clock using the returned entry context.
   * Persistent museum architecture and the recording have never been moved.
   */
  exit(): SpatialContext | undefined {
    const restore = this.entered ? copy(this.entered) : undefined;
    this.stage?.dispose();
    this.stage = undefined;
    this.common?.destroy();
    this.common = undefined;
    this.wings = [];
    this.board = undefined;
    this.request = undefined;
    this.context = undefined;
    this.entered = undefined;
    this.presentation = undefined;
    this.roomMode = false;
    this.identity = "";
    this.issue = undefined;
    return restore;
  }
  dispose(): void {
    this.exit();
    this.disposed = true;
  }
  private reject(message: string): void {
    this.exit();
    this.issue = message;
    this.options.reportIssue?.(message);
  }

  private find(name: string, root: SceneObject): SceneObject | undefined {
    if (root.name === name) return root;
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const found = this.find(name, root.getChild(i));
      if (found) return found;
    }
    return undefined;
  }
  private findGlobal(name: string): SceneObject | undefined {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const found = this.find(name, global.scene.getRootObject(i));
      if (found) return found;
    }
    return undefined;
  }
  private visualOnly(node: SceneObject): boolean {
    // Copying a script would run its lifecycle inline before it could be removed.
    if (
      node.getComponents("Component.ScriptComponent").length ||
      node.getComponents("Component.Camera").length ||
      node.getComponents("Component.AudioComponent").length
    )
      return false;
    for (let i = 0; i < node.getChildrenCount(); i++)
      if (!this.visualOnly(node.getChild(i))) return false;
    return true;
  }
  private cloneVisual(
    source: SceneObject,
    parent: SceneObject,
    name: string,
  ): SceneObject {
    const node = parent.copyWholeHierarchy(source);
    node.name = name;
    node.enabled = true;
    return node;
  }

  private mount(): boolean {
    const theatre = this.find("Theatre", this.parent);
    const bench = this.findGlobal("Anchor_ConservationBench");
    if (!theatre || !bench || !this.board || !this.request || !this.context)
      return false;
    const required = [...ROLES, "DisplayCase", "Ruby"];
    const templates = new Map<string, SceneObject>();
    for (const name of required) {
      const node = this.find(name, theatre);
      if (!node || !this.visualOnly(node)) return false;
      templates.set(name, node);
    }
    for (const wall of this.board.room.walls) {
      const node = this.find("PublicWall_" + wall.id, theatre);
      if (!node || !this.visualOnly(node)) return false;
      templates.set(node.name, node);
    }
    for (const name of [
      "MirrorHousing",
      "Curtain",
      "BrassCase",
      "CanvasTrunk",
    ]) {
      const node = this.find(name, theatre);
      if (node && this.visualOnly(node)) templates.set(name, node);
    }
    this.common = global.scene.createSceneObject("ComparisonWorkbench");
    this.common.setParent(this.parent);
    const transform = this.common.getTransform();
    transform.setWorldPosition(bench.getTransform().getWorldPosition());
    transform.setWorldRotation(bench.getTransform().getWorldRotation());
    transform.setWorldScale(new vec3(1, 1, 1));
    this.issue = undefined;
    for (let index = 0; index < 2; index++)
      this.wings.push(this.createWing(index, templates));
    const silent = new TableKit({
      clearActors() {},
      drawActor() {},
      drawObserved() {},
      drawRuby() {},
      drawCurtain() {},
      playAtCurtain() {},
    });
    this.stage = new SpatialStage(
      this.board,
      this.context,
      {
        wings: [this.wings[0].kit, this.wings[1].kit],
        // MuseumScene owns the one recorded pane. This port intentionally creates
        // no second image or geometry and cannot accept an author/reveal history.
        recording: silent,
        setWingPlacement: (index, placement) =>
          this.placeWing(index, placement),
        setWingVisible: (index, visible) => {
          const wing = this.wings[index];
          if (wing)
            wing.root.enabled =
              visible &&
              (!this.roomMode || index === (this.context?.versionIndex ?? 0));
        },
        setHandTargets: (index, targets) => this.applyHands(index, targets),
        setNestEmpty: () => {},
        setCache: () => {},
        setLabels: () => this.updateLabels(),
        setFrameCovered: () => {},
        setSecondaryLabelsVisible: () => {},
        setReturnHandle: () => {},
        finishTimeDrag: () => this.options.finishTimeDrag?.(),
        stopSound: () => this.options.stopSound?.(),
        clear: () => {
          for (const wing of this.wings) wing.root.enabled = false;
        },
      },
      () => ({
        kind: "witness",
        revision: this.board!.caseId + ":" + this.board!.rev,
        fragments: [],
        aperture: this.board!.room.mirror?.aperture ?? 0,
      }),
    );
    return true;
  }

  private createWing(
    index: number,
    templates: Map<string, SceneObject>,
  ): NativeWing {
    const root = global.scene.createSceneObject(
      "PossibleReconstruction_" + (index + 1),
    );
    root.setParent(this.common!);
    const geometry = global.scene.createSceneObject("ComparisonModelGeometry");
    geometry.setParent(root);
    geometry
      .getTransform()
      .setLocalScale(
        new vec3(
          TABLEKIT_MODEL_TO_STORY,
          TABLEKIT_MODEL_TO_STORY,
          TABLEKIT_MODEL_TO_STORY,
        ),
      );
    const actors = new Map<Role, SceneObject>(),
      arms = new Map<Role, LensArmAdapter<vec3, quat>>(),
      poses = new Map<Role, ActorPose>();
    for (const role of ROLES) {
      const actor = this.cloneVisual(templates.get(role)!, geometry, role);
      actors.set(role, actor);
      const shoulder = this.find("Shoulder_R", actor),
        elbow = this.find("Forearm_R", actor),
        wrist = this.find("Hand_R", actor);
      let upper = this.find("UpperBody", actor);
      if (shoulder && elbow && wrist) {
        if (!upper) {
          const parent = shoulder.getParent();
          upper = global.scene.createSceneObject("UpperBody");
          upper.setParent(parent);
          const children: SceneObject[] = [];
          for (let i = 0; i < parent.getChildrenCount(); i++) {
            const child = parent.getChild(i);
            if (
              child !== upper &&
              !/^Hip_|^Thigh_|^Knee_|^Boot_|^Sole_/.test(child.name)
            )
              children.push(child);
          }
          for (const child of children) child.setParent(upper);
        }
        arms.set(
          role,
          new LensArmAdapter(
            { upperBody: upper, shoulder, elbow, wrist },
            {
              vector: (x, y, z) => new vec3(x, y, z),
              quaternion: (x, y, z, w) => new quat(w, x, y, z),
            },
          ),
        );
      }
    }
    const ruby = this.cloneVisual(templates.get("Ruby")!, geometry, "Ruby");
    for (const [name, source] of templates) {
      if (ROLES.includes(name as Role) || name === "Ruby") continue;
      const object = this.cloneVisual(source, geometry, name);
      // Main Theatre has a centred (-21,-15) tabletop frame. These wings use
      // uncentred public story coordinates, with placement owning the origin.
      const p = source.getTransform().getLocalPosition();
      object.getTransform().setLocalPosition(new vec3(p.x + 21, p.y, p.z + 15));
    }
    const label = global.scene.createSceneObject("ReconstructionInscription");
    label.setParent(root);
    const inscription = label.createComponent("Component.Text");
    inscription.size = 20;
    inscription.depthTest = true;
    inscription.horizontalAlignment = HorizontalAlignment.Center;
    inscription.verticalAlignment = VerticalAlignment.Center;
    inscription.horizontalOverflow = HorizontalOverflow.Wrap;
    inscription.layoutRect = Rect.create(-290, 290, -55, 55);
    label
      .getTransform()
      .setLocalPosition(new vec3(this.board!.room.width * 50, 12, -65));
    label
      .getTransform()
      .setLocalRotation(quat.fromEulerAngles(-Math.PI / 2, 0, 0));
    const kit = new TableKit({
      clearActors: () => {
        poses.clear();
        for (const actor of actors.values()) actor.enabled = false;
      },
      drawActor: (pose) => {
        poses.set(pose.role, { ...pose, yawRad: pose.yawRad + Math.PI });
        const actor = actors.get(pose.role)!;
        actor.enabled = true;
        actor.getTransform().setLocalPosition(modelPoint(pose.positionCm));
        actor
          .getTransform()
          .setLocalRotation(quat.fromEulerAngles(0, pose.yawRad + Math.PI, 0));
        for (const name of Object.keys(pose.joints ?? {})) {
          const joint = this.find(name, actor),
            angles = pose.joints![name as keyof typeof pose.joints];
          if (joint && angles)
            joint
              .getTransform()
              .setLocalRotation(
                quat.fromEulerAngles(angles[0], angles[1], angles[2]),
              );
        }
      },
      drawObserved: () => {},
      drawRuby: (position, visible) => {
        ruby.getTransform().setLocalPosition(modelPoint(position));
        ruby.enabled = visible;
      },
      drawCurtain: () => {},
      playAtCurtain: () => {},
    });
    return {
      root,
      geometry,
      actors,
      arms,
      poses,
      ruby,
      label,
      inscription,
      kit,
    };
  }

  private placeWing(index: number, placement: Placement): void {
    const wing = this.wings[index];
    if (!wing || !this.board) return;
    const presented = this.presentation?.placement;
    if (this.roomMode) {
      const p = presented ?? placement;
      wing.root.getTransform().setWorldPosition(new vec3(...p.originCm));
      wing.root
        .getTransform()
        .setWorldRotation(quat.fromEulerAngles(0, p.yawRad, 0));
      wing.root
        .getTransform()
        .setWorldScale(new vec3(p.scale, p.scale, p.scale));
      wing.label.enabled = false;
      return;
    }
    wing.label.enabled = true;
    if (presented) {
      const scale = presented.scale,
        width = this.board.room.width * 100 * scale;
      const offset = ((index === 0 ? -1 : 1) * (width + this.gapCm)) / 2;
      const yaw = presented.yawRad;
      wing.root
        .getTransform()
        .setWorldPosition(
          new vec3(
            presented.originCm[0] + offset * Math.cos(yaw),
            presented.originCm[1],
            presented.originCm[2] - offset * Math.sin(yaw),
          ),
        );
      wing.root
        .getTransform()
        .setWorldRotation(quat.fromEulerAngles(0, yaw, 0));
      wing.root.getTransform().setWorldScale(new vec3(scale, scale, scale));
    } else {
      const width = this.board.room.width * 100 * this.benchScale;
      wing.root
        .getTransform()
        .setLocalPosition(
          new vec3(
            index === 0 ? -width - this.gapCm / 2 : this.gapCm / 2,
            3.6,
            -this.board.room.depth * 50 * this.benchScale,
          ),
        );
      wing.root.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, 0));
      wing.root
        .getTransform()
        .setLocalScale(
          new vec3(this.benchScale, this.benchScale, this.benchScale),
        );
    }
  }
  private applyHands(index: number, targets: readonly ActionPose[]): void {
    const wing = this.wings[index],
      history = this.request?.pair[index];
    if (!wing || !history) return;
    for (const target of targets) {
      const role = history.casting[target.track],
        pose = wing.poses.get(role);
      if (!pose) continue;
      wing.arms.get(role)?.apply(pose, target.handCm);
    }
  }
  private updateLabels(): void {
    if (!this.board || !this.request) return;
    this.wings.forEach((wing, index) => {
      const value = answer(
        this.board!,
        this.request!.pair[index],
        this.request!.field,
      );
      const field = this.request!.field;
      const title =
        field === "taker"
          ? value + " could take it"
          : field === "recipient"
            ? value === "None"
              ? "No transfer"
              : value + " could receive it"
            : field === "cache"
              ? value === "None"
                ? "No hiding place"
                : "Ruby could be in " + value
              : "Possible reconstruction";
      wing.inscription.text =
        title +
        "\n" +
        (this.request!.scope === "all"
          ? "Fits the full recording"
          : "Fits your selected clues");
    });
  }
}
