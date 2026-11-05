import { Board, Claim, Clue, Field, History, Role, SealedCase, Verdict } from '../Domain/types';
import { proveSteps } from '../Domain/prove';
import { observe } from '../Domain/observe';
import { reconstructionIssue } from './Reconstruction';

const copy = <T>(value:T):T => JSON.parse(JSON.stringify(value));
export type DetectiveMode = 'table' | 'witness' | 'reconstruction';
export interface EvidenceGlass { id:string; clue:Clue; selected:boolean; }
export interface DetectiveState {
 caseId:string; rev:number; mode:DetectiveMode; tick:number; source:string;
 playing:boolean; selected?:string; glass:EvidenceGlass[]; visibleGlass:EvidenceGlass[]; glassPage:number; frame?:Clue;
 claim:Claim; checking:boolean; verdict?:Verdict; message:string;
 reconstruction?:History; reasons:Clue[]; completed:boolean;
 fields:Partial<Record<Field,{value:string|number; reasonIds:string[]}>>;
}
export interface DetectiveArchive { caseId:string; rev:number; tick:number; source:string; ids:string[]; claim:Claim; }
export interface DetectivePort {
 /** Render only this public snapshot. Never query an author renderer. */
 render(state:DetectiveState, board:Board):void;
 revealTheft?(caseId:string, rev:number):void;
 returnToCases?():void;
 clear():void;
}
export type DetectiveAction =
 | {type:'seek'; tick:number} | {type:'step'; delta:number}
 | {type:'play'|'freeze'|'replay'|'table'|'inspect'|'pin'|'remove'|'undo'|'check'|'checkAll'|'returnObservations'|'reveal'|'finish'}
 | {type:'tabPage'; delta:number} | {type:'source'; source:string} | {type:'selectClue'; id:string}
 | {type:'pinClue'; id:string; caseId:string; rev:number}
 | {type:'claim'; claim:Claim} | {type:'version'; role:Role}
 | {type:'hypothesis'; history:History; all?:boolean} | {type:'comparePair'; first:History; second:History; all?:boolean};

/** The sole investigation input is the sealed public snapshot. A gesture and
 * its accessible button dispatch the same action exactly once. */
