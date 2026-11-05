const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  assert = require("assert");
const compiler = process.env.PATH.split(path.delimiter).find((p) => {
  const f = path.resolve(p, "../typescript/package.json");
  return (
    fs.existsSync(f) &&
    JSON.parse(fs.readFileSync(f, "utf8")).version === "5.9.3"
  );
});
assert(
  compiler,
  'Run npx --yes --package typescript@5.9.3 -c "node Tests/AuthorProps/run.cjs"',
);
const ts = require(path.resolve(compiler, "../typescript/lib/typescript.js"));
const base = path.resolve(__dirname, "../../Assets"),
  cache = new Map();
class Component {
  createEvent() {
    return { bind() {} };
  }
  static getTypeName() {
    return this.name;
  }
}
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
  vm.runInNewContext(
    output,
    {
      module: m,
      exports: m.exports,
      BaseScriptComponent: Component,
      component: (c) => c,
      getDeltaTime: () => 0.5,
      require: (p) =>
        load(
          p.startsWith("@app/")
            ? path.join(base, p.slice(5) + ".ts")
            : path.resolve(path.dirname(file), p + ".ts"),
        ),
    },
    { filename: file },
  );
  return m.exports;
}
const { AuthorSession } = load(path.join(base, "Author/AuthorSession.ts"));
const { AuthorController } = load(
  path.join(base, "Author/AuthorController.ts"),
);
const { AuthorPropsController } = load(
  path.join(base, "Author/AuthorPropsController.ts"),
);
const { SessionShelf } = load(path.join(base, "Shelf/SessionShelf.ts"));
const { compileCase } = load(path.join(base, "Domain/compile.ts"));
const json = (x) => JSON.parse(JSON.stringify(x));
const shelf = new SessionShelf(),
  savedOriginal = JSON.stringify(
    shelf.publicCase({ id: "missing-ruby", rev: 1 }),
  );
