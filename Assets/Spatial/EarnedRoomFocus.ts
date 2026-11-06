import {
  earnedEventVisibility,
  clearEarnedActorView,
  earnedHandSideScore,
} from "./EarnedEventVisibility";
import { Board, History, Field, TrackId, Vec3 } from "../Domain/types";
import { sampleContactPose } from "../Domain/ContactPose";
import { clear } from "../Domain/geometry";
import { comparisonFocusWindow } from "../Runtime/ComparisonFocus";

export interface EarnedRoomAnchor {
  eye: Vec3;
  yaw: number;
  mode: "event" | "overview";
}
type ContactSample = ReturnType<typeof sampleContactPose>;

const STORY_EYE_HEIGHT = 1.6;
const MIN_VIEW_DISTANCE = 1.5;
const MIN_PARTICIPANT_DISTANCE = 0.8;
const MAX_VIEW_DISTANCE = 5;
const ROOM_EDGE_MARGIN = 0.25;
const EVENT_FRAMING_RADIUS_TICKS = 0.75;
// CaseViewViewer exposes no display FOV. This conservative content angle is a
// framing policy, not the witness's recording FOV or a measured headset FOV.
const CONTENT_HALF_ANGLE = Math.PI / 6;

function eventTime(
  board: Board,
  history: History,
  field: Field,
): number | undefined {
  switch (field) {
    case "recipient":
    case "passTick":
      return history.pass?.tick;
    case "cache":
    case "stashTick":
      return history.stash?.tick;
    default:
      return board.alarmTick;
  }
}

function participantIds(
  history: History,
  sample: ContactSample,
  field: Field,
): TrackId[] {
  switch (field) {
    case "recipient":
    case "passTick":
      if (history.pass) return [history.pass.from, history.pass.to];
      return [sample.carrier ?? history.take];
    case "cache":
    case "stashTick":
      return [history.stash?.carrier ?? sample.carrier ?? history.take];
    default:
      return [history.take];
  }
}

function hasReferencedGeometry(board: Board, history: History): boolean {
  const referencedTracks = [
    history.take,
    ...history.brushes.map((brush) => brush.track),
  ];
  if (history.pass) referencedTracks.push(history.pass.from, history.pass.to);
  const stash = history.stash;
  if (stash) {
    referencedTracks.push(stash.carrier);
    if (!board.room.boxes?.some((box) => box.id === stash.box)) return false;
  }
  return referencedTracks.every((id) =>
    board.tracks.some((track) => track.id === id && track.keys.length > 0),
  );
}

function collectFocusPoints(
  board: Board,
  pair: readonly [History, History],
  samples: ContactSample[],
  field: Field,
  activeEvent: boolean,
): Vec3[] | undefined {
  if (!activeEvent) {
    const points = [board.room.exhibit.position];
    for (const sample of samples) points.push(...sample.positions.values());
    if (field === "cache" || field === "stashTick") {
      points.push(...(board.room.boxes ?? []).map((box) => box.position));
    }
    return points;
  }

  const focus = comparisonFocusWindow(board, pair, field);
  const points: Vec3[] = [{ x: focus.centre.x, y: 1, z: focus.centre.z }];
  for (let index = 0; index < pair.length; index++) {
    const sample = samples[index];
    for (const trackId of participantIds(pair[index], sample, field)) {
      const position = sample.positions.get(trackId);
      const hand = sample.hands.get(trackId);
      if (!position || !hand) return undefined;
      points.push(position, hand);
    }
  }
  return points;
}

/** Presentation only; caller supplies the already authorized pair. No vault/tape input.
 * Invalid referenced geometry falls back explicitly; unexpected errors are not swallowed.
 */
