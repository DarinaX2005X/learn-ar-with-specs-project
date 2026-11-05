$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    npx --yes --package=typescript@6.0.2 --call 'node run.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'MuseumGame route checks failed' }
} finally {
    Pop-Location
}
