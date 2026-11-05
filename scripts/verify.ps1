param([switch]$LocalAI)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Prepara il backend con uv sync --all-extras prima della verifica.' }
Push-Location -LiteralPath (Join-Path $projectRoot 'backend')
try {
    & $python -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Test backend non superati.' }
} finally { Pop-Location }
Push-Location -LiteralPath (Join-Path $projectRoot 'frontend')
try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Test frontend non superati.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Compilazione frontend fallita.' }
    npm audit --audit-level=moderate
    if ($LASTEXITCODE -ne 0) { throw 'Controllo dipendenze frontend non superato.' }
} finally { Pop-Location }
if ($LocalAI) {
    Push-Location -LiteralPath (Join-Path $projectRoot 'backend')
    try {
        foreach ($script in @('check_stack.py','check_product.py','check_memory.py','check_multi_voice.py','check_cancellation.py','check_mcp_http.py','check_schedules.py','check_proposals.py','check_compatible.py','check_accounts.py')) {
            & $python ('scripts/' + $script)
            if ($LASTEXITCODE -ne 0) { throw ('Verifica reale fallita: ' + $script) }
        }
    } finally { Pop-Location }
}
Write-Output 'Verifiche richieste completate.'
