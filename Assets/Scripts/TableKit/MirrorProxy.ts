/** Geometry-only mirror for fixed witness camera. No interaction components copied.
 * Input must ALREADY contain only public, observed source triangles after occlusion.
 * Reflect positions once, reverse winding once, clip each triangle to finite aperture.
 * Coordinates are mirror-local cm; plane Z=0, front Z<0, +Y up.
 */
import { Vec3 } from "./TableKit";
export interface Triangle {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
}
export interface Aperture {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}
export interface ProxyMesh {
  vertices: Vec3[];
  indices: number[];
  normals: Vec3[];
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const reflect = (p: Vec3): Vec3 => [p[0], p[1], -p[2]];
export function reflectObservedTriangles(
  observed: readonly Triangle[],
  observer: Vec3,
  opening: Aperture,
): ProxyMesh {
  const output: ProxyMesh = { vertices: [], indices: [], normals: [] };
  if (
    observer[2] >= -1e-6 ||
    opening.left >= opening.right ||
    opening.bottom >= opening.top
  )
    return output;
  const corners: Vec3[] = [
    [opening.left, opening.bottom, 0],
    [opening.right, opening.bottom, 0],
    [opening.right, opening.top, 0],
    [opening.left, opening.top, 0],
  ];
  const center: Vec3 = [
    (opening.left + opening.right) / 2,
    (opening.bottom + opening.top) / 2,
    1,
  ];
  const planes = corners.map((p, i) => {
    let n = cross(sub(p, observer), sub(corners[(i + 1) % 4], observer));
    if (dot(n, sub(center, observer)) < 0) n = [-n[0], -n[1], -n[2]];
    return (q: Vec3) => dot(n, sub(q, observer));
  });
  planes.push((q) => q[2]);
  for (const tri of observed) {
    // A reflected scene cannot include a physical actor behind the mirror.
    if (tri.a[2] > 1e-6 || tri.b[2] > 1e-6 || tri.c[2] > 1e-6) continue;
    let poly: Vec3[] = [reflect(tri.a), reflect(tri.c), reflect(tri.b)];
    for (const distance of planes) {
      const clipped: Vec3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          da = distance(a),
          db = distance(b);
        if (da >= -1e-7) clipped.push(a);
        if (da < 0 !== db < 0) clipped.push(lerp(a, b, da / (da - db)));
      }
      poly = clipped;
      if (poly.length < 3) break;
    }
    for (let i = 1; i < poly.length - 1; i++) {
      const a = poly[0],
        b = poly[i],
        c = poly[i + 1],
        n = cross(sub(b, a), sub(c, a)),
        length = Math.sqrt(dot(n, n));
      if (length < 1e-9) continue;
      const normal: Vec3 = [n[0] / length, n[1] / length, n[2] / length],
        start = output.vertices.length;
      output.vertices.push(a, b, c);
      output.indices.push(start, start + 1, start + 2);
      output.normals.push(normal, normal, normal);
    }
  }
  return output;
}
/** Same numerical aperture as curtainVisual; do not animate a second mask. */
export function mirrorOpening(aperture: number): Aperture {
  const a = Math.max(0, Math.min(1, Number.isFinite(aperture) ? aperture : 0));
  return { left: -3, right: -3 + 6 * a, bottom: 1, top: 11 };
}
