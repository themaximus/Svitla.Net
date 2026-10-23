# Builds the Windows installer: build\DTEK-Widget-Setup-<version>.exe
#
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1 [-Node <path to node.exe>] [-Iscc <path to ISCC.exe>]
#
# Needs Node.js with npm (its node.exe is bundled into the installer) and Inno Setup 6.
# The launcher is compiled with the C# compiler of .NET Framework 4, which is part of Windows;
# the WebView2 SDK is downloaded from nuget.org into build\cache on the first build.

param(
  [string]$Node = (Get-Command node -ErrorAction SilentlyContinue).Source,
  [string]$Iscc,
  [string]$WebView2Version = '1.0.4022.49'
)

$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot
$build = Join-Path $root 'build'
$stage = Join-Path $build 'stage'

if (-not $Node -or -not (Test-Path $Node)) { throw 'node.exe not found; pass -Node <path>' }
if (-not $Iscc) {
  $Iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Iscc) { throw 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup); or pass -Iscc <path>' }
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\app", "$stage\node" | Out-Null

Write-Host '== app files and production dependencies'
foreach ($f in 'index.html', 'main.js', 'style.css', 'server.js', 'package.json', 'package-lock.json') {
  Copy-Item (Join-Path $root $f) "$stage\app"
}
Push-Location "$stage\app"
try {
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm ci failed' }
} finally { Pop-Location }

Write-Host "== node runtime $(& $Node -v)"
Copy-Item $Node "$stage\node\node.exe"
$license = Join-Path (Split-Path $Node) 'LICENSE'
if (Test-Path $license) { Copy-Item $license "$stage\node\LICENSE" }

Write-Host '== icon'
& (Join-Path $PSScriptRoot 'make-icon.ps1') -Out "$build\app.ico"

Write-Host "== WebView2 SDK $WebView2Version"
# The window hosts the WebView2 runtime that ships with Windows; the SDK supplies the .NET wrapper and loader
$sdk = Join-Path $build "cache\webview2-$WebView2Version"
if (-not (Test-Path "$sdk\lib")) {
  New-Item -ItemType Directory -Force $sdk | Out-Null
  $nupkg = "$sdk.zip"
  Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WebView2Version/microsoft.web.webview2.$WebView2Version.nupkg" -OutFile $nupkg -UseBasicParsing
  Expand-Archive $nupkg $sdk -Force
  Remove-Item $nupkg
}
$wvCore = "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll"
$wvForms = "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll"
Copy-Item $wvCore, $wvForms, "$sdk\runtimes\win-x64\native\WebView2Loader.dll" $stage

Write-Host '== launcher'
& $csc /nologo /target:winexe /optimize+ /platform:x64 "/win32icon:$build\app.ico" `
  "/out:$stage\DTEK Widget.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "/r:$wvCore" "/r:$wvForms" `
  (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'PowerTray.cs') (Join-Path $PSScriptRoot 'AddressLookup.cs')
if ($LASTEXITCODE) { throw 'launcher build failed' }

Write-Host '== installer'
& $Iscc /Q "/DAppVersion=$version" "/DStageDir=$stage" "/DIconFile=$build\app.ico" "/O$build" (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE) { throw 'installer build failed' }

Write-Host "`nDone: $build\DTEK-Widget-Setup-$version.exe"
