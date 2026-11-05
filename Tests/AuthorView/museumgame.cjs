const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const compiler = process.env.PATH.split(path.delimiter).find((p) =>
  fs.existsSync(path.resolve(p, "../typescript/lib/typescript.js")),
);
assert(compiler);
const ts = require(path.resolve(compiler, "../typescript/lib/typescript.js"));
const assets = path.resolve("Assets");
const overlays=new Map();
const cache = new Map(),
  events = [];
let time = 0.25;
class Component {
  static getTypeName() {
    return this.name;
  }
  createEvent(name) {
    return {
      bind(fn) {
        if (name === "UpdateEvent") events.push(fn);
      },
    };
  }
}
function node() {
  return {
    setParent() {},
    destroy() {},
    createComponent() {
      const C = load(
        path.join(assets, "Author/AuthorController.ts"),
      ).AuthorController;
      const c = new C();
      c.onAwake();
      return c;
    },
  };
}
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const code = ts.transpileModule(
    fs.readFileSync(overlays.get(file) ?? file, "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
      },
    },
  ).outputText;
  const sandbox = {
    module: m,
    exports: m.exports,
    BaseScriptComponent: Component,
    component: (c) => c,
    getDeltaTime: () => time,
    global: { scene: { createSceneObject: () => node() } },
    require: (p) =>
      p === "./PlayTable"
        ? {
            PlayTable: class {
              render() {}
              dispose() {}
              finishTimeDrag() {}
            },
          }
        : load(path.resolve(path.dirname(file), p + ".ts")),
  };
  vm.runInNewContext(code, sandbox, { filename: file });
  return m.exports;
}
const { MuseumGame } = load(path.join(assets, "Runtime/MuseumGame.ts"));
let sceneClears = 0,
  inputCancels = 0,
  dragFinishes = 0,
  lastPose,
  closed = false;
const rendered = [];
const game = new MuseumGame(node(), {
  createTable() {
    return {
      render() {},
      dispose() {},
      finishTimeDrag() {
        dragFinishes++;
      },
    };
  },
  presentPose: (t) => (lastPose = t),
  renderScene: (s) => {
    const copy = JSON.parse(JSON.stringify(s));
    rendered.push(copy);
    assert.ok(
      copy.flow.mode === "author" || !copy.authorView,
      "Author camera/trial view must never cross a role boundary",
    );
  },
  clearScene() {
    sceneClears++;
  },
  cancelInput() {
    inputCancels++;
  },
  setLid: (value) => (closed = value),
});
game.mount();
const flow = (type, rest = {}) => game.dispatch("flow", { type, ...rest }),
  author = (p) => game.dispatch("author", p),
  view = (p) => game.dispatch("authorView", p);
