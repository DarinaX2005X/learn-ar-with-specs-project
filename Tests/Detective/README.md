# Detective checks

Run `powershell -ExecutionPolicy Bypass -File Tests/Detective/run.ps1` from the project root. TypeScript 6.0.2 is pinned and requires npm package access on first run. Tests use typed authored fixtures compiled into real sealed public cases without Lens Studio.

The session accepts only a sealed case. Each evidence tab keeps its original clue ID, source and tick. `update(seconds)` drains at most two solver yields. Any claim or evidence change discards stale proof. Unknown claims check every clue. `dispose()` clears the mounted view before role changes. Archive restoration rejects other revisions and recomputes proof.

Scene integration supplies `DetectivePort`, renders `observationGlass` on fixed recording glass, and binds `detectiveControls` to SIK and focus targets. Possible reconstructions come from the public solver. Author poses must never enter the witness renderer.

These checks establish command and proof behavior. Physical input, glass legibility, transitions and seated reach require Preview inspection.
