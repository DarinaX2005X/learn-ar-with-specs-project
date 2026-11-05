# Comparison hall checks

Run from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File Tests/Integration/run-comparison.ps1
```

The checks execute the native `ComparisonHall` factory and its real `SpatialStage`,
`TableKit`, reconstruction and public evidence code against a small SceneObject
transform implementation. They cover the two public examples from the closed
moving museum case, every integer tick, reverse seeking, selected evidence scope,
revision rejection, forbidden script-bearing templates, teardown and view return.
They establish placement and lifecycle behavior, not GPU appearance or human
readability. Preview still needs a representative live comparison and return.

The quaternion regression deliberately folds Euler Y outside 90 degrees. Native
IK uses the exact authored pose instead of recovering a heading from a quaternion.
Fractional presentation is sampled from the existing session playback clock;
integer recorded frames and evidence remain unchanged.

`ComparisonHall` owns only temporary native model clones. It leaves the connected
museum, original case, camera, recording pane and clock intact. Its default two
70 by 50 cm gallery studies sit on the existing conservation bench as one object.
Their labels state the different answers and the evidence scope. No new source
recording, independent time source, SIK controller or author vault is created.

The production owner calls `sync(board, comparison, context)` after the ordinary
public walls are present. The comparison request contains two legal histories,
the disputed field, the scope and the original public WitnessTape. Context contains
the one authoritative tick, witness, selected observation IDs and version index.
An active comparison returns true. MuseumScene then hides its ordinary live cast
and ruby while leaving the public recorded glass visible. Clear, close, handoff,
reveal and teardown must call `exit()` or `dispose()`. After exit, the normal scene
renderer derives the full room from the current role snapshot again.

`applyCaseView({kind, placement})` accepts the existing view router's story board
minimum-floor origin in world centimetres. Table mode keeps both plays grouped;
room mode shows only the chosen version. `applyCaseView(undefined)` restores the
bench presentation. The helper never writes to a camera. `exit()` returns a copy
of the entry SpatialContext for the caller's station and time restoration; it also
destroys every clone and clears retained pair/tape references.
