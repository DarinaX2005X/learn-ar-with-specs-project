const assert = require("node:assert/strict");
const D = require("./build/Domain/index.js");
const { solveRightArm, SHIPPED_RIGHT_ARM } = require("./build/Spatial/ArmIK.js");

// A hand retracting from the brass rim passes inside the arm's inner radius.
// The model may recoil by the available body shift while both bones stay rigid.
const foldedWrist = SHIPPED_RIGHT_ARM.shoulder.map((v, i) => v + (i === 1 ? -0.24 : 0));
const palm = { rotation: [0, 0, 0, 1], contact: [0, 0, 0] };
assert(solveRightArm(foldedWrist, 0, palm).residualCm > 0.04);
const folded = solveRightArm(foldedWrist, 0.72, palm);
assert(folded.residualCm < 1e-6);
assert(folded.upperBodyOffset[1] > 0 && folded.upperBodyOffset[1] < 0.05);

function compiled(draft) {
  const result = D.compileCase(draft);
  assert(result.ok, JSON.stringify(result.errors));
  return [result.sealed.board, result.vault.actualHistory];
}
const close = (a, b, epsilon = 1e-6) =>
  Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) <= epsilon;

const [board, history] = compiled(D.createMuseumTheft(true));
const held = history.take;
const sample = tick => D.sampleContactPose(board, history, tick);
const event = board.alarmTick;
const exhibit = board.room.exhibit.position;
const approach = sample(event - 0.25), secured = sample(event - 0.035);
assert(close(approach.hands.get(held), exhibit));
assert(approach.articulation.get(held).curl < secured.articulation.get(held).curl);
assert(secured.articulation.get(held).curl > 0.99);
assert(!secured.taken && close(secured.ruby, exhibit));
assert(close(sample(event+0.07).ruby, exhibit));

const lifted = sample(event+0.7);
assert(lifted.ruby.y > exhibit.y+0.12);
assert(Math.abs(lifted.ruby.x-exhibit.x)+Math.abs(lifted.ruby.z-exhibit.z) < 0.001);
assert(lifted.articulation.get(held).curl === 1);
assert(close(lifted.ruby, lifted.hands.get(held)));
const carried = sample(event+1.8);
assert(carried.articulation.get(held).carry === 1);
assert(close(carried.ruby, carried.hands.get(held)));
const points = [];
for (let i = 0; i <= 150; ++i) {
  const pose = sample(event-2+i/30), hand = pose.hands.get(held);
  if(i>0) assert(close(hand,points[i-1],0.08),"wrist jumped between 60 Hz poses");
  points.push(hand);
}
for (let i = points.length-1; i>=0; --i) {
  assert(close(sample(event-2+i/30).hands.get(held),points[i]));
}
const [pb, ph] = compiled(D.createPackingCase({rearCamera:true}));
const pass = tick => D.sampleContactPose(pb,ph,tick);
assert(ph.pass);
const {from,to,tick} = ph.pass;
assert(pass(tick-.4).articulation.get(from).curl === 1);
assert(pass(tick-.4).articulation.get(to).curl === 0);
const transfer = pass(tick);
assert(close(transfer.hands.get(from), transfer.hands.get(to)));
assert(transfer.articulation.get(to).curl === 1 && transfer.articulation.get(from).curl === 1);
assert(transfer.articulation.get(from).carry === 1 && transfer.articulation.get(to).carry === 0);
for (let offset = -.38; offset < .44; offset += 1 / 30) {
  const pose = pass(tick + offset);
  assert(close(pose.hands.get(from), pose.ruby), "presenting hand left before its fingers opened");
  assert(close(pose.hands.get(to), pose.ruby), "receiving fingers closed away from the stone");
}
assert(pass(tick + .4).articulation.get(to).carry === 0);
assert(pass(tick+.5).articulation.get(from).curl === 0 && pass(tick+.5).carrier === to);
// On an alternate legal handoff tick one participant can already be leaving.
// Follow both actual wrists at 60 Hz, including between the half-second ticks.
for (const recipient of ["B", "C"]) {
  const [room, actual] = compiled(D.createPackingCase({recipient}));
  for (const exchange of room.windows.pass.filter(p => p.from === actual.take)) {
    const alternative = {...actual, pass: exchange, stash: undefined};
    let previous;
    for (let frame = -30; frame <= 30; ++frame) {
      const pose = D.sampleContactPose(room, alternative, exchange.tick + frame / 30);
      for (const id of [exchange.from, exchange.to]) {
        if (previous) assert(close(previous.hands.get(id), pose.hands.get(id), 0.08),
          `Wrist jumped during transfer to ${exchange.to} at ${exchange.tick}, frame ${frame}`);
      }
      previous = pose;
    }
  }
}
const adjacentBox = {...pb.room.boxes[0], position: {...transfer.ruby, y: transfer.ruby.y - 0.12}};
const adjacentBoard = {...pb, room: {...pb.room, boxes: [adjacentBox]}};
const adjacentHistory = {...ph, stash: {carrier: to, box: adjacentBox.id, tick: tick + 1}};
for (const offset of [0, 0.2, 0.4]) {
  const pose = D.sampleContactPose(adjacentBoard, adjacentHistory, tick + offset);
  assert(close(pose.hands.get(from), pose.ruby) && close(pose.hands.get(to), pose.ruby));
}
assert(close(D.sampleContactPose(adjacentBoard, adjacentHistory, tick + 1).ruby, adjacentBox.position));
console.log("PASS right hand seats then closes, ruby stays through closure, vertical lift precedes withdrawal; handoff overlap; forward/backward sampling at 60 Hz.");
