$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repo '.env'
$keyPath = Join-Path $repo 'backend/data/pc-connector-key.txt'
[IO.Directory]::CreateDirectory((Split-Path -Parent $keyPath)) | Out-Null
if (-not (Test-Path -LiteralPath $keyPath)) {
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [IO.File]::WriteAllText($keyPath, [Convert]::ToHexString($bytes))
}
$key = [IO.File]::ReadAllText($keyPath).Trim()
$settings = [IO.File]::ReadAllText($envPath)
$match = [regex]::Match($settings, '(?m)^NATHION_MCP_SERVERS=(.*)$')
$servers = if ($match.Success -and $match.Groups[1].Value.Trim()) {
    $match.Groups[1].Value.Trim().Trim("'") | ConvertFrom-Json -AsHashtable
} else { @{} }
$servers['pc'] = @{
    url = 'http://host.docker.internal:18753/mcp'
    allowed_tools = @('pc_status','open_calculator','open_notepad')
    headers = @{Authorization="Bearer $key";Host='127.0.0.1:18753'}
}
$entry = 'NATHION_MCP_SERVERS=' + (ConvertTo-Json -InputObject $servers -Depth 8 -Compress)
if ($match.Success) { $settings = $settings.Substring(0, $match.Index) + $entry + $settings.Substring($match.Index + $match.Length) }
else { $settings += "`n$entry`n" }
[IO.File]::WriteAllText($envPath, $settings)
$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 18753 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    $python = Join-Path $repo 'backend/.venv/Scripts/python.exe'
    $script = Join-Path $PSScriptRoot 'pc-connector.py'
    Start-Process -FilePath $python -ArgumentList @('"' + $script + '"') -WorkingDirectory $repo -WindowStyle Hidden
}
Write-Output 'Connettore PC configurato.'
