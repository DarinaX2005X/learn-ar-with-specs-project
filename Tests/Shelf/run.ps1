$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Shelf/build Assets/Cases/CaseFlow.ts Assets/Author/AuthorSession.ts
  if ($LASTEXITCODE -ne 0) { throw 'Shelf TypeScript compilation failed' }
  node Tests/Shelf/check.cjs (Join-Path $PSScriptRoot 'build')
  if ($LASTEXITCODE -ne 0) { throw 'Shelf tests failed' }
  Write-Output 'Shelf checks passed'
} finally { Pop-Location }
