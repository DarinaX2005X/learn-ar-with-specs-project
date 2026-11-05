const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'../typescript/lib/typescript.js')));
assert(bin,'Run using npm exec --package=typescript@6.0.2 -- node');
const ts=require(path.resolve(bin,'../typescript/lib/typescript.js')),cache=new Map(),assets=path.resolve(__dirname,'../../Assets');
class MeshBuilder{appendVerticesInterleaved(v){this.vertices=v;}appendIndices(v){this.indices=v;}updateMesh(){}getMesh(){return this;}}
const material=()=>({mainPass:{},clone:material});
const meshes=[];const scene={createSceneObject(name){const object={name,setParent(parent){this.parent=parent;},createComponent(){return this.visual={};},destroy(){this.destroyed=true;}};meshes.push(object);return object;}};
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;vm.runInNewContext(js,{module,exports:module.exports,require:p=>load(path.resolve(path.dirname(file),p+'.ts')),MeshBuilder,MeshTopology:{Triangles:0},MeshIndexType:{UInt16:0},global:{scene},vec4:class{constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}}},{filename:file});return module.exports;}
const D=load(path.join(assets,'Domain/index.ts')),C=load(path.join(assets,'Domain/cases.ts')),R=load(path.join(assets,'Runtime/RecordedGlass.ts'));
const compiled=D.compileCase(C.createMuseumTheft(true));assert.equal(compiled.ok,true);const board=compiled.sealed.board;
const frame=compiled.sealed.clues.clues.find(c=>c.kind==='Frame'&&c.tick===12);assert(frame&&frame.payload.fragments.length>=2);
const workshop=new R.RecordedGlass({name:'PublicRecordedGlass'},material(),true),entry=new R.RecordedGlass({name:'EntryRecordedGlass'},material());
workshop.render(board,frame,true);entry.render(board,frame,true);
assert.equal(JSON.stringify(workshop.surfaces),JSON.stringify(entry.surfaces));
const surfaces=workshop.surfaces.filter(s=>s.kind === "fragment");assert.equal(surfaces.length,frame.payload.fragments.length);
for(const surface of surfaces){assert(surface.centerCm[0]-surface.widthCm/2>=-16.000001);assert(surface.centerCm[0]+surface.widthCm/2<=16.000001);assert(surface.centerCm[1]-surface.heightCm/2>=-8.000001);assert(surface.centerCm[1]+surface.heightCm/2<=8.000001);}
const direct=surfaces.find(s=>s.via==='direct'),mirror=surfaces.find(s=>s.via==='mirror');assert(direct&&mirror);assert(direct.centerCm[0]-direct.widthCm/2>mirror.centerCm[0]+mirror.widthCm/2,'Distinct observed marks remain distinguishable in their original left/right order');
const rendered=meshes.filter(o=>!o.destroyed&&o.visual?.mesh);
let reversed=0,positive=0;
for(const object of rendered){const m=object.visual.mesh,v=m.vertices;for(let i=0;i<m.indices.length;i+=3){const [ia,ib,ic]=m.indices.slice(i,i+3).map(x=>x*8);const cross=(v[ib]-v[ia])*(v[ic+1]-v[ia+1])-(v[ib+1]-v[ia+1])*(v[ic]-v[ia]);if(cross<-.00000001)reversed++;else positive++;}}
assert.equal(reversed,0,'All emitted triangles face pane +Z after reflected projection');assert(positive>0);
assert(rendered.some(o=>o.name.endsWith('_hat')));assert(rendered.some(o=>o.name.endsWith('_eyes')));assert(rendered.some(o=>o.name.endsWith('_features')));
assert(rendered.every(o=>o.visual.mainMaterial.mainPass.twoSided===true));
console.log('Projected surfaces',JSON.stringify(surfaces));console.log('PASS coloured public patches, '+positive+' front-facing triangles, two-sided physical pane');
assert.equal(R.recordedPaneViews().length,2);
const originalFaceColors=rendered.filter(o=>o.name.endsWith('_Face')).map(o=>JSON.stringify(o.visual.mainMaterial.mainPass.baseColor));workshop.select(mirror.segment,mirror.via);assert.equal(JSON.stringify(rendered.filter(o=>o.name.endsWith('_Face')).map(o=>JSON.stringify(o.visual.mainMaterial.mainPass.baseColor))),JSON.stringify(originalFaceColors),'Selection never whitens recorded faces');assert.equal(workshop.surfaces.filter(s=>s.kind === "fragment").length,2,'Selection alone never moves a fragment into a badge');
assert.equal(R.toggleRecordingDetail('PublicRecordedGlass'),true);assert.equal(workshop.surfaces.length,1);assert.equal(workshop.surfaces[0].segment,mirror.segment);assert(workshop.surfaces[0].heightCm>mirror.heightCm*4);assert.equal(entry.surfaces.filter(s=>s.kind === "fragment").length,2,'Common entry image remains available to choose other marks');
assert.equal(R.toggleRecordingDetail('PublicRecordedGlass'),false);assert.equal(workshop.surfaces.filter(s=>s.kind === "fragment").length,2);assert.equal(JSON.stringify(workshop.surfaces),JSON.stringify(entry.surfaces));
const S=load(path.join(assets,'Scripts/TableKit/RoleSilhouette.ts'));let oldClockwise=0;for(const fragment of frame.payload.fragments)for(const tri of D.projectVisibleSurface(board,frame.witness,fragment,S.roleSilhouette(fragment.role))){const p=tri.map(q=>[Math.tan(q.horizontal),Math.tan(q.vertical)*Math.sqrt(1+Math.tan(q.horizontal)**2)]);const [a,b,c]=p;if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])<0&&fragment.via==='mirror')oldClockwise++;}assert(oldClockwise>0);console.log('CONFIRMED original reflected triangles clockwise:',oldClockwise);
console.log('PASS explicit true optical detail toggle and local return preserve both public marks/evidence');
const anonymous=JSON.parse(JSON.stringify(frame));for(const f of anonymous.payload.fragments)delete f.role;workshop.render(board,anonymous,true);assert.equal(workshop.renderedRoles.length,0);const neutral=meshes.filter(o=>!o.destroyed&&o.parent?.name==='PublicRecordedGlass');assert(neutral.every(o=>!/_hat$|_eyes$|_features$/.test(o.name)),'Unrecognized marks receive no role art patches');console.log('PASS unknown marks stay neutral; selection retains recorded face colors');workshop.clear();entry.clear();assert(R.recordedPaneViews().every(p=>p.surfaces.length===0));
console.log('PASS actual public clipped polygons: shared projection, synchronous two panes, bounded magnification, separate direct/reflected marks, clear on role exit');