export function earnedRoomAnchor(
  board: Board,
  pair: readonly [History, History],
  field: Field,
  tick: number,
  witnessYaw: number,
  eyeHeightMetres = STORY_EYE_HEIGHT,
  displayHorizontalFov?: number,
): EarnedRoomAnchor | undefined {
  if (
    !Number.isFinite(tick) ||
    tick < 0 ||
    tick > 24 ||
    !Number.isFinite(witnessYaw) ||
    pair.length !== 2 ||
    !board.fields.includes(field)
  )
    return undefined;
  if (
    !Number.isFinite(eyeHeightMetres) ||
    eyeHeightMetres < 0.75 ||
    eyeHeightMetres > 2.2
  )
    return undefined;
  if (!pair.every((history) => hasReferencedGeometry(board, history)))
    return undefined;

  const samples = pair.map((history) =>
    sampleContactPose(board, history, tick),
  );
  // Near-event framing never changes the contact animation or seeks the clock.
  const activeEvent = pair.some((history) => {
    const time = eventTime(board, history, field);
    return (
      time !== undefined && Math.abs(time - tick) <= EVENT_FRAMING_RADIUS_TICKS
    );
  });
  const points = collectFocusPoints(board, pair, samples, field, activeEvent);
  if (
    !points?.length ||
    points.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))
  ) {
    return undefined;
  }

  const centreX =
    (Math.min(...points.map((point) => point.x)) +
      Math.max(...points.map((point) => point.x))) /
    2;
  const centreZ =
    (Math.min(...points.map((point) => point.z)) +
      Math.max(...points.map((point) => point.z))) /
    2;
  // Preserve witness-relative horizontal orientation first. Other quadrants only
  // avoid public walls or room bounds; no geometry is removed to force a view.
  const eventViews = activeEvent
    ? pair.map((history) => earnedEventVisibility(board, history, field, tick))
    : [];
  // Test progressively different azimuths around this event, in shared geometry.
  // Existing witness orientation wins only if both bodies leave the action clear.
  const yawOffsets = activeEvent
    ? [0]
    : [0, Math.PI / 2, -Math.PI / 2, Math.PI];
  if (activeEvent) {
    for (let step = 1; step < 12; step++) {
      yawOffsets.push((step * Math.PI) / 12, (-step * Math.PI) / 12);
    }
    yawOffsets.push(Math.PI);
  }
  let bestAnchor: EarnedRoomAnchor | undefined;
  let bestHandSide = -Infinity;
  for (const yawOffset of yawOffsets) {
    const yaw = witnessYaw + yawOffset;
    const forwardX = Math.sin(yaw),
      forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw),
      rightZ = -Math.sin(yaw);
    const halfWidth = Math.max(
      ...points.map((point) =>
        Math.abs((point.x - centreX) * rightX + (point.z - centreZ) * rightZ),
      ),
    );
    const nearDepth = Math.max(
      ...points.map(
        (point) =>
          -(point.x - centreX) * forwardX - (point.z - centreZ) * forwardZ,
      ),
    );
    const viewDistance = Math.max(
      MIN_VIEW_DISTANCE,
      nearDepth + MIN_PARTICIPANT_DISTANCE,
      halfWidth /
        Math.tan(
          displayHorizontalFov === undefined
            ? CONTENT_HALF_ANGLE
            : Math.min(CONTENT_HALF_ANGLE, displayHorizontalFov * 0.3),
        ) +
        nearDepth,
    );
    if (viewDistance > MAX_VIEW_DISTANCE) continue;
    const eye = {
      x: centreX - forwardX * viewDistance,
      y: eyeHeightMetres,
      z: centreZ - forwardZ * viewDistance,
    };
    if (
      eye.x < ROOM_EDGE_MARGIN ||
      eye.z < ROOM_EDGE_MARGIN ||
      eye.x > board.room.width - ROOM_EDGE_MARGIN ||
      eye.z > board.room.depth - ROOM_EDGE_MARGIN
    )
      continue;
    // Use the exact finite-wall, height, endpoint and collinear semantics used by
    // public observation. Boundary contacts are opaque, including at either end.
    const wallsClear = points.every((point) =>
      clear(eye, point, board.room.walls),
    );
    const actorsClear = eventViews.every((view) =>
      clearEarnedActorView(eye, view),
    );
    if (wallsClear && actorsClear) {
      const candidate: EarnedRoomAnchor = {
        eye,
        yaw,
        mode: activeEvent ? "event" : "overview",
      };
      if (!activeEvent) return candidate;
      const handSide = earnedHandSideScore(eye, eventViews);
      if (handSide > bestHandSide) {
        bestHandSide = handSide;
        bestAnchor = candidate;
      }
    }
  }
  return bestAnchor;
}
