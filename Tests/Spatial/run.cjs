const a = require("node:assert/strict");
const S = require("./build/Spatial/index.js");
const D = require("./build/Domain/index.js");
const C = require("./build/Domain/cases.js");
const K = require("./build/Scripts/TableKit/TableKit.js");
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}
function compiled(d) {
  const r = D.compileCase(d);
  a.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
}
const mirror = compiled(C.createMirrorCase(false));
const board = mirror.sealed.board;
const verdict = D.prove(board, mirror.sealed.clues, [], "Underdetermined");
const pair = S.compatiblePair(board, verdict, "taker");
test("real closed curtain solver provides different full takers", () => {
  a.ok(pair);
  a.notEqual(
    D.answer(board, pair[0], "taker"),
    D.answer(board, pair[1], "taker"),
  );
});
test("all ticks retain identical actual public recording", () => {
  for (const h of pair) a.deepEqual(D.observe(board, h), mirror.sealed.clues);
});
test("arbitrary seeking restores ruby and exact pose", () => {
  const before = S.renderHistory(board, pair[0], 11);
  const after = S.renderHistory(board, pair[0], 12);
  a.equal(before.nestEmpty, false);
  a.equal(after.nestEmpty, true);
  a.deepEqual(S.renderHistory(board, pair[0], 11), before);
  a.equal(after.actors.length, 3);
  a.deepEqual(
    after.ruby.positionCm,
    after.hands.find((x) => x.track === pair[0].take).handCm,
  );
});
const packing = compiled(C.createPackingCase());
const pb = packing.sealed.board,
  ph = packing.vault.actualHistory;
test("packing contact uses one shared hand point and reverse restores ownership", () => {
  a.ok(ph.pass);
  const v = S.renderHistory(pb, ph, ph.pass.tick);
  a.deepEqual(
    v.hands.find((x) => x.track === ph.pass.from).handCm,
    v.hands.find((x) => x.track === ph.pass.to).handCm,
  );
  a.deepEqual(
    v.ruby.positionCm,
    v.hands.find((x) => x.track === ph.pass.to).handCm,
  );
  const prior = S.renderHistory(pb, ph, ph.pass.tick - 1);
  a.equal(prior.hands.find((x) => x.track === ph.pass.from).grip, 1);
});
test("cache None and different final boxes use actual history and no invented event time", () => {
  const unstashed = { ...ph, stash: undefined };
  a.equal(S.renderHistory(pb, unstashed, 24).cache, undefined);
  a.equal(S.renderHistory(pb, unstashed, 24).ruby.visible, true);
  a.equal(S.renderHistory(pb, ph, 24).ruby.visible, false);
  a.equal(S.renderHistory(pb, ph, 24).cache, ph.stash.box);
  a.deepEqual(S.comparisonFocus(pb, [ph, unstashed], "cache"), {
    tick: 24,
    inspection: true,
  });
});
let draw = [],
  placements = [],
  labels = [],
  cleared = 0,
  finished = 0;
const kit = () =>
  new K.TableKit({
    clearActors() {},
    drawActor(p) {
      draw.push(p);
    },
    drawObserved() {},
    drawRuby() {},
    drawCurtain() {},
    playAtCurtain() {
      throw Error("unexpected sound");
    },
  });
