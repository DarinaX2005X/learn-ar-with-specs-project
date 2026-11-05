import {MuseumGame} from './MuseumGame';
import {MuseumScene} from './MuseumScene';
/** Scene lifecycle only. CaseFlow owns role state and sessions own their clocks. */
@component
export class CountercaseRuntime extends BaseScriptComponent {
 @input recordingMaterial:Material;
 private game:MuseumGame;
 private presentation:MuseumScene;
 onAwake(){
  this.createEvent('OnStartEvent').bind(()=>this.mount());
  this.createEvent('UpdateEvent').bind(()=>{if(this.game)this.game.update(getDeltaTime());});
  this.createEvent('OnDestroyEvent').bind(()=>{if(this.game)this.game.dispose();});
 }
 private mount(){
  this.presentation=new MuseumScene(this.sceneObject,this.recordingMaterial);
  this.game=new MuseumGame(this.sceneObject,{
   renderScene:(state,reveal)=>this.presentation.render(state,reveal),
   clearScene:()=>this.presentation.clear(),
   setLid:closed=>this.presentation.setLid(closed),
   cancelInput:()=>this.presentation.cancelInput()
  });
  this.game.mount();
  (global as any).countercaseLeaf={read:()=>this.readSnapshot()};
  print('COUNTERCASE mounted in museum');
 }
 private readSnapshot(){
  const state=this.game.snapshot(),d=state?.detective,b=state?.board;
  const frame=d?.frame?.kind==='Frame'?d.frame:undefined;
  return {
   revision:d?.rev??state?.author?.draft.rev??0,
   aperture:b?.room.mirror?.aperture??state?.author?.draft.room.mirror?.aperture??0,
   tick:d?.tick??state?.author?.tick??0,
   observedRoles:frame?.payload.fragments.filter(f=>f.role).map(f=>f.role)??[],
   possibleCulprits:d?.verdict?.possibleCulprits??[],
   frameId:frame?d.rev+':'+frame.id:'',frameRevision:d?.rev??0,
   frameObservedRoles:[],mode:state?.flow.mode??'starting',playing:d?.playing??false,
   inputEpoch:state?.flow.inputEpoch??0
  };
 }
}
