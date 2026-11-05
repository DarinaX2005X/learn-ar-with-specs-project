const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const typescriptBinDirectory = process.env.PATH.split(path.delimiter).find(
  (typescriptBinDirectory) => {
    const typescriptPackagePath = path.resolve(
      typescriptBinDirectory,
      "../typescript/package.json",
    );
    return (
      fs.existsSync(typescriptPackagePath) &&
      JSON.parse(fs.readFileSync(typescriptPackagePath, "utf8")).version ===
        "6.0.2"
    );
  },
);
assert(
  typescriptBinDirectory,
  "Run Tests/Recording/run.ps1 to provision TypeScript6.0.2",
);
const typescript = require(
  path.resolve(typescriptBinDirectory, "../typescript/lib/typescript.js"),
);
const assets = path.resolve(__dirname, "../../Assets");
function createModuleLoader() {
  const moduleCache = new Map();
  function loadModule(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += ".ts";
    if (moduleCache.has(file)) return moduleCache.get(file).exports;
    const evaluatedModule = { exports: {} };
    moduleCache.set(file, evaluatedModule);
    vm.runInNewContext(
      typescript.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
          module: typescript.ModuleKind.CommonJS,
          target: typescript.ScriptTarget.ES2021,
        },
      }).outputText,
      {
        module: evaluatedModule,
        exports: evaluatedModule.exports,
        vec4: class {
          constructor(...values) {
            this.v = values;
          }
        },
        require(name) {
          if (name.startsWith("SpectaclesInteractionKit")) return {};
          if (name.endsWith("MuseumFonts")) return { applyMuseumFont() {} };
          return loadModule(
            name.startsWith("@app/")
              ? path.join(assets, name.slice(5))
              : path.resolve(path.dirname(file), name),
          );
        },
      },
      { filename: file },
    );
    return evaluatedModule.exports;
  }
  return loadModule;
}
const loadModule = createModuleLoader(),
  Domain = loadModule(path.join(assets, "Domain/index.ts")),
  { DetectiveSession } = loadModule(
    path.join(assets, "Detective/DetectiveSession.ts"),
  ),
  { PlayTable } = loadModule(path.join(assets, "Runtime/PlayTable.ts")),
  { CasePaper, evidenceInscription } = loadModule(
    path.join(assets, "Runtime/CasePaper.ts"),
  );
