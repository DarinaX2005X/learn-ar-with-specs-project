const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const compilerBin = process.env.PATH.split(path.delimiter).find((bin) => {
  const manifest = path.resolve(bin, "../typescript/package.json");
  return (
    fs.existsSync(manifest) &&
    JSON.parse(fs.readFileSync(manifest)).version === "6.0.2"
  );
});
assert(
  compilerBin,
  "Use npm exec --package typescript@6.0.2 -- node Tests/Recording/focused-evidence.cjs",
);
const ts = require(
  path.resolve(compilerBin, "../typescript/lib/typescript.js"),
);
const assets = path.resolve(__dirname, "../../Assets");
const loaded = new Map();
function load(file) {
  file = path.resolve(file);
  if (!path.extname(file)) file += ".ts";
  if (loaded.has(file)) return loaded.get(file);
  const value = {};
  loaded.set(file, value);
  const source = file;
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(source, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }).outputText,
    {
      exports: value,
      vec3: class {},
      vec4: class {},
      quat: { fromEulerAngles() {} },
      require(name) {
        if (name.startsWith("SpectaclesInteractionKit")) return {};
        if (name.endsWith("MuseumFonts")) return { applyMuseumFont() {} };
        return load(
          name.startsWith("@app/")
            ? path.join(assets, name.slice(5))
            : path.resolve(path.dirname(file), name),
        );
      },
    },
    { filename: source },
  );
  return value;
}
const { CasePaper } = load(path.join(assets, "Runtime/CasePaper"));
const { PlayTable } = load(path.join(assets, "Runtime/PlayTable"));
const { DetectiveSession } = load(
  path.join(assets, "Detective/DetectiveSession"),
);
const domain = load(path.join(assets, "Domain/index"));
function compile(draft) {
  const result = domain.compileCase(draft);
  assert(result.ok, JSON.stringify(result.errors));
  // Only the sealed object crosses this boundary.
  return result.sealed;
}

const surface = () => ({ object: {}, text: { text: "", textFill: {} } });
function journey(sealed, slot, clue, expected) {
  const flow = {
    mode: "detective",
    caseId: sealed.caseId,
    revision: sealed.rev,
    inputEpoch: 1,
  };
  const paper = Object.create(CasePaper.prototype);
  Object.assign(paper, {
    layer: {},
    result: surface(),
    detail: surface(),
    evidence: Array.from({ length: 3 }, () => ({
      finding: surface(),
      source: surface(),
      inscription: "",
    })),
  });
  const controls = new Map();
  const table = Object.create(PlayTable.prototype);
  const port = {
    render(detective, board) {
      table.state = { detective, board, flow };
      paper.render(table.state);
    },
    clear() {
      paper.clear();
    },
    revealTheft() {
      assert.fail("Selecting public evidence must not open the vault");
    },
  };
  const session = new DetectiveSession(sealed, port);
  const dispatched = [];
  Object.assign(table, {
    epoch: 1,
    actions: new Map(),
    find() {},
    findingObjects() {},
    ports: {
      dispatch(action, payload) {
        dispatched.push([action, payload.type, payload.id]);
        session.dispatch(payload);
      },
    },
    bindObject(id, position, size, label, click, active) {
      const control = {
        label,
        click,
        active,
        inscription: {
          getTransform: () => ({
            setLocalRotation() {},
            setLocalPosition() {},
          }),
        },
        input: {
          onTriggerStart: {
            add(handler) {
              control.start = handler;
            },
          },
        },
      };
      controls.set(id, control);
      return control;
    },
  });
  table.publicWorkbench([0, 0, 0]);
  table.detectiveObjects();
  const frames = domain.getObservations(
    sealed.clues,
    sealed.board.witnesses[0].id,
    12,
  );
  const filler = [
    ...sealed.clues.clues.filter((c) => c.kind !== "Frame"),
    ...frames,
  ].filter((c) => c.id !== clue.id);
  const order = [clue];
  order.splice(0, 0, ...filler.slice(0, slot));
  for (const item of order)
    session.dispatch({
      type: "pinClue",
      id: item.id,
      caseId: sealed.caseId,
      rev: sealed.rev,
    });
  session.dispatch({ type: "seek", tick: 1 });
  assert.equal(paper.detail.text.text, "");
  const ids = JSON.stringify(session.archive().ids);
  const target = controls.get("Evidence" + slot);
  assert(target.active());
  target.start();
  target.click();
  assert.deepEqual(dispatched, [["detective", "selectClue", clue.id]]);
  const s = session.snapshot();
  assert.equal(s.selected, clue.id);
  assert.equal(JSON.stringify(session.archive().ids), ids);
  assert.equal(s.verdict, undefined);
  assert.equal(s.reconstruction, undefined);
  assert.equal(s.comparison, undefined);
  if (clue.kind === "Frame") {
    assert.equal(s.focusedObservation.id, clue.id);
    assert.equal(s.source, clue.witness);
    assert.equal(s.tick, clue.tick);
    assert.equal(s.mode, "witness");
    if (clue.observation.kind === "fragment") {
      assert.equal(table.pinLabel(), "Pin " + clue.payload.fragments[0].role);
    }
  } else {
    assert.equal(s.frame.id, clue.id);
    assert.equal(s.mode, "table");
    const hover = controls.get("Inspect" + clue.id).label();
    if (clue.kind === "Rim")
      for (const role of clue.shapes) assert(hover.includes(role));
    if (clue.kind === "Box") assert.equal(hover, "Open " + clue.box);
  }
  assert.equal(
    paper.detail.text.text.replaceAll("\u200b", "").replaceAll("\u00a0", " "),
    expected,
  );
  if (clue.kind === "Frame" && expected)
    assert(paper.detail.text.text.endsWith("\u00a0s"));
  assert.equal(paper.detail.object.enabled, !!expected);
  assert.equal(paper.read().result, "");
  if (
    clue.kind === "Frame" &&
    clue.witness.startsWith("In mirror\n") &&
    clue.payload.fragments[0].via === "direct"
  ) {
    assert(
      !paper.evidence[slot].finding.text.text.includes("in mirror"),
      "A named camera cannot confer reflected provenance",
    );
    assert(paper.evidence[slot].source.text.text.startsWith(clue.witness));
  }
  const withState = (overrides) =>
    paper.render({ flow, detective: { ...s, ...overrides } });
  withState({ checking: true });
  assert.equal(paper.detail.object.enabled, false);
  withState({ verdict: { status: "incomplete" } });
  assert.equal(paper.read().result, "Check unfinished.\nTry again.");
  assert.equal(paper.detail.object.enabled, false);
  withState({ mode: "reconstruction" });
  assert.equal(paper.detail.object.enabled, false);
  paper.render({ flow: { ...flow, mode: "finished" }, detective: s });
  assert.equal(paper.detail.object.enabled, false);
  paper.render({ flow, detective: s });
  paper.setCovered(true);
  assert(!paper.read().visible);
  paper.setCovered(false);
  assert(paper.read().visible);
  session.dispatch({ type: "remove" });
  assert(!paper.detail.object.enabled);
  session.dispose();
  assert(!paper.layer.enabled);
}

