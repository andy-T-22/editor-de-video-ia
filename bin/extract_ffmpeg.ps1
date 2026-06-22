$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$binDir = Join-Path $root "bin"
$zipPath = Join-Path $binDir "ffmpeg.zip"
$rawDir  = Join-Path $binDir "ffmpeg_raw"
$outExe  = Join-Path $binDir "ffmpeg.exe"

Write-Host "[FFmpeg] Extrayendo $zipPath ..."
Expand-Archive -Path $zipPath -DestinationPath $rawDir -Force

$exe = Get-ChildItem -Recurse $rawDir -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $exe) { throw "ffmpeg.exe no encontrado dentro del ZIP" }

Copy-Item $exe.FullName $outExe -Force
Write-Host "[FFmpeg] Copiado a $outExe"

Remove-Item -Recurse -Force $rawDir
Write-Host "[FFmpeg] Listo."

& $outExe -version 2>&1 | Select-Object -First 2
