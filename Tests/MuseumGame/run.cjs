const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  assert = require("assert");
// npm exec adds the requested package's .bin directory to PATH. Resolve its
// sibling module, rather than choosing an unrelated compiler from npm's cache.
const compilerDirectory = process.env.PATH.split(path.delimiter).find(
  (directory) => {
    const manifest = path.resolve(directory, "../typescript/package.json");
    return (
      fs.existsSync(manifest) &&
      JSON.parse(fs.readFileSync(manifest, "utf8")).version === "6.0.2"
    );
  },
);
assert(compilerDirectory, "Run through run.ps1 to provision TypeScript 6.0.2");
const ts = require(
  path.resolve(compilerDirectory, "../typescript/lib/typescript.js"),
);
const assets = path.resolve(__dirname, "../../Assets"),
  cache = new Map(),
  events = [];
class Component {
  static getTypeName() {
    return this.name;
  }
  createEvent(name) {
    return {
      bind: (fn) => {
        if (name === "UpdateEvent") events.push(fn);
      },
    };
  }
}
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
  const sandbox = {
    exports: m.exports,
    module: m,
    BaseScriptComponent: Component,
    component: (c) => c,
    getDeltaTime: () => 0.25,
    global: { scene: { createSceneObject: () => node() } },
    require: (p) => {
      if (p === "./PlayTable")
        return {
          PlayTable: class {
            render() {}
            dispose() {}
          },
        };
      return load(path.resolve(path.dirname(file), p + ".ts"));
    },
  };
  vm.runInNewContext(code, sandbox, { filename: file });
  return m.exports;
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
const { MuseumGame } = load(path.join(assets, "Runtime/MuseumGame.ts"));
const renders = [];
let closed = false;
const game = new MuseumGame(node(), {
  renderScene: (s) => renders.push(JSON.parse(JSON.stringify(s))),
  clearScene() {},
  setLid: (v) => (closed = v),
  cancelInput() {},
});
game.mount();
const flow = (type, extra = {}) => game.dispatch("flow", { type, ...extra });
const author = (p) => game.dispatch("author", p),
  detective = (p) => game.dispatch("detective", p);
const pump = (predicate, n = 10000) => {
  for (let i = 0; i < n && !predicate(); i++) {
    events.forEach((f) => f());
    game.update(0.25);
  }
  assert(predicate(), "operation did not finish");
};
assert.equal(game.snapshot().flow.mode, "detective");
assert(!author({ kind: "play" }));
assert(
  game.snapshot().board,
  "The initial room must have public geometry before replay",
);
assert(!flow("stageTheft"));
assert(flow("stageTheft", { confirmed: true }));
assert(author({ kind: "edit", edit: { kind: "setAperture", aperture: 0 } }));
assert(author({ kind: "startTest" }));
pump(() => !game.snapshot().author.testing);
assert(game.snapshot().author.needsAmbiguityConfirmation);
assert(!flow("passCase"));
assert(author({ kind: "confirmAmbiguity" }));
assert(flow("passCase"));
assert(closed);
assert(!game.snapshot().author);
assert(!flow("passCase"));
assert(flow("openCase"));
assert(!flow("openCase"));
assert(!closed);
assert(!game.snapshot().author);
assert(!author({ kind: "play" }));
assert(detective({ type: "claim", claim: "Guard" }));
assert(detective({ type: "check" }));
pump(() => !game.snapshot().detective.checking);
assert(!game.snapshot().detective.completed);
assert(detective({ type: "checkAll" }));
pump(() => game.snapshot().flow.mode === "finished");
assert(game.snapshot().detective.completed);
assert(flow("finishAttempt", { confirmed: true }));
assert(flow("selectCase", { id: "packing-room" }));
assert(flow("replayAlarm"));
assert.equal(game.snapshot().detective.caseId, "packing-room");
assert(
  detective({ type: "source", source: game.snapshot().board.witnesses[0].id }),
);
assert(detective({ type: "pin" }));
for (const w of game.snapshot().board.witnesses)
  for (let tick = 0; tick <= 24; tick++) {
    detective({ type: "source", source: w.id });
    detective({ type: "seek", tick });
    detective({ type: "pin" });
  }
detective({ type: "claim", claim: { taker: "Conservator" } });
detective({ type: "check" });
pump(() => !game.snapshot().detective.checking);
assert.equal(game.snapshot().detective.verdict.status, "proved");
// Each field remains a separate public finding; a proved taker must not invent a cache observation.
assert(!game.snapshot().detective.fields.cache);
assert.equal(game.snapshot().flow.mode, "detective");
for (const object of game.snapshot().detective.objects) {
  assert(detective({ type: "inspectObject", id: object.id }));
  assert(detective({ type: "pin" }));
}
assert(detective({ type: "selectField", field: "cache" }));
assert(detective({ type: "claimField", field: "cache", value: "brass case" }));
assert(detective({ type: "check" }));
pump(() => !game.snapshot().detective.checking);
assert.equal(game.snapshot().detective.verdict.status, "proved");
assert(detective({ type: "selectField", field: "recipient" }));
assert(
  detective({
    type: "claimField",
    field: "recipient",
    value: "Underdetermined",
  }),
);
assert(detective({ type: "check" }));
pump(() => game.snapshot().flow.mode === "finished");
assert(game.snapshot().detective.completed);
const revealTick = game.snapshot().detective.tick;
assert(detective({ type: "reveal" }));
assert.equal(game.snapshot().detective.tick, revealTick);
assert(!detective({ type: "claim", claim: "Guard" }));
assert(flow("finishAttempt", { confirmed: true }));
assert(flow("stageTheft"));
assert(
  author({ kind: "edit", edit: { kind: "removeEvent", eventKind: "Take" } }),
);
assert(!author({ kind: "startTest" }));
assert(!flow("passCase"));
assert.equal(game.snapshot().flow.mode, "author");
assert(
  renders
    .filter((s) => s.flow.mode === "handoff")
    .every((s) => !s.author && !s.detective && !s.board),
);
assert(
  renders.filter((s) => s.flow.mode === "detective").every((s) => !s.author),
);
game.dispose();
assert(!flow("replayAlarm"));
console.log("MuseumGame real-controller route checks passed");
