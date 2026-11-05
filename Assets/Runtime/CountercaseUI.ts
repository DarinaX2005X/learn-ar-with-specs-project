import {Button} from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/Button';
import {FlexLayout} from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout';
import {FlexItem} from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem';
import {FlexAlign,FlexDirection,FlexJustify} from 'SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes';
const TYPE={title:{size:93,weight:700},body:{size:39,weight:500},button:{size:39,weight:500}};
@component
export class CountercaseUI extends BaseScriptComponent {
 public onAction:(action:string)=>void=()=>{};
 private accusation:SceneObject;private result:Text; private evidence:Text; private clock:Text;
 onAwake(){this.createEvent('OnStartEvent').bind(()=>this.build());}
 private obj(parent:SceneObject,name:string):SceneObject{const o=global.scene.createSceneObject(name);o.setParent(parent);return o;}
 private text(parent:SceneObject,label:string,width:number,role:keyof typeof TYPE='body'):Text{
 const o=this.obj(parent,'Label');o.getTransform().setLocalPosition(new vec3(0,0,.15));const t=o.createComponent('Component.Text');t.text=label;t.depthTest=true;t.size=TYPE[role].size;(t as Text & {weight?:number}).weight=TYPE[role].weight;t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;t.horizontalOverflow=HorizontalOverflow.Overflow;t.layoutRect=Rect.create(-width/2,width/2,-1.6,1.6);return t;}
 private row(parent:SceneObject,width:number,height:number):SceneObject{const o=this.obj(parent,'ControlRow');const f=o.createComponent(FlexLayout.getTypeName()) as FlexLayout;f.autoDiscoverItemsOnStart=false;f.onInitialized.add(()=>{f.width=width;f.height=height;f.direction=FlexDirection.Row;f.columnGap=1.2;f.justifyContent=FlexJustify.Center;f.alignItems=FlexAlign.Center;});return o;}
 private cell(row:SceneObject,name:string,width:number,height:number):SceneObject{const o=this.obj(row,name);const i=o.createComponent(FlexItem.getTypeName()) as FlexItem;i.overrideWidth=width;i.overrideHeight=height;i.flexShrink=0;(row.getComponent(FlexLayout.getTypeName()) as FlexLayout).addItems([i]);return o;}
 private button(row:SceneObject,id:string,label:string,width:number){const o=this.cell(row,id,width,4);const b=o.createComponent(Button.getTypeName()) as Button;b.setVariant({theme:'SnapOS3',shape:'Rectangle',style:'Secondary'});b.size=new vec3(width,4,1);this.text(o,label,width-1,'button');b.onTriggerUp.add(()=>this.onAction(id));}
 private build(){
 const root=this.sceneObject;root.createComponent('Component.Canvas');
 const title=this.obj(root,'CaseTitle');title.getTransform().setLocalPosition(new vec3(0,16,-4));this.text(title,'The Missing Ruby',52,'body');
 const status=this.obj(root,'Verdict');status.getTransform().setLocalPosition(new vec3(0,12,-4));this.result=this.text(status,'Two suspects fit',52);
 const glass=this.obj(root,'FixedRecording');glass.getTransform().setLocalPosition(new vec3(0,9,20));this.evidence=this.text(glass,'Entrance camera  |  Courier',52);
 const bar=this.obj(root,'PlaybackControls');bar.getTransform().setLocalPosition(new vec3(0,-5,24));const r=this.row(bar,60,5);this.button(r,'ReplayAlarm','Replay the alarm',16);this.button(r,'RewindAlarm','Freeze at 6.0 s',16);const clock=this.cell(r,'Time',9,4);this.clock=this.text(clock,'6.0 s',8);
 const edit=this.obj(root,'MirrorControls');edit.getTransform().setLocalPosition(new vec3(0,-11,24));const er=this.row(edit,60,5);this.button(er,'OpenCurtain','Open mirror',14);this.button(er,'CloseCurtain','Close mirror',14);this.button(er,'ComparePrevious','Previous recording',18);
 const claim=this.obj(root,'Accusations');this.accusation=claim;claim.enabled=false;claim.getTransform().setLocalPosition(new vec3(0,-17,24));const cr=this.row(claim,60,5);this.button(cr,'AccuseGuard','Guard',12);this.button(cr,'AccuseConservator','Conservator',16);this.button(cr,'AccuseCourier','Courier',12);
 }
 public updateState(result:string,evidence:string,tick:number){if(this.accusation)this.accusation.enabled=result.startsWith('Only ');if(this.result)this.result.text=result;if(this.evidence)this.evidence.text=evidence;if(this.clock)this.clock.text=(tick*.5).toFixed(1)+' s';}
}

