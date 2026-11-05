/** All inputs are in one story frame, METRES. No role/history/camera access. */
export type P = readonly [number, number, number];
export interface V {
  p: P;
  uv: readonly [number, number];
}
export type Tri = readonly [V, V, V];
export interface MirrorPlane {
  origin: P;
  normal: P;
  right: P;
  up: P;
  width: number;
  height: number;
  aperture: number;
}
export interface Occluder {
  a: P;
  b: P;
  bottom: number;
  top: number;
}
export interface MirrorMesh {
  vertices: number[];
  indices: number[];
  sourceTriangles: number;
  overflow: boolean;
}
type Plane = { n: P; d: number };
const eps = 1e-8;
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: P, s: number): P => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P, b: P): P => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (p: P): P => mul(p, 1 / Math.max(eps, Math.hypot(...p)));
const distance = (h: Plane, p: P) => dot(h.n, p) + h.d;
function plane(a: P, b: P, c: P, inside: P): Plane {
  let n = unit(cross(sub(b, a), sub(c, a)));
  let d = -dot(n, a);
  if (dot(n, inside) + d < 0) {
    n = mul(n, -1);
    d = -d;
  }
  return { n, d };
}
function clip(poly: readonly V[], h: Plane): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = distance(h, a.p),
      db = distance(h, b.p);
    if (da >= -eps) out.push(a);
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      out.push({
        p: add(a.p, mul(sub(b.p, a.p), t)),
        uv: [
          a.uv[0] + (b.uv[0] - a.uv[0]) * t,
          a.uv[1] + (b.uv[1] - a.uv[1]) * t,
        ],
      });
    }
  }
  return out;
}
/** Subtract a convex shadow volume, retaining disjoint visible polygons. */
function subtract(poly: V[], volume: readonly Plane[]): V[][] {
  let whollyInside = true;
  for (const h of volume) {
    let outside = 0;
    for (const v of poly) if (distance(h, v.p) < -eps) outside++;
    if (outside === poly.length) return [poly];
    if (outside) whollyInside = false;
  }
  if (whollyInside) return [];
  let inside = poly;
  const visible: V[][] = [];
  for (const h of volume) {
    const outside = clip(inside, { n: mul(h.n, -1), d: -h.d });
    if (outside.length >= 3) visible.push(outside);
    inside = clip(inside, h);
    if (inside.length < 3) break;
  }
  return visible;
}
function shadow(eye: P, quad: readonly P[]): Plane[] {
  const center = mul(
    quad.reduce((a, p) => add(a, p), [0, 0, 0] as P),
    0.25,
  );
  const beyond = add(center, sub(center, eye));
  const near = plane(quad[0], quad[1], quad[2], beyond);
  // An eye lying on the surface cannot define a useful finite shadow cone.
  if (Math.abs(distance(near, eye)) < eps) return [];
  return [
    ...quad.map((p, i) => plane(eye, p, quad[(i + 1) % 4], center)),
    near,
  ];
}
/** Conservative rigid-node AABB rejection. Eight posed box corners suffice:
 * only reject when every corner lies outside the SAME aperture halfspace. */
