import {
  MotionTrack,
  TrackMotionSample,
  sampleTrackMotion,
  shortestAngle,
  clampMotion,
  MOTION_SECONDS_PER_TICK,
  motionTicks,
} from "../Domain/TrackMotion";
export type MotionPoint = readonly [number, number, number];
export type MotionRotation = readonly [number, number, number, number];
export type FootSide = "L" | "R";
export interface FootContact {
  positionCm: MotionPoint;
  yaw: number;
}
export interface FootStep {
  side: FootSide;
  start: number;
  end: number;
  from: FootContact;
  to: FootContact;
  liftCm: number;
}
export interface GaitPlan {
  track: MotionTrack;
  steps: readonly FootStep[];
  initial: Readonly<Record<FootSide, FootContact>>;
  facingAt: (tick: number) => number;
}
export interface LegPose {
  hipPositionCm: MotionPoint;
  hipRotation: MotionRotation;
  kneeRotation: MotionRotation;
  ankleRotation: MotionRotation;
  ankleWorldCm: MotionPoint;
  contactWorldCm: MotionPoint;
  footYaw: number;
  planted: boolean;
  swing: number;
  residualCm: number;
}
export interface PlantedPose {
  root: TrackMotionSample;
  bodyYaw: number;
  legs: Readonly<Record<FootSide, LegPose>>;
  pelvisOffsetCm: MotionPoint;
  /** Compose with the arm solver's upper-body lean, never replace that lean. */
  upperBodyOffsetCm: MotionPoint;
  armSwing: number;
  support: readonly FootSide[];
  reachLimited: boolean;
}
const SIDES: FootSide[] = ["L", "R"];
/** All four shipped soles have POSITION Z midpoint -5.25cm from the ankle.
 * Put the actual sole midpoint under the hip instead of standing on its heel. */
export const SHIPPED_SOLE_CENTRE_FORWARD_CM = 5.25;
const add = (a: MotionPoint, b: MotionPoint): MotionPoint => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const sub = (a: MotionPoint, b: MotionPoint): MotionPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const scale = (a: MotionPoint, s: number): MotionPoint => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
const dot = (a: MotionPoint, b: MotionPoint) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: MotionPoint, b: MotionPoint): MotionPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: MotionPoint) => Math.hypot(...a);
const unit = (
  a: MotionPoint,
  fallback: MotionPoint = [0, -1, 0],
): MotionPoint => (norm(a) > 1e-10 ? scale(a, 1 / norm(a)) : fallback);
const smooth = (x: number) => {
  const t = clampMotion(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const rotateMotionY = (p: MotionPoint, yaw: number): MotionPoint => [
  Math.cos(yaw) * p[0] + Math.sin(yaw) * p[2],
  p[1],
  -Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2],
];
export const multiplyMotionRotation = (
  a: MotionRotation,
  b: MotionRotation,
): MotionRotation => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const inverse = (q: MotionRotation): MotionRotation => [
  -q[0],
  -q[1],
  -q[2],
  q[3],
];
const axisAngle = (axis: MotionPoint, angle: number): MotionRotation => [
  axis[0] * Math.sin(angle / 2),
  axis[1] * Math.sin(angle / 2),
  axis[2] * Math.sin(angle / 2),
  Math.cos(angle / 2),
];
function fromTo(a: MotionPoint, b: MotionPoint): MotionRotation {
  const u = unit(a),
    v = unit(b),
    d = dot(u, v);
  if (d < -0.999999)
    return axisAngle(
      unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0])),
      Math.PI,
    );
  const c = cross(u, v),
    q: MotionRotation = [...c, 1 + d],
    n = Math.hypot(...q);
  return q.map((x) => x / n) as unknown as MotionRotation;
}
export function rotateMotionPoint(
  q: MotionRotation,
  p: MotionPoint,
): MotionPoint {
  const v: MotionPoint = [q[0], q[1], q[2]],
    t = scale(cross(v, p), 2);
  return add(p, add(scale(t, q[3]), cross(v, t)));
}
const rootPoint = (p: TrackMotionSample): MotionPoint => [
  p.x * 100,
  (p.y - 1) * 100,
  p.z * 100,
];
const footAt = (
  p: TrackMotionSample,
  side: FootSide,
  yaw: number,
): FootContact => ({
  positionCm: add(
    rootPoint(p),
    rotateMotionY(
      [side === "L" ? -8.4 : 8.4, 0, SHIPPED_SOLE_CENTRE_FORWARD_CM],
      yaw + Math.PI,
    ),
  ),
  yaw,
});

