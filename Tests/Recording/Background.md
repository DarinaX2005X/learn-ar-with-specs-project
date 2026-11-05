# Witness background

Run from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File Tests/Recording/run-background.ps1
```

The runner typechecks the pure module in strict ES2021 mode and tests the actual
moving museum case. It checks finite reflection and shutter boundaries, nearest
screens on both ray legs, head versus background depth, positive triangle winding,
plate bounds, cache reuse, independence from actor data and fixed crop behavior.
The exact projected wooden rim survives even when its width is below one raster
cell. No Lens, camera input, author history, events or actor textures are used.

`getWitnessBackground(board, witnessId, options).sample(viewport, 64, 40)` returns
`batches` with tangent plane `vertices`, triangle `indices`, `color` and `layer`.
The viewport uses side/depth and height/depth, matching RecordedGlass's perspective
projection. Keep its existing crop and gain. The renderer maps these vertices with
that same transform, behind the unchanged observed head and costume polygons.
The backdrop does not participate in selectable-fragment bounds or focus inks.

The shipped gallery uses a 3.8 m room, 2.5 cm horizontal mirror trim and 3.5 cm
vertical trim. Pass these public rendering dimensions explicitly. Plane partitions
are the default so their opacity matches the proof kernel. Optional solid public
partition thickness adds top and end faces; it is never inferred from a person's
appearance. The sampled colours provide plaster, real floor parquet, teal skirting,
wooden screens, the frame and its one-bounce view of the static room. Ruby contents
and all people remain the separate recorded-evidence renderer's responsibility.

At most eight raster colour groups plus two analytic rim groups are produced.
Every vertex is clipped to the supplied finite plate. `layer` expresses only the
order of static relief; all layers stay behind the observed patches. Entry pane
and loupe share the same revision-bound static cache. A stable common recording
crop reuses one field throughout all ticks. Explicit detail uses its own bounded
crop without moving the fixed witness.

Local Node 22.13 VM measurements for a fresh 64 by 40 field varied approximately
12 to 20 ms under concurrent development load. Cached reuse was approximately
0.03 to 0.04 ms. These are CPU helper measurements, not Lens frame-time evidence.
Native composition and playback require their own Preview check.
