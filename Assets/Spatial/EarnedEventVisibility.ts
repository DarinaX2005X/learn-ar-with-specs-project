import { Board, History, Field, Vec3 } from "../Domain/types";
import { sampleContactPose, HandArticulation } from "../Domain/ContactPose";
import { compilePlantedGait, samplePlantedGait } from "./PlantedGait";
import { LensArmAdapter, Point, Rotation, SHIPPED_RIGHT_ARM } from "./ArmIK";
import { EARNED_ACTOR_BOUNDS } from "./EarnedActorBounds";

interface ActorVolume {
  origin: Vec3;
  yaw: number;
  boxes: ReadonlyArray<{
    readonly min: readonly number[];
    readonly max: readonly number[];
  }>;
}
export interface EarnedEventVisibility {
  targets: Vec3[];
  actors: ActorVolume[];
  handSides: Array<{ shoulder: Vec3; hand: Vec3 }>;
}

/** Replay the existing pure adapter against data-only sinks to get the same
 * upper-body lean used by ComparisonHall. This creates no SceneObject/input. */
function bodyLean(
  positionCm: Point,
  yawRad: number,
  handCm: Point,
  articulation: HandArticulation,
): Point {
  const node = {
    getTransform: () => ({
      setLocalPosition(_value: Point) {},
      setLocalRotation(_value: Rotation) {},
    }),
  };
  const adapter = new LensArmAdapter(
    { upperBody: node, shoulder: node, elbow: node, wrist: node },
    {
      vector: (x, y, z): Point => [x, y, z],
      quaternion: (x, y, z, w): Rotation => [x, y, z, w],
    },
  );
  return adapter.apply({ positionCm, yawRad }, handCm, articulation)
    .upperBodyOffset;
}

export function earnedEventVisibility(
  board: Board,
  history: History,
  field: Field,
  tick: number,
): EarnedEventVisibility {
  const sample = sampleContactPose(board, history, tick);
  let participants = [history.take];
  if (field === "recipient" || field === "passTick") {
    participants = history.pass
      ? [history.pass.from, history.pass.to]
      : [sample.carrier ?? history.take];
  } else if (field === "cache" || field === "stashTick") {
    participants = [history.stash?.carrier ?? sample.carrier ?? history.take];
  }
  const targets = participants.map((id) => sample.hands.get(id)!);
  targets.push(sample.ruby);
  if (field === "taker" || field === "takeTick")
    targets.push(board.room.exhibit.position);
  const actors = board.tracks.map((track) => {
    const position = sample.positions.get(track.id)!;
    const gait = samplePlantedGait(compilePlantedGait(track), tick);
    const yaw = gait.bodyYaw + Math.PI;
    const cosine = Math.cos(yaw),
      sine = Math.sin(yaw);
    const floor = { x: position.x, y: position.y - 1, z: position.z };
    const gaitOffset = gait.upperBodyOffsetCm;
    const basis: Point = [
      floor.x * 100 + cosine * gaitOffset[0] + sine * gaitOffset[2],
      floor.y * 100 + gaitOffset[1],
      floor.z * 100 - sine * gaitOffset[0] + cosine * gaitOffset[2],
    ];
    const hand = sample.hands.get(track.id)!;
    const lean = bodyLean(
      basis,
      yaw,
      [hand.x * 100, hand.y * 100, hand.z * 100],
      sample.articulation.get(track.id)!,
    );
    // Adapter offsets are tabletop cm: 6 tabletop cm equal 1 story metre.
    const localX = gaitOffset[0] / 100 + lean[0] / 6;
    const localY = gaitOffset[1] / 100 + lean[1] / 6;
    const localZ = gaitOffset[2] / 100 + lean[2] / 6;
    return {
      yaw,
      boxes: EARNED_ACTOR_BOUNDS[history.casting[track.id]],
      origin: {
        x: floor.x + cosine * localX + sine * localZ,
        y: floor.y + localY,
        z: floor.z - sine * localX + cosine * localZ,
      },
    };
  });
  const handSides = participants.map((id) => {
    const actor = actors[board.tracks.findIndex((track) => track.id === id)];
    const shoulder = SHIPPED_RIGHT_ARM.shoulder;
    const cosine = Math.cos(actor.yaw),
      sine = Math.sin(actor.yaw);
    return {
      hand: sample.hands.get(id)!,
      shoulder: {
        x: actor.origin.x + (cosine * shoulder[0] + sine * shoulder[2]) / 6,
        y: actor.origin.y + shoulder[1] / 6,
        z: actor.origin.z + (-sine * shoulder[0] + cosine * shoulder[2]) / 6,
      },
    };
  });
  return { targets, actors, handSides };
}

/** Conservative rigid-mesh bounds, not a pixel/complete articulated silhouette proof. */
export function clearEarnedActorView(
  eye: Vec3,
  visibility: EarnedEventVisibility,
): boolean {
  for (const target of visibility.targets) {
    for (const actor of visibility.actors) {
      const cosine = Math.cos(actor.yaw),
        sine = Math.sin(actor.yaw);
      const local = (point: Vec3) => {
        const x = point.x - actor.origin.x,
          z = point.z - actor.origin.z;
        return [
          cosine * x - sine * z,
          point.y - actor.origin.y,
          sine * x + cosine * z,
        ];
      };
      const start = local(eye),
        end = local(target);
      for (const box of actor.boxes) {
        let enter = 0,
          leave = 1;
        // 3cm expands rigid volumes so a grazing centre-ray does not pass as a useful view.
        for (let axis = 0; axis < 3; axis++) {
          const minimum = box.min[axis] - 0.03,
            maximum = box.max[axis] + 0.03;
          const direction = end[axis] - start[axis];
          if (Math.abs(direction) < 1e-9) {
            if (start[axis] < minimum || start[axis] > maximum) {
              enter = 2;
              break;
            }
          } else {
            const first = (minimum - start[axis]) / direction,
              last = (maximum - start[axis]) / direction;
            enter = Math.max(enter, Math.min(first, last));
            leave = Math.min(leave, Math.max(first, last));
          }
        }
        if (enter <= leave && leave >= 0 && enter <= 1) return false;
      }
    }
  }
  return true;
}

/** Prefer the side towards which the actual right shoulder reaches. Taking the
 * worst participant across both versions prevents favoring one casting. */
export function earnedHandSideScore(
  eye: Vec3,
  views: EarnedEventVisibility[],
): number {
  const scores = views.flatMap((view) =>
    view.handSides.map(({ shoulder, hand }) => {
      const reachX = hand.x - shoulder.x,
        reachZ = hand.z - shoulder.z;
      const viewX = eye.x - shoulder.x,
        viewZ = eye.z - shoulder.z;
      const length = Math.hypot(reachX, reachZ) * Math.hypot(viewX, viewZ);
      return length > 1e-7 ? (reachX * viewX + reachZ * viewZ) / length : 0;
    }),
  );
  return Math.min(...scores);
}
