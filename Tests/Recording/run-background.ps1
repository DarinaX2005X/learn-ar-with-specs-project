$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
  npx --yes --package typescript@6.0.2 --call 'node Tests/Recording/background.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'Witness background checks failed' }
} finally { Pop-Location }
