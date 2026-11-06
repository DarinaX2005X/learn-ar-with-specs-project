const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const dir = process.env.PATH.split(path.delimiter).find(
    (d) =>
      fs.existsSync(path.resolve(d, "../typescript/package.json")) &&
      JSON.parse(fs.readFileSync(path.resolve(d, "../typescript/package.json")))
        .version === "6.0.2",
  ),
  ts = require(path.resolve(dir, "../typescript/lib/typescript.js"));
const bytes = fs.readFileSync(
  path.resolve(__dirname, "../../Assets/Art/TableKit/MuseumBuilding.glb"),
);
assert.equal(
  crypto.createHash("sha256").update(bytes).digest("hex"),
  "2adccdc24350c1361fa60e43f9912601d577a1e73b400ca36bc59e349b276cd0",
);
const jsonSize = bytes.readUInt32LE(12),
  g = JSON.parse(bytes.subarray(20, 20 + jsonSize)),
  bin = bytes.subarray(20 + jsonSize + 8),
  prim = g.meshes[70].primitives[0];
function read(index) {
  const a = g.accessors[index],
    v = g.bufferViews[a.bufferView],
    off = v.byteOffset + (a.byteOffset ?? 0),
    cols = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type],
    n = a.count * cols;
  const C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[
    a.componentType
  ];
  return new C(
    bin.buffer.slice(
      bin.byteOffset + off,
      bin.byteOffset + off + n * C.BYTES_PER_ELEMENT,
    ),
  );
}
const raw = {
    position: read(prim.attributes.POSITION),
    normal: read(prim.attributes.NORMAL),
    texture0: read(prim.attributes.TEXCOORD_0),
  },
  originalIndices = read(prim.indices);
class V {
  constructor(x = 0, y = 0, z = 0) {
    Object.assign(this, { x, y, z });
  }
}
function mesh(attrs, index) {
  return {
    topology: 1,
    getVertexDataForAttribute: (n) => attrs[n],
    getIndexBuffer: () => index,
    attrs,
    index,
  };
}
const original = mesh(raw, originalIndices),
  material = { name: "original wood", normalTexture: "same native shader ref" },
  flags = {
    meshShadowMode: 2,
    shadowDensity: 0.42,
    shadowColor: { x: 0.1, y: 0.2, z: 0.3, w: 0.4 },
    emitter: true,
    receiver: false,
    enabled: true,
    renderOrder: 17,
  };
let sourceMesh = original;
class Vis {
  constructor() {
    Object.assign(this, flags);
    this.mesh = sourceMesh;
    this.material = material;
  }
  getMaterialsCount() {
    return 1;
  }
  getMaterial() {
    return this.material;
  }
  getRenderOrder() {
    return this.renderOrder;
  }
  getBlendShapeNames() {
    return [];
  }
}
let readsRefused = false,
  copyWrong = false,
  failSecond = false,
  buildCount = 0;
