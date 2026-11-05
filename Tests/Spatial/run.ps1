$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Spatial/build Assets/Spatial/index.ts Assets/Domain/index.ts Assets/Domain/cases.ts Assets/Spatial/PlantedGait.ts
 if ($LASTEXITCODE -ne 0) { throw 'Spatial TypeScript compilation failed' }
 node Tests/Spatial/run.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Spatial regression checks failed' }
 node Tests/Spatial/grasp.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Grasp choreography checks failed' }
 node Tests/Spatial/CaseViewRouting/run.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Case view routing checks failed' }
 npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --skipLibCheck --lib ES2021 --target ES2021 --module commonjs --outDir Tests/Spatial/build-handles Support/StudioLib.d.ts Assets/Runtime/CaseViewHandles.ts
 if ($LASTEXITCODE -ne 0) { throw 'Native case view handles compilation failed' }
 node Tests/Spatial/CaseViewRouting/handles.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Native case view grip slot checks failed' }
 node Tests/Spatial/CaseViewRouting/room-pair.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Full-size approved pair regression failed' }
} finally { Pop-Location }
