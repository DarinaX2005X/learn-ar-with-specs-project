const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const compilerDir = process.env.PATH.split(path.delimiter).find((d) =>
  fs.existsSync(path.resolve(d, "../typescript/package.json")),
);
assert(
  compilerDir,
  "Run Tests/ObservationContacts/run.ps1 with TypeScript6.0.2",
);
const ts = require(
    path.resolve(compilerDir, "../typescript/lib/typescript.js"),
  ),
  assets = path.resolve(__dirname, "../../Assets"),
  cache = new Map(),
  roots = [];
class MockEvent {
  handlers = [];
  add(f) {
    this.handlers.push(f);
  }
  fire(e = {}) {
    for (const f of [...this.handlers]) f(e);
  }
}
class MockInteractable {
  static getTypeName() {
    return "Interactable";
  }
  constructor() {
    for (const n of [
      "onDragStart",
      "onDragUpdate",
      "onDragEnd",
      "onHoverEnter",
      "onHoverExit",
      "onTriggerStart",
      "onTriggerEnd",
      "onTriggerCanceled",
      "onTriggerEndOutside",
    ])
      this[n] = new MockEvent();
  }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    Object.assign(this, { x, y, z });
  }
  add(v) {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  uniformScale(k) {
    return new Vector3(this.x * k, this.y * k, this.z * k);
  }
  get length() {
    return Math.hypot(this.x, this.y, this.z);
  }
}
class YawRotation {
  constructor(yaw = 0) {
    this.yaw = yaw;
  }
  multiplyVec3(v) {
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    return new Vector3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
  }
  multiply(r) {
    return new YawRotation(this.yaw + r.yaw);
  }
  inverse() {
    return new YawRotation(-this.yaw);
  }
}
class MockMaterial {
  mainPass = {};
  clone() {
    const m = new MockMaterial();
    m.mainPass = { ...this.mainPass };
    return m;
  }
}
class MockSceneObject {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.components = [];
    this.enabled = true;
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.rotation = new YawRotation();
    roots.push(this);
  }
  setParent(p) {
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = p;
    p.children.push(this);
  }
  get isEnabledInHierarchy() {
    return this.enabled && (!this.parent || this.parent.isEnabledInHierarchy);
  }
  getChildrenCount() {
    return this.children.length;
  }
  getChild(i) {
    return this.children[i];
  }
  getTransform() {
    const n = this;
    return {
      setLocalPosition: (p) => (n.position = p),
      setWorldPosition: (p) => (n.position = p),
      getLocalPosition: () => n.position,
      getWorldPosition: () => n.position,
      setLocalRotation: (r) => (n.rotation = r),
      setWorldRotation: (r) => (n.rotation = r),
      getWorldRotation: () => n.rotation,
      setLocalScale: (s) => (n.scale = s),
      setWorldScale: (s) => (n.scale = s),
      getWorldScale: () => n.scale,
      getWorldTransform: () => ({
        multiplyPoint: (p) =>
          n.rotation
            .multiplyVec3(
              new Vector3(p.x * n.scale.x, p.y * n.scale.y, p.z * n.scale.z),
            )
            .add(n.position),
        multiplyDirection: (p) => n.rotation.multiplyVec3(p),
      }),
      getInvertedWorldTransform: () => ({
        multiplyPoint: (p) =>
          n.rotation.inverse().multiplyVec3(p.add(n.position.uniformScale(-1))),
        multiplyDirection: (p) => n.rotation.inverse().multiplyVec3(p),
      }),
    };
  }
  createComponent(type) {
    const c =
      type === "Interactable"
        ? new MockInteractable()
        : type === "Component.Text"
          ? { textFill: {}, layoutRect: {} }
          : {};
    c.type = type;
    this.components.push(c);
    return c;
  }
  getComponent(type) {
    return this.components.find((c) => c.type === type);
  }
  copySceneObject(child) {
    const n = new MockSceneObject(child.name);
    n.setParent(this);
    n.position = child.position;
    n.scale = child.scale;
    n.rotation = child.rotation;
    n.components = child.components.map((c) => ({ ...c }));
    return n;
  }
  destroy() {
    for (const c of [...this.children]) c.destroy();
    this.enabled = false;
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.destroyed = true;
  }
}
class MockMeshBuilder {
  constructor() {
    this.vertices = [];
    this.indices = [];
  }
  appendVerticesInterleaved(v) {
    this.vertices.push(...v);
  }
  appendIndices(i) {
    this.indices.push(...i);
  }
  updateMesh() {}
  getMesh() {
    return { vertices: this.vertices, indices: this.indices };
  }
}
function load(file) {
  file = path.resolve(file);
  if (!path.extname(file)) file += ".ts";
  if (cache.has(file)) return cache.get(file).exports;
  const source = file;
  const m = { exports: {} };
  cache.set(file, m);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(source, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }).outputText,
    {
      module: m,
      exports: m.exports,
      vec3: Vector3,
      vec4: class {
        constructor(...v) {
          this.v = v;
        }
      },
      quat: { fromEulerAngles: (x, y, z) => new YawRotation(y) },
      MeshBuilder: MockMeshBuilder,
      MeshTopology: { Triangles: 0 },
      MeshIndexType: { UInt16: 0 },
      Shape: { createBoxShape: () => ({}) },
      HorizontalAlignment: { Center: 0 },
      VerticalAlignment: { Center: 0 },
      HorizontalOverflow: { Wrap: 0 },
      Rect: { create: () => ({}) },
      global: { scene: { createSceneObject: (n) => new MockSceneObject(n) } },
      require(n) {
        if (n.startsWith("SpectaclesInteractionKit"))
          return { Interactable: MockInteractable };
        if (n.endsWith("MuseumFonts")) return { applyMuseumFont() {} };
        return load(
          n.startsWith("@app/")
            ? path.join(assets, n.slice(5))
            : path.resolve(path.dirname(file), n),
        );
      },
    },
    { filename: source },
  );
  return m.exports;
}
const D = load(path.join(assets, "Domain/index.ts")),
  { DetectiveSession } = load(
    path.join(assets, "Detective/DetectiveSession.ts"),
  ),
  { RecordedGlass, recordedPaneViews, recordedFragmentMeshes } = load(
    path.join(assets, "Runtime/RecordedGlass.ts"),
  ),
  { EvidenceLift } = load(path.join(assets, "Runtime/EvidenceLift.ts")),
  { PlayTable } = load(path.join(assets, "Runtime/PlayTable.ts"));
