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
function harness(start = "detective", initialDraft) {
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
  if (initialDraft) install(initialDraft);
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
  // The three physical tray pockets must each be placed before testing.
  for (const [id,x] of [["A",0.6],["B",1.3],["C",2]]) {
    assert(h.props.chooseActor(id));
    assert(h.props.place({x,y:1,z:0.6}));
  }
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
  for (const [id,x] of [["A",0.6],["C",2]]) {
    assert(h.props.chooseActor(id));
    assert(h.props.place({x,y:1,z:0.6}));
  }
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
test("empty and kept rooms retain tray membership through cancel, Undo, repeat placement and draft reopen", () => {
  const { placedDraftTracks } = load(path.join(base, "Domain/types.ts"));
  for (const mode of ["detective", "finished"]) {
    const h = harness(mode);
    assert(mode === "finished" ? h.props.keepRoom() : h.props.startEmpty());
    assert.deepStrictEqual(json(h.session.getDraft().unplacedTracks), ["A", "B", "C"]);
    assert.strictEqual(placedDraftTracks(h.session.getDraft()).length, 0);
    assert(h.props.chooseActor("B"));
    h.props.cancel();
    assert.strictEqual(placedDraftTracks(h.session.getDraft()).length, 0);
    assert(h.props.beginMove({kind:"actor",track:"B",wholeStationaryTrack:true}));
    assert(h.props.preview({x:2,y:1,z:2}));
    h.props.cancel();
    assert.strictEqual(placedDraftTracks(h.session.getDraft()).length, 0);
    assert(h.props.chooseActor("B"));
    assert(h.props.place({x:2,y:1,z:2}));
    assert.deepStrictEqual(json(placedDraftTracks(h.session.getDraft()).map(t=>t.id)), ["B"]);
    assert(h.send({kind:"undo"}));
    assert.strictEqual(placedDraftTracks(h.session.getDraft()).length, 0);
    assert(h.props.chooseActor("B"));
    assert(h.props.place({x:2,y:1,z:2}));
    shelf.saveDraft(h.session.getDraft(),h.session.checkpoint());
    const saved=shelf.draft(h.session.getDraft().id);
    const restored=new AuthorSession(saved.draft,saved.checkpoint);
    assert.deepStrictEqual(json(restored.getDraft().unplacedTracks), ["A", "C"]);
    assert.strictEqual(restored.startTest(), false);
    assert.strictEqual(restored.seal().ok, false);
    assert(restored.snapshot().errors.some(e=>e.code === "ACTOR_UNPLACED"));
  }
});
test("Watch names the missing tray figure and never invents its recording; normal placement repairs the case", () => {
  const { AuthorViewSession } = load(path.join(base, "Author/AuthorViewSession.ts"));
  const h=harness("finished");assert(h.props.keepRoom());
  const p=h.session.getDraft().room.exhibit.position;
  assert(h.props.chooseActor("A"));assert(h.props.place({x:p.x,y:1,z:p.z-0.2}));
  assert(h.send({kind:"edit",edit:{kind:"stageTake",track:"A",tick:12}}));
  assert.strictEqual(compileCase(h.session.getDraft()).ok,false);
  let shown;
  const view=new AuthorViewSession(h.session,{isAuthorRole:()=>true,activate(){},cancelInput(){},present:s=>shown=s,clear(){}});
  assert(view.dispatch({type:"watchView",source:h.session.getDraft().witnesses[0].id}));
  assert(shown.message.includes("from the tray"));
  assert.strictEqual(shown.recording.board,undefined);
  assert.strictEqual(shown.recording.frame,undefined);
  assert(view.dispatch({type:"backToStage"}));
  for(const [id,x] of [["B",1.3],["C",2]]){assert(h.props.chooseActor(id));assert(h.props.place({x,y:1,z:0.6}));}
  assert.strictEqual(compileCase(h.session.getDraft()).ok,true);
  view.dispose();
});
console.log(
  `Validated ${results.length} source interaction routes against real staged AuthorSession and current compiler; native SIK/pixels remain unverified.`,
);

// Actual empty-room membership and honest incomplete-recording regression.
const strictAssert = require("node:assert/strict");
const T = load(path.join(base, "Domain/types.ts"));
const { AuthorViewSession } = load(
  path.join(base, "Author/AuthorViewSession.ts"),
);
const ref = { id: "missing-ruby", rev: 1 };
const original = JSON.stringify(shelf.publicCase(ref));
function assertPending(draft, ids) {
  strictAssert.deepEqual(json(draft.unplacedTracks), ids);
  strictAssert.deepEqual(
    json(T.placedDraftTracks(draft).map((t) => t.id)),
    ["A", "B", "C"].filter((id) => !ids.includes(id)),
  );
}
function place(h, id, x, z) {
  assert(h.props.chooseActor(id));
  assert(h.props.place({ x, y: 1, z }));
}
function loadNativeClass(file, name) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(base, file), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (p) =>
        p === "../Domain/types"
          ? T
          : p === "../Domain/geometry"
            ? load(path.join(base, "Domain/geometry.ts"))
            : {},
      BaseScriptComponent: Component,
      quat: { fromEulerAngles: (...v) => v },
      vec3: class {
        constructor(x, y, z) {
          Object.assign(this, { x, y, z });
        }
      },
    },
    { filename: file },
  );
  return module.exports[name];
}
const MuseumScene = loadNativeClass("Runtime/MuseumScene.ts", "MuseumScene");
const PlayTable = loadNativeClass("Runtime/PlayTable.ts", "PlayTable");
const AuthorPropsHandles = loadNativeClass(
  "Author/AuthorPropsHandles.ts",
  "AuthorPropsHandles",
);
function assertRenderedMembership(draft, ids) {
  const board = MuseumScene.prototype.draftBoard.call({}, draft);
  strictAssert.deepEqual(json(board.tracks.map((t) => t.id)), ids);
  // Calls the real authored renderer with three instrumented role objects.
  const rendered = [],
    fake = {
      actors: new Map(T.ROLES.map((role) => [role, { role }])),
      point(actor) {
        rendered.push(actor.role);
      },
      tx() {
        return { setLocalRotation() {} };
      },
      rig() {
        return {
          sample() {
            return { bodyYaw: 0 };
          },
        };
      },
      arms: new Map(),
      ruby: undefined,
    };
  MuseumScene.prototype.drawStagingPose.call(fake, board, draft.casting, 0);
  strictAssert.deepEqual(
    rendered,
    ids.map((id) => draft.casting[id]),
  );
  const bindings = new Map(),
    state = { author: new AuthorSession(draft).snapshot() };
  const target = {
    state,
    bindObject(id, p, size, label, invoke, active = () => true) {
      const input = { onDragStart: { add() {} }, onDragUpdate: { add() {} } };
      bindings.set(id, { active, label });
      return { input };
    },
    finishDrag() {},
    selectedTrack: () => state.author.selected,
  };
  PlayTable.prototype.bindActor.call(target, "A");
  strictAssert.equal(bindings.get("ActorBaseA").active(), ids.includes("A"));
  strictAssert.equal(bindings.get("ActorCastingA").active(), ids.includes("A"));
  // Real sync determines which existing tray miniature remains visible.
  const tray = {
    scope: "s",
    ports: {
      scope: () => "s",
      mode: () => "author",
      read: () => state.author,
      toWorld: (p) => p,
    },
    controller: { sync() {}, isPlacing: () => false },
    tray: {},
    questionSheet: {},
    marker: {},
    icons: new Map([["KeepRoomVisual", { model: {} }]]),
    floor: {
      shape: {},
      object: {
        getTransform() {
          return { setWorldPosition() {} };
        },
      },
    },
    positions: new Map(),
    icon(id, name) {
      if (!this.icons.has(id))
        this.icons.set(id, { template: name, model: { enabled: true } });
    },
  };
  AuthorPropsHandles.prototype.sync.call(tray);
  for (const id of ["A", "B", "C"])
    strictAssert.equal(
      tray.icons.get("PropFigure" + id).model.enabled,
      !ids.includes(id),
    );
}
for (const kind of ["empty", "keep"]) {
  const draft = kind === "empty" ? shelf.emptyRoom() : shelf.keepRoom(ref);
  assertPending(draft, ["A", "B", "C"]);
  strictAssert.equal(draft.events.length, 0);
  assertRenderedMembership(draft, []);
  const h = harness("author", draft),
    before = JSON.stringify(h.session.getDraft());
  assert(h.props.chooseActor("B"));
  strictAssert.equal(JSON.stringify(h.session.getDraft()), before);
  h.props.cancel();
  strictAssert.equal(JSON.stringify(h.session.getDraft()), before);
  assert(
    h.props.beginMove({
      kind: "actor",
      track: "B",
      wholeStationaryTrack: true,
    }),
  );
  assert(h.props.preview({ x: 2, y: 1, z: 2 }));
  strictAssert.equal(T.placedDraftTracks(h.session.snapshot().draft).length, 1);
  h.props.cancel();
  assertPending(h.session.getDraft(), ["A", "B", "C"]);
  assert(
    h.props.beginMove({
      kind: "actor",
      track: "B",
      wholeStationaryTrack: true,
    }),
  );
  strictAssert.equal(h.props.preview({ x: 99, y: 1, z: 99 }), false);
  strictAssert.equal(h.props.finishMove(), false);
  assertPending(h.session.getDraft(), ["A", "B", "C"]);
  place(h, "B", 2, 2);
  assertPending(h.session.getDraft(), ["A", "C"]);
  assertRenderedMembership(h.session.getDraft(), ["B"]);
  assert(h.send({ kind: "undo" }));
  assertPending(h.session.getDraft(), ["A", "B", "C"]);
  place(h, "B", 2, 2);
  assertPending(h.session.getDraft(), ["A", "C"]);
  shelf.saveDraft(h.session.getDraft(), h.session.checkpoint());
  const reopened = shelf.draft(draft.id);
  assertPending(reopened.draft, ["A", "C"]);
  const resumed = new AuthorSession(reopened.draft, reopened.checkpoint);
  assertPending(resumed.getDraft(), ["A", "C"]);
  strictAssert.equal(resumed.startTest(), false);
  strictAssert.equal(resumed.seal().ok, false);
  assert(
    resumed
      .snapshot()
      .errors.some((e) => e.code === "ACTOR_UNPLACED" && e.object === "A"),
  );
  strictAssert.equal(
    h.send({ kind: "edit", edit: { kind: "stageTake", track: "A", tick: 12 } }),
    false,
  );
  const revision = h.session.getDraft().rev;
  strictAssert.equal(
    h.send({
      kind: "edit",
      edit: {
        kind: "setPathKey",
        track: "A",
        key: { tick: 99, x: 1, z: 1, yaw: 0 },
      },
    }),
    false,
  );
  strictAssert.equal(h.session.getDraft().rev, revision);
  assertPending(h.session.getDraft(), ["A", "C"]);
  const hostile = json(h.session.getDraft());
  hostile.unplacedTracks = ["Q"];
  strictAssert.equal(compileCase(hostile).ok, false);
  assert(compileCase(hostile).errors.some((e) => e.code === "ACTOR_PLACEMENT"));
  console.log(
    "PASS",
    kind,
    "three tray figures, one placement, cancel/outside/undo/re-place, isolated save/reopen and no phantom seal",
  );
}
// A complete new performance becomes sealable only after all three actual pockets are placed.
const h = harness("author", shelf.keepRoom(ref)),
  p = h.session.getDraft().room.exhibit.position;
