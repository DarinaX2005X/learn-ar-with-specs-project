const assert = require("node:assert/strict");
const D = require("../build/Domain/index"),
  { DetectiveSession } = require("../build/Detective/DetectiveSession"),
  {
    CaseViewRouting,
    caseViewControls,
  } = require("../build/Spatial/CaseViewRouting"),
  { SpatialStage } = require("../build/Spatial/SpatialStage"),
  { caseViewHandleSlots } = require("../build-handles/Runtime/CaseViewHandles");
const sealed = D.compileCase(D.createMirrorCase(false)).sealed;
let session = new DetectiveSession(sealed, { render() {}, clear() {} }),
  board = sealed.board,
  active = true;
function proof(s, scope) {
  s.dispatch({ type: "seek", tick: 12 });
  if (scope === "selected") {
    const mark = s
      .snapshot()
      .observations.find(
        (o) =>
          o.observation.kind === "fragment" &&
          o.payload.fragments.some((f) => f.role === "Courier"),
      );
    s.dispatch({ type: "selectObservation", id: mark.id });
    s.dispatch({ type: "pin" });
    s.dispatch({ type: "claim", claim: "Conservator" });
    s.dispatch({ type: "check" });
  } else s.dispatch({ type: "checkAll" });
  for (let i = 0; i < 2000 && s.snapshot().checking; i++) s.update(0);
  s.dispatch({ type: "compareVersions", field: "taker" });
  assert.equal(s.snapshot().comparison.scope, scope);
}
proof(session, "all");
const viewer = { eyeCm: [20, 160, 70], forward: [0, 0, -1] },
  camera = structuredClone(viewer);
let presentation,
  finish = 0,
  callbacks = 0;
const route = new CaseViewRouting({
  readSession: () =>
    active ? { board, detective: session.snapshot() } : undefined,
  readViewer: () => viewer,
  finishTimeDrag() {
    finish++;
  },
  setPresentation(p) {
    callbacks++;
    presentation = p;
  },
  setFrameCovered() {},
  setSecondaryLabelsVisible() {},
  stopSound() {},
});
function standAtOfferedPull() {
  assert.equal(route.dispatch({ type: "chooseView" }), true);
  const eyeBefore = [...viewer.eyeCm];
  const target = route.snapshot().choicePlacement.originCm;
  const direction = target.map((value, index) => value - viewer.eyeCm[index]);
  const length = Math.hypot(...direction);
  viewer.forward = direction.map((value) => value / length);
  Object.assign(camera, structuredClone(viewer));
  const entryViewer = structuredClone(viewer);
  assert.equal(route.dispatch({ type: "standByCase" }), true);
  assert.deepEqual(
    viewer,
    entryViewer,
    "Entry never changes the tracked camera",
  );
  assert.deepEqual(
    viewer.eyeCm,
    eyeBefore,
    "Entry never moves the tracked eye",
  );
}
standAtOfferedPull();
const before = session.snapshot(),
  placement = structuredClone(presentation),
  finishes = finish;
const command = () =>
  caseViewControls(route.snapshot()).find((x) => x.id === "CaseViewVersion");
let action = command().action;
assert.equal(command().label, "Show version 2");
route.dispatch(action);
assert.equal(presentation.versionIndex, 1);
assert.equal(route.dispatch(action), false);
assert.equal(finish, finishes);
assert.equal(command().label, "Show version 1");
assert.deepEqual(presentation.placement, placement.placement);
assert.deepEqual(presentation.handlePlacement, placement.handlePlacement);
assert.equal(presentation.comparisonScope, "all");
assert.deepEqual(session.snapshot(), before);
assert.deepEqual(viewer, camera);
let visible = [],
  positions = [],
  recordings = [];
const ports = {
  wings: [0, 1].map((index) => ({ render() {} })),
  recording: {
    render: (mode, frame, tick) => recordings.push({ mode, frame, tick }),
  },
  setWingPlacement(i, p) {
    positions[i] = p;
  },
  setWingVisible(i, v) {
    visible[i] = v;
  },
  setHandTargets() {},
  setNestEmpty() {},
  setCache() {},
  setLabels() {},
  setFrameCovered() {},
  setSecondaryLabelsVisible() {},
  setReturnHandle() {},
  finishTimeDrag() {},
  stopSound() {},
  clear() {},
};
const context = {
  tick: 12.375,
  witnessId: before.source,
  selectedIds: [],
  versionIndex: 0,
};
const stage = new SpatialStage(board, context, ports, (source, tick) =>
  D.getObservations(sealed.clues, source, tick),
);
stage.setVersions(before.comparison.pair, "all", true);
stage.enterRoom({ x: 20, y: 160, z: 70 }, { x: 0, y: 0, z: -1 }, () => context);
const origin = structuredClone(positions[0]);
assert.deepEqual(visible, [true, false]);
stage.setVersion(1);
assert.deepEqual(visible, [false, true]);
assert.deepEqual(positions[1], origin);
assert.equal(stage.snapshot().tick, 12.375);
assert.notEqual(
  D.answer(board, before.comparison.pair[0], "taker"),
  D.answer(board, before.comparison.pair[1], "taker"),
);
const recorded = recordings.at(-1);
stage.setVersion(0);
assert.deepEqual(recordings.at(-1), recorded);
stage.backToTable();
assert.deepEqual(visible, [true, true]);
const slots = caseViewHandleSlots(route.snapshot(), {
    originCm: [0, 94, 0],
    scale: 1,
    yawRad: 0,
  }),
  tab = slots.find((x) => x.id === "CaseViewVersion");
