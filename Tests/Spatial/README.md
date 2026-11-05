
# Spatial checks

Run from repository root:
`powershell -ExecutionPolicy Bypass -File Tests/Spatial/run.ps1`

The tests compile the actual Domain, Detective-compatible histories, TableKit and
Spatial modules. They use compiled closed-curtain and packing cases, actual solver
histories, every public recording tick, hand transfer, reverse seek, cache state,
scale input round trip and disposal. No scene or editor state is changed.

Scene mounting: SpatialStage takes two existing TableKit instances and a separate
recording TableKit. Its context keeps the selected clue IDs, witness, tick, version
index and verdict identity. Only its own explicit play/update clock moves both
hypotheses. A recordingAt callback must read the sealed recording, never a history
or author renderer. finishTimeDrag must commit/release the active time input before
readContext is called. The callback must not clear selection. setHandTargets must
solve the actual imported shoulder/elbow/hand joints in story cm. Labels and return
handle belong to the unscaled near-player rail. setFrameCovered must cover the
relocation synchronously; a native asynchronous cover needs to delay uncovering
until the next rendered frame. In room mode one version is visible, with switching
at the same tick. Wide table mode shows both. Reveal remains an explicit controller
permission outside this module.

Geometry units: Domain metres become story cm. TheatreMount places a root with
scale .06 on table and 1 in room mode. Imported tabletop TableKit meshes need the
separate geometry wrapper scale 100/6. If the existing port uses tabletop cm,
tableKitModelView converts positions instead; do not apply both conversions.

Not proven here: assembled Preview pixels, native integration of the arm adapter, legibility of
both wings, narrow FOV, full speed movement, cover timing, accessibility of return,
real room walking safety, LEAF and audio. One studio operator must review the
integrated Preview. There are no browser or substitute preview claims.

Arm mounting

`ArmIK.ts` extracts the actual three shipped role GLB pivots. The imported upper
bone vector is (.231,-1.61,0) tabletop cm, lower is (0,-1.344,0). Maximum wrist
reach is 2.9705 tabletop cm, approximately 49.51 story cm. The solver preserves
both lengths. It places the palm top surface contact rather than the wrist at
the ruby target. A bounded upper-body offset adds up to 12 story cm of lean;
unreachable targets return a measured residual and `reachLimited`, never success.

Mount once per role: create a zero-position `UpperBody` wrapper below the imported
role root (whose scale100 is preserved). Reparent torso/head and both shoulder
branches into it while retaining their authored local transforms. Keep hips and
legs outside. Pass the wrapper, actual `Shoulder_R`, `Forearm_R`, and `Hand_R`
SceneObjects to `LensArmAdapter`. Transforms are cached once. Use factories
`vector:(x,y,z)=>new vec3(x,y,z)` and
`quaternion:(x,y,z,w)=>new quat(w,x,y,z)`. Default translation units are raw GLB
units, as verified against Scene.scene shoulder local (.01225,.06965,0).

After setting actor root pose, call `adapter.apply(actor, hand.handCm)` using the
actual native root yaw (including any mesh-facing correction) and absolute
story cm coordinates. The adapter rotates the target into model coordinates,
solves shoulder/elbow/wrist local quaternions and sets the wrapper lean. Do not
apply an Euler shoulder reach after this call. All models share measured pivots.

Regression evidence: 3,783 mounted FK samples across actual and solver-produced
full histories of both cases, at quarter-tick increments, maximum measured palm
contact residual below 0.000001 story cm; maximum lean 9.988 story cm. This
includes both recipients and both cache inputs. Mesh intersection, native
rendering and motion rhythm still need the integrated Preview.

Building route

`WorldPlacement.ts` uses the unflipped canonical Domain +Z story frame. Floor is
Y0, default eye165cm, camera identity faces -Z. Main hall X0..700,Z0..500cm;
entrance X0..700,Z-500..0; workshop X-500..0,Z0..500; archive X-500..0,Z-500..0.
The GLB contains actual doorway openings. Human scale replaces the table as the
initial mode. Accessible movement follows connected door-centre polylines and
never calls seek, changes evidence or restarts playback. Natural tracked walking
only updates current room via `observeLocalHead`.

`visibleEntry(board)` checks centre and eight exhibit edges against actual Domain
walls and main-door jambs at eye165cm. Current Missing Ruby chooses
(450,165,-340)cm, native camera yaw2.852617rad. Packing Room chooses
(375,165,-340)cm, yaw2.925178rad. With current tracked head and yaw, call
`buildingAnchorForViewer(head,yaw,165,entry)` once and apply its origin/yaw to the
whole building and gameplay root, keeping the tracked camera stationary.

The seated route circulates behind the shipped screens at Z470 and west of the
entry screen at X80, rather than walking through them. Tests check every route
segment against actual domain walls. Custom case walls can invalidate this
circulation strip and require a route planner or explicit blockage feedback.
A real continuous WASD-like Preview walk, doorway proportions, human-scale
comfort and apparent arrival hierarchy remain operator review tasks.

