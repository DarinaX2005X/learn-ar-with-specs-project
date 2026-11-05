const assert = require("node:assert/strict");
const {
  AuthorViewSession,
  authorViewControls,
} = require("./build/Author/AuthorViewSession");
const {
  AuthorSession,
} = require("./build/Author/AuthorSession");
const D = require("./build/Domain");
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
function runTest(session) {
  assert.equal(session.startTest(), true);
  let frames = 0;
  while (session.snapshot().testing && frames++ < 10000)
    session.advanceProof(4);
  assert.ok(frames < 10000);
}
let role = true,
  active,
  published,
  clears = 0,
  cancels = 0,
  switches = 0,
  coordinator;
function coordinatorFor(base) {
  active = base;
  coordinator = new AuthorViewSession(base, {
    isAuthorRole: () => role,
    activate(next) {
      active.cancelGesture();
      active.pause();
      if (active.snapshot().testing) active.cancelTest();
      active = next;
      switches++;
      coordinator.sync();
    },
    cancelInput() {
      cancels++;
    },
    present(value) {
      published = value;
    },
    clear() {
      clears++;
    },
  });
  coordinator.sync();
  return coordinator;
}
function click(id) {
  const c = authorViewControls(
    coordinator.snapshot(),
    active.snapshot().draft.witnesses,
  ).find((c) => c.id === id);
  assert.ok(c, "Missing ordinary author control " + id);
  return coordinator.dispatch(c.action);
}
const source = D.createMuseumTheft();
const base = new AuthorSession(source);
base.setTick(12);
base.select("B");
runTest(base);
assert.equal(base.snapshot().canSeal, true);
const original = base.getDraft();
coordinatorFor(base);
assert.equal(click("WatchThisView-entrance"), true);
let view = coordinator.snapshot();
assert.equal(view.mode, "recording");
assert.equal(view.recording.frame.tick, 12);
assert.equal(view.recording.frame.witness, "entrance");
const compiled = D.compileCase(base.getDraft());
assert.equal(compiled.ok, true);
same(
  view.recording.frame,
  D.frameAt(
    D.observe(compiled.sealed.board, compiled.vault.actualHistory),
    "entrance",
    12,
  ),
);
assert.equal("actualHistory" in view.recording, false);
assert.equal("sourceDraft" in view.recording, false);
base.beginGesture();
base.previewEdit({ kind: "setAperture", aperture: 0 });
coordinator.sync();
assert.equal(coordinator.snapshot().recording.board.rev, original.rev);
assert.ok(
  !coordinator
    .snapshot()
    .recording.frame.payload.fragments.some((f) => f.role === "Guard"),
  "Same-revision preview must recompile the actual camera view",
);
base.cancelGesture();
coordinator.sync();
assert.ok(
  coordinator
    .snapshot()
    .recording.frame.payload.fragments.some((f) => f.role === "Guard"),
);
assert.equal(click("TryAChange"), true);
assert.notEqual(active, base);
assert.equal(active.edit({ kind: "setAperture", aperture: 0 }), true);
coordinator.sync();
view = coordinator.snapshot();
assert.equal(view.mode, "change");
assert.equal(view.before.tick, 12);
assert.equal(view.after.tick, 12);
assert.equal(view.before.source, view.after.source);
assert.ok(view.before.frame.payload.fragments.some((f) => f.role === "Guard"));
assert.ok(!view.after.frame.payload.fragments.some((f) => f.role === "Guard"));
same(base.getDraft(), original);
assert.equal(base.snapshot().canSeal, true);
const oldKeep = authorViewControls(view, active.getDraft().witnesses).find(
  (c) => c.id === "KeepThisChange",
).action;
assert.equal(click("CompareThisChange"), true);
let mirrorFrames = 0;
while (coordinator.snapshot().comparing && mirrorFrames++ < 1000) {
  active.advanceProof(4);
  coordinator.update();
  coordinator.sync();
}
assert.ok(mirrorFrames < 1000);
assert.ok(
  coordinator
    .snapshot()
    .differences.some(
      (d) =>
        d.field === "taker" && d.before.length === 1 && d.after.length === 2,
    ),
);
assert.equal(click("DiscardChange"), true);
assert.equal(active, base);
same(base.getDraft(), original);
assert.equal(base.snapshot().tick, 12);
assert.equal(base.snapshot().selected, "B");
assert.equal(base.snapshot().canSeal, true);
same(coordinator.snapshot().recording.frame, view.before.frame);
assert.equal(click("TryAChange"), true);
active.edit({ kind: "setAperture", aperture: 0 });
active.setTick(13);
coordinator.sync();
assert.equal(
  coordinator.dispatch(oldKeep),
  false,
  "Held prior-generation keep must not accept a newer trial",
);
assert.equal(click("KeepThisChange"), true);
assert.equal(active, base);
assert.equal(base.getDraft().rev, original.rev + 1);
assert.equal(base.getDraft().room.mirror.aperture, 0);
assert.equal(base.snapshot().tick, 13);
assert.equal(base.snapshot().canSeal, false);
assert.equal(base.undo(), true);
assert.equal(base.getDraft().room.mirror.aperture, 1);
same(source, D.createMuseumTheft());
const beforeInterrupted = base.getDraft();
base.beginGesture();
base.previewEdit({ kind: "setAperture", aperture: 0 });
assert.equal(click("TryAChange"), true);
assert.equal(
  active.getDraft().room.mirror.aperture,
  1,
  "Trial begins from last committed draft",
);
active.edit({ kind: "setAperture", aperture: 0 });
active.beginGesture();
active.previewEdit({ kind: "setAperture", aperture: 0.5 });
coordinator.sync();
assert.equal(coordinator.snapshot().canKeep, false);
assert.equal(click("DiscardChange"), true);
same(base.getDraft(), beforeInterrupted);
assert.equal(click("TryAChange"), true);
active.edit({ kind: "setAperture", aperture: 0 });
const beforeRoleExit = base.getDraft();
const switchesBefore = switches;
role = false;
coordinator.sync();
assert.equal(coordinator.snapshot().enabled, false);
assert.equal(coordinator.snapshot().before, undefined);
assert.equal(coordinator.snapshot().after, undefined);
assert.equal(
  switches,
  switchesBefore,
  "Role exit must not remount private author stage",
);
same(base.getDraft(), beforeRoleExit);
assert.equal(coordinator.dispatch(oldKeep), false);
assert.deepEqual(
  authorViewControls(coordinator.snapshot(), source.witnesses),
  [],
);
coordinator.dispose();
assert.equal(coordinator.snapshot().recording, undefined);
role = true;
const staleBase = new AuthorSession(source);
staleBase.setTick(12);
coordinatorFor(staleBase);
click("TryAChange");
active.edit({ kind: "setAperture", aperture: 0 });
staleBase.edit({ kind: "setAperture", aperture: 0.5 });
coordinator.sync();
assert.equal(coordinator.snapshot().canKeep, false);
const prior = staleBase.getDraft();
assert.equal(coordinator.dispatch({ type: "keepChange" }), false);
same(staleBase.getDraft(), prior);
assert.equal(click("DiscardChange"), true);
same(staleBase.getDraft(), prior);
coordinator.dispose();
assert.ok(clears > 0 && cancels > 0);
console.log(
  "Author fixed recording, same-tick isolated trial, keep/discard, stale revision and role cleanup passed",
);

