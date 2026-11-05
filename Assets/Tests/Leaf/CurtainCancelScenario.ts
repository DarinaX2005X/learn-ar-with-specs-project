import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep, nextFrame} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {target, waitFor, sorted} from "./CountercaseLeafProbe"
import {stageCopy, tap} from "./MuseumJourney"

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
    const handle = target("Use_CurtainHandle")
    await this.enterHover(handle)
    this.startSelecting()
    await nextFrame()
    this.overrideDragVector = handle.getTransform().getWorldTransform().multiplyDirection(new vec3(-1, 0, 0))
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
    const input = new InterruptibleCurtainInput()
    const before = await stageCopy(input)
    expect(before.aperture).toBe(1)
    try {
      await input.beginDrag()
      const draft = await waitFor("uncommitted curtain movement", s => s.preview && s.aperture < before.aperture)
      expect(draft.revision).toBe(before.revision)
      input.loseInput()
      const cancelled = await waitFor("SIK input loss cancellation", s => !s.preview)
      expect(cancelled.revision).toBe(before.revision)
      expect(cancelled.aperture).toBe(before.aperture)
      expect(sorted(cancelled.observedRoles)).toEqual(sorted(before.observedRoles))
      expect(sorted(cancelled.possibleCulprits)).toEqual(sorted(before.possibleCulprits))
    } finally {
      await input.recover()
    }
    await tap(input, "Use_CurtainHandle")
    const recovered = await waitFor("input recovery commit", s => s.aperture === 0)
    expect(recovered.revision).toBe(before.revision + 1)
    await tap(input, "Use_CurtainOpen")
    await waitFor("recovered reverse", s => s.aperture === 1)
  }
}
