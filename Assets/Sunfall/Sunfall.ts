import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { NEW_YORK, Place, sunAngles, sunVector, sunriseSunset, dayLabel, clockLabel } from "./Solar";
import { cast, seesSun, KNOWN_WINDOWS, WindowFrame, WALL_X, FLOOR_Y, OCCLUDERS, insideRoom, SurfaceId, receivers, comp } from "./Room";

// Sunfall: look at a window and see where the sun will fall in the room at any hour of any day.

const YEAR = 2026;
const NL = String.fromCharCode(10);
const JUN21 = 172, DEC21 = 355;
const SUN_DIST = 900;
const PROXY_K = 0.35;
const WARM = new vec4(1.0, 0.86, 0.62, 1);

type Layout = { name: string; components: number }[];
const LAYOUT: Layout = [
  { name: "position", components: 3 },
  { name: "normal", components: 3 },
  { name: "texture0", components: 2 },
];

class Dyn {
  obj: SceneObject;
  visual: RenderMeshVisual;
  mb: MeshBuilder;
  mat: Material;
  constructor(parent: SceneObject, name: string, mat: Material, order: number) {
    this.obj = global.scene.createSceneObject(name);
    this.obj.setParent(parent);
    this.visual = this.obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.mb = new MeshBuilder(LAYOUT);
    this.mb.topology = MeshTopology.Triangles;
    this.mb.indexType = MeshIndexType.UInt16;
    this.mat = mat;
    this.visual.mainMaterial = mat;
    this.visual.setRenderOrder(order);
    this.visual.enabled = false;
  }
  set(v: number[], i: number[]) {
    const vc = this.mb.getVerticesCount(), ic = this.mb.getIndicesCount();
    if (ic > 0) this.mb.eraseIndices(0, ic);
    if (vc > 0) this.mb.eraseVertices(0, vc);
    if (i.length === 0 || v.length === 0) { this.visual.enabled = false; return; }
    this.mb.appendVerticesInterleaved(v);
    this.mb.appendIndices(i);
    this.mb.updateMesh();
    if (!this.visual.mesh) this.visual.mesh = this.mb.getMesh();
    this.visual.enabled = true;
  }
}

// Collects quads into interleaved vertex/index arrays.
class Quads {
  v: number[] = [];
  i: number[] = [];
  vert(p: vec3, n: vec3, u: number, w: number) {
    this.v.push(p.x, p.y, p.z, n.x, n.y, n.z, u, w);
    return this.v.length / 8 - 1;
  }
  quad(a: vec3, b: vec3, c: vec3, d: vec3, n: vec3, uv: number[]) {
    if (this.v.length / 8 > 64000) return;
    const s = this.vert(a, n, uv[0], uv[1]);
    this.vert(b, n, uv[2], uv[3]);
    this.vert(c, n, uv[4], uv[5]);
    this.vert(d, n, uv[6], uv[7]);
    this.i.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }
  sprite(c: vec3, right: vec3, up: vec3, size: number) {
    const r = right.uniformScale(size / 2), u = up.uniformScale(size / 2);
    this.quad(c.sub(r).sub(u), c.add(r).sub(u), c.add(r).add(u), c.sub(r).add(u), vec3.forward(), [0, 0, 1, 0, 1, 1, 0, 1]);
  }
}

interface Mote { u: number; v: number; t: number; speed: number; phase: number; win: number; }
interface Plant { obj: SceneObject; pos: vec3; label: Text; detail: Text; verdict: Text; ring: SceneObject; born: number; stem: SceneObject; }
interface Button { obj: SceneObject; disc: RenderMeshVisual; ring: RenderMeshVisual; label: Text; hover: number; hoverT: number; pop: number; action: () => void; }

@component
export class Sunfall extends BaseScriptComponent {
  @input camera: SceneObject;
  @input matAdd: Material;
  @input matAlpha: Material;
  @input texWindow: Texture;
  @input texShaft: Texture;
  @input texGlow: Texture;
  @input texSun: Texture;
  @input texRamp: Texture;
  @input texDisc: Texture;
  @input texRing: Texture;
  @input font: Font;
  @input windowAzimuth: number = 200; // compass bearing the window looks out to (south-southwest)
  @input autoMarkAll: boolean = false;
  @input startDay: number = -1; // -1: today
  @input demoScript: string = ""; // recording aid: timed commands that drive the same actions a hand would
  @input dockAtStart: boolean = false;
  @input timeScale: number = 1; // test aid: show the buttons before the first sun drag
  @input startMinutes: number = -1; // -1: the current clock in the chosen city

  private place: Place = NEW_YORK;
  private day = 313;
  private minutes = 600;
  private shownMinutes = 600;
  private shownDay = 313;
  private windows: WindowFrame[] = [];
  private pending: vec3 | null = null;
  private s = new vec3(1, 0.3, 0);
  private intensity = 0; // 0..1 fade of everything light-related
  private time = 0;

  private root: SceneObject;
  private patch: Map<SurfaceId, Dyn> = new Map();
  private shafts: Dyn;
  private motes: Dyn;
  private glass: Dyn;
  private frames: Dyn;
  private arc: Dyn;
  private seasons: Dyn;
  private heat: Dyn;
  private sunObj: SceneObject;
  private sunCore: RenderMeshVisual;
  private sunHalo: RenderMeshVisual;
  private sunLabel: Text;
  private hourLabels: Text[] = [];
  private seasonLabels: Text[] = [];
  private hint: Text;
  private hintObj: SceneObject;
  private hintTarget = "";
  private dock: SceneObject;
  private buttons: Button[] = [];
  private moteList: Mote[] = [];
  private plants: Plant[] = [];
  private placing = false;
  private hoverFrame = -1;
  private dragging = false;
  private dragged = false;
  private heatHours: Float32Array | null = null;
  private heatDay = -1;
  private playing = false;
  private playFrom = 0;
  private playTo = 0;
  private playT = 0;
  private playLast = -1;
  private returnTo = 600;
  private mapOn = false;
  private mapFade = 0;
  private heatLabel: Text;
  private sunTable: { day: number; mins: number; v: vec3 }[] = [];
  private occluders: SceneObject;

  // floor grid for the sun-hour map
  private gx0 = -265; private gz0 = -535; private gStep = 8; private gnx = 61; private gnz = 88;

  onAwake() {
    this.root = global.scene.createSceneObject("SunfallRoot");
    const add = (tex: Texture, color: vec4) => {
      const m = this.matAdd.clone();
      m.mainPass.baseTex = tex;
      m.mainPass.baseColor = color;
      return m;
    };
    const ids: SurfaceId[] = ["floor", "farWall", "leftWall", "backWall", "sofa", "table", "console", "desk"];
    for (const id of ids) this.patch.set(id, new Dyn(this.root, "Light_" + id, add(this.texWindow, WARM), 20));
    this.shafts = new Dyn(this.root, "Shafts", add(this.texShaft, new vec4(0.22, 0.18, 0.12, 1)), 30);
    this.motes = new Dyn(this.root, "Motes", add(this.texGlow, new vec4(0.9, 0.8, 0.6, 1)), 31);
    this.glass = new Dyn(this.root, "WindowGlow", add(this.texWindow, new vec4(0.5, 0.42, 0.3, 1)), 19);
    this.frames = new Dyn(this.root, "Frames", add(this.texGlow, new vec4(1, 0.8, 0.5, 1)), 32);
    this.arc = new Dyn(this.root, "SunPath", add(this.texGlow, new vec4(1, 0.82, 0.5, 1)), 33);
    this.seasons = new Dyn(this.root, "Seasons", add(this.texGlow, new vec4(0.55, 0.5, 0.42, 1)), 33);
    this.heat = new Dyn(this.root, "SunHours", add(this.texRamp, new vec4(1, 1, 1, 1)), 18);
    this.shafts.mat.mainPass.depthTest = false;
    this.motes.mat.mainPass.depthTest = false;
    this.buildOccluders();
    this.buildSun();
    this.buildHint();
    this.buildDock();
    this.buildWallInput();
    this.buildFloorInput();
    this.buildSunTable();
    this.heatLabel = this.text(this.root, "", 1, new vec4(1, 0.9, 0.7, 1));
    this.heatLabel.getSceneObject().enabled = false;
    for (let k = 0; k < 90; k++) this.moteList.push({ u: Math.random(), v: Math.random(), t: Math.random(), speed: 0.02 + Math.random() * 0.05, phase: Math.random() * 6.28, win: k });

    this.setNow();
    if (this.startDay > 0) this.day = this.startDay;
    if (this.startMinutes >= 0) this.minutes = this.startMinutes;
    this.shownDay = this.day; this.shownMinutes = this.minutes;
    if (this.autoMarkAll) for (const w of KNOWN_WINDOWS) this.windows.push(w);
    this.setHint(this.windows.length ? "sun" : "mark");
    this.buildCursor();
    this.createEvent("TouchStartEvent").bind(() => this.onTouch());
    this.parseDemo();
    this.createEvent("UpdateEvent").bind(() => this.update());
  }

