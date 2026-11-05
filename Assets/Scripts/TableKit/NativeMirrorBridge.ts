import {LiveMuseumMirror} from './LiveMuseumMirror';
import {Mirror,Wall,Vec3} from '../../Domain/types';
import {P,Occluder,mayOccludeMirror} from './LiveMirrorGeometry';
import {museumMirrorOccluders} from './MirrorRoomProxies';
export interface NativeMirrorInput {
 enabled:boolean;authorized:boolean;mode:'author'|'reveal'|'public';frameKey:string;visible:boolean;
 actors:readonly SceneObject[];props?:readonly SceneObject[];mirror:Mirror|undefined;walls:readonly Wall[];
 eyeWorld:P;eyesWorld?:readonly P[];viewForwardWorld?:P;exhibit:Vec3|undefined;
}
const tuple=(p:Vec3):P=>[p.x,p.y,p.z];
/** Default-off bounded native review bridge. Public/hypothesis modes fail closed. */
export class NativeMirrorBridge {
 private mirror:LiveMuseumMirror;private transform:Transform;
 private metrics={gated:0,viewRejected:0,eyeTransforms:0};
 constructor(theatre:SceneObject){this.transform=theatre.getTransform();this.mirror=new LiveMuseumMirror(theatre);}
 snapshotMetrics(){return {...this.metrics,...this.mirror.snapshotMetrics()};}
 update(input:NativeMirrorInput):void {
  const m=input.mirror;
  const valid=!!m&&[...tuple(m.origin),...tuple(m.normal),...tuple(m.right),...tuple(m.up),m.width,m.height,m.aperture].every(Number.isFinite)&&m.width>0&&m.height>0&&Math.abs(m.normal.y)<1e-5&&Math.abs(m.up.y-1)<1e-5;
  if(!input.enabled||!input.authorized||!(input.mode==='author'||input.mode==='reveal')||!input.frameKey||!input.visible||!m||!valid||m.aperture<=0||!input.eyeWorld.every(Number.isFinite)){this.metrics.gated++;this.clear();return;}
  const inverse=this.transform.getInvertedWorldTransform();this.metrics.eyeTransforms++;
  const q=inverse.multiplyPoint(new vec3(...input.eyeWorld));const eye:P=[(q.x+21)/6,q.y/6,(q.z+15)/6];
  const eyes=input.eyesWorld?.length?input.eyesWorld.filter(p=>p.every(Number.isFinite)).map(p=>{const v=inverse.multiplyPoint(new vec3(...p));return [(v.x+21)/6,v.y/6,(v.z+15)/6] as P;}):[eye];
  if(!eyes.length){this.clear();return;}
  const d:P=[eye[0]-m.origin.x,eye[1]-m.origin.y,eye[2]-m.origin.z];
  if(d[0]*m.normal.x+d[1]*m.normal.y+d[2]*m.normal.z<=1e-8){this.metrics.viewRejected++;this.clear();return;}
  if(input.viewForwardWorld){const f=inverse.multiplyDirection(new vec3(...input.viewForwardWorld));const toward:P=[-d[0],-d[1],-d[2]],length=Math.hypot(f.x,f.y,f.z);const radius=Math.hypot(m.width,m.height)/2;
   if(length>1e-8&&(toward[0]*f.x+toward[1]*f.y+toward[2]*f.z)/length < -radius){this.metrics.viewRejected++;this.clear();return;}}
  const walls:Occluder[]=input.walls.map(w=>({a:tuple(w.a),b:tuple(w.b),bottom:w.bottom,top:w.top}));
  walls.push(...museumMirrorOccluders(input.exhibit));
  const plane={origin:tuple(m.origin),normal:tuple(m.normal),right:tuple(m.right),up:tuple(m.up),width:m.width,height:m.height,aperture:m.aperture};
  this.mirror.update({authorized:true,mode:input.mode,frameKey:input.frameKey,actors:input.actors,props:input.props,
   mirror:plane,walls:walls.filter(w=>mayOccludeMirror(w,plane,eyes)),eyesStoryMetres:eyes});
 }
 clear():void{this.mirror.clear();}
 invalidateSources():void{this.mirror.invalidateSources();}
 dispose():void{this.mirror.dispose();}
}
