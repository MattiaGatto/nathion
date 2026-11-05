# Run after signing in to Tailscale on both PC and Android.
$projectRoot = Split-Path -Parent $PSScriptRoot
$tailCommand = Get-Command tailscale -ErrorAction SilentlyContinue
$tailExecutable = if ($tailCommand) { $tailCommand.Source } else { 'C:\Program Files\Tailscale\tailscale.exe' }
if (-not (Test-Path -LiteralPath $tailExecutable)) {
    throw 'Installa Tailscale da https://tailscale.com/download e accedi sul PC e su Android. Poi riesegui questo script.'
}
$stateText = & $tailExecutable status --json
if ($LASTEXITCODE -ne 0) { throw 'Accedi a Tailscale sul PC prima di continuare.' }
$tailState = $stateText | ConvertFrom-Json -ErrorAction Stop
if ($tailState.BackendState -ne 'Running' -or -not $tailState.Self.DNSName) {
    throw 'Tailscale non risulta connesso. Completa l''accesso con il tuo account.'
}
$dnsName = $tailState.Self.DNSName.TrimEnd('.')
if ($dnsName -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$') { throw 'Nome HTTPS Tailscale non valido.' }
$origin = 'https://' + $dnsName + ':8443'
$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Avvia prima NATHION con start.ps1.' }
$environment = [IO.File]::ReadAllText($envPath)
$originsLine = [regex]::Match($environment, '(?m)^NATHION_CORS_ALLOW_ORIGINS=(.*)$')
$origins = @('http://localhost:4173', 'http://localhost:5173')
if ($originsLine.Success) { $origins += @($originsLine.Groups[1].Value.Trim() | ConvertFrom-Json -ErrorAction Stop) }
$origins += $origin
$origins = @($origins | Select-Object -Unique)
$corsValue = ConvertTo-Json -InputObject $origins -Compress
foreach ($entry in @(@('NATHION_CORS_ALLOW_ORIGINS', $corsValue), @('NATHION_AUTH_COOKIE_SECURE', 'true'))) {
    $key = $entry[0]; $value = $entry[1]
    $pattern = '(?m)^' + [regex]::Escape($key) + '=.*$'
    if ([regex]::IsMatch($environment, $pattern)) {
        $environment = [regex]::Replace($environment, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $key + '=' + $value })
    } else { $environment += "`r`n" + $key + '=' + $value + "`r`n" }
}
[IO.File]::WriteAllText($envPath, $environment, [Text.UTF8Encoding]::new($false))
Push-Location -LiteralPath $projectRoot
try {
    docker compose -f docker-compose.yml -f docker-compose.voice.yml up -d backend
    if ($LASTEXITCODE -ne 0) { throw 'Aggiornamento backend fallito.' }
    & $tailExecutable serve --bg --https=8443 http://127.0.0.1:4173
    if ($LASTEXITCODE -ne 0) { throw 'Serve non attivo. Completa le eventuali richieste HTTPS di Tailscale.' }
    Write-Output ('Apri in Chrome su Android: ' + $origin)
    Write-Output 'Usa la chiave personale, consenti il microfono e installa la PWA dal browser.'
} finally { Pop-Location }
