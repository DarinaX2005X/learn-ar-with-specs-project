import { Board, Fragment, Vec3, Witness } from "./types";
import { add, dot, EPSILON, mul, project, sub } from "./geometry";

export type SurfacePoint = readonly [number, number];
export interface AngularPoint {
  horizontal: number;
  vertical: number;
}
export type ProjectedTriangle = readonly [
  AngularPoint,
  AngularPoint,
  AngularPoint,
];
type Polygon = Vec3[];
type PlaneFunction = (point: Vec3) => number;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Clip a convex polygon against a linear half-space. Positive side survives. */
function clip(polygon: Polygon, plane: PlaneFunction): Polygon {
  const result: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const da = plane(a),
      db = plane(b),
      insideA = da >= 0,
      insideB = db >= 0;
    if (insideA) result.push(a);
    if (insideA !== insideB)
      result.push(add(a, mul(sub(b, a), da / (da - db))));
  }
  return result;
}

function signedArea(points: readonly SurfacePoint[]): number {
  return (
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2
  );
}
const cross2 = (a: SurfacePoint, b: SurfacePoint, c: SurfacePoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Ear clipping preserves concave headwear profiles rather than filling their hull. */
function triangulate(outline: readonly SurfacePoint[]): SurfacePoint[][] {
  if (
    outline.length < 3 ||
    outline.some((p) => p.length !== 2 || !p.every(Number.isFinite))
  )
    return [];
  const points = outline.filter(
    (point, i) =>
      i === 0 ||
      Math.hypot(point[0] - outline[i - 1][0], point[1] - outline[i - 1][1]) >
        1e-6,
  );
  if (
    points.length > 3 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
  )
    points.pop();
  if (signedArea(points) < 0) points.reverse();
  const triangles: SurfacePoint[][] = [];
  let remaining = points.map((_, i) => i),
    budget = points.length * points.length;
  while (remaining.length > 3 && budget-- > 0) {
    let removed = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length],
        b = remaining[i],
        c = remaining[(i + 1) % remaining.length];
      if (cross2(points[a], points[b], points[c]) <= 1e-12) continue;
      const occupied = remaining.some(
        (j) =>
          j !== a &&
          j !== b &&
          j !== c &&
          cross2(points[a], points[b], points[j]) >= -1e-12 &&
          cross2(points[b], points[c], points[j]) >= -1e-12 &&
          cross2(points[c], points[a], points[j]) >= -1e-12,
      );
      if (occupied) continue;
      triangles.push([points[a], points[b], points[c]]);
      remaining.splice(i, 1);
      removed = true;
      break;
    }
    if (!removed) return []; // Invalid/self-intersecting input is never filled speculatively.
  }
  if (remaining.length === 3) triangles.push(remaining.map((i) => points[i]));
  return triangles;
}

function reflect(point: Vec3, origin: Vec3, normal: Vec3): Vec3 {
  return sub(point, mul(normal, 2 * dot(sub(point, origin), normal)));
}

/** Subtract one convex opaque shadow, retaining separate visible polygons. */
function subtractShadow(
  subject: Polygon,
  shadow: Polygon,
  origin: Vec3,
  right: Vec3,
  up: Vec3,
): Polygon[] {
  const uv = (p: Vec3): SurfacePoint => [
    dot(sub(p, origin), right),
    dot(sub(p, origin), up),
  ];
  const corners = shadow.map(uv);
  if (corners.length < 3 || Math.abs(signedArea(corners)) < EPSILON)
    return [subject];
  if (signedArea(corners) < 0) shadow = [...shadow].reverse();
  const result: Polygon[] = [];
  let remainder = subject;
  for (let i = 0; i < shadow.length && remainder.length >= 3; i++) {
    const a = uv(shadow[i]),
      b = uv(shadow[(i + 1) % shadow.length]);
    const half = (p: Vec3) => cross2(a, b, uv(p));
    // Opaque boundaries expand by a shared tiny tolerance, never reveal a seam.
    const outside = clip(remainder, (p) => -half(p) - EPSILON);
    if (outside.length >= 3) result.push(outside);
    remainder = clip(remainder, (p) => half(p) + EPSILON);
  }
  return result;
}

/** Public-only recorded geometry. Input is an observed fragment and a public
 * head/badge outline; output is clipped angular triangles, never a live actor.
 * Mirror paths unfold the eye and reflect observer-leg walls. Wall shadows are
 * projected onto the sample plane, clipped and subtracted exactly as polygons.
 * This work happens on the requested frame, outside proof enumeration. */
