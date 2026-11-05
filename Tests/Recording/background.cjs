const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  { performance } = require("node:perf_hooks");
const bin = process.env.PATH.split(path.delimiter).find((dir) =>
  fs.existsSync(path.resolve(dir, "../typescript/lib/typescript.js")),
);
assert(bin, "Run with npm exec --package=typescript@6.0.2");
const ts = require(path.resolve(bin, "../typescript/lib/typescript.js"));
const assets = process.env.WITNESS_ASSETS_ROOT ? path.resolve(process.env.WITNESS_ASSETS_ROOT) : path.resolve(__dirname, "../../Assets"),
  entry = path.join(assets, "Spatial/WitnessBackground.ts"),
  source = process.env.WITNESS_BACKGROUND_SOURCE
    ? path.resolve(process.env.WITNESS_BACKGROUND_SOURCE)
    : entry;
const compilerOptions = {
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.CommonJS,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  lib: ["lib.es2021.d.ts"],
};
const host = ts.createCompilerHost(compilerOptions),
  read = host.readFile.bind(host),
  exists = host.fileExists.bind(host);
host.readFile = (file) =>
  path.resolve(file) === entry ? fs.readFileSync(source, "utf8") : read(file);
host.fileExists = (file) => path.resolve(file) === entry || exists(file);
const program = ts.createProgram([entry], compilerOptions, host),
  diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  }),
);
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(
    fs.readFileSync(file === entry ? source : file, "utf8"),
    { compilerOptions },
  ).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (p) => load(path.resolve(path.dirname(file), p + ".ts")),
      Float32Array,
      console,
    },
    { filename: file },
  );
  return module.exports;
}
const D = load(path.join(assets, "Domain/index.ts")),
  { WitnessBackground, getWitnessBackground } = load(entry);
const compile = (draft) => {
  const result = D.compileCase(draft);
  assert.equal(result.ok, true);
  return result.sealed;
};
const open = compile(D.createMuseumTheft()),
  closed = compile(D.createMuseumTheft(false));
const STYLE = { roomHeight: 3.8, frameWidth: 0.025, frameHeight: 0.035 };
const scene = new WitnessBackground(open.board, "entrance", STYLE),
  flat = (p) => JSON.parse(JSON.stringify(p));
const mirror = open.board.room.mirror,
  w = open.board.witnesses[0];
