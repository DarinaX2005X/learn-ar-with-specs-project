import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep, nextFrame} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {read, target, waitFor, sorted} from "./CountercaseLeafProbe"

/** Simulate SIK input availability, never call the application's cancel handler. */
class InterruptibleCurtainInput extends DefaultLeafInteractor {
  private available = true
  constructor() {
    super("CountercaseInterruptibleInput")
    // SIK InteractionManager dispatches TriggerCanceled when an active selection
    // loses isActive(). This models input loss independently from application state.
    this.sikInteractor.isActive = () => this.available
  }
  async beginDrag(): Promise<void> {
    await this.enterHover(target("CurtainHandle"))
    this.startSelecting()
    await nextFrame()
    this.overrideDragVector = new vec3(0.05, 0, 0)
  }
  loseInput(): void { this.available = false }
  async recover(): Promise<void> {
    this.stopSelecting()
    this.overrideDragVector = undefined
    await nextFrame()
    this.available = true
    await this.exitHover()
  }
}

@component
export class CurtainCancelScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const before = read()
    expect(before.aperture).toBe(0)
    const input = new InterruptibleCurtainInput()
    try {
      await input.beginDrag()
      const draft = await waitFor("uncommitted curtain movement", s => s.grab && s.draftAperture > before.aperture)
      expect(draft.revision).toBe(before.revision)
      input.loseInput()
      const cancelled = await waitFor("SIK input loss cancellation", s => !s.grab)
      expect(cancelled.revision).toBe(before.revision)
      expect(cancelled.aperture).toBe(before.aperture)
      expect(sorted(cancelled.observedRoles)).toEqual(sorted(before.observedRoles))
      expect(sorted(cancelled.possibleCulprits)).toEqual(sorted(before.possibleCulprits))
    } finally {
      await input.recover()
    }
    await input.trigger(target("CurtainHandle"))
    const recovered = await waitFor("input recovery commit", s => s.aperture === 1)
    expect(recovered.revision).toBe(before.revision + 1)
    await input.trigger(target("CloseCurtain"))
    await waitFor("recovered reverse", s => s.aperture === 0)
  }
}
