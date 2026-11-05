$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tail = 'C:/Program Files/Tailscale/tailscale.exe'
$state = & $tail status --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $state.BackendState -ne 'Running') { throw 'Connetti prima Tailscale sul PC.' }
$name = $state.Self.DNSName.TrimEnd('.')
$ip = $state.TailscaleIPs | Where-Object { $_ -match '^100\.[0-9]+\.[0-9]+\.[0-9]+$' } | Select-Object -First 1
if (-not $ip -or $name -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$') { throw 'Indirizzo Tailscale non valido.' }
$openssl = (Get-Command openssl -ErrorAction Stop).Source
$tls = Join-Path $repo 'android/.signing/tls'
[IO.Directory]::CreateDirectory($tls) | Out-Null
function Run-OpenSsl([string[]]$arguments) {
    & $openssl @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Generazione del certificato fallita.' }
}
Push-Location -LiteralPath $tls
try {
    [IO.File]::WriteAllLines((Join-Path $tls "openssl.cnf"), @("[req]","distinguished_name=dn","[dn]"))
    if (-not (Test-Path 'ca.crt') -and -not (Test-Path 'ca.key')) {
        Run-OpenSsl @('req','-config','openssl.cnf','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','3650','-subj','/CN=NATHION Private Root','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout','ca.key','-out','ca.crt')
    }
    if (-not (Test-Path 'ca.crt') -or -not (Test-Path 'ca.key')) { throw 'Manca parte della chiave TLS esistente.' }
    if (-not (Test-Path 'server.crt') -or -not (Test-Path 'server.key') -or -not (Test-Path 'hostname.txt') -or (Get-Content 'hostname.txt' -Raw).Trim() -ne $name) {
        [IO.File]::WriteAllLines((Join-Path $tls 'server.ext'), @("subjectAltName=DNS:$name",'basicConstraints=critical,CA:FALSE','keyUsage=critical,digitalSignature,keyEncipherment','extendedKeyUsage=serverAuth'))
        Run-OpenSsl @('req','-config','openssl.cnf','-new','-newkey','rsa:2048','-nodes','-subj',"/CN=$name",'-keyout','server.key','-out','server.csr')
        Run-OpenSsl @('x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','365','-sha256','-extfile','server.ext','-out','server.crt')
        [IO.File]::WriteAllText((Join-Path $tls 'hostname.txt'), $name)
    }
} finally { Pop-Location }
$origin = "https://${name}:8443"
$envFile = Join-Path $repo '.env'
$envText = [IO.File]::ReadAllText($envFile)
$match = [regex]::Match($envText, '(?m)^NATHION_CORS_ALLOW_ORIGINS=(.*)$')
$origins = if ($match.Success) { @($match.Groups[1].Value.Trim() | ConvertFrom-Json) } else { @('http://localhost:4173','http://localhost:5173') }
$origins = @(($origins + $origin) | Select-Object -Unique)
$values = @{
    COMPOSE_PATH_SEPARATOR = ';'
    COMPOSE_FILE = 'docker-compose.yml;docker-compose.voice.yml;docker-compose.android.yml'
    NATHION_TAILSCALE_IP = $ip
    NATHION_AUTH_COOKIE_SECURE = 'true'
    NATHION_CORS_ALLOW_ORIGINS = (ConvertTo-Json -InputObject $origins -Compress)
}
foreach ($key in $values.Keys) {
    $pattern = '(?m)^' + [regex]::Escape($key) + '=.*$'
    $entry = $key + '=' + $values[$key]
    if ([regex]::IsMatch($envText, $pattern)) { $envText = [regex]::Replace($envText, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $entry }) }
    else { $envText += "`n$entry`n" }
}
[IO.File]::WriteAllText($envFile, $envText)
Write-Output "Indirizzo APK: $origin"
