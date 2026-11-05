$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@5.9.3 --call 'node Tests/AuthorProps/run.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'AuthorProps regression failed' }
} finally { Pop-Location }
