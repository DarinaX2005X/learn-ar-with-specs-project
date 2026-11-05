$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
 foreach ($name in @('run','bench-clock','bench-clock-direction','bench-clock-geometry')) {
  npx --yes --package=typescript@6.0.2 --call "node $name.cjs"
  if ($LASTEXITCODE -ne 0) { throw "MuseumGame $name regression failed" }
 }
} finally { Pop-Location }
