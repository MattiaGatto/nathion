$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $name = docker compose exec -T backend python scripts/backup_database.py
    if ($LASTEXITCODE -ne 0) { throw 'Backup del database fallito.' }
    $name = $name.Trim()
    if ($name -notmatch '^manual-[0-9-]+\.sqlite3$') { throw 'Nome del backup non valido.' }
    $directory = Join-Path $projectRoot 'backend/data/backups'
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $destination = Join-Path $directory $name
    docker compose cp ('backend:/app/data/backups/' + $name) $destination
    if ($LASTEXITCODE -ne 0) { throw 'Copia del backup fallita.' }
    Write-Output ('Backup verificato salvato in: ' + $destination)
    Write-Output 'Contiene dati e credenziali: conservalo in privato.'
} finally { Pop-Location }
