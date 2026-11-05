const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  a = require("node:assert/strict");
const compiler = process.env.PATH.split(path.delimiter)
  .map((dir) => path.resolve(dir, "../typescript/package.json"))
  .find(
    (file) =>
      fs.existsSync(file) &&
      JSON.parse(fs.readFileSync(file, "utf8")).version === "6.0.2",
  );
a(compiler, "Run through run-comparison.ps1");
const ts = require(path.join(path.dirname(compiler), "lib/typescript.js"));
class Vector {
  constructor(x, y, z) {
    Object.assign(this, { x, y, z });
  }
}
class Quaternion {
  constructor(w, x, y, z) {
    Object.assign(this, { w, x, y, z });
    this.yaw = 0;
  }
  static fromEulerAngles(x,y,z) {
    const sx=Math.sin(x/2),cx=Math.cos(x/2),sy=Math.sin(y/2),cy=Math.cos(y/2),sz=Math.sin(z/2),cz=Math.cos(z/2);
    const q=new Quaternion(cx*cy*cz+sx*sy*sz,sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz);
    q.yaw=y;q.pitch=x;q.roll=z;return q;
  }
  multiply(b){const a=this;return new Quaternion(a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w);}
  inverse(){return new Quaternion(this.w,-this.x,-this.y,-this.z);}
  rotate(p){const q=this.multiply(new Quaternion(0,p.x,p.y,p.z)).multiply(this.inverse());return new Vector(q.x,q.y,q.z);}
  // A valid quaternion may return an equivalent Euler representation whose Y
  // folds outside +-90 degrees. IK must retain the authored heading instead.
  toEulerAngles() {
    return new Vector(
      this.pitch ?? 0,
      Math.asin(Math.sin(this.yaw)),
      this.roll ?? 0,
    );
  }
}
const turn = (p, yaw) =>
  new Vector(
    p.x * Math.cos(yaw) + p.z * Math.sin(yaw),
    p.y,
    p.z * Math.cos(yaw) - p.x * Math.sin(yaw),
  );
