$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
 npx --yes --package typescript@6.0.2 tsc --ignoreConfig --strict --target ES2021 --module commonjs --outDir Tests/Detective/build Assets/Detective/index.ts Assets/Domain/cases.ts
 if ($LASTEXITCODE -ne 0) { throw 'Detective TypeScript compilation failed' }
 node Tests/Detective/run.cjs
 if ($LASTEXITCODE -ne 0) { throw 'Detective public API checks failed' }
} finally { Pop-Location }
