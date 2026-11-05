const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
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
  ),
  typescript = require(
    path.resolve(typescriptBinDirectory, "../typescript/lib/typescript.js"),
  );
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    Object.assign(this, { x, y, z });
  }
}
class MockSceneObject {
  constructor(name) {
    this.name = name;
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.children = [];
  }
  setParent(parent) {
    this.parent = parent;
    parent.children.push(this);
  }
  getTransform() {
    const sceneObject = this;
    return {
      setWorldPosition(vector) {
        const parentPosition =
          sceneObject.parent?.getWorldPosition() ?? new Vector3();
        sceneObject.position = new Vector3(
          vector.x - parentPosition.x,
          vector.y - parentPosition.y,
          vector.z - parentPosition.z,
        );
      },
      getWorldPosition: () => sceneObject.getWorldPosition(),
      setWorldRotation() {},
      getWorldRotation: () => ({}),
      setWorldScale(vector) {
        sceneObject.scale = vector;
      },
      setLocalScale(vector) {
        sceneObject.scale = vector;
      },
      setLocalPosition(vector) {
        sceneObject.position = vector;
      },
      setLocalRotation() {},
    };
  }
  getWorldPosition() {
    const parentPosition = this.parent?.getWorldPosition() ?? new Vector3();
    return new Vector3(
      this.position.x + parentPosition.x,
      this.position.y + parentPosition.y,
      this.position.z + parentPosition.z,
    );
  }
}
const root = new MockSceneObject("Museum"),
  bench = new MockSceneObject("Anchor_ConservationBench");
bench.position = new Vector3(-350, 94, 380);
const evaluatedModule = { exports: {} };
vm.runInNewContext(
  typescript.transpileModule(
    fs.readFileSync(
      path.resolve(__dirname, "../../Assets/Runtime/MuseumScene.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2021,
      },
    },
  ).outputText,
  {
    module: evaluatedModule,
    exports: evaluatedModule.exports,
    vec3: Vector3,
    vec4: class {},
    quat: { fromEulerAngles: () => ({}) },
    global: {
      scene: { createSceneObject: (name) => new MockSceneObject(name) },
    },
    require: () => ({}),
  },
);
const museumScene = Object.create(
    evaluatedModule.exports.MuseumScene.prototype,
  ),
  parts = [];
Object.assign(museumScene, {
  root,
  clockHands: [],
  findGlobal: (name) => (name === bench.name ? bench : undefined),
  extrusion(parent, name, outline, z, depth) {
    const meshObject = new MockSceneObject(name);
    meshObject.setParent(parent);
    const parentPosition = parent.getWorldPosition(),
      parentScale = parent.scale;
    parts.push({
      name,
      parent,
      min: [
        Math.min(...outline.map((point) => point[0])) * parentScale.x +
          parentPosition.x,
        Math.min(...outline.map((point) => point[1])) * parentScale.y +
          parentPosition.y,
        z * parentScale.z + parentPosition.z,
      ],
      max: [
        Math.max(...outline.map((point) => point[0])) * parentScale.x +
          parentPosition.x,
        Math.max(...outline.map((point) => point[1])) * parentScale.y +
          parentPosition.y,
        (z + depth) * parentScale.z + parentPosition.z,
      ],
    });
    return meshObject;
  },
});
museumScene.mountBenchClock();
assert.equal(museumScene.clockHands.length, 1);
assert.equal(
  parts.filter((point) => point.name === "ClockMinuteMark").length,
  12,
);
const foot = parts.find((point) => point.name === "DeskClockFoot");
assert.deepEqual(foot.min, [-285.5, 97.4, 328]);
assert.deepEqual(foot.max, [-250.5, 99.4, 338]);
const face = parts.find((point) => point.name === "ClockFaceCover");
assert(Math.abs(face.min[2] - 328.8) < 1e-8);
assert(Math.abs(face.max[0] - face.min[0] - 15.708) < 1e-6);
const needle = parts.find((point) => point.name === "ClockTimeHand");
assert(needle.min[2] < face.min[2]);
assert.equal(needle.parent, museumScene.clockHands[0].parent);
assert(foot.min[0] > -288.5, "foot must clear paper by3cm");
assert(foot.max[0] < -245, "foot remains inside mat");
// Actual callback control geometry. No constructor or scene pose data is fabricated as user evidence.
const playTableModule = { exports: {} };
class MockEvent {
  add() {}
}
vm.runInNewContext(
  typescript.transpileModule(
    fs.readFileSync(
      path.resolve(__dirname, "../../Assets/Runtime/PlayTable.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2021,
      },
    },
  ).outputText,
  {
    module: playTableModule,
    exports: playTableModule.exports,
    vec3: Vector3,
    vec4: class {},
    require: (specifier) =>
      specifier.endsWith("MuseumFonts") ? { applyMuseumFont() {} } : {},
  },
);
const table = Object.create(playTableModule.exports.PlayTable.prototype),
  controls = [];
Object.assign(table, {
  ports: {},
  state: { flow: { mode: "detective" }, detective: { tick: 12 } },
  offset: (a, x, y, z) => [a[0] + x, a[1] + y, a[2] + z],
  finishDrag() {},
  bindObject(id, position, size, label, click, active) {
    const control = {
      id,
      position,
      size,
      label,
      click,
      active,
      input: { onDragStart: new MockEvent(), onDragUpdate: new MockEvent() },
      text: { textFill: {} },
      inscription: {
        getTransform: () => ({
          setLocalPosition(vector) {
            control.ink = vector;
          },
        }),
      },
    };
    controls.push(control);
    return control;
  },
});
table.bindClock("WorkshopClock", [-268, 115.4, 333]);
const [main, reset, previous, next] = controls;
assert.deepEqual(Array.from(main.size), [18, 18, 8]);
assert.equal(reset.position[1], 103);
assert.equal(previous.position[0], -255);
assert.equal(next.position[0], -281);
assert(reset.position[1] - reset.size[1] / 2 > 97.4);
assert(
  reset.position[1] + reset.size[1] / 2 < main.position[1] - main.size[1] / 2,
);
for (const control of controls) assert.equal(control.ink.z, -5.5);
assert(
  previous.position[0] > next.position[0],
  "Facing +storyZ: visitor-right is −storyX, therefore Next is right",
);
console.log(
  "PASS actual mountBenchClock + mountClock dial reuse, physical " +
    "support/footprint, matching collider/reset/± geometry, ink ahead " +
    "of face, visitor-right Next",
);
