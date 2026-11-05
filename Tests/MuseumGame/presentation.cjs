const assert = require("node:assert/strict");

/** Existing clocks supply interpolation; recorded state remains integer. */
module.exports = function checkPresentation({
  AuthorSession,
  DetectiveSession,
  draft,
  sealed,
}) {
  const author = new AuthorSession(draft);
  author.setTick(6);
  author.play();
  author.advanceTime(0.125);
  assert.equal(author.presentationTick(), 6.25);
  assert.equal(author.snapshot().tick, 6);
  author.pause();
  assert.equal(author.presentationTick(), 6);
  author.setTick(9);
  assert.equal(author.presentationTick(), 9);
  author.play();
  author.advanceTime(0.25);
  assert.equal(author.presentationTick(), 9.5);
  author.advanceTime(0.25);
  assert.equal(author.snapshot().tick, 10);
  assert.equal(author.presentationTick(), 10);
  author.setTick(24);
  author.pause();
  assert.equal(author.presentationTick(), 24);
  author.dispose();

  const detective = new DetectiveSession(sealed, { render() {}, clear() {} });
  detective.dispatch({ type: "seek", tick: 6 });
  detective.dispatch({ type: "play" });
  detective.update(0.125);
  assert.equal(detective.presentationTick(), 6.25);
  assert.equal(detective.snapshot().tick, 6);
  assert.equal(detective.isCompleted(), false);
  const before = detective.snapshot();
  detective.presentationTick();
  assert.deepEqual(detective.snapshot(), before);
  detective.dispatch({ type: "freeze" });
  assert.equal(detective.presentationTick(), 6);
  detective.dispatch({ type: "seek", tick: 9 });
  detective.dispatch({ type: "play" });
  detective.update(0.25);
  assert.equal(detective.presentationTick(), 9.5);
  detective.update(0.25);
  assert.equal(detective.presentationTick(), 10);
  assert.equal(detective.snapshot().tick, 10);
  detective.dispatch({ type: "seek", tick: 24 });
  assert.equal(detective.presentationTick(), 24);
  detective.dispose();
};
