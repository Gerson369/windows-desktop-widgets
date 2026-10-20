$ErrorActionPreference = 'Stop'
function Get-ReleaseSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
$source = $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$artifactPrefix = "$($package.build.productName)-$($package.version)-x64"
$workspace = Join-Path $env:TEMP ("gerson-release-" + [guid]::NewGuid().ToString('N'))
$staging = Join-Path $workspace 'app'
$prepackaged = Join-Path $workspace 'prepackaged-win-x64'
$destination = Join-Path $source 'release'

Set-Location -LiteralPath $source
& (Join-Path $source 'scripts\build-native.ps1')
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "生产构建失败，退出码 $LASTEXITCODE。" }
New-Item -ItemType Directory -Path $staging, $prepackaged -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'out') -Destination (Join-Path $staging 'out') -Recurse
& node.exe (Join-Path $source 'create-runtime-package.cjs') (Join-Path $source 'package.json') (Join-Path $staging 'package.json')
if ($LASTEXITCODE -ne 0) { throw '生成运行时清单失败。' }
foreach ($module in @('lowdb','graceful-fs','is-promise','lodash','pify','steno')) {
  $from = Join-Path $source "node_modules\$module"
  if (-not (Test-Path -LiteralPath $from)) { throw "缺失运行依赖：$module" }
  robocopy $from (Join-Path $staging "node_modules\$module") /E /XJ | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "复制运行依赖失败：$module" }
}
robocopy (Join-Path $source 'node_modules\electron\dist') $prepackaged /E /XJ /XF '*.log' | Out-Null
if ($LASTEXITCODE -gt 7) { throw '复制 Electron 运行时失败。' }
Move-Item -LiteralPath (Join-Path $prepackaged 'electron.exe') -Destination (Join-Path $prepackaged 'GersonToolbox.exe')
$resources = Join-Path $prepackaged 'resources'
New-Item -ItemType Directory -Path (Join-Path $resources 'native') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'native\DesktopLayoutBridge\GersonDesktopLayoutBridge.exe') -Destination (Join-Path $resources 'native\GersonDesktopLayoutBridge.exe')
Copy-Item -LiteralPath (Join-Path $source 'native\DesktopHostBridge\GersonDesktopHostBridge.exe') -Destination (Join-Path $resources 'native\GersonDesktopHostBridge.exe')
Copy-Item -LiteralPath (Join-Path $source 'resources\tray-icon.png') -Destination (Join-Path $resources 'tray-icon.png')
& node.exe (Join-Path $source 'node_modules\@electron\asar\bin\asar.js') pack $staging (Join-Path $resources 'app.asar')
if ($LASTEXITCODE -ne 0) { throw 'ASAR 打包失败。' }
& (Join-Path $source 'node_modules\.bin\electron-builder.cmd') --projectDir $source --prepackaged $prepackaged --win nsis portable --x64 "--config.directories.output=$workspace\release"
if ($LASTEXITCODE -ne 0) { throw "Windows 发布失败。中间文件保留在 $workspace" }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$files = @()
foreach ($suffix in @('setup.exe', 'portable.exe', 'setup.exe.blockmap')) {
  $file = Join-Path $workspace "release\$artifactPrefix-$suffix"
  if (-not (Test-Path -LiteralPath $file)) {
    if ($suffix -ne 'setup.exe.blockmap') { throw "缺失发布文件：$file" }
    continue
  }
  Copy-Item -LiteralPath $file -Destination (Join-Path $destination ([IO.Path]::GetFileName($file))) -Force
  $files += Get-Item -LiteralPath (Join-Path $destination ([IO.Path]::GetFileName($file)))
}
$manifest = [ordered]@{ product = $package.build.productName; version = $package.version; builtAt = (Get-Date).ToString('o'); strategy = 'prepackaged-runtime'; prepackaged = $prepackaged; files = @($files | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-ReleaseSha256 $_.FullName) } }) }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'LATEST_WINDOWS_RELEASE.json') -Encoding UTF8
Write-Output "PREPACKAGED=$prepackaged"
Write-Output "RELEASE=$destination"
# ponytail: retain this build's temporary runtime for packaged smoke testing; remove it after acceptance.
