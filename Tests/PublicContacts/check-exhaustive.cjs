const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{D}=require('./load.cjs')();
const r=D.compileCase(D.createPackingCase({rearCamera:true}));assert(r.ok);const board=r.sealed.board,tape=r.sealed.clues,roles=['Courier','Guard','Conservator'],histories=[];
for(const a of roles)for(const b of roles)for(const c of roles){if(new Set([a,b,c]).size!==3)continue;for(const take of board.windows.take)for(const pass of [undefined,...board.windows.pass.filter(p=>p.from===take)])for(const stash of [undefined,...board.windows.stash.filter(s=>s.carrier===(pass?.to??take)&&s.tick>(pass?.tick??board.alarmTick))])for(const x of [-1,...board.windows.brush.A])for(const y of [-1,...board.windows.brush.B])for(const z of [-1,...board.windows.brush.C])histories.push({casting:{A:a,B:b,C:c},take,brushes:[['A',x],['B',y],['C',z]].filter(([,tick])=>tick>=0).map(([track,tick])=>({track,tick})),...(pass?{pass}:{}),...(stash?{stash}:{})});}
assert.equal(histories.length,810);const start=performance.now(),recordings=histories.map(h=>{const tape=D.observe(board,h);return {h,tape,index:new Map(tape.clues.map(c=>[c.id,c]))};}),enumerationMs=performance.now()-start;
const allViews=board.witnesses.flatMap(w=>Array.from({length:25},(_,tick)=>D.getObservations(tape,w.id,tick)).flat());
const negative=allViews.find(v=>v.observation.kind==='hand'&&!v.observation.present),positive=allViews.find(v=>v.observation.kind==='hand'&&v.observation.present),action=allViews.find(v=>v.observation.kind==='action'&&v.payload.actions[0].kind==='Pass'),exhibit=allViews.find(v=>v.observation.kind==='exhibit');assert(negative&&positive&&action&&exhibit);
const sets={full:tape.clues.map(c=>c.id),positive:[positive.id],negative:[negative.id],pass:[action.id],exhibit:[exhibit.id],mixed:[positive.id,negative.id,action.id,'box:brass case'],allDerived:allViews.map(v=>v.id).concat(['rim:plinth','box:brass case','box:canvas trunk'])};
const metrics=[];
for(const [name,ids] of Object.entries(sets)){
 const selected=ids.map(id=>D.resolveObservation(tape,id));
 const expected=recordings.filter(rec=>selected.every(clue=>D.matchesObservation(clue,rec.index.get(clue.observation?.frameId??clue.id)))).map(rec=>rec.h),started=performance.now();
 const verdict=D.prove(board,tape,ids,{taker:'Conservator',recipient:'Courier',cache:'brass case'},{minimizeReasons:false});
 const ms=performance.now()-started;assert.equal(verdict.historyCount,expected.length,name+' exact count');assert.deepEqual(verdict.possibleCulprits,[...new Set(expected.map(h=>h.casting[h.take]))].sort(),name+' takers');
 for(const field of ['taker','recipient','cache','takeTick','passTick','stashTick'])assert.deepEqual([...(verdict.fieldValues[field]??[])].sort(),[...new Set(expected.map(h=>D.answer(board,h,field)))].sort(),name+' field '+field);
 metrics.push({name,histories:expected.length,status:verdict.status,proofMs:+ms.toFixed(1)});
}
const work=D.observationWork(board);assert(work.sampleHits>0&&work.sightHits>work.sightComputations,'geometry cached across roles/histories');
const output={enumeratedHistories:histories.length,enumerationMs:+enumerationMs.toFixed(1),metrics,work};console.log(JSON.stringify(output,null,2));
