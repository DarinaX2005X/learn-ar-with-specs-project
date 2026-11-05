const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const workspace = path.resolve(__dirname, "../.."),
  assets = path.join(workspace, "Assets");
const compilerDir = process.env.PATH.split(path.delimiter).find((dir) => {
  const file = path.resolve(dir, "../typescript/package.json");
  return (
    fs.existsSync(file) &&
    JSON.parse(fs.readFileSync(file, "utf8")).version === "6.0.2"
  );
});
assert(compilerDir, "Use npm exec TypeScript 6.0.2");
const ts = require(
    path.resolve(compilerDir, "../typescript/lib/typescript.js"),
  ),
  cache = new Map(),
  roots = [],
  objects = new Map(),
  updates = [];
class Event {
  handlers = [];
  add(fn) {
    this.handlers.push(fn);
  }
  fire(event) {
    for (const fn of [...this.handlers]) fn(event);
  }
}
class Input {
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
      this[event] = new Event();
  }
}
class Vector {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
const rotation = { multiplyVec3: (v) => v, multiply: () => rotation };
class ObjectNode {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.children = [];
    this.components = [];
    this.position = new Vector();
    this.scale = new Vector(1, 1, 1);
    objects.set(name, this);
    roots.push(this);
  }
  setParent(parent) {
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
    else roots.splice(roots.indexOf(this), 1);
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
      setLocalPosition: (v) => (node.position = v),
      setWorldPosition: (v) => (node.position = v),
      getLocalPosition: () => node.position,
      getWorldPosition: () => node.position,
      setLocalRotation() {},
      setWorldRotation() {},
      getWorldRotation: () => rotation,
      setLocalScale: (v) => (node.scale = v),
      setWorldScale: (v) => (node.scale = v),
      getWorldScale: () => node.scale,
      getWorldTransform: () => ({
        multiplyPoint: (v) => v,
        multiplyDirection: (v) => v,
      }),
      getInvertedWorldTransform: () => ({
        multiplyPoint: (v) => v,
        multiplyDirection: (v) => v,
      }),
    };
  }
  createComponent(type) {
    let component;
    if (type === "Interactable") component = new Input();
    else if (type === "Component.Text") component = { textFill: {} };
    else if (type === "Component.ScriptComponent")
      component = {
        createEvent: () => ({ bind: (fn) => updates.push(fn) }),
        removeEvent() {},
      };
    else component = {};
    component.type = type;
    this.components.push(component);
    return component;
  }
  getComponent(type) {
    return this.components.find((component) => component.type === type);
  }
  destroy() {
    this.enabled = false;
    objects.delete(this.name);
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}
let paneViews = [];
let cameraRight;
function load(file) {
  file = path.resolve(file);
  if (!path.extname(file)) file += ".ts";
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  let sourcePath = file;
  const source = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText;
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      getDeltaTime: () => 1 / 60,
      vec3: Vector,
      vec4: class {
        constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); }
      },
      quat: { fromEulerAngles: () => rotation },
      Shape: { createBoxShape: () => ({}) },
      HorizontalAlignment: { Center: 0 },
      VerticalAlignment: { Center: 0 },
      HorizontalOverflow: { Wrap: 0 },
      Rect: { create: () => ({}) },
      global: {
        scene: {
          createSceneObject: (name) => new ObjectNode(name),
          getRootObjectsCount: () => roots.length,
          getRootObject: (i) => roots[i],
        },
      },
      require: (name) => {
        if (name.includes("WorldCameraFinderProvider"))
          return {
            __esModule: true,
            default: { getInstance: () => ({ right: () => cameraRight }) },
          };
        if (name.startsWith("SpectaclesInteractionKit"))
          return { Interactable: Input };
        if(name.includes('AuthorPropsHandles'))return {AuthorPropsHandles:class {constructor(ports){this.controller=new (load(path.join(assets,'Author/AuthorPropsController.ts')).AuthorPropsController)(ports);}sync(){this.controller.sync();}cancel(){this.controller.cancel();}dispose(){}}};
        if (name.endsWith('/RecordedGlass'))
          return {
            recordedPaneViews: () => paneViews,
            toggleRecordingDetail: () => false,
            recordingDetailEnabled: () => false,
          };
        return load(name.startsWith('@app/')?path.join(assets,name.slice(5)):path.resolve(path.dirname(file.endsWith(path.join('Author','AuthorViewSession.ts'))?sourcePath:file), name));
      },
    },
    { filename: sourcePath },
  );
  return module.exports;
}
const Domain = load(path.join(assets, "Domain/index.ts"));
const { DetectiveSession } = load(
  path.join(assets, "Detective/DetectiveSession.ts"),
);
const { PlayTable } = load(path.join(assets, "Runtime/PlayTable.ts"));
const { observationContacts, nextObservation } = load(
  path.join(assets, "Runtime/MuseumGame/ObservationContacts.ts"),
);
const project = (view) =>
  view.payload.fragments[0]?.projection ??
  view.payload.palms?.[0]?.projection ??
  view.payload.actions[0]?.projection ??
  view.payload.exhibitSurface?.projection;
