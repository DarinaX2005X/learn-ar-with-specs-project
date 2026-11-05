/** Samples palms, contacts and the carried ruby at one story time, in metres.
 * Track IDs identify model joints and stay inside the simulation. */
import { Board, History, TrackId, Vec3 } from "./types";
import { poseAt, add, sub, mul } from "./geometry";
const mix = (a: Vec3, b: Vec3, f: number) =>
  add(a, mul(sub(b, a), Math.max(0, Math.min(1, f))));
const smooth = (f: number) => {
  f = Math.max(0, Math.min(1, f));
  return f * f * (3 - 2 * f);
};
export interface ContactEvent {
  kind: "Take" | "BrushRim" | "Pass" | "Stash";
  tracks: TrackId[];
  position: Vec3;
  box?: string;
}
export function sampleContactPose(board: Board, h: History, tick: number) {
  if (!Number.isFinite(tick)) throw new Error("Choose a finite time");
  const t = Math.max(0, Math.min(24, tick));
  const positions = new Map(
    board.tracks.map((track) => [track.id, poseAt(track, t)]),
  );
  const exhibit = board.room.exhibit.position;
  const rest = (id: TrackId): Vec3 => {
    const p = positions.get(id)!;
    const hand = {
      x: p.x + 0.12 * Math.cos(p.yaw),
      y: p.y - 0.3,
      z: p.z - 0.12 * Math.sin(p.yaw),
    };
    // Lift the hand before it enters the 48 cm square pedestal, including
    // while walking away with the ruby. The extra 4 cm clears the palm.
    const edge = Math.max(
      Math.abs(hand.x - exhibit.x),
      Math.abs(hand.z - exhibit.z),
    );
    const lift = smooth((0.44 - edge) / 0.16);
    hand.y += Math.max(0, exhibit.y + 0.1 - hand.y) * lift;
    return hand;
  };
  const hands = new Map<TrackId, Vec3>(
    board.tracks.map((track) => [track.id, rest(track.id)]),
  );
  const reach = (id: TrackId, target: Vec3, event: number) => {
    const strength = t <= event ? smooth(t - event + 1) : 1 - smooth(t - event);
    if (strength > 0) hands.set(id, mix(hands.get(id)!, target, strength));
  };
  const reachCase = (id: TrackId, event: number, target: Vec3) => {
    const progress = 1 - Math.abs(t - event);
    if (progress <= 0) return;
    const start = hands.get(id)!;
    // Raise, move above the socket, then lower into it. On withdrawal these
    // same poses play in reverse and carry the ruby clear of the velvet rim.
    const high = Math.max(start.y, exhibit.y + 0.1);
    const hand = mix(start, target, smooth((progress - 0.2) / 0.55));
    const raised = start.y + (high - start.y) * smooth(progress / 0.3);
    hand.y = raised + (target.y - raised) * smooth((progress - 0.75) / 0.25);
    hands.set(id, hand);
  };
  reachCase(h.take, board.alarmTick, exhibit);
  for (const brush of h.brushes) {
    if (Math.abs(t - brush.tick) >= 1) continue;
    // The contact mark belongs to the nearest brass ledge. Keep the side
    // fixed through the gesture even when the actor walks past its centre.
    const track = board.tracks.find((item) => item.id === brush.track)!;
    const pose = poseAt(track, brush.tick);
    let dx = pose.x - exhibit.x,
      dz = pose.z - exhibit.z;
    if (Math.max(Math.abs(dx), Math.abs(dz)) < 0.01) {
      dx = Math.cos(pose.yaw);
      dz = -Math.sin(pose.yaw);
    }
    const factor = 0.23 / Math.max(Math.abs(dx), Math.abs(dz));
    reachCase(brush.track, brush.tick, {
      x: exhibit.x + dx * factor,
      y: exhibit.y - 0.0645,
      z: exhibit.z + dz * factor,
    });
  }
  if (h.pass) {
    const a = positions.get(h.pass.from)!,
      b = positions.get(h.pass.to)!;
    const contact = mix(a, b, 0.5);
    contact.y = Math.min(a.y, b.y) - 0.25;
    reach(h.pass.from, contact, h.pass.tick);
    reach(h.pass.to, contact, h.pass.tick);
  }
  const box = h.stash && board.room.boxes?.find((b) => b.id === h.stash!.box);
  if (h.stash && box) reach(h.stash.carrier, box.position, h.stash.tick);
  const taken = t >= board.alarmTick,
    stashed = !!h.stash && t >= h.stash.tick;
  const carrier = h.pass && t >= h.pass.tick ? h.pass.to : h.take;
  const ruby = taken
    ? stashed && box
      ? box.position
      : hands.get(carrier)!
    : exhibit;
  const contacts: ContactEvent[] = [];
  if (t === board.alarmTick)
    contacts.push({
      kind: "Take",
      tracks: [h.take],
      position: { ...hands.get(h.take)! },
    });
  for (const brush of h.brushes)
    if (t === brush.tick)
      contacts.push({
        kind: "BrushRim",
        tracks: [brush.track],
        position: { ...hands.get(brush.track)! },
      });
  if (h.pass && t === h.pass.tick)
    contacts.push({
      kind: "Pass",
      tracks: [h.pass.from, h.pass.to],
      position: { ...hands.get(h.pass.from)! },
    });
  if (h.stash && t === h.stash.tick)
    contacts.push({
      kind: "Stash",
      tracks: [h.stash.carrier],
      position: { ...hands.get(h.stash.carrier)! },
      box: h.stash.box,
    });
  return {
    tick: t,
    positions,
    hands,
    ruby,
    taken,
    stashed,
    carrier: taken && !stashed ? carrier : undefined,
    contacts,
    cache: stashed ? h.stash!.box : undefined,
  };
}
