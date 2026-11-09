// The room the light falls into. On Specs these surfaces come from the world mesh hit tests.
// Lens Studio's Interactive Preview rooms don't answer hit tests, so for the "Sunlit Room"
// preview environment we measured the floor, walls, furniture and window frames by hand
// (marker grids photographed from several camera positions). Units are centimeters.

export type SurfaceId = "floor" | "farWall" | "leftWall" | "backWall" | "sofa" | "table" | "console" | "desk";

export interface Hit {
  t: number;
  p: vec3;
  n: vec3;
  id: SurfaceId;
}

export interface WindowFrame {
  z0: number; z1: number; // along the wall
  y0: number; y1: number; // sill and head
}

interface Box { id: SurfaceId; min: vec3; max: vec3; }
interface Disc { id: SurfaceId; c: vec3; r: number; }

export const FLOOR_Y = -178;
export const WALL_X = 220; // the window wall; +X points outside
const FAR_Z = -540, BACK_Z = 80, LEFT_X = -270, CEIL_Y = 84;

// Window frames found on the wall at x = 220 (three tall bays behind sheer curtains).
export const KNOWN_WINDOWS: WindowFrame[] = [
  { z0: -120, z1: -24, y0: -125, y1: 81 },
  { z0: -293, z1: -194, y0: -125, y1: 81 },
  { z0: -473, z1: -369, y0: -125, y1: 81 },
];

const BOXES: Box[] = [
  { id: "sofa", min: new vec3(-150, FLOOR_Y, -150), max: new vec3(130, -128, -38) },
  { id: "sofa", min: new vec3(-150, FLOOR_Y, -38), max: new vec3(130, -95, -8) },
  { id: "sofa", min: new vec3(90, FLOOR_Y, -150), max: new vec3(132, -106, -8) },
  { id: "sofa", min: new vec3(-152, FLOOR_Y, -150), max: new vec3(-112, -106, -8) },
  { id: "console", min: new vec3(-250, -158, -540), max: new vec3(160, -143, -500) },
  { id: "desk", min: new vec3(-60, FLOOR_Y, 35), max: new vec3(215, -100, 80) },
];
const DISCS: Disc[] = [{ id: "table", c: new vec3(0, -145, -290), r: 62 }];

export const OCCLUDERS: { min: vec3; max: vec3 }[] = [
  ...BOXES.map((b) => ({ min: b.min, max: b.max })),
  { min: new vec3(-62, FLOOR_Y, -352), max: new vec3(62, -145, -228) },
];

export function insideRoom(x: number, z: number): boolean {
  return x > LEFT_X && x < WALL_X && z > FAR_Z && z < BACK_Z;
}

// Nearest surface hit by a ray inside the room, or null.
export function cast(o: vec3, d: vec3, maxT = 2000): Hit | null {
  let best: Hit | null = null;
  const consider = (t: number, n: vec3, id: SurfaceId, check: (p: vec3) => boolean) => {
    if (t <= 0.5 || t >= maxT || (best && t >= best.t)) return;
    const p = o.add(d.uniformScale(t));
    if (!check(p)) return;
    best = { t, p, n, id };
  };
  if (d.y < 0) consider((FLOOR_Y - o.y) / d.y, vec3.up(), "floor", (p) => insideRoom(p.x, p.z));
  if (d.z < 0) consider((FAR_Z - o.z) / d.z, vec3.forward(), "farWall", (p) => p.y > FLOOR_Y && p.y < CEIL_Y && p.x > LEFT_X && p.x < WALL_X);
  if (d.z > 0) consider((BACK_Z - o.z) / d.z, vec3.back(), "backWall", (p) => p.y > FLOOR_Y && p.y < CEIL_Y && p.x > LEFT_X && p.x < WALL_X);
  if (d.x < 0) consider((LEFT_X - o.x) / d.x, vec3.right(), "leftWall", (p) => p.y > FLOOR_Y && p.y < CEIL_Y && p.z > FAR_Z && p.z < BACK_Z);
  for (const b of BOXES) {
    const h = slab(o, d, b.min, b.max);
    if (h) consider(h.t, h.n, b.id, () => true);
  }
  for (const c of DISCS) {
    if (d.y < 0) consider((c.c.y - o.y) / d.y, vec3.up(), c.id, (p) => (p.x - c.c.x) ** 2 + (p.z - c.c.z) ** 2 < c.r * c.r);
  }
  return best;
}

