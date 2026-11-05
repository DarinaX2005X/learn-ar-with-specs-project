import {read, waitFor, CountercaseSnapshot} from "./CountercaseLeafProbe"
import {tap} from "./MuseumJourney"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"

/** Proposed read-only additions from existing public sessions/renderers.
 * These scenarios require the live hook mappings before native execution. */
export interface RemainingSnapshot extends CountercaseSnapshot {
  shelf: {id:string;rev:number;state:string}[]
  caseTargets: {targetName:string;id:string;rev:number}[]
  objects: {id:string;kind:string;box?:string}[]
  boxes: {id:string}[]
  fields: Record<string,{value:string|number;scope:"selected"|"all";reasonIds:string[]} | undefined>
  completed:boolean
  verdictScope?:"selected"|"all"
  comparison?: {active:boolean;caseId?:string;rev?:number;tick?:number;field?:string;scope?:string;visibleWings:number;issue?:string}
  view?: {mode:"museum"|"choice"|"table"|"room";available:boolean;caseId?:string;rev?:number;presentation?:{kind:"table"|"room";tick:number;placement:{scale:number};handlePlacement:{scale:number}}}
}
export const readStage = () => read() as RemainingSnapshot
export async function waitStage(label:string, predicate:(s:RemainingSnapshot)=>boolean):Promise<RemainingSnapshot> {
  return await waitFor(label,s=>predicate(s as RemainingSnapshot)) as RemainingSnapshot
}
export async function openStored(input:DefaultLeafInteractor,id:string,rev:number):Promise<void> {
  const pages=Math.max(1,Math.ceil(readStage().shelf.length/3))
  for(let page=0;page<pages;page++) {
    const actual=readStage().caseTargets.find(t=>t.id===id&&t.rev===rev)
    if(actual) {
      await tap(input,actual.targetName)
      await waitStage("open selected public spine",s=>s.mode==="detective"&&s.caseId===id&&s.revision===rev)
      return
    }
    if(page+1<pages) await tap(input,"Use_RackPage")
  }
  throw new Error(`No normal visible shelf target for ${id}/${rev}`)
}
export async function inspectBox(input:DefaultLeafInteractor,box:string):Promise<void> {
  const clue=readStage().objects.find(c=>c.kind==="Box"&&c.box===box)
  if(!clue) throw new Error(`No public physical Box clue for ${box}`)
  // Exact PlayTable source binding: bindObject("Inspect" + clue.id).
  await tap(input,"Use_Inspect"+clue.id)
  await tap(input,"Use_PinGlass")
}

