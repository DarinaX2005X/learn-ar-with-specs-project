const assert = require("node:assert/strict");
module.exports = function checkAuthorizedReveal({
  game,
  readNativeView,
  poseSamples,
  publicTape,
  getObservations,
}) {
  assert.equal(game.snapshot().flow.mode, "finished");
  assert(game.snapshot().reveal);
  assert(!game.snapshot().author);
  assert(!JSON.stringify(game.snapshot()).includes("actualHistory"));
  const pins = JSON.stringify(game.snapshot().detective.glass);
  const verdict = JSON.stringify(game.snapshot().detective.verdict);
  const fields = JSON.stringify(game.snapshot().detective.fields);
  const source = game.snapshot().detective.source;
  const assertPublicFrame = (tick) => {
    const state = game.snapshot();
    const expected = publicTape.clues.find(
      (clue) =>
        clue.kind === "Frame" && clue.witness === source && clue.tick === tick,
    );
    assert.equal(state.detective.tick, tick);
    assert.equal(
      JSON.stringify(state.detective.frame),
      JSON.stringify(expected),
    );
    assert.equal(
      JSON.stringify(state.detective.observations),
      JSON.stringify(getObservations(publicTape, source, tick)),
    );
    assert.equal(state.detective.focusedObservation, undefined);
    assert.equal(JSON.stringify(state.detective.glass), pins);
    assert.equal(JSON.stringify(state.detective.verdict), verdict);
    assert.equal(JSON.stringify(state.detective.fields), fields);
    assert.deepEqual(Object.keys(state.reveal).sort(), ["playing", "tick"]);
  };
  const command = (payload) => game.dispatch("reveal", payload);
  assert(!game.dispatch("detective", { type: "pin" }));
  assert(!command({ type: "claim", claim: "Guard" }));
  assert(command({ type: "seek", tick: 11 }));
  assertPublicFrame(11);
  assert.equal(readNativeView().nestEmpty, false);
  assert(readNativeView().hands.every((hand) => hand.grip === 0));
  assert(command({ type: "step", delta: 1 }));
  assertPublicFrame(12);
  assert.equal(readNativeView().nestEmpty, true);
  assert(readNativeView().hands.some((hand) => hand.grip === 1));
  assert(command({ type: "step", delta: -1 }));
  assert.equal(readNativeView().nestEmpty, false);
  assert(command({ type: "replay" }));
  game.update(0.125);
  assert.equal(poseSamples.at(-1), 0.25);
  assert.equal(game.snapshot().reveal.tick, 0);
  assertPublicFrame(0);
  for (let i = 0; i < 48; i++) game.update(0.25);
  assert.equal(game.snapshot().reveal.tick, 24);
  assert.equal(game.snapshot().reveal.playing, false);
  assertPublicFrame(24);
  assert(command({ type: "seek", tick: 4 }));
  assert(command({ type: "play" }));
  game.update(0.125);
  assert.equal(poseSamples.at(-1), 4.25);
  assert(command({ type: "pause" }));
  game.update(0.25);
  assert.equal(game.snapshot().reveal.tick, 4);
  assert.equal(game.snapshot().reveal.playing, false);
  assertPublicFrame(4);
};