function footSample(
  plan: GaitPlan,
  side: FootSide,
  tick: number,
): FootContact & {
  planted: boolean;
  swing: number;
  lift: number;
  pitch: number;
} {
  let contact = plan.initial[side];
  for (const step of plan.steps) {
    if (step.side !== side) continue;
    if (tick < step.start) break;
    if (tick >= step.end) {
      contact = step.to;
      continue;
    }
    const u = clampMotion((tick - step.start) / (step.end - step.start), 0, 1),
      f = smooth(u),
      arc = Math.sin(Math.PI * u) ** 2;
    return {
      positionCm: add(
        scale(step.from.positionCm, 1 - f),
        scale(step.to.positionCm, f),
      ),
      yaw: step.from.yaw + shortestAngle(step.from.yaw, step.to.yaw) * f,
      planted: false,
      swing: u,
      lift: step.liftCm * arc,
      pitch: 0.065 * arc,
    };
  }
  return { ...contact, planted: true, swing: 0, lift: 0, pitch: 0 };
}

/** Compile once per visible route/facing revision. No accumulated frame state.
 * Footfall times are arc-distance crossings; transfer is capped at 360ms even at
 * a slow museum walk. Both feet hold their actual last contact after a stop.
 */
export function compilePlantedGait(
  track: MotionTrack,
  options: { facingAt?: (tick: number) => number } = {},
): GaitPlan {
  const first = track.keys[0];
  if (!first) throw new Error("A gait needs a route");
  const facingAt =
    options.facingAt ?? ((tick: number) => sampleTrackMotion(track, tick).yaw);
  const firstPose = sampleTrackMotion(track, first.tick);
  const initial = {
    L: footAt(firstPose, "L", facingAt(first.tick)),
    R: footAt(firstPose, "R", facingAt(first.tick)),
  };
  const steps: FootStep[] = [],
    plan: GaitPlan = { track, steps, initial, facingAt };
  const lastTick = track.keys[track.keys.length - 1].tick;
  let nextSide: FootSide = "L",
    lastDistance = firstPose.distanceCm,
    previousMoving = false,
    pendingStart = false;
  const horizontal = (
    root: TrackMotionSample,
    side: FootSide,
    position: MotionPoint,
  ): number => {
    const local = rotateMotionY(
      sub(position, rootPoint(root)),
      -(facingAt(rootTick) + Math.PI),
    );
    return Math.hypot(local[0] - (side === "L" ? -8.4 : 8.4), local[2]);
  };
  // The compiled sampling grid is physical time, not frame time. It can only
  // create transfer events; evaluating a playback pose remains a direct sample.
  let rootTick = first.tick;
  for (
    let index = 0;
    first.tick + index * motionTicks(0.015) < lastTick;
    index++
  ) {
    const tick = first.tick + index * motionTicks(0.015);
    rootTick = tick;
    const root = sampleTrackMotion(track, tick),
      feet = { L: footSample(plan, "L", tick), R: footSample(plan, "R", tick) };
    if (root.moving && !previousMoving) pendingStart = true;
    previousMoving = root.moving;
    if (!feet.L.planted || !feet.R.planted) continue;
    const strain = {
      L: horizontal(root, "L", feet.L.positionCm),
      R: horizontal(root, "R", feet.R.positionCm),
    };
    let side: FootSide = nextSide;
    let turning = false;
    if (root.moving) {
      const worst: FootSide = strain.L >= strain.R ? "L" : "R";
      const near = sampleTrackMotion(track, tick + motionTicks(0.01));
      const direction = unit(
        [near.x - root.x, 0, near.z - root.z],
        [Math.sin(root.yaw), 0, Math.cos(root.yaw)],
      );
      const behind = {
        L: dot(sub(rootPoint(root), feet.L.positionCm), direction),
        R: dot(sub(rootPoint(root), feet.R.positionCm), direction),
      };
      const trailing: FootSide = behind.L >= behind.R ? "L" : "R";
      if (
        !pendingStart &&
        root.distanceCm - lastDistance < root.stepLengthCm &&
        behind[trailing] < 14 &&
        strain[worst] < 32
      )
        continue;
      if (behind[trailing] > 14) side = trailing;
      if (strain[worst] > 32) side = worst;
    } else {
      pendingStart = false;
      const desired = facingAt(Math.min(lastTick, tick + motionTicks(0.24)));
      const left = Math.abs(shortestAngle(feet.L.yaw, desired)),
        right = Math.abs(shortestAngle(feet.R.yaw, desired));
      if (Math.max(left, right) < 0.3) continue;
      side = left >= right ? "L" : "R";
      turning = true;
    }
    const other: FootSide = side === "L" ? "R" : "L";
    const intervalSeconds =
      root.stepLengthCm / Math.max(root.speedCmPerSecond, 1e-8);
    let duration = turning ? 0.24 : Math.min(0.36, 0.7 * intervalSeconds);
    let end = Math.min(lastTick, tick + motionTicks(duration));
    // A fixed partner must not be dragged beyond the actual leg envelope while
    // its opposite foot is in flight. Finish early before a fast corner requires
    // that partner to transfer. This preserves the world contact, never the root.
    for (
      let future = tick + motionTicks(0.025);
      future < end;
      future += motionTicks(0.015)
    ) {
      const futureRoot = sampleTrackMotion(track, future);
      rootTick = future;
      if (horizontal(futureRoot, other, feet[other].positionCm) > 33) {
        end = Math.max(tick + motionTicks(0.025), future - motionTicks(0.005));
        break;
      }
    }
    rootTick = tick;
    if (end - tick < motionTicks(0.02)) continue;
    const segmentEnd =
      track.keys.find((key) => key.tick > tick + 1e-7)?.tick ?? lastTick;
    const lookahead = turning
      ? end
      : Math.min(segmentEnd, end + motionTicks(intervalSeconds / 2));
    const goalRoot = sampleTrackMotion(track, lookahead);
    let to = footAt(goalRoot, side, facingAt(lookahead));
    const landing = sampleTrackMotion(track, end),
      landingYaw = facingAt(end) + Math.PI;
    const hipXZ = add(
      rootPoint(landing),
      rotateMotionY([side === "L" ? -8.4 : 8.4, 0, 0], landingYaw),
    );
    const delta = sub(to.positionCm, hipXZ),
      distance = Math.hypot(delta[0], delta[2]);
    // Anticipate only a reachable foothold at the landing pose. A future segment
    // beyond a corner is not a valid place to teleport the current foot to.
    if (distance > 22)
      to = {
        ...to,
        positionCm: [
          hipXZ[0] + (delta[0] * 22) / distance,
          to.positionCm[1],
          hipXZ[2] + (delta[2] * 22) / distance,
        ],
      };
    const from = feet[side],
      travel = Math.hypot(
        to.positionCm[0] - from.positionCm[0],
        to.positionCm[2] - from.positionCm[2],
      );
    steps.push({
      side,
      start: tick,
      end,
      from,
      to,
      liftCm: turning ? 1.3 : clampMotion(travel * 0.065, 1.2, 4.5),
    });
    nextSide = other;
    lastDistance = root.distanceCm;
    pendingStart = false;
  }
  return plan;
}

