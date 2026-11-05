import { Board, FrameClue } from '../Domain/types';
import { projectVisibleSurface } from '../Domain/projectSurface';
import { roleSilhouette } from '../Scripts/TableKit/RoleSilhouette';
import { ObservedFragment, WitnessView } from '../Scripts/TableKit/TableKit';
/** Recorded angular glass. Its depth is fixed, so walking around it cannot
 * recover an unseen side of a figure or a hidden author pose. */
export function observationGlass(board:Board,frame:FrameClue,depthCm=18):WitnessView {
 const fragments:ObservedFragment[]=[];
 for(const [index,fragment] of frame.payload.fragments.entries()) {
  const triangles=projectVisibleSurface(board,frame.witness,fragment,roleSilhouette(fragment.role));
  const vertices:([number,number,number])[]=triangles.flatMap(t=>t.map(p=>[Math.tan(p.horizontal)*depthCm,Math.tan(p.vertical)*depthCm,0] as [number,number,number]));
  if(vertices.length)fragments.push({id:`${frame.id}/${index}`,verticesCm:vertices,indices:vertices.map((_,i)=>i),material:fragment.role==='Guard'?'clothTeal':fragment.role==='Courier'?'brass':fragment.role==='Conservator'?'limestone':'anonymous',roleMark:fragment.role});
 }
 return {kind:'witness',revision:`${board.caseId}/${board.rev}/${frame.id}`,fragments,aperture:board.room.mirror?.aperture??0};
}
