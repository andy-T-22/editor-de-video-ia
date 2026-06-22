"""
build_data.py
Combina los segmentos activos (silence_detect) con la transcripcion (transcribe)
y genera un data.json que Remotion y el web-editor consumen.
Los tiempos de las palabras se remapean a la nueva linea de tiempo (sin silencios).
"""
import json
import sys
import os


def remap_words_to_new_timeline(active_segments: list[dict], words: list[dict]) -> list[dict]:
    """
    Toma los segmentos activos y las palabras con tiempos del video original.
    Genera nuevas marcas de tiempo para cada palabra segun el video ya cortado.
    """
    # Construir mapa: tiempo original -> tiempo nuevo
    # Para cada segmento activo, sabemos cuanto tiempo ocupa en el video nuevo
    remapped = []
    new_cursor = 0.0

    for seg in active_segments:
        seg_start  = seg["start"]
        seg_end    = seg["end"]
        seg_dur    = seg_end - seg_start
        new_seg_start = new_cursor

        for word in words:
            w_start = word["start"]
            w_end   = word["end"]
            # Solo procesar palabras que caen dentro de este segmento
            if w_start >= seg_start and w_end <= seg_end + 0.1:
                offset        = w_start - seg_start
                new_w_start   = new_seg_start + offset
                new_w_end     = new_seg_start + (w_end - seg_start)
                remapped.append({
                    "word":           word["word"],
                    "start":          round(new_w_start, 3),
                    "end":            round(min(new_w_end, new_cursor + seg_dur), 3),
                    "original_start": word["start"],
                    "original_end":   word["end"]
                })

        new_cursor += seg_dur

    return remapped, new_cursor  # new_cursor = duracion total del video editado


def build(silence_data: dict, transcription_data: dict, title: str = "", config: dict = None) -> dict:
    active_segments   = silence_data["active_segments"]
    total_original    = silence_data["total_duration"]
    words             = transcription_data["words"]

    if config is None:
        config = {
            "title":             title,
            "title_start_sec":   0.0,
            "title_end_sec":     4.0,
            "music_volume":      0.08,
            "subtitle_style": {
                "font":      "Montserrat",
                "size":      70,
                "color":     "#FFFFFF",
                "highlight": "#FFDD00",
                "stroke":    "#000000",
                "words_per_line": 2
            }
        }

    remapped_words, edited_duration = remap_words_to_new_timeline(active_segments, words)

    data = {
        "config":          config,
        "original_duration": total_original,
        "edited_duration":  round(edited_duration, 3),
        "active_segments": active_segments,
        "words":           remapped_words,
        "full_text":       transcription_data.get("full_text", ""),
        "language":        transcription_data.get("language", "es")
    }
    return data


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Uso: python build_data.py <silence_json> <transcription_json> <output_json> [titulo]")
        sys.exit(1)

    silence_path      = sys.argv[1]
    transcription_path = sys.argv[2]
    output_path       = sys.argv[3]
    title             = sys.argv[4] if len(sys.argv) > 4 else ""

    with open(silence_path,       encoding="utf-8") as f:
        silence_data = json.load(f)
    with open(transcription_path, encoding="utf-8") as f:
        transcription_data = json.load(f)

    data = build(silence_data, transcription_data, title)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[build_data] data.json generado en: {output_path}")
    print(f"  Duracion original: {data['original_duration']:.1f}s")
    print(f"  Duracion editada:  {data['edited_duration']:.1f}s")
    print(f"  Segmentos activos: {len(data['active_segments'])}")
    print(f"  Palabras:          {len(data['words'])}")