const mirror = domain.createMirrorCase();
[mirror.casting.B, mirror.casting.C] = [mirror.casting.C, mirror.casting.B];
mirror.witnesses[0].id = "West mezzanine camera";
const custom = compile(mirror);
const views = domain.getObservations(custom.clues, mirror.witnesses[0].id, 12);
const reflected = views.find(
  (c) =>
    c.payload.fragments[0]?.role === "Conservator" &&
    c.payload.fragments[0].via === "mirror",
);
assert(reflected);
journey(
  custom,
  1,
  reflected,
  "Conservator in mirror\nWest mezzanine camera 6.0 s",
);
const packing = domain.createPackingCase();
const longBox = "East archive brass document case " + "A".repeat(48);
packing.room.boxes.find((b) => b.id === "brass case").id = longBox;
packing.events.find((e) => e.kind === "Stash").box = longBox;
const boxCase = compile(packing);
journey(
  boxCase,
  0,
  boxCase.clues.clues.find((c) => c.kind === "Box" && c.box === longBox),
  "Ruby found\n" + longBox,
);
const rimCase = domain.createMirrorCase();
rimCase.room.boxes = [{ id: "Archive case", position: { x: 3, y: 1, z: 1 } }];
for (const track of rimCase.tracks) {
  track.keys = track.keys.map((k) => ({ ...k, x: 2.3, z: 4 }));
  rimCase.events.push({
    kind: "BrushRim",
    track: track.id,
    tick: 4 + rimCase.events.length,
  });
}
const all = compile(rimCase);
const rim = all.clues.clues.find((c) => c.kind === "Rim");
assert.equal(rim.shapes.length, 3);
journey(all, 1, rim, "Rim marks\n" + rim.shapes.join(", "));
journey(all, 0, rim, "");
const ordinary = compile(domain.createMirrorCase());
const guard = domain
  .getObservations(ordinary.clues, "entrance", 12)
  .find((c) => c.payload.fragments[0]?.role === "Guard");
journey(ordinary, 1, guard, "");
const name = "In mirror\nSouth mezzanine";
mirror.witnesses[0].id = name;
const tricky = compile(mirror);
const direct = domain
  .getObservations(tricky.clues, name, 12)
  .find((c) => c.payload.fragments[0]?.via === "direct");
journey(
  tricky,
  1,
  direct,
  direct.payload.fragments[0].role + "\n" + name + " 6.0 s",
);
console.log(
  "PASS real sealed case, original slot press/selectClue and source focus: reflected Conservator, all roles on centre/outer, long supplied camera/box and misleading camera name; vacant paper only; check/verdict/finish/reconstruction/cover/remove/dispose and canonical result isolation. Scene/hover ports are doubles.",
);
