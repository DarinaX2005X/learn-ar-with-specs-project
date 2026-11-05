/** Native MeshBuilder ranges are [from,to), but native rejects an empty span.
 * This exercises the actual LiveMuseumMirror class/LOD and shipped Guard GLB.
 * MIRROR_EMPTY_SPAN_CANDIDATE selects an off-Assets source for the same test. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),a=require('node:assert/strict');
const compiler=process.env.PATH.split(path.delimiter).map(p=>path.resolve(p,'../typescript/lib/typescript.js')).find(p=>fs.existsSync(p));a(compiler,'Run through npm exec TypeScript6.0.2');const ts=require(compiler);
const assets=process.env.MIRROR_AUDIT_ASSETS??path.resolve(__dirname,'../../Assets'),target=path.join(assets,'Scripts/TableKit/LiveMuseumMirror.ts');
class V{constructor(x,y,z){Object.assign(this,{x,y,z});}}
class M{
 constructor(v=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]){this.v=v;}
 mult(b){const c=Array(16).fill(0);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)c[i*4+j]+=this.v[i*4+k]*b.v[k*4+j];return new M(c);}
 multiplyPoint(p){const m=this.v;return new V(m[0]*p.x+m[1]*p.y+m[2]*p.z+m[3],m[4]*p.x+m[5]*p.y+m[6]*p.z+m[7],m[8]*p.x+m[9]*p.y+m[10]*p.z+m[11]);}
 equal(b){return this.v.every((x,i)=>x===b.v[i]);}
 inverse(){const m=this.v,A=m[0],B=m[1],C=m[2],D=m[4],E=m[5],F=m[6],G=m[8],H=m[9],I=m[10],d=A*(E*I-F*H)-B*(D*I-F*G)+C*(D*H-E*G),r=[(E*I-F*H)/d,(C*H-B*I)/d,(B*F-C*E)/d,0,(F*G-D*I)/d,(A*I-C*G)/d,(C*D-A*F)/d,0,(D*H-E*G)/d,(B*G-A*H)/d,(A*E-B*D)/d,0,0,0,0,1];for(const k of[0,4,8])r[k+3]=-(r[k]*m[3]+r[k+1]*m[7]+r[k+2]*m[11]);return new M(r);}
}
function trs(t=[0,0,0],q=[0,0,0,1],s=[1,1,1]){const[x,y,z,w]=q;return new M([(1-2*(y*y+z*z))*s[0],2*(x*y-z*w)*s[1],2*(x*z+y*w)*s[2],t[0],2*(x*y+z*w)*s[0],(1-2*(x*x+z*z))*s[1],2*(y*z-x*w)*s[2],t[1],2*(x*z-y*w)*s[0],2*(y*z+x*w)*s[1],(1-2*(x*x+y*y))*s[2],t[2],0,0,0,1]);}
let uploads=0,erasures=0;const output=[];
class Node{
 constructor(name,local=new M()){Object.assign(this,{name,local,enabled:true,children:[]});this.transform={getWorldTransform:()=>this.world(),getInvertedWorldTransform:()=>this.world().inverse()};}
 world(){return this.parent?this.parent.world().mult(this.local):this.local;}
 getTransform(){return this.transform;}getParent(){return this.parent;}getChildrenCount(){return this.children.length;}getChild(i){return this.children[i];}
 setParent(parent){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=parent;parent.children.push(this);}
 getComponents(){return this.visual?[this.visual]:[];}
 createComponent(){return this.visual={setRenderOrder(value){this.order=value;}};}
 destroy(){this.destroyed=true;this.enabled=false;if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
}
class Builder{
 constructor(){this.vertices=[];this.indices=[];}
 getMesh(){return this;}getIndicesCount(){return this.indices.length;}getVerticesCount(){return this.vertices.length/8;}
 eraseIndices(from,to){a(Number.isInteger(from)&&Number.isInteger(to)&&from>=0&&to>from&&to<=this.indices.length,'native requires nonempty index span');this.indices.splice(from,to-from);erasures++;}
 eraseVertices(from,to){a(Number.isInteger(from)&&Number.isInteger(to)&&from>=0&&to>from&&to<=this.getVerticesCount(),'native requires nonempty vertex span');this.vertices.splice(from*8,(to-from)*8);erasures++;}
 appendVerticesInterleaved(v){a(v.every(Number.isFinite));this.vertices.push(...v);}appendIndices(i){this.indices.push(...i);}updateMesh(){uploads++;}
}
const context={vec3:V,MeshBuilder:Builder,MeshTopology:{Triangles:0},MeshIndexType:{UInt16:0},global:{scene:{createSceneObject(name){const node=new Node(name);output.push(node);return node;}}}},cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const source=file===target&&process.env.MIRROR_EMPTY_SPAN_CANDIDATE?process.env.MIRROR_EMPTY_SPAN_CANDIDATE:file;const js=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;vm.runInNewContext(js,{...context,module,exports:module.exports,require:p=>load(path.resolve(path.dirname(file),p+'.ts'))},{filename:file});return module.exports;}
const {LiveMuseumMirror}=load(target),theatre=new Node('Theatre',trs([350,0,250],[0,0,0,1],[100/6,100/6,100/6]));
const data=fs.readFileSync(path.join(assets,'Art/TableKit/Guard.glb')),length=data.readUInt32LE(12),doc=JSON.parse(data.subarray(20,20+length));
const yaw=-.588+Math.PI,actor=new Node('Guard',trs([5.6*6-21,0,3.6*6-15],[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],[100,100,100]));actor.setParent(theatre);
const nodes=doc.nodes.map(n=>new Node(n.name,trs(n.translation,n.rotation,n.scale))),materials=new Map();
for(let i=0;i<doc.nodes.length;i++){const source=doc.nodes[i];for(const child of source.children??[])nodes[child].setParent(nodes[i]);if(source.mesh!==undefined){const primitive=doc.meshes[source.mesh].primitives[0],name=doc.materials[primitive.material].name;if(!materials.has(name))materials.set(name,{name,clone:()=>({name,mainPass:{}})});nodes[i].visual={mainMaterial:materials.get(name)};}}
for(const i of doc.scenes[doc.scene??0].nodes)nodes[i].setParent(actor);
const mirror={origin:[7,1,3.135],normal:[-1,0,0],right:[0,0,1],up:[0,1,0],width:.43,height:1,aperture:1},input={authorized:true,mode:'author',frameKey:'frame:1',mirror,walls:[],actors:[actor],eyesStoryMetres:[[1,1,1]]};
const live=new LiveMuseumMirror(theatre);live.clear();live.clear();a.equal(uploads,0);a.equal(erasures,0);
live.update(input);a(live.snapshotMetrics().emittedTriangles>0,'Actual shipped/LOD Guard produces visible geometry');a.equal(erasures,0,'First upload never erases an empty native builder');
const snapshot=()=>output.filter(n=>n.enabled&&!n.destroyed).map(n=>({material:n.visual.mainMaterial.name,vertices:[...n.visual.mesh.vertices],indices:[...n.visual.mesh.indices]}));
const first=JSON.stringify(snapshot()),triangles=live.snapshotMetrics().emittedTriangles,batchCount=output.length,firstUploads=uploads;
live.update(input);a.equal(uploads,firstUploads,'Same pose does not upload');a.equal(JSON.stringify(snapshot()),first);
live.update({...input,frameKey:'frame:2'});a(erasures>0,'Replacement reuses nonempty native buffers');a.equal(output.length,batchCount);a.equal(JSON.stringify(snapshot()),first,'Same geometry/counts survive actual replacement');a.equal(live.snapshotMetrics().emittedTriangles,triangles);
live.clear();a.equal(live.snapshotMetrics().emittedTriangles,0);a(output.every(n=>!n.enabled));live.update(input);a.equal(JSON.stringify(snapshot()),first,'Clear then first visible frame restores identical geometry');
live.update({...input,mode:'public'});a.equal(live.snapshotMetrics().sourceTriangles,0);a.equal(live.snapshotMetrics().emittedTriangles,0);a(output.every(n=>!n.enabled));live.update(input);a.equal(JSON.stringify(snapshot()),first,'Hide/show preserves exact reflected geometry');
live.update({...input,actors:[]});a(output.every(n=>!n.enabled));live.update(input);a.equal(JSON.stringify(snapshot()),first);
live.dispose();a(output.every(n=>n.destroyed));const endUploads=uploads;live.update(input);live.dispose();a.equal(uploads,endUploads,'Disposed mirror rejects late upload');
console.log('PASS actual mirror clear/first/same/rebuild/clear/show/hide/show/empty/show/dispose with native-empty-span rejection; same geometry/counts and bounded existing batches');