function run(rearCamera) {
  const compiled = Domain.compileCase(Domain.createPackingCase({ rearCamera }));
  assert(compiled.ok);
  const pane = new ObjectNode("PublicRecordedGlass");
  let table, state;
  const session = new DetectiveSession(compiled.sealed, {
    render: (detective, board) => {
      const surfaces = detective.observations.flatMap((view) => {
        const p = project(view);
        if (!p) return [];
        return [
          {
            observationId: view.id,
            kind: view.observation.kind,
            segment: view.observation.segment ?? view.id,
            via:
              view.payload.fragments[0]?.via ??
              view.payload.palms?.[0]?.via ??
              view.payload.actions[0]?.via ??
              view.payload.exhibitSurface?.via ??
              "direct",
            centerCm: [p.horizontal * 30, p.vertical * 30, 0],
            widthCm: 3,
            heightCm: 3,
          },
        ];
      });
      paneViews = [{ root: pane, surfaces }];
      state = {
        flow: {
          mode: "detective",
          caseId: board.caseId,
          revision: board.rev,
          title: "",
          primary: "",
          message: "",
          inputEpoch: 0,
          hasDraft: false,
          tutorial: false,
          shelf: [],
        },
        board,
        detective,
      };
      table?.render(state);
    },
    clear() {},
  });
  table = new PlayTable(new ObjectNode("Room"), {
    propMaterial:{},
    dispatch: (action, payload) => {
      assert.equal(action, "detective");
      session.dispatch(payload);
    },
  });
  table.render(state);
  updates.forEach((fn) => fn());
  const click = (name) => {
    const object = objects.get("Use_" + name);
    assert(object?.enabled, "Missing physical target " + name);
    const input = object.getComponent("Interactable");
    assert(input);
    input.onTriggerStart.fire();
    input.onTriggerEnd.fire();
    updates.forEach((fn) => fn());
  };
  const select = (id) => {
    let taps = 0;
    while (session.snapshot().focusedObservation?.id !== id && taps++ < 20) {
      const group = table
        .readObservationTargets()
        .find((target) => target.observationIds.includes(id));
      assert(group, "No visible contact target for " + id);
      click(group.targetName.slice(4));
    }
    assert.equal(session.snapshot().focusedObservation?.id, id);
  };
  const pin = (id) => {
    select(id);
    const n = session.snapshot().glass.length;
    click("PinGlass");
    assert.equal(session.snapshot().glass.length, n + 1);
    assert(session.snapshot().glass.some((glass) => glass.id === id));
  };
  if (!rearCamera) {
    // Scrub to a frame before the alarm, then play it using the physical clock.
    // An unconditional replay here used to jump the figure straight to the theft.
    const alarmTick = compiled.sealed.board.alarmTick;
    for (let tick = session.snapshot().tick; tick > 3; tick--)
      click("EntryClockPrevious");
    click("EntryClock");
    assert.equal(session.snapshot().tick, 3);
    assert.equal(session.snapshot().playing, true);
    session.update(0.25);
    assert.equal(session.presentationTick(), 3.5);
    session.update(0.25);
    click("EntryClock");
    assert.equal(session.snapshot().playing, false);
    click("EntryClock");
    assert.equal(session.presentationTick(), 4);
    click("EntryClockReset");
    assert.equal(session.presentationTick(), alarmTick);
    click("EntryClock");
    assert.equal(session.snapshot().playing, false);

    // Viewer-right is -Z after a quarter turn, independent of story X.
    // Turning the camera during the held gesture must retain the captured axis.
    const clockInput = objects.get("Use_EntryClock").getComponent("Interactable");
    cameraRight = new Vector(0, 0, -1);
    clockInput.onDragStart.fire();
    cameraRight.z = 1;
    clockInput.onDragUpdate.fire({ dragVector: new Vector(0, 0, -8) });
    assert.equal(session.snapshot().tick, alarmTick + 4);
    clockInput.onDragUpdate.fire({ dragVector: new Vector(0, 0, 16) });
    assert.equal(session.snapshot().tick, alarmTick - 4);
    clockInput.onDragUpdate.fire({ dragVector: new Vector(0, 0, -8) });
    clockInput.onDragEnd.fire();
    cameraRight = undefined;
  }
  click("Sourceentrance");
  const taking = session
    .snapshot()
    .observations.find(
      (view) =>
        view.observation.kind === "fragment" &&
        view.payload.fragments.some(
          (fragment) => fragment.role === "Conservator",
        ),
    );
  assert(taking);
  pin(taking.id);
  click("Findingtaker");
  click("SuspectConservator");
  click("CheckStamp");
  while (session.snapshot().checking) session.update(0);
  assert.equal(session.snapshot().fields.taker.value, "Conservator");
  assert.equal(session.snapshot().completed, false);
  if (rearCamera) {
    click("Sourcepassage");
    for (let i = 0; i < 3; i++) click("EntryClockNext");
    assert.equal(session.snapshot().tick, 15);
    const passing = session
      .snapshot()
      .observations.find((view) =>
        view.payload.actions.some((action) => action.kind === "Pass"),
      );
    assert(passing, "Rear camera must visibly observe the passing contact");
    pin(passing.id);
    const grouped = observationContacts(
      session
        .snapshot()
        .observations.slice(0, 2)
        .map((view) => ({
          observationId: view.id,
          kind: view.observation.kind,
          segment: view.id,
          via: "direct",
          centerCm: [0, 0, 0],
          widthCm: 3,
          heightCm: 3,
        })),
      session.snapshot().observations,
    );
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].observations.length, 2);
    assert.equal(nextObservation(grouped[0]).id, grouped[0].observations[0].id);
    assert.equal(
      nextObservation(grouped[0], grouped[0].observations[0].id).id,
      grouped[0].observations[1].id,
    );
    assert.equal(
      observationContacts(
        [
          {
            observationId: "stale-other-case",
            segment: "",
            via: "direct",
            centerCm: [0, 0, 0],
            widthCm: 3,
            heightCm: 3,
          },
        ],
        session.snapshot().observations,
      ).length,
      0,
    );
    for (const view of session.snapshot().observations)
      if (
        (view.observation.kind === "fragment" ||
          (view.observation.kind === "hand" && view.payload.hands.length)) &&
        !session.snapshot().glass.some((glass) => glass.id === view.id)
      )
        pin(view.id);
    click("Findingrecipient");
    click("SuspectCourier");
    click("CheckStamp");
    while (session.snapshot().checking) session.update(0);
    console.log(
      "rear recipient verdict",
      session.snapshot().verdict.status,
      session.snapshot().verdict.fieldValues.recipient,
    );
    assert.equal(session.snapshot().fields.recipient?.value, "Courier");
    const archive = session.archive();
    const restored = new DetectiveSession(compiled.sealed, {
      render() {},
      clear() {},
    });
    assert(restored.restoreArchive(archive));
    assert.equal(
      JSON.stringify(restored.snapshot().glass.map((glass) => glass.id)),
      JSON.stringify(session.snapshot().glass.map((glass) => glass.id)),
    );
    assert(restored.snapshot().glass.some((glass) => glass.id === passing.id));
    restored.dispose();
    const held = table.readObservationTargets()[0];
    const input = objects.get(held.targetName).getComponent("Interactable");
    input.onTriggerStart.fire();
    click("EntryClockNext");
    input.onTriggerEnd.fire();
    assert.equal(
      session.snapshot().focusedObservation,
      undefined,
      "A held old contact cannot select a new frame",
    );
  } else {
    click("Findingrecipient");
    click("UnknownFinding");
    click("CheckStamp");
    while (session.snapshot().checking) session.update(0);
    assert.equal(session.snapshot().fields.recipient.value, "Could be either");
    assert.equal(session.snapshot().completed, false);
  }
  table.dispose();
  session.dispose();
  pane.destroy();
}
run(false);
run(true);
console.log("Physical contact binding checks passed");
