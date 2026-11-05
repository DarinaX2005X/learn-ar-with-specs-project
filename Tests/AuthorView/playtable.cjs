const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const bin = process.env.PATH.split(path.delimiter).find((p) =>
  fs.existsSync(path.resolve(p, "../typescript/lib/typescript.js")),
);
assert(bin);
const ts = require(path.resolve(bin, "../typescript/lib/typescript.js"));
const {
  AuthorSession,
} = require("./build/Author/AuthorSession");
const A = require("./build/Author/AuthorViewSession");
const D = require("./build/Domain");
const propsModule = { exports: {} };
new Function(
  "require",
  "exports",
  "module",
  ts.transpileModule(
    fs.readFileSync("Assets/Author/AuthorPropsController.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
)(
  (id) => {
    if (id.endsWith("/Domain/geometry")) return D;
    throw Error(id);
  },
  propsModule.exports,
  propsModule,
);
const propCancels = [];
class UnrelatedPropsStub {
  constructor(ports) {
    this.ports = ports;
    this.controller = new propsModule.exports.AuthorPropsController(ports);
  }
  sync() {
    this.controller.sync();
  }
  cancel() {
    propCancels.push(this.ports.scope());
    this.controller.cancel();
  }
  dispose() {}
}
class Event {
  constructor() {
    this.handlers = [];
  }
  add(fn) {
    this.handlers.push(fn);
  }
  bind(fn) {
    this.handlers.push(fn);
  }
  emit(event = {}) {
    for (const fn of [...this.handlers]) fn(event);
  }
}
class V {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  uniformScale(n) {
    return new V(this.x * n, this.y * n, this.z * n);
  }
}
class Q {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  multiply(q) {
    return new Q(this.x + q.x, this.y + q.y, this.z + q.z);
  }
  multiplyVec3(p) {
    return new V(
      p.x * Math.cos(this.y) + p.z * Math.sin(this.y),
      p.y,
      p.z * Math.cos(this.y) - p.x * Math.sin(this.y),
    );
  }
}
const roots = [],
  updates = [];
class Transform {
  constructor(owner) {
    this.owner = owner;
    this.position = new V();
    this.rotation = new Q();
  }
  setLocalPosition(p) {
    this.position = p;
  }
  getLocalPosition() {
    return this.position;
  }
  getWorldPosition() {
    const p = this.owner.parent?.getTransform().getWorldPosition() ?? new V();
    return new V(
      p.x + this.position.x,
      p.y + this.position.y,
      p.z + this.position.z,
    );
  }
  setWorldPosition(p) {
    const origin =
      this.owner.parent?.getTransform().getWorldPosition() ?? new V();
    this.position = new V(p.x - origin.x, p.y - origin.y, p.z - origin.z);
  }
  setLocalRotation(q) {
    this.rotation = q;
  }
  setWorldRotation(q) {
    this.rotation = q;
  }
  getWorldRotation() {
    return this.rotation;
  }
  setLocalScale() {}
  setWorldScale() {}
  getWorldTransform() {
    const p = this.getWorldPosition();
    return {
      multiplyPoint: (v) => new V(v.x + p.x, v.y + p.y, v.z + p.z),
      multiplyDirection: (v) => v,
    };
  }
  getInvertedWorldTransform() {
    const p = this.getWorldPosition();
    return {
      multiplyPoint: (v) => new V(v.x - p.x, v.y - p.y, v.z - p.z),
      multiplyDirection: (v) => v,
    };
  }
}
class Input {
  static getTypeName() {
    return "Interactable";
  }
  constructor(owner) {
    this.owner = owner;
    for (const e of [
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
      this[e] = new Event();
  }
  getSceneObject() {
    assert.equal(this.owner.destroyed, false);
    return this.owner;
  }
}
class Obj {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.destroyed = false;
    this.children = [];
    this.transform = new Transform(this);
    roots.push(this);
  }
  setParent(parent) {
    const list = this.parent?.children ?? roots;
    list.splice(list.indexOf(this), 1);
    this.parent = parent;
    parent.children.push(this);
  }
  getTransform() {
    assert.equal(this.destroyed, false);
    return this.transform;
  }
  getChildrenCount() {
    return this.children.length;
  }
  getChild(i) {
    return this.children[i];
  }
  createComponent(type) {
    if (type === "Interactable") return new Input(this);
    if (type === "Component.ScriptComponent")
      return {
        createEvent() {
          const e = new Event();
          updates.push(e);
          return e;
        },
        removeEvent(e) {
          updates.splice(updates.indexOf(e), 1);
        },
      };
    return {};
  }
  destroy() {
    for (const child of [...this.children]) child.destroy();
    this.destroyed = true;
    const list = this.parent?.children ?? roots;
    list.splice(list.indexOf(this), 1);
  }
}
global.vec3 = V;
global.quat = { fromEulerAngles: (x, y, z) => new Q(x, y, z) };
global.Shape = { createBoxShape: () => ({}) };
global.Rect = { create: () => ({}) };
global.HorizontalAlignment = { Center: 0 };
global.VerticalAlignment = { Center: 0 };
global.HorizontalOverflow = { Wrap: 0 };
global.global = {
  scene: {
    createSceneObject: (name) => new Obj(name),
    getRootObjectsCount: () => roots.length,
    getRootObject: (i) => roots[i],
  },
};
const source = fs.readFileSync(
  process.env.AUTHOR_VIEW_PLAYTABLE ?? "Assets/Runtime/PlayTable.ts",
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2021,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const m = { exports: {} };
const contactModule = { exports: {} };
new Function(
  "exports",
  "module",
  ts.transpileModule(
    fs.readFileSync("Assets/Runtime/MuseumGame/ObservationContacts.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
)(contactModule.exports, contactModule);
new Function("require", "module", "exports", js)(
  (id) => {
    if (id.includes("Interactable")) return { Interactable: Input };
    if (id.includes("ObservationContacts")) return contactModule.exports;
    if (id.includes("AuthorPropsHandles"))
      return { AuthorPropsHandles: UnrelatedPropsStub };
    if (id.includes("AuthorViewSession")) return A;
    if (id.endsWith("/RecordedGlass"))
      return {
        recordedPaneViews: () => [],
        toggleRecordingDetail: () => {},
        recordingDetailEnabled: () => false,
      };
    if (id.includes("CaseViewRouting")) return { caseViewControls: () => [] };
    if (id.endsWith("/CaseViewHandles"))
      return { caseViewHandleSlots: () => [] };
    throw Error("Unexpected runtime dependency " + id);
  },
  m,
  m.exports,
);
const parent = new Obj("Countercase");
parent.transform.position = new V(350, 0, 250);
const base = new AuthorSession(D.createMuseumTheft());
base.setTick(12);
base.select("B");
let active = base,
  table,
  coordinator;
const state = {
  flow: { mode: "author", inputEpoch: 3, shelf: [] },
  author: base.snapshot(),
};
const actions = [];
function refresh() {
  state.author = active.snapshot();
  coordinator?.sync();
  table?.render(state);
}
function author(command) {
  switch (command.kind) {
    case "edit":
      active.edit(command.edit);
      break;
    case "preview":
      active.previewEdit(command.edit);
      break;
    case "select":
      active.select(command.id);
      break;
    case "setTick":
      active.setTick(command.tick);
      break;
    case "beginGesture":
      active.beginGesture();
      break;
    case "commitGesture":
      active.commitGesture();
      break;
    case "cancelGesture":
      active.cancelGesture();
      break;
    case "startTest":
      active.startTest();
      break;
    case "confirmAmbiguity":
      active.confirmAmbiguity();
      break;
    case "pause":
      active.pause();
      break;
    default:
      throw Error("Unhandled normal author command " + command.kind);
  }
}
coordinator = new A.AuthorViewSession(base, {
  isAuthorRole: () => state.flow.mode === "author",
  activate(next) {
    active = next;
    refresh();
  },
  cancelInput() {
    table?.finishTimeDrag();
  },
  present(value) {
    state.authorView = value;
  },
  clear() {
    state.authorView = undefined;
  },
});
coordinator.sync();
table = new m.exports.PlayTable(parent, {
  propMaterial: {},
  dispatch(action, payload) {
    actions.push({ action, payload });
    if (action === "author") author(payload);
    else if (action === "authorView") coordinator.dispatch(payload);
    refresh();
  },
});
table.render(state);
const at = (id) => {
  const a = table.actions.get(id);
  assert.ok(a, "Missing physical target " + id);
  return a;
};
function tap(id) {
  const a = at(id);
  assert.equal(a.object.enabled, true, id + " should be available");
  a.input.onTriggerStart.emit();
  a.input.onTriggerEnd.emit();
  assert.equal(a.input.getSceneObject(), a.object);
}
const camera = at("Recordentrance"),
  watch = at("AuthorViewWatchCamera_entrance"),
  trial = at("AuthorViewTryChange");
assert.ok(Math.abs(watch.object.getTransform().position.x - 35.8) < 1e-8);
assert.ok(
  Math.abs(watch.object.getTransform().rotation.y - Math.PI / 2) < 1e-8,
);
tap("AuthorViewWatchCamera_entrance");
assert.equal(state.authorView.recording.frame.tick, 12);
assert.equal(state.authorView.source, "entrance");
// A camera drag that is still held cannot cross the isolated session swap.
camera.input.onDragStart.emit();
camera.input.onDragUpdate.emit({ dragVector: new V(10, 0, 0) });
assert.equal(active.snapshot().preview, true);
const unchanged = base.getDraft();
tap("AuthorViewTryChange");
assert.notEqual(active, base);
assert.equal(base.snapshot().preview, false);
assert.equal(table.actions.get("Recordentrance"), camera);
const trialDraft = JSON.stringify(active.getDraft());
camera.input.onDragUpdate.emit({ dragVector: new V(20, 0, 0) });
camera.input.onDragEnd.emit();
assert.equal(
  JSON.stringify(active.getDraft()),
  trialDraft,
  "Held camera drag/release must not edit the trial",
);
tap("CurtainClose");
assert.equal(active.getDraft().room.mirror.aperture, 0);
assert.equal(base.getDraft().room.mirror.aperture, 1);
tap("AuthorViewCompareChange");
let frames = 0;
while (state.authorView.comparing && frames++ < 1000) {
  active.advanceProof(4);
  coordinator.update();
  refresh();
}
assert.ok(frames < 1000);
assert.ok(
  state.authorView.differences.some(
    (d) => d.field === "taker" && d.before.length === 1 && d.after.length === 2,
  ),
);
// Even a fully checked/confirmed trial cannot pass the CaseFlow-owned original.
active.confirmAmbiguity();
refresh();
assert.equal(state.author.canSeal, true);
assert.equal(at("CaseLid").label(), "Keep or discard this change first");
const passed = actions.filter(
  (a) => a.action === "flow" && a.payload.type === "passCase",
).length;
tap("CaseLid");
assert.equal(
  actions.filter((a) => a.action === "flow" && a.payload.type === "passCase")
    .length,
  passed,
);
const keep = at("AuthorViewKeepChange");
keep.input.onTriggerStart.emit();
tap("AuthorViewDiscardChange");
assert.equal(active, base);
assert.equal(JSON.stringify(base.getDraft()), JSON.stringify(unchanged));
const beforeLate = actions.length;
keep.input.onTriggerEnd.emit();
assert.equal(
  actions.length,
  beforeLate,
  "Discard invalidates an already held Keep handle",
);
tap("AuthorViewTryChange");
tap("CurtainClose");
tap("AuthorViewKeepChange");
assert.equal(base.getDraft().rev, unchanged.rev + 1);
assert.equal(base.getDraft().room.mirror.aperture, 0);
assert.equal(state.authorView.recording.tick, 12);
assert.equal(table.actions.get("AuthorViewTryChange"), trial);
// Body and curtain drags share the same no-cross-generation rule.
const actor = at("ActorBaseB");
actor.input.onDragStart.emit();
tap("AuthorViewTryChange");
const isolated = JSON.stringify(active.getDraft());
actor.input.onDragUpdate.emit({ dragVector: new V(20, 0, 0) });
actor.input.onDragEnd.emit();
assert.equal(JSON.stringify(active.getDraft()), isolated);
tap("AuthorViewDiscardChange");
const curtain = at("CurtainHandle");
curtain.input.onDragStart.emit();
tap("AuthorViewTryChange");
const isolated2 = JSON.stringify(active.getDraft());
curtain.input.onDragUpdate.emit({ dragVector: new V(50, 0, 0) });
curtain.input.onDragEnd.emit();
assert.equal(JSON.stringify(active.getDraft()), isolated2);
state.flow.mode = "handoff";
state.flow.inputEpoch++;
coordinator.sync();
state.author = undefined;
table.render(state);
const count = actions.length;
trial.input.onTriggerStart.emit();
trial.input.onTriggerEnd.emit();
assert.equal(actions.length, count);
for (const update of [...updates]) update.emit();
assert.equal(watch.object.destroyed, true);
assert.equal(state.authorView.enabled, false);
coordinator.dispose();
table.dispose();
assert.equal(updates.length, 0);
if (process.env.AUTHOR_VIEW_PLAYTABLE)
  assert.ok(
    propCancels.length > 0,
    "Merged prop controller is canceled before session/input changes",
  );
console.log(
  "Actual PlayTable camera/bench trial inputs, actual answer comparison, stale camera/body/curtain/keep guards and pass gate passed",
);