class Transform {
  constructor(node) {
    this.node = node;
    this.position = new Vector(0, 0, 0);
    this.scale = new Vector(1, 1, 1);
    this.rotation = Quaternion.fromEulerAngles(0, 0, 0);
  }
  setLocalPosition(p) {
    this.position = p;
  }
  getLocalPosition() {
    return this.position;
  }
  setLocalScale(s) {
    this.scale = s;
  }
  getLocalScale() {
    return this.scale;
  }
  setLocalRotation(q) {
    this.rotation = q;
  }
  getLocalRotation() {
    return this.rotation;
  }
  getWorldScale() {
    const p =
      this.node.parent?.transform.getWorldScale() ?? new Vector(1, 1, 1);
    return new Vector(
      p.x * this.scale.x,
      p.y * this.scale.y,
      p.z * this.scale.z,
    );
  }
  getWorldRotation() { return this.node.parent ? this.node.parent.transform.getWorldRotation().multiply(this.rotation) : this.rotation; }
  getWorldPosition() {
    if (!this.node.parent) return this.position;
    const t = this.node.parent.transform,
      s = t.getWorldScale(),
      p = t.getWorldRotation().rotate(new Vector(this.position.x*s.x,this.position.y*s.y,this.position.z*s.z)),
      base = t.getWorldPosition();
    return new Vector(base.x + p.x, base.y + p.y, base.z + p.z);
  }
  setWorldPosition(p) {
    if (!this.node.parent) {
      this.position = p;
      return;
    }
    const t = this.node.parent.transform,
      base = t.getWorldPosition(),
      local = t.getWorldRotation().inverse().rotate(new Vector(p.x-base.x,p.y-base.y,p.z-base.z)),
      s = t.getWorldScale();
    this.position = new Vector(local.x / s.x, local.y / s.y, local.z / s.z);
  }
  setWorldRotation(q) { this.rotation=this.node.parent ? this.node.parent.transform.getWorldRotation().inverse().multiply(q) : q; }
  setWorldScale(s) {
    const p =
      this.node.parent?.transform.getWorldScale() ?? new Vector(1, 1, 1);
    this.scale = new Vector(s.x / p.x, s.y / p.y, s.z / p.z);
  }
}
let nodes = [];
class Node {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.children = [];
    this.components = [];
    this.transform = new Transform(this);
    this.destroyed = false;
    nodes.push(this);
  }
  setParent(parent) {
    if (this.parent)
      this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = parent;
    parent.children.push(this);
  }
  getParent() {
    return this.parent;
  }
  getTransform() {
    return this.transform;
  }
  getChildrenCount() {
    return this.children.length;
  }
  getChild(i) {
    return this.children[i];
  }
  getComponents(type) {
    return this.components.filter((c) => c.type === type);
  }
  createComponent(type) {
    const c = { type };
    this.components.push(c);
    return c;
  }
  copyWholeHierarchy(source) {
    const n = new Node(source.name);
    n.setParent(this);
    n.enabled = source.enabled;
    n.transform.position = new Vector(
      ...Object.values(source.transform.position),
    );
    n.transform.scale = new Vector(...Object.values(source.transform.scale));
    n.transform.rotation = Quaternion.fromEulerAngles(
      0,
      source.transform.rotation.yaw,
      0,
    );
    n.components = source.components.map((c) => ({ ...c }));
    for (const child of source.children) n.copyWholeHierarchy(child);
    return n;
  }
  destroy() {
    for (const child of [...this.children]) child.destroy();
    if (this.parent)
      this.parent.children = this.parent.children.filter((n) => n !== this);
    this.destroyed = true;
    this.enabled = false;
  }
}
const scene = {
  createSceneObject: (name) => new Node(name),
  getRootObjectsCount: () =>
    nodes.filter((n) => !n.parent && !n.destroyed).length,
  getRootObject: (i) => nodes.filter((n) => !n.parent && !n.destroyed)[i],
};
const globals = {
  global: { scene },
  vec3: Vector,
  quat: Quaternion,
  HorizontalAlignment: { Center: 0 },
  VerticalAlignment: { Center: 0 },
  HorizontalOverflow: { Wrap: 0 },
  Rect: { create: (...values) => values },
  console,
  isNull: node => !node || node.destroyed,
  vec4: class {constructor(...values){this.values=values;}},
  MeshBuilder: class { appendVerticesInterleaved(){} appendIndices(){} updateMesh(){} getMesh(){return{};} },
  MeshTopology: {Triangles:0}, MeshIndexType:{UInt16:0},
};
const cache = new Map(),
  assets = path.resolve(__dirname, "../../Assets");
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const staged = path.join(__dirname,path.basename(file));
  const source = file.includes(path.sep+"Runtime"+path.sep) && fs.existsSync(staged) ? staged : file;
  const code = ts.transpileModule(fs.readFileSync(source, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, globals, {
    filename: file,
  })(
    (name) => load(path.resolve(path.dirname(file), name + ".ts")),
    module,
    module.exports,
  );
  return module.exports;
}
const { insideComparisonWindow,comparisonFocusWindow,clipComparisonWall } = load(path.join(assets,"Runtime/ComparisonFocus.ts"));
const originalRead=ts.sys.readFile;
const host=ts.createCompilerHost({});
const hostRead=host.readFile.bind(host);
host.readFile=file=>{const candidate=path.join(__dirname,path.basename(file));return file.includes("/Runtime/")&&fs.existsSync(candidate)?fs.readFileSync(candidate,"utf8"):hostRead(file);};
const hostExists=host.fileExists.bind(host);
host.fileExists=file=>hostExists(file)||(file.includes("/Runtime/")&&fs.existsSync(path.join(__dirname,path.basename(file))));
const program=ts.createProgram([path.resolve(assets,"../Support/StudioLib.d.ts"),path.join(assets,"Runtime/ComparisonHall.ts")],{strict:true,skipLibCheck:true,noEmit:true,target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,lib:["lib.es2021.d.ts"]},host);
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>"\n"}));
const D = load(path.join(assets, "Domain/index.ts")),
  S = load(path.join(assets, "Spatial/index.ts")),
  { ComparisonHall } = load(path.join(assets, "Runtime/ComparisonHall.ts"));
