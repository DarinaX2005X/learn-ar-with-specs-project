const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  assert = require("node:assert/strict");
const typescriptBinDirectory = process.env.PATH.split(path.delimiter).find(
  (directory) => {
    const typescriptPackagePath = path.resolve(
      directory,
      "../typescript/package.json",
    );
    return (
      fs.existsSync(typescriptPackagePath) &&
      JSON.parse(fs.readFileSync(typescriptPackagePath, "utf8")).version ===
        "6.0.2"
    );
  },
);
const typescript = require(
  path.resolve(typescriptBinDirectory, "../typescript/lib/typescript.js"),
);
let right = { x: 1, y: 0, z: 0 };
class Vector3 {
  constructor(x, y, z) {
    Object.assign(this, { x, y, z });
  }
}
class MockEvent {
  handlers = [];
  add(handler) {
    this.handlers.push(handler);
  }
  fire(e) {
    this.handlers.forEach((handler) => handler(e));
  }
}
function loadModule(file, legacy = false) {
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(
    typescript.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2021,
      },
    }).outputText,
    {
      module: evaluatedModule,
      exports: evaluatedModule.exports,
      vec3: Vector3,
      vec4: class {
        constructor(x, y, z, w) {
          Object.assign(this, { x, y, z, w });
        }
      },
      require(specifier) {
        if (specifier.includes("WorldCameraFinderProvider"))
          return legacy
            ? {}
            : {
                __esModule: true,
                default: { getInstance: () => ({ right: () => right }) },
              };
        if (specifier.endsWith("MuseumFonts")) return { applyMuseumFont() {} };
        return {};
      },
    },
  );
  return evaluatedModule.exports.PlayTable;
}
for (const legacy of [false, true]) {
  const PlayTable = loadModule(
    path.resolve(__dirname, "../../Assets/Runtime/PlayTable.ts"),
    legacy,
  );
  for (const owner of ["detective", "author", "reveal"])
    for (const id of ["EntryClock", "HallClock", "WorkshopClock"])
      for (const height of [115, 165])
        for (const yaw of [
          0,
          Math.PI / 2,
          Math.PI,
          (175 * Math.PI) / 180,
          -Math.PI / 2,
        ]) {
          const controls = new Map(),
            commands = [],
            playTable = Object.create(PlayTable.prototype);
          Object.assign(playTable, {
            ports: {},
            epoch: 1,
            inputGeneration: 0,
            state: {
              flow: { mode: owner === "reveal" ? "finished" : "detective" },
              [owner]: { tick: 12, playing: false },
            },
            offset: (a) => a,
            finishDrag: (i, handler) => i.onDragEnd.add(handler),
            storyDelta: (vector) => vector,
            bindObject(id, position, size, label, click, active) {
              const control = {
                input: {
                  onDragStart: new MockEvent(),
                  onDragUpdate: new MockEvent(),
                  onDragEnd: new MockEvent(),
                },
                text: { textFill: {} },
                inscription: {
                  getTransform: () => ({ setLocalPosition() {} }),
                },
                label,
                click,
                active,
              };
              controls.set(id, control);
              return control;
            },
            detective: send,
            author: send,
            reveal: send,
            flow: send,
            step: (name) => commands.push({ step: name }),
          });
          function send(command) {
            commands.push(command);
            if (command.tick !== undefined)
              playTable.state[owner].tick = command.tick;
          }
          playTable.bindClock(id, [0, height, 0]);
          const control = controls.get(id);
          right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
          control.input.onDragStart.fire({});
          const captured = { ...right };
          right = { x: -right.x, y: 0, z: -right.z };
          const vector = legacy
            ? { x: 8, y: 0, z: 0 }
            : { x: captured.x * 8, y: 0, z: captured.z * 8 };
          // Contradictory plane vector proves the SDK origin delta is authoritative.
          control.input.onDragUpdate.fire({
            dragVector: vector,
            planecastDragVector: { x: -800, y: 0, z: 0 },
          });
          assert.equal(
            playTable.state[owner].tick,
            16,
            `installed/${owner}/${id}/${yaw}/forward`,
          );
          assert.equal(control.text.text, "8.0 s");
          assert.match(control.label(), /Play.*8\.0/);
          control.input.onDragUpdate.fire({
            dragVector: { x: -vector.x * 2, y: 0, z: -vector.z * 2 },
          });
          assert.equal(playTable.state[owner].tick, 8);
          assert.equal(control.text.text, "4.0 s");
          assert.match(control.label(), /Play.*4\.0/);
          const count = commands.length;
          playTable.inputGeneration++;
          control.input.onDragUpdate.fire({ dragVector: vector });
          assert.equal(commands.length, count, "stale generation");
          control.input.onDragStart.fire({});
          playTable.epoch++;
          control.input.onDragUpdate.fire({ dragVector: vector });
          assert.equal(commands.length, count, "stale epoch");
        }
}
console.log(
  "PASS actual bindClock callbacks: all 3 stations × " +
    "detective/author/reveal × seated/standing × 5 yaw, capture, " +
    "forward16/rewind8, inscription, stale epoch/generation; " +
    "postclock/on-rim and legacy headless hosts",
);
