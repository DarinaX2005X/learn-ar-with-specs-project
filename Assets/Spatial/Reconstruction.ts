import { Board, History, Track, TrackId, Vec3, Field, Verdict } from "../Domain/types";
import { sampleContactPose } from "../Domain/ContactPose";
import { answer } from "../Domain/observe";
import { ActorPose, WorldView } from "../Scripts/TableKit/TableKit";
const tuple = (p: Vec3): [number, number, number] => [
  p.x * 100,
  p.y * 100,
  p.z * 100,
];
export interface ActionPose {
  track: TrackId;
  handCm: readonly [number, number, number];
  grip: number;
}
export interface ReconstructionView extends WorldView {
  hands: ActionPose[];
  cache?: string;
  nestEmpty: boolean;
}
/** A stride follows the distance walked on this route. Sampling an integer
 * recording tick or stepping backwards produces the same planted foot. */
export function gaitAt(track: Track, tick: number): number {
  let distanceM = 0;
  for (let i = 1; i < track.keys.length; i++) {
    const start = track.keys[i - 1], end = track.keys[i];
    const segmentM = Math.hypot(end.x - start.x, end.z - start.z);
    if (tick >= end.tick) {
      distanceM += segmentM;
      continue;
    }
    if (tick < start.tick || segmentM === 0) return 0;
    distanceM += segmentM * (tick - start.tick) / (end.tick - start.tick);
    const strideM = 0.85;
    return Math.sin(distanceM * 2 * Math.PI / strideM) * 0.25;
  }
  return 0;
}
/** Pure sample in story centimetres. Root scales to .06 for the table or 1 for room scale.
 * The marker in Domain is head height; imported role mesh origin is floor height.
 * Hand targets use the same action contact point on both partners, never a flying ruby.
 */
export function renderHistory(
  board: Board,
  h: History,
  tick: number,
): ReconstructionView {
  const { tick: t, positions, hands, ruby, taken, stashed, carrier, cache } = sampleContactPose(board, h, tick);
  const actors: ActorPose[] = board.tracks.map((track) => {
    const p = positions.get(track.id)!;
    const gait = gaitAt(track, t);
    return {
      role: h.casting[track.id],
      positionCm: [p.x * 100, (p.y - 1) * 100, p.z * 100],
      yawRad: p.yaw,
      joints: {
        Hip_L: [gait, 0, 0],
        Hip_R: [-gait, 0, 0],
        Knee_L: [Math.max(0, -gait), 0, 0],
        Knee_R: [Math.max(0, gait), 0, 0],
      },
    };
  });
  return {
    kind: "world",
    revision: board.caseId + ":" + board.rev,
    actors,
    aperture: board.room.mirror?.aperture ?? 0,
    ruby: { positionCm: tuple(ruby), visible: !stashed },
    hands: board.tracks.map((track) => ({
      track: track.id,
      handCm: tuple(hands.get(track.id)!),
      grip: taken && !stashed && track.id === carrier ? 1 : 0,
    })),
    cache,
    nestEmpty: taken,
  };
}
export function compatiblePair(
  board: Board,
  v: Verdict,
  field: Field,
): [History, History] | undefined {
  const histories =
    v.examplesByField[field] ??
    Object.values(v.examplesByCulprit).filter((h): h is History => !!h);
  for (let i = 0; i < histories.length; i++)
    for (let j = i + 1; j < histories.length; j++)
      if (
        answer(board, histories[i], field) !==
        answer(board, histories[j], field)
      )
        return [histories[i], histories[j]];
  return undefined;
}
/** Cache clues have no event time. Focus on final inspection instead. */
export function comparisonFocus(
  board: Board,
  pair: [History, History],
  field: Field,
): { tick: number; inspection: boolean } {
  if (field === "cache") return { tick: 24, inspection: true };
  if (field === "recipient")
    return {
      tick: Math.min(pair[0].pass?.tick ?? 24, pair[1].pass?.tick ?? 24),
      inspection: false,
    };
  return { tick: board.alarmTick, inspection: false };
}
