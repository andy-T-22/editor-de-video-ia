$d = Invoke-RestMethod 'http://localhost:3001/api/data'
Write-Host "active_segments:" $d.active_segments.Count
Write-Host "words:" $d.words.Count
Write-Host "clips:" ($d.clips | ForEach-Object { $_.name })
Write-Host "original_duration:" $d.original_duration
Write-Host "edited_duration:" $d.edited_duration
Write-Host "concat_video:" $d.concat_video

$files = (Invoke-RestMethod 'http://localhost:3001/api/files').files
Write-Host "---"
Write-Host "Input files:" $files.Count
$files | ForEach-Object { Write-Host " -" $_.name ([math]::Round($_.size/1MB, 1)) "MB" }

$output = Get-ChildItem 'C:\Users\maxim\Documents\antigravity\bold-fermi\output' -ErrorAction SilentlyContinue
Write-Host "---"
Write-Host "Output videos:" $output.Count
$output | ForEach-Object { Write-Host " -" $_.Name ([math]::Round($_.Length/1MB,1)) "MB" $_.LastWriteTime }