const tangentTo = (p) => {
  const d = D.sub(p, w.position),
    depth = d.x * Math.sin(w.yaw) + d.z * Math.cos(w.yaw);
  return [(d.x * Math.cos(w.yaw) - d.z * Math.sin(w.yaw)) / depth, d.y / depth];
};
const atMirror = (u = 0, v = 0) =>
  D.add(mirror.origin, D.add(D.mul(mirror.right, u), D.mul(mirror.up, v)));
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}
test("finite mirror reflects actual public architecture through the same fixed rays", () => {
  const q = atMirror(),
    hit = scene.traceTangent(...tangentTo(q));
  assert.equal(hit.kind, "reflection");
  assert.equal(hit.reflected, true);
  assert.equal(hit.objectId, "room-back");
  assert(
    Math.abs(
      hit.distance - D.distance(w.position, q) - D.distance(q, hit.position),
    ) < 0.00001,
  );
  assert.deepEqual(flat(hit.mirrorPoint), flat(q));
  const outside = scene.traceTangent(...tangentTo(atMirror(0.4)));
  assert.equal(outside.kind, "wall");
  assert.equal(outside.reflected, false);
  const frame = scene.traceTangent(
    ...tangentTo(atMirror(mirror.width / 2 + 0.0125)),
  );
  assert.equal(frame.kind, "mirror-frame");
});
test("closed and partial shutters have canonical finite aperture boundaries", () => {
  const blocked = new WitnessBackground(closed.board, "entrance", STYLE);
  assert.equal(blocked.traceTangent(...tangentTo(atMirror())).kind, "shutter");
  const half = flat(open.board);
  half.room.mirror.aperture = 0.5;
  const partial = new WitnessBackground(half, "entrance", STYLE);
  assert.equal(
    partial.traceTangent(...tangentTo(atMirror(-0.1))).kind,
    "reflection",
  );
  assert.equal(
    partial.traceTangent(...tangentTo(atMirror(0.1))).kind,
    "shutter",
  );
  assert.equal(
    partial.traceTangent(...tangentTo(atMirror(0, 0.7))).kind,
    "wall",
  );
});
test("nearest incoming and outgoing public screens occlude architecture correctly", () => {
  const hidden = scene.traceTangent(...tangentTo({ x: 2.3, y: 1, z: 4 }));
  assert.equal(hidden.kind, "partition");
  assert.equal(hidden.objectId, "entry-screen");
  const board = flat(open.board);
  board.room.walls.push({
    id: "outgoing-blocker",
    a: { x: 6.5, y: 0, z: 3.1 },
    b: { x: 6.5, y: 0, z: 4 },
    bottom: 0,
    top: 2,
  });
  const reflected = new WitnessBackground(board, "entrance").traceTangent(
    ...tangentTo(atMirror()),
  );
  assert.equal(reflected.kind, "reflection");
  assert.equal(reflected.objectId, "outgoing-blocker");
  assert(reflected.material.startsWith("reflected/"));
});
test("opaque front geometry remains behind every actually visible recorded head sample", () => {
  const silhouettes = load(
    path.join(assets, "Scripts/TableKit/RoleSilhouette.ts"),
  );
  const frame = D.frameAt(open.clues, "entrance", 12);
  for (const f of frame.payload.fragments) {
    const triangles = D.projectVisibleSurface(
      open.board,
      "entrance",
      f,
      silhouettes.roleSilhouette(f.role),
    );
    const virtualOrigin =
      f.via === "mirror"
        ? D.sub(
            f.position,
            D.mul(
              mirror.normal,
              2 * D.dot(D.sub(f.position, mirror.origin), mirror.normal),
            ),
          )
        : f.position;
    const normal =
      f.via === "mirror"
        ? { x: f.surfaceRight.z, y: 0, z: f.surfaceRight.x }
        : { x: -f.surfaceRight.z, y: 0, z: f.surfaceRight.x };
    // For reflection, transform the actual plane normal through the mirror.
    const originalNormal = { x: -f.surfaceRight.z, y: 0, z: f.surfaceRight.x };
    const virtualNormal =
      f.via === "mirror"
        ? D.sub(
            originalNormal,
            D.mul(mirror.normal, 2 * D.dot(originalNormal, mirror.normal)),
          )
        : originalNormal;
    for (const triangle of triangles) {
      const coords = triangle.map((point) => {
        const x = Math.tan(point.horizontal);
        return [x, Math.tan(point.vertical) * Math.sqrt(1 + x * x)];
      });
      const x = coords.reduce((sum, p) => sum + p[0], 0) / 3,
        y = coords.reduce((sum, p) => sum + p[1], 0) / 3;
      const direction = {
        x: Math.sin(w.yaw) + x * Math.cos(w.yaw),
        y,
        z: Math.cos(w.yaw) - x * Math.sin(w.yaw),
      };
      const t =
          D.dot(D.sub(virtualOrigin, w.position), virtualNormal) /
          D.dot(direction, virtualNormal),
        target = D.add(w.position, D.mul(direction, t));
      const path = D.distance(w.position, target),
        background = scene.traceTangent(x, y);
      assert(
        background.distance > path - 0.00001,
        "Background geometry would sit in front of a recorded surface",
      );
    }
  }
});
test("bounded plate batches and target crops preserve tangent geometry and cache identity", () => {
  const viewport = { minX: -0.5, maxX: 0.25, minY: -0.2, maxY: 0.2 },
    plate = scene.sample(viewport, 96, 56);
  assert.equal(scene.sample(viewport, 96, 56), plate);
  assert.equal(plate.rayCount, 5376);
  assert(plate.reflectionCount > 0);
  assert(plate.batches.length <= 10);
  assert(plate.batches.some((batch) => batch.layer > 0));
  for (const batch of plate.batches) {
    assert(batch.vertices.length < 65536);
    for (const [x, y] of batch.vertices) {
      assert(x >= viewport.minX - 0.000001 && x <= viewport.maxX + 0.000001);
      assert(y >= viewport.minY - 0.000001 && y <= viewport.maxY + 0.000001);
    }
    for (const index of batch.indices)
      assert(index >= 0 && index < batch.vertices.length);
    for (let i = 0; i < batch.indices.length; i += 3) {
      const [a, b, c] = batch.indices
        .slice(i, i + 3)
        .map((index) => batch.vertices[index]);
      assert(
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= -1e-12,
        "Backdrop triangle faces away from pane",
      );
    }
  }
  const detail = scene.sample(
    { minX: -0.38, maxX: -0.33, minY: -0.045, maxY: 0.045 },
    96,
    56,
  );
  assert.notEqual(detail, plate);
  assert(detail.reflectionCount > 0);
  assert.equal(scene.sample(viewport, 96, 56), plate);
});
test("background is independent of actor identities, event timing, and all trajectories", () => {
  const board = flat(open.board);
  board.tracks = [];
  board.actualHistory = { casting: { A: "Guard" } };
  board.room.exhibit.position = { x: 6, y: 3, z: 2 };
  const other = new WitnessBackground(board, "entrance", STYLE),
    viewport = { minX: -0.5, maxX: 0.25, minY: -0.2, maxY: 0.2 };
  const a = scene.sample(viewport, 32, 24),
    b = other.sample(viewport, 32, 24);
  assert.equal(JSON.stringify(a.batches), JSON.stringify(b.batches));
  assert.deepEqual(Array.from(a.depths), Array.from(b.depths));
});
test("backside, far depth and invalid viewports never invent a mirror observation", () => {
  const board = flat(open.board);
  board.witnesses[0].position = { x: 8, y: 1, z: 3.135 };
  board.witnesses[0].yaw = -Math.PI / 2;
  assert.equal(
    new WitnessBackground(board, "entrance").traceTangent(0, 0).kind,
    "back",
  );
  const near = flat(open.board);
  near.witnesses[0].far = 0.1;
  assert.equal(
    new WitnessBackground(near, "entrance").traceTangent(0, 0).kind,
    "void",
  );
  assert.equal(scene.traceTangent(NaN, 0).kind, "void");
  assert.throws(() => scene.sample({ minX: 0, maxX: 0, minY: 0, maxY: 1 }));
});
test("explicit public partition thickness includes real top and end faces", () => {
  const board = flat(open.board);
  const screen = board.room.walls.find(wall=>wall.id==='east-screen');
  board.witnesses[0] = {
    id: "top",
    position: { x: screen.a.x-.05, y: screen.top+.2, z: 3 },
    yaw: 0,
    fov: Math.PI,
    verticalFov: Math.PI * 0.9,
  };
  const hit = new WitnessBackground(board, "top", {
    partitionThickness: 0.2,
  }).traceTangent(0, -1);
  assert.equal(hit.kind, "partition");
  assert.equal(hit.objectId, "east-screen");
  assert(Math.abs(hit.position.y - 2) < 0.00001);
  assert.equal(hit.material, "trim");
});
test("analytic finite rim survives subpixel sampling and shared scene cache ignores actors", () => {
  const tiny = new WitnessBackground(open.board, "entrance", {
    frameWidth: 0.001,
  });
  const result = tiny.sample(
    { minX: -0.5, maxX: 0.25, minY: -0.2, maxY: 0.2 },
    8,
    8,
  );
  assert(
    result.batches.some(
      (batch) => batch.layer === 1 && batch.indices.length > 0,
    ),
  );
  const first = getWitnessBackground(open.board, "entrance"),
    board = flat(open.board);
  board.tracks = [];
  assert.equal(getWitnessBackground(board, "entrance"), first);
  const changed = flat(open.board);
  changed.room.mirror.aperture = 0;
  assert.notEqual(getWitnessBackground(changed, "entrance"), first);
});
test("every analytic wood rim triangle is a genuinely visible frame ray", () => {
  const plate = scene.sample(
    { minX: -0.55, maxX: 0.3, minY: -0.25, maxY: 0.25 },
    64,
    40,
  );
  let count = 0;
  for (const batch of plate.batches.filter((batch) => batch.layer > 0))
    for (let i = 0; i < batch.indices.length; i += 3) {
      const points = batch.indices
          .slice(i, i + 3)
          .map((index) => batch.vertices[index]),
        x = points.reduce((n, p) => n + p[0], 0) / 3,
        y = points.reduce((n, p) => n + p[1], 0) / 3;
      assert.equal(scene.traceTangent(x, y).kind, "mirror-frame");
      count++;
    }
  assert(count > 0);
  const mutable = flat(open.board),
    old = new WitnessBackground(mutable, "entrance", STYLE);
  mutable.room.mirror.aperture = 0;
  assert.equal(old.traceTangent(...tangentTo(atMirror())).kind, "reflection");
  assert.equal(
    new WitnessBackground(mutable, "entrance", STYLE).traceTangent(
      ...tangentTo(atMirror()),
    ).kind,
    "shutter",
  );
  assert.throws(
    () => new WitnessBackground(open.board, "entrance", { cacheEntries: NaN }),
  );
});
test("one fixed crop preserves Courier and rim geometry when the aperture changes", () => {
  const hidden = new WitnessBackground(closed.board, "entrance", STYLE),
    viewport = { minX: -0.55, maxX: 0.3, minY: -0.25, maxY: 0.25 };
  const first = scene.sample(viewport, 64, 40),
    second = hidden.sample(viewport, 64, 40);
  assert.equal(JSON.stringify(first.viewport), JSON.stringify(second.viewport));
  assert.equal(
    JSON.stringify(first.batches.filter((b) => b.layer > 0)),
    JSON.stringify(second.batches.filter((b) => b.layer > 0)),
  );
  const a = D.frameAt(open.clues, "entrance", 12).payload.fragments.find(
      (f) => f.role === "Courier",
    ),
    b = D.frameAt(closed.clues, "entrance", 12).payload.fragments.find(
      (f) => f.role === "Courier",
    );
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  let changed = 0;
  for (let row = 0; row < 40; row++)
    for (let column = 0; column < 64; column++) {
      const x =
          viewport.minX +
          ((column + 0.5) * (viewport.maxX - viewport.minX)) / 64,
        y =
          viewport.minY + ((row + 0.5) * (viewport.maxY - viewport.minY)) / 40;
      const on = scene.traceTangent(x, y),
        off = hidden.traceTangent(x, y);
      if (on.kind === "reflection") {
        assert.equal(off.kind, "shutter");
        changed++;
      } else
        assert.equal(
          JSON.stringify(on),
          JSON.stringify(off),
          "A static room ray outside the aperture changed",
        );
    }
  assert(changed > 0);
});
const viewport = { minX: -0.5, maxX: 0.25, minY: -0.2, maxY: 0.2 },
  fresh = new WitnessBackground(open.board, "entrance", STYLE),
  start = performance.now(),
  plate = fresh.sample(viewport, 96, 56),
  cold = performance.now() - start,
  cachedStart = performance.now();
