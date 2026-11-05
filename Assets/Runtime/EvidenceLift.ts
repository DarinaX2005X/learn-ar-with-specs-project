import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { recordedFragmentMeshes } from "./RecordedGlass";
import { FrameClue } from "../Domain/types";

export interface LiftContext {
  scope: string;
  caseId: string;
  rev: number;
  source: string;
  tick: number;
  available: boolean;
  selected?: string;
  observations: readonly FrameClue[];
}
export interface LiftSource {
  pane: SceneObject;
  clue: FrameClue;
  centerCm: readonly [number, number, number];
  widthCm: number;
  heightCm: number;
}
export interface EvidenceLiftPorts {
  parent: SceneObject;
  material?: Material;
  context(): LiftContext | undefined;
  select(id: string): void;
  /** The existing physical pane targets, including their empty states. */
  slot(id: string): SceneObject | undefined;
  pin(id: string, caseId: string, rev: number): boolean;
}
interface Carry {
  input: Interactable;
  interactor: unknown;
  clue: FrameClue;
  identity: string;
  caseId: string;
  rev: number;
  object: SceneObject;
  visual: SceneObject;
  magnification: number;
  receiver: SceneObject;
  source: SceneObject;
  center: vec3;
  guide: SceneObject;
  origin: vec3;
  position: vec3;
  travelled: number;
}
interface Return {
  identity: string;
  object: SceneObject;
  from: vec3;
  to: vec3;
  elapsed: number;
}
const finite = (p: vec3): boolean => [p.x, p.y, p.z].every(Number.isFinite);
const identity = (s: LiftContext): string =>
  [s.scope, s.caseId, s.rev, s.source, s.tick].join("|");

/** Carries only meshes already painted from one public clipped fragment.
 * No actor rendering, re-projection, invented image or free camera is involved. */
export class EvidenceLift {
  private carry: Carry | undefined;
  private returning: Return | undefined;
  private disposed = false;
  constructor(private ports: EvidenceLiftPorts) {}

