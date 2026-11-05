$projectRoot = $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
    docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        docker desktop start
        if ($LASTEXITCODE -ne 0) { throw 'Avvia Docker Desktop e riprova.' }
    }
    docker compose -f docker-compose.yml -f docker-compose.voice.yml up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw 'Avvio fallito. Controlla Docker Desktop e i log del backend.' }
    $dataPath = Join-Path $projectRoot 'backend/data'
    [IO.Directory]::CreateDirectory($dataPath) | Out-Null
    docker compose cp backend:/app/data/access-token.txt ./backend/data/access-token.txt
    if ($LASTEXITCODE -ne 0) { throw 'Non è stato possibile copiare la chiave locale.' }
    Write-Output 'NATHION avviato: http://localhost:4173'
    Write-Output ('La chiave di accesso è nel file: ' + (Join-Path $dataPath 'access-token.txt'))
    Write-Output 'Nessuna credenziale è stata stampata o aggiunta a Git.'
} finally { Pop-Location }
