/** Canonical transport: one logical tick is half a real second. */
export const MOTION_SECONDS_PER_TICK = 0.5;
export const motionTicks = (seconds: number): number =>
  seconds / MOTION_SECONDS_PER_TICK;
/** Route-only physical timing. No casting, actions, solver or hidden history inputs. */
export interface MotionKey {
  tick: number;
  x: number;
  z: number;
  y?: number;
  yaw: number;
  /** Public outgoing segment: walk backwards while keeping opposite facing. */
  backward?: boolean;
}
export interface MotionTrack {
  keys: readonly MotionKey[];
}
export interface TrackMotionSample {
  /** Story metres: authoritative interpolated root, unaffected by decorative gait. */
  x: number;
  y: number;
  z: number;
  /** Story heading. Imported carved models use native yaw + Math.PI. */
  yaw: number;
  distanceCm: number;
  /** Continuous speed-adaptive distance phase; right arm forward for positive sine. */
  phaseRad: number;
  armSwing: number;
  speedCmPerSecond: number;
  stepLengthCm: number;
  moving: boolean;
  boutStart: number;
  boutEnd: number;
}
export const clampMotion = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));
const smooth = (x: number): number => {
  const t = clampMotion(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const stepLengthForSpeed = (speed: number): number =>
  clampMotion(speed * 0.85, 6, 28);
export const shortestAngle = (a: number, b: number): number =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Shared by moving, previous/next corner and standing continuation. */
export const segmentHeading = (p: MotionKey, q: MotionKey): number =>
  p.backward
    ? Math.atan2(p.x - q.x, p.z - q.z)
    : Math.atan2(q.x - p.x, q.z - p.z);

/** Constant velocity route segments remain authoritative. Only body heading eases
 * for 160ms either side of a real corner; marker/witness geometry stays its owner's API. */
export function sampleTrackMotion(
  track: MotionTrack,
  tick: number,
): TrackMotionSample {
  const keys = track.keys;
  if (!keys.length || !Number.isFinite(tick))
    throw new Error("Use a nonempty finite motion route");
  let index = 0;
  while (index < keys.length - 2 && keys[index + 1].tick <= tick) index++;
  const a = keys[index],
    b = keys[Math.min(index + 1, keys.length - 1)];
  const duration = b.tick - a.tick;
  const fraction =
    duration > 0 ? clampMotion((tick - a.tick) / duration, 0, 1) : 0;
  const distance = (p: MotionKey, q: MotionKey) =>
    Math.hypot(q.x - p.x, q.z - p.z) * 100;
  const length = distance(a, b);
  const moving =
    duration > 0 && length > 1e-7 && tick >= a.tick && tick < b.tick;
  let total = 0,
    phase = 0,
    lastYaw = keys[0].yaw;
  for (let i = 1; i < keys.length; i++) {
    const p = keys[i - 1],
      q = keys[i],
      d = distance(p, q),
      dt = q.tick - p.tick;
    if (dt <= 0) continue;
    const f = clampMotion((tick - p.tick) / dt, 0, 1);
    total += d * f;
    if (d > 1e-7) {
      phase +=
        (d * f * Math.PI) /
        stepLengthForSpeed(d / (dt * MOTION_SECONDS_PER_TICK));
      if (tick >= p.tick) lastYaw = segmentHeading(p, q);
    }
  }
  let start = index,
    end = index + 1;
  if (moving) {
    while (start > 0 && distance(keys[start - 1], keys[start]) > 1e-7) start--;
    while (end < keys.length - 1 && distance(keys[end], keys[end + 1]) > 1e-7)
      end++;
  }
  const boutStart = moving ? keys[start].tick : a.tick;
  const boutEnd = moving ? keys[end].tick : a.tick;
  let yaw = lastYaw;
  // A stationary key's explicit orientation is a valid authored standing pose.
  if (!moving && length < 1e-7) {
    yaw = a.yaw + shortestAngle(a.yaw, b.yaw) * smooth(fraction);
    if (
      index > 0 &&
      distance(keys[index - 1], a) > 1e-7 &&
      tick < a.tick + motionTicks(0.32)
    ) {
      const previous = segmentHeading(keys[index - 1], a);
      yaw =
        previous +
        shortestAngle(previous, yaw) *
          smooth((tick - a.tick) / motionTicks(0.32));
    }
  }
  if (moving) {
    const current = segmentHeading(a, b);
    yaw = current;
    if (
      index > 0 &&
      distance(keys[index - 1], a) < 1e-7 &&
      tick < a.tick + motionTicks(0.32)
    ) {
      yaw =
        a.yaw +
        shortestAngle(a.yaw, current) *
          smooth((tick - a.tick) / motionTicks(0.32));
    }
    if (
      index > 0 &&
      distance(keys[index - 1], a) > 1e-7 &&
      tick < a.tick + motionTicks(0.16)
    ) {
      const previous = segmentHeading(keys[index - 1], a);
      yaw =
        previous +
        shortestAngle(previous, current) *
          smooth((tick - a.tick + motionTicks(0.16)) / motionTicks(0.32));
    }
    if (
      index + 2 < keys.length &&
      distance(b, keys[index + 2]) > 1e-7 &&
      tick > b.tick - motionTicks(0.16)
    ) {
      const next = segmentHeading(b, keys[index + 2]);
      yaw =
        current +
        shortestAngle(current, next) *
          smooth((tick - b.tick + motionTicks(0.16)) / motionTicks(0.32));
    }
  }
  const envelope = moving
    ? smooth((tick - boutStart) / motionTicks(0.26)) *
      smooth((boutEnd - tick) / motionTicks(0.26))
    : 0;
  const speed = moving ? length / (duration * MOTION_SECONDS_PER_TICK) : 0;
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: (a.y ?? 1) + ((b.y ?? 1) - (a.y ?? 1)) * fraction,
    z: a.z + (b.z - a.z) * fraction,
    yaw,
    distanceCm: total,
    phaseRad: phase,
    armSwing:
      Math.sin(phase) *
      envelope *
      clampMotion(speed / 35, 0, 1) *
      (a.backward ? -1 : 1),
    speedCmPerSecond: speed,
    stepLengthCm: stepLengthForSpeed(speed),
    moving,
    boutStart,
    boutEnd,
  };
}
