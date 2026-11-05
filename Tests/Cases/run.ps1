$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Cases/build Assets/Cases/CaseFlow.ts Assets/Author/AuthorSession.ts
  if ($LASTEXITCODE -ne 0) { throw 'Case flow TypeScript compilation failed' }
  node Tests/Cases/check.cjs (Join-Path $PSScriptRoot 'build')
  if ($LASTEXITCODE -ne 0) { throw 'Case flow tests failed' }
  Write-Output 'Case flow checks passed'
} finally { Pop-Location }
