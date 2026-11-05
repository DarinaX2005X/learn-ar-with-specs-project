import type { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import type { TrackId, Vec3 } from "../Domain/types";
import {
  AuthorPropsController,
  AuthorPropsPorts,
  PropTool,
  unplacedDisplay,
  questionLabel,
} from "./AuthorPropsController";
export type PropsPoint = readonly [number, number, number];
export interface PropsHandle {
  object: SceneObject;
  inscription: SceneObject;
  input: Interactable;
  shape: BoxShape;
}
export interface AuthorPropsNativePorts extends AuthorPropsPorts {
  parent: SceneObject;
  material: Material;
  bind(
    id: string,
    position: PropsPoint,
    size: PropsPoint,
    label: () => string,
    invoke: () => void,
    active: () => boolean,
    onTop?: boolean,
  ): PropsHandle;
  anchor(name: string, fallback: PropsPoint): PropsPoint;
  toWorld(pointCm: PropsPoint): vec3;
  toStory(point: vec3): PropsPoint;
  deltaToStory(delta: vec3): vec3;
  /** Pure visual templates: DisplayCase, Camera, MuseumPartitionShortTemplate,
   * Courier, Guard, Conservator. Never a camera/interaction-system prefab. */
  template(name: string): SceneObject | undefined;
}
const roles = ["Courier", "Guard", "Conservator"] as const;
const cm = (p: Vec3, y = p.y * 100): PropsPoint => [p.x * 100, y, p.z * 100];

/** Fixed workbench tray + real object pulls. bind() keeps all input wrappers alive;
 * only visual children are cloned or replaced. No independent clock or case state. */
export class AuthorPropsHandles {
  readonly controller: AuthorPropsController;
  private root: SceneObject;
  private tray: SceneObject;
  private questionSheet: SceneObject;
  private marker: SceneObject;
  private floor: PropsHandle;
  private actions = new Map<string, PropsHandle>();
  private icons = new Map<string, { model: SceneObject; template: string }>();
  private disposed = false;
  private scope = "";
  private hoverPoint: vec3 | undefined;
  private colours: { wood: Material; paper: Material; brass: Material };
  constructor(private ports: AuthorPropsNativePorts) {
    this.controller = new AuthorPropsController(ports);
    this.root = global.scene.createSceneObject("AuthorPropTools");
    this.root.setParent(ports.parent);
    this.colours = {
      wood: this.colour(0.25, 0.16, 0.1),
      paper: this.colour(0.83, 0.78, 0.65),
      brass: this.colour(0.71, 0.55, 0.29),
    };
    const bench = ports.anchor("Anchor_ConservationBench", [-350, 94, 380]);
    this.tray = this.group("PropTray", this.root);
    this.tray
      .getTransform()
      .setWorldPosition(ports.toWorld([bench[0], bench[1] + 1, bench[2] + 58]));
    this.box(
      this.tray,
      "SolidTray",
      [0, 0, 0],
      [122, 2, 26],
      this.colours.wood,
    );
    for (const x of [-61, 61])
      this.box(
        this.tray,
        "EndRail",
        [x, 1.5, 0],
        [1.4, 2, 26],
        this.colours.wood,
      );
    for (const z of [-13, 13])
      this.box(
        this.tray,
        "LongRail",
        [0, 1.5, z],
        [122, 2, 1.4],
        this.colours.wood,
      );
    const author = () => ports.mode() === "author";
    const add = (
      id: string,
      x: number,
      label: () => string,
      choose: () => void,
      active = author,
    ) => {
      const action = this.bind(
        id,
        [bench[0] + x, bench[1] + 6, bench[2] + 58],
        [14, 14, 14],
        label,
        choose,
        active,
        true,
      );
      this.box(
        action.object,
        "ObjectPocket",
        [0, -4.2, 0],
        [16, 0.6, 14],
        this.colours.paper,
      );
    };
    const questions = (this.questionSheet = this.group(
      "AuthorQuestionSheet",
      this.root,
    ));
    questions
      .getTransform()
      .setWorldPosition(
        ports.toWorld([bench[0] - 82, bench[1] + 1, bench[2] + 15]),
      );
    this.box(questions, "Paper", [0, 0, 0], [72, 0.6, 35], this.colours.paper);
    for (const [i, chain] of [false, true].entries()) {
      const h = this.bind(
        chain ? "QuestionTransfer" : "QuestionTheft",
        [bench[0] - 82 - 18 + i * 36, bench[1] + 3, bench[2] + 5],
        [32, 3, 10],
        () =>
          `${ports.read()?.draft.chain === chain ? "Selected " : "Choose "}${chain ? "transfer" : "simple theft"}. ${this.controller.questionSummary()}`,
        () => this.controller.setQuestionMode(chain),
        author,
        true,
      );
      this.box(
        h.object,
        "ModeTab",
        [0, 0, 0],
        [32, 0.8, 10],
        this.colours.paper,
      );
    }
    const findingFields = [
      "taker",
      "recipient",
      "cache",
      "takeTick",
      "passTick",
      "stashTick",
    ] as const;
    findingFields.forEach((field, i) => {
      const h = this.bind(
        "QuestionFinding" + field,
        [
          bench[0] - 82 - 24 + (i % 3) * 24,
          bench[1] + 3,
          bench[2] + 18 + Math.floor(i / 3) * 10,
        ],
        [22, 3, 8],
        () =>
          `${questionLabel[field][0].toUpperCase() + questionLabel[field].slice(1)}. ${ports.read()?.draft.fields?.includes(field) ? "Required. Tap to remove." : "Optional. Tap to require."} ${this.controller.questionSummary()}`,
        () => this.controller.toggleQuestion(field),
        author,
        true,
      );
      this.box(
        h.object,
        "FindingTab",
        [0, 0, 0],
        [22, 0.8, 8],
        this.colours.paper,
      );
    });
    add(
      "PropDisplay",
      -50,
      () => "Place display",
      () => this.controller.chooseExhibit(),
    );
    add(
      "PropCamera",
      -30,
      () => "Place camera",
      () => this.controller.chooseNewCamera(),
      () => author() && (ports.read()?.draft.witnesses.length ?? 2) < 2,
    );
    add(
      "PropScreen",
      -10,
      () => "Place screen",
      () => this.controller.chooseNewScreen(),
      () => author() && (ports.read()?.draft.room.walls.length ?? 4) < 4,
    );
    for (let i = 0; i < 3; i++) {
      const track = (["A", "B", "C"] as TrackId[])[i];
      add(
        "PropFigure" + track,
        10 + i * 20,
        () => "Place " + (ports.read()?.draft.casting[track] ?? roles[i]),
        () => this.controller.chooseActor(track),
      );
    }
    this.bind(
      "CancelPropPlacement",
      [bench[0] + 69, bench[1] + 3, bench[2] + 58],
      [8, 5, 16],
      () => "Cancel placement",
      () => this.controller.cancel(),
      () => author() && this.controller.isPlacing(),
      true,
    );
    const cancel = this.actions.get("CancelPropPlacement")!;
    this.pull(cancel.object);
    const empty = this.bind(
      "EmptyRoomFile",
      [bench[0] + 89, bench[1] + 1, bench[2] - 12],
      [19, 5, 27],
      () => "Start an empty room",
      () => this.controller.startEmpty(),
      () => ["ready", "detective", "finished"].includes(ports.mode()),
      true,
    );
    this.folder(empty.object, false);
    // Existing KeepRoomFile is retained by PlayTable; this visual does not rebind it.
    const keepVisual = this.group("KeepRoomFolder", this.root);
    keepVisual
      .getTransform()
      .setWorldPosition(
        ports.toWorld([bench[0] - 68, bench[1] + 2, bench[2] - 20]),
      );
    this.folder(keepVisual, true);
    this.icons.set("KeepRoomVisual", { model: keepVisual, template: "file" });
    this.floor = this.bind(
      "PropPlacementFloor",
      [350, -1, 250],
      [700, 2, 500],
      () => this.controller.message || this.floorLabel(),
      () => {
        if (this.hoverPoint) {
          const p = ports.toStory(this.hoverPoint);
          this.controller.place({ x: p[0] / 100, y: 1, z: p[2] / 100 });
        }
      },
      () =>
        author() && this.controller.isPlacing() && !this.controller.isMoving(),
      true,
    );
    const hover = (event: any) => {
      const hit = event.interactor.targetHitPosition as vec3 | null;
      if (!hit) return;
      this.hoverPoint = hit;
      this.marker.enabled = true;
      this.marker.getTransform().setWorldPosition(hit.add(new vec3(0, 1.5, 0)));
      this.floor.inscription
        .getTransform()
        .setWorldPosition(hit.add(new vec3(0, 3, 0)));
    };
    this.floor.input.onHoverUpdate.add(hover);
    this.floor.input.onTriggerStart.add(hover);
    this.floor.input.onHoverExit.add(() => {
      this.hoverPoint = undefined;
      this.marker.enabled = false;
    });
    this.marker = this.group("FloorPlacementPoint", this.root);
    this.box(this.marker, "Point", [0, 0, 0], [3, 0.3, 3], this.colours.paper);
    this.marker.enabled = false;
    this.moveHandle(
      "MoveDisplay",
      () => ({ kind: "exhibit" }),
      () => {
        const d = ports.read()?.draft;
        return d && !unplacedDisplay(d)
          ? [
              d.room.exhibit.position.x * 100 - 28,
              80,
              d.room.exhibit.position.z * 100,
            ]
          : undefined;
      },
      "Move display",
    );
    for (let i = 0; i < 2; i++) {
      const witness = () => ports.read()?.draft.witnesses[i];
      this.moveHandle(
        "MoveCamera" + i,
        () => (witness() ? { kind: "camera", id: witness()!.id } : undefined),
        () => {
          const w = witness();
          return w
            ? [w.position.x * 100, w.position.y * 100 - 35, w.position.z * 100]
            : undefined;
        },
        "Move camera",
      );
      this.turnHandle(
        "TurnCamera" + i,
        () => {
          const w = witness();
          return w
            ? [
                w.position.x * 100 + 16,
                w.position.y * 100 - 30,
                w.position.z * 100,
              ]
            : undefined;
        },
        () => {
          const w = witness();
          if (w) this.controller.turnCamera(w.id);
        },
        "Turn camera",
      );
    }
    for (let i = 0; i < 4; i++) {
      const wall = () => ports.read()?.draft.room.walls[i];
      const point = (): PropsPoint | undefined => {
        const w = wall();
        return w
          ? [(w.a.x + w.b.x) * 50, 105, (w.a.z + w.b.z) * 50]
          : undefined;
      };
      this.moveHandle(
        "MoveScreen" + i,
        () => (wall() ? { kind: "screen", id: wall()!.id } : undefined),
        point,
        "Move screen",
      );
      this.turnHandle(
        "TurnScreen" + i,
        () => {
          const p = point();
          return p ? [p[0] + 18, p[1] + 25, p[2]] : undefined;
        },
        () => {
          const w = wall();
          if (w) this.controller.turnScreen(w.id);
        },
        "Turn screen",
      );
    }
  }
  isPlacing(): boolean {
    return this.controller.isPlacing();
  }
  cancel(): void {
    this.controller.cancel();
    this.marker.enabled = false;
  }
  sync(): void {
    if (this.disposed) return;
    if (this.scope !== this.ports.scope()) {
      this.scope = this.ports.scope();
      this.hoverPoint = undefined;
    }
    this.controller.sync();
    const a = this.ports.read(),
      author = this.ports.mode() === "author" && !!a;
    this.tray.enabled = author;
    this.questionSheet.enabled = author;
    this.icons.get("KeepRoomVisual")!.model.enabled =
      this.ports.mode() === "finished";
    this.marker.enabled =
      author &&
      this.controller.isPlacing() &&
      !this.controller.isMoving() &&
      !!this.hoverPoint;
    if (!a || !author) return;
    this.floor.shape.size = new vec3(
      a.draft.room.width * 100,
      2,
      a.draft.room.depth * 100,
    );
    this.floor.object
      .getTransform()
      .setWorldPosition(
        this.ports.toWorld([
          a.draft.room.width * 50,
          -1,
          a.draft.room.depth * 50,
        ]),
      );
    for (const [id, name] of [
      ["PropDisplay", "DisplayCase"],
      ["PropCamera", "Camera"],
      ["PropScreen", "MuseumPartitionShortTemplate"],
    ])
      this.icon(id, name);
    for (const track of ["A", "B", "C"] as TrackId[])
      this.icon("PropFigure" + track, a.draft.casting[track]);
    for (const [id, position] of this.positions) {
      const p = position(),
        action = this.actions.get(id);
      if (p && action)
        action.object.getTransform().setWorldPosition(this.ports.toWorld(p));
    }
  }
  private positions = new Map<string, () => PropsPoint | undefined>();
  private moveHandle(
    id: string,
    tool: () => PropTool | undefined,
    position: () => PropsPoint | undefined,
    label: string,
  ): void {
    const action = this.bind(
      id,
      [0, 0, 0],
      [12, 12, 12],
      () => label,
      () => {
        const t = tool();
        if (t) this.controller.choose(t);
      },
      () => this.ports.mode() === "author" && !!position(),
    );
    this.pull(action.object);
    this.positions.set(id, position);
    let token = 0;
    action.input.onDragStart.add(() => {
      const t = tool();
      if (t && this.controller.beginMove(t))
        token = this.controller.moveToken();
    });
    action.input.onDragUpdate.add((event) => {
      if (!token || token !== this.controller.moveToken()) return;
      const p = this.controller.point(),
        delta = this.ports.deltaToStory(event.dragVector);
      if (p)
        this.controller.preview(
          {
            x: p.x + delta.x / 100,
            y: p.y,
            z: p.z + delta.z / 100,
          },
          token,
        );
    });
    action.input.onDragEnd.add(() => {
      this.controller.finishMove(token);
      token = 0;
    });
    const cancel = () => {
      this.controller.cancelMove(token);
      token = 0;
    };
    action.input.onTriggerCanceled.add(cancel);
    action.input.onTriggerEndOutside.add(cancel);
  }
  private turnHandle(
    id: string,
    position: () => PropsPoint | undefined,
    invoke: () => void,
    label: string,
  ): void {
    const action = this.bind(
      id,
      [0, 0, 0],
      [10, 10, 10],
      () => this.controller.message || label,
      invoke,
      () => this.ports.mode() === "author" && !!position(),
    );
    this.pull(action.object);
    this.positions.set(id, position);
  }
  private bind(
    id: string,
    p: PropsPoint,
    size: PropsPoint,
    label: () => string,
    invoke: () => void,
    active: () => boolean,
    onTop = false,
  ): PropsHandle {
    const action = this.ports.bind(id, p, size, label, invoke, active, onTop);
    this.actions.set(id, action);
    return action;
  }
  private floorLabel(): string {
    const tool = this.controller.activeTool();
    return tool
      ? "Place " +
          (tool.kind === "actor"
            ? "figure"
            : tool.kind === "exhibit"
              ? "display"
              : tool.kind) +
          " here"
      : "";
  }
  private icon(id: string, name: string): void {
    const old = this.icons.get(id);
    if (old?.template === name) return;
    old?.model.destroy();
    this.icons.delete(id);
    const source = this.ports.template(name),
      parent = this.actions.get(id)?.object;
    if (!source || !parent) return;
    const model = parent.copyWholeHierarchy(source);
    model.name = "Miniature_" + name;
    model.enabled = true;
    model.getTransform().setLocalPosition(vec3.zero());
    model.getTransform().setLocalRotation(quat.quatIdentity());
    this.stripInputs(model);
    this.fit(model, parent, 8);
    this.icons.set(id, { model, template: name });
  }
  private stripInputs(node: SceneObject): void {
    for (const component of node.getComponents("Component.ScriptComponent"))
      component.destroy();
    for (const component of node.getComponents("Physics.ColliderComponent"))
      component.destroy();
    for (let i = 0; i < node.getChildrenCount(); i++)
      this.stripInputs(node.getChild(i));
  }
  private fit(model: SceneObject, parent: SceneObject, size: number): void {
    const inverse = parent.getTransform().getInvertedWorldTransform();
    let lo = new vec3(Infinity, Infinity, Infinity),
      hi = new vec3(-Infinity, -Infinity, -Infinity);
    const walk = (node: SceneObject) => {
      for (const visual of node.getComponents("Component.RenderMeshVisual")) {
        const a = visual.localAabbMin(),
          b = visual.localAabbMax(),
          world = node.getTransform().getWorldTransform();
        for (const x of [a.x, b.x])
          for (const y of [a.y, b.y])
            for (const z of [a.z, b.z]) {
              const p = inverse.multiplyPoint(
                world.multiplyPoint(new vec3(x, y, z)),
              );
              lo = vec3.min(lo, p);
              hi = vec3.max(hi, p);
            }
      }
      for (let i = 0; i < node.getChildrenCount(); i++) walk(node.getChild(i));
    };
    walk(model);
    const span = hi.sub(lo),
      largest = Math.max(span.x, span.y, span.z);
    if (!Number.isFinite(largest) || largest <= 0) return;
    const factor = size / largest,
      transform = model.getTransform();
    transform.setLocalScale(transform.getLocalScale().uniformScale(factor));
    transform.setLocalPosition(lo.add(hi).uniformScale(-factor / 2));
  }
  private group(name: string, parent: SceneObject): SceneObject {
    const n = global.scene.createSceneObject(name);
    n.setParent(parent);
    return n;
  }
  private colour(r: number, g: number, b: number): Material {
    const m = this.ports.material.clone();
    m.mainPass.baseColor = new vec4(r, g, b, 1);
    return m;
  }
  private folder(parent: SceneObject, room: boolean): void {
    this.box(parent, "BackCover", [0, -0.4, 0], [18, 1, 26], this.colours.wood);
    for (let i = 0; i < 3; i++)
      this.box(
        parent,
        "Paper" + i,
        [0.5, 0.25 + i * 0.22, 0],
        [16.5, 0.2, 24],
        this.colours.paper,
      );
    this.box(
      parent,
      "Spine",
      [-8.5, 0.5, 0],
      [1.2, 1.4, 26],
      this.colours.brass,
    );
    if (room)
      for (const [c, s] of [
        [
          [0, 1.1, -7],
          [10, 0.25, 0.5],
        ],
        [
          [-5, 1.1, 0],
          [0.5, 0.25, 14],
        ],
        [
          [5, 1.1, 0],
          [0.5, 0.25, 14],
        ],
      ] as [PropsPoint, PropsPoint][])
        this.box(parent, "RoomOutline", c, s, this.colours.brass);
  }
  private pull(parent: SceneObject): void {
    for (const x of [-4, 4])
      this.box(parent, "Post", [x, 0, 0], [1.2, 3, 2], this.colours.brass);
    this.box(parent, "WoodGrip", [0, 1.5, 0], [9, 1.5, 2.5], this.colours.wood);
  }
  private box(
    parent: SceneObject,
    name: string,
    centre: PropsPoint,
    size: PropsPoint,
    material: Material,
  ): void {
    const node = this.group(name, parent);
    node.getTransform().setLocalPosition(new vec3(...centre));
    const mesh = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    mesh.topology = MeshTopology.Triangles;
    mesh.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [],
      indices: number[] = [];
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [-1, 1]) {
        const u = (axis + 1) % 3,
          v = (axis + 2) % 3,
          normal = [0, 0, 0];
        normal[axis] = sign;
        const quad =
          sign > 0
            ? [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
              ]
            : [
                [-1, -1],
                [-1, 1],
                [1, 1],
                [1, -1],
              ];
        const start = vertices.length / 8;
        for (const q of quad) {
          const p = [0, 0, 0];
          p[axis] = (sign * size[axis]) / 2;
          p[u] = (q[0] * size[u]) / 2;
          p[v] = (q[1] * size[v]) / 2;
          vertices.push(...p, ...normal, 0, 0);
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    mesh.appendVerticesInterleaved(vertices);
    mesh.appendIndices(indices);
    mesh.updateMesh();
    const visual = node.createComponent("Component.RenderMeshVisual");
    visual.mesh = mesh.getMesh();
    visual.mainMaterial = material;
  }
  dispose(): void {
    if (this.disposed) return;
    this.controller.cancel();
    this.root.destroy();
    this.disposed = true;
  }
}
