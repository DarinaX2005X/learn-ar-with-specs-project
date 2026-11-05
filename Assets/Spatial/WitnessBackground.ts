import { Board, Fragment, Room, Vec3, Wall, Witness } from "../Domain/types";
import { add, dot, EPSILON, mul, sub } from "../Domain/geometry";
import { projectVisibleSurface } from "../Domain/projectSurface";

export type BackgroundColor = readonly [number, number, number];
export type BackgroundPoint = readonly [number, number];
/** Perspective plane coordinates, side/depth and height/depth, not radians. */
export interface WitnessViewport {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface WitnessBackgroundOptions {
  roomHeight?: number;
  frameWidth?: number;
  frameHeight?: number;
  /** Zero matches the kernel's public opaque plane. Nonzero thickness must be
   * supplied as an explicit public rendering property, not inferred from actors. */
  partitionThickness?: number;
  cacheEntries?: number;
}
export interface WitnessRayHit {
  kind:
    | "floor"
    | "ceiling"
    | "wall"
    | "partition"
    | "mirror-frame"
    | "shutter"
    | "reflection"
    | "back"
    | "void";
  objectId: string;
  position: Vec3;
  /** Complete optical path length in metres, including the reflected leg. */
  distance: number;
  color: BackgroundColor;
  material: string;
  reflected: boolean;
  mirrorPoint?: Vec3;
}
export interface WitnessBackgroundBatch {
  material: string;
  color: BackgroundColor;
  /** All coordinates remain in the caller's unchanged tangent plane. */
  vertices: BackgroundPoint[];
  indices: number[];
  /** Static relief order. The caller keeps every layer behind observed patches. */
  layer: number;
}
export interface WitnessBackgroundPlate {
  viewport: WitnessViewport;
  columns: number;
  rows: number;
  batches: WitnessBackgroundBatch[];
  depths: Float32Array;
  rayCount: number;
  reflectionCount: number;
}
interface SurfaceHit {
  kind: "floor" | "ceiling" | "wall" | "partition" | "mirror";
  id: string;
  t: number;
  position: Vec3;
  normal: Vec3;
  u?: number;
  v?: number;
  length?: number;
  wall?: Wall;
}
const PALETTE: Record<string, BackgroundColor> = {
  plaster: [0.72, 0.67, 0.56],
  plasterShade: [0.64, 0.6, 0.51],
  ceiling: [0.83, 0.79, 0.7],
  dado: [0.21, 0.31, 0.28],
  dadoPanel: [0.25, 0.35, 0.31],
  trim: [0.33, 0.23, 0.15],
  floor0: [0.51, 0.34, 0.2],
  floor1: [0.58, 0.4, 0.25],
  floor2: [0.45, 0.29, 0.17],
  seam: [0.28, 0.2, 0.14],
  cloth: [0.24, 0.38, 0.34],
  clothShade: [0.19, 0.31, 0.28],
  frame: [0.32, 0.2, 0.13],
  frameEdge: [0.48, 0.35, 0.22],
  curtain: [0.28, 0.36, 0.32],
  curtainFold: [0.2, 0.28, 0.25],
  back: [0.33, 0.28, 0.21],
  void: [0.73, 0.69, 0.59],
};
/** Eight restrained material colours, shared by overview and optical detail. */
export const WITNESS_BACKGROUND_COLORS: readonly BackgroundColor[] = [
  [0.72, 0.67, 0.56],
  [0.83, 0.79, 0.7],
  [0.32, 0.22, 0.14],
  [0.52, 0.36, 0.23],
  [0.6, 0.43, 0.28],
  [0.2, 0.31, 0.28],
  [0.27, 0.39, 0.34],
  [0.64, 0.64, 0.55],
];
const quantize = (color: BackgroundColor): BackgroundColor =>
  WITNESS_BACKGROUND_COLORS.reduce((best, candidate) => {
    const error = (c: BackgroundColor) =>
      c.reduce((sum, value, i) => sum + (value - color[i]) ** 2, 0);
    return error(candidate) < error(best) ? candidate : best;
  });
const DIRECT_COLORS: Record<string, BackgroundColor> = {},
  REFLECTED_COLORS: Record<string, BackgroundColor> = {};
for (const key of Object.keys(PALETTE)) {
  const c = PALETTE[key];
  DIRECT_COLORS[key] = quantize(c);
  REFLECTED_COLORS[key] = quantize([c[0] * 0.92, c[1] * 0.96, c[2] * 0.98]);
}
const mod = (value: number, period: number): number =>
  ((value % period) + period) % period;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Pure static witness scenery. Only room architecture and the fixed witness
 * are copied. Tracks, casting, events, tapes and histories cannot affect it.
 * The analytic ray cast is shared by overview, selected optical detail and pins.
 */
export class WitnessBackground {
  private room: Room;
  private witness: Witness;
  private height: number;
  private frameWidth: number;
  private frameHeight: number;
  private thickness: number;
  private cacheLimit: number;
  private cache = new Map<string, WitnessBackgroundPlate>();
  private sin: number;
  private cos: number;
  private horizontalLimit: number;
  private verticalLimit: number;
  private planes: {
    wall: Wall;
    extent: number;
    ux: number;
    uz: number;
    nx: number;
    nz: number;
  }[];
  private rims: {
    color: BackgroundColor;
    layer: number;
    polygon: BackgroundPoint[];
  }[] = [];
  constructor(
    board: Pick<Board, "room" | "witnesses">,
    witnessId: string,
    options: WitnessBackgroundOptions = {},
  ) {
    const witness = board.witnesses.find((w) => w.id === witnessId);
    if (!witness) throw new Error("Choose an available witness");
    this.room = clone(board.room);
    this.witness = clone(witness);
    this.sin = Math.sin(witness.yaw);
    this.cos = Math.cos(witness.yaw);
    this.horizontalLimit =
      witness.fov < Math.PI - EPSILON
        ? Math.tan(witness.fov / 2 - EPSILON)
        : 1 / EPSILON;
    this.verticalLimit = Math.tan(
      (witness.verticalFov ?? Math.PI * 0.9) / 2 - EPSILON,
    );
    this.planes = this.room.walls.map((wall) => {
      const dx = wall.b.x - wall.a.x,
        dz = wall.b.z - wall.a.z,
        extent = Math.hypot(dx, dz);
      return {
        wall,
        extent,
        ux: dx / extent,
        uz: dz / extent,
        nx: -dz / extent,
        nz: dx / extent,
      };
    });
    this.height = options.roomHeight ?? 3.8;
    this.frameWidth = options.frameWidth ?? 0.06;
    this.frameHeight = options.frameHeight ?? this.frameWidth;
    this.thickness = options.partitionThickness ?? 0;
    const cacheEntries = options.cacheEntries ?? 8;
    if (!Number.isFinite(cacheEntries))
      throw new Error("Use a finite background cache limit");
    this.cacheLimit = Math.max(1, Math.min(32, Math.floor(cacheEntries)));
    if (
      ![this.height, this.frameWidth, this.frameHeight, this.thickness].every(
        Number.isFinite,
      ) ||
      this.height <= 0 ||
      this.frameWidth < 0 ||
      this.frameHeight < 0 ||
      this.thickness < 0
    )
      throw new Error("Use finite public room and frame dimensions");
    this.compileMirrorRim();
  }
  private compileMirrorRim(): void {
    const mirror = this.room.mirror;
    if (
      !mirror ||
      this.frameWidth <= 0 ||
      this.thickness > EPSILON ||
      Math.abs(mirror.up.x) > EPSILON ||
      Math.abs(mirror.up.z) > EPSILON ||
      Math.abs(mirror.right.y) > EPSILON ||
      dot(sub(this.witness.position, mirror.origin), mirror.normal) <= EPSILON
    )
      return;
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].map((y) =>
        add(
          mirror.origin,
          add(
            mul(mirror.right, x * (mirror.width / 2 + this.frameWidth)),
            mul(mirror.up, y * (mirror.height / 2 + this.frameHeight)),
          ),
        ),
      ),
    );
    if (
      corners.some(
        (p) =>
          p.x < -EPSILON ||
          p.x > this.room.width + EPSILON ||
          p.z < -EPSILON ||
          p.z > this.room.depth + EPSILON ||
          p.y < 0 ||
          p.y > this.height,
      )
    )
      return;
    // A narrow public-geometry adapter for the existing exact surface projector.
    // It is never returned as a case or supplied to history enumeration.
    const geometry: Board = {
      caseId: "static-room",
      rev: 0,
      room: this.room,
      witnesses: [this.witness],
      tracks: [],
      alarmTick: 0,
      chain: false,
      fields: [],
      windows: {
        take: [],
        brush: { A: [], B: [], C: [] },
        pass: [],
        stash: [],
      },
    };
    const fragment: Fragment = {
      position: mirror.origin,
      surfaceRight: mirror.right,
      projection: { horizontal: 0, vertical: 0 },
      via: "direct",
      segment: "public-mirror-frame",
    };
    const ring = (
      width: number,
      height: number,
      color: BackgroundColor,
      layer: number,
    ) => {
      const a = mirror.width / 2,
        b = mirror.height / 2,
        c = a + width,
        d = b + height;
      const quads = [
        [
          [-c, -d],
          [c, -d],
          [c, -b],
          [-c, -b],
        ],
        [
          [-c, b],
          [c, b],
          [c, d],
          [-c, d],
        ],
        [
          [-c, -b],
          [-a, -b],
          [-a, b],
          [-c, b],
        ],
        [
          [a, -b],
          [c, -b],
          [c, b],
          [a, b],
        ],
      ] as const;
      for (const quad of quads)
        for (const triangle of projectVisibleSurface(
          geometry,
          this.witness.id,
          fragment,
          quad,
        ))
          this.rims.push({
            color,
            layer,
            polygon: triangle.map((p) => {
              const x = Math.tan(p.horizontal);
              return [x, Math.tan(p.vertical) * Math.sqrt(1 + x * x)];
            }),
          });
    };
    ring(this.frameWidth, this.frameHeight, WITNESS_BACKGROUND_COLORS[2], 1);
    ring(
      Math.min(this.frameWidth, 0.012),
      Math.min(this.frameHeight, 0.012),
      WITNESS_BACKGROUND_COLORS[3],
      2,
    );
  }
  /** Ray through the same pinhole coordinates used by RecordedGlass.point(). */
  traceTangent(x: number, y: number): WitnessRayHit {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.empty();
    const w = this.witness;
    if (
      Math.abs(x) >= this.horizontalLimit ||
      Math.abs(y) >= this.verticalLimit * Math.sqrt(1 + x * x)
    )
      return this.empty();
    const inverse = 1 / Math.sqrt(1 + x * x + y * y);
    const ray = {
      x: (this.sin + x * this.cos) * inverse,
      y: y * inverse,
      z: (this.cos - x * this.sin) * inverse,
    };
    const first = this.nearest(w.position, ray, false);
    if (
      !first ||
      first.t > (w.far ?? 100) + EPSILON ||
      first.t * inverse <= (w.near ?? 0) + EPSILON
    )
      return this.empty();
    if (first.kind !== "mirror") return this.paint(first, false);
    const mirror = this.room.mirror!;
    const local = sub(first.position, mirror.origin),
      u = dot(local, mirror.right),
      v = dot(local, mirror.up);
    const inside =
      Math.abs(u) < mirror.width / 2 - EPSILON &&
      Math.abs(v) < mirror.height / 2 - EPSILON;
    if (!inside)
      return this.colored(
        first,
        "mirror-frame",
        Math.min(
          Math.abs(Math.abs(u) - mirror.width / 2),
          Math.abs(Math.abs(v) - mirror.height / 2),
        ) < 0.012
          ? "frameEdge"
          : "frame",
        false,
      );
    if (dot(sub(w.position, mirror.origin), mirror.normal) <= EPSILON)
      return this.colored(first, "back", "back", false);
    if (
      u >= -mirror.width / 2 + mirror.width * mirror.aperture - EPSILON ||
      mirror.aperture <= EPSILON
    ) {
      const fold = mod(((u + mirror.width / 2) * 12) / mirror.width, 1);
      return this.colored(
        first,
        "shutter",
        fold < 0.28 ? "curtainFold" : "curtain",
        false,
      );
    }
    const reflected = sub(ray, mul(mirror.normal, 2 * dot(ray, mirror.normal)));
    const second = this.nearest(
      add(first.position, mul(reflected, EPSILON * 8)),
      reflected,
      true,
    );
    if (!second || first.t + second.t > (w.far ?? 100)) return this.empty();
    const sample = this.paint(second, true);
    return {
      ...sample,
      kind: "reflection",
      distance: first.t + second.t,
      mirrorPoint: first.position,
    };
  }
  private empty(): WitnessRayHit {
    return {
      kind: "void",
      objectId: "outside",
      position: { x: 0, y: 0, z: 0 },
      distance: Infinity,
      color: PALETTE.void,
      material: "void",
      reflected: false,
    };
  }
  private nearest(
    eye: Vec3,
    ray: Vec3,
    skipMirror: boolean,
  ): SurfaceHit | undefined {
    let nearest: SurfaceHit | undefined,
      nearestDistance = Infinity;
    const accept = (
      kind: SurfaceHit["kind"],
      id: string,
      t: number,
      x: number,
      y: number,
      z: number,
      normal: Vec3,
      u?: number,
      extent?: number,
      wall?: Wall,
    ) => {
      nearestDistance = t;
      nearest = {
        kind,
        id,
        t,
        position: { x, y, z },
        normal,
        u,
        length: extent,
        wall,
      };
    };
    const horizontal = (
      height: number,
      kind: "floor" | "ceiling",
      normal: Vec3,
    ) => {
      if (Math.abs(ray.y) < EPSILON) return;
      const t = (height - eye.y) / ray.y;
      if (t <= EPSILON || t >= nearestDistance) return;
      const x = eye.x + ray.x * t,
        z = eye.z + ray.z * t;
      if (
        x >= -EPSILON &&
        x <= this.room.width + EPSILON &&
        z >= -EPSILON &&
        z <= this.room.depth + EPSILON
      )
        accept(kind, kind, t, x, height, z, normal);
    };
    horizontal(0, "floor", { x: 0, y: 1, z: 0 });
    horizontal(this.height, "ceiling", { x: 0, y: -1, z: 0 });
    const boundary = (
      axis: "x" | "z",
      at: number,
      maxOther: number,
      normal: Vec3,
      id: string,
    ) => {
      if (Math.abs(ray[axis]) < EPSILON) return;
      const t = (at - eye[axis]) / ray[axis];
      if (t <= EPSILON || t >= nearestDistance) return;
      const x = eye.x + ray.x * t,
        y = eye.y + ray.y * t,
        z = eye.z + ray.z * t,
        along = axis === "x" ? z : x;
      if (
        along >= -EPSILON &&
        along <= maxOther + EPSILON &&
        y >= 0 &&
        y <= this.height
      )
        accept("wall", id, t, x, y, z, normal, along);
    };
    boundary("x", 0, this.room.depth, { x: 1, y: 0, z: 0 }, "room-west");
    boundary(
      "x",
      this.room.width,
      this.room.depth,
      { x: -1, y: 0, z: 0 },
      "room-east",
    );
    boundary("z", 0, this.room.width, { x: 0, y: 0, z: 1 }, "room-front");
    boundary(
      "z",
      this.room.depth,
      this.room.width,
      { x: 0, y: 0, z: -1 },
      "room-back",
    );
    for (const plane of this.planes) {
      const wall = plane.wall;
      if (this.thickness > EPSILON) {
        const hit = this.partition(eye, ray, wall);
        if (hit && hit.t < nearestDistance) {
          nearest = hit;
          nearestDistance = hit.t;
        }
        continue;
      }
      const den = ray.x * plane.nx + ray.z * plane.nz;
      if (Math.abs(den) < EPSILON) continue;
      const t =
        ((wall.a.x - eye.x) * plane.nx + (wall.a.z - eye.z) * plane.nz) / den;
      if (t <= EPSILON || t >= nearestDistance) continue;
      const x = eye.x + ray.x * t,
        y = eye.y + ray.y * t,
        z = eye.z + ray.z * t,
        u = (x - wall.a.x) * plane.ux + (z - wall.a.z) * plane.uz;
      if (
        u >= -EPSILON &&
        u <= plane.extent + EPSILON &&
        y >= wall.bottom - EPSILON &&
        y <= wall.top + EPSILON
      )
        accept(
          "partition",
          wall.id,
          t,
          x,
          y,
          z,
          { x: plane.nx, y: 0, z: plane.nz },
          u,
          plane.extent,
          wall,
        );
    }
    if (!skipMirror && this.room.mirror) {
      const m = this.room.mirror,
        den = dot(ray, m.normal);
      if (Math.abs(den) > EPSILON) {
        const t = dot(sub(m.origin, eye), m.normal) / den;
        if (t <= EPSILON || t > nearestDistance + EPSILON) return nearest;
        const p = add(eye, mul(ray, t)),
          d = sub(p, m.origin);
        if (
          Math.abs(dot(d, m.right)) <= m.width / 2 + this.frameWidth &&
          Math.abs(dot(d, m.up)) <= m.height / 2 + this.frameHeight
        )
          accept("mirror", m.id, t, p.x, p.y, p.z, m.normal);
      }
    }
    return nearest;
  }
  private partition(eye: Vec3, ray: Vec3, wall: Wall): SurfaceHit | undefined {
    const edge = sub(wall.b, wall.a),
      extent = Math.hypot(edge.x, edge.z);
    if (extent < EPSILON) return;
    const along = { x: edge.x / extent, y: 0, z: edge.z / extent },
      normal = { x: -along.z, y: 0, z: along.x };
    if (this.thickness <= EPSILON) {
      const den = dot(ray, normal);
      if (Math.abs(den) < EPSILON) return;
      const t = dot(sub(wall.a, eye), normal) / den,
        p = add(eye, mul(ray, t)),
        u = dot(sub(p, wall.a), along);
      if (
        u >= -EPSILON &&
        u <= extent + EPSILON &&
        p.y >= wall.bottom - EPSILON &&
        p.y <= wall.top + EPSILON
      )
        return {
          kind: "partition",
          id: wall.id,
          t,
          position: p,
          normal,
          u,
          length: extent,
          wall,
        };
      return;
    }
    // Optional public solid prism, including top and end caps.
    const offset = sub(eye, wall.a),
      coordinates = [
        dot(offset, along),
        eye.y - wall.bottom,
        dot(offset, normal),
      ],
      directions = [dot(ray, along), ray.y, dot(ray, normal)],
      minimum = [0, 0, -this.thickness / 2],
      maximum = [extent, wall.top - wall.bottom, this.thickness / 2];
    let near = -Infinity,
      far = Infinity,
      nearAxis = 0,
      nearSign = 1,
      farAxis = 0,
      farSign = 1;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(directions[axis]) < EPSILON) {
        if (
          coordinates[axis] < minimum[axis] ||
          coordinates[axis] > maximum[axis]
        )
          return;
        continue;
      }
      const a = (minimum[axis] - coordinates[axis]) / directions[axis],
        b = (maximum[axis] - coordinates[axis]) / directions[axis];
      if (Math.min(a, b) > near) {
        near = Math.min(a, b);
        nearAxis = axis;
        nearSign = a < b ? -1 : 1;
      }
      if (Math.max(a, b) < far) {
        far = Math.max(a, b);
        farAxis = axis;
        farSign = a < b ? 1 : -1;
      }
      if (near > far) return;
    }
    const t = near > EPSILON ? near : far,
      axis = near > EPSILON ? nearAxis : farAxis,
      sign = near > EPSILON ? nearSign : farSign;
    if (t <= EPSILON) return;
    const p = add(eye, mul(ray, t)),
      faceNormal =
        axis === 0
          ? mul(along, sign)
          : axis === 1
            ? { x: 0, y: sign, z: 0 }
            : mul(normal, sign);
    return {
      kind: "partition",
      id: wall.id,
      t,
      position: p,
      normal: faceNormal,
      u: dot(sub(p, wall.a), along),
      length: extent,
      wall,
    };
  }
  private colored(
    hit: SurfaceHit,
    kind: WitnessRayHit["kind"],
    material: string,
    reflected: boolean,
  ): WitnessRayHit {
    const color =
      (reflected ? REFLECTED_COLORS : DIRECT_COLORS)[material] ??
      DIRECT_COLORS.plaster;
    return {
      kind,
      objectId: hit.id,
      position: hit.position,
      distance: hit.t,
      color,
      material: (reflected ? "reflected/" : "") + material,
      reflected,
    };
  }
  private paint(hit: SurfaceHit, reflected: boolean): WitnessRayHit {
    const p = hit.position;
    if (hit.kind === "floor") {
      // Parquet is anchored to the public floor, not the screen or the viewer.
      const tileX = Math.floor(p.x / 0.9),
        tileZ = Math.floor(p.z / 0.9),
        turned = mod(tileX + tileZ, 2) > 0;
      const across = mod(turned ? p.z : p.x, 0.9),
        lengthwise = mod(turned ? p.x : p.z, 0.9),
        plank = Math.floor(across / 0.15);
      const seam = mod(across, 0.15) < 0.009 || lengthwise < 0.009;
      const material = seam
        ? "seam"
        : "floor" + Math.floor(mod(tileX * 3 + tileZ + plank, 3));
      return this.colored(hit, "floor", material, reflected);
    }
    if (hit.kind === "ceiling")
      return this.colored(hit, "ceiling", "ceiling", reflected);
    if (hit.kind === "partition") {
      const v = p.y - hit.wall!.bottom,
        u = hit.u ?? 0;
      const frame =
        u < 0.07 ||
        u > (hit.length ?? 0) - 0.07 ||
        v < 0.08 ||
        p.y > hit.wall!.top - 0.08 ||
        Math.abs(hit.normal.y) > 0.5;
      return this.colored(
        hit,
        "partition",
        frame
          ? "trim"
          : dot(hit.normal, { x: -0.6, y: 0.8, z: -0.3 }) > 0
            ? "cloth"
            : "clothShade",
        reflected,
      );
    }
    // Same physical bands as the shipped gallery walls: teal skirting at
    // 0..0.32 m, brass picture rail at 1.02 m and limestone cornice at 3.65 m.
    if (Math.abs(p.y - 1.02) < 0.0275)
      return this.colored(hit, "wall", "frameEdge", reflected);
    if (Math.abs(p.y - 3.65) < 0.065)
      return this.colored(hit, "wall", "ceiling", reflected);
    if (p.y < 0.32)
      return this.colored(hit, "wall", p.y < 0.04 ? "trim" : "dado", reflected);
    return this.colored(
      hit,
      "wall",
      dot(hit.normal, { x: -0.6, y: 0.8, z: -0.3 }) > 0
        ? "plaster"
        : "plasterShade",
      reflected,
    );
  }
  /** Bounded row-run meshes. A static view is reused by object identity; changing
   * a focus target only changes the caller's tangent viewport, never the camera.
   * No scene objects, materials, textures or Lens globals are allocated here. */
  sample(
    viewport: WitnessViewport,
    columns = 64,
    rows = 40,
  ): WitnessBackgroundPlate {
    const values = Object.values(viewport);
    if (
      values.length !== 4 ||
      !values.every(Number.isFinite) ||
      viewport.maxX <= viewport.minX ||
      viewport.maxY <= viewport.minY
    )
      throw new Error("Use a finite ascending witness viewport");
    columns = Math.max(8, Math.min(128, Math.floor(columns)));
    rows = Math.max(8, Math.min(72, Math.floor(rows)));
    if (!Number.isFinite(columns) || !Number.isFinite(rows))
      throw new Error("Use a finite background resolution");
    const key = [
      viewport.minX,
      viewport.maxX,
      viewport.minY,
      viewport.maxY,
      columns,
      rows,
    ].join(":");
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const batches = new Map<string, WitnessBackgroundBatch>(),
      depths = new Float32Array(columns * rows);
    let reflectionCount = 0;
    const dx = (viewport.maxX - viewport.minX) / columns,
      dy = (viewport.maxY - viewport.minY) / rows;
    for (let row = 0; row < rows; row++) {
      let previous: WitnessRayHit | undefined,
        start = 0;
      const emit = (end: number) => {
        if (!previous) return;
        const paletteIndex = WITNESS_BACKGROUND_COLORS.indexOf(previous.color),
          batchKey = "palette:" + paletteIndex;
        let batch = batches.get(batchKey);
        if (!batch) {
          batch = {
            material: batchKey,
            color: previous.color,
            vertices: [],
            indices: [],
            layer: 0,
          };
          batches.set(batchKey, batch);
        }
        const x0 = viewport.minX + start * dx,
          x1 = viewport.minX + end * dx,
          y0 = viewport.minY + row * dy,
          y1 = y0 + dy,
          index = batch.vertices.length;
        const polygon: BackgroundPoint[] = [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ];
        batch.vertices.push(...polygon);
        batch.indices.push(
          index,
          index + 1,
          index + 2,
          index,
          index + 2,
          index + 3,
        );
      };
      for (let column = 0; column < columns; column++) {
        const hit = this.traceTangent(
          viewport.minX + (column + 0.5) * dx,
          viewport.minY + (row + 0.5) * dy,
        );
        depths[row * columns + column] = hit.distance;
        if (hit.reflected) reflectionCount++;
        if (previous && hit.color !== previous.color) {
          emit(column);
          start = column;
        }
        previous = hit;
      }
      emit(columns);
    }
    // An exact projected rim supplements the modest raster field. It cannot
    // disappear between sample centres when a thin wooden edge spans <1 cell.
    for (const rim of this.rims) {
      const polygon = this.clipViewport(rim.polygon, viewport);
      if (polygon.length < 3) continue;
      const key = "rim:" + rim.layer;
      let batch = batches.get(key);
      if (!batch) {
        batch = {
          material: key,
          color: rim.color,
          vertices: [],
          indices: [],
          layer: rim.layer,
        };
        batches.set(key, batch);
      }
      const start = batch.vertices.length;
      batch.vertices.push(...polygon);
      for (let i = 1; i < polygon.length - 1; i++) {
        const a = polygon[0],
          b = polygon[i],
          c = polygon[i + 1],
          cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cross >= 0) batch.indices.push(start, start + i, start + i + 1);
        else batch.indices.push(start, start + i + 1, start + i);
      }
    }
    const plate = {
      viewport: clone(viewport),
      columns,
      rows,
      batches: [...batches.values()],
      depths,
      rayCount: columns * rows,
      reflectionCount,
    };
    this.cache.set(key, plate);
    while (this.cache.size > this.cacheLimit)
      this.cache.delete(this.cache.keys().next().value!);
    return plate;
  }
  clear(): void {
    this.cache.clear();
  }
  private clipViewport(
    input: readonly BackgroundPoint[],
    view: WitnessViewport,
  ): BackgroundPoint[] {
    let polygon = [...input];
    const planes = [
      (p: BackgroundPoint) => p[0] - view.minX,
      (p: BackgroundPoint) => view.maxX - p[0],
      (p: BackgroundPoint) => p[1] - view.minY,
      (p: BackgroundPoint) => view.maxY - p[1],
    ];
    for (const side of planes) {
      const clipped: BackgroundPoint[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length],
          da = side(a),
          db = side(b);
        if (da >= 0) clipped.push(a);
        if (da >= 0 !== db >= 0) {
          const t = da / (da - db);
          clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      polygon = clipped;
    }
    return polygon;
  }
}

const sharedScenes = new Map<string, WitnessBackground>();
/** Shares the static ray field across the entry pane, loupe and recording pins.
 * The key intentionally excludes every track, role, event and current tick. */
export function getWitnessBackground(
  board: Pick<Board, "caseId" | "rev" | "room" | "witnesses">,
  witnessId: string,
  options: WitnessBackgroundOptions = {},
): WitnessBackground {
  const witness = board.witnesses.find((w) => w.id === witnessId);
  const key = JSON.stringify([
    board.caseId,
    board.rev,
    board.room.width,
    board.room.depth,
    board.room.walls,
    board.room.mirror,
    witness,
    options,
  ]);
  let scene = sharedScenes.get(key);
  if (scene) {
    sharedScenes.delete(key);
    sharedScenes.set(key, scene);
    return scene;
  }
  scene = new WitnessBackground(board, witnessId, options);
  sharedScenes.set(key, scene);
  while (sharedScenes.size > 4)
    sharedScenes.delete(sharedScenes.keys().next().value!);
  return scene;
}
