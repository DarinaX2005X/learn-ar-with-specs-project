import {Board,FrameClue,projectVisibleSurface} from '../Domain/index';
import {roleSilhouette} from '../Scripts/TableKit/RoleSilhouette';
/** Only public observed polygons enter this renderer. No history, actor or vault input. */
export class RecordedGlass {
 private objects:SceneObject[]=[];
 private roles:string[]=[];
 constructor(private parent:SceneObject,private material:Material){}
 render(board:Board,frame:FrameClue|undefined,zoom=false){
  this.clear();if(!frame)return;
  for(const fragment of frame.payload.fragments){
   const triangles=projectVisibleSurface(board,frame.witness,fragment,roleSilhouette(fragment.role));
   if(!triangles.length)continue;
   const builder=new MeshBuilder([{name:'position',components:3},{name:'normal',components:3},{name:'texture0',components:2}]);builder.topology=MeshTopology.Triangles;builder.indexType=MeshIndexType.UInt16;
   const vertices:number[]=[];const indices:number[]=[];
   for(const tri of triangles)for(const point of tri){
    const h=point.horizontal,v=point.vertical;
    const x=zoom?(h-fragment.projection.horizontal)*160+(fragment.via==='mirror'?5:-5):Math.tan(h)/Math.tan(Math.PI/3)*12;
    const y=zoom?(v-fragment.projection.vertical)*160:Math.tan(v)*Math.sqrt(1+Math.tan(h)**2)/Math.tan(Math.PI*.4)*6;
    vertices.push(x,y,0,0,0,1,0,0);indices.push(indices.length);
   }
   builder.appendVerticesInterleaved(vertices);builder.appendIndices(indices);builder.updateMesh();
   const o=global.scene.createSceneObject('Recorded_'+(fragment.role||'Unknown'));o.setParent(this.parent);const visual=o.createComponent('Component.RenderMeshVisual');visual.mesh=builder.getMesh();const material=this.material.clone();material.mainPass.baseColor=new vec4(.83,.99,.95,1);visual.mainMaterial=material;this.objects.push(o);if(fragment.role)this.roles.push(fragment.role);
  }
 }
 get renderedRoles():string[]{return this.roles.slice();}
 clear(){for(const o of this.objects)o.destroy();this.objects=[];this.roles=[];}
}
