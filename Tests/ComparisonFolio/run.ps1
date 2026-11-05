$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 --call 'node Tests/ComparisonFolio/run.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'ComparisonFolio regression failed' }
} finally { Pop-Location }
