$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 foreach ($name in @('check','check-contact','check-legacy','check-exhaustive')) {
  npx --yes --package typescript@6.0.2 --call "node Tests/PublicContacts/$name.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Public contact $name failed" }
 }
} finally { Pop-Location }