  // ---------- setup ----------

  private quadMesh(size: number): RenderMesh {
    const mb = new MeshBuilder(LAYOUT);
    mb.topology = MeshTopology.Triangles;
    mb.indexType = MeshIndexType.UInt16;
    const h = size / 2;
    mb.appendVerticesInterleaved([-h, -h, 0, 0, 0, 1, 0, 0, h, -h, 0, 0, 0, 1, 1, 0, h, h, 0, 0, 0, 1, 1, 1, -h, h, 0, 0, 0, 1, 0, 1]);
    mb.appendIndices([0, 1, 2, 0, 2, 3]);
    mb.updateMesh();
    return mb.getMesh();
  }

  private sprite(parent: SceneObject, name: string, mat: Material, size: number, order: number): RenderMeshVisual {
    const o = global.scene.createSceneObject(name);
    o.setParent(parent);
    const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    v.mesh = this.quadMesh(size);
    v.mainMaterial = mat;
    v.setRenderOrder(order);
    return v;
  }

  private text(parent: SceneObject, words: string, height: number, color: vec4): Text {
    const o = global.scene.createSceneObject("Text");
    o.setParent(parent);
    const t = o.createComponent("Component.Text") as Text;
    if (this.font) t.font = this.font;
    t.size = 48;
    t.text = words;
    t.textFill.color = color;
    t.horizontalAlignment = HorizontalAlignment.Center;
    t.verticalAlignment = VerticalAlignment.Center;
    t.depthTest = false;
    t.setRenderOrder(60);
    o.getTransform().setLocalScale(vec3.one().uniformScale(height * 1.9));
    return t;
  }

  private buildOccluders() {
    // Depth-only stand-ins for the furniture, so light on the floor hides behind the sofa like it would in the room.
    this.occluders = global.scene.createSceneObject("Occluders");
    this.occluders.setParent(this.root);
    const m = this.matAlpha.clone();
    m.mainPass.colorMask = new vec4b(false, false, false, false);
    m.mainPass.depthWrite = true;
    m.mainPass.depthTest = true;
    m.mainPass.baseColor = new vec4(0, 0, 0, 1);
    for (const b of OCCLUDERS) {
      const o = global.scene.createSceneObject("Occluder");
      o.setParent(this.occluders);
      const v = o.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      const mb = new MeshBuilder(LAYOUT);
      mb.topology = MeshTopology.Triangles;
      mb.indexType = MeshIndexType.UInt16;
      const q = new Quads();
      const a = b.min, c = b.max;
      const P = (x: number, y: number, z: number) => new vec3(x, y, z);
      const uv = [0, 0, 1, 0, 1, 1, 0, 1];
      q.quad(P(a.x, c.y, a.z), P(c.x, c.y, a.z), P(c.x, c.y, c.z), P(a.x, c.y, c.z), vec3.up(), uv);
      q.quad(P(a.x, a.y, c.z), P(c.x, a.y, c.z), P(c.x, c.y, c.z), P(a.x, c.y, c.z), vec3.forward(), uv);
      q.quad(P(a.x, a.y, a.z), P(a.x, c.y, a.z), P(c.x, c.y, a.z), P(c.x, a.y, a.z), vec3.back(), uv);
      q.quad(P(a.x, a.y, a.z), P(a.x, a.y, c.z), P(a.x, c.y, c.z), P(a.x, c.y, a.z), vec3.left(), uv);
      q.quad(P(c.x, a.y, a.z), P(c.x, c.y, a.z), P(c.x, c.y, c.z), P(c.x, a.y, c.z), vec3.right(), uv);
      mb.appendVerticesInterleaved(q.v);
      mb.appendIndices(q.i);
      mb.updateMesh();
      v.mesh = mb.getMesh();
      v.mainMaterial = m;
      v.setRenderOrder(-50);
    }
  }

  private buildSun() {
    this.sunObj = global.scene.createSceneObject("Sun");
    this.sunObj.setParent(this.root);
    const halo = this.matAdd.clone();
    halo.mainPass.baseTex = this.texGlow;
    halo.mainPass.baseColor = new vec4(0.9, 0.62, 0.3, 1);
    this.sunHalo = this.sprite(this.sunObj, "Halo", halo, 360, 40);
    const core = this.matAdd.clone();
    core.mainPass.baseTex = this.texSun;
    core.mainPass.baseColor = new vec4(1, 0.95, 0.85, 1);
    this.sunCore = this.sprite(this.sunObj, "Core", core, 120, 41);
    const label = global.scene.createSceneObject("SunLabelMount");
    label.setParent(this.sunObj);
    label.getTransform().setLocalPosition(new vec3(0, 110, 0));
    this.sunLabel = this.text(label, "", 21, new vec4(1, 0.93, 0.8, 1));
    this.sunLabel.dropshadowSettings.enabled = true;
    this.sunLabel.dropshadowSettings.fill.color = new vec4(0.05, 0.03, 0.02, 0.6);
    for (let h = 0; h < 8; h++) this.hourLabels.push(this.text(this.root, "", 20, new vec4(1, 0.85, 0.6, 0.85)));
    for (let k = 0; k < 2; k++) this.seasonLabels.push(this.text(this.root, k === 0 ? "June 21" : "Dec 21", 20, new vec4(0.85, 0.8, 0.72, 0.8)));
    // The sun is 9 m out, beyond a hand ray's reach, so the grab target sits on the line of sight
    // to the sun, 2.4 m from the eyes, at the same angular size.
    this.grabObj = global.scene.createSceneObject("SunGrab");
    this.grabObj.setParent(this.root);
    const collider = this.grabObj.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape = Shape.createSphereShape();
    shape.radius = 11;
    collider.shape = shape;
    const input = this.grabObj.createComponent(Interactable.getTypeName()) as Interactable;
    input.onDragStart.add((e) => { if (!this.accept(e)) return; this.dragging = true; this.dragged = true; this.playing = false; this.setHint(""); });
    input.onDragUpdate.add((e) => { if (this.dragging && this.accept(e)) this.dragSun(e.interactor.startPoint, e.interactor.direction); });
    input.onDragEnd.add(() => { this.dragging = false; if (this.mapOn) this.computeHeat(this.day, true); });
    input.onHoverEnter.add((e) => { if (this.accept(e)) this.sunHover = 1; });
    input.onHoverExit.add((e) => { if (this.accept(e)) this.sunHover = 0; });
  }
  private grabObj: SceneObject;
  // Hand rays reach only a few meters, so the wall and floor targets are copies of the real ones scaled
  // toward the eyes by PROXY_K. Scaling about the eye keeps their outline exactly where the real surfaces appear.
  private proxies: { obj: SceneObject; center: vec3 }[] = [];
  private eye = new vec3(0, 0, 0);
  private unproxy(p: vec3): vec3 {
    return this.eye.add(p.sub(this.eye).uniformScale(1 / PROXY_K));
  }
  private placeProxies(camPos: vec3) {
    this.eye = camPos;
    for (const pr of this.proxies) {
      const t = pr.obj.getTransform();
      t.setWorldPosition(camPos.add(pr.center.sub(camPos).uniformScale(PROXY_K)));
      t.setWorldScale(vec3.one().uniformScale(PROXY_K));
    }
  }
  private sunHover = 0;
  private sunHoverS = 0;

  private buildHint() {
    this.hintObj = global.scene.createSceneObject("Hint");
    this.hintObj.setParent(this.root);
    this.hint = this.text(this.hintObj, "", 1.5, new vec4(1, 0.95, 0.86, 1));
    this.hint.dropshadowSettings.enabled = true;
    this.hint.dropshadowSettings.fill.color = new vec4(0, 0, 0, 0.55);
  }

  private buildDock() {
    this.dock = global.scene.createSceneObject("Dock");
    this.dock.setParent(this.root);
    const defs: [string, () => void][] = [
      ["Play the day", () => this.togglePlay()],
      ["Add a plant", () => this.startPlacing()],
      ["Now", () => { this.setNow(); this.playing = false; if (this.mapOn) this.computeHeat(this.day, true); }],
    ];
    defs.forEach(([name, action], k) => {
      const o = global.scene.createSceneObject("Button_" + name);
      o.setParent(this.dock);
      o.getTransform().setLocalPosition(new vec3((k - 1) * 7.6, 0, 0));
      const dm = this.matAlpha.clone();
      dm.mainPass.baseTex = this.texDisc;
      dm.mainPass.baseColor = new vec4(0.09, 0.075, 0.06, 0.78);
      dm.mainPass.depthTest = false;
      const disc = this.sprite(o, "Disc", dm, 6.2, 55);
      const rm = this.matAlpha.clone();
      rm.mainPass.baseTex = this.texRing;
      rm.mainPass.baseColor = new vec4(1, 0.78, 0.45, 0.55);
      rm.mainPass.depthTest = false;
      const ring = this.sprite(o, "Ring", rm, 6.2, 56);
      const label = this.text(o, name, 0.6, new vec4(1, 0.95, 0.88, 1));
      label.getSceneObject().getTransform().setLocalPosition(new vec3(0, 0, 0.1));
      const words = name.split(" ");
      label.text = words.length > 2 ? words[0] + " " + words[1] + "\n" + words.slice(2).join(" ") : name.replace(" a ", "\na ");
      const collider = o.createComponent("Physics.ColliderComponent") as ColliderComponent;
      const shape = Shape.createSphereShape();
      shape.radius = 3.6;
      collider.shape = shape;
      const input = o.createComponent(Interactable.getTypeName()) as Interactable;
      const b: Button = { obj: o, disc, ring, label, hover: 0, hoverT: -10, pop: 0, action };
      input.onHoverEnter.add((e) => { if (this.accept(e)) b.hoverT = this.time; });
      input.onHoverUpdate.add((e) => { if (this.accept(e)) b.hoverT = this.time; });
      input.onHoverExit.add((e) => { if (this.accept(e)) b.hoverT = -10; });
      input.onTriggerStart.add((e) => { if (!this.accept(e) || this.time - this.lastButton < 0.4) return; this.lastButton = this.time; b.pop = 1; action(); });
      this.buttons.push(b);
    });
    this.dock.enabled = false;
  }

