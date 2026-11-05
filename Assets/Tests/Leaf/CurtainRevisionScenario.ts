import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {read, waitFor, sorted} from "./CountercaseLeafProbe"
import {tap, stageCopy, testAndOpen, alarmFrame, publicProof} from "./MuseumJourney"

@component
export class CurtainRevisionScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const input = new DefaultLeafInteractor()
    const original = await alarmFrame(input)
    expect(original.aperture).toBe(1)
    expect(sorted(original.observedRoles)).toEqual(["Courier", "Guard"])
    expect(sorted(original.frameObservedRoles)).toEqual(sorted(original.observedRoles))
    const copy = await stageCopy(input)
    await tap(input, "Use_CurtainHandle")
    const closed = await waitFor("curtain commits once", s => s.aperture === 0 && !s.preview)
    expect(closed.revision).toBe(copy.revision + 1)
    input.stopSelecting()
    await sleep(50)
    input.stopSelecting()
    await sleep(100)
    expect(read().revision).toBe(closed.revision)
    await testAndOpen(input, ["Guard", "Conservator"])
    const closedFrame = await alarmFrame(input)
    expect(closedFrame.caseId).toBe(copy.caseId)
    expect(sorted(closedFrame.observedRoles)).toEqual(["Courier"])
    expect(sorted(closedFrame.frameObservedRoles)).toEqual(["Courier"])
    await publicProof(input, "Guard", ["Guard", "Conservator"])
    const nextCopy = await stageCopy(input)
    await tap(input, "Use_CurtainOpen")
    const reopened = await waitFor("alternate curtain endpoint", s => s.aperture === 1 && !s.preview)
    expect(reopened.revision).toBe(nextCopy.revision + 1)
    await testAndOpen(input, ["Conservator"])
    const openFrame = await alarmFrame(input)
    expect(openFrame.tick).toBe(closedFrame.tick)
    expect(openFrame.caseId === closedFrame.caseId).toBe(false)
    expect(sorted(openFrame.observedRoles)).toEqual(["Courier", "Guard"])
    expect(sorted(openFrame.frameObservedRoles)).toEqual(sorted(openFrame.observedRoles))
    await publicProof(input, "Conservator", ["Conservator"])
  }
}