// Does a straight path from p toward the sun leave the room through a window? (used for sun-hour maps)
export function seesSun(p: vec3, s: vec3, windows: WindowFrame[]): boolean {
  if (s.x <= 0.01 || s.y <= 0) return false;
  const t = (WALL_X - p.x) / s.x;
  const y = p.y + s.y * t, z = p.z + s.z * t;
  let through = false;
  for (const w of windows) if (z > w.z0 && z < w.z1 && y > w.y0 && y < w.y1) { through = true; break; }
  if (!through) return false;
  for (const b of OCCLUDERS) {
    const h = slab(p, s, b.min, b.max);
    if (h && h.t > 1 && h.t < t) return false;
  }
  return true;
}

function slab(o: vec3, d: vec3, mn: vec3, mx: vec3): { t: number; n: vec3 } | null {
  let tmin = -1e9, tmax = 1e9, n = vec3.up();
  const axes: [number, number, number, number, vec3, vec3][] = [
    [o.x, d.x, mn.x, mx.x, vec3.left(), vec3.right()],
    [o.y, d.y, mn.y, mx.y, vec3.down(), vec3.up()],
    [o.z, d.z, mn.z, mx.z, vec3.back(), vec3.forward()],
  ];
  for (const [oo, dd, a, b, nNeg, nPos] of axes) {
    if (Math.abs(dd) < 1e-6) {
      if (oo < a || oo > b) return null;
      continue;
    }
    let t1 = (a - oo) / dd, t2 = (b - oo) / dd, n1 = nNeg;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = nPos; }
    if (t1 > tmin) { tmin = t1; n = n1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin <= 0) return null;
  return { t: tmin, n };
}

// Flat surfaces that receive the window's light. Each is a plane (axis = value) with a rectangle
// it covers; the light is the window rectangle projected along the sun ray and clipped to it.
export interface Receiver {
  id: SurfaceId;
  axis: 0 | 1 | 2;
  value: number;
  normal: vec3;
  rect: [number, number, number][]; // [axis, min, max]
  disc?: { cx: number; cz: number; r: number };
}

export function receivers(): Receiver[] {
  return [
    { id: "floor", axis: 1, value: FLOOR_Y, normal: vec3.up(), rect: [[0, LEFT_X, WALL_X], [2, FAR_Z, BACK_Z]] },
    { id: "leftWall", axis: 0, value: LEFT_X, normal: vec3.right(), rect: [[1, FLOOR_Y, CEIL_Y], [2, FAR_Z, BACK_Z]] },
    { id: "farWall", axis: 2, value: FAR_Z, normal: vec3.forward(), rect: [[0, LEFT_X, WALL_X], [1, FLOOR_Y, CEIL_Y]] },
    { id: "backWall", axis: 2, value: BACK_Z, normal: vec3.back(), rect: [[0, LEFT_X, WALL_X], [1, FLOOR_Y, CEIL_Y]] },
    { id: "sofa", axis: 1, value: -128, normal: vec3.up(), rect: [[0, -150, 130], [2, -150, -38]] },
    { id: "table", axis: 1, value: -145, normal: vec3.up(), rect: [[0, -62, 62], [2, -352, -228]], disc: { cx: 0, cz: -290, r: 62 } },
    { id: "console", axis: 1, value: -143, normal: vec3.up(), rect: [[0, -250, 160], [2, -540, -500]] },
  ];
}

export function comp(p: vec3, axis: number): number {
  return axis === 0 ? p.x : axis === 1 ? p.y : p.z;
}
