const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'../typescript/lib/typescript.js')));
assert(bin,'Run using npm exec --package=typescript@6.0.2 -- node');
const ts=require(path.resolve(bin,'../typescript/lib/typescript.js')),cache=new Map(),assets=process.env.ACTOR_ASSETS??path.resolve(__dirname,'../../Assets');
class MeshBuilder{appendVerticesInterleaved(v){this.vertices=v;}appendIndices(v){this.indices=v;}updateMesh(){}getMesh(){return this;}}
const material=()=>({mainPass:{},clone:material});
const meshes=[];const scene={createSceneObject(name){const object={name,setParent(parent){this.parent=parent;},createComponent(){return this.visual={};},destroy(){this.destroyed=true;}};meshes.push(object);return object;}};
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;vm.runInNewContext(js,{module,exports:module.exports,require:p=>load(path.resolve(path.dirname(file),p+'.ts')),MeshBuilder,MeshTopology:{Triangles:0},MeshIndexType:{UInt16:0},global:{scene},vec4:class{constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}}},{filename:file});return module.exports;}

const D=load(path.join(assets,'Domain/index.ts')),R=load(path.join(assets,'Runtime/RecordedGlass.ts'));
const compiled=D.compileCase(D.createMuseumTheft(true));assert(compiled.ok);const {board,clues}=compiled.sealed,frame=D.frameAt(clues,board.witnesses[0].id,12);
const workshop=new R.RecordedGlass({name:'PublicRecordedGlass'},material(),true),entry=new R.RecordedGlass({name:'EntryRecordedGlass'},material());
workshop.render(board,frame,true);entry.render(board,frame,true);
const direct=entry.surfaces.find(s=>s.kind==='fragment'&&s.via==='direct'),mirror=entry.surfaces.find(s=>s.kind==='fragment'&&s.via==='mirror');assert(direct&&mirror);
workshop.selectObservation(mirror.observationId);assert.equal(workshop.toggleDetail(),true);assert.equal(workshop.surfaces.length,1);assert.equal(workshop.surfaces[0].observationId,mirror.observationId);
workshop.selectObservation(direct.observationId);assert.equal(workshop.surfaces.length,1);assert.equal(workshop.surfaces[0].observationId,direct.observationId,'Selecting other entry mark immediately changes true loupe crop');
const before=JSON.stringify(workshop.surfaces);workshop.selectObservation(direct.observationId.replace('/fragment:', '/stale-fragment:'));assert.equal(JSON.stringify(workshop.surfaces),before,'Stale frame/rev/id ignored');
for(const bad of [direct.observationId.replace('observation:'+encodeURIComponent(board.caseId)+':','observation:other-case:'),direct.observationId.replace(':'+board.rev+':',':'+(board.rev+1)+':')]){workshop.selectObservation(bad);assert.equal(JSON.stringify(workshop.surfaces),before,'Other case/revision event ignored');}
const nextFrame=D.frameAt(clues,frame.witness,11),oldId=direct.observationId;workshop.render(board,nextFrame,true);const next=JSON.stringify(workshop.surfaces);workshop.selectObservation(oldId);assert.equal(JSON.stringify(workshop.surfaces),next,'Other frame event ignored');
assert.equal(workshop.toggleDetail(),false);workshop.render(board,frame,true);assert.equal(workshop.surfaces.filter(s=>s.kind==='fragment').length,2,'Return to all always available');
workshop.selectObservation(undefined);workshop.selectObservation(mirror.observationId);workshop.toggleDetail();workshop.selectObservation(undefined);assert.equal(workshop.toggleDetail(),false,'Return works even after deliberate focus clear');
workshop.dispose();entry.dispose();assert.equal(R.recordedPaneViews().length,0);console.log('PASS same-frame cross-pane selected detail switches immediately;all-mark return survives focus clear;stale case/rev/frame ignored;dispose registry0');
