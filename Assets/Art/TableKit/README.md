# Countercase TableKit

Original carved puppet geometry and PBR materials. No external meshes, character
likenesses or reference-room images are embedded. MuseumBuilding embeds the four
original Collection artwork/surface JPEGs; puppet models use geometric materials.

MuseumBuilding is a full-size connected four-room museum, not a miniature.
It mounts at identity with metre geometry and Lens import scale 100. Story +Z
points into the building. Ruby Hall is X=[0,7], Z=[0,5] m; foyer X=[0,7],
Z=[−5,0]; workshop X=[−5,0], Z=[0,5]; archive X=[−5,0], Z=[−5,0].
The entrance viewer is (3.5,1.65,−3.4), looking +Z. Five genuine arched openings
connect the outside and rooms; the roof, pilasters and floors form one building.
The central hall contains no new interior sight-line obstacles. Game-case walls,
actors, mirror and ruby display remain mounted by the authoritative runtime.
MuseumBuilding.contract.json lists all semantic interaction anchors in metres.
The two framed Collection paintings use full 3:2 UVs, while oak/plaster tiles
repeat at 0.70×0.18 m and 1.6×1.6 m. JPEGs stay sRGB; every palette multiplier
is converted to linear RGB for glTF baseColorFactor.

Import each GLB as its own model/prefab. Files use metres, +Y up and front −Z.
Lens Studio's imported model uses scale 100 to display centimetres. Keep that
imported transform; animate an outer unit-scale wrapper. `manifest.json` gives
measured AABBs and exact node names. Human heights are 10.33–10.60 cm on the table;
scale the outer theatre wrapper by 100/6 for approximately 1.75 m figures.

Each role has Head, Shoulder_L/R → Forearm_L/R → Hand_L/R and Hip_L/R → Knee_L/R.
Shoulders, elbows and wrists have separate local pivots. Palms and curved fingers
belong to the corresponding Hand node. Poses are Euler radians at the runtime
port; apply rotations to these joint nodes without modifying mesh geometry.
Faces include individual eyes, brows, projecting nose, ears, jaw and mouth.
Guard has a broad peaked cap, moustache and shield; Courier has a projecting
satchel, strap and soft cap; Conservator has round spectacles, bun and apron.
AnonymousTrack is a blank stone articulated mannequin with no face, hat, role
mark or accessory. It is for public unnamed paths, never an unknown actor's
hidden silhouette. RoleMarkGuard/Courier/Conservator are standalone exports of
the exact chest mark geometry, centred at their origins. RoleMarkAnonymous is
a neutral solid tile. The known marks are 0.42–0.55 cm; scale their outer
recording-glass wrapper to the intended label size. `WitnessPlacement.ts` maps
public angular sample centres into that fixed glass. Its result explicitly
requires an observed mask before drawing any larger body geometry.

Place actors on floor Y=0.11 cm relative to Plinth root. Plinth extends below its
root; do not ground its AABB instead. DisplayCase stands at Y=0; Ruby starts at
DisplayCase root + (0,6.12,0) cm. Remove the separate Ruby model to expose its socket.
Glass meshes are optional. Brass uprights and cushion remain legible without them.
Camera faces −Z along the lens and has no rear lens.

MirrorHousing and Curtain share the same placement. Mirror plane is Z=0; front
faces −Z. The finite opening is X=[−3,3], Y=[1,11] cm. `OpaqueBack` is an opaque
backside shell, not a reflection texture. For the fixed witness camera,
`MirrorProxy.reflectObservedTriangles` reflects and clips already-observed
geometry. It reverses triangle winding and recomputes normals. It rejects back
view, closed opening and physical geometry behind the mirror. Visibility and
obstruction selection belong to the domain compiler; this utility cannot grant
visibility. Never copy SIK components into a proxy. Hide proxies when viewing the
back and clip to the original fixed observer; orbiting a recording must not reveal
unrecorded sides. Set the proxy rendering layer/compositing so OpaqueBack does not
erase observed proxy fragments behind the plane. A render-target stencil or
depth-aware fixed-camera projection is the scene integrator's responsibility.

`TableKit.ts` exports typed render/bind ports, shared copy and a developer-only
state gallery description. Implement the ports against imported nodes. For
Curtain, use `curtainVisual`: set Fold_00…11 and Ring_00…11 local X from foldXCm,
scale only Fold nodes in X by foldScaleX, and set Handle X from handleXCm. Keep
their imported Y/Z. Opening is [−3,−3+6×aperture]; gathered cloth moves outside the
right opening at full travel. HandleFocus is enabled only for focus/grab. Preserve
its material separately from the handle's brass. Authoritative aperture drives
both geometry and witness compilation without a delayed reveal animation.

`render('witness', …)` accepts only public observed fragments and clears live
actors/ruby first. An anonymous fragment must not carry role-specific silhouette,
mark, colour, accessory or shadow. The port implementation must clear cached
proxies and labels on every mode transition. Playback sounds are at the curtain,
silent when scrubbing/muted and deduplicated by revision/tick/type. Seed the
committed aperture on case load; cancellation restores it. SIK must call dispatch
once per authoritative release, not every frame.

Regenerators live in `Tools/TableKit`. Mesh generator requires Python+numpy;
audio generator requires the locally installed official CLAD synthesis engine.
Run `python Tools/TableKit/test_tablekit.py` from the repository root for asset
validation and strict adapter tests with pinned TypeScript 5.9.3 and temporary
build output.
The three WAVs are original algorithmic cloth/engagement/latch foley at 44.1 kHz,
with high-pass filtering and faded tails. No music or hidden-action cues.

Suggested key light direction (−0.6,1,−0.7), warm white #FFF1D2, cool fill #BFE7DF,
fill/key 0.38. GLB materials use the common limestone/teal/ruby/cream/brass family.
No emission is used to imply hidden ruby ownership. Physical additive-display
legibility, Stereo Preview, live aperture clipping, SIK cancellation and audio
timing require review in the assembled Lens.
