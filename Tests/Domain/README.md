# Domain checks

From the project root, run:

```powershell
powershell -ExecutionPolicy Bypass -File Tests/Domain/run.ps1
```

The runner compiles only `Assets/Domain` in strict TypeScript mode targeting
ES2021, then runs Node assertions. TypeScript 6.0.2 is pinned; the first run
requires npm package access. Generated JavaScript stays in ignored `build/`.
No Lens Studio or DOM is required.

Runtime imports come from `Assets/Domain/index.ts`. `createMirrorCase()` and
`createPackingCase()` produce editable sample drafts. `compileCase()` returns
an immutable `sealed` public board/tape separately from the owner's `vault`.
Only pass `sealed` to investigation code. Compilation errors identify an object
and, when applicable, the offending tick.

`createMuseumTheft()` is the moving product staging. The static
`createMirrorCase()` keeps the numeric optics regression fixture unchanged.
Both preserve two full-tape culprits behind the closed curtain and one when
the finite mirror is visible.

`observe(board, history)` reconstructs exactly the public tape for a legal
alternative history. `frameAt(tape, witnessId, integerTick)` returns only the
requested discrete frame; it never joins separate visibility segments.

`getObservations(tape, witnessId, tick)` derives separately selectable public
views. `observation.kind === "fragment"` contains exactly one observed surface
and its visible mark; it says nothing about other figures, hands or actions in
that frame. Separate `hand`, `action` and `exhibit` views expose only their own
channel. Empty-hand evidence refers to one visible position, while an empty
exhibit is a visible recorded state. Source frame IDs keep their original exact
whole-frame meaning. Derived IDs include case, revision, source, tick and channel;
they never encode the hidden actor. Repeated compilation produces the same IDs.

`resolveObservation(tape, id)` resolves both these views and existing root/object
clues. `compareObservations(originalTape, candidateTape, selectedIds)` preserves
the same masks when comparing reconstructions. Full-tape comparisons still use
every complete root frame and object state; derived views are never appended as
duplicate facts. Pin the direct courier and reflected guard separately to prove
the first case. Either one alone leaves two possible culprits; removing either
reopens the question.

For public paper-glass rendering, pass a frame fragment and the public TableKit
`roleSilhouette(fragment.role)` outline to
`projectVisibleSurface(board, witnessId, fragment, outline)`. It returns angular
triangles of the actual observed marker plane (`surfaceRight` comes from the
public pose yaw). Finite wall shadows and both mirror legs are clipped on that
plane. Closed or back-facing mirrors produce no patches. Do not substitute a
live full actor mesh. An unrecognised fragment must use the generic anonymous
outline. Surface generation runs only for displayed frames and does not enter
proof enumeration.

For a perspective glass, map each angular vertex using `x = tan(horizontal)` and
`y = tan(vertical) * sqrt(1 + x*x)`, then scale by the display frustum tangents.
The display frustum must be narrower than 180 degrees; `tan(PI/2)` collapses
otherwise valid samples. A display crop and the original witness capture angle
are distinct settings. The tests use the actual TableKit head outlines and check
interior points of every projected triangle against the separate ray predicate.

`prove(board, tape, selectedIds, claim)` uses selected clues for concrete claims.
An `Underdetermined` claim, including one inside a compound claim, checks the
entire tape and returns `scope: "all"`. Each field's values and counterexamples
come from the same complete compatible histories. `None` is an explicit absence
of a transfer/cache, whereas `Underdetermined` requires multiple values.

`historyCount` counts histories, including different legal contact ticks;
`possibleCulprits` counts people. Examples are full legal histories, and their
scope is the verdict's scope. `exclusions` gives inclusion-minimal sufficient
evidence per excluded taker; it does not claim a globally shortest proof.

For a Lens Update loop, consume `proveSteps(...)` as a generator. Each `next()`
processes at most 8 search candidates between progress yields by default (plus final
projection work). Its final return value is the verdict. `cancelled` should
compare the captured case revision with the current revision. `batchSize` can
reduce the batch to one candidate when a render loop needs finer scheduling;
candidate counts are deterministic and are not a wall-clock frame-time guarantee.
The cancellation callback should
compare the captured case revision with the current revision. Drop a stale task
instead of applying its result. `maxHistories` bounds evaluated search work,
including factored contact candidates; reaching it yields `incomplete`, never
an accusation. The synchronous `prove` convenience function drains this task.

Checks cover finite mirror geometry, role swaps, revision isolation, full-tape
counterexamples, independent exhaustive chain enumeration, timeless traces,
selected versus complete evidence, multi-source proof, correlated compound
answers and incomplete/cancelled work. They establish domain behavior only;
they do not establish rendering or interaction quality in Preview.
