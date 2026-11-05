$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Domain/build Assets/Domain/index.ts
  if ($LASTEXITCODE -ne 0) { throw 'Domain TypeScript compilation failed' }
  npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Domain/build-art Assets/Scripts/TableKit/RoleSilhouette.ts
  if ($LASTEXITCODE -ne 0) { throw 'Public silhouette TypeScript compilation failed' }
  node Tests/Domain/run.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Domain tests failed' }
} finally { Pop-Location }
