const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const compiler = process.env.PATH.split(path.delimiter).find((directory) => {
  const file = path.resolve(directory, "../typescript/package.json");
  return (
    fs.existsSync(file) &&
    JSON.parse(fs.readFileSync(file, "utf8")).version === "6.0.2"
  );
});
assert(compiler, "Run run-listener.ps1 to provision TypeScript 6.0.2");
const ts = require(path.resolve(compiler, "../typescript/lib/typescript.js"));
const assets = path.resolve(__dirname, "../../Assets"),
  cache = new Map();
let roots,
  messages,
  providedCamera,
  childReads,
  played,
  time,
  games,
  rejectListener;
const output = {
  isSame(other) {
    return other === this;
  },
};
class Vector {
  constructor(x = 0, y = 0, z = 0) {
    Object.assign(this, { x, y, z });
  }
}
class Node {
  constructor(name) {
    Object.assign(this, {
      name,
      enabled: true,
      isEnabledInHierarchy: true,
      children: [],
      components: [],
      position: new Vector(),
    });
  }
  isSame(other) {
    return other === this;
  }
  setParent(parent) {
    roots = roots.filter((node) => node !== this);
    this.parent = parent;
    parent.children.push(this);
  }
  getChildrenCount() {
    childReads++;
    return this.children.length;
  }
  getChild(index) {
    childReads++;
    return this.children[index];
  }
  getComponents(kind) {
    return this.components.filter(
      (component) => component.kind === kind && !component.destroyed,
    );
  }
  getComponent(kind) {
    return this.getComponents(kind)[0] ?? null;
  }
  createComponent(kind) {
    if (rejectListener && kind === "Component.AudioListenerComponent")
      throw new Error("listener API unavailable in this profile");
    const component = {
      kind,
      enabled: true,
      isSame(other) {
        return other === this;
      },
      getSceneObject: () => this,
      destroy() {
        this.destroyed = this.isBeingDestroyed = true;
      },
    };
    if (kind === "Component.AudioComponent")
      Object.assign(component, {
        spatialAudio: {
          distanceEffect: {},
          directivityEffect: {},
          positionEffect: {},
        },
        play() {
          this.playing = true;
          played.push({ track: this.audioTrack, volume: this.volume });
        },
        isPlaying() {
          return !!this.playing;
        },
        isPaused() {
          return false;
        },
        stop() {
          this.playing = false;
        },
      });
    this.components.push(component);
    return component;
  }
  getTransform() {
    return {
      getWorldPosition: () => this.position,
      setWorldPosition: (position) => {
        this.position = position;
      },
    };
  }
  destroy() {
    this.destroyed = this.isBeingDestroyed = true;
    roots = roots.filter((node) => node !== this);
  }
}
class Component {
  constructor() {
    this.events = new Map();
    this.sceneObject = new Node("Countercase");
    roots.push(this.sceneObject);
  }
  createEvent(name) {
    return { bind: (callback) => this.events.set(name, callback) };
  }
}
class GamePort {
  constructor(root, ports) {
    this.ports = ports;
    this.mounts = this.updates = this.disposals = 0;
    games.push(this);
  }
  mount() {
    this.mounts++;
  }
  update() {
    this.updates++;
  }
  dispose() {
    this.disposals++;
  }
}
class ScenePort {
  constructor() {
    this.stampMotion = { cancel() {} };
  }
  updateNativeFinish() {}
  dispose() {}
}
const scene = {
  liveTarget: output,
  captureTarget: output,
  getRootObjectsCount: () => roots.length,
  getRootObject: (index) => roots[index],
  createSceneObject(name) {
    const node = new Node(name);
    roots.push(node);
    return node;
  },
};
function load(file) {
  file = path.resolve(file);
  if (!path.extname(file)) file += ".ts";
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      experimentalDecorators: true,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      BaseScriptComponent: Component,
      component: (value) => value,
      input() {},
      allowUndefined() {},
      vec3: Vector,
      Camera: { Type: { Perspective: 1 } },
      global: { scene },
      isNull: (value) => value == null || value.destroyed,
      getTime: () => time,
      getDeltaTime: () => 1 / 60,
      print: (message) => messages.push(message),
      require(name) {
        if (name.includes("WorldCameraFinderProvider"))
          return {
            __esModule: true,
            default: {
              getInstance: () => ({ getComponent: () => providedCamera }),
            },
          };
        if (name === "./MuseumGame") return { MuseumGame: GamePort };
        if (name === "./MuseumScene") return { MuseumScene: ScenePort };
        return load(path.resolve(path.dirname(file), name));
      },
    },
    { filename: file },
  );
  return module.exports;
}
function reset() {
  Object.defineProperty(scene, "liveTarget", {
    value: output,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(scene, "captureTarget", {
    value: output,
    writable: true,
    configurable: true,
  });
  roots = [];
  messages = [];
  played = [];
  games = [];
  providedCamera = undefined;
  childReads = time = 0;
  rejectListener = false;
}
function head(name = "head") {
  const node = new Node(name),
    camera = node.createComponent("Component.Camera");
  Object.assign(camera, { type: 1, renderTarget: output });
  node.createComponent("Component.DeviceTracking");
  roots.push(node);
  return { node, camera };
}
function listeners() {
  return roots.flatMap((node) =>
    node.getComponents("Component.AudioListenerComponent"),
  );
}
reset();
const { MuseumAudioListener } = load(
  path.join(assets, "Runtime/MuseumAudioListener.ts"),
);
const { CountercaseRuntime } = load(
  path.join(assets, "Runtime/CountercaseRuntime.ts"),
);
// The actual normal-path code inventories 1402 instrumented SDK nodes once, then uses cached references.
{
  reset();
  const h = head();
  providedCamera = h.camera;
  for (let index = 0; index < 1401; index++)
    h.node.children.push(new Node("museum-part"));
  const owner = new MuseumAudioListener();
  owner.update(0);
  assert.equal(listeners().length, 1);
  const visited = childReads;
  for (let frame = 1; frame <= 600; frame++) owner.update(frame / 60);
  assert.equal(
    childReads,
    visited,
    "stable actual normal path must never rescan descendants",
  );
  const foreignRoot = new Node("temporary template");
  roots.push(foreignRoot);
  const foreign = foreignRoot.createComponent(
    "Component.AudioListenerComponent",
  );
  owner.update(11);
  assert.equal(listeners().length, 1);
  assert.equal(listeners()[0], foreign);
  assert(!foreign.destroyed);
  const logged = messages.length,
    visits = childReads;
  for (let frame = 0; frame < 60; frame++) owner.update(12 + frame / 60);
  assert.equal(messages.length, logged);
  assert.equal(childReads, visits);
  foreign.destroy();
  owner.update(14);
  assert.equal(listeners().length, 1);
  owner.dispose();
  owner.dispose();
  assert.equal(listeners().length, 0);
}
// Existing listeners remain owned by the template, including disabled/inactive ones.
for (const state of ["enabled", "disabled", "inactive", "duplicate"]) {
  reset();
  const h = head();
  providedCamera = h.camera;
  const foreign = h.node.createComponent("Component.AudioListenerComponent");
  if (state === "disabled") foreign.enabled = false;
  if (state === "inactive") h.node.isEnabledInHierarchy = false;
  if (state === "duplicate")
    h.node.createComponent("Component.AudioListenerComponent");
  const before = h.node.components.slice(),
    owner = new MuseumAudioListener();
  assert.doesNotThrow(() => owner.update(0));
  const visited = childReads;
  owner.update(1);
  assert.equal(childReads, visited);
  owner.dispose();
  assert(before.every((component) => !component.destroyed));
  assert.equal(foreign.enabled, state !== "disabled");
}
// A transient profile switch is deferred once and resolves when known head state changes.
{
  reset();
  const first = head(),
    second = head("other profile");
  second.camera.enabled = false;
  providedCamera = first.camera;
  const owner = new MuseumAudioListener();
  owner.update(0);
  const original = listeners()[0];
  first.camera.enabled = false;
  owner.update(1);
  const visited = childReads,
    logged = messages.length;
  for (let frame = 0; frame < 120; frame++) owner.update(2 + frame / 60);
  assert.equal(childReads, visited);
  assert.equal(messages.length, logged);
  second.camera.enabled = true;
  providedCamera = second.camera;
  owner.update(5);
  assert(original.destroyed);
  assert.equal(listeners().length, 1);
  assert.equal(listeners()[0].getSceneObject(), second.node);
  owner.dispose();
  assert.equal(listeners().length, 0);
}
// Verify the exact normal runtime wiring also stays off the descendant graph after mount.
{
  reset();
  const h = head();
  providedCamera = h.camera;
  for (let index = 0; index < 1401; index++)
    h.node.children.push(new Node("museum-part"));
  const runtime = new CountercaseRuntime();
  runtime.onAwake();
  runtime.events.get("OnStartEvent")();
  assert.equal(games[0].mounts, 1);
  assert.equal(listeners().length, 1);
  const visited = childReads;
  for (let frame = 0; frame < 600; frame++) runtime.events.get("UpdateEvent")();
  assert.equal(
    childReads,
    visited,
    "normal Runtime Update cannot trigger recurring graph inventory",
  );
  assert.equal(games[0].updates, 600);
  runtime.events.get("OnDestroyEvent")();
  assert.equal(listeners().length, 0);
}

// Exercise the real runtime's mount/update and accepted native foley path under bad audio config.
for (const configuration of [
  "missing-camera",
  "multiple-cameras",
  "foreign-listener",
  "listener-api-unavailable",
]) {
  reset();
  if (configuration !== "missing-camera") {
    const first = head();
    providedCamera = first.camera;
    if (configuration === "multiple-cameras") head("second output");
    else if (configuration === "foreign-listener") {
      const foreign = new Node("foreign listener");
      roots.push(foreign);
      foreign.createComponent("Component.AudioListenerComponent");
    }
  }
  rejectListener = configuration === "listener-api-unavailable";
  const foreignState = roots
    .flatMap((node) => node.components)
    .map((component) => ({ component, enabled: component.enabled }));
  const runtime = new CountercaseRuntime();
  runtime.museum_pin_01 = { name: "pin" };
  runtime.museum_stamp = { name: "stamp" };
  runtime.onAwake();
  assert.doesNotThrow(() => runtime.events.get("OnStartEvent")());
  assert.equal(games[0].mounts, 1);
  assert.doesNotThrow(() => runtime.events.get("UpdateEvent")());
  assert.equal(games[0].updates, 1);
  const target = new Node("Use_PinGlass");
  target.position = new Vector(-350, 102, 322);
  games[0].ports.soundAnchor(target);
  const before = {
    identity: "case:1",
    playing: false,
    pins: "",
    page: 0,
    completed: false,
    checking: false,
  };
  games[0].ports.foley.accepted("detective", "pin", true, before, {
    ...before,
    pins: "pinned",
  });
  time = 0.2;
  games[0].ports.foley.accepted("detective", "check", true, before, {
    ...before,
    checking: true,
  });
  assert.deepEqual(
    played.map((cue) => cue.track.name),
    ["pin", "stamp"],
  );
  assert(played.every((cue) => cue.volume === 0.34));
  const visits = childReads,
    logged = messages.length;
  for (let frame = 0; frame < 120; frame++) runtime.events.get("UpdateEvent")();
  assert.equal(childReads, visits);
  assert.equal(messages.length, logged);
  assert.doesNotThrow(() => runtime.events.get("OnDestroyEvent")());
  assert.equal(games[0].disposals, 1);
  assert(
    foreignState.every(
      ({ component, enabled }) =>
        !component.destroyed && component.enabled === enabled,
    ),
  );
  assert(
    runtime.sceneObject.children.every((node) => node.destroyed),
    "owned foley nodes are cleaned up",
  );
}
// Simulated platforms can reject texture getters even while the SIK head is valid.
for (const platform of [
  "live-ok-capture-throws",
  "live-null-capture-throws",
  "both-null",
  "both-throw",
  "ambiguous-without-output",
  "provider-mismatch",
]) {
  reset();
  const h = head();
  providedCamera = h.camera;
  if (platform === "ambiguous-without-output")
    head("second active tracked camera");
  if (platform === "provider-mismatch") {
    const other = head("inactive provider camera");
    other.camera.enabled = false;
    providedCamera = other.camera;
  }
  let liveReads = 0,
    captureReads = 0;
  Object.defineProperty(scene, "liveTarget", {
    configurable: true,
    get() {
      liveReads++;
      if (
        [
          "both-throw",
          "ambiguous-without-output",
          "provider-mismatch",
        ].includes(platform)
      )
        throw new Error("liveTarget unavailable on simulated platform");
      return platform === "live-ok-capture-throws" ? output : null;
    },
  });
  Object.defineProperty(scene, "captureTarget", {
    configurable: true,
    get() {
      captureReads++;
      if (platform !== "both-null")
        throw new Error("captureTarget unavailable on simulated platform");
      return null;
    },
  });
  const owner = new MuseumAudioListener();
  assert.doesNotThrow(() => owner.update(0));
  const expected = ["ambiguous-without-output", "provider-mismatch"].includes(
    platform,
  )
    ? 0
    : 1;
  assert.equal(listeners().length, expected, platform);
  const visits = childReads,
    logs = messages.length;
  for (let frame = 1; frame <= 600; frame++) owner.update(frame / 60);
  assert.equal(
    childReads,
    visits,
    platform + " must remain off the scene graph",
  );
  assert.equal(messages.length, logs, platform + " cannot repeat failure logs");
  if (platform === "live-ok-capture-throws")
    assert.equal(captureReads, 0, "liveTarget short-circuits captureTarget");
  else if (platform !== "both-null")
    assert.equal(
      captureReads,
      1,
      "unsupported captureTarget is read once per run",
    );
  if (
    ["both-throw", "ambiguous-without-output", "provider-mismatch"].includes(
      platform,
    )
  )
    assert.equal(liveReads, 1, "unsupported liveTarget is read once per run");
  owner.dispose();
  assert.equal(listeners().length, 0);
}

console.log(
  "PASS listener normal-path no-rescan, root/template duplicates, borrowed/disabled/inactive ownership, temporary camera switch and real Runtime mount/update + accepted pin/stamp continuation/cleanup. Native audibility and stereo remain separate checks.",
);
