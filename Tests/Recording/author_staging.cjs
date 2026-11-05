const fs=require('fs'),path=require('path'),vm=require('vm'),a=require('node:assert/strict');const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'../typescript/lib/typescript.js')));a(bin);const ts=require(path.resolve(bin,'../typescript/lib/typescript.js')),assets=process.env.RECORDING_ASSETS??path.resolve(__dirname,'../../Assets'),cache=new Map();
class V{constructor(x,y,z){Object.assign(this,{x,y,z});}}class Q{static fromEulerAngles(x,y,z){return new Q();}multiplyVec3(v){return v;}multiply(q){return this;}}
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;vm.runInNewContext(js,{module,exports:module.exports,require:p=>load(path.resolve(path.dirname(file),p+'.ts')),vec3:V,quat:Q,getTime:()=>0},{filename:file});return module.exports;}
function node(name){const transform={position:new V(0,0,0),rotation:new Q(),scale:new V(1,1,1),getLocalPosition(){return this.position;},setLocalPosition(p){this.position=p;},getWorldPosition(){return this.position;},setWorldPosition(p){this.position=p;},getWorldRotation(){return this.rotation;},setLocalRotation(q){this.rotation=q;},setWorldRotation(q){this.rotation=q;},getLocalScale(){return this.scale;},setLocalScale(s){this.scale=s;},setWorldScale(s){this.scale=s;},getWorldTransform(){return{multiplyPoint:p=>p};}};return{name,enabled:true,getTransform:()=>transform,getChildrenCount:()=>0};}
const D=load(path.join(assets,'Domain/index.ts')),M=load(path.join(assets,'Runtime/MuseumScene.ts')).MuseumScene,P=load(path.join(assets,'Runtime/MuseumScene/PublicCradle.ts'));
const scene=Object.create(M.prototype),models=new Map(['DisplayCase','Ruby','Camera','MirrorHousing','Curtain','CurtainHandle'].map(name=>[name,node(name)]));
Object.assign(scene,{glassRoot:{getParent:()=>undefined},root:node('Countercase'),theatre:node('Theatre'),actors:new Map(['Courier','Guard','Conservator'].map(role=>[role,node(role)])),arms:new Map(),glass:{clear(){},render(){throw Error('Author draft is not a public camera recording');},select(){},selectObservation(){}},entryGlass:undefined,hall:{sync:()=>false,applyCaseView(){},exit(){}},paper:{render(){},clear(){},setCovered(){}},viewHandles:{render(){},clear(){}},authorGlass:{render(){},clear(){},dispose(){}},cameraCopies:new Map(),jointCache:new WeakMap(),transformCache:new WeakMap(),ruby:models.get("Ruby"),disposed:false,clockHands:[],anonymous:new Map(),frameKey:'',lidClosed:false,audio:new Map(),labelsVisible:true,covered:false,comparisonActive:false,cradle:new P.PublicCradleTransport(),mountEntryGlass(){},renderWalls(){},findGlobal:name=>name==='Anchor_ConservationBench'?node(name):undefined,find:name=>models.get(name)});
scene.rigs=new Map([...scene.actors.values()].map(actor=>[actor,{prepare(){},sample(){return{bodyYaw:0,upperBodyOffsetCm:[0,0,0]};},armBasis(p){return p;},clearRoute(){},dispose(){}}]));
scene.roleTracks=new Map();scene.fixedProps=new Map();
// Object.create bypasses the real constructor. Model only its finish ports here;
// the actual finish implementations have separate native/geometry regressions.
const finishCalls=[];
scene.liveFinish={clear(){finishCalls.push({kind:'mirror-clear'});},dispose(){finishCalls.push({kind:'mirror-dispose'});},update(input){finishCalls.push({kind:'mirror-update',input});}};
scene.facetFinish={clear(){finishCalls.push({kind:'facet-clear'});},dispose(){finishCalls.push({kind:'facet-dispose'});},update(){finishCalls.push({kind:'facet-update'});}};
scene.readCaseViewViewer=()=>({eyeCm:[0,165,0],forward:[0,0,1]});
scene.walls=[];scene.glassRoot.destroy=()=>{};
scene.hall.dispose=()=>{};scene.paper.dispose=()=>{};scene.viewHandles.dispose=()=>{};scene.glass.dispose=()=>{};
const draft=D.createMuseumTheft(true);draft.events=[];draft.room.mirror=undefined;const originalAlarm=draft.alarmTick;
a.equal(scene.draftHistory(draft),undefined,'No manufactured take or taker in incomplete draft');
for(const tick of [0,8,12,24]){scene.render({flow:{mode:'author'},author:{draft,tick,playing:false}});a.equal(models.get('Ruby').enabled,true);a.equal(models.get('DisplayCase').enabled,true);a.equal(models.get('Camera').enabled,true);a.equal(models.get('Ruby').getTransform().position.y,draft.room.exhibit.position.y*6);a.equal(draft.alarmTick,originalAlarm);}
const empty=JSON.parse(JSON.stringify(draft));empty.room.exhibit.position={x:-1,y:1,z:-1};empty.witnesses=[];empty.tracks=[];scene.render({flow:{mode:'author'},author:{draft:empty,tick:24,playing:false}});a.equal(models.get('DisplayCase').enabled,false);a.equal(models.get('Ruby').enabled,false);a.equal(models.get('Camera').enabled,false);a.equal(models.get('MirrorHousing').enabled,false);a([...scene.actors.values()].every(n=>!n.enabled));
scene.updateNativeFinish(undefined,false,true);
a.equal(finishCalls.filter(call=>call.kind==='mirror-update').at(-1).input.authorized,true);
scene.render({flow:{mode:'handoff'},author:{draft,tick:12,playing:false}});a([...scene.actors.values()].every(n=>!n.enabled));a.equal(models.get('Ruby').enabled,false);a.equal(scene.poseCache.authorCasting,undefined,'Late author data cannot remain in handoff pose cache');
scene.updateNativeFinish(undefined,false,true);
const publicFinish=finishCalls.filter(call=>call.kind==='mirror-update').at(-1).input;
a.equal(publicFinish.authorized,false);a.equal(publicFinish.mode,'public');
a.equal(publicFinish.actors.length,0);a.equal(publicFinish.props.length,0);
a(finishCalls.some(call=>call.kind==='mirror-clear'),'Role exit clears retained mirror geometry');
console.log('PASS actual MuseumScene author no-Take restposes/gem alltimes, no alarm mutation, unset case/camera/mirror hidden, no ghost figures, handoff author-data gate');

scene.comparisonRoot={set enabled(value){throw Error('Destroyed comparison root touched');}};
scene.hall.exit=()=>{};scene.viewHandles.setQualification=()=>{};
scene.applyCaseView=()=>a.equal(scene.comparisonRoot,undefined,'Comparison cache cleared before return-view cover writes');
scene.clear();a.equal(scene.comparisonRoot,undefined);
console.log('PASS clear drops native comparison root cache before hall destruction/cover restoration');

a.equal(scene.finishMirrorMode,'public');
a(finishCalls.some(call=>call.kind==='facet-clear'));a(finishCalls.some(call=>call.kind==='mirror-clear'));
scene.dispose();scene.dispose();
a.equal(finishCalls.filter(call=>call.kind==='facet-dispose').length,1);
a.equal(finishCalls.filter(call=>call.kind==='mirror-dispose').length,1);
console.log('PASS real finish boundary denies actors/props after role exit; clear resets both effects and disposal is once');
