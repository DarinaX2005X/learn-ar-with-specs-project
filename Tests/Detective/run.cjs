const assert = require("node:assert/strict");
const { compileCase } = require("./build/Domain/compile");
const { getObservations, observe } = require("./build/Domain/observe");
const { prove } = require("./build/Domain/prove");
const {
  createMirrorCase,
  createPackingCase,
  createMuseumTheft,
} = require("./build/Domain/cases");
const { DetectiveSession } = require("./build/Detective/DetectiveSession");
const { detectiveControls } = require("./build/Detective/DetectiveControls");
function sealed(draft) {
  const c = compileCase(draft);
  assert.equal(c.ok, true, JSON.stringify(c.errors));
  return c.sealed;
}
function mount(input, limit) {
  let reveal = 0;
  let renders = 0;
  const session = new DetectiveSession(
    input,
    {
      render() { renders++; },
      clear() {},
      revealTheft() {
        reveal++;
      },
    },
    limit,
  );
  return { session, reveals: () => reveal, renders: () => renders };
}
function drain(session) {
  let n = 0;
  while (session.snapshot().checking && n++ < 100000) session.update(0);
  assert.ok(n < 100000);
  return session.snapshot();
}
function pin(session, tape, ids) {
  for (const id of ids)
    session.dispatch({
      type: "pinClue",
      id,
      caseId: tape.caseId,
      rev: tape.rev,
    });
}
const opened = sealed(createMirrorCase());
let { session, reveals } = mount(opened);
session.dispatch({ type: "claim", claim: "Conservator" });
session.dispatch({ type: "check" });
assert.equal(drain(session).verdict.status, "needClue");
session.dispatch({ type: "reveal" });
assert.equal(reveals(), 0);
const frame = opened.clues.clues.find(
  (c) => c.kind === "Frame" && c.tick === 12,
);
const openingMarks = getObservations(
  opened.clues,
  frame.witness,
  frame.tick,
).filter((c) => c.observation.kind === "fragment");
pin(
  session,
  opened,
  openingMarks.map((c) => c.id),
);
session.dispatch({ type: "check" });
let state = drain(session);
assert.equal(state.verdict.status, "proved");
session.dispatch({ type: "selectClue", id: openingMarks[0].id });
assert.equal(session.snapshot().tick, 12);
assert.equal(session.snapshot().source, frame.witness);
assert.ok(
  detectiveControls(session).some(
    (c) => c.id === `glass-${openingMarks[0].id}`,
  ),
);
session.dispatch({
  type: "pinClue",
  id: openingMarks[0].id,
  caseId: opened.caseId,
  rev: opened.rev,
});
assert.equal(session.snapshot().glass.length, 2);
session.dispatch({ type: "reveal" });
assert.equal(reveals(), 1);
session.dispatch({ type: "remove" });
assert.equal(session.snapshot().verdict, undefined);
session.dispatch({ type: "undo" });
assert.equal(session.snapshot().glass.length, 2);
session.dispatch({ type: "claim", claim: "Guard" });
session.dispatch({ type: "check" });
state = drain(session);
assert.equal(state.verdict.status, "contradicted");
assert.ok(state.reasons.length);
session.dispatch({ type: "claim", claim: "Conservator" });
assert.equal(session.snapshot().verdict, undefined);
session.dispatch({ type: "check" });
session.dispatch({ type: "claim", claim: "Courier" });
session.update(0);
assert.equal(session.snapshot().verdict, undefined);
const changed = createMirrorCase();
changed.rev = 8;
changed.casting.B = "Guard";
changed.casting.C = "Conservator";
const altered = sealed(changed);
session = mount(altered).session;

