param([int]$VersionCode = 5)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $PSScriptRoot '.tools'
$env:JAVA_HOME = (Get-ChildItem (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
$androidJar = (Get-ChildItem (Join-Path $tools 'platform') -Recurse -Filter android.jar | Select-Object -First 1).FullName
$buildTools = (Get-ChildItem (Join-Path $tools 'build-tools') -Recurse -Filter aapt2.exe | Select-Object -First 1).DirectoryName
if (-not $env:JAVA_HOME -or -not $androidJar -or -not $buildTools) { throw 'Installa il JDK 17 e gli strumenti SDK indicati nella guida.' }
$javaBin = Join-Path $env:JAVA_HOME 'bin'
$build = Join-Path $PSScriptRoot 'build'
$signing = Join-Path $PSScriptRoot '.signing'
[IO.Directory]::CreateDirectory($signing) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $build 'classes')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $build 'dex')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $build 'res/drawable')) | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'frontend/public/icon-192.png') -Destination (Join-Path $build 'res/drawable/nathion.png')
Copy-Item -Path (Join-Path $PSScriptRoot 'res/*') -Destination (Join-Path $build 'res') -Recurse -Force
$manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'AndroidManifest.xml')) -replace 'android:versionCode="[0-9]+"', "android:versionCode=`"$VersionCode`""
$tls = Join-Path $signing 'tls'
if ((Test-Path (Join-Path $tls 'ca.crt')) -and (Test-Path (Join-Path $tls 'hostname.txt'))) {
    $hostName = [IO.File]::ReadAllText((Join-Path $tls 'hostname.txt')).Trim()
    if ($hostName -notmatch '^[a-zA-Z0-9.-]+\.ts\.net$') { throw 'Nome Tailscale non valido.' }
    foreach ($folder in @('raw','xml','values')) {
        [IO.Directory]::CreateDirectory((Join-Path $build "res/$folder")) | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $tls 'ca.crt') -Destination (Join-Path $build 'res/raw/nathion_ca.crt')
    [IO.File]::WriteAllText((Join-Path $build 'res/xml/private_network.xml'), "<network-security-config><domain-config cleartextTrafficPermitted='false'><domain>$hostName</domain><trust-anchors><certificates src='@raw/nathion_ca'/><certificates src='system'/></trust-anchors></domain-config></network-security-config>")
    [IO.File]::WriteAllText((Join-Path $build 'res/values/private_host.xml'), "<resources><string name='private_host'>https://${hostName}:8443</string></resources>")
    $manifest = $manifest.Replace('<application ', '<application android:networkSecurityConfig="@xml/private_network" ')
}
$manifestFile = Join-Path $build 'AndroidManifest.xml'
[IO.File]::WriteAllText($manifestFile, $manifest)
function Check-Step([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "Build Android fallita durante $step" }
}
& (Join-Path $buildTools 'aapt2.exe') compile --dir (Join-Path $build 'res') -o (Join-Path $build 'resources.zip')
Check-Step 'risorse'
$unsigned = Join-Path $build 'unsigned.apk'
& (Join-Path $buildTools 'aapt2.exe') link -o $unsigned -I $androidJar --manifest $manifestFile (Join-Path $build 'resources.zip')
Check-Step 'manifest'
& (Join-Path $javaBin 'javac.exe') -encoding UTF-8 --release 8 -classpath $androidJar -d (Join-Path $build 'classes') (Join-Path $PSScriptRoot 'src/MainActivity.java')
Check-Step 'compilazione Java'
$classFiles = @(Get-ChildItem (Join-Path $build 'classes') -Recurse -Filter '*.class' | ForEach-Object FullName)
& (Join-Path $javaBin 'java.exe') -cp (Join-Path $buildTools 'lib/d8.jar') com.android.tools.r8.D8 --lib $androidJar --min-api 26 --output (Join-Path $build 'dex') @classFiles
Check-Step 'compilazione DEX'
& (Join-Path $javaBin 'jar.exe') uf $unsigned -C (Join-Path $build 'dex') classes.dex
Check-Step 'impacchettamento'
$aligned = Join-Path $build 'aligned.apk'
& (Join-Path $buildTools 'zipalign.exe') -f 4 $unsigned $aligned
Check-Step 'allineamento'
$key = Join-Path $signing 'nathion.p12'
$passwordFile = Join-Path $signing 'password.txt'
if (-not (Test-Path -LiteralPath $passwordFile)) {
    if (Test-Path -LiteralPath $key) { throw 'Manca la password della chiave di firma esistente.' }
    $bytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    [IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String($bytes))
}
$env:NATHION_APK_SIGNING_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
try {
    if (-not (Test-Path -LiteralPath $key)) {
        & (Join-Path $javaBin 'keytool.exe') -genkeypair -alias nathion -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=NATHION' -storetype PKCS12 -keystore $key -storepass:env NATHION_APK_SIGNING_PASSWORD
        Check-Step 'chiave di firma'
    }
    $apk = Join-Path $build 'NATHION.apk'
    $signer = Join-Path $buildTools 'lib/apksigner.jar'
    & (Join-Path $javaBin 'java.exe') -jar $signer sign --ks $key --ks-key-alias nathion --ks-pass env:NATHION_APK_SIGNING_PASSWORD --out $apk $aligned
    Check-Step 'firma'
    & (Join-Path $javaBin 'java.exe') -jar $signer verify --verbose $apk
    Check-Step 'verifica firma'
    Write-Output $apk
} finally {
    Remove-Item Env:NATHION_APK_SIGNING_PASSWORD
}
