$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 --call 'node Tests/ActorRig/run.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'Native rig adapter checks failed' }
 npx --yes --package typescript@6.0.2 --call 'node Tests/ActorRig/detail.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'Cross-pane detail checks failed' }
} finally { Pop-Location }
