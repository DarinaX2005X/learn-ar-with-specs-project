import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"
import {read, target, waitFor} from "./CountercaseLeafProbe"

@component
export class CurtainReachScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const before = read()
    expect(before.aperture).toBe(0)
    // The installed LEAF factory otherwise falls back to DefaultLeafInteractor.
    DiagnosticRecorder.getInstance().setPolicy("fail-fast")
    const ik = createIKInteractor()
    const handle = target("CurtainHandle")
    expect(ik.right.isIndirect(handle)).toBe(false)
    await ik.trigger(handle)
    const after = await waitFor("IK curtain commit", s => s.aperture === 1 && s.revision > before.revision)
    expect(after.revision).toBe(before.revision + 1)
    const close = target("CloseCurtain")
    expect(ik.right.isIndirect(close)).toBe(false)
    await ik.trigger(close)
    await waitFor("IK reverse commit", s => s.aperture === 0 && s.revision === after.revision + 1)
  }
}
