const assert = require("node:assert/strict");
module.exports = function checkProofEquivalence({
  prove,
  compileCase,
  createMuseumTheft,
}) {
  const plain = value => JSON.parse(JSON.stringify(value));
  const core = ({ reasonIds, exclusions, ...verdict }) => plain(verdict);
  const cases = [createMuseumTheft(false), createMuseumTheft(true)];
  const changed = createMuseumTheft(true);
  changed.id = "changed-role-proof";
  changed.casting = { A: "Guard", B: "Courier", C: "Conservator" };
  cases.push(changed);
  for (const draft of cases) {
    const compiled = compileCase(draft);
    assert(compiled.ok);
    const { board, clues } = compiled.sealed;
    const minimal = prove(board, clues, [], "Underdetermined");
    const sufficient = prove(board, clues, [], "Underdetermined", {
      minimizeReasons: false,
      batchSize: 1,
    });
    assert.deepEqual(
      core(sufficient),
      core(minimal),
      "Reason presentation cannot change valid histories or findings",
    );
    for (const grounds of Object.values(sufficient.exclusions)) {
      assert.deepEqual(plain(grounds), plain(clues.clues.map((clue) => clue.id)));
    }
    assert.deepEqual(
      core(
        prove(board, clues, [], "Underdetermined", {
          minimizeReasons: false,
          maxHistories: 1,
        }),
      ),
      core(prove(board, clues, [], "Underdetermined", { maxHistories: 1 })),
    );
  }
};
