const assert = require("node:assert/strict");
const D = require(process.env.DOMAIN_BUILD || "./build/index.js");
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("PASS", name);
}
function compile(d) {
  const r = D.compileCase(d);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
}
function solve(r, claim = "Underdetermined", ids = []) {
  return D.prove(r.sealed.board, r.sealed.clues, ids, claim);
}
const copy = (x) => JSON.parse(JSON.stringify(x));
const open = compile(D.createMirrorCase(true)),
  closed = compile(D.createMirrorCase(false));
test("25 logical frames, finite reflection and closed curtain changes 1 to 2", () => {
  assert.equal(
    open.sealed.clues.clues.filter((c) => c.kind === "Frame").length,
    25,
  );
  assert.deepEqual(solve(open).possibleCulprits, ["Conservator"]);
  assert.deepEqual(solve(closed).possibleCulprits, ["Conservator", "Guard"]);
  assert.equal(solve(closed).status, "ambiguous");
});
test("selected evidence differs from all; no hidden-correct-answer shortcut", () => {
  assert.equal(solve(open, "Conservator").status, "needClue");
  assert.equal(
    solve(open, "Conservator", ["frame:entrance:12"]).status,
    "proved",
  );
  const d = D.createMirrorCase();
  d.casting.B = "Guard";
  d.casting.C = "Conservator";
  assert.deepEqual(solve(compile(d)).possibleCulprits, ["Guard"]);
});
test("public tape invariant across complete alternative histories", () => {
  const v = solve(closed);
  for (const h of Object.values(v.examplesByCulprit))
    assert.deepEqual(D.observe(closed.sealed.board, h), closed.sealed.clues);
  assert.equal(v.historyCount, 2);
  assert.equal(Object.values(v.examplesByCulprit).length, 2);
  assert.equal("casting" in closed.sealed.board, false);
  assert.equal("events" in closed.sealed.board, false);
  assert(!JSON.stringify(closed.sealed.clues).includes("Guard"));
});
test("revision immutability and deterministic recompilation", () => {
  const draft = D.createMirrorCase();
  const r = compile(draft),
    saved = JSON.stringify(r.sealed);
  draft.room.mirror.aperture = 0;
  draft.rev++;
  assert.equal(JSON.stringify(r.sealed), saved);
  assert(Object.isFrozen(r.sealed.board.room.mirror));
  assert.deepEqual(compile(D.createMirrorCase()).sealed, r.sealed);
  assert.equal(
    D.prove(r.sealed.board, closed.sealed.clues, [], "Underdetermined").status,
    "conflict",
  );
});
test("turned camera, height, outgoing obstruction and partial marker affect recognition", () => {
  const d = D.createMirrorCase();
  d.witnesses[0].yaw = -Math.PI / 2;
  assert.equal(solve(compile(d)).possibleCulprits.length, 3);
  const high = D.createMirrorCase();
  high.room.mirror.origin.y = 3;
  assert.equal(solve(compile(high)).possibleCulprits.length, 2);
  const partial = D.createMirrorCase();
  partial.tracks[2].markerWidth = 3;
  const f = D.frameAt(compile(partial).sealed.clues, "entrance", 12);
  assert(f.payload.fragments.some((x) => x.via === "mirror" && !x.role));
  const b = open.sealed.board,
    w = b.witnesses[0],
    p = { x: 5.6, y: 1, z: 3.6 };
  assert(D.reflectionPoint(w, p, b.room.mirror, b.room.walls));
  const blocker = {
    id: "block",
    a: { x: 6.5, y: 0, z: 3.1 },
    b: { x: 6.5, y: 0, z: 4 },
    bottom: 0,
    top: 2,
  };
  assert.equal(
    D.reflectionPoint(w, p, b.room.mirror, [...b.room.walls, blocker]),
    undefined,
  );
});
test("invalid authoring returns object-local errors", () => {
  const d = D.createMirrorCase();
  d.tracks[0].keys.pop();
  assert(D.compileCase(d).errors.some((e) => e.object === "A"));
  const p = D.createMirrorCase();
  p.tracks[0].keys = [
    { tick: 0, x: 2, y: 1, z: 3, yaw: 0 },
    { tick: 24, x: 4, y: 1, z: 3, yaw: 0 },
  ];
  assert(D.compileCase(p).errors.some((e) => e.code === "PATH_BLOCKED"));
  const m = D.createMirrorCase();
  m.events.push({ kind: "Take", track: "B", tick: 12 });
  assert(D.compileCase(m).errors.some((e) => e.code === "TAKE_COUNT"));
});
test("complexity limit and cancellation never claim uniqueness", () => {
  assert.equal(
    D.prove(open.sealed.board, open.sealed.clues, [], "Underdetermined", {
      maxHistories: 1,
    }).status,
    "incomplete",
  );
  assert.equal(
    D.prove(open.sealed.board, open.sealed.clues, [], "Underdetermined", {
      cancelled: () => true,
    }).status,
    "incomplete",
  );
  assert.deepEqual(
    D.prove(closed.sealed.board, closed.sealed.clues, [], "Underdetermined", {
      reverse: true,
    }).possibleCulprits,
    solve(closed).possibleCulprits,
  );
});
const packing = compile(D.createPackingCase());
test("ownership chain proves taker/cache, preserves two recipient counterhistories", () => {
  const v = solve(packing, {
    taker: "Conservator",
    recipient: "Underdetermined",
    cache: "brass case",
  });
  assert.equal(v.status, "ambiguous");
  assert.deepEqual(v.fieldValues.taker, ["Conservator"]);
  assert.deepEqual(v.fieldValues.recipient.sort(), ["Courier", "Guard"]);
  assert.deepEqual(v.fieldValues.cache, ["brass case"]);
  assert.equal(v.historyCount, 8);
  for (const h of v.examplesByField.recipient)
    assert.deepEqual(D.observe(packing.sealed.board, h), packing.sealed.clues);
  assert.equal(
    solve(
      packing,
      "Conservator",
      packing.sealed.clues.clues.map((c) => c.id),
    ).status,
    "proved",
  );
});
test("new cache or passage witness changes inference; camera alone does not establish cache", () => {
  const canvas = solve(compile(D.createPackingCase({ canvas: true })));
  assert.deepEqual(canvas.fieldValues.recipient, ["Courier"]);
  const rear = compile(D.createPackingCase({ rearCamera: true }));
  assert.deepEqual(solve(rear).fieldValues.recipient, ["Courier"]);
  const v = solve(
    rear,
    { taker: "Conservator", recipient: "Courier", cache: "brass case" },
    ["frame:entrance:12", "frame:passage:15"],
  );
  assert.equal(v.status, "needClue");
  assert.deepEqual(v.fieldValues.cache.sort(), [
    "None",
    "brass case",
    "canvas trunk",
  ]);
});
test("no pass/no stash are lawful; strict chronology and reachability", () => {
  const d = D.createPackingCase();
  d.events = d.events.filter((e) => e.kind !== "Pass" && e.kind !== "Stash");
  const r = compile(d);
  assert.equal(D.carrierAt(r.sealed.board, r.vault.actualHistory, 24), "A");
  assert.equal(
    D.answer(r.sealed.board, r.vault.actualHistory, "recipient"),
    "None",
  );
  const bad = D.createPackingCase();
  bad.events.find((e) => e.kind === "Stash").tick = 15;
  assert(D.compileCase(bad).errors.some((e) => e.code === "STASH_REACH"));
  const wall = D.createPackingCase();
  wall.events.find((e) => e.kind === "Pass").tick = 13;
  assert(D.compileCase(wall).errors.some((e) => e.code === "PASS_REACH"));
});
test("contradictory observations conflict and absent source remains absent", () => {
  const t = copy(open.sealed.clues);
  t.clues.find((c) => c.kind === "Frame").payload.fragments[0].role = "Guard";
  assert.equal(
    D.prove(open.sealed.board, t, [], "Underdetermined").status,
    "conflict",
  );
  assert.equal(D.frameAt(open.sealed.clues, "missing", 12), undefined);
  assert.equal(D.frameAt(open.sealed.clues, "entrance", 12.5), undefined);
});
test("hidden contacts retain a timeless RimClue; visible contacts add a frame", () => {
  const a = D.createMirrorCase(false);
  a.events.push({ kind: "BrushRim", track: "B", tick: 1 });
  const b = copy(a);
  b.events[1].tick = 23;
  assert.deepEqual(compile(a).sealed.clues, compile(b).sealed.clues);
  const rim = compile(a).sealed.clues.clues.find((c) => c.kind === "Rim");
  assert.equal("tick" in rim, false);
  const visible = D.createPackingCase();
  visible.events.find((e) => e.kind === "BrushRim").tick = 5;
  assert.notDeepEqual(compile(visible).sealed.clues, packing.sealed.clues);
});
test("incremental search cancellation discards any partial verdict", () => {
  let cancel = false;
  const task = D.proveSteps(
    packing.sealed.board,
    packing.sealed.clues,
    [],
    "Underdetermined",
    { cancelled: () => cancel },
  );
  assert.equal(task.next().done, false);
  cancel = true;
  let step = task.next();
  while (!step.done) step = task.next();
  assert.equal(step.value.status, "incomplete");
  assert.equal(step.value.possibleCulprits.length, 0);
});
test("all three suspects remain available under no identifying observations", () => {
  const d = D.createMirrorCase();
  d.witnesses[0].yaw = -Math.PI / 2;
  const r = compile(d),
    v = solve(r);
  assert.deepEqual(v.possibleCulprits, ["Conservator", "Courier", "Guard"]);
  assert.equal(Object.keys(v.examplesByCulprit).length, 3);
  for (const h of Object.values(v.examplesByCulprit))
    assert.deepEqual(D.observe(r.sealed.board, h), r.sealed.clues);
});
test("finite mirror rejects backside, parallel, closed aperture and zero-length rays", () => {
  const b = open.sealed.board,
    m = b.room.mirror,
    w = b.witnesses[0];
  assert.equal(
    D.reflectionPoint(
      { ...w, position: { x: 8, y: 1, z: 3 } },
      { x: 5, y: 1, z: 3 },
      m,
      [],
    ),
    undefined,
  );
  assert.equal(D.reflectionPoint(w, { x: 8, y: 1, z: 3 }, m, []), undefined);
  assert.equal(
    D.reflectionPoint(w, { x: 5, y: 1, z: 3 }, { ...m, aperture: 0 }, []),
    undefined,
  );
  assert.equal(D.inView(w, w.position), false);
});
// Independent exhaustive grammar oracle: enumerate every legal chain and contact
// combination, then filter by the public observer. It does not call prove's search.
function bruteForce(board, tape, ids) {
  const roles = ["Courier", "Guard", "Conservator"],
    matches = [];
  for (const a of roles)
    for (const b of roles)
      for (const c of roles) {
        if (new Set([a, b, c]).size !== 3) continue;
        for (const take of board.windows.take) {
          for (const pass of [
            undefined,
            ...board.windows.pass.filter((p) => p.from === take),
          ]) {
            for (const stash of [
              undefined,
              ...board.windows.stash.filter(
                (s) =>
                  s.carrier === (pass?.to ?? take) &&
                  s.tick > (pass?.tick ?? board.alarmTick),
              ),
            ]) {
              for (const x of [-1, ...board.windows.brush.A])
                for (const y of [-1, ...board.windows.brush.B])
                  for (const z of [-1, ...board.windows.brush.C]) {
                    const h = {
                      casting: { A: a, B: b, C: c },
                      take,
                      brushes: [
                        ["A", x],
                        ["B", y],
                        ["C", z],
                      ]
                        .filter(([, t]) => t >= 0)
                        .map(([track, tick]) => ({ track, tick })),
                      ...(pass ? { pass } : {}),
                      ...(stash ? { stash } : {}),
                    };
                    if (
                      !D.compareObservations(tape, D.observe(board, h), ids)
                        .length
                    )
                      matches.push(h);
                  }
            }
          }
        }
      }
  return matches;
}
test("factored search agrees with full independent enumeration (810 chain histories)", () => {
  const b = packing.sealed.board,
    t = packing.sealed.clues;
  const legal = bruteForce(b, { ...t, clues: [] }, []);
  assert.equal(legal.length, 810);
  for (const ids of [
    t.clues.map((c) => c.id),
    ["frame:entrance:12"],
    ["rim:plinth"],
    ["frame:entrance:12", "box:brass case"],
  ]) {
    const full = bruteForce(b, t, ids),
      fast = D.prove(b, t, ids, { taker: "Conservator" });
    assert.equal(fast.historyCount, full.length);
    for (const field of ["taker", "recipient", "cache"])
      assert.deepEqual(
        fast.fieldValues[field].slice().sort(),
        [...new Set(full.map((h) => D.answer(b, h, field)))].sort(),
      );
  }
});
test("two separate sources are jointly sufficient; neither alone proves the culprit", () => {
  const d = D.createMirrorCase();
  d.room.walls = [];
  delete d.room.mirror;
  const positions = [
    [1, 1],
    [4, 4],
    [6, 1],
  ];
  d.tracks.forEach(
    (t, i) =>
      (t.keys = [0, 24].map((tick) => ({
        tick,
        x: positions[i][0],
        z: positions[i][1],
        yaw: 0,
      }))),
  );
  d.room.exhibit.position = { x: 4, y: 1, z: 4 };
  d.witnesses = [
    { id: "left", position: { x: 1, y: 1, z: 0 }, yaw: 0, fov: 0.3 },
    { id: "right", position: { x: 6, y: 1, z: 0 }, yaw: 0, fov: 0.3 },
  ];
  const r = compile(d),
    ids = ["frame:left:12", "frame:right:12"];
  assert.equal(solve(r, "Conservator", [ids[0]]).status, "needClue");
  assert.equal(solve(r, "Conservator", [ids[1]]).status, "needClue");
  const v = solve(r, "Conservator", ids);
  assert.equal(v.status, "proved");
  assert.equal(v.historyCount, 26);
  assert.deepEqual(v.reasonIds.slice().sort(), ids);
});
test("a compound answer cannot combine incompatible marginal possibilities", () => {
  const rear = compile(D.createPackingCase({ rearCamera: true }));
  const ids = ["frame:entrance:12", "box:canvas trunk"];
  const first = solve(rear, { taker: "Conservator" }, ids);
  // Courier/Guard are both recipients; canvas is absent, brass or None remain.
  assert(first.fieldValues.recipient.includes("Courier"));
  assert(first.fieldValues.recipient.includes("None"));
  const impossible = solve(
    rear,
    { recipient: "None", cache: "brass case" },
    ids,
  );
  assert.equal(impossible.status, "contradicted");
});
test("visibility gaps terminate the observed segment", () => {
  const draft = D.createMirrorCase();
  draft.room.walls = [];
  delete draft.room.mirror;
  draft.tracks[0].keys = [
    { tick: 0, x: 1, z: 1, yaw: 0 },
    { tick: 6, x: 2, z: 1, yaw: 0 },
    { tick: 12, x: 1, z: 1, yaw: 0 },
    { tick: 24, x: 1, z: 1, yaw: 0 },
  ];
  draft.witnesses = [
    { id: "gap-camera", position: { x: 1, y: 1, z: 0 }, yaw: 0, fov: 0.3 },
  ];
  const tape = compile(draft).sealed.clues;
  const before = D.frameAt(tape, "gap-camera", 0).payload.fragments;
  const hidden = D.frameAt(tape, "gap-camera", 6).payload.fragments;
  const after = D.frameAt(tape, "gap-camera", 12).payload.fragments;
  assert.equal(before.length, 1);
  assert.equal(hidden.length, 0);
  assert.equal(after.length, 1);
  assert.notEqual(before[0].segment, after[0].segment);
});
test("a nearby hand or cache across an opaque partition is unreachable", () => {
  const draft = D.createMirrorCase();
  draft.chain = true;
  delete draft.room.mirror;
  draft.room.walls = [
    {
      id: "divider",
      a: { x: 3.1, y: 0, z: 0 },
      b: { x: 3.1, y: 0, z: 5 },
      bottom: 0,
      top: 2,
    },
  ];
  draft.room.exhibit.position = { x: 3, y: 1, z: 2 };
  draft.room.boxes = [{ id: "blocked-box", position: { x: 3.2, y: 1, z: 2 } }];
  const positions = [
    [3, 2],
    [3.2, 2],
    [5, 4],
  ];
  draft.tracks.forEach((track, i) => {
    track.keys = [0, 24].map((tick) => ({
      tick,
      x: positions[i][0],
      z: positions[i][1],
      yaw: 0,
    }));
  });
  draft.events = [{ kind: "Take", track: "A", tick: 12 }];
  const result = compile(draft);
  assert.equal(
    result.sealed.board.windows.pass.some(
      (p) => p.from === "A" && p.to === "B",
    ),
    false,
  );
  assert.equal(
    result.sealed.board.windows.stash.some((s) => s.carrier === "A"),
    false,
  );
  draft.events.push({ kind: "Pass", from: "A", to: "B", tick: 13 });
  assert(
    D.compileCase(draft).errors.some((error) => error.code === "PASS_REACH"),
  );
});
test("moving staging preserves full-tape 1 versus 2 and the signal anchors", () => {
  const movingOpen = compile(D.createMuseumTheft(true));
  const movingClosed = compile(D.createMuseumTheft(false));
  assert.deepEqual(solve(movingOpen).possibleCulprits, ["Conservator"]);
  assert.deepEqual(solve(movingClosed).possibleCulprits, [
    "Conservator",
    "Guard",
  ]);
  for (const h of Object.values(solve(movingClosed).examplesByCulprit)) {
    assert.deepEqual(
      D.observe(movingClosed.sealed.board, h),
      movingClosed.sealed.clues,
    );
  }
  for (const id of ["A", "B", "C"]) {
    const actual = D.poseAt(
      movingOpen.sealed.board.tracks.find((t) => t.id === id),
      12,
    );
    const expected = D.poseAt(
      open.sealed.board.tracks.find((t) => t.id === id),
      12,
    );
    assert.equal(actual.x, expected.x);
    assert.equal(actual.z, expected.z);
    assert.notDeepEqual(
      D.poseAt(
        movingOpen.sealed.board.tracks.find((t) => t.id === id),
        0,
      ),
      actual,
    );
  }
});
const { roleSilhouette } = require("./build-art/RoleSilhouette.js");
const tangentPoint = (p) => {
  const x = Math.tan(p.horizontal);
  return [x, Math.tan(p.vertical) * Math.sqrt(1 + x * x)];
};
function projectedArea(triangles) {
  return triangles.reduce((total, triangle) => {
    const [a, b, c] = triangle.map(tangentPoint);
    return (
      total +
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) /
        2
    );
  }, 0);
}
test("TableKit public heads project into separate direct/reflected locations and clip aperture", () => {
  const board = open.sealed.board;
  const fragments = D.frameAt(open.sealed.clues, "entrance", 12).payload
    .fragments;
  const courier = fragments.find((f) => f.role === "Courier");
  const guard = fragments.find((f) => f.role === "Guard");
  assert.equal(courier.via, "direct");
  assert.equal(guard.via, "mirror");
  assert(Math.abs(courier.projection.horizontal - 0.03224688243525402) < 1e-12);
  assert(Math.abs(guard.projection.horizontal + 0.3378781882402784) < 1e-12);
  const full = D.projectVisibleSurface(
    board,
    "entrance",
    guard,
    roleSilhouette(guard.role),
  );
  const direct = D.projectVisibleSurface(
    board,
    "entrance",
    courier,
    roleSilhouette(courier.role),
  );
  assert(projectedArea(full) > 0);
  assert(projectedArea(direct) > 0);
  assert.deepEqual(
    D.projectVisibleSurface(
      closed.sealed.board,
      "entrance",
      guard,
      roleSilhouette("Guard"),
    ),
    [],
  );
  const partial = copy(board);
  partial.room.mirror.aperture = 0.4;
  const cut = D.projectVisibleSurface(
    partial,
    "entrance",
    guard,
    roleSilhouette("Guard"),
  );
  assert(projectedArea(cut) > 0 && projectedArea(cut) < projectedArea(full));
  // Every interior point in projected triangles must pass the independent ray predicate.
  for (const candidateBoard of [board, partial]) {
    const mesh = D.projectVisibleSurface(
      candidateBoard,
      "entrance",
      guard,
      roleSilhouette("Guard"),
    );
    const w = candidateBoard.witnesses[0],
      m = candidateBoard.room.mirror;
    const reflect = (p) =>
      D.sub(p, D.mul(m.normal, 2 * D.dot(D.sub(p, m.origin), m.normal)));
    const virtualOrigin = reflect(guard.position);
    const virtualRight = D.sub(
      reflect(D.add(guard.position, guard.surfaceRight)),
      virtualOrigin,
    );
    const normal = { x: -virtualRight.z, y: 0, z: virtualRight.x };
    for (const triangle of mesh) {
      const points = triangle.map(tangentPoint);
      for (const weights of [
        [1 / 3, 1 / 3, 1 / 3],
        [0.8, 0.1, 0.1],
        [0.1, 0.8, 0.1],
        [0.1, 0.1, 0.8],
      ]) {
        const x = points.reduce((s, p, i) => s + p[0] * weights[i], 0),
          y = points.reduce((s, p, i) => s + p[1] * weights[i], 0);
        const direction = {
          x: Math.sin(w.yaw) + x * Math.cos(w.yaw),
          y,
          z: Math.cos(w.yaw) - x * Math.sin(w.yaw),
        };
        const t =
          D.dot(D.sub(virtualOrigin, w.position), normal) /
          D.dot(direction, normal);
        const world = reflect(D.add(w.position, D.mul(direction, t)));
        assert(
          D.sight(candidateBoard, w, world, "mirror"),
          "Rendered triangle crosses an opaque region",
        );
      }
    }
  }
});
test("alternative histories have identical public projected geometry", () => {
  const board = closed.sealed.board;
  const meshes = Object.values(solve(closed).examplesByCulprit).map(
    (history) => {
      const tape = D.observe(board, history);
      return tape.clues
        .filter((c) => c.kind === "Frame")
        .map((frame) =>
          frame.payload.fragments.map((fragment) =>
            D.projectVisibleSurface(
              board,
              frame.witness,
              fragment,
              roleSilhouette(fragment.role),
            ),
          ),
        );
    },
  );
  assert.deepEqual(meshes[0], meshes[1]);
});
test("separate public fragment pins obey either-order proof and removal", () => {
  for (const create of [D.createMirrorCase, D.createMuseumTheft]) {
    const result = compile(create(true));
    const observations = D.getObservations(
      result.sealed.clues,
      "entrance",
      12,
    ).filter((view) => view.observation.kind === "fragment");
    assert.equal(observations.length, 2);
    const courier = observations.find(
      (view) => view.payload.fragments[0].role === "Courier",
    );
    const guard = observations.find(
      (view) => view.payload.fragments[0].role === "Guard",
    );
    for (const view of observations) {
      assert.equal(view.payload.fragments.length, 1);
      assert.equal(view.payload.hands.length, 0);
      assert.equal(view.payload.actions.length, 0);
      assert.equal(view.payload.exhibit, undefined);
      assert.equal(
        D.resolveObservation(result.sealed.clues, view.id).id,
        view.id,
      );
      assert.equal(solve(result, "Conservator", [view.id]).status, "needClue");
    }
    assert.deepEqual(
      solve(result, "Conservator", [courier.id]).possibleCulprits,
      ["Conservator", "Guard"],
    );
    assert.deepEqual(
      solve(result, "Conservator", [guard.id]).possibleCulprits,
      ["Conservator", "Courier"],
    );
    assert.equal(
      solve(result, "Conservator", [courier.id, guard.id]).status,
      "proved",
    );
    assert.equal(
      solve(result, "Conservator", [guard.id, courier.id]).status,
      "proved",
    );
    assert.equal(
      solve(result, "Conservator", [guard.id, courier.id, courier.id]).status,
      "proved",
    );
    assert.equal(solve(result, "Conservator", [guard.id]).status, "needClue");
    assert.equal(solve(result, "Conservator", [courier.id]).status, "needClue");
    assert.equal(solve(result, "Conservator", []).status, "needClue");
    assert.deepEqual(
      D.getObservations(compile(create(true)).sealed.clues, "entrance", 12),
      D.getObservations(result.sealed.clues, "entrance", 12),
    );
  }
});
test("fragment selection does not assert other camera fragments were absent", () => {
  const result = compile(D.createMirrorCase());
  const courier = D.getObservations(result.sealed.clues, "entrance", 12).find(
    (view) =>
      view.observation.kind === "fragment" &&
      view.payload.fragments[0].role === "Courier",
  );
  const verdict = solve(result, "Conservator", [courier.id]);
  const wrongForOtherMark = verdict.examplesByCulprit.Guard;
  assert(wrongForOtherMark);
  const hypothetical = D.observe(result.sealed.board, wrongForOtherMark);
  assert.deepEqual(
    D.compareObservations(result.sealed.clues, hypothetical, [courier.id]),
    [],
  );
  assert.deepEqual(
    D.compareObservations(result.sealed.clues, hypothetical, [
      "frame:entrance:12",
    ]),
    ["frame:entrance:12"],
  );
  const viewOnly = D.resolveObservation(hypothetical, courier.id);
  assert.equal(viewOnly.payload.fragments.length, 1);
  assert.equal(viewOnly.payload.fragments[0].role, "Courier");
});
test("observation IDs bind revision/source/tick and never encode hidden identity", () => {
  const result = compile(D.createMirrorCase());
  const view = D.getObservations(result.sealed.clues, "entrance", 12).find(
    (view) => view.observation.kind === "fragment",
  );
  assert.equal(/Courier|Guard|Conservator/.test(view.id), false);
  const changed = D.createMirrorCase();
  changed.rev++;
  assert.equal(
    D.resolveObservation(compile(changed).sealed.clues, view.id),
    undefined,
  );
  assert.equal(
    solve(compile(changed), "Conservator", [view.id]).status,
    "conflict",
  );
  const next = D.getObservations(result.sealed.clues, "entrance", 13).find(
    (view) => view.observation.kind === "fragment",
  );
  assert.notEqual(next.id, view.id);
  assert.deepEqual(
    D.getObservations(closed.sealed.clues, "entrance", 12)
      .filter((view) => view.observation.kind === "fragment")
      .map((view) => view.payload.fragments[0].role),
    ["Courier"],
  );
});
test("swapped identities recompute per-fragment evidence without a named-case shortcut", () => {
  const draft = D.createMuseumTheft();
  draft.casting.B = "Guard";
  draft.casting.C = "Conservator";
  const result = compile(draft),
    ids = D.getObservations(result.sealed.clues, "entrance", 12)
      .filter((view) => view.observation.kind === "fragment")
      .map((view) => view.id);
  assert.equal(solve(result, "Guard", ids).status, "proved");
  assert.equal(solve(result, "Guard", [ids[0]]).status, "needClue");
});
test("independent action and hand subobservations retain chain evidence", () => {
  const result = compile(D.createPackingCase({ rearCamera: true }));
  const views = D.getObservations(result.sealed.clues, "passage", 15);
  const pass = views.find(
    (view) =>
      view.observation.kind === "action" &&
      view.payload.actions[0].kind === "Pass",
  );
  assert(pass);
  assert.equal(pass.payload.fragments.length, 0);
  assert.equal(pass.payload.hands.length, 0);
  const take = D.getObservations(result.sealed.clues, "entrance", 12).find(
    (view) =>
      view.observation.kind === "action" &&
      view.payload.actions[0].kind === "Take",
  );
  const taker = D.getObservations(result.sealed.clues, "entrance", 12).find(
    (view) =>
      view.observation.kind === "fragment" &&
      view.payload.fragments[0].role === "Conservator",
  );
  const recipient = views.find(
    (view) =>
      view.observation.kind === "fragment" &&
      view.payload.fragments[0].role === "Courier",
  );
  const proof = solve(
    result,
    { taker: "Conservator", recipient: "Courier", cache: "brass case" },
    [take.id, taker.id, pass.id, recipient.id, "box:brass case"],
  );
  assert.equal(proof.status, "proved");
  const brush = D.getObservations(packing.sealed.clues, "entrance", 6).find(
    (view) =>
      view.observation.kind === "action" &&
      view.payload.actions[0].kind === "BrushRim",
  );
  assert(brush);
  const matches = bruteForce(packing.sealed.board, packing.sealed.clues, [
    brush.id,
  ]);
  const factored = solve(packing, "Guard", [brush.id]);
  assert.equal(factored.historyCount, matches.length);
});
console.log(`${checks} domain checks passed`);
