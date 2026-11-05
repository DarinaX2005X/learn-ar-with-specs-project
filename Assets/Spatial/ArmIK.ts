import { ActorPose } from "../Scripts/TableKit/TableKit";
export type Point = readonly [number, number, number];
/** x,y,z,w, matching glTF. Lens quat constructor is supplied at the boundary. */
export type Rotation = readonly [number, number, number, number];
const add = (a: Point, b: Point): Point => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const sub = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const mul = (a: Point, s: number): Point => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Point) => Math.sqrt(dot(a, a));
const unit = (a: Point, fallback: Point = [0, -1, 0]): Point =>
  length(a) > 1e-9 ? mul(a, 1 / length(a)) : fallback;
export const inverseRotation = (q: Rotation): Rotation => [
  -q[0],
  -q[1],
  -q[2],
  q[3],
];
export function multiplyRotation(a: Rotation, b: Rotation): Rotation {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function rotatePoint(q: Rotation, p: Point): Point {
  const v: Point = [q[0], q[1], q[2]],
    t = mul(cross(v, p), 2);
  return add(p, add(mul(t, q[3]), cross(v, t)));
}
function fromTo(a: Point, b: Point): Rotation {
  const u = unit(a),
    v = unit(b),
    d = dot(u, v);
  if (d < -0.999999) {
    const axis = unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
    return [...axis, 0];
  }
  const c = cross(u, v),
    q: Rotation = [...c, 1 + d],
    n = Math.hypot(...q);
  return q.map((x) => x / n) as unknown as Rotation;
}
/** Extracted from all three shipped GLBs. Imported scale100 produces tabletop cm.
 * No authored local node rotations/scales are present. Actual arm axes lean out
 * in X at the elbow, rather than using a generic vertical bone approximation.
 */
export const SHIPPED_RIGHT_ARM = {
  shoulder: [1.225, 6.965, 0] as Point,
  upper: [0.231, -1.61, 0] as Point,
  lower: [0, -1.344, 0] as Point,
  // Palm top surface centre from Palm_R POSITION bounds (GLB metres *100).
  contact: [0, -0.217, -0.182] as Point,
  palmRotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as Rotation,
};
export interface ArmSolution {
  shoulderRotation: Rotation;
  elbowRotation: Rotation;
  wristRotation: Rotation;
  upperBodyOffset: Point;
  contact: Point;
  target: Point;
  residualCm: number;
  reachLimited: boolean;
}
/** Solve a right arm in imported-model local cm. Body shift is continuous and
 * bounded to .72 tabletop cm (12 story cm). It moves an upper-body wrapper,
 * not a bone length, actor floor point or ruby. Elbow chooses an outward/back
 * pole and is independent of accumulated animation state.
 */
export function solveRightArm(target: Point, maxBodyShift = 0.72): ArmSolution {
  if (
    !target.every(Number.isFinite) ||
    !Number.isFinite(maxBodyShift) ||
    maxBodyShift < 0
  )
    throw new Error("Use a finite arm target");
  const r = SHIPPED_RIGHT_ARM,
    L1 = length(r.upper),
    L2 = length(r.lower),
    maxReach = L1 + L2 - 1e-5;
  const wristTarget = sub(target, rotatePoint(r.palmRotation, r.contact));
  const delta = sub(wristTarget, r.shoulder),
    d = length(delta),
    direction = unit(delta);
  const excess = Math.max(0, d - maxReach);
  // Smooth bounded body lean: no movement inside normal arm reach, full contact
  // through the supported lean range, honest residual beyond that range.
  const shift = mul(direction, Math.min(maxBodyShift, excess));
  const shoulder = add(r.shoulder, shift),
    ray = sub(wristTarget, shoulder);
  const distance = Math.max(
    Math.abs(L1 - L2) + 1e-5,
    Math.min(maxReach, length(ray)),
  );
  const axis = unit(ray),
    along = (L1 * L1 - L2 * L2 + distance * distance) / (2 * distance);
  const pole: Point = [1, -0.2, 0.5];
  const perpendicular = unit(sub(pole, mul(axis, dot(pole, axis))), [0, 0, 1]);
  const elbow = add(
    shoulder,
    add(
      mul(axis, along),
      mul(perpendicular, Math.sqrt(Math.max(0, L1 * L1 - along * along))),
    ),
  );
  const wrist = add(shoulder, mul(axis, distance));
  const shoulderRotation = fromTo(r.upper, sub(elbow, shoulder));
  const worldLower = fromTo(r.lower, sub(wrist, elbow));
  const elbowRotation = multiplyRotation(
    inverseRotation(shoulderRotation),
    worldLower,
  );
  const wristRotation = multiplyRotation(
    inverseRotation(worldLower),
    r.palmRotation,
  );
  const actual = forwardArm(
    shoulderRotation,
    elbowRotation,
    wristRotation,
    shift,
  );
  const residualCm = length(sub(actual, target));
  return {
    shoulderRotation,
    elbowRotation,
    wristRotation,
    upperBodyOffset: shift,
    contact: actual,
    target,
    residualCm,
    reachLimited: residualCm > 0.001,
  };
}
/** Forward kinematics is also the residual oracle in tests and diagnostics. */
export function forwardArm(
  shoulder: Rotation,
  elbow: Rotation,
  wrist: Rotation,
  body: Point,
): Point {
  const r = SHIPPED_RIGHT_ARM,
    q = multiplyRotation(shoulder, elbow);
  return add(
    add(
      add(add(r.shoulder, body), rotatePoint(shoulder, r.upper)),
      rotatePoint(q, r.lower),
    ),
    rotatePoint(multiplyRotation(q, wrist), r.contact),
  );
}
export interface ArmTransform<V, Q> {
  setLocalPosition(value: V): void;
  setLocalRotation(value: Q): void;
}
export interface ArmNode<V, Q> {
  getTransform(): ArmTransform<V, Q>;
}
export interface ArmMath<V, Q> {
  vector(x: number, y: number, z: number): V;
  quaternion(x: number, y: number, z: number, w: number): Q;
}
export interface MountedArm<V, Q> {
  /** Wrapper containing torso, head and both arms; legs stay on the floor. */
  upperBody: ArmNode<V, Q>;
  shoulder: ArmNode<V, Q>;
  elbow: ArmNode<V, Q>;
  wrist: ArmNode<V, Q>;
}
/** Construct once with imported Shoulder_R -> Forearm_R -> Hand_R nodes.
 * Native transforms are cached, reused and receive glTF local quaternions.
 * Convert Lens quat with (x,y,z,w)=>new quat(w,x,y,z).
 */
export class LensArmAdapter<V, Q> {
  private upper: ArmTransform<V, Q>;
  private shoulder: ArmTransform<V, Q>;
  private elbow: ArmTransform<V, Q>;
  private wrist: ArmTransform<V, Q>;
  constructor(
    nodes: MountedArm<V, Q>,
    private math: ArmMath<V, Q>,
    private localUnitsPerTableCm = 0.01,
  ) {
    this.upper = nodes.upperBody.getTransform();
    this.shoulder = nodes.shoulder.getTransform();
    this.elbow = nodes.elbow.getTransform();
    this.wrist = nodes.wrist.getTransform();
  }
  /** Actor yaw is the actual native root yaw, including any mesh facing correction.
   * actor position and target are absolute story cm within the wing. */
  apply(
    actor: Pick<ActorPose, "positionCm" | "yawRad">,
    targetStoryCm: Point,
  ): ArmSolution {
    const d = sub(targetStoryCm, actor.positionCm),
      c = Math.cos(actor.yawRad),
      s = Math.sin(actor.yawRad),
      factor = 6 / 100;
    const target: Point = [
      (c * d[0] - s * d[2]) * factor,
      d[1] * factor,
      (s * d[0] + c * d[2]) * factor,
    ];
    const solved = solveRightArm(target);
    this.upper.setLocalPosition(
      this.math.vector(
        ...mul(solved.upperBodyOffset, this.localUnitsPerTableCm),
      ),
    );
    this.shoulder.setLocalRotation(
      this.math.quaternion(...solved.shoulderRotation),
    );
    this.elbow.setLocalRotation(this.math.quaternion(...solved.elbowRotation));
    this.wrist.setLocalRotation(this.math.quaternion(...solved.wristRotation));
    return solved;
  }
}
