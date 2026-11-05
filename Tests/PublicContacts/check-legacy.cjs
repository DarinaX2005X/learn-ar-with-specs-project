const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{D,load,root}=require('./load.cjs')();
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'saved-legacy-tapes.json'),'utf8')), {SessionShelf}=load(path.join(root,'Shelf/SessionShelf.ts')),{CaseFlow}=load(path.join(root,'Cases/CaseFlow.ts')),{AuthorSession}=load(path.join(root,'Author/AuthorSession.ts'));
const outputs=[];
for(const saved of fixtures){const {result}=saved,{board,clues:tape}=result.sealed;
 assert.equal(JSON.stringify(D.observe(board,result.vault.actualHistory,true)),JSON.stringify(tape),'v1 projection serialized equality of every authentic saved frame');
 for(const [scope,ids] of [['full',tape.clues.map(c=>c.id)],['selected',saved.ids],['derived',saved.derivedIds]]){
  const v=D.prove(board,tape,ids,saved.claim,{minimizeReasons:false}),expected=saved[scope];assert.equal(v.status,expected.status,saved.name+scope);assert.equal(v.historyCount,expected.count,saved.name+scope);assert.deepEqual(v.fieldValues,expected.fields,saved.name+scope);
 }
 const shelf=new SessionShelf(),ref=shelf.store(result);let mounted,author;const flow=new CaseFlow({createAuthor:(draft,checkpoint)=>author=new AuthorSession(draft,checkpoint),mountAuthor:()=>({detach(){}}),mountDetective:sealed=>{mounted=sealed;return {detach(){}};},cancelInput(){},closeLid(){},openLid(){},show(){}},shelf);
 assert(flow.selectSavedCase(ref.id,ref.rev));assert(flow.replayAlarm());assert(mounted.clues.clues.filter(c=>c.kind==='Frame').every(c=>c.payload.palms===undefined),'opening old seal preserves v1 data');
 assert.equal(D.prove(mounted.board,mounted.clues,saved.ids,saved.claim,{minimizeReasons:false}).historyCount,saved.selected.count);
 assert(flow.finishAttempt(true));assert(flow.stageTheft());const original=JSON.stringify(shelf.publicCase(ref));assert(author.startTest());let steps=0;while(author.snapshot().testing&&++steps<10000)author.advanceProof(32);assert(!author.snapshot().testing);if(author.snapshot().needsAmbiguityConfirmation)assert(author.confirmAmbiguity());assert(flow.passCase());assert(flow.openCase());assert(mounted.clues.clues.filter(c=>c.kind==='Frame').every(c=>Array.isArray(c.payload.palms)),'new fork compiles v2 observations');assert.equal(JSON.stringify(shelf.publicCase(ref)),original,'fork/open never rewrites old seal');
 flow.dispose();outputs.push({name:saved.name,legacyFull:saved.full.count,legacySelected:saved.selected.count,legacyDerived:saved.derived.count,forkNewRecorder:true});
}
console.log('PASS authentic saved v1 full/selected/derived proof and shelf open/fork/seal/open; original seals unchanged');console.log(JSON.stringify(outputs,null,2));
