/** Samples palms, contacts and the carried ruby at one story time, in metres.
 * Track IDs identify model joints and stay inside the simulation. */
import { Board, History, TrackId, Vec3 } from "./types";
import { poseAt, add, sub, mul } from "./geometry";
import { sampleTrackMotion } from "./TrackMotion";
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
/** Pose weights for the view of the actual hand. Logical ownership is separate. */
export interface HandArticulation {
  reach: number;
  curl: number;
  carry: number;
  /** Weight of a palm pad touching a surface such as the brass rim. */
  touch?: number;
}
export function sampleContactPose(board: Board, h: History, tick: number) {
  if (!Number.isFinite(tick)) throw new Error("Choose a finite time");
  const t = Math.max(0, Math.min(24, tick));
  const exhibit = board.room.exhibit.position;
  const taken = t >= board.alarmTick;
  const stashed = !!h.stash && t >= h.stash.tick;
  const carrier = h.pass && t >= h.pass.tick ? h.pass.to : h.take;
  const positions = new Map<TrackId, Vec3 & { yaw: number }>();
  const hands = new Map<TrackId, Vec3>();
  const articulation = new Map<TrackId, HandArticulation>();
  for (const track of board.tracks) {
    const p = sampleTrackMotion(track, t);
    positions.set(track.id, { x: p.x, y: p.y, z: p.z, yaw: p.yaw });
    const holding = taken && !stashed && carrier === track.id;
    const side = holding ? 0.19 : 0.245;
    const forward = holding ? 0.19 : 0.04 + p.armSwing * 0.15;
    // The imported model faces local -Z. Its right shoulder, local +X, is
    // on the negative story-X side when heading along positive story Z.
    const hand = {
      x: p.x - side * Math.cos(p.yaw) + forward * Math.sin(p.yaw),
      y: p.y - (holding ? 0.04 : 0.31),
      z: p.z + side * Math.sin(p.yaw) + forward * Math.cos(p.yaw),
    };
    // Lift the hand before it enters the 48 cm square pedestal, including
    // while walking away with the ruby. The extra 4 cm clears the palm.
    const edge = Math.max(
      Math.abs(hand.x - exhibit.x),
      Math.abs(hand.z - exhibit.z),
    );
    const lift = smooth((0.44 - edge) / 0.16);
    hand.y += Math.max(0, exhibit.y + 0.1 - hand.y) * lift;
    hands.set(track.id, hand);
    articulation.set(track.id, { reach: 0, curl: holding ? 1 : 0, carry: holding ? 1 : 0 });
  }
  const reach = (id: TrackId, target: Vec3, offset: number) => {
    const strength = smooth(1 - Math.abs(offset));
    if (strength <= 0) return;
    hands.set(id, mix(hands.get(id)!, target, strength));
    const fingers = articulation.get(id)!;
    fingers.reach = strength;
    fingers.carry *= 1 - strength;
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
  // Shorter windows on either side of a neighbouring action keep every legal
  // event at its exact socket, rim, partner or box position when scrubbing.
  const delta = t - board.alarmTick;
  const nextAction = Math.min(
    h.pass?.tick ?? Infinity,
    h.stash?.tick ?? Infinity,
    ...h.brushes.filter(b => b.track === h.take && b.tick > board.alarmTick).map(b => b.tick),
  );
  const previousBrush = h.brushes.find(b => b.track === h.take && b.tick < board.alarmTick);
  const approach = Math.min(1.75, previousBrush ? board.alarmTick - previousBrush.tick : Infinity);
  const withdraw = Math.min(1.65, nextAction - board.alarmTick);
  if (delta >= -approach && delta <= withdraw) {
    const base = hands.get(h.take)!;
    const fingers = articulation.get(h.take)!;
    const high = Math.max(base.y, exhibit.y + 0.14);
    if (delta < 0) {
      const u = 1 + delta / approach;
      // Raise outside the rim, reach over the socket, lower onto the stone.
      // Once the pads arrive, the fingers have time to close while it rests.
      const hand = mix(base, exhibit, smooth((u - 0.16) / 0.47));
      const raised = base.y + (high - base.y) * smooth(u / 0.28);
      hand.y = raised + (exhibit.y - raised) * smooth((u - 0.63) / 0.19);
      hands.set(h.take, hand);
      fingers.reach = smooth(u / 0.55);
      fingers.curl = smooth((u - 0.79) / 0.19);
    } else {
      const u = delta / withdraw;
      // Lift vertically first. Turn the wrist and draw the stone back
      // toward the waist only after it clears the velvet and socket.
      const retract = smooth((u - 0.44) / 0.56);
      const hand = mix(exhibit, base, retract);
      const lifted = exhibit.y + (high - exhibit.y) * smooth((u - 0.06) / 0.38);
      hand.y = lifted + (base.y - lifted) * retract;
      hands.set(h.take, hand);
      fingers.reach = 1 - retract;
      fingers.carry = retract;
      fingers.curl = 1;
    }
  }
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
    // Outer face of the shipped brass ledge in story metres.
    const factor = 0.23752 / Math.max(Math.abs(dx), Math.abs(dz));
    reachCase(brush.track, brush.tick, {
      x: exhibit.x + dx * factor,
      y: exhibit.y - 0.06536,
      z: exhibit.z + dz * factor,
    });
    const pad = articulation.get(brush.track)!;
    pad.reach = smooth(1 - Math.abs(t - brush.tick));
    pad.touch = pad.reach;
  }
  const box = h.stash && board.room.boxes?.find((b) => b.id === h.stash!.box);
  if (h.stash && box) reach(h.stash.carrier, box.position, t - h.stash.tick);
  const pass = h.pass;
  if (pass && Math.abs(t - pass.tick) < 1) {
    const a = positions.get(pass.from)!, b = positions.get(pass.to)!;
    // Keep a full handoff while the pair stands together. When one leaves
    // or arrives on a legal alternate tick, release or reach as their arms
    // enter the shared space. Two actors walking together keep their timing.
    const atPass = (id: TrackId) => poseAt(board.tracks.find(track => track.id === id)!, pass.tick);
    const aThen = atPass(pass.from), bThen = atPass(pass.to);
    const relativeTravel = Math.hypot(
      (a.x - b.x) - (aThen.x - bThen.x),
      (a.z - b.z) - (aThen.z - bThen.z),
    );
    const contact = mix(a, b, 0.5);
    contact.y = Math.min(a.y, b.y) - 0.25;
    // Both hands meet at the same point. The outgoing hand withdraws toward
    // its own hip; it does not chase a stone already in the other actor's grip.
    const offset = t - pass.tick;
    // Shorten the finger overlap by one phase per 36 cm of relative travel.
    const tempo = offset === 0 ? 1 : 1 + relativeTravel / (0.36 * Math.abs(offset));
    const transfer = offset * tempo;
    const hold = (offset < 0 ? 0.38 : 0.43) / tempo;
    const release = Math.max(0, (Math.abs(offset) - hold) / (1 - hold));
    reach(pass.from, contact, release);
    reach(pass.to, contact, release);
    // The receiving fingers close above the ruby before the donor opens
    // below it. The receiving wrist then turns the stone into the carry.
    const giving = articulation.get(pass.from)!;
    const receiving = articulation.get(pass.to)!;
    giving.curl = 1 - smooth((transfer - 0.05) / 0.38);
    receiving.curl = smooth((transfer + 0.38) / 0.38);
    giving.carry = 1 - smooth((transfer - 0.32) / 0.68);
    receiving.carry = smooth((transfer - 0.45) / 0.55);
  }
  if (h.stash && box && Math.abs(t - h.stash.tick) < 1)
    articulation.get(h.stash.carrier)!.curl = 1 - smooth((t - h.stash.tick + 0.08) / 0.3);
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
    articulation,
    ruby,
    taken,
    stashed,
    carrier: taken && !stashed ? carrier : undefined,
    contacts,
    cache: stashed ? h.stash!.box : undefined,
  };
}
