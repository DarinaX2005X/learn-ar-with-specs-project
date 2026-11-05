import { rubyFacetReflection } from './MuseumEffects';

/** One existing planar cut face only. No added glow, mesh, timer, or game inputs. */
export class RubyFacetFinish {
  private visual: RenderMeshVisual | undefined;
  private original: Material | undefined;
  private material: Material | undefined;
  private base: vec4 | undefined;
  private last = -1;
  constructor(private ruby: SceneObject | undefined) {
    if(!ruby) return;
    const find=(node:SceneObject):SceneObject|undefined=>{
      if(node.name==='RubyLightFacet') return node;
      for(let i=0;i<node.getChildrenCount();i++){const found=find(node.getChild(i));if(found)return found;}
      return undefined;
    };
    this.facet=find(ruby);
    this.visual=this.facet?.getComponent('Component.RenderMeshVisual') as RenderMeshVisual | undefined;
    if(!this.visual) return;
    this.original=this.visual.mainMaterial;
    const color=this.original.mainPass.baseColor;
    if(!color || ![color.x,color.y,color.z,color.w].every(Number.isFinite)) return;
    this.base=new vec4(color.x,color.y,color.z,color.w);
    this.material=this.original.clone();
    this.visual.mainMaterial=this.material;
  }
  private facet: SceneObject | undefined;
  private visible():boolean {
    let node=this.facet;
    for(let i=0;node && i<64;i++,node=node.getParent()) if(!node.enabled) return false;
    return !!this.facet && !!this.ruby?.enabled;
  }
  update(eyeWorld: readonly [number,number,number], keyLightWorld: readonly [number,number,number] | undefined):number {
    if(!this.material || !this.base || !this.facet) return 0;
    let reflection=0;
    if(keyLightWorld && this.visible()) {
      const t=this.facet.getTransform(),p=t.getWorldPosition();
      // Shipped RubyLightFacet's two triangles both have local normal +Y.
      const n=t.getWorldTransform().multiplyDirection(new vec3(0,1,0));
      reflection=rubyFacetReflection({visible:true,facetWorldNormal:[n.x,n.y,n.z],
        towardEye:[eyeWorld[0]-p.x,eyeWorld[1]-p.y,eyeWorld[2]-p.z],
        towardLight:[keyLightWorld[0]-p.x,keyLightWorld[1]-p.y,keyLightWorld[2]-p.z]});
    }
    if(!Number.isFinite(reflection)) reflection=0;
    if(Math.abs(reflection-this.last)>1e-5) {
      // Reflected face ink, not emission: retain original hue/alpha and base palette.
      this.material.mainPass.baseColor=new vec4(
        this.base.x+(1-this.base.x)*reflection,
        this.base.y+(0.88-this.base.y)*reflection,
        this.base.z+(0.78-this.base.z)*reflection,this.base.w);
      this.last=reflection;
    }
    return reflection;
  }
  clear():void { this.update([NaN,NaN,NaN],undefined); }
  dispose():void { this.clear();if(this.visual && this.original)this.visual.mainMaterial=this.original; }
}
