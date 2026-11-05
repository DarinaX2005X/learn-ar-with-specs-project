// Compile CaseFlow.ts and AuthorSession.ts to a temporary CommonJS directory first.
// node Tests/Cases/check.cjs <compiled directory>
const assert = require("node:assert/strict");
const path = require("node:path");
const root = process.argv[2];
const { CaseFlow } = require(path.join(root, "Cases/CaseFlow.js"));
const { AuthorSession } = require(path.join(root, "Author/AuthorSession.js"));
const { prove } = require(path.join(root, "Domain/index.js"));
let author,
  detective,
  detached = 0,
  closed = false;
const flow = new CaseFlow({
  createAuthor(draft, checkpoint) {
    return (author = new AuthorSession(draft, checkpoint));
  },
  mountAuthor() {
    return {
      detach() {
        detached++;
      },
    };
  },
  mountDetective(sealed) {
    detective = sealed;
    return {
      detach() {
        detached++;
      },
    };
  },
  cancelInput() {},
  closeLid() {
    closed = true;
  },
  openLid() {
    closed = false;
  },
  show() {},
});
assert.equal(flow.snapshot().primary, "Replay the alarm");
assert(flow.replayAlarm());
assert.equal(detective.caseId, 'missing-ruby');
const courier = detective.board.tracks.find(track => track.id === 'A');
assert(courier.keys.some(key => key.x !== courier.keys[0].x || key.z !== courier.keys[0].z), 'The actual starter mount must contain the moving Courier route');
assert.deepEqual(prove(detective.board, detective.clues, [], 'Underdetermined').possibleCulprits, ['Conservator']);
const original = JSON.stringify(detective);
assert(!flow.stageTheft());
assert(flow.finishAttempt(true));
assert(flow.stageTheft());
author.setTick(12);
author.select("C");
assert(!flow.passCase(), "untested input must stay editable");
assert(author.edit({ kind: "setAperture", aperture: 0 }));
assert(author.startTest());
while (author.snapshot().testing) author.advanceProof(32);
assert(author.confirmAmbiguity());
const oldEpoch = flow.snapshot().inputEpoch;
assert(flow.passCase());
assert(closed);
assert(!flow.acceptsInput(oldEpoch));
assert(!flow.passCase());
assert(flow.cancelHandoff());
assert.equal(author.checkpoint().tick, 12);
assert.equal(author.checkpoint().selected, "C");
assert(author.startTest());
while (author.snapshot().testing) author.advanceProof(32);
assert(author.confirmAmbiguity());
assert(flow.passCase());
assert(flow.openCase());
assert(!flow.openCase());
assert.equal(detective.board.room.mirror.aperture, 0);
assert(Object.isFrozen(detective));
assert(!("casting" in detective.board));
assert(!("vault" in detective));
assert.equal(
  prove(detective.board, detective.clues, [], "Underdetermined")
    .possibleCulprits.length,
  2,
);
assert(flow.finishAttempt(true));
assert(flow.selectCase("missing-ruby"));
assert(flow.replayAlarm());
assert.equal(JSON.stringify(detective), original);
assert(flow.finishAttempt(true));
assert(flow.selectCase("packing-room"));
assert(flow.replayAlarm());
assert(
  detective.clues.clues.some(
    (c) => c.kind === "Rim" && c.shapes.includes("Guard"),
  ),
);
assert(detached >= 5);

// A fresh performance should produce a different culprit from the same props.
assert(flow.finishAttempt(true));
assert(flow.selectCase("missing-ruby"));
assert(flow.stageTheft());
const witness = author.getDraft().witnesses[0];
assert(author.edit({
  kind: "setWitness",
  witness: { ...witness, position: { x: 0.7, y: 1, z: 0.9 }, yaw: witness.yaw - 0.08 },
}));
assert(author.edit({ kind: "assignRole", track: "A", role: "Conservator" }));
assert(author.edit({ kind: "assignRole", track: "B", role: "Guard" }));
assert(author.edit({
  kind: "setPathKey", track: "B",
  key: { tick: 11, x: 2.4, z: 4, y: 1, yaw: 0 },
}));
const beforeTake = author.getDraft();
assert(!author.edit({ kind: "stageTake", track: "A", tick: 11 }));
assert.deepEqual(author.getDraft(), beforeTake, "An unreachable hand must not move the alarm");
assert(author.edit({ kind: "stageTake", track: "B", tick: 11 }));
assert.equal(author.getDraft().rev, beforeTake.rev + 1);
assert.equal(author.getDraft().alarmTick, 11);
assert(author.undo());
assert.equal(author.getDraft().alarmTick, beforeTake.alarmTick);
assert.deepEqual(author.getDraft().events, beforeTake.events);
assert(author.edit({ kind: "stageTake", track: "B", tick: 11 }));
assert(!flow.passCase());
assert(author.startTest());
while (author.snapshot().testing) author.advanceProof(32);
assert(flow.passCase());
assert(flow.openCase());
assert.equal(detective.board.alarmTick, 11);
assert.ok(!("casting" in detective.board));
const { DetectiveSession } = require(path.join(root, "Detective/DetectiveSession.js"));
const investigation = new DetectiveSession(detective, { render() {}, clear() {} });
const marks = investigation.snapshot().observations.filter(mark => mark.observation.kind === "fragment");
assert.deepEqual(marks.map(mark => mark.payload.fragments[0].role).sort(), ["Conservator", "Courier"]);
for (const mark of marks) {
  investigation.dispatch({ type: "selectObservation", id: mark.id });
  investigation.dispatch({ type: "pin" });
}
investigation.dispatch({ type: "claim", claim: "Guard" });
investigation.dispatch({ type: "check" });
while (investigation.snapshot().checking) investigation.update(0);
assert.equal(investigation.snapshot().verdict.status, "proved");
investigation.dispose();
assert(flow.finishAttempt(true));
assert(flow.selectCase("missing-ruby"));
assert(flow.replayAlarm());
assert.equal(JSON.stringify(detective), original, "Staging another performance must preserve the original");
flow.dispose();
