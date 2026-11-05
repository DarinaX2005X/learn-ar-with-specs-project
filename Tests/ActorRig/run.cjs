const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const assets=process.env.ACTOR_ASSETS??path.resolve(__dirname,'../../Assets');
const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'../typescript/lib/typescript.js'))),ts=require(path.resolve(bin,'../typescript/lib/typescript.js'));
const aliases=new Map();
let hierarchy=0,handles=0;
class V{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
class Q{constructor(w=1,x=0,y=0,z=0){Object.assign(this,{w,x,y,z});}static fromEulerAngles(x,y,z){return new Q(Math.cos(y/2),0,Math.sin(y/2),0);}}
class Node{
 constructor(name){this.name=name;this.children=[];this.t={p:new V(),q:new Q(),s:new V(1,1,1),setLocalPosition:p=>this.t.p=p,getLocalPosition:()=>this.t.p,setLocalRotation:q=>this.t.q=q,getLocalRotation:()=>this.t.q,setLocalScale:s=>this.t.s=s,getLocalScale:()=>this.t.s,getWorldPosition:()=>{const p=this.parent?.t.getWorldPosition()??new V();return new V(p.x+this.t.p.x,p.y+this.t.p.y,p.z+this.t.p.z);},getWorldRotation:()=>this.t.q,getWorldScale:()=>this.t.s,setWorldPosition:p=>{const a=this.parent?.t.getWorldPosition()??new V();this.t.p=new V(p.x-a.x,p.y-a.y,p.z-a.z);},setWorldRotation:q=>this.t.q=q,setWorldScale:s=>this.t.s=s};}
 getTransform(){handles++;return this.t;}getChildrenCount(){hierarchy++;return this.children.length;}getChild(i){hierarchy++;return this.children[i];}getParent(){hierarchy++;return this.parent;}
 setParent(parent){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=parent;parent.children.push(this);}destroy(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
}
const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const source=fs.readFileSync(aliases.get(file)??file,'utf8');vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,{module,exports:module.exports,require:p=>load(path.resolve(path.dirname(file),p+'.ts')),vec3:V,quat:Q,global:{scene:{createSceneObject:name=>new Node(name)}}},{filename:file});return module.exports;}
const R=load(path.join(assets,'Runtime/MuseumScene/ActorRig.ts')).ActorRig;
for(const anonymous of [false,true]){
 const actor=new Node('Actor'),upper=new Node(anonymous?'AnonymousTorso':'UpperBody');upper.setParent(actor);
 const feet=[];
 for(const side of ['L','R']){
  const hip=new Node('Hip_'+side),knee=new Node('Knee_'+side);hip.setParent(actor);hip.t.p=new V(side==='L'?-.00504:.00504,.0441,0);knee.setParent(hip);knee.t.p=new V(0,-.0189,0);
  for(const prefix of anonymous?['Foot_','Sole_','BootWelt_']:['Boot_','Sole_']){const foot=new Node(prefix+side);foot.setParent(anonymous?knee:actor);foot.t.p=new V(side==='L'?-.00504:.00504,anonymous?-.014:-.001,0);feet.push({foot,parent:foot.parent,before:foot.t.getWorldPosition(),local:foot.t.p});}
 }
 const rig=new R(actor,anonymous);for(const item of feet)assert.deepEqual(item.foot.t.getWorldPosition(),item.before,'Actual footwear keeps world location at mount');
 const track={id:'A',keys:[{tick:0,x:1,y:1,z:1,yaw:0},{tick:8,x:1,y:1,z:2,yaw:0},{tick:12,x:1,y:1,z:2,yaw:0},{tick:24,x:2,y:1,z:2,yaw:Math.PI/2}]};rig.prepare(track);
 const startHandles=handles,startHierarchy=hierarchy,root=actor.t.p;
 for(let i=0;i<1000;i++){const pose=rig.sample((i%241)/10);const basis=rig.armBasis([100,0,100],pose);assert(basis.every(Number.isFinite));assert.equal(actor.t.p,root,'Authoritative root translation unchanged');}
 assert.equal(handles,startHandles,'Animation reuses all native transforms');assert.equal(hierarchy,startHierarchy,'Animation never traverses scene or calls getParent');
 rig.clearRoute();assert.throws(()=>rig.sample(1),/route/,'Role clear drops old route plan');rig.prepare(track);
 rig.dispose();for(const item of feet){assert.equal(item.foot.parent,item.parent);assert.deepEqual(item.foot.t.p,item.local);}assert(!actor.children.some(n=>n.name==='LocomotionBody'));
}
console.log('PASS named+anonymous actual binding mount preserves footwear;2000 fractional/seek samples have zero native hierarchy/handle reads;root unchanged;dispose exact restoration');

const M=load(path.join(assets,'Runtime/MuseumScene.ts')).MuseumScene,scene=Object.create(M.prototype);let single=0,pair=0;
Object.assign(scene,{disposed:false,lidClosed:false,poseCache:{publicRoutes:false,visible:false},clockHands:[],comparisonActive:false,renderPublicRoutes(){single++;},applyCoverState(){},hall:{presentPose(){pair++;}}});
for(let i=0;i<100;i++)scene.presentPose(8.25);assert.equal(single,1,'Paused single scene poses once');scene.presentPose(8.26);assert.equal(single,2,'Fractional movement updates immediately');scene.presentPose(8.1);assert.equal(single,3,'Reverse sample updates immediately');
scene.comparisonActive=true;scene.lastPoseTick=undefined;for(let i=0;i<100;i++)scene.presentPose(8.1);assert.equal(pair,1,'Paused pair poses once');scene.presentPose(8.12);assert.equal(pair,2,'Pair uses shared fractional time');
console.log('PASS actual MuseumScene paused single/pair avoid duplicate pose writes;fractional forward/reverse immediately updates');