  private buildWallInput() {
    // An invisible slab over the window wall. Pinching it marks the window under the pointer.
    const o = global.scene.createSceneObject("WindowWallInput");
    o.setParent(this.root);
    this.proxies.push({ obj: o, center: new vec3(WALL_X - 2, -40, -185) });
    const collider = o.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape = Shape.createBoxShape();
    shape.size = new vec3(4, 260, 720);
    collider.shape = shape;
    const input = o.createComponent(Interactable.getTypeName()) as Interactable;
    // The pinch can be reported by a different interactor than the one pointing (in Preview, the simulated
    // hand pinches while the mouse ray points), so the pinch uses the last point the pointer hovered.
    let hoverAt: vec3 | null = null, hoverTime = -10;
    input.onHoverUpdate.add((e) => {
      if (!this.accept(e)) return;
      const p = this.rayHit(e.interactor, 0, WALL_X);
      if (p) { hoverAt = p; hoverTime = this.time; this.wallHover = p; this.wallHoverTime = this.time; }
      this.hoverFrame = p ? this.frameAt(p) : -1;
    });
    input.onHoverExit.add(() => (this.hoverFrame = -1));
    input.onTriggerStart.add((e) => {
      if (!this.accept(e)) return;
      const p = this.time - hoverTime < 0.5 && hoverAt ? hoverAt : this.rayHit(e.interactor, 0, WALL_X);
      if (p && this.time - this.lastButton > 0.3 && !this.overButton(p)) this.pinchWall(p);
    });
  }

  private buildFloorInput() {
    const o = global.scene.createSceneObject("FloorInput");
    o.setParent(this.root);
    this.proxies.push({ obj: o, center: new vec3(-25, FLOOR_Y - 1, -185) });
    const collider = o.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape = Shape.createBoxShape();
    shape.size = new vec3(490, 2, 720);
    collider.shape = shape;
    const input = o.createComponent(Interactable.getTypeName()) as Interactable;
    let hoverAt: vec3 | null = null, hoverTime = -10;
    input.onHoverUpdate.add((e) => {
      if (!this.accept(e)) return;
      const p = this.rayHit(e.interactor, 1, FLOOR_Y);
      if (p) { hoverAt = p; hoverTime = this.time; this.floorHover = p; this.floorHoverTime = this.time; }
    });
    input.onTriggerStart.add((e) => {
      if (!this.accept(e)) return;
      const q = this.time - hoverTime < 0.5 && hoverAt ? hoverAt : this.rayHit(e.interactor, 1, FLOOR_Y);
      if (this.placing && q && !this.overButton(q)) this.addPlant(new vec3(q.x, FLOOR_Y, q.z));
    });
  }

  // Sun directions for every 6 minutes of every 3rd day between the solstices, for the drag search.
  private buildSunTable() {
    this.sunTable = [];
    for (let d = JUN21; d <= DEC21; d += 3)
      for (let m = 240; m <= 1260; m += 6) {
        const a = sunAngles(this.place, YEAR, d, m);
        if (a.elevation < -2) continue;
        const v = sunVector(a, this.windowAzimuth);
        this.sunTable.push({ day: d, mins: m, v: new vec3(v[0], v[1], v[2]) });
      }
  }

  // ---------- state changes ----------

  private setNow() {
    let d = 313, m = 600;
    try {
      const now = new Date();
      const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
      const start = Date.UTC(now.getUTCFullYear(), 0, 1);
      d = Math.floor((now.getTime() - start) / 86400000) + 1;
      m = utcMin + this.place.utcOffset(d) * 60;
      if (m < 0) { m += 1440; d -= 1; }
      if (m >= 1440) { m -= 1440; d += 1; }
    } catch (e) { /* keep the defaults */ }
    this.day = Math.max(1, Math.min(365, d));
    this.minutes = m;
  }

  // Where the interactor's ray meets the real wall (axis 0) or floor (axis 1). The proxies only catch the event.
  private rayHit(it: { startPoint: vec3 | null; direction: vec3 | null; targetHitPosition: vec3 | null }, axis: 0 | 1, value: number): vec3 | null {
    let o = it.startPoint, d = it.direction;
    if (!o || !d) {
      // no ray reported: assume it came from the eyes through the proxy hit
      const h = it.targetHitPosition;
      if (!h) return null;
      o = this.eye;
      d = h.sub(this.eye).normalize();
    }
    const dk = axis === 0 ? d.x : d.y, ok = axis === 0 ? o.x : o.y;
    if (Math.abs(dk) < 1e-5) return null;
    const t = (value - ok) / dk;
    return t > 0 ? o.add(d.uniformScale(t)) : null;
  }

  private wallHover: vec3 | null = null; private wallHoverTime = -10;
  private floorHover: vec3 | null = null; private floorHoverTime = -10;
  private lastButton = -10;

  // A second path for pinches: a touch/click anywhere acts on whatever the pointer hovers right now.
  // In Preview, SIK sometimes reports hover but drops the trigger; this keeps every click working.
  private onTouch() {
    if (this.dragging) return;
    // a button the interaction kit says is under the pointer wins
    let pick: Button | null = null;
    for (const b of this.buttons) if (b.hover > 0 && this.dock.enabled && (!pick || b.hoverT > pick.hoverT)) pick = b;
    if (pick) {
      if (this.time - this.lastButton < 0.4) return;
      this.lastButton = this.time; pick.pop = 1; pick.action(); return;
    }
    // otherwise test the buttons along the pointer ray (eyes through the freshest hovered point)
    const useWall = this.wallHoverTime >= this.floorHoverTime;
    const pt = useWall ? this.wallHover : this.floorHover;
    const fresh = this.time - Math.max(this.wallHoverTime, this.floorHoverTime) < 0.8;
    if (pt && fresh && this.dock.enabled) {
      const dir = pt.sub(this.eye).normalize();
      for (const b of this.buttons) {
        const c = b.obj.getTransform().getWorldPosition();
        const t = c.sub(this.eye).dot(dir);
        if (t > 0 && c.distance(this.eye.add(dir.uniformScale(t))) < 3.4) {
          if (this.time - this.lastButton < 0.4) return;
          this.lastButton = this.time; b.pop = 1; b.action(); return;
        }
      }
    }
    if (this.placing && this.floorHover && this.time - this.floorHoverTime < 0.8) { this.addPlant(new vec3(this.floorHover.x, FLOOR_Y, this.floorHover.z)); return; }
    if (this.wallHover && this.time - this.wallHoverTime < 0.8 && this.sunHover === 0) this.pinchWall(this.wallHover);
  }

  private overButton(pt: vec3): boolean {
    if (!this.dock.enabled) return false;
    const dir = pt.sub(this.eye).normalize();
    for (const b of this.buttons) {
      const c = b.obj.getTransform().getWorldPosition();
      const t = c.sub(this.eye).dot(dir);
      if (t > 0 && c.distance(this.eye.add(dir.uniformScale(t))) < 3.4) return true;
    }
    return false;
  }

  // In Preview both a mouse pointer and a simulated hand (whose ray stays fixed ahead) send events.
  // While the mouse is in use, only its events count; on Specs the hands are the only interactors.
  private lastMouse = -10;
  private accept(e: { interactor: { inputType: number } }): boolean {
    if (e.interactor.inputType === 32) { this.lastMouse = this.time; return true; }
    return this.time - this.lastMouse > 2;
  }

  private lastPinch = -10;
  private pinchWall(p: vec3) {
    if (this.time - this.lastPinch < 0.4) return;
    this.lastPinch = this.time;
    this.markAt(p);
  }

  private frameAt(p: vec3): number {
    for (let k = 0; k < KNOWN_WINDOWS.length; k++) {
      const w = KNOWN_WINDOWS[k];
      if (p.z > w.z0 - 12 && p.z < w.z1 + 12 && p.y > w.y0 - 12 && p.y < w.y1 + 12) return k;
    }
    return -1;
  }

