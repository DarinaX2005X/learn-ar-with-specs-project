import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"
import {target, waitFor} from "./CountercaseLeafProbe"
import {stageCopy} from "./MuseumJourney"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"

@component
export class CurtainReachScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const before = await stageCopy(new DefaultLeafInteractor())
    expect(before.aperture).toBe(1)
    // The installed LEAF factory otherwise falls back to DefaultLeafInteractor.
    DiagnosticRecorder.getInstance().setPolicy("fail-fast")
    const ik = createIKInteractor()
    const handle = target("Use_CurtainHandle")
    if (ik.right.isIndirect(handle)) throw new Error("IK reach precondition: position the Preview viewer within arm reach of the museum mirror before this isolated run")
    await ik.trigger(handle)
    const after = await waitFor("IK curtain commit", s => s.aperture === 0 && s.revision > before.revision)
    expect(after.revision).toBe(before.revision + 1)
    const close = target("Use_CurtainOpen")
    if (ik.right.isIndirect(close)) throw new Error("IK alternate endpoint requires indirect targeting from this viewer position")
    await ik.trigger(close)
    await waitFor("IK reverse commit", s => s.aperture === 1 && s.revision === after.revision + 1)
  }
}