pin(
  session,
  opened,
  openingMarks.map((c) => c.id),
);
assert.equal(session.snapshot().glass.length, 0);
pin(
  session,
  altered,
  getObservations(altered.clues, frame.witness, frame.tick)
    .filter((c) => c.observation.kind === "fragment")
    .map((c) => c.id),
);
session.dispatch({ type: "claim", claim: "Guard" });
session.dispatch({ type: "check" });
assert.equal(drain(session).verdict.status, "proved");
const closed = sealed(createMirrorCase(false));
session = mount(closed).session;
session.dispatch({ type: "checkAll" });
state = drain(session);
assert.equal(state.verdict.status, "ambiguous");
assert.equal(state.verdict.scope, "all");
assert.ok(state.verdict.possibleCulprits.length >= 2);
const before = state.tick;
for (const role of state.verdict.possibleCulprits) {
  session.dispatch({ type: "version", role });
  assert.equal(session.snapshot().mode, "reconstruction");
  session.dispatch({ type: "pin" });
  assert.equal(session.snapshot().glass.length, 0);
}
session.dispatch({ type: "returnObservations" });
assert.equal(session.snapshot().tick, before);
session = mount(opened, 1).session;
session.dispatch({ type: "claim", claim: "Guard" });
session.dispatch({ type: "check" });
assert.equal(drain(session).verdict.status, "incomplete");
assert.equal(session.snapshot().completed, false);
const packing = sealed(createPackingCase({ rearCamera: true }));
session = mount(packing).session;
pin(
  session,
  packing,
  packing.clues.clues.flatMap((c) =>
    c.kind === "Frame"
      ? [12, 15].includes(c.tick)
        ? getObservations(packing.clues, c.witness, c.tick)
            .filter((o) => ["fragment", "action"].includes(o.observation.kind))
            .map((o) => o.id)
        : []
      : [c.id],
  ),
);
session.dispatch({
  type: "claim",
  claim: { taker: "Conservator", recipient: "Courier", cache: "brass case" },
});
session.dispatch({ type: "check" });
assert.equal(drain(session).verdict.status, "proved");
const archive = session.archive();
assert.equal(
  session.restoreArchive({ ...archive, rev: archive.rev + 1 }),
  false,
);
assert.equal(session.restoreArchive(archive), true);
assert.equal(session.snapshot().verdict, undefined);
assert.equal(session.snapshot().glass.length, archive.ids.length);
session.dispatch({
  type: "hypothesis",
  history: {
    casting: { A: "Courier", B: "Courier", C: "Guard" },
    take: "A",
    brushes: [],
  },
});
assert.equal(
  session.snapshot().message,
  "Place each person on a different path",
);
console.log("Detective public API checks passed");

// The same stable control IDs are bound to physical targets and focus buttons.
function click(s, id) {
  const control = detectiveControls(s).find((c) => c.id === id);
  assert.ok(control, `Missing ordinary control ${id}`);
  s.dispatch(control.action);
}
const chain = sealed(createPackingCase());
session = mount(chain).session;
click(session, "inspect-object-rim:plinth");
assert.equal(session.snapshot().frame.kind, "Rim");
assert.equal("tick" in session.snapshot().frame, false);
click(session, "pin");
assert.ok(session.snapshot().glass.some((g) => g.id === "rim:plinth"));
const count = session.snapshot().glass.length;
session.dispatch({ type: "inspectObject", id: "private-author-path" });
assert.equal(session.snapshot().glass.length, count);
click(session, "source-entrance");
session.dispatch({ type: "seek", tick: 12 });
const takingMark = session
  .snapshot()
  .observations.find((c) =>
    c.payload.fragments.some((f) => f.role === "Conservator"),
  );