  private markAt(p: vec3) {
    const k = this.frameAt(p);
    if (k >= 0) {
      const w = KNOWN_WINDOWS[k];
      const idx = this.windows.indexOf(w);
      if (idx >= 0) this.windows.splice(idx, 1);
      else this.windows.push(w);
      this.pending = null;
    } else if (!this.pending) {
      this.pending = p;
      return;
    } else {
      // Two corners of a window the room scan missed.
      const a = this.pending;
      this.windows.push({ z0: Math.min(a.z, p.z), z1: Math.max(a.z, p.z), y0: Math.min(a.y, p.y), y1: Math.max(a.y, p.y) });
      this.pending = null;
    }
    if (this.windows.length && this.hintTarget === "mark") this.setHint("sun");
    if (this.mapOn) this.computeHeat(this.day, true);
    for (const pl of this.plants) this.updatePlant(pl);
  }

  private dragSun(origin: vec3 | null, dir: vec3 | null) {
    if (!origin || !dir) return;
    const c = this.windowCenter();
    // Find the time and date whose sun sits closest to where the hand points.
    let best = -2, bestK = -1, keepBest = -2, keepK = -1;
    for (let k = 0; k < this.sunTable.length; k++) {
      const e = this.sunTable[k];
      const target = c.add(e.v.uniformScale(SUN_DIST)).sub(origin).normalize();
      const dot = target.dot(dir);
      if (dot > best) { best = dot; bestK = k; }
      if (Math.abs(e.day - this.day) <= 2 && dot > keepBest) { keepBest = dot; keepK = k; }
    }
    if (bestK < 0) return;
    // Prefer keeping today's date unless the hand clearly moved the sun up or down the sky.
    const angBest = Math.acos(Math.min(1, best)), angKeep = keepK >= 0 ? Math.acos(Math.min(1, keepBest)) : 9;
    const k = angKeep - angBest < 0.035 && keepK >= 0 ? keepK : bestK;
    const e = this.sunTable[k];
    if (k === bestK) this.day = e.day;
    this.minutes = e.mins;
    // refine minutes for the chosen day
    let bm = this.minutes, bd = -2;
    for (let m = this.minutes - 6; m <= this.minutes + 6; m += 1) {
      const v = sunVector(sunAngles(this.place, YEAR, this.day, m), this.windowAzimuth);
      const target = c.add(new vec3(v[0], v[1], v[2]).uniformScale(SUN_DIST)).sub(origin).normalize();
      const dot = target.dot(dir);
      if (dot > bd) { bd = dot; bm = m; }
    }
    this.minutes = bm;
  }

  private togglePlay() {
    if (this.playing) { this.playing = false; return; }
    if (this.mapOn && !this.playing) { this.mapOn = false; this.heatLabel.getSceneObject().enabled = false; this.buttons[0].label.text = "Play\nthe day"; return; }
    const [rise, set] = sunriseSunset(this.place, YEAR, this.day);
    let first = -1, last = -1;
    for (let m = Math.ceil(rise); m <= set; m += 5) {
      const v = sunVector(sunAngles(this.place, YEAR, this.day, m), this.windowAzimuth);
      if (v[0] > 0.02 && v[1] > 0) { if (first < 0) first = m; last = m; }
    }
    this.playFrom = first >= 0 ? first - 20 : Math.max(0, rise);
    this.playTo = last >= 0 ? last + 20 : Math.min(1439, set);
    this.returnTo = this.minutes;
    this.playT = 0;
    this.playLast = -1;
    this.playing = true;
    this.mapOn = true;
    this.heatHours = new Float32Array(this.gnx * this.gnz);
    this.heatDay = this.day;
    this.heatLabel.getSceneObject().enabled = false;
    this.buttons[0].label.text = "Hide\nthe map";
  }

  private startPlacing() {
    this.placing = true;
    this.setHint("plant");
  }

  private addPlant(p: vec3) {
    if (!insideRoom(p.x, p.z)) return;
    this.placing = false;
    this.setHint("");
    const obj = global.scene.createSceneObject("Plant");
    obj.setParent(this.root);
    obj.getTransform().setWorldPosition(p);
    const ringMat = this.matAdd.clone();
    ringMat.mainPass.baseTex = this.texRing;
    ringMat.mainPass.baseColor = new vec4(1, 0.8, 0.5, 1);
    const ringObj = global.scene.createSceneObject("Ring");
    ringObj.setParent(obj);
    const rv = this.sprite(ringObj, "RingQuad", ringMat, 34, 50);
    rv.getSceneObject().getTransform().setLocalRotation(quat.fromEulerAngles(-Math.PI / 2, 0, 0));
    ringObj.getTransform().setLocalPosition(new vec3(0, 0.8, 0));
    // a thin stem of light from the ring up to the card, so the number reads as belonging to that spot
    const stemMat = this.matAdd.clone();
    stemMat.mainPass.baseTex = this.texGlow;
    stemMat.mainPass.baseColor = new vec4(0.9, 0.72, 0.45, 1);
    const stemObj = global.scene.createSceneObject("Stem");
    stemObj.setParent(obj);
    const sv = stemObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const smb = new MeshBuilder(LAYOUT);
    smb.topology = MeshTopology.Triangles;
    smb.indexType = MeshIndexType.UInt16;
    const STEM_TOP = 64;
    smb.appendVerticesInterleaved([-1.4, 1, 0, 0, 0, 1, 0, 0.5, 1.4, 1, 0, 0, 0, 1, 1, 0.5, 1.4, STEM_TOP, 0, 0, 0, 1, 1, 0.5, -1.4, STEM_TOP, 0, 0, 0, 1, 0, 0.5]);
    smb.appendIndices([0, 1, 2, 0, 2, 3]);
    smb.updateMesh();
    sv.mesh = smb.getMesh();
    sv.mainMaterial = stemMat;
    sv.setRenderOrder(49);
    const card = global.scene.createSceneObject("Card");
    card.setParent(obj);
    card.getTransform().setLocalPosition(new vec3(0, STEM_TOP + 7, 0));
    const label = this.text(card, "", 4.2, new vec4(1, 0.9, 0.7, 1));
    const verdict = this.text(card, "", 1.35, new vec4(1, 0.95, 0.88, 1));
    verdict.getSceneObject().getTransform().setLocalPosition(new vec3(0, -6.8, 0));
    const detail = this.text(card, "", 1.15, new vec4(0.92, 0.86, 0.76, 1));
    detail.getSceneObject().getTransform().setLocalPosition(new vec3(0, -12.2, 0));
    for (const t of [label, verdict, detail]) {
      t.dropshadowSettings.enabled = true;
      t.dropshadowSettings.fill.color = new vec4(0, 0, 0, 0.6);
    }
    const plant: Plant = { obj, pos: p, label, detail, verdict, ring: ringObj, born: this.time, stem: stemObj };
    this.plants.push(plant);
    if (this.plants.length > 3) { const old = this.plants.shift(); old.obj.destroy(); }
    this.updatePlant(plant);
  }

  private hoursAt(p: vec3, day: number): number {
    let n = 0;
    const q = new vec3(p.x, p.y + 30, p.z);
    for (let m = 240; m <= 1260; m += 10) {
      const a = sunAngles(this.place, YEAR, day, m);
      if (a.elevation <= 0) continue;
      const v = sunVector(a, this.windowAzimuth);
      if (seesSun(q, new vec3(v[0], v[1], v[2]), this.windows)) n++;
    }
    return n / 6;
  }

  private updatePlant(pl: Plant) {
    const h = this.hoursAt(pl.pos, this.day);
    const hDec = this.hoursAt(pl.pos, DEC21), hJun = this.hoursAt(pl.pos, JUN21);
    pl.label.text = fmtHours(h);
    pl.verdict.text = "of direct sun on " + dayLabel(this.day) + "\n" + verdict(h);
    pl.detail.text = "Dec 21  " + fmtHours(hDec) + "      Jun 21  " + fmtHours(hJun);
  }

  private setHint(kind: string) {
    this.hintTarget = kind;
    const words: { [k: string]: string } = {
      mark: "Pinch a window" + NL + "that gets sun",
      sun: "Pinch the sun" + NL + "and drag it",
      plant: "Pinch the floor where" + NL + "the plant will stand",
    };
    this.hintWords = words[kind] ?? "";
    this.hint.text = this.hintWords;
  }

  // ---------- per frame ----------

  private windowCenter(): vec3 {
    const list = this.windows.length ? this.windows : KNOWN_WINDOWS.slice(0, 1);
    let y = 0, z = 0;
    for (const w of list) { y += (w.y0 + w.y1) / 2; z += (w.z0 + w.z1) / 2; }
    return new vec3(WALL_X, y / list.length, z / list.length);
  }

