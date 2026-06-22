"""
silence_detect.py
Detecta silencios en un video usando FFmpeg y retorna los segmentos de VOZ ACTIVA.
"""
import subprocess
import re
import json
import sys
import os

def detect_active_segments(video_path: str, ffmpeg_path: str = "ffmpeg",
                            silence_threshold: float = -35.0,
                            silence_duration: float = 0.8,
                            padding: float = 0.1) -> list[dict]:
    """
    Ejecuta ffmpeg silencedetect y retorna segmentos donde hay VOZ.
    padding: tiempo en segundos que se agrega antes y despues de cada segmento
             para evitar cortes abruptos en el audio.
    """
    cmd = [
        ffmpeg_path, "-i", video_path,
        "-af", f"silencedetect=noise={silence_threshold}dB:d={silence_duration}",
        "-f", "null", "-"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    output = result.stderr

    # Extraer duracion total del video
    duration_match = re.search(r"Duration: (\d+):(\d+):([\d.]+)", output)
    if not duration_match:
        raise ValueError("No se pudo obtener la duracion del video.")
    h, m, s = duration_match.groups()
    total_duration = int(h) * 3600 + int(m) * 60 + float(s)

    # Extraer intervalos de silencio
    silence_starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", output)]
    silence_ends   = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", output)]

    # Construir lista de silencios
    silences = []
    for i, start in enumerate(silence_starts):
        end = silence_ends[i] if i < len(silence_ends) else total_duration
        silences.append((start, end))

    # Invertir: obtener segmentos de VOZ activa
    active_segments = []
    cursor = 0.0
    for (s_start, s_end) in silences:
        if s_start > cursor:
            seg_start = max(0.0, cursor - padding)
            seg_end   = min(total_duration, s_start + padding)
            if seg_end - seg_start > 0.1:
                active_segments.append({
                    "start": round(seg_start, 3),
                    "end":   round(seg_end, 3),
                    "duration": round(seg_end - seg_start, 3)
                })
        cursor = s_end

    # Ultimo segmento al final del video
    if cursor < total_duration:
        seg_start = max(0.0, cursor - padding)
        active_segments.append({
            "start": round(seg_start, 3),
            "end":   round(total_duration, 3),
            "duration": round(total_duration - seg_start, 3)
        })

    return active_segments, total_duration


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python silence_detect.py <video_path> <ffmpeg_path>")
        sys.exit(1)

    video_path  = sys.argv[1]
    ffmpeg_path = sys.argv[2]

    segments, total_duration = detect_active_segments(video_path, ffmpeg_path)
    result = {
        "total_duration": total_duration,
        "active_segments": segments
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
