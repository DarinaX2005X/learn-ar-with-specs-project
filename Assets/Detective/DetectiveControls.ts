import { DetectiveAction, DetectiveSession } from './DetectiveSession';
export interface DetectiveControl {
 id:string;
 label:string;
 action:DetectiveAction;
}
/** The scene supplies real SIK/focus targets for these actions. Same action
 * object handles a pinch, glass drag/drop and a focusable equivalent. */
export function detectiveControls(session:DetectiveSession):DetectiveControl[] {
 const s=session.snapshot();
 const controls:DetectiveControl[]=[
  {id:'replay',label:'Replay the alarm',action:{type:'replay'}},
  {id:'freeze',label:s.playing?'Pause':'Play',action:{type:s.playing?'freeze':'play'}},
  {id:'previous',label:'Previous frame',action:{type:'step',delta:-1}},
  {id:'next',label:'Next frame',action:{type:'step',delta:1}},
  {id:'table',label:'Back to table',action:{type:'table'}},
  {id:'inspect',label:'Watch this view',action:{type:'inspect'}},
 ];
 if(s.mode!=='reconstruction')controls.push({id:'pin',label:'Pin evidence',action:{type:'pin'}});
 if(s.selected&&s.glass.some(g=>g.id===s.selected))controls.push({id:'remove',label:'Remove evidence',action:{type:'remove'}});
 controls.push({id:'undo',label:'Undo',action:{type:'undo'}});
 for(const role of ['Courier','Guard','Conservator'] as const)controls.push({id:`claim-${role}`,label:role,action:{type:'claim',claim:role}});
 controls.push({id:'check',label:'Check accusation',action:{type:'check'}},{id:'all',label:'Different thefts fit',action:{type:'checkAll'}});
 for(const source of session.sources())controls.push({id:'source-'+source,label:source,action:{type:'source',source}});
 if(s.glass.length>3)controls.push({id:'tabs-back',label:'Previous evidence',action:{type:'tabPage',delta:-1}},{id:'tabs-next',label:'Next evidence',action:{type:'tabPage',delta:1}});
 for(const glass of s.visibleGlass)controls.push({id:`glass-${glass.id}`,label:glass.clue.kind==='Frame'?`${glass.clue.witness} ${(glass.clue.tick/2).toFixed(1)}`:glass.clue.kind==='Rim'?'Rim mark':glass.clue.box,action:{type:'selectClue',id:glass.id}});
 for(const role of s.verdict?.possibleCulprits??[])controls.push({id:`version-${role}`,label:`See ${role.toLowerCase()} version`,action:{type:'version',role}});
 if(s.mode==='reconstruction')controls.push({id:'return',label:'Back to observations',action:{type:'returnObservations'}});
 if(s.completed)controls.push({id:'reveal',label:'Reveal the theft',action:{type:'reveal'}});
 return controls;
}
export interface DetectiveInputPort { bind(id:string,invoke:()=>void):()=>void; }
/** Rebind when control identity changes, then dispose before changing roles. */
export function bindDetectiveControls(session:DetectiveSession,input:DetectiveInputPort):()=>void {
 const unbind=detectiveControls(session).map(control=>input.bind(control.id,()=>session.dispatch(control.action)));
 return ()=>unbind.forEach(dispose=>dispose());
}



