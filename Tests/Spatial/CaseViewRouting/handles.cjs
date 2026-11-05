const assert = require("node:assert/strict");
const {
  caseViewHandleSlots,
} = require("../build-handles/Runtime/CaseViewHandles");
const bench = { originCm: [100, 94, 200], scale: 1, yawRad: Math.PI / 2 };
let slots = caseViewHandleSlots(
  { available: true, mode: "museum", reducedMotion: false },
  bench,
);
assert.equal(slots[0].id, "CaseViewHandle");
slots[0].placement.originCm.forEach((v, i) =>
  assert.ok(Math.abs(v - [71, 101, 200][i]) < 1e-9),
);
slots = caseViewHandleSlots(
  { available: true, mode: "choice", reducedMotion: false },
  bench,
);
assert.deepEqual(
  slots.map((s) => s.id),
  ["CaseViewSeated", "CaseViewStanding", "CaseViewClose"],
);
const base = { originCm: [20, 115, -5], scale: 1, yawRad: Math.PI / 2 };
const view = {
  available: true,
  mode: "table",
  reducedMotion: false,
  presentation: {
    kind: "table",
    placement: { ...base, scale: 0.06 },
    handlePlacement: base,
    source: "entrance",
    tick: 12,
    comparison: false,
  },
};
slots = caseViewHandleSlots(view, bench);
assert.deepEqual(
  slots.map((s) => s.id),
  ["CaseViewBack", "CaseViewClose", "CaseViewStanding"],
);
assert.ok(Math.abs(slots[0].placement.originCm[2] - 9) < 1e-9);
assert.ok(Math.abs(slots[1].placement.originCm[2] + 19) < 1e-9);
assert.equal(slots[2].placement.originCm[1], 101);
assert.ok(slots.every((s) => s.placement.scale === 1));
view.mode = "room";
assert.deepEqual(
  caseViewHandleSlots(view, bench).map((s) => s.id),
  ["CaseViewBack", "CaseViewClose"],
);
assert.deepEqual(caseViewHandleSlots(undefined, bench), []);
console.log("Case view native grip slots match rotated physical input targets");