workshop.dispose();entry.dispose();assert.equal(R.recordedPaneViews().length,0);workshop.render(board,frame,true);assert.equal(workshop.surfaces.length,0);console.log('PASS disposal unregisters panes and rejects late render');


const oldPane=new R.RecordedGlass({name:'RestartPane'},material()),replacement=new R.RecordedGlass({name:'RestartPane'},material());oldPane.dispose();assert.equal(R.recordedPaneViews().length,1);replacement.dispose();assert.equal(R.recordedPaneViews().length,0);console.log('PASS old-root disposal preserves replacement pane registry');


const closedCompiled=D.compileCase(C.createMuseumTheft(false));assert.equal(closedCompiled.ok,true);const closedFrame=closedCompiled.sealed.clues.clues.find(c=>c.kind==='Frame'&&c.tick===12);
const openGlass=new R.RecordedGlass({name:'StableOpen'},material()),closedGlass=new R.RecordedGlass({name:'StableClosed'},material());openGlass.render(board,frame,true);closedGlass.render(closedCompiled.sealed.board,closedFrame,true);
const courierOpen=openGlass.surfaces.find(s=>s.kind === "fragment" && s.via==='direct'),courierClosed=closedGlass.surfaces.find(s=>s.kind === "fragment" && s.via==='direct');const geometry=({observationId,...surface})=>surface;assert.equal(JSON.stringify(geometry(courierOpen)),JSON.stringify(geometry(courierClosed)),'Curtain never recenters/resizes Courier in the same camera');assert.notEqual(courierOpen.observationId,courierClosed.observationId,'Different revisions retain distinct evidence IDs');assert(openGlass.surfaces.some(s=>s.via==='mirror'));assert(!closedGlass.surfaces.some(s=>s.via==='mirror'));
const O=load(path.join(assets,'Runtime/MuseumScene/RecordedOptics.ts'));const fixed=O.stableRecordingOptics(board,frame.witness);for(const tick of Array.from({length:25},(_,tick)=>tick)){const nextFrame=compiled.sealed.clues.clues.find(c=>c.kind==='Frame'&&c.tick===tick);openGlass.render(board,nextFrame,true);assert.equal(JSON.stringify(O.stableRecordingOptics(board,frame.witness)),JSON.stringify(fixed));for(const s of openGlass.surfaces){assert(s.centerCm[0]-s.widthCm/2>=-16.000001);assert(s.centerCm[0]+s.widthCm/2<=16.000001);assert(s.centerCm[1]-s.heightCm/2>=-8.000001);assert(s.centerCm[1]+s.heightCm/2<=8.000001);}}
console.log('PASS FIXED crop open/closed Courier exactsamebounds; Guard visible/absent; calibration invariant over all playback samples',JSON.stringify(fixed));
const present=meshes.filter(o=>!o.destroyed&&o.parent?.name==='StableOpen');assert(present.some(o=>o.name.includes('Torso_')),'Static clipped collar and upper trunk are actually drawn');assert(present.some(o=>o.name.startsWith('RecordedRoom_')),'Authentic public static room is actually drawn');for(const surface of openGlass.surfaces) assert(D.getObservations(compiled.sealed.clues,frame.witness,24).some(item=>item.id===surface.observationId),'Every physical target belongs to the exact current public frame');openGlass.dispose();closedGlass.dispose();
console.log('PASS authentic static room/collars and only current public observations selectable');

