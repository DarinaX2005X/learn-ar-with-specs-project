import type { MuseumScene } from "./MuseumScene";
import { MuseumFonts, applyMuseumFont } from "./MuseumFonts";
import { buildGallerySamples, GallerySampleState } from "../Scripts/TableKit/GalleryStateSource";

export interface GalleryCloneCounts { nodes: number; visuals: number; }

/** Geometry only. Never calls copyWholeHierarchy: a copied script could run its
 * startup before a later strip. Shared rigid meshes/materials stay shared. */
export function copyGalleryVisuals(source: SceneObject, parent: SceneObject,
  counts: GalleryCloneCounts): SceneObject {
  if (++counts.nodes > 900) throw new Error("The state gallery exceeded its bounded visual hierarchy");
  const node = global.scene.createSceneObject(source.name);
  node.setParent(parent);
  node.enabled = source.enabled;
  const original = source.getTransform(), transform = node.getTransform();
  transform.setLocalPosition(original.getLocalPosition());
  transform.setLocalRotation(original.getLocalRotation());
  transform.setLocalScale(original.getLocalScale());
  for (const visual of source.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]) {
    if (visual.getBlendShapeNames().length) throw new Error("The state gallery supports the shipped rigid models only");
    if (++counts.visuals > 750) throw new Error("The state gallery exceeded its bounded mesh count");
    const copy = node.createComponent("Component.RenderMeshVisual");
    copy.mesh = visual.mesh;
    copy.materials = visual.materials;
    copy.enabled = visual.enabled;
    copy.renderOrder = visual.renderOrder;
  }
  for (let i = 0; i < source.getChildrenCount(); i++) copyGalleryVisuals(source.getChild(i), node, counts);
  return node;
}

/** Startup-only developer surface. Normal runtime never constructs this class.
 * It samples the one existing native renderer and copies no gameplay component. */
export class TableKitStateGallery {
  private root?: SceneObject;
  private hidden: { node: SceneObject; enabled: boolean }[] = [];
  private readonly counts: GalleryCloneCounts = { nodes: 0, visuals: 0 };
  private states: GallerySampleState[] = [];
  constructor(private parent: SceneObject, private renderer: MuseumScene,
    private fonts: MuseumFonts = {}) {}

  mount(): void {
    if (this.root) return;
    const theatre = this.find("Theatre", this.parent);
    if (!theatre) throw new Error("The developer gallery requires the existing Museum Theatre");
    const viewer = this.renderer.readCaseViewViewer();
    const length = Math.hypot(viewer.forward[0], viewer.forward[2]);
    if (!viewer.eyeCm.every(Number.isFinite) || length < 0.01)
      throw new Error("Look toward the developer state gallery before restarting Preview");
    const root = global.scene.createSceneObject("DeveloperTableKitStateGallery");
    this.root = root;
    root.setParent(this.parent);
    root.getTransform().setWorldPosition(new vec3(viewer.eyeCm[0] + viewer.forward[0] / length * 170,
      viewer.eyeCm[1] - 70, viewer.eyeCm[2] + viewer.forward[2] / length * 170));
    root.getTransform().setWorldRotation(quat.fromEulerAngles(0, Math.atan2(viewer.forward[0], viewer.forward[2]), 0));
    root.getTransform().setWorldScale(new vec3(1, 1, 1));
    try {
      this.states = buildGallerySamples(true);
      for (let i = 0; i < this.states.length; i++) {
        const state = this.states[i];
        this.renderer.setLid(false);
        this.renderer.render({ flow: { mode: "author", title: state.author.draft.title,
          caseId: state.author.draft.id, revision: state.author.draft.rev, primary: "", message: "",
          inputEpoch: i + 1, hasDraft: true, tutorial: false, shelf: [] }, author: state.author });
        this.capture(theatre, state, i);
      }
      this.renderer.clear();
      this.hideSourceArt();
    } catch (error) { this.dispose(); throw error; }
  }

