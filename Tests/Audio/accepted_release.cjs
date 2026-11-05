const queuedDisables=[];
class UIEvent{handlers=[];add(f){this.handlers.push(f)}fire(e={}){for(const f of [...this.handlers])f(e)}}
class UIVec{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}}
class UIInput{static getTypeName(){return 'Interactable'}constructor(){for(const n of ['onDragStart','onDragUpdate','onDragEnd','onHoverEnter','onHoverExit','onTriggerStart','onTriggerEnd','onTriggerCanceled','onTriggerEndOutside'])this[n]=new UIEvent()}}
class UIObject{constructor(name){this.name=name;this.children=[];this.components=[];this._enabled=true}set enabled(v){const old=this._enabled;this._enabled=v;if(old&&!v)for(const c of this.components)if(c instanceof UIInput)queuedDisables.push(()=>c.onTriggerCanceled.fire())}get enabled(){return this._enabled}setParent(p){this.parent=p;(p.children??=[]).push(this)}destroy(){this._enabled=false}getChildrenCount(){return this.children.length}getChild(i){return this.children[i]}getTransform(){return {setLocalPosition(){},setWorldPosition(){},setLocalRotation(){},setLocalScale(){},getLocalPosition:()=>new UIVec(),getInvertedWorldTransform:()=>({multiplyPoint:p=>p})}}createComponent(type){if(type==='AuthorController'){const C=load(path.join(assets,'Author/AuthorController.ts')).AuthorController;const c=new C();c.onAwake();return c;}const c=type==='Interactable'?new UIInput():{textFill:{}};this.components.push(c);return c}}
const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  assert = require("assert");
// npm exec adds the requested package's .bin directory to PATH. Resolve its
// sibling module, rather than choosing an unrelated compiler from npm's cache.
const compilerDirectory = process.env.PATH.split(path.delimiter).find(
  (directory) => {
    const manifest = path.resolve(directory, "../typescript/package.json");
    return (
      fs.existsSync(manifest) &&
      JSON.parse(fs.readFileSync(manifest, "utf8")).version === "6.0.2"
    );
  },
);
assert(compilerDirectory, "Run through run.ps1 to provision TypeScript 6.0.2");
const ts = require(
  path.resolve(compilerDirectory, "../typescript/lib/typescript.js"),
);
const assets = process.env.COUNTERCASE_ASSETS || path.resolve(__dirname, "../../Assets"),
  cache = new Map(),
  events = [];
class Component {
  static getTypeName() {
    return this.name;
  }
  createEvent(name) {
    return {
      bind: (fn) => {
        if (name === "UpdateEvent") events.push(fn);
      },
    };
  }
}
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const m = { exports: {} };
  cache.set(file, m);
  const code = ts.transpileModule(fs.readFileSync(process.env.FOLEY_PATCH_DIR && ["MuseumGame.ts","PlayTable.ts"].some(n=>file===path.join(assets,"Runtime",n)) ? path.join(process.env.FOLEY_PATCH_DIR,path.basename(file)) : file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
    },
  }).outputText;
  const sandbox = {
    exports: m.exports,
    module: m,
    BaseScriptComponent: Component,
    vec3:UIVec,quat:{fromEulerAngles:()=>({})},Shape:{createBoxShape:()=>({})},Rect:{create:()=>({})},HorizontalAlignment:{Center:0},VerticalAlignment:{Center:0},HorizontalOverflow:{Wrap:0},
    component: (c) => c,
    getDeltaTime: () => 0.25,
    global: { scene: { createSceneObject: name => new UIObject(name),getRootObjectsCount:()=>0 } },
    require: (p) => {
      if(p.startsWith("SpectaclesInteractionKit"))return {Interactable:UIInput};
      if(p.endsWith("AuthorPropsHandles"))return {AuthorPropsHandles:class{}};
      if (p === "./PlayTable")
        return {
          PlayTable: class {
            render() {}
            dispose() {}
          },
        };
      return load(path.resolve(path.dirname(file), p + ".ts"));
    },
  };
  vm.runInNewContext(code, sandbox, { filename: file });
  return m.exports;
}
function node() {
  return {
    setParent() {},
    destroy() {},
    createComponent() {
      const C = load(
        path.join(assets, "Author/AuthorController.ts"),
      ).AuthorController;
      const c = new C();
      c.onAwake();
      return c;
    },
  };
}
const { MuseumGame } = load(path.join(assets, "Runtime/MuseumGame.ts"));

