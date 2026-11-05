import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {tap,alarmFrame,selectObservation} from "./MuseumJourney"
import {readStage,waitStage,openStored,inspectBox} from "./RemainingProbe"

@component
export class PackingPartialScenario extends Scenario {
  async run():Promise<void> {
    await sleep(1500)
    const input=new DefaultLeafInteractor()
    await waitStage("normal public entry",s=>s.mode==="detective")
    await openStored(input,"packing-room",1)
    await alarmFrame(input)
    await selectObservation(input,"Conservator")
    await tap(input,"Use_PinGlass")
    await tap(input,"Use_Findingtaker")
    await tap(input,"Use_SuspectConservator")
    await tap(input,"Use_CheckStamp")
    const taker=await waitStage("visible taker proved independently",s=>s.fields?.taker?.value==="Conservator")
    expect(taker.completed).toBe(false)
    expect(taker.fields.recipient??null).toBe(null)
    await inspectBox(input,"canvas trunk")
    await tap(input,"Use_Findingcache")
    const brassIndex=readStage().boxes.findIndex(b=>b.id==="brass case")
    if(brassIndex<0) throw new Error("Public brass case geometry is missing")
    await tap(input,"Use_CacheChoice"+brassIndex)
    await tap(input,"Use_CheckStamp")
    const insufficient=await waitStage("empty canvas alone cannot prove brass cache",s=>s.verdictStatus==="needClue")
    expect(insufficient.fields.cache??null).toBe(null)
    await inspectBox(input,"brass case")
    await tap(input,"Use_CheckStamp")
    const cache=await waitStage("physical brass search proves cache",s=>s.fields?.cache?.value==="brass case")
    expect(cache.fields.taker?.value).toBe("Conservator")
    expect(cache.completed).toBe(false)
    await tap(input,"Use_Findingrecipient")
    await tap(input,"Use_UnknownFinding")
    await tap(input,"Use_CheckStamp")
    const partial=await waitStage("honest recipient ambiguity accepted",s=>s.fields?.recipient?.value==="Could be either"&&s.completed)
    expect(partial.fields.recipient?.scope).toBe("all")
    expect(partial.fields.cache?.value).toBe("brass case")
    await tap(input,"Use_CompareVersions")
    const pair=await waitStage("public recipient alternatives physically mounted",s=>s.comparison?.active===true&&s.comparison.field==="recipient")
    expect(pair.comparison?.visibleWings).toBe(2)
    expect(pair.comparison?.issue??null).toBe(null)
  }
}

