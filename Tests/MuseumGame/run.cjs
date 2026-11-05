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
let renderedReveal;
let renderedTrueView;
let renderedBoard;
const renderHistory = load(
  path.join(assets, "Spatial/Reconstruction.ts"),
).renderHistory;
const poseSamples = [];
let viewPresentation;
let closed = false;
const game = new MuseumGame(node(), {
  presentPose: (tick) => {
    poseSamples.push(tick);
    if (renderedReveal)
      renderedTrueView = renderHistory(
        renderedBoard,
        renderedReveal.actualHistory,
        tick,
      );
  },
  caseView: {
    readViewer: () => ({ eyeCm: [350, 165, -340], forward: [0, 0, 1] }),
    finishTimeDrag() {},
    setPresentation: (presentation) => {
      viewPresentation = presentation;
    },
    setFrameCovered() {},
    setSecondaryLabelsVisible() {},
    stopSound() {},
  },
  renderScene: (s, reveal) => {
    renderedReveal = reveal;
    renderedBoard = s.board;
    renderedTrueView = reveal
      ? renderHistory(
          s.board,
          reveal.actualHistory,
          s.reveal?.tick ?? s.detective.tick,
        )
      : undefined;
    renders.push(JSON.parse(JSON.stringify(s)));
  },
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
assert(!game.dispatch("reveal", { type: "play" }));
assert.equal(game.snapshot().view.mode, "museum");
assert.equal(viewPresentation, undefined);
assert.equal(game.snapshot().detective.tick, 8);
assert.equal(game.snapshot().detective.playing, true);
game.update(0.125);
assert.equal(poseSamples.at(-1), 8.25);
for (let i = 0; i < 8; i++) game.update(0.25);
assert.equal(game.snapshot().detective.tick, 12);
assert.equal(game.snapshot().detective.playing, false);
assert(detective({ type: "play" }));
game.update(0.125);
assert.equal(poseSamples.at(-1), 12.25);
assert.equal(game.snapshot().detective.tick, 12);
assert(detective({ type: "freeze" }));
game.update(0);
assert.equal(poseSamples.at(-1), 12);
assert(!author({ kind: "play" }));
assert(
  game.snapshot().board,
  "The initial room must have public geometry before replay",
);
// The two visible marks are individually selected through the normal route.
detective({ type: "seek", tick: 12 });
const initialMarks = game
  .snapshot()
  .detective.observations.filter(
    (mark) => mark.observation.kind === "fragment",
  );
assert.equal(initialMarks.length, 2);
assert(detective({ type: "selectObservation", id: initialMarks[0].id }));
assert(detective({ type: "pin" }));
assert.equal(game.snapshot().detective.glass.length, 1);
assert(detective({ type: "claim", claim: "Conservator" }));
assert(detective({ type: "check" }));
pump(() => !game.snapshot().detective.checking);
assert.equal(game.snapshot().detective.verdict.status, "needClue");
assert(detective({ type: "selectObservation", id: initialMarks[1].id }));
assert(detective({ type: "pin" }));
assert(detective({ type: "check" }));
pump(() => game.snapshot().flow.mode === "finished");
assert.equal(game.snapshot().detective.verdict.status, "proved");
const proofIds = game.snapshot().detective.glass.map((glass) => glass.id);
const proofVerdict = JSON.stringify(game.snapshot().detective.verdict);
assert(game.dispatch("view", { type: "chooseView" }));
assert(game.dispatch("view", { type: "standByCase" }));
assert.equal(game.snapshot().view.mode, "room");
assert.equal(viewPresentation.kind, "room");
assert(game.dispatch("view", { type: "backToTable" }));
assert.equal(game.snapshot().view.mode, "table");
assert.deepEqual(
  game.snapshot().detective.glass.map((glass) => glass.id),
  proofIds,
);
assert.equal(JSON.stringify(game.snapshot().detective.verdict), proofVerdict);
assert.equal(game.snapshot().detective.tick, 12);
assert(game.dispatch("view", { type: "closeView" }));
assert.equal(viewPresentation, undefined);
const proofEpoch = game.snapshot().flow.inputEpoch;
assert(flow("replayEvidence"));
assert(game.snapshot().flow.inputEpoch > proofEpoch);
assert.deepEqual(
  game.snapshot().detective.glass.map((glass) => glass.id),
  proofIds,
);
assert.equal(game.snapshot().detective.tick, 12);
game.update(0);
assert.equal(game.snapshot().flow.mode, "detective");
assert(!game.snapshot().detective.completed);
assert(detective({ type: "selectClue", id: proofIds[0] }));
assert(detective({ type: "remove" }));
assert(detective({ type: "check" }));
pump(() => !game.snapshot().detective.checking);
assert.equal(game.snapshot().detective.verdict.status, "needClue");
assert(detective({ type: "undo" }));
assert(detective({ type: "check" }));
pump(() => game.snapshot().flow.mode === "finished");
assert.equal(game.snapshot().detective.verdict.status, "proved");
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
assert(!game.dispatch("reveal", { type: "play" }));
assert(!game.snapshot().reveal);
assert(!game.snapshot().author);
assert(!flow("passCase"));
assert(flow("openCase"));
assert(!flow("openCase"));
assert(!closed);
assert.equal(game.snapshot().detective.playing, false);
assert.equal(game.snapshot().detective.tick, game.snapshot().board.alarmTick);
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
detective({ type: "source", source: "entrance" });
detective({ type: "seek", tick: 12 });
const takingMark = game
  .snapshot()
  .detective.observations.find((mark) =>
    mark.payload.fragments.some((fragment) => fragment.role === "Conservator"),
  );
assert(takingMark);
assert(detective({ type: "selectObservation", id: takingMark.id }));
assert(detective({ type: "pin" }));
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
const archivedProof = game.snapshot().detective;
assert(detective({ type: "reveal" }));
assert(renderedReveal);
require("./reveal-runtime.cjs")({
  game,
  readNativeView: () => renderedTrueView,
  poseSamples,
  publicTape: new (load(
    path.join(assets, "Shelf/SessionShelf.ts"),
  ).SessionShelf)().publicCase({
    id: archivedProof.caseId,
    rev: archivedProof.rev,
  }).clues,
  getObservations: load(path.join(assets, "Domain/observe.ts")).getObservations,
});
assert(!detective({ type: "claim", claim: "Guard" }));
assert(flow("replayEvidence"));
assert.equal(renderedReveal, undefined);
assert.equal(renderedTrueView, undefined);
assert.equal(game.snapshot().reveal, undefined);
assert(!game.dispatch("reveal", { type: "play" }));
assert.equal(game.snapshot().flow.mode, "detective");
assert.equal(game.snapshot().detective.tick, revealTick);
assert.equal(game.snapshot().detective.source, archivedProof.source);
assert.deepEqual(
  game.snapshot().detective.glass.map((glass) => glass.id),
  archivedProof.glass.map((glass) => glass.id),
);
assert.deepEqual(game.snapshot().detective.claim, archivedProof.claim);
assert(!game.snapshot().author);
assert(!game.snapshot().detective.completed);
assert(!JSON.stringify(game.snapshot()).includes("actualHistory"));
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
// Storage accepts exact public observations, and never carries them into a
// different case or sealed revision. Legacy raw IDs remain readable.
const { SessionShelf } = load(path.join(assets, "Shelf/SessionShelf.ts"));
const shelf = new SessionShelf();
const archive = {
  caseId: "missing-ruby",
  rev: 1,
  tick: 12,
  source: "entrance",
  ids: proofIds,
  claim: "Conservator",
};
assert(shelf.saveAttempt(archive));
assert(!shelf.saveAttempt({ ...archive, caseId: "packing-room" }));
assert(!shelf.saveAttempt({ ...archive, rev: 2 }));
assert(!shelf.saveAttempt({ ...archive, ids: [proofIds[0] + ":stale"] }));
const legacyId = shelf.publicCase({ id: "missing-ruby", rev: 1 }).clues.clues[0]
  .id;
assert(shelf.saveAttempt({ ...archive, ids: [legacyId] }));
const { AuthorSession } = load(path.join(assets, "Author/AuthorSession.ts"));
const { DetectiveSession } = load(
  path.join(assets, "Detective/DetectiveSession.ts"),
);
const { createMuseumTheft, compileCase } = load(
  path.join(assets, "Domain/index.ts"),
);
const draft = createMuseumTheft(true);
const compiled = compileCase(draft);
assert(compiled.ok);
require("./presentation.cjs")({
  AuthorSession,
  DetectiveSession,
  draft,
  sealed: compiled.sealed,
});
require("./proof-equivalence.cjs")({
  prove: load(path.join(assets, "Domain/prove.ts")).prove,
  compileCase,
  createMuseumTheft,
});
require("./reveal.cjs")({
  RevealTransport: load(
    path.join(assets, "Runtime/MuseumGame/RevealTransport.ts"),
  ).RevealTransport,
  renderHistory,
  board: compiled.sealed.board,
  history: compiled.vault.actualHistory,
});
const interrupted = new MuseumGame(node(), {
  renderScene() {},
  clearScene() {},
  setLid() {},
  cancelInput() {},
});
interrupted.mount();
interrupted.update(0.25);
assert.equal(interrupted.snapshot().detective.playing, true);
assert(interrupted.dispatch("detective", { type: "seek", tick: 5 }));
interrupted.update(0.25);
assert.equal(interrupted.snapshot().detective.tick, 5);
assert.equal(interrupted.snapshot().detective.playing, false);
assert(
  interrupted.dispatch("flow", { type: "finishAttempt", confirmed: true }),
);
assert(interrupted.dispatch("flow", { type: "replayAlarm" }));
assert.equal(interrupted.snapshot().detective.tick, 5);
assert.equal(interrupted.snapshot().detective.playing, false);
interrupted.dispose();
console.log("MuseumGame real-controller route checks passed");

require("./recording.cjs")({
  AuthorSession,
  AuthorController: load(path.join(assets, "Author/AuthorController.ts")).AuthorController,
  createMuseumTheft,
  events,
});
