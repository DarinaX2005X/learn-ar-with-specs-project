import { Board, Field, History, Vec3, Wall } from "../Domain/types";
import { poseAt } from "../Domain/geometry";

export interface ComparisonFocus {
  centre: { x: number; z: number };
  width: number;
  depth: number;
  scale: number;
}
/** A matched cutaway around the public action in two already-authorized histories.
 * It changes presentation only. Full histories and their timing stay intact. */
export function comparisonFocusWindow(
  board: Board,
  pair: readonly [History, History],
  field: Field,
): ComparisonFocus {
  const points: Vec3[] = [];
  if (field === "recipient" || field === "passTick") {
    for (const history of pair) {
      if (!history.pass) continue;
      for (const id of [history.pass.from, history.pass.to]) {
        const track = board.tracks.find(candidate => candidate.id === id)!;
        points.push(poseAt(track, history.pass.tick));
      }
    }
  } else if (field === "cache" || field === "stashTick") {
    for (const history of pair) {
      const box = board.room.boxes?.find(candidate => candidate.id === history.stash?.box);
      if (box) points.push(box.position);
      else {
        const track = board.tracks.find(candidate => candidate.id === (history.pass?.to ?? history.take))!;
        points.push(poseAt(track, 24));
      }
    }
  }
  if (!points.length) points.push(board.room.exhibit.position);
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minZ = Math.min(...points.map(point => point.z));
  const maxZ = Math.max(...points.map(point => point.z));
  const width = Math.max(1.4, maxX - minX + 0.6);
  const depth = Math.max(1.4, maxZ - minZ + 0.6);
  return {
    centre: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    width, depth,
    scale: Math.min(0.2, 28 / (width * 100), 32 / (depth * 100)),
  };
}
export function insideComparisonWindow(focus: ComparisonFocus, x: number, z: number): boolean {
  return Math.abs(x - focus.centre.x) <= focus.width / 2 &&
    Math.abs(z - focus.centre.z) <= focus.depth / 2;
}
/** Liang–Barsky clipping of the public wall's centreline, never its source board. */
export function clipComparisonWall(focus: ComparisonFocus, wall: Wall): [Vec3, Vec3] | undefined {
  let low = 0, high = 1;
  const dx = wall.b.x - wall.a.x, dz = wall.b.z - wall.a.z;
  const half = [focus.width / 2, focus.depth / 2];
  const origin = [wall.a.x - focus.centre.x, wall.a.z - focus.centre.z];
  const direction = [dx, dz];
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(direction[axis]) < 1e-10) {
      if (Math.abs(origin[axis]) > half[axis]) return undefined;
      continue;
    }
    const first = (-half[axis] - origin[axis]) / direction[axis];
    const last = (half[axis] - origin[axis]) / direction[axis];
    low = Math.max(low, Math.min(first, last));
    high = Math.min(high, Math.max(first, last));
    if (low >= high) return undefined;
  }
  const point = (t: number): Vec3 => ({ x: wall.a.x + dx * t, y: wall.a.y, z: wall.a.z + dz * t });
  return [point(low), point(high)];
}
