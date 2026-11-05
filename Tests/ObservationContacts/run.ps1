$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 --call 'node Tests/ObservationContacts/run.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'ObservationContacts regression failed' }
 npx --yes --package typescript@6.0.2 --call 'node Tests/ObservationContacts/recorded.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'Actual recording to control coupling failed' }
 npx --yes --package typescript@6.0.2 --call 'node Tests/ObservationContacts/evidence-lift.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'Physical evidence lift regression failed' }
} finally { Pop-Location }
