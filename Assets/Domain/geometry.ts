import { Board, Mirror, Track, Vec3, Wall, Witness } from "./types";
/** Boundary contact is opaque; this tolerance is shared by geometry and validation. */
export const EPSILON = 1e-7;
export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const mul = (a: Vec3, n: number): Vec3 => ({
  x: a.x * n,
  y: a.y * n,
  z: a.z * n,
});
export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;
export const distance = (a: Vec3, b: Vec3): number =>
  Math.sqrt(dot(sub(a, b), sub(a, b)));
export function poseAt(track: Track, tick: number): Vec3 & { yaw: number } {
  const keys = track.keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].tick <= tick) i++;
  const a = keys[i],
    b = keys[Math.min(i + 1, keys.length - 1)];
  const f =
    b.tick === a.tick
      ? 0
      : Math.max(0, Math.min(1, (tick - a.tick) / (b.tick - a.tick)));
  // Moving bodies follow their segment; standing preserves the last nonzero heading.
  let yaw = keys[0].yaw;
  for (let j = 0; j <= i; j++) {
    const p = keys[j],
      q = keys[j + 1];
    if (q && (q.x !== p.x || q.z !== p.z))
      yaw = p.backward
        ? Math.atan2(p.x - q.x, p.z - q.z)
        : Math.atan2(q.x - p.x, q.z - p.z);
  }
  return {
    x: a.x + (b.x - a.x) * f,
    y: (a.y ?? 1) + ((b.y ?? 1) - (a.y ?? 1)) * f,
    z: a.z + (b.z - a.z) * f,
    yaw,
  };
}
const cross = (a: Vec3, b: Vec3) => a.x * b.z - a.z * b.x;
export function hitsWall(a: Vec3, b: Vec3, w: Wall): boolean {
  const u = sub(b, a),
    v = sub(w.b, w.a),
    offset = sub(w.a, a),
    den = cross(u, v);
  if (Math.abs(den) < EPSILON) {
    if (Math.abs(cross(offset, u)) > EPSILON) return false;
    const length = u.x * u.x + u.z * u.z;
    if (length < EPSILON * EPSILON) {
      const edge = v.x * v.x + v.z * v.z;
      const t = edge ? ((a.x - w.a.x) * v.x + (a.z - w.a.z) * v.z) / edge : 0;
      return (
        t >= -EPSILON &&
        t <= 1 + EPSILON &&
        Math.abs(cross(sub(a, w.a), v)) <= EPSILON &&
        Math.max(a.y, b.y) >= w.bottom - EPSILON &&
        Math.min(a.y, b.y) <= w.top + EPSILON
      );
    }
    const t0 =
      dot({ x: offset.x, y: 0, z: offset.z }, { x: u.x, y: 0, z: u.z }) /
      length;
    const t1 = t0 + (v.x * u.x + v.z * u.z) / length;
    const lo = Math.max(0, Math.min(t0, t1)),
      hi = Math.min(1, Math.max(t0, t1));
    if (lo > hi + EPSILON) return false;
    const ya = a.y + u.y * lo,
      yb = a.y + u.y * hi;
    return (
      Math.max(ya, yb) >= w.bottom - EPSILON &&
      Math.min(ya, yb) <= w.top + EPSILON
    );
  }
  const t = cross(offset, v) / den,
    s = cross(offset, u) / den,
    y = a.y + t * u.y;
  return (
    t >= -EPSILON &&
    t <= 1 + EPSILON &&
    s >= -EPSILON &&
    s <= 1 + EPSILON &&
    y >= w.bottom - EPSILON &&
    y <= w.top + EPSILON
  );
}
export const clear = (a: Vec3, b: Vec3, walls: Wall[]): boolean =>
  !walls.some((w) => hitsWall(a, b, w));
export function inView(w: Witness, p: Vec3): boolean {
  const d = sub(p, w.position),
    depth = d.x * Math.sin(w.yaw) + d.z * Math.cos(w.yaw),
    side = d.x * Math.cos(w.yaw) - d.z * Math.sin(w.yaw);
  return (
    depth > (w.near ?? 0) + EPSILON &&
    distance(w.position, p) <= (w.far ?? 100) + EPSILON &&
    Math.abs(Math.atan2(side, depth)) < w.fov / 2 - EPSILON &&
    Math.abs(Math.atan2(d.y, Math.hypot(d.x, d.z))) <
      (w.verticalFov ?? Math.PI * 0.9) / 2 - EPSILON
  );
}
export function reflectionPoint(
  w: Witness,
  p: Vec3,
  m: Mirror,
  walls: Wall[],
): Vec3 | undefined {
  if (
    m.aperture <= EPSILON ||
    dot(sub(w.position, m.origin), m.normal) <= EPSILON ||
    dot(sub(p, m.origin), m.normal) <= EPSILON
  )
    return;
  const virtual = sub(p, mul(m.normal, 2 * dot(sub(p, m.origin), m.normal)));
  const ray = sub(virtual, w.position),
    den = dot(ray, m.normal);
  if (Math.abs(den) < EPSILON) return;
  const t = dot(sub(m.origin, w.position), m.normal) / den;
  if (t <= EPSILON || t >= 1 - EPSILON) return;
  const q = add(w.position, mul(ray, t)),
    local = sub(q, m.origin),
    h = dot(local, m.right),
    v = dot(local, m.up);
  if (
    h <= -m.width / 2 + EPSILON ||
    h >= -m.width / 2 + m.width * m.aperture - EPSILON ||
    Math.abs(v) >= m.height / 2 - EPSILON
  )
    return;
  if (
    !inView(w, q) ||
    !inView(w, virtual) ||
    !clear(w.position, q, walls) ||
    !clear(q, p, walls)
  )
    return;
  return q;
}
export function sight(
  board: Board,
  w: Witness,
  p: Vec3,
  via: "direct" | "mirror",
): Vec3 | undefined {
  if (via === "direct")
    return inView(w, p) && clear(w.position, p, board.room.walls)
      ? p
      : undefined;
  return board.room.mirror
    ? reflectionPoint(w, p, board.room.mirror, board.room.walls)
    : undefined;
}
export function project(
  w: Witness,
  p: Vec3,
): { horizontal: number; vertical: number } {
  const d = sub(p, w.position),
    depth = d.x * Math.sin(w.yaw) + d.z * Math.cos(w.yaw);
  return {
    horizontal: Math.atan2(
      d.x * Math.cos(w.yaw) - d.z * Math.sin(w.yaw),
      depth,
    ),
    vertical: Math.atan2(d.y, Math.hypot(d.x, d.z)),
  };
}