// Both public answer sets come from real proofs, including a changed chain field.
role = true;
const chainBase = new AuthorSession(D.createPackingCase());
chainBase.setTick(20);
coordinatorFor(chainBase);
click("TryAChange");
assert.equal(
  active.edit({
    kind: "setEvent",
    event: { kind: "Stash", carrier: "B", box: "canvas trunk", tick: 20 },
  }),
  true,
);
coordinator.sync();
assert.equal(click("CompareThisChange"), true);
let compareFrames = 0;
while (coordinator.snapshot().comparing && compareFrames++ < 10000) {
  active.advanceProof(4);
  coordinator.update();
  coordinator.sync();
}
assert.ok(compareFrames < 10000);
let comparison = coordinator.snapshot();
assert.equal(comparison.before.tick, 20);
assert.equal(comparison.after.tick, 20);
assert.deepEqual(comparison.before.verdict.possibleCulprits, ["Conservator"]);
assert.deepEqual(comparison.after.verdict.possibleCulprits, ["Conservator"]);
assert.ok(
  comparison.differences.some(
    (d) =>
      d.field === "recipient" &&
      d.before.length === 2 &&
      d.after.length === 1 &&
      d.after[0] === "Courier",
  ),
);
assert.ok(
  comparison.differences.some(
    (d) =>
      d.field === "cache" &&
      d.before[0] === "brass case" &&
      d.after[0] === "canvas trunk",
  ),
);
const unchangedChain = chainBase.getDraft();
click("DiscardChange");
same(chainBase.getDraft(), unchangedChain);
coordinator.dispose();
const compileModule = require("./build/Domain/compile");
const originalCompile = compileModule.compileCase;
let calls = 0;
compileModule.compileCase = (...args) => {
  calls++;
  return originalCompile(...args);
};
const cachedBase = new AuthorSession(D.createMuseumTheft());
coordinatorFor(cachedBase);
click("WatchThisView-entrance");
const firstCompileCount = calls;
for (let i = 0; i < 100; i++) {
  active.setTick(i % 25);
  coordinator.sync();
}
assert.equal(
  calls,
  firstCompileCount,
  "Playback changes frame, not the compiled recording",
);
click("TryAChange");
active.edit({ kind: "setAperture", aperture: 0 });
const beforeSync = calls;
for (let i = 0; i < 40; i++) {
  active.setTick(i % 25);
  coordinator.sync();
}
assert.equal(
  calls,
  beforeSync + 1,
  "One draft change compiles once, then both clocks reuse actual tapes",
);
coordinator.dispose();
compileModule.compileCase = originalCompile;
console.log(
  "Real culprit/field comparison and playback compile caching passed",
);
