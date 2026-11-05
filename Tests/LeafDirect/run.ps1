$ErrorActionPreference = 'Stop'
$check = Join-Path $PSScriptRoot 'check.cjs'
npx --yes --package typescript@6.0.2 -c "node `"$check`""
if ($LASTEXITCODE -ne 0) { throw 'Direct reach fixture regression failed' }
