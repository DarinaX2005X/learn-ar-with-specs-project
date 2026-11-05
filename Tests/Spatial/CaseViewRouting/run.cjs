const assert = require("node:assert/strict");
const {
  CaseViewRouting,
  caseViewControls,
} = require("../build/Spatial/CaseViewRouting");
const D = require("../build/Domain");
const { DetectiveSession } = require("../build/Detective/DetectiveSession");
function seal(draft) {
  const result = D.compileCase(draft);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.sealed;
}
const sealed = seal(D.createMirrorCase());
let detective = new DetectiveSession(sealed, { render() {}, clear() {} });
for (const clue of D.getObservations(sealed.clues, "entrance", 12).filter(
  (c) => c.observation.kind === "fragment",
))
  detective.dispatch({
    type: "pinClue",
    id: clue.id,
    caseId: sealed.caseId,
    rev: sealed.rev,
  });
detective.dispatch({ type: "claim", claim: "Conservator" });
detective.dispatch({ type: "check" });
while (detective.snapshot().checking) detective.update(0);
assert.equal(detective.snapshot().verdict.status, "proved");
let board = sealed.board;
let active = true;
const viewer = { eyeCm: [20, 140, 50], forward: [0, 0, -1] };
const originalViewer = structuredClone(viewer);
let viewerUnavailable = false;
let applied,
  covered = false,
  secondary = true,
  drags = 0,
  sounds = 0;
let pendingDrag = true;
const route = new CaseViewRouting({
  readSession: () =>
    active ? { board, detective: detective.snapshot() } : undefined,
  readViewer: () => {
    if (viewerUnavailable) throw new Error("No tracked camera");
    return viewer;
  },
  finishTimeDrag() {
    drags++;
    if (pendingDrag) {
      detective.dispatch({ type: "freeze" });
      pendingDrag = false;
    }
    // Native pause publishes a Detective snapshot and can synchronously render.
    route.sync();
  },
  setPresentation(value) {
    applied = value;
  },
  setFrameCovered(value) {
    covered = value;
  },
  setSecondaryLabelsVisible(value) {
    secondary = value;
  },
  stopSound() {
    sounds++;
  },
});
function clickView(id) {
  const control = caseViewControls(route.snapshot()).find((c) => c.id === id);
  assert.ok(control, "Missing physical case view handle " + id);
  return route.dispatch(control.action);
}
assert.equal(route.snapshot().mode, "museum");
assert.equal(applied, undefined, "F001 full museum is the normal opening");
const stateBefore = detective.snapshot();
clickView("CaseViewHandle");
assert.equal(route.snapshot().mode, "choice");
assert.equal(applied, undefined);
clickView("CaseViewSeated");
assert.equal(applied.kind, "table");
assert.equal(applied.placement.scale, 0.06);
assert.equal(covered, true);
route.update(0.2);
assert.equal(covered, false);
assert.equal(secondary, true);
assert.deepEqual(detective.snapshot(), stateBefore);
route.dispatch({ type: "standByCase" });
assert.equal(applied.kind, "room");
assert.equal(applied.placement.scale, 1);
assert.equal(secondary, false);
const placement = structuredClone(applied.placement);
const w = board.witnesses[0].position;
const c = Math.cos(placement.yawRad),
  s = Math.sin(placement.yawRad);
const projected = [
  placement.originCm[0] + w.x * 100 * c + w.z * 100 * s,
  placement.originCm[1] + w.y * 100,
  placement.originCm[2] + w.z * 100 * c - w.x * 100 * s,
];
projected.forEach((value, i) =>
  assert.ok(Math.abs(value - viewer.eyeCm[i]) < 1e-8),
);
assert.deepEqual(
  viewer,
  originalViewer,
  "The routing never moves the tracked camera",
);
viewer.eyeCm[0] += 25;
route.update(0.2);
assert.deepEqual(
  applied.placement,
  placement,
  "Display stays world anchored after a head movement",
);
route.dispatch({ type: "backToTable" });
assert.equal(applied.kind, "table");
assert.deepEqual(detective.snapshot(), stateBefore);
route.dispatch({ type: "setReducedMotion", enabled: true });
route.dispatch({ type: "standByCase" });
assert.equal(applied.placement.scale, 1);
route.update(0.1);
assert.equal(covered, false);
route.dispatch({ type: "closeView" });
assert.equal(applied, undefined);
assert.equal(covered, false);
assert.equal(secondary, true);
assert.deepEqual(detective.snapshot(), stateBefore);
const closed = seal(D.createMirrorCase(false));
board = closed.board;
detective = new DetectiveSession(closed, { render() {}, clear() {} });
detective.dispatch({ type: "checkAll" });
while (detective.snapshot().checking) detective.update(0);
detective.dispatch({ type: "compareVersions", field: "taker" });
const hypothesisBefore = detective.snapshot();
route.sync();
route.dispatch({ type: "viewFromHere" });
assert.equal(applied.comparison, true);
route.dispatch({ type: "standByCase" });
route.dispatch({ type: "backToTable" });
assert.deepEqual(
  detective.snapshot(),
  hypothesisBefore,
  "Scale routing preserves both actual hypotheses and their proof",
);
const packing = seal(D.createPackingCase({ rearCamera: true }));
board = packing.board;
detective = new DetectiveSession(packing, { render() {}, clear() {} });
route.sync();
route.dispatch({ type: "standByCase" });
const previousPlacement = structuredClone(applied.placement);
detective.dispatch({ type: "source", source: "passage" });
const changedSource = detective.snapshot();
route.sync();
assert.equal(applied.source, "passage");
assert.notDeepEqual(applied.placement, previousPlacement);
assert.deepEqual(detective.snapshot(), changedSource);
viewer.forward = [0, 1, 0];
const invalidView = structuredClone(applied);
assert.equal(route.dispatch({ type: "standByCase" }), false);
assert.deepEqual(applied, invalidView);
assert.equal(route.snapshot().instruction, "Look toward the case");
viewer.forward = [0, 0, -1];
viewerUnavailable = true;
assert.equal(route.dispatch({ type: "standByCase" }), false);
assert.deepEqual(applied, invalidView);
viewerUnavailable = false;
// A new revision and role exit restore native display transforms and remove return handles.
route.dispatch({ type: "viewFromHere" });
board = { ...board, rev: board.rev + 1 };
route.sync();
assert.equal(route.snapshot().mode, "museum");
assert.equal(applied, undefined);
active = false;
route.sync();
assert.equal(route.snapshot().available, false);
assert.equal(applied, undefined);
route.dispose();
route.dispose();
assert.equal(route.dispatch({ type: "standByCase" }), false);
assert.equal(covered, false);
assert.ok(sounds > 0 && drags > 0);
console.log("Case view preserves public investigation and stationary viewer");
