const assert = require("node:assert/strict");
const path = require("node:path");
const root = process.argv[2];
const { SessionShelf } = require(path.join(root, "Shelf/SessionShelf.js"));
const { CaseFlow } = require(path.join(root, "Cases/CaseFlow.js"));
const { AuthorSession } = require(path.join(root, "Author/AuthorSession.js"));
const { compileCase, prove } = require(path.join(root, "Domain/index.js"));
const shelf = new SessionShelf();
const originalRef = { id: "missing-ruby", rev: 1 };
const original = JSON.stringify(shelf.publicCase(originalRef));
assert.equal(shelf.list().length, 2);
assert.equal(shelf.reveal(originalRef), undefined);
const copy = shelf.fork(originalRef);
copy.title =
  "  A long museum name with enough letters to wrap onto the spine  ";
copy.room.mirror.aperture = 0;
shelf.saveDraft(copy, { tick: 12, selected: "C" });
assert.equal(shelf.draft(copy.id).draft.title.length, 40);
assert(
  shelf
    .list()
    .some((item) => item.state === "Draft" && item.spine.endsWith("…")),
);
const compiled = compileCase(shelf.draft(copy.id).draft);
assert(compiled.ok);
const stored = shelf.store(compiled);
assert.deepEqual(shelf.store(compiled), stored);
assert.equal(shelf.list().filter((item) => item.id === copy.id).length, 1);
assert.equal(shelf.draft(copy.id), undefined);
const changed = structuredClone(compiled);
changed.sealed.board.room.mirror.aperture = 1;
assert.throws(() => shelf.store(changed), /already sealed/);
assert.equal(JSON.stringify(shelf.publicCase(originalRef)), original);
assert(Object.isFrozen(shelf.publicCase(stored).board.room));
assert(!JSON.stringify(shelf.list()).includes("casting"));
assert.equal(shelf.reveal(stored), undefined);
const firstClue = shelf.publicCase(stored).clues.clues[0].id;
assert(shelf.saveAttempt({caseId: stored.id, rev: stored.rev, tick: 12, source: 'entrance', ids: [firstClue], claim: 'Underdetermined'}));
assert(!shelf.saveAttempt({caseId: stored.id, rev: stored.rev + 1, tick: 12, source: 'entrance', ids: [firstClue], claim: 'Underdetermined'}));
const savedAttempt = shelf.attempt(stored);
savedAttempt.ids.length = 0;
assert.equal(shelf.attempt(stored).ids.length, 1);

let author,
  publicCase,
  reveals = 0,
  clears = 0;
const ports = {
  createAuthor(draft, checkpoint) {
    return (author = new AuthorSession(draft, checkpoint));
  },
  mountAuthor() {
    return {
      detach() {
        clears++;
      },
    };
  },
  mountDetective(sealed) {
    publicCase = sealed;
    return {
      detach() {
        clears++;
      },
    };
  },
  reveal(vault) {
    reveals++;
    assert(vault.actualHistory);
    return {
      detach() {
        clears++;
      },
    };
  },
  closeLid() {},
  openLid() {},
  cancelInput() {},
  show() {},
};
const flow = new CaseFlow(ports, shelf);
assert(flow.selectSavedCase(stored.id, stored.rev));
assert(flow.replayAlarm());
assert(!flow.revealTheft(stored.id, stored.rev));
const verdict = prove(
  publicCase.board,
  publicCase.clues,
  [],
  "Underdetermined",
);
assert.equal(verdict.status, "ambiguous");
assert(flow.markSolved());
assert(!flow.revealTheft(stored.id, stored.rev + 1));
assert(flow.revealTheft(stored.id, stored.rev));
assert.equal(reveals, 1);
assert(flow.editThisCase());
assert.notEqual(author.getDraft().id, stored.id);
assert.equal(author.getDraft().room.mirror.aperture, 0);
assert(flow.leaveAuthor());
const draftId = author.getDraft().id;
assert(flow.resumeSavedDraft(draftId));
assert(flow.leaveAuthor());

// A fresh role root in the same Preview session resumes the selected closed case.
flow.dispose();
const restored = new CaseFlow(ports, shelf);
assert.equal(restored.snapshot().caseId, stored.id);
assert(restored.selectCase("packing-room"));
assert(restored.replayAlarm());
assert(!restored.resumeSavedDraft(draftId));
assert(restored.markSolved());
assert(restored.keepThisRoom());
assert.equal(author.getDraft().events.length, 0);
assert.equal(author.getDraft().room.boxes.length, 2);
assert(author.getDraft().tracks.every((t) => t.keys.length === 2));
assert(restored.leaveAuthor());
assert(restored.emptyRoom());
const empty = author.getDraft();
assert.equal(empty.room.walls.length, 0);
assert.equal(empty.room.mirror, undefined);
assert.equal(empty.witnesses.length, 0);
assert.equal(empty.events.length, 0);
assert(!restored.passCase());
assert.equal(restored.snapshot().mode, "author");
assert.equal(JSON.stringify(shelf.publicCase(originalRef)), original);
assert(clears >= 6);
restored.dispose();