assert.ok(takingMark);
click(session, `select-observation-${takingMark.id}`);
click(session, "pin");
click(session, "field-taker");
click(session, "claim-Conservator");
click(session, "check");
state = drain(session);
assert.equal(state.fields.taker.value, "Conservator");
assert.equal(
  state.completed,
  false,
  "One chain finding must not finish the game",
);
click(session, "inspect-object-box:canvas trunk");
assert.equal(session.snapshot().frame.kind, "Box");
assert.equal(session.snapshot().frame.present, false);
assert.equal("tick" in session.snapshot().frame, false);
click(session, "pin");
click(session, "field-cache");
click(session, "claim-cache-brass case");
click(session, "check");
state = drain(session);
assert.equal(state.verdict.status, "needClue");
assert.equal(
  state.fields.cache,
  undefined,
  "An empty trunk does not prove a brass cache",
);
click(session, "inspect-object-box:brass case");
click(session, "pin");
click(session, "check");
state = drain(session);
assert.equal(state.fields.cache.value, "brass case");
assert.equal(state.completed, false);
click(session, "field-recipient");
click(session, "claim-unknown");
click(session, "check");
state = drain(session);
assert.equal(state.verdict.scope, "all");
assert.equal(state.fields.recipient.value, "Could be either");
assert.equal(state.completed, true);
assert.ok(state.verdict.fieldValues.recipient.length >= 2);
click(session, "compare-versions");
state = session.snapshot();
assert.equal(state.comparison.scope, "all");
assert.equal(state.comparison.field, "recipient");
assert.equal(
  JSON.stringify(state.comparison.tape),
  JSON.stringify(chain.clues),
);
const recipientOf = (h) => (h.pass ? h.casting[h.pass.to] : "None");
assert.notEqual(
  recipientOf(state.comparison.pair[0]),
  recipientOf(state.comparison.pair[1]),
);
const comparisonTick = state.tick;
session.dispatch({ type: "step", delta: 1 });
assert.equal(session.snapshot().comparison.pair.length, 2);
click(session, "return");
assert.equal(session.snapshot().tick, comparisonTick);
assert.equal(session.snapshot().comparison, undefined);
const versions = [];
for (let i = 0; i < 2; i++) {
  click(session, `field-version-recipient-${i}`);
  versions.push(JSON.stringify(session.snapshot().reconstruction));
  assert.equal(session.snapshot().mode, "reconstruction");
  click(session, "return");
}
assert.notEqual(versions[0], versions[1]);
click(session, "inspect-object-box:brass case");
click(session, "remove");
state = session.snapshot();
assert.equal(state.fields.cache, undefined);
assert.equal(state.fields.taker.value, "Conservator");
assert.equal(state.fields.recipient.value, "Could be either");
assert.equal(state.completed, false);
console.log("Packing Room ordinary control loop passed");

// Criterion 2 needs two separately selected physical observations.
const fragmentCase = sealed(createMirrorCase());
const alarmObservations = getObservations(fragmentCase.clues, "entrance", 12);
const marks = alarmObservations.filter(
  (c) => c.observation?.kind === "fragment",
);
assert.equal(marks.length, 2);
const courierMark = marks.find(
  (c) => c.payload.fragments[0].role === "Courier",
);
const guardMark = marks.find((c) => c.payload.fragments[0].role === "Guard");
assert.ok(courierMark && guardMark);
for (const order of [
  [courierMark, guardMark],
  [guardMark, courierMark],
]) {
  session = mount(fragmentCase).session;
  click(session, "source-entrance");
  session.dispatch({ type: "seek", tick: 12 });
  click(session, "pin");
  assert.equal(
    session.snapshot().glass.length,
    0,
    "Unselected aggregate recording cannot become one clue",
  );
  pin(session, fragmentCase, ["frame:entrance:12"]);
  assert.equal(
    session.snapshot().glass.length,
    0,
    "Direct API must not bypass fragment selection",
  );
  click(session, `select-observation-${order[0].id}`);
  assert.equal(session.snapshot().focusedObservation.id, order[0].id);
  assert.equal(
    session.snapshot().frame.payload.fragments.length,
    2,
    "Recording keeps both visible surfaces",
  );
  click(session, "pin");
  click(session, "claim-Conservator");
  click(session, "check");
  assert.equal(drain(session).verdict.status, "needClue");
  click(session, `select-observation-${order[1].id}`);
  click(session, "pin");
  click(session, "check");
  state = drain(session);
  assert.equal(state.verdict.status, "proved");
  assert.equal(state.glass.length, 2);
  assert.ok(state.glass.every((g) => g.clue.payload.fragments.length === 1));
  click(session, `glass-${order[0].id}`);
  click(session, "remove");
  assert.equal(session.snapshot().completed, false);
  assert.equal(session.snapshot().canUndoEvidence, true);
  click(session, "check");
  assert.equal(drain(session).verdict.status, "needClue");
  click(session, "undo");
  assert.equal(session.snapshot().canUndoEvidence, false);
  click(session, "check");
  assert.equal(drain(session).verdict.status, "proved");
  const saved = session.archive();
  const restored = mount(fragmentCase).session;
  assert.equal(restored.restoreArchive(saved), true);
  assert.deepEqual(
    restored.snapshot().glass.map((g) => g.id),
    saved.ids,
  );
  restored.dispatch({ type: "seek", tick: 0 });
  click(restored, `glass-${order[1].id}`);
  assert.equal(restored.snapshot().tick, 12);
  assert.equal(restored.snapshot().focusedObservation.id, order[1].id);
}
console.log("Independent observation control loop passed");
const smoothPlayback = mount(opened).session;
assert.equal(smoothPlayback.presentationTick(), 12);
smoothPlayback.dispatch({ type: "play" });
smoothPlayback.update(0.25);
assert.equal(smoothPlayback.presentationTick(), 12.5);
assert.equal(smoothPlayback.snapshot().tick, 12);
assert.equal(smoothPlayback.snapshot().frame.tick, 12);
smoothPlayback.update(0.25);
assert.equal(smoothPlayback.presentationTick(), 13);
assert.equal(smoothPlayback.isCompleted(), false);
smoothPlayback.dispatch({ type: "seek", tick: 24 });
assert.equal(smoothPlayback.presentationTick(), 24);