export const SHIPPED_LEG = {
  hipHeightCm: 73.5,
  halfWidthCm: 8.4,
  upperCm: 31.5,
  lowerCm: 31.5,
  ankleHeightCm: 10.5,
  localUnitsPerStoryCm: 0.0006,
} as const;
function solveLeg(
  hip: MotionPoint,
  ankle: MotionPoint,
  footYaw: number,
  pitch: number,
): Omit<
  LegPose,
  "ankleWorldCm" | "contactWorldCm" | "footYaw" | "planted" | "swing"
> {
  const delta = sub(ankle, hip),
    distance = norm(delta),
    d = clampMotion(distance, 1e-6, 62.99999),
    axis = unit(delta);
  const pole: MotionPoint = [0, 0, -1],
    bend = unit(sub(pole, scale(axis, dot(pole, axis))), [1, 0, 0]);
  const along = d / 2,
    height = Math.sqrt(Math.max(0, 31.5 ** 2 - along ** 2));
  const knee = add(hip, add(scale(axis, along), scale(bend, height)));
  const reached = add(hip, scale(axis, d));
  const hipRotation = fromTo([0, -31.5, 0], sub(knee, hip));
  const lowerRotation = fromTo([0, -31.5, 0], sub(reached, knee));
  const kneeRotation = multiplyMotionRotation(
    inverse(hipRotation),
    lowerRotation,
  );
  const desiredFoot = multiplyMotionRotation(
    axisAngle([0, 1, 0], footYaw),
    axisAngle([1, 0, 0], pitch),
  );
  return {
    hipPositionCm: hip,
    hipRotation,
    kneeRotation,
    ankleRotation: multiplyMotionRotation(inverse(lowerRotation), desiredFoot),
    residualCm: Math.max(0, distance - d),
  };
}

