const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const {D,root,load}=require('./load.cjs')();
const compile=d=>{const r=D.compileCase(d);assert(r.ok,JSON.stringify(r.errors));return r;};
const result=compile(D.createPackingCase({rearCamera:true})),{board,clues:tape}=result.sealed,h=result.vault.actualHistory;
const sample=D.sampleContactPose(board,h,15),contact=sample.contacts.find(e=>e.kind==='Pass').position,w=board.witnesses.find(w=>w.id==='passage');
assert.deepEqual(contact,{x:4.1,y:.75,z:3.635});
const original=D.frameAt(tape,'passage',15),pass=original.payload.actions.find(a=>a.kind==='Pass');assert(pass);assert.deepEqual(pass.contacts,[contact]);
const passView=D.getObservations(tape,'passage',15).find(v=>v.observation.kind==='action'&&v.payload.actions[0].kind==='Pass'),legacyPass=JSON.parse(JSON.stringify(passView));
for(const action of legacyPass.payload.actions){delete action.contacts;delete action.via;delete action.projection;delete action.surfaceRight;}
assert(D.matchesObservation(legacyPass,original),'legacy positive action may match a newly verified visible contact');
assert.equal(original.payload.palms.filter(p=>D.distance(p.position,contact)<.06).length,0,'coincident donor/receiver palms do not invent ownership/full-vs-empty');
const draft=D.createPackingCase({rearCamera:true});draft.room.walls.push({id:'wrist-screen',a:{x:5.35,y:0,z:3.4},b:{x:5.35,y:0,z:3.9},bottom:.8,top:.9});
const blocked=compile(draft),blockedFrame=D.frameAt(blocked.sealed.clues,'passage',15);
assert(blockedFrame.payload.fragments.some(f=>f.role==='Courier'),'marker remains visible');
assert(!D.sight(blocked.sealed.board,w,contact,'direct'),'actual shared wrist/contact is occluded');
assert(!blockedFrame.payload.actions.some(a=>a.kind==='Pass'),'hidden contact cannot assert Pass');
assert(!D.matchesObservation(legacyPass,blockedFrame),'legacy action cannot bypass actual hidden-contact gate');
const courier=blockedFrame.payload.fragments.find(f=>f.role==='Courier'),views=D.getObservations(blocked.sealed.clues,'passage',15);
assert(!views.some(v=>v.observation.kind==='hand'&&v.observation.segment===courier.segment),'hidden wrist creates neither full nor empty-hand slice');
const legacyEmpty={id:'legacy-hand',kind:'Frame',witness:'passage',tick:15,payload:{fragments:[],hands:[],actions:[]},observation:{caseId:board.caseId,rev:board.rev,frameId:blockedFrame.id,kind:'hand',position:courier.position,via:courier.via,present:false}};
assert(!D.matchesObservation(legacyEmpty,blockedFrame),'legacy negative cannot infer empty from visible marker and hidden wrist');
let checkedEmpty=false,checkedFull=false;
for(const frame of tape.clues.filter(c=>c.kind==='Frame'))for(const view of D.getObservations(tape,frame.witness,frame.tick)){
 assert.equal(D.resolveObservation(tape,view.id).id,view.id);
 assert(!JSON.stringify(view.payload).includes('"track"'),'no private participant ID');
 if(view.observation.kind!=='hand')continue;
 const region=view.payload.palms[0];assert(region);assert.equal(region.present,view.observation.present);assert(D.matchesObservation(view,frame));
 const witness=board.witnesses.find(w=>w.id===frame.witness);assert(D.sight(board,witness,region.position,region.via),'every asserted palm point is visible');
 const opposite=JSON.parse(JSON.stringify(frame)),at=opposite.payload.palms.find(p=>p.segment===region.segment&&p.via===region.via);at.present=!at.present;
 assert(!D.matchesObservation(view,opposite),'actually visible full and empty remain distinguishable');
 const missing=JSON.parse(JSON.stringify(frame));missing.payload.palms=missing.payload.palms.filter(p=>p.segment!==region.segment||p.via!==region.via);assert(!D.matchesObservation(view,missing),'absence of observation does not satisfy positive/negative region assertion');
 if(region.present)checkedFull=true;else checkedEmpty=true;
}
assert(checkedEmpty&&checkedFull);
const legacyTape=JSON.parse(JSON.stringify(tape));for(const frame of legacyTape.clues)if(frame.kind==='Frame')delete frame.payload.palms;
const mixedTape=JSON.parse(JSON.stringify(tape));delete mixedTape.clues.find(c=>c.kind==='Frame').payload.palms;
const legacyVerdict=D.prove(board,mixedTape,mixedTape.clues.map(c=>c.id),'Conservator',{minimizeReasons:false});
assert.equal(legacyVerdict.status,'incomplete');assert(legacyVerdict.message.includes('mixes incompatible'));assert.equal(legacyVerdict.historyCount,0,'mixed recorder rejected before inference, never false conflict');
for(const malformed of [null,{fragments:[],hands:[],actions:[],palms:null}]){const bad=JSON.parse(JSON.stringify(tape));bad.clues.find(c=>c.kind==='Frame').payload=malformed;assert.equal(D.prove(board,bad,[],'Underdetermined',{minimizeReasons:false}).status,'incomplete');}
// Preserve the approved fractional choreography exactly, using its original
// staged implementation as independent comparison before MAIN switches Spatial.
const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'../typescript/lib/typescript.js')));const ts=require(path.resolve(bin,'../typescript/lib/typescript.js'));
const moduleOriginal={exports:{}},source=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'legacy-sampler.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
new Function('module','exports','require',source)(moduleOriginal,moduleOriginal.exports,name=>load(path.resolve(root,'Spatial',name)));
for(const t of [0,5,5.25,5.5,5.75,6,6.25,11.1,11.5,11.9,12,12.2,14.5,15,15.5,21.5,22,22.5,24]){
 const expected=moduleOriginal.exports.renderHistory(board,h,t),actual=D.sampleContactPose(board,h,t);
 assert.deepEqual(expected.ruby.positionCm,[actual.ruby.x*100,actual.ruby.y*100,actual.ruby.z*100]);
 for(const hand of expected.hands){const p=actual.hands.get(hand.track);assert.deepEqual(hand.handCm,[p.x*100,p.y*100,p.z*100]);}
}
assert.throws(()=>D.sampleContactPose(board,h,NaN));
console.log('PASS real contact/palm visibility, hidden wrist gap, no coincident-ownership guess, explicit empty/full, stable IDs, no private participants, legacy slice and fractional Spatial parity');