const context = {
  tick: 12,
  witnessId: board.witnesses[0].id,
  selectedIds: ["chosen-clue"],
  versionIndex: 1,
  verdictKey: "ambiguous",
};
const stage = new S.SpatialStage(
  board,
  context,
  {
    wings: [kit(), kit()],
    recording: kit(),
    setWingPlacement(i, p) {
      placements[i] = p;
    },
    setWingVisible() {},
    setHandTargets() {},
    setNestEmpty() {},
    setCache() {},
    setLabels(l) {
      labels = l;
    },
    setFrameCovered() {},
    setSecondaryLabelsVisible() {},
    setReturnHandle() {},
    finishTimeDrag() {
      finished++;
    },
    stopSound() {},
    clear() {
      cleared++;
    },
  },
  () => ({ kind: "witness", revision: "fixed", fragments: [], aperture: 0 }),
);
test("actual input scale round trip preserves time evidence version and verdict", () => {
  stage.setVersions(pair, "all");
  stage.enterRoom(
    { x: 20, y: 150, z: 50 },
    { x: 0, y: 0, z: 1 },
    () => context,
  );
  a.equal(finished, 1);
  a.equal(placements[1].scale, 1);
  a.deepEqual(stage.backToTable(), context);
  a.equal(placements[0].scale, 0.06);
  a.ok(labels.every((x) => x.includes("Fits the full recording")));
});
test("one explicit clock updates two wings and disposal blocks output", () => {
  stage.play();
  stage.update(0.25);
  a.equal(stage.snapshot().tick, 12.5);
  stage.pause();
  stage.update(0.2);
  a.equal(stage.snapshot().tick, 12.5);
  stage.dispose();
  const n = draw.length;
  stage.update(0.2);
  stage.render();
  a.equal(draw.length, n);
  a.equal(cleared, 1);
});
test("changed own paths, alternative recipient and final cache use new geometry", () => {
  const custom = C.createPackingCase({ recipient: "C" });
  custom.id = "my-packing";
  custom.rev = 9;
  // Move all horizontal geometry and camera positions together. This is a real
  // edited input that must survive compilation and preserve relative reachability.
  const shift = (p) => {
    p.x += 0.1;
  };
  custom.tracks.forEach((t) => t.keys.forEach(shift));
  shift(custom.room.exhibit.position);
  custom.room.walls.forEach((w) => {
    shift(w.a);
    shift(w.b);
  });
  custom.room.boxes.forEach((b) => shift(b.position));
  custom.witnesses.forEach((w) => shift(w.position));
  const r = compiled(custom),
    h = r.vault.actualHistory,
    b = r.sealed.board;
  a.equal(h.pass.to, "C");
  a.equal(h.pass.tick, 17);
  const v = S.renderHistory(b, h, 17);
  a.deepEqual(v.ruby.positionCm, v.hands.find((x) => x.track === "C").handCm);
  for (const id of ["A", "B", "C"]) {
    const track = b.tracks.find((t) => t.id === id),
      pose = D.poseAt(track, 18.5),
      actor = S.renderHistory(b, h, 18.5).actors.find(
        (x) => x.role === h.casting[id],
      );
    a.equal(actor.positionCm[0], pose.x * 100);
    a.equal(actor.positionCm[2], pose.z * 100);
  }
  const canvas = compiled(C.createPackingCase({ canvas: true }));
  a.equal(
    S.renderHistory(canvas.sealed.board, canvas.vault.actualHistory, 24).cache,
    "canvas trunk",
  );
});
test("arm pivots and palm contact match every shipped GLB", () => {
  const fs = require("node:fs"),
    path = require("node:path");
  for (const role of ["Guard", "Courier", "Conservator"]) {
    const binary = fs.readFileSync(
      path.join(__dirname, "../../Assets/Art/TableKit", role + ".glb"),
    );
    const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)));
    for (const [name, key] of [
      ["Shoulder_R", "shoulder"],
      ["Forearm_R", "upper"],
      ["Hand_R", "lower"],
    ]) {
      const node = gltf.nodes.find((n) => n.name === name);
      a.equal(node.rotation, undefined);
      a.equal(node.scale, undefined);
      node.translation.forEach((v, i) =>
        a.ok(Math.abs(v * 100 - S.SHIPPED_RIGHT_ARM[key][i]) < 1e-8),
      );
    }
  }
});
test("native cached rig adapter reaches every actual action and held gem", () => {
  const fixtures = [
    mirror,
    compiled(C.createMuseumTheft(false)),
    packing,
    compiled(C.createPackingCase({ recipient: "C" })),
    compiled(C.createPackingCase({ canvas: true })),
  ];
  let maxResidual = 0,
    maxLean = 0,
    samples = 0,
    transformReads = 0;
  for (const result of fixtures) {
    const b = result.sealed.board,
      histories = [result.vault.actualHistory];
    const alternatives = D.prove(b, result.sealed.clues, [], "Underdetermined");
    const seen = new Set(histories.map((h) => JSON.stringify(h)));
    for (const list of Object.values(alternatives.examplesByField))
      for (const h of list) {
        const key = JSON.stringify(h);
        if (!seen.has(key)) {
          seen.add(key);
          histories.push(h);
        }
      }
    if (b.caseId === board.caseId) histories.push(...pair);
    for (const h of histories)
      for (let tick = 0; tick <= 24; tick += 0.25) {
        const v = S.renderHistory(b, h, tick);
        for (const hand of v.hands) {
          const baseActor = v.actors.find(
            (p) => p.role === h.casting[hand.track],
          );
          const actor = { ...baseActor, yawRad: baseActor.yawRad + Math.PI };
          const transforms = {};
          const node = (name) => ({
            getTransform() {
              transformReads++;
              return (transforms[name] ??= {
                setLocalPosition(p) {
                  this.position = p;
                },
                setLocalRotation(q) {
                  this.rotation = q;
                },
              });
            },
          });
          const rig = new S.LensArmAdapter(
            {
              upperBody: node("body"),
              shoulder: node("shoulder"),
              elbow: node("elbow"),
              wrist: node("wrist"),
            },
            { vector: (...p) => p, quaternion: (...q) => q },
          );
          const reads = transformReads;
          const solved = rig.apply(actor, hand.handCm);
          rig.apply(actor, hand.handCm);
          a.equal(transformReads, reads);
          const fk = S.forwardArm(
            transforms.shoulder.rotation,
            transforms.elbow.rotation,
            transforms.wrist.rotation,
            transforms.body.position.map((x) => x * 100),
          );
          const c = Math.cos(actor.yawRad),
            s = Math.sin(actor.yawRad),
            factor = 100 / 6;
          const world = [
            actor.positionCm[0] + (fk[0] * c + fk[2] * s) * factor,
            actor.positionCm[1] + fk[1] * factor,
            actor.positionCm[2] + (fk[2] * c - fk[0] * s) * factor,
          ];
          const residual = Math.hypot(
            ...world.map((x, i) => x - hand.handCm[i]),
          );
          maxResidual = Math.max(maxResidual, residual);
          maxLean = Math.max(
            maxLean,
            Math.hypot(...solved.upperBodyOffset) * factor,
          );
          samples++;
          if (residual > 0.02)
            throw Error(
              "Unreachable " +
                b.caseId +
                " " +
                tick +
                " " +
                hand.track +
                " residual " +
                residual +
                " story cm",
            );
          if (hand.grip === 1 && v.ruby.visible)
            a.deepEqual(v.ruby.positionCm, hand.handCm);
        }
      }
  }
  console.log(
    "Measured " +
      samples +
      " mounted arm samples; max residual " +
      maxResidual.toFixed(6) +
      " story cm; max lean " +
      maxLean.toFixed(3) +
      " story cm",
  );
});
test("human building placement and four-room seated route preserve floor and avoid actual screens", () => {
  const anchor = S.buildingAnchorForViewer([10, 165, 20], 0);
  const mapped = S.toBuildingWorld(S.buildingStops().entrance.headCm, anchor);
  mapped.forEach((n, i) => a.ok(Math.abs(n - [10, 165, 20][i]) < 1e-8));
  a.equal(S.buildingStops().entrance.cameraYawRad + anchor.yawRad, 0);
  let transitions = 0;
  const nav = new S.BuildingNavigation(anchor, {
    moveViewerAlong() {
      transitions++;
    },
    setContextAction() {},
  });
  nav.observeLocalHead([350, 165, 110]);
  a.equal(transitions, 0);
  a.equal(nav.currentPlace(), "hall");
  for (const r of [mirror, packing])
    for (const [from, to] of [
      ["entrance", "hall"],
      ["hall", "workshop"],
      ["workshop", "archive"],
      ["archive", "entrance"],
    ]) {
      const points = [
        S.buildingStops()[from].headCm,
        ...S.accessibleRoute(from, to),
      ];
      a.deepEqual(points.at(-1), S.buildingStops()[to].headCm);
      for (let i = 1; i < points.length; i++)
        for (const wall of r.sealed.board.room.walls) {
          const convert = (p) => ({ x: p[0] / 100, y: 1.65, z: p[2] / 100 });
          a.equal(
            D.hitsWall(convert(points[i - 1]), convert(points[i]), wall),
            false,
            from + " to " + to + " crosses " + wall.id,
          );
        }
    }
  nav.moveTo("workshop");
  nav.moveTo("archive");
  nav.moveTo("entrance");
  a.equal(transitions, 3);
});
test("real eye-height entry sees centre and all exhibit edges through actual doorway", () => {
  for (const input of [
    C.createMirrorCase(false),
    C.createMuseumTheft(false),
    C.createPackingCase(),
  ]) {
    const b = compiled(input).sealed.board,
      entry = S.visibleEntry(b);
    a.ok(entry, input.title + " has no clear tested arrival");
    const anchor = S.buildingAnchorForViewer([0, 0, 0], 0, 165, entry);
    S.toBuildingWorld(entry.headCm, anchor).forEach((v) =>
      a.ok(Math.abs(v) < 1e-8),
    );
    console.log(
      input.title +
        " visible entry " +
        entry.headCm.join(",") +
        " yaw " +
        entry.cameraYawRad.toFixed(6),
    );
  }
});
console.log(checks + " spatial checks passed");
