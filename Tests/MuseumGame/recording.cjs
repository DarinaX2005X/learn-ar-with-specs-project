const assert = require("node:assert/strict");
module.exports = function checkRecording({
  AuthorSession,
  AuthorController,
  createMuseumTheft,
  events,
}) {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const session = new AuthorSession(createMuseumTheft(true));
  const original = session.getDraft();
  const loadedKey = plain(
    original.tracks.find((track) => track.id === "A").keys.at(-1),
  );
  assert.equal(loadedKey.tick, 24);
  const beforeEvents = events.length;
  const controller = new AuthorController();
  controller.onAwake();
  controller.mount(session, { render() {}, clear() {} });
  const update = events[beforeEvents];
  assert.equal(typeof update, "function");
  assert(controller.dispatch({ kind: "beginRecording", track: "A" }));
  assert(controller.dispatch({ kind: "recordPoint", point: loadedKey }));
  assert.equal(session.snapshot().tick, 0);
  assert.equal(
    session.snapshot().draft.tracks[0].keys[0].x,
    loadedKey.x,
    "Loaded Key.tick must not replace the current recording tick",
  );
  for (let tick = 1; tick <= 24; tick++) {
    update();
    update(); // The existing runner supplies the real controller 0.25s/update.
    assert.equal(session.snapshot().tick, tick);
    if (tick === 5)
      assert(
        controller.dispatch({
          kind: "recordPoint",
          point: { ...loadedKey, x: loadedKey.x + 0.1 },
        }),
      );
  }
  assert(controller.dispatch({ kind: "commitGesture" }));
  const recorded = plain(session.getDraft());
  const keys = recorded.tracks.find((track) => track.id === "A").keys;
  assert.deepEqual(
    keys.map((key) => key.tick),
    Array.from({ length: 25 }, (_, tick) => tick),
  );
  assert.equal(keys[0].x, loadedKey.x);
  assert.equal(keys[4].x, loadedKey.x);
  assert.equal(keys[5].x, loadedKey.x + 0.1);
  assert.equal(keys[24].x, loadedKey.x + 0.1);
  assert.deepEqual(
    recorded.tracks.filter((track) => track.id !== "A"),
    plain(original.tracks.filter((track) => track.id !== "A")),
  );
  assert.deepEqual(recorded.events, plain(original.events));
  assert.equal(
    recorded.rev,
    original.rev + 1,
    "One recording is one author revision",
  );
  assert.equal(session.snapshot().recordingTrack, null);
  assert.equal(session.snapshot().playing, false);
  assert.equal(session.snapshot().preview, false);
  assert(controller.dispatch({ kind: "undo" }));
  assert.deepEqual(
    plain(session.getDraft().tracks),
    plain(original.tracks),
    "One undo restores the complete previous take",
  );
  controller.detach();
  assert.equal(
    controller.dispatch({ kind: "recordPoint", point: loadedKey }),
    false,
  );
  session.dispose();
  console.log(
    "PASS real author recording ignores loaded Key.tick, samples25 clock steps, preserves other tracks/events and undoes once",
  );
};