function buildEvidenceControls(detectiveState) {
  const targets = new Map(),
    playTable = Object.create(PlayTable.prototype);
  Object.assign(playTable, {
    state: {
      detective: detectiveState,
      board: {
        room: { exhibit: { position: { x: 0, y: 1, z: 0 } }, boxes: [] },
        witnesses: [],
      },
    },
    bindObject(id, at, size, label, click, active) {
      targets.set(id, { label, click, active });
    },
  });
  playTable.detectiveObjects();
  return targets;
}
const ordinary = Domain.compileCase(Domain.createPackingCase());
assert(ordinary.ok, JSON.stringify(ordinary.errors));
for (const count of [0, 1, 2, 3]) {
  // Compiler-produced sealed case; each actor can physically brush the same rim.
  const draft = Domain.createMirrorCase();
  draft.id = "rim-" + count;
  draft.events = [{ kind: "Take", track: "B", tick: 12 }];
  draft.tracks.forEach(
    (track) =>
      (track.keys = track.keys.map((keyframe) => ({
        ...keyframe,
        x: 2.3,
        z: 4,
      }))),
  );
  for (let i = 0; i < count; i++)
    draft.events.push({
      kind: "BrushRim",
      track: ["A", "B", "C"][i],
      tick: 4 + i,
    });
  const compiled = Domain.compileCase(draft);
  assert(compiled.ok, JSON.stringify(compiled.errors));
  const sealed = compiled.sealed,
    rim = sealed.clues.clues.find((clue) => clue.kind === "Rim");
  assert.equal(rim.shapes.length, count);
  let cleared = false;
  const session = new DetectiveSession(sealed, {
    render() {},
    clear() {
      cleared = true;
    },
  });
  let detectiveState = session.snapshot();
  assert.equal(
    buildEvidenceControls(detectiveState)
      .get("Inspect" + rim.id)
      .label(),
    "Inspect rim",
  );
  assert.equal(detectiveState.glass.length, 0);
  session.dispatch({ type: "inspectObject", id: rim.id });
  detectiveState = session.snapshot();
  assert.equal(detectiveState.frame.kind, "Rim");
  assert.equal(detectiveState.focusedObservation, undefined);
  assert.equal(detectiveState.glass.length, 0);
  assert.equal(
    PlayTable.prototype.pinLabel.call({ state: { detective: detectiveState } }),
    "Pin evidence",
  );
  const finding = evidenceInscription(rim);
  assert.equal(count === 0, finding === "No rim marks found");
  for (const role of rim.shapes) assert(finding.includes(role));
  assert(!/taken|took|guilty|\d|time| s\b/i.test(finding));
  assert.equal(
    buildEvidenceControls(detectiveState)
      .get("Inspect" + rim.id)
      .label(),
    finding + "\nInspect again",
  );
  assert.equal(PlayTable.prototype.clueLabel(rim), "");
  session.dispatch({ type: "pin" });
  detectiveState = session.snapshot();
  assert.equal(detectiveState.visibleGlass[0].id, rim.id);
  assert.equal(
    evidenceInscription(detectiveState.visibleGlass[0].clue),
    finding,
  );
  session.dispatch({ type: "source", source: sealed.board.witnesses[0].id });
  detectiveState = session.snapshot();
  assert.equal(
    buildEvidenceControls(detectiveState)
      .get("Inspect" + rim.id)
      .label(),
    "Inspect rim",
  );
  assert.equal(
    detectiveState.visibleGlass[0].id,
    rim.id,
    "Changing source does not erase pinned physical evidence",
  );
  session.dispatch({ type: "selectClue", id: rim.id });
  detectiveState = session.snapshot();
  const paper = Object.create(CasePaper.prototype);
  Object.assign(paper, {
    disposed: false,
    epoch: 1,
    covered: false,
    result: { text: { text: "" }, object: {} },
    evidence: [0, 1, 2].map(() => ({
      text: { text: "", textFill: {} },
      object: {},
    })),
    layer: {},
  });
  const flow = {
    inputEpoch: 1,
    mode: "detective",
    caseId: detectiveState.caseId,
    revision: detectiveState.rev,
  };
  paper.render({ flow, detective: detectiveState });
  assert.equal(paper.evidence[0].text.text, finding);
  session.dispatch({ type: "remove" });
  paper.render({ flow, detective: session.snapshot() });
  assert.equal(paper.evidence[0].text.text, "");
  session.dispatch({ type: "undo" });
  paper.render({ flow, detective: session.snapshot() });
  assert.equal(paper.evidence[0].text.text, finding);
  // Epoch/handoff must erase stale evidence, and a new session starts with inspect action.
  paper.render({
    flow: { ...flow, inputEpoch: 2, mode: "handoff" },
    detective: undefined,
  });
  assert.equal(paper.layer.enabled, false);
  assert(paper.evidence.every((x) => x.text.text === ""));
  session.dispose();
  assert(cleared);
  const fresh = new DetectiveSession(sealed, { render() {}, clear() {} });
  assert.equal(
    buildEvidenceControls(fresh.snapshot())
      .get("Inspect" + rim.id)
      .label(),
    "Inspect rim",
  );
  fresh.dispose();
}
const packingSession = new DetectiveSession(ordinary.sealed, {
  render() {},
  clear() {},
});
const packingRim = ordinary.sealed.clues.clues.find(
  (clue) => clue.kind === "Rim",
);
packingSession.dispatch({ type: "inspectObject", id: packingRim.id });
assert.equal(
  buildEvidenceControls(packingSession.snapshot())
    .get("Inspect" + packingRim.id)
    .label(),
  evidenceInscription(packingRim) + "\nInspect again",
);
packingSession.dispatch({ type: "pin" });
assert.equal(
  evidenceInscription(packingSession.snapshot().visibleGlass[0].clue),
  "Rim marks\nGuard",
);
packingSession.dispose();
console.log(
  "PASS actual sealed0..3 rim observations, immediate inspect/pin, " +
    "factual paper, remove/undo and role cleanup",
);
for (const box of ordinary.sealed.clues.clues.filter(
  (clue) => clue.kind === "Box",
)) {
  assert.equal(
    evidenceInscription(box),
    (box.present ? "Ruby in " : "No ruby in ") + box.box,
  );
}
const frame = Domain.getObservations(
  ordinary.sealed.clues,
  "entrance",
  12,
).find(
  (clue) =>
    clue.observation.kind === "fragment" && clue.payload.fragments.length === 1,
);
assert(frame);
const fragment = frame.payload.fragments[0];
assert.equal(
  evidenceInscription(frame),
  (fragment.role ?? "Unidentified figure") +
    (fragment.via === "mirror" ? "\nin mirror" : "") +
    "\nEntrance 6.0 s",
);
console.log(
  "PASS ordinary box/recorded frame finding and fixed source/time unchanged",
);
