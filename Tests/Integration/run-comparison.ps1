$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  npx --yes --package typescript@6.0.2 tsc --ignoreConfig --noEmit --strict --skipLibCheck --lib ES2021 --target ES2021 --module commonjs Support/StudioLib.d.ts Assets/Runtime/ComparisonHall.ts
  if ($LASTEXITCODE -ne 0) { throw 'Comparison hall TypeScript compilation failed' }
  npx --yes --package typescript@6.0.2 --call 'node Tests/Integration/comparison.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'Comparison hall integration checks failed' }
} finally { Pop-Location }