const cadence = mount(opened);
const initialRenders = cadence.renders();
for (let i = 0; i < 128; i++) cadence.session.update(1 / 64);
assert.equal(cadence.renders(), initialRenders, "paused scene stays on displayed evidence");
cadence.session.dispatch({ type: "play" });
const startedRenders = cadence.renders();
for (let i = 1; i <= 128; i++) {
  cadence.session.update(1 / 64);
  assert.equal(cadence.session.presentationTick(), 12 + i / 32);
}
assert.equal(cadence.renders() - startedRenders, 4, "128 fractional poses require four recording refreshes");

// A full-tape unknown finding must not spend render frames minimising an
// unrelated excluded suspect. Its counterexamples still fit every observation.
const closedMuseum = sealed(createMuseumTheft(false));
const unknownSession = mount(closedMuseum).session;
const courierOnly = getObservations(closedMuseum.clues, "entrance", 12).find(
  (c) => c.payload.fragments[0]?.role === "Courier",
);
pin(unknownSession, closedMuseum, [courierOnly.id]);
unknownSession.dispatch({
  type: "claimField",
  field: "taker",
  value: "Underdetermined",
});
unknownSession.dispatch({ type: "check" });
let proofFrames = 0;
while (unknownSession.snapshot().checking && proofFrames < 13) {
  unknownSession.update(0);
  proofFrames++;
}
assert.ok(
  proofFrames <= 12 && !unknownSession.snapshot().checking,
  "Whole-recording alternatives must finish within12 scheduler frames",
);
const alternatives = unknownSession.snapshot().verdict;
assert.equal(alternatives.status, "ambiguous");
assert.equal(alternatives.scope, "all");
const reference = prove(
  closedMuseum.board,
  closedMuseum.clues,
  [courierOnly.id],
  { taker: "Underdetermined" },
  { minimizeReasons: true },
);
assert.equal(alternatives.historyCount, reference.historyCount);
assert.deepEqual(alternatives.possibleCulprits, reference.possibleCulprits);
assert.deepEqual(alternatives.fieldValues, reference.fieldValues);
for (const role of alternatives.possibleCulprits) {
  const history = alternatives.examplesByCulprit[role];
  assert.equal(history.casting[history.take], role);
  assert.equal(
    JSON.stringify(observe(closedMuseum.board, history)),
    JSON.stringify(closedMuseum.clues),
  );
}
const openMuseum = sealed(createMuseumTheft());
const selectedSession = mount(openMuseum).session;
const namedMarks = getObservations(openMuseum.clues, "entrance", 12).filter(
  (c) => c.observation.kind === "fragment",
);
pin(
  selectedSession,
  openMuseum,
  namedMarks.map((c) => c.id),
);
selectedSession.dispatch({ type: "claim", claim: "Conservator" });
selectedSession.dispatch({ type: "check" });
const selectedGrounds = drain(selectedSession).verdict;
assert.equal(selectedGrounds.status, "proved");
assert.equal(selectedGrounds.scope, "selected");
for (const role of ["Courier", "Guard"]) {
  const mark = namedMarks.find((c) => c.payload.fragments[0].role === role);
  assert.deepEqual(
    selectedGrounds.exclusions[role],
    [mark.id],
    "Concrete accusation retains inclusion-minimal public grounds",
  );
}
console.log(
  "Whole-recording counterexamples finish promptly and selected proof grounds stay minimal",
);