/** Stateless evaluation is identical for forward, reverse, seek and scrub. */
export function samplePlantedGait(plan: GaitPlan, tick: number): PlantedPose {
  const root = sampleTrackMotion(plan.track, tick),
    origin = rootPoint(root),
    bodyYaw = plan.facingAt(tick),
    nativeYaw = bodyYaw + Math.PI;
  const feet = {
    L: footSample(plan, "L", tick),
    R: footSample(plan, "R", tick),
  };
  const support = SIDES.filter((side) => feet[side].planted);
  const supportCentre = scale(
    support.reduce((sum, side) => add(sum, feet[side].positionCm), [
      0, 0, 0,
    ] as MotionPoint),
    1 / Math.max(1, support.length),
  );
  const localSupport = rotateMotionY(sub(supportCentre, origin), -nativeYaw);
  const sway =
    support.length === 1 ? clampMotion(localSupport[0] * 0.12, -1.2, 1.2) : 0;
  let drop = root.moving
    ? 1.2 *
      smooth((tick - root.boutStart) / motionTicks(0.15)) *
      smooth((root.boutEnd - tick) / motionTicks(0.15))
    : 0;
  const ankleLocal = {} as Record<FootSide, MotionPoint>;
  for (const side of SIDES) {
    const foot = feet[side];
    ankleLocal[side] = rotateMotionY(
      sub(add(foot.positionCm, [0, 10.5 + foot.lift, 0]), origin),
      -nativeYaw,
    );
    const hipX = (side === "L" ? -8.4 : 8.4) + sway,
      dx = ankleLocal[side][0] - hipX,
      dz = ankleLocal[side][2];
    const maxVertical = Math.sqrt(Math.max(1, 62.5 ** 2 - dx * dx - dz * dz));
    drop = Math.max(drop, 73.5 - ankleLocal[side][1] - maxVertical);
  }
  drop = clampMotion(drop, 0, 12);
  const pelvis: MotionPoint = [sway, -drop, 0],
    legs = {} as Record<FootSide, LegPose>;
  for (const side of SIDES) {
    const foot = feet[side],
      hip = add([side === "L" ? -8.4 : 8.4, 73.5, 0], pelvis);
    const solved = solveLeg(
      hip,
      ankleLocal[side],
      shortestAngle(bodyYaw, foot.yaw),
      foot.pitch,
    );
    legs[side] = {
      ...solved,
      ankleWorldCm: add(foot.positionCm, [0, 10.5 + foot.lift, 0]),
      contactWorldCm: foot.positionCm,
      footYaw: foot.yaw,
      planted: foot.planted,
      swing: foot.swing,
    };
  }
  return {
    root,
    bodyYaw,
    legs,
    pelvisOffsetCm: pelvis,
    upperBodyOffsetCm: pelvis,
    armSwing: root.armSwing,
    support,
    reachLimited: SIDES.some((side) => legs[side].residualCm > 0.01),
  };
}

export interface LegTransform<V, Q> {
  setLocalPosition(value: V): void;
  setLocalRotation(value: Q): void;
}
export interface LegNode<V, Q> {
  getTransform(): LegTransform<V, Q>;
}
export interface MountedLeg<V, Q> {
  hip: LegNode<V, Q>;
  knee: LegNode<V, Q>;
  ankle: LegNode<V, Q>;
}
export interface GaitMath<V, Q> {
  vector(x: number, y: number, z: number): V;
  quaternion(x: number, y: number, z: number, w: number): Q;
}
/** Bind once after the renderer creates FootPivot wrappers. This adapter moves
 * only physical leg joints. It never changes domain root, hands or UpperBody. */
export class LensLegAdapter<V, Q> {
  constructor(
    private nodes: Readonly<Record<FootSide, MountedLeg<V, Q>>>,
    private math: GaitMath<V, Q>,
    private localUnitsPerStoryCm = 0.0006,
  ) {}
  apply(pose: PlantedPose): void {
    for (const side of SIDES) {
      const leg = pose.legs[side],
        nodes = this.nodes[side];
      nodes.hip
        .getTransform()
        .setLocalPosition(
          this.math.vector(
            ...scale(leg.hipPositionCm, this.localUnitsPerStoryCm),
          ),
        );
      nodes.hip
        .getTransform()
        .setLocalRotation(this.math.quaternion(...leg.hipRotation));
      nodes.knee
        .getTransform()
        .setLocalRotation(this.math.quaternion(...leg.kneeRotation));
      nodes.ankle
        .getTransform()
        .setLocalRotation(this.math.quaternion(...leg.ankleRotation));
    }
  }
  restore(): void {
    for (const side of SIDES) {
      const nodes = this.nodes[side];
      nodes.hip
        .getTransform()
        .setLocalPosition(
          this.math.vector(
            (side === "L" ? -8.4 : 8.4) * this.localUnitsPerStoryCm,
            73.5 * this.localUnitsPerStoryCm,
            0,
          ),
        );
      for (const node of [nodes.hip, nodes.knee, nodes.ankle])
        node.getTransform().setLocalRotation(this.math.quaternion(0, 0, 0, 1));
    }
  }
}
