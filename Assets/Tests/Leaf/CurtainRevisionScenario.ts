import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {read, target, waitFor, sorted} from "./CountercaseLeafProbe"

/** Criterion 1 only: real SIK trigger -> revision -> recording -> proof -> reversal. */
@component
export class CurtainRevisionScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const input = new DefaultLeafInteractor()
    const startup = read()
    expect(startup.aperture).toBe(0)
    await input.trigger(target("RewindAlarm"))
    const before = await waitFor("closed alarm frame", s => !s.playing && s.frameRevision === s.revision)
    expect(before.aperture).toBe(0)
    expect(sorted(before.observedRoles)).toEqual(["Courier"])
    expect(sorted(before.frameObservedRoles)).toEqual(sorted(before.observedRoles))
    expect(sorted(before.possibleCulprits)).toEqual(["Conservator", "Guard"])

    // CurtainHandle tap is the accessible equivalent of moving to the opposite end.
    // All mutations pass through SIK; the telemetry hook cannot change state.
    await input.trigger(target("CurtainHandle"))
    const edited = await waitFor("one curtain commit", s => s.revision > before.revision && s.aperture === 1)
    expect(edited.revision).toBe(before.revision + 1)
    // Repeat the LEAF release input, never call the application's event handlers.
    // This covers a repeated released input state, not a manually forged SIK event.
    input.stopSelecting()
    await sleep(50)
    input.stopSelecting()
    await sleep(100)
    expect(read().revision).toBe(edited.revision)
    await input.trigger(target("RewindAlarm"))
    const open = await waitFor("open alarm frame", s => !s.playing && s.frameRevision === edited.revision && s.tick === before.tick)
    expect(sorted(open.observedRoles)).toEqual(["Courier", "Guard"])
    expect(sorted(open.frameObservedRoles)).toEqual(sorted(open.observedRoles))
    expect(open.frameId === before.frameId).toBe(false)
    expect(open.possibleCulprits).toEqual(["Conservator"])

    // Compare the actual retained sealed recording through its ordinary control.
    await input.trigger(target("ComparePrevious"))
    const archive = await waitFor("previous recording", s => s.frameRevision === before.revision)
    expect(archive.revision).toBe(open.revision)
    expect(archive.aperture).toBe(open.aperture)
    expect(archive.tick).toBe(before.tick)
    expect(archive.frameId).toBe(before.frameId)
    expect(sorted(archive.observedRoles)).toEqual(sorted(before.observedRoles))
    expect(sorted(archive.frameObservedRoles)).toEqual(sorted(before.frameObservedRoles))
    expect(sorted(archive.possibleCulprits)).toEqual(sorted(before.possibleCulprits))
    await input.trigger(target("ComparePrevious"))
    const current = await waitFor("return to edited recording", s => s.frameRevision === open.revision)
    expect(current.revision).toBe(open.revision)
    expect(current.frameId).toBe(open.frameId)
    expect(sorted(current.observedRoles)).toEqual(sorted(open.observedRoles))
    expect(current.possibleCulprits).toEqual(open.possibleCulprits)

    await input.trigger(target("CloseCurtain"))
    const closed = await waitFor("reverse curtain", s => s.aperture === 0 && s.revision > open.revision)
    expect(closed.revision).toBe(open.revision + 1)
    await input.trigger(target("RewindAlarm"))
    const restored = await waitFor("restored alarm frame", s => !s.playing && s.frameRevision === closed.revision && s.tick === before.tick)
    expect(sorted(restored.observedRoles)).toEqual(sorted(before.observedRoles))
    expect(sorted(restored.frameObservedRoles)).toEqual(sorted(before.frameObservedRoles))
    expect(sorted(restored.possibleCulprits)).toEqual(sorted(before.possibleCulprits))

    // Negative path: closing an already closed curtain must not invent a revision.
    await input.trigger(target("CloseCurtain"))
    await sleep(300)
    expect(read().revision).toBe(restored.revision)
    expect(sorted(read().possibleCulprits)).toEqual(sorted(before.possibleCulprits))
  }
}