class Builder {
  constructor() {
    this.vertices = [];
    this.indices = [];
  }
  appendVerticesInterleaved(a) {
    this.vertices = a;
  }
  appendIndices(a) {
    this.indices = a;
  }
  updateMesh() {
    if (failSecond && ++buildCount === 2) throw Error("mesh build refused");
  }
  getMesh() {
    const a = { position: [], normal: [], texture0: [] };
    for (let i = 0; i < this.vertices.length; i += 8) {
      a.position.push(...this.vertices.slice(i, i + 3));
      a.normal.push(...this.vertices.slice(i + 3, i + 6));
      a.texture0.push(...this.vertices.slice(i + 6, i + 8));
    }
    return mesh(
      Object.fromEntries(
        Object.entries(a).map(([k, v]) => [k, new Float32Array(v)]),
      ),
      new Uint16Array(this.indices),
    );
  }
}
class N {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.layer = { mask: 0x428 };
    this.enabled = true;
    this.p = new V();
    this.visual = undefined;
  }
  setParent(p) {
    this.parent = p;
    p.children.push(this);
  }
  getChild(i) {
    return this.children[i];
  }
  getChildrenCount() {
    return this.children.length;
  }
  get isEnabledInHierarchy() {
    return this.enabled && (!this.parent || this.parent.isEnabledInHierarchy);
  }
  getComponents(type) {
    return type === "Component.RenderMeshVisual" ? [this.visual] : [];
  }
  copyComponent(v) {
    const n = new Vis();
    Object.assign(n, v);
    if (copyWrong) n.shadowDensity = 0.99;
    this.visual = n;
    return n;
  }
  getTransform() {
    return {
      getWorldScale: () => new V(100, 100, 100),
      getLocalPosition: () => this.p,
      setLocalPosition: (p) => {
        this.p = p;
      },
      setLocalRotation() {},
      setLocalScale() {},
    };
  }
  destroy() {
    this.dead = true;
    this.enabled = false;
    if (this.parent)
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}
let roots = [],
  created = [];
const mod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.resolve(__dirname, "../../Assets/Runtime/CheckStampMotion.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    },
  ).outputText,
  {
    exports: mod.exports,
    module: mod,
    vec3: V,
    quat: { fromEulerAngles: () => ({}) },
    MeshTopology: { Triangles: 1 },
    MeshIndexType: { UInt16: 0 },
    MeshBuilder: Builder,
    isNull: (v) => !v || v.dead,
    global: {
      scene: {
        getRootObjectsCount: () => roots.length,
        getRootObject: (i) => roots[i],
        createSceneObject: (n) => {
          const o = new N(n);
          created.push(o);
          return o;
        },
      },
    },
    require: () => ({}),
  },
);
const { CheckStampMotion, stampPartition } = mod.exports;
const nativeFixture = JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/stamp-native-5.23.2.json"),"utf8"));
assert.equal(nativeFixture.sourceGlbSha256,crypto.createHash("sha256").update(bytes).digest("hex"));
const nativeAttrs = { position:[], normal:[], texture0:[] };
for(const index of nativeFixture.vertexSourceIndices) {
  nativeAttrs.position.push(...raw.position.slice(index*3,index*3+3));
  nativeAttrs.normal.push(...raw.normal.slice(index*3,index*3+3));
  nativeAttrs.texture0.push(raw.texture0[index*2],Math.fround(1-raw.texture0[index*2+1]));
}
for(const key of Object.keys(nativeAttrs)) nativeAttrs[key]=new Float32Array(nativeAttrs[key]);
const imported=mesh(nativeAttrs,new Uint16Array(nativeFixture.indices));
const rawPartition=stampPartition(original), nativePartition=stampPartition(imported);
assert.equal(rawPartition.layout,"raw-glb");assert.equal(nativePartition.layout,"lens-studio-5.23.2");
assert.equal(rawPartition.position,raw.position);assert.equal(nativePartition.position,nativeAttrs.position);
assert.equal(nativePartition.normal,nativeAttrs.normal);assert.equal(nativePartition.uv,nativeAttrs.texture0);
// Verify every ordered native triangle against source triples, undoing only the documented V flip.
const unflipped=mesh({...nativeAttrs,texture0:new Float32Array(nativeAttrs.texture0)},imported.index);
for(let i=1;i<unflipped.attrs.texture0.length;i+=2) unflipped.attrs.texture0[i]=Math.fround(1-unflipped.attrs.texture0[i]);
assert.deepEqual(triangles(unflipped),triangles(original),"all192 original ordered position/normal/UV triangle triples survive importer dedup/V exactly");

