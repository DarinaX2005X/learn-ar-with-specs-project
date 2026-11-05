const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  assert = require("node:assert/strict");
const typescriptBinDirectory = process.env.PATH.split(path.delimiter).find(
  (directory) =>
    fs.existsSync(path.resolve(directory, "../typescript/package.json")) &&
    JSON.parse(
      fs.readFileSync(
        path.resolve(directory, "../typescript/package.json"),
        "utf8",
      ),
    ).version === "6.0.2",
);
assert(typescriptBinDirectory, "Run with run.ps1 (TypeScript6.0.2 pinned)");
const typescript = require(
  path.resolve(typescriptBinDirectory, "../typescript/lib/typescript.js"),
);
const projectRoot = path.resolve(__dirname, "../..");
const fixturePath = path.join(
  projectRoot,
  "Assets/Tests/Leaf/CurtainReachScenario.ts",
);
const helperPath = path.join(
  projectRoot,
  "Assets/Tests/Leaf/CurtainRailInput.ts",
);
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    Object.assign(this, { x, y, z });
  }
  add(other) {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }
  sub(other) {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }
  uniformScale(scalar) {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }
  get length() {
    return Math.hypot(this.x, this.y, this.z);
  }
  normalize() {
    return this.uniformScale(1 / this.length);
  }
  cross(other) {
    return new Vector3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x,
    );
  }
  distance(other) {
    return this.sub(other).length;
  }
  static up() {
    return new Vector3(0, 1, 0);
  }
  static back() {
    return new Vector3(0, 0, 1);
  }
}
class EventSignal {
  constructor() {
    this.handlers = [];
  }
  add(handler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(
        (registeredHandler) => registeredHandler !== handler,
      );
    };
  }
  fire(event) {
    this.handlers.slice().forEach((handler) => handler(event));
  }
}
async function runScenarioCase(caseName) {
  let elapsedSeconds = 0,
    freshKeySent = false,
    ikDestroyed = false,
    disposedSetupCount = 0,
    createdIkCount = 0,
    settledTriggerCount = 0;
  const curtainState = {
    caseId: "local-fixture",
    mode: "author",
    aperture: 1,
    revision: 1,
    tick: 0,
    preview: false,
  };
  const keyListeners = new Map(),
    controlsByName = new Map();
  const triggeredControlNames = [];
  let cameraPosition = new Vector3(0, 32, -45);
  const cameraRotation = { multiplyVec3: (vector) => vector };
  const cameraProvider = {
    inFoV: () => caseName !== "fov",
    getComponent: () => ({
      getTransform: () => ({
        getWorldPosition: () => cameraPosition,
        getWorldRotation: () => cameraRotation,
      }),
    }),
  };
  for (const [controlName, worldPosition] of [
    ["Use_CurtainHandle", new Vector3(0, -20, 0)],
    ["Use_CurtainOpen", new Vector3(0, 2, 0)],
    ["Use_CurtainClose", new Vector3(0, 2, -43)],
  ]) {
    const control = {
      getTransform: () => ({ getWorldPosition: () => worldPosition }),
    };
    for (const event of [
      "onHoverEnter",
      "onTriggerStart",
      "onTriggerEnd",
      "onTriggerCanceled",
    ])
      control[event] = new EventSignal();
    controlsByName.set(controlName, control);
  }
  const advanceMockTime = async (milliseconds) => {
    elapsedSeconds += milliseconds / 1000;
    if (
      !freshKeySent &&
      keyListeners.has("KeyPressEvent") &&
      caseName !== "no-key"
    ) {
      freshKeySent = true;
      keyListeners.get("KeyPressEvent")({ key: "K" });
      keyListeners.get("KeyReleaseEvent")?.({ key: "K" });
    }
  };
  const readSnapshot = () => ({ ...curtainState });
  const findControl = (controlName) => {
    assert(controlsByName.has(controlName));
    return controlsByName.get(controlName);
  };
  const diagnosticRecorder = {
    policy: "prior",
    setPolicy(policy) {
      this.policy = policy;
    },
  };
  class MockSetupInteractor {
    constructor() {
      this.sikInteractor = {};
    }
    stopSelecting() {}
    destroy() {
      disposedSetupCount++;
    }
  }
  class MockScenario {
    createEvent(eventName) {
      return {
        bind: (listener) => keyListeners.set(eventName, listener),
        name: eventName,
      };
    }
    removeEvent(event) {
      keyListeners.delete(event.name);
    }
  }
  class MockIKBodyInteractor {
    constructor() {
      createdIkCount++;
      this.right = {
        currentArmKeypoints:
          caseName === "no-arm"
            ? undefined
            : {
                shoulder:
                  caseName === "far"
                    ? new Vector3(0, -5, -100)
                    : new Vector3(0, -5, -45),
              },
        isIndirect: () => caseName === "indirect",
        trigger: async (control, useIndirect) => {
          assert.equal(useIndirect, false);
          const controlName = [...controlsByName].find(
            ([, candidateControl]) => candidateControl === control,
          )[0];
          triggeredControlNames.push(controlName);
          const triggerCompletionTime =
            elapsedSeconds + (triggeredControlNames.length === 1 ? 9.3 : 1.4);
          if (caseName === "timeout") {
            while (!ikDestroyed) await advanceMockTime(50);
            settledTriggerCount++;
            return false;
          }
          while (elapsedSeconds < triggerCompletionTime)
            await advanceMockTime(50);
          if (caseName === "declined") return false;
          const event = {
            interactor: { inputType: caseName === "wrong-hand" ? 32 : 2 },
          };
          if (caseName !== "no-hover") control.onHoverEnter.fire(event);
          control.onTriggerStart.fire(event);
          if (caseName === "cancel") control.onTriggerCanceled.fire(event);
          if (caseName !== "no-end") control.onTriggerEnd.fire(event);
          if (caseName === "double-end") control.onTriggerEnd.fire(event);
          curtainState.aperture = controlName === "Use_CurtainHandle" ? 0 : 1;
          curtainState.revision += caseName === "two-revisions" ? 2 : 1;
          if (caseName === "case-change") curtainState.caseId = "other";
          if (caseName === "role-change") curtainState.mode = "detective";
          if (caseName === "clock-change") curtainState.tick++;
          if (caseName === "view-change")
            cameraPosition = cameraPosition.add(new Vector3(1));
          settledTriggerCount++;
          return true;
        },
      };
    }
    destroy() {
      ikDestroyed = true;
    }
  }
  const evaluatedModules = new Map();
  function loadMockedModule(sourcePath) {
    sourcePath = path.resolve(sourcePath);
    if (evaluatedModules.has(sourcePath))
      return evaluatedModules.get(sourcePath).exports;
    const evaluatedModule = { exports: {} };
    evaluatedModules.set(sourcePath, evaluatedModule);
    const compiledSource = typescript.transpileModule(
      fs.readFileSync(sourcePath, "utf8"),
      {
        compilerOptions: {
          target: typescript.ScriptTarget.ES2021,
          module: typescript.ModuleKind.CommonJS,
          experimentalDecorators: true,
          esModuleInterop: false,
        },
      },
    ).outputText;
    vm.runInNewContext(
      compiledSource,
      {
        exports: evaluatedModule.exports,
        module: evaluatedModule,
        BaseScriptComponent: MockScenario,
        component: (componentClass) => componentClass,
        vec3: Vector3,
        Keys: { K: "K" },
        getTime: () => elapsedSeconds,
        print: () => {},
        require: (specifier) => {
          if (specifier === "./CurtainRailInput")
            return loadMockedModule(helperPath);
          if (specifier === "./CountercaseLeafProbe")
            return {
              read: readSnapshot,
              target: findControl,
              waitFor: async (label, predicate) => {
                for (let i = 0; i < 100 && !predicate(readSnapshot()); i++)
                  await advanceMockTime(50);
                if (!predicate(readSnapshot()))
                  throw new Error(label + "; snapshot=PRIVATE");
                return readSnapshot();
              },
            };
          if (specifier === "./MuseumJourney")
            return { stageCopy: async () => readSnapshot() };
          if (specifier.endsWith("/Scenario"))
            return { Scenario: MockScenario };
          if (specifier.endsWith("/Utils"))
            return {
              sleep: advanceMockTime,
              nextFrame: () => advanceMockTime(16),
            };
          if (specifier.endsWith("/IKBodyInteractor"))
            return { IKBodyInteractor: MockIKBodyInteractor };
          if (specifier.endsWith("/ArmModel"))
            return { WRIST_MAX_REACH_CM: 67.5 };
          if (specifier.endsWith("/DiagnosticRecorder"))
            return {
              DiagnosticRecorder: { getInstance: () => diagnosticRecorder },
            };
          if (specifier.endsWith("/WorldCameraFinderProvider"))
            return { default: { getInstance: () => cameraProvider } };
          if (specifier.endsWith("/DefaultLeafInteractor"))
            return { DefaultLeafInteractor: MockSetupInteractor };
          if (specifier.endsWith("/Interactor"))
            return { InteractorInputType: { RightHand: 2 } };
          throw new Error("Unmocked platform import " + specifier);
        },
      },
      { filename: sourcePath },
    );
    return evaluatedModule.exports;
  }
  let scenarioError;
  try {
    await new (loadMockedModule(fixturePath).CurtainReachScenario)().run();
  } catch (caughtError) {
    scenarioError = caughtError;
  }
  assert.equal(diagnosticRecorder.policy, "prior", "restore diagnostic policy");
  assert.equal(keyListeners.size, 0, "remove owned key listeners");
  assert.equal(disposedSetupCount, 1, "setup release idempotent");
  for (const control of controlsByName.values())
    for (const eventName of [
      "onHoverEnter",
      "onTriggerStart",
      "onTriggerEnd",
      "onTriggerCanceled",
    ])
      assert.equal(
        control[eventName].handlers.length,
        0,
        "remove actual target listeners",
      );
  if (createdIkCount) assert(ikDestroyed, "owned IK destroyed");
  if (caseName === "pass") {
    assert.equal(scenarioError, undefined);
    assert.deepEqual(triggeredControlNames, [
      "Use_CurtainHandle",
      "Use_CurtainOpen",
    ]);
    assert.equal(curtainState.aperture, 1);
    assert.equal(curtainState.revision, 3);
    assert.equal(settledTriggerCount, 2);
  } else {
    assert(scenarioError, "must reject " + caseName);
    assert(!String(scenarioError).includes("PRIVATE"), "no full snapshot leak");
    if (caseName === "timeout") {
      assert.equal(settledTriggerCount, 1, "join original timed-out operation");
      assert.equal(
        triggeredControlNames.length,
        1,
        "never attempt reverse after timeout",
      );
    }
  }
  return { mode: caseName, seconds: elapsedSeconds, failed: !!scenarioError };
}
(async () => {
  for (const caseName of [
    "pass",
    "no-key",
    "no-arm",
    "fov",
    "far",
    "indirect",
    "declined",
    "no-hover",
    "no-end",
    "double-end",
    "cancel",
    "wrong-hand",
    "two-revisions",
    "case-change",
    "role-change",
    "clock-change",
    "view-change",
    "timeout",
  ])
    console.log(JSON.stringify(await runScenarioCase(caseName)));
  console.log(
    "PASS actual permanent fixture + shared deadline/setup helper: " +
      "9.3-second direct path, canonical right-hand events, one commit each, " +
      "negative gates and joined cleanup; mocks do not prove native reach",
  );
})();