const compiled = D.compileCase(D.createMirrorCase(true));
assert(compiled.ok);
const sealed = compiled.sealed,
  frame = sealed.clues.clues.find(
    (c) => c.kind === "Frame" && c.tick === 12 && c.witness === "entrance",
  );
assert(frame);
const observations = D.getObservations(sealed.clues, "entrance", 12).filter(
  (c) => c.observation?.kind === "fragment",
);
assert(observations.some((c) => c.payload.fragments[0].role === "Guard"));
assert(observations.some((c) => c.payload.fragments[0].role === "Courier"));
function fixture(
  clue = observations[0],
  yaw = 0,
  caseData = sealed,
  frameData = frame,
) {
  const pane = new MockSceneObject("PublicRecordedGlass");
  pane.position = new Vector3(-353, 102.6, 326);
  pane.scale = new Vector3(0.5, 0.5, 0.5);
  pane.rotation = new YawRotation(yaw);
  const recorded = new RecordedGlass(pane, new MockMaterial(), true);
  recorded.render(caseData.board, frameData, true);
  const surface = recorded.surfaces.find((s) => s.observationId === clue.id);
  assert(surface);
  const session = new DetectiveSession(caseData, { render() {}, clear() {} });
  session.dispatch({ type: "seek", tick: 12 }); // exact public source/frame
  let scope = "epoch1/gesture1/room",
    available = true,
    pinCalls = 0,
    pinFailure = false;
  const root = new MockSceneObject("controls"),
    slots = [0, 1, 2].map((i) => {
      const n = new MockSceneObject("Evidence" + i);
      n.position = new Vector3(-374 + i * 24, 98, 338);
      n.rotation = new YawRotation(yaw);
      return n;
    });
  const context = () => {
    const s = session.snapshot();
    return {
      scope,
      caseId: s.caseId,
      rev: s.rev,
      source: s.source,
      tick: s.tick,
      available,
      selected: s.selected,
      observations: s.observations,
    };
  };
  const lift = new EvidenceLift({
    parent: root,
    material: new MockMaterial(),
    context,
    select: (id) => session.dispatch({ type: "selectObservation", id }),
    slot: (id) => {
      const glass = session.snapshot().glass;
      const found = glass.findIndex((g) => g.id === id);
      return slots[(found >= 0 ? found : glass.length) % 3];
    },
    pin(id, caseId, rev) {
      pinCalls++;
      if (pinFailure) throw Error("port failure");
      session.dispatch({ type: "pinClue", id, caseId, rev });
      return session.snapshot().glass.some((g) => g.id === id);
    },
  });
  const input = new MockInteractable(),
    owner = { hand: "YawRotation" },
    other = { hand: "L" };
  lift.bind(input, () => ({
    pane,
    clue,
    centerCm: surface.centerCm,
    widthCm: surface.widthCm,
    heightCm: surface.heightCm,
  }));
  const start = () => {
    input.onTriggerStart.fire({ interactor: owner });
    input.onDragStart.fire({ interactor: owner, dragVector: new Vector3() });
    assert(lift.carry, "visible public fragment must lift");
  };
  const move = (position, who = owner) => {
    const center = lift.carry.object
      .getTransform()
      .getWorldTransform()
      .multiplyPoint(lift.carry.center);
    const delta = position.add(center.uniformScale(-1));
    input.onDragUpdate.fire({
      interactor: who,
      dragVector: delta,
      planecastDragVector: new Vector3(9999, 0, 0),
    });
  };
  const drop = () => {
    input.onTriggerEndOutside.fire({ interactor: owner });
    input.onDragEnd.fire({
      interactor: owner,
      dragVector: new Vector3(999, 0, 0),
    });
    input.onDragEnd.fire({ interactor: owner });
  };
  return {
    pane,
    recorded,
    session,
    lift,
    input,
    owner,
    other,
    slots,
    root,
    start,
    move,
    drop,
    context,
    setScope: (v) => (scope = v),
    setAvailable: (v) => (available = v),
    setFailure: (v) => (pinFailure = v),
    get pinCalls() {
      return pinCalls;
    },
  };
}
for (const role of ["Courier", "Guard"])
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    const clue = observations.find((c) => c.payload.fragments[0].role === role),
      f = fixture(clue, yaw);
    f.start();
    const carry = f.lift.carry;
    assert.equal(carry.object.children.length,1,"only visual child below unchanged logical root");
    const exact = recordedFragmentMeshes("PublicRecordedGlass", clue.id);
    assert.equal(carry.visual.children.length, exact.length + 2);
    for (let i = 0; i < exact.length; i++) {
      const a = exact[i].getComponent("Component.RenderMeshVisual"),
        b = carry.visual.children[i].getComponent("Component.RenderMeshVisual");
      assert.equal(a.mesh, b.mesh, "exact source-clipped geometry reused");
      assert.notEqual(a.mainMaterial, b.mainMaterial, "material isolated");
    }
    const logical = carry.object.getTransform().getWorldTransform().multiplyPoint(carry.center);
    const sourceScale = [carry.object.scale.x,carry.object.scale.y,carry.object.scale.z];
    assert.equal(carry.visual.scale.x,1,"pickup has original source size");
    const sourceMeshReferences = exact.map(mesh=>mesh.getComponent("Component.RenderMeshVisual").mesh);
    const sourceColors = exact.map(mesh=>JSON.stringify(mesh.getComponent("Component.RenderMeshVisual").mainMaterial.mainPass));
    let previous=1;
    for (const cm of [0,1,3,6,12]) {
      f.move(logical.add(new Vector3(cm,0,0)));
      const rootCenter=carry.object.getTransform().getWorldTransform().multiplyPoint(carry.center);
      const visualCenter=carry.visual.getTransform().getWorldTransform().multiplyPoint(carry.center);
      // This scene double exposes child-local transform. Compose with the root explicitly.
      const worldVisual=carry.object.getTransform().getWorldTransform().multiplyPoint(visualCenter);
      assert(worldVisual.add(rootCenter.uniformScale(-1)).length<1e-8,"same center/contact under visual enlargement");
      assert.equal(carry.visual.scale.x,carry.visual.scale.y,"uniform x/y, no portrait stretch");
      assert.equal(carry.visual.scale.y,carry.visual.scale.z,"uniform depth");
      assert(carry.visual.scale.x>=previous);previous=carry.visual.scale.x;
      assert.deepEqual([carry.object.scale.x,carry.object.scale.y,carry.object.scale.z],sourceScale,"logical scale never magnified");
      exact.forEach((mesh,index)=>{assert.equal(mesh.getComponent("Component.RenderMeshVisual").mesh,sourceMeshReferences[index]);assert.equal(JSON.stringify(mesh.getComponent("Component.RenderMeshVisual").mainMaterial.mainPass),sourceColors[index]);});
    }
    assert.equal(carry.visual.scale.x,carry.magnification,"full readable size by6cm, remains stable at halfway");
    assert(carry.visual.children.some(child=>child.name==="CarriedGlassBacking"),"neutral material backing, not invented picture");
    const destination = f.slots[0].position.add(new Vector3(0, 3, 0));
    f.move(destination);
    assert.equal(
      f.lift.carry.object
        .getTransform()
        .getWorldTransform()
        .multiplyPoint(f.lift.carry.center).z,
      destination.z,
    );
    f.drop();
    assert.equal(f.pinCalls, 1);
    assert.equal(f.session.snapshot().glass.length, 1);
    const pinned = f.session.snapshot().glass[0].clue;
    assert.equal(pinned.id, clue.id);
    assert.equal(pinned.tick, 12);
    assert.equal(pinned.witness, "entrance");
    assert.equal(f.pane.enabled, true, "source remains");
    f.start();
    f.move(destination);
    f.drop();
    assert.equal(
      f.session.snapshot().glass.length,
      1,
      "duplicate is selected, not added",
    );
    f.lift.dispose();
    f.recorded.dispose();
  }
