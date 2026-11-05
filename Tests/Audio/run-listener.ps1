$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
    npx --yes --package typescript@6.0.2 --call 'node Tests/Audio/spatial-listener.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'Spatial listener regression failed' }
} finally { Pop-Location }
