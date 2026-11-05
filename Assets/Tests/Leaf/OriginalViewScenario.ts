import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findSceneObjectsByName,sleep} from "Leaf.lspkg/Utils/common/Utils"
import {findInteractablesByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sorted,CountercaseSnapshot} from "./CountercaseLeafProbe"
import {tap,alarmFrame,selectObservation,stageCopy} from "./MuseumJourney"
import {readStage,waitStage,openStored} from "./RemainingProbe"

function samePublicState(original:CountercaseSnapshot):void {
  const state=readStage()
  expect(state.caseId).toBe(original.caseId)
  expect(state.revision).toBe(original.revision)
  expect(state.tick).toBe(original.tick)
  expect(sorted(state.evidenceIds)).toEqual(sorted(original.evidenceIds))
}
function physicalTheatreScale():number {
  // Source-confirmed renderer root. Read the actual native transform, never set it.
  const roots=findSceneObjectsByName("Theatre").filter(o=>o.isEnabledInHierarchy)
  if(roots.length!==1) throw new Error(`Expected one active original Theatre, got ${roots.length}`)
  return roots[0]!.getTransform().getWorldScale().x
}

/** View target names confirmed by the physical-control owner. */
@component
export class OriginalViewScenario extends Scenario {
  async run():Promise<void> {
    await sleep(1500)
    const input=new DefaultLeafInteractor()
    const initial=await alarmFrame(input)
    await selectObservation(input,"Courier")
    await tap(input,"Use_PinGlass")
    await tap(input,"Use_EntryClockPrevious")
    const original=readStage()
    expect(original.tick).toBe(11)
    expect(original.evidenceIds.length).toBe(initial.evidenceIds.length+1)
    const copy=await stageCopy(input)
    await tap(input,"Use_CurtainClose")
    await waitStage("copy changed independently",s=>s.revision===copy.revision+1&&s.aperture===0)
    await tap(input,"Use_SaveFile")
    await waitStage("save normal author draft to shelf",s=>s.mode==="ready")
    await openStored(input,original.caseId,original.revision)
    samePublicState(original)
    expect(readStage().aperture).toBe(original.aperture)
    expect(findInteractablesByName("Use_CurtainHandle",undefined,true).length).toBe(0)
    expect(findInteractablesByName("Use_TakeRuby",undefined,true).length).toBe(0)
    const camera=WorldCameraFinderProvider.getInstance().getComponent().getTransform()
    const eye=camera.getWorldPosition(),rotation=camera.getWorldRotation()
    const assertViewerUnchanged=()=>{
      expect(camera.getWorldPosition().distance(eye)).toBeCloseTo(0,3)
      const q=camera.getWorldRotation()
      expect(Math.abs(q.w*rotation.w+q.x*rotation.x+q.y*rotation.y+q.z*rotation.z)).toBeCloseTo(1,4)
    }
    const museumScale=physicalTheatreScale()
    await tap(input,"Use_CaseViewHandle")
    await waitStage("normal view choice",s=>s.view?.mode==="choice")
    await tap(input,"Use_CaseViewSeated")
    const compact=await waitStage("compact case view",s=>s.view?.mode==="table")
    samePublicState(original)
    assertViewerUnchanged()
    expect(compact.view?.presentation?.tick).toBe(original.tick)
    const compactNativeScale=physicalTheatreScale()
    await tap(input,"Use_CaseViewStanding")
    const room=await waitStage("human case view",s=>s.view?.mode==="room")
    samePublicState(original)
    assertViewerUnchanged()
    expect(room.view?.presentation?.tick).toBe(original.tick)
    expect(physicalTheatreScale()/compactNativeScale).toBeCloseTo(1/.06,2)
    await tap(input,"Use_CaseViewBack")
    await waitStage("return to compact case",s=>s.view?.mode==="table")
    samePublicState(original)
    assertViewerUnchanged()
    expect(physicalTheatreScale()).toBeCloseTo(compactNativeScale,2)
    await tap(input,"Use_CaseViewClose")
    await waitStage("return to inhabited museum",s=>s.view?.mode==="museum")
    samePublicState(original)
    assertViewerUnchanged()
    expect(physicalTheatreScale()).toBeCloseTo(museumScale,2)
  }
}