fresh.sample(viewport, 96, 56);
const warm = performance.now() - cachedStart;
console.log(
  "PROFILE",
  JSON.stringify({
    coldMs: +cold.toFixed(2),
    cachedMs: +warm.toFixed(3),
    rays: plate.rayCount,
    batches: plate.batches.length,
    triangles: plate.batches.reduce((n, b) => n + b.indices.length / 3, 0),
  }),
);
for (const [columns, rows] of [
  [80, 48],
  [64, 40],
]) {
  const field = new WitnessBackground(open.board, "entrance", STYLE),
    t = performance.now(),
    image = field.sample(viewport, columns, rows);
  console.log(
    "PROFILE-RESOLUTION",
    JSON.stringify({
      columns,
      rows,
      ms: +(performance.now() - t).toFixed(2),
      batches: image.batches.length,
      triangles: image.batches.reduce((n, b) => n + b.indices.length / 3, 0),
    }),
  );
}
console.log(checks + " witness background checks passed");
if (process.env.WITNESS_BACKGROUND_PREVIEW) {
  const A = load(path.join(assets, "Runtime/MuseumScene/RecordedHeadArt.ts")),
    S = load(path.join(assets, "Scripts/TableKit/RoleSilhouette.ts")),
    frame = D.frameAt(open.clues, "entrance", 12);
  const q = (point) => {
    const x = Math.tan(point.horizontal);
    return [x, Math.tan(point.vertical) * Math.sqrt(1 + x * x)];
  };
  const observed = frame.payload.fragments.map((fragment) => ({
      fragment,
      triangles: D.projectVisibleSurface(
        open.board,
        frame.witness,
        fragment,
        S.roleSilhouette(fragment.role),
      ),
    })),
    points = observed.flatMap((o) => o.triangles.flatMap((t) => t.map(q)));
  const left = Math.min(...points.map((p) => p[0])),
    right = Math.max(...points.map((p) => p[0])),
    bottom = Math.min(...points.map((p) => p[1])),
    top = Math.max(...points.map((p) => p[1])),
    gain = Math.min(160, 32 / (right - left), 16 / (top - bottom)),
    cx = (left + right) / 2,
    cy = (bottom + top) / 2;
  const view = {
    minX: cx - 17 / gain,
    maxX: cx + 17 / gain,
    minY: cy - 9 / gain,
    maxY: cy + 9 / gain,
  };
  const back = scene.sample(view, 128, 72),
    polygons = [];
  for (const batch of back.batches)
    for (let i = 0; i < batch.indices.length; i += 3)
      polygons.push({
        color: batch.color,
        points: batch.indices
          .slice(i, i + 3)
          .map((index) => batch.vertices[index]),
      });
  for (const { fragment, triangles } of observed) {
    const art = A.RECORDED_HEAD_ART[fragment.role];
    polygons.push(
      ...triangles.map((t) => ({ color: art.base, points: t.map(q) })),
    );
    for (const patch of art.patches)
      for (const outline of patch.triangles)
        for (const t of D.projectVisibleSurface(
          open.board,
          frame.witness,
          fragment,
          outline,
        ))
          polygons.push({ color: patch.color, points: t.map(q) });
  }
  fs.writeFileSync(
    process.env.WITNESS_BACKGROUND_PREVIEW,
    JSON.stringify({ view, polygons }),
  );
}
