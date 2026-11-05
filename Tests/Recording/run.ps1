$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 foreach ($name in @('run','author_glass','author_staging','public_cradle','rim-evidence')) {
  npx --yes --package typescript@6.0.2 --call "node Tests/Recording/$name.cjs"
  if ($LASTEXITCODE -ne 0) { throw "Recording $name failed" }
 }
} finally { Pop-Location }