export class DetectiveSession {
 private readonly sealed:SealedCase;
 private state:DetectiveState;
 private ids:string[]=[];
 private removed?:{id:string; index:number};
 private task?:Generator<{work:number},Verdict,void>;
 private generation=0;
 private taskGeneration=0;
 private disposed=false;
 private elapsed=0;
 private slices=0;
 private restore?:{mode:DetectiveMode;tick:number;source:string;selected?:string};
 constructor(sealed:SealedCase, private readonly port:DetectivePort, private readonly workLimit=100000) {
  if(sealed.caseId!==sealed.board.caseId||sealed.rev!==sealed.board.rev||sealed.clues.caseId!==sealed.caseId||sealed.clues.rev!==sealed.rev)throw new Error('Open a matching sealed case');
  this.sealed=copy(sealed);
  this.state={caseId:sealed.caseId,rev:sealed.rev,mode:'table',tick:sealed.board.alarmTick,source:sealed.board.witnesses[0]?.id??'',playing:false,glass:[],visibleGlass:[],glassPage:0,claim:{},checking:false,message:'Who took the ruby?',reasons:[],completed:false,fields:{}};
  this.emit();
 }
 sources():string[] {return this.sealed.board.witnesses.map(w=>w.id);}
 snapshot():DetectiveState { return copy(this.state); }
 archive():DetectiveArchive {return copy({caseId:this.sealed.caseId,rev:this.sealed.rev,tick:this.state.tick,source:this.state.source,ids:this.ids,claim:this.state.claim});}
 restoreArchive(saved:DetectiveArchive):boolean {
  if(saved.caseId!==this.sealed.caseId||saved.rev!==this.sealed.rev||!Array.isArray(saved.ids)||saved.ids.some(id=>!this.sealed.clues.clues.some(c=>c.id===id))||!this.sealed.board.witnesses.some(w=>w.id===saved.source)||!Number.isFinite(saved.tick))return false;
  this.ids=[...new Set(saved.ids)];this.state.source=saved.source;this.seek(saved.tick);this.state.claim=copy(saved.claim);this.state.mode='table';this.state.reconstruction=undefined;this.restore=undefined;this.invalidate();this.emit();return true;
 }
 dispatch(action:DetectiveAction):void {
  if(this.disposed)return;
  switch(action.type) {
   case 'seek': this.seek(action.tick); break;
   case 'step': this.seek(this.state.tick+action.delta); break;
   case 'play': this.state.playing=true; break;
   case 'freeze': this.state.playing=false; break;
   case 'replay': this.seek(this.sealed.board.alarmTick);this.state.playing=true;break;
   case 'tabPage': this.state.glassPage=Math.max(0,Math.min(Math.max(0,Math.ceil(this.ids.length/3)-1),this.state.glassPage+Math.sign(action.delta)));break;
   case 'source': if(this.sealed.board.witnesses.some(w=>w.id===action.source)){this.state.source=action.source;this.state.mode='witness';this.state.selected=undefined;} break;
   case 'inspect': this.state.mode='witness';break;
   case 'table': this.state.mode='table'; break;
   case 'selectClue': this.select(action.id);break;
   case 'pin': {const clue=this.currentFrame();if(clue)this.pin(clue.id);break;}
   case 'pinClue': if(action.caseId===this.sealed.caseId&&action.rev===this.sealed.rev)this.pin(action.id);else this.state.message='Open evidence from this sealed case';break;
   case 'remove': {const i=this.ids.indexOf(this.state.selected??'');if(i>=0){this.removed={id:this.ids[i],index:i};const id=this.ids.splice(i,1)[0];this.invalidate([id]);this.state.selected=this.ids[Math.min(i,this.ids.length-1)];}break;}
   case 'undo': if(this.removed){this.ids.splice(this.removed.index,0,this.removed.id);this.state.selected=this.removed.id;this.removed=undefined;this.invalidate();}break;
   case 'claim': this.state.claim=copy(action.claim);this.invalidate();break;
   case 'check': this.check(this.state.claim);break;
   case 'checkAll': this.check('Underdetermined');break;
   case 'version': {const h=this.state.verdict?.examplesByCulprit[action.role];if(h){this.restore??={mode:this.state.mode,tick:this.state.tick,source:this.state.source,selected:this.state.selected};this.state.mode='reconstruction';this.state.reconstruction=copy(h);this.state.playing=false;this.state.message='Possible reconstruction';}break;}
   case 'returnObservations': if(this.restore){Object.assign(this.state,this.restore);this.restore=undefined;this.state.reconstruction=undefined;}break;
   case 'comparePair': this.comparePair(action.first,action.second,!!action.all);break;
   case 'hypothesis': this.compare(action.history,!!action.all);break;
   case 'reveal': if(this.state.completed)this.port.revealTheft?.(this.sealed.caseId,this.sealed.rev);break;
   case 'finish': this.port.returnToCases?.();break;
  }
  this.emit();
 }
 /** At most two 32-work solver slices per frame. Never run proof in render. */
 update(seconds:number):void {
  if(this.disposed)return;
  if(this.state.playing&&Number.isFinite(seconds)&&seconds>0){this.elapsed+=Math.min(seconds,.25);while(this.elapsed>=.5){this.elapsed-=.5;this.state.tick=Math.min(24,this.state.tick+1);if(this.state.tick===24)this.state.playing=false;}}
  if(this.task){for(let i=0;i<2&&this.task;i++){if(++this.slices>4096){this.task=undefined;this.state.checking=false;this.state.completed=false;this.state.message='The check did not finish. Try again';break;}const result=this.task.next();if(result.done){this.task=undefined;if(this.taskGeneration===this.generation)this.accept(result.value);}}}
  this.emit();
 }
 dispose():void {this.disposed=true;this.task=undefined;this.port.clear();}
 private seek(tick:number):void {if(!Number.isFinite(tick))return;this.state.tick=Math.max(0,Math.min(24,Math.round(tick)));this.state.playing=false;this.elapsed=0;this.state.selected=undefined;}
 private currentFrame():Clue|undefined {return this.sealed.clues.clues.find(c=>c.kind==='Frame'&&c.witness===this.state.source&&c.tick===this.state.tick);}
 private select(id:string):void {const c=this.sealed.clues.clues.find(c=>c.id===id);if(!c)return;this.state.selected=id;this.state.playing=false;if(c.kind==='Frame'){this.state.tick=c.tick;this.state.source=c.witness;this.state.mode='witness';}else this.state.mode='table';}
 private pin(id:string):void {
  if(this.state.mode==='reconstruction')return;
  const c=this.sealed.clues.clues.find(c=>c.id===id);if(!c)return;
  if(c.kind==='Frame'&&(!c.payload.fragments.length&&!c.payload.actions.length&&!c.payload.hands.length)) {this.state.message='No one is identifiable in this frame';return;}
  if(!this.ids.includes(id)){this.ids.push(id);this.invalidate();}this.state.selected=id;this.state.glassPage=Math.floor(this.ids.indexOf(id)/3);
 }
 private invalidate(removed:string[]=[]):void {
  this.generation++;this.task=undefined;this.state.checking=false;this.state.verdict=undefined;this.state.completed=false;this.state.reasons=[];
  for(const field of Object.keys(this.state.fields) as Field[])if(!removed.length||this.state.fields[field]!.reasonIds.some(id=>removed.includes(id)))delete this.state.fields[field];
  this.state.message='Check accusation';
 }
 private check(claim:Claim):void {
  if(this.task)return;
  if(typeof claim==='object'&&!Object.keys(claim).length){this.state.message='Choose a person or a finding';return;}
  this.slices=0;this.state.claim=copy(claim);this.taskGeneration=this.generation;const generation=this.generation;
  this.task=proveSteps(this.sealed.board,this.sealed.clues,this.ids,claim,{maxHistories:this.workLimit,cancelled:()=>this.disposed||generation!==this.generation});this.state.checking=true;this.state.message='Checking the evidence';
 }
 private accept(verdict:Verdict):void {
  this.state.checking=false;this.state.verdict=verdict;this.state.reasons=this.sealed.clues.clues.filter(c=>verdict.reasonIds.includes(c.id));
  this.state.completed=verdict.status==='proved'||(verdict.status==='ambiguous'&&verdict.scope==='all');
  const messages:Record<Verdict['status'],string>={proved:'The evidence proves this finding',contradicted:'This finding conflicts with the evidence',needClue:'Another person could still have taken it',ambiguous:'Different thefts fit every observation',conflict:'These observations cannot describe one case',incomplete:'The check did not finish. Try again'};
  this.state.message=messages[verdict.status];
  if((verdict.status==='proved'||verdict.status==='ambiguous')&&typeof this.state.claim==='object')for(const field of Object.keys(this.state.claim) as Field[]){const value=this.state.claim[field];if(value!==undefined)this.state.fields[field]={value:value==='Underdetermined'?'Could be either':value,reasonIds:[...verdict.reasonIds]};}
 }
 private comparePair(first:History,second:History,all:boolean):void {
  const issue=reconstructionIssue(this.sealed.board,first)??reconstructionIssue(this.sealed.board,second);
  if(issue){this.state.message=issue;return;}
  const a=observe(this.sealed.board,first),b=observe(this.sealed.board,second);
  const different=a.clues.find(c=>(all||this.ids.includes(c.id))&&JSON.stringify(c)!==JSON.stringify(b.clues.find(p=>p.id===c.id)));
  if(!different){this.state.reasons=[];this.state.message=all?'These two histories have the same observations':'These two histories match the selected evidence';return;}
  this.select(different.id);this.state.reasons=[copy(different),copy(b.clues.find(c=>c.id===different.id)!)];this.state.message='These observations differ';
 }
 private compare(history:History,all:boolean):void {
  const issue=reconstructionIssue(this.sealed.board,history);if(issue){this.state.message=issue;this.state.reasons=[];return;}
  const proposed=observe(this.sealed.board,copy(history));
  const mismatch=this.sealed.clues.clues.find(c=>(all||this.ids.includes(c.id))&&JSON.stringify(c)!==JSON.stringify(proposed.clues.find(p=>p.id===c.id)));
  if(mismatch){this.select(mismatch.id);this.state.reasons=[copy(mismatch),copy(proposed.clues.find(p=>p.id===mismatch.id)!)].filter(Boolean);this.state.message='These observations differ';}
  else this.state.message=all?'These two histories have the same observations':'These two histories match the selected evidence';
 }
 private emit():void {
  this.state.frame=this.currentFrame();this.state.glass=this.ids.map(id=>({id,clue:copy(this.sealed.clues.clues.find(c=>c.id===id)!),selected:id===this.state.selected}));
  this.state.visibleGlass=this.state.glass.slice(this.state.glassPage*3,this.state.glassPage*3+3);
  this.port.render(this.snapshot(),copy(this.sealed.board));
 }
}





