import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {read, waitFor, sorted} from "./CountercaseLeafProbe"
import {tap, alarmFrame, selectObservation} from "./MuseumJourney"

/** Small independent normal-entry journey, no staging or privileged state. */
@component
export class PublicRecordingScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const input = new DefaultLeafInteractor()
    await waitFor("public museum entry", s => s.mode === "detective")
    const before = await alarmFrame(input)
    expect(sorted(before.observedRoles)).toEqual(["Courier", "Guard"])
    expect(sorted(before.frameObservedRoles)).toEqual(sorted(before.observedRoles))
    await selectObservation(input, "Courier")
    await tap(input, "Use_PinGlass")
    const pinned = await waitFor("pin recorded observation", s => s.evidenceIds.length === before.evidenceIds.length + 1)
    await tap(input, "Use_PinGlass")
    expect(read().evidenceIds.length).toBe(pinned.evidenceIds.length)
    await tap(input, "Use_EntryClockPrevious")
    expect(read().tick).toBe(before.tick - 1)
    const returned = await alarmFrame(input)
    expect(returned.frameId).toBe(before.frameId)
    expect(sorted(returned.frameObservedRoles)).toEqual(sorted(before.frameObservedRoles))
    expect(sorted(returned.evidenceIds)).toEqual(sorted(pinned.evidenceIds))
    // Re-select a public mark after seeking, then reverse its real pin action.
    await selectObservation(input, "Courier")
    await tap(input, "Use_PinGlass")
    await tap(input, "Use_RemoveEvidence")
    const removed = await waitFor("remove pinned observation", s => s.evidenceIds.length === before.evidenceIds.length)
    expect(sorted(removed.evidenceIds)).toEqual(sorted(before.evidenceIds))
    expect(removed.caseId).toBe(before.caseId)
    expect(removed.revision).toBe(before.revision)
    await selectObservation(input, "Courier")
    await tap(input, "Use_PinGlass")
    await tap(input, "Use_SuspectConservator")
    await tap(input, "Use_CheckStamp")
    const partial = await waitFor("Courier alone leaves two suspects", s => s.verdictStatus === "needClue")
    expect(sorted(partial.possibleCulprits)).toEqual(["Conservator", "Guard"])
    expect(partial.evidenceIds.length).toBe(before.evidenceIds.length + 1)
    await selectObservation(input, "Guard")
    await tap(input, "Use_PinGlass")
    await tap(input, "Use_CheckStamp")
    const complete = await waitFor("independent reflection proves the taker", s => s.verdictStatus === "proved")
    expect(complete.possibleCulprits).toEqual(["Conservator"])
    expect(complete.evidenceIds.length).toBe(before.evidenceIds.length + 2)
    await waitFor("completed public case", s => s.mode === "finished")
    await tap(input, "Use_ReplayGlass")
    const replayed = await waitFor("normal correction replay", s => s.mode === "detective")
    expect(replayed.caseId).toBe(before.caseId)
    expect(replayed.revision).toBe(before.revision)
    expect(replayed.tick).toBe(12)
    expect(sorted(replayed.evidenceIds)).toEqual(sorted(complete.evidenceIds))
    await tap(input, "Use_Evidence0")
    await tap(input, "Use_RemoveEvidence")
    await tap(input, "Use_CheckStamp")
    const reopened = await waitFor("removing Courier reopens the finding", s => s.verdictStatus === "needClue")
    expect(sorted(reopened.possibleCulprits)).toEqual(["Conservator", "Courier"])
    await tap(input, "Use_UndoEvidence")
    await tap(input, "Use_CheckStamp")
    const restored = await waitFor("undo restores the public proof", s => s.verdictStatus === "proved")
    expect(sorted(restored.evidenceIds)).toEqual(sorted(complete.evidenceIds))
    expect(restored.possibleCulprits).toEqual(["Conservator"])
  }
}