const plain = (value) => JSON.parse(JSON.stringify(value));
function compile(draft) {
  const c = D.compileCase(draft);
  a.equal(c.ok, true);
  return c.sealed;
}
function find(root, name) {
  if (root.name === name) return root;
  for (const child of root.children) {
    const result = find(child, name);
    if (result) return result;
  }
}
const material = { clone: () => ({mainPass:{}}) };
function makeMuseum(board) {
  nodes = [];
  const root = new Node("Countercase"),
    building = new Node("ConnectedMuseum");
  building.setParent(root);
  const bench = new Node("Anchor_ConservationBench");
  bench.setParent(building);
  bench.transform.position = new Vector(-350, 94, 380);
  const theatre = new Node("Theatre");
  theatre.setParent(root);
  for (const role of D.ROLES) {
    const actor = new Node(role);
    actor.setParent(theatre);
    actor.enabled = false;
    const torso = new Node("Body");
    torso.setParent(actor);
    for (const name of [
      "Shoulder_R",
      "Forearm_R",
      "Hand_R",
      "Hip_L",
      "Hip_R",
      "Knee_L",
      "Knee_R",
    ]) {
      const joint = new Node(name);
      joint.setParent(torso);
    }
  }
  for (const name of [
    "DisplayCase",
    "Ruby",
    ...board.room.walls.map((w) => "PublicWall_" + w.id),
  ]) {
    const node = new Node(name);
    node.setParent(theatre);
  }
  for (const name of ["WorkshopRecording__brass","WorkshopRecording__recordingDarkGlass","WorkshopRecording__leather","WorkshopRecording__wood","Anchor_PinGlass","Anchor_PinHandle"]) {
    const n = new Node(name);n.setParent(building);n.transform.position=new Vector(-353,102.5,326);
  }
  for (const name of ["Use_PinGlass","Use_LoupeDetail"]) { const n=new Node(name);n.setParent(root); }
  const pane = new Node("PublicRecordedGlass");
  pane.setParent(root);
  return { root, building, bench, theatre, pane };
}
const sealed = compile(D.createMuseumTheft(false));
const verdict = D.prove(sealed.board, sealed.clues, [], "Underdetermined");
const pair = S.compatiblePair(sealed.board, verdict, "taker");
a(pair);
const request = { pair, field: "taker", scope: "all", tape: sealed.clues };
const context = {
  tick: 12,
  witnessId: "entrance",
  selectedIds: [],
  versionIndex: 0,
  verdictKey: "full-closed",
};
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}
test("explicit comparison mounts two legal public plays on the existing connected bench", () => {
  const museum = makeMuseum(sealed.board),
    hall = new ComparisonHall(museum.root, material),
    original = JSON.stringify(sealed.clues);
  a.equal(hall.sync(sealed.board, undefined, context), false);
  a.equal(
    nodes.some((n) => n.name === "ComparisonWorkbench"),
    false,
  );
  a.equal(hall.sync(sealed.board, request, context), true);
  a.equal(hall.read().visibleWings, 2);
  const common = find(museum.root, "ComparisonWorkbench");
  a(common);
  a.equal(common.parent, museum.root);
  a.deepEqual(plain(common.transform.getWorldPosition()), {
    x: -350,
    y: 94,
    z: 380,
  });
  a.equal(museum.building.enabled, true);
  a.equal(museum.pane.enabled, true);
  a.equal(JSON.stringify(sealed.clues), original);
  for (let i = 0; i < 2; i++) {
    const wing = find(common, "PossibleReconstruction_" + (i + 1));
    a(wing);
    a(find(wing, "Guard"));
    a(find(wing, "Conservator"));
    a(find(wing, "Courier"));
    a(find(wing, "Ruby"));
    a.match(
      find(wing, "ReconstructionInscription").components[0].text,
      /Fits the full recording/,
    );
  }
  a.notEqual(
    find(find(common, "PossibleReconstruction_1"), "Guard").transform.position
      .z,
    find(find(common, "PossibleReconstruction_2"), "Guard").transform.position
      .z,
  );
  a.equal(
    nodes.some((n) => n.name.includes("Clock")),
    false,
  );
  hall.dispose();
  a.equal(find(museum.root, "ComparisonWorkbench"), undefined);
});
test("one authoritative clock seeks both plays through all 25 ticks and reversal", () => {
  const museum = makeMuseum(sealed.board),
    hall = new ComparisonHall(museum.root, material);
  hall.sync(sealed.board, request, context);
  for (const tick of [...Array(25).keys(), 12, 11, 0]) {
    hall.sync(sealed.board, request, { ...context, tick });
    a.equal(hall.read().tick, tick);
    for (let i = 0; i < 2; i++) {
      const wing = find(museum.root, "PossibleReconstruction_" + (i + 1)),
        view = S.renderHistory(sealed.board, pair[i], tick),
        ruby = find(wing, "Ruby");
      a.equal(ruby.enabled, view.ruby.visible && insideComparisonWindow(hall.read().focus,view.ruby.positionCm[0]/100,view.ruby.positionCm[2]/100));
      a.deepEqual(plain(ruby.transform.position), {
        x: view.ruby.positionCm[0] * 0.06,
        y: view.ruby.positionCm[1] * 0.06,
        z: view.ruby.positionCm[2] * 0.06,
      });
    }
  }
  hall.exit();
});
test("exit, role switch, repeated exit and disposal remove every retained reconstruction", () => {
  const museum = makeMuseum(sealed.board);
  let stopped = 0;
  const hall = new ComparisonHall(
    museum.root,
    material,
    { stopSound: () => stopped++ },
  );
  const originalTransform = plain(museum.bench.transform.getWorldPosition());
  hall.sync(sealed.board, request, context);
  hall.sync(sealed.board, request, { ...context, tick: 18 });
  a.deepEqual(plain(hall.exit()), context);
  a.equal(hall.read().active, false);
  a.equal(hall.snapshot(), undefined);
  a.equal(find(museum.root, "ComparisonWorkbench"), undefined);
  a.equal(stopped, 1);
  a.deepEqual(
    plain(museum.bench.transform.getWorldPosition()),
    originalTransform,
  );
  hall.exit();
  a.equal(stopped, 1);
  hall.sync(sealed.board, request, context);
  hall.sync(undefined, undefined);
  a.equal(hall.read().active, false);
  hall.dispose();
  a.equal(hall.sync(sealed.board, request, context), false);
});
test("incompatible, same-answer, illegal, stale or script-bearing proposals never mount", () => {
  for (const change of [
    (r) => ({ ...r, pair: [pair[0], pair[0]] }),
    (r) => ({ ...r, tape: { ...r.tape, rev: 999 } }),
    (r) => ({ ...r, pair: [{ ...pair[0], take: "A" }, pair[1]] }),
  ]) {
    const m = makeMuseum(sealed.board),
      hall = new ComparisonHall(m.root, material);
    a.equal(hall.sync(sealed.board, change(request), context), false);
    a.equal(find(m.root, "ComparisonWorkbench"), undefined);
  }
  const open = compile(D.createMuseumTheft(true)),
    m = makeMuseum(open.board),
    hall = new ComparisonHall(m.root, material);
  a.equal(
    hall.sync(open.board, { ...request, tape: open.clues }, context),
    false,
  );
  const m2 = makeMuseum(sealed.board);
  find(m2.theatre, "Guard").createComponent("Component.ScriptComponent");
  const hall2 = new ComparisonHall(m2.root, material);
  a.equal(hall2.sync(sealed.board, request, context), false);
  a.equal(find(m2.root, "ComparisonWorkbench"), undefined);
});
test("selected evidence scope remains honest and a changed selection invalidates old versions", () => {
  const open = compile(D.createMuseumTheft()),
    courier = D.getObservations(open.clues, "entrance", 12).find(
      (c) =>
        c.observation.kind === "fragment" &&
        c.payload.fragments[0].role === "Courier",
    ),
    guard = D.getObservations(open.clues, "entrance", 12).find(
      (c) =>
        c.observation.kind === "fragment" &&
        c.payload.fragments[0].role === "Guard",
    );
  const v = D.prove(open.board, open.clues, [courier.id], "Conservator"),
    selectedPair = S.compatiblePair(open.board, v, "taker");
  a(selectedPair);
  const m = makeMuseum(open.board),
    hall = new ComparisonHall(m.root, material),
    r = {
      pair: selectedPair,
      field: "taker",
      scope: "selected",
      tape: open.clues,
    };
  a.equal(
    hall.sync(open.board, r, { ...context, selectedIds: [courier.id] }),
    true,
  );
  a.equal(
    hall.sync(open.board, r, {
      ...context,
      selectedIds: [courier.id, guard.id],
    }),
    false,
  );
  a.equal(hall.read().active, false);
});
test("standing selected-wing view and return preserve context without moving a camera", () => {
  const m = makeMuseum(sealed.board),
    hall = new ComparisonHall(m.root, material);
  hall.sync(sealed.board, request, context);
  hall.applyCaseView({
    kind: "room",
    placement: { originCm: [100, 0, 200], scale: 1, yawRad: 0.3 },
  });
  a.equal(hall.read().visibleWings, 1);
  const wing = find(m.root, "PossibleReconstruction_1");
  a.deepEqual(plain(wing.transform.getWorldPosition()), {
    x: 100,
    y: 0,
    z: 200,
  });
  hall.setVersion(1);
  a.equal(find(m.root, "PossibleReconstruction_1").enabled, false);
  a.equal(find(m.root, "PossibleReconstruction_2").enabled, true);
  hall.applyCaseView(undefined);
  a.equal(hall.read().visibleWings, 2);
  a.equal(hall.snapshot().tick, 12);
  a.equal(hall.snapshot().witnessId, "entrance");
  a.equal(
    nodes.some((n) => n.components.some((c) => c.type === "Component.Camera")),
    false,
  );
  hall.exit();
});
test("packing comparison uses one taker and two recipients on the same clock", () => {
  const packing = compile(D.createPackingCase()),
    v = D.prove(packing.board, packing.clues, [], "Underdetermined"),
    p = S.compatiblePair(packing.board, v, "recipient");
  a(p);
  a.equal(
    D.answer(packing.board, p[0], "taker"),
    D.answer(packing.board, p[1], "taker"),
  );
  a.notEqual(
    D.answer(packing.board, p[0], "recipient"),
    D.answer(packing.board, p[1], "recipient"),
  );
  const museum = makeMuseum(packing.board),
    hall = new ComparisonHall(museum.root, material),
    r = { pair: p, field: "recipient", scope: "all", tape: packing.clues };
  for (const tick of [12, 14, 15, 16, 17, 22, 24, 12])
    a.equal(hall.sync(packing.board, r, { ...context, tick }), true);
  a.equal(hall.read().visibleWings, 2);
  const texts = [1, 2].map(
    (i) =>
      find(
        find(museum.root, "PossibleReconstruction_" + i),
        "ReconstructionInscription",
      ).components[0].text,
  );
  a(texts.some((text) => text.includes("Courier could receive it")));
  a(texts.some((text) => text.includes("Guard could receive it")));
  hall.exit();
  a.equal(find(museum.root, "ComparisonWorkbench"), undefined);
});
test("native hand targets use authored yaw even when quaternion Euler angles fold", () => {
  const museum = makeMuseum(sealed.board),
    hall = new ComparisonHall(museum.root, material);
  hall.sync(sealed.board, request, context);
  for (let i = 0; i < 2; i++) {
    const view = S.renderHistory(sealed.board, pair[i], 12),
      role = pair[i].casting[pair[i].take],
      pose = view.actors.find((p) => p.role === role),
      target = view.hands.find((h) => h.track === pair[i].take).handCm,
      yaw = pose.yawRad + Math.PI;
    const dx = target[0] - pose.positionCm[0],
      dy = target[1] - pose.positionCm[1],
      dz = target[2] - pose.positionCm[2];
    const local = [
      (Math.cos(yaw) * dx - Math.sin(yaw) * dz) * 0.06,
      dy * 0.06,
      (Math.sin(yaw) * dx + Math.cos(yaw) * dz) * 0.06,
    ];
    const expected = S.solveRightArm(local),
      shoulder = find(
        find(find(museum.root, "PossibleReconstruction_" + (i + 1)), role),
        "Shoulder_R",
      ).transform.rotation;
    a.deepEqual(
      [shoulder.x, shoulder.y, shoulder.z, shoulder.w],
      plain(expected.shoulderRotation),
    );
  }
  hall.exit();
});
test("fractional presentation samples the shared clock without changing recorded evidence", () => {
  const museum = makeMuseum(sealed.board),
    hall = new ComparisonHall(museum.root, material);
  hall.sync(sealed.board, request, context);
  const originalRecording = JSON.stringify(sealed.clues);
  hall.presentPose(12.5);
  a.equal(hall.read().tick, 12.5);
  for (let i = 0; i < 2; i++) {
    const actor = find(
      find(museum.root, "PossibleReconstruction_" + (i + 1)),
      pair[i].casting.A,
    );
    const expected = S.renderHistory(sealed.board, pair[i], 12.5).actors.find(
      (p) => p.role === pair[i].casting.A,
    );
    a.deepEqual(plain(actor.transform.position), {
      x: expected.positionCm[0] * 0.06,
      y: expected.positionCm[1] * 0.06,
      z: expected.positionCm[2] * 0.06,
    });
  }
  a.equal(JSON.stringify(sealed.clues), originalRecording);
  a.equal(hall.exit().tick, 12);
  hall.presentPose(18.5);
  a.equal(hall.read().active, false);
});