export function projectVisibleSurface(
  board: Board,
  witnessId: string,
  fragment: Fragment,
  outline: readonly SurfacePoint[],
): ProjectedTriangle[] {
  const witness = board.witnesses.find((w) => w.id === witnessId);
  if (!witness) return [];
  const origin = fragment.position,
    right = fragment.surfaceRight,
    up = { x: 0, y: 1, z: 0 };
  if (
    !right ||
    Math.abs(dot(right, right) - 1) > EPSILON ||
    Math.abs(right.y) > EPSILON
  )
    return [];
  const normal = cross3(right, up);
  const mirror = fragment.via === "mirror" ? board.room.mirror : undefined;
  if (
    fragment.via === "mirror" &&
    (!mirror ||
      mirror.aperture <= EPSILON ||
      dot(sub(witness.position, mirror.origin), mirror.normal) <= EPSILON)
  )
    return [];
  const eye = mirror
    ? reflect(witness.position, mirror.origin, mirror.normal)
    : witness.position;
  const eyeDepth = dot(sub(eye, origin), normal);
  if (Math.abs(eyeDepth) < EPSILON) return [];
  const point = (uv: SurfacePoint) =>
    add(origin, add(mul(right, uv[0]), mul(up, uv[1])));
  const viewed = (p: Vec3) =>
    mirror ? reflect(p, mirror.origin, mirror.normal) : p;
  const frame = (p: Vec3) => {
    const d = sub(viewed(p), witness.position);
    return {
      depth: d.x * Math.sin(witness.yaw) + d.z * Math.cos(witness.yaw),
      side: d.x * Math.cos(witness.yaw) - d.z * Math.sin(witness.yaw),
      height: d.y,
    };
  };
  const constraints: PlaneFunction[] = [
    (p) => frame(p).depth - (witness.near ?? 0) - EPSILON,
  ];
  if (witness.fov < Math.PI - EPSILON) {
    const tangent = Math.tan(witness.fov / 2);
    constraints.push(
      (p) => frame(p).depth * tangent - frame(p).side - EPSILON,
      (p) => frame(p).depth * tangent + frame(p).side - EPSILON,
    );
  }
  const verticalTangent = Math.tan((witness.verticalFov ?? Math.PI * 0.9) / 2);
  constraints.push(
    (p) => frame(p).depth * verticalTangent - frame(p).height - EPSILON,
    (p) => frame(p).depth * verticalTangent + frame(p).height - EPSILON,
  );
  if (mirror) {
    const de = dot(sub(eye, mirror.origin), mirror.normal);
    const numerator = (p: Vec3, axis: Vec3) =>
      dot(sub(p, mirror.origin), mirror.normal) *
        dot(sub(eye, mirror.origin), axis) -
      de * dot(sub(p, mirror.origin), axis);
    const denominator = (p: Vec3) =>
      dot(sub(p, mirror.origin), mirror.normal) - de;
    const left = -mirror.width / 2 + EPSILON,
      edge = -mirror.width / 2 + mirror.width * mirror.aperture - EPSILON,
      halfHeight = mirror.height / 2 - EPSILON;
    constraints.push(
      (p) => dot(sub(p, mirror.origin), mirror.normal) - EPSILON,
      (p) => numerator(p, mirror.right) - left * denominator(p),
      (p) => edge * denominator(p) - numerator(p, mirror.right),
      (p) => halfHeight * denominator(p) - numerator(p, mirror.up),
      (p) => halfHeight * denominator(p) + numerator(p, mirror.up),
    );
  }
  const shadows: Polygon[] = [];
  for (const wall of board.room.walls) {
    let wallFace: Polygon = [
      { ...wall.a, y: wall.bottom },
      { ...wall.b, y: wall.bottom },
      { ...wall.b, y: wall.top },
      { ...wall.a, y: wall.top },
    ];
    if (mirror)
      wallFace = clip(
        wallFace,
        (p) => dot(sub(p, mirror.origin), mirror.normal) - EPSILON,
      );
    for (const face of mirror
      ? [
          wallFace,
          wallFace.map((p) => reflect(p, mirror.origin, mirror.normal)),
        ]
      : [wallFace]) {
      // Only the part between the unfolded eye and sample plane can obstruct.
      const slab = clip(
        clip(face, (p) => dot(sub(p, origin), normal) / eyeDepth - EPSILON),
        (p) => 1 - dot(sub(p, origin), normal) / eyeDepth - EPSILON,
      );
      const projected = slab.map((p) => {
        const denominator = dot(sub(p, eye), normal);
        return add(eye, mul(sub(p, eye), -eyeDepth / denominator));
      });
      if (projected.length >= 3) shadows.push(projected);
    }
  }
  const output: ProjectedTriangle[] = [];
  for (const triangle of triangulate(outline)) {
    let polygon = triangle.map(point);
    for (const constraint of constraints) polygon = clip(polygon, constraint);
    let pieces = polygon.length >= 3 ? [polygon] : [];
    for (const shadow of shadows)
      pieces = pieces.flatMap((piece) =>
        subtractShadow(piece, shadow, origin, right, up),
      );
    for (const piece of pieces) {
      // The far ball is convex. Dropping boundary triangles is conservative;
      // accepting a polygon requires every point to be inside the far ball.
      if (
        piece.some(
          (p) =>
            dot(
              sub(viewed(p), witness.position),
              sub(viewed(p), witness.position),
            ) >
            (witness.far ?? 100) ** 2,
        )
      )
        continue;
      for (let i = 1; i < piece.length - 1; i++) {
        output.push([
          project(witness, viewed(piece[0])),
          project(witness, viewed(piece[i])),
          project(witness, viewed(piece[i + 1])),
        ]);
      }
    }
  }
  return output;
}
