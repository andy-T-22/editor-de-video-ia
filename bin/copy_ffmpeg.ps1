$raw    = "C:\Users\maxim\Documents\antigravity\bold-fermi\bin\ffmpeg_raw"
$dest   = "C:\Users\maxim\Documents\antigravity\bold-fermi\bin\ffmpeg.exe"

$found = Get-ChildItem -Recurse $raw -Filter "ffmpeg.exe" | Select-Object -First 1
Write-Host "Encontrado: $($found.FullName)"
Copy-Item $found.FullName $dest -Force
Write-Host "Copiado a: $dest"
Remove-Item -Recurse -Force $raw
Write-Host "Limpieza OK"
& $dest -version 2>&1 | Select-Object -First 1
Write-Host "FFmpeg listo!"
