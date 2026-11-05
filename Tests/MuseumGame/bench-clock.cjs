const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const assets = path.resolve(__dirname, "../../Assets");
const typescriptBinDirectory = process.env.PATH.split(path.delimiter).find(
  (typescriptBinDirectory) => {
    const file = path.resolve(
      typescriptBinDirectory,
      "../typescript/package.json",
    );
    return (
      fs.existsSync(file) &&
      JSON.parse(fs.readFileSync(file, "utf8")).version === "6.0.2"
    );
  },
);
assert(typescriptBinDirectory, "Use npm exec TypeScript 6.0.2");
const typescript = require(
    path.resolve(typescriptBinDirectory, "../typescript/lib/typescript.js"),
  ),
  moduleCache = new Map(),
  sceneRoots = [],
  objectsByName = new Map(),
  updateCallbacks = [];
class MockEvent {
  handlers = [];
  add(handler) {
    this.handlers.push(handler);
  }
  fire(payload) {
    for (const handler of [...this.handlers]) handler(payload);
  }
}
class MockInteractable {
  static getTypeName() {
    return "Interactable";
  }
  constructor() {
    for (const event of [
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
      this[event] = new MockEvent();
  }
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
const rotation = { multiplyVec3: (vector) => vector, multiply: () => rotation };
class MockSceneObject {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.children = [];
    this.components = [];
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    objectsByName.set(name, this);
    sceneRoots.push(this);
  }
  setParent(parent) {
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
    else sceneRoots.splice(sceneRoots.indexOf(this), 1);
    this.parent = parent;
    parent.children.push(this);
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
    const node = this;
    return {
      setLocalPosition: (vector) => (node.position = vector),
      setWorldPosition: (vector) => (node.position = vector),
      getLocalPosition: () => node.position,
      getWorldPosition: () => node.position,
      setLocalRotation() {},
      setWorldRotation() {},
      getWorldRotation: () => rotation,
      setLocalScale: (vector) => (node.scale = vector),
      setWorldScale: (vector) => (node.scale = vector),
      getWorldScale: () => node.scale,
      getWorldTransform: () => ({
        multiplyPoint: (vector) => vector,
        multiplyDirection: (vector) => vector,
      }),
      getInvertedWorldTransform: () => ({
        multiplyPoint: (vector) => vector,
        multiplyDirection: (vector) => vector,
      }),
    };
  }
  createComponent(type) {
    let component;
    if (type === "Interactable") component = new MockInteractable();
    else if (type === "Component.ScriptComponent")
      component = {
        createEvent: () => ({
          bind: (handler) => updateCallbacks.push(handler),
        }),
        removeEvent() {},
      };
    else component = { textFill: {} };
    component.type = type;
    this.components.push(component);
    return component;
  }
  getComponent(type) {
    return this.components.find((component) => component.type === type);
  }
  destroy() {
    this.enabled = false;
    objectsByName.delete(this.name);
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}
let paneViews = [];
function loadModule(file) {
  file = path.resolve(file);
  if (!path.extname(file)) file += ".ts";
  if (moduleCache.has(file)) return moduleCache.get(file).exports;
  const module = { exports: {} };
  moduleCache.set(file, module);
  const sourcePath = file;
  const source = typescript.transpileModule(
    fs.readFileSync(sourcePath, "utf8"),
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2021,
      },
    },
  ).outputText;
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      vec3: Vector3,
      vec4: class {
        constructor(x, y, z, w) {
          Object.assign(this, { x, y, z, w });
        }
      },
      quat: { fromEulerAngles: () => rotation },
      Shape: { createBoxShape: () => ({}) },
      HorizontalAlignment: { Center: 0 },
      VerticalAlignment: { Center: 0 },
      HorizontalOverflow: { Wrap: 0 },
      Rect: { create: () => ({}) },
      global: {
        scene: {
          createSceneObject: (name) => new MockSceneObject(name),
          getRootObjectsCount: () => sceneRoots.length,
          getRootObject: (i) => sceneRoots[i],
        },
      },
      require: (name) => {
        if (name.endsWith("MuseumFonts")) return { applyMuseumFont() {} };
        if (name.startsWith("SpectaclesInteractionKit"))
          return { Interactable: MockInteractable };
        if (name.endsWith("/AuthorPropsHandles"))
          return {
            AuthorPropsHandles: class {
              controller = { isPlacing: () => false };
              sync() {}
              cancel() {}
              dispose() {}
            },
          };
        if (name.endsWith("/RecordedGlass"))
          return {
            recordedPaneViews: () => paneViews,
            toggleRecordingDetail: () => false,
            recordingDetailEnabled: () => false,
          };
        return loadModule(
          name.startsWith("@app/")
            ? path.join(assets, name.slice(5))
            : path.resolve(path.dirname(file), name),
        );
      },
    },
    { filename: sourcePath },
  );
  return module.exports;
}
const Domain = loadModule(path.join(assets, "Domain/index.ts"));
const { DetectiveSession } = loadModule(
  path.join(assets, "Detective/DetectiveSession.ts"),
);
const { RevealTransport } = loadModule(
  path.join(assets, "Runtime/MuseumGame/RevealTransport.ts"),
);
const { PlayTable } = loadModule(path.join(assets, "Runtime/PlayTable.ts"));
const compiled = Domain.compileCase(
  Domain.createPackingCase({ rearCamera: true }),
);
assert(compiled.ok);
let table,
  state,
  reveal,
  mode = "detective",
  epoch = 1;