function harness(start = "detective") {
  let mode = start,
    token = 0,
    session,
    controller = new AuthorController(),
    flowCalls = [];
  const install = (d) => {
    session = new AuthorSession(d);
    controller.mount(session, { render() {}, clear() {} });
    mode = "author";
    token++;
  };
  const props = new AuthorPropsController({
    mode: () => mode,
    scope: () => String(token),
    read: () => session?.snapshot(),
    changed() {},
    author: (c) => controller.dispatch(c),
    flow: (type, confirmed) => {
      flowCalls.push(type);
      if (type === "finishAttempt" && confirmed) {
        mode = "ready";
        token++;
      } else if (type === "emptyRoom" && ["ready", "finished"].includes(mode))
        install(shelf.emptyRoom());
      else if (type === "keepThisRoom" && mode === "finished")
        install(shelf.keepRoom({ id: "missing-ruby", rev: 1 }));
    },
  });
  return {
    props,
    get session() {
      return session;
    },
    get mode() {
      return mode;
    },
    flowCalls,
    send: (c) => controller.dispatch(c),
    frame: () => {
      session.advanceTime(0.5);
      session.advanceProof(4);
    },
    cancelForView: () => {
      props.cancel();
      token++;
    },
  };
}
function readyEmpty(order = "display") {
  const h = harness();
  assert(h.props.startEmpty());
  assert.strictEqual(h.mode, "author");
  assert(!h.props.startEmpty());
  assert.deepStrictEqual(h.flowCalls, ["finishAttempt", "emptyRoom"]);
  const placeDisplay = () => {
    assert(h.props.chooseExhibit());
    assert(h.props.place({ x: 3.5, y: 1, z: 2.5 }));
  };
  const placeCamera = () => {
    assert(h.props.chooseNewCamera());
    assert(h.props.place({ x: 1, y: 0, z: 1 }));
  };
  if (order === "display") {
    placeDisplay();
    assert(h.session.snapshot().errors.some((e) => e.code === "WITNESSES"));
    assert.strictEqual(h.send({ kind: "startTest" }), false);
    placeCamera();
  } else {
    placeCamera();
    assert(h.session.snapshot().errors.some((e) => e.code === "PLACE"));
    placeDisplay();
  }
  assert(h.props.chooseNewScreen());
  assert(h.props.place({ x: 5, y: 0, z: 4 }));
  return h;
}
const results = [];
function test(name, fn) {
  fn();
  results.push(name);
  console.log("PASS " + name);
}
test("empty file normal exit; independent display/camera/screen placement in either order", () => {
  for (const order of ["display", "camera"]) {
    const h = readyEmpty(order),
      d = h.session.getDraft();
    assert.strictEqual(d.witnesses.length, 1);
    assert.strictEqual(d.room.walls.length, 1);
    assert.strictEqual(d.events.length, 0);
    assert.strictEqual(h.session.snapshot().canSeal, false);
    assert.deepStrictEqual(json(d.room.exhibit.position), {
      x: 3.5,
      y: 1,
      z: 2.5,
    });
    assert.strictEqual(h.props.isPlacing(), false);
  }
});
test("tray figure placement and real record commands create a valid new theft without changing other tracks", () => {
  const h = readyEmpty(),
    before = h.session.getDraft();
  assert(h.props.chooseActor("A"));
  assert(h.props.place({ x: 3.2, y: 0, z: 2.5 }));
  assert.strictEqual(h.session.snapshot().selected, "A");
  assert(h.send({ kind: "beginRecording", track: "A" }));
  assert(h.send({ kind: "recordPoint", point: { x: 3, z: 2.5, yaw: 0 } }));
  h.frame();
  assert(h.send({ kind: "recordPoint", point: { x: 3.2, z: 2.5, yaw: 0 } }));
  for (let n = 0; n < 11; n++) h.frame();
  assert.strictEqual(h.session.snapshot().tick, 12);
  assert(h.send({ kind: "commitGesture" }));
  for (const id of ["B", "C"])
    assert.deepStrictEqual(
      json(h.session.getDraft().tracks.find((t) => t.id === id)),
      json(before.tracks.find((t) => t.id === id)),
    );
  assert(
    h.send({ kind: "edit", edit: { kind: "stageTake", track: "A", tick: 12 } }),
  );
  const compiled = compileCase(h.session.getDraft());
  assert.strictEqual(compiled.ok, true);
  assert(
    compiled.sealed.clues.clues.some(
      (c) =>
        c.kind === "Frame" &&
        c.payload.fragments.some((f) => f.role === "Courier"),
    ),
  );
  assert(h.send({ kind: "startTest" }));
  for (let n = 0; n < 5000 && h.session.snapshot().testing; n++) h.frame();
  assert.strictEqual(h.session.snapshot().testing, false);
  assert.deepStrictEqual(json(h.session.snapshot().verdict.possibleCulprits), [
    "Courier",
  ]);
  assert(h.session.snapshot().canSeal);
  assert.strictEqual(h.session.seal().ok, true);
});
test("lost/outside prop drag and view scope change restore committed geometry, no extra revision", () => {
  const h = readyEmpty(),
    before = json(h.session.getDraft());
  assert(h.props.beginMove({ kind: "exhibit" }));
  assert(h.props.preview({ x: 4, y: 1, z: 3 }));
  assert(h.session.snapshot().preview);
  h.props.cancel();
  assert.deepStrictEqual(json(h.session.getDraft()), before);
  assert(!h.session.snapshot().preview);
  assert(h.props.beginMove({ kind: "exhibit" }));
  assert.strictEqual(h.props.preview({ x: 99, y: 1, z: 3 }), false);
  assert.strictEqual(h.props.finishMove(), false);
  assert.deepStrictEqual(json(h.session.getDraft()), before);
  assert(h.props.beginMove({ kind: "exhibit" }));
  assert(h.props.preview({ x: 4, y: 1, z: 3 }));
  h.cancelForView();
  assert.strictEqual(h.props.finishMove(), false);
  assert.deepStrictEqual(json(h.session.getDraft()), before);
});
test("invalid values stay rejected, structurally incomplete room never seals", () => {
  const h = harness();
  h.props.startEmpty();
  const rev = h.session.getDraft().rev;
  assert.strictEqual(
    h.send({
      kind: "edit",
      edit: {
        kind: "movePlace",
        id: "plinth",
        position: { x: -2, y: 1, z: -2 },
      },
    }),
    false,
  );
  assert.strictEqual(h.session.getDraft().rev, rev);
  assert.strictEqual(
    h.send({
      kind: "edit",
      edit: {
        kind: "setWitness",
        witness: {
          id: "bad",
          position: { x: 1, y: 1.6, z: 1 },
          yaw: NaN,
          fov: 1,
        },
      },
    }),
    false,
  );
  assert.strictEqual(
    h.send({
      kind: "edit",
      edit: {
        kind: "setWall",
        wall: {
          id: "bad",
          a: { x: 1, y: 0, z: 1 },
          b: { x: 1, y: 0, z: 1 },
          bottom: 0,
          top: 2,
        },
      },
    }),
    false,
  );
  assert.strictEqual(h.send({ kind: "startTest" }), false);
  assert.strictEqual(h.session.seal().ok, false);
  const ready = readyEmpty();
  assert.strictEqual(
    ready.send({
      kind: "edit",
      edit: { kind: "stageTake", track: "C", tick: 12 },
    }),
    false,
  );
  assert.strictEqual(ready.session.getDraft().events.length, 0);
});
test("keep room preserves actual geometry and clears performances, then accepts a new valid theft", () => {
  const h = harness("finished");
  assert(h.props.keepRoom());
  const before = h.session.getDraft();
  assert.strictEqual(before.events.length, 0);
  assert.strictEqual(
    before.witnesses.length,
    shelf.publicCase({ id: "missing-ruby", rev: 1 }).board.witnesses.length,
  );
  const p = before.room.exhibit.position;
  assert(h.props.chooseActor("B"));
  assert(h.props.place({ x: p.x, y: 1, z: p.z - 0.2 }));
  assert(
    h.send({ kind: "edit", edit: { kind: "stageTake", track: "B", tick: 12 } }),
  );
  assert.strictEqual(compileCase(h.session.getDraft()).ok, true);
  assert.deepStrictEqual(json(h.session.getDraft().room), json(before.room));
  assert.strictEqual(
    JSON.stringify(shelf.publicCase({ id: "missing-ruby", rev: 1 })),
    savedOriginal,
  );
});
test("a draft geometry conflict stays editable but never passes compilation/sealing", () => {
  const h = readyEmpty();
  assert(h.props.chooseActor("A"));
  assert(h.props.place({ x: 2, y: 1, z: 2 }));
  assert(h.props.chooseNewScreen());
  assert(h.props.place({ x: 2, y: 0, z: 2 }));
  assert(h.session.snapshot().errors.some((e) => e.code === "PATH_BLOCKED"));
  assert.strictEqual(h.send({ kind: "startTest" }), false);
  assert.strictEqual(h.session.seal().ok, false);
  const wall = h.session.getDraft().room.walls[1];
  assert(h.props.choose({ kind: "screen", id: wall.id }));
  assert(h.props.place({ x: 5, y: 0, z: 3 }));
  assert(!h.session.snapshot().errors.some((e) => e.code === "PATH_BLOCKED"));
});
test("question tabs use real setQuestions, preserve performance and recover incomplete choices", () => {
  const h = readyEmpty();
  assert(h.props.chooseActor("A"));
  const p = h.session.getDraft().room.exhibit.position;
  assert(h.props.place({ x: p.x, y: 1, z: p.z - 0.2 }));
  assert(
    h.send({ kind: "edit", edit: { kind: "stageTake", track: "A", tick: 12 } }),
  );
  const events = JSON.stringify(h.session.getDraft().events);
  assert(h.props.setQuestionMode(true));
  assert.strictEqual(h.session.getDraft().chain, true);
  assert.strictEqual(compileCase(h.session.getDraft()).ok, true);
  assert(h.props.toggleQuestion("recipient"));
  assert(h.props.toggleQuestion("cache"));
  assert.deepStrictEqual(json(h.session.getDraft().fields), [
    "taker",
    "recipient",
    "cache",
  ]);
  assert(h.props.setQuestionMode(false));
  assert.strictEqual(JSON.stringify(h.session.getDraft().events), events);
  for (const field of ["taker", "recipient", "cache"])
    assert(h.props.toggleQuestion(field));
  assert(h.session.snapshot().errors.some((e) => e.code === "FIELDS"));
  assert.strictEqual(h.session.seal().ok, false);
  assert(h.props.questionSummary().includes("choose at least one"));
  assert(h.props.toggleQuestion("taker"));
  assert.strictEqual(compileCase(h.session.getDraft()).ok, true);
  assert.strictEqual(h.session.getDraft().chain, false);
  for (const field of ["takeTick", "passTick", "stashTick"])
    assert(h.props.toggleQuestion(field));
  assert.deepStrictEqual(json(h.session.getDraft().fields), [
    "taker",
    "takeTick",
    "passTick",
    "stashTick",
  ]);
  assert.strictEqual(JSON.stringify(h.session.getDraft().events), events);
});
console.log(
  `Validated ${results.length} source interaction routes against real staged AuthorSession and current compiler; native SIK/pixels remain unverified.`,
);
