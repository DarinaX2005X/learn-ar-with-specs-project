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
flow.dispose();