  private capture(theatre: SceneObject, state: GallerySampleState, index: number): void {
    const life = state.descriptor.scale > 1;
    const cell = global.scene.createSceneObject("State_" + state.descriptor.name.replace(/ /g, ""));
    cell.setParent(this.root!);
    cell.getTransform().setLocalPosition(life ? new vec3(210, -95, 160) : new vec3(-60 + index * 30, 0, 0));
    const orient = global.scene.createSceneObject("MirrorFacingVisitor"); orient.setParent(cell);
    orient.getTransform().setLocalRotation(quat.fromEulerAngles(0, -Math.PI / 2, 0));
    orient.getTransform().setLocalScale(new vec3(state.descriptor.scale, state.descriptor.scale, state.descriptor.scale));
    const art = global.scene.createSceneObject("SharedNativeTableKitArt"); art.setParent(orient);
    const mirror = state.author.draft.room.mirror!;
    art.getTransform().setLocalPosition(new vec3(-(mirror.origin.x * 6 - 21), 0, -(mirror.origin.z * 6 - 15)));
    const reference = theatre.getTransform(), inverse = reference.getInvertedWorldTransform();
    const rotation = reference.getWorldRotation().invert(), scale = reference.getWorldScale();
    // Curtain states do not need four additional copies of the same whole doll.
    const names = state.descriptor.name === "Free" || life
      ? ["Guard", "MirrorHousing", "Curtain"] : ["MirrorHousing", "Curtain"];
    for (const name of names) {
      const source = this.find(name, theatre);
      if (!source) throw new Error("The native gallery source is missing " + name);
      const copy = copyGalleryVisuals(source, art, this.counts), from = source.getTransform(), to = copy.getTransform();
      to.setLocalPosition(inverse.multiplyPoint(from.getWorldPosition()));
      to.setLocalRotation(rotation.multiply(from.getWorldRotation()));
      const s = from.getWorldScale(); to.setLocalScale(new vec3(s.x / scale.x, s.y / scale.y, s.z / scale.z));
      copy.enabled = true;
    }
    const handle = this.find("Handle", art), focus = this.find("HandleFocus", art);
    if (!handle || !focus) throw new Error("The native Curtain handle and focus geometry are required");
    focus.enabled = state.curtain.focus || state.descriptor.grab === "cancelled";
    if (state.curtain.grabbed) {
      const t = handle.getTransform(), p = t.getLocalPosition(), s = t.getLocalScale();
      t.setLocalPosition(new vec3(p.x, p.y - 0.002, p.z));
      t.setLocalScale(new vec3(s.x * 0.88, s.y * 0.88, s.z * 0.88));
    }
    this.label(cell, state.descriptor.name, life);
  }

  private label(cell: SceneObject, name: string, life: boolean): void {
    const source = this.find("CaseLidSurface", this.top(this.parent));
    const visual = source?.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | undefined;
    if (!visual) throw new Error("The state gallery requires the existing physical case surface mesh");
    const base = global.scene.createSceneObject("StatePlinth"); base.setParent(cell);
    const mesh = base.createComponent("Component.RenderMeshVisual"); mesh.mesh = visual.mesh; mesh.materials = visual.materials;
    const a = visual.localAabbMin(), b = visual.localAabbMax();
    base.getTransform().setLocalPosition(new vec3(0, -3, life ? -65 : -2));
    base.getTransform().setLocalScale(new vec3((life ? 100 : 24) / (b.x - a.x), 6 / (b.y - a.y), (life ? 200 : 22) / (b.z - a.z)));
    const label = global.scene.createSceneObject("StateName"); label.setParent(cell);
    if (life) {
      // One calibrated name-plate anchor, raised into the original entry view.
      const platePosition = new vec3(-41, 56, -150);
      const support = global.scene.createSceneObject("StateNameSupport"); support.setParent(cell);
      const surface = support.createComponent("Component.RenderMeshVisual");
      surface.mesh = visual.mesh; surface.materials = visual.materials;
      support.getTransform().setLocalPosition(platePosition);
      support.getTransform().setLocalScale(new vec3(28 / (b.x - a.x), 12 / (b.y - a.y), 1 / (b.z - a.z)));
      label.getTransform().setLocalPosition(new vec3(platePosition.x, platePosition.y, platePosition.z - 0.55));
      // The same borrowed mesh makes a narrow post from the platform to the plate.
      const post = global.scene.createSceneObject("StateNamePost"); post.setParent(cell);
      const postVisual = post.createComponent("Component.RenderMeshVisual");
      postVisual.mesh = visual.mesh; postVisual.materials = visual.materials;
      const postHeight = platePosition.y - 6;
      post.getTransform().setLocalPosition(new vec3(platePosition.x, postHeight / 2, platePosition.z + 0.5));
      post.getTransform().setLocalScale(new vec3(1.6 / (b.x - a.x), postHeight / (b.y - a.y), 1 / (b.z - a.z)));
    } else label.getTransform().setLocalPosition(new vec3(0, -3, -13.2));
    label.getTransform().setLocalRotation(quat.fromEulerAngles(0, Math.PI, 0));
    const text = label.createComponent("Component.Text"); applyMuseumFont(text, this.fonts, "regular");
    text.text = name; text.size = 96; text.depthTest = true;
    text.horizontalAlignment = HorizontalAlignment.Center; text.verticalAlignment = VerticalAlignment.Center;
    text.horizontalOverflow = HorizontalOverflow.Wrap; text.verticalOverflow = VerticalOverflow.Shrink;
    text.layoutRect = Rect.create(-11, 11, -2.5, 2.5); text.textFill.color = new vec4(0.94, 0.94, 0.85, 1);
  }

