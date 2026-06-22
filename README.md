# ⚡ AutoEditor IA

AutoEditor IA es un sistema local que automatiza la edición de videos para redes sociales. Permite tomar múltiples videos en crudo (clips), concatenarlos, eliminar automáticamente los silencios o equivocaciones (basado en inteligencia artificial semántica) y generar subtítulos dinámicos con estilo karaoke.

Todo el procesamiento se realiza de forma **100% local y privada**, sin depender de APIs de pago ni de conexión a internet para el procesamiento de datos.

---

## 🛠️ ¿Cómo funciona el sistema?

El flujo de trabajo actual se compone de los siguientes pasos:

1. **Subida y Concatenación**: Se suben múltiples clips desde la interfaz (Frontend Vite/React). El servidor Node.js extrae la duración de cada uno y usa **FFmpeg** para unirlos en un único video temporal, garantizando que el audio y el video mantengan sincronía.
2. **Detección de Silencios**: Un script en Python (`silence_detect.py`) analiza el video concatenado y detecta matemáticamente en qué momentos no hay voz, generando cortes precisos (evitando cortes muy pequeños para que se sienta natural).
3. **Transcripción (Whisper)**: Se utiliza el modelo **faster-whisper** para transcribir el audio a texto palabra por palabra, obteniendo las marcas de tiempo exactas para los subtítulos.
4. **IA Semántica**: Si proporcionás un "Guion / Idea", el sistema ejecuta un modelo de lenguaje muy rápido y local (`Qwen 0.5B`) para leer el guion y compararlo con cada segmento del video. **Desactiva automáticamente los segmentos que considera irrelevantes o errores de grabación**.
5. **Ajuste Fino**: El editor en el navegador te permite ver una línea de tiempo (con marcas de dónde empieza y termina cada clip original), revisar el texto transcrito y habilitar/deshabilitar los cortes a mano.
6. **Renderizado Final**: Una vez que le das a "Renderizar", el servidor vuelve a usar FFmpeg para eliminar las partes indeseadas y quemar (hardcode) los subtítulos estilizados en un archivo MP4 final, optimizado para redes.

---

## 🚀 Requisitos e Instalación en otra PC

Para instalar este sistema en otra computadora desde cero, debes instalar las siguientes herramientas:

### 1. Requisitos Previos (Programas del sistema)
- **Node.js**: (Recomendado v18+). Descargar e instalar desde nodejs.org.
- **Python**: (Recomendado v3.10+). Descargar e instalar desde python.org (Asegurate de marcar la casilla "Add Python to PATH" durante la instalación).
- **FFmpeg**: Se necesita el binario de FFmpeg y FFprobe. Debes descargar los `.exe` (versión para Windows) y colocarlos en la carpeta `bin/` del proyecto (`bin/ffmpeg.exe` y `bin/ffprobe.exe`).

### 2. Instalación de Dependencias

Abrí una terminal (PowerShell o CMD) y ejecutá estos comandos:

#### A) Servidor Backend
```powershell
cd web-editor/server
npm install
```

#### B) Interfaz Frontend
```powershell
cd ../frontend
npm install
```

#### C) Librerías de Python e Inteligencia Artificial
```powershell
# Volver a la raíz del proyecto
cd ../../
pip install faster-whisper transformers accelerate sentencepiece torch
```
*(Nota: La instalación de `torch` puede ser pesada. Si la PC tiene placa de video NVIDIA, se recomienda instalar la versión de PyTorch con soporte para CUDA para mayor velocidad).*

---

## 🏃‍♂️ Cómo usar la herramienta

Una vez instalado todo, para arrancar la aplicación solo necesitas abrir dos terminales:

**Terminal 1 (Servidor Backend):**
```powershell
cd web-editor/server
node index.js
```

**Terminal 2 (Interfaz Frontend):**
```powershell
cd web-editor/frontend
npm run dev
```

Luego, abrí tu navegador e ingresá a `http://localhost:5173`. 
*(Nota: También podés crear un archivo `start.bat` en la raíz del proyecto que ejecute ambos comandos automáticamente para mayor comodidad).*
