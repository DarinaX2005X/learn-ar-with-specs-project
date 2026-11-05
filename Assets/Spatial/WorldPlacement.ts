import { Board } from "../Domain/types";
import { clear } from "../Domain/geometry";
import { Point } from "./ArmIK";
/** Story centimetres. MuseumBuilding GLB is metres; import root scale100.
 * The hall shares the Domain coordinate frame, never a second scaled table.
 */
export const BUILDING = {
  hall: { min: [0, 0] as const, max: [700, 500] as const },
  entrance: { min: [0, -500] as const, max: [700, 0] as const },
  workshop: { min: [-500, 0] as const, max: [0, 500] as const },
  archive: { min: [-500, -500] as const, max: [0, 0] as const },
  heightCm: 380,
  mainDoor: { axis: "z", at: 0, min: 230, max: 470 },
  workshopDoor: { axis: "x", at: 0, min: 150, max: 350 },
} as const;
export type BuildingPlace = "entrance" | "hall" | "workshop" | "archive";
export interface WalkStop {
  place: BuildingPlace;
  headCm: Point;
  cameraYawRad: number;
}
/** Lens camera identity faces -Z. These are head destinations, not model roots. */
export function buildingStops(
  eyeHeightCm = 165,
): Record<BuildingPlace, WalkStop> {
  if (!Number.isFinite(eyeHeightCm) || eyeHeightCm < 75 || eyeHeightCm > 220)
    throw new Error("Use a supported eye height");
  return {
    entrance: {
      place: "entrance",
      headCm: [450, eyeHeightCm, -340],
      cameraYawRad: Math.PI,
    },
    hall: {
      place: "hall",
      headCm: [350, eyeHeightCm, 110],
      cameraYawRad: Math.PI,
    },
    archive: {
      place: "archive",
      headCm: [-250, eyeHeightCm, -250],
      cameraYawRad: -Math.PI / 2,
    },
    workshop: {
      place: "workshop",
      headCm: [-230, eyeHeightCm, 250],
      cameraYawRad: -Math.PI / 2,
    },
  };
}
export interface BuildingAnchor {
  originCm: Point;
  yawRad: number;
}
function turn(p: Point, yaw: number): Point {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s];
}
export function toBuildingWorld(p: Point, anchor: BuildingAnchor): Point {
  const q = turn(p, anchor.yawRad);
  return [
    q[0] + anchor.originCm[0],
    q[1] + anchor.originCm[1],
    q[2] + anchor.originCm[2],
  ];
}
/** Move the building once on initial placement so the tracked viewer stays put.
 * This function never writes to a camera. Keep this anchor for all gameplay.
 */
export function buildingAnchorForViewer(
  headWorldCm: Point,
  cameraYawRad: number,
  eyeHeightCm = 165,
  entryStop?: WalkStop,
): BuildingAnchor {
  const entry = entryStop ?? buildingStops(eyeHeightCm).entrance,
    yawRad = cameraYawRad - entry.cameraYawRad,
    offset = turn(entry.headCm, yawRad);
  return {
    originCm: [
      headWorldCm[0] - offset[0],
      headWorldCm[1] - offset[1],
      headWorldCm[2] - offset[2],
    ],
    yawRad,
  };
}
/** Safe navigation polyline crosses actual doorway centres and remains in the
 * same connected building. It does not change any case, clock or evidence state.
 */
