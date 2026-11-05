# Detective checks

Run `powershell -ExecutionPolicy Bypass -File Tests/Detective/run.ps1` from the project root. TypeScript 6.0.2 is pinned and requires npm package access on first run. Tests use typed authored fixtures compiled into real sealed public cases without Lens Studio.

The session accepts only a sealed case. Each evidence tab keeps its original clue ID, source and tick. `update(seconds)` drains at most two solver yields. Any claim or evidence change discards stale proof. Unknown claims check every clue. `dispose()` clears the mounted view before role changes. Archive restoration rejects other revisions and recomputes proof.

Scene integration supplies `DetectivePort`, renders `observationGlass` on fixed recording glass, and binds `detectiveControls` to SIK and focus targets. Possible reconstructions come from the public solver. Author poses must never enter the witness renderer.

These checks establish command and proof behavior. Physical input, glass legibility, transitions and seated reach require Preview inspection.

Recorded frames remain whole for viewing, but evidence glasses select one public observation. `state.observations` contains independent fragment, hand, action and exhibit views with opaque revision-bound IDs. `selectObservation` focuses one current view, and `pin` attaches that view. `focusedObservation` feeds an honest loupe while `frame` keeps the complete recording. Unselected multi-observation recordings cannot be pinned as one clue. Each chip, undo item and archived reference retains its independent observation ID.

The independent-observation control loop checks both pin orders. One mark leaves the accusation open. The direct Courier plus reflected Guard proves it. Removing either withdraws proof, undo restores it, and archive restoration returns the exact selected surface at its original source and tick. Whole-tape ambiguity and chain checks retain the original sealed tape.