function near(actual,expected,eps=1e-8) { a(Math.abs(actual-expected)<eps,`${actual} != ${expected}`); }
function transformState(node) {return {parent:node.parent,position:plain(node.transform.position),rotation:plain(node.transform.rotation),scale:plain(node.transform.scale),enabled:node.enabled};}
function assertState(node,expected){a.equal(node.parent,expected.parent);a.deepEqual(plain(node.transform.position),expected.position);a.deepEqual(plain(node.transform.rotation),expected.rotation);a.deepEqual(plain(node.transform.scale),expected.scale);a.equal(node.enabled,expected.enabled);}
test("single original rig articulates real hardware, pane and registered targets then restores exact local state",()=>{
  const m=makeMuseum(sealed.board),hall=new ComparisonHall(m.root,material);
  const names=["WorkshopRecording__brass","WorkshopRecording__recordingDarkGlass","WorkshopRecording__leather","WorkshopRecording__wood","Anchor_PinGlass","Anchor_PinHandle","PublicRecordedGlass","Use_PinGlass","Use_LoupeDetail"];
  const originals=names.map(name=>find(m.root,name));
  originals.forEach((node,i)=>{node.transform.position=new Vector(-353+i,102.5+i*.1,326+i*.2);node.transform.scale=new Vector(i+1,i+2,i+3);node.transform.rotation=Quaternion.fromEulerAngles(.01*i,.02*i,.03*i);});
  const before=originals.map(transformState);
  for(let generation=0;generation<3;generation++){
    a(hall.sync(sealed.board,request,context));
    const rig=find(m.root,"ComparisonOriginalRecordingRig");a(rig);a.equal(rig.children.length,9);
    a.equal(nodes.filter(n=>n.name==="PublicRecordedGlass"&&!n.destroyed).length,1);
    near(rig.transform.getWorldPosition().x,-350);near(rig.transform.getWorldPosition().y,123);near(rig.transform.getWorldPosition().z,319);
    const normal=rig.transform.getWorldRotation().rotate(new Vector(0,1,0));near(normal.y,Math.cos(65*Math.PI/180));near(normal.z,-Math.sin(65*Math.PI/180));
    hall.applyCaseView({kind:"table",placement:{originCm:[5,115,60],scale:.06,yawRad:.4}});
    near(rig.transform.getWorldScale().x,.3);
    a.equal(hall.read().sourceRig.deployed,true);
    hall.applyCaseView({kind:"room",placement:{originCm:[0,0,0],scale:1,yawRad:0}});
    a.equal(hall.read().sourceRig.deployed,false);
    near(rig.transform.getWorldPosition().x,-353);near(rig.transform.getWorldPosition().y,102.5);near(rig.transform.getWorldPosition().z,326);
    hall.applyCaseView(undefined);
    near(rig.transform.getWorldScale().x,1);
    hall.exit();originals.forEach((node,i)=>assertState(node,before[i]));
    a.equal(find(m.root,"ComparisonOriginalRecordingRig"),undefined);
  }
  hall.dispose();originals.forEach((node,i)=>assertState(node,before[i]));
});
test("missing source hardware fails closed and never leaves a partial foldout or moved persistent nodes",()=>{
  for(const missing of ["WorkshopRecording__wood","Anchor_PinGlass","PublicRecordedGlass","Use_PinGlass"]){
    const m=makeMuseum(sealed.board),node=find(m.root,missing);node.destroy();
    const originals=nodes.filter(n=>!n.destroyed),before=originals.map(transformState);
    const hall=new ComparisonHall(m.root,material);a.equal(hall.sync(sealed.board,request,context),false);
    a.equal(find(m.root,"ComparisonFoldout"),undefined);a.equal(find(m.root,"ComparisonOriginalRecordingRig"),undefined);
    originals.forEach((n,i)=>assertState(n,before[i]));
  }
});
test("matched public action windows include both packing contacts and never modify board/history geometry",()=>{
  const packing=compile(D.createPackingCase()),v=D.prove(packing.board,packing.clues,[],"Underdetermined"),p=S.compatiblePair(packing.board,v,"recipient");
  const old=JSON.stringify([packing.board,p]);
  const focus=comparisonFocusWindow(packing.board,p,"recipient");a(focus.scale<=.2);a(focus.width*100*focus.scale<=28.00001);
  for(const h of p)for(const id of [h.pass.from,h.pass.to]){const point=D.poseAt(packing.board.tracks.find(t=>t.id===id),h.pass.tick);a(insideComparisonWindow(focus,point.x,point.z));}
  const w={id:"clip",a:{x:focus.centre.x-5,y:0,z:focus.centre.z},b:{x:focus.centre.x+5,y:0,z:focus.centre.z},bottom:0,top:2};
  const clipped=clipComparisonWall(focus,w);near(clipped[0].x,focus.centre.x-focus.width/2);near(clipped[1].x,focus.centre.x+focus.width/2);
  a.equal(JSON.stringify([packing.board,p]),old);
});
test("table cutaway omits distant actors while room mode restores all authorized actors and walls",()=>{
  const m=makeMuseum(sealed.board),hall=new ComparisonHall(m.root,material);hall.sync(sealed.board,request,context);
  for(let index=0;index<2;index++){
    const wing=find(m.root,"PossibleReconstruction_"+(index+1));
    a.equal(find(wing,pair[index].casting.A).enabled,false);
    a.equal(find(wing,pair[index].casting[pair[index].take]).enabled,true);
  }
  hall.applyCaseView({kind:"room",placement:{originCm:[0,0,0],scale:1,yawRad:0}});
  const wing=find(m.root,"PossibleReconstruction_1");for(const role of D.ROLES)a.equal(find(wing,role).enabled,true);
  for(const wall of sealed.board.room.walls)a.equal(find(wing,"PublicWall_"+wall.id).enabled,true);
  a.equal(find(m.root,"ComparisonFoldout").enabled,false);
  hall.exit();
});
const fov={vertical:.63857007,aspect:.87547171,halfIpd:3.2};
function project(point,eyeX){const dy=point[1]-165,dz=point[2]-170,angle=Math.atan2(29,200),depth=dz*Math.cos(angle)-dy*Math.sin(angle),up=dy*Math.cos(angle)+dz*Math.sin(angle);return [-(point[0]-eyeX)/(depth*Math.tan(fov.vertical/2)*fov.aspect),up/(depth*Math.tan(fov.vertical/2))];}
function corners(min,max){const out=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])out.push([x,y,z]);return out;}
test("actual native stereo FOV contains both contact figures, normalized ruby, attached labels and original source rig",()=>{
  const m=makeMuseum(sealed.board),hall=new ComparisonHall(m.root,material);hall.sync(sealed.board,request,context);
  const objects=[];
  for(let i=0;i<2;i++){
    const wing=find(m.root,"PossibleReconstruction_"+(i+1)),actor=find(wing,pair[i].casting[pair[i].take]),gem=find(wing,"Ruby");
    const p=actor.transform.getWorldPosition();objects.push(...corners([p.x-4,p.y,p.z-4],[p.x+4,p.y+35,p.z+4]));
    const r=gem.transform.getWorldPosition();objects.push(...corners([r.x-1.1,r.y,r.z-.9],[r.x+1.1,r.y+1.27,r.z+.9]));
    const label=find(wing,"ReconstructionInscription").transform.getWorldPosition();objects.push(...corners([label.x-14,label.y-4,label.z],[label.x+14,label.y+4,label.z]));
  }
  objects.push(...corners([-361.2,112.5,315.2],[-338.8,133.5,322.8]));
  for(const eyeX of [-350-fov.halfIpd,-350+fov.halfIpd])for(const point of objects){const [x,y]=project(point,eyeX);a(Math.abs(x)<1,`x clip ${x} at ${point}`);a(Math.abs(y)<1,`y clip ${y}`);}
  hall.exit();
});
console.log(checks + " comparison hall integration checks passed");
