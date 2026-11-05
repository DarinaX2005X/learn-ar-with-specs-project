import {buildLiveMirror,mayReflectBounds,MirrorPlane,Occluder,P,Tri} from './LiveMirrorGeometry';
import {LIVE_MIRROR_LOD} from './NativeMirrorLOD';
interface Driver { node:SceneObject; transform:Transform; previous?:mat4; world?:mat4; dirty:boolean; }
interface Source { node:SceneObject; chain:SceneObject[]; driver:Driver; relative:mat4; material:Material; positions:number[];indices:number[];bounds:P[];visible:boolean; }
interface Rig { root:SceneObject; transform:Transform; chain:SceneObject[]; sources:Source[]; drivers:Driver[]; bounds:P[]; }
interface Batch {object:SceneObject;builder:MeshBuilder;material:Material;}
export interface LiveMirrorInput {
 authorized:boolean; mode:'author'|'reveal'|'public'; frameKey:string; mirror?:MirrorPlane; walls:readonly Occluder[];
 actors:readonly SceneObject[]; eyesStoryMetres:readonly P[];
 /** Actual optional props. Unknown source names fail closed instead of cloning scene art. */
 props?:readonly SceneObject[];
}
const roleModes=(mode:string)=>mode==='author'||mode==='reveal';
const tuple=(p:{x:number;y:number;z:number}):P=>[p.x,p.y,p.z];
const corners=(lo:number[],hi:number[]):P[]=>{const out:P[]=[];for(const x of[lo[0],hi[0]])for(const y of[lo[1],hi[1]])for(const z of[lo[2],hi[2]])out.push([x,y,z]);return out;};
/** Actual rigid-node reflection. Only cached LOD drivers are sampled each frame.
 * No role art is admitted outside author/reveal, even if a caller sets authorized.
 */