function setup() {
  created = [];
  const root = new N("MuseumBuilding"),
    node = new N("WorkshopFurniture__wood");
  node.visual = new Vis();
  node.setParent(root);
  roots = [root];
  return { root, node, visual: node.visual };
}
function triangles(m) {
  const p = m.getVertexDataForAttribute("position"),
    n = m.getVertexDataForAttribute("normal"),
    u = m.getVertexDataForAttribute("texture0"),
    ix = m.getIndexBuffer(),
    out = [];
  for (let i = 0; i < ix.length; i += 3) {
    const values = [];
    for (const j of ix.slice(i, i + 3))
      values.push(
        ...p.slice(j * 3, j * 3 + 3),
        ...n.slice(j * 3, j * 3 + 3),
        ...u.slice(j * 2, j * 2 + 2),
      );
    out.push(JSON.stringify(values));
  }
  return out;
}
const initial = triangles(original);
assert.equal(new Set(initial).size, 192, "original triangles unique");
let { node, visual } = setup(),
  motion = new CheckStampMotion();
assert(motion.status().ready);
assert.equal(node.children.length, 1);
const handle = node.children[0],
  moving = handle.visual.mesh,
  fixed = visual.mesh;
assert.equal(fixed.index.length / 3, 120);
assert.equal(moving.index.length / 3, 72);
assert.equal(
  moving.attrs.position.length / 3,
  216,
  "handle AABB has no unused static vertices",
);
assert.deepEqual(
  [...triangles(fixed), ...triangles(moving)].sort(),
  initial.slice().sort(),
  "every position/normal/UV triangle preserved exactly once",
);
assert.equal(new Set([...triangles(fixed), ...triangles(moving)]).size, 192);
assert.equal(handle.layer, node.layer);
assert.equal(handle.visual.material, visual.material);
for (const k of Object.keys(flags))
  assert.deepEqual(handle.visual[k], visual[k]);
assert.equal(
  original.index.length / 3,
  192,
  "original referenced asset unchanged",
);
const before = {
    identity: "detective|1|case|1|false",
    completed: false,
    checking: false,
  },
  busy = { ...before, checking: true };
motion.observe(before.identity);
motion.accepted("detective", "check", false, before, busy);
motion.update(0.03);
assert.equal(handle.p.y, 0, "rejected check has no stroke");
motion.accepted("detective", "check", true, before, busy);
motion.update(0.06);
assert.equal(handle.p.y, -0.022);
assert.equal(visual.mesh, fixed);
assert.equal(node.p.y, 0, "whole furniture and target parent stay still");
const elapsed = motion.elapsed;
motion.accepted("detective", "check", false, busy, busy);
motion.update(0.02);
assert.equal(motion.elapsed, elapsed + 0.02, "rejected repeat never restarts");
motion.update(0.02);
assert.equal(handle.p.y, -0.022);
motion.update(0.1);
assert(handle.p.y < 0 && handle.p.y > -0.022);
motion.update(0.1);
assert.equal(handle.p.y, 0, "exact rest at300ms");
motion.accepted("detective", "check", true, before, {
  ...before,
  completed: true,
});
motion.update(0.03);
assert(handle.p.y < 0, "accepted completed transition presses too");
motion.observe(before.identity);
assert(handle.p.y < 0, "same attempt completion does not abort return");
motion.accepted("detective", "seek", false, before, before);
assert.equal(handle.p.y, 0, "seek cancels even if rejected");
motion.accepted("detective", "check", true, before, busy);
motion.update(0.03);
motion.observe("new role");
assert.equal(handle.p.y, 0, "role change resets");
motion.dispose();
assert.equal(visual.mesh, original);
assert.equal(node.children.length, 0);
motion.dispose();
// Runtime refusal, second mesh failure and copied shadow mismatch leave complete original in frame.
for (const kind of ["read", "build", "copy", "unknown"]) {
  ({ node, visual } = setup());
  if (kind === "read")
    visual.mesh = {
      ...original,
      getIndexBuffer() {
        throw Error("SDK read refused");
      },
    };
  if (kind === "unknown")
    visual.mesh = mesh(
      { ...raw, position: new Float32Array(raw.position) },
      originalIndices,
    );
  if (kind === "unknown") visual.mesh.attrs.position[0] += 0.01;
  const untouched = visual.mesh;
  copyWrong = kind === "copy";
  failSecond = kind === "build";
  buildCount = 0;
  const m = new CheckStampMotion();
  assert.equal(m.status().ready, false, kind);
  assert.equal(visual.mesh, untouched, kind + " leaves original reference");
  assert.equal(node.children.length, 0, kind + " leaves no duplicate child");
  copyWrong = false;
  failSecond = false;
}
console.log(
  "PASS actual GLB split72+120, exact attributes/material/layer/render/shadow, no duplication, small stroke/rest/accepted lifecycle, rollback/dispose; SDK read refusal/build failure/copy mismatch/unknown data retain full original",
);

