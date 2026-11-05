import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario";
import {expect} from "Leaf.lspkg/Utils/common/Expect";
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor";
import {read,waitFor,sorted,CountercaseSnapshot} from "./CountercaseLeafProbe";
import {alarmFrame,stageCopy,tap} from "./MuseumJourney";

// Proposed read-only telemetry. Renderer owns the final pane schema; do not register
// until its projection is installed and these names agree with that actual schema.
interface Recording {board?:{caseId:string;rev:number};frame?:{id:string};source:string;tick:number}
interface Pane {enabled:boolean;caseId?:string;rev?:number;frameId?:string;source?:string;tick?:number;roles:string[];observationIds:string[]}
interface WatchState extends CountercaseSnapshot {
 authorView?:{enabled:boolean;mode:string;source:string;tick:number;comparing:boolean;canCompare:boolean;differences:{field:string;before:unknown[];after:unknown[]}[];recording?:Recording;before?:Recording;after?:Recording};
 authorRecording?:{camera:Pane;before:Pane;after:Pane};
}
const snapshot=()=>read() as WatchState;
const wait=(label:string,p:(s:WatchState)=>boolean)=>waitFor(label,s=>p(s as WatchState)) as Promise<WatchState>;
function samePane(p:Pane|undefined,r:Recording|undefined):void {
 if(!p?.enabled||!r?.board||!r.frame) throw new Error("Missing actually rendered pane or compiled recording");
 expect(p.caseId).toBe(r.board.caseId); expect(p.rev).toBe(r.board.rev);
 expect(p.frameId).toBe(r.frame.id); expect(p.source).toBe(r.source); expect(p.tick).toBe(r.tick);
 if(!p.observationIds.length) throw new Error("Actual local glass has no public observation surfaces");
}
function cleared(p:Pane|undefined):boolean {return !!p&&!p.enabled&&p.roles.length===0&&p.observationIds.length===0&&!p.frameId;}

@component
export class AuthorWatchScenario extends Scenario {
 async run():Promise<void> {
  const input=new DefaultLeafInteractor();
  try {
   await alarmFrame(input); const base=await stageCopy(input);
   expect(base.aperture).toBe(1);
   // StageCopy may start its author clock at zero. Reach alarm with actual steps.
   for(let step=0;step<25&&(read().tick!==12||read().playing);step++)
    await tap(input,read().tick<12?"Use_WorkshopClockNext":"Use_WorkshopClockPrevious");
   expect(read().tick).toBe(12);expect(read().playing).toBe(false);
   await tap(input,"Use_AuthorViewWatchBench_entrance");
   const watched=await wait("bench Watch actually renders",s=>s.authorView?.mode==="recording"&&!!s.authorRecording?.before.enabled);
   const tick=watched.authorView!.tick,source=watched.authorView!.source;
   expect(tick).toBe(12); samePane(watched.authorRecording!.before,watched.authorView!.recording);
   samePane(watched.authorRecording!.camera,watched.authorView!.recording);
   expect(sorted(watched.authorRecording!.before.roles)).toEqual(["Courier","Guard"]);
   expect(cleared(watched.authorRecording!.after)).toBe(true);
   await tap(input,"Use_AuthorViewTryChange");
   await wait("normal temporary author copy",s=>s.authorView?.mode==="change");
   await tap(input,"Use_CurtainClose");
   const changed=await wait("temporary curtain commits",s=>s.aperture===0&&!s.preview);
   expect(changed.revision).toBe(base.revision+1);
   await wait("comparison available",s=>!!s.authorView?.canCompare);
   await tap(input,"Use_AuthorViewCompareChange");
   const compared=await wait("actual before/after proof differs",s=>!s.authorView?.comparing&&!!s.authorView?.differences.some(d=>d.field==="taker"));
   expect(compared.authorView!.tick).toBe(tick); expect(compared.authorView!.source).toBe(source);
   samePane(compared.authorRecording!.before,compared.authorView!.before);
   samePane(compared.authorRecording!.after,compared.authorView!.after);
   expect(sorted(compared.authorRecording!.before.roles)).toEqual(["Courier","Guard"]);
   expect(sorted(compared.authorRecording!.after.roles)).toEqual(["Courier"]);
   const difference=compared.authorView!.differences.find(d=>d.field==="taker")!;
   expect(difference.before.slice().sort()).toEqual(["Conservator"]);
   expect(difference.after.slice().sort()).toEqual(["Conservator","Guard"]);
   await tap(input,"Use_AuthorViewDiscardChange");
   const restored=await wait("discard restores recording and clears changed roles",s=>s.authorView?.mode==="recording"&&s.aperture===1&&cleared(s.authorRecording?.after));
   expect(restored.revision).toBe(base.revision);expect(restored.caseId).toBe(base.caseId);
   expect(restored.authorView!.tick).toBe(tick);expect(restored.authorView!.source).toBe(source);
   samePane(restored.authorRecording!.before,restored.authorView!.recording);
   await tap(input,"Use_AuthorViewBackToStage");
   await wait("leaving Watch clears all local roles and surfaces",s=>s.authorView?.mode==="stage"&&!!s.authorRecording&&[s.authorRecording.camera,s.authorRecording.before,s.authorRecording.after].every(cleared));
   await tap(input,"Use_SaveFile");
   await wait("ordinary shelf exit clears author role",s=>s.mode==="ready"&&s.authorView?.enabled===false&&!!s.authorRecording&&[s.authorRecording.camera,s.authorRecording.before,s.authorRecording.after].every(cleared));
  } finally {input.stopSelecting();}
 }
}
