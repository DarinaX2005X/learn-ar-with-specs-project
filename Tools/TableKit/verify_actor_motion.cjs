const assert = require("assert");
const fs = require("fs");
const compiled = process.env.ACTOR_MOTION_COMPILED;
if (!compiled)
  throw new Error("Use test_actor_motion.py to supply temporary compilation");
const gait = require(require("path").join(compiled, "Spatial/PlantedGait.js"));
const timing = require(require("path").join(compiled, "Domain/TrackMotion.js"));
const make = (points) => ({
  keys: points.map(([tick, x, z, yaw = 0]) => ({ tick, x, z, yaw })),
});
const cases = require(require("path").join(compiled, "Domain/cases.js"));
const routes = {
  backward: {
    keys: [
      { tick: 0, x: 0, z: 0, yaw: Math.PI / 2 },
      { tick: 1, x: 0, z: 0, yaw: Math.PI / 2, backward: true },
      { tick: 3, x: -0.15, z: 0, yaw: Math.PI / 2 },
      { tick: 4, x: -0.15, z: 0, yaw: -Math.PI / 2 },
      { tick: 5, x: -0.25, z: 0, yaw: -Math.PI / 2 },
    ],
  },
  shortpause: make([
    [0, 0, 0],
    [2, 0.2, 0],
    [2.1, 0.2, 0, Math.PI / 2],
    [4, 0.2, 0.3],
  ]),
  slow: make([
    [0, 0, 0],
    [6, 0.72, 0],
    [8, 0.72, 0],
    [14, 0.72, 0.72],
    [18, 0.72, 0.72],
  ]),
  static: make([
    [0, 0, 0],
    [24, 0, 0],
  ]),
  turn: make([
    [0, 0, 0, 0],
    [2, 0, 0, Math.PI / 2],
    [4, 0, 0, Math.PI],
    [6, 0, 0, Math.PI],
  ]),
  brisk: make([
    [0, 0, 0],
    [4, 0, 2],
    [8, 2, 2],
    [10, 2, 2],
  ]),
  short: make([
    [0, 0, 0],
    [0.1, 0.01, 0],
    [2, 0.01, 0],
  ]),
  reverse: make([
    [0, 0, 0],
    [4, 0, 0.5],
    [8, 0, 0],
    [10, 0, 0],
  ]),
};
for (const [kind, draft] of [
  ["museum", cases.createMuseumTheft()],
  ...["B", "C"].flatMap((recipient) =>
    [false, true].map((canvas) => [
      "packing" + recipient + (canvas ? "Canvas" : "Brass"),
      cases.createPackingCase({ recipient, canvas }),
    ]),
  ),
])
  for (const track of draft.tracks) routes[kind + track.id] = track;
const footBounds = JSON.parse(
  fs.readFileSync(process.env.ACTOR_MOTION_FOOT_BOUNDS, "utf8"),
);
for (const model of Object.values(footBounds))
  for (const side of ["L", "R"]) {
    const midZ =
      model[side].corners.reduce((sum, p) => sum + p[2], 0) /
      model[side].corners.length;
    assert(
      Math.abs(midZ + gait.SHIPPED_SOLE_CENTRE_FORWARD_CM) < 0.05,
      "stance must centre measured real sole under hip",
    );
  }
assert(
  Math.abs(
    timing.shortestAngle(
      timing.sampleTrackMotion(routes.backward, 2).yaw,
      Math.PI / 2,
    ),
  ) < 1e-8,
  "backstep faces opposite travel",
);
const forwardTwin = {
  keys: routes.backward.keys.map((key) => ({ ...key, backward: undefined })),
};
assert(
  Math.abs(
    timing.sampleTrackMotion(routes.backward, 2).armSwing +
      timing.sampleTrackMotion(forwardTwin, 2).armSwing,
  ) < 1e-8,
  "backward arm swing follows walking direction",
);
const unitTrack = make([
  [0, 0, 0],
  [2, 1, 0],
]);
assert(
  Math.abs(timing.sampleTrackMotion(unitTrack, 1).speedCmPerSecond - 100) <
    1e-8,
  "2logicalticks=1realsecond",
);
let minSoleY = Infinity;
let samples = 0,
  maxResidual = 0,
  maxDrop = 0,
  maxFK = 0,
  maxFootAir = 0,
  maxContinuity = 0;