  private find(name: string, node: SceneObject): SceneObject | undefined {
    if (node.name === name) return node;
    for (let i = 0; i < node.getChildrenCount(); i++) { const found = this.find(name, node.getChild(i)); if (found) return found; }
    return undefined;
  }
  private top(node: SceneObject): SceneObject { while (node.getParent()) node = node.getParent(); return node; }
  private hideSourceArt(): void {
    // Only the museum's own named art roots. Never hide the Preview room,
    // arbitrary user objects, a camera/light subtree, or the gallery itself.
    const ownedNames = new Set([
      "Theatre", "MuseumBuilding", "MuseumMirrorNiche", "CaseLidPivot", "MuseumCaseLid",
      "BenchCameoPrints", "Anchor_EntryClock_LiveDial", "Anchor_HallClock_LiveDial",
      "WorkshopDeskClock", "WorkshopClock_LiveDial", "PublicRecordedGlass", "EntryRecordedGlass",
      "CaseViewSightFrame", "CaseLeatherTitleInk", "FirstCaseSheetMount",
    ]);
    const anchor = this.parent.getParent();
    const scope = anchor?.name === "MuseumAnchor" ? anchor : this.parent;
    const protectedView = (node: SceneObject): boolean => {
      if (node.getComponent("Component.Camera") || node.getComponent("Component.LightSource")) return true;
      for (let i = 0; i < node.getChildrenCount(); i++) if (protectedView(node.getChild(i))) return true;
      return false;
    };
    const visit = (node: SceneObject): void => {
      if (node === this.root) return;
      if (node !== scope && node !== this.parent && ownedNames.has(node.name) && !protectedView(node)) {
        this.hide(node); return;
      }
      for (let i = 0; i < node.getChildrenCount(); i++) visit(node.getChild(i));
    };
    visit(scope);
  }
  private hide(node: SceneObject): void {
    if (this.hidden.some(item => item.node === node)) return;
    this.hidden.push({ node, enabled: node.enabled }); node.enabled = false;
  }
  read() { return { active: !!this.root, samples: this.states.map(s => ({ name: s.descriptor.name,
    tick: s.author.tick, scale: s.descriptor.scale, aperture: s.author.draft.room.mirror!.aperture,
    grabbed: s.curtain.grabbed, returnedAperture: s.returnedAperture })), ...this.counts }; }
  dispose(): void {
    if (this.root) { this.root.destroy(); this.root = undefined; }
    for (const item of this.hidden) item.node.enabled = item.enabled;
    this.hidden = []; this.states = []; this.counts.nodes = 0; this.counts.visuals = 0;
  }
}
