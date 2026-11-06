import { Board, Vec3 } from "../Domain/types";
import { clear } from "../Domain/geometry";
import { Placement } from "./SpatialStage";
import { CaseViewViewer } from "./CaseViewRouting";

/** Only registered original objects remain usable in the room. */
export function roomActionAllowed(id: string): boolean {
  return (
    id.startsWith("CaseView") ||
    id.startsWith("WorkshopClock") ||
    id === "PinGlass" ||
    id === "LoupeDetail" ||
    id.startsWith("Observation_")
  );
}
export function entryPitch(viewer: CaseViewViewer): number {
  return Math.atan2(
    viewer.forward[1],
    Math.hypot(viewer.forward[0], viewer.forward[2]),
  );
}
/** Raised existing frame. Stable after its first explicit open action. */
export function raisedChoice(
  viewer: CaseViewViewer,
  pitch = (-13 * Math.PI) / 180,
): Placement {
  const horizontal = Math.hypot(viewer.forward[0], viewer.forward[2]);
  return {
    originCm: [
      viewer.eyeCm[0] + (viewer.forward[0] / horizontal) * 80,
      viewer.eyeCm[1] + Math.tan(pitch) * 80,
      viewer.eyeCm[2] + (viewer.forward[2] / horizontal) * 80,
    ],
    scale: 1,
    yawRad: Math.atan2(viewer.forward[0], viewer.forward[2]),
  };
}
export interface RoomTools {
  source: Placement;
  clock: Placement;
  handles: Placement;
}
/** Tools remain original physical objects, in peripheral angular slots. Camera
 * FOV comes from actual projection rays; no witness optics are used as display FOV. */
export function roomTools(
  viewer: CaseViewViewer,
  board?: Board,
  stage?: Placement,
): RoomTools | undefined {
  const horizontal = Math.hypot(viewer.forward[0], viewer.forward[2]);
  const yaw = Math.atan2(viewer.forward[0], viewer.forward[2]);
  const pitch = entryPitch(viewer);
  const horizontalFov = viewer.horizontalFovRad ?? Math.PI / 2;
  const verticalFov = viewer.verticalFovRad ?? Math.PI / 3;
  const initialDistance = Math.max(140, 20 / Math.tan(horizontalFov * 0.14));
  const floor = viewer.floorYcm ?? viewer.eyeCm[1] - 155;
  const toStory = (point: readonly number[]): Vec3 => {
    const placement = stage!;
    const x = (point[0] - placement.originCm[0]) / 100;
    const z = (point[2] - placement.originCm[2]) / 100;
    const cosine = Math.cos(placement.yawRad), sine = Math.sin(placement.yawRad);
    return { x: cosine * x - sine * z,
      y: (point[1] - placement.originCm[1]) / 100,
      z: sine * x + cosine * z };
  };
  // One compact vertical assembly, never a bridge across the disputed action.
  // The original pane, clock and handles keep their original registered targets.
  for (const distance of [initialDistance, 110, 85]) {
    for (const side of [-1, 1]) {
      const heading = yaw + side * horizontalFov * 0.33;
      const elevation = pitch - 0.12 * verticalFov;
      const centre: [number, number, number] = [
        viewer.eyeCm[0] + Math.sin(heading) * distance * Math.cos(elevation),
        Math.max(floor + 70, viewer.eyeCm[1] + Math.sin(elevation) * distance),
        viewer.eyeCm[2] + Math.cos(heading) * distance * Math.cos(elevation),
      ];
      const place = (height: number): Placement => ({
        originCm: [centre[0], centre[1] + height, centre[2]], scale: 1, yawRad: heading,
      });
      const tools = { source: place(45), clock: place(12), handles: place(-30) };
      if (!board || !stage) return tools;
      const eye = toStory(viewer.eyeCm);
      const corners: Vec3[] = [];
      for (const x of [-24, 24]) for (const z of [-13, 13]) {
        const cosine = Math.cos(heading), sine = Math.sin(heading);
        for (const height of [floor + 8, centre[1] + 62]) {
          corners.push(toStory([centre[0] + x * cosine + z * sine, height,
            centre[2] + z * cosine - x * sine]));
        }
      }
      const insideFloor = corners.every(point => point.x >= 0.1 && point.z >= 0.1 &&
        point.x <= board.room.width - 0.1 && point.z <= board.room.depth - 0.1);
      const unobstructed = corners.every(point => clear(eye, point, board.room.walls));
      const footprintClear = corners.every((point, index) => corners.every((other, otherIndex) =>
        index >= otherIndex || clear(point, other, board.room.walls)));
      // Public exhibit geometry only: keep the compact stand clear of the
      // exhibit and the visitor's sightline to its hand-height centre.
      const exhibit = board.room.exhibit.position;
      const standCentre = toStory(centre);
      const rayX = exhibit.x - eye.x, rayZ = exhibit.z - eye.z;
      const rayLengthSquared = rayX * rayX + rayZ * rayZ;
      const along = rayLengthSquared ? Math.max(0, Math.min(1,
        ((standCentre.x - eye.x) * rayX + (standCentre.z - eye.z) * rayZ) / rayLengthSquared)) : 0;
      const rayClearance = Math.hypot(standCentre.x - eye.x - along * rayX,
        standCentre.z - eye.z - along * rayZ);
      if (insideFloor && unobstructed && footprintClear && rayClearance > 0.38 &&
        Math.hypot(standCentre.x - exhibit.x, standCentre.z - exhibit.z) > 0.65) return tools;
    }
  }
  // Impossible custom-room geometry does not invent a wall-free source station.
  // The route retains its existing near Back/Close grips and the full-size view.
  return undefined;
}