const reports = {};
function length(a) {
  return Math.hypot(...a);
}
function add(a, b) {
  return a.map((x, i) => x + b[i]);
}
function sub(a, b) {
  return a.map((x, i) => x - b[i]);
}
for (const [name, track] of Object.entries(routes)) {
  const plan = gait.compilePlantedGait(track);
  let previous;
  for (const step of plan.steps) {
    assert(
      step.end > step.start &&
        (step.end - step.start) * timing.MOTION_SECONDS_PER_TICK <= 0.360001,
    );
    maxFootAir = Math.max(
      maxFootAir,
      (step.end - step.start) * timing.MOTION_SECONDS_PER_TICK,
    );
  }
  for (let i = 0; i <= Math.round(track.keys.at(-1).tick * 50); i++) {
    const t = i / 50,
      pose = gait.samplePlantedGait(plan, t);
    samples++;
    assert(
      JSON.stringify(pose) === JSON.stringify(gait.samplePlantedGait(plan, t)),
    );
    assert(
      Math.abs(pose.root.x - timing.sampleTrackMotion(track, t).x) < 1e-10,
    );
    maxDrop = Math.max(maxDrop, -pose.pelvisOffsetCm[1]);
    for (const side of ["L", "R"]) {
      const leg = pose.legs[side];
      assert(
        Object.values(leg)
          .flat()
          .filter((x) => typeof x === "number")
          .every(Number.isFinite),
      );

      maxResidual = Math.max(maxResidual, leg.residualCm);
      const knee = add(
        leg.hipPositionCm,
        gait.rotateMotionPoint(leg.hipRotation, [0, -31.5, 0]),
      );
      const ankle = add(
        knee,
        gait.rotateMotionPoint(
          gait.multiplyMotionRotation(leg.hipRotation, leg.kneeRotation),
          [0, -31.5, 0],
        ),
      );
      const expected = gait.rotateMotionY(
        sub(leg.ankleWorldCm, [
          pose.root.x * 100,
          (pose.root.y - 1) * 100,
          pose.root.z * 100,
        ]),
        -(pose.bodyYaw + Math.PI),
      );
      maxFK = Math.max(maxFK, length(sub(ankle, expected)));
      const total = gait.multiplyMotionRotation(
        gait.multiplyMotionRotation(leg.hipRotation, leg.kneeRotation),
        leg.ankleRotation,
      );
      const up = gait.rotateMotionPoint(total, [0, 1, 0]);
      if (i % 5 === 0)
        for (const model of Object.values(footBounds))
          for (const corner of model[side].corners) {
            const world = add(
              leg.ankleWorldCm,
              gait.rotateMotionY(
                gait.rotateMotionPoint(total, corner),
                pose.bodyYaw + Math.PI,
              ),
            );
            minSoleY = Math.min(minSoleY, world[1]);
            assert(
              world[1] > -0.03,
              "actual GLB foot must not penetrate floor",
            );
          }
      if (leg.planted) {
        assert(Math.abs(up[1] - 1) < 1e-6, "planted soles level");
        assert(Math.abs(leg.contactWorldCm[1]) < 1e-6);
        if (previous && previous.legs[side].planted) {
          assert(
            length(
              sub(leg.contactWorldCm, previous.legs[side].contactWorldCm),
            ) < 1e-7,
            "no world-space stance skating",
          );
          assert(
            Math.abs(
              timing.shortestAngle(previous.legs[side].footYaw, leg.footYaw),
            ) < 1e-7,
            "no planted swivel",
          );
        }
      }
      if (previous)
        maxContinuity = Math.max(
          maxContinuity,
          length(sub(leg.ankleWorldCm, previous.legs[side].ankleWorldCm)),
        );
    }

    assert(pose.support.length >= 1, "at least one foot supports actor");
    previous = pose;
  }
  // Sampling arbitrary/reversed time order cannot change an absolute pose.
  const order = [4, 1, 0, 3, 2].map((f) => (track.keys.at(-1).tick * f) / 4);
  const baseline = order.map((t) =>
    JSON.stringify(gait.samplePlantedGait(plan, t)),
  );
  [...order].reverse().forEach((t) => gait.samplePlantedGait(plan, t));
  assert.deepStrictEqual(
    order.map((t) => JSON.stringify(gait.samplePlantedGait(plan, t))),
    baseline,
  );
  for (const step of plan.steps)
    for (const boundary of [step.start, step.end]) {
      const before = gait.samplePlantedGait(plan, boundary - 1e-6),
        after = gait.samplePlantedGait(plan, boundary + 1e-6);
      assert(
        length(
          sub(
            before.legs[step.side].ankleWorldCm,
            after.legs[step.side].ankleWorldCm,
          ),
        ) < 0.01,
        "no stale foot jump at contact boundary",
      );
    }
  reports[name] = {
    footSteps: plan.steps.length,
    maxAirSeconds: Math.max(
      0,
      ...plan.steps.map(
        (s) => (s.end - s.start) * timing.MOTION_SECONDS_PER_TICK,
      ),
    ),
  };
}
assert(maxFK < 0.001, "two-bone FK must reach actual ankle target");
assert(
  maxResidual < 0.001,
  "supported cases must not require foot/root slipping",
);
assert(maxDrop <= 12.000001, "pelvis drop bounded");
assert(
  gait.compilePlantedGait(routes.static).steps.length === 0,
  "no idle treadmill",
);
const report = {
  samples,
  minimumActualBootBoundsY: minSoleY,
  maxResidualCm: maxResidual,
  maxFKCm: maxFK,
  maxPelvisDropCm: maxDrop,
  maxAirSeconds: maxFootAir,
  maxPer10msFootTravelCm: maxContinuity,
  routes: reports,
};
if (process.env.ACTOR_MOTION_REPORT)
  fs.writeFileSync(
    process.env.ACTOR_MOTION_REPORT,
    JSON.stringify(report, null, 2),
  );
console.log(
  "PASS planted contacts,levelsole,FK,slow/brisk/stop/turn/reverse,seekdeterminism",
  JSON.stringify(report),
);
