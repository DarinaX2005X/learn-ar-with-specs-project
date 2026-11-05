import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {read, sorted} from "./CountercaseLeafProbe"
import {tap,stageCopy,testAndOpen,alarmFrame} from "./MuseumJourney"
import {readStage,waitStage} from "./RemainingProbe"

/** Requires the normal CompareVersions control and actual hall telemetry. */
@component
export class ClosedPairScenario extends Scenario {
  async run():Promise<void> {
    await sleep(1500)
    const input=new DefaultLeafInteractor()
    await stageCopy(input)
    await tap(input,"Use_CurtainClose")
    await testAndOpen(input,["Guard","Conservator"])
    const frame=await alarmFrame(input)
    expect(sorted(frame.observedRoles)).toEqual(["Courier"])
    await tap(input,"Use_UnknownFinding")
    await tap(input,"Use_CheckStamp")
    const proof=await waitStage("closed full-tape ambiguity",s=>s.verdictScope==="all"&&s.possibleCulprits.length===2)
    expect(sorted(proof.possibleCulprits)).toEqual(["Conservator","Guard"])
    // Normal physical version-file operation, never comparePair(history...) from test.
    await tap(input,"Use_CompareVersions")
    await waitStage("two actual reconstruction wings",s=>!!s.comparison?.active&&s.comparison.visibleWings===2)
    // Traverse the entire finite recording using the player's physical clock steps.
    for(let back=0;back<24&&read().tick>0;back++) await tap(input,"Use_EntryClockPrevious")
    for(let tick=0;tick<=24;tick++) {
      const state=readStage(),hall=state.comparison
      expect(state.caseId).toBe(frame.caseId)
      expect(state.revision).toBe(frame.revision)
      expect(state.tick).toBe(tick)
      expect(hall?.active).toBe(true)
      expect(hall?.visibleWings).toBe(2)
      expect(hall?.tick).toBe(tick)
      expect(hall?.scope).toBe("all")
      expect(hall?.issue??null).toBe(null)
      if(tick===12) expect(sorted(state.frameObservedRoles)).toEqual(["Courier"])
      if(tick<24) await tap(input,"Use_EntryClockNext")
    }
    // Existing loupe returns to the original public observation context.
    await tap(input,"Use_PinGlass")
    const returned=await waitStage("leave comparison",s=>!s.comparison?.active)
    expect(returned.tick).toBe(frame.tick)
    expect(returned.frameId).toBe(frame.frameId)
  }
}