// Physical pane clipping must constrain emitted ink as well as selectable bounds.
const Contacts=load(path.join(assets,'Runtime/MuseumGame/ObservationContacts.ts'));
const sweepCases=[C.createMuseumTheft(true),C.createMuseumTheft(false)];
for(const rearCamera of [false,true])for(const recipient of ['B','C'])for(const canvas of [false,true])sweepCases.push(C.createPackingCase({rearCamera,recipient,canvas}));
let auditedFrames=0,auditedSurfaces=0,auditedVertices=0;
function inside(value,limit){assert(Number.isFinite(value));assert(value>=-limit-.000001&&value<=limit+.000001,'Ink vertex outside physical glass '+value+' / '+limit);}
for(const draft of sweepCases){
 const result=D.compileCase(draft);assert(result.ok);
 const {board,clues:tape}=result.sealed;
 const root={name:'PaneClipAudit'};
 const glass=new R.RecordedGlass(root,material(),true);
 for(const current of tape.clues.filter(clue=>clue.kind==='Frame')){
  glass.render(board,current,true);auditedFrames++;
  const views=D.getObservations(tape,current.witness,current.tick);
  for(const surface of glass.surfaces){
   inside(surface.centerCm[0]-surface.widthCm/2,16);inside(surface.centerCm[0]+surface.widthCm/2,16);
   inside(surface.centerCm[1]-surface.heightCm/2,8);inside(surface.centerCm[1]+surface.heightCm/2,8);
   assert(surface.widthCm>0&&surface.heightCm>0);assert(views.some(view=>view.id===surface.observationId));auditedSurfaces++;
  }
  // Accessibility padding/minimum extent stays on the real35x19cm glass backing.
  for(const contact of Contacts.observationContacts(glass.surfaces,views)){
   inside(contact.centerCm[0]-contact.widthCm/2,17.5);inside(contact.centerCm[0]+contact.widthCm/2,17.5);
   inside(contact.centerCm[1]-contact.heightCm/2,9.5);inside(contact.centerCm[1]+contact.heightCm/2,9.5);
  }
  for(const object of meshes.filter(item=>!item.destroyed&&item.parent===root&&item.visual?.mesh)){
   const evidence=object.name.startsWith('RecordedFragment_');
   const vertices=object.visual.mesh.vertices;
   for(let index=0;index<vertices.length;index+=8){inside(vertices[index],evidence?16:17.5);inside(vertices[index+1],evidence?8:9.5);if(evidence)auditedVertices++;}
  }
 }
 glass.dispose();
}
console.log('PASS actual emitted heads, contours, torso and contact ink clipped to unchanged32x16cm pane; padded/minimum input stays35x19cm backing',{auditedFrames,auditedSurfaces,auditedVertices});

