const path=require('path'),assert=require('node:assert/strict');const {D,root,load}=require('./load.cjs')();
const compile=d=>{const r=D.compileCase(d);assert(r.ok,JSON.stringify(r.errors));return r;};
const result=compile(D.createPackingCase({rearCamera:true})),{board,clues:tape}=result.sealed,h=result.vault.actualHistory;
const sample=D.sampleContactPose(board,h,15),contact=sample.contacts.find(e=>e.kind==='Pass').position,w=board.witnesses.find(w=>w.id==='passage');
const giver=sample.positions.get(h.pass.from),receiver=sample.positions.get(h.pass.to);
assert.equal(contact.x,(giver.x+receiver.x)/2);assert.equal(contact.z,(giver.z+receiver.z)/2);
assert.equal(contact.y,Math.min(giver.y,receiver.y)-.25);
const original=D.frameAt(tape,'passage',15),pass=original.payload.actions.find(a=>a.kind==='Pass');assert(pass);assert.deepEqual(pass.contacts,[contact]);
const passView=D.getObservations(tape,'passage',15).find(v=>v.observation.kind==='action'&&v.payload.actions[0].kind==='Pass'),legacyPass=JSON.parse(JSON.stringify(passView));
for(const action of legacyPass.payload.actions){delete action.contacts;delete action.via;delete action.projection;delete action.surfaceRight;}
assert(D.matchesObservation(legacyPass,original),'legacy positive action may match a newly verified visible contact');
assert.equal(original.payload.palms.filter(p=>D.distance(p.position,contact)<.06).length,0,'coincident donor/receiver palms do not invent ownership/full-vs-empty');
const draft=D.createPackingCase({rearCamera:true});const screenX=(w.position.x+contact.x)/2,screenZ=(w.position.z+contact.z)/2;
draft.room.walls.push({id:'wrist-screen',a:{x:screenX,y:0,z:screenZ-.25},b:{x:screenX,y:0,z:screenZ+.25},bottom:.8,top:.9});
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
// The witness camera and both 3D reconstructions must sample the same
// carried object and grip over fractional time, including backward seeks.
const spatial=load(path.join(root,'Spatial/Reconstruction.ts'));
for(let i=0;i<=240;i++){
 const t=i/10,expected=spatial.renderHistory(board,h,t),actual=D.sampleContactPose(board,h,t);
 assert.deepEqual(expected.ruby.positionCm,[actual.ruby.x*100,actual.ruby.y*100,actual.ruby.z*100]);
 for(const hand of expected.hands){
  const p=actual.hands.get(hand.track);
  assert.deepEqual(hand.handCm,[p.x*100,p.y*100,p.z*100]);
  assert.deepEqual(hand.articulation,actual.articulation.get(hand.track));
 }
}
assert.throws(()=>D.sampleContactPose(board,h,NaN));
console.log('PASS real contact/palm visibility, hidden wrist gap, no coincident-ownership guess, explicit empty/full, stable IDs, no private participants, legacy slice and fractional Spatial parity');

for(const rearCamera of [false,true])for(const canvas of [false,true])for(const recipient of ['B','C']){
 const caseResult=compile(D.createPackingCase({rearCamera,canvas,recipient})),b=caseResult.sealed.board,t=caseResult.sealed.clues,actual=caseResult.vault.actualHistory;
 const at=D.sampleContactPose(b,actual,actual.pass.tick),event=at.contacts.find(c=>c.kind==='Pass'),a=at.positions.get(actual.pass.from),z=at.positions.get(actual.pass.to);
 assert(D.distance(a,z)>=.64,'authored bodies remain physically separated at transfer');
 assert(D.distance(at.hands.get(actual.pass.from),at.hands.get(actual.pass.to))<1e-10,'both hands share actual transfer target');
 assert.equal(event.position.x,(a.x+z.x)/2);assert.equal(event.position.z,(a.z+z.z)/2);
 const entry=D.frameAt(t,'entrance',actual.pass.tick);assert(!entry.payload.actions.some(a=>a.kind==='Pass'),'partition genuinely hides ordinary transfer');
 if(rearCamera){const f=D.frameAt(t,'passage',actual.pass.tick);const action=f.payload.actions.find(a=>a.kind==='Pass');assert(action,'rear witness sees literal contact');assert.deepEqual(action.contacts,[event.position]);}
 for(const frame of t.clues.filter(c=>c.kind==='Frame'))for(const action of frame.payload.actions){
  const witness=b.witnesses.find(w=>w.id===frame.witness);
  for(const point of action.contacts??[])assert(D.sight(b,witness,point,action.via),'no through-wall public contact');
 }
 for(let i=0;i<=240;i++){const tick=i/10,pose=D.sampleContactPose(b,actual,tick),render=spatial.renderHistory(b,actual,tick);assert.deepEqual(render.ruby.positionCm,[pose.ruby.x*100,pose.ruby.y*100,pose.ruby.z*100]);}
}
console.log('PASS all8 authored Packing variants: separated handover, exact physical shared target, ordinary hidden/rear visible, no through-wall contact, fractional Spatial agreement');