place(h, "A", p.x, p.z - 0.2);
assert(
  h.send({ kind: "edit", edit: { kind: "stageTake", track: "A", tick: 12 } }),
);
strictAssert.equal(compileCase(h.session.getDraft()).ok, false);
let shown;
const view = new AuthorViewSession(h.session, {
  isAuthorRole: () => true,
  activate() {},
  cancelInput() {},
  present: (s) => (shown = s),
  clear() {},
});
assert(
  view.dispatch({
    type: "watchView",
    source: h.session.getDraft().witnesses[0].id,
  }),
);
assert(shown.message.includes("from the tray"));
assert(!shown.recording.board);
assert(!shown.recording.frame);
assert(shown.recording.errors.some((e) => e.code === "ACTOR_UNPLACED"));
view.dispatch({ type: "backToStage" });
place(h, "B", 1.3, 0.6);
place(h, "C", 2, 0.6);
strictAssert.equal(compileCase(h.session.getDraft()).ok, true);
assert(h.session.startTest());
for (let n = 0; n < 3000 && h.session.snapshot().testing; n++)
  h.session.advanceProof(32);
assert(!h.session.snapshot().testing);
if (h.session.snapshot().needsAmbiguityConfirmation)
  assert(h.session.confirmAmbiguity());
strictAssert.equal(h.session.seal().ok, true);
const sealed = h.session.seal();
assert(!("unplacedTracks" in sealed.sealed.board));
shelf.store(sealed);
strictAssert.equal(JSON.stringify(shelf.publicCase(ref)), original);
for (const existing of shelf
  .list()
  .filter((x) => x.state === "Ready to open")) {
  const copy = shelf.fork(existing);
  strictAssert.equal(compileCase(copy).ok, true);
}
console.log(
  "PASS incomplete Watch explains missing figure with no camera payload, repair yields honest seal, built-in and saved originals remain compatible",
);

require("./recovery.cjs")({assert, harness, AuthorSession, shelf, compileCase, createMuseumTheft: load(path.join(base, "Domain/cases.ts")).createMuseumTheft});