// Deliberately cross every pane edge: partial ink survives, off-pane ink has no target.
const probeRoot={name:'PaneEdgeProbe'},probeGlass=new R.RecordedGlass(probeRoot,material(),true);
const probeWitness=board.witnesses.find(w=>w.id===frame.witness),probeOptics=O.stableRecordingOptics(board,frame.witness);
const right={x:Math.cos(probeWitness.yaw),y:0,z:-Math.sin(probeWitness.yaw)};
for(const [edge,px,py] of [['left',-15.9,0],['right',15.9,0],['bottom',0,-7.9],['top',0,7.9],['outside',24,0]]){
 const depth=.5,x=probeOptics.centerX+px/probeOptics.gain,y=probeOptics.centerY+py/probeOptics.gain;
 const position={x:probeWitness.position.x+depth*(Math.sin(probeWitness.yaw)+right.x*x),y:probeWitness.position.y+depth*y,z:probeWitness.position.z+depth*(Math.cos(probeWitness.yaw)+right.z*x)};
 const palm={position,surfaceRight:right,projection:D.project(probeWitness,position),via:'direct',segment:'edge-'+edge,present:false};
 const current={...frame,payload:{fragments:[],hands:[],actions:[],palms:[palm]}};
 probeGlass.render(board,current,true);
 if(edge==='outside'){assert.equal(probeGlass.surfaces.length,0);assert(!meshes.some(item=>!item.destroyed&&item.parent===probeRoot&&item.name.startsWith('RecordedFragment_')));continue;}
 assert.equal(probeGlass.surfaces.length,1,'A partly visible palm remains selectable at '+edge);
 const probeTape={...compiled.sealed.clues,clues:[current]};
 for(const target of Contacts.observationContacts(probeGlass.surfaces,D.getObservations(probeTape,current.witness,current.tick))){
  assert(target.widthCm>=2&&target.heightCm>=3);
  inside(target.centerCm[0]-target.widthCm/2,17.5);inside(target.centerCm[0]+target.widthCm/2,17.5);
  inside(target.centerCm[1]-target.heightCm/2,9.5);inside(target.centerCm[1]+target.heightCm/2,9.5);
 }
 const surface=probeGlass.surfaces[0];
 const value=edge==='left'?surface.centerCm[0]-surface.widthCm/2:edge==='right'?surface.centerCm[0]+surface.widthCm/2:edge==='bottom'?surface.centerCm[1]-surface.heightCm/2:surface.centerCm[1]+surface.heightCm/2;
 assert(Math.abs(value-({left:-16,right:16,bottom:-8,top:8})[edge])<1e-6,'Actual edge intersection retained at '+edge);
 for(const item of meshes.filter(item=>!item.destroyed&&item.parent===probeRoot&&item.name.startsWith('RecordedFragment_'))){const v=item.visual.mesh.vertices;for(let i=0;i<v.length;i+=8){inside(v[i],16);inside(v[i+1],8);}}
}
probeGlass.dispose();console.log('PASS four exact partial-edge intersections preserve ink/selection and a wholly off-pane palm emits neither');
