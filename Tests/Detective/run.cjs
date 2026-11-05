const assert = require("node:assert/strict");
const { compileCase } = require("./build/Domain/compile");
const { createMirrorCase, createPackingCase } = require("./build/Domain/cases");
const { DetectiveSession } = require("./build/Detective/DetectiveSession");
const { detectiveControls } = require("./build/Detective/DetectiveControls");
function sealed(draft) {
  const c = compileCase(draft);
  assert.equal(c.ok, true, JSON.stringify(c.errors));
  return c.sealed;
}
function mount(input, limit) {
  let reveal = 0;
  const session = new DetectiveSession(
    input,
    {
      render() {},
      clear() {},
      revealTheft() {
        reveal++;
      },
    },
    limit,
  );
  return { session, reveals: () => reveal };
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
pin(session, opened, [frame.id]);
session.dispatch({ type: "check" });
let state = drain(session);
assert.equal(state.verdict.status, "proved");
session.dispatch({ type: "selectClue", id: frame.id });
assert.equal(session.snapshot().tick, 12);
assert.equal(session.snapshot().source, frame.witness);
assert.ok(detectiveControls(session).some((c) => c.id === `glass-${frame.id}`));
session.dispatch({
  type: "pinClue",
  id: frame.id,
  caseId: opened.caseId,
  rev: opened.rev,
});
assert.equal(session.snapshot().glass.length, 1);
session.dispatch({ type: "reveal" });
assert.equal(reveals(), 1);
session.dispatch({ type: "remove" });
assert.equal(session.snapshot().verdict, undefined);
session.dispatch({ type: "undo" });
assert.equal(session.snapshot().glass.length, 1);
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
pin(session, opened, [frame.id]);
assert.equal(session.snapshot().glass.length, 0);
pin(session, altered, [frame.id]);
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
  packing.clues.clues.map((c) => c.id),
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