  private update() {
    // timeScale < 1 slows the lens down for frame-by-frame screen recording on a slow preview
    const dt = Math.min(getDeltaTime() * this.timeScale, 0.1);
    this.time += dt;

    const camT = this.camera.getTransform();
    const camPos = camT.getWorldPosition();
    const right = camT.right, up = camT.up;
    this.placeProxies(camPos);
    this.clockHold = Math.max(0, this.clockHold - dt);
    this.runDemo(dt, camPos, camT);

    if (this.playing) {
      this.playT += Math.min(getDeltaTime() * this.timeScale, 0.5) / 9;
      const k = Math.min(1, this.playT);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.minutes = this.playFrom + (this.playTo - this.playFrom) * eased;
      this.accumulateHeat(this.minutes);
      if (k >= 1) { this.playing = false; this.finishHeat(); this.delay(1.2, () => (this.minutes = this.returnTo)); }
    }

    // ease the displayed sun toward the target so jumps animate
    const follow = this.dragging || this.playing ? 1 : 1 - Math.exp(-dt * 5);
    this.shownMinutes += (this.minutes - this.shownMinutes) * follow;
    this.shownDay += (this.day - this.shownDay) * follow;
    const a = sunAngles(this.place, YEAR, Math.round(this.shownDay), this.shownMinutes);
    const sv = sunVector(a, this.windowAzimuth);
    this.s = new vec3(sv[0], sv[1], sv[2]);
    const lit = this.windows.length > 0;
    const enters = this.s.x > 0.02 && a.elevation > 0;
    const target = lit ? (enters ? Math.min(1, Math.max(0.15, a.elevation / 8)) * Math.min(1, this.s.x * 4) : 0) : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 4));

    this.updateLight(camPos, right, up, dt);
    this.updateSun(a.elevation, camPos, right, up, dt);
    this.updateFrames(camPos);
    this.updateHeatVisual(dt);
    this.updateHint(camPos, camT, dt);
    this.updateDock(camPos, camT, dt);

    for (const pl of this.plants) this.updatePlantVisual(pl, camPos, camT);
    if (!this.dragging && !this.playing && (Math.abs(this.lastPlantDay - this.day) > 0.5)) {
      this.lastPlantDay = this.day;
      for (const pl of this.plants) this.updatePlant(pl);
    }
  }
  private lastPlantDay = -1;

  private updateLight(camPos: vec3, right: vec3, up: vec3, dt: number) {
    const d = this.s.uniformScale(-1);
    const per = new Map<SurfaceId, Quads>();
    const shafts = new Quads(), glass = new Quads();
    const lit = this.intensity > 0.01 && this.windows.length > 0;
    if (lit) {
      const recv = receivers();
      for (const w of this.windows) {
        const corners: PV[] = [
          { p: new vec3(WALL_X - 1, w.y0, w.z0), u: 0, v: 0 },
          { p: new vec3(WALL_X - 1, w.y0, w.z1), u: 1, v: 0 },
          { p: new vec3(WALL_X - 1, w.y1, w.z1), u: 1, v: 1 },
          { p: new vec3(WALL_X - 1, w.y1, w.z0), u: 0, v: 1 },
        ];
        for (const r of recv) {
          const dk = comp(d, r.axis);
          if (Math.abs(dk) < 1e-4) continue;
          let poly: PV[] = [];
          let ok = true;
          for (const c of corners) {
            const t = (r.value - comp(c.p, r.axis)) / dk;
            if (t <= 0) { ok = false; break; }
            poly.push({ p: c.p.add(d.uniformScale(t)).add(r.normal.uniformScale(0.6)), u: c.u, v: c.v });
          }
          if (!ok) continue;
          for (const [ax, mn, mx] of r.rect) {
            poly = clip(poly, (p) => comp(p, ax) - mn);
            poly = clip(poly, (p) => mx - comp(p, ax));
          }
          if (r.disc) {
            const dc = r.disc;
            for (let k = 0; k < 20 && poly.length; k++) {
              const a = (k / 20) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
              poly = clip(poly, (p) => dc.r * 0.988 - ((p.x - dc.cx) * nx + (p.z - dc.cz) * nz));
            }
          }
          if (poly.length < 3) continue;
          let q = per.get(r.id);
          if (!q) { q = new Quads(); per.set(r.id, q); }
          const st = q.v.length / 8;
          for (const pv of poly) q.vert(pv.p, r.normal, pv.u, pv.v);
          for (let k = 1; k + 1 < poly.length; k++) q.i.push(st, st + k, st + k + 1);
        }
        // the curtain glows where the sun comes through
        const x = WALL_X - 3;
        glass.quad(new vec3(x, w.y0, w.z0), new vec3(x, w.y0, w.z1), new vec3(x, w.y1, w.z1), new vec3(x, w.y1, w.z0), vec3.left(), [0, 0, 1, 0, 1, 1, 0, 1]);
        // sheets of light between the window and where it lands
        const at = (u: number, v: number) => {
          const o = new vec3(WALL_X - 1, w.y0 + (w.y1 - w.y0) * v, w.z0 + (w.z1 - w.z0) * u);
          const h = cast(o, d);
          return h ? { o, p: h.p } : null;
        };
        const SH = 7;
        for (let k = 0; k < SH; k++) {
          const u = (k + 0.5) / SH;
          const top = at(u, 1), bot = at(u, 0);
          if (top && bot) shafts.quad(top.o, bot.o, bot.p, top.p, vec3.left(), [0, 0, 1, 0, 1, 1, 0, 1]);
        }
        for (let k = 0; k < 4; k++) {
          const v = (k + 0.5) / 4;
          const l = at(0, v), r = at(1, v);
          if (l && r) shafts.quad(l.o, r.o, r.p, l.p, vec3.up(), [0, 0, 1, 0, 1, 1, 0, 1]);
        }
      }
    }
    this.patch.forEach((dyn, id) => {
      const q = per.get(id);
      if (q) dyn.set(q.v, q.i); else dyn.set([], []);
      const n = q && q.v.length ? new vec3(q.v[3], q.v[4], q.v[5]) : vec3.up();
      const lambert = Math.max(0.25, n.dot(this.s));
      const k = this.intensity * (0.55 + 0.45 * lambert);
      dyn.mat.mainPass.baseColor = new vec4(WARM.x * k, WARM.y * k, WARM.z * k, 1);
    });
    this.shafts.set(shafts.v, shafts.i);
    const sk = this.intensity * 0.16;
    this.shafts.mat.mainPass.baseColor = new vec4(sk * 1.0, sk * 0.85, sk * 0.6, 1);
    this.glass.set(glass.v, glass.i);
    const gk = this.intensity * 0.55;
    this.glass.mat.mainPass.baseColor = new vec4(gk, gk * 0.85, gk * 0.62, 1);

    // dust drifting inside the light
    const m = new Quads();
    if (lit) {
      for (const mo of this.moteList) {
        mo.t += mo.speed * dt;
        if (mo.t > 1) { mo.t = 0; mo.u = Math.random(); mo.v = Math.random(); }
        const w = this.windows[mo.win % this.windows.length];
        const o = new vec3(WALL_X - 1, w.y0 + (w.y1 - w.y0) * mo.v, w.z0 + (w.z1 - w.z0) * mo.u);
        const h = cast(o, d);
        if (!h) continue;
        const p = vec3.lerp(o, h.p, mo.t * 0.85).add(new vec3(0, Math.sin(this.time * 0.7 + mo.phase) * 3, Math.cos(this.time * 0.5 + mo.phase) * 3));
        const tw = 0.5 + 0.5 * Math.sin(this.time * 2.3 + mo.phase * 3);
        m.sprite(p, right, up, 0.7 + tw * 0.9);
      }
    }
    this.motes.set(m.v, m.i);
    const mk = this.intensity * 0.8;
    this.motes.mat.mainPass.baseColor = new vec4(mk, mk * 0.9, mk * 0.7, 1);
  }

  private updateSun(elevation: number, camPos: vec3, right: vec3, up: vec3, dt: number) {
    const lit = this.windows.length > 0;
    this.sunObj.enabled = lit;
    this.arc.visual.enabled = lit;
    if (!lit) {
      this.arc.set([], []); this.seasons.set([], []);
      for (const t of this.hourLabels) t.getSceneObject().enabled = false;
      for (const t of this.seasonLabels) t.getSceneObject().enabled = false;
      return;
    }
    const c = this.windowCenter();
    const pos = c.add(this.s.uniformScale(SUN_DIST));
    const sunT = this.sunObj.getTransform();
    sunT.setWorldPosition(pos);
    // put the date/time label on the side of the sun that faces the middle of the view, so the
    // glasses' display edge doesn't cut it off
    const toSun = pos.sub(camPos).normalize();
    const fwdC = this.camera.getTransform().forward.uniformScale(-1);
    const upC = this.camera.getTransform().up;
    const above = toSun.dot(upC) - fwdC.dot(upC) < 0.12;
    // near the left or right edge of the display, slide the label toward the middle as well
    const side = toSun.dot(this.camera.getTransform().right);
    const slide = Math.max(-1, Math.min(1, (Math.abs(side) - 0.06) / 0.16)) * (side > 0 ? -1 : 1);
    this.sunLabel.getSceneObject().getParent().getTransform().setLocalPosition(new vec3(Math.abs(side) > 0.06 ? slide * 330 : 0, above ? 110 : -125, 0));
    this.grabObj.getTransform().setWorldPosition(camPos.add(pos.sub(camPos).normalize().uniformScale(100)));
    sunT.setWorldRotation(quat.lookAt(camPos.sub(pos).normalize(), vec3.up()));
    this.sunHoverS += ((this.sunHover || this.dragging ? 1 : 0) - this.sunHoverS) * (1 - Math.exp(-dt * 10));
    const pulse = 1 + 0.04 * Math.sin(this.time * 2.2);
    sunT.setWorldScale(vec3.one().uniformScale((1 + this.sunHoverS * 0.18) * pulse));
    const below = elevation <= 0;
    (this.sunCore.mainMaterial as Material).mainPass.baseColor = below ? new vec4(0.35, 0.3, 0.32, 1) : new vec4(1, 0.95, 0.85, 1);
    (this.sunHalo.mainMaterial as Material).mainPass.baseColor = below ? new vec4(0.12, 0.1, 0.14, 1) : new vec4(0.9, 0.62, 0.3, 1);
    const behind = this.s.x <= 0.02 && !below;
    setText(this.sunLabel, dayLabel(Math.round(this.shownDay)) + "  " + clockLabel(this.shownMinutes) + (below ? "\nbelow the horizon" : behind ? "\nbehind the house" : ""));

    // today's path, plus the summer and winter paths as faint bounds
    const ribbon = (q: Quads, day: number, width: number, labels: Text[] | null) => {
      const path = this.dayPath(day);
      const rise = path.rise, set = path.set;
      const pts: vec3[] = path.dirs.map((v) => c.add(v.uniformScale(SUN_DIST)));
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1];
        const along = b.sub(a).normalize();
        const view = camPos.sub(a).normalize();
        const side = along.cross(view).normalize().uniformScale(width / 2);
        q.quad(a.sub(side), b.sub(side), b.add(side), a.add(side), view, [0.5, 0, 0.5, 0, 0.5, 1, 0.5, 1]);
      }
      if (labels) {
        let li = 0;
        for (let h = 6; h <= 20 && li < labels.length; h += 2) {
          const m = h * 60;
          const t = labels[li];
          if (m < rise + 10 || m > set - 10) continue;
          const v = path.hours[h];
          const p = c.add(v.uniformScale(SUN_DIST)).add(new vec3(0, -42, 0));
          setText(t, h === 12 ? "noon" : (h % 12) + (h < 12 ? " am" : " pm"));
          t.getSceneObject().enabled = true;
          const tt = t.getSceneObject().getTransform();
          tt.setWorldPosition(p);
          tt.setWorldRotation(quat.lookAt(camPos.sub(p).normalize(), vec3.up()));
          li++;
        }
        for (; li < labels.length; li++) labels[li].getSceneObject().enabled = false;
      }
      return pts;
    };
    const q = new Quads();
    ribbon(q, Math.round(this.shownDay), 9, this.hourLabels);
    this.arc.set(q.v, q.i);
    const showSeasons = this.dragging || this.sunHoverS > 0.5;
    this.seasonFade += ((showSeasons ? 1 : 0.35) - this.seasonFade) * (1 - Math.exp(-dt * 6));
    const q2 = new Quads();
    const summer = ribbon(q2, JUN21, 4, null);
    const winter = ribbon(q2, DEC21, 4, null);
    this.seasons.set(q2.v, q2.i);
    const f = this.seasonFade * 0.6;
    this.seasons.mat.mainPass.baseColor = new vec4(f, f * 0.92, f * 0.8, 1);
    [summer, winter].forEach((pts, k) => {
      const t = this.seasonLabels[k];
      if (!pts.length) { t.getSceneObject().enabled = false; return; }
      const end = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.12))];
      const p = end.add(new vec3(0, k === 0 ? 34 : -34, 0));
      t.getSceneObject().enabled = this.seasonFade > 0.45;
      t.textFill.color = new vec4(0.9, 0.85, 0.76, Math.min(1, (this.seasonFade - 0.35) * 1.6));
      const tt = t.getSceneObject().getTransform();
      tt.setWorldPosition(p);
      tt.setWorldRotation(quat.lookAt(camPos.sub(p).normalize(), vec3.up()));
    });
  }
  private seasonFade = 0.35;
  private paths = new Map<number, { rise: number; set: number; dirs: vec3[]; hours: { [h: number]: vec3 } }>();
  private dayPath(day: number) {
    let p = this.paths.get(day);
    if (!p) {
      const [rise, set] = sunriseSunset(this.place, YEAR, day);
      const dirs: vec3[] = [];
      for (let m = rise; m <= set; m += 8) {
        const v = sunVector(sunAngles(this.place, YEAR, day, m), this.windowAzimuth);
        dirs.push(new vec3(v[0], v[1], v[2]));
      }
      const hours: { [h: number]: vec3 } = {};
      for (let h = 6; h <= 20; h += 2) {
        const v = sunVector(sunAngles(this.place, YEAR, day, h * 60), this.windowAzimuth);
        hours[h] = new vec3(v[0], v[1], v[2]);
      }
      p = { rise, set, dirs, hours };
      if (this.paths.size > 400) this.paths.clear();
      this.paths.set(day, p);
    }
    return p;
  }

  private updateFrames(camPos: vec3) {
    // outline the window under the pointer, and pulse the unmarked ones while marking
    const q = new Quads();
    const edge = (a: vec3, b: vec3, w: number) => {
      const along = b.sub(a).normalize();
      const side = along.cross(vec3.left()).normalize().uniformScale(w / 2);
      const n = vec3.left();
      q.quad(a.sub(side), b.sub(side), b.add(side), a.add(side), n, [0.5, 0, 0.5, 0, 0.5, 1, 0.5, 1]);
    };
    const marking = this.hintTarget === "mark";
    KNOWN_WINDOWS.forEach((w, k) => {
      const on = this.windows.indexOf(w) >= 0;
      const hover = this.hoverFrame === k;
      if (!hover && !(marking && !on)) return;
      const x = WALL_X - 4;
      const A = new vec3(x, w.y0, w.z0), B = new vec3(x, w.y0, w.z1), C = new vec3(x, w.y1, w.z1), D = new vec3(x, w.y1, w.z0);
      const wd = hover ? 7 : 4;
      edge(A, B, wd); edge(B, C, wd); edge(C, D, wd); edge(D, A, wd);
    });
    if (this.pending) {
      const p = this.pending.add(new vec3(-4, 0, 0));
      edge(p.add(new vec3(0, -6, 0)), p.add(new vec3(0, 6, 0)), 4);
      edge(p.add(new vec3(0, 0, -6)), p.add(new vec3(0, 0, 6)), 4);
    }
    this.frames.set(q.v, q.i);
    const pul = 0.75 + 0.25 * Math.sin(this.time * 3);
    this.frames.mat.mainPass.baseColor = new vec4(pul, pul * 0.8, pul * 0.5, 1);
  }

  // ---------- sun-hour map ----------

  private cellPos(ix: number, iz: number): vec3 {
    return new vec3(this.gx0 + ix * this.gStep, FLOOR_Y + 1.2, this.gz0 + iz * this.gStep);
  }

  private blocked: Uint8Array = new Uint8Array(0);
  private accumulateHeat(minutes: number) {
    if (!this.heatHours) return;
    if (this.blocked.length !== this.gnx * this.gnz) {
      this.blocked = new Uint8Array(this.gnx * this.gnz);
      for (let ix = 0; ix < this.gnx; ix++)
        for (let iz = 0; iz < this.gnz; iz++) {
          const p = this.cellPos(ix, iz);
          for (const b of OCCLUDERS) if (p.x > b.min.x - 2 && p.x < b.max.x + 2 && p.z > b.min.z - 2 && p.z < b.max.z + 2) this.blocked[ix * this.gnz + iz] = 1;
        }
    }
    const step = 10;
    const from = this.playLast < 0 ? Math.ceil(this.playFrom / step) * step : this.playLast + step;
    for (let m = from; m <= minutes; m += step) {
      const a = sunAngles(this.place, YEAR, this.heatDay, m);
      if (a.elevation > 0) {
        const v = sunVector(a, this.windowAzimuth);
        const s = new vec3(v[0], v[1], v[2]);
        if (s.x > 0.02) {
          // only cells inside each window's floor projection can see the sun through it
          const fy = FLOOR_Y + 1.2;
          for (const w of this.windows) {
            const pts = [[w.y0, w.z0], [w.y0, w.z1], [w.y1, w.z1], [w.y1, w.z0]].map(([y, z]) => {
              const t = (y - fy) / s.y;
              return [WALL_X - s.x * t, z - s.z * t];
            });
            let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
            for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
            const i0 = Math.max(0, Math.floor((x0 - this.gx0) / this.gStep)), i1 = Math.min(this.gnx - 1, Math.ceil((x1 - this.gx0) / this.gStep));
            const k0 = Math.max(0, Math.floor((z0 - this.gz0) / this.gStep)), k1 = Math.min(this.gnz - 1, Math.ceil((z1 - this.gz0) / this.gStep));
            for (let ix = i0; ix <= i1; ix++)
              for (let iz = k0; iz <= k1; iz++) {
                const idx = ix * this.gnz + iz;
                if (this.blocked[idx]) continue;
                const px = this.gx0 + ix * this.gStep, pz = this.gz0 + iz * this.gStep;
                if (!insideQuad(pts, px, pz)) continue;
                if (seesSun(this.cellPos(ix, iz), s, this.windows)) this.heatHours[idx] += step / 60;
              }
          }
        }
      }
      this.playLast = m;
    }
    this.buildHeatMesh();
  }

  private computeHeat(day: number, animate: boolean) {
    this.heatDay = day;
    this.heatHours = new Float32Array(this.gnx * this.gnz);
    const [rise, set] = sunriseSunset(this.place, YEAR, day);
    this.playFrom = rise;
    this.playLast = -1;
    this.accumulateHeat(set);
    this.finishHeat();
    if (animate) this.mapFade = 0.2;
  }

  private finishHeat() {
    if (!this.heatHours) return;
    let best = 0, bi = -1;
    for (let k = 0; k < this.heatHours.length; k++) if (this.heatHours[k] > best) { best = this.heatHours[k]; bi = k; }
    const lbl = this.heatLabel.getSceneObject();
    if (bi < 0 || best < 0.25) {
      lbl.enabled = true;
      this.heatLabel.text = "No direct sun on " + dayLabel(this.heatDay);
      this.heatAnchor = new vec3(0, FLOOR_Y + 60, -150);
      return;
    }
    const ix = Math.floor(bi / this.gnz), iz = bi % this.gnz;
    this.heatAnchor = this.cellPos(ix, iz).add(new vec3(0, 30, 0));
    this.heatLabel.text = fmtHours(best) + " of sun here on " + dayLabel(this.heatDay);
    lbl.enabled = true;
  }
  private heatAnchor = new vec3(0, 0, 0);

  private buildHeatMesh() {
    if (!this.heatHours) return;
    const q = new Quads();
    const H = this.heatHours, nz = this.gnz, s = this.gStep;
    let mx = 0.5;
    for (let k = 0; k < H.length; k++) if (H[k] > mx) mx = H[k];
    const top = Math.max(mx, 3);
    const uvOf = (h: number) => (h <= 0 ? 0.0 : Math.min(0.985, 0.08 + 0.9 * (h / top)));
    for (let ix = 0; ix + 1 < this.gnx; ix++)
      for (let iz = 0; iz + 1 < nz; iz++) {
        const a = H[ix * nz + iz], b = H[(ix + 1) * nz + iz], c = H[(ix + 1) * nz + iz + 1], d = H[ix * nz + iz + 1];
        if (a <= 0 && b <= 0 && c <= 0 && d <= 0) continue;
        const pa = this.cellPos(ix, iz), pb = this.cellPos(ix + 1, iz), pc = this.cellPos(ix + 1, iz + 1), pd = this.cellPos(ix, iz + 1);
        const st = q.v.length / 8;
        q.vert(pa, vec3.up(), uvOf(a), 0.5);
        q.vert(pb, vec3.up(), uvOf(b), 0.5);
        q.vert(pc, vec3.up(), uvOf(c), 0.5);
        q.vert(pd, vec3.up(), uvOf(d), 0.5);
        q.i.push(st, st + 2, st + 1, st, st + 3, st + 2);
        if (q.v.length / 8 > 60000) break;
      }
    this.heat.set(q.v, q.i);
    void s;
  }

  private updateHeatVisual(dt: number) {
    this.mapFade += ((this.mapOn ? 1 : 0) - this.mapFade) * (1 - Math.exp(-dt * 3));
    this.heat.visual.enabled = this.mapFade > 0.02 && !!this.heatHours;
    const f = this.mapFade * 0.9;
    this.heat.mat.mainPass.baseColor = new vec4(f, f, f, 1);
    const lbl = this.heatLabel.getSceneObject();
    if (!this.mapOn) lbl.enabled = false;
    if (this.mapOn && !this.playing) lbl.enabled = !this.plants.some((pl) => pl.pos.distance(new vec3(this.heatAnchor.x, FLOOR_Y, this.heatAnchor.z)) < 120);
    if (lbl.enabled) {
      const camPos = this.camera.getTransform().getWorldPosition();
      const t = lbl.getTransform();
      t.setWorldPosition(this.heatAnchor);
      t.setWorldRotation(quat.lookAt(camPos.sub(this.heatAnchor).normalize(), vec3.up()));
      const dist = camPos.distance(this.heatAnchor);
      t.setWorldScale(vec3.one().uniformScale(Math.max(2.2, dist * 0.012) * 1.9));
    }
  }

  // ---------- UI placement ----------

  private updateHint(camPos: vec3, camT: Transform, dt: number) {
    // while the sun is held, its own label already shows the date and time
    const clock = this.playing || ((!!this.anim || this.clockHold > 0) && !this.dragging);
    if (this.playing) setText(this.hint, dayLabel(this.heatDay) + "  " + clockLabel(this.shownMinutes));
    else if (clock) setText(this.hint, dayLabel(Math.round(this.shownDay)) + "  " + clockLabel(this.shownMinutes));
    else setText(this.hint, this.hintWords);
    const show = this.hint.text.length > 0;
    this.hintObj.enabled = show;
    if (!show) return;
    let p: vec3;
    if (this.hintTarget === "sun" && this.windows.length && !clock) {
      const c = this.windowCenter();
      const sunPos = c.add(this.s.uniformScale(SUN_DIST));
      // hang the hint between the viewer and the sun, so it reads next to it
      p = camPos.add(sunPos.sub(camPos).normalize().uniformScale(120)).add(camT.up.uniformScale(-19));
    } else {
      const fwd = camT.forward.uniformScale(-1);
      p = camPos.add(fwd.uniformScale(90)).add(camT.up.uniformScale(clock ? 14 : -8));
    }
    const t = this.hintObj.getTransform();
    const cur = t.getWorldPosition();
    t.setWorldPosition(this.hintSeen ? vec3.lerp(cur, p, 1 - Math.exp(-dt * 4)) : p);
    this.hintSeen = true;
    t.setWorldRotation(quat.lookAt(camPos.sub(t.getWorldPosition()).normalize(), vec3.up()));
    const a = 0.75 + 0.25 * Math.sin(this.time * 2.4);
    this.hint.textFill.color = new vec4(1, 0.95, 0.86, a);
  }
  private hintSeen = false;
  private hintWords = "";
  private clockHold = 0;

  private updateDock(camPos: vec3, camT: Transform, dt: number) {
    const show = this.windows.length > 0 && (this.dragged || this.dockAtStart) && !this.dragging;
    this.dock.enabled = show;
    if (!show) return;
    const fwd = camT.forward.uniformScale(-1);
    const flat = new vec3(fwd.x, 0, fwd.z).normalize();
    const p = camPos.add(flat.uniformScale(50)).add(new vec3(0, -47, 0));
    const t = this.dock.getTransform();
    const cur = t.getWorldPosition();
    const first = !this.dockSeen;
    this.dockSeen = true;
    t.setWorldPosition(first ? p : vec3.lerp(cur, p, 1 - Math.exp(-dt * 2.5)));
    t.setWorldRotation(quat.lookAt(camPos.sub(t.getWorldPosition()).normalize(), vec3.up()));
    for (const b of this.buttons) {
      b.hover = this.time - b.hoverT < 0.8 ? 1 : 0;
      b.pop = Math.max(0, b.pop - dt * 3);
      const s = 1 + b.hover * 0.12 + Math.sin(b.pop * Math.PI) * 0.18;
      b.obj.getTransform().setLocalScale(vec3.one().uniformScale(s));
      const active = (b.label.text.indexOf("Hide") >= 0) || (b.action && this.placing && b.label.text.indexOf("plant") >= 0);
      const ra = 0.45 + b.hover * 0.45 + (active ? 0.35 : 0);
      (b.ring.mainMaterial as Material).mainPass.baseColor = new vec4(1, 0.78, 0.45, Math.min(1, ra));
    }
  }
  private dockSeen = false;

  // ---------- recording autopilot ----------
  // A demo script is a list of "time command args" separated by ";". It drives the same actions as a hand:
  //   mark K | grab | sun DAY MIN SECONDS | release | press N | floor X Z | hide
  private demo: { t: number; cmd: string; a: number[] }[] = [];
  private demoT = -1;
  private demoNext = 0;
  private anim: { d0: number; m0: number; d1: number; m1: number; t0: number; dur: number } | null = null;
  private cursorObj: SceneObject;
  private cursorRing: RenderMeshVisual;
  private ray: Dyn;
  private cursorPos = new vec3(0, 0, 0);
  private cursorTarget: (() => vec3) | null = null;
  private cursorPinch = 0;
  private cursorShow = 0;

  private buildCursor() {
    this.cursorObj = global.scene.createSceneObject("DemoCursor");
    this.cursorObj.setParent(this.root);
    const m = this.matAdd.clone();
    m.mainPass.baseTex = this.texRing;
    m.mainPass.baseColor = new vec4(1, 1, 1, 1);
    m.mainPass.depthTest = false;
    this.cursorRing = this.sprite(this.cursorObj, "Ring", m, 1, 70);
    const rm = this.matAdd.clone();
    rm.mainPass.baseTex = this.texGlow;
    rm.mainPass.depthTest = false;
    this.ray = new Dyn(this.root, "DemoRay", rm, 69);
    this.cursorObj.enabled = false;
  }

  private parseDemo() {
    if (!this.demoScript) return;
    for (const part of this.demoScript.split(";")) {
      const w = part.trim().split(/\s+/);
      if (w.length < 2) continue;
      this.demo.push({ t: parseFloat(w[0]), cmd: w[1], a: w.slice(2).map((x) => parseFloat(x)) });
    }
    this.demo.sort((a, b) => a.t - b.t);
    this.demoT = 0;
    print("Sunfall demo: " + this.demo.length + " steps");
  }

  private sunPoint(): vec3 {
    return this.windowCenter().add(this.s.uniformScale(SUN_DIST));
  }

  private runDemo(dt: number, camPos: vec3, camT: Transform) {
    for (let k = this.timers.length - 1; k >= 0; k--) {
      this.timers[k].t -= dt;
      if (this.timers[k].t <= 0) { const f = this.timers[k].f; this.timers.splice(k, 1); f(); }
    }
    if (this.demoT < 0) return;
    this.demoT += dt;
    while (this.demoNext < this.demo.length && this.demo[this.demoNext].t <= this.demoT) {
      const c = this.demo[this.demoNext++];
      const a = c.a;
      if (c.cmd === "mark") {
        const w = KNOWN_WINDOWS[a[0]];
        const p = new vec3(WALL_X - 2, (w.y0 + w.y1) / 2, (w.z0 + w.z1) / 2);
        this.cursorTarget = () => p;
        this.delay(0.55, () => { this.cursorPinch = 1; this.markAt(p); });
      } else if (c.cmd === "grab") {
        this.cursorTarget = () => this.sunPoint();
        this.delay(0.55, () => { this.cursorPinch = 1; this.dragging = true; this.dragged = true; this.sunHover = 1; this.setHint(""); this.playing = false; });
      } else if (c.cmd === "sun") {
        this.anim = { d0: this.day, m0: this.minutes, d1: a[0], m1: a[1], t0: this.demoT, dur: Math.max(0.01, a[2]) };
      } else if (c.cmd === "release") {
        this.dragging = false; this.sunHover = 0; this.cursorPinch = 0;
        if (this.mapOn) this.computeHeat(this.day, true);
      } else if (c.cmd === "press") {
        const b = this.buttons[a[0]];
        this.cursorTarget = () => b.obj.getTransform().getWorldPosition();
        this.delay(0.55, () => { this.cursorPinch = 1; b.pop = 1; b.action(); this.delay(0.25, () => (this.cursorPinch = 0)); });
      } else if (c.cmd === "floor") {
        const p = new vec3(a[0], FLOOR_Y, a[1]);
        this.cursorTarget = () => p;
        this.delay(0.55, () => { this.cursorPinch = 1; if (this.placing) this.addPlant(p); this.delay(0.25, () => (this.cursorPinch = 0)); });
      } else if (c.cmd === "hide") {
        this.cursorTarget = null;
      }
      if (c.cmd === "mark") this.delay(0.85, () => (this.cursorPinch = 0));
    }
    if (this.anim) {
      const k = Math.min(1, (this.demoT - this.anim.t0) / this.anim.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.day = Math.round(this.anim.d0 + (this.anim.d1 - this.anim.d0) * e);
      this.minutes = this.anim.m0 + (this.anim.m1 - this.anim.m0) * e;
      if (k >= 1) { this.anim = null; this.clockHold = this.dragging ? 0 : 2.5; }
    }
    // the hand ray and its cursor
    this.cursorShow += ((this.cursorTarget ? 1 : 0) - this.cursorShow) * (1 - Math.exp(-dt * 6));
    this.cursorObj.enabled = this.cursorShow > 0.02;
    if (!this.cursorObj.enabled) { this.ray.set([], []); return; }
    const fwd = camT.forward.uniformScale(-1);
    const hand = camPos.add(camT.right.uniformScale(16)).add(camT.up.uniformScale(-24)).add(fwd.uniformScale(28));
    if (this.cursorTarget) {
      const tgt = this.cursorTarget();
      const first = this.cursorPos.length < 1;
      this.cursorPos = first ? tgt : vec3.lerp(this.cursorPos, tgt, 1 - Math.exp(-dt * 7));
    }
    const ct = this.cursorObj.getTransform();
    ct.setWorldPosition(this.cursorPos);
    ct.setWorldRotation(quat.lookAt(camPos.sub(this.cursorPos).normalize(), vec3.up()));
    const dist = camPos.distance(this.cursorPos);
    const size = dist * 0.045 * (1 - 0.35 * this.cursorPinch) * this.cursorShow;
    ct.setWorldScale(vec3.one().uniformScale(size));
    const br = 0.55 + 0.45 * this.cursorPinch;
    (this.cursorRing.mainMaterial as Material).mainPass.baseColor = new vec4(br, br, br, 1);
    // a thin ray from the hand to the cursor
    const q = new Quads();
    const along = this.cursorPos.sub(hand).normalize();
    const view = camPos.sub(hand).normalize();
    const side = along.cross(view).normalize();
    const w0 = 0.35, w1 = Math.max(0.6, dist * 0.004);
    q.quad(hand.sub(side.uniformScale(w0)), this.cursorPos.sub(side.uniformScale(w1)), this.cursorPos.add(side.uniformScale(w1)), hand.add(side.uniformScale(w0)), view, [0.5, 0, 0.5, 0, 0.5, 1, 0.5, 1]);
    this.ray.set(q.v, q.i);
    const rk = 0.35 * this.cursorShow;
    this.ray.mat.mainPass.baseColor = new vec4(rk, rk, rk, 1);
  }
  private timers: { t: number; f: () => void }[] = [];
  private delay(t: number, f: () => void) { this.timers.push({ t, f }); }

  private updatePlantVisual(pl: Plant, camPos: vec3, camT: Transform) {
    const card = pl.label.getSceneObject().getParent();
    const cp = card.getTransform().getWorldPosition();
    card.getTransform().setWorldRotation(quat.lookAt(camPos.sub(cp).normalize(), vec3.up()));
    const dist = camPos.distance(cp);
    // far away: just the number. Close up: what it means and how the seasons change it.
    const near = dist < 230;
    pl.verdict.getSceneObject().enabled = near;
    pl.detail.getSceneObject().enabled = near;
    const grow = Math.min(1, (this.time - pl.born) * 2.5);
    const e = 1 - Math.pow(1 - grow, 3);
    card.getTransform().setLocalScale(vec3.one().uniformScale(Math.max(1, dist / 160) * (0.4 + 0.6 * e)));
    // the stem rises first, the ring settles with a small overshoot
    const st = pl.stem.getTransform();
    st.setLocalScale(new vec3(1, Math.max(0.01, e), 1));
    const toCam = camPos.sub(pl.pos);
    st.setWorldRotation(quat.lookAt(new vec3(toCam.x, 0, toCam.z).normalize(), vec3.up()));
    const ringK = grow < 1 ? 1 + 0.25 * Math.sin(grow * Math.PI) : 1;
    pl.ring.getTransform().setLocalScale(vec3.one().uniformScale(ringK));
    void camT;
  }
}

interface PV { p: vec3; u: number; v: number; }

// Sutherland-Hodgman: keep the part of a convex polygon where f(p) >= 0, interpolating UVs.
function clip(poly: PV[], f: (p: vec3) => number): PV[] {
  const out: PV[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const fa = f(a.p), fb = f(b.p);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push({ p: vec3.lerp(a.p, b.p, t), u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}

function setText(t: Text, words: string) {
  if (t.text !== words) t.text = words;
}

function insideQuad(q: number[][], x: number, z: number): boolean {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) { const sg = c > 0 ? 1 : -1; if (sign === 0) sign = sg; else if (sg !== sign) return false; }
  }
  return true;
}

function fmtHours(h: number): string {
  if (h < 0.25) return "0 h";
  const whole = Math.floor(h), frac = h - whole;
  if (frac < 0.25) return whole + " h";
  if (frac < 0.75) return (whole === 0 ? "" : whole) + "½ h";
  return whole + 1 + " h";
}

function verdict(h: number): string {
  if (h >= 6) return "Full sun. Herbs and cacti will love it.";
  if (h >= 3) return "Half a day of sun. Citrus and jade.";
  if (h >= 1) return "Some sun. Monstera and pothos.";
  return "Shade. Snake plant or ZZ plant.";
}