  bind(input: Interactable, resolve: () => LiftSource | undefined): void {
    input.onTriggerStart.add(() => this.cancel(false));
    input.onDragStart.add((event) => {
      this.cancel(false); // A new gesture cannot inherit another hand's evidence.
      if (this.disposed) return;
      const source = resolve(), before = this.ports.context();
      if (!source || source.pane.name !== "PublicRecordedGlass" ||
        !source.pane.isEnabledInHierarchy || !before?.available ||
        !this.isVisibleFragment(source.clue, before)) return;
      try {
        this.ports.select(source.clue.id); // Pauses the exact current frame.
        const current = this.ports.context();
        if (!current?.available || identity(current) !== identity(before) ||
          !this.isVisibleFragment(source.clue, current) || current.selected !== source.clue.id) return;
        const receiver = this.ports.slot(source.clue.id);
        if (!receiver) return;
        const copied = this.copy(source);
        if (!copied) return;
        const { object, visual, magnification } = copied;
        let guide: SceneObject;
        try { guide = this.guide(receiver); }
        catch (_) { object.destroy(); return; }
        const origin = object.getTransform().getWorldPosition();
        const delta = event.dragVector;
        const position = delta && finite(delta) ? origin.add(delta) : origin;
        object.getTransform().setWorldPosition(position);
        this.carry = { input, interactor: event.interactor,
          clue: source.clue, identity: identity(current),
          caseId: current.caseId, rev: current.rev,
          object, visual, magnification, receiver, source: source.pane, center: new vec3(...source.centerCm),
          guide, origin, position, travelled: delta && finite(delta) ? delta.length : 0 };
        this.resizeVisual(this.carry);
        if (!this.valid(this.carry)) this.cancel(false);
      } catch (_) { this.cancel(false); }
    });
    input.onDragUpdate.add((event) => {
      const carry = this.carry;
      if (!carry || carry.input !== input || carry.interactor !== event.interactor) return;
      const delta = event.dragVector;
      if (!this.valid(carry) || !delta || !finite(delta)) {
        this.cancel(false); return;
      }
      carry.position = carry.position.add(delta);
      carry.travelled += delta.length;
      if (!finite(carry.position) || carry.travelled > 120) {
        this.cancel(true); return;
      }
      carry.object.getTransform().setWorldPosition(carry.position);
      this.resizeVisual(carry);
    });
    input.onDragEnd.add(event => this.release(input, event.interactor));
    input.onTriggerCanceled.add(event => {
      if (this.carry?.input === input && this.carry.interactor === event.interactor)
        this.cancel(true);
    });
    // SIK emits TriggerEndOutside BEFORE DragEnd on an ordinary release away
    // from the source. It is a legitimate drop; TriggerCanceled is cancellation.
    input.onTriggerEndOutside.add(event => this.release(input, event.interactor));
  }
  /** Movement-based feedback only: the root/contact/drop center never changes. */
  private resizeVisual(carry: Carry): void {
    const displacement = carry.position.add(carry.origin.uniformScale(-1)).length;
    const amount = Math.min(1, Math.max(0, displacement / 6));
    const eased = amount * amount * (3 - 2 * amount);
    const scale = 1 + (carry.magnification - 1) * eased;
    const transform = carry.visual.getTransform();
    transform.setLocalScale(new vec3(scale, scale, scale));
    transform.setLocalPosition(carry.center.uniformScale(1 - scale));
  }
  private isVisibleFragment(clue: FrameClue, state: LiftContext): boolean {
    return clue.observation?.kind === "fragment" &&
      clue.payload.fragments.length === 1 && clue.tick === state.tick &&
      clue.witness === state.source && state.observations.some(view =>
        view.id === clue.id && view.observation?.kind === "fragment");
  }
  private valid(carry: Carry): boolean {
    const state = this.ports.context();
    return !this.disposed && carry.source.isEnabledInHierarchy && !!state?.available &&
      identity(state) === carry.identity && state.selected === carry.clue.id &&
      this.isVisibleFragment(carry.clue, state);
  }
  sync(): void {
    if (this.carry && !this.valid(this.carry)) this.cancel(false);
    if (this.returning) {
      const state = this.ports.context();
      if (!state?.available || identity(state) !== this.returning.identity) {
        this.returning.object.destroy(); this.returning = undefined;
      }
    }
  }
  private release(input: Interactable, interactor: unknown): void {
    const carry = this.carry;
    if (!carry || carry.input !== input || carry.interactor !== interactor) return;
    if (!this.valid(carry)) { this.cancel(false); return; }
    const slot = (() => {
      const center = carry.object.getTransform().getWorldTransform()
        .multiplyPoint(carry.center);
      const p = carry.receiver.getTransform().getInvertedWorldTransform()
        .multiplyPoint(center);
      // Existing Evidence target is 20 x 5 x 18 cm. A held plate may be
      // released just above its top, within 6 cm of its receiving surface.
      return finite(p) && Math.abs(p.x) <= 10 && Math.abs(p.z) <= 9 &&
        p.y >= -2.5 && p.y <= 8.5;
    })();
    if (!slot || carry.travelled < 1) { this.cancel(true); return; }
    // Take release ownership before synchronous dispatch/render, exactly once.
    this.carry = undefined;
    carry.guide.destroy();
    let pinned = false;
    try { pinned = this.ports.pin(carry.clue.id,
      carry.caseId, carry.rev); }
    catch (_) { pinned = false; }
    if (pinned) carry.object.destroy();
    else this.returnPlate(carry);
  }
  cancel(animate = true): void {
    const carry = this.carry;
    this.carry = undefined;
    if (this.returning) {
      this.returning.object.destroy(); this.returning = undefined;
    }
    if (carry) {
      carry.guide.destroy();
      if (animate && !this.disposed) this.returnPlate(carry);
      else carry.object.destroy();
    }
  }
  private returnPlate(carry: Carry): void {
    this.returning = {identity: carry.identity, object: carry.object, from: carry.position,
      to: carry.origin, elapsed: 0};
  }
  update(delta: number): void {
    this.sync();
    const returning = this.returning;
    if (!returning || !Number.isFinite(delta) || delta < 0) return;
    returning.elapsed += Math.min(delta, .1);
    const t = Math.min(1, returning.elapsed / .16), eased = 1 - (1 - t) ** 3;
    returning.object.getTransform().setWorldPosition(
      returning.from.uniformScale(1 - eased).add(returning.to.uniformScale(eased)));
    if (t === 1) { returning.object.destroy(); this.returning = undefined; }
  }
  dispose(): void {
    this.disposed = true;
    this.cancel(false);
  }
  private copy(source: LiftSource): {object: SceneObject; visual: SceneObject; magnification: number} | undefined {
    const children = recordedFragmentMeshes(source.pane.name, source.clue.id)
      .filter(child => child.isEnabledInHierarchy &&
        !!child.getComponent("Component.RenderMeshVisual"));
    if (!children.length || !this.ports.material) return undefined;
    const object = global.scene.createSceneObject("CarriedEvidenceGlass");
    object.setParent(this.ports.parent);
    try {
      const from = source.pane.getTransform(), to = object.getTransform();
      to.setWorldPosition(from.getWorldPosition());
      to.setWorldRotation(from.getWorldRotation());
      const worldScale = from.getWorldScale();
      if (!finite(worldScale) || Math.abs(worldScale.x) < 1e-6 || Math.abs(worldScale.y) < 1e-6)
        throw new Error("Visible recording scale required");
      to.setWorldScale(worldScale);
      const longest = Math.max(source.widthCm * Math.abs(worldScale.x), source.heightCm * Math.abs(worldScale.y));
      const magnification = Math.min(6, Math.max(1, 10 / longest));
      const visual = global.scene.createSceneObject("CarriedFragmentVisual");
      visual.setParent(object);
      visual.getTransform().setLocalPosition(new vec3(0,0,0));
      visual.getTransform().setLocalRotation(quat.fromEulerAngles(0,0,0));
      visual.getTransform().setLocalScale(new vec3(1,1,1));
      // Reparent while the visual child is identity, before its centered magnification.
      for (const child of children) {
        const copy = object.copySceneObject(child);
        copy.setParent(visual);
        // Mesh vertices are already source-clipped. Reuse the fixed geometry;
        // isolate material so later source selection cannot recolor the copy.
        const meshVisual = copy.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
        meshVisual.mainMaterial = meshVisual.mainMaterial.clone();
      }
      this.glass(visual, source, worldScale, magnification);
      return { object, visual, magnification };
    } catch (_) { object.destroy(); return undefined; }
  }
  private glass(parent: SceneObject, source: LiftSource, worldScale: vec3, magnification: number): void {
    const [x,y] = source.centerCm;
    const sx = Math.abs(worldScale.x) * magnification, sy = Math.abs(worldScale.y) * magnification;
    const w = source.widthCm + 1.2 / sx, h = source.heightCm + 1.2 / sy;
    // A neutral physical backing adds no image, crop, identity or recorded fact.
    const builder = new MeshBuilder([{name:"position",components:3},
      {name:"normal",components:3},{name:"texture0",components:2}]);
    builder.topology = MeshTopology.Triangles; builder.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [];
    for (const point of [[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]])
      vertices.push(point[0],point[1],-.08,0,0,1,0,0);
    builder.appendVerticesInterleaved(vertices); builder.appendIndices([0,1,2,0,2,3]); builder.updateMesh();
    const backing = global.scene.createSceneObject("CarriedGlassBacking"); backing.setParent(parent);
    const material = this.ports.material!.clone();
    material.mainPass.baseColor = new vec4(.84,.86,.81,1); material.mainPass.twoSided = true;
    const mesh = backing.createComponent("Component.RenderMeshVisual");
    mesh.mesh = builder.getMesh(); mesh.mainMaterial = material;
    this.edge(parent, x, y, w, h, "CarriedGlassEdge", .16 / sx, .16 / sy,
      new vec4(.30,.40,.36,1));
  }
  private guide(receiver: SceneObject): SceneObject {
    const object=global.scene.createSceneObject("ReceivingGlassEdge");
    object.setParent(this.ports.parent);
    const transform=receiver.getTransform(), rotation=transform.getWorldRotation();
    object.getTransform().setWorldPosition(transform.getWorldPosition()
      .add(rotation.multiplyVec3(new vec3(0,3,0))));
    object.getTransform().setWorldRotation(rotation
      .multiply(quat.fromEulerAngles(-Math.PI/2,0,0)));
    try { this.edge(object,0,0,18,16,"ReceivingEdge",.11,.11,new vec4(.40,.48,.44,1)); }
    catch (_) { object.destroy(); throw _; }
    return object;
  }
  private edge(parent: SceneObject, x: number, y: number, w: number,
    h: number, name: string, ex = .22, ey = .22,
    color = new vec4(.52,.65,.61,1)): void {
    const builder = new MeshBuilder([{name:"position",components:3},
      {name:"normal",components:3},{name:"texture0",components:2}]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    const vertices: number[] = [], indices: number[] = [];
    const quad = (left: number, right: number, bottom: number, top: number, z: number) => {
      const start = vertices.length / 8;
      for (const p of [[left,bottom],[right,bottom],[right,top],[left,top]])
        vertices.push(p[0],p[1],z,0,0,1,0,0);
      indices.push(start,start+1,start+2,start,start+2,start+3);
    };
    // A narrow physical edge frames the actual copied fragment, no fake image.
    const l=x-w/2,r=x+w/2,b=y-h/2,t=y+h/2;
    quad(l,r,b,b+ey,-.05);quad(l,r,t-ey,t,-.05);
    quad(l,l+ex,b,t,-.05);quad(r-ex,r,b,t,-.05);
    builder.appendVerticesInterleaved(vertices);builder.appendIndices(indices);builder.updateMesh();
    const edge=global.scene.createSceneObject(name);edge.setParent(parent);
    const visual=edge.createComponent("Component.RenderMeshVisual");visual.mesh=builder.getMesh();
    const material=this.ports.material!.clone();
    material.mainPass.baseColor=color;material.mainPass.twoSided=true;
    visual.mainMaterial=material;
  }
}