export function accessibleRoute(
  from: BuildingPlace,
  to: BuildingPlace,
  eyeHeightCm = 165,
): Point[] {
  const stops = buildingStops(eyeHeightCm);
  if (from === to) return [];
  const hall: Point = [350, eyeHeightCm, 250],
    main: Point = [350, eyeHeightCm, 0],
    work: Point = [0, eyeHeightCm, 250];
  const eastRear: Point = [350, eyeHeightCm, 470];
  const westRear: Point = [80, eyeHeightCm, 470];
  const westDoor: Point = [80, eyeHeightCm, 250];
  const archiveDoor: Point = [-250, eyeHeightCm, 0];
  const archiveEntryDoor: Point = [0, eyeHeightCm, -250];
  const entryWest: Point = [350, eyeHeightCm, -250];
  if (from === "archive") {
    if (to === "workshop") return [archiveDoor, stops.workshop.headCm];
    const entry = [archiveEntryDoor, entryWest, stops.entrance.headCm];
    return to === "entrance"
      ? entry
      : [...entry, ...accessibleRoute("entrance", to, eyeHeightCm)];
  }
  if (to === "archive") {
    if (from === "entrance")
      return [entryWest, archiveEntryDoor, stops.archive.headCm];
    const workshop =
      from === "workshop" ? [] : accessibleRoute(from, "workshop", eyeHeightCm);
    return [...workshop, archiveDoor, stops.archive.headCm];
  }
  const points: Point[] = [];
  // The shipped case screens end by Z440 and begin at X145 or farther east.
  // Follow the rear and west circulation strips rather than crossing a screen.
  if (from === "entrance") points.push(main, stops.hall.headCm);
  if (from === "workshop")
    points.push(work, westDoor, westRear, eastRear, stops.hall.headCm);
  if (to === "entrance") points.push(main, stops.entrance.headCm);
  else if (to === "workshop")
    points.push(eastRear, westRear, westDoor, work, stops.workshop.headCm);
  else if (from !== "entrance") points.push(stops.hall.headCm);
  return points;
}
export interface BuildingNavigationPorts {
  /** Explicit seated navigation only. Physical walking never calls this. */
  moveViewerAlong(
    pointsWorldCm: readonly Point[],
    finalCameraYawRad: number,
  ): void;
  setContextAction(
    place: BuildingPlace,
    label: string,
    target: BuildingPlace,
  ): void;
}
export class BuildingNavigation {
  private place: BuildingPlace = "entrance";
  constructor(
    private anchor: BuildingAnchor,
    private ports: BuildingNavigationPorts,
    private eyeHeightCm = 165,
  ) {
    this.showActions();
  }
  /** Call when tracked head naturally crosses a room threshold. No relocation. */
  observeLocalHead(head: Point): void {
    const [x, , z] = head;
    const next: BuildingPlace =
      x < 0 ? (z < 0 ? "archive" : "workshop") : z < 0 ? "entrance" : "hall";
    if (next !== this.place) {
      this.place = next;
      this.showActions();
    }
  }
  moveTo(target: BuildingPlace): void {
    const points = accessibleRoute(this.place, target, this.eyeHeightCm);
    if (!points.length) return;
    const stop = buildingStops(this.eyeHeightCm)[target];
    this.ports.moveViewerAlong(
      points.map((p) => toBuildingWorld(p, this.anchor)),
      stop.cameraYawRad + this.anchor.yawRad,
    );
    this.place = target;
    this.showActions();
  }
  currentPlace(): BuildingPlace {
    return this.place;
  }
  private showActions(): void {
    if (this.place === "entrance")
      this.ports.setContextAction(this.place, "Move into the museum", "hall");
    else if (this.place === "hall")
      this.ports.setContextAction(
        this.place,
        "Move to the workshop",
        "workshop",
      );
    else if (this.place === "workshop")
      this.ports.setContextAction(this.place, "Move to the archive", "archive");
    else
      this.ports.setContextAction(
        this.place,
        "Return to the entrance",
        "entrance",
      );
  }
}
/** Resolve the arrival from actual case geometry. Tests include centre and eight
 * display edges at human eye height, plus the physical main-door jambs. Changes
 * to the exhibit or screens can change the preferred entry without changing the
 * authoritative witness or recorded camera. Returns undefined when no tested
 * arrival can see the object, instead of promising a visible ruby. */
export function visibleEntry(
  board: Board,
  eyeHeightCm = 165,
): WalkStop | undefined {
  const exhibit = board.room.exhibit.position;
  const targets = [];
  for (const dx of [-0.12, 0, 0.12])
    for (const dy of [-0.08, 0, 0.08])
      targets.push({ x: exhibit.x + dx, y: exhibit.y + dy, z: exhibit.z });
  for (const x of [450, 425, 400, 375, 350, 325, 300]) {
    const eye = { x: x / 100, y: eyeHeightCm / 100, z: -3.4 };
    if (
      !targets.every((target) => {
        const f = -eye.z / (target.z - eye.z),
          doorX = (eye.x + (target.x - eye.x) * f) * 100;
        return (
          doorX > BUILDING.mainDoor.min + 15 &&
          doorX < BUILDING.mainDoor.max - 15 &&
          clear(eye, target, board.room.walls)
        );
      })
    )
      continue;
    return {
      place: "entrance",
      headCm: [x, eyeHeightCm, -340],
      cameraYawRad: Math.atan2(eye.x - exhibit.x, eye.z - exhibit.z),
    };
  }
  return undefined;
}

