const assert = require("node:assert/strict"),
  fs = require("node:fs");
/** Portable normal-author callbacks; scene/input adapters come from the existing AuthorView runner. */
module.exports = function authorPoseContinuity({
  PlayTable,
  SessionShelf,
  AuthorSession,
  createMuseumTheft,
  sampleTrackMotion,
  Obj,
  V,
  ts,
}) {
  const clock = [],
    module = { exports: {} };
  class ControllerBase {
    createEvent(name) {
      return {
        bind(fn) {
          if (name === "UpdateEvent") clock.push(fn);
        },
      };
    }
  }
  new Function(
    "exports",
    "module",
    "component",
    "BaseScriptComponent",
    "getDeltaTime",
    ts.transpileModule(
      fs.readFileSync("Assets/Author/AuthorController.ts", "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2021,
          module: ts.ModuleKind.CommonJS,
          experimentalDecorators: true,
        },
      },
    ).outputText,
  )(
    module.exports,
    module,
    (c) => c,
    ControllerBase,
    () => 0.25,
  );
  const { AuthorController } = module.exports,
    plain = (x) => JSON.parse(JSON.stringify(x));
  const angle = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  function create(draft, tick) {
    const session = new AuthorSession(draft, { tick, selected: null }),
      controller = new AuthorController(),
      index = clock.length;
    controller.onAwake();
    let table;
    const state = {
      flow: { mode: "author", inputEpoch: 42, shelf: [] },
      author: session.snapshot(),
    };
    controller.mount(session, {
      render(s) {
        state.author = s;
        table?.render(state);
      },
      clear() {},
    });
    const parent = new Obj("AuthorPoseContinuity");
    parent.transform.position = new V(350, 0, 250);
    table = new PlayTable(parent, {
      propMaterial: {},
      dispatch(action, payload) {
        assert.equal(action, "author");
        return controller.dispatch(payload);
      },
    });
    table.render(state);
    const target = (id) => {
      const a = table.actions.get(id);
      assert(a?.object.enabled, "Missing/disabled " + id);
      return a;
    };
    const tap = (id) => {
      const a = target(id);
      a.input.onTriggerStart.emit();
      a.input.onTriggerEnd.emit();
    };
    const drag = (id, delta, cancel = false) => {
      const a = target("ActorBase" + id);
      a.input.onDragStart.emit();
      a.input.onDragUpdate.emit({ dragVector: new V(...delta) });
      (cancel ? a.input.onTriggerCanceled : a.input.onDragEnd).emit();
    };
    const route = (id) =>
      session.snapshot().draft.tracks.find((t) => t.id === id);
    return {
      session,
      controller,
      table,
      target,
      tap,
      drag,
      route,
      update: () => clock[index](),
      dispose() {
        controller.detach();
        table.dispose();
        session.dispose();
      },
    };
  }
  {
    const draft = new SessionShelf().emptyRoom();
    assert.deepEqual(
      draft.tracks.map((track) => track.id),
      ["A", "B", "C"],
    );
    const h = create(draft, 0);
    for (const track of draft.tracks) {
      assert(h.table.pathPose(track.id));
      assert.equal(
        h.table.actions.get("ActorBase" + track.id).object.enabled,
        false,
      );
    }
    h.controller.dispatch({
      kind: "edit",
      edit: {
        kind: "setPathKey",
        track: "A",
        key: { tick: 0, x: 2, z: 2, yaw: 0 },
      },
    });
    assert.equal(h.target("ActorBaseA").object.enabled, true);
    assert.equal(h.table.actions.get("ActorBaseB").object.enabled, false);
    h.drag("A", [5, 0, 0]);
    assert.deepEqual(
      h.session.snapshot().draft.tracks.map((track) => track.id),
      ["A", "B", "C"],
    );
    h.dispose();
  }
  {
    const h = create(createMuseumTheft(), 12),
      stale = h.target("ActorBaseA");
    const before = plain(h.session.snapshot());
    h.table.render({
      ...h.table.state,
      flow: { ...h.table.state.flow, inputEpoch: 43 },
      author: { ...h.table.state.author, selected: "A" },
    });
    stale.input.onDragStart.emit();
    stale.input.onDragUpdate.emit({ dragVector: new V(25, 0, 0) });
    stale.input.onDragEnd.emit();
    assert.deepEqual(
      plain(h.session.snapshot()),
      before,
      "old version's handle cannot edit or select",
    );
    assert.equal(h.table.dragging, false);
    // A deferred old handle also fails closed if its track is absent from the new snapshot.
    h.table.render({
      ...h.table.state,
      author: {
        ...h.table.state.author,
        draft: { ...h.table.state.author.draft, tracks: [] },
      },
    });
    stale.input.onDragStart.emit();
    assert.deepEqual(
      plain(h.session.snapshot()),
      before,
      "missing stale track is a no-op at input",
    );
    assert.equal(h.table.dragging, false);
    h.dispose();
  }
  const standing = createMuseumTheft();
  standing.tracks.find((t) => t.id === "B").keys = [
    { tick: 0, x: 2.3, y: 1, z: 4, yaw: (170 * Math.PI) / 180 },
    { tick: 24, x: 2.3, y: 1, z: 4, yaw: (-170 * Math.PI) / 180 },
  ];
  {
    const h = create(standing, 12),
      before = sampleTrackMotion(h.route("B"), 12);
    h.tap("ActorBaseB");
    h.drag("B", [0, 8, 0]);
    const after = sampleTrackMotion(h.route("B"), 12);
    assert(
      Math.abs(angle(before.yaw, after.yaw)) < 1e-9,
      "vertical hand drag cannot turn standing actor 180 degrees",
    );
    assert.equal(after.x, before.x);
    assert.equal(after.y, 1);
    assert.equal(after.z, before.z);
    assert.equal(h.session.snapshot().preview, false);
    assert(h.controller.dispatch({ kind: "undo" }));
    const original = plain(h.route("B"));
    h.drag("B", [0, 8, 0], true);
    assert.deepEqual(plain(h.route("B")), original);
    h.dispose();
  }
  {
    const draft = createMuseumTheft(),
      h = create(draft, 14),
      before = sampleTrackMotion(
        draft.tracks.find((t) => t.id === "B"),
        15,
      );
    assert.equal(h.route("B").keys.find((k) => k.tick === 14).backward, true);
    h.drag("B", [0, 8, 0]);
    assert.equal(
      h.route("B").keys.find((k) => k.tick === 14).backward,
      true,
      "real drag/release preserves shipped backward=true",
    );
    h.tap("WorkshopClockNext");
    assert.equal(h.session.snapshot().tick, 15);
    assert(
      Math.abs(angle(before.yaw, sampleTrackMotion(h.route("B"), 15).yaw)) <
        1e-9,
      "next frame keeps backward facing",
    );
    h.dispose();
  }
  {
    const h = create(createMuseumTheft(), 6),
      others = plain(h.session.getDraft().tracks.filter((t) => t.id !== "A"));
    h.drag("A", [5, 0, 0]);
    const key = h.route("A").keys.find((k) => k.tick === 6);
    assert.equal(key.backward, undefined);
    assert(Math.abs(key.x - 2.3) < 1e-9, "ordinary forward edit still moves X");
    assert.deepEqual(
      plain(h.session.getDraft().tracks.filter((t) => t.id !== "A")),
      others,
    );
    h.dispose();
  }
  // Construction-only boundary reads: valid sealed paths normally already have keys0/24.
  for (const tick of [0, 24]) {
    const draft = createMuseumTheft();
    draft.tracks[0].keys = [
      { tick: 4, x: 1.8, y: 1, z: 0.9, yaw: 0.7, backward: true },
      { tick: 20, x: 2.2, y: 1, z: 1.2, yaw: 0.9 },
    ];
    const h = create(draft, tick),
      p = h.table.pathPose("A"),
      shown = sampleTrackMotion(h.route("A"), tick);
    assert.equal(p.x, shown.x);
    assert.equal(p.z, shown.z);
    assert(Math.abs(angle(p.yaw, shown.yaw)) < 1e-9);
    h.dispose();
  }
  {
    const h = create(createMuseumTheft(), 12);
    h.tap("ActorBaseA");
    const id = h.session.snapshot().draft.witnesses[0].id;
    h.tap("Record" + id);
    assert.equal(
      h.session.snapshot().tick,
      0,
      "fresh Record retains tick-zero contract",
    );
    const a = h.target("ActorBaseA");
    a.input.onDragStart.emit();
    a.input.onDragUpdate.emit({ dragVector: new V(5, 0, 0) });
    for (let tick = 1; tick <= 3; tick++) {
      h.update();
      h.update();
      a.input.onDragUpdate.emit({ dragVector: new V(2, 0, 0) });
    }
    a.input.onDragEnd.emit();
    assert.equal(h.session.snapshot().tick, 3);
    assert.equal(h.session.snapshot().recordingTrack, null);
    assert.equal(h.session.snapshot().preview, false);
    const keys = h.route("A").keys;
    for (const tick of [0, 1, 2, 3]) assert(keys.some((k) => k.tick === tick));
    assert(keys.find((k) => k.tick === 3).x > keys.find((k) => k.tick === 1).x);
    assert(keys.every((k) => k.y === 1));
    assert(
      keys.filter((k) => k.tick <= 3).every((k) => k.backward === undefined),
      "fresh x/z/yaw recording contract unchanged",
    );
    h.dispose();
  }
  console.log(
    "PASS actual author callbacks: standing yaw unwrap, backward intent, forward edit, endpoint clamp, cancel/Undo, fresh recording clock, actual empty/partial room and stale version input",
  );
};