sourceMesh=imported;
({node,visual}=setup());
const nativeMotion=new CheckStampMotion();assert(nativeMotion.status().ready);
const nativeHandle=node.children[0], nativeFixed=visual.mesh;
assert.equal(nativeHandle.visual.mesh.attrs.position.length/3,134,"native pooled handle vertices compact correctly");
assert.equal(nativeFixed.attrs.position.length/3,246,"all pooled static vertices retained");
assert.equal(nativeHandle.visual.mesh.index.length/3,72);assert.equal(nativeFixed.index.length/3,120);
assert.deepEqual([...triangles(nativeFixed),...triangles(nativeHandle.visual.mesh)].sort(),triangles(imported).sort(),"native normals and UV remain native, with no missing/duplicate triangles");
assert.equal(nativeHandle.visual.material,visual.material);assert.equal(nativeHandle.layer,node.layer);
for(const key of Object.keys(flags))assert.deepEqual(nativeHandle.visual[key],visual[key]);
nativeMotion.observe(before.identity);nativeMotion.accepted("detective","check",true,before,busy);nativeMotion.update(.06);
assert.equal(nativeHandle.p.y,-.022);assert.equal(node.p.y,0);nativeMotion.update(.24);assert.equal(nativeHandle.p.y,0);
nativeMotion.dispose();assert.equal(visual.mesh,imported);assert.equal(node.children.length,0);
for(const kind of ["read","build","copy","position","normal","texture0","indices","counts","topology","unflipped-V"]) {
  ({node,visual}=setup());
  if(kind==="read")visual.mesh={...imported,getIndexBuffer(){throw Error("SDK read refused")}};
  else if(["position","normal","texture0","counts","topology","unflipped-V","indices"].includes(kind)) {
    const attrs=Object.fromEntries(Object.entries(nativeAttrs).map(([k,v])=>[k,new Float32Array(v)]));
    const ix=new Uint16Array(imported.index);if(kind==="indices")ix[0]=ix[1];
    if(["position","normal","texture0"].includes(kind))attrs[kind][0]+=.001;
    if(kind==="counts")attrs.position=attrs.position.slice(0,-3);
    if(kind==="unflipped-V")for(let i=1;i<attrs.texture0.length;i+=2)attrs.texture0[i]=Math.fround(1-attrs.texture0[i]);
    visual.mesh=mesh(attrs,ix);if(kind==="topology")visual.mesh.topology=999;
  }
  const untouched=visual.mesh;copyWrong=kind==="copy";failSecond=kind==="build";buildCount=0;
  const rejected=new CheckStampMotion();assert.equal(rejected.status().ready,false,kind);
  assert.equal(visual.mesh,untouched,kind+" keeps the entire original native visual");assert.equal(node.children.length,0,kind+" leaves no child or duplicate");
  copyWrong=false;failSecond=false;
}
sourceMesh=original;
console.log("PASS native5.23.2 exact signatures, source ordered triangle proof, pooled134/246 vertices,72/120 ownership, native attributes/materials/render/shadows, stroke/restore and refusal of every changed input");
