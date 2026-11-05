const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {D}=require('./load.cjs')();
const results=[];
for(const [name,draft] of [['missing-open',D.createMuseumTheft(true)],['missing-closed',D.createMuseumTheft(false)],['packing-default',D.createPackingCase()],['packing-rear',D.createPackingCase({rearCamera:true})]]){
 const result=D.compileCase(draft);assert(result.ok,JSON.stringify(result.errors));
 const board=result.sealed.board,tape=result.sealed.clues,ids=tape.clues.map(c=>c.id),start=performance.now();
 const verdict=D.prove(board,tape,ids,{taker:'Conservator',...(board.chain?{recipient:'Courier',cache:'brass case'}:{})},{minimizeReasons:false});
 const ms=performance.now()-start;
 results.push({name,ms:+ms.toFixed(1),status:verdict.status,histories:verdict.historyCount,culprits:verdict.possibleCulprits,fields:verdict.fieldValues});
 if(name==='missing-open')assert.deepEqual(Array.from(verdict.possibleCulprits),['Conservator']);
 if(name==='missing-closed')assert.equal(verdict.possibleCulprits.length,2);
 if(name==='packing-default')assert.equal(verdict.fieldValues.recipient.length,2);
 if(name==='packing-rear')assert.deepEqual(Array.from(verdict.fieldValues.recipient),['Courier']);
}
console.log(JSON.stringify(results,null,2));fs.writeFileSync(path.join(__dirname,'check-results.json'),JSON.stringify(results,null,2));
