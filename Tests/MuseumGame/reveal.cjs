const assert = require("node:assert/strict");
module.exports = function checkReveal({
  RevealTransport,
  renderHistory,
  board,
  history,
}) {
  const clock = new RevealTransport(board.alarmTick);
  assert(clock.dispatch({ type: "seek", tick: board.alarmTick - 1 }));
  const before = renderHistory(board, history, clock.presentationTick());
  assert.equal(before.nestEmpty, false);
  assert(before.hands.every((hand) => hand.grip === 0));
  assert(clock.dispatch({ type: "step", delta: 1 }));
  const taken = renderHistory(board, history, clock.presentationTick());
  assert.equal(taken.nestEmpty, true);
  const hand = taken.hands.find((hand) => hand.track === history.take);
  assert.equal(hand.grip, 1);
  assert.deepEqual(taken.ruby.positionCm, hand.handCm);
  assert(clock.dispatch({ type: "step", delta: -1 }));
  assert.deepEqual(
    renderHistory(board, history, clock.presentationTick()),
    before,
  );
  assert(clock.dispatch({ type: "replay" }));
  clock.update(0.125);
  assert.equal(clock.presentationTick(), 0.25);
  assert.equal(clock.snapshot().tick, 0);
  clock.dispatch({ type: "pause" });
  assert.equal(clock.presentationTick(), 0);
  assert(!clock.dispatch({ type: "seek", tick: NaN }));
  clock.dispatch({ type: "seek", tick: 24 });
  clock.dispatch({ type: "play" });
  assert.equal(clock.snapshot().tick, 0);
  clock.dispose();
  assert(!clock.dispatch({ type: "play" }));
  assert.equal(clock.update(0.25), false);
};