const {NativeMuseumFoley}=load(path.join(assets,'Scripts/TableKit/NativeMuseumFoley.ts'));
const expectFixed=process.env.FOLEY_EXPECT_FIXED!=="0";
let now=1;const trace=[];const voiceStates=[{},{}];
const lengths={museum_stamp:.29,museum_pin_01:.08,museum_pin_02:.08};
const voices=voiceStates.map((state,slot)=>({play(clip){state.clip=clip;state.start=now;state.until=now+(lengths[clip]??.08);trace.push({kind:'play',clip,slot,time:now});},stop(){if(state.until>now){trace.push({kind:'cut',clip:state.clip,slot,time:now,elapsed:now-state.start});state.until=0;}}}));
const foley=new NativeMuseumFoley(voices,()=>now);
const {PlayTable}=load(path.join(assets,'Runtime/PlayTable.ts'));let table;
const game=new MuseumGame(node(),{foley,createTable(root,dispatch){table=Object.create(PlayTable.prototype);Object.assign(table,{root:new UIObject('Controls'),ports:{dispatch,cancelSound:()=>foley.cancel()},actions:new Map(),sceneObjects:new Map(),epoch:1,inputGeneration:0,disposed:false,dragging:false});table.render=function(s){this.state=s;this.epoch=s.flow.inputEpoch;for(const a of this.actions.values())a.object.enabled=a.active()};table.dispose=()=>{};return table;},renderScene(){},clearScene(){},setLid(){},cancelInput:()=>foley.cancel(),caseView:{readViewer:()=>({eyeCm:[350,165,-340],forward:[0,0,1]}),finishTimeDrag:()=>foley.cancel(),setPresentation(){},setFrameCovered(){},setSecondaryLabelsVisible(){},stopSound:()=>foley.cancel()}});
game.mount();const d=p=>game.dispatch('detective',p);
const advance=dt=>{now+=dt;events.forEach(fn=>fn());game.update(dt);};const pump=pred=>{for(let i=0;i<1000&&!pred();i++)advance(1/60);assert(pred(),'solver did not settle');};
d({type:'freeze'});d({type:'seek',tick:12});const marks=game.snapshot().detective.observations.filter(m=>m.observation.kind==='fragment');assert.equal(marks.length,2);
d({type:'selectObservation',id:marks[0].id});d({type:'pin'});advance(.4);d({type:'claim',claim:'Conservator'});const firstCheckIndex=trace.length;d({type:'check'});pump(()=>!!game.snapshot().detective && !game.snapshot().detective.checking);assert.equal(game.snapshot().detective.verdict.status,'needClue');assert.equal(trace.slice(firstCheckIndex).filter(x=>x.kind==='play'&&x.clip==='museum_stamp').length,1,'same physical stamp on accepted non-winning Check');advance(.4);
d({type:'selectObservation',id:marks[1].id});d({type:'pin'});advance(.7);const check=table.bindObject('CheckStamp',[0,0,0],[27,9,20],()=>'Check',()=>table.detective({type:'check'}),()=>!!game.snapshot().detective && !game.snapshot().detective.checking,true);
const other=table.bindObject('IdleClock',[30,0,0],[10,10,10],()=>'Clock',()=>{},()=>!!game.snapshot().detective && !game.snapshot().detective.checking);let rollbackCount=0;table.finishDrag(other.input,()=>{},()=>rollbackCount++);
const checkTime=now;const start=trace.length;check.input.onTriggerStart.fire();check.input.onTriggerEnd.fire();while(queuedDisables.length)queuedDisables.shift()();other.input.onTriggerEndOutside.fire();pump(()=>game.snapshot().flow.mode==='finished');const finishTime=now;
const sequence=trace.slice(start);console.log(JSON.stringify({patched:expectFixed,checkTime,finishTime,identity:game.mechanismState().identity,sequence},null,2));
const plays=sequence.filter(x=>x.kind==='play'&&x.clip==='museum_stamp');assert.equal(plays.length,1,'one accepted mechanical check, not a result cue');
const cuts=sequence.filter(x=>x.kind==='cut'&&x.clip==='museum_stamp');
if(!expectFixed){assert(cuts.length,'actual release cancellation must reproduce silent stamp');assert.equal(cuts[0].elapsed,0,'same-frame disabling/unowned callbacks cut fresh cue before a mixer block');}
else {assert.equal(cuts.length,0,'same attempt completion lets existing accepted stamp finish');advance(.4);assert.equal(trace.slice(start).filter(x=>x.kind==='play'&&x.clip==='museum_stamp').length,1,'no new success sound from updates');}
// A real held press/drag cancellation still clears active audio and rolls back once.
check.input.onTriggerStart.fire();foley.explicit('latch',true);let t=trace.length;check.input.onTriggerCanceled.fire();assert(trace.slice(t).some(x=>x.kind==='cut'),'owned press cancel remains immediate');advance(.4);
other.input.onDragStart.fire();foley.explicit('latch',true);t=trace.length;other.input.onTriggerCanceled.fire();assert(trace.slice(t).some(x=>x.kind==='cut'),'owned drag cancel remains immediate');const once=rollbackCount;other.input.onTriggerCanceled.fire();if(expectFixed)assert.equal(rollbackCount,once,'stale drag cancellation never replays rollback');advance(.4);
// Cleanup must still be immediate even in the finished half of this lifetime.
for(const type of ['seek','replay']){foley.explicit('latch',true);const k=trace.length;d({type,tick:12});assert(trace.slice(k).some(x=>x.kind==='cut'),'explicit '+type+' clears active audio');advance(.4);}
foley.explicit('latch',true);let k=trace.length;assert(d({type:'reveal'}));assert(trace.slice(k).some(x=>x.kind==='cut'),'earned reveal clears current audio');advance(.4);
foley.explicit('latch',true);k=trace.length;game.dispatch('flow',{type:'finishAttempt',confirmed:true});assert(trace.slice(k).some(x=>x.kind==='cut'),'leaving public attempt clears sound');
advance(.4);assert(game.dispatch('flow',{type:'stageTheft'}));assert(game.dispatch('author',{kind:'startTest'}));pump(()=>game.snapshot().author?.canSeal || game.snapshot().author?.needsAmbiguityConfirmation);if(game.snapshot().author.needsAmbiguityConfirmation)assert(game.dispatch('author',{kind:'confirmAmbiguity'}));
foley.explicit('latch',true);k=trace.length;assert(game.dispatch('flow',{type:'passCase'}));assert.equal(game.snapshot().flow.mode,'handoff');assert(trace.slice(k).some(x=>x.kind==='cut'),'real handoff clears active audio');advance(.4);
foley.explicit('latch',true);k=trace.length;assert(game.dispatch('flow',{type:'openCase'}));assert.equal(game.snapshot().flow.mode,'detective');assert(trace.slice(k).some(x=>x.kind==='cut'),'new sealed case/epoch clears active audio');
advance(.4);let reentryCalls=0,allowReentry=true;let reentrant;
reentrant=table.bindObject('ReentrantRelease',[0,0,0],[10,10,10],()=>'Apply',()=>{reentryCalls++;if(allowReentry){allowReentry=false;reentrant.input.onTriggerEnd.fire();}},()=>true);
reentrant.input.onTriggerStart.fire();reentrant.input.onTriggerEnd.fire();assert.equal(reentryCalls,expectFixed?1:2,'release ownership is consumed before synchronous release reentry');
advance(.4);let during;during=table.bindObject('CancelDuringAcceptedRelease',[0,0,0],[10,10,10],()=>'Apply',()=>{foley.explicit('latch',true);during.input.onTriggerCanceled.fire();},()=>true);
k=trace.length;during.input.onTriggerStart.fire();during.input.onTriggerEnd.fire();const lateCuts=trace.slice(k).filter(x=>x.kind==='cut');assert.equal(lateCuts.length,expectFixed?0:1,'late cancel inside already accepted release is not a captured cancellation');
game.dispose();console.log('PASS real MuseumGame + real NativeMuseumFoley repro and cleanup');
