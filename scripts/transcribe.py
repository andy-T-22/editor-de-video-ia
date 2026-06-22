"""
transcribe.py
Transcribe un audio/video localmente usando faster-whisper.
Retorna JSON con palabras y sus marcas de tiempo exactas.
"""
import json
import sys
import os
from faster_whisper import WhisperModel


def transcribe(video_path: str, model_size: str = "base", language: str = "es") -> dict:
    """
    Transcribe el audio del video usando faster-whisper (100% local, sin API).
    model_size: "tiny", "base", "small", "medium", "large-v3"
      - tiny/base: rapidos, menos precisos (~500MB RAM)
      - small/medium: balance calidad/velocidad
      - large-v3: maxima precision, mas lento y pesado
    """
    print(f"[Whisper] Cargando modelo '{model_size}'...", file=sys.stderr)
    # device="cpu" para funcionar en cualquier PC sin GPU
    # compute_type="int8" para menor uso de RAM
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"[Whisper] Transcribiendo '{os.path.basename(video_path)}'...", file=sys.stderr)
    segments_gen, info = model.transcribe(
        video_path,
        language=language,
        word_timestamps=True,  # Critico: marca de tiempo por PALABRA
        vad_filter=True,        # Filtra silencios internamente tambien
        vad_parameters=dict(min_silence_duration_ms=300)
    )

    words = []
    full_text = []

    for segment in segments_gen:
        full_text.append(segment.text.strip())
        if segment.words:
            for word in segment.words:
                words.append({
                    "word":  word.word.strip(),
                    "start": round(word.start, 3),
                    "end":   round(word.end, 3)
                })

    result = {
        "language":  info.language,
        "duration":  round(info.duration, 3),
        "full_text": " ".join(full_text),
        "words":     words
    }
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python transcribe.py <video_path> [model_size] [language]")
        sys.exit(1)

    video_path  = sys.argv[1]
    model_size  = sys.argv[2] if len(sys.argv) > 2 else "base"
    language    = sys.argv[3] if len(sys.argv) > 3 else "es"

    result = transcribe(video_path, model_size, language)
    print(json.dumps(result, ensure_ascii=False, indent=2))
