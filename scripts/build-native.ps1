$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $projectRoot 'native\DesktopHostBridge\build.ps1')
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
Push-Location -LiteralPath (Join-Path $projectRoot 'native\DesktopLayoutBridge')
try {
  & $compiler /nologo /target:exe /platform:x64 /reference:System.Web.Extensions.dll /out:GersonDesktopLayoutBridge.exe LegacyProgram.cs
  if ($LASTEXITCODE -ne 0) { throw 'Desktop layout bridge build failed.' }
} finally { Pop-Location }
