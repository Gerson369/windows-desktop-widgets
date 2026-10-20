$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
Push-Location -LiteralPath $PSScriptRoot
try {
  & $compiler /nologo /target:exe /platform:x64 /reference:System.Web.Extensions.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /out:GersonDesktopHostBridge.exe DesktopHostBridge.cs DesktopGesture.cs ShellIcon.cs
  if ($LASTEXITCODE -ne 0) { throw 'Desktop host bridge build failed.' }
} finally { Pop-Location }
