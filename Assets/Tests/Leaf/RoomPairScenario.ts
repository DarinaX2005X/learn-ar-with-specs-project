import {sleep} from "Leaf.lspkg/Utils/common/Utils";
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario";
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor";
import {findInteractablesByName} from "Leaf.lspkg/Interactors/InteractableUtils";
import {expect} from "Leaf.lspkg/Utils/common/Expect";
import {read,waitFor,sorted} from "./CountercaseLeafProbe";
import {tap,stageCopy,testAndOpen,alarmFrame} from "./MuseumJourney";
import {waitStage} from "./RemainingProbe";

/** Switch between two approved full-size reconstructions and return to the paired models. */
@component
export class RoomPairScenario extends Scenario {
 async run():Promise<void> {
  const input=new DefaultLeafInteractor();
  try {
   await alarmFrame(input);await stageCopy(input);await tap(input,"Use_CurtainClose");
   await testAndOpen(input,["Guard","Conservator"]);await alarmFrame(input);
   await tap(input,"Use_UnknownFinding");await tap(input,"Use_CheckStamp");
   await waitStage("full tape admits two thefts",s=>s.verdictScope==="all"&&s.possibleCulprits.length===2);
   await tap(input,"Use_CompareVersions");
   await waitStage("approved paired bench",s=>s.comparison?.active===true&&s.comparison.visibleWings===2);
   const before=read();
   await tap(input,"Use_CaseViewHandle");await tap(input,"Use_CaseViewStanding");
   await waitFor("first approved room version",raw=>{const s=raw as any;return s.view?.mode==="room"&&s.comparison?.visibleWings===1&&s.comparison.versionIndex===0;});
   print("[RoomPairNative] FIRST_ROOM0");await sleep(2500);
   const room=read() as any,placement=JSON.stringify(room.view.presentation.placement),handle=JSON.stringify(room.view.presentation.handlePlacement);
   const invariant=(s:any)=>s.caseId===before.caseId&&s.revision===before.revision&&s.tick===before.tick&&s.frameId===before.frameId&&JSON.stringify(sorted(s.evidenceIds))===JSON.stringify(sorted(before.evidenceIds))&&s.verdictStatus===before.verdictStatus;
   for(const index of [1,0]) {
    await tap(input,"Use_CaseViewVersion");
    const s=await waitFor("other permitted version in same room",raw=>{const s=raw as any;return s.comparison?.versionIndex===index&&s.comparison.visibleWings===1;}) as any;
    expect(invariant(s)).toBe(true);expect(s.comparison.scope).toBe("all");
    expect(JSON.stringify(s.view.presentation.placement)).toBe(placement);
    expect(JSON.stringify(s.view.presentation.handlePlacement)).toBe(handle);
    expect(s.comparison.tick).toBe(room.comparison.tick);
    print("[RoomPairNative] VERSION_"+index);await sleep(2500);
   }
   for(const name of ["Use_TakeRuby","Use_PropCamera","Use_AuthorViewTryChange"])
    expect(findInteractablesByName(name,undefined,true).length).toBe(0);
   await tap(input,"Use_CaseViewBack");
   const back=await waitFor("return retains paired bench",raw=>{const s=raw as any;return s.view?.mode==="table"&&s.comparison?.visibleWings===2;});
   expect(invariant(back)).toBe(true);expect(findInteractablesByName("Use_CaseViewVersion",undefined,true).length).toBe(0);
   await tap(input,"Use_CaseViewClose");
   await waitFor("ordinary museum return",raw=>(raw as any).view?.mode==="museum");
  } finally {input.stopSelecting();}
 }
}
