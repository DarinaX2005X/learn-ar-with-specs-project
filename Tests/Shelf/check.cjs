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
assert.equal(shelf.draft(copy.id).draft.title, copy.title.trim());
assert(
  shelf
    .list()
    .some((item) => item.state === "Draft" && item.spine.includes("…")),
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

// Full public names survive storage, compilation and opening; spines alone shorten.
const names = new SessionShelf();
const longName = "The Packing Room and the missing ruby before the west gallery alarm";
const named = names.fork(originalRef);named.title = "  " + longName + "  ";
names.saveDraft(named);
const resumed = names.draft(named.id).draft;
assert.equal(resumed.title, longName);
const namedCompile = compileCase(resumed);assert(namedCompile.ok);
const namedRef = names.store(namedCompile);
assert.equal(names.caseTitle(namedRef), longName);
const namedFlow = new CaseFlow(ports, names);assert(namedFlow.selectSavedCase(namedRef.id,namedRef.rev));
assert.equal(namedFlow.snapshot().title,longName);assert(namedFlow.replayAlarm());
assert.equal(namedFlow.snapshot().title,longName);namedFlow.dispose();
const a = names.fork(namedRef);names.saveDraft(a);const b = names.fork(namedRef);names.saveDraft(b);
assert.notEqual(a.title,b.title);assert(a.title.startsWith(longName));assert(b.title.startsWith(longName));
const aa=names.list().find(x=>x.id===a.id),bb=names.list().find(x=>x.id===b.id);
assert.notEqual(aa.spine,bb.spine);assert.equal(aa.state,"Draft");assert.equal(names.list().find(x=>x.id===namedRef.id).state,"Ready to open");
assert(Array.from(aa.spine).length<=28);assert(aa.spine.endsWith(a.title.slice(-8)));
assert.equal(AuthorSession.createCopy(resumed,"author-copy").getDraft().title,longName+" Copy");
const limit={...resumed,id:"limit",title:"L".repeat(160)};assert(compileCase(limit).ok);
const tooLong={...limit,id:"over-limit",title:"L".repeat(161)};names.saveDraft(tooLong);
const rejected=compileCase(names.draft(tooLong.id).draft);assert.equal(rejected.ok,false);
assert(rejected.errors.some(e=>e.message.includes("1–160")));assert.equal(names.draft(tooLong.id).draft.title,tooLong.title);
const blank={...resumed,id:"blank",title:" \n\t "};names.saveDraft(blank);
assert.equal(names.draft(blank.id).draft.title,"Untitled case");assert.equal(new AuthorSession(blank).getDraft().title,"Untitled case");
assert(!JSON.stringify(names.list()).includes("casting"));assert(!JSON.stringify(namedFlow.snapshot()).includes("actualHistory"));
console.log("Full shelf titles, numbered copies, explicit limit, public opening and blank fallback passed");

// Generated labels reserve their suffix inside the SAME compiler UTF16 budget.
const {CASE_TITLE_MAX_UNITS}=require(path.join(root,"Domain/types.js"));
const valid160="😀".repeat(79)+"AB";assert.equal(valid160.length,CASE_TITLE_MAX_UNITS);
const generatedShelf=new SessionShelf();const sourceDraft=generatedShelf.fork(originalRef);sourceDraft.title=valid160;
const sourceCompiled=compileCase(sourceDraft);assert(sourceCompiled.ok);let generatedRef=generatedShelf.store(sourceCompiled);
assert.equal(generatedShelf.caseTitle(generatedRef),valid160);
const wellFormed=value=>{for(let i=0;i<value.length;i++){const unit=value.charCodeAt(i);if(unit>=0xD800&&unit<=0xDBFF){assert(i+1<value.length);const next=value.charCodeAt(++i);assert(next>=0xDC00&&next<=0xDFFF);}else assert(!(unit>=0xDC00&&unit<=0xDFFF));}};
const generatedNames=new Set();
for(let index=0;index<12;index++){
 const forked=generatedShelf.fork(generatedRef);assert(forked.title.length<=CASE_TITLE_MAX_UNITS);wellFormed(forked.title);assert(!generatedNames.has(forked.title));generatedNames.add(forked.title);assert(!/Copy(?: \d+)? Copy/.test(forked.title));
 const next=compileCase(forked);assert(next.ok);generatedRef=generatedShelf.store(next);
 const room=generatedShelf.keepRoom(generatedRef);assert(room.title.length<=CASE_TITLE_MAX_UNITS);wellFormed(room.title);const checkedRoom=compileCase(room);assert.equal(checkedRoom.ok,false);assert(!checkedRoom.errors.some(e=>e.code==="CASE_ID"),"intentional empty-cast/event errors, never an unfixable generated title");
}
assert.equal(generatedShelf.caseTitle({id:sourceDraft.id,rev:sourceDraft.rev}),valid160,"frozen original user name unchanged");
const authorGenerated=AuthorSession.createCopy({...sourceDraft,title:valid160},"unicode-author-copy").getDraft();assert(authorGenerated.title.length<=CASE_TITLE_MAX_UNITS);wellFormed(authorGenerated.title);assert(compileCase(authorGenerated).ok);
console.log("Generated160unit nonBMP copy/room/repeated labels remain wellformed, distinct, compile-bounded and source preserving");