export class LiveMuseumMirror {
 private rigs=new Map<SceneObject,Rig>();private rootTransforms=new Map<SceneObject,Transform>();private modelBounds=new Map<string,P[]>();private batches=new Map<Material,Batch>();
 private theatreTransform:Transform;private lastGeometry='';private lastRoots:SceneObject[]=[];private lastFrame='';private disposed=false;private shown=false;
 private metrics={builds:0,reused:0,earlyRejected:0,matrixReads:0,sourceNodes:0,sourceTriangles:0,emittedTriangles:0,uploads:0,clipCalls:0};
 constructor(private theatre:SceneObject){this.theatreTransform=theatre.getTransform();}
 snapshotMetrics(){return {...this.metrics};}
 private coarseBounds(name:string):P[] {
  const old=this.modelBounds.get(name);if(old)return old;
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let count=0;
  for(const part of Object.values(LIVE_MIRROR_LOD[name]??{})){const a=part.restMatrix;
   for(let i=0;i<part.positions.length;i+=3){const p=part.positions,x=a[0]*p[i]+a[1]*p[i+1]+a[2]*p[i+2]+a[3],y=a[4]*p[i]+a[5]*p[i+1]+a[6]*p[i+2]+a[7],z=a[8]*p[i]+a[9]*p[i+1]+a[10]*p[i+2]+a[11];
    [x,y,z].forEach((v,k)=>{lo[k]=Math.min(lo[k],v-.02);hi[k]=Math.max(hi[k],v+.02);});count++;}}
  const result=count?corners(lo,hi):[];this.modelBounds.set(name,result);return result;
 }
 private collect(root:SceneObject):Rig {
  const cached=this.rigs.get(root);if(cached)return cached;
  const parts=LIVE_MIRROR_LOD[root.name]??{},sources:Source[]=[],drivers=new Map<SceneObject,Driver>();
  const allPoints:P[]=[];const rootInverse=root.getTransform().getInvertedWorldTransform();
  const walk=(node:SceneObject,chain:SceneObject[],driverNode:SceneObject)=>{
   if((/^(Head|UpperBody|LocomotionBody|Hip_[LR]|Knee_[LR]|FootPivot_[LR]|Shoulder_[LR]|Forearm_[LR]|Hand_[LR])$/).test(node.name))driverNode=node;
   const branch=[...chain,node],part=parts[node.name];
   if(part)for(const visual of node.getComponents('Component.RenderMeshVisual')) {
    if(!visual.mainMaterial)continue;
    let driver=drivers.get(driverNode);if(!driver){driver={node:driverNode,transform:driverNode.getTransform(),dirty:true};drivers.set(driverNode,driver);}
    const sourceWorld=node.getTransform().getWorldTransform();
    const relative=driver.transform.getInvertedWorldTransform().mult(sourceWorld);
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<part.positions.length;i++){lo[i%3]=Math.min(lo[i%3],part.positions[i]);hi[i%3]=Math.max(hi[i%3],part.positions[i]);}
    const bounds=corners(lo,hi);const rest=rootInverse.mult(sourceWorld);
    allPoints.push(...bounds.map(p=>tuple(rest.multiplyPoint(new vec3(...p)))));
    sources.push({node,chain:branch,driver,relative,material:visual.mainMaterial,positions:part.positions,indices:part.indices,bounds,visible:false});
   }
   for(let i=0;i<node.getChildrenCount();i++)walk(node.getChild(i),branch,driverNode);
  };
  walk(root,[],root);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const p of allPoints)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]-.02);hi[k]=Math.max(hi[k],p[k]+.02);}
  const chain:SceneObject[]=[];let parent:SceneObject|undefined=root;while(parent){chain.push(parent);parent=parent.getParent();}
  const rig={root,transform:root.getTransform(),chain,sources,drivers:[...drivers.values()],bounds:allPoints.length?corners(lo,hi):[]};this.rigs.set(root,rig);return rig;
 }
 update(input:LiveMirrorInput):void {
  if(this.disposed)return;const m=input.mirror;
  if(!input.authorized||!roleModes(input.mode)||!input.frameKey||!m||m.aperture<=0||!input.eyesStoryMetres.length){this.clear();return;}
  if(input.eyesStoryMetres.some(e=>(e[0]-m.origin[0])*m.normal[0]+(e[1]-m.origin[1])*m.normal[1]+(e[2]-m.origin[2])*m.normal[2]<=1e-8)){this.metrics.earlyRejected++;this.clear();return;}
  const inverse=this.theatreTransform.getInvertedWorldTransform();
  const story=(matrix:mat4,p:P):P=>{const q=matrix.multiplyPoint(new vec3(...p));return[(q.x+21)/6,q.y/6,(q.z+15)/6];};
  const active:Rig[]=[];let dirty=input.frameKey!==this.lastFrame;
  for(const root of [...input.actors,...(input.props??[])]) {
   if(!root.enabled)continue;const bounds=this.coarseBounds(root.name);if(!bounds.length)continue;
   let rootTransform=this.rootTransforms.get(root);if(!rootTransform){rootTransform=root.getTransform();this.rootTransforms.set(root,rootTransform);}
   this.metrics.matrixReads++;const rootMatrix=inverse.mult(rootTransform.getWorldTransform());
   if(!mayReflectBounds(bounds.map(p=>story(rootMatrix,p)),m,input.eyesStoryMetres))continue;
   const rig=this.collect(root);if(rig.chain.some(n=>!n.enabled))continue;
   active.push(rig);
   for(const driver of rig.drivers){this.metrics.matrixReads++;const matrix=driver.transform.getWorldTransform();driver.dirty=!driver.previous||!matrix.equal(driver.previous);driver.world=matrix;driver.previous=matrix;if(driver.dirty)dirty=true;}
   for(const source of rig.sources){const visible=source.chain.every(n=>n.enabled);if(visible!==source.visible)dirty=true;source.visible=visible;}
  }
  const roots=active.map(r=>r.root);if(roots.length!==this.lastRoots.length||roots.some((r,i)=>r!==this.lastRoots[i]))dirty=true;
  const geometry=JSON.stringify([m,input.walls,input.eyesStoryMetres]);
  if(!active.length){this.hide();this.metrics.earlyRejected++;this.lastGeometry=geometry;this.lastFrame=input.frameKey;this.lastRoots=[];this.metrics.sourceNodes=0;this.metrics.sourceTriangles=0;this.metrics.emittedTriangles=0;return;}
  if(!dirty&&geometry===this.lastGeometry){this.metrics.reused++;return;}
  this.hide();this.metrics.builds++;this.metrics.sourceNodes=0;this.metrics.sourceTriangles=0;this.metrics.emittedTriangles=0;
  const materials:Material[]=[],materialIds=new Map<Material,number>(),triangles:Tri[]=[];
  for(const rig of active)for(const source of rig.sources){
   if(!source.visible||!source.driver.world)continue;
   const transform=inverse.mult(source.driver.world).mult(source.relative);
   if(!mayReflectBounds(source.bounds.map(p=>story(transform,p)),m,input.eyesStoryMetres))continue;
   this.metrics.sourceNodes++;let id=materialIds.get(source.material);if(id===undefined){id=materials.length;materialIds.set(source.material,id);materials.push(source.material);}
   const points:P[]=[];for(let i=0;i<source.positions.length;i+=3)points.push(story(transform,[source.positions[i],source.positions[i+1],source.positions[i+2]]));
   const vertex=(i:number)=>({p:points[i],uv:[id!,0] as const});
   for(let i=0;i<source.indices.length;i+=3)triangles.push([vertex(source.indices[i]),vertex(source.indices[i+1]),vertex(source.indices[i+2])]);
   this.metrics.sourceTriangles+=source.indices.length/3;
  }
  // Clip aperture and all two-leg occluders once, not once per material.
  this.metrics.clipCalls++;const mesh=buildLiveMirror(triangles,m,input.eyesStoryMetres,input.walls,3000);
  if(mesh.overflow){this.clear();return;}
  const buffers=new Map<number,{vertices:number[];indices:number[]}>();
  for(let t=0;t<mesh.indices.length;t+=3){const id=Math.round(mesh.vertices[mesh.indices[t]*8+6]);let buffer=buffers.get(id);if(!buffer){buffer={vertices:[],indices:[]};buffers.set(id,buffer);}
   for(let k=0;k<3;k++){const offset=mesh.indices[t+k]*8,v=mesh.vertices.slice(offset,offset+8);v[0]=v[0]*6-21;v[1]*=6;v[2]=v[2]*6-15;v[6]=0;v[7]=0;buffer.indices.push(buffer.vertices.length/8);buffer.vertices.push(...v);}}
  for(const [id,buffer] of buffers){const material=materials[id];if(!material)continue;let batch=this.batches.get(material);
   if(!batch){const object=global.scene.createSceneObject('AuthorizedLiveMirrorGeometry');object.setParent(this.theatre);const builder=new MeshBuilder([{name:'position',components:3},{name:'normal',components:3},{name:'texture0',components:2}]);builder.topology=MeshTopology.Triangles;builder.indexType=MeshIndexType.UInt16;
    const visual=object.createComponent('Component.RenderMeshVisual');visual.mesh=builder.getMesh();const ink=material.clone();ink.mainPass.depthTest=false;ink.mainPass.depthWrite=false;ink.mainPass.twoSided=false;visual.mainMaterial=ink;visual.setRenderOrder(50);batch={object,builder,material:ink};this.batches.set(material,batch);}
   const indexCount=batch.builder.getIndicesCount();if(indexCount>0)batch.builder.eraseIndices(0,indexCount);const vertexCount=batch.builder.getVerticesCount();if(vertexCount>0)batch.builder.eraseVertices(0,vertexCount);batch.builder.appendVerticesInterleaved(buffer.vertices);batch.builder.appendIndices(buffer.indices);batch.builder.updateMesh();batch.object.enabled=true;this.metrics.uploads++;this.shown=true;
  }
  this.metrics.emittedTriangles=mesh.indices.length/3;this.lastGeometry=geometry;this.lastRoots=roots;this.lastFrame=input.frameKey;
 }
 private hide():void{if(this.shown)for(const batch of this.batches.values())batch.object.enabled=false;this.shown=false;}
 clear():void{this.hide();this.lastGeometry='';this.lastFrame='';this.lastRoots=[];this.metrics.sourceNodes=0;this.metrics.sourceTriangles=0;this.metrics.emittedTriangles=0;}
 /** Call only after hierarchy/LOD local TRS replacement, not each pose. */
 invalidateSources():void{this.clear();this.rigs.clear();}
 dispose():void{this.clear();for(const batch of this.batches.values()){batch.object.destroy();}this.batches.clear();this.rigs.clear();this.rootTransforms.clear();this.modelBounds.clear();this.disposed=true;}
}

