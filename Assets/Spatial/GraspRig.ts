/** F003 physical distal rig. Units are imported-model tabletop cm, never story cm.
 * Ruby remains upright at the supplied BOTTOM pivot. All contacts use its actual
 * cut planes; the solver reports unreachable pads instead of lengthening bones. */
import {
  Point,
  Rotation,
  rotatePoint,
  inverseRotation,
  multiplyRotation,
} from "./ArmIK";
export interface Articulation {
  reach: number;
  curl: number;
  carry: number;
  touch?: number;
}
export type Digit = "Index" | "Middle" | "Ring" | "Little" | "Thumb";
export const DIGITS: readonly Digit[] = [
  "Index",
  "Middle",
  "Ring",
  "Little",
  "Thumb",
];
const A = (a: Point, b: Point): Point => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const S = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const M = (a: Point, k: number): Point => [a[0] * k, a[1] * k, a[2] * k];
const D = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const C = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const L = (p: Point) => Math.hypot(...p);
const U = (p: Point, f: Point = [0, 0, -1]): Point =>
  L(p) > 1e-9 ? M(p, 1 / L(p)) : f;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};
export const HAND_GEOMETRY = {
  palmHalfWidth: 0.238,
  palmHalfThickness: 0.105,
  palmRootToKnuckle: 0.441,
  wristBack: 0.3,
  clearance: 0.04,
  digits: {
    Index: {
      base: [-0.1575, -0.441, -0.014] as Point,
      lengths: [0.2, 0.15, 0.11] as Point,
      radius: 0.043,
      start: 0,
    },
    Middle: {
      base: [-0.0525, -0.441, -0.014] as Point,
      lengths: [0.215, 0.16, 0.115] as Point,
      radius: 0.044,
      start: 0.045,
    },
    Ring: {
      base: [0.0525, -0.441, -0.014] as Point,
      lengths: [0.2, 0.15, 0.105] as Point,
      radius: 0.042,
      start: 0.1,
    },
    Little: {
      base: [0.1575, -0.42, -0.014] as Point,
      lengths: [0.18, 0.135, 0.1] as Point,
      radius: 0.039,
      start: 0.17,
    },
    Thumb: {
      base: [0.22, -0.15, -0.014] as Point,
      lengths: [0.23, 0.175, 0.12] as Point,
      radius: 0.055,
      start: 0.065,
    },
  },
};
export function axisAngle(axis: Point, angle: number): Rotation {
  const u = U(axis);
  return [...M(u, Math.sin(angle / 2)), Math.cos(angle / 2)];
}
export function fromToHand(a: Point, b: Point): Rotation {
  const u = U(a),
    v = U(b),
    d = D(u, v);
  if (d < -0.999999)
    return axisAngle(
      U(C(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0])),
      Math.PI,
    );
  const c = C(u, v),
    q = [...c, 1 + d];
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as unknown as Rotation;
}
export function slerp(a: Rotation, b: Rotation, t: number): Rotation {
  let d = a.reduce((s, v, i) => s + v * b[i], 0),
    q = b;
  if (d < 0) {
    q = b.map((v) => -v) as unknown as Rotation;
    d = -d;
  }
  if (d > 0.9995) {
    const c = a.map((v, i) => v + (q[i] - v) * t),
      n = Math.hypot(...c);
    return c.map((v) => v / n) as unknown as Rotation;
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, d))),
    sn = Math.sin(theta);
  return a.map(
    (v, i) => (v * Math.sin((1 - t) * theta) + q[i] * Math.sin(t * theta)) / sn,
  ) as unknown as Rotation;
}
/** Rotation from an orthonormal basis; columns are actual local hand axes. */
export function basisRotation(x: Point, y: Point, z: Point): Rotation {
  const m = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]],
    tr = m[0] + m[4] + m[8];
  let q: number[];
  if (tr > 0) {
    const s = 2 * Math.sqrt(1 + tr);
    q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4];
  } else {
    const i = m[0] > m[4] ? (m[0] > m[8] ? 0 : 2) : m[4] > m[8] ? 1 : 2,
      j = (i + 1) % 3,
      k = (i + 2) % 3,
      s = 2 * Math.sqrt(1 + m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k]);
    q = [0, 0, 0, 0];
    q[i] = s / 4;
    q[j] = (m[j * 3 + i] + m[i * 3 + j]) / s;
    q[k] = (m[k * 3 + i] + m[i * 3 + k]) / s;
    q[3] = (m[k * 3 + j] - m[j * 3 + k]) / s;
  }
  return q as unknown as Rotation;
}
/** Exact RubyGem ring topology (table cm), including the actual light top .381. */
export function rubyVertices(): Point[] {
  const out: Point[] = [];
  for (const [y, rx, rz] of [
    [0, 0.04, 0.035],
    [0.13, 0.33 / Math.cos(Math.PI / 8), 0.27 / Math.cos(Math.PI / 8)],
    [
      0.26,
      (0.33 * 0.91) / Math.cos(Math.PI / 8),
      (0.27 * 0.91) / Math.cos(Math.PI / 8),
    ],
    [0.38, 0.18, 0.15],
  ])
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      out.push([rx * Math.cos(a), y, rz * Math.sin(a)]);
    }
  out.push([0, 0.381, 0]);
  return out;
}
let triangleCache: readonly (readonly [Point, Point, Point])[] | undefined;
export function rubyTriangles(): readonly (readonly [Point, Point, Point])[] {
  if (triangleCache) return triangleCache;
  const vs = rubyVertices(),
    out: [Point, Point, Point][] = [];
  for (let k = 0; k < 3; k++)
    for (let j = 0; j < 8; j++) {
      const a = k * 8 + j,
        b = k * 8 + ((j + 1) % 8),
        c = (k + 1) * 8 + j,
        d = (k + 1) * 8 + ((j + 1) % 8);
      out.push([vs[a], vs[c], vs[b]], [vs[b], vs[c], vs[d]]);
    }
  triangleCache = out;
  return out;
}
const contactHeights = [0.065, 0.13, 0.21, 0.29, 0.345];
type SliceEdge = { a: Point; b: Point; normal: Point };
const fixedSlices = new Map<number, SliceEdge[]>();
export function rubySlice(y: number): SliceEdge[] {
  const cached = fixedSlices.get(y);
  if (cached) return cached;
  const out: { a: Point; b: Point; normal: Point }[] = [];
  for (const triangle of rubyTriangles()) {
    const points: Point[] = [];
    for (let i = 0; i < 3; i++) {
      const a = triangle[i],
        b = triangle[(i + 1) % 3];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
        points.push(A(a, M(S(b, a), (y - a[1]) / (b[1] - a[1]))));
    }
    if (points.length === 2) {
      let normal = U(
        C(S(triangle[1], triangle[0]), S(triangle[2], triangle[0])),
      );
      if (D(normal, S(points[0], [0, 0.19, 0])) < 0) normal = M(normal, -1);
      out.push({ a: points[0], b: points[1], normal });
    }
  }
  if (contactHeights.includes(y)) fixedSlices.set(y, out);
  return out;
}
export interface PadContact {
  point: Point;
  normal: Point;
}
/** Ray from the interior at a requested lateral offset to a real girdle facet. */
export function girdleContact(
  lateral: Point,
  direction: Point,
  y: number,
): PadContact {
  let distance = Infinity,
    result: PadContact | undefined;
  for (const edge of rubySlice(y)) {
    const denom = D(edge.normal, direction);
    if (denom <= 1e-9) continue;
    const t =
      (D(edge.normal, edge.a) - D(edge.normal, [lateral[0], y, lateral[2]])) /
      denom;
    const point = A([lateral[0], y, lateral[2]], M(direction, t));
    const v = S(edge.b, edge.a),
      along = D(S(point, edge.a), v) / D(v, v);
    if (t >= 0 && along >= -1e-6 && along <= 1 + 1e-6 && t < distance) {
      distance = t;
      result = { point, normal: edge.normal };
    }
  }
  if (!result) throw new Error("Lateral pad ray misses RubyGem");
  return result;
}
export interface FingerPose {
  digit: Digit;
  rotations: readonly [Rotation, Rotation, Rotation];
  points: readonly Point[];
  target: Point;
  normal: Point;
  residualCm: number;
  closure: number;
}
export interface GraspPlan {
  wrist: Point;
  rotation: Rotation;
  fingers: readonly FingerPose[];
  maxResidualCm: number;
  articulation: Articulation;
}
function fk(base: Point, lengths: Point, qs: readonly Rotation[]): Point[] {
  const points: Point[] = [base];
  let q: Rotation = [0, 0, 0, 1];
  for (let i = 0; i < 3; i++) {
    q = multiplyRotation(q, qs[i]);
    points.push(A(points[i], rotatePoint(q, [0, -lengths[i], 0])));
  }
  return points;
}
function distalDirection(
  base: Point,
  target: Point,
  normal: Point,
  length: number,
  minFirst: number,
): Point {
  const toward = S(base, target),
    initial = U(S(toward, M(normal, Math.min(0, D(toward, normal)))));
  if (L(S(A(target, M(initial, length)), base)) >= minFirst + 1e-6)
    return initial;
  const side = U(
    S(normal, M(initial, D(normal, initial))),
    U(C(initial, [1, 0, 0]), [0, 0, 1]),
  );
  const at = (angle: number) =>
    A(M(initial, Math.cos(angle)), M(side, Math.sin(angle)));
  let lo = 0,
    hi = Math.PI / 2;
  for (let n = 0; n < 20; n++) {
    const mid = (lo + hi) / 2;
    if (L(S(A(target, M(at(mid), length)), base)) < minFirst + 1e-5) lo = mid;
    else hi = mid;
  }
  return at(hi);
}
function safeChain(
  base: Point,
  target: Point,
  normal: Point,
  lengths: Point,
  radius: number,
) {
  const [l1, l2, l3] = lengths,
    toward = S(base, target),
    tangent = U(
      S(toward, M(normal, D(toward, normal))),
      U(C(normal, [1, 0, 0]), [0, 1, 0]),
    );
  const preferred = distalDirection(
      base,
      target,
      normal,
      l3,
      Math.abs(l1 - l2),
    ),
    initial = Math.atan2(D(preferred, tangent), D(preferred, normal));
  let best:
    | { elbow: Point; joint: Point; terminal: Point; score: number }
    | undefined;
  for (let i = -24; i <= 24; i++) {
    const angle = (i * Math.PI) / 48,
      terminal = A(M(normal, Math.cos(angle)), M(tangent, Math.sin(angle))),
      distal = A(target, M(terminal, l3)),
      ray = S(distal, base),
      raw = L(ray),
      axis = U(ray),
      d = Math.max(Math.abs(l1 - l2) + 1e-6, Math.min(l1 + l2 - 1e-6, raw)),
      along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
      height = Math.sqrt(Math.max(0, l1 * l1 - along * along)),
      outward = U(S(normal, M(axis, D(normal, axis))), [0, 0, 1]),
      elbow = A(base, A(M(axis, along), M(outward, height))),
      joint = A(base, M(axis, d)),
      tip = S(joint, M(terminal, l3)),
      plane = D(normal, target) - radius;
    const clearance =
      Math.min(...[base, elbow, joint, tip].map((p) => D(normal, p) - plane)) -
      radius;
    const bend = Math.acos(
      Math.max(-1, Math.min(1, (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2))),
    );
    const score =
      Math.min(0, clearance) * 1e6 -
      Math.abs(raw - d) * 1e7 -
      Math.pow(bend / Math.PI, 4) * 0.01 -
      (angle - initial) * (angle - initial) * 0.001;
    if (!best || score > best.score) best = { elbow, joint, terminal, score };
  }
  return best!;
}
export interface CutPlane {
  normal: Point;
  distance: number;
}
function fingerIK(
  digit: Digit,
  target: Point,
  normal: Point,
  closure: number,
  planes: readonly CutPlane[],
  relaxedWeight = 1,
): FingerPose {
  const g = HAND_GEOMETRY.digits[digit],
    base = g.base,
    [l1, l2, l3] = g.lengths;
  // Terminal phalanx follows the facet tangent, never pointing through its plane.
  const chain = safeChain(base, target, normal, g.lengths, g.radius),
    { elbow, joint, terminal } = chain;
  const q1 = fromToHand([0, -1, 0], S(elbow, base)),
    q2world = fromToHand([0, -1, 0], S(joint, elbow)),
    q2 = multiplyRotation(inverseRotation(q1), q2world),
    q3 = multiplyRotation(
      inverseRotation(q2world),
      fromToHand([0, -1, 0], M(terminal, -1)),
    );
  const relax = [
    axisAngle([1, 0, 0], 0.12 * relaxedWeight),
    axisAngle([1, 0, 0], 0.2 * relaxedWeight),
    axisAngle([1, 0, 0], 0.13 * relaxedWeight),
  ] as const;
  const interpolated = [
    slerp(relax[0], q1, closure),
    slerp(relax[1], q2, closure),
    slerp(relax[2], q3, closure),
  ] as const;
  const interim = fk(base, g.lengths, interpolated),
    v = S(interim[3], base),
    abductionAxis = U(C(v, normal), [1, 0, 0]);
  const at = (angle: number) =>
    [
      multiplyRotation(axisAngle(abductionAxis, angle), interpolated[0]),
      interpolated[1],
      interpolated[2],
    ] as const;
  const plane = D(normal, target) - g.radius;
  const margin = (angle: number) =>
    Math.min(
      ...fk(base, g.lengths, at(angle)).map(
        (p) => D(normal, p) - plane - g.radius,
      ),
    );
  let angle = 0;
  // Collision-driven MCP abduction, bounded to the actual 20-degree spread.
  // Pivots and phalanx lengths stay fixed; no gem or tip-position override.
  if (margin(0) < -1e-8) {
    let safe = 0;
    for (let i = 1; i <= 20; i++) {
      const a = (i * Math.PI) / 180;
      if (margin(a) >= -1e-8) {
        safe = a;
        break;
      }
    }
    if (safe) {
      let lo = 0,
        hi = safe;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (margin(mid) < -1e-8) lo = mid;
        else hi = mid;
      }
      angle = hi;
    }
  }
  const qs = at(angle),
    points = fk(base, g.lengths, qs);
  return {
    digit,
    rotations: qs,
    points,
    target,
    normal,
    residualCm: L(S(points[3], target)),
    closure,
  };
}
/** target and fixed-ruby axes in actor model local table centimetres. */
export function planGrasp(
  target: Point,
  rubyX: Point,
  rubyZ: Point,
  art: Articulation,
): GraspPlan {
  for (const n of [
    ...target,
    ...rubyX,
    ...rubyZ,
    art.reach,
    art.curl,
    art.carry,
    art.touch ?? 0,
  ])
    if (!Number.isFinite(n)) throw new Error("Finite grasp inputs required");
  const a = {
    reach: clamp(art.reach),
    curl: clamp(art.curl),
    carry: clamp(art.carry),
    touch: clamp(art.touch ?? 0),
  };
  if (a.reach + a.curl + a.carry === 0) {
    const fingers = DIGITS.map((digit) => {
      const g = HAND_GEOMETRY.digits[digit],
        qs = [
          axisAngle([1, 0, 0], 0.12),
          axisAngle([1, 0, 0], 0.2),
          axisAngle([1, 0, 0], 0.13),
        ] as const,
        points = fk(g.base, g.lengths, qs);
      return {
        digit,
        rotations: qs,
        points,
        target: points[3],
        normal: [0, 0, -1] as Point,
        residualCm: 0,
        closure: 0,
      };
    });
    return {
      wrist: A(target, [0, 0.217, 0.119]),
      rotation: [0, 0, 0, 1],
      fingers,
      maxResidualCm: 0,
      articulation: a,
    };
  }
  const forward = U([target[0], 0, target[2]]),
    up: Point = [0, 1, 0],
    x = U(C(M(forward, -1), up)),
    y = M(forward, -1),
    initial = basisRotation(x, y, up),
    roll = axisAngle([0, 1, 0], Math.PI * a.carry),
    graspRotation = multiplyRotation(initial, roll),
    touchRotation = basisRotation(x, [0, -1, 0], M(forward, -1)),
    grip = slerp(graspRotation, touchRotation, a.touch),
    rotation = slerp(
      [0, 0, 0, 1],
      grip,
      Math.max(a.curl, Math.min(1, a.reach + a.carry)),
    ),
    zAxis = rotatePoint(grip, [0, 0, 1]),
    centre: Point = [0, 0.19, 0];
  const localRuby = (v: Point): Point =>
      A(M(rubyX, v[0]), A([0, v[1], 0], M(rubyZ, v[2]))),
    vertices = rubyVertices().map(localRuby),
    support = Math.max(...vertices.map((v) => D(S(v, centre), zAxis))),
    gripWrist = A(
      target,
      A(
        centre,
        A(
          M(
            zAxis,
            support + HAND_GEOMETRY.palmHalfThickness + HAND_GEOMETRY.clearance,
          ),
          M(forward, -HAND_GEOMETRY.wristBack),
        ),
      ),
    ),
    restWrist = A(target, [0, 0.217, 0.119]),
    baseWrist = A(
      restWrist,
      M(
        S(gripWrist, restWrist),
        Math.max(a.curl, Math.min(1, a.reach + a.carry)),
      ),
    ),
    inv = inverseRotation(grip),
    xAxis = rotatePoint(grip, [1, 0, 0]);
  const surfaceWrist = S(target, rotatePoint(rotation, [0, -0.217, -0.119]));
  const wrist = A(baseWrist, M(S(surfaceWrist, baseWrist), a.touch));
  if (a.touch > 0 && a.curl === 0) {
    const fingers = DIGITS.map((digit) => {
      const g = HAND_GEOMETRY.digits[digit],
        qs = [
          axisAngle([1, 0, 0], 0.12 * (1 - a.touch)),
          axisAngle([1, 0, 0], 0.2 * (1 - a.touch)),
          axisAngle([1, 0, 0], 0.13 * (1 - a.touch)),
        ] as const,
        points = fk(g.base, g.lengths, qs);
      return {
        digit,
        rotations: qs,
        points,
        target: points[3],
        normal: [0, 0, -1] as Point,
        residualCm: 0,
        closure: 0,
      };
    });
    return { wrist, rotation, fingers, maxResidualCm: 0, articulation: a };
  }
  const planes: CutPlane[] = [];
  const fingers = DIGITS.map((digit) => {
    const g = HAND_GEOMETRY.digits[digit],
      side = digit === "Thumb" ? -1 : 1;
    const baseWorld = A(wrist, rotatePoint(grip, g.base));
    const fingerY = Math.max(
      0.035,
      Math.min(
        0.345,
        0.19 + 0.1 * Math.cos(Math.PI * a.carry) + xAxis[1] * g.base[0],
      ),
    );
    const project = (v: Point): Point => [D(v, rubyX), v[1], D(v, rubyZ)];
    const forwardRuby = project(forward);
    const lateral = project([
      xAxis[0] * g.base[0] * (digit === "Thumb" ? -0.65 : 1),
      0,
      xAxis[2] * g.base[0] * (digit === "Thumb" ? -0.65 : 1),
    ]);
    let preferred: PadContact;
    try {
      preferred = girdleContact(lateral, M(forwardRuby, side), fingerY);
    } catch {
      preferred = girdleContact([0, 0, 0], M(forwardRuby, side), fingerY);
    }
    const preferredWorld = A(target, localRuby(preferred.point));
    let best: { point: Point; normal: Point; cost: number } | undefined;
    // Exact cut triangles are sliced, then a bounded convex 1D search picks a
    // reachable point while retaining the intended opposing side of the stone.
    for (const candidateY of [fingerY, ...contactHeights])
      for (const edge of rubySlice(candidateY)) {
        const normal = localRuby(edge.normal);
        if (side * D(normal, forward) < -0.02) continue;
        const start = A(target, localRuby(edge.a));
        const direction = localRuby(S(edge.b, edge.a));
        const fromPreferred = S(start, preferredWorld);
        const fromBase = S(start, baseWorld);
        const length2 = D(direction, direction);
        const nearest =
          length2 === 0 ? 0 : clamp(-D(direction, fromPreferred) / length2);
        const offset = A(fromPreferred, M(direction, nearest));
        // Every point on this facet has the same signed pad clearance. Its
        // nearest point bounds the distance penalty before checking arm reach.
        const visibility = Math.max(0, g.radius + D(normal, fromBase));
        const visibilityPenalty = visibility * visibility * 1e5;
        if (best && D(offset, offset) + visibilityPenalty > best.cost + 1e-10)
          continue;
        const pointAt = (t: number) =>
          A(target, localRuby(A(edge.a, M(S(edge.b, edge.a), t))));
        const cost = (t: number) => {
          const contact = pointAt(t),
            pad = A(contact, M(normal, g.radius)),
            terminal = distalDirection(
              baseWorld,
              pad,
              normal,
              g.lengths[2],
              Math.abs(g.lengths[0] - g.lengths[1]),
            ),
            joint = A(pad, M(terminal, g.lengths[2])),
            reach = Math.max(
              0,
              L(S(joint, baseWorld)) - g.lengths[0] - g.lengths[1] + 1e-5,
            ),
            padVisibility = Math.max(
              0,
              g.radius - D(normal, S(baseWorld, contact)),
            );
          const difference = S(contact, preferredWorld);
          return (
            (reach * reach + padVisibility * padVisibility) * 1e5 +
            D(difference, difference)
          );
        };
        let lo = 0,
          hi = 1;
        for (let k = 0; k < 12; k++) {
          const a = lo + (hi - lo) / 3,
            b = hi - (hi - lo) / 3;
          if (cost(a) < cost(b)) hi = b;
          else lo = a;
        }
        const t = (lo + hi) / 2,
          costValue = cost(t);
        if (!best || costValue < best.cost)
          best = { point: pointAt(t), normal, cost: costValue };
      }
    if (!best) throw new Error("No physical RubyGem contact face");
    const pad = A(best.point, M(best.normal, g.radius)),
      local = rotatePoint(inv, S(pad, wrist)),
      localNormal = rotatePoint(inv, best.normal),
      closure = smooth((a.curl - g.start) / (1 - g.start));
    return fingerIK(
      digit,
      local,
      localNormal,
      closure,
      planes,
      1 - Math.min(1, a.reach + a.carry),
    );
  });
  return {
    wrist,
    rotation,
    fingers,
    maxResidualCm: Math.max(...fingers.map((f) => f.residualCm)),
    articulation: a,
  };
}
export const handRigMath = {
  add: A,
  sub: S,
  mul: M,
  dot: D,
  cross: C,
  length: L,
  unit: U,
};