for (const kind of [
  "miss",
  "wrongslot",
  "cancel",
  "source",
  "tick",
  "role",
  "case",
  "gesture",
  "checking",
  "failure",
  "dispose",
  "nonfinite",
  "oldhand",
]) {
  const f = fixture();
  f.start();
  const ghost = f.lift.carry.object;
  if (kind === "miss") {
    f.move(new Vector3(-353, 120, 300));
    f.drop();
  } else if (kind === "wrongslot") {
    f.move(f.slots[1].position);
    f.drop();
  } else if (kind === "cancel") {
    f.input.onTriggerCanceled.fire({ interactor: f.owner });
    f.drop();
  } else if (kind === "source") {
    f.session.state.source = "different";
    f.lift.sync();
    f.drop();
  } else if (kind === "tick") {
    f.session.dispatch({ type: "seek", tick: 13 });
    f.lift.sync();
    f.drop();
  } else if (["role", "checking"].includes(kind)) {
    f.setAvailable(false);
    f.lift.sync();
    f.drop();
  } else if (kind === "case") {
    f.session.state.caseId = "other";
    f.lift.sync();
    f.drop();
  } else if (kind === "gesture") {
    f.setScope("epoch1/gesture2/room");
    f.lift.sync();
    f.drop();
  } else if (kind === "failure") {
    f.setFailure(true);
    f.move(f.slots[0].position);
    f.drop();
  } else if (kind === "dispose") {
    f.lift.dispose();
    f.drop();
  } else if (kind === "nonfinite") {
    f.input.onDragUpdate.fire({
      interactor: f.owner,
      dragVector: new Vector3(NaN, 0, 0),
    });
    f.drop();
  } else {
    f.move(f.slots[1].position, f.other);
    assert.equal(f.lift.carry.position.x, -353);
    f.input.onTriggerCanceled.fire({ interactor: f.other });
    assert(f.lift.carry);
    f.input.onTriggerCanceled.fire({ interactor: f.owner });
    f.drop();
  }
  for (let i = 0; i < 5; i++) f.lift.update(0.05);
  assert.equal(f.session.snapshot().glass.length, 0, kind + " must not pin");
  assert(ghost.destroyed, kind + " temporary pane removed");
  assert.equal(f.pane.enabled, true);
  f.lift.dispose();
  f.recorded.dispose();
}
console.log(
  "PASS actual compiler/session + RecordedGlass clipped meshes + EvidenceLift SIK callbacks: Courier/Guard, yaw0/90/180, native outside→DragEnd order, exact identity/source/tick, once, duplicate, miss/cancel/source/tick/role/case/generation/check/failure/dispose/nonfinite/other-hand; engine scene ports are doubles",
);
// Exercise the actual normal controller hook and generic tap suppression, not a replacement binding.
{
  const clue = observations.find(
    (c) => c.payload.fragments[0].role === "Guard",
  );
  const f = fixture(clue),
    p = Object.create(PlayTable.prototype),
    id = "Observation_PublicRecordedGlass_0";
  Object.assign(p, {
    root: f.root,
    epoch: 1,
    inputGeneration: 0,
    viewIdentity: "museum",
    actions: new Map(),
    observationSlots: new Map(),
    disposed: false,
    registeringPublicStation: false,
    state: {
      flow: {
        mode: "detective",
        inputEpoch: 1,
        caseId: sealed.caseId,
        revision: sealed.rev,
      },
      detective: f.session.snapshot(),
    },
    ports: {
      dispatch(action, payload) {
        assert.equal(action, "detective");
        f.session.dispatch(payload);
        p.state.detective = f.session.snapshot();
        p.evidenceLift?.sync();
      },
    },
  });
  for (let i = 0; i < 3; i++)
    p.actions.set("Evidence" + i, { object: f.slots[i] });
  const surface = f.recorded.surfaces.find((s) => s.observationId === clue.id);
  p.observationSlots.set(id, {
    slot: 0,
    centerCm: surface.centerCm,
    widthCm: surface.widthCm,
    heightCm: surface.heightCm,
    observations: [clue],
  });
  p.bindObservationTarget(id);
  const input = p.actions.get(id).input;
  input.onTriggerStart.fire({ interactor: f.owner });
  input.onTriggerEnd.fire({ interactor: f.owner });
  assert.equal(
    f.session.snapshot().focusedObservation.id,
    clue.id,
    "ordinary tap selects",
  );
  assert.equal(p.evidenceLift.carry, undefined);
  p.detective({ type: "pin" });
  assert.equal(f.session.snapshot().glass.length, 1, "ordinary Pin continues");
  input.onTriggerStart.fire({ interactor: f.owner });
  input.onDragStart.fire({ interactor: f.owner, dragVector: new Vector3() });
  assert(
    p.evidenceLift.carry,
    "actual controller binds visible workshop fragment",
  );
  const carry = p.evidenceLift.carry;
  input.onDragUpdate.fire({
    interactor: f.owner,
    dragVector: f.slots[0].position.add(
      carry.object
        .getTransform()
        .getWorldTransform()
        .multiplyPoint(carry.center)
        .uniformScale(-1),
    ),
  });
  input.onTriggerEndOutside.fire({ interactor: f.owner });
  input.onDragEnd.fire({ interactor: f.owner });
  assert.equal(f.session.snapshot().glass.length, 1, "actual callback dedup");
  assert.equal(p.evidenceLift.carry, undefined);
  // An already pinned clue on another page cannot draw a ghost over a foreign slot.
  const extraIds = [];
  for (const frame of sealed.clues.clues.filter((c) => c.kind === "Frame"))
    for (const o of D.getObservations(sealed.clues, frame.witness, frame.tick))
      if (o.id !== clue.id && !extraIds.includes(o.id)) extraIds.push(o.id);
  for (const otherId of extraIds.slice(0, 3))
    p.detective({
      type: "pinClue",
      id: otherId,
      caseId: sealed.caseId,
      rev: sealed.rev,
    });
  assert(!p.state.detective.visibleGlass.some((g) => g.id === clue.id));
  input.onTriggerStart.fire({ interactor: f.owner });
  input.onDragStart.fire({ interactor: f.owner, dragVector: new Vector3() });
  assert.equal(
    p.evidenceLift.carry,
    undefined,
    "hidden-page duplicate stays on ordinary path",
  );
  p.detective({ type: "pin" });
  assert(
    p.state.detective.visibleGlass.some((g) => g.id === clue.id),
    "ordinary Pin returns existing clue page",
  );
  assert.equal(p.state.detective.glass.length, 4);
  const courier = observations.find(
    (c) => c.payload.fragments[0].role === "Courier",
  );
  p.observationSlots.get(id).observations = [courier];
  input.onTriggerStart.fire({ interactor: f.owner });
  input.onDragStart.fire({ interactor: f.owner, dragVector: new Vector3() });
  assert.equal(
    p.evidenceLift.carry,
    undefined,
    "new page cannot masquerade as an occupied current-page receiver",
  );
  p.detective({ type: "pin" });
  assert(
    p.state.detective.visibleGlass.some((g) => g.id === courier.id),
    "ordinary Pin creates next canonical page",
  );
  p.observationSlots.get(id).observations = [clue];
  // Reentrant selection callback that changes frame must abort before a copy exists.
  const oldDispatch = p.ports.dispatch;
  p.ports.dispatch = (action, payload) => {
    oldDispatch(action, payload);
    if (payload.type === "selectObservation") {
      f.session.dispatch({ type: "seek", tick: 13 });
      p.state.detective = f.session.snapshot();
    }
  };
  input.onTriggerStart.fire({ interactor: f.owner });
  input.onDragStart.fire({ interactor: f.owner, dragVector: new Vector3() });
  assert.equal(
    p.evidenceLift.carry,
    undefined,
    "reentrant seek aborts exact captured frame",
  );
  p.evidenceLift.dispose();
  f.lift.dispose();
  f.recorded.dispose();
}
console.log(
  "PASS actual PlayTable.bindObservationTarget + bindObject native event sequence, ordinary tap→Pin, drag dedup, reentrant seek abort; no direct private binding replacement",
);
{
  let found;
  for (const markerWidth of [0.2, 0.5, 1, 2]) {
    const draft = D.createMirrorCase(true);
    draft.tracks = draft.tracks.map((t) => ({
      ...t,
      markerWidth,
      markerHeight: markerWidth,
    }));
    const c = D.compileCase(draft);
    if (!c.ok) continue;
    for (const frame of c.sealed.clues.clues.filter(
      (c) => c.kind === "Frame" && c.tick === 12,
    )) {
      const clue = D.getObservations(
        c.sealed.clues,
        frame.witness,
        frame.tick,
      ).find(
        (c) =>
          c.observation?.kind === "fragment" &&
          c.payload.fragments.length === 1 &&
          !c.payload.fragments[0].role,
      );
      if (clue) {
        found = { sealed: c.sealed, frame, clue };
        break;
      }
    }
    if (found) break;
  }
  assert(found, "legal compiler-produced unidentified fragment fixture");
  const f = fixture(found.clue, 0, found.sealed, found.frame);
  f.start();
  f.move(f.slots[0].position);
  f.drop();
  assert.equal(f.session.snapshot().glass.length, 1);
  assert.equal(
    f.session.snapshot().glass[0].clue.payload.fragments[0].role,
    undefined,
    "lift cannot invent an actor name",
  );
  f.lift.dispose();
  f.recorded.dispose();
}
console.log(
  "PASS legal compiler-produced unidentified fragment pins without any invented role",
);
for (const change of ["row", "lateTick"]) {
  const f = fixture(
    observations.find((c) => c.payload.fragments[0].role === "Guard"),
  );
  if (change === "row")
    f.lift.ports.select = (id) => {
      f.session.dispatch({ type: "selectObservation", id });
      f.session.dispatch({
        type: "selectObservation",
        id: observations.find((c) => c.payload.fragments[0].role === "Courier")
          .id,
      });
    };
  else {
    const previous = f.lift.ports.slot;
    f.lift.ports.slot = (id) => {
      const slot = previous(id);
      f.session.dispatch({ type: "seek", tick: 13 });
      return slot;
    };
  }
  f.input.onTriggerStart.fire({ interactor: f.owner });
  f.input.onDragStart.fire({ interactor: f.owner, dragVector: new Vector3() });
  assert.equal(f.lift.carry, undefined, change + " reentrant invalidation");
  assert(
    !f.root.children.some((c) =>
      ["CarriedEvidenceGlass", "ReceivingGlassEdge"].includes(c.name),
    ),
    "reentrant allocation cleaned",
  );
  f.lift.dispose();
  f.recorded.dispose();
}
console.log(
  "PASS hidden-page repeat uses ordinary Pin to bring original into view; reentrant clue-row and post-resolve tick changes create no stale carry",
);