export function mayReflectBounds(
  points: readonly P[],
  m: MirrorPlane,
  eyes: readonly P[],
): boolean {
  const local = (p: P): P => {
    const d = sub(p, m.origin);
    return [dot(d, m.right), dot(d, m.up), -dot(d, m.normal)];
  };
  const source = points.map(local);
  if (source.every((p) => p[2] > eps)) return false;
  const reflected = source.map((p) => [p[0], p[1], -p[2]] as P),
    l = -m.width / 2,
    r = l + m.width * Math.min(1, m.aperture),
    b = -m.height / 2,
    t = m.height / 2;
  const corners: P[] = [
      [l, b, 0],
      [r, b, 0],
      [r, t, 0],
      [l, t, 0],
    ],
    center: P = [(l + r) / 2, 0, 0];
  for (const worldEye of eyes) {
    const eye = local(worldEye);
    if (eye[2] >= -eps) return false;
    for (let i = 0; i < 4; i++) {
      const h = plane(eye, corners[i], corners[(i + 1) % 4], center);
      if (reflected.every((p) => distance(h, p) < -eps)) return false;
    }
  }
  return true;
}
export function buildLiveMirror(
  triangles: readonly Tri[],
  m: MirrorPlane,
  eyes: readonly P[],
  walls: readonly Occluder[],
  maxTriangles = 12000,
): MirrorMesh {
  const out: MirrorMesh = {
    vertices: [],
    indices: [],
    sourceTriangles: triangles.length,
    overflow: false,
  };
  if (
    !eyes.length ||
    m.aperture <= eps ||
    m.width <= 0 ||
    m.height <= 0 ||
    !Number.isFinite(m.aperture)
  )
    return out;
  const local = (p: P): P => {
    const d = sub(p, m.origin);
    return [dot(d, m.right), dot(d, m.up), -dot(d, m.normal)];
  };
  const world = (p: P): P =>
    add(
      m.origin,
      add(mul(m.right, p[0]), add(mul(m.up, p[1]), mul(m.normal, -p[2]))),
    );
  const observers = eyes.map(local);
  if (observers.some((e) => e[2] >= -eps)) return out;
  const reflect = (p: P): P => [p[0], p[1], -p[2]];
  const l = -m.width / 2,
    r = l + m.width * Math.min(1, m.aperture),
    b = -m.height / 2,
    t = m.height / 2;
  const corners: P[] = [
      [l, b, 0],
      [r, b, 0],
      [r, t, 0],
      [l, t, 0],
    ],
    center: P = [(l + r) / 2, 0, 0];
  const aperturePlanes = observers.flatMap((e) =>
    corners.map((p, i) => plane(e, p, corners[(i + 1) % 4], center)),
  );
  aperturePlanes.push({ n: [0, 0, 1], d: 0 });
  // Both legs: real walls shadow eye->mirror, reflected walls shadow mirror->actor.
  const volumes: Plane[][] = [];
  for (const wall of walls) {
    const q: P[] = (
      [
        [wall.a[0], wall.bottom, wall.a[2]],
        [wall.b[0], wall.bottom, wall.b[2]],
        [wall.b[0], wall.top, wall.b[2]],
        [wall.a[0], wall.top, wall.a[2]],
      ] as P[]
    ).map(local);
    // Clip walls to the room/front side before reflecting. Crossing walls keep
    // their actual finite intersection, rather than blocking the whole mirror.
    const front = clip(
      q.map((p) => ({ p, uv: [0, 0] as const })),
      { n: [0, 0, -1], d: 0 },
    ).map((v) => v.p);
    if (front.length < 3) continue;
    // A vertical rectangular wall remains a quad after front-plane clipping.
    if (front.length !== 4) continue;
    for (const eye of observers)
      for (const quad of [front, front.map(reflect)]) {
        const v = shadow(eye, quad);
        if (v.length) volumes.push(v);
      }
  }
  for (const tri of triangles) {
    const source = tri.map((v) => ({ p: local(v.p), uv: v.uv }));
    let physical = clip(source, { n: [0, 0, -1], d: 0 });
    if (physical.length < 3) continue;
    let poly = physical.map((v) => ({ p: reflect(v.p), uv: v.uv })).reverse();
    for (const h of aperturePlanes) {
      poly = clip(poly, h);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    let pieces = [poly];
    for (const volume of volumes) {
      pieces = pieces.flatMap((p) => subtract(p, volume));
      if (!pieces.length) break;
    }
    for (const piece of pieces)
      for (let i = 1; i < piece.length - 1; i++) {
        if (out.indices.length / 3 >= maxTriangles) {
          out.overflow = true;
          return out;
        }
        const vs = [piece[0], piece[i], piece[i + 1]],
          ps = vs.map((v) => world(v.p)),
          n = unit(cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])));
        if (Math.hypot(...cross(sub(ps[1], ps[0]), sub(ps[2], ps[0]))) < eps)
          continue;
        const start = out.vertices.length / 8;
        for (let k = 0; k < 3; k++)
          out.vertices.push(...ps[k], ...n, ...vs[k].uv);
        out.indices.push(start, start + 1, start + 2);
      }
  }
  return out;
}
/** Direct-path counterpart used by fixed-witness GLB art. World-space rigid
 * triangles are split against finite wall shadow volumes; no camera/runtime. */
export function clipDirectTriangles(
  triangles: readonly Tri[],
  eye: P,
  walls: readonly Occluder[],
  maxTriangles = 3000,
): MirrorMesh {
  const out: MirrorMesh = {
    vertices: [],
    indices: [],
    sourceTriangles: triangles.length,
    overflow: false,
  };
  const volumes = walls
    .map((w) =>
      shadow(eye, [
        [w.a[0], w.bottom, w.a[2]],
        [w.b[0], w.bottom, w.b[2]],
        [w.b[0], w.top, w.b[2]],
        [w.a[0], w.top, w.a[2]],
      ]),
    )
    .filter((v) => v.length);
  for (const tri of triangles) {
    let pieces = [Array.from(tri)];
    for (const volume of volumes) {
      pieces = pieces.flatMap((p) => subtract(p, volume));
      if (!pieces.length) break;
    }
    for (const piece of pieces)
      for (let i = 1; i < piece.length - 1; i++) {
        if (out.indices.length / 3 >= maxTriangles) {
          out.overflow = true;
          return out;
        }
        const vs = [piece[0], piece[i], piece[i + 1]],
          n = unit(cross(sub(vs[1].p, vs[0].p), sub(vs[2].p, vs[0].p))),
          start = out.vertices.length / 8;
        if (
          Math.hypot(...cross(sub(vs[1].p, vs[0].p), sub(vs[2].p, vs[0].p))) <
          eps
        )
          continue;
        for (const v of vs) out.vertices.push(...v.p, ...n, ...v.uv);
        out.indices.push(start, start + 1, start + 2);
      }
  }
  return out;
}
/** Cheap conservative wall rejection before shadow-volume construction. */
export function mayOccludeMirror(w:Occluder,m:MirrorPlane,eyes:readonly P[]):boolean {
 const points:P[]=[[w.a[0],w.bottom,w.a[2]],[w.b[0],w.bottom,w.b[2]],[w.b[0],w.top,w.b[2]],[w.a[0],w.top,w.a[2]]];
 if(mayReflectBounds(points,m,eyes))return true;
 const local=(p:P):P=>{const d=sub(p,m.origin);return[dot(d,m.right),dot(d,m.up),-dot(d,m.normal)];};
 const source=points.map(local),left=-m.width/2,right=left+m.width*Math.min(1,m.aperture),bottom=-m.height/2,top=m.height/2;
 const corners:P[]=[[left,bottom,0],[right,bottom,0],[right,top,0],[left,top,0]],center:P=[(left+right)/2,0,0];
 for(const worldEye of eyes){const eye=local(worldEye);let possible=true;
  for(let i=0;i<4;i++){const h=plane(eye,corners[i],corners[(i+1)%4],center);if(source.every(p=>distance(h,p)<-eps)){possible=false;break;}}
  if(possible)return true;
 }
 return false;
}
