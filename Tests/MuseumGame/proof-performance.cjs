const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const compilerDir = process.env.PATH.split(path.delimiter).find((dir) => {
  const file = path.resolve(dir, "../typescript/package.json");
  return (
    fs.existsSync(file) &&
    JSON.parse(fs.readFileSync(file, "utf8")).version === "6.0.2"
  );
});
assert(compilerDir, "Run with npm exec TypeScript 6.0.2");
const ts = require(
  path.resolve(compilerDir, "../typescript/lib/typescript.js"),
);
const cache = new Map();
const fast = process.argv.includes("--sufficient");
const batch = Number(
  process.argv.find((arg) => arg.startsWith("--batch="))?.split("=")[1] ?? 8,
);
const metrics = { work: 0 };
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  let source = fs.readFileSync(file, "utf8");
  if (file.endsWith(path.join("Domain", "prove.ts"))) {
    source = source.replace("work++;", "work++; metrics.work++;");
  }
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      metrics,
      require: (p) => load(path.resolve(path.dirname(file), p + ".ts")),
    },
    { filename: file },
  );
  return module.exports;
}
const assets = path.resolve(__dirname, "../../Assets");
const { SessionShelf } = load(path.join(assets, "Shelf/SessionShelf.ts"));
const { AuthorSession } = load(path.join(assets, "Author/AuthorSession.ts"));
const { proveSteps } = load(path.join(assets, "Domain/prove.ts"));
const { compileCase } = load(path.join(assets, "Domain/compile.ts"));
const percentile = (xs, p) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)
  ];
function bench(draft) {
  const result = compileCase(draft);
  assert(result.ok);
  metrics.work = 0;
  const task = proveSteps(
    result.sealed.board,
    result.sealed.clues,
    [],
    "Underdetermined",
    { minimizeReasons: !fast, batchSize: batch },
  );
  const slices = [];
  let yields = 0,
    step,
    start = performance.now();
  do {
    const before = performance.now();
    step = task.next();
    slices.push(performance.now() - before);
    if (!step.done) yields++;
  } while (!step.done);
  const wall = performance.now() - start;
  const work = metrics.work;
  const session = new AuthorSession(draft);
  assert(session.startTest());
  let frames = 0;
  const framesMs = [];
  start = performance.now();
  while (session.snapshot().testing && frames < 100000) {
    const before = performance.now();
    session.advanceProof(4);
    framesMs.push(performance.now() - before);
    frames++;
  }
  assert(!session.snapshot().testing);
  return {
    minimizeReasons: !fast,
    caseId: draft.id,
    rev: draft.rev,
    aperture: draft.room.mirror.aperture,
    clues: result.sealed.clues.clues.length,
    status: step.value.status,
    possible: step.value.possibleCulprits,
    work,
    yields,
    generatorFramesAtFourYields: Math.ceil((yields+1)/4),
    authorFrames:frames,
    minimumSecondsAt30fps: frames / 30,
    minimumSecondsAt60fps: frames / 60,
    totalComputeMs: +wall.toFixed(2),
    sliceP90Ms: +percentile(slices, 0.9).toFixed(3),
    sliceMaxMs: +Math.max(...slices).toFixed(3),
    frameP90Ms: +percentile(framesMs, 0.9).toFixed(3),
    frameMaxMs: +Math.max(...framesMs).toFixed(3),
  };
}
const shelf = new SessionShelf();
const closedDraft = shelf.fork(shelf.activeRef());
const closed = new AuthorSession(closedDraft);
closed.edit({ kind: "setAperture", aperture: 0 });
const closedSource = closed.getDraft();
const compiled = compileCase(closedSource);
assert(compiled.ok);
const ref = shelf.store(compiled);
const openDraft = shelf.fork(ref);
const open = new AuthorSession(openDraft);
open.edit({ kind: "setAperture", aperture: 1 });
for (const draft of [closedSource, open.getDraft()]) {
  const runs = Array.from({ length: 3 }, () => bench(draft));
  console.log(JSON.stringify({ runs }));
}
