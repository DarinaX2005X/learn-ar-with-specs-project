import { Board, History, ROLES } from '../Domain/types';
/** A proposed reconstruction must use only legal public action windows. */
export function reconstructionIssue(board:Board,history:History):string|undefined {
 if(!history||!history.casting||!Array.isArray(history.brushes))return 'Place each person on a different path';
 const roles=['A','B','C'].map(id=>history.casting[id as 'A'|'B'|'C']);
 if(new Set(roles).size!==3||roles.some(role=>!ROLES.includes(role)))return 'Place each person on a different path';
 if(!board.windows.take.includes(history.take))return 'This path cannot reach the ruby at the alarm';
 if(new Set(history.brushes.map(b=>b.track)).size!==history.brushes.length||history.brushes.some(b=>!board.windows.brush[b.track]?.includes(b.tick)))return 'This contact cannot reach the rim';
 if(history.pass&&(!board.chain||history.pass.from!==history.take||!board.windows.pass.some(p=>p.from===history.pass!.from&&p.to===history.pass!.to&&p.tick===history.pass!.tick)))return 'These hands do not meet here';
 const carrier=history.pass?.to??history.take;
 if(history.stash&&(!board.chain||history.stash.carrier!==carrier||history.stash.tick<=(history.pass?.tick??board.alarmTick)||!board.windows.stash.some(s=>s.carrier===history.stash!.carrier&&s.box===history.stash!.box&&s.tick===history.stash!.tick)))return 'This hand cannot reach that box here';
 return undefined;
}
