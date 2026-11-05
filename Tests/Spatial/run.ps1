$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Spatial/build Assets/Spatial/index.ts Assets/Domain/index.ts Assets/Domain/cases.ts
 if ($LASTEXITCODE -ne 0) { throw 'Spatial TypeScript compilation failed' }
 node Tests/Spatial/run.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Spatial regression checks failed' }
} finally { Pop-Location }