const commands = [];
function render(detective, board) {
  state = {
    flow: {
      mode,
      caseId: board.caseId,
      revision: board.rev,
      title: "",
      primary: "",
      message: "",
      inputEpoch: epoch,
      hasDraft: false,
      tutorial: false,
      shelf: [],
    },
    board,
    detective,
    ...(reveal ? { reveal: reveal.snapshot() } : {}),
  };
  table?.render(state);
}
const session = new DetectiveSession(compiled.sealed, { render, clear() {} });
function refresh() {
  render(session.snapshot(), compiled.sealed.board);
  updateCallbacks.forEach((handler) => handler());
}
table = new PlayTable(new MockSceneObject("ClockRegressionRoom"), {
  propMaterial: {},
  dispatch(action, payload) {
    commands.push({ action, payload });
    if (action === "detective") session.dispatch(payload);
    else if (action === "reveal") {
      assert(reveal, "Reveal must have its own active transport");
      assert(reveal.dispatch(payload));
      refresh();
    } else {
      assert.equal(action, "flow");
      assert.equal(payload.type, "replayAlarm");
    }
  },
});
refresh();
function target(id) {
  const control = objectsByName.get("Use_" + id);
  assert(
    control?.isEnabledInHierarchy,
    "Missing/disabled physical target Use_" + id,
  );
  return control;
}
function click(id) {
  const control = target(id),
    input = control.getComponent("Interactable");
  assert(input);
  input.onTriggerStart.fire({});
  input.onTriggerEnd.fire({});
  updateCallbacks.forEach((handler) => handler());
}
function text(id) {
  const control = objectsByName.get("Engraving_" + id);
  assert(control);
  return control.getComponent("Component.Text").text;
}
function last() {
  return commands.at(-1);
}
function seekByClock(tick) {
  while (session.snapshot().tick !== tick)
    click(
      session.snapshot().tick > tick ? "EntryClockPrevious" : "EntryClockNext",
    );
}
// Every route below starts with real object trigger callbacks; no direct session seek/play setters.
seekByClock(3);
assert.equal(session.snapshot().playing, false);
assert.match(
  text("EntryClock"),
  /Play.*1\.5/,
  "Paused inscription must describe selected time",
);
const initialTick = session.snapshot().tick;
click("EntryClock");
assert.equal(
  last().payload.type,
  "play",
  "Paused detective clock resumes instead of replaying alarm",
);
assert.equal(session.snapshot().tick, initialTick);
assert.equal(session.snapshot().playing, true);
session.update(0.2);
assert.equal(session.snapshot().tick, 3);
assert(Math.abs(session.presentationTick() - 3.4) < 1e-10);
assert.match(text("EntryClock"), /Pause.*1\.5/);
session.update(0.25);
session.update(0.1);
assert.equal(session.snapshot().tick, 4);
assert(session.presentationTick() > 4);
click("EntryClock");
assert.equal(last().payload.type, "freeze");
assert.equal(session.snapshot().playing, false);
assert.equal(session.snapshot().tick, 4);
assert.equal(session.presentationTick(), 4);
click("EntryClock");
assert.equal(last().payload.type, "play");
assert.equal(session.snapshot().tick, 4);
session.update(0.1);
assert(
  session.presentationTick() > 4 && session.presentationTick() < 5,
  "Resume keeps current canonical tick",
);
click("EntryClock");
console.log(
  "PASS physical paused3 -> play3.4 -> canonical4 pause -> resume4.x (no alarm jump)",
);
seekByClock(24);
assert.equal(session.snapshot().playing, false);
assert.match(text("EntryClock"), /Replay.*alarm/i);
click("EntryClock");
assert.equal(last().payload.type, "replay");
assert.equal(session.snapshot().tick, 12);
assert.equal(session.snapshot().playing, true);
click("EntryClock");
seekByClock(3);
assert.match(text("EntryClockReset"), /Replay from alarm/i);
click("EntryClockReset");
assert.equal(last().payload.type, "replay");
assert.equal(session.snapshot().tick, 12);
assert.equal(session.snapshot().playing, true);
click("EntryClock");
console.log(
  "PASS physical end24 clock replays12; physical Reset separately replays alarm12",
);
// Ready retains its normal flow command; revealing retains its existing separate replacement clock.
mode = "ready";
epoch++;
refresh();
assert.equal(
  objectsByName.get("Use_EntryClockReset").enabled,
  false,
  "Ready has no investigation reset",
);
click("EntryClock");
assert.equal(last().action, "flow");
assert.equal(last().payload.type, "replayAlarm");
mode = "handoff";
epoch++;
refresh();
assert.equal(objectsByName.get("Use_EntryClock").enabled, false);
assert.equal(objectsByName.get("Use_EntryClockReset").enabled, false);
mode = "finished";
epoch++;
reveal = new RevealTransport(3);
refresh();
click("EntryClock");
assert.equal(last().action, "reveal");
assert.equal(last().payload.type, "play");
assert.equal(reveal.snapshot().tick, 3);
reveal.update(0.2);
assert.equal(reveal.presentationTick(), 3.4);
refresh();
click("EntryClock");
assert.equal(last().payload.type, "pause");
assert.equal(reveal.snapshot().tick, 3);
click("EntryClockReset");
assert.equal(last().action, "reveal");
assert.equal(last().payload.type, "replay");
assert.equal(reveal.snapshot().tick, 0);
assert.equal(reveal.snapshot().playing, true);
console.log(
  "PASS ready emits real replayAlarm flow command; reveal play/pause " +
    "preserves3 and Reset replays theft0",
);
// All clocks share the same normal callback contract and their Reset targets stay available.
mode = "detective";
reveal.dispose();
reveal = undefined;
epoch++;
refresh();
for (const id of ["EntryClock", "HallClock", "WorkshopClock"]) {
  seekByClock(3);
  target(id + "Reset");
  click(id);
  assert.equal(last().payload.type, "play");
  assert.equal(session.snapshot().tick, 3);
  click(id);
  assert.equal(last().payload.type, "freeze");
  click(id + "Reset");
  assert.equal(last().payload.type, "replay");
  assert.equal(session.snapshot().tick, 12);
  click(id);
}
for (const tick of [0, 23]) {
  seekByClock(tick);
  click("EntryClock");
  assert.equal(last().payload.type, "play");
  assert.equal(session.snapshot().tick, tick);
  click("EntryClock");
}
// Real inspect/pin and source controls retain fixed recording time and evidence.
seekByClock(15);
const rim = compiled.sealed.clues.clues.find((clue) => clue.kind === "Rim");
click("Inspect" + rim.id);
click("PinGlass");
const ids = session.snapshot().glass.map((clue) => clue.id);
assert.equal(ids.length, 1);
click("Sourcepassage");
assert.equal(session.snapshot().source, "passage");
assert.equal(session.snapshot().tick, 15);
const frame = session.snapshot().frame.id;
click("WorkshopClock");
assert(session.snapshot().playing);
assert.equal(session.snapshot().tick, 15);
session.update(0.2);
assert.equal(session.presentationTick(), 15.4);
refresh();
click("WorkshopClock");
assert.equal(session.snapshot().tick, 15);
assert.equal(session.snapshot().playing, false);
assert.equal(session.snapshot().frame.id, frame);
click("WorkshopClockReset");
assert.equal(session.snapshot().tick, 12);
assert.equal(session.snapshot().source, "passage");
assert.equal(session.snapshot().playing, true);
click("WorkshopClock");
click("Sourceentrance");
assert.equal(session.snapshot().tick, 12);
assert.deepEqual(
  session.snapshot().glass.map((clue) => clue.id),
  ids,
);
assert.equal(session.snapshot().frame.witness, "entrance");
table.dispose();
session.dispose();
console.log(
  "PASS actual PlayTable + actual DetectiveSession/RevealTransport; " +
    "only scene/output ports doubled",
);
