import { Board, Fragment } from "../../Domain/types";
import { poseAt, sight } from "../../Domain/geometry";
import { projectVisibleSurface } from "../../Domain/projectSurface";
export interface RecordingOptics {
  centerX: number;
  centerY: number;
  gain: number;
}
/** A public, identity-free camera calibration envelope, including a collar.
 * It encloses every shipped head/costume proxy without choosing a casting. */
export const RECORDING_ENVELOPE: readonly (readonly [number, number])[] = [
  [-0.25, -0.52],
  [0.25, -0.52],
  [0.25, -0.25],
  [0.18, 0.25],
  [-0.18, 0.25],
  [-0.25, -0.25],
];
const calibrated = new Map<string, RecordingOptics>();
/** Stable through playback, recognition and aperture changes. Nominal full
 * mirror is used only to choose the physical optical crop, never to emit ink. */
export function stableRecordingOptics(
  board: Board,
  witnessId: string,
): RecordingOptics {
  const witness = board.witnesses.find((w) => w.id === witnessId);
  if (!witness) return { centerX: 0, centerY: 0, gain: 8 };
  const mirror = board.room.mirror
    ? { ...board.room.mirror, aperture: 1 }
    : undefined;
  const room = { ...board.room, mirror };
  const key = JSON.stringify([
    room.width,
    room.depth,
    room.walls,
    mirror,
    witness,
    board.tracks,
  ]);
  const cached = calibrated.get(key);
  if (cached) return { ...cached };
  const nominal: Board = { ...board, room };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const track of board.tracks)
    for (let tick = 0; tick <= 24; tick++) {
      const pose = poseAt(track, tick);
      for (const via of ["direct", "mirror"] as const) {
        const fragment: Fragment = {
          position: { x: pose.x, y: pose.y, z: pose.z },
          surfaceRight: { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) },
          projection: { horizontal: 0, vertical: 0 },
          via,
          segment: "optical-calibration",
        };
        if (!sight(nominal, witness, fragment.position, via)) continue;
        const triangles = projectVisibleSurface(
          nominal,
          witnessId,
          fragment,
          RECORDING_ENVELOPE,
        );
        for (const triangle of triangles)
          for (const point of triangle) {
            const x = Math.tan(point.horizontal),
              y = Math.tan(point.vertical) * Math.sqrt(1 + x * x);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
      }
    }
  let result: RecordingOptics;
  if (!Number.isFinite(minX)) {
    const h = Math.tan(Math.min(witness.fov / 2, (Math.PI * 5) / 12)),
      v = Math.tan(
        Math.min(
          (witness.verticalFov ?? Math.PI * 0.8) / 2,
          (Math.PI * 5) / 12,
        ),
      );
    result = {
      centerX: 0,
      centerY: 0,
      gain: Math.min(160, 16 / Math.max(0.01, h), 8 / Math.max(0.01, v)),
    };
  } else
    result = {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      gain: Math.min(
        160,
        31 / Math.max(0.001, maxX - minX),
        15 / Math.max(0.001, maxY - minY),
      ),
    };
  calibrated.set(key, result);
  while (calibrated.size > 8)
    calibrated.delete(calibrated.keys().next().value!);
  return { ...result };
}
