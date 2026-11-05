import {DefaultScenarioManager} from "Leaf.lspkg/Scenarios/scenario/manager/DefaultLeafScenarioManager"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"

/** Optional, standalone official LEAF client. Attach only for one serialized run,
 * then remove from the normal player scene. It never initializes game state. */
@component
export class CountercaseScenarioClient extends BaseScriptComponent {
  @input scenarioId: string = "countercase-public-recording"
  private started = false

  onAwake():void {
    this.createEvent("OnStartEvent").bind(()=>{
      if(this.started) return
      this.started=true
      this.runOnce().catch(error=>print(`[LEAF CLIENT] ${this.scenarioId} did not complete: ${String(error)}`))
    })
  }

  private async runOnce():Promise<void> {
    let ready=false
    for(let attempt=0;attempt<100;attempt++) {
      const hook=(global as any).countercaseLeaf
      if(hook&&typeof hook.read==="function") {
        const state=hook.read()
        if(state.mode==="detective") {ready=true;break}
        if(state.mode!=="starting") throw new Error(`Player precondition requires normal public mode, got ${state.mode}`)
      }
      await sleep(50)
    }
    if(!ready) throw new Error("Normal player did not initialize within5000ms; no game bootstrap was attempted")
    const manager=DefaultScenarioManager.getInstance()
    if(!manager.listScenarioIds().includes(this.scenarioId)) throw new Error(`Official LEAF index has no scenario ${this.scenarioId}`)
    const config=new ScenarioConfig(new Map(Object.entries(manager.listScenarioParameters(this.scenarioId))))
    print(`[LEAF CLIENT] Starting registered ${this.scenarioId} in the existing public session`)
    await manager.startScenario(this.scenarioId,config)
    print(`[LEAF CLIENT] Official manager completed ${this.scenarioId}; verify its PASSED line`)
  }
}
