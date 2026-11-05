import {Mirror} from '../../Domain/types';
import {curtainVisual} from './TableKit';
export type CurtainPoint=readonly [number,number,number];
/** Source Curtain.glb units are metres; room-facing, back-wound pleat edges are Z=-.00795.
 * Keep the visible edge ON the authoritative mirror plane, with3.33mm real folds
 * behind it and .46mm cloth thickness. No recording/aperture change is made.
 */
export const CURTAIN_FRAME={sourceRailZ:-.007,sourceVisibleEdgeZ:-.00795,foldDepthScale:.05,storyCmPerModelUnit:10000/6,foldCount:12} as const;
export function mirrorCurtainPlacement(m:Mirror,aperture=m.aperture){
 const visual=curtainVisual(aperture),yaw=Math.atan2(-m.normal.x,-m.normal.z);
 const modelRight={x:Math.cos(yaw),y:0,z:-Math.sin(yaw)};
 const sign=modelRight.x*m.right.x+modelRight.y*m.right.y+modelRight.z*m.right.z;
 const aligned=Math.abs(Math.abs(sign)-1)<=1e-5&&Math.abs(m.up.y-1)<=1e-5;
 const axisSign=sign<0?-1:1;
 const backsetCm=-CURTAIN_FRAME.sourceRailZ*CURTAIN_FRAME.storyCmPerModelUnit;
 const rootStoryCm:CurtainPoint=[m.origin.x*100-m.normal.x*backsetCm,m.origin.y*100-m.height*60-m.normal.y*backsetCm,m.origin.z*100-m.normal.z*backsetCm];
 const foldZ=CURTAIN_FRAME.sourceRailZ-CURTAIN_FRAME.sourceVisibleEdgeZ*CURTAIN_FRAME.foldDepthScale;
 const folds=visual.foldXCm.map((x,index)=>{
  const desiredX=x*.01/axisSign,bindRingX=(-3+(index+.5)*.5)*.01;
  return {foldPosition:[desiredX,0,foldZ] as CurtainPoint,foldScale:[visual.foldScaleX,1,CURTAIN_FRAME.foldDepthScale] as CurtainPoint,ringPosition:[desiredX-bindRingX,0,0] as CurtainPoint};
 });
 const handleLocal:CurtainPoint=[visual.handleXCm*.01/axisSign,.053,-.0105];
 const u=(-.5+visual.aperture)*m.width*100;
 const frontCm=(.0105-.007)*CURTAIN_FRAME.storyCmPerModelUnit;
 const handleStoryCm:CurtainPoint=[m.origin.x*100+m.right.x*u-m.up.x*m.height*7+m.normal.x*frontCm,m.origin.y*100+m.right.y*u-m.up.y*m.height*7+m.normal.y*frontCm,m.origin.z*100+m.right.z*u-m.up.z*m.height*7+m.normal.z*frontCm];
 return {visual,yaw,aligned,rootStoryCm,folds,handleLocal,handleStoryCm};
}
