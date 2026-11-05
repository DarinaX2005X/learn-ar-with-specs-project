import {MuseumGame} from './MuseumGame';
import {MuseumScene} from './MuseumScene';
/** Scene lifecycle only. CaseFlow owns role state and sessions own their clocks. */
@component
export class CountercaseRuntime extends BaseScriptComponent {
 @input recordingMaterial:Material;
 @input cloth:AudioTrackAsset;
 @input engage:AudioTrackAsset;
 @input latch:AudioTrackAsset;
 private game:MuseumGame;
 private presentation:MuseumScene;
 onAwake(){
  this.createEvent('OnStartEvent').bind(()=>this.mount());
  this.createEvent('UpdateEvent').bind(()=>{if(this.game)this.game.update(getDeltaTime());});
  this.createEvent('OnDestroyEvent').bind(()=>{if(this.game)this.game.dispose();if(this.presentation)this.presentation.dispose();});
 }
 private mount(){
  this.presentation=new MuseumScene(this.sceneObject,this.recordingMaterial,{cloth:this.cloth,engage:this.engage,latch:this.latch});
  this.game=new MuseumGame(this.sceneObject,{
   renderScene:(state,reveal)=>this.presentation.render(state,reveal),
   clearScene:()=>this.presentation.clear(),
   setLid:closed=>this.presentation.setLid(closed),
   cancelInput:()=>this.presentation.cancelInput(),
   presentPose:tick=>this.presentation.presentPose(tick),
   caseView:{
    readViewer:()=>this.presentation.readCaseViewViewer(),
    finishTimeDrag:()=>this.presentation.cancelInput(),
    setPresentation:view=>this.presentation.applyCaseView(view),
    setFrameCovered:covered=>this.presentation.setCaseViewCovered(covered),
    setSecondaryLabelsVisible:visible=>this.presentation.setCaseViewSecondaryLabelsVisible(visible),
    stopSound:()=>this.presentation.cancelInput()
   }
  });
  this.game.mount();
  (global as any).countercaseLeaf={read:()=>this.readSnapshot()};
  print('COUNTERCASE mounted in museum');
 }
 private readSnapshot(){
  const state=this.game.snapshot(),d=state?.detective,a=state?.author,b=state?.board;
  const frame=d?.frame?.kind==='Frame'?d.frame:undefined;
  const display=this.presentation.read();
  return {caseId:d?.caseId??a?.draft.id??state?.flow.caseId??'',revision:d?.rev??a?.draft.rev??0,
   aperture:b?.room.mirror?.aperture??a?.draft.room.mirror?.aperture??0,tick:d?.tick??a?.tick??0,
   observedRoles:frame?.payload.fragments.filter(f=>f.role).map(f=>f.role)??[],
   possibleCulprits:a?.verdict?.possibleCulprits??d?.verdict?.possibleCulprits??[],
   frameId:display.frameId??'',frameRevision:display.frameRevision??0,frameObservedRoles:display.frameObservedRoles,
   mode:state?.flow.mode??'starting',playing:a?.playing??d?.playing??false,preview:a?.preview??false,
   testing:a?.testing??false,testedRev:a?.testedRev??null,canSeal:a?.canSeal??false,
   needsAmbiguityConfirmation:a?.needsAmbiguityConfirmation??false,evidenceIds:d?.glass.map(g=>g.id)??[],
   observations:(d?.observations??[]).filter(c=>c.observation?.kind==='fragment').map(c=>({id:c.id,roles:c.payload.fragments.filter(f=>f.role).map(f=>f.role)})),observationTargets:this.game.readObservationTargets(),focusedObservationId:d?.focusedObservation?.id??null,verdictStatus:d?.verdict?.status??null,errors:a?.errors??[],inputEpoch:state?.flow.inputEpoch??0,
   shelf:state?.flow.shelf??[],caseTargets:this.game.readCaseTargets(),objects:d?.objects??[],boxes:b?.room.boxes??[],fields:d?.fields??{},completed:d?.completed??false,checking:d?.checking??false,message:d?.message??'',verdictScope:d?.verdict?.scope,comparison:display.comparison,view:state?.view};
 }
}
