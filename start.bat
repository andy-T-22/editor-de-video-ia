@echo off
title AutoEditor IA — Iniciando...
echo.
echo  ======================================
echo   AutoEditor IA - Editor de Video
echo  ======================================
echo.

:: Ir al directorio del proyecto
cd /d "%~dp0"

:: Verificar si FFmpeg está extraído en bin/
if not exist "bin\ffmpeg.exe" (
    echo [FFmpeg] Extrayendo FFmpeg portable...
    powershell -ExecutionPolicy Bypass -Command "Expand-Archive -Path 'bin\ffmpeg.zip' -DestinationPath 'bin\ffmpeg_raw' -Force; $exe = Get-ChildItem -Recurse 'bin\ffmpeg_raw' -Filter 'ffmpeg.exe' | Select-Object -First 1; Copy-Item $exe.FullName 'bin\ffmpeg.exe'; Remove-Item -Recurse -Force 'bin\ffmpeg_raw'"
    echo [FFmpeg] OK - bin\ffmpeg.exe listo
) else (
    echo [FFmpeg] Encontrado en bin\ffmpeg.exe
)

echo.
echo [Servidor API] Iniciando en http://localhost:3001 ...
start "AutoEditor - API Server" cmd /k "cd /d %~dp0web-editor\server && node index.js"

timeout /t 2 /nobreak > nul

echo [Frontend] Iniciando interfaz web en http://localhost:5173 ...
start "AutoEditor - Frontend" cmd /k "cd /d %~dp0web-editor\frontend && npx vite --port 5173"

timeout /t 3 /nobreak > nul

echo [Navegador] Abriendo AutoEditor IA...
start http://localhost:5173

echo.
echo  ✅ AutoEditor IA corriendo!
echo     API:      http://localhost:3001
echo     Editor:   http://localhost:5173
echo.
echo  Para detener: cerrá las ventanas de consola abiertas.
echo.
pause