const snapshot = () => game.snapshot();
function pump(predicate, limit = 10000) {
  let i = 0;
  while (!predicate() && i++ < limit) {
    for (const f of [...events]) f();
    game.update(time);
  }
  assert.ok(i < limit, "Normal operation must finish");
  return i;
}
assert.equal(view({ type: "watchView", source: "entrance" }), false);
assert.equal(flow("stageTheft", { confirmed: true }), true);
assert.equal(snapshot().flow.mode, "author");
assert.equal(events.length, 1, "One real AuthorController clock");
assert.equal(author({ kind: "setTick", tick: 12 }), true);
assert.equal(author({ kind: "select", id: "B" }), true);
assert.equal(author({ kind: "startTest" }), true);
pump(() => !snapshot().author.testing);
assert.equal(snapshot().author.canSeal, true);
const original = JSON.stringify(snapshot().author.draft);
const source = snapshot().author.draft.witnesses[0].id;
assert.equal(view({ type: "watchView", source }), true);
assert.equal(snapshot().authorView.recording.frame.tick, 12);
assert.equal(snapshot().authorView.recording.frame.witness, source);
assert.equal(view({ type: "tryChange" }), true);
assert.equal(snapshot().authorView.mode, "change");
assert.equal(snapshot().author.canSeal, false);
assert.equal(
  author({ kind: "edit", edit: { kind: "setAperture", aperture: 0 } }),
  true,
);
assert.equal(snapshot().author.draft.room.mirror.aperture, 0);
assert.equal(view({ type: "watchView", source }), true);
assert.equal(view({ type: "compareChange" }), true);
pump(() => !snapshot().authorView.comparing);
let comparison = snapshot().authorView;
assert.equal(comparison.before.frame.tick, 12);
assert.equal(comparison.after.frame.tick, 12);
assert.equal(comparison.before.source, comparison.after.source);
assert.ok(
  comparison.before.frame.payload.fragments.some((f) => f.role === "Guard"),
);
assert.ok(
  !comparison.after.frame.payload.fragments.some((f) => f.role === "Guard"),
);
assert.ok(
  comparison.differences.some(
    (d) => d.field === "taker" && d.before.length === 1 && d.after.length === 2,
  ),
);
assert.equal(author({ kind: "confirmAmbiguity" }), true);
assert.equal(snapshot().author.canSeal, true);
assert.equal(
  flow("passCase"),
  false,
  "Verified trial must not seal CaseFlow-owned original",
);
assert.equal(snapshot().flow.mode, "author");
assert.equal(closed, false);
const staleGeneration = comparison.generation;
assert.equal(view({ type: "discardChange" }), true);
assert.equal(JSON.stringify(snapshot().author.draft), original);
assert.equal(snapshot().author.tick, 12);
assert.equal(snapshot().author.selected, "B");
assert.equal(snapshot().author.canSeal, true);
assert.equal(snapshot().authorView.mode, "recording");
assert.equal(view({ type: "tryChange" }), true);
assert.equal(view({ type: "keepChange", generation: staleGeneration }), false);
assert.equal(
  author({ kind: "edit", edit: { kind: "setAperture", aperture: 0 } }),
  true,
);
assert.equal(author({ kind: "setTick", tick: 14 }), true);
assert.equal(author({ kind: "play" }), true);
for (const f of [...events]) f();
game.update(0.25);
assert.equal(
  lastPose,
  14.5,
  "Fractional pose follows active trial, not paused base and not a second clock",
);
assert.equal(view({ type: "keepChange" }), true);
assert.equal(snapshot().author.draft.rev, JSON.parse(original).rev + 1);
assert.equal(snapshot().author.draft.room.mirror.aperture, 0);
assert.equal(snapshot().author.tick, 14);
assert.equal(snapshot().author.canSeal, false);
assert.equal(
  events.length,
  1,
  "Remount does not create extra controller updates",
);
assert.equal(author({ kind: "undo" }), true);
assert.equal(snapshot().author.draft.room.mirror.aperture, 1);
const beforeExit = JSON.stringify(snapshot().author.draft);
assert.equal(view({ type: "tryChange" }), true);
assert.equal(
  author({ kind: "edit", edit: { kind: "setAperture", aperture: 0 } }),
  true,
);
assert.equal(flow("leaveAuthor"), true);
assert.equal(snapshot().flow.mode, "ready");
assert.equal(snapshot().author, undefined);
assert.equal(snapshot().authorView, undefined);
assert.equal(view({ type: "keepChange" }), false);
assert.equal(flow("resumeDraft"), true);
assert.equal(
  JSON.stringify(snapshot().author.draft),
  beforeExit,
  "Role exit saves the base, never unaccepted trial edits",
);
assert.equal(snapshot().authorView.watching, false);
assert.equal(author({ kind: "startTest" }), true);
pump(() => !snapshot().author.testing);
assert.equal(flow("passCase"), true);
assert.equal(snapshot().flow.mode, "handoff");
assert.equal(snapshot().authorView, undefined);
assert.equal(snapshot().author, undefined);
assert.equal(closed, true);
assert.equal(flow("openCase"), true);
assert.equal(snapshot().flow.mode, "detective");
assert.equal(snapshot().authorView, undefined);
assert.equal(view({ type: "tryChange" }), false);
assert.ok(sceneClears > 0 && inputCancels > 0 && dragFinishes > 0);
game.dispose();
assert.equal(view({ type: "tryChange" }), false);
console.log(
  "Actual MuseumGame + AuthorController author view/trial/watch/compare/keep/discard/pass/role routes passed",
);
