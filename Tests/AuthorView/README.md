# Author camera and isolated changes

From the project root run `powershell -ExecutionPolicy Bypass -File Tests/AuthorView/run.ps1`. TypeScript 6.0.2 is pinned; first use needs npm access.

The tests exercise real AuthorSession, compiler, observer and solver data. Normal MuseumGame dispatch uses the real AuthorController, not a substitute controller. Physical-target tests send the ordinary SIK event sequence into PlayTable and use the real prop interaction controller with mocked scene geometry.

Checks cover fixed-source recording, same-tick original and changed frames, actual culprit and chain-field differences, keep as one reversible revision, unchanged original on discard, stale gesture/revision/role rejection, and pass protection while a trial is active. A cache check confirms playback reuses compiled recordings.

These checks establish application and event wiring. Native glass readability, physical camera labels, bench spacing and hand reach require the integrated Preview review. They are not measured by mocked scene objects.
