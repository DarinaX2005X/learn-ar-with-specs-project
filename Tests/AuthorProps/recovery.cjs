/** Ordinary AuthorController/Session recovery, using the existing suite harness. */
module.exports = ({
  assert,
  harness,
  shelf,
  compileCase,
  createMuseumTheft,
}) => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const errorsFor = (draft) => {
    const result = compileCase(draft);
    return plain(result.ok ? [] : result.errors);
  };
  const testCase = (h) => {
    assert(h.send({ kind: "startTest" }));
    for (let frame = 0; frame < 3000 && h.session.snapshot().testing; frame++)
      h.session.advanceProof(32);
    assert(!h.session.snapshot().testing);
    if (h.session.snapshot().needsAmbiguityConfirmation)
      assert(h.send({ kind: "confirmAmbiguity" }));
    assert(h.session.snapshot().canSeal);
  };
  for (const withUndo of [false, true]) {
    const draft = createMuseumTheft();
    const h = harness("author", draft);
    if (withUndo)
      assert(
        h.send({ kind: "edit", edit: { kind: "setAperture", aperture: 0 } }),
      );
    testCase(h);
    const before = h.session.snapshot();
    const seal = plain(h.session.seal());
    assert.equal(
      h.send({
        kind: "edit",
        edit: { kind: "stageTake", track: "A", tick: 12 },
      }),
      false,
    );
    assert(
      h.session.snapshot().errors.some((error) => error.code === "TAKE_REACH"),
    );
    assert(
      h.props.questionSummary().includes("Draft needs repairs before testing"),
    );
    assert.deepStrictEqual(plain(h.session.getDraft()), plain(before.draft));
    const owner = before.draft.events.find(
      (event) => event.kind === "Take",
    ).track;
    assert.equal(
      h.send({
        kind: "edit",
        edit: { kind: "stageTake", track: owner, tick: 12 },
      }),
      true,
    );
    const after = h.session.snapshot();
    assert.deepStrictEqual(
      plain(after.errors),
      errorsFor(after.draft),
      "accepted unchanged draft must replace rejected-candidate errors",
    );
    assert(h.props.questionSummary().includes("Ready to test"));
    assert.deepStrictEqual(plain(after.draft), plain(before.draft));
    assert.equal(after.draft.rev, before.draft.rev);
    assert.equal(after.canUndo, before.canUndo);
    assert.equal(after.testedRev, before.testedRev);
    assert.equal(after.canSeal, before.canSeal);
    assert.deepStrictEqual(plain(after.verdict), plain(before.verdict));
    assert.deepStrictEqual(plain(h.session.seal()), seal);
    if (withUndo) {
      assert(h.send({ kind: "undo" }));
      assert.equal(h.session.getDraft().room.mirror.aperture, 1);
      assert.equal(
        h.send({ kind: "undo" }),
        false,
        "no-op recovery must not add an undo record",
      );
    } else {
      assert.equal(h.send({ kind: "undo" }), false);
    }
    h.session.dispose();
  }
  for (const draft of [
    shelf.emptyRoom(),
    shelf.keepRoom({ id: "missing-ruby", rev: 1 }),
  ]) {
    const h = harness("author", draft);
    const before = h.session.snapshot();
    const actual = errorsFor(before.draft);
    assert(actual.length > 0, "fixture must remain an actual incomplete draft");
    assert.equal(
      h.send({ kind: "edit", edit: { kind: "setAlarm", tick: 99 } }),
      false,
    );
    assert(h.session.snapshot().errors.some((error) => error.code === "TICK"));
    assert(
      h.send({
        kind: "edit",
        edit: { kind: "assignRole", track: "A", role: before.draft.casting.A },
      }),
    );
    const after = h.session.snapshot();
    assert.deepStrictEqual(
      plain(after.errors),
      actual,
      "current incomplete errors must be restored, not erased",
    );
    assert(
      h.props.questionSummary().includes("Draft needs repairs before testing"),
    );
    assert.equal(after.draft.rev, before.draft.rev);
    assert.equal(after.canUndo, false);
    assert.equal(after.canSeal, false);
    assert.equal(h.send({ kind: "startTest" }), false);
    assert.deepStrictEqual(plain(h.session.snapshot().errors), actual);
    h.session.dispose();
  }
  console.log(
    "PASS rejected Take recovery refreshes current validation only; no-op revision/undo/proof/seal preserved and incomplete errors remain honest",
  );
};
