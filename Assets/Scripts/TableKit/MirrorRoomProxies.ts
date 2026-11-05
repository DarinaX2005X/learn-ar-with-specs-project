import {Occluder,P} from './LiveMirrorGeometry';
/** Physical F003 gallery bounds, metres. These are visual occluders, never solver inputs. */
export function museumMirrorOccluders(exhibit?:{x:number;y:number;z:number}):Occluder[]{
 const walls:Occluder[]=[];
 const wall=(a:P,b:P,bottom=0,top=3.8)=>walls.push({a,b,bottom,top});
 // Real hall/foyer doorway x2.3..4.7 and workshop doorway z1.5..3.5.
 wall([0,0,0],[2.3,0,0]);wall([4.7,0,0],[7,0,0]);
 wall([0,0,0],[0,0,1.5]);wall([0,0,3.5],[0,0,5]);wall([0,0,5],[7,0,5]);
 // Source head/torso lies below the2.12m spring; arch soffits cannot affect it.
 wall([2.3,0,0],[4.7,0,0],3.32,3.8);
 wall([0,0,1.5],[0,0,3.5],3.12,3.8);
 // Do not create an opaque wall across the actual active mirror niche on x7.
 if(exhibit&&[exhibit.x,exhibit.y,exhibit.z].every(Number.isFinite)) {
  const box=(halfX:number,halfZ:number,bottom:number,top:number)=>{const x=exhibit.x,z=exhibit.z;wall([x-halfX,0,z-halfZ],[x+halfX,0,z-halfZ],bottom,top);wall([x+halfX,0,z-halfZ],[x+halfX,0,z+halfZ],bottom,top);wall([x+halfX,0,z+halfZ],[x-halfX,0,z+halfZ],bottom,top);wall([x-halfX,0,z+halfZ],[x-halfX,0,z-halfZ],bottom,top);};
  // Measured inscribed footprints: don't fill beveled corners or the hollow gem seat.
  box(.23,.23,0,.0817);box(.21,.21,.0817,.1389);box(.115,.115,.1389,.8824);box(.22,.22,.878,.9355);box(.17,.17,.933,.982);
 }
 return walls;
}
