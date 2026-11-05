// Invoked by: python Tools/TableKit/test_tablekit.py
const path = require("path"),
  assert = require("assert");
const base = process.env.TABLEKIT_COMPILED_DIR;
if (!base)
  throw new Error(
    "TABLEKIT_COMPILED_DIR is required; run python Tools/TableKit/test_tablekit.py",
  );
const { TableKit, curtainVisual, galleryStates } = require(
  path.join(base, "TableKit.js"),
);
const { reflectObservedTriangles, mirrorOpening } = require(
  path.join(base, "MirrorProxy.js"),
);
const { placeWitnessSample, groupWitnessSegments } = require(
  path.join(base, "WitnessPlacement.js"),
);
const tri = { a: [-8, 2, -5], b: [8, 2, -5], c: [0, 10, -5] },
  camera = [0, 6, -10];
assert.equal(
  reflectObservedTriangles([tri], camera, mirrorOpening(0)).indices.length,
  0,
);
assert.equal(
  reflectObservedTriangles([tri], [0, 6, 10], mirrorOpening(1)).indices.length,
  0,
);
const out = reflectObservedTriangles([tri], camera, mirrorOpening(0.5));
assert(out.indices.length > 0);
for (const p of out.vertices) {
  const t = -camera[2] / (p[2] - camera[2]),
    q = [
      camera[0] + t * (p[0] - camera[0]),
      camera[1] + t * (p[1] - camera[1]),
    ];
  assert(
    q[0] >= -3 - 1e-6 && q[0] <= 1e-6 && q[1] >= 1 - 1e-6 && q[1] <= 11 + 1e-6,
  );
}
for (const a of [0, 0.25, 0.5, 1]) {
  const c = curtainVisual(a);
  assert.equal(c.handleXCm, mirrorOpening(a).right);
  assert(Math.abs(c.foldXCm[0] - 0.25 * c.foldScaleX - c.handleXCm) < 1e-9);
}
let sounds = [],
  actors = 0,
  fragments = 0,
  ruby = true,
  clears = 0,
  last;
const kit = new TableKit({
  clearActors() {
    clears++;
    actors = 0;
    fragments = 0;
  },
  drawActor() {
    actors++;
  },
  drawObserved() {
    fragments++;
  },
  drawRuby(_p, v) {
    ruby = v;
  },
  drawCurtain(v) {
    last = v;
  },
  playAtCurtain(s) {
    sounds.push(s);
  },
});
const world = {
  kind: "world",
  revision: "r1",
  actors: [{ role: "Guard", positionCm: [0, 0, 0], yawRad: 0 }],
  ruby: { positionCm: [0, 0, 0], visible: true },
  aperture: 0,
};
kit.render("author", world, 12, { playing: false });
assert.equal(actors, 1);
kit.render(
  "witness",
  { kind: "witness", revision: "r1", fragments: [], aperture: 0 },
  12,
  { playing: false },
);
assert.equal(actors, 0);
assert.equal(ruby, false);
assert.equal(fragments, 0);
assert.throws(() => kit.render("witness", world, 12, { playing: false }));
kit.setCommittedCurtain(0.4);
assert.equal(kit.cancelCurtain(), 0.4);
assert.equal(last.aperture, 0.4);
kit.render("author", world, 12, { playing: true, curtainGrab: "grabbed" });
kit.render("author", world, 12, { playing: true, curtainGrab: "free" });
assert.deepEqual(sounds, ["engage", "latch"]);
kit.render("author", world, 12, { playing: true, curtainGrab: "grabbed" });
kit.render("author", world, 12, { playing: true, curtainGrab: "free" });
assert.equal(sounds.length, 2);
kit.render("author", world, 13, { playing: false, curtainGrab: "grabbed" });
assert.equal(sounds.length, 2);
assert.equal(galleryStates(false).length, 0);
assert.equal(galleryStates(true).length, 6);
const f = {
  position: { x: 1, y: 1, z: 1 },
  projection: { horizontal: 0, vertical: 0 },
  via: "direct",
  segment: "a",
};
assert.deepEqual(
  placeWitnessSample(f, {
    widthCm: 10,
    heightCm: 6,
    horizontalFovRad: 1,
    verticalFovRad: 1,
  }).positionOnGlassCm,
  [0, 0, 0],
);
assert.equal(
  placeWitnessSample(f, {
    widthCm: 10,
    heightCm: 6,
    horizontalFovRad: 1,
    verticalFovRad: 1,
  }).role,
  undefined,
);
assert.equal(groupWitnessSegments([f, { ...f, segment: "b" }]).size, 2);
console.log(
  "PASS mirror clipping/backside/closed; aperture alignment; safe witness transition; rollback; sound dedup/silent scrub; dev gallery; public placement",
);
