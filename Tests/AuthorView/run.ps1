$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/AuthorView/build Assets/Author/AuthorViewSession.ts Assets/Domain/index.ts
 if ($LASTEXITCODE -ne 0) { throw 'Author view TypeScript compilation failed' }
 node Tests/AuthorView/session.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Author view session checks failed' }
 npx --yes --package typescript@6.0.2 --call 'node Tests/AuthorView/playtable.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'Author view physical input route checks failed' }
 npx --yes --package typescript@6.0.2 --call 'node Tests/AuthorView/museumgame.cjs'
 if ($LASTEXITCODE -ne 0) { throw 'Author view MuseumGame checks failed' }
} finally { Pop-Location }