assert(tab);
assert.deepEqual(tab.placement, presentation.handlePlacement);
for (const other of slots.filter((slot) => slot.id !== "CaseViewVersion")) {
  const expectedOffset = other.id === "CaseViewBack" ? 12 : -12;
  assert.deepEqual(other.placement.originCm, [
    tab.placement.originCm[0],
    tab.placement.originCm[1] + expectedOffset,
    tab.placement.originCm[2],
  ]);
  // Actual PlayTable collider heights: room pulls 10 cm, version tab 8 cm.
  assert.equal(Math.abs(expectedOffset) - (10 + 8) / 2, 3);
}
action = command().action;
route.dispatch({ type: "backToTable" });
assert.equal(route.dispatch(action), false);
assert(!command());
assert.equal(presentation.comparison, true);
standAtOfferedPull();
assert.equal(presentation.versionIndex, 1);
assert.equal(route.dispatch(action), false);
route.dispatch(command().action);
assert.equal(presentation.versionIndex, 0);
callbacks = 0;
for (let i = 0; i < 100; i++) route.update(1 / 60);
assert.equal(callbacks, 0);
session.dispatch({ type: "seek", tick: 0 });
route.sync();
session.dispatch({ type: "play" });
callbacks = 0;
let phaseSamples = 0,
  previous = 0,
  tickChanges = 0;
for (let i = 0; i < 600; i++) {
  const old = session.snapshot().tick;
  session.update(1 / 60);
  if (session.snapshot().tick !== old) tickChanges++;
  if (session.presentationTick() !== previous) phaseSamples++;
  previous = session.presentationTick();
  route.update(1 / 60);
}
assert.equal(callbacks, tickChanges);
assert(callbacks < 25);
assert(phaseSamples > 500);
callbacks = 0;
route.dispatch(command().action);
assert.equal(callbacks, 1);
for (let i = 0; i < 100; i++) route.update(1 / 60);
assert.equal(callbacks, 1);
action = command().action;
board = { ...board, rev: board.rev + 1 };
route.sync();
assert.equal(route.snapshot().mode, "museum");
assert.equal(route.dispatch(action), false);
active = false;
route.sync();
assert.equal(route.snapshot().available, false);
assert.deepEqual(
  caseViewHandleSlots(route.snapshot(), placement.handlePlacement),
  [],
);
route.dispose();
assert.equal(route.dispatch(action), false);
stage.dispose();
const selected = new DetectiveSession(sealed, { render() {}, clear() {} });
proof(selected, "selected");
let selectedPresentation;
const r2 = new CaseViewRouting({
  readSession: () => ({ board: sealed.board, detective: selected.snapshot() }),
  readViewer: () => viewer,
  finishTimeDrag() {},
  setPresentation(p) {
    selectedPresentation = p;
  },
  setFrameCovered() {},
  setSecondaryLabelsVisible() {},
  stopSound() {},
});
assert(r2.dispatch({ type: "chooseView" }));
const selectedTarget = r2.snapshot().choicePlacement.originCm;
const selectedDirection = selectedTarget.map(
  (value, index) => value - viewer.eyeCm[index],
);
const selectedLength = Math.hypot(...selectedDirection);
viewer.forward = selectedDirection.map((value) => value / selectedLength);
assert(r2.dispatch({ type: "standByCase" }));
r2.dispatch(
  caseViewControls(r2.snapshot()).find((x) => x.id === "CaseViewVersion")
    .action,
);
assert.equal(selectedPresentation.versionIndex, 1);
assert.equal(selectedPresentation.comparisonScope, "selected");
r2.dispose();
console.log(
  "PASS actual closed/selected proofs; same-position two-way room versions, fractional12.375 phase and recording preserved, paired return, scope, duplicate/stale/role/revision guards",
);
console.log(
  "PASS stationary100 updates=0 callbacks; playback600=" +
    tickChanges +
    " callbacks, " +
    phaseSamples +
    " fractional samples; switch emits once",
);

const { comparisonPoseTick } = require("../build/Spatial/CaseViewRouting");
assert.equal(
  comparisonPoseTick(12, true, sealed.board, {
    caseId: sealed.caseId,
    rev: sealed.rev,
    tick: 12.375,
  }),
  12.375,
);
assert.equal(
  comparisonPoseTick(12, false, sealed.board, {
    caseId: sealed.caseId,
    rev: sealed.rev,
    tick: 12.375,
  }),
  12,
);
for (const previous of [
  { caseId: "other", rev: sealed.rev, tick: 12.375 },
  { caseId: sealed.caseId, rev: 999, tick: 12.375 },
  { caseId: sealed.caseId, rev: sealed.rev, tick: 13 },
  { caseId: sealed.caseId, rev: sealed.rev, tick: 11.9 },
  { caseId: sealed.caseId, rev: sealed.rev, tick: NaN },
])
  assert.equal(comparisonPoseTick(12, true, sealed.board, previous), 12);
console.log(
  "PASS actual renderer phase helper retains matching fractional pose; pause/seek/new case/revision/nonfinite invalidate",
);
