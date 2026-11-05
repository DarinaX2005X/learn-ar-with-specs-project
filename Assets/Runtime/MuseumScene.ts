import { Board, CaseDraft, History, Role, VaultEntry, FrameClue } from '../Domain/types';
import { PlayTableSnapshot } from './PlayTable';
import { RecordedGlass } from './RecordedGlass';
import { renderHistory } from '../Spatial/Reconstruction';
import { LensArmAdapter } from '../Spatial/ArmIK';
import { curtainVisual } from '../Scripts/TableKit/TableKit';

/** Native museum binding. Persistent architecture is never recreated on a role change. */
export class MuseumScene {
 private theatre:SceneObject;
 private actors=new Map<Role,SceneObject>();
 private arms=new Map<Role,LensArmAdapter<vec3,quat>>();
 private glassRoot:SceneObject;
 private glass:RecordedGlass;
 private frameKey='';
 private frameId:string|undefined;
 private revision:string|undefined;
 private lidClosed=false;
 private lid:SceneObject|undefined;
 constructor(private root:SceneObject,private material:Material){
  const theatre=this.find('Theatre',root);if(!theatre)throw new Error('Museum Theatre is missing');this.theatre=theatre;
  for(const role of ['Courier','Guard','Conservator'] as Role[]){const actor=this.find(role,theatre);if(actor){this.actors.set(role,actor);this.bindArm(role,actor);actor.enabled=false;}}
  this.glassRoot=global.scene.createSceneObject('PublicRecordedGlass');this.glassRoot.setParent(root);
  this.glass=new RecordedGlass(this.glassRoot,material);
  const anchor=this.findGlobal('Anchor_PinGlass');
  if(anchor){this.glassRoot.getTransform().setWorldPosition(anchor.getTransform().getWorldPosition());this.glassRoot.getTransform().setWorldRotation(anchor.getTransform().getWorldRotation());}
  else this.glassRoot.getTransform().setLocalPosition(new vec3(-660,105,110));
  // A vertical recording pane stands on the conservation bench, never in the viewer's face.
  this.glassRoot.getTransform().setLocalScale(new vec3(1.6,1.6,1.6));
  this.lid=this.findGlobal('CaseLid');
 }
 private find(name:string,node:SceneObject):SceneObject|undefined{if(node.name===name)return node;for(let i=0;i<node.getChildrenCount();i++){const found=this.find(name,node.getChild(i));if(found)return found;}return undefined;}
 private findGlobal(name:string):SceneObject|undefined{for(let i=0;i<global.scene.getRootObjectsCount();i++){const found=this.find(name,global.scene.getRootObject(i));if(found)return found;}return undefined;}
 private bindArm(role:Role,actor:SceneObject){
  const shoulder=this.find('Shoulder_R',actor),elbow=this.find('Forearm_R',actor),wrist=this.find('Hand_R',actor);
  if(!shoulder||!elbow||!wrist)return;
  let upper=this.find('UpperBody',actor);
  if(!upper){
   upper=global.scene.createSceneObject('UpperBody');upper.setParent(shoulder.getParent());
   const parent=shoulder.getParent();const children:SceneObject[]=[];
   for(let i=0;i<parent.getChildrenCount();i++){const child=parent.getChild(i);if(child!==upper&&!/^Hip_|^Thigh_|^Knee_|^Boot_|^Sole_/.test(child.name))children.push(child);}
   for(const child of children)child.setParent(upper);
  }
  this.arms.set(role,new LensArmAdapter({upperBody:upper,shoulder,elbow,wrist},{vector:(x,y,z)=>new vec3(x,y,z),quaternion:(x,y,z,w)=>new quat(w,x,y,z)}));
 }
 private draftBoard(d:CaseDraft):Board{return {caseId:d.id,rev:d.rev,room:d.room,witnesses:d.witnesses,tracks:d.tracks,alarmTick:d.alarmTick,chain:!!d.chain,fields:d.fields||['taker'],windows:{take:[],brush:{A:[],B:[],C:[]},pass:[],stash:[]}};}
 private draftHistory(d:CaseDraft):History{
  const take=d.events.find(e=>e.kind==='Take');const pass=d.events.find(e=>e.kind==='Pass');const stash=d.events.find(e=>e.kind==='Stash');
  return {casting:d.casting,take:take&&take.kind==='Take'?take.track:'A',brushes:d.events.filter(e=>e.kind==='BrushRim').map(e=>({track:(e as Extract<typeof e,{track:unknown}>).track,tick:e.tick})),...(pass&&pass.kind==='Pass'?{pass:{from:pass.from,to:pass.to,tick:pass.tick}}:{}),...(stash&&stash.kind==='Stash'?{stash:{carrier:stash.carrier,box:stash.box,tick:stash.tick}}:{})};
 }
 private point(o:SceneObject|undefined,p:readonly number[]){if(o)o.getTransform().setLocalPosition(new vec3(p[0]*.06-21,p[1]*.06,p[2]*.06-15));}
 render(snapshot:PlayTableSnapshot,reveal?:VaultEntry):void{
  let board=snapshot.board,history:History|undefined,tick=snapshot.detective?.tick??snapshot.author?.tick??0;
  if(snapshot.flow.mode==='author'&&snapshot.author){board=this.draftBoard(snapshot.author.draft);history=this.draftHistory(snapshot.author.draft);}
  else if(reveal&&snapshot.flow.mode==='finished'){board=this.draftBoard(reveal.sourceDraft);history=reveal.actualHistory;}
  else if(snapshot.detective?.mode==='reconstruction')history=snapshot.detective.reconstruction;
  const visible=!!history&&!!board&&!this.lidClosed;
  for(const actor of this.actors.values())actor.enabled=visible;
  const ruby=this.find('Ruby',this.theatre);if(ruby)ruby.enabled=visible;
  if(board){
   const exhibit=board.room.exhibit.position;this.point(this.find('DisplayCase',this.theatre),[exhibit.x*100,0,exhibit.z*100]);
   const witness=board.witnesses.find(w=>w.id===snapshot.detective?.source)||board.witnesses[0];if(witness)this.point(this.find('Camera',this.theatre),[witness.position.x*100,witness.position.y*100,witness.position.z*100]);
   const mirror=board.room.mirror;
   if(mirror){
    const yaw=Math.atan2(-mirror.normal.x,-mirror.normal.z);
    for(const name of ['MirrorHousing','Curtain']){
     const object=this.find(name,this.theatre);if(!object)continue;
     this.point(object,[mirror.origin.x*100,mirror.origin.y*100-mirror.height*60,mirror.origin.z*100]);
     object.getTransform().setLocalRotation(quat.fromEulerAngles(0,yaw,0));
     object.getTransform().setLocalScale(new vec3(mirror.width*100,mirror.height*60,100));
     object.enabled=true;
    }
    const curtain=this.find('Curtain',this.theatre),visual=curtainVisual(mirror.aperture);
    if(curtain)for(let i=0;i<12;i++)for(const prefix of ['Fold_','Ring_']){
     const node=this.find(prefix+('0'+i).slice(-2),curtain);if(!node)continue;
     const transform=node.getTransform(),p=transform.getLocalPosition();
     transform.setLocalPosition(new vec3(visual.foldXCm[i]*.01,p.y,p.z));
     if(prefix==='Fold_')transform.setLocalScale(new vec3(visual.foldScaleX,1,1));
    }
    const handle=curtain&&this.find('Handle',curtain);if(handle){const p=handle.getTransform().getLocalPosition();handle.getTransform().setLocalPosition(new vec3(visual.handleXCm*.01,p.y,p.z));}
   }
  }
  if(visible&&board&&history){const view=renderHistory(board,history,tick);for(const pose of view.actors){const actor=this.actors.get(pose.role);if(!actor)continue;this.point(actor,pose.positionCm);actor.getTransform().setLocalRotation(quat.fromEulerAngles(0,pose.yawRad,0));for(const name of Object.keys(pose.joints||{})){const joint=this.find(name,actor),angles=pose.joints![name as keyof typeof pose.joints];if(joint&&angles)joint.getTransform().setLocalRotation(quat.fromEulerAngles(angles[0],angles[1],angles[2]));}const hand=view.hands.find(h=>history!.casting[h.track]===pose.role);if(hand)this.arms.get(pose.role)?.apply(pose,hand.handCm);}if(ruby){this.point(ruby,view.ruby.positionCm);ruby.enabled=view.ruby.visible;}}
  const frame=snapshot.detective?.frame;const publicFrame=frame?.kind==='Frame'?frame:undefined;
  const key=board&&publicFrame&&!this.lidClosed?board.caseId+':'+board.rev+':'+publicFrame.id:'';
  if(key!==this.frameKey){this.frameKey=key;this.frameId=key?publicFrame?.id:undefined;this.revision=key&&board?board.caseId+':'+board.rev:undefined;this.glass.clear();if(key&&board)this.glass.render(board,publicFrame);}
 }
 read(){return {frameObservedRoles:this.glass.renderedRoles,frameRevision:this.revision,frameId:this.frameId};}
 clear():void{for(const actor of this.actors.values())actor.enabled=false;const ruby=this.find('Ruby',this.theatre);if(ruby)ruby.enabled=false;this.glass.clear();this.frameKey='';this.frameId=undefined;this.revision=undefined;}
 setLid(closed:boolean):void{this.lidClosed=closed;if(this.lid)this.lid.enabled=closed;if(closed)this.clear();}
 cancelInput():void{/* No input subscriptions are owned by the renderer. */}
}


